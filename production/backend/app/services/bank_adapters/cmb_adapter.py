"""招商银行 (CMB) 真实 API 适配器 (R4.3 DATA-01).

招行 CBS+ 开放平台特点:
    - OAuth2 授权码模式
    - 请求签名: RSA-SHA256, 参数按 ASCII 升序拼接 key=value&... (末尾不补 &)
    - 招行特有: 请求头携带 X-CMB-Sign, 公私钥分离
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class CMBRealAdapter(BaseRealBankAdapter):
    """招行真实 API 适配器."""

    API_BASE_URL = "https://openapi.cmbchina.com/api"
    SANDBOX_URL = "https://sandbox.openapi.cmbchina.com/api"
    APP_ID_ENV = "CMB_APP_ID"
    PRIVATE_KEY_ENV = "CMB_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "CMB_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-CMB", _BANK_CONFIGS["ADAPTER-CMB"])

    # 招行签名与基类一致 (RSA-SHA256 + 字典序), 直接复用 super()._sign_request.
    # 此处保留方法占位以便后续扩展招行特有签名规则.


__all__ = ["CMBRealAdapter"]
