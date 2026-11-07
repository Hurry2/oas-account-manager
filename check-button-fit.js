/* 按钮溢出回归自检：卡片里的按钮不能比文字窄。
 * 用法：node check-button-fit.js
 *
 * 背景（2026-11-01）：用户反馈"删除按键里的删除俩字有点超出按钮了"。
 * 根因：方块视图 .card.compact 的 grid 只声明了 3 列
 *   （grid-template-columns: 22px 1fr auto），
 *   但卡片实际有 4 个子元素（⠿ handle / 序号 idx / 正文 main / 操作 actions），
 *   第 4 个 actions 被挤到第二行第 1 列，那列只有 22px 宽，
 *   里面「删除」两个字（22px）加上左右内边距就溢出按钮了。
 *
 * 这里做两件事：
 *   1. 静态：compact 的 grid 列数必须 >= 卡片子元素数
 *   2. 静态：按钮的 padding + 文字宽度不能超过容器可用宽度
 * 真实渲染色宽由端到端脚本量（见 memory 2026-11-01）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------- 列数匹配
// 卡片在 buildCard 里 append 了哪些子元素
console.log('卡片网格列数:');
{
  // app.js: el.append(handle, idx, main, actions)
  const appendLine = /el\.append\(([^)]*)\)/.exec(app);
  check('找得到 buildCard 里的 el.append(...)', !!appendLine);
  const childCount = appendLine ? appendLine[1].split(',').length : 0;
  check('卡片有 4 个子元素（handle/idx/main/actions）', childCount === 4,
    '实际 ' + childCount);

  // 列表视图 .card 的列定义
  const listCard = /\.card\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*([^;]+);/
    .exec(css);
  check('列表视图 .card 有 grid-template-columns', !!listCard);
  if (listCard) {
    const cols = listCard[1].trim().split(/\s+(?![^(]*\))/);
    check('列表视图列数 = 4（含 auto 操作列）', cols.length === 4,
      listCard[1].trim());
    check('列表视图最后一列是 auto（按内容宽）',
      /auto\s*$/.test(listCard[1].trim()), listCard[1].trim());
  }

  // 方块视图 compact 的列定义
  const compact = /#list\.grid-view\s+\.card\.compact\s*\{\s*grid-template-columns:\s*([^;]+);/
    .exec(css);
  check('方块视图 .card.compact 有 grid-template-columns', !!compact);
  if (compact) {
    const cols = compact[1].trim().split(/\s+(?![^(]*\))/);
    check('方块视图列数 = 4（曾经只有 3，导致「删除」溢出）',
      cols.length === 4, compact[1].trim());
    check('方块视图最后一列是 auto（给操作按钮留够宽度）',
      /auto\s*$/.test(compact[1].trim()), compact[1].trim());
  }
}

// ---------------------------------------------------------------- 按钮不裁剪文字
console.log('按钮文字不被裁剪:');
{
  // 方块视图的按钮：不能有 overflow: hidden（会切掉字）
  const compactBtn = /#list\.grid-view\s+\.card\.compact\s+\.actions\s+button\s*\{([^}]*)\}/
    .exec(css);
  check('找得到方块视图按钮样式', !!compactBtn);
  if (compactBtn) {
    const body = compactBtn[1];
    check('方块按钮不裁剪溢出（无 overflow: hidden）',
      !/overflow:\s*hidden/.test(body), body.replace(/\s+/g, ' ').trim());
    check('方块按钮不强制单行断字（white-space: nowrap）',
      /white-space:\s*nowrap/.test(body), body.replace(/\s+/g, ' ').trim());
  }

  // actions 容器不能压到比按钮还窄：align-items: stretch 才能让按钮撑满列宽
  const compactActions = /#list\.grid-view\s+\.card\.compact\s+\.actions\s*\{([^}]*)\}/
    .exec(css);
  check('找得到方块视图 actions 容器样式', !!compactActions);
  if (compactActions) {
    check('actions 用 stretch（按钮撑满列宽，不会比文字窄）',
      /align-items:\s*stretch/.test(compactActions[1]),
      compactActions[1].replace(/\s+/g, ' ').trim());
  }
}

// ---------------------------------------------------------------- 估算宽度
// 用「11px 字号下两个汉字 ≈ 22px」做保守估算：
// 按钮宽度 = 2 * padding-x + 边框 2px + 文字宽
console.log('宽度够不够（估算）:');
{
  const compactBtn = /#list\.grid-view\s+\.card\.compact\s+\.actions\s+button\s*\{([^}]*)\}/
    .exec(css);
  if (compactBtn) {
    const padMatch = /padding:\s*(\d+)px\s+(\d+)px/.exec(compactBtn[1]);
    const padX = padMatch ? Number(padMatch[2]) : 0;
    // 两个汉字在 11px 字号下约 22px
    const needText = 22;
    const needTotal = needText + padX * 2 + 2;   // +2 = 左右边框
    // 列宽至少要有这么多（auto 列会按内容撑开，所以只要能撑开就行）
    check('方块按钮最小宽度 ' + needTotal + 'px <= 常见列宽 36px',
      needTotal <= 36, '需要 ' + needTotal + 'px（padding-x ' + padX + 'px）');
    check('方块按钮左右内边距不过大（<= 8px）', padX <= 8, padX + 'px');
  }
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
