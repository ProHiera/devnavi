import * as vscode from 'vscode';
import {
    FeatureTag,
    TokenRecord,
    TokenTrackerStore,
    estimateTokens
} from '../storage/tokenTracker';

// 조용한 상태바 — "🪙 절약 N회" 정도. 클릭하면 상세 패널.
export class TokenStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private disposed = false;

    constructor(private readonly tracker: TokenTrackerStore) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        this.item.command = 'devnavi.tokenPanel.open';
        this.item.name = 'DevNavi 토큰 절약';
        this.refresh();
        this.item.show();
    }

    refresh(): void {
        if (this.disposed) { return; }
        const records = this.tracker.list();
        const savedToday = records.filter((r) => r.cached && isToday(r.at)).length;
        const usedToday = records.filter((r) => !r.cached && isToday(r.at)).length;

        if (records.length === 0) {
            this.item.text = '$(sparkle) DevNavi';
            this.item.tooltip = '아직 AI 호출 기록이 없어.';
            return;
        }

        this.item.text = savedToday > 0
            ? `$(symbol-misc) 절약 ${savedToday}회`
            : `$(symbol-misc) AI ${usedToday}회`;
        this.item.tooltip = buildStatusTooltip(savedToday, usedToday, records.length);
    }

    dispose(): void {
        this.disposed = true;
        this.item.dispose();
    }
}

