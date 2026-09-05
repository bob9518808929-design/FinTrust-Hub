/**
 * view-bank.js — Tab4 银行端工作台
 * 动态信用画像 + AI推荐授信 + 贷后监管 + 预警列表 + 数据脱敏对比 + 责任合规报告
 */

const ViewBank = {
  showRawData: false,
  chart: null,

  render() {
    const ent = State.currentEnterprise;
    const container = document.getElementById('view-bank');
    if (!container) return;

    const maxAmount = State.getMaxAmount(ent);
    const chain = ent.runtime.responsibilityChain;
    const confirmedCount = chain.nodes.filter(n => n.status === 'confirmed').length;

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-bank">
        <div class="op-guide-title">
          📋 Tab4 银行端工作台 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-bank').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 银行视角查看企业信用画像、贷后监管水位、预警列表、数据脱敏对比、责任合规报告。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①查看信用雷达图</span><span class="op-arrow">→</span>
          <span class="op-step">②监控贷后水位/回款</span><span class="op-arrow">→</span>
          <span class="op-step">③查看预警列表</span><span class="op-arrow">→</span>
          <span class="op-step">④切换脱敏对比</span><span class="op-arrow">→</span>
          <span class="op-step">⑤查看责任合规报告</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">信用画像</span> 随Tab1企业配置实时更新;
          <span class="op-trigger">水位预警</span> 水位<0.3触发黄牌, <0.1触发红牌;
          <span class="op-trigger">责任预警</span> Tab1中责任节点超时/缺席会推送至此;
          <span class="op-trigger">脱敏对比</span> 仅可见Tab1中配置的开放字段, 未开放字段以"—"显示.
        </div>
      </div>

      <!-- 信用画像 -->
      <div class="card">
        <div class="card-title">
          <span>动态信用画像 — ${ent.name}</span>
          <span class="tag tag-${ent.riskProfile === 'premium' ? 'green' : ent.riskProfile === 'normal' ? 'blue' : 'red'}">${ent.riskLabel}</span>
        </div>
        <div class="card-grid card-grid-2">
          <div>
            <div id="credit-radar" style="height:220px"></div>
          </div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">AI信用评分</span>
              <span class="metric-value ${ent.runtime.creditScore > 700 ? 'green' : ent.runtime.creditScore > 600 ? 'orange' : 'red'}">${ent.runtime.creditScore}</span>
            </div>
            <div class="metric">
              <span class="metric-label">确权等级</span>
              <span class="metric-value">${ent.runtime.creditGradeCap}级</span>
            </div>
            <div class="metric">
              <span class="metric-label">AI推荐授信额度</span>
              <span class="metric-value">${State.formatAmount(maxAmount)}</span>
              <span class="metric-delta">乘数 × ${ent.runtime.maxAmountMultiplier.toFixed(1)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">推荐利率</span>
              <span class="metric-value ${ent.runtime.rateDiscount > 0 ? 'red' : ent.runtime.rateDiscount < 0 ? 'green' : ''}">${State.getRateString(ent)}</span>
              ${State.seasonalWindow && State.seasonalWindow !== 'normal' ? `<span class="tag tag-green" style="font-size:10px;margin-left:4px" title="MOD-10 季节性窗口">${State.seasonalWindow === 'quarter_end' ? '季末利率优惠' : State.seasonalWindow === 'year_end' ? '年末窗口' : '春节紧张'}</span>` : ''}
            </div>
            <div class="metric">
              <span class="metric-label">审批速度</span>
              <span class="metric-value" style="font-size:14px">${{ fast: '快速通道', normal: '正常', slow: '缓慢' }[ent.runtime.approvalSpeed]}</span>
            </div>
            <div class="metric">
              <span class="metric-label">行业政策</span>
              <span class="metric-value" style="font-size:14px"><span class="tag tag-${ent.industryPolicy === 'encourage' ? 'green' : ent.industryPolicy === 'restrict' ? 'red' : 'blue'}">${State.getPolicyLabel(ent.industryPolicy)}</span></span>
            </div>
          </div>
        </div>
      </div>

      <div class="card-grid card-grid-2">
        <!-- 银行操作面板 -->
        <div class="card">
          <div class="card-title">
            <span>🏦 银行操作面板</span>
            <span class="tag tag-${ent.runtime.fundFlowBlocked ? 'red' : 'green'}">${ent.runtime.fundFlowBlocked ? '账户已冻结' : '账户正常'}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
            银行端可执行的风控操作: 调整授信、冻结账户、发送风险函、标记关注
          </div>
          <!-- 调整授信乘数 -->
          <div style="border:1px solid var(--border-light);border-radius:6px;padding:10px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:13px;font-weight:600">调整授信乘数</span>
              <span style="font-size:12px;color:var(--accent-blue)">当前 × ${ent.runtime.maxAmountMultiplier.toFixed(1)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">AI推荐额度: ${State.formatAmount(maxAmount)} | 点击后弹窗确认</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="State.confirmBankAction('adjustCredit', -0.2)" title="下调授信乘数0.2(弹窗确认)">⬇ 下调 0.2</button>
              <button class="btn btn-outline btn-sm" onclick="State.confirmBankAction('adjustCredit', 0.2)" title="上调授信乘数0.2(弹窗确认)">⬆ 上调 0.2</button>
              <button class="btn btn-outline btn-sm" onclick="State.confirmBankAction('adjustCredit', 0.5)" title="大幅上调授信乘数0.5(弹窗确认)">⬆⬆ 上调 0.5</button>
            </div>
          </div>
          <!-- 冻结/解冻 -->
          <div style="border:1px solid var(--border-light);border-radius:6px;padding:10px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px;font-weight:600">监管账户管控</span>
              <span class="tag tag-${ent.runtime.fundFlowBlocked ? 'red' : 'green'}">${ent.runtime.fundFlowBlocked ? '资金流冻结' : '资金流正常'}</span>
            </div>
            <div style="margin-top:6px">
              <button class="btn btn-${ent.runtime.fundFlowBlocked ? 'success' : 'danger'} btn-sm" onclick="State.confirmBankAction('toggleFreeze')" title="${ent.runtime.fundFlowBlocked ? '解冻监管账户(弹窗确认)' : '冻结监管账户(弹窗确认)'}">${ent.runtime.fundFlowBlocked ? '🔓 解冻账户' : '🔒 冻结账户'}</button>
            </div>
          </div>
          <!-- 风控动作 -->
          <div style="border:1px solid var(--border-light);border-radius:6px;padding:10px">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px">风控函件与名单</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="State.confirmBankAction('riskNotice')" title="向企业发送《风险提示函》(弹窗确认)">📨 发送风险提示函</button>
              <button class="btn btn-${ent.runtime.watchlisted ? 'warning' : 'outline'} btn-sm" onclick="State.confirmBankAction('toggleWatch')" title="${ent.runtime.watchlisted ? '解除' : '标记'}重点关注(弹窗确认)">${ent.runtime.watchlisted ? '★ 解除关注' : '☆ 标记关注'}</button>
            </div>
          </div>
        </div>

        <!-- 贷后监管 -->
        <div class="card">
          <div class="card-title">贷后监管</div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">监管账户余额</span>
              <span class="metric-value">${State.formatAmount(ent.financials.accountBalance)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">动态水位</span>
              <div class="progress-bar" style="margin-top:4px">
                <div class="progress-fill ${ent.runtime.waterLevel > 0.6 ? 'green' : ent.runtime.waterLevel > 0.3 ? 'orange' : 'red'}" style="width:${ent.runtime.waterLevel * 100}%"></div>
              </div>
              <span class="metric-delta">${(ent.runtime.waterLevel * 100).toFixed(0)}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">应收款</span>
              <span class="metric-value">${State.formatAmount(ent.financials.pendingAR)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">月营收/支出</span>
              <span class="metric-value" style="font-size:14px">${State.formatAmount(ent.financials.monthlyRevenue)} / <span class="red">${State.formatAmount(ent.financials.monthlyExpense)}</span></span>
            </div>
          </div>
          ${ent.runtime.guaranteeStatus !== 'none' ? `<div style="margin-top:8px"><span class="tag tag-${ent.runtime.guaranteeStatus === 'active' ? 'green' : 'red'}">担保: ${{ none: '无', pending: '申请中', active: '已生效', claimed: '已代偿' }[ent.runtime.guaranteeStatus]}</span></div>` : ''}
          ${ent.runtime.insuranceStatus !== 'none' ? `<div style="margin-top:4px"><span class="tag tag-${ent.runtime.insuranceStatus === 'active' ? 'green' : 'red'}">保险: ${{ none: '无', pending: '申请中', active: '已生效', claimed: '已理赔' }[ent.runtime.insuranceStatus]}</span></div>` : ''}
        </div>

        <!-- 责任合规报告 -->
        <div class="card">
          <div class="card-title">责任合规报告</div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">责任链完整度</span>
              <div class="progress-bar" style="margin-top:4px">
                <div class="progress-fill ${chain.completeness >= 0.7 ? 'green' : chain.completeness >= 0.4 ? 'orange' : 'red'}" style="width:${chain.completeness * 100}%"></div>
              </div>
              <span class="metric-delta">${confirmedCount}/${chain.nodes.length} 节点已确认</span>
            </div>
            <div class="metric">
              <span class="metric-label">超时未确认</span>
              <span class="metric-value ${chain.nodes.filter(n => n.status === 'timeout').length > 0 ? 'red' : 'green'}" style="font-size:16px">${chain.nodes.filter(n => n.status === 'timeout').length}次</span>
            </div>
            <div class="metric">
              <span class="metric-label">管理风险评估</span>
              <span class="metric-value" style="font-size:14px">
                <span class="tag tag-${chain.completeness >= 0.7 ? 'green' : chain.completeness >= 0.4 ? 'orange' : 'red'}">${chain.completeness >= 0.7 ? '低风险' : chain.completeness >= 0.4 ? '中风险' : '高风险'}</span>
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">利率联动 (规则4.10)</span>
              <span class="metric-value" style="font-size:14px">
                <span class="tag tag-${chain.completeness >= 0.7 ? 'green' : chain.completeness < 0.5 ? 'red' : 'orange'}" title="责任链完整度→融资利率: ≥90%评级提升 / ≥70%优惠0.3% / <50%上浮0.5%">${chain.completeness >= 0.9 ? '评级提升+优惠0.3%' : chain.completeness >= 0.7 ? '利率优惠0.3%' : chain.completeness < 0.5 ? '利率上浮0.5%' : '无调整'}</span>
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">合规报告状态</span>
              <span class="metric-value" style="font-size:14px">${chain.complianceReport ? '<span class="tag tag-green">已生成 A-</span>' : '<span class="tag tag-orange">未生成</span>'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 数据脱敏对比 -->
      <div class="card">
        <div class="card-title">
          <span>交易流水 — 数据脱敏对比</span>
          <div>
            <button class="btn btn-outline btn-sm" id="toggle-desensitize" onclick="ViewBank.toggleDesensitize()" title="切换原始数据/脱敏数据对比视图，观察字段级可见性控制效果">${this.showRawData ? '显示脱敏数据' : '显示原始数据'}</button>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>日期</th><th>对手方</th><th>金额</th><th>账户尾号</th><th>类型</th></tr></thead>
          <tbody>
            ${this.getMockTransactions(ent).map(t => `
              <tr>
                <td>${t.date}</td>
                <td>${this.showRawData ? t.counterparty : State.desensitize(t.counterparty)}</td>
                <td>${State.formatAmount(t.amount)}</td>
                <td>${this.showRawData ? t.account : State.desensitize(t.account, 'account')}</td>
                <td>${t.type}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">⚙ 格式保留加密(FPE/FF1) | 区块链存证根: <span style="color:var(--accent-orange);font-family:'Cascadia Code',monospace">${typeof LogPanel !== 'undefined' ? LogPanel.merkleRoot() : '00000000'}</span></div>
      </div>

      <!-- 预警列表 -->
      <div class="card">
        <div class="card-title">预警列表</div>
        ${this.getAlerts(ent)}
      </div>

      <!-- 跨视图快捷入口 -->
      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;

    this.renderRadar(ent);
  },

  getMockTransactions(ent) {
    return [
      { date: '2026-08-10', counterparty: '张三有限公司', amount: 1000000, account: '3847', type: '转账' },
      { date: '2026-08-08', counterparty: '李四建材', amount: 500000, account: '2956', type: '采购付款' },
      { date: '2026-08-05', counterparty: '王五物流', amount: 200000, account: '7123', type: '运费' },
      { date: '2026-08-01', counterparty: '赵六科技', amount: 800000, account: '4489', type: '回款' }
    ];
  },

  getAlerts(ent) {
    const alerts = [];
    if (ent.runtime.creditScore < 600) alerts.push({ level: 'red', msg: '信用评分低于600，高风险', time: '实时' });
    if (ent.runtime.waterLevel < 0.4) alerts.push({ level: 'red', msg: '动态水位低于40%，资金紧张', time: '实时' });
    const timeoutNodes = ent.runtime.responsibilityChain.nodes.filter(n => n.status === 'timeout');
    if (timeoutNodes.length > 0) alerts.push({ level: 'red', msg: `${timeoutNodes.length}个责任节点超时未确认`, time: '今日' });
    const absentNodes = ent.runtime.responsibilityChain.nodes.filter(n => n.status === 'absent');
    if (absentNodes.length > 0) alerts.push({ level: 'red', msg: `${absentNodes.length}个责任节点责任人缺席`, time: '今日' });
    if (ent.industryPolicy === 'restrict') alerts.push({ level: 'yellow', msg: '行业政策限制，融资条件收紧', time: '政策' });
    if (ent.runtime.guaranteeStatus === 'claimed') alerts.push({ level: 'red', msg: '担保已代偿，追偿流程进行中', time: '本周' });
    if (ent.runtime.insuranceStatus === 'claimed') alerts.push({ level: 'yellow', msg: '保险已理赔', time: '本周' });

    if (alerts.length === 0) {
      return '<div style="text-align:center;color:var(--accent-green);padding:12px">✅ 暂无预警</div>';
    }
    return alerts.map(a => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light)">
        <span class="tag tag-${a.level === 'red' ? 'red' : 'orange'}">${a.level === 'red' ? '红牌' : '黄牌'}</span>
        <span style="font-size:13px;flex:1">${a.msg}</span>
        <span style="font-size:11px;color:var(--text-muted)">${a.time}</span>
      </div>
    `).join('');
  },

  toggleDesensitize() {
    this.showRawData = !this.showRawData;
    this.render();
  },

  renderRadar(ent) {
    setTimeout(() => {
      const el = document.getElementById('credit-radar');
      if (!el) return;
      if (this.chart) this.chart.dispose();
      this.chart = echarts.init(el);
      const openFlows = State.countOpenFlows(ent);
      this.chart.setOption({
        tooltip: {},
        radar: {
          indicator: [
            { name: '信用评分', max: 1000 },
            { name: '数据流', max: 6 },
            { name: '水位', max: 1 },
            { name: '责任链', max: 1 },
            { name: '政策', max: 3 },
            { name: '担保保险', max: 2 }
          ],
          radius: '65%'
        },
        series: [{
          type: 'radar',
          data: [{
            value: [
              ent.runtime.creditScore,
              openFlows,
              ent.runtime.waterLevel,
              ent.runtime.responsibilityChain.completeness,
              ent.industryPolicy === 'encourage' ? 3 : ent.industryPolicy === 'neutral' ? 2 : 1,
              (ent.runtime.guaranteeStatus === 'active' ? 1 : 0) + (ent.runtime.insuranceStatus === 'active' ? 1 : 0)
            ],
            areaStyle: { color: 'rgba(26,35,126,0.2)' },
            lineStyle: { color: '#1a237e' }
          }]
        }]
      });
    }, 50);
  }
};

window.ViewBank = ViewBank;
