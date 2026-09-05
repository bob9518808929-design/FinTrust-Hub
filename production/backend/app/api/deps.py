"""API 层辅助函数."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


def make_ok(data: Any, code: int = 0, message: str = "OK") -> dict:
    """构造成功响应 (对齐 main.make_response)."""
    return {
        "code": code, "message": message, "data": data,
        "requestId": f"req-{uuid4().hex[:16]}",
        "timestamp": datetime.now(UTC).isoformat(),
    }
