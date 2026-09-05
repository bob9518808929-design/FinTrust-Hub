"""MOD-02 智能风控 — 风控规则 DSL + 热加载 + 流处理 schemas (R4.7).

设计依据: spec.md MOD-02 L437-505 智能风控引擎.
DSL 格式示例:
    WHEN amount > 5000000 AND counterparty IN ["黑名单A","黑名单B"] THEN block SCORE +50
    WHEN hour BETWEEN 22 AND 06 THEN flag SCORE +20
    WHEN invoice_amount > contract_amount THEN manual_review SCORE +30

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp

# === 枚举 ===

class RuleOperator(StrEnum):
    """DSL 条件操作符."""
    EQ = "EQ"           # ==
    NE = "NE"           # !=
    GT = "GT"           # >
    GTE = "GTE"         # >=
    LT = "LT"           # <
    LTE = "LTE"         # <=
    IN = "IN"           # in
    NOT_IN = "NOT_IN"   # not in
    CONTAINS = "CONTAINS"  # contains
    REGEX = "REGEX"     # regex match


class RuleLogic(StrEnum):
    """多条件逻辑组合 (全部满足 / 任一满足)."""
    ALL = "ALL"   # AND
    ANY = "ANY"  # OR


class RuleAction(StrEnum):
    """规则触发后的处置动作."""
    PASS = "pass"               # 放行
    FLAG = "flag"               # 标记 (人工可见但不阻断)
    BLOCK = "block"             # 阻断
    MANUAL_REVIEW = "manual_review"  # 转人工复核


class RulesetStatus(StrEnum):
    """规则集状态."""
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


# === 基础 mixin ===

class _RiskRuleBase(BaseModel):
    """风控规则 schema 公共配置: snake_case + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === DSL 条件 ===

class RuleCondition(_RiskRuleBase):
    """DSL 单条条件 (field_path operator value)."""
    field_path: str = Field(description="字段路径 (如 amount / counterparty / hour)")
    operator: RuleOperator = Field(description="操作符")
    value: Any = Field(description="比较值 (str/int/float/list)")


# === 风控规则 ===

class RiskRule(_RiskRuleBase):
    """风控规则 (DSL 编译后可执行)."""
    rule_id: Id
    rule_name: str
    description: str = ""
    conditions: list[RuleCondition] = Field(default_factory=list)
    logic: RuleLogic = RuleLogic.ALL
    action: RuleAction = RuleAction.FLAG
    risk_score_delta: int = Field(default=0, description="触发后风险分增量")
    priority: int = Field(default=100, ge=0, le=1000, description="优先级 (小=先执行)")
    enabled: bool = True
    version: int = Field(default=1, ge=1)
    created_at_iso: IsoTimestamp
    updated_at_iso: IsoTimestamp
    ruleset_id: Id | None = None


class RiskRuleCreate(_RiskRuleBase):
    rule_name: str
    description: str = ""
    conditions: list[RuleCondition] = Field(default_factory=list)
    logic: RuleLogic = RuleLogic.ALL
    action: RuleAction = RuleAction.FLAG
    risk_score_delta: int = 0
    priority: int = Field(default=100, ge=0, le=1000)
    enabled: bool = True
    ruleset_id: Id | None = None


class RiskRuleUpdate(_RiskRuleBase):
    rule_name: str | None = None
    description: str | None = None
    conditions: list[RuleCondition] | None = None
    logic: RuleLogic | None = None
    action: RuleAction | None = None
    risk_score_delta: int | None = None
    priority: int | None = None
    enabled: bool | None = None


# === 规则集 ===

class RiskRuleSet(_RiskRuleBase):
    """规则集 (一个企业可同时启用多个规则集, 通过 status=active 标记)."""
    ruleset_id: Id
    name: str
    rules: list[RiskRule] = Field(default_factory=list)
    version: int = Field(default=1, ge=1)
    effective_from_iso: IsoTimestamp | None = None
    effective_to_iso: IsoTimestamp | None = None
    status: RulesetStatus = RulesetStatus.DRAFT


# === 评估结果 ===

class RiskEvaluationResult(_RiskRuleBase):
    """交易风控评估结果 (按 priority 排序执行规则, 累加 risk_score_delta)."""
    eval_id: Id
    enterprise_id: Id | None = None
    tx_id: Id | None = None
    triggered_rules: list[str] = Field(default_factory=list, description="命中的 rule_id 列表")
    total_risk_score: int = Field(default=0, ge=0, description="累计风险分")
    action: RuleAction = RuleAction.PASS
    evaluation_time_ms: int = Field(default=0, ge=0, description="评估耗时 (毫秒)")
    explanations: list[str] = Field(default_factory=list, description="命中解释")
    timestamp_iso: IsoTimestamp


# === 流事件 ===

class RiskStreamEvent(_RiskRuleBase):
    """实时风控流事件 (ingest → evaluate → 返回结果)."""
    event_id: Id
    enterprise_id: Id | None = None
    tx_id: Id | None = None
    event_type: str = Field(default="tx", description="事件类型 (tx/login/transfer)")
    payload: dict = Field(default_factory=dict, description="事件载荷 (含交易字段)")
    received_at_iso: IsoTimestamp
    processed: bool = False
    risk_result_id: Id | None = None


class RiskStreamEventCreate(_RiskRuleBase):
    enterprise_id: Id | None = None
    tx_id: Id | None = None
    event_type: str = "tx"
    payload: dict = Field(default_factory=dict)


__all__ = [
    "Id",
    "IsoTimestamp",
    "RiskEvaluationResult",
    "RiskRule",
    "RiskRuleCreate",
    "RiskRuleSet",
    "RiskRuleUpdate",
    "RiskStreamEvent",
    "RiskStreamEventCreate",
    "RuleAction",
    "RuleCondition",
    "RuleLogic",
    "RuleOperator",
    "RulesetStatus",
]
