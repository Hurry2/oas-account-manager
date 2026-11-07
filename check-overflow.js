/* 按钮文字溢出扫描（真浏览器）：需要服务在跑，否则跳过。
 * 用法：node check-overflow.js [--server URL]
 *
 * 背景（2026-11-01）：用户反馈"删除按键里的删除俩字有点超出按钮了"。
 * 静态检查（check-button-fit.js）只能看列数声明，真正会不会溢出
 * 取决于浏览器算出来的盒子尺寸 —— 这里用 CDP 量真实包围盒。
 *
 * 做法：遍历所有可见 button，用 Range 取文字的实际矩形，
 * 和按钮自身的矩形比，任一方向超出 > 0.5px 就算溢出。
 * 覆盖 4 种窗口宽度 × 4 个视图/面板组合。
 */
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

// 工具自身目录（不再假设放在 OAS 仓库第 4 层）
const toolDir = __dirname;

// 命令行拿服务地址，默认 22299
const argServer = (() => {
  const i = process.argv.indexOf('--server');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'http://127.0.0.1:22299';
})();
const PORT = Number(new URL(argServer).port || 22299);

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chrome = chromeCandidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws')); });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' +
        ((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  }
}

const SCAN = `(() => {
  const bad = [];
  document.querySelectorAll('button').forEach(function (b) {
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(b);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const range = document.createRange();
    range.selectNodeContents(b);
    const t = range.getBoundingClientRect();
    if (t.width < 0.5) return;
    const over = {
      l: +(r.left - t.left).toFixed(2),
      r: +(t.right - r.right).toFixed(2),
      t: +(r.top - t.top).toFixed(2),
      b: +(t.bottom - r.bottom).toFixed(2),
    };
    if (over.l > 0.5 || over.r > 0.5 || over.t > 0.5 || over.b > 0.5) {
      bad.push({
        text: (b.textContent || '').slice(0, 8),
        id: b.id || '',
        cls: String(b.className || ''),
        btn: [+r.width.toFixed(1), +r.height.toFixed(1)],
        txt: [+t.width.toFixed(1), +t.height.toFixed(1)],
        over: over,
      });
    }
  });
  return bad;
})()`;

const failures = [];
function check(name, ok, detail) {
  log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures.push(name);
}

(async () => {
  // 服务不在跑就跳过（和其他需要服务的检查一致）
  let alive = false;
  try {
    const r = await fetch(argServer + '/api/ping');
    alive = r.ok;
  } catch (e) { alive = false; }
  if (!alive) {
    log('跳过：服务未启动（' + argServer + '）');
    return;
  }
  if (!chrome) {
    log('跳过：找不到 Chrome / Edge');
    return;
  }

  const TMP = path.join(toolDir, '.tmp-overflow-run');
  const DBG = 9260;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'profile'), { recursive: true });

  let chromeProc;
  try {
    chromeProc = spawn(chrome, ['--headless=new', '--remote-debugging-port=' + DBG,
      '--user-data-dir=' + path.join(TMP, 'profile'), '--no-first-run',
      '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
      '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

    let target = null;
    for (let i = 0; i < 100; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + DBG + '/json/list')).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* retry */ }
      await sleep(200);
    }
    if (!target) { log('跳过：拿不到 Chrome 调试端口'); return; }

    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 找一个有数据的配置
    let cfg = '';
    try {
      const meta = await (await fetch(argServer + '/api/configs')).json();
      cfg = (meta.configs || []).filter((c) => c !== 'template')[0] || (meta.configs || [])[0] || '';
    } catch (e) { /* 忽略 */ }

    for (const w of [1400, 1100, 900, 760]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: argServer + '/' });
      await sleep(2600);

      if (cfg) {
        await cdp.eval(`(() => {
          const cs = document.getElementById('config-select');
          if (!cs) return 0;
          const opt = Array.from(cs.options).find(o => o.value === ${JSON.stringify(cfg)});
          if (opt) { cs.value = opt.value; cs.dispatchEvent(new Event('change')); }
          return 1;
        })()`);
        await sleep(1300);
      }
      await cdp.eval(`(() => {
        const j = document.getElementById('jade-toggle');
        if (j && !j.checked) { j.checked = true; j.dispatchEvent(new Event('change')); }
        return 1;
      })()`);
      await sleep(800);

      log('');
      log('=== 窗口宽 ' + w + 'px ===');

      let bad = await cdp.eval(SCAN);
      check('列表视图：按钮文字不溢出', bad.length === 0, JSON.stringify(bad.slice(0, 4)));

      await cdp.eval("document.getElementById('btn-view-grid').click()");
      await sleep(900);
      bad = await cdp.eval(SCAN);
      check('方块视图：按钮文字不溢出', bad.length === 0, JSON.stringify(bad.slice(0, 4)));

      await cdp.eval("document.querySelector('#list .card .actions button:nth-child(2)').click()");
      await sleep(700);
      bad = await cdp.eval(SCAN);
      check('编辑面板：按钮文字不溢出', bad.length === 0, JSON.stringify(bad.slice(0, 4)));
      await cdp.eval("document.getElementById('btn-editor-cancel').click()");
      await sleep(300);

      await cdp.eval("document.getElementById('btn-paste').click()");
      await sleep(700);
      bad = await cdp.eval(SCAN);
      check('批量粘贴面板：按钮文字不溢出', bad.length === 0, JSON.stringify(bad.slice(0, 4)));
      await cdp.eval("document.getElementById('btn-paste-cancel').click()");
      await sleep(300);

      await cdp.eval("document.getElementById('btn-view-list').click()");
      await sleep(400);
    }

    log('');
    if (failures.length) {
      log('失败 ' + failures.length + ' 项：' + failures.join(', '));
      process.exitCode = 1;
    } else {
      log('全部通过');
    }
  } catch (e) {
    log('跳过：' + e.message);
  } finally {
    try { chromeProc && chromeProc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
})();
