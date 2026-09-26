const fs = require('fs');
const path = require('path');
const os = require('os');

// Load danger-rules and compile like server.js
const rulesPath = path.join(__dirname, '..', 'danger-rules.json');
const data = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const { compileRulesToResources, compileJsPatternToOfficialTarget } = require('../scripts/rule-compile.cjs');
const patterns = (data.rules || []).filter(r => r && r.pattern && r.enabled !== false);
const targets = patterns.map(p => compileJsPatternToOfficialTarget(p.pattern));

console.log('compiled targets:', targets.length);
targets.forEach(t => {
  if (t.includes('command(')) {
    console.error('FAIL target already has command(:', t);
    process.exit(1);
  }
  if (/\s/.test(t.replace(/^regex:/, ''))) {
    console.warn('WARN pattern has literal spaces (may be token-split by official engine):', t);
  }
});

// Simulate double-wrap fix
const cleaned = targets.map(t => t.replace(/^command\((.*)\)$/s, '$1'));
const resources = cleaned.map(c => 'command(' + c + ')');
console.log('sample resource:', resources[0]);

const bad = 'command(command(regex:echo probe-beta))';
const fixed = 'command(' + bad.slice('command(command('.length, -2) + ')';
console.log('double-wrap fix:', bad, '->', fixed);
if (fixed !== 'command(regex:echo probe-beta)') {
  console.error('FAIL double-wrap fix');
  process.exit(1);
}

// Inject into a fake config
function injectDenyIntoConfig(obj, denyTargets) {
  let changed = false;
  const uniq = Array.from(new Set(denyTargets));
  const cleaned = uniq.map(t => t.replace(/^command\((.*)\)$/s, '$1'));
  const resources = cleaned.map(c => 'command(' + c + ')');
  function ensureDenyArray(host) {
    if (!host || typeof host !== 'object') return null;
    if (Array.isArray(host.deny)) return host.deny;
    if (host.allow !== undefined || host.ask !== undefined) {
      host.deny = host.deny || [];
      return host.deny;
    }
    return null;
  }
  function mergeInto(host) {
    const deny = ensureDenyArray(host);
    if (!deny) return;
    for (let i = 0; i < deny.length; i++) {
      const x = deny[i];
      if (typeof x === 'string' && x.startsWith('command(command(') && x.endsWith('))')) {
        deny[i] = 'command(' + x.slice('command(command('.length, -2) + ')';
        changed = true;
      }
    }
    for (const r of resources) {
      if (!deny.includes(r)) {
        deny.push(r);
        changed = true;
      }
    }
  }
  if (obj && obj.userSettings && obj.userSettings.globalPermissionGrants) {
    mergeInto(obj.userSettings.globalPermissionGrants);
  }
  if (obj && obj.permissionGrants) {
    if (obj.permissionGrants.permissionGrants) mergeInto(obj.permissionGrants.permissionGrants);
    else mergeInto(obj.permissionGrants);
  }
  return changed;
}

const fake = {
  userSettings: {
    globalPermissionGrants: {
      allow: ['command(echo probe-alpha)'],
      deny: ['command(command(regex:echo probe-beta))']
    }
  }
};
const changed = injectDenyIntoConfig(fake, targets);
const deny = fake.userSettings.globalPermissionGrants.deny;
console.log('changed=', changed);
console.log('deny entries=', deny.length);
console.log('first=', deny[0]);
if (deny.some(x => x.startsWith('command(command('))) {
  console.error('FAIL still has double wrap');
  process.exit(1);
}
if (!changed) {
  console.error('FAIL not changed');
  process.exit(1);
}
console.log('ALL OK');
