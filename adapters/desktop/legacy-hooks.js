const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readJson, writeJson } = require('../../core/storage');

// Remove only identifiable EasyAG registrations. Other hooks and hook files are left intact.
function removeLegacyHooks(file = path.join(os.homedir(), '.gemini/config/hooks.json')) {
  if (!fs.existsSync(file)) return { removed: 0 };
  const hooks = readJson(file);
  let removed = 0;
  const expected = {
    'easyag-task-done': 'easyag-stop-hook',
    'easyag-danger-gate': 'easyag-pretool-hook'
  };
  for (const [key, script] of Object.entries(expected)) {
    if (hooks[key] && JSON.stringify(hooks[key]).includes(script)) {
      delete hooks[key];
      removed++;
    }
  }
  if (removed) writeJson(file, hooks);
  return { removed };
}

module.exports = { removeLegacyHooks };
