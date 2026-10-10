// Pure configuration-shape helpers. Persistence, injection and Turbo policy
// remain owned by PermissionAdapter; no launch/UI logic belongs here.
const ACTIONS = ['allow', 'deny', 'ask'];
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const GRANTS_PATH = ['userSettings', 'globalPermissionGrants'];

function normalizePermissionGrants(settings, journal) {
  const current = settings.globalPermissionGrants;
  if (current !== undefined && current !== null && !isObject(current)) {
    throw new Error('globalPermissionGrants 格式不正确');
  }
  // Validate before changing anything. A malformed non-null value may contain
  // user data; never silently replace it with an empty list.
  for (const action of ACTIONS) {
    const list = current?.[action];
    if (list !== undefined && list !== null && !Array.isArray(list)) {
      throw new Error(`${action} 规则格式不正确`);
    }
  }
  if (!owns(settings, 'globalPermissionGrants')) {
    journal.created.push([...GRANTS_PATH]);
    settings.globalPermissionGrants = {};
  } else if (current === null) {
    (journal.normalized ||= []).push({ path: [...GRANTS_PATH], before: null });
    settings.globalPermissionGrants = {};
  }
  const grants = settings.globalPermissionGrants;
  for (const action of ACTIONS) {
    if (!owns(grants, action)) {
      journal.created.push([...GRANTS_PATH, action]);
      grants[action] = [];
    } else if (grants[action] === null) {
      (journal.normalized ||= []).push({ path: [...GRANTS_PATH, action], before: null });
      grants[action] = [];
    }
  }
  return grants;
}

function verifyPermissionGrants(settings, lists) {
  const grants = settings?.globalPermissionGrants;
  return isObject(grants) && ACTIONS.every(action => Array.isArray(grants[action])
    && lists[action].every(resource => grants[action].includes(resource)));
}

function restorePermissionStructure(object, journal) {
  let restored = false;
  const conflicts = [];
  const parentOf = parts => parts.slice(0, -1).reduce((current, key) => current?.[key], object);
  // Remove only still-empty containers created by this session, from leaves up.
  for (const parts of [...(journal.created || [])].reverse()) {
    const parent = parentOf(parts);
    const key = parts.at(-1);
    const value = parent?.[key];
    if (isObject(parent) && value !== null && typeof value === 'object' && !Object.keys(value).length) {
      delete parent[key];
      restored = true;
    }
  }
  // Null is different from missing. Restore it only if the normalized value is
  // still empty; later user/AG additions must survive recovery and restarts.
  for (const field of [...(journal.normalized || [])].reverse()) {
    const parent = parentOf(field.path);
    const key = field.path.at(-1);
    const value = parent?.[key];
    if (isObject(parent) && value === field.before) continue;
    if (isObject(parent) && value !== null && typeof value === 'object' && !Object.keys(value).length) {
      parent[key] = field.before;
      restored = true;
    } else conflicts.push(field.path.join('.'));
  }
  return { restored, conflicts };
}

module.exports = { ACTIONS, normalizePermissionGrants, verifyPermissionGrants, restorePermissionStructure };
