-- FinTrust Hub PostgreSQL 建表 DDL
-- 对齐: backend/app/models/*.py (SQLAlchemy ORM)
-- 技术栈: PostgreSQL 16 (JSONB / 分区表 / 全文检索)

-- ============================================================================
-- 扩展
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- pgcrypto for SHA-256
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- 模糊检索

-- ============================================================================
-- 1. 企业主表
-- ============================================================================
CREATE TABLE IF NOT EXISTS enterprises (
    id              VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id       VARCHAR(64)   NOT NULL DEFAULT 'default',
    name            VARCHAR(200)  NOT NULL,
    industry        VARCHAR(50)   NOT NULL,
    industry_label  VARCHAR(50)   NOT NULL,
    industry_policy VARCHAR(20)   NOT NULL,
    risk_profile    VARCHAR(20)   NOT NULL,
    risk_label      VARCHAR(50)   NOT NULL,
    data_flows      JSONB         NOT NULL DEFAULT '{}',
    modules         JSONB         NOT NULL DEFAULT '{}',
    cooperation    JSONB         NOT NULL DEFAULT '{}',
    data_visibility JSONB         NOT NULL DEFAULT '{}',
    financials      JSONB         NOT NULL DEFAULT '{}',
    runtime         JSONB         NOT NULL DEFAULT '{}',
    reform          JSONB         NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE enterprises IS '企业主表 (mock-data.js ENTERPRISES 镜像)';

-- ============================================================================
-- 2. 银行
-- ============================================================================
CREATE TABLE IF NOT EXISTS banks (
    id                 VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name               VARCHAR(200)  NOT NULL,
    base_rate          VARCHAR(20)   NOT NULL,
    base_rate_value    NUMERIC(8,4)  NOT NULL,
    max_amount         INTEGER       NOT NULL,
    requires_guarantee BOOLEAN       NOT NULL DEFAULT FALSE,
    label              VARCHAR(200)  DEFAULT '',
    bank_group         VARCHAR(100),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
);
COMMENT ON TABLE banks IS '银行主表';

-- ============================================================================
-- 3. 担保公司
-- ============================================================================
CREATE TABLE IF NOT EXISTS guarantors (
    id                 VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name               VARCHAR(200)  NOT NULL,
    mode               VARCHAR(50)   NOT NULL,
    active_guarantees  INTEGER       NOT NULL DEFAULT 0,
    guarantee_rate     VARCHAR(20)   DEFAULT '1.5%',
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
);

-- ============================================================================
-- 4. 保险公司
-- ============================================================================
CREATE TABLE IF NOT EXISTS insurers (
    id              VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name            VARCHAR(200)  NOT NULL,
    mode            VARCHAR(50)   NOT NULL,
    active_policies INTEGER       NOT NULL DEFAULT 0,
    premium_rate    VARCHAR(20)   DEFAULT '0.8%',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- ============================================================================
-- 5. 政策版本
-- ============================================================================
CREATE TABLE IF NOT EXISTS policy_versions (
    id                  VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    version             VARCHAR(20)   NOT NULL UNIQUE,
    label               VARCHAR(50)   NOT NULL,
    manufacturing       VARCHAR(20)   NOT NULL,
    high_tech           VARCHAR(20)   NOT NULL,
    real_estate_related VARCHAR(20)   NOT NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. 改造状态 (R0-R10)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reform_states (
    id               VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id        VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id    VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    status           VARCHAR(20)   NOT NULL DEFAULT 'idle',
    progress         NUMERIC(5,4)  NOT NULL DEFAULT 0.0,
    current_level    VARCHAR(2)    NOT NULL DEFAULT 'D',
    target_level     VARCHAR(2)    NOT NULL DEFAULT 'A',
    aggression_level VARCHAR(20)   NOT NULL DEFAULT 'balanced',
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    plan_id          VARCHAR(64),
    scorecard        JSONB         NOT NULL DEFAULT '{}',
    phases           JSONB         NOT NULL DEFAULT '[]',
    completed_actions JSONB        NOT NULL DEFAULT '[]',
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE reform_states IS '改造整体状态 (spec L3533-3549)';

-- ============================================================================
-- 7. 改造案例 (R10 案例库)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reform_cases (
    id                VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id         VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id     VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    industry          VARCHAR(50)   NOT NULL,
    outcome           VARCHAR(20)   NOT NULL,
    before_scorecard  JSONB         NOT NULL,
    after_scorecard   JSONB,
    total_days        INTEGER       NOT NULL DEFAULT 0,
    total_cost        INTEGER       NOT NULL DEFAULT 0,
    total_actions     INTEGER       NOT NULL DEFAULT 0,
    top_level_reached VARCHAR(2),
    signature         VARCHAR(128)  NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE reform_cases IS '改造案例库 (R10 案例沉淀)';

-- ============================================================================
-- ECO-01 阅后即焚销毁审计
-- ============================================================================
CREATE TABLE IF NOT EXISTS burn_audits (
    id                    VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id             VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id         VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    destroyed_at          TIMESTAMPTZ   NOT NULL,
    redis_keys_cleared    INTEGER       NOT NULL DEFAULT 0,
    three_pass_overwrite  BOOLEAN       NOT NULL DEFAULT TRUE,
    weak_ref_finalized    BOOLEAN       NOT NULL DEFAULT TRUE,
    chain_evidence        JSONB         NOT NULL DEFAULT '[]',
    raw_hash              VARCHAR(128)  NOT NULL,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-02 阶梯定价分成结算
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlement_records (
    id                       VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id                VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id            VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    loan_amount              INTEGER       NOT NULL,
    interest_saved           INTEGER       NOT NULL,
    difficulty               VARCHAR(20)   NOT NULL,
    split_ratio              NUMERIC(5,4)  NOT NULL,
    platform_fee             INTEGER       NOT NULL,
    enterprise_net           INTEGER       NOT NULL,
    status                   VARCHAR(20)   NOT NULL DEFAULT 'calculated',
    paid_at                  TIMESTAMPTZ,
    auto_deducted_from_loan  BOOLEAN,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-03 无接口适配器 (信贷申报书)
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_applications (
    id                    VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id             VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id         VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    bank_id               VARCHAR(64)   NOT NULL,
    pdf_url               VARCHAR(500)  NOT NULL,
    pdf_hash              VARCHAR(128)  NOT NULL,
    tier                  VARCHAR(20)   NOT NULL,
    status                VARCHAR(20)   NOT NULL DEFAULT 'draft',
    bank_received_at      TIMESTAMPTZ,
    bank_acknowledgement  TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-04 联盟链凭证
-- ============================================================================
CREATE TABLE IF NOT EXISTS credentials (
    id                VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id         VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id     VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    type              VARCHAR(50)   NOT NULL,
    issuer            VARCHAR(64)   NOT NULL,
    issuance_date     TIMESTAMPTZ   NOT NULL,
    expiration_date   TIMESTAMPTZ   NOT NULL,
    credential_subject JSONB       NOT NULL DEFAULT '{}',
    proof             JSONB        NOT NULL DEFAULT '{}',
    status            VARCHAR(20)   NOT NULL DEFAULT 'active',
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-05 反向竞拍 - 融资标书
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenders (
    id                VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id         VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id     VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    enterprise_name   VARCHAR(200)  NOT NULL,
    amount            INTEGER       NOT NULL,
    term_months       INTEGER       NOT NULL,
    rate_floor        NUMERIC(8,4)  NOT NULL,
    rate_floor_label  VARCHAR(50)   NOT NULL,
    purpose           TEXT          NOT NULL DEFAULT '',
    credential_ref   VARCHAR(64),
    profile_summary   TEXT          NOT NULL DEFAULT '',
    published_at      TIMESTAMPTZ   NOT NULL,
    deadline          TIMESTAMPTZ   NOT NULL,
    status            VARCHAR(20)   NOT NULL DEFAULT 'published',
    invited_bank_ids  JSONB        NOT NULL DEFAULT '[]',
    winner_bid_id     VARCHAR(64),
    chain_evidence    JSONB        NOT NULL DEFAULT '[]',
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-05 反向竞拍 - 银行出价
-- ============================================================================
CREATE TABLE IF NOT EXISTS bank_bids (
    id                VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id         VARCHAR(64)   NOT NULL DEFAULT 'default',
    tender_id         VARCHAR(64)   NOT NULL REFERENCES tenders(id),
    bank_id           VARCHAR(64)   NOT NULL,
    bank_name         VARCHAR(200)  NOT NULL,
    bank_group        VARCHAR(100),
    rate              NUMERIC(8,4)  NOT NULL,
    amount            INTEGER       NOT NULL,
    term_months       INTEGER       NOT NULL,
    time_to_fund_days INTEGER       NOT NULL,
    conditions        TEXT          NOT NULL DEFAULT '',
    submitted_at      TIMESTAMPTZ   NOT NULL,
    status            VARCHAR(20)   NOT NULL DEFAULT 'pending',
    is_fraudulent     BOOLEAN       NOT NULL DEFAULT FALSE,
    fraud_reason      TEXT,
    signed_hash       VARCHAR(128)  NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-06 积分商城 - 工人账户
-- ============================================================================
CREATE TABLE IF NOT EXISTS worker_accounts (
    id                  VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id           VARCHAR(64)   NOT NULL DEFAULT 'default',
    name                VARCHAR(100)  NOT NULL,
    role                VARCHAR(50)   NOT NULL,
    enterprise_id       VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    device_fp           VARCHAR(100)  NOT NULL,
    balances            JSONB        NOT NULL DEFAULT '{}',
    streak_days         INTEGER       NOT NULL DEFAULT 0,
    monthly_consumption INTEGER       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN worker_accounts.device_fp IS '设备指纹 (防刷分)';

-- ============================================================================
-- ECO-06 积分商城 - 兑换订单
-- ============================================================================
CREATE TABLE IF NOT EXISTS exchange_orders (
    id            VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id     VARCHAR(64)   NOT NULL DEFAULT 'default',
    worker_id     VARCHAR(64)   NOT NULL,
    item_id       VARCHAR(64)   NOT NULL,
    item_name     VARCHAR(200)  NOT NULL,
    credit_cost   INTEGER       NOT NULL,
    currency_cost INTEGER       NOT NULL,
    status        VARCHAR(20)   NOT NULL DEFAULT 'pending',
    placed_at     TIMESTAMPTZ   NOT NULL,
    shipped_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-06 积分商城 - 商品库
-- ============================================================================
CREATE TABLE IF NOT EXISTS shop_items (
    id            VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name          VARCHAR(200)  NOT NULL,
    icon          VARCHAR(20)   DEFAULT '',
    credit_cost   INTEGER       NOT NULL,
    currency_cost INTEGER       NOT NULL,
    stock         INTEGER       NOT NULL DEFAULT 0,
    category      VARCHAR(20)   NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-07 行业合规指数
-- ============================================================================
CREATE TABLE IF NOT EXISTS compliance_indices (
    id           VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id    VARCHAR(64)   NOT NULL DEFAULT 'default',
    type         VARCHAR(50)   NOT NULL,
    industry     VARCHAR(50)   NOT NULL,
    period       VARCHAR(20)   NOT NULL,
    value        NUMERIC(10,4) NOT NULL,
    sample_size  INTEGER       NOT NULL,
    methodology  TEXT          NOT NULL,
    signature    VARCHAR(128)  NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-08 政府报告
-- ============================================================================
CREATE TABLE IF NOT EXISTS gov_reports (
    id                VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id         VARCHAR(64)   NOT NULL DEFAULT 'default',
    type              VARCHAR(50)   NOT NULL,
    enterprise_id     VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    enterprise        VARCHAR(200)  NOT NULL,
    source            VARCHAR(50)   NOT NULL,
    content           TEXT          NOT NULL,
    desensitized_level VARCHAR(20)  NOT NULL DEFAULT 'full',
    submitted_at      TIMESTAMPTZ   NOT NULL,
    status            VARCHAR(20)   NOT NULL DEFAULT 'draft',
    regulator_ack     JSONB,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN gov_reports.enterprise IS '企业名冗余 (project_memory: log() 包含 enterprise)';
COMMENT ON COLUMN gov_reports.source IS '来源 (project_memory: log() 包含 source)';

-- ============================================================================
-- ECO-08 政府背书
-- ============================================================================
CREATE TABLE IF NOT EXISTS gov_endorsements (
    id               VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id        VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id    VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    regulator        VARCHAR(200)  NOT NULL,
    level            VARCHAR(20)   NOT NULL DEFAULT 'provisional',
    granted_at       TIMESTAMPTZ   NOT NULL,
    valid_until      TIMESTAMPTZ   NOT NULL,
    scope            JSONB        NOT NULL DEFAULT '[]',
    linked_report_id VARCHAR(64)   NOT NULL REFERENCES gov_reports(id),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-09 数字分身 - 会话
-- ============================================================================
CREATE TABLE IF NOT EXISTS bot_conversations (
    id             VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id      VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id  VARCHAR(64)   NOT NULL REFERENCES enterprises(id),
    worker_id      VARCHAR(64),
    channel        VARCHAR(20)   NOT NULL,
    messages       JSONB        NOT NULL DEFAULT '[]',
    last_active_at TIMESTAMPTZ   NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ECO-09 数字分身 - 配置
-- ============================================================================
CREATE TABLE IF NOT EXISTS bot_configs (
    id               VARCHAR(64)   PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id        VARCHAR(64)   NOT NULL DEFAULT 'default',
    enterprise_id    VARCHAR(64)   NOT NULL UNIQUE REFERENCES enterprises(id),
    bot_name         VARCHAR(100)  NOT NULL,
    avatar           VARCHAR(200)  DEFAULT '',
    channels         JSONB        NOT NULL DEFAULT '[]',
    default_language VARCHAR(10)   NOT NULL DEFAULT 'zh-CN',
    llm_model        VARCHAR(50)   NOT NULL DEFAULT 'deepseek-v3',
    enabled_intents  JSONB        NOT NULL DEFAULT '[]',
    rate_limit_per_min INTEGER     NOT NULL DEFAULT 60,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 更新触发器 (自动维护 updated_at)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有有 updated_at 的表创建触发器
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            CREATE TRIGGER IF NOT EXISTS trg_%s_updated
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
        ', t, t);
    END LOOP;
END;
$$;
