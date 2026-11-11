const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { discoverStandalone, discoverIde } = require('./discovery');

const run = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 150;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDarwinProcessList(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), command: match[2].trim() }] : [];
  });
}

function stripWrappingQuotes(value) {
  return value.replace(/^"(.*)"$/, '$1');
}

function targetProcessMatches(command, target) {
  if (!command || !target?.appExe) return false;
  const normalized = stripWrappingQuotes(command.trim());
  const executable = target.appExe;
  const appDir = target.appDir && path.resolve(target.appDir);
  const executableName = path.basename(executable);

  if (normalized === executable || normalized.startsWith(`${executable} `)) return true;
  if (appDir && (normalized === appDir || normalized.startsWith(`${appDir}${path.sep}`))) return true;

  // Some macOS process listings expose only argv[0]. Do not treat helper
  // processes as the main app when their argv[0] is "Antigravity Helper".
  return normalized === executableName
    || (normalized.startsWith(`${executableName} `)
      && !normalized.startsWith(`${executableName} Helper`));
}

async function listDarwinTargetProcesses(target, { execute = run } = {}) {
  const { stdout } = await execute('ps', ['-ww', '-axo', 'pid=,args='], {
    timeout: 4000,
    maxBuffer: 4 * 1024 * 1024
  });
  return parseDarwinProcessList(stdout)
    .filter(row => row.pid !== process.pid && targetProcessMatches(row.command, target));
}

async function stopDarwinTarget(target, {
  execute = run,
  kill = process.kill,
  sleepFn = sleep,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS
} = {}) {
  let processes = await listDarwinTargetProcesses(target, { execute });
  const initialPids = processes.map(row => row.pid);
  for (const pid of initialPids) {
    try { kill(pid, 'SIGTERM'); } catch { /* The process may have exited already. */ }
  }

  const deadline = Date.now() + timeoutMs;
  while (processes.length && Date.now() < deadline) {
    await sleepFn(pollIntervalMs);
    processes = await listDarwinTargetProcesses(target, { execute });
  }

  if (processes.length) {
    for (const { pid } of processes) {
      try { kill(pid, 'SIGKILL'); } catch { /* The process may have exited already. */ }
    }
    await sleepFn(Math.min(pollIntervalMs, 250));
    processes = await listDarwinTargetProcesses(target, { execute });
  }

  return {
    ok: processes.length === 0,
    initialPids,
    remainingPids: processes.map(row => row.pid)
  };
}

async function stopWindowsTarget(target, { execute = run } = {}) {
  const imageName = path.basename(target.appExe);
  try {
    await execute('taskkill.exe', ['/IM', imageName, '/T', '/F'], {
      windowsHide: true,
      timeout: 8000
    });
  } catch (error) {
    // taskkill exits non-zero when no matching process exists. That is
    // already the desired stopped state.
    if (!/not found|no running instance|找不到|没有运行/i.test(`${error.stdout || ''}\n${error.stderr || ''}`)) {
      throw error;
    }
  }
  return { ok: true, initialPids: [], remainingPids: [] };
}

async function stopDesktop(targetName = 'hub', settings = {}, options = {}) {
  const target = targetName === 'ide'
    ? discoverIde(settings.customIdePath)
    : discoverStandalone(settings.customHubPath);
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return stopDarwinTarget(target, options);
  if (platform === 'win32') return stopWindowsTarget(target, options);
  throw new Error(`不支持关闭 ${target.name} 的平台`);
}

module.exports = {
  parseDarwinProcessList,
  targetProcessMatches,
  listDarwinTargetProcesses,
  stopDarwinTarget,
  stopDesktop
};
