import * as vscode from 'vscode';
import cheatsheetData from '../data/cheatsheet.json';
import { CustomCommandStore } from '../storage/customCommands';

// 치트시트 항목 기본 필드
interface BaseCheatItem {
    name: string;
    command: string;
    description: string;
    whenToUse: string;
}

// 런타임에서 다루는 치트시트 항목 — builtin/custom 공통
export interface CheatItem extends BaseCheatItem {
    id?: string;                       // custom만 보유
    source: 'builtin' | 'custom';
    category: string;
}

// 기본 카테고리 ID → 한글 라벨
export const CATEGORY_LABELS: Record<string, string> = {
    git: 'Git',
    terminal: '터미널',
    npm: 'npm'
};

const BUILTIN: Record<string, BaseCheatItem[]> = cheatsheetData as Record<string, BaseCheatItem[]>;

// TreeView 노드 — 카테고리 또는 명령어
export class CheatNode extends vscode.TreeItem {
    constructor(
        public readonly kind: 'category' | 'command',
        label: string,
        public readonly item?: CheatItem,
        public readonly categoryId?: string
    ) {
        super(
            label,
            kind === 'category'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        if (kind === 'command' && item) {
            // tooltip: "이게 뭐야 / 언제 써 / 예시" 3줄
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${item.name}**\n\n`);
            if (item.description) {
                md.appendMarkdown(`${item.description}\n\n`);
            }
            if (item.whenToUse) {
                md.appendMarkdown(`_언제 써:_ ${item.whenToUse}\n\n`);
            }
            md.appendCodeblock(item.command, 'shell');
            this.tooltip = md;
            this.description = item.command;
            this.iconPath = new vscode.ThemeIcon(item.source === 'custom' ? 'star-full' : 'terminal');
            this.contextValue = `command:${item.source}`;

            // 클릭 = 즉시 복사
            this.command = {
                command: 'devnavi.cheatsheet.copy',
                title: '복사',
                arguments: [item.command]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'category';
        }
    }
}

export class CheatsheetProvider implements vscode.TreeDataProvider<CheatNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<CheatNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly store: CustomCommandStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CheatNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CheatNode): CheatNode[] {
        const merged = this.mergeData();

        if (!element) {
            return Object.keys(merged).map(
                (key) => new CheatNode('category', CATEGORY_LABELS[key] ?? key, undefined, key)
            );
        }

        if (element.kind === 'category' && element.categoryId) {
            return (merged[element.categoryId] ?? []).map(
                (item) => new CheatNode('command', item.name, item, element.categoryId)
            );
        }

        return [];
    }

    // 검색용 — 모든 카테고리의 명령어를 flat 배열로
    listAll(): CheatItem[] {
        return Object.values(this.mergeData()).flat();
    }

    // 기본 + 커스텀 병합. 기본 카테고리 순서 유지, 커스텀 전용 카테고리는 뒤에 추가
    private mergeData(): Record<string, CheatItem[]> {
        const result: Record<string, CheatItem[]> = {};

        for (const [cat, items] of Object.entries(BUILTIN)) {
            result[cat] = items.map((i) => ({ ...i, source: 'builtin', category: cat }));
        }

        for (const c of this.store.list()) {
            if (!result[c.category]) {
                result[c.category] = [];
            }
            result[c.category].push({
                id: c.id,
                name: c.name,
                command: c.command,
                description: c.description,
                whenToUse: c.whenToUse,
                source: 'custom',
                category: c.category
            });
        }

        return result;
    }
}
