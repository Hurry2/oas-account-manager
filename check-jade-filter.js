/* 勾协筛选口径 + 按配置记忆开关：行为级自检（不需要浏览器）
 * 用法：node check-jade-filter.js
 *
 * 覆盖两个用户需求（2026-10-31）：
 *   1. 「显示协战」「显示勾协」按不同配置分别记忆（切配置不互相干扰）
 *   2. 勾协类型筛选只算本周期已确认的结果，过期的不进「无勾/普勾/现勾」
 *
 * 这里只测纯逻辑（core.js + 偏好协议），浏览器里的真实交互由
 * 手工/端到端脚本验证；静态部分在 check-prefs.js 里另有断言。
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('./core.js');

const failures = [];
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push(name);
    console.log('  FAIL ' + name + ' -> ' + e.message);
  }
}

// ---------------------------------------------------------------- 筛选口径
console.log('勾协筛选：过期的不进任何类型:');
{
  const NOW = new Date(2026, 9, 31, 20, 0);   // 20:00 → 刷新点 18:00
  const cards = {
    freshPu: { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-31 19:10:00' },
    freshXian: { character: 'B', jade_status: '现勾', jade_complete_time: '2026-10-31 19:20:00' },
    freshWu: { character: 'C', jade_status: '无勾', jade_complete_time: '2026-10-31 19:30:00' },
    stalePu: { character: 'D', jade_status: '普勾', jade_complete_time: '2026-10-31 15:00:00' },
    staleXian: { character: 'E', jade_status: '现勾', jade_complete_time: '2026-10-31 16:00:00' },
    staleWu: { character: 'F', jade_status: '无勾', jade_complete_time: '2026-10-30 10:00:00' },
    never: { character: 'G', jade_status: 'none', jade_complete_time: '2023-01-01 00:00:00' },
  };

  check('普勾只匹配本周期确认的普勾', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.freshPu, '普勾', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.stalePu, '普勾', NOW), false,
      '过期的普勾不能进「普勾」');
  });

  check('现勾只匹配本周期确认的现勾', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.freshXian, '现勾', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.staleXian, '现勾', NOW), false,
      '过期的现勾不能进「现勾」');
  });

  check('无勾也只匹配本周期确认的（口径统一）', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.freshWu, '无勾', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.staleWu, '无勾', NOW), false,
      '过期的无勾不能进「无勾」');
  });

  check('类型之间不串（普勾不会被现勾筛出来）', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.freshPu, '现勾', NOW), false);
    assert.strictEqual(Core.matchesJadeFilter(cards.freshXian, '普勾', NOW), false);
  });

  check('「从未查找」只看查没查过，不看周期', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.never, 'none', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.stalePu, 'none', NOW), false);
    assert.strictEqual(Core.matchesJadeFilter(cards.freshPu, 'none', NOW), false);
  });

  check('「全部」放行一切（含过期的）', () => {
    Object.keys(cards).forEach((k) => {
      assert.strictEqual(Core.matchesJadeFilter(cards[k], 'all', NOW), true, k);
    });
  });

  check('「勾协已过期」只捞过期的（不分类型）', () => {
    assert.strictEqual(Core.matchesJadeFilter(cards.stalePu, 'stale', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.staleXian, 'stale', NOW), true);
    assert.strictEqual(Core.matchesJadeFilter(cards.staleWu, 'stale', NOW), true);
    // 新鲜的不该进来
    assert.strictEqual(Core.matchesJadeFilter(cards.freshPu, 'stale', NOW), false);
    assert.strictEqual(Core.matchesJadeFilter(cards.freshXian, 'stale', NOW), false);
    assert.strictEqual(Core.matchesJadeFilter(cards.freshWu, 'stale', NOW), false);
    // 从未查找的也不算过期
    assert.strictEqual(Core.matchesJadeFilter(cards.never, 'stale', NOW), false);
  });

  check('「勾协已过期」数量 == 概览 staleTotal', () => {
    const list = Object.keys(cards).map((k) => cards[k]);
    const s = Core.summarizeJade(list, NOW);
    const n = list.filter((c) => Core.matchesJadeFilter(c, 'stale', NOW)).length;
    assert.strictEqual(n, s.staleTotal,
      '筛选 ' + n + ' 个，概览 staleTotal ' + s.staleTotal + ' 个');
    assert.strictEqual(n, 3, '本例应有 3 个过期卡');
  });

  check('JADE_STALE 常量导出且值为 stale', () => {
    assert.strictEqual(Core.JADE_STALE, 'stale');
  });

  // 口径必须和概览统计一致：类型筛选的数量 == fresh 分布
  check('筛选数量与概览 fresh 统计一致', () => {
    const list = Object.keys(cards).map((k) => cards[k]);
    const s = Core.summarizeJade(list, NOW);
    ['无勾', '普勾', '现勾'].forEach((kind) => {
      const n = list.filter((c) => Core.matchesJadeFilter(c, kind, NOW)).length;
      assert.strictEqual(n, s.fresh[kind],
        kind + ' 筛选 ' + n + ' 个，概览 fresh ' + s.fresh[kind] + ' 个');
    });
  });

  check('四类筛选项互不重叠、合起来正好等于全部', () => {
    const list = Object.keys(cards).map((k) => cards[k]);
    const all = list.filter((c) => Core.matchesJadeFilter(c, 'all', NOW)).length;
    const buckets = ['无勾', '普勾', '现勾', 'stale', 'none']
      .map((k) => list.filter((c) => Core.matchesJadeFilter(c, k, NOW)));
    // 每张卡最多落进一个类型/状态桶
    list.forEach((c) => {
      const hits = buckets.filter((b) => b.indexOf(c) >= 0).length;
      assert.ok(hits <= 1, c.character + ' 同时命中 ' + hits + ' 个筛选项');
    });
    const sum = buckets.reduce((s, b) => s + b.length, 0);
    assert.strictEqual(sum, all, '各筛选项合计数 ' + sum + ' != 全部 ' + all);
  });

  check('过期卡仍能在「全部」里看到（只是不进类型）', () => {
    const list = Object.keys(cards).map((k) => cards[k]);
    const all = list.filter((c) => Core.matchesJadeFilter(c, 'all', NOW)).length;
    const inTypes = ['无勾', '普勾', '现勾', 'none']
      .reduce((sum, k) => sum + list.filter((c) => Core.matchesJadeFilter(c, k, NOW)).length, 0);
    assert.strictEqual(all, 7);
    assert.ok(inTypes < all, '类型筛选合计数应小于全部（差的就是过期卡）');
  });
}

// ---------------------------------------------------------------- 按配置记忆
console.log('按配置记忆开关（协议层）:');
{
  const KEY = 'account-manager.toggles';
  const store = {};
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const DEFAULT = { battle: true, jade: false };

  function loadTable() {
    let t = {};
    try { t = JSON.parse(ls.getItem(KEY)) || {}; } catch (e) {}
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
    ls.setItem(KEY, JSON.stringify(table));
  }

  check('没有记录时用默认值', () => {
    assert.deepStrictEqual(togglesFor('未设置'), { battle: true, jade: false });
  });

  check('两个配置各记各的，互不干扰', () => {
    saveFor('甲', true, true);
    saveFor('乙', false, false);
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: true });
    assert.deepStrictEqual(togglesFor('乙'), { battle: false, jade: false });
  });

  check('切换回来能恢复（模拟：甲→乙→甲）', () => {
    saveFor('甲', false, true);
    saveFor('乙', true, false);
    assert.deepStrictEqual(togglesFor('乙'), { battle: true, jade: false });
    assert.deepStrictEqual(togglesFor('甲'), { battle: false, jade: true });
  });

  check('配置名不冲突（前缀/相似名）', () => {
    saveFor('配置', false, false);
    saveFor('配置2', true, true);
    assert.deepStrictEqual(togglesFor('配置'), { battle: false, jade: false });
    assert.deepStrictEqual(togglesFor('配置2'), { battle: true, jade: true });
  });

  check('损坏的 JSON 回退默认值', () => {
    ls.setItem(KEY, '{oops');
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: false });
  });

  check('记录缺字段时逐项补默认', () => {
    ls.setItem(KEY, JSON.stringify({ 甲: { jade: true } }));
    assert.deepStrictEqual(togglesFor('甲'), { battle: true, jade: true });
    ls.setItem(KEY, JSON.stringify({ 甲: { battle: false } }));
    assert.deepStrictEqual(togglesFor('甲'), { battle: false, jade: false });
  });

  check('值为非布尔时按真假归一', () => {
    ls.setItem(KEY, JSON.stringify({ 甲: { battle: 0, jade: 'yes' } }));
    assert.deepStrictEqual(togglesFor('甲'), { battle: false, jade: true });
  });
}

// ---------------------------------------------------------------- 静态接线
console.log('app.js 接线:');
{
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  check('render 用 matchesJadeFilter 而不是裸 kind 比较', () => {
    assert.ok(/Core\.matchesJadeFilter\(card, jadeFilter\)/.test(src),
      'render 里没用 matchesJadeFilter');
    assert.ok(!/Core\.describeJade\(card\)\.kind !== jadeFilter/.test(src),
      '还在用旧写法（只比 kind，会把过期的算进去）');
  });

  check('core.js 导出了 matchesJadeFilter', () => {
    assert.strictEqual(typeof Core.matchesJadeFilter, 'function');
  });

  check('ui.html 的勾协下拉框有「勾协已过期」选项', () => {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    const sel = /<select id="jade-filter">([\s\S]*?)<\/select>/.exec(html);
    assert.ok(sel, '找不到 jade-filter 下拉框');
    const values = Array.from(sel[1].matchAll(/value="([^"]+)"/g)).map((m) => m[1]);
    assert.ok(values.indexOf('stale') >= 0, '缺 value="stale"，实际选项：' + values.join(','));
    assert.ok(/勾协已过期/.test(sel[1]), '选项文案缺「勾协已过期」');
  });

  check('两个开关的 onchange 都调用 saveTogglesForCurrent', () => {
    const jade = src.slice(src.indexOf("$('jade-toggle').onchange"),
      src.indexOf("$('battle-toggle').onchange"));
    const battle = src.slice(src.indexOf("$('battle-toggle').onchange"),
      src.indexOf("$('jade-filter').onchange"));
    assert.ok(jade.indexOf('saveTogglesForCurrent()') >= 0, 'jade-toggle 没保存');
    assert.ok(battle.indexOf('saveTogglesForCurrent()') >= 0, 'battle-toggle 没保存');
  });
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过（' + passed + ' 项）');
