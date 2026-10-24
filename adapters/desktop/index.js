const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  discoverDesktop,
  discoverStandalone,
  discoverIde,
  discoverAllTargets,
  resolveTarget,
  desktopRunning,
  detectRunningTarget
} = require('./discovery');

function createDesktopAdapter(testMode = false) {
  const defaultTarget = resolveTarget('auto');
  return {
    kind: 'desktop',
    profile: defaultTarget.profile,
    capabilities: defaultTarget.capabilities,
    discoverAllTargets,
    resolveTarget,
    detectRunningTarget: testMode ? async () => null : detectRunningTarget,
    locate(target = 'hub') {
      const resolved = target === 'ide' ? discoverIde() : (target === 'auto' ? resolveTarget('auto') : discoverStandalone());
      return { ...resolved, exists: fs.existsSync(resolved.appExe) };
    },
    running: testMode ? async () => false : desktopRunning
  };
}

module.exports = { createDesktopAdapter };
