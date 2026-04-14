import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { buildCommitHintMessages, parseCommitSuggestions } from '../utils/prompts';

const execP = promisify(exec);

// VSCode Git extension의 SCM input에 접근 — 타입만 추림
interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly inputBox: { value: string };
}
interface GitExtensionAPI {
    repositories: GitRepository[];
}
interface GitExtension {
    getAPI(version: 1): GitExtensionAPI;
}

export async function suggestCommitMessage(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const repo = await pickRepo();
    if (!repo) { return; }

    const cwd = repo.rootUri.fsPath;
    let diff = await runGit('git diff --staged', cwd);

    if (!diff.trim()) {
        const pick = await vscode.window.showWarningMessage(
            '스테이지된 변경사항이 없어. 작업 중 변경사항으로 볼까?',
            '작업 중 변경사항 사용',
            '취소'
        );
        if (pick !== '작업 중 변경사항 사용') { return; }
        diff = await runGit('git diff', cwd);
        if (!diff.trim()) {
            vscode.window.showInformationMessage('변경사항이 없어.');
            return;
        }
    }

    try {
        const answer = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '커밋 메시지 힌트 생성 중…' },
            () => trackedAskLLM(
                keys,
                tracker,
                'commitHint.ai',
                'commit message',
                buildCommitHintMessages(diff)
            )
        );

        const suggestions = parseCommitSuggestions(answer);
        if (suggestions.length === 0) {
            vscode.window.showWarningMessage('AI 응답에서 메시지 후보를 뽑지 못했어.');
            return;
        }

        const picked = await vscode.window.showQuickPick(
            suggestions.map((s, i) => ({ label: s, description: `후보 ${i + 1}` })),
            { placeHolder: '커밋 메시지 힌트 — 고르면 SCM input에 들어가' }
        );
        if (!picked) { return; }

        repo.inputBox.value = picked.label;
        await vscode.commands.executeCommand('workbench.view.scm');
        vscode.window.setStatusBarMessage('$(check) 커밋 메시지 채워짐 — 수정 후 커밋해', 2500);
    } catch (err) {
        handleError(err);
    }
}

// 여러 저장소가 있으면 QuickPick, 하나면 바로, 없으면 안내
async function pickRepo(): Promise<GitRepository | undefined> {
    const api = getGitAPI();
    if (!api) {
        vscode.window.showErrorMessage('VSCode Git 확장이 활성화돼 있지 않아.');
        return undefined;
    }
    const repos = api.repositories;
    if (repos.length === 0) {
        vscode.window.showInformationMessage('현재 워크스페이스에 Git 저장소가 없어.');
        return undefined;
    }
    if (repos.length === 1) { return repos[0]; }

    const pick = await vscode.window.showQuickPick(
        repos.map((r) => ({ label: r.rootUri.fsPath, repo: r })),
        { placeHolder: '저장소 선택' }
    );
    return pick?.repo;
}

function getGitAPI(): GitExtensionAPI | undefined {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) { return undefined; }
    const exports = ext.isActive ? ext.exports : undefined;
    return exports?.getAPI(1);
}

async function runGit(cmd: string, cwd: string): Promise<string> {
    try {
        const { stdout } = await execP(cmd, { cwd, maxBuffer: 2 * 1024 * 1024 });
        return stdout;
    } catch {
        return '';
    }
}

function handleError(err: unknown): void {
    if (err instanceof NoApiKeyError) {
        vscode.window.showWarningMessage(err.message, 'API 키 설정').then((pick) => {
            if (pick === 'API 키 설정') {
                vscode.commands.executeCommand('devnavi.config.setApiKey');
            }
        });
        return;
    }
    const msg = err instanceof LLMError || err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`커밋 메시지 힌트 실패 — ${msg}`);
}
