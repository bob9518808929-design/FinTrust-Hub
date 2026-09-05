"""DATA-03 OCR 服务 (R1.3 + R4.5).

支持 PaddleOCR / 百度 / 阿里 三引擎主 + Mock 兜底（ROADMAP 三档要求）:
    - PADDLE: 本地 PaddleOCR (开源免费, 需安装 paddleocr 包)
    - BAIDU:  百度智能云 OCR API
    - ALI:    阿里云 OCR API
    - MOCK:   确定性 Mock 引擎 (兜底, 无外部依赖)

R4.5 真实引擎适配:
    - 三引擎拆到 services/ocr_adapters/ 独立适配器 (PaddleOCRAdapter /
      BaiduOCRAdapter / AliOCRAdapter), 统一 async ocr(base64) -> OcrResult | None.
    - ocr() 按 engine_preference 顺序尝试 PADDLE→BAIDU→ALI→MOCK,
      第一个成功即返回; 任一引擎失败/无凭证 -> 返回 None -> 自动降级到下一引擎.
    - check_engine_health() 对真实引擎做健康检查 (HTTP ping / 包可导入性).

engine_preference 首选; 外部引擎不可用时自动 fallback 到 MOCK.
种子数据模式不强制单例 store, 但保持可注入依赖 (http_client=None 等).
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from typing import Any

from app.schemas.parsers import (
    AdapterHealth, OcrBlock, OcrEngine, OcrRequest, OcrResult,
)
from app.services.ocr_adapters.ali_adapter import AliOCRAdapter
from app.services.ocr_adapters.baidu_adapter import BaiduOCRAdapter
from app.services.ocr_adapters.paddle_adapter import PaddleOCRAdapter


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seed_rng(seed_str: str) -> random.Random:
    """根据 seed_str 生成确定性 Random 实例."""
    h = hashlib.sha256(seed_str.encode("utf-8")).digest()
    seed_int = int.from_bytes(h[:8], "big")
    return random.Random(seed_int)


# ============================================================================
# Mock 引擎: 确定性 OCR 文本生成
# ============================================================================

_PDF_MOCK_LINES = [
    "中国工商银行 电子回单",
    "账号: 6222 **** 8899 户名: 深圳科创电子有限公司",
    "交易日期 2026-01-15 交易金额 +500,000.00 元",
    "对方户名: 广州供应链集团 对方账号: 4403 0123 4567",
    "用途: 货款 余额: 1,280,500.00",
    "交易日期 2026-01-16 交易金额 -35,000.00 元",
    "对方户名: 深圳市税务局 对方账号: 4403 9988 7766",
    "用途: 增值税缴纳 余额: 1,245,500.00",
    "交易日期 2026-01-17 交易金额 +128,600.00 元",
    "对方户名: 杭州智造机械有限公司 对方账号: 3301 2233 4455",
    "用途: 设备采购款 余额: 1,374,100.00",
    "交易日期 2026-01-18 交易金额 -8,200.00 元",
    "对方户名: 顺丰速运 对方账号: 7559 1122 3344",
    "用途: 物流运费 余额: 1,365,900.00",
    "交易日期 2026-01-19 交易金额 +350,000.00 元",
    "对方户名: 上海贸易有限公司 对方账号: 3101 5566 7788",
    "用途: 货款 余额: 1,715,900.00",
    "交易日期 2026-01-20 交易金额 -120,000.00 元",
    "对方户名: 东莞原材料厂 对方账号: 4419 8899 0011",
    "用途: 原材料采购 余额: 1,595,900.00",
    "交易日期 2026-01-21 交易金额 +95,500.00 元",
    "对方户名: 北京科技公司 对方账号: 1101 2233 4455",
    "用途: 技术服务费 余额: 1,691,400.00",
    "交易日期 2026-01-22 交易金额 -15,800.00 元",
    "对方户名: 供电局 对方账号: 7559 3344 5566",
    "用途: 电费缴纳 余额: 1,675,600.00",
    "交易日期 2026-01-23 交易金额 +210,000.00 元",
    "对方户名: 成都数字科技 对方账号: 5101 7788 9900",
    "用途: 项目回款 余额: 1,885,600.00",
    "本回单仅供参考, 请以银行实际交易为准",
]

_IMAGE_MOCK_LINES = [
    "增值税专用发票",
    "发票代码: 044002600311 发票号码: 00283901",
    "开票日期: 2026年01月25日",
    "销售方: 深圳科创电子有限公司",
    "纳税人识别号: 91440300MA5DXXXXXX",
    "购买方: 广州供应链集团股份有限公司",
    "纳税人识别号: 91440100MA9KXXXXXX",
    "价税合计 (大写): 壹佰壹拾叁万元整 (小写): ¥1,130,000.00",
]


def _generate_mock_blocks(request: OcrRequest) -> tuple[list[OcrBlock], int]:
    """根据 source_type 生成确定性 OCR blocks.

    - PDF: 5 页, 30 个 block (每页 6 个)
    - 图片: 1 页, 8 个 block
    """
    rng = _seed_rng(f"ocr-{request.source_type}-{request.dpi}")

    if request.source_type == "pdf":
        pages = 5
        lines_per_page = 6
        total_blocks = pages * lines_per_page  # 30 个
        lines_pool = _PDF_MOCK_LINES * 2
    else:
        pages = 1
        total_blocks = 8
        lines_pool = _IMAGE_MOCK_LINES

    blocks: list[OcrBlock] = []
    for i in range(total_blocks):
        page_no = (i // lines_per_page) + 1 if request.source_type == "pdf" else 1
        line_idx = i % len(lines_pool)
        text = lines_pool[line_idx]
        confidence = round(rng.uniform(0.85, 0.92), 4)
        row_in_page = i % lines_per_page if request.source_type == "pdf" else i
        y1 = 0.05 + row_in_page * 0.11
        y2 = min(0.98, y1 + 0.08)
        bbox = [0.05, y1, 0.95, y2]
        blocks.append(OcrBlock(
            page_no=page_no,
            bbox=bbox,
            text=text,
            confidence=confidence,
        ))

    return blocks, pages


# ============================================================================
# OCR 服务
# ============================================================================

class OcrService:
    """OCR 服务 (多引擎 + Mock 兜底)."""

    ENGINE_ORDER = [OcrEngine.PADDLE, OcrEngine.BAIDU, OcrEngine.ALI, OcrEngine.MOCK]

    def __init__(
        self,
        http_client: Any | None = None,
        paddle_available: bool = False,
        baidu_available: bool = False,
        ali_available: bool = False,
    ) -> None:
        self.http_client = http_client
        self._engine_available: dict[OcrEngine, bool] = {
            OcrEngine.PADDLE: paddle_available,
            OcrEngine.BAIDU: baidu_available,
            OcrEngine.ALI: ali_available,
            OcrEngine.MOCK: True,
        }
        self._engine_latency: dict[OcrEngine, int] = {
            OcrEngine.PADDLE: 120,
            OcrEngine.BAIDU: 350,
            OcrEngine.ALI: 280,
            OcrEngine.MOCK: 5,
        }
        # R4.5: 真实引擎适配器 (独立模块)
        self._paddle_adapter = PaddleOCRAdapter()
        self._baidu_adapter = BaiduOCRAdapter(http_client=http_client)
        self._ali_adapter = AliOCRAdapter(http_client=http_client)

    # === 引擎可用性判定 + fallback 链 ===

    def _resolve_engine(self, preference: OcrEngine) -> OcrEngine:
        """根据 engine_preference + 可用性解析实际使用的引擎.

        (向后兼容保留; 新 ocr() 流程改用真实适配器链逐个尝试.)
        """
        if self._engine_available.get(preference, False):
            return preference
        fallback_order = [e for e in self.ENGINE_ORDER if e != preference]
        for engine in fallback_order:
            if self._engine_available.get(engine, False):
                return engine
        return OcrEngine.MOCK

    def _engine_chain(self, preference: OcrEngine) -> list[OcrEngine]:
        """构造尝试顺序: preference 首选, 后接 ENGINE_ORDER 其余 (去重)."""
        chain = [preference] + [e for e in self.ENGINE_ORDER if e != preference]
        seen: set[OcrEngine] = set()
        ordered: list[OcrEngine] = []
        for e in chain:
            if e not in seen:
                seen.add(e)
                ordered.append(e)
        return ordered

    # === R4.5: 真实引擎调用 (失败返回 None 触发降级) ===

    async def _call_paddleocr(self, base64_content: str) -> OcrResult | None:
        """PaddleOCR 本地推理; 包未安装/开关关闭/推理失败 -> None."""
        return await self._paddle_adapter.ocr(base64_content)

    async def _call_baidu_ocr(self, base64_content: str) -> OcrResult | None:
        """百度 OCR API; 无 API_KEY/超时/异常 -> None."""
        return await self._baidu_adapter.ocr(base64_content)

    async def _call_ali_ocr(self, base64_content: str) -> OcrResult | None:
        """阿里 OCR API; 无 API_KEY/超时/异常 -> None."""
        return await self._ali_adapter.ocr(base64_content)

    def _mock_ocr(self, request: OcrRequest) -> OcrResult:
        """Mock 引擎: 确定性文本生成, confidence 0.85-0.92."""
        blocks, pages = _generate_mock_blocks(request)
        total_text = "".join(b.text for b in blocks)
        text_length = len(total_text)
        confidence_avg = round(sum(b.confidence for b in blocks) / max(1, len(blocks)), 4)
        return OcrResult(
            engine_used=OcrEngine.MOCK,
            text_length=text_length,
            confidence_avg=confidence_avg,
            pages=pages,
            blocks=blocks,
        )

    # === OCR 主方法 ===

    async def ocr(self, request: OcrRequest) -> OcrResult:
        """执行 OCR 识别.

        R4.5: 按 engine_preference 顺序尝试 PADDLE→BAIDU→ALI→MOCK,
        第一个成功即返回; 任一真实引擎返回 None (无凭证/包缺失/超时)
        自动降级到下一引擎, 最终回退到 MOCK (始终可用).
        """
        for engine in self._engine_chain(request.engine_preference):
            result: OcrResult | None = None
            if engine == OcrEngine.PADDLE:
                result = await self._call_paddleocr(request.base64_content)
            elif engine == OcrEngine.BAIDU:
                result = await self._call_baidu_ocr(request.base64_content)
            elif engine == OcrEngine.ALI:
                result = await self._call_ali_ocr(request.base64_content)
            elif engine == OcrEngine.MOCK:
                result = self._mock_ocr(request)
            if result is not None:
                return result
        # 理论不可达 (MOCK 始终返回), 兜底
        return self._mock_ocr(request)

    # === 健康检查 ===

    async def check_engine_health(self) -> dict[OcrEngine, AdapterHealth]:
        """检查所有引擎健康状态.

        R4.5: 真实引擎做实际探测:
            - PADDLE: paddleocr 包可导入性
            - BAIDU / ALI: 凭证存在 + 网关 HTTP ping (短超时)
            - MOCK: 始终 online

        返回 dict[OcrEngine, AdapterHealth]:
            - status: online/offline/degraded
            - latency_ms: 延迟 (毫秒)
            - last_checked_at: 最近检查时间 ISO
        """
        now = _now_iso()
        result: dict[OcrEngine, AdapterHealth] = {}

        # PADDLE: 包可导入性
        paddle_ok = self._paddle_adapter.is_available()
        result[OcrEngine.PADDLE] = AdapterHealth(
            status="online" if paddle_ok else "offline",
            latency_ms=self._engine_latency.get(OcrEngine.PADDLE, 0) if paddle_ok else 0,
            last_checked_at=now,
        )

        # BAIDU: HTTP ping
        baidu_ok = await self._baidu_adapter.ping()
        result[OcrEngine.BAIDU] = AdapterHealth(
            status="online" if baidu_ok else "offline",
            latency_ms=self._engine_latency.get(OcrEngine.BAIDU, 0) if baidu_ok else 0,
            last_checked_at=now,
        )

        # ALI: HTTP ping
        ali_ok = await self._ali_adapter.ping()
        result[OcrEngine.ALI] = AdapterHealth(
            status="online" if ali_ok else "offline",
            latency_ms=self._engine_latency.get(OcrEngine.ALI, 0) if ali_ok else 0,
            last_checked_at=now,
        )

        # MOCK: 始终可用
        result[OcrEngine.MOCK] = AdapterHealth(
            status="online",
            latency_ms=self._engine_latency.get(OcrEngine.MOCK, 0),
            last_checked_at=now,
        )
        return result


ocr_service = OcrService()
