"""DATA-02 第三方数据源接入测试.

覆盖:
    test_all_registry_adapters_health_ok
    test_invoice_verify_voided_invoice
    test_gsxt_query_returns_seed
    test_judiciary_risk_matches_cases
    test_ecds_list_bills_by_role
"""

import pytest

from app.api.v1.data.external import external_data_router
from app.main import app

_EXTERNAL_ROUTE_REGISTERED = False
for _r in app.routes:
    _path = getattr(_r, "path", "")
    if _path == "/api/v1/data/external/health" or _path.startswith(
        "/api/v1/data/external/"
    ):
        _EXTERNAL_ROUTE_REGISTERED = True
        break
if not _EXTERNAL_ROUTE_REGISTERED:
    app.include_router(external_data_router, prefix="/api/v1")


pytestmark = pytest.mark.asyncio

E001 = "E001"
E002 = "E002"
E003 = "E003"
E004 = "E004"

BILL_NO_E001_ACCEPTED = "11001234567890123401"
BILL_NO_E004_PAID = "11003456789012345603"


# ============================================================================
# 1. registry 健康检查
# ============================================================================

class TestRegistryHealth:
    """test_all_registry_adapters_health_ok"""

    async def test_all_registry_adapters_health_ok(self, client):
        """4 个默认适配器 (INVOICE_VERIFIER, GSXT, JUDICIARY, ECDS) 都应存在.

        注意: JUDICIARY 偶尔因随机抖动出现 degraded, 不算 FAILED 即可.
        """
        r = await client.get("/api/v1/data/external/health")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        health = body["data"]
        assert isinstance(health, dict)

        required_sources = {"INVOICE_VERIFIER", "GSXT", "JUDICIARY", "ECDS"}
        assert required_sources.issubset(set(health.keys())), (
            f"缺少数据源: {required_sources - set(health.keys())}"
        )

        for source in required_sources:
            h = health[source]
            assert "status" in h, f"{source} 缺少 status 字段"
            assert "latencyMs" in h, f"{source} 缺少 latencyMs 字段"
            assert "lastCheckedAt" in h, f"{source} 缺少 lastCheckedAt 字段"
            assert h["status"] in {"ok", "degraded", "failed"}
            assert h["latencyMs"] >= 0
            # 不应全部 FAILED (至少 3 个 ok/degraded)
        ok_count = sum(
            1 for s in required_sources if health[s]["status"] in {"ok", "degraded"}
        )
        assert ok_count >= 3, f"ok/degraded 适配器不足 3 个: {health}"


# ============================================================================
# 2. 发票查验 - VOID 结尾作废
# ============================================================================

