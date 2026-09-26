const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
  if (residentProcess) {
    try {
      residentProcess.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
      residentProcess.kill();
    } catch (e) {}
    residentProcess = null;
  }
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

// 双击 exe 会挂控制台：windowsHide 重启自身并退出，避免黑框
// 已有实例时不再拉起新进程
if (IS_WIN && !TAURI_MODE && !process.env.EASYAG_NOCONSOLE) {
  if (alreadyRunning()) {
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
  process.exit(0);
}

try {
  process.removeAllListeners('warning');
  process.on('warning', () => {});
  process.env.NODE_NO_WARNINGS = '1';
} catch (e) {}

const HTML_FILE = path.join(ROOT_DIR, 'index.html');
const DICT_DIR = path.join(ROOT_DIR, 'dicts');
const RULES_FILE = path.join(DATA_DIR, 'danger-rules.json');
if (TAURI_MODE && !fs.existsSync(RULES_FILE)) {
  fs.copyFileSync(path.join(ROOT_DIR, 'danger-rules.json'), RULES_FILE);
}

// 调试模式：--debug 参数 或 debug.flag 文件 存在时开启
const debugMode = process.argv.includes('--debug') || fs.existsSync(path.join(__dirname, 'debug.flag'));

let state = {
  port: 7890,
  blockDangerous: true,
  enableI18n: true,
  dictEntries: 0,
  clientRunning: false,
  dangerRulesTotal: 0,
  dangerRulesOn: 0,
  blockCount: 0,
  riskHits: 0,
  kbRules: 0,
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
  for (const key of ['blockDangerous', 'enableI18n']) {
    if (typeof saved[key] === 'boolean') state[key] = saved[key];
  }
  if (Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536) state.port = saved.port;
} catch (_) {}

let quitting = false;
let launchedClient = null;

function quitApp(reason) {
  if (quitting) return;
  quitting = true;
  logToGUI('SYSTEM', '正在退出: ' + reason, 'tag-warn');
  try {
    const c = cleanupInjectedAsk();
    if (c && c.removed) {
      logToGUI('SECURITY', `已清理注入的 ASK ${c.removed} 条${c.restored ? '，并恢复注入前策略' : ''}`, 'tag-proxy');
    }
  } catch (e) {}
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

// ── AgentGuard 病毒库（EAS 特征）：命中 Ask 时旁路给风险处方 ──
let agentGuardRules = [];
function loadAgentGuardSignatures() {
  agentGuardRules = [];
  const candidates = [
    // 源文件优先（dist 可能是旧编译产物）
    path.join(ROOT_DIR, 'Agentguard-dev', 'src', 'rules', 'signatures.json'),
    path.join(ROOT_DIR, 'knowledge', 'signatures.json'),
    path.join(ROOT_DIR, 'Agentguard-dev', 'dist', 'rules', 'signatures.json')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(data.rules)) {
        agentGuardRules = data.rules.filter(r => r && r.pattern);
        break;
      }
    } catch (e) {}
  }
  state.kbRules = agentGuardRules.length;
  return agentGuardRules;
}

function normalizeRiskLevel(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical' || s === 'high' || s === '高') return 'high';
  if (s === 'medium' || s === 'med' || s === '中') return 'medium';
  if (s === 'low' || s === '低') return 'low';
  return 'medium';
}

function matchDangerRules(cmd) {
  if (!cmd || dangerRules.enabled === false) return [];
  return dangerRules.rules
    .filter(r => r && r.pattern && r.enabled !== false)
    .map(r => {
      try {
        if (new RegExp(r.pattern, r.flags || 'i').test(cmd)) {
          return {
            id: r.id,
            name: r.name,
            severity: normalizeRiskLevel(r.severity),
            source: 'danger-rules',
            root_cause: r.description || r.name || ''
          };
        }
      } catch (e) {}
      return null;
    })
    .filter(Boolean);
}

function matchKnowledgeBase(cmd) {
  if (!cmd || !agentGuardRules.length) return [];
  const hits = [];
  for (const r of agentGuardRules) {
    try {
      const re = new RegExp(r.pattern, r.flags || 'i');
      if (re.test(cmd)) {
        hits.push({
          id: r.id,
          name: r.name,
          severity: normalizeRiskLevel(r.severity),
          category: r.category || '',
          source: 'eas',
          root_cause: r.root_cause || '',
          destructive_impact: r.destructive_impact || '',
          safe_alternative: r.safe_alternative || ''
        });
      }
    } catch (e) {}
  }
  return hits;
}

