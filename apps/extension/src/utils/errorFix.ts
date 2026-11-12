export interface FixEdit { before: string; after: string }
export interface ErrorFixProposal {
    cause: string;
    edits: FixEdit[];
    verification: string[];
}

// Model output is data, never an executable command or a file path.
export function parseErrorFix(raw: string): ErrorFixProposal {
    const data: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!data || typeof data !== 'object') { throw new Error('수정안 응답 형식이 올바르지 않아.'); }
    const p = data as Record<string, unknown>;
    if (typeof p.cause !== 'string' || !p.cause.trim() || p.cause.length > 3000
        || !Array.isArray(p.edits) || p.edits.length > 5
        || !Array.isArray(p.verification) || p.verification.length === 0 || p.verification.length > 6
        || !p.verification.every(s => typeof s === 'string' && s.trim() && s.length <= 2000)) {
        throw new Error('원인·수정 내용·확인 방법을 갖춘 응답이 필요해. 다시 요청해줘.');
    }
    const edits = p.edits.map((item: unknown) => {
        if (!item || typeof item !== 'object') { throw new Error('수정 내용이 올바르지 않아.'); }
        const edit = item as Record<string, unknown>;
        if (typeof edit.before !== 'string' || !edit.before.trim() || edit.before.length > 12000
            || typeof edit.after !== 'string' || edit.after.length > 12000 || edit.before === edit.after) {
            throw new Error('정확한 원본 코드와 변경 코드가 필요해.');
        }
        return { before: edit.before, after: edit.after };
    });
    return { cause: p.cause.trim(), edits, verification: p.verification as string[] };
}

export function applyProposalToText(source: string, context: string, edits: FixEdit[]): string {
    const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n').replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n');
    const ranges = edits.map(edit => {
        const before = normalize(edit.before), after = normalize(edit.after);
        const start = source.indexOf(before);
        if (!before.trim() || before === after || start < 0 || source.indexOf(before, start + 1) !== -1
            || !normalize(context).includes(before)) {
            throw new Error('수정할 코드를 한 곳으로 확인할 수 없어. 코드를 더 구체적으로 선택해 다시 요청해줘.');
        }
        return { start, end: start + before.length, after };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].start < ranges[i - 1].end) { throw new Error('수정 범위가 겹쳐서 적용할 수 없어.'); }
    }
    let result = source;
    for (const r of ranges.reverse()) { result = result.slice(0, r.start) + r.after + result.slice(r.end); }
    return result;
}