function buildStatusTooltip(saved: number, used: number, total: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**DevNavi · 오늘의 사용량**\n\n`);
    md.appendMarkdown(`- AI 호출: ${used}회\n`);
    md.appendMarkdown(`- 캐시/로컬로 절약: ${saved}회\n`);
    md.appendMarkdown(`- 누적 기록: ${total}건\n\n`);
    md.appendMarkdown(`[자세히 보기](command:devnavi.tokenPanel.open)`);
    return md;
}

function isToday(ts: number): boolean {
    const d = new Date(ts);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
}

// -- 상세 패널 (마크다운 프리뷰) -----------------------------------------

const TOKEN_SCHEME = 'devnavi-token';

export class TokenPanelContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new TokenPanelContent();
    static readonly SCHEME = TOKEN_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private body = '';

    set(body: string): vscode.Uri {
        this.body = body;
        const uri = vscode.Uri.parse(`${TOKEN_SCHEME}:report.md`);
        this._onDidChange.fire(uri);
        return uri;
    }

    provideTextDocumentContent(): string {
        return this.body;
    }
}

// 패널 열기 — 리포트 렌더링
export async function openTokenPanel(tracker: TokenTrackerStore): Promise<void> {
    const records = tracker.list();
    const report = renderReport(records);
    const uri = TokenPanelContent.instance.set(report);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

// 기록 초기화
export async function clearTokenHistory(
    tracker: TokenTrackerStore,
    onChange: () => void
): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        '토큰 사용 기록을 전부 지울까?',
        { modal: true },
        '삭제'
    );
    if (confirm !== '삭제') { return; }
    await tracker.clear();
    onChange();
    vscode.window.setStatusBarMessage('$(sparkle) 토큰 기록 초기화됨', 1500);
}

// -- 리포트 렌더링 -------------------------------------------------------

// 주요 모델별 1M 토큰당 가격 (USD) — input/output 분리. 러프 근사.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
    'gpt-4o': { in: 2.5, out: 10.0 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'claude-opus-4-6': { in: 15.0, out: 75.0 },
    'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
    'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
    'gemini-1.5-flash': { in: 0.075, out: 0.3 },
    'gemini-1.5-pro': { in: 1.25, out: 5.0 }
};

// 누적 사용량·절약·반복 질문·비용 비교를 한 문서로
function renderReport(records: TokenRecord[]): string {
    if (records.length === 0) {
        return [
            '# 🪙 DevNavi 토큰 리포트',
            '',
            '아직 AI 호출이 없어. 코드 가이드·용어 사전·프로젝트 네비를 써보면 여기 쌓여.'
        ].join('\n');
    }

    const today = records.filter((r) => isToday(r.at));
    const week = records.filter((r) => withinDays(r.at, 7));
    const used = records.filter((r) => !r.cached);
    const cached = records.filter((r) => r.cached);

    const totalInTokens = sum(used.map((r) => estimateTokens(r.promptChars)));
    const totalOutTokens = sum(used.map((r) => estimateTokens(r.responseChars)));

    const sections = [
        '# 🪙 DevNavi 토큰 리포트',
        '',
        '> _조용한 백그라운드 리포트 — 평소엔 안 보이고, 궁금할 때만._',
        '',
        '## 📊 사용량 요약',
        '',
        '| 구간 | AI 호출 | 캐시/로컬 절약 |',
        '|---|---:|---:|',
        `| 오늘 | ${today.filter((r) => !r.cached).length}회 | ${today.filter((r) => r.cached).length}회 |`,
        `| 최근 7일 | ${week.filter((r) => !r.cached).length}회 | ${week.filter((r) => r.cached).length}회 |`,
        `| 누적 | ${used.length}회 | ${cached.length}회 |`,
        '',
        `- 누적 입력 토큰 (추정): **${totalInTokens.toLocaleString()}**`,
        `- 누적 출력 토큰 (추정): **${totalOutTokens.toLocaleString()}**`,
        ''
    ];

    // 반복 질문 TOP 5 — 토큰 절약 철학의 핵심
    const repeated = topRepeatedQuestions(used, 5);
    if (repeated.length > 0) {
        sections.push(
            '## 🔁 자주 반복하는 질문 TOP 5',
            '',
            '_같은 걸 자꾸 물어봤다면, 외우거나 치트시트/용어 사전에 등록해두면 어떨까?_',
            '',
            '| # | 질문 (정규화) | 횟수 |',
            '|---:|---|---:|'
        );
        repeated.forEach((r, i) => {
            sections.push(`| ${i + 1} | ${escapeTable(r.question) || '_(빈 질문)_'} | ${r.count} |`);
        });
        sections.push('');
    }

    // 기능별 분포
    const byFeature = groupCount(records, (r) => r.feature);
    sections.push(
        '## 🧭 기능별 호출 분포',
        '',
        '| 기능 | 전체 | 캐시 |',
        '|---|---:|---:|'
    );
    for (const [feature, count] of byFeature) {
        const cachedHits = records.filter((r) => r.feature === feature && r.cached).length;
        sections.push(`| ${featureLabel(feature)} | ${count} | ${cachedHits} |`);
    }
    sections.push('');

    // 모델별 비용 비교 (현재 누적 기준)
    sections.push(
        '## 💸 "만약 이 모델로 썼다면?" 비용 비교',
        '',
        `_누적 ${totalInTokens.toLocaleString()} in / ${totalOutTokens.toLocaleString()} out 토큰 기준 추정. 환율 1,400원/$._`,
        '',
        '| 모델 | 입력 | 출력 | 합계 (USD) | ≈ 원화 |',
        '|---|---:|---:|---:|---:|'
    );
    for (const [model, p] of Object.entries(MODEL_PRICING)) {
        const cost = (totalInTokens / 1_000_000) * p.in + (totalOutTokens / 1_000_000) * p.out;
        const krw = Math.round(cost * 1400);
        sections.push(
            `| ${model} | $${p.in.toFixed(2)} | $${p.out.toFixed(2)} | $${cost.toFixed(4)} | ₩${krw.toLocaleString()} |`
        );
    }
    sections.push('');

    // 최근 호출 10건
    const recent = records.slice(-10).reverse();
    sections.push(
        '## 🕒 최근 호출 (최신 10건)',
        '',
        '| 시각 | 기능 | 모델 | 캐시 |',
        '|---|---|---|:---:|'
    );
    for (const r of recent) {
        const ts = new Date(r.at);
        const hh = `${ts.getHours()}`.padStart(2, '0');
        const mm = `${ts.getMinutes()}`.padStart(2, '0');
        const date = `${ts.getMonth() + 1}/${ts.getDate()} ${hh}:${mm}`;
        sections.push(`| ${date} | ${featureLabel(r.feature)} | ${r.model} | ${r.cached ? '✅' : ''} |`);
    }
    sections.push('');

    sections.push('---', '', '[기록 초기화](command:devnavi.tokenPanel.clear)');
    return sections.join('\n');
}

function topRepeatedQuestions(records: TokenRecord[], n: number): { question: string; count: number }[] {
    const map = new Map<string, number>();
    for (const r of records) {
        if (!r.question) { continue; }
        map.set(r.question, (map.get(r.question) ?? 0) + 1);
    }
    return [...map.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([question, count]) => ({ question, count }));
}

function groupCount<T, K>(items: T[], key: (t: T) => K): Map<K, number> {
    const map = new Map<K, number>();
    for (const item of items) {
        const k = key(item);
        map.set(k, (map.get(k) ?? 0) + 1);
    }
    return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function featureLabel(tag: FeatureTag): string {
    switch (tag) {
        case 'codeGuide.explain': return '코드 가이드 · 설명';
        case 'codeGuide.hint': return '코드 가이드 · 힌트';
        case 'codeGuide.reply': return '코드 가이드 · 답글';
        case 'jargon.ai': return '용어 사전';
        case 'projectNavi.roadmap': return '프로젝트 네비 · 로드맵';
        case 'projectNavi.hint': return '프로젝트 네비 · 힌트';
        case 'errorHint.local': return '에러 힌트 · 로컬';
        case 'errorHint.ai': return '에러 힌트 · AI';
        case 'commitHint.ai': return '커밋 메시지 힌트';
        case 'nameSuggest.ai': return '이름 추천';
        case 'diffReview.ai': return '셀프 리뷰';
        case 'packageExplain.ai': return '패키지 설명 · AI';
        case 'packageExplain.cache': return '패키지 설명 · 캐시';
    }
}

function escapeTable(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function sum(nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0);
}

function withinDays(ts: number, days: number): boolean {
    return Date.now() - ts < days * 24 * 60 * 60 * 1000;
}
