/* 窗口几何记忆（window.json + /api/window）自检
 * 用法：node check-window-geometry.js
 *
 * 只测后端逻辑与前端静态接线，不启动服务、不碰真实配置。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const failures = [];

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

console.log('后端（server.py）:');
check('有 WINDOW_FILE 定义', /WINDOW_FILE\s*=\s*Path\(__file__\)/.test(server));
check('有 _load_window_geometry', /def _load_window_geometry/.test(server));
check('有 _save_window_geometry', /def _save_window_geometry/.test(server));
check('尺寸下限常量存在', /_MIN_WIDTH\s*=\s*\d+/.test(server) && /_MIN_HEIGHT\s*=\s*\d+/.test(server));
check('过小尺寸被拒绝（抛 ValueError）',
  /_MIN_WIDTH, _MIN_HEIGHT/.test(server) && /raise ValueError/.test(server));
check('保存走原子写入（tmp + os.replace）',
  /\.json\.tmp/.test(server) && /os\.replace/.test(server));
check('/api/window 在已知路由里', /'\/api\/window'/.test(server));
check('GET /api/window 返回 geometry', /parsed\.path == '\/api\/window'[\s\S]{0,120}_load_window_geometry/.test(server));
check('POST /api/window 保存 geometry', /parsed\.path == '\/api\/window'[\s\S]{0,120}_save_window_geometry/.test(server));
check('_open_page 读取记住的几何', /geometry\s*=\s*_load_window_geometry\(\)/.test(server));
check('启动时传 --window-position',
  /--window-position=%d,%d/.test(server));
check('尺寸用记住的值覆盖默认',
  /size = '%d,%d' % \(geometry\['width'\], geometry\['height'\]\)/.test(server));

console.log('前端（app.js）:');
check('有 startGeometryMemory', /function startGeometryMemory/.test(app));
check('有 readGeometry', /function readGeometry/.test(app));
check('有 saveGeometry', /function saveGeometry/.test(app));
check('上报到 /api/window', /api\('\/api\/window'/.test(app));
check('resize 时防抖保存', /addEventListener\('resize', scheduleGeometrySave\)/.test(app));
check('轮询兜底拖动（setInterval）',
  /setInterval\(function \(\) \{[\s\S]{0,300}readGeometry/.test(app));
check('pagehide 用 sendBeacon 保存', /sendBeacon\(\s*'\/api\/window'/.test(app));
check('启动时调用 startGeometryMemory', /startGeometryMemory\(\);/.test(app));
check('读 outerWidth/outerHeight', /window\.outerWidth/.test(app) && /window\.outerHeight/.test(app));
check('读 screenX/screenY 并回退 screenLeft',
  /window\.screenX/.test(app) && /screenLeft/.test(app));

console.log('前后端契约:');
{
  const m = server.match(/CONTRACT_VERSION\s*=\s*(\d+)/);
  const a = app.match(/EXPECTED_CONTRACT\s*=\s*(\d+)/);
  check('CONTRACT_VERSION 与 EXPECTED_CONTRACT 一致',
    !!m && !!a && m[1] === a[1],
    m && a ? ('server=' + m[1] + ' page=' + a[1]) : '没找到版本号');
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
