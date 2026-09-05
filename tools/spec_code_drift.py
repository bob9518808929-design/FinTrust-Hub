#!/usr/bin/env python3
"""
spec_code_drift.py — 反向扫描代码, 发现 spec.md 中未标注但实际已实现的模块

策略:
  1. 列出 production/backend/app/services/*.py 和 production/frontend/src/views/**/*.vue
  2. 对每个文件, 用文件名/路径推断 spec 对应 Requirement ID
  3. 检查 spec.md 中该 Requirement 的 Status, 若为 "未开始" 则标记为 drift
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / ".trae" / "specs" / "build-fintech-trust-hub" / "spec.md"
PROD = ROOT / "production"
PROD_BE_SERVICES = PROD / "backend" / "app" / "services"
PROD_FE_VIEWS = PROD / "frontend" / "src" / "views"


# 代码路径 → (spec 搜索关键词, 标注建议)
# 搜索关键词可以是 Requirement ID 前缀, 也可以是 Scenario 标题
PATH_TO_REQ: dict[str, tuple[str, str]] = {
    # 后端 services
    "backend/app/services/fund_service.py": ("MOD-01", "部分实现"),
    "backend/app/services/risk_service.py": ("MOD-02", "部分实现"),
    "backend/app/services/credit_service.py": ("MOD-03", "部分实现"),
    "backend/app/services/invoice_service.py": ("MOD-04", "部分实现"),
    "backend/app/services/insurance_service.py": ("MOD-05", "部分实现"),
    "backend/app/services/chain_service.py": ("MOD-08", "已实现(production)"),
    "backend/app/services/contract_service.py": ("MOD-13", "部分实现"),
    "backend/app/services/iot_service.py": ("MOD-12", "部分实现"),
    "backend/app/services/eco_service.py": ("MOD-16", "已实现(production)"),
    "backend/app/services/reform_service.py": ("MOD-16", "已实现(production)"),
    "backend/app/services/scf_service.py": ("MOD-16", "已实现(production)"),
    "backend/app/services/enterprise_service.py": ("DATA-01", "部分实现"),
    "backend/app/services/bank_service.py": ("APP-01", "部分实现"),
    "ai-engine/services/llm_service.py": ("INFRA-02", "部分实现"),
    # R5+R6 新增/扩展模块 (ROADMAP_REMAINING_V2)
    "backend/app/services/bank_aggregator_service.py": ("DATA-01", "部分实现"),
    "backend/app/services/invoice_verifier.py": ("DATA-02", "部分实现"),
    "backend/app/services/gsxt_adapter.py": ("DATA-02", "部分实现"),
    "backend/app/services/judiciary_adapter.py": ("DATA-02", "部分实现"),
    "backend/app/services/ecds_adapter.py": ("DATA-02", "部分实现"),
    "backend/app/services/ocr_service.py": ("DATA-03", "部分实现"),
    "backend/app/services/performance_score_service.py": ("MOD-06", "部分实现"),
    "backend/app/services/privacy_compute_service.py": ("MOD-07", "部分实现"),
    "backend/app/services/iot_gateway.py": ("DATA-04", "部分实现"),
    "backend/app/services/api_adapter_registry.py": ("INFRA-01", "部分实现"),
    "backend/app/services/reform_sandbox_service.py": ("INFRA-04", "部分实现"),
    "backend/app/services/multilateral_service.py": ("MOD-13", "部分实现"),
    "backend/app/services/credential_service.py": ("MOD-08", "部分实现"),
    "backend/app/services/rpa_service.py": ("INFRA-05", "部分实现"),
    "backend/app/services/fallback_engine_service.py": ("MOD-15", "部分实现"),
    "backend/app/services/five_flow_consistency_service.py": ("MOD-01", "部分实现"),
    "backend/app/services/risk_rule_engine.py": ("MOD-02", "部分实现"),
    # 前端 views
    "frontend/src/views/bank/BankWorkbenchView.vue": ("APP-01", "部分实现"),
    "frontend/src/views/enterprise/EnterpriseListView.vue": ("APP-02", "部分实现"),
    "frontend/src/views/advisor/AdvisorWorkbenchView.vue": ("APP-03", "部分实现"),
    "frontend/src/views/regulatory/RegulatorySandboxView.vue": ("APP-04", "部分实现"),
    "frontend/src/views/partner/PartnerPortalView.vue": ("APP-07", "部分实现"),
    "frontend/src/views/institution/InstitutionWorkbenchView.vue": ("APP-07", "部分实现"),
    "frontend/src/views/cockpit/CockpitView.vue": ("APP-08", "已实现(production)"),
    "frontend/src/views/scf/ScfWorkbenchView.vue": ("APP-09", "已实现(production)"),
    "frontend/src/views/fallback/FallbackConsoleView.vue": ("MOD-15", "部分实现"),
    "frontend/src/views/reform/ReformWorkbenchView.vue": ("MOD-16", "已实现(production)"),
    # ECO views → spec 中为 Scenario 标题, 用关键词定位
    "frontend/src/views/eco/EcoBurnView.vue": ("阅后即焚式零信任诊断", "部分实现"),
    "frontend/src/views/eco/EcoPricingView.vue": ("成果导向阶梯定价", "部分实现"),
    "frontend/src/views/eco/EcoRpaView.vue": ("INFRA-05 无接口适配器", "部分实现"),
    "frontend/src/views/eco/EcoCredentialView.vue": ("信用凭证", "部分实现"),
    "frontend/src/views/eco/EcoBidView.vue": ("反向竞拍融资大厅", "部分实现"),
    "frontend/src/views/eco/EcoPtsView.vue": ("积分商城", "部分实现"),
    "frontend/src/views/eco/EcoIndexView.vue": ("FinTrust 企业合规指数", "部分实现"),
    "frontend/src/views/eco/EcoGovView.vue": ("监管/政府背书催化剂", "部分实现"),
    "frontend/src/views/eco/EcoBotView.vue": ("微信/钉钉数字分身", "部分实现"),
    # Composables / Stores
    "frontend/src/composables/useCoachMark.ts": ("CORE-04", "部分实现"),
    "frontend/src/stores/alertStore.ts": ("CORE-04", "部分实现"),
    "frontend/src/styles/main.scss": ("CORE-05", "部分实现"),
}


def find_req_status(spec_text: str, keyword: str) -> tuple[str, int] | None:
    """从 spec.md 找含 keyword 的 Requirement / Scenario, 返回 (status_or_unknown, line_no)."""
    # 先按 Requirement ID 前缀查
    pat = re.compile(
        r"^###\s+Requirement:\s*(" + re.escape(keyword) + r"[^\n]*?)\s*$.*?"
        r"^>\s*\*\*Status\*\*:\s*(.+?)\s*$",
        re.MULTILINE | re.DOTALL,
    )
    m = pat.search(spec_text)
    if m:
        line_no = spec_text[:m.start()].count("\n") + 1
        return (m.group(2).strip(), line_no)

    # 找 Scenario 或独立小节 (无 Status 字段)
    scenario_pat = re.compile(
        r"^(#{3,4}\s+(?:Scenario:|Requirement:)?[^\n]*" + re.escape(keyword) + r"[^\n]*)$",
        re.MULTILINE,
    )
    m = scenario_pat.search(spec_text)
    if m:
        line_no = spec_text[:m.start()].find(keyword)
        if line_no < 0:
            line_no = m.start()
        line_no = spec_text[:line_no].count("\n") + 1
        return ("(无 Status, Scenario 形式)", line_no)

    return None


def main() -> int:
    spec_text = SPEC.read_text(encoding="utf-8")

    print("=" * 78)
    print("Spec ↔ Code 漂移检测 (反向扫描)")
    print("=" * 78)
    print(f"{'代码路径':50s}  {'关键词':15s}  {'当前状态':25s}  {'判定':10s}")
    print("-" * 110)

    drifts: list[tuple[str, str, str, str, int]] = []
    aligned = 0
    not_found = 0

    for rel_path, (keyword, expected_status) in PATH_TO_REQ.items():
        full = PROD / rel_path
        if not full.exists():
            continue

        result = find_req_status(spec_text, keyword)
        if result is None:
            print(f"{rel_path:50s}  {keyword:15s}  {'未找到':25s}  ✗ 未对齐")
            not_found += 1
            continue

        status, line_no = result
        # 判定: "未开始" 视为 drift; Scenario 形式视为部分对齐; 其他视为对齐
        if "未开始" in status:
            drifts.append((rel_path, keyword, status, expected_status, line_no))
            print(f"{rel_path:50s}  {keyword:15s}  {status:25s}  ⚠ 漂移 (L{line_no})")
        elif "Scenario" in status:
            print(f"{rel_path:50s}  {keyword:15s}  {status:25s}  ◐ Scenario 无 Status")
        else:
            aligned += 1
            print(f"{rel_path:50s}  {keyword:15s}  {status:25s}  ✓ 对齐")

    print("-" * 110)
    print(f"对齐: {aligned}  漂移: {len(drifts)}  未找到: {not_found}")
    if drifts:
        print("\n[漂移项详情] 代码已实现, 但 spec.md 标 '未开始' (建议同步为指定 Status):")
        for p, kw, cur, expected, ln in drifts:
            print(f"  L{ln}  {kw}  当前='{cur}' → 建议='{expected}'  ← {p}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
