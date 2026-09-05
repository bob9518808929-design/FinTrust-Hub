"""MOD-02 智能风控 — 风控流处理服务 (R4.7).

设计依据: spec.md MOD-02 L437-505 流式风控处理.
功能:
    1. ingest(event) -> RiskEvaluationResult (实时风控: ingest → evaluate → 返回)
    2. batch_evaluate(events) -> list[RiskEvaluationResult] (降级为批量处理)
    3. list_events / get_event (查询事件)
    4. stream_stats (统计: total / processed / avg_eval_ms / block_count / flag_count)
    5. V3 get_dashboard_stats (规则命中率 / 告警统计 / 趋势 / 高风险企业 Top)

降级策略: 内存单例 _RiskStreamStore + asyncio.Lock + _seed + db=None 注入,
        保证零机构接入时仍可独立运行 (遵循 project_memory "C 档兜底" 原则).

设计风格参照 bank_service.py / responsibility_chain_service.py.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.schemas.risk_rule import (
    RiskEvaluationResult,
    RiskStreamEvent,
    RuleAction,
)
from app.services.risk_rule_engine import risk_rule_engine

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "se") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


# ============================================================================
# 内存状态
# ============================================================================

class _RiskStreamStore:
    """风控流事件内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # event_id -> RiskStreamEvent dict
        self._events: dict[str, dict] = {}
        # eval_id -> RiskEvaluationResult dict
        self._results: dict[str, dict] = {}
        # 统计: 总评估耗时累加 (ms), 用于计算 avg
        self._total_eval_ms: int = 0
        self._seed()

    def _seed(self) -> None:
        """20 个事件 (5 blocked, 5 flagged, 10 passed) + 对应评估结果."""
        now = datetime.now(UTC)
        seed_events: list[dict] = []

        # 5 个 blocked 事件 (大额 / 黑名单)
        blocked_payloads = [
            {"enterprise_id": "E001", "tx_id": "TX-BLK-001",
             "event_type": "tx", "amount": 6_000_000, "counterparty": "正常公司",
             "is_cross_border": False, "hour": 10},
            {"enterprise_id": "E001", "tx_id": "TX-BLK-002",
             "event_type": "tx", "amount": 800_000, "counterparty": "黑名单A",
             "is_cross_border": False, "hour": 14},
            {"enterprise_id": "E002", "tx_id": "TX-BLK-003",
             "event_type": "tx", "amount": 1_200_000, "is_cash": True,
             "counterparty": "正常公司", "is_cross_border": False, "hour": 11},
            {"enterprise_id": "E003", "tx_id": "TX-BLK-004",
             "event_type": "tx", "amount": 5_500_000, "counterparty": "正常公司",
             "is_cross_border": False, "hour": 9},
            {"enterprise_id": "E002", "tx_id": "TX-BLK-005",
             "event_type": "tx", "amount": 5_100_000, "counterparty": "正常公司",
             "is_cross_border": True, "hour": 15},
        ]
        for i, p in enumerate(blocked_payloads):
            ev_id = f"SE-BLK-{i+1:04d}"
            ts = now.replace(microsecond=0)
            seed_events.append({
                "eventId": ev_id, **p,
                "receivedAtIso": ts.isoformat(), "processed": True,
                "riskResultId": f"EVAL-BLK-{i+1:04d}",
            })
        # 5 个 flagged 事件 (夜间 / 高频)
        flagged_payloads = [
            {"enterprise_id": "E001", "tx_id": "TX-FLG-001",
             "event_type": "tx", "amount": 50_000, "counterparty": "正常公司",
             "is_cross_border": False, "hour": 23},
            {"enterprise_id": "E002", "tx_id": "TX-FLG-002",
             "event_type": "tx", "amount": 30_000, "counterparty": "正常公司",
             "is_cross_border": False, "hour": 3},
            {"enterprise_id": "E003", "tx_id": "TX-FLG-003",
             "event_type": "tx", "amount": 100_000, "counterparty": "正常公司",
             "is_cross_border": False, "tx_count_1h": 15},
            {"enterprise_id": "E001", "tx_id": "TX-FLG-004",
             "event_type": "tx", "amount": 80_000, "counterparty": "正常公司",
             "is_cross_border": False, "hour": 1},
            {"enterprise_id": "E002", "tx_id": "TX-FLG-005",
             "event_type": "tx", "amount": 60_000, "counterparty": "正常公司",
             "is_cross_border": False, "tx_count_1h": 20},
        ]
        for i, p in enumerate(flagged_payloads):
            ev_id = f"SE-FLG-{i+1:04d}"
            ts = now.replace(microsecond=0)
            seed_events.append({
                "eventId": ev_id, **p,
                "receivedAtIso": ts.isoformat(), "processed": True,
                "riskResultId": f"EVAL-FLG-{i+1:04d}",
            })
        # 10 个 passed 事件 (小额 / 正常时段)
        passed_payloads = [
            {"enterprise_id": "E001", "tx_id": f"TX-PAS-{i+1:04d}",
             "event_type": "tx", "amount": 10_000 * (i + 1),
             "counterparty": "正常公司", "is_cross_border": False,
             "hour": 9 + (i % 8)}
            for i in range(10)
        ]
        for i, p in enumerate(passed_payloads):
            ev_id = f"SE-PAS-{i+1:04d}"
            ts = now.replace(microsecond=0)
            seed_events.append({
                "eventId": ev_id, **p,
                "receivedAtIso": ts.isoformat(), "processed": True,
                "riskResultId": f"EVAL-PAS-{i+1:04d}",
            })

        # 写入 + 对应评估结果
        eval_ms_seed = 5
        for ev in seed_events:
            self._events[ev["eventId"]] = dict(ev)
            # 简化评估结果 (依据 ev 类型决定 action)
            ev_id = ev["eventId"]
            if "BLK" in ev_id:
                action = "block"
                triggered = ["RR-001"]  # 大额冻结
                score = 50
            elif "FLG" in ev_id:
                action = "flag"
                triggered = ["RR-003"]  # 夜间预警
                score = 20
            else:
                action = "pass"
                triggered = []
                score = 0
            result_dict = {
                "evalId": ev["riskResultId"],
                "enterpriseId": ev.get("enterprise_id"),
                "txId": ev.get("tx_id"),
                "triggeredRules": triggered,
                "totalRiskScore": score,
                "action": action,
                "evaluationTimeMs": eval_ms_seed,
                "explanations": [f"seed 评估: action={action}, score={score}"],
                "timestampIso": ev["receivedAtIso"],
            }
            self._results[ev["riskResultId"]] = result_dict
            self._total_eval_ms += eval_ms_seed

    async def list_events(
        self,
        enterprise_id: str | None = None,
        processed: bool | None = None,
        limit: int = 100,
    ) -> list[dict]:
        async with self._lock:
            events = list(self._events.values())
            # 倒序 (最新在前)
            events.sort(key=lambda e: e.get("receivedAtIso", ""), reverse=True)
            if enterprise_id:
                events = [e for e in events if e.get("enterprise_id") == enterprise_id]
            if processed is not None:
                events = [e for e in events if e.get("processed") == processed]
            return [dict(e) for e in events[:limit]]

    async def get_event(self, event_id: str) -> dict | None:
        async with self._lock:
            e = self._events.get(event_id)
            return dict(e) if e else None

    async def add_event(self, event: dict) -> dict:
        async with self._lock:
            self._events[event["eventId"]] = dict(event)
            return dict(event)

    async def mark_processed(
        self, event_id: str, result_id: str,
    ) -> dict | None:
        async with self._lock:
            if event_id not in self._events:
                return None
            self._events[event_id]["processed"] = True
            self._events[event_id]["riskResultId"] = result_id
            return dict(self._events[event_id])

    async def add_result(self, result: dict) -> dict:
        async with self._lock:
            self._results[result["evalId"]] = dict(result)
            self._total_eval_ms += result.get("evaluationTimeMs", 0)
            return dict(result)

    async def stats(self) -> dict:
        async with self._lock:
            total = len(self._events)
            processed = sum(1 for e in self._events.values() if e.get("processed"))
            block_count = sum(
                1 for r in self._results.values()
                if r.get("action") == "block"
            )
            flag_count = sum(
                1 for r in self._results.values()
                if r.get("action") == "flag"
            )
            avg_ms = (self._total_eval_ms / len(self._results)) if self._results else 0.0
            return {
                "total_events": total,
                "processed_count": processed,
                "avg_evaluation_time_ms": round(avg_ms, 2),
                "block_count": block_count,
                "flag_count": flag_count,
            }

    # === V3 仪表盘聚合: 暴露原始 events/results 供服务层聚合 ===

    async def list_all_results(self) -> list[dict]:
        """返回所有评估结果 (供 dashboard 聚合规则命中数/告警统计)."""
        async with self._lock:
            return [dict(r) for r in self._results.values()]

    async def list_all_events_with_time(self) -> list[dict]:
        """返回所有事件 (含 receivedAtIso, 供趋势聚合)."""
        async with self._lock:
            return [dict(e) for e in self._events.values()]


