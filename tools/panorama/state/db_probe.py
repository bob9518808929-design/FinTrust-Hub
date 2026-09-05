# 文件名：db_probe.py
# 职责：仅探测本地 DB 端口连通性，绝不读取 production 连接串
# 设计哲学：强制隔离（生产环境不部署本文件）

"""数据库连接探测器（仅本地开发环境）

硬约束：
  - 仅探测 localhost，绝不连接远程主机
  - 不读取任何 .env / Settings 中的连接串
  - 仅用 socket 探测端口是否监听
  - 生产环境部署时本文件必须不存在

注意：本文件被 collect.py 的 _probe_state() 调用，但仅在
PANORAMA_ENV in (dev, local) 时执行。
"""

from __future__ import annotations

import socket
import time


def probe_local_db(ports_config: dict) -> dict:
    """探测本地 DB 端口连通性

    Args:
        ports_config: {"postgres": 5432, "redis": 6379, ...}

    Returns:
        {
            "postgres": {"reachable": True, "latency_ms": 1.2, "host": "127.0.0.1"},
            ...
        }
    """
    result = {}
    for name, port in ports_config.items():
        # 硬约束：host 永远是 127.0.0.1
        result[name] = _probe_port("127.0.0.1", int(port))
    return result


def _probe_port(host: str, port: int) -> dict:
    """探测单个端口"""
    # 防御性：禁止非 localhost
    if host not in ("127.0.0.1", "localhost", "::1"):
        return {"reachable": False,
                "error": "SECURITY_VIOLATION: non-localhost host rejected"}

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        start = time.time()
        r = s.connect_ex((host, port))
        latency = (time.time() - start) * 1000
        s.close()
        if r == 0:
            return {
                "reachable": True,
                "latency_ms": round(latency, 2),
                "host": host,
                "port": port,
            }
        else:
            return {
                "reachable": False,
                "latency_ms": None,
                "host": host,
                "port": port,
                "error": f"connection refused (errno={r})",
            }
    except (socket.timeout, ConnectionRefusedError, OSError) as e:
        return {
            "reachable": False,
            "latency_ms": None,
            "host": host,
            "port": port,
            "error": str(e),
        }


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    # 仅自检本地端口
    res = probe_local_db({"postgres": 5432, "redis": 6379,
                           "clickhouse": 8123, "neo4j": 7687})
    for name, info in res.items():
        status = "✅ 可连接" if info.get("reachable") else "❌ 不可达"
        latency = info.get("latency_ms")
        print(f"{name} (:{info['port']}): {status} "
              f"{f'延迟 {latency}ms' if latency else ''}")
