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
