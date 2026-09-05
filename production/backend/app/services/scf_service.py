"""供应链金融 (SCF) 引擎服务 — SC6/SC7/SC8/SC9/SC10 + 场景预设 + Reform 联动.

设计依据: spec.md SCF-05/06/08/09, simulation/js/view-scf.js.
开发期: 内存 store + 真实可信演示数据 (真实城市+行业+公司名), 零外部依赖.
生产期: A 档核心企业 ERP 数据接口回填 + SQLAlchemy 异步 ORM 替换 _ScfStore 内部存储.

关键约束 (project_memory):
    - SC6 定价: 基础 LPR + 风险溢价 - 担保抵扣, 透明可解释
    - SC7 风险扩散: 上游应收账款变坏账 + 下游预付款损失
    - SC8 撮合: 信用分匹配 + 期限匹配 + 担保偏好匹配, top-3 候选
    - SC9 履约: 绿/黄/红三色预警
    - SC10 案例: 行业/产品/规模/结果 四维分类 + 关键词相似度
    - SCF↔Reform: R10 完成事件 → SC1 画像刷新 → SC8 撮合重算
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.schemas.scf import (
    CaseQuery,
    CaseRecord,
    GuaranteeMethod,
    MatchCandidate,
    MatchInput,
    MatchOutput,
    MonitorAlert,
    MonitorStatusSummary,
    PricingInput,
    PricingOutput,
    PropagationNode,
    ReformSyncEvent,
    ReformSyncResult,
    RiskPropagationInput,
    RiskPropagationOutput,
    ScenarioId,
    ScfIndustry,
    SCFScenario,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "scf") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


# ============================================================================
# 内置演示数据 (真实可信: 真实城市 + 行业 + 公司名; A 档 ERP 接入后被覆盖)
# ============================================================================

MOCK_ENTERPRISES: list[dict] = [
    {
        "enterprise_id": "E-SZ-KC",
        "name": "深圳科创电子有限公司",
        "city": "深圳",
        "industry": "high_tech",
        "credit_score": 88,
        "scale": "medium",
        "annual_revenue": 280_000_000,   # 2.8 亿
        "is_core": True,
        "upstream": ["E-SH-WF", "E-SZ-FT"],
        "downstream": ["E-GZ-PP", "E-SZ-FX"],
        "relation_type_up": "应收账款(晶圆/封测采购)",
        "relation_type_down": "预付款(品牌商预付)",
    },
    {
        "enterprise_id": "E-SH-WF",
        "name": "上海微电子晶圆厂",
        "city": "上海",
        "industry": "manufacturing",
        "credit_score": 76,
        "scale": "large",
        "annual_revenue": 1_200_000_000,
        "is_core": False,
        "upstream": [],
        "downstream": ["E-SZ-KC"],
        "relation_type_down": "应收账款(对深圳科创)",
    },
    {
        "enterprise_id": "E-SZ-FT",
        "name": "深圳封测科技股份有限公司",
        "city": "深圳",
        "industry": "manufacturing",
        "credit_score": 72,
        "scale": "medium",
        "annual_revenue": 320_000_000,
        "is_core": False,
        "upstream": [],
        "downstream": ["E-SZ-KC"],
        "relation_type_down": "应收账款(对深圳科创)",
    },
    {
        "enterprise_id": "E-GZ-PP",
        "name": "广州品牌商贸易公司",
        "city": "广州",
        "industry": "trade",
        "credit_score": 68,
        "scale": "medium",
        "annual_revenue": 180_000_000,
        "is_core": False,
        "upstream": ["E-SZ-KC"],
        "downstream": [],
        "relation_type_up": "预付款(对深圳科创)",
    },
    {
        "enterprise_id": "E-SZ-FX",
        "name": "深圳分销集团股份",
        "city": "深圳",
        "industry": "trade",
        "credit_score": 64,
        "scale": "small",
        "annual_revenue": 95_000_000,
        "is_core": False,
        "upstream": ["E-SZ-KC"],
        "downstream": [],
        "relation_type_up": "预付款(对深圳科创)",
    },
]

MOCK_BANKS: list[dict] = [
    {
        "bank_id": "B-ICBC",
        "name": "中国工商银行深圳分行",
        "bank_product": "科创e贷",
        "base_rate": 3.85,
        "max_amount": 50_000_000,
        "min_credit_score": 70,
        "preferred_guarantee": ["guarantee", "pledge"],
        "preferred_industry": ["high_tech", "manufacturing"],
        "preferred_terms": [6, 12, 24, 36],
    },
    {
        "bank_id": "B-CMB",
        "name": "招商银行总行营业部",
        "bank_product": "供应链金融通",
        "base_rate": 4.20,
        "max_amount": 30_000_000,
        "min_credit_score": 65,
        "preferred_guarantee": ["accounts_receivable", "endorsement"],
        "preferred_industry": ["trade", "manufacturing", "high_tech"],
        "preferred_terms": [3, 6, 12, 18],
    },
    {
        "bank_id": "B-CMBC",
        "name": "中国民生银行广州分行",
        "bank_product": "应收账融资宝",
        "base_rate": 4.55,
        "max_amount": 20_000_000,
        "min_credit_score": 60,
        "preferred_guarantee": ["accounts_receivable", "inventory", "credit"],
        "preferred_industry": ["trade", "service", "logistics"],
        "preferred_terms": [3, 6, 12],
    },
]

MOCK_CASES_SEED: list[dict] = [
    {
        "case_id": "CASE-2026-0001",
        "enterprise_name": "深圳科创电子有限公司",
        "industry": "high_tech",
        "product": "reverse_factoring",
        "scale": "medium",
        "outcome": "success",
        "loan_amount": 8_000_000_00,    # 800 万 (分)
        "final_rate": 3.95,
        "duration_days": 95,
        "summary": "深圳科创电子作为核心企业, 主导反向保理, 上游 8 家小微供应商凭应收账款融资 800 万, 工商银行深圳分行授信, 全程链上确权, 逾期率 0%.",
        "key_learnings": [
            "核心企业确权是反向保理落地关键",
            "链上存证降低银行尽调成本 60%",
            "上游小微供应商融资成本从 12% 降至 4%",
        ],
        "similarity_tags": ["反向保理", "核心企业", "high_tech", "深圳", "应收账款"],
        "stored_at": "2026-05-12T08:30:00+00:00",
    },
    {
        "case_id": "CASE-2026-0002",
        "enterprise_name": "苏州新材料科技股份",
        "industry": "manufacturing",
        "product": "inventory_financing",
        "scale": "small",
        "outcome": "success",
        "loan_amount": 3_000_000_00,
        "final_rate": 5.20,
        "duration_days": 60,
        "summary": "苏州新材料小企业以 5000 万原材料存货质押, IoT 实时监管仓位与温度, 招商银行苏州分行授信 300 万, 6 个月期, 还款正常.",
        "key_learnings": [
            "IoT 监管保证押品真实可控",
            "存货估值需引入第三方评估, 避免虚高",
            "原材料价格波动需设置警戒线",
        ],
        "similarity_tags": ["存货质押", "小企业", "manufacturing", "苏州", "IoT监管"],
        "stored_at": "2026-06-03T10:15:00+00:00",
    },
    {
        "case_id": "CASE-2026-0003",
        "enterprise_name": "杭州智造机械有限公司",
        "industry": "manufacturing",
        "product": "accounts_receivable_financing",
        "scale": "medium",
        "outcome": "failed",
        "loan_amount": 12_000_000_00,
        "final_rate": 7.80,
        "duration_days": 45,
        "summary": "杭州智造机械凭对核心企业应收账款融资 1200 万, 因核心企业经营恶化拒付, 应收账款变坏账, 银行核销 30%, 平台代偿 70%.",
        "key_learnings": [
            "应收账款融资必须核验核心企业真实付款意愿",
            "核心企业拒付时保险代偿机制至关重要",
            "信用评分低于 65 时应提高风险溢价至 3%+",
        ],
        "similarity_tags": ["应收账款", "坏账", "manufacturing", "杭州", "拒付"],
        "stored_at": "2026-07-08T14:20:00+00:00",
    },
    {
        "case_id": "CASE-2026-0004",
        "enterprise_name": "北京中粮贸易集团",
        "industry": "trade",
        "product": "bill_discount",
        "scale": "large",
        "outcome": "success",
        "loan_amount": 50_000_000_00,
        "final_rate": 3.45,
        "duration_days": 90,
        "summary": "北京中粮贸易持商业承兑汇票 5000 万, 经背书链追溯 4 跳, 工商银行北京分行贴现, 综合利率 3.45%, 全程电子化背书.",
        "key_learnings": [
            "票据背书链完整追溯是贴现核心",
            "电子票据 (电票) 显著降低伪造风险",
            "大型贸易企业贴现利率可低于 LPR",
        ],
        "similarity_tags": ["票据贴现", "大企业", "trade", "北京", "背书链"],
        "stored_at": "2026-07-22T09:00:00+00:00",
    },
    {
        "case_id": "CASE-2026-0005",
        "enterprise_name": "成都农产品物流股份",
        "industry": "logistics",
        "product": "prepayment_financing",
        "scale": "small",
        "outcome": "partial",
        "loan_amount": 5_000_000_00,
        "final_rate": 6.50,
        "duration_days": 120,
        "summary": "成都农产品物流作为下游经销商, 预付 500 万采购款, 民生银行成都分行授信. 因季节性滞销, 部分预付款延迟 30 天, 触发黄灯预警后追保成功.",
        "key_learnings": [
            "预付款融资需评估下游销售周期",
            "黄灯预警时及时追加担保可避免红灯违约",
            "季节性行业预付款融资期限应灵活",
        ],
        "similarity_tags": ["预付款融资", "小企业", "logistics", "成都", "季节性"],
        "stored_at": "2026-08-05T11:45:00+00:00",
    },
]

MOCK_ALERTS_SEED: list[dict] = [
    {
        "alert_id": "ALT-2026-0001",
        "enterprise_id": "E-SZ-KC",
        "enterprise_name": "深圳科创电子有限公司",
        "contract_id": "CTR-2026-0001",
        "monitor_kind": "repayment",
        "level": "green",
        "status": "normal",
        "due_date": "2026-09-15T00:00:00+00:00",
        "amount": 8_000_000_00,
        "overdue_days": 0,
        "message": "反向保理首期还款正常, 距到期 27 天",
        "raised_at": "2026-08-19T08:00:00+00:00",
    },
    {
        "alert_id": "ALT-2026-0002",
        "enterprise_id": "E-SH-WF",
        "enterprise_name": "上海微电子晶圆厂",
        "contract_id": "CTR-2026-0002",
        "monitor_kind": "shipment",
        "level": "yellow",
        "status": "warning",
        "due_date": "2026-08-25T00:00:00+00:00",
        "amount": 3_500_000_00,
        "overdue_days": 0,
        "message": "晶圆批次发货延迟 3 天, IoT 仓位无出货信号, 请跟进",
        "raised_at": "2026-08-18T16:30:00+00:00",
    },
    {
        "alert_id": "ALT-2026-0003",
        "enterprise_id": "E-GZ-PP",
        "enterprise_name": "广州品牌商贸易公司",
        "contract_id": "CTR-2026-0003",
        "monitor_kind": "receipt",
        "level": "red",
        "status": "overdue",
        "due_date": "2026-08-10T00:00:00+00:00",
        "amount": 2_200_000_00,
        "overdue_days": 9,
        "message": "预付款回款逾期 9 天, 已触发代偿预案, 银行介入追偿",
        "raised_at": "2026-08-19T09:12:00+00:00",
    },
    {
        "alert_id": "ALT-2026-0004",
        "enterprise_id": "E-SZ-FT",
        "enterprise_name": "深圳封测科技股份有限公司",
        "contract_id": "CTR-2026-0004",
        "monitor_kind": "repayment",
        "level": "yellow",
        "status": "warning",
        "due_date": "2026-08-30T00:00:00+00:00",
        "amount": 1_800_000_00,
        "overdue_days": 0,
        "message": "封测回款账户余额仅覆盖 60%, 建议 7 日内补足",
        "raised_at": "2026-08-19T10:45:00+00:00",
    },
    {
        "alert_id": "ALT-2026-0005",
        "enterprise_id": "E-SZ-FX",
        "enterprise_name": "深圳分销集团股份",
        "contract_id": "CTR-2026-0005",
        "monitor_kind": "delivery",
        "level": "green",
        "status": "completed",
        "due_date": "2026-08-01T00:00:00+00:00",
        "amount": 950_000_00,
        "overdue_days": 0,
        "message": "分销交付完成, 履约闭环结束",
        "raised_at": "2026-08-02T08:00:00+00:00",
    },
]


# 4 个场景预设
SCENARIO_PRESETS: list[SCFScenario] = [
    SCFScenario(
        scenarioId="reverse_factoring_core",
        name="核心企业反向保理",
        description="核心企业主导反向保理, 上游小微供应商凭应收账款融资. 适合信用评分 80+ 的核心企业.",
        product="reverse_factoring",
        defaultEnterprise="E-SZ-KC",
        defaultAmount=8_000_000_00,
        defaultTermMonths=6,
        defaultGuarantee="accounts_receivable",
        prefill={
            "creditScore": 88, "industry": "high_tech",
            "guaranteeMethod": "accounts_receivable",
            "termMonths": 6, "loanAmount": 8_000_000_00,
            "loanAmountYuan": 8000000,
        },
    ),
    SCFScenario(
        scenarioId="inventory_pledge",
        name="存货质押融资",
        description="中小企业以原材料/成品存货质押融资, IoT 实时监管. 适合制造业小企业.",
        product="inventory_financing",
        defaultEnterprise="E-SH-WF",
        defaultAmount=3_000_000_00,
        defaultTermMonths=6,
        defaultGuarantee="inventory",
        prefill={
            "creditScore": 76, "industry": "manufacturing",
            "guaranteeMethod": "inventory",
            "termMonths": 6, "loanAmount": 3_000_000_00,
            "loanAmountYuan": 3000000,
        },
    ),
    SCFScenario(
        scenarioId="ar_transfer",
        name="应收账款转让",
        description="单笔应收账款直接转让, 银行买断式受让. 适合中型制造/贸易企业.",
        product="accounts_receivable_financing",
        defaultEnterprise="E-SZ-FT",
        defaultAmount=5_000_000_00,
        defaultTermMonths=3,
        defaultGuarantee="accounts_receivable",
        prefill={
            "creditScore": 72, "industry": "manufacturing",
            "guaranteeMethod": "accounts_receivable",
            "termMonths": 3, "loanAmount": 5_000_000_00,
            "loanAmountYuan": 5000000,
        },
    ),
    SCFScenario(
        scenarioId="bill_discount",
        name="票据贴现融资",
        description="商业汇票贴现, 背书链追溯. 适合大型贸易企业持票融资.",
        product="bill_discount",
        defaultEnterprise="E-GZ-PP",
        defaultAmount=10_000_000_00,
        defaultTermMonths=3,
        defaultGuarantee="endorsement",
        prefill={
            "creditScore": 68, "industry": "trade",
            "guaranteeMethod": "endorsement",
            "termMonths": 3, "loanAmount": 10_000_000_00,
            "loanAmountYuan": 10000000,
        },
    ),
]


# ============================================================================
# 内存 Store (开发期, 零外部依赖; 生产期替换为 ORM)
# ============================================================================

class _ScfStore:
    """异步内存 store (参考 reform_service._ReformStore)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cases: dict[str, dict] = {c["case_id"]: dict(c) for c in MOCK_CASES_SEED}
        self._alerts: list[dict] = [dict(a) for a in MOCK_ALERTS_SEED]
        self._credit_scores: dict[str, int] = {
            e["enterprise_id"]: e["credit_score"] for e in MOCK_ENTERPRISES
        }
        self._reform_sync_log: list[dict] = []

    async def list_cases(self) -> list[dict]:
        async with self._lock:
            return [dict(c) for c in self._cases.values()]

    async def add_case(self, case: dict) -> dict:
        async with self._lock:
            self._cases[case["case_id"]] = dict(case)
            return dict(case)

    async def list_alerts(self) -> list[dict]:
        async with self._lock:
            return [dict(a) for a in self._alerts]

    async def get_credit_score(self, eid: str) -> int | None:
        async with self._lock:
            return self._credit_scores.get(eid)

    async def set_credit_score(self, eid: str, score: int) -> None:
        async with self._lock:
            self._credit_scores[eid] = max(0, min(100, score))

    async def add_sync_log(self, log: dict) -> None:
        async with self._lock:
            self._reform_sync_log.append(dict(log))

    async def upsert_enterprise(self, enterprise: dict) -> dict:
        """A 档 ERP 数据回填: 更新/插入企业画像 (信用分同步刷新)."""
        async with self._lock:
            eid = enterprise.get("enterprise_id", "")
            if not eid:
                return {"error": "enterprise_id 缺失"}
            _ERP_ENTERPRISES[eid] = dict(enterprise)
            if "credit_score" in enterprise:
                score = int(enterprise["credit_score"])
                self._credit_scores[eid] = max(0, min(100, score))
            return dict(enterprise)


