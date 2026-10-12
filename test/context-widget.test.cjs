const test = require('node:test');
const assert = require('node:assert/strict');
const { installContextWidget } = require('../features/context-widget');
const { rendererSource, disposeSource } = require('../adapters/desktop/renderer');
const vm = require('node:vm');
const id = '11111111-1111-1111-1111-111111111111';
const nextId = '22222222-2222-2222-2222-222222222222';

function fixture() {
  class Element {
    constructor(rect = { left: 110, right: 210, top: 150, bottom: 178, width: 100, height: 28 }) {
      this.rect = rect; this.style = {}; this.dataset = {}; this.attrs = {}; this.events = {}; this.hidden = false;
      this.isConnected = true; this.scrollWidth = 90;
    }
    addEventListener(type, callback) { this.events[type] = callback; }
    removeEventListener(type) { delete this.events[type]; }
    setAttribute(key, value) { this.attrs[key] = value; }
    hasAttribute(key) { return key in this.attrs; }
    matches() { return this.open === true; }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
    closest() { return null; }
    getClientRects() { return [this.rect]; }
    getBoundingClientRect() { return this.rect; }
    contains(element) { return this.children?.includes(element) || this === element; }
    querySelectorAll() { return []; }
    remove() { this.isConnected = false; }
    focus() { this.focused = true; }
    attachShadow() {
      const elements = {};
      this.shadow = { activeElement: null, set innerHTML(html) {
        for (const match of html.matchAll(/id="([^"]+)"/g)) elements[match[1]] = new Element();
        elements.details.hidden = true;
        elements['risk-details'].hidden = true;
      }, getElementById: key => elements[key] };
      return this.shadow;
    }
  }
  const editor = new Element({ left: 0, right: 500, top: 50, bottom: 130, width: 500, height: 80 });
  const row = new Element({ left: 0, right: 500, top: 150, bottom: 180, width: 500, height: 30 });
  const container = new Element({ left: 0, right: 500, top: 50, bottom: 180, width: 500, height: 130 });
  const anchor = new Element({ left: 0, right: 100, top: 150, bottom: 178, width: 100, height: 28 });
  anchor.parentElement = row; row.parentElement = container;
  container.children = [editor, row]; row.children = [anchor];
  let mounted, anchors = [anchor];
  row.insertBefore = node => { mounted = node; node.isConnected = true; node.parentElement = row; };
  const doc = new Element();
  doc.documentElement = new Element(); doc.body = new Element(); doc.hidden = false;
  doc.querySelectorAll = selector => selector.includes('contenteditable') ? [editor] : anchors;
  doc.createElement = () => new Element();
  const timers = new Map(), frames = new Map(), sent = [];
  let sequence = 0;
  class Observer { observe() {} disconnect() { this.disconnected = true; } }
  const win = new Element();
  Object.assign(win, { location: { pathname: '/c/' + id }, innerWidth: 900, innerHeight: 700,
    getComputedStyle: () => ({ display: 'flex', flexDirection: 'row', position: 'relative', visibility: 'visible' }),
    MutationObserver: Observer, ResizeObserver: Observer,
    setInterval(callback) { const key = ++sequence; timers.set(key, callback); return key; },
    clearInterval(key) { timers.delete(key); }, requestAnimationFrame(callback) { const key = ++sequence; frames.set(key, callback); return key; },
    cancelAnimationFrame(key) { frames.delete(key); }
  });
  return { win, doc, timers, frames, sent, row,
    get node() { return mounted; }, get shadow() { return mounted?.shadow; },
    tick() { for (const callback of timers.values()) callback(); },
    setAnchors(value) { anchors = value; }, install(enabled = true, riskEnabled = false) { installContextWidget(win, doc, enabled, event => sent.push(event), riskEnabled); }
  };
}

const result = (conversationId = id) => ({ conversationId, state: 'live', sampledAt: Date.now(),
  context: { usedTokens: 40000, maxTokens: 100000, usedFraction: .4, model: 'Model <not html>' },
  speed: { tokensPerSecond: 50, ttftSeconds: .5, basis: 'response', shortSample: false } });

