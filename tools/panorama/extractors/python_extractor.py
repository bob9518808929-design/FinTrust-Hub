# 文件名：python_extractor.py
# 职责：从 Python 文件提取中文注释（中文名 + 职责说明）
# 优先级：1) # 文件名：/# 模块名： 2) # 职责： 3) __doc__ 4) 文件名推断

"""Python 注释提取器

返回 (name_cn, responsibility_cn, source)
source 取值：comment/docstring/filename/missing
"""

from __future__ import annotations

import ast
import re
from pathlib import Path


def extract_python_annotation(file_path: str) -> tuple[str, str, str]:
    """提取 Python 文件的中文注释

    Returns:
        (name_cn, responsibility_cn, source)
    """
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError, PermissionError):
        return "", "", "missing"

    # 优先级 1：# 文件名： / # 模块名：
    name_cn = _extract_first_match(content, r"#\s*(?:文件名|模块名)[：:]\s*(.+)")
    # 优先级 2：# 职责：
    responsibility_cn = _extract_first_match(content, r"#\s*职责[：:]\s*(.+)")

    if name_cn or responsibility_cn:
        return (name_cn or "", responsibility_cn or "", "comment")

    # 优先级 3：模块/文件 docstring
    try:
        tree = ast.parse(content)
        docstring = ast.get_docstring(tree)
        if docstring:
            # 取第一行作为名称，剩余作为职责
            lines = docstring.strip().splitlines()
            if lines:
                name_cn = lines[0].strip()
                responsibility_cn = " ".join(l.strip() for l in lines[1:]).strip()
                return name_cn, responsibility_cn, "docstring"
    except (SyntaxError, ValueError):
        pass

    # 优先级 4：文件名推断（snake_case → 中文映射表）
    name_cn = _infer_from_filename(file_path)
    return name_cn, "", "filename" if name_cn else "missing"


def _extract_first_match(content: str, pattern: str) -> str:
    """提取第一个匹配，去除首尾空白"""
    m = re.search(pattern, content, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return ""


def _infer_from_filename(file_path: str) -> str:
    """从文件名推断中文名（snake_case → 中文映射）"""
    fname = Path(file_path).stem.lower()
    # 常见业务词汇映射表（持续补充）
    name_map = {
        # backend
        "main": "应用入口",
        "config": "配置中心",
        "database": "数据库会话工厂",
        "deps": "依赖注入",
        "router": "路由聚合",
        "auth": "认证",
        "bank": "银行",
        "enterprises": "企业",
        "operations": "运营",
        "reform": "改造",
        "scf": "供应链金融",
        "base": "基础模型",
        "eco": "ECO 模块",
        "enterprise": "企业",
        "seed": "种子数据",
        # 服务类
        "service": "业务服务",
        "llm_service": "LLM 调用服务",
        "ocr_service": "OCR 服务",
        "iot_service": "IoT 服务",
        "risk_service": "风险服务",
        "credit_service": "信用服务",
        "fund_service": "资金服务",
        "bank_service": "银行服务",
        "chain_service": "区块链服务",
        "contract_service": "合同服务",
        "invoice_service": "发票服务",
        "refinance_service": "再融资服务",
        # adapters
        "adapter": "适配器",
        "bank_adapters": "银行适配器",
        "ocr_adapters": "OCR 适配器",
        "gsxt_adapter": "工商适配器",
        "ecds_adapter": "电证适配器",
        "judiciary_adapter": "司法适配器",
        "iot_gateway": "IoT 网关",
        "human_ai_gateway": "人机协同网关",
        # 其他
        "workers": "后台任务",
        "migrations": "数据库迁移",
        "schemas": "数据模型",
        "models": "模型",
        "test": "测试",
        "utils": "工具",
        "helpers": "辅助函数",
        # frontend
        "app": "根组件",
        "sw": "Service Worker",
        "home": "首页",
        "login": "登录",
        "about": "关于",
        "notfound": "404 页",
        # ECO 9 模块
        "eco_burn": "ECO-01 阅后即烕",
        "eco_pay": "ECO-02 成果定价",
        "eco_rpa": "ECO-03 无接口适配器",
        "eco_cred": "ECO-04 联盟链凭证",
        "eco_bid": "ECO-05 反向竞拍",
        "eco_pts": "ECO-06 积分商城",
        "eco_idx": "ECO-07 FinTrust 指数",
        "eco_gov": "ECO-08 政府背书",
        "eco_bot": "ECO-09 数字分身",
        "eco_pricing": "ECO 成果定价",
        "eco_index": "ECO 指数",
        "eco_credential": "ECO 凭证",
        "eco_adapter": "ECO 适配器",
    }
    # 直接匹配
    if fname in name_map:
        return name_map[fname]
    # 后缀匹配（如 bank_service → 服务）
    for suffix, label in [("_service", "服务"), ("_adapter", "适配器"),
                           ("_gateway", "网关"), ("_view", "视图"),
                           ("_parser", "解析器"), ("_verifier", "校验器")]:
        if fname.endswith(suffix):
            prefix = fname[:-len(suffix)].replace("_", " ")
            return f"{prefix}{label}"
    return ""
