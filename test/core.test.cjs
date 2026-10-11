const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PermissionAdapter, TERMINAL_TURBO } = require('../adapters/desktop/permissions');
const { RuleEngine } = require('../features/rules');
const { Session } = require('../core/session');
const { readJson, writeJson } = require('../core/storage');
const { normalizeSettings } = require('../core/settings');
const { removeLegacyHooks } = require('../adapters/desktop/legacy-hooks');
const { RiskAdvisor } = require('../features/risk-advisor');

function fixture(t, config = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-core-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const configFile = path.join(dataDir, 'ag.json');
  writeJson(configFile, config);
  return { dataDir, configFile, adapter: new PermissionAdapter({ dataDir, configFile }) };
}
const lists = { allow: ['command(echo ok)'], deny: ['command(wipe)'], ask: ['command(delete)'] };

test('Allow/Deny/Ask overlays preserve preexisting grants and restore the exact config', t => {
  const original = { other: true, userSettings: {
    autoExecutionPolicy: 'user-custom', fileAccessPolicy: 'keep-files', sandboxMode: true,
    globalPermissionGrants: { allow: ['command(echo ok)'], deny: ['command(user-rule)'], ask: [] }
  } };
  const { configFile, adapter } = fixture(t, original);
  assert.equal(adapter.apply(lists).ok, true);
  assert.equal(readJson(configFile).userSettings.autoExecutionPolicy, TERMINAL_TURBO);
  assert.equal(readJson(configFile).userSettings.fileAccessPolicy, 'keep-files');
  assert.equal(adapter.status().count, 2);
  assert.equal(adapter.apply(lists).ok, true);
  assert.equal(adapter.status().count, 2, 'Repeated application must not claim the original grant');
  assert.equal(adapter.restore().ok, true);
  assert.deepEqual(readJson(configFile), original);
});

test('Created fields and containers are removed after recovery', t => {
  const { adapter, configFile } = fixture(t, { untouched: 7 });
  assert.equal(adapter.apply(lists).ok, true);
  assert.equal(adapter.restore().ok, true);
  assert.deepEqual(readJson(configFile), { untouched: 7 });
});

test('Recovery survives process restart and preserves later user changes', t => {
  const context = fixture(t, { userSettings: { autoExecutionPolicy: 'original' } });
  context.adapter.apply(lists);
  const config = readJson(context.configFile);
  config.userSettings.autoExecutionPolicy = 'later-user-choice';
  config.userSettings.globalPermissionGrants.ask.push('command(later-rule)');
  config.userSettings.newSetting = 'retain';
  writeJson(context.configFile, config);
  const restarted = new PermissionAdapter(context);
  const result = restarted.restore();
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, ['autoExecutionPolicy']);
  assert.deepEqual(readJson(context.configFile), { userSettings: {
    autoExecutionPolicy: 'later-user-choice', globalPermissionGrants: { ask: ['command(later-rule)'] }, newSetting: 'retain'
  } });
});

test('Failed configuration write rolls back from a journal persisted first', t => {
  const context = fixture(t, { userSettings: { autoExecutionPolicy: 'original' } });
  let fail = true;
  const adapter = new PermissionAdapter({ ...context, write(file, object) {
    if (fail) {
      fail = false;
      assert.ok(fs.existsSync(context.adapter.journalFile));
      writeJson(file, object);
      throw new Error('simulated write failure');
    }
    writeJson(file, object);
  } });
  const result = adapter.apply(lists);
  assert.equal(result.ok, false);
  assert.equal(result.recovery.ok, true);
  assert.deepEqual(readJson(context.configFile), { userSettings: { autoExecutionPolicy: 'original' } });
});

test('Unrecoverable config retains its journal for retry', t => {
  const { adapter, configFile } = fixture(t);
  adapter.apply(lists);
  fs.renameSync(configFile, configFile + '.offline');
  assert.equal(adapter.restore().ok, false);
  assert.ok(fs.existsSync(adapter.journalFile));
  fs.renameSync(configFile + '.offline', configFile);
  assert.equal(adapter.restore().ok, true);
  assert.deepEqual(readJson(configFile), {});
});

