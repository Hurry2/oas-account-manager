/* 可移植性检查：把工具挪到别的目录后还能不能跑
 * 用法：node check-portable.js
 *
 * 检查项：
 *  - server.py 不用固定层级的 parents[N] 推断仓库根（改为逐级向上找 config/）
 *  - 启动 bat 不硬编码 ..\..\..\toolkit（改为 _find_python.bat 向上搜索 + PATH + 环境变量）
 *  - _find_python.bat 的 endlocal&set 之间没有空格（空格会进变量值）
 *  - install-shortcut.ps1 的仓库根解析不是硬编码层级
 *  - bat 仍然全是纯 ASCII
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const failures = [];

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

function readAscii(name) {
  return fs.readFileSync(path.join(dir, name), 'ascii');
}

console.log('仓库根推断（server.py）:');
{
  const server = read('server.py');
  check('有 detect_repo_root', /def detect_repo_root/.test(server));
  check('逐级向上找 config/', /for candidate in \[start\] \+ list\(start\.parents\)/.test(server));
  check('不再硬编码 parents[3]', !/parents\[3\]/.test(server));
  check('支持 OAS_ROOT 环境变量（独立部署用）', /OAS_ROOT/.test(server));
  check('找不到时给出 --root 提示', /--root/.test(server) && /找不到 OAS 的 config 目录/.test(server));
}

console.log('解释器查找（bat）:');
{
  check('存在 _find_python.bat', fs.existsSync(path.join(dir, '_find_python.bat')));
  const finder = readAscii('_find_python.bat');
  check('支持 ACCOUNT_MANAGER_PYTHON 环境变量', /ACCOUNT_MANAGER_PYTHON/.test(finder));
  check('支持 ACCOUNT_MANAGER_PYTHONW 环境变量', /ACCOUNT_MANAGER_PYTHONW/.test(finder));
  check('优先用工具自带的 python/（便携部署）', /%~dp0python\\%WANT%\.exe/.test(finder));
  check('兼容旧布局 toolkit/', /%~dp0toolkit\\%WANT%\.exe/.test(finder));
  check('向上搜索 toolkit', /toolkit\\%WANT%\.exe/.test(finder));
  check('PATH 兜底', /%%~\$PATH:I/.test(finder));
  check('pythonw 可退回 python', /toolkit\\python\.exe/.test(finder));
  // endlocal&set 之间不能有空格：空格会被拼进变量值
  const spacingIssues = finder
    .split(/\r?\n/)
    .filter((line) => /endlocal\s+&/.test(line) || /&\s+set\s+"%VARN%/.test(line));
  check('endlocal 与 set 之间无空格（否则路径带尾随空格）',
    spacingIssues.length === 0,
    spacingIssues[0]);

  for (const name of ['启动账号管理.bat', '启动账号管理（无窗口）.bat', '关闭账号管理.bat']) {
    const text = readAscii(name);
    check(name + ' 调用 _find_python.bat', /call "%~dp0_find_python\.bat"/.test(text));
    check(name + ' 不再硬编码 ..\\..\\..\\toolkit',
      !/\.\.\\\.\.\\\.\.\\toolkit/.test(text));
    // 纯 ASCII
    const buf = fs.readFileSync(path.join(dir, name));
    check(name + ' 纯 ASCII', [...buf].every((b) => b <= 0x7f));
  }
}

console.log('快捷方式安装脚本:');
{
  const ps1 = read('install-shortcut.ps1');
  check('有 -TargetDir 测试参数', /\[string\]\$TargetDir/.test(ps1));
  check('按工具目录定位 server.py（不假设仓库层级）',
    /Join-Path \$scriptDir 'server\.py'/.test(ps1));
  check('不再硬编码 ..\..\.. 当仓库根',
    !/Join-Path \$scriptDir '\.\.\\\.\.\\\.\.'/.test(ps1));
  check('解释器按便携/旧布局/向上/PATH 顺序查找',
    /python\\pythonw\.exe/.test(ps1) && /toolkit\\pythonw\.exe/.test(ps1));
  check('支持 ACCOUNT_MANAGER_PYTHONW 环境变量',
    /ACCOUNT_MANAGER_PYTHONW/.test(ps1));
  const buf = fs.readFileSync(path.join(dir, 'install-shortcut.ps1'));
  check('保持 UTF-8 BOM',
    buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
}

console.log('运行期文件位置:');
{
  const server = read('server.py');
  check('备份目录跟随工具目录',
    /backup_dir = Path\(__file__\)\.resolve\(\)\.parent \/ 'backups'/.test(server));
  check('.runtime.json 跟随工具目录',
    /RUNTIME_FILE = Path\(__file__\)\.resolve\(\)\.parent/.test(server));
  check('静态资源按 __file__ 定位（不依赖 cwd）',
    /Path\(__file__\)\.resolve\(\)\.parent \/ 'ui\.html'/.test(server));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
