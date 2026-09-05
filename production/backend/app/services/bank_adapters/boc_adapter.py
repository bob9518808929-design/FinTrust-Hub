"""中国银行 (BOC) 真实 API 适配器 (R4.3 DATA-01).

中行开放平台特点:
    - API Key 认证 (非 OAuth2, supports_oauth2=False)
    - 请求签名: RSA-SHA256, 参数按 ASCII 升序拼接
    - 中行特有: 请求头携带 X-BOC-ApiKey + X-BOC-Sign, 不走 OAuth 授权码流
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class BOCRealAdapter(BaseRealBankAdapter):
    """中行真实 API 适配器."""

    API_BASE_URL = "https://open.bankofchina.com/api"
    SANDBOX_URL = "https://sandbox.open.bankofchina.com/api"
    APP_ID_ENV = "BOC_APP_ID"
    PRIVATE_KEY_ENV = "BOC_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "BOC_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-BOC", _BANK_CONFIGS["ADAPTER-BOC"])

    # 中行签名复用基类 RSA-SHA256 (字典序), auth_protocol=api_key (不走 OAuth).


__all__ = ["BOCRealAdapter"]
