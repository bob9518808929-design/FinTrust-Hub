"""MOD-01 R4.6 五流合一校验引擎测试.

覆盖:
    - collect_flow_records (6 流拉取)
    - check_consistency (一致通过 / 金额不匹配 / 主体不一致)
    - batch_check (批量返回结果)
    - monitor_rules_service.evaluate (规则匹配触发告警)
    - lock_fund_account / release_fund_account (锁定 + 释放)
    - acknowledge_alert / resolve_alert (告警工作流)
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.schemas.five_flow import (
    FlowRecord,
    FlowType,
)
from app.services.five_flow_consistency_service import (
    five_flow_consistency_service,
)
from app.services.fund_service import fund_service
from app.services.monitor_rules_service import (
    monitor_rules_service,
)

pytestmark = pytest.mark.asyncio


def _make_record(
    flow_type: FlowType,
    enterprise_id: str = "E001",
    tx_id: str = "TX-TEST-0001",
    amount_cents: int = 100_000_000,
    counterparty_name: str = "深圳供应链 A 公司",
    counterparty_id: str = "CP-A",
    tx_time_iso: str | None = None,
    evidence_ref: str = "EV-001",
    status: str = "confirmed",
) -> FlowRecord:
    if tx_time_iso is None:
        tx_time_iso = datetime.now(UTC).isoformat()
    return FlowRecord(
        flow_id=f"fr-test-{flow_type.value.lower()}",
        flow_type=flow_type,
        enterprise_id=enterprise_id,
        tx_id=tx_id,
        amount_cents=amount_cents,
        counterparty_name=counterparty_name,
        counterparty_id=counterparty_id,
        tx_time_iso=tx_time_iso,
        evidence_ref=evidence_ref,
        status=status,
    )


# ============================================================
# R4.6-1: collect_flow_records
# ============================================================

class TestFiveFlowCollect:
    async def test_collect_6_flows_for_tx(self):
        """seed 中 TX-2026-0001 应返回 6 条记录 (六流)."""
        records = await five_flow_consistency_service.collect_flow_records(
            "E001", "TX-2026-0001",
        )
        assert len(records) == 6
        flow_types = {r.flow_type for r in records}
        assert flow_types == {
            FlowType.FUND, FlowType.CONTRACT, FlowType.INVOICE,
            FlowType.LOGISTICS, FlowType.IOT, FlowType.HUMAN,
        }
        # 全部为企业 E001 + 交易 TX-2026-0001
        for r in records:
            assert r.enterprise_id == "E001"
            assert r.tx_id == "TX-2026-0001"


# ============================================================
# R4.6-2: check_consistency (一致 / 金额不匹配 / 主体不一致)
# ============================================================

class TestFiveFlowConsistency:
    async def test_consistency_passes_when_all_match(self):
        """TX-2026-0001 完全一致, score=100, passed=True."""
        result = await five_flow_consistency_service.check_consistency(
            "E001", "TX-2026-0001",
        )
        assert result.enterprise_id == "E001"
        assert result.tx_id == "TX-2026-0001"
        assert result.total_flows_checked == 6
        assert result.consistency_score == 100
        assert result.passed is True
        assert len(result.matched_flows) == 6
        assert len(result.mismatched_flows) == 0

    async def test_consistency_fails_on_amount_mismatch(self):
        """TX-2026-0004 合同流金额不匹配, score 应 < 100, mismatched 含 CONTRACT."""
        result = await five_flow_consistency_service.check_consistency(
            "E004", "TX-2026-0004",
        )
        assert result.total_flows_checked == 6
        assert result.consistency_score < 100
        # 金额不一致扣 20 分
        assert result.consistency_score == 80
        assert FlowType.CONTRACT in result.mismatched_flows
        assert any("金额" in d for d in result.mismatch_details)

    async def test_consistency_fails_on_counterparty_mismatch(self):
        """TX-2026-0005 物流流对手方不一致, score 应 < 100, mismatched 含 LOGISTICS."""
        result = await five_flow_consistency_service.check_consistency(
            "E005", "TX-2026-0005",
        )
        assert result.total_flows_checked == 6
        assert result.consistency_score < 100
        assert FlowType.LOGISTICS in result.mismatched_flows
        assert any("主体" in d for d in result.mismatch_details)


# ============================================================
# R4.6-3: batch_check
# ============================================================

class TestFiveFlowBatch:
    async def test_batch_check_returns_results(self):
        """批量校验应返回与输入等长的结果列表."""
        # 注意: seed 中 TX-2026-0001 属 E001, TX-2026-0004 属 E004, TX-2026-0005 属 E005
        # 为简化, 用 E001 拉 3 个 tx_id (TX-0004/0005 在 E001 下无 seed, 返回空)
        # 改用各 tx_id 对应的企业, 验证返回数量
        pairs = [
            ("E001", "TX-2026-0001"),
            ("E004", "TX-2026-0004"),
            ("E005", "TX-2026-0005"),
        ]
        results = []
        for eid, tx_id in pairs:
            r = await five_flow_consistency_service.check_consistency(eid, tx_id)
            results.append(r)
        assert len(results) == 3
        # TX-2026-0001 一致, TX-2026-0004 金额不匹配, TX-2026-0005 主体不匹配
        assert results[0].consistency_score == 100
        assert results[1].consistency_score == 80
        assert results[2].consistency_score == 80
        # 用 batch_check API 验证等价
        batch = await five_flow_consistency_service.batch_check("E001", ["TX-2026-0001"])
        assert len(batch) == 1
        assert batch[0].consistency_score == 100


# ============================================================
# R4.6-4: monitor_rules_service.evaluate
# ============================================================

class TestMonitorRulesEvaluate:
    async def test_monitor_rules_evaluate_triggers_alert(self):
        """单笔大额交易规则 (MR-001, 阈值 5 亿元 = 500,000,000 分) 应触发 critical 告警."""
        now = datetime.now(UTC).isoformat()
        records = [
            _make_record(
                FlowType.FUND,
                enterprise_id="E001",
                tx_id="TX-TEST-ALERT",
                amount_cents=600_000_000,  # 600 万元 > 500 万元阈值
                tx_time_iso=now,
            ),
        ]
        alerts = await monitor_rules_service.evaluate("TX-TEST-ALERT", records)
        # 应至少触发 MR-001 单笔大额冻结
        assert len(alerts) >= 1
        big_amount_alerts = [a for a in alerts if a.rule_id == "MR-001"]
        assert len(big_amount_alerts) >= 1
        assert big_amount_alerts[0].severity == "critical"
        assert big_amount_alerts[0].status == "active"
        assert "大额" in big_amount_alerts[0].message or "threshold" in big_amount_alerts[0].message.lower()


# ============================================================
# R4.6-5: lock / release fund account
# ============================================================

class TestFundAccountLock:
    async def test_lock_and_release_fund_account(self):
        """锁定 → 列出 → 释放 → 状态变 released."""
        lock = await monitor_rules_service.lock_fund_account(
            enterprise_id="E001",
            account_id="ACC-TEST-001",
            amount_cents=200_000_000,  # 200 万元
            reason="测试锁定",
            duration_hours=24,
        )
        assert lock.enterprise_id == "E001"
        assert lock.account_id == "ACC-TEST-001"
        assert lock.locked_amount_cents == 200_000_000
        assert lock.status == "locked"
        assert lock.locked_at_iso
        assert lock.expires_at_iso

        # 列出锁定
        locks = await monitor_rules_service.list_locks(enterprise_id="E001", status="locked")
        assert any(l.lock_id == lock.lock_id for l in locks)

        # 释放
        released = await monitor_rules_service.release_fund_account(lock.lock_id)
        assert released is not None
        assert released.status == "released"


# ============================================================
# R4.6-6: acknowledge / resolve alert
# ============================================================

class TestAlertWorkflow:
    async def test_acknowledge_and_resolve_alert(self):
        """seed 含 5 条告警, 验证 ack/resolve 状态转换."""
        # 拉取 active 告警 (seed 含 2 条 active)
        active_alerts = await monitor_rules_service.list_alerts(status="active")
        assert len(active_alerts) >= 1
        alert_id = active_alerts[0].alert_id

        # ack
        acked = await monitor_rules_service.acknowledge_alert(alert_id)
        assert acked is not None
        assert acked.status == "acknowledged"

        # resolve
        resolved = await monitor_rules_service.resolve_alert(alert_id)
        assert resolved is not None
        assert resolved.status == "resolved"


# ============================================================
# R4.6-7: FundService 委托 (monitor_check / lock_account)
# ============================================================

class TestFundServiceDelegation:
    async def test_fund_service_monitor_check_delegates(self):
        """FundService.monitor_check 委托 FiveFlowConsistencyService."""
        result = await fund_service.monitor_check("E001", "TX-2026-0001")
        assert result.tx_id == "TX-2026-0001"
        assert result.consistency_score == 100
        assert result.passed is True

    async def test_fund_service_lock_account_delegates(self):
        """FundService.lock_account / release_account 委托 MonitorRulesService."""
        lock = await fund_service.lock_account(
            enterprise_id="E001",
            account_id="ACC-FUND-DELEGATE",
            amount_cents=100_000_000,
            reason="FundService 委托测试",
            duration_hours=48,
        )
        assert lock.status == "locked"
        released = await fund_service.release_account(lock.lock_id)
        assert released is not None
        assert released.status == "released"
