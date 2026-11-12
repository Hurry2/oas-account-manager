/* core.js 的单元测试：node --test 或直接 node core.test.js */
'use strict';

const assert = require('node:assert');
const Core = require('./core.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (error) {
    failures.push(name);
    console.log('  FAIL ' + name + ' -> ' + error.message);
  }
}

function card(character, account, android, extra) {
  return Core.normalizeCard(Object.assign({
    character: character,
    account: account,
    apple_or_android: android,
  }, extra || {}));
}

console.log('naturalCompare:');
check('数字按数值比较', () => {
  assert.ok(Core.naturalCompare('角色2', '角色10') < 0);
  assert.ok(Core.naturalCompare('角色10', '角色9') > 0);
});
check('相同前缀 + 数字后缀', () => {
  const list = ['红叶10', '红叶2', '红叶1'].slice().sort(Core.naturalCompare);
  assert.deepStrictEqual(list, ['红叶1', '红叶2', '红叶10']);
});
check('空值不报错', () => {
  assert.strictEqual(Core.naturalCompare(null, ''), 0);
});

console.log('isAndroid:');
check('bool 直通', () => {
  assert.strictEqual(Core.isAndroid({ apple_or_android: true }), true);
  assert.strictEqual(Core.isAndroid({ apple_or_android: false }), false);
});
check('字符串兼容', () => {
  assert.strictEqual(Core.isAndroid({ apple_or_android: 'ios' }), false);
  assert.strictEqual(Core.isAndroid({ apple_or_android: 'false' }), false);
  assert.strictEqual(Core.isAndroid({ apple_or_android: 'true' }), true);
});
check('缺字段默认安卓', () => {
  assert.strictEqual(Core.isAndroid({}), true);
});

console.log('normalizeCard:');
check('补全 6 个字段', () => {
  const c = Core.normalizeCard({ character: 'A' });
  assert.deepStrictEqual(Object.keys(c).sort(), [
    'account', 'account_alias', 'apple_or_android', 'character',
    'last_complete_time', 'svr',
  ]);
  assert.strictEqual(c.last_complete_time, Core.DEFAULT_TIME);
});
check('apple_or_android 规范成 bool', () => {
  assert.strictEqual(Core.normalizeCard({ apple_or_android: 'ios' }).apple_or_android, false);
});

console.log('parseChineseNumber:');
check('个位数', () => {
  assert.strictEqual(Core.parseChineseNumber('二'), 2);
  assert.strictEqual(Core.parseChineseNumber('九'), 9);
});
check('十位（十前省略 1）', () => {
  assert.strictEqual(Core.parseChineseNumber('十'), 10);
  assert.strictEqual(Core.parseChineseNumber('十五'), 15);
});
check('十位（十前有数字）', () => {
  assert.strictEqual(Core.parseChineseNumber('二十三'), 23);
  assert.strictEqual(Core.parseChineseNumber('九十九'), 99);
});
check('百位含零', () => {
  assert.strictEqual(Core.parseChineseNumber('一百零五'), 105);
  assert.strictEqual(Core.parseChineseNumber('一百二十三'), 123);
});
check('非数字返回 null', () => {
  assert.strictEqual(Core.parseChineseNumber('银月'), null);
  assert.strictEqual(Core.parseChineseNumber(''), null);
});

console.log('extractNumericId:');
check('真实角色名（汉字单位）', () => {
  assert.strictEqual(Core.extractNumericId('银星二号'), 2);
  assert.strictEqual(Core.extractNumericId('银月六号'), 6);
  assert.strictEqual(Core.extractNumericId('红月八号'), 8);
});
check('阿拉伯数字优先', () => {
  assert.strictEqual(Core.extractNumericId('银月6号'), 6);
  assert.strictEqual(Core.extractNumericId('acct-06'), 6);
});
check('复合汉字数字', () => {
  assert.strictEqual(Core.extractNumericId('十五号'), 15);
  assert.strictEqual(Core.extractNumericId('二十三号'), 23);
});
check('取最后一个候选（前缀里的数字不算）', () => {
  assert.strictEqual(Core.extractNumericId('十区银月六号'), 6);
});
check('无编号返回 null', () => {
  assert.strictEqual(Core.extractNumericId('没有数字'), null);
  assert.strictEqual(Core.extractNumericId(''), null);
  assert.strictEqual(Core.extractNumericId(null), null);
});

