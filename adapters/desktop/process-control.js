// Recovery flow inspired by shallFun4Learning's PR #18:
// https://github.com/DSDS-CMHL/EasyAntigravity/pull/18
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function matchesExecutable(executable, target, platform = process.platform) {
  if (!executable || !target?.appExe) return false;
  if (platform === 'win32') {
    const normalize = value => value.replace(/^\\\\\?\\/, '').replace(/\//g, '\\').toLowerCase();
    return normalize(executable) === normalize(target.appExe);
  }
  return executable === target.appExe || (target.appDir?.endsWith('.app')
    && executable.startsWith(target.appDir + '/Contents/'));
}

async function listTargetProcesses(target, { execute = run, platform = process.platform } = {}) {
  if (platform === 'win32') {
    const literal = target.appExe.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rows=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${literal}' } | ForEach-Object { $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid; if ($owner.ReturnValue -ne 0) { throw 'Cannot verify process owner' }; if ($owner.Sid -eq $sid) { [PSCustomObject]@{pid=$_.ProcessId; executable=$_.ExecutablePath; created=[string]$_.CreationDate} } }); ConvertTo-Json -InputObject $rows -Compress`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout.trim().replace(/^\uFEFF/, '') || '[]').filter(row => row.pid !== process.pid && matchesExecutable(row.executable, target, platform));
  }
  if (platform !== 'darwin') throw new Error('当前平台暂不支持进程清理');
  const { stdout } = await execute('ps', ['-ww', '-axo', 'pid=,uid=,lstart=,comm='], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/);
    if (!match || Number(match[2]) !== process.getuid() || Number(match[1]) === process.pid) return [];
    return matchesExecutable(match[4], target, platform) ? [{ pid: Number(match[1]), created: match[3], executable: match[4] }] : [];
  });
}

async function stopTarget(target, { list = listTargetProcesses, kill = process.kill, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 4000, cancelled = () => false } = {}) {
  // Only signal processes whose executable, owner and creation time were verified.
  const initial = await list(target);
  const signalRows = async (rows, signal) => {
    const current = await list(target);
    for (const row of rows) {
      if (cancelled()) throw new Error('清理已取消');
      if (!current.some(now => now.pid === row.pid && now.created === row.created)) continue;
      try { kill(row.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  await signalRows(initial, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  let remaining = await list(target);
  while (remaining.length && Date.now() < deadline) {
    if (cancelled()) throw new Error('清理已取消');
    await sleep(150);
    remaining = await list(target);
  }
  if (remaining.length) {
    await signalRows(remaining, 'SIGKILL');
    await sleep(250);
    remaining = await list(target);
  }
  return { ok: !remaining.length, initialPids: initial.map(row => row.pid), remainingPids: remaining.map(row => row.pid) };
}

function canonicalTarget(target) {
  // Resolve junctions/symlinks (e.g. Scoop's current directory) before matching.
  const appExe = fs.realpathSync.native(target.appExe);
  return { ...target, appExe, appDir: target.appDir?.endsWith('.app') ? fs.realpathSync.native(target.appDir) : path.dirname(appExe) };
}

module.exports = { matchesExecutable, listTargetProcesses, stopTarget, canonicalTarget };
