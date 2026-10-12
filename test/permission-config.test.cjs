// In-memory configuration/journal regression for issue #7. No AG access,
// filesystem writes, processes, sockets, or native builds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shapes = require('../adapters/desktop/permission-config');
const adapterSource = fs.readFileSync(path.join(__dirname, '../adapters/desktop/permissions.js'), 'utf8');
const lists = { allow: [], deny: [], ask: ['command(regex:danger)'] };

function fixture(original, { failOnce = false } = {}) {
  const configFile = path.resolve('virtual-permission-config.json');
  const dataDir = path.resolve('virtual-permission-data');
  const journalFile = path.join(dataDir, 'permission-session.json');
  const documents = new Map([[configFile, JSON.stringify(original)]]);
  const readJson = file => {
    if (!documents.has(file)) throw new Error('virtual file missing');
    return JSON.parse(documents.get(file));
  };
  const writeJson = (file, object) => documents.set(file, JSON.stringify(object));
  const context = vm.createContext({ module: { exports: {} }, require(name) {
    if (name === 'node:fs') return { existsSync: file => documents.has(file), unlinkSync: file => documents.delete(file) };
    if (name === 'node:path') return path;
    if (name === '../../core/storage') return { readJson, writeJson };
    if (name === './permission-config') return shapes;
    throw new Error('Unexpected adapter dependency: ' + name);
  } });
  vm.runInContext(adapterSource, context);
  const { PermissionAdapter, TERMINAL_TURBO } = context.module.exports;
  function create() {
    return new PermissionAdapter({ configFile, dataDir, write(file, object) {
      if (file === configFile && object.userSettings?.autoExecutionPolicy === TERMINAL_TURBO) {
        assert.ok(documents.has(journalFile), 'Journal must be durable before changing AG');
      }
      writeJson(file, object);
      if (failOnce) { failOnce = false; throw new Error('simulated partial write failure'); }
    } });
  }
  return { create, read: () => readJson(configFile), write: object => writeJson(configFile, object),
    journal: () => readJson(journalFile), hasJournal: () => documents.has(journalFile),
    failNextWrite: () => { failOnce = true; } };
}

test('issue #7: empty, missing, partial and null grants apply and restore exactly', () => {
  const settings = [
    {}, { globalPermissionGrants: {} }, { globalPermissionGrants: null },
    { globalPermissionGrants: { allow: [] } },
    { globalPermissionGrants: { ask: null } },
    { globalPermissionGrants: { allow: null, ask: null, deny: null } },
    { globalPermissionGrants: { allow: ['command(Get-Date)'], metadata: { untouched: true } } },
    { globalPermissionGrants: { allow: [], ask: [], deny: [] } }
  ];
  for (const input of settings) {
    const original = { untouched: true, userSettings: { ...input, autoExecutionPolicy: 'user-choice', fileAccessPolicy: 'user-files' } };
    const context = fixture(original);
    const adapter = context.create();
    const result = adapter.apply(lists);
    assert.equal(result.ok, true, JSON.stringify(input));
    assert.equal(shapes.verifyPermissionGrants(context.read().userSettings, lists), true);
    assert.equal(adapter.apply(lists).ok, true, 'Repeated apply is idempotent');
    assert.equal(adapter.status().count, 1, 'Only new resources belong to EasyAG');
    assert.equal(context.create().restore().ok, true, 'Recovery also works after restart');
    assert.deepEqual(context.read(), original, 'Restore the original structure, not a preset');
    assert.equal(context.hasJournal(), false);
  }
});

test('reload replaces owned rules, preserves user additions and recovers the original policy after restart', () => {
  const original = { userSettings: { autoExecutionPolicy: 'original', globalPermissionGrants: {
    ask: ['command(user-rule)'] }, unrelated: true } };
  const context = fixture(original), adapter = context.create();
  assert.equal(adapter.apply(lists).ok, true);
  const edited = context.read();
  edited.userSettings.globalPermissionGrants.ask.push('command(user-added)');
  edited.userSettings.autoExecutionPolicy = 'user-edited-policy';
  context.write(edited);
  const replacement = { allow: [], deny: ['command(new-deny)'], ask: ['command(user-rule)', 'command(reload-probe)'] };
  assert.equal(adapter.refresh(replacement).ok, true);
  assert.deepEqual(context.read().userSettings.globalPermissionGrants.ask,
    ['command(user-rule)', 'command(user-added)', 'command(reload-probe)']);
  assert.equal(context.read().userSettings.autoExecutionPolicy, 'user-edited-policy');
  assert.equal(adapter.status().count, 2);
  assert.equal(context.create().restore().ok, true);
  assert.deepEqual(context.read(), { userSettings: { ...original.userSettings,
    autoExecutionPolicy: 'user-edited-policy', globalPermissionGrants: { ask: ['command(user-rule)', 'command(user-added)'] } } });
});

