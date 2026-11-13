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
      this.children = [];
    }
    addEventListener(type, callback) { this.events[type] = callback; }
    removeEventListener(type) { delete this.events[type]; }
    setAttribute(key, value) { this.attrs[key] = value; if (key === 'hidden') this.hidden = true; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    set innerHTML(_) { throw new Error('TrustedHTML required'); }
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
      this.shadow = new Element();
      this.shadow.activeElement = null;
      this.shadow.getElementById = key => {
        const queue = [...this.shadow.children];
        while (queue.length) { const node = queue.pop(); if (node.attrs.id === key) return node; queue.push(...node.children); }
      };
      return this.shadow;
    }
  }
  const editor = new Element({ left: 0, right: 500, top: 50, bottom: 130, width: 500, height: 80 });
  const row = new Element({ left: 0, right: 500, top: 150, bottom: 180, width: 500, height: 30 });
  const container = new Element({ left: 0, right: 500, top: 50, bottom: 180, width: 500, height: 130 });
  const anchor = new Element({ left: 0, right: 100, top: 150, bottom: 178, width: 100, height: 28 });
  anchor.textContent = 'Gemini 4 Argon';
  anchor.parentElement = row; row.parentElement = container;
  container.children = [editor, row]; row.children = [anchor];
  let mounted, anchors = [anchor];
  row.insertBefore = node => { mounted = node; node.isConnected = true; node.parentElement = row; };
  const doc = new Element();
  doc.documentElement = new Element(); doc.body = new Element(); doc.hidden = false;
  doc.querySelectorAll = selector => selector.includes('contenteditable') ? [editor] : anchors;
  doc.createElement = () => new Element();
  doc.createElementNS = () => new Element();
  doc.createTextNode = value => Object.assign(new Element(), { textContent: value });
  const timers = new Map(), frames = new Map(), sent = [];
  let clock = Date.now();
  let sequence = 0;
  class Observer { observe() {} disconnect() { this.disconnected = true; } }
  const win = new Element();
  Object.assign(win, { location: { pathname: '/c/' + id }, innerWidth: 900, innerHeight: 700,
    getComputedStyle: () => ({ display: 'flex', flexDirection: 'row', position: 'relative', visibility: 'visible' }),
    MutationObserver: Observer, ResizeObserver: Observer,
    setInterval(callback) { const key = ++sequence; timers.set(key, callback); return key; },
    clearInterval(key) { timers.delete(key); }, requestAnimationFrame(callback) { const key = ++sequence; frames.set(key, callback); return key; },
    cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(callback) { const key = ++sequence; timers.set(key, callback); return key; },
    clearTimeout(key) { timers.delete(key); },
    __easyagNow: () => clock
  });
  return { win, doc, timers, frames, sent, row,
    get node() { return mounted; }, get shadow() { return mounted?.shadow; }, editor,
    tick() { for (const callback of timers.values()) callback(); },
    advance(milliseconds) { clock += milliseconds; },
    setAnchors(value) { anchors = value; }, setModel(value) { anchor.textContent = value; },
    install(enabled = true) { installContextWidget(win, doc, enabled, event => sent.push(event)); }
  };
}

const result = (conversationId = id) => ({ conversationId, state: 'live', sampledAt: Date.now(),
  context: { usedTokens: 40000, maxTokens: 100000, usedFraction: .4, model: 'Model <not html>', endpointModel: 'gemini-3.8-flash-k' },
  speed: { tokensPerSecond: 50, ttftSeconds: .5, basis: 'response', shortSample: false, model: 'Model <not html>', endpointModel: 'gemini-3.8-flash-k' } });
const quotaResult = (groups, conversationId = id) => ({
  ...result(conversationId),
  quota: { state: 'live', source: 'summary', groups }
});
const allText = node => [
  typeof node?.textContent === 'string' ? node.textContent : '',
  ...(node?.children || []).map(allText)
].join('');

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
  assert.equal(f.shadow.getElementById('endpoint').textContent, 'gemini-3.8-flash-k');
  assert.match(trigger.title, /gemini-3.8-flash-k/);
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

