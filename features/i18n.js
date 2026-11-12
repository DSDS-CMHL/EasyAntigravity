const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('../core/storage');

const DICT_FILES = ['ui_v2.json', 'common.json'];

function sanitizeEntries(source) {
  const clean = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return clean;
  for (const [key, value] of Object.entries(source)) {
    if (typeof key === 'string' && typeof value === 'string' && key.length <= 2000 && value.length <= 2000) {
      clean[key] = value;
    }
  }
  return clean;
}

function loadDictionary(rootDir, dataDir) {
  const dictionary = {};
  for (const name of DICT_FILES) {
    const file = path.join(rootDir, 'dicts', name);
    if (fs.existsSync(file)) Object.assign(dictionary, sanitizeEntries(readJson(file, {})));
  }
  if (dataDir) {
    for (const name of DICT_FILES) {
      const hotfixFile = path.join(dataDir, 'hotfix', 'dicts', name);
      if (fs.existsSync(hotfixFile)) {
        try {
          Object.assign(dictionary, sanitizeEntries(readJson(hotfixFile, {})));
        } catch { /* Corrupted hotfix dictionary must never break bundled startup. */ }
      }
    }
  }
  return dictionary;
}

// This function also runs inside the AG renderer; keep it independent of Node and module globals.
function installI18n(window, document, dictionary, enabled) {
  window.__easyagI18n?.dispose();
  const texts = new Map();
  const attributes = new Map();
  const ignored = 'script,style,pre,code,textarea,[contenteditable="true"],[data-testid*="message-content"]';
  const ignoredElement = element => element?.closest?.(ignored);
  function lookup(key) {
    if (typeof dictionary[key] === 'string') return dictionary[key];
    // Only match known UI counters; never substitute arbitrary message text.
    const count = key.match(/^(\d+) active conversations$/);
    if (count && dictionary['{count} active conversations']) {
      return dictionary['{count} active conversations'].replace('{count}', count[1]);
    }
    const quota = key.match(/^(You have used some of your (?:weekly|5-hour) limit, it will fully refresh in )(.+)\.$/);
    if (!quota) return null;
    const template = dictionary[quota[1] + '{time}.'];
    if (!template || !/^\d+ (?:days?|hours?|minutes?|seconds?)(?:, \d+ (?:days?|hours?|minutes?|seconds?))*$/.test(quota[2])) return null;
    const parts = quota[2].split(', ').map(part => {
      const [, number, unit] = part.match(/^(\d+) (\w+)$/);
      return dictionary['{count} ' + unit]?.replace('{count}', number);
    });
    return parts.every(Boolean) ? template.replace('{time}', parts.join('、')) : null;
  }
  function translateText(node) {
    if (ignoredElement(node.parentElement)) return;
    const raw = node.nodeValue;
    if (texts.get(node)?.translated === raw) return;
    const key = raw?.trim();
    const value = key && lookup(key);
    if (!value || value === key) return;
    const translated = raw.replace(key, value);
    texts.set(node, { original: raw, translated });
    node.nodeValue = translated;
  }
  function translateElement(element) {
    if (ignoredElement(element)) return;
    for (const name of ['placeholder', 'title', 'aria-label']) {
      const original = element.getAttribute(name);
      if (attributes.get(element)?.get(name)?.translated === original) continue;
      const key = original?.trim();
      const value = key && lookup(key);
      if (!value || value === key) continue;
      const translated = original.replace(key, value);
      if (!attributes.has(element)) attributes.set(element, new Map());
      attributes.get(element).set(name, { original, translated });
      element.setAttribute(name, translated);
    }
  }
  function translate(root) {
    if (!enabled || !root) return;
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) translateElement(root);
    for (const element of root.querySelectorAll('[placeholder],[title],[aria-label]')) translateElement(element);
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateText(walker.currentNode);
  }
  const observer = new window.MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') for (const node of mutation.addedNodes) translate(node);
      if (mutation.type === 'characterData') translateText(mutation.target);
      if (mutation.type === 'attributes') translateElement(mutation.target);
    }
    // Removed conversation nodes should not remain retained throughout long sessions.
    for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
    for (const element of attributes.keys()) if (!element.isConnected) attributes.delete(element);
  });
  const runtime = {
    dispose() {
      observer.disconnect();
      for (const [node, record] of texts) {
        if (node.nodeValue === record.translated) node.nodeValue = record.original;
      }
      for (const [element, records] of attributes) {
        for (const [name, record] of records) {
          if (element.getAttribute(name) === record.translated) element.setAttribute(name, record.original);
        }
      }
      texts.clear();
      attributes.clear();
      if (window.__easyagI18n === runtime) delete window.__easyagI18n;
    }
  };
  window.__easyagI18n = runtime;
  if (enabled) {
    translate(document.body || document.documentElement);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  }
  return runtime;
}

module.exports = { DICT_FILES, loadDictionary, installI18n };