test('reload supports zero enabled rules without losing the original recovery journal', () => {
  const original = { userSettings: { autoExecutionPolicy: 'original', globalPermissionGrants: {} } };
  const context = fixture(original), adapter = context.create();
  assert.equal(adapter.apply(lists).ok, true);
  assert.equal(adapter.refresh({ allow: [], deny: [], ask: [] }).ok, true);
  assert.equal(adapter.status().count, 0);
  assert.equal(adapter.restore().ok, true);
  assert.deepEqual(context.read(), original);
});

test('failed reload keeps a durable recovery journal covering old and new overlays', () => {
  const original = { userSettings: { autoExecutionPolicy: 'original', globalPermissionGrants: {} } };
  const context = fixture(original), adapter = context.create();
  assert.equal(adapter.apply(lists).ok, true);
  context.failNextWrite();
  assert.equal(adapter.refresh({ allow: [], deny: [], ask: ['command(new-rule)'] }).ok, false);
  assert.equal(context.hasJournal(), true);
  assert.equal(context.read().userSettings.autoExecutionPolicy, 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER');
  assert.equal(context.create().restore().ok, true);
  assert.deepEqual(context.read(), original);
});

test('reload without an active journal cannot mutate user permissions', () => {
  const original = { userSettings: { globalPermissionGrants: {} } };
  const context = fixture(original);
  assert.equal(context.create().refresh(lists).ok, false);
  assert.deepEqual(context.read(), original);
});

test('Pilot URL default restores only its own grant and preserves preexisting URL exceptions', () => {
  for (const alreadyAllowed of [false, true]) {
    const original = { userSettings: { autoExecutionPolicy: 'original', globalPermissionGrants: {
      allow: alreadyAllowed ? ['read_url(*)'] : [], ask: ['read_url(example.com)'], deny: ['read_url(example.org)'] } } };
    const context = fixture(original), adapter = context.create();
    const pilot = { allow: ['read_url(*)'], deny: [], ask: ['command(probe)'] };
    assert.equal(adapter.apply(pilot).ok, true);
    assert.equal(adapter.refresh(pilot).ok, true);
    const ownsUrl = context.journal().injections.some(item => item.list === 'allow' && item.resources.includes('read_url(*)'));
    assert.equal(ownsUrl, !alreadyAllowed);
    assert.equal(adapter.restore().ok, true);
    assert.deepEqual(context.read(), original);
  }
});

test('all three actions preserve existing resources and unrelated settings', () => {
  const original = { userSettings: { globalPermissionGrants: {
    allow: ['command(user-allow)'], deny: ['command(user-deny)'], ask: ['command(regex:danger)'], custom: true
  } } };
  const context = fixture(original), adapter = context.create();
  const actions = { ...lists, allow: ['command(echo ok)'], deny: ['command(wipe)'] };
  assert.equal(adapter.apply(actions, { turbo: false }).ok, true);
  assert.equal(shapes.verifyPermissionGrants(context.read().userSettings, actions), true);
  assert.equal(adapter.status().count, 2);
  assert.equal(adapter.restore().ok, true);
  assert.deepEqual(context.read(), original);
});

test('failure after config write restores empty/null structures', () => {
  for (const grants of [{}, null, { ask: null }]) {
    const original = { userSettings: { globalPermissionGrants: grants } };
    const context = fixture(original, { failOnce: true });
    const result = context.create().apply(lists);
    assert.equal(result.ok, false);
    assert.equal(result.recovery.ok, true);
    assert.deepEqual(context.read(), original);
    assert.equal(context.hasJournal(), false);
  }
});

test('later user additions survive restore; null snapshots do not overwrite them', () => {
  for (const originalGrants of [null, { ask: null }]) {
    const context = fixture({ userSettings: { globalPermissionGrants: originalGrants } });
    assert.equal(context.create().apply(lists).ok, true);
    const current = context.read();
    current.userSettings.globalPermissionGrants.ask.push('command(user-later)');
    context.write(current);
    const result = context.create().restore();
    assert.equal(result.ok, true);
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(context.read().userSettings.globalPermissionGrants, { ask: ['command(user-later)'] });
  }
});

test('malformed non-null values are rejected, not erased or treated as arrays', () => {
  for (const grants of [[], 'invalid', { ask: 'command(regex:danger)' }, { allow: { custom: true } }]) {
    const original = { userSettings: { globalPermissionGrants: grants } };
    const context = fixture(original);
    assert.equal(context.create().apply(lists).ok, false);
    assert.deepEqual(context.read(), original);
    assert.equal(context.hasJournal(), false);
  }
  assert.equal(shapes.verifyPermissionGrants({ globalPermissionGrants: { allow: [], deny: [], ask: 'command(regex:danger)' } }, lists), false);
});

test('legacy journals without normalization metadata still restore owned fields', () => {
  const original = { userSettings: { globalPermissionGrants: {} } };
  const context = fixture(original);
  assert.equal(context.create().apply(lists).ok, true);
  assert.equal(context.journal().normalized, undefined);
  assert.equal(context.create().restore().ok, true);
  assert.deepEqual(context.read(), original);
});
