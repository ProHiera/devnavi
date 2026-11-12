import * as vscode from 'vscode';
import { createHash, randomBytes } from 'node:crypto';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { trackedAskLLM } from '../utils/llm';
import { JS_TERMS, ReadingPart, readSelection, selectedLines } from './model';

interface Snapshot { uri: vscode.Uri; range: vscode.Range; version: number; code: string; language: string; file: string; column: vscode.ViewColumn; }
export class ReadingController implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private snapshot?: Snapshot;
    private parts: ReadingPart[] = [];
    private status = '';
    private busy = false;
    private generation = 0;
    private cache = new Map<string, ReadingPart[]>();
    private stale = false;
    private subscriptions: vscode.Disposable[] = [];
    constructor(private readonly context: vscode.ExtensionContext, private readonly keys: ApiKeyStore, private readonly tracker: TokenTrackerStore) {
        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length && event.document.uri.toString() === this.snapshot?.uri.toString()) { this.stale = true; this.send(); }
        }));
    }
    async open(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) { vscode.window.showInformationMessage('한국어로 읽을 코드를 드래그해 선택해 주세요.'); return; }
        if (editor.selections.filter(s => !s.isEmpty).length > 1) { vscode.window.showInformationMessage('한 번에 한 영역을 선택해 주세요. 선택한 범위 전체를 한국어로 읽어 드립니다.'); return; }
        const range = new vscode.Range(editor.selection.start, editor.selection.end);
        this.snapshot = { uri: editor.document.uri, range, version: editor.document.version, code: editor.document.getText(range), language: editor.document.languageId, file: vscode.workspace.asRelativePath(editor.document.uri), column: editor.viewColumn ?? vscode.ViewColumn.One };
        this.stale = false;
        this.ensurePanel();
        await this.run();
    }
    private ensurePanel() {
        if (this.panel) { this.panel.reveal(); return; }
        const panel = vscode.window.createWebviewPanel('devnavi.reading', 'DevNavi · 한국어로 읽기', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
        this.panel = panel;
        const nonce = randomBytes(18).toString('hex');
        const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
        panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('reading.css')}"><title>한국어로 읽기</title></head><body><div id="app"></div><script nonce="${nonce}" src="${asset('reading.js')}"></script></body></html>`;
        panel.webview.onDidReceiveMessage(message => {
            if (message?.type === 'ready') { this.send(); }
            if (message?.type === 'retry' && !this.busy) { void this.run(true); }
            if (message?.type === 'cancel') { this.generation++; this.busy = false; this.status = '여기까지 읽었습니다. 다시 읽기로 이어갈 수 있습니다.'; this.send(); }
            if (message?.type === 'open' && Number.isInteger(message.start) && Number.isInteger(message.end)) { void this.openSource(message.start, message.end); }
        }, undefined, this.subscriptions);
        panel.onDidDispose(() => { this.generation++; this.panel = undefined; this.snapshot = undefined; this.parts = []; }, undefined, this.subscriptions);
    }
    private send() {
        const s = this.snapshot; if (!s) { return; }
        void this.panel?.webview.postMessage({ type: 'reading', file: s.file, language: s.language, firstLine: s.range.start.line + 1, lines: selectedLines(s.code), parts: this.parts, terms: JS_TERMS, busy: this.busy, status: this.status, stale: this.stale });
    }
    private async run(force = false) {
        const s = this.snapshot; if (!s) { return; }
        const generation = ++this.generation;
        const key = createHash('sha256').update(s.language + '\0' + s.code).digest('hex');
        const cached = !force && this.cache.get(key);
        this.parts = cached || []; this.busy = !cached; this.status = cached ? '선택한 코드 전체를 읽었습니다.' : '선택한 코드를 한국어로 읽고 있습니다…'; this.send();
        if (cached) { return; }
        try {
            const parts = await readSelection(s.code, s.language,
                (messages, maxTokens) => trackedAskLLM(this.keys, this.tracker, 'codeGuide.explain', '선택한 코드 한국어로 읽기', messages, maxTokens),
                part => { this.parts.push(part); this.status = `${part.end} / ${selectedLines(s.code).length}줄 읽음`; this.send(); },
                () => generation !== this.generation);
            if (generation !== this.generation) { return; }
            this.cache.set(key, parts); if (this.cache.size > 20) { this.cache.delete(this.cache.keys().next().value!); }
            this.status = '선택한 코드 전체를 읽었습니다.';
        } catch (error) { if (generation === this.generation) { this.status = `한국어로 읽지 못했습니다. ${error instanceof Error ? error.message : String(error)}`; } }
        finally { if (generation === this.generation) { this.busy = false; this.send(); } }
    }
    private async openSource(start: number, end: number) {
        const s = this.snapshot;
        if (!s || !this.parts.some(part => part.steps.some(step => step.start === start && step.end === end))) { return; }
        const doc = await vscode.workspace.openTextDocument(s.uri);
        if (doc.version !== s.version || this.stale) { this.stale = true; this.status = '원본이 바뀌었습니다. 코드를 다시 선택해 읽어 주세요.'; this.send(); return; }
        const from = new vscode.Position(s.range.start.line + start - 1, start === 1 ? s.range.start.character : 0);
        const line = s.range.start.line + end - 1;
        const to = end === selectedLines(s.code).length ? s.range.end : doc.lineAt(line).range.end;
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: s.column, selection: new vscode.Range(from, to), preview: true });
        editor.revealRange(new vscode.Range(from, to), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    dispose() { this.generation++; this.panel?.dispose(); this.subscriptions.forEach(s => s.dispose()); this.cache.clear(); }
}
