"""MOD-03 征信与审批 schemas (R5.1).

人行征信报告 + 综合评分 + 建议.

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, Id, IsoTimestamp


# === 枚举 ===

CreditRating = Literal["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]
CreditDecision = Literal["approve", "review", "reject"]


class _CreditBase(BaseModel):
    """征信 schema 公共配置: snake_case 字段 + camelCase alias + 双向填充."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 征信报告 ===

class CreditReport(_CreditBase):
    """人行征信报告 (解析后的结构化数据).

    字段单位均采用分 (cents), 与全仓 AmountInCents 一致.
    """

    enterprise_id: Id = Field(description="企业 ID")
    enterprise_name: str = Field(default="", description="企业名称")
    uscc: str = Field(default="", description="统一社会信用代码")
    loan_balance_cents: AmountInCents = Field(
        default=0, description="当前对外贷款余额 (分)"
    )
    guaranteed_amount_cents: AmountInCents = Field(
        default=0, description="对外担保余额 (分)"
    )
    overdue_count: int = Field(default=0, ge=0, description="逾期笔数")
    interest_arrears_cents: AmountInCents = Field(
        default=0, description="欠息金额 (分)"
    )
    concern_class_count: int = Field(
        default=0, ge=0, description="关注类贷款笔数 (五级分类)"
    )
    credit_rating: CreditRating = Field(
        default="BBB", description="信用评级 AAA-D"
    )
    inquiry_at_iso: IsoTimestamp = Field(description="查询时间 (ISO)")
    raw_source: str = Field(default="mock", description="数据来源 pboc/mock")


# === 综合评分 ===

class CreditEvaluation(_CreditBase):
    """企业综合信用评估 (基于征信报告 + 行业 + 替代数据)."""

    enterprise_id: Id = Field(description="企业 ID")
    enterprise_name: str = Field(default="", description="企业名称")
    credit_rating: CreditRating = Field(description="信用评级 AAA-D")
    credit_score: int = Field(ge=0, le=1000, description="综合信用分 0-1000")
    decision: CreditDecision = Field(
        description="建议 approve/review/reject"
    )
    factors: list[str] = Field(default_factory=list, description="影响因子列表")
    reasoning: str = Field(default="", description="评估理由")
    evaluated_at_iso: IsoTimestamp = Field(description="评估时间")
    report: "CreditReport" = Field(description="原始征信报告")


__all__ = [
    "CreditRating",
    "CreditDecision",
    "CreditReport",
    "CreditEvaluation",
]
