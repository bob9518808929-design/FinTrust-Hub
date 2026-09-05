"""改造引擎 ORM models."""

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class ReformStateORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """改造整体状态 (spec L3533-3549)."""

    __tablename__ = "reform_states"
    __table_args__ = {"comment": "改造整体状态"}

    enterprise_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("enterprises.id"), nullable=False, index=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="idle")
    progress: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False, default=0.0)
    current_level: Mapped[str] = mapped_column(String(2), nullable=False, default="D")
    target_level: Mapped[str] = mapped_column(String(2), nullable=False, default="A")
    aggression_level: Mapped[str] = mapped_column(String(20), nullable=False, default="balanced")
    started_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    plan_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    scorecard: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="current/target 评分卡")
    phases: Mapped[dict] = mapped_column(JSON, nullable=False, default=list, comment="阶段列表")
    completed_actions: Mapped[dict] = mapped_column(JSON, nullable=False, default=list, comment="已完成动作")


class ReformCaseORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """改造案例 (R10 案例库)."""

    __tablename__ = "reform_cases"
    __table_args__ = {"comment": "改造案例库 (R10 案例沉淀)"}

    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    industry: Mapped[str] = mapped_column(String(50), nullable=False)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    before_scorecard: Mapped[dict] = mapped_column(JSON, nullable=False)
    after_scorecard: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_actions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    top_level_reached: Mapped[str | None] = mapped_column(String(2), nullable=True)
    signature: Mapped[str] = mapped_column(String(128), nullable=False, comment="SHA-256 防篡改指纹")
