// Protection strength changes native approval scope, not ARES risk severity.
const { GIT_PREFIX } = require('./command-patterns');
const PROTECTION_LEVELS = Object.freeze(['strict', 'standard', 'relaxed']);
const LABELS = Object.freeze({ strict: '严格', standard: '标准', relaxed: '宽松' });
function validateProtectionLevel(level) {
  if (!PROTECTION_LEVELS.includes(level)) throw new Error('防护强度必须为严格、标准或宽松');
  return level;
}

const STRICT_DELETE = String.raw`\brm(?:\.exe)?\b[^\n|;&]*\s+(?:--(?:recursive|force)|-[a-zA-Z]*[rf][a-zA-Z]*)(?:\s|$|['"|;&])`;
const STRICT_GIT = GIT_PREFIX + String.raw`(?:push\b[^\n|;&]*(?:--?force\b|-f\b)|reset\s+--hard\b|clean\b[^\n|;&]*\s+(?:--force\b|-[a-zA-Z]*[fxd][a-zA-Z]*)(?:\s|$|['"|;&])|filter-branch\b)`;
const CRITICAL_TARGET = String.raw`(?:/(?:$|[\s'"*])|/(?:etc|usr|bin|sbin|boot|root|home|var)(?:[/\s'"*]|$)|[A-Za-z]:[/\\](?:$|[\s'"*]|(?:Windows|Users|Program\s+Files)(?:[/\\\s'"*]|$))|~(?:[/\\\s'"*]|$)|[^\s'"|;&]*(?:\.ssh|\.aws|credentials)(?:[/\\\s'"*]|$))`;
const CRITICAL_DELETE = String.raw`\b(?:rm|Remove-Item|del|rd|rmdir|erase)(?:\.exe)?\b[^\n|;&]*\s+["']?` + CRITICAL_TARGET;
const RELAXED_KEEP = new Set(['disk-destroy', 'raw-device-write', 'cred-destroy-or-dump',
  'backup-wipe', 'db-destroy', 'remote-exec']);

function protectionRules(active, bundled, level = 'standard') {
  validateProtectionLevel(level);
  if (level === 'standard') return active;
  const stock = new Map((bundled?.rules || []).map(rule => [rule.id, rule]));
  return active.flatMap(rule => {
    const original = stock.get(rule.id);
    // Custom patterns, flags, metadata with an explicit action, and new user
    // rules are never weakened/replaced by a preset. Disabled rules are not active.
    const managed = original && rule.pattern === original.pattern
      && (rule.flags === undefined ? 'i' : rule.flags) === (original.flags === undefined ? 'i' : original.flags)
      && rule.action === undefined;
    if (!managed) return [rule];
    if (level === 'strict') {
      if (rule.id === 'fs-recursive-delete') return [{ ...rule, pattern: '(?:' + rule.pattern + ')|(?:' + STRICT_DELETE + ')' }];
      if (rule.id === 'git-destructive') return [{ ...rule, pattern: '(?:' + rule.pattern + ')|(?:' + STRICT_GIT + ')' }];
      return [rule];
    }
    if (rule.id === 'fs-recursive-delete') return [{ ...rule, pattern: CRITICAL_DELETE }];
    return RELAXED_KEEP.has(rule.id) ? [rule] : [];
  });
}

module.exports = { PROTECTION_LEVELS, LABELS, validateProtectionLevel, protectionRules };
