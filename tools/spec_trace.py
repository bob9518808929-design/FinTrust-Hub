#!/usr/bin/env python3
"""
spec_trace.py — Spec/Tasks/Checklist/Code 四向追溯工具

对齐 spec.md L5 状态约定:
  每个 ### Requirement 段落下方须标注 **Status** / **Priority** / **Code Ref** 三字段.

本工具职责:
  1. 解析 spec.md 所有 Requirement (ID / Status / Priority / Code Ref)
  2. 校验 Code Ref 指向的代码路径是否真实存在 (sim / production-be / production-fe)
  3. 输出追溯报告 (控制台 + JSON) 标记 dangling reference

用法:
  python tools/spec_trace.py                    # 扫描全部 + 控制台报告
  python tools/spec_trace.py --json out.json   # 输出 JSON 到指定文件
  python tools/spec_trace.py --missing         # 仅打印缺失/dangling 项
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / ".trae" / "specs" / "build-fintech-trust-hub" / "spec.md"
PROD_BE = ROOT / "production" / "backend"
PROD_FE = ROOT / "production" / "frontend" / "src"
PROD_AI = ROOT / "production" / "ai-engine"
SIM_DIR = ROOT / "simulation"


REQ_HEADER_RE = re.compile(r"^###\s+Requirement:\s*(.+?)\s*$", re.MULTILINE)
STATUS_RE = re.compile(r"\*\*Status\*\*:\s*(.+?)\s*$", re.MULTILINE)
PRIORITY_RE = re.compile(r"\*\*Priority\*\*:\s*(.+?)\s*$", re.MULTILINE)
CODEREF_RE = re.compile(r"\*\*Code Ref\*\*:\s*(.+?)\s*$", re.MULTILINE)


@dataclass
class Requirement:
    req_id: str
    title: str
    status: str = "未标注"
    priority: str = "未标注"
    code_ref: str = ""
    code_ref_exists: bool = False
    code_ref_locations: list[str] = field(default_factory=list)
    dangling_paths: list[str] = field(default_factory=list)
    line_no: int = 0


def split_requirements(spec_text: str) -> Iterable[tuple[int, str, str]]:
    """切分 spec.md 为 (line_no, req_id, body) 三元组."""
    matches = list(REQ_HEADER_RE.finditer(spec_text))
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(spec_text)
        body = spec_text[start:end]
        line_no = spec_text[:start].count("\n") + 1
        req_id = m.group(1).strip()
        yield line_no, req_id, body


def parse_requirement(line_no: int, req_id: str, body: str) -> Requirement:
    """从 Requirement body 提取 Status / Priority / Code Ref."""
    status_m = STATUS_RE.search(body)
    priority_m = PRIORITY_RE.search(body)
    coderef_m = CODEREF_RE.search(body)

    code_ref = coderef_m.group(1).strip() if coderef_m else ""
    exists, locations, dangling = verify_code_ref(code_ref)

    return Requirement(
        req_id=req_id,
        title=req_id,
        status=status_m.group(1).strip() if status_m else "未标注",
        priority=priority_m.group(1).strip() if priority_m else "未标注",
        code_ref=code_ref,
        code_ref_exists=exists,
        code_ref_locations=locations,
        dangling_paths=dangling,
        line_no=line_no,
    )


def verify_code_ref(code_ref: str) -> tuple[bool, list[str], list[str]]:
    """验证 Code Ref 字符串里的代码路径是否真实存在.

    支持:
      - `production/xxx/yyy.py`     → PROD_BE / PROD_FE / PROD_AI 之一
      - `frontend/src/xxx.vue`       → PROD_FE
      - `backend/app/xxx.py`        → PROD_BE
      - `ai-engine/xxx.py`          → PROD_AI
      - `simulation/xxx`            → SIM_DIR
      - 同时含多个路径 (逗号/分号/空格分隔)
    """
    if not code_ref or code_ref.startswith("spec") or code_ref.startswith("无"):
        # "spec v3.1 新增..." 或 "无 production 代码" → 不需要校验
        return True, [], []

    # 抽取所有 path-like token (含 / 和 .)
    tokens = re.findall(r"[a-zA-Z0-9_@./-]+/[a-zA-Z0-9_@./-]+", code_ref)
    if not tokens:
        return True, [], []  # 没有路径 token, 视为非代码引用

    locations: list[str] = []
    dangling: list[str] = []

    for tok in tokens:
        # 去掉末尾标点
        tok = tok.rstrip(".,;:")
        if not tok or tok.endswith(":"):
            continue

        # 跳过明显非代码路径 (URL / 版本号 / 文件名仅一处)
        if tok.startswith("http") or tok in {"v3.1", "v3.0", "v6.0", "v2.0", "v1.0"}:
            continue

        candidate_paths = [
            ROOT / tok,
            ROOT / "production" / tok,
            PROD_BE / tok.replace("backend/", "").replace("production/backend/", ""),
            PROD_FE / tok.replace("frontend/src/", "").replace("production/frontend/src/", ""),
            PROD_AI / tok.replace("ai-engine/", "").replace("production/ai-engine/", ""),
            SIM_DIR / tok.replace("simulation/", ""),
        ]

        found = False
        for p in candidate_paths:
            try:
                if p.exists():
                    locations.append(str(p.relative_to(ROOT)))
                    found = True
                    break
            except (OSError, ValueError):
                continue

        if not found and _looks_like_code_path(tok):
            dangling.append(tok)

    exists = len(dangling) == 0
    return exists, locations, dangling


def _looks_like_code_path(tok: str) -> bool:
    """判断 token 是否像代码路径 (含扩展名或目录分隔)."""
    if "/" not in tok:
        return False
    code_exts = (".py", ".ts", ".vue", ".js", ".json", ".md", ".yaml", ".yml")
    if tok.endswith(code_exts):
        return True
    # 目录引用 (如 production/backend/app/services)
    if "production/" in tok or "backend/" in tok or "frontend/" in tok or "ai-engine/" in tok or "simulation/" in tok:
        return True
    return False


def scan_spec(spec_path: Path = SPEC_PATH) -> list[Requirement]:
    """扫描 spec.md 全部 Requirement."""
    text = spec_path.read_text(encoding="utf-8")
    return [parse_requirement(ln, rid, body) for ln, rid, body in split_requirements(text)]


def render_console_report(reqs: list[Requirement], only_missing: bool = False, spec_path: Path | None = None) -> None:
    """打印控制台报告."""
    total = len(reqs)
    by_status: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    dangling_count = 0
    unmarked = 0

    for r in reqs:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_priority[r.priority] = by_priority.get(r.priority, 0) + 1
        if r.dangling_paths:
            dangling_count += 1
        if r.status == "未标注" or r.priority == "未标注":
            unmarked += 1

    display_path = spec_path or SPEC_PATH
    print("=" * 78)
    try:
        rel = display_path.relative_to(ROOT)
    except ValueError:
        rel = display_path
    print(f"Spec 追溯报告  |  spec.md: {rel}")
    print("=" * 78)
    print(f"Requirement 总数:        {total}")
    print(f"未标注 Status/Priority: {unmarked}")
    print(f"Dangling Code Ref:      {dangling_count}")
    print()
    print("Status 分布:")
    for k, v in sorted(by_status.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3d}  {k}")
    print()
    print("Priority 分布:")
    for k, v in sorted(by_priority.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3d}  {k}")
    print()

    if only_missing:
        print("--- Dangling / 未标注项 ---")
        for r in reqs:
            if r.dangling_paths or r.status == "未标注" or r.priority == "未标注":
                print(f"L{r.line_no}  {r.req_id}")
                if r.status == "未标注":
                    print(f"  ! Status 未标注")
                if r.priority == "未标注":
                    print(f"  ! Priority 未标注")
                for d in r.dangling_paths:
                    print(f"  ✗ Dangling: {d}")
        return

    print("--- 全部 Requirement ---")
    for r in reqs:
        flag = "✓" if r.code_ref_exists else "✗"
        print(f"L{r.line_no:5d}  {flag}  [{r.priority}]  {r.status:20s}  {r.req_id}")
        if r.dangling_paths:
            for d in r.dangling_paths:
                print(f"          ✗ Dangling: {d}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Spec/Tasks/Checklist/Code 追溯工具")
    parser.add_argument("--json", metavar="PATH", help="输出 JSON 报告到指定路径")
    parser.add_argument("--missing", action="store_true", help="仅打印 dangling/未标注项")
    parser.add_argument("--spec", metavar="PATH", help="自定义 spec.md 路径", default=str(SPEC_PATH))
    args = parser.parse_args()

    spec_path = Path(args.spec)
    if not spec_path.exists():
        print(f"[ERROR] spec.md 不存在: {spec_path}", file=sys.stderr)
        return 1

    reqs = scan_spec(spec_path)
    render_console_report(reqs, only_missing=args.missing, spec_path=spec_path)

    if args.json:
        out_path = Path(args.json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "spec_path": str(spec_path.relative_to(ROOT)) if spec_path.is_relative_to(ROOT) else str(spec_path),
            "total": len(reqs),
            "requirements": [asdict(r) for r in reqs],
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[OK] JSON 报告已写入: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
