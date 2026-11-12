import * as vscode from 'vscode';
import { CodeNode, CodeEdge, ConnectionGraph } from './model';

// JS/TS 이외의 언어는 설치된 언어 서버의 정의·참조·호출 계층을 사용한다.
// 문자열 검색 결과를 실제 참조로 둔갑시키지 않고, 제공자가 지원하는 연결만 표시한다.
export async function indexLanguage(
    uri: vscode.Uri, position: vscode.Position, token: vscode.CancellationToken,
    progress: (message: string) => void
): Promise<ConnectionGraph> {
    const nodes = new Map<string, CodeNode>();
    const edges = new Map<string, CodeEdge>();
    const documents = new Map<string, { document: vscode.TextDocument; symbols: CodeNode[] }>();
    const warnings = new Set<string>();
    const callableKinds = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor, vscode.SymbolKind.Class]);
    async function symbols(file: vscode.Uri) {
        const cached = documents.get(file.toString());
        if (cached) { return cached; }
        const document = await vscode.workspace.openTextDocument(file);
        const result = { document, symbols: [] as CodeNode[] };
        documents.set(file.toString(), result);
        const raw = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', file) ?? [];
        function collect(items: (vscode.DocumentSymbol | vscode.SymbolInformation)[]) {
            for (const item of items) {
                const range = 'range' in item ? item.range : item.location.range;
                const selection = 'selectionRange' in item ? item.selectionRange : range;
                const node: CodeNode = {
                    id: `${file.toString()}#${document.offsetAt(selection.start)}`, name: item.name,
                    file: file.fsPath, line: selection.start.line + 1, character: selection.start.character,
                    start: document.offsetAt(range.start), end: document.offsetAt(range.end),
                    kind: item.kind === vscode.SymbolKind.Class ? 'class' : callableKinds.has(item.kind) ? 'function' : 'value',
                    preview: document.getText(range).slice(0, 1800)
                };
                nodes.set(node.id, node); result.symbols.push(node);
                if ('children' in item) { collect(item.children); }
            }
        }
        collect(raw);
        return result;
    }
    async function at(file: vscode.Uri, pos: vscode.Position): Promise<CodeNode> {
        const data = await symbols(file);
        const offset = data.document.offsetAt(pos);
        const candidates = data.symbols.filter(n => n.start <= offset && n.end >= offset).sort((a, b) => a.end - a.start - (b.end - b.start));
        if (candidates.length) { return candidates[0]; }
        const range = data.document.getWordRangeAtPosition(pos);
        const start = range?.start ?? pos;
        const id = `${file.toString()}#${data.document.offsetAt(start)}`;
        const node = nodes.get(id) ?? {
            id, name: range ? data.document.getText(range) : vscode.workspace.asRelativePath(file), file: file.fsPath,
            line: start.line + 1, character: start.character, start: data.document.offsetAt(start), end: data.document.offsetAt(range?.end ?? pos),
            kind: 'value', preview: data.document.lineAt(pos.line).text
        };
        nodes.set(id, node); return node;
    }
    async function connect(from: CodeNode, to: CodeNode, file: vscode.Uri, range: vscode.Range, kind: 'call' | 'reference') {
        if (from.id === to.id && kind !== 'call') { return; }
        const document = await vscode.workspace.openTextDocument(file);
        const key = `${from.id}|${to.id}|${kind}`;
        const edge = edges.get(key) ?? { from: from.id, to: to.id, kind, sites: [] };
        if (!edge.sites.some(s => s.file === file.fsPath && s.line === range.start.line + 1 && s.character === range.start.character)) {
            edge.sites.push({ file: file.fsPath, line: range.start.line + 1, character: range.start.character, text: document.lineAt(range.start.line).text.trim().slice(0, 400) });
        }
        edges.set(key, edge);
    }
    const definition = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, position);
    const first = definition?.[0];
    const rootUri = first ? 'targetUri' in first ? first.targetUri : first.uri : uri;
    const rootPos = first ? 'targetUri' in first ? (first.targetSelectionRange ?? first.targetRange).start : first.range.start : position;
    const root = await at(rootUri, rootPos);
    const queue = [root];
    const seen = new Set<string>();
    let callSupport = false;
    for (let i = 0; i < queue.length && !token.isCancellationRequested; i++) {
        const current = queue[i];
        if (seen.has(current.id)) { continue; }
        seen.add(current.id);
        progress(`연결을 따라가는 중 · ${seen.size}개 코드 · ${documents.size}개 파일`);
        const file = vscode.Uri.file(current.file);
        const point = new vscode.Position(current.line - 1, current.character);
        try {
            const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', file, point) ?? [];
            for (const ref of refs) {
                if (token.isCancellationRequested) { break; }
                if (!vscode.workspace.getWorkspaceFolder(ref.uri)) { continue; }
                const from = await at(ref.uri, ref.range.start);
                await connect(from, current, ref.uri, ref.range, 'reference');
                if (!seen.has(from.id)) { queue.push(from); }
            }
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', file, point) ?? [];
            callSupport ||= items.length > 0;
            for (const item of items) {
                const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item) ?? [];
                for (const call of calls) {
                    if (token.isCancellationRequested) { break; }
                    if (!vscode.workspace.getWorkspaceFolder(call.to.uri)) { continue; }
                    const to = await at(call.to.uri, call.to.selectionRange.start);
                    for (const range of call.fromRanges) { await connect(current, to, item.uri, range, 'call'); }
                    if (!seen.has(to.id)) { queue.push(to); }
                }
            }
        } catch (error) { warnings.add(`${current.name}: ${error instanceof Error ? error.message : '언어 서버 응답 오류'}`); }
    }
    if (!callSupport) { warnings.add('이 언어 서버가 호출 계층을 제공하지 않아 사용처 연결을 중심으로 표시합니다.'); }
    if (token.isCancellationRequested) { warnings.add('분석을 중지했습니다. 지금까지 찾은 연결을 표시합니다.'); }
    return { nodes: [...nodes.values()], edges: [...edges.values()], root: root.id, files: documents.size, engine: 'language-server', warnings: [...warnings], complete: !token.isCancellationRequested };
}
