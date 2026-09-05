"""文件名：performance.py 职责：履约评分 Pydantic 模型,定义 PD/IOY 评分与趋势 schema."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp


class _PerfBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class PerformanceScore(_PerfBase):
    enterprise_id: Id
    pd_percent: float = Field(ge=0.0, le=100.0, description="违约概率 0-100")
    ioy_percent: float = Field(ge=0.0, le=100.0, description="履约能力 0-100")
    factors: list[str] = Field(default_factory=list, description="影响因子列表")
    last_updated_at: IsoTimestamp
    data_sources: list[str] = Field(default_factory=list, description="数据来源")


class PerfTrend(_PerfBase):
    month_iso: str = Field(description="ISO 月份, 如 2026-08")
    pd: float = Field(ge=0.0, le=100.0)
    ioy: float = Field(ge=0.0, le=100.0)