test('Legacy recovery uses the recorded snapshot, not a fixed default preset', t => {
  const { adapter, configFile } = fixture(t, { userSettings: {
    autoExecutionPolicy: TERMINAL_TURBO, globalPermissionGrants: { ask: ['command(old-owned)', 'command(user)'] }
  } });
  writeJson(adapter.legacyFile, {
    savedGlobal: { present: { autoExecutionPolicy: true }, values: { autoExecutionPolicy: 'legacy-original' } },
    injections: [{ file: configFile, list: 'ask', resources: ['command(old-owned)'] }]
  });
  assert.equal(adapter.restore().ok, true);
  assert.equal(readJson(configFile).userSettings.autoExecutionPolicy, 'legacy-original');
  assert.deepEqual(readJson(configFile).userSettings.globalPermissionGrants.ask, ['command(user)']);
});

test('Rule engine compiles each native action and selects a prescription at the highest severity', t => {
  const { dataDir } = fixture(t);
  writeJson(path.join(dataDir, 'danger-rules.json'), { rules: [
    { id: 'a', pattern: 'echo', action: 'allow' },
    { id: 'b', pattern: 'wipe', action: 'deny', severity: 'high' },
    { id: 'c', pattern: 'delete', action: 'ask' }
  ] });
  fs.mkdirSync(path.join(dataDir, 'knowledge'));
  writeJson(path.join(dataDir, 'knowledge/signatures.json'), { rules: [
    { id: 'minor', pattern: 'wipe', severity: 'low', destructive_impact: 'minor' },
    { id: 'major', pattern: 'wipe', severity: 'high', destructive_impact: 'major', safe_alternative: 'backup' }
  ] });
  const rules = new RuleEngine({ rootDir: dataDir, dataDir });
  const compiled = rules.compile();
  assert.equal(compiled.allow.length, 1);
  assert.equal(compiled.deny.length, 1);
  assert.equal(compiled.ask.length, 1);
  assert.equal(rules.assess('wipe').primary.id, 'major');
  assert.equal(rules.assess('wipe').level, 'high');
  assert.equal(rules.assess('safe'), null);
  assert.throws(() => rules.compile('invalid'));
  writeJson(path.join(dataDir, 'danger-rules.json'), { rules: [{ pattern: '[' }] });
  assert.throws(() => rules.reload());
  assert.equal(rules.assess('wipe').primary.id, 'major', 'Invalid reload must preserve the last working engine');
});

test('Disabling risk explanations does not apply or remove any permission policy', () => {
  let enabled = false;
  let evaluated = 0;
  const sent = [];
  const advisor = new RiskAdvisor({
    rules: { assess() { evaluated++; return { level: 'high', levelLabel: '高风险', primary: { name: 'risk', destructive_impact: 'impact', safe_alternative: 'backup' } }; } },
    events: { log() {}, publish() {} }, notifications: { show: value => sent.push(value) }, enabled: () => enabled
  });
  advisor.observe('wipe');
  assert.equal(evaluated, 0);
  enabled = true;
  advisor.observe('wipe'); advisor.observe('wipe');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].solution, 'backup');
});

test('Legacy Hook migration leaves unrelated registrations intact', t => {
  const { dataDir } = fixture(t);
  const file = path.join(dataDir, 'hooks.json');
  writeJson(file, {
    'easyag-task-done': { Stop: [{ command: 'node easyag-stop-hook.cjs' }] },
    'easyag-danger-gate': { PreToolUse: [{ hooks: [{ command: 'easyag-pretool-hook.cmd' }] }] },
    mine: { enabled: true }
  });
  assert.equal(removeLegacyHooks(file).removed, 2);
  assert.deepEqual(readJson(file), { mine: { enabled: true } });
});

function sessionFixture({ spawnError = false, applyError = false, alreadyRunning = false, mode = 'pilot', protectionLevel = 'standard' } = {}) {
  const calls = [];
  const compiled = [];
  const child = new EventEmitter();
  child.pid = 123; child.exitCode = null; child.kill = () => calls.push('kill');
  const session = new Session({
    settings: { get: () => ({ port: 7890, launchMode: mode, protectionLevel }) },
    permissions: { restore() { calls.push('restore'); return { ok: true }; }, apply() { calls.push('apply'); return { ok: !applyError, error: 'apply failed' }; } },
    rules: { reload() {}, compile(action, level) { compiled.push({ action, level }); return lists; } }, desktop: { locate: () => ({ exists: true, appExe: 'test' }), running: async () => alreadyRunning },
    cdp: { port: 9333, start: () => calls.push('cdp'), stop: async () => calls.push('stop-cdp') },
    events: { log() {}, publish() {} }, host: { hide() {} },
    spawnProcess() { calls.push('spawn'); process.nextTick(() => child.emit(spawnError ? 'error' : 'spawn', new Error('spawn failed'))); return child; }
  });
  return { session, child, calls, compiled };
}

