"""INFRA-04 改造沙箱仿真 schemas (P2 R3.2)."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SandboxStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    ROLLED_BACK = "rolled_back"
    COMMITTED = "committed"


class ChangeDataType(str, Enum):
    FLOW = "flow"
    MODULE = "module"
    CONFIG = "config"
    ROLE = "role"


class SandboxChange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    change_id: str = Field(alias="changeId")
    data_type: ChangeDataType = Field(alias="dataType")
    path: str
    old_value: dict[str, Any] = Field(alias="oldValue", default_factory=dict)
    new_value: dict[str, Any] = Field(alias="newValue", default_factory=dict)
    proposed_by: str = Field(alias="proposedBy")
    applied_at_iso: str = Field(alias="appliedAtIso")
    confirmed_at_iso: str | None = Field(alias="confirmedAtIso", default=None)


class Sandbox(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    enterprise_id: str = Field(alias="enterpriseId")
    baseline_name: str = Field(alias="baselineName")
    snapshot_at_iso: str = Field(alias="snapshotAtIso")
    status: SandboxStatus
    expire_at_iso: str = Field(alias="expireAtIso")
    retained_days: int = Field(alias="retainedDays")
    changes: list[SandboxChange] = Field(default_factory=list)


class SandboxDiff(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    added: int
    removed: int
    modified: int
    unconfirmed_count: int = Field(alias="unconfirmedCount")
    total_size_bytes: int = Field(alias="totalSizeBytes")


class PurgeInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    purged_count: int = Field(alias="purgedCount")
    remaining_days: int = Field(alias="remainingDays")
    will_auto_purge_at_iso: str = Field(alias="willAutoPurgeAtIso")
