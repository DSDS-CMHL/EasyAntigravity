const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Session } = require('../core/session');
const { writeJson } = require('../core/storage');
const { normalizeSettings, assertLaunchSettingsMutable } = require('../core/settings');
const { loadDictionary } = require('../features/i18n');
const { Updater, sha256Hex, isAllowedRuntimePath, resolveRuntimeRoot } = require('../features/updater');

function sessionFixture({ spawnError = false, alreadyRunning = false } = {}) {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 123; child.exitCode = null; child.kill = () => calls.push('kill');
  const session = new Session({
    settings: { get: () => ({ port: 7890, enableI18n: true, enableContextMonitor: true }) },
    desktop: { locate: () => ({ exists: true, appExe: 'test' }), running: async () => alreadyRunning },
    cdp: { port: 9333, start: () => calls.push('cdp'), stop: async () => calls.push('stop-cdp') },
    events: { log() {}, publish() {} }, host: { hide() {} },
    spawnProcess() { calls.push('spawn'); process.nextTick(() => child.emit(spawnError ? 'error' : 'spawn', new Error('spawn failed'))); return child; }
  });
  return { session, child, calls };
}

test('Session serializes duplicate launch requests and cleans up CDP on exit', async () => {
  const { session, child, calls } = sessionFixture();
  const launching = session.launch();
  assert.equal((await session.launch()).ok, false);
  assert.equal((await launching).ok, true);
  assert.deepEqual(calls.slice(0, 2), ['spawn', 'cdp']);
  child.emit('exit');
  await session.finishing;
  assert.equal(session.phase, 'idle');
  assert.deepEqual(calls.slice(-1), ['stop-cdp']);
});

test('Failed spawn transitions session to error and does not start CDP', async () => {
  const spawn = sessionFixture({ spawnError: true });
  assert.equal((await spawn.session.launch()).ok, false);
  assert.equal(spawn.calls.includes('cdp'), false);
  assert.equal(spawn.session.phase, 'error');
});

test('onStart callback runs once per successful AG launch, not on duplicate launch or failure', async () => {
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

test('An already open AG is not re-spawned on launch', async () => {
  const running = sessionFixture({ alreadyRunning: true });
  assert.equal((await running.session.launch()).ok, false);
  assert.equal(running.calls.includes('spawn'), false);
});

test('Settings validate values and lock port only while running', () => {
  assert.throws(() => normalizeSettings({ port: '7890xyz' }));
  assert.throws(() => normalizeSettings({ enableI18n: 'false' }));
  assert.throws(() => normalizeSettings({ enableContextMonitor: 'true' }));
  assert.throws(() => normalizeSettings({ enableProxy: 'true' }));
  const normalized = normalizeSettings({ port: 7897, enableI18n: false, enableContextMonitor: true });
  assert.deepEqual(normalized, { port: 7897, enableI18n: false, enableContextMonitor: true, enableProxy: true, targetApp: 'auto' });
  assert.throws(() => assertLaunchSettingsMutable({ enableProxy: false }, normalized, 'running'));
  assert.doesNotThrow(() => assertLaunchSettingsMutable({ enableProxy: false }, normalized, 'idle'));
test('buildProxyLaunch respects enableProxy=false for direct connection', () => {
  const { buildProxyLaunch } = require('../features/proxy');
  const direct = buildProxyLaunch(7890, 9333, { CUSTOM: '1' }, false);
  assert.equal(direct.args.some(a => a.startsWith('--proxy-server')), false);
  assert.equal(direct.args.some(a => a.startsWith('--proxy-bypass-list')), false);
  assert.equal(direct.args.some(a => a.startsWith('--remote-debugging-port=9333')), true);
  assert.equal(direct.env.HTTP_PROXY, undefined);
  assert.equal(direct.env.ALL_PROXY, undefined);
  assert.equal(direct.env.CUSTOM, '1');
});
  assert.throws(() => normalizeSettings({ targetApp: 'invalid' }));
  assert.throws(() => assertLaunchSettingsMutable({ targetApp: 'ide' }, normalized, 'running'));
  assert.doesNotThrow(() => assertLaunchSettingsMutable({ targetApp: 'ide' }, normalized, 'idle'));
  assert.throws(() => assertLaunchSettingsMutable({ port: 10808 }, normalized, 'running'));
  assert.doesNotThrow(() => assertLaunchSettingsMutable({ enableI18n: true, enableContextMonitor: false }, normalized, 'running'));
});

test('Session supports selecting Antigravity IDE and handles target-specific launch', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 456; child.exitCode = null; child.kill = () => calls.push('kill');
  const session = new Session({
    settings: { get: () => ({ port: 7890, enableI18n: true, enableContextMonitor: true, targetApp: 'ide' }) },
    desktop: {
      resolveTarget: () => ({ id: 'ide', name: 'Antigravity IDE', exists: true, appExe: 'Antigravity IDE.exe', capabilities: { cdp: false } }),
      running: async () => false
    },
    cdp: { port: 9333, start: () => calls.push('cdp'), stop: async () => calls.push('stop-cdp') },
    events: { log(cat, msg) { calls.push(msg); }, publish() {} },
    host: { hide() {} },
    spawnProcess(exe, args, opts) {
      calls.push({ exe, args, opts });
      process.nextTick(() => child.emit('spawn'));
      return child;
    }
  });
  const res = await session.launch();
  assert.equal(res.ok, true);
  assert.equal(res.target, 'ide');
  assert.equal(calls.includes('cdp'), false);
  assert.equal(calls[0].exe, 'Antigravity IDE.exe');
  assert.ok(calls[0].opts.env.ALL_PROXY.includes('7890'));
  child.emit('exit');
  await session.finishing;
  assert.equal(session.phase, 'idle');
});

test('Hotfix dictionary overlays bundled entries and tolerates corrupted hotfix files', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-dict-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const rootDir = path.join(temp, 'root');
  const dataDir = path.join(temp, 'data');
  writeJson(path.join(rootDir, 'dicts/ui_v2.json'), { Hello: '你好', World: '世界' });
  writeJson(path.join(dataDir, 'hotfix/dicts/ui_v2.json'), { World: '新世界', Extra: '新增词条' });
  const merged = loadDictionary(rootDir, dataDir);
  assert.deepEqual(merged, { Hello: '你好', World: '新世界', Extra: '新增词条' });
  fs.writeFileSync(path.join(dataDir, 'hotfix/dicts/ui_v2.json'), '{broken json');
  assert.deepEqual(loadDictionary(rootDir, dataDir), { Hello: '你好', World: '世界' });
});

