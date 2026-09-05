"""真实银行 API 适配器基类 (R4.3 DATA-01).

继承自 bank_aggregator_service._MockBankAdapter (进而继承 BaseBankAdapter):
    - 复用 Mock 适配器的确定性数据生成能力 (用于降级).
    - 在此之上增加真实 API 对接接口:
        _load_credentials    从环境变量加载 app_id / private_key / public_key / api_base_url
        _sign_request       RSA-SHA256 签名 (PKCS1v15)
        _verify_response    RSA-SHA256 验签
        _call_real_api      HTTP 调用真实银行 API (httpx.AsyncClient, 超时 10s)
    - get_authorization_url / exchange_code_for_token / list_accounts /
      list_transactions 均先尝试真实 API, 失败/无凭证降级到 Mock (super()).

降级原则: 真实 API 调用失败/超时/无凭证 -> 返回空/None -> 调用方降级到 super() (Mock).
"""

from __future__ import annotations

import base64
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from app.schemas.bank_aggregator import (
    BankAccount,
    BankTransaction,
    OAuthTokenResult,
    TxDirection,
)
from app.services.bank_aggregator_service import (
    BaseBankAdapter,
    _MockBankAdapter,
    _now_dt,
)

# ============================================================================
# RSA-SHA256 工具 (基于 cryptography, 不可用时优雅降级)
# ============================================================================

def _build_sorted_query(params: dict) -> str:
    """按 key 字典序拼接 key=value (用于签名/验签的原文)."""
    return "&".join(f"{k}={params[k]}" for k in sorted(params.keys()))


