"""Redis 异步连接池 (可选, 降级到无缓存).

设计依据: spec.md L3503 Redis + 01_init.lua 限流/缓存/会话.
约束 (project_memory): 零机构接入时仍可独立运行, Redis 不可用时降级到无缓存.

用法:
    from app.services.redis_client import get_redis

    redis = get_redis()
    if redis is not None:
        await redis.set("key", "value", ex=60)
        val = await redis.get("key")
    else:
        # Redis 不可用, 走无缓存逻辑
"""

from typing import Optional

from loguru import logger
from redis.asyncio import Redis
from redis.asyncio.connection import ConnectionPool
from redis.exceptions import RedisError

from app.config import settings


# === 懒加载连接池 (driver/连接 缺失时降级) ===

_redis: Optional[Redis] = None
_redis_error: Optional[Exception] = None


async def init_redis() -> None:
    """初始化 Redis 连接池 (启动时调用).

    连接失败时不抛异常, 标记 _redis_error, 服务层通过 get_redis() 返回 None 降级.
    """
    global _redis, _redis_error
    if _redis is not None:
        return
    try:
        pool = ConnectionPool.from_url(
            settings.REDIS_URL,
            password=settings.REDIS_PASSWORD or None,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
            health_check_interval=30,
        )
        _redis = Redis(connection_pool=pool)
        await _redis.ping()  # 探活
    except Exception as exc:  # RedisError / ConnectionError / DNS 解析失败等
        _redis = None
        _redis_error = exc


async def close_redis() -> None:
    """关闭 Redis 连接池 (关闭时调用)."""
    global _redis, _redis_error
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception as exc:
            logger.warning(f"Redis close 异常, 已忽略: {exc}")
        _redis = None
    _redis_error = None


def get_redis() -> Optional[Redis]:
    """获取 Redis 客户端 (懒加载, 不可用时返回 None)."""
    return _redis


def get_redis_error() -> Optional[Exception]:
    """获取 Redis 连接错误 (诊断用)."""
    return _redis_error


async def rate_limit(key: str, window_sec: int, max_req: int) -> bool:
    """滑动窗口限流 (Redis 不可用时降级为放行).

    对齐 db/redis/01_init.lua 限流逻辑.
    Returns: True 放行 / False 限流
    """
    redis = get_redis()
    if redis is None:
        logger.warning(
            f"Redis 不可用, 限流降级放行 (key={key}, window={window_sec}s, max={max_req})"
        )
        return True  # Redis 不可用, 降级放行
    import time
    now = int(time.time() * 1000)
    clear_before = now - window_sec * 1000

    try:
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, "-inf", clear_before)
        pipe.zcard(key)
        if (await pipe.execute())[1] >= max_req:
            return False  # 限流
        pipe2 = redis.pipeline()
        pipe2.zadd(key, {f"{now}:{now}": now})
        pipe2.expire(key, window_sec + 1)
        await pipe2.execute()
        return True
    except RedisError as exc:
        # Redis 连接在但操作抛错 (网络抖动/连接重置/超时): 降级放行, 不阻断业务
        logger.warning(
            f"Redis 操作异常, 限流降级放行 (key={key}, err={type(exc).__name__}: {exc})"
        )
        return True
