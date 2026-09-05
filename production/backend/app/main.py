"""FinTrust Hub 后端 FastAPI 入口.

设计依据: spec.md L3495-3525 技术栈总览 (后端 Python FastAPI + Java Spring Cloud).
职责:
    1. 创建 FastAPI 应用 (标题 / 版本 / 文档)
    2. 注册中间件 (CORS / GZip / RequestId)
    3. 注册路由 (v1 API: enterprises / reform / banks / eco/*)
    4. 异常处理 (统一 ApiResult 包装, project_memory: 业务 code 非 0)
    5. 启动事件 (init_db / Kafka consumer / Temporal worker)
"""

import os
from contextlib import asynccontextmanager
from datetime import UTC

import orjson
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import text

from app.api.v1.router import api_router
from app.config import settings
from app.database import get_engine, init_db

# === 日志初始化 ===

logger.remove()
logger.add(
    sink=lambda msg: print(msg, end=""),
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | "
    "<cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="DEBUG" if settings.APP_DEBUG else "INFO",
    colorize=True,
)
logger.add(
    "logs/fintrust-{time:YYYY-MM-DD}.log",
    rotation="00:00",
    retention="30 days",
    level="INFO",
    compression="zip",
    serialize=True,
)


# === 异常基类 (业务侧抛出, 由全局 handler 包装) ===

class BusinessError(Exception):
    def __init__(self, message: str, code: int = -1, status_code: int = 400):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


# === 生命周期 ===

async def _run_dev_migrations() -> None:
    """执行 app/migrations/*.sql (仅 dev 环境, 幂等).

    逐文件 try/except, 单条 SQL 失败 (如 SQLite 不支持 IF NOT EXISTS) 仅记 warning,
    不阻断启动. 对齐 project_memory "零机构接入时仍可独立运行".
    """
    engine = get_engine()
    if engine is None:
        return  # driver 缺失, 跳过
    migrations_dir = os.path.join(os.path.dirname(__file__), "migrations")
    if not os.path.isdir(migrations_dir):
        return
    try:
        async with engine.begin() as conn:
            for sql_file in sorted(os.listdir(migrations_dir)):
                if not sql_file.endswith(".sql"):
                    continue
                path = os.path.join(migrations_dir, sql_file)
                try:
                    with open(path, encoding="utf-8") as f:
                        sql_text = f.read()
                    # 整文件执行 (PG 支持多语句); 失败则降级到单条逐句执行
                    try:
                        await conn.execute(text(sql_text))
                    except Exception:
                        for stmt in [s.strip() for s in sql_text.split(";") if s.strip() and not s.strip().startswith("--")]:
                            try:
                                await conn.execute(text(stmt))
                            except Exception as e:
                                logger.warning(f"migration stmt skipped ({sql_file}): {e}")
                    logger.info(f"applied migration: {sql_file}")
                except Exception as exc:
                    logger.warning(f"migration {sql_file} skipped: {exc}")
    except Exception as exc:
        # DB 不可达时降级, 不阻断启动 (遵循 project_memory "外部依赖不可达不阻塞业务")
        logger.warning(f"_run_dev_migrations skipped (DB unreachable, degraded): {exc}")


