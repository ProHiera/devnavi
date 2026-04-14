import { LLMMessage } from './llm';

// 첫 트리거 종류 + 후속 답글
export type GuideMode = 'explain' | 'hint' | 'reply';

// 시스템 공통 규칙 — 톤 / 간결성만
const BASE_SYSTEM = [
    '너는 DevNavi의 코드 가이드야. 신입 개발자가 Copilot 등 AI로 짜인 코드를 이해하도록 돕는 역할.',
    '',
    '공통 규칙:',
    '- 한국어, 친근한 반말.',
    '- 마크다운 OK. 핵심만 간결하게. 서론·사족·사과·재확인 금지.',
    '- 코드가 필요하면 한두 줄 스니펫 정도. 전체 수정본으로 도배하지 말 것.'
].join('\n');

// 모드별 지시
const MODE_INSTRUCTION: Record<GuideMode, string> = {
    explain: [
        '',
        '이번 요청: "이게 뭐야?"',
        '- 이 코드가 무엇을 하는지 쉬운 말로 짧게 풀어줘.',
        '- 핵심 개념 1~2가지 이름만 짚어주고, 유저가 더 파보게.',
        '- 마지막에 "직접 만져볼 포인트" 1~2개를 힌트로.'
    ].join('\n'),

    hint: [
        '',
        '이번 요청: "힌트만 줘"',
        '- 완성 답(동작 코드) 금지. 방향/힌트만.',
        '- 유저가 스스로 생각해볼 질문 2~3개 + "다음에 확인할 포인트".',
        '- 스스로 풀어낼 기회를 뺏지 말 것.'
    ].join('\n'),

    reply: [
        '',
        '이번 요청: 유저가 스레드에서 후속 질문한 상태.',
        '- 유저가 궁금한 걸 **직접 답해줘**. 힌트만 고집하지 마.',
        '- 위 맥락의 "답 금지" 지시가 있었어도 이 답글 턴부턴 직접 답 OK.',
        '- 필요하면 한두 줄 코드 스니펫. 전체 수정본은 여전히 피해.',
        '- 질문에 정확히, 간결하게.'
    ].join('\n')
};

export interface HistoryTurn {
    role: 'user' | 'assistant';
    content: string;
}

// 스레드 전체를 한 번에 조립 — 후속 답글도 동일 진입점
export function buildMessages(
    mode: GuideMode,
    code: string,
    language: string,
    initialQuestion: string,
    history: HistoryTurn[] = []
): LLMMessage[] {
    const system = BASE_SYSTEM + MODE_INSTRUCTION[mode];

    const contextBlock = [
        `언어: ${language || '알수없음'}`,
        '선택한 코드:',
        '```' + (language || ''),
        code,
        '```',
        '',
        `첫 질문: ${initialQuestion}`
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: contextBlock },
        ...history.map<LLMMessage>((h) => ({ role: h.role, content: h.content }))
    ];
}

// -- 프로젝트 네비게이터 (부트캠프식 로드맵) -------------------------------

export interface RoadmapPhaseSpec {
    name: string;
    tasks: string[];
}

// 프로젝트 목표 한 줄 → Phase별 체크리스트 JSON
export function buildRoadmapMessages(goal: string): LLMMessage[] {
    const system = [
        '너는 신입 개발자를 위한 부트캠프 멘토야. DevNavi 프로젝트 네비게이터 역할.',
        '',
        '유저가 만들고 싶은 프로젝트를 한 줄로 설명하면, 부트캠프 커리큘럼처럼',
        'Phase별 체크리스트를 만들어줘. 다음 규칙을 지켜:',
        '- Phase 3~5개. 각 Phase는 한 번에 해낼 수 있는 단위 (프로젝트 세팅 / 기본 UI / 상태 관리 / 스타일링 / 배포 등).',
        '- 각 Phase에 태스크 3~6개. 태스크는 구체적이고 체크 가능한 단위로.',
        '- 이름은 짧고 동사형. 예: "할일 입력 컴포넌트 만들기", "로컬스토리지 저장".',
        '- 태스크는 "답" 금지. "뭘 할지"만 적어. 힌트는 나중에 따로 요청됨.',
        '',
        '출력: 반드시 아래 JSON만. 마크다운 코드블록도 붙이지 말고 순수 JSON.',
        '{"phases":[{"name":"...","tasks":["...","..."]}]}'
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: `프로젝트 목표: ${goal}` }
    ];
}

