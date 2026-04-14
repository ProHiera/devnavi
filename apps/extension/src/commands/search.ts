import * as vscode from 'vscode';
import { CheatItem, CheatsheetProvider, CATEGORY_LABELS } from '../providers/cheatsheetProvider';
import { copyCommand, sendToTerminal } from '../utils/clipboard';

// 명령어 빠른 검색 — QuickPick으로 이름/명령어/설명 전체 필터
export async function searchCheatsheet(provider: CheatsheetProvider): Promise<void> {
    type Pick = vscode.QuickPickItem & { cheat: CheatItem };

    const items: Pick[] = provider.listAll().map((cheat) => ({
        label: `$(${cheat.source === 'custom' ? 'star-full' : 'terminal'}) ${cheat.name}`,
        description: cheat.command,
        detail: `${CATEGORY_LABELS[cheat.category] ?? cheat.category}${cheat.whenToUse ? ` · ${cheat.whenToUse}` : ''}`,
        cheat
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: '명령어 검색 — 이름, 명령어, 설명으로 찾기',
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (!picked) { return; }

    const action = await vscode.window.showQuickPick(
        [
            { label: '$(clippy) 복사', value: 'copy' as const },
            { label: '$(terminal) 터미널에 보내기', value: 'terminal' as const }
        ],
        { placeHolder: picked.cheat.command }
    );

    if (action?.value === 'copy') {
        await copyCommand(picked.cheat.command);
    } else if (action?.value === 'terminal') {
        sendToTerminal(picked.cheat.command);
    }
}
