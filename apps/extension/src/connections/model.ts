// 화면과 분석기가 공유하는 실제 코드 연결 모델. 연결마다 원본 위치를 보존한다.
export type ConnectionKind = 'call' | 'render' | 'reference' | 'import' | 'reexport' | 'request';
export interface CodeLocation { file: string; line: number; character: number; text: string }
export interface CodeNode {
    id: string; name: string; file: string; line: number; character: number;
    start: number; end: number; kind: string; preview: string; external?: boolean;
}
export interface CodeEdge { from: string; to: string; kind: ConnectionKind; sites: CodeLocation[] }
export interface ConnectionGraph {
    nodes: CodeNode[]; edges: CodeEdge[]; root: string; files: number;
    engine: 'typescript' | 'language-server'; warnings: string[]; complete: boolean;
}
export interface IndexRequest {
    files: string[]; configs: string[]; roots: string[]; overlays: Record<string, string>;
    focus: { file: string; offset: number };
}
export const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}';
export const SOURCE_EXCLUDE = '**/{node_modules,.git,.next,.nuxt,dist,build,out,coverage,vendor,.dart_tool,.vscode-test}/**';

// 순환 참조가 있어도 각 노드는 한 번만 방문한다. 표시 단계와 수집 범위는 구분한다.
export function distances(graph: ConnectionGraph, root: string, direction: 'in' | 'out'): Map<string, number> {
    const adjacent = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
        const key = direction === 'in' ? edge.to : edge.from;
        const value = direction === 'in' ? edge.from : edge.to;
        if (!adjacent.has(key)) { adjacent.set(key, new Set()); }
        adjacent.get(key)!.add(value);
    }
    const result = new Map([[root, 0]]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        for (const next of adjacent.get(id) ?? []) {
            if (!result.has(next)) { result.set(next, result.get(id)! + 1); queue.push(next); }
        }
    }
    return result;
}
