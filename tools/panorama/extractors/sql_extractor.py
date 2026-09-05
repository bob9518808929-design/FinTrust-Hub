# 文件名：sql_extractor.py
# 职责：从 SQL 文件提取中文注释
# 优先级：1) -- 文件名： / -- 模块名： 2) -- 职责： 3) /* 文件名 */ 块注释 4) 文件名推断

"""SQL 注释提取器

返回 (name_cn, responsibility_cn, source)
"""

from __future__ import annotations

import re
from pathlib import Path


def extract_sql_annotation(file_path: str) -> tuple[str, str, str]:
    """提取 SQL 文件的中文注释"""
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError, PermissionError):
        return "", "", "missing"

    # 优先级 1：-- 文件名：
    name_cn = _extract_first_match(
        content, r"--\s*(?:文件名|模块名|表名)[：:]\s*(.+)"
    )
    # 优先级 2：-- 职责：
    responsibility_cn = _extract_first_match(content, r"--\s*职责[：:]\s*(.+)")

    if name_cn or responsibility_cn:
        return name_cn or "", responsibility_cn or "", "comment"

    # 优先级 3：/* ... */ 块注释
    block_comment = _extract_first_block_comment(content)
    if block_comment:
        lines = block_comment.strip().splitlines()
        if lines:
            # 第一行可能是 -- 文件名： / # 文件名：
            first = lines[0].strip()
            m_name = re.match(r"(?:--|#|/\*)\s*(?:文件名|表名)[：:]\s*(.+)",
                              first)
            if m_name:
                return m_name.group(1).strip(), \
                       " ".join(l.strip().lstrip("-*# ") for l in lines[1:]), \
                       "comment"
            # 否则第一行作为名称
            return first, " ".join(l.strip() for l in lines[1:]), "docstring"

    # 优先级 4：从 CREATE TABLE 语句推断
    name_cn = _infer_from_create_table(content)
    if not name_cn:
        name_cn = _infer_from_filename(file_path)
    return name_cn, "", "filename" if name_cn else "missing"


def _extract_first_match(content: str, pattern: str) -> str:
    m = re.search(pattern, content, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_first_block_comment(content: str) -> str:
    """提取第一个 /* ... */ 块注释"""
    m = re.search(r"/\*(.*?)\*/", content, re.DOTALL)
    return m.group(1) if m else ""


def _infer_from_create_table(content: str) -> str:
    """从 CREATE TABLE 语句推断表名"""
    m = re.search(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`]?\w+[\"`]?\."
                  r"?[\"`]?(\w+)[\"`]?", content, re.IGNORECASE)
    if m:
        return f"{m.group(1)} 表"
    return ""


def _infer_from_filename(file_path: str) -> str:
    fname = Path(file_path).stem.lower()
    name_map = {
        "schema": "数据库 Schema",
        "init": "初始化脚本",
        "seed": "种子数据",
        "migration": "数据库迁移",
    }
    if fname in name_map:
        return name_map[fname]
    # 按表名前缀归类
    for prefix, label in [("eco_", "ECO 模块表"),
                          ("risk_", "风控表"),
                          ("credit_", "信用表"),
                          ("enterprise_", "企业表"),
                          ("reform_", "改造表"),
                          ("bank_", "银行表")]:
        if fname.startswith(prefix):
            return f"{label} - {fname}"
    return ""
