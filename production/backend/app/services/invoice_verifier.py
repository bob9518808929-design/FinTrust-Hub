"""发票查验适配器服务 (DATA-02 INVOICE_VERIFIER).

国税总局发票查验系统 mock:
    - 98% 成功率
    - 发票号以 "VOID" 结尾返回作废 (voided)
    - 发票号以 "REUSE" 结尾返回重复使用 (reused)
    - 其他返回有效 (valid)

降级策略: 内存 store + asyncio.Lock; DB 不可用时自动兜底.
"""

from __future__ import annotations

import asyncio
import os
import random
from datetime import UTC, datetime
from typing import Any

import httpx

from app.schemas.external_data import (
    AdapterHealth,
    AdapterHealthStatus,
    DataSourceType,
    InvoiceVerifyRequest,
    InvoiceVerifyResult,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class _InvoiceStore:
    """内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._verify_logs: list[dict] = []
        self._seed()

    def _seed(self) -> None:
        now = _now_iso()
        seed_logs = [
            {
                "invoiceCode": "011002300111",
                "invoiceNo": "26089001",
                "invoiceDateIso": "2026-07-15T00:00:00+00:00",
                "taxAmountCents": 130_000,
                "enterpriseId": "E001",
                "verified": True,
                "invoiceStatus": "valid",
                "verifyTimeIso": now,
            },
            {
                "invoiceCode": "011002300112",
                "invoiceNo": "26089002VOID",
                "invoiceDateIso": "2026-07-16T00:00:00+00:00",
                "taxAmountCents": 260_000,
                "enterpriseId": "E002",
                "verified": False,
                "invoiceStatus": "voided",
                "verifyTimeIso": now,
            },
        ]
        self._verify_logs.extend(seed_logs)

    async def add_log(self, log: dict) -> None:
        async with self._lock:
            self._verify_logs.append(dict(log))


_invoice_store = _InvoiceStore()


class InvoiceVerifierService:
    """发票查验服务 (国税总局 mock + 真实 API 适配 R4.4)."""

    SUCCESS_RATE = 0.98
    AVG_LATENCY_MS = 120
    # R4.4: 真实 API 调用超时 8s
    TIMEOUT_SECONDS = 8.0

    # 真实 API 凭证环境变量 (config/external_api_config.yaml)
    APP_ID_ENV = "TAX_APP_ID"
    API_KEY_ENV = "TAX_API_KEY"
    API_BASE_URL = "https://inv-veri.chinatax.gov.cn/api"

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    # === R4.4: 真实国家税务总局发票查验 API ===

    def _load_credentials(self) -> dict[str, str]:
        """从环境变量加载国税总局 API 凭证."""
        return {
            "app_id": os.environ.get(self.APP_ID_ENV, ""),
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
            "api_base_url": self.API_BASE_URL,
        }

    async def _call_tax_api(
        self,
        invoice_code: str,
        invoice_no: str,
        invoice_date: str,
        amount: int,
    ) -> dict:
        """调用国家税务总局发票查验 API.

        超时 8s, 无凭证/超时/异常 -> 返回 {} (调用方降级到 mock).
        成功返回 {"invoiceStatus": "valid"|"voided"|"reused", "verified": bool, ...}.
        """
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_key"]:
            return {}
        try:
            params = {
                "fpdm": invoice_code,        # 发票代码
                "fphm": invoice_no,           # 发票号码
                "kprq": invoice_date,         # 开票日期
                "kjje": str(amount),          # 开票金额 (分)
                "app_id": creds["app_id"],
            }
            headers = {"X-API-Key": creds["api_key"]}
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{creds['api_base_url']}/invoice/verify",
                    json=params,
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {}

    async def verify(self, request: InvoiceVerifyRequest) -> InvoiceVerifyResult:
        """查验发票.

        R4.4: 优先调用真实国家税务总局 API, 失败/无凭证降级到 mock.

        Mock 规则:
            - 发票号以 VOID 结尾 → voided
            - 发票号以 REUSE 结尾 → reused
            - 其他: 98% 概率 valid, 2% 概率 reused
        """
        now = _now_iso()

        # === R4.4: 先尝试真实 API ===
        real = await self._call_tax_api(
            request.invoice_code,
            request.invoice_no,
            request.invoice_date_iso,
            request.tax_amount_cents,
        )
        if real and real.get("invoiceStatus"):
            invoice_status = str(real["invoiceStatus"])
            if invoice_status not in ("valid", "voided", "reused"):
                invoice_status = "valid"
            verified = bool(real.get("verified", invoice_status == "valid"))
            result = InvoiceVerifyResult(
                verified=verified,
                invoice_status=invoice_status,  # type: ignore[arg-type]
                verify_time_iso=now,
                source=DataSourceType.INVOICE_VERIFIER,
            )
            await _invoice_store.add_log({
                "invoiceCode": request.invoice_code,
                "invoiceNo": request.invoice_no,
                "invoiceDateIso": request.invoice_date_iso,
                "taxAmountCents": request.tax_amount_cents,
                "enterpriseId": request.enterprise_id,
                "verified": verified,
                "invoiceStatus": invoice_status,
                "verifyTimeIso": now,
                "source": "real_api",
            })
            return result

        # === 降级到 mock ===
        await asyncio.sleep(self.AVG_LATENCY_MS / 1000.0)

        invoice_no = request.invoice_no
        if invoice_no.endswith("VOID"):
            verified = False
            invoice_status = "voided"
        elif invoice_no.endswith("REUSE"):
            verified = False
            invoice_status = "reused"
        else:
            if random.random() < self.SUCCESS_RATE:
                verified = True
                invoice_status = "valid"
            else:
                verified = False
                invoice_status = "reused"

        result = InvoiceVerifyResult(
            verified=verified,
            invoice_status=invoice_status,
            verify_time_iso=now,
            source=DataSourceType.INVOICE_VERIFIER,
        )

        await _invoice_store.add_log({
            "invoiceCode": request.invoice_code,
            "invoiceNo": request.invoice_no,
            "invoiceDateIso": request.invoice_date_iso,
            "taxAmountCents": request.tax_amount_cents,
            "enterpriseId": request.enterprise_id,
            "verified": verified,
            "invoiceStatus": invoice_status,
            "verifyTimeIso": now,
        })

        return result

    async def health_check(self) -> AdapterHealth:
        """健康检查 (国税总局 mock, 正常返回 ok)."""
        return AdapterHealth(
            status=AdapterHealthStatus.OK,
            latency_ms=self.AVG_LATENCY_MS + random.randint(-20, 40),
            last_checked_at=_now_iso(),
        )


invoice_verifier_service = InvoiceVerifierService(db=None)