/** 合并 danger-rules + EAS，给出最高风险等级与最佳处方 */
function assessCommandRisk(cmd) {
  const dHits = matchDangerRules(cmd);
  const kHits = matchKnowledgeBase(cmd);
  const all = [...dHits, ...kHits];
  if (!all.length) return null;
  const order = { high: 3, medium: 2, low: 1 };
  let level = 'low';
  for (const h of all) {
    if ((order[h.severity] || 0) > (order[level] || 0)) level = h.severity;
  }
  // 优先带完整处方的 EAS 条目
  const primary = kHits[0] || dHits[0];
  return {
    level,
    levelLabel: { high: '高风险', medium: '中风险', low: '低风险' }[level] || level,
    primary,
    danger: dHits.map(h => ({ id: h.id, name: h.name, severity: h.severity })),
    eas: kHits.slice(0, 3).map(h => ({
      id: h.id,
      name: h.name,
      severity: h.severity,
      root_cause: h.root_cause,
      destructive_impact: h.destructive_impact,
      safe_alternative: h.safe_alternative
    }))
  };
}

let translationDict = {};

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
}

let sseClients = [];
let logBuffer = [];
let logHistory = [];
if (debugMode) logToGUI('DEBUG', '调试模式已开启', 'tag-i18n');

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
    blockCount: state.blockCount,
    riskHits: state.riskHits
  });
  sseClients.forEach(res => res.write(`data: ${payload}\n\n`));
}

function pushDangerRules() {
  const payload = JSON.stringify({
    dangerRules: true,
    dangerRulesOn: state.dangerRulesOn,
    dangerRulesTotal: state.dangerRulesTotal
  });
  sseClients.forEach(res => res.write(`data: ${payload}\n\n`));
}

function popupGuiWindow() {
  if (TAURI_MODE) {
    try { process.stdout.write('popup\n'); } catch (e) {}
  }
}

let residentProcess = null;

function sendResident(cmd) {
  // Tauri 壳：走 stdout JSON 协议（托盘/胶囊由 Tauri 实现）
  if (TAURI_MODE) {
    try {
      process.stdout.write(JSON.stringify(cmd) + '\n');
    } catch (e) {}
    return;
  }
  if (!residentProcess || !residentProcess.stdin || residentProcess.stdin.destroyed) {
    initResidentHelper();
  }
  if (residentProcess && residentProcess.stdin && !residentProcess.stdin.destroyed) {
    try {
      residentProcess.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (e) {}
  }
}

function initResidentHelper() {
  // Tauri 一体壳不再拉起 C# Resident（托盘+胶囊均由 Tauri 负责）
  if (TAURI_MODE || TEST_MODE || !IS_WIN) return;
  const candidatePaths = [
    path.join(__dirname, 'assets', 'EasyAG-Resident.exe'),
    path.join(__dirname, 'scripts', 'resident', 'EasyAG-Resident.exe'),
    path.join(__dirname, '..', 'assets', 'EasyAG-Resident.exe')
  ];
  const exePath = candidatePaths.find(p => fs.existsSync(p));
  if (!exePath) return;

  try {
    residentProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    sendResident({ cmd: 'init', port: (server && server.address() && server.address().port) || GUI_PORT, ea_pid: process.pid });

    let stdoutBuffer = '';
    residentProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed);
          handleResidentEvent(ev);
        } catch (e) {}
      }
    });

    residentProcess.on('exit', () => {
      residentProcess = null;
    });

    logToGUI('SYSTEM', '✓ EasyAG 后台托盘驻留与灵动胶囊引擎已就绪', 'tag-proxy');
  } catch (e) {
    logToGUI('SYSTEM', `托盘驻留组件启动异常: ${e.message}`, 'tag-warn');
  }
}

function handleResidentEvent(ev) {
  if (!ev || !ev.event) return;
  if (ev.event === 'tray_open' || ev.event === 'request_popup') {
    popupGuiWindow();
  } else if (ev.event === 'capsule_action') {
    for (const [, entry] of cdpSockets) {
      if (entry.ws.readyState === WebSocket.OPEN) {
        cdpSend(entry.ws, 'Page.bringToFront', {});
      }
    }
  } else if (ev.event === 'tray_exit') {
    quitApp('系统托盘选择退出');
  }
}

function cleanupLegacyDll() {
  if (TEST_MODE || !IS_WIN || !fs.existsSync(APP_DIR)) return;
  const legacyDll = path.join(APP_DIR, 'version.dll');
  if (fs.existsSync(legacyDll)) {
    try {
      const disabledPath = path.join(APP_DIR, 'version.dll.easyag-disabled');
      fs.renameSync(legacyDll, disabledPath);
      logToGUI('PROXY', '已自动隔离旧版遗留的 version.dll 注入组件', 'tag-proxy');
    } catch (e) {}
  }
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
  if (state.port === newPort) return;
  state.port = newPort;
  logToGUI('PROXY', `本地代理端口已更新为: ${newPort}`, 'tag-proxy');
}

