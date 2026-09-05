"""DATA-04 IoT MQTT 网关 API (P1 R2.7).

prefix="/modules/iot", tags=["DATA-04 IoT"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.iot_gateway import (
    CommandRequest,
    CommandResult,
    Device,
    DeviceStatus,
    GatewayInfo,
    TelemetrySample,
)
from app.services.iot_gateway import iot_gateway_service

iot_router = APIRouter(prefix="/modules/iot", tags=["DATA-04 IoT"])


@iot_router.get("/gateways", response_model=ApiResult[list[GatewayInfo]], summary="列出网关")
async def list_gateways():
    items = await iot_gateway_service.list_gateways()
    return make_ok(items)


@iot_router.get("/devices", response_model=ApiResult[list[Device]], summary="列出设备")
async def list_devices(
    enterprise_id: str | None = Query(default=None, alias="enterpriseId"),
    status: DeviceStatus | None = Query(default=None),
):
    items = await iot_gateway_service.list_devices(enterprise_id, status)
    return make_ok(items)


@iot_router.get("/devices/{id}", response_model=ApiResult[Device], summary="获取设备详情")
async def get_device(id: str):
    d = await iot_gateway_service.get_device(id)
    if not d:
        return make_ok(None, code=404, message=f"设备 {id} 不存在")
    return make_ok(d)


@iot_router.get(
    "/devices/{id}/telemetry",
    response_model=ApiResult[list[TelemetrySample]],
    summary="获取设备遥测数据",
)
async def get_telemetry(
    id: str,
    metric_name: str | None = Query(default=None, alias="metricName"),
    hours: int = Query(default=24, ge=1, le=24 * 30),
):
    items = await iot_gateway_service.get_telemetry(id, metric_name, hours)
    return make_ok(items)


@iot_router.post(
    "/devices/{id}/simulate",
    response_model=ApiResult[list[TelemetrySample]],
    summary="批量生成模拟遥测 (GPS/温湿度/能耗)",
)
async def simulate_telemetry(
    id: str,
    count: int = Query(default=50, ge=1, le=500),
):
    d = await iot_gateway_service.get_device(id)
    if not d:
        return make_ok(None, code=404, message=f"设备 {id} 不存在")
    samples = await iot_gateway_service.simulate_telemetry_burst(d.enterprise_id, count)
    return make_ok(samples)


@iot_router.post(
    "/devices/command",
    response_model=ApiResult[CommandResult],
    summary="下发设备命令 (REBOOT / SET_INTERVAL / REPORT_NOW)",
)
async def send_command(req: CommandRequest = Body(...)):
    result = await iot_gateway_service.send_command(req)
    return make_ok(result)


@iot_router.get(
    "/mqtt/log",
    summary="列出 MQTT 发布日志 (含降级 HTTP 长轮询记录)",
)
async def list_mqtt_log(limit: int = Query(default=100, ge=1, le=500)):
    items = await iot_gateway_service.list_mqtt_publish_log(limit=limit)
    return make_ok(items)
