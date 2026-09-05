"""企业领域服务.

职责:
    1. 企业 CRUD (列表/详情/创建/更新)
    2. 银行/担保/保险公司列表
    3. 改造结果回写 (project_memory: applyReformResult)
    4. 融资入口锁定检查

双轨:
    - 开发期: 内存 store (seed_data), 零 DB 依赖
    - 生产期: SQLAlchemy 异步会话持久化
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enterprise import Bank as BankORM
from app.models.enterprise import Enterprise as EnterpriseORM
from app.models.enterprise import Guarantor as GuarantorORM
from app.models.enterprise import Insurer as InsurerORM
from app.schemas.enterprise import Enterprise, EnterpriseCreate, EnterpriseUpdate
from app.services.seed import (
    BANKS_SEED,
    ENTERPRISES_SEED,
    GUARANTORS_SEED,
    INSURERS_SEED,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ============================================================================
# 内存 store (开发期兜底, 当 DB 不可用或为空时启用)
# ============================================================================

class _InMemoryStore:
    """线程安全的内存存储 (开发期)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._enterprises: dict[str, dict] = {e["id"]: dict(e) for e in ENTERPRISES_SEED}
        self._banks: dict[str, dict] = {b["id"]: dict(b) for b in BANKS_SEED}
        self._guarantors: dict[str, dict] = {g["id"]: dict(g) for g in GUARANTORS_SEED}
        self._insurers: dict[str, dict] = {i["id"]: dict(i) for i in INSURERS_SEED}
        self._seeded = True

    async def list_enterprises(self) -> list[dict]:
        async with self._lock:
            return list(self._enterprises.values())

    async def get_enterprise(self, eid: str) -> dict | None:
        async with self._lock:
            e = self._enterprises.get(eid)
            return dict(e) if e else None

    async def create_enterprise(self, payload: dict) -> dict:
        async with self._lock:
            eid = payload.get("id") or f"E-{uuid4().hex[:8]}"
            payload["id"] = eid
            payload.setdefault("runtime", {
                "creditCompleteness": 0.0, "creditScore": 600,
                "maxAmountMultiplier": 1.0, "rateDiscount": 0.0,
                "creditGradeCap": "C", "approvalSpeed": "normal",
                "waterLevel": 0.0, "fiveStreams": {},
                "guaranteeStatus": "none", "insuranceStatus": "none",
                "financingUnlocked": False, "responsibilityChain": {"nodes": [], "completeness": 0.0, "totalScore": 0},
            })
            payload.setdefault("reform", {
                "status": "idle", "progress": 0.0,
                "currentLevel": "D", "targetLevel": "A",
                "aggressionLevel": "balanced",
            })
            ts = _now_iso()
            payload["createdAt"] = ts
            payload["updatedAt"] = ts
            self._enterprises[eid] = dict(payload)
            return dict(payload)

    async def update_enterprise(self, eid: str, updates: dict) -> dict | None:
        async with self._lock:
            e = self._enterprises.get(eid)
            if not e:
                return None
            for k, v in updates.items():
                if v is not None:
                    e[k] = v
            e["updatedAt"] = _now_iso()
            return dict(e)

    async def list_banks(self) -> list[dict]:
        async with self._lock:
            return list(self._banks.values())

    async def list_guarantors(self) -> list[dict]:
        async with self._lock:
            return list(self._guarantors.values())

    async def list_insurers(self) -> list[dict]:
        async with self._lock:
            return list(self._insurers.values())

    async def apply_reform_result(self, eid: str, payload: dict) -> dict | None:
        async with self._lock:
            e = self._enterprises.get(eid)
            if not e:
                return None
            runtime = e.setdefault("runtime", {})
            reform = e.setdefault("reform", {})
            if payload.get("hasReformed"):
                reform["status"] = "completed"
                reform["progress"] = 1.0
                if payload.get("afterLevel"):
                    reform["currentLevel"] = payload["afterLevel"]
                reform["completedAt"] = payload.get("reformedAt")
            runtime["financingUnlocked"] = payload.get("financingUnlocked", False)
            if payload.get("afterScorecard"):
                runtime["afterScorecard"] = payload["afterScorecard"]
            e["updatedAt"] = _now_iso()
            return dict(e)


_store = _InMemoryStore()


# ============================================================================
# 服务接口 (双轨: 优先 DB, 兜底内存)
# ============================================================================

