// Render actual UI source with isolated demo data; never connect to a real AG.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CdpConnection, getJson } = require('../adapters/desktop/cdp');
const { installContextWidget } = require('../features/context-widget');
const { loadDictionary } = require('../features/i18n');

async function main() {
  const executable = process.argv[2];
  if (!executable || !fs.existsSync(executable)) throw new Error('Supply a Chromium executable');
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'docs', 'images');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-readme-'));
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'danger-rules.json'), 'utf8')).rules;
  const status = { port: 7890, launchMode: 'pilot', protectionLevel: 'standard', enableI18n: true,
    enableContextMonitor: true, riskAdvisor: true, phase: 'idle', activeLaunchMode: null,
    clientRunning: false, cdpSockets: 0, dictEntries: Object.keys(loadDictionary(root)).length,
    dangerRulesTotal: rules.length, dangerRulesOn: rules.filter(rule => rule.enabled !== false).length, riskHits: 0 };
  const id = '11111111-1111-1111-1111-111111111111';
  const widgetPage = `<!doctype html><meta charset="utf-8"><style>
    body{background:#17191f;color:#e2e8f0;font:13px system-ui,"Microsoft YaHei",sans-serif;padding:28px;margin:0}
    h1{font-size:17px;margin:0 0 8px}p{color:#94a3b8;margin:0}#composer{margin-top:160px;width:650px;border:1px solid #3a3f4b;border-radius:12px;padding:12px;box-sizing:border-box}
    [contenteditable]{height:46px;color:#94a3b8}#actions{display:flex;flex-direction:row;align-items:center;gap:6px;height:32px}
    button{white-space:nowrap;background:#242831;color:#e2e8f0;border:1px solid #3a3f4b;border-radius:6px;padding:5px 10px}#send{margin-left:auto}
    </style><h1>上下文与最近风险</h1><p>当前组件源码 · 隔离宿主 / 模拟统计，不是 AG 实机截图</p>
    <div id="composer"><div contenteditable="true" role="textbox">输入区中的轻量指标，点击查看详情</div>
    <div id="actions"><button data-testid="model-selector-trigger">模型选择</button><button id="send">发送</button></div></div>
    <script>(${installContextWidget.toString()})(window,document,true,event=>queueMicrotask(()=>{
      if(event.type==='risk-stats')window.__easyagContext.receiveRisk(event.requestId,{enabled:true,session:1,revision:20,total:20,counts:{high:3,medium:12,low:5},latestLevel:'medium',highestLevel:'high'});
      else window.__easyagContext.receive(event.requestId,{conversationId:event.conversationId,state:'live',sampledAt:Date.now(),context:{usedTokens:67000,maxTokens:100000,usedFraction:.67,model:'演示模型'},speed:null});
    }),true);</script>`;
  const streams = new Set();
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': demo\n\n');
      streams.add(response); response.on('close', () => streams.delete(response)); return;
    }
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(url.pathname === '/api/status' ? status : url.pathname === '/api/logs'
        ? [{ category: 'SYSTEM', message: 'README 界面演示 · 未启动或连接 AG', cls: 'tag-proxy', at: '2026-10-12T08:00:00Z' }] : [])); return;
    }
    if (url.pathname === '/c/' + id) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(widgetPage); return; }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname === '/capsule.html' ? 'src/capsule.html' : url.pathname.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--disable-extensions', '--no-proxy-server', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); break; } catch { await delay(100); }
    }
    if (!port) throw new Error('Preview browser did not start');
    const target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(item => item.type === 'page');
    socket = await new CdpConnection(target.webSocketDebuggerUrl).open();
    const evaluate = async expression => {
      const value = await socket.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result?.value;
    };
    const base = `http://127.0.0.1:${server.address().port}`;
    const capture = async (route, name, width, height, setup) => {
      await socket.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      await socket.command('Page.navigate', { url: base + route }); await delay(700);
      await evaluate('document.fonts.ready.then(()=>true)');
      if (setup) await evaluate(setup);
      await delay(250);
      const screenshot = await socket.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, name), Buffer.from(screenshot.data, 'base64'));
      console.log('Captured ' + name);
    };
    await capture('/', 'launcher.png', 570, 960);
    await capture('/capsule.html', 'risk-capsule.png', 400, 200,
      `window.__ea_capsule('risk_high','递归 / 强制删除文件','可能跳过确认直接删除目录及其内容。请核对目标路径、展开后的变量和备份。'); document.getElementById('notice').dispatchEvent(new Event('mouseenter'));`);
    await capture('/c/' + id, 'inline-metrics-demo.png', 710, 370,
      `document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-trigger').click()`);
  } finally {
    socket?.close(); browser.kill();
    for (const response of streams) response.end();
    await new Promise(resolve => server.close(resolve));
    // Only delete the dedicated mkdtemp browser profile, never real browser data.
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* A transient browser lock may remain. */ }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
