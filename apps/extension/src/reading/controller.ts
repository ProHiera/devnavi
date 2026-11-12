import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { trackedAskLLM } from '../utils/llm';
import { InlineCard } from '../utils/inlineCard';
import { JS_TERMS, ReadingAsk, ReadingPart, readSelection, selectedLines } from './model';

interface Snapshot { uri: vscode.Uri; range: vscode.Range; version: number; code: string; language: string; column: vscode.ViewColumn; }
const PAGE_SIZE = 2;

export class ReadingController implements vscode.Disposable {
    private readonly card: InlineCard;
    private snapshot?: Snapshot;
    private parts: ReadingPart[] = [];
    private status = '';
    private busy = false;
    private generation = 0;
    private cache = new Map<string, ReadingPart[]>();
    private stale = false;
    private page = 0;
    private term?: string;
    private readonly subscriptions: vscode.Disposable[] = [];
    private readonly ask: ReadingAsk;

    constructor(_context: vscode.ExtensionContext, keys: ApiKeyStore, tracker: TokenTrackerStore, ask?: ReadingAsk) {
        this.ask = ask ?? ((messages, maxTokens) => trackedAskLLM(keys, tracker, 'codeGuide.explain', '선택한 코드 한국어로 읽기', messages, maxTokens));
        this.card = new InlineCard('devnavi.reading', 'DevNavi 한국어로 읽기', (action, value) => this.action(action, value), () => { this.generation++; this.busy = false; });
        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length && event.document.uri.toString() === this.snapshot?.uri.toString()) { this.stale = true; this.send(); }
        }));
    }

    async open(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) { vscode.window.showInformationMessage('한국어로 읽을 코드를 드래그해 선택해 주세요.'); return; }
        if (editor.selections.filter(s => !s.isEmpty).length > 1) { vscode.window.showInformationMessage('한 번에 한 영역을 선택해 주세요.'); return; }
        const range = new vscode.Range(editor.selection.start, editor.selection.end);
        const code = editor.document.getText(range);
        const lastLine = range.start.line + selectedLines(code).length - 1;
        this.card.open(editor.document.uri, new vscode.Range(lastLine, 0, lastLine, 0), `한국어로 읽기 · ${range.start.line + 1}–${lastLine + 1}줄`);
        this.snapshot = { uri: editor.document.uri, range, version: editor.document.version, code, language: editor.document.languageId, column: editor.viewColumn ?? vscode.ViewColumn.One };
        this.stale = false;
        await this.run();
    }

    private async action(action: string, value: unknown): Promise<void> {
        if (action === 'retry' && !this.busy && !this.stale) { await this.run(true); }
        else if (action === 'cancel') { this.generation++; this.busy = false; this.status = '읽기를 멈췄습니다.'; this.send(); }
        else if (action === 'page' && Number.isInteger(value)) {
            const count = this.parts.flatMap(part => part.steps).length;
            if ((value as number) >= 0 && (value as number) * PAGE_SIZE < count) { this.page = value as number; this.term = undefined; this.send(); }
        } else if (action === 'term' && typeof value === 'string' && this.parts.some(part => part.steps.some(step => step.terms.includes(value)))) {
            this.term = this.term === value ? undefined : value; this.send();
        } else if (action === 'source' && Number.isInteger(value)) {
            const step = this.parts.flatMap(part => part.steps)[value as number];
            if (step) { await this.openSource(step.start, step.end); }
        }
    }

    private send(): void {
        const s = this.snapshot; if (!s || !this.card.isOpen) { return; }
        const body = this.card.markdown();
        const steps = this.parts.flatMap(part => part.steps);
        const shown = steps.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
        if (this.stale) { body.appendText('원본이 바뀌었습니다. 코드를 다시 선택해 읽어 주세요.'); body.appendMarkdown('\n\n'); }
        shown.forEach((step, index) => {
            const first = s.range.start.line + step.start;
            const last = s.range.start.line + step.end;
            if (!this.stale) { this.card.link(body, first === last ? `${first}줄` : `${first}–${last}줄`, 'source', this.page * PAGE_SIZE + index); }
            else { body.appendText(first === last ? `${first}줄` : `${first}–${last}줄`); }
            body.appendText(` · ${step.text}`); body.appendMarkdown('\n\n');
        });
        const terms = [...new Set(shown.flatMap(step => step.terms))];
        if (terms.length) {
            body.appendText('기호 뜻: ');
            terms.forEach((term, index) => { if (index) { body.appendText(' · '); } this.card.link(body, term, 'term', term); });
            body.appendMarkdown('\n\n');
        }
        if (this.term && terms.includes(this.term)) { body.appendText(`${this.term} — ${JS_TERMS[this.term]}`); body.appendMarkdown('\n\n'); }
        if (this.status) { body.appendText(this.status); body.appendMarkdown('\n\n'); }
        if (steps.length > PAGE_SIZE) {
            if (this.page > 0) { this.card.link(body, '← 이전', 'page', this.page - 1); body.appendText('  '); }
            body.appendText(`${this.page + 1} / ${Math.ceil(steps.length / PAGE_SIZE)}  `);
            if ((this.page + 1) * PAGE_SIZE < steps.length) { this.card.link(body, '다음 →', 'page', this.page + 1); body.appendText('  ·  '); }
        }
        if (this.busy) { this.card.link(body, '중지', 'cancel'); }
        else if (!this.stale) { this.card.link(body, '다시 읽기', 'retry'); }
        this.card.render(body);
    }

    private async run(force = false): Promise<void> {
        const s = this.snapshot; if (!s || !this.card.isOpen || this.stale) { return; }
        const generation = ++this.generation;
        const key = createHash('sha256').update(s.language + '\0' + s.code).digest('hex');
        const cached = !force && this.cache.get(key);
        this.page = 0; this.term = undefined;
        this.parts = cached || []; this.busy = !cached; this.status = cached ? '' : '한국어로 읽고 있습니다…'; this.send();
        if (cached) { return; }
        try {
            const parts = await readSelection(s.code, s.language, this.ask,
                part => { this.parts.push(part); this.status = `${part.end} / ${selectedLines(s.code).length}줄 읽음`; this.send(); },
                () => generation !== this.generation);
            if (generation !== this.generation) { return; }
            this.cache.set(key, parts); if (this.cache.size > 20) { this.cache.delete(this.cache.keys().next().value!); }
            this.status = '';
        } catch (error) { if (generation === this.generation) { this.status = `한국어로 읽지 못했습니다. ${error instanceof Error ? error.message : String(error)}`; } }
        finally { if (generation === this.generation) { this.busy = false; this.send(); } }
    }

    private async openSource(start: number, end: number): Promise<void> {
        const s = this.snapshot;
        if (!s) { return; }
        const doc = await vscode.workspace.openTextDocument(s.uri);
        if (doc.version !== s.version || this.stale) { this.stale = true; this.send(); return; }
        const from = new vscode.Position(s.range.start.line + start - 1, start === 1 ? s.range.start.character : 0);
        const line = s.range.start.line + end - 1;
        const to = end === selectedLines(s.code).length ? s.range.end : doc.lineAt(line).range.end;
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: s.column, selection: new vscode.Range(from, to), preview: true });
        editor.revealRange(new vscode.Range(from, to), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    dispose(): void { this.generation++; this.card.dispose(); this.subscriptions.forEach(s => s.dispose()); this.cache.clear(); }
}
