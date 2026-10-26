const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findAgyExe,
  uriToLocalPath,
  localPathToUri,
  getProjectsAndConversations,
  createProject,
  checkTerminalType,
  launchCliTerminal,
  openFolder
} = require('../features/cli-launcher');

test('CLI Launcher: findAgyExe returns structure', () => {
  const agy = findAgyExe();
  assert.equal(typeof agy.installed, 'boolean');
  assert.equal(typeof agy.path, 'string');
});

test('CLI Launcher: uriToLocalPath and localPathToUri conversion', () => {
  const local = 'C:\\Projects\\MyApp';
  const uri = localPathToUri(local);
  assert.match(uri, /^file:\/\/\//);
  const convertedBack = uriToLocalPath(uri);
  assert.equal(convertedBack.toLowerCase(), local.toLowerCase());

  assert.equal(uriToLocalPath(''), '');
  assert.equal(uriToLocalPath(null), '');
});

test('CLI Launcher: getProjectsAndConversations returns array of projects', () => {
  const projects = getProjectsAndConversations();
  assert.equal(Array.isArray(projects), true);
  for (const p of projects) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.path, 'string');
    assert.equal(Array.isArray(p.conversations), true);
    for (const c of p.conversations) {
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.title, 'string');
      assert.equal(typeof c.numSteps, 'number');
    }
  }
});

test('CLI Launcher: createProject validates input and registers project', () => {
  const invalid = createProject({});
  assert.equal(invalid.ok, false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-cli-proj-'));
  try {
    const res = createProject({ name: 'TestProject', folderPath: tmpDir });
    assert.equal(res.ok, true);
    assert.equal(res.project.name, 'TestProject');
    assert.equal(res.project.path.toLowerCase(), tmpDir.toLowerCase());
    assert.equal(Array.isArray(res.project.conversations), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI Launcher: checkTerminalType returns wt or powershell', () => {
  const term = checkTerminalType();
  assert.ok(term.type === 'wt' || term.type === 'powershell');
  assert.equal(typeof term.path, 'string');
});

test('CLI Launcher: launchCliTerminal validates workspace directory', () => {
  const nonExistent = path.join(os.tmpdir(), 'non-existent-dir-' + Date.now());
  const res = launchCliTerminal({ workspace: nonExistent });
  assert.equal(res.ok, false);
  assert.match(res.error, /工作目录不存在|未检测到 Antigravity CLI/);
});

test('CLI Launcher: openFolder validates directory path', () => {
  assert.equal(openFolder('').ok, false);
  const nonExistent = path.join(os.tmpdir(), 'non-existent-dir-' + Date.now());
  assert.equal(openFolder(nonExistent).ok, false);
});
