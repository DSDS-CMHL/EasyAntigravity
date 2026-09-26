/**
 * 验证 danger-rules → 官方 regex 编译：
 * 1) 产出无字面空白（保持单 token）
 * 2) 无双重包裹
 * 3) 本地 simulateOfficialMatch 能命中带路径/带参的危险行
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  compileJsPatternToOfficialTarget,
  toResource,
  simulateOfficialMatch,
  compileRulesToResources
} = require('../scripts/rule-compile.cjs');

const rulesPath = path.join(__dirname, '..', 'danger-rules.json');
const data = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const resources = compileRulesToResources(data.rules);
assert.ok(resources.length >= 6, '应编译出多条规则');

for (const r of resources) {
  assert.ok(r.startsWith('command(regex:'), '应为 command(regex:…): ' + r.slice(0, 60));
  assert.ok(!r.startsWith('command(command('), '禁止双重包裹: ' + r.slice(0, 60));
  const body = r.slice('command(regex:'.length, -1);
  assert.ok(!/\s/.test(body), '单 token 不得含字面空白: ' + body.slice(0, 80));
}

function resourceOf(id) {
  const rule = data.rules.find(x => x.id === id && x.enabled !== false);
  assert.ok(rule, '缺少规则 ' + id);
  return toResource(compileJsPatternToOfficialTarget(rule.pattern));
}

// fs-recursive-delete 应命中带路径命令
const rmResource = resourceOf('fs-recursive-delete');
const cases = [
  ['rm -rf /tmp/x', true],
  ['rm -rf "F:\\path with spaces\\y"', true],
  ['rm -fr /var/tmp', true],
  ['rm /tmp/keep', false],
  ['echo probe-alpha', false]
];
for (const [cmd, want] of cases) {
  const got = simulateOfficialMatch(rmResource, cmd);
  assert.strictEqual(got, want, `rm 规则对 "${cmd}" 期望 ${want} 得到 ${got} resource=${rmResource.slice(0, 80)}`);
}

// 同一合并规则应覆盖 del/rmdir
const del = resourceOf('fs-recursive-delete');
assert.strictEqual(simulateOfficialMatch(del, 'del /s /q "D:\\junk"'), true);
assert.strictEqual(simulateOfficialMatch(del, 'dir'), false);

// disk-destroy 不得误伤 Format-Table
const disk = resourceOf('disk-destroy');
assert.strictEqual(simulateOfficialMatch(disk, 'format D: /q'), true);
assert.strictEqual(simulateOfficialMatch(disk, 'Get-Process | Format-Table'), false);

// 编译函数与 toResource
const t = compileJsPatternToOfficialTarget('\\becho\\s+probe');
assert.strictEqual(t, 'regex:.*(?:\\becho\\s+probe).*');
assert.strictEqual(toResource('command(command(regex:x))'), 'command(regex:x)');
assert.strictEqual(simulateOfficialMatch('command(regex:.*(?:\\becho\\s+probe).*)', 'echo probe-alpha'), true);
assert.strictEqual(simulateOfficialMatch('command(regex:echo hello)', 'echo hello world'), false);
assert.strictEqual(simulateOfficialMatch('command(regex:echo .*)', 'echo hello world'), true);
assert.strictEqual(simulateOfficialMatch('command(echo hello)', 'echo hello world'), false);
assert.strictEqual(simulateOfficialMatch('command(echo hello)', 'echo hello'), true);

console.log('PASS: rule-compile 编译与本地语义匹配（rm/del 路径用例）');
