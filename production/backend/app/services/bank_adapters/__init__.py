"""银企直连真实银行 API 适配层框架 (R4.3 DATA-01).

设计目标:
    - 在 bank_aggregator_service.BaseBankAdapter / _MockBankAdapter 之上,
      增加真实银行 API 对接能力 (RSA-SHA256 签名 / 验签 / HTTP 调用).
    - 三档兜底: 真实 API -> 凭证缺失/超时/异常 -> 自动降级到 Mock (super()).
    - 凭证一律从环境变量读取, 不硬编码.

包含 6 家银行 RealAdapter:
    ICBCRealAdapter   中国工商银行
    CMBRealAdapter   招商银行
    CCBRealAdapter   中国建设银行
    ABCRealAdapter   中国农业银行
    BOCRealAdapter   中国银行
    BOCOMRealAdapter 交通银行
"""

from app.services.bank_adapters.abc_adapter import ABCRealAdapter
from app.services.bank_adapters.base_real_adapter import BaseRealBankAdapter
from app.services.bank_adapters.boc_adapter import BOCRealAdapter
from app.services.bank_adapters.bocom_adapter import BOCOMRealAdapter
from app.services.bank_adapters.ccb_adapter import CCBRealAdapter
from app.services.bank_adapters.cmb_adapter import CMBRealAdapter
from app.services.bank_adapters.icbc_adapter import ICBCRealAdapter

__all__ = [
    "BaseRealBankAdapter",
    "ICBCRealAdapter",
    "CMBRealAdapter",
    "CCBRealAdapter",
    "ABCRealAdapter",
    "BOCRealAdapter",
    "BOCOMRealAdapter",
]
