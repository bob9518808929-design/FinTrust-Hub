"""交通银行 (BOCOM) 真实 API 适配器 (R4.3 DATA-01).

交行开放平台特点:
    - OAuth2 授权码模式
    - 请求签名: RSA-SHA256, 参数按 ASCII 升序拼接
    - 交行特有: 请求体整体 JSON + sign 字段, 部分接口需附加商户号
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class BOCOMRealAdapter(BaseRealBankAdapter):
    """交行真实 API 适配器."""

    API_BASE_URL = "https://open.bankcomm.com/api"
    SANDBOX_URL = "https://sandbox.open.bankcomm.com/api"
    APP_ID_ENV = "BOCOM_APP_ID"
    PRIVATE_KEY_ENV = "BOCOM_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "BOCOM_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-BOCOM", _BANK_CONFIGS["ADAPTER-BOCOM"])

    # 交行签名复用基类 RSA-SHA256 (字典序), 保留占位以便扩展商户号逻辑.


__all__ = ["BOCOMRealAdapter"]