test('widget has a compact context marker; speed appears only in closable details', () => {
  const f = fixture(); f.install();
  assert.equal(f.sent.length, 1);
  f.win.__easyagContext.receive(f.sent[0].requestId, result());
  const trigger = f.shadow.getElementById('trigger'), card = f.shadow.getElementById('details');
  assert.equal(f.shadow.getElementById('context-value').textContent, '40');
  assert.ok(Number(f.shadow.getElementById('context-fill').style.strokeDashoffset) > 0);
  assert.match(trigger.attrs['aria-label'], /40%/);
  assert.doesNotMatch(f.shadow.getElementById('context-value').textContent, /tok\/s|上下文/);
  assert.equal(f.shadow.getElementById('speed').textContent, '50.0 tok/s');
  assert.equal(f.shadow.getElementById('model').textContent, 'Model <not html>', 'Model names stay text, not HTML');
  trigger.events.click(); assert.equal(card.hidden, false); assert.equal(card.open, true);
  f.shadow.getElementById('close').events.click(); assert.equal(card.hidden, true);
  trigger.events.click(); assert.equal(card.hidden, false, 'Can reopen after closing');
  f.doc.events.keydown({ key: 'Escape' }); assert.equal(card.hidden, true);
  trigger.events.click(); f.doc.events.pointerdown({ composedPath: () => [] }); assert.equal(card.hidden, true);
  f.win.__easyagContext.dispose();
});

test('navigation clears the prior context and ignores a late response from another conversation', () => {
  const f = fixture(); f.install();
  const old = f.sent[0];
  f.win.location.pathname = '/c/' + nextId; f.tick();
  assert.equal(f.sent.length, 2);
  f.win.__easyagContext.receive(old.requestId, result());
  assert.equal(f.shadow.getElementById('context-value').textContent, '—');
  f.win.__easyagContext.receive(f.sent[1].requestId, result(nextId));
  assert.equal(f.shadow.getElementById('context-value').textContent, '40');
  f.win.__easyagContext.dispose();
});

test('unsupported/narrow layouts stay untouched and disabling removes timers and listeners', () => {
  const f = fixture(); f.setAnchors([]); f.install();
  assert.equal(f.node, undefined); assert.equal(f.sent.length, 0);
  f.install(false); assert.equal(f.timers.size, 0); assert.equal(f.win.__easyagContext, undefined);
  const narrow = fixture(); narrow.row.rect.right = 150; narrow.row.rect.width = 150;
  narrow.install(); assert.equal(narrow.node.hidden, true); assert.equal(narrow.sent.length, 0);
  narrow.install(false); assert.equal(narrow.node.isConnected, false);
  assert.equal(narrow.timers.size, 0); assert.equal(narrow.frames.size, 0);
  assert.equal(narrow.doc.events.keydown, undefined);
});

test('reinjection disposes the previous widget and pending work rather than stacking it', () => {
  const f = fixture(); f.install(); const old = f.win.__easyagContext, oldNode = f.node;
  f.install(); assert.equal(oldNode.isConnected, false); assert.equal(f.timers.size, 1);
  old.receive('1', result()); assert.equal(f.shadow.getElementById('context-value').textContent, '—');
  f.win.__easyagContext.dispose();
});

test('serialized renderer and cleanup are valid JavaScript', () => {
  new vm.Script(rendererSource({}, { enableI18n: false, riskAdvisor: false, enableContextMonitor: true }, '__binding'));
  new vm.Script(disposeSource);
  assert.match(disposeSource, /__easyagContext.*dispose/);
});

const riskResult = (counts = { high: 2, medium: 4, low: 1 }, revision = 7, session = 1,
  latestLevel = counts.medium ? 'medium' : counts.low ? 'low' : counts.high ? 'high' : null) => ({
  enabled: true, session, revision, total: counts.high + counts.medium + counts.low, counts,
  highestLevel: counts.high ? 'high' : counts.medium ? 'medium' : counts.low ? 'low' : null, latestLevel
});

test('latest-risk shield expands exact severity counts, survives navigation and does not depend on context replies', () => {
  const f = fixture(); f.install(true, true);
  const request = f.sent.find(event => event.type === 'risk-stats');
  assert.ok(request);
  f.win.__easyagContext.receiveRisk(request.requestId, riskResult());
  assert.equal(f.shadow.getElementById('risk-value').textContent, '4');
  assert.equal(f.shadow.getElementById('risk-trigger').dataset.tone, 'medium', 'Latest risk wins over historical highest severity');
  assert.equal(f.shadow.getElementById('risk-total').textContent, '7');
  assert.equal(f.shadow.getElementById('risk-high').textContent, '2');
  assert.equal(f.shadow.getElementById('risk-medium').textContent, '4');
  assert.equal(f.shadow.getElementById('risk-low').textContent, '1');
  const trigger = f.shadow.getElementById('risk-trigger'), card = f.shadow.getElementById('risk-details');
  trigger.events.click(); assert.equal(card.hidden, false);
  f.shadow.getElementById('trigger').events.click();
  assert.equal(card.hidden, true, 'Only one details card is open');
  trigger.events.click(); f.shadow.getElementById('risk-close').events.click(); assert.equal(card.hidden, true);
  trigger.events.click(); assert.equal(card.hidden, false, 'Risk card reopens');
  f.win.location.pathname = '/c/' + nextId; f.tick();
  assert.equal(card.hidden, true);
  assert.equal(f.shadow.getElementById('risk-value').textContent, '4', 'Latest-level session count survives conversation changes');
  f.win.__easyagContext.dispose();
});

