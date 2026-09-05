"""银行信任培育期渐进解锁 API 路由 (CORE-01b).

端点 (prefix=/bank):
    GET    /bank                                 列出所有银行
    GET    /bank/{bank_id}/trust-profile          银行信任档案
    POST   /bank/{bank_id}/upgrade-stage          升级信任阶段
    GET    /bank/{bank_id}/risk-letters           风险提示函列表 (可选 ?enterprise_id=)
    POST   /bank/{bank_id}/risk-letters           生成风险提示函
    GET    /bank/{bank_id}/decisions              决策日志
    POST   /bank/{bank_id}/decisions              提交决策
    GET    /bank/{bank_id}/statistics             统计数据
    GET    /bank/{bank_id}/supervision-accounts   监管账户列表 (APP-01 端点 11)
    POST   /bank/{bank_id}/freeze-account         冻结/解冻监管账户 (APP-01 端点 10)
    POST   /bank/{bank_id}/credit-multiplier      调整授信乘数 (APP-01 端点 9)

响应全部用 make_ok 包装, response_model 使用 ApiResult[T].
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.bank import (
    BankDecision,
    BankDecisionCreate,
    BankListItem,
    BankStatistics,
    BankTrustProfile,
    CreditMultiplierPayload,
    CreditMultiplierResult,
    FreezeAccountPayload,
    FreezeAccountResult,
    RiskLetter,
    RiskLetterCreate,
    StageUpgradeResult,
    SupervisionAccount,
)
from app.schemas.common import ApiResult
from app.services.bank_service import BankService

bank_router = APIRouter(prefix="/bank", tags=["银行信任培育 (CORE-01b)"])


def _svc() -> BankService:
    return BankService(db=None)


# ============================================================================
# 1. 列出所有银行
# ============================================================================

@bank_router.get("", response_model=ApiResult[list[BankListItem]], summary="列出所有银行")
async def list_banks(_user: CurrentUser):
    """列出所有银行 (含信任阶段, 供银行切换选择)."""
    items = await _svc().list_banks()
    return make_ok(items)


# ============================================================================
# 2. 银行信任档案
# ============================================================================

@bank_router.get(
    "/{bank_id}/trust-profile",
    response_model=ApiResult[BankTrustProfile],
    summary="银行信任档案",
)
async def get_trust_profile(bank_id: str, _user: CurrentUser):
    """获取银行信任档案 (4 阶段 + 转化率 + 解锁进度)."""
    profile = await _svc().get_trust_profile(bank_id)
    if not profile:
        return make_ok(None, code=404, message=f"银行 {bank_id} 不存在")
    return make_ok(profile)


# ============================================================================
# 3. 升级信任阶段
# ============================================================================

@bank_router.post(
    "/{bank_id}/upgrade-stage",
    response_model=ApiResult[StageUpgradeResult],
    summary="升级信任阶段",
)
async def upgrade_stage(bank_id: str, _user: CurrentUser):
    """升级信任阶段 (需满足接入月数/决策数/转化率三阈值)."""
    result = await _svc().upgrade_stage(bank_id)
    return make_ok(result)


# ============================================================================
# 4. 风险提示函列表
# ============================================================================

@bank_router.get(
    "/{bank_id}/risk-letters",
    response_model=ApiResult[list[RiskLetter]],
    summary="风险提示函列表",
)
async def list_risk_letters(
    bank_id: str,
    enterprise_id: str | None = Query(default=None, alias="enterpriseId", description="按企业筛选"),
    _user: CurrentUser = None,
):
    """风险提示函列表 (L4 培育期 AI 唯一输出, 可按企业筛选)."""
    items = await _svc().list_risk_letters(bank_id, enterprise_id)
    return make_ok(items)


# ============================================================================
# 5. 生成风险提示函
# ============================================================================

@bank_router.post(
    "/{bank_id}/risk-letters",
    response_model=ApiResult[RiskLetter],
    status_code=status.HTTP_201_CREATED,
    summary="生成风险提示函",
)
async def generate_risk_letter(
    bank_id: str, payload: RiskLetterCreate, _user: CurrentUser,
):
    """生成风险提示函 (L4 培育期零拦截)."""
    letter = await _svc().generate_risk_letter(
        bank_id=bank_id,
        enterprise_id=payload.enterprise_id,
        risk_level=payload.risk_level,
        summary=payload.summary,
        recommendations=payload.recommendations,
        enterprise_name=payload.enterprise_name,
    )
    return make_ok(letter)


# ============================================================================
# 6. 决策日志
# ============================================================================

@bank_router.get(
    "/{bank_id}/decisions",
    response_model=ApiResult[list[BankDecision]],
    summary="决策日志",
)
async def list_decisions(bank_id: str, _user: CurrentUser):
    """列出银行决策日志 (AI 建议 vs 银行最终决策)."""
    items = await _svc().list_decisions(bank_id)
    return make_ok(items)


# ============================================================================
# 7. 提交决策
# ============================================================================

@bank_router.post(
    "/{bank_id}/decisions",
    response_model=ApiResult[BankDecision],
    status_code=status.HTTP_201_CREATED,
    summary="提交决策",
)
async def submit_decision(
    bank_id: str, payload: BankDecisionCreate, _user: CurrentUser,
):
    """提交银行决策 (根据当前信任阶段自动判定 autoHandled)."""
    decision = await _svc().submit_decision(
        bank_id=bank_id,
        enterprise_id=payload.enterprise_id,
        amount=payload.amount,
        ai_recommendation=payload.ai_recommendation,
        bank_final_decision=payload.bank_final_decision,
        enterprise_name=payload.enterprise_name,
        reason=payload.reason,
    )
    return make_ok(decision)


# ============================================================================
# 8. 统计数据
# ============================================================================

@bank_router.get(
    "/{bank_id}/statistics",
    response_model=ApiResult[BankStatistics],
    summary="统计数据",
)
async def get_statistics(bank_id: str, _user: CurrentUser):
    """银行统计数据 (总笔数/自动通过/人工通过/拒绝/总额)."""
    stats = await _svc().get_statistics(bank_id)
    return make_ok(stats)


# ============================================================================
# 9. 调整授信乘数 (APP-01 端点 9, C档独立兜底)
# ============================================================================

@bank_router.post(
    "/{bank_id}/credit-multiplier",
    response_model=ApiResult[CreditMultiplierResult],
    summary="调整授信乘数 (APP-01)",
)
async def adjust_credit_multiplier(
    bank_id: str, payload: CreditMultiplierPayload, _user: CurrentUser,
):
    """调整银行授信乘数 (C档兜底: 内存存储, 重启丢失).

    入参: multiplier (0.1-5.0), reason (审计用).
    返回: 新/旧授信额度 (分) + 应用后乘数 + 操作时间.
    """
    result = await _svc().adjust_credit_multiplier(
        bank_id=bank_id,
        multiplier=payload.multiplier,
        reason=payload.reason,
    )
    return make_ok(result)


# ============================================================================
# 10. 冻结/解冻监管账户 (APP-01 端点 10, C档独立兜底)
# ============================================================================

@bank_router.post(
    "/{bank_id}/freeze-account",
    response_model=ApiResult[FreezeAccountResult],
    summary="冻结/解冻监管账户 (APP-01)",
)
async def freeze_account(
    bank_id: str, payload: FreezeAccountPayload, _user: CurrentUser,
):
    """冻结/解冻监管账户 (C档兜底: 内存存储).

    入参 body: accountId (目标账户), freeze (true=冻结/false=解冻), reason (审计).
    账户不存在时返回 404.
    """
    try:
        result = await _svc().freeze_account(
            bank_id=bank_id,
            account_id=payload.account_id,
            freeze=payload.freeze,
            reason=payload.reason,
        )
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from None
    return make_ok(result)


# ============================================================================
# 11. 监管账户列表 (APP-01 端点 11, C档独立兜底)
# ============================================================================

@bank_router.get(
    "/{bank_id}/supervision-accounts",
    response_model=ApiResult[list[SupervisionAccount]],
    summary="监管账户列表 (APP-01)",
)
async def list_supervision_accounts(bank_id: str, _user: CurrentUser):
    """列出银行监管账户 (C档兜底: 内存存储).

    返回: SupervisionAccount[] (脱敏账户号/状态/余额/关联企业).
    未注册银行返回空数组 (不报错, 让前端展示空态).
    """
    items = await _svc().list_supervision_accounts(bank_id)
    return make_ok(items)
