/*
 * 高危规则的纯逻辑回归测试。
 *
 * 只把命令作为字符串匹配，绝不会执行样例中的任何命令。
 * 运行：npm run test:danger-rules
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rulesPath = path.join(__dirname, '..', 'danger-rules.json');
const config = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

function activeRules(input = config) {
  if (input.enabled === false) return [];
  return (input.rules || [])
    .filter(rule => rule && rule.enabled !== false)
    .map(rule => ({ ...rule, re: new RegExp(rule.pattern, rule.flags || 'i') }));
}

function match(command, input = config) {
  return activeRules(input).find(rule => rule.re.test(command)) || null;
}

const blockedCases = [
  ['fs-recursive-delete', 'rm -rf /tmp/demo'],
  ['fs-recursive-delete', 'rm -fr ./build'],
  ['fs-recursive-delete', 'rm -r -f ./build'],
  ['fs-recursive-delete', 'rm --recursive --force ./build'],
  ['fs-recursive-delete', 'rmdir /s /q C:\\temp\\demo'],
  ['disk-destroy', 'format D: /q'],
  ['disk-destroy', 'Format-Volume -DriveLetter D'],
  ['disk-destroy', 'wipefs -a /dev/sdb'],
  ['disk-destroy', 'mkfs.ext4 /dev/sdb'],
  ['db-destroy', 'DROP TABLE audit_log;'],
  ['git-destructive', 'git push origin main --force'],
  ['shutdown', 'shutdown /s /t 0'],
  ['priv-escalation', 'sudo rm ./temporary-file'],
  ['raw-device-write', 'dd if=image.iso of=/dev/sdb bs=4M'],
  ['chmod-dangerous', 'chmod -R 777 /']
];

const allowedCases = [
  'npm test',
  'git push origin main',
  'rm ./build/output.txt',
  'git status --short',
  'node --check server.js',
  'SELECT * FROM users',
  'Get-NetTCPConnection -LocalPort 9222 | Format-Table -AutoSize',
  'Invoke-RestMethod -Uri "http://127.0.0.1:9222/json" | Select-Object | Format-List',
  'npm run format',
  'git log --format="%h %s"',
  'clang-format -i main.cpp',
  'git add -A; git commit -m "fix(security): refine disk-wipe regex to prevent false positives on Format-Table/Format-List"'
];

let checks = 0;
for (const [ruleId, command] of blockedCases) {
  const hit = match(command);
  assert.ok(hit, `应该拦截：${command}`);
  assert.equal(hit.id, ruleId, `规则不正确：${command}`);
  checks++;
}

for (const command of allowedCases) {
  assert.equal(match(command), null, `不应拦截：${command}`);
  checks++;
}

const disabledOne = structuredClone(config);
disabledOne.rules.find(rule => rule.id === 'shutdown').enabled = false;
assert.equal(match('shutdown /s /t 0', disabledOne), null, '单条禁用后不应拦截');
checks++;

const disabledAll = structuredClone(config);
disabledAll.enabled = false;
assert.equal(match('rm -rf /tmp/demo', disabledAll), null, '总开关关闭后不应拦截');
checks++;

console.log(`PASS: ${checks} 项高危规则熔断检查通过（仅字符串匹配，未执行命令）`);
