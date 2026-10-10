const fs = require('node:fs');
const path = require('node:path');

// Explicit maintenance command; never runs as part of startup or packaging.
const root = path.resolve(__dirname, '..');
const source = 'knowledge/signatures.json';
const document = JSON.parse(fs.readFileSync(path.join(root, source), 'utf8'));
const mirror = {
  ...document,
  generated_from: source,
  maintenance_note: '兼容或分发副本；请修改唯一源 knowledge/signatures.json 后同步，不在此文件独立维护。'
};
const targets = ['Agentguard-dev/src/rules/signatures.json', 'rules/feeds/ares-signatures.json'];
if (process.argv.length !== 3 || process.argv[2] !== '--write') {
  console.log('用法：node scripts/sync-knowledge.cjs --write（同步两个仓库内分发副本）');
  process.exitCode = 1;
} else {
  for (const target of targets) {
    // The legacy development scanner still expects uppercase severity values.
    const output = target.startsWith('Agentguard-dev/')
      ? { ...mirror, rules: mirror.rules.map(rule => ({ ...rule, severity: rule.severity.toUpperCase() })) }
      : mirror;
    fs.writeFileSync(path.join(root, target), JSON.stringify(output, null, 2) + '\n', 'utf8');
  }
  console.log(`已从 ${source} 同步 ${targets.length} 个副本`);
}
