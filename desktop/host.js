const { spawn } = require('node:child_process');

function createHost({ native, testMode, events }) {
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
    setTheme: value => send({ cmd: 'theme', value }),
    dispose() {}
  };
}

module.exports = { createHost };
