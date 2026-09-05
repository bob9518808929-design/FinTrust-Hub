"""R10 案例学习引擎 V1 混合架构测试.

覆盖:
    1. 相似案例检索 (少量数据 <500 走线性扫描)
    2. 案例库统计 (总数 / 向量模式开关 / 行业分布)
    3. 阈值切换: mock 注入 ≥500 案例后自动切向量检索 (cosine)
    4. 线性模式关键词匹配命中
    5. 空库检索不报错
    6. SimilarCaseQuery / CaseStats schema 校验

运行: pytest tests/test_reform_r10.py -v
"""

import pytest

from app.schemas.reform import CaseStats, SimilarCaseQuery
from app.services.reform_service import (
    VECTOR_DIM,
    VECTOR_INDEX_THRESHOLD,
    ReformService,
    _reform_store,
)

pytestmark = pytest.mark.asyncio


# === 测试辅助 ===

def _make_case(idx: int, industry: str = "manufacturing", outcome: str = "success") -> dict:
    """构造一个最小合法案例 dict (alias 形式, 与 store 一致)."""
    return {
        "caseId": f"case-r10-{idx}",
        "enterpriseId": f"E-r10-{idx}",
        "industry": industry,
        "outcome": outcome,
        "beforeScorecard": {
            "subject": 40, "finance": 35, "tax": 30, "business": 45,
            "assets": 50, "credit": 35, "policy": 60, "capital": 40,
        },
        "afterScorecard": {
            "subject": 85, "finance": 82, "tax": 88, "business": 80,
            "assets": 85, "credit": 82, "policy": 90, "capital": 80,
        },
        "totalDays": 90,
        "totalCost": 50000,
        "totalActions": 8,
        "topLevelReached": "A",
        "storedAt": "2026-08-01T00:00:00Z",
        "signature": f"sig-r10-{idx}",
    }


async def _inject_cases(n: int, industry: str = "manufacturing") -> None:
    """向内存 store 注入 n 个案例."""
    for i in range(n):
        await _reform_store.add_case(_make_case(i, industry))


@pytest.fixture(autouse=True)
async def _clean_store():
    """每个用例前后清空 store, 避免跨用例污染 (向量模式切换敏感于总数)."""
    await _reform_store.clear_cases()
    yield
    await _reform_store.clear_cases()


# === 1. 线性模式: 相似案例检索 ===

class TestR10SimilarLinear:
    """少量数据 (<500) 走线性关键词扫描."""

    async def test_similar_returns_topk(self):
        await _inject_cases(3, industry="manufacturing")
        svc = ReformService(db=None)
        cases = await svc.search_similar_cases("manufacturing", top_k=2)
        assert len(cases) <= 2
        assert all(c.industry == "manufacturing" for c in cases)

    async def test_similar_empty_store_returns_empty(self):
        svc = ReformService(db=None)
        cases = await svc.search_similar_cases("manufacturing", top_k=5)
        assert cases == []

    async def test_similar_no_match_returns_recent(self):
        """无匹配时不空手, 返回最近 top_k (傻瓜式体验)."""
        await _inject_cases(2, industry="manufacturing")
        svc = ReformService(db=None)
        cases = await svc.search_similar_cases("完全不存在的关键词xyz", top_k=2)
        assert len(cases) == 2  # 兜底返回全部

    async def test_similar_filters_by_outcome(self):
        await _inject_cases(1, industry="trade")
        await _reform_store.add_case(_make_case(99, industry="trade", outcome="abandoned"))
        svc = ReformService(db=None)
        cases = await svc.search_similar_cases("abandoned", top_k=5)
        assert len(cases) >= 1
        assert all(c.outcome == "abandoned" for c in cases)


# === 2. 案例库统计 ===

class TestR10Stats:
    """案例库统计 (总数 / 向量模式 / 行业分布)."""

    async def test_stats_linear_mode(self):
        await _inject_cases(3, industry="manufacturing")
        await _reform_store.add_case(_make_case(100, industry="trade"))
        svc = ReformService(db=None)
        stats = await svc.get_case_stats()
        assert stats["totalCases"] == 4
        assert stats["vectorModeEnabled"] is False
        assert stats["vectorIndexThreshold"] == VECTOR_INDEX_THRESHOLD
        assert stats["searchStrategy"] == "linear_scan"
        assert stats["industryDistribution"]["manufacturing"] == 3
        assert stats["industryDistribution"]["trade"] == 1

    async def test_stats_empty_store(self):
        svc = ReformService(db=None)
        stats = await svc.get_case_stats()
        assert stats["totalCases"] == 0
        assert stats["vectorModeEnabled"] is False
        assert stats["industryDistribution"] == {}


