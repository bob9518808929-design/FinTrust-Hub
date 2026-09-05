"""文件名：privacy.py 职责：MOD-07 数据安全与隐私计算接口,提供字段加密方案、隐私计算与数据清除任务."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.privacy import (
    EncryptedField, EncryptionScheme, PurgeJob, ShamirShardInfo,
)
from app.services.data_purge_service import DataPurgeService
from app.services.privacy_compute_service import PrivacyComputeService

router = APIRouter(prefix="/modules/privacy", tags=["MOD-07 数据安全与隐私计算"])


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )


class EncryptRequest(_Base):
    value: str
    field_name: str = "anonymous_field"
    scheme: EncryptionScheme = EncryptionScheme.FF1_FPE
    ff1_tweak: str = ""
    ff1_alphanumeric: bool = True


class DecryptRequest(_Base):
    encrypted: EncryptedField
    shards_for_shamir: Optional[list[str]] = None


class ShamirSplitRequest(_Base):
    secret: str
    total: int = Field(default=5, ge=2, le=20)
    threshold: int = Field(default=3, ge=2, le=20)
    holders: list[str] = Field(default_factory=list)


class ShamirCombineRequest(_Base):
    shards: list[str]


class PurgeRequest(_Base):
    enterprise_id: str
    reason: str
    retention_days: int = Field(default=90, ge=0)
    data_types: list[str] = Field(default_factory=list)


class ShamirSplitResponse(_Base):
    shards: list[str]
    info: ShamirShardInfo


def _pc_svc() -> PrivacyComputeService:
    return PrivacyComputeService(db=None)


def _dp_svc() -> DataPurgeService:
    return DataPurgeService(db=None)


@router.post(
    "/encrypt",
    response_model=ApiResult[EncryptedField],
    summary="加密字段 (FF1/SHAMIR/HE_SEAL/AES)",
)
async def encrypt_field(payload: EncryptRequest, _user: CurrentUser = None):
    enc = _pc_svc().encrypt_field(
        value=payload.value,
        scheme=payload.scheme,
        ff1_tweak=payload.ff1_tweak,
        ff1_alphanumeric=payload.ff1_alphanumeric,
    )
    enc.field_name = payload.field_name
    return make_ok(enc)


@router.post(
    "/decrypt",
    response_model=ApiResult[Optional[str]],
    summary="解密字段 (仅 AES/SHAMIR)",
)
async def decrypt_field(payload: DecryptRequest, _user: CurrentUser = None):
    result = _pc_svc().decrypt_field(
        enc=payload.encrypted,
        shards_for_shamir=payload.shards_for_shamir,
    )
    return make_ok(result)


@router.post(
    "/shamir/split",
    response_model=ApiResult[ShamirSplitResponse],
    summary="Shamir 秘密分片 (默认 3 of 5)",
)
async def shamir_split(payload: ShamirSplitRequest, _user: CurrentUser = None):
    shards, info = _pc_svc().shamir_split(
        secret=payload.secret,
        total=payload.total,
        threshold=payload.threshold,
        holders=payload.holders,
    )
    return make_ok(ShamirSplitResponse(shards=shards, info=info))


@router.post(
    "/shamir/combine",
    response_model=ApiResult[str],
    summary="Shamir 合并还原秘密 (≥ threshold 分片)",
)
async def shamir_combine(payload: ShamirCombineRequest, _user: CurrentUser = None):
    result = _pc_svc().shamir_combine(payload.shards)
    return make_ok(result)


@router.post(
    "/purge",
    response_model=ApiResult[PurgeJob],
    summary="调度执行数据 purge 作业",
)
async def run_purge(payload: PurgeRequest, _user: CurrentUser = None):
    job = await _dp_svc().schedule_purge(
        enterprise_id=payload.enterprise_id,
        reason=payload.reason,
        retention_days=payload.retention_days,
        data_types=payload.data_types,
    )
    return make_ok(job)


@router.get(
    "/purge",
    response_model=ApiResult[list[PurgeJob]],
    summary="列出 purge 作业 (可按企业筛选)",
)
async def list_purge(
    enterprise_id: Optional[str] = Query(default=None, alias="enterpriseId"),
    _user: CurrentUser = None,
):
    jobs = await _pc_svc().list_purge_jobs(enterprise_id=enterprise_id)
    return make_ok(jobs)


# ====================================================================
# R5.4 HE-SEAL 同态加密 + 联邦学习
# ====================================================================

class HEEncryptRequest(_Base):
    value: int


class HEDecryptRequest(_Base):
    cipher: str


class HEAddRequest(_Base):
    cipher_a: str
    cipher_b: str


class FederatedPartialRequest(_Base):
    enterprise_id: str
    model_params: dict = Field(default_factory=dict)


class FederatedAggregateRequest(_Base):
    partials: list[dict] = Field(default_factory=list)


@router.post(
    "/he/encrypt",
    response_model=ApiResult[Optional[str]],
    summary="同态加密 (HE-SEAL, 库不可用返回 None)",
)
async def he_encrypt(payload: HEEncryptRequest, _user: CurrentUser = None):
    result = _pc_svc().he_encrypt(payload.value)
    return make_ok(result)


@router.post(
    "/he/decrypt",
    response_model=ApiResult[Optional[int]],
    summary="同态解密 (HE-SEAL, 库不可用返回 None)",
)
async def he_decrypt(payload: HEDecryptRequest, _user: CurrentUser = None):
    result = _pc_svc().he_decrypt(payload.cipher)
    return make_ok(result)


@router.post(
    "/he/add",
    response_model=ApiResult[Optional[str]],
    summary="同态密文加法 (HE-SEAL, 库不可用返回 None)",
)
async def he_add(payload: HEAddRequest, _user: CurrentUser = None):
    result = _pc_svc().he_add(payload.cipher_a, payload.cipher_b)
    return make_ok(result)


@router.post(
    "/federated/partial",
    summary="联邦学习: 本地梯度计算 mock",
)
async def federated_partial(payload: FederatedPartialRequest, _user: CurrentUser = None):
    result = _pc_svc().federated_learning_partial(
        payload.enterprise_id, payload.model_params,
    )
    return make_ok(result)


@router.post(
    "/federated/aggregate",
    summary="联邦学习: 聚合多方梯度 mock (FedAvg)",
)
async def federated_aggregate(payload: FederatedAggregateRequest, _user: CurrentUser = None):
    result = _pc_svc().federated_learning_aggregate(payload.partials)
    return make_ok(result)
