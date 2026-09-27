/*
 * ARES 文案质量：危害描述必须具体、可执行，禁止空话。
 * 只读文件与字符串断言，不执行任何命令。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const feed = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'rules', 'feeds', 'ares-signatures.json'), 'utf8')
);
const sig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'Agentguard-dev', 'src', 'rules', 'signatures.json'), 'utf8')
);

const vague = [
  '数据丢失。',
  '协作数据丢失。',
  '莫名其妙',
  '等等',
  '之类的',
  '相关问题',
  '不良后果',
  '可能有问题'
];

let checked = 0;
for (const r of feed.rules) {
  const impact = String(r.destructive_impact || '');
  assert.ok(impact.length >= 15, `${r.id} 可能后果过短: ${impact}`);
  assert.ok(impact.length <= 220, `${r.id} 可能后果过长`);
  for (const bad of vague) {
    assert.ok(!impact.includes(bad), `${r.id} 可能后果含空话「${bad}」: ${impact}`);
  }
  assert.ok(String(r.safe_alternative || '').length >= 10, `${r.id} 缺少可执行的替代方案`);
  assert.ok(String(r.root_cause || '').length >= 10, `${r.id} 缺少成因说明`);
  // 同步到 signatures.json 的条目文案必须一致
  const inSig = sig.rules.find((x) => x.id === r.id);
  assert.ok(inSig, `${r.id} 未合入 signatures.json`);
  assert.equal(inSig.destructive_impact, impact, `${r.id} signatures 与 feed 危害文案不一致`);
  checked += 1;
}

// 专项：git force push 必须说清「覆盖远端 / 丢失他人提交」
const gitPush = feed.rules.find((r) => r.id === 'ARES-223');
assert.ok(gitPush);
assert.match(gitPush.destructive_impact, /远端|覆盖|丢弃/);
assert.match(gitPush.destructive_impact, /提交|历史/);
assert.match(gitPush.safe_alternative, /force-with-lease/);

console.log(`PASS: ARES copy quality (${checked} rules)`);
