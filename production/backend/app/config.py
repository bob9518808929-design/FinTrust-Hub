"""FinTrust Hub 后端配置 (Pydantic Settings).

所有配置通过环境变量注入, 严格对齐 .env.example 字段名.
设计依据: spec.md L3495-3525 技术栈总览.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置 (从 .env 读取)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # === 应用 ===
    APP_NAME: str = "FinTrust Hub Backend"
    APP_VERSION: str = "3.1.0"
    APP_ENV: Literal["development", "staging", "production"] = "development"
    APP_DEBUG: bool = True
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000

    # === 数据库 (PostgreSQL) ===
    DATABASE_URL: str = "postgresql+asyncpg://fintrust:fintrust@localhost:5432/fintrust_hub"
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20
    DATABASE_ECHO: bool = False

    # === Redis ===
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_PASSWORD: str = ""

    # === ClickHouse ===
    CLICKHOUSE_HOST: str = "localhost"
    CLICKHOUSE_PORT: int = 8123
    CLICKHOUSE_USER: str = "default"
    CLICKHOUSE_PASSWORD: str = ""
    CLICKHOUSE_DATABASE: str = "fintrust_metrics"
    CLICKHOUSE_CONNECT_TIMEOUT: int = 5
    CLICKHOUSE_QUERY_TIMEOUT: int = 10

    # === LLM 指标落库开关 (与 _record_metric 联动, P1 异常处理配置化) ===
    LLM_METRICS_ENABLED: bool = True
    LLM_METRICS_LOG_ON_FAILURE: bool = True

    # === Neo4j ===
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "fintrust"

    # === Kafka ===
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"
    KAFKA_CLIENT_ID: str = "fintrust-hub"

    # === DeepSeek / LLM (spec L3501) ===
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"
    DEEPSEEK_REASONER_MODEL: str = "deepseek-reasoner"
    DEEPSEEK_TIMEOUT_CHAT: float = 30.0
    DEEPSEEK_TIMEOUT_REASONER: float = 60.0
    DEEPSEEK_MAX_TOKENS_PER_CALL: int = 2048
    DEEPSEEK_CACHE_TTL_DEFAULT: int = 3600
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # === JWT ===
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    # APP-02: 工人 JWT 7 天过期 (与 advisor 24h 区分)
    WORKER_JWT_EXPIRE_MINUTES: int = 10080
    # APP-02: 工人登录开发降级 (dev 任意输入返回 mock token; 生产强制 false)
    WORKER_AUTH_BYPASS: bool = False

    # === 区块链 (spec L3506) ===
    ANT_CHAIN_ENDPOINT: str = ""
    ANT_CHAIN_ACCESS_KEY: str = ""
    ANT_CHAIN_SECRET: str = ""
    ZXIN_CHAIN_ENDPOINT: str = ""

    # === OCR (spec L3507) ===
    PADDLE_OCR_LANG: str = "ch"
    CLOUD_OCR_PROVIDER: str = "aliyun"
    CLOUD_OCR_KEY: str = ""

    # === Temporal (spec L3502) ===
    TEMPORAL_HOST: str = "localhost:7233"
    TEMPORAL_NAMESPACE: str = "fintrust"

    # === 银企直连 (INFRA-01b, A1-A4) ===
    BANK_API_001_URL: str = ""
    BANK_API_001_APP_ID: str = ""
    BANK_API_001_APP_SECRET: str = ""
    BANK_API_001_CERT_PATH: str = ""
    BANK_API_001_CERT_PASSWORD: str = ""
    BANK_API_002_URL: str = ""
    BANK_API_002_APP_ID: str = ""
    BANK_API_002_APP_SECRET: str = ""
    BANK_API_002_CERT_PATH: str = ""
    BANK_API_002_CERT_PASSWORD: str = ""
    PBOC_CREDIT_API_URL: str = ""
    PBOC_CREDIT_API_KEY: str = ""
    PBOC_CREDIT_ORG_CODE: str = ""
    TAX_API_URL: str = ""
    TAX_API_KEY: str = ""
    INVOICE_API_URL: str = ""
    INVOICE_API_KEY: str = ""

    # === CORS ===
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def worker_auth_bypass(self) -> bool:
        """APP-02 工人登录开发降级开关.

        project_memory 硬约束: APP_ENV=production 时强制 False,
        任何环境变量/误配置都无法在生产开启绕过.
        """
        return False if self.APP_ENV == "production" else self.WORKER_AUTH_BYPASS


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """单例配置 (lru_cache 缓存)."""
    return Settings()


# 全局配置实例
settings = get_settings()
