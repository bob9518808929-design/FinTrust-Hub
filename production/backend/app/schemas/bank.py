"""银行信任培育期渐进解锁 schemas (CORE-01b).

设计依据: spec.md 银行信任四阶段渐进解锁.
    L4_READONLY    培育期 0-6 月    AI 仅生成《风险提示函》零拦截
    L3_ADVISORY    验证期 6-12 月   AI 可发"建议拦截"但仍需人工确认
    L2_SMALL_AUTO  信任期 12-24 月  AI 可自动放行小额(<50 万), 大额仍需人工
    L1_FULL_AUTO   深度信任期 24+ 月 AI 全自动决策, 仅事后审计

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, ApiResult, Id, IsoTimestamp

# === 枚举 ===

class BankTrustStage(StrEnum):
    """银行信任培育阶段 (越高越信任, 数值越小)."""
    L4_READONLY = "L4_READONLY"        # 培育期 0-6 月
    L3_ADVISORY = "L3_ADVISORY"        # 验证期 6-12 月
    L2_SMALL_AUTO = "L2_SMALL_AUTO"   # 信任期 12-24 月
    L1_FULL_AUTO = "L1_FULL_AUTO"     # 深度信任期 24+ 月


RiskLevel = Literal["low", "medium", "high"]
AiRecommendation = Literal["approve", "review", "reject"]
BankFinalDecision = Literal["approve", "review", "reject", "pending"]


# === 基础 mixin (snake_case + camelCase alias) ===

class _BankBase(BaseModel):
    """银行 schema 公共配置: snake_case 字段 + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 银行信任档案 ===

class BankTrustProfile(_BankBase):
    """银行信任档案 (4 阶段进度 + 转化率)."""
    bank_id: Id = Field(description="银行 ID")
    bank_name: str = Field(default="", description="银行名称")
    stage: BankTrustStage = Field(description="当前信任阶段")
    joined_months: int = Field(ge=0, description="接入至今月数")
    total_approved_count: int = Field(default=0, ge=0, description="累计已处理决策数")
    ai_auto_approved_count: int = Field(default=0, ge=0, description="AI 自动处理数")
    ai_blocked_count: int = Field(default=0, ge=0, description="AI 拦截数")
    conversion_rate: float = Field(default=0.0, ge=0.0, le=1.0, description="AI 建议被采纳的转化率")
    next_stage_unlock_progress: float = Field(default=0.0, ge=0.0, le=1.0, description="下一阶段解锁进度")
    stage_description: str = Field(default="", description="阶段说明")


# === 风险提示函 ===

class RiskLetter(_BankBase):
    """风险提示函 (L4 培育期 AI 唯一输出, 零拦截)."""
    letter_id: Id = Field(description="提示函 ID")
    bank_id: Id = Field(description="所属银行 ID")
    enterprise_id: Id = Field(description="企业 ID")
    enterprise_name: str = Field(default="", description="企业名称")
    risk_level: RiskLevel = Field(description="风险等级 low/medium/high")
    summary: str = Field(description="风险摘要")
    recommendations: list[str] = Field(default_factory=list, description="AI 建议")
    generated_at: IsoTimestamp = Field(description="生成时间")


class RiskLetterCreate(_BankBase):
    """生成风险提示函请求体."""
    enterprise_id: Id
    enterprise_name: str = Field(default="")
    risk_level: RiskLevel
    summary: str
    recommendations: list[str] = Field(default_factory=list)


# === 银行决策日志 ===

class BankDecision(_BankBase):
    """银行决策记录 (AI 建议 vs 银行最终决策, 含自动处理标识)."""
    decision_id: Id = Field(description="决策 ID")
    bank_id: Id = Field(description="银行 ID")
    enterprise_id: Id = Field(description="企业 ID")
    enterprise_name: str = Field(default="", description="企业名称")
    amount: AmountInCents = Field(description="贷款金额 (分)")
    ai_recommendation: AiRecommendation = Field(description="AI 建议 approve/review/reject")
    bank_final_decision: BankFinalDecision = Field(description="银行最终决策")
    auto_handled: bool = Field(default=False, description="是否由 AI 自动处理")
    stage: BankTrustStage = Field(description="决策时信任阶段")
    reason: str = Field(default="", description="决策理由")
    decided_at: IsoTimestamp = Field(description="决策时间")


class BankDecisionCreate(_BankBase):
    """提交决策请求体."""
    enterprise_id: Id
    enterprise_name: str = Field(default="")
    amount: AmountInCents
    ai_recommendation: AiRecommendation
    bank_final_decision: BankFinalDecision = Field(default="pending")
    reason: str = Field(default="")


