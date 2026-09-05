"""SQLAlchemy 异步引擎 + Session.

设计依据: spec.md L3503 PostgreSQL + Redis + ClickHouse + Neo4j.
约束 (project_memory): 零机构接入时系统仍能独立运行, DB 不可用时降级到内存.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM model 的基类."""


# === 懒加载引擎 (driver 缺失时降级, 不阻断应用启动) ===

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None
_driver_error: Exception | None = None


def _create_engine() -> AsyncEngine | None:
    """创建异步引擎, driver 缺失时返回 None 并记录错误."""
    global _engine, _driver_error
    if _engine is not None:
        return _engine
    try:
        _engine = create_async_engine(
            settings.DATABASE_URL,
            pool_size=settings.DATABASE_POOL_SIZE,
            max_overflow=settings.DATABASE_MAX_OVERFLOW,
            echo=settings.DATABASE_ECHO,
            pool_pre_ping=True,
            pool_recycle=3600,
            # Windows 下 asyncpg + Windows 事件循环经常出现
            # "指定的网络名不再可用 / ConnectionDoesNotExistError"
            # (Experience 648547 / 1435811 总结症状: 半关闭连接后
            #  pool 里还残留, 下一次 checkout 直接报错).
            # 以下参数组合:
            #   pool_timeout=15s: 等连接 15s 拿不到就快速失败降级
            #   pool_use_lifo=True: 尽量复用新连接, 避免拿到老的僵尸连接
            #   connect_args.statement_cache_size=0: 关闭 asyncpg 语句缓存,
            #     缓解 Windows 事件循环 "关闭 mid-operation" 后的缓存损坏
            connect_args={
                'server_settings': {'application_name': 'fintrust-hub-app'},
                'statement_cache_size': 0,
                'command_timeout': 10,  # 单条 SQL 超时 10s, 不阻塞事件循环
            },
            pool_timeout=15,
            pool_use_lifo=True,
        )
        _session_factory = async_sessionmaker(
            _engine, class_=AsyncSession,
            expire_on_commit=False, autoflush=False,
        )
        return _engine
    except Exception as exc:  # driver 缺失 / URL 无效
        _driver_error = exc
        return None


def get_engine() -> AsyncEngine | None:
    """获取引擎 (懒加载)."""
    return _create_engine()


def get_driver_error() -> Exception | None:
    """获取 driver 加载错误 (诊断用)."""
    return _driver_error


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖: 注入数据库 session.

    driver 缺失时 yield None, 调用方 (service) 通过 try/except 降级到内存.
    """
    _create_engine()
    if _session_factory is None:
        yield None  # type: ignore[misc]
        return
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """初始化数据库 (建表, 仅开发环境用). 生产环境用 alembic 迁移.

    driver 缺失 / DB 不可达时静默跳过, 服务层降级到内存 store.
    """
    if settings.is_production:
        return
    engine = _create_engine()
    if engine is None:
        return  # driver 缺失, 跳过建表 (服务层降级到内存)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:  # 连接失败 (DB 未启动)
        global _driver_error
        _driver_error = exc
        # 引擎不可用, 标记为 None 以便服务层降级
        global _engine, _session_factory
        _engine = None
        _session_factory = None
