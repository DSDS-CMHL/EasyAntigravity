/*
 * 汉化与双向还原回归测试
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dictDir = path.join(__dirname, '..', 'dicts');
const translationDict = {};
const files = ['ui_v2.json', 'common.json'];
files.forEach(f => {
  const fullPath = path.join(dictDir, f);
  if (fs.existsSync(fullPath)) {
    Object.assign(translationDict, JSON.parse(fs.readFileSync(fullPath, 'utf-8')));
  }
});

const reverseDict = {};
for (const [en, zh] of Object.entries(translationDict)) {
  if (typeof zh === 'string' && zh.trim() && !reverseDict[zh.trim()]) {
    reverseDict[zh.trim()] = en.trim();
  }
}

assert.ok(Object.keys(translationDict).length > 3000, '词典应载入超过3000条');
assert.ok(Object.keys(reverseDict).length > 2500, '反向词典应有效建立');

// 简单 DOM 模拟
class MockNode {
  constructor(nodeValue) {
    this.nodeType = 3; // TEXT_NODE
    this.nodeValue = nodeValue;
    this.parentElement = null;
  }
}

class MockElement {
  constructor(tagName = 'DIV', attrs = {}) {
    this.nodeType = 1; // ELEMENT_NODE
    this.tagName = tagName;
    this.attributes = { ...attrs };
    this.children = [];
    this.parentElement = null;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  querySelectorAll(sel) {
    const res = [];
    const walk = (el) => {
      if (sel.includes('[placeholder]') && el.attributes.placeholder !== undefined) res.push(el);
      else if (sel.includes('[data-ea-orig-placeholder]') && el.attributes['data-ea-orig-placeholder'] !== undefined) res.push(el);
      for (const child of el.children) {
        if (child.nodeType === 1) walk(child);
      }
    };
    walk(this);
    return res;
  }
}

// 模拟 translateDOM 和 revertDOM
function simulateTranslate(textNode, dict) {
  const text = textNode.nodeValue.trim();
  if (dict[text]) {
    if (textNode.__ea_translated !== textNode.nodeValue) {
      textNode.__ea_orig = textNode.nodeValue;
    }
    textNode.nodeValue = textNode.nodeValue.replace(text, dict[text]);
    textNode.__ea_translated = textNode.nodeValue;
  }
}

function simulateRevert(textNode, revDict) {
  if (textNode.__ea_orig !== undefined) {
    textNode.nodeValue = textNode.__ea_orig;
    delete textNode.__ea_orig;
    delete textNode.__ea_translated;
    return;
  }
  const text = textNode.nodeValue.trim();
  if (text && revDict && revDict[text]) {
    textNode.nodeValue = textNode.nodeValue.replace(text, revDict[text]);
    delete textNode.__ea_translated;
  }
}

// 1. 验证常规文本翻译与精确还原
const node1 = new MockNode('  About  ');
simulateTranslate(node1, translationDict);
assert.equal(node1.nodeValue, '  关于  ', '应该翻译为关于');
assert.equal(node1.__ea_orig, '  About  ', '应该保留原始英文');

simulateRevert(node1, reverseDict);
assert.equal(node1.nodeValue, '  About  ', '取消汉化后必须精确还原为 About 包含空格');
assert.equal(node1.__ea_orig, undefined, '还原后应清理 orig 标识');

// 2. 验证多轮开关切换的稳定性
for (let i = 0; i < 5; i++) {
  simulateTranslate(node1, translationDict);
  assert.equal(node1.nodeValue, '  关于  ');
  simulateRevert(node1, reverseDict);
  assert.equal(node1.nodeValue, '  About  ');
}

// 3. 验证无 orig 标识时的反向字典兜底还原
const node2 = new MockNode('关于');
simulateRevert(node2, reverseDict);
assert.equal(node2.nodeValue, 'About', '反向词典兜底应正确还原');

// 4. 验证属性翻译与还原
const el = new MockElement('INPUT', { placeholder: 'Search...' });
if (translationDict['Search...']) {
  el.setAttribute('data-ea-orig-placeholder', el.getAttribute('placeholder'));
  el.setAttribute('placeholder', translationDict['Search...']);
}
assert.notEqual(el.getAttribute('placeholder'), 'Search...');
// 还原属性
const orig = el.getAttribute('data-ea-orig-placeholder');
el.setAttribute('placeholder', orig);
el.removeAttribute('data-ea-orig-placeholder');
assert.equal(el.getAttribute('placeholder'), 'Search...', '属性应完整还原');
assert.equal(el.hasAttribute('data-ea-orig-placeholder'), false);

console.log('PASS: 汉化双向注入与还原测试通过！');
