(() => {
    const vscode = acquireVsCodeApi(), app = document.getElementById('app');
    function el(tag, text, cls) { const item = document.createElement(tag); if (text !== undefined) { item.textContent = text; } if (cls) { item.className = cls; } return item; }
    function button(text, action, cls) { const item = el('button', text, cls); item.onclick = action; return item; }
    const header = el('header'), heading = el('div');
    heading.append(el('p', 'DEVNAVI · CODE READER', 'eyebrow'), el('h1', '한국어로 읽기'));
    const actions = el('div', undefined, 'actions');
    const retry = button('다시 읽기', () => vscode.postMessage({ type: 'retry' })), cancel = button('중지', () => vscode.postMessage({ type: 'cancel' }));
    actions.append(retry, cancel); header.append(heading, actions);
    const meta = el('p', '', 'meta'), status = el('p', '', 'status'), stale = el('p', '원본이 바뀌었습니다. 새 코드로 읽으려면 다시 선택해 주세요.', 'notice');
    const summary = el('p', '', 'reading-summary'), list = el('main', undefined, 'reading-list');
    app.append(header, meta, status, stale, summary, list);
    let fingerprint = '';
    window.addEventListener('message', event => {
        const state = event.data; if (state.type !== 'reading') { return; }
        meta.textContent = `${state.file} · ${state.firstLine}–${state.firstLine + state.lines.length - 1}줄 · 선택한 ${state.lines.length}줄`;
        status.textContent = state.status; status.setAttribute('aria-live', 'polite');
        retry.disabled = state.busy || state.stale; cancel.hidden = !state.busy; stale.hidden = !state.stale;
        summary.hidden = !state.parts.length;
        summary.textContent = state.parts.length === 1 && state.parts[0].end === state.lines.length ? state.parts[0].summary : '선택한 순서대로 읽어 보세요.';
        const next = JSON.stringify([state.file, state.firstLine, state.lines, state.parts]);
        if (next === fingerprint) { return; } fingerprint = next;
        list.replaceChildren();
        for (const part of state.parts) {
            if (state.lines.length > 32) { list.append(el('h2', part.summary, 'part-title')); }
            for (const step of part.steps) {
                const row = el('article', undefined, 'reading-step');
                const first = state.firstLine + step.start - 1, last = state.firstLine + step.end - 1;
                const line = button(first === last ? `${first}줄 ↗` : `${first}–${last}줄 ↗`, () => vscode.postMessage({ type: 'open', start: step.start, end: step.end }), 'line-link');
                line.title = '이 부분을 원본 코드에서 선택';
                const pre = el('pre'), code = el('code', state.lines.slice(step.start - 1, step.end).join('\n'));
                pre.append(code); row.append(line, pre, el('p', step.text, 'translation'));
                if (step.terms.length) {
                    const terms = el('div', undefined, 'terms');
                    for (const term of step.terms) {
                        const detail = el('details', undefined, 'term');
                        detail.append(el('summary', term), el('p', state.terms[term])); terms.append(detail);
                    }
                    row.append(terms);
                }
                list.append(row);
            }
        }
        if (!state.parts.length) { const pre = el('pre', undefined, 'pending-code'); pre.append(el('code', state.lines.join('\n'))); list.append(pre); }
    });
    vscode.postMessage({ type: 'ready' });
})();
