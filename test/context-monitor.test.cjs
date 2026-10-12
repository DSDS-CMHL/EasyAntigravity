const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { ContextMonitor, summarizeMetadata, seconds } = require('../features/context-monitor');
const { LanguageService } = require('../adapters/desktop/language-service');
const { serverFromDiscovery, parseNetstat, parsePs, parseLsof } = require('../adapters/desktop/language-service-discovery');
const { CdpHub } = require('../adapters/desktop/cdp');
const { normalizeSettings, assertLaunchSettingsMutable } = require('../core/settings');
const { RiskAdvisor } = require('../features/risk-advisor');

const id = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const chat = (used = 40, max = 100, extra = {}) => ({ chatModel: { modelDisplayName: 'Example',
  usage: { messageId: 'a', outputTokens: '200', thinkingOutputTokens: '100' }, streamingDuration: '2s', timeToFirstToken: '0.5s',
  chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: used, maxContextTokens: max, tokenBreakdown: { body: 'private text' } } }, ...extra } });

test('context is the latest request estimate; zero, compaction and over-capacity are honest', () => {
  const result = summarizeMetadata([chat(90), chat(20)]);
  assert.equal(result.context.usedTokens, 20);
  assert.equal(result.context.usedFraction, .2);
  assert.equal(summarizeMetadata([chat(0)]).context.usedFraction, 0);
  assert.equal(summarizeMetadata([chat(120)]).context.usedFraction, 1.2);
  assert.equal(summarizeMetadata([chat(20, null)]).context.maxTokens, null);
  for (const invalid of [null, '', true, -1, Infinity, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(summarizeMetadata([chat(invalid)]).context, null);
  }
  assert.equal(summarizeMetadata([chat(), { chatModel: {} }]).context, null, 'Never reuse previous model capacity');
  assert.doesNotMatch(JSON.stringify(result), /private text|tokenBreakdown|usage/);
});

test('latest valid speed excludes thinking and TTFT, with explicit fallback and short-sample labels', () => {
  let result = summarizeMetadata([chat()]);
  assert.equal(result.speed.tokensPerSecond, 50);
  assert.equal(result.speed.ttftSeconds, .5);
  assert.equal(result.speed.basis, 'response');
  result = summarizeMetadata([chat(40, 100, { usage: { outputTokens: '100' }, streamingDuration: '.2s' })]);
  assert.equal(result.speed, null, 'Malformed durations are not guessed');
  result = summarizeMetadata([chat(40, 100, { usage: { outputTokens: '100' }, streamingDuration: '0.2s' })]);
  assert.equal(result.speed.tokensPerSecond, 500);
  assert.equal(result.speed.basis, 'all-output');
  assert.equal(result.speed.shortSample, true);
  for (const value of [undefined, null, {}, 'wrong', -1]) assert.equal(seconds(value), null);
  assert.equal(seconds({ seconds: '2', nanos: 500000000 }), 2.5);
  const a = chat();
  assert.equal(summarizeMetadata([a, chat(40, 100, { usage: { messageId: 'b', responseOutputTokens: 80 }, streamingDuration: '4s' }), a]).speed.tokensPerSecond, 20);
});

test('discovery requires exactly one current-user backend and a PID-owned HTTP port', () => {
  const rows = [{ pid: 9, command: 'language_server.exe --standalone --csrf_token=private', ports: new Set([4001]) }];
  const log = 'listening on random port at 4001 for HTTP\nlistening on random port at 9999 for HTTP\n';
  assert.deepEqual(serverFromDiscovery(log, rows), { pid: 9, port: 4001, csrf: 'private' });
  assert.throws(() => serverFromDiscovery(log, [...rows, ...rows]), /多个/);
  assert.throws(() => serverFromDiscovery('listening on random port at 9999 for HTTP\n', rows));
  assert.deepEqual([...parseNetstat(' TCP  [::]:4001 [::]:0 LISTENING 9\n TCP 127.0.0.1:12 0.0.0.0:0 ESTABLISHED 8').get(9)], [4001]);
  assert.equal(parsePs('9 100 /bin/language_server --standalone\n10 200 /bin/language_server --standalone', 100).length, 1);
  assert.deepEqual([...parseLsof('p9\nn[::1]:4001\n').get(9)], [4001]);
});

test('read-only RPC uses loopback credentials in headers and bounds allowed methods', async t => {
  const calls = [];
  const server = http.createServer((request, response) => {
    calls.push({ url: request.url, token: request.headers['x-codeium-csrf-token'] });
    response.end(JSON.stringify({ userStatus: { email: 'account@example.test' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new LanguageService({ profile: 'unused', processes: async () => [], readLog: async () => '' });
  client.server = { pid: 9, port: server.address().port, csrf: 'private' }; client.discoveredAt = Date.now();
  assert.equal((await client.call('GetUserStatus')).userStatus.email, 'account@example.test');
  assert.equal(calls[0].token, 'private');
  assert.match(calls[0].url, /LanguageServerService\/GetUserStatus$/);
  await assert.rejects(client.call('SetUserStatus'), /不支持/);
  client.reset(); assert.equal(client.server, null);
});

test('metadata pagination is complete, bounded and conversation-specific; no steps are returned', async () => {
  const client = new LanguageService();
  const calls = [];
  client.call = async (method, body) => {
    calls.push([method, body]);
    return method === 'GetCascadeTrajectory'
      ? { trajectory: { cascadeId: id, steps: ['private body'], generatorMetadata: [chat()] }, numTotalGeneratorMetadata: 2 }
      : { generatorMetadata: [chat(20)] };
  };
  assert.equal((await client.metadata(id)).length, 2);
  assert.deepEqual(calls[1][1], { cascadeId: id, generatorMetadataOffset: 1 });
  await assert.rejects(client.metadata(otherId), /不匹配/);
  client.call = async method => method === 'GetCascadeTrajectory'
    ? { trajectory: { cascadeId: id, generatorMetadata: [] }, numTotalGeneratorMetadata: 2 } : { generatorMetadata: [] };
  await assert.rejects(client.metadata(id), /分页/);
});

function mockClient() {
  const server = { pid: 9, port: 4001, csrf: 'secret' };
  return { discover: async () => server, call: async () => ({ userStatus: { email: 'account@example.test' } }),
    metadata: async () => [chat()], reset() {} };
}

test('monitor merges concurrent requests and sends only statistics, never identity or credentials', async () => {
  const client = mockClient(), monitor = new ContextMonitor(client);
  let count = 0;
  client.metadata = async () => { count++; return [chat()]; };
  const a = monitor.sample(id), b = monitor.sample(id);
  assert.equal(a, b);
  const result = await a;
  assert.equal(count, 1); assert.equal(result.state, 'live');
  assert.doesNotMatch(JSON.stringify(result), /account@|secret|private text|tokenBreakdown/);
});

test('account switches, backend restarts, missing identity and reset reject old statistics', async () => {
  for (const change of ['account', 'backend', 'missing', 'reset']) {
    const client = mockClient(), monitor = new ContextMonitor(client);
    let calls = 0;
    client.call = async () => ({ userStatus: { email: change === 'missing' ? null : ++calls > 1 && change === 'account' ? 'new@example.test' : 'old@example.test' } });
    if (change === 'backend') { let discovers = 0; client.discover = async () => ({ pid: ++discovers, port: 4001, csrf: 'secret' }); }
    if (change === 'reset') client.metadata = async () => { monitor.reset(); return [chat()]; };
    const result = await monitor.sample(id);
    assert.equal(result.state, 'unavailable', change);
    assert.equal(result.context, null);
  }
});

test('context monitoring remains optional and independent of mode; can be toggled while running', () => {
  assert.equal(normalizeSettings({ launchMode: 'compatibility' }).enableContextMonitor, true);
  assert.equal(normalizeSettings({ enableContextMonitor: false }).enableContextMonitor, false);
  assert.throws(() => normalizeSettings({ enableContextMonitor: 'false' }));
  assert.doesNotThrow(() => assertLaunchSettingsMutable({ enableContextMonitor: false }, normalizeSettings(), 'running'));
});

test('CDP statistics reject remote origins, wrong conversations, iframe contexts and stale reinjections', async () => {
  const outputs = [];
  let href = `http://127.0.0.1:4000/c/${id}`, reads = 0, resolve;
  const hub = new CdpHub({ source: () => '', onMetrics: async () => { reads++; return { conversationId: id, state: 'live' }; } });
  hub.running = true;
  const connection = { url: 'ws://127.0.0.1:9333/page', pageUrl: href, contexts: new Set([7]), injectGeneration: 1,
    command: async (_, params) => params.expression === 'location.href' ? { result: { value: href } } : outputs.push(params) };
  const event = { conversationId: id, requestId: '1' };
  await hub.metrics(connection, 7, event); assert.equal(reads, 1); assert.equal(outputs.length, 1);
  for (const location of ['https://external.example/c/' + id, 'http://127.0.0.1:4001/c/' + id, 'http://127.0.0.1:4000/c/' + otherId]) {
    href = location; connection.metricsAt = 0; await hub.metrics(connection, 7, event);
  }
  href = connection.pageUrl; connection.metricsAt = 0; await hub.metrics(connection, 8, event);
  assert.equal(reads, 1);
  hub.onMetrics = () => new Promise(done => { resolve = done; });
  connection.metricsAt = 0;
  const pending = hub.metrics(connection, 7, event);
  await new Promise(done => setImmediate(done));
  connection.injectGeneration++; resolve({ conversationId: id }); await pending;
  assert.equal(outputs.length, 1);
});

test('ARES exposes deduplicated session counts from actual observations, without parsing logs', () => {
  let enabled = true;
  const published = [];
  const advisor = new RiskAdvisor({ enabled: () => enabled,
    rules: { assess: command => command === 'safe' ? null : { level: command, levelLabel: command, primary: { name: command } } },
    events: { log() {}, publish: value => published.push(value) }, notifications: { show() {} } });
  advisor.reset();
  advisor.observe('high', { invocationId: 'one' }); advisor.observe('high', { invocationId: 'one' });
  advisor.observe('medium', { invocationId: 'two' }); advisor.observe('low', { invocationId: 'three' });
  advisor.observe('safe', { invocationId: 'four' });
  assert.deepEqual(advisor.snapshot().counts, { high: 1, medium: 1, low: 1 });
  assert.equal(advisor.snapshot().total, 3); assert.equal(advisor.snapshot().highestLevel, 'high');
  assert.equal(advisor.snapshot().latestLevel, 'low', 'Safe commands do not replace the latest risk');
  advisor.observe('high', { invocationId: 'one' });
  assert.equal(advisor.snapshot().latestLevel, 'low', 'A repeated old invocation does not replace the latest risk');
  assert.equal(published.at(-1).riskSummary.total, 3);
  const snapshot = advisor.snapshot(); snapshot.counts.high = 100;
  assert.equal(advisor.snapshot().counts.high, 1, 'Snapshot is not mutable internal state');
  enabled = false; advisor.observe('high', { invocationId: 'five' }); assert.equal(advisor.hits, 3);
  enabled = true; advisor.reset(); assert.equal(advisor.snapshot().session, 2); assert.equal(advisor.hits, 0);
  assert.equal(advisor.snapshot().latestLevel, null);
  advisor.observe('high', { invocationId: 'one' }); assert.equal(advisor.hits, 1, 'A new session has its own deduplication scope');
});

test('risk statistics are delivered while a context RPC is pending, with the same frame/origin guards', async () => {
  const outputs = [];
  let finishContext, reads = 0;
  const href = `http://127.0.0.1:4000/c/${id}`;
  const hub = new CdpHub({ source: () => '', onMetrics: () => new Promise(done => { finishContext = done; }),
    onRiskStats: () => { reads++; return { total: 3, counts: { high: 1, medium: 1, low: 1 } }; } });
  hub.running = true;
  const connection = { url: 'ws://127.0.0.1:9333/page', pageUrl: href, contexts: new Set([7]), injectGeneration: 1,
    command: async (_, params) => params.expression === 'location.href' ? { result: { value: href } } : outputs.push(params) };
  const pending = hub.metrics(connection, 7, { type: 'context-metrics', conversationId: id, requestId: '1' });
  await new Promise(done => setImmediate(done));
  await hub.metrics(connection, 7, { type: 'risk-stats', conversationId: id, requestId: '2' });
  assert.equal(reads, 1); assert.match(outputs[0].expression, /receiveRisk/);
  connection.riskStatsAt = 0;
  await hub.metrics(connection, 8, { type: 'risk-stats', conversationId: id, requestId: '3' });
  assert.equal(reads, 1, 'Iframe context cannot retrieve even aggregate counters');
  finishContext({ conversationId: id }); await pending;
});
