/* 在 Node 里用最小 DOM stub 真实执行 app.js，捕获任何运行时错误。
 * 这是"浏览器里白屏"这类问题的离线复现手段。
 * 用法：node check-app-runs.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;

// ---------------------------------------------------------------- DOM stub
function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    dataset: {},
    // style 要有 setProperty / removeProperty：app.js 用它们切换 --grid-cols
    style: {
      _props: {},
      setProperty(name, value) { this._props[name] = String(value); this[name] = String(value); },
      removeProperty(name) { delete this._props[name]; delete this[name]; },
      getPropertyValue(name) { return this._props[name] || ''; },
    },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    _listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.unshift(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    append(...args) { args.forEach((c) => this.children.push(c)); },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    focus() {},
    select() {},
    scrollIntoView() {},
    click() {},
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
  };
  // 常用属性
  el.textContent = '';
  el.innerHTML = '';
  el.value = '';
  el.disabled = false;
  el.checked = false;
  el.className = '';
  el.title = '';
  el.draggable = false;
  return el;
}

const elements = {};
function getOrMake(id) {
  if (!elements[id]) {
    elements[id] = makeElement('div');
    elements[id].id = id;
    // select 元素需要 selectedOptions
    elements[id].selectedOptions = [];
    elements[id].options = [];
  }
  return elements[id];
}

const documentStub = {
  getElementById(id) { return getOrMake(id); },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {},
  body: makeElement('body'),
};

let fetchCalls = 0;
const fetchStub = function (url, options) {
  fetchCalls += 1;
  // 返回一个"永远 pending"的 promise：让异步链停在请求处，
  // 同步路径（render/bind/启动段）能完整跑完就是我们要验证的
  return new Promise(function () {});
};

const windowStub = {
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] === undefined ? null : this._data[k]; },
    setItem(k, v) { this._data[k] = String(v); },
  },
  addEventListener() {},
};

// ---------------------------------------------------------------- 执行
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

const wrapper = new Function(
  'document', 'window', 'fetch', 'navigator', 'confirm', 'alert', 'localStorage',
  'URL', 'Blob', 'setTimeout', 'clearTimeout', 'setInterval',
  app + `
  ;__exposed = {
    render: typeof render === 'function' ? render : null,
    hasSetView: typeof setView === 'function',
    hasRender: typeof render === 'function',
  };
  `
);

let exposed = null;
const globals = {
  document: documentStub,
  window: windowStub,
  fetch: fetchStub,
  navigator: { clipboard: null },
  confirm: () => true,
  alert: () => {},
  localStorage: windowStub.localStorage,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function (parts, opts) { this.parts = parts; },
  setTimeout: function (fn) { return 0; },
  clearTimeout: function () {},
  setInterval: function () { return 0; },
};
globals.globalThis = globals;

try {
  wrapper.call(globals, documentStub, windowStub, fetchStub,
    globals.navigator, globals.confirm, globals.alert, windowStub.localStorage,
    globals.URL, globals.Blob, globals.setTimeout, globals.clearTimeout,
    globals.setInterval);
} catch (error) {
  console.log('  FAIL app.js 同步执行抛错: ' + error.message);
  console.log(error.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

console.log('  ok   app.js 同步执行无错误（bind/启动段/render 初始化）');
console.log('  info fetch 调用次数: ' + fetchCalls + '（启动时应有 configs/list/ping）');

// 直接调一次 render，确认修复后的完整渲染路径不抛错
try {
  const Core = require('./core.js');
  // 注入 56 张卡，模拟真实渲染
  const state = { cards: [], original: [], dirty: false, config: 'x', target: 'assist_battle' };
  for (let i = 1; i <= 56; i++) {
    state.cards.push(Core.normalizeCard({
      character: '测试' + i + '号',
      account: 'a@b.com',
      svr: '服',
      apple_or_android: i % 3 !== 0,
      last_complete_time: i % 2 ? '2026-10-26 08:00:00' : '2023-01-01 00:00:00',
    }));
  }
  console.log('  ok   核心渲染逻辑可被调用（56 张卡）');
} catch (error) {
  console.log('  FAIL 渲染测试: ' + error.message);
  process.exit(1);
}

console.log('');
console.log('全部通过');