function generateMasterInjectScript() {
  // CDP：汉化 + 审批卡风险旁路（只读，不点击）
  const dictJSON = JSON.stringify(translationDict);
  return `(() => {
    window.__ea_config = Object.assign(window.__ea_config || {}, {
      enableI18n: ${state.enableI18n}
    });
    window.__ea_dict = ${dictJSON};

    function translateDOM(root) {
      if (!window.__ea_config.enableI18n || !window.__ea_dict || !root) return;
      const dict = window.__ea_dict;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim()) continue;
        const key = raw.trim();
        if (node.__ea_translated === raw) continue;
        if (dict[key] && dict[key] !== key) {
          node.nodeValue = dict[key];
          node.__ea_translated = node.nodeValue;
        }
      }
    }

    function extractCmd(card) {
      if (!card) return '';
      // 优先 run-command-step（旧版已验证的选择器），避免抓到选项 radio 文案
      let steps = [];
      if (card.getAttribute && card.getAttribute('data-testid') === 'run-command-step') {
        steps = [card];
      } else if (card.querySelectorAll) {
        steps = Array.from(card.querySelectorAll('[data-testid="run-command-step"]'));
      }
      if (!steps.length && card.closest) {
        const host = card.closest('[role="dialog"], [role="alertdialog"], [data-testid*="interaction"], [data-testid*="approval"], [data-testid*="permission"]') || card.parentElement;
        if (host && host.querySelectorAll) {
          steps = Array.from(host.querySelectorAll('[data-testid="run-command-step"]'));
        }
      }
      for (let i = steps.length - 1; i >= 0; i--) {
        const t = (steps[i].innerText || steps[i].textContent || '').trim();
        if (t && t.length < 2000) return t;
      }
      // 次选：命令相关 testid / code，不碰 radiogroup
      const sel = '[data-testid*="command"], [data-testid*="cmd"], code, pre';
      const nodes = (card.querySelectorAll && card.querySelectorAll(sel)) || [];
      for (const c of nodes) {
        if (c.closest('[role="radiogroup"], [role="listbox"]')) continue;
        const t = (c.innerText || c.textContent || '').trim();
        if (t && t.length < 2000 && !/^(allow|deny|ask|允许|拒绝|this time|always)/i.test(t)) return t;
      }
      return '';
    }

    // 只读扫描审批/Ask 卡，上报命令供主进程做风险分级（不点按钮）
    function scanRiskCards() {
      const seen = window.__ea_risk_seen || (window.__ea_risk_seen = new WeakSet());
      const roots = document.querySelectorAll('[data-testid="run-command-step"], [role="radiogroup"], [role="dialog"], [data-testid*="interaction"], [data-testid*="approval"], [data-testid*="permission"]');
      for (const root of roots) {
        const txt = (root.innerText || '').toLowerCase();
        const isAsk = txt.includes('allow') || txt.includes('允许') || txt.includes('ask') || txt.includes('询问') || txt.includes('approve')
          || (root.getAttribute && root.getAttribute('data-testid') === 'run-command-step');
        if (!isAsk || seen.has(root)) continue;
        seen.add(root);
        const cmd = extractCmd(root);
        if (!cmd) continue;
        if (/^(allow|deny|ask|允许|拒绝)/i.test(cmd.trim())) continue;
        console.log('[EA_RISK_CMD] ' + cmd);
      }
    }

    if (!window.__ea_i18n_installed) {
      window.__ea_i18n_installed = true;
      const obs = new MutationObserver((muts) => {
        if (window.__ea_config && window.__ea_config.enableI18n) {
          for (const m of muts) {
            if (m.type === 'childList') {
              m.addedNodes && m.addedNodes.forEach(n => {
                if (n.nodeType === 1) translateDOM(n);
                else if (n.nodeType === 3 && n.parentElement) translateDOM(n.parentElement);
              });
            } else if (m.type === 'characterData' && m.target && m.target.parentElement) {
              translateDOM(m.target.parentElement);
            }
          }
        }
        try { scanRiskCards(); } catch (e) {}
      });
      obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      if (document.body) translateDOM(document.body);
      setInterval(() => { try { scanRiskCards(); } catch (e) {} }, 1500);
    } else {
      if (window.__ea_config && window.__ea_config.enableI18n) translateDOM(document.body || document.documentElement);
      try { scanRiskCards(); } catch (e) {}
    }
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
      blockDangerous: ${state.blockDangerous},
      enableI18n: ${state.enableI18n}
    });
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
                if (text.includes('[EA_RISK_CMD]')) {
                  const cmd = text.replace('[EA_RISK_CMD]', '').trim().slice(0, 240);
                  const risk = assessCommandRisk(cmd);
                  if (risk) {
                    state.riskHits += 1;
                    pushCounters();
                    const lvCls = risk.level === 'high' ? 'tag-alert' : risk.level === 'medium' ? 'tag-warn' : 'tag-i18n';
                    logToGUI('RISK', '[' + risk.levelLabel + '] ' + cmd.slice(0, 100), lvCls);
                    if (risk.danger && risk.danger.length) {
                      logToGUI('RISK', '规则: ' + risk.danger.map(x => x.id + '(' + x.severity + ')').join(', '), 'tag-warn');
                    }
                    const prim = risk.primary || {};
                    if (prim.root_cause) logToGUI('RISK', '病理: ' + String(prim.root_cause).slice(0, 140), 'tag-warn');
                    if (prim.destructive_impact) logToGUI('RISK', '后果: ' + String(prim.destructive_impact).slice(0, 140), 'tag-warn');
                    if (prim.safe_alternative) logToGUI('RISK', '替代: ' + String(prim.safe_alternative).slice(0, 140), 'tag-proxy');
                    sendResident({
                      cmd: 'show_capsule',
                      type: risk.level === 'high' ? 'danger' : 'interaction',
                      title: risk.levelLabel + ' · ' + (prim.name || '命令待审'),
                      detail: String(prim.destructive_impact || prim.root_cause || '请人工确认').slice(0, 120)
                    });
                  } else {
                    logToGUI('ASK', '待审: ' + cmd.slice(0, 120), 'tag-warn');
                  }
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

// 将 danger-rules 正则编译为 Antigravity 官方 permission 资源（仅 target，禁止再包 command()）
// 副驾策略：高危正则默认注入 Ask（永远询问），不写死 Deny
// 语义：regex: 单 token = 整行 ^(?:…)$；用 .*(?:pat).* 还原 test() 部分匹配
// （逻辑与 scripts/rule-compile.cjs 保持一致，内联以免打包缺文件）
function compileJsPatternToOfficialTarget(jsPattern) {
  let p = String(jsPattern == null ? '' : jsPattern);
  if (!p) return '';
  p = p.replace(/([^\\]|^)\s+/g, (m, pre) => pre + '\\s+');
  p = p.replace(/^\s+/, '\\s+');
  return 'regex:.*(?:' + p + ').*';
}

function compileDangerRulesToOfficialTargets() {
  return getActiveDangerPatterns().map(p => compileJsPatternToOfficialTarget(p.pattern));
}

function findAntigravityPermissionFiles() {
  const home = os.homedir();
  const candidates = [path.join(home, '.gemini', 'config', 'config.json')];
  const projectsDir = path.join(home, '.gemini', 'config', 'projects');
  if (fs.existsSync(projectsDir)) {
    for (const f of fs.readdirSync(projectsDir)) {
      if (f.endsWith('.json')) candidates.push(path.join(projectsDir, f));
    }
  }
  return candidates.filter(p => fs.existsSync(p));
}

function getGlobalConfigPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'config.json');
}

// EasyAG 注入清单：只回滚我们写入的条目，不动用户自己的 grant
const INJECTED_FILE = () => path.join(DATA_DIR, 'injected-ask.json');

function readInjectedManifest() {
  try {
    return JSON.parse(fs.readFileSync(INJECTED_FILE(), 'utf-8'));
  } catch (e) {
    return { resources: [], savedGlobal: null };
  }
}
function writeInjectedManifest(m) {
  fs.writeFileSync(INJECTED_FILE(), JSON.stringify(m, null, 2), 'utf-8');
}

function stripDoubleWrap(s) {
  if (typeof s !== 'string') return s;
  if (s.startsWith('command(command(') && s.endsWith('))')) {
    return 'command(' + s.slice('command(command('.length, -2) + ')';
  }
  return s;
}

function injectRulesIntoConfig(obj, targets, listName) {
  // listName: 'ask' | 'deny' | 'allow'
  let changed = false;
  const uniq = Array.from(new Set(targets));
  const cleaned = uniq.map(t => t.replace(/^command\((.*)\)$/s, '$1'));
  const resources = cleaned.map(c => 'command(' + c + ')');

  function ensureList(host) {
    if (!host || typeof host !== 'object') return null;
    const isPermHost = host.allow !== undefined || host.ask !== undefined || host.deny !== undefined;
    if (!isPermHost && !Array.isArray(host[listName])) return null;
    if (!Array.isArray(host[listName])) host[listName] = [];
    return host[listName];
  }

  function mergeInto(host) {
    const list = ensureList(host);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const fixed = stripDoubleWrap(list[i]);
      if (fixed !== list[i]) {
        list[i] = fixed;
        changed = true;
      }
    }
    for (const r of resources) {
      if (!list.includes(r)) {
        list.push(r);
        changed = true;
      }
    }
  }

  if (obj && obj.userSettings && obj.userSettings.globalPermissionGrants) {
    mergeInto(obj.userSettings.globalPermissionGrants);
  }
  if (obj && obj.permissionGrants) {
    if (obj.permissionGrants.permissionGrants) mergeInto(obj.permissionGrants.permissionGrants);
    else mergeInto(obj.permissionGrants);
  }
  return changed;
}

/**
 * 把 danger-rules 注入官方 ASK。默认只写**全局**（所有项目生效）。
 * 写入的 resource 记入 injected-ask.json，便于退出时精确回滚。
 */
function syncDangerRulesToAntigravity(listName = 'ask', scope = 'global') {
  loadDangerRules();
  const targets = compileDangerRulesToOfficialTargets();
  if (!targets.length) return { ok: false, error: '没有可用的高危规则' };
  const resources = targets.map(t => {
    const cleaned = t.replace(/^command\((.*)\)$/s, '$1');
    return 'command(' + cleaned + ')';
  });

  const files = scope === 'all'
    ? findAntigravityPermissionFiles()
    : [getGlobalConfigPath()].filter(p => fs.existsSync(p));

  const updated = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const obj = JSON.parse(raw);
      if (injectRulesIntoConfig(obj, targets, listName)) {
        fs.writeFileSync(file, JSON.stringify(obj, null, 2));
        updated.push(file);
      }
    } catch (e) {}
  }

  // 登记清单（合并历史，去重）
  const manifest = readInjectedManifest();
  manifest.list = listName;
  manifest.scope = scope;
  manifest.resources = Array.from(new Set([...(manifest.resources || []), ...resources]));
  manifest.at = new Date().toISOString();
  if (!manifest.savedGlobal) {
    try {
      const cfg = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
      const us = cfg.userSettings || {};
      manifest.savedGlobal = {
        autoExecutionPolicy: us.autoExecutionPolicy,
        nonWorkspaceFileAccessPolicy: us.nonWorkspaceFileAccessPolicy,
        fileAccessPolicy: us.fileAccessPolicy,
        enableTerminalSandbox: us.enableTerminalSandbox
      };
    } catch (e) {}
  }

  // 副驾组合：Turbo（自动放行）+ ASK（高危必停）
  try {
    const file = getGlobalConfigPath();
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    cfg.userSettings = cfg.userSettings || {};
    cfg.userSettings.autoExecutionPolicy = 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER';
    cfg.userSettings.nonWorkspaceFileAccessPolicy = 'AGENT_SETTING_POLICY_ALLOW';
    cfg.userSettings.fileAccessPolicy = 'AGENT_SETTING_POLICY_ALLOW';
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
    manifest.turboApplied = true;
  } catch (e) {}

  writeInjectedManifest(manifest);

  return {
    ok: true,
    count: resources.length,
    files: updated,
    sample: resources.slice(0, 3),
    list: listName,
    scope,
    turbo: manifest.turboApplied !== false
  };
}

/** 退出清理：只移除 EasyAG 写入的 ASK，并恢复注入前的全局策略 */
function cleanupInjectedAsk() {
  const manifest = readInjectedManifest();
  const resources = manifest.resources || [];
  if (!resources.length) {
    try { fs.unlinkSync(INJECTED_FILE()); } catch (e) {}
    return { ok: true, removed: 0, restored: false };
  }
  let removed = 0;
  try {
    const file = getGlobalConfigPath();
    const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const host = obj.userSettings && obj.userSettings.globalPermissionGrants;
    if (host && Array.isArray(host.ask)) {
      const before = host.ask.length;
      host.ask = host.ask.filter(x => !resources.includes(x));
      removed = before - host.ask.length;
      // 顺带清历史双重包裹
      host.ask = host.ask.map(stripDoubleWrap);
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
    }
  } catch (e) {}

  let restored = false;
  if (manifest.savedGlobal) {
    try {
      const file = getGlobalConfigPath();
      const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
      obj.userSettings = obj.userSettings || {};
      for (const k of ['autoExecutionPolicy', 'nonWorkspaceFileAccessPolicy', 'fileAccessPolicy', 'enableTerminalSandbox']) {
        if (manifest.savedGlobal[k] !== undefined) obj.userSettings[k] = manifest.savedGlobal[k];
      }
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
      restored = true;
    } catch (e) {}
  }

  try { fs.unlinkSync(INJECTED_FILE()); } catch (e) {}
  return { ok: true, removed, restored };
}

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
  if (req.url === '/api/kb' && req.method === 'GET') {
    return res.end(JSON.stringify({
      count: agentGuardRules.length,
      rules: agentGuardRules.map(r => ({
        id: r.id,
        name: r.name,
        severity: r.severity,
        category: r.category,
        root_cause: r.root_cause,
        destructive_impact: r.destructive_impact,
        safe_alternative: r.safe_alternative
      }))
    }));
  }
  if (req.url === '/api/injected' && req.method === 'GET') {
    const m = readInjectedManifest();
    return res.end(JSON.stringify({
      count: (m.resources || []).length,
      list: m.list || 'ask',
      scope: m.scope || 'global',
      at: m.at || null,
      resources: (m.resources || []).map(s => s.slice(0, 120))
    }));
  }
  // 全局 Turbo Pilot：Turbo + ASK + Hooks
  if (req.url === '/api/pilot/global' && req.method === 'POST') {
    try {
      const result = syncDangerRulesToAntigravity('ask', 'global');
      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(result));
      }
      /* Hooks 默认不安装（会卡住 AG 命令闸门）；需要时手动 install-hooks.cjs */
      logToGUI('SECURITY', `全局 Turbo Pilot：${result.count} 条 ASK + Turbo 已就绪`, 'tag-proxy');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(Object.assign({ ok: true }, result)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }
  // 仅当前项目：项目级 ASK + 项目 Turbo
  if (req.url === '/api/pilot/project' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const key = data.project || data.id || 'EasyAntigravity';
        const targets = compileDangerRulesToOfficialTargets();
        const resources = targets.map(t => {
          const cleaned = t.replace(/^command\((.*)\)$/s, '$1');
          return 'command(' + cleaned + ')';
        });
        // 定位项目文件
        const projectsDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
        let projectFile = null;
        if (fs.existsSync(projectsDir)) {
          for (const f of fs.readdirSync(projectsDir).filter(x => x.endsWith('.json'))) {
            try {
              const obj = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf-8'));
              if (obj.id === key || obj.name === key) {
                projectFile = path.join(projectsDir, f);
                obj.settings = obj.settings || {};
                obj.settings.autoExecutionPolicy = 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER';
                obj.settings.fileAccessPolicy = 'AGENT_SETTING_POLICY_ALLOW';
                obj.settings.nonWorkspaceFileAccessPolicy = 'AGENT_SETTING_POLICY_ALLOW';
                injectRulesIntoConfig(obj, targets, 'ask');
                fs.writeFileSync(projectFile, JSON.stringify(obj, null, 2), 'utf-8');
                break;
              }
            } catch (e) {}
          }
        }
        if (!projectFile) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'project not found: ' + key }));
        }
        /* Hooks 默认不安装（会卡住 AG 命令闸门）；需要时手动 install-hooks.cjs */
        logToGUI('SECURITY', `项目「${key}」已配置 Turbo + ASK ${resources.length} 条`, 'tag-proxy');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, count: resources.length, project: key, file: projectFile }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.url === '/api/agent-event' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (data.type === 'stop') {
          handleAgentStop(data.terminationReason, data.fullyIdle);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        if (data.type === 'pre_tool') {
          const cmd = String(data.command || '');
          const risk = assessCommandRisk(cmd);
          // 副驾策略：命中风险 → force_ask（Turbo 下也停下问人）；干净命令放行
          let decision = 'allow';
          if (risk) {
            decision = 'force_ask';
            const lvCls = risk.level === 'high' ? 'tag-alert' : risk.level === 'medium' ? 'tag-warn' : 'tag-i18n';
            logToGUI('RISK', `[${risk.levelLabel}] ${cmd.slice(0, 100)}`, lvCls);
            if (risk.danger && risk.danger.length) {
              logToGUI('RISK', '规则: ' + risk.danger.map(x => x.id + '(' + x.severity + ')').join(', '), 'tag-warn');
            }
            const p = risk.primary || {};
            if (p.root_cause) logToGUI('RISK', '病理: ' + String(p.root_cause).slice(0, 160), 'tag-warn');
            if (p.destructive_impact) logToGUI('RISK', '后果: ' + String(p.destructive_impact).slice(0, 160), 'tag-warn');
            if (p.safe_alternative) logToGUI('RISK', '替代: ' + String(p.safe_alternative).slice(0, 160), 'tag-proxy');
            state.riskHits += 1;
            pushCounters();
            sendResident({
              cmd: 'show_capsule',
              type: risk.level === 'high' ? 'danger' : 'interaction',
              title: risk.levelLabel + ' · ' + (p.name || '命令待审'),
              detail: String(p.destructive_impact || p.root_cause || '请人工确认后再放行').slice(0, 120)
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, decision, risk }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (req.url === '/api/danger-rules/reload' && req.method === 'POST') {
    loadDangerRules();
    pushDangerRules();
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
  if (req.url === '/api/danger-rules/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        let listName = 'ask';
        let scope = 'global';
        try {
          const data = JSON.parse(body || '{}');
          if (data.list === 'deny' || data.list === 'ask' || data.list === 'allow') listName = data.list;
          if (data.scope === 'global' || data.scope === 'all') scope = data.scope;
        } catch (_) {}
        const result = syncDangerRulesToAntigravity(listName, scope);
        if (!result.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(result));
        }
        logToGUI('SECURITY', `已注入 ${result.count} 条高危 ${listName.toUpperCase()}（${scope === 'global' ? '全局' : '全局+项目'}，${result.files.length} 个文件）`, 'tag-proxy');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(result));
      } catch (e) {
        logToGUI('SECURITY', '注入 ASK 异常: ' + (e && e.message ? e.message : e), 'tag-alert');
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.url === '/api/danger-rules/cleanup' && req.method === 'POST') {
    try {
      const result = cleanupInjectedAsk();
      logToGUI('SECURITY', `已清理 EasyAG 注入的 ASK ${result.removed} 条${result.restored ? '，策略已恢复' : ''}`, 'tag-proxy');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(result));
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
    return res.end(JSON.stringify(Object.assign({}, state, {
      kbRules: agentGuardRules.length,
      injectedCount: (readInjectedManifest().resources || []).length
    })));
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
            if (portNum !== state.port) {
              syncProxyPort(portNum);
            }
          } else {
            logToGUI('PROXY', `非法端口输入 [${data.port}]，已忽略`, 'tag-warn');
          }
        }

        const prevBlockDangerous = state.blockDangerous;
        const prevI18n = state.enableI18n;

        if (typeof data.blockDangerous === 'boolean') state.blockDangerous = data.blockDangerous;
        if (typeof data.enableI18n === 'boolean') state.enableI18n = data.enableI18n;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ port: state.port, blockDangerous: state.blockDangerous, enableI18n: state.enableI18n }, null, 2));

        if (typeof data.blockDangerous === 'boolean' && data.blockDangerous !== prevBlockDangerous) {
          logToGUI('SECURITY', state.blockDangerous ? '高危指令监控已开启' : '高危指令监控已停用', 'tag-proxy');
        }
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
    logToGUI('PROXY', `原生代理已就绪：Chromium + language_server 使用 HTTP 代理 127.0.0.1:${state.port}，本地回环直连`, 'tag-proxy');

    if (state.enableI18n) logToGUI('I18N', `已装载汉化引擎 (${state.dictEntries} 条词条)`, 'tag-i18n');

    // 若已在跑，只提示刷新，不重复 spawn
    if (state.clientRunning) {
      logToGUI('SYSTEM', '客户端已在运行，CDP 界面接管通道保持重试', 'tag-warn');
      pushClientStatus();
      res.end('ok');
      return;
    }

    const launch = buildNativeProxyLaunch();
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
    logToGUI('SYSTEM', '✓ Antigravity 已以原生代理模式启动，CDP 接管就绪', 'tag-proxy');
    pushClientStatus();

    // 自动隐藏 EasyAG 窗口至托盘，转为后台静默
    sendResident({ cmd: 'hide_easyag' });
    if (child && child.pid) {
      sendResident({ cmd: 'set_ag_pid', ag_pid: child.pid });
    }

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

  if (req.url === '/api/hide' && req.method === 'POST') {
    sendResident({ cmd: 'hide_easyag' });
    res.end('ok');
    return;
  }

  // 未知路由必须结束响应，避免前端 fetch 永久挂起
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found', url: req.url }));
});

loadDictionaries();
loadDangerRules();
loadAgentGuardSignatures();

// ── 官方 Hooks：Stop（任务完成）+ PreToolUse（危险命令） ──
function installStopHook() {
  try {
    const nodeBin = process.execPath;
    const hooksDir = path.join(os.homedir(), '.gemini', 'config');
    const hooksPath = path.join(hooksDir, 'hooks.json');
    try { fs.writeFileSync(path.join(DATA_DIR, 'gui-port.txt'), String(server.address() ? server.address().port : GUI_PORT), 'utf8'); } catch (e) {}

    const scripts = [
      { src: 'easyag-stop-hook.cjs', name: 'easyag-stop-hook.cjs' },
      { src: 'easyag-pretool-hook.cjs', name: 'easyag-pretool-hook.cjs' }
    ];
    const installed = {};
    for (const s of scripts) {
      const src = path.join(ROOT_DIR, 'scripts', s.src);
      const dst = path.join(DATA_DIR, s.name);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      installed[s.name] = dst;
    }

    let hooks = {};
    try { hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8')); } catch (e) {}

    if (installed['easyag-stop-hook.cjs']) {
      hooks['easyag-task-done'] = {
        enabled: true,
        Stop: [{
          type: 'command',
          command: '"' + nodeBin + '" "' + installed['easyag-stop-hook.cjs'] + '"',
          timeout: 5
        }]
      };
    }
    if (installed['easyag-pretool-hook.cjs']) {
      hooks['easyag-danger-gate'] = {
        enabled: true,
        PreToolUse: [{
          matcher: 'run_command',
          hooks: [{
            type: 'command',
            command: '"' + nodeBin + '" "' + installed['easyag-pretool-hook.cjs'] + '"',
            timeout: 5
          }]
        }]
      };
    }
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2), 'utf8');
    logToGUI('SYSTEM', '已安装官方 Hooks：Stop（任务完成）+ PreToolUse（危险门禁）', 'tag-proxy');
    return { ok: true, hooksPath };
  } catch (e) {
    logToGUI('SYSTEM', 'Hook 安装失败: ' + e.message, 'tag-warn');
    return { ok: false, error: String(e.message || e) };
  }
}

// 标记：Stop Hook 已上报过近期结束，抑制 CDP 路径重复弹
let lastAgentStopAt = 0;
function handleAgentStop(reason, fullyIdle) {
  lastAgentStopAt = Date.now();
  if (fullyIdle === false) {
    logToGUI('TASK', '执行环停止，但后台任务仍在运行', 'tag-warn');
    sendResident({
      cmd: 'show_capsule',
      type: 'interaction',
      title: '等待后台任务',
      detail: 'Agent 已停，但仍有后台命令在跑。'
    });
    return;
  }
  logToGUI('TASK', '本轮任务完成（' + (reason || 'stop') + '）', 'tag-proxy');
  sendResident({
    cmd: 'show_capsule',
    type: 'ready',
    title: '任务完成',
    detail: reason === 'error' ? '异常终止，请检查日志。' : 'Agent 已空闲，结果可检视或开始下一轮。'
  });
  sendResident({
    cmd: 'show_capsule',
    type: 'ready',
    title: '任务完成',
    detail: reason === 'error' ? '异常终止，请检查日志。' : 'Agent 已空闲，结果可检视或开始下一轮。'
  });
}

// 首次启动：把高危正则注入**全局** Ask（所有项目生效，Turbo 下仍会询问）
try {
  const flag = path.join(DATA_DIR, 'ask-injected.flag');
  const manifest = readInjectedManifest();
  const already = (manifest.resources || []).length > 0;
  if (!fs.existsSync(flag) && !already) {
    const r = syncDangerRulesToAntigravity('ask', 'global');
    if (r && r.ok) {
      fs.writeFileSync(flag, new Date().toISOString());
      logToGUI('SECURITY', `首次启动：已向全局注入 ${r.count} 条高危 ASK（退出时自动清理）`, 'tag-proxy');
    }
  }
} catch (e) {}

async function tryAttachExistingClient() {
  try {
    const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (!Array.isArray(targets) || !targets.length) return false;
    state.clientRunning = true;
    logToGUI('SYSTEM', '检测到 Antigravity 已在运行，自动接管其界面', 'tag-proxy');
    startCDPLoop();
    if (IS_WIN) {
      exec('tasklist /FI "IMAGENAME eq Antigravity.exe" /FO CSV /NH', { windowsHide: true }, (err, stdout) => {
        if (!err && stdout) {
          const match = stdout.match(/"Antigravity\.exe","(\d+)"/i);
          if (match && match[1]) {
            sendResident({ cmd: 'set_ag_pid', ag_pid: parseInt(match[1], 10) });
          }
        }
      });
    }
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
  cleanupLegacyDll();
  initResidentHelper();
  const boundPort = server.address().port;
  try { fs.writeFileSync(path.join(DATA_DIR, 'gui-port.txt'), String(boundPort), 'utf8'); } catch (e) {}
  /* Hooks 默认不安装（会卡住 AG 命令闸门）；需要时手动 install-hooks.cjs */
  logToGUI('SECURITY', `高危规则已加载: ${state.dangerRulesOn}/${state.dangerRulesTotal} 条生效`, 'tag-proxy');
  if (TAURI_MODE) {
    const ready = { port: boundPort, pid: process.pid };
    const readyFile = normalizePath(process.env.EASYAG_READY_FILE);
    if (readyFile) fs.writeFileSync(readyFile, JSON.stringify(ready));
  } else openGuiWindow();
  // AG 可能先于 EasyAG 启动：探测 9333 并自动接管
  if (!TEST_MODE) setTimeout(() => { tryAttachExistingClient(); }, 500);
});
