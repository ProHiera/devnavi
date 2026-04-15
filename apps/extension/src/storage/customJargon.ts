import * as vscode from 'vscode';

// 유저가 직접 추가한 커스텀 용어
export interface CustomJargon {
    id: string;
    term: string;
    bad: string;
    good: string;
    example: string;
}

const STORAGE_KEY = 'devnavi.customJargon';

// globalState에 커스텀 용어 CRUD
export class CustomJargonStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

    list(): CustomJargon[] {
        return this.context.globalState.get<CustomJargon[]>(STORAGE_KEY, []);
    }

    async add(entry: Omit<CustomJargon, 'id'>): Promise<CustomJargon> {
        const created: CustomJargon = { ...entry, id: generateId() };
        await this.save([...this.list(), created]);
        return created;
    }

    async update(id: string, patch: Partial<Omit<CustomJargon, 'id'>>): Promise<void> {
        await this.save(this.list().map((c) => (c.id === id ? { ...c, ...patch } : c)));
    }

    async remove(id: string): Promise<void> {
        await this.save(this.list().filter((c) => c.id !== id));
    }

    private save(next: CustomJargon[]): Thenable<void> {
        return this.context.globalState.update(STORAGE_KEY, next);
    }
}

function generateId(): string {
    return `jrg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
