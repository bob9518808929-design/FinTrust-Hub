/**
 * state.js — FinTrust Hub 全局状态机 + 响应式机制 + 联动规则引擎
 * 联动规则: 4.1(数据流→信用) 4.2(IoT→五流) 4.3(风险→自主度) 4.4(金额→路由) 4.9(责任→信用分)
 */

const State = {
  // === 全局状态 ===
  currentEnterpriseId: 'E001',
  enterprises: [],
  banks: [],
  guarantors: [],
  insurers: [],
  policyVersion: '2026-Q3',
  systemDate: '2026-08-12',
  seasonalWindow: 'normal',

  // === AI操作日志 ===
  aiOperations: [],

  // === 待审批工单 ===
  approvalQueue: [],

  // === 银行竞标报价 ===
  bankBids: [],

  // === 联动日志 ===
  linkageLog: [],

  // === UI状态 ===
  activeTab: 'reform',
  logPanelCollapsed: true,
  logFilter: { view: 'all', type: 'all', keyword: '' },

  // === v4.3 新增: 外部 API 适配层状态 (INFRA-01b) ===
  externalApis: [],
  // 用于独立运行模式切换后恢复的 API 状态快照
  _apiSnapshotBeforeIndependentMode: null,

  // === v4.3 新增: 独立兜底引擎状态 (MOD-15) ===
  fallbackEngine: {
    modules: [],            // C1-C7 兜底子模块
    fallbackChain: {
      currentLevel: 1,       // 1=API接入 / 2=C兜底 / 3=独立运行 / 4=拒绝服务
      triggerEvents: [],
      autoSwitchEnabled: true
    },
    independentMode: {
      enabled: false,
      activatedAt: null,
      degradedServices: [],
      availableServices: []
    },
    selfOperatedTag: '自营兜底·非外部机构背书'
  },

  // === v4.3 新增: B1-B12 自研模块状态矩阵 ===
  selfDevelopedModules: [],

  // === v4.3 新增: 三档开发投入占比仪表盘数据 ===
  tierInvestment: {},

  // === v4.3 新增: 兜底降级链级别定义 (从 MockData 加载) ===
  fallbackChainLevels: {},

  // ============================================================
  // v5.0 新增: Tab0 企业改造引擎状态 (simulation-plan.md v5.0 对齐)
  // ============================================================
  reformEngine: {
    // 全局改造状态
    status: 'idle',          // idle / diagnosing / planning / executing / completed
    currentEnterpriseId: null,
    aggressiveness: 'balanced',   // conservative / balanced / innovative
    autonomyLevel: 'L2',         // L2 / L3 / L4
    targetLevel: 'B',            // 目标银行准入等级: D/C/B/B+/A-/A/A+
    currentLevel: 'D',           // 当前判定等级
    progress: 0,                 // 改造总进度 0-1
    totalTasks: 0,
    completedTasks: 0,

    // 8维改造评分卡(当前值 / 目标值)
    scorecard: {
      current: { subject: 0, finance: 0, tax: 0, business: 0, assets: 0, credit: 0, policy: 0, capital: 0 },
      target:  { subject: 85, finance: 85, tax: 85, business: 80, assets: 80, credit: 90, policy: 70, capital: 75 },
      before:  null   // 改造前快照(点击开始改造时保存)
    },

    // R1-R10 引擎运行状态快照
    engineStatus: {
      R1: { status: 'idle', lastRunAt: null, result: null },
      R2: { status: 'idle', lastRunAt: null, result: null },
      R3: { status: 'idle', lastRunAt: null, result: null },
      R4: { status: 'idle', lastRunAt: null, result: null },
      R5: { status: 'idle', lastRunAt: null, result: null },
      R6: { status: 'idle', lastRunAt: null, result: null },
      R7: { status: 'idle', lastRunAt: null, result: null },
      R8: { status: 'idle', lastRunAt: null, result: null },
      R9: { status: 'idle', lastRunAt: null, result: null },
      R10:{ status: 'idle', lastRunAt: null, result: null }
    },

    // R2 差距诊断报告 (点击"AI差距诊断"后由 ReformEngine 填充)
    gapReport: null,
    // R3 生成的改造方案集 (3条路径, 用户选1条)
    reformPlans: [],
    selectedPlanId: null,
    // R4 生成的任务 DAG
    taskDAG: [],
    // 已完成的改造动作记录(类似E004.completedActions)
    completedActions: [],
    // R9 银行匹配结果
    bankMatches: [],
    // R10 推荐的相似案例
    similarCases: [],
    // 预估成本/周期
    estimation: { totalCost: 0, totalDays: 0, creditGain: 0 }
  },

  // ============================================================
  // v6.0 新增: 供应链金融 (SCF) 子系统状态 (simulation-plan.md 第七章)
  // ============================================================
  scfDatabase: {
    // Layer 1: 主数据
    enterprises: [],          // SCF 企业主数据 (供应商/经销商)
    products: [],             // SCF 产品库 (5 类)
    institutions: [],         // SCF 机构库 (银行/保理/担保/保险)
    // Layer 2: 关系数据
    relationships: [],        // 供应链关系
    trades: [],               // 贸易记录
    blacklist: [],            // 黑名单
    whitelist: [],            // 白名单
    // Layer 3: 交易数据 (运行时生成)
    financingRequests: [],    // 融资申请
    loans: [],                // 放款记录
    repayments: [],           // 还款记录
    // Layer 4: 风控数据 (运行时生成)
    riskEvents: [],           // 风险事件
    creditPropagation: [],    // 信用传导记录
    performanceRecords: [],   // 履约记录
    // 关系图谱 (由 SC1 构建)
    graph: { nodes: [], edges: [], clusters: [] },
    // 案例库
    cases: []
  },

  scfEngine: {
    status: 'idle',                  // idle / running / completed
    currentAnchorId: null,           // 当前选中的核心企业 ID
    selectedPartnerId: null,         // 当前选中的上下游企业 ID
    activeTradeId: null,             // 当前操作的贸易记录 ID
    // SC1-SC10 引擎状态
    engineStatus: {
      SC1: { status: 'idle', lastRunAt: null, result: null },
      SC2: { status: 'idle', lastRunAt: null, result: null },
      SC3: { status: 'idle', lastRunAt: null, result: null },
      SC4: { status: 'idle', lastRunAt: null, result: null },
      SC5: { status: 'idle', lastRunAt: null, result: null },
      SC6: { status: 'idle', lastRunAt: null, result: null },
      SC7: { status: 'idle', lastRunAt: null, result: null },
      SC8: { status: 'idle', lastRunAt: null, result: null },
      SC9: { status: 'idle', lastRunAt: null, result: null },
      SC10: { status: 'idle', lastRunAt: null, result: null }
    },
    // SC8 机构撮合结果
    matchmakingResults: [],
    // SC7 风险预警
    riskWarnings: [],
    // localStorage 持久化 key
    storageKey: 'fintrust_scf_db_v1'
  },

  // === 订阅者 ===
  _subscribers: [],

  // === 初始化 ===
  init() {
    this.enterprises = JSON.parse(JSON.stringify(MockData.ENTERPRISES));
    this.banks = JSON.parse(JSON.stringify(MockData.BANKS));
    this.guarantors = JSON.parse(JSON.stringify(MockData.GUARANTORS));
    this.insurers = JSON.parse(JSON.stringify(MockData.INSURERS));
    this.activeAlerts = []; // 全局活跃告警(边缘案例触发,所有Tab顶部横幅可见)
    this.updateSeasonalWindow();
    // 为每家企业初始化责任节点
    this.enterprises.forEach(e => this.initResponsibilityNodes(e));
    this.log('system', '系统初始化完成，加载3家企业、3家银行', 'config');

    // 预置历史AI操作记录 (让AI驾驶舱初始即有数据)
    this._seedInitialAIOperations();
    // 预置待审批工单 (让人工审批台初始即有数据)
    this._seedInitialApprovals();

    // APP-04 监管沙盒状态
    this.penetrationReports = [];
    // APP-07 关联机构任务状态
    this.partnerTasks = [];
    this._seedInitialPartnerTasks();

    // v4.3: 加载三档分类能力数据
    this._initTierCapabilityData();

    // v5.0: 初始化 Tab0 企业改造引擎 (R1-R10 + 8维评分卡)
    this._initReformEngine();

    // v6.0: 初始化 SCF 子系统 (从 scf-data.js 加载 + localStorage 恢复)
    this._initSCFDatabase();
  },

  // === v5.0 新增: Tab0 改造引擎初始化 ===
  _initReformEngine() {
    const re = this.reformEngine;
    re.status = 'idle';
    // 默认当前企业的改造状态
    re.currentEnterpriseId = this.currentEnterpriseId;
    // 根据企业 runtime 数据初始化 8 维评分卡的当前值
    this._refreshReformScorecardFromEnterprise();
    // 判定当前等级
    re.currentLevel = this._computeReformLevel(re.scorecard.current);
    // 根据企业风险画像设定默认目标等级
    const levelMap = { premium: 'A', normal: 'B+', high_risk: 'B-' };
    re.targetLevel = levelMap[this.currentEnterprise.riskProfile] || 'B';
    // R10 预加载 Top3 相似案例
    if (typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR10 === 'function') {
      re.similarCases = ReformEngine.runR10(this.currentEnterprise);
    } else {
      re.similarCases = MockData.REFORM_CASES ? MockData.REFORM_CASES.slice(0, 3) : [];
    }
    this.log('reform', `→ Tab0 改造引擎初始化: 8维评分卡就绪, 当前等级 ${re.currentLevel}, 目标等级 ${re.targetLevel}`, 'reform');
    console.info('[ReformTrace][Init] _initReformEngine 完成:', {
      currentLevel: re.currentLevel, targetLevel: re.targetLevel,
      scorecardCurrent: re.scorecard.current, similarCases: re.similarCases.length
    });
  },

  // === v5.0 辅助: 根据企业 runtime 数据刷新 8 维评分卡 ===
  _refreshReformScorecardFromEnterprise() {
    const ent = this.currentEnterprise;
    const re = this.reformEngine;
    const sc = re.scorecard.current;
    // 如果企业已改造完成, 直接使用 afterScorecard 作为当前值
    if (ent.reform && ent.reform.hasReformed && ent.reform.afterScorecard) {
      Object.assign(sc, ent.reform.afterScorecard);
      return;
    }
    // 如果企业未改造但提供了 beforeScorecard (测试用预设画像), 优先使用
    if (ent.reform && !ent.reform.hasReformed && ent.reform.beforeScorecard) {
      Object.assign(sc, ent.reform.beforeScorecard);
      return;
    }
    // 否则根据 runtime 数据估算 (P0 优先级, 简化算法)
    // D 级 30-40 分, C 级 40-60, B 级 60-80, A 级 80+
    const cs = ent.runtime.creditScore;   // 520-860
    const cc = ent.runtime.creditCompleteness; // 0.17-1.00
    // 信用维度 (直接映射)
    sc.credit = Math.min(100, Math.max(20, Math.round((cs - 500) / 4)));
    // 财务维度 (营收+支出比+余额)
    const profitRatio = (ent.financials.monthlyRevenue - ent.financials.monthlyExpense) / ent.financials.monthlyRevenue;
    sc.finance = Math.min(100, Math.max(20, Math.round(cc * 60 + profitRatio * 40 + 20)));
    // 主体/税务/业务/资产/政策/资金 根据数据流+模块配置组合估算
    const flows = Object.values(ent.dataFlows).filter(v => v).length;
    sc.subject  = Math.min(100, 20 + flows * 8 + (ent.creditGradeCap === 'A' ? 20 : ent.creditGradeCap === 'B' ? 10 : 0));
    sc.tax      = Math.min(100, 25 + flows * 7 + (ent.dataFlows.invoice ? 15 : 0));
    sc.business = Math.min(100, 25 + flows * 8 + (ent.dataFlows.logistics ? 15 : 0));
    sc.assets   = Math.min(100, 30 + flows * 6 + (ent.dataFlows.iot ? 10 : 0));
    sc.policy   = Math.min(100, 35 + (ent.industryPolicy === 'encourage' ? 30 : ent.industryPolicy === 'neutral' ? 15 : 0));
    sc.capital  = Math.min(100, 30 + (ent.runtime.guaranteeStatus === 'active' ? 20 : 0) + (ent.runtime.insuranceStatus === 'active' ? 15 : 0) + flows * 3);
    // 高风险企业向下拉低 10 分
    if (ent.riskProfile === 'high_risk') {
      Object.keys(sc).forEach(k => { sc[k] = Math.max(15, sc[k] - 10); });
    }
  },

  // === v5.0 辅助: 根据 8 维评分卡计算综合等级 ===
  // D <40 / C 40-60 / B- 55-65 / B 60-72 / B+ 70-80 / A- 78-88 / A 85-95 / A+ >=92
  _computeReformLevel(sc) {
    // 加权平均 (weight 来自 MockData.REFORM_DIMENSIONS)
    const dims = MockData.REFORM_DIMENSIONS || {};
    let totalWeight = 0, weightedScore = 0;
    Object.keys(sc).forEach(k => {
      const w = dims[k] && dims[k].weight ? dims[k].weight : 0.125;
      totalWeight += w;
      weightedScore += sc[k] * w;
    });
    const avg = totalWeight > 0 ? weightedScore / totalWeight : 0;
    if (avg >= 92) return 'A+';
    if (avg >= 85) return 'A';
    if (avg >= 78) return 'A-';
    if (avg >= 70) return 'B+';
    if (avg >= 60) return 'B';
    if (avg >= 50) return 'C+';
    if (avg >= 40) return 'C';
    return 'D';
  },

  // === v4.3 新增: 初始化三档分类能力数据 ===
  _initTierCapabilityData() {
    // 🟢 API 档: 15 个外部 API
    this.externalApis = JSON.parse(JSON.stringify(MockData.EXTERNAL_APIS));
    // 🔴 兜底档: C1-C7 兜底子模块
    this.fallbackEngine.modules = JSON.parse(JSON.stringify(MockData.FALLBACK_MODULES));
    // 🟡 自研档: B1-B12 自研护城河模块矩阵
    this.selfDevelopedModules = JSON.parse(JSON.stringify(MockData.SELF_DEVELOPED_MODULES));
    // 📊 三档开发投入占比仪表盘数据
    this.tierInvestment = JSON.parse(JSON.stringify(MockData.TIER_INVESTMENT));
    // 兜底降级链级别定义
    this.fallbackChainLevels = JSON.parse(JSON.stringify(MockData.FALLBACK_CHAIN_LEVELS));

    // 根据 API 初始状态计算兜底降级链当前级别 (API-06/11/13/14 默认断开 → C3 已激活)
    this._recomputeFallbackChainLevel();

    const connectedApis = this.externalApis.filter(a => a.status === 'connected').length;
    const activeFallbacks = this.fallbackEngine.modules.filter(m => m.status === 'active').length;
    this.log('system', `→ 三档分类能力数据加载: API 档 ${connectedApis}/15 接入 / 自研档 B1-B12 全 active / 兜底档 ${activeFallbacks}/7 激活`, 'fallback');
  },

  // === v4.3 新增: 根据 API 状态与 C 模块状态重算降级链级别 ===
  _recomputeFallbackChainLevel() {
    const independentMode = this.fallbackEngine.independentMode.enabled;
    const beforeLevel = this.fallbackEngine.fallbackChain.currentLevel;
    if (independentMode) {
      this.fallbackEngine.fallbackChain.currentLevel = 3;
      console.info(`[FallbackTrace][Chain] _recompute L${beforeLevel} → L3 (independentMode=on, 跳过 active 计数)`);
      return;
    }
    const activeFallbacks = this.fallbackEngine.modules.filter(m => m.status === 'active').length;
    let newLevel;
    if (activeFallbacks === 0) {
      newLevel = 1;
    } else if (activeFallbacks < 7) {
      newLevel = 2;
    } else {
      newLevel = 3;
    }
    this.fallbackEngine.fallbackChain.currentLevel = newLevel;
    console.info(`[FallbackTrace][Chain] _recompute L${beforeLevel} → L${newLevel} (activeC=${activeFallbacks}/7, independentMode=off)`);
  },

  // === 全局活跃告警(边缘案例触发,所有Tab顶部横幅可见) ===
  // type: 告警唯一标识(用于clearAlerts按类型清除), severity: red/orange/yellow
  addAlert(type, title, text, severity = 'red', extra = {}) {
    // 同类型不重复添加(只更新)
    const existing = this.activeAlerts.find(a => a.type === type);
    if (existing) {
      existing.title = title; existing.text = text;
      existing.severity = severity; existing.updatedAt = Date.now();
      Object.assign(existing, extra);
      return;
    }
    this.activeAlerts.push({
      type, title, text, severity,
      id: 'ALT_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      ...extra
    });
  },

  dismissAlert(id) {
    const idx = this.activeAlerts.findIndex(a => a.id === id);
    if (idx !== -1) {
      const removed = this.activeAlerts.splice(idx, 1)[0];
      this.log('system', `告警已忽略: ${removed.title}`, 'config');
      this._notify();
    }
  },

  // 按条件清除告警(如 unblockFundFlow → 清除 fund_blocked 类型)
  clearAlerts(predicate) {
    const before = this.activeAlerts.length;
    this.activeAlerts = this.activeAlerts.filter(a => !predicate(a));
    const removed = before - this.activeAlerts.length;
    if (removed > 0) {
      this.log('system', `→ 自动清除 ${removed} 条相关告警(状态已恢复)`, 'config');
    }
  },

  // 切换企业时清空所有告警(避免上一家企业的告警污染下一家)
  clearAllAlerts() {
    this.activeAlerts = [];
  },

  // === 预置历史AI操作 ===
  _seedInitialAIOperations() {
    const seeds = [
      {
        action: '宏达精密制造融资80万自动审批通过',
        level: 'L1', confidence: 88, enterprise: '宏达精密制造有限公司',
        reasoning: [
          '触发事件: 企业发起融资请求80万',
          '输入数据: 信用评分720, 4流开放, 制造业',
          '风险评分: 720 (正常)',
          '规则匹配: 金额<100万 + 自主度上限L2 → L1路由',
          '银行竞标: 3家银行报价',
          '最终决策: 自动审批通过',
          '执行结果: 资金已到账, 水位更新'
        ]
      },
      {
        action: '智芯科技融资300万推送人工审批',
        level: 'L3', confidence: 72, enterprise: '智芯科技有限公司',
        reasoning: [
          '触发事件: 企业发起融资请求300万',
          '风险评分: 780 (优质)',
          '规则匹配: 金额<500万但自主度上限L1 → L3路由',
          '决策: 推送人工审批工作台'
        ]
      },
      {
        action: '瑞丰贸易融资500万自动审批通过(L2)',
        level: 'L2', confidence: 76, enterprise: '瑞丰贸易有限公司',
        reasoning: [
          '触发事件: 企业发起融资请求500万',
          '输入数据: 信用评分650, 5流开放, 贸易业',
          '风险评分: 650 (正常)',
          '规则匹配: 金额<500万 + 自主度上限L2 → L2路由',
          '银行竞标: 3家银行报价',
          '最终决策: AI自主审批通过+通知企业'
        ]
      },
      {
        action: 'IoT设备监测: 宏达精密制造仓储设备正常运行',
        level: 'L1', confidence: 95, enterprise: '宏达精密制造有限公司',
        reasoning: [
          '触发事件: 定时IoT设备健康检查',
          '输入数据: 12台IoT设备在线, 数据上传正常',
          '规则匹配: IoT模块启用 → 自动监测',
          '最终决策: 无异常, 继续监测'
        ]
      },
      {
        action: '责任链审计: 瑞丰贸易3个节点未确认',
        level: 'L2', confidence: 91, enterprise: '瑞丰贸易有限公司',
        reasoning: [
          '触发事件: 责任链完整度低于50%',
          '输入数据: 12个节点中9个pending',
          '规则匹配: 责任链完整度<50% → 触发管理风险提醒',
          '最终决策: 通知企业完善责任确认'
        ]
      }
    ];
    // 按时间倒序加入 (最早的最先)
    seeds.reverse().forEach((s, i) => {
      this.aiOperations.unshift({
        id: 'AI_SEED_' + i,
        timestamp: new Date(Date.now() - (seeds.length - i) * 3600000).toLocaleTimeString('zh-CN', { hour12: false }),
        ...s
      });
    });
  },

  // === 预置待审批工单 ===
  _seedInitialApprovals() {
    this.approvalQueue.push({
      id: 'AQ_SEED_1',
      enterpriseId: 'E002',
      enterpriseName: '智芯科技有限公司',
      amount: 3000000,
      routeLevel: 'L3',
      riskScore: 780,
      creditGrade: 'A',
      timestamp: new Date(Date.now() - 1800000).toLocaleTimeString('zh-CN', { hour12: false }),
      status: 'pending',
      aiSuggestion: '建议通过',
      aiConfidence: 72
    });
    this.approvalQueue.push({
      id: 'AQ_SEED_2',
      enterpriseId: 'E003',
      enterpriseName: '瑞丰贸易有限公司',
      amount: 8000000,
      routeLevel: 'L4',
      riskScore: 650,
      creditGrade: 'B',
      timestamp: new Date(Date.now() - 600000).toLocaleTimeString('zh-CN', { hour12: false }),
      status: 'pending',
      aiSuggestion: '建议谨慎审查',
      aiConfidence: 58
    });
  },

  // === 订阅状态变更 ===
  subscribe(callback) {
    this._subscribers.push(callback);
  },

  _notify() {
    this._subscribers.forEach(cb => cb());
  },

  // === 获取当前企业 ===
  get currentEnterprise() {
    return this.enterprises.find(e => e.id === this.currentEnterpriseId) || this.enterprises[0];
  },

  // === 日志记录 ===
  log(view, message, type = 'info') {
    const entry = {
      id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      view,
      source: view,
      type,
      message,
      enterprise: this.currentEnterprise ? this.currentEnterprise.name : null
    };
    this.linkageLog.push(entry);
    if (this.linkageLog.length > 500) this.linkageLog.shift();
  },

  // === AI操作记录 ===
  logAIOperation(operation) {
    const entry = {
      id: 'AI_' + Date.now(),
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      ...operation
    };
    this.aiOperations.unshift(entry);
    if (this.aiOperations.length > 100) this.aiOperations.pop();
  },

  // === 初始化责任节点 ===
  initResponsibilityNodes(enterprise) {
    enterprise.runtime.responsibilityChain.nodes = MockData.RESPONSIBILITY_NODES_TEMPLATE.map(n => ({
      ...n,
      status: 'pending',
      confirmedAt: null,
      traceCode: null
    }));
  },

  // ========================================
  //  联动规则引擎
  // ========================================

  // === 切换企业 (P2优先级) ===
  switchEnterprise(enterpriseId) {
    const prev = this.currentEnterprise;
    this.currentEnterpriseId = enterpriseId;
    const curr = this.currentEnterprise;
    // 切换企业清空上一家企业的告警(避免污染)
    this.clearAllAlerts();
    this.log('enterprise', `企业切换: ${prev.name} → ${curr.name}`, 'config');

    // 联动规则 4.3: 风险等级 → AI自主度上限建议 (写入生效)
    const autonomyMap = { premium: 'L1', normal: 'L2', high_risk: 'L3' };
    const suggestedAutonomy = autonomyMap[curr.riskProfile];
    const prevAutonomy = curr.modules.aiAutonomyMax;
    const prevNum = parseInt(prevAutonomy.replace('L', ''));
    const suggNum = parseInt(suggestedAutonomy.replace('L', ''));
    // 高风险企业取更保守值(更大L号); 低风险可放宽但不超过建议上限
    if (suggNum > prevNum) {
      curr.modules.aiAutonomyMax = suggestedAutonomy;
      this.log('enterprise', `→ 企业切换为[${curr.riskLabel}]，AI自主度上限建议调整为${suggestedAutonomy}（更保守）`, 'config');
    } else {
      this.log('enterprise', `→ 企业风险等级[${curr.riskLabel}]，AI自主度上限${curr.modules.aiAutonomyMax}（建议${suggestedAutonomy}）`, 'config');
    }
    this.log('enterprise', `→ 信用维度完整度: ${(curr.runtime.creditCompleteness * 100).toFixed(0)}% (${this.countOpenFlows(curr)}流/6流)`, 'config');
    this.log('enterprise', `→ 信用评分: ${curr.runtime.creditScore}`, 'config');
    this.log('enterprise', `→ 融资额度上限: ${this.formatAmount(curr.financials.accountBalance * curr.runtime.maxAmountMultiplier * 3)}`, 'config');
    this.log('enterprise', `→ 利率: ${this.getRateString(curr)}`, 'config');
    this.log('enterprise', `→ 确权等级上限: ${curr.runtime.creditGradeCap}级`, 'config');
    this.log('enterprise', `→ 行业政策: ${this.getPolicyLabel(curr.industryPolicy)}(${curr.industryLabel})`, 'config');

    // v5.0 联动规则 5.1: 企业切换 → Tab0 改造引擎自动刷新
    this._linkage5_1_reformRefreshEnterprise(curr);
    // v5.0 联动规则 5.4 检查 (如果企业已处于改造完成状态,则自动触发银行匹配)
    if (this.reformEngine.status === 'completed') {
      this._linkage5_4_autoBankMatch(curr);
    }

    this._notify();
  },

  // === 联动规则 4.1: 数据流 → 信用维度完整度 → 融资能力 ===
  toggleDataFlow(flowKey) {
    const ent = this.currentEnterprise;
    ent.dataFlows[flowKey] = !ent.dataFlows[flowKey];
    const label = MockData.DATA_FLOW_LABELS[flowKey];
    const action = ent.dataFlows[flowKey] ? '开放了' : '关闭了';
    this.log('enterprise', `${action}"${label}"`, 'config');

    this.recalcCreditCompleteness(ent);

    this._notify();
  },

  recalcCreditCompleteness(ent) {
    const openCount = this.countOpenFlows(ent);
    const prevCompleteness = ent.runtime.creditCompleteness;
    ent.runtime.creditCompleteness = openCount / 6;

    this.log('enterprise', `→ 信用维度完整度: ${(prevCompleteness * 100).toFixed(0)}% → ${(ent.runtime.creditCompleteness * 100).toFixed(0)}%`, 'config');

    // 重新计算融资能力 (阈值: 6/6=1.0, 4/6=0.667, 2/6=0.333)
    const c = ent.runtime.creditCompleteness;
    const prev = { ...ent.runtime };

    if (c >= 0.99) {
      ent.runtime.maxAmountMultiplier = 1.3;
      ent.runtime.rateDiscount = -0.5;
      ent.runtime.creditGradeCap = 'A';
      ent.runtime.approvalSpeed = 'fast';
    } else if (c >= 0.66) {
      ent.runtime.maxAmountMultiplier = 1.0;
      ent.runtime.rateDiscount = 0;
      ent.runtime.creditGradeCap = 'B';
      ent.runtime.approvalSpeed = 'normal';
    } else if (c >= 0.33) {
      ent.runtime.maxAmountMultiplier = 0.7;
      ent.runtime.rateDiscount = 1.0;
      ent.runtime.creditGradeCap = 'C';
      ent.runtime.approvalSpeed = 'slow';
    } else {
      ent.runtime.maxAmountMultiplier = 0.5;
      ent.runtime.rateDiscount = 2.0;
      ent.runtime.creditGradeCap = 'C';
      ent.runtime.approvalSpeed = 'slow';
    }

    this.log('enterprise', `→ 融资额度乘数: ${prev.maxAmountMultiplier.toFixed(1)} → ${ent.runtime.maxAmountMultiplier.toFixed(1)}`, 'config');
    this.log('enterprise', `→ 利率调整: ${prev.rateDiscount >= 0 ? '+' : ''}${prev.rateDiscount}% → ${ent.runtime.rateDiscount >= 0 ? '+' : ''}${ent.runtime.rateDiscount}%`, 'config');
    this.log('enterprise', `→ 确权等级上限: ${prev.creditGradeCap}级 → ${ent.runtime.creditGradeCap}级`, 'config');
    this.log('enterprise', `→ 审批速度: ${prev.approvalSpeed} → ${ent.runtime.approvalSpeed}`, 'config');
  },

  // === 联动规则 4.2: IoT模块 → 五流合一 → 确权等级 ===
  toggleModule(moduleKey) {
    const ent = this.currentEnterprise;
    if (typeof ent.modules[moduleKey] === 'boolean') {
      ent.modules[moduleKey] = !ent.modules[moduleKey];
    } else if (typeof ent.modules[moduleKey] === 'string') {
      const cycle = { strong: 'weak', weak: 'none', none: 'strong' };
      ent.modules[moduleKey] = cycle[ent.modules[moduleKey]] || 'strong';
    }

    this.log('enterprise', `模块"${this.getModuleLabel(moduleKey)}"切换为: ${this.getModuleValueLabel(moduleKey, ent.modules[moduleKey])}`, 'config');

    // IoT特殊处理
    if (moduleKey === 'iotPerception') {
      if (ent.modules.iotPerception) {
        ent.runtime.fiveStreams.iot = false; // 可达但未验证
        this.log('enterprise', '→ IoT感知已启用，五流合一验证可用，确权等级上限可至A', 'config');
      } else {
        ent.runtime.fiveStreams.iot = false;
        if (ent.runtime.creditGradeCap === 'A') {
          ent.runtime.creditGradeCap = 'B';
          this.log('enterprise', '→ IoT感知已停用，降级为四流合一，确权等级上限锁定为B', 'config');
        }
      }
    }

    // 自主度上限调整
    if (moduleKey === 'aiAutonomyMax') {
      this.log('enterprise', `→ AI自主度上限调整为: ${ent.modules.aiAutonomyMax}`, 'config');
    }

    this._notify();
  },

  // === 联动规则 4.4: 融资金额 → 自主度路由 ===
  routeFinancing(amount) {
    const ent = this.currentEnterprise;
    const autonomyMax = ent.modules.aiAutonomyMax;
    const maxLevel = parseInt(autonomyMax.replace('L', ''));

    let routeLevel, routeDesc;
    if (amount < 1000000 && maxLevel >= 1) {
      routeLevel = 'L1';
      routeDesc = 'AI全自主执行';
    } else if (amount < 5000000 && maxLevel >= 2) {
      routeLevel = 'L2';
      routeDesc = 'AI自主+通知';
    } else if (maxLevel >= 3) {
      routeLevel = 'L3';
      routeDesc = 'AI建议+人工审批';
    } else {
      routeLevel = 'L4';
      routeDesc = '人工全权处理';
    }

    this.log('flow', `发起融资请求: ${this.formatAmount(amount)}`, 'financing');
    this.log('flow', `→ 风险评分: ${ent.runtime.creditScore} (${ent.riskLabel})`, 'financing');
    this.log('flow', `→ 金额${amount < 1000000 ? '<100万' : amount < 5000000 ? '<500万' : '>=500万'} + 自主度上限${autonomyMax} → 路由至[${routeLevel} ${routeDesc}]`, 'financing');

    return { routeLevel, routeDesc, amount };
  },

  // === 融资流程执行 ===
  executeFinancing(amount, routeLevel, routeDesc) {
    const ent = this.currentEnterprise;

    if (routeLevel === 'L1' || routeLevel === 'L2') {
      // AI自主执行
      this.log('flow', `→ AI执行[${routeLevel}]: 自动审批通过`, 'financing');

      // 模拟银行竞标
      this.simulateBankBids(amount);

      // 资金到账
      ent.financials.accountBalance += amount;
      const prevWater = ent.runtime.waterLevel;
      ent.runtime.waterLevel = Math.min(0.95, prevWater + amount / 10000000);

      this.log('flow', `→ 资金${this.formatAmount(amount)}已到账`, 'financing');
      this.log('flow', `→ 监管账户余额: ${this.formatAmount(ent.financials.accountBalance - amount)} → ${this.formatAmount(ent.financials.accountBalance)}`, 'financing');
      this.log('flow', `→ 动态水位: ${prevWater.toFixed(2)} → ${ent.runtime.waterLevel.toFixed(2)}`, 'financing');

      // AI操作记录
      this.logAIOperation({
        action: `融资${this.formatAmount(amount)}自动审批通过`,
        level: routeLevel,
        confidence: Math.floor(75 + Math.random() * 20),
        enterprise: ent.name,
        reasoning: [
          `触发事件: 企业发起融资请求${this.formatAmount(amount)}`,
          `输入数据: 信用评分${ent.runtime.creditScore}, ${this.countOpenFlows(ent)}流开放, ${ent.industryLabel}`,
          `风险评分: ${ent.runtime.creditScore} (${ent.riskLabel})`,
          `规则匹配: 金额${amount < 1000000 ? '<100万' : '<500万'} + 自主度上限${ent.modules.aiAutonomyMax} → ${routeLevel}路由`,
          `银行竞标: ${this.banks.length}家银行报价`,
          `最终决策: 自动审批通过`,
          `执行结果: 资金已到账, 水位更新`
        ]
      });
    } else {
      // 推送审批台
      this.log('flow', `→ 推送至人工审批工作台 (L3/L4)`, 'financing');
      const newReq = {
        id: 'AQ_' + Date.now(),
        enterpriseId: ent.id,
        enterpriseName: ent.name,
        amount,
        routeLevel,
        riskScore: ent.runtime.creditScore,
        creditGrade: ent.runtime.creditGradeCap,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        status: 'pending',
        aiSuggestion: '建议通过',
        aiConfidence: Math.floor(65 + Math.random() * 20)
      };
      this.approvalQueue.push(newReq);

      this.logAIOperation({
        action: `融资${this.formatAmount(amount)}推送人工审批`,
        level: routeLevel,
        confidence: Math.floor(60 + Math.random() * 20),
        enterprise: ent.name,
        reasoning: [
          `触发事件: 企业发起融资请求${this.formatAmount(amount)}`,
          `风险评分: ${ent.runtime.creditScore} (${ent.riskLabel})`,
          `规则匹配: 金额>=500万或自主度上限<=L2 → ${routeLevel}路由`,
          `决策: 推送人工审批工作台`
        ]
      });
      // 融资流程中不弹阻塞Modal(避免打断操作流), 改用非阻塞toast引导去Tab3处理
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'approval',
          title: '📤 融资请求已推送人工审批',
          text: `${ent.name} ${this.formatAmount(amount)} · ${routeLevel}路由, 请前往 Tab3 处理`,
          color: 'orange',
          duration_ms: 6500,
          actionLabel: '→ 去Tab3处理',
          onAction: () => { if (typeof App !== 'undefined') App.switchTab('approval'); }
        });
      }
    }

    this._notify();
    return routeLevel;
  },

  // === 模拟银行竞标 ===
  simulateBankBids(amount) {
    const ent = this.currentEnterprise;
    this.bankBids = [];

    this.banks.forEach(bank => {
      let rate = bank.baseRateValue;
      // 信用评分影响
      if (ent.runtime.creditScore > 800) rate -= 0.3;
      else if (ent.runtime.creditScore < 600) rate += 0.5;
      // 政策影响
      if (ent.industryPolicy === 'encourage') rate -= 0.2;
      else if (ent.industryPolicy === 'restrict') rate += 0.5;
      // 季节性
      rate += MockData.SEASONAL_WINDOWS[this.seasonalWindow].rateAdjust;
      // 担保/保险
      if (ent.runtime.guaranteeStatus === 'active') rate -= 0.3;
      if (ent.runtime.insuranceStatus === 'active') rate -= 0.2;
      // 银行自身要求
      if (bank.requiresGuarantee && ent.runtime.guaranteeStatus !== 'active') rate += 0.3;

      const offeredAmount = Math.min(bank.maxAmount, amount * 1.1);
      const canFulfill = offeredAmount >= amount;

      this.bankBids.push({
        bankId: bank.id,
        bankName: bank.name,
        rate: rate.toFixed(2) + '%',
        rateValue: rate,
        amount: offeredAmount,
        canFulfill,
        condition: bank.requiresGuarantee ? '需担保' : '无担保',
        requiresGuarantee: bank.requiresGuarantee
      });
    });

    // 排序：利率最低优先
    this.bankBids.sort((a, b) => a.rateValue - b.rateValue);

    const best = this.bankBids[0];
    if (best) {
      this.log('flow', `→ 银行竞标: ${this.bankBids.length}家银行报价`, 'financing');
      this.bankBids.forEach(b => {
        this.log('flow', `  ${b.bankName}: 利率${b.rate} / 额度${this.formatAmount(b.amount)} / ${b.condition}${b.canFulfill ? '' : ' / 额度不足'}`, 'financing');
      });
      this.log('flow', `→ AI推荐: ${best.bankName} (利率最低${best.rate}${best.canFulfill ? '+额度充足' : ''})`, 'financing');
    }
  },

  // === 六流模型验证 ===
  // spec六流模型 = 五流合一(资金/合同/发票/物流/IoT) + 人流(责任链,第零流,独立确认)
  // verifyFiveStreams: 验证五流合一(不含人流)
  // verifySixStreams: 验证六流模型(五流 + 人流责任链完整度)
  verifyFiveStreams() {
    const ent = this.currentEnterprise;
    const flows = ent.dataFlows;
    const results = {};

    // 合同流: 需要contract开放
    results.contract = flows.contract ? this.mockVerify('合同流', '已匹配(合同#CT' + Date.now().toString().slice(-6) + ')') : { passed: false, desc: '未开放合同流数据' };
    // 发票流: 需要invoice开放
    results.invoice = flows.invoice ? this.mockVerify('发票流', '税务认证通过') : { passed: false, desc: '未开发票流数据' };
    // 物流流: 需要logistics开放
    results.logistics = flows.logistics ? this.mockVerify('物流流', '签收GPS已确认') : { passed: false, desc: '未开放物流流数据' };
    // 资金流: 需要fund开放 且 未被冻结 (验证层: 支付指令与银行流水交叉验证)
    if (!flows.fund) {
      results.fund = { passed: false, desc: '未开放资金流数据' };
    } else if (ent.runtime.fundFlowBlocked) {
      results.fund = { passed: false, desc: '❌ 资金流冻结（白名单外转账异常）' };
    } else {
      results.fund = this.mockVerify('资金流', '付款流水已核对');
    }
    // 物联流: 需要iot模块启用
    results.iot = ent.modules.iotPerception ? this.mockVerify('物联流', 'IoT设备数据已确认') : { passed: false, desc: 'IoT模块未启用' };

    const passedCount = Object.values(results).filter(r => r.passed).length;
    const allFive = passedCount === 5;
    const fourPlus = passedCount >= 4;

    let grade = 'C';
    if (allFive) grade = 'A';
    else if (fourPlus) grade = 'B';

    this.log('flow', `五流合一验证完成: ${passedCount}/5流通过 → 确权等级: ${grade}级 (人流责任链独立确认)`, 'financing');

    return { results, passedCount, grade, allFive, fourPlus };
  },

  // 六流模型验证别名(五流 + 人流): 兼容旧调用，统一术语
  verifySixStreams() {
    const fiveResult = this.verifyFiveStreams();
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const humanFlow = chain ? { passed: chain.completeness >= 0.5, desc: `责任链完整度${(chain.completeness * 100).toFixed(0)}%` } : { passed: false, desc: '责任链未初始化' };
    const totalPassed = fiveResult.passedCount + (humanFlow.passed ? 1 : 0);
    this.log('flow', `六流模型验证: ${totalPassed}/6流通过 (五流${fiveResult.passedCount} + 人流${humanFlow.passed ? '✓' : '✗'})`, 'financing');
    return { ...fiveResult, humanFlow, totalPassed, sixAllPassed: totalPassed === 6 };
  },

  mockVerify(name, desc) {
    return { passed: true, desc };
  },

  // === 联动规则 4.9: 责任确认 → 信用评分 ===
  confirmResponsibilityNode(nodeId) {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const node = chain.nodes.find(n => n.nodeId === nodeId);
    if (!node || node.status === 'confirmed') return;

    node.status = 'confirmed';
    node.confirmedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    node.traceCode = 'a3f' + Math.random().toString(36).substring(2, 10);

    const prevScore = ent.runtime.creditScore;
    if (node.creditWeight > 0) {
      ent.runtime.creditScore += node.creditWeight;
      chain.totalScore += node.creditWeight;
    }

    // 计算完整度
    const confirmedCount = chain.nodes.filter(n => n.status === 'confirmed').length;
    chain.completeness = confirmedCount / chain.nodes.length;

    this.log('enterprise', `${node.operator}已确认"${node.name}"（节点${node.nodeId}）`, 'config');
    this.log('enterprise', `→ 信用分: ${prevScore} → ${ent.runtime.creditScore} (+${node.creditWeight})`, 'config');
    this.log('enterprise', `→ 责任链完整度: ${(chain.completeness * 100).toFixed(0)}% (${confirmedCount}/${chain.nodes.length})`, 'config');

    // 联动规则 4.10: 责任链完整度检查（统一方法，覆盖上升+下降两个方向）
    this.applyChainCompletenessLinkage(chain, ent);

    this._notify();
  },

  // === 联动规则 4.10: 责任链完整度 → 融资条件增强（统一联动方法）===
  // spec规则: ≥90%评级提升+合规报告 / ≥70%利率优惠0.3% / <50%利率上浮0.5%+管理风险预警
  applyChainCompletenessLinkage(chain, ent) {
    const prevCompleteness = chain._prevCompleteness;
    const curr = chain.completeness;
    const prevRate = ent.runtime.rateDiscount;

    // === [验证日志] 责任链完整度联动 — 数据流追踪 ===
    console.group('%c[责任链联动] applyChainCompletenessLinkage — 利率重算', 'color:#d29922;font-weight:bold');
    console.log('企业:', ent.name);
    console.log('完整度变化:', prevCompleteness === undefined ? '初始' : `${(prevCompleteness * 100).toFixed(1)}%`, '→', `${(curr * 100).toFixed(1)}%`);
    console.log('已确认节点:', `${chain.nodes.filter(n => n.status === 'confirmed').length}/${chain.nodes.length}`);
    console.log('利率调整前 rateDiscount:', prevRate);
    console.log('上次链利率调整 _lastChainRateAdj:', chain._lastChainRateAdj);

    // 档位1: ≥90% → 生成《责任合规报告》+ 信用评级提升一级
    if (curr >= 0.9 && !chain.complianceReport) {
      chain.complianceReport = { generatedAt: new Date().toLocaleString('zh-CN'), grade: 'A-', completeness: curr };
      // 信用评级提升一级（C→B→A-→A→A+，封顶A+）
      const gradeOrder = ['C', 'B', 'A-', 'A', 'A+'];
      const curIdx = gradeOrder.indexOf(ent.runtime.creditGradeCap);
      const prevGrade = ent.runtime.creditGradeCap;
      if (curIdx >= 0 && curIdx < gradeOrder.length - 1) {
        ent.runtime.creditGradeCap = gradeOrder[curIdx + 1];
      }
      console.log('%c[档位1] ≥90% → 合规报告+评级提升', 'color:#3fb950', `${prevGrade} → ${ent.runtime.creditGradeCap}`);
      this.log('enterprise', `→ 责任链完整度≥90%，生成《责任合规报告》，信用评级提升至${ent.runtime.creditGradeCap}`, 'config');
    }

    // 档位1b: ≥80% → 责任合规奖 (信用分+8, 一次性, spec规则4.9)
    if (curr >= 0.8 && !chain._complianceBonus80) {
      chain._complianceBonus80 = true;
      const prevScore = ent.runtime.creditScore;
      ent.runtime.creditScore = Math.min(850, prevScore + 8);
      console.log('%c[档位1b] ≥80% → 责任合规奖 +8', 'color:#3fb950', `${prevScore} → ${ent.runtime.creditScore}`);
      this.log('enterprise', `→ 🎖 责任链完整度≥80%，触发"责任合规奖"，信用分+8 (${prevScore}→${ent.runtime.creditScore})`, 'config');
    } else if (curr < 0.8 && chain._complianceBonus80) {
      // 完整度跌回80%以下 → 撤销奖励
      chain._complianceBonus80 = false;
      this.log('enterprise', `→ 责任链完整度跌回80%以下，"责任合规奖"已撤销`, 'alert');
    }

    // 档位2/3: 利率联动（离散调整，撤销上次+按当前档位重算，避免重复叠加）
    if (chain._lastChainRateAdj !== undefined && chain._lastChainRateAdj !== 0) {
      ent.runtime.rateDiscount -= chain._lastChainRateAdj; // 撤销上次调整
      console.log('%c[利率重算] 撤销上次调整', 'color:#8b949e', `${prevRate} → ${ent.runtime.rateDiscount} (撤销${chain._lastChainRateAdj})`);
    }
    let chainRateAdj = 0;
    let tierLabel = '无调整(50%≤完整度<70%)';
    if (curr >= 0.7) {
      chainRateAdj = -0.3;   // 档位2: 优惠0.3%
      tierLabel = '档位2: ≥70% → 优惠0.3%';
    } else if (curr < 0.5) {
      chainRateAdj = 0.5;    // 档位3: 上浮0.5%（spec规则4.10，本次补全）
      tierLabel = '档位3: <50% → 上浮0.5%';
    }
    ent.runtime.rateDiscount += chainRateAdj;
    chain._lastChainRateAdj = chainRateAdj;
    console.log('%c[利率重算] 档位判定', 'color:#58a6ff', tierLabel, '| 本次调整:', chainRateAdj, '| 重算后 rateDiscount:', ent.runtime.rateDiscount);

    if (chainRateAdj !== 0) {
      this.log('enterprise',
        `→ 责任链完整度${(curr * 100).toFixed(0)}%，利率${chainRateAdj > 0 ? '上浮' : '优惠'} ${Math.abs(chainRateAdj)}% (当前利率调整: ${ent.runtime.rateDiscount >= 0 ? '+' : ''}${ent.runtime.rateDiscount}%)`,
        chainRateAdj > 0 ? 'alert' : 'config'
      );
    }

    // 档位3附加: <50% 触发"管理风险预警"（首次进入或初始即<50%时触发）
    const willAlert = curr < 0.5 && (prevCompleteness === undefined || prevCompleteness >= 0.5);
    console.log('%c[管理风险预警判定]', 'color:#f85149', `curr<0.5: ${curr < 0.5}`, `| 首次进入或跨阈值: ${prevCompleteness === undefined || prevCompleteness >= 0.5}`, `→ 触发: ${willAlert}`);
    if (willAlert) {
      this.log('enterprise', `🚨 责任链完整度<50%，触发"管理风险预警"`, 'alert');
      this.log('enterprise', `→ 银行端已收到预警，融资利率上浮0.5%`, 'alert');
      this.logAIOperation({
        action: `管理风险预警: ${ent.name} 责任链完整度${(curr * 100).toFixed(0)}%`,
        level: 'L3', confidence: 95, enterprise: ent.name,
        reasoning: [
          `触发事件: 责任链完整度${(curr * 100).toFixed(0)}% (<50%)`,
          `规则匹配: spec规则4.10 → 管理风险预警 + 利率上浮0.5%`,
          `已确认节点: ${chain.nodes.filter(n => n.status === 'confirmed').length}/${chain.nodes.length}`,
          `利率影响: ${prevRate}% → ${ent.runtime.rateDiscount}%`,
          '处理: 通知银行端 + 上浮融资成本'
        ]
      });
    }

    chain._prevCompleteness = curr; // 记录本次完整度，供下次判断状态变化方向
    console.log('%c[责任链联动] 完成', 'color:#3fb950', { 完整度: `${(curr * 100).toFixed(0)}%`, 最终利率调整: ent.runtime.rateDiscount, 评级: ent.runtime.creditGradeCap, 合规报告: !!chain.complianceReport });
    console.groupEnd();
  },

  // === 边缘案例11: 责任链完整周期 (融资→采购→生产→销售→回款→还款 业务流推进) ===
  simulateFullBusinessCycle() {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    this.log('enterprise', `🔄 责任链完整周期模拟启动: ${ent.name}`, 'config');
    this.log('enterprise', `→ 将按 [融资→采购→生产→销售→回款→还款] 顺序推进业务流`, 'config');

    const stages = [
      { name: '融资到账', nodeStages: ['financing'], effect: () => {
        ent.financials.accountBalance += 2000000;
        this.log('enterprise', `  ①融资: 200万到账, 监管账户余额 ${this.formatAmount(ent.financials.accountBalance)}`, 'config');
      }},
      { name: '采购付款', nodeStages: ['procurement'], effect: () => {
        const cost = 800000;
        ent.financials.accountBalance -= cost;
        this.log('enterprise', `  ②采购: 原材料采购付 ${this.formatAmount(cost)}, 余额 ${this.formatAmount(ent.financials.accountBalance)}`, 'config');
      }},
      { name: '生产制造', nodeStages: ['production'], effect: () => {
        this.log('enterprise', `  ③生产: 产线开工, IoT感知持续上报 (物联流验证中)`, 'config');
        if (ent.modules.iotPerception) ent.runtime.fiveStreams.iot = true;
      }},
      { name: '销售发货', nodeStages: ['sales'], effect: () => {
        const revenue = 1200000;
        ent.financials.pendingAR += revenue;
        this.log('enterprise', `  ④销售: 发货确认, 应收款+${this.formatAmount(revenue)} (待回款)`, 'config');
      }},
      { name: '回款入账', nodeStages: ['repayment'], effect: () => {
        const received = 1000000;
        ent.financials.pendingAR -= received;
        ent.financials.accountBalance += received;
        this.log('enterprise', `  ⑤回款: 收到货款 ${this.formatAmount(received)}, 余额 ${this.formatAmount(ent.financials.accountBalance)}`, 'config');
      }},
      { name: '还款结清', nodeStages: ['repayment'], effect: () => {
        const repay = 1500000;
        ent.financials.accountBalance -= repay;
        this.log('enterprise', `  ⑥还款: 偿还融资 ${this.formatAmount(repay)}, 余额 ${this.formatAmount(ent.financials.accountBalance)}`, 'config');
        this.log('enterprise', `  ✅ 经营周期闭环完成`, 'config');
      }}
    ];

    // 按阶段推进, 确认对应stage的责任节点
    let stepIdx = 0;
    const runStep = () => {
      if (stepIdx >= stages.length) {
        // 全周期完成 → 触发4.10责任链完整度联动 (生成合规报告+评级提升)
        this.log('enterprise', `→ 全周期完成, 计算责任链完整度并触发4.10联动`, 'config');
        this.applyChainCompletenessLinkage(chain, ent);
        this.logAIOperation({
          action: `责任链完整周期: ${ent.name} 闭环完成`,
          level: 'L2', confidence: 95, enterprise: ent.name,
          reasoning: ['触发: 融资→采购→生产→销售→回款→还款 全周期推进', '结果: 责任链完整度重算', chain.completeness >= 0.9 ? '生成《责任合规报告》+评级提升' : `完整度${(chain.completeness*100).toFixed(0)}%`]
        });
        this._notify();
        return;
      }
      const stage = stages[stepIdx];
      // 确认该阶段的待确认节点
      chain.nodes.filter(n => n.status === 'pending' && stage.nodeStages.includes(n.stage))
        .forEach(n => this.confirmResponsibilityNode(n.nodeId));
      stage.effect();
      stepIdx++;
      setTimeout(runStep, 300); // 逐步推进, 每步300ms
    };
    runStep();
  },

  // === 模拟责任人超时 ===
  simulateResponsibilityTimeout(nodeId) {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const node = chain.nodes.find(n => n.nodeId === nodeId);
    if (!node || node.status === 'confirmed') return;

    node.status = 'timeout';
    const prevScore = ent.runtime.creditScore;
    ent.runtime.creditScore -= 5;

    this.log('enterprise', `⚠ 责任人${node.operator}超时未确认"${node.name}"`, 'alert');
    this.log('enterprise', `→ 系统自动升级预警至上级: ${node.approver || '管理层'}`, 'alert');
    this.log('enterprise', `→ 信用分: ${prevScore} → ${ent.runtime.creditScore} (-5)`, 'alert');

    this.logAIOperation({
      action: `责任人超时预警: ${node.operator} 未确认"${node.name}"`,
      level: 'L3',
      confidence: 95,
      enterprise: ent.name,
      reasoning: [
        `触发事件: 责任节点${node.nodeId}超时未确认`,
        `责任人: ${node.operator} (${node.role})`,
        `处理: 升级预警至${node.approver || '管理层'}`,
        `信用影响: -5分`
      ]
    });

    // 重算完整度并触发联动（下降路径：完整度可能<50% → 利率上浮0.5%）
    chain.completeness = chain.nodes.filter(n => n.status === 'confirmed').length / chain.nodes.length;
    this.applyChainCompletenessLinkage(chain, ent);

    this._notify();
  },

  // === 边缘案例: 责任链节点消极确权倒计时（内部责任人未响应场景）===
  _passiveConfirmTimers: {},
  simulateNodePassiveConfirm(nodeId) {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const node = chain.nodes.find(n => n.nodeId === nodeId);
    if (!node || node.status === 'confirmed') {
      this.log('enterprise', '该节点已确认，无需消极确权', 'alert');
      this._notify();
      return;
    }

    // === [验证日志] 责任链节点消极确权 — 触发 ===
    console.group('%c[节点消极确权] simulateNodePassiveConfirm — 触发倒计时', 'color:#58a6ff;font-weight:bold');
    console.log('企业:', ent.name, '| 节点:', nodeId, `"${node.name}"`);
    console.log('责任人:', `${node.operator} (${node.role})`, '| 当前状态:', node.status);
    console.log('确权前完整度:', `${(chain.completeness * 100).toFixed(1)}%`, '| 已确认:', `${chain.nodes.filter(n => n.status === 'confirmed').length}/${chain.nodes.length}`);
    console.log('→ 启动48小时倒计时(3秒模拟)，到期自动确权');
    console.groupEnd();

    this.log('enterprise', `⏳ 消极确权倒计时启动: 节点${nodeId} "${node.name}" (48小时)`, 'alert');
    this.log('enterprise', `→ 责任人${node.operator}未响应，系统将在倒计时结束后自动确权`, 'alert');

    // 模拟倒计时（3秒后自动确权，代表48小时）
    this._passiveConfirmTimers[nodeId] = setTimeout(() => {
      const n = chain.nodes.find(nn => nn.nodeId === nodeId);
      if (!n || n.status === 'confirmed') return;
      n.status = 'confirmed';
      n.confirmedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      n.traceCode = 'passive_' + Math.random().toString(36).substring(2, 10);
      n.passiveConfirmed = true;

      const confirmedCount = chain.nodes.filter(nn => nn.status === 'confirmed').length;
      chain.completeness = confirmedCount / chain.nodes.length;

      // === [验证日志] 责任链节点消极确权 — 生效 ===
      console.group('%c[节点消极确权] 倒计时结束 — 自动确权生效', 'color:#3fb950;font-weight:bold');
      console.log('节点:', nodeId, `"${n.name}"`, '| 责任人:', n.operator);
      console.log('溯源码:', n.traceCode, '| 消极确权标记:', n.passiveConfirmed);
      console.log('完整度变化:', `${(((confirmedCount - 1) / chain.nodes.length) * 100).toFixed(1)}% → ${(chain.completeness * 100).toFixed(1)}%`);
      console.log('→ 即将触发 applyChainCompletenessLinkage 联动利率重算');
      console.groupEnd();

      this.log('enterprise', `✅ 消极确权生效: 节点${nodeId} "${n.name}" 已自动确权`, 'alert');
      this.log('enterprise', `→ 责任链完整度: ${(chain.completeness * 100).toFixed(0)}%`, 'alert');

      this.logAIOperation({
        action: `消极确权生效: ${n.operator} 未响应"${n.name}"`,
        level: 'L2', confidence: 90, enterprise: ent.name,
        reasoning: ['触发: 48小时倒计时结束', `责任人${n.operator}未响应`, '系统自动确权', '记录消极确权标记']
      });

      // 触发责任链完整度联动（上升路径）
      this.applyChainCompletenessLinkage(chain, ent);

      this._notify();
    }, 3000);

    this._notify();
  },

  // === 边缘案例: 应收款买方消极确权（spec MOD-05 语义：买方48小时未异议视为默认确认）===
  _buyerConfirmTimers: {},
  simulateBuyerPassiveConfirm(arId) {
    const ent = this.currentEnterprise;
    // 应收款明细结构（懒初始化）
    if (!ent.financials.arDetails) ent.financials.arDetails = [];
    let ar = ent.financials.arDetails.find(a => a.arId === arId);
    if (!ar) {
      // 默认构造一笔应收款（买方不配合盖章场景）
      ar = { arId, buyer: '买方公司(待确权)', amount: 1500000, dueDate: '2026-10-15', confirmStatus: 'pending' };
      ent.financials.arDetails.push(ar);
    }
    if (ar.confirmStatus !== 'pending') {
      this.log('enterprise', '该应收款已确权，无需消极确权', 'alert');
      this._notify();
      return;
    }

    // === [验证日志] 买方消极确权 — 触发 ===
    console.group('%c[买方消极确权] simulateBuyerPassiveConfirm — 触发倒计时', 'color:#58a6ff;font-weight:bold');
    console.log('企业:', ent.name, '| 应收款ID:', arId);
    console.log('应收款详情:', { 买方: ar.buyer, 金额: ar.amount, 到期日: ar.dueDate, 当前状态: ar.confirmStatus });
    console.log('spec语义: 买方不配合盖章 → 三方数据授权发送加密确权请求 → 48h未异议视为默认确认');
    console.log('→ 启动48小时倒计时(3秒模拟)');
    console.groupEnd();

    this.log('enterprise', `⏳ 买方消极确权启动: 应收款${arId} (${this.formatAmount(ar.amount)})`, 'alert');
    this.log('enterprise', `→ 买方${ar.buyer}不配合盖章，系统通过三方数据授权协议发送加密确权请求`, 'alert');
    this.log('enterprise', `→ 买方48小时内未提出异议则视为默认确认`, 'alert');

    // 模拟倒计时（3秒后自动确权，代表48小时）
    this._buyerConfirmTimers[arId] = setTimeout(() => {
      const target = ent.financials.arDetails.find(a => a.arId === arId);
      if (!target || target.confirmStatus !== 'pending') return;
      target.confirmStatus = 'passive_confirmed';
      target.confirmedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      target.traceCode = 'buyer_passive_' + Math.random().toString(36).substring(2, 10);

      // === [验证日志] 买方消极确权 — 生效 ===
      console.group('%c[买方消极确权] 倒计时结束 — 自动确权生效', 'color:#3fb950;font-weight:bold');
      console.log('应收款ID:', arId, '| 买方:', target.buyer);
      console.log('状态变化:', 'pending → passive_confirmed');
      console.log('溯源码:', target.traceCode);
      console.log('确权时间:', target.confirmedAt);
      console.log('应收款金额:', this.formatAmount(target.amount), '→ 可纳入保理/贴现融资范围');
      console.table([{ arId, buyer: target.buyer, amount: target.amount, status: target.confirmStatus, traceCode: target.traceCode }]);
      console.groupEnd();

      this.log('enterprise', `✅ 买方消极确权生效: 应收款${arId} 已自动确权`, 'alert');
      this.log('enterprise', `→ 买方${target.buyer} 48小时未异议，视为默认确认`, 'alert');
      this.log('enterprise', `→ 该应收款可纳入保理/贴现融资范围`, 'alert');

      this.logAIOperation({
        action: `买方消极确权生效: ${target.buyer} 应收款${arId}`,
        level: 'L2', confidence: 92, enterprise: ent.name,
        reasoning: [
          '触发: 买方不配合盖章，48小时倒计时结束',
          `买方${target.buyer}未提出异议`,
          '依据: 三方数据授权协议，视为默认确认',
          `影响: 应收款${this.formatAmount(target.amount)}可纳入融资范围`
        ]
      });
      this._notify();
    }, 3000);

    this._notify();
  },

  // === 边缘案例: 责任人缺席 ===
  simulateResponsibilityAbsence(nodeId) {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const node = chain.nodes.find(n => n.nodeId === nodeId);
    if (!node || node.status === 'confirmed') return;

    node.status = 'absent';
    const prevScore = ent.runtime.creditScore;
    ent.runtime.creditScore -= 5;

    this.log('enterprise', `🚨 责任人缺席: ${node.operator} (${node.role}) 无法联系`, 'alert');
    this.log('enterprise', `→ 触发"管理风险预警"`, 'alert');
    this.log('enterprise', `→ 信用分: ${prevScore} → ${ent.runtime.creditScore} (-5)`, 'alert');
    this.log('enterprise', `→ 银行端已收到预警通知`, 'alert');

    this.logAIOperation({
      action: `责任人缺席预警: ${node.operator} 无法联系`,
      level: 'L3', confidence: 96, enterprise: ent.name,
      reasoning: [
        `触发事件: 责任节点${node.nodeId}责任人缺席`,
        `责任人: ${node.operator} (${node.role})`,
        `处理: 管理风险预警 + 通知银行端`,
        `信用影响: -5分`
      ]
    });

    // 重算完整度并触发联动（下降路径：完整度可能<50% → 利率上浮0.5%）
    chain.completeness = chain.nodes.filter(n => n.status === 'confirmed').length / chain.nodes.length;
    this.applyChainCompletenessLinkage(chain, ent);

    this._notify();
  },

  // === 模拟资金抽逃 (spec MOD-02: 三特征细分) ===
  // type: 'hollowing'(空心化) | 'repayment_cliff'(回款断崖) | 'settlement_disorder'(结算紊乱) | 'comprehensive'(综合,默认)
  simulateFundFlight(type) {
    const ent = this.currentEnterprise;
    // spec MOD-02 三种资金抽逃特征配置
    const featureConfig = {
      hollowing: {
        label: '空心化', icon: '🏭',
        desc: '监管账户只有过桥还款资金流入，但工资/税金/水电费等日常经营硬支出完全不走该账户',
        scoreDrop: 80, waterLevel: 0.35, flightAmount: 1500000,
        impact: '资金流验证异常(日常支出不走监管账户)', blockFund: true, downgradeFlow: 'fund'
      },
      repayment_cliff: {
        label: '回款断崖', icon: '📉',
        desc: '回款额突然下滑但企业开票数据和纳税数据在增长',
        scoreDrop: 70, waterLevel: 0.40, flightAmount: 0,
        impact: '回款率骤降(开票增长但回款下滑，数据矛盾)', blockFund: false, downgradeFlow: null
      },
      settlement_disorder: {
        label: '结算紊乱', icon: '🔀',
        desc: '采购付款周期突然异常变化',
        scoreDrop: 60, waterLevel: 0.45, flightAmount: 800000,
        impact: '合同流验证异常(付款周期突变)', blockFund: false, downgradeFlow: 'contract'
      },
      comprehensive: {
        label: '综合特征', icon: '🚨',
        desc: '白名单外大额转账(57维特征全面异常)',
        scoreDrop: 100, waterLevel: 0.30, flightAmount: 2000000,
        impact: '资金流冻结(白名单外转账异常)', blockFund: true, downgradeFlow: 'fund'
      }
    };
    const feat = featureConfig[type] || featureConfig.comprehensive;
    const flightAmount = feat.flightAmount;

    const prevScore = ent.runtime.creditScore;
    ent.runtime.creditScore = Math.max(300, prevScore - feat.scoreDrop);
    const prevWater = ent.runtime.waterLevel;
    ent.runtime.waterLevel = feat.waterLevel;
    const prevBalance = ent.financials.accountBalance;
    if (flightAmount > 0) {
      ent.financials.accountBalance = Math.max(0, prevBalance - flightAmount);
    }

    // 五流合一降级
    const prevGradeCap = ent.runtime.creditGradeCap;
    if (feat.blockFund) {
      ent.runtime.fundFlowBlocked = true;
      ent.runtime.fiveStreams.fund = false;
    }
    if (feat.downgradeFlow === 'contract') {
      ent.runtime.fiveStreams.contract = false;
    }
    // 降级 → 确权等级上限锁定为B
    if (prevGradeCap === 'A') {
      ent.runtime.creditGradeCap = 'B';
    }

    this.log('enterprise', `${feat.icon} 资金抽逃检测: [${feat.label}] ${ent.name}`, 'alert');
    this.log('enterprise', `→ 特征: ${feat.desc}`, 'alert');
    if (flightAmount > 0) {
      this.log('enterprise', `→ 异常转账: ${this.formatAmount(flightAmount)}（白名单外）`, 'alert');
      this.log('enterprise', `→ 监管账户余额: ${this.formatAmount(prevBalance)} → ${this.formatAmount(ent.financials.accountBalance)}`, 'alert');
    }
    this.log('enterprise', `→ 信用评分: ${prevScore} → ${ent.runtime.creditScore} (-${feat.scoreDrop})`, 'alert');
    this.log('enterprise', `→ 动态水位: ${prevWater.toFixed(2)} → ${ent.runtime.waterLevel.toFixed(2)}`, 'alert');
    this.log('enterprise', `→ 影响: ${feat.impact}`, 'alert');
    this.log('enterprise', `→ 确权等级上限: ${prevGradeCap}级 → ${ent.runtime.creditGradeCap}级`, 'alert');
    this.log('enterprise', `→ 触发红牌预警，AI已升级至L3建议+审批`, 'alert');

    // 自动触发五流合一验证，展示降级结果
    const verifyResult = this.verifyFiveStreams();
    this.log('enterprise', `→ 五流复验: ${verifyResult.passedCount}/5流通过, 确权等级=${verifyResult.grade}级 (人流责任链独立确认)`, 'alert');

    this.logAIOperation({
      action: `资金抽逃预警[${feat.label}]: ${ent.name}`,
      level: 'L3',
      confidence: 98,
      enterprise: ent.name,
      reasoning: [
        `触发事件: 检测到资金抽逃特征"${feat.label}"`,
        `特征描述: ${feat.desc}`,
        flightAmount > 0 ? `异常转账金额: ${this.formatAmount(flightAmount)}` : '无直接转账，但回款数据异常',
        `信用评分: ${prevScore} → ${ent.runtime.creditScore} (-${feat.scoreDrop})`,
        `五流影响: ${feat.impact}`,
        `确权降级: ${prevGradeCap}→${ent.runtime.creditGradeCap}`,
        `处理: 红牌预警 + L3升级 + 通知银行端${feat.blockFund ? ' + 资金流冻结' : ''}`
      ]
    });

    // 全局告警横幅(所有Tab顶部可见)
    this.addAlert('fund_flight',
      `🚨 资金抽逃 · ${feat.label}`,
      `${ent.name} 信用 ${prevScore}→${ent.runtime.creditScore}(-${feat.scoreDrop}) | 水位 ${prevWater.toFixed(2)}→${ent.runtime.waterLevel.toFixed(2)} | 确权 ${prevGradeCap}→${ent.runtime.creditGradeCap}级${feat.blockFund ? ' | 资金流已冻结' : ''}`,
      'red',
      { enterprise: ent.name, actionTab: 'cockpit' }
    );
    if (feat.blockFund) {
      this.addAlert('fund_blocked',
        '🔒 资金流冻结 · 白名单外转账异常',
        `${ent.name} 资金流已冻结,五流合一验证失败,确权等级降至${ent.runtime.creditGradeCap}级 — 调用"解冻资金流"可恢复`,
        'red',
        { enterprise: ent.name, actionTab: 'bank' }
      );
    }
    this._notify();
  },

  // === 解冻资金流 (测试用) ===
  unblockFundFlow() {
    const ent = this.currentEnterprise;
    if (!ent.runtime.fundFlowBlocked) {
      this.log('enterprise', '资金流未被冻结，无需解冻', 'info');
      this._notify();
      return;
    }
    ent.runtime.fundFlowBlocked = false;
    this.log('enterprise', '✅ 资金流已解冻，五流合一验证恢复', 'config');
    const verifyResult = this.verifyFiveStreams();
    this.log('enterprise', `→ 五流复验: ${verifyResult.passedCount}/5流通过, 确权等级=${verifyResult.grade}级 (人流责任链独立确认)`, 'config');
    // 清除资金流冻结告警(状态已恢复)
    this.clearAlerts(a => a.type === 'fund_blocked');
    this._notify();
  },

  // === 时间推进 ===
  advanceDate() {
    const d = new Date(this.systemDate);
    d.setDate(d.getDate() + 1);
    this.systemDate = d.toISOString().slice(0, 10);
    this.updateSeasonalWindow();
    this.log('system', `系统时间推进至: ${this.systemDate} (${MockData.SEASONAL_WINDOWS[this.seasonalWindow].label})`, 'policy');
    if (this.seasonalWindow !== 'normal') {
      this.log('system', `→ 季节性窗口: ${MockData.SEASONAL_WINDOWS[this.seasonalWindow].desc}`, 'policy');
    }
    this._notify();
  },

  updateSeasonalWindow() {
    const d = new Date(this.systemDate);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const lastDay = new Date(d.getFullYear(), month, 0).getDate();

    if ((month === 3 || month === 6 || month === 9) && day >= lastDay - 5) {
      this.seasonalWindow = 'quarter_end';
    } else if (month === 11 || month === 12) {
      this.seasonalWindow = 'year_end';
    } else if (month === 1 || (month === 2 && day <= 15)) {
      this.seasonalWindow = 'spring_festival';
    } else {
      this.seasonalWindow = 'normal';
    }
  },

  // === 联动规则 4.6: 政策导向 → 融资条件 ===
  applyPolicyEffect(ent) {
    const prev = { ...ent.runtime };
    if (ent.industryPolicy === 'encourage') {
      ent.runtime.rateDiscount -= 0.5;
      ent.runtime.approvalSpeed = 'fast';
      ent.runtime.maxAmountMultiplier *= 1.1;
    } else if (ent.industryPolicy === 'restrict') {
      ent.runtime.rateDiscount += 1.0;
      ent.runtime.maxAmountMultiplier *= 0.8;
    }
    if (prev.rateDiscount !== ent.runtime.rateDiscount) {
      this.log('enterprise', `→ 行业政策[${this.getPolicyLabel(ent.industryPolicy)}]: 利率调整${ent.runtime.rateDiscount > 0 ? '+' : ''}${ent.runtime.rateDiscount}%`, 'policy');
    }
  },

  // === 联动规则 4.7: 政策版本更新 → 存量企业重新评估 ===
  switchPolicyVersion(version) {
    const prevVersion = this.policyVersion;
    this.policyVersion = version;
    const policyData = MockData.POLICY_VERSIONS.find(p => p.version === version);
    if (!policyData) return;

    this.log('system', `政策版本切换: ${prevVersion} → ${version}`, 'policy');
    this.log('system', `→ 遍历${this.enterprises.length}家企业...`, 'policy');

    let affected = 0;
    this.enterprises.forEach(ent => {
      const prevPolicy = ent.industryPolicy;
      const newPolicy = policyData[ent.industry] || 'neutral';
      if (prevPolicy !== newPolicy) {
        ent.industryPolicy = newPolicy;
        affected++;
        this.log('system', `→ [${ent.name}] 行业政策: ${this.getPolicyLabel(prevPolicy)} → ${this.getPolicyLabel(newPolicy)} (变更!)`, 'policy');
        // 重新计算融资条件
        this.recalcCreditCompleteness(ent);
        this.applyPolicyEffect(ent);
      } else {
        this.log('system', `→ [${ent.name}] 行业政策: ${this.getPolicyLabel(prevPolicy)} → ${this.getPolicyLabel(newPolicy)} (无变化)`, 'policy');
      }
    });

    this.log('system', `→ 共${affected}家企业受影响，已自动重新评估`, 'policy');
    this._notify();
  },

  // === 联动规则 4.8: 担保/保险激活 (两步工作流: Tab2申请 → Tab5受理) ===
  // 第一步: 企业在Tab2发起申请, 生成申请单推送Tab5
  applyGuarantee() {
    const ent = this.currentEnterprise;
    const pushToast = (title, text, color, actionLabel, onAction) => {
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({ type: 'applyGuarantee', title, text, color: color || 'orange', duration_ms: 7000, actionLabel, onAction });
      }
    };
    const runApply = () => {
      // 真正的申请逻辑(由知情确认modal的[确认提交]按钮触发)
      ent.runtime.guaranteeStatus = 'pending';
      this.log('flow', `📝 担保申请已发起: ${ent.name} → 推送至担保公司(Tab5)受理`, 'config');
      this.log('institution', `→ 收到担保申请: ${ent.name} (待保前审查)`, 'config');
      this.logAIOperation({
        action: `担保申请发起: ${ent.name}`,
        level: 'L2', confidence: 85, enterprise: ent.name,
        reasoning: ['触发: 企业在流程模拟器发起担保申请', '路由: 推送至Tab5担保公司', '状态: pending 待保前审查']
      });
      pushToast('📝 担保申请已发起', `${ent.name} 的担保申请已推送至Tab5担保公司(待保前审查).受理激活后:利率-0.5% / 额度+10% / 信用分+15`,
        'orange', '→ 到Tab5受理激活', () => { App.switchTab('institution'); }
      );
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'aiSuggestion', title: `🧠 AI研判·担保申请受理提醒`,
          text: `${ent.name} 担保申请已进入Tab5队列.保前审查预计1小时内完成.受理激活后融资能力立即刷新.`,
          color: 'orange', duration_ms: 5000,
          actionLabel: '→ 查看Tab5待办', onAction: () => { App.switchTab('institution'); }
        });
      }
      this._notify();
    };
    const status = ent.runtime.guaranteeStatus;
    // 非 none → 只给 toast,不弹确认modal
    if (status === 'pending') {
      pushToast('⏳ 担保申请已在处理中', `${ent.name} 的担保申请当前是「待保前审查」状态,请前往Tab5由担保公司受理激活`, 'orange', '→ 到Tab5受理激活', () => { App.switchTab('institution'); });
      this._notify(); return;
    }
    if (status === 'active') {
      pushToast('✅ 担保增信已生效', `${ent.name} 已完成担保增信:利率-0.5% / 额度+10% / 信用分已 +15,无需重复申请`, 'green', null, null);
      this._notify(); return;
    }
    if (status === 'claimed') {
      pushToast('⚠️ 担保已触发代偿流程', `${ent.name} 上一担保处于追偿中状态,新担保请联系融资顾问`, 'red', null, null);
      this._notify(); return;
    }
    // none → 弹知情确认modal(轻量,不是"不可逆"警告,只说明流程/下一步)
    const bodyHTML = `
      <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">📋 即将发生的流程</div>
        <div style="padding:10px;background:rgba(37,99,235,.06);border-radius:4px;border:1px solid var(--accent-blue);margin-bottom:10px">
          担保申请将推送至 <b>Tab5 担保公司协作台</b> 进入「保前审查」队列
        </div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">✨ 受理激活后预期效果</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:10px">
          <div>📉 利率折扣</div>  <div><b>−0.5%</b></div>
          <div>💰 额度乘数</div> <div><b>+10%</b></div>
          <div>⭐ 信用评分</div> <div><b>+15</b> (上限 850)</div>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">
          下一步: 点确认后会立即跳转到 Tab5,担保公司卡片上会出现绿色脉冲按钮「✓ 受理激活」,点它完成激活
        </div>
      </div>
    `;
    if (typeof AIModal !== 'undefined') {
      AIModal.show({
        type: 'confirmApplyGuarantee',
        title: `📝 发起担保申请确认 · ${ent.name}`,
        body: bodyHTML,
        color: 'blue',
        buttons: [
          { label: '取消', class: 'btn-outline', onClick: () => {} },
          { label: '确认提交 → 去Tab5', class: 'btn-primary', onClick: () => { runApply(); setTimeout(()=>App.switchTab('institution'), 250); } }
        ]
      });
    } else {
      runApply();
    }
  },

  applyInsurance() {
    const ent = this.currentEnterprise;
    const pushToast = (title, text, color, actionLabel, onAction) => {
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({ type: 'applyInsurance', title, text, color: color || 'purple', duration_ms: 7000, actionLabel, onAction });
      }
    };
    const runApply = () => {
      ent.runtime.insuranceStatus = 'pending';
      this.log('flow', `📝 应收款保险申请已发起: ${ent.name} → 推送至保险公司(Tab5)核保`, 'config');
      this.log('institution', `→ 收到投保申请: ${ent.name} (待核保)`, 'config');
      this.logAIOperation({
        action: `保险申请发起: ${ent.name}`,
        level: 'L2', confidence: 85, enterprise: ent.name,
        reasoning: ['触发: 企业在流程模拟器发起应收款保险申请', '路由: 推送至Tab5保险公司', '状态: pending 待核保']
      });
      pushToast('📝 保险申请已发起', `${ent.name} 的应收款保险申请已推送至Tab5保险公司(待核保).核保通过后:利率-0.3% / B级可升至A级 / 信用分+10`,
        'purple', '→ 到Tab5核保激活', () => { App.switchTab('institution'); }
      );
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'aiSuggestion', title: `🧠 AI研判·保险申请受理提醒`,
          text: `${ent.name} 投保申请已进入Tab5队列.核保4项预计2小时内完成.通过后确权等级可提升至A级.`,
          color: 'purple', duration_ms: 5000,
          actionLabel: '→ 查看Tab5待办', onAction: () => { App.switchTab('institution'); }
        });
      }
      this._notify();
    };
    const status = ent.runtime.insuranceStatus;
    if (status === 'pending') {
      pushToast('⏳ 保险申请已在处理中', `${ent.name} 的应收款保险当前是「待核保」状态,请前往Tab5由保险公司受理激活`, 'purple', '→ 到Tab5核保激活', () => { App.switchTab('institution'); });
      this._notify(); return;
    }
    if (status === 'active') {
      pushToast('✅ 保险已生效', `${ent.name} 已完成应收款保险投保:利率-0.3% / 信用分已 +10,无需重复投保`, 'green', null, null);
      this._notify(); return;
    }
    if (status === 'claimed') {
      pushToast('⚠️ 保险已完成理赔', `${ent.name} 上一保单已完成理赔,新保单请联系保险顾问`, 'orange', null, null);
      this._notify(); return;
    }
    // none → 弹知情确认modal(轻量)
    const willUpgrade = ent.runtime.creditGradeCap === 'B';
    const bodyHTML = `
      <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">📋 即将发生的流程</div>
        <div style="padding:10px;background:rgba(168,85,247,.08);border-radius:4px;border:1px solid var(--accent-purple);margin-bottom:10px">
          投保申请将推送至 <b>Tab5 保险公司协作台</b> 进入「核保」队列
        </div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">✨ 核保通过后预期效果</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:10px">
          <div>📉 利率折扣</div> <div><b>−0.3%</b></div>
          <div>⭐ 信用评分</div> <div><b>+10</b> (上限 850)</div>
          <div>🪪 确权等级上限</div> <div>${willUpgrade ? '<b>B级 → A级</b> <span style="color:var(--accent-green)">(🚀 保单解锁!)</span>' : '<b>保持 '+ent.runtime.creditGradeCap+'级</b>'}</div>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">
          下一步: 点确认后会立即跳转到 Tab5,保险公司卡片上会出现绿色脉冲按钮「✓ 核保通过,签发保单」
        </div>
      </div>
    `;
    if (typeof AIModal !== 'undefined') {
      AIModal.show({
        type: 'confirmApplyInsurance',
        title: `📝 发起保险投保申请确认 · ${ent.name}`,
        body: bodyHTML,
        color: 'purple',
        buttons: [
          { label: '取消', class: 'btn-outline', onClick: () => {} },
          { label: '确认提交 → 去Tab5', class: 'btn-primary', onClick: () => { runApply(); setTimeout(()=>App.switchTab('institution'), 250); } }
        ]
      });
    } else {
      runApply();
    }
  },

  // 担保增信激活 (Tab5按钮点击入口): 支持 none → pending → active 一步走完,无需用户先跳Tab2
  // v=27: 激活操作不可逆,先弹二次确认modal(显示具体后果:利率/额度/信用分变化),用户确认后再执行
  activateGuarantee() {
    const ent = this.currentEnterprise;
    const pushToast = (title, text, color, actionLabel, onAction) => {
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({ type: 'guarantee', title, text, color: color || 'orange', duration_ms: 8000, actionLabel, onAction });
      }
    };
    const runActivate = (autoAppliedFlag) => {
      // 真正的激活逻辑(纯函数,由modal的[确认]按钮回调触发)
      const prevRate = ent.runtime.rateDiscount;
      const prevScore = ent.runtime.creditScore;
      ent.runtime.rateDiscount -= 0.5;
      ent.runtime.maxAmountMultiplier *= 1.1;
      ent.runtime.creditScore = Math.min(850, ent.runtime.creditScore + 15);
      ent.runtime.guaranteeStatus = 'active';
      this.recalcCreditCompleteness(ent);
      this.log('institution', `✅ 担保增信已激活: ${ent.name} (保前审查通过)`, 'config');
      this.log('institution', `→ 利率优惠-0.5% (${prevRate}% → ${ent.runtime.rateDiscount}%)`, 'config');
      this.log('institution', `→ 额度上浮10% (乘数${ent.runtime.maxAmountMultiplier.toFixed(1)})`, 'config');
      this.log('institution', `→ 信用评分 +15 (${prevScore} → ${ent.runtime.creditScore})`, 'config');
      if (autoAppliedFlag) this.log('institution', `→ (通过Tab5"快捷申请"完成: 自动跳过了Tab2单独申请步骤)`, 'config');
      this.log('bank', `→ ${ent.name} 担保增信生效, 融资条件改善`, 'config');
      this.logAIOperation({
        action: `担保受理激活: ${ent.name}`,
        level: 'L2', confidence: 92, enterprise: ent.name,
        reasoning: autoAppliedFlag
          ? ['触发: Tab5快捷申请+受理一步完成(跳过Tab2单独申请)', `保前审查4项全通过 → 状态 pending→active`, `效果: 利率-0.5% (${prevRate}→${ent.runtime.rateDiscount}%), 额度×1.1乘数, 信用分+15 (${prevScore}→${ent.runtime.creditScore})`, 'AI研判: 融资条件明显改善, 建议企业下一步发起融资']
          : ['触发: Tab2发起申请 → Tab5保前审查通过 → 正式受理激活', `状态 pending→active`, `效果: 利率-0.5% (${prevRate}→${ent.runtime.rateDiscount}%), 额度×1.1乘数, 信用分+15 (${prevScore}→${ent.runtime.creditScore})`, 'AI研判: 融资条件明显改善, 建议企业下一步发起融资']
      });
      pushToast('🛡 担保增信激活成功', `${ent.name}: 利率 -0.5% / 额度 +10% / 信用分 +15 (${prevScore}→${ent.runtime.creditScore})`,
        'green', '→ 到Tab1查看融资能力', () => { App.switchTab('enterprise'); }
      );
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'aiSuggestion', title: `🧠 AI研判·增信生效评估 · ${ent.name}`,
          text: `担保激活后综合融资能力提升约+28%(额度×1.1 / 利率-0.5% / 信用分+15).建议立即发起500万以内融资.`,
          color: 'green', duration_ms: 9000,
          actionLabel: '→ 到Tab2发起融资', onAction: () => { App.switchTab('flow'); }
        });
      }
      this._notify();
    };
    // 已激活 / 追偿中 → 不弹确认modal,直接toast提示
    if (ent.runtime.guaranteeStatus === 'active') {
      pushToast('🛡 担保已激活', `${ent.name} 的担保增信已在生效中，无需重复操作`, 'green', null, null);
      this._notify(); return;
    }
    if (ent.runtime.guaranteeStatus === 'claimed') {
      pushToast('🛡 追偿流程进行中', `${ent.name} 当前处于代偿追偿流程，暂不可再次申请担保。`, 'red', null, null);
      this._notify(); return;
    }
    // === 以下: none 或 pending 都需要先前置处理 + 二次确认modal ===
    // 如果是 none → 先把状态置 pending, 记个 autoApplied 标记
    let autoApplied = false;
    if (ent.runtime.guaranteeStatus === 'none') {
      ent.runtime.guaranteeStatus = 'pending';
      this.log('institution', `📝 担保申请已受理(Tab5快捷申请,跳过Tab2单独申请)`, 'config');
      autoApplied = true;
    }
    // 预计算激活后的后果(给用户在modal里一目了然)
    const nextRate = (ent.runtime.rateDiscount - 0.5).toFixed(2);
    const nextMult = (ent.runtime.maxAmountMultiplier * 1.1).toFixed(1);
    const nextScore = Math.min(850, ent.runtime.creditScore + 15);
    const bodyHTML = `
      <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">
        <div style="margin-bottom:8px;padding:8px 12px;background:rgba(234,179,8,.08);border-radius:4px;border:1px solid var(--accent-orange)">
          <b>⚠️ 此操作不可逆</b> — 担保受理激活后将立即改变企业融资能力指标,无法回退
        </div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">📊 激活后果预览</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
          <div>📉 银行利率折扣</div>  <div><b>${ent.runtime.rateDiscount}% → ${nextRate}%</b> <span style="color:var(--accent-green)">(-0.5%)</span></div>
          <div>💰 额度乘数</div>     <div><b>${ent.runtime.maxAmountMultiplier.toFixed(1)}× → ${nextMult}×</b> <span style="color:var(--accent-green)">(+10%)</span></div>
          <div>⭐ 信用评分</div>     <div><b>${ent.runtime.creditScore} → ${nextScore}</b> <span style="color:var(--accent-green)">(+15)</span></div>
          <div>🪪 受理路径</div>     <div>${autoApplied ? 'Tab5快捷入口(自动跳过Tab2)' : 'Tab2申请 → Tab5受理'}</div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">
          保前审查 4 项: 企业资质✅ / 财务评估✅ / 反担保⏳待落实 / 风险评级✅
        </div>
      </div>
    `;
    if (typeof AIModal !== 'undefined') {
      AIModal.show({
        type: 'confirmGuarantee',
        title: `🛡 担保受理激活确认 · ${ent.name}`,
        body: bodyHTML,
        color: 'orange',
        buttons: [
          { label: '取消', class: 'btn-outline', onClick: () => {} },
          { label: '✓ 确认激活(不可回退)', class: 'btn-primary', onClick: () => { runActivate(autoApplied); } }
        ]
      });
    } else {
      // 兜底: 如果 AIModal 未就绪,直接执行(极少发生)
      runActivate(autoApplied);
    }
  },

  // 应收款保险激活 (Tab5按钮点击入口): 同上支持 none→pending→active 一步走完
  // v=27: 不可逆操作 → 二次确认modal(含利率/信用分/B→A级确权升级预览)
  activateInsurance() {
    const ent = this.currentEnterprise;
    const pushToast = (title, text, color, actionLabel, onAction) => {
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({ type: 'insurance', title, text, color: color || 'purple', duration_ms: 8000, actionLabel, onAction });
      }
    };
    const runActivate = (autoAppliedFlag) => {
      // 真正的激活逻辑(纯函数,由modal确认回调触发)
      const prevRate = ent.runtime.rateDiscount;
      const prevScore = ent.runtime.creditScore;
      ent.runtime.insuranceStatus = 'active';
      ent.runtime.rateDiscount -= 0.3;
      let gradeUpMsg = '';
      if (ent.runtime.creditGradeCap === 'B') {
        ent.runtime.creditGradeCap = 'A';
        gradeUpMsg = ' / 确权 B→A级';
        this.log('institution', `→ 应收款保险生效，确权等级提升至A`, 'config');
      }
      ent.runtime.creditScore = Math.min(850, ent.runtime.creditScore + 10);
      this.recalcCreditCompleteness(ent);
      this.log('institution', `✅ 应收款保险已激活: ${ent.name} (核保通过)`, 'config');
      this.log('institution', `→ 利率优惠-0.3% (${prevRate}% → ${ent.runtime.rateDiscount}%)${gradeUpMsg}`, 'config');
      this.log('institution', `→ 信用评分 +10 (${prevScore} → ${ent.runtime.creditScore})`, 'config');
      if (autoAppliedFlag) this.log('institution', `→ (通过Tab5"快捷申请"完成: 自动跳过了Tab2单独申请步骤)`, 'config');
      this.logAIOperation({
        action: `保险核保通过: ${ent.name}`,
        level: 'L2', confidence: 90, enterprise: ent.name,
        reasoning: autoAppliedFlag
          ? ['触发: Tab5快捷投保+核保一步完成(跳过Tab2单独申请)', `核保4项全通过 → 状态 pending→active`, `效果: 利率-0.3% (${prevRate}→${ent.runtime.rateDiscount}%)${gradeUpMsg}, 信用分+10 (${prevScore}→${ent.runtime.creditScore})`, 'AI研判: 应收款坏账已被覆盖, 建议企业主动争取更高额度']
          : ['触发: Tab2发起投保 → Tab5核保通过 → 正式签发保单', `状态 pending→active`, `效果: 利率-0.3% (${prevRate}→${ent.runtime.rateDiscount}%)${gradeUpMsg}, 信用分+10 (${prevScore}→${ent.runtime.creditScore})`, 'AI研判: 应收款坏账已被覆盖, 建议企业主动争取更高额度']
      });
      pushToast('🛡 应收款保险投保成功', `${ent.name}: 利率 -0.3%${gradeUpMsg} / 信用分 +10 (${prevScore}→${ent.runtime.creditScore})`,
        'purple', '→ 到Tab1查看融资能力', () => { App.switchTab('enterprise'); }
      );
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'aiSuggestion', title: `🧠 AI研判·保单生效评估 · ${ent.name}`,
          text: `应收款保险生效后违约覆盖率提升至100%${gradeUpMsg}.建议: ①额度上浮15%谈判 ②新增上游供应商账期延长20天.`,
          color: 'purple', duration_ms: 9000,
          actionLabel: '→ 到Tab2发起融资', onAction: () => { App.switchTab('flow'); }
        });
      }
      this._notify();
    };
    // 已激活 / 理赔完成 → 不弹确认
    if (ent.runtime.insuranceStatus === 'active') {
      pushToast('🛡 保险已生效', `${ent.name} 的应收款保险已生效，无需重复投保`, 'green', null, null);
      this._notify(); return;
    }
    if (ent.runtime.insuranceStatus === 'claimed') {
      pushToast('🛡 理赔已完成', `${ent.name} 上一保单处于理赔完成状态，新投保请联系保险顾问。`, 'orange', null, null);
      this._notify(); return;
    }
    // none → pending 前置
    let autoApplied = false;
    if (ent.runtime.insuranceStatus === 'none') {
      ent.runtime.insuranceStatus = 'pending';
      this.log('institution', `📝 应收款保险申请已受理(Tab5快捷申请,跳过Tab2单独申请)`, 'config');
      autoApplied = true;
    }
    // 预计算后果(含B→A级升级可能性)
    const nextRate = (ent.runtime.rateDiscount - 0.3).toFixed(2);
    const nextScore = Math.min(850, ent.runtime.creditScore + 10);
    const willUpgrade = ent.runtime.creditGradeCap === 'B';
    const nextGrade = willUpgrade ? 'A' : ent.runtime.creditGradeCap;
    const bodyHTML = `
      <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">
        <div style="margin-bottom:8px;padding:8px 12px;background:rgba(168,85,247,.08);border-radius:4px;border:1px solid var(--accent-purple)">
          <b>⚠️ 此操作不可逆</b> — 核保通过签发保单后将立即改变企业融资能力指标,无法回退
        </div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">📊 生效后果预览</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
          <div>📉 银行利率折扣</div> <div><b>${ent.runtime.rateDiscount}% → ${nextRate}%</b> <span style="color:var(--accent-green)">(-0.3%)</span></div>
          <div>⭐ 信用评分</div>    <div><b>${ent.runtime.creditScore} → ${nextScore}</b> <span style="color:var(--accent-green)">(+10)</span></div>
          <div>🪪 确权等级上限</div> <div><b>${ent.runtime.creditGradeCap}级 → ${nextGrade}级</b> ${willUpgrade ? '<span style="color:var(--accent-green)">(🚀 应收款保单解锁A级!)</span>' : '<span style="color:var(--text-muted)">(已是A+/S级,不升级)</span>'}</div>
          <div>🪪 核保路径</div>    <div>${autoApplied ? 'Tab5快捷入口(跳过Tab2)' : 'Tab2投保 → Tab5核保'}</div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">
          核保 4 项: 应收款真实贸易✅ / 买方信用评分✅ / 投保费率✅ / 保期匹配✅
        </div>
      </div>
    `;
    if (typeof AIModal !== 'undefined') {
      AIModal.show({
        type: 'confirmInsurance',
        title: `🛡 核保通过·签发保单确认 · ${ent.name}`,
        body: bodyHTML,
        color: 'purple',
        buttons: [
          { label: '取消', class: 'btn-outline', onClick: () => {} },
          { label: '✓ 确认签发(不可回退)', class: 'btn-primary', onClick: () => { runActivate(autoApplied); } }
        ]
      });
    } else {
      runActivate(autoApplied);
    }
  },

  // === 企业自定义阶段二: 票据管理 (新增/删除) ===
  addBill() {
    const ent = this.currentEnterprise;
    const idx = ent.financials.billsHeld.length + 1;
    const billId = 'B' + String(Date.now()).slice(-5) + idx;
    const types = ['bank_acceptance', 'commercial_acceptance'];
    const newBill = {
      billId,
      amount: 1000000 + Math.floor(Math.random() * 4000000),
      dueDate: '2026-' + String(9 + (idx % 4)).padStart(2, '0') + '-15',
      type: types[idx % 2],
      insured: false
    };
    ent.financials.billsHeld.push(newBill);
    this.log('enterprise', `➕ 新增票据: ${billId} (${this.formatAmount(newBill.amount)}, ${newBill.type === 'bank_acceptance' ? '银行承兑' : '商业承兑'})`, 'config');
    this.log('enterprise', `→ 持有票据数: ${ent.financials.billsHeld.length}张`, 'config');
    this._notify();
  },

  removeBill(billId) {
    const ent = this.currentEnterprise;
    const idx = ent.financials.billsHeld.findIndex(b => b.billId === billId);
    if (idx < 0) { this._notify(); return; }
    const removed = ent.financials.billsHeld.splice(idx, 1)[0];
    this.log('enterprise', `🗑 删除票据: ${billId} (${this.formatAmount(removed.amount)})`, 'config');
    this.log('enterprise', `→ 剩余持有票据: ${ent.financials.billsHeld.length}张`, 'config');
    this._notify();
  },

  // === 审批操作 ===
  approveRequest(queueId, approved, reason) {
    const req = this.approvalQueue.find(q => q.id === queueId);
    if (!req) return;

    req.status = approved ? 'approved' : 'rejected';
    const ent = this.enterprises.find(e => e.id === req.enterpriseId);

    // ===== spec 联动 5.5: 改造合规审查工单 (reform_legal) → 调用专属回调 =====
    if (req.type === 'reform_legal' && req.reform) {
      if (approved && typeof req.reform.onApprove === 'function') {
        req.reform.onApprove();
      } else if (!approved && typeof req.reform.onReject === 'function') {
        req.reform.onReject(reason || '不符合合规要求');
      }
      this._notify();
      return;
    }

    if (!ent) return;

    if (approved) {
      this.log('approval', `人工审批通过: ${req.enterpriseName} 融资${this.formatAmount(req.amount)}`, 'financing');
      this.simulateBankBids(req.amount);
      ent.financials.accountBalance += req.amount;
      ent.runtime.waterLevel = Math.min(0.95, ent.runtime.waterLevel + req.amount / 10000000);
      this.log('approval', `→ 资金${this.formatAmount(req.amount)}已到账`, 'financing');
      this.log('approval', `→ 监管账户余额: ${this.formatAmount(ent.financials.accountBalance)}`, 'financing');
      this.log('approval', `→ 动态水位: ${ent.runtime.waterLevel.toFixed(2)}`, 'financing');

      this.logAIOperation({
        action: `融资${this.formatAmount(req.amount)}人工审批通过`,
        level: 'L3', confidence: 85, enterprise: ent.name,
        reasoning: ['触发: 人工审批通过', `金额: ${this.formatAmount(req.amount)}`, `风险评分: ${req.riskScore}`, '结果: 资金已到账']
      });

      // === 审批通过后完整联动链 (银行放款→五流更新→断裂检测→银行风险→信用分) ===
      this._postApprovalLinkage(ent, req);
    } else {
      this.log('approval', `人工审批否决: ${req.enterpriseName} 融资${this.formatAmount(req.amount)}`, 'financing');
      this.log('approval', `→ 融资流程终止`, 'financing');
      // 否决后联动: 企业资金链压力检测
      this._postRejectionLinkage(ent, req);
    }
    this._notify();
  },

  // === 审批通过后联动链: 银行放款 → 五流 → 断裂检测 → 银行风险 → 信用分 ===
  _postApprovalLinkage(ent, req) {
    // 1. 银行放款条目
    const bestBid = this.bankBids && this.bankBids[0];
    const bankName = bestBid ? bestBid.bankName : '监管账户';
    this.log('bank', `🏦 银行放款: ${bankName} → ${ent.name} 划转 ${this.formatAmount(req.amount)}`, 'financing');
    this.log('bank', `→ 放款完成, 进入贷后监管周期 (T+30/60/90)`, 'financing');

    // 2. 五流合一更新: 资金流激活
    if (!ent.runtime.fiveStreams.fund) {
      ent.runtime.fiveStreams.fund = true;
      this.log('enterprise', `🔄 五流合一更新: 资金流✓ (监管账户入账 ${this.formatAmount(req.amount)})`, 'config');
      const openCount = this.countOpenFlows(ent);
      this.log('enterprise', `→ 当前五流通过: ${openCount}/6 ${openCount >= 5 ? '(五流合一达标)' : '(未达标)'}`, 'config');
    }

    // 3. 企业断裂检测 (责任链/资金链/回款断崖)
    const breaks = this._detectEnterpriseBreaks(ent);
    if (breaks.length > 0) {
      this.log('enterprise', `⚠ 企业断裂检测: ${ent.name} 触发 ${breaks.length} 项风险`, 'alert');
      breaks.forEach(b => {
        this.log('enterprise', `→ ⚡${b.type}: ${b.detail}`, 'alert');
      });

      // 4. 银行端断裂联动: 风险暴露 + 信用分下调
      this._bankBreakLinkage(ent, breaks);

      // 5. 信用分动态下调
      const totalPenalty = breaks.reduce((s, b) => s + b.penalty, 0);
      const prevScore = ent.runtime.creditScore;
      ent.runtime.creditScore = Math.max(300, prevScore + totalPenalty);
      this.log('enterprise', `→ 信用分动态更新: ${prevScore} → ${ent.runtime.creditScore} (${totalPenalty > 0 ? '' : '+'}${totalPenalty})`, 'alert');

      // 6. 自动弹出银行风控决策弹窗 (建议冻结)
      this._enqueueBankRiskModal(ent, breaks);
    } else {
      // 无断裂: 信用分小幅提升
      const prevScore = ent.runtime.creditScore;
      ent.runtime.creditScore = Math.min(850, prevScore + 5);
      this.log('enterprise', `→ 信用分动态更新: ${prevScore} → ${ent.runtime.creditScore} (+5 融资到位信用提升)`, 'config');
      this.log('bank', `→ 贷后状态: 正常 (无断裂风险)`, 'config');
    }

    // 7. 责任链断裂检测 (独立检查)
    const chain = ent.runtime.responsibilityChain;
    const confirmed = chain.nodes.filter(n => n.status === 'confirmed').length;
    if (chain.completeness < 0.5) {
      this.log('enterprise', `⚠ 责任链断裂风险: ${confirmed}/${chain.nodes.length}节点已确认 (${(chain.completeness * 100).toFixed(0)}%)`, 'alert');
      this.log('enterprise', `→ 建议: 督促责任人完成关键节点确认, 否则影响后续融资`, 'alert');
    }
  },

  // 企业断裂检测: 责任链/资金链/回款断崖/空心化
  _detectEnterpriseBreaks(ent) {
    const breaks = [];
    // 资金链断裂: 水位仍低于0.3 (融资后仍未缓解)
    if (ent.runtime.waterLevel < 0.3) {
      breaks.push({ type: '资金链断裂', detail: `融资后水位仍低 ${(ent.runtime.waterLevel * 100).toFixed(0)}%<30%, 资金链脆弱`, penalty: -30 });
    }
    // 回款断崖: 应收款远大于账户余额 (回款无法覆盖)
    if (ent.financials.pendingAR > ent.financials.accountBalance * 2 && ent.financials.pendingAR > 5000000) {
      breaks.push({ type: '回款断崖', detail: `应收款${this.formatAmount(ent.financials.pendingAR)} >> 余额${this.formatAmount(ent.financials.accountBalance)}, 回款断崖风险`, penalty: -25 });
    }
    // 空心化: 月支出远大于月营收 (入不敷出)
    if (ent.financials.monthlyExpense > ent.financials.monthlyRevenue * 1.3) {
      breaks.push({ type: '经营空心化', detail: `月支出${this.formatAmount(ent.financials.monthlyExpense)} > 月营收${this.formatAmount(ent.financials.monthlyRevenue)}×1.3, 空心化`, penalty: -40 });
    }
    // 五流缺失: 超过2条流未通过
    const openCount = this.countOpenFlows(ent);
    if (openCount < 4) {
      breaks.push({ type: '五流断裂', detail: `仅${openCount}/6流通过, 五流合一严重缺失`, penalty: -20 });
    }
    // 资金流冻结
    if (ent.runtime.fundFlowBlocked) {
      breaks.push({ type: '资金流冻结', detail: `监管账户已被冻结, 资金流阻断`, penalty: -15 });
    }
    return breaks;
  },

  // 银行端断裂联动: 风险暴露条目 + 信用分下调建议
  _bankBreakLinkage(ent, breaks) {
    this.log('bank', `🏦 银行风险暴露: ${ent.name} 触发${breaks.length}项断裂, 银行端风险升级`, 'alert');
    const breakTypes = breaks.map(b => b.type).join('/');
    this.log('bank', `→ 断裂类型: ${breakTypes}`, 'alert');
    this.log('bank', `→ 建议动作: 冻结监管账户 / 发送风险提示函 / 下调授信`, 'alert');
    this.log('bank', `→ 银行风险敞口: ${this.formatAmount(ent.financials.accountBalance)} (需覆盖)`, 'alert');
    this.logAIOperation({
      action: `银行风险暴露: ${ent.name} 断裂(${breakTypes})`,
      level: 'L3', confidence: 88, enterprise: ent.name,
      reasoning: ['触发: 审批通过后断裂检测', `断裂项: ${breakTypes}`, '银行端: 风险敞口升级', '建议: 冻结账户+风险函+下调授信']
    });
  },

  // 审批否决后联动: 企业资金链压力
  _postRejectionLinkage(ent, req) {
    this.log('enterprise', `⚠ 融资被否决: ${ent.name} 资金链压力上升`, 'alert');
    const prevScore = ent.runtime.creditScore;
    ent.runtime.creditScore = Math.max(300, prevScore - 10);
    this.log('enterprise', `→ 信用分动态更新: ${prevScore} → ${ent.runtime.creditScore} (-10 融资否决)`, 'alert');
    // 水位下降 (资金未到账, 支出继续)
    ent.runtime.waterLevel = Math.max(0.05, ent.runtime.waterLevel - 0.05);
    this.log('enterprise', `→ 动态水位下降: ${ent.runtime.waterLevel.toFixed(2)} (资金未到账)`, 'alert');
    if (ent.runtime.waterLevel < 0.2) {
      this.log('enterprise', `⚠ 资金链濒临断裂: 水位<20%, 建议紧急寻求关联机构担保`, 'alert');
      this.log('bank', `🏦 银行预警: ${ent.name} 资金链濒临断裂, 关注违约风险`, 'alert');
    }
    this.logAIOperation({
      action: `融资否决后企业压力: ${ent.name}`,
      level: 'L2', confidence: 90, enterprise: ent.name,
      reasoning: ['触发: 融资被否决', '影响: 信用分-10, 水位-0.05', ent.runtime.waterLevel < 0.2 ? '告警: 资金链濒临断裂' : '状态: 压力上升但可控']
    });
  },

  // 自动弹出银行风控决策弹窗 (企业断裂后)
  _enqueueBankRiskModal(ent, breaks) {
    if (typeof AIModal === 'undefined') return;
    const breakList = breaks.map(b => `${b.type}(${b.detail})`).join('；');
    AIModal.enqueue({
      type: 'bankAction',
      title: `银行风控告警 · ${ent.name} 断裂`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      aiSuggestion: `审批通过后检测到${breaks.length}项断裂风险(${breakList})。AI建议立即冻结监管账户并下发风险提示函，防止风险扩大。`,
      aiConfidence: 92,
      contextHTML: `
        <div style="font-size:12px;line-height:1.8;color:var(--text-secondary)">
          <div>⚠ <strong>断裂项:</strong> ${breaks.map(b => b.type).join(' / ')}</div>
          <div>💰 <strong>账户余额:</strong> ${this.formatAmount(ent.financials.accountBalance)}</div>
          <div>📊 <strong>当前水位:</strong> ${(ent.runtime.waterLevel * 100).toFixed(0)}%</div>
          <div>⭐ <strong>信用分:</strong> ${ent.runtime.creditScore}</div>
          <div>🏦 <strong>风险敞口:</strong> ${this.formatAmount(ent.financials.accountBalance)}</div>
        </div>
      `,
      confirmLabel: '🔒 立即冻结+发风险函',
      replyLabel: '↩ 附言观察',
      dissentLabel: '✗ 暂不处理',
      onConfirm: () => {
        if (!ent.runtime.fundFlowBlocked) this.bankToggleAccountFreeze();
        this.bankIssueRiskNotice();
        this.log('bank', `→ 银行已执行风控: 冻结+风险函`, 'alert');
        this._notify();
      },
      onReply: (note) => { this.log('bank', `银行附言: ${note || '观察中'}`, 'config'); this._notify(); },
      onDissent: (reason) => { this.log('bank', `银行暂不处理: ${reason || '人工判断风险可控'}`, 'config'); this._notify(); },
      onDismiss: () => {}
    });
  },

  // === 退回补充材料 (审批台 L3/L4) ===
  rejectWithSupplement(queueId, note) {
    const req = this.approvalQueue.find(q => q.id === queueId);
    if (!req) return;
    // 退回后工单仍保持 pending 状态, 等待补充材料后重新处理
    req.status = 'pending';
    req.supplementNote = note || '请补充经营数据与回款凭证';
    req.needsSupplement = true;
    const ent = this.enterprises.find(e => e.id === req.enterpriseId);
    this.log('approval', `退回补充材料: ${req.enterpriseName} 融资${this.formatAmount(req.amount)}`, 'financing');
    this.log('approval', `→ 退回原因: ${req.supplementNote}`, 'financing');
    this.logAIOperation({
      action: `审批退回补充材料: ${req.enterpriseName}`,
      level: 'L3', confidence: 88, enterprise: ent ? ent.name : '',
      reasoning: ['触发: 人工审批退回', `金额: ${this.formatAmount(req.amount)}`, `退回原因: ${req.supplementNote}`]
    });
    this._notify();
  },

  // === 获取审批工单的决策上下文 (供审批台展示) ===
  getApprovalContext(req) {
    const ent = this.enterprises.find(e => e.id === req.enterpriseId);
    if (!ent) return null;
    const chain = ent.runtime.responsibilityChain;
    const confirmed = chain.nodes.filter(n => n.status === 'confirmed').length;
    const openFlows = this.countOpenFlows(ent);
    const routeReason = req.routeLevel === 'L4'
      ? '金额≥500万且企业风险等级较高 → 必须人工全审'
      : req.routeLevel === 'L3'
        ? (req.amount >= 5000000 ? '金额≥500万 → L3建议+人工审批' : '企业自主度上限≤L2 → L3建议+人工审批')
        : 'AI路由判定需人工介入';
    return {
      enterprise: ent,
      waterLevel: ent.runtime.waterLevel,
      accountBalance: ent.financials.accountBalance,
      pendingAR: ent.financials.pendingAR,
      monthlyRevenue: ent.financials.monthlyRevenue,
      monthlyExpense: ent.financials.monthlyExpense,
      chainConfirmed: confirmed,
      chainTotal: chain.nodes.length,
      chainCompleteness: chain.completeness,
      openFlows,
      fiveStreams: ent.runtime.fiveStreams,
      industryPolicy: ent.industryPolicy,
      policyLabel: this.getPolicyLabel(ent.industryPolicy),
      riskProfile: ent.riskProfile,
      riskLabel: ent.riskLabel,
      routeReason,
      fundFlowBlocked: ent.runtime.fundFlowBlocked,
      guaranteeStatus: ent.runtime.guaranteeStatus,
      aiSuggestion: req.aiSuggestion,
      aiConfidence: req.aiConfidence
    };
  },

  // === 构建审批决策弹窗的上下文HTML ===
  _buildApprovalContextHTML(req) {
    const ctx = this.getApprovalContext(req);
    if (!ctx) return '<div style="color:var(--text-muted)">无法获取企业上下文</div>';
    const flowLabels = { fund: '资金', contract: '合同', invoice: '发票', iot: '物联', logistics: '物流', people: '人流' };
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
        <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:10px;color:var(--text-muted)">融资金额</div>
          <div style="font-size:13px;font-weight:700">${this.formatAmount(req.amount)}</div>
        </div>
        <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:10px;color:var(--text-muted)">风险评分</div>
          <div style="font-size:13px;font-weight:700;color:${req.riskScore > 700 ? 'var(--accent-green)' : req.riskScore > 600 ? 'var(--accent-orange)' : 'var(--accent-red)'}">${req.riskScore}</div>
        </div>
        <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:10px;color:var(--text-muted)">确权等级</div>
          <div style="font-size:13px;font-weight:700">${req.creditGrade}级</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:10px;color:var(--text-muted)">资金水位</div>
          <div style="font-size:12px;font-weight:600">${(ctx.waterLevel * 100).toFixed(0)}%</div>
        </div>
        <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:10px;color:var(--text-muted)">责任链</div>
          <div style="font-size:12px;font-weight:600">${ctx.chainConfirmed}/${ctx.chainTotal} (${(ctx.chainCompleteness * 100).toFixed(0)}%)</div>
        </div>
      </div>
      <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:8px">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">五流合一 (${ctx.openFlows}/6)</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${Object.entries(ctx.fiveStreams).map(([k, v]) => `<span style="font-size:10px;padding:1px 6px;border-radius:3px;${v ? 'background:rgba(63,185,80,0.15);color:var(--accent-green)' : 'background:rgba(248,81,73,0.15);color:var(--accent-red)'}">${flowLabels[k] || k}${v ? '✓' : '✗'}</span>`).join('')}
        </div>
      </div>
      <div style="padding:6px 8px;background:rgba(210,153,34,0.08);border-radius:6px;font-size:11px;color:var(--text-secondary)">
        <strong style="color:var(--accent-orange)">📌 路由原因:</strong> ${ctx.routeReason} | <strong>政策:</strong> ${ctx.policyLabel}
      </div>
    `;
  },

  // === 入队审批决策弹窗 ===
  _enqueueApprovalModal(reqId) {
    const req = this.approvalQueue.find(q => q.id === reqId);
    if (!req || req.status !== 'pending') return;
    if (typeof AIModal === 'undefined') return;
    AIModal.enqueue({
      type: 'approval',
      title: `融资审批 · ${req.enterpriseName}`,
      timestamp: req.timestamp,
      aiSuggestion: `${req.aiSuggestion}（金额 ${this.formatAmount(req.amount)}，路由 ${req.routeLevel}）`,
      aiConfidence: req.aiConfidence,
      contextHTML: this._buildApprovalContextHTML(req),
      confirmLabel: '✓ 同意融资',
      replyLabel: '↩ 退回补充材料',
      dissentLabel: '✗ 否决融资',
      onConfirm: () => { this.approveRequest(reqId, true); },
      onReply: (note) => { this.rejectWithSupplement(reqId, note || '请补充经营数据与回款凭证'); },
      onDissent: (reason) => {
        this.approveRequest(reqId, false);
        if (reason) this.log('approval', `→ 否决理由: ${reason}`, 'financing');
      },
      onDismiss: () => { this.log('system', `审批弹窗已跳过: ${req.enterpriseName} (可在Tab3处理)`, 'info'); }
    });
  },

  // === 边缘案例: IoT断线 ===
  simulateIoTDisconnect() {
    const ent = this.currentEnterprise;
    if (!ent.modules.iotPerception) {
      this.log('flow', 'IoT模块未启用，无需模拟断线', 'alert');
      // toast提示用户当前企业未装IoT,切到智芯科技或先启用模块
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'info',
          title: '📡 当前企业未启用 IoT 模块',
          text: `${ent.name} 未启用 IoT,无法模拟断线。请切换到「智芯科技」(已启用IoT)或先在Tab1启用 IoT 模块`,
          color: 'orange',
          duration_ms: 7000,
          actionLabel: '切换到智芯科技',
          onAction: () => { this.switchEnterprise('E002'); }
        });
      }
      this._notify();
      return;
    }
    ent.modules.iotPerception = false;
    ent.runtime.fiveStreams.iot = false;
    const prevGrade = ent.runtime.creditGradeCap;
    if (prevGrade === 'A') ent.runtime.creditGradeCap = 'B';

    this.log('flow', '⚠ IoT设备断线', 'alert');
    this.log('flow', '→ 物联流验证降级: ❌', 'alert');
    this.log('flow', `→ 五流合一降级为四流合一`, 'alert');
    this.log('flow', `→ 确权等级上限: ${prevGrade}级 → ${ent.runtime.creditGradeCap}级`, 'alert');

    this.logAIOperation({
      action: `IoT断线预警: ${ent.name} 物联流验证降级`,
      level: 'L2', confidence: 92, enterprise: ent.name,
      reasoning: ['触发: IoT设备离线', '影响: 五流降级四流', '确权等级上限降为B']
    });

    // 全局告警横幅(所有Tab顶部可见)
    this.addAlert('iot_disconnect',
      '📡 IoT设备断线 · 物联流降级',
      `${ent.name} IoT设备离线 → 五流降级四流 → 确权上限 ${prevGrade}→${ent.runtime.creditGradeCap}级 → 影响融资利率与额度`,
      'orange',
      { enterprise: ent.name, actionTab: 'flow' }
    );
    this._notify();
  },

  // === 边缘案例: 票据再贴现 ===
  simulateBillRediscount(billId) {
    const ent = this.currentEnterprise;
    const bill = ent.financials.billsHeld.find(b => b.billId === billId);
    if (!bill) return;

    this.log('flow', `票据再贴现: ${bill.billId} (金额${this.formatAmount(bill.amount)})`, 'financing');
    this.log('flow', `→ 验真确权: 票据信息已核实`, 'financing');
    this.log('flow', `→ AI撮合贴现: 匹配3家银行`, 'financing');
    this.log('flow', `→ 贴现利率: ${bill.insured ? 'LPR+0.5%(已投保优惠)' : 'LPR+1.0%'}`, 'financing');

    const discountAmount = bill.amount * 0.95; // 贴现率95%
    ent.financials.accountBalance += discountAmount;
    ent.financials.billsHeld = ent.financials.billsHeld.filter(b => b.billId !== billId);

    this.log('flow', `→ 贴现资金${this.formatAmount(discountAmount)}已到账`, 'financing');
    this.log('flow', `→ 监管账户余额: ${this.formatAmount(ent.financials.accountBalance)}`, 'financing');

    if (bill.insured) {
      this.log('flow', `→ 票据已投保，自动触发保险增信流程`, 'financing');
    }

    this.logAIOperation({
      action: `票据再贴现: ${bill.billId} ${this.formatAmount(bill.amount)}`,
      level: 'L2', confidence: 88, enterprise: ent.name,
      reasoning: ['触发: 票据再贴现请求', `验真确权通过`, `AI撮合贴现完成`, `贴现资金${this.formatAmount(discountAmount)}到账`]
    });
    this._notify();
  },

  // === 边缘案例: 担保代偿 ===
  simulateGuaranteeCompensation() {
    const ent = this.currentEnterprise;
    if (ent.runtime.guaranteeStatus !== 'active') {
      this.log('institution', '该企业未激活担保增信，无法模拟代偿', 'alert');
      this._notify();
      return;
    }
    const compAmount = 1000000;
    ent.financials.accountBalance += compAmount;
    ent.runtime.guaranteeStatus = 'claimed';

    this.log('institution', `⚠ 担保代偿触发: ${ent.name}`, 'alert');
    this.log('institution', `→ AI准备代偿材料并通知担保公司`, 'alert');
    this.log('institution', `→ 代偿金额${this.formatAmount(compAmount)}已到账`, 'alert');
    this.log('institution', `→ 追偿流程启动`, 'alert');

    this.logAIOperation({
      action: `担保代偿: ${ent.name} 代偿${this.formatAmount(compAmount)}`,
      level: 'L3', confidence: 95, enterprise: ent.name,
      reasoning: ['触发: 企业违约', 'AI准备代偿材料', '担保公司代偿执行', '追偿流程启动']
    });
    this._notify();
  },

  // === 边缘案例: 保险理赔 ===
  simulateInsuranceClaim() {
    const ent = this.currentEnterprise;
    if (ent.runtime.insuranceStatus !== 'active') {
      this.log('institution', '该企业未激活保险，无法模拟理赔', 'alert');
      this._notify();
      return;
    }
    const claimAmount = 800000;
    ent.financials.accountBalance += claimAmount;
    ent.runtime.insuranceStatus = 'claimed';

    this.log('institution', `⚠ 保险理赔触发: ${ent.name}`, 'alert');
    this.log('institution', `→ 买方逾期，AI准备理赔材料`, 'alert');
    this.log('institution', `→ 推送保险公司审核`, 'alert');
    this.log('institution', `→ 理赔金额${this.formatAmount(claimAmount)}已到账`, 'alert');

    this.logAIOperation({
      action: `保险理赔: ${ent.name} 理赔${this.formatAmount(claimAmount)}`,
      level: 'L3', confidence: 93, enterprise: ent.name,
      reasoning: ['触发: 买方逾期', 'AI准备理赔材料', '保险公司审核通过', `理赔${this.formatAmount(claimAmount)}到账`]
    });
    this._notify();
  },

  // === 边缘案例: 白名单外转账拦截 (联动审批台+银行端+AI记录) ===
  simulateWhitelistBlock() {
    const ent = this.currentEnterprise;
    const amount = 500000;
    this.log('enterprise', `⚠ 白名单外转账拦截: ${ent.name} 向非白名单账户转出 ${this.formatAmount(amount)}`, 'alert');
    this.log('enterprise', `→ 资金监管系统(MOD-01)已拦截该笔交易`, 'alert');

    // 1. 推送审批台工单 (真正创建,非仅日志声明)
    const req = {
      id: 'AQ_WL_' + Date.now(),
      enterpriseId: ent.id,
      enterpriseName: ent.name,
      amount,
      routeLevel: 'L4',
      riskScore: ent.runtime.creditScore,
      creditGrade: ent.runtime.creditGradeCap,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      status: 'pending',
      aiSuggestion: '建议否决: 白名单外大额转账, 违反资金监管契约',
      aiConfidence: 94
    };
    this.approvalQueue.push(req);
    this.log('approval', `→ 已创建审批工单 ${req.id} (白名单外转账)`, 'alert');

    // 2. 通知银行端 (MOD-01 预警)
    this.log('bank', `🏦 银行端收到预警: ${ent.name} 白名单外转账拦截 (${this.formatAmount(amount)})`, 'alert');
    this.log('bank', `→ 建议动作: 冻结监管账户 + 下发风险提示函`, 'alert');

    // 3. AI操作记录 (CORE-01)
    this.logAIOperation({
      action: `白名单外转账拦截: ${ent.name} ${this.formatAmount(amount)}`,
      level: 'L3', confidence: 94, enterprise: ent.name,
      reasoning: ['触发: 监管账户向白名单外账户大额转账', '规则: MOD-01 白名单契约 → 拦截', '处理: 推送审批台 + 通知银行端 + 生成预警']
    });

    // 4. 自动弹出审批决策弹窗
    this._enqueueApprovalModal(req.id);
    this._notify();
  },

  // === 组合测试场景: 资金抽逃 + 季末冲量 ===
  runComboTestScene() {
    console.group('%c[组合测试场景] 资金抽逃 + 季末冲量 — 启动', 'color:#f85149;font-weight:bold;font-size:14px');

    // ① 切换到高风险企业 E003
    console.log('%c[步骤1] 切换到高风险企业 E003 (鑫达贸易)', 'color:#58a6ff');
    this.switchEnterprise('E003');
    const ent = this.currentEnterprise;

    const snapshotBefore = {
      enterprise: ent.name,
      creditScore: ent.runtime.creditScore,
      accountBalance: ent.financials.accountBalance,
      waterLevel: ent.runtime.waterLevel,
      creditGradeCap: ent.runtime.creditGradeCap,
      fundFlowBlocked: ent.runtime.fundFlowBlocked || false,
      seasonalWindow: this.seasonalWindow,
      systemDate: this.systemDate
    };
    console.log('场景前状态快照:', snapshotBefore);

    // ② 推进系统日期至季末 (9月28日)
    console.log('%c[步骤2] 推进系统日期至 2026-09-28 (季末冲量窗口)', 'color:#d29922');
    this.systemDate = '2026-09-28';
    this.updateSeasonalWindow();
    this.log('system', `📅 组合测试: 系统日期推进至 ${this.systemDate}`, 'policy');
    this.log('system', `→ 季节性窗口: ${MockData.SEASONAL_WINDOWS[this.seasonalWindow].label}`, 'policy');
    this.log('system', `→ ${MockData.SEASONAL_WINDOWS[this.seasonalWindow].desc}`, 'policy');
    console.log('季节性窗口判定:', this.seasonalWindow, MockData.SEASONAL_WINDOWS[this.seasonalWindow]);

    // ③ 触发资金抽逃
    console.log('%c[步骤3] 触发资金抽逃 (白名单外异常转账200万)', 'color:#f85149');
    this.simulateFundFlight();

    const snapshotAfter = {
      enterprise: ent.name,
      creditScore: ent.runtime.creditScore,
      accountBalance: ent.financials.accountBalance,
      waterLevel: ent.runtime.waterLevel,
      creditGradeCap: ent.runtime.creditGradeCap,
      fundFlowBlocked: ent.runtime.fundFlowBlocked,
      seasonalWindow: this.seasonalWindow,
      systemDate: this.systemDate
    };
    console.log('场景后状态快照:', snapshotAfter);

    // ④ 对比验证
    console.group('%c[验证] 场景前后对比', 'color:#3fb950;font-weight:bold');
    console.table([
      { 指标: '信用评分', 场景前: snapshotBefore.creditScore, 场景后: snapshotAfter.creditScore, 变化: snapshotAfter.creditScore - snapshotBefore.creditScore },
      { 指标: '账户余额', 场景前: snapshotBefore.accountBalance, 场景后: snapshotAfter.accountBalance, 变化: snapshotAfter.accountBalance - snapshotBefore.accountBalance },
      { 指标: '动态水位', 场景前: snapshotBefore.waterLevel, 场景后: snapshotAfter.waterLevel, 变化: (snapshotAfter.waterLevel - snapshotBefore.waterLevel).toFixed(2) },
      { 指标: '确权等级', 场景前: snapshotBefore.creditGradeCap, 场景后: snapshotAfter.creditGradeCap, 变化: snapshotAfter.creditGradeCap !== snapshotBefore.creditGradeCap ? '降级' : '不变' },
      { 指标: '资金流冻结', 场景前: snapshotBefore.fundFlowBlocked, 场景后: snapshotAfter.fundFlowBlocked, 变化: snapshotAfter.fundFlowBlocked ? '已冻结' : '正常' },
      { 指标: '季节性窗口', 场景前: snapshotBefore.seasonalWindow, 场景后: snapshotAfter.seasonalWindow, 变化: snapshotAfter.seasonalWindow },
      { 指标: '系统日期', 场景前: snapshotBefore.systemDate, 场景后: snapshotAfter.systemDate, 变化: '推进至季末' }
    ]);

    // ⑤ 验证AI操作记录
    const fundFlightOps = this.aiOperations.filter(o => o.action.includes('资金抽逃'));
    console.log('%c[验证] AI操作记录', 'color:#58a6ff');
    console.log('资金抽逃相关AI操作数:', fundFlightOps.length);
    fundFlightOps.forEach((op, i) => {
      console.log(`  操作${i + 1}: ${op.action} | ${op.level} | 置信度${op.confidence}%`);
      op.reasoning.forEach((s, j) => console.log(`    ${j + 1}. ${s}`));
    });

    // ⑥ 验证联动日志
    const alertLogs = this.linkageLog.filter(l => l.type === 'alert' && l.message.includes('抽逃') || l.message.includes('异常转账'));
    console.log('%c[验证] 联动日志', 'color:#d29922');
    console.log('资金抽逃相关告警日志数:', alertLogs.length);
    alertLogs.forEach(l => console.log(`  [${l.timestamp}] ${l.message}`));

    // ⑦ 验证五流降级
    const verifyResult = this.verifyFiveStreams();
    console.log('%c[验证] 五流合一验证结果', 'color:#f85149');
    console.log('通过流数:', verifyResult.passedCount + '/5');
    console.log('确权等级:', verifyResult.grade);
    console.log('各流状态:', verifyResult.results);

    console.groupEnd();
    console.groupEnd();

    // 记录组合测试AI操作
    this.logAIOperation({
      action: `组合测试场景完成: ${ent.name} 资金抽逃+季末冲量`,
      level: 'L3',
      confidence: 99,
      enterprise: ent.name,
      reasoning: [
        '触发事件: 组合测试场景一键触发',
        `步骤1: 切换至高风险企业(${ent.name})`,
        `步骤2: 系统日期推进至${this.systemDate}，激活季末冲量窗口`,
        `步骤3: 触发资金抽逃(200万白名单外转账)`,
        `结果: 信用分${snapshotBefore.creditScore}→${snapshotAfter.creditScore}, 水位${snapshotBefore.waterLevel}→${snapshotAfter.waterLevel}`,
        `结果: 确权等级${snapshotBefore.creditGradeCap}→${snapshotAfter.creditGradeCap}, 资金流${snapshotAfter.fundFlowBlocked ? '冻结' : '正常'}`,
        `结果: 五流验证${verifyResult.passedCount}/5通过, 确权${verifyResult.grade}级`
      ]
    });

    this._notify();
  },

  // === 时间加速自动播放 ===
  _autoPlayTimer: null,
  toggleAutoPlay() {
    if (this._autoPlayTimer) {
      clearInterval(this._autoPlayTimer);
      this._autoPlayTimer = null;
      this.log('system', '时间加速已暂停', 'policy');
    } else {
      this._autoPlayTimer = setInterval(() => this.advanceDate(), 2000);
      this.log('system', '时间加速已启动 (每2秒+1天)', 'policy');
    }
    this._notify();
  },
  get isAutoPlaying() { return !!this._autoPlayTimer; },

  // === 临界值边界测试: 责任链完整度 → 利率联动档位切换 ===
  // 精确验证 49%/51%/69%/71%/89%/91% 六个临界点的档位切换效果
  runChainBoundaryTest() {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;

    console.group('%c[边界测试] 责任链完整度临界值 → 利率联动档位切换', 'color:#f85149;font-weight:bold;font-size:14px');
    console.log('测试企业:', ent.name);
    console.log('spec规则4.10: ≥90%评级提升 / ≥70%优惠0.3% / <50%上浮0.5%');

    // 保存原始状态，测试后恢复
    const snapshot = {
      completeness: chain.completeness,
      _prevCompleteness: chain._prevCompleteness,
      _lastChainRateAdj: chain._lastChainRateAdj,
      complianceReport: chain.complianceReport,
      rateDiscount: ent.runtime.rateDiscount,
      creditGradeCap: ent.runtime.creditGradeCap
    };

    // 重置到基准状态（排除其他利率调整干扰）
    chain.complianceReport = null;
    chain._lastChainRateAdj = 0;
    chain._prevCompleteness = undefined;
    const baseRate = ent.runtime.rateDiscount; // 基准利率（含其他维度调整）
    ent.runtime.rateDiscount = baseRate;

    const testCases = [
      { completeness: 0.49, expect: '上浮0.5%(档位3)', desc: '<50% 临界下沿' },
      { completeness: 0.51, expect: '无调整(撤销上浮)', desc: '≥50% 临界上沿，退出惩罚区' },
      { completeness: 0.69, expect: '无调整', desc: '<70% 临界下沿，中间区间' },
      { completeness: 0.71, expect: '优惠0.3%(档位2)', desc: '≥70% 临界上沿，进入优惠区' },
      { completeness: 0.89, expect: '优惠0.3%(档位2)', desc: '<90% 临界下沿，仍优惠' },
      { completeness: 0.91, expect: '优惠0.3%+评级提升(档位1)', desc: '≥90% 临界上沿，生成合规报告' }
    ];

    const results = [];
    console.log('%c--- 开始逐档测试 ---', 'color:#58a6ff');
    testCases.forEach((tc, i) => {
      chain.completeness = tc.completeness;
      const rateBefore = ent.runtime.rateDiscount;
      const gradeBefore = ent.runtime.creditGradeCap;
      const reportBefore = !!chain.complianceReport;

      this.applyChainCompletenessLinkage(chain, ent);

      const rateAfter = ent.runtime.rateDiscount;
      const gradeAfter = ent.runtime.creditGradeCap;
      const reportAfter = !!chain.complianceReport;
      const delta = +(rateAfter - rateBefore).toFixed(2);

      results.push({
        序号: i + 1,
        完整度: `${(tc.completeness * 100).toFixed(0)}%`,
        场景: tc.desc,
        预期: tc.expect,
        '利率变化': delta === 0 ? '0' : (delta > 0 ? `+${delta}` : `${delta}`),
        '利率调整值': rateAfter,
        评级变化: gradeBefore !== gradeAfter ? `${gradeBefore}→${gradeAfter}` : '不变',
        合规报告: reportBefore !== reportAfter ? '生成' : '-'
      });
    });

    console.log('%c--- 测试结果汇总 ---', 'color:#3fb950;font-weight:bold');
    console.table(results);

    // 校验关键断言
    console.group('%c[断言校验]', 'color:#d29922;font-weight:bold');
    const a1 = results[0]['利率变化'] === '+0.5'; // 49%→上浮0.5
    const a2 = results[1]['利率变化'] === '-0.5';  // 51%→撤销上浮0.5
    const a3 = results[3]['利率变化'] === '-0.3';  // 71%→优惠0.3
    const a4 = results[5]['合规报告'] === '生成';   // 91%→合规报告
    console.log(`${a1 ? '✅' : '❌'} 49% → 利率上浮0.5%:`, results[0]['利率变化']);
    console.log(`${a2 ? '✅' : '❌'} 51% → 撤销上浮(退出惩罚区):`, results[1]['利率变化']);
    console.log(`${a3 ? '✅' : '❌'} 71% → 利率优惠0.3%:`, results[3]['利率变化']);
    console.log(`${a4 ? '✅' : '❌'} 91% → 生成合规报告:`, results[5]['合规报告']);
    const allPass = a1 && a2 && a3 && a4;
    console.log(`%c${allPass ? '✅ 全部断言通过' : '❌ 存在失败断言'}`, `color:${allPass ? '#3fb950' : '#f85149'};font-weight:bold`);
    console.groupEnd();

    // 恢复原始状态
    chain.completeness = snapshot.completeness;
    chain._prevCompleteness = snapshot._prevCompleteness;
    chain._lastChainRateAdj = snapshot._lastChainRateAdj;
    chain.complianceReport = snapshot.complianceReport;
    ent.runtime.rateDiscount = snapshot.rateDiscount;
    ent.runtime.creditGradeCap = snapshot.creditGradeCap;
    console.log('%c[边界测试] 已恢复原始状态，未污染真实数据', 'color:#8b949e');
    console.groupEnd();

    this.log('system', `🧪 边界测试完成: 责任链完整度临界值(49/51/69/71/89/91%)档位切换${allPass ? '✅全部通过' : '❌存在失败'}`, 'policy');
    this._notify();
  },

  // === 极端测试: 资金抽逃空心化+回款断崖累计扣减 (spec MOD-02 三特征) ===
  // 验证连续触发两种特征时的信用分累计扣减与保底逻辑
  runFundFlightExtremeTest() {
    const prevEntId = this.currentEnterpriseId;
    this.switchEnterprise('E003');
    const ent = this.currentEnterprise;

    const snapshot = {
      creditScore: ent.runtime.creditScore,
      waterLevel: ent.runtime.waterLevel,
      accountBalance: ent.financials.accountBalance,
      fundFlowBlocked: ent.runtime.fundFlowBlocked,
      creditGradeCap: ent.runtime.creditGradeCap,
      fiveStreams: JSON.parse(JSON.stringify(ent.runtime.fiveStreams))
    };

    ent.runtime.fundFlowBlocked = false;
    ent.runtime.fiveStreams.fund = true;
    ent.runtime.fiveStreams.contract = true;

    const initialScore = ent.runtime.creditScore;
    const results = [];

    console.group('%c[极端测试] 资金抽逃: 空心化 + 回款断崖 累计扣减', 'color:#f85149;font-weight:bold;font-size:14px');
    console.log('测试企业:', ent.name, '| 初始信用分:', initialScore);

    // ① 触发空心化 (spec: -80)
    const beforeHollowing = ent.runtime.creditScore;
    this.simulateFundFlight('hollowing');
    const afterHollowing = ent.runtime.creditScore;
    const hollowingDelta = beforeHollowing - afterHollowing;
    const a1 = hollowingDelta === 80;
    results.push({ 阶段: '① 空心化', 扣减预期: '-80', 实际扣减: `-${hollowingDelta}`, 信用分: afterHollowing });
    console.log(`${a1 ? '✅' : '❌'} ① 空心化: ${beforeHollowing} → ${afterHollowing} (扣减${hollowingDelta}, 预期80)`);

    // ② 触发回款断崖 (spec: -70, 在空心化基础上累计)
    const beforeCliff = ent.runtime.creditScore;
    this.simulateFundFlight('repayment_cliff');
    const afterCliff = ent.runtime.creditScore;
    const cliffDelta = beforeCliff - afterCliff;
    const totalDelta = initialScore - afterCliff;
    const a2 = cliffDelta === 70;
    const a3 = totalDelta === 150;
    results.push({ 阶段: '② 回款断崖', 扣减预期: '-70(累计-150)', 实际扣减: `-${cliffDelta}`, 信用分: afterCliff });
    console.log(`${a2 ? '✅' : '❌'} ② 回款断崖: ${beforeCliff} → ${afterCliff} (扣减${cliffDelta}, 预期70)`);
    console.log(`累计扣减: ${initialScore} → ${afterCliff} (共-${totalDelta}, 预期150)`);

    // ③ 保底逻辑验证: 信用分不低于300
    const a4 = afterCliff >= 300;
    console.log(`${a4 ? '✅' : '❌'} 保底逻辑: 信用分${afterCliff} ≥ 300`);

    // ④ 特征差异化验证: 空心化冻结资金流，回款断崖不冻结(不解除)
    const a5 = ent.runtime.fundFlowBlocked === true;
    console.log(`${a5 ? '✅' : '❌'} 特征差异: 资金流冻结=${ent.runtime.fundFlowBlocked}`);

    console.log('--- 测试结果汇总 ---');
    console.table(results);

    const allPass = a1 && a2 && a3 && a4 && a5;
    console.log(`${allPass ? '✅ 全部断言通过' : '❌ 存在失败断言'}`);

    // 恢复原始状态
    ent.runtime.creditScore = snapshot.creditScore;
    ent.runtime.waterLevel = snapshot.waterLevel;
    ent.financials.accountBalance = snapshot.accountBalance;
    ent.runtime.fundFlowBlocked = snapshot.fundFlowBlocked;
    ent.runtime.creditGradeCap = snapshot.creditGradeCap;
    ent.runtime.fiveStreams = snapshot.fiveStreams;
    console.log('[极端测试] 已恢复原始状态');
    console.groupEnd();

    this.log('system', `🧪 极端测试: 空心化(-80)+回款断崖(-70)=累计${totalDelta}，保底${afterCliff}${allPass ? '✅' : '❌'}`, 'policy');
    this.switchEnterprise(prevEntId);
  },

  // === 数据脱敏 ===
  desensitize(text, type = 'name') {
    if (type === 'name') return text.charAt(0) + '***';
    if (type === 'account') return '****' + text.slice(-4);
    return text;
  },

  // =============================================
  // === APP-04 监管沙盒 ===
  // =============================================

  // 生成脱敏式穿透报告 (spec: 大额可疑交易 → 脱敏账户号 + 银行加密确权背书)
  generatePenetrationReport(logId) {
    const log = this.linkageLog.find(l => l.id === logId);
    if (!log) return;
    const ent = this.enterprises.find(e => e.name === log.enterprise) || this.currentEnterprise;
    // 脱敏账户号: 6217****1234 格式
    const rawAccount = '6217' + Math.floor(10000000 + Math.random() * 89999999) + '1234';
    const desensitizedAccount = rawAccount.substring(0, 4) + '****' + rawAccount.slice(-4);

    const report = {
      id: 'RPT_' + Date.now().toString().slice(-6),
      triggerLogId: logId,
      enterprise: ent.name,
      desensitizedEnterprise: this.desensitize(ent.name),
      desensitizedAccount: desensitizedAccount,
      amount: log.amount || 2000000,
      riskFeatures: '57维异常特征 / 白名单外转账 / 资金流向不明',
      bankEndorsement: '该账户确为' + this.desensitize(ent.name) + '子公司(加密确权背书已验证)',
      chainHash: '0x' + Math.random().toString(16).substring(2, 18) + Math.random().toString(16).substring(2, 18),
      generatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      status: 'pending' // pending/archived/need_more_info/false_positive
    };
    this.penetrationReports.push(report);

    this.log('system', `📋 生成《脱敏式穿透报告》: ${report.id}`, 'config');
    this.log('system', `→ 账户: ${desensitizedAccount} | 企业: ${report.desensitizedEnterprise}`, 'config');
    this.log('system', `→ 银行确权背书: 已验证 | 区块链存证: ${report.chainHash.substring(0, 16)}...`, 'config');

    this.logAIOperation({
      action: `监管沙盒: 生成穿透报告 ${report.id}`,
      level: 'L2', confidence: 95, enterprise: ent.name,
      reasoning: [
        `触发: 可疑交易红色预警 (${log.message.substring(0, 30)})`,
        '规则: spec APP-04 → 生成脱敏式穿透报告',
        `脱敏: 账户${desensitizedAccount} + 企业${report.desensitizedEnterprise}`,
        `确权: 银行加密背书已验证`,
        `存证: 区块链hash ${report.chainHash.substring(0, 16)}...`
      ]
    });
    // 非阻塞Toast通知 (不遮挡操作流) + 用户在Tab8点击卡片再打开阻塞Modal审阅归档
    if (typeof AIModal !== 'undefined') {
      AIModal.toast({
        type: 'penetration',
        title: `🔍 监管穿透报告 · ${report.id} 已生成`,
        text: `风险特征: ${report.riskFeatures.substring(0, 50)}... | 银行确权背书已验证 | 区块链存证上链`,
        color: 'green',
        duration_ms: 7500,
        actionLabel: '📋 到Tab8审阅归档',
        onAction: () => { if (typeof App !== 'undefined') App.switchTab('regulatory'); }
      });
    }
    this.log('system', `🔍 ${report.id} 脱敏式穿透报告已生成 (${report.desensitizedEnterprise})`, 'config');
    this._notify();
  },

  // 审阅具体穿透报告 (阻塞Modal, 三操作: 归档/补充/误报)
  openPenetrationModal(reportId) {
    const report = (this.penetrationReports || []).find(r => r.id === reportId);
    if (!report || typeof AIModal === 'undefined') return;
    AIModal.show({
      type: 'penetration',
      title: `脱敏式穿透报告 · ${report.id}`,
      timestamp: report.generatedAt,
      aiSuggestion: `检测到可疑交易，已生成脱敏式穿透报告并完成银行加密确权背书与区块链存证，请审阅后确认归档。`,
      aiConfidence: 95,
      contextHTML: `
        <div style="font-size:12px;line-height:1.9;color:var(--text-secondary)">
          <div>🏦 <strong>脱敏银行账户:</strong> <code style="background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px">${report.desensitizedAccount}</code></div>
          <div>🏢 <strong>关联企业(脱敏):</strong> ${report.desensitizedEnterprise}</div>
          <div>💰 <strong>交易金额:</strong> ${this.formatAmount(report.amount)}</div>
          <div>⚠️ <strong>风险特征:</strong> ${report.riskFeatures}</div>
          <div>🔐 <strong>银行确权背书:</strong> <span style="color:var(--accent-green)">${report.bankEndorsement}</span></div>
          <div>🔗 <strong>区块链存证:</strong> <code style="font-size:10px">${report.chainHash.substring(0, 24)}...</code></div>
        </div>
      `,
      confirmLabel: '✓ 确认归档',
      replyLabel: '↩ 要求补充信息',
      dissentLabel: '✗ 标记为误报',
      onConfirm: () => {
        report.status = 'archived';
        this.log('system', `✅ 穿透报告 ${report.id} 已确认归档`, 'config');
        this._notify();
      },
      onReply: (note) => {
        report.status = 'need_more_info';
        this.log('system', `穿透报告 ${report.id} 要求补充: ${note || '待补充'}`, 'alert');
        this._notify();
      },
      onDissent: (reason) => {
        report.status = 'false_positive';
        this.log('system', `穿透报告 ${report.id} 标记为误报: ${reason || '人工判定'}`, 'alert');
        this._notify();
      },
      onDismiss: () => {}
    });
  },

  // 获取全链路审计追踪 (spec: 数据采集→AI决策→资金划转, 含区块链存证验证)
  getAuditTrail() {
    const trail = [];
    // 从AI操作记录和联动日志构建审计链路
    const recentOps = this.aiOperations.slice(-8).reverse();
    const recentLogs = this.linkageLog.slice(-12).reverse();

    // 阶段1: 数据采集
    recentLogs.filter(l => l.source === 'enterprise' || l.source === 'bank').slice(0, 4).forEach(log => {
      trail.push({
        stage: '数据采集',
        icon: '📡',
        desc: log.message,
        enterprise: log.enterprise,
        timestamp: log.timestamp,
        traceCode: 'DC_' + (log.id || '').substring(0, 8),
        anchored: true
      });
    });

    // 阶段2: AI决策
    recentOps.filter(o => o.level === 'L1' || o.level === 'L2' || o.level === 'L3').slice(0, 4).forEach(op => {
      trail.push({
        stage: 'AI决策',
        icon: '🤖',
        desc: op.action,
        enterprise: op.enterprise,
        timestamp: op.timestamp,
        traceCode: op.id || 'AI_' + Date.now(),
        anchored: true
      });
    });

    // 阶段3: 资金划转
    this.linkageLog.filter(l => l.source === 'flow' || (l.source === 'enterprise' && l.message.includes('资金'))).slice(-4).reverse().forEach(log => {
      trail.push({
        stage: '资金划转',
        icon: '💸',
        desc: log.message,
        enterprise: log.enterprise,
        timestamp: log.timestamp,
        traceCode: 'FT_' + (log.id || '').substring(0, 8),
        anchored: !!log.traceCode || true
      });
    });

    // 按时间戳排序
    return trail.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10);
  },

  // 获取合规检查状态
  getComplianceStatus() {
    const ent = this.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const chainCompleteness = chain ? chain.completeness : 0;
    const dataCompleteness = Object.values(ent.dataFlows).filter(v => v).length / Object.keys(ent.dataFlows).length;
    const aiOps = this.aiOperations;
    const l3l4Count = aiOps.filter(o => o.level === 'L3' || o.level === 'L4').length;
    const aiApprovalRate = aiOps.length > 0 ? Math.round((l3l4Count / aiOps.length) * 100) : 0;

    const chainLabel = chainCompleteness >= 0.7 ? '合规' : chainCompleteness >= 0.4 ? '关注' : '不合规';
    const chainColor = chainCompleteness >= 0.7 ? 'var(--accent-green)' : chainCompleteness >= 0.4 ? 'var(--accent-orange)' : 'var(--accent-red)';
    const dataLabel = dataCompleteness >= 0.6 ? '合规' : dataCompleteness >= 0.4 ? '关注' : '不合规';
    const dataColor = dataCompleteness >= 0.6 ? 'var(--accent-green)' : dataCompleteness >= 0.4 ? 'var(--accent-orange)' : 'var(--accent-red)';
    const aiLabel = aiApprovalRate >= 40 ? '合规' : aiApprovalRate >= 20 ? '关注' : '偏低';
    const aiColor = aiApprovalRate >= 40 ? 'var(--accent-green)' : aiApprovalRate >= 20 ? 'var(--accent-orange)' : 'var(--accent-red)';

    const issues = [];
    if (chainCompleteness < 0.5) issues.push('责任链完整度不足');
    if (dataCompleteness < 0.5) issues.push('数据流开放度不足');
    if (this.linkageLog.filter(l => l.type === 'alert').length > 0) issues.push('存在未处理告警');

    const overall = issues.length === 0 ? '合规' : issues.length <= 1 ? '关注' : '不合规';
    const recommendation = issues.length === 0
      ? '各项指标正常，建议维持当前合规水平，定期执行审计追踪核验'
      : `存在${issues.length}项合规问题: ${issues.join('、')}。建议优先处理告警项，补充责任链确认和数据流开放。`;

    return { overall, chainCompleteness, chainLabel, chainColor, dataCompleteness, dataLabel, dataColor, aiApprovalRate, aiLabel, aiColor, recommendation };
  },

  // =============================================
  // 银行端操作 (Tab4 交互动作)
  // =============================================

  // 调整AI推荐授信额度乘数
  bankAdjustCreditLimit(delta) {
    const ent = this.currentEnterprise;
    const prev = ent.runtime.maxAmountMultiplier;
    ent.runtime.maxAmountMultiplier = Math.max(0.1, Math.min(3.0, prev + delta));
    this.log('bank', `🏦 银行操作: 调整${ent.name}授信乘数 ${prev.toFixed(1)} → ${ent.runtime.maxAmountMultiplier.toFixed(1)}`, 'config');
    this.log('bank', `→ AI推荐额度: ${this.formatAmount(this.getMaxAmount(ent))}`, 'config');
    this.logAIOperation({
      action: `银行调整授信乘数: ${ent.name} ${prev.toFixed(1)}→${ent.runtime.maxAmountMultiplier.toFixed(1)}`,
      level: 'L4', confidence: 100, enterprise: ent.name,
      reasoning: ['触发: 银行端人工调整', `原乘数: ${prev.toFixed(1)}`, `调整幅度: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}`, `新额度: ${this.formatAmount(this.getMaxAmount(ent))}`]
    });
    this._notify();
  },

  // 冻结/解冻监管账户
  bankToggleAccountFreeze() {
    const ent = this.currentEnterprise;
    if (ent.runtime.fundFlowBlocked) {
      ent.runtime.fundFlowBlocked = false;
      ent.runtime.fiveStreams.fund = true;
      this.log('bank', `🏦 银行操作: 解冻${ent.name}监管账户，资金流恢复`, 'config');
    } else {
      ent.runtime.fundFlowBlocked = true;
      ent.runtime.fiveStreams.fund = false;
      this.log('bank', `🏦 银行操作: 冻结${ent.name}监管账户，资金流阻断`, 'alert');
    }
    this.logAIOperation({
      action: `银行${ent.runtime.fundFlowBlocked ? '冻结' : '解冻'}监管账户: ${ent.name}`,
      level: 'L4', confidence: 100, enterprise: ent.name,
      reasoning: ['触发: 银行端风控操作', `状态: 资金流${ent.runtime.fundFlowBlocked ? '冻结' : '恢复'}`]
    });
    this._notify();
  },

  // 发送风险提示函
  bankIssueRiskNotice() {
    const ent = this.currentEnterprise;
    const noticeId = 'RN_' + Date.now().toString().slice(-6);
    this.log('bank', `🏦 银行操作: 向${ent.name}发送《风险提示函》${noticeId}`, 'alert');
    this.log('bank', `→ 要求企业30日内补充经营数据/回款凭证`, 'alert');
    this.logAIOperation({
      action: `银行发送风险提示函: ${ent.name} (${noticeId})`,
      level: 'L3', confidence: 90, enterprise: ent.name,
      reasoning: ['触发: 银行端风控提示', '内容: 要求补充经营数据与回款凭证', '期限: 30日']
    });
    this._notify();
  },

  // 标记/取消重点关注
  bankToggleWatchlist() {
    const ent = this.currentEnterprise;
    if (!ent.runtime.watchlisted) ent.runtime.watchlisted = false;
    ent.runtime.watchlisted = !ent.runtime.watchlisted;
    this.log('bank', `🏦 银行操作: ${ent.runtime.watchlisted ? '标记' : '解除'}${ent.name}为重点关注企业`, 'config');
    this.logAIOperation({
      action: `银行${ent.runtime.watchlisted ? '标记关注' : '解除关注'}: ${ent.name}`,
      level: 'L4', confidence: 100, enterprise: ent.name,
      reasoning: ['触发: 银行端名单管理', `状态: ${ent.runtime.watchlisted ? '重点关注' : '常规'}`]
    });
    this._notify();
  },

  // === 银行操作弹窗确认 (点击操作→弹窗→确认后执行) ===
  confirmBankAction(action, param) {
    if (typeof AIModal === 'undefined') { this._execBankAction(action, param); return; }
    const ent = this.currentEnterprise;
    const actionMeta = {
      adjustCredit: {
        title: `调整授信乘数 · ${ent.name}`,
        ai: `将授信乘数从 ${ent.runtime.maxAmountMultiplier.toFixed(1)} 调整为 ${(ent.runtime.maxAmountMultiplier + param).toFixed(1)}，AI推荐额度将从 ${this.formatAmount(this.getMaxAmount(ent))} 变更为 ${this.formatAmount(this.getMaxAmount(ent) / ent.runtime.maxAmountMultiplier * (ent.runtime.maxAmountMultiplier + param))}。`,
        ctx: `<div style="font-size:12px;line-height:1.8">当前乘数: ×${ent.runtime.maxAmountMultiplier.toFixed(1)}<br>调整幅度: ${param > 0 ? '+' : ''}${param}<br>调整后乘数: ×${(ent.runtime.maxAmountMultiplier + param).toFixed(1)}<br>当前推荐额度: ${this.formatAmount(this.getMaxAmount(ent))}</div>`,
        confirmLabel: '✓ 确认调整'
      },
      toggleFreeze: {
        title: `${ent.runtime.fundFlowBlocked ? '解冻' : '冻结'}监管账户 · ${ent.name}`,
        ai: `${ent.runtime.fundFlowBlocked ? '解冻' : '冻结'}该企业监管账户，${ent.runtime.fundFlowBlocked ? '资金流将恢复' : '资金流将阻断，五流合一降级'}。此操作影响企业融资能力，请谨慎确认。`,
        ctx: `<div style="font-size:12px;line-height:1.8">当前状态: ${ent.runtime.fundFlowBlocked ? '资金流冻结' : '资金流正常'}<br>操作后: ${ent.runtime.fundFlowBlocked ? '资金流恢复' : '资金流冻结'}<br>影响: ${ent.runtime.fundFlowBlocked ? '恢复融资能力' : '阻断融资,确权降级'}</div>`,
        confirmLabel: ent.runtime.fundFlowBlocked ? '✓ 确认解冻' : '✓ 确认冻结'
      },
      riskNotice: {
        title: `发送风险提示函 · ${ent.name}`,
        ai: `向该企业发送《风险提示函》，要求30日内补充经营数据与回款凭证。函件将记录在联动日志并通知AI驾驶舱。`,
        ctx: `<div style="font-size:12px;line-height:1.8">对象企业: ${ent.name}<br>信用评分: ${ent.runtime.creditScore}<br>要求: 30日内补充经营数据/回款凭证</div>`,
        confirmLabel: '✓ 确认发送'
      },
      toggleWatch: {
        title: `${ent.runtime.watchlisted ? '解除' : '标记'}重点关注 · ${ent.name}`,
        ai: `${ent.runtime.watchlisted ? '解除' : '标记'}该企业为银行重点关注企业，${ent.runtime.watchlisted ? '恢复常规监控' : '将加强贷后监管频率'}。`,
        ctx: `<div style="font-size:12px;line-height:1.8">对象企业: ${ent.name}<br>当前状态: ${ent.runtime.watchlisted ? '重点关注' : '常规'}<br>操作后: ${ent.runtime.watchlisted ? '常规' : '重点关注'}</div>`,
        confirmLabel: ent.runtime.watchlisted ? '✓ 确认解除' : '✓ 确认标记'
      }
    };
    const meta = actionMeta[action];
    if (!meta) return;
    AIModal.show({
      type: 'bankAction',
      title: meta.title,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      aiSuggestion: meta.ai,
      aiConfidence: 90,
      contextHTML: meta.ctx,
      confirmLabel: meta.confirmLabel,
      replyLabel: '↩ 附言说明',
      dissentLabel: '✗ 取消操作',
      onConfirm: () => { this._execBankAction(action, param); },
      onReply: (note) => { this.log('bank', `银行操作附言: ${note || '(无)'}`, 'config'); this._execBankAction(action, param); },
      onDissent: () => { this.log('bank', `银行操作已取消: ${meta.title}`, 'info'); this._notify(); },
      onDismiss: () => {}
    });
  },

  // 实际执行银行操作
  _execBankAction(action, param) {
    if (action === 'adjustCredit') this.bankAdjustCreditLimit(param);
    else if (action === 'toggleFreeze') this.bankToggleAccountFreeze();
    else if (action === 'riskNotice') this.bankIssueRiskNotice();
    else if (action === 'toggleWatch') this.bankToggleWatchlist();
  },

  // =============================================
  // === APP-07 关联机构门户 ===
  // =============================================

  _seedInitialPartnerTasks() {
    // 预置2个初始任务（评估+律所各1个）
    this.partnerTasks = [
      {
        id: 'PT_001', inst: 'appraisal', title: '宏达精密设备评估',
        desc: 'AI委派: 评估抵押设备(数控机床×8台)当前市场价值',
        desensitizedEnt: '宏***司', enterprise: 'E001',
        deadline: '2026-08-20', fee: 15000, status: 'pending',
        dataPackage: 5, dataItems: ['资产清单', '采购发票', '折旧明细', '设备照片', '权属证明']
      },
      {
        id: 'PT_002', inst: 'law', title: '智芯科技合同法律审查',
        desc: 'AI委派: 审查知识产权质押合同的法律合规性',
        desensitizedEnt: '智***司', enterprise: 'E002',
        deadline: '2026-08-18', fee: 12000, status: 'pending',
        dataPackage: 4, dataItems: ['质押合同', '知识产权证书', '企业资质', '诉讼记录']
      }
    ];
  },

  getPartnerTasks(inst) {
    return this.partnerTasks.filter(t => t.inst === inst).reverse();
  },

  dispatchPartnerTask(inst) {
    const ent = this.currentEnterprise;
    const cfg = MockData.PARTNER_INSTITUTIONS[inst];
    const taskTemplates = {
      logistics: { title: `${ent.name}运单确认`, desc: 'AI委派: 确认运单信息并关联GPS轨迹生成签收证明', dataItems: ['运单信息', '货物清单', '起运地', '目的地'] },
      appraisal: { title: `${ent.name}资产评估`, desc: 'AI委派: 评估企业抵押资产的市场价值', dataItems: ['资产清单', '采购发票', '折旧明细', '权属证明'] },
      law: { title: `${ent.name}法律审查`, desc: 'AI委派: 审查融资相关合同的法律合规性', dataItems: ['合同文件', '企业资质', '诉讼记录'] },
      audit: { title: `${ent.name}财务审计`, desc: 'AI委派: 审计企业最近一期财务报表', dataItems: ['资产负债表', '利润表', '现金流量表', '纳税记录'] }
    };
    const tmpl = taskTemplates[inst];
    const task = {
      id: 'PT_' + Date.now().toString().slice(-6),
      inst, title: tmpl.title, desc: tmpl.desc,
      desensitizedEnt: this.desensitize(ent.name), enterprise: ent.id,
      deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      fee: 8000 + Math.floor(Math.random() * 12000),
      status: 'pending',
      dataPackage: tmpl.dataItems.length, dataItems: tmpl.dataItems
    };
    this.partnerTasks.push(task);

    this.log('system', `🤖 AI自动委派任务: ${cfg.name} → ${task.title}`, 'config');
    this.log('system', `→ 企业(脱敏): ${task.desensitizedEnt} | 截止: ${task.deadline} | 报酬: ${this.formatAmount(task.fee)}`, 'config');
    this.logAIOperation({
      action: `关联机构委派: ${cfg.name} ${task.title}`,
      level: 'L2', confidence: 88, enterprise: ent.name,
      reasoning: [
        `触发: 融资流程需要${cfg.name}的${inst === 'logistics' ? '运单确认' : inst === 'appraisal' ? '资产评估' : inst === 'law' ? '法律意见' : '审计报告'}`,
        `AI委派: 自动匹配${cfg.name}并推送脱敏数据包`,
        `数据安全: 数据包仅在门户内查看，不可下载`,
        `报酬: ${this.formatAmount(task.fee)}`
      ]
    });
    this._notify();
  },

  acceptPartnerTask(taskId) {
    const task = this.partnerTasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = 'processing';
    const cfg = MockData.PARTNER_INSTITUTIONS[task.inst];
    this.log('system', `✅ ${cfg.name}已接受任务: ${task.title}`, 'config');
    this.log('system', `→ 脱敏数据包已推送(${task.dataPackage}项)，门户内查看，不可下载`, 'config');
    this._notify();
  },

  submitPartnerReport(taskId, conclusion, detail) {
    const task = this.partnerTasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = 'completed';
    task.conclusion = conclusion;
    task.detail = detail;
    task.completedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const cfg = MockData.PARTNER_INSTITUTIONS[task.inst];
    const reportNames = { logistics: '签收证明', appraisal: '评估报告', law: '法律意见书', audit: '审计报告' };

    this.log('system', `📤 ${cfg.name}回传${reportNames[task.inst]}: ${task.title}`, 'config');
    this.log('system', `→ 结论: ${conclusion}`, 'config');
    this.log('system', `→ 系统已自动整合到业务流程，任务完成`, 'config');

    this.logAIOperation({
      action: `关联机构报告回传: ${cfg.name} ${reportNames[task.inst]}`,
      level: 'L2', confidence: 90, enterprise: task.desensitizedEnt,
      reasoning: [
        `机构: ${cfg.name}`,
        `报告类型: ${reportNames[task.inst]}`,
        `结论: ${conclusion}`,
        `处理: 系统自动整合到业务流程`,
        `报酬结算: ${this.formatAmount(task.fee)}`
      ]
    });
    this._notify();
  },

  // 物流运单确认 (spec: 确认运单信息 → 关联IoT GPS轨迹 → 生成签收证明)
  confirmWaybill() {
    const ent = this.currentEnterprise;
    const waybillId = 'WL_2026_' + Date.now().toString().slice(-6);
    const traceCode = 'GPS_' + Math.random().toString(36).substring(2, 12);

    this.log('enterprise', `🚚 物流运单确认完成: ${waybillId}`, 'config');
    this.log('enterprise', `→ 起运地: 深圳宝安 → 目的地: 东莞松山湖 (68.5km)`, 'config');
    this.log('enterprise', `→ IoT GPS轨迹已关联: ${traceCode}`, 'config');
    this.log('enterprise', `→ 签收证明已生成，关联责任链节点N09(客户签收确认)`, 'config');

    this.logAIOperation({
      action: `物流运单确认: ${ent.name} 运单${waybillId}`,
      level: 'L2', confidence: 92, enterprise: ent.name,
      reasoning: [
        `触发: 物流公司在门户确认运单`,
        `运单: ${waybillId} (深圳宝安→东莞松山湖)`,
        `IoT: GPS轨迹${traceCode}已关联`,
        `温控: 正常(15-25°C)`,
        `处理: 生成签收证明 → 关联责任链N09`,
        `影响: 责任链节点N09(客户签收确认)可确权`
      ]
    });
    this._notify();
  },

  // === 场景加载 ===
  loadScene(sceneId) {
    this.log('system', `📦 场景加载: ${sceneId}`, 'config');
    const scenes = {
      'standard': () => {
        this.switchEnterprise('E001');
        this.log('system', `  ├─ 企业: 宏达精密制造 (标准融资)`, 'config');
        this.log('system', `  ├─ 数据流: 3流(资金/合同/发票)`, 'config');
        this.log('system', `  └─ 自主度: L2`, 'config');
      },
      'policy_bonus': () => {
        this.switchEnterprise('E002');
        this.log('system', `  ├─ 企业: 智芯科技 (政策红利)`, 'config');
        this.log('system', `  ├─ 数据流: 5流(+物流+IoT)`, 'config');
        this.log('system', `  └─ 自主度: L1, 政策: 鼓励`, 'config');
      },
      'risk_alert': () => {
        this.switchEnterprise('E003');
        setTimeout(() => this.simulateFundFlight(), 500);
        this.log('system', `  ├─ 企业: 鑫达贸易 (高风险)`, 'config');
        this.log('system', `  ├─ 触发: 资金抽逃预警`, 'config');
        this.log('system', `  └─ 自主度: L3`, 'config');
      },
      'quarter_end': () => {
        this.switchEnterprise('E001');
        this.systemDate = '2026-09-28';
        this.updateSeasonalWindow();
        this.log('system', `  ├─ 企业: 宏达精密制造`, 'config');
        this.log('system', `  ├─ 系统时间: 2026-09-28 (季末冲量)`, 'config');
        this.log('system', `  └─ 季节性窗口: 季末冲量已激活`, 'config');
      },
      // v4.3 新增场景5: API 接入优先 — 演示三档分类的 API 接入档
      'api_priority': () => {
        // 先恢复独立运行模式 (如果开着)
        if (this.fallbackEngine.independentMode.enabled) {
          this.toggleIndependentMode(false, { skipNotify: true });
        }
        // 恢复全部 API 接入
        this.externalApis.forEach(api => {
          if (api.status !== 'connected') {
            this.handleApiStatusChange(api.id, 'connected', { skipNotify: true });
          }
        });
        // C1-C7 全部置 standby
        this.fallbackEngine.modules.forEach(m => {
          m.status = 'standby';
          m.lastActivatedAt = null;
        });
        this._recomputeFallbackChainLevel();
        this.switchEnterprise('E001');
        this.log('system', `  ├─ 场景: API 接入优先 (三档分类演示)`, 'fallback');
        this.log('system', `  ├─ 外部 API: 15/15 全部 connected`, 'fallback');
        this.log('system', `  ├─ C1-C7 兜底子模块: 全部 standby`, 'fallback');
        this.log('system', `  ├─ 兜底降级链: 1 级 (API 接入)`, 'fallback');
        this.log('system', `  └─ 独立运行模式: 关闭`, 'fallback');
      },
      // v4.3 新增场景6: 独立运行兜底 — 演示零外部机构接入下的独立运行能力
      'independent_fallback': () => {
        // 先切换企业(switchEnterprise 会清空告警,避免污染) → 再切独立运行模式(确保告警不被清掉)
        this.switchEnterprise('E003');
        if (!this.fallbackEngine.independentMode.enabled) {
          this.toggleIndependentMode(true, { skipNotify: true });
        }
        this.log('system', `  ├─ 场景: 独立运行兜底 (零外部机构接入)`, 'fallback');
        this.log('system', `  ├─ 外部 API: 0/15 全部 disconnected`, 'fallback');
        this.log('system', `  ├─ C1-C7 兜底子模块: 全部 active`, 'fallback');
        this.log('system', `  ├─ 兜底降级链: 3 级 (独立运行)`, 'fallback');
        this.log('system', `  └─ 全栈降级: ${MockData.INDEPENDENT_MODE_CAPABILITIES.degradedServices.length} 项服务降级 / ${MockData.INDEPENDENT_MODE_CAPABILITIES.availableServices.length} 项服务仍可提供`, 'fallback');
      },
      // ===== v5.0 v=36 补齐: 改造场景 (simulation-plan 二补.7) =====
      'reform_A': () => {
        // 切换到海川物流(E004)或当前企业 → 激进程度=conservative → 自动执行 诊断+生成3方案+选推荐方案+调度
        if (!this.currentEnterprise || this.currentEnterprise.id !== 'E004') this.switchEnterprise('E004');
        this.setReformAggressiveness('conservative');
        this.log('system', `  ┌─ 🟢 [改造·场景A] 保守版方案 (simulation-plan 二补.7 对齐)`, 'reform');
        this.log('system', `  ├─ 企业: ${this.currentEnterprise.name} · 8 维改造闭环`, 'reform');
        this.log('system', `  ├─ 激进程度: 保守版 (仅绿区合规 · 无灰区 · 无法务节点)`, 'reform');
        this.log('system', `  ├─ 下一步: 点击 Tab0 → ④一键执行 跑完整流程(或直接点场景E 一键完成)`, 'reform');
        this.log('system', `  └─ 预期结果: 3~6月 · 成本5~15万 · 信用等级 D→B+`, 'reform');
        // Tab0 渲染后自动触发 ViewReform 的场景A 流水线 (需等 DOM 就绪)
        setTimeout(() => {
          if (typeof ViewReform !== 'undefined' && typeof ViewReform.simulateScenarioA_conservative === 'function') {
            // 延迟执行, 确保 Tab0 已渲染并接收到状态变更
            setTimeout(() => ViewReform.simulateScenarioA_conservative(), 300);
          }
        }, 150);
      },
      'reform_B': () => {
        // 平衡版方案: balanced 激进程度 → 含反向收购/股权代持 → 触发 Tab3 法务审核
        if (!this.currentEnterprise || this.currentEnterprise.id !== 'E001') this.switchEnterprise('E001');
        this.setReformAggressiveness('balanced');
        this.log('system', `  ┌─ 🔵 [改造·场景B] 平衡版方案 (simulation-plan 二补.7 对齐)`, 'reform');
        this.log('system', `  ├─ 企业: ${this.currentEnterprise.name} · 制造业典型平衡路径`, 'reform');
        this.log('system', `  ├─ 激进程度: 平衡版 (绿区+灰区 · 含反向收购/股权代持)`, 'reform');
        this.log('system', `  ├─ 联动5.5: 灰区节点 → 自动推送 Tab3 法务审批队列`, 'reform');
        this.log('system', `  └─ 预期结果: 6~12月 · 成本20~50万 · 通过率 ~70%`, 'reform');
        setTimeout(() => {
          if (typeof ViewReform !== 'undefined' && typeof ViewReform.simulateScenarioB_balanced === 'function') {
            setTimeout(() => ViewReform.simulateScenarioB_balanced(), 300);
          }
        }, 150);
      },
      'reform_C': () => {
        // 创新版方案: innovative 激进程度 → 资本运作(Pre-IPO/混改/VIE) → 成本/时长翻倍
        if (!this.currentEnterprise || this.currentEnterprise.id !== 'E002') this.switchEnterprise('E002');
        this.setReformAggressiveness('innovative');
        this.log('system', `  ┌─ 🟠 [改造·场景C] 创新版方案 (simulation-plan 二补.7 对齐)`, 'reform');
        this.log('system', `  ├─ 企业: ${this.currentEnterprise.name} · 科技型企业 (含 R5-H 资本运作)`, 'reform');
        this.log('system', `  ├─ 激进程度: 创新版 (全合规空间 · 复杂资本运作组合)`, 'reform');
        this.log('system', `  ├─ 特色: Pre-IPO 重构 / 混改引入国资 / 股权激励 / 跨境 VIE`, 'reform');
        this.log('system', `  └─ 预期结果: 12~18月 · 成本50~150万 · 通过率 ~88% · 直达 A 级`, 'reform');
        setTimeout(() => {
          if (typeof ViewReform !== 'undefined' && typeof ViewReform.simulateScenarioC_innovative === 'function') {
            setTimeout(() => ViewReform.simulateScenarioC_innovative(), 300);
          }
        }, 150);
      },
      // ===== v6.0 新增: 3 个 SCF 场景 (simulation-plan 第七章) =====
      'scf_anchor': () => {
        // 核心: E001 宏达精密 + 供应商: SCF-S001 东方钢材 + 贸易: TRD-001 → 全链路 SC1-SC10
        this.switchEnterprise('E001');
        this.setSCFAnchor('E001');
        this.setSCFPartner('SCF-S001');
        this.log('system', `  ┌─ 🚛 [SCF·核心企业保理] 场景加载 (simulation-plan 第七章)`, 'scf');
        this.log('system', `  ├─ 核心企业: ${this.getAnchorEnterprise('E001').name}`, 'scf');
        this.log('system', `  ├─ 供应商: ${this.getSCFEnterprise('SCF-S001').name} (合作3年·信用680)`, 'scf');
        this.log('system', `  ├─ 贸易: TRD-001 应收账款 45万 · 五流验证通过`, 'scf');
        this.log('system', `  └─ 下一步: 点击 Tab11 顶部「🚀 一键全链路 SC1→SC10」执行`, 'scf');
        // 自动执行全链路 (延迟,确保 Tab11 已渲染)
        setTimeout(() => {
          if (typeof SCFEngine !== 'undefined' && SCFEngine.runFullPipeline) {
            const result = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
            if (result && result.success) {
              this.logSCF('SCENE', `✅ 场景执行成功: ${result.product.productName} 融资 ${result.loan.amount} 元 @ ${result.loan.rate}%`);
            } else {
              this.logSCF('SCENE', `⚠️ 场景执行未完成: ${result ? result.reason : '未知原因'}`);
            }
          }
        }, 500);
      },
      'scf_risk': () => {
        // 风险预警: 黑名单检测 + 风险扩散分析
        this.switchEnterprise('E001');
        this.setSCFAnchor('E001');
        this.log('system', `  ┌─ ⚠️ [SCF·供应链风险预警] 场景加载 (simulation-plan 第七章)`, 'scf');
        this.log('system', `  ├─ 演示: SC2 黑名单准入拦截 + SC7 风险扩散分析`, 'scf');
        this.log('system', `  ├─ 黑名单企业: SCF-S005 虚假贸易公司 / SCF-S006 关联方循环`, 'scf');
        this.log('system', `  └─ 下一步: 在 Tab11 S4 黑白名单 + S8 风险预警面板查看详情`, 'scf');
        // 触发 SC2 准入检测 (针对黑名单企业)
        setTimeout(() => {
          if (typeof SCFEngine !== 'undefined') {
            // SC2 检测 SCF-S005 (虚假贸易)
            const check1 = SCFEngine.SC2_checkAdmission('SCF-S005');
            this.logSCF('SC2', `准入检测 SCF-S005: ${check1.admitted ? '通过' : '拒绝'} | 原因: ${check1.reason}`);
            // SC2 检测 SCF-S006 (关联循环)
            const check2 = SCFEngine.SC2_checkAdmission('SCF-S006');
            this.logSCF('SC2', `准入检测 SCF-S006: ${check2.admitted ? '通过' : '拒绝'} | 原因: ${check2.reason}`);
            // SC7 风险扩散分析 (假设 SCF-S001 节点发生风险事件)
            const diffusion = SCFEngine.SC7_analyzeRiskDiffusion('SCF-S001', { description: '供应商经营异常', severity: 0.8 });
            this.logSCF('SC7', `风险扩散分析: SCF-S001 → 影响 ${diffusion.impacted ? diffusion.impacted.length : 0} 个关联节点 · 预警级别 ${diffusion.level}`);
            this._notify();
          }
        }, 500);
      },
      'scf_distributor': () => {
        // 经销商预付款: E001 宏达精密 + 经销商: SCF-D001 北方机电 → 预付款融资
        this.switchEnterprise('E001');
        this.setSCFAnchor('E001');
        this.setSCFPartner('SCF-D001');
        this.log('system', `  ┌─ 📦 [SCF·经销商预付款] 场景加载 (simulation-plan 第七章)`, 'scf');
        this.log('system', `  ├─ 核心企业: ${this.getAnchorEnterprise('E001').name}`, 'scf');
        this.log('system', `  ├─ 经销商: ${this.getSCFEnterprise('SCF-D001').name} (合作3年·信用660)`, 'scf');
        this.log('system', `  ├─ 融资类型: 预付款融资 (advance_payment)`, 'scf');
        this.log('system', `  └─ 下一步: 在 Tab11 S6 产品路由查看匹配的预付款产品`, 'scf');
        // 执行 SC1 画像 + SC5 产品路由 (不跑全链路,仅展示匹配)
        setTimeout(() => {
          if (typeof SCFEngine !== 'undefined') {
            SCFEngine.SC1_buildProfile('SCF-D001');
            SCFEngine.SC1_buildGraph();
            this.updateSCFEngineStatus('SC1', 'completed', { profile: true, graph: true });
            this.logSCF('SC1', `经销商 SCF-D001 画像构建完成 · 13维评分已生成`);
            // 查找经销商相关贸易
            const distTrade = this.scfDatabase.trades.find(t => t.partnerId === 'SCF-D001');
            if (distTrade) {
              const matches = SCFEngine.SC5_matchProducts(distTrade.id, 'SCF-D001');
              this.updateSCFEngineStatus('SC5', 'completed', matches);
              this.logSCF('SC5', `产品路由: 匹配 ${matches.length} 个产品 · 最优: ${matches[0] ? matches[0].productName : '无'}`);
            }
            this._notify();
          }
        }, 500);
      }
    };
    if (scenes[sceneId]) {
      scenes[sceneId]();
    }
    this._notify();
  },

  // ========================================
  //  AI 综合研判 — 结论性分析
  // ========================================
  generateAIConclusion() {
    console.group('%c[AI研判] 生成综合结论', 'color:#58a6ff;font-weight:bold;font-size:12px');

    const ops = this.aiOperations;
    const pendingApprovals = this.approvalQueue.filter(q => q.status === 'pending');
    const alertLogs = this.linkageLog.filter(l => l.type === 'alert');
    const enterprises = this.enterprises;

    // 1. 计算整体风险等级
    const avgCreditScore = enterprises.reduce((s, e) => s + e.runtime.creditScore, 0) / enterprises.length;
    const highRiskCount = enterprises.filter(e => e.runtime.creditScore < 600).length;
    let overallRiskLevel;
    if (avgCreditScore >= 700 && highRiskCount === 0) {
      overallRiskLevel = { level: '低风险', color: 'green', desc: '系统整体运行稳定，所有企业信用良好' };
    } else if (avgCreditScore >= 600) {
      overallRiskLevel = { level: '中风险', color: 'orange', desc: '部分企业存在信用风险，需关注' };
    } else {
      overallRiskLevel = { level: '高风险', color: 'red', desc: '系统存在较大风险敞口，需立即介入' };
    }
    console.log('1. 整体风险等级:', overallRiskLevel);

    // 2. 识别最需要关注的企业
    const riskSorted = [...enterprises].sort((a, b) => a.runtime.creditScore - b.runtime.creditScore);
    const focusEnterprises = [];
    riskSorted.forEach(e => {
      const issues = [];
      if (e.runtime.creditScore < 700) issues.push(`信用评分${e.runtime.creditScore}`);
      if (e.runtime.creditCompleteness < 0.66) issues.push(`数据维度${(e.runtime.creditCompleteness * 100).toFixed(0)}%`);
      if (e.runtime.fundFlowBlocked) issues.push('资金流冻结');
      const chainComplete = e.runtime.responsibilityChain.nodes.filter(n => n.status === 'confirmed').length;
      if (chainComplete < 6) issues.push(`责任链${chainComplete}/12`);
      if (issues.length > 0) {
        focusEnterprises.push({ name: e.name, issues, creditScore: e.runtime.creditScore });
      }
    });
    console.log('2. 关注企业:', focusEnterprises);

    // 3. 分析L1-L4分布健康度
    const levelCounts = { L1: 0, L2: 0, L3: 0, L4: 0 };
    ops.forEach(o => { if (o.level in levelCounts) levelCounts[o.level]++; });
    const totalOps = ops.length;
    const l1l2Ratio = totalOps > 0 ? (levelCounts.L1 + levelCounts.L2) / totalOps : 0;
    let distributionHealth;
    if (l1l2Ratio >= 0.7) {
      distributionHealth = { status: '健康', color: 'green', desc: 'AI自主化程度高，人工干预少' };
    } else if (l1l2Ratio >= 0.4) {
      distributionHealth = { status: '正常', color: 'blue', desc: 'AI与人工协作比例合理' };
    } else {
      distributionHealth = { status: '需改进', color: 'orange', desc: '人工审批占比过高，AI效能未充分发挥' };
    }
    console.log('3. 分布健康度:', distributionHealth, '比例:', (l1l2Ratio * 100).toFixed(1) + '%');

    // 4. 责任链完整度趋势
    const chainStats = enterprises.map(e => {
      const total = e.runtime.responsibilityChain.nodes.length;
      const confirmed = e.runtime.responsibilityChain.nodes.filter(n => n.status === 'confirmed').length;
      return { name: e.name, confirmed, total, rate: total > 0 ? confirmed / total : 0 };
    });
    const avgChainRate = chainStats.reduce((s, c) => s + c.rate, 0) / chainStats.length;
    let chainTrend;
    if (avgChainRate >= 0.7) {
      chainTrend = { status: '良好', color: 'green', desc: '责任链确认率高，管理风险可控' };
    } else if (avgChainRate >= 0.4) {
      chainTrend = { status: '待完善', color: 'orange', desc: '部分责任节点未确认，建议督促企业完善' };
    } else {
      chainTrend = { status: '严重', color: 'red', desc: '责任链大面积缺失，存在重大管理风险' };
    }
    console.log('4. 责任链趋势:', chainTrend, '平均确认率:', (avgChainRate * 100).toFixed(1) + '%');

    // 5. 生成建议动作
    const recommendations = [];
    if (pendingApprovals.length > 0) {
      recommendations.push({
        type: 'urgent',
        icon: '📋',
        text: `有${pendingApprovals.length}笔待审批工单，请及时处理`,
        action: 'switchTab|approval'
      });
    }
    if (alertLogs.length > 0) {
      recommendations.push({
        type: 'warning',
        icon: '🚨',
        text: `检测到${alertLogs.length}条告警日志，建议排查风险来源`,
        action: 'scrollToAlert'
      });
    }
    if (focusEnterprises.length > 0) {
      const worstEnt = focusEnterprises[0];
      recommendations.push({
        type: 'focus',
        icon: '🎯',
        text: `重点关注: ${worstEnt.name} (${worstEnt.issues.join(', ')})`,
        action: `switchEnterpriseByName|${worstEnt.name}`
      });
    }
    if (l1l2Ratio < 0.5 && totalOps > 0) {
      recommendations.push({
        type: 'optimize',
        icon: '🔧',
        text: 'AI自主度偏低，建议优化企业数据维度以提升AI信任度',
        action: 'switchTab|enterprise'
      });
    }
    if (avgChainRate < 0.5) {
      recommendations.push({
        type: 'warning',
        icon: '📝',
        text: '责任链确认率低，建议企业负责人完成关键节点确认',
        action: 'switchTab|enterprise'
      });
    }
    if (this.seasonalWindow === 'quarter_end') {
      recommendations.push({
        type: 'opportunity',
        icon: '📈',
        text: '当前处于季末冲量窗口，银行端利率优惠已激活，适合申请融资',
        action: 'switchTab|flow'
      });
    }
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'info',
        icon: '✅',
        text: '系统运行状态良好，暂无需要特别关注的事项',
        action: null
      });
    }
    console.log('5. 建议动作:', recommendations);

    const conclusion = {
      generatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      overallRiskLevel,
      focusEnterprises: focusEnterprises.slice(0, 3),
      distributionHealth,
      chainTrend,
      chainStats,
      recommendations,
      stats: {
        totalEnterprises: enterprises.length,
        totalAIOps: totalOps,
        pendingApprovals: pendingApprovals.length,
        alertLogs: alertLogs.length,
        avgCreditScore: Math.round(avgCreditScore),
        l1l2Ratio: (l1l2Ratio * 100).toFixed(1)
      }
    };

    console.log('结论生成完成:', conclusion);
    console.groupEnd();

    return conclusion;
  },

  // === 辅助方法 ===
  countOpenFlows(ent) {
    return Object.values(ent.dataFlows).filter(v => v).length;
  },

  formatAmount(amount) {
    if (amount >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
    if (amount >= 10000) return (amount / 10000).toFixed(0) + '万';
    return amount.toFixed(0) + '元';
  },

  getRateString(ent) {
    const base = 'LPR+1.5%';
    const adj = ent.runtime.rateDiscount;
    if (adj === 0) return base;
    return base + (adj > 0 ? `+${adj}%` : `${adj}%`);
  },

  getPolicyLabel(policy) {
    return { neutral: '中性', encourage: '鼓励', restrict: '限制' }[policy] || policy;
  },

  getModuleLabel(key) {
    return {
      fundMonitor: '资金监管',
      billService: '票据服务',
      arInsurance: '应收款保险',
      iotPerception: 'IoT感知',
      blockchainAnchor: '区块链存证',
      aiAutonomyMax: 'AI自主度上限'
    }[key] || key;
  },

  getModuleValueLabel(key, value) {
    if (key === 'fundMonitor') return { strong: '强监管', weak: '弱监管', none: '不监管' }[value] || value;
    if (key === 'aiAutonomyMax') return value;
    return value ? '启用' : '停用';
  },

  getMaxAmount(ent) {
    return Math.floor(ent.financials.accountBalance * ent.runtime.maxAmountMultiplier * 3);
  },

  // ========================================
  // v4.3 新增: 联动规则 4.11-4.15 (spec v2.0 三档分类 + 独立兜底引擎)
  // ========================================

  // === 辅助: 按 ID 查询 API / C 模块 / B 模块 ===
  getApiById(apiId) {
    return this.externalApis.find(a => a.id === apiId);
  },
  getCModuleById(cId) {
    return this.fallbackEngine.modules.find(m => m.id === cId);
  },
  getBModuleById(bId) {
    return this.selfDevelopedModules.find(m => m.id === bId);
  },

  // === 联动规则 4.11: 外部 API 状态变更 → 兜底子模块自动激活 (S1+S6 修正) ===
  handleApiStatusChange(apiId, newStatus, opts = {}) {
    const api = this.getApiById(apiId);
    if (!api) {
      console.info('[FallbackTrace][4.11] handleApiStatusChange SKIP - api not found:', apiId);
      return;
    }
    const oldStatus = api.status;
    if (oldStatus === newStatus) {
      console.info(`[FallbackTrace][4.11] handleApiStatusChange NOOP - ${apiId} 已是 ${newStatus} (跳过)`);
      return;
    }
    console.info(`[FallbackTrace][4.11] handleApiStatusChange ENTER - api=${apiId}(${api.name}) old=${oldStatus} → new=${newStatus} fallbackTo=${api.fallbackTo} circuitBefore=${api.circuitState}`);
    api.status = newStatus;

    // 新状态为断开 → 触发对应 C 兜底子模块激活
    if (newStatus === 'disconnected' && oldStatus === 'connected') {
      // 熔断器打开
      api.circuitState = 'open';
      api.lastLatencyMs = null;
      api.rateLimitCount = 0;
      console.info(`[FallbackTrace][4.11]   ├─ 熔断器 OPEN, latency=clear, rateLimit=reset (api=${apiId})`);

      const cId = api.fallbackTo;
      const cModule = this.getCModuleById(cId);
      console.info(`[FallbackTrace][4.11]   ├─ resolve C module: ${cId} → ${cModule ? `${cModule.name} (enabled=${cModule.enabled}, status=${cModule.status})` : 'NOT FOUND'}`);
      if (cModule && cModule.enabled && cModule.status !== 'active') {
        const beforeStatus = cModule.status;
        cModule.status = 'active';
        cModule.lastActivatedAt = new Date().toISOString();
        console.info(`[FallbackTrace][4.11]   ├─ ✅ C 模块激活: ${cId} ${cModule.name} (${beforeStatus} → active)`);
        // 兜底降级链升至 2 级 (C 兜底)
        const beforeLevel = this.fallbackEngine.fallbackChain.currentLevel;
        this.fallbackEngine.fallbackChain.currentLevel = Math.max(
          this.fallbackEngine.fallbackChain.currentLevel, 2
        );
        console.info(`[FallbackTrace][4.11]   ├─ 降级链升级: L${beforeLevel} → L${this.fallbackEngine.fallbackChain.currentLevel}`);
        this.fallbackEngine.fallbackChain.triggerEvents.push({
          at: new Date().toISOString(),
          apiId: api.id,
          cId: cModule.id,
          reason: 'api_disconnect'
        });
        // 输出"自营兜底"标注日志 (S5 修正)
        this.logFallbackActivation(api, cModule);
        // 全局告警横幅 (担保/保险类 → 橙色;其他 → toast)
        if (['C1', 'C2'].includes(cId)) {
          console.info(`[FallbackTrace][4.11]   ├─ 全局告警横幅 (orange) → 担保/保险类 C 模块 ${cId}`);
          this.addAlert(
            `fallback_${cId}`,
            `${cModule.name}已激活(自营兜底)`,
            `${api.name}接入失败,系统已切换至兜底运行`,
            'orange',
            { actionTab: 'fallback' }
          );
        } else {
          // 其他 C 模块 → Toast (非阻塞,由 view-fallback 渲染时检测)
          console.info(`[FallbackTrace][4.11]   ├─ Toast 通知 (非阻塞) → 非 C1/C2 模块 ${cId}`);
          this.log('system', `→ ${cModule.name} 激活(Toast通知已触发) → 查看 Tab8 兜底引擎控制台`, 'fallback');
        }
      } else if (cModule && cModule.status === 'active') {
        console.info(`[FallbackTrace][4.11]   ├─ SKIP 激活: ${cId} 已是 active (无需重复)`);
        this.log('system', `→ ${api.name} 断开,但 ${cModule.name} 已激活(无需重复)`, 'fallback');
      } else if (cModule && !cModule.enabled) {
        console.info(`[FallbackTrace][4.11]   ├─ SKIP 激活: ${cId} enabled=false (已禁用)`);
      }
    } else if (newStatus === 'connected' && oldStatus === 'disconnected') {
      // API 恢复 → 不自动关闭 C 模块(需人工确认避免抖动),只记录日志
      const beforeCircuit = api.circuitState;
      api.circuitState = 'closed';
      api.lastLatencyMs = 200 + Math.floor(Math.random() * 300);
      console.info(`[FallbackTrace][4.11]   ├─ 熔断器 ${beforeCircuit} → closed, latency=${api.lastLatencyMs}ms`);
      const cId = api.fallbackTo;
      const cModule = this.getCModuleById(cId);
      console.info(`[FallbackTrace][4.11]   ├─ 关联 C 模块 ${cId} ${cModule ? cModule.name : ''} 状态=${cModule ? cModule.status : 'N/A'} (保持,需人工关闭避免抖动)`);
      this.log('system', `→ ${api.name} 已恢复接入 (关联 ${cModule ? cModule.name : cId} 仍保持激活,需人工确认关闭避免抖动)`, 'fallback');
    } else {
      console.info(`[FallbackTrace][4.11]   ├─ 未匹配任何分支 (old=${oldStatus}, new=${newStatus})`);
    }

    console.info(`[FallbackTrace][4.11] EXIT - api=${apiId} status=${api.status} circuit=${api.circuitState} | activeC=${this.getActiveFallbackCount()}/7 connectedApi=${this.getConnectedApiCount()}/15 chainLevel=L${this.fallbackEngine.fallbackChain.currentLevel}`);
    if (!opts.skipNotify) {
      this._recomputeFallbackChainLevel();
      this._notify();
    }
  },

  // === 联动规则 4.11 内部: 输出兜底激活"自营兜底"标注日志 (S5 修正) ===
  logFallbackActivation(api, cModule) {
    this.log('system', `[兜底] ${api.name} 断开 → ${cModule.name} 自动激活`, 'fallback');
    this.log('system', `[兜底] → Spec 引用: ${cModule.specRef}`, 'fallback');
    this.log('system', `[兜底] → 报告标注: ⚠️ ${this.fallbackEngine.selfOperatedTag}`, 'fallback');
    this.log('system', `[兜底] → 服务能力: ${cModule.servicesProvided}`, 'fallback');
    this.log('system', `[兜底] → 能力边界: ${cModule.capabilityBounds}`, 'fallback');
  },

  // === 联动规则 4.12: 独立运行模式 → 全栈能力降级演示 (S3 修正) ===
  toggleIndependentMode(enabled, opts = {}) {
    const oldEnabled = this.fallbackEngine.independentMode.enabled;
    console.info(`[FallbackTrace][4.12] toggleIndependentMode ENTER - enabled=${enabled} oldEnabled=${oldEnabled} skipNotify=${!!opts.skipNotify}`);
    if (oldEnabled === enabled) {
      console.info(`[FallbackTrace][4.12]   ├─ NOOP - 已是 ${enabled} 状态 (跳过)`);
      return;
    }

    if (enabled) {
      // 保存 API 状态快照(供后续恢复)
      const beforeConnected = this.getConnectedApiCount();
      this._apiSnapshotBeforeIndependentMode = JSON.parse(JSON.stringify(this.externalApis));
      console.info(`[FallbackTrace][4.12]   ├─ 保存快照: 当前 ${beforeConnected}/15 connected → 快照已存`);
      // 强制所有 API 断开
      const apiBefore = this.externalApis.map(a => `${a.id}:${a.status}`).join(',');
      this.externalApis.forEach(api => {
        api.status = 'disconnected';
        api.circuitState = 'forced_off';
        api.lastLatencyMs = null;
        api.rateLimitCount = 0;
      });
      console.info(`[FallbackTrace][4.12]   ├─ 强制断开所有 API: before=[${apiBefore}] after=all disconnected/forced_off`);
      // C1-C7 全部激活
      const cBefore = this.fallbackEngine.modules.map(m => `${m.id}:${m.status}`).join(',');
      this.fallbackEngine.modules.forEach(m => {
        if (m.enabled) {
          m.status = 'active';
          m.lastActivatedAt = new Date().toISOString();
        }
      });
      const cAfter = this.fallbackEngine.modules.map(m => `${m.id}:${m.status}`).join(',');
      console.info(`[FallbackTrace][4.12]   ├─ C 模块全激活: before=[${cBefore}] after=[${cAfter}]`);
      // 兜底降级链升至 3 级 (独立运行)
      const beforeLevel = this.fallbackEngine.fallbackChain.currentLevel;
      this.fallbackEngine.fallbackChain.currentLevel = 3;
      console.info(`[FallbackTrace][4.12]   ├─ 降级链强制 L${beforeLevel} → L3`);
      this.fallbackEngine.independentMode.enabled = true;
      this.fallbackEngine.independentMode.activatedAt = new Date().toISOString();
      // 填充 degraded/available 服务清单
      this.fallbackEngine.independentMode.degradedServices = [...MockData.INDEPENDENT_MODE_CAPABILITIES.degradedServices];
      this.fallbackEngine.independentMode.availableServices = [...MockData.INDEPENDENT_MODE_CAPABILITIES.availableServices];
      console.info(`[FallbackTrace][4.12]   ├─ 服务清单: ${this.fallbackEngine.independentMode.degradedServices.length} 项降级 / ${this.fallbackEngine.independentMode.availableServices.length} 项可用`);

      // 全局告警横幅(紫色,高优先级)
      this.addAlert(
        'independent_mode',
        '独立运行模式已开启',
        `所有 15 个外部 API 已断开,C1-C7 兜底子模块全部激活;${MockData.INDEPENDENT_MODE_CAPABILITIES.degradedServices.length} 项服务降级,${MockData.INDEPENDENT_MODE_CAPABILITIES.availableServices.length} 项服务仍可提供`,
        'orange',
        { actionTab: 'fallback' }
      );
      console.info(`[FallbackTrace][4.12]   ├─ 全局告警横幅 (orange) 已添加 type=independent_mode`);

      // 联动日志输出 (4.12)
      this.log('system', `[独立运行] → 模式已开启: 所有外部 API 断开 + C1-C7 全部激活`, 'fallback');
      this.log('system', `[独立运行] → 兜底降级链升至 3 级 (独立运行)`, 'fallback');
      this.log('system', `[独立运行] → 所有兜底报告统一标注: ${this.fallbackEngine.selfOperatedTag}`, 'fallback');
    } else {
      console.info(`[FallbackTrace][4.12]   ├─ 关闭独立运行模式,恢复快照...`);
      // 恢复依赖模式: API 状态恢复到快照
      this.restoreApiStatesFromSnapshot();
      const afterConnected = this.getConnectedApiCount();
      console.info(`[FallbackTrace][4.12]   ├─ API 状态已从快照恢复: now ${afterConnected}/15 connected`);
      // C1-C7 全部 standby (除非有快照前已激活的,如默认 C3 active)
      const cBefore = this.fallbackEngine.modules.map(m => `${m.id}:${m.status}`).join(',');
      this.fallbackEngine.modules.forEach(m => {
        m.status = 'standby';
        m.lastActivatedAt = null;
      });
      // 重新计算默认状态 (C3 默认 active 因 API-06 默认断开)
      const api06 = this.getApiById('API-06');
      if (api06 && api06.status === 'disconnected') {
        const c3 = this.getCModuleById('C3');
        if (c3) { c3.status = 'active'; c3.lastActivatedAt = new Date().toISOString(); }
        console.info(`[FallbackTrace][4.12]   ├─ 默认恢复 C3=active (因 API-06 默认 disconnected)`);
      }
      const cAfter = this.fallbackEngine.modules.map(m => `${m.id}:${m.status}`).join(',');
      console.info(`[FallbackTrace][4.12]   ├─ C 模块重置: before=[${cBefore}] after=[${cAfter}]`);
      this.fallbackEngine.independentMode.enabled = false;
      this.fallbackEngine.independentMode.activatedAt = null;
      this.fallbackEngine.independentMode.degradedServices = [];
      this.fallbackEngine.independentMode.availableServices = [];
      // 清除独立运行告警
      this.clearAlerts(a => a.type === 'independent_mode');
      console.info(`[FallbackTrace][4.12]   ├─ 已清除 independent_mode 类型告警`);
      this._recomputeFallbackChainLevel();
      this.log('system', `[独立运行] → 模式已关闭: API 状态恢复至快照 + C1-C7 重置为默认`, 'fallback');
    }

    console.info(`[FallbackTrace][4.12] EXIT - independentMode=${this.fallbackEngine.independentMode.enabled} | activeC=${this.getActiveFallbackCount()}/7 connectedApi=${this.getConnectedApiCount()}/15 chainLevel=L${this.fallbackEngine.fallbackChain.currentLevel} alerts=${this.activeAlerts.length}`);
    if (!opts.skipNotify) this._notify();
  },

  // === 独立运行模式恢复: 从快照恢复 API 状态 ===
  restoreApiStatesFromSnapshot() {
    if (!this._apiSnapshotBeforeIndependentMode) {
      // 无快照则恢复到 MockData 默认
      console.info(`[FallbackTrace][Restore] 无快照 → 恢复到 MockData.EXTERNAL_APIS 默认`);
      this.externalApis = JSON.parse(JSON.stringify(MockData.EXTERNAL_APIS));
    } else {
      const snapCount = this._apiSnapshotBeforeIndependentMode.length;
      console.info(`[FallbackTrace][Restore] 从快照恢复 ${snapCount} 个 API 状态 → 覆盖 externalApis`);
      this.externalApis = JSON.parse(JSON.stringify(this._apiSnapshotBeforeIndependentMode));
      this._apiSnapshotBeforeIndependentMode = null;
    }
  },

  // === 联动规则 4.13: B1-B12 自研模块能力演示卡片 (S2 修正) ===
  selectBModule(bId) {
    const bModule = this.getBModuleById(bId);
    if (!bModule) return;
    this.log('system', `[自研] 用户点击 ${bId} 模块卡片`, 'fallback');
    this.log('system', `[自研] → ${bId} ${bModule.name}`, 'fallback');
    this.log('system', `[自研] → Spec 引用: ${bModule.specRef}`, 'fallback');
    this.log('system', `[自研] → 关键指标: ${bModule.keyMetric}`, 'fallback');
    this.log('system', `[自研] → 护城河说明: ${bModule.moatSummary}`, 'fallback');
    this.log('system', `[自研] → 体现位置: ${bModule.embodiedIn}`, 'fallback');
    // 标记当前选中的 B 模块(view-fallback 据此渲染详情侧栏)
    this._selectedBModuleId = bId;
    this._notify();
  },

  // === 联动规则 4.14: 兜底报告"自营兜底"标注 + 能力边界明示 (S5 修正) ===
  generateFallbackReport(cId) {
    const cModule = this.getCModuleById(cId);
    if (!cModule) return null;
    const api = this.getApiById(cModule.relatedApi);
    const report = {
      reportId: 'FB-RPT-' + Date.now().toString(36).toUpperCase(),
      generatedAt: new Date().toISOString(),
      cModule: { ...cModule },
      relatedApi: api ? { id: api.id, name: api.name, status: api.status } : null,
      tag: this.fallbackEngine.selfOperatedTag,
      capabilities: cModule.servicesProvided,
      bounds: cModule.capabilityBounds,
      suggestion: api ? `若需完整能力,请推动 ${api.id} ${api.name} 接入` : '建议推动对应外部机构接入'
    };
    this.log('system', `[兜底] ${cModule.name} 生成兜底报告 ${report.reportId}`, 'fallback');
    this.log('system', `[兜底] → 报告标注: ⚠️ ${report.tag}`, 'fallback');
    this.log('system', `[兜底] → 服务能力: ${report.capabilities}`, 'fallback');
    this.log('system', `[兜底] → 能力边界: ${report.bounds}`, 'fallback');
    this.log('system', `[兜底] → 建议: ${report.suggestion}`, 'fallback');
    return report;
  },

  // === 联动规则 4.15: 三档开发投入占比仪表盘联动 (S4+S7 修正) ===
  setTierDashboardMode(mode) {
    // mode: 'modules' | 'hours' | 'percentage'
    this._tierDashboardMode = mode;
    const ti = this.tierInvestment;
    this.log('system', `[投入] 切换仪表盘维度: 按${mode === 'modules' ? '模块数' : mode === 'hours' ? '工时' : '百分比'}`, 'fallback');
    this.log('system', `[投入] → ${ti.apiAccess.label}: ${mode === 'modules' ? ti.apiAccess.modules + ' 模块' : mode === 'hours' ? ti.apiAccess.hours + ' 工时' : ti.apiAccess.percentage + '%'} (${ti.apiAccess.percentage}%) — ${ti.apiAccess.desc}`, 'fallback');
    this.log('system', `[投入] → ${ti.selfDeveloped.label}: ${mode === 'modules' ? ti.selfDeveloped.modules + ' 模块' : mode === 'hours' ? ti.selfDeveloped.hours + ' 工时' : ti.selfDeveloped.percentage + '%'} (${ti.selfDeveloped.percentage}%) — ${ti.selfDeveloped.desc}`, 'fallback');
    this.log('system', `[投入] → ${ti.fallback.label}: ${mode === 'modules' ? ti.fallback.modules + ' 模块' : mode === 'hours' ? ti.fallback.hours + ' 工时' : ti.fallback.percentage + '%'} (${ti.fallback.percentage}%) — ${ti.fallback.desc}`, 'fallback');
    this.log('system', `[投入] → 设计哲学: 不重复造轮子(API档),也不放弃独立运行能力(兜底档),把精力集中在独有创新(自研档)`, 'fallback');
    this._notify();
  },

  // === 兜底子模块手动激活/休眠 ===
  activateFallbackModule(cId) {
    const cModule = this.getCModuleById(cId);
    if (!cModule || !cModule.enabled) {
      console.info(`[FallbackTrace][Manual] activateFallbackModule SKIP - ${cId} not found or disabled`);
      return;
    }
    const before = cModule.status;
    cModule.status = 'active';
    cModule.lastActivatedAt = new Date().toISOString();
    console.info(`[FallbackTrace][Manual] activateFallbackModule ${cId} ${cModule.name}: ${before} → active`);
    this._recomputeFallbackChainLevel();
    this.log('system', `[兜底] 手动激活 ${cId} ${cModule.name} → 降级链 ${this.fallbackEngine.fallbackChain.currentLevel} 级`, 'fallback');
    this._notify();
  },
  deactivateFallbackModule(cId) {
    const cModule = this.getCModuleById(cId);
    if (!cModule) {
      console.info(`[FallbackTrace][Manual] deactivateFallbackModule SKIP - ${cId} not found`);
      return;
    }
    const before = cModule.status;
    cModule.status = 'standby';
    cModule.lastActivatedAt = null;
    console.info(`[FallbackTrace][Manual] deactivateFallbackModule ${cId} ${cModule.name}: ${before} → standby`);
    this._recomputeFallbackChainLevel();
    this.log('system', `[兜底] 手动休眠 ${cId} ${cModule.name} → 降级链 ${this.fallbackEngine.fallbackChain.currentLevel} 级`, 'fallback');
    this._notify();
  },

  // === v4.3 边缘案例: 一键全断外部 API ===
  simulateAllApisDisconnect() {
    console.info(`[FallbackTrace][Edge] simulateAllApisDisconnect ENTER - before: ${this.getConnectedApiCount()}/15 connected, ${this.getActiveFallbackCount()}/7 active`);
    this.log('system', `[边缘] 一键全断外部 API (15个)`, 'fallback');
    const disconnected = this.externalApis.filter(a => a.status === 'connected');
    console.info(`[FallbackTrace][Edge]   ├─ 找到 ${disconnected.length} 个 connected API 待断开`);
    disconnected.forEach(api => {
      this.handleApiStatusChange(api.id, 'disconnected', { skipNotify: true });
    });
    this._recomputeFallbackChainLevel();
    console.info(`[FallbackTrace][Edge] EXIT - after: ${this.getConnectedApiCount()}/15 connected, ${this.getActiveFallbackCount()}/7 active, chainLevel=L${this.fallbackEngine.fallbackChain.currentLevel}`);
    this._notify();
  },

  // === v4.3 边缘案例: 恢复全部外部 API ===
  simulateAllApisRecover() {
    console.info(`[FallbackTrace][Edge] simulateAllApisRecover ENTER - before: ${this.getConnectedApiCount()}/15 connected, ${this.getActiveFallbackCount()}/7 active`);
    this.log('system', `[边缘] 恢复全部外部 API (15个)`, 'fallback');
    const toRecover = this.externalApis.filter(a => a.status === 'disconnected' && a.circuitState !== 'forced_off');
    console.info(`[FallbackTrace][Edge]   ├─ 找到 ${toRecover.length} 个 disconnected 非 forced_off API 待恢复 (跳过 forced_off)`);
    toRecover.forEach(api => {
      this.handleApiStatusChange(api.id, 'connected', { skipNotify: true });
    });
    this._recomputeFallbackChainLevel();
    console.info(`[FallbackTrace][Edge] EXIT - after: ${this.getConnectedApiCount()}/15 connected, ${this.getActiveFallbackCount()}/7 active, chainLevel=L${this.fallbackEngine.fallbackChain.currentLevel}`);
    this._notify();
  },

  // === v4.3 边缘案例: 模拟限流风暴 ===
  simulateApiRateLimitStorm() {
    this.log('system', `[边缘] 模拟限流风暴 → 所有 connected API rateLimitCount 飙升至 80+/100`, 'fallback');
    this.externalApis.forEach(api => {
      if (api.status === 'connected') {
        api.rateLimitCount = 80 + Math.floor(Math.random() * 20);
        // 部分熔断器进入半开状态
        if (api.rateLimitCount >= 90) {
          api.circuitState = 'half_open';
          this.log('system', `→ ${api.id} ${api.name} 熔断器进入半开状态 (rateLimit=${api.rateLimitCount}/100)`, 'fallback');
        }
      }
    });
    this._notify();
  },

  // === v4.3 边缘案例: 单独断开某 API ===
  disconnectApi(apiId) {
    this.handleApiStatusChange(apiId, 'disconnected');
  },
  // === v4.3 边缘案例: 单独恢复某 API ===
  reconnectApi(apiId) {
    this.handleApiStatusChange(apiId, 'connected');
  },

  // === v4.3 辅助: 获取当前已激活 C 模块数 ===
  getActiveFallbackCount() {
    return this.fallbackEngine.modules.filter(m => m.status === 'active').length;
  },
  // === v4.3 辅助: 获取当前已接入 API 数 ===
  getConnectedApiCount() {
    return this.externalApis.filter(a => a.status === 'connected').length;
  },

  // ==============================================================
  // v5.0 新增: 联动规则 5.1-5.5 (simulation-plan.md v5.0 Tab0 改造工作台)
  // ==============================================================

  // === 联动规则 5.1: 切换企业 → Tab0 改造引擎自动加载该企业画像 + 重算 8 维评分卡 ===
  // P0 优先级: 在 switchEnterprise() 末尾自动调用, 用户无需手动触发
  _linkage5_1_reformRefreshEnterprise(ent) {
    const re = this.reformEngine;
    re.currentEnterpriseId = ent.id;
    // ===== 修复 BP-02 Tab1 融资入口切换问题: 不再无条件置 idle, 根据企业 hasReformed / financingUnlocked 恢复状态 =====
    const alreadyReformed = (ent.reform && ent.reform.hasReformed) || (ent.runtime && ent.runtime.financingUnlocked === true);
    if (alreadyReformed) {
      re.status = 'completed';
      re.progress = 1;
      // 如果有 afterScorecard 则 current 用改造后的值, 否则维持 before
      if (ent.reform && ent.reform.afterScorecard) {
        re.scorecard.current = { ...ent.reform.afterScorecard };
      } else {
        this._refreshReformScorecardFromEnterprise();
      }
      re.currentLevel = (ent.reform && ent.reform.afterLevel) || ent.runtime.creditGradeCap || this._computeReformLevel(re.scorecard.current);
      // 如果还没解锁, 这里补锁
      if (!ent.runtime.financingUnlocked) ent.runtime.financingUnlocked = true;
      // 完成任务数 = DAG 总数 (已全部完成)
      re.completedTasks = re.totalTasks = (ent.reform && ent.reform.completedActions && ent.reform.completedActions.length) ? ent.reform.completedActions.length : 0;
      re.completedActions = ent.reform && ent.reform.completedActions ? [...ent.reform.completedActions] : [];
      // 改造后的等级同步到 creditGradeCap
      if (re.currentLevel && !ent.runtime.creditGradeCapReformed) {
        ent.runtime.creditGradeCap = re.currentLevel;
        ent.runtime.creditGradeCapReformed = true;
      }
    } else {
      re.status = 'idle';
      re.progress = 0;
      re.totalTasks = 0;
      re.completedTasks = 0;
      // 未改造: 用 beforeScorecard (若有) 或 从企业数据刷新 current
      if (ent.reform && ent.reform.beforeScorecard) {
        re.scorecard.current = { ...ent.reform.beforeScorecard };
      } else {
        this._refreshReformScorecardFromEnterprise();
      }
      re.currentLevel = (ent.reform && ent.reform.beforeLevel) || this._computeReformLevel(re.scorecard.current);
      re.completedActions = ent.reform && ent.reform.completedActions ? [...ent.reform.completedActions] : [];
    }
    re.gapReport = null;
    re.reformPlans = [];
    re.selectedPlanId = null;
    re.taskDAG = [];
    // 重算 8 维评分卡 (兜底)
    if (!re.scorecard.current || Object.keys(re.scorecard.current).length < 8) {
      this._refreshReformScorecardFromEnterprise();
      re.currentLevel = this._computeReformLevel(re.scorecard.current);
    }
    const beforeLevel = re.currentLevel;
    // 保存改造前快照 (如果是新企业, before 初始化为当前值)
    re.scorecard.before = { ...re.scorecard.current };
    // 根据风险等级重设目标等级
    const levelMap = { premium: 'A', normal: 'B+', high_risk: 'B-' };
    re.targetLevel = levelMap[ent.riskProfile] || 'B';
    // R10 重新检索相似案例
    if (typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR10 === 'function') {
      re.similarCases = ReformEngine.runR10(ent);
    } else {
      re.similarCases = MockData.REFORM_CASES ? MockData.REFORM_CASES.slice(0, 3) : [];
    }
    console.info(`[ReformTrace][5.1] 企业切换: ${ent.name} | 已改造: ${alreadyReformed} | 等级: ${beforeLevel} → ${re.currentLevel} | 目标: ${re.targetLevel} | 已完成动作: ${re.completedActions.length} | status: ${re.status}`);
    this.log('reform', `[联动5.1] 切换企业 → 加载 ${ent.name} 改造画像 (已改造:${alreadyReformed?'是':'否'} | ${re.currentLevel}级 → 目标${re.targetLevel}级, ${re.completedActions.length}项历史动作)`, 'reform');
  },

  // === 联动规则 5.2: 激进程度切换 → 合规边界(R7)重算 + 方案集(R3)立即重生成 ===
  // 用户点击 Tab0 的保守/平衡/创新 pill 按钮触发
  setReformAggressiveness(level) {
    if (!MockData.AGGRESSIVENESS_LEVELS[level]) {
      console.warn('[ReformTrace][5.2] 非法激进程度:', level);
      return;
    }
    const re = this.reformEngine;
    const before = re.aggressiveness;
    re.aggressiveness = level;
    const aggCfg = MockData.AGGRESSIVENESS_LEVELS[level];
    // 如果已有方案集,则 R3 立即重生成 (因为激进程度直接影响可选方案空间)
    if (re.reformPlans && re.reformPlans.length > 0 && typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR3 === 'function') {
      re.reformPlans = ReformEngine.runR3(re.gapReport, {
        aggressiveness: level,
        autonomyLevel: re.autonomyLevel,
        targetLevel: re.targetLevel
      });
      re.selectedPlanId = re.reformPlans[0] ? re.reformPlans[0].id : null;
      re.estimation = this._computeReformEstimation(re.selectedPlanId ? re.reformPlans.find(p => p.id === re.selectedPlanId) : null);
    }
    // R7 合规引擎立即刷新运行状态 (边界变化需明确记录)
    const R7 = re.engineStatus.R7;
    R7.status = 'refreshed';
    R7.lastRunAt = new Date().toISOString();
    R7.result = { boundarySet: level, bounds: aggCfg.bounds };
    console.info(`[ReformTrace][5.2] 激进程度: ${before} → ${level} | 合规边界: ${aggCfg.bounds} | 方案重生成: ${re.reformPlans.length > 0 ? 'Y' : 'N(无方案,后续诊断后生成)'}`);
    this.log('reform', `[联动5.2] 激进程度: ${before} → ${level} (${aggCfg.icon} ${aggCfg.name})`, 'reform');
    this.log('reform', `→ 合规边界(R7): ${aggCfg.bounds}`, 'reform');
    if (re.reformPlans.length > 0) {
      this.log('reform', `→ R3 方案集已按新激进程度重生成 (${re.reformPlans.length}条)`, 'reform');
    }
    this._notify();
  },

  // === 联动规则 5.3: 改造进度推进 → 信用分/融资能力(额度/利率/确权等级)实时更新 ===
  // 每次 ReformEngine 完成一个改造动作后,由引擎回调此方法
  advanceReformTask(actionResult) {
    const re = this.reformEngine;
    const ent = this.currentEnterprise;
    // 1. 记录已完成动作
    re.completedActions.push({
      dim: actionResult.dim,
      action: actionResult.action,
      completedAt: new Date().toISOString().slice(0, 10),
      creditGain: actionResult.creditGain || 0
    });
    // 2. 更新 8 维评分卡 (单维提升 = actionResult.dimScoreDelta)
    const sc = re.scorecard.current;
    if (actionResult.dim && actionResult.dimScoreDelta) {
      sc[actionResult.dim] = Math.min(100, (sc[actionResult.dim] || 0) + actionResult.dimScoreDelta);
    }
    // 3. 重算当前等级
    const beforeLevel = re.currentLevel;
    re.currentLevel = this._computeReformLevel(sc);
    // 4. 进度计算
    re.completedTasks += 1;
    re.progress = re.totalTasks > 0 ? Math.min(1, re.completedTasks / re.totalTasks) : 0;
    // 5. 信用分 + 融资能力实时联动 (P0)
    const prevScore = ent.runtime.creditScore;
    if (actionResult.creditGain) {
      ent.runtime.creditScore = Math.min(850, prevScore + actionResult.creditGain);
    }
    // 6. 重算信用完整度 + 融资条件
    this.recalcCreditCompleteness(ent);
    // 7. R9 银行匹配实时刷新
    if (typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR9 === 'function') {
      re.bankMatches = ReformEngine.runR9(ent, { currentLevel: re.currentLevel, scorecard: sc });
    }
    // 8. 若完成全部任务 → 状态置 completed + 解锁 Tab1 融资入口 (spec 联动 5.3)
    if (re.completedTasks >= re.totalTasks && re.totalTasks > 0) {
      re.status = 'completed';
      // spec 要求: creditGradeCap = postReformCreditGradeCap (D → A) + financingUnlocked = true
      ent.runtime.financingUnlocked = true;
      ent.runtime.creditGradeCap = re.currentLevel;
      ent.runtime.creditGradeCapReformed = true;
      if (ent.runtime.postReformCreditScore && ent.runtime.creditScore < ent.runtime.postReformCreditScore) {
        ent.runtime.creditScore = ent.runtime.postReformCreditScore;
      }
      // ===== 持久化回 ent.reform, 确保企业切换后不丢失 hasReformed 状态 =====
      if (!ent.reform) ent.reform = { beforeScorecard: re.scorecard.before, completedActions: [] };
      ent.reform.hasReformed = true;
      ent.reform.reformedAt = new Date().toISOString();
      ent.reform.afterLevel = re.currentLevel;
      ent.reform.afterScorecard = { ...re.scorecard.current };
      ent.reform.completedActions = [...re.completedActions];
      this.log('reform', `🎉 [联动5.3] 改造全部完成! ${re.currentLevel}级 (进度 100%) → Tab1 融资入口已解锁 (financingUnlocked=true, creditGradeCap=${ent.runtime.creditGradeCap})`, 'reform');
      // 立即触发 5.4 银行匹配 (单步推进路径下也需要触发, 不只 pipelineAutoExecute)
      this._linkage5_4_autoBankMatch(ent);
    }
    console.info(`[ReformTrace][5.3] 改造动作完成: dim=${actionResult.dim} creditGain=${actionResult.creditGain} | 进度: ${re.completedTasks}/${re.totalTasks} (${(re.progress*100).toFixed(0)}%) | 等级: ${beforeLevel} → ${re.currentLevel} | 信用分: ${prevScore} → ${ent.runtime.creditScore}`);
    this.log('reform', `[联动5.3] 改造推进: 完成「${actionResult.action}」(+${actionResult.creditGain || 0}信用分)`, 'reform');
    this.log('reform', `→ 进度: ${re.completedTasks}/${re.totalTasks} (${(re.progress*100).toFixed(0)}%) | 等级: ${beforeLevel} → ${re.currentLevel}`, 'reform');
    this.log('reform', `→ 融资能力联动: 信用分 ${prevScore} → ${ent.runtime.creditScore} (上限850)`, 'reform');
    this._notify();
  },

  // === 联动规则 5.4: 改造完成 (status=completed) → 自动触发 R9 银行匹配 + 引导去 Tab1 配置后再去 Tab2 发起融资 ===
  // 由 advanceReformTask 检测到进度 100% 后在末尾调用
  _linkage5_4_autoBankMatch(ent) {
    const re = this.reformEngine;
    if (re.status !== 'completed') return;
    // R9 银行匹配
    if (typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR9 === 'function') {
      re.bankMatches = ReformEngine.runR9(ent, { currentLevel: re.currentLevel, scorecard: re.scorecard.current });
    } else {
      // 简化版回退: 直接基于银行 BIDS 逻辑生成
      re.bankMatches = this.banks.map(b => ({
        bankId: b.id, bankName: b.name,
        preApproval: true,
        amount: Math.min(b.maxAmount, State.getMaxAmount(ent)),
        rate: (b.baseRateValue + ent.runtime.rateDiscount).toFixed(2) + '%',
        probability: Math.round(75 + Math.random() * 20)
      }));
    }
    console.info(`[ReformTrace][5.4] 改造完成 → R9 银行匹配生成 ${re.bankMatches.length} 家银行, 最佳银行: ${re.bankMatches[0] ? re.bankMatches[0].bankName : '-'}`);
    // 业务流程: 改造完成 → Tab1 配置合作模式/数据可见性/责任链 → Tab2 发起融资 (不能跳过 Tab1)
    this.log('reform', `[联动5.4] 改造完成 → R9 银行匹配完成 (${re.bankMatches.length}家, 最佳 ${re.bankMatches[0] ? re.bankMatches[0].bankName : '-'}), 建议先去Tab1配置合作模式/数据可见性, 再去Tab2发起融资`, 'reform');
    // 非阻塞 Toast 提示: 先去 Tab1 配置并查看融资能力, 不要直接跳 Tab2
    if (typeof AIModal !== 'undefined') {
      AIModal.toast({
        type: 'reformDone',
        title: `🎉 企业改造完成 · ${ent.name}`,
        text: `等级 ${re.currentLevel} 级已达成! 已匹配 ${re.bankMatches.length} 家银行. 请先去 Tab1 配置合作模式/数据可见范围/责任链, 再去 Tab2 发起融资申请.`,
        color: 'green',
        duration_ms: 10000,
        actionLabel: '→ 去Tab1配置并查看融资能力',
        onAction: () => { if (typeof App !== 'undefined') App.switchTab('enterprise'); }
      });
    }
  },

  // === 联动规则 5.5: R7 合规红线/灰区/自主度边界 → 推送 Tab3 人工审批 =====
  // spec 要求: 绝对红线任务 blocked, 灰区/L2+requiresLegal 必须推送 Tab3 人工审核队列
  pushReformLegalReviewToApproval({ level, task, executor, autonomy, legalCheck, summary }) {
    const ent = this.currentEnterprise;
    if (!ent || !task) return null;
    const severityLabel = level === 'red' ? '🔴 红线阻断' : level === 'gray' ? '🟡 灰区复核' : '🔵 自主度边界';
    // 构造与融资审批兼容的工单格式,同时带 reform 标识便于 Tab3 识别
    const aqId = 'AQ_REFORM_' + task.id + '_' + Date.now();
    const req = {
      id: aqId,
      type: 'reform_legal',   // 标识: 改造合规审查 (区别于融资审批)
      enterpriseId: ent.id,
      enterpriseName: ent.name,
      amount: task.cost || 0,  // 审批关注项: 该改造任务的成本
      routeLevel: level === 'red' ? 'L4' : 'L3', // 红线必须 L4
      riskScore: level === 'red' ? 920 : level === 'gray' ? 650 : 520,
      creditGrade: ent.runtime.creditGradeCap,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      status: 'pending',
      aiSuggestion: level === 'red' ? '建议否决(触碰合规红线)' : '建议复核(灰区/L2边界)',
      aiConfidence: level === 'red' ? 99 : level === 'gray' ? 68 : 72,
      // ===== reform 专属字段 (Tab3 展示用) =====
      reform: {
        severityLevel: level,          // red / gray / legal_boundary
        severityLabel,
        taskId: task.id,
        taskLabel: task.label,
        taskDim: task.dim,
        executorName: executor ? `${executor.id} ${executor.name}` : task.executor,
        currentAutonomy: autonomy,
        summary,
        findings: legalCheck ? legalCheck.findings : [],
        // 审批回调: 通过后把 task.status 设为 done 并推进进度, 否决定为 failed
        onApprove: () => {
          const t = (this.reformEngine.taskDAG || []).find(x => x.id === task.id);
          if (!t) return;
          t.status = 'done';
          t.result = { success:true, approvedAt: new Date().toISOString(), manually: true, outputDocument: `${task.id}_MANUAL_APPROVAL.pdf`, creditGain: task.creditGain, dimScoreDelta: task.dimScoreDelta, hours: task.hours, cost: task.cost };
          this.advanceReformTask({ dim: t.dim, action: `[Tab3 人工通过] ${t.label}`, creditGain: t.creditGain, dimScoreDelta: t.dimScoreDelta });
          this.log('reform', `✅ [联动5.5] Tab3 人工审批通过 → 任务 ${task.id} 直接标记完成并推进进度`, 'reform');
        },
        onReject: (reason) => {
          const t = (this.reformEngine.taskDAG || []).find(x => x.id === task.id);
          if (!t) return;
          t.status = 'failed';
          t.result = { success:false, rejectedAt: new Date().toISOString(), reason: `Tab3 人工否决: ${reason || '不符合合规要求'}` };
          // 触发 R6 动态重规划
          if (typeof ReformEngine !== 'undefined' && typeof ReformEngine.runR6_onFailure === 'function') {
            ReformEngine.runR6_onFailure(t);
          }
          this.log('reform', `❌ [联动5.5] Tab3 人工否决 → 任务 ${task.id} 标记失败并触发 R6 重排`, 'reform');
        }
      }
    };
    this.approvalQueue.push(req);
    // 与融资审批保持一致: 自动弹审批 Modal
    if (typeof this._enqueueApprovalModal === 'function') {
      this._enqueueApprovalModal(aqId);
    }
    this.log('reform', `🔔 [联动5.5] 推送 Tab3 合规审查工单 ${aqId} (${severityLabel}) ${summary || ''}`, 'reform');
    console.info(`[ReformTrace][5.5] ${severityLabel} 任务 ${task.id} → approvalQueue 推送成功, 工单号: ${aqId}, Tab3 应即时可见`);
    this._notify();
    return req;
  },

  // === 联动规则 5.5: 自主度等级切换 (L2/L3/L4) → R5 执行引擎家族动作边界更新 ===
  setReformAutonomyLevel(level) {
    if (!MockData.REFORM_AUTONOMY_LEVELS[level]) return;
    const re = this.reformEngine;
    const before = re.autonomyLevel;
    re.autonomyLevel = level;
    const levelCfg = MockData.REFORM_AUTONOMY_LEVELS[level];
    // R5 执行引擎家族状态刷新
    const R5 = re.engineStatus.R5;
    R5.status = 'boundary_updated';
    R5.lastRunAt = new Date().toISOString();
    R5.result = { autonomy: level, bounds: levelCfg.bounds };
    console.info(`[ReformTrace][5.5] 自主度: ${before} → ${level} | 执行边界: ${levelCfg.bounds}`);
    this.log('reform', `[联动5.5] 自主度等级: ${before} → ${level} (${levelCfg.name})`, 'reform');
    this.log('reform', `→ R5 执行引擎家族边界: ${levelCfg.bounds}`, 'reform');
    this._notify();
  },

  // === v5.0 辅助: 计算改造预估(成本/周期/信用分增益) ===
  _computeReformEstimation(plan) {
    if (!plan) return { totalCost: 0, totalDays: 0, creditGain: 0 };
    const aggCfg = MockData.AGGRESSIVENESS_LEVELS[this.reformEngine.aggressiveness] || MockData.AGGRESSIVENESS_LEVELS.balanced;
    return {
      totalCost: Math.round((plan.estBaseCost || 200000) * aggCfg.costMultiplier),
      totalDays: Math.round((plan.estBaseDays || 75) * (aggCfg.avgTimelineDays / 60)),
      creditGain: plan.estCreditGain || 120
    };
  },

  // === v5.0 公共 API: 保存改造前快照 (点击"开始改造"按钮时调用) ===
  saveReformBeforeSnapshot() {
    const re = this.reformEngine;
    re.scorecard.before = { ...re.scorecard.current };
    this.log('reform', `📸 已保存改造前快照 (8维评分卡)`, 'reform');
  },

  // === v5.0 公共 API: 设定改造目标等级 (用户在 Tab0 下拉选择) ===
  setReformTargetLevel(level) {
    const valid = ['D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
    if (!valid.includes(level)) return;
    this.reformEngine.targetLevel = level;
    this.log('reform', `→ 改造目标等级: ${level}`, 'reform');
    this._notify();
  },

  // ============================================================
  // v6.0 SCF 子系统公共 API
  // ============================================================

  // === SCF 数据库初始化 ===
  _initSCFDatabase() {
    // 1. 优先从 localStorage 恢复
    try {
      const saved = localStorage.getItem(this.scfEngine.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 合并恢复的数据 (保留引擎状态, 仅恢复数据)
        this.scfDatabase.enterprises = parsed.enterprises || [];
        this.scfDatabase.products = parsed.products || [];
        this.scfDatabase.institutions = parsed.institutions || [];
        this.scfDatabase.relationships = parsed.relationships || [];
        this.scfDatabase.trades = parsed.trades || [];
        this.scfDatabase.blacklist = parsed.blacklist || [];
        this.scfDatabase.whitelist = parsed.whitelist || [];
        this.scfDatabase.cases = parsed.cases || [];
        this.scfDatabase.financingRequests = parsed.financingRequests || [];
        this.scfDatabase.loans = parsed.loans || [];
        this.scfDatabase.repayments = parsed.repayments || [];
        this.scfDatabase.riskEvents = parsed.riskEvents || [];
        this.scfDatabase.creditPropagation = parsed.creditPropagation || [];
        this.scfDatabase.performanceRecords = parsed.performanceRecords || [];
        this.log('system', `📦 SCF 数据库从 localStorage 恢复: ${this.scfDatabase.enterprises.length}家企业 / ${this.scfDatabase.trades.length}条贸易`, 'config');
        return;
      }
    } catch (e) {
      console.warn('[SCF] localStorage 恢复失败, 使用初始 Mock 数据:', e);
    }
    // 2. 从 SCFData 加载初始 Mock 数据
    this._loadSCFFromMock();
  },

  _loadSCFFromMock() {
    if (typeof SCFData === 'undefined') {
      console.warn('[SCF] SCFData 未加载, scf-data.js 可能未引入');
      return;
    }
    // 深拷贝避免污染源数据
    this.scfDatabase.enterprises = JSON.parse(JSON.stringify(SCFData.SCF_ENTERPRISES));
    this.scfDatabase.products = JSON.parse(JSON.stringify(SCFData.SCF_PRODUCTS));
    this.scfDatabase.institutions = JSON.parse(JSON.stringify(SCFData.SCF_INSTITUTIONS));
    this.scfDatabase.relationships = JSON.parse(JSON.stringify(SCFData.SCF_RELATIONSHIPS));
    this.scfDatabase.trades = JSON.parse(JSON.stringify(SCFData.SCF_TRADES));
    this.scfDatabase.blacklist = JSON.parse(JSON.stringify(SCFData.SCF_BLACKLIST));
    this.scfDatabase.whitelist = JSON.parse(JSON.stringify(SCFData.SCF_WHITELIST));
    this.scfDatabase.cases = JSON.parse(JSON.stringify(SCFData.SCF_CASES));
    this.log('system', `📦 SCF 数据库初始化: ${this.scfDatabase.enterprises.length}家企业 / ${this.scfDatabase.relationships.length}条关系 / ${this.scfDatabase.trades.length}条贸易 / ${this.scfDatabase.cases.length}个案例`, 'config');
    this._persistSCF();
  },

  // === SCF 数据库持久化 ===
  _persistSCF() {
    try {
      const snapshot = {
        enterprises: this.scfDatabase.enterprises,
        products: this.scfDatabase.products,
        institutions: this.scfDatabase.institutions,
        relationships: this.scfDatabase.relationships,
        trades: this.scfDatabase.trades,
        blacklist: this.scfDatabase.blacklist,
        whitelist: this.scfDatabase.whitelist,
        cases: this.scfDatabase.cases,
        financingRequests: this.scfDatabase.financingRequests,
        loans: this.scfDatabase.loans,
        repayments: this.scfDatabase.repayments,
        riskEvents: this.scfDatabase.riskEvents,
        creditPropagation: this.scfDatabase.creditPropagation,
        performanceRecords: this.scfDatabase.performanceRecords
      };
      localStorage.setItem(this.scfEngine.storageKey, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[SCF] localStorage 持久化失败:', e);
    }
  },

  // === SCF 重置数据库 ===
  resetSCFDatabase() {
    localStorage.removeItem(this.scfEngine.storageKey);
    this._loadSCFFromMock();
    // 清空运行时数据
    this.scfDatabase.financingRequests = [];
    this.scfDatabase.loans = [];
    this.scfDatabase.repayments = [];
    this.scfDatabase.riskEvents = [];
    this.scfDatabase.creditPropagation = [];
    this.scfDatabase.performanceRecords = [];
    this.scfDatabase.graph = { nodes: [], edges: [], clusters: [] };
    this.scfEngine.status = 'idle';
    this.scfEngine.currentAnchorId = null;
    this.scfEngine.selectedPartnerId = null;
    this.scfEngine.activeTradeId = null;
    this.scfEngine.matchmakingResults = [];
    this.scfEngine.riskWarnings = [];
    Object.keys(this.scfEngine.engineStatus).forEach(k => {
      this.scfEngine.engineStatus[k] = { status: 'idle', lastRunAt: null, result: null };
    });
    this.log('system', '🔄 SCF 数据库已重置为初始 Mock 数据', 'config');
    this._notify();
  },

  // === SCF 辅助: 获取 SCF 企业 ===
  getSCFEnterprise(entId) {
    return this.scfDatabase.enterprises.find(e => e.id === entId);
  },

  // === SCF 辅助: 获取核心企业 (从现有 enterprises 查) ===
  getAnchorEnterprise(anchorId) {
    return this.enterprises.find(e => e.id === anchorId);
  },

  // === SCF 辅助: 获取核心企业信用分 (兼容 runtime.creditScore) ===
  getAnchorCreditScore(anchorId) {
    const anchor = this.getAnchorEnterprise(anchorId);
    return anchor && anchor.runtime ? anchor.runtime.creditScore : 700;
  },

  // === SCF 辅助: 获取核心企业改造等级 ===
  getAnchorReformLevel(anchorId) {
    const anchor = this.getAnchorEnterprise(anchorId);
    if (!anchor) return 'D';
    // 优先从 reformEngine.scorecard.current.level 获取
    if (this.reformEngine.currentEnterpriseId === anchorId && this.reformEngine.scorecard.current) {
      return this.reformEngine.scorecard.current.level || 'D';
    }
    // 兜底: 根据 creditScore 推断
    const score = anchor.runtime ? anchor.runtime.creditScore : 600;
    if (score >= 800) return 'A';
    if (score >= 750) return 'B+';
    if (score >= 700) return 'B';
    if (score >= 650) return 'B-';
    if (score >= 600) return 'C';
    return 'D';
  },

  // === SCF: 设置当前核心企业 ===
  setSCFAnchor(anchorId) {
    this.scfEngine.currentAnchorId = anchorId;
    const anchor = this.getAnchorEnterprise(anchorId);
    this.log('scf', `→ SCF 当前核心企业: ${anchor ? anchor.name : anchorId}`, 'scf');
    this._notify();
  },

  // === SCF: 设置当前上下游企业 ===
  setSCFPartner(partnerId) {
    this.scfEngine.selectedPartnerId = partnerId;
    const ent = this.getSCFEnterprise(partnerId);
    this.log('scf', `→ SCF 当前上下游企业: ${ent ? ent.name : partnerId}`, 'scf');
    this._notify();
  },

  // === SCF: 日志辅助 (log 面板新增 scf 分类) ===
  logSCF(engineId, message) {
    this.log('scf', `[${engineId}] ${message}`, 'scf');
  },

  // === SCF: 更新引擎状态 ===
  updateSCFEngineStatus(engineId, status, result) {
    if (this.scfEngine.engineStatus[engineId]) {
      this.scfEngine.engineStatus[engineId] = {
        status,
        lastRunAt: new Date().toISOString(),
        result: result || null
      };
    }
    this._notify();
  }
};

window.State = State;
