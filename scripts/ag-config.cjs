#!/usr/bin/env node
/**
 * AG Config Control — Antigravity 配置自动化（人机协作抓枚举 / 写规则 / 切模式）
 *
 * 用法:
 *   node scripts/ag-config.cjs snapshot [label]
 *   node scripts/ag-config.cjs diff <a.json> <b.json>
 *   node scripts/ag-config.cjs show
 *   node scripts/ag-config.cjs set-mode <off|eager|...> [--project <id|name>]
 *   node scripts/ag-config.cjs set-rules <ask|deny|allow> <target> [--project <id|name>] [--global]
 *   node scripts/ag-config.cjs clear-rules <ask|deny|allow> [--project <id|name>] [--global]
 *   node scripts/ag-config.cjs verify
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI = path.join(os.homedir(), '.gemini');
const CONFIG = path.join(GEMINI, 'config', 'config.json');
const PROJECTS = path.join(GEMINI, 'config', 'projects');
const SNAP_DIR = path.join(__dirname, '..', '.playwright-cli', 'ag-snapshots');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Local Permissions 五项（UI） ↔ 权限资源 action（JSON）
 * 由用户在 AG 项目设置中确认（2026-09-25）:
 *   File Access Rules          → read_file / write_file
 *   Network Access Rules       → read_url / execute_url
 *   Terminal Commands          → command
 *   Commands Outside Sandbox   → unsandboxed
 *   MCP Tools                  → mcp
 */
const UI_CHANNELS = {
  'file-access': { label: 'File Access Rules', actions: ['read_file', 'write_file'] },
  'network-access': { label: 'Network Access Rules', actions: ['read_url', 'execute_url'] },
  'terminal': { label: 'Terminal Commands', actions: ['command'] },
  'outside-sandbox': { label: 'Commands Outside Sandbox', actions: ['unsandboxed'] },
  'mcp': { label: 'MCP Tools', actions: ['mcp'] }
};

function channelOfAction(action) {
  for (const [key, def] of Object.entries(UI_CHANNELS)) {
    if (def.actions.includes(action)) return key;
  }
  return 'other';
}

/** 从 grant 字符串解析 action 类型: command(...) / read_file(...) / unsandboxed(...) ... */
function actionType(s) {
  const m = String(s || '').match(/^([a-z_]+)\(/i);
  return m ? m[1] : 'unknown';
}
function typeBreakdown(arr) {
  const out = {};
  for (const s of arr || []) {
    const t = actionType(s);
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}
function shortByAction(arr) {
  const out = {};
  for (const s of arr || []) {
    if (typeof s !== 'string' || s.length > 160) continue;
    const t = actionType(s);
    (out[t] = out[t] || []).push(s);
  }
  return out;
}

function grantView(host) {
  host = host || {};
  // 按 UI 五通道聚合
  const byChannel = {};
  for (const list of ['allow', 'ask', 'deny']) {
    byChannel[list] = {};
    for (const [action, n] of Object.entries(typeBreakdown(host[list]))) {
      const ch = channelOfAction(action);
      byChannel[list][ch] = byChannel[list][ch] || { actions: {}, total: 0 };
      byChannel[list][ch].actions[action] = n;
      byChannel[list][ch].total += n;
    }
  }
  return {
    counts: {
      allow: (host.allow || []).length,
      ask: (host.ask || []).length,
      deny: (host.deny || []).length
    },
    byChannel,
    actions: {
      allow: typeBreakdown(host.allow),
      ask: typeBreakdown(host.ask),
      deny: typeBreakdown(host.deny)
    },
    shortByAction: {
      allow: shortByAction(host.allow),
      ask: shortByAction(host.ask),
      deny: shortByAction(host.deny)
    }
  };
}

function securityView(obj, label) {
  const us = obj.userSettings || {};
  return {
    label: label || 'config',
    // 全局设置字段（含我们之前漏掉的）
    settings: {
      autoExecutionPolicy: us.autoExecutionPolicy,
      enableTerminalSandbox: us.enableTerminalSandbox,
      fileAccessPolicy: us.fileAccessPolicy,
      nonWorkspaceFileAccessPolicy: us.nonWorkspaceFileAccessPolicy,
      artifactReviewMode: us.artifactReviewMode,
      conversationWidth: us.conversationWidth,
      remoteControlEnabled: us.remoteControlEnabled
    },
    grants: grantView(us.globalPermissionGrants)
  };
}

function projectSecurityView(p) {
  const s = p.settings || {};
  const pg = (p.permissionGrants && p.permissionGrants.permissionGrants) || p.permissionGrants || {};
  return {
    name: p.name,
    id: p.id,
    settings: {
      fileAccessPolicy: s.fileAccessPolicy,
      nonWorkspaceFileAccessPolicy: s.nonWorkspaceFileAccessPolicy,
      sandboxMode: s.sandboxMode,
      autoExecutionPolicy: s.autoExecutionPolicy,
      // 保留未知键，避免再漏
      ...Object.fromEntries(Object.entries(s).filter(([k]) => ![
        'fileAccessPolicy', 'nonWorkspaceFileAccessPolicy', 'sandboxMode', 'autoExecutionPolicy'
      ].includes(k)))
    },
    grants: grantView(pg)
  };
}

function loadProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json')).map(f => {
    try { return readJson(path.join(PROJECTS, f)); } catch (e) { return null; }
  }).filter(Boolean);
}

