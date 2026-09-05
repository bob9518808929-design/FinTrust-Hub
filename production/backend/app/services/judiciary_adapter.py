"""司法信息适配器服务 (DATA-02 JUDICIARY).

中国裁判文书网 / 执行信息公开网 mock:
    - 企业涉诉案件查询
    - 近 12 个月未结案件诉讼风险判定

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
    AdapterHealth, AdapterHealthStatus, DataSourceType,
    JudiciaryCaseRecord,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_ago_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _case_id() -> str:
    return f"CASE-{uuid4().hex[:12].upper()}"


class _JudiciaryStore:
    """内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cases: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        self._cases = {
            _case_id(): {
                "caseId": "CASE-JUD-0001",
                "enterpriseId": "E002",
                "caseType": "civil",
                "court": "杭州市西湖区人民法院",
                "caseStatus": "审理中",
                "filingDateIso": _days_ago_iso(60),
                "amountCents": 5_000_000_000,
                "summary": "买卖合同纠纷，原告起诉被告支付货款 500 万元及违约金",
            },
            _case_id(): {
                "caseId": "CASE-JUD-0002",
                "enterpriseId": "E002",
                "caseType": "civil",
                "court": "杭州市中级人民法院",
                "caseStatus": "已结案",
                "filingDateIso": _days_ago_iso(400),
                "amountCents": 2_000_000_000,
                "summary": "承揽合同纠纷，二审维持原判，被告已履行付款义务",
            },
            _case_id(): {
                "caseId": "CASE-JUD-0003",
                "enterpriseId": "E004",
                "caseType": "administrative",
                "court": "广州知识产权法院",
                "caseStatus": "审理中",
                "filingDateIso": _days_ago_iso(30),
                "amountCents": 0,
                "summary": "商标侵权行政处罚纠纷，企业不服市监局处罚提起行政诉讼",
            },
            _case_id(): {
                "caseId": "CASE-JUD-0004",
                "enterpriseId": "E001",
                "caseType": "civil",
                "court": "深圳市南山区人民法院",
                "caseStatus": "已结案",
                "filingDateIso": _days_ago_iso(500),
                "amountCents": 800_000_000,
                "summary": "房屋租赁合同纠纷，双方和解撤诉",
            },
            _case_id(): {
                "caseId": "CASE-JUD-0005",
                "enterpriseId": "E003",
                "caseType": "civil",
                "court": "苏州市工业园区人民法院",
                "caseStatus": "执行中",
                "filingDateIso": _days_ago_iso(200),
                "amountCents": 3_500_000_000,
                "summary": "金融借款合同纠纷，判决生效后进入执行程序",
            },
        }

    async def list_cases(
        self, enterprise_id: str, status: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            cases = [
                dict(c) for c in self._cases.values()
                if c.get("enterpriseId") == enterprise_id
            ]
            if status:
                cases = [c for c in cases if status in c.get("caseStatus", "")]
            return cases


_judiciary_store = _JudiciaryStore()


class JudiciaryAdapterService:
    """司法信息适配器服务 (mock + 真实 API 适配 R4.4)."""

    AVG_LATENCY_MS = 350
    # R4.4: 真实 API 调用超时 10s
    TIMEOUT_SECONDS = 10.0

    # 真实 API 凭证环境变量 (config/external_api_config.yaml)
    APP_ID_ENV = "COURT_APP_ID"
    API_KEY_ENV = "COURT_API_KEY"
    API_BASE_URL = "https://wenshu.court.gov.cn/api"

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    # === R4.4: 真实中国裁判文书网 API ===

    def _load_credentials(self) -> dict[str, str]:
        """从环境变量加载司法信息 API 凭证."""
        return {
            "app_id": os.environ.get(self.APP_ID_ENV, ""),
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
            "api_base_url": self.API_BASE_URL,
        }

    async def _call_court_api(self, enterprise_id: str) -> dict:
        """调用中国裁判文书网 API.

        入参: 企业 ID (后端映射为当事人名称/统一信用代码查询).
        超时 10s, 无凭证/超时/异常 -> 返回 {} (调用方降级).
        成功返回 {"cases": [JudiciaryCaseRecord dict, ...]}.
        """
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_key"]:
            return {}
        try:
            params = {
                "enterpriseId": enterprise_id,
                "app_id": creds["app_id"],
            }
            headers = {"X-API-Key": creds["api_key"]}
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{creds['api_base_url']}/cases/query",
                    json=params,
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {}

    async def query_cases(
        self, enterprise_id: str, status: str | None = None,
    ) -> list[JudiciaryCaseRecord]:
        """查询企业涉诉案件 (可选按状态筛选).

        R4.4: 优先调用真实中国裁判文书网 API, 失败/无凭证降级到 mock.
        """
        # === R4.4: 先尝试真实 API ===
        real = await self._call_court_api(enterprise_id)
        real_cases = real.get("cases") if real else None
        if real_cases:
            try:
                records = [JudiciaryCaseRecord.model_validate(c) for c in real_cases]
                if status:
                    records = [c for c in records if status in c.case_status]
                if records:
                    return records
            except Exception:
                pass  # 字段不全, 降级到 mock

        # === 降级到 mock ===
        await asyncio.sleep(self.AVG_LATENCY_MS / 1000.0)

        cases = await _judiciary_store.list_cases(enterprise_id, status)
        return [JudiciaryCaseRecord.model_validate(c) for c in cases]

    async def has_litigation_risk(self, enterprise_id: str) -> bool:
        """近 12 个月有未结案件返回 True.

        未结案件定义: caseStatus 包含 "审理中" 或 "执行中".
        近 12 个月: filingDateIso 在 365 天内.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=365)

        cases = await self.query_cases(enterprise_id)
        for case in cases:
            status_open = (
                "审理中" in case.case_status
                or "执行中" in case.case_status
            )
            try:
                filing_dt = datetime.fromisoformat(case.filing_date_iso.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue
            if status_open and filing_dt >= cutoff:
                return True
        return False

    async def health_check(self) -> AdapterHealth:
        """健康检查."""
        latency = self.AVG_LATENCY_MS + random.randint(-50, 150)
        if latency > 500:
            status = AdapterHealthStatus.DEGRADED
        else:
            status = AdapterHealthStatus.OK
        return AdapterHealth(
            status=status,
            latency_ms=latency,
            last_checked_at=_now_iso(),
        )


judiciary_adapter_service = JudiciaryAdapterService(db=None)
