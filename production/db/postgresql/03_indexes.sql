-- 文件名：03_indexes.sql 职责：FinTrust Hub 性能索引与扩展,为企业/银行/担保/保险/改造状态等表创建查询索引

-- ============================================================================
-- 企业表索引
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_enterprises_tenant ON enterprises(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enterprises_industry ON enterprises(industry) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enterprises_risk ON enterprises(risk_profile) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enterprises_name_trgm ON enterprises USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_enterprises_financing ON enterprises((runtime->>'financingUnlocked')) WHERE deleted_at IS NULL;

-- ============================================================================
-- 银行/担保/保险
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_banks_group ON banks(bank_group) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guarantors_mode ON guarantors(mode) WHERE deleted_at IS NULL;

-- ============================================================================
-- 改造状态
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_reform_states_ent ON reform_states(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_reform_states_status ON reform_states(status);
CREATE INDEX IF NOT EXISTS idx_reform_states_plan ON reform_states(plan_id) WHERE plan_id IS NOT NULL;

-- ============================================================================
-- 改造案例
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_reform_cases_ent ON reform_cases(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_reform_cases_industry ON reform_cases(industry);
CREATE INDEX IF NOT EXISTS idx_reform_cases_outcome ON reform_cases(outcome);

-- ============================================================================
-- ECO-01 阅后即焚
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_burn_audits_ent ON burn_audits(enterprise_id);

-- ============================================================================
-- ECO-02 阶梯定价
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_settlements_ent ON settlement_records(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlement_records(status);

-- ============================================================================
-- ECO-03 信贷申报
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_credit_apps_ent ON credit_applications(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_credit_apps_bank ON credit_applications(bank_id);
CREATE INDEX IF NOT EXISTS idx_credit_apps_status ON credit_applications(status);

-- ============================================================================
-- ECO-04 凭证
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_credentials_ent ON credentials(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(type);
CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status);

-- ============================================================================
-- ECO-05 反向竞拍
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_tenders_ent ON tenders(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(deadline);
CREATE INDEX IF NOT EXISTS idx_bids_tender ON bank_bids(tender_id);
CREATE INDEX IF NOT EXISTS idx_bids_bank ON bank_bids(bank_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bank_bids(status);

-- ============================================================================
-- ECO-06 积分商城
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_workers_ent ON worker_accounts(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_workers_device ON worker_accounts(device_fp);
CREATE INDEX IF NOT EXISTS idx_orders_worker ON exchange_orders(worker_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON exchange_orders(status);
CREATE INDEX IF NOT EXISTS idx_shop_category ON shop_items(category);

-- ============================================================================
-- ECO-07 行业指数
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_indices_type ON compliance_indices(type);
CREATE INDEX IF NOT EXISTS idx_indices_industry ON compliance_indices(industry);
CREATE INDEX IF NOT EXISTS idx_indices_period ON compliance_indices(period);

-- ============================================================================
-- ECO-08 政府报告
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_gov_reports_ent ON gov_reports(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_gov_reports_type ON gov_reports(type);
CREATE INDEX IF NOT EXISTS idx_gov_reports_status ON gov_reports(status);
CREATE INDEX IF NOT EXISTS idx_endorsements_ent ON gov_endorsements(enterprise_id);

-- ============================================================================
-- ECO-09 数字分身
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_bot_convs_ent ON bot_conversations(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_bot_convs_active ON bot_conversations(last_active_at);
CREATE INDEX IF NOT EXISTS idx_bot_configs_ent ON bot_configs(enterprise_id);

-- ============================================================================
-- 全文检索 (企业名/行业标签)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_enterprises_search ON enterprises USING gin(
    to_tsvector('simple', name || ' ' || industry_label || ' ' || risk_label)
);
