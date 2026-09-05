"""企业 + 金融机构路由.

对齐 contracts/common.ts Enterprise + contracts/eco.ts 金融机构.
端点:
    GET    /enterprises                    列企业
    GET    /enterprises/{enterprise_id}    企业详情
    POST   /enterprises                    创建企业
    PATCH  /enterprises/{enterprise_id}    更新企业
    POST   /enterprises/{enterprise_id}/apply-reform-result  回写改造结果
    GET    /enterprises/{enterprise_id}/financing-check     融资入口锁定检查
    GET    /banks                          列银行
    GET    /guarantors                     列担保公司
    GET    /insurers                        列保险公司
"""

from fastapi import APIRouter, status

from app.api.deps import make_ok
from app.deps import CurrentUser, DbSession
from app.schemas.common import ApiResult
from app.schemas.enterprise import (
    ApplyReformResultInput,
    Enterprise,
    EnterpriseCreate,
    EnterpriseUpdate,
)
from app.services.enterprise_service import EnterpriseService

router = APIRouter(prefix="/enterprises", tags=["企业"])


def _svc(db: DbSession) -> EnterpriseService:
    return EnterpriseService(db=db)


@router.get("", response_model=ApiResult[list[Enterprise]], summary="列企业")
async def list_enterprises(db: DbSession, _user: CurrentUser):
    items = await _svc(db).list_enterprises()
    return make_ok(items)


@router.get("/{enterprise_id}", response_model=ApiResult[Enterprise], summary="企业详情")
async def get_enterprise(enterprise_id: str, db: DbSession, _user: CurrentUser):
    item = await _svc(db).get_enterprise(enterprise_id)
    if not item:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 不存在")
    return make_ok(item)


@router.post("", response_model=ApiResult[Enterprise], status_code=status.HTTP_201_CREATED, summary="创建企业")
async def create_enterprise(payload: EnterpriseCreate, db: DbSession, _user: CurrentUser):
    item = await _svc(db).create_enterprise(payload)
    return make_ok(item)


@router.patch("/{enterprise_id}", response_model=ApiResult[Enterprise], summary="更新企业")
async def update_enterprise(enterprise_id: str, payload: EnterpriseUpdate, db: DbSession, _user: CurrentUser):
    item = await _svc(db).update_enterprise(enterprise_id, payload)
    if not item:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 不存在")
    return make_ok(item)


@router.post("/{enterprise_id}/apply-reform-result", response_model=ApiResult[Enterprise], summary="回写改造结果")
async def apply_reform_result(enterprise_id: str, payload: ApplyReformResultInput, db: DbSession, _user: CurrentUser):
    """project_memory 硬约束: 改造完成后回写 hasReformed / financingUnlocked."""
    item = await _svc(db).apply_reform_result(enterprise_id, payload.model_dump(by_alias=True))
    if not item:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 不存在")
    return make_ok(item)


@router.post("/{enterprise_id}/reset-reform", response_model=ApiResult[Enterprise], summary="重置改造状态")
async def reset_reform(enterprise_id: str, db: DbSession, _user: CurrentUser):
    """project_memory: 同步清零 hasReformed/reformedAt/afterLevel 等."""
    item = await _svc(db).reset_reform(enterprise_id)
    if not item:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 不存在")
    return make_ok(item)


@router.get("/{enterprise_id}/financing-check", response_model=ApiResult[dict], summary="融资入口锁定检查")
async def financing_check(enterprise_id: str, db: DbSession, _user: CurrentUser):
    """路由守卫: 检查企业是否已解锁融资入口."""
    result = await _svc(db).check_financing_unlocked(enterprise_id)
    return make_ok(result)


# === 金融机构 ===

banks_router = APIRouter(prefix="/banks", tags=["金融机构"])


@banks_router.get("", response_model=ApiResult[list[dict]], summary="列银行")
async def list_banks(db: DbSession, _user: CurrentUser):
    items = await _svc(db).list_banks()
    return make_ok(items)


guarantors_router = APIRouter(prefix="/guarantors", tags=["金融机构"])


@guarantors_router.get("", response_model=ApiResult[list[dict]], summary="列担保公司")
async def list_guarantors(db: DbSession, _user: CurrentUser):
    items = await _svc(db).list_guarantors()
    return make_ok(items)


insurers_router = APIRouter(prefix="/insurers", tags=["金融机构"])


@insurers_router.get("", response_model=ApiResult[list[dict]], summary="列保险公司")
async def list_insurers(db: DbSession, _user: CurrentUser):
    items = await _svc(db).list_insurers()
    return make_ok(items)
