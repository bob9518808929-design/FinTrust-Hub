"""MOD-15 独立兜底引擎 schemas (R6.3).

支持企业离线/降级运行模式, 队列操作重放 + 冲突检测 + 增量同步.

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp

# === 枚举 ===

class FallbackMode(StrEnum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    DEGRADED = "DEGRADED"


class SyncStatus(StrEnum):
    SYNCED = "SYNCED"
    PENDING = "PENDING"
    CONFLICT = "CONFLICT"


class _Base(BaseModel):
    """兜底引擎 schema 公共配置."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class FallbackConfig(_Base):
    """企业兜底配置 (模式 + 启用模块 + 队列长度)."""
    enterprise_id: Id = Field(description="企业 ID")
    mode: FallbackMode = Field(description="运行模式 ONLINE/OFFLINE/DEGRADED")
    enabled_modules: list[str] = Field(
        default_factory=list, description="启用的模块列表"
    )
    sync_interval_minutes: int = Field(
        default=15, ge=1, description="同步间隔 (分钟)"
    )
    last_sync_at_iso: IsoTimestamp | None = Field(
        default=None, description="最近一次同步时间"
    )
    queued_operations: int = Field(
        default=0, ge=0, description="排队操作数"
    )


class SyncResult(_Base):
    """同步结果 (重放 + 冲突 + 增量)."""
    enterprise_id: Id = Field(description="企业 ID")
    synced_count: int = Field(ge=0, description="成功同步操作数")
    failed_count: int = Field(ge=0, description="失败操作数")
    conflict_count: int = Field(ge=0, description="冲突操作数")
    sync_duration_ms: int = Field(ge=0, description="同步耗时 (毫秒)")


__all__ = ["FallbackConfig", "FallbackMode", "SyncResult", "SyncStatus"]
