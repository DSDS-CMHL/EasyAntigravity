const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const vm = require('node:vm');
const { currentConversationId } = require('../features/conversation-context');
const { parseIdePs, discoverProcesses } = require('../adapters/desktop/language-service-discovery');
const { LanguageService } = require('../adapters/desktop/language-service');
const { CdpHub } = require('../adapters/desktop/cdp');
const { rendererSource } = require('../adapters/desktop/renderer');
const id = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';

function composer() {
  const location = new URL('vscode-file://vscode-app/D:/Antigravity%20IDE/resources/app/out/vs/code/electron-browser/workbench/workbench.html');
  const root = {};
  const box = { isConnected: true, getClientRects: () => [1],
    closest: selector => selector === '.antigravity-agent-side-panel' ? root : null,
    querySelector: () => ({}) };
  const props = { cascadeId: id };
  const owner = { props };
  const vnode = { __e: box, __: owner };
  // A history ID elsewhere must never be selected as the active conversation.
  root.__k = { __k: [{ props: { cascadeId: otherId } }, vnode] };
  return { root, props, box, vnode,
    win: { location, getComputedStyle: () => ({ visibility: 'visible' }) },
    doc: { querySelectorAll: () => [box] } };
}

test('IDE reads the active input owner, handles same-URL switches and refuses empty or ambiguous composers', () => {
  const f = composer();
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), id);
  f.props.cascadeId = otherId;
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), otherId);
  f.props.cascadeId = undefined;
  f.vnode.__.__ = { props: { cascadeId: id } };
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), null);
  f.props.cascadeId = id;
  f.doc.querySelectorAll = () => [f.box, { ...f.box }];
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), null);
  f.doc.querySelectorAll = () => [f.box];
  f.win.location = new URL('https://unrelated.example/workbench.html');
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), null);
});

test('IDE unknown internals and bounded traversal fail closed; desktop routes stay independent', () => {
  const f = composer();
  delete f.root.__k;
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), null);
  f.root.__k = { __k: Array.from({ length: 5001 }, () => ({})) };
  assert.equal(currentConversationId(f.win, f.doc, 'ide'), null);
  assert.equal(currentConversationId({ location: { pathname: '/c/' + id } }, {}), id);
});

test('IDE process discovery excludes LSP, other users and other parent processes', async () => {
  const command = '/app/language_server_macos_arm --subclient_type ide --csrf_token secret';
  const rows = parseIdePs(`8 501 4 ${command}\n9 501 4 ${command} --enable_lsp\n10 502 4 ${command}\n11 501 5 ${command}`, 501, 4);
  assert.deepEqual(rows.map(row => row.pid), [8]);
  const calls = [];
  const execute = async (file, args) => {
    calls.push([file, args]);
    if (file === 'powershell.exe') return { stdout: JSON.stringify([
      { ProcessId: 8, ParentProcessId: 4, CommandLine: command },
      { ProcessId: 9, ParentProcessId: 4, CommandLine: command + ' --enable_lsp' },
      { ProcessId: 11, ParentProcessId: 5, CommandLine: command }
    ]) };
    return { stdout: '  TCP 127.0.0.1:8080 0.0.0.0:0 LISTENING 8' };
  };
  const found = await discoverProcesses({ platform: 'win32', target: 'ide', parentPid: 4, execute });
  assert.deepEqual(found.map(row => row.pid), [8]);
  assert.deepEqual([...found[0].ports], [8080]);
  assert.match(calls[0][1].join(' '), /GetOwnerSid/);
});

test('IDE probes only PID-owned ports and validates a read-only service; ambiguous backends are refused', async t => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url, token: req.headers['x-codeium-csrf-token'], body });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ userStatus: { email: 'test@example.invalid' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const row = { pid: 8, command: '--subclient_type ide --csrf_token secret', ports: new Set([port]) };
  const client = new LanguageService({ target: 'ide', processes: async () => [row] });
  assert.equal((await client.discover()).port, port);
  assert.equal(received[0].path, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
  assert.equal(received[0].token, 'secret');
  client.reset(); client.processes = async () => [row, { ...row, pid: 9 }];
  await assert.rejects(client.discover(), /唯一/);
  assert.equal(received.length, 1, 'Multiple backends must not trigger speculative sampling');
});

test('IDE bridge rechecks active conversation before delivery on a same-URL switch', async () => {
  const f = composer(), delivered = [];
  let resolve;
  const hub = new CdpHub({ target: 'ide', source: () => '', onMetrics: () => new Promise(done => { resolve = done; }) });
  hub.running = true;
  const connection = { url: 'ws://127.0.0.1:9333/page', pageUrl: f.win.location.href,
    contexts: new Set([7]), injectGeneration: 1,
    command: async (_, params) => ({ result: { value: vm.runInNewContext(params.expression, {
      window: { ...f.win, __easyagContext: { receive: (...args) => delivered.push(args) } },
      document: f.doc, location: f.win.location
    }) } }) };
  const pending = hub.metrics(connection, 7, { conversationId: id, requestId: '1' });
  await new Promise(done => setImmediate(done));
  assert.equal(typeof resolve, 'function');
  f.props.cascadeId = otherId;
  resolve({ conversationId: id, state: 'live' });
  await pending;
  assert.equal(delivered.length, 0);
});

test('IDE renderer includes context support without injecting desktop translations', () => {
  const source = rendererSource({ 'Private dictionary': 'translation' }, { enableI18n: true, enableContextMonitor: true }, 'bridge', 'ide');
  assert.doesNotMatch(source, /Private dictionary/);
  assert.match(source, /currentConversationId/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('CDP target discovery separates IDE workbench pages from desktop pages', async t => {
  const server = http.createServer((req, res) => {
    const endpoint = `ws://127.0.0.1:${server.address().port}/devtools/page/`;
    res.end(JSON.stringify([
      { type: 'page', url: composer().win.location.href, webSocketDebuggerUrl: endpoint + 'ide' },
      { type: 'page', url: 'http://127.0.0.1:4000/c/' + id, webSocketDebuggerUrl: endpoint + 'hub' }
    ]));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const target of ['hub', 'ide']) {
    const hub = new CdpHub({ target, port: server.address().port, source: () => '' });
    const pages = await hub.findTargets();
    assert.equal(pages.length, 1);
    assert.ok(pages[0].webSocketDebuggerUrl.endsWith(target));
  }
});
