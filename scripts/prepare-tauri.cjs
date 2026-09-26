// Run on the target runner: bundle Node and ws so end users need neither npm nor Rust.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const triple = process.argv[2];
const targets = {
  'x86_64-pc-windows-msvc': ['win32', 'x64'],
  'aarch64-apple-darwin': ['darwin', 'arm64'],
  'x86_64-apple-darwin': ['darwin', 'x64']
};
assert.deepEqual([process.platform, process.arch], targets[triple], 'Build Node on the matching target runner');
const backend = path.join(root, 'src-tauri', 'backend');
fs.mkdirSync(backend, { recursive: true });
for (const name of ['server.js', 'index.html', 'danger-rules.json', 'dicts', 'assets', 'scripts']) {
  const src = path.join(root, name);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(backend, name), { recursive: true });
  }
}
fs.cpSync(path.dirname(require.resolve('ws/package.json')), path.join(backend, 'node_modules', 'ws'), { recursive: true });
fs.mkdirSync(path.join(root, 'src-tauri', 'binaries'), { recursive: true });
const runtime = path.join(root, 'src-tauri', 'binaries', 'easyag-node-' + triple + (process.platform === 'win32' ? '.exe' : ''));
fs.copyFileSync(process.execPath, runtime);
if (process.platform !== 'win32') fs.chmodSync(runtime, 0o755);
if (process.platform === 'darwin') {
  try {
    const { execSync } = require('node:child_process');
    const entPath = path.join(root, 'src-tauri', 'Entitlements.plist');
    if (fs.existsSync(entPath)) {
      execSync(`codesign --force --options runtime --sign - --entitlements "${entPath}" "${runtime}"`);
      console.log('Signed easyag-node with JIT entitlements');
    }
  } catch (e) {
    console.warn('Warning: Could not pre-sign runtime:', e.message);
  }
}
console.log('Prepared backend and Node runtime:', triple);
