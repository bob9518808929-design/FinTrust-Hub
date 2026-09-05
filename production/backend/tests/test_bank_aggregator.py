"""DATA-01 银企直连 API 测试 (R1.1).

覆盖 5 个核心场景:
    test_list_adapters_returns_6_banks
    test_oauth_flow_returns_token
    test_list_accounts_aggregates_multiple_adapters
    test_list_transactions_has_expected_volume
    test_refresh_marks_aggregation_result

注意: 路由通过 v1/router.py 统一集成 (api/v1/data/bank/*).
"""

import pytest

pytestmark = pytest.mark.asyncio


_SEED_EID = "E001"
_ADAPTER_IDS = [
    "ADAPTER-ICBC", "ADAPTER-CCB", "ADAPTER-ABC",
    "ADAPTER-BOC", "ADAPTER-BOCOM", "ADAPTER-CMB",
]


class TestListAdapters:
    """GET /api/v1/data/bank/adapters - 列出 6 家银行适配器."""

    async def test_list_adapters_returns_6_banks(self, client):
        r = await client.get("/api/v1/data/bank/adapters")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert isinstance(data, list)
        assert len(data) == 6

        adapter_ids = [a["adapterId"] for a in data]
        for aid in _ADAPTER_IDS:
            assert aid in adapter_ids

        for adapter in data:
            assert "adapterId" in adapter
            assert "bankName" in adapter
            assert "adapterStatus" in adapter
            assert "authProtocol" in adapter
            assert "supportsOauth2" in adapter
            assert adapter["adapterStatus"] in ("online", "degraded", "offline")
            assert adapter["authProtocol"] in ("oauth2", "direct_login", "api_key")
            assert isinstance(adapter["supportsOauth2"], bool)


class TestOAuthFlow:
    """POST /oauth/authorize + POST /oauth/callback - OAuth 完整流程."""

    async def test_oauth_flow_returns_token(self, client):
        aid = "ADAPTER-ICBC"
        redirect_uri = "https://example.test/callback"

        # Step 1: 发起授权
        auth_resp = await client.post(
            "/api/v1/data/bank/oauth/authorize",
            json={
                "enterpriseId": _SEED_EID,
                "adapterId": aid,
                "redirectUri": redirect_uri,
                "scopes": ["accounts:read", "transactions:read"],
            },
        )
        assert auth_resp.status_code == 200
        auth_body = auth_resp.json()
        assert auth_body["code"] == 0
        assert "authorizationUrl" in auth_body["data"]
        assert auth_body["data"]["authorizationUrl"].startswith("https://")
        assert "state=" in auth_body["data"]["authorizationUrl"]

        # Step 2: 从 URL 中提取 state (mock 回调)
        auth_url = auth_body["data"]["authorizationUrl"]
        state_value = ""
        for part in auth_url.split("?")[-1].split("&"):
            k, _, v = part.partition("=")
            if k == "state":
                state_value = v
                break
        assert state_value != ""

        # Step 3: 完成回调换 token
        cb_resp = await client.post(
            "/api/v1/data/bank/oauth/callback",
            params={
                "enterpriseId": _SEED_EID,
                "adapterId": aid,
                "code": "mock-auth-code-12345",
                "state": state_value,
            },
        )
        assert cb_resp.status_code == 201
        cb_body = cb_resp.json()
        assert cb_body["code"] == 0
        token = cb_body["data"]
        assert "accessToken" in token
        assert "refreshToken" in token
        assert "expiresAt" in token
        assert token["enterpriseId"] == _SEED_EID
        assert token["adapterId"] == aid
        assert token["accessToken"].startswith("ak-")
        assert token["refreshToken"].startswith("rk-")


