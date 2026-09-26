const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const data = path.join(os.homedir(), 'AppData', 'Local', 'com.easyag.launcher.tauri');
fs.mkdirSync(data, { recursive: true });

for (const n of [
  'easyag-pretool-hook.cjs',
  'easyag-stop-hook.cjs',
  'easyag-pretool-hook.cmd'
]) {
  const src = path.join(root, 'scripts', n);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(data, n));
}

const cmdPre = path.join(data, 'easyag-pretool-hook.cmd');
const cmdStop = path.join(data, 'easyag-stop-hook.cjs');
const node = process.execPath;

const hooksPath = path.join(os.homedir(), '.gemini', 'config', 'hooks.json');
let hooks = {};
try {
  hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
} catch (e) {}

hooks['easyag-danger-gate'] = {
  enabled: true,
  PreToolUse: [{
    matcher: 'run_command',
    hooks: [{ type: 'command', command: cmdPre, timeout: 5 }]
  }]
};
hooks['easyag-task-done'] = {
  enabled: true,
  Stop: [{
    type: 'command',
    command: '"' + node + '" "' + cmdStop + '"',
    timeout: 5
  }]
};

fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2), 'utf8');
console.log('hooks reinstalled');
console.log('pre cmd:', cmdPre);
