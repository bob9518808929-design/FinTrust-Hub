"""INFRA-04 改造沙箱仿真服务 (P2 R3.2 + R5.7 + R7.0 PDF 导出)."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from app.schemas.reform_sandbox import (
    ChangeDataType, PurgeInfo, Sandbox, SandboxChange, SandboxDiff, SandboxStatus,
)
from app.schemas.sandbox_indicator import (
    CurvePoint, IndicatorCurve, IndicatorStatus, SandboxReport,
)

logger = logging.getLogger(__name__)


def _reportlab_available() -> bool:
    """检测 reportlab 是否可用 (与 rpa_service 风格一致)."""
    try:
        import reportlab  # noqa: F401
        return True
    except Exception:
        return False


# === PDF 输出目录 (放 sandbox 可写路径) ===
_PDF_OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "outputs", "reform_sandbox",
)
_PDF_OUTPUT_DIR = os.path.abspath(_PDF_OUTPUT_DIR)


def _ensure_pdf_output_dir() -> str:
    """确保 PDF 输出目录存在, 返回路径 (失败回退 tempdir)."""
    try:
        os.makedirs(_PDF_OUTPUT_DIR, exist_ok=True)
        return _PDF_OUTPUT_DIR
    except Exception:
        import tempfile
        return tempfile.gettempdir()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb_id() -> str:
    return f"sbx-{uuid.uuid4().hex[:12]}"


def _ch_id() -> str:
    return f"chg-{uuid.uuid4().hex[:12]}"


# === R5.7 12 项准入指标定义 ===
_INDICATOR_DEFS: list[dict] = [
    {"indicator_id": "asset_liability_ratio", "name": "资产负债率",
     "baseline": 0.68, "projected": 0.55, "unit": "%", "ratio": 0.01,
     "lower_better": True},
    {"indicator_id": "current_ratio", "name": "流动比率",
     "baseline": 1.2, "projected": 1.8, "unit": "倍", "ratio": 0.1,
     "lower_better": False},
    {"indicator_id": "quick_ratio", "name": "速动比率",
     "baseline": 0.8, "projected": 1.2, "unit": "倍", "ratio": 0.1,
     "lower_better": False},
    {"indicator_id": "accounts_receivable_turnover", "name": "应收账款周转",
     "baseline": 4.5, "projected": 6.5, "unit": "次", "ratio": 0.5,
     "lower_better": False},
    {"indicator_id": "inventory_turnover", "name": "存货周转",
     "baseline": 3.2, "projected": 5.0, "unit": "次", "ratio": 0.4,
     "lower_better": False},
    {"indicator_id": "revenue_growth_rate", "name": "营收增长率",
     "baseline": -0.05, "projected": 0.18, "unit": "%", "ratio": 0.03,
     "lower_better": False},
    {"indicator_id": "net_profit_margin", "name": "净利润率",
     "baseline": 0.04, "projected": 0.10, "unit": "%", "ratio": 0.01,
     "lower_better": False},
    {"indicator_id": "roe", "name": "净资产收益率 (ROE)",
     "baseline": 0.06, "projected": 0.15, "unit": "%", "ratio": 0.015,
     "lower_better": False},
    {"indicator_id": "roa", "name": "总资产收益率 (ROA)",
     "baseline": 0.03, "projected": 0.08, "unit": "%", "ratio": 0.01,
     "lower_better": False},
    {"indicator_id": "cashflow_ratio", "name": "现金流量比率",
     "baseline": 0.4, "projected": 0.9, "unit": "倍", "ratio": 0.08,
     "lower_better": False},
    {"indicator_id": "interest_coverage", "name": "利息保障倍数",
     "baseline": 1.8, "projected": 3.5, "unit": "倍", "ratio": 0.3,
     "lower_better": False},
    {"indicator_id": "debt_structure", "name": "资产负债结构",
     "baseline": 0.5, "projected": 0.7, "unit": "分", "ratio": 0.05,
     "lower_better": False},
]


def _gen_curve(baseline: float, projected: float, ratio: float,
               seed_offset: int) -> tuple[list[CurvePoint], float]:
    """生成 12 个月曲线 + 最终状态 (improved/degraded/unchanged)."""
    rng = random.Random(seed_offset)
    points: list[CurvePoint] = []
    now = datetime.now(timezone.utc)
    for i in range(12, 0, -1):
        year = now.year
        month = now.month - i + 1
        if month <= 0:
            year -= 1
            month += 12
        month_iso = f"{year:04d}-{month:02d}"
        # 线性插值 baseline → projected + 微扰动
        progress = (12 - i) / 11.0  # 0 → 1
        noise = rng.uniform(-ratio, ratio)
        value = baseline + (projected - baseline) * progress + noise
        points.append(CurvePoint(month_iso=month_iso, value=round(value, 4)))
    # 用最后一个点判断状态
    final = points[-1].value if points else baseline
    # 判定阈值: 5% 视为 unchanged
    delta_pct = (final - baseline) / max(abs(baseline), 0.01)
    if abs(delta_pct) < 0.05:
        status = IndicatorStatus.UNCHANGED
    elif (delta_pct > 0) == (projected > baseline):
        status = IndicatorStatus.IMPROVED
    else:
        status = IndicatorStatus.DEGRADED
    return points, status.value


class _SandboxStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sandboxes: dict[str, dict] = {}
        # R5.7: 沙箱指标曲线缓存 sandbox_id -> list[IndicatorCurve dict]
        self._indicators: dict[str, list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(timezone.utc)
        specs = [
            ("E001", "2026-Q3 融资基线-激活", SandboxStatus.ACTIVE, now),
            ("E002", "2026-H1 改造基线-已过期", SandboxStatus.EXPIRED, now - timedelta(days=45)),
            ("E003", "2026-专项试点基线-已提交", SandboxStatus.COMMITTED, now - timedelta(days=3)),
        ]
        for idx, (eid, baseline, status, snap) in enumerate(specs):
            sb_id = f"sbx-seed-{idx+1:04d}"
            retained_days = 30
            expire_dt = snap + timedelta(days=retained_days)
            if status == SandboxStatus.EXPIRED:
                expire_dt = snap + timedelta(days=10)
            changes: list[dict] = []
            for i in range(5):
                dt_list = list(ChangeDataType)
                dtype = dt_list[i % len(dt_list)]
                applied = (snap + timedelta(hours=i + 1)).isoformat()
                change = {
                    "change_id": _ch_id(),
                    "data_type": dtype.value,
                    "path": f"/reform/stages/R{i+1}",
                    "old_value": {"level": "C", "enabled": False},
                    "new_value": {"level": "A", "enabled": True, "score": 85 + i},
                    "proposed_by": f"operator-{100 + i}",
                    "applied_at_iso": applied,
                    "confirmed_at_iso": (
                        (snap + timedelta(hours=i + 2)).isoformat()
                        if status != SandboxStatus.ACTIVE or i < 3
                        else None
                    ),
                }
                changes.append(change)
            sb = {
                "id": sb_id,
                "enterprise_id": eid,
                "baseline_name": baseline,
                "snapshot_at_iso": snap.isoformat(),
                "status": status.value,
                "expire_at_iso": expire_dt.isoformat(),
                "retained_days": retained_days,
                "changes": changes,
            }
            self._sandboxes[sb_id] = sb

            # R5.7: 为 3 个种子沙箱各预生成 12 条指标曲线
            self._indicators[sb_id] = self._gen_indicators_for_seed(sb_id, idx)

    def _gen_indicators_for_seed(
        self, sb_id: str, seed_offset: int,
    ) -> list[dict]:
        """为种子沙箱生成 12 项指标曲线 (dict 形式, 后续 model_validate)."""
        result: list[dict] = []
        for i, idef in enumerate(_INDICATOR_DEFS):
            points, status = _gen_curve(
                baseline=idef["baseline"],
                projected=idef["projected"],
                ratio=idef["ratio"],
                seed_offset=hash((sb_id, i, seed_offset)),
            )
            curve = {
                "indicator_id": idef["indicator_id"],
                "name": idef["name"],
                "baseline_value": idef["baseline"],
                "projected_value": idef["projected"],
                "curve_points": [p.model_dump(by_alias=True) for p in points],
                "unit": idef["unit"],
                "status": status,
            }
            result.append(curve)
        return result

    async def get_sandbox(self, sb_id: str) -> dict | None:
        async with self._lock:
            s = self._sandboxes.get(sb_id)
            return dict(s) if s else None

    async def list_by_enterprise(self, eid: str) -> list[dict]:
        async with self._lock:
            return [
                dict(s) for s in self._sandboxes.values()
                if s.get("enterprise_id") == eid
            ]

    async def put_sandbox(self, sb: dict) -> dict:
        async with self._lock:
            self._sandboxes[sb["id"]] = dict(sb)
            return dict(sb)

    async def list_all(self) -> list[dict]:
        async with self._lock:
            return [dict(s) for s in self._sandboxes.values()]

    async def get_indicators(self, sb_id: str) -> list[dict] | None:
        async with self._lock:
            if sb_id not in self._sandboxes:
                return None
            return [dict(c) for c in self._indicators.get(sb_id, [])]

    async def put_indicators(self, sb_id: str, indicators: list[dict]) -> list[dict]:
        async with self._lock:
            self._indicators[sb_id] = [dict(c) for c in indicators]
            return list(self._indicators[sb_id])

    async def purge_expired(self) -> int:
        now_iso = _now_iso()
        count = 0
        async with self._lock:
            to_delete: list[str] = []
            for sid, sb in self._sandboxes.items():
                expired = sb.get("expire_at_iso", "") < now_iso
                unconfirmed_timeout = False
                for c in sb.get("changes", []):
                    if not c.get("confirmed_at_iso"):
                        applied = c.get("applied_at_iso", "")
                        if applied and (now_iso > applied):
                            try:
                                ap_dt = datetime.fromisoformat(applied.replace("Z", "+00:00"))
                                if (datetime.now(timezone.utc) - ap_dt).days > 30:
                                    unconfirmed_timeout = True
                            except Exception:
                                unconfirmed_timeout = True
                if expired or unconfirmed_timeout:
                    to_delete.append(sid)
            for sid in to_delete:
                self._sandboxes.pop(sid, None)
                count += 1
        return count


_sb_store = _SandboxStore()


class ReformSandboxService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def create_sandbox(
        self, enterprise_id: str, baseline_name: str, retained_days: int = 30,
    ) -> Sandbox:
        now = datetime.now(timezone.utc)
        sb = {
            "id": _sb_id(),
            "enterprise_id": enterprise_id,
            "baseline_name": baseline_name,
            "snapshot_at_iso": now.isoformat(),
            "status": SandboxStatus.ACTIVE.value,
            "expire_at_iso": (now + timedelta(days=retained_days)).isoformat(),
            "retained_days": retained_days,
            "changes": [],
        }
        await _sb_store.put_sandbox(sb)
        return Sandbox.model_validate(sb)

    async def apply_change(self, sandbox_id: str, change: SandboxChange) -> SandboxChange:
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        change_dict = change.model_dump()
        if not change_dict.get("change_id"):
            change_dict["change_id"] = _ch_id()
        if not change_dict.get("applied_at_iso"):
            change_dict["applied_at_iso"] = _now_iso()
        change_dict["confirmed_at_iso"] = None
        sb["changes"].append(change_dict)
        await _sb_store.put_sandbox(sb)
        return SandboxChange.model_validate(change_dict)

    async def confirm_change(
        self, sandbox_id: str, change_id: str, operator: str,
    ) -> SandboxChange:
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        for c in sb["changes"]:
            if c.get("change_id") == change_id:
                c["confirmed_at_iso"] = _now_iso()
                c["confirmed_by"] = operator
                await _sb_store.put_sandbox(sb)
                return SandboxChange.model_validate(c)
        raise ValueError(f"Change {change_id} not found")

    async def diff_sandbox(self, sandbox_id: str) -> SandboxDiff:
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        changes = sb.get("changes", [])
        added = sum(1 for c in changes if not c.get("old_value") and c.get("new_value"))
        removed = sum(1 for c in changes if c.get("old_value") and not c.get("new_value"))
        modified = len(changes) - added - removed
        if added + removed + modified == 0 and len(changes) > 0:
            modified = len(changes)
        unconfirmed = sum(1 for c in changes if not c.get("confirmed_at_iso"))
        size = sum(
            len(str(c.get("old_value", ""))) + len(str(c.get("new_value", "")))
            for c in changes
        )
        return SandboxDiff(
            id=sandbox_id,
            added=added,
            removed=removed,
            modified=modified,
            unconfirmed_count=unconfirmed,
            total_size_bytes=size,
        )

    async def commit(self, sandbox_id: str, operator: str) -> Sandbox:
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        unconfirmed = [c for c in sb.get("changes", []) if not c.get("confirmed_at_iso")]
        if unconfirmed:
            raise ValueError(f"{len(unconfirmed)} 个变更尚未确认, 无法提交")
        sb["status"] = SandboxStatus.COMMITTED.value
        sb["committed_by"] = operator
        sb["committed_at_iso"] = _now_iso()
        for c in sb["changes"]:
            c["applied_status"] = "committed"
        await _sb_store.put_sandbox(sb)
        return Sandbox.model_validate(sb)

    async def rollback(self, sandbox_id: str, operator: str) -> Sandbox:
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        sb["status"] = SandboxStatus.ROLLED_BACK.value
        sb["rolled_back_by"] = operator
        sb["rolled_back_at_iso"] = _now_iso()
        await _sb_store.put_sandbox(sb)
        return Sandbox.model_validate(sb)

    async def check_auto_purge(self) -> PurgeInfo:
        purged = await _sb_store.purge_expired()
        all_sbs = await _sb_store.list_all()
        remaining_min = 9999
        now = datetime.now(timezone.utc)
        next_purge_at = now + timedelta(days=30)
        for s in all_sbs:
            try:
                exp = datetime.fromisoformat(s.get("expire_at_iso", "").replace("Z", "+00:00"))
                days_left = (exp - now).days
                if days_left < remaining_min:
                    remaining_min = max(0, days_left)
                    next_purge_at = exp
            except Exception:
                continue
        return PurgeInfo(
            purged_count=purged,
            remaining_days=remaining_min if remaining_min != 9999 else 30,
            will_auto_purge_at_iso=next_purge_at.isoformat(),
        )

    async def get_sandbox(self, sb_id: str) -> Sandbox | None:
        raw = await _sb_store.get_sandbox(sb_id)
        return Sandbox.model_validate(raw) if raw else None

    async def list_by_enterprise(self, eid: str) -> list[Sandbox]:
        raws = await _sb_store.list_by_enterprise(eid)
        return [Sandbox.model_validate(r) for r in raws]

    # ====================================================================
    # R5.7 12 项准入指标曲线 + 报告
    # ====================================================================

    async def generate_indicator_curves(self, sandbox_id: str) -> list[IndicatorCurve]:
        """生成 12 项准入指标曲线 (沙箱不存在则抛 ValueError).

        指标: 资产负债率 / 流动比率 / 速动比率 / 应收账款周转 / 存货周转 /
              营收增长率 / 净利润率 / ROE / ROA / 现金流量 / 利息保障 / 资产负债结构
        """
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        # 已种子化或之前已生成 → 直接返回缓存
        existing = await _sb_store.get_indicators(sandbox_id)
        if existing:
            return [IndicatorCurve.model_validate(c) for c in existing]

        # 现场生成 (基于沙箱 ID 哈希 + 12 项定义)
        curves: list[dict] = []
        for i, idef in enumerate(_INDICATOR_DEFS):
            points, status = _gen_curve(
                baseline=idef["baseline"],
                projected=idef["projected"],
                ratio=idef["ratio"],
                seed_offset=hash((sandbox_id, i)),
            )
            curves.append({
                "indicator_id": idef["indicator_id"],
                "name": idef["name"],
                "baseline_value": idef["baseline"],
                "projected_value": idef["projected"],
                "curve_points": [p.model_dump(by_alias=True) for p in points],
                "unit": idef["unit"],
                "status": status,
            })
        await _sb_store.put_indicators(sandbox_id, curves)
        return [IndicatorCurve.model_validate(c) for c in curves]

    async def generate_sandbox_report(self, sandbox_id: str) -> SandboxReport:
        """生成沙箱报告 (含 12 条指标曲线 + 风险标注).

        风险标注规则:
            - status=degraded 的指标 → 标注 "X 指标退化"
            - 投影值与基线方向相反 → 标注 "X 指标方向偏离"
            - 资产负债率投影 > 70% → 标注 "资产负债率偏高 (>70%)"
        """
        sb = await _sb_store.get_sandbox(sandbox_id)
        if not sb:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        indicators = await self.generate_indicator_curves(sandbox_id)
        risk_flags: list[str] = []
        for ind in indicators:
            iid = ind.indicator_id
            name = ind.name
            status_val = ind.status
            if status_val == "degraded":
                risk_flags.append(f"{name}({iid}) 退化")
            # 特殊阈值检查
            if iid == "asset_liability_ratio" and ind.projected_value > 0.70:
                risk_flags.append(f"{name} 偏高 (>70%)")
            if iid == "interest_coverage" and ind.projected_value < 2.0:
                risk_flags.append(f"{name} 偏低 (<2.0)")
            if iid == "revenue_growth_rate" and ind.projected_value < 0:
                risk_flags.append(f"{name} 为负增长")

        improved = sum(1 for i in indicators if i.status == "improved")
        degraded = sum(1 for i in indicators if i.status == "degraded")
        unchanged = sum(1 for i in indicators if i.status == "unchanged")
        summary = (
            f"沙箱 {sandbox_id} ({sb.get('baseline_name', '')}) 报告: "
            f"12 项指标中 {improved} 项改善, {degraded} 项退化, {unchanged} 项持平; "
            f"风险标注 {len(risk_flags)} 条."
        )
        return SandboxReport(
            sandbox_id=sandbox_id,
            indicators=indicators,
            summary=summary,
            risk_flags=risk_flags,
            generated_at_iso=_now_iso(),
        )

    # ====================================================================
    # R7.0 PDF 报告导出 (指标曲线图 + risk_flags 表格 + 改造建议)
    # ====================================================================

    async def export_pdf_report(
        self,
        enterprise_id: str,
        sandbox_result: SandboxReport | dict[str, Any],
        save_to_file: bool = False,
    ) -> bytes | str:
        """导出沙箱预演报告 PDF (指标曲线图 + risk_flags 表格 + 改造建议).

        Args:
            enterprise_id: 企业 ID
            sandbox_result: SandboxReport 实例 或 dict (含 12 条指标曲线 + risk_flags)
            save_to_file: True 时保存到 outputs/reform_sandbox/ 并返回路径;
                          False 时返回 PDF bytes

        Returns:
            PDF bytes (save_to_file=False) 或文件路径 (save_to_file=True)
            reportlab 不可用时降级为纯文本 bytes/路径 (扩展名仍 .pdf)
        """
        # 把 sandbox_result 归一化为 SandboxReport 实例, 取出指标 + risk_flags
        if isinstance(sandbox_result, dict):
            report = SandboxReport.model_validate(sandbox_result)
        else:
            report = sandbox_result
        indicators: list[IndicatorCurve] = list(report.indicators)
        risk_flags: list[str] = list(report.risk_flags)
        summary: str = report.summary
        sandbox_id: str = report.sandbox_id
        generated_at: str = report.generated_at_iso

        # 构造改造建议 (基于 risk_flags + 指标状态)
        recommendations = self._build_recommendations(indicators, risk_flags)

        if _reportlab_available():
            try:
                return self._write_pdf_with_reportlab(
                    enterprise_id=enterprise_id,
                    sandbox_id=sandbox_id,
                    summary=summary,
                    generated_at=generated_at,
                    indicators=indicators,
                    risk_flags=risk_flags,
                    recommendations=recommendations,
                    save_to_file=save_to_file,
                )
            except Exception as exc:
                logger.warning(
                    f"reportlab 生成沙箱报告 PDF 失败 ({exc}), 降级为纯文本"
                )

        # 降级: 纯文本报告 (扩展名仍 .pdf, 内容为文本)
        text_bytes = self._write_text_report(
            enterprise_id=enterprise_id,
            sandbox_id=sandbox_id,
            summary=summary,
            generated_at=generated_at,
            indicators=indicators,
            risk_flags=risk_flags,
            recommendations=recommendations,
        )
        if save_to_file:
            out_dir = _ensure_pdf_output_dir()
            fname = f"sandbox_report_{enterprise_id}_{sandbox_id}.pdf"
            path = os.path.join(out_dir, fname)
            with open(path, "wb") as f:
                f.write(text_bytes)
            return path
        return text_bytes

    @staticmethod
    def _build_recommendations(
        indicators: list[IndicatorCurve], risk_flags: list[str],
    ) -> list[str]:
        """基于 risk_flags + 指标状态构造改造建议清单.

        策略:
            - 退化指标 → 推荐针对性改造动作
            - risk_flags 中提到的阈值告警 → 对应改善动作
            - 若整体风险少 → 给出 "维持当前改造方向" 建议
        """
        recs: list[str] = []
        degraded = [i for i in indicators if i.status == IndicatorStatus.DEGRADED]
        if degraded:
            recs.append(
                f"针对 {len(degraded)} 项退化指标 ({', '.join(d.name for d in degraded[:3])}"
                f"{'...' if len(degraded) > 3 else ''}), 建议优先复盘相关改造动作."
            )

        for flag in risk_flags:
            if "资产负债率" in flag and "偏高" in flag:
                recs.append("压降短期借款 + 增加权益性融资, 将资产负债率降至 70% 以下.")
            elif "利息保障倍数" in flag and "偏低" in flag:
                recs.append("优化债务结构, 提升息税前利润, 利息保障倍数恢复至 2.0 以上.")
            elif "营收增长率" in flag and "负增长" in flag:
                recs.append("加大市场拓展 + 优化产品结构, 扭转营收负增长趋势.")
            elif "退化" in flag:
                # 通用退化建议
                recs.append(f"对 [{flag}] 进行专项诊断, 调整改造路径以恢复指标.")

        # 健康情况: 改善指标数量
        improved = sum(1 for i in indicators if i.status == IndicatorStatus.IMPROVED)
        if improved >= 8:
            recs.append(
                f"当前改造方向良好 ({improved}/12 项指标改善), 建议维持并扩大推广."
            )
        elif improved >= 5 and not degraded:
            recs.append(
                f"改造初见成效 ({improved}/12 项改善), 建议继续推进剩余指标."
            )

        if not recs:
            recs.append("暂无重大风险, 建议按既定路径推进改造.")
        return recs

    @staticmethod
    def _write_pdf_with_reportlab(
        enterprise_id: str,
        sandbox_id: str,
        summary: str,
        generated_at: str,
        indicators: list[IndicatorCurve],
        risk_flags: list[str],
        recommendations: list[str],
        save_to_file: bool,
    ) -> bytes | str:
        """使用 reportlab 生成 PDF (含指标曲线图 + risk_flags 表格 + 改造建议)."""
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.graphics.shapes import Drawing, Line, String
        from reportlab.graphics.charts.lineplots import LinePlot
        from reportlab.graphics.charts.axes import XCategoryAxis, YValueAxis
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
        )

        buffer = io.BytesIO()
        if save_to_file:
            out_dir = _ensure_pdf_output_dir()
            fname = f"sandbox_report_{enterprise_id}_{sandbox_id}.pdf"
            path = os.path.join(out_dir, fname)
            doc = SimpleDocTemplate(path, pagesize=A4,
                                    title=f"沙箱预演报告-{sandbox_id}",
                                    author="FinTrust Hub Reform Sandbox")
        else:
            doc = SimpleDocTemplate(
                buffer, pagesize=A4,
                title=f"沙箱预演报告-{sandbox_id}",
                author="FinTrust Hub Reform Sandbox",
            )

        styles = getSampleStyleSheet()
        story: list[Any] = []

        # === 标题 ===
        story.append(Paragraph(
            f"INFRA-04 改造沙箱预演报告", styles["Title"]))
        story.append(Spacer(1, 8))
        meta_rows = [
            ["企业 ID", enterprise_id],
            ["沙箱 ID", sandbox_id],
            ["生成时间 (UTC)", generated_at],
            ["指标数量", str(len(indicators))],
            ["风险标注数", str(len(risk_flags))],
        ]
        meta_table = Table(meta_rows, colWidths=[120, 320])
        meta_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 10))

        # === 摘要 ===
        story.append(Paragraph("<b>报告摘要</b>", styles["Heading2"]))
        story.append(Paragraph(summary, styles["Normal"]))
        story.append(Spacer(1, 10))

        # === 指标曲线图 (按行排列, 每行 2 个) ===
        story.append(Paragraph("<b>12 项指标曲线</b>", styles["Heading2"]))
        story.append(Spacer(1, 4))

        # reportlab LinePlot 用 list of (list of (x, y)) 一条线
        for ind in indicators:
            drawing = ReformSandboxService._build_indicator_drawing(ind)
            story.append(drawing)
            story.append(Spacer(1, 4))

        story.append(PageBreak())

        # === risk_flags 表格 ===
        story.append(Paragraph("<b>风险标注 (Risk Flags)</b>", styles["Heading2"]))
        story.append(Spacer(1, 6))
        if risk_flags:
            rf_rows = [["#", "风险标注"]] + [
                [str(i + 1), flag] for i, flag in enumerate(risk_flags)
            ]
        else:
            rf_rows = [["#", "风险标注"], ["1", "无风险标注"]]
        rf_table = Table(rf_rows, colWidths=[40, 400])
        rf_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9534f")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(rf_table)
        story.append(Spacer(1, 14))

        # === 改造建议 ===
        story.append(Paragraph("<b>改造建议</b>", styles["Heading2"]))
        story.append(Spacer(1, 4))
        for i, rec in enumerate(recommendations, start=1):
            story.append(Paragraph(f"{i}. {rec}", styles["Normal"]))
            story.append(Spacer(1, 2))

        # === 指标明细表 ===
        story.append(Spacer(1, 10))
        story.append(Paragraph("<b>指标明细</b>", styles["Heading2"]))
        story.append(Spacer(1, 4))
        detail_rows = [["指标 ID", "名称", "基线", "投影", "单位", "状态"]]
        for ind in indicators:
            detail_rows.append([
                ind.indicator_id, ind.name,
                f"{ind.baseline_value:.4f}", f"{ind.projected_value:.4f}",
                ind.unit, ind.status,
            ])
        detail_table = Table(detail_rows, colWidths=[100, 110, 60, 60, 40, 70])
        detail_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0275d8")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(detail_table)

        doc.build(story)
        if save_to_file:
            return path
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes

    @staticmethod
    def _build_indicator_drawing(ind: IndicatorCurve) -> Any:
        """为单个指标构造 LinePlot Drawing (基线 + 实际曲线 双线).

        手工绘制 (避免依赖 reportlab.graphics.charts 模块, 兼容性更好).
        """
        from reportlab.graphics.shapes import Drawing, Line, String, Rect
        from reportlab.lib import colors

        width = 460
        height = 150
        drawing = Drawing(width=width, height=height)

        # 状态颜色: improved=绿, degraded=红, unchanged=灰
        if ind.status == "improved":
            line_color = colors.HexColor("#5cb85c")
        elif ind.status == "degraded":
            line_color = colors.HexColor("#d9534f")
        else:
            line_color = colors.HexColor("#6c757d")

        # 绘图区边界
        plot_x = 50
        plot_y = 25
        plot_w = 380
        plot_h = 80

        # 背景框
        drawing.add(Rect(plot_x, plot_y, plot_w, plot_h,
                         fillColor=colors.HexColor("#f8f9fa"),
                         strokeColor=colors.HexColor("#dee2e6"),
                         strokeWidth=0.5))

        # 数据范围
        all_values = [ind.baseline_value] + [p.value for p in ind.curve_points]
        if not all_values:
            return drawing
        data_min = min(all_values)
        data_max = max(all_values)
        if data_min == data_max:
            data_min -= 1
            data_max += 1
        # 5% margin
        margin = (data_max - data_min) * 0.1 if data_max != data_min else 1
        y_min = data_min - margin
        y_max = data_max + margin

        def _y_to_pixel(value: float) -> float:
            """把数据值映射到 Drawing Y 像素."""
            if y_max == y_min:
                return plot_y + plot_h / 2
            return plot_y + (value - y_min) / (y_max - y_min) * plot_h

        points = ind.curve_points
        if not points:
            return drawing

        # X 轴: 12 个月等分
        def _i_to_x(i: int) -> float:
            n = max(len(points) - 1, 1)
            return plot_x + (i / n) * plot_w

        # 基线水平虚线
        baseline_y = _y_to_pixel(ind.baseline_value)
        # 用多段虚线模拟 (避免 Line.dashArray 兼容性问题)
        dash_segment = 4
        gap_segment = 2
        x_pos = plot_x
        while x_pos < plot_x + plot_w:
            x_end = min(x_pos + dash_segment, plot_x + plot_w)
            drawing.add(Line(x_pos, baseline_y, x_end, baseline_y,
                             strokeColor=colors.HexColor("#0275d8"),
                             strokeWidth=1.0))
            x_pos = x_end + gap_segment

        # 实际曲线 (实线, 多段连接)
        prev_x: float | None = None
        prev_y: float | None = None
        for i, p in enumerate(points):
            x = _i_to_x(i)
            y = _y_to_pixel(p.value)
            if prev_x is not None and prev_y is not None:
                drawing.add(Line(prev_x, prev_y, x, y,
                                 strokeColor=line_color, strokeWidth=1.5))
            prev_x = x
            prev_y = y
        # 数据点
        for i, p in enumerate(points):
            x = _i_to_x(i)
            y = _y_to_pixel(p.value)
            # 用小矩形作为数据点 (避免 Circle 兼容性问题)
            drawing.add(Rect(x - 1, y - 1, 2, 2,
                             fillColor=line_color, strokeColor=line_color))

        # Y 轴标签 (min/max)
        drawing.add(String(
            4, plot_y - 2, f"{y_min:.2f}",
            fontName="Helvetica", fontSize=6,
            fillColor=colors.HexColor("#666666"),
        ))
        drawing.add(String(
            4, plot_y + plot_h - 6, f"{y_max:.2f}",
            fontName="Helvetica", fontSize=6,
            fillColor=colors.HexColor("#666666"),
        ))

        # X 轴标签 (月份, 每 3 个月显示一个避免拥挤)
        for i, p in enumerate(points):
            if i % 3 != 0 and i != len(points) - 1:
                continue
            x = _i_to_x(i)
            drawing.add(String(
                x - 12, plot_y - 12, p.month_iso,
                fontName="Helvetica", fontSize=5,
                fillColor=colors.HexColor("#666666"),
            ))

        # 标题文字
        drawing.add(String(
            plot_x, plot_y + plot_h + 14,
            f"{ind.name} ({ind.indicator_id}) - {ind.status}",
            fontName="Helvetica-Bold", fontSize=9,
            fillColor=colors.HexColor("#333333"),
        ))
        # 基线 vs 投影值 注释
        drawing.add(String(
            plot_x + 250, plot_y + plot_h + 14,
            f"基线={ind.baseline_value:.2f}{ind.unit} -> 投影={ind.projected_value:.2f}{ind.unit}",
            fontName="Helvetica", fontSize=7,
            fillColor=colors.HexColor("#666666"),
        ))

        return drawing

    @staticmethod
    def _write_text_report(
        enterprise_id: str,
        sandbox_id: str,
        summary: str,
        generated_at: str,
        indicators: list[IndicatorCurve],
        risk_flags: list[str],
        recommendations: list[str],
    ) -> bytes:
        """纯文本降级报告 (UTF-8 bytes, 报告 PDF 无法生成时使用)."""
        lines: list[str] = []
        lines.append("=" * 60)
        lines.append("INFRA-04 改造沙箱预演报告 (文本降级版)")
        lines.append("=" * 60)
        lines.append(f"企业 ID: {enterprise_id}")
        lines.append(f"沙箱 ID: {sandbox_id}")
        lines.append(f"生成时间 (UTC): {generated_at}")
        lines.append(f"指标数量: {len(indicators)}")
        lines.append(f"风险标注数: {len(risk_flags)}")
        lines.append("")
        lines.append("[报告摘要]")
        lines.append(summary)
        lines.append("")
        lines.append("[12 项指标曲线]")
        for ind in indicators:
            months = [p.month_iso for p in ind.curve_points]
            values = [f"{p.value:.2f}" for p in ind.curve_points]
            lines.append(
                f"- {ind.name} ({ind.indicator_id}) [{ind.status}] "
                f"基线={ind.baseline_value:.2f}{ind.unit} → "
                f"投影={ind.projected_value:.2f}{ind.unit}"
            )
            lines.append(f"  月份: {', '.join(months)}")
            lines.append(f"  数值: {', '.join(values)}")
        lines.append("")
        lines.append("[风险标注]")
        if risk_flags:
            for i, flag in enumerate(risk_flags, start=1):
                lines.append(f"{i}. {flag}")
        else:
            lines.append("(无风险标注)")
        lines.append("")
        lines.append("[改造建议]")
        for i, rec in enumerate(recommendations, start=1):
            lines.append(f"{i}. {rec}")
        lines.append("")
        lines.append("=" * 60)
        lines.append("(本文件由 reform_sandbox_service 生成, reportlab 不可用降级为文本)")
        text = "\n".join(lines)
        return text.encode("utf-8")


reform_sandbox_service = ReformSandboxService(db=None)
