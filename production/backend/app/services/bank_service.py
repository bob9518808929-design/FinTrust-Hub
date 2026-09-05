"""银行信任培育期渐进解锁服务 (CORE-01b).

设计依据: spec.md "零机构接入时系统仍能独立运行" — 银行接入是增量而非前提.
四阶段渐进解锁:
    L4_READONLY    培育期 (0-6 月)  AI 仅生成风险提示函, 零拦截, 全人工
    L3_ADVISORY    验证期 (6-12 月) AI 可建议拦截, 仍需人工确认
    L2_SMALL_AUTO  信任期 (12-24 月) AI 自动放行 <50 万, 大额仍需人工
    L1_FULL_AUTO   深度信任期 (24+ 月) AI 全自动, 仅事后审计

降级策略: 内存 store (参考 reform_service.py); DB 不可用时自动兜底.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.schemas.bank import (
    BankDecision,
    BankListItem,
    BankStatistics,
    BankTrustProfile,
    BankTrustStage,
    CreditMultiplierResult,
    FreezeAccountResult,
    RiskLetter,
    StageUpgradeResult,
    SupervisionAccount,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "bnk") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


# === 阶段阈值 (升级判定) ===
# 培育期 → 验证期: 6 月 + 至少 5 笔决策 + AI 建议采纳率 >= 60%
# 验证期 → 信任期: 12 月 + 至少 20 笔决策 + 采纳率 >= 70%
# 信任期 → 全自动: 24 月 + 至少 50 笔决策 + 采纳率 >= 80%

_STAGE_THRESHOLDS: dict[BankTrustStage, dict[str, Any]] = {
    BankTrustStage.L4_READONLY: {
        "next": BankTrustStage.L3_ADVISORY,
        "min_months": 6,
        "min_decisions": 5,
        "min_conversion_rate": 0.60,
    },
    BankTrustStage.L3_ADVISORY: {
        "next": BankTrustStage.L2_SMALL_AUTO,
        "min_months": 12,
        "min_decisions": 20,
        "min_conversion_rate": 0.70,
    },
    BankTrustStage.L2_SMALL_AUTO: {
        "next": BankTrustStage.L1_FULL_AUTO,
        "min_months": 24,
        "min_decisions": 50,
        "min_conversion_rate": 0.80,
    },
    BankTrustStage.L1_FULL_AUTO: {
        "next": BankTrustStage.L1_FULL_AUTO,
        "min_months": 0,
        "min_decisions": 0,
        "min_conversion_rate": 0.0,
    },
}

_STAGE_DESCRIPTIONS: dict[BankTrustStage, str] = {
    BankTrustStage.L4_READONLY: "培育期 (0-6 月): AI 仅生成《风险提示函》零拦截, 全人工决策",
    BankTrustStage.L3_ADVISORY: "验证期 (6-12 月): AI 可发建议拦截, 仍需人工确认",
    BankTrustStage.L2_SMALL_AUTO: "信任期 (12-24 月): AI 自动放行 <50 万小额, 大额仍需人工",
    BankTrustStage.L1_FULL_AUTO: "深度信任期 (24+ 月): AI 全自动决策, 仅事后审计",
}


# ============================================================================
# 内存状态 (开发期, 参考 reform_service._ReformStore 模式)
# ============================================================================

class _BankStore:
    """内存兜底数据 (C 档独立兜底, 后端无 DB 时返回)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # bank_id -> profile dict (含统计字段)
        self._profiles: dict[str, dict] = {}
        # letter_id -> RiskLetter dict (按 bank_id 索引)
        self._letters: dict[str, dict] = {}
        # decision_id -> BankDecision dict
        self._decisions: dict[str, dict] = {}
        # APP-01: account_id -> supervision account dict (含 bankId 索引)
        self._supervision_accounts: dict[str, dict] = {}
        # APP-01: bank_id -> {base_credit_limit_cents, multiplier}
        self._credit_states: dict[str, dict] = {}
        # 初始化种子数据
        self._seed()

    def _seed(self) -> None:
        """内置 mock: 至少 2 家银行 (不同阶段) + 至少 5 条风险提示函."""
        # 银行 1: 深圳发展银行, 培育期 (L4)
        bank1_id = "BANK-SDB"
        self._profiles[bank1_id] = {
            "bankId": bank1_id,
            "bankName": "深圳发展银行",
            "stage": BankTrustStage.L4_READONLY.value,
            "joinedMonths": 3,
            "totalApprovedCount": 3,
            "aiAutoApprovedCount": 0,
            "aiBlockedCount": 0,
            "conversionRate": 0.0,
            "nextStageUnlockProgress": 0.45,
            "stageDescription": _STAGE_DESCRIPTIONS[BankTrustStage.L4_READONLY],
        }
        # 银行 2: 杭州银行, 验证期 (L3)
        bank2_id = "BANK-HZB"
        self._profiles[bank2_id] = {
            "bankId": bank2_id,
            "bankName": "杭州银行",
            "stage": BankTrustStage.L3_ADVISORY.value,
            "joinedMonths": 9,
            "totalApprovedCount": 18,
            "aiAutoApprovedCount": 0,
            "aiBlockedCount": 4,
            "conversionRate": 0.66,
            "nextStageUnlockProgress": 0.72,
            "stageDescription": _STAGE_DESCRIPTIONS[BankTrustStage.L3_ADVISORY],
        }
        # 银行 3: 招商银行, 信任期 (L2)
        bank3_id = "BANK-CMB"
        self._profiles[bank3_id] = {
            "bankId": bank3_id,
            "bankName": "招商银行",
            "stage": BankTrustStage.L2_SMALL_AUTO.value,
            "joinedMonths": 16,
            "totalApprovedCount": 42,
            "aiAutoApprovedCount": 12,
            "aiBlockedCount": 6,
            "conversionRate": 0.78,
            "nextStageUnlockProgress": 0.55,
            "stageDescription": _STAGE_DESCRIPTIONS[BankTrustStage.L2_SMALL_AUTO],
        }

        # 风险提示函种子 (至少 5 条, 覆盖银行 1 和 2)
        now = _now_iso()
        seed_letters = [
            {
                "letterId": "LTR-2026-0001", "bankId": bank1_id,
                "enterpriseId": "E001", "enterpriseName": "深圳科创电子",
                "riskLevel": "medium",
                "summary": "企业近 3 个月营收环比下滑 12%, 应收账款周转天数延长至 78 天",
                "recommendations": ["建议补充 6 个月还款来源说明", "加强货物流水监控"],
                "generatedAt": now,
            },
            {
                "letterId": "LTR-2026-0002", "bankId": bank1_id,
                "enterpriseId": "E002", "enterpriseName": "杭州智造机械",
                "riskLevel": "high",
                "summary": "责任链完整度仅 42%, 信用等级 C, 资金水位偏低 32%",
                "recommendations": ["建议暂缓大额授信", "要求企业先完成 R0-R3 改造阶段"],
                "generatedAt": now,
            },
            {
                "letterId": "LTR-2026-0003", "bankId": bank1_id,
                "enterpriseId": "E003", "enterpriseName": "苏州新材料股份",
                "riskLevel": "low",
                "summary": "8 维评分卡 B+ 级, 责任链完整度 88%, 五流验证通过",
                "recommendations": ["可正常推进授信流程", "建议关注 IoT 实时监测数据"],
                "generatedAt": now,
            },
            {
                "letterId": "LTR-2026-0004", "bankId": bank2_id,
                "enterpriseId": "E004", "enterpriseName": "广州新能源科技",
                "riskLevel": "medium",
                "summary": "政策匹配度下降至 65%, 主要原材料价格波动剧烈",
                "recommendations": ["建议分批放款", "锁定原材料远期合约"],
                "generatedAt": now,
            },
            {
                "letterId": "LTR-2026-0005", "bankId": bank2_id,
                "enterpriseId": "E001", "enterpriseName": "深圳科创电子",
                "riskLevel": "low",
                "summary": "跨境订单增长 35%, 责任链完整度提升至 92%",
                "recommendations": ["可纳入 L2 小额自动放行池", "建议持续监控外汇敞口"],
                "generatedAt": now,
            },
            {
                "letterId": "LTR-2026-0006", "bankId": bank3_id,
                "enterpriseId": "E002", "enterpriseName": "杭州智造机械",
                "riskLevel": "high",
                "summary": "改造后信用回升, 但仍需观察 3 个月责任链稳定性",
                "recommendations": ["仅小额可自动放行", "大额保持人工审批"],
                "generatedAt": now,
            },
        ]
        for letter in seed_letters:
            self._letters[letter["letterId"]] = dict(letter)

        # 决策日志种子 (amount 单位: 分, 50 万阈值 = 50,000,000 分)
        seed_decisions = [
            {
                "decisionId": "DEC-2026-0001", "bankId": bank1_id,
                "enterpriseId": "E001", "enterpriseName": "深圳科创电子",
                "amount": 800_000_000,  # 800 万元
                "aiRecommendation": "review",
                "bankFinalDecision": "approve",
                "autoHandled": False,
                "stage": BankTrustStage.L4_READONLY.value,
                "reason": "培育期全人工, AI 仅生成提示函",
                "decidedAt": now,
            },
            {
                "decisionId": "DEC-2026-0002", "bankId": bank2_id,
                "enterpriseId": "E004", "enterpriseName": "广州新能源科技",
                "amount": 350_000_000,  # 350 万元
                "aiRecommendation": "approve",
                "bankFinalDecision": "approve",
                "autoHandled": False,
                "stage": BankTrustStage.L3_ADVISORY.value,
                "reason": "验证期 AI 建议, 人工确认通过",
                "decidedAt": now,
            },
            {
                "decisionId": "DEC-2026-0003", "bankId": bank3_id,
                "enterpriseId": "E003", "enterpriseName": "苏州新材料股份",
                "amount": 30_000_000,  # 30 万元 (<50 万, L2 自动放行)
                "aiRecommendation": "approve",
                "bankFinalDecision": "approve",
                "autoHandled": True,
                "stage": BankTrustStage.L2_SMALL_AUTO.value,
                "reason": "信任期 <50 万自动放行",
                "decidedAt": now,
            },
            {
                "decisionId": "DEC-2026-0004", "bankId": bank3_id,
                "enterpriseId": "E002", "enterpriseName": "杭州智造机械",
                "amount": 100_000_000,  # 100 万元 (>50 万, L2 大额仍需人工)
                "aiRecommendation": "review",
                "bankFinalDecision": "reject",
                "autoHandled": False,
                "stage": BankTrustStage.L2_SMALL_AUTO.value,
                "reason": "信任期大额仍需人工, 银行最终拒绝",
                "decidedAt": now,
            },
        ]
        for dec in seed_decisions:
            self._decisions[dec["decisionId"]] = dict(dec)

        # APP-01 监管账户种子 (脱敏账户号, 余额单位: 分)
        # 为现有 3 家银行 + BA001/BA002/BA003 别名各预生成 2-3 个账户
        now_sv = _now_iso()
        seed_supervision_accounts = [
            # BANK-SDB (深圳发展银行, 培育期)
            {
                "accountId": "****001", "bankId": bank1_id,
                "status": "active", "balanceCents": 50_000_000,  # 50 万元
                "enterpriseId": "E001", "enterpriseName": "深圳**电子",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****002", "bankId": bank1_id,
                "status": "frozen", "balanceCents": 12_000_000,  # 12 万元
                "enterpriseId": "E002", "enterpriseName": "杭州**机械",
                "lastOperationAt": now_sv,
            },
            # BANK-HZB (杭州银行, 验证期)
            {
                "accountId": "****003", "bankId": bank2_id,
                "status": "active", "balanceCents": 88_000_000,  # 88 万元
                "enterpriseId": "E004", "enterpriseName": "广州**科技",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****004", "bankId": bank2_id,
                "status": "active", "balanceCents": 35_000_000,  # 35 万元
                "enterpriseId": "E001", "enterpriseName": "深圳**电子",
                "lastOperationAt": now_sv,
            },
            # BANK-CMB (招商银行, 信任期)
            {
                "accountId": "****005", "bankId": bank3_id,
                "status": "active", "balanceCents": 120_000_000,  # 120 万元
                "enterpriseId": "E003", "enterpriseName": "苏州**股份",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****006", "bankId": bank3_id,
                "status": "frozen", "balanceCents": 8_000_000,  # 8 万元
                "enterpriseId": "E002", "enterpriseName": "杭州**机械",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****007", "bankId": bank3_id,
                "status": "active", "balanceCents": 200_000_000,  # 200 万元
                "enterpriseId": "E004", "enterpriseName": "广州**科技",
                "lastOperationAt": now_sv,
            },
            # BA001 别名 (供前端联调/测试)
            {
                "accountId": "****001", "bankId": "BA001",
                "status": "active", "balanceCents": 100_000_000,  # 100 万元
                "enterpriseId": "E001", "enterpriseName": "深圳**电子",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****002", "bankId": "BA001",
                "status": "frozen", "balanceCents": 30_000_000,  # 30 万元
                "enterpriseId": "E002", "enterpriseName": "杭州**机械",
                "lastOperationAt": now_sv,
            },
            # BA002 别名
            {
                "accountId": "****001", "bankId": "BA002",
                "status": "active", "balanceCents": 75_000_000,  # 75 万元
                "enterpriseId": "E003", "enterpriseName": "苏州**股份",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****002", "bankId": "BA002",
                "status": "active", "balanceCents": 42_000_000,  # 42 万元
                "enterpriseId": "E004", "enterpriseName": "广州**科技",
                "lastOperationAt": now_sv,
            },
            # BA003 别名
            {
                "accountId": "****001", "bankId": "BA003",
                "status": "active", "balanceCents": 150_000_000,  # 150 万元
                "enterpriseId": "E001", "enterpriseName": "深圳**电子",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****002", "bankId": "BA003",
                "status": "active", "balanceCents": 60_000_000,  # 60 万元
                "enterpriseId": "E002", "enterpriseName": "杭州**机械",
                "lastOperationAt": now_sv,
            },
            {
                "accountId": "****003", "bankId": "BA003",
                "status": "frozen", "balanceCents": 18_000_000,  # 18 万元
                "enterpriseId": "E003", "enterpriseName": "苏州**股份",
                "lastOperationAt": now_sv,
            },
        ]
        for acc in seed_supervision_accounts:
            # account_id 在同一 bank 内唯一, 用复合键避免跨行冲突
            key = f"{acc['bankId']}:{acc['accountId']}"
            self._supervision_accounts[key] = dict(acc)

        # APP-01 授信乘数种子 (默认 1.0, 基础授信额度单位: 分)
        # 基础额度 = 乘数=1.0 时的授信额度; 当前额度 = base * multiplier
        seed_credit_states = {
            bank1_id: {"baseCreditLimitCents": 80_000_000, "multiplier": 1.0},   # 80 万元
            bank2_id: {"baseCreditLimitCents": 120_000_000, "multiplier": 1.0},  # 120 万元
            bank3_id: {"baseCreditLimitCents": 300_000_000, "multiplier": 1.0},  # 300 万元
            "BA001": {"baseCreditLimitCents": 100_000_000, "multiplier": 1.0},   # 100 万元
            "BA002": {"baseCreditLimitCents": 90_000_000, "multiplier": 1.0},    # 90 万元
            "BA003": {"baseCreditLimitCents": 200_000_000, "multiplier": 1.0},   # 200 万元
        }
        for bid, state in seed_credit_states.items():
            self._credit_states[bid] = dict(state)

    async def get_profile(self, bank_id: str) -> dict | None:
        async with self._lock:
            p = self._profiles.get(bank_id)
            return dict(p) if p else None

    async def list_profiles(self) -> list[dict]:
        async with self._lock:
            return [dict(p) for p in self._profiles.values()]

    async def upsert_profile(self, bank_id: str, profile: dict) -> dict:
        async with self._lock:
            self._profiles[bank_id] = dict(profile)
            return dict(profile)

    async def list_letters(self, bank_id: str, enterprise_id: str | None = None) -> list[dict]:
        async with self._lock:
            letters = [l for l in self._letters.values() if l.get("bankId") == bank_id]
            if enterprise_id:
                letters = [l for l in letters if l.get("enterpriseId") == enterprise_id]
            return [dict(l) for l in letters]

    async def add_letter(self, letter: dict) -> dict:
        async with self._lock:
            self._letters[letter["letterId"]] = dict(letter)
            return dict(letter)

    async def list_decisions(self, bank_id: str) -> list[dict]:
        async with self._lock:
            decs = [d for d in self._decisions.values() if d.get("bankId") == bank_id]
            return [dict(d) for d in decs]

    async def add_decision(self, decision: dict) -> dict:
        async with self._lock:
            self._decisions[decision["decisionId"]] = dict(decision)
            return dict(decision)

    # === APP-01 监管账户 + 授信乘数 (C 档独立兜底) ===

    async def list_supervision_accounts(self, bank_id: str) -> list[dict]:
        """列出某银行的所有监管账户 (按 bank_id 索引)."""
        async with self._lock:
            items = [
                a for a in self._supervision_accounts.values()
                if a.get("bankId") == bank_id
            ]
            return [dict(a) for a in items]

    async def get_supervision_account(self, bank_id: str, account_id: str) -> dict | None:
        """获取单个监管账户 (按 bank_id + account_id 复合定位)."""
        async with self._lock:
            key = f"{bank_id}:{account_id}"
            a = self._supervision_accounts.get(key)
            return dict(a) if a else None

    async def update_supervision_account_status(
        self, bank_id: str, account_id: str, new_status: str, operated_at: str,
    ) -> dict | None:
        """更新监管账户冻结状态 + 最后操作时间, 返回更新后的账户 (含 previousStatus)."""
        async with self._lock:
            key = f"{bank_id}:{account_id}"
            a = self._supervision_accounts.get(key)
            if not a:
                return None
            previous_status = a.get("status", "active")
            a["status"] = new_status
            a["lastOperationAt"] = operated_at
            a["previousStatus"] = previous_status
            return dict(a)

    async def get_credit_state(self, bank_id: str) -> dict:
        """获取银行授信乘数状态 (不存在则惰性创建默认 1.0)."""
        async with self._lock:
            state = self._credit_states.get(bank_id)
            if not state:
                # 惰性兜底: 未知银行给默认基础额度 100 万元 + 乘数 1.0
                state = {"baseCreditLimitCents": 100_000_000, "multiplier": 1.0}
                self._credit_states[bank_id] = dict(state)
            return dict(state)

    async def set_credit_multiplier(
        self, bank_id: str, multiplier: float,
    ) -> dict:
        """更新银行授信乘数, 返回 {previous_multiplier, multiplier, base_credit_limit_cents}."""
        async with self._lock:
            state = self._credit_states.get(bank_id)
            if not state:
                state = {"baseCreditLimitCents": 100_000_000, "multiplier": 1.0}
                self._credit_states[bank_id] = dict(state)
            previous_multiplier = state.get("multiplier", 1.0)
            state["multiplier"] = multiplier
            return {
                "previous_multiplier": previous_multiplier,
                "multiplier": multiplier,
                "base_credit_limit_cents": state.get("baseCreditLimitCents", 100_000_000),
            }