console.log('sortCards — id 模式:');
check('按编号而非拼音（二号 < 五号 < 六号 < 八号）', () => {
  // 拼音序是 八(bā) < 六(liù) < 七(qī) < 五(wǔ)，必须靠编号纠正
  const cards = [
    card('银月八号', 'a', true),
    card('银月六号', 'a', true),
    card('银月二號', 'a', true),
    card('银月七号', 'a', true),
  ];
  const out = Core.sortCards(cards, 'android', 'id').map((c) => c.character);
  assert.deepStrictEqual(out, ['银月二號', '银月六号', '银月七号', '银月八号']);
});
check('你的真实数据（账号 → 系统 → 编号）', () => {
  const cards = [
    card('银星二号', 'example001@example.com', false),
    card('银月八号', 'example001@example.com', true),
    card('银月六号', 'example001@example.com', true),
    card('银月七号', 'example001@example.com', true),
    card('红月八号', 'example002@example.com', true),
    card('红月六号', 'example002@example.com', true),
    card('红月七号', 'example002@example.com', true),
    card('红月五号', 'example002@example.com', true),
  ];
  // 安卓优先：a 账号的安卓 6/7/8 先出，iOS 的二号排在该组末尾
  const out = Core.sortCards(cards, 'android', 'id').map((c) => c.character);
  assert.deepStrictEqual(out, [
    '银月六号', '银月七号', '银月八号', '银星二号',
    '红月五号', '红月六号', '红月七号', '红月八号',
  ]);
});
check('编号不能越过系统（回归）', () => {
  const cards = [card('银月二号', 'a', false), card('银月六号', 'a', true)];
  assert.deepStrictEqual(
    Core.sortCards(cards, 'android', 'id').map((c) => c.character),
    ['银月六号', '银月二号'],
  );
});
check('无编号的排在有编号之后', () => {
  const cards = [card('备用号', 'a', true), card('银月六号', 'a', true)];
  const out = Core.sortCards(cards, 'android', 'id').map((c) => c.character);
  assert.deepStrictEqual(out, ['银月六号', '备用号']);
});
check('id 模式默认生效（不传 mode 也算 id）', () => {
  const cards = [card('银月八号', 'a', true), card('银月二号', 'a', true)];
  const out = Core.sortCards(cards, 'android').map((c) => c.character);
  assert.deepStrictEqual(out, ['银月二号', '银月八号']);
});
check('编号相同仍先比系统', () => {
  const cards = [
    card('甲六号', 'a', false),
    card('乙六号', 'a', true),
  ];
  const out = Core.sortCards(cards, 'android', 'id').map((c) => c.character);
  assert.deepStrictEqual(out, ['乙六号', '甲六号']);
});
check('id 模式不修改入参', () => {
  const cards = [card('银月八号', 'a', true), card('银月二号', 'a', true)];
  const before = cards.map((c) => c.character).join(',');
  Core.sortCards(cards, 'android', 'id');
  assert.strictEqual(cards.map((c) => c.character).join(','), before);
});

console.log('sortCards — account 模式（旧行为不变）:');
check('仍按 账号 → 平台 → 拼音角色名', () => {
  const cards = [
    card('红叶2', 'b@x.com', true),
    card('茨木', 'a@x.com', false),
    card('红叶10', 'a@x.com', true),
  ];
  const out = Core.sortCards(cards, 'android', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['红叶10', '茨木', '红叶2']);
});


