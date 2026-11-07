"""账号列表管理工具的路径预设

把常用的 OAS 根目录登记在这里，启动时就不用每次敲 --root。
本文件由工具自己和用户共同维护：页面里的「切换目标」会写回 settings.json，
命令行 --root 优先级更高。

settings.json 结构：
    {
      "default": "local",              // 默认使用哪个预设的 name
      "roots": [
        {"name": "local",  "path": "E:\\\\git_src\\\\OnmyojiAutoScript"},
        {"name": "局域网", "path": "\\\\\\\\oas\\\\OnmyojiAutoScript-easy-install"}
      ]
    }

注意：默认预设**不再假设工具放在 OAS 仓库里的固定层级**。
以前用 parents[3] 硬编码，工具一旦独立成库就会指向错误目录。
现在默认是"从工具目录向上找最近的含 config/ 的目录"，找不到就留空，
由用户用 --root 或页面上的「切换目标」指定。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SETTINGS_FILE = Path(__file__).resolve().parent / 'settings.json'


def _guess_local_root() -> str:
    """向上找最近的含 config/ 的目录（工具放在 OAS 里时能自动找到）。

    找不到返回空字符串 —— 独立部署时工具本来就不在 OAS 仓库内，
    这时应该由用户显式指定根目录，而不是猜一个错误路径。
    """
    here = Path(__file__).resolve().parent
    for candidate in [here] + list(here.parents):
        try:
            if (candidate / 'config').is_dir():
                return str(candidate)
        except OSError:
            continue
    return ''


DEFAULT_SETTINGS = {
    'default': 'local',
    'roots': [
        {
            'name': 'local',
            'path': _guess_local_root(),
        },
    ],
}


def load_settings() -> dict:
    """读设置；文件不存在或损坏时返回默认值（不写盘，避免意外创建）

    注意：默认预设的 path 可能是空字符串（工具独立部署、向上找不到 config/）。
    这种情况保留这个"空预设"是故意的 —— 它让「切换目标」页面有东西可显示，
    同时 server 会因为找不到 config/ 而提示用户用 --root 指定。
    """
    try:
        raw = SETTINGS_FILE.read_text(encoding='utf-8')
        data = json.loads(raw)
    except (OSError, ValueError):
        return json.loads(json.dumps(DEFAULT_SETTINGS))

    if not isinstance(data, dict):
        return json.loads(json.dumps(DEFAULT_SETTINGS))

    roots = data.get('roots')
    if not isinstance(roots, list) or not roots:
        data['roots'] = json.loads(json.dumps(DEFAULT_SETTINGS['roots']))
    else:
        cleaned = []
        for item in roots:
            if not isinstance(item, dict):
                continue
            path = str(item.get('path') or '').strip()
            if not path:
                continue
            cleaned.append({
                'name': str(item.get('name') or '').strip() or path,
                'path': path,
            })
        if cleaned:
            data['roots'] = cleaned
        else:
            # 全是空路径：回落到默认（可能也是一个空预设，交给 server 提示）
            data['roots'] = json.loads(json.dumps(DEFAULT_SETTINGS['roots']))

    if not isinstance(data.get('default'), str):
        data['default'] = data['roots'][0]['name']
    return data


def save_settings(data: dict) -> None:
    """原子写入设置"""
    import tempfile

    text = json.dumps(data, indent=2, ensure_ascii=False)
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(SETTINGS_FILE.parent), prefix='.settings-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)
        os.replace(tmp, SETTINGS_FILE)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def resolve_preset(name: str) -> str | None:
    """按名称取预设路径，找不到返回 None"""
    data = load_settings()
    for item in data['roots']:
        if item['name'] == name:
            return item['path']
    return None


def default_root() -> str | None:
    """默认预设的路径；没有可用预设时返回 None（独立部署首次运行会这样）"""
    data = load_settings()
    for item in data['roots']:
        if item['name'] == data.get('default'):
            return item['path'] or None
    if data['roots']:
        return data['roots'][0]['path'] or None
    return None


def root_reachable(path: str) -> bool:
    """路径下有没有 config 目录（网络路径也能判断）"""
    if not str(path or '').strip():
        return False
    try:
        return (Path(path) / 'config').is_dir()
    except OSError:
        return False


def is_network_path(path: str) -> bool:
    """是不是 UNC 网络路径（\\\\\\\\server\\\\share）"""
    text = str(path or '')
    return text.startswith('\\\\') or text.startswith('//')
