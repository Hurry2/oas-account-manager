/* 导出功能检查：未脱敏 / 格式兼容 / 含未保存修改 / 不写盘
 * 用法：node check-export.js [--server URL] [--config 名称]
 * 需要工具已启动（导出走 HTTP 接口）。
 */
'use strict';

const args = process.argv.slice(2);
function argOf(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const SERVER = argOf('--server', 'http://127.0.0.1:22570');
const CONFIG = argOf('--config', '桌面版1');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

(async () => {
  let list;
  try {
    const res = await fetch(SERVER + '/api/list?config=' + encodeURIComponent(CONFIG)
      + '&target=assist_battle');
    list = await res.json();
  } catch (error) {
    console.log('跳过：服务未启动（' + error.message + '）');
    process.exit(0);
  }

  console.log('任务导出（GET，磁盘内容）:');
  const url = SERVER + '/api/export?config=' + encodeURIComponent(CONFIG)
    + '&target=assist_battle';
  const exported = await (await fetch(url)).json();
  const content = exported.content || '';

  check('返回成功', exported.ok === true);
  check('文件名为 <配置>-<任务>.json', exported.filename === CONFIG + '-assist_battle.json',
    exported.filename);
  check('顶层只有该任务键', Object.keys(JSON.parse(content)).join(',') === 'assist_battle');
  check('包含 account_list_1', /"account_list_1"/.test(content));
  check('包含 account_count', /"account_count"/.test(content));

  console.log('未脱敏（关键）:');
  const realAccounts = list.cards.map((c) => c.account).filter(Boolean);
  check('含真实账号字符串', realAccounts.some((a) => content.includes(a)),
    realAccounts[0]);
  check('不含脱敏占位 XXX', !/"account"\s*:\s*"XXX"/.test(content));
  const parsed = JSON.parse(content).assist_battle;
  check('account 字段无 XXX',
    !Object.keys(parsed)
      .filter((k) => k.startsWith('account_list_'))
      .some((k) => parsed[k].account === 'XXX'));

  console.log('含未保存修改（POST）:');
  const dirty = list.cards.map((c) => Object.assign({}, c));
  dirty[0].character = '未保存的改动';
  const postRes = await (await fetch(SERVER + '/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: CONFIG, target: 'assist_battle', cards: dirty }),
  })).json();
  check('导出内容反映未保存的改动', /未保存的改动/.test(postRes.content || ''));

  // 确认没有写盘
  const after = await (await fetch(SERVER + '/api/list?config=' + encodeURIComponent(CONFIG)
    + '&target=assist_battle')).json();
  check('导出不写盘（磁盘内容未变）', !/未保存的改动/.test(JSON.stringify(after.cards)));

  console.log('整配置导出:');
  const whole = await (await fetch(
    SERVER + '/api/export?config=' + encodeURIComponent(CONFIG))).json();
  check('文件名为 <配置>.json', whole.filename === CONFIG + '.json', whole.filename);
  const wholeObj = JSON.parse(whole.content);
  check('含 config_name', 'config_name' in wholeObj);
  check('含多个任务', Object.keys(wholeObj).length > 10);
  check('比单任务导出更大', whole.bytes > exported.bytes);

  console.log('');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
    process.exit(1);
  }
  console.log('全部通过');
})().catch((error) => {
  console.log('检查异常：' + error.message);
  process.exit(1);
});
