import * as vscode from 'vscode';
import errorsData from '../data/errors.json';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { buildErrorHintMessages } from '../utils/prompts';

// 흔한 에러 패턴 사전 — 로컬 우선, 없으면 AI fallback
interface ErrorPattern {
    pattern: string;     // 정규식 소스
    title: string;
    explain: string;
    hint: string;
}

const ERROR_SCHEME = 'devnavi-error';

const PATTERNS: ErrorPattern[] = errorsData as ErrorPattern[];

export class ErrorHintContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new ErrorHintContent();
    static readonly SCHEME = ERROR_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private readonly store = new Map<string, string>();

    put(uri: vscode.Uri, body: string): void {
        this.store.set(uri.toString(), body);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.store.get(uri.toString()) ?? '_에러 정보를 불러오지 못했어._';
    }
}

export async function lookupErrorHint(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const errorText = await resolveErrorText();
    if (!errorText) { return; }

    // 로컬 매칭 먼저 — 토큰 0원
    const hit = matchLocal(errorText);
    if (hit) {
        void tracker.record({
            provider: 'claude',
            model: 'local',
            feature: 'errorHint.local',
            question: normalizeQuestion(errorText.slice(0, 200)),
            promptChars: 0,
            responseChars: 0,
            cached: true
        });
        await openPreview(renderLocal(hit, errorText));
        return;
    }

    // AI fallback
    const uri = vscode.Uri.parse(`${ERROR_SCHEME}:loading-${Date.now()}.md`);
    ErrorHintContent.instance.put(uri, '# 🧭 에러 힌트\n\n_AI가 분석 중…_');
    await vscode.commands.executeCommand('markdown.showPreview', uri);

    try {
        const answer = await trackedAskLLM(
            keys,
            tracker,
            'errorHint.ai',
            errorText.slice(0, 200),
            buildErrorHintMessages(errorText)
        );
        ErrorHintContent.instance.put(uri, renderAI(errorText, answer));
    } catch (err) {
        ErrorHintContent.instance.put(uri, renderError(errorText, err));
    }
}

// 에디터 선택 → 클립보드 → InputBox 순
async function resolveErrorText(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
        const text = editor.document.getText(editor.selection).trim();
        if (text) { return text; }
    }

    const clipboard = (await vscode.env.clipboard.readText()).trim();
    if (clipboard && clipboard.length > 20 && looksLikeError(clipboard)) {
        const useClipboard = await vscode.window.showQuickPick(
            [
                { label: '$(clippy) 클립보드 내용 사용', value: 'clip' },
                { label: '$(edit) 직접 붙여넣기', value: 'input' }
            ],
            { placeHolder: `클립보드에 에러 같은 내용 있어 (${clipboard.length}자)` }
        );
        if (!useClipboard) { return undefined; }
        if (useClipboard.value === 'clip') { return clipboard; }
    }

    return vscode.window.showInputBox({
        prompt: '분석할 에러 메시지를 붙여넣어줘',
        placeHolder: 'Error: Cannot find module ...'
    });
}

function looksLikeError(s: string): boolean {
    return /error|exception|fail|cannot|undefined|null|TypeError|SyntaxError|ENOENT|EADDRINUSE/i.test(s);
}

function matchLocal(errorText: string): ErrorPattern | undefined {
    for (const p of PATTERNS) {
        try {
            if (new RegExp(p.pattern, 'i').test(errorText)) { return p; }
        } catch {
            // 잘못된 정규식은 스킵
        }
    }
    return undefined;
}

function renderLocal(p: ErrorPattern, errorText: string): string {
    return [
        `# 🧭 ${p.title}`,
        '',
        '_로컬 사전 매칭 · 토큰 0원_',
        '',
        '## 🎯 원인',
        '',
        `> ${p.explain}`,
        '',
        '## 💡 확인해볼 것',
        '',
        p.hint,
        '',
        '---',
        '',
        '<details><summary>원본 에러</summary>',
        '',
        '```',
        errorText.slice(0, 1500),
        '```',
        '',
        '</details>'
    ].join('\n');
}

function renderAI(errorText: string, answer: string): string {
    return [
        `# 🧭 에러 힌트`,
        '',
        '_로컬 사전에 없어서 AI에 물어봤어_',
        '',
        answer,
        '',
        '---',
        '',
        '<details><summary>원본 에러</summary>',
        '',
        '```',
        errorText.slice(0, 1500),
        '```',
        '',
        '</details>'
    ].join('\n');
}

function renderError(errorText: string, err: unknown): string {
    let msg: string;
    if (err instanceof NoApiKeyError) {
        msg = `⚠️ ${err.message}`;
    } else if (err instanceof LLMError) {
        msg = `⚠️ ${err.message}`;
    } else {
        msg = `⚠️ ${err instanceof Error ? err.message : String(err)}`;
    }
    return [
        `# 🧭 에러 힌트`,
        '',
        msg,
        '',
        '---',
        '',
        '```',
        errorText.slice(0, 1500),
        '```'
    ].join('\n');
}

async function openPreview(body: string): Promise<void> {
    const uri = vscode.Uri.parse(`${ERROR_SCHEME}:local-${Date.now()}.md`);
    ErrorHintContent.instance.put(uri, body);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}
