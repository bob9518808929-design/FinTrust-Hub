"""INFRA-05 RPA 适配层服务 (R6.2).

对接影刀 / UiPath 等 RPA SDK, 生成银行流水 / 发票 / 合同 PDF.

设计风格: 内存单例 + asyncio.Lock + _seed + db=None (参考 bank_service.py).

降级策略:
    - _load_rpa_sdk: 尝试 import 影刀/UiPath SDK, 不可用返回 False
    - execute_rpa_task: SDK 不可用时用 reportlab 生成 PDF; reportlab 也不可用时生成文本
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from app.schemas.rpa import RPATask

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "rpa") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# === PDF 输出目录 (放 sandbox 可写路径) ===
_OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..", "outputs", "rpa",
)
_OUTPUT_DIR = os.path.abspath(_OUTPUT_DIR)


def _ensure_output_dir() -> str:
    """确保输出目录存在, 返回路径 (创建失败回退到 tempdir)."""
    try:
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        return _OUTPUT_DIR
    except Exception:
        import tempfile
        return tempfile.gettempdir()


def _reportlab_available() -> bool:
    try:
        import reportlab  # noqa: F401
        return True
    except Exception:
        return False


# ============================================================================
# R7.0 银行申报书模板加载 (6 家银行: ICBC/CCB/ABC/BOC/BOCOM/CMB)
# ============================================================================

_BANK_APPLICATION_TEMPLATES_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config", "bank_application_templates.yaml",
)


def _load_bank_templates() -> dict[str, dict[str, Any]]:
    """加载 bank_application_templates.yaml 返回 {bank_code: template_dict}.

    yaml 不可用时返回内置 6 家银行的 minimal 模板 (保证业务可用).
    """
    try:
        import yaml
        with open(_BANK_APPLICATION_TEMPLATES_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        banks_list = data.get("banks", []) if data else []
        result: dict[str, dict[str, Any]] = {}
        for tpl in banks_list:
            bc = tpl.get("bank_code")
            if bc:
                result[bc] = tpl
        if result:
            return result
    except Exception as exc:
        logger.warning(
            f"加载 bank_application_templates.yaml 失败 ({exc}), 使用内置 minimal 模板"
        )
    # 内置 fallback: 6 家银行最小模板
    return {
        bc: {
            "bank_code": bc,
            "bank_name": name,
            "full_name": name,
            "template_version": "fallback",
            "page_size": "A4",
            "header_color": "#0F2D6B",
            "signature_required": True,
            "signature_label": "法定代表人 (签字盖章)",
            "sections": [
                {"section_id": "basic",
                 "section_title": "一、申请人基本信息",
                 "fields": {
                     "applicantName": "enterprise_name",
                     "uscc": "uscc",
                     "legalRepresentative": "legal_representative",
                 }},
            ],
        }
        for bc, name in (
            ("ICBC", "中国工商银行"),
            ("CCB", "中国建设银行"),
            ("ABC", "中国农业银行"),
            ("BOC", "中国银行"),
            ("BOCOM", "交通银行"),
            ("CMB", "招商银行"),
        )
    }


# 单例: 模块加载时读取一次 (避免每次生成 PDF 都重读文件)
_BANK_TEMPLATES: dict[str, dict[str, Any]] = _load_bank_templates()


def get_bank_templates() -> dict[str, dict[str, Any]]:
    """公开访问: 获取 6 家银行申报书模板."""
    return _BANK_TEMPLATES


# ============================================================================
# 内存状态
# ============================================================================

class _RPAStore:
    """内存兜底: 5 个 RPA 任务 (3 completed / 1 running / 1 pending)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._tasks: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(timezone.utc)
        out_dir = _ensure_output_dir()
        specs = [
            # (eid, type, target_bank, status, completed_offset_hours)
            ("E001", "BANK_STATEMENT_PDF", "工商银行", "completed", -48),
            ("E002", "INVOICE_PDF", None, "completed", -24),
            ("E003", "CONTRACT_PDF", None, "completed", -12),
            ("E004", "BANK_STATEMENT_PDF", "招商银行", "running", None),
            ("E001", "CONTRACT_PDF", None, "pending", None),
        ]
        for idx, (eid, ttype, bank, status, completed_offset) in enumerate(specs):
            task_id = f"RPA-2026-{idx+1:04d}"
            created = (now - timedelta(hours=idx + 1)).isoformat()
            completed = None
            result_path = None
            if status == "completed":
                completed = (now + timedelta(hours=completed_offset)).isoformat()
                fname = f"{task_id}_{ttype.lower()}.pdf"
                result_path = os.path.join(out_dir, fname)
            self._tasks[task_id] = {
                "task_id": task_id,
                "task_type": ttype,
                "enterprise_id": eid,
                "target_bank": bank,
                "status": status,
                "result_file_path": result_path,
                "created_at_iso": created,
                "completed_at_iso": completed,
                "error_message": None,
            }

    async def get_task(self, task_id: str) -> dict | None:
        async with self._lock:
            t = self._tasks.get(task_id)
            return dict(t) if t else None

    async def list_tasks(
        self, enterprise_id: str | None = None, status: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            tasks = list(self._tasks.values())
            if enterprise_id:
                tasks = [t for t in tasks if t.get("enterprise_id") == enterprise_id]
            if status:
                tasks = [t for t in tasks if t.get("status") == status]
            return [dict(t) for t in tasks]

    async def put_task(self, task: dict) -> dict:
        async with self._lock:
            self._tasks[task["task_id"]] = dict(task)
            return dict(task)


_rpa_store = _RPAStore()


# ============================================================================
# RPA 服务
# ============================================================================

class RPAService:
    """RPA 适配层服务 (INFRA-05).

    主要方法:
        - _load_rpa_sdk: 尝试 import 影刀/UiPath SDK
        - _generate_bank_statement_pdf / _generate_invoice_pdf / _generate_contract_pdf
        - create_rpa_task / execute_rpa_task / list_tasks
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db
        self._rpa_sdk: Any | None = None
        self._rpa_sdk_tried: bool = False

    # === RPA SDK 加载 ===

    def _load_rpa_sdk(self) -> bool:
        """尝试 import 影刀 / UiPath SDK, 不可用返回 False.

        候选模块名: yingdao / uipath / uipath_sdk / rpa_sdk.
        """
        if self._rpa_sdk_tried:
            return self._rpa_sdk is not None
        self._rpa_sdk_tried = True
        for name in ("yingdao_sdk", "yingdao", "uipath_sdk", "uipath", "rpa_sdk"):
            try:
                self._rpa_sdk = __import__(name)
                return True
            except Exception:
                continue
        self._rpa_sdk = None
        return False

    # === PDF 生成 (reportlab 不可用 → 文本) ===

    def _generate_bank_statement_pdf(
        self, enterprise_id: str, bank_name: str,
        account_no: str, period: str,
    ) -> str:
        """生成模拟银行流水 PDF (reportlab 不可用生成文本)."""
        out_dir = _ensure_output_dir()
        fname = f"bank_stmt_{enterprise_id}_{uuid.uuid4().hex[:8]}.pdf"
        path = os.path.join(out_dir, fname)
        title = f"银行流水 - {bank_name}"
        rows = [
            ["日期", "摘要", "收入(元)", "支出(元)", "余额(元)"],
            ["2026-08-01", "客户回款", "120,000.00", "-", "120,000.00"],
            ["2026-08-05", "支付供应商", "-", "35,000.00", "85,000.00"],
            ["2026-08-10", "工资发放", "-", "58,000.00", "27,000.00"],
            ["2026-08-15", "贷款放款", "500,000.00", "-", "527,000.00"],
        ]
        meta = {
            "企业 ID": enterprise_id, "银行": bank_name,
            "账号": account_no, "周期": period,
            "生成时间": _now_iso(),
        }
        self._write_pdf(path, title, meta, rows)
        return path

    def _generate_invoice_pdf(self, invoice_data: dict) -> str:
        """生成模拟发票 PDF (reportlab 不可用生成文本)."""
        out_dir = _ensure_output_dir()
        fname = f"invoice_{invoice_data.get('invoice_no', uuid.uuid4().hex[:8])}.pdf"
        path = os.path.join(out_dir, fname)
        title = f"发票 - {invoice_data.get('invoice_no', '')}"
        rows = [
            ["项目", "内容"],
            ["发票号码", str(invoice_data.get("invoice_no", ""))],
            ["开票日期", str(invoice_data.get("issue_date", ""))],
            ["购买方", str(invoice_data.get("buyer", ""))],
            ["销售方", str(invoice_data.get("seller", ""))],
            ["金额(元)", str(invoice_data.get("amount", ""))],
            ["税额(元)", str(invoice_data.get("tax_amount", ""))],
            ["价税合计(元)", str(invoice_data.get("total_amount", ""))],
        ]
        meta = {"生成时间": _now_iso()}
        self._write_pdf(path, title, meta, rows)
        return path

    def _generate_contract_pdf(self, contract_data: dict) -> str:
        """生成模拟合同 PDF (reportlab 不可用生成文本)."""
        out_dir = _ensure_output_dir()
        fname = f"contract_{contract_data.get('contract_no', uuid.uuid4().hex[:8])}.pdf"
        path = os.path.join(out_dir, fname)
        title = f"合同 - {contract_data.get('contract_no', '')}"
        rows = [
            ["项目", "内容"],
            ["合同编号", str(contract_data.get("contract_no", ""))],
            ["签订日期", str(contract_data.get("sign_date", ""))],
            ["甲方", str(contract_data.get("party_a", ""))],
            ["乙方", str(contract_data.get("party_b", ""))],
            ["合同金额(元)", str(contract_data.get("amount", ""))],
            ["履约期限", str(contract_data.get("performance_period", ""))],
        ]
        meta = {"生成时间": _now_iso()}
        self._write_pdf(path, title, meta, rows)
        return path

    @staticmethod
    def _write_pdf(path: str, title: str, meta: dict, rows: list[list[str]]) -> None:
        """生成 PDF; reportlab 不可用时降级为文本文件 (.txt 改后缀失败则原 .pdf 写文本)."""
        if _reportlab_available():
            try:
                from reportlab.lib import colors
                from reportlab.lib.pagesizes import A4
                from reportlab.lib.styles import getSampleStyleSheet
                from reportlab.platypus import (
                    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                )

                doc = SimpleDocTemplate(path, pagesize=A4)
                styles = getSampleStyleSheet()
                story = []
                story.append(Paragraph(title, styles["Title"]))
                story.append(Spacer(1, 12))
                for k, v in meta.items():
                    story.append(Paragraph(f"<b>{k}</b>: {v}", styles["Normal"]))
                story.append(Spacer(1, 12))
                if rows:
                    table = Table(rows)
                    table.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ]))
                    story.append(table)
                doc.build(story)
                return
            except Exception as exc:
                logger.warning(f"reportlab 生成 PDF 失败 ({exc}), 降级为文本")
        # 降级: 写文本文件 (扩展名仍为 .pdf 但内容是纯文本)
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"=== {title} ===\n\n")
            for k, v in meta.items():
                f.write(f"{k}: {v}\n")
            f.write("\n")
            for row in rows:
                f.write(" | ".join(str(c) for c in row) + "\n")
            f.write("\n(本文件由 RPA mock 生成, reportlab 不可用降级为文本)\n")

    # === RPA 任务管理 ===

    async def create_rpa_task(
        self, enterprise_id: str, task_type: str,
        target_bank: str | None = None,
    ) -> RPATask:
        """创建 RPA 任务 (pending 状态)."""
        valid_types = {"BANK_STATEMENT_PDF", "INVOICE_PDF", "CONTRACT_PDF"}
        if task_type not in valid_types:
            raise ValueError(f"未知 RPA 任务类型: {task_type}")
        if task_type == "BANK_STATEMENT_PDF" and not target_bank:
            target_bank = "未指定"
        task_id = _id("RPA")
        task = {
            "task_id": task_id,
            "task_type": task_type,
            "enterprise_id": enterprise_id,
            "target_bank": target_bank,
            "status": "pending",
            "result_file_path": None,
            "created_at_iso": _now_iso(),
            "completed_at_iso": None,
            "error_message": None,
        }
        await _rpa_store.put_task(task)
        return RPATask.model_validate(task)

    async def execute_rpa_task(self, task_id: str) -> RPATask:
        """执行 RPA 任务 (SDK 不可用 → reportlab PDF → 文本降级).

        Returns:
            RPATask (status=completed/failed)
        """
        task = await _rpa_store.get_task(task_id)
        if not task:
            raise ValueError(f"RPA 任务 {task_id} 不存在")
        # 标记 running
        task["status"] = "running"
        await _rpa_store.put_task(task)
        try:
            ttype = task["task_type"]
            eid = task["enterprise_id"]
            if ttype == "BANK_STATEMENT_PDF":
                path = self._generate_bank_statement_pdf(
                    enterprise_id=eid,
                    bank_name=task.get("target_bank") or "未指定",
                    account_no=f"6222****{uuid.uuid4().hex[:4]}",
                    period="2026-08",
                )
            elif ttype == "INVOICE_PDF":
                path = self._generate_invoice_pdf({
                    "invoice_no": f"INV-{uuid.uuid4().hex[:8]}",
                    "issue_date": _now_iso(),
                    "buyer": eid,
                    "seller": "FinTrust Hub",
                    "amount": "10000.00",
                    "tax_amount": "1300.00",
                    "total_amount": "11300.00",
                })
            elif ttype == "CONTRACT_PDF":
                path = self._generate_contract_pdf({
                    "contract_no": f"CT-{uuid.uuid4().hex[:8]}",
                    "sign_date": _now_iso(),
                    "party_a": eid,
                    "party_b": "FinTrust Hub",
                    "amount": "500000.00",
                    "performance_period": "12 个月",
                })
            else:
                raise ValueError(f"未知任务类型: {ttype}")
            task["status"] = "completed"
            task["result_file_path"] = path
            task["completed_at_iso"] = _now_iso()
            task["error_message"] = None
        except Exception as exc:
            logger.warning(f"RPA 任务执行失败 ({exc})")
            task["status"] = "failed"
            task["error_message"] = str(exc)
            task["completed_at_iso"] = _now_iso()
        await _rpa_store.put_task(task)
        return RPATask.model_validate(task)

    async def list_tasks(
        self, enterprise_id: str | None = None, status: str | None = None,
    ) -> list[RPATask]:
        tasks = await _rpa_store.list_tasks(enterprise_id, status)
        return [RPATask.model_validate(t) for t in tasks]

    # ========================================================================
    # R7.0 银行冷启动 PDF 申报书模板 (6 家银行: ICBC/CCB/ABC/BOC/BOCOM/CMB)
    # ========================================================================

    async def generate_bank_application_pdf(
        self,
        enterprise_id: str,
        bank_code: str,
        application_data: dict[str, Any],
        save_to_file: bool = True,
    ) -> bytes | str:
        """生成指定银行的 PDF 申报书 (6 家银行模板, 字段映射).

        Args:
            enterprise_id: 企业 ID
            bank_code: 银行代码 (ICBC/CCB/ABC/BOC/BOCOM/CMB)
            application_data: 申报数据 (统一 schema 字段, 见
                              bank_application_templates.yaml 标准字段定义)
            save_to_file: True 时保存到 outputs/rpa/ 并返回路径;
                          False 时返回 PDF bytes

        Returns:
            PDF bytes (save_to_file=False) 或文件路径 (save_to_file=True)
            reportlab 不可用时降级为纯文本 bytes/路径 (扩展名仍 .pdf)
            未知 bank_code 时抛 ValueError
        """
        bank_code = (bank_code or "").upper()
        template = _BANK_TEMPLATES.get(bank_code)
        if not template:
            raise ValueError(
                f"未知银行代码: {bank_code}; 支持: "
                f"{', '.join(sorted(_BANK_TEMPLATES.keys()))}"
            )

        # 计算派生字段 (如 asset_liability_ratio)
        enriched_data = self._enrich_application_data(application_data)

        if _reportlab_available():
            try:
                return self._write_bank_application_pdf_reportlab(
                    enterprise_id=enterprise_id,
                    bank_code=bank_code,
                    template=template,
                    data=enriched_data,
                    save_to_file=save_to_file,
                )
            except Exception as exc:
                logger.warning(
                    f"reportlab 生成银行申报书 PDF 失败 ({exc}), 降级为纯文本"
                )

        # 降级: 纯文本申报书
        text_bytes = self._write_bank_application_text(
            enterprise_id=enterprise_id,
            bank_code=bank_code,
            template=template,
            data=enriched_data,
        )
        if save_to_file:
            out_dir = _ensure_output_dir()
            fname = f"bank_application_{bank_code}_{enterprise_id}.pdf"
            path = os.path.join(out_dir, fname)
            with open(path, "wb") as f:
                f.write(text_bytes)
            return path
        return text_bytes

    @staticmethod
    def _enrich_application_data(data: dict[str, Any]) -> dict[str, Any]:
        """计算派生字段 (如 asset_liability_ratio).

        Args:
            data: 原始 application_data

        Returns:
            dict (原数据 + 派生字段)
        """
        enriched = dict(data)
        # 派生: 资产负债率 = 总负债 / 总资产
        if "asset_liability_ratio" not in enriched:
            total_assets = enriched.get("total_assets")
            total_liab = enriched.get("total_liabilities")
            if (
                isinstance(total_assets, (int, float)) and total_assets > 0
                and isinstance(total_liab, (int, float))
            ):
                enriched["asset_liability_ratio"] = round(
                    total_liab / total_assets, 4
                )
        return enriched

    @staticmethod
    def _map_section_data(
        section: dict[str, Any], data: dict[str, Any],
    ) -> list[list[str]]:
        """把章节字段映射 + 数据 → 二维行列表 (bank_field_name, value)."""
        rows: list[list[str]] = []
        for bank_field, std_field in (section.get("fields") or {}).items():
            # 中文字段名 → 翻译映射 (粗略, 真实场景应做完整字典)
            cn_name = RPAService._std_field_to_cn(std_field)
            value = data.get(std_field, "")
            if value is None:
                value = ""
            rows.append([cn_name, str(value)])
        return rows

    @staticmethod
    def _std_field_to_cn(std_field: str) -> str:
        """把标准字段名映射到中文标签 (申报书表格显示用)."""
        mapping = {
            "enterprise_name": "企业名称",
            "uscc": "统一社会信用代码",
            "legal_representative": "法定代表人",
            "registered_capital": "注册资本 (元)",
            "established_at": "成立日期",
            "industry_code": "行业代码",
            "contact_phone": "联系电话",
            "contact_address": "联系地址",
            "loan_amount": "申请融资金额 (元)",
            "loan_term_months": "融资期限 (月)",
            "loan_purpose": "融资用途",
            "repayment_source": "还款来源",
            "annual_revenue": "年营收 (元)",
            "net_profit": "净利润 (元)",
            "total_assets": "总资产 (元)",
            "total_liabilities": "总负债 (元)",
            "asset_liability_ratio": "资产负债率",
            "bank_account_no": "主要结算账户",
            "credit_rating": "信用评级",
            "existing_loans_balance": "现有贷款余额 (元)",
            "guarantor_name": "担保人名称",
            "guarantor_uscc": "担保人统一社会信用代码",
        }
        return mapping.get(std_field, std_field)

    @staticmethod
    def _write_bank_application_pdf_reportlab(
        enterprise_id: str,
        bank_code: str,
        template: dict[str, Any],
        data: dict[str, Any],
        save_to_file: bool,
    ) -> bytes | str:
        """使用 reportlab 生成银行申报书 PDF (按银行模板渲染)."""
        import io

        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
        )

        if save_to_file:
            out_dir = _ensure_output_dir()
            fname = f"bank_application_{bank_code}_{enterprise_id}.pdf"
            path = os.path.join(out_dir, fname)
            doc = SimpleDocTemplate(
                path, pagesize=A4,
                title=f"{template.get('full_name', '')} 申报书-{enterprise_id}",
                author=f"FinTrust Hub RPA - {bank_code}",
            )
        else:
            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer, pagesize=A4,
                title=f"{template.get('full_name', '')} 申报书-{enterprise_id}",
                author=f"FinTrust Hub RPA - {bank_code}",
            )

        styles = getSampleStyleSheet()
        story: list[Any] = []
        header_color_hex = template.get("header_color", "#0F2D6B")
        try:
            header_color = colors.HexColor(header_color_hex)
        except Exception:
            header_color = colors.HexColor("#0F2D6B")

        # === 银行标题 + 模板版本 ===
        story.append(Paragraph(
            f"{template.get('full_name', '')} 融资申报书",
            styles["Title"],
        ))
        story.append(Spacer(1, 6))
        meta_rows = [
            ["银行代码", bank_code],
            ["银行简称", template.get("bank_name", "")],
            ["模板版本", template.get("template_version", "")],
            ["企业 ID", enterprise_id],
            ["生成时间 (UTC)", _now_iso()],
        ]
        meta_table = Table(meta_rows, colWidths=[100, 340])
        meta_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 12))

        # === 各章节内容 (表格) ===
        for section in template.get("sections", []):
            section_title = section.get("section_title", section.get("section_id", ""))
            story.append(Paragraph(f"<b>{section_title}</b>", styles["Heading2"]))
            story.append(Spacer(1, 4))
            rows = RPAService._map_section_data(section, data)
            if not rows:
                rows = [["(本章节无字段)", ""]]
            table_rows = [["字段", "值"]] + rows
            tbl = Table(table_rows, colWidths=[200, 240])
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), header_color),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(tbl)
            story.append(Spacer(1, 10))

        # === 签字盖章区 ===
        if template.get("signature_required", True):
            story.append(Spacer(1, 30))
            story.append(Paragraph(
                f"<b>声明:</b> 申请人承诺以上所填信息真实、完整、有效, "
                f"如有不实, 愿承担相应法律责任.",
                styles["Normal"],
            ))
            story.append(Spacer(1, 20))
            sign_rows = [
                ["申请人 (盖章):", ""],
                [template.get("signature_label", "法定代表人 (签字盖章)"), ""],
                ["申请日期:", "        年      月      日"],
            ]
            sign_table = Table(sign_rows, colWidths=[200, 240])
            sign_table.setStyle(TableStyle([
                ("LINEBELOW", (1, 0), (1, -1), 0.8, colors.black),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
            ]))
            story.append(sign_table)

        doc.build(story)
        if save_to_file:
            return path
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes

    @staticmethod
    def _write_bank_application_text(
        enterprise_id: str,
        bank_code: str,
        template: dict[str, Any],
        data: dict[str, Any],
    ) -> bytes:
        """纯文本降级申报书 (UTF-8 bytes)."""
        lines: list[str] = []
        lines.append("=" * 60)
        lines.append(
            f"{template.get('full_name', '')} 融资申报书"
            f" (文本降级版, bank_code={bank_code})"
        )
        lines.append("=" * 60)
        lines.append(f"银行代码: {bank_code}")
        lines.append(f"银行简称: {template.get('bank_name', '')}")
        lines.append(f"模板版本: {template.get('template_version', '')}")
        lines.append(f"企业 ID: {enterprise_id}")
        lines.append(f"生成时间 (UTC): {_now_iso()}")
        lines.append("")
        for section in template.get("sections", []):
            section_title = section.get("section_title", section.get("section_id", ""))
            lines.append(f"[{section_title}]")
            rows = RPAService._map_section_data(section, data)
            for cn_name, value in rows:
                lines.append(f"  {cn_name}: {value}")
            lines.append("")
        if template.get("signature_required", True):
            lines.append("声明: 申请人承诺以上所填信息真实、完整、有效, 如有不实, 愿承担相应法律责任.")
            lines.append("申请人 (盖章):")
            lines.append(template.get("signature_label", "法定代表人 (签字盖章)"))
            lines.append("申请日期:        年      月      日")
        lines.append("=" * 60)
        lines.append("(本文件由 rpa_service 生成, reportlab 不可用降级为文本)")
        text = "\n".join(lines)
        return text.encode("utf-8")


rpa_service = RPAService(db=None)
