import {
    ApiKeyStore,
    LLMProvider,
    PROVIDER_LABELS,
    getActiveModel,
    getActiveProvider
} from '../storage/apiKey';
import { FeatureTag, TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';

// 프로바이더 중립 메시지 포맷
export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class NoApiKeyError extends Error {
    constructor(public readonly provider: LLMProvider) {
        super(`${PROVIDER_LABELS[provider]} API 키가 설정되지 않았어. "DevNavi: API 키 설정"을 먼저 실행해줘.`);
    }
}

export class LLMError extends Error {
    constructor(public readonly provider: LLMProvider, message: string) {
        super(`${PROVIDER_LABELS[provider]} 호출 실패 — ${message}`);
    }
}

const MAX_TOKENS = 1024;

// 공통 진입점 — provider 어댑터로 분기
export async function askLLM(
    keys: ApiKeyStore,
    provider: LLMProvider,
    messages: LLMMessage[]
): Promise<string> {
    const apiKey = await keys.get(provider);
    if (!apiKey) { throw new NoApiKeyError(provider); }

    const model = getActiveModel(provider);

    switch (provider) {
        case 'openai': return callOpenAI(apiKey, model, messages);
        case 'claude': return callClaude(apiKey, model, messages);
        case 'gemini': return callGemini(apiKey, model, messages);
    }
}

// 추적 래퍼 — 실제 API 호출 전후로 토큰 사용량을 TokenTracker에 기록.
// 캐시 히트 경로(tracker.record({cached:true}))는 호출 지점에서 직접 기록.
export async function trackedAskLLM(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore,
    feature: FeatureTag,
    question: string,
    messages: LLMMessage[]
): Promise<string> {
    const provider = getActiveProvider();
    const model = getActiveModel(provider);
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

    const answer = await askLLM(keys, provider, messages);

    void tracker.record({
        provider,
        model,
        feature,
        question: normalizeQuestion(question),
        promptChars,
        responseChars: answer.length
    });

    return answer;
}

// -- OpenAI ------------------------------------------------------------------

async function callOpenAI(apiKey: string, model: string, messages: LLMMessage[]): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: MAX_TOKENS
        })
    });

    const data = await parseJson(res, 'openai');
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') { throw new LLMError('openai', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- Claude ------------------------------------------------------------------

async function callClaude(apiKey: string, model: string, messages: LLMMessage[]): Promise<string> {
    // Claude는 system을 별도 필드로, messages는 user/assistant만
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const chat = messages.filter((m) => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            system: systemParts.join('\n\n') || undefined,
            messages: chat.map((m) => ({ role: m.role, content: m.content }))
        })
    });

    const data = await parseJson(res, 'claude');
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') { throw new LLMError('claude', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- Gemini ------------------------------------------------------------------

async function callGemini(apiKey: string, model: string, messages: LLMMessage[]): Promise<string> {
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const chat = messages.filter((m) => m.role !== 'system');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
            contents: chat.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            })),
            generationConfig: { maxOutputTokens: MAX_TOKENS }
        })
    });

    const data = await parseJson(res, 'gemini');
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') { throw new LLMError('gemini', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- helpers -----------------------------------------------------------------

async function parseJson(res: Response, provider: LLMProvider): Promise<any> {
    const bodyText = await res.text();
    let data: any;
    try {
        data = bodyText ? JSON.parse(bodyText) : {};
    } catch {
        throw new LLMError(provider, `HTTP ${res.status} · ${bodyText.slice(0, 120)}`);
    }
    if (!res.ok) {
        const reason = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
        throw new LLMError(provider, reason);
    }
    return data;
}
