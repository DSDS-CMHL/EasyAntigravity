const fs = require('node:fs');
const path = require('node:path');

/** Explicit runtime resources for Lite base; includes package.json for version comparison during hot updates. */
function copyBackendResources(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['server.js', 'index.html', 'package.json', 'THIRD-PARTY-NOTICES.md', 'dicts', 'core', 'features', 'adapters', 'desktop', 'ui']) {
    fs.cpSync(path.join(root, name), path.join(destination, name), { recursive: true });
  }
  fs.mkdirSync(path.join(destination, 'assets'), { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'assets'))) {
    if (/\.(?:png|ico|svg|webp)$/i.test(name)) fs.copyFileSync(path.join(root, 'assets', name), path.join(destination, 'assets', name));
  }
  fs.cpSync(path.dirname(require.resolve('ws/package.json')), path.join(destination, 'node_modules/ws'), { recursive: true });
}

module.exports = { copyBackendResources };
