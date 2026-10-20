import { api } from './api.js';

const element = id => document.getElementById(id);
const consoleBox = element('consoleBox');
let phase = 'idle';
let settingsQueue = Promise.resolve();
let refreshing = false;
let stream;
let pollTimer;
let launchPending = false;
const logKeys = new Set();

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

function renderPhase(next) {
  phase = next;
  document.body.dataset.uiState = next;
  const busy = ['preparing', 'launching'].includes(next);
  const locked = busy || next === 'running';
  const button = element('launchBtn');
  button.disabled = locked;
  button.classList.toggle('busy', busy);
  document.querySelectorAll('[data-port]').forEach(control => { control.disabled = locked; });
  element('proxyPortInput').disabled = locked;
  element('launchIcon').textContent = busy ? '◌' : next === 'running' ? '●' : next === 'error' ? '↻' : '🚀';
  element('launchText').textContent = {
    preparing: '正在准备代理环境…',
    launching: '正在启动 Antigravity…',
    running: 'Antigravity 运行中',
    error: '启动失败，点击重试'
  }[next] || '启动 Antigravity';
  button.style.background = next === 'running' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '';
}

function renderStatus(status) {
  if (status.phase && !(launchPending && status.phase === 'idle')) renderPhase(status.phase);
  if (status.dictEntries !== undefined) {
    element('dictCountBadge').textContent = `已载入 ${status.dictEntries} 条词条`;
  }
  if (status.version) {
    const versionNode = element('versionBadge');
    if (versionNode) {
      versionNode.textContent = `v${status.version}${status.restartRequired ? ' · 待重启生效' : ''}`;
    }
  }
  if (status.clientRunning !== undefined) {
    const badge = element('clientStatusBadge');
    badge.className = status.clientRunning ? 'status-capsule active' : 'status-capsule';
    badge.querySelector('span').textContent = status.clientRunning
      ? status.cdpSockets ? '运行中 · 增强已连接' : '运行中 · 等待增强连接'
      : '客户端未运行';
    badge.title = status.cdpError || '';
  }
}

function loadSettings(status) {
  element('proxyPortInput').value = status.port;
  element('i18nToggle').checked = status.enableI18n;
  element('contextMonitorToggle').checked = status.enableContextMonitor;
  element('patchStatusBadge').textContent = '● 原生代理已就绪';
  renderStatus(status);
}

function persistSettings() {
  const payload = {
    port: Number(element('proxyPortInput').value),
    enableI18n: element('i18nToggle').checked,
    enableContextMonitor: element('contextMonitorToggle').checked
  };
  settingsQueue = settingsQueue.catch(() => {}).then(() => api.configure(payload));
  return settingsQueue;
}

async function launch() {
  if (['preparing', 'launching', 'running'].includes(phase)) return;
  launchPending = true;
  renderPhase('preparing');
  try {
    await persistSettings();
    renderPhase('launching');
    await api.launch();
    renderPhase('running');
  } catch (error) { renderPhase('error'); report(error); }
  finally { launchPending = false; }
}

async function checkUpdate() {
  const btn = element('updateBtn');
  if (!btn || btn.disabled) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在同步…';
  try {
    const result = await api.checkUpdate();
    renderStatus(result);
    if (result.runtimeFilesUpdated > 0) {
      setTimeout(() => location.reload(), 500);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function currentTheme() {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem('easyag-theme', theme); } catch {}
  }
  const textNode = element('themeToggleText');
  if (textNode) {
    textNode.textContent = theme === 'dark' ? '🌙 深色' : '☀️ 浅色';
  }
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

const actions = {
  launch,
  hide: () => api.hide(),
  'toggle-theme': toggleTheme,
  'check-update': checkUpdate,
  'copy-logs': copyLogs,
  'clear-logs': () => { consoleBox.replaceChildren(); }
};

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action],[data-port]');
  if (!control || control.disabled) return;
  const action = control.dataset.port !== undefined ? async () => {
    element('proxyPortInput').value = control.dataset.port;
    await persistSettings();
  } : actions[control.dataset.action];
  if (action) Promise.resolve().then(() => action(control)).catch(report);
});

element('proxyPortInput').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, ''); });
for (const id of ['proxyPortInput', 'i18nToggle', 'contextMonitorToggle']) {
  element(id).addEventListener('change', () => { persistSettings().catch(report); });
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
