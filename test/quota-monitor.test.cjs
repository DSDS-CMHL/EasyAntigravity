const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QuotaMonitor,
  fraction,
  parseQuotaSummary,
  parseLegacyStatus
} = require('../features/quota-monitor');

const reset = '2030-01-02T03:04:05Z';

test('quota fractions distinguish unknown values from a real zero', () => {
  assert.equal(fraction(0), 0);
  assert.equal(fraction('0'), 0);
  assert.equal(fraction(.7), .7);
  assert.equal(fraction('0.7'), .7);
  for (const value of [null, undefined, '', ' ', true, {}, -0.1, 1.1, Infinity]) {
    assert.equal(fraction(value), null, `unexpected fraction for ${String(value)}`);
  }
});

test('quota summary normalizes nested groups, windows, model keys and oneof remaining values', () => {
  const parsed = parseQuotaSummary({
    response: {
      groups: [
        {
          id: 'gemini-models',
          displayName: 'Gemini Models',
          modelKeys: ['Gemini 4 Argon'],
          buckets: [
            { bucketId: 'weekly', displayName: 'Weekly limit', remainingFraction: 0 },
            { bucketId: '5h', displayName: '5h limit', remaining: { remainingFraction: '0.7' }, resetTime: reset }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          quotaBuckets: [{
            id: 'five-hour',
            displayName: '5 hour limit',
            remaining: { case: 'remainingFraction', value: .42 }
          }]
        },
        {
          displayName: 'Disabled model',
          windows: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: .9, disabled: true }]
        }
      ]
    }
  });
  assert.equal(parsed.state, 'live');
  assert.equal(parsed.source, 'summary');
  assert.equal(parsed.groups.length, 3);
  assert.deepEqual(parsed.groups[0].modelKeys, ['Gemini 4 Argon']);
  assert.equal(parsed.groups[0].family, 'gemini');
  assert.equal(parsed.groups[0].buckets[0].remainingFraction, 0);
  assert.equal(parsed.groups[0].buckets[0].window, 'weekly');
  assert.equal(parsed.groups[0].buckets[1].remainingFraction, .7);
  assert.equal(parsed.groups[0].buckets[1].window, '5h');
  assert.equal(parsed.groups[0].buckets[1].resetAt, new Date(reset).toISOString());
  assert.equal(parsed.groups[1].family, 'claude-gpt');
  assert.equal(parsed.groups[1].buckets[0].remainingFraction, .42);
  assert.equal(parsed.groups[1].buckets[0].window, '5h');
  assert.equal(parsed.groups[2].buckets[0].disabled, true);
});

test('legacy user status supplies model-level fallback quotas', () => {
  const parsed = parseLegacyStatus({
    userStatus: {
      cascadeModelConfigData: {
        clientModelConfigs: [
          {
            label: 'Gemini 4 Argon',
            modelOrAlias: { model: 'gemini-4-argon' },
            quotaInfo: { remainingFraction: 0, resetTime: reset }
          },
          {
            label: 'Unknown without quota',
            quotaInfo: {}
          }
        ]
      }
    }
  });
  assert.equal(parsed.source, 'legacy-status');
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].displayName, 'Gemini 4 Argon');
  assert.deepEqual(parsed.groups[0].modelKeys, ['gemini-4-argon']);
  assert.equal(parsed.groups[0].buckets[0].remainingFraction, 0);
  assert.equal(parsed.groups[0].buckets[0].resetAt, new Date(reset).toISOString());
});

test('quota monitor falls back after summary failure, merges requests, caches and resets', async () => {
  const calls = [];
  const client = {
    call: async method => {
      calls.push(method);
      if (method === 'RetrieveUserQuotaSummary') throw new Error('endpoint unavailable');
      return {
        userStatus: {
          cascadeModelConfigData: {
            clientModelConfigs: [{
              label: 'Claude 4',
              modelOrAlias: { model: 'claude-4' },
              quotaInfo: { remainingFraction: .55 }
            }]
          }
        }
      };
    }
  };
  const monitor = new QuotaMonitor(client, { cacheMs: 60000 });
  const first = monitor.sample();
  assert.equal(first, monitor.sample(), 'concurrent quota reads should share one request');
  const snapshot = await first;
  assert.equal(snapshot.source, 'legacy-status');
  assert.deepEqual(calls, ['RetrieveUserQuotaSummary', 'GetUserStatus']);
  await monitor.sample();
  assert.deepEqual(calls, ['RetrieveUserQuotaSummary', 'GetUserStatus'], 'live fallback result is cached');
  monitor.reset();
  await monitor.sample();
  assert.deepEqual(calls, [
    'RetrieveUserQuotaSummary', 'GetUserStatus',
    'RetrieveUserQuotaSummary', 'GetUserStatus'
  ]);
});

test('quota monitor reports unavailable data and refreshes it on the shorter TTL', async () => {
  let calls = 0;
  const client = { call: async () => { calls++; throw new Error('offline'); } };
  const monitor = new QuotaMonitor(client, { cacheMs: 60000, unavailableCacheMs: 0 });
  const snapshot = await monitor.sample();
  assert.deepEqual(snapshot, { state: 'unavailable', source: null, groups: [] });
  await new Promise(resolve => setImmediate(resolve));
  await monitor.sample();
  assert.equal(calls, 4, 'each unavailable sample tries summary and legacy status');
});

test('quota monitor can force a refresh before the normal cache expires', async () => {
  let calls = 0;
  const client = {
    call: async method => {
      calls++;
      if (method === 'RetrieveUserQuotaSummary') {
        return {
          groups: [{
            displayName: 'Gemini Models',
            buckets: [{ displayName: 'Weekly limit', remainingFraction: .8 }]
          }]
        };
      }
      throw new Error('unexpected fallback');
    }
  };
  const monitor = new QuotaMonitor(client, { cacheMs: 60000 });
  await monitor.sample();
  await monitor.sample();
  assert.equal(calls, 1);
  await monitor.sample(true);
  assert.equal(calls, 2);
});
