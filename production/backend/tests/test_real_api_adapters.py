"""R4.3 / R4.4 / R4.5 真实 API 适配层框架测试.

覆盖:
    R4.3 银行:
        test_bank_adapters_have_real_api_methods       (6 个 RealAdapter 都有 _call_real_api)
        test_bank_adapter_falls_back_to_mock_without_credentials (无凭证降级 Mock)
        test_bank_adapter_sign_and_verify_roundtrip    (RSA-SHA256 签名/验签往返)
        test_bank_api_config_yaml_loads                (bank_api_config.yaml 可解析)
    R4.4 第三方数据源:
        test_invoice_verifier_real_api_method_exists
        test_gsxt_adapter_real_api_method_exists
        test_judiciary_adapter_real_api_method_exists
        test_ecds_adapter_real_api_method_exists
        test_external_api_config_yaml_loads
        test_external_adapters_fall_back_to_mock_without_credentials
    R4.5 OCR:
        test_ocr_paddle_adapter_returns_none_without_package
        test_ocr_baidu_adapter_returns_none_without_api_key
        test_ocr_ali_adapter_returns_none_without_api_key
        test_ocr_engine_preference_fallback_chain
        test_ocr_engine_config_yaml_loads
"""

from __future__ import annotations

import inspect
import os
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from app.schemas.parsers import OcrEngine, OcrRequest
from app.services.bank_adapters import (
    ABCRealAdapter, BOCRealAdapter, BOCOMRealAdapter,
    CCBRealAdapter, CMBRealAdapter, ICBCRealAdapter,
)
from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_aggregator_service import _bank_agg_store
from app.services.ecds_adapter import EcdsAdapterService
from app.services.gsxt_adapter import GsxtAdapterService
from app.services.invoice_verifier import InvoiceVerifierService
from app.services.judiciary_adapter import JudiciaryAdapterService
from app.services.ocr_adapters.ali_adapter import AliOCRAdapter
from app.services.ocr_adapters.baidu_adapter import BaiduOCRAdapter
from app.services.ocr_adapters.paddle_adapter import PaddleOCRAdapter
from app.services.ocr_service import OcrService


pytestmark = pytest.mark.asyncio


# ============================================================================
# 测试数据
# ============================================================================

_REAL_ADAPTER_CLASSES = [
    ICBCRealAdapter, CMBRealAdapter, CCBRealAdapter,
    ABCRealAdapter, BOCRealAdapter, BOCOMRealAdapter,
]

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "app" / "config"


# ============================================================================
# R4.3 银行真实 API 适配层
# ============================================================================

