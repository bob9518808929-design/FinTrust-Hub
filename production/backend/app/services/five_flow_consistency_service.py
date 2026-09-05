"""MOD-01 资金监管 — 五流合一校验引擎服务 (R4.6).

设计依据: spec.md MOD-01 L395-435 五流合一校验.
六流: 资金流 (FUND) / 合同流 (CONTRACT) / 票据流 (INVOICE) / 物流 (LOGISTICS)
      / IoT 设备流 (IOT) / 人流 (HUMAN, 来自 responsibility_chain_service).

一致性校验维度:
    1) 金额一致性: 六流金额误差 < 1 元 (即 |amount_a - amount_b| < 100 分)
    2) 时间一致性: 各流时间差 < 7 天 (604800 秒)
    3) 主体一致性: 交易对手名称在各流中一致 (size <= 1 unique name)

降级策略: 各源服务 (fund/contract/invoice/iot/responsibility) 不可用时返回 mock seed,
        保证零机构接入时仍可独立运行 (遵循 project_memory "C 档兜底" 原则).

设计风格参照 bank_service.py: 内存单例 _FiveFlowStore + asyncio.Lock + _seed + db=None 注入.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from app.schemas.five_flow import (
    ConsistencyCheckResult, FlowRecord, FlowType,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "fl") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _flow_value(ft: Any) -> str:
    """获取 FlowType 的字符串值 (兼容 FlowType 实例和 str, 因 use_enum_values=True)."""
    if isinstance(ft, FlowType):
        return ft.value
    return str(ft)


# 一致性阈值
_AMOUNT_TOLERANCE_CENTS = 100  # 1 元
_TIME_TOLERANCE_SECONDS = 7 * 24 * 3600  # 7 天


# ============================================================================
# 内存状态 (开发期, 参考 bank_service._BankStore 模式)
# ============================================================================

class _FiveFlowStore:
    """五流合一内存兜底数据 (C 档独立兜底, 后端无 DB 时返回)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # key: (enterprise_id, tx_id) -> list[FlowRecord dict]
        self._records: dict[tuple[str, str], list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        """内置 mock: 5 个交易 × 6 流 = 30 条 FlowRecord; 其中 2 个交易有不一致.

        - TX-001 ~ TX-003: 六流完全一致 (baseline)
        - TX-004: 金额不匹配 (合同流金额比资金流少 50000 元)
        - TX-005: 主体不一致 (物流流对手方名称与其他流不同)
        """
        enterprises = ["E001", "E002", "E003", "E004", "E005"]
        counterparties = [
            ("深圳供应链 A 公司", "CP-A"),
            ("杭州智造 B 公司", "CP-B"),
            ("苏州新材料 C 公司", "CP-C"),
            ("广州新能源 D 公司", "CP-D"),
            ("上海贸易 E 公司", "CP-E"),
        ]
        # 基础金额 (分): 5 个交易各 1,000,000 元 = 100,000,000 分
        base_amount_cents = 100_000_000

        # 6 流的相对时间偏移 (天): 资金 / 合同 / 票据 / 物流 / IoT / 人流
        # 正常交易: 各流时间差 < 7 天, 这里用 1-3 天偏移
        day_offsets = {
            FlowType.FUND: 0,
            FlowType.CONTRACT: -1,  # 合同先签 1 天
            FlowType.INVOICE: 1,    # 发票 1 天后
            FlowType.LOGISTICS: 2,  # 物流 2 天后
            FlowType.IOT: 2,        # IoT 设备与物流同日
            FlowType.HUMAN: -1,     # 人流责任链与合同同日
        }
        # 6 流默认 evidence_ref 前缀
        evidence_prefix = {
            FlowType.FUND: "FUND-TX",
            FlowType.CONTRACT: "CTR",
            FlowType.INVOICE: "INV",
            FlowType.LOGISTICS: "LOG",
            FlowType.IOT: "IOT-DEV",
            FlowType.HUMAN: "CHAIN-NODE",
        }
        # 6 流默认 flow_id 前缀
        flow_id_prefix = {
            FlowType.FUND: "fr-fund",
            FlowType.CONTRACT: "fr-ctr",
            FlowType.INVOICE: "fr-inv",
            FlowType.LOGISTICS: "fr-log",
            FlowType.IOT: "fr-iot",
            FlowType.HUMAN: "fr-hum",
        }

        now = datetime.now(timezone.utc)
        for idx, (eid, tx_id) in enumerate(
            zip(enterprises, [f"TX-2026-{i:04d}" for i in range(1, 6)])
        ):
            cp_name, cp_id = counterparties[idx]
            flows: list[dict] = []
            for flow_type in FlowType:
                offset = day_offsets[flow_type]
                tx_time = (now + timedelta(days=offset - idx)).isoformat()
                # TX-004 金额不匹配: 合同流少 50000 元 = 5,000,000 分
                if tx_id == "TX-2026-0004" and flow_type == FlowType.CONTRACT:
                    amt = base_amount_cents - 5_000_000
                else:
                    amt = base_amount_cents
                # TX-005 主体不一致: 物流流对手方名称不同
                if tx_id == "TX-2026-0005" and flow_type == FlowType.LOGISTICS:
                    cp_n = "上海贸易 F 公司 (虚假)"
                    cp_i = "CP-F-FAKE"
                else:
                    cp_n = cp_name
                    cp_i = cp_id
                flows.append({
                    "flowId": _id(flow_id_prefix[flow_type]),
                    "flowType": flow_type.value,
                    "enterpriseId": eid,
                    "txId": tx_id,
                    "amountCents": amt,
                    "counterpartyName": cp_n,
                    "counterpartyId": cp_i,
                    "txTimeIso": tx_time,
                    "evidenceRef": f"{evidence_prefix[flow_type]}-{idx+1:04d}",
                    "status": "confirmed",
                })
            self._records[(eid, tx_id)] = flows

    async def get_records(self, enterprise_id: str, tx_id: str) -> list[dict]:
        async with self._lock:
            records = self._records.get((enterprise_id, tx_id), [])
            return [dict(r) for r in records]

    async def upsert_records(
        self, enterprise_id: str, tx_id: str, records: list[dict],
    ) -> list[dict]:
        async with self._lock:
            self._records[(enterprise_id, tx_id)] = [dict(r) for r in records]
            return [dict(r) for r in records]

    async def list_all_records(self) -> list[dict]:
        async with self._lock:
            flat: list[dict] = []
            for records in self._records.values():
                flat.extend(dict(r) for r in records)
            return flat


_five_flow_store = _FiveFlowStore()


# ============================================================================
# 五流合一校验服务
# ============================================================================

class FiveFlowConsistencyService:
    """五流合一校验引擎服务 (MOD-01).

    各源服务 (fund/contract/invoice/iot/responsibility) 不可用时返回 mock seed,
    保证零机构接入时仍可独立运行 (遵循 project_memory "C 档兜底" 原则).
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入, 当前仅内存兜底

    async def collect_flow_records(
        self, enterprise_id: str, tx_id: str,
    ) -> list[FlowRecord]:
        """收集指定交易的所有流记录.

        实现策略:
            1. 优先从 _five_flow_store 内存 seed 拉取 (覆盖 fund/contract/invoice/iot/responsibility)
            2. 各源服务 (fund_service / contract_service 等) 暂以内存 seed 兜底,
               真实接入时可在 _try_collect_from_external_services 拼装
        """
        records = await _five_flow_store.get_records(enterprise_id, tx_id)
        return [FlowRecord.model_validate(r) for r in records]

    async def check_consistency(
        self, enterprise_id: str, tx_id: str,
    ) -> ConsistencyCheckResult:
        """执行单笔交易的六流一致性校验.

        校验维度 (每项不一致扣 20 分, 起始 100 分):
            1. 金额一致性: 六流金额误差 < 1 元 (100 分)
            2. 时间一致性: 各流时间差 < 7 天
            3. 主体一致性: 交易对手名称在各流中一致
        返回 consistency_score (最低 0), passed = score >= 80.
        """
        records = await self.collect_flow_records(enterprise_id, tx_id)
        if not records:
            return ConsistencyCheckResult(
                enterprise_id=enterprise_id,
                tx_id=tx_id,
                total_flows_checked=0,
                matched_flows=[],
                mismatched_flows=[],
                mismatch_details=["未找到该交易的任何流记录"],
                consistency_score=0,
                passed=False,
            )

        score = 100
        mismatched_flows: list[FlowType] = []
        matched_flows: list[FlowType] = [r.flow_type for r in records]
        details: list[str] = []

        # === 金额一致性 ===
        amounts = [r.amount_cents for r in records if r.amount_cents > 0]
        if amounts:
            amt_min = min(amounts)
            amt_max = max(amounts)
            if amt_max - amt_min > _AMOUNT_TOLERANCE_CENTS:
                # 找出金额偏离的流
                baseline = amounts[0]
                for r in records:
                    if abs(r.amount_cents - baseline) > _AMOUNT_TOLERANCE_CENTS:
                        if r.flow_type not in mismatched_flows:
                            mismatched_flows.append(r.flow_type)
                        details.append(
                            f"金额不匹配: {_flow_value(r.flow_type)} 流金额 {r.amount_cents} 分 "
                            f"偏离基准 {baseline} 分 (容差 {_AMOUNT_TOLERANCE_CENTS} 分)"
                        )
                score -= 20

        # === 时间一致性 ===
        times: list[datetime] = []
        for r in records:
            try:
                times.append(datetime.fromisoformat(r.tx_time_iso))
            except (ValueError, TypeError):
                continue
        if len(times) >= 2:
            t_min = min(times)
            t_max = max(times)
            if (t_max - t_min).total_seconds() > _TIME_TOLERANCE_SECONDS:
                # 找出时间偏离的流
                baseline_t = times[0]
                for r, t in zip(records, times):
                    if abs((t - baseline_t).total_seconds()) > _TIME_TOLERANCE_SECONDS:
                        if r.flow_type not in mismatched_flows:
                            mismatched_flows.append(r.flow_type)
                details.append(
                    f"时间不一致: 最大时间差 {(t_max - t_min).total_seconds() / 86400:.1f} 天 "
                    f"超过 {_TIME_TOLERANCE_SECONDS / 86400:.0f} 天"
                )
                score -= 20

        # === 主体一致性 ===
        names = [r.counterparty_name for r in records if r.counterparty_name]
        unique_names = set(names)
        if len(unique_names) > 1:
            # 找出主体名称偏离的流
            baseline_name = names[0] if names else ""
            for r in records:
                if r.counterparty_name and r.counterparty_name != baseline_name:
                    if r.flow_type not in mismatched_flows:
                        mismatched_flows.append(r.flow_type)
            details.append(
                f"主体不一致: 对手方名称存在 {len(unique_names)} 种 "
                f"({', '.join(list(unique_names)[:3])})"
            )
            score -= 20

        # 标记 mismatched 流的 status (内存中更新, 但不持久化以保持 seed 稳定)
        matched_flows = [
            ft for ft in matched_flows if ft not in mismatched_flows
        ]

        score = max(0, min(100, score))
        passed = score >= 80
        if not details:
            details.append("六流完全一致")

        return ConsistencyCheckResult(
            enterprise_id=enterprise_id,
            tx_id=tx_id,
            total_flows_checked=len(records),
            matched_flows=matched_flows,
            mismatched_flows=mismatched_flows,
            mismatch_details=details,
            consistency_score=score,
            passed=passed,
        )

    async def batch_check(
        self, enterprise_id: str, tx_ids: list[str],
    ) -> list[ConsistencyCheckResult]:
        """批量校验多笔交易."""
        results: list[ConsistencyCheckResult] = []
        for tx_id in tx_ids:
            result = await self.check_consistency(enterprise_id, tx_id)
            results.append(result)
        return results

    # ====================================================================
    # V3 资金流向图谱 (MOD-01)
    # ====================================================================

    async def generate_fund_flow_graph(
        self,
        enterprise_id: str,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict:
        """按企业/时间段生成资金流入流出图谱.

        节点: 账户节点 (企业账户 + 对手方账户).
        边: 交易边 (含金额, 时间, tx_id, 流类型).

        Args:
            enterprise_id: 企业 ID.
            start_date: 起始日期 (ISO 8601, 含 or 不含时区), 可选.
            end_date: 截止日期 (ISO 8601), 可选.

        Returns:
            {
                "enterprise_id": str,
                "start_date": str | None,
                "end_date": str | None,
                "nodes": list[{"id": str, "label": str, "type": "enterprise"|"counterparty", "enterprise_id": str}],
                "edges": list[{"source": str, "target": str, "amount_cents": int, "tx_id": str, "flow_type": str, "tx_time_iso": str, "evidence_ref": str}],
                "summary": {"total_inflow_cents": int, "total_outflow_cents": int, "tx_count": int, "counterparty_count": int},
            }

        数据源:
            1. 优先从 _five_flow_store 内存 seed 拉取该企业的 FUND 流记录.
            2. 同时聚合所有六流记录形成完整图谱 (侧重资金流, 但保留其他流作为辅证).
        """
        # 解析时间范围
        start_dt: datetime | None = None
        end_dt: datetime | None = None
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            except ValueError:
                start_dt = None
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            except ValueError:
                end_dt = None

        # 从 store 收集所有流记录, 过滤企业 + 时间范围
        all_records = await _five_flow_store.list_all_records()
        # 仅保留该企业记录
        records = [r for r in all_records if r.get("enterpriseId") == enterprise_id]

        # 时间范围过滤 (按 txTimeIso)
        if start_dt or end_dt:
            filtered: list[dict] = []
            for r in records:
                try:
                    t = datetime.fromisoformat(r.get("txTimeIso", "").replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue
                if start_dt and t < start_dt:
                    continue
                if end_dt and t > end_dt:
                    continue
                filtered.append(r)
            records = filtered

        # 构建节点 (企业账户 + 对手方账户)
        nodes: list[dict] = []
        node_ids: set[str] = set()
        # 企业账户节点 (固定 ID = enterprise_id)
        ent_node_id = f"ENT-{enterprise_id}"
        nodes.append({
            "id": ent_node_id,
            "label": f"企业 {enterprise_id}",
            "type": "enterprise",
            "enterprise_id": enterprise_id,
        })
        node_ids.add(ent_node_id)
        # 对手方节点
        for r in records:
            cp_id = r.get("counterpartyId", "")
            cp_name = r.get("counterpartyName", "")
            if not cp_id:
                continue
            if cp_id in node_ids:
                continue
            nodes.append({
                "id": cp_id,
                "label": cp_name or cp_id,
                "type": "counterparty",
                "enterprise_id": enterprise_id,
            })
            node_ids.add(cp_id)

        # 构建边 (资金流为主, 其他流作为辅证边)
        edges: list[dict] = []
        total_inflow_cents = 0  # 流入企业账户的金额 (企业作为收款方, 边方向: cp -> ent)
        total_outflow_cents = 0  # 流出企业账户的金额 (企业作为付款方, 边方向: ent -> cp)
        # 简化判定: 合同流/人流视为流入 (企业收款), 物流流视为流出 (企业发货),
        # 资金流根据 evidence_ref 方向判断 (FUND-TX 视为双向, 默认按金额方向归类)
        # 这里采用统一规则: 所有流均作为 ent <-> cp 双向图, 但汇总 inflow/outflow
        for r in records:
            cp_id = r.get("counterpartyId", "")
            if not cp_id or cp_id not in node_ids:
                continue
            flow_type = r.get("flowType", "FUND")
            amount = int(r.get("amountCents", 0))
            tx_id = r.get("txId", "")
            tx_time = r.get("txTimeIso", "")
            evidence_ref = r.get("evidenceRef", "")
            # 资金流: 默认视为企业向对手方付款 (流出)
            # 合同流/票据流/人流: 默认视为企业收款 (流入)
            # 物流/IoT 流: 视为辅证 (不计入金额)
            if flow_type == "FUND":
                direction = "outflow"  # 默认企业付款
                source = ent_node_id
                target = cp_id
                total_outflow_cents += amount
            elif flow_type in ("CONTRACT", "INVOICE", "HUMAN"):
                direction = "inflow"  # 企业收款 (合同/票据对应应收)
                source = cp_id
                target = ent_node_id
                total_inflow_cents += amount
            else:
                # LOGISTICS / IOT: 辅证边, 不计入金额汇总
                direction = "evidence"
                source = ent_node_id
                target = cp_id
            edges.append({
                "source": source,
                "target": target,
                "amount_cents": amount,
                "tx_id": tx_id,
                "flow_type": flow_type,
                "tx_time_iso": tx_time,
                "evidence_ref": evidence_ref,
                "direction": direction,
            })

        counterparty_count = sum(1 for n in nodes if n["type"] == "counterparty")
        tx_count = len({r.get("txId", "") for r in records})

        return {
            "enterprise_id": enterprise_id,
            "start_date": start_date,
            "end_date": end_date,
            "nodes": nodes,
            "edges": edges,
            "summary": {
                "total_inflow_cents": total_inflow_cents,
                "total_outflow_cents": total_outflow_cents,
                "tx_count": tx_count,
                "counterparty_count": counterparty_count,
            },
        }


five_flow_consistency_service = FiveFlowConsistencyService(db=None)