class TestListAccounts:
    """GET /accounts - 聚合查询多适配器账户."""

    async def test_list_accounts_aggregates_multiple_adapters(self, client):
        r = await client.get(
            "/api/v1/data/bank/accounts",
            params={"enterpriseId": _SEED_EID},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        accounts = body["data"]
        assert isinstance(accounts, list)

        # 6 家适配器 × 5 账户/适配器 = 30 账户
        assert len(accounts) == 30

        adapter_ids_in_accs = set(a["adapterId"] for a in accounts)
        assert len(adapter_ids_in_accs) == 6
        for aid in _ADAPTER_IDS:
            assert aid in adapter_ids_in_accs

        for acc in accounts:
            assert "accountId" in acc
            assert "accountNoMasked" in acc
            assert "accountType" in acc
            assert "balanceCents" in acc
            assert "currency" in acc
            assert "enterpriseId" in acc
            assert "adapterId" in acc
            assert acc["enterpriseId"] == _SEED_EID
            assert acc["currency"] == "CNY"
            assert acc["accountType"] in ("basic", "general", "special", "loan")
            assert int(acc["balanceCents"]) >= 0

        # 按单个 adapter 过滤
        r2 = await client.get(
            "/api/v1/data/bank/accounts",
            params={"enterpriseId": _SEED_EID, "adapterId": "ADAPTER-CMB"},
        )
        accounts_cmb = r2.json()["data"]
        assert len(accounts_cmb) == 5
        for a in accounts_cmb:
            assert a["adapterId"] == "ADAPTER-CMB"


class TestListTransactions:
    """GET /transactions - 聚合查询交易量验证."""

    async def test_list_transactions_has_expected_volume(self, client):
        r = await client.get(
            "/api/v1/data/bank/transactions",
            params={"enterpriseId": _SEED_EID, "days": 30},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        txs = body["data"]
        assert isinstance(txs, list)

        # 6 家 × 5 账户 × 20 条交易 = 600 条
        assert len(txs) == 600

        directions = set(t["direction"] for t in txs)
        assert "in" in directions
        assert "out" in directions

        for tx in txs:
            assert "txId" in tx
            assert "accountId" in tx
            assert "amountCents" in tx
            assert "direction" in tx
            assert "counterpartyName" in tx
            assert "counterpartyAccount" in tx
            assert "purpose" in tx
            assert "txTimeIso" in tx
            assert "enterpriseId" in tx
            assert "adapterId" in tx
            assert tx["enterpriseId"] == _SEED_EID
            assert tx["direction"] in ("in", "out")
            assert int(tx["amountCents"]) > 0
            assert tx["counterpartyName"] != ""
            assert tx["purpose"] != ""

        # 按 adapter 过滤: 单家 5×20=100 条
        r2 = await client.get(
            "/api/v1/data/bank/transactions",
            params={"enterpriseId": _SEED_EID, "adapterId": "ADAPTER-CCB", "days": 30},
        )
        txs_ccb = r2.json()["data"]
        assert len(txs_ccb) == 100
        for t in txs_ccb:
            assert t["adapterId"] == "ADAPTER-CCB"


class TestRefresh:
    """POST /refresh - 聚合刷新结果标记."""

    async def test_refresh_marks_aggregation_result(self, client):
        r = await client.post(
            "/api/v1/data/bank/refresh",
            params={"enterpriseId": _SEED_EID},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        result = body["data"]

        assert "successCount" in result
        assert "failedCount" in result
        assert "resultsByAdapter" in result
        assert isinstance(result["resultsByAdapter"], dict)

        assert result["successCount"] + result["failedCount"] == 6
        assert len(result["resultsByAdapter"]) == 6

        for aid in _ADAPTER_IDS:
            assert aid in result["resultsByAdapter"]
            adapter_result = result["resultsByAdapter"][aid]
            assert "success" in adapter_result
            assert "message" in adapter_result
            assert isinstance(adapter_result["success"], bool)
            assert isinstance(adapter_result["message"], str)
            assert adapter_result["message"] != ""

        # 仅刷新指定 adapter
        r2 = await client.post(
            "/api/v1/data/bank/refresh",
            params={
                "enterpriseId": _SEED_EID,
                "adapterIds": ["ADAPTER-ABC", "ADAPTER-BOC"],
            },
        )
        r2_body = r2.json()["data"]
        assert r2_body["successCount"] + r2_body["failedCount"] == 2
        assert len(r2_body["resultsByAdapter"]) == 2
        assert "ADAPTER-ABC" in r2_body["resultsByAdapter"]
        assert "ADAPTER-BOC" in r2_body["resultsByAdapter"]
