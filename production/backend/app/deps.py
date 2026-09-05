"""FastAPI 依赖注入.

JWT 鉴权 (P0 必补):
    - 开发环境 (APP_DEBUG=true): 无 Bearer 时返回默认 dev-admin, 兼容现有测试
    - 生产环境 (APP_ENV=production): 无 Bearer 或 JWT 验证失败时抛 401
    - 支持 sub / user_id / role / tenant_id 字段映射
"""

from typing import Annotated, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db

# === 类型别名 (Annotated 简化路由签名) ===

DbSession = Annotated[AsyncSession, Depends(get_db)]


# === JWT 工具 ===


def _decode_jwt(token: str) -> Optional[dict]:
    """验证 JWT 签名并返回 payload. 失败返回 None."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except PyJWTError:
        return None


def create_access_token(payload: dict, expires_minutes: int | None = None) -> str:
    """签发 JWT (登录/换 token 用).

    payload 中应包含 sub (user_id), role, tenant_id, name 等字段.
    有效期: expires_minutes 显式传入时用该值; 否则由 settings.JWT_EXPIRE_MINUTES 控制
    (默认 1440 分钟 = 24 小时). APP-02 工人 token 传 settings.WORKER_JWT_EXPIRE_MINUTES
    (7 天). 同时写入 iat (签发时间) 便于客户端展示与测试断言.
    """
    from datetime import datetime, timedelta, timezone

    minutes = expires_minutes if expires_minutes is not None else settings.JWT_EXPIRE_MINUTES
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=minutes)
    payload = {**payload, "iat": now, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _extract_user_from_payload(payload: dict) -> dict:
    """从 JWT payload 提取用户身份字段 (兼容 sub / user_id 两种命名)."""
    return {
        "user_id": payload.get("sub") or payload.get("user_id") or "unknown",
        "name": payload.get("name", ""),
        "role": payload.get("role", "user"),
        "tenant_id": payload.get("tenant_id", "default"),
    }


_DEFAULT_DEV_USER = {
    "user_id": "dev-admin",
    "name": "财务顾问",
    "role": "advisor",
    "tenant_id": "default",
}


# === 请求上下文 ===

class RequestContext:
    """请求上下文 (从 Request 注入)."""

    def __init__(self, request: Request):
        self.request = request
        self.request_id: str = request.headers.get("X-Request-Id", "")
        self.user_agent: str = request.headers.get("User-Agent", "")
        self.client_ip: str = request.client.host if request.client else ""

    @property
    def is_authenticated(self) -> bool:
        """检查 Authorization 是否为有效 Bearer JWT."""
        auth = self.request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        token = auth[7:]
        return _decode_jwt(token) is not None


async def get_request_context(request: Request) -> RequestContext:
    return RequestContext(request)


RequestCtx = Annotated[RequestContext, Depends(get_request_context)]


# === 鉴权 ===


async def get_current_user(request: Request) -> dict:
    """获取当前登录用户 (从 Authorization Bearer JWT 解析).

    降级策略 (遵循 project_memory "零机构接入时仍可独立运行"):
        - 开发环境 + 无 Bearer / JWT 无效 → 返回 dev-admin (兼容现有测试与前端联调)
        - 生产环境 + 无 Bearer → 401 Unauthorized
        - 生产环境 + JWT 无效 → 401 Unauthorized
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        if not settings.is_production:
            return dict(_DEFAULT_DEV_USER)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未授权: 缺少 Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth[7:]
    payload = _decode_jwt(token)
    if payload is None:
        if not settings.is_production:
            return dict(_DEFAULT_DEV_USER)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未授权: JWT 签名验证失败或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return _extract_user_from_payload(payload)


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    """角色守卫 (装饰器形式)."""
    async def _checker(user: CurrentUser) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"无权限访问, 需要 {roles} 之一",
            )
        return user
    return _checker
