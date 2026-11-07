/* 主题一致性自检：ui.css 的配色必须与 E:\git_src\xianyu\account-manager 同一套。
 * 用法：node check-theme.js
 *
 * 背景（2026-11-01）：用户要求"参考 xianyu 那边的风格统一一下前端 UI"。
 * xianyu 的两个页面（web_ui.html / service_ui.html）用的是
 * **米黄羊皮纸底 + 金棕主色**，本工具原来是冷灰蓝（#f5f6f8 / #2f6fed）。
 * 这里把关键色值钉死，避免以后又被改回冷色系。
 *
 * 只做静态校验（读 ui.css / ui.html），不需要浏览器；
 * 真实渲染色另有手工端到端核对（见 memory 2026-11-01）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'ui.css'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'ui.html'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------- 主题变量
// 与 xianyu/account-manager/web_ui.html 的 :root 逐项对齐
const EXPECTED = {
  '--bg': '#efdfc0',
  '--panel': '#fdf8ec',
  '--panel2': '#f3e6c8',
  '--line': '#dcc494',
  '--text': '#43301c',
  '--muted': '#967e5d',
  '--accent': '#ad7d24',
  '--accent2': '#7d5a17',
  '--danger': '#b04e30',
  '--ok': '#6b8f4e',
  '--warn': '#bf8a20',
};

console.log('主题变量（与 xianyu 对齐）:');
Object.keys(EXPECTED).forEach((name) => {
  const re = new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;]+);');
  const m = re.exec(css);
  const actual = m ? m[1].trim() : '(缺失)';
  check(name + ' = ' + EXPECTED[name], actual === EXPECTED[name], actual);
});

// ---------------------------------------------------------------- 旧主题残留
// 原来那套冷灰蓝的色值不允许再出现在 CSS 里
console.log('旧冷色主题残留:');
const OLD_COLORS = [
  '#f5f6f8',   // 旧 --bg
  '#2f6fed',   // 旧 --accent（蓝）
  '#e8f0fe',   // 旧 --accent-soft
  '#1f2430',   // 旧 --text
  '#6b7280',   // 旧 --muted
  '#dfe3e8',   // 旧 --line
  '#d64545',   // 旧 --danger
  '#1f9254',   // 旧 --ok
  '#fdecec',   // 旧 danger 底
  '#f3cccc',   // 旧 danger 边
  '#fafbfc',   // 旧浅灰底
  '#f0f2f5',   // 旧 code 底
];
OLD_COLORS.forEach((color) => {
  check('ui.css 不再出现 ' + color, css.toLowerCase().indexOf(color) < 0);
});

// ---------------------------------------------------------------- 结构风格
// xianyu 的几处标志性样式，保持一致
console.log('结构风格（xianyu 同款）:');
{
  check('body 字体用 Segoe UI 打头', /font:[^;]*"Segoe UI"/.test(css));
  check('按钮圆角 7px', /button\s*\{[^}]*border-radius:\s*7px/.test(css));
  check('输入控件圆角 6px', /border-radius:\s*6px/.test(css));
  check('卡片圆角 10px', /\.card\s*\{[^}]*border-radius:\s*10px/.test(css));
  check('标签圆角 9px（xianyu 的 .tag）', /\.tag\s*\{[^}]*border-radius:\s*9px/.test(css));
  check('卡片有柔和阴影（暖棕调）',
    /box-shadow:\s*0 1px 3px rgba\(125, 90, 23/.test(css));
  check('焦点态用金棕描边 + 半透明光晕',
    /box-shadow:\s*0 0 0 2px rgba\(173, 125, 36, \.15\)/.test(css));
  check('弹窗遮罩用暖棕半透明（不是冷黑）',
    /rgba\(74, 53, 32, \.45\)/.test(css));
  check('toast 用面板色而非深色块',
    /#toast\s*\{[^}]*background:\s*var\(--panel2\)/.test(css));
  check('按钮 hover 变金棕底白字',
    /button:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--accent\)/.test(css));
}

// ---------------------------------------------------------------- 页面骨架
console.log('页面骨架:');
{
  check('ui.html 有与 xianyu 同款的 favicon',
    /rel="icon"[^>]*image\/svg\+xml/.test(html));
  check('favicon 用米黄底（%23f6ecd8）', html.indexOf('%23f6ecd8') >= 0);
  check('引入了 ui.css', /href="ui.css"/.test(html));
  check('没有内联写死的旧主题色',
    !/#6b7280|#2f6fed|#f5f6f8/.test(html));
}

// ---------------------------------------------------------------- 状态色仍可区分
// 换主题不能把"今天已执行 / 未执行 / 从未执行"的区分度弄没
console.log('状态色仍可区分:');
{
  const rules = ['.card.run-today', '.card.run-stale', '.card.run-never',
    '.tag.run.today', '.tag.run.stale', '.tag.run.never',
    '.tag.jade.fresh', '.tag.jade.stale', '.tag.jade.none'];
  rules.forEach((sel) => {
    check('保留 ' + sel + ' 样式',
      css.indexOf(sel) >= 0);
  });
  // 三种状态的左边条颜色必须互不相同
  const lefts = ['run-today', 'run-stale', 'run-never'].map((k) => {
    const m = new RegExp('\\.card\\.' + k + '\\s*\\{[^}]*border-left-color:\\s*([^;]+);').exec(css);
    return m ? m[1].trim() : '(缺失)';
  });
  check('三种运行状态左边条颜色各不相同',
    new Set(lefts).size === 3, lefts.join(' / '));
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过');
