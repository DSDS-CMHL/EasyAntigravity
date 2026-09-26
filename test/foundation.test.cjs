/**
 * 基础层冒烟：不启动浏览器，只验证 API 面与配置读写。
 * 运行: node test/foundation.test.cjs
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: delay } = require('timers/promises');

const root = path.resolve(__dirname, '..');
const runtime = process.env.EASYAG_TEST_NODE || process.execPath;
const entry = path.join(root, 'server.js');

async function start() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-foundation-'));
  const ready = path.join(data, 'ready.json');
  const child = spawn(runtime, [entry], {
    env: {
      ...process.env,
      EASYAG_TAURI: '1',
      EASYAG_TEST_MODE: '1',
      EASYAG_DATA_DIR: data,
      EASYAG_READY_FILE: ready
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', c => stderr += c);
  for (let i = 0; i < 80; i++) {
    if (fs.existsSync(ready)) {
      const { port } = JSON.parse(fs.readFileSync(ready));
      return { child, url: 'http://127.0.0.1:' + port, data };
    }
    assert.equal(child.exitCode, null, stderr);
    await delay(100);
  }
  child.kill();
  throw new Error('ready timeout: ' + stderr);
}

(async () => {
  const app = await start();
  try {
    const ping = await (await fetch(app.url + '/api/ping')).text();
    assert.equal(ping, 'pong');

    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.blockDangerous, true);
    assert.equal(status.enableI18n, true);
    assert.ok(status.dictEntries > 100, '词典应已加载');
    assert.ok(status.dangerRulesTotal >= 10, 'danger-rules 应 >=10');
    assert.ok(status.kbRules >= 20, '病毒库应 >=20');

    const kb = await (await fetch(app.url + '/api/kb')).json();
    assert.ok(kb.count >= 20);
    assert.ok(kb.rules.every(r => r.id && r.name && r.pattern !== undefined || r.id && r.name));

    const rules = await (await fetch(app.url + '/api/danger-rules')).json();
    assert.ok(Array.isArray(rules.rules) && rules.rules.length >= 10);

    const inj = await (await fetch(app.url + '/api/injected')).json();
    assert.ok(typeof inj.count === 'number');

    // sync + cleanup 闭环（写 TEST 数据目录旁的假 gemini 不可行；只验证 API 不崩）
    const sync = await fetch(app.url + '/api/danger-rules/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'ask', scope: 'global' })
    });
    const syncBody = await sync.json();
    assert.ok(syncBody.ok === true || syncBody.ok === false, 'sync 应返回 JSON');

    const clean = await fetch(app.url + '/api/danger-rules/cleanup', { method: 'POST' });
    const cleanBody = await clean.json();
    assert.ok(cleanBody.ok === true || cleanBody.ok === false);

    const cfg = await fetch(app.url + '/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockDangerous: false, enableI18n: true })
    });
    assert.ok(cfg.ok);
    const status2 = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status2.blockDangerous, false);

    console.log('PASS: foundation API smoke (ping/status/kb/rules/injected/sync/cleanup/config)');
  } finally {
    try {
      await fetch(app.url + '/api/quit', { method: 'POST' });
    } catch (e) {}
    await delay(300);
    if (app.child.exitCode === null) app.child.kill();
    fs.rmSync(app.data, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
