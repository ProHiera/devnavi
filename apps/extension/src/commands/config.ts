import * as vscode from 'vscode';
import { ApiKeyStore, LLMProvider, PROVIDERS, PROVIDER_LABELS, getActiveProvider } from '../storage/apiKey';

// API 키 설정/삭제 + 활성 프로바이더 전환 UX
export class ConfigActions {
    constructor(private readonly keys: ApiKeyStore) {}

    async setApiKey(): Promise<void> {
        const provider = await this.pickProvider('API 키를 설정할 프로바이더');
        if (!provider) { return; }

        const existing = await this.keys.get(provider);
        const key = await vscode.window.showInputBox({
            prompt: `${PROVIDER_LABELS[provider]} API 키`,
            password: true,
            placeHolder: existing ? '새 키로 덮어쓰기' : '키를 붙여넣으세요',
            validateInput: (v) => (v.trim() ? null : '키를 입력하세요')
        });
        if (!key) { return; }

        await this.keys.set(provider, key.trim());
        vscode.window.showInformationMessage(`DevNavi: ${PROVIDER_LABELS[provider]} API 키 저장됨`);
    }

    async clearApiKey(): Promise<void> {
        const provider = await this.pickProvider('API 키를 삭제할 프로바이더');
        if (!provider) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `${PROVIDER_LABELS[provider]} API 키를 삭제할까요?`,
            { modal: true },
            '삭제'
        );
        if (confirm !== '삭제') { return; }

        await this.keys.remove(provider);
        vscode.window.showInformationMessage(`DevNavi: ${PROVIDER_LABELS[provider]} API 키 삭제됨`);
    }

    async selectProvider(): Promise<void> {
        const current = getActiveProvider();
        const picked = await this.pickProvider('사용할 프로바이더 선택', current);
        if (!picked) { return; }

        await vscode.workspace
            .getConfiguration('devnavi.llm')
            .update('provider', picked, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`DevNavi: 프로바이더 → ${PROVIDER_LABELS[picked]}`);
    }

    private async pickProvider(placeHolder: string, current?: LLMProvider): Promise<LLMProvider | undefined> {
        const items: (vscode.QuickPickItem & { provider: LLMProvider })[] = PROVIDERS.map((p) => ({
            label: PROVIDER_LABELS[p],
            description: p === current ? '현재 사용 중' : undefined,
            provider: p
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder });
        return picked?.provider;
    }
}
