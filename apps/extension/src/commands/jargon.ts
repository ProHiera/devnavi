import * as vscode from 'vscode';
import { JargonItem, JargonProvider, JARGON_CATEGORY_LABELS } from '../providers/jargonProvider';
import { CustomJargonStore } from '../storage/customJargon';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { InlineThread } from '../utils/inlineThread';

// 용어 상세를 보여줄 가상 문서 스킴 — 마크다운 프리뷰로 렌더됨 (TreeView 클릭 경로)
export const JARGON_SCHEME = 'devnavi-jargon';

// 에디터에 인라인 스레드로 용어 설명. 페이지 전환 없음.
export class JargonInlineController extends InlineThread {
    constructor() {
        super('devnavi.jargon', 'DevNavi 용어 사전');
    }

    openForTerm(editor: vscode.TextEditor, term: string): vscode.CommentThread {
        return this.open(editor, `📖 ${term}`, `🧭 _"${term}" 찾는 중…_`);
    }
}

// TextDocumentContentProvider — uri.path = 용어 slug, 쿼리에 실제 데이터
export class JargonContentProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    // uri별 마크다운 본문 캐시
    private readonly store = new Map<string, string>();

    put(uri: vscode.Uri, markdown: string): void {
        this.store.set(uri.toString(), markdown);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.store.get(uri.toString()) ?? '_용어 정보를 불러오지 못했어._';
    }
}

// JargonItem → 마크다운 본문
function renderMarkdown(item: JargonItem): string {
    const lines: string[] = [`# 📖 ${item.term}`, ''];
    const catLabel = JARGON_CATEGORY_LABELS[item.category] ?? item.category;
    lines.push(`_${catLabel}_`, '');
    if (item.bad) {
        lines.push('## ❌ 일반 방식', '', `> ${item.bad}`, '');
    }
    if (item.good) {
        lines.push(`## ✅ ${item.term}`, '', `> ${item.good}`, '');
    }
    if (item.example) {
        lines.push('## 💡 예시', '', item.example, '');
    }
    return lines.join('\n');
}

// AI 응답(자유 텍스트) → 마크다운 (제목 + 사전 저장 버튼).
// ticket: saveAiResult 커맨드가 꺼내볼 임시 키. 버튼 클릭 시에만 해당 엔트리 사용.
function renderAIMarkdown(term: string, aiText: string, ticket?: string): string {
    const lines = [`# 📖 ${term}`, '', '_AI 설명 · 로컬 사전에 없는 용어_', '', aiText];
    if (ticket) {
        lines.push(
            '',
            '---',
            '',
            `[💾 사전에 저장해서 다음부터 토큰 0원](command:devnavi.jargon.saveAiResult?${encodeURIComponent(JSON.stringify(ticket))})`
        );
    }
    return lines.join('\n');
}

// AI 답변 보관함 — 유저가 "저장" 누르면 꺼내씀. 세션 한정, 최근 20개만 유지.
interface PendingAiResult {
    term: string;
    answer: string;
    at: number;
}
const pendingAiResults = new Map<string, PendingAiResult>();
const MAX_PENDING = 20;

