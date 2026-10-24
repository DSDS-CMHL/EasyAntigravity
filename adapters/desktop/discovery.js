const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function normalizePath(value) {
  if (!value || process.platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return '\\\\' + value.slice(8);
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

function findFromRegistry(name) {
  if (process.platform !== 'win32') return null;
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];
  for (const root of roots) {
    try {
      const output = execFileSync('reg.exe', ['query', root, '/s', '/f', name], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true
      });
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:DisplayIcon|InstallLocation)\s+REG_SZ\s+(.+)$/i);
        if (!match) continue;
        let candidate = match[1].trim().replace(/^["']|["']$/g, '').replace(/,\d+$/, '');
        // If searching for Standalone Antigravity, avoid matching Antigravity IDE
        if (name === 'Antigravity' && /Antigravity\s+IDE/i.test(candidate)) continue;
        if (candidate.toLowerCase().endsWith('.exe') && fs.existsSync(candidate)) {
          return candidate;
        }
        const exeName = name.endsWith('.exe') ? name : name + '.exe';
        const candidateExe = path.join(candidate, exeName);
        if (fs.existsSync(candidateExe)) {
          return candidateExe;
        }
      }
    } catch { /* Registry query may fail or have no matches */ }
  }
  return null;
}

function resolveDarwinBundle(candidate, defaultExeName) {
  let executable = defaultExeName;
  if (fs.existsSync(candidate)) {
    try {
      executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(candidate, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 3000 }).trim();
    } catch { /* Fallback to default */ }
  }
  return { appDir: candidate, appExe: path.join(candidate, 'Contents/MacOS', executable) };
}

function discoverStandalone() {
  const profile = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/Antigravity')
    : path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Antigravity');
  const explicit = normalizePath(process.env.EASYAG_AG_EXE);
  if (explicit) {
    return {
      id: 'hub',
      name: 'Antigravity',
      label: '桌面版',
      fullName: 'Antigravity (桌面版)',
      appDir: path.dirname(explicit),
      appExe: explicit,
      appName: 'Antigravity',
      exists: fs.existsSync(explicit),
      profile,
      capabilities: { cdp: true, metrics: true }
    };
  }
  if (process.platform === 'darwin') {
    const candidates = ['/Applications/Antigravity.app', path.join(os.homedir(), 'Applications/Antigravity.app')];
    const bundle = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
    const resolved = resolveDarwinBundle(bundle, 'Antigravity');
    return {
      id: 'hub',
      name: 'Antigravity',
      label: '桌面版',
      fullName: 'Antigravity (桌面版)',
      appDir: resolved.appDir,
      appExe: resolved.appExe,
      appName: 'Antigravity',
      exists: fs.existsSync(resolved.appExe),
      profile,
      capabilities: { cdp: true, metrics: true }
    };
  }
  if (process.platform === 'win32') {
    const fromReg = findFromRegistry('Antigravity');
    const local = path.join(process.env.LOCALAPPDATA || '', 'Programs/antigravity/Antigravity.exe');
    const progFiles = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'antigravity/Antigravity.exe');
    const candidates = [fromReg, local, progFiles].filter(Boolean);
    const appExe = candidates.find(cand => fs.existsSync(cand)) || local;
    return {
      id: 'hub',
      name: 'Antigravity',
      label: '桌面版',
      fullName: 'Antigravity (桌面版)',
      appDir: path.dirname(appExe),
      appExe,
      appName: 'Antigravity',
      exists: fs.existsSync(appExe),
      profile,
      capabilities: { cdp: true, metrics: true }
    };
  }
  const appExe = '/usr/bin/antigravity';
  return {
    id: 'hub',
    name: 'Antigravity',
    label: '桌面版',
    fullName: 'Antigravity (桌面版)',
    appDir: path.dirname(appExe),
    appExe,
    appName: 'Antigravity',
    exists: fs.existsSync(appExe),
    profile,
    capabilities: { cdp: true, metrics: true }
  };
}