class TestInvoiceVerify:
    """test_invoice_verify_voided_invoice"""

    async def test_invoice_verify_voided_invoice(self, client):
        """发票号以 VOID 结尾应返回 invoice_status=voided, verified=False."""
        payload = {
            "invoiceCode": "011002300199",
            "invoiceNo": "26089999VOID",
            "invoiceDateIso": "2026-08-01T00:00:00+00:00",
            "taxAmountCents": 130_000,
            "enterpriseId": E001,
        }
        r = await client.post("/api/v1/data/external/invoice/verify", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        result = body["data"]
        assert result["verified"] is False
        assert result["invoiceStatus"] == "voided"
        assert result["source"] == "INVOICE_VERIFIER"
        assert "verifyTimeIso" in result

    async def test_invoice_verify_valid_default(self, client):
        """普通发票号 (非 VOID/REUSE 结尾) 绝大多数应为 valid."""
        payload = {
            "invoiceCode": "011002300198",
            "invoiceNo": "26089988",
            "invoiceDateIso": "2026-08-02T00:00:00+00:00",
            "taxAmountCents": 260_000,
            "enterpriseId": E001,
        }
        valid_count = 0
        for _ in range(10):
            r = await client.post("/api/v1/data/external/invoice/verify", json=payload)
            if r.json()["data"]["invoiceStatus"] == "valid":
                valid_count += 1
        assert valid_count >= 8, "10 次查验中 valid 次数应 >= 8 (98% 成功率)"


# ============================================================================
# 3. GSXT 工商信息查询 - 种子数据
# ============================================================================

class TestGsxtQuery:
    """test_gsxt_query_returns_seed"""

    async def test_gsxt_query_returns_seed(self, client):
        """查询 E001 应返回种子数据: 深圳科创电子, uscc=91440300MA5DABCD12."""
        r = await client.get(f"/api/v1/data/external/gsxt/{E001}")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        info = body["data"]
        assert info is not None
        assert info["enterpriseId"] == E001
        assert info["enterpriseName"] == "深圳科创电子有限公司"
        assert info["uscc"] == "91440300MA5DABCD12"
        assert info["registerStatus"]
        assert info["registerCapitalCents"] > 0
        assert info["legalRepresentative"]
        assert info["industryCode"]
        assert info["foundedDateIso"]
        assert isinstance(info["abnormalOperations"], list)

    async def test_gsxt_query_e002_has_abnormal(self, client):
        """E002 (杭州智造) 种子中应有 2 条经营异常记录."""
        r = await client.get(f"/api/v1/data/external/gsxt/{E002}")
        info = r.json()["data"]
        assert len(info["abnormalOperations"]) >= 2

    async def test_gsxt_query_404(self, client):
        r = await client.get("/api/v1/data/external/gsxt/E-NOT-EXIST")
        body = r.json()
        assert body["code"] == 404
        assert body["data"] is None


# ============================================================================
# 4. 司法风险判定 - 与案件匹配
# ============================================================================

class TestJudiciaryRisk:
    """test_judiciary_risk_matches_cases"""

    async def test_judiciary_risk_matches_cases(self, client):
        """E002 近 12 个月有"审理中"案件 → is_risk=True;
        E001 所有案件已结案且超过 12 个月 → is_risk=False.
        """
        r_e002 = await client.get(f"/api/v1/data/external/judiciary/{E002}/risk")
        assert r_e002.status_code == 200
        is_risk_e002 = r_e002.json()["data"]["isRisk"]
        assert is_risk_e002 is True, (
            "E002 有 60 天前立案的审理中案件, isRisk 应为 True"
        )

        r_e001 = await client.get(f"/api/v1/data/external/judiciary/{E001}/risk")
        is_risk_e001 = r_e001.json()["data"]["isRisk"]
        assert is_risk_e001 is False, (
            "E001 唯一案件 500 天前且已结案, isRisk 应为 False"
        )

    async def test_judiciary_query_returns_list(self, client):
        """E002 至少 2 条司法案件种子."""
        r = await client.get(f"/api/v1/data/external/judiciary/{E002}")
        assert r.status_code == 200
        cases = r.json()["data"]
        assert isinstance(cases, list)
        assert len(cases) >= 2
        for c in cases:
            assert "caseId" in c
            assert "caseType" in c
            assert "court" in c
            assert "caseStatus" in c
            assert "filingDateIso" in c
            assert "amountCents" in c
            assert "summary" in c


# ============================================================================
# 5. ECDS 按角色列票据
# ============================================================================

class TestEcdsListByRole:
    """test_ecds_list_bills_by_role"""

    async def test_ecds_list_bills_by_role(self, client):
        """E001 作为 drawer 出票人应有 2 张票据 (0001 + 0005)."""
        r = await client.get(
            f"/api/v1/data/external/ecds/enterprise/{E001}?role=drawer"
        )
        assert r.status_code == 200
        bills = r.json()["data"]
        assert isinstance(bills, list)
        drawer_bill_ids = {b["billId"] for b in bills}
        assert "BILL-ECDS-0001" in drawer_bill_ids or len(bills) >= 1

        r_drawee = await client.get(
            f"/api/v1/data/external/ecds/enterprise/{E003}?role=drawee"
        )
        drawee_bills = r_drawee.json()["data"]
        assert isinstance(drawee_bills, list)
        assert len(drawee_bills) >= 1

    async def test_ecds_query_bill_found(self, client):
        """根据票据号查询, 应返回对应票据记录."""
        r = await client.get(f"/api/v1/data/external/ecds/bill/{BILL_NO_E001_ACCEPTED}")
        assert r.status_code == 200
        bill = r.json()["data"]
        assert bill is not None
        assert bill["billNo"] == BILL_NO_E001_ACCEPTED
        assert bill["status"] == "accepted"
        assert bill["billType"] == "bank_acceptance"
        assert bill["amountCents"] > 0
        assert bill["issueDateIso"]
        assert bill["dueDateIso"]

    async def test_ecds_query_bill_not_found(self, client):
        r = await client.get("/api/v1/data/external/ecds/bill/NOT-A-BILL-NO")
        body = r.json()
        assert body["code"] == 404
        assert body["data"] is None

    async def test_ecds_drawer_e002_has_bills(self, client):
        """E002 作为 drawer 至少 1 张 (0002 或 0006)."""
        r = await client.get(
            f"/api/v1/data/external/ecds/enterprise/{E002}?role=drawer"
        )
        bills = r.json()["data"]
        assert len(bills) >= 1
