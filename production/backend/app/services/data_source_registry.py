"""热插拔数据源适配器框架 (DATA-02 R1.2 交付物).

DataSourceRegistry 单例:
    - register_adapter(type, adapter)  注册适配器
    - unregister_adapter(type)         注销适配器
    - get_adapter(type)                查询适配器
    - list_health()                    聚合所有适配器健康检查

graceful degrade:
    - 单个适配器 health_check 抛异常时, 对应返回 AdapterHealthStatus.FAILED
    - 整体框架不崩溃
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from app.schemas.external_data import (
    AdapterHealth,
    AdapterHealthStatus,
    DataSourceType,
)
from app.services.ecds_adapter import ecds_adapter_service
from app.services.gsxt_adapter import gsxt_adapter_service
from app.services.invoice_verifier import invoice_verifier_service
from app.services.judiciary_adapter import judiciary_adapter_service

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class DataSourceRegistry:
    """数据源适配器注册表 (单例, 热插拔)."""

    _instance: DataSourceRegistry | None = None
    _instance_lock = asyncio.Lock()

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._adapters: dict[DataSourceType, Any] = {}

    @classmethod
    async def get_instance(cls) -> DataSourceRegistry:
        """获取单例 (线程安全)."""
        async with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
                await cls._instance._register_defaults()
            return cls._instance

    async def _register_defaults(self) -> None:
        """注册默认 4 个适配器."""
        await self.register_adapter(
            DataSourceType.INVOICE_VERIFIER, invoice_verifier_service,
        )
        await self.register_adapter(
            DataSourceType.GSXT, gsxt_adapter_service,
        )
        await self.register_adapter(
            DataSourceType.JUDICIARY, judiciary_adapter_service,
        )
        await self.register_adapter(
            DataSourceType.ECDS, ecds_adapter_service,
        )

    async def register_adapter(
        self, type_: DataSourceType, adapter: Any,
    ) -> None:
        """注册适配器.

        若该类型已存在, 覆盖旧的适配器 (热更新).
        """
        async with self._lock:
            self._adapters[type_] = adapter
            logger.info(f"DataSourceRegistry: registered adapter {type_.value}")

    async def unregister_adapter(self, type_: DataSourceType) -> bool:
        """注销适配器, 返回是否成功."""
        async with self._lock:
            existed = type_ in self._adapters
            if existed:
                del self._adapters[type_]
                logger.info(f"DataSourceRegistry: unregistered adapter {type_.value}")
            return existed

    async def get_adapter(self, type_: DataSourceType) -> Any | None:
        """获取适配器, 不存在返回 None."""
        async with self._lock:
            return self._adapters.get(type_)

    async def list_health(self) -> dict[DataSourceType, AdapterHealth]:
        """聚合所有适配器健康检查.

        graceful degrade: 单个适配器异常时标记为 FAILED, 不影响其他适配器.
        """
        async with self._lock:
            adapters_snapshot = list(self._adapters.items())

        results: dict[DataSourceType, AdapterHealth] = {}
        for type_, adapter in adapters_snapshot:
            try:
                if not hasattr(adapter, "health_check"):
                    raise AttributeError("adapter has no health_check method")
                health = await adapter.health_check()
                if not isinstance(health, AdapterHealth):
                    health = AdapterHealth.model_validate(health)
                results[type_] = health
            except Exception as exc:
                logger.warning(
                    f"DataSourceRegistry: health check failed for {type_.value}: {exc}",
                )
                results[type_] = AdapterHealth(
                    status=AdapterHealthStatus.FAILED,
                    latency_ms=99999,
                    last_checked_at=_now_iso(),
                )
        return results


async def get_registry() -> DataSourceRegistry:
    """便捷方法: 获取注册表单例."""
    return await DataSourceRegistry.get_instance()
