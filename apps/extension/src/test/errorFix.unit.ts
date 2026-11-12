import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyProposalToText, parseErrorFix } from '../utils/errorFix';

const proposal = { cause: 'items가 없을 수 있어.', edits: [{ before: 'return data.items.length;', after: 'return data?.items?.length ?? 0;' }], verification: ['items가 없는 입력과 정상 입력으로 실행해봐.'] };
test('parses a complete correction and preserves unrelated code', () => {
    const p = parseErrorFix('```json\n' + JSON.stringify(proposal) + '\n```');
    const source = 'function count(data) {\n  return data.items.length;\n}\nconst name = "keep";';
    assert.equal(applyProposalToText(source, source, p.edits), 'function count(data) {\n  return data?.items?.length ?? 0;\n}\nconst name = "keep";');
});
test('preserves CRLF and Unicode when the model returns LF snippets', () => {
    const source = 'const 이름 = "일정";\r\nlet a = 1;\r\nlet b = 2;\r\n';
    assert.equal(applyProposalToText(source, source, [{ before: 'let a = 1;\nlet b = 2;', after: 'let a = 3;\nlet b = 4;' }]), 'const 이름 = "일정";\r\nlet a = 3;\r\nlet b = 4;\r\n');
});
test('multiple edits use original offsets, not shifted output offsets', () => {
    assert.equal(applyProposalToText('abc def ghi', 'abc def ghi', [{ before: 'abc', after: 'A long replacement' }, { before: 'ghi', after: 'G' }]), 'A long replacement def G');
});
test('rejects missing and ambiguous matches instead of guessing a location', () => {
    for (const source of ['other text', 'return data.items.length; return data.items.length;']) {
        assert.throws(() => applyProposalToText(source, source, proposal.edits));
    }
});
test('rejects overlaps and edits outside the supplied context', () => {
    assert.throws(() => applyProposalToText('abcdef', 'abcdef', [{ before: 'abc', after: 'x' }, { before: 'bcd', after: 'y' }]));
    assert.throws(() => applyProposalToText('abc def', 'abc', [{ before: 'def', after: 'ghi' }]));
});
test('rejects incomplete, empty-match, invalid, and unchanged responses', () => {
    for (const raw of ['{"cause":', 'null', '{}', JSON.stringify({ ...proposal, verification: [] }), JSON.stringify({ ...proposal, edits: [{ before: '', after: 'delete all' }] }), JSON.stringify({ ...proposal, edits: [{ before: 'abc', after: 'abc' }] })]) {
        assert.throws(() => parseErrorFix(raw));
    }
});
test('allows an honest no-fix diagnosis without inventing edits', () => {
    const p = parseErrorFix(JSON.stringify({ ...proposal, edits: [] }));
    assert.equal(applyProposalToText('keep code', 'keep code', p.edits), 'keep code');
});
test('allows deletion of an exact snippet but never an empty search', () => {
    assert.equal(applyProposalToText('abc def', 'abc def', [{ before: ' def', after: '' }]), 'abc');
    assert.throws(() => applyProposalToText('abc', 'abc', [{ before: '', after: 'x' }]));
});
