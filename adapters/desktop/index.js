const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stopTarget, canonicalTarget } = require('./process-control');
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
    discoverAllTargets: (settings = {}) => discoverAllTargets(settings),
    resolveTarget: (target = 'auto', settings = {}) => resolveTarget(target, settings),
    detectRunningTarget: testMode ? async () => null : ((pref = 'auto', settings = {}) => detectRunningTarget(pref, settings)),
    locate(target = 'hub', settings = {}) {
      const resolved = target === 'ide'
        ? discoverIde(settings.customIdePath)
        : (target === 'auto' ? resolveTarget('auto', settings) : discoverStandalone(settings.customHubPath));
      return { ...resolved, exists: fs.existsSync(resolved.appExe) };
    },
    running: testMode ? async () => false : desktopRunning,
    stop: testMode ? async () => ({ ok: true }) : (target, options) => stopTarget(canonicalTarget(target), options)
  };
}

module.exports = { createDesktopAdapter };
