// Real browser regression for launcher initialization, actions and fallback paths.
// All API responses are synthetic; no installed Antigravity is launched or changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CdpConnection, getJson } = require('../adapters/desktop/cdp');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const executable = process.argv[2];
  assert.ok(executable && fs.existsSync(executable), 'Supply an installed Chromium executable');
  const root = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-launcher-browser-'));
  const calls = [];
  const status = {
    activeTarget: 'hub', phase: 'idle', port: 7890, enableProxy: true,
    enableI18n: true, enableContextMonitor: true, clientRunning: false,
    targets: {
      hub: { exists: true, appExe: 'C:\\Synthetic\\Antigravity.exe' },
      ide: { exists: false, appExe: '' }
    }
  };
  let failLaunch = false;
  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (!route.startsWith('/api/')) {
      const files = { '/': 'index.html', '/ui/launcher.js': 'ui/launcher.js', '/ui/api.js': 'ui/api.js', '/ui/launcher.css': 'ui/launcher.css' };
      if (!files[route]) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', route.endsWith('.js') ? 'text/javascript' : route.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(root, files[route])));
      return;
    }
    if (route === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    calls.push({ route, input });
    let result = { ok: true };
    if (route === '/api/status') result = status;
    if (route === '/api/logs') result = [];
    if (route === '/api/config' && input.targetApp) status.activeTarget = input.targetApp;
    if (route === '/api/set-target-path' || route === '/api/browse-exe') {
      const exe = route === '/api/browse-exe' ? 'D:\\Synthetic\\Browsed.exe' : input.path;
      if (exe === 'invalid.exe') { res.statusCode = 400; result = { ok: false, error: '指定的文件路径不存在' }; }
      else {
        status.targets[input.target] = { exists: Boolean(exe), appExe: exe, isCustom: Boolean(exe) };
        result = { ok: true, path: exe, status };
      }
    }
    if (route === '/api/launch' && failLaunch) { res.statusCode = 409; result = { ok: false, error: 'Synthetic launch failure' }; }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', '--no-first-run', '--disable-extensions', '--no-proxy-server', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); } catch {}
      if (!port) await sleep(100);
    }
    assert.ok(port, 'Browser starts');
    const page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(item => item.type === 'page');
    socket = await new CdpConnection(page.webSocketDebuggerUrl).open();
    const evaluate = async expression => {
      const result = await socket.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(error => { throw new Error(`Evaluate ${expression}: ${error.message}`); });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
      assert.fail(`Timed out: ${expression}`);
    };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const visible = "document.getElementById('pathModal').style.display === 'flex'";
    await socket.command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor("document.body.dataset.uiState === 'idle'");
    assert.equal(await evaluate("document.getElementById('launchBtn').disabled"), false);
    const theme = await evaluate('document.documentElement.dataset.theme');
    await click('themeToggleBtn');
    await waitFor(`document.documentElement.dataset.theme !== ${JSON.stringify(theme)}`);
    await click('targetIdeBtn');
    await waitFor(visible);
    await evaluate(`document.getElementById('customPathInput').value = ${JSON.stringify('D:\\Typing.exe')}`);
    await sleep(3300); // Cross the normal status poll: editing must survive it.
    assert.equal(await evaluate("document.getElementById('customPathInput').value"), 'D:\\Typing.exe');
    await click('modalCancelBtn');
    await waitFor(`!(${visible})`);
    await click('launchBtn'); // Missing target must remain actionable after dismissal.
    await waitFor(visible);
    await evaluate("document.getElementById('customPathInput').value = 'invalid.exe'");
    await click('savePathBtn');
    await waitFor("document.getElementById('pathEditTip').style.display === 'flex'");
    await evaluate(`document.getElementById('customPathInput').value = ${JSON.stringify('D:\\Synthetic\\IDE.exe')}`);
    await click('savePathBtn');
    await waitFor(`!(${visible})`);
    assert.ok(calls.some(call => call.route === '/api/set-target-path' && call.input.target === 'ide' && call.input.path === 'D:\\Synthetic\\IDE.exe'));
    await click('targetHubBtn');
    await click('launchBtn');
    await waitFor("document.body.dataset.uiState === 'running'");
    assert.ok(calls.some(call => call.route === '/api/launch'));
    assert.equal(await evaluate("document.getElementById('targetIdeBtn').disabled"), true);
    await waitFor("document.body.dataset.uiState === 'idle'");
    failLaunch = true;
    await click('launchBtn');
    await waitFor(visible);
    assert.match(await evaluate("document.getElementById('pathTipText').textContent"), /Synthetic launch failure/);
    await click('browseExeBtn');
    await waitFor(`!(${visible})`);
    assert.ok(calls.some(call => call.route === '/api/browse-exe' && call.input.target === 'hub'));
    status.targets.ide.exists = false;
    await click('targetIdeBtn');
    await waitFor(visible);
    await click('resetPathBtn');
    await waitFor("document.getElementById('customPathInput').value === ''");
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await waitFor(`!(${visible})`);
    await click('launchBtn'); await waitFor(visible);
    await click('modalCloseBtn'); await waitFor(`!(${visible})`);
    await click('launchBtn'); await waitFor(visible);
    await click('pathModal'); await waitFor(`!(${visible})`);
    await click('updateBtn');
    await waitFor("document.getElementById('updateActionText').textContent === '↻ 检查更新'");
    assert.ok(calls.some(call => call.route === '/api/update'));
    console.log('PASS: launcher initialization, theme, target switching, launch, running lock, failure recovery, modal save/browse/reset/dismiss, polling preserves input, update');
  } finally {
    if (socket) { try { await socket.command('Browser.close'); } catch {} socket.close(); }
    if (browser.exitCode === null) browser.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (path.resolve(profile).startsWith(tempRoot) && path.basename(profile).startsWith('easyag-launcher-browser-')) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may still own its temporary files. */ }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
