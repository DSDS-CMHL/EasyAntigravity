const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../core/storage');
const { compileJsPatternToOfficialTarget, toResource } = require('../scripts/rule-compile.cjs');

const ACTIONS = ['allow', 'deny', 'ask'];
const WEIGHT = { high: 3, medium: 2, low: 1 };
function riskLevel(severity) {
  if (['critical', 'high', '高'].includes(String(severity).toLowerCase())) return 'high';
  if (['low', '低'].includes(String(severity).toLowerCase())) return 'low';
  return 'medium';
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
    const active = document.enabled === false ? [] : document.rules.filter(rule => rule && rule.enabled !== false && rule.pattern);
    // Compile once when loading, rather than rebuilding every pattern for every command.
    const patterns = active.map(rule => {
      if (rule.action && !ACTIONS.includes(rule.action)) throw new Error(`无效的权限动作: ${rule.id}`);
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
    Object.assign(this, { document, active, patterns, knowledge, signatures });
    return this.summary();
  }

  summary() {
    return { dangerRulesTotal: this.document.rules.length, dangerRulesOn: this.active.length, kbRules: this.knowledge.length };
  }

  compile(action) {
    if (action !== undefined && !ACTIONS.includes(action)) throw new Error('权限动作必须是 Allow / Deny / Ask');
    const lists = { allow: [], deny: [], ask: [] };
    for (const rule of this.active) {
      const list = action || rule.action || 'ask';
      lists[list].push(toResource(compileJsPatternToOfficialTarget(rule.pattern)));
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
      root_cause: rule.root_cause || rule.description || rule.name || ''
    }));
    const danger = collect(this.patterns, 'danger-rules');
    const eas = collect(this.signatures, 'ares');
    const all = [...danger, ...eas].sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]);
    if (!all.length) return null;
    const level = all[0].severity;
    const primary = all.find(hit => hit.severity === level && hit.destructive_impact) || all[0];
    return {
      level, levelLabel: { high: '高风险', medium: '中风险', low: '低风险' }[level],
      primary, danger, eas: eas.slice(0, 3)
    };
  }
}

module.exports = { RuleEngine, ACTIONS, riskLevel };