class TestBankRealAdapters:
    """R4.3 银行 RealAdapter 框架."""

    def test_bank_adapters_have_real_api_methods(self):
        """6 个 RealAdapter 都有 _call_real_api / _sign_request / _verify_response 方法."""
        for cls in _REAL_ADAPTER_CLASSES:
            adapter = cls()
            assert hasattr(adapter, "_call_real_api"), f"{cls.__name__} 缺少 _call_real_api"
            assert callable(adapter._call_real_api)
            assert hasattr(adapter, "_sign_request"), f"{cls.__name__} 缺少 _sign_request"
            assert hasattr(adapter, "_verify_response"), f"{cls.__name__} 缺少 _verify_response"
            assert hasattr(adapter, "_load_credentials"), f"{cls.__name__} 缺少 _load_credentials"

    def test_bank_adapters_inherit_base_real_bank_adapter(self):
        """6 个 RealAdapter 均继承 BaseRealBankAdapter."""
        for cls in _REAL_ADAPTER_CLASSES:
            assert issubclass(cls, BaseRealBankAdapter), f"{cls.__name__} 未继承 BaseRealBankAdapter"

    async def test_bank_adapter_falls_back_to_mock_without_credentials(self):
        """无凭证时: list_accounts / list_transactions / get_authorization_url 降级到 Mock (super())."""
        # 确保环境变量未设置
        with patch.dict(os.environ, {}, clear=False):
            for key in ("ICBC_APP_ID", "ICBC_PRIVATE_KEY", "ICBC_PUBLIC_KEY"):
                os.environ.pop(key, None)
            adapter = ICBCRealAdapter()
            # 凭证应为空
            creds = adapter._load_credentials()
            assert not creds["app_id"], "无凭证时应 app_id 为空"

            accounts = await adapter.list_accounts("E001")
            assert len(accounts) > 0, "无凭证时应降级到 Mock 返回账户"

            txs = await adapter.list_transactions("E001", days=7)
            assert len(txs) > 0, "无凭证时应降级到 Mock 返回交易"

            auth_url = await adapter.get_authorization_url(
                enterprise_id="E001", state="st", redirect_uri="https://x/cb", scopes=[],
            )
            assert auth_url.startswith("https://"), "授权 URL 应可构造 (Mock 或真实网关)"

    async def test_bank_adapter_call_real_api_returns_empty_without_credentials(self):
        """无凭证时 _call_real_api 返回空 dict {} (触发降级)."""
        with patch.dict(os.environ, {}, clear=False):
            for key in ("CMB_APP_ID", "CMB_PRIVATE_KEY", "CMB_PUBLIC_KEY"):
                os.environ.pop(key, None)
            adapter = CMBRealAdapter()
            result = await adapter._call_real_api("/accounts/list", {"enterprise_id": "E001"})
            assert result == {}, "无凭证时 _call_real_api 应返回 {}"

    def test_bank_adapter_sign_and_verify_roundtrip(self):
        """RSA-SHA256 签名 + 验签往返: 自签自验应通过.

        使用 CMBRealAdapter (采用 BaseRealBankAdapter 的基类签名/验签实现,
        不带工行 biz_content 包装), 验证基类 RSA-SHA256 闭环.
        """
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        # 生成临时 RSA 密钥对
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")
        public_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")

        adapter = CMBRealAdapter()
        params = {"b": "2", "a": "1", "c": "3"}
        sign = adapter._sign_request(params, private_pem)
        assert sign, "签名应非空 (私钥可用)"

        # 验签: response 含 sign 字段
        response = {**params, "sign": sign}
        assert adapter._verify_response(response, public_pem) is True, "自签自验应通过"

        # 篡改后验签应失败
        tampered = {**params, "a": "X", "sign": sign}
        assert adapter._verify_response(tampered, public_pem) is False, "篡改后验签应失败"

        # 无公钥验签返回 False
        assert adapter._verify_response(response, "") is False

    def test_bank_api_config_yaml_loads(self):
        """bank_api_config.yaml 可被 PyYAML 解析, 含 6 家银行配置."""
        cfg_path = _CONFIG_DIR / "bank_api_config.yaml"
        assert cfg_path.exists(), f"配置文件不存在: {cfg_path}"
        with cfg_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)
        assert "banks" in data
        banks = data["banks"]
        assert isinstance(banks, list)
        assert len(banks) == 6, f"应配置 6 家银行, 实际 {len(banks)}"
        adapter_ids = {b["adapter_id"] for b in banks}
        expected = {
            "ADAPTER-ICBC", "ADAPTER-CMB", "ADAPTER-CCB",
            "ADAPTER-ABC", "ADAPTER-BOC", "ADAPTER-BOCOM",
        }
        assert expected == adapter_ids, f"adapter_id 集合不匹配: {adapter_ids}"
        for b in banks:
            for key in ("base_url", "sandbox_url", "app_id_env",
                        "private_key_env", "public_key_env"):
                assert key in b, f"银行 {b.get('adapter_id')} 缺字段 {key}"

    async def test_bank_aggregator_store_seeds_real_adapters(self):
        """_BankAggStore._seed 已将 6 个适配器替换为 RealAdapter."""
        adapters = await _bank_agg_store.list_adapters()
        assert len(adapters) == 6
        for a in adapters:
            assert isinstance(a, BaseRealBankAdapter), (
                f"{a.adapter_id} 应为 RealAdapter, 实际 {type(a).__name__}"
            )


# ============================================================================
# R4.4 第三方数据源真实 API
# ============================================================================

