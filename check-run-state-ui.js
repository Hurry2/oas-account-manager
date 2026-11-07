/* 运行状态展示链路检查：卡片是否带状态、筛选是否只影响显示
 * 用法：node check-run-state-ui.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Core = require('./core.js');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

console.log('控件:');
check('有运行状态筛选下拉', /id="run-filter"/.test(html));
check('筛选含三个状态 + 全部', ['all', 'today', 'stale', 'never'].every(
  (v) => new RegExp('value="' + v + '"').test(html)));
check('有「标记今天已执行」按钮', /id="btn-time-now"/.test(html));
check('有「标记从未执行」按钮', /id="btn-time-never"/.test(html));

console.log('卡片渲染:');
check('卡片带 run-<state> 类名', /'card run-' \+ runStatus/.test(app));
check('卡片带 data-run-state', /dataset\.runState = runStatus/.test(app));
check('row1 有状态标签（协战 已执行 / 未执行 / 从未执行）',
  /✓ 已执行/.test(app) && /未执行/.test(app) && /从未执行/.test(app));
check('row2 有「协战 <时间>」标签', /'协战 ' \+ battleTimeText\(run\)/.test(app));
check('hover 显示原始时间', /上次执行：/.test(app));

console.log('CSS:');
for (const state of ['today', 'stale', 'never']) {
  check('定义了 .card.run-' + state, new RegExp('\\.card\\.run-' + state).test(css));
  check('定义了 .tag.run.' + state, new RegExp('\\.tag\\.run\\.' + state).test(css));
}
check('卡片有左侧色条', /border-left:\s*4px solid/.test(css));

console.log('筛选行为:');
check('筛选只跳过渲染、不改动数组',
  /if \(showBattle && filter !== 'all' && Core\.runState\(card\) !== filter\)/.test(app));
check('筛选用真实下标（不重排）', /buildCard\(card, index, dupKeys, (true|false), showJade, showBattle\)/.test(app));
check('筛选结果为空时给出提示', /没有符合/.test(app));
check('状态计数进入概览', /summarizeRunState/.test(app));

console.log('端到端（真实配置副本）:');
const configPath = path.resolve(dir, '..', '..', 'tmp', 'state-test', 'config', '模拟器2原皮.json');
if (!fs.existsSync(configPath)) {
  console.log('  skip  配置副本不存在，跳过');
} else {
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ab = data.assist_battle || {};
  const cards = [];
  for (let i = 1; i <= 99; i++) {
    const k = 'account_list_' + i;
    if (ab[k]) cards.push(Core.normalizeCard(ab[k]));
  }
  console.log('    卡片数: ' + cards.length);
  const stats = Core.summarizeRunState(cards);
  console.log('    状态分布: ' + JSON.stringify(stats));
  check('真实数据能全部分类', stats.today + stats.stale + stats.never === cards.length);
  const sample = cards[0];
  const d = Core.describeRunTime(sample);
  console.log('    样例: ' + sample.character + ' -> ' + d.state + ' / ' + d.text);
  check('样例文本非空', !!d.text);
}

console.log('哨兵值:');
{
  const NOW = '2026-10-26 10:00:00';
  check('0xABCDEF 秒 = 1970-05-11 07:36:15 判为 never',
    Core.runState({ last_complete_time: '1970-05-11 07:36:15' }, NOW) === Core.RUN_STATE.never);
  check('2023-01-01 默认值判为 never',
    Core.runState({ last_complete_time: '2023-01-01 00:00:00' }, NOW) === Core.RUN_STATE.never);
  check('未来时间不会被误判为 never',
    Core.runState({ last_complete_time: '2026-10-27 00:00:00' }, NOW) !== Core.RUN_STATE.never);
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
