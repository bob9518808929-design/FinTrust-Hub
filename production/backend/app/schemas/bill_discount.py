"""MOD-04 票据服务 - 贴现计算 schemas (R5.2).

贴现结果 DiscountResult: 票面金额 / 贴现率 / 剩余天数 / 贴现利息 / 实付金额.

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents


class _BillBase(BaseModel):
    """票据 schema 公共配置: snake_case + camelCase alias + 双向填充."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )


class DiscountResult(_BillBase):
    """贴现计算结果.

    计算公式:
        discount_interest = face_value * discount_rate * days_to_maturity / 360
        net_proceeds     = face_value - discount_interest
    所有金额单位: 分 (cents).
    """

    bill_no: str = Field(description="票据号码")
    face_value_cents: AmountInCents = Field(description="票面金额 (分)")
    discount_rate: float = Field(ge=0.0, le=1.0, description="贴现率 (年化小数, 如 0.055)")
    days_to_maturity: int = Field(ge=0, description="剩余到期天数")
    interest_cents: AmountInCents = Field(description="贴现利息 (分)")
    net_proceeds_cents: AmountInCents = Field(description="实付金额 (分)")
    calc_time_iso: str = Field(description="计算时间 (ISO)")


__all__ = ["DiscountResult"]
