const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');

const TAURI_MODE = process.env.EASYAG_TAURI === '1';
const TEST_MODE = process.env.EASYAG_TEST_MODE === '1';
const GUI_PORT = TAURI_MODE ? 0 : 19823;
const CDP_PORT = 9333;

function normalizePath(p) {
  if (!p) return p;
  if (process.platform === 'win32') {
    if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8);
    if (p.startsWith('\\\\?\\')) return p.slice(4);
  }
  return p;
}

// pkg 打包后 __dirname 指向虚拟内存，需锚定 exe 实际所在目录
const ROOT_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = normalizePath(process.env.EASYAG_DATA_DIR) || ROOT_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });
const LOCK_FILE = path.join(DATA_DIR, 'easyag.lock');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ── Platform Detection ──
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ── Platform-specific Antigravity paths ──
function getAntigravityPaths() {
  if (IS_MAC) {
    const candidates = [
      '/Applications/Antigravity.app',
      '/Applications/Antigravity IDE.app',
      path.join(process.env.HOME || '', 'Applications', 'Antigravity.app'),
      path.join(process.env.HOME || '', 'Applications', 'Antigravity IDE.app')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        let executable = 'Antigravity';
        try {
          executable = require('child_process').execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(p, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
        } catch (_) {}
        const appExe = path.join(p, 'Contents', 'MacOS', executable);
        return {
          appDir: p,
          appExe: fs.existsSync(appExe) ? appExe : path.join(p, 'Contents', 'MacOS', 'Antigravity'),
          appName: path.basename(p, '.app')
        };
      }
    }
    const defaultApp = '/Applications/Antigravity.app';
    return {
      appDir: defaultApp,
      appExe: path.join(defaultApp, 'Contents', 'MacOS', 'Antigravity'),
      appName: 'Antigravity'
    };
  }
  const appDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity');
  return { appDir, appExe: path.join(appDir, 'Antigravity.exe'), appName: 'Antigravity' };
}

const AG_PATHS = getAntigravityPaths();
const APP_DIR = AG_PATHS.appDir;
const APP_EXE = AG_PATHS.appExe;

function readLockPid() {
  try {
    const s = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    return !!process.kill(pid, 0);
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function releaseLock() {
  if (TAURI_MODE) return;
  try {
    const pid = readLockPid();
    if (!pid || pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch (e) {}
}

function alreadyRunning() {
  const pid = readLockPid();
  return isPidAlive(pid) && pid !== process.pid;
}

function openGuiWindow() {
  const url = `http://127.0.0.1:${GUI_PORT}/?t=${Date.now()}`;

  // ── macOS: use system default browser ──
  if (IS_MAC) {
    try {
      exec(`open "${url}"`);
      logToGUI('SYSTEM', 'GUI opened via system default browser', 'tag-proxy');
      return true;
    } catch (e) {
      logToGUI('SYSTEM', `Failed to open browser: ${e.message}`, 'tag-alert');
      logToGUI('SYSTEM', `Please open manually: ${url}`, 'tag-warn');
      return false;
    }
  }

  // ── Windows: WebView2 -> Browser fallback ──
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const la = process.env.LOCALAPPDATA || '';

  // ── 浏览器 App 模式 ──
  const candidates = [
    {
      name: 'Edge',
      paths: [
        path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(la, 'Microsoft/Edge/Application/msedge.exe')
      ]
    },
    {
      name: 'Chrome',
      paths: [
        path.join(pf, 'Google/Chrome/Application/chrome.exe'),
        path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
        path.join(la, 'Google/Chrome/Application/chrome.exe')
      ]
    },
    {
      name: 'Firefox',
      paths: [
        path.join(pf, 'Mozilla Firefox/firefox.exe'),
        path.join(pf86, 'Mozilla Firefox/firefox.exe')
      ],
      noAppMode: true
    }
  ];

  for (const browser of candidates) {
    for (const p of browser.paths) {
      if (!fs.existsSync(p)) continue;
      try {
        if (browser.noAppMode) {
          exec(`start "" "${p}" "${url}"`, { windowsHide: true });
        } else {
          exec(`start "" "${p}" --app=${url} --force-dark-mode`, { windowsHide: true });
        }
        logToGUI('SYSTEM', `GUI 已通过 ${browser.name}${browser.noAppMode ? '' : ' 应用模式'}打开`, 'tag-proxy');
        return true;
      } catch (e) {}
    }
  }

  // ── 默认浏览器兜底 ──
  try {
    exec(`start "" "${url}"`, { windowsHide: true });
    logToGUI('SYSTEM', '已调用系统默认浏览器打开 GUI', 'tag-warn');
    return true;
  } catch (e) {}

  logToGUI('SYSTEM', `无法自动打开 GUI，请手动访问 ${url}`, 'tag-alert');
  return false;
}

function focusExistingGui() {
}

// 双击 exe 会挂控制台：windowsHide 重启自身并退出，避免黑框
// 已有实例时不再拉起新进程
if (IS_WIN && !TAURI_MODE && !process.env.EASYAG_NOCONSOLE) {
  if (alreadyRunning()) {
    focusExistingGui();
    process.exit(0);
  }
  try {
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: Object.assign({}, process.env, {
        EASYAG_NOCONSOLE: '1',
        NODE_NO_WARNINGS: '1'
      })
    });
    child.unref();
    process.exit(0);
  } catch (e) {
    process.env.EASYAG_NOCONSOLE = '1';
  }
}

// 子进程：若锁显示已有实例，也不占用第二个
if (!TAURI_MODE && alreadyRunning()) {
  focusExistingGui();
  process.exit(0);
}

try {
  process.removeAllListeners('warning');
  process.on('warning', () => {});
  process.env.NODE_NO_WARNINGS = '1';
} catch (e) {}

const HTML_FILE = path.join(ROOT_DIR, 'index.html');

const TARGET_DLL = path.join(APP_DIR, 'version.dll');
const DISABLED_DLL = path.join(APP_DIR, 'version.dll.easyag-disabled');

const DICT_DIR = path.join(ROOT_DIR, 'dicts');
const RULES_FILE = path.join(DATA_DIR, 'danger-rules.json');
if (TAURI_MODE && !fs.existsSync(RULES_FILE)) {
  fs.copyFileSync(path.join(ROOT_DIR, 'danger-rules.json'), RULES_FILE);
}

// 调试模式：--debug 参数 或 debug.flag 文件 存在时开启
const debugMode = process.argv.includes('--debug') || fs.existsSync(path.join(__dirname, 'debug.flag'));
const nativeProxyMode = true;

let state = {
  port: 7890,
  proxyMode: 'native',
  autoAccept: true,
  blockDangerous: true,
  preferOption: 1,
  enableI18n: true,
  dictEntries: 0,
  patchOk: false,
  clientRunning: false,
  debugApproval: debugMode,
  dangerRulesTotal: 0,
  dangerRulesOn: 0,
  approveCount: 0,
  blockCount: 0,
  cdpTargets: 0,
  cdpSockets: 0,
  injectCount: 0,
  lastInjectAt: 0,
  cdpError: '',
  cdpFailStreak: 0,
  cdpLoopRunning: false
};

try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  for (const key of ['autoAccept', 'blockDangerous', 'enableI18n', 'debugApproval']) {
    if (typeof saved[key] === 'boolean') state[key] = saved[key];
  }
  if (Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536) state.port = saved.port;
  if ([1, 2, 3, 4].includes(Number(saved.preferOption))) state.preferOption = Number(saved.preferOption);
} catch (_) {}

let quitting = false;
let launchedClient = null;

function quitApp(reason) {
  if (quitting) return;
  quitting = true;
  logToGUI('SYSTEM', '正在退出: ' + reason, 'tag-warn');
  state.clientRunning = false;
  for (const [, entry] of cdpSockets) {
    try { entry.ws.close(); } catch (e) {}
  }
  cdpSockets.clear();
  releaseLock();
  try {
    if (!TAURI_MODE && IS_WIN && !TEST_MODE) exec('taskkill /F /FI "WINDOWTITLE eq EasyAntigravity*" /T', { windowsHide: true }, () => {});
  } catch (e) {}
  try {
    if (!TEST_MODE && IS_WIN) exec('taskkill /F /IM Antigravity.exe /T', { windowsHide: true }, () => {});
    else if (!TEST_MODE && IS_MAC && launchedClient) process.kill(-launchedClient.pid, 'SIGTERM');
  } catch (e) {}
  setTimeout(() => {
    process.exit(0);
  }, 100);
}

const DEFAULT_DANGER_RULES = [
  { id: 'rm-rf', name: '递归强制删除', pattern: '\\brm(?:\\s+(?:--(?:recursive|force)|-[a-zA-Z]*[rf][a-zA-Z]*)){1,4}(?=\\s|$)', flags: 'i', enabled: true },
  { id: 'windows-del', name: 'Windows 强制删除', pattern: '\\b(del|rd|rmdir)\\s+.*\\/[sqf]', flags: 'i', enabled: true },
  { id: 'disk-wipe', name: '磁盘破坏', pattern: '\\b(?:format\\s+[a-zA-Z]:|format-volume|diskpart|mkfs|wipefs|shred)(?=\\s|$|\\b)', flags: 'i', enabled: true },
  { id: 'sql-drop', name: '数据库删除', pattern: '\\bdrop\\s+(database|table)\\b', flags: 'i', enabled: true },
  { id: 'git-force-push', name: 'Git 强制推送', pattern: '\\bgit\\s+push\\s+.*(-f|--force)\\b', flags: 'i', enabled: true },
  { id: 'shutdown', name: '关机/停止计算机', pattern: '\\b(shutdown|stop-computer)\\b', flags: 'i', enabled: true }
];

let dangerRules = { version: 1, enabled: true, rules: DEFAULT_DANGER_RULES };

function loadDangerRules() {
  const fallbackRules = path.join(ROOT_DIR, 'danger-rules.json');
  const tryPaths = [RULES_FILE, fallbackRules];
  for (const p of tryPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(data.rules)) {
        dangerRules = {
          version: data.version || 1,
          enabled: data.enabled !== false,
          rules: data.rules.filter(r => r && r.pattern)
        };
        // 自愈：主文件缺失时从预置资源写回
        if (p === fallbackRules && !fs.existsSync(RULES_FILE)) {
          try { fs.copyFileSync(fallbackRules, RULES_FILE); } catch (e) {}
        }
        break;
      }
    } catch (e) {}
  }
  if (!dangerRules.rules || !dangerRules.rules.length) {
    dangerRules = { version: 1, enabled: true, rules: DEFAULT_DANGER_RULES };
  }
  const on = dangerRules.rules.filter(r => r.enabled !== false).length;
  state.dangerRulesTotal = dangerRules.rules.length;
  state.dangerRulesOn = dangerRules.enabled === false ? 0 : on;
  return dangerRules;
}

