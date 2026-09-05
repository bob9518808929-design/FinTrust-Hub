"""pytest 共享 fixtures.

设计:
    1. 覆盖 get_db 依赖, 强制 yield None (避免连接 PostgreSQL, 走内存 store)
    2. 提供 httpx.AsyncClient (ASGI transport, 不需要真实端口)
    3. 提供种子企业 ID (E001) 等常用测试数据

运行: pytest tests/ -v
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.database import get_db
from app.main import app


# === 全局 fixture ===

@pytest.fixture(scope="session")
def event_loop():
    """session 级事件循环 (pytest-asyncio)."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def _override_db() -> Any:
    """自动覆盖 get_db: 强制 yield None, 走内存 store (C 档兜底)."""
    async def _fake_db() -> AsyncGenerator[None, None]:
        yield None

    app.dependency_overrides[get_db] = _fake_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _isolate_eco_sealed_storage(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    """ECO-01 密封存储隔离: 测试落盘到 tmp 目录, 不污染开发环境 data/eco_burn_state.json."""
    from app.services import eco_service as eco_mod

    monkeypatch.setattr(eco_mod, "_STATE_FILE", tmp_path / "eco_burn_state.json")
    yield


@pytest.fixture(autouse=True)
def _disable_llm_by_default(monkeypatch: pytest.MonkeyPatch) -> Any:
    """默认关闭 LLM: 测试不得发起真实 DeepSeek 请求; 需要 A 档的用例显式 monkeypatch 开启."""
    from app.services.llm_service import llm_service

    monkeypatch.setattr(type(llm_service), "available", property(lambda self: False))
    yield


@pytest.fixture(autouse=True)
def _isolate_reform_portrait_cache() -> Any:
    """R1 画像缓存隔离: 类级缓存跨测试清理, 防止上一个测试的画像来源串台."""
    from app.services.reform_service import ReformService

    ReformService._portrait_cache.clear()
    yield
    ReformService._portrait_cache.clear()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """异步 HTTP 客户端 (ASGI transport, 无需真实端口)."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"X-Request-Id": "test-req-001"},
    ) as c:
        yield c


# === 常用测试数据 ===

@pytest.fixture
def sample_enterprise_id() -> str:
    """种子企业 ID (来自 services/seed.py)."""
    return "E001"


@pytest.fixture
def sample_bank_id() -> str:
    return "BANK-001"