class TestExternalDataRealApi:
    """R4.4 4 个外部数据源适配器增加真实 API 调用方法."""

    def test_invoice_verifier_real_api_method_exists(self):
        svc = InvoiceVerifierService(db=None)
        assert hasattr(svc, "_call_tax_api")
        assert callable(svc._call_tax_api)
        # 超时 8s
        assert svc.TIMEOUT_SECONDS == 8.0

    def test_gsxt_adapter_real_api_method_exists(self):
        svc = GsxtAdapterService(db=None)
        assert hasattr(svc, "_call_gsxt_api")
        assert callable(svc._call_gsxt_api)
        assert svc.TIMEOUT_SECONDS == 8.0

    def test_judiciary_adapter_real_api_method_exists(self):
        svc = JudiciaryAdapterService(db=None)
        assert hasattr(svc, "_call_court_api")
        assert callable(svc._call_court_api)
        assert svc.TIMEOUT_SECONDS == 10.0

    def test_ecds_adapter_real_api_method_exists(self):
        svc = EcdsAdapterService(db=None)
        assert hasattr(svc, "_call_ecds_api")
        assert callable(svc._call_ecds_api)
        assert svc.TIMEOUT_SECONDS == 10.0

    async def test_external_adapters_fall_back_to_mock_without_credentials(self):
        """无凭证时 4 个适配器降级到 mock, 返回内存种子数据."""
        env_keys = [
            "TAX_APP_ID", "TAX_API_KEY",
            "GSXT_APP_ID", "GSXT_API_KEY",
            "COURT_APP_ID", "COURT_API_KEY",
            "ECDS_APP_ID", "ECDS_API_KEY",
        ]
        with patch.dict(os.environ, {}, clear=False):
            for k in env_keys:
                os.environ.pop(k, None)

            # invoice: VOID 发票应返回 voided (mock 规则)
            from app.schemas.external_data import InvoiceVerifyRequest
            req = InvoiceVerifyRequest(
                invoice_code="011002300111",
                invoice_no="26089001VOID",
                invoice_date_iso="2026-07-15T00:00:00+00:00",
                tax_amount_cents=130_000,
                enterprise_id="E001",
            )
            r = await InvoiceVerifierService(db=None).verify(req)
            assert r.invoice_status == "voided"

            # gsxt: E001 有种子数据
            ent = await GsxtAdapterService(db=None).query_enterprise("E001")
            assert ent is not None
            assert ent.enterprise_name

            # judiciary: E002 有种子案件
            cases = await JudiciaryAdapterService(db=None).query_cases("E002")
            assert len(cases) > 0

            # ecds: 种子票据号可查
            bill = await EcdsAdapterService(db=None).query_bill("11001234567890123401")
            assert bill is not None

    async def test_external_real_api_returns_empty_without_credentials(self):
        """无凭证时 4 个 _call_*_api 方法均返回 {}."""
        env_keys = [
            "TAX_APP_ID", "TAX_API_KEY", "GSXT_APP_ID", "GSXT_API_KEY",
            "COURT_APP_ID", "COURT_API_KEY", "ECDS_APP_ID", "ECDS_API_KEY",
        ]
        with patch.dict(os.environ, {}, clear=False):
            for k in env_keys:
                os.environ.pop(k, None)
            assert await InvoiceVerifierService(db=None)._call_tax_api("c", "n", "d", 1) == {}
            assert await GsxtAdapterService(db=None)._call_gsxt_api("E001") == {}
            assert await JudiciaryAdapterService(db=None)._call_court_api("E002") == {}
            assert await EcdsAdapterService(db=None)._call_ecds_api("11001234567890123401") == {}

    def test_external_api_config_yaml_loads(self):
        """external_api_config.yaml 可解析, 含 8 个数据源配置 (A 档接入计划扩充)."""
        cfg_path = _CONFIG_DIR / "external_api_config.yaml"
        assert cfg_path.exists()
        with cfg_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)
        assert "data_sources" in data
        sources = data["data_sources"]
        assert len(sources) == 8
        types = {s["source_type"] for s in sources}
        assert types == {
            "INVOICE_VERIFIER", "GSXT", "JUDICIARY", "ECDS",
            "BANK_FUND", "RISK_DATA", "INSURER_QUOTE", "ERP_DATA",
        }
        for s in sources:
            for key in ("base_url", "sandbox_url", "app_id_env", "api_key_env"):
                assert key in s, f"{s.get('source_type')} 缺字段 {key}"


# ============================================================================
# R4.5 OCR 真实引擎适配
# ============================================================================

