import * as assert from 'assert';
import * as vscode from 'vscode';
import { indexLanguage } from '../connections/languageIndex';

suite('Language server connection traversal', () => {
    test('collects more than twenty references, follows outgoing calls and terminates cycles', async function () {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { this.skip(); return; }
        const uri = vscode.Uri.joinPath(folder.uri, 'connections.devnavi-test');
        const content = ['root()', 'dependency()', ...Array.from({ length: 31 }, (_, i) => `caller${i}() root()`) ].join('\n');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
        const selector = { scheme: 'file', pattern: '**/*.devnavi-test' };
        const range = (line: number) => new vscode.Range(line, 0, line, 4);
        const item = (name: string, line: number) => new vscode.CallHierarchyItem(vscode.SymbolKind.Function, name, '', uri, range(line), range(line));
        const subscriptions = [
            vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols: () => content.split('\n').map((line, index) => new vscode.DocumentSymbol(line.split('(')[0], '', vscode.SymbolKind.Function, new vscode.Range(index, 0, index, line.length), range(index))) }),
            vscode.languages.registerReferenceProvider(selector, { provideReferences: (_doc, pos) => pos.line === 0 ? Array.from({ length: 31 }, (_, i) => new vscode.Location(uri, new vscode.Range(i + 2, 10, i + 2, 14))) : [] }),
            vscode.languages.registerCallHierarchyProvider(selector, {
                prepareCallHierarchy: (_doc, pos) => item(pos.line === 0 ? 'root' : 'dependency', pos.line),
                provideCallHierarchyIncomingCalls: () => [],
                provideCallHierarchyOutgoingCalls: node => node.selectionRange.start.line === 0 ? [{ to: item('dependency', 1), fromRanges: [range(0)] }] : node.selectionRange.start.line === 1 ? [{ to: item('root', 0), fromRanges: [range(1)] }] : []
            })
        ];
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const graph = await indexLanguage(uri, new vscode.Position(0, 0), cancellation.token, () => {});
            const root = graph.nodes.find(node => node.name === 'root')!;
            assert.equal(graph.edges.filter(edge => edge.to === root.id && edge.kind === 'reference').length, 31);
            assert.equal(graph.edges.filter(edge => edge.kind === 'call').length, 2);
            assert.equal(graph.complete, true);
            assert.equal(graph.warnings.length, 0);
        } finally { subscriptions.forEach(item => item.dispose()); cancellation.dispose(); await vscode.workspace.fs.delete(uri); }
    });
});
