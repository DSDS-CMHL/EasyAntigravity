const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePath,
  discoverStandalone,
  discoverIde,
  discoverDesktop,
  discoverAllTargets,
  resolveTarget,
  desktopRunning,
  detectRunningTarget
} = require('../adapters/desktop/discovery');
const { createDesktopAdapter } = require('../adapters/desktop');

test('normalizePath cleans UNC and extended path prefixes on Windows', () => {
  if (process.platform === 'win32') {
    assert.equal(normalizePath('\\\\?\\C:\\app\\test.exe'), 'C:\\app\\test.exe');
    assert.equal(normalizePath('\\\\?\\UNC\\server\\share\\test.exe'), '\\\\server\\share\\test.exe');
  }
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath(null), null);
});

test('discoverAllTargets returns both hub and ide specs with correct schemas', () => {
  const targets = discoverAllTargets();
  assert.ok(targets.hub, 'hub spec must exist');
  assert.ok(targets.ide, 'ide spec must exist');
  assert.equal(targets.hub.id, 'hub');
  assert.equal(targets.ide.id, 'ide');
  assert.equal(targets.hub.name, 'Antigravity');
  assert.equal(targets.ide.name, 'Antigravity IDE');
  assert.equal(typeof targets.hub.exists, 'boolean');
  assert.equal(typeof targets.ide.exists, 'boolean');
  assert.equal(typeof targets.hub.appExe, 'string');
  assert.equal(typeof targets.ide.appExe, 'string');
});

test('discoverStandalone and discoverIde respect customPath', () => {
  const customHub = discoverStandalone('C:\\custom\\Antigravity.exe');
  assert.equal(customHub.appExe, 'C:\\custom\\Antigravity.exe');
  assert.equal(customHub.isCustom, true);

  const customIde = discoverIde('D:\\custom\\Antigravity IDE.exe');
  assert.equal(customIde.appExe, 'D:\\custom\\Antigravity IDE.exe');
  assert.equal(customIde.isCustom, true);

  const all = discoverAllTargets({
    customHubPath: 'C:\\custom\\Antigravity.exe',
    customIdePath: 'D:\\custom\\Antigravity IDE.exe'
  });
  assert.equal(all.hub.appExe, 'C:\\custom\\Antigravity.exe');
  assert.equal(all.ide.appExe, 'D:\\custom\\Antigravity IDE.exe');
});

test('resolveTarget respects preferences and defaults to hub when both or neither installed', () => {
  const resolvedAuto = resolveTarget('auto');
  assert.ok(['hub', 'ide'].includes(resolvedAuto.id));

  const resolvedHub = resolveTarget('hub');
  assert.equal(resolvedHub.id, 'hub');

  const resolvedIde = resolveTarget('ide');
  assert.equal(resolvedIde.id, 'ide');
});

test('desktopAdapter expose target-aware locate and detectRunningTarget', async () => {
  const adapter = createDesktopAdapter(true);
  assert.equal(typeof adapter.discoverAllTargets, 'function');
  assert.equal(typeof adapter.resolveTarget, 'function');
  const locatedHub = adapter.locate('hub');
  const locatedIde = adapter.locate('ide');
  assert.equal(locatedHub.id, 'hub');
  assert.equal(locatedIde.id, 'ide');
  assert.equal(await adapter.running('hub'), false);
  assert.equal(await adapter.running('ide'), false);
  assert.equal(await adapter.detectRunningTarget(), null);
});