function discoverIde() {
  const profile = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/Antigravity IDE')
    : path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Antigravity IDE');
  const explicit = normalizePath(process.env.EASYAG_IDE_EXE);
  if (explicit) {
    return {
      id: 'ide',
      name: 'Antigravity IDE',
      label: 'IDE 版',
      fullName: 'Antigravity IDE (编辑器版)',
      appDir: path.dirname(explicit),
      appExe: explicit,
      appName: 'Antigravity IDE',
      exists: fs.existsSync(explicit),
      profile,
      capabilities: { cdp: false, metrics: false }
    };
  }
  if (process.platform === 'darwin') {
    const candidates = ['/Applications/Antigravity IDE.app', path.join(os.homedir(), 'Applications/Antigravity IDE.app')];
    const bundle = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
    const resolved = resolveDarwinBundle(bundle, 'Antigravity IDE');
    return {
      id: 'ide',
      name: 'Antigravity IDE',
      label: 'IDE 版',
      fullName: 'Antigravity IDE (编辑器版)',
      appDir: resolved.appDir,
      appExe: resolved.appExe,
      appName: 'Antigravity IDE',
      exists: fs.existsSync(resolved.appExe),
      profile,
      capabilities: { cdp: false, metrics: false }
    };
  }
  if (process.platform === 'win32') {
    const fromReg = findFromRegistry('Antigravity IDE');
    const local = path.join(process.env.LOCALAPPDATA || '', 'Programs/Antigravity IDE/Antigravity IDE.exe');
    const progFiles = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE/Antigravity IDE.exe');
    const dDrive = 'D:\\Antigravity IDE\\Antigravity IDE.exe';
    const cDrive = 'C:\\Antigravity IDE\\Antigravity IDE.exe';
    const candidates = [fromReg, local, progFiles, dDrive, cDrive].filter(Boolean);
    const appExe = candidates.find(cand => fs.existsSync(cand)) || local;
    return {
      id: 'ide',
      name: 'Antigravity IDE',
      label: 'IDE 版',
      fullName: 'Antigravity IDE (编辑器版)',
      appDir: path.dirname(appExe),
      appExe,
      appName: 'Antigravity IDE',
      exists: fs.existsSync(appExe),
      profile,
      capabilities: { cdp: false, metrics: false }
    };
  }
  const appExe = '/usr/bin/antigravity-ide';
  return {
    id: 'ide',
    name: 'Antigravity IDE',
    label: 'IDE 版',
    fullName: 'Antigravity IDE (编辑器版)',
    appDir: path.dirname(appExe),
    appExe,
    appName: 'Antigravity IDE',
    exists: fs.existsSync(appExe),
    profile,
    capabilities: { cdp: false, metrics: false }
  };
}

function discoverDesktop(target = 'hub') {
  return target === 'ide' ? discoverIde() : discoverStandalone();
}

function discoverAllTargets() {
  return {
    hub: discoverStandalone(),
    ide: discoverIde()
  };
}

function resolveTarget(preference = 'auto') {
  const targets = discoverAllTargets();
  if (preference === 'ide') {
    return targets.ide.exists ? targets.ide : (targets.hub.exists ? targets.hub : targets.ide);
  }
  if (preference === 'hub') {
    return targets.hub.exists ? targets.hub : (targets.ide.exists ? targets.ide : targets.hub);
  }
  // 'auto'
  if (targets.hub.exists && targets.ide.exists) return targets.hub;
  if (targets.ide.exists && !targets.hub.exists) return targets.ide;
  return targets.hub;
}

async function desktopRunning(target = 'hub') {
  try {
    if (process.platform === 'win32') {
      const imageName = target === 'ide' ? 'Antigravity IDE.exe' : 'Antigravity.exe';
      const { stdout } = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 });
      const pattern = target === 'ide' ? /"Antigravity IDE\.exe"/i : /"Antigravity\.exe"/i;
      return pattern.test(stdout);
    }
    const processName = target === 'ide' ? 'Antigravity IDE' : 'Antigravity';
    const { stdout } = await run('pgrep', ['-f', processName], { timeout: 4000 });
    return /^\d+/m.test(stdout);
  } catch { return false; }
}

async function detectRunningTarget(preferred = 'auto') {
  const targets = discoverAllTargets();
  if (preferred === 'ide') {
    if (await desktopRunning('ide')) return targets.ide;
    return null;
  }
  if (preferred === 'hub') {
    if (await desktopRunning('hub')) return targets.hub;
    return null;
  }
  if (await desktopRunning('hub')) return targets.hub;
  if (await desktopRunning('ide')) return targets.ide;
  return null;
}

module.exports = {
  normalizePath,
  discoverStandalone,
  discoverIde,
  discoverDesktop,
  discoverAllTargets,
  resolveTarget,
  desktopRunning,
  detectRunningTarget
};
