/* ============================================================
 * FinTrust Hub v6.0
 * view-scf.js — Tab11 供应链金融工作台
 * simulation-plan.md 第七章对齐 · 10 个功能分区 + SCF 全链路主按钮
 *
 * 分区布局:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ S0 顶部控制台: 核心企业选择 + 重置数据库 + 全链路执行    │
 *   ├──────────────────┬───────────────────────────────────────┤
 *   │ S1 企业入驻入口   │  S2 关系图谱可视化 (ECharts 力导向图) │
 *   │ · 3 种角色入驻    │  · 节点点击 → 联动 S3/S5              │
 *   │ · 待审核列表      │  · 图算法分析 (中心度/环检测/路径)    │
 *   ├──────────────────┼───────────────────────────────────────┤
 *   │ S3 企业画像面板   │  S4 黑白名单管理                      │
 *   │ · 13 维雷达图     │  · 黑名单列表 + 申诉处理              │
 *   │ · 三层信用分      │  · 白名单列表                         │
 *   ├──────────────────┴───────────────────────────────────────┤
 *   │ S5 贸易验证中心   │  S6 产品路由引擎                      │
 *   │ · 贸易列表        │  · 5 类产品匹配结果                   │
 *   │ · 五流+专项验证   │  · 匹配度排序 + 定价详情              │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ S7 机构撮合市场   │  S8 风险预警面板                      │
 *   │ · 多方机构报价    │  · 风险扩散影响范围                   │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ S9 履约监控台     │  S10 SCF 案例库                       │
 *   │ · 在贷列表/还款   │  · 案例检索 + 详情                    │
 *   └──────────────────────────────────────────────────────────┘
 *   [一键全链路 SC1→SC10] [重置数据库]
 * ============================================================ */
'use strict';

