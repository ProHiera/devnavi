import * as vscode from 'vscode';
import { LLMProvider } from './apiKey';

// LLM 호출 한 건에 대한 기록 — 조용히 백그라운드에서 쌓임
export interface TokenRecord {
    id: string;
    at: number;                       // epoch ms
    provider: LLMProvider;
    model: string;
    feature: FeatureTag;              // 어느 기능에서 호출됐는지
    question: string;                 // 정규화된 질문 (TOP 5 계산용)
    promptChars: number;
    responseChars: number;
    cached?: boolean;                 // true면 실제 API 호출 없이 캐시에서 반환
}

export type FeatureTag =
    | 'codeGuide.explain'
    | 'codeGuide.hint'
    | 'codeGuide.reply'
    | 'jargon.ai'
    | 'projectNavi.roadmap'
    | 'projectNavi.hint'
    | 'errorHint.local'
    | 'errorHint.ai'
    | 'commitHint.ai'
    | 'nameSuggest.ai'
    | 'diffReview.ai'
    | 'packageExplain.ai'
    | 'packageExplain.cache'
    | 'usage.ai';

const STORAGE_KEY = 'devnavi.tokenRecords';
const MAX_RECORDS = 500;              // 로컬 상한 — globalState 비대화 방지

// 토큰 사용 기록 저장소 — "건강검진 리포트" 원천 데이터
export class TokenTrackerStore {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    list(): TokenRecord[] {
        return this.context.globalState.get<TokenRecord[]>(STORAGE_KEY, []);
    }

    async record(entry: Omit<TokenRecord, 'id' | 'at'>): Promise<void> {
        const record: TokenRecord = {
            ...entry,
            id: `tk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now()
        };
        const next = [...this.list(), record].slice(-MAX_RECORDS);
        await this.context.globalState.update(STORAGE_KEY, next);
        this._onDidChange.fire();
    }

    async clear(): Promise<void> {
        await this.context.globalState.update(STORAGE_KEY, []);
        this._onDidChange.fire();
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// 영문 기준 4글자 ≈ 1토큰, 한국어 2글자 ≈ 1토큰 가량을 섞은 러프 근사.
// 정확도가 중요한 게 아니라 "많이 쓰는지 vs 아닌지" 감만 주면 됨.
export function estimateTokens(chars: number): number {
    return Math.round(chars / 3);
}

// 질문 정규화 — 대소문자/공백/문장부호 제거해 유사 질문 그룹화
export function normalizeQuestion(q: string): string {
    return q
        .toLowerCase()
        .replace(/[`~!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}
