import * as vscode from 'vscode';
import { FeatureTag, TokenRecord, TokenTrackerStore } from '../storage/tokenTracker';

// 오늘 뭐 물어봤지? — 기존 tokenTracker 데이터만 가공해서 보여줌. 토큰 0원.
const REFLECT_SCHEME = 'devnavi-reflect';

export class ReflectContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new ReflectContent();
    static readonly SCHEME = REFLECT_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private body = '';

    set(body: string): vscode.Uri {
        this.body = body;
        const uri = vscode.Uri.parse(`${REFLECT_SCHEME}:today.md`);
        this._onDidChange.fire(uri);
        return uri;
    }

    provideTextDocumentContent(): string {
        return this.body;
    }
}

export async function openReflect(tracker: TokenTrackerStore): Promise<void> {
    const records = tracker.list();
    const body = render(records);
    const uri = ReflectContent.instance.set(body);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

function render(records: TokenRecord[]): string {
    const today = records.filter((r) => isToday(r.at));
    const week = records.filter((r) => withinDays(r.at, 7));
    const dateStr = formatDate(new Date());

    if (today.length === 0) {
        return [
            `# 📚 오늘의 학습 회고 — ${dateStr}`,
            '',
            '아직 오늘 AI에 아무것도 안 물어봤네.',
            '',
            '> 뭘 물어봤는지 쌓이면, 여기서 "자주 반복한 질문"·"많이 쓴 기능"이 보여.',
            '> 같은 걸 3번 이상 물어봤으면 "외우거나 치트시트에 넣어두기" 힌트가 뜬다.'
        ].join('\n');
    }

    const todayUsed = today.filter((r) => !r.cached);
    const todaySaved = today.filter((r) => r.cached);

    const sections: string[] = [
        `# 📚 오늘의 학습 회고 — ${dateStr}`,
        '',
        '> _평소에 어떻게 배우고 있는지 하루 끝에 한 번 보는 건강검진._',
        '',
        '## 🗓️ 오늘 한 줄 요약',
        '',
        `AI에 **${todayUsed.length}번** 물었고, 로컬/캐시로 **${todaySaved.length}번** 아꼈어.`,
        ''
    ];

    // 반복 질문 — 회고의 핵심
    const repeated = topRepeated(today, 3);
    sections.push('## 🔁 오늘 반복해서 물은 것');
    sections.push('');
    if (repeated.length === 0) {
        sections.push('_오늘은 같은 질문을 두 번 이상 하지 않았어. 👍_');
    } else {
        sections.push('_같은 걸 2번 이상 물었어. **외우거나 치트시트/용어 사전에 넣어두면** 내일부턴 안 헤맬 수 있어._');
        sections.push('');
        sections.push('| # | 질문 (정규화) | 횟수 |');
        sections.push('|---:|---|---:|');
        repeated.forEach((r, i) => {
            sections.push(`| ${i + 1} | ${escapeTable(r.question) || '_(빈 질문)_'} | ${r.count} |`);
        });
    }
    sections.push('');

    // 가장 많이 쓴 기능 — 내 학습 성향 거울
    const byFeature = groupCount(today, (r) => r.feature);
    const topFeatures = [...byFeature.entries()].slice(0, 3);
    sections.push('## 🧭 오늘 가장 많이 쓴 기능');
    sections.push('');
    sections.push('| 기능 | 횟수 |');
    sections.push('|---|---:|');
    for (const [feature, count] of topFeatures) {
        sections.push(`| ${featureLabel(feature)} | ${count} |`);
    }
    sections.push('');

    // 이번 주 추세
    if (week.length > today.length) {
        const weekUsed = week.filter((r) => !r.cached).length;
        const weekSaved = week.filter((r) => r.cached).length;
        sections.push('## 📈 이번 주 (최근 7일)');
        sections.push('');
        sections.push(`- AI 호출 **${weekUsed}번** · 캐시 절약 **${weekSaved}번**`);
        const weekRepeated = topRepeated(week, 3);
        if (weekRepeated.length > 0) {
            sections.push('- 이번 주 반복 질문 TOP 3:');
            weekRepeated.forEach((r, i) => {
                sections.push(`  ${i + 1}. ${escapeTable(r.question) || '_(빈 질문)_'} — ${r.count}회`);
            });
        }
        sections.push('');
    }

    // 인사이트 — 이 문서에서 유일하게 "조언"하는 영역
    const insights = buildInsights(today, week);
    if (insights.length > 0) {
        sections.push('## 💡 힌트');
        sections.push('');
        for (const line of insights) {
            sections.push(`- ${line}`);
        }
        sections.push('');
    }

    sections.push('---', '', '[전체 토큰 리포트 보기](command:devnavi.tokenPanel.open)');
    return sections.join('\n');
}

// 오늘/이번주 기록에서 힌트 2~3줄 — 패턴 기반, 토큰 0원
function buildInsights(today: TokenRecord[], week: TokenRecord[]): string[] {
    const out: string[] = [];

    const repeatedToday = topRepeated(today, 1)[0];
    if (repeatedToday && repeatedToday.count >= 3) {
        out.push(`**"${truncate(repeatedToday.question, 50)}"** 을 오늘만 ${repeatedToday.count}번 물었어. 이건 외울 타이밍.`);
    }

    const jargonCount = today.filter((r) => r.feature === 'jargon.ai').length;
    if (jargonCount >= 5) {
        out.push(`용어 사전을 ${jargonCount}번 썼네. 이 분야 용어가 아직 낯설다는 신호 — 기초 개념부터 정리해보면 도움될 듯.`);
    }

    const errorCount = today.filter((r) => r.feature === 'errorHint.local' || r.feature === 'errorHint.ai').length;
    if (errorCount >= 3) {
        out.push(`오늘 에러 힌트를 ${errorCount}번 봤어. 같은 류의 에러면 한 번에 정리해보기.`);
    }

    const savedRatio = today.length > 0
        ? Math.round((today.filter((r) => r.cached).length / today.length) * 100)
        : 0;
    if (savedRatio >= 50 && today.length >= 4) {
        out.push(`오늘 절약률 **${savedRatio}%** — 로컬 사전/캐시가 잘 먹고 있어. 👍`);
    }

    if (week.length >= 20 && out.length === 0) {
        out.push('꾸준히 쓰고 있네. 다음 단계: 반복 질문을 치트시트·용어 사전에 직접 등록해봐.');
    }

    return out;
}

function topRepeated(records: TokenRecord[], n: number): { question: string; count: number }[] {
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
        case 'usage.ai': return '사용처 분석';
    }
}

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
    return `${n}`.padStart(2, '0');
}

function isToday(ts: number): boolean {
    const d = new Date(ts);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
}

function withinDays(ts: number, days: number): boolean {
    return Date.now() - ts < days * 24 * 60 * 60 * 1000;
}

function escapeTable(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
}
