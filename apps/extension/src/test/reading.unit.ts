import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { JS_TERMS, parseReading, readSelection, readingMessages, selectedLines, splitReading } from '../reading/model';

test('keeps the exact selected source, including partial lines and CRLF', () => {
    const code = 'i.productId === item.productId &&\r\n  i.color === item.color\r\n';
    const chunks = splitReading(code);
    assert.deepEqual(chunks, [{ start: 1, lines: ['i.productId === item.productId &&', '  i.color === item.color'] }]);
    const sent = JSON.parse(readingMessages(chunks[0], 'typescript', selectedLines(code))[1].content);
    assert.deepEqual(sent.selected.map((line: {code: string}) => line.code), chunks[0].lines);
    assert.deepEqual(sent.before, []); assert.deepEqual(sent.after, []);
});

test('rejects gaps, overlaps, invented line numbers and missing final lines', () => {
    const chunk = { start: 8, lines: ['if (ok) {', 'run();', '}'] };
    const response = (steps: unknown[]) => JSON.stringify({ summary: '설명', steps });
    const step = (start: number, end: number) => ({ start, end, text: '한국어 해석', terms: [] });
    for (const steps of [[step(8, 8), step(10, 10)], [step(8, 9), step(9, 10)], [step(8, 11)], [step(8, 9)], [step(7, 10)]]) {
        assert.throws(() => parseReading(response(steps), chunk, 'typescript'));
    }
    assert.equal(parseReading(response([step(8, 10)]), chunk, 'typescript').steps[0].end, 10);
});

test('only attaches known syntax that occurs in the selected step and fits the language', () => {
    const chunk = { start: 1, lines: ['a === b'] };
    const raw = JSON.stringify({ summary: '비교', steps: [{ start: 1, end: 1, text: '<img onerror="bad()">', terms: ['===', '===', 'for', 'made-up'] }] });
    assert.deepEqual(parseReading(raw, chunk, 'typescript').steps[0].terms, ['===']);
    assert.deepEqual(parseReading(raw, chunk, 'python').steps[0].terms, []);
    assert.match(JS_TERMS['==='], /자료형/); assert.match(JS_TERMS['findIndex'], /-1/);
    assert.match(JS_TERMS['for'], /조건 확인.*본문 실행.*증감식/);
});

test('keeps blank lines with adjacent explanations without requiring separate filler prose', () => {
    const chunk = { start: 1, lines: ['', 'first();', '', 'last();', ''] };
    const raw = JSON.stringify({ summary: '순서대로 실행합니다.', steps: [{ start: 2, end: 2, text: '첫 함수를 호출합니다.' }, { start: 4, end: 4, text: '다음 함수를 호출합니다.' }] });
    assert.deepEqual(parseReading(raw, chunk, 'typescript').steps.map(s => [s.start, s.end]), [[1, 2], [3, 5]]);
});

test('anchors interpretation to exact selected code rather than AI line guesses', () => {
    const chunk = { start: 8, lines: ['  if (ok) {', '    run();', '  }'] };
    const raw = JSON.stringify({ summary: '조건에 따라 실행합니다.', steps: [
        { code: 'if (ok) {', start: 99, end: 300, text: 'ok가 참이면 실행합니다.' },
        { code: 'run();\n}', start: 301, end: 302, text: 'run을 호출한 뒤 조건문을 마칩니다.' }
    ] });
    assert.deepEqual(parseReading(raw, chunk, 'typescript').steps.map(s => [s.start, s.end]), [[8, 8], [9, 10]]);
    assert.throws(() => parseReading(raw.replace('run();', 'invented();'), chunk, 'typescript'), /원문/);
});

test('accepts fenced or prefaced JSON and literal line breaks while still checking original code', () => {
    const chunk = { start: 1, lines: ['call(', '  value', ')'] };
    const raw = '해석 결과입니다.\n```json\n{"summary":"값을 전달합니다.","steps":[{"code":"call(\n  value\n)","text":"value를 인자로 전달합니다.","terms":[]}]}\n```';
    const result = parseReading(raw, chunk, 'typescript');
    assert.deepEqual(result.steps.map(s=>[s.start,s.end]), [[1,3]]);
    assert.throws(()=>parseReading(raw.replace('call(', 'invented('),chunk,'typescript'),/원문/);
});

test('reads a long selection completely in order without silently clipping its tail', async () => {
    const lines = Array.from({ length: 95 }, (_, i) => `const value${i} = ${i};`), parts: number[] = [], sent: string[] = [];
    const results = await readSelection(lines.join('\n'), 'typescript', async messages => {
        const body = JSON.parse(messages[1].content);
        sent.push(...body.selected.map((line: { code: string }) => line.code));
        return JSON.stringify({ summary: '값을 저장합니다.', steps: [{ start: body.first, end: body.last, text: '변수에 값을 저장합니다.', terms: ['const', '='] }] });
    }, part => parts.push(part.end));
    assert.deepEqual(sent, lines); assert.deepEqual(parts, [32, 64, 95]); assert.equal(results.length, 3);
});

test('retries invalid coverage once and does not fabricate an answer after failure', async () => {
    let calls = 0, published = 0;
    await assert.rejects(() => readSelection('first();\nlast();', 'typescript', async () => {
        calls++; return JSON.stringify({ summary: '설명', steps: [{ start: 1, end: 1, text: '첫 줄', terms: [] }] });
    }, () => published++), /마지막/);
    assert.equal(calls, 2); assert.equal(published, 0);
});

test('cancelling an in-flight answer prevents stale content and following requests', async () => {
    let stopped = false, calls = 0, published = 0;
    const result = await readSelection(Array(80).fill('run();').join('\n'), 'typescript', async () => {
        calls++; stopped = true; return '{}';
    }, () => published++, () => stopped);
    assert.equal(calls, 1); assert.equal(published, 0); assert.deepEqual(result, []);
});

test('explains a selected operator instantly without an AI call', async () => {
    const results = await readSelection('===', 'typescript', async () => { throw new Error('AI must not be called'); }, () => {});
    assert.equal(results[0].steps[0].text, JS_TERMS['===']);
});
