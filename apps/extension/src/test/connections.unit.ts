import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { indexTypeScript } from '../connections/typescriptIndex';
import { ConnectionGraph, distances } from '../connections/model';

function project(files: Record<string, string>, focusFile: string, focusWord: string, overlays: Record<string, string> = {}): ConnectionGraph {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devnavi-graph-'));
    try {
        for (const [file, text] of Object.entries(files)) { const absolute = path.join(dir, file); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, text); }
        const focusText = overlays[focusFile] ?? files[focusFile];
        return indexTypeScript({ files: Object.keys(files).filter(file => /\.[jt]sx?$/.test(file)).map(file => path.join(dir, file)), configs: Object.keys(files).filter(file => /config.*\.json$/.test(file)).map(file => path.join(dir, file)), roots: [dir], overlays: Object.fromEntries(Object.entries(overlays).map(([file, text]) => [path.join(dir, file), text])), focus: { file: path.join(dir, focusFile), offset: focusText.indexOf(focusWord) } });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const find = (graph: ConnectionGraph, name: string) => graph.nodes.find(node => node.name === name)!;
function has(graph: ConnectionGraph, from: string, to: string, kind?: string) {
    return graph.edges.some(edge => graph.nodes.find(node => node.id === edge.from)?.name === from && graph.nodes.find(node => node.id === edge.to)?.name === to && (!kind || edge.kind === kind));
}

test('follows React pages through aliased barrel exports, hooks and an API request', () => {
    const graph = project({
        'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] }, jsx: 'preserve' } }),
        'src/api.ts': 'export async function loadEvents() { return fetch("/api/events"); }',
        'src/useEvents.ts': 'import { loadEvents } from "./api"; export function useEvents() { return loadEvents(); }',
        'src/Card.tsx': 'import { useEvents } from "./useEvents"; export function EventCard() { const data = useEvents(); return <div>{data}</div>; }',
        'src/index.ts': 'export { EventCard as Card } from "./Card";',
        'src/page.tsx': 'import { Card } from "@/index"; export default function Page() { return <Card />; }'
    }, 'src/Card.tsx', 'EventCard');
    assert.equal(graph.root, find(graph, 'EventCard').id);
    assert.ok(has(graph, 'Page', 'EventCard', 'render'));
    assert.ok(has(graph, 'EventCard', 'useEvents', 'call'));
    assert.ok(has(graph, 'useEvents', 'loadEvents', 'call'));
    assert.ok(has(graph, 'loadEvents', 'fetch · /api/events', 'request'));
    assert.ok([...distances(graph, find(graph, 'Page').id, 'out').keys()].includes(find(graph, 'loadEvents').id));
    assert.equal(graph.warnings.length, 0);
});

test('preserves every use site beyond twenty and resolves a selected imported alias', () => {
    const calls = Array.from({ length: 35 }, (_, i) => `export function view${i}(){ return alias(); }`).join('\n');
    const graph = project({ 'api.ts': 'export function load() { return 1; }', 'views.ts': `import { load as alias } from './api';\n${calls}` }, 'views.ts', 'alias');
    const root = find(graph, 'load');
    assert.equal(graph.root, root.id);
    assert.equal(graph.edges.filter(edge => edge.to === root.id && edge.kind === 'call').length, 35);
    assert.equal(distances(graph, root.id, 'in').size, 36);
});

test('distinguishes shadowed names and follows object methods', () => {
    const graph = project({
        'a.ts': 'export function load(){ return 1; }',
        'b.ts': 'import {load} from "./a"; export function outer(){ function load(){return 2;} return load(); } export class Store { save(){return load();} } export function run(){ return new Store().save(); }'
    }, 'b.ts', 'run');
    const loads = graph.nodes.filter(node => node.name === 'load');
    assert.equal(loads.length, 2);
    const outer = find(graph, 'outer');
    const called = graph.edges.find(edge => edge.from === outer.id && edge.kind === 'call')!;
    assert.ok(graph.nodes.find(node => node.id === called.to)!.file.endsWith('b.ts'));
    assert.ok(has(graph, 'run', 'save', 'call'));
    assert.ok(has(graph, 'save', 'load', 'call'));
});

test('keeps recursive cycles finite and preserves multiple call sites', () => {
    const graph = project({ 'cycle.ts': 'export function a(){ b(); b(); }\nexport function b(){ a(); b(); }' }, 'cycle.ts', 'a()');
    assert.equal(distances(graph, find(graph, 'a').id, 'out').size, 2);
    assert.equal(graph.edges.find(edge => edge.from === find(graph, 'a').id && edge.to === find(graph, 'b').id)!.sites.length, 2);
    assert.ok(has(graph, 'b', 'b', 'call'));
});

test('follows destructured hook actions without inventing parameter references', () => {
    const graph = project({ 'hook.ts': 'export function useCart(){ const add = (id: string) => id; return { add }; } export function Page(){ const {add: addToCart} = useCart(); return addToCart("one"); }' }, 'hook.ts', 'Page');
    assert.ok(has(graph, 'Page', 'add', 'call'));
    assert.equal(graph.edges.filter(e => e.from === find(graph, 'add').id).length, 0);
});

test('recognizes an imported Axios client and preserves dynamic route templates', () => {
    const graph = project({
        'client.ts': 'import axios from "axios"; export const client = axios.create({baseURL:"/api"});',
        'api.ts': 'import {client} from "./client"; export function item(id: string){return client.get(`/items/${id}`);}'
    }, 'api.ts', 'item(');
    assert.ok(has(graph, 'item', 'GET · /items/${id}', 'request'));
});

test('keeps useCallback actions as traversable nodes instead of flattening the hook', () => {
    const graph = project({ 'cart.ts': 'import {useCallback} from "react"; export function useCart(){ const addToCart = useCallback(() => fetch("/cart"), []); return { addToCart }; }' }, 'cart.ts', 'useCart');
    assert.ok(has(graph, 'useCart', 'addToCart', 'reference'));
    assert.ok(has(graph, 'addToCart', 'fetch · /cart', 'request'));
    assert.equal(find(graph, 'addToCart').kind, 'function');
});

test('indexes unsaved source without modifying the file on disk', () => {
    const graph = project({ 'dirty.ts': 'export function before(){}' }, 'dirty.ts', 'after', { 'dirty.ts': 'export function after(){ return fetch("/new"); }' });
    assert.equal(find(graph, 'before'), undefined);
    assert.equal(graph.root, find(graph, 'after').id);
    assert.ok(has(graph, 'after', 'fetch · /new', 'request'));
});

test('does not invent links for missing imports and indexes JavaScript JSX', () => {
    const graph = project({
        'Card.jsx': 'export const Card = () => <div/>;',
        'App.jsx': 'import { Card } from "./Card"; import { missing } from "./missing"; export function App(){ return <Card/>; }'
    }, 'App.jsx', 'App');
    assert.ok(has(graph, 'App', 'Card', 'render'));
    assert.ok(graph.warnings.some(warning => warning.includes('./missing')));
    assert.equal(graph.edges.filter(edge => edge.kind === 'call' && find(graph, 'missing')?.id === edge.to).length, 0);
});
