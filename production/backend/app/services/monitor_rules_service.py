"""MOD-01 资金监管 — 监控规则 + 账户锁定服务 (R4.6).

设计依据: spec.md MOD-01 L395-435 资金监管监控规则引擎.
功能:
    1. 监控规则 CRUD (8 条 seed 规则覆盖: 大额冻结/黑名单/夜间/票据空头等)
    2. 规则匹配 → 触发告警 (alert) / 冻结账户 (freeze) / 通知 (notify)
    3. 资金账户锁定 / 释放 (默认 72 小时自动过期)
    4. 告警 ack (确认) / resolve (解决) 工作流

降级策略: 内存单例 _MonitorStore + asyncio.Lock + _seed + db=None 注入,
        保证零机构接入时仍可独立运行 (遵循 project_memory "C 档兜底" 原则).

设计风格参照 bank_service.py / responsibility_chain_service.py.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from app.schemas.five_flow import (
    FundAccountLock, MonitorAlert, MonitorRule, MonitorRuleCreate,
    FlowRecord, FlowType,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "mrt") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _flow_value(ft: Any) -> str:
    """获取 FlowType 字符串值 (兼容 FlowType 实例和 str, 因 use_enum_values=True)."""
    if isinstance(ft, FlowType):
        return ft.value
    return str(ft)


# ============================================================================
# 内存状态
# ============================================================================

class _MonitorStore:
    """监控规则 + 告警 + 锁定 内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # rule_id -> MonitorRule dict
        self._rules: dict[str, dict] = {}
        # alert_id -> MonitorAlert dict
        self._alerts: dict[str, dict] = {}
        # lock_id -> FundAccountLock dict
        self._locks: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        """8 条 seed 规则: 单笔>500万冻结/黑名单/夜间/票据空头等."""
        seed_rules = [
            {
                "ruleId": "MR-001", "ruleName": "单笔大额交易冻结",
                "flowType": FlowType.FUND.value,
                "condition": "amount > 5000000",
                "thresholdCents": 500_000_000,  # 500 万元 (分)
                "action": "freeze", "severity": "critical",
            },
            {
                "ruleId": "MR-002", "ruleName": "对手方黑名单告警",
                "flowType": FlowType.FUND.value,
                "condition": "counterparty IN blacklist",
                "thresholdCents": 0,
                "action": "alert", "severity": "high",
            },
            {
                "ruleId": "MR-003", "ruleName": "夜间交易预警",
                "flowType": FlowType.FUND.value,
                "condition": "hour BETWEEN 22 AND 06",
                "thresholdCents": 0,
                "action": "alert", "severity": "medium",
            },
            {
                "ruleId": "MR-004", "ruleName": "票据空头预警",
                "flowType": FlowType.INVOICE.value,
                "condition": "invoice_amount > contract_amount",
                "thresholdCents": 0,
                "action": "alert", "severity": "high",
            },
            {
                "ruleId": "MR-005", "ruleName": "物流未签收放款拦截",
                "flowType": FlowType.LOGISTICS.value,
                "condition": "logistics_status != signed",
                "thresholdCents": 0,
                "action": "freeze", "severity": "critical",
            },
            {
                "ruleId": "MR-006", "ruleName": "IoT 数据异常告警",
                "flowType": FlowType.IOT.value,
                "condition": "iot_anomaly_score > 0.8",
                "thresholdCents": 0,
                "action": "alert", "severity": "medium",
            },
            {
                "ruleId": "MR-007", "ruleName": "责任链不完整告警",
                "flowType": FlowType.HUMAN.value,
                "condition": "chain_integrity < 80",
                "thresholdCents": 0,
                "action": "notify", "severity": "low",
            },
            {
                "ruleId": "MR-008", "ruleName": "资金流时间偏差告警",
                "flowType": FlowType.FUND.value,
                "condition": "tx_time_deviation > 7d",
                "thresholdCents": 0,
                "action": "alert", "severity": "medium",
            },
        ]
        for r in seed_rules:
            self._rules[r["ruleId"]] = dict(r)

        """5 条告警 (2 active / 2 acknowledged / 1 resolved) + 3 个账户锁定."""
        now = _now_iso()
        seed_alerts = [
            {
                "alertId": "AL-2026-0001", "ruleId": "MR-001",
                "enterpriseId": "E001", "txId": "TX-2026-0001",
                "alertType": "单笔大额交易冻结", "severity": "critical",
                "message": "TX-2026-0001 单笔金额 800 万元超过 500 万冻结阈值",
                "triggeredAtIso": now, "status": "active",
            },
            {
                "alertId": "AL-2026-0002", "ruleId": "MR-002",
                "enterpriseId": "E002", "txId": "TX-2026-0002",
                "alertType": "对手方黑名单告警", "severity": "high",
                "message": "TX-2026-0002 对手方 CP-BLACKLIST 在黑名单",
                "triggeredAtIso": now, "status": "active",
            },
            {
                "alertId": "AL-2026-0003", "ruleId": "MR-003",
                "enterpriseId": "E001", "txId": "TX-2026-0003",
                "alertType": "夜间交易预警", "severity": "medium",
                "message": "TX-2026-0003 凌晨 2:30 触发交易",
                "triggeredAtIso": now, "status": "acknowledged",
            },
            {
                "alertId": "AL-2026-0004", "ruleId": "MR-006",
                "enterpriseId": "E003", "txId": "TX-2026-0004",
                "alertType": "IoT 数据异常告警", "severity": "medium",
                "message": "TX-2026-0004 温度传感器读数偏离阈值",
                "triggeredAtIso": now, "status": "acknowledged",
            },
            {
                "alertId": "AL-2026-0005", "ruleId": "MR-008",
                "enterpriseId": "E002", "txId": "TX-2026-0005",
                "alertType": "资金流时间偏差告警", "severity": "medium",
                "message": "TX-2026-0005 资金流与合同流时间差 > 7 天",
                "triggeredAtIso": now, "status": "resolved",
            },
        ]
        for a in seed_alerts:
            self._alerts[a["alertId"]] = dict(a)

        # 3 个账户锁定 (locked / released / forfeited 各 1)
        locked_at = datetime.now(timezone.utc)
        seed_locks = [
            {
                "lockId": "LCK-2026-0001", "enterpriseId": "E001",
                "accountId": "ACC-E001-001",
                "lockedAmountCents": 800_000_000,  # 800 万元
                "reason": "单笔大额交易冻结 (MR-001)",
                "lockedAtIso": locked_at.isoformat(),
                "expiresAtIso": (locked_at + timedelta(hours=72)).isoformat(),
                "status": "locked",
            },
            {
                "lockId": "LCK-2026-0002", "enterpriseId": "E002",
                "accountId": "ACC-E002-001",
                "lockedAmountCents": 500_000_000,  # 500 万元
                "reason": "物流未签收放款拦截 (MR-005)",
                "lockedAtIso": (locked_at - timedelta(hours=10)).isoformat(),
                "expiresAtIso": (locked_at + timedelta(hours=62)).isoformat(),
                "status": "locked",
            },
            {
                "lockId": "LCK-2026-0003", "enterpriseId": "E003",
                "accountId": "ACC-E003-001",
                "lockedAmountCents": 300_000_000,  # 300 万元
                "reason": "已释放的临时锁定",
                "lockedAtIso": (locked_at - timedelta(hours=100)).isoformat(),
                "expiresAtIso": (locked_at - timedelta(hours=28)).isoformat(),
                "status": "released",
            },
        ]
        for l in seed_locks:
            self._locks[l["lockId"]] = dict(l)

    async def list_rules(self, flow_type: Optional[str] = None) -> list[dict]:
        async with self._lock:
            rules = list(self._rules.values())
            if flow_type:
                rules = [r for r in rules if r.get("flowType") == flow_type]
            return [dict(r) for r in rules]

    async def get_rule(self, rule_id: str) -> Optional[dict]:
        async with self._lock:
            r = self._rules.get(rule_id)
            return dict(r) if r else None

    async def add_rule(self, rule: dict) -> dict:
        async with self._lock:
            self._rules[rule["ruleId"]] = dict(rule)
            return dict(rule)

    async def update_rule(self, rule_id: str, patch: dict) -> Optional[dict]:
        async with self._lock:
            if rule_id not in self._rules:
                return None
            self._rules[rule_id].update(patch)
            self._rules[rule_id]["ruleId"] = rule_id
            return dict(self._rules[rule_id])

    async def delete_rule(self, rule_id: str) -> bool:
        async with self._lock:
            if rule_id in self._rules:
                del self._rules[rule_id]
                return True
            return False

    async def list_alerts(
        self, enterprise_id: Optional[str] = None, status: Optional[str] = None,
    ) -> list[dict]:
        async with self._lock:
            alerts = list(self._alerts.values())
            if enterprise_id:
                alerts = [a for a in alerts if a.get("enterpriseId") == enterprise_id]
            if status:
                alerts = [a for a in alerts if a.get("status") == status]
            return [dict(a) for a in alerts]

    async def add_alert(self, alert: dict) -> dict:
        async with self._lock:
            self._alerts[alert["alertId"]] = dict(alert)
            return dict(alert)

    async def update_alert_status(
        self, alert_id: str, status: str,
    ) -> Optional[dict]:
        async with self._lock:
            if alert_id not in self._alerts:
                return None
            self._alerts[alert_id]["status"] = status
            return dict(self._alerts[alert_id])

    async def list_locks(
        self, enterprise_id: Optional[str] = None, status: Optional[str] = None,
    ) -> list[dict]:
        async with self._lock:
            locks = list(self._locks.values())
            if enterprise_id:
                locks = [l for l in locks if l.get("enterpriseId") == enterprise_id]
            if status:
                locks = [l for l in locks if l.get("status") == status]
            return [dict(l) for l in locks]

    async def add_lock(self, lock: dict) -> dict:
        async with self._lock:
            self._locks[lock["lockId"]] = dict(lock)
            return dict(lock)

    async def update_lock_status(
        self, lock_id: str, status: str,
    ) -> Optional[dict]:
        async with self._lock:
            if lock_id not in self._locks:
                return None
            self._locks[lock_id]["status"] = status
            return dict(self._locks[lock_id])


