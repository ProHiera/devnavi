import * as vscode from 'vscode';
import uiGuideData from '../data/uiGuide.json';

// VSCode UI 도감 — 로컬 JSON 렌더링, 토큰 0원
interface GuideItem {
    icon: string;
    name: string;
    desc: string;
    when: string;
    shortcut?: string;
}

interface GuideSection {
    title: string;
    note: string;
    items: GuideItem[];
}

const UI_GUIDE_SCHEME = 'devnavi-ui-guide';

export class UIGuideContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new UIGuideContent();
    static readonly SCHEME = UI_GUIDE_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private cached: string | undefined;

    provideTextDocumentContent(_uri: vscode.Uri): string {
        if (!this.cached) { this.cached = render(); }
        return this.cached;
    }
}

export async function openUIGuide(): Promise<void> {
    const uri = vscode.Uri.parse(`${UI_GUIDE_SCHEME}:VSCode-UI-도감.md`);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

function render(): string {
    const sections = uiGuideData as Record<string, GuideSection>;
    const order = ['activityBar', 'statusBar', 'sourceControl', 'gutter', 'underline', 'tabs', 'palette'];

    const parts: string[] = [
        '# 🧭 VSCode UI 도감',
        '',
        '_화면 곳곳에 있는 아이콘·표시가 뭔지, 언제 보는지 한 장에._',
        '_전부 로컬 데이터 · 토큰 0원._',
        '',
        '## 📑 목차',
        '',
        ...order
            .filter(k => sections[k])
            .map(k => `- [${sections[k].title}](#${anchor(sections[k].title)})`),
        ''
    ];

    for (const key of order) {
        const sec = sections[key];
        if (!sec) { continue; }
        parts.push(
            '---',
            '',
            `## ${sec.title}`,
            '',
            `> ${sec.note}`,
            '',
            '| 아이콘 | 이름 | 뭐하는 거 | 언제 봐 | 단축키 |',
            '| --- | --- | --- | --- | --- |',
            ...sec.items.map(renderRow),
            ''
        );
    }

    return parts.join('\n');
}

function renderRow(item: GuideItem): string {
    const icon = item.icon ? `\`${escapeCell(item.icon)}\`` : '';
    const shortcut = item.shortcut ? `\`${escapeCell(item.shortcut)}\`` : '';
    return `| ${icon} | **${escapeCell(item.name)}** | ${escapeCell(item.desc)} | ${escapeCell(item.when)} | ${shortcut} |`;
}

// 마크다운 테이블 셀 안전 처리 — 파이프·줄바꿈만 치환
function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

// 한글·특수문자 허용 GitHub 스타일 앵커
function anchor(title: string): string {
    return title
        .toLowerCase()
        .replace(/[()·,]/g, '')
        .replace(/\s+/g, '-');
}
