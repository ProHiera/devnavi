import * as vscode from 'vscode';
import { CheatsheetProvider, CheatNode } from './providers/cheatsheetProvider';
import { CodeGuideActionProvider, CodeGuideController } from './providers/codeGuideProvider';
import { ProjectMapProvider } from './providers/projectMapProvider';
import { JargonProvider, JargonNode, JargonItem } from './providers/jargonProvider';
import { ProjectNaviProvider, ProjectNaviNode } from './providers/projectNaviProvider';
import { CustomCommandStore } from './storage/customCommands';
import { CustomJargonStore } from './storage/customJargon';
import { ProjectNaviStore } from './storage/projectNavi';
import { ApiKeyStore } from './storage/apiKey';
import { TokenTrackerStore } from './storage/tokenTracker';
import { CustomCommandActions } from './commands/customCommands';
import { CustomJargonActions } from './commands/customJargon';
import { ProjectNaviActions, ProjectNaviHintContent } from './commands/projectNavi';
import { ConfigActions } from './commands/config';
import { searchCheatsheet } from './commands/search';
import {
    JargonContentProvider,
    JargonInlineController,
    JARGON_SCHEME,
    lookupJargon,
    saveAiResult,
    showJargon
} from './commands/jargon';
import {
    TokenStatusBar,
    TokenPanelContent,
    openTokenPanel,
    clearTokenHistory
} from './commands/tokenPanel';
import { ErrorHintContent, ErrorInlineController, lookupErrorHint } from './commands/errorHint';
import { suggestCommitMessage } from './commands/commitHint';
import { suggestName } from './commands/nameSuggest';
import { openReflect, ReflectContent } from './commands/reflect';
import { DiffReviewContent, reviewStagedDiff } from './commands/diffReview';
import { explainPackage, PackageExplainContent, PackageExplainCache, PackageInlineController } from './commands/packageExplain';
import { findUsages, FindUsagesInlineController } from './commands/findUsages';
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

    // LLM 설정 + 토큰 절약 시스템 (조용한 백그라운드)
    const keys = new ApiKeyStore(context.secrets);
    const tracker = new TokenTrackerStore(context);
    const statusBar = new TokenStatusBar(tracker);
    tracker.onDidChange(() => statusBar.refresh());
    const config = new ConfigActions(keys);
    const codeGuide = new CodeGuideController(keys, tracker);

    // 프로젝트 맵 — Explorer 뱃지·툴팁
    const projectMap = new ProjectMapProvider();

    // 개발자 용어 사전
    const jargonStore = new CustomJargonStore(context);
    const jargonProvider = new JargonProvider(jargonStore);
    const jargonActions = new CustomJargonActions(jargonStore, () => jargonProvider.refresh());
    const jargonContent = new JargonContentProvider();
    const jargonInline = new JargonInlineController();
    const packageInline = new PackageInlineController();
    const errorInline = new ErrorInlineController();
    const usagesInline = new FindUsagesInlineController();
    const packageCache = new PackageExplainCache(context);
    // 과거 버전이 "모름" 응답을 캐시한 적이 있으면 조용히 청소 (유저 개입 불필요)
    void packageCache.pruneNoAnswers();
    const jargonView = vscode.window.createTreeView('devnavi.jargon', {
        treeDataProvider: jargonProvider,
        showCollapseAll: true
    });

    // 프로젝트 네비게이터 — 부트캠프식 체크리스트
    const naviStore = new ProjectNaviStore(context);
    const naviProvider = new ProjectNaviProvider(naviStore);
    const naviActions = new ProjectNaviActions(naviStore, keys, tracker, () => naviProvider.refresh());
    const naviView = vscode.window.createTreeView('devnavi.projectNavi', {
        treeDataProvider: naviProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(
        treeView,
        jargonView,
        naviView,
        codeGuide,
        jargonInline,
        packageInline,
        errorInline,
        usagesInline,
        projectMap,
        statusBar,
        tracker,
        vscode.workspace.registerTextDocumentContentProvider(JARGON_SCHEME, jargonContent),
        vscode.workspace.registerTextDocumentContentProvider(
            ProjectNaviHintContent.SCHEME,
            ProjectNaviHintContent.instance
        ),
        vscode.workspace.registerTextDocumentContentProvider(
            TokenPanelContent.SCHEME,
            TokenPanelContent.instance
        ),
        vscode.workspace.registerTextDocumentContentProvider(
            ErrorHintContent.SCHEME,
            ErrorHintContent.instance
        ),
        vscode.workspace.registerTextDocumentContentProvider(
            ReflectContent.SCHEME,
            ReflectContent.instance
        ),
        vscode.workspace.registerTextDocumentContentProvider(
            DiffReviewContent.SCHEME,
            DiffReviewContent.instance
        ),
        vscode.workspace.registerTextDocumentContentProvider(
            PackageExplainContent.SCHEME,
            PackageExplainContent.instance
        ),
        vscode.window.registerFileDecorationProvider(projectMap),
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file' },
            new CodeGuideActionProvider(),
            { providedCodeActionKinds: [CodeGuideActionProvider.kind] }
        ),
        // 치트시트
        vscode.commands.registerCommand('devnavi.cheatsheet.copy', (cmd: string) => copyCommand(cmd)),
        vscode.commands.registerCommand('devnavi.cheatsheet.copyItem', (node: CheatNode) => {
            if (node?.item?.command) {
                copyCommand(node.item.command);
            }
        }),
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
        // 개발자 용어 사전
        vscode.commands.registerCommand('devnavi.jargon.lookup', () => lookupJargon(jargonProvider, jargonContent, jargonInline, keys, tracker)),
        vscode.commands.registerCommand('devnavi.jargon.show', (item: JargonItem) => showJargon(jargonContent, item)),
        vscode.commands.registerCommand('devnavi.jargon.refresh', () => jargonProvider.refresh()),
        vscode.commands.registerCommand('devnavi.jargon.addCustom', () => jargonActions.add()),
        vscode.commands.registerCommand('devnavi.jargon.editCustom', (node: JargonNode) => jargonActions.edit(node)),
        vscode.commands.registerCommand('devnavi.jargon.removeCustom', (node: JargonNode) => jargonActions.remove(node)),
        vscode.commands.registerCommand('devnavi.jargon.saveAiResult', (ticket: string) =>
            saveAiResult(jargonStore, jargonProvider, ticket)
        ),
        // 프로젝트 네비게이터
        vscode.commands.registerCommand('devnavi.projectNavi.addProject', () => naviActions.addProject()),
        vscode.commands.registerCommand('devnavi.projectNavi.removeProject', (node: ProjectNaviNode) => naviActions.removeProject(node)),
        vscode.commands.registerCommand('devnavi.projectNavi.toggle', (node: ProjectNaviNode) => naviActions.toggleTask(node)),
        vscode.commands.registerCommand('devnavi.projectNavi.hint', (node: ProjectNaviNode) => naviActions.showHint(node)),
        vscode.commands.registerCommand('devnavi.projectNavi.refresh', () => naviProvider.refresh()),
        // 토큰 절약 리포트
        vscode.commands.registerCommand('devnavi.tokenPanel.open', () => openTokenPanel(tracker)),
        vscode.commands.registerCommand('devnavi.tokenPanel.clear', () =>
            clearTokenHistory(tracker, () => statusBar.refresh())
        ),
        // 에러 힌트 · 커밋 메시지 · 이름 추천
        vscode.commands.registerCommand('devnavi.errorHint.lookup', () => lookupErrorHint(keys, tracker, errorInline)),
        vscode.commands.registerCommand('devnavi.commit.suggest', () => suggestCommitMessage(keys, tracker)),
        vscode.commands.registerCommand('devnavi.name.suggest', () => suggestName(keys, tracker)),
        // 학습 회고 · 셀프 리뷰 · 패키지 설명
        vscode.commands.registerCommand('devnavi.reflect.today', () => openReflect(tracker)),
        vscode.commands.registerCommand('devnavi.diff.review', () => reviewStagedDiff(keys, tracker)),
        vscode.commands.registerCommand('devnavi.package.explain', () =>
            explainPackage(keys, tracker, packageCache, packageInline)
        ),
        vscode.commands.registerCommand('devnavi.package.clearCache', async () => {
            const cleared = await packageCache.clear();
            vscode.window.showInformationMessage(`DevNavi: 패키지 설명 캐시 ${cleared}개 비웠어.`);
        }),
        vscode.commands.registerCommand('devnavi.findUsages', () =>
            findUsages(keys, tracker, usagesInline)
        ),
        // 설정
        vscode.commands.registerCommand('devnavi.config.setApiKey', () => config.setApiKey()),
        vscode.commands.registerCommand('devnavi.config.clearApiKey', () => config.clearApiKey()),
        vscode.commands.registerCommand('devnavi.config.selectProvider', () => config.selectProvider()),
        vscode.commands.registerCommand('devnavi.config.openKeybindings', () => config.openKeybindings())
    );
}

export function deactivate() {}
