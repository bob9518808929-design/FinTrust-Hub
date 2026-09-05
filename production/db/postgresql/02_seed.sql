-- 文件名：02_seed.sql 职责：FinTrust Hub 种子数据,镜像 simulation/mock-data.js 注入开发期企业/银行/担保/保险样本
-- 开发期使用, 生产环境由数据迁移注入

-- ============================================================================
-- 企业 (E001-E004)
-- ============================================================================
INSERT INTO enterprises (id, name, industry, industry_label, industry_policy, risk_profile, risk_label, data_flows, modules, cooperation, data_visibility, financials, runtime, reform) VALUES
('E001', '宏达精密制造有限公司', 'manufacturing', '制造业', 'encourage', 'normal', '一般风险',
 '{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":true,"personnel":false}',
 '{"fundMonitor":"strong","billService":true,"arInsurance":true,"iotPerception":true,"blockchainAnchor":false,"aiAutonomyMax":"L4"}',
 '{"enterpriseMode":["custody","planning"],"bankMode":["pre_loan","post_loan"],"guarantorMode":["collaborate"],"insuranceMode":["joint_underwriting"]}',
 '{"bank":["credit_score","financials","responsibility_chain"],"guarantor":["financials","assets"],"insurance":["bills","ar"]}',
 '{"monthlyRevenue":5000000,"monthlyExpense":3200000,"accountBalance":8000000,"pendingAR":3500000,"billsHeld":[{"billId":"B-2024-001","amount":1200000,"dueDate":"2026-12-31T00:00:00Z","type":"bank_acceptance","insured":true}]}',
 '{"creditCompleteness":0.72,"creditScore":720,"maxAmountMultiplier":1.5,"rateDiscount":0.15,"creditGradeCap":"B","approvalSpeed":"fast","waterLevel":0.62,"fiveStreams":{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":true,"personnel":false},"guaranteeStatus":"active","insuranceStatus":"active","financingUnlocked":true,"responsibilityChain":{"nodes":[{"nodeId":"N01","name":"原料采购","role":"采购","operator":"周销售","method":"扫码确权","creditWeight":10,"stage":"原料"}],"completeness":0.85,"totalScore":40,"complianceReport":null}}',
 '{"status":"completed","progress":1.0,"currentLevel":"A","targetLevel":"A","aggressionLevel":"balanced","startedAt":"2026-06-01T00:00:00Z","completedAt":"2026-08-01T00:00:00Z"}'
),
('E002', '智芯科技有限公司', 'high_tech', '高科技', 'encourage', 'premium', '优质',
 '{"fund":true,"contract":true,"invoice":true,"logistics":false,"iot":true,"personnel":true}',
 '{"fundMonitor":"strong","billService":false,"arInsurance":true,"iotPerception":true,"blockchainAnchor":true,"aiAutonomyMax":"L4"}',
 '{"enterpriseMode":["planning","financing_advisory"],"bankMode":["pre_loan","consulting"],"guarantorMode":[],"insuranceMode":["joint_underwriting"]}',
 '{"bank":["credit_score","financials","iot"],"guarantor":[],"insurance":["ar","personnel"]}',
 '{"monthlyRevenue":8000000,"monthlyExpense":5000000,"accountBalance":15000000,"pendingAR":6000000,"billsHeld":[]}',
 '{"creditCompleteness":0.88,"creditScore":780,"maxAmountMultiplier":2.0,"rateDiscount":0.25,"creditGradeCap":"A","approvalSpeed":"fast","waterLevel":0.75,"fiveStreams":{"fund":true,"contract":true,"invoice":true,"logistics":false,"iot":true,"personnel":true},"guaranteeStatus":"none","insuranceStatus":"active","financingUnlocked":true,"responsibilityChain":{"nodes":[{"nodeId":"N01","name":"研发立项","role":"研发","operator":"黄财务","method":"扫码确权","creditWeight":15,"stage":"研发"}],"completeness":0.90,"totalScore":25,"complianceReport":null}}',
 '{"status":"completed","progress":1.0,"currentLevel":"A","targetLevel":"A","aggressionLevel":"innovative","startedAt":"2026-05-15T00:00:00Z","completedAt":"2026-07-20T00:00:00Z"}'
),
('E003', '鑫达贸易有限公司', 'trade', '贸易', 'neutral', 'high_risk', '较高风险',
 '{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":false,"personnel":false}',
 '{"fundMonitor":"weak","billService":true,"arInsurance":false,"iotPerception":false,"blockchainAnchor":false,"aiAutonomyMax":"L2"}',
 '{"enterpriseMode":["advisory"],"bankMode":["discovery"],"guarantorMode":["compensation"],"insuranceMode":[]}',
 '{"bank":["credit_score"],"guarantor":["financials"],"insurance":[]}',
 '{"monthlyRevenue":3000000,"monthlyExpense":2800000,"accountBalance":2000000,"pendingAR":4500000,"billsHeld":[]}',
 '{"creditCompleteness":0.45,"creditScore":580,"maxAmountMultiplier":0.8,"rateDiscount":0.0,"creditGradeCap":"C","approvalSpeed":"slow","waterLevel":0.35,"fiveStreams":{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":false,"personnel":false},"guaranteeStatus":"pending","insuranceStatus":"none","financingUnlocked":false,"responsibilityChain":{"nodes":[{"nodeId":"N01","name":"采购入库","role":"仓库","operator":"吴司机","method":"扫码确权","creditWeight":8,"stage":"仓储"}],"completeness":0.30,"totalScore":8,"complianceReport":null}}',
 '{"status":"in_progress","progress":0.45,"currentLevel":"C","targetLevel":"A","aggressionLevel":"balanced","startedAt":"2026-08-01T00:00:00Z","completedAt":null}'
),
('E004', '绿源能源科技', 'energy', '新能源', 'encourage', 'normal', '一般风险',
 '{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":true,"personnel":true}',
 '{"fundMonitor":"strong","billService":true,"arInsurance":true,"iotPerception":true,"blockchainAnchor":true,"aiAutonomyMax":"L3"}',
 '{"enterpriseMode":["custody","self_operated"],"bankMode":["pre_loan","post_loan","consulting"],"guarantorMode":["counter_guarantee"],"insuranceMode":["joint_underwriting","claim_collab"]}',
 '{"bank":["credit_score","financials","responsibility_chain","iot"],"guarantor":["financials","assets","bills"],"insurance":["bills","ar","personnel"]}',
 '{"monthlyRevenue":6500000,"monthlyExpense":4200000,"accountBalance":10000000,"pendingAR":5000000,"billsHeld":[{"billId":"B-2024-002","amount":2000000,"dueDate":"2027-03-31T00:00:00Z","type":"electronic","insured":false}]}',
 '{"creditCompleteness":0.80,"creditScore":740,"maxAmountMultiplier":1.7,"rateDiscount":0.18,"creditGradeCap":"A","approvalSpeed":"fast","waterLevel":0.68,"fiveStreams":{"fund":true,"contract":true,"invoice":true,"logistics":true,"iot":true,"personnel":true},"guaranteeStatus":"active","insuranceStatus":"active","financingUnlocked":true,"responsibilityChain":{"nodes":[{"nodeId":"N01","name":"原料采购","role":"采购","operator":"郑采购","method":"扫码确权","creditWeight":10,"stage":"原料"}],"completeness":0.92,"totalScore":50,"complianceReport":null}}',
 '{"status":"completed","progress":1.0,"currentLevel":"A","targetLevel":"A","aggressionLevel":"innovative","startedAt":"2026-04-10T00:00:00Z","completedAt":"2026-07-01T00:00:00Z"}'
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 银行
-- ============================================================================
INSERT INTO banks (id, name, base_rate, base_rate_value, max_amount, requires_guarantee, label, bank_group) VALUES
('BANK-001', '中国工商银行', 'LPR+1.5%', 0.0495, 50000000, false, '国有大行, 额度高, 审批慢', '国有大行'),
('BANK-002', '招商银行', 'LPR+2.0%', 0.0545, 20000000, false, '股份制, 审批快, 数字化强', '股份制'),
('BANK-003', '中信银行', 'LPR+1.8%', 0.0525, 30000000, true, '股份制, 供应链金融强', '股份制'),
('BANK-004', '网商银行', 'LPR+2.5%', 0.0595, 5000000, false, '互联网银行, 秒批秒贷', '互联网')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 担保公司
-- ============================================================================
INSERT INTO guarantors (id, name, mode, active_guarantees, guarantee_rate) VALUES
('GUA-001', '中投保', 'collaborate', 42, '1.5%'),
('GUA-002', '省融资担保公司', 'compensation', 18, '1.2%'),
('GUA-003', '鑫达信用担保', 'counter_guarantee', 7, '2.0%')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 保险公司
-- ============================================================================
INSERT INTO insurers (id, name, mode, active_policies, premium_rate) VALUES
('INS-001', '中国人寿财险', 'joint_underwriting', 56, '0.8%'),
('INS-002', '平安产险', 'claim_collab', 31, '0.7%')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 政策版本
-- ============================================================================
INSERT INTO policy_versions (id, version, label, manufacturing, high_tech, real_estate_related) VALUES
('POL-2026Q3', '2026Q3', '2026 三季度', 'encourage', 'encourage', 'restrict')
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- ECO-06 商品库
-- ============================================================================
INSERT INTO shop_items (id, name, icon, credit_cost, currency_cost, stock, category) VALUES
('shop-001', '充电宝 10000mAh', '🔋', 30, 35, 50, '电子'),
('shop-002', '保温杯 316不锈钢', '☕', 20, 25, 80, '生活'),
('shop-003', '外卖券 30元', '🍱', 25, 30, 100, '餐饮'),
('shop-004', '话费充值 50元', '📱', 40, 50, 200, '通讯'),
('shop-005', '电影票 2D', '🎬', 35, 40, 60, '娱乐')
ON CONFLICT (id) DO NOTHING;
