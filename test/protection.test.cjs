// Pure rule strings and a fake launcher DOM; no real AG, command execution or config writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeSettings, assertLaunchSettingsMutable } = require('../core/settings');
const { RuleEngine } = require('../features/rules');
const { protectionRules } = require('../features/protection');
const { simulateOfficialMatch, compileRulesToResources } = require('../scripts/rule-compile.cjs');
const root = path.resolve(__dirname, '..');
const document = JSON.parse(fs.readFileSync(path.join(root, 'danger-rules.json'), 'utf8'));
const knowledge = JSON.parse(fs.readFileSync(path.join(root, 'knowledge/signatures.json'), 'utf8'));
const engine = Object.assign(Object.create(RuleEngine.prototype), {
  bundled: document, document, active: document.rules,
  patterns: document.rules.map(rule => ({ rule, regex: new RegExp(rule.pattern, rule.flags) })),
  signatures: knowledge.rules.map(rule => ({ rule, regex: new RegExp(rule.pattern, rule.flags) }))
});
const hit = (level, payload) => engine.compile(undefined, level).ask.some(resource => simulateOfficialMatch(resource, `echo '${payload}'`));

test('strength defaults/migration and validation are independent of mode and risk severity', () => {
  assert.equal(normalizeSettings({}).protectionLevel, 'standard');
  for (const protectionLevel of ['strict', 'standard', 'relaxed']) {
    assert.equal(normalizeSettings({ protectionLevel }).riskAdvisor, true);
    const compatible = normalizeSettings({ launchMode: 'compatibility' }, normalizeSettings({ protectionLevel }));
    assert.equal(compatible.protectionLevel, protectionLevel);
    assert.equal(compatible.riskAdvisor, false);
    assert.equal(normalizeSettings({ launchMode: 'pilot' }, compatible).protectionLevel, protectionLevel);
  }
  for (const protectionLevel of ['high', '', null, {}, 1]) {
    assert.throws(() => normalizeSettings({ protectionLevel }));
    assert.throws(() => engine.compile(undefined, protectionLevel));
  }
});

test('backend rejects live strength changes but allows live translation and identical preferences', () => {
  const previous = normalizeSettings({ protectionLevel: 'standard' });
  for (const phase of ['running', 'preparing', 'launching']) {
    for (const input of [{ protectionLevel: 'relaxed' }, { protectionLevel: 'strict' },
      { port: 7897 }, { launchMode: 'compatibility' }, { blockDangerous: false }]) {
      assert.throws(() => assertLaunchSettingsMutable(input, previous, phase), /AG 退出/);
    }
    assert.doesNotThrow(() => assertLaunchSettingsMutable({ protectionLevel: 'standard', enableI18n: false }, previous, phase));
  }
  for (const phase of ['idle', 'error']) assert.doesNotThrow(() => assertLaunchSettingsMutable({ protectionLevel: 'relaxed' }, previous, phase));
});

test('three approval profiles have different scope without turning off ARES', () => {
  for (const level of ['strict', 'standard', 'relaxed']) {
    assert.equal(hit(level, 'rm -rf /'), true, level + ': root deletion');
    assert.equal(hit(level, 'rm -rf ~/.ssh'), true, level + ': credentials');
    assert.equal(hit(level, 'format D: /q'), true, level + ': disk destruction');
    assert.equal(hit(level, 'echo harmless'), false, level + ': benign');
    assert.ok(engine.assess('rm -rf ./build'), level + ': notifications remain available');
  }
  assert.equal(hit('strict', 'rm -- -rf'), true, 'strict accepts the filename false positive');
  assert.equal(hit('standard', 'rm -- -rf'), false);
  assert.equal(hit('strict', 'git clean -nfdx'), true, 'strict accepts preview false positives');
  assert.equal(hit('standard', 'git clean -nfdx'), false);
  assert.equal(hit('strict', 'rm -rf ./build'), true);
  assert.equal(hit('standard', 'rm -rf ./build'), true);
  assert.equal(hit('relaxed', 'rm -rf ./build'), false, 'relaxed does not claim comprehensive deletion protection');
  assert.equal(hit('standard', 'git -C . clean -fdx'), true);
  assert.equal(hit('relaxed', 'git -C . clean -fdx'), false);
  assert.equal(engine.assess("echo 'rm -- -rf'"), null, 'filename probe is not a recursive-delete notification');
  assert.equal(engine.assess('rm -- -rf')?.level === 'high', false, 'raw command may have a syntax advisory, not a deletion warning');
  assert.equal(engine.assess('git -C . clean -fdx').primary.id, 'ARES-225');
});

