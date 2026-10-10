const { spawn, execFile } = require('node:child_process');

function createHost({ native, testMode, events }) {
  let timer;
  function send(command) {
    if (!native || testMode) return;
    process.stdout.write(JSON.stringify(command) + '\n');
  }
  function open(file, { text = false } = {}) {
    if (testMode) return;
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const args = process.platform === 'darwin' && text ? ['-t', file] : [file];
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', error => events.log('SYSTEM', '打开失败: ' + error.message, 'tag-warn'));
    child.unref();
  }
  return {
    open,
    hide: () => send({ cmd: 'hide_easyag' }),
    show: () => send({ cmd: 'popup' }),
    showCapsule(message) {
      clearTimeout(timer);
      send({ cmd: 'show_capsule', ...message });
      timer = setTimeout(() => send({ cmd: 'hide_capsule' }), 75000);
      timer.unref();
    },
    hideCapsule() { clearTimeout(timer); send({ cmd: 'hide_capsule' }); },
    focus(pid) {
      if (testMode) return;
      if (process.platform === 'darwin') {
        execFile('osascript', ['-e', 'tell application "Antigravity" to activate'], { timeout: 3000 }, () => {});
      } else if (process.platform === 'win32') {
        const target = Number.isInteger(pid) && pid > 0 ? String(pid) : "'Antigravity'";
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$shell = New-Object -ComObject WScript.Shell; $shell.AppActivate(${target})`], { windowsHide: true, timeout: 3000 }, () => {});
      }
    },
    dispose() { clearTimeout(timer); }
  };
}

module.exports = { createHost };