// AI 응답 문자열에서 JSON 블록만 안전하게 파싱
export function parseRoadmap(raw: string): RoadmapPhaseSpec[] {
    const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '')
        .trim();

    const parsed = JSON.parse(cleaned);
    const phases = Array.isArray(parsed?.phases) ? parsed.phases : [];
    return phases
        .map((p: unknown): RoadmapPhaseSpec | null => {
            if (typeof p !== 'object' || p === null) { return null; }
            const obj = p as Record<string, unknown>;
            const name = typeof obj.name === 'string' ? obj.name : '';
            const tasks = Array.isArray(obj.tasks)
                ? obj.tasks.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                : [];
            if (!name || tasks.length === 0) { return null; }
            return { name, tasks };
        })
        .filter((p: RoadmapPhaseSpec | null): p is RoadmapPhaseSpec => p !== null);
}

// -- 에러 힌트 (로컬 사전에 없을 때 fallback) -----------------------------

export function buildErrorHintMessages(errorText: string): LLMMessage[] {
    const system = [
        '너는 DevNavi의 에러 멘토야. 신입 개발자가 에러를 만났을 때 도와주는 역할.',
        '',
        '규칙:',
        '- 한국어, 친근한 반말. 마크다운 OK.',
        '- 답(완성 코드) 금지. "여기가 문제야, 이렇게 생각해봐" 방향만.',
        '- 포맷을 지켜:',
        '  ## 🎯 원인',
        '  > (한 줄 요약)',
        '  ## 💡 확인해볼 것',
        '  (불릿 3~5개. 실제 확인/시도할 것)',
        '- 답을 통째로 주지 말고, 유저가 직접 고쳐볼 힌트만.'
    ].join('\n');

    const trimmed = errorText.trim().slice(0, 4000);
    return [
        { role: 'system', content: system },
        { role: 'user', content: `다음 에러가 났어. 힌트 줘.\n\n\`\`\`\n${trimmed}\n\`\`\`` }
    ];
}

// -- 커밋 메시지 힌트 -----------------------------------------------------

export function buildCommitHintMessages(diff: string): LLMMessage[] {
    const system = [
        '너는 DevNavi의 커밋 메시지 힌트 봇이야.',
        '',
        '유저의 스테이지된 변경사항(diff)을 보고 **커밋 메시지 후보 3개**를 제시해.',
        '규칙:',
        '- Conventional Commits 스타일. `feat(scope): ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...` 등.',
        '- 한 줄 50자 이내, 한국어 동사형. 예: `feat(cheatsheet): add custom commands CRUD`',
        '- 3개 후보를 서로 다른 관점에서 (더 구체적 / 더 일반적 / 다른 scope).',
        '',
        '출력 포맷 — 정확히 3줄, 번호/불릿/코드블록/설명 없이 메시지만:',
        'feat(foo): ...',
        'fix(bar): ...',
        'refactor(baz): ...'
    ].join('\n');

    const trimmed = diff.slice(0, 8000);
    return [
        { role: 'system', content: system },
        { role: 'user', content: `변경사항:\n\`\`\`diff\n${trimmed}\n\`\`\`` }
    ];
}

// AI 응답 → 커밋 메시지 후보 배열
export function parseCommitSuggestions(raw: string): string[] {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^`+|`+$/g, '').trim())
        .filter((line) => line.length > 0 && line.length < 200)
        .slice(0, 5);
}

// -- 이름 추천 ------------------------------------------------------------

export function buildNameSuggestMessages(
    selected: string,
    surrounding: string,
    language: string
): LLMMessage[] {
    const system = [
        '너는 DevNavi의 이름 추천 봇. 변수/함수/클래스에 어울리는 이름 후보를 제시해.',
        '',
        '규칙:',
        '- 영어 식별자 5개. 해당 언어의 관용 표기 (JS/TS: camelCase, Python: snake_case, 타입/클래스: PascalCase).',
        '- 각 이름은 의미가 명확하고 검색 가능해야 해 (`data`, `temp`, `foo` 같은 모호한 이름 금지).',
        '- 부울이면 `is/has/can` 접두사 고려, 배열이면 복수형, 함수면 동사 시작.',
        '',
        '출력 포맷 — 정확히 5줄, 설명/번호/따옴표/코드블록 없이 이름만:',
        'suggestedName1',
        'suggestedName2',
        '...'
    ].join('\n');

    const context = surrounding.slice(0, 2000);
    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: [
                `언어: ${language || '알수없음'}`,
                `현재 이름/식별자: ${selected}`,
                '',
                '주변 코드 맥락:',
                '```' + (language || ''),
                context,
                '```',
                '',
                '더 좋은 이름 5개 추천해줘.'
            ].join('\n')
        }
    ];
}

