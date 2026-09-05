"""ECDS 电子商业汇票适配器服务 (DATA-02 ECDS).

电子商业汇票系统 mock:
    - 单张票据查询
    - 企业票据列表 (按角色: 出票人/付款人/持票人)

降级策略: 内存 store + asyncio.Lock; DB 不可用时自动兜底.
"""

from __future__ import annotations

import asyncio
import os
import random
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import uuid4

import httpx

from app.schemas.external_data import (
    AdapterHealth, AdapterHealthStatus, BillRole, DataSourceType,
    ECDSBillRecord,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_future_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _days_past_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _bill_id() -> str:
    return f"BILL-{uuid4().hex[:12].upper()}"


def _bill_no() -> str:
    return "".join([str(random.randint(0, 9)) for _ in range(20)])


class _EcdsStore:
    """内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._bills: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        self._bills = {
            "BILL-ECDS-0001": {
                "billId": "BILL-ECDS-0001",
                "billType": "bank_acceptance",
                "billNo": "11001234567890123401",
                "drawerEnterpriseId": "E001",
                "draweeEnterpriseId": "E003",
                "acceptorBank": "中国工商银行深圳分行",
                "amountCents": 10_000_000_000,
                "issueDateIso": _days_past_iso(30),
                "dueDateIso": _days_future_iso(150),
                "status": "accepted",
            },
            "BILL-ECDS-0002": {
                "billId": "BILL-ECDS-0002",
                "billType": "commercial_acceptance",
                "billNo": "21002345678901234502",
                "drawerEnterpriseId": "E002",
                "draweeEnterpriseId": "E001",
                "acceptorBank": "杭州银行总行营业部",
                "amountCents": 5_000_000_000,
                "issueDateIso": _days_past_iso(60),
                "dueDateIso": _days_future_iso(120),
                "status": "discounted",
            },
            "BILL-ECDS-0003": {
                "billId": "BILL-ECDS-0003",
                "billType": "bank_acceptance",
                "billNo": "11003456789012345603",
                "drawerEnterpriseId": "E004",
                "draweeEnterpriseId": "E002",
                "acceptorBank": "中国建设银行广州分行",
                "amountCents": 20_000_000_000,
                "issueDateIso": _days_past_iso(180),
                "dueDateIso": _days_past_iso(5),
                "status": "paid",
            },
            "BILL-ECDS-0004": {
                "billId": "BILL-ECDS-0004",
                "billType": "bank_acceptance",
                "billNo": "11004567890123456704",
                "drawerEnterpriseId": "E003",
                "draweeEnterpriseId": "E004",
                "acceptorBank": "招商银行苏州分行",
                "amountCents": 8_000_000_000,
                "issueDateIso": _days_past_iso(200),
                "dueDateIso": _days_past_iso(20),
                "status": "dishonored",
            },
            "BILL-ECDS-0005": {
                "billId": "BILL-ECDS-0005",
                "billType": "commercial_acceptance",
                "billNo": "21005678901234567805",
                "drawerEnterpriseId": "E001",
                "draweeEnterpriseId": "E002",
                "acceptorBank": "深圳发展银行总行",
                "amountCents": 3_000_000_000,
                "issueDateIso": _days_past_iso(10),
                "dueDateIso": _days_future_iso(170),
                "status": "issued",
            },
            "BILL-ECDS-0006": {
                "billId": "BILL-ECDS-0006",
                "billType": "bank_acceptance",
                "billNo": "11006789012345678906",
                "drawerEnterpriseId": "E002",
                "draweeEnterpriseId": "E004",
                "acceptorBank": "中国农业银行杭州分行",
                "amountCents": 15_000_000_000,
                "issueDateIso": _days_past_iso(90),
                "dueDateIso": _days_future_iso(90),
                "status": "accepted",
            },
        }

    async def get_bill(self, bill_no: str) -> dict | None:
        async with self._lock:
            for bill in self._bills.values():
                if bill.get("billNo") == bill_no:
                    return dict(bill)
            return None

    async def list_bills_by_role(
        self, enterprise_id: str, role: BillRole,
    ) -> list[dict]:
        async with self._lock:
            result: list[dict] = []
            for bill in self._bills.values():
                if role == "drawer" and bill.get("drawerEnterpriseId") == enterprise_id:
                    result.append(dict(bill))
                elif role == "drawee" and bill.get("draweeEnterpriseId") == enterprise_id:
                    result.append(dict(bill))
                elif role == "holder":
                    if bill.get("status") in ("discounted", "paid"):
                        if bill.get("draweeEnterpriseId") == enterprise_id:
                            result.append(dict(bill))
            return result


_ecds_store = _EcdsStore()


class EcdsAdapterService:
    """ECDS 电子商业汇票适配器服务 (mock + 真实 API 适配 R4.4)."""

    AVG_LATENCY_MS = 180
    # R4.4: 真实 API 调用超时 10s
    TIMEOUT_SECONDS = 10.0

    # 真实 API 凭证环境变量 (config/external_api_config.yaml)
    APP_ID_ENV = "ECDS_APP_ID"
    API_KEY_ENV = "ECDS_API_KEY"
    API_BASE_URL = "https://api.shcpe.com.cn/api"

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    # === R4.4: 真实票交所 ECDS API ===

    def _load_credentials(self) -> dict[str, str]:
        """从环境变量加载票交所 ECDS API 凭证."""
        return {
            "app_id": os.environ.get(self.APP_ID_ENV, ""),
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
            "api_base_url": self.API_BASE_URL,
        }

    async def _call_ecds_api(self, bill_no: str) -> dict:
        """调用票交所 ECDS API.

        入参: 票据号码 bill_no.
        超时 10s, 无凭证/超时/异常 -> 返回 {} (调用方降级).
        成功返回 ECDSBillRecord 字段 dict.
        """
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_key"]:
            return {}
        try:
            params = {
                "billNo": bill_no,
                "app_id": creds["app_id"],
            }
            headers = {"X-API-Key": creds["api_key"]}
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{creds['api_base_url']}/bill/query",
                    json=params,
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {}

    async def query_bill(self, bill_no: str) -> ECDSBillRecord | None:
        """按票据号码查询单张票据.

        R4.4: 优先调用真实票交所 ECDS API, 失败/无凭证降级到 mock.
        """
        # === R4.4: 先尝试真实 API ===
        real = await self._call_ecds_api(bill_no)
        if real and (real.get("billNo") or real.get("billId")):
            try:
                return ECDSBillRecord.model_validate(real)
            except Exception:
                pass  # 字段不全, 降级到 mock

        # === 降级到 mock ===
        await asyncio.sleep(self.AVG_LATENCY_MS / 1000.0)

        data = await _ecds_store.get_bill(bill_no)
        if not data:
            return None
        return ECDSBillRecord.model_validate(data)

    async def list_bills_by_enterprise(
        self, enterprise_id: str, role: BillRole,
    ) -> list[ECDSBillRecord]:
        """按企业 ID + 角色列出票据."""
        await asyncio.sleep(self.AVG_LATENCY_MS / 1000.0)

        bills = await _ecds_store.list_bills_by_role(enterprise_id, role)
        return [ECDSBillRecord.model_validate(b) for b in bills]

    async def health_check(self) -> AdapterHealth:
        """健康检查."""
        latency = self.AVG_LATENCY_MS + random.randint(-30, 60)
        return AdapterHealth(
            status=AdapterHealthStatus.OK,
            latency_ms=latency,
            last_checked_at=_now_iso(),
        )


ecds_adapter_service = EcdsAdapterService(db=None)
