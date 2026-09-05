"""APP-02 工人极简登录路由.

端点:
    POST /auth/worker-login   企业码 + 工号 换 7 天 JWT

设计:
    - sub 用 worker_accounts.id (不是 worker_no), 与 spec APP-02 硬约束一致
    - JWT 7 天过期 (settings.WORKER_JWT_EXPIRE_MINUTES)
    - 开发降级: settings.worker_auth_bypass=true 时任意输入返回 mock token;
      APP_ENV=production 时强制关闭 (config.worker_auth_bypass property)
    - DB 不可达 (db is None, 测试/dev 无 PG) 时降级到 WORKERS_SEED 内存查找,
      对齐 project_memory "零机构接入时仍可独立运行"
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import make_ok
from app.config import settings
from app.deps import DbSession, create_access_token
from app.models.eco import WorkerAccountORM
from app.models.enterprise import Enterprise
from app.schemas.common import ApiResult
from app.services.seed import WORKERS_SEED

router = APIRouter(prefix="/auth", tags=["APP-02 工人登录"])


# === schemas (镜像前端 contracts, camelCase 对齐) ===

class WorkerLoginRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_code: str = Field(alias="enterpriseCode", min_length=1, max_length=8)
    worker_no: str = Field(alias="workerNo", min_length=1, max_length=20)


class WorkerLoginResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    token: str
    worker_id: str = Field(alias="workerId")
    enterprise_id: str = Field(alias="enterpriseId")
    role: str = "worker"


# === 内存降级查找 (DB 不可达时用 WORKERS_SEED) ===

def _lookup_worker_in_seed(enterprise_code: str, worker_no: str) -> tuple[str, str] | None:
    """WORKERS_SEED 内存查找. 返回 (worker_id, enterprise_id) 或 None.

    种子格式: workerId="E001-W01", entId="E001". 登录用 enterprise_code="E001",
    worker_no="W01", 组合成 "E001-W01" 校验.
    """
    composed = f"{enterprise_code}-{worker_no}"
    for w in WORKERS_SEED:
        if w["workerId"] == composed and w["entId"] == enterprise_code:
            return composed, enterprise_code
    return None


@router.post("/worker-login", response_model=ApiResult[WorkerLoginResponse], summary="工人极简登录")
async def worker_login(req: WorkerLoginRequest, db: DbSession):
    """企业码 + 工号 换 7 天 JWT.

    sub = worker_accounts.id; role=worker; enterpriseId 附带.
    """
    # 开发降级: 任意输入返回 mock token (生产强制关闭)
    if settings.worker_auth_bypass:
        token = create_access_token(
            {"sub": "W001", "role": "worker", "enterpriseId": "E001", "name": "dev-worker"},
            expires_minutes=settings.WORKER_JWT_EXPIRE_MINUTES,
        )
        data = WorkerLoginResponse(token=token, workerId="W001", enterpriseId="E001")
        return make_ok(data)

    worker_id: str | None = None
    enterprise_id: str | None = None

    # DB 可达: 查 ORM
    if db is not None:
        enterprise = (
            await db.execute(
                select(Enterprise).where(Enterprise.enterprise_code == req.enterprise_code)
            )
        ).scalar_one_or_none()
        if enterprise is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="企业码或工号错误",
            )
        worker = (
            await db.execute(
                select(WorkerAccountORM).where(
                    WorkerAccountORM.worker_no == req.worker_no,
                    WorkerAccountORM.enterprise_id == enterprise.id,
                )
            )
        ).scalar_one_or_none()
        if worker is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="企业码或工号错误",
            )
        worker_id = str(worker.id)
        enterprise_id = str(enterprise.id)
    else:
        # DB 不可达 (测试 / dev 无 PG): 降级到 WORKERS_SEED 内存查找
        found = _lookup_worker_in_seed(req.enterprise_code, req.worker_no)
        if found is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="企业码或工号错误",
            )
        worker_id, enterprise_id = found

    token = create_access_token(
        {"sub": worker_id, "role": "worker", "enterpriseId": enterprise_id, "name": "worker"},
        expires_minutes=settings.WORKER_JWT_EXPIRE_MINUTES,
    )
    data = WorkerLoginResponse(token=token, workerId=worker_id, enterpriseId=enterprise_id)
    return make_ok(data)
