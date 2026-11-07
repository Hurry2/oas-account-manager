/* 版本契约检查：防止"页面更新了但后端还是旧进程"导致的诡异报错
 * 用法：node check-version.js [--server URL]
 *
 * 背景（真实踩过的坑）：
 *   页面文件（ui.html/app.js/core.js/ui.css）每次请求都从磁盘读，
 *   改完刷新浏览器就生效；但 server.py 只在进程启动时加载。
 *   旧进程认不得新接口，请求得到一个毫无线索的 "not found"。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

console.log('服务端:');
const serverContract = /CONTRACT_VERSION = (\d+)/.exec(server);
check('server.py 有 CONTRACT_VERSION', !!serverContract, '未找到');
check('CONTRACT_VERSION 是正整数',
  !!serverContract && Number(serverContract[1]) >= 1, serverContract && serverContract[1]);
check('/api/ping 返回 contract',
  /'contract':\s*CONTRACT_VERSION/.test(server));
check('/api/ping 返回 routes',
  /'routes':\s*sorted\(self\._known_routes\(\)\)/.test(server));
check('未知接口用 _reject_unknown',
  /def _reject_unknown/.test(server)
    && (server.match(/self\._reject_unknown\(\)/g) || []).length >= 2);
check('404 提示含重启指引',
  /请关闭工具后重新启动/.test(server));
check('404 返回 hint=restart-required',
  /'hint':\s*'restart-required'/.test(server));

console.log('前端:');
const clientContract = /var EXPECTED_CONTRACT = (\d+)/.exec(app);
check('app.js 有 EXPECTED_CONTRACT', !!clientContract, '未找到');
check('前端与服务端版本号一致',
  !!clientContract && !!serverContract
    && clientContract[1] === serverContract[1],
  '前端 ' + (clientContract && clientContract[1]) + ' vs 服务端 ' + (serverContract && serverContract[1]));
check('启动时调用 checkServerVersion',
  /checkServerVersion\(\)\.then/.test(app));
check('版本落后时显示提示条',
  /showStaleBanner/.test(app) && /stale-banner/.test(css));
check('提示条说明"要重启进程"',
  /重启/.test(app) && /server\.py/.test(app));

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
