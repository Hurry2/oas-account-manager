#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""账号列表管理工具（独立于 OAS / OASX，不修改任何仓库源码）

解决的问题
----------
OAS 把多账号列表存成平铺的 ``account_list_1`` / ``account_list_2`` ... 一批 key，
顺序就是 key 编号顺序；面板只能“把数量 +1 再在末尾填一张空卡”，
中间插队 / 删除 / 排序都做不到。本工具直接读写 config/*.json，
以“整表重写”的方式实现：排序、中间插入、删除、批量粘贴。

支持的列表
----------
    assist_battle    account_list_1..N     (计数键 battle_config.account_count)
    account_switch   account_list_1..N     (计数键 account_switch_config.switch_account_count)
    find_jade        sup_account_list_1..N (计数键 find_jade_config.sup_account_count)

安全策略
--------
* 写盘前把原文件备份到 backups/ 下（带时间戳）
* 写盘用临时文件 + 原子替换
* 读与写之间文件被外部改动（比如脚本进程 save() 回写）会拒绝保存，提示重新加载
* 只动目标任务的 *_list_N 这批 key 和对应的计数字段，其它配置原样保留

用法
----
    toolkit\\python.exe .agents\\tools\\account-manager\\server.py
    toolkit\\python.exe ... --port 22299 --root E:\\git_src\\OnmyojiAutoScript
    toolkit\\python.exe ... --selftest          # 离线自检，不碰真实配置

⚠ 运行 OAS 实例时改本文件会被脚本进程的 save() 覆盖，建议先停实例。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# 本目录下的 settings.py：管理 OAS 根目录的预设（支持局域网路径）
sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings as _settings  # noqa: E402

# ---------------------------------------------------------------------------
# 控制台编码加固
# 快捷方式是用 pythonw.exe 直接启动的，它的 stdout 编码是 GBK（甚至可能为 None），
# 直接 print 中文会抛 UnicodeEncodeError 让进程静默退出。这里统一改成 UTF-8 并容错，
# 保证无论从 cmd、PowerShell 还是 pythonw 启动都不会因为打印崩掉。
# ---------------------------------------------------------------------------
def _harden_console() -> None:
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            # pythonw 下没有控制台：丢掉输出，避免 print 抛错
            setattr(sys, stream_name, open(os.devnull, 'w', encoding='utf-8'))
            continue
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


_harden_console()

DEFAULT_PORT = 22299

# 接口契约版本：每次新增/修改 API 都递增。
# 前端会在启动时比对 /api/ping 返回的 contract，提示"服务是旧代码，请重启"。
# 这解决一个实际踩过的坑：页面文件每次请求都从磁盘读，改了立刻生效；
# 但 server.py 只在进程启动时加载，旧进程认不得新路由，请求只会得到
# 一个毫无线索的 "not found"。
# v6（2026-10-31）：读取容忍半写文件 + 连接排队上限抬高，
#   修「重新加载偶发不刷新」。这两项都在后端，必须重启进程才生效，
#   所以递增契约版本，让旧进程主动提示重启。
CONTRACT_VERSION = 6

CARD_FIELDS = [
    'character',
    'svr',
    'account',
    'account_alias',
    'apple_or_android',
    'last_complete_time',
]
# 一键协战专属（AssistBattleAccountInfo）：协战中寻找勾协的结果与时间
JADE_FIELDS = ('jade_status', 'jade_complete_time')
JADE_STATUS_DEFAULT = 'none'
DEFAULT_TIME = '2023-01-01 00:00:00'

TARGETS = {
    'assist_battle': {
        'label': '一键协战',
        'list_key': 'account_list',
        # ⚠ 这一组名字改过两次：
        #   原 assist_battle_config → 拆组时改叫 battle_config
        #   → 2026-11 又改回 assist_battle_config
        #   （tasks/AssistBattle/config.py:159，loader 会把 battle_config 迁移过来）
        # 所以这里按"候选列表"处理：**优先用配置里实际存在的那个**，
        # 都没有才建第一个。写死单个名字会在改名后新建一个空节点、
        # 真实计数永远不同步（这个坑踩过一次：加/删账号但数量不变）。
        'count_groups': ['assist_battle_config', 'battle_config'],
        'count_key': 'account_count',
        'jade': True,
    },
    'account_switch': {
        'label': '切号执行任务',
        'list_key': 'account_list',
        'count_groups': ['account_switch_config'],
        'count_key': 'switch_account_count',
        # 这个任务有个"轮换指针" current_index：记录下一个该切哪个号。
        # 工具重排/删号后指针会指错人（删掉第 1 个后指针还指 1，
        # 就跳过一个号了），保存时要跟着修正。
        'cursor_key': 'current_index',
        # 工具不直接编辑、但要在界面上告诉用户的字段
        'extra_keys': ['trigger_all_enabled_tasks', 'current_index', 'usage'],
    },
    'find_jade': {
        'label': '寻勾协（小号）',
        'list_key': 'sup_account_list',
        'count_groups': ['find_jade_config'],
        'count_key': 'sup_account_count',
    },
}


def resolve_count_group(section: dict, spec: dict) -> str:
    """在配置节点里找出"实际存在的"计数分组名。

    OAS 把这些分组改过名，工具不能跟着写死：优先用候选里已经存在的那个，
    这样保存时改的就是真实生效的节点，而不是新建一个空壳。
    都不存在时返回第一个候选（新建用）。
    """
    groups = spec.get('count_groups') or [spec.get('count_group')]
    for name in groups:
        if name and isinstance(section.get(name), dict):
            return name
    return groups[0]


# --------------------------------------------------------------------------- 基础工具
def natural_key(text: str):
    """数字按数值比较、其余忽略大小写的自然排序 key"""
    parts = []
    for token in re.split(r'(\d+)', str(text or '')):
        if not token:
            continue
        parts.append((1, int(token)) if token.isdigit() else (0, token.casefold()))
    return parts


def is_android(card: dict) -> bool:
    value = card.get('apple_or_android', True)
    if isinstance(value, str):
        return value.strip().lower() not in ('false', '0', 'ios', 'apple')
    return bool(value)


def normalize_card(raw: dict, jade: bool = False) -> dict:
    """把任意来源的卡片补成完整字段；jade=True 时带上一键协战的勾协字段"""
    card = {}
    for field in CARD_FIELDS:
        card[field] = raw.get(field, '')
    for field in ('character', 'svr', 'account', 'account_alias'):
        if card[field] is None:
            card[field] = ''
        card[field] = str(card[field])
    card['apple_or_android'] = is_android(card)
    if not card['last_complete_time']:
        card['last_complete_time'] = DEFAULT_TIME
    card['last_complete_time'] = str(card['last_complete_time'])
    if jade:
        # 与 AssistBattleAccountInfo 的默认值一致
        card['jade_status'] = str(raw.get('jade_status') or JADE_STATUS_DEFAULT)
        card['jade_complete_time'] = str(
            raw.get('jade_complete_time') or DEFAULT_TIME
        )
    return card


# 排序只在前端做（core.js，靠浏览器 ICU 的中文拼音排序）。
# 后端不重复实现，避免两套中文排序规则不一致。


# --------------------------------------------------------------------------- 读写
class Store:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.config_dir = self.root / 'config'
        self.backup_dir = Path(__file__).resolve().parent / 'backups'
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- 查询
    def config_names(self) -> list:
        if not self.config_dir.exists():
            return []
        names = [p.stem for p in self.config_dir.glob('*.json') if p.is_file()]
        return sorted(names, key=lambda name: (name == 'template', natural_key(name)))

    def config_path(self, name: str) -> Path:
        name = (name or '').strip()
        if not name or '/' in name or '\\' in name or '..' in name:
            raise ValueError('配置名不合法')
        path = self.config_dir / f'{name}.json'
        if not path.exists():
            raise FileNotFoundError(f'配置不存在: {path}')
        return path

    # ---------------------------------------------------------------- 读取容错
    # 配置文件可能正被别的进程写（OAS 自己虽然用 atomic_write，但脚本进程、
    # 用户手改、局域网上的其他机器都不保证）。非原子写是"先截断再写"，
    # 恰好读到中间态会得到半截 JSON —— 解析直接失败。
    # 实测：并发写时 40 次读取里有 11 次报 "Unterminated string" 之类。
    # 这里读失败就短暂重试几次，避免把"磁盘正在被写"误报成"配置坏了"。
    READ_RETRIES = 6
    READ_RETRY_DELAY = 0.05

    def _read_json(self, path: Path) -> dict:
        """读 JSON，遇到半写文件时短暂重试；仍失败才抛错

        两类失败要分开报：
          * 权限不足（PermissionError / EACCES）：重试没用，是共享端权限问题。
            典型场景：Linux/Samba 共享上的文件是 600，Samba 以别的身份访问。
          * 半写/网络抖动：重试有用。
        以前一律报"可能正被其他进程写入"，遇到权限问题时用户会一直点重试，
        永远好不了，也很难想到去看共享端的文件权限。
        """
        last_error = None
        for attempt in range(self.READ_RETRIES):
            try:
                return json.loads(path.read_text(encoding='utf-8'))
            except PermissionError as error:
                # 权限问题重试无意义，直接给可操作的提示
                raise ValueError(self._permission_hint(path, error)) from error
            except (ValueError, OSError) as error:
                # ValueError: JSON 半截 / UnicodeDecodeError 的父类
                # OSError: 文件正被独占或网络抖动
                last_error = error
                if attempt + 1 < self.READ_RETRIES:
                    time.sleep(self.READ_RETRY_DELAY)
        raise ValueError(
            f'配置文件暂时读不出来（可能正被其他进程写入）：{path.name}；'
            f'请稍后再点一次「重新加载」。原始错误：{last_error}'
        )

    @staticmethod
    def _permission_hint(path: Path, error: Exception) -> str:
        """权限不足时的提示：说清是什么问题、在哪台机器上改"""
        hint = (
            f'没有权限读取配置：{path.name}\n'
            f'路径：{path}\n'
            f'原始错误：{error}\n'
        )
        if _settings.is_network_path(str(path)):
            hint += (
                '\n这是网络共享（Samba/SMB）上的文件。常见原因：\n'
                '  · 共享端文件的权限位不允许 Samba 用户读取（例如 600）\n'
                '  · 文件属主和 Samba 运行用户不是同一个\n'
                '\n⚠ 注意：临时 chmod 644 会被反复覆盖。OAS 保存配置时走\n'
                '  tempfile.mkstemp()（固定创建 0600）+ rename 覆盖，\n'
                '  所以它每写一次，权限就被重置回 600。\n'
                '\n持久修法（在共享端那台机器上，二选一）：\n'
                '  A) 让 Samba 以 OAS 的属主身份访问（推荐）——\n'
                '     在 smb.conf 的该共享段里加：force user = <OAS运行用户>\n'
                '  B) 改 OAS 的写入方式，让临时文件创建后 chmod 0644\n'
                '\n先用这两条确认现状：\n'
                '  ps -eo user,pid,cmd | grep -i "script.py\\|gui.py" | grep -v grep\n'
                '  ls -l <config 目录>/*.json\n'
                '\n注意：改配置前请先停掉共享端正在运行的 OAS，'
                '否则它可能把你的修改回写覆盖。'
            )
        else:
            hint += (
                '\n本机文件权限不足。请检查该文件是否被其它程序独占，'
                '或右键属性 → 安全 里给当前用户读取权限。'
            )
        return hint

    def read_target(self, name: str, target: str) -> dict:
        if target not in TARGETS:
            raise ValueError(f'未知的列表: {target}')
        spec = TARGETS[target]
        path = self.config_path(name)
        # 先读内容再取 mtime：保证 mtime 与内容大致对应同一次快照
        data = self._read_json(path)
        mtime = path.stat().st_mtime
        section = data.get(target)
        # 老配置可能还没保存过这个任务节点：返回空列表并标记缺失，由前端提示
        missing = not isinstance(section, dict)
        if missing:
            section = {}

        pattern = re.compile(rf"{re.escape(spec['list_key'])}_(\d+)$")
        indexed = []
        for key, value in section.items():
            match = pattern.fullmatch(key)
            if not match or not isinstance(value, dict):
                continue
            indexed.append((int(match.group(1)), value))
        indexed.sort(key=lambda item: item[0])
        jade = bool(spec.get('jade'))
        cards = [normalize_card(value, jade=jade) for _, value in indexed]

        # 计数分组名可能因 OAS 改名而变，按实际存在的那个取
        count_group_name = resolve_count_group(section, spec)
        count_group = section.get(count_group_name) or {}
        count_value = count_group.get(spec['count_key'], len(cards))
        return {
            'config': name,
            'target': target,
            'label': spec['label'],
            'count_group': count_group_name,
            'count_key': spec['count_key'],
            'count_value': count_value,
            'list_key': spec['list_key'],
            'jade': jade,
            'cards': cards,
            'mtime': mtime,
            'missing': missing,
            # 任务特有的只读信息（目前只有切号任务有：轮换指针等）
            'extra': self._read_extra(section, count_group_name, spec),
        }

    @staticmethod
    def _read_extra(section: dict, group_name: str, spec: dict) -> dict:
        """把 spec.extra_keys 里点名的字段读出来给前端展示（只读）"""
        keys = spec.get('extra_keys') or []
        if not keys:
            return {}
        group = section.get(group_name)
        if not isinstance(group, dict):
            return {}
        return {key: group.get(key) for key in keys if key in group}

    # ---------------------------------------------------------------- 保存
    def write_target(self, name: str, target: str, cards: list, expect_mtime=None) -> dict:
        if target not in TARGETS:
            raise ValueError(f'未知的列表: {target}')
        spec = TARGETS[target]
        jade = bool(spec.get('jade'))
        cards = [normalize_card(card, jade=jade) for card in cards]

        with self._lock:
            path = self.config_path(name)
            current_mtime = path.stat().st_mtime
            if expect_mtime is not None and abs(current_mtime - float(expect_mtime)) > 1e-6:
                raise RuntimeError(
                    '配置文件在本次编辑期间被改动过（可能是脚本进程回写了配置），'
                    '已阻止保存；请重新加载后再改'
                )

            data = self._read_json(path)
            section = data.get(target)
            if not isinstance(section, dict):
                # 这个配置还没保存过该任务节点：按模板补一个最小可用结构
                section = {}
                data[target] = section
            # 计数字段所在分组缺失时也要补出来，否则 count 无法同步。
            # 用实际存在的那个分组名（OAS 改过名，不能写死）。
            count_group_name = resolve_count_group(section, spec)
            if not isinstance(section.get(count_group_name), dict):
                section[count_group_name] = {}

            # 清掉旧的 *_list_N，再按新顺序重排，避免留下空洞
            pattern = re.compile(rf"{re.escape(spec['list_key'])}_(\d+)$")
            for key in [k for k in section if pattern.fullmatch(k)]:
                del section[key]
            for index, card in enumerate(cards, 1):
                section[f"{spec['list_key']}_{index}"] = card

            count_group = section.get(count_group_name)
            if isinstance(count_group, dict):
                # account_count 的模型约束是 ge=1，空列表时保留 1
                count_group[spec['count_key']] = max(1, len(cards))
                # 轮换指针越界时归零（切号任务的 current_index 是下标）
                cursor_key = spec.get('cursor_key')
                if cursor_key and cursor_key in count_group:
                    cursor = count_group.get(cursor_key)
                    try:
                        cursor = int(cursor)
                    except (TypeError, ValueError):
                        cursor = 0
                    # 指针表示"下一个该切哪个号"，必须落在 0..len-1
                    if cursor < 0 or cursor >= max(1, len(cards)):
                        count_group[cursor_key] = 0

            backup = self._backup(path)
            self._atomic_write(path, data)

        return {
            'ok': True,
            'backup': str(backup),
            'config': name,
            'target': target,
            'cards': cards,
            'count_value': max(1, len(cards)),
            'mtime': path.stat().st_mtime,
            # 保存后可能修正过指针（越界归零），回传给前端刷新展示
            'extra': self._read_extra(section, count_group_name, spec),
        }

    # ---------------------------------------------------------------- 导出
    def export_target(self, name: str, target: str, cards: list | None = None) -> dict:
        """导出该任务的**完整、未脱敏** JSON（用于复制/备份/分享）。

        与 OAS 自带导出（`/script/config/task/export`）的区别：
        OAS 的 `CONFIG_REDACTION_PATHS` 会把 `assist_battle.account_list_*.account`
        等字段替换成 `XXX`，这里不做任何脱敏，原样导出。

        @param cards 若给出，则用这批卡片替换磁盘上的列表内容
                     （用于"导出当前编辑中但还没保存的状态"）
        """
        if target not in TARGETS:
            raise ValueError(f'未知的列表: {target}')
        spec = TARGETS[target]
        path = self.config_path(name)
        data = self._read_json(path)
        section = data.get(target)
        if not isinstance(section, dict):
            section = {}
            data[target] = section

        if cards is not None:
            normalized = [
                normalize_card(card, jade=bool(spec.get('jade')))
                for card in cards
            ]
            pattern = re.compile(rf"{re.escape(spec['list_key'])}_(\d+)$")
            for key in [k for k in section if pattern.fullmatch(k)]:
                del section[key]
            for index, card in enumerate(normalized, 1):
                section[f"{spec['list_key']}_{index}"] = card
            count_group_name = resolve_count_group(section, spec)
            if not isinstance(section.get(count_group_name), dict):
                section[count_group_name] = {}
            section[count_group_name][spec['count_key']] = max(1, len(normalized))

        content = json.dumps(
            {target: data[target]},
            indent=2,
            ensure_ascii=False,
            sort_keys=False,
            default=str,
        )
        return {
            'ok': True,
            'config': name,
            'target': target,
            'label': spec['label'],
            'filename': f'{name}-{target}.json',
            'content': content,
            'bytes': len(content.encode('utf-8')),
            'cards': len(
                [k for k in data[target] if re.fullmatch(rf"{re.escape(spec['list_key'])}_\d+", k)]
            ),
        }

    def export_config(self, name: str) -> dict:
        """导出整个配置文件的完整、未脱敏 JSON"""
        path = self.config_path(name)
        data = self._read_json(path)
        content = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False, default=str)
        return {
            'ok': True,
            'config': name,
            'filename': f'{name}.json',
            'content': content,
            'bytes': len(content.encode('utf-8')),
        }

    def _backup(self, path: Path) -> Path:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S')
        target = self.backup_dir / f'{path.stem}.{stamp}.json'
        index = 1
        while target.exists():
            target = self.backup_dir / f'{path.stem}.{stamp}-{index}.json'
            index += 1
        shutil.copy2(path, target)
        return target

    @staticmethod
    def _atomic_write(path: Path, data: dict) -> None:
        text = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False, default=str)
        try:
            fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix='.acct-', suffix='.tmp')
        except PermissionError as error:
            raise ValueError(Store._write_permission_hint(path, error)) from error
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
                handle.write(text)
            os.replace(tmp_name, path)
        except PermissionError as error:
            Path(tmp_name).unlink(missing_ok=True)
            raise ValueError(Store._write_permission_hint(path, error)) from error
        except BaseException:
            Path(tmp_name).unlink(missing_ok=True)
            raise

    @staticmethod
    def _write_permission_hint(path: Path, error: Exception) -> str:
        """写入权限不足时的提示（网络共享场景给出可操作步骤）"""
        hint = (
            f'没有权限写入配置：{path.name}\n'
            f'路径：{path}\n'
            f'原始错误：{error}\n'
        )
        if _settings.is_network_path(str(path)):
            hint += (
                '\n这是网络共享（Samba/SMB）上的文件，共享端不允许当前用户写入。\n'
                '\n⚠ 注意：临时 chmod 会被反复覆盖——OAS 保存配置时走\n'
                '  tempfile.mkstemp()（固定 0600）+ rename 覆盖，\n'
                '  每写一次权限就重置回 600。\n'
                '\n持久修法（在共享端那台机器上，二选一）：\n'
                '  A) 在 smb.conf 的该共享段里加：force user = <OAS运行用户>\n'
                '  B) 改 OAS 的写入方式，让临时文件创建后 chmod 0644\n'
                '\n另外：如果共享端 OAS 正在运行，它可能在你写入后立刻回写覆盖，'
                '请先停掉再改。'
            )
        else:
            hint += '\n请检查文件是否只读，或当前用户对该目录是否有写权限。'
        return hint


# --------------------------------------------------------------------------- HTTP
class _AccountServer(ThreadingHTTPServer):
    """带更大连接排队的 HTTP 服务。

    socketserver 默认 request_queue_size = 5，而这里是 HTTP/1.0：
    **每个请求都新建一条 TCP 连接**（没有 keep-alive 复用）。
    页面连点「重新加载」、或后台心跳/窗口上报同时发出时，
    超过 5 个待处理连接会被内核直接丢弃（RST），浏览器侧表现为
    "fetch failed"——也就是用户看到的"点了没反应，得连点几下"。
    实测并发 8 时约 1/9 请求失败，并发 24 时约 40% 失败。
    这里把排队上限抬高，让突发请求都能排队处理。
    """

    request_queue_size = 128
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = 'OASAccountManager/1.0'
    store: Store = None
    # 供 /api/shutdown 使用：server 实例和"是否允许远程关闭"
    httpd = None
    allow_shutdown = True

    def log_message(self, fmt, *args):  # noqa: A003 - 覆盖基类
        sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    # -------------------------------------------------------------- 响应
    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str = 'text/html; charset=utf-8') -> None:
        self._send_asset(path, content_type)

    def _send_asset(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    @staticmethod
    def _known_routes() -> set:
        """本进程实际认得的 API 路径。

        用来自证"我是哪个版本的代码"：旧进程缺新路由时，
        前端能据此提示重启，而不是让用户对着 "not found" 猜。
        """
        return {
            '/api/configs',
            '/api/list',
            '/api/ping',
            '/api/save',
            '/api/export',
            '/api/shutdown',
            '/api/roots',
            '/api/window',
        }

    # -------------------------------------------------------------- 根目录预设
    def _roots_payload(self) -> dict:
        """当前使用的根目录 + 全部预设（含可达性）"""
        data = _settings.load_settings()
        current = str(self.store.root) if self.store else ''
        roots = []
        for item in data['roots']:
            roots.append({
                'name': item['name'],
                'path': item['path'],
                'reachable': _settings.root_reachable(item['path']),
                'network': _settings.is_network_path(item['path']),
                'current': os.path.normcase(item['path']) == os.path.normcase(current),
            })
        return {
            'ok': True,
            'current': current,
            'current_network': _settings.is_network_path(current),
            'default': data.get('default', ''),
            'roots': roots,
        }

    # -------------------------------------------------------------- 根目录预设
    def _handle_roots(self, body: dict) -> None:
        """切换/新增/删除根目录预设。

        action:
          use    切换当前使用的根目录（会重建 Store，立即生效）
          add    新增一个预设（不切换）
          remove 删除一个预设（不能删当前正在用的）
        """
        action = str(body.get('action') or '').strip()
        data = _settings.load_settings()

        if action == 'use':
            target = str(body.get('path') or '').strip()
            if not target:
                self._send_json({'ok': False, 'error': '缺少 path'}, status=400)
                return
            root = _as_root_path(target)
            if root is None:
                self._send_json(
                    {'ok': False, 'error': '该路径下找不到 config 目录：%s' % target},
                    status=400,
                )
                return
            Handler.store = Store(root)
            # 记住这次选择，下次启动直接用
            name = str(body.get('name') or '').strip()
            matched = None
            for item in data['roots']:
                if os.path.normcase(item['path']) == os.path.normcase(str(root)):
                    matched = item['name']
                    break
            if matched is None:
                matched = name or Path(root).name or str(root)
                data['roots'].append({'name': matched, 'path': str(root)})
            data['default'] = matched
            _settings.save_settings(data)
            self._send_json(self._roots_payload())
            return

        if action == 'add':
            target = str(body.get('path') or '').strip()
            if not target:
                self._send_json({'ok': False, 'error': '缺少 path'}, status=400)
                return
            root = _as_root_path(target)
            if root is None:
                self._send_json(
                    {'ok': False, 'error': '该路径下找不到 config 目录：%s' % target},
                    status=400,
                )
                return
            name = str(body.get('name') or '').strip() or Path(root).name or str(root)
            for item in data['roots']:
                if os.path.normcase(item['path']) == os.path.normcase(str(root)):
                    item['name'] = name
                    break
            else:
                data['roots'].append({'name': name, 'path': str(root)})
            _settings.save_settings(data)
            self._send_json(self._roots_payload())
            return

        if action == 'remove':
            name = str(body.get('name') or '').strip()
            remaining = [r for r in data['roots'] if r['name'] != name]
            if len(remaining) == len(data['roots']):
                self._send_json({'ok': False, 'error': '没有这个预设：%s' % name}, status=404)
                return
            if not remaining:
                self._send_json({'ok': False, 'error': '至少要保留一个'}, status=400)
                return
            data['roots'] = remaining
            if data.get('default') == name:
                data['default'] = remaining[0]['name']
            _settings.save_settings(data)
            self._send_json(self._roots_payload())
            return

        self._send_json({'ok': False, 'error': '未知 action：%s' % action}, status=400)

    def _reject_unknown(self) -> None:
        """404 时给出可操作的提示，而不是干巴巴的 not found"""
        self._send_json(
            {
                'ok': False,
                'error': '未知接口：本服务可能是旧代码，请关闭工具后重新启动'
                         '（关闭账号管理.bat 或页面右下角「退出工具」）',
                'hint': 'restart-required',
                'contract': CONTRACT_VERSION,
            },
            status=404,
        )

    # -------------------------------------------------------------- 路由
    def do_GET(self):  # noqa: N802 - 基类命名
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path in ('/', '/index.html'):
                self._send_file(Path(__file__).resolve().parent / 'ui.html')
                return
            static_assets = {
                '/core.js': ('core.js', 'application/javascript; charset=utf-8'),
                '/app.js': ('app.js', 'application/javascript; charset=utf-8'),
                '/ui.css': ('ui.css', 'text/css; charset=utf-8'),
            }
            if parsed.path in static_assets:
                filename, content_type = static_assets[parsed.path]
                self._send_asset(Path(__file__).resolve().parent / filename, content_type)
                return
            if parsed.path == '/api/configs':
                self._send_json(
                    {
                        'configs': self.store.config_names(),
                        'targets': [
                            {'key': key, 'label': spec['label']} for key, spec in TARGETS.items()
                        ],
                    }
                )
                return
            if parsed.path == '/api/list':
                name = (query.get('config') or [''])[0]
                target = (query.get('target') or ['assist_battle'])[0]
                self._send_json(self.store.read_target(name, target))
                return
            if parsed.path == '/api/ping':
                # 页面活着就刷新心跳，空闲看门狗据此判断"窗口已关"
                _touch_heartbeat()
                self._send_json(
                    {
                        'ok': True,
                        'app': 'account-manager',
                        'pid': os.getpid(),
                        'version': self.server_version,
                        'contract': CONTRACT_VERSION,
                        'routes': sorted(self._known_routes()),
                    }
                )
                return
            if parsed.path == '/api/export':
                # GET 版导出：读磁盘当前内容（未脱敏）
                name = (query.get('config') or [''])[0]
                target = (query.get('target') or [''])[0]
                if not target:
                    self._send_json(self.store.export_config(name))
                else:
                    self._send_json(self.store.export_target(name, target))
                return
            if parsed.path == '/api/roots':
                self._send_json(self._roots_payload())
                return
            if parsed.path == '/api/window':
                self._send_json({'ok': True, 'geometry': _load_window_geometry()})
                return
            self._reject_unknown()
        except FileNotFoundError as error:
            self._send_json({'ok': False, 'error': str(error)}, status=404)
        except ValueError as error:
            self._send_json({'ok': False, 'error': str(error)}, status=400)
        except Exception as error:  # noqa: BLE001 - 兜底返回给前端
            self._send_json({'ok': False, 'error': repr(error)}, status=500)

    def do_POST(self):  # noqa: N802 - 基类命名
        parsed = urlparse(self.path)
        try:
            body = self._read_body()
            if parsed.path == '/api/save':
                result = self.store.write_target(
                    body.get('config', ''),
                    body.get('target', ''),
                    body.get('cards') or [],
                    body.get('mtime'),
                )
                self._send_json(result)
                return
            if parsed.path == '/api/export':
                # POST 版导出：可带上编辑中的卡片，导出"未保存的当前状态"
                name = body.get('config', '')
                target = body.get('target', '')
                cards = body.get('cards')
                if not target:
                    self._send_json(self.store.export_config(name))
                else:
                    self._send_json(self.store.export_target(name, target, cards))
                return
            if parsed.path == '/api/shutdown':
                self._handle_shutdown()
                return
            if parsed.path == '/api/window':
                self._send_json({
                    'ok': True,
                    'geometry': _save_window_geometry(body or {}),
                })
                return
            if parsed.path == '/api/roots':
                self._handle_roots(body)
                return
            self._reject_unknown()
        except RuntimeError as error:
            self._send_json({'ok': False, 'error': str(error), 'conflict': True}, status=409)
        except FileNotFoundError as error:
            self._send_json({'ok': False, 'error': str(error)}, status=404)
        except ValueError as error:
            self._send_json({'ok': False, 'error': str(error)}, status=400)
        except Exception as error:  # noqa: BLE001 - 兜底返回给前端
            self._send_json({'ok': False, 'error': repr(error)}, status=500)

    # -------------------------------------------------------------- 关闭
    def _handle_shutdown(self) -> None:
        """页面上的「退出工具」：先把响应发回去，再真正停服务。

        pythonw 启动时没有窗口可关，这是唯一的正常退出方式。
        只允许本机请求（默认绑定 127.0.0.1，额外用对端地址兜底）。
        """
        client = self.client_address[0] if self.client_address else ''
        if not self.allow_shutdown or client not in ('127.0.0.1', '::1', 'localhost'):
            self._send_json({'ok': False, 'error': '拒绝来自非本机的关闭请求'}, status=403)
            return

        self._send_json({'ok': True, 'message': '工具正在退出'})
        # 在独立线程里停服务：不能在处理请求的线程里直接 shutdown，会死锁
        threading.Thread(target=self._stop_server, daemon=True).start()

    @staticmethod
    def _stop_server() -> None:
        time.sleep(0.15)  # 留一点时间让浏览器收到响应
        try:
            server = Handler.httpd
            if server is not None:
                server.shutdown()
        except Exception:  # noqa: BLE001 - 退出阶段不再抛错
            pass


# --------------------------------------------------------------------------- 自检
SAMPLE = {
    'config_name': 'selftest',
    'assist_battle': {
        # 与真实配置一致：account_count 在 assist_battle_config 里
        # （OAS 2026-11 把拆组时改的 battle_config 又改回来了）
        'assist_battle_config': {'account_count': 3},
        'daily_config': {'find_jade_enable': True},
        'optimize_config': {'skip_completed_account_enable': True},
        'push_config': {'result_push_enable': False},
        'account_list_1': {
            'character': '红叶2',
            'svr': 'A服',
            'account': 'b@x.com',
            'account_alias': '',
            'apple_or_android': True,
            'last_complete_time': '2024-01-01 00:00:00',
            'jade_status': '普勾',
            'jade_complete_time': '2024-01-01 09:00:00',
        },
        'account_list_2': {
            'character': '茨木',
            'svr': 'B服',
            'account': 'a@x.com',
            'account_alias': 'alias',
            'apple_or_android': False,
            'last_complete_time': '2024-02-02 00:00:00',
        },
        'account_list_3': {
            'character': '红叶10',
            'svr': 'A服',
            'account': 'a@x.com',
            'account_alias': '',
            'apple_or_android': True,
            'last_complete_time': '2024-03-03 00:00:00',
        },
    },
    'account_switch': {
        'account_switch_config': {'switch_account_count': 1},
        'account_list_1': {
            'character': 'A',
            'svr': 'S',
            'account': 'a',
            'account_alias': '',
            'apple_or_android': True,
            'last_complete_time': '2024-01-01 00:00:00',
        },
    },
}


def run_selftest() -> int:
    failures = []

    def check(name, condition, detail=''):
        print(('  ok   ' if condition else '  FAIL ') + name
              + ('' if condition or not detail else ' -> ' + str(detail)))
        if not condition:
            failures.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / 'config').mkdir()
        sample_path = root / 'config' / 'selftest.json'
        sample_path.write_text(json.dumps(SAMPLE, ensure_ascii=False, indent=2), encoding='utf-8')
        store = Store(root)
        store.backup_dir = root / 'backups'

        print('顺序与读写:')
        state = store.read_target('selftest', 'assist_battle')
        check('读出 3 张卡', len(state['cards']) == 3)
        check('顺序按 key 编号', [c['character'] for c in state['cards']] == ['红叶2', '茨木', '红叶10'])
        check('计数键正确', state['count_key'] == 'account_count' and state['count_value'] == 3)

        print('中间插队 + 删除:')
        # 排序由前端 core.js 负责，这里只验证“给定顺序能原样落盘”
        cards = [c for c in state['cards']]
        cards.insert(1, normalize_card({'character': '新号', 'account': 'c@x.com'}))
        check('插入后 4 张', len(cards) == 4)
        cards.pop(0)
        saved = store.write_target('selftest', 'assist_battle', cards, state['mtime'])
        check('保存返回 ok', saved['ok'] is True)
        written = json.loads(sample_path.read_text(encoding='utf-8'))
        keys = [k for k in written['assist_battle'] if k.startswith('account_list_')]
        check('key 无空洞且数量正确', keys == ['account_list_1', 'account_list_2', 'account_list_3'])
        check('计数同步为 3', written['assist_battle']['assist_battle_config']['account_count'] == 3)
        check(
            '没有多建一个 battle_config 空节点',
            'battle_config' not in written['assist_battle'],
        )
        check(
            '给定顺序被原样写入',
            [written['assist_battle'][k]['character'] for k in keys] == ['新号', '茨木', '红叶10'],
        )
        check('未污染其它任务', written['account_switch']['account_list_1']['character'] == 'A')
        check('备份已生成', Path(saved['backup']).exists())
        times = {
            written['assist_battle'][k]['character']: written['assist_battle'][k]['last_complete_time']
            for k in keys
        }
        check('last_complete_time 跟着卡走', times.get('茨木') == '2024-02-02 00:00:00')

        print('勾协字段（仅一键协战）:')
        # 用最初读出的 3 张卡（红叶2 带勾协字段），重写后的列表里它已被删
        hong = next(c for c in state['cards'] if c['character'] == '红叶2')
        check('读出 jade_status', hong['jade_status'] == '普勾', hong['jade_status'])
        check('读出 jade_complete_time',
              hong['jade_complete_time'] == '2024-01-01 09:00:00')
        zimu = next(c for c in state['cards'] if c['character'] == '茨木')
        check('缺省补默认值', zimu['jade_status'] == 'none')
        other = store.read_target('selftest', 'account_switch')
        check('切号列表不带勾协字段',
              'jade_status' not in other['cards'][0])
        saved = store.write_target('selftest', 'assist_battle', state['cards'])
        written = json.loads(sample_path.read_text(encoding='utf-8'))
        check('勾协字段落盘不丢失',
              written['assist_battle']['account_list_1']['jade_status'] == '普勾')

        print('并发保护:')
        try:
            store.write_target('selftest', 'assist_battle', cards, state['mtime'])
            check('旧 mtime 应被拒绝', False)
        except RuntimeError:
            check('旧 mtime 被拒绝', True)

        print('截断到 1 张（等价于批量删除）:')
        store.write_target('selftest', 'assist_battle', cards[:1])
        written = json.loads(sample_path.read_text(encoding='utf-8'))
        keys = [k for k in written['assist_battle'] if k.startswith('account_list_')]
        check('只剩 1 个 key', keys == ['account_list_1'])
        check('计数同步为 1', written['assist_battle']['assist_battle_config']['account_count'] == 1)

        print('空列表:')
        store.write_target('selftest', 'assist_battle', [])
        written = json.loads(sample_path.read_text(encoding='utf-8'))
        check('空列表不写 key', not [k for k in written['assist_battle'] if k.startswith('account_list_')])
        check('计数兜底为 1（模型 ge=1）', written['assist_battle']['assist_battle_config']['account_count'] == 1)

        print('切号列表也支持:')
        store.write_target('selftest', 'account_switch', [normalize_card({'character': 'X'})])
        written = json.loads(sample_path.read_text(encoding='utf-8'))
        check('切号计数键同步', written['account_switch']['account_switch_config']['switch_account_count'] == 1)

        print('配置里还没有该任务节点时:')
        thin_path = root / 'config' / 'thin.json'
        thin_path.write_text(json.dumps({'config_name': 'thin'}, ensure_ascii=False), encoding='utf-8')
        thin_state = store.read_target('thin', 'account_switch')
        check('读取返回空列表而不是报错', thin_state['cards'] == [] and thin_state['missing'] is True)
        store.write_target('thin', 'account_switch', [normalize_card({'character': 'Y'})])
        thin_written = json.loads(thin_path.read_text(encoding='utf-8'))
        check(
            '保存时自动补出最小结构',
            thin_written['account_switch']['account_list_1']['character'] == 'Y'
            and thin_written['account_switch']['account_switch_config']['switch_account_count'] == 1,
        )

        print('计数分组改名兼容（只有旧名 battle_config 的配置）:')
        legacy_path = root / 'config' / 'legacy.json'
        legacy_path.write_text(json.dumps({
            'config_name': 'legacy',
            'assist_battle': {
                'battle_config': {'account_count': 2},
                'account_list_1': {'character': '旧一', 'account': 'x'},
                'account_list_2': {'character': '旧二', 'account': 'y'},
            },
        }, ensure_ascii=False), encoding='utf-8')
        legacy_state = store.read_target('legacy', 'assist_battle')
        check('读取时认得旧分组名 battle_config',
            legacy_state['count_group'] == 'battle_config'
            and legacy_state['count_value'] == 2,
            'count_group=%s count_value=%s' % (
                legacy_state['count_group'], legacy_state['count_value']))
        store.write_target('legacy', 'assist_battle', [
            normalize_card({'character': '改后一', 'account': 'x'}),
            normalize_card({'character': '改后二', 'account': 'y'}),
            normalize_card({'character': '改后三', 'account': 'z'}),
        ])
        legacy_written = json.loads(legacy_path.read_text(encoding='utf-8'))
        legacy_node = legacy_written['assist_battle']
        check('保存写回已存在的旧分组（不新建 assist_battle_config）',
            'assist_battle_config' not in legacy_node,
            sorted(legacy_node))
        check('旧分组里的计数同步为 3',
            legacy_node['battle_config']['account_count'] == 3,
            legacy_node.get('battle_config'))

        print('路径穿越防护:')
        try:
            store.read_target('../selftest', 'assist_battle')
            check('应拒绝非法配置名', False)
        except (ValueError, FileNotFoundError):
            check('拒绝非法配置名', True)

    # 计数键必须与 OAS 真实模型对得上：曾经配置拆成 battle/daily/optimize
    # 三组后，TARGETS 还指着旧的 assist_battle_config，导致"加/删账号但数量不变"，
    # 而自检因为用同一份过期 SAMPLE 也照样通过。这里直接拿真实模板核对。
    # 计数键必须与 OAS 真实配置对得上：曾经配置拆成 battle/daily/optimize
    # 三组后，TARGETS 还指着旧的 assist_battle_config，导致"加/删账号但数量不变"，
    # 而自检因为用同一份过期 SAMPLE 也照样通过。这里拿**真实配置文件**核对
    # （template.json 里没有 assist_battle / account_switch，它们是用户自定义任务）。
    print('计数键与真实配置文件一致性:')
    repo = detect_repo_root()
    config_dir = (repo / 'config') if repo else None
    if config_dir and config_dir.is_dir():
        checked = set()
        for path in sorted(config_dir.glob('*.json')):
            if path.name == 'template.json':
                continue
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            for key, spec in TARGETS.items():
                if key in checked:
                    continue
                node = data.get(key)
                if not isinstance(node, dict):
                    continue
                # 分组名可能改过（assist_battle_config ↔ battle_config），
                # 用和读写同一套解析逻辑，避免自检和实际行为不一致
                group_name = resolve_count_group(node, spec)
                group = node.get(group_name)
                ok = isinstance(group, dict) and spec['count_key'] in group
                if ok:
                    checked.add(key)
                check(
                    '%s 计数键 %s.%s 在 %s 里存在' % (
                        key, group_name, spec['count_key'], path.name,
                    ),
                    ok,
                    '实际顶层键：%s' % sorted(
                        k for k in node
                        if not k.startswith(('account_list_', 'sup_account_list_'))
                    ),
                )
        for key in TARGETS:
            if key not in checked:
                print('  skip  %s 在所有配置里都没找到有效节点' % key)
    else:
        print('  skip  没找到 OAS 的 config/ 目录')
        print('        （独立部署时正常：设置 OAS_ROOT 或用 --root 指定后，')
        print('          这条检查会拿真实配置核对计数键，建议在 OAS 机器上跑一次）')

    print()
    if failures:
        print('失败 %d 项: %s' % (len(failures), ', '.join(failures)))
        return 1
    print('全部通过')
    return 0


# --------------------------------------------------------------------------- 入口
def _probe(url: str, timeout: float = 1.5) -> dict:
    """探测某个地址上跑的是不是本工具，是则返回 /api/ping 信息"""
    import urllib.request

    try:
        with urllib.request.urlopen(url + 'api/ping', timeout=timeout) as response:
            payload = json.loads(response.read(4096).decode('utf-8'))
        if isinstance(payload, dict) and payload.get('app') == 'account-manager':
            return payload
    except Exception:
        pass
    return {}


def _port_open(host: str, port: int, timeout: float = 0.15) -> bool:
    """快速判断端口是否有人监听。

    比直接发 HTTP 快得多：连接被拒绝时立刻返回，
    不会像 urlopen 那样等满 timeout。
    """
    import socket

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _is_running(url: str) -> bool:
    """判断端口上跑的是不是本工具（一键启动重复点击时直接复用）"""
    return bool(_probe(url))


def _find_running(host: str, port: int, span: int = 20) -> dict:
    """在 port..port+span 范围里找已经在运行的本工具。

    用短超时的 connect 逐个筛：Windows 上非阻塞 connect_ex 对未监听端口
    反而会等满系统超时（实测 20 个端口要 40 秒），带超时的 connect 更快。
    正常情况（工具在默认端口）第一次就命中，只在端口被顺延时才多扫几次。
    """
    for candidate in range(port, port + span):
        if not _port_open(host, candidate):
            continue
        info = _probe('http://%s:%d/' % (host, candidate), timeout=2)
        if info:
            info['port'] = candidate
            return info
    return {}


def _bind(host: str, port: int, attempts: int = 20):
    """端口被占用时自动向后找可用端口"""
    last_error = None
    for offset in range(attempts):
        candidate = port + offset
        try:
            return _AccountServer((host, candidate), Handler), candidate
        except OSError as error:
            last_error = error
            if offset == 0:
                print('端口 %d 已被占用，尝试 %d…' % (port, port + 1))
    raise last_error


# --------------------------------------------------------------------------- 运行状态文件
# 关工具需要知道"现在跑在哪个端口、PID 多少"，尤其是 pythonw 无窗口启动时。
# 启动时写一份 .runtime.json，退出时删掉；关闭脚本和 --stop 都读它。
RUNTIME_FILE = Path(__file__).resolve().parent / '.runtime.json'


def _write_runtime_info(port: int, url: str, host: str = '127.0.0.1') -> None:
    try:
        RUNTIME_FILE.write_text(
            json.dumps(
                {
                    'pid': os.getpid(),
                    'port': port,
                    'host': host,
                    'url': url,
                    'started_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding='utf-8',
        )
    except OSError:
        pass


def _clear_runtime_info() -> None:
    try:
        RUNTIME_FILE.unlink(missing_ok=True)
    except OSError:
        pass


# --------------------------------------------------------------------------- 空闲看门狗
# 独立窗口模式下，用户直接点窗口的 X 关掉页面，后端 pythonw 会留在后台。
# 页面每 10 秒 ping 一次；超过 IDLE_EXIT_SECONDS 没有任何心跳就认为
# "窗口已经关了"，自动退出进程（等价于点「退出工具」）。
# 有任何未保存修改时前端会持续 ping，不会误退。
#
# ⚠ 2026-10-28 用户明确要求关闭此行为：
#   "自动结束后台没有必要，因为不会重复开启后台，一个后台一直跑着我自己手动关闭挺好"
#   现在改成显式开关 --idle-exit <秒>，默认 0 = 不自动退出，由用户手动关。
IDLE_EXIT_SECONDS = 0
_last_heartbeat = time.time()
_heartbeat_lock = threading.Lock()


def _touch_heartbeat() -> None:
    global _last_heartbeat
    with _heartbeat_lock:
        _last_heartbeat = time.time()


def _heartbeat_idle_seconds() -> float:
    with _heartbeat_lock:
        return time.time() - _last_heartbeat


def _start_idle_watchdog(timeout: int) -> None:
    """后台线程：页面心跳停了就退出整个进程（timeout <= 0 时不启动）"""
    if timeout <= 0:
        return

    def _loop() -> None:
        while True:
            time.sleep(5)
            idle = _heartbeat_idle_seconds()
            if idle < timeout:
                continue
            try:
                server = Handler.httpd
                if server is not None:
                    server.shutdown()
            except Exception:  # noqa: BLE001 - 退出阶段不再抛错
                pass
            return

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()


def _read_runtime_info() -> dict:
    try:
        return json.loads(RUNTIME_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


# --------------------------------------------------------------------------- 窗口几何
# 独立窗口（--app）的位置和尺寸由浏览器决定，页面拿不到，只能"页面量自己 +
# 上报后端 + 下次启动时用 --window-position/--window-size 传回去"。
# 存在独立的 window.json，跟 settings.json 同级。
WINDOW_FILE = Path(__file__).resolve().parent / 'window.json'
# 太小的尺寸不采信（最小化/异常时 innerWidth 会变成很小的值）
_MIN_WIDTH = 640
_MIN_HEIGHT = 480


def _load_window_geometry() -> dict:
    """读上次保存的窗口几何；无效或损坏时返回空 dict"""
    try:
        data = json.loads(WINDOW_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    result = {}
    for key in ('width', 'height', 'left', 'top'):
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[key] = int(value)
    # 宽高必须合理，否则忽略整份记录（避免窗口缩成一条线）
    if result.get('width', 0) < _MIN_WIDTH or result.get('height', 0) < _MIN_HEIGHT:
        return {}
    return result


def _save_window_geometry(payload: dict) -> dict:
    """保存窗口几何。只接受合理值，非法输入直接拒绝（不写盘）"""
    cleaned = {}
    for key in ('width', 'height', 'left', 'top'):
        value = payload.get(key)
        if value is None:
            continue
        try:
            number = int(round(float(value)))
        except (TypeError, ValueError):
            raise ValueError('窗口参数不是数字: %s=%r' % (key, value))
        cleaned[key] = number

    if cleaned.get('width', 0) < _MIN_WIDTH or cleaned.get('height', 0) < _MIN_HEIGHT:
        raise ValueError(
            '窗口尺寸太小（至少 %dx%d）: %sx%s' % (
                _MIN_WIDTH, _MIN_HEIGHT,
                cleaned.get('width'), cleaned.get('height'),
            )
        )
    # 位置允许为负（多显示器时副屏在主屏左侧/上方）
    for key in ('left', 'top'):
        if key in cleaned and abs(cleaned[key]) > 32000:
            raise ValueError('窗口位置超出合理范围: %s=%s' % (key, cleaned[key]))

    cleaned['saved_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    try:
        tmp = WINDOW_FILE.with_suffix('.json.tmp')
        tmp.write_text(
            json.dumps(cleaned, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        os.replace(tmp, WINDOW_FILE)
    except OSError as error:
        raise RuntimeError('保存窗口几何失败: %s' % error)
    return cleaned


# --------------------------------------------------------------------------- 打开页面
# 默认用系统浏览器；--app 时找 Chrome/Edge 用 --app= 起独立窗口（无地址栏、无标签栏，
# 看起来就是一个桌面应用）。找不到 Chromium 系浏览器就退回普通浏览器，不会报错。
_CHROMIUM_CANDIDATES = (
    r'Google\Chrome\Application\chrome.exe',
    r'Microsoft\Edge\Application\msedge.exe',
)


def _find_chromium() -> str:
    """找一个能跑 --app= 的 Chromium 系浏览器，找不到返回空串"""
    roots = [
        os.environ.get('PROGRAMFILES', ''),
        os.environ.get('PROGRAMFILES(X86)', ''),
        os.environ.get('LOCALAPPDATA', ''),
    ]
    for root in roots:
        if not root:
            continue
        for rel in _CHROMIUM_CANDIDATES:
            path = os.path.join(root, rel)
            if os.path.isfile(path):
                return path
    return ''


def _open_page(url: str, as_app: bool = False, size: str = '1280,860') -> None:
    """打开页面。as_app=True 优先用 Chromium 应用窗口，失败退回系统浏览器。

    独立窗口模式下优先用上次记住的位置尺寸（window.json），
    没有记录时才用 size 参数。
    """
    if as_app:
        browser = _find_chromium()
        if browser:
            # --user-data-dir 用独立配置目录，避免和用户日常浏览器抢同一个实例
            # （共用实例时 --app 会被已有窗口吞掉，只多开一个标签页）
            profile = Path(__file__).resolve().parent / '.app-window'
            geometry = _load_window_geometry()
            if geometry.get('width') and geometry.get('height'):
                size = '%d,%d' % (geometry['width'], geometry['height'])
            cmd = [
                browser,
                '--app=%s' % url,
                '--window-size=%s' % size,
                '--user-data-dir=%s' % str(profile),
                # 无痕式的独立配置：首次启动不弹"登录/同步"引导
                '--no-first-run',
                '--no-default-browser-check',
            ]
            if geometry.get('left') is not None and geometry.get('top') is not None:
                cmd.append('--window-position=%d,%d' % (geometry['left'], geometry['top']))
            try:
                # pythonw 下没有标准句柄，必须显式断开，否则子进程可能起不来
                subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    close_fds=True,
                )
                return
            except OSError:
                pass
    webbrowser.open(url)


def stop_running() -> int:
    """停止正在运行的工具：优先走 HTTP /api/shutdown，失败再按 PID 补刀"""
    info = _read_runtime_info()
    host = info.get('host', '127.0.0.1')
    port = info.get('port')
    url = 'http://%s:%s/' % (host, port) if port else ''

    # 1) 正常路径：请求服务自己退出（会走 finally 清理临时文件）
    if url and _probe(url, timeout=2):
        try:
            import urllib.request

            request = urllib.request.Request(
                url + 'api/shutdown',
                data=b'{}',
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                response.read(4096)
            # 等服务真正退出
            for _ in range(30):
                time.sleep(0.1)
                if not _probe(url, timeout=0.3):
                    _clear_runtime_info()
                    print('工具已退出（端口 %s 已释放）' % port)
                    return 0
        except Exception:
            pass

    # 2) 兜底：按 PID 结束进程
    pid = info.get('pid')
    if pid:
        try:
            import signal

            if os.name == 'nt':
                # Windows 用 taskkill 比 os.kill(SIGTERM) 干净
                import subprocess

                subprocess.run(
                    ['taskkill', '/PID', str(pid), '/F'],
                    capture_output=True,
                    check=False,
                )
            else:
                os.kill(int(pid), signal.SIGTERM)
            time.sleep(0.5)
            _clear_runtime_info()
            print('已结束进程 PID %s' % pid)
            return 0
        except Exception as error:  # noqa: BLE001
            print('结束进程失败: %s' % error)

    # 3) 再兜底：按端口扫描（万一 .runtime.json 丢了）
    for candidate in range(DEFAULT_PORT, DEFAULT_PORT + 20):
        if not _port_open('127.0.0.1', candidate):
            continue
        probe = _probe('http://127.0.0.1:%d/' % candidate, timeout=2)
        if probe and probe.get('pid'):
            try:
                import subprocess

                subprocess.run(
                    ['taskkill', '/PID', str(probe['pid']), '/F'],
                    capture_output=True,
                    check=False,
                )
                _clear_runtime_info()
                print('已结束端口 %d 上的进程 PID %s' % (candidate, probe['pid']))
                return 0
            except Exception:
                continue

    print('没有找到正在运行的工具（可能已经退出）')
    _clear_runtime_info()
    return 0


def _as_root_path(text: str | None) -> Path | None:
    """把用户给的路径规范化成"含 config/ 的 OAS 根目录"。

    接受：OAS 根目录本身、或直接指向 config 目录。
    网络路径（\\\\server\\share）也能处理，但**不可达时会立刻返回 None**，
    不会让 is_dir() 挂满 SMB 超时（那会让双击启动看起来毫无反应）。
    """
    if not text:
        return None
    raw = str(text).strip().strip('"').strip("'")
    if not raw:
        return None
    # 网络路径先探端口：主机不在线就没必要往下走
    if _settings.is_network_path(raw) and not _settings.network_host_alive(raw):
        print('网络路径不可达（已跳过）: %s' % raw)
        return None

    def resolve_root() -> Path | None:
        given = Path(raw).expanduser()
        try:
            given = given.resolve()
        except OSError:
            given = Path(raw)
        if given.name == 'config' and given.is_dir():
            return given.parent
        if (given / 'config').is_dir():
            return given
        return None

    # 网络路径的 resolve()/is_dir() 都可能挂满 SMB 超时，套硬超时
    if _settings.is_network_path(raw):
        return _settings._call_with_timeout(resolve_root, 5.0, default=None)
    try:
        return resolve_root()
    except OSError:
        return None


def detect_repo_root(explicit: str | None = None) -> Path | None:
    """找到 OAS 仓库根（含 config/ 的那一层）。

    优先级：
      1. --root 显式指定
      2. 环境变量 OAS_ROOT（独立部署时最方便的固定配置）
      3. settings.json 里记录的默认预设（见 settings.py）
      4. 从本文件所在目录**逐级向上**找含 config/ 的目录
      5. 从当前工作目录向上找（从仓库根执行时也能找到）

    不用固定的层数（例如"往上第 3 层"）：那样一旦把工具挪到别的层级
    （尤其是独立成库之后）就会推断错，而且报错信息里的路径跟用户的
    实际目录对不上，很难自查。
    """
    def search_up(start: Path) -> Path | None:
        for candidate in [start] + list(start.parents):
            if (candidate / 'config').is_dir():
                return candidate
        return None

    if explicit:
        return _as_root_path(explicit)

    # 环境变量：独立部署时用户设一次就一直生效
    env_root = str(os.environ.get('OAS_ROOT') or '').strip()
    if env_root:
        found = _as_root_path(env_root)
        if found is not None:
            return found

    # 预设路径（支持网络路径）。
    # 默认预设不可达时（典型情况：局域网那台机器关机了）不能直接放弃，
    # 继续尝试其它预设 —— 否则本地那份明明能用，双击却报"找不到 config"。
    preset = _as_root_path(_settings.default_root())
    if preset is not None:
        return preset

    for item in _settings.load_settings().get('roots', []):
        path = str(item.get('path') or '').strip()
        if not path:
            continue
        found = _as_root_path(path)
        if found is not None:
            print('默认预设不可用，改用预设「%s」: %s' % (item.get('name', ''), found))
            return found

    here = Path(__file__).resolve().parent
    found = search_up(here)
    if found:
        return found
    return search_up(Path.cwd().resolve())


def main() -> int:
    parser = argparse.ArgumentParser(description='OAS 账号列表管理工具')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='监听端口，默认 22299')
    parser.add_argument('--host', default='127.0.0.1', help='监听地址，默认仅本机')
    parser.add_argument('--root', default=None, help='OAS 仓库根目录，默认按脚本位置推断')
    parser.add_argument('--selftest', action='store_true', help='运行离线自检后退出')
    parser.add_argument('--stop', action='store_true', help='停止正在运行的工具后退出')
    parser.add_argument('--no-browser', action='store_true', help='不自动打开浏览器')
    parser.add_argument(
        '--app',
        action='store_true',
        help='用独立应用窗口打开（Chrome/Edge --app 模式，无地址栏/标签栏）',
    )
    parser.add_argument(
        '--app-size',
        default='1280,860',
        help='独立窗口尺寸，默认 1280,860',
    )
    parser.add_argument(
        '--idle-exit',
        type=int,
        default=0,
        help='页面无心跳多少秒后自动退出（默认 0 = 不自动退出，需手动关）',
    )
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    if args.stop:
        return stop_running()

    root = detect_repo_root(args.root)
    if root is None:
        print('找不到 OAS 的 config 目录，无法确定要管理哪个仓库。')
        print('')
        print('本工具是独立程序，需要你告诉它 OAS 在哪。三种方式任选：')
        print('  1) 命令行：  server.py --root "D:\\你的OAS目录"')
        print('  2) 环境变量：set OAS_ROOT=D:\\你的OAS目录')
        print('  3) 直接启动后在页面右上角「切换目标」里填路径（会记住）')
        print('')
        print('该目录下必须有 config 子目录，例如 D:\\OAS\\config\\模板.json')
        _pause()
        return 1
    store = Store(root)
    if not store.config_dir.exists():
        print('找不到配置目录: %s' % store.config_dir)
        print('请用 --root 指定 OAS 仓库根目录（该目录下应有 config/）')
        _pause()
        return 1

    # 已经开着一个本工具：直接开浏览器复用，不重复起服务。
    # 注意这里不看 --no-browser：双击快捷方式重复启动时，
    # 应当提示"已在运行"而不是悄悄换端口再起一个。
    running = _find_running(args.host, args.port)
    if running:
        url = 'http://%s:%d/' % (args.host, running['port'])
        print('工具已经在运行，直接打开页面: %s' % url)
        print('（要退出请在页面上点「退出工具」，或运行 关闭账号管理.bat）')
        if not args.no_browser:
            _open_page(url, as_app=args.app, size=args.app_size)
        return 0

    Handler.store = store
    try:
        server, port = _bind(args.host, args.port)
    except OSError as error:
        print('无法绑定端口（%s:%d 起）: %s' % (args.host, args.port, error))
        _pause()
        return 1

    Handler.httpd = server
    url = 'http://%s:%d/' % (args.host, port)
    _write_runtime_info(port, url, args.host)
    print('=' * 56)
    print(' 账号列表管理工具已启动')
    print(' 地址: %s' % url)
    print(' 配置: %s' % store.config_dir)
    print(' 备份: %s' % store.backup_dir)
    print(' 进程: PID %d' % os.getpid())
    print('=' * 56)
    print('退出方式：页面右下角「退出工具」 / 运行 关闭账号管理.bat / Ctrl+C')
    if not args.no_browser:
        threading.Timer(
            0.6,
            lambda: _open_page(url, as_app=args.app, size=args.app_size),
        ).start()
    # 空闲自动退出默认关闭（用户要求后台常驻，自己手动关）；
    # 需要时用 --idle-exit 60 显式打开
    if args.idle_exit > 0:
        _start_idle_watchdog(args.idle_exit)
        print('（已启用空闲自动退出：%d 秒无心跳即退出）' % args.idle_exit)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已退出')
    finally:
        server.server_close()
        _clear_runtime_info()
    return 0


def _pause() -> None:
    """双击启动时不要一闪而过，留个按键提示"""
    try:
        input('\n按回车键退出…')
    except (EOFError, KeyboardInterrupt):
        pass


if __name__ == '__main__':
    sys.exit(main())
