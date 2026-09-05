"""MOD-08b W3C VC 信用凭证 + 联盟链跨行 (P2 R3.1 + R6.1)."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.schemas.credential import (
    ChainType,
    CredentialType,
    CrossChainVerifyRequest,
    CrossChainVerifyResult,
    RevocationStatus,
    W3cProof,
    W3cVerifiableCredential,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _days_later_iso(days: int) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def _vc_id() -> str:
    return f"vc-{uuid.uuid4().hex[:20]}"


def _did(prefix: str, suffix: str) -> str:
    return f"did:fintrust:{prefix}:{suffix}"


def _sign_base64(payload: dict, key_seed: str) -> str:
    raw = (key_seed + "::" + str(sorted(payload.items()))).encode("utf-8")
    sig = hashlib.sha256(raw).digest()
    return base64.b64encode(sig).decode("ascii")


def _issuer_info() -> tuple[str, str, str]:
    return _did("issuer", "fintrust-hub-01"), "FinTrust Hub 信用平台", "fintrust-root-key-01"


class _CredentialStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._vcs: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        issuer_did, issuer_name, vm = _issuer_info()
        seed_specs = [
            ("E001", CredentialType.ENTERPRISE_CREDIT_SCORE, {"score": 88, "level": "A", "model": "v2.5"}),
            ("E001", CredentialType.PAYMENT_HISTORY, {"totalLoans": 12, "onTimeCount": 12, "overdueDays": 0}),
            ("E001", CredentialType.COMPLIANCE_RECORD, {"taxCompliant": True, "laborCases": 0, "penaltyCount": 0}),
            ("E002", CredentialType.PERFORMANCE_RATING, {"rating": "A+", "contractFulfillRate": 0.96, "awards": 3}),
            ("E002", CredentialType.ENTERPRISE_CREDIT_SCORE, {"score": 82, "level": "A-", "model": "v2.5"}),
            ("E002", CredentialType.PAYMENT_HISTORY, {"totalLoans": 8, "onTimeCount": 7, "overdueDays": 2}),
        ]
        for eid, ctype, claim in seed_specs:
            issuance = _now_iso()
            expiration = _days_later_iso(365)
            proof_payload = {
                "issuerDid": issuer_did, "holderDid": _did("enterprise", eid),
                "type": ctype.value, "issuance": issuance,
            }
            vc_id = _vc_id()
            vc = {
                "id": vc_id,
                "issuer_did": issuer_did,
                "issuer_name": issuer_name,
                "holder_did": _did("enterprise", eid),
                "issuance_date_iso": issuance,
                "expiration_date_iso": expiration,
                "credential_type": ctype.value,
                "claim": dict(claim),
                "proof": {
                    "type": "EcdsaSecp256k1Signature2019",
                    "created_iso": issuance,
                    "verification_method": _did("key", vm),
                    "proof_value": _sign_base64(proof_payload, vm),
                },
                "revocation_status": RevocationStatus.ACTIVE.value,
                "chain_tx_id": f"local-tx-{uuid.uuid4().hex[:12]}",
            }
            self._vcs[vc_id] = vc

    async def put_vc(self, vc: dict) -> None:
        async with self._lock:
            self._vcs[vc["id"]] = dict(vc)

    async def get_vc(self, vc_id: str) -> dict | None:
        async with self._lock:
            v = self._vcs.get(vc_id)
            return dict(v) if v else None

    async def list_by_enterprise(self, holder_did_prefix: str) -> list[dict]:
        async with self._lock:
            items = [
                dict(v) for v in self._vcs.values()
                if v.get("holder_did", "").endswith(holder_did_prefix)
            ]
        return items


_vc_store = _CredentialStore()


class CredentialService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db
        # R6.1: SDK 库懒加载缓存
        self._ant_chain_sdk: Any | None = None
        self._ant_chain_tried: bool = False
        self._zhixin_sdk: Any | None = None
        self._zhixin_tried: bool = False

    # ====================================================================
    # R6.1 联盟链 SDK 加载 (不可用返回 False)
    # ====================================================================

    def _load_ant_chain_sdk(self) -> bool:
        """尝试 import antchain_sdk, 不可用返回 False.

        候选模块名: antchain_sdk / antchain / ant_chain_sdk.
        """
        if self._ant_chain_tried:
            return self._ant_chain_sdk is not None
        self._ant_chain_tried = True
        for name in ("antchain_sdk", "antchain", "ant_chain_sdk"):
            try:
                self._ant_chain_sdk = __import__(name)
                return True
            except Exception:
                continue
        self._ant_chain_sdk = None
        return False

    def _load_zhixin_sdk(self) -> bool:
        """尝试 import zhixin_sdk, 不可用返回 False.

        候选模块名: zhixin_sdk / zhixin / zx_chain_sdk.
        """
        if self._zhixin_tried:
            return self._zhixin_sdk is not None
        self._zhixin_tried = True
        for name in ("zhixin_sdk", "zhixin", "zx_chain_sdk", "tencent_zhixin"):
            try:
                self._zhixin_sdk = __import__(name)
                return True
            except Exception:
                continue
        self._zhixin_sdk = None
        return False

    # ====================================================================
    # R6.1 联盟链 VC 签发 (返回 tx_id 或 None)
    # ====================================================================

    async def _call_ant_chain_vc_issue(
        self, vc: W3cVerifiableCredential,
    ) -> str | None:
        """蚂蚁链 VC 存证, 返回 tx_id (SDK 不可用 / 调用失败返回 None)."""
        if not self._load_ant_chain_sdk():
            return None
        try:
            sdk = self._ant_chain_sdk
            # 不同 SDK API 不同, 用统一接口尝试
            payload = vc.model_dump(by_alias=True)
            if hasattr(sdk, "issue_vc"):
                result = sdk.issue_vc(payload)
            elif hasattr(sdk, "anchor"):
                result = sdk.anchor(payload)
            else:
                return None
            if isinstance(result, dict):
                tx_id = result.get("tx_id") or result.get("txId") or result.get("tx_hash")
                if tx_id:
                    return f"ant-tx-{tx_id}"
            elif isinstance(result, str):
                return f"ant-tx-{result}"
            return None
        except Exception as exc:
            logger.warning(f"蚂蚁链 VC 签发失败 ({exc}), 降级到至信/本地")
            return None

    async def _call_zhixin_vc_issue(
        self, vc: W3cVerifiableCredential,
    ) -> str | None:
        """至信链 VC 存证, 返回 tx_id (SDK 不可用 / 调用失败返回 None)."""
        if not self._load_zhixin_sdk():
            return None
        try:
            sdk = self._zhixin_sdk
            payload = vc.model_dump(by_alias=True)
            if hasattr(sdk, "issue_vc"):
                result = sdk.issue_vc(payload)
            elif hasattr(sdk, "anchor"):
                result = sdk.anchor(payload)
            else:
                return None
            if isinstance(result, dict):
                tx_id = result.get("tx_id") or result.get("txId") or result.get("tx_hash")
                if tx_id:
                    return f"zx-tx-{tx_id}"
            elif isinstance(result, str):
                return f"zx-tx-{result}"
            return None
        except Exception as exc:
            logger.warning(f"至信链 VC 签发失败 ({exc}), 降级到本地")
            return None

    def _anchor_chain(self, vc_id: str, preferred: ChainType) -> tuple[ChainType, str]:
        if preferred in (ChainType.ANT_CHAIN, ChainType.ZHIXIN_CHAIN):
            prefix = "ant" if preferred == ChainType.ANT_CHAIN else "zx"
            return preferred, f"{prefix}-tx-{uuid.uuid4().hex[:16]}"
        return ChainType.LOCAL, f"local-tx-{uuid.uuid4().hex[:12]}"

    async def issue(
        self, enterprise_id: str, ctype: CredentialType,
        claim: dict[str, Any], valid_days: int = 365,
    ) -> W3cVerifiableCredential:
        issuer_did, issuer_name, vm = _issuer_info()
        holder_did = _did("enterprise", enterprise_id)
        issuance = _now_iso()
        expiration = _days_later_iso(valid_days)
        proof_payload = {
            "issuerDid": issuer_did, "holderDid": holder_did,
            "type": ctype.value, "issuance": issuance,
        }
        sig = _sign_base64(proof_payload, vm)
        proof = W3cProof(
            type="EcdsaSecp256k1Signature2019",
            created_iso=issuance,
            verification_method=_did("key", vm),
            proof_value=sig,
        )
        vc_id = _vc_id()

        # R6.1: 三档升级链路 AntChain → ZhiXin → Local
        # 先构造一个临时 VC 对象, 传给 SDK 进行链上存证
        vc_pre = W3cVerifiableCredential(
            id=vc_id,
            issuer_did=issuer_did,
            issuer_name=issuer_name,
            holder_did=holder_did,
            issuance_date_iso=issuance,
            expiration_date_iso=expiration,
            credential_type=ctype,
            claim=dict(claim),
            proof=proof,
            revocation_status=RevocationStatus.ACTIVE,
            chain_tx_id=None,
        )

        chain_type = ChainType.LOCAL
        chain_tx = f"local-tx-{uuid.uuid4().hex[:12]}"

        # 1. 蚂蚁链
        ant_tx = await self._call_ant_chain_vc_issue(vc_pre)
        if ant_tx:
            chain_type = ChainType.ANT_CHAIN
            chain_tx = ant_tx
        else:
            # 2. 至信链
            zx_tx = await self._call_zhixin_vc_issue(vc_pre)
            if zx_tx:
                chain_type = ChainType.ZHIXIN_CHAIN
                chain_tx = zx_tx
            # 3. 否则保持 Local (上面默认值)

        vc = W3cVerifiableCredential(
            id=vc_id,
            issuer_did=issuer_did,
            issuer_name=issuer_name,
            holder_did=holder_did,
            issuance_date_iso=issuance,
            expiration_date_iso=expiration,
            credential_type=ctype,
            claim=dict(claim),
            proof=proof,
            revocation_status=RevocationStatus.ACTIVE,
            chain_tx_id=chain_tx,
        )
        # 注入 chain_type 元信息到 claim (供前端展示来源)
        vc.claim = {**vc.claim, "_chain_type": chain_type.value}
        await _vc_store.put_vc(vc.model_dump())
        return vc

    async def verify(self, vc_id: str) -> bool:
        raw = await _vc_store.get_vc(vc_id)
        if not raw:
            return False
        if raw.get("revocation_status") != RevocationStatus.ACTIVE.value:
            return False
        exp = raw.get("expiration_date_iso", "")
        try:
            exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            if exp_dt < datetime.now(UTC):
                return False
        except Exception:
            pass
        _issuer_did, _, vm = _issuer_info()
        proof_payload = {
            "issuerDid": raw.get("issuer_did"),
            "holderDid": raw.get("holder_did"),
            "type": raw.get("credential_type"),
            "issuance": raw.get("issuance_date_iso"),
        }
        expected = _sign_base64(proof_payload, vm)
        return raw.get("proof", {}).get("proof_value") == expected

    async def revoke(self, vc_id: str, reason: str) -> W3cVerifiableCredential:
        raw = await _vc_store.get_vc(vc_id)
        if not raw:
            raise ValueError(f"VC {vc_id} not found")
        raw["revocation_status"] = RevocationStatus.REVOKED.value
        raw["claim"] = dict(raw.get("claim", {}))
        raw["claim"]["revocation_reason"] = reason
        raw["claim"]["revoked_at"] = _now_iso()
        await _vc_store.put_vc(raw)
        return W3cVerifiableCredential.model_validate(raw)

    async def list_by_enterprise(self, enterprise_id: str) -> list[W3cVerifiableCredential]:
        raws = await _vc_store.list_by_enterprise(enterprise_id)
        return [W3cVerifiableCredential.model_validate(r) for r in raws]

    async def cross_chain_verify(self, req: CrossChainVerifyRequest) -> CrossChainVerifyResult:
        raw = await _vc_store.get_vc(req.vc_id)
        if not raw:
            return CrossChainVerifyResult(
                verified=False,
                mismatch_reason=f"VC {req.vc_id} not found",
            )
        source_proof = {
            "chain": req.source_chain.value,
            "txId": raw.get("chain_tx_id", f"source-tx-{uuid.uuid4().hex[:8]}"),
            "proofHash": hashlib.sha256((req.source_chain.value + req.vc_id).encode()).hexdigest(),
        }
        target_proof = {
            "chain": req.target_chain.value,
            "txId": f"target-tx-{uuid.uuid4().hex[:8]}",
            "proofHash": hashlib.sha256((req.target_chain.value + req.vc_id).encode()).hexdigest(),
        }
        match = source_proof["proofHash"][:16] == target_proof["proofHash"][:16] or req.source_chain == req.target_chain
        return CrossChainVerifyResult(
            verified=match,
            source_proof=source_proof,
            target_proof=target_proof,
            mismatch_reason=None if match else "跨链签名根哈希不一致",
        )


credential_service = CredentialService(db=None)
