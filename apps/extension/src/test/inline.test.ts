import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { InlineCard, closeInlineCard } from '../utils/inlineCard';

suite('Compact native code cards', () => {
    test('anchors beneath source without opening another editor and invalidates actions when closed', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'const same = a === b;\n' });
        const editor = await vscode.window.showTextDocument(document);
        const tabs = vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0);
        const groups = vscode.window.tabGroups.all.length;
        const actions: string[] = [];
        let closed = 0;
        const card = new InlineCard('devnavi.test.inline', 'Test', name => actions.push(name), () => closed++);
        try {
            card.open(document.uri, new vscode.Range(0, 0, 0, 0), '한국어로 읽기');
            const body = card.markdown();
            body.appendText('===는 값과 자료형이 같은지 비교합니다.');
            card.link(body, '다음', 'next');
            card.render(body);
            // 공개 API에는 스레드 열람 기능이 없어 생성된 네이티브 객체만 검사한다.
            const thread = (card as unknown as { thread: vscode.CommentThread }).thread;
            assert.equal(thread.uri.toString(), document.uri.toString());
            assert.equal(thread.range?.end.line, 0);
            assert.equal(thread.canReply, false);
            assert.equal(thread.comments.length, 1);
            assert.equal(vscode.window.activeTextEditor, editor);
            assert.equal(vscode.window.tabGroups.all.length, groups);
            assert.equal(vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0), tabs);
            assert.deepEqual(body.isTrusted, { enabledCommands: [card.actionCommand] });
            const args = JSON.parse(decodeURIComponent(body.value.match(/command:devnavi\.test\.inline\.action\?([^)]*)/u)![1]));
            await vscode.commands.executeCommand(card.actionCommand, 'wrong-session', 'next');
            assert.deepEqual(actions, []);
            await vscode.commands.executeCommand(card.actionCommand, ...args);
            assert.deepEqual(actions, ['next']);
            assert.equal(closeInlineCard(thread), true);
            assert.equal(card.isOpen, false);
            assert.equal(closed, 1);
            await vscode.commands.executeCommand(card.actionCommand, ...args);
            assert.deepEqual(actions, ['next']);
            card.open(document.uri, new vscode.Range(0, 0, 0, 0), '다시 읽기');
            await vscode.commands.executeCommand(card.actionCommand, ...args);
            assert.deepEqual(actions, ['next']);
        } finally { card.dispose(); }
    });
});