# === 3. 阈值切换: ≥500 切向量检索 ===

class TestR10VectorMode:
    """注入 ≥500 案例后自动切换向量检索 (cosine 相似度)."""

    async def test_vector_threshold_constant(self):
        """阈值常量 = 500 (V1 混合架构契约)."""
        assert VECTOR_INDEX_THRESHOLD == 500

    async def test_vector_mode_enabled_above_threshold(self):
        await _inject_cases(VECTOR_INDEX_THRESHOLD + 1, industry="manufacturing")
        svc = ReformService(db=None)
        assert await svc._should_use_vector_index() is True
        stats = await svc.get_case_stats()
        assert stats["vectorModeEnabled"] is True
        assert stats["searchStrategy"] == "vector"

    async def test_vector_search_returns_topk(self):
        """向量模式下检索仍返回 top_k 个案例 (cosine 排序)."""
        await _inject_cases(VECTOR_INDEX_THRESHOLD + 5, industry="manufacturing")
        svc = ReformService(db=None)
        cases = await svc.search_similar_cases("制造业融资改造", top_k=3)
        assert len(cases) == 3
        assert all(c.industry == "manufacturing" for c in cases)

    async def test_vector_dim_is_256(self):
        """mock 向量固定 256 维."""
        svc = ReformService(db=None)
        vec = svc._hash_to_vector(_make_case(0))
        assert len(vec) == VECTOR_DIM == 256

    async def test_cosine_self_similarity_is_one(self):
        """同向量 cosine 相似度 = 1.0 (对角线校验)."""
        svc = ReformService(db=None)
        vec = svc._hash_to_vector(_make_case(0))
        assert abs(svc._cosine_similarity(vec, vec) - 1.0) < 1e-9

    async def test_cosine_zero_vector(self):
        """零向量 cosine = 0 (除零保护)."""
        svc = ReformService(db=None)
        assert svc._cosine_similarity([0.0] * 256, [1.0] * 256) == 0.0


# === 4. API 端点 (通过 httpx client) ===

class TestR10ApiEndpoints:
    """R10 新增 API 端点集成测试."""

    async def test_get_stats_endpoint(self, client):
        r = await client.get("/api/v1/reform/cases/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert "totalCases" in body["data"]
        assert "vectorModeEnabled" in body["data"]
        assert "searchStrategy" in body["data"]

    async def test_get_similar_endpoint(self, client):
        # 先注入 2 个案例 (走线性)
        await _inject_cases(2, industry="manufacturing")
        r = await client.get("/api/v1/reform/cases/similar", params={"query": "manufacturing", "top_k": 2})
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)
        assert len(body["data"]) <= 2

    async def test_get_similar_default_params(self, client):
        """无 query 参数也能正常返回 (兜底最近 top_k)."""
        await _inject_cases(1, industry="manufacturing")
        r = await client.get("/api/v1/reform/cases/similar")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)


# === 5. Schema 校验 ===

class TestR10Schemas:
    """CaseStats / SimilarCaseQuery schema 字段对齐前端契约."""

    async def test_similar_case_query_defaults(self):
        q = SimilarCaseQuery()
        assert q.query == ""
        assert q.top_k == 5

    async def test_similar_case_query_alias(self):
        q = SimilarCaseQuery.model_validate({"query": "制造业", "topK": 10})
        assert q.query == "制造业"
        assert q.top_k == 10

    async def test_case_stats_alias(self):
        s = CaseStats.model_validate({
            "totalCases": 5,
            "vectorModeEnabled": False,
            "vectorIndexThreshold": 500,
            "industryDistribution": {"manufacturing": 5},
            "outcomeDistribution": {"success": 5},
            "searchStrategy": "linear_scan",
        })
        assert s.total_cases == 5
        assert s.vector_mode_enabled is False
        assert s.search_strategy == "linear_scan"
