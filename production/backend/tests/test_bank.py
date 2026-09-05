"""CORE-01b 银行信任培育期渐进解锁 API 测试.

覆盖 8 个端点:
    GET    /api/v1/bank                              列出所有银行
    GET    /api/v1/bank/{bank_id}/trust-profile       信任档案
    POST   /api/v1/bank/{bank_id}/upgrade-stage       升级阶段
    GET    /api/v1/bank/{bank_id}/risk-letters        风险提示函列表
    POST   /api/v1/bank/{bank_id}/risk-letters        生成风险提示函
    GET    /api/v1/bank/{bank_id}/decisions           决策日志
    POST   /api/v1/bank/{bank_id}/decisions           提交决策
    GET    /api/v1/bank/{bank_id}/statistics          统计数据

注意: router.py 由用户统一集成, 此处仅在测试期通过 app.include_router 临时挂载.
"""

import pytest

# === 测试期临时挂载 bank 路由 (用户将在 router.py 中统一集成) ===
# 注意: 需精确匹配 /bank/ 前缀, 避免与已注册的 /banks (复数) 冲突
from app.api.v1.bank import bank_router
from app.main import app

_BANK_ROUTE_REGISTERED = False
for _r in app.routes:
    _path = getattr(_r, "path", "")
    # 精确匹配 /api/v1/bank 或 /api/v1/bank/..., 不能匹配 /api/v1/banks
    if _path == "/api/v1/bank" or _path.startswith("/api/v1/bank/"):
        _BANK_ROUTE_REGISTERED = True
        break
if not _BANK_ROUTE_REGISTERED:
    app.include_router(bank_router, prefix="/api/v1")


pytestmark = pytest.mark.asyncio


# === 内置 mock 银行 ID (与 bank_service 种子数据对齐) ===
BANK_SDB = "BANK-SDB"  # 深圳发展银行 (L4_READONLY 培育期)
BANK_HZB = "BANK-HZB"  # 杭州银行 (L3_ADVISORY 验证期)
BANK_CMB = "BANK-CMB"  # 招商银行 (L2_SMALL_AUTO 信任期)


class TestBankList:
    """端点 1: GET /bank - 列出所有银行."""

    async def test_list_banks_returns_200(self, client):
        r = await client.get("/api/v1/bank")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)
        # 至少 2 家银行
        assert len(body["data"]) >= 2
        # 验证字段 camelCase alias
        first = body["data"][0]
        assert "bankId" in first
        assert "bankName" in first
        assert "stage" in first

    async def test_list_banks_contains_seed_banks(self, client):
        r = await client.get("/api/v1/bank")
        bank_ids = [b["bankId"] for b in r.json()["data"]]
        assert BANK_SDB in bank_ids
        assert BANK_HZB in bank_ids
        assert BANK_CMB in bank_ids


class TestTrustProfile:
    """端点 2: GET /bank/{bank_id}/trust-profile - 信任档案."""

    async def test_get_trust_profile_l4(self, client):
        r = await client.get(f"/api/v1/bank/{BANK_SDB}/trust-profile")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        profile = body["data"]
        assert profile is not None
        assert profile["bankId"] == BANK_SDB
        assert profile["bankName"] == "深圳发展银行"
        assert profile["stage"] == "L4_READONLY"
        assert profile["joinedMonths"] == 3
        assert 0.0 <= profile["conversionRate"] <= 1.0
        assert 0.0 <= profile["nextStageUnlockProgress"] <= 1.0
        # 验证 stageDescription 含培育期说明
        assert "培育期" in profile["stageDescription"]

    async def test_get_trust_profile_not_found(self, client):
        r = await client.get("/api/v1/bank/BANK-NONEXISTENT/trust-profile")
        assert r.status_code == 200
        body = r.json()
        # make_ok 包装, code=404 表示未找到
        assert body["code"] == 404
        assert body["data"] is None

    async def test_trust_profile_l2_stage(self, client):
        """L2 信任期档案验证."""
        r = await client.get(f"/api/v1/bank/{BANK_CMB}/trust-profile")
        profile = r.json()["data"]
        assert profile["stage"] == "L2_SMALL_AUTO"
        assert profile["joinedMonths"] == 16


class TestUpgradeStage:
    """端点 3: POST /bank/{bank_id}/upgrade-stage - 升级阶段."""

    async def test_upgrade_l4_insufficient_threshold(self, client):
        """L4 银行未达阈值, 升级失败, 返回未达阈值原因."""
        r = await client.post(f"/api/v1/bank/{BANK_SDB}/upgrade-stage")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        result = body["data"]
        assert result["upgraded"] is False
        assert result["previousStage"] == "L4_READONLY"
        assert result["currentStage"] == "L4_READONLY"
        # 失败原因包含至少一项阈值未达
        assert result["reason"]
        assert result["reason"] != ""

    async def test_upgrade_nonexistent_bank(self, client):
        """不存在的银行, 升级失败."""
        r = await client.post("/api/v1/bank/BANK-NOPE/upgrade-stage")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["upgraded"] is False
        assert "不存在" in body["data"]["reason"]


