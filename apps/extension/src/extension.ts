import * as vscode from 'vscode';
import { CheatsheetProvider, CheatNode } from './providers/cheatsheetProvider';
import { CustomCommandStore } from './storage/customCommands';
import { CustomCommandActions } from './commands/customCommands';
import { searchCheatsheet } from './commands/search';
import { copyCommand, sendToTerminal } from './utils/clipboard';

// Extension 진입점 — 가볍게 유지 (lazy loading 원칙)
export function activate(context: vscode.ExtensionContext) {
    const store = new CustomCommandStore(context);
    const cheatsheetProvider = new CheatsheetProvider(store);
    const cheatsheetActions = new CustomCommandActions(store, () => cheatsheetProvider.refresh());

    const treeView = vscode.window.createTreeView('devnavi.cheatsheet', {
        treeDataProvider: cheatsheetProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('devnavi.cheatsheet.copy', (cmd: string) => copyCommand(cmd)),
        vscode.commands.registerCommand('devnavi.cheatsheet.runInTerminal', (node: CheatNode) => {
            if (node?.item?.command) {
                sendToTerminal(node.item.command);
            }
        }),
        vscode.commands.registerCommand('devnavi.cheatsheet.refresh', () => cheatsheetProvider.refresh()),
        vscode.commands.registerCommand('devnavi.cheatsheet.search', () => searchCheatsheet(cheatsheetProvider)),
        vscode.commands.registerCommand('devnavi.cheatsheet.addCustom', () => cheatsheetActions.add()),
        vscode.commands.registerCommand('devnavi.cheatsheet.editCustom', (node: CheatNode) => cheatsheetActions.edit(node)),
        vscode.commands.registerCommand('devnavi.cheatsheet.removeCustom', (node: CheatNode) => cheatsheetActions.remove(node))
    );
}

export function deactivate() {}
