# 文件名：log_parser.py
# 职责：解析 backend/logs/*.log 最近 N 行，匹配修复建议规则
# 设计哲学：白盒可解释 + 配置优于训练（规则库 YAML）

"""日志解析与修复建议匹配引擎

三层匹配：
  1. 粗筛（关键字预过滤，O(n)）
  2. 细筛（正则匹配，提取变量）
  3. 上下文校验（同模块/同时间窗）

输出：
  - 最近 N 行日志
  - 匹配的修复建议（含置信度、来源、待人工确认标记）
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


def parse_recent_logs(log_dir: Path, tail_lines: int = 10,
                      rules_file: Path = None) -> dict:
    """解析最近日志并匹配修复建议

    Args:
        log_dir: 日志目录（如 production/backend/logs）
        tail_lines: 每个日志文件取最近 N 行
        rules_file: 修复建议规则库（默认用 tools/panorama/remediation_rules.yaml）

    Returns:
        {
            "log_files": [...],
            "recent_lines": [...],
            "risks": [...],  # 匹配的修复建议
            "error_count_since_last": int,
        }
    """
    if not log_dir.exists():
        return {"error": f"log dir not found: {log_dir}"}

    # 1. 收集所有日志文件
    log_files = sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime,
                       reverse=True)
    if not log_files:
        return {"log_files": [], "recent_lines": [], "risks": []}

    # 2. 取每个文件最近 N 行
    recent_lines = []
    for lf in log_files[:5]:  # 最多 5 个日志文件
        try:
            content = lf.read_text(encoding="utf-8", errors="ignore")
            lines = content.splitlines()
            for line in lines[-tail_lines:]:
                recent_lines.append({
                    "file": str(lf.relative_to(log_dir)),
                    "line": line,
                    "timestamp": _extract_timestamp(line),
                })
        except (OSError, PermissionError):
            continue

    # 3. 加载修复建议规则
    rules = _load_rules(rules_file)

    # 4. 匹配规则
    risks = []
    for entry in recent_lines:
        for rule in rules:
            match = _match_rule(rule, entry["line"])
            if match:
                risks.append({
                    "rule_id": rule.get("id"),
                    "type": rule.get("category"),
                    "severity": rule.get("severity"),
                    "detail": match.get("detail", entry["line"][:80]),
                    "matched_log": entry["line"][:200],
                    "log_file": entry["file"],
                    "remediation": _render_remediation(rule, match),
                })

    return {
        "log_files": [str(f.relative_to(log_dir)) for f in log_files],
        "recent_lines": recent_lines,
        "risks": risks,
        "error_count_since_last": len([r for r in risks
                                        if r["severity"] == "blocker"]),
    }


# ============================================================================
# 规则匹配引擎
# ============================================================================

def _load_rules(rules_file: Path = None) -> list:
    """加载修复建议规则"""
    if rules_file is None:
        rules_file = Path(__file__).parent.parent / "remediation_rules.yaml"
    if not rules_file.exists() or yaml is None:
        return []
    try:
        with open(rules_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return data.get("rules", [])
    except (yaml.YAMLError, OSError):
        return []


def _match_rule(rule: dict, log_line: str) -> dict | None:
    """三层匹配：粗筛 → 正则 → 上下文

    Returns:
        匹配后的 dict（含提取的变量），未匹配返回 None
    """
    pattern_type = rule.get("pattern_type", "regex")
    if pattern_type == "structural":
        # 结构性规则（孤儿契约）不在日志匹配范围
        return None

    pattern = rule.get("pattern", "")
    if not pattern:
        return None

    # 1. 粗筛（关键字）
    keywords = ["ERROR", "WARN", "Exception", "Error", "Refused", "Timeout",
                "ModuleNotFound", "ImportError", "KeyError", "ValueError"]
    if not any(kw.lower() in log_line.lower() for kw in keywords):
        # 跳过明显无错误的日志行
        # 注意：这不绝对，可能漏报，但减少误匹配
        if rule.get("severity") != "info":
            return None

    # 2. 正则匹配
    try:
        m = re.search(pattern, log_line, re.IGNORECASE)
    except re.error:
        return None

    if not m:
        return None

    # 3. 提取变量
    extract_spec = rule.get("extract", {})
    extracted = {}
    for var_name, var_pattern in extract_spec.items():
        # var_pattern 形如 "$1" 表示第 1 个捕获组
        if isinstance(var_pattern, str) and var_pattern.startswith("$"):
            try:
                idx = int(var_pattern[1:]) - 1
                if 0 <= idx < len(m.groups()):
                    extracted[var_name] = m.group(idx + 1)
            except (ValueError, IndexError):
                pass
        else:
            extracted[var_name] = var_pattern

    # 4. 上下文校验（简化：仅时间窗校验）
    triggers = rule.get("triggers", {})
    if triggers:
        log_ts = _extract_timestamp(log_line)
        if log_ts:
            window_min = triggers.get("time_window_minutes", 5)
            now = time.time()
            try:
                log_time = time.mktime(time.strptime(log_ts,
                                                       "%Y-%m-%d %H:%M:%S"))
                if now - log_time > window_min * 60:
                    return None  # 超出时间窗
            except (ValueError, OverflowError):
                pass

    return {"detail": _format_detail(rule, extracted, log_line),
            "extracted": extracted}


def _format_detail(rule: dict, extracted: dict, log_line: str) -> str:
    """格式化风险详情"""
    explanation = rule.get("remediation", {}).get("explanation", "")
    if explanation and "{" in explanation:
        try:
            return explanation.format(**extracted)
        except (KeyError, IndexError):
            pass
    return explanation or log_line[:80]


def _render_remediation(rule: dict, match: dict) -> dict:
    """渲染修复建议输出"""
    rem = rule.get("remediation", {})
    extracted = match.get("extracted", {})

    # 处理 command_template（含变量）
    cmd = rem.get("command", "")
    if not cmd:
        tpl = rem.get("command_template", "")
        if tpl and "{" in tpl:
            try:
                cmd = tpl.format(**extracted)
            except (KeyError, IndexError):
                cmd = tpl
        else:
            cmd = tpl

    # 处理 explanation / reference（含变量）
    explanation = rem.get("explanation", "")
    if explanation and "{" in explanation:
        try:
            explanation = explanation.format(**extracted)
        except (KeyError, IndexError):
            pass
    reference = rem.get("reference", "")
    if reference and "{" in reference:
        try:
            reference = reference.format(**extracted)
        except (KeyError, IndexError):
            pass
    guide = rem.get("guide", "")
    if guide and "{" in guide:
        try:
            guide = guide.format(**extracted)
        except (KeyError, IndexError):
            pass

    return {
        "action": rem.get("action", "reference"),
        "command": cmd,
        "explanation": explanation,
        "reference": reference,
        "guide": guide,
        "confidence": rem.get("confidence", 0.5),
        "source": rule.get("source", "unknown"),
        "spec_section": rule.get("spec_section", ""),
        "requires_human": rem.get("requires_human", True),
        "agent_auto_execute": False,  # 硬约束：禁止自动执行
    }


def _extract_timestamp(log_line: str) -> str:
    """从日志行提取时间戳"""
    # 常见格式：2026-09-04 10:23:45 或 [2026-09-04 10:23:45]
    m = re.search(r"(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})", log_line)
    return m.group(1) if m else ""


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    import sys
    log_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "../../production/backend/logs")
    res = parse_recent_logs(log_dir)
    print(f"日志文件数：{len(res.get('log_files', []))}")
    print(f"最近行数：{len(res.get('recent_lines', []))}")
    print(f"匹配风险数：{len(res.get('risks', []))}")
    for r in res.get("risks", [])[:5]:
        print(f"\n  [{r['rule_id']}] {r['severity']}: {r['detail'][:60]}")
        if r["remediation"].get("command"):
            print(f"    命令: {r['remediation']['command']}")
