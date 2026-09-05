"""DATA-04 IoT MQTT 网关服务 (P1 R2.7 + R5.5 MQTT 真实对接 + R7.0 EMQX 自部署配置).

MQTT 真实对接 EMQX: 有凭证 (MQTT_USERNAME/MQTT_PASSWORD) 时用 paho-mqtt 连接
EMQX 发布/订阅; 无凭证 / paho-mqtt 未安装 / broker 不可达时降级为 HTTP 长轮询 +
内置模拟设备 (保持兜底).
风格: 内存 store 单例 + asyncio.Lock + _seed 种子 + db=None 注入.

R5.5 升级:
    - _mqtt_publish(device_id, topic, payload): MQTT 发布, 失败降级 HTTP 长轮询
    - _mqtt_subscribe(topic, callback): MQTT 订阅, 失败降级 HTTP 长轮询
    - publish_telemetry(device_id, payload): 发布到 iot/{device_id}/telemetry
    - subscribe_telemetry(callback): 订阅 iot/+/telemetry

R7.0 升级:
    - deploy_emqx_config(): 把 device_auth.conf / alert_rules.json 应用到 EMQX broker
      (通过 EMQX HTTP API 5.0), 失败降级为本地配置加载
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.schemas.iot_gateway import (
    CommandRequest,
    CommandResult,
    CommandStatus,
    Device,
    DeviceStatus,
    GatewayInfo,
    GatewayProtocol,
    GatewayStatus,
    TelemetrySample,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "id") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# === MQTT broker 配置 (R5.5 + 真实 EMQX 对接) ===
# 通过环境变量 MQTT_BROKER_HOST / MQTT_BROKER_PORT / MQTT_USERNAME / MQTT_PASSWORD 配置
_MQTT_HOST = os.environ.get("MQTT_BROKER_HOST", "localhost")
_MQTT_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
_MQTT_USERNAME = os.environ.get("MQTT_USERNAME", "")
_MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
_MQTT_CLIENT_ID = "fintrust-iot-gateway"

# === EMQX HTTP API 配置 (R7.0 deploy_emqx_config) ===
_EMQX_API_HOST = os.environ.get("EMQX_API_HOST", "localhost")
_EMQX_API_PORT = int(os.environ.get("EMQX_API_PORT", "18083"))
_EMQX_API_USER = os.environ.get("EMQX_API_USER", "admin")
_EMQX_API_PASS = os.environ.get("EMQX_API_PASS", "public")

# === EMQX 配置文件路径 (R7.0 deploy_emqx_config 加载) ===
_EMQX_CONFIG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..", "infra", "emqx",
)
_EMQX_CONFIG_DIR = os.path.abspath(_EMQX_CONFIG_DIR)
_DEVICE_AUTH_PATH = os.path.join(_EMQX_CONFIG_DIR, "device_auth.conf")
_ALERT_RULES_PATH = os.path.join(_EMQX_CONFIG_DIR, "alert_rules.json")
_USERS_CONF_PATH = os.path.join(_EMQX_CONFIG_DIR, "users.conf")
_MQTT_CONFIG_PATH = os.path.join(_EMQX_CONFIG_DIR, "mqtt_config.yaml")


def _mqtt_lib() -> Any | None:
    """尝试 import paho.mqtt.client (若未安装返回 None).

    用 try/except ImportError 兜底 paho-mqtt 未安装的情况,
    其他异常也一并捕获返回 None, 由调用方降级处理.
    """
    try:
        import paho.mqtt.client as mqtt  # type: ignore
        return mqtt
    except ImportError:
        return None
    except Exception:
        return None


def _mqtt_credentials_available() -> bool:
    """检查 MQTT 凭证是否配置 (无凭证则降级 HTTP 长轮询 + 模拟设备)."""
    return bool(_MQTT_USERNAME and _MQTT_PASSWORD)


def _httpx_available() -> bool:
    """检测 httpx 是否可用 (deploy_emqx_config 用)."""
    try:
        import httpx  # noqa: F401
        return True
    except Exception:
        return False


class _IOTStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._gateways: dict[str, dict] = {}
        self._devices: dict[str, dict] = {}
        self._telemetry: dict[str, list[dict]] = {}
        self._commands: dict[str, dict] = {}
        # R5.5: MQTT 订阅表 + 发布日志 (HTTP 长轮询降级时复用)
        self._mqtt_subscribers: dict[str, list[Callable[[dict], None]]] = {}
        self._mqtt_publish_log: list[dict] = []
        self._seed()

    def _seed(self) -> None:
        gw1 = {
            "id": "GW-EMQX-001",
            "name": "EMQX 企业级 MQTT5 网关",
            "protocol": GatewayProtocol.MQTT5.value,
            "status": GatewayStatus.ACTIVE.value,
            "connected_devices_count": 0,
        }
        gw2 = {
            "id": "GW-HTTP-001",
            "name": "HTTP 长轮询网关 (降级)",
            "protocol": GatewayProtocol.HTTP_LONGPOLL.value,
            "status": GatewayStatus.ACTIVE.value,
            "connected_devices_count": 0,
        }
        self._gateways[gw1["id"]] = gw1
        self._gateways[gw2["id"]] = gw2

        enterprises = ["E001", "E002", "E003", "E004"]
        models = [
            ("温控传感器", "TH-Sensor-X1"),
            ("能耗监测仪", "EM-Pro-200"),
            ("GPS 定位器", "GPS-Tracker-V3"),
            ("生产线监控", "PLC-Monitor-M5"),
            ("烟雾报警器", "SMOKE-ALARM-A1"),
        ]
        now = datetime.now(UTC)

        device_count = 0
        for ent_idx, ent_id in enumerate(enterprises):
            gw = gw1 if ent_idx % 2 == 0 else gw2
            for i in range(10):
                model_idx = (ent_idx * 3 + i) % len(models)
                model_name, model_code = models[model_idx]
                status_val = DeviceStatus.ONLINE.value
                if (ent_idx == 1 and i in (2, 7)) or (ent_idx == 3 and i == 4):
                    status_val = DeviceStatus.ALARM.value
                elif i == 9:
                    status_val = DeviceStatus.SLEEP.value
                elif ent_idx == 2 and i in (5, 6):
                    status_val = DeviceStatus.OFFLINE.value

                last_seen = (now - timedelta(minutes=random.randint(0, 59))).isoformat()
                dev_id = _id("DEV")

                metrics: dict[str, Any] = {}
                if "温" in model_name or "TH" in model_code:
                    metrics = {"temperature": round(random.uniform(18, 32), 2), "humidity": round(random.uniform(30, 85), 2)}
                    if status_val == DeviceStatus.ALARM.value:
                        metrics["temperature"] = round(random.uniform(60, 85), 2)
                        metrics["alarm"] = "overheat"
                elif "能耗" in model_name:
                    metrics = {"power_kw": round(random.uniform(5, 200), 2), "kwh_today": round(random.uniform(50, 1500), 2)}
                elif "GPS" in model_name:
                    metrics = {"lat": round(random.uniform(22, 40), 5), "lon": round(random.uniform(108, 122), 5), "speed_kmh": round(random.uniform(0, 120), 1)}
                elif "PLC" in model_name:
                    metrics = {"uptime_h": random.randint(10, 5000), "rpm": random.randint(500, 3500), "vibration": round(random.uniform(0.1, 5.0), 3)}
                else:
                    metrics = {"battery_pct": random.randint(10, 100), "signal_dbm": random.randint(-95, -45)}

                device = {
                    "id": dev_id,
                    "name": f"{ent_id}-{model_name}-{i+1:02d}",
                    "model": model_code,
                    "enterprise_id": ent_id,
                    "gateway_id": gw["id"],
                    "status": status_val,
                    "last_seen_iso": last_seen,
                    "metrics": metrics,
                    "telemetry": [],
                }
                self._devices[dev_id] = device
                self._telemetry[dev_id] = []
                device_count += 1
            gw["connected_devices_count"] += 10

    async def list_gateways(self) -> list[dict]:
        async with self._lock:
            return [dict(g) for g in self._gateways.values()]

    async def list_devices(self, enterprise_id: str | None, status: str | None) -> list[dict]:
        async with self._lock:
            devs = list(self._devices.values())
        if enterprise_id:
            devs = [d for d in devs if d.get("enterprise_id") == enterprise_id]
        if status:
            devs = [d for d in devs if d.get("status") == status]
        return [dict(d) for d in devs]

    async def get_device(self, device_id: str) -> dict | None:
        async with self._lock:
            d = self._devices.get(device_id)
            return dict(d) if d else None

    async def add_telemetry(self, device_id: str, samples: list[dict]) -> None:
        async with self._lock:
            if device_id not in self._telemetry:
                self._telemetry[device_id] = []
            self._telemetry[device_id].extend(samples)
            if device_id in self._devices:
                existing = self._devices[device_id].get("telemetry", [])
                combined = existing + [TelemetrySample.model_validate(s).model_dump(by_alias=True) for s in samples]
                self._devices[device_id]["telemetry"] = combined[-500:]

    async def get_telemetry(self, device_id: str) -> list[dict]:
        async with self._lock:
            return [dict(s) for s in self._telemetry.get(device_id, [])]

    async def add_command(self, cmd: dict) -> dict:
        async with self._lock:
            self._commands[cmd["command_id"]] = dict(cmd)
            return dict(cmd)

    # R5.5: MQTT 订阅注册 (用于 HTTP 长轮询降级)
    async def add_mqtt_subscriber(
        self, topic: str, callback: Callable[[dict], None],
    ) -> None:
        async with self._lock:
            self._mqtt_subscribers.setdefault(topic, []).append(callback)

    async def get_mqtt_subscribers(self, topic: str) -> list[Callable[[dict], None]]:
        async with self._lock:
            return list(self._mqtt_subscribers.get(topic, []))

    async def add_mqtt_publish_log(self, log: dict) -> None:
        async with self._lock:
            self._mqtt_publish_log.append(dict(log))
            # 仅保留最近 500 条
            if len(self._mqtt_publish_log) > 500:
                self._mqtt_publish_log = self._mqtt_publish_log[-500:]

    async def list_mqtt_publish_log(self, limit: int = 100) -> list[dict]:
        async with self._lock:
            return [dict(x) for x in self._mqtt_publish_log[-limit:]]


_iot_store = _IOTStore()


class IOTGatewayService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def list_gateways(self) -> list[GatewayInfo]:
        gws = await _iot_store.list_gateways()
        return [GatewayInfo.model_validate(g) for g in gws]

    async def list_devices(self, enterprise_id: str | None = None, status: DeviceStatus | None = None) -> list[Device]:
        devs = await _iot_store.list_devices(enterprise_id, status.value if status else None)
        return [Device.model_validate(d) for d in devs]

    async def get_device(self, device_id: str) -> Device | None:
        d = await _iot_store.get_device(device_id)
        return Device.model_validate(d) if d else None

    async def simulate_telemetry_burst(self, enterprise_id: str, count: int = 50) -> list[TelemetrySample]:
        devices = await self.list_devices(enterprise_id, DeviceStatus.ONLINE)
        if not devices:
            devices = await self.list_devices(enterprise_id)
        all_samples: list[TelemetrySample] = []
        now = datetime.now(UTC)
        for dev in devices:
            samples: list[dict] = []
            for ci in range(count):
                ts = (now - timedelta(minutes=count - ci)).isoformat()
                if "TH" in dev.model or "温" in dev.name:
                    samples.append({
                        "timeIso": ts, "metricName": "temperature",
                        "valueNumeric": round(random.uniform(18, 35), 2), "unit": "C",
                    })
                    samples.append({
                        "timeIso": ts, "metricName": "humidity",
                        "valueNumeric": round(random.uniform(30, 90), 2), "unit": "%",
                    })
                elif "EM" in dev.model or "能耗" in dev.name:
                    samples.append({
                        "timeIso": ts, "metricName": "power_kw",
                        "valueNumeric": round(random.uniform(5, 200), 2), "unit": "kW",
                    })
                elif "GPS" in dev.model:
                    lat = round(random.uniform(22, 40), 5)
                    lon = round(random.uniform(108, 122), 5)
                    samples.append({
                        "timeIso": ts, "metricName": "gps",
                        "valueNumeric": None, "unit": "coord",
                        "geoLat": lat, "geoLon": lon,
                    })
                else:
                    samples.append({
                        "timeIso": ts, "metricName": "uptime",
                        "valueNumeric": round(random.uniform(0, 100), 2), "unit": "%",
                    })
            validated = [TelemetrySample.model_validate(s) for s in samples]
            await _iot_store.add_telemetry(dev.id, [v.model_dump(by_alias=True) for v in validated])
            all_samples.extend(validated)
        return all_samples

    async def get_telemetry(
        self, device_id: str, metric_name: str | None = None, hours: int = 24,
    ) -> list[TelemetrySample]:
        raw = await _iot_store.get_telemetry(device_id)
        samples = [TelemetrySample.model_validate(s) for s in raw]
        if metric_name:
            samples = [s for s in samples if s.metric_name == metric_name]
        if hours:
            cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
            samples = [s for s in samples if s.time_iso >= cutoff]
        return samples

    async def send_command(self, req: CommandRequest) -> CommandResult:
        cmd_id = _id("CMD")
        now = _now_iso()
        status = CommandStatus.ACKED
        if req.command == "REBOOT":
            status = CommandStatus.ACKED
        elif req.command == "SET_INTERVAL":
            status = CommandStatus.ACKED
        elif req.command == "REPORT_NOW":
            status = CommandStatus.ACKED
        else:
            status = CommandStatus.NACK

        cmd_data = {
            "command_id": cmd_id,
            "device_id": req.device_id,
            "command": req.command,
            "payload": req.payload,
            "status": status.value,
            "executed_at": now,
            "created_at": now,
        }
        await _iot_store.add_command(cmd_data)
        # R5.5: 命令同步通过 MQTT 发布到设备 (失败自动降级)
        await self._mqtt_publish(
            device_id=req.device_id,
            topic=f"fintrust/_/{req.device_id}/command",
            payload={"command_id": cmd_id, "command": req.command, "payload": req.payload},
        )
        return CommandResult(
            command_id=cmd_id,
            status=status,
            executed_at=now,
        )

    # ====================================================================
    # R5.5 MQTT 发布/订阅 (paho-mqtt 不可用降级 HTTP 长轮询)
    # ====================================================================

    async def _mqtt_publish(
        self, device_id: str, topic: str, payload: dict,
    ) -> dict:
        """MQTT 发布消息到指定 topic.

        有凭证 (MQTT_USERNAME/MQTT_PASSWORD) 时用 paho-mqtt 连接 EMQX 发布;
        无凭证 / paho-mqtt 未安装 / broker 不可达时, 自动降级到内存 publish_log
        (HTTP 长轮询模式: 客户端轮询 /iot/mqtt/log 拉取).
        """
        now = _now_iso()
        log_entry = {
            "message_id": _id("MSG"),
            "device_id": device_id,
            "topic": topic,
            "payload": payload,
            "published_at_iso": now,
            "transport": "mqtt",
            "status": "unknown",
        }
        mqtt_lib = _mqtt_lib()
        if mqtt_lib is None:
            # paho-mqtt 未安装 (ImportError), 降级 HTTP 长轮询
            log_entry["transport"] = "http_longpoll"
            log_entry["status"] = "fallback_no_lib"
            await _iot_store.add_mqtt_publish_log(log_entry)
            # 通知订阅者 (HTTP 长轮询订阅模式)
            await self._dispatch_subscribers(topic, log_entry)
            return log_entry
        if not _mqtt_credentials_available():
            # 无 MQTT 凭证, 降级 HTTP 长轮询 + 模拟设备 (保持兜底)
            log_entry["transport"] = "http_longpoll"
            log_entry["status"] = "fallback_no_credentials"
            await _iot_store.add_mqtt_publish_log(log_entry)
            await self._dispatch_subscribers(topic, log_entry)
            return log_entry
        try:
            # paho.mqtt.publish 模块同步发布, 不阻塞 event loop 太久
            import paho.mqtt.publish as mqtt_publish  # type: ignore
            payload_str = json.dumps(payload, ensure_ascii=False, default=str)
            mqtt_publish.single(
                topic=topic,
                payload=payload_str,
                hostname=_MQTT_HOST,
                port=_MQTT_PORT,
                client_id=_MQTT_CLIENT_ID,
                auth={"username": _MQTT_USERNAME, "password": _MQTT_PASSWORD},
                qos=1,
            )
            log_entry["status"] = "published"
            await _iot_store.add_mqtt_publish_log(log_entry)
            return log_entry
        except Exception as exc:
            logger.warning(f"MQTT 发布失败 ({exc}), 降级 HTTP 长轮询")
            log_entry["transport"] = "http_longpoll"
            log_entry["status"] = f"fallback: {type(exc).__name__}"
            await _iot_store.add_mqtt_publish_log(log_entry)
            await self._dispatch_subscribers(topic, log_entry)
            return log_entry

    async def _mqtt_subscribe(
        self, topic: str, callback: Callable[[dict], None],
    ) -> dict:
        """订阅 MQTT topic.

        有凭证 (MQTT_USERNAME/MQTT_PASSWORD) 时用 paho-mqtt 连接 EMQX 订阅;
        无凭证 / paho-mqtt 未安装时, 注册回调到内存订阅表, 当 _mqtt_publish
        降级发布时通过 _dispatch_subscribers 触发回调 (HTTP 长轮询模拟).
        """
        await _iot_store.add_mqtt_subscriber(topic, callback)
        mqtt_lib = _mqtt_lib()
        if mqtt_lib is None:
            # paho-mqtt 未安装 (ImportError), 降级 HTTP 长轮询
            return {
                "topic": topic,
                "transport": "http_longpoll",
                "status": "fallback_no_lib",
                "subscribed_at_iso": _now_iso(),
            }
        if not _mqtt_credentials_available():
            # 无 MQTT 凭证, 降级 HTTP 长轮询 + 模拟设备 (保持兜底)
            return {
                "topic": topic,
                "transport": "http_longpoll",
                "status": "fallback_no_credentials",
                "subscribed_at_iso": _now_iso(),
            }
        try:
            # paho 的 client 是阻塞的, 在异步上下文里用 thread 托管
            client = mqtt_lib.Client(
                client_id=f"{_MQTT_CLIENT_ID}-sub-{uuid.uuid4().hex[:6]}",
                protocol=mqtt_lib.MQTTv5,
            )
            # EMQX 凭证认证 (用户名/密码)
            client.username_pw_set(_MQTT_USERNAME, _MQTT_PASSWORD)

            def _on_message(client, userdata, msg):  # type: ignore
                try:
                    payload = json.loads(msg.payload.decode("utf-8"))
                except Exception:
                    payload = {"raw": msg.payload.decode("utf-8", errors="replace")}
                try:
                    callback(payload)
                except Exception as exc:  # 防止回调异常炸 client 线程
                    logger.warning(f"MQTT 订阅回调异常: {exc}")

            client.on_message = _on_message
            client.connect(_MQTT_HOST, _MQTT_PORT, keepalive=60)
            client.subscribe(topic, qos=1)
            # 启动后台 loop (非阻塞)
            client.loop_start()
            return {
                "topic": topic,
                "transport": "mqtt",
                "status": "subscribed",
                "subscribed_at_iso": _now_iso(),
            }
        except Exception as exc:
            logger.warning(f"MQTT 订阅失败 ({exc}), 降级 HTTP 长轮询")
            return {
                "topic": topic,
                "transport": "http_longpoll",
                "status": f"fallback: {type(exc).__name__}",
                "subscribed_at_iso": _now_iso(),
            }

    async def publish_telemetry(
        self, device_id: str, payload: dict,
    ) -> dict:
        """发布遥测数据到 iot/{device_id}/telemetry (EMQX 真实对接).

        复用 _mqtt_publish: 有凭证时通过 EMQX 发布, 无凭证 / 连接失败时
        自动降级 HTTP 长轮询 + 模拟设备 (保持兜底).
        """
        topic = f"iot/{device_id}/telemetry"
        return await self._mqtt_publish(
            device_id=device_id, topic=topic, payload=payload,
        )

    async def subscribe_telemetry(
        self, callback: Callable[[dict], None],
    ) -> dict:
        """订阅遥测 topic iot/+/telemetry (EMQX 真实对接).

        复用 _mqtt_subscribe: 有凭证时通过 EMQX 订阅, 无凭证 / 连接失败时
        自动降级 HTTP 长轮询 + 模拟设备 (保持兜底).
        """
        topic = "iot/+/telemetry"
        return await self._mqtt_subscribe(topic=topic, callback=callback)

    async def _dispatch_subscribers(self, topic: str, message: dict) -> None:
        """触发该 topic 的所有内存订阅者 (HTTP 长轮询降级模式)."""
        subscribers = await _iot_store.get_mqtt_subscribers(topic)
        for cb in subscribers:
            try:
                cb(message)
            except Exception as exc:
                logger.warning(f"订阅者回调异常: {exc}")

    async def list_mqtt_publish_log(self, limit: int = 100) -> list[dict]:
        """列出最近的 MQTT 发布日志 (含降级记录)."""
        return await _iot_store.list_mqtt_publish_log(limit=limit)

    # ====================================================================
    # R7.0 EMQX 自部署配置完善 (device_auth.conf + alert_rules.json 应用)
    # ====================================================================

    async def deploy_emqx_config(
        self,
        config_dir: str | None = None,
        emqx_api_host: str | None = None,
        emqx_api_port: int | None = None,
        emqx_api_user: str | None = None,
        emqx_api_pass: str | None = None,
    ) -> dict[str, Any]:
        """应用 EMQX 配置到 broker (device_auth.conf + alert_rules.json).

        通过 EMQX HTTP API 5.0 上传设备认证 + 告警规则配置.
        EMQX 不可达 / HTTP API 不可用时降级为本地配置加载 (返回 fallback 标记).

        Args:
            config_dir: EMQX 配置目录 (默认 infra/emqx/, 含 device_auth.conf
                        / alert_rules.json / users.conf / mqtt_config.yaml)
            emqx_api_host: EMQX Dashboard HTTP API host (默认 localhost)
            emqx_api_port: EMQX Dashboard HTTP API port (默认 18083)
            emqx_api_user: EMQX Dashboard 账号 (默认 admin)
            emqx_api_pass: EMQX Dashboard 密码 (默认 public)

        Returns:
            dict 含以下字段:
                - status: "deployed" (成功) / "fallback_local_only" (本地降级)
                - config_dir: 实际使用的配置目录
                - device_count: 加载的设备账号数 (含服务账号)
                - alert_rules_count: 加载的告警规则数
                - mqtt_config_loaded: bool (mqtt_config.yaml 是否加载)
                - emqx_api_reachable: bool (EMQX HTTP API 是否可达)
                - errors: list[str] (降级时的错误信息)
                - deployed_at_iso: ISO timestamp
        """
        cfg_dir = os.path.abspath(config_dir) if config_dir else _EMQX_CONFIG_DIR
        host = emqx_api_host or _EMQX_API_HOST
        port = int(emqx_api_port or _EMQX_API_PORT)
        user = emqx_api_user or _EMQX_API_USER
        pwd = emqx_api_pass or _EMQX_API_PASS

        result: dict[str, Any] = {
            "status": "deployed",
            "config_dir": cfg_dir,
            "device_count": 0,
            "alert_rules_count": 0,
            "mqtt_config_loaded": False,
            "emqx_api_reachable": False,
            "errors": [],
            "deployed_at_iso": _now_iso(),
        }

        # === 1. 本地加载 device_auth.conf + alert_rules.json + mqtt_config.yaml ===
        device_path = os.path.join(cfg_dir, "device_auth.conf")
        users_path = os.path.join(cfg_dir, "users.conf")
        alert_path = os.path.join(cfg_dir, "alert_rules.json")
        mqtt_cfg_path = os.path.join(cfg_dir, "mqtt_config.yaml")

        device_entries: list[dict[str, str]] = []
        for path in (device_path, users_path):
            try:
                if not os.path.exists(path):
                    continue
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split(":")
                        if len(parts) >= 2:
                            device_entries.append({
                                "username": parts[0],
                                "password_hash": parts[1] if len(parts) > 1 else "",
                                "salt": parts[2] if len(parts) > 2 else "",
                            })
            except Exception as exc:
                result["errors"].append(
                    f"load {os.path.basename(path)} failed: {type(exc).__name__}: {exc}"
                )
        result["device_count"] = len(device_entries)

        # alert_rules.json
        try:
            if os.path.exists(alert_path):
                with open(alert_path, encoding="utf-8") as f:
                    alert_cfg = json.load(f)
                result["alert_rules_count"] = len(alert_cfg.get("rules", []))
        except Exception as exc:
            result["errors"].append(
                f"load alert_rules.json failed: {type(exc).__name__}: {exc}"
            )

        # mqtt_config.yaml
        try:
            if os.path.exists(mqtt_cfg_path):
                # 仅验证可读 (YAML 解析), 不上传到 broker (broker 启动时已挂载)
                import yaml
                with open(mqtt_cfg_path, encoding="utf-8") as f:
                    yaml.safe_load(f)
                result["mqtt_config_loaded"] = True
        except Exception as exc:
            result["errors"].append(
                f"load mqtt_config.yaml failed: {type(exc).__name__}: {exc}"
            )

        # === 2. 通过 EMQX HTTP API 应用配置 (失败降级为本地) ===
        api_reachable = False
        if _httpx_available():
            try:
                import httpx
                base_url = f"http://{host}:{port}/api/v5"
                async with httpx.AsyncClient(timeout=3.0) as client:
                    # 检查 EMQX Dashboard 是否可达
                    try:
                        # EMQX 5.0 GET /api/v5/status 无需认证
                        resp = await client.get(f"{base_url}/status")
                        if resp.status_code < 500:
                            api_reachable = True
                    except Exception as exc:
                        result["errors"].append(
                            f"emqx status check failed: {type(exc).__name__}: {exc}"
                        )

                    if api_reachable:
                        # 认证 (Basic Auth)
                        auth = (user, pwd)
                        # 上传设备用户 (authentication/users)
                        for entry in device_entries:
                            try:
                                payload = {
                                    "user_id": entry["username"],
                                    "password": entry["password_hash"],
                                    "is_superuser": False,
                                }
                                # PUT /api/v5/authentication/:id/users/:user_id
                                # (EMQX 5.0 用户管理 API)
                                await client.put(
                                    f"{base_url}/authentication/password_based%3Abuilt_in_database/users/{entry['username']}",
                                    json=payload, auth=auth,
                                )
                            except Exception:
                                pass  # 单个用户失败不阻断整体部署

                        # 上传告警规则 (rules) - EMQX 5.0 rule engine API
                        try:
                            if os.path.exists(alert_path):
                                with open(alert_path, encoding="utf-8") as f:
                                    alert_cfg = json.load(f)
                                for rule in alert_cfg.get("rules", []):
                                    if not rule.get("enabled", True):
                                        continue
                                    rule_payload = {
                                        "id": rule.get("rule_id", ""),
                                        "name": rule.get("name", ""),
                                        "sql": self._build_emqx_rule_sql(rule),
                                        "actions": ["webhook"],
                                        "enable": True,
                                    }
                                    try:
                                        await client.post(
                                            f"{base_url}/rules",
                                            json=rule_payload, auth=auth,
                                        )
                                    except Exception:
                                        pass
                        except Exception as exc:
                            result["errors"].append(
                                f"deploy alert rules failed: {type(exc).__name__}: {exc}"
                            )
            except Exception as exc:
                result["errors"].append(
                    f"httpx emqx api failed: {type(exc).__name__}: {exc}"
                )
        else:
            result["errors"].append("httpx not available, emqx api skipped")

        result["emqx_api_reachable"] = api_reachable
        # 状态: 如果 EMQX 不可达 / httpx 不可用 → 降级本地
        if not api_reachable:
            result["status"] = "fallback_local_only"

        return result

    @staticmethod
    def _build_emqx_rule_sql(rule: dict[str, Any]) -> str:
        """把告警规则 trigger 转为 EMQX SQL (rule engine).

        EMQX 5.0 规则 SQL 形如:
            SELECT * FROM "fintrust/+/+/telemetry"
            WHERE payload.temperature > 80

        Args:
            rule: alert_rules.json 中的 rule dict

        Returns:
            str EMQX SQL
        """
        trigger = rule.get("trigger", {}) or {}
        trigger.get("type", "")
        topic = trigger.get("telemetry_topic") or trigger.get("topic_pattern") or "#"
        conditions: list[str] = []
        for cond in trigger.get("conditions", []) or []:
            metric = cond.get("metric_name", "")
            op = cond.get("operator", ">")
            threshold = cond.get("threshold", 0)
            conditions.append(f"payload.{metric} {op} {threshold}")
        sql = f'SELECT * FROM "{topic}"'
        if conditions:
            sql += " WHERE " + " OR ".join(conditions)
        return sql


iot_gateway_service = IOTGatewayService(db=None)
