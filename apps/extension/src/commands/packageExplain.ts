import * as vscode from 'vscode';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import { InlineThread } from '../utils/inlineThread';
import { buildPackageExplainMessages } from '../utils/prompts';

// 패키지 설명 전용 인라인 컨트롤러 — 선택한 패키지 이름 바로 아래 설명.
export class PackageInlineController extends InlineThread {
    constructor() { super('devnavi.packageExplain', 'DevNavi 패키지 설명'); }
    openForPackage(editor: vscode.TextEditor, pkg: string): vscode.CommentThread {
        return this.open(editor, `📦 ${pkg}`, `🧭 _"${pkg}" 설명 찾는 중…_`);
    }
}

// 패키지 하나 물어보면 AI 설명 + 결과는 캐시. 같은 이름 두 번째부터 토큰 0원.
const PACKAGE_EXPLAIN_SCHEME = 'devnavi-package';
const CACHE_KEY = 'devnavi.packageExplain.cache';
const MAX_CACHE = 200;

type Ecosystem = 'npm' | 'pip' | 'maven' | 'gradle';

interface CacheValue {
    ecosystem: Ecosystem;
    answer: string;
    at: number;
}

export class PackageExplainCache {
    constructor(private readonly context: vscode.ExtensionContext) {}

    private read(): Record<string, CacheValue> {
        return this.context.globalState.get<Record<string, CacheValue>>(CACHE_KEY, {});
    }

    get(pkg: string, ecosystem: Ecosystem): string | undefined {
        const hit = this.read()[key(pkg, ecosystem)];
        return hit?.answer;
    }

    async set(pkg: string, ecosystem: Ecosystem, answer: string): Promise<void> {
        const all = this.read();
        all[key(pkg, ecosystem)] = { ecosystem, answer, at: Date.now() };
        // LRU 비슷하게 오래된 것 컷
        const entries = Object.entries(all);
        if (entries.length > MAX_CACHE) {
            entries.sort((a, b) => b[1].at - a[1].at);
            const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE));
            await this.context.globalState.update(CACHE_KEY, trimmed);
        } else {
            await this.context.globalState.update(CACHE_KEY, all);
        }
    }

    async clear(): Promise<number> {
        const count = Object.keys(this.read()).length;
        await this.context.globalState.update(CACHE_KEY, {});
        return count;
    }

    // 활성화 시 1회 — 과거에 저장된 "모름" fallback 응답을 조용히 제거.
    // (이전 버전이 캐시했던 오염된 엔트리 정리용)
    async pruneNoAnswers(): Promise<number> {
        const all = this.read();
        let removed = 0;
        for (const [k, v] of Object.entries(all)) {
            if (isNoAnswer(v.answer)) {
                delete all[k];
                removed++;
            }
        }
        if (removed > 0) {
            await this.context.globalState.update(CACHE_KEY, all);
        }
        return removed;
    }
}

// LLM이 "모름" fallback으로 답한 경우를 감지. 캐시 저장 차단용.
function isNoAnswer(answer: string): boolean {
    const normalized = answer.toLowerCase().replace(/\s+/g, '');
    return /잘모르겠어|잘모르겠|직접찾아봐|don't know|do not know/i.test(normalized);
}

function key(pkg: string, ecosystem: Ecosystem): string {
    return `${ecosystem}:${pkg.toLowerCase()}`;
}

export class PackageExplainContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new PackageExplainContent();
    static readonly SCHEME = PACKAGE_EXPLAIN_SCHEME;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private readonly store = new Map<string, string>();

    put(uri: vscode.Uri, body: string): void {
        this.store.set(uri.toString(), body);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.store.get(uri.toString()) ?? '_설명을 불러오지 못했어._';
    }
}

