import { api } from './api.js';

const element = id => document.getElementById(id);
const consoleBox = element('consoleBox');
let phase = 'idle';
let settingsQueue = Promise.resolve();
let refreshing = false;
let stream;
let pollTimer;
let launchPending = false;
let activeTarget = 'hub';
let activeTargetName = 'Antigravity';
let clientRunningState = false;
let currentTargets = {};
let pathModalDismissed = false;
const logKeys = new Set();

// Suppress the embedded browser's default menu in the launcher.
document.addEventListener('contextmenu', event => event.preventDefault());

function appendLog(category, message, cls = '', at) {
  const key = at && `${at}|${category}|${message}`;
  if (key && logKeys.has(key)) return;
  if (key) {
    logKeys.add(key);
    if (logKeys.size > 500) logKeys.delete(logKeys.values().next().value);
  }
  const line = document.createElement('div');
  line.className = 'log-line';
  if (/^tag-[a-z-]+$/.test(cls)) line.classList.add(cls);
  const time = new Date(at || Date.now()).toLocaleTimeString();
  line.textContent = `[${time}] [${category || 'SYSTEM'}] ${message || ''}`;
  consoleBox.appendChild(line);
  while (consoleBox.children.length > 300) consoleBox.firstElementChild.remove();
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function report(error) { appendLog('SYSTEM', error.message || String(error), 'tag-alert'); }

function updateProxyUi(enabled) {
  const row = element('proxyPortRow');
  const badge = element('patchStatusBadge');
  const busyOrRunning = ['preparing', 'launching', 'running'].includes(phase);
  if (row) row.classList.toggle('disabled', !enabled);
  document.querySelectorAll('[data-port]').forEach(control => {
    control.disabled = !enabled || busyOrRunning;
  });
  if (element('proxyPortInput')) {
    element('proxyPortInput').disabled = !enabled || busyOrRunning;
  }
  if (badge) {
    badge.textContent = enabled ? '· 本地代理就绪' : '· 直连模式（不挂代理）';
    badge.style.color = enabled ? 'var(--green)' : 'var(--text-dark)';
  }
}

function renderPhase(next, targetName = activeTargetName) {
  phase = next;
  document.body.dataset.uiState = next;
  const busy = ['preparing', 'launching'].includes(next);
  const locked = busy || next === 'running';
  const button = element('launchBtn');
  button.disabled = locked;
  button.classList.toggle('busy', busy);
  if (element('proxyToggle')) element('proxyToggle').disabled = locked;
  document.querySelectorAll('[data-target]').forEach(control => { control.disabled = locked; });
  const proxyEnabled = element('proxyToggle') ? element('proxyToggle').checked : true;
  document.querySelectorAll('[data-port]').forEach(control => { control.disabled = locked || !proxyEnabled; });
  element('proxyPortInput').disabled = locked || !proxyEnabled;

  const currentObj = currentTargets[activeTarget] || {};
  const isMissing = !currentObj.exists && next === 'idle';

  if (isMissing) {
    element('launchIcon').textContent = '⚠️';
    element('launchText').textContent = `请先配置 ${targetName} 路径`;
    button.style.background = 'var(--surface-subtle)';
    button.style.color = 'var(--text-dark)';
    return;
  }

  button.style.color = '';
  element('launchIcon').textContent = busy ? '◌' : next === 'running' ? '●' : next === 'error' ? '↻' : '🚀';
  element('launchText').textContent = {
    preparing: proxyEnabled ? '正在准备代理环境…' : '正在准备启动环境…',
    launching: `正在启动 ${targetName}…`,
    running: `${targetName} 运行中`,
    error: '启动失败，点击重试'
  }[next] || `启动 ${targetName}`;
  button.style.background = next === 'running' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '';
}


function showModalError(msg) {
  const tip = element('pathEditTip');
  const txt = element('pathErrorText') || element('pathTipText');
  if (tip) {
    tip.style.display = 'flex';
  }
  if (txt) txt.textContent = msg || '指定的文件路径不存在';
}

function showPathModal(visible, customTitle, customDesc) {
  const modal = element('pathModal');
  if (!modal) return;
  if (visible && modal.style.display === 'flex') return;
  modal.style.display = visible ? 'flex' : 'none';
  if (visible) {
    const titleEl = element('modalTargetTitle');
    const descEl = element('pathTipText');
    const input = element('customPathInput');
    const resetBtn = element('resetPathBtn');
    const errorTip = element('pathEditTip');
    const activeObj = currentTargets[activeTarget] || {};

    if (titleEl) titleEl.textContent = customTitle || `未找到 ${activeTargetName}`;
    if (descEl) descEl.textContent = customDesc || `未在默认路径检测到 ${activeTargetName}。如安装在非 C 盘，请点击“浏览”指定 .exe 文件路径：`;
    if (input) {
      input.value = activeObj.appExe || '';
      input.focus();
    }
    if (resetBtn) resetBtn.style.display = activeObj.isCustom ? 'inline-flex' : 'none';
    if (errorTip) errorTip.style.display = 'none';
  }
}

function renderTargetsUi(targets, currentActive) {
  const hubTarget = targets.hub || {};
  const ideTarget = targets.ide || {};

  element('targetHubBtn')?.classList.toggle('active', currentActive === 'hub');
  element('targetIdeBtn')?.classList.toggle('active', currentActive === 'ide');

  const hubDot = element('hubDot');
  if (hubDot) {
    hubDot.className = 'pill-dot ' + (hubTarget.isCustom ? 'custom' : (hubTarget.exists ? 'ready' : 'missing'));
    hubDot.title = hubTarget.exists ? (hubTarget.isCustom ? '已配置自定义路径' : '已就绪 (默认路径)') : '未在默认路径检测到，点击配置';
  }
  const ideDot = element('ideDot');
  if (ideDot) {
    ideDot.className = 'pill-dot ' + (ideTarget.isCustom ? 'custom' : (ideTarget.exists ? 'ready' : 'missing'));
    ideDot.title = ideTarget.exists ? (ideTarget.isCustom ? '已配置自定义路径' : '已就绪 (默认路径)') : '未在默认路径检测到，点击配置';
  }

  const activeObj = currentActive === 'ide' ? ideTarget : hubTarget;
  if (!activeObj.exists && !pathModalDismissed) {
    showPathModal(true);
  }
}

function renderStatus(status) {
  if (status.activeTarget) {
    activeTarget = status.activeTarget;
    activeTargetName = status.targetName || (status.activeTarget === 'ide' ? 'Antigravity IDE' : 'Antigravity');
  }
  if (status.targets) {
    currentTargets = status.targets;
    renderTargetsUi(currentTargets, activeTarget);
  }
  if (status.enableProxy !== undefined && element('proxyToggle')) {
    element('proxyToggle').checked = status.enableProxy;
    updateProxyUi(status.enableProxy);
  }
  if (status.phase && !(launchPending && status.phase === 'idle')) renderPhase(status.phase, activeTargetName);
  if (status.dictEntries !== undefined) {
    element('dictCountBadge').textContent = `· 已载入 ${status.dictEntries} 词条`;
  }
  if (status.version) {
    const versionNode = element('versionBadge');
    if (versionNode) {
      versionNode.textContent = `v${status.version}`;
    }
  }
  if (status.clientRunning !== undefined) {
    clientRunningState = Boolean(status.clientRunning);
    const badge = element('clientStatusBadge');
    badge.className = status.clientRunning ? 'status-capsule active' : 'status-capsule';
    badge.querySelector('span').textContent = status.clientRunning
      ? status.cdpSockets ? '增强已连接' : '运行中'
      : '未运行';
    badge.title = status.cdpError || (status.clientRunning ? `${activeTargetName} 正在运行` : `${activeTargetName} 未运行`);
    renderPhase(status.phase || phase, activeTargetName);
  }
}

function loadSettings(status) {
  if (status.activeTarget) {
    activeTarget = status.activeTarget;
    activeTargetName = status.targetName || (status.activeTarget === 'ide' ? 'Antigravity IDE' : 'Antigravity');
  }
  if (status.targets) {
    currentTargets = status.targets;
  }
  element('proxyPortInput').value = status.port;
  if (element('proxyToggle')) element('proxyToggle').checked = status.enableProxy !== false;
  element('i18nToggle').checked = status.enableI18n;
  element('contextMonitorToggle').checked = status.enableContextMonitor;
  updateProxyUi(status.enableProxy !== false);
  renderStatus(status);
}

function persistSettings() {
  const payload = {
    port: Number(element('proxyPortInput').value),
    enableProxy: element('proxyToggle') ? element('proxyToggle').checked : true,
    enableI18n: element('i18nToggle').checked,
    enableContextMonitor: element('contextMonitorToggle').checked,
    targetApp: activeTarget
  };
  settingsQueue = settingsQueue.catch(() => {}).then(() => api.configure(payload));
  return settingsQueue;
}

async function launch() {
  if (['preparing', 'launching', 'running'].includes(phase)) return;
  const currentObj = currentTargets[activeTarget] || {};
  if (!currentObj.exists) {
    pathModalDismissed = false;
    showPathModal(true);
    report(new Error(`未找到 ${activeTargetName}，请先指定 .exe 路径完成配置`));
    return;
  }
  launchPending = true;
  renderPhase('preparing');
  try {
    await persistSettings();
    renderPhase('launching');
    await api.launch();
    renderPhase('running');
  } catch (error) {
    renderPhase('error');
    report(error);
    pathModalDismissed = false;
    showPathModal(true, `无法启动 ${activeTargetName}`, error.message || '请检查或重新指定可执行文件路径。');
  }
  finally { launchPending = false; }
}

async function checkUpdate() {
  const btn = element('updateBtn');
  const actionLabel = element('updateActionText') || btn;
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  if (actionLabel) actionLabel.textContent = '↻ 检查中…';
  try {
    const result = await api.checkUpdate();
    appendLog('SYSTEM', result.message || '检查更新完成', result.updated ? 'tag-proxy' : 'tag-aa');
    if (result.status) renderStatus(result.status);
    if (actionLabel) actionLabel.textContent = result.updated ? '✓ 已更新' : '↻ 检查更新';
  } catch (error) {
    report(error);
    if (actionLabel) actionLabel.textContent = '↻ 重试';
  } finally {
    setTimeout(() => { if (btn) btn.disabled = false; }, 1200);
  }
}

function currentTheme() {
  const root = document.documentElement;
  return root.dataset.theme === 'light' || root.dataset.theme === 'dark'
    ? root.dataset.theme
    : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme, save = false) {
  document.documentElement.dataset.theme = theme;
  if (save) {
    try { localStorage.setItem('easyag-theme', theme); } catch {}
    void api.setTheme(theme).catch(() => {});
  }
  const btn = element('themeToggleBtn');
  const label = element('themeToggleText');
  if (label) label.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (btn) btn.title = theme === 'dark' ? '当前外观: 深色 (点击切换浅色)' : '当前外观: 浅色 (点击切换深色)';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(consoleBox.innerText);
    appendLog('SYSTEM', '日志已复制', 'tag-proxy');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(consoleBox);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    appendLog('SYSTEM', '已选中日志，可手动复制', 'tag-warn');
  }
}