test('standard profile recognizes option termination, Git global options and preview boundaries', () => {
  for (const payload of ['rm -- -rf', 'rm ./-rf.txt', 'git -C . clean -ndx',
    'git --git-dir=./probe clean -f --dry-run', 'git -C "dir with spaces" clean --dry-run -fdx']) {
    assert.equal(hit('standard', payload), false, payload);
  }
  for (const payload of ['rm -rf -- ./probe', 'rm ./probe -r -f', 'rm --force ./probe',
    'git -C . clean -fdx', 'git -C . -c core.foo=bar reset --hard HEAD',
    'git --git-dir=./probe reset --hard HEAD', 'git -C "dir with spaces" clean -fdx',
    'git -C . clean -fdx; echo -n']) {
    assert.equal(hit('standard', payload), true, payload);
  }
});

test('presets preserve custom patterns, flags, explicit actions and disabled switches', () => {
  const original = document.rules.find(rule => rule.id === 'git-destructive');
  const custom = { ...original, pattern: 'custom-danger' };
  const explicit = { ...original, action: 'deny' };
  const sensitive = { ...original, flags: '' };
  const additional = { id: 'user-only', pattern: 'my-policy', action: 'allow' };
  const active = [custom, explicit, sensitive, additional];
  for (const level of ['strict', 'standard', 'relaxed']) {
    assert.deepEqual(protectionRules(active, document, level), active);
    assert.deepEqual(protectionRules([], document, level), []);
    const lists = Object.assign(Object.create(RuleEngine.prototype), { bundled: document, active }).compile(undefined, level);
    assert.equal(lists.deny.length, 1);
    assert.equal(lists.allow.length, 1);
    assert.equal(lists.ask.length, 2);
  }
  const snapshot = JSON.stringify(document);
  for (const level of ['strict', 'standard', 'relaxed']) compileRulesToResources(protectionRules(document.rules, document, level));
  assert.equal(JSON.stringify(document), snapshot, 'presets never rewrite the source rule file');
});

function launcherFixture() {
  const controls = [];
  function element(id) {
    const state = new Set();
    return { id, disabled: false, dataset: {}, value: '', checked: false, style: {}, children: [],
      classList: { toggle(key, on) { if (on) state.add(key); else state.delete(key); }, add() {} },
      setAttribute(key, value) { this[key] = value; }, addEventListener() {},
      querySelector() { return { textContent: '' }; }, appendChild() {}, replaceChildren() {} };
  }
  const elements = new Map();
  const protection = ['strict', 'standard', 'relaxed'].map(level => Object.assign(element(level), { dataset: { protection: level } }));
  const modes = ['pilot', 'compatibility'].map(mode => Object.assign(element(mode), { dataset: { mode } }));
  controls.push(...protection, ...modes);
  const settings = { launchMode: 'pilot', protectionLevel: 'standard', port: 7890, enableI18n: true };
  const payloads = [];
  const context = vm.createContext({ console, Promise, Date, Set, Number, Object,
    document: { body: { dataset: {} }, addEventListener() {}, createElement: () => element('log'),
      getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
      querySelectorAll(selector) { return selector === '.protection-option' ? protection : modes; } },
    window: { addEventListener() {} },
    api: { async configure(payload) { payloads.push(payload); Object.assign(settings, payload); }, async status() { return settings; } }
  });
  let source = fs.readFileSync(path.join(root, 'ui/launcher.js'), 'utf8');
  source = source.replace(/^import .*;\r?\n/, '').replace(/^init\(\)\.catch.*$/m, '');
  vm.runInContext(source, context);
  return { context, protection, elements, payloads, settings };
}

test('launcher strength controls persist, lock during AG lifetime and retain selection in compatibility', async () => {
  const fixture = launcherFixture();
  const run = source => vm.runInContext(source, fixture.context);
  run('renderMode()');
  assert.ok(fixture.protection.every(control => !control.disabled));
  await run("actions.protection({dataset:{protection:'relaxed'}})");
  assert.equal(fixture.payloads[0].protectionLevel, 'relaxed');
  assert.match(fixture.elements.get('protectionHint').textContent, /漏报风险更高/);
  for (const phase of ['preparing', 'launching', 'running']) {
    run(`renderPhase('${phase}')`);
    assert.ok(fixture.protection.every(control => control.disabled));
  }
  run("renderPhase('idle'); mode='compatibility'; renderMode()");
  assert.ok(fixture.protection.every(control => control.disabled));
  assert.match(fixture.elements.get('protectionHint').textContent, /保留/);
  run("mode='pilot'; renderMode()");
  assert.ok(fixture.protection.every(control => !control.disabled));
  assert.equal(fixture.protection[2]['aria-pressed'], 'true');
  fixture.context.api.configure = async () => { throw new Error('save failed'); };
  await assert.rejects(() => run("actions.protection({dataset:{protection:'strict'}})"), /save failed/);
  assert.equal(fixture.protection[2]['aria-pressed'], 'true', 'failed save restores persisted selection');
});
