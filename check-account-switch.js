/* 切号执行任务（AccountSwitch）适配自检
 * 用法：node check-account-switch.js
 *
 * 背景（2026-11-07）：用户说"新增了一个账号切换多任务 accountswitch，
 * 也适配一下这个工具"。
 *
 * 该任务的账号列表（account_list_N）工具早就能读写，但有两个特有语义
 * 之前没适配：
 *
 *   1. `current_index` —— 轮换指针，记录"下一个该切哪个号"，脚本自动维护。
 *      工具里删除/重排账号后指针会指错人（删掉第 1 个后指针还指 1，
 *      就跳过一个号）。现在保存时越界会归零。
 *   2. `trigger_all_enabled_tasks` —— 切完号是否触发所有已启用任务，
 *      用户需要能看见当前值。
 *
 * 静态部分读 server.py / app.js / ui.html；行为部分真的起服务跑一遍。
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = require('./env.js');

// 工具自身目录（不再假设放在 OAS 仓库的第 4 层）
const toolDir = __dirname;
const python = env.findPython(false);
const oasRoot = env.findOasRoot();
const sampleCfg = env.findSampleConfig();

if (!python || !sampleCfg) {
  console.log('跳过：需要 Python 解释器和一份真实 OAS 配置样本');
  console.log('      ' + (!python ? '找不到解释器' : '找不到配置样本')
    + '（设置 OAS_ROOT 或 ACCOUNT_MANAGER_PYTHON）');
  process.exit(0);
}

const failures = [];
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push(name);
    console.log('  FAIL ' + name + ' -> ' + e.message);
  }
}

const server = fs.readFileSync(path.join(__dirname, 'server.py'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');

// ---------------------------------------------------------------- 静态：目标定义
console.log('目标定义:');
{
  check('TARGETS 里有 account_switch', () => {
    assert.ok(/['"]account_switch['"]\s*:\s*\{/.test(server), '缺少 account_switch 定义');
  });

  check('列表键是 account_list', () => {
    const m = /['"]account_switch['"]\s*:\s*\{([\s\S]*?)\n    \}/.exec(server);
    assert.ok(m, '取不到 account_switch 段');
    assert.ok(/'list_key':\s*'account_list'/.test(m[1]), m[1]);
  });

  check('计数键是 account_switch_config.switch_account_count', () => {
    const m = /['"]account_switch['"]\s*:\s*\{([\s\S]*?)\n    \}/.exec(server);
    assert.ok(/'count_groups':\s*\['account_switch_config'\]/.test(m[1]), m[1]);
    assert.ok(/'count_key':\s*'switch_account_count'/.test(m[1]), m[1]);
  });

  check('声明了轮换指针 cursor_key = current_index', () => {
    const m = /['"]account_switch['"]\s*:\s*\{([\s\S]*?)\n    \}/.exec(server);
    assert.ok(/'cursor_key':\s*'current_index'/.test(m[1]),
      '缺 cursor_key，删/重排账号后指针会指错人');
  });

  check('extra_keys 含 current_index 与 trigger_all_enabled_tasks', () => {
    const m = /['"]account_switch['"]\s*:\s*\{([\s\S]*?)\n    \}/.exec(server);
    assert.ok(/'extra_keys'/.test(m[1]), '缺 extra_keys');
    assert.ok(/current_index/.test(m[1]) && /trigger_all_enabled_tasks/.test(m[1]), m[1]);
  });

  check('这个任务没有勾协字段（jade 未开启）', () => {
    const m = /['"]account_switch['"]\s*:\s*\{([\s\S]*?)\n    \}/.exec(server);
    assert.ok(!/['"]jade['"]:\s*True/.test(m[1]), '不该给切号任务加勾协字段');
  });
}

// ---------------------------------------------------------------- 静态：指针修正
console.log('指针修正逻辑:');
{
  check('write_target 里有 cursor 越界归零', () => {
    assert.ok(/cursor_key/.test(server), '没有用到 cursor_key');
    assert.ok(/count_group\[cursor_key\] = 0/.test(server),
      '没有把越界指针归零的代码');
  });

  check('归零条件覆盖"删到更少"的情况', () => {
    // cursor >= max(1, len(cards)) 才算越界
    assert.ok(/cursor >= max\(1, len\(cards\)\)/.test(server),
      '越界判断没考虑列表变短');
  });
}

// ---------------------------------------------------------------- 静态：前端展示
console.log('前端展示:');
{
  check('ui.html 有 task-info 容器', () => {
    assert.ok(/id="task-info"/.test(html), '缺 task-info 容器');
  });

  check('app.js 有 renderTaskInfo', () => {
    assert.ok(/function renderTaskInfo/.test(app), '缺 renderTaskInfo');
    assert.ok(/renderTaskInfo\(\);/.test(app), 'render 里没调用 renderTaskInfo');
  });

  check('state 里有 extra 字段', () => {
    assert.ok(/extra:\s*\{\}/.test(app), 'state 缺 extra');
  });

  check('loadList 会把 data.extra 存进 state', () => {
    assert.ok(/state\.extra = data\.extra \|\| \{\}/.test(app), 'loadList 没接 extra');
  });

  check('save 后会用返回的 extra 刷新', () => {
    assert.ok(/if \(data\.extra\) state\.extra = data\.extra/.test(app),
      '保存后没刷新 extra（指针归零后界面不会更新）');
  });

  check('ui.css 有 .taskinfo 样式', () => {
    assert.ok(/\.taskinfo\s*\{/.test(css), '缺 .taskinfo 样式');
  });
}

// ---------------------------------------------------------------- 行为：真起服务
console.log('行为验证（真起服务）:');
{
  const TMP = path.join(toolDir, '.tmp-swtest');
  const root = path.join(TMP, 'root');
  const cfgDir = path.join(root, 'config');
  const PORT = 22397;

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(cfgDir, { recursive: true });

  // 造配置：4 个账号，指针指向第 2 个（index=1）
  const base = JSON.parse(fs.readFileSync(sampleCfg, 'utf8'));
  const sw = base.account_switch;
  for (const k of Object.keys(sw)) {
    if (/^account_list_\d+$/.test(k)) delete sw[k];
  }
  sw.account_switch_config = {
    usage: '',
    switch_account_count: 4,
    trigger_all_enabled_tasks: false,
    current_index: 1,
  };
  ['甲一号', '乙二号', '丙三号', '丁四号'].forEach((name, i) => {
    sw['account_list_' + (i + 1)] = {
      character: name, svr: '测试服', account: 'u' + i + '@x.com',
      account_alias: '', apple_or_android: i % 2 === 0,
      last_complete_time: '2023-01-01 00:00:00',
    };
  });
  const cfgPath = path.join(cfgDir, 'sw.json');
  fs.writeFileSync(cfgPath, JSON.stringify(base, null, 4), 'utf8');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const proc = spawn(python, ['-B', path.join(__dirname, 'server.py'),
    '--port', String(PORT), '--root', root, '--no-browser'],
  { cwd: toolDir, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});

  const api = async (p, opts) => {
    const r = await fetch('http://127.0.0.1:' + PORT + p, opts);
    return r.json();
  };

  // 同步执行（node 顶层没有 await，用 deasync 风格不好搞，这里用同步子进程）
  const { execFileSync } = require('node:child_process');
  const script = `
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const BASE = 'http://127.0.0.1:${PORT}';
  const api = async (p, o) => (await fetch(BASE + p, o)).json();
  for (let i = 0; i < 80; i++) {
    try { if ((await api('/api/ping')).ok) break; } catch (e) {}
    await sleep(150);
  }
  const out = {};

  // 1. 读取：extra 应含 current_index 和 trigger_all_enabled_tasks
  const list = await api('/api/list?config=sw&target=account_switch');
  out.read = {
    label: list.label,
    cards: list.cards.length,
    count: list.count_value,
    extra: list.extra,
    jade: list.jade,
  };

  // 2. 删掉第 1 个（4->3），指针原来 1，应仍在范围内（1 < 3）不变
  const kept = list.cards.slice(1);
  const saved1 = await api('/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: 'sw', target: 'account_switch',
      cards: kept, mtime: list.mtime }),
  });
  out.save1 = { ok: saved1.ok, count: saved1.count_value, extra: saved1.extra };

  // 3. 再删到只剩 1 个，指针 1 越界（1 >= 1），应归零
  const list2 = await api('/api/list?config=sw&target=account_switch');
  const saved2 = await api('/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: 'sw', target: 'account_switch',
      cards: list2.cards.slice(0, 1), mtime: list2.mtime }),
  });
  out.save2 = { ok: saved2.ok, count: saved2.count_value, extra: saved2.extra };

  // 4. 重新读一次确认落盘
  const list3 = await api('/api/list?config=sw&target=account_switch');
  out.reread = { cards: list3.cards.length, extra: list3.extra };

  console.log(JSON.stringify(out));
})();
`;
  let result = null;
  try {
    const stdout = execFileSync(process.execPath, ['-e', script],
      { encoding: 'utf8', timeout: 60000 });
    result = JSON.parse(stdout.trim().split('\n').pop());
  } catch (e) {
    console.log('  FAIL 行为测试执行失败 -> ' + e.message);
    failures.push('行为测试执行');
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  if (result) {
    check('读取：能拿到 4 张卡', () => {
      assert.strictEqual(result.read.cards, 4, JSON.stringify(result.read));
    });
    check('读取：计数 4', () => {
      assert.strictEqual(result.read.count, 4);
    });
    check('读取：返回 current_index', () => {
      assert.strictEqual(result.read.extra.current_index, 1,
        JSON.stringify(result.read.extra));
    });
    check('读取：返回 trigger_all_enabled_tasks', () => {
      assert.strictEqual(result.read.extra.trigger_all_enabled_tasks, false,
        JSON.stringify(result.read.extra));
    });
    check('读取：切号任务不带勾协字段', () => {
      assert.strictEqual(result.read.jade, false);
    });

    check('删 1 个后指针仍在范围内，保持不变', () => {
      assert.strictEqual(result.save1.count, 3);
      assert.strictEqual(result.save1.extra.current_index, 1,
        '指针不该被动：' + JSON.stringify(result.save1.extra));
    });

    check('删到只剩 1 个时指针越界归零', () => {
      assert.strictEqual(result.save2.count, 1);
      assert.strictEqual(result.save2.extra.current_index, 0,
        '指针应归零：' + JSON.stringify(result.save2.extra));
    });

    check('重新读取确认指针已落盘为 0', () => {
      assert.strictEqual(result.reread.extra.current_index, 0,
        JSON.stringify(result.reread.extra));
      assert.strictEqual(result.reread.cards, 1);
    });
  }
}

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过（' + passed + ' 项）');