// 浏览选择可执行文件
async function browseTargetExe() {
  const btn = element('browseExeBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await api.browseExe(activeTarget);
    if (res?.ok && res.path) {
      appendLog('SYSTEM', `已配置 ${activeTargetName} 路径: ${res.path}`, 'tag-proxy');
      pathModalDismissed = false;
      showPathModal(false);
      if (res.status) renderStatus(res.status);
    }
  } catch (err) {
    report(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 保存手动输入的路径
async function saveCustomPath() {
  const input = element('customPathInput');
  const path = input ? input.value.trim() : '';
  if (!path) {
    showModalError('请输入有效的 .exe 文件路径');
    return;
  }
  try {
    const res = await api.setTargetPath({ target: activeTarget, path });
    if (res?.ok) {
      appendLog('SYSTEM', `已保存 ${activeTargetName} 路径: ${res.path}`, 'tag-proxy');
      pathModalDismissed = false;
      showPathModal(false);
      if (res.status) renderStatus(res.status);
    }
  } catch (err) {
    report(err);
    showModalError(err.message || '指定的文件路径不存在');
  }
}

// 恢复默认扫描路径
async function resetDefaultPath() {
  try {
    const res = await api.setTargetPath({ target: activeTarget, path: '' });
    if (res?.ok) {
      appendLog('SYSTEM', `已恢复 ${activeTargetName} 默认检测路径`, 'tag-proxy');
      pathModalDismissed = false;
      showPathModal(false);
      const input = element('customPathInput');
      if (input) input.value = '';
      if (res.status) renderStatus(res.status);
    }
  } catch (err) {
    report(err);
  }
}

const actions = {
  launch,
  hide: () => api.hide(),
  'toggle-theme': toggleTheme,
  'check-update': checkUpdate,
  'copy-logs': copyLogs,
  'clear-logs': () => { consoleBox.replaceChildren(); }
};

document.addEventListener('click', event => {
  const targetBtn = event.target.closest('[data-target]');
  if (targetBtn && !targetBtn.disabled) {
    const nextTarget = targetBtn.dataset.target;
    if (nextTarget && nextTarget !== activeTarget) {
      activeTarget = nextTarget;
      activeTargetName = nextTarget === 'ide' ? 'Antigravity IDE' : 'Antigravity';
      pathModalDismissed = false;
      showPathModal(false);
      element('targetHubBtn')?.classList.toggle('active', activeTarget === 'hub');
      element('targetIdeBtn')?.classList.toggle('active', activeTarget === 'ide');
      renderTargetsUi(currentTargets, activeTarget);
      renderPhase(phase, activeTargetName);
      api.configure({ targetApp: nextTarget }).then(res => {
        if (res?.targetName) activeTargetName = res.targetName;
        renderPhase(phase, activeTargetName);
      }).catch(report);
    }
    return;
  }
  const control = event.target.closest('[data-action],[data-port]');
  if (!control || control.disabled) return;
  const action = control.dataset.port !== undefined ? async () => {
    element('proxyPortInput').value = control.dataset.port;
    await persistSettings();
  } : actions[control.dataset.action];
  if (action) Promise.resolve().then(() => action(control)).catch(report);
});

function dismissPathModal() {
  pathModalDismissed = true;
  showPathModal(false);
}

for (const id of ['modalCloseBtn', 'modalCancelBtn']) {
  element(id)?.addEventListener('click', dismissPathModal);
}
element('pathModal')?.addEventListener('click', event => {
  if (event.target === element('pathModal')) dismissPathModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') dismissPathModal();
});

element('browseExeBtn')?.addEventListener('click', browseTargetExe);
element('savePathBtn')?.addEventListener('click', saveCustomPath);
element('resetPathBtn')?.addEventListener('click', resetDefaultPath);
element('customPathInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCustomPath();
  }
});

element('proxyPortInput').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, ''); });
for (const id of ['proxyPortInput', 'proxyToggle', 'i18nToggle', 'contextMonitorToggle']) {
  element(id)?.addEventListener('change', () => {
    if (id === 'proxyToggle') updateProxyUi(element('proxyToggle').checked);
    persistSettings().catch(report);
  });
}

async function init() {
  applyTheme(currentTheme());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', e => {
    try {
      if (!localStorage.getItem('easyag-theme')) applyTheme(e.matches ? 'dark' : 'light');
    } catch {}
  });
  loadSettings(await api.status());
  for (const item of await api.logs()) appendLog(item.category, item.message, item.cls, item.at);
  stream = new EventSource('/api/events');
  stream.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      renderStatus(message);
      if (message.category) appendLog(message.category, message.message, message.cls, message.at);
    } catch (error) { report(error); }
  };
  pollTimer = setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try { renderStatus(await api.status()); }
    catch { /* EventSource and the next poll reconnect without ending the backend session. */ }
    finally { refreshing = false; }
  }, 3000);
}

window.addEventListener('pagehide', () => { clearInterval(pollTimer); stream?.close(); });
init().catch(error => { renderPhase('error'); report(error); });
