"""ECO-06 积分商城与行为挖矿路由.

端点:
    POST   /eco-pts/award            发放行为挖矿积分 (含防刷分)
    GET    /eco-pts/shop              列商品库
    POST   /eco-pts/orders            下单兑换
    GET    /eco-pts/orders            列订单 (可选 workerId)
    GET    /eco-pts/workers/{wid}     查工人账户
    GET    /eco-pts/cooperation       物流端配合度 (可选 enterpriseId)
"""

import time as _time
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Request, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    AwardPointsInput, AwardPointsResult, CooperationRateResult,
    ExchangeOrder, PlaceOrderInput, ShopItem, WorkerAccount,
)
from app.services.eco_service import eco_pts_service

router = APIRouter(prefix="/eco-pts", tags=["ECO-06 积分商城"])


@router.post("/award", response_model=ApiResult[AwardPointsResult], summary="发放行为挖矿积分")
async def award_points(
    payload: AwardPointsInput,
    request: Request,
    background_tasks: BackgroundTasks,
    _user: CurrentUser,
):
    """防刷分: 5 分钟内同物料不重发. 三种余额: 信用/碳/信易分.

    APP-02 Task 11: 移动端 PWA 调用且 evidence + location 完整时, 异步上链 (BackgroundTasks),
    响应立即返回 (chainTxHash 永远 null, 不等待链上回执).
    PC 端调用 (无 evidence/location) 自动跳过上链, 向后兼容.
    """
    from app.services.eco_service import logger

    try:
        result = await eco_pts_service.awardPoints(payload)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))

    # APP-02 Task 11: 异步上链触发条件
    # X-Client-Type 头判断移动端 (前端代理 C 已用 X-Client-Type 替代 User-Agent)
    client_type = (
        request.headers.get("x-client-type")
        or request.headers.get("X-Client-Type")
        or ""
    )
    is_mobile = client_type.startswith("MobilePWA") or payload.from_mobile is True
    has_evidence = payload.material_id is not None and payload.photo_hash is not None
    has_location = payload.location is not None
    fraud_blocked = result.fraud_blocked is True

    if not fraud_blocked and has_evidence and has_location and is_mobile:
        award_id = f"award-{uuid4().hex[:12]}"
        award_record = {
            "awardId": award_id,
            "workerId": payload.worker_id,
            "materialId": payload.material_id or "",
            "photoHash": payload.photo_hash or "",
            "timestamp": int(_time.time()),
            "location": payload.location or {},
        }
        background_tasks.add_task(eco_pts_service.stamp_award_evidence, award_record)
        logger.info(
            f"mobile award scheduled stamp: worker={payload.worker_id} award_id={award_id}"
        )
    else:
        logger.info(
            f"award skipped stamp: worker={payload.worker_id} mobile={is_mobile} "
            f"evidence={has_evidence} location={has_location} fraud={fraud_blocked}"
        )

    # 响应立即返回 (chainTxHash 永远先 null, 后台异步上链不阻塞主流程)
    return make_ok(result)


@router.get("/shop", response_model=ApiResult[list[ShopItem]], summary="列商品库")
async def list_shop(_user: CurrentUser):
    result = await eco_pts_service.listShop()
    return make_ok(result)


@router.post("/orders", response_model=ApiResult[ExchangeOrder], status_code=status.HTTP_201_CREATED, summary="下单兑换")
async def place_order(payload: PlaceOrderInput, _user: CurrentUser):
    try:
        result = await eco_pts_service.placeOrder(payload)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.get("/orders", response_model=ApiResult[list[ExchangeOrder]], summary="列订单")
async def list_orders(
    worker_id: str,
    page: int = 1,
    page_size: int = 20,
    _user: CurrentUser = None,
):
    """APP-02 移动端 PWA: 列订单, 必传 workerId, 支持分页 (snake_case, 与前端 client.ts 对齐).

    分页参数:
        page: 页码 (1-based, 默认 1)
        page_size: 每页条数 (默认 20, 上限 100)

    缺失 workerId 时 FastAPI 自动返回 422 (Required field).
    """
    result = await eco_pts_service.listOrders(worker_id, page=page, page_size=page_size)
    return make_ok(result)


@router.get("/workers/{worker_id}", response_model=ApiResult[WorkerAccount], summary="查工人账户")
async def get_worker(worker_id: str, _user: CurrentUser):
    result = await eco_pts_service.getWorker(worker_id)
    if not result:
        return make_ok(None, code=404, message=f"工人 {worker_id} 不存在")
    return make_ok(result)


@router.get("/cooperation", response_model=ApiResult[CooperationRateResult], summary="物流端配合度")
async def cooperation_rate(enterprise_id: str | None = None, _user: CurrentUser = None):
    """基线 10% → 目标 90%, 月度成本控制 30-50 元/人."""
    result = await eco_pts_service.cooperationRate(enterprise_id)
    return make_ok(result)
