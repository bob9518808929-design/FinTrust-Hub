"""CORE-03 企业可选配置引擎 schemas (P1 R2.10).

6 条数据流可选 + 16 模块独立启停.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class DataFlow(str, Enum):
    FUND = "FUND"
    CONTRACT = "CONTRACT"
    INVOICE = "INVOICE"
    LOGISTICS = "LOGISTICS"
    IOT = "IOT"
    HUMAN = "HUMAN"


class OptionalModule(str, Enum):
    BANK_AGGREGATOR = "BANK_AGGREGATOR"
    EXTERNAL_DATA = "EXTERNAL_DATA"
    OCR = "OCR"
    AI_ORCH = "AI_ORCH"
    HUMAN_AI = "HUMAN_AI"
    PERFORMANCE = "PERFORMANCE"
    PRIVACY = "PRIVACY"
    COOPERATION = "COOPERATION"
    POLICY = "POLICY"
    REFINANCE = "REFINANCE"
    RESPONSIBILITY = "RESPONSIBILITY"
    IOT = "IOT"
    GUARANTEE_PORTAL = "GUARANTEE_PORTAL"
    INSURANCE_PORTAL = "INSURANCE_PORTAL"
    VC_CREDENTIAL = "VC_CREDENTIAL"
    REFORM_SANDBOX = "REFORM_SANDBOX"


class CooperationMethod(str, Enum):
    FULL_TRUST = "FULL_TRUST"
    CO_LENDING = "CO_LENDING"
    GUARANTEED = "GUARANTEED"
    INSURED = "INSURED"


class EnterpriseOptConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: str = Field(alias="enterpriseId")
    enabled_flows: list[DataFlow] = Field(alias="enabledFlows", default_factory=list)
    enabled_modules: list[OptionalModule] = Field(alias="enabledModules", default_factory=list)
    cooperation_method: CooperationMethod = Field(alias="cooperationMethod", default=CooperationMethod.FULL_TRUST)
    custom_permissions: dict[str, list[str]] = Field(alias="customPermissions", default_factory=dict)


class ConfigDiff(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: str = Field(alias="enterpriseId")
    added_flows: list[DataFlow] = Field(alias="addedFlows", default_factory=list)
    removed_flows: list[DataFlow] = Field(alias="removedFlows", default_factory=list)
    added_modules: list[OptionalModule] = Field(alias="addedModules", default_factory=list)
    removed_modules: list[OptionalModule] = Field(alias="removedModules", default_factory=list)
    cooperation_changed_from_to: tuple[CooperationMethod, CooperationMethod] | None = Field(
        alias="cooperationChangedFromTo", default=None,
    )