_monitor_store = _MonitorStore()


# ============================================================================
# 监控规则服务
# ============================================================================

class MonitorRulesService:
    """资金监管监控规则 + 账户锁定服务 (MOD-01)."""

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入

    # === 规则 CRUD ===

    async def list_rules(self, flow_type: Optional[FlowType] = None) -> list[MonitorRule]:
        flow_val = flow_type.value if isinstance(flow_type, FlowType) else flow_type
        items = await _monitor_store.list_rules(flow_type=flow_val)
        return [MonitorRule.model_validate(r) for r in items]

    async def add_rule(self, rule: MonitorRuleCreate) -> MonitorRule:
        rule_id = _id("MR")
        rule_dict = {
            "ruleId": rule_id,
            "ruleName": rule.rule_name,
            "flowType": _flow_value(rule.flow_type),
            "condition": rule.condition,
            "thresholdCents": rule.threshold_cents,
            "action": rule.action,
            "severity": rule.severity,
        }
        await _monitor_store.add_rule(rule_dict)
        return MonitorRule.model_validate(rule_dict)

    async def update_rule(
        self, rule_id: str,
        rule_name: Optional[str] = None,
        condition: Optional[str] = None,
        threshold_cents: Optional[int] = None,
        action: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> Optional[MonitorRule]:
        patch: dict[str, Any] = {}
        if rule_name is not None:
            patch["ruleName"] = rule_name
        if condition is not None:
            patch["condition"] = condition
        if threshold_cents is not None:
            patch["thresholdCents"] = threshold_cents
        if action is not None:
            patch["action"] = action
        if severity is not None:
            patch["severity"] = severity
        updated = await _monitor_store.update_rule(rule_id, patch)
        return MonitorRule.model_validate(updated) if updated else None

    async def delete_rule(self, rule_id: str) -> bool:
        return await _monitor_store.delete_rule(rule_id)

    # === 规则评估 ===

    async def evaluate(
        self, tx_id: str, flow_records: list[FlowRecord],
    ) -> list[MonitorAlert]:
        """按规则匹配流记录, 触发告警.

        匹配逻辑 (简化, 各规则按 condition 文本启发式判断):
            - amount > threshold: 任一记录金额超过阈值即触发
            - counterparty IN blacklist: 任一记录对手方包含 BLACKLIST 关键字
            - hour BETWEEN 22 AND 06: 任一记录 tx_time 在 22-06 时段
            - invoice_amount > contract_amount: 票据流金额 > 合同流金额
            - logistics_status != signed: 物流流 evidence_ref 不含 signed
            - iot_anomaly_score > 0.8: IoT 流 evidence_ref 含 ANOMALY
            - chain_integrity < 80: 人流 evidence_ref 含 LOW_INTEGRITY
            - tx_time_deviation > 7d: 各流时间差 > 7 天
        """
        rules = await _monitor_store.list_rules()
        # 取第一个 enterprise_id (假设同一交易所有流同一企业)
        enterprise_id = flow_records[0].enterprise_id if flow_records else "UNKNOWN"
        triggered: list[MonitorAlert] = []
        now = _now_iso()

        for rule in rules:
            rule_id = rule["ruleId"]
            rule_name = rule["ruleName"]
            flow_type_val = rule.get("flowType", FlowType.FUND.value)
            condition = rule.get("condition", "")
            action = rule.get("action", "alert")
            severity = rule.get("severity", "medium")
            threshold = rule.get("thresholdCents", 0)

            # 过滤匹配流类型的记录
            matched_records = [
                r for r in flow_records
                if _flow_value(r.flow_type) == flow_type_val
            ]
            # 对部分通用规则 (如时间偏差), 允许跨流类型评估
            if not matched_records and "tx_time_deviation" not in condition:
                continue

            triggered_flag = False
            message = ""

            # 规则匹配启发式
            if "amount >" in condition and threshold > 0:
                for r in matched_records:
                    if r.amount_cents > threshold:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: {_flow_value(r.flow_type)} 流金额 "
                            f"{r.amount_cents / 100:.2f} 元超过阈值 "
                            f"{threshold / 100:.2f} 元 (交易 {tx_id})"
                        )
                        break
            elif "blacklist" in condition:
                for r in matched_records:
                    cp = r.counterparty_name or ""
                    if "BLACKLIST" in cp.upper() or "黑名单" in cp:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: 对手方 {cp} 命中黑名单 (交易 {tx_id})"
                        )
                        break
            elif "hour BETWEEN" in condition:
                for r in matched_records:
                    try:
                        dt = datetime.fromisoformat(r.tx_time_iso)
                        hour = dt.hour
                        if hour >= 22 or hour < 6:
                            triggered_flag = True
                            message = (
                                f"{rule_name}: 交易 {tx_id} 在 {hour}:00 触发, "
                                f"落入夜间时段 22-06"
                            )
                            break
                    except (ValueError, TypeError):
                        continue
            elif "invoice_amount > contract_amount" in condition:
                inv_amts = [
                    r.amount_cents for r in flow_records
                    if _flow_value(r.flow_type) == FlowType.INVOICE.value
                ]
                ctr_amts = [
                    r.amount_cents for r in flow_records
                    if _flow_value(r.flow_type) == FlowType.CONTRACT.value
                ]
                if inv_amts and ctr_amts and max(inv_amts) > max(ctr_amts):
                    triggered_flag = True
                    message = (
                        f"{rule_name}: 票据流金额 {max(inv_amts) / 100:.2f} 元 "
                        f"> 合同流金额 {max(ctr_amts) / 100:.2f} 元 (交易 {tx_id})"
                    )
            elif "logistics_status" in condition:
                for r in matched_records:
                    ev = (r.evidence_ref or "").upper()
                    if "SIGNED" not in ev:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: 物流未签收 (evidence={r.evidence_ref}), "
                            f"交易 {tx_id} 拦截"
                        )
                        break
            elif "iot_anomaly" in condition:
                for r in matched_records:
                    ev = (r.evidence_ref or "").upper()
                    if "ANOMALY" in ev:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: IoT 设备异常 (evidence={r.evidence_ref}), "
                            f"交易 {tx_id}"
                        )
                        break
            elif "chain_integrity" in condition:
                for r in matched_records:
                    ev = (r.evidence_ref or "").upper()
                    if "LOW_INTEGRITY" in ev:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: 责任链不完整 (evidence={r.evidence_ref}), "
                            f"交易 {tx_id}"
                        )
                        break
            elif "tx_time_deviation" in condition:
                # 跨流时间差 > 7 天
                times: list[datetime] = []
                for r in flow_records:
                    try:
                        times.append(datetime.fromisoformat(r.tx_time_iso))
                    except (ValueError, TypeError):
                        continue
                if len(times) >= 2:
                    delta = (max(times) - min(times)).total_seconds()
                    if delta > 7 * 24 * 3600:
                        triggered_flag = True
                        message = (
                            f"{rule_name}: 各流时间差 {delta / 86400:.1f} 天 > 7 天 "
                            f"(交易 {tx_id})"
                        )

            if triggered_flag:
                alert_dict = {
                    "alertId": _id("AL"),
                    "ruleId": rule_id,
                    "enterpriseId": enterprise_id,
                    "txId": tx_id,
                    "alertType": rule_name,
                    "severity": severity,
                    "message": message,
                    "triggeredAtIso": now,
                    "status": "active",
                }
                await _monitor_store.add_alert(alert_dict)
                triggered.append(MonitorAlert.model_validate(alert_dict))

        return triggered

    # === 告警工作流 ===

    async def list_alerts(
        self, enterprise_id: Optional[str] = None, status: Optional[str] = None,
    ) -> list[MonitorAlert]:
        items = await _monitor_store.list_alerts(
            enterprise_id=enterprise_id, status=status,
        )
        return [MonitorAlert.model_validate(a) for a in items]

    async def acknowledge_alert(self, alert_id: str) -> Optional[MonitorAlert]:
        updated = await _monitor_store.update_alert_status(alert_id, "acknowledged")
        return MonitorAlert.model_validate(updated) if updated else None

    async def resolve_alert(self, alert_id: str) -> Optional[MonitorAlert]:
        updated = await _monitor_store.update_alert_status(alert_id, "resolved")
        return MonitorAlert.model_validate(updated) if updated else None

    # === 账户锁定 ===

    async def lock_fund_account(
        self,
        enterprise_id: str,
        account_id: str,
        amount_cents: int,
        reason: str,
        duration_hours: int = 72,
    ) -> FundAccountLock:
        now = datetime.now(timezone.utc)
        lock_dict = {
            "lockId": _id("LCK"),
            "enterpriseId": enterprise_id,
            "accountId": account_id,
            "lockedAmountCents": amount_cents,
            "reason": reason,
            "lockedAtIso": now.isoformat(),
            "expiresAtIso": (now + timedelta(hours=duration_hours)).isoformat(),
            "status": "locked",
        }
        await _monitor_store.add_lock(lock_dict)
        return FundAccountLock.model_validate(lock_dict)

    async def release_fund_account(self, lock_id: str) -> Optional[FundAccountLock]:
        updated = await _monitor_store.update_lock_status(lock_id, "released")
        return FundAccountLock.model_validate(updated) if updated else None

    async def list_locks(
        self, enterprise_id: Optional[str] = None, status: Optional[str] = None,
    ) -> list[FundAccountLock]:
        items = await _monitor_store.list_locks(
            enterprise_id=enterprise_id, status=status,
        )
        return [FundAccountLock.model_validate(l) for l in items]


monitor_rules_service = MonitorRulesService(db=None)
