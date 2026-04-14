import * as vscode from 'vscode';

// 폴더/파일 설명 엔트리 — 워크스페이스 루트 기준 상대 경로를 키로
interface MapEntry {
    badge?: string;   // 최대 2글자 — Explorer에 표시
    tooltip: string;  // hover 시 설명 (연결 관계 포함)
    color?: string;   // VSCode ThemeColor key (예: "charts.blue")
}

type MapFile = Record<string, MapEntry>;

const CONFIG_PATH = '.devnavi/projectMap.json';

// Explorer에 폴더/파일이 "뭔지 / 어디랑 연결되는지" 뱃지 + 툴팁으로 보여줌
// 데이터 소스: 워크스페이스 루트의 .devnavi/projectMap.json
export class ProjectMapProvider implements vscode.FileDecorationProvider, vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    private map = new Map<string, MapEntry>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        void this.reload();

        const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_PATH}`);
        watcher.onDidChange(() => this.reload());
        watcher.onDidCreate(() => this.reload());
        watcher.onDidDelete(() => this.reload());

        this.disposables.push(
            watcher,
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload())
        );
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const entry = this.map.get(uri.fsPath);
        if (!entry) { return undefined; }

        return {
            badge: entry.badge?.slice(0, 2),
            tooltip: entry.tooltip,
            color: entry.color ? new vscode.ThemeColor(entry.color) : undefined
        };
    }

    private async reload(): Promise<void> {
        const next = new Map<string, MapEntry>();

        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const file = vscode.Uri.joinPath(folder.uri, ...CONFIG_PATH.split('/'));
            try {
                const bytes = await vscode.workspace.fs.readFile(file);
                const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as MapFile;
                for (const [rel, entry] of Object.entries(json)) {
                    const abs = vscode.Uri.joinPath(folder.uri, ...rel.split('/')).fsPath;
                    next.set(abs, entry);
                }
            } catch {
                // 파일 없거나 parse 실패 — 해당 워크스페이스는 skip
            }
        }

        this.map = next;
        this._onDidChange.fire(undefined);
    }

    dispose(): void {
        for (const d of this.disposables) { d.dispose(); }
        this._onDidChange.dispose();
    }
}
