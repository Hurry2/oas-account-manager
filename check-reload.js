/* 「重新加载」可靠性自检：防止三个已修复的根因回归。
 * 用法：node check-reload.js
 *
 * 2026-10-31 用户报「点击重新加载有时候不会刷新，需要连点几下才会正常刷新」。
 * 实测确认了三个独立根因，这里逐条守住：
 *
 *   1. 前端无并发守卫 —— 连点时多个 /api/list 同时在飞，先发的响应可能后到，
 *      把新数据覆盖成旧数据。已用 loadSeq 只认最后一次请求。
 *   2. 读取失败清空列表 —— OAS 式非原子写会让读取撞上半截 JSON，
 *      旧代码直接把 state.cards 清空，界面看起来"没刷新"（实际是空了）。
 *      现在失败时保留旧数据并提示。
 *   3. 服务端 backlog 太小 —— HTTP/1.0 每请求新建连接，默认
 *      request_queue_size=5，并发 8 就有约 1/9 被内核丢弃（fetch failed）。
 *      已抬到 128。
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

const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');

// ---------------------------------------------------------------- 1. 并发守卫
console.log('前端并发守卫（旧响应不覆盖新响应）:');
{
  check('loadList 有请求序号 loadSeq', /var loadSeq = 0;/.test(app));
  check('发出请求时递增并捕获序号', /var seq = \+\+loadSeq;/.test(app));
  check('成功回调先校验序号（过期就丢弃）',
    /\.then\(function \(data\) \{\s*\/\/[^\n]*\n\s*if \(seq !== loadSeq\) return;/.test(app)
    || /if \(seq !== loadSeq\) return;/.test(app));
  // catch 里也要校验，否则旧请求的失败会盖住新请求的结果
  const catchBlock = app.slice(app.indexOf('.catch(function (error) {', app.indexOf('function loadList')));
  check('失败回调也校验序号', /if \(seq !== loadSeq\) return;/.test(catchBlock.slice(0, 400)));

  // 反证：不能出现"无条件覆盖 state.cards"的写法
  const loadFn = app.slice(app.indexOf('function loadList'),
    app.indexOf('function syncJadeToggle'));
  check('成功路径先 return 过期请求再写 state.cards',
    loadFn.indexOf('if (seq !== loadSeq) return;') < loadFn.indexOf('state.cards = (data.cards'));
}

// ---------------------------------------------------------------- 2. 失败不清空
console.log('读取失败时保留旧数据:');
{
  const loadFn = app.slice(app.indexOf('function loadList'),
    app.indexOf('function syncJadeToggle'));
  const catchIdx = loadFn.indexOf('.catch(function (error) {');
  const catchBlock = loadFn.slice(catchIdx, catchIdx + 900);
  check('失败回调不再清空 state.cards', !/state\.cards = \[\]/.test(catchBlock),
    catchBlock.replace(/\s+/g, ' ').slice(0, 160));
  check('失败回调不再清空 state.original', !/state\.original = \[\]/.test(catchBlock));
  check('失败提示说明"界面仍是上一次的内容"', /界面仍是上一次的内容/.test(catchBlock));
  check('失败提示建议再点一次', /再点一次/.test(catchBlock));
}

// ---------------------------------------------------------------- 3. backlog
console.log('服务端连接排队（HTTP/1.0 每请求新建连接）:');
{
  check('自定义 server 类存在', /class _AccountServer\(ThreadingHTTPServer\)/.test(server));
  // 注意：类体里先是一段说明用法的 docstring，里面也写了
  // "socketserver 默认 request_queue_size = 5"，所以必须按行首缩进匹配真正的赋值。
  const queueMatch = server.match(/^    request_queue_size = (\d+)$/m);
  check('request_queue_size 已抬高（> 64）',
    !!queueMatch && Number(queueMatch[1]) > 64,
    queueMatch ? 'request_queue_size = ' + queueMatch[1] : '没找到赋值');
  check('_bind 用 _AccountServer 而不是裸 ThreadingHTTPServer',
    /return _AccountServer\(/.test(server));
  check('没有残留裸 ThreadingHTTPServer 实例化',
    !/return ThreadingHTTPServer\(/.test(server));
}

// ---------------------------------------------------------------- 4. 读取重试
console.log('后端读取重试（容忍半写文件）:');
{
  check('有 _read_json 重试封装', /def _read_json\(self, path: Path\)/.test(server));
  check('重试次数是常量', /READ_RETRIES\s*=\s*\d+/.test(server));
  const fn = server.slice(server.indexOf('def _read_json'), server.indexOf('def read_target'));
  check('捕获 ValueError 与 OSError', /except \(ValueError, OSError\)/.test(fn));
  check('read_target 走 _read_json', /def read_target[\s\S]{0,400}?self\._read_json\(path\)/.test(server));
  check('export_target / export_config 也走 _read_json',
    (server.match(/self\._read_json\(path\)/g) || []).length >= 3,
    '出现 ' + (server.match(/self\._read_json\(path\)/g) || []).length + ' 次');
  check('write_target 读盘也走 _read_json',
    /def write_target[\s\S]{0,1600}?self\._read_json\(path\)/.test(server));
}

// ---------------------------------------------------------------- 5. 行为验证
// 用最小 DOM stub 真跑一遍 loadList，确认乱序响应下界面取的是最后一次
console.log('行为验证（乱序响应）:');
{
  function makeElement(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], dataset: {},
      // app.js 用 setProperty/removeProperty 切换 --grid-cols
      style: {
        _props: {},
        setProperty(n, v) { this._props[n] = String(v); this[n] = String(v); },
        removeProperty(n) { delete this._props[n]; delete this[n]; },
        getPropertyValue(n) { return this._props[n] || ''; },
      },
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.unshift(c); return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
      append(...a) { a.forEach((c) => this.children.push(c)); },
      addEventListener() {}, removeEventListener() {},
      focus() {}, select() {}, scrollIntoView() {}, click() {},
      querySelectorAll() { return []; },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    };
    el.textContent = ''; el.innerHTML = ''; el.value = '';
    el.disabled = false; el.checked = false; el.className = '';
    el.title = ''; el.draggable = false;
    return el;
  }
  const elements = {};
  function getOrMake(id) {
    if (!elements[id]) {
      elements[id] = makeElement('div');
      elements[id].id = id;
      elements[id].selectedOptions = [];
      elements[id].options = [];
    }
    return elements[id];
  }
  const documentStub = {
    getElementById(id) { return getOrMake(id); },
    createElement(t) { return makeElement(t); },
    createTextNode(t) { const el = makeElement('#text'); el.textContent = String(t); return el; },
    addEventListener() {}, body: makeElement('body'),
    querySelector() { return makeElement('main'); },
    querySelectorAll() { return []; },
  };
  const windowStub = {
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] === undefined ? null : this._data[k]; },
      setItem(k, v) { this._data[k] = String(v); },
    },
    addEventListener() {},
    outerWidth: 1280, outerHeight: 860, screenX: 0, screenY: 0,
    AccountCore: require('./core.js'),
  };

  // 可控 fetch：每次调用返回一个我们能手动 resolve 的 promise
  const pendingFetches = [];
  const fetchStub = function (url) {
    if (String(url).indexOf('/api/list') < 0) return new Promise(function () {});
    let resolveFn;
    const p = new Promise(function (resolve) { resolveFn = resolve; });
    pendingFetches.push({ url: String(url), resolve: resolveFn });
    return p;
  };

  let src = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const tail = '})();';
  const idx = src.lastIndexOf(tail);
  const probe = `
    window.__probe = {
      loadList: loadList,
      state: state,
      getCards: function () { return state.cards; },
      getStatus: function () { return document.getElementById('status').textContent; },
    };
  `;
  src = src.slice(0, idx) + probe + '\n' + tail + src.slice(idx + tail.length);

  const wrapper = new Function('document', 'window', 'fetch', 'navigator', 'confirm',
    'alert', 'localStorage', 'URL', 'Blob', 'setTimeout', 'clearTimeout',
    'setInterval', src);
  const globals = {
    document: documentStub, window: windowStub, fetch: fetchStub,
    navigator: { clipboard: null }, confirm: () => true, alert: () => {},
    localStorage: windowStub.localStorage,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {}, setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0,
  };
  globals.globalThis = globals;
  wrapper.call(globals, documentStub, windowStub, fetchStub, globals.navigator,
    globals.confirm, globals.alert, windowStub.localStorage, globals.URL,
    globals.Blob, globals.setTimeout, globals.clearTimeout, globals.setInterval);

  const probeApi = windowStub.__probe;
  probeApi.state.config = 'test';
  probeApi.state.target = 'assist_battle';
  probeApi.state.jade = true;

  // 发出两次 loadList（模拟连点两下）
  probeApi.loadList();
  probeApi.loadList();

  const listCalls = pendingFetches.filter((f) => f.url.indexOf('/api/list') >= 0);
  check('两次 loadList 发出两个请求', listCalls.length === 2,
    '实际 ' + listCalls.length);

  function payload(time) {
    return {
      ok: true, config: 'test', target: 'assist_battle', label: '一键协战',
      jade: true, mtime: time, missing: false,
      cards: [{
        character: '银月二号', svr: '遥远之忆', account: 'a@b.com',
        account_alias: '', apple_or_android: true,
        last_complete_time: time, jade_status: '普勾',
        jade_complete_time: '2026-10-29 09:00:00',
      }],
    };
  }

  function respond(call, body) {
    call.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(body),
    });
  }

  if (listCalls.length === 2) {
    // 故意乱序：第 2 次（新）先到，第 1 次（旧）后到
    respond(listCalls[1], payload('2026-10-31 08:22:00'));
    respond(listCalls[0], payload('2026-10-31 08:11:00'));
  }

  // 让 promise 链跑完
  const done = new Promise((resolve) => setTimeout(resolve, 60));
  check('（异步断言见下）', true);
  global.__finish = () => {
    const cards = probeApi.getCards();
    const stamp = cards.length ? cards[0].last_complete_time : '(空)';
    check('乱序响应下保留的是最后一次请求的数据',
      stamp === '2026-10-31 08:22:00', '实际 ' + stamp);
    check('列表没有被旧响应覆盖', cards.length === 1, '卡数 ' + cards.length);

    if (failures.length) {
      console.log('');
      console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
      process.exit(1);
    }
    console.log('');
    console.log('全部通过');
  };
  done.then(() => global.__finish());
}
