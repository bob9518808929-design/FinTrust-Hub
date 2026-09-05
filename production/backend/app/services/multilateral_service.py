"""MOD-13 多方协作服务 (R5.8).

电子签章 + SLA 协作任务管理.

设计风格: 内存单例 + asyncio.Lock + _seed + db=None (参考 bank_service.py).

降级策略:
    - _call_esign_sdk: 调用 e签宝/法大大 SDK, 失败降级到 mock 签章
    - SDK 不可用 / 库缺失时, sign_document 仍返回 mock 签名结果
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.schemas.multilateral import (
    CollaborationTask,
    ElectronicSeal,
    SLAMetric,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "mlt") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ============================================================================
# 内存状态
# ============================================================================

class _MultilateralStore:
    """内存兜底: 4 电子签章 + 5 协作任务 (2 超期)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._seals: dict[str, dict] = {}
        self._tasks: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(UTC)
        # 4 个电子签章 (覆盖 4 类型)
        seal_specs = [
            ("E001", "enterprise", "张伟", "CERT-ES-0001"),
            ("E002", "legal_representative", "李娜", "CERT-LR-0002"),
            ("E003", "finance", "王芳", "CERT-FN-0003"),
            ("E004", "contract", "刘强", "CERT-CT-0004"),
        ]
        for idx, (eid, stype, name, cert_no) in enumerate(seal_specs):
            seal_id = f"SEAL-2026-{idx+1:04d}"
            self._seals[seal_id] = {
                "seal_id": seal_id,
                "enterprise_id": eid,
                "seal_type": stype,
                "signatory_name": name,
                "certificate_no": cert_no,
                "valid_from_iso": (now - timedelta(days=30)).isoformat(),
                "valid_to_iso": (now + timedelta(days=335)).isoformat(),
                "status": "active",
                "created_at_iso": (now - timedelta(days=30)).isoformat(),
            }

        # 5 个协作任务 (2 超期)
        # sla = now - X 天 表示已超期; sla = now + X 天 表示未到期
        task_specs = [
            ("E001", "供应链合同电子签署", ["finance", "legal_representative"],
             now + timedelta(days=2), "pending", None),
            ("E002", "联合授信协议签署", ["enterprise", "finance"],
             now - timedelta(days=3), "pending", None),  # 超期未完成
            ("E003", "担保合同电子签署", ["contract"],
             now - timedelta(days=1), "pending", None),  # 超期未完成
            ("E004", "应收账款转让协议", ["finance"],
             now + timedelta(days=5), "completed",
             (now - timedelta(hours=2)).isoformat()),
            ("E001", "年度授信框架协议", ["enterprise"],
             now + timedelta(days=10), "in_progress", None),
        ]
        for idx, (eid, title, roles, sla, status, completed) in enumerate(task_specs):
            task_id = f"TASK-2026-{idx+1:04d}"
            self._tasks[task_id] = {
                "task_id": task_id,
                "enterprise_id": eid,
                "title": title,
                "assignee_roles": list(roles),
                "sla_deadline_iso": sla.isoformat(),
                "status": status,
                "sign_progress": [],
                "created_at_iso": (now - timedelta(days=2)).isoformat(),
                "completed_at_iso": completed,
            }

    async def get_seal(self, seal_id: str) -> dict | None:
        async with self._lock:
            s = self._seals.get(seal_id)
            return dict(s) if s else None

    async def list_seals(
        self, enterprise_id: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            seals = list(self._seals.values())
            if enterprise_id:
                seals = [s for s in seals if s.get("enterprise_id") == enterprise_id]
            return [dict(s) for s in seals]

    async def put_seal(self, seal: dict) -> dict:
        async with self._lock:
            self._seals[seal["seal_id"]] = dict(seal)
            return dict(seal)

    async def get_task(self, task_id: str) -> dict | None:
        async with self._lock:
            t = self._tasks.get(task_id)
            return dict(t) if t else None

    async def list_tasks(
        self, enterprise_id: str | None = None, status: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            tasks = list(self._tasks.values())
            if enterprise_id:
                tasks = [t for t in tasks if t.get("enterprise_id") == enterprise_id]
            if status:
                tasks = [t for t in tasks if t.get("status") == status]
            return [dict(t) for t in tasks]

    async def put_task(self, task: dict) -> dict:
        async with self._lock:
            self._tasks[task["task_id"]] = dict(task)
            return dict(task)


_multilateral_store = _MultilateralStore()


# ============================================================================
# 多方协作服务
# ============================================================================

class MultilateralService:
    """多方协作服务 (MOD-13).

    电子签章: _call_esign_sdk / create_seal / sign_document
    协作任务: create_collaboration_task / complete_task / sla_check
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    # === e签宝 / 法大大 SDK 调用 ===

    async def _call_esign_sdk(
        self, document_hash: str, signatory_info: dict,
    ) -> dict | None:
        """调用 e签宝 / 法大大 SDK 进行真实电子签名.

        Returns:
            dict (签名结果) | None (SDK 不可用 / 调用失败, 触发 mock 降级).
        """
        # 候选 SDK 包名: esign / fadada / tsign
        candidates = ("esign_sdk", "fadada_sdk", "tsign_sdk")
        sdk = None
        for name in candidates:
            try:
                sdk = __import__(name)
                break
            except Exception:
                continue
        if sdk is None:
            return None
        try:
            # 不同 SDK API 不同, 用统一接口尝试
            if hasattr(sdk, "sign_document"):
                return sdk.sign_document(
                    document_hash=document_hash,
                    signatory_info=signatory_info,
                )
            if hasattr(sdk, "sign"):
                return sdk.sign(
                    document_hash=document_hash,
                    signatory=signatory_info,
                )
            return None
        except Exception as exc:
            logger.warning(f"e签 SDK 调用失败 ({exc}), 降级 mock 签章")
            return None

    # ====================================================================
    # V3 e签宝 / 法大量化签章接口 (MOD-13, Mock 降级)
    # ====================================================================

    async def _call_esign_sdk_v3(
        self, contract_id: str, signers: list[dict],
    ) -> dict:
        """e签宝量化签章接口 (V3, Mock 降级).

        Args:
            contract_id: 合同 ID.
            signers: 签署方列表 [{"signer_id": str, "signer_name": str,
                              "signer_type": "enterprise"|"legal_representative"|"finance",
                              "certificate_no": str}, ...].

        Returns:
            {
                "provider": "esign"|"mock",
                "contract_id": str,
                "sign_status": "signed"|"pending"|"failed",
                "sign_url": str (签署 URL, 用户在浏览器中完成签署),
                "valid_until_iso": str (签署链接有效期),
                "signers_count": int,
                "signed_count": int,
                "degraded": bool (是否降级 mock),
            }

        降级策略: SDK 不可用 / 库缺失时返回 mock 签章结果 (status=signed, sign_url 为 mock).
        """
        # 先尝试真实 SDK
        sdk_result = await self._call_esign_sdk(
            document_hash=contract_id,
            signatory_info={"contract_id": contract_id, "signers": signers},
        )
        if sdk_result is not None:
            # 真实 SDK 调用成功
            return {
                "provider": "esign",
                "contract_id": contract_id,
                "sign_status": sdk_result.get("status", "signed"),
                "sign_url": sdk_result.get("sign_url", ""),
                "valid_until_iso": sdk_result.get(
                    "valid_until_iso",
                    (datetime.now(UTC) + timedelta(days=7)).isoformat(),
                ),
                "signers_count": len(signers),
                "signed_count": len(signers),
                "degraded": False,
            }
        # 降级 mock: 返回模拟签署 URL (用户在浏览器中可访问的 mock 页面)
        now = datetime.now(UTC)
        valid_until = now + timedelta(days=7)
        # 生成 mock sign_url (基于 contract_id + signers hash)
        import hashlib
        url_hash = hashlib.sha256(
            f"{contract_id}:{signers}".encode(),
        ).hexdigest()[:16]
        return {
            "provider": "mock",
            "contract_id": contract_id,
            "sign_status": "signed",
            "sign_url": (
                f"https://mock-esign.fintrust.example.com/sign/{contract_id}/"
                f"{url_hash}"
            ),
            "valid_until_iso": valid_until.isoformat(),
            "signers_count": len(signers),
            "signed_count": len(signers),
            "degraded": True,
        }

    async def _call_fadada_sdk(
        self, contract_id: str, signers: list[dict],
    ) -> dict:
        """法大大量化签章接口 (V3, Mock 降级).

        Args:
            contract_id: 合同 ID.
            signers: 签署方列表 (同 _call_esign_sdk_v3).

        Returns:
            同 _call_esign_sdk_v3 (provider=fadada|mock).

        降级策略: SDK 不可用时返回 mock 签章结果.
        """
        # 尝试真实 fadada SDK (优先 fadada_sdk, 兼容 tsign_sdk)
        candidates = ("fadada_sdk", "fadada", "tsign_sdk")
        sdk = None
        for name in candidates:
            try:
                sdk = __import__(name)
                break
            except Exception:
                continue
        if sdk is not None:
            try:
                if hasattr(sdk, "sign_contract"):
                    result = sdk.sign_contract(
                        contract_id=contract_id, signers=signers,
                    )
                    if isinstance(result, dict):
                        return {
                            "provider": "fadada",
                            "contract_id": contract_id,
                            "sign_status": result.get("status", "signed"),
                            "sign_url": result.get("sign_url", ""),
                            "valid_until_iso": result.get(
                                "valid_until_iso",
                                (datetime.now(UTC)
                                 + timedelta(days=7)).isoformat(),
                            ),
                            "signers_count": len(signers),
                            "signed_count": len(signers),
                            "degraded": False,
                        }
                if hasattr(sdk, "sign"):
                    result = sdk.sign(
                        contract_id=contract_id, signers=signers,
                    )
                    if isinstance(result, dict):
                        return {
                            "provider": "fadada",
                            "contract_id": contract_id,
                            "sign_status": result.get("status", "signed"),
                            "sign_url": result.get("sign_url", ""),
                            "valid_until_iso": result.get(
                                "valid_until_iso",
                                (datetime.now(UTC)
                                 + timedelta(days=7)).isoformat(),
                            ),
                            "signers_count": len(signers),
                            "signed_count": len(signers),
                            "degraded": False,
                        }
            except Exception as exc:
                logger.warning(
                    f"法大大 SDK 调用失败 ({exc}), 降级 mock 签章",
                )
        # 降级 mock
        now = datetime.now(UTC)
        valid_until = now + timedelta(days=7)
        import hashlib
        url_hash = hashlib.sha256(
            f"fadada:{contract_id}:{signers}".encode(),
        ).hexdigest()[:16]
        return {
            "provider": "mock",
            "contract_id": contract_id,
            "sign_status": "signed",
            "sign_url": (
                f"https://mock-fadada.fintrust.example.com/sign/{contract_id}/"
                f"{url_hash}"
            ),
            "valid_until_iso": valid_until.isoformat(),
            "signers_count": len(signers),
            "signed_count": len(signers),
            "degraded": True,
        }

    # === 电子签章 ===

    async def create_seal(
        self, enterprise_id: str, signatory_name: str, certificate_no: str,
        seal_type: str = "enterprise",
    ) -> ElectronicSeal:
        """创建电子签章 (落地到内存 store)."""
        now = datetime.now(UTC)
        seal_id = _id("SEAL")
        seal = {
            "seal_id": seal_id,
            "enterprise_id": enterprise_id,
            "seal_type": seal_type,
            "signatory_name": signatory_name,
            "certificate_no": certificate_no,
            "valid_from_iso": now.isoformat(),
            "valid_to_iso": (now + timedelta(days=365)).isoformat(),
            "status": "active",
            "created_at_iso": now.isoformat(),
        }
        await _multilateral_store.put_seal(seal)
        return ElectronicSeal.model_validate(seal)

    async def sign_document(
        self, seal_id: str, document_hash: str,
    ) -> dict:
        """用签章对文档签名 (SDK 不可用降级 mock 签章).

        Returns:
            {
                "sign_id": str,
                "seal_id": str,
                "document_hash": str,
                "signature": str (mock 签名 base64),
                "signed_at_iso": str,
                "provider": "esign" | "fadada" | "mock",
                "status": "signed" | "failed",
            }
        """
        seal = await _multilateral_store.get_seal(seal_id)
        if not seal:
            return {
                "sign_id": _id("SIGN"),
                "seal_id": seal_id,
                "document_hash": document_hash,
                "signature": "",
                "signed_at_iso": _now_iso(),
                "provider": "mock",
                "status": "failed",
                "error": f"签章 {seal_id} 不存在",
            }
        signatory_info = {
            "enterprise_id": seal.get("enterprise_id", ""),
            "signatory_name": seal.get("signatory_name", ""),
            "certificate_no": seal.get("certificate_no", ""),
            "seal_type": seal.get("seal_type", "enterprise"),
        }
        # 先尝试真实 SDK
        sdk_result = await self._call_esign_sdk(document_hash, signatory_info)
        if sdk_result is not None:
            return {
                "sign_id": _id("SIGN"),
                "seal_id": seal_id,
                "document_hash": document_hash,
                "signature": sdk_result.get("signature", "")
                              or sdk_result.get("sign_value", ""),
                "signed_at_iso": _now_iso(),
                "provider": sdk_result.get("provider", "esign"),
                "status": "signed",
            }
        # 降级 mock 签章 (基于 seal_id + document_hash 的 SHA256)
        raw = f"{seal_id}:{document_hash}:{signatory_info}".encode()
        mock_sig = base64.b64encode(hashlib.sha256(raw).digest()).decode("ascii")
        return {
            "sign_id": _id("SIGN"),
            "seal_id": seal_id,
            "document_hash": document_hash,
            "signature": mock_sig,
            "signed_at_iso": _now_iso(),
            "provider": "mock",
            "status": "signed",
        }

    async def list_seals(
        self, enterprise_id: str | None = None,
    ) -> list[ElectronicSeal]:
        seals = await _multilateral_store.list_seals(enterprise_id)
        return [ElectronicSeal.model_validate(s) for s in seals]

    # === 协作任务 ===

    async def create_collaboration_task(
        self, enterprise_id: str, title: str,
        assignee_roles: list[str], sla_hours: int = 48,
    ) -> CollaborationTask:
        """创建协作任务 (SLA 截止 = now + sla_hours)."""
        now = datetime.now(UTC)
        task_id = _id("TASK")
        sla_deadline = now + timedelta(hours=sla_hours)
        task = {
            "task_id": task_id,
            "enterprise_id": enterprise_id,
            "title": title,
            "assignee_roles": list(assignee_roles),
            "sla_deadline_iso": sla_deadline.isoformat(),
            "status": "pending",
            "sign_progress": [],
            "created_at_iso": now.isoformat(),
            "completed_at_iso": None,
        }
        await _multilateral_store.put_task(task)
        return CollaborationTask.model_validate(task)

    async def complete_task(
        self, task_id: str, operator_role: str,
    ) -> CollaborationTask:
        """标记协作任务完成 (并附加操作员角色到 sign_progress)."""
        task = await _multilateral_store.get_task(task_id)
        if not task:
            raise ValueError(f"任务 {task_id} 不存在")
        now_iso = _now_iso()
        task["status"] = "completed"
        task["completed_at_iso"] = now_iso
        task.setdefault("sign_progress", []).append({
            "operator_role": operator_role,
            "completed_at_iso": now_iso,
        })
        await _multilateral_store.put_task(task)
        return CollaborationTask.model_validate(task)

    async def list_tasks(
        self, enterprise_id: str | None = None, status: str | None = None,
    ) -> list[CollaborationTask]:
        tasks = await _multilateral_store.list_tasks(enterprise_id, status)
        return [CollaborationTask.model_validate(t) for t in tasks]

    # === SLA 检查 ===

    async def sla_check(self) -> list[SLAMetric]:
        """扫描所有协作任务, 计算每条 SLA 指标.

        判定:
            - 已完成: is_breached = (completed_at > sla_deadline)
            - 未完成: is_breached = (now > sla_deadline)
            - breach_duration_hours = max(0, (actual - deadline) in hours)
        """
        now = datetime.now(UTC)
        tasks = await _multilateral_store.list_tasks()
        metrics: list[SLAMetric] = []
        for t in tasks:
            sla_iso = t.get("sla_deadline_iso", "")
            try:
                sla_dt = datetime.fromisoformat(sla_iso.replace("Z", "+00:00"))
            except Exception:
                continue
            completed_iso = t.get("completed_at_iso")
            if completed_iso:
                try:
                    actual = datetime.fromisoformat(completed_iso.replace("Z", "+00:00"))
                    is_breached = actual > sla_dt
                    if is_breached:
                        duration_h = (actual - sla_dt).total_seconds() / 3600.0
                    else:
                        duration_h = 0.0
                except Exception:
                    is_breached = False
                    duration_h = 0.0
            else:
                is_breached = now > sla_dt
                if is_breached:
                    duration_h = (now - sla_dt).total_seconds() / 3600.0
                else:
                    duration_h = 0.0
            metrics.append(SLAMetric(
                task_id=t["task_id"],
                sla_deadline_iso=sla_iso,
                actual_completion_iso=completed_iso,
                is_breached=is_breached,
                breach_duration_hours=round(max(0.0, duration_h), 2),
            ))
        return metrics


multilateral_service = MultilateralService(db=None)
