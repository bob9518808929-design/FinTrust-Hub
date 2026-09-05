"""INFRA-04 改造沙箱 - 12 项准入指标 schemas (R5.7).

12 项指标: 资产负债率 / 流动比率 / 速动比率 / 应收账款周转 / 存货周转 /
        营收增长率 / 净利润率 / ROE / ROA / 现金流量 / 利息保障 / 资产负债结构

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class IndicatorStatus(str, Enum):
    """指标状态 (对比基线)."""
    IMPROVED = "improved"
    DEGRADED = "degraded"
    UNCHANGED = "unchanged"


class _IndicatorBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class CurvePoint(_IndicatorBase):
    """指标曲线单点 (月度)."""
    month_iso: str = Field(description="ISO 月份, 如 2026-08")
    value: float = Field(description="该月指标值")


class IndicatorCurve(_IndicatorBase):
    """单条指标曲线 (含基线 / 投影 / 月度数据点)."""
    indicator_id: str = Field(description="指标 ID, 如 asset_liability_ratio")
    name: str = Field(description="指标名称 (中文)")
    baseline_value: float = Field(description="基线值 (改造前)")
    projected_value: float = Field(description="投影值 (改造后预测)")
    curve_points: list[CurvePoint] = Field(
        default_factory=list, description="月度数据点 (12 个月)"
    )
    unit: str = Field(default="%", description="单位, 如 % / 次 / 倍")
    status: IndicatorStatus = Field(
        default=IndicatorStatus.UNCHANGED,
        description="对比基线: improved/degraded/unchanged",
    )


class SandboxReport(_IndicatorBase):
    """沙箱报告 (含 12 条指标曲线 + 风险标注)."""
    sandbox_id: str = Field(description="沙箱 ID")
    indicators: list[IndicatorCurve] = Field(
        default_factory=list, description="12 项指标曲线"
    )
    summary: str = Field(default="", description="报告摘要")
    risk_flags: list[str] = Field(
        default_factory=list, description="风险标注列表 (异常指标)"
    )
    generated_at_iso: str = Field(description="报告生成时间 (ISO)")


__all__ = [
    "IndicatorStatus",
    "CurvePoint",
    "IndicatorCurve",
    "SandboxReport",
]
