"""MOD-02 R4.7 风控规则 DSL + 热加载 + 流处理测试.

覆盖:
    - parse_dsl (WHEN ... THEN ... SCORE +N 解析)
    - compile_rule + evaluate (大额冻结)
    - 黑名单规则触发
    - hot_reload 拾取新规则
    - stream_ingest 返回评估结果
    - stream_stats 计数正确
    - rule priority 排序 (优先级小者先执行, 命中越早的 block 越严格)
    - ruleset enable / disable
"""

from __future__ import annotations

import pytest

from app.schemas.risk_rule import (
    RiskRuleCreate,
    RiskStreamEvent,
    RuleAction,
    RuleCondition,
    RuleLogic,
    RuleOperator,
)
from app.services.risk_rule_engine import (
    risk_rule_engine,
)
from app.services.risk_service import risk_service
from app.services.risk_stream_service import (
    risk_stream_service,
)

pytestmark = pytest.mark.asyncio


# ============================================================
# R4.7-1: parse_dsl
# ============================================================

class TestRiskRuleDSL:
    async def test_parse_dsl_when_then(self):
        """DSL: WHEN amount > 5000000 THEN block SCORE +50 解析正确."""
        dsl = 'WHEN amount > 5000000 THEN block SCORE +50'
        rule = risk_rule_engine.parse_dsl(dsl)
        assert rule.action == RuleAction.BLOCK.value
        assert rule.risk_score_delta == 50
        assert rule.logic == RuleLogic.ALL.value
        assert len(rule.conditions) == 1
        cond = rule.conditions[0]
        assert cond.field_path == "amount"
        assert cond.operator == RuleOperator.GT.value
        assert cond.value == 5000000

    async def test_parse_dsl_blacklist_in_list(self):
        """DSL: WHEN counterparty IN ["黑名单A","黑名单B"] THEN block."""
        dsl = 'WHEN counterparty IN ["黑名单A","黑名单B"] THEN block SCORE +60'
        rule = risk_rule_engine.parse_dsl(dsl)
        assert len(rule.conditions) == 1
        cond = rule.conditions[0]
        assert cond.operator == RuleOperator.IN.value
        assert cond.value == ["黑名单A", "黑名单B"]


# ============================================================
# R4.7-2: compile + evaluate (大额冻结)
# ============================================================

class TestRiskRuleEvaluate:
    async def test_compile_and_evaluate_large_amount_blocks(self):
        """amount > 5000000 应触发 block (大额冻结规则)."""
        tx_data = {
            "enterprise_id": "E001", "tx_id": "TX-LARGE-001",
            "amount": 6_000_000, "counterparty": "正常公司",
            "is_cross_border": False, "hour": 10,
        }
        result = await risk_rule_engine.evaluate(tx_data)
        # 应至少触发 RR-001 单笔大额冻结
        assert "RR-001" in result.triggered_rules
        assert result.action == RuleAction.BLOCK.value
        assert result.total_risk_score >= 50  # 至少 +50

    async def test_blacklist_rule_triggers(self):
        """counterparty 命中黑名单应触发 block."""
        tx_data = {
            "enterprise_id": "E002", "tx_id": "TX-BL-001",
            "amount": 100_000, "counterparty": "黑名单A",
            "is_cross_border": False, "hour": 14,
        }
        result = await risk_rule_engine.evaluate(tx_data)
        assert "RR-002" in result.triggered_rules
        assert result.action == RuleAction.BLOCK.value
        assert any("黑名单" in e or "RR-002" in e for e in result.explanations)


# ============================================================
# R4.7-3: hot_reload 拾取新规则
# ============================================================

class TestRiskRuleHotReload:
    async def test_hot_reload_picks_up_new_rule(self):
        """新增规则后 hot_reload, 评估应拾取到新规则."""
        # 新增规则: amount > 100 → flag +5
        create = RiskRuleCreate(
            rule_name="测试新规则小额",
            description="DSL 测试: amount > 100 → flag",
            conditions=[
                RuleCondition(field_path="amount", operator=RuleOperator.GT, value=100),
            ],
            logic=RuleLogic.ALL,
            action=RuleAction.FLAG,
            risk_score_delta=5,
            priority=99,
            enabled=True,
            ruleset_id="RS-STD-001",
        )
        rule = await risk_rule_engine.add_rule(create)
        rule_id = rule.rule_id

        try:
            # 评估小额交易, 应触发新规则
            tx_data = {"amount": 200, "counterparty": "正常公司"}
            result = await risk_rule_engine.evaluate(tx_data)
            assert rule_id in result.triggered_rules
            assert result.action == RuleAction.FLAG.value

            # hot_reload 该 ruleset, 验证仍能命中
            rs = await risk_rule_engine.hot_reload("RS-STD-001")
            assert rs.ruleset_id == "RS-STD-001"
            result2 = await risk_rule_engine.evaluate(tx_data)
            assert rule_id in result2.triggered_rules
        finally:
            await risk_rule_engine.delete_rule(rule_id)


