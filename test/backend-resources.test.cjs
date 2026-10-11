const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyBackendResources } = require('../scripts/backend-resources.cjs');

test('The packaged backend runs with its own modules, dictionary and risk knowledge', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-resources-'));
  const backend = path.join(temporary, 'backend');
  const dataDir = path.join(temporary, 'data');
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  copyBackendResources(path.resolve(__dirname, '..'), backend);
  assert.deepEqual(fs.readdirSync(path.join(backend, 'scripts')), ['rule-compile.cjs']);
  assert.equal(fs.existsSync(path.join(backend, 'assets/EasyAG-Resident.exe')), false);
  assert.equal(fs.existsSync(path.join(backend, 'THIRD-PARTY-NOTICES.md')), true);
  const { createApplication } = require(path.join(backend, 'desktop/application'));
  const app = createApplication({ rootDir: backend, dataDir, native: true, testMode: true });
  t.after(() => app.close('test resource cleanup'));
  const port = await app.start();
  const url = `http://127.0.0.1:${port}`;
  const status = await (await fetch(url + '/api/status')).json();
  assert.ok(status.kbRules >= 20);
  assert.ok(status.dictEntries > 3000);
  assert.equal(status.clientRunning, false);
  for (const route of ['/', '/ui/launcher.js', '/ui/launcher.css', '/ui/api.js', '/capsule.html', '/assets/logo-32.png']) {
    assert.equal((await fetch(url + route)).status, 200, route);
  }
  await app.close('test resource cleanup');
});
