"""健康检查 + 根路由 + OpenAPI 文档 测试."""

import pytest

pytestmark = pytest.mark.asyncio


class TestHealth:
    async def test_health(self, client):
        r = await client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["status"] == "ok"
        assert body["data"]["version"] == "3.1.0"

    async def test_root(self, client):
        r = await client.get("/")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert "docs" in body["data"]
        assert "health" in body["data"]

    async def test_openapi_docs(self, client):
        r = await client.get("/api/docs")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")

    async def test_openapi_json(self, client):
        r = await client.get("/api/openapi.json")
        assert r.status_code == 200
        spec = r.json()
        assert spec["info"]["title"] == "FinTrust Hub API"
        assert spec["info"]["version"] == "3.1.0"
        # 至少 60 个端点
        paths = spec["paths"]
        assert len(paths) >= 60, f"仅 {len(paths)} 个路径, 期望 ≥60"

    async def test_cors_headers(self, client):
        r = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert r.status_code in (200, 204)
