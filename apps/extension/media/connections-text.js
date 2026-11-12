(() => {
    const vscode = acquireVsCodeApi(), app = document.getElementById('app');
    function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) { node.textContent = text; } if (cls) { node.className = cls; } return node; }
    function send(type, values = {}) { vscode.postMessage({ type, ...values }); }
    function button(text, action, cls) { const node = el('button', text, cls); node.onclick = action; return node; }
    const header = el('header'), title = el('div'); title.append(el('p', 'DEVNAVI · CODE CONNECTIONS', 'eyebrow'), el('h1', '어디에 연결돼 있나요?'));
    const actions = el('div', undefined, 'actions'), refresh = button('새로고침', () => send('refresh')), cancel = button('중지', () => send('cancel')); actions.append(refresh, cancel); header.append(title, actions);
    const status = el('p', '', 'status'), stale = el('p', '코드가 바뀌었습니다. 새로고침하면 최신 연결을 확인합니다.', 'notice'); stale.hidden = true;
    const searchBox = el('div', undefined, 'search'), search = el('input'); search.type = 'search'; search.placeholder = '다른 함수나 파일 찾기'; search.setAttribute('aria-label', '프로젝트 코드 검색'); searchBox.append(search);
    const results = el('div', undefined, 'search-results'), historyBar = el('nav', undefined, 'history'), content = el('main');
    app.append(header, status, stale, searchBox, results, historyBar, content);
    let graph, byId, root, history = [], expanded = new Set(), explanations = new Map();
    function navigate(id, record = true) { if (!byId?.has(id)) { return; } if (record && root !== id) { history.push(root); } root = id; expanded.clear(); render(); }
    function entries(direction) {
        const grouped = new Map();
        graph.edges.forEach((edge, index) => {
            if ((direction === 'in' ? edge.to : edge.from) !== root || ['import', 'reexport'].includes(edge.kind)) { return; }
            const other = byId.get(direction === 'in' ? edge.from : edge.to);
            if (!other || ['type', 'file'].includes(other.kind)) { return; }
            if (!grouped.has(other.id)) { grouped.set(other.id, { node: other, edge, index, count: 0 }); }
            grouped.get(other.id).count += edge.sites.length;
        });
        return [...grouped.values()].sort((a, b) => a.node.name.localeCompare(b.node.name));
    }
    function group(direction, heading, values) {
        const section = el('section'); section.append(el('h2', `${heading} · ${values.length}`));
        if (!values.length) { section.append(el('p', '이 방향으로 확인된 직접 연결이 없습니다.', 'empty')); return section; }
        const list = el('ul', undefined, 'connection-list');
        for (const { node, edge, index, count } of values.slice(0, expanded.has(direction) ? undefined : 6)) {
            const row = el('li', undefined, 'connection-row'), top = el('div', undefined, 'connection-top');
            top.append(button(node.name, () => navigate(node.id), 'connection-name'));
            if (edge.sites.length && !byId.get(root).external) { top.append(button('참조 코드 ↗', () => send('open', { id: root, edge: index, site: 0 }))); }
            const from = byId.get(edge.from).name, to = byId.get(edge.to).name;
            const verb = edge.kind === 'call' ? '호출합니다' : edge.kind === 'render' ? '화면에 렌더링합니다' : edge.kind === 'request' ? '요청합니다' : '참조합니다';
            row.append(top, el('p', `${from} → ${to} · ${verb}`, 'connection-relation'));
            const site = edge.sites[0];
            row.append(el('p', site ? `${site.file}:${site.line} · ${count}개 참조 위치` : node.file || '외부 API', 'connection-path'));
            if (site) { row.append(el('code', site.text.trim(), 'connection-code')); }
            if (edge.sites.length > 1 && !byId.get(root).external) {
                const details = el('details', undefined, 'term'); details.append(el('summary', '다른 참조 위치'));
                edge.sites.slice(1).forEach((location, site) => details.append(button(`${location.file}:${location.line}`, () => send('open', { id: root, edge: index, site: site + 1 })))); row.append(details);
            }
            list.append(row);
        }
        section.append(list);
        if (values.length > 6 && !expanded.has(direction)) { section.append(button(`${values.length - 6}개 더 보기`, () => { expanded.add(direction); render(); }, 'more')); }
        return section;
    }
    function render() {
        const node = byId.get(root), incoming = entries('in'), outgoing = entries('out');
        historyBar.replaceChildren();
        if (history.length) { historyBar.append(button('← 이전', () => navigate(history.pop(), false)), el('span', history.slice(-3).map(id => byId.get(id).name).join(' → ') + ' → ' + node.name)); }
        content.replaceChildren(el('h2', node.name, 'focus-heading'), el('p', node.file ? `${node.file}:${node.line}` : '외부 라이브러리 / API', 'meta'));
        content.append(el('p', `${node.name}를 사용하는 코드 ${incoming.length}개, 이 코드가 사용하는 연결 ${outgoing.length}개입니다.`, 'reading-summary'));
        const actions = el('div', undefined, 'actions');
        if (!node.external) { actions.append(button('선언 코드 ↗', () => send('open', { id: root }))); }
        const explanation = explanations.get(root), explain = button(explanation?.busy ? '설명하는 중…' : 'AI로 역할 설명', () => send('explain', { id: root })); explain.disabled = Boolean(explanation?.busy); actions.append(explain); content.append(actions);
        if (explanation) { content.append(el('p', explanation.text, `explanation${explanation.error ? ' error' : ''}`)); }
        content.append(group('in', '이 코드를 쓰는 곳', incoming), group('out', '여기서 이어지는 코드', outgoing));
        if (graph.warnings.length) { const warnings = el('details'); warnings.append(el('summary', '분석 정보'), el('p', graph.warnings.join('\n'), 'meta')); content.append(warnings); }
    }
    search.oninput = () => {
        results.replaceChildren(); if (!graph || !search.value.trim()) { return; }
        const query = search.value.toLowerCase();
        const matches = graph.nodes.filter(node => `${node.name} ${node.file}`.toLowerCase().includes(query));
        let limit = 30;
        function show() {
            results.replaceChildren();
            matches.slice(0, limit).forEach(node => results.append(button(`${node.name} · ${node.file || '외부 연결'}`, () => { navigate(node.id); search.value = ''; results.replaceChildren(); })));
            if (matches.length > limit) { results.append(button(`${matches.length - limit}개 더 보기`, () => { limit += 60; show(); })); }
        }
        show();
    };
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'status') { status.textContent = message.message; cancel.hidden = !message.busy; refresh.disabled = message.busy; }
        if (message.type === 'stale') { stale.hidden = false; }
        if (message.type === 'graph') { graph = message.graph; byId = new Map(graph.nodes.map(node => [node.id, node])); history = []; explanations.clear(); stale.hidden = true; navigate(graph.root, false); }
        if (message.type === 'explanation') { explanations.set(message.id, message); if (message.id === root) { render(); } }
    });
    window.addEventListener('keydown', event => { if (event.key === '/' && document.activeElement !== search) { event.preventDefault(); search.focus(); } if (event.altKey && event.key === 'ArrowLeft' && history.length) { event.preventDefault(); navigate(history.pop(), false); } });
    send('ready');
})();
