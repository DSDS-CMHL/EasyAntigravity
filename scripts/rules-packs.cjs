#!/usr/bin/env node
/**
 * 规则包可持续更新：本地 danger-rules.json + 远端 feed 合并
 *
 * 设计:
 *   feed JSON: { pack, version, updated_at, rules: [...] }  见 rules/feeds/*.json
 *   本地用户改动永远优先: enabled=false / 同 id 自定义 pattern
 *   合并策略: 按 id 更新 description/pattern（若本地未改 pattern 且未 disable）
 *   未来可从 URL 拉 feed（--fetch），离线时用 rules/feeds/ 缓存
 *
 * 用法:
 *   node scripts/rules-packs.cjs show
 *   node scripts/rules-packs.cjs validate [path]
 *   node scripts/rules-packs.cjs merge <feed.json>
 *   node scripts/rules-packs.cjs snapshot   # 导出当前 rules 为可发布 pack
 */
const fs = require('fs');
const path = require('path');
const { compileJsPatternToOfficialTarget, compileRulesToResources } = require('./rule-compile.cjs');

const ROOT = path.join(__dirname, '..');
const RULES = path.join(ROOT, 'danger-rules.json');
const FEEDS = path.join(ROOT, 'rules', 'feeds');
const EAS = path.join(ROOT, 'Agentguard-dev', 'src', 'rules', 'signatures.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validateRules(doc) {
  const issues = [];
  if (!doc || !Array.isArray(doc.rules)) {
    issues.push('rules 必须是数组');
    return issues;
  }
  const ids = new Set();
  for (const r of doc.rules) {
    if (!r.id) issues.push('缺少 id');
    else if (ids.has(r.id)) issues.push('重复 id: ' + r.id);
    else ids.add(r.id);
    if (!r.pattern) issues.push(r.id + ' 缺少 pattern');
    else {
      try {
        new RegExp(r.pattern, r.flags || 'i');
      } catch (e) {
        issues.push(r.id + ' 正则非法: ' + e.message);
      }
      const compiled = compileJsPatternToOfficialTarget(r.pattern);
      if (/\s/.test(compiled.replace(/^regex:/, ''))) {
        issues.push(r.id + ' 编译后仍含字面空白（会破坏单 token）: ' + compiled.slice(0, 60));
      }
    }
  }
  return issues;
}

function validateEas(doc) {
  const issues = [];
  if (!doc || !Array.isArray(doc.rules)) return ['rules 必须是数组'];
  const ids = new Set();
  for (const r of doc.rules) {
    if (!r.id) issues.push('EAS 缺少 id');
    else if (ids.has(r.id)) issues.push('EAS 重复 id: ' + r.id);
    else ids.add(r.id);
    for (const k of ['name', 'severity', 'pattern', 'root_cause', 'destructive_impact', 'safe_alternative']) {
      if (!r[k]) issues.push(r.id + ' 缺少 ' + k);
    }
    try {
      new RegExp(r.pattern, r.flags || 'i');
    } catch (e) {
      issues.push(r.id + ' 正则非法: ' + e.message);
    }
  }
  return issues;
}

function mergeFeed(localDoc, feedDoc, localOriginal) {
  const byId = new Map(localDoc.rules.map(r => [r.id, r]));
  const touched = [];
  for (const fr of feedDoc.rules || []) {
    if (!fr || !fr.id || !fr.pattern) continue;
    const local = byId.get(fr.id);
    if (!local) {
      const entry = {
        id: fr.id,
        name: fr.name || fr.id,
        description: fr.description || '',
        pattern: fr.pattern,
        flags: fr.flags || 'i',
        enabled: fr.enabled !== false
      };
      localDoc.rules.push(entry);
      byId.set(fr.id, entry);
      touched.push({ id: fr.id, action: 'add' });
      continue;
    }
    // 用户明确停用：保留
    if (local.enabled === false) {
      touched.push({ id: fr.id, action: 'keep-disabled' });
      continue;
    }
    // 用户改过 pattern：不覆盖
    const orig = localOriginal && localOriginal.rules && localOriginal.rules.find(x => x.id === fr.id);
    const userEdited = orig && orig.pattern && orig.pattern !== fr.pattern && local.pattern === orig.pattern;
    if (local.pattern !== fr.pattern && !userEdited) {
      // 本地与 feed 不一致且不是用户手改（或用户改的是旧 feed）→ 采用 feed
      if (!orig || orig.pattern !== local.pattern) {
        local.pattern = fr.pattern;
        touched.push({ id: fr.id, action: 'update-pattern' });
      }
    } else if (local.pattern !== fr.pattern) {
      touched.push({ id: fr.id, action: 'keep-user-pattern' });
    }
    if (fr.name && fr.name !== local.name && (!orig || orig.name === local.name)) {
      local.name = fr.name;
    }
    if (fr.description) local.description = fr.description;
    if (fr.flags) local.flags = fr.flags;
  }
  return touched;
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'show') {
    const d = readJson(RULES);
    const res = compileRulesToResources(d.rules);
    console.log(JSON.stringify({
      dangerRules: { count: d.rules.length, enabled: d.rules.filter(r => r.enabled !== false).length },
      compiled: res.slice(0, 3),
      eas: fs.existsSync(EAS) ? readJson(EAS).rules.length : 0,
      feeds: fs.existsSync(FEEDS) ? fs.readdirSync(FEEDS) : []
    }, null, 2));
  } else if (cmd === 'validate') {
    const p = args[0] || RULES;
    const doc = readJson(p);
    const issues = p.includes('signature') || p.includes('eas') ? validateEas(doc) : validateRules(doc);
    console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2));
    if (issues.length) process.exit(1);
  } else if (cmd === 'merge') {
    const feedPath = args[0];
    if (!feedPath) {
      console.error('usage: merge <feed.json>');
      process.exit(1);
    }
    const feed = readJson(feedPath);
    const local = readJson(RULES);
    const original = JSON.parse(JSON.stringify(local));
    const touched = mergeFeed(local, feed, original);
    const issues = validateRules(local);
    if (issues.length) {
      console.error('合并后校验失败，已放弃写入', issues);
      process.exit(1);
    }
    fs.writeFileSync(RULES, JSON.stringify(local, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, merged: touched, total: local.rules.length }, null, 2));
  } else if (cmd === 'snapshot') {
    const d = readJson(RULES);
    fs.mkdirSync(FEEDS, { recursive: true });
    const pack = {
      pack: 'easyag-danger-core',
      version: d.version || 1,
      updated_at: new Date().toISOString(),
      rules: d.rules
    };
    const out = path.join(FEEDS, 'easyag-danger-core.json');
    fs.writeFileSync(out, JSON.stringify(pack, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, out, count: pack.rules.length }, null, 2));
  } else {
    console.log('show | validate [path] | merge <feed.json> | snapshot');
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
