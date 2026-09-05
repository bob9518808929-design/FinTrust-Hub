"""SQLAlchemy ORM 基类与 Mixin."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有 ORM model 的基类 (与 database.py Base 同源)."""


class IdMixin:
    """主键 mixin (UUID 字符串)."""

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: uuid4().hex,
        comment="UUID 主键",
    )


class TimestampMixin:
    """时间戳 mixin (created_at / updated_at)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间",
    )


class SoftDeleteMixin:
    """软删除 mixin (deleted_at)."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        comment="软删除时间, NULL = 未删除",
    )


class TenantMixin:
    """多租户 mixin (tenant_id 隔离)."""

    tenant_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="default",
        index=True,
        comment="租户 ID, 多租户隔离",
    )
