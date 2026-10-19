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

function discoverDesktop() {
  const explicit = normalizePath(process.env.EASYAG_AG_EXE);
  if (explicit) return { appDir: path.dirname(explicit), appExe: explicit, appName: 'Antigravity' };
  if (process.platform === 'darwin') {
    const candidates = ['/Applications/Antigravity.app', path.join(os.homedir(), 'Applications/Antigravity.app')];
    const bundle = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
    let executable = 'Antigravity';
    if (fs.existsSync(bundle)) {
      try {
        executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 3000 }).trim();
      } catch { /* Older bundles may not advertise their entrypoint. */ }
    }
    return { appDir: bundle, appExe: path.join(bundle, 'Contents/MacOS', executable), appName: 'Antigravity' };
  }
  const appDir = path.join(process.env.LOCALAPPDATA || '', 'Programs/antigravity');
  return { appDir, appExe: path.join(appDir, 'Antigravity.exe'), appName: 'Antigravity' };
}

async function desktopRunning() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 });
      return /"Antigravity\.exe"/i.test(stdout);
    }
    const { stdout } = await run('pgrep', ['-x', 'Antigravity'], { timeout: 4000 });
    return /^\d+/m.test(stdout);
  } catch { return false; }
}

module.exports = { normalizePath, discoverDesktop, desktopRunning };
