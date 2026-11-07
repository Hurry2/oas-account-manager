/* 账号列表管理的纯逻辑（无 DOM 依赖，可被 node 直接单测）
 * 浏览器里挂到 window.AccountCore；node 里挂到 globalThis.AccountCore。
 */
(function (root) {
  'use strict';

  var DEFAULT_TIME = '2023-01-01 00:00:00';
  var CARD_FIELDS = ['character', 'svr', 'account', 'account_alias'];
  var IOS_WORDS = ['ios', 'apple', '苹果', 'false', '0'];

  // ---------------------------------------------------------------- 汉字数字
  // 角色名普遍是「银月六号」这种「汉字数字 + 单位」的写法，
  // 而拼音排序会得到 八(bā) < 六(liù) < 七(qī) < 五(wǔ)，顺序全乱。
  // 这里把常见汉字数字解析成数值，让「二号 < 五号 < 六号 < 八号」。
  var CN_DIGITS = {
    零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3,
    四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7,
    八: 8, 捌: 8, 九: 9, 玖: 9,
  };
  var CN_UNITS = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

  /**
   * 解析一段汉字数字，如「二」→2、「十五」→15、「二十三」→23、「一百零五」→105。
   * 不是合法的汉字数字时返回 null。
   */
  function parseChineseNumber(text) {
    if (!text) return null;
    var chars = String(text).split('');
    var total = 0;      // 已累计的「百/十」以上部分
    var section = 0;    // 当前节内累计
    var lastDigit = null; // 上一个数字，用于「十」前的省略写法
    var hasAny = false;

    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch in CN_DIGITS) {
        section = CN_DIGITS[ch];
        lastDigit = section;
        hasAny = true;
      } else if (ch in CN_UNITS) {
        var unit = CN_UNITS[ch];
        // 「十五」= 15：十前面没有数字时按 1 算
        var multiplier = (i === 0 || lastDigit === null) ? 1 : section;
        section = multiplier * unit;
        total += section;
        section = 0;
        lastDigit = null;
        hasAny = true;
      } else {
        return null;
      }
    }
    return hasAny ? total + section : null;
  }

  var CN_DIGIT_CLASS = Object.keys(CN_DIGITS).join('');
  var CN_UNIT_CLASS = Object.keys(CN_UNITS).join('');
  // 匹配「汉字数字 + 单位」中的数字部分，如 银月六号 -> 六
  var CN_NUMBER_RE = new RegExp('[' + CN_DIGIT_CLASS + CN_UNIT_CLASS + ']+', 'g');

  /**
   * 从角色名里抽取排序用的 ID。
   *
   * 支持三种常见写法，按优先级：
   *   1. 阿拉伯数字：'银月6号' / '6号' / 'acct-06'   -> 6
   *   2. 汉字数字 + 常见单位：'银月六号' / '十五号'  -> 6 / 15
   *   3. 纯汉字数字：'银月六'                        -> 6
   *
   * 多个候选时取最后一个（角色名通常是「前缀 + 编号 + 单位」）。
   * 抽不到时返回 null，交给名称比较兜底。
   */
  function extractNumericId(text) {
    var raw = String(text == null ? '' : text);
    if (!raw) return null;

    // 1) 阿拉伯数字：取最后一段连续数字
    var arabic = raw.match(/\d+/g);
    if (arabic && arabic.length) {
      return parseInt(arabic[arabic.length - 1], 10);
    }

    // 2) 汉字数字（含 十/百 等）
    var candidates = [];
    var match;
    CN_NUMBER_RE.lastIndex = 0;
    while ((match = CN_NUMBER_RE.exec(raw)) !== null) {
      var value = parseChineseNumber(match[0]);
      if (value !== null) candidates.push(value);
    }
    if (candidates.length) {
      return candidates[candidates.length - 1];
    }
    return null;
  }

  /** 数字按数值比较、其余按中文/大小写不敏感比较 */
  function naturalCompare(a, b) {
    var split = function (s) { return String(s == null ? '' : s).match(/(\d+|\D+)/g) || []; };
    var pa = split(a), pb = split(b);
    var len = Math.min(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var x = pa[i], y = pb[i];
      var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        var d = parseInt(x, 10) - parseInt(y, 10);
        if (d !== 0) return d;
      } else {
        var c = x.localeCompare(y, 'zh-Hans-CN', { sensitivity: 'base' });
        if (c !== 0) return c;
      }
    }
    return pa.length - pb.length;
  }

  /** apple_or_android 兼容 bool / "true" / "ios" 等写法 */
  function isAndroid(card) {
    var v = card && card.apple_or_android;
    if (typeof v === 'string') return IOS_WORDS.indexOf(v.trim().toLowerCase()) < 0;
    if (v === undefined || v === null) return true;
    return !!v;
  }

  function emptyCard() {
    return {
      character: '', svr: '', account: '', account_alias: '',
      apple_or_android: true, last_complete_time: DEFAULT_TIME,
    };
  }

  function emptyJadeFields() {
    return { jade_status: 'none', jade_complete_time: DEFAULT_TIME };
  }

  /** 补全成 AccountInfo 的 6 个字段 */
  function normalizeCard(raw) {
    raw = raw || {};
    var card = emptyCard();
    CARD_FIELDS.forEach(function (key) {
      card[key] = raw[key] == null ? '' : String(raw[key]);
    });
    if (raw.apple_or_android !== undefined) {
      card.apple_or_android = isAndroid({ apple_or_android: raw.apple_or_android });
    }
    card.last_complete_time = raw.last_complete_time
      ? String(raw.last_complete_time)
      : DEFAULT_TIME;
    return card;
  }

  /** 补全成 AssistBattleAccountInfo 的 8 个字段（含勾协两个字段） */
  function normalizeJadeCard(raw) {
    var card = normalizeCard(raw);
    var jade = raw && raw.jade_status !== undefined ? raw : {};
    card.jade_status = String(jade.jade_status || 'none');
    card.jade_complete_time = String(
      (raw && raw.jade_complete_time) || DEFAULT_TIME
    );
    return card;
  }

  // ---------------------------------------------------------------- 勾协状态
  // 与 tasks/AssistBattle/script_task.py 的语义一致：
  //   jade_status: none=从未执行, 无勾/普勾/现勾=本周期确认过
  //   jade_complete_time 按 5:00/18:00 刷新点判断是否仍在同一周期
  var JADE_REFRESH_HOURS = [5, 18];

  /** 最近一次勾协刷新时刻（每天 5 点 / 18 点），5 点前归昨天 18 点 */
  function jadeRefreshPoint(now) {
    var date = now instanceof Date ? now : (parseRunTime(now) || new Date());
    var points = JADE_REFRESH_HOURS.map(function (h) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0);
    });
    var passed = points.filter(function (p) { return p <= date; });
    if (passed.length) return passed[passed.length - 1];
    return new Date(
      date.getFullYear(), date.getMonth(), date.getDate() - 1,
      JADE_REFRESH_HOURS[JADE_REFRESH_HOURS.length - 1], 0, 0
    );
  }

  /** 勾协检查结果是否可信（确认过） */
  function jadeStatusValid(status) {
    return ['无勾', '普勾', '现勾'].indexOf(String(status || '')) >= 0;
  }

  /**
   * 勾协状态的人类可读描述。
   * 返回 { state, status, kind, time, text }
   *   state 描述"这个周期查过没有"：fresh=本周期已确认、stale=周期已过期、
   *         none=从未执行过
   *   kind  描述"查出来是什么类型"：none / 无勾 / 普勾 / 现勾
   *         —— 筛选按 kind 走（用户要的是勾协类型，不是执行状态）
   *   time  检查时间的短格式：当天 HH:MM，跨天 M-D HH:MM
   *   text  标签文案：类型 + 时间（如「普勾 16:04」「无勾 10-28 15:43」）
   */
  function describeJade(card, now) {
    var status = String((card && card.jade_status) || 'none');
    var when = parseRunTime(card && card.jade_complete_time);
    var nowDate = now === undefined ? new Date()
      : (now instanceof Date ? now : (parseRunTime(now) || new Date()));

    if (!jadeStatusValid(status) || !when) {
      return {
        state: 'none', status: status, kind: 'none',
        time: '', text: '从未查找',
      };
    }
    var fresh = when > jadeRefreshPoint(nowDate);
    var hm = String(when.getHours()).padStart(2, '0')
      + ':' + String(when.getMinutes()).padStart(2, '0');
    var sameDay = when.getFullYear() === nowDate.getFullYear()
      && when.getMonth() === nowDate.getMonth()
      && when.getDate() === nowDate.getDate();
    var time = sameDay ? hm : (when.getMonth() + 1) + '-' + when.getDate() + ' ' + hm;
    return {
      state: fresh ? 'fresh' : 'stale',
      status: status,
      kind: status,
      time: time,
      text: status + ' ' + time,
    };
  }

  /** 勾协类型筛选项（含"从未查找"） */
  var JADE_KINDS = ['none', '无勾', '普勾', '现勾'];
  /** 「勾协已过期」筛选项的取值（state 维度，不是 kind 维度） */
  var JADE_STALE = 'stale';

  /**
   * 勾协筛选判定：类型筛选**只算本周期已确认的结果**。
   *
   * 为什么过期的不算：stale 表示"上个周期查出来的类型，本周期还没重查"。
   * 把它放进「普勾」会让人误以为本周期确认过是普勾 —— 实际上现在可能是现勾，
   * 甚至已经不是勾协了。这和概览里「勾协已过期 N」单独统计是同一套口径。
   *
   * 特例：filter === 'stale' 专门捞"已过期"的（本周期该重查但还没查），
   * 这类卡的类型（无勾/普勾/现勾）都还在，只是周期过了。
   *
   * @param {object} card
   * @param {string} filter  'all' | '无勾' | '普勾' | '现勾' | 'stale' | 'none'
   * @param {Date|string} [now] 注入"现在"便于测试
   * @returns {boolean}
   */
  function matchesJadeFilter(card, filter, now) {
    if (!filter || filter === 'all') return true;
    var info = describeJade(card, now);
    // 「从未查找」只看有没有查过，跟周期无关
    if (filter === 'none') return info.kind === 'none';
    // 「已过期」= 查过、但不是本周期
    if (filter === JADE_STALE) return info.state === 'stale';
    if (info.state !== 'fresh') return false;   // 过期的不进任何类型
    return info.kind === filter;
  }

  /**
   * 勾协统计：**已过期的单独计数**，不混进类型统计。
   *
   * 为什么分开：过期（stale）表示"上个周期查的结果，本周期还没重查"，
   * 把它算进「普勾 N」会让人误以为本周期确认过 N 个普勾。
   *
   * 返回：
   *   fresh  { 无勾, 普勾, 现勾 }  本周期已确认的类型分布
   *   stale  { 无勾, 普勾, 现勾 }  已过期（上周期结果）的类型分布
   *   none   从未查找的数量
   *   total  有效卡（非空角色）总数
   *   freshTotal / staleTotal  两个分组的合计
   */
  function summarizeJade(cards, now) {
    var fresh = { '无勾': 0, '普勾': 0, '现勾': 0 };
    var stale = { '无勾': 0, '普勾': 0, '现勾': 0 };
    var none = 0;
    var total = 0;

    (cards || []).forEach(function (card) {
      if (isBlank(card)) return;
      total += 1;
      var info = describeJade(card, now);
      if (info.state === 'none' || info.kind === 'none') {
        none += 1;
        return;
      }
      var bucket = info.state === 'stale' ? stale : fresh;
      if (bucket[info.kind] === undefined) bucket[info.kind] = 0;
      bucket[info.kind] += 1;
    });

    var freshTotal = fresh['无勾'] + fresh['普勾'] + fresh['现勾'];
    var staleTotal = stale['无勾'] + stale['普勾'] + stale['现勾'];
    return {
      fresh: fresh,
      stale: stale,
      none: none,
      total: total,
      freshTotal: freshTotal,
      staleTotal: staleTotal,
    };
  }

  /**
   * 卡片复制文案：区服 + 角色全名 + 勾协类型。
   * 形如 `遥远之忆-银月二号-普勾`、`花火之夏-黄月八号-无勾`。
   * 用途：把某个账号的定位信息快速发给别人 / 贴到聊天里。
   * @param {object} card
   * @param {string} [kind] 勾协类型，不传则从 card 推（none -> 未查）
   */
  function copySummary(card, kind) {
    card = card || {};
    var svr = String(card.svr || '').trim() || '（无区服）';
    var name = String(card.character || '').trim() || '（无角色名）';
    var jadeKind = kind;
    if (jadeKind === undefined) {
      jadeKind = describeJade(card).kind;
    }
    var jadeText = !jadeKind || jadeKind === 'none' ? '未查' : String(jadeKind);
    return svr + '-' + name + '-' + jadeText;
  }

  var SORT_MODES = {
    id: '按账号 → 系统 → 编号',   // 角色名里的编号只作为第三级
    account: '按账号 → 系统 → 角色名',
  };

  /**
   * 排序。三种方式都是「账号 → 系统」打头，区别只在第三级。
   * @param {Array} cards
   * @param {string} platformOrder  'android' | 'ios'，决定同账号下系统的先后
   * @param {string} mode           'id'（默认）| 'account'
   *
   * 共同的前两级：
   *   1. 账号（按自然序，a2 在 a10 前）
   *   2. 系统（按 platformOrder：安卓在前 / iOS 在前）
   *
   * 第三级：
   *   id      → 角色名里的编号（二号=2、十五号=15），抽不到编号的排同组最后
   *   account → 角色名（按中文拼音）
   *
   * 为什么需要 id：拼音序是 八(bā) < 六(liù) < 七(qī) < 五(wǔ)，
   * 直接排名字会得到 八号→六号→七号→五号；按编号才是 二→五→六→八。
   *
   * 注意：编号**不是**最外层键。同一个账号下如果既有安卓号又有 iOS 号，
   * 系统优先于编号 —— 安卓的二号、六号会排在 iOS 的二号之前。
   */
  function sortCards(cards, platformOrder, mode) {
    var androidFirst = platformOrder !== 'ios';
    var sortMode = mode === 'account' ? 'account' : 'id';

    return cards.slice().sort(function (a, b) {
      // 第一级：账号
      var acc = naturalCompare(a.account, b.account);
      if (acc !== 0) return acc;

      // 第二级：系统
      var pa = isAndroid(a) === androidFirst ? 0 : 1;
      var pb = isAndroid(b) === androidFirst ? 0 : 1;
      if (pa !== pb) return pa - pb;

      // 第三级：编号 或 角色名
      if (sortMode === 'id') {
        var ida = extractNumericId(a.character);
        var idb = extractNumericId(b.character);
        // 有编号的排在前面；编号相同（或都没有）再按名称兜底
        if (ida !== null && idb !== null) {
          if (ida !== idb) return ida - idb;
        } else if (ida !== null) {
          return -1;
        } else if (idb !== null) {
          return 1;
        }
      }
      return naturalCompare(a.character, b.character);
    });
  }

  function isBlank(card) { return !String((card && card.character) || '').trim(); }

  // ---------------------------------------------------------------- 运行状态
  // last_complete_time 的语义（与 tasks/AssistBattle/script_task.py 一致）：
  //   协战完成时写入 datetime.now()，用作"今天是否已完成"的判断依据
  //   （is_account_done_today 里比对 .date() == today）。
  // 历史上出现过两种"从未执行"的哨兵值，都不能当成真实运行时间：
  //   2023-01-01 00:00:00  AccountInfo 的字段默认值
  //   1970-05-11 07:36:15  旧版本写出的偏移值
  var NEVER_RUN_BEFORE = '2023-01-02';
  var RUN_STATE = {
    today: 'today',     // 今天已经执行过
    stale: 'stale',     // 今天没执行（昨天或更早）
    never: 'never',     // 从未执行
  };

  /** 把各种时间写法转成 Date；无效返回 null */
  function parseRunTime(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    // 兼容 '2026-10-25 00:32:06' 与 '2026-10-25T00:32:06'
    var normalized = raw.replace(' ', 'T');
    var date = new Date(normalized);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  /** 本地日期字符串 YYYY-MM-DD */
  function toDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * 判断卡片的运行状态：今天已执行 / 今天没执行 / 从未执行。
   * @param {object} card
   * @param {Date|string} [now] 注入"现在"便于测试，默认取系统时间
   */
  function runState(card, now) {
    var nowDate = now === undefined ? new Date() : (now instanceof Date ? now : parseRunTime(now));
    if (!nowDate || isNaN(nowDate.getTime())) nowDate = new Date();

    var text = String((card && card.last_complete_time) || '').trim();
    if (!text) return RUN_STATE.never;

    var when = parseRunTime(text);
    if (!when) return RUN_STATE.never;
    // 哨兵值：被视为从未执行
    if (toDateKey(when) < NEVER_RUN_BEFORE) return RUN_STATE.never;

    return toDateKey(when) === toDateKey(nowDate) ? RUN_STATE.today : RUN_STATE.stale;
  }

  /** 人类可读的"上次运行"描述，用于卡片显示 */
  function describeRunTime(card, now) {
    var state = runState(card, now);
    if (state === RUN_STATE.never) {
      return { state: state, text: '从未执行' };
    }
    var nowDate = now === undefined ? new Date() : (now instanceof Date ? now : parseRunTime(now));
    if (!nowDate || isNaN(nowDate.getTime())) nowDate = new Date();
    var when = parseRunTime(card.last_complete_time);
    var hm = String(when.getHours()).padStart(2, '0')
      + ':' + String(when.getMinutes()).padStart(2, '0');

    if (state === RUN_STATE.today) {
      return { state: state, text: '今天 ' + hm };
    }
    // 昨天 / 更早：给出相对天数，超过阈值只给日期
    var today0 = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    var when0 = new Date(when.getFullYear(), when.getMonth(), when.getDate());
    var days = Math.round((today0 - when0) / 86400000);
    var dateText = (when.getMonth() + 1) + '-' + when.getDate();
    if (days === 1) return { state: state, text: '昨天 ' + hm };
    if (days <= 7) return { state: state, text: days + ' 天前 ' + hm };
    return { state: state, text: dateText + ' ' + hm };
  }

  /** 按运行状态统计，用于概览 */
  function summarizeRunState(cards, now) {
    var result = { today: 0, stale: 0, never: 0 };
    cards.forEach(function (card) {
      if (isBlank(card)) return;
      result[runState(card, now)] += 1;
    });
    return result;
  }

  function cardKey(card) {
    return String((card && card.account) || '').trim()
      + '\u0000' + String((card && card.character) || '').trim();
  }

  /** 返回出现次数 >1 的 账号+角色 key 集合 */
  function duplicateKeys(cards) {
    var counts = Object.create(null);
    cards.forEach(function (card) {
      if (!card.account || !card.character) return;
      var key = cardKey(card);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts).filter(function (k) { return counts[k] > 1; });
  }

  /**
   * 自动识别一行数据里的列顺序。
   *
   * 支持两种常见格式（Tab 或逗号分隔，自动判断）：
   *   A. 平台, 账号, 服务器, 角色名       ← Excel 里复制出来的表格常见顺序
   *      例：iOS  i154  雅乐之邦  紫星一号
   *   B. 账号, 服务器, 角色名             ← 与 A 相同的顺序，只是省略了平台
   *      例：i154  雅乐之邦  紫星一号
   *      账号格里可以用逗号再挂别名：第一个是账号，其余是别名
   *      例：i154,别名1,别名2（Tab 分列时）；i154,别名1（整行逗号分隔见下）
   *
   * 判定只看**第一列是不是平台标记**，两条确定性规则。
   * 列数不足时，缺失的列由「共同值」补，或留空。
   *
   * @returns {object} 列名到索引的映射
   */
  /** 这一格是不是平台标记（iOS / 安卓 / 苹果…） */
  function looksLikePlatform(cell) {
    var text = String(cell == null ? '' : cell).trim().toLowerCase();
    if (!text) return false;
    if (IOS_WORDS.indexOf(text) >= 0) return true;
    return ['android', '安卓', '安卓端', '苹果', 'ios端', '安卓系统', 'ios系统'].indexOf(text) >= 0;
  }

  function detectColumns(rows) {
    var sample = rows.filter(function (r) { return r && r.length; }).slice(0, 5);
    if (!sample.length) return { platform: -1, account: -1, svr: -1, character: -1, alias: -1 };

    var width = Math.max.apply(null, sample.map(function (r) { return r.length; }));
    var firstCol = sample.map(function (r) { return r[0] === undefined ? '' : r[0]; });
    var firstFilled = firstCol.filter(function (v) { return String(v).trim(); });

    // A 格式：第一列是平台
    var isPlatformFirst = firstFilled.length > 0
      && firstFilled.every(looksLikePlatform);

    if (isPlatformFirst) {
      return {
        platform: 0,
        account: width > 1 ? 1 : -1,
        svr: width > 2 ? 2 : -1,
        character: width > 3 ? 3 : -1,
        alias: width > 4 ? 4 : -1,
      };
    }

    // B 格式：账号, 服务器, 角色名[, 别名][, 平台]（与 A 相同顺序，无平台列）
    var map = {
      account: width > 0 ? 0 : -1,
      svr: width > 1 ? 1 : -1,
      character: width > 2 ? 2 : -1,
      alias: width > 3 ? 3 : -1,
      platform: -1,
    };
    // 第 4 列：是平台就认平台，否则当别名
    if (width > 3) {
      var fourth = sample.map(function (r) { return r[3] === undefined ? '' : r[3]; })
        .filter(function (v) { return String(v).trim(); });
      if (fourth.length && fourth.every(looksLikePlatform)) {
        map.platform = 3;
        map.alias = -1;
      }
    }
    if (width > 4) map.platform = 4;
    return map;
  }

  /**
   * 拆分"账号格"：第一个是账号，其余是别名（用逗号分隔）。
   * 兼容中英文逗号与顿号；整格是邮箱时只取一个。
   */
  function splitAccountCell(cell) {
    var text = String(cell == null ? '' : cell).trim();
    if (!text) return { account: '', aliases: [] };
    var parts = text
      .split(/[,，、]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    if (!parts.length) return { account: '', aliases: [] };
    return { account: parts[0], aliases: parts.slice(1) };
  }

  /**
   * 解析批量粘贴文本。
   *
   * 支持：
   *   - JSON 数组
   *   - 每行一条，Tab 或逗号分隔，列顺序自动识别：
   *       A.「平台, 账号, 服务器, 角色名」     例：iOS  i154  雅乐之邦  紫星一号
   *       B.「账号, 服务器, 角色名[, 别名]」   例：i154  雅乐之邦  紫星一号
   *     两种顺序一致，B 只是省略平台列。
   *     账号格里可用逗号挂别名：第一个是账号，其余是别名（如 i154,别名1,别名2）。
   *   - 共同值：同一批数据里相同的账号/服务器/平台只需在 defaults 里给一次
   *
   * @param {string} text
   * @param {object} [defaults] { account, svr, platform, alias }
   *        行里对应的格子为空时用这里的值补上
   * @returns {{cards: Array, skipped: number, columns: object|null}}
   */
  function parsePaste(text, defaults) {
    var trimmed = String(text == null ? '' : text).trim();
    if (!trimmed) return { cards: [], skipped: 0, columns: null };
    if (trimmed.charAt(0) === '[') {
      var arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) throw new Error('JSON 顶层必须是数组');
      var mapped = arr.map(normalizeCard).filter(function (c) { return !isBlank(c); });
      return { cards: mapped, skipped: arr.length - mapped.length, columns: null };
    }

    var rows = [];
    var skipped = 0;
    trimmed.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      // 行内有 Tab（Excel 复制出来的）就只用 Tab 分列：
      // 这样账号格里的逗号别名（i154,别名1）不会被误切开；
      // 没有 Tab 才退回逗号分列（手工输入的场景）。
      var cells = line.indexOf('\t') >= 0
        ? line.split('\t')
        : line.split(/,/);
      rows.push(cells.map(function (s) { return s.trim(); }));
    });
    if (!rows.length) return { cards: [], skipped: 0, columns: null };

    var columns = detectColumns(rows);
    var base = defaults || {};

    var cards = [];
    rows.forEach(function (cells) {
      var pick = function (role) {
        var index = columns[role];
        return index >= 0 && cells[index] !== undefined ? cells[index] : '';
      };

      var character = pick('character');
      if (!character) { skipped++; return; }

      // 账号格：第一个是账号，其余是别名
      var split = splitAccountCell(pick('account'));
      var account = split.account || base.account || '';
      var svr = pick('svr') || base.svr || '';
      var alias = pick('alias') || split.aliases.join('#') || base.alias || '';

      // 平台：行里给了就用行里的，否则用共同值，最后默认安卓
      var platformRaw = pick('platform');
      var android;
      if (platformRaw) {
        android = IOS_WORDS.indexOf(String(platformRaw).toLowerCase()) < 0;
      } else if (base.platform) {
        android = base.platform !== 'ios';
      } else {
        android = true;
      }

      cards.push(normalizeCard({
        character: character,
        svr: svr,
        account: account,
        account_alias: alias,
        apple_or_android: android,
        last_complete_time: DEFAULT_TIME,
      }));
    });

    return { cards: cards, skipped: skipped, columns: columns };
  }

  /** 概览统计 */
  function summarize(cards) {
    var valid = cards.filter(function (c) { return !isBlank(c); });
    var accounts = Object.create(null);
    valid.forEach(function (c) { accounts[c.account] = true; });
    return {
      total: cards.length,
      valid: valid.length,
      blank: cards.length - valid.length,
      android: valid.filter(isAndroid).length,
      ios: valid.filter(function (c) { return !isAndroid(c); }).length,
      accounts: Object.keys(accounts).length,
      duplicates: duplicateKeys(cards).length,
    };
  }

  var api = {
    DEFAULT_TIME: DEFAULT_TIME,
    SORT_MODES: SORT_MODES,
    RUN_STATE: RUN_STATE,
    naturalCompare: naturalCompare,
    parseChineseNumber: parseChineseNumber,
    extractNumericId: extractNumericId,
    isAndroid: isAndroid,
    emptyCard: emptyCard,
    emptyJadeFields: emptyJadeFields,
    normalizeCard: normalizeCard,
    normalizeJadeCard: normalizeJadeCard,
    sortCards: sortCards,
    isBlank: isBlank,
    cardKey: cardKey,
    duplicateKeys: duplicateKeys,
    parseRunTime: parseRunTime,
    runState: runState,
    describeRunTime: describeRunTime,
    summarizeRunState: summarizeRunState,
    jadeRefreshPoint: jadeRefreshPoint,
    jadeStatusValid: jadeStatusValid,
    describeJade: describeJade,
    JADE_KINDS: JADE_KINDS,
    JADE_STALE: JADE_STALE,
    matchesJadeFilter: matchesJadeFilter,
    summarizeJade: summarizeJade,
    copySummary: copySummary,
    parsePaste: parsePaste,
    detectColumns: detectColumns,
    splitAccountCell: splitAccountCell,
    looksLikePlatform: looksLikePlatform,
    summarize: summarize,
  };

  root.AccountCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
