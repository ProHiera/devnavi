import * as vscode from 'vscode';

// 지원 LLM 프로바이더
export type LLMProvider = 'openai' | 'claude' | 'gemini';

export const PROVIDERS: LLMProvider[] = ['openai', 'claude', 'gemini'];

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
    openai: 'OpenAI (GPT)',
    claude: 'Anthropic (Claude)',
    gemini: 'Google (Gemini)'
};

// 프로바이더별 기본 모델 — 비용 낮은 순으로
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
    openai: 'gpt-4o-mini',
    claude: 'claude-haiku-4-5-20251001',
    gemini: 'gemini-1.5-flash'
};

// API 키는 SecretStorage에 provider별 분리 저장. globalState 절대 금지.
export class ApiKeyStore {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    get(provider: LLMProvider): Thenable<string | undefined> {
        return this.secrets.get(keyFor(provider));
    }

    set(provider: LLMProvider, key: string): Thenable<void> {
        return this.secrets.store(keyFor(provider), key);
    }

    remove(provider: LLMProvider): Thenable<void> {
        return this.secrets.delete(keyFor(provider));
    }
}

// 현재 선택된 프로바이더/모델 — settings.json의 devnavi.llm.*
export function getActiveProvider(): LLMProvider {
    const cfg = vscode.workspace.getConfiguration('devnavi.llm');
    const raw = cfg.get<string>('provider', 'claude');
    return (PROVIDERS as string[]).includes(raw) ? (raw as LLMProvider) : 'claude';
}

export function getActiveModel(provider: LLMProvider): string {
    const cfg = vscode.workspace.getConfiguration('devnavi.llm');
    const custom = cfg.get<string>('model', '').trim();
    return custom || DEFAULT_MODELS[provider];
}

function keyFor(provider: LLMProvider): string {
    return `devnavi.apiKey.${provider}`;
}
