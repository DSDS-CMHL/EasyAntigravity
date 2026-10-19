const { readJson, writeJson } = require('./storage');

const DEFAULTS = Object.freeze({ port: 7890, enableI18n: true, enableContextMonitor: true });

function normalizeSettings(input = {}, previous = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象');
  const result = { ...DEFAULTS, ...previous };
  if (input.port !== undefined) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理端口必须是 1–65535 的整数');
    result.port = port;
  }
  for (const key of ['enableI18n', 'enableContextMonitor']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      result[key] = input[key];
    }
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
}

module.exports = { DEFAULTS, normalizeSettings, createSettings, assertLaunchSettingsMutable };
