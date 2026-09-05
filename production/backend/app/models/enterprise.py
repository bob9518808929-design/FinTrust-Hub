"""企业领域 ORM models."""

from sqlalchemy import JSON, Boolean, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, SoftDeleteMixin, TenantMixin, TimestampMixin


class Enterprise(Base, IdMixin, TenantMixin, TimestampMixin, SoftDeleteMixin):
    """企业主表."""

    __tablename__ = "enterprises"
    __table_args__ = {"comment": "企业主表 (mock-data.js ENTERPRISES 镜像)"}

    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="企业名称")
    # APP-02: 工人极简登录用企业码 (6-8 位, 与 worker_no 组合登录)
    enterprise_code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, default="", comment="企业码 (工人登录)")
    industry: Mapped[str] = mapped_column(String(50), nullable=False, comment="行业大类")
    industry_label: Mapped[str] = mapped_column(String(50), nullable=False, comment="行业中文标签")
    industry_policy: Mapped[str] = mapped_column(String(20), nullable=False, comment="政策导向")
    risk_profile: Mapped[str] = mapped_column(String(20), nullable=False, comment="风险画像")
    risk_label: Mapped[str] = mapped_column(String(50), nullable=False, comment="风险标签")

    data_flows: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="数据流开关 6 项")
    modules: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="模块配置")
    cooperation: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="合作模式")
    data_visibility: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="数据可见范围")
    financials: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="财务指标")

    runtime: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="运行时状态")
    reform: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="改造状态")


class Bank(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    """银行."""

    __tablename__ = "banks"
    __table_args__ = {"comment": "银行主表"}

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_rate: Mapped[str] = mapped_column(String(20), nullable=False, comment="利率字符串 LPR+1.5%")
    base_rate_value: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False, comment="利率数值")
    max_amount: Mapped[int] = mapped_column(Integer, nullable=False, comment="最大额度 (分)")
    requires_guarantee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    label: Mapped[str] = mapped_column(String(200), default="")
    bank_group: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="银行集团")


class Guarantor(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    """担保公司."""

    __tablename__ = "guarantors"
    __table_args__ = {"comment": "担保公司"}

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    mode: Mapped[str] = mapped_column(String(50), nullable=False)
    active_guarantees: Mapped[int] = mapped_column(Integer, default=0)
    guarantee_rate: Mapped[str] = mapped_column(String(20), default="1.5%")


class Insurer(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    """保险公司."""

    __tablename__ = "insurers"
    __table_args__ = {"comment": "保险公司"}

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    mode: Mapped[str] = mapped_column(String(50), nullable=False)
    active_policies: Mapped[int] = mapped_column(Integer, default=0)
    premium_rate: Mapped[str] = mapped_column(String(20), default="0.8%")


class PolicyVersion(Base, IdMixin, TimestampMixin):
    """政策版本."""

    __tablename__ = "policy_versions"
    __table_args__ = {"comment": "政策版本"}

    version: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    manufacturing: Mapped[str] = mapped_column(String(20), nullable=False)
    high_tech: Mapped[str] = mapped_column(String(20), nullable=False)
    real_estate_related: Mapped[str] = mapped_column(String(20), nullable=False)
