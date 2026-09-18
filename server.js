const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');

const GUI_PORT = 19823;
const CDP_PORT = 9333;

// pkg 打包后 __dirname 指向虚拟内存，需锚定 exe 实际所在目录
const ROOT_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const LOCK_FILE = path.join(ROOT_DIR, 'easyag.lock');

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
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const la = process.env.LOCALAPPDATA || '';

  // ── 1. Chromium 内核浏览器 (App 模式) ──
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
          exec(`start "" "${p}" "${url}"`);
        } else {
          exec(`start "" "${p}" --app=${url} --force-dark-mode`);
        }
        logToGUI('SYSTEM', `GUI 已通过 ${browser.name}${browser.noAppMode ? '' : ' 应用模式'}打开`, 'tag-proxy');
        return true;
      } catch (e) {}
    }
  }

  // ── 3. 系统默认浏览器（仅调用，不修改默认设置） ──
  try {
    exec(`start "" "${url}"`);
    logToGUI('SYSTEM', '已调用系统默认浏览器打开 GUI（未修改默认浏览器设置）', 'tag-warn');
    return true;
  } catch (e) {}

  // ── 4. PowerShell WinForms 兜底 (IE 内核，样式可能降级) ──
  try {
    const psCmd = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `$f=New-Object Windows.Forms.Form`,
      `$f.Text='EasyAntigravity';$f.Size=New-Object Drawing.Size(490,760)`,
      `$f.StartPosition='CenterScreen';$f.BackColor=[Drawing.Color]::FromArgb(18,19,25)`,
      `$w=New-Object Windows.Forms.WebBrowser`,
      `$w.Url='${url}';$w.Dock='Fill'`,
      `$f.Controls.Add($w)`,
      `$f.Add_Shown({$f.Activate()})`,
      `[Windows.Forms.Application]::Run($f)`
    ].join(';');
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${psCmd.replace(/"/g, '\\"')}"`);
    logToGUI('SYSTEM', 'GUI 已通过内置渲染兜底窗口打开（样式可能降级）', 'tag-warn');
    return true;
  } catch (e) {}

  // ── 5. 终极兜底：输出地址 ──
  logToGUI('SYSTEM', `无法自动打开 GUI，请手动在任意浏览器访问: ${url}`, 'tag-alert');
  return false;
}

function focusExistingGui() {
  try { openGuiWindow(); } catch (e) {}
}

