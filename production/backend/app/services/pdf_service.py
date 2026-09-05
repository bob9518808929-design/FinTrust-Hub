"""PDF 报告生成服务 (MOD-08 + ECO-08 + APP-04).

spec 依据: ECO-08 政府背书报告 / 监管沙盒穿透报告 / 改造结果报告
路线图: docs/P1_ROADMAP_TECH_IMPL.md §2

主方案: weasyprint (HTML/CSS → PDF, 复用 Jinja2 模板)
兜底: reportlab (纯 Python, 无外部依赖)
"""

import io
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class PDFService:
    """PDF 报告生成服务.

    主方案: weasyprint (HTML/CSS → PDF)
    兜底: reportlab (纯 Python)
    字体: Noto Sans CJK SC (中文)
    """

    def __init__(self) -> None:
        self.template_dir: Path = Path(__file__).resolve().parents[1] / "templates" / "pdf"
        self.font_path: str = ""  # 可由环境变量 FINTRUST_FONT_PATH 覆盖
        import os
        env_font = os.environ.get("FINTRUST_FONT_PATH", "")
        if env_font and Path(env_font).exists():
            self.font_path = env_font

    async def generate_report(
        self,
        template_name: str,
        context: dict,
        output_path: Optional[str] = None,
    ) -> bytes:
        """生成 PDF 报告.

        Args:
            template_name: 模板名 (如 gov_report.html / sandbox_report.html)
            context: 模板变量 (enterprise, report, audit_trail 等)
            output_path: 输出路径, None 则返回 bytes

        Returns:
            PDF bytes
        """
        try:
            return await self._render_with_weasyprint(template_name, context, output_path)
        except ImportError:
            logger.warning("weasyprint 未安装, 降级到 reportlab")
            return await self._render_with_reportlab(template_name, context, output_path)
        except Exception as e:
            logger.exception("weasyprint 渲染失败, 降级到 reportlab")
            return await self._render_with_reportlab(template_name, context, output_path)

    async def _render_with_weasyprint(
        self, template_name: str, context: dict, output_path: Optional[str]
    ) -> bytes:
        from weasyprint import HTML, CSS
        from jinja2 import Environment, FileSystemLoader

        env = Environment(loader=FileSystemLoader(str(self.template_dir)))
        template = env.get_template(template_name)
        html_content = template.render(**context)

        css = CSS(string=self._base_css())
        pdf_bytes = HTML(string=html_content).write_pdf(stylesheets=[css])

        if output_path:
            Path(output_path).write_bytes(pdf_bytes)
        return pdf_bytes

    async def _render_with_reportlab(
        self, template_name: str, context: dict, output_path: Optional[str]
    ) -> bytes:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet

        if self.font_path and Path(self.font_path).exists():
            pdfmetrics.registerFont(TTFont("NotoSans", self.font_path))
            base_font = "NotoSans"
        else:
            base_font = "Helvetica"

        styles = getSampleStyleSheet()
        styles["Normal"].fontName = base_font
        styles["Title"].fontName = base_font
        styles["Heading1"].fontName = base_font
        styles["Heading2"].fontName = base_font

        buf = io.BytesIO() if not output_path else None
        doc = SimpleDocTemplate(output_path or buf, pagesize=A4)
        story = [
            Paragraph(context.get("title", "FinTrust Hub 报告"), styles["Title"]),
            Spacer(1, 20),
            Paragraph(context.get("content", ""), styles["Normal"]),
        ]

        # 表格数据 (如果 context 提供 metrics)
        if context.get("metrics"):
            from reportlab.platypus import Table, TableStyle
            from reportlab.lib import colors
            data = [["指标", "当前值", "行业基准", "状态"]]
            for m in context["metrics"]:
                data.append([
                    str(m.get("label", "")),
                    str(m.get("value", "")),
                    str(m.get("benchmark", "")),
                    str(m.get("status", "")),
                ])
            table = Table(data)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("FONTNAME", (0, 0), (-1, 0), base_font),
                ("FONTSIZE", (0, 0), (-1, 0), 14),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
                ("BACKGROUND", (0, 1), (-1, -1), colors.beige),
                ("GRID", (0, 0), (-1, -1), 1, colors.black),
            ]))
            story.append(Spacer(1, 20))
            story.append(table)

        doc.build(story)
        if buf:
            return buf.getvalue()
        return Path(output_path).read_bytes()

    def _base_css(self) -> str:
        return """
        @page { size: A4; margin: 2cm; }
        body { font-family: 'Noto Sans CJK SC', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #ddd; padding: 8px; }
        """


# 单例
pdf_service = PDFService()
