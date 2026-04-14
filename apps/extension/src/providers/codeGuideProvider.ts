import * as vscode from 'vscode';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { GuideMode, HistoryTurn, buildMessages } from '../utils/prompts';

// Comments API 기반 코드 가이드 — 선택한 코드 옆에 인라인 스레드 생성 + LLM 응답

const CONTROLLER_ID = 'devnavi.codeGuide';
const CONTROLLER_LABEL = 'DevNavi 코드 가이드';

const AUTHOR_USER: vscode.CommentAuthorInformation = { name: '나' };
const AUTHOR_AI: vscode.CommentAuthorInformation = { name: 'DevNavi' };

const LOADING_CONTEXT = 'loading';

// 스레드별 원본 질문 맥락 — 후속 답글 시 initialQuestion/code 재사용
interface ThreadState {
    initialMode: Exclude<GuideMode, 'reply'>;
    code: string;
    language: string;
    initialQuestion: string;
}

export class CodeGuideController implements vscode.Disposable {
    private readonly controller: vscode.CommentController;
    private readonly states = new WeakMap<vscode.CommentThread, ThreadState>();

    constructor(
        private readonly keys: ApiKeyStore,
        private readonly tracker: TokenTrackerStore
    ) {
        this.controller = vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_LABEL);
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document) => {
                const lastLine = Math.max(document.lineCount - 1, 0);
                return [new vscode.Range(0, 0, lastLine, 0)];
            }
        };
    }

    // 선택 영역에 새 스레드 생성 → LLM 호출
    async ask(mode: Exclude<GuideMode, 'reply'>): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage('DevNavi: 먼저 코드를 선택하세요.');
            return;
        }

        const code = editor.document.getText(selection);
        const language = editor.document.languageId;
        const question = mode === 'hint' ? '힌트만 줘' : '이게 뭐야?';

        const thread = this.controller.createCommentThread(
            editor.document.uri,
            selection,
            [buildQuestionComment(question, code, language)]
        );
        thread.label = `DevNavi · ${question}`;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.contextValue = 'devnavi';

        this.states.set(thread, { initialMode: mode, code, language, initialQuestion: question });

        const loading = makeLoadingComment();
        thread.comments = [...thread.comments, loading];

        try {
            const messages = buildMessages(mode, code, language, question);
            const featureTag = mode === 'hint' ? 'codeGuide.hint' : 'codeGuide.explain';
            const answer = await trackedAskLLM(this.keys, this.tracker, featureTag, question, messages);
            thread.comments = replaceComment(thread.comments, loading, makeAnswerComment(answer));
        } catch (err) {
            thread.comments = replaceComment(thread.comments, loading, makeErrorComment(err));
        }
    }

    // 기존 스레드에 답글 — 히스토리 누적 후 LLM 재호출
    async reply(reply: vscode.CommentReply): Promise<void> {
        if (!reply.text.trim()) { return; }

        const thread = reply.thread;
        const state = this.states.get(thread);
        if (!state) {
            // 맥락 없는 스레드 — 유저 댓글만 남기고 안내
            thread.comments = [
                ...thread.comments,
                { body: reply.text, mode: vscode.CommentMode.Preview, author: AUTHOR_USER },
                {
                    body: new vscode.MarkdownString(
                        '이 스레드는 DevNavi가 시작하지 않아서 AI 응답을 붙이지 못해. "🧭 DevNavi: 이게 뭐야?"로 새 스레드를 열어줘.'
                    ),
                    mode: vscode.CommentMode.Preview,
                    author: AUTHOR_AI
                }
            ];
            return;
        }

        const userComment: vscode.Comment = {
            body: reply.text,
            mode: vscode.CommentMode.Preview,
            author: AUTHOR_USER
        };
        const loading = makeLoadingComment();
        thread.comments = [...thread.comments, userComment, loading];

        try {
            const history = collectHistory(thread.comments);
            // 답글 턴은 항상 'reply' 모드 — 유저 질문에 직접 답해줌
            const messages = buildMessages('reply', state.code, state.language, state.initialQuestion, history);
            const answer = await trackedAskLLM(this.keys, this.tracker, 'codeGuide.reply', reply.text, messages);
            thread.comments = replaceComment(thread.comments, loading, makeAnswerComment(answer));
        } catch (err) {
            thread.comments = replaceComment(thread.comments, loading, makeErrorComment(err));
        }
    }

    dispose(): void {
        this.controller.dispose();
    }
}

