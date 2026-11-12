import * as assert from 'assert';
import * as vscode from 'vscode';
import { applyReviewedFix } from '../commands/errorFix';

suite('Reviewed error fixes', () => {
    test('applies a reviewed correction to the buffer and supports undo', async () => {
        const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'const count = data.items.length;\n' });
        await vscode.window.showTextDocument(doc);
        const snapshot = { uri: doc.uri, version: doc.version, original: doc.getText() };
        await applyReviewedFix(snapshot, 'const count = data?.items?.length ?? 0;\n');
        assert.strictEqual(doc.getText(), 'const count = data?.items?.length ?? 0;\n');
        assert.ok(doc.isDirty);
        await vscode.commands.executeCommand('undo');
        assert.strictEqual(doc.getText(), snapshot.original);
    });
    test('refuses to overwrite edits made after the proposal was created', async () => {
        const doc = await vscode.workspace.openTextDocument({ content: 'original' });
        const snapshot = { uri: doc.uri, version: doc.version, original: doc.getText() };
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'user edit ');
        assert.ok(await vscode.workspace.applyEdit(edit));
        await assert.rejects(applyReviewedFix(snapshot, 'model replacement'), /파일이 바뀌었어/);
        assert.strictEqual(doc.getText(), 'user edit original');
    });
    test('does not apply a proposal twice', async () => {
        const doc = await vscode.workspace.openTextDocument({ content: 'first' });
        const snapshot = { uri: doc.uri, version: doc.version, original: doc.getText() };
        await applyReviewedFix(snapshot, 'second');
        await assert.rejects(applyReviewedFix(snapshot, 'second'), /파일이 바뀌었어/);
        assert.strictEqual(doc.getText(), 'second');
    });
});
