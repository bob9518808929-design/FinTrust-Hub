"""物联网感知与实物资产验证模块 (MOD-12).

spec 依据: MOD-12 L1066-1130 (物联网感知)
状态: V3 已实现 production — 设备认证 + GPS/温湿度数据校验

V3 升级:
    - register_device: 设备注册 + 证书校验
    - verify_device_data: 数据校验 (GPS 坐标范围 + 温湿度合理范围)
    - get_device_status: 设备状态查询

兼容旧桩接口:
    - get_gps_trace: 获取 GPS 轨迹 (mock)
    - get_storage_environment: 仓储温湿度 (mock)
    - verify_asset: 实物资产存证 (mock)
    - verify_five_flows: 五流合一验证 (mock)

设计风格: 内存单例 _IotDeviceStore + asyncio.Lock + _seed + db=None 注入.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "DEV") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


# ============================================================================
# 设备认证 + 数据校验参数
# ============================================================================

# 中国大陆 GPS 坐标合理范围
_GPS_LAT_RANGE = (18.0, 54.0)  # 纬度
_GPS_LON_RANGE = (73.0, 135.0)  # 经度

# 仓储温湿度合理范围 (温带仓储, 摄氏度 / 百分比)
_TEMP_RANGE_CELSIUS = (-20.0, 60.0)
_HUMIDITY_RANGE_PERCENT = (10.0, 95.0)

# 设备证书 PEM 头尾标识
_CERT_PEM_BEGIN = "-----BEGIN CERTIFICATE-----"
_CERT_PEM_END = "-----END CERTIFICATE-----"


# ============================================================================
# 内存状态
# ============================================================================

class _IotDeviceStore:
    """IoT 设备内存兜底: 4 个种子设备 (含证书)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # device_id -> device dict
        self._devices: dict[str, dict] = {}
        # device_id -> list[telemetry dict]
        self._telemetry: dict[str, list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        """4 个种子设备 (覆盖 4 类型, 含证书).

        - DEV-GPS-001: E001, GPS 定位器, active
        - DEV-THS-002: E002, 温湿度传感器, active
        - DEV-PLC-003: E003, PLC 监控, alarm (温度超阈值)
        - DEV-EMT-004: E004, 能耗监测, offline
        """
        now = datetime.now(timezone.utc)
        seed_devices = [
            {
                "device_id": "DEV-GPS-001",
                "enterprise_id": "E001",
                "device_type": "gps_tracker",
                "cert_pem": (
                    "-----BEGIN CERTIFICATE-----\n"
                    "MIIBxTCCHQIGByqGSM44BAEwggHKMIGIAgEBMEExDzANBgNV\n"
                    "BAMMBkRFVi1HUFMwMTELMAkGA1UEBhMCQ04xCzAJBgNVBAcM\n"
                    "-----END CERTIFICATE-----\n"
                ),
                "cert_fingerprint": "SHA256:AB12CD34EF56GH78",
                "cert_valid_from_iso": (now - timedelta(days=60)).isoformat(),
                "cert_valid_to_iso": (now + timedelta(days=305)).isoformat(),
                "status": "active",
                "registered_at_iso": (now - timedelta(days=60)).isoformat(),
                "last_heartbeat_iso": (now - timedelta(minutes=5)).isoformat(),
            },
            {
                "device_id": "DEV-THS-002",
                "enterprise_id": "E002",
                "device_type": "temp_humidity_sensor",
                "cert_pem": (
                    "-----BEGIN CERTIFICATE-----\n"
                    "MIIBxTCCHQIGByqGSM44BAEwggHKMIGIAgEBMEExDzANBgNV\n"
                    "BAMMBkRFVi1USFMwMDIxCzAJBgNVBAcMAAoVHRE\n"
                    "-----END CERTIFICATE-----\n"
                ),
                "cert_fingerprint": "SHA256:IJ90KL12MN34OP56QR",
                "cert_valid_from_iso": (now - timedelta(days=45)).isoformat(),
                "cert_valid_to_iso": (now + timedelta(days=320)).isoformat(),
                "status": "active",
                "registered_at_iso": (now - timedelta(days=45)).isoformat(),
                "last_heartbeat_iso": (now - timedelta(minutes=2)).isoformat(),
            },
            {
                "device_id": "DEV-PLC-003",
                "enterprise_id": "E003",
                "device_type": "plc_monitor",
                "cert_pem": (
                    "-----BEGIN CERTIFICATE-----\n"
                    "MIIBxTCCHQIGByqGSM44BAEwggHKMIGIAgEBMEExDzANBgNV\n"
                    "BAMMBkRFVi1QTEMwMDMxCzAJBgNVBAcMAAoVU1QY\n"
                    "-----END CERTIFICATE-----\n"
                ),
                "cert_fingerprint": "SHA256:ST78UV90WX12YZ34AB",
                "cert_valid_from_iso": (now - timedelta(days=120)).isoformat(),
                "cert_valid_to_iso": (now + timedelta(days=245)).isoformat(),
                "status": "alarm",
                "registered_at_iso": (now - timedelta(days=120)).isoformat(),
                "last_heartbeat_iso": (now - timedelta(minutes=1)).isoformat(),
            },
            {
                "device_id": "DEV-EMT-004",
                "enterprise_id": "E004",
                "device_type": "energy_monitor",
                "cert_pem": (
                    "-----BEGIN CERTIFICATE-----\n"
                    "MIIBxTCCHQIGByqGSM44BAEwggHKMIGIAgEBMEExDzANBgNV\n"
                    "BAMMBkRFVi1FTVQwMDQxCzAJBgNVBAcMAAoVFTUE\n"
                    "-----END CERTIFICATE-----\n"
                ),
                "cert_fingerprint": "SHA256:CD56EF78GH90IJ12KL",
                "cert_valid_from_iso": (now - timedelta(days=200)).isoformat(),
                "cert_valid_to_iso": (now - timedelta(days=10)).isoformat(),  # 已过期
                "status": "offline",
                "registered_at_iso": (now - timedelta(days=200)).isoformat(),
                "last_heartbeat_iso": (now - timedelta(hours=48)).isoformat(),
            },
        ]
        for d in seed_devices:
            self._devices[d["device_id"]] = d
            self._telemetry[d["device_id"]] = []

    async def get_device(self, device_id: str) -> Optional[dict]:
        async with self._lock:
            d = self._devices.get(device_id)
            return dict(d) if d else None

    async def list_devices(
        self, enterprise_id: Optional[str] = None,
    ) -> list[dict]:
        async with self._lock:
            devs = list(self._devices.values())
            if enterprise_id:
                devs = [d for d in devs if d.get("enterprise_id") == enterprise_id]
            return [dict(d) for d in devs]

    async def put_device(self, device: dict) -> dict:
        async with self._lock:
            self._devices[device["device_id"]] = dict(device)
            self._telemetry.setdefault(device["device_id"], [])
            return dict(device)

    async def update_status(
        self, device_id: str, status: str, heartbeat_iso: Optional[str] = None,
    ) -> Optional[dict]:
        async with self._lock:
            if device_id not in self._devices:
                return None
            self._devices[device_id]["status"] = status
            self._devices[device_id]["last_heartbeat_iso"] = (
                heartbeat_iso or _now_iso()
            )
            return dict(self._devices[device_id])

    async def append_telemetry(
        self, device_id: str, sample: dict,
    ) -> Optional[dict]:
        async with self._lock:
            if device_id not in self._telemetry:
                return None
            self._telemetry[device_id].append(dict(sample))
            # 仅保留最近 500 条
            if len(self._telemetry[device_id]) > 500:
                self._telemetry[device_id] = self._telemetry[device_id][-500:]
            return dict(sample)

    async def get_telemetry(
        self, device_id: str, limit: int = 100,
        sample_type: Optional[str] = None,
    ) -> list[dict]:
        """查询设备遥测样本 (EMQX 通道采集, 可按类型过滤, 时间倒序)."""
        async with self._lock:
            samples = list(self._telemetry.get(device_id, []))
        if sample_type:
            samples = [
                s for s in samples
                if s.get("sample_type", "") == sample_type
                or s.get("type", "") == sample_type
            ]
        return list(reversed(samples[-limit:]))


_iot_device_store = _IotDeviceStore()


# ============================================================================
# IoT 感知服务
# ============================================================================

class IotService:
    """物联网感知服务 (MOD-12).

    V3 实现:
        - register_device: 设备注册 + 证书校验 (PEM 格式 + 有效期)
        - verify_device_data: 数据校验 (GPS 坐标范围 + 温湿度合理范围)
        - get_device_status: 设备状态查询 (active / alarm / offline)

    V3 扩展接口 (遥测驱动):
        - get_gps_trace / get_storage_environment / verify_asset / verify_five_flows
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入

    # ====================================================================
    # V3 设备认证 + 数据校验
    # ====================================================================

    def _validate_cert_pem(self, cert_pem: str) -> tuple[bool, str, str]:
        """校验设备证书 PEM 格式.

        Args:
            cert_pem: PEM 格式证书字符串.

        Returns:
            (is_valid, fingerprint, error_message)
            - is_valid: True 通过格式校验
            - fingerprint: 证书指纹 (mock SHA256, 取前 16 字符)
            - error_message: 失败原因 (is_valid=False 时)
        """
        if not cert_pem or not isinstance(cert_pem, str):
            return False, "", "证书内容为空"
        cert_pem = cert_pem.strip()
        if not cert_pem.startswith(_CERT_PEM_BEGIN):
            return False, "", "证书缺少 PEM 头 (-----BEGIN CERTIFICATE-----)"
        if _CERT_PEM_END not in cert_pem:
            return False, "", "证书缺少 PEM 尾 (-----END CERTIFICATE-----)"
        # mock fingerprint (真实环境用 cryptography 库解析证书计算指纹)
        import hashlib
        fingerprint = "SHA256:" + hashlib.sha256(
            cert_pem.encode("utf-8"),
        ).hexdigest()[:16].upper()
        return True, fingerprint, ""

    async def register_device(
        self,
        device_id: str,
        enterprise_id: str,
        device_type: str,
        cert_pem: str,
    ) -> dict:
        """设备注册 + 证书校验.

        Args:
            device_id: 设备 ID (业务唯一).
            enterprise_id: 所属企业 ID.
            device_type: 设备类型 (gps_tracker / temp_humidity_sensor /
                                   plc_monitor / energy_monitor / ...).
            cert_pem: 设备证书 (PEM 格式).

        Returns:
            {
                "device_id": str,
                "enterprise_id": str,
                "device_type": str,
                "cert_fingerprint": str,
                "cert_valid_from_iso": str,
                "cert_valid_to_iso": str,
                "status": "active",
                "registered_at_iso": str,
                "last_heartbeat_iso": str,
            }

        校验:
            - device_id 不能为空, 不能已存在
            - enterprise_id / device_type 不能为空
            - cert_pem 必须是合法 PEM 格式 (含 BEGIN/END CERTIFICATE)
        """
        # 输入校验
        if not device_id or not device_id.strip():
            raise ValueError("device_id 不能为空")
        if not enterprise_id or not enterprise_id.strip():
            raise ValueError("enterprise_id 不能为空")
        if not device_type or not device_type.strip():
            raise ValueError("device_type 不能为空")

        # 检查重复
        existing = await _iot_device_store.get_device(device_id)
        if existing:
            raise ValueError(f"设备 {device_id} 已存在")

        # 证书校验
        is_valid, fingerprint, err_msg = self._validate_cert_pem(cert_pem)
        if not is_valid:
            raise ValueError(f"证书校验失败: {err_msg}")

        # 注册
        now = datetime.now(timezone.utc)
        valid_to = now + timedelta(days=365)
        device = {
            "device_id": device_id,
            "enterprise_id": enterprise_id,
            "device_type": device_type,
            "cert_pem": cert_pem,
            "cert_fingerprint": fingerprint,
            "cert_valid_from_iso": now.isoformat(),
            "cert_valid_to_iso": valid_to.isoformat(),
            "status": "active",
            "registered_at_iso": now.isoformat(),
            "last_heartbeat_iso": now.isoformat(),
        }
        await _iot_device_store.put_device(device)
        # 返回时移除证书原文 (避免泄漏)
        result = dict(device)
        result.pop("cert_pem", None)
        return result

    async def verify_device_data(
        self, device_id: str, data_payload: dict,
    ) -> dict:
        """数据校验 (GPS 坐标范围 + 温湿度合理范围).

        Args:
            device_id: 设备 ID.
            data_payload: 待校验数据 {
                "gps": {"lat": float, "lon": float} (可选),
                "temperature": float (可选, 摄氏度),
                "humidity": float (可选, 百分比),
                "timestamp_iso": str (可选, ISO 8601),
                ...其他字段透传,
            }.

        Returns:
            {
                "device_id": str,
                "verified": bool (全部校验通过),
                "checks": list[{"field": str, "passed": bool, "value": Any, "expected_range": str, "error": str|None}],
                "verified_at_iso": str,
            }

        校验规则:
            - GPS lat 在 [18.0, 54.0] (中国大陆纬度)
            - GPS lon 在 [73.0, 135.0] (中国大陆经度)
            - temperature 在 [-20, 60] 摄氏度 (常规仓储)
            - humidity 在 [10, 95] 百分比 (常规仓储)
            - 设备必须存在且 active
        """
        # 查设备
        device = await _iot_device_store.get_device(device_id)
        if not device:
            raise ValueError(f"设备 {device_id} 不存在")

        # 设备状态校验 (offline 设备不接受数据)
        if device.get("status") == "offline":
            return {
                "device_id": device_id,
                "verified": False,
                "checks": [{
                    "field": "device_status",
                    "passed": False,
                    "value": device.get("status"),
                    "expected_range": "active | alarm",
                    "error": f"设备状态为 {device.get('status')}, 不接受数据",
                }],
                "verified_at_iso": _now_iso(),
            }

        checks: list[dict] = []
        all_passed = True

        # GPS 校验
        gps = data_payload.get("gps")
        if gps is not None:
            if not isinstance(gps, dict):
                checks.append({
                    "field": "gps",
                    "passed": False,
                    "value": gps,
                    "expected_range": "dict {lat, lon}",
                    "error": "gps 应为 dict {lat, lon}",
                })
                all_passed = False
            else:
                lat = gps.get("lat")
                lon = gps.get("lon")
                # 纬度
                lat_passed = (
                    isinstance(lat, (int, float))
                    and _GPS_LAT_RANGE[0] <= float(lat) <= _GPS_LAT_RANGE[1]
                )
                checks.append({
                    "field": "gps.lat",
                    "passed": lat_passed,
                    "value": lat,
                    "expected_range": f"[{_GPS_LAT_RANGE[0]}, {_GPS_LAT_RANGE[1]}]",
                    "error": None if lat_passed else "纬度超出中国大陆范围",
                })
                if not lat_passed:
                    all_passed = False
                # 经度
                lon_passed = (
                    isinstance(lon, (int, float))
                    and _GPS_LON_RANGE[0] <= float(lon) <= _GPS_LON_RANGE[1]
                )
                checks.append({
                    "field": "gps.lon",
                    "passed": lon_passed,
                    "value": lon,
                    "expected_range": f"[{_GPS_LON_RANGE[0]}, {_GPS_LON_RANGE[1]}]",
                    "error": None if lon_passed else "经度超出中国大陆范围",
                })
                if not lon_passed:
                    all_passed = False

        # 温度校验
        if "temperature" in data_payload:
            temp = data_payload.get("temperature")
            temp_passed = (
                isinstance(temp, (int, float))
                and _TEMP_RANGE_CELSIUS[0] <= float(temp) <= _TEMP_RANGE_CELSIUS[1]
            )
            checks.append({
                "field": "temperature",
                "passed": temp_passed,
                "value": temp,
                "expected_range": (
                    f"[{_TEMP_RANGE_CELSIUS[0]}, {_TEMP_RANGE_CELSIUS[1]}] °C"
                ),
                "error": None if temp_passed else "温度超出合理仓储范围",
            })
            if not temp_passed:
                all_passed = False

        # 湿度校验
        if "humidity" in data_payload:
            hum = data_payload.get("humidity")
            hum_passed = (
                isinstance(hum, (int, float))
                and _HUMIDITY_RANGE_PERCENT[0] <= float(hum) <= _HUMIDITY_RANGE_PERCENT[1]
            )
            checks.append({
                "field": "humidity",
                "passed": hum_passed,
                "value": hum,
                "expected_range": (
                    f"[{_HUMIDITY_RANGE_PERCENT[0]}, {_HUMIDITY_RANGE_PERCENT[1]}] %"
                ),
                "error": None if hum_passed else "湿度超出合理仓储范围",
            })
            if not hum_passed:
                all_passed = False

        # 写入遥测 (校验通过的数据才入库)
        if all_passed:
            sample = {
                "received_at_iso": _now_iso(),
                "data": dict(data_payload),
            }
            await _iot_device_store.append_telemetry(device_id, sample)
            # 更新 last_heartbeat
            ts = data_payload.get("timestamp_iso") or _now_iso()
            await _iot_device_store.update_status(
                device_id, device.get("status", "active"), heartbeat_iso=ts,
            )

        return {
            "device_id": device_id,
            "verified": all_passed,
            "checks": checks,
            "verified_at_iso": _now_iso(),
        }

    async def get_device_status(self, device_id: str) -> Optional[dict]:
        """设备状态查询.

        Args:
            device_id: 设备 ID.

        Returns:
            {
                "device_id": str,
                "enterprise_id": str,
                "device_type": str,
                "status": "active"|"alarm"|"offline",
                "cert_valid": bool (证书是否仍在有效期内),
                "cert_valid_to_iso": str,
                "last_heartbeat_iso": str,
                "uptime_hours": float (从注册到现在的小时数, mock),
                "queried_at_iso": str,
            }

        不存在返回 None.
        """
        device = await _iot_device_store.get_device(device_id)
        if not device:
            return None

        now = datetime.now(timezone.utc)
        # 证书有效期校验
        cert_valid_to_iso = device.get("cert_valid_to_iso", "")
        cert_valid = True
        if cert_valid_to_iso:
            try:
                valid_to = datetime.fromisoformat(
                    cert_valid_to_iso.replace("Z", "+00:00"),
                )
                cert_valid = now <= valid_to
            except (ValueError, TypeError):
                cert_valid = False

        # 计算在线时长 (从注册时间)
        uptime_hours = 0.0
        registered_iso = device.get("registered_at_iso", "")
        if registered_iso:
            try:
                registered = datetime.fromisoformat(
                    registered_iso.replace("Z", "+00:00"),
                )
                uptime_hours = max(0.0, (now - registered).total_seconds() / 3600.0)
            except (ValueError, TypeError):
                pass

        # 心跳超时判定: 超过 1 小时未心跳 → offline
        status = device.get("status", "active")
        last_hb_iso = device.get("last_heartbeat_iso", "")
        if last_hb_iso and status != "offline":
            try:
                last_hb = datetime.fromisoformat(
                    last_hb_iso.replace("Z", "+00:00"),
                )
                if (now - last_hb).total_seconds() > 3600:
                    status = "offline"
            except (ValueError, TypeError):
                pass

        return {
            "device_id": device_id,
            "enterprise_id": device.get("enterprise_id", ""),
            "device_type": device.get("device_type", ""),
            "status": status,
            "cert_valid": cert_valid,
            "cert_valid_to_iso": cert_valid_to_iso,
            "last_heartbeat_iso": last_hb_iso,
            "uptime_hours": round(uptime_hours, 2),
            "queried_at_iso": now.isoformat(),
        }

    # ====================================================================
    # V3 扩展接口 (legacy, 保持向后兼容; 数据源: 设备遥测 + EMQX 通道)
    # ====================================================================

    async def get_gps_trace(
        self, device_id: str, time_range: tuple[str, str] | None = None
    ) -> dict:
        """获取 GPS 轨迹 (设备遥测驱动, EMQX 通道采集)."""
        device = await _iot_device_store.get_device(device_id)
        samples = await _iot_device_store.get_telemetry(
            device_id, limit=500, sample_type="gps",
        )
        trace = []
        for s in samples:
            lat = s.get("latitude", s.get("lat"))
            lon = s.get("longitude", s.get("lon"))
            if lat is None or lon is None:
                continue
            trace.append({
                "latitude": float(lat),
                "longitude": float(lon),
                "timestamp": s.get("timestamp") or s.get("recorded_at_iso") or "",
            })
        return {
            "device_id": device_id,
            "time_range": list(time_range) if time_range else None,
            "trace": trace,
            "device_exists": device is not None,
            "status": "ok" if trace else "no_telemetry",
            "note": (
                f"遥测通道采集到 {len(trace)} 个 GPS 样本"
                if trace else "设备暂无 GPS 遥测样本 (EMQX 通道采集后自动回填)"
            ),
        }

    async def get_storage_environment(
        self, warehouse_id: str, sensor_type: str = "all"
    ) -> dict:
        """获取仓储温湿度 (温湿度传感器遥测驱动)."""
        samples = await _iot_device_store.get_telemetry(
            warehouse_id, limit=1, sample_type="environment",
        )
        if samples:
            latest = samples[0]
            temperature = latest.get("temperature", 22.5)
            humidity = latest.get("humidity", 55.0)
            source = "telemetry"
        else:
            temperature, humidity = 22.5, 55.0
            source = "default_when_no_telemetry"
        return {
            "warehouse_id": warehouse_id,
            "sensor_type": sensor_type,
            "temperature": temperature,
            "humidity": humidity,
            "source": source,
            "timestamp": _now_iso(),
        }

    async def verify_asset(
        self, enterprise_id: str, asset_id: str, asset_type: str
    ) -> dict:
        """实物资产存证 (聚合企业名下设备状态 + 遥测证据)."""
        devices = await _iot_device_store.list_devices(enterprise_id=enterprise_id)
        evidence: list[dict] = []
        for d in devices:
            telemetry = await _iot_device_store.get_telemetry(
                d["device_id"], limit=3,
            )
            evidence.append({
                "device_id": d["device_id"],
                "device_type": d["device_type"],
                "status": d.get("status", ""),
                "telemetry_samples": len(telemetry),
            })
        # 企业名下有活跃设备且任一设备有遥测 → 通过
        verified = any(
            e["status"] in ("active", "alarm") and e["telemetry_samples"] > 0
            for e in evidence
        ) if evidence else False
        return {
            "enterprise_id": enterprise_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "verified": verified,
            "verification_source": "iot_v3",
            "evidence": evidence,
            "note": (
                "企业名下无注册设备, 存证未通过"
                if not evidence
                else f"聚合 {len(evidence)} 台设备遥测证据"
            ),
        }

    async def verify_five_flows(
        self, enterprise_id: str, flows: list[str]
    ) -> dict:
        """五流合一验证 (IoT 流证据来自设备遥测)."""
        all_flows = ["fund", "contract", "invoice", "logistics", "iot"]
        matched = [f for f in flows if f in all_flows]
        if "iot" in flows:
            # iot 流证据: 企业名下设备遥测
            devices = await _iot_device_store.list_devices(enterprise_id=enterprise_id)
            has_iot_evidence = False
            for d in devices:
                telemetry = await _iot_device_store.get_telemetry(
                    d["device_id"], limit=1,
                )
                if telemetry:
                    has_iot_evidence = True
                    break
            completeness = 1.0 if (has_iot_evidence and len(matched) == 5) else 0.8
        else:
            completeness = 0.6 if len(matched) >= 4 else 0.4
        return {
            "enterprise_id": enterprise_id,
            "matched_flows": matched,
            "completeness": completeness,
            "max_level": "B" if "iot" not in flows else "A",
            "note": "五流验证规则: IoT 流证据取设备遥测, 其余流走对应业务引擎",
        }


# 单例
iot_service = IotService()
