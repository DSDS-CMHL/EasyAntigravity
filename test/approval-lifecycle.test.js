/*
 * 审批卡生命周期状态机回归测试。
 * 不使用定时器：验证 React 重绘不会变成新请求，卡消失后同命令立即重现会变成新请求。
 */
const assert = require('node:assert/strict');

class ApprovalTracker {
  constructor() {
    this.nextId = 1;
    this.entries = new Map();
  }

  observe(keys) {
    const visible = new Set(keys);
    for (const key of visible) {
      if (!this.entries.has(key)) {
        this.entries.set(key, { id: this.nextId++, clicked: false, dangerReported: false });
      }
    }
    for (const key of this.entries.keys()) {
      if (!visible.has(key)) this.entries.delete(key);
    }
  }

  get(key) {
    return this.entries.get(key);
  }
}

const tracker = new ApprovalTracker();
const deleteKey = 'cmd:cmd /c rmdir /s /q safety-e2e-test';
const pythonKey = 'cmd:python testcontinue.py';

// 第一次发现高危卡。
tracker.observe([deleteKey]);
const firstDelete = tracker.get(deleteKey);
assert.equal(firstDelete.id, 1);
assert.equal(firstDelete.dangerReported, false);
firstDelete.dangerReported = true;

// React 重绘：相同命令卡仍可见，必须保留同一 requestId 且不可重复上报。
tracker.observe([deleteKey]);
assert.equal(tracker.get(deleteKey), firstDelete);
assert.equal(tracker.get(deleteKey).dangerReported, true);

// 人工确认后卡消失；紧接着同命令再次出现也必须是新的独立请求，不靠时间窗判断。
tracker.observe([]);
tracker.observe([deleteKey]);
const secondDelete = tracker.get(deleteKey);
assert.notEqual(secondDelete.id, firstDelete.id);
assert.equal(secondDelete.dangerReported, false);

// 普通审批卡被自动点击后发生重绘时不得再次点击。
tracker.observe([pythonKey]);
const python = tracker.get(pythonKey);
python.clicked = true;
tracker.observe([pythonKey]);
assert.equal(tracker.get(pythonKey), python);
assert.equal(tracker.get(pythonKey).clicked, true);

console.log('PASS: 审批卡生命周期状态机（重绘去重、消失释放、无时间窗口）');
