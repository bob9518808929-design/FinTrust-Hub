"""INFRA-01b 外部 API 适配层 schemas (P1 R2.11).

15 个适配器 + 限流容错引擎 + 注册表.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AdapterId(StrEnum):
    A1_BANK_ICBC = "A1_BANK_ICBC"
    A2_BANK_CMB = "A2_BANK_CMB"
    A3_TAX_INVOICE = "A3_TAX_INVOICE"
    A4_GSXT = "A4_GSXT"
    A5_JUDICIARY = "A5_JUDICIARY"
    A6_ECDS = "A6_ECDS"
    A7_OCR_BAIDU = "A7_OCR_BAIDU"
    A8_OCR_ALI = "A8_OCR_ALI"
    A9_MQTT_EMQX = "A9_MQTT_EMQX"
    A10_ES = "A10_ES"
    A11_TEMPORAL = "A11_TEMPORAL"
    A12_HE_SEAL = "A12_HE_SEAL"
    A13_GOVERNMENT_PURGE = "A13_GOVERNMENT_PURGE"
    A14_ANT_CHAIN = "A14_ANT_CHAIN"
    A15_ZHIXIN_CHAIN = "A15_ZHIXIN_CHAIN"


class RuntimeStatus(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"
    FALLBACK_ONLY = "fallback_only"
    OFFLINE = "offline"


class AdapterRuntime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: AdapterId
    status: RuntimeStatus
    rate_limit_per_min: int = Field(alias="rateLimitPerMin")
    failure_count_5m: int = Field(alias="failureCount5m")
    latency_ms_avg: float = Field(alias="latencyMsAvg")
    last_ok_at: str = Field(alias="lastOkAt")
    fallback_enabled: bool = Field(alias="fallbackEnabled")


class InvokeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adapter_id: AdapterId = Field(alias="adapterId")
    operation: str
    params: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = Field(alias="timeoutMs", default=3000)
    retry_times: int = Field(alias="retryTimes", default=3)


class InvokeStatus(StrEnum):
    OK = "ok"
    FAILED = "failed"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    FALLBACK = "fallback"


class InvokeResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adapter_id: AdapterId = Field(alias="adapterId")
    operation: str
    status: InvokeStatus
    response: dict[str, Any] | None = None
    error_code: str | None = Field(alias="errorCode", default=None)
    errors_count_before_fallback: int = Field(alias="errorsCountBeforeFallback", default=0)
    trace_id: str = Field(alias="traceId")
