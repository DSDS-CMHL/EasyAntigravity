/**
 * EasyAntigravity 标准自动化测试工作流 (本地环境保留测试套件)
 * 覆盖完整的 8 阶段闭环验证：
 *  ① 自动审批 (Auto-approval)
 *  ② 危险拦截 (High-risk command interception)
 *  ③ 拦截之后解锁（恢复自动审批）(Post-interception unlock & resume)
 *  ④ 问答卡片停止交互 (Dialogue / question card pause)
 *  ⑤ 问答方案之后的解锁（恢复自动审批）(Post-question unlock & resume)
 *  ⑥ 规则重载 (Dynamic danger rule reload)
 *  ⑦ 重载之后的拦截 (Interception verified with newly reloaded rule)
 *  ⑧ 最后查看日志进行校对 (Comprehensive log verification & audit)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── 1. 模拟 DOM 简易对象模型 ──
class MockElement {
  constructor(tagName, attrs = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attrs));
    this.innerText = text;
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.checked = false;
    this.disabled = false;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    selector = selector.trim();
    if (selector.toLowerCase() === 'input' || selector.toLowerCase() === 'button' || selector.toLowerCase() === 'div') {
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    if (selector.startsWith('[role="') && selector.endsWith('"]')) {
      const role = selector.slice(7, -2);
      return this.getAttribute('role') === role;
    }
    if (selector.startsWith('[data-testid*="') && selector.endsWith('"]')) {
      const kw = selector.slice(15, -2);
      return (this.getAttribute('data-testid') || '').includes(kw);
    }
    if (selector.startsWith('div[class*="') && selector.endsWith('"]')) {
      const kw = selector.slice(12, -2);
      return this.tagName === 'DIV' && (this.getAttribute('class') || '').includes(kw);
    }
    if (selector.includes('role="radiogroup"')) {
      return this.getAttribute('role') === 'radiogroup';
    }
    if (selector === 'button' || selector.startsWith('button')) {
      return this.tagName === 'BUTTON';
    }
    return false;
  }

  querySelectorAll(selector) {
    const res = [];
    function walk(el) {
      for (const ch of el.children) {
        if (ch.matches(selector)) res.push(ch);
        walk(ch);
      }
    }
    walk(this);
    return res;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }
}

class MockDocument extends MockElement {
  constructor() {
    super('#DOCUMENT');
    this.body = new MockElement('BODY');
    this.appendChild(this.body);
  }
}

// ── 2. 测试状态机与模拟环境 ──
const logs = [];
function recordLog(tag, content, colorClass) {
  logs.push({
    time: new Date().toLocaleTimeString(),
    tag,
    content,
    colorClass
  });
}

const mockWindow = {
  __ea_config: {
    autoAccept: true,
    blockDangerous: true,
    preferOption: 1,
    enableI18n: true
  },
  __ea_danger_lock: null,
  __ea_processed_roots: new WeakSet(),
  __ea_reported_roots: new WeakSet()
};

// ── 3. 加载高危规则库 ──
const rulesFilePath = path.join(__dirname, '..', 'danger-rules.json');
let dangerConfig = JSON.parse(fs.readFileSync(rulesFilePath, 'utf8'));

function compileDangerPatterns(config) {
  if (config.enabled === false) return [];
  return (config.rules || [])
    .filter(r => r && r.enabled !== false)
    .map(r => ({
      id: r.id,
      name: r.name || r.id,
      pattern: r.pattern,
      re: new RegExp(r.pattern, r.flags || 'i')
    }));
}

let activePatterns = compileDangerPatterns(dangerConfig);

// ── 4. 核心判定引擎（映射自 server.js 注入脚本） ──
function isQuestionCard(card) {
  if (!card) return false;
  const rgs = card.querySelectorAll('[role="radiogroup"]');
  if (!rgs.length) return false;
  const txt = (rgs[rgs.length - 1].innerText || '').toLowerCase();
  const isPerm = (txt.includes('allow') && (txt.includes('this time') || txt.includes('always'))) ||
                 (txt.includes('允许') && (txt.includes('本次') || txt.includes('始终') || txt.includes('总是')));
  return !isPerm;
}

function checkDangerous(doc) {
  if (!mockWindow.__ea_config.blockDangerous || !doc) return false;
  const buttons = doc.querySelectorAll('button');
  const pendingBtn = buttons.find(b => !b.disabled && b.getAttribute('data-ea-ok') !== 'true');
  if (!pendingBtn) {
    mockWindow.__ea_danger_lock = null;
    return false;
  }
  if (pendingBtn.getAttribute('data-ea-ok') === 'blocked') {
    return true;
  }
  const cmd = pendingBtn.getAttribute('data-ea-cmd') || '';
  if (cmd) {
    const hit = activePatterns.find(r => r.re.test(cmd));
    if (hit) {
      mockWindow.__ea_danger_lock = { id: hit.id, name: hit.name, cmd };
      pendingBtn.setAttribute('data-ea-ok', 'blocked');
      recordLog('SECURITY ALERT', `拦截高危指令[${hit.id}]，等待用户手动确认: ${cmd}`, 'tag-alert');
      return true;
    }
  }
  mockWindow.__ea_danger_lock = null;
  return false;
}

function processScan(doc) {
  if (!mockWindow.__ea_config.autoAccept) return;
  if (checkDangerous(doc)) return;

  const radioGroups = doc.querySelectorAll('[role="radiogroup"]');
  for (const rg of radioGroups) {
    const txt = (rg.innerText || '').toLowerCase();
    const isPermission = (txt.includes('allow') && (txt.includes('this time') || txt.includes('always'))) ||
                         (txt.includes('允许') && (txt.includes('本次') || txt.includes('始终') || txt.includes('总是')));
    if (!isPermission) {
      // 方案问答卡片：记录 mint 青色日志，停止自动放行
      if (!rg.hasAttribute('data-ea-interact-reported')) {
        rg.setAttribute('data-ea-interact-reported', 'true');
        recordLog('INTERACTION', `方案问答：${rg.innerText.slice(0, 40)}`, 'tag-mint');
      }
      continue;
    }

    // 权限卡片：自动勾选并放行
    const radios = rg.querySelectorAll('input');
    const optIdx = mockWindow.__ea_config.preferOption - 1;
    if (radios[optIdx]) {
      radios[optIdx].checked = true;
    }
    const submitBtn = doc.querySelectorAll('button').find(b => (b.innerText || '').includes('Submit') || (b.innerText || '').includes('Allow'));
    if (submitBtn && !submitBtn.hasAttribute('data-ea-ok')) {
      submitBtn.setAttribute('data-ea-ok', 'true');
      const cmd = submitBtn.getAttribute('data-ea-cmd') || 'normal-cmd';
      recordLog('AUTO-ACCEPT', `放行 · 选项[${mockWindow.__ea_config.preferOption}] 仅允许本次 · ${cmd}`, 'tag-proxy');
      return;
    }
  }

  // 独立无选项组按钮放行
  const submitBtns = doc.querySelectorAll('button');
  for (const btn of submitBtns) {
    if (btn.disabled || btn.hasAttribute('data-ea-ok')) continue;
    const root = btn.closest('[role="dialog"]') || btn.parentElement;
    if (isQuestionCard(root)) continue;
    const text = (btn.innerText || '').toLowerCase();
    if (text.includes('allow') || text.includes('continue') || text.includes('submit') || text.includes('允许')) {
      btn.setAttribute('data-ea-ok', 'true');
      const cmd = btn.getAttribute('data-ea-cmd') || 'standalone-cmd';
      recordLog('AUTO-ACCEPT', `自动审批通过 · ${cmd}`, 'tag-proxy');
      return;
    }
  }
}

// ── 5. 执行 8 阶段标准测试流程 ──
console.log('================================================================');
console.log('   EasyAntigravity 标准自动化测试工作流 (本地闭环回归套件)   ');
console.log('================================================================\n');

const testAuditTable = [];

// 阶段 ①：自动审批测试
{
  const doc = new MockDocument();
  const card = new MockElement('DIV', { role: 'dialog', class: 'card' });
  const rg = new MockElement('DIV', { role: 'radiogroup' }, 'Allow this time\nAlways allow');
  const radio1 = new MockElement('INPUT', { type: 'radio' });
  const radio2 = new MockElement('INPUT', { type: 'radio' });
  rg.appendChild(radio1);
  rg.appendChild(radio2);
  const btn = new MockElement('BUTTON', { 'data-ea-cmd': 'npm run build' }, 'Allow');
  card.appendChild(rg);
  card.appendChild(btn);
  doc.body.appendChild(card);

  processScan(doc);

  assert.equal(btn.getAttribute('data-ea-ok'), 'true', '阶段①失败：安全命令未自动放行');
  assert.equal(radio1.checked, true, '阶段①失败：未按 preferOption=1 勾选选项1');
  testAuditTable.push({ stage: '1. 自动审批', status: 'PASS', detail: '安全命令 [npm run build] 自动审批通过，选项1勾选' });
}

// 阶段 ②：高危指令熔断拦截测试
let dangerousDoc = null;
let dangerousBtn = null;
{
  dangerousDoc = new MockDocument();
  const card = new MockElement('DIV', { role: 'dialog', class: 'card' });
  const rg = new MockElement('DIV', { role: 'radiogroup' }, 'Allow this time\nAlways allow');
  const radio1 = new MockElement('INPUT', { type: 'radio' });
  rg.appendChild(radio1);
  dangerousBtn = new MockElement('BUTTON', { 'data-ea-cmd': 'git push origin main --force' }, 'Allow');
  card.appendChild(rg);
  card.appendChild(dangerousBtn);
  dangerousDoc.body.appendChild(card);

  processScan(dangerousDoc);

  assert.equal(dangerousBtn.getAttribute('data-ea-ok'), 'blocked', '阶段②失败：高危命令未被标记为 blocked');
  assert.ok(mockWindow.__ea_danger_lock, '阶段②失败：高危锁定标志位未激活');
  assert.equal(mockWindow.__ea_danger_lock.id, 'git-force-push', '阶段②失败：拦截规则识别错误');
  testAuditTable.push({ stage: '2. 危险拦截', status: 'PASS', detail: '高危命令 [git push --force] 成功触发熔断并锁定' });
}

// 阶段 ③：拦截后手动解锁与自动审批恢复测试
{
  // 模拟用户手动点击确认或卡片关闭（卡片移出 DOM）
  dangerousDoc.body.children = [];
  assert.equal(checkDangerous(dangerousDoc), false, '卡片关闭后 checkDangerous 应返回 false');
  assert.equal(mockWindow.__ea_danger_lock, null, '阶段③失败：卡片解决后未自动清除高危锁定');

  // 随后紧接着出现新的正常命令卡片
  const docAfterUnlock = new MockDocument();
  const nextBtn = new MockElement('BUTTON', { 'data-ea-cmd': 'git status' }, 'Allow');
  docAfterUnlock.body.appendChild(nextBtn);

  processScan(docAfterUnlock);

  assert.equal(nextBtn.getAttribute('data-ea-ok'), 'true', '阶段③失败：解锁后后续命令未恢复自动审批');
  testAuditTable.push({ stage: '3. 拦截后解锁恢复', status: 'PASS', detail: '高危卡片关闭后锁定立即解除，后续安全命令顺利放行' });
}

// 阶段 ④：方案问答卡片停止交互测试
let questionDoc = null;
let questionBtn = null;
{
  questionDoc = new MockDocument();
  const card = new MockElement('DIV', { role: 'dialog', class: 'card' });
  // 方案问答选项（不包含 allow / 允许 特征词）
  const rg = new MockElement('DIV', { role: 'radiogroup' }, '选项A: 采用方案1进行重构\n选项B: 采用方案2进行微调');
  const optA = new MockElement('INPUT', { type: 'radio' });
  const optB = new MockElement('INPUT', { type: 'radio' });
  rg.appendChild(optA);
  rg.appendChild(optB);
  questionBtn = new MockElement('BUTTON', {}, 'Submit');
  card.appendChild(rg);
  card.appendChild(questionBtn);
  questionDoc.body.appendChild(card);

  assert.equal(isQuestionCard(card), true, '未能将业务问答卡识别为 QuestionCard');

  processScan(questionDoc);

  assert.equal(questionBtn.hasAttribute('data-ea-ok'), false, '阶段④失败：方案问答按钮被误自动点击！');
  assert.equal(rg.getAttribute('data-ea-interact-reported'), 'true', '阶段④失败：问答卡未标记上报');
  testAuditTable.push({ stage: '4. 问答卡片停止交互', status: 'PASS', detail: '方案问答卡识别成功，自动审批绝对停止，等待人工选择' });
}

// 阶段 ⑤：方案问答提交之后的解锁与恢复测试
{
  // 模拟用户手动完成问答，问答卡从 DOM 中移除
  questionDoc.body.children = [];

  // 随后 Agent 发起下一步正常的命令审批卡
  const docAfterQuestion = new MockDocument();
  const postQuestionBtn = new MockElement('BUTTON', { 'data-ea-cmd': 'python verify.py' }, 'Allow');
  docAfterQuestion.body.appendChild(postQuestionBtn);

  processScan(docAfterQuestion);

  assert.equal(postQuestionBtn.getAttribute('data-ea-ok'), 'true', '阶段⑤失败：问答结束后后续任务未恢复自动审批');
  testAuditTable.push({ stage: '5. 问答后恢复审批', status: 'PASS', detail: '人工提交问答后，后续工具卡片无缝恢复自动审批' });
}

// 阶段 ⑥：规则动态重载测试
{
  const customRuleId = 'custom-malicious-eval';
  const customPattern = '\\b(evil-script\\.sh|format-all-drives)\\b';
  
  // 动态追加自定义高危规则
  const reloadedConfig = structuredClone(dangerConfig);
  reloadedConfig.rules.push({
    id: customRuleId,
    name: '自定义破坏脚本',
    pattern: customPattern,
    flags: 'i',
    enabled: true
  });

  const prevCount = activePatterns.length;
  activePatterns = compileDangerPatterns(reloadedConfig);
  const newCount = activePatterns.length;

  assert.equal(newCount, prevCount + 1, '阶段⑥失败：规则库重载未生效');
  recordLog('SECURITY', `高危规则已重载: ${newCount}/${newCount} 条生效 (动态热重载测试)`, 'tag-proxy');
  testAuditTable.push({ stage: '6. 规则动态重载', status: 'PASS', detail: `成功加载并注册自定义规则 [${customRuleId}]，生效规则数 ${newCount}` });
}

// 阶段 ⑦：重载之后的拦截测试
{
  const testDocReload = new MockDocument();
  const card = new MockElement('DIV', { role: 'dialog' });
  const customEvilBtn = new MockElement('BUTTON', { 'data-ea-cmd': 'bash ./evil-script.sh --all' }, 'Allow');
  card.appendChild(customEvilBtn);
  testDocReload.body.appendChild(card);

  processScan(testDocReload);

  assert.equal(customEvilBtn.getAttribute('data-ea-ok'), 'blocked', '阶段⑦失败：重载后的自定义高危规则未生效拦截');
  assert.ok(mockWindow.__ea_danger_lock, '阶段⑦失败：高危锁定未触发');
  assert.equal(mockWindow.__ea_danger_lock.id, 'custom-malicious-eval', '阶段⑦失败：命中的规则 ID 不符');
  testAuditTable.push({ stage: '7. 重载后生效拦截', status: 'PASS', detail: '针对新注入的 evil-script.sh 精确触发拦截，未放行' });
}

// 阶段 ⑧：最后查看日志进行校对
{
  console.log('---------------- 8. 日志审计与校对清单 ----------------');
  console.table(logs.map((l, i) => ({
    序号: i + 1,
    时间: l.time,
    标签类型: l.tag,
    样式分类: l.colorClass,
    日志摘要: l.content.length > 55 ? l.content.slice(0, 52) + '...' : l.content
  })));

  // 校对关键日志的存在性与颜色类
  const hasAutoAccept = logs.some(l => l.tag === 'AUTO-ACCEPT' && l.colorClass === 'tag-proxy');
  const hasAlert = logs.some(l => l.tag === 'SECURITY ALERT' && l.colorClass === 'tag-alert');
  const hasInteractMint = logs.some(l => l.tag === 'INTERACTION' && l.colorClass === 'tag-mint');
  const hasSecurityReload = logs.some(l => l.tag === 'SECURITY' && l.colorClass === 'tag-proxy');

  assert.ok(hasAutoAccept, '校对缺失：AUTO-ACCEPT 放行日志');
  assert.ok(hasAlert, '校对缺失：SECURITY ALERT 高危拦截红色告警日志');
  assert.ok(hasInteractMint, '校对缺失：INTERACTION 方案问答薄荷青告警日志');
  assert.ok(hasSecurityReload, '校对缺失：SECURITY 规则重载日志');

  testAuditTable.push({ stage: '8. 全日志流校对', status: 'PASS', detail: '所有阶段产生的标签 (AUTO-ACCEPT/ALERT/INTERACT/SECURITY) 全部严格匹配' });
}

console.log('\n================ 测试工作流执行结果总结 ================');
console.table(testAuditTable);
console.log('🎉 恭喜：8 大标准测试阶段全部 PASS，状态机完整闭环无回归风险！\n');
