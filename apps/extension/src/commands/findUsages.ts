import * as vscode from 'vscode';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { trackedAskLLM } from '../utils/llm';
import { InlineThread } from '../utils/inlineThread';
import { UsageRef, buildUsageSummaryMessages } from '../utils/prompts';

// "이거 어디서 쓰여?" 전용 인라인 컨트롤러
export class FindUsagesInlineController extends InlineThread {
    constructor() { super('devnavi.findUsages', 'DevNavi 사용처'); }
    openForSymbol(editor: vscode.TextEditor, symbol: string): vscode.CommentThread {
        return this.open(editor, `🧭 ${symbol} 사용처`, `🧭 _"${symbol}" 참조 찾는 중…_`);
    }
}

// 최대 참조 수 — 토큰 폭주 방지
const MAX_REFS = 20;
// 스니펫 길이 제한 — 한 줄이 너무 길면 자름
const MAX_SNIPPET_CHARS = 200;

export async function findUsages(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore,
    inline: FindUsagesInlineController
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('DevNavi: 활성 에디터가 없어.');
        return;
    }

    // 심볼 결정 — 선택 영역 우선, 없으면 커서 위치의 단어
    const symbolInfo = resolveSymbol(editor);
    if (!symbolInfo) {
        vscode.window.showInformationMessage('DevNavi: 심볼을 선택하거나 커서를 식별자 위에 놓아줘.');
        return;
    }
    const { symbol, position } = symbolInfo;

    // 인라인 스레드 먼저 열고 로딩 표시
    const thread = inline.openForSymbol(editor, symbol);

    // VSCode Reference Provider 호출 — LSP가 지원해야 함
    let locations: vscode.Location[];
    try {
        const raw = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            editor.document.uri,
            position
        );
        locations = raw ?? [];
    } catch (err) {
        inline.setError(thread, err);
        return;
    }

    if (locations.length === 0) {
        inline.setMarkdown(thread, [
            `## 🧭 ${symbol}`,
            '',
            '참조를 찾지 못했어.',
            '',
            '- 이 언어의 Language Server가 활성화됐는지 확인해봐.',
            '- 식별자가 아닌 곳(문자열, 주석)에 커서가 있었을 수도 있어.'
        ].join('\n'));
        return;
    }

    // 중복 제거 + 상한 적용 + 컨텍스트 추출
    const refs = await collectRefs(locations, position, editor.document.uri);
    if (refs.length === 0) {
        inline.setMarkdown(thread, [
            `## 🧭 ${symbol}`,
            '',
            '현재 위치 외에 사용처가 없어. 아직 어디서도 안 쓰이는 심볼일 수 있음.'
        ].join('\n'));
        return;
    }

    // LLM 호출
    try {
        const language = editor.document.languageId;
        const answer = await trackedAskLLM(
            keys,
            tracker,
            'usage.ai',
            normalizeQuestion(`usage ${symbol}`),
            buildUsageSummaryMessages(symbol, language, refs)
        );
        inline.setMarkdown(thread, answer);
    } catch (err) {
        inline.setError(thread, err);
    }
}

// LSP가 참조를 안 가지는 흔한 키워드들 — 선택 영역에서 이런 건 건너뛰고 다음 식별자를 봄
const KEYWORDS = new Set([
    // JS/TS
    'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
    'import', 'export', 'from', 'default', 'as', 'async', 'await', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'new', 'this', 'super', 'extends', 'implements', 'public', 'private', 'protected',
    'static', 'readonly', 'true', 'false', 'null', 'undefined', 'void', 'try', 'catch', 'finally', 'throw',
    // Python
    'def', 'lambda', 'pass', 'yield', 'with', 'global', 'nonlocal', 'and', 'or', 'not', 'is', 'in', 'None'
]);

// 선택 영역 or 커서 위치에서 심볼 이름 + 정확한 position 추출
function resolveSymbol(editor: vscode.TextEditor): { symbol: string; position: vscode.Position } | undefined {
    const doc = editor.document;

    // 선택 영역이 있으면 그 안의 식별자들을 순회 — 키워드는 스킵
    if (!editor.selection.isEmpty) {
        const text = doc.getText(editor.selection);
        const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
        for (const match of text.matchAll(re)) {
            const name = match[0];
            if (KEYWORDS.has(name)) { continue; }
            const offset = doc.offsetAt(editor.selection.start) + (match.index ?? 0);
            return { symbol: name, position: doc.positionAt(offset) };
        }
    }

    // 선택 없음 — 커서 위치의 단어 범위 사용
    const range = doc.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!range) { return undefined; }
    const symbol = doc.getText(range);
    if (KEYWORDS.has(symbol)) { return undefined; }
    return { symbol, position: range.start };
}

// 참조 위치들 → 파일별 스니펫. 자기 자신(정의/현재 위치)은 스킵.
async function collectRefs(
    locations: vscode.Location[],
    self: vscode.Position,
    selfUri: vscode.Uri
): Promise<UsageRef[]> {
    const seen = new Set<string>();
    const out: UsageRef[] = [];

    for (const loc of locations) {
        if (out.length >= MAX_REFS) { break; }

        // 현재 심볼 위치와 동일하면 스킵 (자기 자신)
        if (loc.uri.toString() === selfUri.toString() && loc.range.start.line === self.line) {
            continue;
        }

        const dedupKey = `${loc.uri.toString()}:${loc.range.start.line}`;
        if (seen.has(dedupKey)) { continue; }
        seen.add(dedupKey);

        try {
            const doc = await vscode.workspace.openTextDocument(loc.uri);
            const lineText = doc.lineAt(loc.range.start.line).text.trim();
            const snippet = lineText.length > MAX_SNIPPET_CHARS
                ? lineText.slice(0, MAX_SNIPPET_CHARS) + '…'
                : lineText;

            out.push({
                file: vscode.workspace.asRelativePath(loc.uri),
                line: loc.range.start.line + 1,
                snippet
            });
        } catch {
            // 파일을 못 열면 스킵
        }
    }

    return out;
}