const ViewSCF = {

  // ===== 主入口 =====
  render() {
    const container = document.getElementById('view-scf');
    if (!container) return;

    const db = State.scfDatabase;
    const eng = State.scfEngine;

    container.innerHTML = `
      ${this._renderS0_TopConsole(db, eng)}
      <div class="card-grid card-grid-2">
        ${this._renderS1_Entry(db)}
        ${this._renderS2_Graph(db)}
      </div>
      <div class="card-grid card-grid-2">
        ${this._renderS3_Profile(db, eng)}
        ${this._renderS4_Blacklist(db)}
      </div>
      <div class="card-grid card-grid-2">
        ${this._renderS5_TradeVerification(db, eng)}
        ${this._renderS6_ProductRouter(db, eng)}
      </div>
      <div class="card-grid card-grid-2">
        ${this._renderS7_Matchmaking(db, eng)}
        ${this._renderS8_RiskWarning(db, eng)}
      </div>
      <div class="card-grid card-grid-2">
        ${this._renderS9_Performance(db)}
        ${this._renderS10_Cases(db)}
      </div>
      ${this._renderSCFPipeline()}
    `;

    this._bindEvents();
    // 渲染图谱
    setTimeout(() => SCFGraph.render('scf-graph-container'), 100);
  },

  // ===== S0 顶部控制台 =====
  _renderS0_TopConsole(db, eng) {
    // 七.8 对接点: Tab0 改造等级≥B+ 才能成为核心企业
    const allCandidates = State.enterprises.filter(e => e.id === 'E001' || e.id === 'E002' || e.id === 'E003' || e.id === 'E004');
    const anchorLevelRank = { 'A+': 8, 'A': 7, 'A-': 6, 'B+': 5, 'B': 4, 'B-': 3, 'C': 2, 'D': 1 };
    const qualifiedAnchors = allCandidates.filter(e => {
      const level = State.getAnchorReformLevel(e.id);
      return (anchorLevelRank[level] || 0) >= (anchorLevelRank['B+'] || 5);
    });
    const disqualified = allCandidates.filter(e => !qualifiedAnchors.includes(e));
    const currentAnchor = eng.currentAnchorId ? State.getAnchorEnterprise(eng.currentAnchorId) : null;
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          <span>🚛 Tab11 供应链金融工作台 · SCF v6.0 子系统</span>
          <span class="scf-stats">
            <span class="scf-stat-pill">企业 ${db.enterprises.length}</span>
            <span class="scf-stat-pill">关系 ${db.relationships.length}</span>
            <span class="scf-stat-pill">贸易 ${db.trades.length}</span>
            <span class="scf-stat-pill">黑名单 ${db.blacklist.length}</span>
            <span class="scf-stat-pill">案例 ${db.cases.length}</span>
          </span>
        </div>
        <div class="scf-top-controls">
          <label>核心企业 <span style="font-size:10px;color:var(--text-muted)">(需改造≥B+)</span>:</label>
          <select id="scf-anchor-select" class="scf-select">
            <option value="">选择核心企业...</option>
            ${qualifiedAnchors.map(a => `<option value="${a.id}" ${eng.currentAnchorId === a.id ? 'selected' : ''}>${a.name} (信用 ${a.runtime ? a.runtime.creditScore : '-'} · 等级 ${State.getAnchorReformLevel(a.id)})</option>`).join('')}
            ${disqualified.map(a => `<option value="${a.id}" disabled style="color:var(--text-muted)">${a.name} (改造等级 ${State.getAnchorReformLevel(a.id)} < B+ · 需先在Tab0完成改造)</option>`).join('')}
          </select>
          <label>上下游企业:</label>
          <select id="scf-partner-select" class="scf-select">
            <option value="">选择上下游企业...</option>
            ${db.enterprises.map(e => `<option value="${e.id}" ${eng.selectedPartnerId === e.id ? 'selected' : ''}>${e.name} (${e.role === 'supplier' ? '供应商' : '经销商'})</option>`).join('')}
          </select>
          <label>贸易记录:</label>
          <select id="scf-trade-select" class="scf-select">
            <option value="">选择贸易记录...</option>
            ${db.trades.map(t => `<option value="${t.id}" ${eng.activeTradeId === t.id ? 'selected' : ''}>${t.id} (${State.formatAmount ? State.formatAmount(t.amount) : t.amount})</option>`).join('')}
          </select>
          <button id="scf-btn-pipeline" class="btn-primary">🚀 一键全链路 SC1→SC10</button>
          <button id="scf-btn-reset" class="btn-danger">🔄 重置 SCF 数据库</button>
        </div>
        ${currentAnchor ? `<div class="scf-current-info">当前核心企业: <b>${currentAnchor.name}</b> | 改造等级: ${State.getAnchorReformLevel(currentAnchor.id)} | 信用分: ${State.getAnchorCreditScore(currentAnchor.id)}</div>` : ''}
        ${disqualified.length > 0 ? `<div style="font-size:11px;color:var(--accent-orange);margin-top:6px;padding:4px 8px;background:rgba(255,152,0,0.08);border-radius:4px">⚠️ ${disqualified.length} 家企业因改造等级<B+ 暂不可作为核心企业: ${disqualified.map(d => d.name + '(' + State.getAnchorReformLevel(d.id) + ')').join('、')} — 需先在Tab0完成改造</div>` : ''}
      </div>
    `;
  },

  // ===== S1 企业入驻入口 =====
  _renderS1_Entry(db) {
    return `
      <div class="card">
        <div class="card-title"><span>① 企业入驻入口</span><span class="scf-badge">${db.enterprises.length} 家已入驻</span></div>
        <div class="scf-entry-buttons">
          <button class="scf-entry-btn scf-entry-anchor" onclick="ViewSCF.onboardEnterprise('anchor')">🟠 核心企业入驻</button>
          <button class="scf-entry-btn scf-entry-supplier" onclick="ViewSCF.onboardEnterprise('supplier')">🔵 供应商入驻</button>
          <button class="scf-entry-btn scf-entry-distributor" onclick="ViewSCF.onboardEnterprise('distributor')">🟢 经销商入驻</button>
        </div>
        <div class="scf-entry-list">
          <h4>已入驻企业</h4>
          ${db.enterprises.map(e => `
            <div class="scf-entry-item ${e.role}" onclick="State.setSCFPartner('${e.id}')">
              <span class="scf-entry-icon">${e.role === 'supplier' ? '🔵' : '🟢'}</span>
              <span class="scf-entry-name">${e.name}</span>
              <span class="scf-entry-role">${e.role === 'supplier' ? '供应商' : '经销商'}</span>
              <span class="scf-entry-credit">信用 ${e.credit.ownScore}</span>
              <span class="scf-entry-seat">${e.supplyChainProfile.seatLevel}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ===== S2 关系图谱可视化 =====
  _renderS2_Graph(db) {
    return `
      <div class="card">
        <div class="card-title">
          <span>② 供应链关系图谱</span>
          <button class="btn-mini" onclick="ViewSCF.runGraphAnalysis()">🔍 图算法分析</button>
        </div>
        <div id="scf-graph-container" class="scf-graph-container"></div>
        <div id="scf-graph-analysis" class="scf-graph-analysis"></div>
      </div>
    `;
  },

  // ===== S3 企业画像面板 =====
  _renderS3_Profile(db, eng) {
    const partnerId = eng.selectedPartnerId;
    const ent = partnerId ? State.getSCFEnterprise(partnerId) : null;
    const profile = ent && ent.profile ? ent.profile : null;

    if (!ent) {
      return `
        <div class="card">
          <div class="card-title"><span>③ 企业画像面板</span></div>
          <div class="scf-empty">请从 ① 入驻列表或 ② 图谱节点选择企业</div>
        </div>
      `;
    }

    const baseDims = profile ? profile.baseDims : {};
    const scfDims = profile ? profile.scfDims : {};
    const allDims = [
      { key: 'subject', label: '主体', value: baseDims.subject, group: 'base' },
      { key: 'finance', label: '财务', value: baseDims.finance, group: 'base' },
      { key: 'tax', label: '税务', value: baseDims.tax, group: 'base' },
      { key: 'business', label: '业务', value: baseDims.business, group: 'base' },
      { key: 'assets', label: '资产', value: baseDims.assets, group: 'base' },
      { key: 'credit', label: '信用', value: baseDims.credit, group: 'base' },
      { key: 'policy', label: '政策', value: baseDims.policy, group: 'base' },
      { key: 'capital', label: '资金', value: baseDims.capital, group: 'base' },
      { key: 'tradeStability', label: '交易稳定性', value: scfDims.tradeStability, group: 'scf' },
      { key: 'tradeAuthenticity', label: '贸易真实性', value: scfDims.tradeAuthenticity, group: 'scf' },
      { key: 'cooperationLoyalty', label: '合作忠诚度', value: scfDims.cooperationLoyalty, group: 'scf' },
      { key: 'performanceReliability', label: '履约可靠度', value: scfDims.performanceReliability, group: 'scf' },
      { key: 'networkPosition', label: '网络位置分', value: scfDims.networkPosition, group: 'scf' }
    ];

    return `
      <div class="card">
        <div class="card-title">
          <span>③ 企业画像 · ${ent.name}</span>
          ${profile ? `<span class="scf-badge scf-badge-score">综合分 ${profile.overallScore}</span>` : ''}
        </div>
        ${profile ? `
          <div class="scf-tags">${profile.tags.map(t => `<span class="scf-tag">${t}</span>`).join('')}</div>
          ${profile.riskFlags.length ? `<div class="scf-risk-flags">${profile.riskFlags.map(f => `<span class="scf-risk-flag ${f.level}">⚠️ ${f.desc}</span>`).join('')}</div>` : ''}
        ` : ''}
        <div class="scf-credit-layers">
          <div class="scf-credit-layer">
            <span class="scf-credit-label">独立信用</span>
            <span class="scf-credit-value">${ent.credit.ownScore}</span>
          </div>
          <div class="scf-credit-arrow">→</div>
          <div class="scf-credit-layer">
            <span class="scf-credit-label">传导信用</span>
            <span class="scf-credit-value ${ent.credit.propagatedScore && ent.credit.propagatedScore > ent.credit.ownScore ? 'scf-credit-up' : ''}">${ent.credit.propagatedScore || '-'}</span>
          </div>
          <div class="scf-credit-arrow">→</div>
          <div class="scf-credit-layer">
            <span class="scf-credit-label">场景信用</span>
            <span class="scf-credit-value">${ent.credit.sceneScore || '-'}</span>
          </div>
        </div>
        <button class="btn-mini" onclick="ViewSCF.buildProfile('${ent.id}')">🔄 SC1 重建画像</button>
        <button class="btn-mini" onclick="ViewSCF.calcCreditPropagation('${ent.id}')">⚡ SC3 信用传导</button>
        <div class="scf-dims-list">
          ${allDims.map(d => `
            <div class="scf-dim-item ${d.group}">
              <span class="scf-dim-label">${d.label}</span>
              <div class="scf-dim-bar"><div class="scf-dim-fill" style="width:${d.value || 0}%"></div></div>
              <span class="scf-dim-value">${d.value || '-'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ===== S4 黑白名单管理 =====
  _renderS4_Blacklist(db) {
    return `
      <div class="card">
        <div class="card-title"><span>④ 黑白名单管理</span></div>
        <div class="scf-blacklist-section">
          <h4>🚫 黑名单 (${db.blacklist.length})</h4>
          ${db.blacklist.length ? db.blacklist.map(b => `
            <div class="scf-blacklist-item">
              <div class="scf-bl-name">${b.enterpriseName}</div>
              <div class="scf-bl-reason">${b.reason}</div>
              <div class="scf-bl-rule">${b.triggerRule}</div>
              <div class="scf-bl-evidence">证据: ${b.evidence.join(' | ')}</div>
              <div class="scf-bl-actions">
                <span class="scf-bl-status">${b.appealStatus}</span>
                ${b.appealStatus === 'none' ? `<button class="btn-mini" onclick="ViewSCF.appealBlacklist('${b.enterpriseId}')">📝 申诉</button>` : ''}
                ${b.appealStatus === 'pending' ? `<button class="btn-mini btn-success" onclick="ViewSCF.approveAppeal('${b.enterpriseId}')">✓ 批准</button>` : ''}
              </div>
            </div>
          `).join('') : '<div class="scf-empty">无黑名单记录</div>'}
        </div>
        <div class="scf-whitelist-section">
          <h4>✅ 白名单 (${db.whitelist.length})</h4>
          ${db.whitelist.length ? db.whitelist.map(w => `
            <div class="scf-whitelist-item">
              <span class="scf-wl-name">${w.enterpriseName}</span>
              <span class="scf-wl-reason">${w.reason}</span>
            </div>
          `).join('') : '<div class="scf-empty">无白名单记录</div>'}
        </div>
      </div>
    `;
  },

  // ===== S5 贸易验证中心 =====
  _renderS5_TradeVerification(db, eng) {
    const tradeId = eng.activeTradeId;
    const activeTrade = tradeId ? db.trades.find(t => t.id === tradeId) : null;

    return `
      <div class="card">
        <div class="card-title"><span>⑤ 贸易验证中心</span></div>
        <div class="scf-trade-list">
          ${db.trades.slice(0, 5).map(t => `
            <div class="scf-trade-item ${t.verificationLevel} ${tradeId === t.id ? 'active' : ''}" onclick="ViewSCF.selectTrade('${t.id}')">
              <span class="scf-trade-id">${t.id}</span>
              <span class="scf-trade-amount">${State.formatAmount ? State.formatAmount(t.amount) : t.amount}</span>
              <span class="scf-trade-level scf-level-${t.verificationLevel}">${t.verificationLevel}</span>
              <span class="scf-trade-status">${t.financingStatus}</span>
            </div>
          `).join('')}
        </div>
        ${activeTrade ? `
          <div class="scf-trade-detail">
            <h4>${activeTrade.id} 详情</h4>
            <div class="scf-verify-grid">
              ${Object.entries(activeTrade.verification).map(([k, v]) => `
                <div class="scf-verify-item ${v.passed ? 'passed' : 'failed'}">
                  <span class="scf-verify-name">${this._flowLabel(k)}</span>
                  <span class="scf-verify-status">${v.passed ? '✓' : '✗'}</span>
                  <span class="scf-verify-evidence">${v.evidence || '-'}</span>
                </div>
              `).join('')}
            </div>
            <div class="scf-verify-result scf-level-${activeTrade.verificationLevel}">
              验证等级: ${activeTrade.verificationLevel} | 可融资: ${activeTrade.canUseForFinancing ? '✓' : '✗'}
            </div>
            <button class="btn-mini" onclick="ViewSCF.verifyTrade('${activeTrade.id}')">🔄 SC4 重新验证</button>
          </div>
        ` : '<div class="scf-empty">请选择贸易记录</div>'}
      </div>
    `;
  },

  _flowLabel(key) {
    const labels = {
      contract: '合同流', invoice: '发票流', logistics: '物流流',
      fund: '资金流', iot: '物联流',
      poInvoiceMatch: 'PO-发票匹配', logisticsContractMatch: '物流-合同匹配'
    };
    return labels[key] || key;
  },

  // ===== S6 产品路由引擎 =====
  _renderS6_ProductRouter(db, eng) {
    return `
      <div class="card">
        <div class="card-title"><span>⑥ 产品路由引擎</span></div>
        <div class="scf-products-list">
          ${db.products.map(p => `
            <div class="scf-product-card">
              <div class="scf-product-header">
                <span class="scf-product-name">${p.name}</span>
                <span class="scf-product-cat">${p.category}</span>
              </div>
              <div class="scf-product-meta">
                <span>融资比例 ${(p.advanceRate * 100)}%</span>
                <span>额度 ${State.formatAmount ? State.formatAmount(p.minAmount) : p.minAmount} ~ ${State.formatAmount ? State.formatAmount(p.maxAmount) : p.maxAmount}</span>
                <span>基础+${p.baseRateAdj}%</span>
              </div>
              <div class="scf-product-req">前置: ${p.requires.join(' / ')} ${p.requiresAnchorConfirm ? '+ 核心企业确权' : ''}</div>
            </div>
          `).join('')}
        </div>
        ${eng.activeTradeId && eng.selectedPartnerId ? `
          <button class="btn-mini" onclick="ViewSCF.matchProducts()">⚡ SC5 产品匹配</button>
          <div id="scf-match-results"></div>
        ` : '<div class="scf-empty">请选择贸易记录和上下游企业</div>'}
      </div>
    `;
  },

  // ===== S7 机构撮合市场 =====
  _renderS7_Matchmaking(db, eng) {
    const results = eng.matchmakingResults || [];
    return `
      <div class="card">
        <div class="card-title"><span>⑦ 机构撮合市场</span></div>
        <div class="scf-institutions-list">
          ${db.institutions.map(i => `
            <div class="scf-inst-item scf-inst-${i.type}">
              <span class="scf-inst-name">${i.name}</span>
              <span class="scf-inst-type">${this._instTypeLabel(i.type)}</span>
              <span class="scf-inst-rate">基础 ${i.baseRate}%</span>
              <span class="scf-inst-supports">支持 ${i.supports.length} 类</span>
            </div>
          `).join('')}
        </div>
        ${results.length ? `
          <h4>撮合结果 (${results.length} 家报价)</h4>
          <div class="scf-bids-list">
            ${results.map((b, i) => `
              <div class="scf-bid-item ${i === 0 ? 'best' : ''}">
                <span class="scf-bid-rank">${i + 1}</span>
                <span class="scf-bid-name">${b.institutionName}</span>
                <span class="scf-bid-rate">${b.rate}%</span>
                <span class="scf-bid-amount">${State.formatAmount ? State.formatAmount(b.amount) : b.amount}</span>
                <span class="scf-bid-condition">${b.condition}</span>
                ${i === 0 ? '<span class="scf-bid-best">AI 推荐</span>' : ''}
              </div>
            `).join('')}
          </div>
        ` : '<div class="scf-empty">点击 S6 产品匹配后自动撮合</div>'}
      </div>
    `;
  },

  _instTypeLabel(type) {
    return { bank: '银行', factor: '保理', guarantor: '担保', insurer: '保险' }[type] || type;
  },

  // ===== S8 风险预警面板 =====
  _renderS8_RiskWarning(db, eng) {
    const warnings = eng.riskWarnings || [];
    return `
      <div class="card">
        <div class="card-title"><span>⑧ 风险预警面板</span></div>
        <div class="scf-risk-controls">
          <button class="btn-mini btn-warning" onclick="ViewSCF.simulateRiskEvent()">⚡ 模拟核心企业风险事件</button>
        </div>
        ${warnings.length ? warnings.slice(-3).map(w => `
          <div class="scf-warning-item scf-warning-${w.level}">
            <div class="scf-warning-header">
              <span class="scf-warning-level">${this._levelLabel(w.level)}</span>
              <span class="scf-warning-source">来源: ${w.sourceNodeId}</span>
            </div>
            <div class="scf-warning-event">${w.riskEvent.description || JSON.stringify(w.riskEvent)}</div>
            <div class="scf-warning-impact">影响 ${w.impacted.length} 家企业:
              ${w.impacted.map(i => `<span class="scf-impact-item">${i.enterpriseId} (${(i.impactScore * 100).toFixed(0)}%)</span>`).join('')}
            </div>
          </div>
        `).join('') : '<div class="scf-empty">无风险预警</div>'}
      </div>
    `;
  },

  _levelLabel(level) {
    return { red: '🔴 红色预警', orange: '🟠 橙色预警', yellow: '🟡 黄色预警' }[level] || level;
  },

  // ===== S9 履约监控台 =====
  _renderS9_Performance(db) {
    const loans = db.loans || [];
    const performances = db.performanceRecords || [];
    return `
      <div class="card">
        <div class="card-title"><span>⑨ 履约监控台</span></div>
        ${loans.length ? `
          <div class="scf-loans-list">
            ${loans.map(l => {
              const progress = l.repaidAmount / l.amount;
              return `
                <div class="scf-loan-item">
                  <div class="scf-loan-header">
                    <span class="scf-loan-id">${l.id}</span>
                    <span class="scf-loan-product">${l.productName}</span>
                    <span class="scf-loan-amount">${State.formatAmount ? State.formatAmount(l.amount) : l.amount} @ ${l.rate}%</span>
                    <span class="scf-loan-status scf-status-${l.status}">${l.status}</span>
                  </div>
                  <div class="scf-loan-progress">
                    <div class="scf-progress-bar"><div class="scf-progress-fill" style="width:${progress * 100}%"></div></div>
                    <span>${(progress * 100).toFixed(0)}%</span>
                  </div>
                  <div class="scf-loan-meta">
                    <span>机构: ${l.institutionName || '-'}</span>
                    <span>到期: ${l.dueDate}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : '<div class="scf-empty">无在贷记录 (执行全链路后生成)</div>'}
        ${performances.length ? `
          <h4>履约记录 (${performances.length})</h4>
          <div class="scf-perf-list">
            ${performances.slice(-3).map(p => `
              <div class="scf-perf-item scf-perf-${p.status}">
                <span>${p.loanId}</span>
                <span>${p.status}</span>
                <span>还款 ${(p.repaymentProgress * 100).toFixed(0)}%</span>
                <span>逾期 ${p.overdueDays} 天</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  // ===== S10 SCF 案例库 =====
  _renderS10_Cases(db) {
    return `
      <div class="card">
        <div class="card-title"><span>⑩ SCF 案例库</span></div>
        <button class="btn-mini" onclick="ViewSCF.searchCases()">🔍 SC10 案例检索</button>
        <div class="scf-cases-list">
          ${db.cases.map(c => `
            <div class="scf-case-item" onclick="ViewSCF.showCaseDetail('${c.id}')">
              <div class="scf-case-header">
                <span class="scf-case-title">${c.title}</span>
                <span class="scf-case-outcome scf-outcome-${c.outcome}">${c.outcome}</span>
              </div>
              <div class="scf-case-meta">
                <span>${c.industry}</span>
                <span>${c.product}</span>
                <span>${State.formatAmount ? State.formatAmount(c.amount) : c.amount} @ ${c.rate}%</span>
                <span>${c.duration}天</span>
              </div>
              <div class="scf-case-factors">${c.keyFactors.map(f => `<span class="scf-case-factor">${f}</span>`).join('')}</div>
            </div>
          `).join('')}
        </div>
        <div id="scf-case-detail"></div>
      </div>
    `;
  },

  // ===== SCF 全链路主按钮 =====
  _renderSCFPipeline() {
    const eng = State.scfEngine;
    const engines = ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8', 'SC9', 'SC10'];
    return `
      <div class="card" style="margin-top:16px">
        <div class="card-title"><span>🔧 SCF 引擎族状态 (SC1-SC10)</span></div>
        <div class="scf-engine-status-grid">
          ${engines.map(e => {
            const st = eng.engineStatus[e];
            const labels = {
              SC1: '画像', SC2: '黑白名单', SC3: '信用传导', SC4: '贸易验证',
              SC5: '产品路由', SC6: '定价', SC7: '风险扩散', SC8: '机构撮合',
              SC9: '履约监控', SC10: '案例学习'
            };
            return `
              <div class="scf-engine-card scf-engine-${st.status}">
                <div class="scf-engine-id">${e}</div>
                <div class="scf-engine-name">${labels[e]}</div>
                <div class="scf-engine-state">${st.status}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  // ============================================================
  // 事件绑定 + 交互
  // ============================================================

  _bindEvents() {
    const anchorSel = document.getElementById('scf-anchor-select');
    if (anchorSel) anchorSel.onchange = (e) => { if (e.target.value) State.setSCFAnchor(e.target.value); };

    const partnerSel = document.getElementById('scf-partner-select');
    if (partnerSel) partnerSel.onchange = (e) => {
      if (e.target.value) {
        State.setSCFPartner(e.target.value);
        SCFEngine.SC1_buildProfile(e.target.value);
        this.render();
      }
    };

    const tradeSel = document.getElementById('scf-trade-select');
    if (tradeSel) tradeSel.onchange = (e) => {
      if (e.target.value) {
        State.scfEngine.activeTradeId = e.target.value;
        State._notify();
        this.render();
      }
    };

    const btnPipeline = document.getElementById('scf-btn-pipeline');
    if (btnPipeline) btnPipeline.onclick = () => this.runFullPipeline();

    const btnReset = document.getElementById('scf-btn-reset');
    if (btnReset) btnReset.onclick = () => {
      if (confirm('确认重置 SCF 数据库为初始 Mock 数据? 所有运行时数据将被清空.')) {
        State.resetSCFDatabase();
        this.render();
      }
    };
  },

  // ===== 图谱节点点击回调 =====
  onGraphNodeClick(data) {
    this.render();
  },

  // ===== 企业入驻 =====
  onboardEnterprise(role) {
    const name = prompt(`请输入${role === 'anchor' ? '核心企业' : role === 'supplier' ? '供应商' : '经销商'}名称:`);
    if (!name) return;
    const newId = `SCF-${role === 'supplier' ? 'S' : role === 'distributor' ? 'D' : 'A'}${String(Date.now()).slice(-4)}`;
    const newEnt = {
      id: newId,
      name,
      role,
      linkedAnchorId: State.scfEngine.currentAnchorId || 'E001',
      industry: 'manufacturing',
      registeredCapital: 5000000,
      establishDate: '2020-01-01',
      legalRep: '新入驻',
      supplyChainProfile: {
        cooperationYears: 0,
        annualTradeVolume: 0,
        tradeFrequency: 'monthly',
        paymentTerm: '30天',
        productCategory: '待补充',
        seatLevel: 'bronze'
      },
      credit: {
        ownScore: 650,
        propagatedScore: null,
        sceneScore: null,
        creditHistory: [],
        blacklistStatus: 'clean'
      },
      tradeStats: { totalTrades: 0, verifiedTrades: 0, verificationRate: 0, avgTradeAmount: 0, lastTradeDate: null, overdueCount: 0 },
      dataVisibility: { anchor: ['tradeHistory'], bank: ['enterpriseName', 'creditScore'], guarantor: ['enterpriseName'] },
      profile: null,
      status: 'active',
      joinedAt: new Date().toISOString().slice(0, 10),
      certifiedBy: State.scfEngine.currentAnchorId || 'E001'
    };
    State.scfDatabase.enterprises.push(newEnt);
    SCFEngine.SC1_buildProfile(newId);
    State._persistSCF();
    State.logSCF('SC1', `新企业入驻: ${name} (${role}) | ID ${newId}`);
    this.render();
  },

  // ===== SC1 重建画像 =====
  buildProfile(entId) {
    SCFEngine.SC1_buildProfile(entId);
    this.render();
  },

  // ===== SC3 信用传导 =====
  calcCreditPropagation(entId) {
    const ent = State.getSCFEnterprise(entId);
    if (!ent) return;
    if (!State.scfEngine.currentAnchorId) {
      alert('请先在顶部选择核心企业');
      return;
    }
    SCFEngine.SC3_calculateTransmittedCredit(State.scfEngine.currentAnchorId, entId);
    this.render();
  },

  // ===== SC4 贸易验证 =====
  verifyTrade(tradeId) {
    SCFEngine.SC4_verifyTrade(tradeId);
    this.render();
  },

  // ===== 选择贸易 =====
  selectTrade(tradeId) {
    State.scfEngine.activeTradeId = tradeId;
    State._notify();
    this.render();
  },

  // ===== SC5 产品匹配 =====
  matchProducts() {
    const eng = State.scfEngine;
    if (!eng.activeTradeId || !eng.selectedPartnerId) {
      alert('请先选择贸易记录和上下游企业');
      return;
    }
    const matches = SCFEngine.SC5_matchProducts(eng.activeTradeId, eng.selectedPartnerId);
    const container = document.getElementById('scf-match-results');
    if (container) {
      container.innerHTML = `
        <h4>匹配结果 (${matches.length} 个产品)</h4>
        ${matches.map((m, i) => `
          <div class="scf-match-item ${i === 0 ? 'best' : ''}">
            <span class="scf-match-rank">${i + 1}</span>
            <span class="scf-match-name">${m.productName}</span>
            <span class="scf-match-score">匹配度 ${(m.matchScore * 100).toFixed(0)}%</span>
            <span class="scf-match-amount">${State.formatAmount ? State.formatAmount(m.maxAmount) : m.maxAmount}</span>
            <button class="btn-mini" onclick="ViewSCF.runPricingAndMatchmaking('${m.productId}')">定价+撮合</button>
          </div>
        `).join('')}
      `;
    }
  },

  // ===== SC6+SC8 定价+撮合 =====
  runPricingAndMatchmaking(productId) {
    const eng = State.scfEngine;
    const pricing = SCFEngine.SC6_calculateRate(productId, eng.activeTradeId, eng.selectedPartnerId, State.scfDatabase.trades.find(t => t.id === eng.activeTradeId).anchorId);
    if (pricing && pricing.rejected) {
      alert(`定价拒绝: ${pricing.reason}`);
      return;
    }
    SCFEngine.SC8_simulateBids(eng.activeTradeId, productId, eng.selectedPartnerId);
    this.render();
  },

  // ===== SC7 模拟风险事件 =====
  simulateRiskEvent() {
    if (!State.scfEngine.currentAnchorId) {
      alert('请先选择核心企业');
      return;
    }
    SCFEngine.SC7_analyzeRiskDiffusion(State.scfEngine.currentAnchorId, {
      type: 'credit_downgrade',
      description: '核心企业信用分下降 50 分',
      severity: 0.7
    });
    this.render();
  },

  // ===== SC10 案例检索 =====
  searchCases() {
    const ent = State.scfEngine.selectedPartnerId ? State.getSCFEnterprise(State.scfEngine.selectedPartnerId) : null;
    const trade = State.scfEngine.activeTradeId ? State.scfDatabase.trades.find(t => t.id === State.scfEngine.activeTradeId) : null;
    const cases = SCFEngine.SC10_searchCases(ent, trade, null);
    alert(`SC10 案例检索完成: 命中 ${cases.length} 个相似案例\n\nTop3:\n${cases.map((c, i) => `${i + 1}. ${c.title} (${c.industry}/${c.product})`).join('\n')}`);
  },

  showCaseDetail(caseId) {
    const c = State.scfDatabase.cases.find(x => x.id === caseId);
    if (!c) return;
    alert(`案例详情\n\n${c.title}\n\n行业: ${c.industry}\n产品: ${c.product}\n金额: ${c.amount} @ ${c.rate}%\n周期: ${c.duration}天\n关键因素: ${c.keyFactors.join(', ')}\n\n${c.description}`);
  },

  // ===== 黑名单申诉 =====
  appealBlacklist(entId) {
    const reason = prompt('请输入申诉理由:');
    if (reason) {
      SCFEngine.SC2_appealBlacklist(entId, reason);
      this.render();
    }
  },

  approveAppeal(entId) {
    const entry = State.scfDatabase.blacklist.find(b => b.enterpriseId === entId);
    if (entry) {
      entry.appealStatus = 'approved';
      State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(b => b.enterpriseId !== entId);
      const ent = State.getSCFEnterprise(entId);
      if (ent) ent.credit.blacklistStatus = 'clean';
      State.logSCF('SC2', `✅ 申诉批准: ${entId} 已从黑名单移除`);
      State._persistSCF();
      this.render();
    }
  },

  // ===== 图算法分析 =====
  runGraphAnalysis() {
    const analysis = SCFGraph.runFullAnalysis();
    const container = document.getElementById('scf-graph-analysis');
    if (container) {
      container.innerHTML = `
        <h4>📊 图算法分析报告</h4>
        <div class="scf-analysis-summary">
          <span>节点 ${analysis.summary.totalNodes}</span>
          <span>边 ${analysis.summary.totalEdges}</span>
          <span>关键节点 ${analysis.summary.topNode}</span>
          <span>环 ${analysis.summary.cycleCount}</span>
          <span>连通分量 ${analysis.summary.componentCount}</span>
        </div>
        ${analysis.cycles.length ? `
          <div class="scf-analysis-cycles">
            <h5>⚠️ 检测到循环交易 (关联方嫌疑)</h5>
            ${analysis.cycles.map(c => `<div class="scf-cycle-item">${c.join(' → ')}</div>`).join('')}
          </div>
        ` : ''}
        <div class="scf-analysis-centrality">
          <h5>中心度 Top5</h5>
          ${analysis.centrality.slice(0, 5).map(c => `<div class="scf-centrality-item"><span>${c.name}</span><span>度=${c.degree}</span><span>中心度=${(c.centrality * 100).toFixed(0)}%</span></div>`).join('')}
        </div>
      `;
    }
  },

  // ===== 一键全链路 SC1→SC10 =====
  runFullPipeline() {
    const eng = State.scfEngine;
    if (!eng.currentAnchorId) {
      alert('请先在顶部选择核心企业');
      return;
    }
    if (!eng.selectedPartnerId) {
      // 自动选择第一个与核心企业关联的上下游
      const rel = State.scfDatabase.relationships.find(r => r.anchorId === eng.currentAnchorId);
      if (rel) {
        eng.selectedPartnerId = rel.partnerId;
      } else {
        alert('当前核心企业无上下游关系');
        return;
      }
    }
    if (!eng.activeTradeId) {
      // 自动选择第一条 verified 贸易
      const trade = State.scfDatabase.trades.find(t => t.partnerId === eng.selectedPartnerId && t.verificationLevel === 'verified');
      if (trade) {
        eng.activeTradeId = trade.id;
      } else {
        alert('当前上下游企业无 verified 贸易记录');
        return;
      }
    }
    const result = SCFEngine.runFullPipeline(eng.currentAnchorId, eng.selectedPartnerId, eng.activeTradeId);
    this.render();
    setTimeout(() => {
      if (result.success) {
        alert(`✅ SCF 全链路成功!\n\n产品: ${result.product.productName}\n金额: ${State.formatAmount ? State.formatAmount(result.loan.amount) : result.loan.amount}\n利率: ${result.loan.rate}%\n机构: ${result.loan.institutionName}\n案例: ${result.cases.length} 个`);
      } else {
        alert(`❌ SCF 全链路终止: ${result.reason}`);
      }
    }, 200);
  },

  // ===== 状态更新回调 (由 State._notify 触发) =====
  onStateChange() {
    // 仅在 Tab11 激活时重渲染
    if (State.activeTab === 'scf') {
      this.render();
    }
  }
};

window.ViewSCF = ViewSCF;
