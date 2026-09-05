"""供应链金融 (SCF) API 路由 — Tab11 SCF 工作台.

端点 (prefix=/scf):
    POST   /scf/pricing                  SC6 综合定价
    POST   /scf/risk-propagation         SC7 风险扩散
    POST   /scf/match                    SC8 撮合 top-K
    GET    /scf/alerts                   SC9 履约监控告警列表
    GET    /scf/cases                    SC10 案例库列表 (支持 ?industry=&product=&scale=&result=&keyword=)
    POST   /scf/cases                    SC10 沉淀新案例
    GET    /scf/scenarios                列出 4 个场景预设
    POST   /scf/scenarios/{scenario_id}/load    加载场景预设
    POST   /scf/sync-from-reform         SCF-09 接收 reform 完成事件

project_memory 硬约束:
    - 全部用 make_ok 包装响应
    - 全部用 CurrentUser 依赖 (app.deps.CurrentUser)
    - response_model 用 ApiResult[...] 形式
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.scf import (
    CaseOutcome,
    CaseQuery,
    CaseRecord,
    MatchInput,
    MatchOutput,
    PricingInput,
    PricingOutput,
    ReformSyncEvent,
    ReformSyncResult,
    RiskPropagationInput,
    RiskPropagationOutput,
    ScenarioId,
    ScfIndustry,
    ScfProduct,
    SCFScenario,
)
from app.services.scf_service import scf_service

router = APIRouter(prefix="/scf", tags=["Tab11 供应链金融"])


# ============================================================================
# SC6 定价
# ============================================================================

@router.post("/pricing", response_model=ApiResult[PricingOutput], summary="SC6 综合定价计算")
async def pricing(payload: PricingInput, _user: CurrentUser):
    """根据信用分/行业/担保方式/期限计算综合利率 (LPR + 风险溢价 - 担保抵扣)."""
    result = await scf_service.pricing(payload)
    return make_ok(result)


# ============================================================================
# SC7 风险扩散
# ============================================================================

@router.post("/risk-propagation", response_model=ApiResult[RiskPropagationOutput], summary="SC7 风险扩散")
async def risk_propagation(payload: RiskPropagationInput, _user: CurrentUser):
    """给定核心企业, 向上下游 N 跳传播风险 (应收账款变坏账 + 预付款损失)."""
    result = await scf_service.propagate_risk(payload)
    return make_ok(result)


# ============================================================================
# SC8 撮合
# ============================================================================

@router.post("/match", response_model=ApiResult[MatchOutput], summary="SC8 双向撮合")
async def match(payload: MatchInput, _user: CurrentUser):
    """企业融资需求与银行资金供给双向匹配 (信用+期限+担保偏好), 返回 top-K 候选."""
    result = await scf_service.match(payload)
    return make_ok(result)


# ============================================================================
# SC9 履约监控
# ============================================================================

@router.get("/alerts", response_model=ApiResult[dict], summary="SC9 履约监控告警列表")
async def list_alerts(_user: CurrentUser):
    """红黄绿灯告警列表 + 汇总统计."""
    alerts, summary = await scf_service.list_alerts()
    return make_ok({
        "alerts": [a.model_dump(by_alias=True) for a in alerts],
        "summary": summary.model_dump(by_alias=True),
    })


# ============================================================================
# SC10 案例库
# ============================================================================

@router.get("/cases", response_model=ApiResult[list[CaseRecord]], summary="SC10 案例库列表")
async def list_cases(
    _user: CurrentUser,
    industry: ScfIndustry | None = Query(default=None, description="行业筛选"),
    product: ScfProduct | None = Query(default=None, description="产品筛选"),
    scale: str | None = Query(default=None, description="规模筛选: micro/small/medium/large"),
    result: CaseOutcome | None = Query(default=None, alias="result", description="结果筛选: success/failed/partial"),
    keyword: str | None = Query(default=None, description="关键词模糊匹配 summary/tags"),
):
    """按 行业/产品/规模/结果 + 关键词 检索案例库."""
    query = CaseQuery(
        industry=industry, product=product,
        scale=scale,  # type: ignore[arg-type]
        outcome=result, keyword=keyword,
    )
    cases = await scf_service.list_cases(query)
    return make_ok([c.model_dump(by_alias=True) for c in cases])


@router.post("/cases", response_model=ApiResult[CaseRecord], status_code=status.HTTP_201_CREATED, summary="SC10 沉淀新案例")
async def save_case(payload: CaseRecord, _user: CurrentUser):
    """沉淀成功/失败案例到案例库."""
    result = await scf_service.save_case(payload)
    return make_ok(result)


# ============================================================================
# 场景预设 (SCF-08)
# ============================================================================

@router.get("/scenarios", response_model=ApiResult[list[SCFScenario]], summary="列出场景预设")
async def list_scenarios(_user: CurrentUser):
    """4 个场景预设: 反向保理 / 存货质押 / 应收账款转让 / 票据贴现."""
    scenarios = await scf_service.list_scenarios()
    return make_ok([s.model_dump(by_alias=True) for s in scenarios])


@router.post("/scenarios/{scenario_id}/load", response_model=ApiResult[SCFScenario], summary="加载场景预设")
async def load_scenario(scenario_id: ScenarioId, _user: CurrentUser):
    """加载场景预设, 返回 prefill 字段供前端自动填表."""
    result = await scf_service.load_scenario(scenario_id)
    if not result:
        return make_ok(None, code=404, message=f"场景预设 {scenario_id} 不存在")
    return make_ok(result.model_dump(by_alias=True))


# ============================================================================
# SCF ↔ Reform 联动 (SCF-09)
# ============================================================================

@router.post("/sync-from-reform", response_model=ApiResult[ReformSyncResult], summary="接收 reform 完成事件")
async def sync_from_reform(payload: ReformSyncEvent, _user: CurrentUser):
    """接收 reform R10 完成事件, 触发 SC1 画像刷新 + SC8 撮合重算."""
    try:
        result = await scf_service.sync_from_reform(payload)
        return make_ok(result)
    except Exception as e:
        return make_ok(None, code=-1, message=f"联动失败: {e}")