def _init_stamp_scheduler():
    """APP-02 Task 11.3: 初始化 APScheduler (AsyncIOScheduler) 异步上链重试任务.

    每 10 分钟扫描 stamp_retry_queue (内存 + DB), status='pending' AND retry_count<3,
    调用 chain_service.put_evidence() 重试, 成功 → done, 失败 → retry_count+=1,
    3 次失败 → abandoned. apscheduler 未安装时降级跳过 (不阻断启动).
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
    except ImportError:
        logger.warning("apscheduler 未安装, stamp_retry 调度器跳过 (APP-02 Task 11.3 降级)")
        return None

    scheduler = AsyncIOScheduler()

    async def _retry_stamp_queue() -> None:
        """重试任务: 扫描内存队列 + DB 队列 (DB 不可达时降级)."""
        try:
            from app.services.eco_service import eco_pts_service
            # 1) 内存队列 (dev / 测试路径, conftest 把 get_db 覆盖为 None)
            drained = eco_pts_service.drain_in_memory_retry_queue()
            for entry in drained:
                ok = await eco_pts_service.retry_stamp_once(entry)
                if ok:
                    logger.info(
                        f"stamp retry success (in-memory): award_id={entry.get('award_id')}"
                    )
                else:
                    entry["retry_count"] = int(entry.get("retry_count", 0)) + 1
                    if entry["retry_count"] >= 3:
                        entry["status"] = "abandoned"
                        logger.warning(
                            f"stamp retry abandoned after 3 failures: award_id={entry.get('award_id')}"
                        )
                    else:
                        # 重新入队等待下次扫描
                        entry["status"] = "pending"
                        if not hasattr(eco_pts_service, "_retry_queue_mem"):
                            eco_pts_service._retry_queue_mem = []
                        eco_pts_service._retry_queue_mem.append(entry)

            # 2) DB 队列 (生产路径, 仅当 DB 可达时)
            try:
                from datetime import datetime

                from sqlalchemy import select

                from app.database import get_engine
                from app.models.eco import StampRetryQueueORM

                engine = get_engine()
                if engine is not None:
                    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
                    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                    async with factory() as db:
                        datetime.now(UTC)
                        stmt = (
                            select(StampRetryQueueORM)
                            .where(
                                StampRetryQueueORM.status == "pending",
                                StampRetryQueueORM.retry_count < 3,
                            )
                            .order_by(StampRetryQueueORM.next_retry_at)
                            .limit(100)
                        )
                        result = await db.execute(stmt)
                        for row in result.scalars():
                            ok = await eco_pts_service.retry_stamp_once({
                                "award_id": row.award_id,
                                "evidence_hash": row.evidence_hash,
                            })
                            if ok:
                                row.status = "done"
                            else:
                                row.retry_count = (row.retry_count or 0) + 1
                                from datetime import timedelta
                                row.next_retry_at = datetime.now(UTC) + timedelta(minutes=10)
                                if row.retry_count >= 3:
                                    row.status = "abandoned"
                        await db.commit()
            except Exception as e:
                logger.warning(f"stamp retry DB scan skipped (degraded): {e}")
        except Exception as e:
            logger.warning(f"_retry_stamp_queue failed: {e}")

    scheduler.add_job(
        _retry_stamp_queue,
        "interval",
        minutes=10,
        id="stamp_retry",
        max_instances=1,
        coalesce=True,
    )
    try:
        scheduler.start()
        logger.info("APScheduler 已启动 (stamp_retry 每 10 分钟扫描)")
    except Exception as exc:
        logger.warning(f"APScheduler 启动失败, stamp_retry 调度跳过: {exc}")
        return None
    return scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期 (启动 / 关闭).

    降级原则 (遵循 project_memory "零机构接入时仍可独立运行"):
        - DB / Redis / ClickHouse / Kafka / Temporal 任一不可达, 仅记 warning 不阻断启动
        - 服务层通过懒加载 + try/except 降级到内存 mock
    """
    logger.info(f"启动 {settings.APP_NAME} v{settings.APP_VERSION} ({settings.APP_ENV})")

    # 启动时初始化数据库 (开发环境)
    if settings.APP_DEBUG:
        await init_db()
        logger.info("数据库初始化完成 (开发模式 create_all)")
        # APP-02: 自动执行 SQL 迁移 (dev 环境, 添加 enterprise_code / worker_no 等列)
        await _run_dev_migrations()

    # Redis 连接池 (缓存/限流/会话, 不可达时降级到无缓存)
    from app.services.redis_client import get_redis_error, init_redis
    await init_redis()
    if get_redis_error() is None:
        logger.info("Redis 连接池已建立")
    else:
        logger.warning(f"Redis 连接失败, 降级到无缓存: {get_redis_error()}")

    # ClickHouse 客户端 (时序指标, 不可达时降级到 PG/内存)
    try:
        from app.services import clickhouse_client
        await clickhouse_client.init_clickhouse()
        if clickhouse_client.get_clickhouse_error() is None:
            logger.info("ClickHouse 客户端已建立")
        else:
            logger.warning(
                f"ClickHouse 连接失败, 时序指标降级到 PG/内存: {clickhouse_client.get_clickhouse_error()}"
            )
    except ImportError:
        logger.warning("clickhouse_connect 未安装, 时序指标功能禁用")
    except Exception as exc:
        logger.warning(f"ClickHouse 初始化异常: {exc}")

    # Kafka consumer / Temporal worker: 路线图项, 启动条件未就绪时跳过
    # 真实接入见 docs/P1_ROADMAP_TECH_IMPL.md
    logger.info("Kafka consumer / Temporal worker 未启动 (路线图项, 见 P1_ROADMAP_TECH_IMPL.md)")

    # APP-02 Task 11.3: APScheduler 异步上链重试任务 (每 10 分钟扫描, 3 次失败放弃)
    scheduler = _init_stamp_scheduler()

    yield

    # 关闭
    logger.info(f"关闭 {settings.APP_NAME}")
    if scheduler is not None:
        try:
            scheduler.shutdown(wait=False)
            logger.info("APScheduler 已关闭 (stamp_retry)")
        except Exception as exc:
            logger.warning(f"APScheduler 关闭异常: {exc}")
    from app.services.redis_client import close_redis
    await close_redis()
    try:
        from app.services import clickhouse_client
        await clickhouse_client.close_clickhouse()
    except (ImportError, Exception):
        pass
    # 关闭 SQLAlchemy 引擎连接池
    from app.database import get_engine
    engine = get_engine()
    if engine is not None:
        await engine.dispose()
        logger.info("SQLAlchemy 引擎连接池已关闭")