check('账号 → 平台 → 角色（安卓优先）', () => {
  const cards = [
    card('红叶2', 'b@x.com', true),
    card('茨木', 'a@x.com', false),
    card('红叶10', 'a@x.com', true),
  ];
  const out = Core.sortCards(cards, 'android', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['红叶10', '茨木', '红叶2']);
});
check('账号 → 平台 → 角色（iOS 优先）', () => {
  const cards = [
    card('红叶2', 'b@x.com', true),
    card('茨木', 'a@x.com', false),
    card('红叶10', 'a@x.com', true),
  ];
  const out = Core.sortCards(cards, 'ios', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['茨木', '红叶10', '红叶2']);
});
check('不修改入参', () => {
  const cards = [card('B', 'b', true), card('A', 'a', true)];
  const before = cards.map((c) => c.character).join(',');
  Core.sortCards(cards, 'android', 'account');
  assert.strictEqual(cards.map((c) => c.character).join(','), before);
});
check('账号相同且平台相同按角色自然序', () => {
  const cards = [
    card('角色10', 'a', true),
    card('角色2', 'a', true),
    card('角色1', 'a', true),
  ];
  const out = Core.sortCards(cards, 'android', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['角色1', '角色2', '角色10']);
});
check('中文按拼音排序（八 < 六 < 七 < 五）— account 模式', () => {
  const names = ['红月五号', '红月七号', '红月六号', '红月八号'];
  const cards = names.map((n) => card(n, 'b', true));
  const out = Core.sortCards(cards, 'android', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['红月八号', '红月六号', '红月七号', '红月五号']);
});
check('真实数据：安卓优先时 iOS 角色排在账号组末尾', () => {
  const cards = [
    card('银星二号', 'a', false),
    card('银月六号', 'a', true),
    card('银月七号', 'a', true),
    card('红月五号', 'b', true),
  ];
  const out = Core.sortCards(cards, 'android', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['银月六号', '银月七号', '银星二号', '红月五号']);
});
check('真实数据：iOS 优先时 iOS 角色排到账号组最前', () => {
  const cards = [
    card('银星二号', 'a', false),
    card('银月六号', 'a', true),
    card('银月七号', 'a', true),
    card('红月五号', 'b', true),
  ];
  const out = Core.sortCards(cards, 'ios', 'account').map((c) => c.character);
  assert.deepStrictEqual(out, ['银星二号', '银月六号', '银月七号', '红月五号']);
});

console.log('runState / describeRunTime:');
{
  const NOW = '2026-10-26 10:00:00';

  check('今天的时间 → today', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '2026-10-26 08:15:30' }, NOW),
      Core.RUN_STATE.today,
    );
  });
  check('今天零点刚过仍算今天', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '2026-10-26 00:00:01' }, NOW),
      Core.RUN_STATE.today,
    );
  });
  check('昨天 23:59:59 → stale（跨天边界）', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '2026-10-25 23:59:59' }, NOW),
      Core.RUN_STATE.stale,
    );
  });
  check('默认哨兵 2023-01-01 → never', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '2023-01-01 00:00:00' }, NOW),
      Core.RUN_STATE.never,
    );
  });
  check('旧哨兵 1970-05-11 → never', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '1970-05-11 07:36:15' }, NOW),
      Core.RUN_STATE.never,
    );
  });
  check('空值 / 非法值 → never', () => {
    assert.strictEqual(Core.runState({ last_complete_time: '' }, NOW), Core.RUN_STATE.never);
    assert.strictEqual(Core.runState({}, NOW), Core.RUN_STATE.never);
    assert.strictEqual(
      Core.runState({ last_complete_time: 'not-a-date' }, NOW),
      Core.RUN_STATE.never,
    );
  });
  check('兼容 ISO 的 T 分隔写法', () => {
    assert.strictEqual(
      Core.runState({ last_complete_time: '2026-10-26T07:00:00' }, NOW),
      Core.RUN_STATE.today,
    );
  });

  check('描述：今天显示时:分', () => {
    assert.strictEqual(
      Core.describeRunTime({ last_complete_time: '2026-10-26 08:15:30' }, NOW).text,
      '今天 08:15',
    );
  });
  check('描述：昨天', () => {
    assert.strictEqual(
      Core.describeRunTime({ last_complete_time: '2026-10-25 23:05:00' }, NOW).text,
      '昨天 23:05',
    );
  });
  check('描述：数天前', () => {
    assert.strictEqual(
      Core.describeRunTime({ last_complete_time: '2026-10-23 09:00:00' }, NOW).text,
      '3 天前 09:00',
    );
  });
  check('描述：超过一周显示日期', () => {
    assert.strictEqual(
      Core.describeRunTime({ last_complete_time: '2026-10-01 09:00:00' }, NOW).text,
      '10-1 09:00',
    );
  });
  check('描述：从未执行', () => {
    assert.strictEqual(
      Core.describeRunTime({ last_complete_time: '2023-01-01 00:00:00' }, NOW).text,
      '从未执行',
    );
  });

  check('summarizeRunState 统计三类', () => {
    const cards = [
      card('A', 'a', true),
      card('B', 'a', true),
      card('C', 'b', true),
      card('D', 'b', true),
    ];
    cards[0].last_complete_time = '2026-10-26 01:00:00'; // today
    cards[1].last_complete_time = '2026-10-25 01:00:00'; // stale
    cards[2].last_complete_time = '2023-01-01 00:00:00'; // never
    cards[3].last_complete_time = '2026-10-26 05:00:00'; // today
    assert.deepStrictEqual(
      Core.summarizeRunState(cards, NOW),
      { today: 2, stale: 1, never: 1 },
    );
  });
  check('summarizeRunState 忽略空角色卡', () => {
    const cards = [Core.emptyCard()];
    assert.deepStrictEqual(
      Core.summarizeRunState(cards, NOW),
      { today: 0, stale: 0, never: 0 },
    );
  });
}

