"""MOD-01 资金监管 — 五流合一校验引擎 schemas (R4.6).

设计依据: spec.md MOD-01 五流合一校验 (资金流 / 合同流 / 票据流 / 物流 / IoT 设备流 / 人流).
    FUND       资金流     来自 fund_service 监管账户划拨记录
    CONTRACT   合同流     来自 contract_service 合同签署记录
    INVOICE    票据流     来自 invoice_service 发票开具记录
    LOGISTICS  物流       来自 iot_gateway 物流签收/在途事件
    IOT        设备流     来自 iot_service IoT 设备传感数据 (温湿度/位置/重量)
    HUMAN      人流       来自 responsibility_chain_service 人流责任链节点

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, Id, IsoTimestamp


# === 枚举 ===

class FlowType(str, Enum):
    """五流合一校验涉及的六类业务流."""
    FUND = "FUND"
    CONTRACT = "CONTRACT"
    INVOICE = "INVOICE"
    LOGISTICS = "LOGISTICS"
    IOT = "IOT"
    HUMAN = "HUMAN"


# 状态字面量
FlowRecordStatus = Literal["pending", "confirmed", "mismatched"]
MonitorAction = Literal["alert", "freeze", "notify"]
MonitorSeverity = Literal["low", "medium", "high", "critical"]
AlertStatus = Literal["active", "acknowledged", "resolved"]
LockStatus = Literal["locked", "released", "forfeited"]


# === 基础 mixin (snake_case + camelCase alias) ===

class _FiveFlowBase(BaseModel):
    """五流合一 schema 公共配置: snake_case 字段 + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 流水记录 ===

class FlowRecord(_FiveFlowBase):
    """单条流记录 (来自 fund/contract/invoice/iot/responsibility 服务).

    amount_cents: 流水金额 (分), 与资金监管账户金额对齐.
    evidence_ref: 证据引用 (合同 ID / 发票号 / IoT 设备 ID / 责任链节点 ID).
    status: pending (待确认) / confirmed (已确认) / mismatched (与其他流不一致).
    """
    flow_id: Id = Field(description="流记录 ID")
    flow_type: FlowType = Field(description="流类型 (六流之一)")
    enterprise_id: Id = Field(description="企业 ID")
    tx_id: Id = Field(description="关联交易 ID (用于跨流聚合)")
    amount_cents: AmountInCents = Field(default=0, description="金额 (分)")
    counterparty_name: str = Field(default="", description="对手方名称")
    counterparty_id: str = Field(default="", description="对手方 ID")
    tx_time_iso: IsoTimestamp = Field(description="交易时间 (ISO 8601)")
    evidence_ref: str = Field(default="", description="证据引用 (合同/发票/设备/责任链节点 ID)")
    status: FlowRecordStatus = Field(default="pending")


class FlowRecordCreate(_FiveFlowBase):
    """流记录创建请求体."""
    flow_type: FlowType
    enterprise_id: Id
    tx_id: Id
    amount_cents: AmountInCents = 0
    counterparty_name: str = ""
    counterparty_id: str = ""
    tx_time_iso: IsoTimestamp
    evidence_ref: str = ""
    status: FlowRecordStatus = "pending"


# === 一致性校验结果 ===

class ConsistencyCheckResult(_FiveFlowBase):
    """单笔交易六流一致性校验结果.

    consistency_score: 100 = 完全一致, 每项不一致扣 20 分 (金额/时间/主体等维度).
    passed: True 表示一致性得分 >= 80 (允许 1 项轻微不一致).
    """
    enterprise_id: Id
    tx_id: Id
    total_flows_checked: int = Field(ge=0, description="实际参与校验的流数 (0-6)")
    matched_flows: list[FlowType] = Field(default_factory=list, description="一致通过的流类型")
    mismatched_flows: list[FlowType] = Field(default_factory=list, description="存在不一致的流类型")
    mismatch_details: list[str] = Field(default_factory=list, description="不一致项详情")
    consistency_score: int = Field(ge=0, le=100, description="一致性得分 0-100")
    passed: bool = Field(description="是否通过校验 (score >= 80)")


# === 监控规则 ===

class MonitorRule(_FiveFlowBase):
    """资金监管监控规则.

    condition: DSL 条件文本 (示例: amount > 5000000 OR counterparty IN 黑名单).
    threshold_cents: 触发阈值 (分), 与 amount_cents 单位一致.
    action: 触发动作 alert (告警) / freeze (冻结账户) / notify (通知).
    severity: 风险等级 low / medium / high / critical.
    """
    rule_id: Id
    rule_name: str
    flow_type: FlowType
    condition: str
    threshold_cents: AmountInCents = 0
    action: MonitorAction = "alert"
    severity: MonitorSeverity = "medium"


class MonitorRuleCreate(_FiveFlowBase):
    rule_name: str
    flow_type: FlowType
    condition: str
    threshold_cents: AmountInCents = 0
    action: MonitorAction = "alert"
    severity: MonitorSeverity = "medium"


# === 监控告警 ===

class MonitorAlert(_FiveFlowBase):
    """监控告警实例 (规则匹配后产生)."""
    alert_id: Id
    rule_id: Id
    enterprise_id: Id
    tx_id: Optional[Id] = None
    alert_type: str = Field(default="", description="告警类型 (rule_name 派生)")
    severity: MonitorSeverity = "medium"
    message: str
    triggered_at_iso: IsoTimestamp
    status: AlertStatus = "active"


# === 账户锁定 ===

class FundAccountLock(_FiveFlowBase):
    """资金账户锁定记录 (规则触发 freeze 动作时生成).

    status: locked (锁定中) / released (已释放) / forfeited (罚没).
    expires_at_iso: 锁定自动过期时间 (默认 72 小时).
    """
    lock_id: Id
    enterprise_id: Id
    account_id: Id
    locked_amount_cents: AmountInCents
    reason: str
    locked_at_iso: IsoTimestamp
    expires_at_iso: IsoTimestamp
    status: LockStatus = "locked"


class FundAccountLockCreate(_FiveFlowBase):
    enterprise_id: Id
    account_id: Id
    amount_cents: AmountInCents
    reason: str
    duration_hours: int = Field(default=72, ge=1, le=720)


__all__ = [
    "FlowType",
    "FlowRecord",
    "FlowRecordCreate",
    "FlowRecordStatus",
    "ConsistencyCheckResult",
    "MonitorRule",
    "MonitorRuleCreate",
    "MonitorAction",
    "MonitorSeverity",
    "MonitorAlert",
    "AlertStatus",
    "FundAccountLock",
    "FundAccountLockCreate",
    "LockStatus",
    "Id",
    "IsoTimestamp",
    "AmountInCents",
]