function findProject(key) {
  const list = loadProjects();
  return list.find(p => p.id === key || p.name === key) || null;
}

function snapshot(label) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const cfg = readJson(CONFIG);
  const projects = loadProjects().map(projectSecurityView);
  const snap = {
    at: new Date().toISOString(),
    label: label || '',
    global: securityView(cfg, 'global'),
    projects
  };
  const file = path.join(SNAP_DIR, `snap-${Date.now()}${label ? '-' + label : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), 'utf8');
  console.log(JSON.stringify({ saved: file, global: snap.global, projects }, null, 2));
  return snap;
}

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    out[prefix + '.len'] = obj.length;
    obj.forEach((v, i) => {
      if (typeof v === 'string') {
        if (v.length < 160) out[`${prefix}[${i}]`] = v;
      } else if (v && typeof v === 'object') {
        flatten(v, `${prefix}[${i}]`, out);
      }
    });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? prefix + '.' + k : k, out);
  return out;
}

function diff(aPath, bPath) {
  const a = flatten(readJson(aPath));
  const b = flatten(readJson(bPath));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes = [];
  for (const k of keys) {
    if (a[k] !== b[k]) changes.push({ key: k, from: a[k], to: b[k] });
  }
  console.log(JSON.stringify({ a: aPath, b: bPath, changes }, null, 2));
}

/**
 * 预设 = autoExecutionPolicy + fileAccessPolicy (+ sandboxMode)
 * 由人机快照差分确认（2026-09-25）:
 *   default      : OFF  + ASK   + sandbox=false
 *   full-machine : OFF  + ALLOW + sandbox=false
 *   turbo        : EAGER+ ALLOW + sandbox=false
 */
const PRESETS = {
  default: {
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
    fileAccessPolicy: 'AGENT_SETTING_POLICY_ASK',
    sandboxMode: false
  },
  'full-machine': {
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
    fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
    sandboxMode: false
  },
  fullmachine: null, // alias, filled below
  turbo: {
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
    sandboxMode: false
  }
};
PRESETS.fullmachine = PRESETS['full-machine'];

/**
 * Custom 模式三个旋钮（仅 Security Preset=Custom 时 UI 显示）:
 *   fileAccessPolicy     AGENT_SETTING_POLICY_ASK | ALLOW | DENY  (项目用 fileAccessPolicy)
 *   autoExecutionPolicy  CASCADE_COMMANDS_AUTO_EXECUTION_OFF | EAGER
 *   sandboxMode          true | false
 * 全局文件策略字段名为 nonWorkspaceFileAccessPolicy。
 */
function setCustom(opts, projectKey) {
  // opts: { file, exec, sandbox }
  const patch = {};
  if (opts.file) {
    const map = {
      ask: 'AGENT_SETTING_POLICY_ASK',
      allow: 'AGENT_SETTING_POLICY_ALLOW',
      deny: 'AGENT_SETTING_POLICY_DENY'
    };
    patch.fileAccessPolicy = map[opts.file] || opts.file;
    patch.nonWorkspaceFileAccessPolicy = patch.fileAccessPolicy;
  }
  if (opts.exec) {
    const map = {
      off: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
      review: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
      eager: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
      always: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'
    };
    patch.autoExecutionPolicy = map[opts.exec] || opts.exec;
  }
  if (opts.sandbox !== undefined) {
    patch.sandboxMode = opts.sandbox === true || opts.sandbox === 'true' || opts.sandbox === 'on';
  }
  if (!Object.keys(patch).length) {
    console.error('usage: set-custom --file ask|allow|deny --exec off|eager --sandbox on|off [--project x]');
    process.exit(1);
  }
  if (projectKey) {
    const p = findProject(projectKey);
    if (!p) { console.error('project not found:', projectKey); process.exit(1); }
    p.settings = Object.assign({}, p.settings, patch);
    writeJson(path.join(PROJECTS, p.id + '.json'), p);
    console.log(JSON.stringify({ ok: true, scope: 'project', project: p.name, settings: p.settings, note: 'UI 将显示为 Custom' }));
  } else {
    const cfg = readJson(CONFIG);
    cfg.userSettings = cfg.userSettings || {};
    Object.assign(cfg.userSettings, patch);
    writeJson(CONFIG, cfg);
    console.log(JSON.stringify({ ok: true, scope: 'global', settings: patch, note: 'UI 将显示为 Custom' }));
  }
}

function setMode(mode, projectKey) {
  const preset = PRESETS[mode];
  // 兼容单字段：off/eager
  const single = {
    off: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF' },
    review: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF' },
    eager: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER' },
    always: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER' }
  };
  const patch = preset || single[mode] || null;
  if (!patch) {
    console.error('unknown mode:', mode, 'use default|full-machine|turbo|off|eager');
    process.exit(1);
  }
  if (projectKey) {
    const p = findProject(projectKey);
    if (!p) { console.error('project not found:', projectKey); process.exit(1); }
    p.settings = Object.assign({}, p.settings, patch);
    writeJson(path.join(PROJECTS, p.id + '.json'), p);
    console.log(JSON.stringify({ ok: true, scope: 'project', project: p.name, settings: p.settings }));
  } else {
    const cfg = readJson(CONFIG);
    cfg.userSettings = cfg.userSettings || {};
    Object.assign(cfg.userSettings, patch);
    writeJson(CONFIG, cfg);
    console.log(JSON.stringify({ ok: true, scope: 'global', settings: patch }));
  }
}

function ensureGrantHost(p, useGlobal) {
  if (useGlobal || !p) {
    const cfg = readJson(CONFIG);
    cfg.userSettings = cfg.userSettings || {};
    cfg.userSettings.globalPermissionGrants = cfg.userSettings.globalPermissionGrants || { allow: [] };
    return { file: CONFIG, obj: cfg, host: cfg.userSettings.globalPermissionGrants };
  }
  p.permissionGrants = p.permissionGrants || {};
  if (!p.permissionGrants.permissionGrants && (p.permissionGrants.allow || p.permissionGrants.ask || p.permissionGrants.deny)) {
    // 已是扁平 host
    return { file: path.join(PROJECTS, p.id + '.json'), obj: p, host: p.permissionGrants };
  }
  p.permissionGrants.permissionGrants = p.permissionGrants.permissionGrants || { allow: [] };
  return { file: path.join(PROJECTS, p.id + '.json'), obj: p, host: p.permissionGrants.permissionGrants };
}

function normalizeTarget(t) {
  let s = String(t).trim();
  // 防双重包裹
  if (s.startsWith('command(') && s.endsWith(')')) {
    s = s.slice('command('.length, -1);
    if (s.startsWith('command(') && s.endsWith(')')) s = s.slice('command('.length, -1);
  }
  return s;
}

function setRule(listName, target, projectKey, useGlobal) {
  const p = projectKey ? findProject(projectKey) : null;
  if (projectKey && !p) { console.error('project not found:', projectKey); process.exit(1); }
  const { file, obj, host } = ensureGrantHost(p, useGlobal);
  const cleaned = normalizeTarget(target);
  const resource = 'command(' + cleaned + ')';
  if (!Array.isArray(host[listName])) host[listName] = [];
  if (!host[listName].includes(resource)) host[listName].push(resource);
  // 顺带清理双重包裹
  for (const k of ['allow', 'ask', 'deny']) {
    if (Array.isArray(host[k])) {
      host[k] = host[k].map(x => {
        if (typeof x === 'string' && x.startsWith('command(command(') && x.endsWith('))')) {
          return 'command(' + x.slice('command(command('.length, -2) + ')';
        }
        return x;
      });
    }
  }
  writeJson(file, obj);
  console.log(JSON.stringify({ ok: true, file, list: listName, resource, note: '只填 target，勿再包 command()' }));
}

function clearRules(listName, projectKey, useGlobal) {
  const p = projectKey ? findProject(projectKey) : null;
  const { file, obj, host } = ensureGrantHost(p, useGlobal);
  host[listName] = [];
  writeJson(file, obj);
  console.log(JSON.stringify({ ok: true, file, cleared: listName }));
}

function verify() {
  const cfg = readJson(CONFIG);
  const issues = [];
  const check = (arr, where) => (arr || []).forEach(s => {
    if (typeof s === 'string' && s.startsWith('command(command(')) {
      issues.push({ where, bad: s.slice(0, 80) });
    }
  });
  const gpg = (cfg.userSettings && cfg.userSettings.globalPermissionGrants) || {};
  check(gpg.allow, 'global.allow');
  check(gpg.ask, 'global.ask');
  check(gpg.deny, 'global.deny');
  for (const p of loadProjects()) {
    const pg = (p.permissionGrants && p.permissionGrants.permissionGrants) || p.permissionGrants || {};
    check(pg.allow, p.name + '.allow');
    check(pg.ask, p.name + '.ask');
    check(pg.deny, p.name + '.deny');
  }
  console.log(JSON.stringify({
    ok: issues.length === 0,
    issues,
    global: securityView(cfg, 'global'),
    projects: loadProjects().map(projectSecurityView)
  }, null, 2));
}

function show() {
  const cfg = readJson(CONFIG);
  console.log(JSON.stringify({
    global: securityView(cfg, 'global'),
    projects: loadProjects().map(projectSecurityView)
  }, null, 2));
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'snapshot') snapshot(args[0]);
  else if (cmd === 'diff') diff(args[0], args[1]);
  else if (cmd === 'show') show();
  else if (cmd === 'set-mode') setMode(args[0], args[1]);
  else if (cmd === 'set-custom') {
    const opts = { file: null, exec: null, sandbox: undefined };
    const pi = args.indexOf('--project');
    let projectKey = pi >= 0 ? args[pi + 1] : null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--file') opts.file = args[++i];
      else if (args[i] === '--exec') opts.exec = args[++i];
      else if (args[i] === '--sandbox') opts.sandbox = args[++i];
      else if (args[i] === '--project') { i++; continue; }
      else if (!args[i].startsWith('--') && findProject(args[i])) projectKey = args[i];
    }
    setCustom(opts, projectKey);
  }
  else if (cmd === 'set-rules') {
    const useGlobal = args.includes('--global');
    const pi = args.indexOf('--project');
    const projectKey = pi >= 0 ? args[pi + 1] : null;
    const target = args[1] && !args[1].startsWith('--') ? args[1] : null;
    if (!target) { console.error('usage: set-rules <ask|deny|allow> <target> [--project x] [--global]'); process.exit(1); }
    setRule(args[0], target, projectKey, useGlobal || !projectKey);
  } else if (cmd === 'clear-rules') {
    const useGlobal = args.includes('--global');
    const pi = args.indexOf('--project');
    const projectKey = pi >= 0 ? args[pi + 1] : null;
    clearRules(args[0], projectKey, useGlobal || !projectKey);
  } else if (cmd === 'verify') verify();
  else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).join('\n'));
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