# === FastAPI 实例 ===

app = FastAPI(
    title="FinTrust Hub API",
    description="企业改造与融资撮合信任枢纽 - API 文档 (前端契约对齐 ../contracts/*.ts)",
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    default_response_class=JSONResponse,
    lifespan=lifespan,
)


# === 中间件 ===

# CORS (前端 Vite 代理 /api 时也生效)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip 压缩 (大于 1000 字节)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# === 自定义 JSON 响应 (orjson 加速) ===

class ORJSONResponse(JSONResponse):
    def __init__(self, content, status_code: int = 200, headers=None):
        super().__init__(
            content=content,
            status_code=status_code,
            headers=headers,
            media_type="application/json",
        )

    def render(self, content) -> bytes:
        return orjson.dumps(content, default=str)


# === 统一响应包装 (project_memory: ApiResult<T> {code, message, data, requestId, timestamp}) ===

def make_response(data, code: int = 0, message: str = "OK", request_id: str = ""):
    """构造统一响应体."""
    from datetime import datetime
    return {
        "code": code,
        "message": message,
        "data": data,
        "requestId": request_id or f"req-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# === 全局异常处理 ===

@app.exception_handler(BusinessError)
async def business_error_handler(request: Request, exc: BusinessError):
    request_id = request.headers.get("X-Request-Id", "")
    logger.warning(f"业务错误 [{exc.code}] {exc.message} (req={request_id})")
    return JSONResponse(
        status_code=exc.status_code,
        content=make_response(None, code=exc.code, message=exc.message, request_id=request_id),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = request.headers.get("X-Request-Id", "")
    logger.exception(f"未处理异常 (req={request_id}): {exc}")
    return JSONResponse(
        status_code=500,
        content=make_response(
            None,
            code=500,
            message="服务异常, 请稍后重试或联系顾问" if settings.is_production else str(exc),
            request_id=request_id,
        ),
    )


# === 健康检查 ===

@app.get("/health", tags=["meta"])
async def health():
    """健康检查 (K8s liveness / readiness probe)."""
    return make_response({
        "status": "ok",
        "version": settings.APP_VERSION,
        "env": settings.APP_ENV,
    })


# === 路由挂载 ===

app.include_router(api_router, prefix="/api")


# === 根路由 ===

@app.get("/", tags=["meta"])
async def root():
    return make_response({
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/api/docs",
        "health": "/health",
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_DEBUG,
        log_level="debug" if settings.APP_DEBUG else "info",
    )
