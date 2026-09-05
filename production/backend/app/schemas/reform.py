"""R10 案例学习引擎 schemas (V1 混合架构补充).

镜像 contracts/scorecard.ts 的 R10 案例库部分. ReformCase 本体仍在 scorecard.py.
本文件仅定义 R10 混合架构新增的查询/统计 schema, 供 reform 路由复用.

字段命名: snake_case (PEP 8), 通过 alias_generator 与前端 camelCase 契约对齐.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SimilarCaseQuery(BaseModel):
    """R10 相似案例检索入参 (query string 形式, GET /reform/cases/similar)."""

    model_config = ConfigDict(populate_by_name=True)

    query: str = Field(default="", description="自然语言查询 (行业/结果/特征)")
    top_k: int = Field(alias="topK", default=5, ge=1, le=50, description="返回 top-K 案例数")


class CaseStats(BaseModel):
    """R10 案例库统计 (总数 / 向量模式开关 / 行业分布).

    用于运营台展示案例库规模 + 当前检索策略 (linear_scan / vector).
    """

    model_config = ConfigDict(populate_by_name=True)

    total_cases: int = Field(alias="totalCases", ge=0, description="案例库总数")
    vector_mode_enabled: bool = Field(
        alias="vectorModeEnabled",
        description="是否已切换向量检索 (案例数 ≥ 阈值)",
    )
    vector_index_threshold: int = Field(
        alias="vectorIndexThreshold",
        description="向量检索切换阈值 (V1 混合架构)",
    )
    industry_distribution: dict[str, int] = Field(
        alias="industryDistribution",
        default_factory=dict,
        description="行业分布 (industry -> 案例数)",
    )
    outcome_distribution: dict[str, int] = Field(
        alias="outcomeDistribution",
        default_factory=dict,
        description="结果分布 (success/abandoned/failed -> 案例数)",
    )
    search_strategy: Literal["linear_scan", "vector"] = Field(
        alias="searchStrategy",
        description="当前检索策略",
    )
