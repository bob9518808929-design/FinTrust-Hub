-- FinTrust Hub ClickHouse 时序指标库
-- 技术栈: ClickHouse (改造进度历史 / 行为挖矿统计 / 行业指数历史 / 链上审计)

CREATE DATABASE IF NOT EXISTS fintrust_metrics;

-- ============================================================================
-- 1. 改造进度历史 (R8 监控, 时序)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.reform_progress_history (
    enterprise_id    String,
    tenant_id        String,
    timestamp        DateTime64(3),
    progress         Float64,
    current_level    String,
    scorecard_subject    UInt8,
    scorecard_finance    UInt8,
    scorecard_tax        UInt8,
    scorecard_business   UInt8,
    scorecard_assets     UInt8,
    scorecard_credit     UInt8,
    scorecard_policy     UInt8,
    scorecard_capital    UInt8,
    phase_count     UInt16,
    completed_actions UInt16
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (enterprise_id, timestamp)
TTL timestamp + INTERVAL 2 YEAR;

-- ============================================================================
-- 2. 行为挖矿统计 (ECO-06, 事件流)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.behavior_mining_events (
    worker_id       String,
    enterprise_id   String,
    behavior        String,  -- scan_confirm / exception_report / streak_7d
    credit_awarded  Int32,
    carbon_awarded  Int32,
    easy_trust_awarded Int32,
    fraud_blocked    UInt8,
    timestamp       DateTime64(3),
    geo_fence       String
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (worker_id, timestamp)
TTL timestamp + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS fintrust_metrics.behavior_mining_daily
TO fintrust_metrics.behavior_mining_events AS
SELECT
    worker_id, enterprise_id, behavior,
    credit_awarded, carbon_awarded, easy_trust_awarded, fraud_blocked,
    timestamp, geo_fence
FROM fintrust_metrics.behavior_mining_events;

-- ============================================================================
-- 3. 行业指数历史 (ECO-07, 周期性快照)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.compliance_index_history (
    index_type      String,
    industry        String,
    period          String,
    value           Float64,
    sample_size     UInt32,
    timestamp       DateTime64(3),
    signature       String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (index_type, industry, period, timestamp)
TTL timestamp + INTERVAL 5 YEAR;

-- ============================================================================
-- 4. 链上审计事件 (ECO-01 销毁 / ECO-04 凭证 / ECO-05 竞拍)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.chain_audit_events (
    tx_id           String,
    block_number    UInt64,
    action          String,  -- raw_loaded / diagnosed / destroyed / credential_issued / tender_published / bid_submitted / awarded
    enterprise_id   String,
    module          String,  -- ECO-01 / ECO-04 / ECO-05
    hash            String,
    prev_hash       String,
    timestamp       DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (module, enterprise_id, timestamp)
TTL timestamp + INTERVAL 7 YEAR;

-- ============================================================================
-- 5. 反向竞拍出价历史 (ECO-05, 匿名归档 + 利率基准分析)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.bid_archive (
    tender_id       String,
    rate            Float64,
    amount          UInt64,
    term_months     UInt16,
    time_to_fund_days UInt16,
    archived_at     DateTime64(3),
    reason          String  -- not_winner / disqualified / collusion
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(archived_at)
ORDER BY (tender_id, archived_at)
TTL archived_at + INTERVAL 3 YEAR;

-- ============================================================================
-- 6. API 调用指标 (限流 / 熔断 / 延迟监控)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fintrust_metrics.api_call_metrics (
    endpoint        String,
    method          String,
    status_code     UInt16,
    duration_ms     UInt32,
    request_id      String,
    tenant_id       String,
    timestamp       DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (endpoint, timestamp)
TTL timestamp + INTERVAL 90 DAY;
