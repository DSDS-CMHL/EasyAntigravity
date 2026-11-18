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

function resolveModelName(chat, modelMap) {
  if (!chat || typeof chat !== 'object') return null;
  for (const direct of [chat.modelDisplayName, chat.modelName, chat.usage?.modelDisplayName, chat.usage?.modelName, chat.chatStartMetadata?.modelDisplayName]) {
    if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 100);
  }
  for (const raw of [chat.model, chat.usage?.model, chat.chatStartMetadata?.model, chat.modelOrAlias?.model, chat.modelOrAlias?.alias]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const key = raw.trim();
    if (modelMap instanceof Map && modelMap.has(key)) return modelMap.get(key).slice(0, 100);
    if (!/^MODEL_PLACEHOLDER_/i.test(key)) return key.replace(/^MODEL_/i, '').slice(0, 100);
  }
  return null;
}

// Extract underlying endpoint/response model string (Protobuf GeneratorMetadata field 1.19: response_model).
function resolveEndpointModel(item) {
  const chat = item?.chatModel;
  if (!chat || typeof chat !== 'object') return null;
  const directFields = [
    chat.responseModel,
    chat.response_model,
    chat.usage?.responseModel,
    chat.usage?.response_model,
    chat.chatStartMetadata?.responseModel,
    chat.chatStartMetadata?.response_model,
    chat.servedModel,
    chat.served_model,
    chat.modelEndpoint,
    chat.endpointModel,
    chat.actualModel,
    chat.backendModel,
    chat.modelId,
    item?.responseModel,
    item?.response_model
  ];
  for (const candidate of directFields) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!value || value.length > 100 || /[\x00-\x1f\x7f<>]/.test(value)) continue;
    if (/^MODEL_PLACEHOLDER_/i.test(value)) continue;
    return value;
  }
  for (const raw of [chat.usage?.model, chat.model, chat.chatStartMetadata?.model, chat.modelOrAlias?.model]) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value || value.length > 100 || /^MODEL_/i.test(value)) continue;
    if (/^[a-z0-9][a-z0-9._:/-]{2,99}$/i.test(value) && /[a-z]/i.test(value) && /[-/:]/.test(value)) {
      return value;
    }
  }
  return null;
}

function extractModelMap(status) {
  const map = new Map();
  const configs = status?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
  if (Array.isArray(configs)) {
    for (const item of configs) {
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : null;
      if (!label) continue;
      for (const k of [item.modelOrAlias?.model, item.modelOrAlias?.alias, item.model]) {
        if (typeof k === 'string' && k.trim()) map.set(k.trim(), label);
      }
    }
  }
  return map;
}

function summarizeMetadata(generators, modelMap) {
  const latestItem = generators.findLast(item => item?.chatModel);
  const latestChat = latestItem?.chatModel;
  const rawContext = latestChat?.chatStartMetadata?.contextWindowMetadata;
  const used = tokenCount(rawContext?.estimatedTokensUsed), capacity = tokenCount(rawContext?.maxContextTokens);
  const max = capacity > 0 ? capacity : null;
  const fallbackModel = resolveModelName(latestChat, modelMap)
    || resolveModelName(generators.findLast(item => resolveModelName(item?.chatModel, modelMap))?.chatModel, modelMap);
  const model = fallbackModel;
  const endpointModel = resolveEndpointModel(latestItem);
  const context = used === null ? null : { usedTokens: used, maxTokens: max, usedFraction: max ? used / max : null, model, endpointModel };
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
      shortSample: duration < 1, model: resolveModelName(chat, modelMap) || fallbackModel,
      endpointModel: resolveEndpointModel(item) };
    if (!Number.isFinite(speed.tokensPerSecond)) speed = null;
  }
  return { context, speed };
}

