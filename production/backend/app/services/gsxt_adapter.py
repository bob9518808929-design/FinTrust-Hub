"""GSXT 工商信息适配器服务 (DATA-02 GSXT).

国家企业信用信息公示系统 mock:
    - 提供企业工商信息查询
    - 经营异常名录查询

降级策略: 内存 store + asyncio.Lock; DB 不可用时自动兜底.
"""

from __future__ import annotations

import asyncio
import os
import random
from datetime import datetime, timezone
from typing import Any

import httpx

from app.schemas.external_data import (
    AdapterHealth, AdapterHealthStatus, DataSourceType,
    GSXTEnterpriseInfo,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _GsxtStore:
    """内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._enterprises: dict[str, dict] = {}
        self._abnormal_records: dict[str, list[str]] = {}
        self._seed()

    def _seed(self) -> None:
        self._enterprises = {
            "E001": {
                "enterpriseId": "E001",
                "enterpriseName": "深圳科创电子有限公司",
                "uscc": "91440300MA5DABCD12",
                "registerStatus": "存续（在营、开业、在册）",
                "registerCapitalCents": 50_000_000_000,
                "legalRepresentative": "张三",
                "industryCode": "C3990",
                "foundedDateIso": "2018-03-15T00:00:00+00:00",
            },
            "E002": {
                "enterpriseId": "E002",
                "enterpriseName": "杭州智造机械股份有限公司",
                "uscc": "91330100MA2BCEFG34",
                "registerStatus": "存续（在营、开业、在册）",
                "registerCapitalCents": 200_000_000_000,
                "legalRepresentative": "李四",
                "industryCode": "C3499",
                "foundedDateIso": "2015-06-20T00:00:00+00:00",
            },
            "E003": {
                "enterpriseId": "E003",
                "enterpriseName": "苏州新材料科技有限公司",
                "uscc": "91320500MA1MGHIJ56",
                "registerStatus": "存续（在营、开业、在册）",
                "registerCapitalCents": 80_000_000_000,
                "legalRepresentative": "王五",
                "industryCode": "C2919",
                "foundedDateIso": "2019-11-08T00:00:00+00:00",
            },
            "E004": {
                "enterpriseId": "E004",
                "enterpriseName": "广州新能源汽车有限公司",
                "uscc": "91440100MA59KLMN78",
                "registerStatus": "存续（在营、开业、在册）",
                "registerCapitalCents": 1_000_000_000_000,
                "legalRepresentative": "赵六",
                "industryCode": "C3611",
                "foundedDateIso": "2017-02-28T00:00:00+00:00",
            },
        }
        self._abnormal_records = {
            "E001": [],
            "E002": [
                "2024-05-10 未按规定公示年报被列入经营异常名录",
                "2024-08-15 已补报年报并申请移出经营异常名录",
            ],
            "E003": [],
            "E004": [
                "2025-03-22 通过登记的住所无法联系被列入经营异常名录",
            ],
        }

    async def get_enterprise(self, enterprise_id: str) -> dict | None:
        async with self._lock:
            e = self._enterprises.get(enterprise_id)
            return dict(e) if e else None

    async def get_abnormal_records(self, enterprise_id: str) -> list[str]:
        async with self._lock:
            return list(self._abnormal_records.get(enterprise_id, []))


_gsxt_store = _GsxtStore()


class GsxtAdapterService:
    """GSXT 工商信息适配器服务 (mock + 真实 API 适配 R4.4)."""

    AVG_LATENCY_MS = 200
    # R4.4: 真实 API 调用超时 8s
    TIMEOUT_SECONDS = 8.0

    # 真实 API 凭证环境变量 (config/external_api_config.yaml)
    APP_ID_ENV = "GSXT_APP_ID"
    API_KEY_ENV = "GSXT_API_KEY"
    API_BASE_URL = "https://api.gsxt.gov.cn/api"

    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    # === R4.4: 真实工商信息系统 API ===

    def _load_credentials(self) -> dict[str, str]:
        """从环境变量加载 GSXT API 凭证."""
        return {
            "app_id": os.environ.get(self.APP_ID_ENV, ""),
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
            "api_base_url": self.API_BASE_URL,
        }

    async def _call_gsxt_api(self, enterprise_name_or_uscc: str) -> dict:
        """调用工商信息系统 API.

        入参: 企业名称 或 统一社会信用代码 (USCC).
        超时 8s, 无凭证/超时/异常 -> 返回 {} (调用方降级).
        成功返回企业工商信息 dict (字段对齐 GSXTEnterpriseInfo).
        """
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_key"]:
            return {}
        try:
            params = {
                "keyword": enterprise_name_or_uscc,
                "app_id": creds["app_id"],
            }
            headers = {"X-API-Key": creds["api_key"]}
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{creds['api_base_url']}/enterprise/query",
                    json=params,
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {}

    async def query_enterprise(
        self, enterprise_id: str, enterprise_name: str = "",
    ) -> GSXTEnterpriseInfo | None:
        """查询企业工商信息.

        R4.4: 优先调用真实工商信息系统 API, 失败/无凭证降级到 mock.
        """
        # === R4.4: 先尝试真实 API ===
        keyword = enterprise_name or enterprise_id
        real = await self._call_gsxt_api(keyword)
        if real and (real.get("enterpriseName") or real.get("uscc")):
            try:
                # 对齐 GSXTEnterpriseInfo 字段 (camelCase alias 已配置)
                real.setdefault("enterpriseId", enterprise_id)
                if "abnormalOperations" not in real:
                    real["abnormalOperations"] = []
                return GSXTEnterpriseInfo.model_validate(real)
            except Exception:
                pass  # 字段不全, 降级到 mock

        # === 降级到 mock ===
        await asyncio.sleep(self.AVG_LATENCY_MS / 1000.0)

        data = await _gsxt_store.get_enterprise(enterprise_id)
        if not data:
            return None

        abnormal = await _gsxt_store.get_abnormal_records(enterprise_id)
        data["abnormalOperations"] = list(abnormal)
        return GSXTEnterpriseInfo.model_validate(data)

    async def list_abnormal_records(self, enterprise_id: str) -> list[str]:
        """列出经营异常记录."""
        await asyncio.sleep(50 / 1000.0)
        return await _gsxt_store.get_abnormal_records(enterprise_id)

    async def health_check(self) -> AdapterHealth:
        """健康检查."""
        latency = self.AVG_LATENCY_MS + random.randint(-30, 80)
        if latency > 300:
            status = AdapterHealthStatus.DEGRADED
        else:
            status = AdapterHealthStatus.OK
        return AdapterHealth(
            status=status,
            latency_ms=latency,
            last_checked_at=_now_iso(),
        )


gsxt_adapter_service = GsxtAdapterService(db=None)
