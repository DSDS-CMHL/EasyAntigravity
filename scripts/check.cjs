const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
function check(file, browser = false) {
  const absolute = path.join(root, file);
  execFileSync(process.execPath, ['--check', ...(browser ? ['--input-type=module'] : [])], {
    input: fs.readFileSync(absolute, 'utf8'), stdio: ['pipe', 'pipe', 'pipe']
  });
  count++;
}
function walk(directory) {
  const dirPath = path.join(root, directory);
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|cjs)$/.test(entry.name)) check(file, directory === 'ui');
  }
}
check('server.js');
for (const directory of ['core', 'features', 'desktop', 'ui']) walk(directory);
console.log(`PASS: ${count} JavaScript modules checked`);