console.log('detectColumns:');
{
  check('A 格式：平台 账号 服务器 角色名', () => {
    const rows = [['iOS', 'i154', '雅乐之邦', '紫星一号']];
    assert.deepStrictEqual(Core.detectColumns(rows),
      { platform: 0, account: 1, svr: 2, character: 3, alias: -1 });
  });
  check('B 格式（新）：账号 服务器 角色名 —— 与 A 同顺序', () => {
    const rows = [['i154', '雅乐之邦', '紫星一号']];
    assert.deepStrictEqual(Core.detectColumns(rows),
      { account: 0, svr: 1, character: 2, alias: -1, platform: -1 });
  });
  check('B 格式 5 列：末列是平台', () => {
    const rows = [['i154', '雅乐之邦', '紫星一号', '别名1', 'ios']];
    assert.deepStrictEqual(Core.detectColumns(rows),
      { account: 0, svr: 1, character: 2, alias: 3, platform: 4 });
  });
  check('B 格式 4 列：第 4 列是平台时不算别名', () => {
    const rows = [['i154', '雅乐之邦', '紫星一号', 'iOS']];
    const cols = Core.detectColumns(rows);
    assert.strictEqual(cols.platform, 3);
    assert.strictEqual(cols.alias, -1);
  });
  check('单列只写角色名', () => {
    const rows = [['紫星一号'], ['紫星二号']];
    const cols = Core.detectColumns(rows);
    assert.strictEqual(cols.character, -1);
    assert.strictEqual(cols.account, 0);
  });
  check('安卓开头同样识别为 A 格式', () => {
    const rows = [['安卓', 'a154', '千山醉', '银月八号']];
    assert.equal(Core.detectColumns(rows).platform, 0);
    assert.equal(Core.detectColumns(rows).character, 3);
  });
}

console.log('splitAccountCell:');
check('纯账号', () => {
  assert.deepStrictEqual(Core.splitAccountCell('i154'),
    { account: 'i154', aliases: [] });
});
check('账号 + 逗号别名', () => {
  assert.deepStrictEqual(Core.splitAccountCell('i154,小号1,小号2'),
    { account: 'i154', aliases: ['小号1', '小号2'] });
});
check('中文逗号/顿号也支持', () => {
  assert.deepStrictEqual(Core.splitAccountCell('i154，小号1、小号2'),
    { account: 'i154', aliases: ['小号1', '小号2'] });
});
check('邮箱不拆分', () => {
  assert.deepStrictEqual(Core.splitAccountCell('a@x.com'),
    { account: 'a@x.com', aliases: [] });
});
check('空值', () => {
  assert.deepStrictEqual(Core.splitAccountCell(''), { account: '', aliases: [] });
});