// 💡 Code Action (Ctrl+.) — 선택 영역에 DevNavi 물어보기 노출
export class CodeGuideActionProvider implements vscode.CodeActionProvider {
    static readonly kind = vscode.CodeActionKind.Empty.append('devnavi');

    provideCodeActions(
        _document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] | undefined {
        if (range.isEmpty) { return undefined; }

        const explain = new vscode.CodeAction('🧭 DevNavi: 이게 뭐야?', CodeGuideActionProvider.kind);
        explain.command = { command: 'devnavi.codeGuide.ask', title: '이게 뭐야?' };

        const hint = new vscode.CodeAction('💡 DevNavi: 힌트만 줘', CodeGuideActionProvider.kind);
        hint.command = { command: 'devnavi.codeGuide.hint', title: '힌트만 줘' };

        return [explain, hint];
    }
}

// -- helpers ----------------------------------------------------------------

function buildQuestionComment(question: string, code: string, language: string): vscode.Comment {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${question}**\n\n`);
    md.appendCodeblock(code, language);
    return { body: md, mode: vscode.CommentMode.Preview, author: AUTHOR_USER };
}

function makeLoadingComment(): vscode.Comment {
    return {
        body: new vscode.MarkdownString('🧭 _생각 중…_'),
        mode: vscode.CommentMode.Preview,
        author: AUTHOR_AI,
        contextValue: LOADING_CONTEXT
    };
}

function makeAnswerComment(text: string): vscode.Comment {
    const md = new vscode.MarkdownString(text);
    md.supportThemeIcons = true;
    return { body: md, mode: vscode.CommentMode.Preview, author: AUTHOR_AI };
}

function makeErrorComment(err: unknown): vscode.Comment {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (err instanceof NoApiKeyError) {
        md.appendMarkdown(`⚠️ ${err.message}\n\n`);
        md.appendMarkdown(`[API 키 설정하기](command:devnavi.config.setApiKey) · [프로바이더 선택](command:devnavi.config.selectProvider)`);
    } else if (err instanceof LLMError) {
        md.appendMarkdown(`⚠️ ${err.message}`);
    } else {
        const msg = err instanceof Error ? err.message : String(err);
        md.appendMarkdown(`⚠️ 알 수 없는 에러 — ${msg}`);
    }

    return { body: md, mode: vscode.CommentMode.Preview, author: AUTHOR_AI };
}

function replaceComment(
    list: readonly vscode.Comment[],
    target: vscode.Comment,
    next: vscode.Comment
): vscode.Comment[] {
    return list.map((c) => (c === target ? next : c));
}

// 스레드 전체에서 첫 질문(코드블록 포함) 이후의 대화만 history로.
// 로딩 코멘트는 제외.
function collectHistory(comments: readonly vscode.Comment[]): HistoryTurn[] {
    const history: HistoryTurn[] = [];
    const turns = comments.slice(1); // 첫 질문은 buildMessages가 initialQuestion으로 대체

    for (const c of turns) {
        if (c.contextValue === LOADING_CONTEXT) { continue; }
        const role = c.author.name === AUTHOR_AI.name ? 'assistant' : 'user';
        history.push({ role, content: stringifyBody(c.body) });
    }
    return history;
}

function stringifyBody(body: string | vscode.MarkdownString): string {
    return typeof body === 'string' ? body : body.value;
}
