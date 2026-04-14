import * as vscode from 'vscode';
import { JargonItem, JargonProvider, JARGON_CATEGORY_LABELS } from '../providers/jargonProvider';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';

// 용어 상세를 보여줄 가상 문서 스킴 — 마크다운 프리뷰로 렌더됨
export const JARGON_SCHEME = 'devnavi-jargon';

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

// AI 응답(자유 텍스트) → 마크다운 (제목 추가)
function renderAIMarkdown(term: string, aiText: string): string {
    return [`# 📖 ${term}`, '', '_AI 설명 · 로컬 사전에 없는 용어_', '', aiText].join('\n');
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

// 에디터 우클릭 / 팔레트 "이 단어 뭐야?"
export async function lookupJargon(
    jargon: JargonProvider,
    content: JargonContentProvider,
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const query = await resolveQuery();
    if (!query) { return; }

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
        await openDetail(content, hit.term, renderMarkdown(hit));
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
        await openDetail(content, picked.payload.term, renderMarkdown(picked.payload));
    } else if (picked.action === 'ai') {
        await askAI(content, keys, tracker, query);
    } else if (picked.action === 'browse') {
        await vscode.commands.executeCommand('devnavi.jargon.focus');
    }
}

// 선택 영역 → 없으면 InputBox
async function resolveQuery(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';

    if (selected && selected.length <= 60) {
        return selected;
    }

    return vscode.window.showInputBox({
        prompt: '궁금한 개발자 용어를 입력해줘',
        placeHolder: '예: lazy loading, 스프린트, hoisting...'
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

// LLM fallback — ❌/✅ 포맷 강제
async function askAI(
    content: JargonContentProvider,
    keys: ApiKeyStore,
    tracker: TokenTrackerStore,
    term: string
): Promise<void> {
    const loadingUri = vscode.Uri.parse(`${JARGON_SCHEME}:loading-${Date.now()}.md`);
    content.put(loadingUri, `# 📖 ${term}\n\n🧭 _AI에게 물어보는 중…_`);
    await vscode.commands.executeCommand('markdown.showPreview', loadingUri);

    try {
        const answer = await trackedAskLLM(keys, tracker, 'jargon.ai', term, [
            {
                role: 'system',
                content: [
                    '너는 DevNavi의 개발자 용어 사전이야.',
                    '한국어, 친근한 반말. 신입 개발자가 바로 이해할 수 있도록 설명해.',
                    '',
                    '출력 형식 — 반드시 아래 구조 그대로:',
                    '## ❌ 일반 방식',
                    '> (이 개념을 모를 때 생기는 상황 한 줄)',
                    '',
                    `## ✅ {용어}`,
                    '> (이 개념의 정의/해결 방식 한 줄)',
                    '',
                    '## 💡 예시',
                    '(실제 사용 사례 1~2줄)',
                    '',
                    '서론/사족/사과 금지. 핵심만.'
                ].join('\n')
            },
            {
                role: 'user',
                content: `용어: ${term}\n\n이게 뭐야? 위 형식으로 설명해줘.`
            }
        ]);

        content.put(loadingUri, renderAIMarkdown(term, answer));
    } catch (err) {
        let errBody: string;
        if (err instanceof NoApiKeyError) {
            errBody = `⚠️ ${err.message}\n\n팔레트에서 \`DevNavi: API 키 설정\` 실행해줘.`;
        } else if (err instanceof LLMError) {
            errBody = `⚠️ ${err.message}`;
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            errBody = `⚠️ 알 수 없는 에러 — ${msg}`;
        }
        content.put(loadingUri, `# 📖 ${term}\n\n${errBody}`);
    }
}
