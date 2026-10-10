const assert = require('node:assert/strict');
const { loadDictionary, installI18n } = require('../features/i18n');
const path = require('node:path');
const dictionary = loadDictionary(path.resolve(__dirname, '..'));
assert.ok(Object.keys(dictionary).length > 3000);

// Exercise the renderer function shipped by CDP, rather than a second implementation.
const callbacks = [];
class Observer {
  constructor(callback) { this.callback = callback; callbacks.push(this); }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
}
class Element {
  constructor(attributes = {}, ignored = false) {
    this.nodeType = 1;
    this.attributes = { ...attributes };
    this.isConnected = true;
    this.ignored = ignored;
  }
  closest() { return this.ignored ? this : null; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const text = (value, parent) => ({ nodeType: 3, nodeValue: value, parentElement: parent, isConnected: true });
const body = new Element();
const input = new Element({ placeholder: 'Search...' });
const code = new Element({}, true);
const nodes = [text('  About  ', body), text('About', code), text('用户自己的中文', body)];
body.querySelectorAll = () => [input];
const document = {
  body, documentElement: body,
  createTreeWalker() {
    let index = -1;
    return { nextNode() { index++; return index < nodes.length; }, get currentNode() { return nodes[index]; } };
  }
};
const window = { MutationObserver: Observer, NodeFilter: { SHOW_TEXT: 4 } };

for (let index = 0; index < 5; index++) {
  installI18n(window, document, dictionary, true);
  assert.equal(nodes[0].nodeValue, '  关于  ');
  assert.equal(nodes[1].nodeValue, 'About', 'Code and editable content must not be translated');
  assert.equal(input.getAttribute('placeholder'), dictionary['Search...']);
  installI18n(window, document, dictionary, false);
  assert.equal(nodes[0].nodeValue, '  About  ', 'Original whitespace must survive repeated toggles');
  assert.equal(input.getAttribute('placeholder'), 'Search...');
  assert.equal(nodes[2].nodeValue, '用户自己的中文');
  assert.equal(callbacks.filter(observer => observer.active).length, 0);
}

installI18n(window, document, dictionary, true);
nodes[0].nodeValue = 'host changed this text';
input.setAttribute('placeholder', 'host changed this placeholder');
installI18n(window, document, dictionary, false);
assert.equal(nodes[0].nodeValue, 'host changed this text');
assert.equal(input.getAttribute('placeholder'), 'host changed this placeholder');

nodes[0].nodeValue = 'About';
installI18n(window, document, dictionary, true);
nodes[0].nodeValue = 'Search...';
callbacks.at(-1).callback([{ type: 'characterData', target: nodes[0] }]);
assert.equal(nodes[0].nodeValue, dictionary['Search...']);
window.__easyagI18n.dispose();
assert.equal(nodes[0].nodeValue, 'Search...', 'Restore the latest host text after dynamic changes');

const vm = require('node:vm');
const { rendererSource, disposeSource } = require('../adapters/desktop/renderer');
const mounts = [];
const frameWindow = { MutationObserver: Observer, NodeFilter: { SHOW_TEXT: 4 } };
frameWindow.top = frameWindow;
const frameDocument = { ...document, readyState: 'loading', addEventListener(name, callback) { mounts.push(callback); } };
const context = { window: frameWindow, document: frameDocument, clearTimeout };
nodes[0].nodeValue = 'About';
vm.runInNewContext(rendererSource({ About: '关于' }, { enableI18n: true, riskAdvisor: false }, 'testBinding'), context);
assert.equal(nodes[0].nodeValue, 'About', 'Preloads must wait for the DOM');
vm.runInNewContext(rendererSource({ About: '关于' }, { enableI18n: false, riskAdvisor: false }, 'testBinding'), context);
for (const mount of mounts) mount();
assert.equal(nodes[0].nodeValue, 'About', 'An older delayed mount must not overwrite newer settings');
frameDocument.readyState = 'complete';
vm.runInNewContext(rendererSource({ About: '关于' }, { enableI18n: true, riskAdvisor: false }, 'testBinding'), context);
assert.equal(nodes[0].nodeValue, '关于');
vm.runInNewContext(disposeSource, context);
assert.equal(nodes[0].nodeValue, 'About');
console.log('PASS: actual i18n renderer — toggles, attributes, editable/code exclusion and host changes');
