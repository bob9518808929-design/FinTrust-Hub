"""阿里云 OCR 适配器 (R4.5 DATA-03).

阿里云 OCR API (RecognizeGeneral 通用识别):
    - 需 API_KEY (阿里云 RAM 用户 AccessKey)
    - 通过 HTTP 调用 OCR 接口, 传 base64 图片
    - 无凭证/超时/异常 -> 返回 None (触发降级)

配置: config/ocr_engine_config.yaml -> engines.ali
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.schemas.parsers import OcrBlock, OcrEngine, OcrResult


class AliOCRAdapter:
    """阿里云 OCR API 适配器."""

    API_KEY_ENV = "ALI_OCR_API_KEY"
    BASE_URL = "https://ocr-api.cn-hangzhou.aliyuncs.com"
    TIMEOUT_SECONDS = 8.0
    PING_TIMEOUT_SECONDS = 3.0

    def __init__(self, http_client: Any | None = None) -> None:
        self.http_client = http_client

    # === 凭证 ===

    def _load_credentials(self) -> dict[str, str]:
        return {
            "api_key": os.environ.get(self.API_KEY_ENV, ""),
        }

    def has_credentials(self) -> bool:
        return bool(self._load_credentials()["api_key"])

    # === 健康检查 ping ===

    async def ping(self) -> bool:
        """探测阿里云 OCR 是否可用: 有凭证 + 网关可达."""
        if not self.has_credentials():
            return False
        try:
            async with httpx.AsyncClient(timeout=self.PING_TIMEOUT_SECONDS) as client:
                # 轻量 GET 探测网关 (401/403 也算可达)
                resp = await client.get(self.BASE_URL)
                return resp.status_code < 500
        except Exception:
            return False

    # === OCR 主方法 ===

    async def ocr(self, base64_content: str) -> OcrResult | None:
        """调用阿里云通用识别 OCR.

        返回:
            OcrResult(engine_used=ALI)  成功
            None                         无凭证/无内容/超时/异常
        """
        if not self.has_credentials():
            return None
        if not base64_content:
            return None
        try:
            image = _strip_data_uri(base64_content)
            url = f"{self.BASE_URL}/api/predict/ocr_general"
            headers = {
                "Authorization": f"Bearer {self._load_credentials()['api_key']}",
                "Content-Type": "application/json",
            }
            payload = {"image": image}
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            blocks = _parse_ali_result(data)
            if not blocks:
                return None
            total_text = "".join(b.text for b in blocks)
            confidence_avg = round(
                sum(b.confidence for b in blocks) / max(1, len(blocks)), 4,
            )
            return OcrResult(
                engine_used=OcrEngine.ALI,
                text_length=len(total_text),
                confidence_avg=confidence_avg,
                pages=1,
                blocks=blocks,
            )
        except Exception:
            return None


def _strip_data_uri(base64_content: str) -> str:
    """剥离 data:image/...;base64, 前缀."""
    if "," in base64_content and base64_content.startswith("data:"):
        return base64_content.split(",", 1)[1]
    return base64_content


def _parse_ali_result(data: dict) -> list[OcrBlock]:
    """解析阿里云 OCR 响应为 OcrBlock 列表."""
    blocks: list[OcrBlock] = []
    if not isinstance(data, dict):
        return blocks
    # 阿里返回结构因接口而异, 兼容常见 keys
    regions: Any = None
    if isinstance(data.get("prism_wordsInfo"), list):
        regions = data["prism_wordsInfo"]
    elif isinstance(data.get("wordsInfo"), list):
        regions = data["wordsInfo"]
    elif isinstance(data.get("data"), dict) and isinstance(data["data"].get("wordsInfo"), list):
        regions = data["data"]["wordsInfo"]
    if regions:
        try:
            for idx, item in enumerate(regions):
                text = item.get("word", "") or item.get("words", "")
                if not text:
                    continue
                blocks.append(OcrBlock(
                    page_no=1,
                    bbox=[0.05, min(0.98, 0.05 + idx * 0.08), 0.95, min(1.0, 0.11 + idx * 0.08)],
                    text=str(text),
                    confidence=float(item.get("probability", 0.90)),
                ))
        except Exception:
            pass
    return blocks


__all__ = ["AliOCRAdapter"]
