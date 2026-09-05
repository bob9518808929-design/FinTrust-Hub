"""银企直连 DATA-01 schemas (R1.1).

字段命名: snake_case (PEP 8), alias_generator=to_camel 自动转 camelCase.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, ApiResult, Id, IsoTimestamp


class _BankAggBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class BankAdapterInfo(_BankAggBase):
    adapter_id: Id = Field(description="适配器 ID")
    bank_name: str = Field(description="银行名称")
    adapter_status: Literal["online", "degraded", "offline"] = Field(description="适配器状态")
    auth_protocol: Literal["oauth2", "direct_login", "api_key"] = Field(description="认证协议")
    supports_oauth2: bool = Field(description="是否支持 OAuth2")


class OAuthAuthorizationRequest(_BankAggBase):
    enterprise_id: Id = Field(description="企业 ID")
    adapter_id: Id = Field(description="适配器 ID")
    state: str = Field(default="", description="防重放 state (可由后端自动生成)")
    redirect_uri: str = Field(description="OAuth 回调地址")
    scopes: list[str] = Field(default_factory=list, description="请求权限范围")


class OAuthAuthorizationResponse(_BankAggBase):
    authorization_url: str = Field(description="跳转授权 URL")


class OAuthTokenResult(_BankAggBase):
    access_token: str = Field(description="访问令牌")
    refresh_token: str = Field(description="刷新令牌")
    expires_at: IsoTimestamp = Field(description="过期时间 (ISO 8601)")
    enterprise_id: Id = Field(description="企业 ID")
    adapter_id: Id = Field(description="适配器 ID")


class BankAccount(_BankAggBase):
    account_id: Id = Field(description="账户 ID")
    account_no_masked: str = Field(description="脱敏账户号")
    account_type: Literal["basic", "general", "special", "loan"] = Field(description="账户类型")
    balance_cents: AmountInCents = Field(description="账户余额 (分)")
    currency: str = Field(default="CNY", description="币种")
    enterprise_id: Id = Field(description="企业 ID")
    adapter_id: Id = Field(description="适配器 ID")


TxDirection = Literal["in", "out"]


class BankTransaction(_BankAggBase):
    tx_id: Id = Field(description="交易 ID")
    account_id: Id = Field(description="所属账户 ID")
    amount_cents: AmountInCents = Field(description="交易金额 (分)")
    direction: TxDirection = Field(description="资金方向 in=收入 out=支出")
    counterparty_name: str = Field(description="对手方名称")
    counterparty_account: str = Field(description="对手方账户 (脱敏)")
    purpose: str = Field(description="交易用途/摘要")
    tx_time_iso: IsoTimestamp = Field(description="交易时间 (ISO 8601)")
    enterprise_id: Id = Field(description="企业 ID")
    adapter_id: Id = Field(description="适配器 ID")


class AdapterRefreshResult(_BankAggBase):
    success: bool = Field(description="该适配器是否刷新成功")
    message: str = Field(default="", description="成功/失败详情")


class AggregatedResult(_BankAggBase):
    success_count: int = Field(ge=0, description="刷新成功的适配器数")
    failed_count: int = Field(ge=0, description="刷新失败的适配器数")
    results_by_adapter: dict[str, AdapterRefreshResult] = Field(
        description="按 adapter_id 索引的刷新结果"
    )


__all__ = [
    "AdapterRefreshResult",
    "AggregatedResult",
    "AmountInCents",
    "ApiResult",
    "BankAccount",
    "BankAdapterInfo",
    "BankTransaction",
    "Id",
    "IsoTimestamp",
    "OAuthAuthorizationRequest",
    "OAuthAuthorizationResponse",
    "OAuthTokenResult",
    "TxDirection",
]
