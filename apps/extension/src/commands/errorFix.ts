import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { trackedAskLLM } from '../utils/llm';
import { buildErrorFixMessages } from '../utils/prompts';
import { applyProposalToText, ErrorFixProposal, parseErrorFix } from '../utils/errorFix';

export interface FixSnapshot { uri: vscode.Uri; version: number; original: string }
interface Review extends FixSnapshot {
    id: string;
    proposal: ErrorFixProposal;
    modified: string;
    panel: vscode.WebviewPanel;
    previewed: boolean;
    previewColumn?: vscode.ViewColumn;
    applied: boolean;
    applying: boolean;
}

export async function applyReviewedFix(snapshot: FixSnapshot, modified: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(snapshot.uri);
    if (doc.version !== snapshot.version || doc.getText() !== snapshot.original) {
        throw new Error('검토 중 파일이 바뀌었어. 최신 코드로 수정안을 다시 만들어줘.');
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(snapshot.original.length)), modified);
    if (!await vscode.workspace.applyEdit(edit)) { throw new Error('수정안을 적용하지 못했어. 파일 상태를 확인해줘.'); }
}

export class ErrorFixController implements vscode.TextDocumentContentProvider, vscode.Disposable {
    static readonly scheme = 'devnavi-fix';
    private readonly reviews = new Map<string, Review>();
    constructor(private readonly keys: ApiKeyStore, private readonly tracker: TokenTrackerStore) {}

    provideTextDocumentContent(uri: vscode.Uri): string {
        const review = this.reviews.get(uri.authority);
        return review ? (uri.query === 'before' ? review.original : review.modified) : '이 수정안은 닫혔어.';
    }

