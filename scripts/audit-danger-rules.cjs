// Read-only text audit. Does not instantiate a disk-backed RuleEngine, connect
// to AG, spawn a shell, or execute any probe. Native results still require AG.
const fs = require('node:fs');
const path = require('node:path');
const { RuleEngine } = require('../features/rules');
const { simulateOfficialMatch } = require('./rule-compile.cjs');
const probes = require('../test/fixtures/extended-attack-probes.cjs');

function audit(rootDir = path.resolve(__dirname, '..')) {
  const read = file => JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf8'));
  const document = read('danger-rules.json');
  const knowledge = read('knowledge/signatures.json');
  const compile = rules => rules.filter(rule => rule?.pattern && rule.enabled !== false)
    .map(rule => ({ rule, regex: new RegExp(rule.pattern, rule.flags === undefined ? 'i' : rule.flags) }));
  const patterns = document.enabled === false ? [] : compile(document.rules);
  const engine = Object.assign(Object.create(RuleEngine.prototype), {
    document, active: patterns.map(item => item.rule), patterns, signatures: compile(knowledge.rules)
  });
  const resources = engine.compile();
  return probes.map(probe => {
    const nativeAsk = resources.ask.some(resource => simulateOfficialMatch(resource, probe.command));
    const nativeDeny = resources.deny.some(resource => simulateOfficialMatch(resource, probe.command));
    const hits = patterns.filter(({ regex }) => { regex.lastIndex = 0; return regex.test(probe.command); });
    const jsHits = hits.map(({ rule }) => rule.id);
    const jsAsk = hits.some(({ rule }) => (rule.action || 'ask') === 'ask');
    const jsDeny = hits.some(({ rule }) => rule.action === 'deny');
    const risk = engine.assess(probe.command);
    return {
      ...probe, predictedApproval: nativeDeny ? 'Deny' : nativeAsk ? 'Ask' : '自动执行',
      approvalMatches: !nativeDeny && nativeAsk === probe.expectedAsk,
      jsHits, compilerAgrees: nativeAsk === jsAsk && nativeDeny === jsDeny,
      predictedNotification: risk ? risk.levelLabel + ' / ' + risk.primary.name : '无',
      notificationMatches: probe.expectedNotification === null ? null : Boolean(risk) === probe.expectedNotification
    };
  });
}

if (require.main === module) {
  const rows = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const row of rows) console.log(`${row.id} ${row.approvalMatches ? 'PASS' : 'GAP'} ${row.name}: ${row.predictedApproval}; ARES: ${row.predictedNotification}`);
    console.log(`审批符合预期 ${rows.filter(row => row.approvalMatches).length}/${rows.length}; 通知差异 ${rows.filter(row => row.notificationMatches === false).length}; 编译差异 ${rows.filter(row => !row.compilerAgrees).length}`);
  }
  if (rows.some(row => !row.approvalMatches || row.notificationMatches === false || !row.compilerAgrees)) process.exitCode = 1;
}

module.exports = { audit };