test('new conversation keeps the indicators visible until a conversation exists', () => {
  const f = fixture();
  f.win.location.pathname = '/';
  f.install();
  assert.ok(f.node, 'The model and quota indicators should mount on the new-conversation page');
  assert.equal(f.sent.length, 1, 'Quota statistics can load before a conversation exists');
  assert.equal(f.sent[0].type, 'quota-metrics');
  assert.equal(f.shadow.getElementById('context-value').textContent, '—');
  assert.equal(f.shadow.getElementById('quota-trigger').dataset.state, 'unknown');
  assert.match(f.shadow.getElementById('updated').textContent, /正在读取本地统计/);
  f.win.location.pathname = '/c/' + id;
  f.tick();
  assert.equal(f.sent.length, 2, 'Entering a conversation starts the context statistics flow');
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
  new vm.Script(rendererSource({}, { enableI18n: false, enableContextMonitor: true }, '__binding'));
  new vm.Script(disposeSource);
  assert.match(disposeSource, /__easyagContext.*dispose/);
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

test('endpoint model does not leak across a model switch when new endpoint is pending', () => {
  const f = fixture(); f.install();
  f.win.__easyagContext.receive(f.sent[0].requestId, {
    conversationId: id,
    state: 'live',
    sampledAt: Date.now(),
    context: { usedTokens: 10, maxTokens: 100, usedFraction: .1, model: 'Claude Sonnet', endpointModel: null },
    speed: { tokensPerSecond: 40, ttftSeconds: .4, basis: 'response', shortSample: false, model: 'Gemini 3.8 Flash', endpointModel: 'gemini-3.8-flash-k' }
  });
  assert.equal(f.shadow.getElementById('endpoint').textContent, '—');
  f.win.__easyagContext.dispose();
});

test('model usage ring selects the exact model and shows official-style quota windows', () => {
  const f = fixture(); f.install();
  const groups = [
    {
      id: 'gemini-models', displayName: 'Gemini Models', family: 'gemini',
      modelKeys: ['Gemini 4 Argon'],
      buckets: [
        { id: 'weekly', displayName: 'Weekly limit', remainingFraction: .81, resetAt: '2030-01-02T00:00:00Z' },
        { id: '5h', displayName: '5h limit', remainingFraction: .52, resetAt: '2030-01-01T05:00:00Z' }
      ]
    },
    {
      id: 'gemini-argon', displayName: 'Gemini 4 Argon', family: 'gemini',
      modelKeys: ['gemini-4-argon'],
      buckets: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: .67 }]
    },
    {
      id: 'claude-gpt', displayName: 'Claude and GPT models', family: 'claude-gpt',
      buckets: [{ id: '5h', displayName: '5h limit', remainingFraction: .44 }]
    }
  ];
  f.win.__easyagContext.receive(f.sent[0].requestId, quotaResult(groups));
  const quotaButton = f.shadow.getElementById('quota-trigger');
  const quotaCard = f.shadow.getElementById('quota-details');
  const quotaBody = f.shadow.getElementById('quota-body');
  assert.equal(quotaButton.dataset.state, 'live');
  assert.match(quotaButton.attrs['aria-label'], /67%/);
  assert.equal(f.shadow.getElementById('quota-value').textContent, '67');
  assert.ok(Math.abs(Number(f.shadow.getElementById('quota-fill').style.strokeDashoffset) - 62.832 * .33) < 0.001);
  assert.match(f.shadow.getElementById('quota-trigger').attrs.class, /quota-indicator/);
  assert.match(allText(quotaBody), /Gemini 4 Argon/);
  assert.match(allText(quotaBody), /Weekly limit/);
  assert.match(allText(quotaBody), /5h limit/);
  quotaButton.events.click();
  assert.equal(quotaCard.hidden, false);
  assert.equal(quotaCard.open, true);
  assert.equal(f.shadow.getElementById('details').hidden, true, 'Quota details are mutually exclusive with context details');
  f.shadow.getElementById('quota-close').events.click();
  assert.equal(quotaCard.hidden, true);
  quotaButton.events.click();
  f.doc.events.pointerdown({ composedPath: () => [] });
  assert.equal(quotaCard.hidden, true);
  f.win.__easyagContext.dispose();
});

