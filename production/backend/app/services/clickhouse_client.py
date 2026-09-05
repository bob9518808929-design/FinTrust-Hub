"""ClickHouse 客户端 (可选, 降级到 PG/内存).

设计依据: spec.md L3503 ClickHouse 时序指标存储.
约束 (project_memory): 零机构接入时仍可独立运行, ClickHouse 不可达时降级.

注意: clickhouse-connect 是同步客户端, 这里仅做初始化探活 + 懒加载客户端.
真实查询由调用方在 service 层用 run_in_executor 包装, 或后续替换为 async 客户端.
"""


from loguru import logger

from app.config import settings

# === 懒加载客户端 ===

_client = None
_clickhouse_error: Exception | None = None


async def init_clickhouse() -> None:
    """初始化 ClickHouse 客户端 (启动时调用).

    连接失败时不抛异常, 标记 _clickhouse_error, 服务层降级到 PG/内存.
    """
    global _client, _clickhouse_error
    if _client is not None:
        return
    try:
        import clickhouse_connect

        client = clickhouse_connect.get_client(
            host=settings.CLICKHOUSE_HOST,
            port=settings.CLICKHOUSE_PORT,
            username=settings.CLICKHOUSE_USER,
            password=settings.CLICKHOUSE_PASSWORD or "",
            database=settings.CLICKHOUSE_DATABASE,
            connect_timeout=5,
            send_receive_timeout=30,
        )
        client.query("SELECT 1")  # 探活
        _client = client
    except Exception as exc:
        _client = None
        _clickhouse_error = exc


async def close_clickhouse() -> None:
    """关闭 ClickHouse 客户端 (关闭时调用)."""
    global _client, _clickhouse_error
    if _client is not None:
        try:
            _client.close()
        except Exception as exc:
            logger.warning(f"ClickHouse close 异常, 已忽略: {exc}")
        _client = None
    _clickhouse_error = None


def get_clickhouse_client():
    """获取 ClickHouse 客户端 (懒加载, 不可用时返回 None)."""
    return _client


def get_clickhouse_error() -> Exception | None:
    """获取 ClickHouse 连接错误 (诊断用)."""
    return _clickhouse_error
