import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

const cards = new WeakMap<vscode.CommentThread, InlineCard>();

// 코드 바로 아래에 하나의 작은 네이티브 창을 유지한다.
export class InlineCard implements vscode.Disposable {
    private readonly controller: vscode.CommentController;
    private readonly command: vscode.Disposable;
    private thread?: vscode.CommentThread;
    private session = '';
    readonly actionCommand: string;

    constructor(id: string, label: string, action: (name: string, value: unknown) => unknown, private readonly onClose: () => void) {
        this.controller = vscode.comments.createCommentController(id, label);
        this.actionCommand = `${id}.action`;
        this.command = vscode.commands.registerCommand(this.actionCommand, (session: unknown, name: unknown, value: unknown) => {
            if (this.thread && session === this.session && typeof name === 'string') { return action(name, value); }
        });
    }

    get isOpen(): boolean { return Boolean(this.thread); }

    open(uri: vscode.Uri, range: vscode.Range, label: string): void {
        this.close();
        this.session = randomUUID();
        this.thread = this.controller.createCommentThread(uri, range, []);
        this.thread.label = label;
        this.thread.contextValue = 'devnavi';
        this.thread.canReply = false;
        this.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        cards.set(this.thread, this);
    }

    markdown(): vscode.MarkdownString {
        const body = new vscode.MarkdownString();
        body.isTrusted = { enabledCommands: [this.actionCommand] };
        return body;
    }

    link(body: vscode.MarkdownString, label: string, name: string, value?: unknown): void {
        const escaped = new vscode.MarkdownString().appendText(label).value;
        body.appendMarkdown(`[${escaped}](command:${this.actionCommand}?${encodeURIComponent(JSON.stringify([this.session, name, value]))})`);
    }

    render(body: vscode.MarkdownString): void {
        if (this.thread) { this.thread.comments = [{ body, mode: vscode.CommentMode.Preview, author: { name: 'DevNavi' } }]; }
    }

    close(): void {
        const thread = this.thread;
        this.thread = undefined;
        this.session = '';
        if (thread) { cards.delete(thread); thread.dispose(); this.onClose(); }
    }

    dispose(): void { this.close(); this.command.dispose(); this.controller.dispose(); }
}

export function closeInlineCard(thread?: vscode.CommentThread): boolean {
    const card = thread && cards.get(thread);
    if (!card) { return false; }
    card.close();
    return true;
}
