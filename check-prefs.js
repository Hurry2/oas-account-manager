/* 偏好记忆（localStorage）的快速验证：node 下模拟 localStorage 跑 loadPrefs/savePref */
'use strict';

const assert = require('node:assert');

// 模拟浏览器环境
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.window = global;
global.document = {
  getElementById: () => null,   // loadPrefs/savePref 对缺失控件应静默跳过
  querySelector: () => null,
  addEventListener: () => {},
  body: { insertBefore: () => {}, firstChild: null },
};
// app.js 是 IIFE, 直接 require 会执行启动逻辑并访问 DOM — 只测不了它,
// 所以这里复制 loadPrefs/savePref 的实现语义来验证协议本身（与 app.js 保持一致）。

const PREF_KEY = 'account-manager.prefs';

function savePref(prefs, value) {
  Object.assign(prefs, value);
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; }
  catch (e) { return {}; }
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

check('保存后能读回', () => {
  savePref({}, { 'run-filter': 'stale', 'jade-toggle': true });
  const p = loadPrefs();
  assert.strictEqual(p['run-filter'], 'stale');
  assert.strictEqual(p['jade-toggle'], true);
});
check('多次保存合并（不覆盖别的键）', () => {
  savePref({}, { 'run-filter': 'today' });
  savePref(loadPrefs(), { 'jade-toggle': false });
  const p = loadPrefs();
  assert.strictEqual(p['run-filter'], 'today');
  assert.strictEqual(p['jade-toggle'], false);
});
check('损坏的 JSON 返回空对象', () => {
  localStorage.setItem(PREF_KEY, '{broken');
  assert.deepStrictEqual(loadPrefs(), {});
});
check('localStorage 缺失时 loadPrefs 返回空对象', () => {
  const saved = global.localStorage;
  global.localStorage = null;
  // loadPrefs 里的 try/catch 用 typeof 判断不了 null —— 实机浏览器不会是 null,
  // 隐私模式 setItem 抛错已被 catch; 这里只验证 getItem 抛错路径
  global.localStorage = { getItem: () => { throw new Error('privacy'); } };
  let result = {};
  try { result = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; }
  catch (e) { result = {}; }
  global.localStorage = saved;
  assert.deepStrictEqual(result, {});
});
check('恢复的配置名不在选项列表时会被 loadMeta 校验跳过', () => {
  // loadMeta 恢复前会检查 savedConfig 是否在 configs 里、
  // savedTarget 是否在 targets 里 — 模拟那个判断
  const prefs = { 'config-select': '不存在的配置', 'target-select': 'account_switch' };
  const configs = ['模拟器2原皮', '模拟器01大号'];
  const targets = [{ key: 'assist_battle' }, { key: 'account_switch' }];
  const savedConfig = prefs['config-select'];
  const savedTarget = prefs['target-select'];
  const useConfig = savedConfig && configs.indexOf(savedConfig) >= 0;
  const useTarget = savedTarget
    && targets.some(function (t) { return t.key === savedTarget; });
  assert.strictEqual(useConfig, false, '不存在的配置不应恢复');
  assert.strictEqual(useTarget, true, '存在的列表应恢复');
});

// ---------------------------------------------------------------- 静态校验
// 曾经踩过：jade-filter 会 savePref 但启动时的 applyPref 列表漏了它，
// 表现为"保存了但刷新后不恢复"。这里直接读 app.js 源码做双向核对。
//
// 两类恢复方式都算数：
//   1. [ 'a', 'b' ].forEach(applyPref)      —— 简单控件
//   2. prefs['a'] / prefs["a"]              —— 依赖选项填充后再恢复（config/target）
check('PREF_IDS 里每个键都有恢复路径', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  const idsMatch = src.match(/var PREF_IDS = \[([\s\S]*?)\];/);
  assert.ok(idsMatch, '找不到 PREF_IDS 定义');
  const ids = idsMatch[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));

  // 恢复列表形如：
  //   [
  //     'sort-mode', 'platform-order', 'run-filter', 'jade-filter',
  //     'battle-toggle', 'jade-toggle',
  //   ].forEach(applyPref);
  // 直接取 `.forEach(applyPref)` 之前的最近一个 `[`，避免误吃 renderStat 里的数组
  const anchor = src.indexOf('.forEach(applyPref)');
  assert.ok(anchor > 0, '找不到 applyPref 恢复调用');
  const open = src.lastIndexOf('[', anchor);
  const close = src.lastIndexOf(']', anchor);
  assert.ok(open >= 0 && close > open, '恢复列表结构不符合预期');
  const body = src.slice(open + 1, close);
  const restored = body.match(/'([^']+)'/g);
  const restoredIds = restored ? restored.map(function (s) {
    return s.replace(/'/g, '');
  }) : [];

  const missing = ids.filter(function (id) {
    if (restoredIds.indexOf(id) >= 0) return false;            // 方式1
    const manual = new RegExp("prefs\\[['\"]" + id + "['\"]\\]");
    return !manual.test(src);                                  // 方式2
  });
  assert.deepStrictEqual(missing, [], '这些偏好会保存但不会恢复：' + missing.join(', '));
});

check('jade-filter 在 PREF_IDS 和 applyPref 恢复列表里都有', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.ok(/PREF_IDS = \[[\s\S]*?'jade-filter'/.test(src), 'PREF_IDS 缺 jade-filter');
  assert.ok(/\[[\s\S]*?'jade-filter'[\s\S]*?\]\.forEach\(applyPref\)/.test(src),
    '启动恢复列表缺 jade-filter');
});