    async create(errorText: string, preferred?: vscode.TextEditor): Promise<void> {
        try {
            const doc = await this.chooseDocument(preferred);
            if (!doc) { return; }
            const original = doc.getText();
            const version = doc.version;
            let context = original;
            if (original.length > 24000) {
                const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
                context = editor && !editor.selection.isEmpty ? doc.getText(editor.selection) : '';
                if (!context.trim() || context.length > 24000) {
                    throw new Error('파일이 커서 고칠 부분을 먼저 선택해야 해. 선택한 뒤 오류 분석을 다시 실행해줘.');
                }
            }
            const raw = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevNavi: 원인과 수정안 분석 중…' }, () =>
                trackedAskLLM(this.keys, this.tracker, 'errorFix.ai', errorText.slice(0, 200),
                    buildErrorFixMessages(errorText, vscode.workspace.asRelativePath(doc.uri), doc.languageId, context), 4096));
            const proposal = parseErrorFix(raw);
            const modified = applyProposalToText(original, context, proposal.edits);
            if (this.reviews.size >= 10) { this.reviews.values().next().value?.panel.dispose(); }
            const id = randomUUID();
            const panel = vscode.window.createWebviewPanel('devnavi.errorFix', 'DevNavi · 원인과 수정안', vscode.ViewColumn.Active, {
                enableScripts: false,
                enableCommandUris: ['devnavi.errorFix.preview', 'devnavi.errorFix.apply'],
                localResourceRoots: []
            });
            const review: Review = { id, uri: doc.uri, version, original, modified, proposal, panel, previewed: false, applied: false, applying: false };
            this.reviews.set(id, review);
            panel.onDidDispose(() => this.reviews.delete(id));
            this.render(review);
        } catch (err) { void vscode.window.showErrorMessage(`DevNavi: ${err instanceof Error ? err.message : String(err)}`); }
    }

    async preview(id: string): Promise<void> {
        const review = this.reviews.get(id);
        if (!review || review.applied || review.proposal.edits.length === 0) { return; }
        const uri = (side: string) => vscode.Uri.from({ scheme: ErrorFixController.scheme, authority: id, path: '/' + basename(review.uri.fsPath), query: side });
        try {
            const panelColumn = review.panel.viewColumn ?? vscode.ViewColumn.One;
            const column = Math.min(panelColumn + 1, vscode.ViewColumn.Nine);
            await vscode.commands.executeCommand('vscode.diff', uri('before'), uri('after'), `${basename(review.uri.fsPath)} · DevNavi 수정안`, { viewColumn: column, preview: true });
            review.previewColumn = column;
            review.previewed = true;
            this.render(review);
        } catch (err) { void vscode.window.showErrorMessage(`수정안 비교를 열지 못했어: ${String(err)}`); }
    }

    async apply(id: string): Promise<void> {
        const review = this.reviews.get(id);
        if (!review || review.applied || review.applying || !review.previewed || review.proposal.edits.length === 0) { return; }
        review.applying = true;
        try {
            await applyReviewedFix(review, review.modified);
            review.applied = true;
            this.render(review);
            await vscode.window.showTextDocument(review.uri, { viewColumn: review.previewColumn ?? vscode.ViewColumn.Active, preview: true });
            void vscode.window.showInformationMessage('수정안을 적용했어. 파일을 저장한 뒤 아래 확인 방법으로 실행·테스트해줘.');
        } catch (err) { void vscode.window.showErrorMessage(`DevNavi: ${err instanceof Error ? err.message : String(err)}`); }
        finally { review.applying = false; }
    }

    private async chooseDocument(preferred?: vscode.TextEditor): Promise<vscode.TextDocument | undefined> {
        const docs = vscode.workspace.textDocuments.filter(d => !d.isClosed && d.uri.scheme === 'file' && !['plaintext', 'log', 'markdown'].includes(d.languageId));
        docs.sort((a, b) => Number(b === preferred?.document) - Number(a === preferred?.document));
        const choices: (vscode.QuickPickItem & { doc?: vscode.TextDocument })[] = docs.map(doc => ({ label: basename(doc.uri.fsPath), description: vscode.workspace.asRelativePath(doc.uri), doc }));
        choices.push({ label: '$(folder-opened) 다른 파일 선택…' });
        const picked = await vscode.window.showQuickPick(choices, { title: '수정할 소스 파일', placeHolder: '오류가 발생한 코드를 선택해줘', matchOnDescription: true });
        if (!picked) { return; }
        if (picked.doc) { return picked.doc; }
        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, openLabel: '이 파일 분석', defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
        if (!uris?.[0] || uris[0].scheme !== 'file') { return; }
        return vscode.workspace.openTextDocument(uris[0]);
    }

    private render(r: Review): void {
        const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
        const link = (command: string) => `command:devnavi.errorFix.${command}?${encodeURIComponent(JSON.stringify([r.id]))}`;
        r.panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{padding:28px;max-width:800px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);line-height:1.8}h1{font-size:24px}h2{font-size:18px;margin-top:28px}p,li{white-space:pre-wrap;overflow-wrap:anywhere}.file{color:var(--vscode-descriptionForeground)}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}a,button{font:inherit;padding:8px 16px;border-radius:4px;text-decoration:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0}a:focus{outline:2px solid var(--vscode-focusBorder)}button:disabled{opacity:.5}.status{border-left:3px solid var(--vscode-textLink-foreground);padding-left:14px}
</style></head><body><p class="file">DevNavi · ${escape(vscode.workspace.asRelativePath(r.uri))}</p><h1>원인과 수정안</h1><h2>왜 발생했을까?</h2><p>${escape(r.proposal.cause)}</p><div class="actions">${r.applied ? '<p class="status">수정안 적용 완료 · 저장 후 실행·테스트로 확인해줘.</p>' : r.proposal.edits.length ? `<a href="${link('preview')}">변경 전후 비교</a>${r.previewed ? `<a href="${link('apply')}">수정안 적용</a>` : '<button disabled>비교 후 적용</button>'}` : '<p class="status">이 파일만으로 확실한 수정안을 만들기 어려워. 아래 항목을 확인해줘.</p>'}</div><h2>해결됐는지 확인하기</h2><ol>${r.proposal.verification.map(s => `<li>${escape(s)}</li>`).join('')}</ol></body></html>`;
    }

    dispose(): void { for (const review of [...this.reviews.values()]) { review.panel.dispose(); } this.reviews.clear(); }
}
