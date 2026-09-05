"""中国工商银行 (ICBC) 真实 API 适配器 (R4.3 DATA-01).

工行开放平台特点:
    - OAuth2 授权码模式
    - 请求签名: RSA-SHA256 (PKCS1v15), 按 key 字典序拼接
    - 工行特有: app_id + sign + msg_id 三段式头, biz_content 为业务参数 JSON
    - 响应验签: 银行公钥 RSA-SHA256

无凭证时自动降级到 Mock (super()).
"""

from __future__ import annotations

import json

from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _BANK_CONFIGS


class ICBCRealAdapter(BaseRealBankAdapter):
    """工行真实 API 适配器."""

    API_BASE_URL = "https://open.icbc.com.cn/api"
    SANDBOX_URL = "https://sandbox.open.icbc.com.cn/api"
    APP_ID_ENV = "ICBC_APP_ID"
    PRIVATE_KEY_ENV = "ICBC_PRIVATE_KEY"
    PUBLIC_KEY_ENV = "ICBC_PUBLIC_KEY"

    def __init__(self) -> None:
        super().__init__("ADAPTER-ICBC", _BANK_CONFIGS["ADAPTER-ICBC"])

    def _sign_request(self, params: dict, private_key: str) -> str:
        """工行签名: biz_content (业务参数 JSON) + app_id + timestamp 拼接后 RSA-SHA256."""
        if not private_key:
            return ""
        # 工行特有: 业务参数包装为 biz_content
        biz_content = json.dumps(params, sort_keys=True, ensure_ascii=False)
        sign_payload = {
            "app_id": self._load_credentials()["app_id"],
            "biz_content": biz_content,
            "timestamp": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "msg_id": self.adapter_id,
        }
        return super()._sign_request(sign_payload, private_key)


__all__ = ["ICBCRealAdapter"]