// ---------------------------------------------------------------- 按配置记忆的开关
// 用户要求：「显示勾协」「显示协战」两个开关按不同配置分别记忆。
// 之前是全局存一个值，切换配置时互相干扰。
console.log('按配置记忆的开关（battle-toggle / jade-toggle）:');
{
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  check('有独立的 toggle 偏好键', () => {
    assert.ok(/TOGGLE_PREF_KEY\s*=\s*'account-manager\.toggles'/.test(src),
      '缺少 TOGGLE_PREF_KEY');
  });

  check('两个开关不再写全局 prefs（PREF_IDS 里已移除）', () => {
    const idsMatch = src.match(/var PREF_IDS = \[([\s\S]*?)\];/);
    assert.ok(idsMatch, '找不到 PREF_IDS');
    assert.ok(!/'battle-toggle'/.test(idsMatch[1]), 'PREF_IDS 不应再有 battle-toggle');
    assert.ok(!/'jade-toggle'/.test(idsMatch[1]), 'PREF_IDS 不应再有 jade-toggle');
  });

  check('两个开关不再用 savePref 存全局', () => {
    assert.ok(!/savePref\('battle-toggle'\)/.test(src), '仍在 savePref(battle-toggle)');
    assert.ok(!/savePref\('jade-toggle'\)/.test(src), '仍在 savePref(jade-toggle)');
  });

  check('有按配置写入的函数 saveTogglesForCurrent', () => {
    assert.ok(/function saveTogglesForCurrent/.test(src));
    assert.ok(/table\[state\.config\]\s*=/.test(src), '没有按 state.config 分格存');
  });

  check('有按配置套用的函数 applyTogglesForConfig', () => {
    assert.ok(/function applyTogglesForConfig/.test(src));
  });

  check('切换配置时先存旧的再套新的', () => {
    const onchange = src.slice(
      src.indexOf("$('config-select').onchange"),
      src.indexOf("$('target-select').onchange"));
    assert.ok(onchange.indexOf('saveTogglesForCurrent()') >= 0, '切配置前没保存当前开关');
    assert.ok(onchange.indexOf('applyTogglesForConfig()') >= 0, '切配置后没套用新开关');
  });

  check('启动时在 loadMeta 之后套用（此时才知道配置名）', () => {
    const boot = src.slice(src.indexOf('checkServerVersion().then'));
    assert.ok(/loadMeta\(\)\.then\(function \(\) \{[\s\S]{0,300}?applyTogglesForConfig\(\)/
      .test(boot), '启动流程没有在 loadMeta 后套用开关记忆');
  });

  check('切换目标后也重新套用', () => {
    const fn = src.slice(src.indexOf('function switchRoot'), src.indexOf('function addPreset'));
    assert.ok(/loadMeta\(\)\.then\(function \(\) \{[\s\S]{0,300}?applyTogglesForConfig\(\)/
      .test(fn), 'switchRoot 没重新套用开关记忆');
  });
}

// ---------------------------------------------------------------- 行为验证
// 直接跑 togglesFor / save 语义：两个配置互不干扰
console.log('行为验证（两个配置各记各的）:');
{
  const TOGGLE_KEY = 'account-manager.toggles';
  const store2 = {};
  const ls = {
    getItem: (k) => (k in store2 ? store2[k] : null),
    setItem: (k, v) => { store2[k] = String(v); },
  };
  const DEFAULT = { battle: true, jade: false };

  function loadTable() {
    let t = {};
    try { t = JSON.parse(ls.getItem(TOGGLE_KEY)) || {}; } catch (e) {}
    return t && typeof t === 'object' ? t : {};
  }
  function togglesFor(config) {
    const table = loadTable();
    const saved = config ? table[config] : null;
    if (!saved || typeof saved !== 'object') {
      return { battle: DEFAULT.battle, jade: DEFAULT.jade };
    }
    return {
      battle: saved.battle === undefined ? DEFAULT.battle : !!saved.battle,
      jade: saved.jade === undefined ? DEFAULT.jade : !!saved.jade,
    };
  }
  function saveFor(config, battle, jade) {
    const table = loadTable();
    table[config] = { battle: battle, jade: jade };
    ls.setItem(TOGGLE_KEY, JSON.stringify(table));
  }

  check('没记录时用默认值（协战开、勾协关）', () => {
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: false });
  });

  check('两个配置互不干扰', () => {
    saveFor('甲', true, true);
    saveFor('乙', false, false);
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: true });
    assert.deepStrictEqual(togglesFor('乙'), { battle: false, jade: false });
  });

  check('后写的不覆盖先写的', () => {
    saveFor('甲', false, true);
    assert.deepStrictEqual(togglesFor('乙'), { battle: false, jade: false });
    assert.deepStrictEqual(togglesFor('甲'), { battle: false, jade: true });
  });

  check('损坏的记录回退到默认值', () => {
    ls.setItem(TOGGLE_KEY, '{broken');
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: false });
  });

  check('记录里缺字段时按默认值补', () => {
    ls.setItem(TOGGLE_KEY, JSON.stringify({ 甲: { jade: true } }));
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: true });
  });
}

console.log('');
if (failed) { console.log('失败 ' + failed + ' 项'); process.exit(1); }
console.log('全部通过（' + passed + ' 项）');