_bank_store = _BankStore()


# ============================================================================
# 银行信任培育服务
# ============================================================================

class BankService:
    """银行信任培育期渐进解锁服务."""

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入, 当前仅内存兜底

    # === 阶段判定辅助 ===

    @staticmethod
    def _parse_stage(stage_value: str | BankTrustStage) -> BankTrustStage:
        """兼容字符串与枚举, 解析为 BankTrustStage."""
        if isinstance(stage_value, BankTrustStage):
            return stage_value
        try:
            return BankTrustStage(stage_value)
        except ValueError:
            return BankTrustStage.L4_READONLY

    @staticmethod
    def can_auto_handle(bank_id: str, amount: int, stage: BankTrustStage | str) -> bool:
        """检查当前阶段是否能自动处理.

        - L4 永远 false (培育期零拦截)
        - L3 false (验证期仍需人工确认)
        - L2 <50万 true (信任期小额自动)
        - L1 true (深度信任期全自动)
        """
        stage = BankService._parse_stage(stage)
        # 50 万元 = 500,000 元 = 50,000,000 分
        small_threshold_cents = 500_000 * 100  # 50 万元阈值 (单位: 分)
        if stage == BankTrustStage.L1_FULL_AUTO:
            return True
        if stage == BankTrustStage.L2_SMALL_AUTO:
            return amount < small_threshold_cents
        # L4 / L3 均为人工
        return False

    @staticmethod
    def _compute_conversion_rate(total: int, ai_blocked: int, manual_adopted: int) -> float:
        """转化率 = (AI 建议被采纳次数) / (总决策数)."""
        if total <= 0:
            return 0.0
        # ai_blocked + manual_adopted 视为 AI 建议被采纳
        adopted = ai_blocked + manual_adopted
        return round(min(1.0, adopted / total), 4)

    @staticmethod
    def _compute_next_stage_progress(profile: dict, stage: BankTrustStage) -> float:
        """计算下一阶段解锁进度 (0.0-1.0)."""
        threshold = _STAGE_THRESHOLDS[stage]
        if stage == BankTrustStage.L1_FULL_AUTO:
            return 1.0
        months = profile.get("joinedMonths", 0)
        decisions = profile.get("totalApprovedCount", 0)
        conv = profile.get("conversionRate", 0.0)
        # 三维度均达标即解锁, 进度取三维度达成度的最小值
        months_prog = min(1.0, months / max(1, threshold["min_months"]))
        dec_prog = min(1.0, decisions / max(1, threshold["min_decisions"]))
        conv_prog = min(1.0, conv / max(0.01, threshold["min_conversion_rate"]))
        return round(min(months_prog, dec_prog, conv_prog), 4)

    # === 公开方法 ===

    async def get_trust_profile(self, bank_id: str) -> BankTrustProfile | None:
        """获取银行信任档案."""
        p = await _bank_store.get_profile(bank_id)
        if not p:
            return None
        stage = self._parse_stage(p.get("stage", BankTrustStage.L4_READONLY))
        # 重新计算下一阶段解锁进度 (保证实时性)
        p["nextStageUnlockProgress"] = self._compute_next_stage_progress(p, stage)
        p["stage"] = stage.value
        p["stageDescription"] = _STAGE_DESCRIPTIONS[stage]
        return BankTrustProfile.model_validate(p)

    async def list_banks(self) -> list[BankListItem]:
        """列出所有银行 (轻量列表)."""
        profiles = await _bank_store.list_profiles()
        items: list[BankListItem] = []
        for p in profiles:
            stage = self._parse_stage(p.get("stage", BankTrustStage.L4_READONLY))
            items.append(BankListItem(
                bank_id=p["bankId"],
                bank_name=p.get("bankName", ""),
                stage=stage,
                joined_months=p.get("joinedMonths", 0),
                conversion_rate=p.get("conversionRate", 0.0),
            ))
        return items

    async def upgrade_stage(self, bank_id: str) -> StageUpgradeResult:
        """升级信任阶段 (需满足转化率/数量/月数阈值)."""
        p = await _bank_store.get_profile(bank_id)
        if not p:
            return StageUpgradeResult(
                bank_id=bank_id,
                previous_stage=BankTrustStage.L4_READONLY,
                current_stage=BankTrustStage.L4_READONLY,
                upgraded=False,
                reason=f"银行 {bank_id} 不存在",
                conversion_rate=0.0,
                total_approved_count=0,
            )

        current_stage = self._parse_stage(p.get("stage", BankTrustStage.L4_READONLY))
        threshold = _STAGE_THRESHOLDS[current_stage]
        next_stage = threshold["next"]

        if current_stage == BankTrustStage.L1_FULL_AUTO:
            return StageUpgradeResult(
                bank_id=bank_id,
                previous_stage=current_stage,
                current_stage=current_stage,
                upgraded=False,
                reason="已处于最高信任阶段 L1_FULL_AUTO, 无需升级",
                conversion_rate=p.get("conversionRate", 0.0),
                total_approved_count=p.get("totalApprovedCount", 0),
            )

        months = p.get("joinedMonths", 0)
        decisions = p.get("totalApprovedCount", 0)
        conv = p.get("conversionRate", 0.0)

        meets = (
            months >= threshold["min_months"]
            and decisions >= threshold["min_decisions"]
            and conv >= threshold["min_conversion_rate"]
        )
        if not meets:
            reasons: list[str] = []
            if months < threshold["min_months"]:
                reasons.append(f"接入月数 {months} 不足 {threshold['min_months']}")
            if decisions < threshold["min_decisions"]:
                reasons.append(f"决策数 {decisions} 不足 {threshold['min_decisions']}")
            if conv < threshold["min_conversion_rate"]:
                reasons.append(f"转化率 {conv:.2%} 不足 {threshold['min_conversion_rate']:.2%}")
            return StageUpgradeResult(
                bank_id=bank_id,
                previous_stage=current_stage,
                current_stage=current_stage,
                upgraded=False,
                reason="; ".join(reasons),
                conversion_rate=conv,
                total_approved_count=decisions,
            )

        # 执行升级
        p["stage"] = next_stage.value
        p["stageDescription"] = _STAGE_DESCRIPTIONS[next_stage]
        await _bank_store.upsert_profile(bank_id, p)

        return StageUpgradeResult(
            bank_id=bank_id,
            previous_stage=current_stage,
            current_stage=next_stage,
            upgraded=True,
            reason=f"信任阶段由 {current_stage.value} 升级为 {next_stage.value}",
            conversion_rate=conv,
            total_approved_count=decisions,
        )

    async def list_risk_letters(
        self, bank_id: str, enterprise_id: str | None = None,
    ) -> list[RiskLetter]:
        """列出风险提示函 (可按企业筛选)."""
        letters = await _bank_store.list_letters(bank_id, enterprise_id)
        return [RiskLetter.model_validate(l) for l in letters]

    async def generate_risk_letter(
        self, bank_id: str, enterprise_id: str, risk_level: str,
        summary: str, recommendations: list[str],
        enterprise_name: str = "",
    ) -> RiskLetter:
        """生成风险提示函 (L4 培育期 AI 唯一输出, 零拦截)."""
        letter = {
            "letterId": _id("LTR"),
            "bankId": bank_id,
            "enterpriseId": enterprise_id,
            "enterpriseName": enterprise_name,
            "riskLevel": risk_level,
            "summary": summary,
            "recommendations": list(recommendations),
            "generatedAt": _now_iso(),
        }
        await _bank_store.add_letter(letter)
        return RiskLetter.model_validate(letter)

    async def list_decisions(self, bank_id: str) -> list[BankDecision]:
        """列出决策日志."""
        decs = await _bank_store.list_decisions(bank_id)
        return [BankDecision.model_validate(d) for d in decs]

    async def submit_decision(
        self, bank_id: str, enterprise_id: str, amount: int,
        ai_recommendation: str, bank_final_decision: str,
        enterprise_name: str = "", reason: str = "",
    ) -> BankDecision:
        """提交决策 (根据 stage 自动判断 autoHandled)."""
        p = await _bank_store.get_profile(bank_id)
        stage = (
            self._parse_stage(p.get("stage", BankTrustStage.L4_READONLY))
            if p else BankTrustStage.L4_READONLY
        )

        auto_handled = self.can_auto_handle(bank_id, amount, stage)
        # 若 AI 自动处理, 则最终决策与 AI 建议一致
        if auto_handled and bank_final_decision == "pending":
            bank_final_decision = ai_recommendation

        decision = {
            "decisionId": _id("DEC"),
            "bankId": bank_id,
            "enterpriseId": enterprise_id,
            "enterpriseName": enterprise_name,
            "amount": amount,
            "aiRecommendation": ai_recommendation,
            "bankFinalDecision": bank_final_decision,
            "autoHandled": auto_handled,
            "stage": stage.value,
            "reason": reason,
            "decidedAt": _now_iso(),
        }
        await _bank_store.add_decision(decision)

        # 更新银行档案统计
        if p:
            p["totalApprovedCount"] = p.get("totalApprovedCount", 0) + 1
            if auto_handled:
                p["aiAutoApprovedCount"] = p.get("aiAutoApprovedCount", 0) + 1
            if ai_recommendation == "reject" and bank_final_decision == "reject":
                p["aiBlockedCount"] = p.get("aiBlockedCount", 0) + 1
            # 转化率 = (AI 建议被采纳次数) / (总决策数)
            # 采纳次数 ≈ aiAutoApprovedCount + aiBlockedCount
            adopted = p.get("aiAutoApprovedCount", 0) + p.get("aiBlockedCount", 0)
            p["conversionRate"] = round(min(1.0, adopted / max(1, p["totalApprovedCount"])), 4)
            await _bank_store.upsert_profile(bank_id, p)

        return BankDecision.model_validate(decision)

    async def get_statistics(self, bank_id: str) -> BankStatistics:
        """统计数据 (按决策日志聚合)."""
        decs = await _bank_store.list_decisions(bank_id)
        total_loans = len(decs)
        auto_approved = sum(1 for d in decs if d.get("autoHandled"))
        manual_approved = sum(
            1 for d in decs
            if not d.get("autoHandled") and d.get("bankFinalDecision") == "approve"
        )
        rejected = sum(1 for d in decs if d.get("bankFinalDecision") == "reject")
        total_amount = sum(int(d.get("amount", 0)) for d in decs)
        return BankStatistics(
            bank_id=bank_id,
            total_loans=total_loans,
            auto_approved_count=auto_approved,
            manual_approved_count=manual_approved,
            rejected_count=rejected,
            total_amount_cents=total_amount,
        )

    # === APP-01 银行端操作面板 (C 档独立兜底, 内存存储) ===

    async def list_supervision_accounts(self, bank_id: str) -> list[SupervisionAccount]:
        """列出监管账户 (APP-01 端点 11).

        C 档兜底: 从内存 _BankStore 读取, 重启丢失 (这是兜底特性, 非 bug).
        未注册银行返回空数组 (不报错, 让前端展示空态).
        """
        items = await _bank_store.list_supervision_accounts(bank_id)
        return [SupervisionAccount.model_validate(a) for a in items]

    async def freeze_account(
        self, bank_id: str, account_id: str, freeze: bool, reason: str = "",
    ) -> FreezeAccountResult:
        """冻结/解冻监管账户 (APP-01 端点 10).

        - freeze=True → status='frozen', freeze=False → status='active'
        - 账户不存在时抛 404 (让前端感知, 不静默成功)
        - 返回 previous_status + operated_at 用于审计
        """
        existing = await _bank_store.get_supervision_account(bank_id, account_id)
        if not existing:
            raise KeyError(f"账户 {account_id} 在银行 {bank_id} 下不存在")

        new_status = "frozen" if freeze else "active"
        operated_at = _now_iso()
        updated = await _bank_store.update_supervision_account_status(
            bank_id=bank_id,
            account_id=account_id,
            new_status=new_status,
            operated_at=operated_at,
        )
        previous_status = updated.get("previousStatus", "active") if updated else "active"
        # reason 字段当前仅用于审计日志 (内存兜底未持久化审计表, 留扩展点)
        _ = reason
        return FreezeAccountResult(
            account_id=account_id,
            status=new_status,
            operated_at=operated_at,
            previous_status=previous_status,
        )

    async def adjust_credit_multiplier(
        self, bank_id: str, multiplier: float, reason: str = "",
    ) -> CreditMultiplierResult:
        """调整授信乘数 (APP-01 端点 9).

        - 新授信额度 = base_credit_limit_cents * multiplier
        - 返回 previous (基于旧乘数) + new (基于新乘数) 双额度
        - reason 字段仅审计用 (内存兜底未持久化, 留扩展点)
        """
        _ = reason
        result = await _bank_store.set_credit_multiplier(bank_id, multiplier)
        base = result["base_credit_limit_cents"]
        prev_mult = result["previous_multiplier"]
        new_limit = round(base * multiplier)
        prev_limit = round(base * prev_mult)
        return CreditMultiplierResult(
            bank_id=bank_id,
            multiplier=multiplier,
            new_credit_limit_cents=new_limit,
            previous_credit_limit_cents=prev_limit,
            applied_at=_now_iso(),
        )


bank_service = BankService(db=None)