_risk_stream_store = _RiskStreamStore()


# ============================================================================
# 风控流处理服务
# ============================================================================

class RiskStreamService:
    """风控流处理服务 (MOD-02).

    ingest (实时) → risk_rule_engine.evaluate → 返回 RiskEvaluationResult.
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入

    async def ingest(self, event: RiskStreamEvent) -> RiskEvaluationResult:
        """实时风控: 接收事件 → 评估 → 返回结果.

        降级策略: 当 risk_rule_engine 不可用时返回 action=flag 的兜底结果.
        """
        # 写入事件 (未处理)
        ev_dict = event.model_dump(by_alias=True)
        await _risk_stream_store.add_event(ev_dict)

        # 评估
        tx_data = dict(event.payload or {})
        if event.enterprise_id:
            tx_data.setdefault("enterprise_id", event.enterprise_id)
        if event.tx_id:
            tx_data.setdefault("tx_id", event.tx_id)

        try:
            result = await risk_rule_engine.evaluate(tx_data)
        except Exception as e:
            logger.warning(f"risk_rule_engine evaluate failed, degrade: {e}")
            now = _now_iso()
            result = RiskEvaluationResult(
                eval_id=_id("EVAL-DEGRADED"),
                enterprise_id=event.enterprise_id,
                tx_id=event.tx_id,
                triggered_rules=[],
                total_risk_score=0,
                action=RuleAction.FLAG.value,
                evaluation_time_ms=0,
                explanations=[f"评估引擎降级: {e}"],
                timestamp_iso=now,
            )

        # 标记事件已处理 + 关联结果 ID
        await _risk_stream_store.mark_processed(event.event_id, result.eval_id)
        # 存评估结果
        result_dict = result.model_dump(by_alias=True)
        await _risk_stream_store.add_result(result_dict)
        return result

    async def batch_evaluate(
        self, events: list[RiskStreamEvent],
    ) -> list[RiskEvaluationResult]:
        """批量评估 (降级为顺序 ingest)."""
        results: list[RiskEvaluationResult] = []
        for ev in events:
            r = await self.ingest(ev)
            results.append(r)
        return results

    async def list_events(
        self,
        enterprise_id: str | None = None,
        processed: bool | None = None,
        limit: int = 100,
    ) -> list[RiskStreamEvent]:
        items = await _risk_stream_store.list_events(
            enterprise_id=enterprise_id, processed=processed, limit=limit,
        )
        return [RiskStreamEvent.model_validate(e) for e in items]

    async def get_event(self, event_id: str) -> RiskStreamEvent | None:
        e = await _risk_stream_store.get_event(event_id)
        return RiskStreamEvent.model_validate(e) if e else None

    async def stream_stats(self) -> dict:
        return await _risk_stream_store.stats()

    # ====================================================================
    # V3 实时风控仪表盘 (MOD-02)
    # ====================================================================

    async def get_dashboard_stats(self) -> dict:
        """实时风控仪表盘数据.

        Returns:
            {
                "rules_hit_count": dict[rule_id, int] (每条规则的命中次数),
                "alerts_today": int (今日告警数: action in {block, flag}),
                "trend_7d": list[{"date_iso": str, "alert_count": int, "block_count": int}] (最近 7 天告警趋势),
                "top_risky_enterprises": list[{"enterprise_id": str, "alert_count": int, "block_count": int, "total_score": int}] (Top 5 高风险企业),
                "summary": {"total_rules": int, "total_events": int, "block_count": int, "flag_count": int, "pass_count": int},
            }

        聚合数据源:
            1. _risk_stream_store.list_all_results() 取所有评估结果
            2. _risk_stream_store.list_all_events_with_time() 取事件时间戳用于趋势
            3. risk_rule_engine.list_rules() 取所有规则总数
        """
        results = await _risk_stream_store.list_all_results()
        events = await _risk_stream_store.list_all_events_with_time()

        # 1. rules_hit_count: 每条规则的命中次数 (从 triggeredRules 累加)
        rules_hit_count: Counter = Counter()
        for r in results:
            triggered = r.get("triggeredRules") or []
            for rid in triggered:
                rules_hit_count[rid] += 1

        # 2. alerts_today: 今日 (UTC) 告警数 (block + flag)
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        alerts_today = 0
        for r in results:
            ts_iso = r.get("timestampIso", "")
            try:
                t = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue
            if t >= today_start and r.get("action") in ("block", "flag"):
                alerts_today += 1

        # 3. trend_7d: 最近 7 天每日 alert/block 计数
        # 注意: events 的 receivedAtIso 是时间戳, 用它做趋势
        trend_7d: list[dict] = []
        for i in range(6, -1, -1):
            day = (now - timedelta(days=i)).date()
            day_start = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
            day_end = day_start + timedelta(days=1)
            day_alert_count = 0
            day_block_count = 0
            # 用 events 时间戳判定 (events 已包含 receivedAtIso)
            for e in events:
                ts_iso = e.get("receivedAtIso", "")
                try:
                    t = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue
                if not (day_start <= t < day_end):
                    continue
                # 关联评估结果 action
                eval_id = e.get("riskResultId")
                if not eval_id:
                    continue
                # 在 results 中查找
                matching = next(
                    (r for r in results if r.get("evalId") == eval_id), None,
                )
                if not matching:
                    continue
                action = matching.get("action", "")
                if action in ("block", "flag"):
                    day_alert_count += 1
                if action == "block":
                    day_block_count += 1
            trend_7d.append({
                "date_iso": day.isoformat(),
                "alert_count": day_alert_count,
                "block_count": day_block_count,
            })

        # 4. top_risky_enterprises: 按告警数 + 风险评分排序取 Top 5
        ent_stats: dict[str, dict] = defaultdict(
            lambda: {"alert_count": 0, "block_count": 0, "total_score": 0},
        )
        for r in results:
            eid = r.get("enterpriseId") or ""
            if not eid:
                continue
            action = r.get("action", "")
            score = int(r.get("totalRiskScore", 0) or 0)
            if action in ("block", "flag"):
                ent_stats[eid]["alert_count"] += 1
            if action == "block":
                ent_stats[eid]["block_count"] += 1
            ent_stats[eid]["total_score"] += score
        top_risky = sorted(
            (
                {
                    "enterprise_id": eid,
                    "alert_count": s["alert_count"],
                    "block_count": s["block_count"],
                    "total_score": s["total_score"],
                }
                for eid, s in ent_stats.items()
            ),
            key=lambda x: (x["alert_count"], x["total_score"]),
            reverse=True,
        )[:5]

        # 5. summary: 全局汇总
        total_rules = 0
        try:
            rules_list = await risk_rule_engine.list_rules(enabled_only=False)
            total_rules = len(rules_list)
        except Exception as exc:
            logger.warning(f"dashboard 拉 rule_engine 失败: {exc}")
            total_rules = 0
        block_count = sum(1 for r in results if r.get("action") == "block")
        flag_count = sum(1 for r in results if r.get("action") == "flag")
        pass_count = sum(1 for r in results if r.get("action") == "pass")

        return {
            "rules_hit_count": dict(rules_hit_count),
            "alerts_today": alerts_today,
            "trend_7d": trend_7d,
            "top_risky_enterprises": top_risky,
            "summary": {
                "total_rules": total_rules,
                "total_events": len(events),
                "block_count": block_count,
                "flag_count": flag_count,
                "pass_count": pass_count,
            },
        }


risk_stream_service = RiskStreamService(db=None)