function getActiveDangerPatterns() {
  if (dangerRules.enabled === false) return [];
  return dangerRules.rules
    .filter(r => r.enabled !== false)
    .map(r => ({ id: r.id || 'rule', name: r.name || r.id || 'rule', pattern: r.pattern, flags: r.flags || 'i' }));
}

let translationDict = {};
let reverseDict = {};

function buildReverseDict() {
  reverseDict = {};
  for (const [en, zh] of Object.entries(translationDict)) {
    if (typeof zh === 'string' && zh.trim() && !reverseDict[zh.trim()]) {
      reverseDict[zh.trim()] = en.trim();
    }
  }
}

function loadDictionaries() {
  translationDict = {};
  const files = ['ui_v2.json', 'common.json'];
  files.forEach(f => {
    const fullPath = path.join(DICT_DIR, f);
    if (fs.existsSync(fullPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        Object.assign(translationDict, data);
      } catch (e) {}
    }
  });
  state.dictEntries = Object.keys(translationDict).length;
  buildReverseDict();
}

let sseClients = [];
let logBuffer = [];
let logHistory = [];
if (debugMode) logToGUI('DEBUG', '调试模式已开启，审批卡 DOM 结构将输出到日志', 'tag-i18n');

function logToGUI(category, message, cls = '') {
  const item = { at: new Date().toISOString(), category, message, cls };
  try {
    const file = path.join(DATA_DIR, 'easyag.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.previous');
    fs.appendFileSync(file, JSON.stringify(item) + '\n');
  } catch (_) {}
  logHistory.push(item);
  if (logHistory.length > 300) logHistory.shift();
  const payload = JSON.stringify({ category, message, cls });
  if (sseClients.length === 0) {
    logBuffer.push({ category, message, cls });
    return;
  }
  const dead = [];
  sseClients.forEach(res => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      dead.push(res);
    }
  });
  if (dead.length) sseClients = sseClients.filter(c => dead.indexOf(c) < 0);
}

function flushLogBuffer() {
  if (!logBuffer.length) return;
  const items = logBuffer.slice();
  logBuffer = [];
  items.forEach(({ category, message, cls }) => {
    const payload = JSON.stringify({ category, message, cls });
    sseClients.forEach(res => {
      try { res.write(`data: ${payload}\n\n`); } catch (e) {}
    });
  });
}

function pushCounters() {
  const payload = JSON.stringify({
    counters: true,
    approveCount: state.approveCount,
    blockCount: state.blockCount
  });
  sseClients.forEach(res => res.write(`data: ${payload}\n\n`));
}

function popupGuiWindow() {
  if (TAURI_MODE) {
    try { process.stdout.write('popup\n'); } catch (e) {}
  }
}

function ensureProxyWatchdog() {
  if (TEST_MODE) return false;
  if (!fs.existsSync(APP_DIR)) return false;

  // 原生免 TUN 代理：检测并隔离遗留的旧版 version.dll，避免 Hook 造成应用异常
  if (fs.existsSync(TARGET_DLL)) {
    try {
      const disabledPath = fs.existsSync(DISABLED_DLL)
        ? `${DISABLED_DLL}.${Date.now()}`
        : DISABLED_DLL;
      fs.renameSync(TARGET_DLL, disabledPath);
      logToGUI('PROXY', '已自动隔离旧版遗留的 version.dll 注入组件', 'tag-proxy');
    } catch (e) {}
  }
  state.patchOk = true;
  return false;
}

function buildNativeProxyLaunch() {
  // Go 的标准 HTTP 客户端读取 HTTP(S)_PROXY；因此此实验模式要求端口提供 HTTP
  // 或 Mixed 服务。SOCKS-only 端口不适合作为这里的环境变量值。
  const proxyUrl = `http://127.0.0.1:${state.port}`;
  const noProxy = 'localhost,127.0.0.1,::1,[::1]';
  return {
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      `--proxy-server=${proxyUrl}`,
      '--proxy-bypass-list=localhost;127.0.0.1;[::1]'
    ],
    env: Object.assign({}, process.env, {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      NO_PROXY: noProxy,
      no_proxy: noProxy
    })
  };
}

function syncProxyPort(newPort) {
  state.port = newPort;
  logToGUI('PROXY', `本地代理端口已更新为: ${newPort}`, 'tag-proxy');
}