// 双击 exe 会挂控制台：windowsHide 重启自身并退出，避免黑框
// 已有实例时不再拉起新进程
if (process.platform === 'win32' && !process.env.EASYAG_NOCONSOLE) {
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
if (alreadyRunning()) {
  focusExistingGui();
  process.exit(0);
}

try {
  process.removeAllListeners('warning');
  process.on('warning', () => {});
  process.env.NODE_NO_WARNINGS = '1';
} catch (e) {}

const HTML_FILE = path.join(ROOT_DIR, 'index.html');

const APP_DIR = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity');
const APP_EXE = path.join(APP_DIR, 'Antigravity.exe');
const BACKUP_DIR = path.join(ROOT_DIR, 'backup');
const BACKUP_DLL = path.join(BACKUP_DIR, 'version.dll');
const BACKUP_JSON = path.join(BACKUP_DIR, 'config.json');
const TARGET_DLL = path.join(APP_DIR, 'version.dll');
const TARGET_JSON = path.join(APP_DIR, 'config.json');

const DICT_DIR = path.join(ROOT_DIR, 'dicts');
const RULES_FILE = path.join(ROOT_DIR, 'danger-rules.json');
const BACKUP_RULES = path.join(BACKUP_DIR, 'danger-rules.json');

let state = {
  port: 7890,
  autoAccept: true,
  blockDangerous: true,
  preferOption: 4,
  enableI18n: true,
  dictEntries: 0,
  patchOk: false,
  clientRunning: false,
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

// GUI 存活：关窗后应真正退出后台
let guiSeen = false;
let lastGuiAt = 0;
let quitting = false;

function touchGui() {
  guiSeen = true;
  lastGuiAt = Date.now();
}

function quitApp(reason) {
  if (quitting) return;
  quitting = true;
  state.clientRunning = false;
  for (const [, entry] of cdpSockets) {
    try { entry.ws.close(); } catch (e) {}
  }
  cdpSockets.clear();
  releaseLock();
  // 稍等 SSE 断开，避免日志写到已销毁的响应
  setTimeout(() => {
    process.exit(0);
  }, 80);
}

const DEFAULT_DANGER_RULES = [
  { id: 'rm-rf', name: '递归强制删除', pattern: '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)', flags: 'i', enabled: true },
  { id: 'windows-del', name: 'Windows 强制删除', pattern: '\\b(del|rd|rmdir)\\s+.*\\/[sqf]', flags: 'i', enabled: true },
  { id: 'disk-wipe', name: '磁盘破坏', pattern: '\\b(format|diskpart|mkfs|wipefs|shred)\\b', flags: 'i', enabled: true },
  { id: 'sql-drop', name: '数据库删除', pattern: '\\bdrop\\s+(database|table)\\b', flags: 'i', enabled: true },
  { id: 'git-force-push', name: 'Git 强制推送', pattern: '\\bgit\\s+push\\s+.*(-f|--force)\\b', flags: 'i', enabled: true },
  { id: 'shutdown', name: '关机/停止计算机', pattern: '\\b(shutdown|stop-computer)\\b', flags: 'i', enabled: true }
];

let dangerRules = { version: 1, enabled: true, rules: DEFAULT_DANGER_RULES };

function loadDangerRules() {
  const tryPaths = [RULES_FILE, BACKUP_RULES];
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
        // 自愈：主文件缺失时从备份写回
        if (p === BACKUP_RULES && !fs.existsSync(RULES_FILE)) {
          try { fs.copyFileSync(BACKUP_RULES, RULES_FILE); } catch (e) {}
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

function logToGUI(category, message, cls = '') {
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

function ensureProxyWatchdog() {
  if (!fs.existsSync(APP_DIR)) return false;
  let restored = false;
  if (!fs.existsSync(TARGET_DLL) && fs.existsSync(BACKUP_DLL)) {
    fs.copyFileSync(BACKUP_DLL, TARGET_DLL);
    restored = true;
  }
  if (!fs.existsSync(TARGET_JSON) && fs.existsSync(BACKUP_JSON)) {
    fs.copyFileSync(BACKUP_JSON, TARGET_JSON);
    restored = true;
  }
  if (fs.existsSync(BACKUP_JSON)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(BACKUP_JSON, 'utf-8'));
      if (cfg.proxy?.port) state.port = cfg.proxy.port;
    } catch (e) {}
  }
  state.patchOk = fs.existsSync(TARGET_DLL) && fs.existsSync(TARGET_JSON);
  return restored;
}

function syncProxyPort(newPort) {
  state.port = newPort;
  [BACKUP_JSON, TARGET_JSON].forEach(file => {
    if (fs.existsSync(file)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!cfg.proxy) cfg.proxy = {};
        cfg.proxy.port = newPort;
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
      } catch (e) {}
    }
  });
  logToGUI('PROXY', `SOCKS5 端口已同步更新为: ${newPort}`, 'tag-proxy');
}

function generateMasterInjectScript() {
  const dictJSON = JSON.stringify(translationDict);
  const patternsJSON = JSON.stringify(getActiveDangerPatterns());
  return `(() => {
    window.__ea_config = Object.assign(window.__ea_config || {}, {
      preferOption: ${state.preferOption},
      blockDangerous: ${state.blockDangerous},
      autoAccept: ${state.autoAccept},
      enableI18n: ${state.enableI18n}
    });
    window.__ea_dict = ${dictJSON};
    window.__ea_danger_patterns = ${patternsJSON};

    if (window.__ea_engine_running) return;
    window.__ea_engine_running = true;

    const DANGEROUS_PATTERNS = (window.__ea_danger_patterns || []).map(r => {
      try { return { id: r.id, name: r.name, re: new RegExp(r.pattern, r.flags || 'i') }; }
      catch (e) { return null; }
    }).filter(Boolean);

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
      const code = card.querySelector('pre, code, [data-testid="run-command-step"] pre');
      if (code && (code.innerText || code.textContent || '').trim()) {
        return (code.innerText || code.textContent || '').trim();
      }
      const step = card.querySelector('[data-testid="run-command-step"]');
      if (step) return (step.innerText || '').trim();
      return '';
    }

    // 日志用：单行短摘要
    function extractLogSummary(card, fallback) {
      const full = extractCommandText(card);
      if (full) {
        const lines = full.split('\\n').map(s => s.trim()).filter(Boolean);
        // 优先问句行，其次命令行
        const q = lines.find(l => /[?？]$/.test(l) && l.length < 120);
        const cmdLine = lines.find(l => !/[?？]$/.test(l) && l.length > 2);
        return oneLine(q || cmdLine || lines[0], 80);
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

    function tryApprove(btn, kind) {
      if (!btn || btn.disabled || btn.hasAttribute('data-ea-ok')) return false;
      const card = cardForSubmit(btn);
      if (window.__ea_config.blockDangerous) {
        const cmd = extractCommandText(card);
        if (cmd) {
          const hit = DANGEROUS_PATTERNS.find(r => r.re.test(cmd));
          if (hit) {
            btn.setAttribute('data-ea-ok', 'blocked');
            console.warn('[EA_ALERT] 拦截高危指令[' + hit.id + ']: ' + cmd.slice(0, 80));
            return true;
          }
        }
      }
      const optIdx = (window.__ea_config && window.__ea_config.preferOption) || 4;
      let optText = '';
      let picked = null;
      if (card) {
        const cands = collectOptionCands(card);
        if (cands.length) {
          const brief = cands.map(c => '#' + c.cls + (c.checked ? '*' : '') + oneLine(c.text, 36)).join(' | ');
          console.log('[EA_OPT] prefer=' + optIdx + ' · ' + oneLine(brief, 180));
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
      realClick(btn);
      const cmd = extractLogSummary(card, kind || (btn.innerText || ''));
      const optLabel = picked
        ? '选项[' + picked.cls + '] ' + optText
        : '无选项组';
      console.log('[EA_AA] 放行 · ' + optLabel + ' · ' + cmd);
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

    function translateDOM(root) {
      if (!window.__ea_config.enableI18n || !window.__ea_dict) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue.trim();
        if (text && window.__ea_dict[text]) {
          node.nodeValue = node.nodeValue.replace(text, window.__ea_dict[text]);
        }
      }
      const elements = root.querySelectorAll ? root.querySelectorAll('[placeholder], [title]') : [];
      elements.forEach(el => {
        const ph = el.getAttribute('placeholder');
        if (ph && window.__ea_dict[ph]) el.setAttribute('placeholder', window.__ea_dict[ph]);
        const title = el.getAttribute('title');
        if (title && window.__ea_dict[title]) el.setAttribute('title', window.__ea_dict[title]);
      });
    }

    setInterval(() => {
      function scan(doc) {
        translateDOM(doc);
        if (!window.__ea_config.autoAccept) return;

        // 1) AG 2.13 交互卡（运行命令 / 工具审批）：优先 data-testid
        const interactSubmit = doc.querySelector('button[data-testid="interaction-continue-button"]');
        if (interactSubmit && tryApprove(interactSubmit, '交互卡提交')) return;

        // 2) 权限卡片（收窄匹配，避免正文里的 permission/read files 误伤）
        const pageText = norm(doc.body ? doc.body.innerText : '');
        const permHit = /allow reading|yes, allow|允许访问|allow access|权限请求|请求权限|访问文件/.test(pageText)
          || (/(^|\\s)permission(\\s|$)/i.test(pageText) && /allow|允许|yes/i.test(pageText));
        if (permHit) {
          const cards = Array.from(doc.querySelectorAll('div, section, [role="dialog"], [role="alertdialog"]'));
          for (const card of cards) {
            const t = norm(card.innerText);
            if (!t || t.length > 2500) continue;
            if (!/allow reading|yes, allow|允许访问|allow access|permission|权限|访问文件/.test(t)) continue;
            const submitBtn = findSubmitBtn(card);
            if (submitBtn && tryApprove(submitBtn, '权限卡')) return;
          }
        }

        // 3) 关键字兜底
        const kws = ['run', 'accept', 'continue', 'always allow', 'allow', '运行', '接受', '继续', '始终允许', '允许', '确认', '提交'];
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

let lastStatusKey = '';
function pushClientStatus() {
  const alive = state.clientRunning && state.cdpSockets > 0;
  const status = !state.clientRunning
    ? '客户端未运行'
    : alive
      ? `运行中 · 引擎注入 ${state.cdpSockets}`
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
        !String(t.url || '').startsWith('devtools://') &&
        !String(t.url || '').startsWith('data:text/html')
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
            logToGUI('CDP', `已连接目标并注入: ${String(entry.title || entry.url).slice(0, 60)}`, 'tag-i18n');
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
                } else if (text.includes('[EA_ALERT]')) {
                  state.blockCount += 1;
                  logToGUI('SECURITY ALERT', text.replace('[EA_ALERT]', '').trim(), 'tag-alert');
                  pushCounters();
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
          if (entry.ws.readyState === WebSocket.OPEN) {
            // 周期重注入：刷新配置；若页面被 Reload 清掉引擎则重新拉起
            injectInto(entry.ws, 'tick');
          } else {
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
      // CDP 连续不可达（约 10s）：视为客户端已退出（覆盖 attach 模式无 child exit 的情况）
      if (state.cdpFailStreak >= 5) {
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
    touchGui();
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
    logToGUI('SECURITY', `高危规则已重载: ${state.dangerRulesOn}/${state.dangerRulesTotal} 条生效`, 'tag-proxy');
    return res.end(JSON.stringify({ ok: true, active: state.dangerRulesOn, total: state.dangerRulesTotal }));
  }
  if (req.url === '/api/danger-rules/open' && req.method === 'POST') {
    try {
      if (!fs.existsSync(RULES_FILE) && fs.existsSync(BACKUP_RULES)) {
        fs.copyFileSync(BACKUP_RULES, RULES_FILE);
      }
      if (!fs.existsSync(RULES_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'rules file missing' }));
      }
      // explorer 用系统默认程序打开 json，比 cmd start 更稳
      spawn('explorer.exe', [RULES_FILE], { detached: true, stdio: 'ignore' }).unref();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, path: RULES_FILE }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }
  if (req.url === '/api/status') {
    touchGui();
    ensureProxyWatchdog();
    return res.end(JSON.stringify(state));
  }
  if (req.url === '/api/quit' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    quitApp('收到退出请求');
    return;
  }
  if (req.url === '/api/events') {
    touchGui();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    sseClients.push(res);
    flushLogBuffer();
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
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

        if (typeof data.autoAccept === 'boolean') state.autoAccept = data.autoAccept;
        if (typeof data.blockDangerous === 'boolean') state.blockDangerous = data.blockDangerous;
        if (typeof data.enableI18n === 'boolean') state.enableI18n = data.enableI18n;
        if (data.preferOption) state.preferOption = data.preferOption;

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
    if (restored) logToGUI('PROXY', '检测到客户端更新抹除补丁，已自动从备份恢复！', 'tag-warn');
    else logToGUI('PROXY', '免 TUN 补丁校验通过', 'tag-proxy');

    if (state.enableI18n) logToGUI('I18N', `已装载汉化引擎 (${state.dictEntries} 条词条)`, 'tag-i18n');

    // 若已在跑，只提示刷新，不重复 spawn
    if (state.clientRunning) {
      logToGUI('SYSTEM', '客户端已在运行，CDP 注入通道保持重试', 'tag-warn');
      pushClientStatus();
      res.end('ok');
      return;
    }

    const child = spawn(APP_EXE, [`--remote-debugging-port=${CDP_PORT}`], { detached: true, stdio: 'ignore' });
    state.clientRunning = true;
    state.cdpError = '';
    state.cdpFailStreak = 0;
    logToGUI('SYSTEM', '✓ Antigravity 已启动，代理注入与 CDP 接管就绪', 'tag-proxy');
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
    logToGUI('SYSTEM', '检测到 Antigravity 已在运行，自动接管 CDP 注入', 'tag-proxy');
    startCDPLoop();
    return true;
  } catch (e) {
    return false;
  }
}

function writeCrashLog(msg) {
  try {
    fs.writeFileSync(path.join(ROOT_DIR, 'easyag-error.log'), String(msg), 'utf-8');
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

// 打开过 GUI 后：超过 8s 无任何 HTTP 活动（status/页面/SSE 真实流量）→ 关窗退出
// 不用 sseClients.length 判断：Edge 被杀后可能残留死连接
setInterval(() => {
  if (quitting || !guiSeen) return;
  if (lastGuiAt && Date.now() - lastGuiAt >= 8000) {
    quitApp('GUI 已关闭');
  }
}, 2000);

server.listen(GUI_PORT, '127.0.0.1', () => {
  try { fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8'); } catch (e) {}
  ensureProxyWatchdog();
  logToGUI('SECURITY', `高危规则已加载: ${state.dangerRulesOn}/${state.dangerRulesTotal} 条生效`, 'tag-proxy');
  openGuiWindow();
  // AG 可能先于 EasyAG 启动：探测 9333 并自动接管
  setTimeout(() => { tryAttachExistingClient(); }, 500);
});
