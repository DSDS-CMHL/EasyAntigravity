const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { discoverDesktop, desktopRunning } = require('./discovery');

function createDesktopAdapter(testMode = false) {
  const profile = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/Antigravity')
    : path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Antigravity');
  return {
    kind: 'desktop', profile,
    capabilities: { cdp: true, metrics: true },
    locate() {
      const target = discoverDesktop();
      return { ...target, exists: fs.existsSync(target.appExe) };
    },
    running: testMode ? async () => false : desktopRunning
  };
}

module.exports = { createDesktopAdapter };