export async function explainPackage(
    keys: ApiKeyStore,
    tracker: TokenTrackerStore,
    cache: PackageExplainCache,
    inline: PackageInlineController
): Promise<void> {
    const picked = await resolveTarget();
    if (!picked) { return; }

    const { pkg, ecosystem } = picked;
    const editor = vscode.window.activeTextEditor;

    // 캐시 히트 → 토큰 0원
    const cached = cache.get(pkg, ecosystem);
    if (cached) {
        void tracker.record({
            provider: 'claude',
            model: 'cache',
            feature: 'packageExplain.cache',
            question: normalizeQuestion(`${ecosystem} ${pkg}`),
            promptChars: 0,
            responseChars: 0,
            cached: true
        });
        await showResult(editor, inline, pkg, renderCached(pkg, ecosystem, cached));
        return;
    }

    // AI 호출 — 에디터 있으면 인라인 스레드, 없으면 마크다운 프리뷰
    let thread: vscode.CommentThread | undefined;
    let uri: vscode.Uri | undefined;
    if (editor) {
        thread = inline.openForPackage(editor, pkg);
    } else {
        uri = vscode.Uri.parse(`${PACKAGE_EXPLAIN_SCHEME}:${ecosystem}-${safe(pkg)}-${Date.now()}.md`);
        PackageExplainContent.instance.put(uri, `# 📦 ${pkg}\n\n_AI가 분석 중…_`);
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    }

    try {
        const answer = await trackedAskLLM(
            keys,
            tracker,
            'packageExplain.ai',
            normalizeQuestion(`${ecosystem} ${pkg}`),
            buildPackageExplainMessages(pkg, ecosystem)
        );
        // "모름" fallback 응답은 캐시에 저장하지 않음 — 다음번에 재시도할 기회를 남김
        if (!isNoAnswer(answer)) {
            await cache.set(pkg, ecosystem, answer);
        }
        const rendered = renderAI(pkg, ecosystem, answer);
        if (thread) { inline.setMarkdown(thread, rendered); }
        else if (uri) { PackageExplainContent.instance.put(uri, rendered); }
    } catch (err) {
        if (thread) { inline.setError(thread, err); }
        else if (uri) { PackageExplainContent.instance.put(uri, renderError(pkg, ecosystem, err)); }
    }
}

// 에디터 있으면 인라인, 없으면 프리뷰로 결과 렌더
async function showResult(
    editor: vscode.TextEditor | undefined,
    inline: PackageInlineController,
    pkg: string,
    markdown: string
): Promise<void> {
    if (editor) {
        const thread = inline.openForPackage(editor, pkg);
        inline.setMarkdown(thread, markdown);
        return;
    }
    await openPreview(markdown);
}

// 에디터 선택 → 현재 package.json 의존성 QuickPick → 수동 입력
async function resolveTarget(): Promise<{ pkg: string; ecosystem: Ecosystem } | undefined> {
    const editor = vscode.window.activeTextEditor;

    // 에디터 선택이 있으면 그 안에서 패키지명 추출 → 바로 인라인으로 열기
    // (드래그 범위가 따옴표/버전까지 포함돼도 패키지명만 뽑음)
    if (editor && !editor.selection.isEmpty) {
        const pkg = extractPackageName(editor.document.getText(editor.selection));
        if (pkg) {
            const ecosystem = guessEcosystemFromDocument(editor.document) ?? 'npm';
            return { pkg, ecosystem };
        }
    }

    // 워크스페이스 의존성 모아서 QuickPick
    const deps = await collectWorkspaceDeps();
    if (deps.length > 0) {
        const picked = await vscode.window.showQuickPick(
            [
                { label: '$(edit) 직접 입력…', pkg: '', ecosystem: 'npm' as Ecosystem },
                ...deps.map((d) => ({
                    label: d.pkg,
                    description: d.ecosystem,
                    detail: d.source,
                    pkg: d.pkg,
                    ecosystem: d.ecosystem
                }))
            ],
            { placeHolder: '설명이 궁금한 패키지 선택', matchOnDescription: true, matchOnDetail: true }
        );
        if (!picked) { return undefined; }
        if (picked.pkg) { return { pkg: picked.pkg, ecosystem: picked.ecosystem }; }
    }

    // 수동 입력
    const manual = await vscode.window.showInputBox({
        prompt: '설명이 궁금한 패키지 이름을 입력해 (예: axios, numpy)',
        placeHolder: 'axios'
    });
    if (!manual) { return undefined; }

    const ecosystem = await vscode.window.showQuickPick(
        [
            { label: 'npm (JS/TS)', value: 'npm' as Ecosystem },
            { label: 'pip (Python)', value: 'pip' as Ecosystem },
            { label: 'Maven (Java)', value: 'maven' as Ecosystem },
            { label: 'Gradle (Java/Kotlin)', value: 'gradle' as Ecosystem }
        ],
        { placeHolder: '어느 생태계?' }
    );
    if (!ecosystem) { return undefined; }
    return { pkg: manual.trim(), ecosystem: ecosystem.value };
}

interface DepEntry { pkg: string; ecosystem: Ecosystem; source: string; }

async function collectWorkspaceDeps(): Promise<DepEntry[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const out: DepEntry[] = [];
    const seen = new Set<string>();

    for (const folder of folders) {
        // package.json
        for (const uri of await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/package.json'),
            '**/node_modules/**',
            20
        )) {
            const deps = await readPackageJson(uri);
            for (const pkg of deps) {
                const k = `npm:${pkg}`;
                if (seen.has(k)) { continue; }
                seen.add(k);
                out.push({ pkg, ecosystem: 'npm', source: vscode.workspace.asRelativePath(uri) });
            }
        }

        // requirements.txt
        for (const uri of await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/requirements*.txt'),
            '**/{node_modules,venv,.venv}/**',
            10
        )) {
            const deps = await readRequirementsTxt(uri);
            for (const pkg of deps) {
                const k = `pip:${pkg}`;
                if (seen.has(k)) { continue; }
                seen.add(k);
                out.push({ pkg, ecosystem: 'pip', source: vscode.workspace.asRelativePath(uri) });
            }
        }
    }

    return out.slice(0, 300);
}