test('model usage ring falls back to a shared family quota and keeps unknown distinct from zero', () => {
  const f = fixture(); f.setModel('Gemini 2.5 Pro'); f.install();
  const shared = {
    id: 'gemini-models', displayName: 'Gemini Models', family: 'gemini',
    buckets: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: .73 }]
  };
  f.win.__easyagContext.receive(f.sent[0].requestId, quotaResult([shared]));
  const quotaButton = f.shadow.getElementById('quota-trigger');
  assert.match(quotaButton.attrs['aria-label'], /73%/);
  assert.equal(quotaButton.dataset.state, 'live');
  f.win.location.pathname = '/c/' + nextId; f.tick();
  const unknown = quotaResult([{
    id: 'gemini-unknown', displayName: 'Gemini 2.5 Pro', family: 'gemini',
    buckets: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: null }]
  }], nextId);
  f.win.__easyagContext.receive(f.sent.at(-1).requestId, unknown);
  assert.equal(quotaButton.dataset.state, 'unknown');
  assert.match(quotaButton.attrs['aria-label'], /不可用/);
  assert.equal(f.shadow.getElementById('quota-value').textContent, '—');
  assert.equal(f.shadow.getElementById('quota-fill').style.strokeDashoffset, '62.832');
  f.win.location.pathname = '/c/' + id; f.tick();
  const zero = quotaResult([{
    id: 'gemini-zero', displayName: 'Gemini 2.5 Pro', family: 'gemini',
    buckets: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: 0 }]
  }]);
  f.win.__easyagContext.receive(f.sent.at(-1).requestId, zero);
  assert.equal(quotaButton.dataset.state, 'live');
  assert.equal(f.shadow.getElementById('quota-value').textContent, '0');
  assert.match(quotaButton.attrs['aria-label'], /0%/);
  f.win.__easyagContext.dispose();
});

test('model usage ring shows a sub-percent exhausted quota as zero', () => {
  const f = fixture(); f.install();
  f.win.__easyagContext.receive(f.sent[0].requestId, quotaResult([{
    id: 'gemini-argon',
    displayName: 'Gemini 4 Argon',
    family: 'gemini',
    modelKeys: ['Gemini 4 Argon'],
    buckets: [{ id: 'weekly', displayName: 'Weekly limit', remainingFraction: .005 }]
  }]));
  const quotaButton = f.shadow.getElementById('quota-trigger');
  assert.equal(f.shadow.getElementById('quota-value').textContent, '0');
  assert.match(quotaButton.attrs['aria-label'], /0%/);
  assert.equal(f.shadow.getElementById('quota-fill').style.strokeDashoffset, '62.832');
  assert.match(allText(f.shadow.getElementById('quota-body')), /0% 剩余/);
  f.win.__easyagContext.dispose();
});

test('model usage refreshes every minute and after sending a message', () => {
  const f = fixture(); f.install();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, 'context-metrics');
  f.win.__easyagContext.receive(f.sent[0].requestId, quotaResult([]));

  f.advance(60000); f.tick();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent.at(-1).forceQuota, true);

  f.doc.events.keydown({ key: 'Enter', shiftKey: false, isComposing: false, target: f.editor });
  f.tick();
  f.win.__easyagContext.receive(f.sent[1].requestId, quotaResult([]));
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent.at(-1).forceQuota, true);
  f.win.__easyagContext.dispose();
});
