const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../core/storage');
const { compileJsPatternToOfficialTarget, toResource } = require('../scripts/rule-compile.cjs');
const { protectionRules } = require('./protection');

const ACTIONS = ['allow', 'deny', 'ask'];
const WEIGHT = { high: 3, medium: 2, low: 1 };
function riskLevel(severity) {
  if (['critical', 'high', '高'].includes(String(severity).toLowerCase())) return 'high';
  if (['low', '低'].includes(String(severity).toLowerCase())) return 'low';
  return 'medium';
}

function migrateDefaultPatterns(document, bundled) {
  let migrated = false;
  for (const rule of document.rules) {
    const stock = bundled.rules?.find(item => item.id === rule?.id);
    if (stock?.previous_patterns?.includes(rule.pattern) && (rule.flags === undefined || rule.flags === stock.flags)) {
      rule.pattern = stock.pattern;
      migrated = true;
    }
  }
  return migrated;
}

class RuleEngine {
  constructor({ rootDir, dataDir }) {
    this.rootDir = rootDir;
    this.file = path.join(dataDir, 'danger-rules.json');
    this.reload();
  }

  reload() {
    const bundled = readJson(path.join(this.rootDir, 'danger-rules.json'));
    if (!fs.existsSync(this.file)) writeJson(this.file, bundled);
    const document = readJson(this.file);
    if (!Array.isArray(document.rules)) throw new Error('权限规则文件缺少 rules 数组');
    // Upgrade only known, untouched stock patterns. User actions, switches and
    // custom expressions remain theirs; unknown patterns are never replaced.
    const migrated = migrateDefaultPatterns(document, bundled);
    const active = document.enabled === false ? [] : document.rules.filter(rule => rule && rule.enabled !== false && rule.pattern);
    // Compile once when loading, rather than rebuilding every pattern for every command.
    const patterns = active.map(rule => {
      if (rule.action && !ACTIONS.includes(rule.action)) throw new Error(`无效的权限动作: ${rule.id}`);
      try { compileJsPatternToOfficialTarget(rule.pattern, rule.flags === undefined ? 'i' : rule.flags); }
      catch (error) { throw new Error(`权限规则 ${rule.id || '(未命名)'} 编译失败: ${error.message}`); }
      return { rule, regex: new RegExp(rule.pattern, rule.flags === undefined ? 'i' : rule.flags) };
    });
    const candidates = [
      path.join(this.rootDir, 'knowledge', 'signatures.json'),
      path.join(this.rootDir, 'Agentguard-dev', 'src', 'rules', 'signatures.json'),
      path.join(path.dirname(this.file), 'knowledge', 'signatures.json')
    ];
    const knowledgeFile = candidates.find(file => fs.existsSync(file));
    const knowledge = knowledgeFile ? (readJson(knowledgeFile).rules || []) : [];
    if (!Array.isArray(knowledge)) throw new Error('风险知识库缺少 rules 数组');
    const signatures = knowledge.filter(rule => rule?.pattern && rule.enabled !== false).flatMap(rule => {
      try { return [{ rule, regex: new RegExp(rule.pattern, rule.flags === undefined ? 'i' : rule.flags) }]; }
      catch { return []; }
    });
    // A failed reload must leave the previous working engine intact.
    if (migrated) writeJson(this.file, document);
    Object.assign(this, { bundled, document, active, patterns, knowledge, signatures });
    return this.summary();
  }

  summary(protectionLevel = 'standard') {
    return { dangerRulesTotal: this.document.rules.length,
      dangerRulesOn: protectionRules(this.active, this.bundled, protectionLevel).length, kbRules: this.knowledge.length };
  }

  compile(action, protectionLevel = 'standard') {
    if (action !== undefined && !ACTIONS.includes(action)) throw new Error('权限动作必须是 Allow / Deny / Ask');
    const lists = { allow: [], deny: [], ask: [] };
    for (const rule of protectionRules(this.active, this.bundled, protectionLevel)) {
      const list = action || rule.action || 'ask';
      lists[list].push(toResource(compileJsPatternToOfficialTarget(rule.pattern, rule.flags === undefined ? 'i' : rule.flags)));
    }
    for (const list of ACTIONS) lists[list] = [...new Set(lists[list])];
    return lists;
  }

  assess(command) {
    if (!command) return null;
    const collect = (patterns, source) => patterns.filter(({ regex }) => {
      regex.lastIndex = 0;
      return regex.test(command);
    }).map(({ rule }) => ({
      ...rule, severity: riskLevel(rule.severity), source,
      root_cause: rule.root_cause || ''
    }));
    const danger = collect(this.patterns, 'danger-rules');
    const eas = collect(this.signatures, 'ares');
    // A pipe alone is context, not evidence of remote execution. Keep other
    // advisory signatures active; suppress only explicitly context-only hits.
    const explanations = eas.filter(hit => hit.notification_policy !== 'context-only');
    const all = [...danger, ...explanations].sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]
      || (Number(b.priority) || 0) - (Number(a.priority) || 0));
    if (!all.length) return null;
    const level = all[0].severity;
    const primary = explanations.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]
      || (Number(b.priority) || 0) - (Number(a.priority) || 0)).find(hit => hit.destructive_impact) || {
      ...all[0],
      root_cause: '命令命中了需要人工确认的操作特征；实际影响取决于目标、参数和权限。',
      destructive_impact: '请核对操作对象和影响范围，确认不是误选路径、数据或系统资源后再执行。',
      safe_alternative: '先使用对应工具的只读查询或预览功能；涉及修改时，先备份需要保留的数据。'
    };
    return {
      level, levelLabel: { high: '高风险', medium: '中风险', low: '低风险' }[level],
      primary, danger, eas: eas.slice(0, 3)
    };
  }
}

module.exports = { RuleEngine, ACTIONS, riskLevel, migrateDefaultPatterns };
