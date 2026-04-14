import * as vscode from 'vscode';
import cheatsheetData from '../data/cheatsheet.json';

// 치트시트 데이터 타입
interface CheatItem {
    name: string;
    command: string;
    description: string;
    whenToUse: string;
}

type CheatData = Record<string, CheatItem[]>;

// TreeView 노드 — 카테고리 또는 명령어 둘 중 하나
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
            md.appendMarkdown(`${item.description}\n\n`);
            md.appendMarkdown(`_언제 써:_ ${item.whenToUse}\n\n`);
            md.appendCodeblock(item.command, 'shell');
            this.tooltip = md;
            this.description = item.command;
            this.iconPath = new vscode.ThemeIcon('terminal');
            this.contextValue = 'command';

            // 클릭 시 즉시 복사
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

// 카테고리 ID → 한글 라벨 매핑
const CATEGORY_LABELS: Record<string, string> = {
    git: 'Git',
    terminal: '터미널',
    npm: 'npm'
};

export class CheatsheetProvider implements vscode.TreeDataProvider<CheatNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<CheatNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // JSON은 webpack 번들에 내장 — import 시점에 한 번만 로드됨
    private readonly data: CheatData = cheatsheetData as CheatData;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CheatNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CheatNode): CheatNode[] {
        if (!element) {
            // 루트: 카테고리 목록
            return Object.keys(this.data).map(
                (key) => new CheatNode('category', CATEGORY_LABELS[key] ?? key, undefined, key)
            );
        }

        if (element.kind === 'category' && element.categoryId) {
            return (this.data[element.categoryId] ?? []).map(
                (item) => new CheatNode('command', item.name, item, element.categoryId)
            );
        }

        return [];
    }
}
