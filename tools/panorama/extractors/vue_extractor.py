# 文件名：vue_extractor.py
# 职责：从 Vue SFC 文件提取中文注释
# 优先级：1) <!-- 文件名： --> 2) <!-- 职责： -->
#        3) <script> 块内的 // 文件名：/JSDoc 4) 文件名推断

"""Vue SFC 注释提取器

注意 Vue SFC 三段式（template/script/style）：
- template/style 用 <!-- --> HTML 注释
- script 用 // 或 /* */ JS 注释
"""

from __future__ import annotations

import re
from pathlib import Path


def extract_vue_annotation(file_path: str) -> tuple[str, str, str]:
    """提取 Vue 文件的中文注释"""
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError, PermissionError):
        return "", "", "missing"

    # 优先级 1：HTML 注释 <!-- 文件名： -->
    name_cn = _extract_first_match(
        content, r"<!--\s*(?:文件名|模块名|组件名)[：:]\s*(.+?)-->"
    )
    # 优先级 2：HTML 注释 <!-- 职责： -->
    responsibility_cn = _extract_first_match(
        content, r"<!--\s*职责[：:]\s*(.+?)-->"
    )

    if name_cn or responsibility_cn:
        return name_cn or "", responsibility_cn or "", "comment"

    # 优先级 3：<script> 块内的 // 文件名：
    script_block = _extract_script_block(content)
    if script_block:
        # JS 风格注释
        name_cn = _extract_first_match(
            script_block, r"//\s*(?:文件名|模块名|组件名)[：:]\s*(.+)"
        )
        responsibility_cn = _extract_first_match(
            script_block, r"//\s*职责[：:]\s*(.+)"
        )
        if name_cn or responsibility_cn:
            return name_cn or "", responsibility_cn or "", "comment"

        # JSDoc @description
        desc = _extract_jsdoc_description(script_block)
        if desc:
            lines = desc.strip().splitlines()
            if lines:
                return lines[0].strip(), \
                       " ".join(l.strip() for l in lines[1:]), "docstring"

    # 优先级 4：文件名推断
    name_cn = _infer_from_filename(file_path)
    return name_cn, "", "filename" if name_cn else "missing"


def _extract_first_match(content: str, pattern: str) -> str:
    m = re.search(pattern, content, re.DOTALL)
    return m.group(1).strip() if m else ""


def _extract_script_block(content: str) -> str:
    """提取 <script> 块内容"""
    m = re.search(r"<script(?:\s+[^>]*)?>(?P<body>.*?)</script>",
                  content, re.DOTALL | re.IGNORECASE)
    return m.group("body") if m else ""


def _extract_jsdoc_description(content: str) -> str:
    """提取 JSDoc @description"""
    m = re.search(r"/\*\*(?P<block>.*?)\*/", content, re.DOTALL)
    if not m:
        return ""
    block = m.group("block")
    desc_match = re.search(r"@description\s+(.+?)(?=\n\s*\*\s*@|\Z)",
                           block, re.DOTALL)
    return desc_match.group(1).strip() if desc_match else ""


def _infer_from_filename(file_path: str) -> str:
    fname = Path(file_path).stem.lower()
    name_map = {
        "app": "根组件",
        "main": "应用入口",
        "sw": "Service Worker",
        "homeview": "首页视图",
        "loginview": "登录视图",
        "aboutview": "关于视图",
        "notfoundview": "404 视图",
        "burnview": "ECO-01 阅后即烕视图",
        "payview": "ECO-02 成果定价视图",
        "rpaview": "ECO-03 无接口适配器视图",
        "credview": "ECO-04 联盟链凭证视图",
        "bidview": "ECO-05 反向竞拍视图",
        "ptsview": "ECO-06 积分商城视图",
        "idxview": "ECO-07 FinTrust 指数视图",
        "govview": "ECO-08 政府背书视图",
        "botview": "ECO-09 数字分身视图",
        "scanconfirmview": "扫码确认视图",
    }
    if fname in name_map:
        return name_map[fname]
    # .vue 文件通常以 View/Component 结尾
    for suffix, label in [("view", "视图"), ("component", "组件"),
                           ("dialog", "对话框"), ("form", "表单"),
                           ("modal", "模态窗"), ("drawer", "抽屉"),
                           ("card", "卡片"), ("panel", "面板")]:
        if fname.endswith(suffix):
            prefix = fname[:-len(suffix)].strip("_").replace("_", " ")
            return f"{prefix} {label}".strip()
    return ""