test('launch captures the selected profile before spawn and clears it on exit/error/compatibility', async () => {
  for (const protectionLevel of ['strict', 'standard', 'relaxed']) {
    const { session, compiled } = sessionFixture({ protectionLevel });
    assert.equal((await session.launch()).ok, true);
    assert.deepEqual(compiled, [{ action: undefined, level: protectionLevel }]);
    assert.equal(session.snapshot().activeProtectionLevel, protectionLevel);
    await session.finish('test');
    assert.equal(session.snapshot().activeProtectionLevel, null);
  }
  const failure = sessionFixture({ protectionLevel: 'invalid' });
  assert.equal((await failure.session.launch()).ok, false);
  assert.equal(failure.calls.includes('spawn'), false);
  assert.equal(failure.session.snapshot().activeProtectionLevel, null);
  const compatible = sessionFixture({ mode: 'compatibility', protectionLevel: 'strict' });
  await compatible.session.launch();
  assert.equal(compatible.compiled.length, 0);
  assert.equal(compatible.session.snapshot().activeProtectionLevel, null);
  await compatible.session.finish('test');
});

test('Session validates enhancement before spawn and serializes duplicate launch requests', async () => {
  const { session, child, calls } = sessionFixture();
  const launching = session.launch();
  assert.equal((await session.launch()).ok, false);
  assert.equal((await launching).ok, true);
  assert.deepEqual(calls.slice(0, 4), ['restore', 'apply', 'spawn', 'cdp']);
  child.emit('exit');
  await session.finishing;
  assert.equal(session.phase, 'idle');
  assert.deepEqual(calls.slice(-2), ['restore', 'stop-cdp']);
});

test('Failed apply never launches; failed spawn restores the original settings', async () => {
  const apply = sessionFixture({ applyError: true });
  assert.equal((await apply.session.launch()).ok, false);
  assert.equal(apply.calls.includes('spawn'), false);
  const spawn = sessionFixture({ spawnError: true });
  assert.equal((await spawn.session.launch()).ok, false);
  assert.equal(spawn.calls.at(-1), 'restore');
});

test('risk-session initialization runs once per successful AG launch, not on duplicate launch or failure', async () => {
  const { session } = sessionFixture();
  let starts = 0;
  session.onStart = () => { starts++; };
  await session.launch(); await session.launch();
  assert.equal(starts, 1);
  await session.finish('test'); await session.launch();
  assert.equal(starts, 2);
  await session.finish('test');
  const failed = sessionFixture({ spawnError: true });
  failed.session.onStart = () => { starts++; };
  await failed.session.launch(); assert.equal(starts, 2);
});

test('Host shutdown restores config before a slow renderer cleanup', async () => {
  const { session, calls } = sessionFixture();
  await session.launch();
  let completeCleanup;
  session.cdp.stop = () => new Promise(resolve => { completeCleanup = resolve; });
  const stopping = session.close('native owner closed');
  assert.equal(calls.at(-1), 'restore', 'Native timeout must not interrupt config recovery');
  completeCleanup();
  await stopping;
});

test('Compatibility skips overlays and an already open AG is not modified', async () => {
  const compatibility = sessionFixture({ mode: 'compatibility' });
  assert.equal((await compatibility.session.launch()).ok, true);
  assert.equal(compatibility.calls.includes('apply'), false);
  await compatibility.session.close('test');
  const running = sessionFixture({ alreadyRunning: true });
  assert.equal((await running.session.launch()).ok, false);
  assert.equal(running.calls.includes('apply'), false);
  assert.equal(running.calls.includes('spawn'), false);
});

test('Settings validate values before replacing the previous settings', () => {
  assert.throws(() => normalizeSettings({ port: '7890xyz' }));
  assert.throws(() => normalizeSettings({ launchMode: 'other' }));
  assert.throws(() => normalizeSettings({ enableI18n: 'false' }));
  assert.equal(normalizeSettings({ blockDangerous: false }).launchMode, 'compatibility');
});