console.log('parsePaste:');
check('用户的 Excel 格式（平台 账号 服务器 角色名）', () => {
  const text = [
    'iOS\ti154\t雅乐之邦\t紫星一号',
    'iOS\ti154\t花火之夏\t紫星二号',
    'iOS\ti154\t相伴相随\t紫星三号',
    'iOS\ti154\t砂狐乐园\t紫星四号',
  ].join('\n');
  const r = Core.parsePaste(text);
  assert.strictEqual(r.cards.length, 4);
  assert.deepStrictEqual(
    r.cards.map((c) => [c.character, c.svr, c.account]),
    [
      ['紫星一号', '雅乐之邦', 'i154'],
      ['紫星二号', '花火之夏', 'i154'],
      ['紫星三号', '相伴相随', 'i154'],
      ['紫星四号', '砂狐乐园', 'i154'],
    ],
  );
  assert.strictEqual(r.cards[0].apple_or_android, false); // iOS
});
check('B 新格式（账号 服务器 角色名，Tab 分列）', () => {
  const r = Core.parsePaste('i154\t雅乐之邦\t紫星一号\ni164\t花火之夏\t紫星二号');
  assert.strictEqual(r.cards.length, 2);
  assert.deepStrictEqual(
    r.cards.map((c) => [c.character, c.svr, c.account]),
    [['紫星一号', '雅乐之邦', 'i154'], ['紫星二号', '花火之夏', 'i164']],
  );
});
check('账号格逗号挂别名（Tab 行内不被切散）', () => {
  const r = Core.parsePaste('i154,小号1,小号2\t雅乐之邦\t紫星一号');
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.cards[0].character, '紫星一号');
  assert.strictEqual(r.cards[0].account, 'i154');
  assert.strictEqual(r.cards[0].account_alias, '小号1#小号2');
});
check('逗号整行（无 Tab）：账号,服务器,角色名', () => {
  const r = Core.parsePaste('i154,雅乐之邦,紫星一号');
  assert.strictEqual(r.cards[0].character, '紫星一号');
  assert.strictEqual(r.cards[0].svr, '雅乐之邦');
  assert.strictEqual(r.cards[0].account, 'i154');
});
check('共同值：补平台', () => {
  const r = Core.parsePaste('i154\t雅乐之邦\t紫星一号', { platform: 'ios' });
  assert.strictEqual(r.cards[0].apple_or_android, false);
});
check('共同值：补账号和服务器（行内优先）', () => {
  const r = Core.parsePaste('i164\t花火之夏\t紫星二号', {
    account: 'i154', svr: '雅乐之邦', platform: 'ios',
  });
  assert.strictEqual(r.cards[0].svr, '花火之夏');
  assert.strictEqual(r.cards[0].account, 'i164');
  assert.strictEqual(r.cards[0].apple_or_android, false);
});
check('共同值：安卓平台', () => {
  const r = Core.parsePaste('a154\t千山醉\t银月八号', { account: 'a154', platform: 'android' });
  assert.strictEqual(r.cards[0].apple_or_android, true);
});
check('Tab 分隔（A 格式 5 列含别名和平台）', () => {
  const r = Core.parsePaste('安卓\ta@x.com\t网易安卓\t红叶\t别名1');
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.cards[0].character, '红叶');
  assert.strictEqual(r.cards[0].svr, '网易安卓');
  assert.strictEqual(r.cards[0].account, 'a@x.com');
  assert.strictEqual(r.cards[0].account_alias, '别名1');
  assert.strictEqual(r.cards[0].apple_or_android, true);
});
check('逗号分隔整行（B 格式 + 平台列）', () => {
  const r = Core.parsePaste('b@x.com,网易iOS,茨木,别名1,ios');
  assert.strictEqual(r.cards[0].apple_or_android, false);
  assert.strictEqual(r.cards[0].character, '茨木');
});
check('多行 + 空行忽略', () => {
  const r = Core.parsePaste('a1\tS1\tA\n\na2\tS2\tB\n');
  assert.strictEqual(r.cards.length, 2);
  assert.strictEqual(r.skipped, 0);
});
check('缺列不报错（单列当账号，角色名缺省跳过）', () => {
  const r = Core.parsePaste('只有一格');
  assert.strictEqual(r.cards.length, 0);
  assert.strictEqual(r.skipped, 1);
});
check('角色名为空的行跳过', () => {
  const r = Core.parsePaste('账号\t服\t\n账号2\t服2\t角色2');
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.skipped, 1);
});
check('JSON 数组', () => {
  const r = Core.parsePaste(JSON.stringify([
    { character: 'A', account: 'a', apple_or_android: false },
    { character: '', account: 'b' },
  ]));
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.skipped, 1);
});
check('空文本返回空数组', () => {
  assert.deepStrictEqual(Core.parsePaste('   '), { cards: [], skipped: 0, columns: null });
});
check('非法 JSON 抛错', () => {
  assert.throws(() => Core.parsePaste('[{"a":1,}]'), /JSON/);
});

