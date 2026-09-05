# 文件名：port_probe.py
# 职责：探测本地端口监听状态（仅本地开发环境，绝不读取 production 连接串）
# 设计哲学：白盒可解释 + 强制隔离

"""端口探测器

仅探测本地开发环境的端口：
  - 5432 (PostgreSQL)
  - 6379 (Redis)
  - 8123 (ClickHouse)
  - 7687 (Neo4j)
  - 8000 (FastAPI)
  - 5173 (Vite)

绝不读取任何 production 连接串，绝不连接远程主机。
"""

from __future__ import annotations

import socket


def probe_ports(ports_config: dict) -> dict:
    """探测多个端口的监听状态

    Args:
        ports_config: {service_name: port}，例如 {"postgres": 5432}

    Returns:
        {
            "postgres": {"port": 5432, "listening": True, "latency_ms": 1.2},
            ...
        }
    """
    result = {}
    for name, port in ports_config.items():
        result[name] = _probe_single_port(name, int(port))
    return result


def _probe_single_port(name: str, port: int) -> dict:
    """探测单个端口"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        import time
        start = time.time()
        # 仅连接 localhost，绝不连接其他主机
        r = s.connect_ex(("127.0.0.1", port))
        latency = (time.time() - start) * 1000
        s.close()
        if r == 0:
            return {
                "port": port,
                "listening": True,
                "latency_ms": round(latency, 2),
                "host": "127.0.0.1",
            }
        else:
            return {
                "port": port,
                "listening": False,
                "latency_ms": None,
                "host": "127.0.0.1",
                "error": f"connection refused (errno={r})",
            }
    except (socket.timeout, ConnectionRefusedError, OSError) as e:
        return {
            "port": port,
            "listening": False,
            "latency_ms": None,
            "host": "127.0.0.1",
            "error": str(e),
        }


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    res = probe_ports({"postgres": 5432, "redis": 6379,
                       "backend": 8000, "frontend": 5173})
    for name, info in res.items():
        status = "✅ 监听中" if info["listening"] else "❌ 未监听"
        print(f"{name} (:{info['port']}): {status}")
