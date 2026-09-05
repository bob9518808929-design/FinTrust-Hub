"""APP-02 工人极简登录端到端测试.

覆盖 5 用例:
    1. 合法企业码 + 工号 → 200 + JWT 含 sub/role/enterpriseId
    2. 企业码不存在 → 401 + "企业码或工号错误"
    3. 工号不在该企业下 → 401
    4. JWT 过期时间 = 7 天 (exp - iat ≈ 7*24*3600 秒)
    5. WORKER_AUTH_BYPASS=true 时任意输入 → mock JWT

测试策略:
    - conftest 覆盖 get_db 为 None, 走 WORKERS_SEED 内存降级
      (E001 + W01 → workerId "E001-W01")
    - .env 默认 WORKER_AUTH_BYPASS=true; 用例 1-4 显式关闭降级走真实校验,
      用例 5 显式开启降级走 mock token. monkeypatch 自动还原.
"""

import time

import pytest

from app.config import settings
from app.deps import _decode_jwt

pytestmark = pytest.mark.asyncio

AUTH_URL = "/api/v1/auth/worker-login"
SEVEN_DAYS_SEC = 7 * 24 * 3600


class TestWorkerLogin:
    async def test_valid_credentials_returns_jwt(self, client, monkeypatch):
        """合法企业码 + 工号 → 200 + JWT 含 sub/role/enterpriseId."""
        monkeypatch.setattr(settings, "WORKER_AUTH_BYPASS", False)
        r = await client.post(
            AUTH_URL,
            json={"enterpriseCode": "E001", "workerNo": "W01"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["workerId"] == "E001-W01"
        assert data["enterpriseId"] == "E001"
        assert data["role"] == "worker"
        assert data["token"]
        payload = _decode_jwt(data["token"])
        assert payload is not None
        assert payload["sub"] == "E001-W01"
        assert payload["role"] == "worker"
        assert payload["enterpriseId"] == "E001"

    async def test_unknown_enterprise_code_returns_401(self, client, monkeypatch):
        """企业码不存在 → 401."""
        monkeypatch.setattr(settings, "WORKER_AUTH_BYPASS", False)
        r = await client.post(
            AUTH_URL,
            json={"enterpriseCode": "NOPE", "workerNo": "W01"},
        )
        assert r.status_code == 401
        assert "企业码或工号错误" in r.json()["detail"]

    async def test_worker_not_in_enterprise_returns_401(self, client, monkeypatch):
        """工号不在该企业下 → 401 (E001 + 不存在的工号)."""
        monkeypatch.setattr(settings, "WORKER_AUTH_BYPASS", False)
        r = await client.post(
            AUTH_URL,
            json={"enterpriseCode": "E001", "workerNo": "X99"},
        )
        assert r.status_code == 401
        assert "企业码或工号错误" in r.json()["detail"]

    async def test_jwt_expiry_is_seven_days(self, client, monkeypatch):
        """JWT 过期时间 = 7 天 (exp - iat ≈ 7*24*3600, 允许 ±60s 误差)."""
        monkeypatch.setattr(settings, "WORKER_AUTH_BYPASS", False)
        r = await client.post(
            AUTH_URL,
            json={"enterpriseCode": "E001", "workerNo": "W01"},
        )
        assert r.status_code == 200
        token = r.json()["data"]["token"]
        payload = _decode_jwt(token)
        assert payload is not None
        assert payload["iat"] is not None
        assert payload["exp"] is not None
        delta = int(payload["exp"]) - int(payload["iat"])
        assert abs(delta - SEVEN_DAYS_SEC) <= 60, f"exp-iat={delta}, 期望≈{SEVEN_DAYS_SEC}"

    async def test_bypass_returns_mock_jwt_for_any_input(self, client, monkeypatch):
        """WORKER_AUTH_BYPASS=true 时任意输入 → mock JWT (sub=W001)."""
        monkeypatch.setattr(settings, "WORKER_AUTH_BYPASS", True)
        r = await client.post(
            AUTH_URL,
            json={"enterpriseCode": "ANY", "workerNo": "THING"},
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["workerId"] == "W001"
        assert data["enterpriseId"] == "E001"
        payload = _decode_jwt(data["token"])
        assert payload is not None
        assert payload["sub"] == "W001"
        assert payload["role"] == "worker"
        # mock token 同样 7 天过期
        delta = int(payload["exp"]) - int(payload["iat"])
        assert abs(delta - SEVEN_DAYS_SEC) <= 60
        # 等待一小段确保 iat < now (签发时间在请求前)
        assert int(payload["iat"]) <= int(time.time()) + 5
