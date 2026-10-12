const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../../core/storage');
const { ACTIONS, normalizePermissionGrants, verifyPermissionGrants, restorePermissionStructure } = require('./permission-config');

const TERMINAL_TURBO = 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER';
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

/** Desktop-only adapter. The journal is durable before the AG configuration changes. */
class PermissionAdapter {
  constructor({ configFile, dataDir, write = writeJson }) {
    this.configFile = configFile;
    this.journalFile = path.join(dataDir, 'permission-session.json');
    this.legacyFile = path.join(dataDir, 'injected-ask.json');
    this.write = write;
  }

  journal() {
    if (fs.existsSync(this.journalFile)) return readJson(this.journalFile);
    if (!fs.existsSync(this.legacyFile)) return null;
    const old = readJson(this.legacyFile);
    const fields = {};
    const saved = old.savedGlobal;
    if (saved?.values && saved?.present) {
      const applied = {
        autoExecutionPolicy: TERMINAL_TURBO,
        fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
        nonWorkspaceFileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
        sandboxMode: false, enableTerminalSandbox: false
      };
      for (const key of Object.keys(saved.present)) {
        fields[key] = { present: saved.present[key], before: saved.values[key], applied: applied[key] };
      }
    }
    return {
      version: 2, file: this.configFile, at: old.at, fields, created: [],
      injections: old.injections?.length ? old.injections : [{
        file: this.configFile, list: old.list || 'ask', resources: old.resources || []
      }]
    };
  }

  status() {
    const journal = this.journal();
    const resources = (journal?.injections || []).flatMap(item => item.resources || []);
    return { count: resources.length, resources, at: journal?.at || null, scope: 'global', list: 'mixed' };
  }

  apply(lists, { turbo = true } = {}) {
    try {
      if (!fs.existsSync(this.configFile)) throw new Error('未找到 Antigravity 全局配置: ' + this.configFile);
      if (!lists || ACTIONS.some(action => !Array.isArray(lists[action]))) throw new Error('无效的权限规则列表');
      const count = ACTIONS.reduce((sum, action) => sum + lists[action].length, 0);
      if (!count) throw new Error('没有可用的权限规则');
      const object = readJson(this.configFile);
      if (!isObject(object)) throw new Error('Antigravity 配置必须是 JSON 对象');
      const previous = this.journal();
      if (previous && path.resolve(previous.file) !== path.resolve(this.configFile)) {
        throw new Error('上次会话指向另一份配置，请先恢复');
      }
      const journal = previous || {
        version: 2, file: this.configFile, fields: {}, injections: [], created: [], at: new Date().toISOString()
      };
      if (object.userSettings !== undefined && !isObject(object.userSettings)) throw new Error('userSettings 格式不正确');
      if (!owns(object, 'userSettings')) {
        journal.created.push(['userSettings']);
        object.userSettings = {};
      }
      const settings = object.userSettings;
      const grants = normalizePermissionGrants(settings, journal);
      for (const action of ACTIONS) {
        if (!lists[action].length) continue;
        const additions = lists[action].filter(resource => !grants[action].includes(resource));
        grants[action].push(...additions);
        let entry = journal.injections.find(item => item.file === this.configFile && item.list === action);
        if (!entry) {
          entry = { file: this.configFile, list: action, resources: [] };
          journal.injections.push(entry);
        }
        entry.resources = [...new Set([...entry.resources, ...additions])];
      }
      if (turbo) {
        if (!journal.fields.autoExecutionPolicy) {
          journal.fields.autoExecutionPolicy = {
            present: owns(settings, 'autoExecutionPolicy'), before: settings.autoExecutionPolicy,
            applied: TERMINAL_TURBO
          };
        }
        settings.autoExecutionPolicy = TERMINAL_TURBO;
      }
      // No workspace/file/sandbox policies are changed by EasyAG.
      writeJson(this.journalFile, journal);
      this.write(this.configFile, object);
      const checked = readJson(this.configFile).userSettings;
      if (!checked || (turbo && checked.autoExecutionPolicy !== TERMINAL_TURBO)
        || !verifyPermissionGrants(checked, lists)) {
        throw new Error('原生权限规则或自动执行策略写后校验失败');
      }
      return {
        ok: true, count, turbo, scope: 'global', list: 'mixed',
        files: [this.configFile], verifiedFiles: [this.configFile],
        sample: ACTIONS.flatMap(action => lists[action]).slice(0, 3)
      };
    } catch (error) {
      // A partially applied transaction retains its journal if recovery also fails.
      let recovery;
      try { recovery = this.restore(); } catch (failure) { recovery = { ok: false, error: failure.message }; }
      return { ok: false, error: error.message, recovery };
    }
  }

