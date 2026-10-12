// Pilot defaults are distinct from command-rule compilation. Read access does
// not grant browser actuation, and is always Allow regardless of command action.
function compilePilotPermissions(rules, protectionLevel = 'standard', action) {
  const lists = rules.compile(action, protectionLevel);
  return { allow: [...new Set([...lists.allow, 'read_url(*)'])],
    deny: [...lists.deny], ask: [...lists.ask] };
}

module.exports = { compilePilotPermissions };