def _rsa_sign(private_key: str, message: str) -> str:
    """RSA-SHA256 (PKCS1v15) 签名, 返回 base64. 失败返回空串."""
    if not private_key:
        return ""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        key_bytes = private_key.encode("utf-8") if isinstance(private_key, str) else private_key
        private_key_obj = serialization.load_pem_private_key(key_bytes, password=None)
        signature = private_key_obj.sign(
            message.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")
    except Exception:
        return ""


def _rsa_verify(public_key: str, message: str, sign_b64: str) -> bool:
    """RSA-SHA256 (PKCS1v15) 验签. 失败返回 False."""
    if not public_key or not sign_b64:
        return False
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        key_bytes = public_key.encode("utf-8") if isinstance(public_key, str) else public_key
        public_key_obj = serialization.load_pem_public_key(key_bytes)
        public_key_obj.verify(
            base64.b64decode(sign_b64),
            message.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


# ============================================================================
# BaseRealBankAdapter
# ============================================================================

class BaseRealBankAdapter(_MockBankAdapter):
    """真实银行 API 适配器基类.

    子类需定义以下类常量 (从环境变量读取, 无则空串触发降级):
        API_BASE_URL      生产网关
        SANDBOX_URL       沙箱网关
        APP_ID_ENV        app_id 环境变量名
        PRIVATE_KEY_ENV   私钥环境变量名
        PUBLIC_KEY_ENV    公钥环境变量名
    """

    # 子类覆盖
    API_BASE_URL: str = ""
    SANDBOX_URL: str = ""
    APP_ID_ENV: str = ""
    PRIVATE_KEY_ENV: str = ""
    PUBLIC_KEY_ENV: str = ""

    # 默认请求超时 10s (R4.3 约束)
    TIMEOUT_SECONDS: float = 10.0

    def __init__(self, adapter_id: str, config: dict) -> None:
        super().__init__(adapter_id, config)
        # 凭证缓存 (单次进程内复用, 避免重复读环境变量)
        self._credentials_cache: dict[str, str] | None = None

    # === 凭证加载 ===

    def _load_credentials(self, adapter_id: str | None = None) -> dict[str, str]:
        """从环境变量加载 API 凭证.

        返回 dict: {app_id, private_key, public_key, api_base_url}.
        任一缺失则对应字段为空串, 调用方据此判断是否降级.
        """
        if self._credentials_cache is not None:
            return self._credentials_cache

        api_base_url = self.API_BASE_URL or os.environ.get(
            f"{self.adapter_id}_API_BASE_URL", ""
        )
        creds: dict[str, str] = {
            "app_id": os.environ.get(self.APP_ID_ENV, ""),
            "private_key": os.environ.get(self.PRIVATE_KEY_ENV, ""),
            "public_key": os.environ.get(self.PUBLIC_KEY_ENV, ""),
            "api_base_url": api_base_url,
        }
        self._credentials_cache = creds
        return creds

    # === 签名 / 验签 ===

    def _sign_request(self, params: dict, private_key: str) -> str:
        """RSA-SHA256 签名 (按 key 字典序拼接原文). 无私钥返回空串."""
        if not private_key:
            return ""
        message = _build_sorted_query(params)
        return _rsa_sign(private_key, message)

    def _verify_response(self, response: dict, public_key: str) -> bool:
        """RSA-SHA256 验签. response 须含 sign 字段; 无公钥返回 False."""
        if not public_key:
            return False
        sign_b64 = response.get("sign", "")
        if not sign_b64:
            return False
        # 排除 sign 字段后按字典序拼接
        data = {k: v for k, v in response.items() if k != "sign"}
        message = _build_sorted_query(data)
        return _rsa_verify(public_key, message, sign_b64)

    # === HTTP 调用 ===

    async def _call_real_api(self, endpoint: str, params: dict) -> dict:
        """调用真实银行 API.

        - 超时 10s (TIMEOUT_SECONDS)
        - 自动注入 app_id + RSA 签名
        - 验签失败/超时/无凭证/网络异常 -> 返回 {} (调用方降级到 Mock)
        """
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_base_url"]:
            return {}
        try:
            sign = self._sign_request(params, creds["private_key"])
            payload = {
                **params,
                "app_id": creds["app_id"],
                "sign": sign,
                "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            url = f"{creds['api_base_url']}{endpoint}"
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
            # 验签 (公钥可用时校验; 不可用则跳过, 仅依赖 HTTPS)
            if creds["public_key"] and not self._verify_response(data, creds["public_key"]):
                return {}
            return data
        except Exception:
            return {}

    # === 业务方法: 先真实 API, 失败降级到 Mock (super()) ===

    async def get_authorization_url(
        self, enterprise_id: str, state: str, redirect_uri: str, scopes: list[str],
    ) -> str:
        """OAuth2 授权 URL: 真实网关构造, 无凭证降级 Mock."""
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_base_url"]:
            return await super().get_authorization_url(
                enterprise_id, state, redirect_uri, scopes,
            )
        try:
            params = {
                "client_id": creds["app_id"],
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "state": state,
                "scope": " ".join(scopes) if scopes else "accounts:read transactions:read",
                "enterprise_id": enterprise_id,
            }
            return f"{creds['api_base_url']}/oauth/authorize?{urlencode(params)}"
        except Exception:
            return await super().get_authorization_url(
                enterprise_id, state, redirect_uri, scopes,
            )

    async def exchange_code_for_token(
        self, enterprise_id: str, code: str,
    ) -> OAuthTokenResult:
        """OAuth2 换 token: 真实 API, 失败降级 Mock."""
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_base_url"]:
            return await super().exchange_code_for_token(enterprise_id, code)
        try:
            data = await self._call_real_api("/oauth/token", {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": creds["app_id"],
                "enterprise_id": enterprise_id,
            })
            if not data or "access_token" not in data:
                return await super().exchange_code_for_token(enterprise_id, code)
            now = _now_dt()
            expires_in = int(data.get("expires_in", 86400))
            return OAuthTokenResult(
                access_token=str(data["access_token"]),
                refresh_token=str(data.get("refresh_token", "")),
                expires_at=(now + timedelta(seconds=expires_in)).isoformat(),
                enterprise_id=enterprise_id,
                adapter_id=self.adapter_id,
            )
        except Exception:
            return await super().exchange_code_for_token(enterprise_id, code)

    async def list_accounts(self, enterprise_id: str) -> list[BankAccount]:
        """账户列表: 真实 API, 失败降级 Mock."""
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_base_url"]:
            return await super().list_accounts(enterprise_id)
        try:
            data = await self._call_real_api("/accounts/list", {
                "enterprise_id": enterprise_id,
            })
            if not data or "accounts" not in data:
                return await super().list_accounts(enterprise_id)
            accounts: list[BankAccount] = []
            for item in data["accounts"]:
                try:
                    accounts.append(BankAccount(
                        account_id=str(item["account_id"]),
                        account_no_masked=str(item.get("account_no_masked", "")),
                        account_type=str(item.get("account_type", "basic")),  # type: ignore[arg-type]
                        balance_cents=int(item.get("balance_cents", 0)),
                        currency=str(item.get("currency", "CNY")),
                        enterprise_id=enterprise_id,
                        adapter_id=self.adapter_id,
                    ))
                except (KeyError, ValueError, TypeError):
                    continue
            if not accounts:
                return await super().list_accounts(enterprise_id)
            return accounts
        except Exception:
            return await super().list_accounts(enterprise_id)

    async def list_transactions(
        self, enterprise_id: str, account_id: str | None = None, days: int = 30,
    ) -> list[BankTransaction]:
        """交易列表: 真实 API, 失败降级 Mock."""
        creds = self._load_credentials()
        if not creds["app_id"] or not creds["api_base_url"]:
            return await super().list_transactions(enterprise_id, account_id, days)
        try:
            params: dict[str, Any] = {
                "enterprise_id": enterprise_id,
                "days": days,
            }
            if account_id:
                params["account_id"] = account_id
            data = await self._call_real_api("/transactions/list", params)
            if not data or "transactions" not in data:
                return await super().list_transactions(enterprise_id, account_id, days)
            txs: list[BankTransaction] = []
            for item in data["transactions"]:
                try:
                    direction: TxDirection = "in" if str(item.get("direction", "in")) == "in" else "out"
                    txs.append(BankTransaction(
                        tx_id=str(item["tx_id"]),
                        account_id=str(item["account_id"]),
                        amount_cents=int(item.get("amount_cents", 0)),
                        direction=direction,
                        counterparty_name=str(item.get("counterparty_name", "")),
                        counterparty_account=str(item.get("counterparty_account", "")),
                        purpose=str(item.get("purpose", "")),
                        tx_time_iso=str(item["tx_time_iso"]),
                        enterprise_id=enterprise_id,
                        adapter_id=self.adapter_id,
                    ))
                except (KeyError, ValueError, TypeError):
                    continue
            if not txs:
                return await super().list_transactions(enterprise_id, account_id, days)
            return txs
        except Exception:
            return await super().list_transactions(enterprise_id, account_id, days)


__all__ = ["BaseBankAdapter", "BaseRealBankAdapter"]
