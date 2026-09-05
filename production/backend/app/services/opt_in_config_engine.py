"""CORE-03 企业可选配置引擎 (P1 R2.10).

6 条数据流可选 + 16 模块独立启停。
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.schemas.opt_in_config import (
    ConfigDiff, CooperationMethod, DataFlow, EnterpriseOptConfig, OptionalModule,
)


_ALL_FLOWS = [
    DataFlow.FUND, DataFlow.CONTRACT, DataFlow.INVOICE,
    DataFlow.LOGISTICS, DataFlow.IOT, DataFlow.HUMAN,
]

_ALL_MODULES = [
    OptionalModule.BANK_AGGREGATOR, OptionalModule.EXTERNAL_DATA,
    OptionalModule.OCR, OptionalModule.AI_ORCH,
    OptionalModule.HUMAN_AI, OptionalModule.PERFORMANCE,
    OptionalModule.PRIVACY, OptionalModule.COOPERATION,
    OptionalModule.POLICY, OptionalModule.REFINANCE,
    OptionalModule.RESPONSIBILITY, OptionalModule.IOT,
    OptionalModule.GUARANTEE_PORTAL, OptionalModule.INSURANCE_PORTAL,
    OptionalModule.VC_CREDENTIAL, OptionalModule.REFORM_SANDBOX,
]


class _OptInConfigStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._configs: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        self._configs["E001"] = self._default_config_dict("E001")
        self._configs["E002"] = self._default_config_dict("E002")
        cfg3 = self._default_config_dict("E003")
        cfg3["enabled_flows"] = [f for f in cfg3["enabled_flows"] if f not in (DataFlow.IOT.value, DataFlow.HUMAN.value)]
        cfg3["enabled_modules"] = [
            m for m in cfg3["enabled_modules"]
            if m not in (OptionalModule.IOT.value, OptionalModule.HUMAN_AI.value)
        ]
        self._configs["E003"] = cfg3
        cfg4 = self._default_config_dict("E004")
        cfg4["cooperation_method"] = CooperationMethod.CO_LENDING.value
        self._configs["E004"] = cfg4

    @staticmethod
    def _default_config_dict(enterprise_id: str) -> dict:
        return {
            "enterprise_id": enterprise_id,
            "enabled_flows": [f.value for f in _ALL_FLOWS],
            "enabled_modules": [m.value for m in _ALL_MODULES],
            "cooperation_method": CooperationMethod.FULL_TRUST.value,
            "custom_permissions": {},
        }

    async def get_config(self, enterprise_id: str) -> dict:
        async with self._lock:
            if enterprise_id not in self._configs:
                self._configs[enterprise_id] = self._default_config_dict(enterprise_id)
            return dict(self._configs[enterprise_id])

    async def upsert_config(self, enterprise_id: str, cfg: dict) -> dict:
        async with self._lock:
            self._configs[enterprise_id] = dict(cfg)
            return dict(cfg)


_opt_store = _OptInConfigStore()


class OptInConfigEngine:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def get_config(self, enterprise_id: str) -> EnterpriseOptConfig:
        raw = await _opt_store.get_config(enterprise_id)
        return EnterpriseOptConfig.model_validate(raw)

    async def set_flows(self, enterprise_id: str, flows: list[DataFlow]) -> ConfigDiff:
        current = await self.get_config(enterprise_id)
        current_flows = set(current.enabled_flows)
        new_flows = set(flows)
        added = sorted(new_flows - current_flows)
        removed = sorted(current_flows - new_flows)
        new_cfg_dict = current.model_dump()
        new_cfg_dict["enabled_flows"] = [f.value for f in flows]
        await _opt_store.upsert_config(enterprise_id, new_cfg_dict)
        return ConfigDiff(
            enterprise_id=enterprise_id,
            added_flows=added,
            removed_flows=removed,
            added_modules=[],
            removed_modules=[],
            cooperation_changed_from_to=None,
        )

    async def toggle_module(
        self, enterprise_id: str, module: OptionalModule, enabled: bool,
    ) -> ConfigDiff:
        current = await self.get_config(enterprise_id)
        current_modules = set(current.enabled_modules)
        added: list[OptionalModule] = []
        removed: list[OptionalModule] = []
        if enabled and module not in current_modules:
            current_modules.add(module)
            added = [module]
        elif not enabled and module in current_modules:
            current_modules.remove(module)
            removed = [module]
        new_cfg_dict = current.model_dump()
        new_cfg_dict["enabled_modules"] = [m.value for m in sorted(current_modules)]
        await _opt_store.upsert_config(enterprise_id, new_cfg_dict)
        return ConfigDiff(
            enterprise_id=enterprise_id,
            added_flows=[],
            removed_flows=[],
            added_modules=added,
            removed_modules=removed,
            cooperation_changed_from_to=None,
        )

    async def set_cooperation(
        self, enterprise_id: str, method: CooperationMethod,
    ) -> ConfigDiff:
        current = await self.get_config(enterprise_id)
        old_method = current.cooperation_method
        changed_from_to = None
        if old_method != method:
            changed_from_to = (old_method, method)
        new_cfg_dict = current.model_dump(by_alias=True)
        new_cfg_dict["cooperation_method"] = method.value
        await _opt_store.upsert_config(enterprise_id, new_cfg_dict)
        return ConfigDiff(
            enterprise_id=enterprise_id,
            added_flows=[],
            removed_flows=[],
            added_modules=[],
            removed_modules=[],
            cooperation_changed_from_to=changed_from_to,
        )

    async def reset_to_default(self, enterprise_id: str) -> ConfigDiff:
        current = await self.get_config(enterprise_id)
        default_cfg = EnterpriseOptConfig(
            enterprise_id=enterprise_id,
            enabled_flows=list(_ALL_FLOWS),
            enabled_modules=list(_ALL_MODULES),
            cooperation_method=CooperationMethod.FULL_TRUST,
            custom_permissions={},
        )
        added_flows = sorted(set(default_cfg.enabled_flows) - set(current.enabled_flows))
        removed_flows = sorted(set(current.enabled_flows) - set(default_cfg.enabled_flows))
        added_modules = sorted(set(default_cfg.enabled_modules) - set(current.enabled_modules))
        removed_modules = sorted(set(current.enabled_modules) - set(default_cfg.enabled_modules))
        changed_from_to = None
        if current.cooperation_method != default_cfg.cooperation_method:
            changed_from_to = (current.cooperation_method, default_cfg.cooperation_method)
        await _opt_store.upsert_config(enterprise_id, default_cfg.model_dump())
        return ConfigDiff(
            enterprise_id=enterprise_id,
            added_flows=added_flows,
            removed_flows=removed_flows,
            added_modules=added_modules,
            removed_modules=removed_modules,
            cooperation_changed_from_to=changed_from_to,
        )


opt_in_config_engine = OptInConfigEngine(db=None)