class TestRiskLetters:
    """端点 4 & 5: 风险提示函 GET / POST."""

    async def test_list_risk_letters_returns_seed(self, client):
        """列出风险提示函, 至少 5 条种子."""
        r = await client.get(f"/api/v1/bank/{BANK_SDB}/risk-letters")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        letters = body["data"]
        # 深圳发展银行至少 3 条种子 (LTR-2026-0001/0002/0003)
        assert len(letters) >= 3
        first = letters[0]
        assert "letterId" in first
        assert "bankId" in first
        assert "enterpriseId" in first
        assert "riskLevel" in first
        assert "summary" in first
        assert "recommendations" in first
        assert "generatedAt" in first

    async def test_list_risk_letters_filter_by_enterprise(self, client):
        """按企业筛选风险提示函 (query param enterpriseId)."""
        # E001 在 BANK-SDB 有 LTR-2026-0001
        r = await client.get(
            f"/api/v1/bank/{BANK_SDB}/risk-letters?enterpriseId=E001"
        )
        assert r.status_code == 200
        letters = r.json()["data"]
        assert len(letters) >= 1
        for letter in letters:
            assert letter["enterpriseId"] == "E001"

    async def test_generate_risk_letter(self, client):
        """生成新风险提示函 (L4 培育期 AI 唯一输出)."""
        payload = {
            "enterpriseId": "E005",
            "enterpriseName": "北京智能装备",
            "riskLevel": "medium",
            "summary": "近 3 个月应收账款账龄延长, 周转率下降 18%",
            "recommendations": ["加强贷后回款监控", "建议补充担保措施"],
        }
        r = await client.post(
            f"/api/v1/bank/{BANK_SDB}/risk-letters", json=payload
        )
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        letter = body["data"]
        assert letter["letterId"].startswith("LTR-")
        assert letter["bankId"] == BANK_SDB
        assert letter["enterpriseId"] == "E005"
        assert letter["riskLevel"] == "medium"
        assert letter["summary"] == payload["summary"]
        assert len(letter["recommendations"]) == 2


class TestDecisions:
    """端点 6 & 7: 决策日志 GET / POST."""

    async def test_list_decisions_returns_seed(self, client):
        r = await client.get(f"/api/v1/bank/{BANK_CMB}/decisions")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        decisions = body["data"]
        # 招商银行至少 2 条种子决策
        assert len(decisions) >= 2
        first = decisions[0]
        assert "decisionId" in first
        assert "bankId" in first
        assert "aiRecommendation" in first
        assert "bankFinalDecision" in first
        assert "autoHandled" in first
        assert "stage" in first

    async def test_submit_decision_l2_small_auto(self, client):
        """L2 银行提交 <50 万决策, 应自动处理 (autoHandled=True)."""
        payload = {
            "enterpriseId": "E006",
            "enterpriseName": "上海微电子",
            "amount": 25_000_000,  # 25 万元 <50 万阈值
            "aiRecommendation": "approve",
            "bankFinalDecision": "pending",  # 让 AI 自动决策
            "reason": "信任期小额自动放行测试",
        }
        r = await client.post(
            f"/api/v1/bank/{BANK_CMB}/decisions", json=payload
        )
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        decision = body["data"]
        assert decision["autoHandled"] is True
        # AI 自动处理时, 最终决策应与 AI 建议一致
        assert decision["bankFinalDecision"] == "approve"
        assert decision["stage"] == "L2_SMALL_AUTO"

    async def test_submit_decision_l2_large_manual(self, client):
        """L2 银行提交 >50 万决策, 仍需人工 (autoHandled=False)."""
        payload = {
            "enterpriseId": "E007",
            "enterpriseName": "成都生物医药",
            "amount": 80_000_000,  # 80 万元 >50 万阈值
            "aiRecommendation": "review",
            "bankFinalDecision": "approve",
            "reason": "信任期大额仍需人工",
        }
        r = await client.post(
            f"/api/v1/bank/{BANK_CMB}/decisions", json=payload
        )
        assert r.status_code == 201
        decision = r.json()["data"]
        assert decision["autoHandled"] is False
        assert decision["bankFinalDecision"] == "approve"

    async def test_submit_decision_l4_always_manual(self, client):
        """L4 银行永远全人工, autoHandled 始终 False."""
        payload = {
            "enterpriseId": "E008",
            "enterpriseName": "天津港物流",
            "amount": 5_000_000,  # 小额
            "aiRecommendation": "approve",
            "bankFinalDecision": "approve",
            "reason": "培育期零拦截, 全人工",
        }
        r = await client.post(
            f"/api/v1/bank/{BANK_SDB}/decisions", json=payload
        )
        assert r.status_code == 201
        decision = r.json()["data"]
        assert decision["autoHandled"] is False
        assert decision["stage"] == "L4_READONLY"


class TestStatistics:
    """端点 8: GET /bank/{bank_id}/statistics - 统计数据."""

    async def test_get_statistics(self, client):
        r = await client.get(f"/api/v1/bank/{BANK_CMB}/statistics")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        stats = body["data"]
        assert stats["bankId"] == BANK_CMB
        # 招商银行至少 2 条种子决策
        assert stats["totalLoans"] >= 2
        # 至少 1 条自动通过 (DEC-2026-0003)
        assert stats["autoApprovedCount"] >= 1
        # 至少 1 条拒绝 (DEC-2026-0004)
        assert stats["rejectedCount"] >= 1
        assert stats["totalAmountCents"] > 0

    async def test_get_statistics_l4_bank(self, client):
        """L4 银行统计 (autoApprovedCount 应为 0)."""
        r = await client.get(f"/api/v1/bank/{BANK_SDB}/statistics")
        stats = r.json()["data"]
        assert stats["autoApprovedCount"] == 0  # L4 全人工
        assert stats["totalLoans"] >= 1
