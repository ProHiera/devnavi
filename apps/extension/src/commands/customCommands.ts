import * as vscode from 'vscode';
import { CustomCommand, CustomCommandStore } from '../storage/customCommands';
import { CATEGORY_LABELS, CheatNode } from '../providers/cheatsheetProvider';

type FieldValues = Pick<CustomCommand, 'name' | 'command' | 'description' | 'whenToUse'>;

// 커스텀 명령어 추가/수정/삭제 UX
export class CustomCommandActions {
    constructor(
        private readonly store: CustomCommandStore,
        private readonly onChange: () => void
    ) {}

    async add(): Promise<void> {
        const category = await this.pickCategory();
        if (!category) { return; }

        const fields = await this.collectFields();
        if (!fields) { return; }

        await this.store.add({ category, ...fields });
        this.onChange();
        vscode.window.setStatusBarMessage(`$(star-full) 추가됨: ${fields.name}`, 1500);
    }

    async edit(node: CheatNode): Promise<void> {
        const target = this.resolveCustom(node);
        if (!target) { return; }

        const fields = await this.collectFields(target);
        if (!fields) { return; }

        await this.store.update(target.id, fields);
        this.onChange();
    }

    async remove(node: CheatNode): Promise<void> {
        const target = this.resolveCustom(node);
        if (!target) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `"${target.name}" 삭제할까요?`,
            { modal: true },
            '삭제'
        );
        if (confirm !== '삭제') { return; }

        await this.store.remove(target.id);
        this.onChange();
    }

    // 노드에서 저장소의 실제 레코드 조회
    private resolveCustom(node: CheatNode): CustomCommand | undefined {
        if (node.item?.source !== 'custom' || !node.item.id) { return undefined; }
        return this.store.list().find((c) => c.id === node.item!.id);
    }

    // 카테고리 선택 — 기존 목록 + "새로 만들기"
    private async pickCategory(): Promise<string | undefined> {
        const builtinIds = Object.keys(CATEGORY_LABELS);
        const customCategoryIds = [...new Set(this.store.list().map((c) => c.category))]
            .filter((c) => !builtinIds.includes(c));

        const items: (vscode.QuickPickItem & { categoryId?: string; isNew?: boolean })[] = [
            ...builtinIds.map((id) => ({ label: CATEGORY_LABELS[id], description: id, categoryId: id })),
            ...customCategoryIds.map((id) => ({ label: id, description: '커스텀', categoryId: id })),
            { label: '$(add) 새 카테고리 만들기', isNew: true }
        ];

        const picked = await vscode.window.showQuickPick(items, { placeHolder: '카테고리 선택' });
        if (!picked) { return undefined; }

        if (picked.isNew) {
            return await vscode.window.showInputBox({
                prompt: '새 카테고리 이름',
                validateInput: (v) => (v.trim() ? null : '카테고리 이름을 입력하세요')
            });
        }
        return picked.categoryId;
    }

    // 이름 / 명령어 / 설명 / 언제 써 — 순차 입력
    private async collectFields(current?: Partial<FieldValues>): Promise<FieldValues | undefined> {
        const name = await vscode.window.showInputBox({
            prompt: '명령어 이름 (1/4)',
            value: current?.name,
            validateInput: (v) => (v.trim() ? null : '이름을 입력하세요')
        });
        if (name === undefined) { return; }

        const command = await vscode.window.showInputBox({
            prompt: '실제 명령어 (2/4)',
            value: current?.command,
            validateInput: (v) => (v.trim() ? null : '명령어를 입력하세요')
        });
        if (command === undefined) { return; }

        const description = await vscode.window.showInputBox({
            prompt: '이게 뭐야 — 짧은 설명 (3/4)',
            value: current?.description
        });
        if (description === undefined) { return; }

        const whenToUse = await vscode.window.showInputBox({
            prompt: '언제 써 (4/4)',
            value: current?.whenToUse
        });
        if (whenToUse === undefined) { return; }

        return { name, command, description, whenToUse };
    }
}
