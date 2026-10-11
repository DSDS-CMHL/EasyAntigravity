// Optional real Chromium layout check. Uses a synthetic host, never a logged-in AG.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CdpConnection, getJson } = require('../adapters/desktop/cdp');
const { installContextWidget } = require('../features/context-widget');
const id = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const executable = process.argv[2];
  if (!executable || !fs.existsSync(executable)) throw new Error('Supply an installed Chromium executable');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-context-browser-'));
  const html = `<!doctype html><html><head><style>
    body{background:#202124;color:#eee;font:13px system-ui;padding:40px;margin:0}
    #composer{width:min(650px,100%);border:1px solid #555;padding:10px;box-sizing:border-box}
    [contenteditable]{height:80px;background:transparent}#actions{display:flex;flex-direction:row;align-items:center;gap:6px;height:32px}
    button{white-space:nowrap;background:#333;color:#eee;border:1px solid #555;padding:5px}#send{margin-left:auto}
  </style></head><body><div id="composer"><div contenteditable="true" role="textbox">Synthetic host; no real conversation.</div>
  <div id="actions"><button data-testid="model-selector-trigger">Model selection</button><button id="send">Send</button></div></div>
  <script>window.calls=[];window.sample=(event)=>({conversationId:event.conversationId,state:'live',sampledAt:Date.now(),context:{usedTokens:110000,maxTokens:256000,usedFraction:110000/256000,model:'Synthetic model'},speed:{tokensPerSecond:52,ttftSeconds:0.7,basis:'response'}});
  window.riskSample={enabled:true,session:1,revision:7,total:7,counts:{high:2,medium:4,low:1},highestLevel:'high'};
  (${installContextWidget.toString()})(window,document,true,event=>{calls.push(event);queueMicrotask(()=>{if(event.type==='risk-stats')window.__easyagContext?.receiveRisk(event.requestId,riskSample);else window.__easyagContext?.receive(event.requestId,sample(event));});},true);</script></body></html>`;
  const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--disable-default-apps', '--disable-extensions', '--no-proxy-server', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); break; }
      catch { await sleep(100); }
    }
    assert.ok(port, 'Browser debug endpoint starts');
    const target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(item => item.type === 'page');
    socket = await new CdpConnection(target.webSocketDebuggerUrl).open();
    const evaluate = async expression => {
      const result = await socket.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    await socket.command('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await socket.command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/c/${id}` });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate("Boolean(document.getElementById('easyag-context-monitor'))")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('context-value').textContent"), '43');
    assert.doesNotMatch(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('strip').textContent"), /上下文|风险/);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-value').textContent"), '7');
    const layout = await evaluate("(()=>{const n=document.getElementById('easyag-context-monitor');n.style.display='flex';const b=n.shadowRoot.getElementById('trigger');return {hidden:n.hidden,node:n.getBoundingClientRect().toJSON(),button:b.getBoundingClientRect().toJSON(),scroll:b.scrollWidth,controls:[...document.querySelectorAll('#actions button')].map(c=>({rect:c.getBoundingClientRect().toJSON(),scroll:c.scrollWidth,width:c.clientWidth}))};})()");
    assert.equal(layout.hidden, false, JSON.stringify(layout));
    const nativeHit = "(()=>{const b=document.getElementById('send'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()";
    assert.equal(await evaluate(nativeHit), true);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('trigger').click()");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').matches(':popover-open')"), true);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('speed').textContent"), '52.0 tok/s');
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('close').click()");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').hidden"), true);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-trigger').click()");
    assert.deepEqual(await evaluate("['risk-high','risk-medium','risk-low'].map(id=>document.getElementById('easyag-context-monitor').shadowRoot.getElementById(id).textContent)"), ['2','4','1']);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-details').matches(':popover-open')"), true);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-close').click();document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-trigger').click()");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-details').hidden"), false);
    await evaluate("document.getElementById('send').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}))");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-details').hidden"), true);
    await evaluate("(()=>{const n=document.getElementById('easyag-context-monitor'),r=n.getBoundingClientRect(),b=document.createElement('button');b.id='floating-host-control';b.textContent='Host';b.style.cssText='position:fixed;z-index:99999;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';document.body.appendChild(b);})()");
    await sleep(1200);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').hidden"), true, 'A visible floating native control wins over the indicators');
    await evaluate("document.getElementById('floating-host-control').remove()"); await sleep(1200);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').hidden"), false);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('trigger').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').hidden"), true);
    await socket.command('Emulation.setDeviceMetricsOverride', { width: 260, height: 500, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').hidden"), true);
    assert.equal(await evaluate(nativeHit), true, 'Hidden widget does not intercept Send');
    await socket.command('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').hidden"), false);
    await evaluate(`history.pushState({},'', '/c/${otherId}')`); await sleep(1200);
    assert.equal(await evaluate('calls.at(-1).conversationId'), otherId);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-value').textContent"), '7', 'Conversation switch retains session total');
    await evaluate(`(${installContextWidget.toString()})(window,document,false,event=>{if(event.type==='risk-stats')queueMicrotask(()=>window.__easyagContext?.receiveRisk(event.requestId,riskSample));},true)`);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('trigger').hidden"), true);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('risk-value').textContent"), '7', 'Risk entry is independent of context toggle');
    await evaluate('window.__easyagContext.dispose()');
    assert.equal(await evaluate("Boolean(document.getElementById('easyag-context-monitor'))"), false);
    assert.equal(await evaluate(nativeHit), true);
    console.log('PASS: graphical context ring and risk triangle/counts, real Chromium popovers, close/reopen, Escape/outside click, narrow recovery, native hit targets, navigation and cleanup');
  } finally {
    if (socket) { try { await socket.command('Browser.close'); } catch { /* Browser may already be closed. */ } socket.close(); }
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
    // Browser profiles are retained in the system temporary directory if Chromium still owns files.
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Safe, task-created temporary profile only. */ }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
