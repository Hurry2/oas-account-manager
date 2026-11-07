/* 全部自检入口：一次跑完所有检查
 * 用法：node run-all-checks.js
 * 会依次执行各检查脚本，任一失败则整体返回非 0。
 *
 * 注意：这里用 spawnSync 且 stdio 设为 'inherit'。
 * 在受限环境（例如某些沙箱）里，子进程的 stdio 管道会被拒绝（EPERM），
 * 只有 inherit / ignore 能用，所以不要改成捕获输出。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./env.js');

const dir = __dirname;
// 解释器按"工具自身位置"找（便携 python/ → toolkit/ → 向上 → PATH），
// 不再假设本工具一定在 OAS 仓库里
const python = env.findPython(false);
// 需要真实配置的检查用这个；独立部署找不到 OAS 时这些检查会自行 skip
const oasRoot = env.findOasRoot();

const steps = [];

if (python) {
  steps.push({
    name: 'Python 自检（读写/重排/并发保护/空列表/缺节点）',
    command: python,
    args: ['-B', path.join(dir, 'server.py'), '--selftest'],
  });
} else {
  console.log('skip  Python 自检（找不到解释器）');
  console.log('      可用环境变量 ACCOUNT_MANAGER_PYTHON 指定，或放一份 python/ 到工具目录');
}

if (!oasRoot) {
  console.log('info  没找到 OAS 的 config/ 目录（独立部署时正常）');
  console.log('      需要真实配置的检查会 skip；用 OAS_ROOT 环境变量或 --root 指定后可跑全');
}

[
  ['core.js 单元测试（汉字数字/排序/状态/解析）', 'core.test.js'],
  ['DOM 一致性（id 引用/静态资源/脚本顺序）', 'check-dom.js'],
  ['主题一致性（配色与 xianyu 账号管理对齐）', 'check-theme.js'],
  ['三级排序层级（账号 → 系统 → 编号）', 'check-sort-levels.js'],
  ['运行状态展示（今天已执行/未执行/哨兵值）', 'check-run-state-ui.js'],
  ['排序链路（页面下拉 → 排序结果）', 'check-sort-ui.js'],
  ['启动器约束（纯 ASCII / BOM / 路径）', 'check-launchers.js'],
  ['可移植性（移动目录后的路径解析）', 'check-portable.js'],
  ['版本契约（页面与后端进程匹配）', 'check-version.js'],
  ['窗口几何记忆（位置/尺寸上报与回放）', 'check-window-geometry.js'],
  ['卡片字段可见性（区服/勾协/按钮，两种视图）', 'check-card-fields.js'],
  ['偏好记忆（localStorage 协议 + 恢复完整性）', 'check-prefs.js'],
  ['勾协筛选口径 + 按配置记忆开关', 'check-jade-filter.js'],
  ['重新加载可靠性（并发守卫/失败保留/连接排队）', 'check-reload.js'],
  ['按钮不溢出（网格列数 / 不裁剪文字）', 'check-button-fit.js'],
  ['每行卡片数（固定 4/8 列 + 记忆）', 'check-grid-cols.js'],
  ['切号任务适配（轮换指针越界归零 / 只读信息）', 'check-account-switch.js'],
  ['app.js 可执行（DOM stub 下跑一遍，抓运行时错误）', 'check-app-runs.js'],
].forEach(([name, file]) => {
  steps.push({ name: name, command: process.execPath, args: [path.join(dir, file)] });
});

// 需要服务在跑的检查：跳过而非失败（服务没起时它们会自行 skip）
steps.push({
  name: '导出功能（未脱敏/格式兼容/不写盘）— 需服务已启动，否则跳过',
  command: process.execPath,
  args: [path.join(dir, 'check-export.js')],
});
steps.push({
  name: '按钮文字溢出扫描（真浏览器量盒子，4 种窗宽 × 4 视图）— 需服务已启动，否则跳过',
  command: process.execPath,
  args: [path.join(dir, 'check-overflow.js')],
});

let failed = 0;
const failedNames = [];
steps.forEach((step, index) => {
  console.log('');
  console.log('── [' + (index + 1) + '/' + steps.length + '] ' + step.name);
  const result = spawnSync(step.command, step.args, {
    // cwd 用工具目录（不再依赖 OAS 仓库根）：server.py 的图片路径归一化之类
    // 逻辑都基于自己 __file__，不依赖 cwd
    cwd: dir,
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      PYTHONIOENCODING: 'utf-8',
      // 有 OAS 根就传下去，让需要真实配置的检查能用上
      ...(oasRoot ? { OAS_ROOT: oasRoot } : {}),
    }),
  });
  if (result.status !== 0) {
    failed += 1;
    failedNames.push(step.name);
  }
});

console.log('');
console.log('='.repeat(52));
if (failed) {
  console.log('有 ' + failed + ' 项检查未通过：');
  failedNames.forEach((name) => console.log('  - ' + name));
  process.exit(1);
}
console.log('全部 ' + steps.length + ' 项检查通过');
