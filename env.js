/* 自检脚本共用的环境探测。
 *
 * 为什么单独抽出来：这个工具原来放在 OAS 仓库的 .agents/tools/account-manager/ 下，
 * 所有自检脚本都写死了 `path.resolve(__dirname, '..', '..', '..')` 当仓库根、
 * 用 `repoRoot/toolkit/python.exe` 当解释器。一旦工具独立成库（自己的 git 仓库），
 * 这两个假设就全错了 —— 往上三层不再是 OAS 仓库，也没有 toolkit/。
 *
 * 这里统一按"工具自己所在目录"为基准来找：
 *   - 解释器：ACCOUNT_MANAGER_PYTHON 环境变量 → <tool>/python/ → <tool>/toolkit/
 *             → 向上找 toolkit/ → PATH 上的 python
 *   - OAS 根：OAS_ROOT 环境变量 → --root 参数 → 向上找含 config/ 的目录 → 无
 *
 * 找不到 OAS 根不算失败：工具本来就是"外部程序 + 指定目标"的设计，
 * 只有需要真实配置的那几个检查会 skip。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TOOL_DIR = __dirname;

function exists(p) {
  try { return fs.existsSync(p); } catch (e) { return false; }
}

/** 找一个可用的 Python 解释器（返回绝对路径或 null） */
function findPython(wantWindowless) {
  const exe = wantWindowless ? 'pythonw.exe' : 'python.exe';
  const candidates = [];

  // 1) 显式环境变量
  const env = wantWindowless
    ? (process.env.ACCOUNT_MANAGER_PYTHONW || process.env.ACCOUNT_MANAGER_PYTHON)
    : process.env.ACCOUNT_MANAGER_PYTHON;
  if (env) candidates.push(env);

  // 2) 便携：工具目录下的 python/
  candidates.push(path.join(TOOL_DIR, 'python', exe));
  if (wantWindowless) candidates.push(path.join(TOOL_DIR, 'python', 'python.exe'));

  // 3) 旧布局：工具目录下的 toolkit/
  candidates.push(path.join(TOOL_DIR, 'toolkit', exe));
  if (wantWindowless) candidates.push(path.join(TOOL_DIR, 'toolkit', 'python.exe'));

  // 4) 向上找 toolkit/（工具还放在 OAS 仓库里时）
  let cur = TOOL_DIR;
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
    candidates.push(path.join(cur, 'toolkit', exe));
    if (wantWindowless) candidates.push(path.join(cur, 'toolkit', 'python.exe'));
  }

  for (const c of candidates) {
    if (c && exists(c)) return c;
  }

  // 5) PATH 上的 python（最后手段）
  if (!wantWindowless) {
    const dirs = String(process.env.PATH || '').split(path.delimiter);
    for (const d of dirs) {
      if (!d) continue;
      const p = path.join(d, 'python.exe');
      if (exists(p)) return p;
    }
  }
  return null;
}

/** 找 OAS 根（含 config/ 的那一层）；找不到返回 null */
function findOasRoot(explicit) {
  if (explicit) {
    return exists(path.join(explicit, 'config')) ? path.resolve(explicit) : null;
  }

  // 1) 环境变量
  const envRoot = String(process.env.OAS_ROOT || '').trim();
  if (envRoot && exists(path.join(envRoot, 'config'))) return path.resolve(envRoot);

  // 2) 从工具目录向上找（工具放在 OAS 里时）
  let cur = TOOL_DIR;
  for (let i = 0; i < 8; i++) {
    if (exists(path.join(cur, 'config'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * 给需要"真实配置样本"的检查用：返回一份配置文件的路径或 null。
 * 优先 OAS 根下的 config/*.json（排除 template.json）。
 */
function findSampleConfig() {
  const root = findOasRoot();
  if (!root) return null;
  const cfgDir = path.join(root, 'config');
  let names = [];
  try {
    names = fs.readdirSync(cfgDir).filter((n) => n.toLowerCase().endsWith('.json'));
  } catch (e) {
    return null;
  }
  const pick = names.find((n) => n.toLowerCase() !== 'template.json') || names[0];
  return pick ? path.join(cfgDir, pick) : null;
}

module.exports = {
  TOOL_DIR,
  findPython,
  findOasRoot,
  findSampleConfig,
  exists,
};