function generateMasterInjectScript() {
  const dictJSON = JSON.stringify(translationDict);
  const reverseDictJSON = JSON.stringify(reverseDict);
  const patternsJSON = JSON.stringify(getActiveDangerPatterns());
  return `(() => {
    window.__ea_config = Object.assign(window.__ea_config || {}, {
      preferOption: ${state.preferOption},
      blockDangerous: ${state.blockDangerous},
      autoAccept: ${state.autoAccept},
      enableI18n: ${state.enableI18n},
      debugApproval: ${state.debugApproval ? 'true' : 'false'}
    });
    window.__ea_dict = ${dictJSON};
    window.__ea_reverse_dict = ${reverseDictJSON};
    window.__ea_danger_patterns = ${patternsJSON};
    window.__ea_compiled_danger_patterns = (window.__ea_danger_patterns || []).map(r => {
      try { return { id: r.id, name: r.name, re: new RegExp(r.pattern, r.flags || 'i') }; }
      catch (e) { return null; }
    }).filter(Boolean);

    // 若当前处于高危锁定中，重载后立即以新规则重新评估：若不再命中，自动解除锁定并解封按钮
    if (window.__ea_danger_lock) {
      const activePatterns = window.__ea_compiled_danger_patterns || [];
      const stillHit = activePatterns.find(r => r.re.test(window.__ea_danger_lock.cmd));
      if (!stillHit) {
        if(window.__ea_config.debugApproval) { console.log('[EA_RELOAD] 高危指令已根据重载规则解除锁定: ' + window.__ea_danger_lock.cmd.slice(0, 60)); }
        window.__ea_danger_lock = null;
        try {
          document.querySelectorAll('[data-ea-ok="blocked"]').forEach(el => el.removeAttribute('data-ea-ok'));
        } catch (e) {}
      }
    }

    if (window.__ea_engine_running) return;
    window.__ea_engine_running = true;

    function realClick(el) {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    function norm(s) {
      return String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    }

    function isSubmitLabel(s) {
      const t = norm(s);
      if (!t || t.length > 40) return false;
      return (
        t === 'submit' ||
        t.startsWith('submit') ||
        t === '提交' ||
        t.includes('提交') ||
        t === 'confirm' ||
        t.startsWith('confirm') ||
        t === '确认' ||
        t.startsWith('确认') ||
        t === 'allow' ||
        t === '允许' ||
        t.includes('submit ↵') ||
        t.includes('提交 ↵') ||
        t.includes('submit enter')
      );
    }

    function findSubmitBtn(root) {
      if (!root || !root.querySelector) return null;
      const byTest = root.querySelector(
        'button[data-testid="interaction-continue-button"], [data-testid="interaction-continue-button"]'
      );
      if (byTest && !byTest.disabled && !byTest.hasAttribute('data-ea-ok')) return byTest;
      const btns = Array.from(root.querySelectorAll('button, [role="button"], div[role="button"], input[type="submit"]'));
      return btns.find(b => {
        if (!b || b.disabled || b.hasAttribute('data-ea-ok')) return false;
        return isSubmitLabel(b.innerText || b.value || b.getAttribute('aria-label'));
      }) || null;
    }

    function cardForSubmit(btn) {
      return (
        btn.closest('[role="dialog"]') ||
        btn.closest('[role="alertdialog"]') ||
        btn.closest('div[data-testid*="interaction"]') ||
        btn.closest('div[class*="modal"]') ||
        btn.closest('[data-testid="run-command-step"]') ||
        btn.closest('div.relative.flex.flex-col') ||
        btn.closest('div[class*="card"]') ||
        btn.closest('div[class*="container"]') ||
        btn.parentElement?.parentElement?.parentElement?.parentElement ||
        btn.parentElement
      );
    }

    function oneLine(s, n) {
      s = String(s || '').replace(/\\s+/g, ' ').trim();
      if (n && s.length > n) s = s.slice(0, Math.max(1, n - 1)) + '…';
      return s;
    }

    // 高危扫描用：尽量拿到完整命令正文（可多行）
    function extractCommandText(card) {
      if (!card) return '';
      const code = card.querySelector('pre, code, [class*="code"], [class*="mono"], .font-mono');
      if (code && (code.innerText || code.textContent || '').trim()) {
        const t = (code.innerText || code.textContent || '').trim();
        if (t.length > 1) return t;
      }
      const step = (card.getAttribute && card.getAttribute('data-testid') === 'run-command-step')
        ? card
        : (card.querySelector ? card.querySelector('[data-testid="run-command-step"]') : null);
      if (step) {
        const mono = step.querySelector('.font-mono, [class*="mono"], pre, code');
        if (mono && (mono.innerText || mono.textContent || '').trim()) {
          return (mono.innerText || mono.textContent || '').trim();
        }
        const raw = (step.innerText || step.textContent || '').trim();
        const cleaned = raw.replace(/^(run|ran)\\s+/i, '').trim();
        if (cleaned.length > 1) return cleaned;
      }
      return '';
    }

    function isElementVisible(el) {
      if (!el || el.disabled) return false;
      if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      const s = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
      return true;
    }

    function findActivePendingSubmit(doc) {
      if (!doc || !doc.querySelectorAll) return null;
      const testidBtns = Array.from(doc.querySelectorAll(
        'button[data-testid="interaction-continue-button"],' +
        'button[data-testid="approval-submit"],' +
        'button[data-testid="permission-allow"]'
      ));
      const active = testidBtns.find(b => isElementVisible(b) && b.getAttribute('data-ea-ok') !== 'true' && b.getAttribute('data-ea-ok') !== 'user-interacted');
      if (active) return active;
      const allBtns = Array.from(doc.querySelectorAll('button, [role="button"]'));
      return allBtns.find(b => isElementVisible(b) && b.getAttribute('data-ea-ok') !== 'true' && b.getAttribute('data-ea-ok') !== 'user-interacted' && isSubmitLabel(b.innerText || b.value || b.getAttribute('aria-label'))) || null;
    }

    function findActivePendingCommand(doc) {
      if (!doc || !doc.querySelectorAll) return '';
      const pendingBtn = findActivePendingSubmit(doc);
      if (pendingBtn) {
        return extractCommandForBtn(pendingBtn);
      }
      return '';
    }

    function extractCommandForBtn(btn) {
      if (!btn) return '';
      let root = btn.closest('[role="dialog"], [role="alertdialog"], [data-testid*="interaction"], div[class*="modal"], [data-testid="run-command-step"]');
      if (!root) {
        const steps = document.querySelectorAll('[data-testid="run-command-step"]');
        if (steps.length) root = steps[steps.length - 1];
      }
      if (root) {
        const cmd = extractCommandText(root);
        if (cmd) return cmd;
      }
      const card = cardForSubmit(btn);
      if (card) {
        const cmd = extractCommandText(card);
        if (cmd) return cmd;
      }
      // 审批按钮独立处于底部交互栏时，关联当前页面处于活动态的待运行命令（优先排除已完成的 Ran 历史步骤）
      const doc = btn.ownerDocument || document;
      if (doc && doc.querySelectorAll) {
        const steps = doc.querySelectorAll('[data-testid="run-command-step"]');
        if (steps.length) {
          for (let i = steps.length - 1; i >= 0; i--) {
            const firstWord = (steps[i].innerText || '').trim().split(/\\s+/)[0] || '';
            if (!/^ran$/i.test(firstWord)) {
              const txt = extractCommandText(steps[i]);
              if (txt) return txt;
            }
          }
          const lastTxt = extractCommandText(steps[steps.length - 1]);
          if (lastTxt) return lastTxt;
        }
        const pres = doc.querySelectorAll('pre, code');
        if (pres.length) {
          for (let i = pres.length - 1; i >= 0; i--) {
            const s = (pres[i].innerText || pres[i].textContent || '').trim();
            if (s.length > 2 && s.length < 2000) return s;
          }
        }
      }
      return '';
    }

    // 日志用：单行短摘要（优先识别真实命令行，杜绝纯 testid）
    function extractLogSummary(card, fallback, btn) {
      let full = extractCommandText(card);
      if (!full && btn) full = extractCommandForBtn(btn);
      if (!full && typeof document !== 'undefined') {
        full = findActivePendingCommand(document);
        if (!full) {
          const steps = document.querySelectorAll('[data-testid="run-command-step"]');
          if (steps.length) full = extractCommandText(steps[steps.length - 1]);
        }
      }
      if (full) {
        const lines = full.split('\\n').map(s => s.trim()).filter(Boolean);
        const cmdLine = lines.find(l => !/^(run|ran)$/i.test(l) && !/[?？]$/.test(l) && l.length > 2);
        const q = lines.find(l => /[?？]$/.test(l) && l.length < 120);
        return oneLine(cmdLine || q || lines[0], 80);
      }
      return oneLine(fallback || '', 80);
    }

    function classifyOption(tx) {
      const t = norm(tx);
      if (!t || t.length > 200) return 0;
      const isAlways = /always allow|始终允许|总是允许|一直允许/.test(t);
      const isThisTime = /\\bthis time\\b|仅允许本次|仅这一次|只允许本次|仅本次/.test(t);
      const isSession = /\\bin this conversation\\b|\\bthis session\\b|\\bthis conversation\\b|对话中|本次会话|本次对话/.test(t);
      const isProject = /\\bin (this|every) project\\b|\\bthis project\\b|项目中|本项目|所有项目/.test(t);
      // 编号优先（1. / 2. / 3. / 4.）
      const num = t.match(/^([1-4])[\\s\\.\\:：\\-]/);
      if (num) return Number(num[1]);
      // 互斥语义：this time ≠ always
      if (isThisTime && !isAlways) return 1;
      if (isAlways && isSession && !isProject) return 2;
      if (isAlways && isProject) return 3;
      if (isAlways && !isSession && !isProject && !isThisTime) return 4;
      // 裸编号
      if (t === '1' || t === '2' || t === '3' || t === '4') return Number(t);
      return 0;
    }

    function collectOptionCands(card) {
      const nodes = Array.from(card.querySelectorAll(
        'label, [role="radio"], [role="option"], [data-testid*="option"], [data-testid*="radio"], button, div, span, li'
      ));
      const cands = [];
      const seen = new Set();
      for (const el of nodes) {
        if (!el || seen.has(el)) continue;
        const raw = (el.innerText || el.textContent || '').trim();
        if (!raw || raw.length > 160) continue;
        // 多行选项容器不是叶子选项
        if (raw.includes('\\n') && raw.split('\\n').filter(Boolean).length > 2) continue;
        // 只要叶子/近叶子：有更深子节点且文本相同则跳过父级，避免点到整块容器
        const kids = el.children ? Array.from(el.children) : [];
        if (kids.length) {
          const kidTexts = kids.map(k => (k.innerText || '').trim()).join(' ');
          if (kidTexts && norm(kidTexts) === norm(raw) && raw.length > 20) continue;
        }
        const cls = classifyOption(raw);
        if (!cls) continue;
        const st = el.getAttribute && el.getAttribute('data-state');
        const checked = (
          el.checked === true ||
          el.getAttribute('aria-checked') === 'true' ||
          st === 'checked' ||
          st === 'on' ||
          (el.classList && el.classList.contains('checked'))
        );
        const score =
          (el.getAttribute && el.getAttribute('role') === 'radio' ? 40 : 0) +
          (el.tagName === 'LABEL' ? 30 : 0) +
          (el.getAttribute && /option|radio|choice/i.test(el.getAttribute('data-testid') || '') ? 35 : 0) +
          (checked ? 10 : 0) -
          Math.min(raw.length, 80) * 0.1;
        cands.push({ el, cls, score, checked, text: clip(raw, 80) });
        seen.add(el);
      }
      return cands;
    }

    function matchOptionEl(card, optIdx) {
      const idx = Number(optIdx) || 4;
      const cands = collectOptionCands(card);
      const exact = cands.filter(c => c.cls === idx);
      if (exact.length) {
        exact.sort((a, b) => b.score - a.score);
        return exact[0];
      }
      // 目标选项不存在时：若只有 this-time 语义选项，优先选它，避免默认落到 always
      if (idx === 1) {
        const t1 = cands.filter(c => c.cls === 1);
        if (t1.length) return t1[0];
      }
      return null;
    }

    // 命中高危审批后，仅熔断这张命令卡。React 可能在标记按钮后重绘 DOM，
    // 只给旧按钮加 data 属性不足以阻止下一轮扫描误点新按钮，因此命令指纹须持久化到 window。
    // 不使用页面级总锁：用户手动确认该高危卡后，后续正常审批应继续自动处理。
    function dangerKey(hit, cmd) {
      return String(hit.id || 'rule') + ':' + String(cmd || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    }

    function commandApprovalKey(card) {
      const cmd = extractCommandText(card);
      return cmd ? 'cmd:' + String(cmd).replace(/\s+/g, ' ').trim().slice(0, 800) : '';
    }

    function approvalKey(card, kind) {
      const commandKey = commandApprovalKey(card);
      if (commandKey) return commandKey;
      // 无命令正文的通用确认卡也可去重，防止 React 在点击后的短暂重绘造成重复日志。
      const text = card ? (card.innerText || card.textContent || '') : '';
      return 'ui:' + oneLine(text || kind || '', 300);
    }

    // 命令审批状态机：按“卡片可见生命周期”而非时间窗口去重。
    // 同一命令卡 React 重绘时保留状态；卡真正消失后才释放，下一张同命令卡才是新请求。
    function approvalTracker() {
      return window.__ea_approval_tracker || (window.__ea_approval_tracker = { nextId: 1, entries: new Map() });
    }

    function refreshVisibleCommandApprovals(doc) {
      if (!doc || !doc.querySelectorAll) return;
      const visible = new Set();
      const cards = doc.querySelectorAll(
        '[data-testid="run-command-step"], [role="dialog"], [role="alertdialog"],' +
        'div[data-testid*="interaction"], div[data-testid*="approval"],' +
        'div[data-testid*="permission"], div[data-testid*="command"]'
      );
      for (const card of cards) {
        const key = commandApprovalKey(card);
        if (key) visible.add(key);
      }
      const tracker = approvalTracker();
      for (const key of visible) {
        if (!tracker.entries.has(key)) {
          tracker.entries.set(key, {
            id: tracker.nextId++,
            clicked: false,
            dangerReported: false,
            requestReported: false
          });
        }
      }
      for (const key of tracker.entries.keys()) {
        if (!visible.has(key)) tracker.entries.delete(key);
      }
    }

    function approvalEntry(card) {
      const key = commandApprovalKey(card);
      return key ? approvalTracker().entries.get(key) : null;
    }

    // 审批卡出现只代表权限请求，不是授权动作，不能写入批准计数。
    function reportApprovalRequest(card) {
      const entry = approvalEntry(card);
      if (!entry || entry.requestReported) return;
      entry.requestReported = true;
      console.log('[EA_REQUEST] 权限请求 · ' + extractLogSummary(card, '审批请求'));
    }

    function reportVisibleApprovalRequests(doc) {
      if (!doc || !doc.querySelectorAll) return;
      const cards = doc.querySelectorAll(
        '[data-testid="run-command-step"], [role="dialog"], [role="alertdialog"],' +
        'div[data-testid*="interaction"], div[data-testid*="approval"],' +
        'div[data-testid*="permission"], div[data-testid*="command"]'
      );
      for (const card of cards) {
        if (commandApprovalKey(card)) reportApprovalRequest(card);
      }
    }

    function recentlyAutoApproved(card, kind) {
      const key = approvalKey(card, kind);
      if (!key || key === 'ui:') return false;
      if (key.startsWith('cmd:')) {
        const entry = approvalEntry(card);
        return !!(entry && entry.clicked);
      }
      const seen = window.__ea_recent_auto_approvals || (window.__ea_recent_auto_approvals = new Map());
      const now = Date.now();
      const last = seen.get(key) || 0;
      // 无命令正文的 Continue 等控件没有稳定卡片键，只做短时降噪。
      return now - last < 15000;
    }

    function markAutoApproved(card, kind) {
      const key = approvalKey(card, kind);
      if (!key || key === 'ui:') return;
      if (key.startsWith('cmd:')) {
        const entry = approvalEntry(card);
        if (entry) entry.clicked = true;
        return;
      }
      const seen = window.__ea_recent_auto_approvals || (window.__ea_recent_auto_approvals = new Map());
      const now = Date.now();
      seen.set(key, now);
      if (seen.size > 100) {
        for (const [oldKey, at] of seen) {
          if (now - at > 30000) seen.delete(oldKey);
        }
      }
    }

    const reportedDangerRoots = window.__ea_reported_danger_roots || (window.__ea_reported_danger_roots = new WeakSet());

    function blockCardApprovalButtons(container) {
      if (!container || !container.querySelectorAll) return;
      const btns = container.querySelectorAll('button[data-testid="interaction-continue-button"], button[data-testid="approval-submit"], button[data-testid="permission-allow"], button[role="button"]');
      btns.forEach(b => {
        if (isSubmitLabel(b.innerText || b.value || b.getAttribute('aria-label')) || b.getAttribute('data-testid')) {
          b.setAttribute('data-ea-ok', 'blocked');
        }
      });
    }

    function checkDangerous(doc) {
      if (!window.__ea_config.blockDangerous || !doc || !doc.querySelectorAll) return false;
      const activePatterns = window.__ea_compiled_danger_patterns || [];
      if (!activePatterns.length) return false;

      // 仅检查当前页面上真实存在的“待审批活动按钮”
      const pendingBtn = findActivePendingSubmit(doc);
      if (!pendingBtn) {
        // 页面已无待处理确认按钮（用户已手动放行或卡片已关闭），自动解除高危锁定
        window.__ea_danger_lock = null;
        return false;
      }

      // 若当前待确认按钮所属卡片已被标记为 blocked，说明已经拦截告警过，静待用户手动确认
      if (pendingBtn.getAttribute('data-ea-ok') === 'blocked') {
        return true;
      }

      // 提取当前活动待确认按钮所属卡片的命令正文
      const pendingCmd = extractCommandForBtn(pendingBtn);
      if (pendingCmd) {
        const hit = activePatterns.find(r => r.re.test(pendingCmd));
        if (hit) {
          const root = getInteractionRoot(pendingBtn) || pendingBtn.parentElement;
          window.__ea_danger_lock = { id: hit.id, name: hit.name, cmd: pendingCmd, at: Date.now() };
          if (root) {
            blockCardApprovalButtons(root);
            processedRoots.add(root);
          } else {
            pendingBtn.setAttribute('data-ea-ok', 'blocked');
          }
          if (!root || !reportedDangerRoots.has(root)) {
            if (root) reportedDangerRoots.add(root);
            console.warn('[EA_ALERT] 拦截高危指令[' + hit.id + ']，等待用户手动确认: ' + oneLine(pendingCmd, 80));
          }
          return true;
        }
      }

      // 当前待确认命令安全，清除残留的高危锁定
      window.__ea_danger_lock = null;
      return false;
    }

    function getInteractionRoot(btn) {
      if (!btn) return null;
      return (
        btn.closest('[role="dialog"]') ||
        btn.closest('[role="alertdialog"]') ||
        btn.closest('div[data-testid*="interaction"]') ||
        btn.closest('div[class*="modal"]') ||
        btn.closest('[data-testid="run-command-step"]') ||
        btn.closest('div.relative.flex.flex-col') ||
        btn.closest('div[class*="card"]') ||
        btn.parentElement?.parentElement ||
        btn.parentElement
      );
    }

    const processedRoots = window.__ea_processed_roots || (window.__ea_processed_roots = new WeakSet());
    const reportedRoots = window.__ea_reported_roots || (window.__ea_reported_roots = new WeakSet());

        function isQuestionCard(card) {
      if (!card) return false;
      const rgs = Array.from(card.querySelectorAll('[role="radiogroup"]'));
      if (!rgs.length) return false;
      const txt = (rgs[rgs.length - 1].innerText || '').toLowerCase();
      const isPerm = (txt.includes('allow') && (txt.includes('this time') || txt.includes('always'))) ||
                     (txt.includes('允许') && (txt.includes('本次') || txt.includes('始终') || txt.includes('总是')));
      return !isPerm;
    }

    function reportInteractionRequest(btn) {
      const root = getInteractionRoot(btn);
      if (!root || reportedRoots.has(root)) return;
      reportedRoots.add(root);
      
      if (isQuestionCard(root)) {
        if (!root.hasAttribute('data-ea-interact-reported') && !root.querySelector('[data-ea-interact-reported]')) {
          console.warn('[EA_INTERACT] 方案问答：等待您手动选择选项并放行...');
        }
        return;
      }
      
      const cmd = extractLogSummary(root, '审批请求', btn);
      console.log('[EA_REQUEST] 权限请求 · ' + cmd);
    }

    function tryApprove(btn, kind) {
      if (!btn || btn.disabled || btn.hasAttribute('data-ea-ok')) return false;
      const root = getInteractionRoot(btn);
      if (isQuestionCard(root)) return false;
      
      if (window.__ea_danger_lock) {
        if (Date.now() - (window.__ea_danger_lock.at || 0) > 60000) {
          window.__ea_danger_lock = null;
        } else {
          return false;
        }
      }

      if (root && processedRoots.has(root)) return false;

      const doc = btn.ownerDocument || document;
      if (window.__ea_config.blockDangerous) {
        const cmd = extractCommandForBtn(btn);
        const activePatterns = window.__ea_compiled_danger_patterns || [];
        if (cmd) {
          const hit = activePatterns.find(r => r.re.test(cmd));
          if (hit) {
            window.__ea_danger_lock = { id: hit.id, name: hit.name, cmd, at: Date.now() };
            if (root) {
              blockCardApprovalButtons(root);
              processedRoots.add(root);
            } else {
              btn.setAttribute('data-ea-ok', 'blocked');
            }
            if (!root || !reportedDangerRoots.has(root)) {
              if (root) reportedDangerRoots.add(root);
              console.warn('[EA_ALERT] 拦截高危指令[' + hit.id + ']，等待用户手动确认: ' + oneLine(cmd, 80));
            }
            return true;
          }
        }
      }

      const card = cardForSubmit(btn);
      const optIdx = (window.__ea_config && window.__ea_config.preferOption) || 1;
      let optText = '';
      let picked = null;
      if (card) {
        const cands = collectOptionCands(card);
        if (cands.length) {
          const brief = cands.map(c => '#' + c.cls + (c.checked ? '*' : '') + oneLine(c.text, 36)).join(' | ');
          
        }
        picked = matchOptionEl(card, optIdx);
        if (picked && picked.el) {
          realClick(picked.el);
          optText = oneLine(picked.text, 40);
          // 若点击后仍无选中态，再点一次（部分自定义控件首次 pointer 无效）
          const st = picked.el.getAttribute && picked.el.getAttribute('data-state');
          const stillOff = picked.el.checked === false ||
            picked.el.getAttribute('aria-checked') === 'false' ||
            st === 'unchecked';
          if (stillOff) realClick(picked.el);
        } else if (cands.length) {
          // 有选项组但没匹配到目标：不要默默点提交，避免落到会话级 always
          console.warn('[EA_OPT] 未找到选项[' + optIdx + ']，暂不点击提交');
          return false;
        }
      }
      btn.setAttribute('data-ea-ok', 'true');
      if (root) processedRoots.add(root);

      realClick(btn);
      const cmd = extractLogSummary(card, kind || (btn.innerText || ''), btn);
      const optLabel = picked
        ? '选项[' + picked.cls + '] ' + optText
        : '无选项组';
      // 有选项组 = 确认放行；无选项组 = 权限请求（避免双次「放行」误报）
      const action = picked ? '放行' : '权限请求';
      
      return true;
    }

    function clip(s, n) {
      s = String(s || '').replace(/\\s+/g, ' ').trim();
      if (s.length <= n) return s;
      return s.slice(0, n - 1) + '…';
    }

    function extractRequestSummary(card) {
      if (!card) return '';
      const parts = [];
      // 代码/命令块优先
      const codes = Array.from(card.querySelectorAll('pre, code, [class*="command"], [class*="code"], [data-testid*="command"]'));
      for (const c of codes) {
        const t = (c.innerText || c.textContent || '').trim();
        if (t && t.length > 1 && t.length < 500) {
          parts.push(t);
          if (parts.length >= 2) break;
        }
      }
      // 文件路径类
      const paths = Array.from(card.querySelectorAll('[class*="path"], [class*="file"], [title]'));
      for (const p of paths) {
        const t = (p.getAttribute('title') || p.innerText || '').trim();
        if (t && /[\\\\/]|:\\\\/.test(t) && t.length < 200) {
          parts.push(t);
          break;
        }
      }
      // 描述段落：排除按钮/选项行
      if (parts.length === 0) {
        const texts = Array.from(card.querySelectorAll('p, span, div'))
          .map(el => (el.innerText || '').trim())
          .filter(t => t.length > 8 && t.length < 180)
          .filter(t => !isSubmitLabel(t))
          .filter(t => !/^(1|2|3|4)[\\s\\.\\:：\\-]/.test(norm(t)))
          .filter(t => !/^(submit|提交|confirm|确认|allow|允许|run|运行)/i.test(t));
        if (texts.length) {
          // 取最长的一段作为请求描述
          texts.sort((a, b) => b.length - a.length);
          parts.push(texts[0]);
        }
      }
      const uniq = [];
      for (const p of parts) {
        const v = clip(p, 160);
        if (v && uniq.indexOf(v) < 0) uniq.push(v);
      }
      return uniq.join(' | ');
    }

    // ── 翻译禁区：保护代码块/编辑器/终端/输入框不被误翻 ──
    const BLOCKED_TAGS = ['SCRIPT','STYLE','CODE','PRE','INPUT','TEXTAREA','SVG','CANVAS','KBD','SAMP','VAR'];
    const BLOCKED_CLASS_SUBSTR = [
      'code-view','editor-container','monaco-editor','suggest-widget',
      'output-view','debug-console','artifact-container','code-block',
      'diff-view','input-area','chat-input','cm-editor','CodeMirror',
      'highlight','syntax','prism','hljs',
      'thought','thinking','reasoning','agent-turn','user-turn','chat-turn','chat-message','markdown-body'
    ];
    const BLOCKED_CLASS_TOKEN = ['terminal','xterm','preview','code'];

    function isInBlockedZone(node) {
      let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      let depth = 0;
      while (curr && depth < 25) {
        if (curr.nodeType === Node.ELEMENT_NODE) {
          // 审批卡与交互弹窗：绝对禁止翻译！彻底保护 React 组件树，避免触发组件重绘与状态脱节
          if (isApprovalCard(curr)) return true;
          // 人机交互区域（Agent思考路径、对话流、消息正文）：绝对禁止翻译！保持流式输出原生性与格式渲染
          if (isHumanAgentInteractionZone(curr)) return true;
          const tag = (curr.tagName || '').toUpperCase();
          if (BLOCKED_TAGS.includes(tag)) return true;
          if (curr.getAttribute && curr.getAttribute('contenteditable') === 'true') return true;
          const role = (curr.getAttribute && curr.getAttribute('role')) || '';
          if (role === 'code' || role === 'textbox') return true;
          const cls = curr.className || '';
          if (typeof cls === 'string' && cls) {
            if (BLOCKED_CLASS_SUBSTR.some(c => cls.includes(c))) return true;
            const tokens = cls.split(/[\s]+/);
            if (tokens.some(t => BLOCKED_CLASS_TOKEN.includes(t))) return true;
          }
        }
        curr = curr.parentElement || (curr.parentNode && curr.parentNode.host);
        depth++;
      }
      return false;
    }

    // ── 审批框结构识别（绝对豁免翻译，保持原生纯净英文） ──
    function isApprovalCard(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const tid = (el.getAttribute && el.getAttribute('data-testid')) || '';
      if (
        tid.includes('interaction') ||
        tid.includes('approval') ||
        tid.includes('permission') ||
        tid.includes('run-command') ||
        tid.includes('continue') ||
        tid.includes('ask-question')
      ) return true;
      const cls = el.className || '';
      if (typeof cls === 'string' && cls) {
        if (/interaction|approval|permission|run-command/i.test(cls)) return true;
      }
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      if (role === 'radiogroup') return true;
      if (role === 'dialog' || role === 'alertdialog') {
        const hasApprovalBtn = !!el.querySelector(
          'button[data-testid*="interaction"], button[data-testid*="approval"], button[data-testid*="permission"], button[data-testid*="continue"]'
        );
        const hasCode = !!el.querySelector('pre, code, [class*="code"], [data-testid*="command"]');
        if (hasApprovalBtn || (hasCode && !!el.querySelector('button, [role="button"]'))) return true;
      }
      return false;
    }

    // ── 人机交互界面识别（思考过程、对话流、消息正文、工具执行步骤等绝对豁免翻译，保护流式输出与格式渲染） ──
    function isHumanAgentInteractionZone(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const tid = (el.getAttribute && el.getAttribute('data-testid')) || '';
      if (
        tid.includes('thought') ||
        tid.includes('thinking') ||
        tid.includes('reasoning') ||
        tid.includes('agent-turn') ||
        tid.includes('user-turn') ||
        tid.includes('chat-turn') ||
        tid.includes('chat-message') ||
        tid.includes('chat-bubble') ||
        tid.includes('chat-response') ||
        tid.includes('chat-history') ||
        tid.includes('chat-pane') ||
        tid.includes('conversation-turn') ||
        tid.includes('markdown-body') ||
        tid.includes('rendered-markdown') ||
        tid.includes('tool-call') ||
        tid.includes('step') ||
        tid.includes('review') ||
        tid.includes('diff')
      ) return true;

      const cls = el.className || '';
      if (typeof cls === 'string' && cls) {
        if (/thought|thinking|reasoning|agent-turn|user-turn|chat-turn|chat-message|chat-bubble|chat-response|chat-markdown|markdown-body|rendered-markdown|prose|tool-call|step-|review-|diff-/i.test(cls)) {
          return true;
        }
      }
      return false;
    }

    // 弃用审批框动态正则翻译：审批选项、按钮全保留原生英文，杜绝 React 节点重绘
    const DYNAMIC_RULES = [];

    function tryDynamicTranslate(text) {
      return null;
    }

    function translateDOM(root) {
      if (!window.__ea_config.enableI18n || !window.__ea_dict || !root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (isInBlockedZone(node)) continue;
        const text = node.nodeValue.trim();
        if (!text) continue;
        // 1. 词典精确匹配
        if (window.__ea_dict[text]) {
          if (node.__ea_translated !== node.nodeValue) {
            node.__ea_orig = node.nodeValue;
          }
          node.nodeValue = node.nodeValue.replace(text, window.__ea_dict[text]);
          node.__ea_translated = node.nodeValue;
          continue;
        }
        // 2. 动态正则规则（审批选项等含变量文本）
        const dynamic = tryDynamicTranslate(text);
        if (dynamic) {
          if (node.__ea_translated !== node.nodeValue) {
            node.__ea_orig = node.nodeValue;
          }
          node.nodeValue = node.nodeValue.replace(text, dynamic);
          node.__ea_translated = node.nodeValue;
        }
      }
      const elements = root.querySelectorAll ? root.querySelectorAll('[placeholder], [title], [aria-label]') : [];
      elements.forEach(el => {
        if (isInBlockedZone(el)) return;
        ['placeholder','title','aria-label'].forEach(attr => {
          const val = el.getAttribute(attr);
          if (val && window.__ea_dict[val]) {
            if (!el.hasAttribute('data-ea-orig-' + attr)) {
              el.setAttribute('data-ea-orig-' + attr, val);
            }
            el.setAttribute(attr, window.__ea_dict[val]);
          }
        });
      });
    }

    function revertDOM(root) {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (isInBlockedZone(node)) continue;
        if (node.__ea_orig !== undefined) {
          node.nodeValue = node.__ea_orig;
          delete node.__ea_orig;
          delete node.__ea_translated;
          continue;
        }
        const text = node.nodeValue.trim();
        if (text && window.__ea_reverse_dict && window.__ea_reverse_dict[text]) {
          node.nodeValue = node.nodeValue.replace(text, window.__ea_reverse_dict[text]);
          delete node.__ea_translated;
        }
      }
      const origAttrEls = root.querySelectorAll ? root.querySelectorAll('[data-ea-orig-placeholder], [data-ea-orig-title], [data-ea-orig-aria-label]') : [];
      origAttrEls.forEach(el => {
        ['placeholder','title','aria-label'].forEach(attr => {
          const orig = el.getAttribute('data-ea-orig-' + attr);
          if (orig !== null) {
            el.setAttribute(attr, orig);
            el.removeAttribute('data-ea-orig-' + attr);
          }
        });
      });
      const allAttrEls = root.querySelectorAll ? root.querySelectorAll('[placeholder], [title], [aria-label]') : [];
      allAttrEls.forEach(el => {
        if (isInBlockedZone(el)) return;
        ['placeholder','title','aria-label'].forEach(attr => {
          const val = el.getAttribute(attr);
          if (val && window.__ea_reverse_dict && window.__ea_reverse_dict[val]) {
            el.setAttribute(attr, window.__ea_reverse_dict[val]);
          }
        });
      });
    }

    window.__ea_sync_config = function() {
      function syncDoc(doc) {
        if (!doc) return;
        if (window.__ea_config && window.__ea_config.enableI18n) {
          translateDOM(doc);
          doc.__ea_i18n_applied = true;
        } else {
          revertDOM(doc);
          doc.__ea_i18n_applied = false;
        }
      }
      syncDoc(document);
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(f => {
        try { if (f.contentDocument) syncDoc(f.contentDocument); } catch (e) {}
      });
    };

    if (window.__ea_scan_interval) clearInterval(window.__ea_scan_interval);
    window.__ea_scan_interval = setInterval(() => {
      function scan(doc) {
        if (!doc) return;
        if (!doc.__ea_click_listener_installed) {
          doc.__ea_click_listener_installed = true;
          try {
            doc.addEventListener('click', (e) => {
              const btn = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null;
              if (!btn) return;
              const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim();
              const tid = btn.getAttribute('data-testid') || '';
              if (isSubmitLabel(text) || /(?:continue|submit|allow|reject|cancel|deny)/i.test(tid)) {
                window.__ea_danger_lock = null;
                btn.setAttribute('data-ea-ok', 'user-interacted');
              }
            }, true);
          } catch (e) {}
        }

        if (window.__ea_config && window.__ea_config.enableI18n) {
          translateDOM(doc);
          doc.__ea_i18n_applied = true;
        } else if (doc.__ea_i18n_applied) {
          revertDOM(doc);
          doc.__ea_i18n_applied = false;
        }

        // ── 调试模式：抓取审批卡 DOM 结构 ──
        if (window.__ea_config.debugApproval) {
          const debugSelectors = [
            '[role="dialog"]', '[role="alertdialog"]',
            'div[data-testid*="interaction"]', 'div[data-testid*="approval"]',
            'div[data-testid*="permission"]', 'div[data-testid*="command"]',
            'div[data-testid*="run"]', 'div[class*="card"]'
          ];
          const seen = new Set();
          for (const sel of debugSelectors) {
            doc.querySelectorAll(sel).forEach(el => {
              if (seen.has(el)) return;
              const text = (el.innerText || '').trim();
              if (!text || text.length < 10 || text.length > 3000) return;
              const hasCode = !!el.querySelector('pre, code, [class*="code"], [data-testid*="command"]');
              const hasBtn = !!el.querySelector('button, [role="button"]');
              if (!hasBtn) return;
              // 只抓含审批关键词或含代码块的容器
              const isApproval = /allow|deny|reject|run|accept|permission|允许|拒绝|运行|执行/i.test(text) || hasCode;
              if (!isApproval) return;
              seen.add(el);
              // 输出结构摘要
              const tid = el.getAttribute('data-testid') || '';
              const role = el.getAttribute('role') || '';
              const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 80);
              const btns = Array.from(el.querySelectorAll('button, [role="button"]')).map(b => {
                const bt = (b.innerText || '').trim().slice(0, 40);
                const btId = b.getAttribute('data-testid') || '';
                return bt ? (btId ? bt + '[' + btId + ']' : bt) : null;
              }).filter(Boolean);
              const codeText = hasCode ? (el.querySelector('pre, code, [class*="code"]')?.innerText || '').trim().slice(0, 120) : '';
              console.log('[EA_DOM] tag=' + el.tagName + ' role=' + role + ' testid=' + tid + ' class=' + cls);
              console.log('[EA_DOM]   buttons: ' + (btns.join(' | ') || '(none)'));
              if (codeText) console.log('[EA_DOM]   code: ' + codeText);
              console.log('[EA_DOM]   text: ' + text.slice(0, 200).replace(/\\n/g, ' ⏎ '));
              // 输出完整 HTML（截断到 1500 字符）
              const html = el.outerHTML.slice(0, 1500);
              console.log('[EA_HTML] ' + html);
            });
          }
        }

        if (!window.__ea_config.autoAccept) return;
        // fail closed：高危锁定时绝不进入任何点击分支
                if (checkDangerous(doc)) return;

        
        // ── 终极权限弹窗直接破解与方案问答识别 ──
        const radioGroups = doc.querySelectorAll('[role="radiogroup"]');
        for (const rg of radioGroups) {
          const txt = (rg.innerText || rg.textContent || '').toLowerCase();
          // 权限审批卡的单选项严格具有权限授权特征：allow this time / always allow / 允许本次 / 始终允许
          const isPermission = (txt.includes('allow') && (txt.includes('this time') || txt.includes('always'))) ||
                               (txt.includes('允许') && (txt.includes('本次') || txt.includes('始终') || txt.includes('总是')));
          
          if (!isPermission) {
            // 纯业务/方案问答框：触发薄荷青提示，绝对禁止自动放行，静候用户操作
            const card = getInteractionRoot(rg) || rg.closest('[role="dialog"], [role="alertdialog"], div[data-testid*="interaction"], div[class*="card"], div.relative') || rg.parentElement || rg;
            if (card) {
              reportedRoots.add(card);
            }
            if (!rg.hasAttribute('data-ea-interact-reported')) {
              rg.setAttribute('data-ea-interact-reported', 'true');
              if (card && card.setAttribute) card.setAttribute('data-ea-interact-reported', 'true');
              const titleEl = card ? card.querySelector('p, h1, h2, h3, h4, span') : null;
              const qTitle = (titleEl ? titleEl.innerText : (card ? card.innerText : rg.innerText)) || '';
              const summary = (qTitle.split(String.fromCharCode(10))[0] || '').slice(0, 80).trim();
              console.warn('[EA_INTERACT] 方案问答：' + (summary || '等待您手动选择选项并提交...'));
            }
            continue;
          }

          // 确认属于权限审批框：执行自动放行
          const radios = Array.from(rg.querySelectorAll('input[type="radio"]'));
          if (radios.length >= 1) {
            // 正确映射：
            // p = 1: 选项1 仅允许本次 -> radios[0]
            // p = 2: 选项2 对话中始终允许 -> radios[1]
            // p = 3: 选项3 项目中始终允许 -> radios[2]
            // p = 4: 选项4 全局始终允许 -> radios[3]
            const p = Number(window.__ea_config.preferOption) || 1;
            const targetIdx = Math.min(Math.max(p - 1, 0), radios.length - 1);
            const targetInput = radios[targetIdx];
            
            if (targetInput && !targetInput.checked) {
              const label = targetInput.closest('label');
              if (label) realClick(label);
            }

            const submitBtn = Array.from(doc.querySelectorAll('button')).find(b => {
              if (b.disabled || b.hasAttribute('data-ea-ok')) return false;
              const bt = (b.innerText || '').trim().toLowerCase();
              return bt === 'submit' || bt === 'continue' || bt === 'allow' || bt === '确认' || bt === '提交' || b.getAttribute('data-testid') === 'interaction-continue-button';
            });
            
            if (submitBtn) {
              reportInteractionRequest(submitBtn);
              const cmd = extractCommandForBtn(submitBtn) || 'run-command';
              const optNames = ['仅允许本次', '对话中始终允许', '项目中始终允许', '全局始终允许'];
              const optText = optNames[targetIdx] || '仅允许本次';
              console.log('[EA_AA] 放行 · 选项[' + (targetIdx + 1) + '] ' + optText + ' · ' + cmd);
              submitBtn.setAttribute('data-ea-ok', 'true');
              realClick(submitBtn);
              return;
            }
          }
        }

        // ── 策略1: data-testid 精确匹配（最稳定，语言无关） ──
        const testidBtns = doc.querySelectorAll(
          'button[data-testid="interaction-continue-button"],' +
          'button[data-testid="approval-submit"],' +
          'button[data-testid="permission-allow"]'
        );
        for (const btn of testidBtns) {
          reportInteractionRequest(btn);
          if (tryApprove(btn, 'testid:' + (btn.getAttribute('data-testid') || ''))) return;
        }

        // ── 策略2: 结构指纹 — 容器内同时存在代码块+按钮 ──
        const containers = doc.querySelectorAll(
          '[role="dialog"], [role="alertdialog"],' +
          'div[data-testid*="interaction"], div[data-testid*="approval"],' +
          'div[data-testid*="permission"], div[data-testid*="command"]'
        );
        for (const card of containers) {
          const codeEl = card.querySelector('pre, code, [data-testid*="command"], [class*="code"]');
          const btns = Array.from(card.querySelectorAll('button, [role="button"]'));
          if (!codeEl || !btns.length) continue;
          // 只接受明确的最终确认按钮，不能把“运行”这类发起请求按钮当成授权。
          const submitBtn =
            btns.find(b => /(?:continue|submit|allow)/i.test(b.getAttribute('data-testid') || '')) ||
            btns.find(b => isSubmitLabel(b.innerText || b.value || b.getAttribute('aria-label')));
          if (submitBtn) {
            reportInteractionRequest(submitBtn);
            if (tryApprove(submitBtn, '结构指纹审批卡')) return;
          }
        }

        // ── 策略3: 关键字兜底（中英双写，兼容汉化后） ──
        const kws = ['accept', 'continue', 'always allow', 'allow', 'submit',
                     '接受', '继续', '始终允许', '允许', '确认', '提交'];
        for (const btn of Array.from(doc.querySelectorAll('button, [role="button"]'))) {
          const txt = norm(btn.innerText || btn.getAttribute('aria-label'));
          if (!txt || txt.length > 24) continue;
          if (kws.some(k => txt === k || txt.startsWith(k))) {
            if (tryApprove(btn, txt)) return;
          }
        }
      }

      scan(document);
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(f => {
        try { if (f.contentDocument) scan(f.contentDocument); } catch (e) {}
      });
    }, 800);
  })();`;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

const cdpSockets = new Map();
let cdpCmdId = 1;

function cdpSend(ws, method, params = {}) {
  const id = cdpCmdId++;
  try {
    ws.send(JSON.stringify({ id, method, params }));
    return true;
  } catch (e) {
    state.cdpError = `send ${method}: ${e.message || e}`;
    return false;
  }
}

function injectInto(ws, reason = '') {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const ok = cdpSend(ws, 'Runtime.evaluate', {
    expression: generateMasterInjectScript(),
    returnByValue: false,
    awaitPromise: false
  });
  if (ok) {
    state.injectCount += 1;
    state.lastInjectAt = Date.now();
    state.cdpError = '';
  }
  return ok;
}

function broadcastConfig() {
  const script = `(() => {
    window.__ea_config = Object.assign(window.__ea_config || {}, {
      preferOption: ${state.preferOption},
      blockDangerous: ${state.blockDangerous},
      autoAccept: ${state.autoAccept},
      enableI18n: ${state.enableI18n},
      debugApproval: ${state.debugApproval ? 'true' : 'false'}
    });
    if (typeof window.__ea_sync_config === 'function') {
      window.__ea_sync_config();
    }
  })();`;
  for (const [, entry] of cdpSockets) {
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      cdpSend(entry.ws, 'Runtime.evaluate', {
        expression: script,
        returnByValue: false,
        awaitPromise: false
      });
    }
  }
}

