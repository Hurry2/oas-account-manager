/* 验证三级排序：账号 → 系统 → 编号（/角色名）
 * 重点：系统是第二级，编号只是第三级，不能越过系统。
 * 用法：node check-sort-levels.js
 */
'use strict';

const Core = require('./core.js');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

function card(character, account, android) {
  return Core.normalizeCard({
    character: character,
    account: account,
    apple_or_android: android,
  });
}

function order(cards, platformOrder, mode) {
  return Core.sortCards(cards, platformOrder, mode).map((c) => c.character);
}

console.log('系统优先于编号（关键回归）:');
{
  // 同账号下：iOS 二号 vs 安卓 六号
  // 若编号优先 → 二号在前；若系统优先 → 安卓六号在前
  const cards = [
    card('银月二号', 'a', false),   // iOS, 编号 2
    card('银月六号', 'a', true),    // 安卓, 编号 6
  ];
  check('安卓在前时：安卓六号 排在 iOS二号 之前',
    order(cards, 'android', 'id').join(',') === '银月六号,银月二号',
    order(cards, 'android', 'id').join(','));
  check('iOS 在前时：iOS二号 排在 安卓六号 之前',
    order(cards, 'ios', 'id').join(',') === '银月二号,银月六号',
    order(cards, 'ios', 'id').join(','));
}

console.log('系统优先于角色名（account 模式同样）:');
{
  const cards = [
    card('阿一号', 'a', false),   // iOS
    card('梓九号', 'a', true),    // 安卓（拼音 Z 在 A 之后）
  ];
  const out = order(cards, 'android', 'account');
  check('安卓在前：安卓角色先出，即使名字拼音更大',
    out.join(',') === '梓九号,阿一号', out.join(','));
}

console.log('同系统内按编号:');
{
  const cards = [
    card('银月八号', 'a', true),
    card('银月六号', 'a', true),
    card('银月二号', 'a', true),
  ];
  check('安卓组内 2 → 6 → 8',
    order(cards, 'android', 'id').join(',') === '银月二号,银月六号,银月八号',
    order(cards, 'android', 'id').join(','));
}

console.log('账号仍是最外层:');
{
  const cards = [
    card('红月二号', 'b', true),
    card('银月八号', 'a', true),
  ];
  check('a 账号整组在 b 账号之前（不因编号跨账号穿插）',
    order(cards, 'android', 'id').join(',') === '银月八号,红月二号',
    order(cards, 'android', 'id').join(','));
}

console.log('真实数据（截图场景，单系统账号组）:');
{
  const cards = [
    card('银星二号', 'example001@example.com', false),
    card('银月八号', 'example001@example.com', true),
    card('银月六号', 'example001@example.com', true),
    card('银月七号', 'example001@example.com', true),
    card('红月八号', 'example002@example.com', true),
    card('红月六号', 'example002@example.com', true),
    card('红月七号', 'example002@example.com', true),
    card('红月五号', 'example002@example.com', true),
  ];
  const out = order(cards, 'android', 'id');
  // a 账号：安卓 6/7/8 先，iOS 二号（iOS 在前？否，安卓优先）→ 二号在组末
  check('a 账号：安卓 6→7→8 之后才是 iOS 二号',
    out.slice(0, 4).join(',') === '银月六号,银月七号,银月八号,银星二号',
    out.slice(0, 4).join(','));
  check('b 账号：5→6→7→8',
    out.slice(4).join(',') === '红月五号,红月六号,红月七号,红月八号',
    out.slice(4).join(','));
}

console.log('无编号的卡排在同账号同系统的最后:');
{
  const cards = [
    card('备用号', 'a', true),
    card('银月六号', 'a', true),
  ];
  check('有编号的在前',
    order(cards, 'android', 'id').join(',') === '银月六号,备用号',
    order(cards, 'android', 'id').join(','));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