test('Updater verifies SHA-256 for dictionary and runtime overlays and supports rollback', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-updater-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const rootDir = path.join(temp, 'root');
  const dataDir = path.join(temp, 'data');
  writeJson(path.join(rootDir, 'package.json'), { version: '4.0.0' });
  fs.mkdirSync(path.join(rootDir, 'core'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'server.js'), '// bundled server\n');
  writeJson(path.join(rootDir, 'dicts/ui_v2.json'), { Old: '旧词' });

  const newDictBytes = Buffer.from(JSON.stringify({ Old: '新词', Added: '热更词' }), 'utf8');
  const newServerBytes = Buffer.from('// overlay server v4.1.0\n', 'utf8');
  const manifest = {
    version: '4.1.0',
    dictVersion: '2026-10-19',
    dicts: {
      'ui_v2.json': { url: 'https://update.test/dicts/ui_v2.json', sha256: sha256Hex(newDictBytes) }
    },
    runtime: {
      version: '4.1.0',
      files: {
        'server.js': { url: 'https://update.test/server.js', sha256: sha256Hex(newServerBytes) }
      }
    }
  };
  const files = new Map([
    ['https://update.test/manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8')],
    ['https://update.test/dicts/ui_v2.json', newDictBytes],
    ['https://update.test/server.js', newServerBytes]
  ]);

  let reloadedCount = 0;
  const updater = new Updater({
    rootDir, dataDir,
    settings: { get: () => ({ port: 7890 }) },
    events: { log() {}, publish() {} },
    fetchBytes: async url => {
      if (!files.has(url)) throw new Error('404 ' + url);
      return files.get(url);
    },
    onDictionaryUpdated: async () => {
      reloadedCount = Object.keys(loadDictionary(rootDir, dataDir)).length;
      return reloadedCount;
    }
  });

  const res = await updater.checkAndApply({ manifestUrl: 'https://update.test/manifest.json' });
  assert.equal(res.ok, true);
  assert.equal(res.updated, true);
  assert.equal(res.dictsUpdated, 1);
  assert.equal(res.runtimeFilesUpdated, 1);
  assert.equal(res.restartRequired, true);
  assert.equal(reloadedCount, 2);
  assert.equal(resolveRuntimeRoot(rootDir, dataDir), path.join(dataDir, 'runtime', 'current'));

  // Simulate boot failure rollback
  writeJson(path.join(dataDir, 'runtime/current/overlay-meta.json'), { version: '4.1.0', failedBoot: true });
  assert.equal(resolveRuntimeRoot(rootDir, dataDir), rootDir, 'Failed overlay must automatically fall back to bundled root');

  // Tampered SHA-256 must be rejected
  files.set('https://update.test/dicts/ui_v2.json', Buffer.from('{"tampered":true}'));
  manifest.dicts['ui_v2.json'].sha256 = 'a'.repeat(64);
  files.set('https://update.test/manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  await assert.rejects(() => updater.checkAndApply({ manifestUrl: 'https://update.test/manifest.json' }), /SHA-256/);

  assert.equal(isAllowedRuntimePath('features/i18n.js'), true);
  assert.equal(isAllowedRuntimePath('../evil.js'), false);
  assert.equal(isAllowedRuntimePath('assets/payload.exe'), false);
});
