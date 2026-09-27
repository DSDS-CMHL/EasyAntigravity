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
const dangerRules = JSON.parse(fs.readFileSync(path.join(root, 'danger-rules.json'), 'utf8'));
const { compileRulesToResources } = require('../scripts/rule-compile.cjs');
const preexistingAsk = compileRulesToResources(dangerRules.rules)[0];

async function start() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-foundation-'));
  const ready = path.join(data, 'ready.json');
  const agConfig = path.join(data, 'antigravity-config.json');
  const initialConfig = {
    userSettings: {
      autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
      fileAccessPolicy: 'AGENT_SETTING_POLICY_ASK',
      nonWorkspaceFileAccessPolicy: 'AGENT_SETTING_POLICY_ASK',
      globalPermissionGrants: { allow: [], ask: [preexistingAsk], deny: [] }
    }
  };
  fs.writeFileSync(agConfig, JSON.stringify(initialConfig, null, 2));
  const child = spawn(runtime, [entry], {
    env: {
      ...process.env,
      EASYAG_TAURI: '1',
      EASYAG_TEST_MODE: '1',
      EASYAG_DATA_DIR: data,
      EASYAG_READY_FILE: ready,
      EASYAG_TEST_AG_CONFIG: agConfig
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', c => stderr += c);
  for (let i = 0; i < 80; i++) {
    if (fs.existsSync(ready)) {
      const { port } = JSON.parse(fs.readFileSync(ready));
      return { child, url: 'http://127.0.0.1:' + port, data, agConfig, initialConfig };
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
    assert.equal(status.launchMode, 'pilot');
    assert.equal(status.riskAdvisor, true);
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
    assert.equal(inj.count, 0, '仅启动 EasyAG 不应提前注入规则');
    assert.deepEqual(JSON.parse(fs.readFileSync(app.agConfig, 'utf8')), app.initialConfig,
      '点击启动 AG 前不得改动官方配置');

    // sync 必须同时写入 ASK 与 Turbo，并且通过写后校验。
    const sync = await fetch(app.url + '/api/danger-rules/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'ask', scope: 'global' })
    });
    const syncBody = await sync.json();
    assert.equal(syncBody.ok, true);
    assert.ok(syncBody.verifiedFiles.includes(app.agConfig));
    const applied = JSON.parse(fs.readFileSync(app.agConfig, 'utf8'));
    assert.equal(applied.userSettings.autoExecutionPolicy, 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER');
    assert.equal(applied.userSettings.fileAccessPolicy, 'AGENT_SETTING_POLICY_ASK',
      '工作区文件访问策略必须保留给用户决定');
    assert.equal(applied.userSettings.nonWorkspaceFileAccessPolicy, 'AGENT_SETTING_POLICY_ASK',
      '工作区外文件访问策略必须保留给用户决定');
    assert.equal(applied.userSettings.globalPermissionGrants.ask.length, syncBody.count);
    const owned = await (await fetch(app.url + '/api/injected')).json();
    assert.equal(owned.count, syncBody.count - 1,
      '只应登记 EasyAG 实际新增的规则，不得认领用户已有规则');

    const clean = await fetch(app.url + '/api/danger-rules/cleanup', { method: 'POST' });
    const cleanBody = await clean.json();
    assert.equal(cleanBody.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(app.agConfig, 'utf8')), app.initialConfig,
      '清理后应恢复启动前的规则和策略');

    const withoutPolicy = JSON.parse(JSON.stringify(app.initialConfig));
    delete withoutPolicy.userSettings.autoExecutionPolicy;
    fs.writeFileSync(app.agConfig, JSON.stringify(withoutPolicy, null, 2));
    const syncWithoutPolicy = await fetch(app.url + '/api/danger-rules/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'ask', scope: 'global' })
    });
    const syncWithoutPolicyBody = await syncWithoutPolicy.json();
    assert.equal(syncWithoutPolicyBody.ok, true);
    const cleanupWithoutPolicy = await fetch(app.url + '/api/danger-rules/cleanup', { method: 'POST' });
    assert.equal(cleanupWithoutPolicy.ok, true);
    const restoredWithoutPolicy = JSON.parse(fs.readFileSync(app.agConfig, 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(restoredWithoutPolicy.userSettings, 'autoExecutionPolicy'), false,
      '原本不存在的策略字段在退出时应删除');
    fs.writeFileSync(app.agConfig, JSON.stringify(app.initialConfig, null, 2));

    fs.renameSync(app.agConfig, app.agConfig + '.missing');
    const failedSync = await fetch(app.url + '/api/danger-rules/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'ask', scope: 'global' })
    });
    const failedBody = await failedSync.json();
    assert.equal(failedSync.status, 400);
    assert.equal(failedBody.ok, false, '配置不存在时不得假报注入成功');
    fs.renameSync(app.agConfig + '.missing', app.agConfig);

    const removedProjectPilot = await fetch(app.url + '/api/pilot/project', { method: 'POST' });
    assert.equal(removedProjectPilot.status, 404, '项目级 Turbo Pilot 接口应已移除');

    const cfg = await fetch(app.url + '/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launchMode: 'compatibility', riskAdvisor: false, enableI18n: true })
    });
    assert.ok(cfg.ok);
    const status2 = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status2.blockDangerous, false);
    assert.equal(status2.launchMode, 'compatibility');
    assert.equal(status2.riskAdvisor, false);

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
