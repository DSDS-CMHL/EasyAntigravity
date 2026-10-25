const { readJson, writeJson } = require('./storage');

const DEFAULTS = Object.freeze({
  port: 7890,
  enableI18n: true,
  enableContextMonitor: true,
  enableProxy: true,
  targetApp: 'auto'
});

function normalizeSettings(input = {}, previous = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象');
  const result = { ...DEFAULTS, ...previous };
  if (input.port !== undefined) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理端口必须是 1–65535 的整数');
    result.port = port;
  }
  for (const key of ['enableI18n', 'enableContextMonitor', 'enableProxy']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      result[key] = input[key];
    }
  }
  if (input.targetApp !== undefined) {
    if (!['auto', 'hub', 'ide'].includes(input.targetApp)) throw new Error('启动目标必须是 auto、hub 或 ide');
    result.targetApp = input.targetApp;
  }
  return result;
}

function createSettings(file) {
  let value;
  try { value = normalizeSettings(readJson(file, {})); } catch { value = { ...DEFAULTS }; }
  return {
    get: () => ({ ...value }),
    update(input) {
      const next = normalizeSettings(input, value);
      writeJson(file, next);
      value = next;
      return this.get();
    }
  };
}

function assertLaunchSettingsMutable(input, previous, phase) {
  if (!['running', 'preparing', 'launching'].includes(phase)) return;
  if (input.port !== undefined && Number(input.port) !== previous.port) {
    throw new Error('代理端口将在 AG 退出后才能修改');
  }
  if (input.enableProxy !== undefined && input.enableProxy !== previous.enableProxy) {
    throw new Error('代理模式将在 AG 退出后才能修改');
  }
  if (input.targetApp !== undefined && input.targetApp !== previous.targetApp) {
    throw new Error('启动目标将在 AG 退出后才能修改');
  }
}

module.exports = { DEFAULTS, normalizeSettings, createSettings, assertLaunchSettingsMutable };
