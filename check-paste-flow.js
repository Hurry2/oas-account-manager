/* 导入链路端到端：共同值 + 列识别 → 卡片 → 保存到配置
 * 用法：node check-paste-flow.js [--server URL] [--config 名称]
 */
'use strict';

const Core = require('./core.js');

const args = process.argv.slice(2);
function argOf(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const SERVER = argOf('--server', 'http://127.0.0.1:22560');
const CONFIG = argOf('--config', '桌面版1');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

// 用户截图里的原始数据
const PASTE = [
  'iOS\ti154\t雅乐之邦\t紫星一号',
  'iOS\ti154\t花火之夏\t紫星二号',
  'iOS\ti154\t相伴相随\t紫星三号',
  'iOS\ti154\t砂狐乐园\t紫星四号',
].join('\n');

console.log('1) 完整 4 列（共同账号 iOS / i154）:');
{
  const r = Core.parsePaste(PASTE);
  console.log('    列识别: ' + JSON.stringify(r.columns));
  check('解析出 4 张', r.cards.length === 4);
  check('角色名正确', r.cards.map((c) => c.character).join(',')
    === '紫星一号,紫星二号,紫星三号,紫星四号');
  check('服务器各不相同', r.cards.map((c) => c.svr).join(',')
    === '雅乐之邦,花火之夏,相伴相随,砂狐乐园');
  check('账号都是 i154', r.cards.every((c) => c.account === 'i154'));
  check('平台都是 iOS', r.cards.every((c) => c.apple_or_android === false));
  check('编号能解析 1-4', r.cards.map((c) => Core.extractNumericId(c.character)).join(',')
    === '1,2,3,4');
}

console.log('');
console.log('2) 只留角色名 + 共同值（账号/服务器/平台都靠 common）:');
{
  const r = Core.parsePaste('紫星一号\n紫星二号\n紫星三号\n紫星四号', {
    account: 'i154', svr: '雅乐之邦', platform: 'ios',
  });
  check('解析出 4 张', r.cards.length === 4);
  check('服务器取共同值', r.cards.every((c) => c.svr === '雅乐之邦'));
  check('账号取共同值', r.cards.every((c) => c.account === 'i154'));
  check('平台取共同值 iOS', r.cards.every((c) => c.apple_or_android === false));
}

console.log('');
console.log('3) 省略平台列 + 共同值补平台（最省事的写法）:');
{
  const text = '紫星一号\t雅乐之邦\ni164a\t花火之夏\n紫星三号\t相伴相随';
  const r = Core.parsePaste(text, { platform: 'ios' });
  check('服务器逐行覆盖', r.cards[0].svr === '雅乐之邦' && r.cards[1].svr === '花火之夏');
  // 第二行首列是账号形态，B 格式下会被当成角色名 —— 记录实际行为
  console.log('    实际解析: ' + r.cards.map((c) => c.character + '/' + c.account).join(' | '));
  check('平台全部 iOS', r.cards.every((c) => c.apple_or_android === false));
}

console.log('');
console.log('4) 保存到配置:');
(async () => {
  try {
    const listRes = await fetch(SERVER + '/api/list?config=' + encodeURIComponent(CONFIG)
      + '&target=assist_battle');
    const list = await listRes.json();
    const before = list.cards.length;

    const parsed = Core.parsePaste(PASTE).cards;
    const payload = {
      config: CONFIG,
      target: 'assist_battle',
      cards: list.cards.concat(parsed),
      mtime: list.mtime,
    };
    const saveRes = await fetch(SERVER + '/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const saved = await saveRes.json();
    check('保存成功', saved.ok === true, JSON.stringify(saved).slice(0, 120));
    check('卡片数 ' + before + ' -> ' + (before + 4), saved.cards.length === before + 4);

    const added = saved.cards.slice(-4);
    check('新增卡片角色名正确',
      added.map((c) => c.character).join(',') === '紫星一号,紫星二号,紫星三号,紫星四号');
    check('新增卡片账号为 i154', added.every((c) => c.account === 'i154'));
    check('新增卡片为 iOS', added.every((c) => c.apple_or_android === false));
    check('新增卡片是「从未执行」',
      added.every((c) => Core.runState(c) === Core.RUN_STATE.never));
  } catch (error) {
    check('保存链路可用', false, error.message);
  }

  console.log('');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
    process.exit(1);
  }
  console.log('全部通过');
})();
