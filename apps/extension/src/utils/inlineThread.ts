import * as vscode from 'vscode';
import { LLMError, NoApiKeyError } from './llm';

// 여러 기능(용어 사전·패키지 설명·에러 힌트·코드 가이드)에서 공용으로 쓰는
// 에디터 인라인 Comments 스레드 래퍼. 선택 영역 바로 아래에 설명을 띄움.
const AUTHOR: vscode.CommentAuthorInformation = { name: 'DevNavi' };

export class InlineThread implements vscode.Disposable {
    private readonly controller: vscode.CommentController;

    constructor(id: string, label: string) {
        this.controller = vscode.comments.createCommentController(id, label);
    }

    // 에디터 선택/커서 위치에 스레드 생성 + 로딩 상태로 초기화
    open(editor: vscode.TextEditor, threadLabel: string, loadingBody = '🧭 _생각 중…_'): vscode.CommentThread {
        const range = editor.selection.isEmpty
            ? new vscode.Range(editor.selection.active, editor.selection.active)
            : editor.selection;

        const loading: vscode.Comment = {
            body: new vscode.MarkdownString(loadingBody),
            mode: vscode.CommentMode.Preview,
            author: AUTHOR
        };

        const thread = this.controller.createCommentThread(editor.document.uri, range, [loading]);
        thread.label = threadLabel;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        return thread;
    }

    setMarkdown(thread: vscode.CommentThread, markdown: string): void {
        const md = new vscode.MarkdownString(markdown);
        md.isTrusted = {
            enabledCommands: [
                'devnavi.jargon.saveAiResult',
                'devnavi.config.setApiKey',
                'devnavi.config.selectProvider'
            ]
        };
        md.supportThemeIcons = true;
        thread.comments = [{ body: md, mode: vscode.CommentMode.Preview, author: AUTHOR }];
    }

    setError(thread: vscode.CommentThread, err: unknown): void {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        if (err instanceof NoApiKeyError) {
            md.appendMarkdown(`⚠️ ${err.message}\n\n`);
            md.appendMarkdown(`[API 키 설정](command:devnavi.config.setApiKey) · [프로바이더 선택](command:devnavi.config.selectProvider)`);
        } else if (err instanceof LLMError) {
            md.appendMarkdown(`⚠️ ${err.message}`);
        } else {
            md.appendMarkdown(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
        }
        thread.comments = [{ body: md, mode: vscode.CommentMode.Preview, author: AUTHOR }];
    }

    dispose(): void {
        this.controller.dispose();
    }
}
