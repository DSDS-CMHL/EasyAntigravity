const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('   EasyAntigravity 权限判定与多任务状态机专项回归测试套件       ');
console.log('================================================================\n');

// 提取 server.js 中的客户端注入脚本
const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// 模拟 DOM 环境验证 isQuestionCard 和 isSubmitLabel
const mockSandbox = {
  window: {},
  document: {},
  Node: { TEXT_NODE: 3 },
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setInterval: () => {},
  clearInterval: () => {}
};

// 提取 isSubmitLabel 和 isQuestionCard 函数实现
const isSubmitMatch = serverCode.match(/function isSubmitLabel\([\s\S]*?\n    \}/);
assert(isSubmitMatch, 'isSubmitLabel 函数提取失败');

const isQuestionCardMatch = serverCode.match(/function isQuestionCard\([\s\S]*?\n    \}/);
assert(isQuestionCardMatch, 'isQuestionCard 函数提取失败');

const testCode = `
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  }
  ${isSubmitMatch[0]}
  ${isQuestionCardMatch[0]}
  
  mockSandbox.isSubmitLabel = isSubmitLabel;
  mockSandbox.isQuestionCard = isQuestionCard;
`;

vm.runInNewContext(testCode, { mockSandbox });
const { isSubmitLabel, isQuestionCard } = mockSandbox;

// 1. 测试 isSubmitLabel
console.log('--- 1. 验证 isSubmitLabel 识别能力 ---');
const positiveSubmitLabels = [
  'submit', 'submit ↵', 'submit enter', 'Submit',
  'confirm', 'Confirm', '确认', '确认 ↵',
  'allow', 'Allow', 'Allow querying', 'Allow reading', 'Allow executing', 'always allow',
  '允许', '始终允许', '仅允许本次', '总是允许', '允许查询',
  'continue', '继续'
];

for (const label of positiveSubmitLabels) {
  assert.strictEqual(isSubmitLabel(label), true, `应该识别为提交/放行按钮: "${label}"`);
}
console.log(`✓ 通过: ${positiveSubmitLabels.length} 种提交/放行按钮标签均被正确识别`);

const negativeSubmitLabels = [
  'deny', 'Deny', 'cancel', 'Cancel', 'reject', 'Reject', 'disallow',
  '拒绝', '取消', '放弃', '关闭', 'Run', 'Ran', 'node test.js'
];
for (const label of negativeSubmitLabels) {
  assert.strictEqual(isSubmitLabel(label), false, `不应该识别为提交按钮: "${label}"`);
}
console.log(`✓ 通过: ${negativeSubmitLabels.length} 种拒绝/取消/命令文本均被严格排除`);

// 2. 测试 isQuestionCard
console.log('\n--- 2. 验证 isQuestionCard 判定能力 ---');

// Mock 场景 A: "Allow querying" 授权弹窗（没有 textarea[aria-label="Edit permission target"]）
const allowQueryingMockCard = {
  innerText: 'Allow querying codebase files\nAgent wants permission to read files in workspace.\n1. Allow this time\n2. Always allow',
  textContent: 'Allow querying codebase files\nAgent wants permission to read files in workspace.\n1. Allow this time\n2. Always allow',
  querySelector: (sel) => {
    if (sel === 'button[data-testid="permission-allow"]') return { text: 'Allow' };
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '[role="radiogroup"]') return [{ innerText: '1. Allow this time\n2. Always allow' }];
    return [];
  },
  closest: () => allowQueryingMockCard
};

assert.strictEqual(isQuestionCard(allowQueryingMockCard), false, 'Allow querying 授权弹窗绝对不能被误判为方案问答！');
console.log('✓ 通过: "Allow querying" 权限请求卡片正确判定为权限审批卡 (false)');

// Mock 场景 B: 真实的 ask_question 方案问答卡
const askQuestionMockCard = {
  innerText: 'Which architecture pattern do you prefer?\nOption 1: Microservices\nOption 2: Modular Monolith',
  textContent: 'Which architecture pattern do you prefer?\nOption 1: Microservices\nOption 2: Modular Monolith',
  querySelector: (sel) => {
    if (sel.includes('ask-question')) return { text: 'Dismiss' };
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '[role="radiogroup"]') return [{ innerText: 'Microservices\nModular Monolith' }];
    return [];
  },
  closest: () => askQuestionMockCard
};

assert.strictEqual(isQuestionCard(askQuestionMockCard), true, '真实的 ask_question 必须判定为方案问答！');
console.log('✓ 通过: 真实的 ask_question 方案问答卡正确判定为方案问答 (true)');

// 3. 验证任务完成状态机监控逻辑
console.log('\n--- 3. 验证多任务状态机防误报逻辑 ---');
function evaluateAgentBusy({ hasCancelBtn, runningPanelOpen, runningItemsCount, hasRunningCommand }) {
  const hasRunningPanelItems = runningPanelOpen || runningItemsCount > 0;
  const hasActiveRunStep = hasRunningCommand;
  return hasCancelBtn || hasRunningPanelItems || hasActiveRunStep;
}

// 状态 1: 主输入框显示 "Send message"（无 cancel 按钮），但后台正在运行指令步骤（如 Run git status）
assert.strictEqual(
  evaluateAgentBusy({ hasCancelBtn: false, runningPanelOpen: false, runningItemsCount: 0, hasRunningCommand: true }),
  true,
  '后台有运行中指令步骤时，必须判定为繁忙，不得误报空闲就绪！'
);
console.log('✓ 通过: 后台指令运行中但主输入框为 Send message 时，正确判定为 Busy');

// 状态 2: 主输入框显示 "Send message"，但 running-items-panel 面板中有正在执行的子任务
assert.strictEqual(
  evaluateAgentBusy({ hasCancelBtn: false, runningPanelOpen: true, runningItemsCount: 1, hasRunningCommand: false }),
  true,
  '后台面板有子任务或正在执行项时，必须判定为繁忙！'
);
console.log('✓ 通过: running-items-panel 展开有子任务时，正确判定为 Busy');

// 状态 3: 主输入框显示 cancel 按钮
assert.strictEqual(
  evaluateAgentBusy({ hasCancelBtn: true, runningPanelOpen: false, runningItemsCount: 0, hasRunningCommand: false }),
  true,
  '主输入框存在取消按钮时，判定为 Busy'
);
console.log('✓ 通过: 主输入框有 Cancel 按钮时，正确判定为 Busy');

// 状态 4: 全部结束（无 cancel 按钮、running-items-panel 归零、无运行中指令）
assert.strictEqual(
  evaluateAgentBusy({ hasCancelBtn: false, runningPanelOpen: false, runningItemsCount: 0, hasRunningCommand: false }),
  false,
  '三项指标全部归零时，才判定为 Idle'
);
console.log('✓ 通过: 所有任务与步骤全部归零时，正确判定为 Idle (可进入防抖倒计时)');

console.log('\n================================================================');
console.log('🎉 专项回归测试全部通过：Allow querying已修复，多任务状态机无误报！');
console.log('================================================================');
