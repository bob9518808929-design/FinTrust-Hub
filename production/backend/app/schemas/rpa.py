"""INFRA-05 RPA 适配层 schemas (R6.2).

任务类型: 银行流水 PDF / 发票 PDF / 合同 PDF.

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp


# === 枚举 ===

TaskType = Literal[
    "BANK_STATEMENT_PDF",
    "INVOICE_PDF",
    "CONTRACT_PDF",
]

TaskStatus = Literal["pending", "running", "completed", "failed"]


class _RpaBase(BaseModel):
    """RPA schema 公共配置."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class RPATask(_RpaBase):
    """RPA 任务 (含执行结果文件路径)."""
    task_id: Id = Field(description="任务 ID")
    task_type: TaskType = Field(description="任务类型")
    enterprise_id: Id = Field(description="企业 ID")
    target_bank: str | None = Field(default=None, description="目标银行 (仅银行流水任务)")
    status: TaskStatus = Field(default="pending", description="任务状态")
    result_file_path: str | None = Field(default=None, description="结果文件路径")
    created_at_iso: IsoTimestamp = Field(description="创建时间")
    completed_at_iso: IsoTimestamp | None = Field(default=None, description="完成时间")
    error_message: str | None = Field(default=None, description="错误信息 (失败时)")


__all__ = ["TaskType", "TaskStatus", "RPATask"]
