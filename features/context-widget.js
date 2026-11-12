// Local composer geometry checks adapted from Antigrative Dashboard (MIT).
// Copyright (c) 2026 AG Pulse contributors. See THIRD-PARTY-NOTICES.md.
function installContextWidget(win, doc, enabled, report, readConversationId) {
  win.__easyagContext?.dispose();
  if (!enabled) return;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let node, shadow, button, card, quotaButton, quotaCard, composer, data;
  let route = '', pending, lastFetch = 0, sequence = 0, disposed = false;
  let observer, resizeObserver, frame, sendTimer, sendRefreshQueued = false;
  const REFRESH_INTERVAL_MS = 60000;
  const now = () => typeof win.__easyagNow === 'function' ? win.__easyagNow() : Date.now();
  const conversationId = () => {
    if (readConversationId) return readConversationId(win, doc);
    const id = win.location.pathname.match(/\/c\/([^/]+)/)?.[1];
    return id && GUID.test(id) ? id.toLowerCase() : null;
  };
  const visible = element => element?.isConnected && !element.closest('[hidden],[inert]')
    && element.getClientRects().length && win.getComputedStyle(element).visibility !== 'hidden';
  function safeLayout(pair) {
    const style = win.getComputedStyle(pair.row), branchStyle = win.getComputedStyle(pair.branch);
    if (!['flex', 'inline-flex'].includes(style.display) || style.flexDirection !== 'row'
      || ['absolute', 'fixed'].includes(style.position) || ['absolute', 'fixed'].includes(branchStyle.position)
      || pair.row.closest('header,[role="banner"]')) return false;
    const r = pair.row.getBoundingClientRect(), e = pair.editor.getBoundingClientRect(), p = pair.row.parentElement.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.width > 0 && e.height > 0
      && Math.max(0, r.top - e.bottom, e.top - r.bottom) <= 48
      && Math.min(r.bottom, e.bottom) - Math.max(r.top, e.top) <= 2
      && Math.min(r.right, e.right) > Math.max(r.left, e.left) && p.height <= e.height + r.height + 96;
  }
  function findComposer() {
    const editors = [...doc.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"][role="combobox"]')].filter(visible);
    const pairs = [];
    for (const anchor of doc.querySelectorAll('[data-testid="model-selector-trigger"]')) {
      if (!visible(anchor)) continue;
      for (const editor of editors) {
        let row = anchor.parentElement, distance = 0;
        while (row?.parentElement && !row.parentElement.contains(editor) && row.parentElement !== doc.body) { row = row.parentElement; distance++; }
        if (!row || row.contains(editor) || !row.parentElement?.contains(editor) || [doc.body, doc.documentElement].includes(row.parentElement)) continue;
        let branch = anchor;
        while (branch.parentElement !== row) branch = branch.parentElement;
        const pair = { row, branch, editor, anchor, distance };
        if (safeLayout(pair)) pairs.push(pair);
      }
    }
    // Deliberately no generic combobox or title-label fallback: ambiguous layouts stay untouched.
    pairs.sort((a, b) => a.distance - b.distance);
    return pairs.length && (pairs.length === 1 || pairs[0].distance < pairs[1].distance) ? pairs[0] : null;
  }
  function hideCard(target, trigger) {
    if (!target) return;
    if (target.hasAttribute('popover') && target.matches(':popover-open')) target.hidePopover();
    target.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
  function hideCards() {
    hideCard(card, button);
    hideCard(quotaCard, quotaButton);
  }
  function positionCard(target, trigger) {
    if (!target || target.hidden || !trigger || !node?.isConnected) return;
    const r = trigger.getBoundingClientRect(), width = Math.min(304, win.innerWidth - 16);
    target.style.width = Math.max(0, width) + 'px';
    target.style.left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8)) + 'px';
    const height = target.getBoundingClientRect().height;
    target.style.top = Math.max(8, Math.min(r.top - height - 8, win.innerHeight - height - 8)) + 'px';
  }
  function showCard() {
    if (!node?.isConnected || node.hidden) return;
    hideCards();
    card.hidden = false;
    if (card.hasAttribute('popover') && !card.matches(':popover-open')) card.showPopover();
    button.setAttribute('aria-expanded', 'true');
    positionCard(card, button);
  }
  function showQuotaCard() {
    if (!node?.isConnected || node.hidden) return;
    hideCards();
    quotaCard.hidden = false;
    if (quotaCard.hasAttribute('popover') && !quotaCard.matches(':popover-open')) quotaCard.showPopover();
    quotaButton.setAttribute('aria-expanded', 'true');
    positionCard(quotaCard, quotaButton);
  }
  const compact = value => value >= 1000 ? (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(value);
  const make = (tag, attrs, ...children) => {
    const element = ['svg', 'circle', 'text'].includes(tag)
      ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    for (const child of children) {
      if (child !== null && child !== undefined) {
        element.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
      }
    }
    return element;
  };
  const clampFraction = value => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : null;
  const normalizeModel = value => String(value || '')
    .replace(/\b(?:high|medium|low|new|notice)\b/gi, '')
    .replace(/[高低中]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
  const modelFamily = value => {
    const model = normalizeModel(value);
    if (model.includes('gemini')) return 'gemini';
    if (model.includes('claude') || model.includes('gpt')) return 'claude-gpt';
    return null;
  };
  const isAggregateGroup = group => {
    const name = normalizeModel(group?.displayName);
    return name === 'geminimodels' || name === 'claudegptmodels' || name === 'claudeandgptmodels'
      || name === 'thirdpartymodels';
  };
  function quotaSelection() {
    const groups = Array.isArray(data?.quota?.groups) ? data.quota.groups : [];
    const domModel = typeof composer?.anchor?.textContent === 'string'
      ? composer.anchor.textContent.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    const model = domModel || data?.context?.model || data?.speed?.model || '';
    const key = normalizeModel(model);
    const exact = key ? groups.filter(group => [group.displayName, ...(group.modelKeys || [])].some(value => {
      const candidate = normalizeModel(value);
      return candidate && (candidate === key || candidate.includes(key) || key.includes(candidate) && candidate.length >= 6);
    })) : [];
    const family = modelFamily(model);
    const familyGroups = family ? groups.filter(group => group.family === family) : [];
    const aggregate = familyGroups.filter(isAggregateGroup);
    const specificExact = exact.filter(group => !isAggregateGroup(group));
    const selected = specificExact.length ? specificExact : exact.length ? exact : aggregate.length ? aggregate : familyGroups;
    const usable = selected.flatMap(group => group.buckets || [])
      .filter(bucket => !bucket.disabled && clampFraction(bucket.remainingFraction) !== null);
    const remainingFraction = usable.length
      ? Math.min(...usable.map(bucket => clampFraction(bucket.remainingFraction)))
      : null;
    return { groups, selected, model, remainingFraction };
  }
  function resetText(bucket) {
    if (bucket?.resetDescription) return bucket.resetDescription;
    if (!bucket?.resetAt) return '';
    const remaining = new Date(bucket.resetAt).getTime() - now();
    if (!Number.isFinite(remaining) || remaining <= 0) return '即将重置';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `将在 ${minutes} 分钟后重置`;
    const hours = Math.floor(minutes / 60), restMinutes = minutes % 60;
    if (hours < 24) return `将在 ${hours} 小时${restMinutes ? ` ${restMinutes} 分钟` : ''}后重置`;
    const days = Math.floor(hours / 24), restHours = hours % 24;
    return `将在 ${days} 天${restHours ? ` ${restHours} 小时` : ''}后重置`;
  }
  function quotaRing(value, size = 20) {
    const fraction = clampFraction(value);
    const svg = make('svg', { viewBox: '0 0 24 24', width: String(size), height: String(size), 'aria-hidden': 'true' });
    svg.appendChild(make('circle', { class: 'quota-track', cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }));
    const fill = make('circle', {
      class: 'quota-fill', cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-dasharray': '56.549', 'stroke-dashoffset': String(56.549 * (1 - (fraction ?? 0)))
    });
    svg.appendChild(fill);
    return svg;
  }
  function renderQuotaDetails(selection) {
    const body = shadow?.getElementById('quota-body');
    if (!body) return;
    if (typeof body.replaceChildren === 'function') body.replaceChildren();
    else {
      body.textContent = '';
      if (Array.isArray(body.children)) body.children.length = 0;
    }
    if (!selection.groups.length) {
      body.appendChild(make('p', { class: 'quota-empty' }, data?.quota?.state === 'live' ? '当前模型暂无可用额度窗口。' : '当前用量不可用，将自动重试。'));
      return;
    }
    const selectedIds = new Set(selection.selected.map(group => group.id));
    for (const group of selection.groups) {
      const heading = make('h4', { class: selectedIds.has(group.id) ? 'quota-group selected' : 'quota-group' }, group.displayName);
      body.appendChild(heading);
      for (const bucket of group.buckets || []) {
        const fraction = clampFraction(bucket.remainingFraction);
        const percent = fraction === null || bucket.disabled ? '—' : `${Math.round(fraction * 100)}% 剩余`;
        const reset = resetText(bucket);
        const left = make('div', { class: 'quota-window-left' },
          make('div', { class: 'quota-window-name' }, bucket.displayName),
          ...(reset ? [make('div', { class: 'quota-reset' }, reset)] : []));
        const right = make('div', { class: 'quota-window-value' }, make('span', {}, percent), quotaRing(fraction));
        body.appendChild(make('div', { class: 'quota-window' }, left, right));
      }
    }
  }
  function render() {
    if (!shadow) return;
    const context = data?.context, speed = data?.speed;
    const percentage = typeof context?.usedFraction === 'number' ? Math.round(context.usedFraction * 100) : null;
    shadow.getElementById('context-value').textContent = percentage !== null ? String(Math.min(999, percentage)) + (percentage > 999 ? '+' : '') : '—';
    shadow.getElementById('context-fill').style.strokeDashoffset = String(62.832 * (1 - Math.max(0, Math.min(1, context?.usedFraction ?? 0))));
    const resolvedEndpoint = context?.endpointModel
      || ((!context?.model || !speed?.model || context.model === speed.model) ? speed?.endpointModel : '')
      || '';
    button.setAttribute('aria-label', percentage !== null
      ? `上下文估算 ${percentage}%${resolvedEndpoint ? '，底层模型 ' + resolvedEndpoint : ''}，点击查看详情`
      : '上下文估算暂不可用，点击查看详情');
    button.dataset.tone = percentage >= 90 ? 'high' : percentage >= 75 ? 'medium' : 'normal';
    button.title = percentage !== null
      ? `EasyAG 上下文估算 ${percentage}%${resolvedEndpoint ? ' · ' + resolvedEndpoint : ''} · 点击查看详情`
      : 'EasyAG 上下文估算暂不可用 · 点击查看详情';
    shadow.getElementById('usage').textContent = context
      ? `${compact(context.usedTokens)} / ${context.maxTokens === null ? '容量未知' : compact(context.maxTokens)} tokens` : '暂不可用';
    const domModel = typeof composer?.anchor?.textContent === 'string' ? composer.anchor.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const resolvedModel = context?.model || speed?.model || domModel || '—';
    shadow.getElementById('model').textContent = resolvedModel;
    const endpointNode = shadow.getElementById('endpoint');
    if (endpointNode) endpointNode.textContent = resolvedEndpoint || '—';
    shadow.getElementById('speed').textContent = speed ? `${speed.tokensPerSecond.toFixed(1)} tok/s` : '等待有效请求';
    shadow.getElementById('ttft').textContent = speed?.ttftSeconds !== null && speed?.ttftSeconds !== undefined ? `${speed.ttftSeconds.toFixed(2)} 秒` : '—';
    const noteModel = speed?.model || context?.model || domModel;
    shadow.getElementById('speedNote').textContent = !speed ? '速度来自请求完成后的元数据，不是瞬时速度。'
      : `${speed.basis === 'response' ? '按可见输出计算' : '输出字段不全，按总输出计算'}${speed.shortSample ? '；短样本波动较大' : ''}。${noteModel ? '采样模型：' + noteModel : ''}`;
    shadow.getElementById('updated').textContent = data?.state === 'live'
      ? `采集于 ${new Date(data.sampledAt).toLocaleTimeString()}；上下文为最近请求开始时的宿主估算。`
      : data?.quota?.state === 'live' && data.sampledAt
        ? `模型用量采集于 ${new Date(data.sampledAt).toLocaleTimeString()}；每分钟或发送消息后刷新。`
      : pending ? '正在读取本地统计…'
        : !route ? '打开或新建对话后读取上下文统计；模型用量会自动更新。'
          : '当前统计不可用，将自动重试；不影响其他增强功能。';
    const quota = quotaSelection();
    const quotaPercent = quota.remainingFraction === null ? null : Math.round(quota.remainingFraction * 100);
    const quotaValue = shadow.getElementById('quota-value');
    if (quotaValue) quotaValue.textContent = quotaPercent === null
      ? '—'
      : String(Math.min(999, quotaPercent)) + (quotaPercent > 999 ? '+' : '');
    quotaButton.setAttribute('aria-label', quotaPercent === null
      ? '模型用量暂不可用，点击查看详情'
      : `当前模型剩余用量 ${quotaPercent}%，点击查看详情`);
    quotaButton.dataset.state = quotaPercent === null ? 'unknown' : 'live';
    quotaButton.title = quotaPercent === null
      ? 'EasyAG 模型用量暂不可用 · 点击查看详情'
      : `EasyAG 当前模型剩余用量 ${quotaPercent}% · 点击查看详情`;
    const quotaFill = shadow.getElementById('quota-fill');
    if (quotaFill) quotaFill.style.strokeDashoffset = String(62.832 * (1 - (quota.remainingFraction ?? 0)));
    renderQuotaDetails(quota);
    positionCard(card, button);
    positionCard(quotaCard, quotaButton);
  }
  function createNode() {
    node = doc.createElement('span');
    node.id = 'easyag-context-monitor';
    node.style.cssText = 'display:flex;flex:0 1 auto;min-width:0;max-width:130px;margin:0 4px;position:relative;overflow:visible;';
    shadow = node.attachShadow({ mode: 'open' });
    shadow.appendChild(make("style", {}, `
      :host{font:11px system-ui,sans-serif;color:inherit}.strip{display:flex;align-items:center;gap:3px;min-width:0}button{font:inherit;color:inherit;cursor:pointer;border:0;border-radius:5px;background:transparent;padding:3px;white-space:nowrap}
      .indicator{display:flex;align-items:center;justify-content:center;gap:3px;height:28px;box-sizing:border-box;min-width:28px;font-variant-numeric:tabular-nums}.indicator svg{width:24px;height:24px;flex:none}.ring-track{opacity:.17}.ring-fill{transform:rotate(-90deg);transform-origin:12px 12px}.ring-number{font:700 7px system-ui,sans-serif;fill:currentColor}.indicator[data-tone=normal]{color:inherit}.indicator[data-tone=low]{color:#6faec7}
      .quota-indicator{color:#16a34a;min-width:28px}.quota-indicator[data-state=unknown]{opacity:.45}.quota-indicator svg{width:24px;height:24px}.quota-track,.quota-fill{transform:rotate(-90deg);transform-origin:12px 12px}.quota-track{opacity:.18}.quota-number{font:700 7px system-ui,sans-serif;fill:currentColor}
      button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 10%,transparent)}button:focus-visible{outline:1px solid currentColor}button[data-tone=medium]{color:#c69026}button[data-tone=high]{color:#e16e65}
      .card{box-sizing:border-box;position:fixed;inset:auto;margin:0;z-index:2147483000;max-height:calc(100vh - 16px);overflow:auto;padding:14px;border-radius:10px;border:1px solid var(--vscode-widget-border,#7776);background:var(--vscode-editorWidget-background,Canvas);color:var(--vscode-editor-foreground,CanvasText);box-shadow:0 8px 24px #0003;font:12px system-ui,sans-serif}
      [hidden]{display:none!important}.head{display:flex;justify-content:space-between;align-items:center}.head button{font-size:16px}dl{margin:10px 0}dl div{display:flex;gap:12px;justify-content:space-between;margin:8px 0}dt{opacity:.7}dd{margin:0;max-width:65%;text-align:right;overflow-wrap:anywhere}.note{font-size:11px;line-height:1.6;opacity:.7;margin:8px 0 0}
      .quota-group{font-size:13px;margin:12px 0 6px}.quota-group.selected{color:#16a34a}.quota-window{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:9px 0}.quota-window-left{min-width:0}.quota-window-name{font-size:12px}.quota-reset{font-size:11px;line-height:1.45;opacity:.68}.quota-window-value{display:flex;align-items:center;gap:7px;white-space:nowrap;font-variant-numeric:tabular-nums;color:#16a34a}.quota-window-value svg{flex:none}.quota-empty{opacity:.7;line-height:1.5}
    `));
    shadow.appendChild(make("div", {"id": "strip", "class": "strip"},
      make("button", {"id": "trigger", "class": "indicator", "type": "button", "aria-expanded": "false", "aria-controls": "details", "aria-label": "上下文估算"},
        make("svg", {"viewBox": "0 0 24 24", "aria-hidden": "true"},
          make("circle", {"class": "ring-track", "cx": "12", "cy": "12", "r": "10", "fill": "none", "stroke": "currentColor", "stroke-width": "2"}),
          make("circle", {"id": "context-fill", "class": "ring-fill", "cx": "12", "cy": "12", "r": "10", "fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-dasharray": "62.832", "stroke-dashoffset": "62.832"}),
          make("text", {"id": "context-value", "class": "ring-number", "x": "12", "y": "12", "text-anchor": "middle", "dominant-baseline": "central"}, "—")
        )
      ),
      make("button", {"id": "quota-trigger", "class": "indicator quota-indicator", "type": "button", "aria-expanded": "false", "aria-controls": "quota-details", "aria-label": "模型用量"},
        make("svg", {"viewBox": "0 0 24 24", "aria-hidden": "true"},
          make("circle", {"class": "quota-track", "cx": "12", "cy": "12", "r": "10", "fill": "none", "stroke": "currentColor", "stroke-width": "2"}),
          make("circle", {"id": "quota-fill", "class": "quota-fill", "cx": "12", "cy": "12", "r": "10", "fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-dasharray": "62.832", "stroke-dashoffset": "62.832"}),
          make("text", {"id": "quota-value", "class": "quota-number", "x": "12", "y": "12", "text-anchor": "middle", "dominant-baseline": "central"}, "—")
        )
      )
    ));
    shadow.appendChild(make("section", {"id": "details", "class": "card", "role": "region", "aria-label": "EasyAG 上下文详情", "hidden": ""},
      make("div", {"class": "head"},
        make("strong", {}, "上下文估算"),
        make("button", {"id": "close", "type": "button", "aria-label": "关闭详情"}, "×")
      ),
      make("dl", {},
        make("div", {},
          make("dt", {}, "占用 / 容量"),
          make("dd", {"id": "usage"})
        ),
        make("div", {},
          make("dt", {}, "采样模型"),
          make("dd", {"id": "model"})
        ),
        make("div", {"id": "endpoint-row"},
          make("dt", {}, "底层端点模型"),
          make("dd", {"id": "endpoint"})
        ),
        make("div", {},
          make("dt", {}, "最近有效请求速度"),
          make("dd", {"id": "speed"})
        ),
        make("div", {},
          make("dt", {}, "该请求首 token 等待"),
          make("dd", {"id": "ttft"})
        )
      ),
      make("p", {"class": "note", "id": "speedNote"}),
      make("p", {"class": "note", "id": "updated"}),
      make("p", {"class": "note"}, "占用可能在压缩后下降；百分比不代表模型能记住多少内容。")
    ));
    shadow.appendChild(make("section", {"id": "quota-details", "class": "card", "role": "region", "aria-label": "EasyAG 模型用量", "hidden": ""},
      make("div", {"class": "head"},
        make("strong", {}, "用量"),
        make("button", {"id": "quota-close", "type": "button", "aria-label": "关闭用量详情"}, "×")
      ),
      make("div", {"id": "quota-body"})
    ));
    button = shadow.getElementById('trigger');
    card = shadow.getElementById('details');
    quotaButton = shadow.getElementById('quota-trigger');
    quotaCard = shadow.getElementById('quota-details');
    if (typeof card.showPopover === 'function') card.setAttribute('popover', 'manual');
    if (typeof quotaCard.showPopover === 'function') quotaCard.setAttribute('popover', 'manual');
    button.addEventListener('click', () => { if (card.hidden) showCard(); else hideCard(card, button); });
    quotaButton.addEventListener('click', () => { if (quotaCard.hidden) showQuotaCard(); else hideCard(quotaCard, quotaButton); });
    shadow.getElementById('close').addEventListener('click', () => { hideCard(card, button); button.focus({ preventScroll: true }); });
    shadow.getElementById('quota-close').addEventListener('click', () => { hideCard(quotaCard, quotaButton); quotaButton.focus({ preventScroll: true }); });
    // Keep host focus handlers from swallowing our clicks, without cancelling keyboard defaults.
    for (const type of ['pointerdown', 'mousedown', 'click']) node.addEventListener(type, event => event.stopPropagation());
    render();
  }
  function fit() {
    if (!node?.isConnected || !composer) return;
    node.hidden = false;
    node.style.display = 'flex';
    const r = node.getBoundingClientRect(), row = composer.row.getBoundingClientRect();
    let blocked = r.width + 1 < shadow.getElementById('strip').scrollWidth || r.right > row.right + 1 || r.left < row.left - 1 || !safeLayout(composer);
    const localControls = new Set(composer.row.parentElement.querySelectorAll('button,input,[role="button"],[role="combobox"]'));
    const controls = new Set([...localControls, ...doc.querySelectorAll('button,input,[role="button"],[role="combobox"]')]);
    if (!blocked) for (const control of controls) {
      if (!visible(control)) continue;
      const c = control.getBoundingClientRect();
      const left = Math.max(r.left, c.left), right = Math.min(r.right, c.right), top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
      const overlap = right - left > 1 && bottom - top > 1;
      if (localControls.has(control)) {
        if ((control.clientWidth > 0 && control.scrollWidth > control.clientWidth + 1) || overlap) { blocked = true; break; }
      } else if (overlap && typeof doc.elementFromPoint === 'function') {
        const hit = doc.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (hit === control || control.contains(hit)) { blocked = true; break; }
      }
    }
    node.hidden = blocked;
    node.style.display = blocked ? 'none' : 'flex';
    if (blocked) hideCards();
  }
  function syncTheme() {
    if (!node || !composer) return;
    node.style.color = win.getComputedStyle(composer.row).color;
    let background;
    for (let element = composer.editor; element && element !== doc.documentElement; element = element.parentElement) {
      const value = win.getComputedStyle(element).backgroundColor;
      if (value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') { background = value; break; }
    }
    for (const target of [card, quotaCard]) {
      if (!target) continue;
      if (background) target.style.background = background;
      if (node.style.color) target.style.color = node.style.color;
    }
  }
  function syncRoute() {
    const next = conversationId();
    if (next === route) return;
    route = next; pending = null; data = null; lastFetch = 0;
    hideCards(); render();
  }
  function mount() {
    syncRoute();
    // The model selector and quota indicator are useful on the new-conversation
    // page too. Quota statistics do not require a conversation ID.
    const found = findComposer();
    if (!found) { hideCards(); node?.remove(); composer = null; resizeObserver?.disconnect(); return; }
    const changed = composer?.row !== found.row || composer?.branch !== found.branch;
    composer = found;
    if (!node) createNode();
    if (!node.isConnected || changed) {
      hideCards(); found.row.insertBefore(node, found.branch.nextSibling);
      resizeObserver?.disconnect();
      if (typeof win.ResizeObserver === 'function') {
        resizeObserver ||= new win.ResizeObserver(schedule);
        for (const target of [found.row, found.editor, found.branch]) resizeObserver.observe(target);
      }
    }
    syncTheme(); fit(); positionCard(card, button); positionCard(quotaCard, quotaButton);
  }
  const attribute = (element, name) => {
    if (!element) return '';
    if (typeof element.getAttribute === 'function') return element.getAttribute(name) || '';
    return element.attrs?.[name] || '';
  };
  const isButton = element => element?.tagName === 'BUTTON' || attribute(element, 'role') === 'button';
  const isSendControl = element => {
    if (!isButton(element)) return false;
    const description = [
      attribute(element, 'aria-label'),
      attribute(element, 'data-testid'),
      attribute(element, 'title'),
      attribute(element, 'name'),
      element.textContent
    ].filter(Boolean).join(' ');
    return /send|submit|发送|提交/i.test(description);
  };
  const controlFromEvent = event => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.find(isButton);
  };
  const belongsToComposer = control => Boolean(control && composer
    && (composer.row?.contains?.(control) || composer.row?.parentElement?.contains?.(control)));
  function scheduleSendRefresh() {
    if (disposed || !enabled || typeof win.setTimeout !== 'function') return;
    sendRefreshQueued = true;
    if (sendTimer !== undefined) win.clearTimeout(sendTimer);
    sendTimer = win.setTimeout(() => {
      sendTimer = undefined;
      lastFetch = 0;
      if (pending) return;
      sendRefreshQueued = false;
      refresh('send');
    }, 800);
  }
  function refresh(reason = 'timer') {
    if (!enabled || disposed || doc.hidden || !node?.isConnected || node.hidden) return;
    const timestamp = now();
    const due = lastFetch === 0 || timestamp - lastFetch >= REFRESH_INTERVAL_MS;
    const urgent = reason === 'send' || due;
    if (pending && timestamp - pending.at < 25000) return;
    if (pending) pending = null;
    if (!urgent) { render(); return; }
    if (data?.sampledAt && timestamp - data.sampledAt > REFRESH_INTERVAL_MS) data = null;
    const requestId = String(++sequence);
    const conversation = route || null;
    pending = { requestId, conversationId: conversation, at: timestamp }; lastFetch = timestamp;
    const event = {
      type: conversation ? 'context-metrics' : 'quota-metrics',
      requestId,
      forceQuota: reason === 'send' || due
    };
    if (conversation) event.conversationId = conversation;
    try { report(event); }
    catch { pending = null; data = null; }
    render();
  }
  function receive(requestId, result) {
    const currentConversation = conversationId();
    if (disposed || !pending || pending.requestId !== requestId
      || pending.conversationId !== currentConversation
      || (result?.conversationId ?? null) !== pending.conversationId) return;
    const refreshAfterSend = sendRefreshQueued;
    pending = null; data = result; render(); fit();
    if (refreshAfterSend) {
      sendRefreshQueued = false;
      lastFetch = 0;
      refresh('send');
    }
  }
  function schedule() {
    if (disposed || frame !== undefined) return;
    frame = win.requestAnimationFrame(() => { frame = undefined; if (!disposed) { mount(); refresh(); } });
  }
  const onPointer = event => { if (!event.composedPath().includes(node)) hideCards(); };
  const onSendClick = event => {
    if (event.composedPath?.().includes(node)) return;
    const control = controlFromEvent(event);
    if (isSendControl(control) && belongsToComposer(control)) scheduleSendRefresh();
  };
  const onSubmit = event => {
    if (belongsToComposer(event.target)) scheduleSendRefresh();
  };
  const onKey = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing
      && composer?.editor && (event.target === composer.editor || composer.editor.contains?.(event.target))) {
      scheduleSendRefresh();
      return;
    }
    if (event.key === 'Escape') {
      const focused = shadow?.activeElement;
      hideCards();
      if (focused) (focused === quotaButton ? quotaButton : button)?.focus({ preventScroll: true });
    }
  };
  doc.addEventListener('pointerdown', onPointer);
  doc.addEventListener('click', onSendClick, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('scroll', schedule, true);
  win.addEventListener('resize', schedule);
  observer = new win.MutationObserver(records => {
    if (records.some(record => record.target !== node && !node?.contains(record.target))) schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  const timer = win.setInterval(() => { mount(); refresh(); }, 1000);
  win.__easyagContext = { receive, dispose() {
    disposed = true; pending = null; data = null; sendRefreshQueued = false; hideCards(); node?.remove();
    if (sendTimer !== undefined) win.clearTimeout(sendTimer);
    win.clearInterval(timer); if (frame !== undefined) win.cancelAnimationFrame(frame);
    observer.disconnect(); resizeObserver?.disconnect();
    doc.removeEventListener('pointerdown', onPointer); doc.removeEventListener('click', onSendClick, true);
    doc.removeEventListener('submit', onSubmit, true); doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule);
    delete win.__easyagContext;
  } };
  mount(); refresh();
}

module.exports = { installContextWidget };
