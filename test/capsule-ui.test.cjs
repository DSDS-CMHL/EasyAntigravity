const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'capsule.html'), 'utf8');
const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const resident = fs.readFileSync(path.join(root, 'scripts', 'resident', 'EasyAG-Resident.cs'), 'utf8');
const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'capabilities', 'capsule.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

assert.match(html, /class="close"/, '胶囊必须有可见关闭按钮');
assert.match(html, /getCurrentWindow\(\)\.hide\(\)/, '关闭按钮必须隐藏 Tauri 胶囊窗口');
assert.match(html, /setTimeout\(hideWindow/, '胶囊必须自动消失');
assert.match(html, /mouseenter/, '悬停必须暂停自动消失');
assert.match(html, /可能后果/);
assert.match(html, /建议方案/);
assert.match(html, /高风险命令/);
assert.match(html, /中风险命令/);
assert.match(html, /低风险提醒/);
assert.match(rust, /work_area\(\)/, '定位必须使用显示器工作区，避开任务栏');
assert.match(rust, /get_webview_window\("main"\)/, '定位应优先跟随主窗口所在显示器');
assert.match(rust, /solution: &str/, '风险建议必须传入胶囊');
assert.match(resident, /RestartAutoHide/, '旧便携 Resident 胶囊也必须自动消失');
assert.match(resident, /Screen\.FromHandle\(agHwnd\)/, 'Resident 胶囊应跟随 AG 所在显示器');
assert.equal(config.app.withGlobalTauri, true);
assert.ok(capability.windows.includes('capsule'));
assert.ok(capability.permissions.includes('core:window:allow-hide'));

console.log('PASS: capsule close, timeout, risk content and work-area positioning');
