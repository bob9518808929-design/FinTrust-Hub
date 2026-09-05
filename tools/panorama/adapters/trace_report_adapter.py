# 文件名：trace_report_adapter.py
# 职责：复用 tools/trace_report.json，按 production/ 一级目录归类到模块树
# 设计哲学：避免与既有 spec_*.py 重复扫描，渐进式增强

"""trace_report.json 适配器

输入：
  - trace_report_path: Path (tools/trace_report.json)
  - files: List[FileInfo]（panorama 已扫描的文件）

输出：
  - dict: file_path -> spec_section（规范对齐映射）

容错策略：
  - 文件不存在时静默跳过（不报错）
  - 不强制依赖 spec_trace.py 先运行
  - JSON 解析失败时返回空 dict
"""

from __future__ import annotations

import json
from pathlib import Path


def adapt_trace_report(trace_report_path: Path, files: list) -> dict:
    """适配 trace_report.json 到模块树

    Args:
        trace_report_path: tools/trace_report.json 路径
        files: panorama 扫描的 FileInfo 列表

    Returns:
        {
            "by_module": {module: [spec_sections]},
            "by_file": {file_path: spec_section},
            "summary": {"total_files": N, "covered_files": N, "coverage": 0.0}
        }
    """
    if not trace_report_path.exists():
        return {}

    try:
        with open(trace_report_path, "r", encoding="utf-8") as f:
            trace_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return {"error": str(e)}

    # trace_report.json 的 schema 兼容（多种可能格式）
    # 简化：尝试从常见字段提取 file_path 与 spec_section
    by_file = {}
    by_module = {}

    items = _extract_items(trace_data)
    for item in items:
        file_path = item.get("file_path") or item.get("path") or item.get("file")
        spec_section = item.get("spec_section") or item.get("section") or \
                       item.get("spec_id") or item.get("mod_id")
        if not file_path:
            continue
        # 归一化路径
        file_path = file_path.replace("\\", "/").lstrip("/")
        by_file[file_path] = spec_section

        # 归类到一级模块
        parts = file_path.split("/")
        if len(parts) > 0:
            module = parts[0]
            by_module.setdefault(module, [])
            if spec_section and spec_section not in by_module[module]:
                by_module[module].append(spec_section)

    # 覆盖率统计
    panorama_files = {fi.path for fi in files}
    covered = sum(1 for f in by_file if f in panorama_files)
    total = len(panorama_files) if panorama_files else 1
    coverage = covered / total if total else 0.0

    return {
        "by_module": by_module,
        "by_file": by_file,
        "summary": {
            "total_files": len(panorama_files),
            "covered_files": covered,
            "coverage": round(coverage, 3),
            "trace_report_path": str(trace_report_path),
        }
    }


def _extract_items(trace_data) -> list:
    """从 trace_report.json 不同 schema 中提取条目列表"""
    # schema 1: 顶层就是 list
    if isinstance(trace_data, list):
        return trace_data
    # schema 2: {"files": [...]}
    if isinstance(trace_data, dict):
        if "files" in trace_data and isinstance(trace_data["files"], list):
            return trace_data["files"]
        if "items" in trace_data and isinstance(trace_data["items"], list):
            return trace_data["items"]
        if "results" in trace_data and isinstance(trace_data["results"], list):
            return trace_data["results"]
        # schema 3: 直接是 {file_path: spec_section} 映射
        if all(isinstance(v, (str, type(None))) for v in trace_data.values()):
            return [{"file_path": k, "spec_section": v}
                    for k, v in trace_data.items()]
    return []


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    import sys
    path = Path(sys.argv[1] if len(sys.argv) > 1 else
                "../../tools/trace_report.json")
    res = adapt_trace_report(path, [])
    print(json.dumps(res, ensure_ascii=False, indent=2)[:500])