# A 档 ERP 接入后的企业画像覆盖层 (优先于内置演示数据)
_ERP_ENTERPRISES: dict[str, dict] = {}

_scf_store = _ScfStore()


# ============================================================================
# SCF 引擎服务
# ============================================================================

# 担保抵扣表 (不同担保方式对应抵扣 bp)
_GUARANTEE_DISCOUNT_BP: dict[GuaranteeMethod, float] = {
    "credit": 0.0,
    "endorsement": 0.15,
    "guarantee": 0.30,
    "pledge": 0.45,
    "accounts_receivable": 0.55,
    "inventory": 0.60,
}

# 行业风险溢价 (bp)
_INDUSTRY_RISK_BP: dict[ScfIndustry, float] = {
    "high_tech": 0.30,
    "manufacturing": 0.55,
    "trade": 0.80,
    "service": 0.70,
    "logistics": 0.95,
    "agriculture": 1.20,
    "energy": 0.65,
    "real_estate_related": 1.50,
}


class ScfService:
    """SCF 引擎服务 (SC6-SC10 + 场景预设 + Reform 联动).

    异步降级模式 (对齐 reform_service):
        - driver/DB 不可用时降级到内存 store (_scf_store)
        - 不抛异常, 保证 API 可用
    """

    def __init__(self, db: Any = None) -> None:
        self.db = db  # 生产期注入 AsyncSession; 开发期为 None, 走内存

    # === SC6 定价引擎 ===

    async def pricing(self, inp: PricingInput) -> PricingOutput:
        """SC6 综合定价.

        公式: final_rate = base_lpr + risk_premium - collateral_discount
            risk_premium = base_risk(信用分) + industry_risk + term_risk
            collateral_discount = 担保方式抵扣 (bp)
        """
        # 信用分 → 基础风险溢价 (信用分越低, 溢价越高)
        # 信用 100 → 0bp, 信用 60 → 1.5%, 信用 30 → 4.5%
        credit = inp.credit_score
        credit_risk_bp = max(0.0, (90 - credit) * 0.06)  # 每 1 分下降加 0.06bp

        industry_risk_bp = _INDUSTRY_RISK_BP.get(inp.industry, 0.80)

        # 期限溢价: 12 个月以上每多 12 个月加 0.10bp
        term_risk_bp = max(0.0, (inp.term_months - 12) / 12.0) * 0.10 if inp.term_months > 12 else 0.0

        risk_premium = credit_risk_bp + industry_risk_bp + term_risk_bp

        collateral_discount = _GUARANTEE_DISCOUNT_BP.get(inp.guarantee_method, 0.0)

        final_rate = max(inp.base_lpr, inp.base_lpr + risk_premium - collateral_discount)

        # 年利息 = 贷款金额 × final_rate / 100 (金额单位: 分, 利率: %)
        annual_interest = int(inp.loan_amount * final_rate / 100.0)

        breakdown = {
            "creditRiskBp": round(credit_risk_bp, 4),
            "industryRiskBp": round(industry_risk_bp, 4),
            "termRiskBp": round(term_risk_bp, 4),
            "guaranteeDiscountBp": round(collateral_discount, 4),
            "creditScoreBucket": "premium" if credit >= 80 else "normal" if credit >= 65 else "high_risk" if credit >= 50 else "distress",
            "formula": f"finalRate = baseLpr({inp.base_lpr}) + riskPremium({round(risk_premium, 4)}) - collateralDiscount({round(collateral_discount, 4)})",
        }

        return PricingOutput(
            enterpriseId=inp.enterprise_id,
            baseRate=round(inp.base_lpr, 4),
            riskPremium=round(risk_premium, 4),
            collateralDiscount=round(collateral_discount, 4),
            finalRate=round(final_rate, 4),
            annualInterest=annual_interest,
            breakdown=breakdown,
            computedAt=_now_iso(),
        )

    # === SC7 风险扩散引擎 ===

    async def propagate_risk(self, inp: RiskPropagationInput) -> RiskPropagationOutput:
        """SC7 风险扩散.

        核心企业违约 → 上游应收账款变坏账 → 下游预付款损失
        每跳衰减 50% (一跳传播 50%, 二跳 25%, 三跳 12.5%...)
        """
        # 找根企业
        root = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == inp.root_enterprise_id), None)
        root_name = root["name"] if root else inp.root_enterprise_id

        propagation_tree: list[PropagationNode] = []

        # 根节点
        propagation_tree.append(PropagationNode(
            enterpriseId=inp.root_enterprise_id,
            enterpriseName=root_name,
            direction="upstream",
            hop=0,
            exposureAmount=inp.shock_amount,
            lossGivenDefault=int(inp.shock_amount * 0.6),
            propagationRatio=1.0,
            relationType="根节点(违约源)",
            severity="critical",
        ))

        # BFS 传播 N 跳
        visited = {inp.root_enterprise_id}
        current_layer = [inp.root_enterprise_id]
        shock_per_node = inp.shock_amount

        for hop in range(1, inp.hops + 1):
            decay = 0.5 ** hop  # 每跳衰减 50%
            next_layer: list[str] = []
            for ent_id in current_layer:
                ent = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == ent_id), None)
                if not ent:
                    continue
                # 上游传播: 应收账款变坏账
                for up_id in ent.get("upstream", []):
                    if up_id in visited:
                        continue
                    up_ent = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == up_id), None)
                    if not up_ent:
                        continue
                    visited.add(up_id)
                    next_layer.append(up_id)
                    exposure = int(shock_per_node * decay)
                    # 上游损失率较高 (应收账款全额坏账风险)
                    loss = int(exposure * 0.85)
                    propagation_tree.append(PropagationNode(
                        enterpriseId=up_id,
                        enterpriseName=up_ent["name"],
                        direction="upstream",
                        hop=hop,
                        exposureAmount=exposure,
                        lossGivenDefault=loss,
                        propagationRatio=round(decay, 4),
                        relationType=ent.get("relation_type_up", "应收账款"),
                        severity="high" if hop == 1 else "medium",
                    ))
                # 下游传播: 预付款损失
                for down_id in ent.get("downstream", []):
                    if down_id in visited:
                        continue
                    down_ent = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == down_id), None)
                    if not down_ent:
                        continue
                    visited.add(down_id)
                    next_layer.append(down_id)
                    exposure = int(shock_per_node * decay)
                    # 下游预付款损失率较低 (通常 50%)
                    loss = int(exposure * 0.50)
                    propagation_tree.append(PropagationNode(
                        enterpriseId=down_id,
                        enterpriseName=down_ent["name"],
                        direction="downstream",
                        hop=hop,
                        exposureAmount=exposure,
                        lossGivenDefault=loss,
                        propagationRatio=round(decay, 4),
                        relationType=ent.get("relation_type_down", "预付款"),
                        severity="high" if hop == 1 else "low",
                    ))
            current_layer = next_layer
            if not current_layer:
                break

        total_exposure = sum(n.exposure_amount for n in propagation_tree)
        total_loss = sum(n.loss_given_default for n in propagation_tree)
        affected = len([n for n in propagation_tree if n.hop > 0])

        return RiskPropagationOutput(
            rootEnterpriseId=inp.root_enterprise_id,
            rootEnterpriseName=root_name,
            hops=inp.hops,
            totalExposure=total_exposure,
            totalLoss=total_loss,
            affectedCount=affected,
            propagationTree=[n.model_dump(by_alias=True) for n in propagation_tree],
            computedAt=_now_iso(),
        )

    # === SC8 撮合引擎 ===

    async def match(self, inp: MatchInput) -> MatchOutput:
        """SC8 双向撮合 (top-K).

        匹配维度: 信用分匹配 + 期限匹配 + 担保偏好匹配
        置信度 = w1*credit_match + w2*term_match + w3*guarantee_match
        """
        ent = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == inp.enterprise_id), None)
        ent_name = ent["name"] if ent else inp.enterprise_id

        candidates: list[tuple[float, dict, list[str], list[str]]] = []
        for bank in MOCK_BANKS:
            reasons: list[str] = []
            mismatches: list[str] = []

            # 1) 信用分匹配 (权重 0.5)
            min_score = bank["min_credit_score"]
            if inp.credit_score >= min_score + 15:
                credit_match = 1.0
                reasons.append(f"信用分 {inp.credit_score} 远超银行阈值 {min_score}")
            elif inp.credit_score >= min_score:
                credit_match = 0.8
                reasons.append(f"信用分 {inp.credit_score} 达到银行阈值 {min_score}")
            else:
                credit_match = 0.3
                mismatches.append(f"信用分 {inp.credit_score} 低于银行阈值 {min_score}")

            # 2) 期限匹配 (权重 0.2)
            if inp.term_months in bank["preferred_terms"]:
                term_match = 1.0
                reasons.append(f"期限 {inp.term_months} 月符合银行偏好")
            else:
                # 找最接近的期限
                closest = min(bank["preferred_terms"], key=lambda t: abs(t - inp.term_months))
                if abs(closest - inp.term_months) <= 6:
                    term_match = 0.6
                    reasons.append(f"期限 {inp.term_months} 月接近银行偏好 {closest} 月")
                else:
                    term_match = 0.3
                    mismatches.append(f"期限 {inp.term_months} 月偏离银行偏好")

            # 3) 担保偏好匹配 (权重 0.3)
            if inp.guarantee_preference in bank["preferred_guarantee"]:
                guarantee_match = 1.0
                reasons.append(f"担保方式 {inp.guarantee_preference} 符合银行偏好")
            else:
                guarantee_match = 0.5
                mismatches.append(f"担保方式 {inp.guarantee_preference} 非银行首选")

            # 行业加分
            industry_bonus = 0.0
            if inp.industry in bank["preferred_industry"]:
                industry_bonus = 0.05
                reasons.append(f"行业 {inp.industry} 为银行重点支持行业")

            confidence = min(1.0, 0.5 * credit_match + 0.2 * term_match + 0.3 * guarantee_match + industry_bonus)

            # 过滤掉低置信度候选 (< 0.4)
            if confidence < 0.4:
                continue

            candidates.append((confidence, bank, reasons, mismatches))

        # 排序取 top-K
        candidates.sort(key=lambda x: x[0], reverse=True)
        top = candidates[: inp.top_k]

        result_candidates: list[MatchCandidate] = []
        for confidence, bank, reasons, mismatches in top:
            # 核准额度 = min(请求金额, 银行最大额度)
            approved_amount = min(inp.loan_amount, bank["max_amount"] * 100)  # 元 → 分
            # 核准利率 = base_rate + 信用分调整
            credit_adj = max(0.0, (70 - inp.credit_score) * 0.02) if inp.credit_score < 70 else 0.0
            approved_rate = round(bank["base_rate"] + credit_adj, 4)

            result_candidates.append(MatchCandidate(
                enterpriseId=inp.enterprise_id,
                enterpriseName=ent_name,
                bankId=bank["bank_id"],
                bankName=bank["name"],
                bankProduct=bank["bank_product"],
                approvedAmount=approved_amount,
                approvedRate=approved_rate,
                termMonths=inp.term_months,
                confidence=round(confidence, 4),
                matchReasons=reasons,
                mismatches=mismatches,
            ))

        return MatchOutput(
            enterpriseId=inp.enterprise_id,
            candidates=[c.model_dump(by_alias=True) for c in result_candidates],
            computedAt=_now_iso(),
        )

    # === SC9 履约监控引擎 ===

    async def list_alerts(self) -> tuple[list[MonitorAlert], MonitorStatusSummary]:
        """SC9 履约告警列表 + 汇总."""
        data = await _scf_store.list_alerts()
        alerts = [MonitorAlert.model_validate(d) for d in data]

        green = sum(1 for a in alerts if a.level == "green")
        yellow = sum(1 for a in alerts if a.level == "yellow")
        red = sum(1 for a in alerts if a.level == "red")
        at_risk = sum(a.amount for a in alerts if a.level in ("yellow", "red"))

        summary = MonitorStatusSummary(
            total=len(alerts),
            greenCount=green,
            yellowCount=yellow,
            redCount=red,
            totalAtRiskAmount=at_risk,
        )
        return alerts, summary

    # === SC10 案例学习引擎 ===

    async def list_cases(self, query: CaseQuery | None = None) -> list[CaseRecord]:
        """SC10 案例库检索 (行业/产品/规模/结果 + 关键词)."""
        data = await _scf_store.list_cases()
        result: list[CaseRecord] = []
        for d in data:
            try:
                case = CaseRecord.model_validate(d)
            except Exception:
                continue
            if query:
                if query.industry and case.industry != query.industry:
                    continue
                if query.product and case.product != query.product:
                    continue
                if query.scale and case.scale != query.scale:
                    continue
                if query.outcome and case.outcome != query.outcome:
                    continue
                if query.keyword:
                    kw = query.keyword.lower()
                    if (kw not in case.summary.lower()
                            and not any(kw in t.lower() for t in case.similarity_tags)
                            and kw not in case.enterprise_name.lower()):
                        continue
            result.append(case)
        return result

    async def save_case(self, case: CaseRecord) -> CaseRecord:
        """SC10 沉淀新案例.

        store 内部统一存 snake_case 字段 (与 MOCK_CASES_SEED 对齐),
        序列化给前端时由 API 层 model_dump(by_alias=True) 转 camelCase.
        """
        await _scf_store.add_case(case.model_dump(by_alias=False))
        return case

    # === 场景预设 (SCF-08) ===

    async def list_scenarios(self) -> list[SCFScenario]:
        """列出 4 个场景预设."""
        return list(SCENARIO_PRESETS)

    async def load_scenario(self, scenario_id: ScenarioId) -> SCFScenario | None:
        """加载场景预设, 返回 prefill 字段供前端填表."""
        for s in SCENARIO_PRESETS:
            if s.scenario_id == scenario_id:
                return s
        return None

    # === SCF ↔ Reform 联动 (SCF-09) ===

    async def sync_from_reform(self, event: ReformSyncEvent) -> ReformSyncResult:
        """接收 reform 完成事件, 触发 SC1 画像刷新 + SC8 撮合重算.

        逻辑:
            1. 用 after_credit_score 更新企业信用评分 (SC1 画像核心字段)
            2. 自动触发 SC8 撮合重算 (基于新信用分)
            3. 返回新撮合候选数
        """
        # 1) 更新企业信用分 (SC1 画像核心字段刷新)
        await _scf_store.set_credit_score(event.enterprise_id, event.after_credit_score)

        # 2) 触发 SC8 撮合重算
        ent = next((e for e in MOCK_ENTERPRISES if e["enterprise_id"] == event.enterprise_id), None)
        new_candidates_count = 0
        rematch_triggered = False
        if ent:
            match_inp = MatchInput(
                enterpriseId=event.enterprise_id,
                creditScore=event.after_credit_score,
                loanAmount=ent["annual_revenue"] // 10 * 100,  # 默认授信额度
                termMonths=12,
                guaranteePreference="accounts_receivable",
                industry=ent["industry"],
                topK=3,
            )
            match_out = await self.match(match_inp)
            new_candidates_count = len(match_out.candidates)
            rematch_triggered = True

        await _scf_store.add_sync_log({
            "enterpriseId": event.enterprise_id,
            "reformCaseId": event.reform_case_id,
            "afterLevel": event.after_level,
            "afterCreditScore": event.after_credit_score,
            "rematchTriggered": rematch_triggered,
            "newCandidatesCount": new_candidates_count,
            "syncedAt": _now_iso(),
        })

        message = (
            f"企业 {event.enterprise_id} 改造完成 (等级 {event.after_level}, "
            f"信用分 {event.after_credit_score}); SC1 画像已刷新, "
            f"SC8 撮合重算返回 {new_candidates_count} 个候选"
        )

        return ReformSyncResult(
            enterpriseId=event.enterprise_id,
            portraitRefreshed=True,
            newCreditScore=event.after_credit_score,
            rematchTriggered=rematch_triggered,
            newCandidatesCount=new_candidates_count,
            message=message,
        )

    # === A 档核心企业 ERP 数据接口 ===

    _ERP_API_TIMEOUT_SECONDS = 10.0

    async def fetch_and_sync_erp_data(self, enterprise_id: str) -> dict:
        """核心企业 ERP 数据回填 (SC1 画像 / SC8 撮合数据源).

        A 档: 配置 ERP_DATA_API_URL / ERP_DATA_API_KEY 后拉取核心企业
        ERP 画像 (营收/信用分/上下游关系) 并覆盖内置演示数据;
        无凭证 / API 不可达时返回 skipped, 内置演示数据继续兜底.
        """
        import os

        api_url = os.getenv("ERP_DATA_API_URL", "")
        api_key = os.getenv("ERP_DATA_API_KEY", "")
        if not (api_url and api_key):
            return {
                "enterprise_id": enterprise_id,
                "status": "skipped",
                "reason": "ERP_DATA_API_URL / ERP_DATA_API_KEY 未配置",
            }
        try:
            import httpx
            async with httpx.AsyncClient(timeout=self._ERP_API_TIMEOUT_SECONDS) as client:
                resp = await client.get(
                    f"{api_url.rstrip('/')}/enterprises/{enterprise_id}/scf-profile",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if resp.status_code != 200:
                    return {
                        "enterprise_id": enterprise_id,
                        "status": "failed",
                        "reason": f"ERP API 非 200: {resp.status_code}",
                    }
                profile = resp.json()
        except Exception as exc:
            return {"enterprise_id": enterprise_id, "status": "failed", "reason": str(exc)}
        saved = await _scf_store.upsert_enterprise(profile)
        return {
            "enterprise_id": enterprise_id,
            "status": "synced",
            "portrait": {
                "name": saved.get("name", ""),
                "credit_score": saved.get("credit_score"),
                "upstream_count": len(saved.get("upstream") or []),
                "downstream_count": len(saved.get("downstream") or []),
            },
            "synced_at": _now_iso(),
        }


# 模块级单例 (对齐 reform_service = ReformService(db=None))
scf_service = ScfService(db=None)
