/* 模拟页面「自动排序」按钮的完整链路：
 * 读取 ui.html 里 select 的默认值 → 传给 Core.sortCards → 校验结果。
 * 用法：node check-sort-ui.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Core = require('./core.js');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

console.log('控件:');
check('页面有 sort-mode 下拉', /id="sort-mode"/.test(html));
check('默认排序方式是 id（第一个 option）',
  /<select id="sort-mode">\s*<option value="id"/.test(html));
check('有「自动排序」按钮', /id="btn-sort"/.test(html) && /自动排序/.test(html));
check('有 平台优先 控件', /id="platform-order"/.test(html));

console.log('app.js 接线:');
check('读取 sort-mode 的值',
  /var mode = \$\('sort-mode'\)\.value/.test(app));
check('把 mode 传给 Core.sortCards',
  /Core\.sortCards\(\s*state\.cards,\s*\$\('platform-order'\)\.value,\s*mode\s*\)/.test(app));
check('系统优先始终可用（系统是固定的第二级）',
  !/platform-order'\)\.disabled = isIdMode/.test(app)
    && !/\$\('platform-order'\)\.disabled = true/.test(app));
check('排序方式文案体现三级（账号 → 系统 → …）',
  /账号 → 系统 → 编号/.test(html) && /账号 → 系统 → 角色名/.test(html));

console.log('端到端（真实配置数据）:');
const configPath = path.resolve(
  dir, '..', '..', 'tmp', 'id-test', 'config', '桌面版1.json');
if (!fs.existsSync(configPath)) {
  console.log('  skip  真实配置副本不存在，跳过端到端');
} else {
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ab = data.assist_battle || {};
  const cards = [];
  for (let i = 1; i <= 99; i++) {
    const key = 'account_list_' + i;
    if (ab[key]) cards.push(Core.normalizeCard(ab[key]));
  }
  const scrambled = cards.slice().reverse(); // 打乱，模拟截图里的乱序
  const defaultMode = /<option value="(id|account)">/.exec(
    html.slice(html.indexOf('id="sort-mode"')))[1];

  check('页面默认 mode = id', defaultMode === 'id', '实际 ' + defaultMode);

  const out = Core.sortCards(scrambled, 'android', defaultMode);
  const names = out.map((c) => c.character);
  console.log('    排序结果: ' + names.join(' -> '));

  check('每张卡都能解析出编号',
    out.every((c) => Core.extractNumericId(c.character) !== null));
  // 层级是 账号 → 系统 → 编号，所以只有「同账号且同系统」内编号才单调
  const groups = {};
  out.forEach((c, i) => {
    const key = c.account + '|' + (Core.isAndroid(c) ? 'A' : 'I');
    (groups[key] = groups[key] || []).push(i);
  });
  const monotonic = Object.keys(groups).every((key) => {
    const ids = groups[key].map((i) => Core.extractNumericId(out[i].character));
    return ids.every((v, k) => k === 0 || ids[k - 1] <= v);
  });
  check('同账号同系统内编号单调不减', monotonic);
  check('账号有序（a 在 b 前）',
    out.every((c, i) => i === 0 || out[i - 1].account <= c.account));
  check('同账号内系统优先（安卓组整体在 iOS 组之前）', (() => {
    // a 账号：安卓 6/7/8 之后才是 iOS 二号
    const aGroup = out.filter((c) => c.account.startsWith('a'));
    const firstIos = aGroup.findIndex((c) => !Core.isAndroid(c));
    const lastAndroid = aGroup.map(Core.isAndroid).lastIndexOf(true);
    return firstIos === -1 || firstIos > lastAndroid;
  })());
  check('a 账号首个是安卓六号（系统优先级高于编号）',
    names[0] === '银月六号', '实际 ' + names[0]);
  check('红月组按 5→6→7→8',
    names.slice(4).join(',') === '红月五号,红月六号,红月七号,红月八号',
    '实际 ' + names.slice(4).join(','));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