console.log('duplicateKeys / summarize:');
check('识别同账号同角色重复', () => {
  const cards = [card('A', 'a', true), card('A', 'a', true), card('B', 'a', true)];
  assert.deepStrictEqual(Core.duplicateKeys(cards), [Core.cardKey(cards[0])]);
});
check('不同平台同账号同角色也算重复', () => {
  const cards = [card('A', 'a', true), card('A', 'a', false)];
  assert.strictEqual(Core.duplicateKeys(cards).length, 1);
});
check('统计正确', () => {
  const cards = [
    card('A', 'a', true),
    card('B', 'a', false),
    card('C', 'b', true),
    Core.emptyCard(),
  ];
  const s = Core.summarize(cards);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.valid, 3);
  assert.strictEqual(s.blank, 1);
  assert.strictEqual(s.android, 2);
  assert.strictEqual(s.ios, 1);
  assert.strictEqual(s.accounts, 2);
});

console.log('jade（勾协，一键协战专属）:');
check('normalizeJadeCard 补全 8 个字段', () => {
  const c = Core.normalizeJadeCard({ character: 'A', jade_status: '普勾' });
  assert.strictEqual(c.jade_status, '普勾');
  assert.strictEqual(c.jade_complete_time, Core.DEFAULT_TIME);
  assert.strictEqual(c.character, 'A');
  assert.strictEqual(Object.keys(c).length, 8);
});
check('normalizeJadeCard 缺省状态是 none', () => {
  const c = Core.normalizeJadeCard({ character: 'A' });
  assert.strictEqual(c.jade_status, 'none');
  assert.strictEqual(Core.jadeStatusValid(c.jade_status), false);
});
check('normalizeCard 不带勾协字段（其它任务列表不受影响）', () => {
  const c = Core.normalizeCard({ character: 'A' });
  assert.strictEqual(c.jade_status, undefined);
});
check('jadeRefreshPoint: 5 点前归昨天 18 点', () => {
  const now = new Date(2026, 9, 28, 4, 59);
  const p = Core.jadeRefreshPoint(now);
  assert.strictEqual(p.getDate(), 27);
  assert.strictEqual(p.getHours(), 18);
});
check('jadeRefreshPoint: 12 点 -> 今天 5 点', () => {
  const p = Core.jadeRefreshPoint(new Date(2026, 9, 28, 12, 0));
  assert.strictEqual(p.getDate(), 28);
  assert.strictEqual(p.getHours(), 5);
});
check('jadeRefreshPoint: 19 点 -> 今天 18 点', () => {
  const p = Core.jadeRefreshPoint(new Date(2026, 9, 28, 19, 0));
  assert.strictEqual(p.getDate(), 28);
  assert.strictEqual(p.getHours(), 18);
});
check('describeJade: 从未执行（none）', () => {
  const info = Core.describeJade({ jade_status: 'none' });
  assert.strictEqual(info.state, 'none');
  assert.strictEqual(info.text, '从未查找');
});
check('describeJade: 本周期确认过（fresh）', () => {
  const card = { jade_status: '普勾', jade_complete_time: '2026-10-28 06:30:00' };
  const info = Core.describeJade(card, new Date(2026, 9, 28, 12, 0));
  assert.strictEqual(info.state, 'fresh');
  assert.strictEqual(info.status, '普勾');
  assert.strictEqual(info.kind, '普勾');   // 筛选按 kind 走
  assert.strictEqual(info.time, '06:30');  // 当天只显示时分
  assert.strictEqual(info.text, '普勾 06:30');
});
check('describeJade: 周期已过期（stale）但类型与时间保留', () => {
  const card = { jade_status: '现勾', jade_complete_time: '2026-10-28 08:00:00' };
  const info = Core.describeJade(card, new Date(2026, 9, 28, 19, 0));
  assert.strictEqual(info.state, 'stale');
  assert.strictEqual(info.kind, '现勾');   // 过期也保留类型
  assert.strictEqual(info.time, '08:00');
  assert.strictEqual(info.text, '现勾 08:00');
});
check('describeJade: 跨天显示日期', () => {
  const card = { jade_status: '无勾', jade_complete_time: '2026-10-27 20:00:00' };
  const info = Core.describeJade(card, new Date(2026, 9, 28, 12, 0));
  assert.strictEqual(info.state, 'stale');
  assert.strictEqual(info.kind, '无勾');
  assert.strictEqual(info.time, '10-27 20:00');
  assert.strictEqual(info.text, '无勾 10-27 20:00');
});
check('describeJade: 从未查找无时间', () => {
  const info = Core.describeJade({ jade_status: '不知道' });
  assert.strictEqual(info.state, 'none');
  assert.strictEqual(info.kind, 'none');
  assert.strictEqual(info.time, '');
  assert.strictEqual(info.text, '从未查找');
});
check('JADE_KINDS 覆盖四种类型', () => {
  assert.deepStrictEqual(Core.JADE_KINDS, ['none', '无勾', '普勾', '现勾']);
});

