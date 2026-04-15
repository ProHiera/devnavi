import * as vscode from 'vscode';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { buildNameSuggestMessages, parseNameSuggestions } from '../utils/prompts';

// 선택한 식별자/식에 대한 더 나은 이름 5개 → QuickPick → 선택 영역 치환
export async function suggestName(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showInformationMessage('이름 바꿀 식별자를 먼저 선택해줘.');
        return;
    }

    const selected = editor.document.getText(selection).trim();
    if (!selected) { return; }

    const surrounding = getSurroundingLines(editor.document, selection, 8);
    const language = editor.document.languageId;

    try {
        const answer = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '이름 후보 생성 중…' },
            () => trackedAskLLM(
                keys,
                tracker,
                'nameSuggest.ai',
                selected,
                buildNameSuggestMessages(selected, surrounding, language)
            )
        );

        const names = parseNameSuggestions(answer);
        if (names.length === 0) {
            vscode.window.showWarningMessage('AI 응답에서 이름 후보를 뽑지 못했어.');
            return;
        }

        const picked = await vscode.window.showQuickPick(
            names.map((n, i) => ({ label: n, description: `후보 ${i + 1}` })),
            { placeHolder: `"${selected}" → 선택 영역을 이 이름으로 치환` }
        );
        if (!picked) { return; }

        await editor.edit((edit) => edit.replace(selection, picked.label));
        vscode.window.setStatusBarMessage(`$(check) "${selected}" → "${picked.label}"`, 2500);
    } catch (err) {
        handleError(err);
    }
}

// 선택 위·아래 N줄 컨텍스트
function getSurroundingLines(
    doc: vscode.TextDocument,
    selection: vscode.Selection,
    n: number
): string {
    const start = Math.max(0, selection.start.line - n);
    const end = Math.min(doc.lineCount - 1, selection.end.line + n);
    const range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
    return doc.getText(range);
}

function handleError(err: unknown): void {
    if (err instanceof NoApiKeyError) {
        vscode.window.showWarningMessage(err.message, 'API 키 설정').then((pick) => {
            if (pick === 'API 키 설정') {
                vscode.commands.executeCommand('devnavi.config.setApiKey');
            }
        });
        return;
    }
    const msg = err instanceof LLMError || err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`이름 추천 실패 — ${msg}`);
}
