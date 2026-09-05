/**
 * view-advisor.js — Tab6 财务顾问运营台
 * 全局仪表盘 + 撮合工作台(企业需求↔银行产品匹配) + 佣金结算
 */

const ViewAdvisor = {
  render() {
    const container = document.getElementById('view-advisor');
    if (!container) return;

    // 全局统计
    const totalManaged = State.enterprises.length;
    const totalBalance = State.enterprises.reduce((s, e) => s + e.financials.accountBalance, 0);
    const totalAR = State.enterprises.reduce((s, e) => s + e.financials.pendingAR, 0);
    const totalOps = State.aiOperations.length;
    const pendingApprovals = State.approvalQueue.filter(q => q.status === 'pending').length;

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-advisor">
        <div class="op-guide-title">
          📋 Tab6 财务顾问运营台 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-advisor').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 财务顾问公司全局视角，跨企业仪表盘、撮合企业需求与银行产品、佣金结算。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①查看全局仪表盘</span><span class="op-arrow">→</span>
          <span class="op-step">②撮合工作台(企业↔银行)</span><span class="op-arrow">→</span>
          <span class="op-step">③AI匹配推荐</span><span class="op-arrow">→</span>
          <span class="op-step">④佣金结算</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">全局仪表盘</span> 汇总所有企业的资金/AI操作/待审批数据;
          <span class="op-trigger">撮合匹配</span> AI根据企业信用/行业/需求自动匹配最优银行产品;
          <span class="op-trigger">佣金结算</span> 撮合成功后按融资金额×佣金比例计算分成.
        </div>
      </div>

      <!-- 全局仪表盘 -->
      <div class="card">
        <div class="card-title">
          <span>财务顾问运营台 — 全局仪表盘</span>
          <span class="tag tag-blue">"一手托两家"</span>
        </div>
        <div class="card-grid card-grid-3">
          <div class="metric">
            <span class="metric-label">在管企业</span>
            <span class="metric-value">${totalManaged}</span>
          </div>
          <div class="metric">
            <span class="metric-label">合作银行</span>
            <span class="metric-value">${State.banks.length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">撮合总金额(模拟)</span>
            <span class="metric-value">${State.formatAmount(totalBalance)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">应收款总额</span>
            <span class="metric-value">${State.formatAmount(totalAR)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">AI操作总数</span>
            <span class="metric-value">${totalOps}</span>
          </div>
          <div class="metric">
            <span class="metric-label">待审批工单</span>
            <span class="metric-value ${pendingApprovals > 0 ? 'orange' : 'green'}">${pendingApprovals}</span>
          </div>
        </div>
      </div>

      <!-- 撮合工作台 -->
      <div class="card">
        <div class="card-title">撮合工作台 — 企业需求 ↔ 银行产品 AI匹配</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;font-size:13px">
          <!-- 表头 -->
          <div style="background:var(--accent-blue-dark);color:#fff;padding:8px;text-align:center;font-weight:600">企业融资需求</div>
          <div style="background:var(--accent-blue-dark);color:#fff;padding:8px;text-align:center;font-weight:600">AI推荐匹配</div>
          <div style="background:var(--accent-blue-dark);color:#fff;padding:8px;text-align:center;font-weight:600">银行产品</div>
        </div>
        ${State.enterprises.map(ent => {
          const match = this.calculateMatch(ent);
          return `
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid var(--border-light);font-size:13px">
              <div style="padding:10px;border-right:1px solid var(--border-light)">
                <div style="font-weight:600">${ent.name}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${State.formatAmount(State.getMaxAmount(ent))} / ${ent.industryLabel}</div>
                <div style="font-size:11px;color:var(--text-muted)">信用${ent.runtime.creditScore} / ${ent.modules.aiAutonomyMax}</div>
              </div>
              <div style="padding:10px;border-right:1px solid var(--border-light);text-align:center;background:rgba(63,185,80,0.08)">
                <div style="font-size:20px;font-weight:700;color:${match.score >= 80 ? 'var(--accent-green)' : match.score >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)'}">${match.score}%</div>
                <div style="font-size:11px;color:var(--text-muted)">匹配度</div>
                <div style="font-size:12px;color:var(--accent-blue);margin-top:2px">预估佣金: ${State.formatAmount(match.commission)}</div>
              </div>
              <div style="padding:10px">
                <div style="font-weight:600">${match.bank.name}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${match.bank.baseRate} / 最高${State.formatAmount(match.bank.maxAmount)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${match.bank.label}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- 佣金结算 -->
      <div class="card">
        <div class="card-title">佣金结算明细</div>
        <table class="data-table">
          <thead><tr><th>企业</th><th>匹配银行</th><th>预估融资金额</th><th>佣金率</th><th>预估佣金</th><th>状态</th></tr></thead>
          <tbody>
            ${State.enterprises.map(ent => {
              const match = this.calculateMatch(ent);
              return `
                <tr>
                  <td>${ent.name}</td>
                  <td>${match.bank.name}</td>
                  <td>${State.formatAmount(State.getMaxAmount(ent))}</td>
                  <td>1.0%</td>
                  <td><strong>${State.formatAmount(match.commission)}</strong></td>
                  <td>${match.score >= 80 ? '<span class="tag tag-green">可推荐</span>' : match.score >= 60 ? '<span class="tag tag-orange">待优化</span>' : '<span class="tag tag-red">不推荐</span>'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--bg-tertiary);font-weight:700">
              <td colspan="4">本月服务费收入合计</td>
              <td>${State.formatAmount(State.enterprises.reduce((s, e) => s + this.calculateMatch(e).commission, 0))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;
  },

  calculateMatch(ent) {
    // 找到最匹配的银行
    let bestBank = State.banks[0];
    let bestScore = 0;

    State.banks.forEach(bank => {
      let score = 50;
      // 信用评分适配
      if (ent.runtime.creditScore > 800) score += 20;
      else if (ent.runtime.creditScore > 700) score += 15;
      else if (ent.runtime.creditScore > 600) score += 10;
      else score -= 10;
      // 额度匹配
      const maxAmount = State.getMaxAmount(ent);
      if (bank.maxAmount >= maxAmount) score += 15;
      else score -= 5;
      // 担保要求
      if (!bank.requiresGuarantee && ent.runtime.guaranteeStatus !== 'active') score += 10;
      if (bank.requiresGuarantee && ent.runtime.guaranteeStatus === 'active') score += 10;
      // 政策契合
      if (ent.industryPolicy === 'encourage') score += 5;

      if (score > bestScore) {
        bestScore = score;
        bestBank = bank;
      }
    });

    bestScore = Math.min(99, Math.max(30, bestScore));
    const commission = Math.floor(State.getMaxAmount(ent) * 0.01);

    return { bank: bestBank, score: bestScore, commission };
  }
};

window.ViewAdvisor = ViewAdvisor;