// ---------------------------------------------------------------- summarizeJade
// 过期（stale）必须单独统计，不能算进本周期已确认的类型里
check('summarizeJade: 过期单独统计，不混入 fresh', () => {
  const now = new Date(2026, 9, 29, 18, 43);   // 18:43，刷新点=今天 18:00
  const cards = [
    // 本周期（18:00 之后查的）→ fresh
    { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-29 18:10:00' },
    { character: 'B', jade_status: '无勾', jade_complete_time: '2026-10-29 18:20:00' },
    // 已过期（18:00 之前查的）→ stale，不能算进上面
    { character: 'C', jade_status: '普勾', jade_complete_time: '2026-10-29 15:00:00' },
    { character: 'D', jade_status: '现勾', jade_complete_time: '2026-10-29 16:00:00' },
    // 从未查找
    { character: 'E', jade_status: 'none', jade_complete_time: '2023-01-01 00:00:00' },
  ];
  const s = Core.summarizeJade(cards, now);
  assert.strictEqual(s.fresh['普勾'], 1, 'fresh 普勾只算本周期那 1 个');
  assert.strictEqual(s.fresh['无勾'], 1);
  assert.strictEqual(s.fresh['现勾'], 0);
  assert.strictEqual(s.freshTotal, 2);
  assert.strictEqual(s.stale['普勾'], 1, '过期普勾单独统计');
  assert.strictEqual(s.stale['现勾'], 1);
  assert.strictEqual(s.stale['无勾'], 0);
  assert.strictEqual(s.staleTotal, 2);
  assert.strictEqual(s.none, 1);
  assert.strictEqual(s.total, 5);
});
check('summarizeJade: 无过期时 stale 全 0', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const cards = [
    { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-29 18:10:00' },
  ];
  const s = Core.summarizeJade(cards, now);
  assert.strictEqual(s.staleTotal, 0);
  assert.strictEqual(s.freshTotal, 1);
});
check('summarizeJade: 空角色卡不计入', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const s = Core.summarizeJade([
    { character: '', jade_status: '普勾', jade_complete_time: '2026-10-29 18:10:00' },
    { character: 'A', jade_status: '无勾', jade_complete_time: '2026-10-29 18:20:00' },
  ], now);
  assert.strictEqual(s.total, 1);
  assert.strictEqual(s.freshTotal, 1);
});
check('summarizeJade: 空列表', () => {
  const s = Core.summarizeJade([], new Date(2026, 9, 29, 18, 43));
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.freshTotal, 0);
  assert.strictEqual(s.staleTotal, 0);
  assert.strictEqual(s.none, 0);
});

// ---------------------------------------------------------------- matchesJadeFilter
// 用户要求：「普勾 / 现勾」筛选不要把过期的放进去（三个类型统一口径）
check('matchesJadeFilter: all 全放行', () => {
  const c = { character: 'A', jade_status: '普勾', jade_complete_time: '2020-01-01 00:00:00' };
  assert.strictEqual(Core.matchesJadeFilter(c, 'all'), true);
  assert.strictEqual(Core.matchesJadeFilter(c, undefined), true);
});

