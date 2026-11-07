/* 静态一致性检查：app.js 里 $('xxx') 引用的 id 必须都存在于 ui.html
 * 用法：node check-dom.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

const htmlIds = new Set();
const idRe = /\bid="([^"]+)"/g;
let m;
while ((m = idRe.exec(html)) !== null) htmlIds.add(m[1]);

const usedIds = new Set();
const useRe = /\$\('([^']+)'\)/g;
while ((m = useRe.exec(app)) !== null) usedIds.add(m[1]);

// querySelectorAll 里用到的 class
const usedClasses = new Set();
const clsRe = /querySelectorAll\('\.([\w-]+)'\)/g;
while ((m = clsRe.exec(app)) !== null) usedClasses.add(m[1]);

// ui.html 里必须引入的脚本 / 样式
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((x) => x[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((x) => x[1]);

const failures = [];
function check(name, ok) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) failures.push(name);
}

console.log('DOM id 一致性:');
const missing = [...usedIds].filter((id) => !htmlIds.has(id));
check('app.js 引用的 id 全部存在', missing.length === 0);
if (missing.length) console.log('    缺少:', missing.join(', '));

const unused = [...htmlIds].filter((id) => !usedIds.has(id));
if (unused.length) console.log('    提示：ui.html 中未被 app.js 引用的 id：' + unused.join(', '));

console.log('静态资源:');
check('引入了 core.js', scripts.includes('core.js'));
check('引入了 app.js', scripts.includes('app.js'));
check('引入了 ui.css', styles.includes('ui.css'));
for (const file of ['core.js', 'app.js', 'ui.css']) {
  check('文件存在 ' + file, fs.existsSync(path.join(dir, file)));
}

console.log('脚本顺序:');
check('core.js 在 app.js 之前（app.js 依赖 window.AccountCore）',
  scripts.indexOf('core.js') >= 0 && scripts.indexOf('core.js') < scripts.indexOf('app.js'));

console.log('视图切换:');
check('有「列表/方块」切换按钮组',
  /id="btn-view-list"/.test(html) && /id="btn-view-grid"/.test(html));
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
check('app.js 有 setView / localStorage 记忆',
  /function setView/.test(appSrc) && /localStorage\.setItem/.test(appSrc));
const cssAll = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');
check('grid 视图用 CSS 网格（auto-fill）',
  /grid-view/.test(cssAll) && /repeat\(auto-fill/.test(cssAll));
check('compact 卡片样式已定义',
  /\.card\.compact/.test(cssAll));

console.log('CSS 类:');
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');
for (const cls of usedClasses) {
  check('ui.css 定义了 .' + cls, css.includes('.' + cls));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
