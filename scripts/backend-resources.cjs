const fs = require('node:fs');
const path = require('node:path');

/** Explicit runtime resources; development tools and the legacy C# host are not shipped. */
function copyBackendResources(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['server.js', 'index.html', 'danger-rules.json', 'dicts', 'core', 'features', 'adapters', 'desktop', 'ui']) {
    fs.cpSync(path.join(root, name), path.join(destination, name), { recursive: true });
  }
  for (const directory of ['scripts', 'src', 'knowledge', 'assets']) {
    fs.mkdirSync(path.join(destination, directory), { recursive: true });
  }
  fs.copyFileSync(path.join(root, 'scripts/rule-compile.cjs'), path.join(destination, 'scripts/rule-compile.cjs'));
  fs.copyFileSync(path.join(root, 'src/capsule.html'), path.join(destination, 'src/capsule.html'));
  fs.copyFileSync(path.join(root, 'Agentguard-dev/src/rules/signatures.json'), path.join(destination, 'knowledge/signatures.json'));
  for (const name of fs.readdirSync(path.join(root, 'assets'))) {
    if (/\.(?:png|ico|svg|webp)$/i.test(name)) fs.copyFileSync(path.join(root, 'assets', name), path.join(destination, 'assets', name));
  }
  fs.cpSync(path.dirname(require.resolve('ws/package.json')), path.join(destination, 'node_modules/ws'), { recursive: true });
}

module.exports = { copyBackendResources };
