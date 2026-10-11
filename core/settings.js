const { readJson, writeJson } = require('./storage');
const { validateProtectionLevel } = require('../features/protection');

const DEFAULTS = Object.freeze({ port: 7890, launchMode: 'pilot', protectionLevel: 'standard', riskAdvisor: true, enableI18n: true, enableContextMonitor: true });

function normalizeSettings(input = {}, previous = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象');
  const result = { ...DEFAULTS, ...previous };
  if (input.protectionLevel !== undefined) result.protectionLevel = validateProtectionLevel(input.protectionLevel);
  if (input.port !== undefined) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理端口必须是 1–65535 的整数');
    result.port = port;
  }
  if (input.launchMode !== undefined) {
    if (!['pilot', 'compatibility'].includes(input.launchMode)) throw new Error('无效的启动模式');
    result.launchMode = input.launchMode;
  } else if (typeof input.blockDangerous === 'boolean') {
    result.launchMode = input.blockDangerous ? 'pilot' : 'compatibility';
  }
  for (const key of ['riskAdvisor', 'enableI18n', 'enableContextMonitor']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      result[key] = input[key];
    }
  }
  // ARES is part of Pilot, not an independently switchable preference.
  result.riskAdvisor = result.launchMode === 'pilot';
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
  if ((input.launchMode !== undefined && input.launchMode !== previous.launchMode)
    || (input.port !== undefined && Number(input.port) !== previous.port)
    || (input.protectionLevel !== undefined && input.protectionLevel !== previous.protectionLevel)
    || (input.blockDangerous !== undefined && input.blockDangerous !== (previous.launchMode === 'pilot'))) {
    throw new Error('启动模式、防护强度和代理端口将在 AG 退出后才能修改');
  }
}

module.exports = { DEFAULTS, normalizeSettings, createSettings, assertLaunchSettingsMutable };
