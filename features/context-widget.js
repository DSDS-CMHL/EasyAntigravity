// Local composer geometry checks adapted from Antigrative Dashboard (MIT).
// Copyright (c) 2026 AG Pulse contributors. See THIRD-PARTY-NOTICES.md.
function installContextWidget(win, doc, enabled, report, riskEnabled = false) {
  win.__easyagContext?.dispose();
  if (!enabled && !riskEnabled) return;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let node, shadow, button, card, composer, data, route = '', pending, lastFetch = 0, sequence = 0, disposed = false;
  let observer, resizeObserver, frame;
  let riskButton, riskCard, riskData, riskPending, riskFetchedAt = 0, activeCard = null;
  const conversationId = () => {
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
        const pair = { row, branch, editor, distance };
        if (safeLayout(pair)) pairs.push(pair);
      }
    }
    // Deliberately no generic combobox or title-label fallback: ambiguous layouts stay untouched.
    pairs.sort((a, b) => a.distance - b.distance);
    return pairs.length && (pairs.length === 1 || pairs[0].distance < pairs[1].distance) ? pairs[0] : null;
  }
  function hideCard() {
    for (const element of [card, riskCard]) {
      if (!element) continue;
      if (element.hasAttribute('popover') && element.matches(':popover-open')) element.hidePopover();
      element.hidden = true;
    }
    button?.setAttribute('aria-expanded', 'false');
    riskButton?.setAttribute('aria-expanded', 'false');
    activeCard = null;
  }
  function positionCard() {
    const element = activeCard === 'risk' ? riskCard : card;
    const trigger = activeCard === 'risk' ? riskButton : button;
    if (!element || element.hidden || !node?.isConnected) return;
    const r = trigger.getBoundingClientRect(), width = Math.min(304, win.innerWidth - 16);
    element.style.width = Math.max(0, width) + 'px';
    element.style.left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8)) + 'px';
    const height = element.getBoundingClientRect().height;
    element.style.top = Math.max(8, Math.min(r.top - height - 8, win.innerHeight - height - 8)) + 'px';
  }
  function showCard(name = 'context') {
    if (!node?.isConnected || node.hidden) return;
    hideCard();
    activeCard = name;
    const element = name === 'risk' ? riskCard : card, trigger = name === 'risk' ? riskButton : button;
    element.hidden = false;
    if (element.hasAttribute('popover') && !element.matches(':popover-open')) element.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    positionCard();
  }
  const compact = value => value >= 1000 ? (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(value);
  function render() {
    if (!shadow) return;
    const context = data?.context, speed = data?.speed;
    const percentage = typeof context?.usedFraction === 'number' ? Math.round(context.usedFraction * 100) : null;
    shadow.getElementById('context-value').textContent = percentage !== null ? String(Math.min(999, percentage)) + (percentage > 999 ? '+' : '') : '—';
    shadow.getElementById('context-fill').style.strokeDashoffset = String(62.832 * (1 - Math.max(0, Math.min(1, context?.usedFraction ?? 0))));
    button.setAttribute('aria-label', percentage !== null ? `上下文估算 ${percentage}%，点击查看详情` : '上下文估算暂不可用，点击查看详情');
    button.dataset.tone = percentage >= 90 ? 'high' : percentage >= 75 ? 'medium' : 'normal';
    button.title = percentage !== null ? `EasyAG 上下文估算 ${percentage}% · 点击查看详情` : 'EasyAG 上下文估算暂不可用 · 点击查看详情';
    shadow.getElementById('usage').textContent = context
      ? `${compact(context.usedTokens)} / ${context.maxTokens === null ? '容量未知' : compact(context.maxTokens)} tokens` : '暂不可用';
    shadow.getElementById('model').textContent = context?.model || '—';
    shadow.getElementById('speed').textContent = speed ? `${speed.tokensPerSecond.toFixed(1)} tok/s` : '等待有效请求';
    shadow.getElementById('ttft').textContent = speed?.ttftSeconds !== null && speed?.ttftSeconds !== undefined ? `${speed.ttftSeconds.toFixed(2)} 秒` : '—';
    shadow.getElementById('speedNote').textContent = !speed ? '速度来自请求完成后的元数据，不是瞬时速度。'
      : `${speed.basis === 'response' ? '按可见输出计算' : '输出字段不全，按总输出计算'}${speed.shortSample ? '；短样本波动较大' : ''}。${speed.model ? '采样模型：' + speed.model : ''}`;
    shadow.getElementById('updated').textContent = data?.state === 'live'
      ? `采集于 ${new Date(data.sampledAt).toLocaleTimeString()}；上下文为最近请求开始时的宿主估算。`
      : pending ? '正在读取本地统计…' : '当前统计不可用，将自动重试；不影响其他增强功能。';
    positionCard();
  }
  function renderRisk() {
    if (!shadow) return;
    const total = riskData?.total;
    const count = Number.isSafeInteger(total) && total >= 0 ? total : null;
    shadow.getElementById('risk-value').textContent = count === null ? '—' : count > 999 ? compact(count) : String(count);
    riskButton.dataset.tone = count ? riskData.highestLevel || 'low' : 'normal';
    riskButton.title = count === null ? 'EasyAG 本次风险提醒 · 正在同步' : `EasyAG 本次风险提醒 ${count} 次 · 点击查看分级`;
    riskButton.setAttribute('aria-label', riskButton.title);
    for (const level of ['high', 'medium', 'low']) shadow.getElementById('risk-' + level).textContent = riskData ? String(riskData.counts[level]) : '—';
    shadow.getElementById('risk-note').textContent = riskData?.enabled === false ? '当前未启用 ARES 风险提醒。'
      : '本次 AG 会话累计；同一次命令执行不重复计数。风险提醒不代表已阻止执行。';
    positionCard();
  }
  function createNode() {
    node = doc.createElement('span');
    node.id = 'easyag-context-monitor';
    node.style.cssText = 'display:flex;flex:0 1 auto;min-width:0;max-width:130px;margin:0 4px;position:relative;overflow:visible;';
    shadow = node.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font:11px system-ui,sans-serif;color:inherit}.strip{display:flex;align-items:center;gap:3px;min-width:0}button{font:inherit;color:inherit;cursor:pointer;border:0;border-radius:5px;background:transparent;padding:3px;white-space:nowrap}
      .indicator{display:flex;align-items:center;justify-content:center;gap:3px;height:28px;box-sizing:border-box;min-width:28px;font-variant-numeric:tabular-nums}.indicator svg{width:24px;height:24px;flex:none}.ring-track{opacity:.17}.ring-fill{transform:rotate(-90deg);transform-origin:12px 12px}.ring-number{font:7px system-ui,sans-serif;fill:currentColor}.risk-value{font-size:11px;font-weight:600;padding-right:2px}.indicator[data-tone=normal]{color:inherit}.indicator[data-tone=low]{color:#6faec7}
      #risk-trigger[data-tone=normal]{color:#969da7}
      button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 10%,transparent)}button:focus-visible{outline:1px solid currentColor}button[data-tone=medium]{color:#c69026}button[data-tone=high]{color:#e16e65}
      .card{box-sizing:border-box;position:fixed;inset:auto;margin:0;z-index:2147483000;max-height:calc(100vh - 16px);overflow:auto;padding:14px;border-radius:10px;border:1px solid var(--vscode-widget-border,#7776);background:var(--vscode-editorWidget-background,Canvas);color:var(--vscode-editor-foreground,CanvasText);box-shadow:0 8px 24px #0003;font:12px system-ui,sans-serif}
      [hidden]{display:none!important}.head{display:flex;justify-content:space-between;align-items:center}.head button{font-size:16px}dl{margin:10px 0}dl div{display:flex;gap:12px;justify-content:space-between;margin:8px 0}dt{opacity:.7}dd{margin:0;max-width:65%;text-align:right;overflow-wrap:anywhere}.note{font-size:11px;line-height:1.6;opacity:.7;margin:8px 0 0}
      .risk-high{color:#e16e65}.risk-medium{color:#c69026}.risk-low{color:#6faec7}
    </style><div id="strip" class="strip"><button id="trigger" class="indicator" type="button" aria-expanded="false" aria-controls="details" aria-label="上下文估算">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-track" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle id="context-fill" class="ring-fill" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="62.832" stroke-dashoffset="62.832"/><text id="context-value" class="ring-number" x="12" y="12" text-anchor="middle" dominant-baseline="central">—</text></svg></button>
    <button id="risk-trigger" class="indicator" type="button" aria-expanded="false" aria-controls="risk-details" aria-label="本次风险提醒"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3 22 21H2Z" stroke-linejoin="round"/><path d="M12 9v5" stroke-linecap="round"/><circle cx="12" cy="17.5" r=".8" fill="currentColor" stroke="none"/></svg><span id="risk-value" class="risk-value">—</span></button></div>
    <section id="details" class="card" role="region" aria-label="EasyAG 上下文详情" hidden><div class="head"><strong>上下文估算</strong><button id="close" type="button" aria-label="关闭详情">×</button></div>
    <dl><div><dt>占用 / 容量</dt><dd id="usage"></dd></div><div><dt>采样模型</dt><dd id="model"></dd></div><div><dt>最近有效请求速度</dt><dd id="speed"></dd></div><div><dt>该请求首 token 等待</dt><dd id="ttft"></dd></div></dl>
    <p class="note" id="speedNote"></p><p class="note" id="updated"></p><p class="note">占用可能在压缩后下降；百分比不代表模型能记住多少内容。</p></section>
    <section id="risk-details" class="card" role="region" aria-label="EasyAG 风险分级统计" hidden><div class="head"><strong>本次风险提醒</strong><button id="risk-close" type="button" aria-label="关闭风险统计">×</button></div>
    <dl><div><dt class="risk-high">高风险</dt><dd id="risk-high">—</dd></div><div><dt class="risk-medium">中风险</dt><dd id="risk-medium">—</dd></div><div><dt class="risk-low">低风险</dt><dd id="risk-low">—</dd></div></dl><p id="risk-note" class="note"></p></section>`;
    button = shadow.getElementById('trigger');
    card = shadow.getElementById('details');
    riskButton = shadow.getElementById('risk-trigger');
    riskCard = shadow.getElementById('risk-details');
    button.hidden = !enabled;
    riskButton.hidden = !riskEnabled;
    for (const element of [card, riskCard]) if (typeof element.showPopover === 'function') element.setAttribute('popover', 'manual');
    button.addEventListener('click', () => { if (card.hidden) showCard(); else hideCard(); });
    shadow.getElementById('close').addEventListener('click', () => { hideCard(); button.focus({ preventScroll: true }); });
    riskButton.addEventListener('click', () => { if (riskCard.hidden) showCard('risk'); else hideCard(); });
    shadow.getElementById('risk-close').addEventListener('click', () => { hideCard(); riskButton.focus({ preventScroll: true }); });
    // Keep host focus handlers from swallowing our clicks, without cancelling keyboard defaults.
    for (const type of ['pointerdown', 'mousedown', 'click']) node.addEventListener(type, event => event.stopPropagation());
    render(); renderRisk();
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
    if (blocked) hideCard();
  }
  function syncTheme() {
    if (!node || !composer) return;
    node.style.color = win.getComputedStyle(composer.row).color;
    let background;
    for (let element = composer.editor; element && element !== doc.documentElement; element = element.parentElement) {
      const value = win.getComputedStyle(element).backgroundColor;
      if (value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') { background = value; break; }
    }
    for (const element of [card, riskCard]) {
      if (background) element.style.background = background;
      if (node.style.color) element.style.color = node.style.color;
    }
  }
  function syncRoute() {
    const next = conversationId();
    if (next === route) return;
    route = next; pending = null; riskPending = null; data = null; lastFetch = 0; riskFetchedAt = 0;
    hideCard(); render();
  }
  function mount() {
    syncRoute();
    const found = route && findComposer();
    if (!found) { hideCard(); node?.remove(); composer = null; resizeObserver?.disconnect(); return; }
    const changed = composer?.row !== found.row || composer?.branch !== found.branch;
    composer = found;
    if (!node) createNode();
    if (!node.isConnected || changed) {
      hideCard(); found.row.insertBefore(node, found.branch.nextSibling);
      resizeObserver?.disconnect();
      if (typeof win.ResizeObserver === 'function') {
        resizeObserver ||= new win.ResizeObserver(schedule);
        for (const target of [found.row, found.editor, found.branch]) resizeObserver.observe(target);
      }
    }
    syncTheme(); fit(); positionCard();
  }
  function refresh() {
    if (!enabled || disposed || doc.hidden || !route || !node?.isConnected || node.hidden) return;
    if (pending && Date.now() - pending.at < 25000) return;
    if (Date.now() - lastFetch < 3000) return;
    if (pending || (data?.sampledAt && Date.now() - data.sampledAt > 30000)) data = null;
    const requestId = String(++sequence);
    pending = { requestId, conversationId: route, at: Date.now() }; lastFetch = Date.now();
    try { report({ type: 'context-metrics', requestId, conversationId: route }); }
    catch { pending = null; data = null; }
    render();
  }
  function receive(requestId, result) {
    if (disposed || !pending || pending.requestId !== requestId || pending.conversationId !== conversationId()
      || result?.conversationId !== pending.conversationId) return;
    pending = null; data = result; render(); fit();
  }
  function refreshRisk() {
    if (!riskEnabled || disposed || doc.hidden || !route || !node?.isConnected || node.hidden) return;
    if (riskPending && Date.now() - riskPending.at < 5000) return;
    if (Date.now() - riskFetchedAt < 1000) return;
    const requestId = String(++sequence);
    riskPending = { requestId, conversationId: route, at: Date.now() }; riskFetchedAt = Date.now();
    try { report({ type: 'risk-stats', requestId, conversationId: route }); } catch { riskPending = null; }
  }
  function receiveRisk(requestId, result) {
    if (disposed || !riskPending || riskPending.requestId !== requestId || riskPending.conversationId !== conversationId()) return;
    riskPending = null;
    if (!result || !Number.isSafeInteger(result.session) || !Number.isSafeInteger(result.revision)
      || !Number.isSafeInteger(result.total) || result.total < 0
      || !['high', 'medium', 'low'].every(level => Number.isSafeInteger(result.counts?.[level]) && result.counts[level] >= 0)
      || result.total !== result.counts.high + result.counts.medium + result.counts.low) return;
    if (riskData && (result.session < riskData.session || (result.session === riskData.session && result.revision < riskData.revision))) return;
    riskData = result; renderRisk(); fit();
  }
  function schedule() {
    if (disposed || frame !== undefined) return;
    frame = win.requestAnimationFrame(() => { frame = undefined; if (!disposed) { mount(); refresh(); refreshRisk(); } });
  }
  const onPointer = event => { if (!event.composedPath().includes(node)) hideCard(); };
  const onKey = event => { if (event.key === 'Escape') { const focused = Boolean(shadow?.activeElement), trigger = activeCard === 'risk' ? riskButton : button; hideCard(); if (focused) trigger?.focus({ preventScroll: true }); } };
  doc.addEventListener('pointerdown', onPointer);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('scroll', schedule, true);
  win.addEventListener('resize', schedule);
  observer = new win.MutationObserver(records => {
    if (records.some(record => record.target !== node && !node?.contains(record.target))) schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  const timer = win.setInterval(() => { mount(); refresh(); refreshRisk(); }, 1000);
  win.__easyagContext = { receive, receiveRisk, dispose() {
    disposed = true; pending = null; riskPending = null; data = null; riskData = null; hideCard(); node?.remove();
    win.clearInterval(timer); if (frame !== undefined) win.cancelAnimationFrame(frame);
    observer.disconnect(); resizeObserver?.disconnect();
    doc.removeEventListener('pointerdown', onPointer); doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule);
    delete win.__easyagContext;
  } };
  mount(); refresh(); refreshRisk();
}

module.exports = { installContextWidget };
