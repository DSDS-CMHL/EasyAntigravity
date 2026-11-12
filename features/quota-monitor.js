const SESSION_WINDOW = /(?:\b5\s*[- ]?(?:h|hours?)\b|\bfive\s*[- ]?hours?\b|\bsession\b|\b300\b)/i;
const WEEKLY_WINDOW = /(?:\bweekly\b|\bweek\b|\b7\s*d\b|\b10080\b)/i;

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fraction(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function resetAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function windowKind(bucket) {
  const value = [bucket?.bucketId, bucket?.id, bucket?.displayName, bucket?.name, bucket?.window]
    .map(text).filter(Boolean).join(' ');
  if (SESSION_WINDOW.test(value)) return '5h';
  if (WEEKLY_WINDOW.test(value)) return 'weekly';
  return null;
}

function familyForModel(value) {
  const model = text(value)?.toLowerCase() || '';
  if (model.includes('gemini')) return 'gemini';
  if (model.includes('claude') || model.includes('gpt')) return 'claude-gpt';
  return null;
}

function familyForGroup(value) {
  const group = text(value)?.toLowerCase() || '';
  if (group.includes('gemini')) return 'gemini';
  if ((group.includes('claude') && group.includes('gpt')) || group.includes('third-party') || group.includes('3p')) {
    return 'claude-gpt';
  }
  return null;
}

function remainingValue(bucket) {
  const remaining = bucket?.remaining;
  if (remaining && typeof remaining === 'object' && remaining.case === 'remainingFraction') {
    return fraction(remaining.value);
  }
  return fraction(bucket?.remainingFraction ?? remaining?.remainingFraction);
}

function normalizeBucket(bucket, index) {
  if (!bucket || typeof bucket !== 'object') return null;
  const id = text(bucket.bucketId ?? bucket.id) || `bucket-${index}`;
  const displayName = text(bucket.displayName ?? bucket.name) || id;
  return {
    id,
    displayName,
    remainingFraction: remainingValue(bucket),
    resetAt: resetAt(bucket.resetTime ?? bucket.resetAt),
    resetDescription: text(bucket.description ?? bucket.resetDescription),
    disabled: bucket.disabled === true,
    window: windowKind(bucket)
  };
}

function normalizeGroup(group, index) {
  if (!group || typeof group !== 'object') return null;
  const displayName = text(group.displayName ?? group.name) || 'Quota';
  const rawBuckets = group.buckets ?? group.quotaBuckets ?? group.windows ?? group.limits;
  const buckets = Array.isArray(rawBuckets)
    ? rawBuckets.map(normalizeBucket).filter(Boolean)
    : [];
  if (!buckets.length) return null;
  const modelKeys = [
    ...(Array.isArray(group.modelKeys) ? group.modelKeys : []),
    ...(Array.isArray(group.models) ? group.models : []),
    ...(Array.isArray(group.modelAliases) ? group.modelAliases : [])
  ].map(text).filter(Boolean);
  return {
    id: text(group.id) || `group-${index}-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    displayName,
    family: familyForGroup(displayName),
    modelKeys,
    buckets
  };
}

function quotaPayload(response) {
  if (!response || typeof response !== 'object') return null;
  if (response.response && typeof response.response === 'object') return response.response;
  if (response.summary && typeof response.summary === 'object') return response.summary;
  return response;
}

function parseQuotaSummary(response) {
  const payload = quotaPayload(response);
  const groups = Array.isArray(payload?.groups)
    ? payload.groups.map(normalizeGroup).filter(Boolean)
    : [];
  return groups.length ? { state: 'live', source: 'summary', groups } : null;
}

function parseLegacyStatus(response) {
  const configs = response?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
  if (!Array.isArray(configs)) return null;
  const groups = configs.map((config, index) => {
    const displayName = text(config?.label) || text(config?.modelOrAlias?.model);
    const quota = config?.quotaInfo;
    const remainingFraction = fraction(quota?.remainingFraction);
    if (!displayName || (remainingFraction === null && !resetAt(quota?.resetTime))) return null;
    return {
      id: `model-${index}-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      displayName,
      family: familyForModel(displayName),
      modelKeys: [text(config?.modelOrAlias?.model)].filter(Boolean),
      buckets: [{
        id: `model-${index}`,
        displayName: 'Model quota',
        remainingFraction,
        resetAt: resetAt(quota?.resetTime),
        resetDescription: null,
        disabled: false,
        window: null
      }]
    };
  }).filter(Boolean);
  return groups.length ? { state: 'live', source: 'legacy-status', groups } : null;
}

class QuotaMonitor {
  constructor(client, { cacheMs = 60000, unavailableCacheMs = 10000 } = {}) {
    this.client = client;
    this.cacheMs = cacheMs;
    this.unavailableCacheMs = unavailableCacheMs;
    this.generation = 0;
    this.pending = null;
    this.snapshot = null;
    this.sampledAt = 0;
  }

  sample(force = false) {
    const now = Date.now();
    const age = now - this.sampledAt;
    const ttl = this.snapshot?.state === 'live' ? this.cacheMs : this.unavailableCacheMs;
    if (this.pending) return this.pending;
    if (!force && this.snapshot && age >= 0 && age < ttl) return Promise.resolve(this.snapshot);
    const generation = this.generation;
    const task = this.collect(generation);
    this.pending = task;
    task.then(snapshot => {
      if (generation !== this.generation) return;
      this.snapshot = snapshot;
      this.sampledAt = Date.now();
    }).finally(() => {
      if (this.pending === task) this.pending = null;
    });
    return task;
  }

  async collect(generation) {
    const callWithTimeout = method => this.client.call(method, {}, AbortSignal.timeout(8000));
    try {
      const summary = await callWithTimeout('RetrieveUserQuotaSummary');
      const parsed = parseQuotaSummary(summary);
      if (parsed && generation === this.generation) return parsed;
    } catch { /* Older AG/IDE builds may not expose the summary endpoint. */ }
    try {
      const status = await callWithTimeout('GetUserStatus');
      const parsed = parseLegacyStatus(status);
      if (parsed && generation === this.generation) return parsed;
    } catch { /* Quota is optional and must not interrupt the context ring. */ }
    return { state: 'unavailable', source: null, groups: [] };
  }

  reset() {
    this.generation++;
    this.pending = null;
    this.snapshot = null;
    this.sampledAt = 0;
  }
}

module.exports = {
  QuotaMonitor,
  fraction,
  familyForModel,
  familyForGroup,
  normalizeBucket,
  parseQuotaSummary,
  parseLegacyStatus
};
