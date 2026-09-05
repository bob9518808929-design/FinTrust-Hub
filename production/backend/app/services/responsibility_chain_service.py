from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from app.schemas.responsibility import (
    BehaviorMiningRecord, ChainStage, PersonFlowRole, ResponsibilityChain,
    ResponsibilityResult,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


_STAGE_ROLES: dict[ChainStage, list[tuple[str, str, str]]] = {
    ChainStage.R0_NONE: [],
    ChainStage.R1_INFO: [
        ("财务录入员", "财务负责人", "finance:view,finance:submit"),
        ("业务对接人", "销售部", "contract:view"),
    ],
    ChainStage.R2_VERIFIED: [
        ("财务录入员", "财务负责人", "finance:view,finance:submit"),
        ("业务对接人", "销售部", "contract:view,contract:sign"),
        ("仓库管理员", "仓储部", "logistics:view,logistics:confirm"),
        ("核验员", "风控部", "risk:verify"),
    ],
    ChainStage.R3_INCENTIVIZED: [
        ("财务录入员", "财务负责人", "finance:view,finance:submit,finance:approve"),
        ("业务对接人", "销售部", "contract:view,contract:sign"),
        ("仓库管理员", "仓储部", "logistics:view,logistics:confirm"),
        ("核验员", "风控部", "risk:verify,risk:report"),
        ("激励专员", "人力资源", "incentive:issue,incentive:query"),
    ],
    ChainStage.R4_OPTIMIZED: [
        ("财务录入员", "财务负责人", "finance:*"),
        ("业务对接人", "销售部", "contract:*"),
        ("仓库管理员", "仓储部", "logistics:*"),
        ("核验员", "风控部", "risk:*"),
        ("激励专员", "人力资源", "incentive:*"),
        ("优化分析师", "运营部", "analytics:*"),
    ],
}


class _RespStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._chains: dict[str, dict] = {}
        self._behaviors: list[dict] = []
        self._seed()

    def _seed(self) -> None:
        seed_map = {
            "E001": (ChainStage.R1_INFO, 32.0),
            "E002": (ChainStage.R2_VERIFIED, 65.0),
            "E003": (ChainStage.R3_INCENTIVIZED, 82.0),
            "E004": (ChainStage.R4_OPTIMIZED, 95.0),
        }
        persons_pool = ["张三", "李四", "王五", "赵六", "孙七", "周八"]
        for eid, (stage, integrity) in seed_map.items():
            roles_spec = _STAGE_ROLES.get(stage, [])
            roles: list[dict] = []
            for idx, (rname, dept, actions) in enumerate(roles_spec):
                person = persons_pool[idx % len(persons_pool)]
                roles.append({
                    "roleId": _id("R"),
                    "roleName": rname,
                    "enterpriseId": eid,
                    "personId": f"P{eid}{idx+1:02d}",
                    "personName": person,
                    "department": dept,
                    "authorizedActions": [a.strip() for a in actions.split(",")],
                })
            completeness = (len(roles) / max(1, len(_STAGE_ROLES[ChainStage.R4_OPTIMIZED]))) * 100.0
            missing: list[str] = []
            expected = {r[0] for r in _STAGE_ROLES[ChainStage.R4_OPTIMIZED]}
            current = {r["roleName"] for r in roles}
            missing = sorted(expected - current)
            self._chains[eid] = {
                "chainId": f"CHAIN-{eid}",
                "enterpriseId": eid,
                "stage": stage.value,
                "roles": roles,
                "completenessPct": round(completeness, 1),
                "missingRoles": missing,
                "integrityScore": round(integrity, 1),
            }

        actions = [
            ("扫码确权签收", 0.5),
            ("上传发票附件", 0.4),
            ("审批确认合同", 0.8),
            ("银行流水对账", 0.7),
            ("物流签收拍照", 0.45),
            ("责任链节点签署", 0.9),
        ]
        now = datetime.now(timezone.utc)
        for i in range(20):
            eid = f"E00{(i % 4) + 1}"
            action, weight = random.choice(actions)
            person_idx = i % 6
            ts = (now - timedelta(days=i)).isoformat()
            self._behaviors.append({
                "recordId": _id("BMR"),
                "enterpriseId": eid,
                "personId": f"P{eid}{person_idx+1:02d}",
                "action": action,
                "weight": weight,
                "pointsAwarded": int(weight * 10 + random.randint(1, 5)),
                "actionTimeIso": ts,
                "linkedTxId": _id("TX") if random.random() > 0.5 else None,
            })

    async def get_chain(self, eid: str) -> dict | None:
        async with self._lock:
            c = self._chains.get(eid)
            return dict(c) if c else None

    async def set_chain(self, eid: str, chain: dict) -> dict:
        async with self._lock:
            self._chains[eid] = dict(chain)
            return dict(chain)

    async def add_behavior(self, b: dict) -> dict:
        async with self._lock:
            self._behaviors.insert(0, dict(b))
            return dict(b)

    async def list_behaviors(
        self, eid: str, person_id: Optional[str] = None, days: int = 30,
    ) -> list[dict]:
        async with self._lock:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            items = []
            for b in self._behaviors:
                if b.get("enterpriseId") != eid:
                    continue
                if person_id and b.get("personId") != person_id:
                    continue
                if b.get("actionTimeIso", "") >= cutoff:
                    items.append(dict(b))
            return items


_resp_store = _RespStore()


class ResponsibilityChainService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    @staticmethod
    def _parse_stage(stage_value: str | ChainStage) -> ChainStage:
        if isinstance(stage_value, ChainStage):
            return stage_value
        try:
            return ChainStage(stage_value)
        except ValueError:
            return ChainStage.R0_NONE

    async def get_chain(self, enterprise_id: str) -> ResponsibilityChain:
        chain = await _resp_store.get_chain(enterprise_id)
        if not chain:
            roles_spec = _STAGE_ROLES[ChainStage.R0_NONE]
            roles: list[dict] = []
            for idx, (rname, dept, actions) in enumerate(roles_spec):
                roles.append({
                    "roleId": _id("R"),
                    "roleName": rname,
                    "enterpriseId": enterprise_id,
                    "personId": f"P{enterprise_id}{idx+1:02d}",
                    "personName": f"人员{idx+1}",
                    "department": dept,
                    "authorizedActions": [a.strip() for a in actions.split(",")],
                })
            chain = {
                "chainId": f"CHAIN-{enterprise_id}",
                "enterpriseId": enterprise_id,
                "stage": ChainStage.R0_NONE.value,
                "roles": roles,
                "completenessPct": 0.0,
                "missingRoles": sorted({r[0] for r in _STAGE_ROLES[ChainStage.R4_OPTIMIZED]}),
                "integrityScore": 0.0,
            }
        return ResponsibilityChain.model_validate(chain)

    async def advance_stage(
        self,
        enterprise_id: str,
        target_stage: ChainStage | str,
        evidences: Optional[list[str]] = None,
    ) -> ResponsibilityResult:
        target_stage = self._parse_stage(target_stage)
        chain = await self.get_chain(enterprise_id)
        current_stage = self._parse_stage(chain.stage)
        stages_order = [
            ChainStage.R0_NONE, ChainStage.R1_INFO, ChainStage.R2_VERIFIED,
            ChainStage.R3_INCENTIVIZED, ChainStage.R4_OPTIMIZED,
        ]
        current_idx = stages_order.index(current_stage)
        target_idx = stages_order.index(target_stage)
        if target_idx <= current_idx:
            return ResponsibilityResult(
                chain_id=chain.chain_id,
                enterprise_id=enterprise_id,
                integrity_delta=0.0,
                mining_summary=f"目标阶段 {target_stage.value} 未高于当前 {current_stage.value}, 无需推进",
            )

        roles_spec = _STAGE_ROLES.get(target_stage, [])
        persons_pool = ["张三", "李四", "王五", "赵六", "孙七", "周八", "吴九", "郑十"]
        existing_role_names = {r.role_name for r in chain.roles}
        new_roles = [dict(r.model_dump(by_alias=True)) for r in chain.roles]
        max_person = max([int(r.person_id[-2:]) for r in chain.roles], default=0)
        for idx, (rname, dept, actions) in enumerate(roles_spec):
            if rname in existing_role_names:
                continue
            max_person += 1
            new_roles.append({
                "roleId": _id("R"),
                "roleName": rname,
                "enterpriseId": enterprise_id,
                "personId": f"P{enterprise_id}{max_person:02d}",
                "personName": persons_pool[max_person % len(persons_pool)],
                "department": dept,
                "authorizedActions": [a.strip() for a in actions.split(",")],
            })
        completeness = (len(new_roles) / max(1, len(_STAGE_ROLES[ChainStage.R4_OPTIMIZED]))) * 100.0
        expected = {r[0] for r in _STAGE_ROLES[ChainStage.R4_OPTIMIZED]}
        current = {r["roleName"] for r in new_roles}
        missing = sorted(expected - current)
        integrity_delta = round((target_idx - current_idx) * 12.5 + random.uniform(1.0, 5.0), 1)
        new_integrity = min(100.0, chain.integrity_score + integrity_delta)

        new_chain = {
            "chainId": chain.chain_id,
            "enterpriseId": enterprise_id,
            "stage": target_stage.value,
            "roles": new_roles,
            "completenessPct": round(completeness, 1),
            "missingRoles": missing,
            "integrityScore": round(new_integrity, 1),
        }
        await _resp_store.set_chain(enterprise_id, new_chain)

        points = int(integrity_delta * 10 + 50)
        summary = (
            f"责任链由 {current_stage.value} 推进至 {target_stage.value}; "
            f"新增角色 {len(new_roles) - len(chain.roles)} 个; "
            f"完整度提升至 {completeness:.1f}%; "
            f"诚信积分 +{integrity_delta:.1f}; "
            f"联动生态积分商城 mock 奖励 {points} eco_pts; "
            f"证据链 {len(evidences or [])} 份已上链存证"
        )
        return ResponsibilityResult(
            chain_id=chain.chain_id,
            enterprise_id=enterprise_id,
            integrity_delta=integrity_delta,
            mining_summary=summary,
        )

    async def record_behavior(
        self,
        enterprise_id: str,
        person_id: str,
        action: str,
        weight: float = 0.5,
        linked_tx_id: Optional[str] = None,
    ) -> BehaviorMiningRecord:
        points = int(max(0.0, min(1.0, weight)) * 10 + random.randint(1, 8))
        b = {
            "recordId": _id("BMR"),
            "enterpriseId": enterprise_id,
            "personId": person_id,
            "action": action,
            "weight": max(0.0, min(1.0, weight)),
            "pointsAwarded": points,
            "actionTimeIso": _now_iso(),
            "linkedTxId": linked_tx_id,
        }
        await _resp_store.add_behavior(b)
        return BehaviorMiningRecord.model_validate(b)

    async def list_behaviors(
        self,
        enterprise_id: str,
        person_id: Optional[str] = None,
        days: int = 30,
    ) -> list[BehaviorMiningRecord]:
        items = await _resp_store.list_behaviors(enterprise_id, person_id, days)
        return [BehaviorMiningRecord.model_validate(x) for x in items]


responsibility_chain_service = ResponsibilityChainService(db=None)
