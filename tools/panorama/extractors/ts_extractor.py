# 文件名：ts_extractor.py
# 职责：从 TypeScript/JavaScript 文件提取中文注释
# 优先级：1) // 文件名： / // 模块名： 2) // 职责： 3) @description JSDoc 4) 文件名推断

"""TS/JS 注释提取器

返回 (name_cn, responsibility_cn, source)
"""

from __future__ import annotations

import re
from pathlib import Path


def extract_ts_annotation(file_path: str) -> tuple[str, str, str]:
    """提取 TS/JS 文件的中文注释"""
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError, PermissionError):
        return "", "", "missing"

    # 优先级 1：// 文件名： / /** 文件名：(JSDoc) / * 文件名：(JSDoc 行)
    name_cn = _extract_first_match(
        content,
        r"(?://|/\*\*?|^\s*\*)\s*(?:文件名|模块名|组件名)[：:]\s*(.+?)(?:\s*职责[：:]|\s*\*/|$)"
    )
    # 优先级 2：// 职责： / /** 职责：(JSDoc) / * 职责：(JSDoc 行)
    responsibility_cn = _extract_first_match(
        content,
        r"(?://|/\*\*?|^\s*\*)\s*职责[：:]\s*(.+?)(?:\s*\*/|$)"
    )

    if name_cn or responsibility_cn:
        return name_cn or "", responsibility_cn or "", "comment"

    # 优先级 3：@description JSDoc
    desc = _extract_jsdoc_description(content)
    if desc:
        lines = desc.strip().splitlines()
        if lines:
            return lines[0].strip(), " ".join(l.strip() for l in lines[1:]), "docstring"

    # 优先级 4：文件名推断
    name_cn = _infer_from_filename(file_path)
    return name_cn, "", "filename" if name_cn else "missing"


def _extract_first_match(content: str, pattern: str) -> str:
    m = re.search(pattern, content, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_jsdoc_description(content: str) -> str:
    """提取 JSDoc 中的 @description"""
    # 匹配 /** ... */ 块
    m = re.search(r"/\*\*(?P<block>.*?)\*/", content, re.DOTALL)
    if not m:
        return ""
    block = m.group("block")
    # 找 @description 标签
    desc_match = re.search(r"@description\s+(.+?)(?=\n\s*\*\s*@|\Z)",
                           block, re.DOTALL)
    if desc_match:
        return desc_match.group(1).strip().replace(" * ", "")
    # 没 @description 取首段
    first_desc = re.match(r"\s*\*\s*(.+?)(?=\n\s*\*\s*@|\Z)", block, re.DOTALL)
    return first_desc.group(1).strip() if first_desc else ""


def _infer_from_filename(file_path: str) -> str:
    fname = Path(file_path).stem.lower()
    name_map = {
        # frontend api
        "client": "API 客户端",
        "http": "HTTP 模块",
        "api": "API 接口层",
        "router": "路由配置",
        "store": "Pinia 状态",
        "index": "模块索引",
        "app": "根组件",
        "main": "应用入口",
        "sw": "Service Worker",
        # views
        "homeview": "首页视图",
        "loginview": "登录视图",
        "aboutview": "关于视图",
        "notfoundview": "404 视图",
        # components
        "components": "公共组件",
        "composables": "组合式函数",
        "layouts": "布局",
        "styles": "样式",
        "utils": "工具",
        # ECO 视图
        "burnview": "ECO-01 阅后即烕视图",
        "payview": "ECO-02 成果定价视图",
        "rpaview": "ECO-03 无接口适配器视图",
        "credview": "ECO-04 联盟链凭证视图",
        "bidview": "ECO-05 反向竞拍视图",
        "ptsview": "ECO-06 积分商城视图",
        "idxview": "ECO-07 FinTrust 指数视图",
        "govview": "ECO-08 政府背书视图",
        "botview": "ECO-09 数字分身视图",
    }
    if fname in name_map:
        return name_map[fname]
    # 后缀匹配
    for suffix, label in [("view", "视图"), ("store", "状态"),
                           ("service", "服务"), ("api", "接口"),
                           ("router", "路由"), ("client", "客户端")]:
        if fname.endswith(suffix):
            prefix = fname[:-len(suffix)].strip("_").replace("_", " ")
            return f"{prefix} {label}".strip()
    return ""
