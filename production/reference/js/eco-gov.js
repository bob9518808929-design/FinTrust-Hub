/** 文件名：eco-gov.js 职责：ECO-08 政府背书催化剂模拟器,对接政务专线做脱敏聚合报告与定时推送 */
//
// 模块定位: APP-04 监管/政府背书催化剂 (P1, 信用催化剂)
// 对齐 spec.md L1804-1822 (Gherkin 场景) + tasks.md L2945-2956 (GOV.1-GOV.5) +
//       checklist.md L1851-1858 (验收项)
//
// ============================================================================
// 模拟器实现说明 (真实环境 vs 浏览器模拟)
// ============================================================================
// 真实环境 (地方金融监管局 / 工信局中小企业服务中心对接):
//   - 监管数据通道: 与地方金融监管局/工信局中小企业服务中心建立政务专线接入
//     (HTTPS + 国密 SM2/SM4 双向认证 + 政务网关白名单)
//   - 脱敏聚合报告: 平台辖区所有接入企业的真实经营数据, 在 SGX/TeeSecureMemory
//     enclave 内做聚合统计, 仅输出指标级 (聚合数 + 区间分布), 不含单户明细
//   - 推送调度: 后端定时任务 (Spring @Scheduled / Quartz) 每周一/每月1日推送
//   - 指导意见: 监管机构内部公文流转系统出具红头文件 (盖章 PDF)
//   - 推荐标识: 监管机构下发白名单凭证, 平台凭此在 APP-01/APP-02 展示徽章
//
// 浏览器端模拟 (本文件):
//   - 监管机构列表用 localStorage.eco_gov_regulators 持久化 (2 家默认机构)
//   - 脱敏聚合报告基于 window.State.enterprises 实时聚合统计 (聚合脱敏)
//   - 单户不可识别校验: report 中不得出现企业名/单户金额/单户 ID
//   - 推送调度: setTimeout 模拟定时器 (每周 = 7s, 每月 = 30s) + 手动触发按钮
//   - 指导意见: 模拟生成《关于推广使用 AI 合规融资平台的指导意见》文本 (非强制背书)
//   - 推荐标识: localStorage.eco_gov_endorsement 状态 (none/pending/endorsed)
//   - 推送历史: localStorage.eco_gov_reports
// ============================================================================

'use strict';

