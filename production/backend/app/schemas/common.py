"""通用 schemas (镜像 contracts/common.ts).

字段命名: snake_case (PEP 8).
FastAPI 通过 alias_generator 自动转换 camelCase <-> snake_case, 与前端契约对齐.
"""

from datetime import datetime
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

# === 通用类型别名 ===

Id = Annotated[str, Field(min_length=1, max_length=64)]
IsoTimestamp = str  # ISO 8601 字符串
AmountInCents = Annotated[int, Field(ge=0)]  # 最小货币单位 (分)
Ratio = Annotated[float, Field(ge=0.0, le=1.0)]
Percentage = Annotated[float, Field(ge=0.0)]
Score = Annotated[int, Field(ge=0, le=100)]


# === 统一响应包装 (与 main.make_response 字段对齐) ===

T = TypeVar("T")


class ApiResult(BaseModel, Generic[T]):
    """统一响应包装 (镜像 contracts/common.ts ApiResult<T>)."""

    model_config = ConfigDict(populate_by_name=True)

    code: int = Field(description="业务码, 0 = 成功")
    message: str
    data: T | None = None
    request_id: str = Field(alias="requestId")
    timestamp: IsoTimestamp


class PaginatedResult(BaseModel, Generic[T]):
    """分页结果."""

    items: list[T]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(alias="pageSize", ge=1, le=100)


class PageQuery(BaseModel):
    """分页查询参数."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(alias="pageSize", default=20, ge=1, le=100)
    sort_field: str | None = Field(alias="sortField", default=None)
    sort_order: str | None = Field(alias="sortOrder", default="asc")


# === 枚举 (字面量类型) ===

class Industry(str):
    pass


# (后续 enterprise / scorecard / reform / eco 模块各自定义自己的枚举)


# === 基础 mixin ===

class TimestampMixin(BaseModel):
    """时间戳 mixin (创建/更新时间)."""

    model_config = ConfigDict(populate_by_name=True)

    created_at: IsoTimestamp = Field(alias="createdAt", default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: IsoTimestamp = Field(alias="updatedAt", default_factory=lambda: datetime.utcnow().isoformat())
