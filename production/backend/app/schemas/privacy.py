"""文件名：privacy.py 职责：数据安全与隐私计算 Pydantic 模型,定义加密方案、清除任务与 Shamir 分片 schema."""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, Id, IsoTimestamp


class EncryptionScheme(str, Enum):
    FF1_FPE = "FF1_FPE"
    SHAMIR = "SHAMIR"
    HE_SEAL = "HE_SEAL"
    AES_GCM = "AES_GCM"
    MOCK = "MOCK"


class PurgeStatus(str, Enum):
    SCHEDULED = "SCHEDULED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class _PrivacyBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class EncryptedField(_PrivacyBase):
    field_name: str
    scheme: EncryptionScheme
    cipher_text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ShamirShardInfo(_PrivacyBase):
    total_shards: int = Field(ge=2)
    required_threshold: int = Field(ge=2)
    shard_holders: list[str] = Field(default_factory=list)


class PurgeJob(_PrivacyBase):
    job_id: Id
    enterprise_id: Id
    reason: str
    retention_days: int = Field(ge=0)
    status: PurgeStatus
    scheduled_at: IsoTimestamp
    purged_count: int = Field(default=0, ge=0)
    failed_count: int = Field(default=0, ge=0)
    data_types: list[str] = Field(default_factory=list)
