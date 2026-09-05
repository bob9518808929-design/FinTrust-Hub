"""DATA-03 OCR 真实引擎适配层 (R4.5).

3 个真实 OCR 引擎适配器 + Mock 兜底:
    PaddleOCRAdapter  本地 PaddleOCR 推理 (开源, 需 pip install paddleocr)
    BaiduOCRAdapter   百度智能云 OCR API (通用文字识别)
    AliOCRAdapter     阿里云 OCR API (RecognizeGeneral)

统一接口: async ocr(base64_content: str) -> OcrResult | None
    - 成功返回 OcrResult (engine_used 对应引擎)
    - 失败/无凭证/包未安装 -> 返回 None (触发上层降级到下一引擎)

配置: config/ocr_engine_config.yaml
"""

from app.services.ocr_adapters.ali_adapter import AliOCRAdapter
from app.services.ocr_adapters.baidu_adapter import BaiduOCRAdapter
from app.services.ocr_adapters.paddle_adapter import PaddleOCRAdapter

__all__ = [
    "PaddleOCRAdapter",
    "BaiduOCRAdapter",
    "AliOCRAdapter",
]
