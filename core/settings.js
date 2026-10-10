const { readJson, writeJson } = require('./storage');

const DEFAULTS = Object.freeze({ port: 7890, launchMode: 'pilot', riskAdvisor: true, enableI18n: true });

function normalizeSettings(input = {}, previous = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象');
  const result = { ...previous };
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
  for (const key of ['riskAdvisor', 'enableI18n']) {
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

module.exports = { DEFAULTS, normalizeSettings, createSettings };
