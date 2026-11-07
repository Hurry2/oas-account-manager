/* 卡片字段可见性自检：确认区服、勾协类型、复制按钮在两种视图里都在。
 * 用法：node check-card-fields.js
 *
 * 这是回归检查：曾经方块视图只把区服放在 hover 里、界面上看不到，
 * 用户反馈"卡片又不显示区服了"。这里直接渲染卡片并检查标签文本。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const failures = [];

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------- DOM stub
function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], dataset: {},
    // app.js 用 setProperty/removeProperty 切换 --grid-cols
    style: {
      _props: {},
      setProperty(n, v) { this._props[n] = String(v); this[n] = String(v); },
      removeProperty(n) { delete this._props[n]; delete this[n]; },
      getPropertyValue(n) { return this._props[n] || ''; },
    },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    append(...a) { a.forEach((c) => this.children.push(c)); },
    addEventListener() {}, removeEventListener() {},
    focus() {}, select() {}, scrollIntoView() {}, click() {},
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
  };
  el.textContent = ''; el.innerHTML = ''; el.value = '';
  el.disabled = false; el.checked = false; el.className = '';
  el.title = ''; el.draggable = false;
  return el;
}
const elements = {};
function getOrMake(id) {
  if (!elements[id]) {
    elements[id] = makeElement('div');
    elements[id].id = id;
    elements[id].selectedOptions = [];
    elements[id].options = [];
  }
  return elements[id];
}
const documentStub = {
  getElementById(id) { return getOrMake(id); },
  createElement(t) { return makeElement(t); },
  addEventListener() {}, body: makeElement('body'),
};
const windowStub = {
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] === undefined ? null : this._data[k]; },
    setItem(k, v) { this._data[k] = String(v); },
  },
  addEventListener() {},
  outerWidth: 1280, outerHeight: 860, screenX: 0, screenY: 0,
  AccountCore: require('./core.js'),
};

// ---------------------------------------------------------------- 执行
let src = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

// 把 IIFE 结尾替换成"探针 + 挂结果到 window"
const tail = '})();';
const idx = src.lastIndexOf(tail);
if (idx < 0) { console.error('找不到 app.js 的 IIFE 结尾'); process.exit(1); }

const probe = `
  var __card = Core.normalizeJadeCard({
    character: '银月二号', svr: '遥远之忆', account: 'a@b.com',
    apple_or_android: true, last_complete_time: '2026-10-29 08:00:00',
    jade_status: '普勾', jade_complete_time: '2026-10-29 09:00:00',
  });
  state.cards = [__card];
  state.jade = true;
  function __collect(el, out) {
    if (el.tagName === 'SPAN' || el.tagName === 'BUTTON') {
      out.push({ tag: el.tagName, text: String(el.textContent || '') });
    }
    (el.children || []).forEach(function (c) { __collect(c, out); });
  }
  var __result = {};
  [false, true].forEach(function (compact) {
    var el = buildCard(__card, 0, {}, compact, true, true);
    var out = [];
    __collect(el, out);
    __result[compact ? 'grid' : 'list'] = out;
  });
  window.__CARD_FIELDS__ = __result;
`;

src = src.slice(0, idx) + probe + '\n' + tail + src.slice(idx + tail.length);

const wrapper = new Function(
  'document', 'window', 'fetch', 'navigator', 'confirm', 'alert', 'localStorage',
  'URL', 'Blob', 'setTimeout', 'clearTimeout', 'setInterval', src
);
const globals = {
  document: documentStub, window: windowStub,
  fetch: () => new Promise(() => {}),
  navigator: { clipboard: null }, confirm: () => true, alert: () => {},
  localStorage: windowStub.localStorage,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function () {},
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
};
globals.globalThis = globals;

wrapper.call(globals, documentStub, windowStub, globals.fetch, globals.navigator,
  globals.confirm, globals.alert, windowStub.localStorage, globals.URL,
  globals.Blob, globals.setTimeout, globals.clearTimeout, globals.setInterval);

const result = windowStub.__CARD_FIELDS__;

// ---------------------------------------------------------------- 断言
['list', 'grid'].forEach(function (view) {
  const label = view === 'list' ? '列表视图' : '方块视图';
  const spans = result[view].filter((n) => n.tag === 'SPAN');
  const buttons = result[view].filter((n) => n.tag === 'BUTTON');
  const texts = spans.map((n) => n.text);
  const joined = texts.join('|');

  console.log(label + ':');
  check('  显示区服', texts.indexOf('遥远之忆') >= 0, '实际标签：' + joined);
  check('  显示角色名', texts.indexOf('银月二号') >= 0);
  check('  显示勾协类型', /勾协\s*普勾/.test(joined), joined);
  check('  显示协战状态', /协战/.test(joined));
  check('  有复制按钮 ⧉', buttons.some((b) => b.text.indexOf('⧉') >= 0));
  check('  有编辑按钮 ✎', buttons.some((b) => b.text.indexOf('✎') >= 0));
});

// ---------------------------------------------------------------- 勾协统计分组
// 用户要求：过期的勾协单独统计，不要算进其他统计里。
// 这是行为级断言，直接跑 Core.summarizeJade。
console.log('勾协统计（过期单独一组）:');
{
  const Core = require('./core.js');
  const now = new Date(2026, 9, 29, 18, 43);   // 18:43 -> 刷新点今天 18:00
  const cards = [
    { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-29 18:10:00' },
    { character: 'B', jade_status: '无勾', jade_complete_time: '2026-10-29 18:20:00' },
    { character: 'C', jade_status: '普勾', jade_complete_time: '2026-10-29 15:00:00' },
    { character: 'D', jade_status: '现勾', jade_complete_time: '2026-10-28 16:00:00' },
    { character: 'E', jade_status: 'none', jade_complete_time: '2023-01-01 00:00:00' },
  ];
  const s = Core.summarizeJade(cards, now);
  check('  过期的普勾不算进 fresh 普勾',
    s.fresh['普勾'] === 1 && s.stale['普勾'] === 1,
    'fresh=' + JSON.stringify(s.fresh) + ' stale=' + JSON.stringify(s.stale));
  check('  过期合计独立', s.staleTotal === 2, '实际 ' + s.staleTotal);
  check('  本周期合计独立', s.freshTotal === 2, '实际 ' + s.freshTotal);
  check('  从未查找单独计', s.none === 1);
  check('  有效卡总数', s.total === 5);

  const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  check('  概览用 summarizeJade（不是按 kind 全量累加）',
    /Core\.summarizeJade\(/.test(appSrc));
  check('  概览有「勾协已过期」独立项',
    /勾协已过期/.test(appSrc));
}

// ---------------------------------------------------------------- row2 竖排
// 用户反馈"协战时间和区服有概率显示不完全"，根因是 row2 横排 + 压缩。
// 这里校验 CSS：row2 必须是 column 方向，且不能有 nowrap/固定宽度截断。
console.log('row2 布局（每个数据项独占一行）:');
{
  const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');

  // 列表视图的 .card .row2
  const listRow2 = css.match(/\.card\s+\.row2\s*\{([^}]*)\}/);
  check('列表 row2 存在', !!listRow2);
  if (listRow2) {
    const body = listRow2[1];
    check('  列表 row2 为竖排（flex-direction: column）',
      /flex-direction:\s*column/.test(body), body.replace(/\s+/g, ' ').trim());
    check('  列表 row2 不换行回横排（无 flex-wrap: wrap）',
      !/flex-wrap:\s*wrap/.test(body));
  }

  // 方块视图的 compact row2
  const gridRow2 = css.match(
    /#list\.grid-view\s+\.card\.compact\s+\.row2\s*\{([^}]*)\}/
  );
  check('方块 row2 存在', !!gridRow2);
  if (gridRow2) {
    const body = gridRow2[1];
    check('  方块 row2 为竖排（flex-direction: column）',
      /flex-direction:\s*column/.test(body), body.replace(/\s+/g, ' ').trim());
    check('  方块 row2 不强制单行（无 flex-wrap: nowrap）',
      !/flex-wrap:\s*nowrap/.test(body));
    check('  方块 row2 不裁剪溢出（无 overflow: hidden）',
      !/overflow:\s*hidden/.test(body));
  }

  // 区服标签不能有固定小宽度（曾限 72px 导致显示不全）
  const svrRule = css.match(
    /#list\.grid-view\s+\.card\.compact\s+\.row2\s+\.tag\.svr\s*\{([^}]*)\}/
  );
  check('区服标签有独立样式', !!svrRule);
  if (svrRule) {
    check('  区服不被固定窄宽截断（无 max-width: 72px 之类）',
      !/max-width:\s*[1-9]\d{0,2}px/.test(svrRule[1]),
      svrRule[1].replace(/\s+/g, ' ').trim());
  }
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