function accountScope(status) {
  const email = status?.userStatus?.email;
  if (typeof email !== 'string' || !email.trim()) throw new Error('暂无法确认当前账号');
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function slimGeneratorItem(item) {
  if (!item || typeof item !== 'object') return {};
  const chat = item.chatModel;
  if (!chat || typeof chat !== 'object') {
    return { executionId: item.executionId, responseModel: item.responseModel, response_model: item.response_model };
  }
  const usage = chat.usage && typeof chat.usage === 'object' ? {
    messageId: chat.usage.messageId,
    responseOutputTokens: chat.usage.responseOutputTokens,
    outputTokens: chat.usage.outputTokens,
    thinkingOutputTokens: chat.usage.thinkingOutputTokens,
    modelDisplayName: chat.usage.modelDisplayName,
    modelName: chat.usage.modelName,
    model: chat.usage.model,
    responseModel: chat.usage.responseModel,
    response_model: chat.usage.response_model
  } : undefined;
  const rawCtx = chat.chatStartMetadata?.contextWindowMetadata;
  const chatStartMetadata = chat.chatStartMetadata && typeof chat.chatStartMetadata === 'object' ? {
    modelDisplayName: chat.chatStartMetadata.modelDisplayName,
    model: chat.chatStartMetadata.model,
    responseModel: chat.chatStartMetadata.responseModel,
    response_model: chat.chatStartMetadata.response_model,
    contextWindowMetadata: rawCtx && typeof rawCtx === 'object' ? {
      estimatedTokensUsed: rawCtx.estimatedTokensUsed,
      maxContextTokens: rawCtx.maxContextTokens
    } : undefined
  } : undefined;
  const alias = chat.modelOrAlias && typeof chat.modelOrAlias === 'object' ? {
    model: chat.modelOrAlias.model,
    alias: chat.modelOrAlias.alias
  } : undefined;
  return {
    executionId: item.executionId,
    responseModel: item.responseModel,
    response_model: item.response_model,
    chatModel: {
      modelDisplayName: chat.modelDisplayName,
      modelName: chat.modelName,
      model: chat.model,
      modelOrAlias: alias,
      responseModel: chat.responseModel,
      response_model: chat.response_model,
      servedModel: chat.servedModel,
      served_model: chat.served_model,
      modelEndpoint: chat.modelEndpoint,
      endpointModel: chat.endpointModel,
      actualModel: chat.actualModel,
      backendModel: chat.backendModel,
      modelId: chat.modelId,
      streamingDuration: chat.streamingDuration,
      timeToFirstToken: chat.timeToFirstToken,
      usage,
      chatStartMetadata
    }
  };
}

const MAX_CACHED_CONVERSATIONS = 8;

class ContextMonitor {
  constructor(client) {
    this.client = client;
    this.generation = 0;
    this.pending = new Map();
    this.cache = new Map();
    this.cacheScope = '';
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
      const firstStatus = await this.client.call('GetUserStatus', {}, signal);
      const identity = accountScope(firstStatus);
      const scope = `${server.pid}:${server.port}:${server.csrf}:${identity}`;
      if (this.cacheScope !== scope) {
        this.cache.clear();
        this.cacheScope = scope;
      }
      const key = id.toLowerCase();
      let items;
      const record = this.client.supportsIncrementalMetadata ? this.cache.get(key) : null;
      // Periodically resync to detect replacement/compaction with unchanged counts.
      const cached = record && Date.now() - record.syncedAt < 60000 ? record.items : null;
      if (cached) {
        // The last generator can still be streaming: replace its refreshed tail.
        const offset = Math.max(0, cached.length - 1);
        const delta = await this.client.metadata(id, signal, { offset });
        if (Array.isArray(delta)) {
          items = delta.map(slimGeneratorItem);
        } else if (delta?.truncated) {
          this.cache.delete(key);
          items = (await this.client.metadata(id, signal)).map(slimGeneratorItem);
        } else {
          const appended = (delta?.items || []).map(slimGeneratorItem);
          if (offset + appended.length > 10000) throw new Error('统计样本范围不支持');
          items = [...cached.slice(0, offset), ...appended];
        }
      } else {
        items = (await this.client.metadata(id, signal)).map(slimGeneratorItem);
      }
      const result = summarizeMetadata(items, extractModelMap(firstStatus));
      const currentIdentity = accountScope(await this.client.call('GetUserStatus', {}, signal));
      const currentServer = await this.client.discover();
      if (generation !== this.generation || identity !== currentIdentity || server.pid !== currentServer.pid
        || server.csrf !== currentServer.csrf || server.port !== currentServer.port) throw new Error('采集作用域已改变');
      if (this.client.supportsIncrementalMetadata && this.cacheScope === scope) {
        this.cache.delete(key);
        this.cache.set(key, { items, syncedAt: cached ? record.syncedAt : Date.now() });
        while (this.cache.size > MAX_CACHED_CONVERSATIONS) {
          this.cache.delete(this.cache.keys().next().value);
        }
      }
      return { conversationId: id, state: 'live', sampledAt: Date.now(), ...result };
    } catch {
      // No raw backend error, command line, credentials or message text crosses the bridge.
      return { conversationId: id, state: 'unavailable', context: null, speed: null };
    }
  }

  reset() {
    this.generation++;
    this.pending.clear();
    this.cache.clear();
    this.cacheScope = '';
    this.client.reset();
  }
}

module.exports = { ContextMonitor, summarizeMetadata, resolveEndpointModel, tokenCount, seconds };