class TestOcrRealAdapters:
    """R4.5 OCR 引擎适配器."""

    async def test_ocr_paddle_adapter_returns_none_without_package(self):
        """PaddleOCR 包不可用时 ocr() 返回 None."""
        adapter = PaddleOCRAdapter()
        # paddleocr 包未安装 -> is_available False
        if adapter.is_available():
            pytest.skip("paddleocr 已安装, 跳过无包降级测试")
        result = await adapter.ocr("aGVsbG8=")  # 任意 base64
        assert result is None, "PaddleOCR 包不可用时应返回 None"

    async def test_ocr_baidu_adapter_returns_none_without_api_key(self):
        """百度 OCR 无 API_KEY 时 ocr() 返回 None."""
        with patch.dict(os.environ, {}, clear=False):
            for k in ("BAIDU_OCR_API_KEY", "BAIDU_OCR_SECRET_KEY"):
                os.environ.pop(k, None)
            adapter = BaiduOCRAdapter()
            assert not adapter.has_credentials()
            result = await adapter.ocr("aGVsbG8=")
            assert result is None, "无 API_KEY 时应返回 None"

    async def test_ocr_ali_adapter_returns_none_without_api_key(self):
        """阿里 OCR 无 API_KEY 时 ocr() 返回 None."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ALI_OCR_API_KEY", None)
            adapter = AliOCRAdapter()
            assert not adapter.has_credentials()
            result = await adapter.ocr("aGVsbG8=")
            assert result is None, "无 API_KEY 时应返回 None"

    async def test_ocr_engine_preference_fallback_chain(self):
        """PADDLE 不可用 -> BAIDU 不可用 -> ALI 不可用 -> MOCK 成功.

        清空所有 OCR 凭证 + paddleocr 未安装, 偏好 PADDLE, 最终应返回 MOCK 结果.
        """
        env_keys = [
            "BAIDU_OCR_API_KEY", "BAIDU_OCR_SECRET_KEY", "ALI_OCR_API_KEY",
            "PADDLE_OCR_ENABLED",
        ]
        with patch.dict(os.environ, {}, clear=False):
            for k in env_keys:
                os.environ.pop(k, None)
            # 强制禁用 PaddleOCR (即使包已安装, 也走降级链验证)
            os.environ["PADDLE_OCR_ENABLED"] = "false"

            svc = OcrService()
            req = OcrRequest(
                source_type="image_png",
                base64_content="aGVsbG8=",
                engine_preference=OcrEngine.PADDLE,
            )
            result = await svc.ocr(req)
            assert result is not None
            assert result.engine_used == OcrEngine.MOCK, (
                f"全引擎不可用时应降级到 MOCK, 实际 {result.engine_used}"
            )
            assert len(result.blocks) > 0
            assert result.pages >= 1

    async def test_ocr_engine_preference_mock_first(self):
        """偏好 MOCK 时直接返回 MOCK 结果 (不尝试真实引擎)."""
        svc = OcrService()
        req = OcrRequest(
            source_type="pdf",
            base64_content="",
            engine_preference=OcrEngine.MOCK,
        )
        result = await svc.ocr(req)
        assert result.engine_used == OcrEngine.MOCK
        assert len(result.blocks) == 30  # PDF mock = 30 blocks
        assert result.pages == 5

    async def test_ocr_engine_config_yaml_loads(self):
        """ocr_engine_config.yaml 可解析, 含 4 引擎配置."""
        cfg_path = _CONFIG_DIR / "ocr_engine_config.yaml"
        assert cfg_path.exists()
        with cfg_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)
        assert "engines" in data
        engines = data["engines"]
        for name in ("paddle", "baidu", "ali", "mock"):
            assert name in engines, f"缺引擎配置 {name}"
        assert "engine_preference_chain" in data
        chain = data["engine_preference_chain"]
        assert chain == ["PADDLE", "BAIDU", "ALI", "MOCK"]
        # 百度引擎含 api_key_env / secret_key_env
        assert "api_key_env" in engines["baidu"]
        assert "secret_key_env" in engines["baidu"]

    async def test_ocr_check_engine_health_returns_all_engines(self):
        """check_engine_health 返回 4 个引擎, MOCK 始终 online."""
        with patch.dict(os.environ, {}, clear=False):
            for k in ("BAIDU_OCR_API_KEY", "BAIDU_OCR_SECRET_KEY", "ALI_OCR_API_KEY"):
                os.environ.pop(k, None)
            svc = OcrService()
            health = await svc.check_engine_health()
            assert set(health.keys()) == {
                OcrEngine.PADDLE, OcrEngine.BAIDU,
                OcrEngine.ALI, OcrEngine.MOCK,
            }
            # MOCK 始终 online
            assert health[OcrEngine.MOCK].status == "online"
            # 无凭证的真实引擎应 offline
            assert health[OcrEngine.BAIDU].status == "offline"
            assert health[OcrEngine.ALI].status == "offline"

    def test_ocr_service_real_engine_methods_are_async(self):
        """OcrService 的 _call_paddleocr / _call_baidu_ocr / _call_ali_ocr 是协程函数."""
        svc = OcrService()
        for name in ("_call_paddleocr", "_call_baidu_ocr", "_call_ali_ocr", "ocr", "check_engine_health"):
            method = getattr(svc, name)
            assert inspect.iscoroutinefunction(method), f"{name} 应为 async"
