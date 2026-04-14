import * as vscode from 'vscode';

// 명령어를 클립보드에 복사하고 상태바에 짧게 피드백 표시
export async function copyCommand(command: string): Promise<void> {
    await vscode.env.clipboard.writeText(command);
    vscode.window.setStatusBarMessage(`$(check) 복사됨: ${command}`, 1500);
}

// 활성 터미널에 명령어 전송 (없으면 새로 생성). 엔터는 치지 않음 — 유저가 확인 후 실행
export function sendToTerminal(command: string): void {
    const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('DevNavi');
    terminal.show();
    terminal.sendText(command, false);
}
