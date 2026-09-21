const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '..');
const runtime = process.env.EASYAG_TEST_NODE || process.execPath;
const entry = process.env.EASYAG_TEST_SERVER || path.join(root, 'server.js');
async function start(data) {
  const ready = path.join(data, 'ready.json');
  fs.rmSync(ready, { force: true });
  const child = spawn(runtime, [entry], {
    env: { ...process.env, EASYAG_TAURI: '1', EASYAG_TEST_MODE: '1', EASYAG_DATA_DIR: data, EASYAG_READY_FILE: ready },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  child.on('error', err => stderr += String(err));
  try {
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(ready)) {
        const { port } = JSON.parse(fs.readFileSync(ready));
        return { child, url: 'http://127.0.0.1:' + port };
      }
      assert.equal(child.exitCode, null, stderr);
      await delay(100);
    }
    throw Error('Readiness timeout: ' + stderr);
  } catch (err) { child.kill(); throw err; }
}
async function stop(child, eof = false) {
  if (eof) child.stdin.end(); else child.stdin.end('quit\n');
  for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100);
  assert.equal(child.exitCode, 0, 'Backend must exit when native owner closes');
}
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-lifecycle-'));
  let child;
  try {
    let app = await start(data); child = app.child;
    let status = await (await fetch(app.url + '/api/status')).json();
    assert.ok(status.dictEntries > 3000);
    assert.equal(status.preferOption, 1);
    assert.equal(status.blockDangerous, true);
    const html = await (await fetch(app.url)).text();
    assert.ok(!html.includes('sendBeacon'));
    const events = new AbortController();
    const stream = fetch(app.url + '/api/events', { signal: events.signal }).catch(() => {});
    await delay(200); events.abort(); await stream;
    // Exceed the old 30 second deadline without any page polling or SSE connection.
    await delay(32000);
    assert.equal(child.exitCode, null, 'Background / disconnected UI must not stop backend');
    await fetch(app.url + '/api/config', { method: 'POST', body: JSON.stringify({ port: 7897, autoAccept: false }) });
    await stop(child);
    app = await start(data); child = app.child;
    status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.port, 7897); assert.equal(status.autoAccept, false);
    assert.ok(fs.existsSync(path.join(data, 'danger-rules.json')));
    await stop(child, true);
    assert.ok(fs.readFileSync(path.join(data, 'easyag.log'), 'utf8').includes('原生宿主管道关闭'));
    console.log('PASS: resources, defaults, >30s idle, SSE disconnect, settings, explicit close and owner EOF');
  } finally {
    if (child && child.exitCode === null) child.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