# === 银行统计 ===

class BankStatistics(_BankBase):
    """银行统计数据."""
    bank_id: Id
    total_loans: int = Field(default=0, ge=0, description="总笔数")
    auto_approved_count: int = Field(default=0, ge=0, description="自动通过笔数")
    manual_approved_count: int = Field(default=0, ge=0, description="人工通过笔数")
    rejected_count: int = Field(default=0, ge=0, description="拒绝笔数")
    total_amount_cents: AmountInCents = Field(default=0, description="总额 (分)")


# === 银行列表项 ===

class BankListItem(_BankBase):
    """银行列表项 (轻量)."""
    bank_id: Id
    bank_name: str
    stage: BankTrustStage
    joined_months: int
    conversion_rate: float = Field(default=0.0, ge=0.0, le=1.0)


# === 升级结果 ===

class StageUpgradeResult(_BankBase):
    """升级阶段结果."""
    bank_id: Id
    previous_stage: BankTrustStage
    current_stage: BankTrustStage
    upgraded: bool = Field(description="是否成功升级")
    reason: str = Field(default="")
    conversion_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    total_approved_count: int = Field(default=0, ge=0)


# === APP-01 银行端操作面板 (C档独立兜底) ===

AccountFreezeStatus = Literal["active", "frozen"]


class SupervisionAccount(_BankBase):
    """监管账户 (APP-01 端点 11 response).

    C 档独立兜底: 内存存储, 重启丢失. 字段对齐前端 bank.ts SupervisionAccount.
    """
    account_id: Id = Field(description="脱敏账户号")
    status: AccountFreezeStatus = Field(description="冻结状态 active/frozen")
    balance_cents: AmountInCents = Field(description="监管账户余额 (分)")
    enterprise_id: Id = Field(description="关联企业 ID")
    enterprise_name: str = Field(default="", description="关联企业名称 (脱敏)")
    bank_id: Id = Field(description="所属银行 ID")
    last_operation_at: IsoTimestamp | None = Field(
        default=None, description="最后冻结/解冻操作时间 ISO"
    )


class FreezeAccountPayload(_BankBase):
    """冻结/解冻监管账户请求体 (APP-01 端点 10 request).

    URL path 仅含 bank_id, accountId 由 body 携带 (前端 {...payload, accountId}).
    """
    freeze: bool = Field(description="true=冻结, false=解冻")
    reason: str = Field(default="", description="操作原因 (审计)")
    account_id: Id = Field(description="目标账户号 (body 携带, 与 bank_id 复合定位)")


class FreezeAccountResult(_BankBase):
    """冻结/解冻结果 (APP-01 端点 10 response)."""
    account_id: Id = Field(description="账户号")
    status: AccountFreezeStatus = Field(description="操作后状态 active/frozen")
    operated_at: IsoTimestamp = Field(description="操作时间 ISO")
    previous_status: AccountFreezeStatus = Field(description="操作前状态")


class CreditMultiplierPayload(_BankBase):
    """调整授信乘数请求体 (APP-01 端点 9 request)."""
    multiplier: float = Field(ge=0.1, le=5.0, description="授信乘数 0.5-3.0 (放宽到 0.1-5.0)")
    reason: str = Field(default="", description="操作原因 (审计)")


class CreditMultiplierResult(_BankBase):
    """调整授信乘数结果 (APP-01 端点 9 response).

    字段对齐前端 bank.ts CreditMultiplierResult:
    bankId / multiplier / newCreditLimitCents / previousCreditLimitCents / appliedAt.
    """
    bank_id: Id = Field(description="银行 ID")
    multiplier: float = Field(description="应用后的乘数")
    new_credit_limit_cents: AmountInCents = Field(description="调整后授信额度 (分)")
    previous_credit_limit_cents: AmountInCents = Field(description="调整前授信额度 (分)")
    applied_at: IsoTimestamp = Field(description="操作时间 ISO")


# === 通用响应包装别名 ===

__all__ = [
    # APP-01 操作面板
    "AccountFreezeStatus",
    "AiRecommendation",
    "AmountInCents",
    "ApiResult",
    "BankDecision",
    "BankDecisionCreate",
    "BankFinalDecision",
    "BankListItem",
    "BankStatistics",
    "BankTrustProfile",
    "BankTrustStage",
    "CreditMultiplierPayload",
    "CreditMultiplierResult",
    "FreezeAccountPayload",
    "FreezeAccountResult",
    "Id",
    "IsoTimestamp",
    "RiskLetter",
    "RiskLetterCreate",
    "RiskLevel",
    "StageUpgradeResult",
    "SupervisionAccount",
]