let lastStatusKey = '';
function pushClientStatus() {
  const alive = state.clientRunning && state.cdpSockets > 0;
  const status = !state.clientRunning
    ? '客户端未运行'
    : alive
      ? `运行中 · 界面自动化已接管 ${state.cdpSockets}`
      : '运行中 · 等待 CDP';
  const payload = {
    status,
    clientRunning: state.clientRunning,
    cdpSockets: state.cdpSockets,
    cdpTargets: state.cdpTargets,
    injectCount: state.injectCount,
    lastInjectAt: state.lastInjectAt,
    cdpError: state.cdpError
  };
  // 状态心跳只在关键字段变化时推送，避免刷屏；且绝不带 category/message
  const key = [
    status,
    state.clientRunning,
    state.cdpSockets,
    state.cdpTargets,
    state.cdpError
  ].join('|');
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  sseClients.forEach(res => res.write(`data: ${JSON.stringify(payload)}\n\n`));
}

async function startCDPLoop() {
  if (state.cdpLoopRunning) return;
  state.cdpLoopRunning = true;
  state.cdpFailStreak = 0;
  while (state.clientRunning) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const valid = (targets || []).filter(t =>
        t && t.webSocketDebuggerUrl &&
        t.type !== 'iframe' &&
        t.type !== 'worker' &&
        t.type !== 'service_worker' &&
        !String(t.url || '').startsWith('devtools://') &&
        !String(t.url || '').startsWith('data:text/html') &&
        !String(t.url || '').startsWith('about:')
      );

      state.cdpTargets = valid.length;
      if (valid.length > 0) state.cdpFailStreak = 0;
      const aliveIds = new Set(valid.map(t => t.webSocketDebuggerUrl));

      for (const [key, entry] of cdpSockets) {
        if (!aliveIds.has(key)) {
          try { entry.ws.close(); } catch (e) {}
          cdpSockets.delete(key);
        }
      }

      for (const target of valid) {
        const key = target.webSocketDebuggerUrl;

        if (!cdpSockets.has(key)) {
          const ws = new WebSocket(key);
          const entry = { ws, title: target.title || '', url: target.url || '' };
          cdpSockets.set(key, entry);

          ws.on('open', () => {
            cdpSend(ws, 'Runtime.enable');
            cdpSend(ws, 'Page.enable');
            injectInto(ws, 'open');
            logToGUI('CDP', `已连接界面自动化目标: ${String(entry.title || entry.url).slice(0, 60)}`, 'tag-i18n');
            pushClientStatus();
          });

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              // 导航/新执行上下文后立刻补打（AG 动态端口 Reload 会走这里）
              if (
                msg.method === 'Runtime.executionContextCreated' ||
                msg.method === 'Page.loadEventFired' ||
                msg.method === 'Page.frameNavigated'
              ) {
                injectInto(ws, msg.method);
              }
              if (msg.method === 'Runtime.consoleAPICalled') {
                const text = msg.params.args.map(a => a.value || '').join(' ');
                if (text.includes('[EA_AA]')) {
                  state.approveCount += 1;
                  logToGUI('AUTO-ACCEPT', text.replace('[EA_AA]', '').trim(), 'tag-aa');
                  pushCounters();
                } else if (text.includes('[EA_REQUEST]')) {
                  // 仅表示审批卡出现；尚未点击最终确认按钮，因此不增加批准数。
                  logToGUI('PERMISSION REQUEST', text.replace('[EA_REQUEST]', '').trim(), 'tag-warn');
                } else if (text.includes('[EA_ALERT]')) {
                  state.blockCount += 1;
                  logToGUI('SECURITY ALERT', text.replace('[EA_ALERT]', '').trim(), 'tag-alert');
                  pushCounters();
                  popupGuiWindow();
                } else if (text.includes('[EA_INTERACT]')) {
                  logToGUI('INTERACTION', text.replace('[EA_INTERACT]', '').trim(), 'tag-mint');
                  popupGuiWindow();
                } else if (text.includes('[EA_DOM]')) {
                  logToGUI('DOM-CAPTURE', text.replace('[EA_DOM]', '').trim(), 'tag-i18n');
                } else if (text.includes('[EA_HTML]')) {
                  logToGUI('DOM-HTML', text.replace('[EA_HTML]', '').trim(), 'tag-i18n');
                } else if (text.includes('[EA_TRACE]') && state.debugApproval) {
                  logToGUI('APPROVAL TRACE', text.replace('[EA_TRACE]', '').trim(), 'tag-warn');
                }
              }
            } catch (e) {}
          });

          ws.on('error', (err) => {
            state.cdpError = `ws: ${err.message || err}`;
            logToGUI('CDP', `WebSocket 错误: ${err.message || err}`, 'tag-warn');
            cdpSockets.delete(key);
            try { ws.close(); } catch (e) {}
            pushClientStatus();
          });

          ws.on('close', () => {
            cdpSockets.delete(key);
            pushClientStatus();
          });
        } else {
          const entry = cdpSockets.get(key);
          if (entry.ws.readyState !== WebSocket.OPEN) {
            try { entry.ws.close(); } catch (e) {}
            cdpSockets.delete(key);
          }
        }
      }

      state.cdpSockets = cdpSockets.size;
      if (valid.length === 0) {
        state.cdpError = 'CDP 无可用页面目标';
      }
    } catch (e) {
      state.cdpError = String(e.message || e);
      state.cdpSockets = cdpSockets.size;
      state.cdpFailStreak += 1;
      // CDP 连续不可达 2 次（约 4s）：视为客户端已退出
      if (state.cdpFailStreak >= 2) {
        state.clientRunning = false;
        state.cdpTargets = 0;
        state.cdpSockets = 0;
        for (const [, entry] of cdpSockets) {
          try { entry.ws.close(); } catch (e) {}
        }
        cdpSockets.clear();
        logToGUI('SYSTEM', 'CDP 失联，已标记客户端停止', 'tag-warn');
        pushClientStatus();
        break;
      }
    }
    pushClientStatus();
    await new Promise(r => setTimeout(r, 2000));
  }
  state.cdpLoopRunning = false;
  state.clientRunning = false;
  state.cdpSockets = 0;
  pushClientStatus();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const server = http.createServer((req, res) => {
  if (req.url === '/' || (req.url && req.url.startsWith('/?'))) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    return res.end(fs.readFileSync(HTML_FILE));
  }
  if (req.url && req.url.startsWith('/assets/')) {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/assets\//, '');
    const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(ROOT_DIR, 'assets', safe);
    if (!file.startsWith(path.join(ROOT_DIR, 'assets')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (req.url === '/api/danger-rules' && req.method === 'GET') {
    return res.end(JSON.stringify({
      path: RULES_FILE,
      enabled: dangerRules.enabled !== false,
      rules: dangerRules.rules,
      active: state.dangerRulesOn,
      total: state.dangerRulesTotal
    }));
  }
  if (req.url === '/api/danger-rules/reload' && req.method === 'POST') {
    loadDangerRules();
    let broadcastCount = 0;
    for (const [, entry] of cdpSockets) {
      if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
        if (injectInto(entry.ws, 'reload')) broadcastCount++;
      }
    }
    logToGUI('SECURITY', `高危规则已重载: ${state.dangerRulesOn}/${state.dangerRulesTotal} 条生效${broadcastCount ? ' (已实时同步至 ' + broadcastCount + ' 个会话)' : ''}`, 'tag-proxy');
    return res.end(JSON.stringify({ ok: true, active: state.dangerRulesOn, total: state.dangerRulesTotal, broadcastCount }));
  }
  if (req.url === '/api/danger-rules/open' && req.method === 'POST') {
    try {
      if (!fs.existsSync(RULES_FILE)) {
        const fallback = path.join(ROOT_DIR, 'danger-rules.json');
        if (fs.existsSync(fallback)) fs.copyFileSync(fallback, RULES_FILE);
      }
      if (!fs.existsSync(RULES_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'rules file missing' }));
      }
      // explorer 用系统默认程序打开 json，比 cmd start 更稳
      const editor = spawn(IS_MAC ? 'open' : 'explorer.exe', IS_MAC ? ['-t', RULES_FILE] : [RULES_FILE], { detached: true, stdio: 'ignore' });
      editor.on('error', err => logToGUI('SYSTEM', '打开规则失败: ' + err.message, 'tag-alert'));
      editor.unref();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, path: RULES_FILE }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('pong');
  }
  if (req.url === '/api/status') {
    ensureProxyWatchdog();
    // 快速检测 AG 进程是否存活
    if (state.clientRunning) {
      if (launchedClient && launchedClient.pid) {
        if (!isPidAlive(launchedClient.pid)) {
          state.clientRunning = false;
          state.cdpSockets = 0;
          logToGUI('SYSTEM', '检测到 Antigravity 进程已退出', 'tag-warn');
          pushClientStatus();
        }
      } else {
        try {
          const checkCmd = IS_WIN
            ? 'tasklist /FI "IMAGENAME eq Antigravity.exe" /NH'
            : 'pgrep -x Antigravity || pgrep -f "Antigravity.app/Contents/MacOS"';
          exec(checkCmd, { windowsHide: true }, (err, stdout) => {
            if (!err && stdout && (stdout.includes('Antigravity') || /\d+/.test(stdout))) {
              // 进程还在
            } else {
              state.clientRunning = false;
              state.cdpSockets = 0;
              logToGUI('SYSTEM', '检测到 Antigravity 进程已退出', 'tag-warn');
              pushClientStatus();
            }
          });
        } catch (e) {}
      }
    }
    return res.end(JSON.stringify(state));
  }
  if (req.url && req.url.startsWith('/api/logs') && req.method === 'GET') {
    const params = new URL(req.url, `http://127.0.0.1:${GUI_PORT}`).searchParams;
    const requested = Number.parseInt(params.get('limit') || '100', 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 300);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(logHistory.slice(-limit)));
  }
  if (req.url === '/api/quit' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    quitApp('收到退出请求');
    return;
  }
  if (req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    sseClients.push(res);
    flushLogBuffer();
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }
  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        if (data.port) {
          const portNum = parseInt(data.port, 10);
          if (portNum >= 1 && portNum <= 65535) {
            syncProxyPort(portNum);
          } else {
            logToGUI('PROXY', `非法端口输入 [${data.port}]，已忽略`, 'tag-warn');
          }
        }

        const prevI18n = state.enableI18n;
        if (typeof data.autoAccept === 'boolean') state.autoAccept = data.autoAccept;
        if (typeof data.blockDangerous === 'boolean') state.blockDangerous = data.blockDangerous;
        if (typeof data.enableI18n === 'boolean') state.enableI18n = data.enableI18n;
        if (typeof data.debugApproval === 'boolean') state.debugApproval = data.debugApproval;
        if (data.preferOption) state.preferOption = data.preferOption;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ port: state.port, autoAccept: state.autoAccept, blockDangerous: state.blockDangerous, preferOption: state.preferOption, enableI18n: state.enableI18n, debugApproval: state.debugApproval }, null, 2));

        if (typeof data.enableI18n === 'boolean' && data.enableI18n !== prevI18n) {
          logToGUI('I18N', state.enableI18n ? '汉化引擎已启用' : '汉化引擎已停用，已还原原生英文界面', 'tag-i18n');
        }

        broadcastConfig();

        res.end('ok');
      } catch (e) {
        res.writeHead(400);
        res.end('invalid json');
      }
    });
    return;
  }
  if (req.url === '/api/launch' && req.method === 'POST') {
    const restored = ensureProxyWatchdog();
    if (nativeProxyMode) {
      logToGUI('PROXY', `原生代理模式：Chromium + language_server 使用 HTTP 代理 127.0.0.1:${state.port}，本地回环直连`, 'tag-proxy');
    } else if (restored) {
      logToGUI('PROXY', '检测到客户端更新抹除补丁，已自动从备份恢复！', 'tag-warn');
    } else {
      logToGUI('PROXY', 'DLL 兼容模式校验通过', 'tag-proxy');
    }

    if (state.enableI18n) logToGUI('I18N', `已装载汉化引擎 (${state.dictEntries} 条词条)`, 'tag-i18n');

    // 若已在跑，只提示刷新，不重复 spawn
    if (state.clientRunning) {
      logToGUI('SYSTEM', '客户端已在运行，CDP 界面接管通道保持重试', 'tag-warn');
      pushClientStatus();
      res.end('ok');
      return;
    }

    const launch = nativeProxyMode
      ? buildNativeProxyLaunch()
      : { args: [`--remote-debugging-port=${CDP_PORT}`], env: process.env };
    const currentPaths = getAntigravityPaths();
    const launchCmd = currentPaths.appExe;
    if (!fs.existsSync(launchCmd)) {
      res.writeHead(404);
      return res.end('未找到 Antigravity: ' + launchCmd);
    }
    const launchArgs = launch.args;
    const child = spawn(launchCmd, launchArgs, {
      detached: true,
      stdio: 'ignore',
      env: launch.env
    });
    launchedClient = child;
    child.on('error', err => {
      state.clientRunning = false;
      logToGUI('SYSTEM', '启动 Antigravity 失败: ' + err.message, 'tag-alert');
      pushClientStatus();
    });
    state.clientRunning = true;
    state.cdpError = '';
    state.cdpFailStreak = 0;
    logToGUI(
      'SYSTEM',
      nativeProxyMode
        ? '✓ Antigravity 已以原生代理模式启动，CDP 接管就绪'
        : '✓ Antigravity 已以 DLL 兼容模式启动，CDP 接管就绪',
      'tag-proxy'
    );
    pushClientStatus();

    startCDPLoop();
    child.on('exit', () => {
      state.clientRunning = false;
      state.cdpSockets = 0;
      for (const [, entry] of cdpSockets) {
        try { entry.ws.close(); } catch (e) {}
      }
      cdpSockets.clear();
      logToGUI('SYSTEM', 'Antigravity 客户端已关闭', 'tag-warn');
      pushClientStatus();
    });
    res.end('ok');
    return;
  }

  // 未知路由必须结束响应，避免前端 fetch 永久挂起
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found', url: req.url }));
});

