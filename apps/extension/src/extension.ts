import * as vscode from 'vscode';
import { CheatsheetProvider, CheatNode } from './providers/cheatsheetProvider';
import { CodeGuideActionProvider, CodeGuideController } from './providers/codeGuideProvider';
import { ProjectMapProvider } from './providers/projectMapProvider';
import { CustomCommandStore } from './storage/customCommands';
import { ApiKeyStore } from './storage/apiKey';
import { CustomCommandActions } from './commands/customCommands';
import { ConfigActions } from './commands/config';
import { searchCheatsheet } from './commands/search';
import { copyCommand, sendToTerminal } from './utils/clipboard';

// Extension 진입점 — 가볍게 유지 (lazy loading 원칙)
export function activate(context: vscode.ExtensionContext) {
    // 치트시트
    const store = new CustomCommandStore(context);
    const cheatsheetProvider = new CheatsheetProvider(store);
    const cheatsheetActions = new CustomCommandActions(store, () => cheatsheetProvider.refresh());

    const treeView = vscode.window.createTreeView('devnavi.cheatsheet', {
        treeDataProvider: cheatsheetProvider,
        showCollapseAll: true
    });

    // LLM 설정 + 코드 가이드
    const keys = new ApiKeyStore(context.secrets);
    const config = new ConfigActions(keys);
    const codeGuide = new CodeGuideController(keys);

    // 프로젝트 맵 — Explorer 뱃지·툴팁
    const projectMap = new ProjectMapProvider();

    context.subscriptions.push(
        treeView,
        codeGuide,
        projectMap,
        vscode.window.registerFileDecorationProvider(projectMap),
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file' },
            new CodeGuideActionProvider(),
            { providedCodeActionKinds: [CodeGuideActionProvider.kind] }
        ),
        // 치트시트
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
        vscode.commands.registerCommand('devnavi.cheatsheet.removeCustom', (node: CheatNode) => cheatsheetActions.remove(node)),
        // 코드 가이드
        vscode.commands.registerCommand('devnavi.codeGuide.ask', () => codeGuide.ask('explain')),
        vscode.commands.registerCommand('devnavi.codeGuide.hint', () => codeGuide.ask('hint')),
        vscode.commands.registerCommand('devnavi.codeGuide.reply', (reply: vscode.CommentReply) => codeGuide.reply(reply)),
        // 설정
        vscode.commands.registerCommand('devnavi.config.setApiKey', () => config.setApiKey()),
        vscode.commands.registerCommand('devnavi.config.clearApiKey', () => config.clearApiKey()),
        vscode.commands.registerCommand('devnavi.config.selectProvider', () => config.selectProvider())
    );
}

export function deactivate() {}
