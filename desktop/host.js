const { spawn } = require('node:child_process');
const fs = require('node:fs');

function browseExecutable({ title = '选择 Antigravity 可执行文件 (.exe)' } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    const escapedTitle = title.replace(/'/g, "''");
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.OpenFileDialog',
      `$d.Title = '${escapedTitle}'`,
      "$d.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*'",
      '$d.RestoreDirectory = $true',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '  [Console]::WriteLine($d.FileName)',
      '}'
    ].join('; ');

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('close', () => {
      const selected = output.trim();
      resolve(selected && fs.existsSync(selected) ? selected : null);
    });
    child.on('error', () => resolve(null));
  });
}

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
    browseExecutable: testMode ? async () => null : browseExecutable,
    hide: () => send({ cmd: 'hide_easyag' }),
    show: () => send({ cmd: 'popup' }),
    setTheme: value => send({ cmd: 'theme', value }),
    dispose() {}
  };
}

module.exports = { createHost, browseExecutable };
