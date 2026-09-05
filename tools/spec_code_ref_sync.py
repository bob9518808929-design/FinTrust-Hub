#!/usr/bin/env python3
"""
spec_code_ref_sync.py — 把 spec.md Code Ref 字段同步为三列格式 (sim/prod-be/prod-fe)

P2.2 任务脚本: 扫描已实现的代码, 把 spec.md 中过时的 "production 无 xxx_service"
改写为 "prod-be: ... | prod-fe: ... | sim: ..." 三列格式, 同时把 Status 从 "未开始"
更新为 "部分实现" (stub) 或 "已实现(production)" (完整).

仅更新文件确实存在的情况, 不会动 "spec v3.x 新增" 或 "无 production 代码" 的项.

用法:
  python tools/spec_code_ref_sync.py --dry-run   # 预览 (不写文件)
  python tools/spec_code_ref_sync.py --apply     # 实际写入 spec.md
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / ".trae" / "specs" / "build-fintech-trust-hub" / "spec.md"
PROD_BE_SERVICES = ROOT / "production" / "backend" / "app" / "services"
PROD_FE_SRC = ROOT / "production" / "frontend" / "src"


# Requirement ID → 期望查找的 backend service 文件名 (不含路径前缀)
REQ_TO_SERVICE: dict[str, str] = {
    "MOD-01 资金监管模块": "fund_service.py",
    "MOD-02 智能风控引擎": "risk_service.py",
    "MOD-03 征信与审批简化模块": "credit_service.py",
    "MOD-04 票据服务模块": "invoice_service.py",
    "MOD-05 应收款保险模块": "insurance_service.py",
    "MOD-08 区块链存证与司法取证模块": "chain_service.py",
    "MOD-12 物联网感知与实物资产验证模块": "iot_service.py",
    "MOD-13 多方机构协作模块": "contract_service.py",
}

# Requirement ID → 期望查找的前端 view 目录
# 仅列入可明确对应的项 (APP-05/06 担保/保险门户在 production 中暂无独立目录, 跳过)
REQ_TO_FE_VIEW: dict[str, str] = {
    "APP-07 关联机构端门户": "institution",
    "MOD-15 独立兜底引擎模块": "fallback",
}

# Requirement ID → (composable 路径, 组件路径) 用于 CORE-04 一键求助
REQ_TO_COMPOSABLE: dict[str, tuple[str, ...]] = {
    "CORE-04 全局\"一键求助\"与操作指引浮层（v3.1 新增）": (
        "composables/useCoachMark.ts",
        "components/common/CoachMark.vue",
    ),
}

# Requirement ID → 样式/设计系统文件路径 (CORE-05 傻瓜化 UI/UX)
REQ_TO_STYLES: dict[str, tuple[str, ...]] = {
    "CORE-05 傻瓜化 UI/UX 组件规范（v3.1 新增）": (
        "styles/main.scss",
        "styles/variables.scss",
        "styles/reset.scss",
    ),
}


def _classify_service(path: Path) -> str:
    """根据文件内容判定实现程度: stub / 部分 / 实现."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return "stub"
    # 含 "桩实现" 或 "stub" → stub
    if "桩实现" in text[:2000] or re.search(r"\bstub\b", text[:2000], re.IGNORECASE):
        return "stub"
    # 行数 > 100 且无明显桩声明 → 视为实现
    if text.count("\n") > 100:
        return "实现"
    return "部分"


def build_new_code_ref(req_id: str) -> str | None:
    """根据代码实际存在情况, 构造三列 Code Ref. 返回 None 表示无需更新."""
    parts: list[str] = []
    be_changed = False
    fe_changed = False

    if req_id in REQ_TO_SERVICE:
        svc_file = REQ_TO_SERVICE[req_id]
        be_path = PROD_BE_SERVICES / svc_file
        if be_path.exists():
            tag = _classify_service(be_path)
            parts.append(f"prod-be: app/services/{svc_file} ({tag})")
            be_changed = True

    if req_id in REQ_TO_FE_VIEW:
        view_dir = PROD_FE_SRC / "views" / REQ_TO_FE_VIEW[req_id]
        if view_dir.exists():
            vues = list(view_dir.glob("*.vue"))
            if vues:
                names = ", ".join(p.name for p in vues)
                parts.append(f"prod-fe: frontend/src/views/{REQ_TO_FE_VIEW[req_id]}/ ({names})")
                fe_changed = True

    # CORE-04 一键求助 composable + 组件
    if req_id in REQ_TO_COMPOSABLE:
        existing = []
        for rel in REQ_TO_COMPOSABLE[req_id]:
            p = PROD_FE_SRC / rel
            if p.exists():
                existing.append(f"frontend/src/{rel}")
        if existing:
            parts.append(f"prod-fe: {', '.join(existing)}")
            fe_changed = True

    # CORE-05 傻瓜化 UI/UX 设计系统
    if req_id in REQ_TO_STYLES:
        existing = []
        for rel in REQ_TO_STYLES[req_id]:
            p = PROD_FE_SRC / rel
            if p.exists():
                existing.append(f"frontend/src/{rel}")
        if existing:
            parts.append(f"prod-fe: {', '.join(existing)}")
            fe_changed = True

    # INFRA-02 AI 引擎底座
    if req_id.startswith("INFRA-02"):
        llm_path = ROOT / "production" / "ai-engine" / "services" / "llm_service.py"
        if llm_path.exists():
            parts.append("prod-be: ai-engine/services/llm_service.py (DeepSeek chat/analyze/score)")
            be_changed = True

    if not (be_changed or fe_changed):
        return None

    if not parts:
        return None
    return " | ".join(parts)


