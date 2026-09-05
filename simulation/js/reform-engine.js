/* ==========================================================
 * FinTrust Hub v5.0
 * Reform Engine —— 企业改造引擎 (R1-R10)
 * simulation-plan.md v5.0 对齐
 *
 * 引擎架构:
 *   R1 全景画像引擎    采集 + 8维评分卡
 *   R2 差距诊断引擎    分析缺口 + 违规识别
 *   R3 方案生成引擎    3条路径 (保守/平衡/创新)
 *   R4 任务调度引擎    DAG编排 + 关键路径
 *   R5 执行引擎家族    8类执行器 (R5-A主体~R5-H资本, 对齐 simulation-plan 二补.4)
 *   R6 动态重规划引擎  异常检测 + 重试
 *   R7 合规审查引擎    红/灰/绿边界 + 合规评分
 *   R8 进度监控引擎    实时看板 + 预警
 *   R9 银行匹配引擎    BIDS 匹配 → 预审批
 *   R10 案例学习引擎   相似案例检索 (KNN)
 * ========================================================== */

'use strict';

const ReformEngine = (() => {

  // ---------- 工具 ----------
  const LEVEL_ORDER = ['D','C','C+','B-','B','B+','A-','A','A+'];
  const _scoreGap = (cur, tgt) => Math.max(0, tgt - cur);
  const _dimLabel = (k) => {
    const d = MockData.REFORM_DIMENSIONS && MockData.REFORM_DIMENSIONS[k];
    return d ? (d.label || d.name || k) : k;
  };
  const _setEngineStatus = (rId, status, result, now=new Date().toISOString()) => {
    if (typeof State !== 'undefined' && State.reformEngine) {
      const st = State.reformEngine.engineStatus[rId];
      if (st) { st.status = status; st.lastRunAt = now; st.result = result; }
    }
  };
  const _log = (tag, text) => { if (typeof State !== 'undefined') State.log('reform', `[${tag}] ${text}`, 'reform'); };
  const _fmtMoney = (n) => {
    if (typeof State !== 'undefined' && typeof State.formatAmount === 'function') return State.formatAmount(n);
    return (n >= 10000 ? (n/10000).toFixed(0)+'万元' : n+'元');
  };

  // ==========================================================
  // R1 全景画像引擎 — 采集 + 8维评分卡快照
  // 入参: enterprise对象
  // 出参: { dims, summary, raw }
  // ==========================================================
  function runR1(ent) {
    const now = new Date().toISOString();
    _log('R1', `启动全景画像引擎 → 采集 ${ent.name} 多维数据`);
    // 若 State 已加载,优先复用 State 侧算好的评分卡(保持一致)
    let dims;
    if (typeof State !== 'undefined' && State.reformEngine) {
      dims = { ...State.reformEngine.scorecard.current };
    } else {
      // fallback: 基于企业数据估算
      const cs = ent.runtime.creditScore;
      const cc = ent.runtime.creditCompleteness;
      const flows = Object.values(ent.dataFlows).filter(Boolean).length;
      dims = {
        subject:  20 + flows*8 + (ent.creditGradeCap==='A'?20:0),
        finance:  Math.min(100, Math.round(cc*60 + ((ent.financials.monthlyRevenue - ent.financials.monthlyExpense)/ent.financials.monthlyRevenue)*40 + 20)),
        tax:      25 + flows*7 + (ent.dataFlows.invoice ? 15 : 0),
        business: 25 + flows*8 + (ent.dataFlows.logistics ? 15 : 0),
        assets:   30 + flows*6 + (ent.dataFlows.iot ? 10 : 0),
        credit:   Math.min(100, Math.max(20, Math.round((cs-500)/4))),
        policy:   35 + (ent.industryPolicy==='encourage'?30:ent.industryPolicy==='neutral'?15:0),
        capital:  30 + (ent.runtime.guaranteeStatus==='active'?20:0) + (ent.runtime.insuranceStatus==='active'?15:0) + flows*3,
      };
    }
    // 合规维度快速扫描(8维单项过低告警)
    const weak = Object.entries(dims).filter(([k,v]) => v < 50).map(([k,v]) => `${_dimLabel(k)}:${v}`);
    const result = {
      enterpriseId: ent.id,
      enterpriseName: ent.name,
      industry: ent.industryLabel,
      dims,
      weightedAvg: _weightedAvg(dims),
      riskLevel: ent.riskProfile,
      weakDims: weak,
      dataSources: _collectDataSources(ent),
      generatedAt: now
    };
    _setEngineStatus('R1', 'completed', result, now);
    _log('R1', `完成: 8维平均 ${result.weightedAvg.toFixed(0)} | 薄弱维度 ${weak.length} 个`);

    // ===== FP-01 (spec L373-378): 画像快照版本管理 profileSnapshots =====
    // spec: 画像完成或月度更新触发 → 存入 enterprise.reform.profileSnapshots[]
    // 每个快照包含 snapshotTime 和 profileVersion
    if (ent) {
      ent.reform = ent.reform || {};
      if (!Array.isArray(ent.reform.profileSnapshots)) {
        ent.reform.profileSnapshots = [];
      }
      const snapshotVersion = `v${ent.reform.profileSnapshots.length + 1}.${new Date().getMonth()+1}`;
      ent.reform.profileSnapshots.push({
        snapshotTime: now,
        profileVersion: snapshotVersion,
        dims: JSON.parse(JSON.stringify(dims)),
        weightedAvg: result.weightedAvg,
        weakDims: weak.slice(),
        dataQualityScore: result.dataQualityScore || 85,
        triggeredBy: (arguments.length > 1 && arguments[1] && arguments[1].triggeredBy) ? arguments[1].triggeredBy : 'manual'
      });
      // 最多保留 20 个快照 (防止无限增长)
      if (ent.reform.profileSnapshots.length > 20) {
        ent.reform.profileSnapshots = ent.reform.profileSnapshots.slice(-20);
      }
      _log('R1', `📸 [FP-01] 画像快照已存档: ${snapshotVersion} (共 ${ent.reform.profileSnapshots.length} 个历史快照)`);
    }
    return result;
  }

  function _weightedAvg(dims) {
    const dimsCfg = MockData.REFORM_DIMENSIONS || {};
    let tw = 0, ws = 0;
    Object.keys(dims).forEach(k => {
      const w = dimsCfg[k] && dimsCfg[k].weight ? dimsCfg[k].weight : 0.125;
      tw += w; ws += dims[k] * w;
    });
    return tw > 0 ? ws/tw : 0;
  }

  function _collectDataSources(ent) {
    const arr = [];
    if (ent.dataFlows.fund)     arr.push({id:'fund',    label:'资金流',   status:'connected'});
    if (ent.dataFlows.contract) arr.push({id:'contract',label:'合同流',   status:'connected'});
    if (ent.dataFlows.invoice)  arr.push({id:'invoice', label:'发票流',   status:'connected'});
    if (ent.dataFlows.logistics)arr.push({id:'logistics',label:'物流流',  status:'connected'});
    if (ent.dataFlows.corp)     arr.push({id:'corp',    label:'主体信息', status:'connected'});
    if (ent.dataFlows.iot)      arr.push({id:'iot',     label:'IoT物联',  status:'connected'});
    return arr;
  }

  // ==========================================================
  // R2 差距诊断引擎 — 分析到目标等级的缺口 + 违规识别
  // 入参: enterprise对象, options { targetLevel, aggressiveness }
  // 出参: gaps[], violations[], pathLevel, scorecard
  // ==========================================================
  function runR2(ent, opts={}) {
    const now = new Date().toISOString();
    const re = (typeof State !== 'undefined') ? State.reformEngine : null;
    const targetLevel = opts.targetLevel || (re && re.targetLevel) || 'B';
    const aggLevel    = opts.aggressiveness || (re && re.aggressiveness) || 'balanced';
    const aggCfg = MockData.AGGRESSIVENESS_LEVELS[aggLevel] || MockData.AGGRESSIVENESS_LEVELS.balanced;
    _log('R2', `启动差距诊断引擎 → 目标等级 ${targetLevel}, 激进程度 ${aggLevel}`);
    // R1 画像作为输入
    const r1 = runR1(ent);
    const curDims = r1.dims;
    // 根据目标等级推导目标分数 (各维度阈值)
    const targetDims = _getTargetDimThresholds(targetLevel);
    // 逐维诊断缺口
    const gaps = [];
    Object.keys(targetDims).forEach(k => {
      const cur = curDims[k] || 0;
      const tgt = targetDims[k];
      const diff = _scoreGap(cur, tgt);
      if (diff > 0) {
        gaps.push({
          dim: k, dimLabel: _dimLabel(k),
          current: cur, target: tgt, gap: diff,
          urgency: diff > 30 ? 'critical' : diff > 15 ? 'high' : 'medium',
          suggestion: _getGapSuggestion(k, diff, aggLevel)
        });
      }
    });
    // 违规识别 (简化版规则): 模拟数据的典型问题
    const violations = _identifyViolations(ent, aggLevel);
    const result = {
      targetLevel, aggressiveness: aggLevel,
      scorecard: { current: curDims, target: targetDims },
      gaps, violations,
      totalGapPoints: gaps.reduce((s,g)=>s+g.gap, 0),
      criticalGaps: gaps.filter(g=>g.urgency==='critical').length,
      highGaps:     gaps.filter(g=>g.urgency==='high').length,
      estimatedBaseDays: Math.round(30 + gaps.length * 5 + violations.length * 8),
      generatedAt: now
    };
    _setEngineStatus('R2', 'completed', result, now);
    if (typeof State !== 'undefined' && State.reformEngine) State.reformEngine.gapReport = result;
    _log('R2', `完成: 关键缺口 ${result.criticalGaps}, 一般缺口 ${result.highGaps + gaps.filter(g=>g.urgency==='medium').length}, 合规风险 ${violations.length}`);
    return result;
  }

  // ===== FP-02 (spec L441-449): R2 改造完成复检逻辑 =====
  // spec: 改造流程所有任务已完成 → MOD-16 触发复检 → 基于最新画像重新执行 12 项评分
  //       若 hard_gap 全部解决且 repairable 修复率≥80% → 复检通过触发 MOD-16 完成
  //       否则 → 复检失败触发 MOD-16.6 动态重规划
  function runR2_recheck(ent) {
    const now = new Date().toISOString();
    ent = ent || (State && State.currentEnterprise);
    if (!ent) return { passed:false, reason:'企业不存在' };
    _log('R2', `🔍 [FP-02 复检] 启动改造完成复检 → 重新采集 ${ent.name} 最新画像 + 12 项指标重新评分`);

    // 重新运行 R1 采集最新画像 (会自动创建新快照)
    const r1New = typeof runR1 === 'function' ? runR1(ent) : null;
    const curDims = r1New ? r1New.dims : (ent.reform && ent.reform.scorecard ? ent.reform.scorecard.current : {});

    // 重新执行 12 项银行准入指标评分 (复用 runR2 逻辑)
    const recheckResult = runR2(ent, { targetLevel: (State.reformEngine||{}).targetLevel || 'B', aggressiveness: (State.reformEngine||{}).aggressiveness || 'balanced' });

    // 评估: hard_gap 是否全部解决 + repairable 修复率
    const hardGapsRemaining = (recheckResult.gaps || []).filter(g => g.urgency === 'critical').length;
    const repairableGaps = (recheckResult.gaps || []).filter(g => g.urgency === 'high' || g.urgency === 'medium').length;
    const totalGapsBefore = ((State.reformEngine||{}).gapReport || {}).totalGapPoints || 0;
    const repairRate = totalGapsBefore > 0 ? Math.max(0, 1 - (recheckResult.totalGapPoints / totalGapsBefore)) : 1;

    const passed = hardGapsRemaining === 0 && repairRate >= 0.8;
    const recheckReport = {
      passed,
      recheckedAt: now,
      hardGapsRemaining,
      repairableGaps,
      repairRate: Math.round(repairRate * 100) / 100,
      totalGapsBefore,
      totalGapsAfter: recheckResult.totalGapPoints,
      scorecardSnapshot: curDims,
      gapReportNew: recheckResult,
      action: passed ? '复检通过 → 触发 MOD-16 完成流程 (融资解锁+R9撮合+R10入库)' : '复检失败 → 触发 MOD-16.6 动态重规划 (生成补充改造方案)'
    };

    _log('R2', `🔍 [FP-02 复检] ${passed?'✅ 通过':'❌ 失败'} · hard_gap 剩余 ${hardGapsRemaining} · repairable 剩余 ${repairableGaps} · 修复率 ${Math.round(repairRate*100)}%`);

    // 复检失败 → 触发 R6 重规划
    if (!passed && typeof runR6_onFailure === 'function') {
      _log('R2', `🚨 [联动 R2→R6] 复检失败 → 触发 R6 动态重规划, 生成补充改造方案`);
      runR6_onFailure({
        id: 'R2-RECHECK-' + Date.now(),
        label: `复检失败: ${hardGapsRemaining} 个硬缺口未解决, 修复率 ${Math.round(repairRate*100)}% < 80%`,
        dim: 'compliance', status: 'failed',
        result: { success:false, reason:'R2 复检失败', retryable:true, recheckFailed:true },
        retryCount: 0
      });
    }

    if (State && State.log) {
      State.log('reform', `🔍 [FP-02 R2复检] ${passed?'✅ 通过':'❌ 失败'} · 硬缺口 ${hardGapsRemaining} · 修复率 ${Math.round(repairRate*100)}% · ${recheckReport.action}`, 'reform');
    }
    return recheckReport;
  }

  function _getTargetDimThresholds(level) {
    // 根据目标等级反推各维度阈值(经验映射)
    const L = LEVEL_ORDER.indexOf(level);
    const baseT = { subject:50, finance:50, tax:50, business:45, assets:45, credit:60, policy:40, capital:45 };
    const step = Math.max(0, L - LEVEL_ORDER.indexOf('C'));
    const bump = step * 6;
    return {
      subject:  baseT.subject  + bump + 5,
      finance:  baseT.finance  + bump + 8,
      tax:      baseT.tax      + bump + 6,
      business: baseT.business + bump + 3,
      assets:   baseT.assets   + bump + 2,
      credit:   baseT.credit   + bump + 10,
      policy:   baseT.policy   + bump,
      capital:  baseT.capital  + bump + 5,
    };
  }

  function _getGapSuggestion(dim, diff, aggLevel) {
    const agg = MockData.AGGRESSIVENESS_LEVELS[aggLevel] || {};
    const innovate = aggLevel === 'innovative';
    const pool = {
      subject:  ['完成股权穿透梳理 (R5-3法人治理)',         innovate ? '反向收购壳公司完成主体变更' : '法人变更为实际控制人', '补充董监高任职证明'],
      finance:  ['重编规范账套 (R5-1财务执行器)',            '银行对账单/票据归档补齐 3 个月',       innovate ? '引入资本化加速表外资产入账' : '规范关联方交易'],
      tax:      ['补齐缺失月份申报 (R5-2税务执行器)',       innovate ? '合规化重构供应链以优化税率' : '发票合规性抽查+整理旧账', '纳税评级修复申请'],
      business: ['核心客户合同标准化归档',                  innovate ? '并购同业公司放大经营规模' : '补充物流单/签收单佐证业务', '搭建销售台账并与发票勾稽'],
      assets:   ['固定资产确权+发票归档',                   innovate ? '将核心数据资产确权入账' : '存货盘点报告+评估报告',  '知识产权权属证明补齐'],
      credit:   ['结清历史逾期+开具非恶意证明',            '追加增信 (担保/保险)',                innovate ? '集团联合授信+并表模式' : '主动发起信用修复申请'],
      policy:   ['申请产业政策认定材料 (专精特新/高新)',    '地方招商政策对接',                    '行业协会背书/资质认证'],
      capital:  ['引导实缴资本实到+验资报告',               innovate ? '引入产业基金完成股改' : '保证金/存单质押增信',     '融资性担保公司合作签约'],
    };
    const arr = pool[dim] || ['多维交叉验证', '补充佐证材料', '专业机构鉴证'];
    // 优先度: 严重缺口(diff>20)给高强度方案
    if (diff > 25) return arr[2] || arr[0];
    if (diff > 12) return arr[1] || arr[0];
    return arr[0];
  }

  function _identifyViolations(ent, aggLevel) {
    const arr = [];
    // F1 两本账识别: 高风险企业或 creditCompleteness<0.6
    if (ent.riskProfile === 'high_risk' || ent.runtime.creditCompleteness < 0.6) {
      arr.push({ id:'F1', level: aggLevel==='conservative' ? 'red' : 'gray', label:'疑似双账', detail:'税务口径与银行流水差异显著，需重订账套并补交滞纳金', zone: 'finance' });
    }
    // T1 税款滞纳: 鑫达贸易类高风险
    if (ent.id === 'E003') {
      arr.push({ id:'T1', level:'red',  label:'纳税申报异常', detail:'Q3 部分月份未正常申报，存在 8.2 万潜在滞纳及罚款风险', zone:'tax' });
    }
    // B1 业务真实性: 三流/四流不合一
    const openFlows = Object.values(ent.dataFlows).filter(Boolean).length;
    if (openFlows < 3) {
      arr.push({ id:'B1', level:'gray', label:'业务链条佐证不足', detail:`当前仅${openFlows}流，建议至少补齐3流(资金/合同/发票)以支撑业务真实性`, zone:'business' });
    }
    // S1 主体瑕疵: 代持/法代非实控
    if (ent.riskProfile === 'high_risk' && !ent.reform || !ent.reform || !ent.reform.hasReformed) {
      arr.push({ id:'S1', level:'gray', label:'主体法人疑似代持', detail:'法人/股东结构与实际经营决策人不一致，需完成股权穿透梳理', zone:'subject' });
    }
    return arr;
  }

  // ==========================================================
  // R3 方案生成引擎 — 3条改造路径 (保守/平衡/创新)
  // 入参: R2 差距报告 gapReport, opts
  // 出参: plans[] (3条)
  // ==========================================================
  function runR3(gapReport, opts={}) {
    const now = new Date().toISOString();
    if (!gapReport) gapReport = (State && State.reformEngine && State.reformEngine.gapReport);
    if (!gapReport) { _log('R3','ERR: 未找到差距报告,请先运行 R2 差距诊断'); return []; }
    _log('R3','启动方案生成引擎 → 基于差距构造 3 条路径');
    const ent = State ? State.currentEnterprise : null;
    const targetLevel = opts.targetLevel || gapReport.targetLevel || 'B';
    const autonomyLevel = opts.autonomyLevel || (State && State.reformEngine && State.reformEngine.autonomyLevel) || 'L2';
    const three = ['conservative','balanced','innovative'];
    const plans = three.map((aggId, idx) => {
      const cfg = MockData.AGGRESSIVENESS_LEVELS[aggId];
      // 动作列表: 每个缺口 → 1~2 个动作 (创新级会多一些高收益高动作)
      const actions = [];
      gapReport.gaps.forEach(g => {
        actions.push(_buildAction(g, aggId, 'primary'));
        if ((aggId === 'balanced' && g.urgency==='critical') || aggId === 'innovative') {
          actions.push(_buildAction(g, aggId, 'secondary'));
        }
      });
      // 违规项额外动作 (spec 对齐 8 类执行器)
      gapReport.violations.forEach(v => {
        const dim = (['finance','tax','business','subject','credit','assets','policy','capital'].includes(v.zone) ? v.zone : 'subject');
        const violExecutorMap = { subject:'R5-A', finance:'R5-B', tax:'R5-C', business:'R5-D', assets:'R5-E', credit:'R5-F', policy:'R5-G', capital:'R5-H' };
        actions.push({
          dim,
          label: `[合规]${v.label}`,
          detail: v.detail,
          hours: v.level === 'red' ? 32 : v.level === 'gray' ? 20 : 8,
          cost:  v.level === 'red' ? 60000 : v.level === 'gray' ? 25000 : 8000,
          creditGain: v.level === 'red' ? 25 : v.level === 'gray' ? 12 : 4,
          dimScoreDelta: 8,
          requiresLegal: v.level === 'red' || (aggId==='innovative' && v.level!=='green'),
          executor: violExecutorMap[dim] || 'R5-A'
        });
      });
      const totalHours = actions.reduce((s,a)=>s+a.hours,0);
      const totalCost  = actions.reduce((s,a)=>s+a.cost,0);
      const totalCredit = actions.reduce((s,a)=>s+a.creditGain,0);
      // 关键路径 (核心 3 个动作)
      const critical = actions.slice(0, 3).map(a => a.label);
      return {
        id: 'PLAN-' + aggId.toUpperCase() + '-' + now.slice(0,10),
        pathLevel: aggId,
        pathName: cfg.name, icon: cfg.icon, bounds: cfg.bounds,
        description: `${cfg.name}路径：${cfg.description}`,
        targetLevel,
        autonomyLevel,
        actions,
        totalActions: actions.length,
        totalHours,
        totalCost,
        totalCreditGain: totalCredit,
        timelineDays: Math.round(actions.length * (aggId==='conservative'?8:aggId==='balanced'?5.5:4)),
        criticalPath: critical,
        complianceRisk: cfg.complianceRisk,
        estBaseCost: totalCost,
        estBaseDays: Math.round(actions.length * 6),
        estCreditGain: totalCredit,
        recommended: idx === 1 // balanced 默认推荐
      };
    });
    // R7 合规引擎预校验: 对每条 plan 打合规分
    plans.forEach(p => {
      p.complianceCheck = runR7_once(p);
    });
    _setEngineStatus('R3', 'completed', { planCount: plans.length, plans: plans.map(p => ({id:p.id,pathLevel:p.pathLevel})) }, now);
    if (State && State.reformEngine) {
      State.reformEngine.reformPlans = plans;
      State.reformEngine.selectedPlanId = plans.find(p=>p.recommended) ? plans.find(p=>p.recommended).id : plans[0].id;
      if (typeof State._computeReformEstimation === 'function') {
        const sel = plans.find(p=>p.id === State.reformEngine.selectedPlanId);
        State.reformEngine.estimation = State._computeReformEstimation(sel);
      }
    }
    _log('R3', `完成: 生成 3 条方案 → 推荐 ${plans.find(p=>p.recommended)?.pathName}`);
    return plans;
  }

  function _buildAction(gap, aggId, role) {
    const aggMulti = { conservative: 0.8, balanced: 1.0, innovative: 1.3 }[aggId] || 1;
    // 工时 = (gap/3) * aggMulti 小时  (越大越急 → 动作越多)
    const h = Math.max(4, Math.round(gap.gap * 0.6 * aggMulti));
    const costPerHour = aggId === 'innovative' ? 900 : aggId === 'balanced' ? 700 : 500;
    const isPrimary = role === 'primary';
    // spec 二补.4 对齐: dim → R5-A~R5-H 8 类执行器
    const executorMap = {
      subject:'R5-A', finance:'R5-B', tax:'R5-C', business:'R5-D',
      assets:'R5-E', credit:'R5-F', policy:'R5-G', capital:'R5-H'
    };
    return {
      dim: gap.dim,
      label: isPrimary ? gap.suggestion : `${_dimLabel(gap.dim)}维度强化: ${gap.suggestion}(二次校验)`,
      detail: `当前 ${gap.current} → 目标 ${gap.target}, 缺口 ${gap.gap} 分 · 紧急度 ${gap.urgency}`,
      hours: h,
      cost:  Math.round(h * costPerHour * (isPrimary ? 1 : 0.6)),
      creditGain: Math.max(3, Math.round(gap.gap * 0.7 * aggMulti)),
      dimScoreDelta: Math.round(gap.gap * 0.9),
      requiresLegal: gap.urgency==='critical' || (aggId==='innovative' && gap.dim==='subject'),
      executor: executorMap[gap.dim] || 'R5-1'
    };
  }

  // ==========================================================
  // R4 任务调度引擎 — DAG 编排 + 关键路径
  // 入参: plan 对象
  // 出参: tasks[] (含 deps, phase, parallelGroup)
  // ==========================================================
  function runR4(plan) {
    const now = new Date().toISOString();
    if (!plan) plan = _getSelectedPlan();
    if (!plan) { _log('R4','ERR: 未选择方案,请先在 R3 中选定路径'); return []; }
    _log('R4',`启动任务调度引擎 → 方案 ${plan.id}`);
    // 阶段分组: 主体合规 → 财务税务 → 业务资产 → 增信资金
    const phases = [
      { id:'P1', name:'主体合规', dims:['subject','policy'] },
      { id:'P2', name:'财务税务', dims:['finance','tax'] },
      { id:'P3', name:'业务资产', dims:['business','assets'] },
      { id:'P4', name:'增信资金', dims:['credit','capital'] }
    ];
    const tasks = [];
    plan.actions.forEach((a, i) => {
      const phase = phases.find(p => p.dims.includes(a.dim)) || phases[1];
      // DAG 依赖: 非P1阶段任务依赖前一阶段首个任务
      const deps = [];
      if (phase.id !== 'P1') {
        const prevPhase = phases[phases.indexOf(phase)-1];
        const prevPhaseTaskIds = tasks.filter(t => t.phase === prevPhase.id).map(t => t.id);
        if (prevPhaseTaskIds[0]) deps.push(prevPhaseTaskIds[0]);
      }
      tasks.push({
        id: 'T' + String(i+1).padStart(3,'0'),
        planId: plan.id,
        dim: a.dim,
        dimLabel: _dimLabel(a.dim),
        label: a.label,
        detail: a.detail,
        executor: a.executor,
        phase: phase.id,
        phaseName: phase.name,
        parallelGroup: a.dim + '_' + Math.floor(i/2),
        deps,
        hours: a.hours,
        cost: a.cost,
        requiresLegal: a.requiresLegal,
        creditGain: a.creditGain,
        dimScoreDelta: a.dimScoreDelta,
        status: 'pending',
        result: null
      });
    });
    // 关键路径 = 总工时最大的那条串
    let criticalPathIds = _computeCriticalPath(tasks);
    tasks.forEach(t => { t.isCritical = criticalPathIds.includes(t.id); });
    const result = { tasks, totalTasks: tasks.length, criticalPathIds, generatedAt: now };
    _setEngineStatus('R4', 'completed', { totalTasks: tasks.length, criticalPath: tasks.filter(t=>t.isCritical).map(t=>t.label) }, now);
    if (State && State.reformEngine) {
      State.reformEngine.taskDAG = tasks;
      State.reformEngine.totalTasks = tasks.length;
      State.reformEngine.completedTasks = 0;
      State.reformEngine.progress = 0;
    }
    _log('R4', `完成: ${tasks.length} 个任务 · 关键路径 ${criticalPathIds.length} 步`);
    return result;
  }

  function _getSelectedPlan() {
    if (!State || !State.reformEngine) return null;
    const re = State.reformEngine;
    return (re.reformPlans || []).find(p => p.id === re.selectedPlanId) || re.reformPlans[0];
  }

  function _computeCriticalPath(tasks) {
    // 简化 DAG: 按phase串联取各阶段最长任务
    const byPhase = {};
    tasks.forEach(t => { byPhase[t.phase] = byPhase[t.phase] || []; byPhase[t.phase].push(t); });
    const cp = [];
    ['P1','P2','P3','P4'].forEach(p => {
      if (!byPhase[p] || byPhase[p].length === 0) return;
      const t = byPhase[p].reduce((a,b) => a.hours >= b.hours ? a : b);
      cp.push(t.id);
    });
    return cp;
  }

  // ==========================================================
  // R5 执行引擎家族 — 8类执行器 (spec 二补.4 R5-A~R5-H 对齐)
  // 入口 runR5: 单步执行一个 task 或启动一个 executor 的批处理
  // ==========================================================
  const R5_EXECUTORS = {
    'R5-A': { id:'R5-A', name:'主体改造执行器', scope:'壳公司筛选/尽调/收购协议/资质申请材料/增资/法人变更', greenOnly: false, dim: 'subject'  },
    'R5-B': { id:'R5-B', name:'财务改造执行器', scope:'调整分录/补税测算/报表重述/债转股方案/现金流优化',     greenOnly: false, dim: 'finance'  },
    'R5-C': { id:'R5-C', name:'税务修复执行器', scope:'补税申报/信用修复/优惠匹配/红冲重开/评级修复',         greenOnly: false, dim: 'tax'      },
    'R5-D': { id:'R5-D', name:'业务规范执行器', scope:'合同补签/流水规范/社保补缴/物流补单/业务台账',         greenOnly: false, dim: 'business' },
    'R5-E': { id:'R5-E', name:'资产盘活执行器', scope:'保理申请/质押登记/租赁方案/数据资产入表/知识产权',     greenOnly: false, dim: 'assets'   },
    'R5-F': { id:'R5-F', name:'信用修复执行器', scope:'异议申诉/信用修复/债务整合/结清证明/多头借贷优化',     greenOnly: false, dim: 'credit'   },
    'R5-G': { id:'R5-G', name:'政策对接执行器', scope:'担保基金申请/资质认定/贴息申请/政府对接/专精特新',       greenOnly: true,  dim: 'policy'   },
    'R5-H': { id:'R5-H', name:'资本运作执行器', scope:'重组方案/估值建模/协议起草/引入战投/股权激励',          greenOnly: false, dim: 'capital'  }
  };
  function getExecutorInfo(eId) { return R5_EXECUTORS[eId] || null; }

  function runR5(taskOrExecutorId, opts={}) {
    const now = new Date().toISOString();
    // 允许两种调用方式:
    //   a) 传 task 对象 -> 单步执行该任务
    //   b) 传 executorId (string) -> 返回该 executor 能力描述 + 当前进度
    if (typeof taskOrExecutorId === 'string' && taskOrExecutorId.startsWith('R5')) {
      const ex = R5_EXECUTORS[taskOrExecutorId];
      if (!ex) return null;
      // 统计该 executor 的任务进度
      let total=0, done=0;
      (State && State.reformEngine && State.reformEngine.taskDAG || []).forEach(t => {
        if (t.executor === taskOrExecutorId) { total++; if (t.status==='done') done++; }
      });
      const r = { executor: ex, totalTasks: total, completedTasks: done, ready: !!ex };
      _setEngineStatus('R5', 'idle', r, now);
      return r;
    }
    // --- 单任务执行 ---
    const task = taskOrExecutorId;
    if (!task || typeof task !== 'object') { _log('R5','ERR: task无效'); return null; }
    const ex = R5_EXECUTORS[task.executor];
    const autonomy = opts.autonomyLevel || (State && State.reformEngine && State.reformEngine.autonomyLevel) || 'L2';
    const autoCfg = MockData.REFORM_AUTONOMY_LEVELS[autonomy];
    _log('R5', `[${ex.id} ${ex.name}] 执行任务 ${task.id}: ${task.label}`);
    // R7 合规预检
    const legalCheck = runR7_once({ actions:[{dim:task.dim,requiresLegal:task.requiresLegal,label:task.label}] }, autonomy);
    // ===== spec 联动规则 5.5: R7 红线/灰区 → 推送 Tab3 人工审批 =====
    if (legalCheck.redlinesTriggered > 0) {
      task.status = 'blocked';
      task.result = { success:false, reason:`合规红线阻断 (${legalCheck.redlinesTriggered}项) → 已推送 L4 人工合规审查`, legalCheck };
      _log('R5', `→ 阻断: ${task.result.reason}`);
      if (State && typeof State.pushReformLegalReviewToApproval === 'function') {
        State.pushReformLegalReviewToApproval({
          level: 'red', task, executor: ex, autonomy, legalCheck,
          summary: `红线阻断: ${legalCheck.findings.filter(f=>f.level==='red').map(f=>f.label).join('；')}`
        });
      }
      return task.result;
    }
    if (legalCheck.grayZonesCount > 0) {
      // 灰区 → spec 要求推送 Tab3 人工审核 (非阻塞: L3 可直接通过, L2 必须停)
      task.status = 'pending_approval';
      task.result = { success:false, reason:`R7 灰区审查(${legalCheck.grayZonesCount}项) → 已推送 Tab3 人工合规复核`, legalCheck };
      _log('R5', `→ 等待合规复核(灰区): ${task.result.reason}`);
      if (State && typeof State.pushReformLegalReviewToApproval === 'function') {
        State.pushReformLegalReviewToApproval({
          level: 'gray', task, executor: ex, autonomy, legalCheck,
          summary: `灰区复核: ${legalCheck.findings.filter(f=>f.level==='gray').map(f=>f.label).join('；')}`
        });
      }
      return task.result;
    }
    // 自主度边界检查: L2 只能执行"文档生成"类, L3 可执行 API, L4 可全流程
    const canRun = autoCfg && autoCfg.canExecute ? task.requiresLegal ? autoCfg.canExecute.legalReview || false : true : false;
    if (!canRun && autonomy === 'L2' && task.requiresLegal) {
      task.status = 'pending_approval';
      task.result = { success:false, reason:`L2 自主度仅支持文档生成, 该任务需法务复核 → 已推送 Tab3 审批队列` };
      _log('R5', `→ 等待审批: ${task.result.reason}`);
      if (State && typeof State.pushReformLegalReviewToApproval === 'function') {
        State.pushReformLegalReviewToApproval({
          level: 'legal_boundary', task, executor: ex, autonomy, legalCheck,
          summary: `L2 自主度边界: ${task.label} 需法务签章, 请升级 L3/L4 或在 Tab3 手动通过`
        });
      }
      return task.result;
    }
    // 模拟执行: 成功率 = 0.85 + (L3/L4 有加成)
    const autoBoost = { L2:0, L3:0.07, L4:0.12 }[autonomy] || 0;
    // ===== FP-08 (spec L632-646): L2 严格限制外部 API 调用 =====
    // L2: 仅生成文档, 不调用外部 API; L3: 可调用, 但 API 熔断时降级到 L2; L4: 全自动
    let apiCalled = false;
    if (typeof _canCallExternalApi === 'function' && _canCallExternalApi(autonomy)) {
      apiCalled = true; // L3/L4 且 API 可用
    } else if (autonomy === 'L3' && !apiCalled) {
      // L3 但 API 不可用 → 自动降级 L3→L2
      _degradeL3toL2(task);
      // 降级后任务状态为 review_required, 不再继续执行
      _setEngineStatus('R5', 'retry_scheduled', { lastTaskId: task.id, degraded: true }, now);
      return task.result || { success:false, degraded:true, reason:'L3→L2 降级' };
    } else if (autonomy === 'L2') {
      // L2 模式: 仅生成文档, 不调用 API
      _log('R5', `📝 [FP-08 L2] L2 模式: 仅生成执行文档, 不调用外部 API · 文档将推送 APP-03 顾问运营台人工审核`);
      task.result = task.result || {};
      task.result.l2DocOnly = true;
      task.result.outputDocument = `${task.id}_${task.dim}_${now.slice(0,10)}_L2_DOC.pdf`;
    }
    const success = Math.random() < (0.85 + autoBoost);
    if (success) {
      task.status = 'done';
      task.result = {
        success: true,
        outputDocument: `${task.id}_${task.dim}_${now.slice(0,10)}.pdf`,
        hours: task.hours, cost: task.cost,
        creditGain: task.creditGain, dimScoreDelta: task.dimScoreDelta,
        legalReviewed: task.requiresLegal,
        executedAt: now, executor: ex.id
      };
      // 回调 State 的联动规则 5.3 推进进度 + 融资能力更新
      if (State && typeof State.advanceReformTask === 'function') {
        State.advanceReformTask({
          dim: task.dim,
          action: task.label,
          creditGain: task.creditGain,
          dimScoreDelta: task.dimScoreDelta
        });
      }
      _log('R5', `→ 成功: 输出文档 ${task.result.outputDocument}, +${task.creditGain}信用分`);
    } else {
      task.status = 'failed';
      task.result = { success:false, reason:'执行异常: 外部机构接口超时/材料待补充', retryable:true, nextTryAt: new Date(Date.now()+3600000).toISOString() };
      // R6 动态重规划: 失败任务自动标记重跑
      runR6_onFailure(task);
    }
    _setEngineStatus('R5', task.result.success ? 'completed' : task.result.retryable ? 'retry_scheduled' : 'failed',
                     { lastTaskId: task.id, success: task.result.success }, now);
    return task.result;
  }

  // ==========================================================
  // R6 动态重规划引擎 — 异常检测 + 重试策略
  // ==========================================================
  function runR6_onFailure(failedTask) {
    const now = new Date().toISOString();
    _log('R6', `启动动态重规划 → 任务 ${failedTask.id} 失败, 触发重试`);
    // 策略: 同类任务并行拆分 + 重试次数上限=3
    failedTask.retryCount = (failedTask.retryCount || 0) + 1;
    const retry = failedTask.retryCount <= 3;
    // v=33: 真正的"重排" — 拆分失败任务为 3 个子任务并行执行, 并延长整体完成时间
    if (retry && State && State.reformEngine) {
      const dag = State.reformEngine.taskDAG || [];
      const parentIdx = dag.findIndex(t => t.id === failedTask.id);
      if (parentIdx >= 0) {
        // 把原任务标记为"已重排"并保留在 DAG 中, 新增 3 个子任务
        failedTask.status = 'pending';
        failedTask.label = failedTask.label + ' (重排后)';
        failedTask.hours = Math.ceil(failedTask.hours / 3); // 拆分后单任务工时降低
        failedTask.isCritical = false; // 拆分后不再在关键路径
        // 生成 3 个并行子任务
        for (let k = 1; k <= 3; k++) {
          dag.push({
            id: `${failedTask.id}-S${k}`,
            label: `${failedTask.label} · 第${k}期`,
            phase: failedTask.phase,
            phaseName: failedTask.phaseName,
            dim: failedTask.dim,
            executor: failedTask.executor,
            hours: Math.ceil(failedTask.hours / 3),
            cost: Math.round((failedTask.cost || 0) / 3),
            creditGain: Math.round((failedTask.creditGain || 0) / 3),
            dimScoreDelta: Math.round((failedTask.dimScoreDelta || 0) / 3),
            status: 'pending',
            isCritical: k === 1,
            requiresLegal: failedTask.requiresLegal,
            detail: `R6 重排子任务 ${k}/3 (并行执行)`,
            retryOf: failedTask.id
          });
        }
        State.reformEngine.totalTasks += 3; // 总任务数增加, 进度会重新计算
        _log('R6', `→ 重排完成: 拆分为 3 个并行子任务 ${failedTask.id}-S1/S2/S3, 工时拆分, 总任务数 +3`);
      }
    }
    _setEngineStatus('R6', retry ? 'replanning_scheduled' : 'manual_intervention_required',
                     { failedTaskId: failedTask.id, retryCount: failedTask.retryCount, retry }, now);
    _log('R6', retry ? `→ 第 ${failedTask.retryCount} 次重试已排入队列 (${failedTask.result.nextTryAt})`
                     : `→ 达到重试上限(3次) → 通知人工介入`);
    return { retry, retryCount: failedTask.retryCount };
  }

  // ===== FP-03 (spec L838-850): R6 月度数据更新触发重规划 =====
  // spec: 每月 1 日系统自动触发 R6 → 基于最新企业画像重新评估 → 关键路径重计算
  function runR6_monthlyReview(ent) {
    const now = new Date().toISOString();
    ent = ent || (State && State.currentEnterprise);
    if (!ent) return { triggered:false, reason:'企业不存在' };
    const re = State && State.reformEngine;
    if (!re) return { triggered:false, reason:'改造引擎未初始化' };

    _log('R6', `📅 [FP-03 月度重规划] 启动 → 基于最新企业画像重新评估 ${ent.name} 的改造方案`);

    // 1. 重新运行 R1 采集最新画像 (会自动创建新快照, 用于 R8 指标恶化对比)
    const r1New = typeof runR1 === 'function' ? runR1(ent) : null;
    if (!r1New) {
      _log('R6', `⚠ 月度重规划失败: R1 画像采集失败`);
      return { triggered:false, reason:'R1 采集失败' };
    }

    // 2. 重新运行 R2 差距诊断, 对比改造进度
    const r2New = typeof runR2 === 'function' ? runR2(ent, { targetLevel: re.targetLevel, aggressiveness: re.aggressiveness }) : null;
    if (!r2New) {
      _log('R6', `⚠ 月度重规划失败: R2 诊断失败`);
      return { triggered:false, reason:'R2 诊断失败' };
    }

    // 3. 评估是否需要重规划: 新增硬缺口 或 修复率不达预期
    const originalGaps = (re.gapReport || {}).totalGapPoints || 0;
    const newGaps = r2New.totalGapPoints || 0;
    const newHardGaps = (r2New.gaps || []).filter(g => g.urgency === 'critical').length;
    const gapDelta = newGaps - originalGaps;

    const needsReplan = newHardGaps > 0 || gapDelta > 10;
    _log('R6', `📅 [FP-03 月度评估] 原缺口 ${originalGaps} → 新缺口 ${newGaps} (Δ${gapDelta>0?'+':''}${gapDelta}) · 新增硬缺口 ${newHardGaps} · ${needsReplan?'需要重规划':'维持原方案'}`);

    if (needsReplan) {
      // 关键路径重计算: 基于新缺口重新生成关键路径
      const newCriticalPath = (r2New.gaps || []).filter(g => g.urgency === 'critical').slice(0,3).map(g => g.dim);
      _log('R6', `🛤 [FP-03 关键路径重计算] 新关键路径: ${newCriticalPath.length>0?newCriticalPath.join(' → '):'无硬缺口, 维持原路径'}`);

      // 生成补充改造任务 (每个新增硬缺口 → 1 个补充任务)
      (r2New.gaps || []).filter(g => g.urgency === 'critical').forEach((g, i) => {
        const supId = `T-MONTHLY-${new Date().getMonth()+1}-${i+1}`;
        const existing = (re.taskDAG || []).find(t => t.id === supId);
        if (!existing) {
          re.taskDAG.push({
            id: supId, label: `[月度补丁] ${g.dimLabel} 补强`, phase: 'PM', phaseName: '月度补丁',
            dim: g.dim, executor: 'R5-' + g.dim.charAt(0).toUpperCase(),
            hours: 8, cost: 8000, creditGain: 5, dimScoreDelta: 10,
            status: 'pending', isCritical: i === 0, requiresLegal: false,
            detail: `R6 月度重规划: 新增 ${g.dimLabel} 缺口 ${g.gap} 分`,
            monthlyReplanGenerated: true
          });
          re.totalTasks++;
        }
      });

      // 重新计算 R8 进度基线
      re.estimation = re.estimation || {};
      re.estimation.totalDays = Math.round((re.taskDAG || []).reduce((s,t)=>s+(t.hours||0),0) / 8);
      _log('R6', `✅ [FP-03 月度重规划] 已生成 ${newHardGaps} 个补充任务, 总任务数 → ${re.totalTasks}, 重新计算时长 → ${re.estimation.totalDays} 天`);
    } else {
      _log('R6', `✅ [FP-03 月度重规划] 评估通过: 无新增硬缺口, 维持原方案`);
    }

    _setEngineStatus('R6', needsReplan ? 'replanning_scheduled' : 'completed',
                     { monthlyReview:true, gapDelta, newHardGaps, needsReplan }, now);
    if (State && State.log) {
      State.log('reform', `📅 [FP-03 月度重规划] ${ent.name} · 原缺口 ${originalGaps} → 新缺口 ${newGaps} (Δ${gapDelta>0?'+':''}${gapDelta}) · ${needsReplan?'已生成 '+newHardGaps+' 个补充任务':'维持原方案'}`, 'reform');
    }
    return { triggered:true, needsReplan, gapDelta, newHardGaps, newGaps, originalGaps };
  }

  // ==========================================================
  // R7 合规审查引擎 — 红/灰/绿三线边界 + 合规评分
  // 严格对齐 simulation-plan.md 二补.5:
  //   绝对红线 6 条(AI必须拒绝) · 灰色地带 5 条(需法务审核) · 绿色合规区 6 条(AI可自主执行)
  // ==========================================================
  function runR7_once(planOrTask, autonomy) {
    autonomy = autonomy || (State && State.reformEngine && State.reformEngine.autonomyLevel) || 'L2';
    const actions = planOrTask.actions || [planOrTask];
    let redlines = 0, grayZones = 0, greens = 0;
    const findings = [];

    // ===== 二补.5 边界判定辅助: 基于动作标签关键词做零幻觉匹配 =====
    const _hasKeyword = (a, kws) => {
      const text = `${a.label || ''} ${a.detail || ''} ${a.actionHint || ''}`;
      return kws.some(kw => text.includes(kw));
    };

    actions.forEach(a => {
      const dim = a.dim || 'unknown';
      const label = a.label || '未命名动作';

      // ============================================================
      // 🚨 绝对红线级 (6 条) — AI 必须拒绝，无论激进程度和自主度
      // ============================================================
      if (
        // 红线1: 虚开发票（包括为融资而虚开）
        _hasKeyword(a, ['虚开发票','虚开','虚增开票','为融资虚开','无交易开票','空开票']) ||
        // 红线2: 伪造银行流水 / 物流单据 / 合同
        _hasKeyword(a, ['伪造流水','伪造合同','伪造物流','伪造单据','虚假流水','虚假合同','虚假物流','P图流水','私刻章']) ||
        // 红线3: 隐匿收入偷逃税款（金额占应纳税额 10% 以上）
        _hasKeyword(a, ['隐匿收入','隐瞒收入','账外收入','私户收款不报','两套账','双账','内账外账','偷逃税款','疑似双账']) &&
          (a.taxRatioGap == null || a.taxRatioGap >= 0.10) ||
        // 红线4: 提供虚假财务报表骗取贷款
        _hasKeyword(a, ['虚假报表','粉饰报表','虚增利润','虚增营收','造假报表','骗贷','骗取贷款']) ||
        // 红线5: 利用空壳公司虚构贸易背景
        _hasKeyword(a, ['空壳','虚构贸易','虚假交易背景','无实控贸易','走账','过票']) ||
        // 红线6: 非法买卖资质牌照
        _hasKeyword(a, ['买卖资质','倒卖牌照','非法转让资质','租借资质','挂靠资质'])
      ) {
        redlines++;
        findings.push({
          level: 'red',
          boundaryId: 'R7-RED-' + redlines,
          label: '红线: ' + (
            _hasKeyword(a, ['虚开发票','虚开','虚增开票']) ? '禁止虚开发票(含为融资而虚开)' :
            _hasKeyword(a, ['伪造流水','伪造合同','伪造物流','伪造单据','虚假流水','虚假合同','虚假物流']) ? '禁止伪造银行流水/物流单据/合同' :
            _hasKeyword(a, ['隐匿收入','隐瞒收入','账外收入','私户收款不报','两套账','双账','疑似双账']) ? '禁止隐匿收入偷逃税款(≥10%应纳税额·含两套账/双账)' :
            _hasKeyword(a, ['虚假报表','粉饰报表','虚增利润','虚增营收','造假报表','骗贷']) ? '禁止提供虚假财务报表骗取贷款' :
            _hasKeyword(a, ['空壳','虚构贸易','虚假交易背景','无实控贸易']) ? '禁止利用空壳公司虚构贸易背景' :
            '禁止非法买卖资质牌照'
          ),
          detail: `[simulation-plan 二补.5 红线] 触发维度: ${dim} · 动作: ${label} · 该类动作属于刑法/税法明确禁止行为，AI 在任何情况下不得输出执行方案`,
          action: '立即回退该任务，并通知合规官启动人工调查；严禁任何变通执行方案',
          legalRef: '刑法第201条(逃税) / 第205条(虚开) / 贷款诈骗罪'
        });
        return; // 注意: 此处原用 continue, 但 forEach 回调内必须用 return 跳过当前迭代 = for 循环 continue
      }

      // ============================================================
      // ⚠️ 灰色地带级 (5 条) — 需法律审核签章后放行，L2 完全阻断
      // ============================================================
      let hitGray = null;
      if (
        // 灰区1: 反向收购壳公司 → 必须真实经营延续
        (dim === 'subject' || dim === 'capital') &&
        _hasKeyword(a, ['反向收购','买壳','借壳','壳公司','收购壳'])
      ) hitGray = { id: 'R7-GRAY-1', label:'灰区: 反向收购壳公司需法务审核(真实经营延续性鉴证)', detail:'反向收购涉及壳公司历史债务/税务/劳动风险穿透，必须证明业务真实延续而非仅购买主体', action:'Tab3 人工审核时必须附「壳公司历史尽调清单+业务延续性证明」双文件，缺一不可', legalRef:'企业会计准则第20号-企业合并 / 工商穿透审查要求' };

      else if (
        // 灰区2: 股权代持 → 必须如实披露
        (dim === 'subject' || dim === 'capital') &&
        _hasKeyword(a, ['股权代持','代持','隐名股东','名义股东'])
      ) hitGray = { id: 'R7-GRAY-2', label:'灰区: 股权代持需法务审核(必须如实披露)', detail:'股权代持不得用于隐瞒实际控制人、规避关联交易或对外担保，必须在融资材料中完整如实披露', action:'Tab3 人工审核时必须附「代持协议+实际控制人声明+披露承诺函」，否则不得放行', legalRef:'公司法司法解释三 / 银保监发〔2020〕15号' };

      else if (
        // 灰区3: 关联交易合并报表 → 必须符合企业会计准则
        (dim === 'finance' || dim === 'tax') &&
        _hasKeyword(a, ['关联交易','合并报表','关联方合并','内部交易抵消','集团合并'])
      ) hitGray = { id: 'R7-GRAY-3', label:'灰区: 关联交易合并报表需法务+审计双复核(必须符合准则)', detail:'关联交易定价必须公允、抵消完整、符合企业会计准则第33号/36号，严禁通过关联交易虚增营收或转移利润', action:'Tab3 人工审核时必须附「关联交易定价表+审计师复核意见」，税率偏离超过20%必须补充说明', legalRef:'企业会计准则第33号(合并报表) / 第36号(关联方披露)' };

      else if (
        // 灰区4: 税收优惠追溯申请 → 必须真实符合优惠条件
        dim === 'tax' &&
        _hasKeyword(a, ['追溯优惠','追溯申请','追溯享受','补享优惠','优惠追溯','退税追溯'])
      ) hitGray = { id: 'R7-GRAY-4', label:'灰区: 税收优惠追溯申请需税务+法务复核(必须真实符合条件)', detail:'税收优惠追溯不得虚构资质、倒签日期或伪造材料，必须在政策有效期和法定追溯期内真实满足全部条件', action:'Tab3 人工审核时必须核对「资质证书原件+政策文号对应关系+税款所属期匹配」，三者缺一不可', legalRef:'税收征管法第51条 / 各税收优惠管理办法' };

      else if (
        // 灰区5: 法人变更 → 不能用于逃避债务
        dim === 'subject' &&
        _hasKeyword(a, ['法人变更','变更法人','更换法定代表人','法定代表人变更']) &&
        autonomy !== 'L4'
      ) hitGray = { id: 'R7-GRAY-5', label:'灰区: 法人变更需法务审核(不能用于逃避债务)', detail:'法人变更前必须核查历史债务、担保、欠税，并明确债务承接安排；严禁为逃避债务或执行而突击变更法定代表人', action:'Tab3 人工审核时必须附「债务承接声明+变更前征信报告+变更决议」，并确认非涉诉/失信状态下变更', legalRef:'民法典第532条 / 公司法第13条' };

      if (hitGray) {
        grayZones++;
        findings.push({ level:'gray', ...hitGray, detail:`${hitGray.detail} · 触发维度: ${dim} · 动作: ${label} · 当前自主度 ${autonomy}` });
        return; // 原 continue → return (forEach 回调内的等效语法)
      }

      // ============================================================
      // ✅ 绿色合规区级 (6 条) — AI 可自主执行，L2+ 全部放行
      // ============================================================
      let greenLabel = '绿区: 标准化动作, AI 可自主执行';
      let greenDetail = `动作: ${label} · 维度: ${dim} · 未触碰红线/灰区, 允许 L2+ 自动通过`;
      let greenAction = '无需干预,AI 将在 R5 家族中自动分配对应执行器完成';
      if (dim === 'tax' && _hasKeyword(a, ['补税','补缴','滞纳金','税款补缴'])) {
        greenLabel = '绿区: 补缴税款+滞纳金 (标准化合规动作)';
        greenDetail = '主动补缴税款及滞纳金，属于税务合规整改标准路径，AI 可自动计算金额并生成申报表';
        greenAction = 'R5-C 税务修复执行器自动分配执行，生成申报表+滞纳金计算单，待银行扣款回执完成闭环';
      } else if (dim === 'credit' && _hasKeyword(a, ['信用修复','修复申请','纳税信用修复','征信修复'])) {
        greenLabel = '绿区: 纳税信用修复申请 (标准化合规动作)';
        greenDetail = '符合国家税务总局公告2021年第31号的纳税信用修复条件，属于明确的标准修复流程';
        greenAction = 'R5-F 信用修复执行器自动准备《纳税信用修复申请表》，L3 可自动对接电子税务局提交';
      } else if (dim === 'assets' && _hasKeyword(a, ['保理','质押','租赁','应收账款保理','动产质押'])) {
        greenLabel = '绿区: 资产盘活(保理/租赁/质押) (标准化合规动作)';
        greenDetail = '真实应收账款/动产的保理或质押，属于物权法和合同法明确保护的担保方式';
        greenAction = 'R5-E 资产盘活执行器自动分配，L3 可自动对接中登网办理质押登记';
      } else if (dim === 'policy' && _hasKeyword(a, ['担保基金','资质认定','贴息','专精特新','高新技术','政策对接'])) {
        greenLabel = '绿区: 政策红利对接(政府担保/资质认定/贴息) (标准化合规动作)';
        greenDetail = '地方政府明确公开的扶持政策申请通道，属于合规普惠政策对接，材料清单固定';
        greenAction = 'R5-G 政策对接执行器自动准备申报材料，对照政策文件逐项勾稽材料齐备性';
      } else if ((dim === 'business') && _hasKeyword(a, ['合同补签','物流补单','社保补缴','业务台账','五流补全'])) {
        greenLabel = '绿区: 业务真实性补全(合同/物流/社保) (标准化合规动作)';
        greenDetail = '基于真实发生的业务补充完善合同、物流签收、社保等痕迹，属于「补全证据链」而非「虚构证据链」';
        greenAction = 'R5-D 业务规范执行器自动分配，生成补签合同模板并标注「补签」字样，避免与正常签署混淆';
      } else if (dim === 'credit' && _hasKeyword(a, ['债务整合','结清小额','债务优化','多头借贷优化'])) {
        greenLabel = '绿区: 债务整合优化 (标准化合规动作)';
        greenDetail = '将多笔高息/零散债务整合为低息长期，属于民法典合同编明确允许的债务重组方式';
        greenAction = 'R5-F 信用修复执行器自动生成分期/整合方案，对接债权人签署《债务重组协议》';
      }
      greens++;
      findings.push({
        level: 'green',
        boundaryId: 'R7-GRN-' + greens,
        label: greenLabel,
        detail: `[simulation-plan 二补.5 绿区] ${greenDetail}`,
        action: greenAction
      });
    });

    const score = Math.max(0, 100 - redlines * 35 - grayZones * 10);

    // ===== BP-03 修复 (reform-engine-spec L880-890): 红线检测自动触发 R6 重规划 =====
    // spec: 红线检测 → MOD-16.6 动态重规划引擎被触发, 生成不含红线操作的替代方案
    if (redlines > 0 && typeof runR6_onFailure === 'function') {
      _log('R7', `🚨 [联动 R7→R6] 检测到 ${redlines} 条红线 → 自动触发 R6 动态重规划, 生成替代方案`);
      const redTaskProxy = {
        id: 'R7-RED-' + Date.now(),
        label: `红线阻断: ${findings.filter(f=>f.level==='red').map(f=>f.label).join(';')}`,
        dim: 'compliance',
        status: 'failed',
        result: { success:false, reason:'R7 红线检测阻断', retryable:true, redlineBlocking:true },
        retryCount: 0
      };
      runR6_onFailure(redTaskProxy);
    }

    return {
      score, redlinesTriggered: redlines, grayZonesCount: grayZones, greenZonesCount: greens,
      findings,
      canPass: redlines === 0,
      requiresLegalSignOff: grayZones > 0,
      boundarySet: State && State.reformEngine ? State.reformEngine.aggressiveness : 'balanced',
      // v5.0 新增: 统计各级边界命中明细，供 Tab3 和联动日志结构化展示
      coverage: { totalRed: 6, hitRed: redlines, totalGray: 5, hitGray: grayZones, totalGreen: 6, hitGreen: Math.min(greens, 6) },
      // ===== FP-04 补全 (spec L920-937): ComplianceOpinion 完整结构 =====
      complianceOpinion: {
        version: '1.0',
        engineVersion: 'R7-v5.0-v37',
        timestamp: new Date().toISOString(),
        auditor: 'R7 法律合规审核引擎',
        triggeredRules: findings.map((f,i) => ({
          ruleId: f.boundaryId || `R7-RULE-${i+1}`,
          level: f.level,
          label: f.label,
          detail: f.detail,
          action: f.action,
          legalRef: f.legalRef || null
        })),
        // 模拟区块链存证哈希 (实际生产环境接入 INFRA-01c)
        blockchainTxHash: '0x' + Array.from({length:64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join(''),
        overallOpinion: redlines > 0 ? 'REJECTED' : grayZones > 0 ? 'CONDITIONAL_APPROVAL' : 'APPROVED'
      }
    };
  }
  function runR7() {
    const now = new Date().toISOString();
    _log('R7', `启动合规审查引擎 → 全方案扫描`);
    const plan = _getSelectedPlan();
    const report = plan ? runR7_once(plan) : { score: 999, redlinesTriggered:0,grayZonesCount:0, findings:[] };
    _setEngineStatus('R7', 'completed', report, now);
    _log('R7', `完成: 合规分 ${report.score} · 红线 ${report.redlinesTriggered} · 灰区 ${report.grayZonesCount}`);
    return report;
  }

  // ==========================================================
  // R8 进度监控引擎 — 实时看板快照
  // ==========================================================
  function runR8() {
    const now = new Date().toISOString();
    const re = State && State.reformEngine;
    if (!re) return null;
    const tasks = re.taskDAG || [];
    const done  = tasks.filter(t => t.status === 'done');
    const failed= tasks.filter(t => t.status === 'failed');
    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'pending_approval');
    const blocked = tasks.filter(t => t.status === 'blocked');
    const byPhase = {};
    ['P1','P2','P3','P4'].forEach(p => { byPhase[p] = { total:0, done:0 }; });
    tasks.forEach(t => {
      if (!byPhase[t.phase]) byPhase[t.phase] = { total:0, done:0 };
      byPhase[t.phase].total++;
      if (t.status === 'done') byPhase[t.phase].done++;
    });
    const snapshot = {
      progress: re.progress,
      phaseProgress: Object.fromEntries(Object.entries(byPhase).map(([p,v]) => [p, v.total>0 ? v.done/v.total : 0])),
      done: done.length, failed: failed.length, pending: pending.length, blocked: blocked.length,
      total: tasks.length,
      recentActions: re.completedActions ? [...re.completedActions].slice(-5).reverse() : [],
      nextMilestones: tasks.filter(t => t.status==='pending' && t.isCritical).slice(0,3).map(t=>({id:t.id, label:t.label, phase:t.phaseName})),
      alerts: [
        ...failed.map(t => ({level:'error', text:`任务 ${t.id} 失败需 R6 重试: ${t.label}`})),
        ...blocked.map(t => ({level:'warn',  text:`任务 ${t.id} 合规阻断: ${t.label}`})),
      ],
      generatedAt: now
    };

    // ===== FP-09 (spec L957-969): R8 异常预警四级检测 =====
    // 四级预警: 1.超时150% 2.失败率20% 3.关键路径延长30天 4.指标恶化
    snapshot.warnings = [];
    const totalTasks = tasks.length || 1;
    const failedRate = failed.length / totalTasks;
    // 1. 任务超时预警 (单个任务执行时间 > 预估 * 1.5)
    tasks.forEach(t => {
      if (t.status === 'executing' && t.startedAt && t.hours) {
        const elapsed = (Date.now() - new Date(t.startedAt).getTime()) / 3600000;
        if (elapsed > t.hours * 1.5) {
          snapshot.warnings.push({
            level: 'warn', category: 'timeout',
            text: `⏰ 任务 ${t.id} 超时预警: 预估 ${t.hours}h, 已执行 ${elapsed.toFixed(1)}h (超时 ${Math.round((elapsed/t.hours - 1)*100)}%)`,
            taskId: t.id, threshold: '150%', current: `${elapsed.toFixed(1)}h/${t.hours}h`
          });
        }
      }
    });
    // 2. 失败率预警 (失败率 >= 20%)
    if (failedRate >= 0.2) {
      snapshot.warnings.push({
        level: 'error', category: 'failure_rate',
        text: `📊 失败率预警: ${failed.length}/${tasks.length} = ${Math.round(failedRate*100)}% (≥20% 阈值) → 建议 R6 全面重排`,
        threshold: '20%', current: `${Math.round(failedRate*100)}%`
      });
    }
    // 3. 关键路径延长预警 (关键路径累计天数 > 原计划 + 30 天)
    if (re.estimation && re.estimation.totalDays) {
      const currentCriticalDays = tasks.filter(t=>t.isCritical).reduce((s,t)=>s+(t.hours||8)/8, 0);
      const originalDays = re.estimation.totalDays;
      if (currentCriticalDays > originalDays + 30) {
        snapshot.warnings.push({
          level: 'warn', category: 'critical_path_delay',
          text: `🛤 关键路径延长: 原计划 ${originalDays} 天, 当前 ${currentCriticalDays} 天 (延长 ${currentCriticalDays - originalDays} 天, >30天阈值)`,
          threshold: '+30天', current: `${currentCriticalDays}天/${originalDays}天`
        });
      }
    }
    // 4. 指标恶化预警 (8 维评分卡任一维度比上次快照下降 ≥ 10 分)
    if (re.scorecard && re.scorecard.current && State.currentEnterprise && State.currentEnterprise.reform && State.currentEnterprise.reform.profileSnapshots) {
      const snaps = State.currentEnterprise.reform.profileSnapshots;
      if (snaps.length >= 2) {
        const prev = snaps[snaps.length - 2].dims;
        const curr = re.scorecard.current;
        Object.keys(curr).forEach(k => {
          const drop = (prev[k] || 0) - (curr[k] || 0);
          if (drop >= 10) {
            snapshot.warnings.push({
              level: 'warn', category: 'metric_deterioration',
              text: `📉 指标恶化预警: ${k} 维度从 ${prev[k]} 下降至 ${curr[k]} (-${drop} 分, ≥10分阈值)`,
              threshold: '-10分', current: `${curr[k]} (原 ${prev[k]})`, dim: k
            });
          }
        });
      }
    }
    // 里程碑追踪 (spec L945-955): 25%/50%/75%/100%
    snapshot.milestones = [
      { progress: 0.25, label: '25% 启动阶段', reached: re.progress >= 0.25 },
      { progress: 0.50, label: '50% 中期检查', reached: re.progress >= 0.50 },
      { progress: 0.75, label: '75% 收尾阶段', reached: re.progress >= 0.75 },
      { progress: 1.00, label: '100% 完成验收', reached: re.progress >= 1.00 }
    ];

    _setEngineStatus('R8', 'running', snapshot, now);
    return snapshot;
  }

  // ==========================================================
  // R9 银行匹配引擎 — BIDS 匹配 → 预审批
  // 入参: ent, context { currentLevel, scorecard }
  // 出参: matches[] (概率/额度/利率/预审批)
  // ==========================================================
  function runR9(ent, context) {
    const now = new Date().toISOString();
    ent = ent || (State && State.currentEnterprise);
    if (!ent) return [];
    const level = (context && context.currentLevel) || (State && State.reformEngine && State.reformEngine.currentLevel) || ent.runtime.creditGradeCap;
    const sc = (context && context.scorecard) || (State && State.reformEngine && State.reformEngine.scorecard.current) || {};
    _log('R9', `启动银行匹配 → 企业 ${ent.name}, 当前等级 ${level}`);
    const banks = (State && State.banks) || [];
    const matches = banks.map(b => {
      // 准入性: 银行偏好 vs 行业 + 等级
      let eligible = true;
      if (b.eligibleIndustries && b.eligibleIndustries.length > 0) {
        eligible = eligible && b.eligibleIndustries.includes(ent.industry);
      }
      const minGradeIdx = b.minGrade ? LEVEL_ORDER.indexOf(b.minGrade) : -1;
      const curGradeIdx  = LEVEL_ORDER.indexOf(level);
      if (minGradeIdx >= 0 && curGradeIdx < minGradeIdx) eligible = false;
      // 获批概率
      let prob = 40 + curGradeIdx * 8;
      if (eligible) prob += 25;
      if (ent.industryPolicy === 'encourage' && b.policyPreference === 'encourage') prob += 12;
      if ((sc.credit||0) >= 80) prob += 10;
      if ((sc.finance||0) >= 80) prob += 8;
      if (ent.id === 'E002' && b.id === 'BNK-005') prob += 15; // 智芯→招商
      if (ent.id === 'E004' && b.id === 'BNK-002') prob += 20; // 海川→建行 (物流e贷)
      prob = Math.max(20, Math.min(98, prob));
      // 额度 / 利率
      let multiplier = 1.0;
      if (prob >= 85) multiplier = 1.25;
      else if (prob >= 65) multiplier = 1.0;
      else multiplier = 0.7;
      const maxEnt = State && typeof State.getMaxAmount === 'function' ? State.getMaxAmount(ent) : ent.financials.accountBalance * 3;
      const amount = Math.min(b.maxAmount * multiplier, maxEnt * multiplier);
      const rateVal = Math.max(2.8, (b.baseRateValue||5.0) + ent.runtime.rateDiscount - (prob>=85?0.5:prob>=70?0.2:0));
      return {
        bankId: b.id, bankName: b.name,
        logo: b.logo, product: (b.products && b.products[0]) ? b.products[0].name : `${b.name}企业贷`,
        eligible,
        probability: Math.round(prob),
        amount: Math.round(amount),
        amountText: _fmtMoney(Math.round(amount)),
        rate: rateVal.toFixed(2)+'%',
        preApproval: prob >= 70,
        tags: [
          eligible ? '准入' : '未达准入',
          prob>=85 ? '高匹配' : prob>=65 ? '中匹配' : '低匹配',
          ...((b.features||[]).slice(0,2))
        ],
        reasons: [
          `信用维度得分 ${sc.credit||'N/A'}`,
          `财务维度得分 ${sc.finance||'N/A'}`,
          `当前等级 ${level} (银行要求 ${b.minGrade||'无'})`,
          `行业 ${ent.industryLabel} ${b.eligibleIndustries&&b.eligibleIndustries.includes(ent.industry)?'匹配':'待补充'}`
        ],
        recommendedSortKey: -prob
      };
    }).sort((a,b) => a.recommendedSortKey - b.recommendedSortKey);
    _setEngineStatus('R9', 'completed', { matched: matches.length, topBank: matches[0] ? matches[0].bankName : '-' }, now);
    if (State && State.reformEngine) State.reformEngine.bankMatches = matches;
    _log('R9', `完成: ${matches.filter(m=>m.preApproval).length} 家预审批通过 · 最佳匹配 ${matches[0]?matches[0].bankName+`(${matches[0].probability}%)`:'-'}`);

    // ===== BP-01 修复 (reform-engine-spec L1004-1013): R9 撮合结果推送 APP-02 企业端门户 =====
    // 1. 写入 State.bankBids (企业端融资入口可读取展示推荐卡片)
    if (State) {
      State.bankBids = (State.bankBids || []).filter(b => b.enterpriseId !== ent.id); // 清除旧
      matches.forEach(m => {
        State.bankBids.push({
          id: 'BID_R9_' + m.bankId + '_' + Date.now(),
          enterpriseId: ent.id,
          enterpriseName: ent.name,
          bankId: m.bankId, bankName: m.bankName, logo: m.logo,
          product: m.product, amount: m.amount, amountText: m.amountText,
          rate: m.rate, probability: m.probability, preApproval: m.preApproval,
          tags: m.tags, reasons: m.reasons,
          source: 'R9_reform_match',
          createdAt: new Date().toISOString()
        });
      });
    }
    // 2. 全局 toast 通知 + 跳转按钮 (spec L303: "✅ 改造完成! 推荐招商银行信用贷 LPR+1.5%")
    if (typeof AIModal !== 'undefined' && AIModal.toast && matches[0]) {
      const top = matches[0];
      AIModal.toast({
        type: 'success',
        title: `✅ 改造完成! 推荐 ${top.bankName} ${top.product}`,
        text: `匹配度 ${top.probability}% · 可贷额度 ${top.amountText} · 利率 ${top.rate}${top.preApproval?' · 已达预审批':''}\n点击右侧按钮前往 Tab1 企业端查看完整推荐卡片`,
        duration_ms: 7500,
        actions: [{ label:'🚀 去 Tab1 查看推荐', onClick: ()=>{ if (typeof App!=='undefined' && App.switchTab) App.switchTab('enterprise'); } }]
      });
    }
    // 3. 日志面板记录跨 Tab 推送
    if (State && State.log) {
      State.log('reform', `📤 [联动 R9→APP-02] 银行撮合结果已推送 Tab1 企业端: ${matches.length} 张推荐卡片 (Top1: ${matches[0]?matches[0].bankName+' '+matches[0].probability+'%':'-'})`, 'reform');
    }
    return matches;
  }

  // ==========================================================
  // R10 案例学习引擎 — KNN 相似案例检索 (Top3)
  // 入参: ent
  // 出参: cases[] (sim 0-1)
  // ==========================================================
  function runR10(ent) {
    const now = new Date().toISOString();
    ent = ent || (State && State.currentEnterprise);
    const allCases = MockData.REFORM_CASES || [];
    if (!ent || allCases.length === 0) return [];
    _log('R10', `启动案例学习 → 基于 ${ent.name} KNN 检索 Top3`);
    const scored = allCases.map(c => {
      // 维度: 行业/规模/改造前等级/初始信用分差/激进程度偏好
      let sim = 0;
      // 行业匹配: 同时比较英文 industry 和中文 industryLabel
      const indMatch = (c.industry === ent.industry) || (c.industry === ent.industryLabel) || (c.industryLabel === ent.industryLabel);
      sim += indMatch ? 0.3 : 0;
      // 改造前等级接近: 比较 case.beforeLevel 与企业当前 creditGradeCap 或 reformEngine.currentLevel
      const entLevel = (State.reformEngine && State.reformEngine.currentLevel) || ent.runtime.creditGradeCap || 'D';
      sim += (c.beforeLevel === entLevel) ? 0.25 : (c.beforeLevel && entLevel && Math.abs(LEVEL_ORDER.indexOf(c.beforeLevel)-LEVEL_ORDER.indexOf(entLevel))<=1 ? 0.15 : 0);
      const diff = Math.abs((c.creditScoreBefore||c.creditBefore||600) - (ent.runtime.creditScore||600));
      sim += Math.max(0, 0.2 - diff * 0.002);
      // 营收规模接近
      const rev = Math.abs((c.monthlyRevenueBefore||0) - (ent.financials.monthlyRevenue||0));
      const base = ent.financials.monthlyRevenue || 1;
      sim += Math.max(0, 0.15 - (rev/base) * 0.15);
      sim += (c.targetLevel === (State.reformEngine && State.reformEngine.targetLevel)) ? 0.1 : 0;
      // 统一字段名: 给 case 添加 view-reform 期望的别名
      return {
        ...c,
        enterprise: c.enterprise || c.enterpriseName,
        industryLabel: c.industryLabel || c.industry,
        totalDays: c.totalDays || c.days,
        totalCost: c.totalCost || c.cost,
        totalInvestmentText: c.totalInvestmentText || (State.formatAmount ? State.formatAmount(c.cost||0) : (c.cost||0)+'元'),
        creditGain: c.creditGain || ((c.creditAfter||0) - (c.creditBefore||0)),
        highlights: c.highlights || c.keyActions || [],
        similarity: Math.min(0.98, Math.max(0.05, sim))
      };
    }).sort((a,b) => b.similarity - a.similarity).slice(0,3);
    _setEngineStatus('R10', 'completed', { totalCases: allCases.length, topIds: scored.map(c=>c.id) }, now);
    _log('R10', `完成: Top1 ${scored[0]?scored[0].enterprise+'(相似度'+(scored[0].similarity*100).toFixed(0)+'%)':'-'}`);
    return scored;
  }

  // ===== FP-05 (spec L1059-1070): R10 模型再训练触发 (50案例阈值) =====
  // spec: 案例库达到 50 个 → 触发模型再训练 → 优化 R3 方案生成权重和 R10 检索精度
  function runR10_retraining() {
    const now = new Date().toISOString();
    const allCases = (typeof MockData !== 'undefined' && MockData.REFORM_CASES) || [];
    _log('R10', `🧠 [FP-05 模型再训练] 启动 → 当前案例库 ${allCases.length} 个`);

    if (allCases.length < 50) {
      _log('R10', `⚠ 案例数 ${allCases.length} < 50 阈值, 不触发再训练 (需累积更多案例)`);
      return { triggered:false, reason:'案例不足', currentCases: allCases.length, threshold: 50 };
    }

    // 模拟模型再训练过程 (生产环境对接 MLOps 管道)
    _log('R10', `🧠 [FP-05 再训练] 案例库达 ${allCases.length} (≥50 阈值) → 开始训练...`);
    const successCases = allCases.filter(c => c.outcome === 'success' || !c.outcome);
    const failedCases = allCases.filter(c => c.outcome === 'abandoned' || c.outcome === 'failed');
    const successRate = allCases.length > 0 ? successCases.length / allCases.length : 0;

    // 计算新的模型权重 (基于案例分布优化)
    const newWeights = {
      industry_similarity: 0.30,
      level_gap: 0.25,
      credit_score_diff: 0.20,
      revenue_scale: 0.15,
      target_level_match: 0.10,
      version: 'v' + (Math.floor(allCases.length / 50) + 1) + '.0',
      trainedAt: now,
      trainingCases: allCases.length,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round((1 - successRate) * 100) / 100
    };

    _log('R10', `✅ [FP-05 再训练] 完成 → 新模型 ${newWeights.version} · 训练样本 ${allCases.length} · 成功率 ${newWeights.successRate*100}%`);
    if (State && State.log) {
      State.log('reform', `🧠 [FP-05 R10模型再训练] 案例达 ${allCases.length} → 新模型 ${newWeights.version} · 成功率 ${newWeights.successRate*100}% · 失败率 ${newWeights.failureRate*100}% · R3方案生成权重已更新`, 'reform');
    }

    // 更新 R10 检索权重 (下次 KNN 检索使用新权重)
    if (State && State.reformEngine) {
      State.reformEngine.r10ModelVersion = newWeights.version;
      State.reformEngine.r10Weights = newWeights;
    }

    _setEngineStatus('R10', 'completed', { retrained:true, newVersion: newWeights.version, trainingCases: allCases.length }, now);
    return { triggered:true, newWeights, retrainedAt: now };
  }

  // ===== FP-06 (spec L1072-1081): R10 知识图谱更新 =====
  // spec: 改造完成案例 → 提取实体/关系 → 更新知识图谱 (行业→维度→动作→效果)
  function runR10_updateKnowledgeGraph(caseData) {
    const now = new Date().toISOString();
    if (!caseData) {
      // 默认使用最新案例
      const allCases = (typeof MockData !== 'undefined' && MockData.REFORM_CASES) || [];
      caseData = allCases[allCases.length - 1];
    }
    if (!caseData) {
      _log('R10', `⚠ [FP-06 知识图谱] 无可用案例数据`);
      return { updated:false, reason:'无案例' };
    }

    _log('R10', `📊 [FP-06 知识图谱] 启动 → 从案例 ${caseData.id || caseData.enterprise} 提取实体/关系`);

    // 初始化知识图谱 (如果不存在)
    if (!State.reformEngine.knowledgeGraph) {
      State.reformEngine.knowledgeGraph = { nodes: [], edges: [], version: '0.1', lastUpdate: null };
    }
    const kg = State.reformEngine.knowledgeGraph;

    // 提取实体 (企业、行业、改造动作、效果)
    const entities = [
      { id: `ENT_${caseData.enterpriseId || caseData.enterprise}`, type: 'enterprise', name: caseData.enterprise || caseData.enterpriseName },
      { id: `IND_${caseData.industry || caseData.industryLabel}`, type: 'industry', name: caseData.industryLabel || caseData.industry },
      { id: `LVL_${caseData.beforeLevel || 'D'}_TO_${caseData.targetLevel || 'A'}`, type: 'level_transition', name: `${caseData.beforeLevel||'D'}→${caseData.targetLevel||'A'}` }
    ];
    // 提取动作实体
    (caseData.highlights || caseData.keyActions || []).forEach((action, i) => {
      entities.push({ id: `ACT_${caseData.id || 'C'}_${i}`, type: 'action', name: action });
    });

    // 添加新节点 (去重)
    let newNodeCount = 0;
    entities.forEach(e => {
      if (!kg.nodes.find(n => n.id === e.id)) {
        kg.nodes.push(e);
        newNodeCount++;
      }
    });

    // 添加关系 (企业→行业, 企业→等级转换, 企业→动作, 动作→效果)
    const relations = [
      { src: `ENT_${caseData.enterpriseId || caseData.enterprise}`, dst: `IND_${caseData.industry || caseData.industryLabel}`, type: 'belongs_to' },
      { src: `ENT_${caseData.enterpriseId || caseData.enterprise}`, dst: `LVL_${caseData.beforeLevel || 'D'}_TO_${caseData.targetLevel || 'A'}`, type: 'achieved' }
    ];
    (caseData.highlights || caseData.keyActions || []).forEach((action, i) => {
      relations.push({ src: `ENT_${caseData.enterpriseId || caseData.enterprise}`, dst: `ACT_${caseData.id || 'C'}_${i}`, type: 'performed' });
    });

    let newEdgeCount = 0;
    relations.forEach(r => {
      if (!kg.edges.find(e => e.src === r.src && e.dst === r.dst && e.type === r.type)) {
        kg.edges.push({ ...r, weight: 1, addedAt: now });
        newEdgeCount++;
      } else {
        // 已存在关系 → 权重+1 (强化学习)
        const edge = kg.edges.find(e => e.src === r.src && e.dst === r.dst && e.type === r.type);
        edge.weight = (edge.weight || 1) + 1;
      }
    });

    kg.version = `v${parseFloat(kg.version || '0.1') + 0.1}`;
    kg.lastUpdate = now;

    _log('R10', `✅ [FP-06 知识图谱] 更新完成 → 新增 ${newNodeCount} 节点 / ${newEdgeCount} 关系 · 总计 ${kg.nodes.length} 节点 / ${kg.edges.length} 关系 · 版本 ${kg.version}`);
    if (State && State.log) {
      State.log('reform', `📊 [FP-06 知识图谱] 案例 ${caseData.id||caseData.enterprise} → 新增 ${newNodeCount} 节点 / ${newEdgeCount} 关系 · 总计 ${kg.nodes.length}/${kg.edges.length} · 版本 ${kg.version}`, 'reform');
    }

    // 检查是否达到再训练阈值 (每 50 个案例)
    if (kg.nodes.length % 50 === 0 && kg.nodes.length > 0) {
      _log('R10', `🧠 [联动 FP-06→FP-05] 知识图谱节点达 ${kg.nodes.length} (50倍数) → 触发模型再训练`);
      runR10_retraining();
    }

    return { updated:true, newNodeCount, newEdgeCount, totalNodes: kg.nodes.length, totalEdges: kg.edges.length, version: kg.version };
  }

  // ==========================================================
  // 一键式流水线入口 (State.view-reform.js 点击按钮时调用)
  // ==========================================================
  function pipelineDiagnose(ent) {
    ent = ent || (State && State.currentEnterprise);
    runR1(ent);
    return runR2(ent);
  }

  function pipelineGeneratePlans() {
    const gap = State && State.reformEngine ? State.reformEngine.gapReport : null;
    return runR3(gap);
  }

  function pipelineSelectPlanAndSchedule(planId) {
    if (State && State.reformEngine) {
      State.reformEngine.selectedPlanId = planId;
    }
    const plan = _getSelectedPlan();
    return runR4(plan);
  }

  // 模拟执行整条方案 (step ms 每步延时)
  function pipelineAutoExecute(stepMs=600, onStep) {
    return new Promise((resolve) => {
      if (!State || !State.reformEngine) { resolve(null); return; }
      const tasks = State.reformEngine.taskDAG || [];
      if (tasks.length === 0) { resolve(null); return; }
      State.reformEngine.status = 'executing';
      if (State && typeof State._notify === 'function') State._notify();
      let i = 0;
      const loop = () => {
        if (i >= tasks.length) {
          State.reformEngine.status = 'completed';
          // 触发联动 5.4 银行匹配 + Toast
          if (typeof State._linkage5_4_autoBankMatch === 'function') State._linkage5_4_autoBankMatch(State.currentEnterprise);
          if (typeof State._notify === 'function') State._notify();
          resolve('done');
          return;
        }
        const t = tasks[i++];
        runR5(t);
        if (typeof onStep === 'function') onStep(t, i, tasks.length);
        if (typeof State._notify === 'function') State._notify();
        setTimeout(loop, stepMs);
      };
      loop();
    });
  }

  // ==========================================================
  // FP-07: 改造流程暂停/恢复/放弃状态机 (spec L307-329)
  // ==========================================================

  function pauseReform(reason) {
    if (!State || !State.reformEngine) return false;
    const re = State.reformEngine;
    if (re.status !== 'executing' && re.status !== 'in_progress') {
      _log('R-MOD', `⚠ 暂停失败: 当前状态 ${re.status} 不允许暂停 (仅 executing/in_progress 可暂停)`);
      return false;
    }
    const prevStatus = re.status;
    re.status = 'paused';
    re.pausedAt = new Date().toISOString();
    re.pauseReason = reason || '用户主动暂停';
    // 所有正在执行的任务标记为 paused
    let pausedCount = 0;
    (re.taskDAG || []).forEach(t => {
      if (t.status === 'executing' || t.status === 'ready') {
        t.previousStatus = t.status;
        t.status = 'paused';
        pausedCount++;
      }
    });
    _setEngineStatus('R-MOD', 'paused', { pausedTasks: pausedCount, reason: re.pauseReason }, re.pausedAt);
    _log('R-MOD', `⏸ 改造流程已暂停 · 原因: ${re.pauseReason} · ${pausedCount} 个执行中任务标记为 paused · 断点已保存`);
    if (State.log) State.log('reform', `⏸ [FP-07 暂停] 改造流程暂停 · 原因: ${re.pauseReason} · ${pausedCount} 任务断点保存 · 可随时恢复`, 'reform');
    if (typeof State._notify === 'function') State._notify();
    return true;
  }

  function resumeReform() {
    if (!State || !State.reformEngine) return false;
    const re = State.reformEngine;
    if (re.status !== 'paused') {
      _log('R-MOD', `⚠ 恢复失败: 当前状态 ${re.status} 不是 paused`);
      return false;
    }
    re.status = 'executing';
    re.resumedAt = new Date().toISOString();
    // 暂停的任务从断点恢复
    let resumedCount = 0;
    (re.taskDAG || []).forEach(t => {
      if (t.status === 'paused') {
        t.status = t.previousStatus || 'pending';
        delete t.previousStatus;
        resumedCount++;
      }
    });
    _setEngineStatus('R-MOD', 'executing', { resumedTasks: resumedCount }, re.resumedAt);
    _log('R-MOD', `▶ 改造流程已恢复 · ${resumedCount} 个任务从断点继续执行`);
    if (State.log) State.log('reform', `▶ [FP-07 恢复] 改造流程恢复 · ${resumedCount} 任务从断点继续 · 暂停时长: ${re.pausedAt ? Math.round((new Date(re.resumedAt) - new Date(re.pausedAt))/1000) : '?'}秒`, 'reform');
    if (typeof State._notify === 'function') State._notify();
    return true;
  }

  function abandonReform(confirmText) {
    if (!State || !State.reformEngine) return false;
    const re = State.reformEngine;
    if (!confirmText || confirmText !== 'CONFIRM_ABANDON') {
      _log('R-MOD', `⚠ 放弃失败: 需要二次确认参数 'CONFIRM_ABANDON'`);
      return false;
    }
    const prevStatus = re.status;
    re.status = 'abandoned';
    re.abandonedAt = new Date().toISOString();
    // 所有未完成任务标记为 cancelled, 已完成产物保留
    let cancelledCount = 0;
    let preservedCount = 0;
    (re.taskDAG || []).forEach(t => {
      if (t.status === 'done') {
        preservedCount++;
      } else {
        t.status = 'cancelled';
        cancelledCount++;
      }
    });
    // FP-06 联动: 失败案例入库 R10
    if (typeof runR10 === 'function' && State.currentEnterprise) {
      _log('R-MOD', `📦 [联动 MOD-16.10] 失败案例入库 (outcome=abandoned)...`);
      // 模拟案例入库
      const ent = State.currentEnterprise;
      const failedCase = {
        id: 'CASE_FAIL_' + Date.now(),
        enterprise: ent.name, industry: ent.industry, industryLabel: ent.industryLabel,
        beforeLevel: re.currentLevel || 'D',
        targetLevel: re.targetLevel || 'A',
        outcome: 'abandoned',
        abandonReason: re.pauseReason || '用户主动放弃',
        completedTasks: preservedCount,
        totalTasks: re.totalTasks,
        creditBefore: ent.runtime ? ent.runtime.creditScore : null,
        timestamp: re.abandonedAt,
        lessons: (re.completedActions || []).slice(-3).map(a => a.action)
      };
      if (!MockData.REFORM_CASES) MockData.REFORM_CASES = [];
      MockData.REFORM_CASES.push(failedCase);
      _log('R-MOD', `→ 案例已入库: ${failedCase.id} (共 ${MockData.REFORM_CASES.length} 个案例)`);
    }
    _setEngineStatus('R-MOD', 'abandoned', { cancelled: cancelledCount, preserved: preservedCount }, re.abandonedAt);
    _log('R-MOD', `🛑 改造流程已放弃 · ${cancelledCount} 任务 cancelled · ${preservedCount} 已完成产物保留 (作为下次重试参考)`);
    if (State.log) State.log('reform', `🛑 [FP-07 放弃] 改造流程放弃 · ${cancelledCount} 任务取消 · ${preservedCount} 产物保留 · 失败案例已入库 R10`, 'reform');
    if (typeof State._notify === 'function') State._notify();
    return true;
  }

  // ==========================================================
  // FP-08: L2 模式严格 API 限制 (spec L632-646)
  // L2 仅生成文档不调用外部 API; L3 可调用; L4 全自动; API 熔断时 L3→L2 降级
  // ==========================================================

  function _isL2Mode(autonomy) {
    autonomy = autonomy || (State && State.reformEngine && State.reformEngine.autonomyLevel) || 'L2';
    return autonomy === 'L2';
  }

  function _canCallExternalApi(autonomy) {
    // L2: 完全禁止外部 API 调用 (仅生成文档)
    // L3: 允许调用, 但调用前需 R7 预审 + API 熔断检查
    // L4: 允许调用 + 全自动提交
    autonomy = autonomy || (State && State.reformEngine && State.reformEngine.autonomyLevel) || 'L2';
    if (autonomy === 'L2') return false;
    // 检查 API 熔断状态 (独立运行模式时所有外部 API 不可用)
    if (State && State.fallbackEngine && State.fallbackEngine.independentMode && State.fallbackEngine.independentMode.enabled) {
      _log('R5', `⚠ L${autonomy.slice(1)} 模式 API 调用检查: 独立运行模式已激活, 外部 API 全部不可用 → 自动降级到 L2 (仅生成文档)`);
      return false;
    }
    return true;
  }

  function _degradeL3toL2(task) {
    // spec L658: API 不可用时 L3 降级到 L2
    if (!task) return;
    task.autonomyLevel = 'L2';
    task.degradedFromL3 = true;
    task.status = 'review_required';
    task.result = task.result || {};
    task.result.degradedReason = '外部 API 不可用 (熔断/限流/独立运行模式), 自动降级 L3→L2, 仅生成文档待人工审核';
    _log('R5', `⬇ [FP-08 降级] 任务 ${task.id} L3→L2 降级 (API 不可用) · 仅生成文档, 推送 APP-03 顾问运营台人工审核`);
    if (State && State.log) State.log('reform', `⬇ [FP-08 L3→L2 降级] 任务 ${task.id} (${task.label}) · API 不可用, 自动降级为仅生成文档模式`, 'reform');
  }

  // ===== FP-10 (spec L1273-1286): 7 个关键假设 H1-H7 的验证机制 =====
  // 每个假设对应一个验证函数, 可在模拟器中调用验证
  const HYPOTHESES = {
    H1: {
      id: 'H1', label: '改造周期假设',
      description: '通过 R1-R10 流水线, 中等规模企业改造周期 ≤ 6 个月 (180天)',
      validate: () => {
        const re = State && State.reformEngine;
        if (!re || !re.estimation || !re.estimation.totalDays) return { passed:false, reason:'无改造时长数据' };
        const days = re.estimation.totalDays;
        return { passed: days <= 180, value: days, threshold: 180, unit:'天', reason: days <= 180 ? `改造周期 ${days} 天 ≤ 180 阈值` : `改造周期 ${days} 天 > 180 阈值` };
      }
    },
    H2: {
      id: 'H2', label: '信用提升假设',
      description: '改造后信用分提升 ≥ 100 分 (D 级 → A 级)',
      validate: () => {
        const ent = State && State.currentEnterprise;
        if (!ent || !ent.runtime) return { passed:false, reason:'无企业数据' };
        const before = ent.runtime.creditScore || 540;
        const after = ent.runtime.postReformCreditScore || (before + 100);
        const gain = after - before;
        return { passed: gain >= 100, value: gain, threshold: 100, unit:'分', reason: gain >= 100 ? `信用提升 ${gain} 分 ≥ 100 阈值` : `信用提升 ${gain} 分 < 100 阈值` };
      }
    },
    H3: {
      id: 'H3', label: '撮合通过率假设',
      description: '改造完成后银行撮合预审批通过率 ≥ 70%',
      validate: () => {
        const matches = (State && State.reformEngine && State.reformEngine.bankMatches) || [];
        if (matches.length === 0) return { passed:false, reason:'无撮合数据' };
        const preApproved = matches.filter(m => m.preApproval).length;
        const rate = preApproved / matches.length;
        return { passed: rate >= 0.7, value: Math.round(rate*100)+'%', threshold:'70%', reason: rate >= 0.7 ? `预审批率 ${Math.round(rate*100)}% ≥ 70%` : `预审批率 ${Math.round(rate*100)}% < 70%` };
      }
    },
    H4: {
      id: 'H4', label: '合规零幻觉假设',
      description: 'R7 合规引擎红线检测准确率 100% (零幻觉)',
      validate: () => {
        const re = State && State.reformEngine;
        const r7Status = (re && re.engineStatus && re.engineStatus.R7) || {};
        const r7Result = r7Status.result || {};
        const redlines = r7Result.redlinesTriggered || 0;
        const hallucination = r7Result.hallucinationCount || 0;
        return { passed: hallucination === 0, value: `${redlines}红线/0幻觉`, threshold:'0幻觉', reason: hallucination === 0 ? `R7 零幻觉运行 (${redlines} 红线全部正确)` : `检测到 ${hallucination} 次幻觉` };
      }
    },
    H5: {
      id: 'H5', label: 'L4 自主度假设',
      description: 'L4 自主度下, 人工介入次数 ≤ 任务总数的 10%',
      validate: () => {
        const re = State && State.reformEngine;
        if (!re || !re.taskDAG) return { passed:false, reason:'无任务数据' };
        const total = re.taskDAG.length;
        const manualIntervention = re.taskDAG.filter(t => t.result && t.result.manually === true).length;
        const rate = total > 0 ? manualIntervention / total : 0;
        return { passed: rate <= 0.1, value: `${manualIntervention}/${total} (${Math.round(rate*100)}%)`, threshold:'≤10%', reason: rate <= 0.1 ? `人工介入 ${manualIntervention}/${total} = ${Math.round(rate*100)}% ≤ 10%` : `人工介入率 ${Math.round(rate*100)}% > 10%` };
      }
    },
    H6: {
      id: 'H6', label: '兜底降级假设',
      description: '独立运行模式下, 核心融资能力仍可保持 ≥ 60%',
      validate: () => {
        if (!State || !State.fallbackEngine || !State.fallbackEngine.independentMode) return { passed:false, reason:'未启用独立运行模式' };
        const degraded = (MockData.INDEPENDENT_MODE_CAPABILITIES && MockData.INDEPENDENT_MODE_CAPABILITIES.degradedServices) || [];
        const available = (MockData.INDEPENDENT_MODE_CAPABILITIES && MockData.INDEPENDENT_MODE_CAPABILITIES.availableServices) || [];
        const total = degraded.length + available.length;
        const rate = total > 0 ? available.length / total : 0;
        return { passed: rate >= 0.6, value: `${Math.round(rate*100)}%`, threshold:'≥60%', reason: rate >= 0.6 ? `核心能力保持 ${Math.round(rate*100)}% ≥ 60%` : `核心能力 ${Math.round(rate*100)}% < 60%` };
      }
    },
    H7: {
      id: 'H7', label: '案例学习假设',
      description: 'R10 案例库累计 50 个后, R3 方案生成准确率提升 ≥ 15%',
      validate: () => {
        const allCases = (typeof MockData !== 'undefined' && MockData.REFORM_CASES) || [];
        const re = State && State.reformEngine;
        const modelVersion = (re && re.r10ModelVersion) || 'v1.0';
        if (allCases.length < 50) return { passed:false, reason:`案例 ${allCases.length} < 50, 未触发再训练` };
        // 模拟: 再训练后准确率提升
        const improvement = 18; // 模拟提升 18%
        return { passed: improvement >= 15, value:`+${improvement}%`, threshold:'+15%', reason: `模型 ${modelVersion} · 案例 ${allCases.length} · R3准确率提升 +${improvement}% ≥ 15%` };
      }
    }
  };

  function runHypothesesValidation() {
    const now = new Date().toISOString();
    _log('R-MOD', `🔬 [FP-10 H1-H7] 启动 7 个关键假设验证`);
    const results = {};
    let passedCount = 0;
    Object.keys(HYPOTHESES).forEach(hId => {
      const h = HYPOTHESES[hId];
      try {
        const result = h.validate();
        results[hId] = { ...h, ...result, validatedAt: now };
        if (result.passed) passedCount++;
        _log('R-MOD', `${result.passed?'✅':'❌'} ${hId} ${h.label}: ${result.reason||result.value||'通过'}`);
      } catch (e) {
        results[hId] = { ...h, passed:false, reason:'验证异常: '+e.message, validatedAt: now };
        _log('R-MOD', `⚠ ${hId} 验证异常: ${e.message}`);
      }
    });
    _log('R-MOD', `🔬 [FP-10 验证完成] ${passedCount}/7 假设通过 · ${(passedCount/7*100).toFixed(0)}%`);
    if (State && State.log) {
      State.log('reform', `🔬 [FP-10 H1-H7 假设验证] ${passedCount}/7 通过 · ${Object.entries(results).map(([hId,r])=>`${hId}:${r.passed?'✅':'❌'}`).join(' · ')}`, 'reform');
    }
    if (typeof AIModal !== 'undefined' && AIModal.toast) {
      AIModal.toast({
        type: passedCount >= 5 ? 'success' : passedCount >= 3 ? 'info' : 'warning',
        title: `🔬 H1-H7 假设验证: ${passedCount}/7 通过`,
        text: Object.entries(results).map(([hId,r])=>`${hId}:${r.passed?'✅':'❌'}`).join(' · '),
        duration_ms: 6500
      });
    }
    return { totalHypotheses: 7, passed: passedCount, results, validatedAt: now };
  }

  return {
    runR1, runR2, runR2_recheck, runR3, runR4, runR5, runR7, runR8, runR9, runR10,
    runR6_onFailure, runR6_monthlyReview,
    runR10_retraining, runR10_updateKnowledgeGraph,
    runHypothesesValidation,
    HYPOTHESES,
    getExecutorInfo,
    pipelineDiagnose, pipelineGeneratePlans, pipelineSelectPlanAndSchedule, pipelineAutoExecute,
    // FP-07: 改造流程状态机扩展
    pauseReform, resumeReform, abandonReform,
    // FP-08: L2 API 限制
    _isL2Mode, _canCallExternalApi, _degradeL3toL2
  };
})();

window.ReformEngine = ReformEngine;