async function readPackageJson(uri: vscode.Uri): Promise<string[]> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return [
            ...Object.keys(json.dependencies ?? {}),
            ...Object.keys(json.devDependencies ?? {}),
            ...Object.keys(json.peerDependencies ?? {})
        ];
    } catch {
        return [];
    }
}

async function readRequirementsTxt(uri: vscode.Uri): Promise<string[]> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf8');
        return text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
            .map((line) => line.split(/[=<>!~;\s]/)[0])
            .filter((name) => /^[A-Za-z0-9_.\-]+$/.test(name));
    } catch {
        return [];
    }
}

// 선택 텍스트에서 패키지명만 뽑아냄. 따옴표/콜론/버전/줄바꿈 섞여 있어도 OK.
// 매칭: @scope/name (npm 스코프) 또는 plain name (영숫자/점/대시/언더스코어).
// package.json의 메타 키(name, version, dependencies 등)는 스킵하고 그 다음 토큰을 시도.
const PACKAGE_JSON_META_KEYS = new Set([
    'name', 'version', 'description', 'main', 'module', 'types', 'type',
    'scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
    'keywords', 'author', 'license', 'repository', 'bugs', 'homepage',
    'engines', 'private', 'workspaces', 'publisher', 'displayName',
    'contributes', 'activationEvents', 'categories', 'icon', 'files'
]);

function extractPackageName(text: string): string | undefined {
    const re = /@[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+|[A-Za-z_][A-Za-z0-9_.\-]*/g;
    for (const match of text.matchAll(re)) {
        const name = match[0];
        if (name.length === 0 || name.length > 80) { continue; }
        if (PACKAGE_JSON_META_KEYS.has(name)) { continue; }
        return name;
    }
    return undefined;
}

function guessEcosystemFromDocument(doc: vscode.TextDocument): Ecosystem | undefined {
    const path = doc.uri.path.toLowerCase();
    if (path.endsWith('/package.json') || path.endsWith('package.json')) { return 'npm'; }
    if (path.includes('requirements') && path.endsWith('.txt')) { return 'pip'; }
    if (path.endsWith('/pom.xml')) { return 'maven'; }
    if (path.endsWith('.gradle') || path.endsWith('.gradle.kts')) { return 'gradle'; }
    return undefined;
}

// -- 렌더링 --------------------------------------------------------------

function renderAI(pkg: string, ecosystem: Ecosystem, answer: string): string {
    return [
        answer,
        '',
        '---',
        '',
        `_생태계: ${ecosystem} · 첫 호출이라 AI에 물었어. 다음부터는 캐시에서 바로 꺼내._`,
        ...externalLinks(pkg, ecosystem)
    ].join('\n');
}

function renderCached(pkg: string, ecosystem: Ecosystem, answer: string): string {
    return [
        answer,
        '',
        '---',
        '',
        `_캐시 히트 · 토큰 0원 · 생태계: ${ecosystem}_`,
        ...externalLinks(pkg, ecosystem)
    ].join('\n');
}

function renderError(pkg: string, ecosystem: Ecosystem, err: unknown): string {
    let msg: string;
    if (err instanceof NoApiKeyError) {
        msg = `⚠️ ${err.message}`;
    } else if (err instanceof LLMError) {
        msg = `⚠️ ${err.message}`;
    } else {
        msg = `⚠️ ${err instanceof Error ? err.message : String(err)}`;
    }
    return [
        `# 📦 ${pkg}`,
        '',
        msg,
        '',
        ...externalLinks(pkg, ecosystem)
    ].join('\n');
}

function externalLinks(pkg: string, ecosystem: Ecosystem): string[] {
    const enc = encodeURIComponent(pkg);
    switch (ecosystem) {
        case 'npm':
            return ['', `🔗 [npm 공식](https://www.npmjs.com/package/${enc}) · [GitHub 검색](https://github.com/search?q=${enc})`];
        case 'pip':
            return ['', `🔗 [PyPI](https://pypi.org/project/${enc}/)`];
        case 'maven':
        case 'gradle':
            return ['', `🔗 [mvnrepository](https://mvnrepository.com/search?q=${enc})`];
    }
}

async function openPreview(body: string): Promise<void> {
    const uri = vscode.Uri.parse(`${PACKAGE_EXPLAIN_SCHEME}:cache-${Date.now()}.md`);
    PackageExplainContent.instance.put(uri, body);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

function safe(s: string): string {
    return s.replace(/[^A-Za-z0-9._-]/g, '_');
}
