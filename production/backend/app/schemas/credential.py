"""MOD-08b 信用凭证 W3C VC + 联盟链跨行 schemas (P2 R3.1)."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CredentialType(StrEnum):
    ENTERPRISE_CREDIT_SCORE = "EnterpriseCreditScore"
    PAYMENT_HISTORY = "PaymentHistory"
    COMPLIANCE_RECORD = "ComplianceRecord"
    PERFORMANCE_RATING = "PerformanceRating"


class RevocationStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    SUSPENDED = "suspended"


class ChainType(StrEnum):
    ANT_CHAIN = "AntChain"
    ZHIXIN_CHAIN = "ZhiXinChain"
    LOCAL = "Local"


class W3cProof(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str = "EcdsaSecp256k1Signature2019"
    created_iso: str = Field(alias="createdIso")
    verification_method: str = Field(alias="verificationMethod")
    proof_value: str = Field(alias="proofValue")


class W3cVerifiableCredential(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    issuer_did: str = Field(alias="issuerDid")
    issuer_name: str = Field(alias="issuerName")
    holder_did: str = Field(alias="holderDid")
    issuance_date_iso: str = Field(alias="issuanceDateIso")
    expiration_date_iso: str = Field(alias="expirationDateIso")
    credential_type: CredentialType = Field(alias="credentialType")
    claim: dict[str, Any] = Field(default_factory=dict)
    proof: W3cProof
    revocation_status: RevocationStatus = Field(alias="revocationStatus", default=RevocationStatus.ACTIVE)
    chain_tx_id: str | None = Field(alias="chainTxId", default=None)


class CrossChainVerifyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_chain: ChainType = Field(alias="sourceChain")
    target_chain: ChainType = Field(alias="targetChain")
    vc_id: str = Field(alias="vcId")


class CrossChainVerifyResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    verified: bool
    source_proof: dict[str, Any] = Field(alias="sourceProof", default_factory=dict)
    target_proof: dict[str, Any] = Field(alias="targetProof", default_factory=dict)
    mismatch_reason: str | None = Field(alias="mismatchReason", default=None)
