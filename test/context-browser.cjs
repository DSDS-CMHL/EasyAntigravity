// Optional real Chromium layout check. Uses a synthetic host, never a logged-in AG.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CdpConnection, getJson } = require('../adapters/desktop/cdp');
const { installContextWidget } = require('../features/context-widget');
const { currentConversationId } = require('../features/conversation-context');
const id = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const executable = process.argv.slice(2).find(arg => arg !== '--ide');
  const ide = process.argv.includes('--ide');
  if (!executable || !fs.existsSync(executable)) throw new Error('Supply an installed Chromium executable');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'easyag-context-browser-'));
  const html = `<!doctype html><html><head>${ide ? '<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for &apos;script&apos;; trusted-types &apos;none&apos;">' : ''}<style>
    body{background:#202124;color:#eee;font:13px system-ui;padding:40px;margin:0}
    .composer{width:min(650px,100%);border:1px solid #555;padding:10px;box-sizing:border-box}
    [contenteditable]{height:80px;background:transparent}#actions{display:flex;flex-direction:row;align-items:center;gap:6px;height:32px}
    button{white-space:nowrap;background:#333;color:#eee;border:1px solid #555;padding:5px}#send{margin-left:auto}
  </style></head><body><div class="antigravity-agent-side-panel"><div class="composer" id="${ide ? 'antigravity.agentSidePanelInputBox' : 'composer'}"><div contenteditable="true" role="textbox">Synthetic host; no real conversation.</div>
  <div id="actions"><button data-testid="model-selector-trigger">Model selection</button><button id="send">Send</button></div></div></div>
  <script>window.calls=[];window.sample=(event)=>({conversationId:event.conversationId,state:'live',sampledAt:Date.now(),context:{usedTokens:110000,maxTokens:256000,usedFraction:110000/256000,model:'Synthetic model'},speed:{tokensPerSecond:52,ttftSeconds:0.7,basis:'response'}});
  window.ideOwner={props:{cascadeId:'${id}'}};
  if (${ide}) document.querySelector('.antigravity-agent-side-panel').__k={__k:[{__e:document.getElementById('antigravity.agentSidePanelInputBox'),__:ideOwner}]};
  (${installContextWidget.toString()})(window,document,true,event=>{calls.push(event);queueMicrotask(()=>window.__easyagContext?.receive(event.requestId,sample(event)));},${ide ? `(win,doc)=>(${currentConversationId.toString()})(win,doc,'ide')` : 'undefined'});</script></body></html>`;
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
    const fixtureFile = path.join(profile, 'workbench.html');
    if (ide) fs.writeFileSync(fixtureFile, html);
    await socket.command('Page.navigate', { url: ide ? pathToFileURL(fixtureFile).href : `http://127.0.0.1:${server.address().port}/c/${id}` });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate("Boolean(document.getElementById('easyag-context-monitor'))")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('context-value').textContent"), '43');
    if (ide) assert.equal(await evaluate("(()=>{try{document.createElement('div').innerHTML='';return false}catch(error){return error instanceof TypeError}})()"), true, 'Fixture must enforce Trusted Types');
    assert.doesNotMatch(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('strip').textContent"), /上下文|风险/);
    const layout = await evaluate("(()=>{const n=document.getElementById('easyag-context-monitor');n.style.display='flex';const b=n.shadowRoot.getElementById('trigger');return {hidden:n.hidden,node:n.getBoundingClientRect().toJSON(),button:b.getBoundingClientRect().toJSON(),scroll:b.scrollWidth,controls:[...document.querySelectorAll('#actions button')].map(c=>({rect:c.getBoundingClientRect().toJSON(),scroll:c.scrollWidth,width:c.clientWidth}))};})()");
    assert.equal(layout.hidden, false, JSON.stringify(layout));
    const nativeHit = "(()=>{const b=document.getElementById('send'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()";
    assert.equal(await evaluate(nativeHit), true);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('trigger').click()");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').matches(':popover-open')"), true);
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('speed').textContent"), '52.0 tok/s');
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('close').click()");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').hidden"), true);
    await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('trigger').click();document.getElementById('send').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}))");
    assert.equal(await evaluate("document.getElementById('easyag-context-monitor').shadowRoot.getElementById('details').hidden"), true);
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
    await evaluate(ide ? `window.ideOwner.props.cascadeId='${otherId}'` : `history.pushState({},'', '/c/${otherId}')`); await sleep(1200);
    assert.equal(await evaluate('calls.at(-1).conversationId'), otherId);
    await evaluate(`(${installContextWidget.toString()})(window,document,false,()=>{})`);
    assert.equal(await evaluate("Boolean(document.getElementById('easyag-context-monitor'))"), false);
    assert.equal(await evaluate(nativeHit), true);
    console.log(`PASS: ${ide ? 'IDE Trusted Types and same-URL switching' : 'desktop routing'}, context ring, details, close/reopen, Escape/outside click, narrow recovery, native hit targets and cleanup`);
  } finally {
    if (socket) { try { await socket.command('Browser.close'); } catch { /* Browser may already be closed. */ } socket.close(); }
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
    // Browser profiles are retained in the system temporary directory if Chromium still owns files.
    if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('easyag-context-browser-')) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Browser may still own this task-created profile. */ }
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
