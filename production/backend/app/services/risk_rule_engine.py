"""MOD-02 智能风控 — 风控规则 DSL + 热加载 + 编译执行引擎 (R4.7).

设计依据: spec.md MOD-02 L437-505 智能风控引擎.
功能:
    1. parse_dsl(dsl_text) -> RiskRule (DSL 解析为结构化规则)
    2. compile_rule(rule) -> callable (编译为可执行函数)
    3. evaluate(tx_data) -> RiskEvaluationResult (按 priority 排序执行, 累加 risk_score_delta)
    4. load_ruleset / hot_reload (规则集加载, 支持手动热加载)
    5. add_rule / update_rule / delete_rule / enable_rule / disable_rule (规则 CRUD)

DSL 格式:
    WHEN <conditions> THEN <action> SCORE +<delta>
    条件示例:
        amount > 5000000                          (GT)
        counterparty IN ["黑名单A","黑名单B"]      (IN)
        hour BETWEEN 22 AND 06                    (映射为 hour >= 22 OR hour < 6)
        invoice_amount > contract_amount          (跨字段比较, 简化为 GT)

降级策略: 内存单例 _RiskRuleStore + asyncio.Lock + _seed + db=None 注入,
        保证零机构接入时仍可独立运行 (遵循 project_memory "C 档兜底" 原则).

设计风格参照 bank_service.py / responsibility_chain_service.py.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from uuid import uuid4

from app.schemas.risk_rule import (
    RiskEvaluationResult, RiskRule, RiskRuleCreate, RiskRuleSet,
    RuleAction, RuleCondition, RuleLogic, RuleOperator, RulesetStatus,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "rr") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


# ============================================================================
# DSL 解析
# ============================================================================

# DSL 正则: WHEN <conditions> THEN <action> SCORE +<delta>
_DSL_RE = re.compile(
    r"^\s*WHEN\s+(?P<cond>.+?)\s+THEN\s+(?P<action>pass|flag|block|manual_review)"
    r"(?:\s+SCORE\s+\+(?P<delta>\d+))?\s*$",
    re.IGNORECASE,
)

# 单个条件正则 (支持: field op value, field IN [list], field BETWEEN a AND b)
_COND_GT_RE = re.compile(r"(\w+)\s*>\s*(\d+(\.\d+)?)")
_COND_GTE_RE = re.compile(r"(\w+)\s*>=\s*(\d+(\.\d+)?)")
_COND_LT_RE = re.compile(r"(\w+)\s*<\s*(\d+(\.\d+)?)")
_COND_LTE_RE = re.compile(r"(\w+)\s*<=\s*(\d+(\.\d+)?)")
_COND_EQ_RE = re.compile(r"(\w+)\s*==\s*(\d+(\.\d+)?)")
_COND_NE_RE = re.compile(r"(\w+)\s*!=\s*(\d+(\.\d+)?)")
_COND_IN_RE = re.compile(r'(\w+)\s+IN\s*\[([^\]]*)\]', re.IGNORECASE)
_COND_CONTAINS_RE = re.compile(r'(\w+)\s+CONTAINS\s+"([^"]*)"', re.IGNORECASE)
_COND_BETWEEN_RE = re.compile(r"(\w+)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)", re.IGNORECASE)


def _split_conditions(cond_str: str) -> list[str]:
    """按 AND/OR 拆分条件 (保留逻辑运算符)."""
    # 简化: 按 " AND " / " OR " 拆分
    parts = re.split(r"\s+(?:AND|OR)\s+", cond_str, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()]


def _parse_single_condition(c: str) -> Optional[RuleCondition]:
    """解析单条条件为 RuleCondition. BETWEEN 特殊处理为 IN (用集合近似)."""
    # IN [...]
    m = _COND_IN_RE.match(c)
    if m:
        field_path = m.group(1)
        raw_list = m.group(2)
        # 解析列表元素 (支持 "黑名单A","黑名单B" 形式)
        items = [s.strip().strip('"').strip("'") for s in raw_list.split(",")]
        items = [i for i in items if i]
        return RuleCondition(
            field_path=field_path,
            operator=RuleOperator.IN,
            value=items,
        )
    # CONTAINS "..."
    m = _COND_CONTAINS_RE.match(c)
    if m:
        return RuleCondition(
            field_path=m.group(1),
            operator=RuleOperator.CONTAINS,
            value=m.group(2),
        )
    # BETWEEN a AND b → IN {a..b} 近似为两个字段比较 (这里用 IN 范围集合近似不可行)
    # 改为存为特殊条件: operator=IN, value={"min": a, "max": b}
    m = _COND_BETWEEN_RE.match(c)
    if m:
        return RuleCondition(
            field_path=m.group(1),
            operator=RuleOperator.IN,  # 复用 IN, value 为 dict {min,max} (compile 时特殊处理)
            value={"min": int(m.group(2)), "max": int(m.group(3))},
        )
    # >= / <= / != / == / > / <
    for op_re, op in [
        (_COND_GTE_RE, RuleOperator.GTE),
        (_COND_LTE_RE, RuleOperator.LTE),
        (_COND_NE_RE, RuleOperator.NE),
        (_COND_EQ_RE, RuleOperator.EQ),
        (_COND_GT_RE, RuleOperator.GT),
        (_COND_LT_RE, RuleOperator.LT),
    ]:
        m = op_re.match(c)
        if m:
            val_str = m.group(2)
            try:
                val: Any = int(val_str)
            except ValueError:
                val = float(val_str)
            return RuleCondition(
                field_path=m.group(1),
                operator=op,
                value=val,
            )
    return None


# ============================================================================
# 编译为可执行函数
# ============================================================================

def _resolve_field(tx_data: dict, field_path: str) -> Any:
    """从 tx_data 解析字段值 (支持 amount / counterparty.name / hour 等)."""
    if not field_path:
        return None
    if "." in field_path:
        parts = field_path.split(".")
        cur: Any = tx_data
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
        return cur
    return tx_data.get(field_path)


def _apply_operator(op: RuleOperator | str, lhs: Any, rhs: Any) -> bool:
    """执行单次运算符比较. lhs 为字段实际值, rhs 为规则定义的值."""
    if isinstance(op, RuleOperator):
        op_str = op.value
    else:
        op_str = str(op).upper()
    # BETWEEN 近似: rhs = {min, max}
    if op_str == "IN" and isinstance(rhs, dict) and "min" in rhs and "max" in rhs:
        if lhs is None:
            return False
        try:
            v = int(lhs)
            return rhs["min"] <= v <= rhs["max"]
        except (TypeError, ValueError):
            return False
    if op_str == "IN":
        if lhs is None:
            return False
        # rhs 应是 list
        if not isinstance(rhs, (list, tuple, set)):
            return False
        return lhs in set(rhs)
    if op_str == "NOT_IN":
        if lhs is None:
            return True
        if not isinstance(rhs, (list, tuple, set)):
            return True
        return lhs not in set(rhs)
    if op_str == "CONTAINS":
        if lhs is None or not isinstance(lhs, str):
            return False
        return str(rhs) in lhs
    if op_str == "REGEX":
        if lhs is None:
            return False
        try:
            return re.search(str(rhs), str(lhs)) is not None
        except re.error:
            return False
    # 数值/字符串比较: == != > >= < <=
    if lhs is None:
        return False
    try:
        if op_str == "EQ":
            return lhs == rhs
        if op_str == "NE":
            return lhs != rhs
        if op_str == "GT":
            return float(lhs) > float(rhs)
        if op_str == "GTE":
            return float(lhs) >= float(rhs)
        if op_str == "LT":
            return float(lhs) < float(rhs)
        if op_str == "LTE":
            return float(lhs) <= float(rhs)
    except (TypeError, ValueError):
        return False
    return False


def _compile_condition(cond: RuleCondition) -> Callable[[dict], bool]:
    """编译单条条件为可执行函数."""
    field_path = cond.field_path
    op = cond.operator
    rhs = cond.value

    def _check(tx_data: dict) -> bool:
        lhs = _resolve_field(tx_data, field_path)
        return _apply_operator(op, lhs, rhs)

    return _check


def _compile_rule(rule: RiskRule) -> Callable[[dict], bool]:
    """编译整条规则为可执行函数 (按 logic 组合条件)."""
    checks = [_compile_condition(c) for c in rule.conditions]
    logic = rule.logic
    if isinstance(logic, RuleLogic):
        logic_val = logic.value
    else:
        logic_val = str(logic).upper()

    if logic_val == "ALL":
        def _all(tx_data: dict) -> bool:
            return all(check(tx_data) for check in checks)
        return _all
    else:  # ANY
        def _any(tx_data: dict) -> bool:
            return any(check(tx_data) for check in checks)
        return _any


# ============================================================================
# 内存状态
# ============================================================================

class _RiskRuleStore:
    """风控规则 + 规则集 内存兜底数据."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # ruleset_id -> RiskRuleSet dict
        self._rulesets: dict[str, dict] = {}
        # rule_id -> RiskRule dict
        self._rules: dict[str, dict] = {}
        # rule_id -> compiled callable (热加载时清空重建)
        self._compiled: dict[str, Callable[[dict], bool]] = {}
        self._seed()

    def _seed(self) -> None:
        """2 个 Ruleset (标准/严格) + 10 条规则."""
        now = _now_iso()

        # === 规则集 1: 标准 (active) ===
        rs1_id = "RS-STD-001"
        std_rules = [
            # R1: 单笔大额交易冻结 (block, +50)
            {
                "ruleId": "RR-001", "ruleName": "单笔大额交易冻结",
                "description": "amount > 5000000 时阻断",
                "conditions": [{"fieldPath": "amount", "operator": "GT", "value": 5000000}],
                "logic": "ALL", "action": "block", "riskScoreDelta": 50,
                "priority": 10, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R2: 对手方黑名单 (block, +60)
            {
                "ruleId": "RR-002", "ruleName": "对手方黑名单",
                "description": 'counterparty IN ["黑名单A","黑名单B"]',
                "conditions": [{
                    "fieldPath": "counterparty",
                    "operator": "IN",
                    "value": ["黑名单A", "黑名单B"],
                }],
                "logic": "ALL", "action": "block", "riskScoreDelta": 60,
                "priority": 5, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R3: 夜间交易预警 (flag, +20)
            {
                "ruleId": "RR-003", "ruleName": "夜间交易预警",
                "description": "hour BETWEEN 22 AND 06 → flag",
                "conditions": [{
                    "fieldPath": "hour",
                    "operator": "IN",
                    "value": {"min": 22, "max": 6},  # 跨午夜, compile 时简化
                }],
                "logic": "ALL", "action": "flag", "riskScoreDelta": 20,
                "priority": 50, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R4: 高频交易 (flag, +25)
            {
                "ruleId": "RR-004", "ruleName": "高频交易预警",
                "description": "tx_count_1h > 10 → flag",
                "conditions": [{
                    "fieldPath": "tx_count_1h", "operator": "GT", "value": 10,
                }],
                "logic": "ALL", "action": "flag", "riskScoreDelta": 25,
                "priority": 60, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R5: 跨境交易复核 (manual_review, +30)
            {
                "ruleId": "RR-005", "ruleName": "跨境交易复核",
                "description": "is_cross_border == True → manual_review",
                "conditions": [{
                    "fieldPath": "is_cross_border", "operator": "EQ", "value": True,
                }],
                "logic": "ALL", "action": "manual_review", "riskScoreDelta": 30,
                "priority": 70, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R6: 票据空头 (block, +45)
            {
                "ruleId": "RR-006", "ruleName": "票据空头",
                "description": "invoice_amount > contract_amount → block",
                # 跨字段比较: 简化为先看 invoice_amount 字段是否 > contract_amount
                # 这里用 GT operator 但 rhs 是字段引用 (在 compile 时特殊处理: 若 value 是 str 且以 $ 开头, 视为字段引用)
                "conditions": [{
                    "fieldPath": "invoice_amount",
                    "operator": "GT",
                    "value": "$contract_amount",  # $ 前缀表示字段引用
                }],
                "logic": "ALL", "action": "block", "riskScoreDelta": 45,
                "priority": 20, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R7: 关联方资金回流 (flag, +35) 默认禁用 (待 Neo4j 接入)
            {
                "ruleId": "RR-007", "ruleName": "关联方资金回流",
                "description": "related_backflow == True → flag",
                "conditions": [{
                    "fieldPath": "related_backflow", "operator": "EQ", "value": True,
                }],
                "logic": "ALL", "action": "flag", "riskScoreDelta": 35,
                "priority": 80, "enabled": False, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
            # R8: 大额现金提取 (block, +55)
            {
                "ruleId": "RR-008", "ruleName": "大额现金提取",
                "description": "amount > 1000000 AND is_cash == True → block",
                "conditions": [
                    {"fieldPath": "amount", "operator": "GT", "value": 1000000},
                    {"fieldPath": "is_cash", "operator": "EQ", "value": True},
                ],
                "logic": "ALL", "action": "block", "riskScoreDelta": 55,
                "priority": 15, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs1_id,
            },
        ]
        self._rulesets[rs1_id] = {
            "rulesetId": rs1_id, "name": "标准规则集",
            "rules": std_rules, "version": 1,
            "effectiveFromIso": now, "effectiveToIso": None,
            "status": RulesetStatus.ACTIVE.value,
        }
        for r in std_rules:
            self._rules[r["ruleId"]] = dict(r)
            self._compiled[r["ruleId"]] = self._compile_dict(r)

        # === 规则集 2: 严格 (active, 用于高风险企业) ===
        rs2_id = "RS-STRICT-002"
        strict_rules = [
            # R9: 中额交易复核 (manual_review, +20)
            {
                "ruleId": "RR-009", "ruleName": "中额交易复核",
                "description": "amount > 1000000 → manual_review",
                "conditions": [{"fieldPath": "amount", "operator": "GT", "value": 1000000}],
                "logic": "ALL", "action": "manual_review", "riskScoreDelta": 20,
                "priority": 30, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs2_id,
            },
            # R10: 任何跨境交易阻断 (block, +40)
            {
                "ruleId": "RR-010", "ruleName": "严格跨境阻断",
                "description": "is_cross_border == True → block (严格集)",
                "conditions": [{
                    "fieldPath": "is_cross_border", "operator": "EQ", "value": True,
                }],
                "logic": "ALL", "action": "block", "riskScoreDelta": 40,
                "priority": 8, "enabled": True, "version": 1,
                "createdAtIso": now, "updatedAtIso": now, "rulesetId": rs2_id,
            },
        ]
        self._rulesets[rs2_id] = {
            "rulesetId": rs2_id, "name": "严格规则集",
            "rules": strict_rules, "version": 1,
            "effectiveFromIso": now, "effectiveToIso": None,
            "status": RulesetStatus.ACTIVE.value,
        }
        for r in strict_rules:
            self._rules[r["ruleId"]] = dict(r)
            self._compiled[r["ruleId"]] = self._compile_dict(r)

    def _compile_dict(self, rule_dict: dict) -> Callable[[dict], bool]:
        """从 dict 构造 RiskRule 并编译. 处理 $field 字段引用."""
        # 构造 conditions
        conditions: list[RuleCondition] = []
        for c in rule_dict.get("conditions", []):
            conditions.append(RuleCondition(
                field_path=c["fieldPath"],
                operator=c["operator"],
                value=c["value"],
            ))
        # 处理 $field 引用: 转为 closure
        # 简化: 直接构造 lambda
        logic_val = rule_dict.get("logic", "ALL")
        checks: list[Callable[[dict], bool]] = []
        for cond in conditions:
            checks.append(self._compile_condition_with_field_ref(cond))

        if logic_val == "ALL":
            def _all(tx_data: dict) -> bool:
                return all(c(tx_data) for c in checks)
            return _all
        else:
            def _any(tx_data: dict) -> bool:
                return any(c(tx_data) for c in checks)
            return _any

    def _compile_condition_with_field_ref(
        self, cond: RuleCondition,
    ) -> Callable[[dict], bool]:
        """编译条件, 支持字段引用 ($ 前缀的 value 视为另一字段路径)."""
        field_path = cond.field_path
        op = cond.operator
        rhs = cond.value

        def _check(tx_data: dict) -> bool:
            lhs = _resolve_field(tx_data, field_path)
            # 字段引用解析
            actual_rhs: Any = rhs
            if isinstance(rhs, str) and rhs.startswith("$"):
                ref_field = rhs[1:]
                actual_rhs = _resolve_field(tx_data, ref_field)
            # BETWEEN 跨午夜 (min > max, 如 22-06): 视为 hour >= 22 OR hour < 6
            if (
                op in (RuleOperator.IN,)
                and isinstance(rhs, dict)
                and "min" in rhs and "max" in rhs
                and rhs["min"] > rhs["max"]
            ):
                if lhs is None:
                    return False
                try:
                    v = int(lhs)
                    return v >= rhs["min"] or v <= rhs["max"]
                except (TypeError, ValueError):
                    return False
            return _apply_operator(op, lhs, actual_rhs)

        return _check

    # === CRUD ===

    async def list_rules(
        self,
        ruleset_id: Optional[str] = None,
        enabled_only: bool = False,
    ) -> list[dict]:
        async with self._lock:
            rules = list(self._rules.values())
            if ruleset_id:
                rules = [r for r in rules if r.get("rulesetId") == ruleset_id]
            if enabled_only:
                rules = [r for r in rules if r.get("enabled")]
            return [dict(r) for r in rules]

    async def get_rule(self, rule_id: str) -> Optional[dict]:
        async with self._lock:
            r = self._rules.get(rule_id)
            return dict(r) if r else None

    async def add_rule(self, rule: dict) -> dict:
        async with self._lock:
            self._rules[rule["ruleId"]] = dict(rule)
            self._compiled[rule["ruleId"]] = self._compile_dict(rule)
            return dict(rule)

    async def update_rule(self, rule_id: str, patch: dict) -> Optional[dict]:
        async with self._lock:
            if rule_id not in self._rules:
                return None
            self._rules[rule_id].update(patch)
            self._rules[rule_id]["ruleId"] = rule_id
            self._rules[rule_id]["updatedAtIso"] = _now_iso()
            self._compiled[rule_id] = self._compile_dict(self._rules[rule_id])
            return dict(self._rules[rule_id])

    async def delete_rule(self, rule_id: str) -> bool:
        async with self._lock:
            if rule_id in self._rules:
                del self._rules[rule_id]
                self._compiled.pop(rule_id, None)
                return True
            return False

    async def list_rulesets(self, status: Optional[str] = None) -> list[dict]:
        async with self._lock:
            rulesets = list(self._rulesets.values())
            if status:
                rulesets = [r for r in rulesets if r.get("status") == status]
            return [dict(r) for r in rulesets]

    async def get_ruleset(self, ruleset_id: str) -> Optional[dict]:
        async with self._lock:
            rs = self._rulesets.get(ruleset_id)
            return dict(rs) if rs else None

    async def upsert_ruleset(self, ruleset_id: str, rs: dict) -> dict:
        async with self._lock:
            self._rulesets[ruleset_id] = dict(rs)
            # 同时重建规则集内所有规则的 compiled
            for r in rs.get("rules", []):
                if r["ruleId"] in self._rules:
                    self._compiled[r["ruleId"]] = self._compile_dict(r)
            return dict(rs)

    def get_compiled(self, rule_id: str) -> Optional[Callable[[dict], bool]]:
        """同步获取编译函数 (评估时无需 await)."""
        return self._compiled.get(rule_id)


_risk_rule_store = _RiskRuleStore()


# ============================================================================
# 风控规则引擎服务
# ============================================================================

class RiskRuleEngine:
    """风控规则 DSL + 热加载 + 编译执行引擎 (MOD-02)."""

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入

    # === DSL 解析 ===

    def parse_dsl(self, dsl_text: str) -> RiskRule:
        """解析 DSL 文本为 RiskRule.

        DSL 格式:
            WHEN <conditions> THEN <action> SCORE +<delta>
        条件示例:
            amount > 5000000
            counterparty IN ["黑名单A","黑名单B"]
            hour BETWEEN 22 AND 06
        多条件以 AND / OR 连接, 默认 logic=ALL (有 OR 出现则用 ANY).
        """
        m = _DSL_RE.match(dsl_text)
        if not m:
            raise ValueError(f"DSL 解析失败: {dsl_text!r} (期望 WHEN ... THEN ...)")

        cond_str = m.group("cond")
        action_str = m.group("action").lower()
        delta = int(m.group("delta")) if m.group("delta") else 0

        # 拆分条件 + 提取逻辑
        has_or = bool(re.search(r"\s+OR\s+", cond_str, re.IGNORECASE))
        logic = RuleLogic.ANY if has_or else RuleLogic.ALL

        cond_parts = _split_conditions(cond_str)
        conditions: list[RuleCondition] = []
        for c in cond_parts:
            parsed = _parse_single_condition(c)
            if parsed is None:
                raise ValueError(f"无法解析条件: {c!r}")
            conditions.append(parsed)

        action_map = {
            "pass": RuleAction.PASS,
            "flag": RuleAction.FLAG,
            "block": RuleAction.BLOCK,
            "manual_review": RuleAction.MANUAL_REVIEW,
        }

        now = _now_iso()
        return RiskRule(
            rule_id=_id("RR"),
            rule_name=f"DSL-{now[-12:]}",
            description=dsl_text,
            conditions=conditions,
            logic=logic,
            action=action_map[action_str],
            risk_score_delta=delta,
            priority=100,
            enabled=True,
            version=1,
            created_at_iso=now,
            updated_at_iso=now,
            ruleset_id=None,
        )

    # === 编译 ===

    def compile_rule(self, rule: RiskRule) -> Callable[[dict], bool]:
        """编译规则为可执行函数 (接收 tx_data dict, 返回 bool 命中)."""
        # 检查是否已编译并缓存 (按 rule_id)
        compiled = _risk_rule_store.get_compiled(rule.rule_id)
        if compiled is not None:
            return compiled
        # 否则现场编译
        return _compile_rule(rule)

    # === 评估 ===

    async def evaluate(
        self,
        tx_data: dict,
        ruleset_id: Optional[str] = None,
    ) -> RiskEvaluationResult:
        """按 priority 排序执行规则, 累加 risk_score_delta.

        action 优先级: block > manual_review > flag > pass (取命中最严重的).
        """
        start = time.perf_counter()
        rules = await _risk_rule_store.list_rules(
            ruleset_id=ruleset_id, enabled_only=True,
        )
        # 按 priority 升序 (小=先执行)
        rules.sort(key=lambda r: r.get("priority", 100))

        triggered_rule_ids: list[str] = []
        explanations: list[str] = []
        total_score = 0
        # 动作严重性权重
        severity_rank = {
            "pass": 0, "flag": 1, "manual_review": 2, "block": 3,
        }
        worst_action = "pass"

        for r in rules:
            compiled = _risk_rule_store.get_compiled(r["ruleId"])
            if compiled is None:
                # 现场编译
                rule_obj = RiskRule.model_validate(r)
                compiled = _compile_rule(rule_obj)
            try:
                hit = compiled(tx_data)
            except Exception as e:
                logger.warning(f"rule {r['ruleId']} evaluate error: {e}")
                hit = False
            if hit:
                triggered_rule_ids.append(r["ruleId"])
                total_score += r.get("riskScoreDelta", 0)
                action_val = r.get("action", "flag")
                if isinstance(action_val, RuleAction):
                    action_val = action_val.value
                if severity_rank.get(action_val, 0) > severity_rank.get(worst_action, 0):
                    worst_action = action_val
                explanations.append(
                    f"命中 {r['ruleName']} (ruleId={r['ruleId']}): "
                    f"action={action_val}, score_delta=+{r.get('riskScoreDelta', 0)}"
                )

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        # action 归一化为 RuleAction 枚举值
        try:
            action_enum = RuleAction(worst_action)
            action_val = action_enum.value
        except ValueError:
            action_val = "pass"

        return RiskEvaluationResult(
            eval_id=_id("EVAL"),
            enterprise_id=tx_data.get("enterprise_id"),
            tx_id=tx_data.get("tx_id"),
            triggered_rules=triggered_rule_ids,
            total_risk_score=total_score,
            action=action_val,
            evaluation_time_ms=elapsed_ms,
            explanations=explanations if explanations else ["无规则命中, 放行"],
            timestamp_iso=_now_iso(),
        )

    # === 规则集加载 + 热加载 ===

    async def load_ruleset(self, ruleset_id: str) -> RiskRuleSet:
        """从内存加载规则集 (含其下所有规则)."""
        rs = await _risk_rule_store.get_ruleset(ruleset_id)
        if not rs:
            raise ValueError(f"规则集 {ruleset_id} 不存在")
        rules = await _risk_rule_store.list_rules(ruleset_id=ruleset_id)
        rs_dict = dict(rs)
        rs_dict["rules"] = rules
        return RiskRuleSet.model_validate(rs_dict)

    async def hot_reload(self, ruleset_id: str) -> RiskRuleSet:
        """手动触发热加载 (清空并重建该规则集下所有规则的编译缓存)."""
        # 当前内存实现: 重新编译该 ruleset 下所有规则
        async with _risk_rule_store._lock:
            for rule_id, rule_dict in list(_risk_rule_store._rules.items()):
                if rule_dict.get("rulesetId") == ruleset_id:
                    _risk_rule_store._compiled[rule_id] = (
                        _risk_rule_store._compile_dict(rule_dict)
                    )
            rs = _risk_rule_store._rulesets.get(ruleset_id)
            if rs:
                # 版本 +1 标记热加载
                rs["version"] = rs.get("version", 1) + 1
        return await self.load_ruleset(ruleset_id)

    # === 规则 CRUD ===

    async def add_rule(self, rule: RiskRuleCreate) -> RiskRule:
        rule_id = _id("RR")
        now = _now_iso()
        rule_dict = {
            "ruleId": rule_id,
            "ruleName": rule.rule_name,
            "description": rule.description,
            "conditions": [c.model_dump(by_alias=True) for c in rule.conditions],
            "logic": rule.logic.value if isinstance(rule.logic, RuleLogic) else rule.logic,
            "action": rule.action.value if isinstance(rule.action, RuleAction) else rule.action,
            "riskScoreDelta": rule.risk_score_delta,
            "priority": rule.priority,
            "enabled": rule.enabled,
            "version": 1,
            "createdAtIso": now,
            "updatedAtIso": now,
            "rulesetId": rule.ruleset_id,
        }
        await _risk_rule_store.add_rule(rule_dict)
        return RiskRule.model_validate(rule_dict)

    async def update_rule(self, rule_id: str, patch: dict) -> Optional[RiskRule]:
        # 转换 RuleCondition 列表为 dict
        if "conditions" in patch and patch["conditions"] is not None:
            patch["conditions"] = [
                c.model_dump(by_alias=True) if hasattr(c, "model_dump") else c
                for c in patch["conditions"]
            ]
        if "logic" in patch and isinstance(patch["logic"], RuleLogic):
            patch["logic"] = patch["logic"].value
        if "action" in patch and isinstance(patch["action"], RuleAction):
            patch["action"] = patch["action"].value
        updated = await _risk_rule_store.update_rule(rule_id, patch)
        return RiskRule.model_validate(updated) if updated else None

    async def delete_rule(self, rule_id: str) -> bool:
        return await _risk_rule_store.delete_rule(rule_id)

    async def enable_rule(self, rule_id: str) -> Optional[RiskRule]:
        return await self.update_rule(rule_id, {"enabled": True})

    async def disable_rule(self, rule_id: str) -> Optional[RiskRule]:
        return await self.update_rule(rule_id, {"enabled": False})

    async def list_rules(
        self,
        ruleset_id: Optional[str] = None,
        enabled_only: bool = False,
    ) -> list[RiskRule]:
        items = await _risk_rule_store.list_rules(
            ruleset_id=ruleset_id, enabled_only=enabled_only,
        )
        return [RiskRule.model_validate(r) for r in items]

    async def list_rulesets(self, status: Optional[str] = None) -> list[RiskRuleSet]:
        items = await _risk_rule_store.list_rulesets(status=status)
        results: list[RiskRuleSet] = []
        for rs in items:
            rs_copy = dict(rs)
            # 拉取关联规则
            rs_rules = await _risk_rule_store.list_rules(ruleset_id=rs["rulesetId"])
            rs_copy["rules"] = rs_rules
            results.append(RiskRuleSet.model_validate(rs_copy))
        return results


risk_rule_engine = RiskRuleEngine(db=None)
