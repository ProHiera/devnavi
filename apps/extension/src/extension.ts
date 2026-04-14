import * as vscode from 'vscode';
import { CheatsheetProvider } from './providers/cheatsheetProvider';
import { copyCommand, sendToTerminal } from './utils/clipboard';

// Extension 진입점 — 가볍게 유지 (lazy loading 원칙)
export function activate(context: vscode.ExtensionContext) {
    const cheatsheetProvider = new CheatsheetProvider();

    // TreeView 등록 — Activity Bar의 DevNavi 컨테이너에 붙음
    const treeView = vscode.window.createTreeView('devnavi.cheatsheet', {
        treeDataProvider: cheatsheetProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('devnavi.cheatsheet.copy', (cmd: string) => copyCommand(cmd)),
        vscode.commands.registerCommand('devnavi.cheatsheet.runInTerminal', (node: { item?: { command: string } }) => {
            if (node?.item?.command) {
                sendToTerminal(node.item.command);
            }
        }),
        vscode.commands.registerCommand('devnavi.cheatsheet.refresh', () => cheatsheetProvider.refresh())
    );
}

export function deactivate() {}
