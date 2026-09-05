"""ECO-05 反向竞拍融资大厅路由.

端点:
    POST   /eco-bid/tenders                  发布标书
    GET    /eco-bid/tenders                   列标书 (可选 enterpriseId 过滤)
    GET    /eco-bid/tenders/{tid}             标书详情
    GET    /eco-bid/tenders/{tid}/bids        列标书出价
    POST   /eco-bid/tenders/{tid}/bids        提交出价 (含多头防控 + 串通报价检测)
    POST   /eco-bid/tenders/{tid}/award       中标 (综合成本排序)
    GET    /eco-bid/multi-head/{eid}           多头防控检查
"""

from fastapi import APIRouter, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    BankBid, BidSubmitInput, MultiHeadCheckResult, Tender, TenderPublishInput,
)
from app.services.eco_service import eco_bid_service

router = APIRouter(prefix="/eco-bid", tags=["ECO-05 反向竞拍"])


@router.post("/tenders", response_model=ApiResult[Tender], status_code=status.HTTP_201_CREATED, summary="发布标书")
async def publish_tender(payload: TenderPublishInput, _user: CurrentUser):
    result = await eco_bid_service.publishTender(payload)
    return make_ok(result)


@router.get("/tenders", response_model=ApiResult[list[Tender]], summary="列标书")
async def list_tenders(enterprise_id: str | None = None, _user: CurrentUser = None):
    result = await eco_bid_service.listTenders(enterprise_id)
    return make_ok(result)


@router.get("/tenders/{tender_id}", response_model=ApiResult[Tender], summary="标书详情")
async def get_tender(tender_id: str, _user: CurrentUser):
    tenders = await eco_bid_service.listTenders()
    t = next((t for t in tenders if t.tender_id == tender_id), None)
    if not t:
        return make_ok(None, code=404, message=f"标书 {tender_id} 不存在")
    return make_ok(t)


@router.get("/tenders/{tender_id}/bids", response_model=ApiResult[list[BankBid]], summary="列标书出价")
async def list_bids(tender_id: str, _user: CurrentUser):
    result = await eco_bid_service.getBids(tender_id)
    return make_ok(result)


@router.post("/tenders/{tender_id}/bids", response_model=ApiResult[BankBid], status_code=status.HTTP_201_CREATED, summary="提交出价")
async def submit_bid(tender_id: str, payload: BidSubmitInput, _user: CurrentUser):
    """含多头防控 + 串通报价检测 (利率容差 0.01% + 集团关联)."""
    payload.tender_id = tender_id
    try:
        result = await eco_bid_service.submitBid(payload)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.post("/tenders/{tender_id}/award", response_model=ApiResult[dict], summary="中标")
async def award_tender(tender_id: str, _user: CurrentUser):
    """综合成本排序: 利率 60% + 额度 20% + 时效 20%."""
    try:
        result = await eco_bid_service.awardTender(tender_id)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.get("/multi-head/{enterprise_id}", response_model=ApiResult[MultiHeadCheckResult], summary="多头防控检查")
async def multi_head_check(enterprise_id: str, new_amount: int = 0, _user: CurrentUser = None):
    """累计授信 ≤ 5 倍净资产."""
    result = await eco_bid_service.multiHeadCheck(enterprise_id, new_amount)
    return make_ok(result)
