/* 연결 지도 UI. 프로젝트 텍스트와 AI 응답은 textContent로만 삽입한다. */
(() => {
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');
    app.innerHTML = `<header><div><span class="eyebrow">DEVNAVI · CODE CONNECTIONS</span><h1>코드 연결 지도</h1><p id="status" role="status" aria-live="polite">프로젝트를 분석하고 있습니다…</p></div><div class="header-actions"><span id="stale" hidden>코드가 변경되었습니다</span><button id="cancel" hidden>분석 중지</button><button id="expand">넓게 보기</button><button id="refresh">새로고침</button></div></header>
    <div id="loading"><span class="spinner"></span><strong>프로젝트의 연결을 찾고 있습니다</strong><p>화면 · 컴포넌트 · 훅 · 함수의 실제 참조를 모읍니다.</p></div>
    <div id="workspace" hidden><aside><label for="search">프로젝트에서 찾기</label><input id="search" type="search" placeholder="코드 이름 또는 파일 검색" autocomplete="off"><div class="scope"><button id="connected" aria-pressed="true">현재 연결</button><button id="all" aria-pressed="false">전체 프로젝트</button></div><p id="search-count" class="muted"></p><div id="results"></div><button id="more-results" hidden>더 보기</button></aside>
    <main><nav id="history" aria-label="탐색 기록"></nav><section class="focus-bar"><div><span id="focus-kind" class="badge"></span><h2 id="focus-title"></h2><p id="focus-file" class="muted"></p></div><div><button id="open-focus">코드 열기 ↗</button><button id="explain" class="primary">AI로 흐름 설명</button></div></section>
    <div class="toolbar"><div><label for="direction">연결 방향</label><select id="direction"><option value="both">양방향</option><option value="in">이 코드를 사용하는 곳</option><option value="out">이 코드가 사용하는 곳</option></select><label for="depth">표시 범위</label><select id="depth"><option value="3">3단계</option><option value="1">직접 연결</option><option value="all">전체 연결</option></select><label class="check"><input id="include-types" type="checkbox">타입·파일 포함</label><label for="zoom">크기</label><select id="zoom"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option><option value="fit">한눈에 보기</option></select></div><button id="center">선택 코드로</button></div>
    <div class="map-meta"><span id="map-count"></span><span>화살표: 사용하는 코드 → 사용되는 코드</span></div><div id="map-scroll" tabindex="0" aria-label="코드 연결 지도, 좌우로 이동할 수 있습니다"><div id="map"><svg id="wires" aria-hidden="true"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7"/></marker></defs><g id="lines"></g></svg><div id="layers"></div></div></div><p id="cycle-note" class="muted"></p>
    <section id="explanation" hidden aria-live="polite"><h3>이 코드와 연결 흐름</h3><div id="explanation-text"></div></section>
    <section class="evidence"><div class="section-heading"><h3>연결 근거</h3><span id="evidence-count" class="muted"></span></div><div id="evidence-list"></div></section>
    <details id="coverage"><summary>분석 정보</summary><p id="coverage-text"></p><ul id="warnings"></ul></details></main></div>`;
    const $ = id => document.getElementById(id);
    const labels = { page: '페이지', component: '컴포넌트', hook: '훅', function: '함수', class: '클래스', value: '데이터', type: '타입', file: '파일', external: '외부 연결' };
    const relations = { call: '호출', render: '화면 구성', reference: '참조', import: '가져오기', reexport: '다시 내보내기', request: 'API 요청' };
    let graph, byId, incoming, outgoing, root, scope = 'connected', resultLimit = 60, history = [], layerLimits = new Map(), explanationCache = new Map();
    let currentEdges = [], activeEdges = [], connected = new Set(), shown = new Set(), scale = 1;
    function adjacency() {
        incoming = new Map(); outgoing = new Map();
        const full = $('include-types').checked;
        activeEdges = graph.edges.filter(edge => full || (![byId.get(edge.from)?.kind, byId.get(edge.to)?.kind].some(kind => kind === 'type' || kind === 'file') && edge.kind !== 'import' && edge.kind !== 'reexport'));
        for (const edge of activeEdges) {
            if (!incoming.has(edge.to)) { incoming.set(edge.to, new Set()); } incoming.get(edge.to).add(edge.from);
            if (!outgoing.has(edge.from)) { outgoing.set(edge.from, new Set()); } outgoing.get(edge.from).add(edge.to);
        }
    }
    function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) { node.textContent = text; } if (className) { node.className = className; } return node; }
    function send(type, data = {}) { vscode.postMessage({ type, ...data }); }
    function button(text, action, className) { const item = element('button', text, className); item.addEventListener('click', action); return item; }
    function distances(start, adjacency) {
        const result = new Map([[start, 0]]), queue = [start];
        for (let i = 0; i < queue.length; i++) { for (const id of adjacency.get(queue[i]) ?? []) { if (!result.has(id)) { result.set(id, result.get(queue[i]) + 1); queue.push(id); } } }
        return result;
    }
    function navigate(id, record = true) {
        if (!byId.has(id)) { return; }
        if (record && root && root !== id) { history.push(root); }
        root = id; layerLimits.clear(); resultLimit = 60;
        render(); requestAnimationFrame(center);
    }
    function center() {
        const card = document.querySelector('.code-card.focus');
        if (card) { const rect = card.getBoundingClientRect(), container = $('map-scroll'); container.scrollTo({ left: Math.max(0, container.scrollLeft + rect.left - container.getBoundingClientRect().left - container.clientWidth / 2 + rect.width / 2), behavior: 'instant' }); }
    }
    function render() {
        const node = byId.get(root); if (!node) { return; } adjacency();
        $('focus-title').textContent = node.name; $('focus-kind').textContent = labels[node.kind] || node.kind;
        $('focus-file').textContent = node.external ? '프로젝트 밖의 라이브러리 또는 API' : `${node.file}:${node.line}`;
        $('open-focus').disabled = Boolean(node.external);
        $('history').replaceChildren();
        if (history.length) {
            $('history').append(button('← 이전', () => navigate(history.pop(), false)));
            for (const id of history.slice(-4)) { const item = byId.get(id); if (item) { $('history').append(button(item.name, () => navigate(id))); } }
        }
        $('history').append(element('span', node.name));
        const from = distances(root, incoming), to = distances(root, outgoing);
        connected = new Set([...from.keys(), ...to.keys()]);
        const direction = $('direction').value, limit = $('depth').value === 'all' ? Infinity : Number($('depth').value);
        const layers = new Map([[0, [node]]]);
        for (const item of graph.nodes) {
            if (item.id === root) { continue; }
            const left = from.get(item.id) ?? Infinity, right = to.get(item.id) ?? Infinity;
            let layer;
            if (direction === 'in' && Number.isFinite(left) && left <= limit) { layer = -left; }
            if (direction === 'out' && Number.isFinite(right) && right <= limit) { layer = right; }
            if (direction === 'both') {
                if (Number.isFinite(left) && left <= right && left <= limit) { layer = -left; }
                else if (Number.isFinite(right) && right <= limit) { layer = right; }
            }
            if (layer === undefined) { continue; }
            if (!layers.has(layer)) { layers.set(layer, []); } layers.get(layer).push(item);
        }
        const layerContainer = $('layers'); layerContainer.replaceChildren(); shown = new Set();
        for (const [level, items] of [...layers].sort((a, b) => a[0] - b[0])) {
            const column = element('section', undefined, 'layer');
            column.append(element('h3', level === 0 ? '선택한 코드' : `${level < 0 ? '사용하는 곳' : '사용하는 코드'} · ${Math.abs(level)}단계`));
            const max = layerLimits.get(level) ?? 24;
            items.sort((a, b) => a.kind === 'external' ? 1 : b.kind === 'external' ? -1 : a.name.localeCompare(b.name));
            for (const item of items.slice(0, max)) {
                shown.add(item.id);
                const card = element('article', undefined, `code-card ${item.id === root ? 'focus' : ''} kind-${item.kind}`);
                card.dataset.id = item.id;
                const main = button('', () => navigate(item.id), 'node-main');
                main.append(element('span', labels[item.kind] || item.kind, 'badge'), element('strong', item.name), element('span', item.file || '외부 라이브러리 / API', 'node-path'));
                const linkCount = (incoming.get(item.id)?.size ?? 0) + (outgoing.get(item.id)?.size ?? 0);
                main.append(element('span', `${linkCount}개 코드와 연결`, 'node-count'));
                main.title = `${item.name}\n${item.file}${item.line ? ':' + item.line : ''}\n선택하면 이 코드를 중심으로 탐색합니다.`;
                card.append(main);
                if (!item.external) { const open = button('↗', () => send('open', { id: item.id }), 'node-open'); open.setAttribute('aria-label', `${item.name} 코드 열기`); card.append(open); }
                column.append(card);
            }
            if (items.length > max) { column.append(button(`${items.length - max}개 더 보기`, () => { layerLimits.set(level, max + 48); render(); }, 'more-layer')); }
            layerContainer.append(column);
        }
        currentEdges = activeEdges.filter(edge => shown.has(edge.from) && shown.has(edge.to));
        $('map-count').textContent = `연결된 ${connected.size}개 코드 중 ${shown.size}개 표시 · ${currentEdges.length}개 연결`;
        const cycles = [...from.keys()].filter(id => id !== root && to.has(id)).length + graph.edges.filter(e => e.from === root && e.to === root).length;
        $('cycle-note').textContent = cycles ? `↺ 순환 연결 ${cycles}개 · 이미 표시한 코드는 중복으로 펼치지 않습니다.` : connected.size === 1 ? '이 코드에 연결된 참조를 찾지 못했습니다. 전체 프로젝트에서 다른 코드를 찾아보세요.' : '코드 카드를 선택해 계속 탐색하고, ↗ 버튼으로 실제 코드를 엽니다.';
        renderResults(); renderEvidence(); renderExplanation(); requestAnimationFrame(applyZoom);
    }
    function renderResults() {
        if (!graph) { return; }
        const query = $('search').value.toLocaleLowerCase().trim();
        const candidates = graph.nodes.filter(node => (scope === 'all' || connected.has(node.id)) && (!query || `${node.name} ${node.file}`.toLocaleLowerCase().includes(query)));
        $('search-count').textContent = `${candidates.length}개 코드`;
        $('results').replaceChildren();
        for (const node of candidates.slice(0, resultLimit)) {
            const item = button('', () => navigate(node.id), `search-item ${node.id === root ? 'active' : ''}`);
            item.append(element('span', labels[node.kind] || node.kind, 'small-kind'), element('strong', node.name), element('small', node.file || '외부 연결'));
            $('results').append(item);
        }
        $('more-results').hidden = candidates.length <= resultLimit;
        $('connected').setAttribute('aria-pressed', String(scope === 'connected'));
        $('all').setAttribute('aria-pressed', String(scope === 'all'));
    }
    function renderEvidence() {
        const list = $('evidence-list'); list.replaceChildren();
        const entries = graph.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.from === root || edge.to === root);
        $('evidence-count').textContent = `${entries.reduce((sum, { edge }) => sum + edge.sites.length, 0)}개 참조 위치`;
        if (!entries.length) { list.append(element('p', '직접 연결된 참조가 없습니다.', 'muted')); }
        for (const { edge, index } of entries) {
            const details = element('details');
            const from = byId.get(edge.from), to = byId.get(edge.to);
            const summary = element('summary', `${from?.name} → ${to?.name} · ${relations[edge.kind]} · ${edge.sites.length}곳`);
            details.append(summary);
            const other = edge.from === root ? edge.to : edge.from;
            details.append(button('이 연결 따라가기 →', () => navigate(other), 'follow'));
            edge.sites.forEach((site, siteIndex) => {
                const item = button('', () => send('open', { id: root, edge: index, site: siteIndex }), 'site');
                item.append(element('span', `${site.file}:${site.line}`), element('code', site.text)); details.append(item);
            });
            list.append(details);
        }
    }
    function drawEdges() {
        const map = $('map'), lines = $('lines'), svg = $('wires');
        lines.replaceChildren();
        svg.setAttribute('width', String(map.scrollWidth)); svg.setAttribute('height', String(map.scrollHeight));
        const origin = map.getBoundingClientRect();
        const cards = new Map([...document.querySelectorAll('.code-card')].map(card => [card.dataset.id, card]));
        for (const edge of currentEdges) {
            const source = cards.get(edge.from), target = cards.get(edge.to); if (!source || !target) { continue; }
            const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
            const right = b.left > a.left;
            const x1 = ((right ? a.right : a.left) - origin.left) / scale, y1 = (a.top + a.height / 2 - origin.top) / scale;
            const x2 = ((right ? b.left : b.right) - origin.left) / scale, y2 = (b.top + b.height / 2 - origin.top) / scale;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            if (edge.from === edge.to) { line.setAttribute('d', `M ${x1} ${y1} C ${x1 - 25} ${y1 - 85}, ${x1 + 85} ${y1 - 85}, ${x1 + 60} ${y1 - 40}`); }
            else { const bend = Math.max(25, Math.abs(x2 - x1) / 2); line.setAttribute('d', `M ${x1} ${y1} C ${x1 + (right ? bend : -bend)} ${y1}, ${x2 - (right ? bend : -bend)} ${y2}, ${x2} ${y2}`); }
            line.setAttribute('marker-end', 'url(#arrow)');
            line.setAttribute('class', edge.from === root || edge.to === root ? 'primary-wire' : 'wire');
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = `${byId.get(edge.from)?.name} → ${byId.get(edge.to)?.name} · ${relations[edge.kind]}`; line.append(title); lines.append(line);
        }
    }
    function applyZoom() {
        const option = $('zoom').value;
        scale = option === 'fit' ? Math.min(1, Math.max(.25, ($('map-scroll').clientWidth - 8) / ($('layers').scrollWidth + 56))) : Number(option);
        $('map').style.zoom = String(scale); drawEdges(); center();
    }
    function renderExplanation() {
        const state = explanationCache.get(root);
        $('explanation').hidden = !state; $('explain').disabled = Boolean(state?.busy);
        $('explain').textContent = state?.busy ? '흐름 설명 중…' : 'AI로 흐름 설명';
        $('explanation-text').textContent = state?.text ?? '';
        $('explanation-text').classList.toggle('error', Boolean(state?.error));
    }
    $('search').addEventListener('input', () => { resultLimit = 60; renderResults(); });
    $('all').onclick = () => { scope = 'all'; resultLimit = 60; renderResults(); };
    $('connected').onclick = () => { scope = 'connected'; resultLimit = 60; renderResults(); };
    $('more-results').onclick = () => { resultLimit += 100; renderResults(); };
    $('direction').onchange = () => { render(); requestAnimationFrame(center); };
    $('depth').onchange = () => { render(); requestAnimationFrame(center); };
    $('include-types').onchange = () => render(); $('zoom').onchange = applyZoom;
    $('center').onclick = center;
    $('refresh').onclick = () => send('refresh'); $('cancel').onclick = () => send('cancel');
    $('expand').onclick = () => send('expand');
    $('open-focus').onclick = () => send('open', { id: root }); $('explain').onclick = () => send('explain', { id: root });
    window.addEventListener('keydown', event => {
        if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('search').focus(); }
        if (event.key === 'ArrowLeft' && event.altKey && history.length) { event.preventDefault(); navigate(history.pop(), false); }
    });
    window.addEventListener('resize', () => requestAnimationFrame(applyZoom));
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'status') { $('status').textContent = message.message; $('cancel').hidden = !message.busy; $('refresh').disabled = message.busy; $('loading').hidden = Boolean(graph) || !message.busy; }
        else if (message.type === 'stale') { $('stale').hidden = false; }
        else if (message.type === 'explanation') { explanationCache.set(message.id, message); renderExplanation(); }
        else if (message.type === 'graph') {
            graph = message.graph; byId = new Map(graph.nodes.map(node => [node.id, node])); history = []; explanationCache.clear();
            $('stale').hidden = true; $('loading').hidden = true; $('workspace').hidden = false;
            $('all').textContent = graph.engine === 'typescript' ? '전체 프로젝트' : '찾은 코드 전체';
            $('coverage-text').textContent = graph.engine === 'typescript' ? '프로젝트의 JS·TS·JSX·TSX 소스를 분석했습니다. 생성 폴더와 의존성 코드는 제외하며, 실행 중 결정되는 동적 연결은 정적 참조에 나타나지 않을 수 있습니다.' : '선택한 코드에서 언어 서버가 제공한 참조와 호출 계층을 재귀적으로 탐색했습니다.';
            $('warnings').replaceChildren(...graph.warnings.map(warning => element('li', warning)));
            navigate(graph.root, false);
        }
    });
    send('ready');
})();
