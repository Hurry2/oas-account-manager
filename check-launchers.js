/* 启动脚本静态检查：路径引用、ASCII 约束、编码
 * 用法：node check-launchers.js
 *
 * 检查项：
 *  - .bat 必须是纯 ASCII：cmd.exe 按控制台代码页解析 .bat，
 *    UTF-8 中文会导致 "not recognized as an internal or external command"
 *  - .bat 引用的 python / server.py 路径按仓库结构能解析到
 *  - .ps1 必须是 UTF-8 with BOM：Windows PowerShell 5.1 无 BOM 时按 GBK 读，
 *    中文会乱码到语法报错
 *  - .vbs 引用的 .bat 存在
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const env = require('./env.js');

const dir = __dirname;
const failures = [];

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

function readBytes(name) {
  return fs.readFileSync(path.join(dir, name));
}

console.log('批处理（必须纯 ASCII）:');
for (const name of [
  '启动账号管理.bat',
  '启动账号管理（无窗口）.bat',
  '启动账号管理（独立窗口）.bat',
  '关闭账号管理.bat',
]) {
  const buf = readBytes(name);
  const nonAscii = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7f) { nonAscii.push(i); }
  }
  check(name + ' 纯 ASCII', nonAscii.length === 0,
    nonAscii.length ? '首个非 ASCII 字节偏移 ' + nonAscii[0] : '');

  const text = buf.toString('ascii');
  check(name + ' 设置 PYTHONIOENCODING',
    /set\s+"PYTHONIOENCODING=utf-8"/i.test(text));
  check(name + ' 通过 _find_python.bat 找解释器',
    /_find_python\.bat/i.test(text),
    '启动器不该写死 toolkit 路径（独立部署没有 toolkit）');
  check(name + ' 引用了 server.py', /server\.py/i.test(text));
  check(name + ' 有错误分支 goto', /goto \w+/i.test(text));
}

console.log('关闭脚本:');
{
  const text = readBytes('关闭账号管理.bat').toString('ascii');
  check('关闭脚本传 --stop', /--stop/.test(text));
  const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
  check('server.py 支持 --stop', /add_argument\('--stop'/.test(server));
  check('server.py 有 /api/shutdown', /\/api\/shutdown/.test(server));
  check('server.py 有 /api/ping', /\/api\/ping/.test(server));
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  check('app.js 调用 /api/shutdown', /\/api\/shutdown/.test(app));
  check('ui.html 有退出按钮', /id="btn-quit"/.test(fs.readFileSync(path.join(dir, 'ui.html'), 'utf8')));
}

console.log('PowerShell（必须 UTF-8 BOM）:');
{
  const name = 'install-shortcut.ps1';
  const buf = readBytes(name);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  check(name + ' 带 UTF-8 BOM', hasBom, hasBom ? '' : '无 BOM 时 PS 5.1 会按 GBK 读导致语法错误');
  const text = buf.slice(3).toString('utf8');
  check(name + ' 解析 pythonw.exe 路径', /toolkit\\\\?pythonw\.exe/.test(text) || /pythonw\.exe/.test(text));
  check(name + ' 解析 server.py 路径', /server\.py/.test(text));
  check(name + ' 支持 -TargetDir 测试参数', /\[string\]\$TargetDir/.test(text));
  check(name + ' 创建 .lnk', /CreateShortcut/.test(text));
}

console.log('VBScript:');
{
  const text = readBytes('启动账号管理.vbs').toString('utf8');
  check('调用无窗口 bat', text.includes('启动账号管理（无窗口）.bat'));
  check('隐藏窗口运行', /shell\.Run/i.test(text) && /,\s*0\s*,/.test(text));
}
{
  const text = readBytes('启动账号管理（独立窗口）.vbs').toString('utf8');
  check('独立窗口 vbs 调用独立窗口 bat', text.includes('启动账号管理（独立窗口）.bat'));
  check('独立窗口 vbs 隐藏窗口运行', /shell\.Run/i.test(text) && /,\s*0\s*,/.test(text));
}

console.log('独立窗口模式:');
{
  const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
  check('server.py 支持 --app', /add_argument\(\s*'--app'/.test(server));
  check('server.py 有 _find_chromium', /def _find_chromium/.test(server));
  check('server.py 有 _open_page', /def _open_page/.test(server));
  check('_open_page 用 --app= 参数', /--app=%s/.test(server));
  check('_open_page 用独立 user-data-dir', /--user-data-dir/.test(server));
  check('pythonw 下断开 stdio（stdin/stdout/stderr）',
    /stdin=subprocess\.DEVNULL/.test(server)
    && /stdout=subprocess\.DEVNULL/.test(server)
    && /stderr=subprocess\.DEVNULL/.test(server));
  check('找不到 Chromium 时回退 webbrowser', /webbrowser\.open\(url\)/.test(server));
  const bat = readBytes('启动账号管理（独立窗口）.bat').toString('ascii');
  check('独立窗口 bat 传 --app', /--app/.test(bat));
}

console.log('空闲自动退出（默认关闭，可选开启）:');
{
  const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
  check('IDLE_EXIT_SECONDS 默认 0（不自动退出）',
    /IDLE_EXIT_SECONDS\s*=\s*0\b/.test(server));
  check('有 --idle-exit 参数', /add_argument\(\s*'--idle-exit'/.test(server));
  check('只有 --idle-exit > 0 才启动看门狗',
    /if args\.idle_exit > 0:[\s\S]{0,80}_start_idle_watchdog\(args\.idle_exit\)/.test(server));
  check('看门狗函数有 timeout<=0 早退',
    /if timeout <= 0:\s*\n\s*return/.test(server));
  check('有 _touch_heartbeat', /def _touch_heartbeat/.test(server));
  check('/api/ping 会刷新心跳', /_touch_heartbeat\(\)/.test(server));
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  check('app.js 有 startHeartbeat（供可选看门狗用）', /function startHeartbeat/.test(app));
}

console.log('路径解析（工具自身文件）:');
check('server.py 存在', fs.existsSync(path.join(dir, 'server.py')));
check('_find_python.bat 存在（解释器由它动态查找）',
  fs.existsSync(path.join(dir, '_find_python.bat')));

// 解释器：独立部署时可能用工具目录下的 python/，也可能用系统 Python
{
  const py = env.findPython(false);
  check('能找到 Python 解释器', !!py, py || '便携 python/ 或系统 PATH 都试过了');
  const oas = env.findOasRoot();
  console.log('  info  OAS 根: ' + (oas || '（未找到，独立部署时正常）'));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
