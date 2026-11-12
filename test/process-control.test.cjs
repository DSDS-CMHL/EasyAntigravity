const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesExecutable, listTargetProcesses, stopTarget } = require('../adapters/desktop/process-control');
const { Session } = require('../core/session');
const { EventEmitter } = require('node:events');

test('cleanup matches installation paths, not same names or neighbouring bundles', () => {
  const target = { appExe: 'C:\\AG\\Antigravity.exe' };
  assert.equal(matchesExecutable('c:\\ag\\Antigravity.exe', target, 'win32'), true);
  assert.equal(matchesExecutable('D:\\AG\\Antigravity.exe', target, 'win32'), false);
  const mac = { appExe: '/Applications/Antigravity.app/Contents/MacOS/Antigravity', appDir: '/Applications/Antigravity.app' };
  assert.equal(matchesExecutable('/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper', mac, 'darwin'), true);
  assert.equal(matchesExecutable('/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity', mac, 'darwin'), false);
});

test('Windows discovery requests owner and creation-time verification and rejects other paths', async () => {
  const target = { appExe: "C:\\User's AG\\Antigravity.exe" };
  const rows = await listTargetProcesses(target, { platform: 'win32', execute: async (file, args) => {
    assert.equal(file, 'powershell.exe');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /GetOwnerSid/);
    assert.match(script, /User''s AG/);
    return { stdout: JSON.stringify([{ pid: 123, created: 'first', executable: target.appExe }, { pid: 456, executable: 'D:\\AG\\Antigravity.exe' }]) };
  } });
  assert.deepEqual(rows.map(row => row.pid), [123]);
});

test('cleanup verifies termination, reports survivors and avoids reused PIDs', async () => {
  const row = { pid: 123, created: 'first' };
  const signals = [];
  const remaining = await stopTarget({}, { list: async () => [row], kill: (pid, signal) => signals.push([pid, signal]), sleep: async () => {}, timeoutMs: 0 });
  assert.equal(remaining.ok, false);
  assert.deepEqual(signals, [[123, 'SIGTERM'], [123, 'SIGKILL']]);
  let reads = 0;
  const reused = await stopTarget({}, { list: async () => ++reads === 1 ? [row] : reads === 2 ? [{ ...row, created: 'second' }] : [], kill: () => assert.fail('Reused PID must not be signalled'), timeoutMs: 0 });
  assert.equal(reused.ok, true);
});

function fixture() {
  const calls = [];
  const target = { id: 'hub', name: 'AG', exists: true, appExe: 'synthetic' };
  const session = new Session({ settings: { get: () => ({ port: 7890 }) }, desktop: {
    resolveTarget: () => target, running: async () => false,
    stop: async () => { calls.push('stop'); return { ok: true }; }
  }, events: { publish() {}, log() {} }, cdp: { port: 9333, stop: async () => calls.push('detach'), start: () => calls.push('attach') }, host: { hide() {} }, spawnProcess: () => {
    calls.push('spawn'); const child = new EventEmitter(); child.pid = 123; child.exitCode = null;
    process.nextTick(() => child.emit('spawn')); return child;
  } });
  return { session, calls };
}

test('conflict is typed and cleanup works from error or running without bypassing preflight', async () => {
  const { session, calls } = fixture();
  session.desktop.running = async () => true;
  assert.equal((await session.launch()).code, 'PROCESS_CONFLICT');
  assert.equal((await session.cleanAndLaunch()).ok, false);
  assert.equal(calls.includes('spawn'), false);
  session.desktop.running = async () => false;
  assert.equal((await session.cleanAndLaunch()).ok, true);
  assert.equal((await session.cleanAndLaunch()).ok, true);
  await session.finish('test');
});

test('failed, cancelled and concurrent cleanup cannot start another AG', async () => {
  const { session, calls } = fixture();
  session.desktop.stop = async () => ({ ok: false });
  assert.equal((await session.cleanAndLaunch()).code, 'CLEANUP_FAILED');
  assert.equal(calls.includes('spawn'), false);
  let resolve;
  session.desktop.stop = () => new Promise(done => { resolve = done; });
  const pending = session.cleanAndLaunch();
  await new Promise(done => setImmediate(done));
  assert.equal((await session.cleanAndLaunch()).code, 'BUSY');
  assert.equal((await session.launch()).ok, false);
  await session.close('test'); resolve({ ok: true });
  assert.equal((await pending).ok, false);
  assert.equal(calls.includes('spawn'), false);
});
