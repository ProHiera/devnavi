import * as vscode from 'vscode';
import {
    ApiKeyStore,
    LLMProvider,
    PROVIDER_LABELS,
    getActiveModel,
    getActiveProvider,
    requiresApiKey
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

// Copilot 미설치/미로그인/미동의 등 LM API 사전 조건 실패
export class CopilotUnavailableError extends Error {
    constructor(message: string) { super(message); }
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
    const model = getActiveModel(provider);

    if (provider === 'copilot') {
        return callCopilot(model, messages);
    }

    const apiKey = await keys.get(provider);
    if (!apiKey) { throw new NoApiKeyError(provider); }

    switch (provider) {
        case 'openai': return callOpenAI(apiKey, model, messages);
        case 'claude': return callClaude(apiKey, model, messages);
        case 'gemini': return callGemini(apiKey, model, messages);
    }

    // 타입 시스템 만족용 — 위 switch에서 전부 처리됨
    throw new LLMError(provider, '알 수 없는 프로바이더');
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
    const data = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
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
    }, 'openai');
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') { throw new LLMError('openai', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- Claude ------------------------------------------------------------------

async function callClaude(apiKey: string, model: string, messages: LLMMessage[]): Promise<string> {
    // Claude는 system을 별도 필드로, messages는 user/assistant만
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const chat = messages.filter((m) => m.role !== 'system');

    const data = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
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
    }, 'claude');
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') { throw new LLMError('claude', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- Gemini ------------------------------------------------------------------

async function callGemini(apiKey: string, model: string, messages: LLMMessage[]): Promise<string> {
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const chat = messages.filter((m) => m.role !== 'system');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const data = await fetchWithRetry(url, {
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
    }, 'gemini');
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') { throw new LLMError('gemini', '응답 형식이 예상과 달라'); }
    return text.trim();
}

// -- Copilot (VSCode Language Model API) -------------------------------------
// GitHub Copilot 구독을 재활용 — API 키 없이, 사용자의 Copilot 쿼터에서 차감.
// 최초 호출 시 VSCode가 "이 확장이 LM을 쓰는 거 허용?" 모달을 띄움.

async function callCopilot(modelHint: string, messages: LLMMessage[]): Promise<string> {
    if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
        throw new CopilotUnavailableError(
            'VSCode Language Model API를 쓸 수 없어. VSCode 1.90+ 이상이면서 GitHub Copilot Chat 확장이 설치·로그인돼 있어야 해.'
        );
    }

    // 후보 모델 목록 — 앞에서부터 순차 시도. 일부 모델(gpt-4o-mini 등)은
    // Copilot이 외부 확장에 차단할 수 있어서 NoPermissions 에러면 다음 후보로 넘어감.
    const candidates = await collectCopilotModels(modelHint);
    if (candidates.length === 0) {
        throw new CopilotUnavailableError(
            'Copilot Chat 모델을 찾을 수 없어. Copilot Chat 확장이 로그인돼 있는지 확인해줘.'
        );
    }

    const lmMessages = messages.map((m) => {
        // VSCode LM API는 system 역할을 별도로 받지 않음 — User 메시지에 접두어로 병합
        if (m.role === 'assistant') {
            return vscode.LanguageModelChatMessage.Assistant(m.content);
        }
        return vscode.LanguageModelChatMessage.User(m.content);
    });

    let lastErr: unknown;
    for (const model of candidates) {
        try {
            const response = await model.sendRequest(lmMessages, {}, new vscode.CancellationTokenSource().token);
            let out = '';
            for await (const chunk of response.text) {
                out += chunk;
            }
            return out.trim();
        } catch (err) {
            lastErr = err;
            // 권한/사용 불가 에러면 다음 후보 시도. 그 외는 즉시 throw.
            if (err instanceof vscode.LanguageModelError && isRetryableCopilotError(err)) {
                continue;
            }
            if (err instanceof vscode.LanguageModelError) {
                throw new LLMError('copilot', err.message || err.code || 'LM API 오류');
            }
            throw new LLMError('copilot', err instanceof Error ? err.message : String(err));
        }
    }

    // 모든 후보가 권한 거부 — 마지막 에러 메시지로 안내
    const msg = lastErr instanceof Error ? lastErr.message : 'Copilot이 사용 가능한 모델을 열어주지 않아.';
    throw new LLMError('copilot', msg);
}

// 사용 가능한 Copilot 모델 후보 목록을 모음. 중복 제거 (id 기준).
async function collectCopilotModels(modelHint: string): Promise<vscode.LanguageModelChat[]> {
    const seen = new Set<string>();
    const out: vscode.LanguageModelChat[] = [];
    // 1. 사용자가 지정/기본 family 우선 → 2. 범용 family들 → 3. 아무 copilot
    const families = [modelHint, 'gpt-4o', 'gpt-4', 'claude-3.5-sonnet', 'gpt-3.5-turbo'];
    for (const family of families) {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
        for (const m of models) {
            if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
        }
    }
    const any = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    for (const m of any) {
        if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    }
    return out;
}

// Copilot이 특정 모델을 이 확장에 차단한 경우 — 다른 후보로 넘어갈 만한 에러인지 판별
function isRetryableCopilotError(err: vscode.LanguageModelError): boolean {
    const code = err.code || '';
    const msg = err.message || '';
    return code === 'NoPermissions'
        || code === 'Blocked'
        || /cannot be used by/i.test(msg)
        || /not supported/i.test(msg);
}

// -- helpers -----------------------------------------------------------------

// 3회 시도 · 지수 백오프. 429/5xx·네트워크 오류만 재시도. 그 외 에러는 즉시 throw.
async function fetchWithRetry(url: string, init: RequestInit, provider: LLMProvider): Promise<any> {
    const delaysMs = [1000, 3000]; // 첫 시도 + 2회 재시도 = 총 3회
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        if (attempt > 0) { await sleep(delaysMs[attempt - 1]); }

        let res: Response;
        try {
            res = await fetch(url, init);
        } catch (err) {
            // 네트워크 레이어 실패 (DNS/연결 끊김 등)
            if (attempt < delaysMs.length) { continue; }
            throw new LLMError(provider, err instanceof Error ? err.message : '네트워크 오류');
        }

        if (isTransientStatus(res.status) && attempt < delaysMs.length) { continue; }
        return await parseJson(res, provider);
    }
    // 이론상 도달 불가 — 타입 시스템 만족용
    throw new LLMError(provider, '재시도 한도 초과');
}

function isTransientStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
