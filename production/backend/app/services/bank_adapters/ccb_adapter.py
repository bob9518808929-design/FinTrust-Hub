"""中国建设银行 (CCB) 真实 API 适配器 (R4.3 DATA-01).

建行开放平台特点:
    - OAuth2 授权码模式
    - 请求签名: RSA-SHA256, 参数按 ASCII 升序拼接, sign 不参与签名
    - 建行特有: 请求头携带 userid + sign, 部分接口需 SM4 加密敏感字段
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class CCBRealAdapter(BaseRealBankAdapter):
    """建行真实 API 适配器."""

    API_BASE_URL = "https://open.ccb.com/api"
    SANDBOX_URL = "https://sandbox.open.ccb.com/api"
    APP_ID_ENV = "CCB_APP_ID"
    PRIVATE_KEY_ENV = "CCB_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "CCB_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-CCB", _BANK_CONFIGS["ADAPTER-CCB"])

    # 建行签名复用基类 RSA-SHA256 (字典序), 保留占位以便扩展 SM4 国密算法.


__all__ = ["CCBRealAdapter"]
