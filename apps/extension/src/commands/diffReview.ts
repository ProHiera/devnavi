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
        { pattern: /\bconsole\.(log|debug|info)\s*\(/, label: '확인용 출력이 남아 있어', detail: '`console.log` — 확인하려고 넣은 거라면 올리기 전에 지워.', severity: '⚠️' },
        { pattern: /\bprint\s*\(/, label: '확인용 print가 남아 있어', detail: '`print()` — 확인하려고 넣은 거라면 지워.', severity: '⚠️' },
        { pattern: /\bdebugger\b/, label: '멈춤 표시가 남아 있어', detail: '`debugger;` — 프로그램을 멈추게 하는 표시야. 꼭 지워.', severity: '⚠️' },
        { pattern: /\bSystem\.out\.println\s*\(/, label: '확인용 출력이 남아 있어', detail: '`System.out.println` — 확인하려고 넣은 거라면 지워.', severity: '💡' },
        { pattern: /:\s*any\b/, label: '아무 종류나 받는 `any`', detail: '`: any` — 숫자인지 글자인지 정확한 종류를 적어 주면 실수를 더 잘 잡아.', severity: '💡' },
        { pattern: /@ts-(ignore|expect-error|nocheck)/, label: '검사를 끈 표시가 있어', detail: '`@ts-ignore` — 오류 검사를 꺼 둔 거야. 왜 껐는지 메모를 남겨.', severity: '💡' },
        { pattern: /\b(TODO|FIXME|XXX|HACK)\b/, label: '"나중에 하기" 메모가 있어', detail: '`TODO` — 지금 같이 끝낼 수 있으면 끝내고 올려.', severity: '💡' },
        { pattern: /(password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]\w{6,}/i, label: '비밀번호가 코드에 적힌 것 같아', detail: '비밀번호나 키가 그대로 적혀 있으면 남이 볼 수 있어. `.env` 파일로 옮겨.', severity: '⚠️' },
        { pattern: /^\s*\.only\s*\(|\bit\.only\b|\bdescribe\.only\b/, label: '검사 하나만 돌게 해 뒀어', detail: '`.only` — 이게 있으면 나머지 검사가 안 돌아. 지우고 올려.', severity: '⚠️' },
        { pattern: /<<<<<<<|=======|>>>>>>>/, label: '합치다 남은 표시가 있어', detail: '`<<<<<<<` 같은 표시 — 두 코드를 합치다 남은 거야. 꼭 정리해.', severity: '⚠️' }
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
        parts.push('_깔끔해! 👍 확인용 출력·"나중에 하기" 메모·비밀번호 같은 게 안 보여._');
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
