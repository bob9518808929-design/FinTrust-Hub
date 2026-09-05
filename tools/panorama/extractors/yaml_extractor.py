# 文件名：yaml_extractor.py
# 职责：从 YAML 文件提取中文注释
# 优先级：1) # 文件名： 2) # 职责： 3) 顶层 name/title 字段 4) 文件名推断

"""YAML 注释提取器

返回 (name_cn, responsibility_cn, source)
"""

from __future__ import annotations

import re
from pathlib import Path


def extract_yaml_annotation(file_path: str) -> tuple[str, str, str]:
    """提取 YAML 文件的中文注释"""
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError, PermissionError):
        return "", "", "missing"

    # 优先级 1：# 文件名： / {{/* 文件名：(Helm 模板)
    name_cn = _extract_first_match(
        content, r"(?:#\s*|\{\{/\*\s*)(?:文件名|模块名|配置名)[：:]\s*(.+?)(?:\s*\*/\}\}|\s*$)"
    )
    # 优先级 2：# 职责： / {{/* 职责：(Helm 模板)
    responsibility_cn = _extract_first_match(
        content, r"(?:#\s*|\{\{/\*\s*)职责[：:]\s*(.+?)(?:\s*\*/\}\}|\s*$)"
    )

    if name_cn or responsibility_cn:
        return name_cn or "", responsibility_cn or "", "comment"

    # 优先级 3：顶层 name/title/description 字段
    try:
        try:
            import yaml  # 延迟导入
        except ImportError:
            yaml = None
        if yaml:
            data = yaml.safe_load(content)
            if isinstance(data, dict):
                if isinstance(data.get("name"), str):
                    return data["name"], data.get("description", ""), "docstring"
                if isinstance(data.get("title"), str):
                    return data["title"], data.get("description", ""), "docstring"
                if isinstance(data.get("description"), str):
                    return "", data["description"], "docstring"
    except Exception:
        pass

    # 优先级 4：文件名推断
    name_cn = _infer_from_filename(file_path)
    return name_cn, "", "filename" if name_cn else "missing"


def _extract_first_match(content: str, pattern: str) -> str:
    m = re.search(pattern, content, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _infer_from_filename(file_path: str) -> str:
    fname = Path(file_path).stem.lower()
    name_map = {
        "docker-compose": "Docker Compose 编排",
        "dockerfile": "Dockerfile",
        "config": "配置文件",
        "openapi": "OpenAPI 规范",
        "swagger": "Swagger 规范",
        "schema": "Schema 定义",
    }
    if fname in name_map:
        return name_map[fname]
    return ""
