/* 「每行几张卡」自检：固定列数功能 + 记忆。
 * 用法：node check-grid-cols.js
 *
 * 背景（2026-11-01）：用户说"我的账户一般是四个一组的，
 * 你帮我固定成一行四个或者八个卡片怎么样"。
 * 自动排列（auto-fill）在宽窗口下会排成 5 张一行，4 个一组就被拆开了。
 *
 * 静态部分（不需要浏览器）：
 *   - 下拉框有 auto/2/3/4/6/8 这些值，且含用户要的 4 和 8
 *   - app.js 有白名单校验（脏数据回落到 auto）
 *   - render() 里 className 会带上 fixed-cols（否则列数失效）
 *   - CSS 有 fixed-cols 规则，用 var(--grid-cols)
 *   - 选择值会写进 localStorage 并在启动时恢复
 * 真实列数由 check-overflow.js 之外的端到端脚本量（见 memory 2026-11-01）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------- 下拉框
console.log('「每行」下拉框:');
{
  check('ui.html 有 grid-cols 选择框', /id="grid-cols"/.test(html));
  const sel = /<select id="grid-cols">([\s\S]*?)<\/select>/.exec(html);
  check('找得到 grid-cols 的选项', !!sel);
  if (sel) {
    const values = Array.from(sel[1].matchAll(/value="([^"]+)"/g)).map((m) => m[1]);
    console.log('    选项: ' + values.join(', '));
    check('含 auto（自动排列）', values.indexOf('auto') >= 0);
    check('含 4（用户要的"一行四个"）', values.indexOf('4') >= 0);
    check('含 8（用户要的"一行八个"）', values.indexOf('8') >= 0);
    check('默认是 auto', /<option value="auto"[^>]*>/.test(sel[1])
      && sel[1].indexOf('selected') < 0);
  }
  check('有对应的 label 容器 grid-cols-field', /id="grid-cols-field"/.test(html));
}

// ---------------------------------------------------------------- 白名单
console.log('取值校验:');
{
  check('app.js 有 GRID_COLS_VALUES 白名单', /GRID_COLS_VALUES\s*=\s*\[/.test(app));
  const m = /GRID_COLS_VALUES\s*=\s*\[([^\]]+)\]/.exec(app);
  if (m) {
    const vals = Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
    console.log('    白名单: ' + vals.join(', '));
    check('白名单含 auto / 4 / 8',
      vals.indexOf('auto') >= 0 && vals.indexOf('4') >= 0 && vals.indexOf('8') >= 0);
  }
  check('setGridCols 校验后回落到 auto',
    /function setGridCols[\s\S]{0,400}?:\s*'auto'/.test(app));
  check('启动时恢复也校验白名单',
    /GRID_COLS_VALUES\.indexOf\(savedCols\)\s*>=\s*0/.test(app));
}

// ---------------------------------------------------------------- 渲染接线
console.log('渲染接线:');
{
  check('render() 的 className 带 fixed-cols',
    /list\.className = viewMode === 'grid'[\s\S]{0,120}?fixed-cols/.test(app));
  check('syncGridColsUi 设置 --grid-cols 变量',
    /setProperty\('--grid-cols'/.test(app));
  check('auto 时移除 --grid-cols',
    /removeProperty\('--grid-cols'\)/.test(app));
  check('切视图时同步选择器可用状态', /function setView[\s\S]{0,300}?syncGridColsUi\(\)/.test(app));
  check('列表视图下禁用选择器（只有方块视图用得上）',
    /sel\.disabled = !usable/.test(app));
  check('下拉框有 onchange 绑定',
    /\$\('grid-cols'\)\.onchange/.test(app));
  check('启动时调 syncGridColsUi', /syncGridColsUi\(\);\s*\n\s*checkServerVersion/.test(app)
    || /syncViewButtons\(\);\s*\n\s*syncGridColsUi\(\)/.test(app));
}

// ---------------------------------------------------------------- CSS
console.log('CSS 规则:');
{
  check('有 .grid-view.fixed-cols 规则', /#list\.grid-view\.fixed-cols/.test(css));
  const rule = /#list\.grid-view\.fixed-cols\s*\{([^}]*)\}/.exec(css);
  check('找得到 fixed-cols 规则体', !!rule);
  if (rule) {
    check('用 repeat(var(--grid-cols), ...) 按变量分列',
      /repeat\(var\(--grid-cols\)/.test(rule[1]), rule[1].replace(/\s+/g, ' ').trim());
    check('用 minmax(0, 1fr) 等宽平分（不会被内容撑破）',
      /minmax\(0,\s*1fr\)/.test(rule[1]), rule[1].replace(/\s+/g, ' ').trim());
  }
  check('auto 模式仍保留 auto-fill 规则',
    /repeat\(auto-fill,\s*minmax\(240px,\s*1fr\)\)/.test(css));
}

// ---------------------------------------------------------------- 记忆
console.log('记忆:');
{
  check('有 GRID_COLS_KEY', /GRID_COLS_KEY\s*=\s*'account-manager\.gridCols'/.test(app));
  check('setGridCols 写入 localStorage',
    /function setGridCols[\s\S]{0,400}?localStorage\.setItem\(GRID_COLS_KEY/.test(app));
  check('启动时从 localStorage 读回',
    /localStorage\.getItem\(GRID_COLS_KEY\)/.test(app));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
