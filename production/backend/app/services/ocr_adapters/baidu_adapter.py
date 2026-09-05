"""百度智能云 OCR 适配器 (R4.5 DATA-03).

百度 OCR API (通用文字识别 general_basic):
    - 需 API_KEY + SECRET_KEY (百度智能云控制台获取)
    - 先用 API_KEY/SECRET_KEY 换 access_token, 再调 OCR 接口
    - 无凭证/超时/异常 -> 返回 None (触发降级)

配置: config/ocr_engine_config.yaml -> engines.baidu
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.schemas.parsers import OcrBlock, OcrEngine, OcrResult


class BaiduOCRAdapter:
    """百度智能云 OCR API 适配器."""

    API_KEY_ENV = "BAIDU_OCR_API_KEY"
    SECRET_KEY_ENV = "BAIDU_OCR_SECRET_KEY"
    BASE_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1"
    TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
    TIMEOUT_SECONDS = 8.0
    PING_TIMEOUT_SECONDS = 3.0

    def __init__(self, http_client: Any | None = None) -> None:
        self.http_client = http_client
        self._token_cache: str | None = None

    # === 凭证 ===

    def _load_credentials(self) -> dict[str, str]:
        return {
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
            "secret_key": os.environ.get(self.SECRET_KEY_ENV, ""),
        }

    def has_credentials(self) -> bool:
        creds = self._load_credentials()
        return bool(creds["api_key"] and creds["secret_key"])

    # === 健康检查 ping ===

    async def ping(self) -> bool:
        """探测百度 OCR 是否可用: 有凭证 + token 端点可达."""
        if not self.has_credentials():
            return False
        try:
            creds = self._load_credentials()
            async with httpx.AsyncClient(timeout=self.PING_TIMEOUT_SECONDS) as client:
                resp = await client.get(self.TOKEN_URL, params={
                    "grant_type": "client_credentials",
                    "client_id": creds["api_key"],
                    "client_secret": creds["secret_key"],
                })
                return resp.status_code == 200
        except Exception:
            return False

    # === OCR 主方法 ===

    async def ocr(self, base64_content: str) -> OcrResult | None:
        """调用百度通用文字识别 OCR.

        返回:
            OcrResult(engine_used=BAIDU)  成功
            None                           无凭证/无内容/超时/异常
        """
        if not self.has_credentials():
            return None
        if not base64_content:
            return None
        try:
            token = await self._get_access_token()
            if not token:
                return None
            image = _strip_data_uri(base64_content)
            url = f"{self.BASE_URL}/general_basic"
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    params={"access_token": token},
                    data={"image": image, "language_type": "CHN_ENG"},
                )
                resp.raise_for_status()
                data = resp.json()
            blocks = _parse_baidu_result(data)
            if not blocks:
                return None
            total_text = "".join(b.text for b in blocks)
            confidence_avg = round(
                sum(b.confidence for b in blocks) / max(1, len(blocks)), 4,
            )
            return OcrResult(
                engine_used=OcrEngine.BAIDU,
                text_length=len(total_text),
                confidence_avg=confidence_avg,
                pages=1,
                blocks=blocks,
            )
        except Exception:
            return None

    # === 内部辅助 ===

    async def _get_access_token(self) -> str | None:
        """用 API_KEY/SECRET_KEY 换 access_token (带缓存)."""
        if self._token_cache:
            return self._token_cache
        creds = self._load_credentials()
        try:
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(self.TOKEN_URL, params={
                    "grant_type": "client_credentials",
                    "client_id": creds["api_key"],
                    "client_secret": creds["secret_key"],
                })
                resp.raise_for_status()
                data = resp.json()
            token = data.get("access_token")
            if token:
                self._token_cache = str(token)
                return self._token_cache
            return None
        except Exception:
            return None


def _strip_data_uri(base64_content: str) -> str:
    """剥离 data:image/...;base64, 前缀."""
    if "," in base64_content and base64_content.startswith("data:"):
        return base64_content.split(",", 1)[1]
    return base64_content


def _parse_baidu_result(data: dict) -> list[OcrBlock]:
    """解析百度 OCR 响应为 OcrBlock 列表."""
    blocks: list[OcrBlock] = []
    words = data.get("words_result") if isinstance(data, dict) else None
    if not words:
        return blocks
    try:
        for idx, item in enumerate(words):
            text = item.get("words", "") if isinstance(item, dict) else str(item)
            if not text:
                continue
            # 百度 general_basic 不返回 bbox, 用行号估算相对坐标
            y1 = min(0.98, 0.05 + idx * 0.08)
            y2 = min(1.0, y1 + 0.06)
            blocks.append(OcrBlock(
                page_no=1,
                bbox=[0.05, y1, 0.95, y2],
                text=str(text),
                confidence=0.90,
            ))
    except Exception:
        return blocks
    return blocks


__all__ = ["BaiduOCRAdapter"]