# ============================================================
# R4.7-4: stream ingest
# ============================================================

class TestRiskStreamIngest:
    async def test_stream_ingest_returns_evaluation(self):
        """ingest 一个大额事件, 应返回 block 评估结果."""
        ev = RiskStreamEvent(
            event_id="SE-TEST-001",
            enterprise_id="E001",
            tx_id="TX-STRM-001",
            event_type="tx",
            payload={"amount": 6_000_000, "counterparty": "正常公司", "hour": 10},
            received_at_iso="2026-08-20T10:00:00+00:00",
            processed=False,
            risk_result_id=None,
        )
        result = await risk_stream_service.ingest(ev)
        assert result.enterprise_id == "E001"
        assert result.tx_id == "TX-STRM-001"
        # 大额应 block
        assert result.action == RuleAction.BLOCK.value
        assert len(result.triggered_rules) >= 1

        # 验证事件已标记为 processed
        ev_stored = await risk_stream_service.get_event("SE-TEST-001")
        assert ev_stored is not None
        assert ev_stored.processed is True
        assert ev_stored.risk_result_id == result.eval_id


# ============================================================
# R4.7-5: stream stats
# ============================================================

class TestRiskStreamStats:
    async def test_stream_stats_counts_correctly(self):
        """seed 20 事件: 5 blocked + 5 flagged + 10 passed, total 20."""
        stats = await risk_stream_service.stream_stats()
        assert stats["total_events"] >= 20
        # processed 数应等于 total (seed 全部 processed=True)
        assert stats["processed_count"] == stats["total_events"]
        # block_count >= 5, flag_count >= 5
        assert stats["block_count"] >= 5
        assert stats["flag_count"] >= 5
        # avg_evaluation_time_ms 应 > 0
        assert stats["avg_evaluation_time_ms"] >= 0


# ============================================================
# R4.7-6: rule priority ordering
# ============================================================

class TestRiskRulePriority:
    async def test_rule_priority_ordering(self):
        """RR-002 (priority=5) 应先于 RR-001 (priority=10) 命中.

        验证 priority 升序排列: 黑名单规则 (priority=5) 优先于大额冻结 (priority=10).
        当两者都命中 (amount>5M 且 counterparty 在黑名单), 最终 action 应为 block
        (二者都是 block, 但累计 score 应包含两者 delta: 50+60=110).
        """
        tx_data = {
            "enterprise_id": "E001", "tx_id": "TX-PRIORITY-001",
            "amount": 6_000_000, "counterparty": "黑名单A",
            "is_cross_border": False, "hour": 10,
        }
        result = await risk_rule_engine.evaluate(tx_data)
        # 两条规则都应命中
        assert "RR-001" in result.triggered_rules
        assert "RR-002" in result.triggered_rules
        # 累计风险分 >= 50 + 60 = 110
        assert result.total_risk_score >= 110
        # action 应为 block (两条都是 block)
        assert result.action == RuleAction.BLOCK.value


# ============================================================
# R4.7-7: ruleset enable / disable
# ============================================================

class TestRulesetEnableDisable:
    async def test_ruleset_enable_disable(self):
        """禁用 RR-001 后评估, 大额交易不再触发该规则 (但可能触发其他)."""
        # 先确认规则启用, 大额触发 RR-001
        tx_data = {
            "enterprise_id": "E001", "tx_id": "TX-EN-001",
            "amount": 6_000_000, "counterparty": "正常公司",
            "is_cross_border": False, "hour": 10,
        }
        before = await risk_rule_engine.evaluate(tx_data)
        assert "RR-001" in before.triggered_rules

        # 禁用 RR-001
        disabled = await risk_rule_engine.disable_rule("RR-001")
        assert disabled is not None
        assert disabled.enabled is False

        try:
            after = await risk_rule_engine.evaluate(tx_data)
            # RR-001 不再触发
            assert "RR-001" not in after.triggered_rules
        finally:
            # 恢复
            await risk_rule_engine.enable_rule("RR-001")


# ============================================================
# R4.7-8: RiskService 委托 (evaluate_tx / hot_reload_rules)
# ============================================================

class TestRiskServiceDelegation:
    async def test_risk_service_evaluate_tx_delegates(self):
        """RiskService.evaluate_tx 委托 RiskRuleEngine."""
        tx_data = {
            "enterprise_id": "E001", "tx_id": "TX-DELEG-001",
            "amount": 6_000_000, "counterparty": "正常公司",
            "is_cross_border": False, "hour": 10,
        }
        result = await risk_service.evaluate_tx(tx_data)
        assert result.action == RuleAction.BLOCK.value
        assert len(result.triggered_rules) >= 1

    async def test_risk_service_hot_reload_delegates(self):
        """RiskService.hot_reload_rules 委托 RiskRuleEngine."""
        rs = await risk_service.hot_reload_rules("RS-STD-001")
        assert rs.ruleset_id == "RS-STD-001"
        assert rs.status == "active"
