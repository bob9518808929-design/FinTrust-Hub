/**
 * scf-engine.js — 供应链金融 (SCF) 引擎族 SC1-SC10
 * 对齐 simulation-plan.md 第七章 + spec.md MOD-16
 *
 * SC1  供应链画像引擎    — 13维画像 + 关系图谱构建
 * SC2  黑白名单引擎     — 准入/禁入判定 + 5类触发条件
 * SC3  信用传导引擎     — 三层信用分 (独立/传导/场景)
 * SC4  贸易验证引擎     — 五流 + 贸易专项 (PO-发票匹配/物流-合同匹配)
 * SC5  产品路由引擎     — 5类产品智能匹配
 * SC6  定价引擎         — 利率/费率动态计算
 * SC7  风险扩散引擎     — 风险传导预警
 * SC8  机构撮合引擎     — 多方金融机构竞标
 * SC9  履约监控引擎     — 贷后贸易持续验证 + 闭环回流
 * SC10 案例学习引擎     — SCF 案例库检索
 */

const SCFEngine = {

  // ============================================================
  // SC1 供应链画像引擎
  // ============================================================

  /** 构建企业 13 维画像 + 关系图谱 */
  SC1_buildProfile(entId) {
    const ent = State.getSCFEnterprise(entId);
    if (!ent) return null;

    const baseDims = this._calcBaseDims(ent);
    const scfDims = this._calcSCFDims(ent);
    const overallScore = Math.round(
      Object.values(baseDims).reduce((a, b) => a + b, 0) / 8 * 0.6 +
      Object.values(scfDims).reduce((a, b) => a + b, 0) / 5 * 0.4
    );
    const tags = this._generateTags(ent, baseDims, scfDims);
    const riskFlags = this._scanRiskFlags(ent);

    const profile = {
      enterpriseId: ent.id,
      enterpriseName: ent.name,
      role: ent.role,
      timestamp: new Date().toISOString(),
      baseDims,
      scfDims,
      overallScore,
      tags,
      riskFlags,
      recommendedProducts: []
    };

    ent.profile = profile;
    State.logSCF('SC1', `画像构建完成: ${ent.name} | 综合分 ${overallScore} | 标签 ${tags.join('/')}`);
    State.updateSCFEngineStatus('SC1', 'completed', profile);
    return profile;
  },

  /** 计算 8 维基础评分 (0-100) */
  _calcBaseDims(ent) {
    const credit = ent.credit.ownScore;
    return {
      subject: Math.min(100, Math.round(credit / 850 * 100 * 0.9 + 10)),
      finance: Math.min(100, Math.round(credit / 850 * 80 + (ent.tradeStats.overdueCount === 0 ? 20 : 0))),
      tax: Math.min(100, Math.round(ent.tradeStats.verificationRate * 100)),
      business: Math.min(100, Math.round(ent.tradeStats.verificationRate * 90 + 10)),
      assets: Math.min(100, Math.round(credit / 850 * 70 + 20)),
      credit: Math.min(100, Math.round(credit / 850 * 100)),
      policy: ent.supplyChainProfile.seatLevel === 'platinum' ? 95 :
              ent.supplyChainProfile.seatLevel === 'gold' ? 80 :
              ent.supplyChainProfile.seatLevel === 'silver' ? 65 : 50,
      capital: Math.min(100, Math.round(Math.log10(ent.registeredCapital) * 12))
    };
  },

  /** 计算供应链 5 维评分 (0-100) */
  _calcSCFDims(ent) {
    const stats = ent.tradeStats;
    const scp = ent.supplyChainProfile;
    // 从关系数据中获取 tradeStability (企业自身无此字段, 需从关联关系聚合)
    const rels = State.scfDatabase.relationships.filter(r => r.partnerId === ent.id);
    const avgTradeStability = rels.length > 0
      ? rels.reduce((s, r) => s + (r.strength.tradeStability || 0.7), 0) / rels.length
      : 0.7;
    return {
      tradeStability: Math.min(100, Math.round(
        Math.min(100, stats.totalTrades * 2) * 0.5 +
        avgTradeStability * 100 * 0.5
      )),
      tradeAuthenticity: Math.round(stats.verificationRate * 100),
      cooperationLoyalty: Math.min(100, Math.round(
        Math.min(100, scp.cooperationYears * 20) * 0.6 +
        (1 - Math.min(1, stats.overdueCount / 10)) * 100 * 0.4
      )),
      performanceReliability: Math.min(100, Math.round(
        (1 - Math.min(1, stats.overdueCount / 30)) * 100
      )),
      networkPosition: this._calcNetworkCentrality(ent.id)
    };
  },

  /** 计算网络中心度 (简化: 基于关系数 + 关系强度) */
  _calcNetworkCentrality(entId) {
    const rels = State.scfDatabase.relationships.filter(r => r.partnerId === entId);
    if (rels.length === 0) return 30;
    const avgStrength = rels.reduce((s, r) => s + r.strength.tradeStability, 0) / rels.length;
    return Math.min(100, Math.round(rels.length * 25 + avgStrength * 25));
  },

  /** 自动生成企业标签 */
  _generateTags(ent, base, scf) {
    const tags = [];
    if (ent.credit.ownScore >= 750) tags.push('优质企业');
    else if (ent.credit.ownScore >= 700) tags.push('良好企业');
    if (scf.cooperationLoyalty >= 80) tags.push('高忠诚度');
    if (scf.tradeAuthenticity >= 90) tags.push('贸易真实');
    if (scf.performanceReliability >= 90) tags.push('低风险');
    if (ent.supplyChainProfile.seatLevel === 'platinum') tags.push('白金席位');
    else if (ent.supplyChainProfile.seatLevel === 'gold') tags.push('黄金席位');
    if (ent.role === 'supplier') tags.push('供应商');
    if (ent.role === 'distributor') tags.push('经销商');
    return tags;
  },

  /** 风险标记扫描 */
  _scanRiskFlags(ent) {
    const flags = [];
    if (ent.credit.ownScore < 600) flags.push({ level: 'high', desc: '信用分偏低' });
    if (ent.tradeStats.overdueCount > 0) flags.push({ level: 'medium', desc: `历史逾期${ent.tradeStats.overdueCount}次` });
    if (ent.tradeStats.verificationRate < 0.85) flags.push({ level: 'medium', desc: '贸易验证通过率偏低' });
    if (ent.credit.blacklistStatus === 'warning') flags.push({ level: 'high', desc: '黑名单预警状态' });
    return flags;
  },

  /** SC1: 构建关系图谱 (nodes + edges + clusters) */
  SC1_buildGraph() {
    const nodes = [];
    const edges = [];

    // 核心企业节点 (从 State.enterprises 取已认证的核心企业)
    const anchorIds = [...new Set(State.scfDatabase.relationships.map(r => r.anchorId))];
    anchorIds.forEach(aid => {
      const anchor = State.getAnchorEnterprise(aid);
      nodes.push({
        id: aid,
        name: anchor ? anchor.name : aid,
        type: 'anchor',
        creditScore: State.getAnchorCreditScore(aid),
        profileScore: null,
        seatLevel: 'anchor',
        status: 'active'
      });
    });

    // 上下游企业节点
    State.scfDatabase.enterprises.forEach(ent => {
      nodes.push({
        id: ent.id,
        name: ent.name,
        type: ent.role,
        creditScore: ent.credit.ownScore,
        profileScore: ent.profile ? ent.profile.overallScore : null,
        seatLevel: ent.supplyChainProfile.seatLevel,
        status: ent.status
      });
    });

    // 关系边
    State.scfDatabase.relationships.forEach(rel => {
      edges.push({
        source: rel.partnerRole === 'supplier' ? rel.partnerId : rel.anchorId,
        target: rel.partnerRole === 'supplier' ? rel.anchorId : rel.partnerId,
        type: rel.partnerRole === 'supplier' ? 'supply' : 'distribute',
        weight: rel.strength.tradeStability,
        tradeVolume: rel.terms.contractValue,
        direction: rel.relationshipType
      });
    });

    // 聚类 (按核心企业分组)
    const clusters = anchorIds.map(aid => {
      const members = State.scfDatabase.relationships
        .filter(r => r.anchorId === aid)
        .map(r => r.partnerId);
      members.push(aid);
      const anchorScore = State.getAnchorCreditScore(aid);
      const partnerScores = members
        .filter(id => id !== aid)
        .map(id => {
          const e = State.getSCFEnterprise(id);
          return e ? e.credit.ownScore : 0;
        });
      const allScores = [anchorScore, ...partnerScores];
      const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
      return {
        id: `CLUSTER-${aid}`,
        anchorId: aid,
        memberIds: members,
        totalTradeVolume: State.scfDatabase.relationships
          .filter(r => r.anchorId === aid)
          .reduce((s, r) => s + r.terms.contractValue, 0),
        avgCreditScore: Math.round(avg),
        riskLevel: avg >= 720 ? 'low' : avg >= 650 ? 'medium' : 'high'
      };
    });

    State.scfDatabase.graph = { nodes, edges, clusters };
    State.logSCF('SC1', `关系图谱构建: ${nodes.length}节点 / ${edges.length}边 / ${clusters.length}聚类`);
    return State.scfDatabase.graph;
  },

  // ============================================================
  // SC2 黑白名单引擎
  // ============================================================

  /** 检查企业是否在黑名单 */
  SC2_checkBlacklist(entId) {
    return State.scfDatabase.blacklist.find(b => b.enterpriseId === entId && b.type === 'blacklist');
  },

  /** 加入黑名单 */
  SC2_addToBlacklist(entId, reason, evidence, triggerRule) {
    const ent = State.getSCFEnterprise(entId);
    const entry = {
      enterpriseId: entId,
      enterpriseName: ent ? ent.name : entId,
      type: 'blacklist',
      reason,
      evidence: evidence || [],
      triggerRule,
      blacklistedAt: new Date().toISOString().slice(0, 10),
      blacklistedBy: 'SC2引擎自动',
      appealStatus: 'none'
    };
    // 去重: 同一企业不重复拉黑
    if (!this.SC2_checkBlacklist(entId)) {
      State.scfDatabase.blacklist.push(entry);
      if (ent) ent.credit.blacklistStatus = 'blacklist';
      State.logSCF('SC2', `🚫 黑名单触发: ${entry.enterpriseName} | 原因: ${reason} | 规则: ${triggerRule}`);
    }
    State._persistSCF();
    return entry;
  },

  /** 加入白名单 */
  SC2_addToWhitelist(entId, reason) {
    const ent = State.getSCFEnterprise(entId);
    const entry = {
      enterpriseId: entId,
      enterpriseName: ent ? ent.name : entId,
      type: 'whitelist',
      reason,
      addedAt: new Date().toISOString().slice(0, 10),
      addedBy: 'SC2引擎'
    };
    if (!State.scfDatabase.whitelist.find(w => w.enterpriseId === entId)) {
      State.scfDatabase.whitelist.push(entry);
      State.logSCF('SC2', `✅ 白名单加入: ${entry.enterpriseName} | 原因: ${reason}`);
    }
    State._persistSCF();
    return entry;
  },

  /** 准入判定: 白名单优先 > 黑名单拒绝 > 信用分阈值 */
  SC2_checkAdmission(entId) {
    const whitelist = State.scfDatabase.whitelist.find(w => w.enterpriseId === entId);
    if (whitelist) {
      return { admitted: true, reason: `白名单企业 (${whitelist.reason})`, channel: 'whitelist' };
    }
    const blacklist = this.SC2_checkBlacklist(entId);
    if (blacklist) {
      return { admitted: false, reason: `黑名单企业 (${blacklist.reason})`, channel: 'blacklist', entry: blacklist };
    }
    const ent = State.getSCFEnterprise(entId);
    if (!ent) return { admitted: false, reason: '企业不存在', channel: 'not_found' };
    if (ent.credit.ownScore < 600) {
      return { admitted: false, reason: `信用分不足 (${ent.credit.ownScore}<600)`, channel: 'credit_threshold' };
    }
    return { admitted: true, reason: `信用分达标 (${ent.credit.ownScore})`, channel: 'credit_threshold' };
  },

  /** 黑名单申诉 */
  SC2_appealBlacklist(entId, reason) {
    const entry = this.SC2_checkBlacklist(entId);
    if (entry) {
      entry.appealStatus = 'pending';
      entry.appealReason = reason;
      State.logSCF('SC2', `📝 黑名单申诉: ${entry.enterpriseName} | 申诉理由: ${reason}`);
      State._persistSCF();
    }
    return entry;
  },

  /** 触发黑名单 (5类触发条件) */
  SC2_triggerBlacklist(entId, triggerType, evidence) {
    const rules = {
      fake_trade: { reason: '虚假贸易·发票虚开/合同造假', rule: 'SC2-规则1: 贸易真实性验证失败 (SC4触发)' },
      severe_overdue: { reason: '严重逾期·回款逾期>90天', rule: 'SC2-规则2: 严重逾期 (SC9触发)' },
      circular_trade: { reason: '关联方循环交易', rule: 'SC2-规则3: 关联方循环交易 (B7图欺诈检测+图谱环检测)' },
      dishonest: { reason: '失信被执行人', rule: 'SC2-规则4: 失信被执行人 (API-04司法查询触发)' },
      low_credit: { reason: '信用分<500持续30天', rule: 'SC2-规则5: 信用分持续偏低 (SC3触发)' }
    };
    const cfg = rules[triggerType];
    if (!cfg) return null;
    return this.SC2_addToBlacklist(entId, cfg.reason, evidence || [], cfg.rule);
  },

  // ============================================================
  // SC3 信用传导引擎
  // ============================================================

  /** 计算传导信用分 */
  SC3_calculateTransmittedCredit(anchorId, partnerId) {
    const ent = State.getSCFEnterprise(partnerId);
    const rel = State.scfDatabase.relationships.find(r => r.anchorId === anchorId && r.partnerId === partnerId);
    if (!ent || !rel) return null;

    const baseScore = ent.credit.ownScore;
    const anchorScore = State.getAnchorCreditScore(anchorId);
    const stabilityFactor = this._calcStabilityFactor(rel);
    const cooperationBonus = this._calcCooperationBonus(anchorScore, rel.terms.contractValue, rel.strength.cooperationYears);

    // 公式: 传导分 = 基础分×0.5 + 核心企业分×0.3×合作稳定系数 + 历史交易加成×0.2
    const transmittedScore = Math.min(850, Math.round(
      baseScore * 0.5 + anchorScore * 0.3 * stabilityFactor + cooperationBonus * 0.2
    ));

    const result = {
      anchorId,
      partnerId,
      originalScore: baseScore,
      anchorScore,
      transmittedScore,
      improvement: transmittedScore - baseScore,
      stabilityFactor,
      cooperationBonus,
      calculatedAt: new Date().toISOString()
    };

    // 更新企业传导信用分
    ent.credit.propagatedScore = transmittedScore;

    // 记录传导历史
    State.scfDatabase.creditPropagation.push(result);

    State.logSCF('SC3', `信用传导: ${ent.name} | 独立 ${baseScore} → 传导 ${transmittedScore} (+${result.improvement}) | 稳定系数 ${stabilityFactor.toFixed(2)}`);
    return result;
  },

  /** 计算合作稳定系数 (0-1) */
  _calcStabilityFactor(rel) {
    const years = rel.strength.cooperationYears;
    const stability = rel.strength.tradeStability;
    const overdueFactor = 1; // 简化: 已在 SC1 画像中体现
    return Math.max(0, Math.min(1, (years / 5) * 0.4 + stability * 0.6)) * overdueFactor;
  },

  /** 计算合作加成 (0-50) */
  _calcCooperationBonus(anchorCredit, volume, years) {
    const volumeFactor = Math.min(1, volume / 10000000);
    const yearFactor = Math.min(1, years / 5);
    return Math.min(50, Math.round(anchorCredit * 0.15 * volumeFactor * yearFactor));
  },

  /** 计算场景信用分 */
  SC3_calculateSceneCredit(transmittedScore, tradeVerificationLevel, collateralCoverage) {
    const verificationFactor = tradeVerificationLevel === 'verified' ? 1.0 :
                               tradeVerificationLevel === 'partial' ? 0.7 : 0.3;
    const coverage = collateralCoverage || 0;
    // 公式: 场景分 = 传导分×贸易验证通过率 + 押品覆盖率×0.2
    return Math.round(transmittedScore * verificationFactor + coverage * 0.2 * 100);
  },

  // ============================================================
  // SC4 贸易验证引擎
  // ============================================================

  /** 贸易真实性验证 */
  SC4_verifyTrade(tradeId) {
    const trade = State.scfDatabase.trades.find(t => t.id === tradeId);
    if (!trade) return null;

    const v = trade.verification;
    // 基础五流验证 (复用 State.verifyFiveStreams 的判定逻辑, 这里直接读 trade.verification)
    const baseChecks = ['contract', 'invoice', 'logistics', 'fund', 'iot'];
    const basePassed = baseChecks.filter(k => v[k] && v[k].passed).length;
    const baseTotal = baseChecks.length;

    // 贸易专项验证
    const poInvoiceMatch = v.poInvoiceMatch && v.poInvoiceMatch.passed;
    const logisticsContractMatch = v.logisticsContractMatch && v.logisticsContractMatch.passed;

    // 综合判定
    let level;
    if (basePassed >= 4 && poInvoiceMatch && logisticsContractMatch) {
      level = 'verified';
    } else if (basePassed >= 3 && (poInvoiceMatch || logisticsContractMatch)) {
      level = 'partial';
    } else {
      level = 'unverified';
    }

    trade.verificationLevel = level;
    trade.canUseForFinancing = level === 'verified' || (level === 'partial' && basePassed >= 3);

    // 虚假贸易检测 → 触发 SC2 黑名单
    if (level === 'unverified' && basePassed <= 1) {
      State.logSCF('SC4', `⚠️ 疑似虚假贸易: ${trade.id} | 基础五流通过 ${basePassed}/${baseTotal} | 触发 SC2 黑名单`);
      this.SC2_triggerBlacklist(trade.partnerId, 'fake_trade', [
        `贸易 ${trade.id} 验证失败`,
        `基础五流通过 ${basePassed}/${baseTotal}`,
        `PO-发票匹配: ${poInvoiceMatch ? '通过' : '失败'}`,
        `物流-合同匹配: ${logisticsContractMatch ? '通过' : '失败'}`
      ]);
    }

    State.logSCF('SC4', `贸易验证: ${trade.id} | 等级 ${level} | 基础 ${basePassed}/${baseTotal} | PO匹配 ${poInvoiceMatch ? '✓' : '✗'} | 物流合同匹配 ${logisticsContractMatch ? '✓' : '✗'}`);
    State._persistSCF();
    return { tradeId, level, basePassed, baseTotal, poInvoiceMatch, logisticsContractMatch };
  },

  // ============================================================
  // SC5 产品路由引擎
  // ============================================================

  /** 产品匹配 */
  SC5_matchProducts(tradeId, partnerId) {
    const trade = State.scfDatabase.trades.find(t => t.id === tradeId);
    const ent = State.getSCFEnterprise(partnerId);
    if (!trade || !ent) return [];

    const matches = [];
    const anchorScore = State.getAnchorCreditScore(trade.anchorId);
    const verificationOk = trade.verificationLevel === 'verified';
    const partialOk = trade.verificationLevel === 'partial';

    // 保理融资 (供应商 + 应收 + 验证通过)
    if (ent.role === 'supplier' && trade.tradeType === 'purchase' && verificationOk) {
      matches.push({
        productId: 'factoring',
        productName: '保理融资',
        matchScore: 0.90,
        maxAmount: Math.min(trade.amount * 0.8, 5000000),
        advanceRate: 0.8,
        requirements: ['发票', '合同', '签收', '核心企业确权']
      });
    }

    // 反保理 (核心企业发起 + 信用分≥750 + 应付)
    if (anchorScore >= 750 && trade.tradeType === 'purchase' && verificationOk) {
      matches.push({
        productId: 'reverse_factoring',
        productName: '反保理',
        matchScore: 0.85,
        maxAmount: Math.min(trade.amount * 0.9, 10000000),
        advanceRate: 0.9,
        requirements: ['采购订单', '发票', '付款承诺']
      });
    }

    // 预付款融资 (经销商 + 信用等级≥B)
    if (ent.role === 'distributor' && ent.credit.ownScore >= 600 && (verificationOk || partialOk)) {
      matches.push({
        productId: 'advance_payment',
        productName: '预付款融资',
        matchScore: 0.75,
        maxAmount: Math.min(trade.amount * 0.5, 3000000),
        advanceRate: 0.5,
        requirements: ['合同', '供应协议']
      });
    }

    // 存货融资 (需要 IoT 监控 + 保险)
    if (trade.verification.iot && trade.verification.iot.passed && (verificationOk || partialOk)) {
      matches.push({
        productId: 'inventory_finance',
        productName: '存货融资',
        matchScore: 0.70,
        maxAmount: Math.min(trade.amount * 0.6, 5000000),
        advanceRate: 0.6,
        requirements: ['存货盘点', 'IoT监控', '保险']
      });
    }

    // 订单融资 (供应商 + 采购订单 + 核心企业信用传导)
    if (ent.role === 'supplier' && trade.tradeType === 'purchase' && (verificationOk || partialOk)) {
      matches.push({
        productId: 'purchase_order',
        productName: '订单融资',
        matchScore: 0.78,
        maxAmount: Math.min(trade.amount * 0.7, 4000000),
        advanceRate: 0.7,
        requirements: ['采购订单', '核心企业信用传导']
      });
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);
    State.logSCF('SC5', `产品路由: ${ent.name} | 贸易 ${trade.id} | 匹配 ${matches.length} 个产品 | 最优: ${matches[0] ? matches[0].productName : '无'}`);
    return matches;
  },

  // ============================================================
  // SC6 定价引擎
  // ============================================================

  /** 动态利率计算 */
  SC6_calculateRate(productId, tradeId, partnerId, anchorId) {
    const product = State.scfDatabase.products.find(p => p.id === productId);
    const trade = State.scfDatabase.trades.find(t => t.id === tradeId);
    const ent = State.getSCFEnterprise(partnerId);
    if (!product || !trade || !ent) return null;

    const market = MockData.SCF_MARKET;
    const lpr = market.lprBase;
    const anchorScore = State.getAnchorCreditScore(anchorId);
    const blacklistEntry = this.SC2_checkBlacklist(partnerId);

    // 基础费率 = LPR + 产品基础调整
    let rate = lpr + product.baseRateAdj;

    // 核心企业信用调整
    if (anchorScore > 800) rate -= 0.3;
    else if (anchorScore < 600) rate += 0.5;

    // 贸易验证溢价
    if (trade.verificationLevel === 'verified') rate -= 0.2;
    else if (trade.verificationLevel === 'partial') rate += 0.3;
    else return { rejected: true, reason: '贸易验证未通过, 拒绝定价' };

    // 黑白名单调整
    if (blacklistEntry) return { rejected: true, reason: `黑名单企业: ${blacklistEntry.reason}` };
    if (ent.credit.blacklistStatus === 'warning') rate += 1.0;

    // 季节性波动 (复用 SEASONAL_WINDOWS)
    rate += MockData.SEASONAL_WINDOWS[State.seasonalWindow].rateAdjust;

    // 市场流动性调整
    if (market.liquidityIndex === 'loose') rate -= 0.2;
    else if (market.liquidityIndex === 'tight') rate += 0.3;

    // 行业风险溢价
    const industryPremium = (market.industryRiskPremium[ent.industry] || 100) / 100;
    rate += industryPremium;

    // 政策导向调整
    if (market.policyBias === 'encourage_scf') rate -= 0.15;
    else if (market.policyBias === 'restrict_scf') rate += 0.30;

    const result = {
      productId,
      productName: product.name,
      finalRate: Math.round(rate * 100) / 100,
      breakdown: {
        lpr,
        productBaseAdj: product.baseRateAdj,
        anchorCreditAdj: anchorScore > 800 ? -0.3 : anchorScore < 600 ? +0.5 : 0,
        verificationAdj: trade.verificationLevel === 'verified' ? -0.2 : +0.3,
        blacklistAdj: ent.credit.blacklistStatus === 'warning' ? +1.0 : 0,
        seasonalAdj: MockData.SEASONAL_WINDOWS[State.seasonalWindow].rateAdjust,
        liquidityAdj: market.liquidityIndex === 'loose' ? -0.2 : market.liquidityIndex === 'tight' ? +0.3 : 0,
        industryPremium: industryPremium,
        policyAdj: market.policyBias === 'encourage_scf' ? -0.15 : market.policyBias === 'restrict_scf' ? +0.30 : 0
      }
    };

    State.logSCF('SC6', `动态定价: ${product.name} | 最终利率 ${result.finalRate}% | LPR ${lpr}% + 产品 ${product.baseRateAdj} + 信用 ${result.breakdown.anchorCreditAdj} + 验证 ${result.breakdown.verificationAdj} + 季节 ${result.breakdown.seasonalAdj} + 行业 ${industryPremium} + 政策 ${result.breakdown.policyAdj}`);
    return result;
  },

  // ============================================================
  // SC7 风险扩散引擎
  // ============================================================

  /** 分析风险扩散 */
  SC7_analyzeRiskDiffusion(nodeId, riskEvent) {
    const graph = State.scfDatabase.graph;
    if (!graph.nodes.length) this.SC1_buildGraph();

    // 找到受影响的节点 (核心企业风险 → 所有上下游; 上下游风险 → 核心企业+同社区其他成员)
    const isAnchor = graph.nodes.find(n => n.id === nodeId && n.type === 'anchor');
    let impacted = [];

    if (isAnchor) {
      // 核心企业风险 → 传播到所有上下游
      impacted = State.scfDatabase.relationships
        .filter(r => r.anchorId === nodeId)
        .map(r => ({
          enterpriseId: r.partnerId,
          relationship: r.relationshipType,
          strength: r.strength.tradeStability,
          impactScore: r.strength.tradeStability * (riskEvent.severity || 0.8)
        }));
    } else {
      // 上下游风险 → 传播到核心企业 + 同社区其他成员
      const rels = State.scfDatabase.relationships.filter(r => r.partnerId === nodeId);
      rels.forEach(rel => {
        impacted.push({
          enterpriseId: rel.anchorId,
          relationship: 'anchor',
          strength: rel.strength.tradeStability,
          impactScore: rel.strength.tradeStability * (riskEvent.severity || 0.8) * 0.5
        });
        // 同社区其他成员
        const sameCluster = State.scfDatabase.relationships
          .filter(r => r.anchorId === rel.anchorId && r.partnerId !== nodeId);
        sameCluster.forEach(r => {
          impacted.push({
            enterpriseId: r.partnerId,
            relationship: 'sibling',
            strength: r.strength.tradeStability * 0.5,
            impactScore: r.strength.tradeStability * (riskEvent.severity || 0.8) * 0.3
          });
        });
      });
    }

    // 预警级别
    const maxImpact = Math.max(...impacted.map(i => i.impactScore), 0);
    const level = maxImpact >= 0.7 ? 'red' : maxImpact >= 0.4 ? 'orange' : 'yellow';

    const warning = {
      sourceNodeId: nodeId,
      riskEvent,
      impacted,
      level,
      generatedAt: new Date().toISOString()
    };

    State.scfEngine.riskWarnings.push(warning);
    State.scfDatabase.riskEvents.push({
      nodeId,
      event: riskEvent,
      impactedCount: impacted.length,
      level,
      timestamp: new Date().toISOString()
    });

    State.logSCF('SC7', `⚠️ 风险扩散: ${nodeId} | 影响范围 ${impacted.length} 家企业 | 预警级别 ${level} | 事件: ${riskEvent.description || JSON.stringify(riskEvent)}`);
    return warning;
  },

  // ============================================================
  // SC8 机构撮合引擎
  // ============================================================

  /** 多方机构竞标 */
  SC8_simulateBids(tradeId, productId, partnerId) {
    const trade = State.scfDatabase.trades.find(t => t.id === tradeId);
    const product = State.scfDatabase.products.find(p => p.id === productId);
    const ent = State.getSCFEnterprise(partnerId);
    if (!trade || !product || !ent) return [];

    const pricing = this.SC6_calculateRate(productId, tradeId, partnerId, trade.anchorId);
    if (pricing && pricing.rejected) return [];

    const baseRate = pricing ? pricing.finalRate : 5.5;
    const bids = [];

    State.scfDatabase.institutions.forEach(inst => {
      if (!inst.supports.includes(productId)) return;

      let rate = inst.baseRate;
      // 机构竞争调整 (-0.3 ~ +0.5)
      const competitionAdj = (Math.random() - 0.5) * 0.8;
      rate = Math.max(3.5, rate + competitionAdj);

      const maxAmount = Math.min(inst.maxAmount, trade.amount * product.advanceRate * 1.1);

      bids.push({
        institutionId: inst.id,
        institutionName: inst.name,
        institutionType: inst.type,
        rate: Math.round(rate * 100) / 100,
        amount: Math.round(maxAmount),
        condition: inst.type === 'guarantor' ? '担保增信' : inst.type === 'insurer' ? '保险增信' : '直接融资',
        supports: inst.supports
      });
    });

    // 排序: 利率最低优先
    bids.sort((a, b) => a.rate - b.rate);

    State.scfEngine.matchmakingResults = bids;
    State.logSCF('SC8', `机构撮合: ${bids.length} 家机构报价 | 最优: ${bids[0] ? bids[0].institutionName + ' ' + bids[0].rate + '%' : '无'}`);
    return bids;
  },

  // ============================================================
  // SC9 履约监控引擎
  // ============================================================

  /** 贷后贸易持续验证 */
  SC9_monitorPerformance(tradeId, loanId) {
    const trade = State.scfDatabase.trades.find(t => t.id === tradeId);
    const loan = State.scfDatabase.loans.find(l => l.id === loanId);
    if (!trade || !loan) return null;

    const performance = {
      tradeId,
      loanId,
      tradeVerificationCurrent: trade.verificationLevel,
      repaymentProgress: loan.repaidAmount / loan.amount,
      overdueDays: this._calcOverdueDays(loan),
      status: 'normal',
      timestamp: new Date().toISOString()
    };

    if (performance.overdueDays > 90) {
      performance.status = 'severe_overdue';
      // 闭环回流: 严重逾期 → SC2 拉黑
      this.SC2_triggerBlacklist(trade.partnerId, 'severe_overdue', [
        `贷款 ${loanId} 逾期 ${performance.overdueDays} 天`,
        `贸易 ${tradeId} 关联`
      ]);
      State.logSCF('SC9', `🚨 严重逾期: ${loanId} | 逾期 ${performance.overdueDays} 天 | 触发 SC2 黑名单`);
    } else if (performance.overdueDays > 0) {
      performance.status = 'overdue';
      State.logSCF('SC9', `⚠️ 逾期: ${loanId} | 逾期 ${performance.overdueDays} 天`);
    } else if (performance.repaymentProgress >= 1.0) {
      performance.status = 'completed';
      // 闭环回流: 按时还款 → SC3 信用提升
      this._feedbackCreditImprovement(trade.partnerId, 5);
      // 案例入库
      this.SC10_addCase(trade, loan);
      State.logSCF('SC9', `✅ 履约完成: ${loanId} | 还款 100% | SC3 信用 +5 | 案例入库`);
    } else {
      State.logSCF('SC9', `📊 履约监控: ${loanId} | 还款进度 ${Math.round(performance.repaymentProgress * 100)}%`);
    }

    State.scfDatabase.performanceRecords.push(performance);
    State._persistSCF();
    return performance;
  },

  /** 计算逾期天数 */
  _calcOverdueDays(loan) {
    if (!loan.dueDate) return 0;
    const due = new Date(loan.dueDate);
    const now = new Date(State.systemDate);
    const diff = Math.floor((now - due) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  },

  /** 闭环回流: 信用提升 */
  _feedbackCreditImprovement(entId, gain) {
    const ent = State.getSCFEnterprise(entId);
    if (!ent) return;
    ent.credit.ownScore = Math.min(850, ent.credit.ownScore + gain);
    ent.credit.creditHistory.push({
      date: new Date().toISOString().slice(0, 10),
      event: `按时还款信用提升 +${gain}`,
      impact: gain
    });
    State.logSCF('SC9', `信用回流: ${ent.name} | 信用分 +${gain} → ${ent.credit.ownScore}`);
  },

  // ============================================================
  // SC10 案例学习引擎
  // ============================================================

  /** SCF 案例检索 (KNN 简化版) */
  SC10_searchCases(enterprise, trade, product) {
    const cases = State.scfDatabase.cases;
    if (!cases.length) return [];

    const scored = cases.map(c => {
      let score = 0;
      if (enterprise && enterprise.industry && c.industry === enterprise.industry) score += 30;
      if (product && c.product === product) score += 40;
      if (enterprise && enterprise.role && c.role === enterprise.role) score += 20;
      if (trade && c.amount && trade.amount) {
        const ratio = Math.min(c.amount, trade.amount) / Math.max(c.amount, trade.amount);
        score += ratio * 10;
      }
      return { case: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3).map(s => s.case);
    State.logSCF('SC10', `案例检索: 命中 ${top3.length} 个相似案例 | 最优匹配分数 ${scored[0] ? scored[0].score : 0}`);
    return top3;
  },

  /** 完成的 SCF 业务入库 */
  SC10_addCase(trade, loan) {
    const ent = State.getSCFEnterprise(trade.partnerId);
    const anchor = State.getAnchorEnterprise(trade.anchorId);
    const newCase = {
      id: `CASE-SCF-${Date.now().toString().slice(-6)}`,
      title: `${anchor ? anchor.name : trade.anchorId}-${ent ? ent.name : trade.partnerId} ${loan.productName || '融资'}案例`,
      industry: ent ? ent.industry : 'unknown',
      product: loan.productId || 'factoring',
      role: ent ? ent.role : 'supplier',
      partnerId: trade.partnerId,
      anchorId: trade.anchorId,
      amount: loan.amount,
      rate: loan.rate,
      duration: loan.durationDays || 60,
      outcome: 'success',
      keyFactors: ['按时还款', '贸易验证通过', '信用传导有效'],
      description: `${ent ? ent.name : trade.partnerId} 基于 ${anchor ? anchor.name : trade.anchorId} 的 ${loan.productName || '融资'} ${loan.amount} 元, 利率 ${loan.rate}%, 按时还款完成。`,
      createdAt: new Date().toISOString().slice(0, 10)
    };
    State.scfDatabase.cases.push(newCase);
    State.logSCF('SC10', `📚 案例入库: ${newCase.id} | ${newCase.title}`);
    State._persistSCF();
    return newCase;
  },

  // ============================================================
  // 一键全链路执行 (端到端闭环)
  // ============================================================

  /** 端到端: 核心企业认证 → 画像 → 黑白名单 → 信用传导 → 贸易验证 → 产品路由 → 定价 → 撮合 → 履约 → 案例 */
  runFullPipeline(anchorId, partnerId, tradeId) {
    State.logSCF('PIPELINE', `═══ SCF 全链路启动: 核心 ${anchorId} → 伙伴 ${partnerId} → 贸易 ${tradeId} ═══`);
    State.scfEngine.status = 'running';
    State.scfEngine.currentAnchorId = anchorId;
    State.scfEngine.selectedPartnerId = partnerId;
    State.scfEngine.activeTradeId = tradeId;

    // SC1 画像 + 图谱
    this.SC1_buildProfile(partnerId);
    this.SC1_buildGraph();
    State.updateSCFEngineStatus('SC1', 'completed', { profile: true, graph: true });

    // SC2 准入判定
    const admission = this.SC2_checkAdmission(partnerId);
    State.updateSCFEngineStatus('SC2', 'completed', admission);
    if (!admission.admitted) {
      State.logSCF('PIPELINE', `❌ 准入失败: ${admission.reason} | 链路终止`);
      State.scfEngine.status = 'completed';
      return { success: false, reason: admission.reason };
    }

    // SC3 信用传导
    const credit = this.SC3_calculateTransmittedCredit(anchorId, partnerId);
    State.updateSCFEngineStatus('SC3', 'completed', credit);

    // SC4 贸易验证
    const verification = this.SC4_verifyTrade(tradeId);
    State.updateSCFEngineStatus('SC4', 'completed', verification);
    if (!verification || verification.level === 'unverified') {
      State.logSCF('PIPELINE', `❌ 贸易验证失败 | 链路终止`);
      State.scfEngine.status = 'completed';
      return { success: false, reason: '贸易验证未通过' };
    }

    // SC5 产品路由
    const matches = this.SC5_matchProducts(tradeId, partnerId);
    State.updateSCFEngineStatus('SC5', 'completed', matches);
    if (!matches.length) {
      State.logSCF('PIPELINE', `❌ 无匹配产品 | 链路终止`);
      State.scfEngine.status = 'completed';
      return { success: false, reason: '无匹配产品' };
    }

    // SC6 定价 (取最优产品)
    const bestProduct = matches[0];
    const pricing = this.SC6_calculateRate(bestProduct.productId, tradeId, partnerId, anchorId);
    State.updateSCFEngineStatus('SC6', 'completed', pricing);
    if (pricing && pricing.rejected) {
      State.logSCF('PIPELINE', `❌ 定价拒绝: ${pricing.reason} | 链路终止`);
      State.scfEngine.status = 'completed';
      return { success: false, reason: pricing.reason };
    }

    // SC8 机构撮合
    const bids = this.SC8_simulateBids(tradeId, bestProduct.productId, partnerId);
    State.updateSCFEngineStatus('SC8', 'completed', bids);

    // SC7 风险扩散评估 (假设无风险事件, 仅构建评估)
    State.updateSCFEngineStatus('SC7', 'completed', { assessed: true, level: 'green' });

    // 模拟放款 (创建 loan 记录)
    const bestBid = bids[0];
    const loan = {
      id: `LOAN-${Date.now().toString().slice(-6)}`,
      tradeId,
      partnerId,
      anchorId,
      productId: bestProduct.productId,
      productName: bestProduct.productName,
      institutionId: bestBid ? bestBid.institutionId : null,
      institutionName: bestBid ? bestBid.institutionName : null,
      amount: bestBid ? bestBid.amount : bestProduct.maxAmount,
      rate: bestBid ? bestBid.rate : pricing.finalRate,
      durationDays: 60,
      startDate: State.systemDate,
      dueDate: this._addDays(State.systemDate, 60),
      repaidAmount: bestBid ? bestBid.amount : bestProduct.maxAmount,  // 模拟按时还款
      status: 'repaid'
    };
    State.scfDatabase.loans.push(loan);

    // SC9 履约监控 (模拟按时还款完成)
    const performance = this.SC9_monitorPerformance(tradeId, loan.id);
    State.updateSCFEngineStatus('SC9', 'completed', performance);

    // SC10 案例学习
    const cases = this.SC10_searchCases(State.getSCFEnterprise(partnerId), State.scfDatabase.trades.find(t => t.id === tradeId), bestProduct.productId);
    State.updateSCFEngineStatus('SC10', 'completed', cases);

    State.scfEngine.status = 'completed';
    State.logSCF('PIPELINE', `═══ SCF 全链路完成: ${partnerId} 通过 ${bestProduct.productName} 融资 ${loan.amount} 元 @ ${loan.rate}% | 案例 ${cases.length} 个 ═══`);
    State._persistSCF();
    return { success: true, loan, product: bestProduct, pricing, bids, cases };
  },

  _addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
};

window.SCFEngine = SCFEngine;