// ============================================================================
// EcoGov 单例 (闭包模式, 与 EcoBurn/SCFEngine 风格一致)
// ============================================================================
const EcoGov = (() => {

  // ============================================================
  // localStorage 键
  // ============================================================
  const LS_REGULATORS  = 'eco_gov_regulators';   // 监管机构列表 (含在线状态/推送节奏/背书状态)
  const LS_REPORTS     = 'eco_gov_reports';       // 推送历史
  const LS_ENDORSEMENT = 'eco_gov_endorsement';   // 背书状态汇总
  const LS_INDEX_HIST  = 'eco_gov_index_history'; // 辖区信用健康指数趋势 (近 6 期)
  const LS_LAST_PUSH   = 'eco_gov_last_push_at';  // 上次推送时间 (调度去抖)

  // 推送节奏映射为模拟器毫秒数 (真实环境 1 周 / 1 月)
  const SCHEDULE_MS = {
    weekly:   7 * 1000,   // 演示用 7 秒 ≈ 真实 1 周
    monthly:  30 * 1000   // 演示用 30 秒 ≈ 真实 1 月
  };

  // 默认 2 家监管机构 (spec L1809: 地方金融监管局 / 工信局中小企业服务中心)
  const DEFAULT_REGULATORS = [
    {
      id: 'fsb_001',
      shortName: 'XX 市金融监管局',
      fullName:  'XX 市地方金融监督管理局',
      type:      'finance_bureau',
      typeLabel: '地方金融监管局',
      channel:   '政务专线 (国密 SM2 双向认证)',
      status:    'online',
      pushSchedule: 'weekly',
      lastPushAt: null,
      pushedCount: 0,
      endorsementStatus: 'none',  // none | pending | endorsed | rejected
      endorsedAt: null,
      endorsementDocId: null,
      recommendationBadge: false
    },
    {
      id: 'iab_001',
      shortName: 'XX 市工信局中小企业服务中心',
      fullName:  'XX 市工业和信息化局中小企业服务中心',
      type:      'industry_bureau',
      typeLabel: '工信局中小企业服务中心',
      channel:   '政务专线 (国密 SM4 加密通道)',
      status:    'online',
      pushSchedule: 'monthly',
      lastPushAt: null,
      pushedCount: 0,
      endorsementStatus: 'none',
      endorsedAt: null,
      endorsementDocId: null,
      recommendationBadge: false
    }
  ];

  // 五流验证通过率分布区间
  const FIVE_FLOW_BUCKETS = [
    { key: 'b0_20',   label: '0–20%',  min: 0,    max: 0.2  },
    { key: 'b20_40',  label: '20–40%', min: 0.2,  max: 0.4  },
    { key: 'b40_60',  label: '40–60%', min: 0.4,  max: 0.6  },
    { key: 'b60_80',  label: '60–80%', min: 0.6,  max: 0.8  },
    { key: 'b80_100', label: '80–100%',min: 0.8,  max: 1.01 }
  ];

  // 责任链完整度分布区间
  const CHAIN_BUCKETS = [
    { key: 'c0_25',   label: '0–25%',   min: 0,    max: 0.25 },
    { key: 'c25_50',  label: '25–50%',  min: 0.25, max: 0.5  },
    { key: 'c50_75',  label: '50–75%',  min: 0.5,  max: 0.75 },
    { key: 'c75_100', label: '75–100%', min: 0.75, max: 1.01 }
  ];

  // 信用健康指数 6 期趋势 (近 6 期, 模拟器从 enterprises 聚合后扩展生成)
  const INDEX_HISTORY_LENGTH = 6;

  // ============================================================
  // 私有状态
  // ============================================================
  // _timers[regulatorId] —— setTimeout handle (推送调度)
  const _timers = Object.create(null);

  // _subscribers —— 状态变化订阅回调集合 (UI 驱动)
  const _subscribers = new Set();

  // _lastReport —— 最近一次生成的脱敏报告 (内存缓存)
  let _lastReport = null;

  // ============================================================
  // 工具: SHA-256 (生成报告指纹 + 链式 hash)
  // ============================================================
  async function _sha256(text) {
    const str = String(text == null ? '' : text);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) { /* fall through */ }
    }
    // Fallback (node --check 环境)
    let h1 = 0x12345678, h2 = 0x9abcdef0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = ((h1 << 5) - h1 + c) | 0;
      h2 = ((h2 << 7) ^ c) | 0;
    }
    return 'fallback_' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function _nowIso() { return new Date().toISOString(); }
  function _nowMs()  { return Date.now(); }

  // 安全 localStorage 访问 (Node 环境直接返回 null)
  function _lsGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (_) { return null; }
  }
  function _lsSet(key, val) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(key, val);
      return true;
    } catch (_) { return false; }
  }
  function _lsRemove(key) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(key);
    } catch (_) { /* noop */ }
  }
  function _lsGetJSON(key, fallback) {
    const raw = _lsGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }
  function _lsSetJSON(key, val) {
    return _lsSet(key, JSON.stringify(val));
  }

  // ============================================================
  // 工具: 读取 State.enterprises (含浏览器/Node 兜底)
  // ============================================================
  function _getEnterprises() {
    if (typeof State !== 'undefined' && Array.isArray(State.enterprises)) {
      return State.enterprises;
    }
    if (typeof window !== 'undefined' && window.State && Array.isArray(window.State.enterprises)) {
      return window.State.enterprises;
    }
    return [];
  }

  // ============================================================
  // 工具: 五流验证通过率 (单户 0–1)
  // spec L1814: 五流验证通过率分布
  // ----------------------------------------------------------
  // 计算方法: ent.runtime.fiveStreams 各流 true=通过, 统计 true 占比
  // (合同/发票/物流/资金/IoT 五流)
  // ============================================================
  function _entFiveFlowPassRate(ent) {
    if (!ent || !ent.runtime || !ent.runtime.fiveStreams) return 0;
    const fs = ent.runtime.fiveStreams;
    const keys = ['contract', 'invoice', 'logistics', 'fund', 'iot'];
    let passed = 0;
    for (const k of keys) if (fs[k]) passed++;
    return passed / keys.length;
  }

  // 责任链完整度 (单户 0–1)
  function _entChainCompleteness(ent) {
    if (!ent || !ent.runtime || !ent.runtime.responsibilityChain) return 0;
    const c = ent.runtime.responsibilityChain.completeness;
    const n = typeof c === 'number' ? c : 0;
    return Math.max(0, Math.min(1, n));
  }

  // 单户融资需求规模 (待融资 + 持票金额, 全部为待融资性质)
  function _entFinancingNeed(ent) {
    if (!ent || !ent.financials) return 0;
    const fin = ent.financials;
    const pendingAR = Number(fin.pendingAR) || 0;
    const billsHeld = Array.isArray(fin.billsHeld)
      ? fin.billsHeld.reduce((s, b) => s + (Number(b && b.amount) || 0), 0)
      : 0;
    return pendingAR + billsHeld;
  }

  // 改造阶段 (待改造 / 改造中 / 已完成)
  function _entReformStage(ent) {
    if (!ent || !ent.reform) return 'pending';
    if (ent.reform.hasReformed) return 'completed';
    // 没有 hasReformed=true 但有 completedActions 进行中 → 改造中
    if (Array.isArray(ent.reform.completedActions) && ent.reform.completedActions.length > 0) {
      return 'in_progress';
    }
    return 'pending';
  }

  // 行业标签
  function _entIndustryLabel(ent) {
    return ent && (ent.industryLabel || ent.industry) || '未分类';
  }

  // 信用分
  function _entCreditScore(ent) {
    return ent && ent.runtime && Number(ent.runtime.creditScore) || 0;
  }

  // ============================================================
  // 私有: 通知 UI (状态变化时调用)
  // ============================================================
  function _notify(payload) {
    const evt = Object.assign({ timestamp: _nowIso() }, payload);
    for (const cb of _subscribers) {
      try { cb(evt); } catch (_) { /* 单回调失败不阻断其他 */ }
    }
  }

  // ============================================================
  // 私有: 信用健康指数 (0–100, 辖区聚合)
  // ----------------------------------------------------------
  // spec L1815 引用 MOD-16.10 FinTrust 指数
  // 简化算法 (浏览器端模拟):
  //   index = w1*avgCredit + w2*avgFiveFlow*100 + w3*avgChain*100 + w4*reformRate*100
  //   权重 w1=0.4, w2=0.25, w3=0.2, w4=0.15
  //   信用分归一到 0–100: (score-520)/(860-520)*100
  // ============================================================
  function _calcCreditHealthIndex(enterprises) {
    if (!enterprises.length) return 0;
    const n = enterprises.length;
    let sumCredit = 0, sumFiveFlow = 0, sumChain = 0, completedCount = 0;
    for (const ent of enterprises) {
      sumCredit  += _entCreditScore(ent);
      sumFiveFlow += _entFiveFlowPassRate(ent);
      sumChain   += _entChainCompleteness(ent);
      if (_entReformStage(ent) === 'completed') completedCount++;
    }
    const avgCredit   = sumCredit / n;
    const avgFiveFlow = sumFiveFlow / n;
    const avgChain    = sumChain / n;
    const reformRate  = completedCount / n;

    const creditNorm  = Math.max(0, Math.min(1, (avgCredit - 520) / (860 - 520)));
    const idx = 0.4 * creditNorm * 100
              + 0.25 * avgFiveFlow * 100
              + 0.20 * avgChain * 100
              + 0.15 * reformRate * 100;
    return Math.round(Math.max(0, Math.min(100, idx)));
  }

  // ============================================================
  // 私有: 信用健康指数历史趋势 (近 6 期)
  // ----------------------------------------------------------
  // 真实环境: 每期推送后追加当前指数, 滚动保留 6 期
  // 模拟器: 若历史不足 6 期, 用当前指数向前插值补齐
  // ============================================================
  function _getIndexHistory(currentIdx) {
    const stored = _lsGetJSON(LS_INDEX_HIST, []);
    let hist = Array.isArray(stored) ? stored.slice(-INDEX_HISTORY_LENGTH) : [];
    // 追加本期 (若与最后一期不同时间则 push)
    const period = _periodLabel();
    if (!hist.length || hist[hist.length - 1].period !== period) {
      hist.push({ period, index: currentIdx, recordedAt: _nowIso() });
    } else {
      // 同期则覆盖最新指数
      hist[hist.length - 1].index = currentIdx;
      hist[hist.length - 1].recordedAt = _nowIso();
    }
    // 若不足 6 期, 用首期值前向补齐
    while (hist.length < INDEX_HISTORY_LENGTH) {
      hist.unshift({ period: '历史' + (INDEX_HISTORY_LENGTH - hist.length), index: hist[0] ? Math.max(0, hist[0].index - 3) : currentIdx, recordedAt: null });
    }
    hist = hist.slice(-INDEX_HISTORY_LENGTH);
    _lsSetJSON(LS_INDEX_HIST, hist);
    return hist;
  }

  function _periodLabel() {
    const d = new Date();
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
  }

  // ============================================================
  // 私有: 脱敏聚合校验 (单户不可识别)
  // ----------------------------------------------------------
  // 校验规则 (合规《个人信息保护法》《数据安全法》):
  //   1. report 不得包含任何企业 name / id / legalRep 等单户标识
  //   2. report 不得包含任何单户金额 (只允许聚合: 总额/户均/区间分布)
  //   3. 行业分布仅展示 count + aggregateAmount (不展示企业列表)
  //   4. 各分布仅展示 count (不展示企业列表)
  // ============================================================
  function _desensitizeCheck(report, enterprises) {
    const violations = [];
    if (!report) { violations.push('report 为空'); return { passed: false, violations }; }

    const text = JSON.stringify(report);
    const bannedSingleEntFields = ['enterpriseName', 'legalRep', 'account', 'counterparty', 'taxId', 'unifiedSocialCreditCode'];

    // 规则 1: 不得包含任何企业 name / id (单户标识)
    for (const ent of enterprises) {
      if (ent && ent.name && text.indexOf(ent.name) >= 0) {
        violations.push(`报告包含单户名称: ${ent.name}`);
      }
      if (ent && ent.id && text.indexOf(`"${ent.id}"`) >= 0) {
        violations.push(`报告包含单户 ID: ${ent.id}`);
      }
    }
    // 规则 2: 不得包含 banned 字段名
    for (const f of bannedSingleEntFields) {
      if (text.indexOf(`"${f}"`) >= 0) {
        violations.push(`报告包含禁用字段: ${f}`);
      }
    }
    // 规则 3: 不得出现单户金额数字 (检查 report 中是否存在 entFinancingNeed 精确值)
    for (const ent of enterprises) {
      const need = _entFinancingNeed(ent);
      if (need > 0 && text.indexOf(String(need)) >= 0) {
        violations.push(`报告包含单户精确融资额: ${need}`);
      }
    }
    return { passed: violations.length === 0, violations };
  }

  // ============================================================
  // 公共 API: regulators (getter)
  // ----------------------------------------------------------
  // 返回监管机构列表 (含在线状态/推送节奏/背书状态)
  // 若 localStorage 为空, 写入默认 2 家机构
  // ============================================================
  function regulators() {
    let list = _lsGetJSON(LS_REGULATORS, null);
    if (!Array.isArray(list) || !list.length) {
      list = JSON.parse(JSON.stringify(DEFAULT_REGULATORS));
      _lsSetJSON(LS_REGULATORS, list);
    }
    return list;
  }

  function _saveRegulators(list) {
    return _lsSetJSON(LS_REGULATORS, list);
  }

  function _findRegulator(regulatorId) {
    const list = regulators();
    return list.find(r => r.id === regulatorId) || null;
  }

  function _updateRegulator(regulatorId, patch) {
    const list = regulators();
    const idx = list.findIndex(r => r.id === regulatorId);
    if (idx < 0) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    _saveRegulators(list);
    return list[idx];
  }

  // ============================================================
  // 公共 API: buildPulseReport()
  // ----------------------------------------------------------
  // 生成《辖区中小微企业经营脉搏脱敏报告》
  // spec L1811-1815 报告内容:
  //   - 辖区内接入企业数量、行业分布、融资需求规模 (聚合脱敏)
  //   - 改造进展统计 (待改造/改造中/已完成数量)
  //   - 五流验证通过率分布、责任链完整度分布
  //   - 辖区中小企业信用健康指数趋势 (MOD-16.10 FinTrust 指数)
  // 全部脱敏聚合, 不含单户明细
  // ============================================================
  async function buildPulseReport() {
    const enterprises = _getEnterprises();
    const n = enterprises.length;

    // 1. 辖区接入企业数量
    const enterpriseCount = n;

    // 2. 行业分布 (按 industryLabel 聚合, count + aggregateAmount, 不含企业列表)
    const industryMap = new Map();
    for (const ent of enterprises) {
      const label = _entIndustryLabel(ent);
      const need = _entFinancingNeed(ent);
      const e = industryMap.get(label) || { industry: label, count: 0, aggregateAmount: 0 };
      e.count += 1;
      e.aggregateAmount += need;
      industryMap.set(label, e);
    }
    const industryDistribution = Array.from(industryMap.values())
      .map(e => ({
        industry: e.industry,
        count: e.count,
        aggregateAmount: Math.round(e.aggregateAmount)  // 聚合总额, 不含单户明细
      }))
      .sort((a, b) => b.count - a.count);

    // 3. 融资需求规模 (聚合脱敏: 总额 + 户均 + 区间分布, 不含单户金额)
    const needs = enterprises.map(_entFinancingNeed).filter(v => v > 0);
    const totalFinancingNeed = needs.reduce((s, v) => s + v, 0);
    const avgFinancingNeed = needs.length ? Math.round(totalFinancingNeed / needs.length) : 0;
    const needBuckets = [
      { key: 'n_lt_1m',    label: '0–100 万',     min: 0,           max: 1000000 },
      { key: 'n_1m_5m',    label: '100–500 万',   min: 1000000,    max: 5000000 },
      { key: 'n_5m_20m',   label: '500 万–2000 万',min: 5000000,    max: 20000000 },
      { key: 'n_20m_plus', label: '2000 万以上',   min: 20000000,   max: Infinity }
    ];
    const financingNeedDistribution = needBuckets.map(b => ({
      bucket: b.label,
      count: needs.filter(v => v >= b.min && v < b.max).length
    }));

    // 4. 改造进展统计 (待改造/改造中/已完成 数量)
    const reformProgress = { pending: 0, in_progress: 0, completed: 0 };
    for (const ent of enterprises) {
      reformProgress[_entReformStage(ent)] += 1;
    }

    // 5. 五流验证通过率分布 (按区间聚合 count)
    const fiveFlowPassDistribution = FIVE_FLOW_BUCKETS.map(b => ({
      bucket: b.label,
      count: enterprises.filter(e => {
        const r = _entFiveFlowPassRate(e);
        return r >= b.min && r < b.max;
      }).length
    }));

    // 6. 责任链完整度分布 (按区间聚合 count)
    const chainIntegrityDistribution = CHAIN_BUCKETS.map(b => ({
      bucket: b.label,
      count: enterprises.filter(e => {
        const c = _entChainCompleteness(e);
        return c >= b.min && c < b.max;
      }).length
    }));

    // 7. 辖区中小企业信用健康指数趋势 (近 6 期)
    const creditHealthIndex = _calcCreditHealthIndex(enterprises);
    const creditHealthIndexTrend = _getIndexHistory(creditHealthIndex);

    // 8. 报告元信息 + 脱敏声明
    const generatedAt = _nowIso();
    const period = _periodLabel();
    const reportId = `GOV_PULSE_${period}_${_nowMs().toString(36).toUpperCase()}`;

    const report = {
      reportId,
      title: '辖区中小微企业经营脉搏脱敏报告',
      period,
      generatedAt,
      generator: 'FinTrust Hub v3.1 ECO-08 政府背书催化剂',
      // 1. 辖区接入企业数量
      enterpriseCount,
      // 2. 行业分布 (count + aggregateAmount, 不含企业名/单户金额)
      industryDistribution,
      // 3. 融资需求规模 (聚合脱敏)
      financingNeedScale: {
        totalAmount: Math.round(totalFinancingNeed),
        averageAmount: avgFinancingNeed,
        distribution: financingNeedDistribution,
        // 显式声明: 不含单户明细金额
        unitLevelDetailRemoved: true
      },
      // 4. 改造进展统计
      reformProgress,
      // 5. 五流验证通过率分布
      fiveFlowPassDistribution,
      // 6. 责任链完整度分布
      chainIntegrityDistribution,
      // 7. 信用健康指数趋势
      creditHealthIndex: {
        current: creditHealthIndex,
        trend: creditHealthIndexTrend,
        algorithm: 'FinTrust 指数 v3.1 (信用分0.4 + 五流0.25 + 责任链0.20 + 改造0.15)'
      },
      // 脱敏合规声明
      desensitization: {
        compliance: '本报告全部为聚合脱敏数据, 不含单户名称/单户 ID/单户金额/单户交易对手等可识别信息',
        regulations: ['《个人信息保护法》', '《数据安全法》'],
        singleEntityIdentifiable: false,
        rawFieldsRemoved: ['enterpriseName', 'enterpriseId', 'legalRep', 'account', 'counterparty', 'taxId', 'unifiedSocialCreditCode', 'singleEntityAmount']
      }
    };

    // 9. 脱敏校验 (单户不可识别)
    const check = _desensitizeCheck(report, enterprises);
    report.desensitizationCheck = {
      passed: check.passed,
      violations: check.violations,
      checkedAt: _nowIso()
    };
    if (!check.passed) {
      // 严重违规, 不允许推送 (理论上不应发生, 因为构建过程已脱敏)
      throw new Error('buildPulseReport: 脱敏校验失败 ' + check.violations.join('; '));
    }

    // 10. 报告指纹 (用于推送存证)
    report.fingerprint = await _sha256(JSON.stringify({
      reportId, period, enterpriseCount, totalFinancingNeed, creditHealthIndex
    }));

    _lastReport = report;
    _notify({ type: 'report_built', reportId });
    return report;
  }

  // ============================================================
  // 公共 API: pushReport(regulatorId)
  // ----------------------------------------------------------
  // 推送脱敏报告给指定监管机构
  // spec L1811: 每周/月自动推送
  // 真实环境: 政务专线 HTTPS POST + 国密 SM2 签名 + 监管机构回执
  // 模拟器: 写入推送历史 + 更新监管机构 lastPushAt/pushedCount
  // ============================================================
  async function pushReport(regulatorId) {
    const reg = _findRegulator(regulatorId);
    if (!reg) throw new Error('pushReport: 监管机构不存在 ' + regulatorId);
    if (reg.status !== 'online') {
      throw new Error(`pushReport: ${reg.shortName} 通道离线, 无法推送`);
    }

    // 1. 生成 (或取缓存) 脱敏报告
    const report = _lastReport || await buildPulseReport();

    // 2. 推送记录
    const pushedAt = _nowIso();
    const pushedAtMs = _nowMs();
    const txId = `GOV_PUSH_${regulatorId}_${pushedAtMs.toString(36).toUpperCase()}`;
    const blockNumber = 990000 + Math.floor(pushedAtMs / 1000) % 999999;

    // 链式 hash (上一条推送的 hash 作为本条 prevHash, 形成不可篡改链)
    const history = _lsGetJSON(LS_REPORTS, []);
    const prevHash = (history.length && history[history.length - 1].chainHash)
      ? history[history.length - 1].chainHash
      : '0'.repeat(64);
    const chainHash = await _sha256(prevHash + '|' + txId + '|' + report.fingerprint + '|' + pushedAt);

    const record = {
      txId,
      blockNumber,
      chainHash,
      prevHash,
      regulatorId,
      regulatorName: reg.shortName,
      reportId: report.reportId,
      period: report.period,
      pushedAt,
      enterpriseCount: report.enterpriseCount,
      creditHealthIndex: report.creditHealthIndex.current,
      totalFinancingNeed: report.financingNeedScale.totalAmount,
      fingerprint: report.fingerprint,
      status: 'delivered',           // delivered | failed
      deliveryChannel: reg.channel,
      witnessNode: 'MOD-08 链上存证节点 N08 (FinTrust Chain)'
    };

    history.push(record);
    _lsSetJSON(LS_REPORTS, history);

    // 3. 更新监管机构 lastPushAt / pushedCount
    _updateRegulator(regulatorId, {
      lastPushAt: pushedAt,
      pushedCount: (reg.pushedCount || 0) + 1
    });
    _lsSet(LS_LAST_PUSH, String(pushedAtMs));

    _notify({ type: 'report_pushed', regulatorId, txId });
    return record;
  }

  // ============================================================
  // 公共 API: getReportHistory()
  // ----------------------------------------------------------
  // 返回推送历史 (默认按时间倒序)
  // ============================================================
  function getReportHistory(opts) {
    const o = opts || {};
    const history = _lsGetJSON(LS_REPORTS, []);
    let list = Array.isArray(history) ? history.slice() : [];
    if (o.regulatorId) list = list.filter(r => r.regulatorId === o.regulatorId);
    if (!o.ascending) list.reverse();  // 默认倒序 (最新在前)
    if (o.limit && list.length > o.limit) list = list.slice(0, o.limit);
    return list;
  }

  // ============================================================
  // 公共 API: requestEndorsement(regulatorId)
  // ----------------------------------------------------------
  // 申请《关于推广使用 AI 合规融资平台的指导意见》(非强制背书)
  // spec L1819: 作为交换, 请求监管机构出具《指导意见》
  // 模拟器: 状态机 none → pending → endorsed
  //   - pending 状态需推送过 ≥1 次报告 (前提条件)
  //   - endorsed 状态: 生成《指导意见》文本 + 推荐标识开启
  // ============================================================
  async function requestEndorsement(regulatorId) {
    const reg = _findRegulator(regulatorId);
    if (!reg) throw new Error('requestEndorsement: 监管机构不存在 ' + regulatorId);

    // 前置条件: 至少推送过 1 次报告
    const hist = getReportHistory({ regulatorId, ascending: true });
    if (!hist.length) {
      throw new Error(`requestEndorsement: ${reg.shortName} 尚未收到任何推送报告, 无法申请背书`);
    }

    // 状态机迁移
    let newStatus = reg.endorsementStatus;
    let endorsedAt = reg.endorsedAt;
    let endorsementDocId = reg.endorsementDocId;
    let recommendationBadge = reg.recommendationBadge;

    if (newStatus === 'none' || newStatus === 'rejected') {
      // none/rejected → pending (申请中)
      newStatus = 'pending';
    } else if (newStatus === 'pending') {
      // pending → endorsed (模拟监管机构审核通过, 出具《指导意见》)
      // 真实环境: 监管机构内部公文流转, 周期 2-4 周
      newStatus = 'endorsed';
      endorsedAt = _nowIso();
      endorsementDocId = `GOV_GUIDANCE_${regulatorId}_${_nowMs().toString(36).toUpperCase()}`;
      recommendationBadge = true;
    }
    // endorsed 状态保持 (不可逆)

    const updated = _updateRegulator(regulatorId, {
      endorsementStatus: newStatus,
      endorsedAt,
      endorsementDocId,
      recommendationBadge
    });

    _notify({ type: 'endorsement_updated', regulatorId, status: newStatus });
    return {
      regulatorId,
      regulatorName: reg.shortName,
      endorsementStatus: newStatus,
      endorsedAt,
      endorsementDocId,
      recommendationBadge
    };
  }

  // ============================================================
  // 公共 API: getEndorsementStatus()
  // ----------------------------------------------------------
  // 返回全部监管机构的背书状态汇总
  // ============================================================
  function getEndorsementStatus() {
    const list = regulators();
    return list.map(r => ({
      regulatorId: r.id,
      regulatorName: r.shortName,
      type: r.type,
      typeLabel: r.typeLabel,
      endorsementStatus: r.endorsementStatus || 'none',
      endorsedAt: r.endorsedAt || null,
      endorsementDocId: r.endorsementDocId || null,
      recommendationBadge: !!r.recommendationBadge
    }));
  }

  // ============================================================
  // 公共 API: isRecommended()
  // ----------------------------------------------------------
  // 是否展示"XX 监管局推荐平台"标识
  // spec L1821: 获得背书后, APP-02 与 APP-01 展示"XX 监管局推荐平台"标识
  // 任一监管机构出具背书即返回 true, 同时返回背书机构列表 (供 UI 展示)
  // ============================================================
  function isRecommended() {
    const list = regulators();
    const endorsers = list.filter(r => r.endorsementStatus === 'endorsed' && r.recommendationBadge);
    if (!endorsers.length) {
      return { recommended: false, endorsers: [], badges: [] };
    }
    return {
      recommended: true,
      endorsers: endorsers.map(r => ({
        regulatorId: r.id,
        regulatorName: r.shortName,
        endorsedAt: r.endorsedAt,
        endorsementDocId: r.endorsementDocId
      })),
      badges: endorsers.map(r => `${r.shortName}推荐平台`)
    };
  }

  // ============================================================
  // 公共 API: generateGuidanceDoc(regulatorId)
  // ----------------------------------------------------------
  // 生成《关于推广使用 AI 合规融资平台的指导意见》文本 (非强制背书文件)
  // spec L1819: 监管机构出具《指导意见》(非强制, 但带有背书性质)
  // 仅在 endorsementStatus === 'endorsed' 时可生成
  // ============================================================
  function generateGuidanceDoc(regulatorId) {
    const reg = _findRegulator(regulatorId);
    if (!reg) throw new Error('generateGuidanceDoc: 监管机构不存在 ' + regulatorId);
    if (reg.endorsementStatus !== 'endorsed') {
      throw new Error(`generateGuidanceDoc: ${reg.shortName} 尚未出具背书, 无法生成《指导意见》`);
    }

    const hist = getReportHistory({ regulatorId, ascending: false, limit: 1 });
    const last = hist[0] || null;
    const docId = reg.endorsementDocId || `GOV_GUIDANCE_${regulatorId}`;
    const issuedAt = reg.endorsedAt || _nowIso();

    const text =
`${reg.fullName}
关于推广使用 AI 合规融资平台的指导意见

发文字号: ${docId}
签发日期: ${issuedAt.slice(0, 10)}

各辖内商业银行、小额贷款公司、融资担保机构、各中小微企业:

为深入贯彻落实国务院《关于推进普惠金融高质量发展的实施意见》,
解决中小微企业融资难融资贵问题, 提升辖内金融服务实体经济能力,
现就推广使用 AI 合规融资平台 (FinTrust Hub) 提出如下指导意见:

一、充分认识 AI 合规融资平台的积极作用
   FinTrust Hub 平台通过 "五流合一验证 + 责任链穿透 + 阅后即焚"
   机制, 实现了企业经营数据可穿透、可追溯、可销毁, 在保障数据
   安全的前提下, 显著降低了银企信息不对称。辖内中小微企业接入
   平台后, 经营脉搏可通过脱敏聚合报告实时反馈至我局/中心,
   为辖内金融监管和普惠金融政策制定提供了重要参考依据。

二、鼓励辖内金融机构积极对接
   各商业银行、小贷公司、担保机构可结合自身风险偏好, 将平台
   "五流验证通过率、责任链完整度、信用健康指数" 作为授信决策
   的辅助参考, 不得作为唯一依据。鼓励辖内银行对信用健康指数
   持续向好的企业, 在授信额度、利率定价上给予适当倾斜。

三、引导辖内中小微企业主动接入
   鼓励辖内中小微企业主动接入平台, 完成企业改造 (8 维画像 +
   责任链补建), 通过数据脱敏方式分享经营脉搏, 换取融资便利。
   平台严格遵守《个人信息保护法》《数据安全法》, 单户数据不可
   识别, 原始数据"阅后即焚", 不留存在监管侧。

四、工作要求
   (一) 坚持市场化原则, 不强制接入, 不搞"一刀切";
   (二) 各接入机构应建立内部数据安全管理制度;
   (三) 我局/中心将定期发布《辖区中小微企业经营脉搏脱敏报告》,
        供辖内金融机构参考;
   (四) 本意见自发布之日起施行, 有效期 2 年。

特此意见。

${reg.fullName}
${issuedAt.slice(0, 10)}

附: 最近一期《辖区中小微企业经营脉搏脱敏报告》摘要
${last ? `  · 报告期: ${last.period}\n  · 接入企业数: ${last.enterpriseCount} 户\n  · 信用健康指数: ${last.creditHealthIndex}\n  · 融资需求规模(聚合): ${last.totalFinancingNeed} 元\n  · 推送存证 txId: ${last.txId}` : '  (尚无推送历史)'}
`;

    return {
      docId,
      title: '关于推广使用 AI 合规融资平台的指导意见',
      issuer: reg.fullName,
      issuedAt,
      text,
      // 性质声明: 非强制, 带有背书性质
      nature: '非强制性指导意见, 带有政府背书性质, 不构成行政许可',
      notice: '本文件为模拟器生成的非强制背书文本, 真实环境须由监管机构正式发文'
    };
  }

  // ============================================================
  // 公共 API: subscribeChanges(callback)
  // ----------------------------------------------------------
  // 订阅状态变化 (UI 驱动)
  // 返回 unsubscribe 函数
  // ============================================================
  function subscribeChanges(callback) {
    if (typeof callback !== 'function') return () => {};
    _subscribers.add(callback);
    return () => { _subscribers.delete(callback); };
  }

  // ============================================================
  // 公共 API: setRegulatorStatus(regulatorId, status)
  // ----------------------------------------------------------
  // 切换监管机构在线/离线状态 (UI 模拟用)
  // ============================================================
  function setRegulatorStatus(regulatorId, status) {
    if (!['online', 'offline'].includes(status)) {
      throw new Error('setRegulatorStatus: status 必须为 online|offline');
    }
    const updated = _updateRegulator(regulatorId, { status });
    _notify({ type: 'regulator_status_changed', regulatorId, status });
    return updated;
  }

  // ============================================================
  // 公共 API: setPushSchedule(regulatorId, schedule)
  // ----------------------------------------------------------
  // 设置推送节奏 (weekly/monthly) + 重启调度定时器
  // ============================================================
  function setPushSchedule(regulatorId, schedule) {
    if (!['weekly', 'monthly'].includes(schedule)) {
      throw new Error('setPushSchedule: schedule 必须为 weekly|monthly');
    }
    const updated = _updateRegulator(regulatorId, { pushSchedule: schedule });
    // 重启该机构的调度定时器
    _startScheduler(regulatorId);
    _notify({ type: 'schedule_changed', regulatorId, schedule });
    return updated;
  }

  // ============================================================
  // 公共 API: startAllSchedulers() / stopAllSchedulers()
  // ----------------------------------------------------------
  // 启停全部监管机构的推送调度定时器
  // 真实环境: 后端 Spring @Scheduled / Quartz
  // 模拟器: setTimeout (weekly=7s / monthly=30s)
  // ============================================================
  function _startScheduler(regulatorId) {
    // 停掉旧定时器
    if (_timers[regulatorId]) {
      clearTimeout(_timers[regulatorId]);
      _timers[regulatorId] = null;
    }
    const reg = _findRegulator(regulatorId);
    if (!reg || reg.status !== 'online') return;
    const interval = SCHEDULE_MS[reg.pushSchedule] || SCHEDULE_MS.weekly;
    // setTimeout 一次性触发 (推送后自动续接下一次)
    _timers[regulatorId] = setTimeout(async () => {
      _timers[regulatorId] = null;
      try {
        await pushReport(regulatorId);
      } catch (err) {
        // 推送失败不阻断后续调度 (真实环境: 失败重试 + 告警)
        console.warn(`[EcoGov] 调度推送失败 ${regulatorId}:`, err.message);
      }
      // 续接下一次 (若仍在线)
      if (_findRegulator(regulatorId) && _findRegulator(regulatorId).status === 'online') {
        _startScheduler(regulatorId);
      }
    }, interval);
  }

  function startAllSchedulers() {
    const list = regulators();
    for (const r of list) {
      if (r.status === 'online') _startScheduler(r.id);
    }
    _notify({ type: 'schedulers_started' });
    return list.filter(r => r.status === 'online').map(r => r.id);
  }

  function stopAllSchedulers() {
    for (const id of Object.keys(_timers)) {
      if (_timers[id]) {
        clearTimeout(_timers[id]);
        _timers[id] = null;
      }
    }
    _notify({ type: 'schedulers_stopped' });
  }

  // ============================================================
  // 公共 API: reset()
  // ----------------------------------------------------------
  // 重置全部状态 (调试 / 重新演示用)
  // ============================================================
  function reset() {
    stopAllSchedulers();
    _lsRemove(LS_REGULATORS);
    _lsRemove(LS_REPORTS);
    _lsRemove(LS_ENDORSEMENT);
    _lsRemove(LS_INDEX_HIST);
    _lsRemove(LS_LAST_PUSH);
    _lastReport = null;
    // 重新初始化默认监管机构
    regulators();
    _notify({ type: 'reset' });
  }

  // ============================================================
  // 公共 API: getLastReport()
  // ----------------------------------------------------------
  // 返回最近一次生成的脱敏报告 (内存缓存), 无则返回 null
  // ============================================================
  function getLastReport() {
    return _lastReport;
  }

  // ============================================================
  // 公共 API 导出
  // ============================================================
  return {
    // 核心 API (spec 规定)
    regulators,                  // 监管机构列表
    buildPulseReport,            // 生成《辖区中小微企业经营脉搏脱敏报告》
    pushReport,                  // 推送报告给指定监管机构
    getReportHistory,            // 推送历史
    requestEndorsement,          // 申请《指导意见》背书
    getEndorsementStatus,        // 背书状态
    isRecommended,               // 是否展示"XX 监管局推荐平台"标识
    // 辅助 API (供 UI / 父 agent 使用)
    generateGuidanceDoc,         // 生成《指导意见》文本
    setRegulatorStatus,          // 切换在线/离线
    setPushSchedule,             // 设置推送节奏
    startAllSchedulers,          // 启动全部调度
    stopAllSchedulers,           // 停止全部调度
    subscribeChanges,            // 订阅状态变化
    getLastReport,               // 最近一次报告 (内存缓存)
    reset,
    // 常量 (供 UI 显示)
    SCHEDULE_MS,
    FIVE_FLOW_BUCKETS,
    CHAIN_BUCKETS,
    INDEX_HISTORY_LENGTH
  };

})();

// 暴露到 window (浏览器端全局)
if (typeof window !== 'undefined') {
  window.EcoGov = EcoGov;
}
// CommonJS 兼容 (供 node --check / 单测 mock)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcoGov;
}
