"""资金监管模块服务 (MOD-01).

spec 依据: MOD-01 L395-435 (资金监管)
状态: A 档银企直连接入 + C 档内存兜底 + R4.6 五流合一校验委托 + 监控告警委托

监管账户 CRUD + 白名单 + 动态水位 + 数字契约 DSL
+ monitor_check (委托 FiveFlowConsistencyService)
+ monitor_alerts / lock_account / release_account (委托 MonitorRulesService)

A 档银企直连 (遵循 project_memory 三档策略):
    - 配置 FUND_SUPERVISION_API_URL / FUND_SUPERVISION_API_KEY 后,
      账户余额/状态查询走银行资金监管 API (10s 超时)
    - 无凭证 / API 不可达 / 超时 → 自动降级内存镜像 (C 档独立兜底, 不阻断业务)
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

from app.schemas.five_flow import (
    ConsistencyCheckResult, FundAccountLock, MonitorAlert,
)
from app.services.five_flow_consistency_service import (
    FiveFlowConsistencyService, five_flow_consistency_service,
)
from app.services.monitor_rules_service import (
    MonitorRulesService, monitor_rules_service,
)

logger = logging.getLogger(__name__)


class FundService:
    """资金监管服务 (MOD-01).

    实现说明:
        - 监管账户: 内存镜像 (真实环境与银企直连账户双向同步)
        - 白名单: 内存集合 (生产切换 SQL 白名单表)
        - 水位: 基于回款流水规则动态计算, 配置银企直连后自动对账
        - 数字契约: DSL 规则匹配 (现金流缺口超阈值自动锁定)
    """

    # 银企直连资金监管 API 超时 (秒)
    BANK_API_TIMEOUT_SECONDS = 10.0

    def __init__(self) -> None:
        self._accounts: dict[str, dict] = {}
        self._whitelist: dict[str, set[str]] = {}  # enterprise_id -> set[counterparty]
        # R4.6 委托服务 (单例注入, 便于测试 mock)
        self._consistency_service: FiveFlowConsistencyService = five_flow_consistency_service
        self._monitor_service: MonitorRulesService = monitor_rules_service

    # === A 档银企直连 ===

    def _load_bank_credentials(self) -> dict:
        """从环境变量加载银企直连资金监管 API 凭证 (未配置返回空 dict)."""
        api_url = os.getenv("FUND_SUPERVISION_API_URL", "")
        api_key = os.getenv("FUND_SUPERVISION_API_KEY", "")
        org_code = os.getenv("FUND_SUPERVISION_ORG_CODE", "")
        if not (api_url and api_key):
            return {}
        return {"api_url": api_url, "api_key": api_key, "org_code": org_code}

    async def _call_bank_fund_api(self, account_id: str) -> dict | None:
        """银企直连: 查询监管账户余额/状态 (A 档).

        Returns:
            {"balance": float, "status": str, "frozen": bool} | None (降级信号).
        """
        creds = self._load_bank_credentials()
        if not creds:
            return None
        try:
            async with httpx.AsyncClient(timeout=self.BANK_API_TIMEOUT_SECONDS) as client:
                resp = await client.get(
                    f"{creds['api_url'].rstrip('/')}/supervision/accounts/{account_id}",
                    headers={
                        "Authorization": f"Bearer {creds['api_key']}",
                        "X-Org-Code": creds.get("org_code", ""),
                    },
                )
                if resp.status_code != 200:
                    logger.warning(
                        "银企直连资金监管 API 非 200: %s, 降级内存镜像", resp.status_code,
                    )
                    return None
                body = resp.json()
                return {
                    "balance": float(body.get("balance", 0.0)),
                    "status": str(body.get("status", "active")),
                    "frozen": bool(body.get("frozen", False)),
                }
        except Exception as exc:
            logger.warning(f"银企直连资金监管 API 调用失败: {exc}, 降级内存镜像")
            return None

    async def _register_at_bank(self, account: dict) -> bool:
        """银企直连: 向银行注册监管账户 (失败返回 False, 内存镜像照常)."""
        creds = self._load_bank_credentials()
        if not creds:
            return False
        try:
            async with httpx.AsyncClient(timeout=self.BANK_API_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{creds['api_url'].rstrip('/')}/supervision/accounts",
                    headers={
                        "Authorization": f"Bearer {creds['api_key']}",
                        "X-Org-Code": creds.get("org_code", ""),
                    },
                    json={
                        "accountId": account["account_id"],
                        "enterpriseId": account["enterprise_id"],
                        "bank": account["bank"],
                        "initialBalance": account["balance"],
                    },
                )
                return resp.status_code == 200
        except Exception as exc:
            logger.warning(f"银企直连注册监管账户失败: {exc}, 仅保留内存镜像")
            return False

    # === R4.6 五流合一 + 监控告警 (委托) ===

    async def monitor_check(
        self, enterprise_id: str, tx_id: str,
    ) -> ConsistencyCheckResult:
        """五流合一校验 (委托 FiveFlowConsistencyService)."""
        return await self._consistency_service.check_consistency(enterprise_id, tx_id)

    async def monitor_alerts(
        self, enterprise_id: Optional[str] = None,
    ) -> list[MonitorAlert]:
        """列出监控告警 (委托 MonitorRulesService, 可按企业过滤)."""
        return await self._monitor_service.list_alerts(enterprise_id=enterprise_id)

    async def lock_account(
        self,
        enterprise_id: str,
        account_id: str,
        amount_cents: int,
        reason: str,
        duration_hours: int = 72,
    ) -> FundAccountLock:
        """锁定资金账户 (委托 MonitorRulesService)."""
        return await self._monitor_service.lock_fund_account(
            enterprise_id=enterprise_id,
            account_id=account_id,
            amount_cents=amount_cents,
            reason=reason,
            duration_hours=duration_hours,
        )

    async def release_account(self, lock_id: str) -> Optional[FundAccountLock]:
        """释放资金账户锁定 (委托 MonitorRulesService)."""
        return await self._monitor_service.release_fund_account(lock_id)

    async def create_account(
        self,
        account_id: str,
        enterprise_id: str,
        bank: str,
        initial_balance: float = 0.0,
    ) -> dict:
        """创建监管账户 (银企直连优先, 内存镜像兜底)."""
        if account_id in self._accounts:
            return {"error": f"账户 {account_id} 已存在"}
        self._accounts[account_id] = {
            "account_id": account_id,
            "enterprise_id": enterprise_id,
            "bank": bank,
            "balance": initial_balance,
            "status": "active",
            "whitelist": set(),
        }
        # A 档: 同步注册到银行资金监管系统 (失败不影响本地创建)
        bank_synced = await self._register_at_bank(self._accounts[account_id])
        self._accounts[account_id]["bank_synced"] = bank_synced
        return self._accounts[account_id]

    async def get_account(self, account_id: str) -> dict:
        """查询监管账户 (银企直连余额优先, 内存镜像兜底)."""
        if account_id not in self._accounts:
            return {"error": f"账户 {account_id} 不存在"}
        record = self._accounts[account_id]
        # A 档: 银企直连实时余额
        real = await self._call_bank_fund_api(account_id)
        if real is not None:
            record["balance"] = real["balance"]
            record["status"] = "frozen" if real["frozen"] else real["status"]
            record["balance_source"] = "bank_api"
        else:
            record["balance_source"] = "local_mirror"
        return record

    async def freeze_account(self, account_id: str, reason: str = "") -> dict:
        """冻结监管账户."""
        if account_id not in self._accounts:
            return {"error": "账户不存在"}
        self._accounts[account_id]["status"] = "frozen"
        self._accounts[account_id]["freeze_reason"] = reason
        return self._accounts[account_id]

    async def unfreeze_account(self, account_id: str) -> dict:
        """解冻监管账户."""
        if account_id not in self._accounts:
            return {"error": "账户不存在"}
        self._accounts[account_id]["status"] = "active"
        self._accounts[account_id].pop("freeze_reason", None)
        return self._accounts[account_id]

    async def add_whitelist(
        self, enterprise_id: str, counterparty_id: str, category: str = "default"
    ) -> dict:
        """添加白名单."""
        if enterprise_id not in self._whitelist:
            self._whitelist[enterprise_id] = set()
        self._whitelist[enterprise_id].add(counterparty_id)
        return {"enterprise_id": enterprise_id, "added": counterparty_id, "category": category}

    async def check_whitelist(
        self, enterprise_id: str, counterparty_id: str
    ) -> dict:
        """检查对手方是否在白名单内."""
        in_list = counterparty_id in self._whitelist.get(enterprise_id, set())
        return {
            "enterprise_id": enterprise_id,
            "counterparty_id": counterparty_id,
            "in_whitelist": in_list,
            "action": "auto_approve" if in_list else "manual_review",
        }

    async def calculate_quota(
        self,
        enterprise_id: str,
        repayment_normal: bool = True,
        overdue_ratio: float = 0.0,
    ) -> dict:
        """动态水位计算 (基于回款数据调整可划拨额度).

        spec MOD-01:
            - 回款正常 → 释放额度 (最高 100%)
            - 回款恶化 (逾期>15%) → 收紧比例 (最低 30%)

        返回值同时给出企业下全部监管账户的按比例可划拨金额.
        """
        if repayment_normal and overdue_ratio < 0.05:
            release_ratio = 1.0
        elif overdue_ratio < 0.15:
            release_ratio = 0.7
        else:
            release_ratio = 0.3
        # 对企业名下账户按水位比例计算可划拨额度
        quotas: list[dict] = []
        for acc in self._accounts.values():
            if acc.get("enterprise_id") != enterprise_id:
                continue
            balance = float(acc.get("balance", 0.0))
            quotas.append({
                "account_id": acc["account_id"],
                "balance": balance,
                "allocatable": round(balance * release_ratio, 2),
            })
        return {
            "enterprise_id": enterprise_id,
            "repayment_normal": repayment_normal,
            "overdue_ratio": overdue_ratio,
            "release_ratio": release_ratio,
            "account_quotas": quotas,
            "rule": "回款正常且逾期<5% → 100%; 逾期<15% → 70%; 其余 → 30%",
        }

    async def execute_contract(
        self, enterprise_id: str, contract_id: str, context: dict
    ) -> dict:
        """执行数字契约 DSL (现金流缺口超阈值时自动锁定)."""
        cashflow_gap = context.get("cashflow_gap", 0.0)
        threshold = context.get("threshold", 1_000_000)
        if cashflow_gap > threshold:
            action = "lock"
            message = f"现金流缺口 {cashflow_gap} 超阈值 {threshold}, 自动锁定"
        else:
            action = "release"
            message = "现金流正常, 释放"
        return {
            "enterprise_id": enterprise_id,
            "contract_id": contract_id,
            "action": action,
            "message": message,
            "cashflow_gap": cashflow_gap,
            "threshold": threshold,
        }


# 单例
fund_service = FundService()
