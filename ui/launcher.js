import { api } from './api.js';

const element = id => document.getElementById(id);
const consoleBox = element('consoleBox');
let mode = 'pilot';
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
  document.querySelectorAll('.mode-option,[data-port]').forEach(control => { control.disabled = locked; });
  element('proxyPortInput').disabled = locked;
  element('launchIcon').textContent = busy ? '◌' : next === 'running' ? '●' : next === 'error' ? '↻' : '🚀';
  element('launchText').textContent = {
    preparing: '正在准备增强环境…', launching: '正在启动 Antigravity…',
    running: 'Antigravity 运行中', error: '启动失败，点击重试'
  }[next] || (mode === 'pilot' ? '以 Turbo Pilot 启动' : '以兼容模式启动');
  button.style.background = next === 'running' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '';
}

function renderMode() {
  document.querySelectorAll('.mode-option').forEach(control => {
    const selected = control.dataset.mode === mode;
    control.classList.toggle('selected', selected);
    control.setAttribute('aria-pressed', String(selected));
  });
  const enabled = mode === 'pilot';
  element('riskAdvisorToggle').disabled = !enabled;
  element('advisorRow').classList.toggle('disabled', !enabled);
  renderPhase(phase);
}

function renderStatus(status) {
  if (status.phase && !(launchPending && status.phase === 'idle')) renderPhase(status.phase);
  if (status.riskHits !== undefined) element('approveCountBadge').textContent = `风险 ${status.riskHits}`;
  if (status.dangerRulesTotal !== undefined) {
    element('rulesCountBadge').textContent = `${status.dangerRulesOn}/${status.dangerRulesTotal} 条生效`;
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
  mode = status.launchMode;
  element('proxyPortInput').value = status.port;
  element('riskAdvisorToggle').checked = status.riskAdvisor;
  element('i18nToggle').checked = status.enableI18n;
  element('dictCountBadge').textContent = `已载入 ${status.dictEntries} 条汉化词条`;
  element('patchStatusBadge').textContent = '● 原生代理已就绪';
  renderMode();
  renderStatus(status);
}

function persistSettings() {
  const payload = {
    port: Number(element('proxyPortInput').value), launchMode: mode,
    riskAdvisor: element('riskAdvisorToggle').checked, enableI18n: element('i18nToggle').checked
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
    const result = await api.launch();
    renderPhase('running');
    if (result.pilot && !result.pilot.skipped) {
      appendLog('SECURITY', `自动审批和 ${result.pilot.count} 条原生权限规则已应用`, 'tag-proxy');
    }
  } catch (error) { renderPhase('error'); report(error); }
  finally { launchPending = false; }
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
  async mode(control) { mode = control.dataset.mode; renderMode(); await persistSettings(); },
  async 'open-rules'() {
    const result = await api.openRules();
    appendLog('SECURITY', `已打开权限规则：${result.path}`, 'tag-proxy');
  },
  async 'reload-rules'() {
    const result = await api.reloadRules();
    renderStatus({ dangerRulesOn: result.active, dangerRulesTotal: result.total });
    appendLog('SECURITY', '规则已重载，下次启动时应用', 'tag-proxy');
  },
  async restore() {
    const result = await api.restore();
    appendLog('SECURITY', `已移除 ${result.removed} 条 EasyAG 权限规则，保留用户原有配置`, 'tag-proxy');
  },
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
for (const id of ['proxyPortInput', 'riskAdvisorToggle', 'i18nToggle']) {
  element(id).addEventListener('change', () => { persistSettings().catch(report); });
}

async function init() {
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
