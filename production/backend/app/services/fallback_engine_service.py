"""MOD-15 独立兜底引擎服务 (R6.3).

离线模式数据同步: 队列操作重放 + 冲突检测 + 增量同步.

设计风格: 内存单例 + asyncio.Lock + _seed + db=None (参考 bank_service.py).

种子: 4 企业 (2 online / 1 offline / 1 degraded), 每个离线企业 10 条排队操作.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from app.schemas.fallback_engine import (
    FallbackConfig, FallbackMode, SyncResult, SyncStatus,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "op") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ============================================================================
# 内存状态
# ============================================================================

class _FallbackStore:
    """内存兜底: 4 企业配置 + 离线企业排队操作."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # enterprise_id -> config dict
        self._configs: dict[str, dict] = {}
        # enterprise_id -> list[op dict]
        self._queued_ops: dict[str, list[dict]] = {}
        # enterprise_id -> list[conflict dict]
        self._conflicts: dict[str, list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(timezone.utc)
        # 4 企业: 2 online / 1 offline / 1 degraded
        specs = [
            ("E001", FallbackMode.ONLINE, 0),
            ("E002", FallbackMode.ONLINE, 0),
            ("E003", FallbackMode.OFFLINE, 10),
            ("E004", FallbackMode.DEGRADED, 10),
        ]
        for idx, (eid, mode, queue_count) in enumerate(specs):
            cfg = {
                "enterprise_id": eid,
                "mode": mode.value,
                "enabled_modules": [
                    "FUND", "CONTRACT", "INVOICE", "LOGISTICS", "IOT", "HUMAN",
                ] if mode != FallbackMode.DEGRADED else [
                    "FUND", "CONTRACT", "INVOICE",
                ],
                "sync_interval_minutes": 15 if mode == FallbackMode.ONLINE else 5,
                "last_sync_at_iso": (now - timedelta(minutes=idx + 5)).isoformat(),
                "queued_operations": queue_count,
            }
            self._configs[eid] = cfg
            # 离线/降级企业填排队操作
            if mode != FallbackMode.ONLINE:
                ops: list[dict] = []
                for i in range(queue_count):
                    op_id = _id("OP")
                    ops.append({
                        "op_id": op_id,
                        "enterprise_id": eid,
                        "op_type": ["CREATE", "UPDATE", "DELETE"][i % 3],
                        "entity": ["invoice", "contract", "fund_record"][i % 3],
                        "payload": {"id": f"mock-{i+1}", "value": (i + 1) * 1000},
                        "queued_at_iso": (now - timedelta(minutes=queue_count - i)).isoformat(),
                        "status": "PENDING",
                    })
                self._queued_ops[eid] = ops
            else:
                self._queued_ops[eid] = []
            self._conflicts[eid] = []

    async def get_config(self, eid: str) -> dict | None:
        async with self._lock:
            c = self._configs.get(eid)
            return dict(c) if c else None

    async def list_configs(self) -> list[dict]:
        async with self._lock:
            return [dict(c) for c in self._configs.values()]

    async def put_config(self, eid: str, cfg: dict) -> dict:
        async with self._lock:
            self._configs[eid] = dict(cfg)
            return dict(cfg)

    async def get_queued_ops(self, eid: str) -> list[dict]:
        async with self._lock:
            return [dict(o) for o in self._queued_ops.get(eid, [])]

    async def append_queued_op(self, eid: str, op: dict) -> dict:
        async with self._lock:
            self._queued_ops.setdefault(eid, []).append(dict(op))
            # 同步更新 config.queued_operations 计数
            if eid in self._configs:
                self._configs[eid]["queued_operations"] = len(self._queued_ops[eid])
            return dict(op)

    async def clear_queued_ops(self, eid: str) -> int:
        async with self._lock:
            count = len(self._queued_ops.get(eid, []))
            self._queued_ops[eid] = []
            if eid in self._configs:
                self._configs[eid]["queued_operations"] = 0
                self._configs[eid]["last_sync_at_iso"] = _now_iso()
            return count

    async def add_conflict(self, eid: str, conflict: dict) -> dict:
        async with self._lock:
            self._conflicts.setdefault(eid, []).append(dict(conflict))
            return dict(conflict)

    async def get_conflicts(self, eid: str) -> list[dict]:
        async with self._lock:
            return [dict(c) for c in self._conflicts.get(eid, [])]

    async def clear_conflicts(self, eid: str) -> int:
        async with self._lock:
            count = len(self._conflicts.get(eid, []))
            self._conflicts[eid] = []
            return count


_fallback_store = _FallbackStore()


# ============================================================================
# 兜底引擎服务
# ============================================================================

class FallbackEngineService:
    """兜底引擎服务 (MOD-15).

    主要方法:
        - get_config: 获取企业兜底配置
        - set_mode: 切换运行模式
        - sync_data: 离线模式数据同步 (重放 + 冲突检测 + 增量)
        - queue_operation: 离线模式下排队操作
        - check_conflict: 检测本地与远程数据冲突
    """

    DEFAULT_ENABLED_MODULES_ONLINE = [
        "FUND", "CONTRACT", "INVOICE", "LOGISTICS", "IOT", "HUMAN",
    ]
    DEFAULT_ENABLED_MODULES_OFFLINE = [
        "FUND", "CONTRACT", "INVOICE",
    ]

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def get_config(self, enterprise_id: str) -> FallbackConfig:
        """获取企业兜底配置 (不存在则创建默认 ONLINE 配置)."""
        cfg = await _fallback_store.get_config(enterprise_id)
        if not cfg:
            cfg = {
                "enterprise_id": enterprise_id,
                "mode": FallbackMode.ONLINE.value,
                "enabled_modules": list(self.DEFAULT_ENABLED_MODULES_ONLINE),
                "sync_interval_minutes": 15,
                "last_sync_at_iso": _now_iso(),
                "queued_operations": 0,
            }
            await _fallback_store.put_config(enterprise_id, cfg)
        return FallbackConfig.model_validate(cfg)

    async def set_mode(
        self, enterprise_id: str, mode: FallbackMode | str,
    ) -> FallbackConfig:
        """切换企业运行模式 (ONLINE / OFFLINE / DEGRADED).

        - ONLINE → OFFLINE: 启用模块缩减为离线最小集
        - OFFLINE → ONLINE: 触发同步 (由调用方触发, 此处仅改模式)

        兼容 use_enum_values=True 场景: 路由层可能传入字符串值.
        """
        # 归一化为 FallbackMode 枚举 (兼容 str 传入)
        if isinstance(mode, str):
            mode_enum = FallbackMode(mode)
        else:
            mode_enum = mode
        cfg = await _fallback_store.get_config(enterprise_id)
        if not cfg:
            cfg = {
                "enterprise_id": enterprise_id,
                "mode": FallbackMode.ONLINE.value,
                "enabled_modules": list(self.DEFAULT_ENABLED_MODULES_ONLINE),
                "sync_interval_minutes": 15,
                "last_sync_at_iso": _now_iso(),
                "queued_operations": 0,
            }
        cfg["mode"] = mode_enum.value
        # 模式变更时调整启用的模块 (简化: offline/degraded 时只保留核心 3 模块)
        if mode_enum in (FallbackMode.OFFLINE, FallbackMode.DEGRADED):
            cfg["enabled_modules"] = list(self.DEFAULT_ENABLED_MODULES_OFFLINE)
            cfg["sync_interval_minutes"] = 5
        else:
            cfg["enabled_modules"] = list(self.DEFAULT_ENABLED_MODULES_ONLINE)
            cfg["sync_interval_minutes"] = 15
        await _fallback_store.put_config(enterprise_id, cfg)
        return FallbackConfig.model_validate(cfg)

    async def queue_operation(
        self, enterprise_id: str, operation: dict,
    ) -> int:
        """离线模式下排队操作 (返回当前队列长度).

        若当前为 ONLINE 模式, 自动提示应该切换 OFFLINE.
        """
        cfg = await self.get_config(enterprise_id)
        if cfg.mode == FallbackMode.ONLINE.value:
            # 不允许在 ONLINE 模式排队, 提示调用方切换 OFFLINE
            logger.info(
                f"企业 {enterprise_id} 处于 ONLINE 模式, 建议切换 OFFLINE 后排队"
            )
        op = {
            "op_id": _id("OP"),
            "enterprise_id": enterprise_id,
            "op_type": operation.get("op_type", "CREATE"),
            "entity": operation.get("entity", "unknown"),
            "payload": dict(operation.get("payload", {})),
            "queued_at_iso": _now_iso(),
            "status": SyncStatus.PENDING.value,
        }
        await _fallback_store.append_queued_op(enterprise_id, op)
        updated = await _fallback_store.get_config(enterprise_id)
        return int(updated.get("queued_operations", 0)) if updated else 0

    async def check_conflict(self, enterprise_id: str) -> list[dict]:
        """检测本地与远程数据冲突.

        检测规则 (mock):
            - 对同 entity 的 DELETE + UPDATE 操作视为冲突
            - 同 entity 不同 payload 的重复 UPDATE 视为冲突
        Returns: list[dict] 冲突列表.
        """
        ops = await _fallback_store.get_queued_ops(enterprise_id)
        conflicts: list[dict] = []
        # 按 entity 分组
        by_entity: dict[str, list[dict]] = {}
        for op in ops:
            by_entity.setdefault(op.get("entity", ""), []).append(op)
        for entity, group in by_entity.items():
            delete_count = sum(1 for o in group if o.get("op_type") == "DELETE")
            update_count = sum(1 for o in group if o.get("op_type") == "UPDATE")
            # DELETE + UPDATE 同一 entity → 冲突
            if delete_count > 0 and update_count > 0:
                conflicts.append({
                    "entity": entity,
                    "reason": "DELETE 与 UPDATE 操作冲突",
                    "ops": [o.get("op_id") for o in group
                            if o.get("op_type") in ("DELETE", "UPDATE")],
                    "detected_at_iso": _now_iso(),
                })
            # 同 entity 多个 UPDATE 不同 payload → 冲突
            update_payloads = [
                o.get("payload", {}).get("value") for o in group
                if o.get("op_type") == "UPDATE"
            ]
            unique_payloads = set(update_payloads)
            if update_count >= 2 and len(unique_payloads) > 1:
                conflicts.append({
                    "entity": entity,
                    "reason": "同 entity 多个 UPDATE payload 不一致",
                    "ops": [o.get("op_id") for o in group
                            if o.get("op_type") == "UPDATE"],
                    "detected_at_iso": _now_iso(),
                })
        # 持久化冲突
        for c in conflicts:
            await _fallback_store.add_conflict(enterprise_id, c)
        return conflicts

    async def sync_data(self, enterprise_id: str) -> SyncResult:
        """离线模式数据同步: 队列操作重放 + 冲突检测 + 增量同步.

        流程:
            1. 获取队列 ops
            2. check_conflict 找出冲突 ops (跳过)
            3. 重放非冲突 ops (mock)
            4. 清空队列
            5. 返回 SyncResult
        """
        start = time.time()
        ops = await _fallback_store.get_queued_ops(enterprise_id)
        total = len(ops)
        if total == 0:
            return SyncResult(
                enterprise_id=enterprise_id,
                synced_count=0,
                failed_count=0,
                conflict_count=0,
                sync_duration_ms=0,
            )
        # 冲突检测
        conflicts = await self.check_conflict(enterprise_id)
        conflict_op_ids: set[str] = set()
        for c in conflicts:
            conflict_op_ids.update(c.get("ops", []))
        # 重放 (mock: 全部成功, 仅冲突算 failed)
        synced = 0
        failed = 0
        for op in ops:
            if op.get("op_id") in conflict_op_ids:
                failed += 1
            else:
                synced += 1
        # 清空队列
        await _fallback_store.clear_queued_ops(enterprise_id)
        await _fallback_store.clear_conflicts(enterprise_id)
        elapsed_ms = int((time.time() - start) * 1000)
        return SyncResult(
            enterprise_id=enterprise_id,
            synced_count=synced,
            failed_count=failed,
            conflict_count=len(conflicts),
            sync_duration_ms=elapsed_ms,
        )

    # ====================================================================
    # V3 离线模式健康检查 (MOD-15)
    # ====================================================================

    async def health_check_offline(self) -> dict:
        """离线模式下健康状态 (供独立 Docker 镜像 healthcheck 使用).

        Returns:
            {
                "status": "healthy"|"degraded"|"offline",
                "online_enterprises": int (在线企业数),
                "offline_enterprises": int (离线企业数),
                "degraded_enterprises": int (降级企业数),
                "total_queued_operations": int (全平台排队操作数),
                "total_conflicts": int (全平台冲突数),
                "last_sync_at_iso": str | None (最近同步时间),
                "checked_at_iso": str,
                "details": list[{"enterprise_id": str, "mode": str, "queued_ops": int, "is_healthy": bool}],
            }

        健康判定:
            - status=healthy: 无离线企业 + 无未处理冲突
            - status=degraded: 有离线/降级企业但队列长度 < 100
            - status=offline: 任一离线企业队列 > 100 或有未处理冲突
        """
        configs = await _fallback_store.list_configs()
        now_iso = _now_iso()
        online_count = 0
        offline_count = 0
        degraded_count = 0
        total_queued = 0
        total_conflicts = 0
        last_sync_iso: str | None = None
        details: list[dict] = []
        any_unhealthy = False

        for cfg in configs:
            mode = cfg.get("mode", "ONLINE")
            eid = cfg.get("enterprise_id", "")
            queued = int(cfg.get("queued_operations", 0))
            conflicts = await _fallback_store.get_conflicts(eid)
            conflict_count = len(conflicts)
            total_queued += queued
            total_conflicts += conflict_count

            if mode == "ONLINE":
                online_count += 1
            elif mode == "OFFLINE":
                offline_count += 1
            elif mode == "DEGRADED":
                degraded_count += 1

            # 单企业健康: 队列 < 100 + 无未处理冲突
            is_healthy = queued < 100 and conflict_count == 0
            if not is_healthy:
                any_unhealthy = True
            details.append({
                "enterprise_id": eid,
                "mode": mode,
                "queued_ops": queued,
                "conflicts": conflict_count,
                "is_healthy": is_healthy,
            })

            # 最近同步时间
            ls = cfg.get("last_sync_at_iso")
            if ls and (last_sync_iso is None or ls > last_sync_iso):
                last_sync_iso = ls

        # 总体健康判定
        if not any_unhealthy and offline_count == 0 and degraded_count == 0:
            status = "healthy"
        elif any_unhealthy and (total_queued > 100 or total_conflicts > 0):
            status = "offline"
        else:
            status = "degraded"

        return {
            "status": status,
            "online_enterprises": online_count,
            "offline_enterprises": offline_count,
            "degraded_enterprises": degraded_count,
            "total_queued_operations": total_queued,
            "total_conflicts": total_conflicts,
            "last_sync_at_iso": last_sync_iso,
            "checked_at_iso": now_iso,
            "details": details,
        }


fallback_engine_service = FallbackEngineService(db=None)
