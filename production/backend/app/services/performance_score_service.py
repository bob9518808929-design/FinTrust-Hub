from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import yaml

from app.schemas.performance import PerformanceScore, PerfTrend

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _month_iso(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


# === LLM 评分 prompt 模板路径 (R5.3) ===
_PROMPT_TEMPLATE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "llm_score_prompt_template.yaml",
)


class _PerfStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._scores: dict[str, dict] = {}
        self._trends: dict[str, list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        enterprises = ["E001", "E002", "E003", "E004"]
        now = datetime.now(UTC)
        base_pd = {"E001": 8.0, "E002": 3.5, "E003": 18.0, "E004": 5.0}
        base_ioy = {"E001": 82.0, "E002": 92.0, "E003": 65.0, "E004": 88.0}

        for eid in enterprises:
            trend: list[dict] = []
            pd_start = base_pd[eid]
            ioy_start = base_ioy[eid]
            for m in range(11, -1, -1):
                year = now.year
                month = now.month - m
                if month <= 0:
                    year -= 1
                    month += 12
                drift_pd = random.uniform(-1.5, 1.5) if m > 0 else 0
                drift_ioy = random.uniform(-2.0, 2.0) if m > 0 else 0
                pd_val = max(0.0, min(100.0, pd_start + drift_pd + m * 0.3))
                ioy_val = max(0.0, min(100.0, ioy_start + drift_ioy - m * 0.2))
                trend.append({
                    "monthIso": _month_iso(year, month),
                    "pd": round(pd_val, 2),
                    "ioy": round(ioy_val, 2),
                })
            self._trends[eid] = trend
            latest = trend[-1]
            self._scores[eid] = {
                "enterpriseId": eid,
                "pdPercent": latest["pd"],
                "ioyPercent": latest["ioy"],
                "factors": [
                    "历史履约记录良好",
                    "应收账款周转健康",
                    "现金流覆盖倍数1.8x",
                    "政策匹配度85%",
                ],
                "lastUpdatedAt": _now_iso(),
                "dataSources": ["bank_flow", "tax", "invoice", "external_gsxt"],
            }

    async def get_score(self, eid: str) -> dict | None:
        async with self._lock:
            s = self._scores.get(eid)
            return dict(s) if s else None

    async def set_score(self, eid: str, score: dict) -> dict:
        async with self._lock:
            self._scores[eid] = dict(score)
            return dict(score)

    async def get_trend(self, eid: str, months: int = 12) -> list[dict]:
        async with self._lock:
            t = self._trends.get(eid, [])
            return [dict(x) for x in t[-months:]]


_perf_store = _PerfStore()


class PerformanceScoreService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db
        # R5.3: 懒加载 LLM 评分 prompt 模板
        self._prompt_template: dict[str, str] | None = None

    # === LLM 评分 prompt 模板加载 (R5.3) ===

    def _load_prompt_template(self) -> dict[str, str]:
        """加载 config/llm_score_prompt_template.yaml.

        文件缺失时使用内置默认模板, 保证业务不中断.
        """
        if self._prompt_template is not None:
            return self._prompt_template
        default_system = (
            "你是一名资深金融风控专家, 专精企业履约能力评估. "
            "请基于企业概况+财务指标+行业+历史违约, 严格输出 JSON: "
            '{"pd":<0-100>, "ioy":<0-100>, "factors":[...], "reasoning":"..."}'
        )
        default_user = (
            "评估企业 {enterprise_id} 履约能力.\n"
            "财务指标: {financial_data}\n"
            "行业: {industry_info}\n"
            "历史违约: {history_default}\n"
            "输出 JSON (pd, ioy, factors, reasoning)."
        )
        try:
            with open(_PROMPT_TEMPLATE_PATH, encoding="utf-8") as f:
                tpl = yaml.safe_load(f) or {}
            self._prompt_template = {
                "system_prompt": tpl.get("system_prompt", default_system),
                "user_prompt_template": tpl.get("user_prompt_template", default_user),
            }
        except Exception as exc:
            logger.warning(f"加载 LLM 评分模板失败 ({exc}), 用默认模板")
            self._prompt_template = {
                "system_prompt": default_system,
                "user_prompt_template": default_user,
            }
        return self._prompt_template

    # === 构建评分 prompt (R5.3) ===

    def _build_llm_prompt(
        self, enterprise_id: str, financial_data: dict,
    ) -> str:
        """构建评分 prompt: 企业概况 + 财务指标 + 行业 + 历史违约.

        Args:
            enterprise_id: 企业 ID.
            financial_data: 财务数据 (营收/利润/现金流/应收/存货/负债等, 元单位).

        Returns:
            完整 prompt 字符串 (用于 _call_llm_score 的 user message).
        """
        tpl = self._load_prompt_template()

        # 从 financial_data 中提取核心指标 (兼容多种键名)
        revenue = financial_data.get("revenue") or financial_data.get("营业收入", 0)
        net_profit = financial_data.get("net_profit") or financial_data.get("净利润", 0)
        cashflow = financial_data.get("operating_cashflow") or financial_data.get("经营性现金流", 0)
        receivables = financial_data.get("receivables") or financial_data.get("应收账款", 0)
        inventory = financial_data.get("inventory") or financial_data.get("存货", 0)
        total_debt = financial_data.get("total_debt") or financial_data.get("总负债", 0)
        industry = financial_data.get("industry") or financial_data.get("行业", "制造业")
        history = financial_data.get("history_default") or financial_data.get("历史违约", "无")

        # 企业概况 (基本信息)
        enterprise_profile = (
            f"企业 ID: {enterprise_id}, 行业: {industry}, "
            f"近12月营收 {revenue:,.2f} 元, 净利润 {net_profit:,.2f} 元."
        )
        financial_section = (
            f"营收={revenue}, 净利润={net_profit}, 经营现金流={cashflow}, "
            f"应收账款={receivables}, 存货={inventory}, 总负债={total_debt}"
        )
        industry_info = industry
        history_default = str(history)

        # 用 str.format 安全填充 (避免 KeyError 用 **)
        try:
            user = tpl["user_prompt_template"].format(
                enterprise_id=enterprise_id,
                enterprise_profile=enterprise_profile,
                financial_data=financial_section,
                industry_info=industry_info,
                history_default=history_default,
            )
        except KeyError:
            # 模板含未提供的占位符, 退化为简单拼接
            user = (
                f"{enterprise_profile}\n"
                f"财务指标: {financial_section}\n"
                f"行业: {industry_info}\n"
                f"历史违约: {history_default}\n"
                "输出 JSON: {pd, ioy, factors, reasoning}"
            )
        # system + user 一起返回 (供 _call_llm_score 拆分 messages)
        return f"[SYSTEM]\n{tpl['system_prompt']}\n\n[USER]\n{user}"

    # === 调用 LLM 评分 (R5.3) ===

    async def _call_llm_score(self, prompt: str) -> dict:
        """调用 llm_service 进行 LLM 深度评分.

        Args:
            prompt: 由 _build_llm_prompt 构建的完整 prompt (含 [SYSTEM] / [USER] 段).

        Returns:
            {"pd": float, "ioy": float, "factors": list[str], "reasoning": str}.
            LLM 不可用 / 输出非法 JSON 时返回空 dict (触发降级).
        """
        # 拆分 prompt 为 messages
        messages: list[dict] = []
        try:
            if "[SYSTEM]" in prompt and "[USER]" in prompt:
                parts = prompt.split("\n\n[USER]\n", 1)
                sys_text = parts[0].replace("[SYSTEM]\n", "").strip()
                user_text = parts[1].strip() if len(parts) > 1 else ""
                messages = [
                    {"role": "system", "content": sys_text},
                    {"role": "user", "content": user_text},
                ]
            else:
                messages = [{"role": "user", "content": prompt}]
        except Exception:
            messages = [{"role": "user", "content": prompt}]

        try:
            from app.services.llm_service import llm_service
            if not llm_service.available:
                logger.info("LLM 不可用 (无 API Key), deep_score 将降级到规则评分")
                return {}
            resp = await llm_service.chat(
                messages=messages,
                scene="perf_deep_score",
            )
            if resp.get("fallback") not in (None, "none"):
                logger.info(f"LLM 返回 fallback={resp.get('fallback')}, deep_score 降级")
                return {}
            content = resp.get("content", "").strip()
            # 去除可能的 markdown 代码块
            if content.startswith("```"):
                content = content.lstrip("`")
                # 去除语言标识 (json / ``` 等)
                if content.startswith("json"):
                    content = content[4:]
                content = content.rstrip("`").strip()
            # 严格 JSON 解析
            data = json.loads(content)
            if not isinstance(data, dict):
                return {}
            pd_val = float(data.get("pd", 0))
            ioy_val = float(data.get("ioy", 0))
            factors = data.get("factors", [])
            if not isinstance(factors, list):
                factors = []
            factors = [str(f) for f in factors][:10]
            reasoning = str(data.get("reasoning", ""))[:1000]
            return {
                "pd": max(0.0, min(100.0, pd_val)),
                "ioy": max(0.0, min(100.0, ioy_val)),
                "factors": factors,
                "reasoning": reasoning,
            }
        except json.JSONDecodeError as exc:
            logger.warning(f"LLM 评分输出非合法 JSON ({exc}), deep_score 降级")
            return {}
        except Exception as exc:
            logger.warning(f"LLM 评分调用失败 ({exc}), deep_score 降级")
            return {}

    # === LLM 深度评分 (R5.3) ===

    async def deep_score(self, enterprise_id: str) -> PerformanceScore:
        """LLM 深度评分 (降级到规则评分).

        流程:
            1. 拉取种子财务数据 (mock, 真实环境从财务模块读取)
            2. _build_llm_prompt 构建 prompt
            3. _call_llm_score 调用 LLM, 失败降级到 compute(use_llm=False)
        """
        # 准备财务数据 (mock; 真实环境从 enterprise_service / 财务模块读取)
        existing = await _perf_store.get_score(enterprise_id)
        financial_data = self._gather_financial_data(enterprise_id, existing)
        prompt = self._build_llm_prompt(enterprise_id, financial_data)
        llm_result = await self._call_llm_score(prompt)

        if not llm_result:
            # 降级规则评分 (沿用 compute 的逻辑)
            logger.info(f"deep_score for {enterprise_id} 走规则评分降级")
            return await self.compute(enterprise_id, use_llm=False)

        # 用 LLM 结果覆盖 (与种子基线 30% 权重混合, 防止极端)
        seed_pd = existing.get("pdPercent", 5.0) if existing else 5.0
        seed_ioy = existing.get("ioyPercent", 90.0) if existing else 90.0
        pd_val = round(0.3 * seed_pd + 0.7 * llm_result["pd"], 2)
        ioy_val = round(0.3 * seed_ioy + 0.7 * llm_result["ioy"], 2)

        factors = llm_result.get("factors") or [
            "LLM 深度评分: 财务指标分析",
            "行业景气度评估",
            "历史违约风险",
        ]
        score_dict = {
            "enterpriseId": enterprise_id,
            "pdPercent": pd_val,
            "ioyPercent": ioy_val,
            "factors": factors,
            "lastUpdatedAt": _now_iso(),
            "dataSources": ["bank_flow", "tax", "invoice", "llm_deep_score"],
            "reasoning": llm_result.get("reasoning", ""),
        }
        await _perf_store.set_score(enterprise_id, score_dict)
        return PerformanceScore.model_validate(score_dict)

    @staticmethod
    def _gather_financial_data(
        enterprise_id: str, existing: dict | None,
    ) -> dict:
        """收集企业财务数据 (mock, 真实环境对接企业财务模块)."""
        rng = random.Random(hash(enterprise_id))
        revenue = rng.uniform(10_000_000, 200_000_000)
        net_profit = revenue * rng.uniform(-0.05, 0.18)
        cashflow = revenue * rng.uniform(0.02, 0.20)
        receivables = revenue * rng.uniform(0.05, 0.40)
        inventory = revenue * rng.uniform(0.05, 0.35)
        total_debt = revenue * rng.uniform(0.20, 0.85)
        return {
            "enterprise_id": enterprise_id,
            "industry": "制造业",
            "revenue": round(revenue, 2),
            "net_profit": round(net_profit, 2),
            "operating_cashflow": round(cashflow, 2),
            "receivables": round(receivables, 2),
            "inventory": round(inventory, 2),
            "total_debt": round(total_debt, 2),
            "history_default": "无近 3 年违约记录",
            "base_pd": existing.get("pdPercent") if existing else None,
            "base_ioy": existing.get("ioyPercent") if existing else None,
        }

    async def compute(self, enterprise_id: str, use_llm: bool = True) -> PerformanceScore:
        existing = await _perf_store.get_score(enterprise_id)
        if existing:
            pd_val = existing["pdPercent"]
            ioy_val = existing["ioyPercent"]
        else:
            pd_val = round(random.uniform(5.0, 25.0), 2)
            ioy_val = round(random.uniform(60.0, 95.0), 2)

        if use_llm:
            try:
                from app.services.llm_service import llm_service
                if llm_service.available:
                    resp = await llm_service.chat(
                        messages=[
                            {"role": "system", "content": "你是金融风控专家。"},
                            {"role": "user", "content": f"评估企业 {enterprise_id} 的违约概率PD(0-100)和履约能力IOY(0-100)，只返回两个数字用逗号分隔。"},
                        ],
                        enterprise_id=enterprise_id,
                        scene="perf_score",
                    )
                    if resp.get("fallback") == "none":
                        content = resp.get("content", "")
                        parts = [p.strip() for p in content.replace("，", ",").split(",")]
                        if len(parts) >= 2:
                            try:
                                llm_pd = max(0.0, min(100.0, float(parts[0])))
                                llm_ioy = max(0.0, min(100.0, float(parts[1])))
                                pd_val = round(0.4 * pd_val + 0.6 * llm_pd, 2)
                                ioy_val = round(0.4 * ioy_val + 0.6 * llm_ioy, 2)
                            except (ValueError, IndexError):
                                pass
            except Exception:
                pass

        score = {
            "enterpriseId": enterprise_id,
            "pdPercent": pd_val,
            "ioyPercent": ioy_val,
            "factors": [
                "历史履约记录分析",
                "现金流压力测试",
                "行业政策匹配度",
                "责任链完整度",
            ],
            "lastUpdatedAt": _now_iso(),
            "dataSources": ["bank_flow", "tax", "invoice", "policy_db"],
        }
        await _perf_store.set_score(enterprise_id, score)
        return PerformanceScore.model_validate(score)

    async def trend(self, enterprise_id: str, months: int = 12) -> list[PerfTrend]:
        items = await _perf_store.get_trend(enterprise_id, months)
        return [PerfTrend.model_validate(x) for x in items]

    # ====================================================================
    # V3 历史趋势预测 (MOD-06)
    # ====================================================================

    async def predict_historical_trend(
        self, enterprise_id: str, months: int = 12,
    ) -> list[dict]:
        """按月生成 PD 违约概率趋势 + IoY 履约能力趋势 + 预测.

        Args:
            enterprise_id: 企业 ID.
            months: 历史月份数 (默认 12).

        Returns:
            list[{
                "month_iso": str (YYYY-MM),
                "pd_score": float (0-100, 违约概率),
                "ioy_score": float (0-100, 履约能力),
                "trend": "up"|"down"|"stable" (与上月相比趋势),
                "is_forecast": bool (是否为预测值),
            }]

        实现:
            1. 拉取最近 N 个月历史趋势 (从 _perf_store)
            2. 用 mock 历史数据补齐 (若不足 N 个月)
            3. 用线性回归预测未来 3 个月 (is_forecast=True)
            4. 计算每月 trend (与上月比 up/down/stable)
        """
        if months < 1:
            months = 12
        if months > 36:
            months = 36

        # 拉取历史趋势 (从 _perf_store, 已 seed 12 个月)
        historical = await _perf_store.get_trend(enterprise_id, months)

        # 补齐: 若历史不足 months 个月, 用 mock 生成更早的历史
        if len(historical) < months:
            existing_months = {h["monthIso"] for h in historical}
            now = datetime.now(UTC)
            # 找出最早的月份, 向前补齐
            if historical:
                earliest = historical[0]["monthIso"]
                try:
                    earliest_dt = datetime.strptime(earliest, "%Y-%m")
                except ValueError:
                    earliest_dt = now
            else:
                earliest_dt = now
                # 没有历史数据时, 用 mock 基线
                historical = [{
                    "monthIso": _month_iso(now.year, now.month),
                    "pd": 8.0,
                    "ioy": 80.0,
                }]
                existing_months = {historical[0]["monthIso"]}
                earliest_dt = now

            # 向前补齐到 months 个月
            need = months - len(historical)
            base_pd = historical[0]["pd"]
            base_ioy = historical[0]["ioy"]
            for i in range(1, need + 1):
                # 月份回退 i 个月
                dt = earliest_dt.replace(day=1) - timedelta(days=30 * i)
                month_iso = _month_iso(dt.year, dt.month)
                if month_iso in existing_months:
                    continue
                # mock: 早期 PD 略低 (经营尚可), IoY 略高
                drift_pd = random.uniform(-2.0, 1.0)
                drift_ioy = random.uniform(-1.0, 2.0)
                historical.insert(0, {
                    "monthIso": month_iso,
                    "pd": round(max(0.0, min(100.0, base_pd + drift_pd)), 2),
                    "ioy": round(max(0.0, min(100.0, base_ioy + drift_ioy)), 2),
                })
                existing_months.add(month_iso)

        # 截取最近 months 个月
        historical = historical[-months:]

        # 用简单线性回归预测未来 3 个月 (基于最近 6 个月数据)
        forecast_count = 3
        forecast: list[dict] = []
        if len(historical) >= 2:
            # 取最近 min(6, len) 个月做回归
            sample = historical[-min(6, len(historical)):]
            xs = list(range(len(sample)))
            pd_ys = [float(s["pd"]) for s in sample]
            ioy_ys = [float(s["ioy"]) for s in sample]
            pd_slope = self._linear_regression_slope(xs, pd_ys)
            ioy_slope = self._linear_regression_slope(xs, ioy_ys)
            last = historical[-1]
            try:
                last_dt = datetime.strptime(last["monthIso"], "%Y-%m")
            except ValueError:
                last_dt = datetime.now(UTC)
            for i in range(1, forecast_count + 1):
                # 月份前进 i 个月
                year = last_dt.year
                month = last_dt.month + i
                while month > 12:
                    year += 1
                    month -= 12
                # 用线性回归外推 + 轻微噪声
                pd_pred = max(0.0, min(100.0, last["pd"] + pd_slope * i))
                ioy_pred = max(0.0, min(100.0, last["ioy"] + ioy_slope * i))
                forecast.append({
                    "month_iso": _month_iso(year, month),
                    "pd_score": round(pd_pred, 2),
                    "ioy_score": round(ioy_pred, 2),
                    "is_forecast": True,
                })

        # 合并历史 + 预测, 计算 trend
        combined: list[dict] = []
        prev_pd: float | None = None
        prev_ioy: float | None = None
        for h in historical:
            pd_val = float(h["pd"])
            ioy_val = float(h["ioy"])
            if prev_pd is None or prev_ioy is None:
                trend = "stable"
            else:
                pd_delta = pd_val - prev_pd
                ioy_delta = ioy_val - prev_ioy
                # PD 下降或 IoY 上升 → up (履约能力提升)
                # PD 上升或 IoY 下降 → down (履约能力下降)
                # 变化 < 0.5 视为 stable
                if pd_delta < -0.5 or ioy_delta > 0.5:
                    trend = "up"
                elif pd_delta > 0.5 or ioy_delta < -0.5:
                    trend = "down"
                else:
                    trend = "stable"
            combined.append({
                "month_iso": h["monthIso"],
                "pd_score": round(pd_val, 2),
                "ioy_score": round(ioy_val, 2),
                "trend": trend,
                "is_forecast": False,
            })
            prev_pd = pd_val
            prev_ioy = ioy_val

        # 衔接 forecast 的 trend
        for f in forecast:
            if prev_pd is None or prev_ioy is None:
                trend = "stable"
            else:
                pd_delta = f["pd_score"] - prev_pd
                ioy_delta = f["ioy_score"] - prev_ioy
                if pd_delta < -0.5 or ioy_delta > 0.5:
                    trend = "up"
                elif pd_delta > 0.5 or ioy_delta < -0.5:
                    trend = "down"
                else:
                    trend = "stable"
            f["trend"] = trend
            combined.append(f)
            prev_pd = f["pd_score"]
            prev_ioy = f["ioy_score"]

        return combined

    @staticmethod
    def _linear_regression_slope(xs: list[int], ys: list[float]) -> float:
        """简单线性回归斜率 (最小二乘法).

        Returns:
            slope: 趋势斜率 (每步 y 的变化量).
        """
        n = len(xs)
        if n < 2:
            return 0.0
        sum_x = sum(xs)
        sum_y = sum(ys)
        sum_xy = sum(x * y for x, y in zip(xs, ys, strict=False))
        sum_x2 = sum(x * x for x in xs)
        denom = n * sum_x2 - sum_x * sum_x
        if denom == 0:
            return 0.0
        return (n * sum_xy - sum_x * sum_y) / denom


performance_score_service = PerformanceScoreService(db=None)