function stashAiResult(term: string, answer: string): string {
    const ticket = `tk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingAiResults.set(ticket, { term, answer, at: Date.now() });
    // 오래된 것 컷
    if (pendingAiResults.size > MAX_PENDING) {
        const oldest = [...pendingAiResults.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) { pendingAiResults.delete(oldest[0]); }
    }
    return ticket;
}

// AI 마크다운(❌ 일반 방식 / ✅ 용어 / 💡 예시) → JargonItem 필드로 파싱
function parseAiMarkdown(answer: string): { bad: string; good: string; example: string } {
    const bad = extractSection(answer, /##\s*❌[^\n]*\n+>\s*(.+?)(?:\n\s*\n|\n\s*##|$)/s);
    const good = extractSection(answer, /##\s*✅[^\n]*\n+>\s*(.+?)(?:\n\s*\n|\n\s*##|$)/s);
    const example = extractSection(answer, /##\s*💡[^\n]*\n+([\s\S]+?)(?:\n\s*##|$)/s);
    return { bad, good, example };
}

function extractSection(text: string, re: RegExp): string {
    const m = text.match(re);
    return m ? m[1].trim() : '';
}

// 사전 저장 커맨드 — 인라인 스레드의 "💾 사전에 저장" 링크가 호출.
export async function saveAiResult(
    store: CustomJargonStore,
    jargon: JargonProvider,
    ticket: string
): Promise<void> {
    const pending = typeof ticket === 'string' ? pendingAiResults.get(ticket) : undefined;
    if (!pending) {
        vscode.window.showWarningMessage('DevNavi: 저장할 AI 답변을 찾지 못했어. 다시 조회해줘.');
        return;
    }

    const { term, answer } = pending;
    const parsed = parseAiMarkdown(answer);
    if (!parsed.good) {
        vscode.window.showWarningMessage('DevNavi: AI 답변 형식을 파싱하지 못했어. "용어 추가"로 직접 입력해줘.');
        return;
    }

    // 이미 같은 term이 있으면 확인
    const existing = jargon.lookup(term);
    if (existing) {
        const ok = await vscode.window.showWarningMessage(
            `"${term}"은(는) 이미 사전에 있어. 내 커스텀으로 또 추가할까?`,
            { modal: true },
            '추가'
        );
        if (ok !== '추가') { return; }
    }

    await store.add({
        term,
        bad: parsed.bad,
        good: parsed.good,
        example: parsed.example
    });
    pendingAiResults.delete(ticket);
    jargon.refresh();
    vscode.window.showInformationMessage(`DevNavi: "${term}" 사전에 저장했어. 다음부터 로컬에서 바로 뜸.`);
}

// 상세 패널 열기 — 마크다운 프리뷰 탭
async function openDetail(
    provider: JargonContentProvider,
    term: string,
    markdown: string
): Promise<void> {
    const safeSlug = encodeURIComponent(term.replace(/\s+/g, '-').toLowerCase());
    const uri = vscode.Uri.parse(`${JARGON_SCHEME}:${safeSlug}.md`);
    provider.put(uri, markdown);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

// TreeView 노드 클릭 → 상세 패널
export async function showJargon(
    provider: JargonContentProvider,
    item: JargonItem
): Promise<void> {
    await openDetail(provider, item.term, renderMarkdown(item));
}

// 에디터 우클릭 / 팔레트 "이 단어 뭐야?" — 인라인 스레드로 결과 표시.
// 활성 에디터가 없으면 마크다운 프리뷰로 fallback.
export async function lookupJargon(
    jargon: JargonProvider,
    content: JargonContentProvider,
    inline: JargonInlineController,
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const query = await resolveQuery();
    if (!query) { return; }

    const editor = vscode.window.activeTextEditor;

    const hit = jargon.lookup(query);
    if (hit) {
        // 로컬 사전 히트 = 토큰 절약. 조용히 기록만 (상태바 카운터에 반영).
        void tracker.record({
            provider: 'claude',
            model: 'local',
            feature: 'jargon.ai',
            question: normalizeQuestion(query),
            promptChars: 0,
            responseChars: 0,
            cached: true
        });
        await showResult(editor, inline, content, hit.term, renderMarkdown(hit));
        return;
    }

    // 로컬에 없음 — 비슷한 용어 제안 + AI fallback
    const suggestions = findSuggestions(jargon, query);
    const items: (vscode.QuickPickItem & { action: 'suggest' | 'ai' | 'browse'; payload?: JargonItem })[] = [];

    for (const s of suggestions) {
        items.push({
            label: `$(book) ${s.term}`,
            description: JARGON_CATEGORY_LABELS[s.category] ?? s.category,
            detail: s.good,
            action: 'suggest',
            payload: s
        });
    }
    items.push({
        label: '$(sparkle) AI에게 물어보기',
        description: `"${query}" 용어 설명을 AI로 받기`,
        action: 'ai'
    });
    items.push({
        label: '$(library) 전체 용어 둘러보기',
        description: '사이드바 DevNavi → 개발자 용어',
        action: 'browse'
    });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `"${query}" — 로컬 사전에 없어. 어떻게 할까?`,
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (!picked) { return; }

    if (picked.action === 'suggest' && picked.payload) {
        await showResult(editor, inline, content, picked.payload.term, renderMarkdown(picked.payload));
    } else if (picked.action === 'ai') {
        await askAI(editor, inline, content, keys, tracker, query);
    } else if (picked.action === 'browse') {
        await vscode.commands.executeCommand('devnavi.jargon.focus');
    }
}

// 결과 렌더링 라우터 — 에디터 있으면 인라인, 없으면 마크다운 프리뷰
async function showResult(
    editor: vscode.TextEditor | undefined,
    inline: JargonInlineController,
    content: JargonContentProvider,
    term: string,
    markdown: string
): Promise<void> {
    if (editor) {
        const thread = inline.openForTerm(editor, term);
        inline.setMarkdown(thread, markdown);
        return;
    }
    await openDetail(content, term, markdown);
}

// 선택 영역 → 없으면 InputBox.
// 드래그 선택한 구문/식별자를 그대로 사용. 너무 긴 선택(300자 초과)만 InputBox로 fallback.
async function resolveQuery(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';

    if (selected && selected.length <= 300) {
        return selected;
    }

    return vscode.window.showInputBox({
        prompt: '궁금한 개발자 용어를 입력해줘',
        placeHolder: '예: lazy loading, dependency injection, hoisting...'
    });
}

// 간단 유사 검색 — 토큰 포함 / 시작 일치 기반. 최대 3개.
function findSuggestions(jargon: JargonProvider, query: string): JargonItem[] {
    const q = query.trim().toLowerCase();
    if (!q) { return []; }

    const scored: { item: JargonItem; score: number }[] = [];
    for (const item of jargon.listAll()) {
        const haystacks = [item.term.toLowerCase(), ...item.aliases.map((a) => a.toLowerCase())];
        let best = 0;
        for (const h of haystacks) {
            if (h === q) { best = Math.max(best, 100); }
            else if (h.startsWith(q) || q.startsWith(h)) { best = Math.max(best, 60); }
            else if (h.includes(q) || q.includes(h)) { best = Math.max(best, 30); }
        }
        if (best > 0) { scored.push({ item, score: best }); }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map((s) => s.item);
}

// LLM fallback — ❌/✅ 포맷 강제. 에디터 있으면 인라인, 없으면 마크다운 프리뷰.
async function askAI(
    editor: vscode.TextEditor | undefined,
    inline: JargonInlineController,
    content: JargonContentProvider,
    keys: ApiKeyStore,
    tracker: TokenTrackerStore,
    term: string
): Promise<void> {
    let thread: vscode.CommentThread | undefined;
    let loadingUri: vscode.Uri | undefined;

    if (editor) {
        thread = inline.openForTerm(editor, term);
    } else {
        loadingUri = vscode.Uri.parse(`${JARGON_SCHEME}:loading-${Date.now()}.md`);
        content.put(loadingUri, `# 📖 ${term}\n\n🧭 _AI에게 물어보는 중…_`);
        await vscode.commands.executeCommand('markdown.showPreview', loadingUri);
    }

    try {
        const answer = await trackedAskLLM(keys, tracker, 'jargon.ai', term, [
            {
                role: 'system',
                content: [
                    '너는 DevNavi의 개발자 용어 사전이야.',
                    '한국어, 친근한 반말. 완전 초보도 한 번에 이해할 수 있게 쉬운 말로 풀어.',
                    '전문용어는 최대한 피하고, 꼭 써야 하면 바로 옆에 쉬운 말로 풀어줘.',
                    '일상 비유나 익숙한 상황에 빗대서 설명하면 좋아.',
                    '',
                    '출력 형식 — 반드시 아래 구조 그대로:',
                    '## ❌ 일반 방식',
                    '> (이 개념을 모를 때 헷갈리거나 겪는 상황 한 줄, 쉬운 말로)',
                    '',
                    `## ✅ {용어}`,
                    '> (이게 뭔지 한 줄로 쉽게. 비유 써도 좋음)',
                    '',
                    '## 💡 예시',
                    '(어디서/언제 이 개념이 쓰이는지 1~2줄로 보여줘)',
                    '',
                    '서론/사족/사과 금지. "직접 해보세요" 같은 실습 유도도 빼. 읽으면 바로 이해되는 설명만.'
                ].join('\n')
            },
            {
                role: 'user',
                content: `용어: ${term}\n\n이게 뭐야? 위 형식으로 설명해줘.`
            }
        ]);

        const ticket = stashAiResult(term, answer);
        if (thread) {
            inline.setMarkdown(thread, renderAIMarkdown(term, answer, ticket));
        } else if (loadingUri) {
            content.put(loadingUri, renderAIMarkdown(term, answer, ticket));
        }
    } catch (err) {
        if (thread) {
            inline.setError(thread, err);
            return;
        }
        let errBody: string;
        if (err instanceof NoApiKeyError) {
            errBody = `⚠️ ${err.message}\n\n팔레트에서 \`DevNavi: API 키 설정\` 실행해줘.`;
        } else if (err instanceof LLMError) {
            errBody = `⚠️ ${err.message}`;
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            errBody = `⚠️ 알 수 없는 에러 — ${msg}`;
        }
        if (loadingUri) {
            content.put(loadingUri, `# 📖 ${term}\n\n${errBody}`);
        }
    }
}
