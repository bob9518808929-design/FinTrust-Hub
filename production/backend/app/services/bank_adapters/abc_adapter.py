"""中国农业银行 (ABC) 真实 API 适配器 (R4.3 DATA-01).

农行开放平台特点:
    - OAuth2 授权码模式
    - 请求签名: RSA-SHA256, 参数按 ASCII 升序拼接 (含空值参数)
    - 农行特有: 部分接口需对敏感字段 (账号/证件号) 做 SM4 加密后参与签名
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class ABCRealAdapter(BaseRealBankAdapter):
    """农行真实 API 适配器."""

    API_BASE_URL = "https://open.abchina.com/api"
    SANDBOX_URL = "https://sandbox.open.abchina.com/api"
    APP_ID_ENV = "ABC_APP_ID"
    PRIVATE_KEY_ENV = "ABC_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "ABC_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-ABC", _BANK_CONFIGS["ADAPTER-ABC"])

    # 农行签名复用基类 RSA-SHA256 (字典序), 保留占位以便扩展 SM4 敏感字段加密.


__all__ = ["ABCRealAdapter"]
