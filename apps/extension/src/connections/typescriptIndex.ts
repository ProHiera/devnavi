import * as ts from 'typescript';
import * as path from 'path';
import { CodeEdge, CodeNode, ConnectionGraph, ConnectionKind, IndexRequest } from './model';

const key = (file: string) => {
    const normalized = path.resolve(file).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

// 컴파일러는 워커 안에서 실행한다. 프로젝트 코드를 실행하거나 emit하지 않는다.
export function indexTypeScript(request: IndexRequest, progress: (text: string) => void = () => {}): ConnectionGraph {
    const allowed = new Set(request.files.map(key));
    const overlays = new Map(Object.entries(request.overlays).map(([file, text]) => [key(file), text]));
    const read = (file: string) => overlays.get(key(file)) ?? ts.sys.readFile(file);
    const nodes = new Map<string, CodeNode>();
    const edges = new Map<string, CodeEdge>();
    const warnings = new Set<string>();
    let root = '';
    const baseOptions: ts.CompilerOptions = {
        allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true, skipLibCheck: true, noLib: true, types: [], allowImportingTsExtensions: true
    };
    const configs = request.configs.map(file => {
        const config = ts.readConfigFile(file, read);
        if (config.error) { warnings.add(`설정 파일을 읽지 못했습니다: ${path.basename(file)}`); }
        const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, { ...ts.sys, readFile: read }, path.dirname(file));
        return { file, parsed, members: new Set(parsed.fileNames.map(key)) };
    }).sort((a, b) => path.dirname(b.file).length - path.dirname(a.file).length || a.file.localeCompare(b.file));
    const groups = new Map<string, { files: string[]; options: ts.CompilerOptions }>();
    for (const file of request.files) {
        const config = configs.find(c => c.members.has(key(file))) ?? configs.find(c => {
            const relative = path.relative(path.dirname(c.file), file);
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });
        const groupKey = config?.file ?? '__default__';
        if (!groups.has(groupKey)) { groups.set(groupKey, { files: [], options: { ...baseOptions, ...config?.parsed.options, noEmit: true, noLib: true, types: [] } }); }
        groups.get(groupKey)!.files.push(file);
    }

    let processed = 0;
    for (const group of groups.values()) {
        progress(`프로젝트 분석 중 · ${processed}/${request.files.length}개 파일`);
        const host = ts.createCompilerHost(group.options, true);
        host.readFile = read;
        host.fileExists = file => overlays.has(key(file)) || ts.sys.fileExists(file);
        host.getSourceFile = (file, version) => {
            const text = read(file);
            return text === undefined ? undefined : ts.createSourceFile(file, text, version, true);
        };
        const program = ts.createProgram(group.files, group.options, host);
        const checker = program.getTypeChecker();
        const sourceFiles = program.getSourceFiles().filter(sf => allowed.has(key(sf.fileName)));
        const owners = new Map<ts.Node, CodeNode>();
        const symbolNodes = new Map<ts.Symbol, CodeNode>();
        const lines = new Map(sourceFiles.map(sf => [sf, sf.text.split(/\r?\n/)]));

        function canonical(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
            const seen = new Set<ts.Symbol>();
            while (symbol && (symbol.flags & ts.SymbolFlags.Alias) && !seen.has(symbol)) {
                seen.add(symbol);
                const next = checker.getAliasedSymbol(symbol);
                if (next === symbol) { break; }
                symbol = next;
            }
            return symbol;
        }
        function addNode(ast: ts.Node, nameNode: ts.Node | undefined, name: string, kind: string): CodeNode {
            const sf = ast.getSourceFile();
            const start = (nameNode ?? ast).getStart(sf);
            const position = sf.getLineAndCharacterOfPosition(start);
            const id = `${key(sf.fileName)}#${start}:${kind === 'file' ? 'file' : 'symbol'}`;
            const result: CodeNode = nodes.get(id) ?? {
                id, name, file: sf.fileName, line: position.line + 1, character: position.character,
                start: ast.getStart(sf), end: ast.end, kind,
                preview: ast.getText(sf).slice(0, 1800)
            };
            nodes.set(id, result);
            owners.set(ast, result);
            const symbol = canonical(nameNode ? checker.getSymbolAtLocation(nameNode) : undefined);
            if (symbol) { symbolNodes.set(symbol, result); }
            return result;
        }
        function classify(name: string, ast: ts.Node): string {
            if (ts.isClassDeclaration(ast)) { return 'class'; }
            if (ts.isInterfaceDeclaration(ast) || ts.isTypeAliasDeclaration(ast) || ts.isEnumDeclaration(ast)) { return 'type'; }
            if (/^use[A-Z]/.test(name)) { return 'hook'; }
            if (/^(page|layout)$/i.test(path.basename(ast.getSourceFile().fileName).split('.')[0]) && /^[A-Z]/.test(name)) { return 'page'; }
            if (/^[A-Z]/.test(name) && /\.(t|j)sx$/i.test(ast.getSourceFile().fileName)) { return 'component'; }
            if (ts.isFunctionDeclaration(ast) || ts.isMethodDeclaration(ast) ||
                (ts.isVariableDeclaration(ast) && isCallable(ast))) { return 'function'; }
            return 'value';
        }
        function isCallable(ast: ts.VariableDeclaration): boolean {
            const init = ast.initializer;
            if (!init) { return false; }
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) { return true; }
            if (ts.isCallExpression(init)) {
                if (checker.getTypeAtLocation(ast.name).getCallSignatures().length > 0) { return true; }
                const callee = ts.isPropertyAccessExpression(init.expression) ? init.expression.name.text : init.expression.getText();
                return /^(useCallback|memo|forwardRef)$/.test(callee) && init.arguments.some(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
            }
            return false;
        }
        function collect(ast: ts.Node, insideFunction = false): void {
            let nameNode: ts.Node | undefined;
            let name: string | undefined;
            if (ts.isFunctionDeclaration(ast) || ts.isClassDeclaration(ast) || ts.isMethodDeclaration(ast) ||
                ts.isGetAccessor(ast) || ts.isSetAccessor(ast) || ts.isInterfaceDeclaration(ast) || ts.isTypeAliasDeclaration(ast) || ts.isEnumDeclaration(ast)) {
                nameNode = ast.name;
                name = nameNode?.getText() ?? `default · ${path.basename(ast.getSourceFile().fileName)}`;
            } else if (ts.isVariableDeclaration(ast) && ts.isIdentifier(ast.name)) {
                const callable = isCallable(ast);
                if (!insideFunction || callable) { nameNode = ast.name; name = ast.name.text; }
            }
            if (name) { addNode(ast, nameNode, name, classify(name, ast)); }
            const nested = insideFunction || ts.isFunctionLike(ast);
            ts.forEachChild(ast, child => collect(child, nested));
        }
        for (const sf of sourceFiles) {
            addNode(sf, undefined, path.basename(sf.fileName), 'file');
            collect(sf);
        }
        function owner(ast: ts.Node): CodeNode | undefined {
            let at: ts.Node | undefined = ast;
            while (at) {
                const result = owners.get(at);
                if (result) { return result; }
                at = at.parent;
            }
            return undefined;
        }
        function symbolTarget(input: ts.Symbol | undefined, seen = new Set<ts.Symbol>()): CodeNode | undefined {
            const symbol = canonical(input);
            if (!symbol || seen.has(symbol)) { return undefined; }
            seen.add(symbol);
            const local = symbolNodes.get(symbol);
            if (local) { return local; }
            for (const declaration of symbol.declarations ?? []) {
                if (!allowed.has(key(declaration.getSourceFile().fileName))) { continue; }
                const exact = owners.get(declaration);
                if (exact) { return exact; }
                if (ts.isShorthandPropertyAssignment(declaration)) {
                    const result = symbolTarget(checker.getShorthandAssignmentValueSymbol(declaration), seen);
                    if (result) { return result; }
                }
                if (ts.isPropertyAssignment(declaration) && ts.isIdentifier(declaration.initializer)) {
                    const result = symbolTarget(checker.getSymbolAtLocation(declaration.initializer), seen);
                    if (result) { return result; }
                }
                if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent) && ts.isVariableDeclaration(declaration.parent.parent)) {
                    const initializer = declaration.parent.parent.initializer;
                    const property = (declaration.propertyName ?? declaration.name).getText();
                    if (initializer) {
                        const result = symbolTarget(checker.getTypeAtLocation(initializer).getProperty(property), seen);
                        if (result) { return result; }
                    }
                }
            }
            return undefined;
        }
        function target(ast: ts.Node): CodeNode | undefined {
            let symbol = checker.getSymbolAtLocation(ast);
            if (ts.isShorthandPropertyAssignment(ast.parent)) { symbol = checker.getShorthandAssignmentValueSymbol(ast.parent) ?? symbol; }
            return symbolTarget(symbol);
        }
        function isAxios(ast: ts.Expression, seen = new Set<ts.Symbol>()): boolean {
            const symbol = checker.getSymbolAtLocation(ast);
            if (!symbol || seen.has(symbol)) { return false; }
            seen.add(symbol);
            for (const declaration of symbol.declarations ?? []) {
                if (ts.isImportClause(declaration) && ts.isStringLiteral(declaration.parent.moduleSpecifier) && declaration.parent.moduleSpecifier.text === 'axios') { return true; }
            }
            const resolved = canonical(symbol);
            for (const declaration of resolved?.declarations ?? []) {
                if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
                    const init = declaration.initializer;
                    if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'create') { return isAxios(init.expression.expression, seen); }
                }
            }
            return false;
        }
        function connect(from: CodeNode, to: CodeNode, kind: ConnectionKind, ast: ts.Node): void {
            // 자기 재귀 호출은 보존한다. 선언 자체를 참조로 세지 않는다.
            if (from.id === to.id && kind !== 'call') { return; }
            const sf = ast.getSourceFile();
            const pos = sf.getLineAndCharacterOfPosition(ast.getStart(sf));
            const edgeKey = `${from.id}|${to.id}|${kind}`;
            const edge = edges.get(edgeKey) ?? { from: from.id, to: to.id, kind, sites: [] };
            if (!edge.sites.some(s => key(s.file) === key(sf.fileName) && s.line === pos.line + 1 && s.character === pos.character)) {
                edge.sites.push({ file: sf.fileName, line: pos.line + 1, character: pos.character, text: (lines.get(sf)?.[pos.line] ?? '').trim().slice(0, 400) });
            }
            edges.set(edgeKey, edge);
        }
        function external(name: string): CodeNode {
            const id = `external:${name}`;
            if (!nodes.has(id)) { nodes.set(id, { id, name, file: '', line: 0, character: 0, start: 0, end: 0, kind: 'external', preview: '', external: true }); }
            return nodes.get(id)!;
        }
        function visit(ast: ts.Node): void {
            const current = owner(ast);
            if (!current) { return; }
            const sf = ast.getSourceFile();
            if ((ts.isImportDeclaration(ast) || ts.isExportDeclaration(ast)) && ast.moduleSpecifier && ts.isStringLiteralLike(ast.moduleSpecifier)) {
                const moduleName = ast.moduleSpecifier.text;
                const resolved = ts.resolveModuleName(moduleName, sf.fileName, group.options, host).resolvedModule;
                const localFile = resolved && sourceFiles.find(file => key(file.fileName) === key(resolved.resolvedFileName));
                const to = localFile ? owners.get(localFile)! : external(moduleName);
                if (!resolved && (moduleName.startsWith('.') || moduleName.startsWith('@/'))) { warnings.add(`미해결 import: ${path.basename(sf.fileName)} → ${moduleName}`); }
                connect(owners.get(sf)!, to, ts.isExportDeclaration(ast) ? 'reexport' : 'import', ast.moduleSpecifier);
            }
            if (ts.isCallExpression(ast)) {
                const expression = ast.expression;
                const name = expression.getText(sf);
                const fetchCall = name === 'fetch' && !target(expression);
                const axiosCall = ts.isPropertyAccessExpression(expression) && /^(get|post|put|patch|delete|head|options)$/.test(expression.name.text) && isAxios(expression.expression);
                if (fetchCall || axiosCall) {
                    const arg = ast.arguments[0];
                    const url = arg && ts.isStringLiteralLike(arg) ? arg.text : arg && ts.isTemplateExpression(arg) ? arg.getText().slice(1, -1) : '(동적 주소)';
                    const method = axiosCall ? expression.name.text.toUpperCase() : 'fetch';
                    connect(current, external(`${method} · ${url}`), 'request', ast);
                }
            }
            if (ts.isIdentifier(ast)) {
                const parent = ast.parent;
                const declarationName = (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
                    ts.isMethodDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
                    ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isTypeParameterDeclaration(parent) ||
                    ts.isEnumDeclaration(parent) || ts.isBindingElement(parent)) && parent.name === ast;
                const inImport = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent);
                if (!declarationName && !inImport && !ts.isJsxClosingElement(parent)) {
                    const to = target(ast);
                    const isCall = (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === ast ||
                        ts.isPropertyAccessExpression(parent) && parent.name === ast && (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent)) && parent.parent.expression === parent;
                    const isRender = (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === ast;
                    if (to) { connect(current, to, isRender ? 'render' : isCall ? 'call' : 'reference', ast); }
                }
                if (key(sf.fileName) === key(request.focus.file) && ast.getStart(sf) <= request.focus.offset && ast.end >= request.focus.offset) {
                    root = target(ast)?.id ?? owner(ast)?.id ?? root;
                }
            }
            ts.forEachChild(ast, visit);
        }
        for (const sf of sourceFiles) { visit(sf); }
        if (!root) {
            const candidates = [...nodes.values()].filter(n => key(n.file || '.') === key(request.focus.file) && n.start <= request.focus.offset && n.end >= request.focus.offset);
            root = candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.id ?? '';
        }
        processed += group.files.length;
    }
    progress(`연결 정리 중 · ${nodes.size}개 코드`);
    return { nodes: [...nodes.values()], edges: [...edges.values()], root: root || nodes.keys().next().value || '', files: request.files.length, engine: 'typescript', warnings: [...warnings], complete: true };
}