test('shield number shrinks by digits and latest risk changes without a timed rotation', () => {
  const f = fixture(); f.install(false, true);
  const cases = [
    { counts: { high: 1, medium: 0, low: 0 }, level: 'high', text: '1', size: '11px' },
    { counts: { high: 1, medium: 12, low: 0 }, level: 'medium', text: '12', size: '9px' },
    { counts: { high: 1, medium: 12, low: 123 }, level: 'low', text: '123', size: '7px' },
    { counts: { high: 1, medium: 12, low: 1234 }, level: 'low', text: '999+', size: '6px' }
  ];
  for (const [index, example] of cases.entries()) {
    if (index) { f.win.location.pathname = '/c/' + (index % 2 ? nextId : id); f.tick(); }
    f.win.__easyagContext.receiveRisk(f.sent.at(-1).requestId, riskResult(example.counts, index + 1, 1, example.level));
    assert.equal(f.shadow.getElementById('risk-value').textContent, example.text);
    assert.equal(f.shadow.getElementById('risk-value').style.fontSize, example.size);
    assert.equal(f.shadow.getElementById('risk-trigger').dataset.tone, example.level);
  }
  assert.equal(f.shadow.getElementById('risk-low').textContent, '1234', 'Details preserve the exact count');
  assert.equal(f.shadow.getElementById('risk-total').textContent, '1247');
  const value = f.shadow.getElementById('risk-value').textContent;
  f.tick(); assert.equal(f.shadow.getElementById('risk-value').textContent, value, 'No rotation without a new result');
  f.win.__easyagContext.dispose();
});

test('risk-only mode works with context switched off, malformed or old counters cannot replace it', () => {
  const f = fixture(); f.install(false, true);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'risk-stats');
  assert.equal(f.shadow.getElementById('trigger').hidden, true);
  assert.equal(f.shadow.getElementById('risk-trigger').hidden, false);
  f.win.__easyagContext.receiveRisk(f.sent[0].requestId, riskResult());
  f.win.location.pathname = '/c/' + nextId; f.tick();
  f.win.__easyagContext.receiveRisk(f.sent.at(-1).requestId, riskResult({ high: 0, medium: 1, low: 0 }, 1));
  assert.equal(f.shadow.getElementById('risk-value').textContent, '4', 'Older revision is ignored');
  f.win.location.pathname = '/c/' + id; f.tick();
  f.win.__easyagContext.receiveRisk(f.sent.at(-1).requestId, { ...riskResult(), total: 100 });
  assert.equal(f.shadow.getElementById('risk-value').textContent, '4', 'Invalid totals are rejected');
  f.win.location.pathname = '/c/' + nextId; f.tick();
  f.win.__easyagContext.receiveRisk(f.sent.at(-1).requestId, riskResult({ high: 0, medium: 0, low: 0 }, 8, 2));
  assert.equal(f.shadow.getElementById('risk-value').textContent, '0');
  assert.equal(f.shadow.getElementById('risk-trigger').dataset.tone, 'normal');
  f.install(false, false); assert.equal(f.timers.size, 0); assert.equal(f.win.__easyagContext, undefined);
});

test('a full context fills the circle and unknown capacity never invents a percentage', () => {
  const f = fixture(); f.install();
  const sample = result(); sample.context.usedFraction = 1.2;
  f.win.__easyagContext.receive(f.sent[0].requestId, sample);
  assert.equal(f.shadow.getElementById('context-fill').style.strokeDashoffset, '0');
  assert.equal(f.shadow.getElementById('context-value').textContent, '120');
  assert.equal(f.shadow.getElementById('trigger').dataset.tone, 'high');
  f.win.location.pathname = '/c/' + nextId; f.tick();
  const unknown = result(nextId); unknown.context.maxTokens = null; unknown.context.usedFraction = null;
  f.win.__easyagContext.receive(f.sent.at(-1).requestId, unknown);
  assert.equal(f.shadow.getElementById('context-value').textContent, '—');
  assert.equal(f.shadow.getElementById('context-fill').style.strokeDashoffset, '62.832');
  f.win.__easyagContext.dispose();
});
