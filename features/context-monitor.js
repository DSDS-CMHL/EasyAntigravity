const { createHash } = require('node:crypto');
const { GUID } = require('../adapters/desktop/language-service');

function tokenCount(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function seconds(value) {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?s$/.test(value)) value = Number(value.slice(0, -1));
  if (value && typeof value === 'object') {
    const whole = tokenCount(value.seconds ?? 0), nanos = tokenCount(value.nanos ?? 0);
    value = whole !== null && nanos !== null && nanos < 1e9 && ('seconds' in value || 'nanos' in value) ? whole + nanos / 1e9 : null;
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function summarizeMetadata(generators) {
  const latestChat = generators.findLast(item => item?.chatModel)?.chatModel;
  const rawContext = latestChat?.chatStartMetadata?.contextWindowMetadata;
  const used = tokenCount(rawContext?.estimatedTokensUsed), capacity = tokenCount(rawContext?.maxContextTokens);
  const max = capacity > 0 ? capacity : null;
  const model = typeof latestChat?.modelDisplayName === 'string' ? latestChat.modelDisplayName.slice(0, 100) : null;
  const context = used === null ? null : { usedTokens: used, maxTokens: max, usedFraction: max ? used / max : null, model };
  const seen = new Set();
  let speed = null;
  for (const [index, item] of generators.entries()) {
    const chat = item?.chatModel, usage = chat?.usage;
    if (!usage) continue;
    const id = usage.messageId || item.executionId || index;
    if (seen.has(id)) continue;
    seen.add(id);
    const visible = tokenCount(usage.responseOutputTokens), output = tokenCount(usage.outputTokens), thinking = tokenCount(usage.thinkingOutputTokens);
    const tokens = visible ?? (output !== null && thinking !== null ? Math.max(0, output - thinking) : output);
    const duration = seconds(chat.streamingDuration);
    if (tokens === null || !(duration > 0)) continue;
    speed = { tokensPerSecond: tokens / duration, ttftSeconds: seconds(chat.timeToFirstToken),
      basis: visible !== null || (output !== null && thinking !== null) ? 'response' : 'all-output',
      shortSample: duration < 1, model: typeof chat.modelDisplayName === 'string' ? chat.modelDisplayName.slice(0, 100) : null };
    if (!Number.isFinite(speed.tokensPerSecond)) speed = null;
  }
  return { context, speed };
}

function accountScope(status) {
  const email = status?.userStatus?.email;
  if (typeof email !== 'string' || !email.trim()) throw new Error('暂无法确认当前账号');
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

class ContextMonitor {
  constructor(client) {
    this.client = client;
    this.generation = 0;
    this.pending = new Map();
  }

  sample(id) {
    if (!GUID.test(id)) return Promise.resolve({ conversationId: id, state: 'unavailable' });
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 4) return Promise.resolve({ conversationId: id, state: 'unavailable' });
    const generation = this.generation;
    const task = this.collect(id, generation);
    this.pending.set(id, task);
    task.finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); });
    return task;
  }

  async collect(id, generation) {
    const signal = AbortSignal.timeout(20000);
    try {
      // Verify the same account and backend both before and after collecting.
      const server = await this.client.discover();
      const identity = accountScope(await this.client.call('GetUserStatus', {}, signal));
      const metadata = await this.client.metadata(id, signal);
      const result = summarizeMetadata(metadata);
      const currentIdentity = accountScope(await this.client.call('GetUserStatus', {}, signal));
      const currentServer = await this.client.discover();
      if (generation !== this.generation || identity !== currentIdentity || server.pid !== currentServer.pid
        || server.csrf !== currentServer.csrf || server.port !== currentServer.port) throw new Error('采集作用域已改变');
      return { conversationId: id, state: 'live', sampledAt: Date.now(), ...result };
    } catch {
      // No raw backend error, command line, credentials or message text crosses the bridge.
      return { conversationId: id, state: 'unavailable', context: null, speed: null };
    }
  }

  reset() {
    this.generation++;
    this.pending.clear();
    this.client.reset();
  }
}

module.exports = { ContextMonitor, summarizeMetadata, tokenCount, seconds };
