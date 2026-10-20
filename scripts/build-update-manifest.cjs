const fs = require('node:fs');
const path = require('node:path');
const { sha256Hex } = require('../features/updater');
const { DICT_FILES } = require('../features/i18n');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const baseUrl = process.env.EASYAG_MANIFEST_BASE_URL || 'https://raw.githubusercontent.com/DSDS-CMHL/EasyAntigravity/main/';
const dictVersion = process.env.EASYAG_DICT_VERSION || `${new Date().toISOString().slice(0, 10)}-hotfix1`;

function readLfBuffer(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return Buffer.from(text, 'utf8');
}

const dicts = {};
for (const name of DICT_FILES) {
  const file = path.join(root, 'dicts', name);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const canonical = JSON.stringify(parsed, null, 2) + '\n';
    fs.writeFileSync(file, canonical, 'utf8');
    const buf = Buffer.from(canonical, 'utf8');
    dicts[name] = {
      url: new URL('dicts/' + name, baseUrl).toString(),
      sha256: sha256Hex(buf)
    };
  }
}

const runtimeFiles = [
  'server.js',
  'index.html',
  'core/events.js',
  'core/session.js',
  'core/settings.js',
  'core/storage.js',
  'features/context-monitor.js',
  'features/context-widget.js',
  'features/i18n.js',
  'features/proxy.js',
  'features/updater.js',
  'adapters/desktop/cdp.js',
  'adapters/desktop/discovery.js',
  'adapters/desktop/index.js',
  'adapters/desktop/language-service.js',
  'adapters/desktop/language-service-discovery.js',
  'adapters/desktop/renderer.js',
  'desktop/api.js',
  'desktop/application.js',
  'desktop/host.js',
  'ui/api.js',
  'ui/launcher.css',
  'ui/launcher.js'
];

const files = {};
for (const rel of runtimeFiles) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    files[rel] = {
      url: new URL(rel, baseUrl).toString(),
      sha256: sha256Hex(readLfBuffer(full))
    };
  }
}

const manifest = {
  version: pkg.version,
  dictVersion,
  dicts,
  runtime: {
    version: pkg.version,
    files
  }
};

const outFile = path.join(root, 'update-manifest.json');
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Generated update-manifest.json (v${manifest.version}, dictVersion=${dictVersion}, ${Object.keys(dicts).length} dicts, ${Object.keys(files).length} runtime modules)`);

