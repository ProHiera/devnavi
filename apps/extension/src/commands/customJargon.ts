import * as vscode from 'vscode';
import { CustomJargon, CustomJargonStore } from '../storage/customJargon';
import { JargonNode } from '../providers/jargonProvider';

type FieldValues = Pick<CustomJargon, 'term' | 'bad' | 'good' | 'example'>;

// 커스텀 용어 추가/수정/삭제 UX
export class CustomJargonActions {
    constructor(
        private readonly store: CustomJargonStore,
        private readonly onChange: () => void
    ) {}

    async add(): Promise<void> {
        const fields = await this.collectFields();
        if (!fields) { return; }

        await this.store.add(fields);
        this.onChange();
        vscode.window.setStatusBarMessage(`$(star-full) 용어 추가됨: ${fields.term}`, 1500);
    }

    async edit(node: JargonNode): Promise<void> {
        const target = this.resolveCustom(node);
        if (!target) { return; }

        const fields = await this.collectFields(target);
        if (!fields) { return; }

        await this.store.update(target.id, fields);
        this.onChange();
    }

    async remove(node: JargonNode): Promise<void> {
        const target = this.resolveCustom(node);
        if (!target) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `"${target.term}" 삭제할까요?`,
            { modal: true },
            '삭제'
        );
        if (confirm !== '삭제') { return; }

        await this.store.remove(target.id);
        this.onChange();
    }

    private resolveCustom(node: JargonNode): CustomJargon | undefined {
        if (node.item?.source !== 'custom' || !node.item.id) { return undefined; }
        return this.store.list().find((c) => c.id === node.item!.id);
    }

    // 용어 / ❌ / ✅ / 예시 — 순차 입력
    private async collectFields(current?: Partial<FieldValues>): Promise<FieldValues | undefined> {
        const term = await vscode.window.showInputBox({
            prompt: '용어 이름 (1/4) — 예: "스크럼", "JWT"',
            value: current?.term,
            validateInput: (v) => (v.trim() ? null : '용어를 입력하세요')
        });
        if (term === undefined) { return; }

        const bad = await vscode.window.showInputBox({
            prompt: '❌ 일반 방식 (2/4) — 이 개념을 모를 때 생기는 상황',
            value: current?.bad,
            placeHolder: '예: 앱 켜자마자 모든 걸 다 불러옴 (느림)'
        });
        if (bad === undefined) { return; }

        const good = await vscode.window.showInputBox({
            prompt: `✅ ${term} (3/4) — 이 개념의 정의/해결 방식`,
            value: current?.good,
            placeHolder: '예: 필요한 것만 먼저 불러오고 나머진 나중에',
            validateInput: (v) => (v.trim() ? null : '설명을 입력하세요')
        });
        if (good === undefined) { return; }

        const example = await vscode.window.showInputBox({
            prompt: '💡 예시 (4/4) — 실제 사용 사례 (선택)',
            value: current?.example,
            placeHolder: '예: 이미지 스크롤 시 하나씩 로드'
        });
        if (example === undefined) { return; }

        return { term: term.trim(), bad: bad.trim(), good: good.trim(), example: example.trim() };
    }
}
