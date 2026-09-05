"""DATA-04 IoT MQTT 网关 schemas (P1 R2.7).

字段命名: snake_case + alias_generator 自动转换 camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DeviceStatus(str, Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    ALARM = "ALARM"
    SLEEP = "SLEEP"


class GatewayProtocol(str, Enum):
    MQTT5 = "MQTT5"
    HTTP_LONGPOLL = "HTTP_LONGPOLL"


class GatewayStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"


class TelemetrySample(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    time_iso: str = Field(alias="timeIso")
    metric_name: str = Field(alias="metricName")
    value_numeric: float | None = Field(alias="valueNumeric", default=None)
    value_text: str | None = Field(alias="valueText", default=None)
    unit: str
    geo_lat: float | None = Field(alias="geoLat", default=None)
    geo_lon: float | None = Field(alias="geoLon", default=None)


class Device(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    model: str
    enterprise_id: str = Field(alias="enterpriseId")
    gateway_id: str = Field(alias="gatewayId")
    status: DeviceStatus
    last_seen_iso: str = Field(alias="lastSeenIso")
    metrics: dict[str, Any] = Field(default_factory=dict)
    telemetry: list[TelemetrySample] = Field(default_factory=list)


class GatewayInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    protocol: GatewayProtocol
    status: GatewayStatus
    connected_devices_count: int = Field(alias="connectedDevicesCount")


class CommandRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    device_id: str = Field(alias="deviceId")
    command: str
    payload: dict[str, Any] = Field(default_factory=dict)


class CommandStatus(str, Enum):
    SENT = "sent"
    ACKED = "acked"
    NACK = "nack"
    FAILED = "failed"


class CommandResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    command_id: str = Field(alias="commandId")
    status: CommandStatus
    executed_at: str | None = Field(alias="executedAt", default=None)
