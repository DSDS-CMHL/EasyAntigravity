const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../desktop/application');

test('CLI Application & API: full integration smoke test', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-cli-api-'));
  const rootDir = path.resolve(__dirname, '..');
  const app = createApplication({
    rootDir,
    dataDir: tmpDir,
    native: false,
    testMode: true
  });

  try {
    const port = await app.start();
    assert.equal(typeof port, 'number');
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. GET /api/ping
    const pingRes = await fetch(`${baseUrl}/api/ping`);
    assert.equal(pingRes.status, 200);
    assert.equal(await pingRes.text(), 'pong');

    // 2. GET /api/status
    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.port, 7890);
    assert.equal(status.enableProxy, true);
    assert.equal(typeof status.cli.installed, 'boolean');
    assert.ok(status.terminal.type);

    // 3. POST /api/config
    const configRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 7897, enableProxy: false, skipPermissions: true })
    });
    assert.equal(configRes.status, 200);
    const configData = await configRes.json();
    assert.equal(configData.ok, true);
    assert.equal(configData.settings.port, 7897);
    assert.equal(configData.settings.enableProxy, false);
    assert.equal(configData.settings.skipPermissions, true);

    // 4. GET /api/cli/projects
    const projRes = await fetch(`${baseUrl}/api/cli/projects`);
    assert.equal(projRes.status, 200);
    const projData = await projRes.json();
    assert.equal(projData.ok, true);
    assert.equal(Array.isArray(projData.projects), true);

    // 5. POST /api/cli/create-project
    const newProjDir = path.join(tmpDir, 'test-new-proj');
    const createRes = await fetch(`${baseUrl}/api/cli/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'IntegrationTestProj', folderPath: newProjDir })
    });
    assert.equal(createRes.status, 200);
    const createData = await createRes.json();
    assert.equal(createData.ok, true);
    assert.equal(createData.project.name, 'IntegrationTestProj');

    // 6. GET static files
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    assert.match(await indexRes.text(), /EasyAntigravity CLI Hub/);

    const cssRes = await fetch(`${baseUrl}/ui/launcher.css`);
    assert.equal(cssRes.status, 200);
    assert.match(await cssRes.text(), /--primary/);

    const jsRes = await fetch(`${baseUrl}/ui/launcher.js`);
    assert.equal(jsRes.status, 200);
  } finally {
    await app.close('测试完毕');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
