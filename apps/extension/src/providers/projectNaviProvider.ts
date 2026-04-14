import * as vscode from 'vscode';
import {
    Phase,
    Project,
    ProjectNaviStore,
    TaskItem,
    phaseProgressOf,
    progressOf
} from '../storage/projectNavi';

// 트리 노드 3단계: project → phase → task
type NodeKind = 'empty' | 'project' | 'phase' | 'task';

export class ProjectNaviNode extends vscode.TreeItem {
    constructor(
        public readonly kind: NodeKind,
        label: string,
        public readonly project?: Project,
        public readonly phase?: Phase,
        public readonly task?: TaskItem
    ) {
        const collapsible =
            kind === 'task' || kind === 'empty'
                ? vscode.TreeItemCollapsibleState.None
                : kind === 'phase' && phase && !phase.tasks.every((t) => t.done)
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;

        super(label, collapsible);

        if (kind === 'empty') {
            this.iconPath = new vscode.ThemeIcon('sparkle');
            this.tooltip = '클릭해서 새 프로젝트를 시작해봐.';
            this.command = {
                command: 'devnavi.projectNavi.addProject',
                title: '프로젝트 시작'
            };
            this.contextValue = 'projectNavi:empty';
            return;
        }

        if (kind === 'project' && project) {
            const { done, total, ratio } = progressOf(project);
            const pct = Math.round(ratio * 100);
            this.description = total === 0 ? '비어있음' : `${done}/${total} · ${pct}%`;
            this.iconPath = new vscode.ThemeIcon(total > 0 && done === total ? 'pass-filled' : 'rocket');
            this.contextValue = 'projectNavi:project';

            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**📁 ${project.name}**\n\n`);
            if (project.goal) { md.appendMarkdown(`_목표:_ ${project.goal}\n\n`); }
            md.appendMarkdown(`진행: ${done}/${total} (${pct}%)`);
            this.tooltip = md;
            return;
        }

        if (kind === 'phase' && phase) {
            const { done, total } = phaseProgressOf(phase);
            const completed = total > 0 && done === total;
            this.description = `${done}/${total}`;
            this.iconPath = new vscode.ThemeIcon(completed ? 'check-all' : 'milestone');
            this.contextValue = 'projectNavi:phase';
            return;
        }

        if (kind === 'task' && task) {
            this.iconPath = new vscode.ThemeIcon(
                task.done ? 'check' : 'circle-large-outline',
                task.done ? new vscode.ThemeColor('charts.green') : undefined
            );
            this.contextValue = 'projectNavi:task';

            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${task.done ? '✅' : '🔲'} ${task.name}**\n\n`);
            md.appendMarkdown(task.hint ? '_클릭:_ 힌트 열기 (캐시됨)\n\n' : '_클릭:_ 힌트 받기\n\n');
            md.appendMarkdown('_체크 아이콘 클릭:_ 완료/해제');
            this.tooltip = md;

            // 단일 클릭 = 힌트 열기 (답 X, 방향만)
            this.command = {
                command: 'devnavi.projectNavi.hint',
                title: '힌트',
                arguments: [this]
            };
        }
    }
}

export class ProjectNaviProvider implements vscode.TreeDataProvider<ProjectNaviNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ProjectNaviNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly store: ProjectNaviStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(el: ProjectNaviNode): vscode.TreeItem {
        return el;
    }

    getChildren(el?: ProjectNaviNode): ProjectNaviNode[] {
        if (!el) {
            const projects = this.store.list();
            if (projects.length === 0) {
                return [new ProjectNaviNode('empty', '$(add) 새 프로젝트 시작하기')];
            }
            return projects.map((p) => new ProjectNaviNode('project', p.name, p));
        }

        if (el.kind === 'project' && el.project) {
            return el.project.phases.map((ph) => new ProjectNaviNode('phase', ph.name, el.project, ph));
        }

        if (el.kind === 'phase' && el.project && el.phase) {
            return el.phase.tasks.map((t) => new ProjectNaviNode('task', t.name, el.project, el.phase, t));
        }

        return [];
    }
}
