import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { buildDiffReviewMessages } from '../utils/prompts';

const execP = promisify(exec);
const DIFF_REVIEW_SCHEME = 'devnavi-diff-review';

// VSCode Git extension — 저장소 루트만 필요
interface GitRepository { readonly rootUri: vscode.Uri; }
interface GitExtensionAPI { repositories: GitRepository[]; }
interface GitExtension { getAPI(version: 1): GitExtensionAPI; }

export class DiffReviewContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new DiffReviewContent();
    static readonly SCHEME = DIFF_REVIEW_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private readonly store = new Map<string, string>();

    put(uri: vscode.Uri, body: string): void {
        this.store.set(uri.toString(), body);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.store.get(uri.toString()) ?? '_리뷰 내용을 불러오지 못했어._';
    }
}

export async function reviewStagedDiff(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const repo = await pickRepo();
    if (!repo) { return; }

    const cwd = repo.rootUri.fsPath;
    let diff = await runGit('git diff --staged', cwd);
    let scope: 'staged' | 'working' = 'staged';

    if (!diff.trim()) {
        const pick = await vscode.window.showWarningMessage(
            '스테이지된 변경사항이 없어. 작업 중 변경사항으로 볼까?',
            '작업 중 변경사항 사용',
            '취소'
        );
        if (pick !== '작업 중 변경사항 사용') { return; }
        diff = await runGit('git diff', cwd);
        scope = 'working';
        if (!diff.trim()) {
            vscode.window.showInformationMessage('변경사항이 없어.');
            return;
        }
    }

    const localFindings = runLocalChecks(diff);

    const uri = vscode.Uri.parse(`${DIFF_REVIEW_SCHEME}:review-${Date.now()}.md`);
    DiffReviewContent.instance.put(uri, renderLoading(scope, localFindings));
    await vscode.commands.executeCommand('markdown.showPreview', uri);

    try {
        const answer = await trackedAskLLM(
            keys,
            tracker,
            'diffReview.ai',
            `diff review ${scope}`,
            buildDiffReviewMessages(diff)
        );
        DiffReviewContent.instance.put(uri, renderFull(scope, localFindings, answer));
    } catch (err) {
        DiffReviewContent.instance.put(uri, renderError(scope, localFindings, err));
    }
}

// diff의 '+' 추가된 줄에만 정규식 적용 — 토큰 0원, 결정적
interface LocalFinding {
    label: string;
    detail: string;
    severity: '⚠️' | '💡';
}

function runLocalChecks(diff: string): LocalFinding[] {
    const added = diff
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
        .map((l) => l.slice(1));

    const findings: LocalFinding[] = [];
    const checks: { pattern: RegExp; label: string; detail: string; severity: '⚠️' | '💡' }[] = [
        { pattern: /\bconsole\.(log|debug|info)\s*\(/, label: '디버그 로그 남음', detail: '`console.log` — 커밋 전 정리하거나 `console.warn/error`로 바꾸기.', severity: '⚠️' },
        { pattern: /\bprint\s*\(/, label: 'Python print 남음', detail: '`print()` — 디버깅용이었으면 지우기 or `logging` 사용.', severity: '⚠️' },
        { pattern: /\bdebugger\b/, label: 'debugger 문 남음', detail: '`debugger;` — 반드시 제거.', severity: '⚠️' },
        { pattern: /\bSystem\.out\.println\s*\(/, label: 'Java println 남음', detail: '`System.out.println` — 정식 로거(SLF4J 등) 사용 권장.', severity: '💡' },
        { pattern: /:\s*any\b/, label: 'TypeScript `any` 사용', detail: '`: any` — 구체 타입이나 `unknown`으로 좁힐 수 있는지 확인.', severity: '💡' },
        { pattern: /@ts-(ignore|expect-error|nocheck)/, label: 'TS 체크 비활성화', detail: '`@ts-ignore` 등 — 왜 필요한지 주석에 이유 남기기.', severity: '💡' },
        { pattern: /\b(TODO|FIXME|XXX|HACK)\b/, label: 'TODO/FIXME 주석 남음', detail: '나중에 하려고 표시한 주석 — 이 커밋에서 같이 해결할 수 있으면 해결.', severity: '💡' },
        { pattern: /(password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]\w{6,}/i, label: '하드코딩 시크릿 의심', detail: '비밀값이 코드에 박힌 것처럼 보여 — `.env` · SecretStorage로 이동.', severity: '⚠️' },
        { pattern: /^\s*\.only\s*\(|\bit\.only\b|\bdescribe\.only\b/, label: '테스트 `.only` 남음', detail: '`.only` — 전체 테스트가 안 돌아. 지우고 올리기.', severity: '⚠️' },
        { pattern: /<<<<<<<|=======|>>>>>>>/, label: '머지 충돌 마커 남음', detail: '충돌 마커 — 반드시 제거.', severity: '⚠️' }
    ];

    const seen = new Set<string>();
    for (const line of added) {
        for (const c of checks) {
            if (seen.has(c.label)) { continue; }
            if (c.pattern.test(line)) {
                findings.push({ label: c.label, detail: c.detail, severity: c.severity });
                seen.add(c.label);
            }
        }
    }
    return findings;
}

// -- 렌더링 --------------------------------------------------------------

function renderLocalSection(findings: LocalFinding[]): string[] {
    const parts: string[] = ['## 🔎 로컬 점검', ''];
    if (findings.length === 0) {
        parts.push('_눈에 띄는 자국 없음. 👍 (`console.log` · `TODO` · 충돌 마커 · 하드코딩 시크릿 등)_');
    } else {
        parts.push('| | 항목 | 확인 |');
        parts.push('|:---:|---|---|');
        for (const f of findings) {
            parts.push(`| ${f.severity} | **${f.label}** | ${f.detail} |`);
        }
    }
    parts.push('');
    return parts;
}

function renderLoading(scope: 'staged' | 'working', findings: LocalFinding[]): string {
    return [
        `# 🧐 커밋 전 셀프 리뷰`,
        '',
        `_대상: ${scope === 'staged' ? '스테이지된 변경사항' : '작업 중 변경사항'}_`,
        '',
        ...renderLocalSection(findings),
        '## 🤖 AI 리뷰',
        '',
        '_AI가 변경 의도·점검 포인트 분석 중…_'
    ].join('\n');
}

function renderFull(scope: 'staged' | 'working', findings: LocalFinding[], answer: string): string {
    return [
        `# 🧐 커밋 전 셀프 리뷰`,
        '',
        `_대상: ${scope === 'staged' ? '스테이지된 변경사항' : '작업 중 변경사항'}_`,
        '',
        ...renderLocalSection(findings),
        answer,
        '',
        '---',
        '',
        '[커밋 메시지 힌트 받기](command:devnavi.commit.suggest)'
    ].join('\n');
}

function renderError(scope: 'staged' | 'working', findings: LocalFinding[], err: unknown): string {
    let msg: string;
    if (err instanceof NoApiKeyError) {
        msg = `⚠️ ${err.message}`;
    } else if (err instanceof LLMError) {
        msg = `⚠️ ${err.message}`;
    } else {
        msg = `⚠️ ${err instanceof Error ? err.message : String(err)}`;
    }
    return [
        `# 🧐 커밋 전 셀프 리뷰`,
        '',
        `_대상: ${scope === 'staged' ? '스테이지된 변경사항' : '작업 중 변경사항'}_`,
        '',
        ...renderLocalSection(findings),
        '## 🤖 AI 리뷰',
        '',
        msg
    ].join('\n');
}

// -- Git API 공통 헬퍼 -----------------------------------------------------

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
