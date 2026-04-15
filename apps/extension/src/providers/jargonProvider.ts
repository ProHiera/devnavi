import * as vscode from 'vscode';
import jargonData from '../data/jargon.json';
import { CustomJargonStore } from '../storage/customJargon';

// 용어 한 개
export interface JargonItem {
    term: string;
    aliases: string[];
    bad: string;
    good: string;
    example: string;
    category: string;                    // 'tech' | 'pangyo' | 'custom'
    source: 'builtin' | 'custom';
    id?: string;                         // custom만 보유
}

// 카테고리 ID → 라벨
export const JARGON_CATEGORY_LABELS: Record<string, string> = {
    tech: '기술 용어',
    pangyo: '판교어',
    custom: '⭐ 내 용어'
};

const CUSTOM_CATEGORY = 'custom';

// JSON → 런타임 타입
const RAW: Record<string, Omit<JargonItem, 'category' | 'source' | 'id'>[]> =
    jargonData as Record<string, Omit<JargonItem, 'category' | 'source' | 'id'>[]>;

// TreeView 노드 — 카테고리 또는 용어
export class JargonNode extends vscode.TreeItem {
    constructor(
        public readonly kind: 'category' | 'term',
        label: string,
        public readonly item?: JargonItem,
        public readonly categoryId?: string
    ) {
        super(
            label,
            kind === 'category'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        if (kind === 'term' && item) {
            this.tooltip = buildTooltip(item);
            this.description = item.good.length > 40 ? item.good.slice(0, 40) + '…' : item.good;
            this.iconPath = new vscode.ThemeIcon(item.source === 'custom' ? 'star-full' : 'book');
            this.contextValue = `jargon:term:${item.source}`;

            // 클릭 → 상세 패널 열기
            this.command = {
                command: 'devnavi.jargon.show',
                title: '설명 보기',
                arguments: [item]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('library');
            this.contextValue = 'jargon:category';
        }
    }
}

// 툴팁 — ❌/✅ 포맷 MarkdownString
export function buildTooltip(item: JargonItem): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**📖 ${item.term}**\n\n`);
    if (item.bad) { md.appendMarkdown(`❌ **일반 방식**\n\n${item.bad}\n\n`); }
    if (item.good) { md.appendMarkdown(`✅ **${item.term}**\n\n${item.good}\n\n`); }
    if (item.example) { md.appendMarkdown(`💡 *예시:* ${item.example}`); }
    md.supportThemeIcons = true;
    return md;
}

export class JargonProvider implements vscode.TreeDataProvider<JargonNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<JargonNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly store: CustomJargonStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: JargonNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JargonNode): JargonNode[] {
        const merged = this.mergeData();

        if (!element) {
            return Object.keys(merged).map(
                (key) => new JargonNode('category', JARGON_CATEGORY_LABELS[key] ?? key, undefined, key)
            );
        }

        if (element.kind === 'category' && element.categoryId) {
            return (merged[element.categoryId] ?? []).map(
                (item) => new JargonNode('term', item.term, item, element.categoryId)
            );
        }

        return [];
    }

    // 정확 일치 또는 alias 매치 — 커스텀 포함
    lookup(query: string): JargonItem | undefined {
        const q = query.trim().toLowerCase();
        for (const item of this.listAll()) {
            if (item.term.toLowerCase() === q) { return item; }
            if (item.aliases.some((a) => a.toLowerCase() === q)) { return item; }
        }
        return undefined;
    }

    listAll(): JargonItem[] {
        return Object.values(this.mergeData()).flat();
    }

    // 기본 + 커스텀 병합. 커스텀은 맨 뒤 '내 용어' 카테고리.
    private mergeData(): Record<string, JargonItem[]> {
        const result: Record<string, JargonItem[]> = {};

        for (const [cat, items] of Object.entries(RAW)) {
            result[cat] = items.map((i) => ({
                ...i,
                category: cat,
                source: 'builtin' as const
            }));
        }

        const customs = this.store.list();
        if (customs.length > 0) {
            result[CUSTOM_CATEGORY] = customs.map((c) => ({
                id: c.id,
                term: c.term,
                aliases: [],
                bad: c.bad,
                good: c.good,
                example: c.example,
                category: CUSTOM_CATEGORY,
                source: 'custom' as const
            }));
        }

        return result;
    }
}
