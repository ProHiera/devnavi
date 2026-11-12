import * as vscode from 'vscode';
import * as path from 'node:path';
import { InlineCard } from '../utils/inlineCard';
import { ConnectionGraph } from './model';

interface Actions { refresh(): Promise<void>; cancel(): void; open(id: string, edge?: number, site?: number): Promise<void>; explain(id: string): Promise<void>; }

export class InlineConnections implements vscode.Disposable {
    private readonly card: InlineCard;
    private graph?: ConnectionGraph;
    private root = '';
    private direction: 'in' | 'out' = 'in';
    private page = 0;
    private history: string[] = [];
    private status = '';
    private busy = false;
    private stale = false;
    private explanations = new Map<string, string>();
    private fullExplanation = false;

    constructor(private readonly actions: Actions) {
        this.card = new InlineCard('devnavi.connections.inline', 'DevNavi 코드 연결', (action, value) => this.action(action, value), () => actions.cancel());
    }

    get isOpen(): boolean { return this.card.isOpen; }
    open(uri: vscode.Uri, position: vscode.Position): void {
        this.card.open(uri, new vscode.Range(position.line, 0, position.line, 0), '어디에 연결돼 있어?');
        this.graph = undefined; this.history = []; this.stale = false; this.page = 0; this.explanations.clear();
    }
    close(): void { this.card.close(); }
    setStatus(status: string, busy: boolean): void { this.status = status; this.busy = busy; this.render(); }
    setGraph(graph: ConnectionGraph): void {
        this.graph = graph; this.root = graph.root; this.history = []; this.direction = 'in'; this.page = 0; this.stale = false; this.explanations.clear(); this.render();
    }
    markStale(): void { if (this.graph) { this.stale = true; this.render(); } }
    explain(id: string, text: string): void { this.explanations.set(id, text); this.render(); }

    private entries(direction = this.direction) {
        const graph = this.graph;
        if (!graph) { return []; }
        return graph.edges.flatMap((edge, index) => {
            if ((direction === 'in' ? edge.to : edge.from) !== this.root || ['import', 'reexport'].includes(edge.kind)) { return []; }
            const node = graph.nodes.find(node => node.id === (direction === 'in' ? edge.from : edge.to));
            return node && !['type', 'file'].includes(node.kind) ? [{ edge, index, node }] : [];
        }).sort((a, b) => a.node.name.localeCompare(b.node.name));
    }

    private navigate(id: string, record = true): void {
        if (!this.graph?.nodes.some(node => node.id === id)) { return; }
        if (record && id !== this.root) { this.history.push(this.root); }
        this.root = id; this.page = 0; this.fullExplanation = false; this.render();
    }

    private async action(action: string, value: unknown): Promise<void> {
        if (action === 'refresh' && !this.busy) { await this.actions.refresh(); }
        else if (action === 'cancel') { this.actions.cancel(); }
        else if (action === 'direction' && (value === 'in' || value === 'out')) { this.direction = value; this.page = 0; this.render(); }
        else if (action === 'navigate' && typeof value === 'string') { this.navigate(value); }
        else if (action === 'back' && this.history.length) { this.navigate(this.history.pop()!, false); }
        else if (action === 'page' && Number.isInteger(value) && (value as number) >= 0 && (value as number) * 4 < this.entries().length) { this.page = value as number; this.render(); }
        else if (action === 'source' && !this.stale) {
            if (value === null) { await this.actions.open(this.root); }
            else if (Number.isInteger(value) && this.entries().some(entry => entry.index === value)) { await this.actions.open(this.root, value as number, 0); }
        } else if (action === 'sites' && Number.isInteger(value) && !this.stale) {
            const entry = this.entries().find(entry => entry.index === value);
            if (!entry) { return; }
            const root = this.root, graph = this.graph;
            const selected = await vscode.window.showQuickPick(entry.edge.sites.map((site, index) => ({ label: `${path.basename(site.file)}:${site.line}`, description: site.text.trim(), index })), { placeHolder: '이동할 참조 위치' });
            if (selected && graph === this.graph && root === this.root && this.card.isOpen && !this.stale) { await this.actions.open(root, entry.index, selected.index); }
        } else if (action === 'explain' && !this.stale) { await this.actions.explain(this.root); }
        else if (action === 'more') { this.fullExplanation = !this.fullExplanation; this.render(); }
        else if (action === 'search' && this.graph) {
            const graph = this.graph;
            const selected = await vscode.window.showQuickPick(graph.nodes.filter(node => !['file', 'type'].includes(node.kind)).map(node => ({ label: node.name, description: node.file ? vscode.workspace.asRelativePath(node.file) : '외부 연결', id: node.id })), { placeHolder: '연결을 볼 함수나 컴포넌트 찾기', matchOnDescription: true });
            if (selected && graph === this.graph && this.card.isOpen) { this.navigate(selected.id); }
        }
    }

