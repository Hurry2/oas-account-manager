/* 账号列表管理 —— 页面逻辑（纯 DOM，无框架）
 * 业务纯函数在 core.js（window.AccountCore），这里只负责交互与渲染。
 */
(function () {
  'use strict';

  var Core = window.AccountCore;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    config: '',
    target: 'assist_battle',
    cards: [],
    original: [],
    mtime: null,
    dirty: false,
    editingIndex: -1,
    dragIndex: -1,
    dropIndex: -1,
    dropAfter: false,
    selected: {},      // 多选删除：index -> true
    jade: false,       // 当前列表是否带勾协字段（一键协战才有）
    extra: {},         // 任务特有的只读字段（切号任务：current_index 等）
  };

  // ------------------------------------------------------------------ 提示
  function toast(text, isError) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = ''; }, 2600);
  }

  function setStatus(text, kind) {
    var el = $('status');
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------------ 渲染
  /** 当前视图：'list'（默认竖排）| 'grid'（方块网格） */
  var viewMode = 'list';
  var VIEW_KEY = 'account-manager.view';

  /**
   * 方块视图每行几张卡。
   * 用户账号一般是 4 个一组，固定 4 列时一组正好占满一行，扫起来不用横向找。
   * 'auto' = 按窗口宽度自动排列（原来的行为）。
   */
  var gridCols = 'auto';
  var GRID_COLS_KEY = 'account-manager.gridCols';
  var GRID_COLS_VALUES = ['auto', '2', '3', '4', '6', '8'];

  function setGridCols(value) {
    gridCols = GRID_COLS_VALUES.indexOf(String(value)) >= 0 ? String(value) : 'auto';
    try { localStorage.setItem(GRID_COLS_KEY, gridCols); } catch (e) { /* 隐私模式忽略 */ }
    syncGridColsUi();
    render();
  }

  /** 把每行张数同步到选择框、CSS 变量，并决定该选项是否可用 */
  function syncGridColsUi() {
    var sel = $('grid-cols');
    var field = $('grid-cols-field');
    if (sel) sel.value = gridCols;
    // 只有方块视图才用得上；列表视图下置灰（但保留记忆）
    var usable = viewMode === 'grid';
    if (field) {
      field.style.opacity = usable ? '1' : '0.45';
      field.title = usable
        ? '方块视图每行放几张卡。账号一般 4 个一组，固定 4 列正好一组占满一行'
        : '切到「▦ 方块」视图后才能设置每行张数';
    }
    if (sel) sel.disabled = !usable;
    // 只负责 CSS 变量；fixed-cols 这个 class 由 render() 统一挂
    // （render 会重置 className，两处都管容易打架）
    var list = $('list');
    if (list) {
      if (gridCols === 'auto') list.style.removeProperty('--grid-cols');
      else list.style.setProperty('--grid-cols', gridCols);
    }
  }

  function setView(mode) {
    viewMode = mode === 'grid' ? 'grid' : 'list';
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) { /* 隐私模式忽略 */ }
    syncViewButtons();
    syncGridColsUi();
    render();
  }

  function syncViewButtons() {
    $('btn-view-list').className = viewMode === 'list' ? 'active' : '';
    $('btn-view-grid').className = viewMode === 'grid' ? 'active' : '';
  }

  function render() {
    var list = $('list');
    list.textContent = '';
    // fixed-cols 要一起带上：render 会重置 className，丢了它列数就回退成 auto
    list.className = viewMode === 'grid'
      ? 'grid-view' + (gridCols === 'auto' ? '' : ' fixed-cols')
      : '';
    // 方块视图下外层容器铺满窗口宽度
    document.querySelector('main').className = viewMode === 'grid' ? 'grid-mode' : '';

    var dupKeys = {};
    Core.duplicateKeys(state.cards).forEach(function (k) { dupKeys[k] = true; });

    var filter = $('run-filter') ? $('run-filter').value : 'all';
    var jadeFilter = $('jade-filter') ? $('jade-filter').value : 'all';
    var jadeToggle = $('jade-toggle');
    var showJade = jadeToggle ? jadeToggle.checked : false;
    var showBattle = $('battle-toggle') ? $('battle-toggle').checked : true;
    var visible = 0;
    var hidden = 0;

    state.cards.forEach(function (card, index) {
      // 筛选只隐藏显示，不改变实际顺序（所以 index 仍是真实下标）
      if (showBattle && filter !== 'all' && Core.runState(card) !== filter) {
        hidden += 1;
        return;
      }
      // 勾协筛选：无勾/普勾/现勾 只算本周期已确认的；
      // 「勾协已过期」专门捞上个周期查出来的（用户要求单独能筛出来）；
      // 具体判定在 Core.matchesJadeFilter 里，和概览的统计口径一致。
      if (showJade && jadeFilter !== 'all'
          && !Core.matchesJadeFilter(card, jadeFilter)) {
        hidden += 1;
        return;
      }
      visible += 1;
      if (viewMode === 'grid') {
        // 方块视图：紧凑网格，插入位置靠卡片间的悬停提示条
        list.appendChild(buildCard(card, index, dupKeys, true, showJade, showBattle));
      } else {
        list.appendChild(buildInsertBar(index));
        list.appendChild(buildCard(card, index, dupKeys, false, showJade, showBattle));
      }
    });
    // 末尾插入条（仅列表视图）
    if (viewMode !== 'grid') {
      list.appendChild(buildInsertBar(state.cards.length));
    }

    if (state.cards.length === 0) {
      var tip = document.createElement('div');
      tip.className = 'hint';
      tip.style.padding = '16px 2px';
      tip.textContent = '当前列表为空。点「＋ 在末尾添加」或「批量粘贴导入」。';
      list.insertBefore(tip, list.firstChild);
    } else if (visible === 0 && hidden > 0) {
      var filterName = showBattle
        ? $('run-filter').selectedOptions[0].textContent
        : '';
      var extra = showJade && jadeFilter !== 'all'
        ? (filterName ? ' + ' : '')
        + $('jade-filter').selectedOptions[0].textContent
        : '';
      var none = document.createElement('div');
      none.className = 'hint';
      none.style.padding = '16px 2px';
      none.textContent = '没有符合「' + (filterName + extra)
        + '」的账号（共 ' + hidden + ' 个被筛选隐藏）。';
      // 按类型筛选时，过期的不算进任何类型。如果确实有这种卡，
      // 要明说一句，否则用户会以为"一个都没有"（其实是没重查）。
      // 「已过期」本身就是在捞过期的，不用再提示。
      if (showJade && jadeFilter !== 'all' && jadeFilter !== 'none'
          && jadeFilter !== 'stale') {
        var staleSame = state.cards.filter(function (c) {
          var info = Core.describeJade(c);
          return info.state === 'stale' && info.kind === jadeFilter;
        }).length;
        if (staleSame) {
          none.textContent += '\n另有 ' + staleSame + ' 个「' + jadeFilter
            + '」是上个周期查的（已过期），本周期还没重查，不计入这里。'
            + '\n要看它们，把「勾协类型」切到「勾协已过期」。';
          none.style.whiteSpace = 'pre-wrap';
        }
      }
      list.insertBefore(none, list.firstChild);
    }

    renderStat();
    renderTaskInfo();
    syncSelectionBar();
    refreshDirty();
  }

  /**
   * 任务特有的只读信息条（目前只有「切号执行任务」用）。
   *
   * 切号任务有个 current_index 轮换指针，记录"下一个该切哪个号"，
   * 由脚本自己维护。工具里重排/删号会让它指错人，所以这里显示出来，
   * 让用户知道下次会切哪个号；保存时后端会做越界归零。
   */
  function renderTaskInfo() {
    var box = $('task-info');
    if (!box) return;
    var extra = state.extra || {};
    // 只认切号任务（有 current_index 才算）
    if (extra.current_index === undefined && extra.trigger_all_enabled_tasks === undefined) {
      box.style.display = 'none';
      box.textContent = '';
      return;
    }

    var total = state.cards.length;
    var idx = Number(extra.current_index);
    if (isNaN(idx) || idx < 0 || idx >= Math.max(1, total)) idx = 0;
    var nextCard = state.cards[idx];
    var nextName = nextCard && nextCard.character ? nextCard.character : '（空角色）';
    var nextSvr = nextCard && nextCard.svr ? nextCard.svr : '';

    var parts = [];
    parts.push('下次切到：第 ' + (idx + 1) + '/' + Math.max(1, total) + ' 个 · '
      + nextName + (nextSvr ? '（' + nextSvr + '）' : ''));
    parts.push('切完是否触发所有已启用任务：'
      + (extra.trigger_all_enabled_tasks === false ? '否' : '是'));
    if (state.dirty) {
      parts.push('⚠ 列表有改动，保存后会按新顺序重新计算指针');
    }
    box.textContent = parts.join('　|　');
    box.title = 'current_index 由脚本自动维护，记录下一个要切的账号。\n'
      + '在工具里删除/重排账号后，保存时若指针越界会自动归零。';
    box.style.display = '';
  }

  function buildInsertBar(index) {
    var bar = document.createElement('div');
    bar.className = 'insert-bar';
    bar.dataset.insert = String(index);

    var left = document.createElement('div');
    left.className = 'line';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '＋ 插入到第 ' + (index + 1) + ' 位';
    btn.onclick = function () {
      state.cards.splice(index, 0, Core.emptyCard());
      render();
      openEditor(index);
    };
    var right = document.createElement('div');
    right.className = 'line';
    bar.append(left, btn, right);

    bar.onmouseenter = function () { bar.classList.add('on'); };
    bar.onmouseleave = function () { bar.classList.remove('on'); };
    return bar;
  }

  function buildCard(card, index, dupKeys, compact, showJade, showBattle) {
    var blank = Core.isBlank(card);
    var android = Core.isAndroid(card);

    /**
     * 协战完成时间的展示文案（row2 用，比 run.text 多带日期）。
     * 「从未执行」不用时间；其余统一带日期，第一次用也能看懂时间指什么。
     */
    function battleTimeText(runInfo) {
      if (runInfo.state === Core.RUN_STATE.never) return '从未执行';
      return runInfo.text;   // 形如「今天 08:17」「昨天 18:17」「3 天前 07:00」「10-20 09:30」
    }

    var el = document.createElement('div');
    // run-xxx 让整张卡带上状态色条（见 ui.css），比只看小标签更显眼；
    // 关闭"显示协战"时不按协战状态着色（只挂勾协的配置没有协战状态可言）
    var runStatus = showBattle ? Core.runState(card) : 'off';
    el.className = 'card run-' + runStatus
      + (compact ? ' compact' : '')
      + (blank ? ' empty' : '')
      + (state.selected[index] ? ' selected' : '');
    el.dataset.index = String(index);
    el.dataset.runState = runStatus;
    el.draggable = true;

    var handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '⠿';
    handle.title = '拖动排序';

    var idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = String(index + 1);

    var main = document.createElement('div');
    main.className = 'main';
    var row1 = document.createElement('div');
    row1.className = 'row1';
    var char = document.createElement('span');
    char.className = 'char';
    char.textContent = blank ? '（角色名为空）' : card.character;
    var acc = document.createElement('span');
    acc.className = 'acc';
    acc.textContent = card.account || '（无账号）';
    row1.append(char, acc);

    // 运行状态：今天已执行 / 今天未执行 / 从未执行（一眼可辨，见 ui.css）
    // 关闭"显示协战"时不显示协战相关标签（只挂勾协的配置没有这个概念）
    var run = Core.describeRunTime(card);
    if (showBattle) {
      var runTag = document.createElement('span');
      runTag.className = 'tag run ' + run.state;
      runTag.textContent = '协战 ' + {
        today: '✓ 已执行',
        stale: '未执行',
        never: '从未执行',
      }[run.state];
      runTag.title = '协战上次执行：' + (card.last_complete_time || '（无记录）');
      row1.appendChild(runTag);
    }

    // 勾协类型 + 检查时间（一键协战列表 + 用户开启显示时）
    if (showJade && state.jade && !blank) {
      var jade = Core.describeJade(card);
      var jadeTag = document.createElement('span');
      jadeTag.className = 'tag jade ' + jade.state;
      // 标签同时显示类型和时间：勾协 普勾 16:04 / 勾协 无勾 10-28 15:43
      jadeTag.textContent = jade.kind === 'none'
        ? '勾协 未查'
        : '勾协 ' + jade.kind + ' ' + jade.time;
      jadeTag.title = '勾协类型：' + (jade.kind === 'none' ? '从未查找' : jade.kind)
        + '\n检查时间：' + (card.jade_complete_time || '（无记录）')
        + (jade.state === 'stale' ? '\n⚠️ 上次检查已过期（5:00 / 18:00 刷新）' : '')
        + '\n按 5:00 / 18:00 刷新点判断是否需要重新查找';
      row1.appendChild(jadeTag);
    }

    var row2 = document.createElement('div');
    row2.className = 'row2';
    if (compact) {
      // 方块视图：信息压缩成一行时间 + 系统角标，其余进悬浮提示
      if (showBattle) {
        var miniTime = document.createElement('span');
        miniTime.className = 'tag time ' + run.state;
        miniTime.textContent = run.state === Core.RUN_STATE.never
          ? '协战 从未'
          : '协战 ' + run.text;
        miniTime.title = '协战上次完成：'
          + (card.last_complete_time || '（无记录）')
          + '\n每天 0 点刷新，完成后当天会被跳过';
        row2.appendChild(miniTime);
      }
      var plat = document.createElement('span');
      plat.className = 'tag ' + (android ? 'android' : 'ios');
      plat.textContent = android ? '安' : 'iOS';
      row2.appendChild(plat);
      // 区服：方块视图也要显示（放不下完整名字时由 CSS 省略号截断）
      if (card.svr) {
        var miniSvr = document.createElement('span');
        miniSvr.className = 'tag svr';
        miniSvr.textContent = card.svr;
        miniSvr.title = '区服：' + card.svr;
        row2.appendChild(miniSvr);
      }
      var numeric = Core.extractNumericId(card.character);
      if (numeric !== null) {
        var miniId = document.createElement('span');
        miniId.className = 'tag idtag';
        miniId.textContent = '#' + numeric;
        row2.appendChild(miniId);
      }
    } else {
      if (showBattle) {
        // 协战完成时间（带前缀说明 + 完整日期，第一次用也能看懂）
        var timeTag = document.createElement('span');
        timeTag.className = 'tag time ' + run.state;
        timeTag.textContent = '协战 ' + battleTimeText(run);
        timeTag.title = '协战上次完成：'
          + (card.last_complete_time || '（无记录）')
          + '\n协战每天 0 点刷新，完成后当天会被跳过'
          + '（skip_completed_account_enable）';
        row2.appendChild(timeTag);
      }
      row2.appendChild(tag(android ? '安卓' : 'iOS', android ? 'android' : 'ios'));
      if (card.svr) row2.appendChild(tag(card.svr, ''));
      if (card.account_alias) row2.appendChild(tag('别名 ' + card.account_alias, 'alias'));
      var numericId = Core.extractNumericId(card.character);
      if (numericId !== null) {
        row2.appendChild(tag('编号 ' + numericId, 'idtag'));
      }
    }
    if (card.account && card.character && dupKeys[Core.cardKey(card)]) {
      row2.appendChild(tag('重复账号+角色', 'dup'));
    }
    if (blank) row2.appendChild(tag('不会执行', 'warn'));
    main.append(row1, row2);

    var actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      iconButton('⧉', '复制「区服-角色名-勾协类型」', blank,
        function () { copyCardSummary(card); }),
      iconButton('✎', '编辑', false, function () { openEditor(index); }),
      iconButton('↑', '上移', index === 0, function () { move(index, index - 1); }),
      iconButton('↓', '下移', index === state.cards.length - 1, function () { move(index, index + 1); }),
      delButton(index)
    );

    if (compact) {
      // 方块视图：完整信息放在悬浮提示里；编辑/删除按钮竖排保留
      var lines = [
        card.character || '（空）',
        '服务器: ' + (card.svr || '—'),
        '账号: ' + (card.account || '—'),
        '系统: ' + (android ? '安卓' : 'iOS'),
      ];
      if (showBattle) {
        lines.push('协战: ' + (card.last_complete_time || '（无记录）'));
      }
      if (showJade && state.jade) {
        var jd = Core.describeJade(card);
        lines.push('勾协: ' + (jd.kind === 'none' ? '从未查找' : jd.kind)
          + '（' + (card.jade_complete_time || '无记录') + '）');
      }
      lines.push('（点卡片选中 · 点 ✎ 编辑 · 拖动排序）');
      el.title = lines.join('\n');
      // 方块里不放 ↑↓（网格里上下移意义不大，拖拽更自然），保留复制/✎/删除
      actions.textContent = '';
      actions.appendChild(iconButton('⧉', '复制「区服-角色名-勾协类型」', blank,
        function () { copyCardSummary(card); }));
      actions.appendChild(iconButton('✎', '编辑', false, function () { openEditor(index); }));
      actions.appendChild(delButton(index));
    }

    el.append(handle, idx, main, actions);
    // 多选：整卡点击切换选中（编辑走铅笔按钮，避免冲突）
    el.onclick = function (e) {
      if (e.target.closest('button')) return;
      toggleSelect(index, e.shiftKey);
    };

    el.ondragstart = function (e) {
      state.dragIndex = index;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) { /* Firefox 需要 */ }
    };
    el.ondragend = function () {
      state.dragIndex = -1;
      state.dropIndex = -1;
      render();
    };
    el.ondragover = function (e) {
      if (state.dragIndex < 0) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      var after = (e.clientY - rect.top) > rect.height / 2;
      state.dropIndex = index;
      state.dropAfter = after;
      renderDropHint();
    };
    el.ondragleave = function () {
      state.dropIndex = -1;
      renderDropHint();
    };
    el.ondrop = function (e) {
      if (state.dragIndex < 0) return;
      e.preventDefault();
      var from = state.dragIndex;
      var rect = el.getBoundingClientRect();
      var after = (e.clientY - rect.top) > rect.height / 2;
      var to = after ? index + 1 : index;
      if (from < to) to -= 1;
      state.dragIndex = -1;
      state.dropIndex = -1;
      if (from !== to) moveTo(from, to);
      else render();
    };

    return el;
  }

  function renderDropHint() {
    var cards = document.querySelectorAll('.card');
    cards.forEach(function (node) {
      node.classList.remove('drop-before', 'drop-after');
      if (Number(node.dataset.index) === state.dropIndex) {
        node.classList.add(state.dropAfter ? 'drop-after' : 'drop-before');
      }
    });
  }

  function tag(text, cls) {
    var span = document.createElement('span');
    span.className = 'tag' + (cls ? ' ' + cls : '');
    span.textContent = text;
    return span;
  }

  function iconButton(text, title, disabled, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.title = title;
    btn.disabled = disabled;
    btn.onclick = function (e) { e.stopPropagation(); onClick(); };
    return btn;
  }

  function delButton(index) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'danger';
    btn.textContent = '删除';
    btn.onclick = function (e) { e.stopPropagation(); removeAt(index); };
    return btn;
  }

  // ------------------------------------------------------------------ 复制
  /**
   * 复制「区服-角色名-勾协类型」，如 `遥远之忆-银月二号-普勾`。
   * 剪贴板 API 需要安全上下文（http://127.0.0.1 算安全），
   * 失败时回退到隐藏 textarea + execCommand。
   */
  function copyCardSummary(card) {
    var text = Core.copySummary(card);
    copyText(text).then(function (ok) {
      if (ok) toast('已复制：' + text);
      else toast('复制失败，请手动复制：' + text, true);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function renderStat() {
    var s = Core.summarize(state.cards);
    var parts = [
      ['账号数', s.accounts, ''],
      ['角色卡', s.total, ''],
      ['可执行', s.valid, ''],
      ['安卓', s.android, ''],
      ['iOS', s.ios, ''],
    ];
    if (s.blank) parts.push(['空角色', s.blank, '']);
    if (s.duplicates) parts.push(['重复项', s.duplicates, '']);

    // 协战概览（开关关闭时不显示——只挂勾协的配置没有协战状态）
    var showBattle = !$('battle-toggle') || $('battle-toggle').checked;
    if (showBattle) {
      var run = Core.summarizeRunState(state.cards);
      parts.push(['今天已执行', run.today, 'run-today-count']);
      parts.push(['今天未执行', run.stale, 'run-stale-count']);
      if (run.never) parts.push(['从未执行', run.never, '']);
    }

    // 勾协概览（一键协战 + 显示开关打开时）
    // 过期（stale）单独一组统计，不混进本周期已确认的类型里
    var jadeToggle = $('jade-toggle');
    if (state.jade && jadeToggle && jadeToggle.checked) {
      var jade = Core.summarizeJade(state.cards);
      // 本周期已确认的类型分布
      ['普勾', '现勾', '无勾'].forEach(function (kind) {
        if (!jade.fresh[kind]) return;
        var cls = kind === '无勾' ? '' : 'jade-fresh-count';
        parts.push([kind, jade.fresh[kind], cls]);
      });
      // 已过期：只报一个总数，hover 里再给类型细分
      if (jade.staleTotal) {
        var detail = ['普勾', '现勾', '无勾']
          .filter(function (k) { return jade.stale[k]; })
          .map(function (k) { return k + ' ' + jade.stale[k]; })
          .join(' / ');
        parts.push(['勾协已过期', jade.staleTotal, 'jade-stale-count']);
        // 细分挂在最后追加的 span 的 title 上（见下方渲染循环）
        parts[parts.length - 1].push(detail);
      }
      if (jade.none) parts.push(['未查', jade.none, '']);
    }

    var el = $('stat');
    el.textContent = '';
    parts.forEach(function (item) {
      var span = document.createElement('span');
      if (item[2]) span.className = item[2];
      span.appendChild(document.createTextNode(item[0] + ' '));
      var b = document.createElement('b');
      b.textContent = String(item[1]);
      span.appendChild(b);
      // 第 4 项是可选的悬停明细（目前只有"勾协已过期"用它）
      if (item[3]) span.title = item[0] + '明细：' + item[3];
      el.appendChild(span);
    });
  }

  function refreshDirty() {
    state.dirty = JSON.stringify(state.cards) !== JSON.stringify(state.original);
    $('btn-save').disabled = !state.dirty;
    $('btn-discard').disabled = !state.dirty;
    if (state.dirty) {
      setStatus('有未保存的修改（' + state.cards.length + ' 张卡）');
    } else {
      setStatus('已与磁盘一致（' + state.cards.length + ' 张卡）');
    }
  }

  // ------------------------------------------------------------------ 列表操作
  function move(from, to) {
    moveTo(from, to);
  }

  function moveTo(from, to) {
    if (to < 0 || to >= state.cards.length || from === to) return;
    var card = state.cards.splice(from, 1)[0];
    state.cards.splice(to, 0, card);
    // 选中的是"卡"而不是位置：跟着卡搬
    var selected = {};
    Object.keys(state.selected).forEach(function (k) {
      var i = Number(k);
      var target = i === from ? to : (i > from && i <= to ? i - 1 : (i < from && i >= to ? i + 1 : i));
      selected[target] = true;
    });
    state.selected = selected;
    render();
  }

  /** 多选：点卡片切换选中；shift 连选（区间） */
  function toggleSelect(index, shift) {
    if (shift && state.lastSelected !== undefined && state.lastSelected !== null) {
      var lo = Math.min(state.lastSelected, index);
      var hi = Math.max(state.lastSelected, index);
      var anyMissing = false;
      for (var i = lo; i <= hi; i++) {
        if (!state.selected[i]) anyMissing = true;
      }
      for (var j = lo; j <= hi; j++) {
        if (anyMissing) state.selected[j] = true;
        else delete state.selected[j];
      }
    } else if (state.selected[index]) {
      delete state.selected[index];
    } else {
      state.selected[index] = true;
    }
    state.lastSelected = index;
    render();
  }

  function clearSelection() {
    state.selected = {};
    state.lastSelected = undefined;
  }

  function selectedIndices() {
    return Object.keys(state.selected)
      .map(Number)
      .filter(function (i) { return i >= 0 && i < state.cards.length; })
      .sort(function (a, b) { return a - b; });
  }

  function syncSelectionBar() {
    var count = selectedIndices().length;
    var bar = $('select-bar');
    if (!bar) return;
    bar.style.display = count ? 'flex' : 'none';
    $('select-count').textContent = '已选 ' + count + ' 个账号';
    var allBtn = $('btn-select-all');
    allBtn.textContent = count === state.cards.length && count > 0
      ? '取消全选' : '全选';
    // 勾协批量标记按钮只在一键协战列表显示
    var jadeWrap = $('batch-jade-wrap');
    if (jadeWrap) jadeWrap.style.display = state.jade ? '' : 'none';
  }

  /**
   * 批量改勾协标记。
   * @param {boolean} found true=已发现(时间设为当前,状态缺省无勾)
   *                        false=未发现(时间归默认值,状态归 none)
   */
  function batchMarkJade(found) {
    var indices = selectedIndices();
    if (!indices.length) return;
    var action = found ? '已发现' : '未发现';
    if (!confirm('把选中的 ' + indices.length + ' 个账号标记为「勾协' + action
        + '」？（保存后生效）')) return;
    var now = formatNow();
    indices.forEach(function (i) {
      var card = state.cards[i];
      if (found) {
        card.jade_complete_time = now;
        if (!Core.jadeStatusValid(card.jade_status)) {
          card.jade_status = '无勾';
        }
      } else {
        card.jade_complete_time = Core.DEFAULT_TIME;
        card.jade_status = 'none';
      }
      state.cards[i] = Core.normalizeJadeCard(card);
    });
    render();
    toast('已标记 ' + indices.length + ' 个账号为勾协' + action
      + '（保存后生效）');
  }

  /** 批量删除选中的账号（从大到小删，避免下标位移） */
  function deleteSelected() {
    var indices = selectedIndices();
    if (!indices.length) return;
    var labels = indices.map(function (i) {
      return state.cards[i].character || '（空卡）';
    });
    var preview = labels.slice(0, 8).join('、')
      + (labels.length > 8 ? ' 等 ' + labels.length + ' 个' : '');
    if (!confirm('删除选中的 ' + indices.length + ' 个账号？\n' + preview)) return;
    for (var i = indices.length - 1; i >= 0; i--) {
      state.cards.splice(indices[i], 1);
    }
    clearSelection();
    closeEditor();
    render();
    toast('已删除 ' + indices.length + ' 个账号（保存后生效）');
  }

  function removeAt(index) {
    var card = state.cards[index] || {};
    var label = card.character || '（空卡）';
    if (!confirm('删除第 ' + (index + 1) + ' 张卡：' + label + '？')) return;
    state.cards.splice(index, 1);
    delete state.selected[index];
    closeEditor();
    render();
  }

  // ------------------------------------------------------------------ 编辑
  function openEditor(index) {
    state.editingIndex = index;
    var card = state.cards[index];
    $('editor-title').textContent = '编辑第 ' + (index + 1) + ' 张卡';
    $('f-character').value = card.character || '';
    $('f-svr').value = card.svr || '';
    $('f-account').value = card.account || '';
    $('f-alias').value = card.account_alias || '';
    $('f-platform').value = Core.isAndroid(card) ? 'android' : 'ios';
    $('f-time').value = card.last_complete_time || Core.DEFAULT_TIME;
    // 勾协字段只在一键协战列表可编辑
    var jadeRow = $('f-jade-row');
    jadeRow.style.display = state.jade ? '' : 'none';
    $('btn-jade-now-wrap').style.display = state.jade ? '' : 'none';
    $('btn-jade-never-wrap').style.display = state.jade ? '' : 'none';
    if (state.jade) {
      $('f-jade-status').value = Core.jadeStatusValid(card.jade_status)
        ? card.jade_status : 'none';
      $('f-jade-time').value = card.jade_complete_time || Core.DEFAULT_TIME;
    }
    $('editor').classList.add('on');
    $('f-character').focus();
    $('editor').scrollIntoView({ block: 'nearest' });
  }

  function closeEditor() {
    state.editingIndex = -1;
    $('editor').classList.remove('on');
  }

  function applyEditor() {
    var index = state.editingIndex;
    if (index < 0) return;
    var raw = {
      character: $('f-character').value.trim(),
      svr: $('f-svr').value.trim(),
      account: $('f-account').value.trim(),
      account_alias: $('f-alias').value.trim(),
      apple_or_android: $('f-platform').value === 'android',
      last_complete_time: $('f-time').value.trim() || Core.DEFAULT_TIME,
    };
    if (state.jade) {
      raw.jade_status = $('f-jade-status').value;
      raw.jade_complete_time = $('f-jade-time').value.trim() || Core.DEFAULT_TIME;
    }
    state.cards[index] = state.jade
      ? Core.normalizeJadeCard(raw)
      : Core.normalizeCard(raw);
    closeEditor();
    render();
  }

  // ------------------------------------------------------------------ 批量粘贴
  /** 读取「共同值」输入框；未勾选时返回空对象 */
  function readSharedDefaults() {
    if (!$('paste-shared-enable').checked) return {};
    return {
      account: $('shared-account').value.trim(),
      svr: $('shared-svr').value.trim(),
      platform: $('shared-platform').value,
      alias: $('shared-alias').value.trim(),
    };
  }

  /**
   * 实时预览解析结果，让人在导入前确认列识别对不对。
   */
  function updatePastePreview(announce) {
    var box = $('paste-preview');
    var text = $('paste-text').value;
    box.textContent = '';
    if (!text.trim()) return;

    var result;
    try {
      result = Core.parsePaste(text, readSharedDefaults());
    } catch (error) {
      box.textContent = '解析失败：' + error.message;
      return;
    }

    if (!result.cards.length) {
      box.textContent = '没有解析出有效账号（角色名为空的行都会被跳过）';
      return;
    }

    // 第 1 行：列顺序识别结果
    var names = { platform: '平台', account: '账号', svr: '服务器', character: '角色名', alias: '别名' };
    var parts = [];
    if (result.columns) {
      Object.keys(names).forEach(function (key) {
        if (result.columns[key] >= 0) {
          parts.push('第' + (result.columns[key] + 1) + '列=' + names[key]);
        }
      });
    }
    var headline = '列顺序：' + (parts.length ? parts.join('，') : '单列（仅角色名）')
      + ' · 解析出 ' + result.cards.length + ' 张卡'
      + (result.skipped ? '，跳过 ' + result.skipped + ' 行' : '');
    var head = document.createElement('div');
    head.style.marginBottom = '6px';
    head.textContent = headline;
    box.appendChild(head);

    // 第 2 部分：前 8 条预览表格
    var ROWS = 8;
    var table = document.createElement('table');
    var headRow = document.createElement('tr');
    ['角色名', '服务器', '账号', '系统', '编号'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    table.appendChild(headRow);

    result.cards.slice(0, ROWS).forEach(function (c) {
      var tr = document.createElement('tr');
      var id = Core.extractNumericId(c.character);
      [c.character, c.svr || '—', c.account || '—',
        Core.isAndroid(c) ? '安卓' : 'iOS', id === null ? '—' : String(id)]
        .forEach(function (value) {
          var td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        });
      table.appendChild(tr);
    });
    box.appendChild(table);

    if (result.cards.length > ROWS) {
      var more = document.createElement('div');
      more.style.marginTop = '4px';
      more.textContent = '……还有 ' + (result.cards.length - ROWS) + ' 条未显示';
      box.appendChild(more);
    }

    if (announce) toast('预览已更新');
  }

  // ------------------------------------------------------------------ 导出 JSON
  /** 当前导出内容与文件名 */
  var exportState = { content: '', filename: '' };

  function openExport() {
    if (!state.config) {
      toast('请先选择配置', true);
      return;
    }
    $('exportmodal').classList.add('on');
    $('export-text').value = '读取中…';
    $('export-info').textContent = '';
    refreshExport();
  }

  function closeExport() {
    $('exportmodal').classList.remove('on');
  }

  function refreshExport() {
    var includeDirty = $('export-dirty').checked && state.dirty;
    setStatus('导出中…');
    var request = includeDirty
      ? api('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: state.config,
          target: state.target,
          cards: state.cards,
        }),
      })
      : api('/api/export?config=' + encodeURIComponent(state.config)
        + '&target=' + encodeURIComponent(state.target));

    request.then(function (data) {
      exportState.content = data.content || '';
      exportState.filename = data.filename || 'export.json';
      $('export-text').value = exportState.content;
      var kb = (data.bytes / 1024).toFixed(1);
      $('export-info').textContent =
        data.label + ' / ' + state.config + ' · '
        + kb + ' KB · 文件 ' + exportState.filename
        + (includeDirty ? '（含未保存修改）' : '（磁盘当前内容）');
      setStatus('已生成导出内容');
    }).catch(function (error) {
      $('export-text').value = '';
      $('export-info').textContent = '导出失败：' + error.message;
      setStatus('导出失败：' + error.message, 'error');
      toast(error.message, true);
    });
  }

  function copyExport() {
    var text = exportState.content;
    if (!text) {
      toast('没有可复制的内容', true);
      return;
    }
    var done = function () { toast('已复制到剪贴板（含完整账号信息）'); };
    var fallback = function () {
      // 剪贴板 API 不可用（非 https / 权限被拒）时退回选中文本
      var area = $('export-text');
      area.removeAttribute('readonly');
      area.focus();
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.setAttribute('readonly', 'readonly');
      if (ok) { done(); } else { toast('复制失败，请手动全选复制', true); }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadExport() {
    if (!exportState.content) {
      toast('没有可下载的内容', true);
      return;
    }
    var blob = new Blob([exportState.content], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = exportState.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已下载 ' + exportState.filename);
  }

  // ------------------------------------------------------------------ 切换目标
  function openRoots() {
    $('rootsmodal').classList.add('on');
    $('roots-note').textContent = '';
    loadRoots();
  }

  function closeRoots() {
    $('rootsmodal').classList.remove('on');
  }

  function loadRoots() {
    $('roots-list').textContent = '加载中…';
    return api('/api/roots').then(renderRoots).catch(function (error) {
      $('roots-list').textContent = '读取失败：' + error.message;
    });
  }

  function renderRoots(data) {
    $('roots-current').textContent = data.current || '（未知）';
    $('network-warn').style.display = data.current_network ? '' : 'none';

    var box = $('roots-list');
    box.textContent = '';
    (data.roots || []).forEach(function (root) {
      var item = document.createElement('div');
      item.className = 'root-item'
        + (root.current ? ' current' : '')
        + (root.reachable ? '' : ' unreachable');

      var info = document.createElement('div');
      info.className = 'info';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = root.name;
      var path = document.createElement('div');
      path.className = 'path';
      path.textContent = root.path;
      info.append(name, path);

      var netTag = document.createElement('span');
      netTag.className = 'tag' + (root.network ? ' ios' : '');
      netTag.textContent = root.network ? '局域网' : '本地';

      var stateTag = document.createElement('span');
      stateTag.className = 'tag' + (root.reachable ? ' android' : ' dup');
      stateTag.textContent = root.reachable ? '可访问' : '不可访问';

      var actions = document.createElement('div');
      if (root.current) {
        var cur = document.createElement('span');
        cur.className = 'tag';
        cur.textContent = '当前使用';
        actions.appendChild(cur);
      } else {
        var useBtn = document.createElement('button');
        useBtn.textContent = '切换';
        useBtn.disabled = !root.reachable;
        useBtn.onclick = function () {
          switchRoot({ action: 'use', path: root.path, name: root.name });
        };
        var delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '删除';
        delBtn.onclick = function () {
          if (!confirm('删除预设「' + root.name + '」？（只删记录，不动文件）')) return;
          switchRoot({ action: 'remove', name: root.name });
        };
        actions.append(useBtn, delBtn);
      }

      item.append(info, netTag, stateTag, actions);
      box.appendChild(item);
    });

    if (!(data.roots || []).length) {
      box.textContent = '还没有任何预设。';
    }
  }

  function switchRoot(payload) {
    if (state.dirty && !confirm('有未保存的修改，切换目标会丢弃，继续？')) {
      return Promise.resolve();
    }
    $('roots-note').textContent = '处理中…';
    return api('/api/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (data) {
      renderRoots(data);
      $('roots-note').textContent = data.current ? ('当前：' + data.current) : '';
      // 目标可能换了，配置列表和当前列表都要重新加载
      state.dirty = false;
      state.cards = [];
      state.original = [];
      return loadMeta().then(function () {
        // 换了目标后配置可能不同名，套用新配置记住的开关状态
        applyTogglesForConfig();
        return loadList();
      });
    }).catch(function (error) {
      $('roots-note').textContent = '失败：' + error.message;
      toast(error.message, true);
    });
  }

  function addPreset(useNow) {
    var path = $('roots-path').value.trim();
    if (!path) {
      toast('请先填路径', true);
      return;
    }
    switchRoot({
      action: useNow ? 'use' : 'add',
      path: path,
      name: $('roots-name').value.trim(),
    }).then(function () {
      $('roots-path').value = '';
      $('roots-name').value = '';
    });
  }

  // ------------------------------------------------------------------ 版本检查
  // 页面文件每次请求都从磁盘读，改了立即生效；但 server.py 只在进程启动时
  // 加载，旧进程认不得新接口，请求会得到 404。这里主动比对契约版本，
  // 直接告诉用户"需要重启工具"，而不是让人对着 not found 猜。
  var EXPECTED_CONTRACT = 6;

  function checkServerVersion() {
    return api('/api/ping').then(function (info) {
      if (typeof info.contract === 'number' && info.contract < EXPECTED_CONTRACT) {
        showStaleBanner(info);
        return false;
      }
      return true;
    }).catch(function () {
      // ping 失败不阻塞主流程，交给后续请求报错
      return true;
    });
  }

  function showStaleBanner(info) {
    var banner = document.createElement('div');
    banner.className = 'stale-banner';
    banner.innerHTML = ''
      + '<b>⚠ 后端服务是旧版本，部分功能（如导出 JSON）不可用</b>'
      + '<span>页面已经是新代码，但 server.py 的修改要重启进程才生效。'
      + '当前进程：PID ' + (info.pid || '?')
      + '，接口版本 ' + (info.contract || '未知')
      + '（需要 ' + EXPECTED_CONTRACT + '）。</span>'
      + '<span>请点右下角「退出工具」，然后重新启动（双击桌面快捷方式或 启动账号管理.bat）。</span>';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // ------------------------------------------------------------------ 窗口几何记忆
  // 独立窗口（--app）的位置和尺寸由浏览器控制，页面只能"量自己 + 上报"。
  // 后端存到 window.json，下次启动时用 --window-position/--window-size 传回去。
  //   screenX/screenY  窗口左上角在屏幕上的坐标（多显示器可能为负）
  //   outerWidth/Height 整个窗口尺寸（含边框）；某些浏览器在 --app 下才准
  // 只在 --app 模式有意义，普通标签页上报的值不准，所以后端会按尺寸下限过滤。
  var GEOMETRY_SAVE_MS = 800;   // 拖动/缩放时的防抖
  var geometryTimer = null;
  var lastGeometry = '';

  function readGeometry() {
    var width = Math.round(window.outerWidth || 0);
    var height = Math.round(window.outerHeight || 0);
    // screenX/screenY 在部分浏览器是 undefined，退回 screenLeft/screenTop
    var left = window.screenX !== undefined ? window.screenX : window.screenLeft;
    var top = window.screenY !== undefined ? window.screenY : window.screenTop;
    if (!width || !height || left === undefined || top === undefined) return null;
    return {
      width: width,
      height: height,
      left: Math.round(left),
      top: Math.round(top),
    };
  }

  function saveGeometry(force) {
    var geometry = readGeometry();
    if (!geometry) return;
    var key = JSON.stringify(geometry);
    if (!force && key === lastGeometry) return;   // 没变就不打扰后端
    lastGeometry = key;
    api('/api/window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geometry),
    }).catch(function () { /* 后端不支持（旧版本）就静默忽略 */ });
  }

  function scheduleGeometrySave() {
    if (geometryTimer) clearTimeout(geometryTimer);
    geometryTimer = setTimeout(function () {
      geometryTimer = null;
      saveGeometry(false);
    }, GEOMETRY_SAVE_MS);
  }

  function startGeometryMemory() {
    window.addEventListener('resize', scheduleGeometrySave);
    // 拖动窗口时只有少数浏览器触发 move；轮询兜底（2 秒一次，很轻）
    setInterval(function () {
      var geometry = readGeometry();
      if (!geometry) return;
      if (JSON.stringify(geometry) !== lastGeometry) saveGeometry(false);
    }, 2000);
    // 关页面前保存最后一次
    window.addEventListener('pagehide', function () {
      var geometry = readGeometry();
      if (!geometry) return;
      try {
        navigator.sendBeacon(
          '/api/window',
          new Blob([JSON.stringify(geometry)], { type: 'application/json' })
        );
      } catch (e) { /* 忽略 */ }
    });
    saveGeometry(true);
  }

  // ------------------------------------------------------------------ 心跳
  // 独立窗口模式下，用户直接点窗口 X 关掉页面时，后端 pythonw 会留在后台。
  // 后端有个空闲看门狗（IDLE_EXIT_SECONDS，默认 60 秒）：这里每 10 秒 ping 一次，
  // 窗口一关心跳就停，后端自己退出，不留残留进程。
  var HEARTBEAT_MS = 10000;

  function startHeartbeat() {
    setInterval(function () {
      // 页面被切到后台时浏览器会节流定时器，用 ping 保活即可，不关心结果
      api('/api/ping').catch(function () { /* 服务已退出，忽略 */ });
    }, HEARTBEAT_MS);
    // 关页面前尽量再 ping 一次，让看门狗从此刻开始计时
    window.addEventListener('pagehide', function () {
      try {
        navigator.sendBeacon && navigator.sendBeacon('/api/ping');
      } catch (e) { /* 忽略 */ }
    });
  }

  // ------------------------------------------------------------------ API
  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok || (data && data.ok === false)) {
          var error = new Error((data && data.error) || ('HTTP ' + res.status));
          error.conflict = !!(data && data.conflict);
          throw error;
        }
        return data;
      });
    });
  }

  function loadMeta() {
    return api('/api/configs').then(function (data) {
      var configSelect = $('config-select');
      configSelect.textContent = '';
      (data.configs || []).forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        configSelect.appendChild(opt);
      });

      var targetSelect = $('target-select');
      targetSelect.textContent = '';
      (data.targets || []).forEach(function (target) {
        var opt = document.createElement('option');
        opt.value = target.key;
        opt.textContent = target.label;
        targetSelect.appendChild(opt);
      });

      // 恢复上次使用的配置和列表（存在且合法才恢复）
      var prefs = loadPrefs();
      var savedConfig = prefs['config-select'];
      var savedTarget = prefs['target-select'];
      if (savedConfig && (data.configs || []).indexOf(savedConfig) >= 0) {
        configSelect.value = savedConfig;
      }
      if (savedTarget
          && (data.targets || []).some(function (t) { return t.key === savedTarget; })) {
        targetSelect.value = savedTarget;
      }

      state.config = configSelect.value || '';
      state.target = targetSelect.value || 'assist_battle';
    });
  }

  // ------------------------------------------------------------------ 列表加载
  // 「重新加载」偶发不刷新的根因（2026-10-31 实测确认）：
  //   1) loadList() 没有并发守卫。连点几下时，多个 /api/list 同时在飞，
  //      先发的响应可能后到，把新数据覆盖成旧数据 —— 表现就是"点了没反应，
  //      再点几下才正常"。文件大 / 局域网目标 / OAS 正在回写时更容易出现。
  //   2) 读取失败时把 state.cards 清空。OAS 用非原子写（截断后分块写），
  //      恰好读到半截文件会 JSON 解析失败，列表被清空，看起来就是"没刷新"。
  // 下面用 loadSeq 只认最后一次请求，并且失败时保留原有数据。
  var loadSeq = 0;

  function loadList() {
    if (!state.config) {
      loadSeq += 1;          // 作废在飞的请求
      state.cards = [];
      state.original = [];
      render();
      setStatus('没有可用的配置文件', 'error');
      return Promise.resolve();
    }
    var seq = ++loadSeq;
    setStatus('读取中…');
    return api('/api/list?config=' + encodeURIComponent(state.config)
      + '&target=' + encodeURIComponent(state.target))
      .then(function (data) {
        // 已经有更新的请求发出：这次的结果作废，不要覆盖更新的数据
        if (seq !== loadSeq) return;
        state.jade = !!data.jade;
        state.extra = data.extra || {};
        state.cards = (data.cards || []).map(
          state.jade ? Core.normalizeJadeCard : Core.normalizeCard
        );
        state.original = state.cards.map(
          state.jade ? Core.normalizeJadeCard : Core.normalizeCard
        );
        state.mtime = data.mtime;
        clearSelection();
        syncJadeToggle();
        closeEditor();
        $('pastewrap').classList.remove('on');
        render();
        if (data.missing) {
          setStatus('该配置还没有「' + data.label + '」节点，当前为空；保存后会自动创建', 'error');
        } else {
          setStatus('已加载 ' + state.cards.length + ' 张卡：' + data.label + ' / ' + state.config);
        }
      })
      .catch(function (error) {
        // 过期请求的错误也忽略，避免旧请求的失败提示盖住新请求的结果
        if (seq !== loadSeq) return;
        // 读取失败**不清空**当前列表：磁盘可能只是被别处写了一半，
        // 保留旧数据比让界面变成空白更有用（空白会让人以为账号丢了）。
        render();
        setStatus('读取失败（界面仍是上一次的内容）：' + error.message, 'error');
        toast('读取失败，请再点一次「重新加载」：' + error.message, true);
      });
  }

  /** 勾协显示开关：只在一键协战列表可用；筛选框只在一键协战+开关打开时可选 */
  function syncJadeToggle() {
    var field = $('jade-toggle-field');
    var toggle = $('jade-toggle');
    if (!field || !toggle) return;
    field.style.display = state.jade ? '' : 'none';
    toggle.title = state.jade
      ? '在卡片上显示勾协检查结果与时间'
      : '只有一键协战列表才有勾协信息';
    // 勾协筛选框常驻，关闭显示时禁用（置灰不可点）
    var filterField = $('jade-filter-field');
    var filter = $('jade-filter');
    if (filterField && filter) {
      var enabled = state.jade && toggle.checked;
      filter.disabled = !enabled;
      filterField.style.opacity = enabled ? '1' : '0.45';
      filterField.title = enabled
        ? '按勾协类型筛选账号（无勾 / 普勾 / 现勾 / 勾协已过期 / 从未查找）'
          + '\n无勾 / 普勾 / 现勾 只算本周期已确认的；'
          + '\n上个周期查出来的（已过期）单独用「勾协已过期」看'
        : '勾选「显示勾协」后才能筛选';
    }
  }

  /** 协战显示开关：关闭时运行状态筛选置灰不可点 */
  function syncBattleToggle() {
    var filterField = $('run-filter-field');
    var filter = $('run-filter');
    if (!filterField || !filter) return;
    var enabled = $('battle-toggle').checked;
    filter.disabled = !enabled;
    filterField.style.opacity = enabled ? '1' : '0.45';
    filterField.title = enabled
      ? '按协战执行情况筛选账号'
      : '勾选「显示协战」后才能筛选';
  }

  function save() {    if (!state.config) return Promise.resolve();
    setStatus('保存中…');
    $('btn-save').disabled = true;
    return api('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: state.config,
        target: state.target,
        cards: state.cards,
        mtime: state.mtime,
      }),
    }).then(function (data) {
      state.cards = (data.cards || []).map(
        state.jade ? Core.normalizeJadeCard : Core.normalizeCard
      );
      state.original = state.cards.map(
        state.jade ? Core.normalizeJadeCard : Core.normalizeCard
      );
      state.mtime = data.mtime;
      // 保存时后端可能修正过轮换指针（越界归零），这里同步刷新
      if (data.extra) state.extra = data.extra;
      render();
      setStatus('已保存 ' + state.cards.length + ' 张卡，备份：' + data.backup, 'ok');
      toast('保存成功');
    }).catch(function (error) {
      render();
      if (error.conflict) {
        setStatus('保存被拒绝：' + error.message, 'error');
        toast('文件已被外部改动，请先「重新加载」', true);
      } else {
        setStatus('保存失败：' + error.message, 'error');
        toast(error.message, true);
      }
    });
  }

  // ------------------------------------------------------------------ 退出工具
  function quit() {
    if (state.dirty) {
      toast('还有未保存的修改，请先保存或放弃修改', true);
      return;
    }
    if (!confirm('退出工具？\n退出后页面将无法使用，需要重新启动才能再打开。')) return;
    setStatus('正在退出…');
    $('btn-quit').disabled = true;
    api('/api/shutdown', { method: 'POST' })
      .then(function () {
        // 服务已停，页面本身留在浏览器里；提示后由用户自行关闭标签页
        // 配色与 xianyu 账号管理保持一致（米黄底 + 暖褐字）
        document.body.style.background = '#efdfc0';
        document.body.innerHTML = '<div style="padding:40px;font:15px/1.7 \'Segoe UI\',\'Microsoft YaHei\',sans-serif;color:#43301c">'
          + '<h2 style="margin:0 0 12px">工具已退出</h2>'
          + '<p>后端进程已停止，端口已释放。可以直接关闭本页面。</p>'
          + '<p style="color:#967e5d">下次双击桌面快捷方式（或 启动账号管理.bat）重新启动。</p>'
          + '</div>';
        state.dirty = false;
      })
      .catch(function (error) {
        $('btn-quit').disabled = false;
        setStatus('退出失败：' + error.message, 'error');
        toast('退出失败：' + error.message, true);
      });
  }

  /** 当前时间，格式与 OAS 的 DateTime 序列化一致：YYYY-MM-DD HH:MM:SS */
  function formatNow() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /**
   * 「系统优先」对两种排序方式都生效
   * （账号 → 系统 是共同的前两级，只有第三级不同）。
   */
  function syncSortModeUi() {
    $('platform-order').disabled = false;
    $('platform-order-field').style.opacity = '1';
    $('platform-order-field').title = '决定同一账号下安卓和 iOS 谁排前面';
  }

  // ------------------------------------------------------------------ 事件
  function bind() {
    $('config-select').onchange = function (e) {
      if (state.dirty && !confirm('有未保存的修改，切换配置会丢弃，继续？')) {
        e.target.value = state.config;
        return;
      }
      // 先把上一个配置的开关状态存下来，再切到新配置记住的那套
      saveTogglesForCurrent();
      state.config = e.target.value;
      savePref('config-select');
      applyTogglesForConfig();
      loadList();
    };

    $('target-select').onchange = function (e) {
      if (state.dirty && !confirm('有未保存的修改，切换列表会丢弃，继续？')) {
        e.target.value = state.target;
        return;
      }
      state.target = e.target.value;
      savePref('target-select');
      loadList();
    };

    $('btn-reload').onclick = function () {
      if (state.dirty && !confirm('丢弃未保存的修改并重新读取磁盘？')) return;
      loadList();
    };

    $('btn-sort').onclick = function () {
      var mode = $('sort-mode').value;
      savePref('sort-mode');
      savePref('platform-order');
      state.cards = Core.sortCards(state.cards, $('platform-order').value, mode);
      render();
      toast(mode === 'id'
        ? '已按 账号 → 系统 → 编号 排序'
        : '已按 账号 → 系统 → 角色名 排序');
    };

    $('btn-add').onclick = function () {
      state.cards.push(Core.emptyCard());
      render();
      openEditor(state.cards.length - 1);
    };

    $('btn-paste').onclick = function () {
      $('pastewrap').classList.add('on');
      $('paste-text').focus();
    };

    $('btn-paste-cancel').onclick = function () {
      $('pastewrap').classList.remove('on');
      $('paste-text').value = '';
      $('paste-preview').textContent = '';
    };

    // 共同值开关：勾上就显示输入区
    $('paste-shared-enable').onchange = function () {
      $('paste-shared').classList.toggle('on', $('paste-shared-enable').checked);
      updatePastePreview();
    };
    ['shared-account', 'shared-svr', 'shared-platform', 'shared-alias'].forEach(function (id) {
      $(id).oninput = updatePastePreview;
      $(id).onchange = updatePastePreview;
    });
    $('paste-text').oninput = updatePastePreview;

    $('btn-paste-preview').onclick = function () {
      updatePastePreview(true);
    };

    $('btn-paste-ok').onclick = function () {
      var result;
      try {
        result = Core.parsePaste($('paste-text').value, readSharedDefaults());
      } catch (error) {
        toast('解析失败：' + error.message, true);
        return;
      }
      if (!result.cards.length) {
        toast('没有解析出有效账号', true);
        return;
      }
      result.cards.forEach(function (card) { state.cards.push(card); });
      $('paste-text').value = '';
      $('paste-preview').textContent = '';
      $('pastewrap').classList.remove('on');
      render();
      toast('已追加 ' + result.cards.length + ' 张卡'
        + (result.skipped ? '（跳过 ' + result.skipped + ' 行）' : ''));
    };

    $('btn-editor-ok').onclick = applyEditor;
    $('btn-editor-cancel').onclick = closeEditor;
    $('btn-save').onclick = save;

    // 编辑框里的时间快捷操作
    $('btn-time-now').onclick = function () {
      $('f-time').value = formatNow();
    };
    $('btn-time-never').onclick = function () {
      $('f-time').value = Core.DEFAULT_TIME;
    };
    // 勾协时间快捷操作（只在一键协战列表显示）
    $('btn-jade-now').onclick = function () {
      $('f-jade-time').value = formatNow();
      // 标记"已发现"至少要给一个可信状态, none 的话默认成 无勾
      if (!Core.jadeStatusValid($('f-jade-status').value)) {
        $('f-jade-status').value = '无勾';
      }
    };
    $('btn-jade-never').onclick = function () {
      $('f-jade-time').value = Core.DEFAULT_TIME;
      $('f-jade-status').value = 'none';
    };

    // 运行状态筛选：只影响显示，不改动列表本身
    $('run-filter').onchange = function () {
      savePref('run-filter');
      render();
    };

    // 勾协信息显示开关（只有一键协战列表有这个开关）
    $('jade-toggle').onchange = function () {
      // 关掉勾协显示时勾协筛选不可用，重置成全部
      if (!$('jade-toggle').checked) {
        $('jade-filter').value = 'all';
        savePref('jade-filter');
      }
      syncJadeToggle();
      saveTogglesForCurrent();   // 按当前配置记忆，不写全局
      render();
    };

    // 协战信息显示开关（只挂勾协的配置可以关掉协战相关内容）
    $('battle-toggle').onchange = function () {
      if (!$('battle-toggle').checked) {
        // 关掉协战显示时运行状态筛选不可用，重置成全部
        $('run-filter').value = 'all';
        savePref('run-filter');
      }
      syncBattleToggle();
      saveTogglesForCurrent();   // 按当前配置记忆，不写全局
      render();
    };

    // 勾协筛选：按类型（无勾 / 普勾 / 现勾 / 从未查找），只在勾协显示开启时有效
    $('jade-filter').onchange = function () {
      savePref('jade-filter');
      render();
    };

    // 多选删除
    $('btn-select-all').onclick = function () {
      var all = selectedIndices().length === state.cards.length
        && state.cards.length > 0;
      if (all) {
        clearSelection();
      } else {
        state.selected = {};
        state.cards.forEach(function (_, i) { state.selected[i] = true; });
      }
      render();
    };
    $('btn-delete-selected').onclick = deleteSelected;
    $('btn-select-clear').onclick = function () {
      clearSelection();
      render();
    };

    // 勾协批量标记（多选操作条，只在一键协战列表显示）
    $('btn-batch-jade-now').onclick = function () { batchMarkJade(true); };
    $('btn-batch-jade-never').onclick = function () { batchMarkJade(false); };

    // 导出 JSON
    $('btn-export').onclick = openExport;
    $('btn-export-close').onclick = closeExport;
    $('btn-export-copy').onclick = copyExport;
    $('btn-export-download').onclick = downloadExport;
    $('export-dirty').onchange = refreshExport;
    $('exportmodal').onclick = function (e) {
      // 点遮罩关闭，点内容不关
      if (e.target === $('exportmodal')) closeExport();
    };
    // 视图切换（记住选择）
    $('btn-view-list').onclick = function () { setView('list'); };
    $('btn-view-grid').onclick = function () { setView('grid'); };
    // 方块视图每行张数（记住选择）
    $('grid-cols').onchange = function (e) { setGridCols(e.target.value); };

    // 切换目标（根目录预设）
    $('btn-roots').onclick = openRoots;    $('btn-roots-close').onclick = closeRoots;
    $('btn-roots-use').onclick = function () { addPreset(true); };
    $('btn-roots-add').onclick = function () { addPreset(false); };
    $('rootsmodal').onclick = function (e) {
      if (e.target === $('rootsmodal')) closeRoots();
    };

    // 弹窗里全选：Ctrl+A 只选文本框内容
    $('export-text').onkeydown = function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        $('export-text').select();
      }
    };

    $('btn-discard').onclick = function () {
      state.cards = state.original.map(
        state.jade ? Core.normalizeJadeCard : Core.normalizeCard
      );
      clearSelection();
      closeEditor();
      render();
      toast('已放弃修改');
    };

    $('btn-quit').onclick = quit;

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && $('editor').classList.contains('on')
          && e.target.tagName === 'INPUT') {
        e.preventDefault();
        applyEditor();
      } else if (e.key === 'Escape') {
        closeEditor();
        $('pastewrap').classList.remove('on');
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ------------------------------------------------------------------ 偏好记忆
  // 下拉框/开关状态存 localStorage, 下次打开恢复
  var PREF_KEY = 'account-manager.prefs';
  // 「显示协战 / 显示勾协」按配置分别记忆：不同配置的用途不一样
  // （只跑协战的要显示协战、只跑勾协的配置干脆两边都不显示），
  // 全局记一个值会在切换配置时互相干扰。
  var TOGGLE_PREF_KEY = 'account-manager.toggles';
  var PREF_IDS = [
    'sort-mode', 'platform-order', 'run-filter', 'jade-filter',
    'config-select', 'target-select',
  ];

  function loadPrefs() {
    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { /* 忽略 */ }
    return prefs;
  }

  /** 读「按配置记忆的开关」表：{ 配置名: { battle: bool, jade: bool } } */
  function loadTogglePrefs() {
    var table = {};
    try {
      table = JSON.parse(localStorage.getItem(TOGGLE_PREF_KEY)) || {};
    } catch (e) { /* 忽略 */ }
    return table && typeof table === 'object' ? table : {};
  }

  /** 当前配置下两个开关的默认值（没有记忆时用这个） */
  var DEFAULT_TOGGLES = { battle: true, jade: false };

  /** 取某个配置记住的开关状态；没有记录返回默认值 */
  function togglesFor(config) {
    var table = loadTogglePrefs();
    var saved = config ? table[config] : null;
    if (!saved || typeof saved !== 'object') return {
      battle: DEFAULT_TOGGLES.battle, jade: DEFAULT_TOGGLES.jade,
    };
    return {
      battle: saved.battle === undefined ? DEFAULT_TOGGLES.battle : !!saved.battle,
      jade: saved.jade === undefined ? DEFAULT_TOGGLES.jade : !!saved.jade,
    };
  }

  /** 把当前两个开关的状态写进「当前配置」那一格 */
  function saveTogglesForCurrent() {
    if (!state.config) return;
    var table = loadTogglePrefs();
    table[state.config] = {
      battle: !!$('battle-toggle').checked,
      jade: !!$('jade-toggle').checked,
    };
    try {
      localStorage.setItem(TOGGLE_PREF_KEY, JSON.stringify(table));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /**
   * 把界面上的两个开关切换成"当前配置记住的状态"。
   * 切配置 / 启动恢复 / 切换目标后都要调它。
   */
  function applyTogglesForConfig() {
    var saved = togglesFor(state.config);
    $('battle-toggle').checked = saved.battle;
    $('jade-toggle').checked = saved.jade;
    // 开关关掉时对应的筛选框要归位（否则会被禁用着还留个旧值）
    if (!saved.battle) {
      $('run-filter').value = 'all';
      savePref('run-filter');
    }
    if (!saved.jade) {
      $('jade-filter').value = 'all';
      savePref('jade-filter');
    }
    syncBattleToggle();
    syncJadeToggle();
  }

  /** 恢复某个控件的值（控件存在且偏好里有记录时） */
  function applyPref(id) {
    var prefs = loadPrefs();
    var el = $(id);
    if (!el || prefs[id] === undefined) return false;
    if (el.type === 'checkbox') el.checked = !!prefs[id];
    else el.value = prefs[id];
    return true;
  }

  function savePref(id) {
    var el = $(id);
    if (!el) return;
    var prefs = loadPrefs();
    prefs[id] = el.type === 'checkbox' ? el.checked : el.value;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 隐私模式忽略 */ }
  }

  // ------------------------------------------------------------------ 启动
  // 恢复开关/筛选偏好（配置和列表在 loadMeta 拿到选项后恢复）
  // 注意：battle-toggle / jade-toggle 不在这里恢复 —— 它们按配置分别记忆，
  // 必须等 loadMeta 确定 state.config 之后由 applyTogglesForConfig() 套用。
  [
    'sort-mode', 'platform-order', 'run-filter', 'jade-filter',
  ].forEach(applyPref);
  bind();
  syncSortModeUi();
  syncJadeToggle();
  syncBattleToggle();
  // 恢复上次的视图偏好
  try {
    viewMode = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch (e) { /* localStorage 不可用时用默认 */ }
  // 恢复「每行几张」（只认白名单里的值，脏数据回落到 auto）
  try {
    var savedCols = localStorage.getItem(GRID_COLS_KEY);
    if (savedCols && GRID_COLS_VALUES.indexOf(savedCols) >= 0) gridCols = savedCols;
  } catch (e) { /* localStorage 不可用时用默认 */ }
  syncViewButtons();
  syncGridColsUi();
  checkServerVersion().then(function () {
    return loadMeta().then(function () {
      // 配置定了，才能知道该套用哪一套开关记忆
      applyTogglesForConfig();
      return loadList();
    });
  }).then(function () {
    // 页面就绪后开始心跳：窗口一关，后端空闲看门狗会自动退出
    startHeartbeat();
    // 记住窗口位置尺寸，下次 --app 启动时用同一位置
    startGeometryMemory();
  }).catch(function (error) {
    setStatus('初始化失败：' + error.message, 'error');
    toast(error.message, true);
  });
})();
