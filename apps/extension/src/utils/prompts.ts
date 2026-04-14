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
