const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, normalizeSettings, createSettings } = require('../core/settings');

test('CLI Settings: default values', () => {
  const norm = normalizeSettings({});
  assert.equal(norm.port, 7890);
  assert.equal(norm.enableProxy, true);
  assert.equal(norm.skipPermissions, false);
});

test('CLI Settings: custom values and validation', () => {
  const custom = normalizeSettings({ port: 7897, enableProxy: false, skipPermissions: true });
  assert.equal(custom.port, 7897);
  assert.equal(custom.enableProxy, false);
  assert.equal(custom.skipPermissions, true);

  assert.throws(() => normalizeSettings({ port: 'not-a-port' }), /代理端口必须是 1–65535 的整数/);
  assert.throws(() => normalizeSettings({ port: 0 }), /代理端口必须是 1–65535 的整数/);
  assert.throws(() => normalizeSettings({ port: 70000 }), /代理端口必须是 1–65535 的整数/);
  assert.throws(() => normalizeSettings({ enableProxy: 'yes' }), /enableProxy 必须是布尔值/);
  assert.throws(() => normalizeSettings({ skipPermissions: 1 }), /skipPermissions 必须是布尔值/);
});

test('CLI Settings: createSettings persists to file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-cli-settings-'));
  const file = path.join(tmpDir, 'settings.json');
  try {
    const s = createSettings(file);
    assert.equal(s.get().port, 7890);
    s.update({ port: 10808, enableProxy: false });
    assert.equal(s.get().port, 10808);
    assert.equal(s.get().enableProxy, false);

    // Re-read from disk
    const s2 = createSettings(file);
    assert.equal(s2.get().port, 10808);
    assert.equal(s2.get().enableProxy, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