def build_new_status(req_id: str, current_status: str) -> str | None:
    """根据代码实现程度, 推断新 Status. 返回 None 表示不更新."""
    if req_id in REQ_TO_SERVICE:
        svc_file = REQ_TO_SERVICE[req_id]
        be_path = PROD_BE_SERVICES / svc_file
        if be_path.exists():
            tag = _classify_service(be_path)
            if tag == "stub":
                return "部分实现"
            if tag == "实现":
                return "已实现(production)"
            return "部分实现"
    if req_id in REQ_TO_FE_VIEW:
        view_dir = PROD_FE_SRC / "views" / REQ_TO_FE_VIEW[req_id]
        if view_dir.exists():
            vues = list(view_dir.glob("*.vue"))
            if vues:
                # 取最大文件, >4KB 视为有实际内容
                largest = max(vues, key=lambda p: p.stat().st_size)
                if largest.stat().st_size > 4096:
                    return "部分实现"
    # CORE-04 一键求助: composable + 组件存在即部分实现
    if req_id in REQ_TO_COMPOSABLE:
        for rel in REQ_TO_COMPOSABLE[req_id]:
            if (PROD_FE_SRC / rel).exists():
                return "部分实现"
    # CORE-05 傻瓜化 UI/UX: 样式文件存在即部分实现
    if req_id in REQ_TO_STYLES:
        for rel in REQ_TO_STYLES[req_id]:
            if (PROD_FE_SRC / rel).exists():
                return "部分实现"
    if req_id.startswith("INFRA-02"):
        llm_path = ROOT / "production" / "ai-engine" / "services" / "llm_service.py"
        if llm_path.exists():
            return "部分实现"
    return None


REQ_HEADER_RE = re.compile(r"^(###\s+Requirement:\s*(.+?)\s*)$", re.MULTILINE)
STATUS_LINE_RE = re.compile(r"^>\s*\*\*Status\*\*:\s*(.+?)\s*$", re.MULTILINE)
CODEREF_LINE_RE = re.compile(r"^(>\s*\*\*Code Ref\*\*:\s*)(.+?)\s*$", re.MULTILINE)


def update_spec(text: str, dry_run: bool = True) -> tuple[str, int, list[str]]:
    """扫描并更新 spec.md 文本, 返回 (新文本, 更新条数, 报告行)."""
    matches = list(REQ_HEADER_RE.finditer(text))
    reports: list[str] = []
    update_count = 0

    for i, m in enumerate(matches):
        req_id = m.group(2).strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]

        new_status = build_new_status(req_id, "")
        new_code_ref = build_new_code_ref(req_id)

        if not new_status and not new_code_ref:
            continue

        # 在 body 范围内替换 Status / Code Ref 行
        body_updated = body

        if new_status:
            def _replace_status(match: re.Match) -> str:
                return match.group(0).replace(match.group(1), new_status)

            new_body = STATUS_LINE_RE.sub(
                lambda mm: f"> **Status**: {new_status}",
                body_updated,
                count=1,
            )
            if new_body != body_updated:
                body_updated = new_body

        if new_code_ref:
            new_body = CODEREF_LINE_RE.sub(
                lambda mm: f"{mm.group(1)}{new_code_ref}",
                body_updated,
                count=1,
            )
            if new_body != body_updated:
                body_updated = new_body

        if body_updated == body:
            continue

        text = text[:start] + body_updated + text[end:]
        # 重新计算后续 matches 的位置 (因为长度可能变了)
        matches = list(REQ_HEADER_RE.finditer(text))
        update_count += 1
        reports.append(f"  ✓ L{start}  {req_id}")
        if new_status:
            reports.append(f"      Status → {new_status}")
        if new_code_ref:
            reports.append(f"      Code Ref → {new_code_ref}")

    return text, update_count, reports


def main() -> int:
    parser = argparse.ArgumentParser(description="批量同步 spec.md Code Ref 为三列格式")
    parser.add_argument("--apply", action="store_true", help="实际写入 spec.md (默认 dry-run)")
    parser.add_argument("--spec", default=str(SPEC_PATH), help="spec.md 路径")
    args = parser.parse_args()

    spec_path = Path(args.spec)
    if not spec_path.exists():
        print(f"[ERROR] spec.md 不存在: {spec_path}", file=sys.stderr)
        return 1

    text = spec_path.read_text(encoding="utf-8")
    new_text, count, reports = update_spec(text, dry_run=not args.apply)

    print("=" * 78)
    print(f"spec.md Code Ref 三列同步 ({'APPLY' if args.apply else 'DRY-RUN'})")
    print("=" * 78)
    print(f"更新条数: {count}")
    for line in reports:
        print(line)

    if args.apply:
        spec_path.write_text(new_text, encoding="utf-8")
        print(f"\n[OK] 已写入: {spec_path}")
    else:
        print(f"\n[DRY-RUN] 未写入文件. 加 --apply 实际更新.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
