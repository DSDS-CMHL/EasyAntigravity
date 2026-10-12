// Apply a reviewed JS-only overlay to an already-built package. No compilation.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const backend = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(backend, 'server.js'))
  || !fs.existsSync(path.join(backend, 'THIRD-PARTY-NOTICES.md'))) throw new Error('Supply an existing packaged backend directory');
const files = ['features/pilot-permissions.js', 'core/session.js', 'desktop/application.js', 'desktop/api.js'];
for (const file of files) {
  const destination = path.join(backend, file);
  if (!destination.startsWith(backend + path.sep)) throw new Error('Invalid overlay target');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
  const sha256 = createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  console.log(`${sha256}  ${file}`);
}
const compiled = require(path.join(backend, 'features/pilot-permissions')).compilePilotPermissions({
  compile: () => ({ allow: [], deny: [], ask: [] })
});
if (JSON.stringify(compiled.allow) !== JSON.stringify(['read_url(*)'])) throw new Error('URL overlay verification failed');
console.log('Pilot URL-read overlay applied; existing native runtime and other resources retained.');
