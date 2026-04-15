import * as vscode from 'vscode';

// 유저가 직접 추가한 커스텀 명령어
export interface CustomCommand {
    id: string;
    category: string;
    name: string;
    command: string;
    description: string;
    whenToUse: string;
}

const STORAGE_KEY = 'devnavi.customCommands';

// globalState에 커스텀 명령어 CRUD — DB가 아니라 VSCode 내장 저장소 사용
export class CustomCommandStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

    list(): CustomCommand[] {
        return this.context.globalState.get<CustomCommand[]>(STORAGE_KEY, []);
    }

    async add(cmd: Omit<CustomCommand, 'id'>): Promise<CustomCommand> {
        const created: CustomCommand = { ...cmd, id: generateId() };
        await this.save([...this.list(), created]);
        return created;
    }

    async update(id: string, patch: Partial<Omit<CustomCommand, 'id'>>): Promise<void> {
        await this.save(this.list().map((c) => (c.id === id ? { ...c, ...patch } : c)));
    }

    async remove(id: string): Promise<void> {
        await this.save(this.list().filter((c) => c.id !== id));
    }

    private save(next: CustomCommand[]): Thenable<void> {
        return this.context.globalState.update(STORAGE_KEY, next);
    }
}

function generateId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