class EnterpriseService:
    """企业领域服务."""

    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db

    async def list_enterprises(self) -> list[Enterprise]:
        """列出全部企业."""
        if self.db is not None:
            try:
                stmt = select(EnterpriseORM).where(EnterpriseORM.deleted_at.is_(None))
                result = await self.db.execute(stmt)
                rows = result.scalars().all()
                if rows:
                    return [self._row_to_schema(r) for r in rows]
            except Exception:
                pass  # DB 未就绪, 兜底内存
        data = await _store.list_enterprises()
        return [self._dict_to_schema(d) for d in data]

    async def get_enterprise(self, eid: str) -> Enterprise | None:
        """按 ID 查企业详情."""
        if self.db is not None:
            try:
                stmt = select(EnterpriseORM).where(
                    EnterpriseORM.id == eid,
                    EnterpriseORM.deleted_at.is_(None),
                )
                result = await self.db.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    return self._row_to_schema(row)
            except Exception:
                pass
        data = await _store.get_enterprise(eid)
        return self._dict_to_schema(data) if data else None

    async def create_enterprise(self, payload: EnterpriseCreate) -> Enterprise:
        """创建企业."""
        data = payload.model_dump(by_alias=False, exclude_unset=False)
        if self.db is not None:
            try:
                orm = EnterpriseORM(**self._dict_to_orm(data))
                self.db.add(orm)
                await self.db.flush()
                return self._row_to_schema(orm)
            except Exception:
                await self.db.rollback()
        created = await _store.create_enterprise(data)
        return self._dict_to_schema(created)

    async def update_enterprise(self, eid: str, payload: EnterpriseUpdate) -> Enterprise | None:
        """更新企业 (部分字段)."""
        updates = payload.model_dump(by_alias=False, exclude_unset=True, exclude_none=True)
        if self.db is not None:
            try:
                stmt = select(EnterpriseORM).where(EnterpriseORM.id == eid)
                result = await self.db.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    for k, v in updates.items():
                        setattr(row, k, v)
                    await self.db.flush()
                    return self._row_to_schema(row)
            except Exception:
                await self.db.rollback()
        updated = await _store.update_enterprise(eid, updates)
        return self._dict_to_schema(updated) if updated else None

    async def apply_reform_result(self, eid: str, payload: dict) -> Enterprise | None:
        """回写改造结果 (project_memory 硬约束)."""
        if self.db is not None:
            try:
                stmt = select(EnterpriseORM).where(EnterpriseORM.id == eid)
                result = await self.db.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    runtime = dict(row.runtime or {})
                    reform = dict(row.reform or {})
                    if payload.get("hasReformed"):
                        reform["status"] = "completed"
                        reform["progress"] = 1.0
                        if payload.get("afterLevel"):
                            reform["currentLevel"] = payload["afterLevel"]
                        reform["completedAt"] = payload.get("reformedAt")
                    runtime["financingUnlocked"] = payload.get("financingUnlocked", False)
                    if payload.get("afterScorecard"):
                        runtime["afterScorecard"] = payload["afterScorecard"]
                    row.runtime = runtime
                    row.reform = reform
                    await self.db.flush()
                    return self._row_to_schema(row)
            except Exception:
                await self.db.rollback()
        updated = await _store.apply_reform_result(eid, payload)
        return self._dict_to_schema(updated) if updated else None

    async def reset_reform(self, eid: str) -> Enterprise | None:
        """重置改造状态 (project_memory: 同步清零 hasReformed/reformedAt/afterLevel 等)."""
        if self.db is not None:
            try:
                stmt = select(EnterpriseORM).where(EnterpriseORM.id == eid)
                result = await self.db.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    reform = dict(row.reform or {})
                    reform["status"] = "pending"
                    reform["progress"] = 0.0
                    reform.pop("currentLevel", None)
                    reform.pop("completedAt", None)
                    runtime = dict(row.runtime or {})
                    runtime["financingUnlocked"] = False
                    runtime.pop("afterScorecard", None)
                    row.reform = reform
                    row.runtime = runtime
                    await self.db.flush()
                    return self._row_to_schema(row)
            except Exception:
                await self.db.rollback()
        # 内存 store 兜底
        ent = await _store.get_enterprise(eid)
        if not ent:
            return None
        reform = ent.get("reform", {})
        reform["status"] = "pending"
        reform["progress"] = 0.0
        reform.pop("currentLevel", None)
        reform.pop("completedAt", None)
        runtime = ent.get("runtime", {})
        runtime["financingUnlocked"] = False
        runtime.pop("afterScorecard", None)
        ent["reform"] = reform
        ent["runtime"] = runtime
        await _store.update_enterprise(eid, ent)
        return self._dict_to_schema(ent)

    async def check_financing_unlocked(self, eid: str) -> dict:
        """融资入口锁定检查 (路由守卫用)."""
        ent = await self.get_enterprise(eid)
        if not ent:
            return {"exists": False, "unlocked": False, "reason": "企业不存在"}
        unlocked = bool(ent.runtime and ent.runtime.financing_unlocked)
        return {
            "exists": True,
            "unlocked": unlocked,
            "reason": "" if unlocked else "企业未完成改造, 融资入口锁定",
            "reformStatus": ent.reform.get("status", "idle") if isinstance(ent.reform, dict) else getattr(ent.reform, "status", "idle"),
        }

    # === 金融机构 ===

    async def list_banks(self) -> list[dict]:
        if self.db is not None:
            try:
                stmt = select(BankORM).where(BankORM.deleted_at.is_(None))
                result = await self.db.execute(stmt)
                rows = result.scalars().all()
                if rows:
                    return [self._bank_row_to_dict(r) for r in rows]
            except Exception:
                pass
        return await _store.list_banks()

    async def list_guarantors(self) -> list[dict]:
        if self.db is not None:
            try:
                stmt = select(GuarantorORM).where(GuarantorORM.deleted_at.is_(None))
                result = await self.db.execute(stmt)
                rows = result.scalars().all()
                if rows:
                    return [self._guarantor_row_to_dict(r) for r in rows]
            except Exception:
                pass
        return await _store.list_guarantors()

    async def list_insurers(self) -> list[dict]:
        if self.db is not None:
            try:
                stmt = select(InsurerORM).where(InsurerORM.deleted_at.is_(None))
                result = await self.db.execute(stmt)
                rows = result.scalars().all()
                if rows:
                    return [self._insurer_row_to_dict(r) for r in rows]
            except Exception:
                pass
        return await _store.list_insurers()

    # === 转换辅助 ===

    def _row_to_schema(self, row: EnterpriseORM) -> Enterprise:
        return self._dict_to_schema({
            "id": row.id,
            "name": row.name,
            "industry": row.industry,
            "industryLabel": row.industry_label,
            "industryPolicy": row.industry_policy,
            "riskProfile": row.risk_profile,
            "riskLabel": row.risk_label,
            "dataFlows": row.data_flows,
            "modules": row.modules,
            "cooperation": row.cooperation,
            "dataVisibility": row.data_visibility,
            "financials": row.financials,
            "runtime": row.runtime,
            "reform": row.reform,
            "createdAt": row.created_at.isoformat() if row.created_at else _now_iso(),
            "updatedAt": row.updated_at.isoformat() if row.updated_at else _now_iso(),
        })

    def _dict_to_schema(self, data: dict) -> Enterprise:
        return Enterprise.model_validate(data)

    def _dict_to_orm(self, data: dict) -> dict:
        """schema dict -> ORM 字段名 (snake_case)."""
        mapping = {
            "industryLabel": "industry_label",
            "industryPolicy": "industry_policy",
            "riskProfile": "risk_profile",
            "riskLabel": "risk_label",
            "dataFlows": "data_flows",
            "dataVisibility": "data_visibility",
        }
        out = {}
        for k, v in data.items():
            out[mapping.get(k, k)] = v
        if "id" not in out or not out["id"]:
            out["id"] = f"E-{uuid4().hex[:8]}"
        return out

    def _bank_row_to_dict(self, row: BankORM) -> dict:
        return {
            "id": row.id, "name": row.name, "baseRate": row.base_rate,
            "baseRateValue": float(row.base_rate_value), "maxAmount": row.max_amount,
            "requiresGuarantee": row.requires_guarantee, "label": row.label,
            "bankGroup": row.bank_group,
        }

    def _guarantor_row_to_dict(self, row: GuarantorORM) -> dict:
        return {
            "id": row.id, "name": row.name, "mode": row.mode,
            "activeGuarantees": row.active_guarantees, "guaranteeRate": row.guarantee_rate,
        }

    def _insurer_row_to_dict(self, row: InsurerORM) -> dict:
        return {
            "id": row.id, "name": row.name, "mode": row.mode,
            "activePolicies": row.active_policies, "premiumRate": row.premium_rate,
        }


# 全局单例 (无 DB 依赖场景, 如 health / 轻量查询)
enterprise_service = EnterpriseService(db=None)