check('matchesJadeFilter: 本周期确认的类型能匹配', () => {
  const now = new Date(2026, 9, 29, 18, 43);   // 刷新点 = 今天 18:00
  const c = { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-29 18:10:00' };
  assert.strictEqual(Core.matchesJadeFilter(c, '普勾', now), true);
  assert.strictEqual(Core.matchesJadeFilter(c, '现勾', now), false);
  assert.strictEqual(Core.matchesJadeFilter(c, '无勾', now), false);
});

check('matchesJadeFilter: 过期的普勾不进「普勾」筛选', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const c = { character: 'A', jade_status: '普勾', jade_complete_time: '2026-10-29 15:00:00' };
  assert.strictEqual(Core.matchesJadeFilter(c, '普勾', now), false);
});

check('matchesJadeFilter: 过期的现勾不进「现勾」筛选', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const c = { character: 'A', jade_status: '现勾', jade_complete_time: '2026-10-29 16:00:00' };
  assert.strictEqual(Core.matchesJadeFilter(c, '现勾', now), false);
});

check('matchesJadeFilter: 过期的无勾也不进「无勾」筛选', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const c = { character: 'A', jade_status: '无勾', jade_complete_time: '2026-10-28 16:00:00' };
  assert.strictEqual(Core.matchesJadeFilter(c, '无勾', now), false);
});

check('matchesJadeFilter: none 只看查没查过，不看周期', () => {
  const now = new Date(2026, 9, 29, 18, 43);
  const never = { character: 'A', jade_status: 'none', jade_complete_time: '2023-01-01 00:00:00' };
  const stale = { character: 'B', jade_status: '普勾', jade_complete_time: '2026-10-29 15:00:00' };
  assert.strictEqual(Core.matchesJadeFilter(never, 'none', now), true);
  assert.strictEqual(Core.matchesJadeFilter(stale, 'none', now), false);
});

check('matchesJadeFilter: 缺字段的卡按未查找处理', () => {
  assert.strictEqual(Core.matchesJadeFilter({ character: 'A' }, 'none'), true);
  assert.strictEqual(Core.matchesJadeFilter({ character: 'A' }, '普勾'), false);
});

// ---------------------------------------------------------------- copySummary
check('copySummary: 区服-角色全名-勾协类型', () => {
  const card = {
    character: '银月二号', svr: '遥远之忆',
    jade_status: '普勾', jade_complete_time: '2026-10-28 16:04:27',
  };
  assert.strictEqual(Core.copySummary(card), '遥远之忆-银月二号-普勾');
});
check('copySummary: 无勾', () => {
  const card = {
    character: '黄月五号', svr: '相伴相随',
    jade_status: '无勾', jade_complete_time: '2026-10-28 15:43:27',
  };
  assert.strictEqual(Core.copySummary(card), '相伴相随-黄月五号-无勾');
});
check('copySummary: 从未查找显示"未查"', () => {
  const card = { character: '黄月八号', svr: '相闻秋歌', jade_status: 'none' };
  assert.strictEqual(Core.copySummary(card), '相闻秋歌-黄月八号-未查');
});
check('copySummary: 角色名保留完整（不抽编号）', () => {
  const card = {
    character: 'acct-06', svr: '雅乐之邦',
    jade_status: '现勾', jade_complete_time: '2026-10-28 10:00:00',
  };
  assert.strictEqual(Core.copySummary(card), '雅乐之邦-acct-06-现勾');
});
check('copySummary: 无区服兜底', () => {
  const card = { character: '银月三号', svr: '', jade_status: '无勾',
    jade_complete_time: '2026-10-28 10:00:00' };
  assert.strictEqual(Core.copySummary(card), '（无区服）-银月三号-无勾');
});
check('copySummary: 无角色名兜底', () => {
  const card = { character: '', svr: '千山醉', jade_status: 'none' };
  assert.strictEqual(Core.copySummary(card), '千山醉-（无角色名）-未查');
});
check('copySummary: 可显式传 kind', () => {
  const card = { character: '银月六号', svr: '砂狐乐园' };
  assert.strictEqual(Core.copySummary(card, '现勾'), '砂狐乐园-银月六号-现勾');
});

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过（' + passed + ' 项）');
