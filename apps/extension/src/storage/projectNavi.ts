import * as vscode from 'vscode';

// 부트캠프식 체크리스트 — 프로젝트 → Phase → Task 3단 구조
export interface TaskItem {
    id: string;
    name: string;
    done: boolean;
    hint?: string;               // AI가 준 힌트 캐시 (토큰 절약용)
}

export interface Phase {
    id: string;
    name: string;
    tasks: TaskItem[];
}

export interface Project {
    id: string;
    name: string;
    goal: string;                // 유저가 처음 입력한 한 줄
    phases: Phase[];
    createdAt: number;
}

const STORAGE_KEY = 'devnavi.projectNavi';

// globalState에 프로젝트 로드맵 CRUD — 재시작해도 진행 상황 유지
export class ProjectNaviStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

    list(): Project[] {
        return this.context.globalState.get<Project[]>(STORAGE_KEY, []);
    }

    get(id: string): Project | undefined {
        return this.list().find((p) => p.id === id);
    }

    async add(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
        const created: Project = { ...project, id: generateId('prj'), createdAt: Date.now() };
        await this.save([...this.list(), created]);
        return created;
    }

    async update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void> {
        await this.save(this.list().map((p) => (p.id === id ? { ...p, ...patch } : p)));
    }

    async remove(id: string): Promise<void> {
        await this.save(this.list().filter((p) => p.id !== id));
    }

    // 태스크 완료 토글 — 원자적 업데이트
    async toggleTask(projectId: string, phaseId: string, taskId: string): Promise<void> {
        const list = this.list();
        const next = list.map((p) => {
            if (p.id !== projectId) { return p; }
            return {
                ...p,
                phases: p.phases.map((ph) =>
                    ph.id !== phaseId ? ph : {
                        ...ph,
                        tasks: ph.tasks.map((t) => t.id !== taskId ? t : { ...t, done: !t.done })
                    }
                )
            };
        });
        await this.save(next);
    }

    // 태스크 힌트 캐싱 — 같은 태스크 두 번째 클릭 시 AI 호출 스킵
    async setTaskHint(projectId: string, phaseId: string, taskId: string, hint: string): Promise<void> {
        const list = this.list();
        const next = list.map((p) => {
            if (p.id !== projectId) { return p; }
            return {
                ...p,
                phases: p.phases.map((ph) =>
                    ph.id !== phaseId ? ph : {
                        ...ph,
                        tasks: ph.tasks.map((t) => t.id !== taskId ? t : { ...t, hint })
                    }
                )
            };
        });
        await this.save(next);
    }

    private save(next: Project[]): Thenable<void> {
        return this.context.globalState.update(STORAGE_KEY, next);
    }
}

// 진행률 계산 — UI 뱃지·상태바용
export function progressOf(project: Project): { done: number; total: number; ratio: number } {
    let done = 0;
    let total = 0;
    for (const phase of project.phases) {
        total += phase.tasks.length;
        done += phase.tasks.filter((t) => t.done).length;
    }
    return { done, total, ratio: total === 0 ? 0 : done / total };
}

export function phaseProgressOf(phase: Phase): { done: number; total: number } {
    return { done: phase.tasks.filter((t) => t.done).length, total: phase.tasks.length };
}

function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 새 Phase/Task ID는 스토어 밖에서도 생성 — AI 응답 파싱 시 사용
export function newPhaseId(): string { return generateId('ph'); }
export function newTaskId(): string { return generateId('tk'); }
