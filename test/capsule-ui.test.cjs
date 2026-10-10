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
assert.match(html, /getCurrentWindow|getCurrentWebviewWindow/, '关闭按钮必须走 Tauri 窗口 API');
assert.match(html, /win\.hide\(\)|getCurrentWindow\(\)\.hide\(\)/, '关闭按钮必须隐藏 Tauri 胶囊窗口');
assert.match(html, /setTimeout\(hideWindow/, '胶囊必须自动消失');
assert.match(html, /mouseenter/, '悬停必须暂停自动消失');
assert.match(html, /可能后果/);
assert.match(html, /前往审查/, '必须提供前往审查按钮');
assert.doesNotMatch(html, /建议方案/, '风险卡片不再展示建议方案');
assert.match(html, /高风险命令/);
assert.match(html, /中风险命令/);
assert.match(html, /低风险提醒/);
assert.match(rust, /work_area\(\)/, '定位必须使用显示器工作区，避开任务栏');
assert.match(rust, /get_webview_window\("main"\)/, '定位应优先跟随主窗口所在显示器');
assert.match(rust, /solution: &str/, '风险建议必须传入胶囊');
assert.match(rust, /capsule\.html/, '胶囊页可从本地服务加载以便热更新');
assert.match(resident, /RestartAutoHide/, '旧便携 Resident 胶囊也必须自动消失');
assert.match(resident, /Screen\.FromHandle\(agHwnd\)/, 'Resident 胶囊应跟随 AG 所在显示器');
assert.equal(config.app.withGlobalTauri, true);
assert.ok(capability.windows.includes('capsule'));
assert.ok(capability.permissions.includes('core:window:allow-hide'));

// Exercise the actual page timer/close code, including an old close racing a new notice.
const vm = require('node:vm');
const timers = new Map();
let sequence = 0;
let hidden = 0;
function mockElement() {
  return {
    events: {}, classList: { add() {} }, style: { setProperty() {} },
    addEventListener(name, handler) { this.events[name] = handler; },
    cloneNode() { return mockElement(); }, replaceWith() {}
  };
}
const elements = Object.fromEntries(['notice', 'level', 'title', 'impact', 'reviewBtn', '.close', '.timer'].map(id => [id, mockElement()]));
const document = {
  getElementById: id => elements[id], querySelector: selector => elements[selector], addEventListener() {}
};
const context = {
  window: { __TAURI__: { window: { getCurrentWindow: () => ({ hide() { hidden++; return Promise.resolve(); } }) } }, close() {} },
  document, location: { protocol: 'http:', origin: 'http://127.0.0.1:1234' }, navigator: {},
  setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); }, fetch: async () => ({ ok: true })
};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
context.window.__ea_capsule('risk_high', 'First', 'Impact');
assert.ok([...timers.values()].some(timer => timer.delay === 18000));
elements.notice.events.mouseenter();
assert.equal(timers.size, 0, 'Hover pauses auto hide');
elements.notice.events.mouseleave();
assert.equal(timers.size, 1, 'Leaving resumes auto hide');
elements['.close'].events.click();
const oldClose = [...timers.values()].find(timer => timer.delay === 140).callback;
context.window.__ea_capsule('risk_medium', 'New', 'New impact');
oldClose();
assert.equal(hidden, 0, 'The old close callback must not hide a new notification');
elements['.close'].events.click();
const close = [...timers.values()].find(timer => timer.delay === 140).callback;
close();
assert.equal(hidden, 1, 'The close button must call the native hide API');
console.log('PASS: capsule close, hover/timers, notification race and work-area positioning');