loadDictionaries();
loadDangerRules();

async function tryAttachExistingClient() {
  try {
    const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (!Array.isArray(targets) || !targets.length) return false;
    state.clientRunning = true;
    logToGUI('SYSTEM', '检测到 Antigravity 已在运行，自动接管其界面', 'tag-proxy');
    startCDPLoop();
    return true;
  } catch (e) {
    return false;
  }
}

function writeCrashLog(msg) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'easyag-error.log'), String(msg), 'utf-8');
  } catch (e) {}
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    focusExistingGui();
    process.exit(0);
  }
  writeCrashLog(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  writeCrashLog(err && err.stack ? err.stack : String(err));
});

process.on('exit', releaseLock);

// 原生宿主拥有生命周期：关闭窗口写入 quit，宿主异常结束会关闭管道。
// 页面轮询暂停、刷新、SSE 重连均不触发退出。
if (TAURI_MODE) {
  require('readline').createInterface({ input: process.stdin }).on('line', line => {
    if (line === 'quit') quitApp('原生窗口关闭');
  }).on('close', () => quitApp('原生宿主管道关闭'));
}

server.listen(GUI_PORT, '127.0.0.1', () => {
  if (!TAURI_MODE) try { fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8'); } catch (e) {}
  ensureProxyWatchdog();
  logToGUI('SECURITY', `高危规则已加载: ${state.dangerRulesOn}/${state.dangerRulesTotal} 条生效`, 'tag-proxy');
  if (TAURI_MODE) {
    const ready = { port: server.address().port, pid: process.pid };
    const readyFile = normalizePath(process.env.EASYAG_READY_FILE);
    if (readyFile) fs.writeFileSync(readyFile, JSON.stringify(ready));
  } else openGuiWindow();
  // AG 可能先于 EasyAG 启动：探测 9333 并自动接管
  if (!TEST_MODE) setTimeout(() => { tryAttachExistingClient(); }, 500);
});
