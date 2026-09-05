"""PaddleOCR 本地推理适配器 (R4.5 DATA-03).

PaddleOCR 为开源本地推理引擎 (无 HTTP 调用):
    - 需 pip install paddleocr (CPU 或 GPU 版)
    - GPU 不可用时自动降级 CPU
    - 包未安装 / 环境开关关闭 / 推理异常 -> 返回 None (触发降级)

配置: config/ocr_engine_config.yaml -> engines.paddle
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from app.schemas.parsers import OcrBlock, OcrEngine, OcrResult


class PaddleOCRAdapter:
    """PaddleOCR 本地推理适配器."""

    def __init__(
        self,
        gpu: bool = False,
        model_path: str = "",
        lang: str = "ch",
        use_angle_cls: bool = True,
    ) -> None:
        self.gpu = gpu
        self.model_path = model_path
        self.lang = lang
        self.use_angle_cls = use_angle_cls
        # 延迟初始化的 PaddleOCR 实例
        self._paddle_ocr: Any = None
        self._init_attempted = False

    # === 可用性判定 ===

    @staticmethod
    def is_available() -> bool:
        """PaddleOCR 包是否可导入 (不实际初始化模型)."""
        # 环境开关: PADDLE_OCR_ENABLED=false 可强制禁用
        if os.environ.get("PADDLE_OCR_ENABLED", "true").lower() == "false":
            return False
        try:
            import paddleocr  # noqa: F401
            return True
        except ImportError:
            return False

    # === 推理 ===

    async def ocr(self, base64_content: str) -> OcrResult | None:
        """对 base64 图片执行 PaddleOCR 本地推理.

        返回:
            OcrResult(engine_used=PADDLE)  成功
            None                            包未安装/开关关闭/无内容/推理失败
        """
        if not self.is_available():
            return None
        if not base64_content:
            return None
        try:
            instance = self._get_paddle_instance()
            if instance is None:
                return None
            # 本地推理为同步 CPU/GPU 操作, 放入线程池避免阻塞事件循环
            image_bytes = _decode_base64(base64_content)
            if image_bytes is None:
                return None
            result = await asyncio.to_thread(self._run_inference, instance, image_bytes)
            blocks = _parse_paddle_result(result)
            if not blocks:
                return None
            total_text = "".join(b.text for b in blocks)
            confidence_avg = round(
                sum(b.confidence for b in blocks) / max(1, len(blocks)), 4,
            )
            return OcrResult(
                engine_used=OcrEngine.PADDLE,
                text_length=len(total_text),
                confidence_avg=confidence_avg,
                pages=1,
                blocks=blocks,
            )
        except Exception:
            return None

    # === 内部辅助 ===

    def _get_paddle_instance(self) -> Any:
        """延迟初始化 PaddleOCR 实例 (仅一次)."""
        if self._paddle_ocr is not None:
            return self._paddle_ocr
        if self._init_attempted:
            return None
        self._init_attempted = True
        try:
            from paddleocr import PaddleOCR  # type: ignore[import-not-found]

            use_gpu = self.gpu
            # GPU 不可用时自动降级 CPU
            try:
                if use_gpu:
                    import paddle  # type: ignore[import-not-found]
                    if not paddle.is_compiled_with_cuda():
                        use_gpu = False
            except Exception:
                use_gpu = False

            kwargs: dict[str, Any] = {
                "use_angle_cls": self.use_angle_cls,
                "lang": self.lang,
                "use_gpu": use_gpu,
            }
            if self.model_path:
                kwargs["cls_model_dir"] = self.model_path
            self._paddle_ocr = PaddleOCR(**kwargs)
            return self._paddle_ocr
        except Exception:
            self._paddle_ocr = None
            return None

    def _run_inference(self, instance: Any, image_bytes: bytes) -> Any:
        """执行 PaddleOCR 推理 (同步, 在线程池中调用)."""
        # PaddleOCR.ocr 接受图片路径或 numpy 数组; 此处传字节需落盘或转 ndarray.
        # 简化: 写入临时文件再推理.
        import os as _os
        import tempfile

        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(image_bytes)
                tmp_path = f.name
            return instance.ocr(tmp_path, cls=self.use_angle_cls)
        finally:
            if tmp_path and _os.path.exists(tmp_path):
                try:
                    _os.remove(tmp_path)
                except OSError:
                    pass


# === 模块级工具函数 ===

def _decode_base64(base64_content: str) -> bytes | None:
    """解码 base64 内容 (支持 data URI 前缀)."""
    try:
        import base64

        content = base64_content
        if "," in content and content.startswith("data:"):
            content = content.split(",", 1)[1]
        return base64.b64decode(content)
    except Exception:
        return None


def _parse_paddle_result(result: Any) -> list[OcrBlock]:
    """解析 PaddleOCR 输出为 OcrBlock 列表."""
    blocks: list[OcrBlock] = []
    if not result:
        return blocks
    # PaddleOCR 返回结构: [[ [bbox, (text, confidence) ], ... ], ...] (按页)
    try:
        for page_idx, page in enumerate(result):
            if not page:
                continue
            for _idx, line in enumerate(page):
                bbox_raw, (text, confidence) = line[0], line[1]
                # bbox_raw: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                bbox = _normalize_bbox(bbox_raw)
                blocks.append(OcrBlock(
                    page_no=page_idx + 1,
                    bbox=bbox,
                    text=str(text),
                    confidence=round(float(confidence), 4),
                ))
    except Exception:
        return blocks
    return blocks


def _normalize_bbox(bbox_raw: Any) -> list[float]:
    """将 PaddleOCR 四点 bbox 归一化为 [x1, y1, x2, y2] 相对坐标 (0-1)."""
    try:
        xs = [float(p[0]) for p in bbox_raw]
        ys = [float(p[1]) for p in bbox_raw]
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)
        # 若坐标已是绝对像素, 归一化需图片宽高; 无尺寸信息时裁剪到 [0,1]
        return [max(0.0, min(1.0, x1 / 1000.0)),
                max(0.0, min(1.0, y1 / 1000.0)),
                max(0.0, min(1.0, x2 / 1000.0)),
                max(0.0, min(1.0, y2 / 1000.0))]
    except Exception:
        return [0.0, 0.0, 1.0, 1.0]


__all__ = ["PaddleOCRAdapter"]
