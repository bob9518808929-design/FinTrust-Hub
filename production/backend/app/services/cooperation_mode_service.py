from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.schemas.cooperation import (
    CooperationMode, ModeConfig, SwitchResult,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_FULL_TRUST_PERMS: dict[str, list[str]] = {
    "bank_auditor": ["view_all", "approve_loan", "view_risk", "export_report"],
    "enterprise_cfo": ["view_own", "submit_loan", "manage_guarantee"],
    "risk_officer": ["view_all", "reject_loan", "audit"],
    "guest": ["view_public"],
}

_CO_LENDING_PERMS: dict[str, list[str]] = {
    "bank_auditor": ["view_all", "approve_loan_up_to_5m", "view_risk"],
    "partner_bank": ["view_shared", "approve_their_share"],
    "enterprise_cfo": ["view_own", "submit_loan"],
    "risk_officer": ["view_all", "audit"],
    "guest": ["view_public"],
}

_GUARANTEED_PERMS: dict[str, list[str]] = {
    "bank_auditor": ["view_all", "approve_loan_with_guarantee"],
    "guarantor": ["view_guaranteed", "approve_guarantee", "claim_compensation"],
    "enterprise_cfo": ["view_own", "submit_loan", "pay_guarantee_fee"],
    "risk_officer": ["view_all", "audit"],
    "guest": ["view_public"],
}

_INSURED_PERMS: dict[str, list[str]] = {
    "bank_auditor": ["view_all", "approve_loan_with_insurance"],
    "insurer": ["view_insured", "approve_insurance", "settle_claim"],
    "enterprise_cfo": ["view_own", "submit_loan", "pay_premium"],
    "risk_officer": ["view_all", "audit"],
    "guest": ["view_public"],
}

_MODE_DESCRIPTIONS: dict[CooperationMode, str] = {
    CooperationMode.FULL_TRUST: "全额出资模式: 银行全额出资并承担 100% 风险, 企业纯信用授信, 适用于 A 级以上存量优质客户",
    CooperationMode.CO_LENDING: "联合贷模式: 两家银行按比例出资, 风险与利息按出资比例分担, 适用于大额分散授信",
    CooperationMode.GUARANTEED: "担保模式: 担保公司提供连带责任担保, 银行出资本金, 保费企业承担, 适用于中小微 B/C 级客户",
    CooperationMode.INSURED: "保司兜底模式: 保险公司承保信用险, 坏账由保司赔付 (80% 上限), 适用于轻资产贸易类客户",
}

_REQUIRED_MODULES: dict[CooperationMode, list[str]] = {
    CooperationMode.FULL_TRUST: ["risk_scorecard", "responsibility_chain", "bank_flow"],
    CooperationMode.CO_LENDING: ["risk_scorecard", "responsibility_chain", "bank_flow", "eco_contract", "data_privacy"],
    CooperationMode.GUARANTEED: ["risk_scorecard", "responsibility_chain", "bank_flow", "guarantee_module"],
    CooperationMode.INSURED: ["risk_scorecard", "responsibility_chain", "bank_flow", "insurance_module", "invoice_pool"],
}


def _build_configs() -> dict[CooperationMode, dict]:
    cfgs: dict[CooperationMode, dict] = {}
    cfgs[CooperationMode.FULL_TRUST] = {
        "mode": CooperationMode.FULL_TRUST.value,
        "interestSplitPctBank": 100.0,
        "riskSharePctBank": 100.0,
        "requiredModules": _REQUIRED_MODULES[CooperationMode.FULL_TRUST],
        "permissionMatrix": _FULL_TRUST_PERMS,
        "description": _MODE_DESCRIPTIONS[CooperationMode.FULL_TRUST],
    }
    cfgs[CooperationMode.CO_LENDING] = {
        "mode": CooperationMode.CO_LENDING.value,
        "interestSplitPctBank": 60.0,
        "riskSharePctBank": 50.0,
        "requiredModules": _REQUIRED_MODULES[CooperationMode.CO_LENDING],
        "permissionMatrix": _CO_LENDING_PERMS,
        "description": _MODE_DESCRIPTIONS[CooperationMode.CO_LENDING],
    }
    cfgs[CooperationMode.GUARANTEED] = {
        "mode": CooperationMode.GUARANTEED.value,
        "interestSplitPctBank": 85.0,
        "riskSharePctBank": 15.0,
        "requiredModules": _REQUIRED_MODULES[CooperationMode.GUARANTEED],
        "permissionMatrix": _GUARANTEED_PERMS,
        "description": _MODE_DESCRIPTIONS[CooperationMode.GUARANTEED],
    }
    cfgs[CooperationMode.INSURED] = {
        "mode": CooperationMode.INSURED.value,
        "interestSplitPctBank": 90.0,
        "riskSharePctBank": 20.0,
        "requiredModules": _REQUIRED_MODULES[CooperationMode.INSURED],
        "permissionMatrix": _INSURED_PERMS,
        "description": _MODE_DESCRIPTIONS[CooperationMode.INSURED],
    }
    return cfgs


class _CoopStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._enterprise_modes: dict[str, str] = {}
        self._configs = _build_configs()
        self._seed()

    def _seed(self) -> None:
        self._enterprise_modes["E001"] = CooperationMode.FULL_TRUST.value
        self._enterprise_modes["E002"] = CooperationMode.CO_LENDING.value
        self._enterprise_modes["E003"] = CooperationMode.GUARANTEED.value
        self._enterprise_modes["E004"] = CooperationMode.INSURED.value

    async def get_mode(self, eid: str) -> str | None:
        async with self._lock:
            return self._enterprise_modes.get(eid)

    async def set_mode(self, eid: str, mode: str) -> None:
        async with self._lock:
            self._enterprise_modes[eid] = mode

    def list_configs(self) -> list[dict]:
        return [dict(v) for v in self._configs.values()]

    def get_config(self, mode: CooperationMode) -> dict | None:
        return self._configs.get(mode)


_coop_store = _CoopStore()


class CooperationModeService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    @staticmethod
    def _parse_mode(mode_value: str | CooperationMode) -> CooperationMode:
        if isinstance(mode_value, CooperationMode):
            return mode_value
        try:
            return CooperationMode(mode_value)
        except ValueError:
            return CooperationMode.FULL_TRUST

    def get_config(self, mode: CooperationMode | str) -> ModeConfig:
        mode = self._parse_mode(mode)
        cfg = _coop_store.get_config(mode)
        if not cfg:
            cfg = {
                "mode": mode.value,
                "interestSplitPctBank": 50.0,
                "riskSharePctBank": 50.0,
                "requiredModules": [],
                "permissionMatrix": {},
                "description": f"模式 {mode.value}",
            }
        return ModeConfig.model_validate(cfg)

    def list_all_configs(self) -> list[ModeConfig]:
        return [ModeConfig.model_validate(c) for c in _coop_store.list_configs()]

    async def get_enterprise_mode(self, enterprise_id: str) -> CooperationMode:
        m = await _coop_store.get_mode(enterprise_id)
        if not m:
            return CooperationMode.FULL_TRUST
        try:
            return CooperationMode(m)
        except ValueError:
            return CooperationMode.FULL_TRUST

    async def switch_enterprise_mode(
        self, enterprise_id: str, new_mode: CooperationMode | str,
    ) -> SwitchResult:
        new_mode = self._parse_mode(new_mode)
        prev_value = await _coop_store.get_mode(enterprise_id)
        prev_mode = CooperationMode(prev_value) if prev_value else CooperationMode.FULL_TRUST
        prev_cfg = self.get_config(prev_mode)
        new_cfg = self.get_config(new_mode)

        prev_perms: set[str] = set()
        for perms in prev_cfg.permission_matrix.values():
            prev_perms.update(perms)
        new_perms: set[str] = set()
        for perms in new_cfg.permission_matrix.values():
            new_perms.update(perms)

        changed = sorted(prev_perms.symmetric_difference(new_perms))
        partners: list[str] = []
        if new_mode == CooperationMode.CO_LENDING:
            partners = ["BANK-SDB", "BANK-HZB"]
        elif new_mode == CooperationMode.GUARANTEED:
            partners = ["GUARANTOR-001"]
        elif new_mode == CooperationMode.INSURED:
            partners = ["INSURER-001"]
        elif new_mode == CooperationMode.FULL_TRUST:
            partners = ["BANK-CMB"]

        await _coop_store.set_mode(enterprise_id, new_mode.value)
        return SwitchResult(
            previous_mode=prev_mode,
            current_mode=new_mode,
            changed_permissions=changed,
            affected_partners=partners,
        )


cooperation_mode_service = CooperationModeService(db=None)