  // Replace only this session's overlay; never reset the original policy or
  // claim pre-existing user rules as ours. A durable superset journal covers
  // both sides of the write if the process dies midway through a reload.
  refresh(lists) {
    try {
      if (!lists || ACTIONS.some(action => !Array.isArray(lists[action])
        || lists[action].some(resource => typeof resource !== 'string'))) throw new Error('无效的权限规则列表');
      const previous = this.journal();
      if (!previous || path.resolve(previous.file) !== path.resolve(this.configFile)) throw new Error('当前没有可重载的 Pilot 权限会话');
      const object = readJson(this.configFile);
      if (!isObject(object?.userSettings)) throw new Error('userSettings 格式不正确');
      const pending = JSON.parse(JSON.stringify(previous));
      const grants = normalizePermissionGrants(object.userSettings, pending);
      const next = JSON.parse(JSON.stringify(pending));
      for (const action of ACTIONS) {
        const owned = new Set(previous.injections.filter(item => item.file === this.configFile && item.list === action)
          .flatMap(item => item.resources));
        const wanted = new Set(lists[action]);
        const retained = grants[action].filter(resource => !owned.has(resource) || wanted.has(resource));
        const additions = [...wanted].filter(resource => !retained.includes(resource));
        grants[action] = [...retained, ...additions];
        pending.injections = pending.injections.filter(item => item.file !== this.configFile || item.list !== action);
        next.injections = next.injections.filter(item => item.file !== this.configFile || item.list !== action);
        pending.injections.push({ file: this.configFile, list: action, resources: [...new Set([...owned, ...additions])] });
        next.injections.push({ file: this.configFile, list: action,
          resources: [...new Set([...owned].filter(resource => wanted.has(resource)).concat(additions))] });
      }
      writeJson(this.journalFile, pending);
      this.write(this.configFile, object);
      if (JSON.stringify(readJson(this.configFile)) !== JSON.stringify(object)
        || !verifyPermissionGrants(object.userSettings, lists)) throw new Error('重载权限规则写后校验失败');
      writeJson(this.journalFile, next);
      return { ok: true, count: ACTIONS.reduce((sum, action) => sum + new Set(lists[action]).size, 0),
        nativeRulesWritten: true, runtimeVerified: false };
    } catch (error) {
      // Do not restore/disable Turbo on a reload failure. Keep the recovery
      // journal so shutdown or the next startup can remove either overlay.
      return { ok: false, error: error.message };
    }
  }

  restore() {
    try {
      const journal = this.journal();
      if (!journal) return { ok: true, removed: 0, restored: false, conflicts: [] };
      const files = new Set([journal.file, ...(journal.injections || []).map(item => item.file || journal.file)]);
      let removed = 0;
      let restored = false;
      const conflicts = [];
      for (const file of files) {
        const object = readJson(file);
        const settings = object.userSettings;
        const grants = settings?.globalPermissionGrants || object.permissionGrants?.permissionGrants || object.permissionGrants;
        for (const injection of journal.injections || []) {
          if ((injection.file || journal.file) !== file || !Array.isArray(grants?.[injection.list])) continue;
          const resources = new Set(injection.resources);
          const originalLength = grants[injection.list].length;
          grants[injection.list] = grants[injection.list].filter(resource => !resources.has(resource));
          removed += originalLength - grants[injection.list].length;
        }
        if (file === journal.file && settings) {
          for (const [key, field] of Object.entries(journal.fields || {})) {
            if (settings[key] !== field.applied) {
              // Preserve edits made by the user/host after the enhancement was applied.
              if (!(field.present ? settings[key] === field.before : !owns(settings, key))) conflicts.push(key);
              continue;
            }
            if (field.present) settings[key] = field.before;
            else delete settings[key];
            restored = true;
          }
          const structure = restorePermissionStructure(object, journal);
          restored ||= structure.restored;
          conflicts.push(...structure.conflicts);
        }
        this.write(file, object);
        if (JSON.stringify(readJson(file)) !== JSON.stringify(object)) throw new Error('配置恢复校验失败');
      }
      for (const file of [this.journalFile, this.legacyFile]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return { ok: true, removed, restored, conflicts };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = { PermissionAdapter, TERMINAL_TURBO };