export function parseNameSuggestions(raw: string): string[] {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^`+|`+$/g, '').replace(/[`"',;]+/g, '').trim())
        .filter((line) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(line))
        .slice(0, 5);
}

// -- Diff 셀프 리뷰 -------------------------------------------------------

export function buildDiffReviewMessages(diff: string): LLMMessage[] {
    const system = [
        '너는 DevNavi의 커밋 전 셀프 리뷰 봇이야.',
        '',
        '유저의 스테이지된 변경사항(diff)을 신입이 PR 올리기 전에 스스로 점검할 수 있게 리뷰해.',
        '규칙:',
        '- 한국어, 친근한 반말. 마크다운 OK.',
        '- 답(수정된 코드) 주지 말고, "이거 의도 맞아?" 질문형·체크리스트 형태로.',
        '- 포맷을 정확히 지켜:',
        '  ## 🎯 이 변경 한 줄 요약',
        '  > (변경 의도를 한 줄로)',
        '  ## 🔍 점검 포인트',
        '  (불릿 3~5개. 놓치기 쉬운 것·이상한 것·이 변경이 깨뜨릴 수 있는 것)',
        '  ## ❓ 커밋 전 스스로에게 물어볼 것',
        '  (불릿 2~3개. 의도 확인용 질문)',
        '- 정답 말고 방향·질문만.'
    ].join('\n');

    const trimmed = diff.slice(0, 8000);
    return [
        { role: 'system', content: system },
        { role: 'user', content: `변경사항:\n\`\`\`diff\n${trimmed}\n\`\`\`` }
    ];
}

// -- 패키지 설명 ---------------------------------------------------------

export function buildPackageExplainMessages(pkg: string, ecosystem: string): LLMMessage[] {
    const system = [
        '너는 DevNavi의 패키지 설명 봇이야.',
        '',
        `신입 개발자가 ${ecosystem} 프로젝트에서 의존성 이름 하나를 물어보면,`,
        '그 라이브러리가 뭐하는 건지 3~5줄로 쉬운 말로 설명해.',
        '',
        '규칙:',
        '- 한국어, 친근한 반말. 마크다운 OK.',
        '- 포맷을 정확히 지켜:',
        '  ## 📦 (패키지명)',
        '  > (한 줄 요약: "이게 뭐하는 거")',
        '  ## 💡 언제 써',
        '  (2~3줄. 대표 유스케이스)',
        '  ## 🔄 대안 / 관련',
        '  (비슷한 라이브러리 2~3개를 콤마로. 예: `axios`, `ky`)',
        '- 모르는 패키지면 솔직히 "잘 모르겠어, npm/pypi에서 직접 찾아봐"라고.'
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: `패키지 이름: ${pkg}` }
    ];
}

// 태스크 한 개에 대한 힌트 요청 — 답 금지, 방향만
export function buildTaskHintMessages(
    projectGoal: string,
    phaseName: string,
    taskName: string
): LLMMessage[] {
    const system = [
        '너는 DevNavi 프로젝트 네비게이터의 멘토야.',
        '',
        '유저가 체크리스트 태스크 하나를 클릭해서 "어떻게 해?"라고 묻는 상황이야.',
        '아래 규칙으로 힌트만 줘:',
        '- 한국어, 친근한 반말. 마크다운 OK.',
        '- 완성 코드 금지. 방향/생각할 점/확인할 키워드만.',
        '- 3~6줄 정도. 불릿 리스트 OK.',
        '- "먼저 ~을 알아봐 / 다음엔 ~을 확인해봐" 식으로 단계 암시.',
        '- 답을 주지 말고, 유저가 구글/공식문서에서 파볼 키워드를 심어줘.'
    ].join('\n');

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: [
                `프로젝트 목표: ${projectGoal}`,
                `현재 Phase: ${phaseName}`,
                `이 태스크: ${taskName}`,
                '',
                '이거 어떻게 해?'
            ].join('\n')
        }
    ];
}