    private render(): void {
        if (!this.card.isOpen) { return; }
        const body = this.card.markdown();
        const node = this.graph?.nodes.find(node => node.id === this.root);
        if (this.stale) { body.appendText('코드가 바뀌었습니다. 새로고침해 주세요.'); body.appendMarkdown('\n\n'); }
        if (node) {
            body.appendText(`${node.name} · `);
            this.card.link(body, `쓰는 곳 ${this.entries('in').length}`, 'direction', 'in'); body.appendText(' / ');
            this.card.link(body, `이어지는 코드 ${this.entries('out').length}`, 'direction', 'out'); body.appendMarkdown('\n\n');
            const entries = this.entries();
            if (!entries.length) { body.appendText('이 방향으로 확인된 직접 연결이 없습니다.'); body.appendMarkdown('\n\n'); }
            for (const { edge, index, node: other } of entries.slice(this.page * 4, (this.page + 1) * 4)) {
                this.card.link(body, other.name, 'navigate', other.id);
                const verb = edge.kind === 'call' ? '호출' : edge.kind === 'render' ? '렌더링' : edge.kind === 'request' ? '요청' : '참조';
                body.appendText(this.direction === 'in' ? ` → ${node.name} ${verb}  ` : ` ← ${node.name}에서 ${verb}  `);
                const site = edge.sites[0];
                if (site && !this.stale && !node.external) { this.card.link(body, `${path.basename(site.file)}:${site.line}`, 'source', index); }
                if (edge.sites.length > 1 && !this.stale && !node.external) { body.appendText(' · '); this.card.link(body, `위치 ${edge.sites.length}개`, 'sites', index); }
                body.appendMarkdown('  \n');
            }
            body.appendMarkdown('\n');
            if (entries.length > 4) {
                if (this.page) { this.card.link(body, '← 이전', 'page', this.page - 1); body.appendText('  '); }
                body.appendText(`${this.page + 1}/${Math.ceil(entries.length / 4)}  `);
                if ((this.page + 1) * 4 < entries.length) { this.card.link(body, '다음 →', 'page', this.page + 1); }
                body.appendMarkdown('\n\n');
            }
            const explanation = this.explanations.get(this.root);
            if (explanation) {
                body.appendText(this.fullExplanation ? explanation : explanation.slice(0, 400));
                if (explanation.length > 400) { body.appendText(' '); this.card.link(body, this.fullExplanation ? '접기' : '더 보기', 'more'); }
                body.appendMarkdown('\n\n');
            }
            if (this.history.length) { this.card.link(body, '← 이전 코드', 'back'); body.appendText(' · '); }
            this.card.link(body, '함수 찾기', 'search'); body.appendText(' · ');
            if (!this.stale) { this.card.link(body, 'AI로 역할 설명', 'explain'); body.appendText(' · '); }
        }
        if (this.busy || !node || this.status.startsWith('분석하지 못')) { body.appendText(this.status); body.appendMarkdown('\n\n'); }
        this.card.link(body, this.busy ? '중지' : '새로고침', this.busy ? 'cancel' : 'refresh');
        this.card.render(body);
    }

    dispose(): void { this.card.dispose(); }
}
