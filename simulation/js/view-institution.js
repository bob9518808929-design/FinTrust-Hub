/**
 * view-institution.js — Tab5 担保与保险协作台
 * 担保: 申请受理/保前审查/反担保 | 保险: 投保受理/核保/保单/理赔
 */

const ViewInstitution = {
  render() {
    const ent = State.currentEnterprise;
    const container = document.getElementById('view-institution');
    if (!container) return;

    const guarantor = State.guarantors[0];
    const insurer = State.insurers[0];
    const gStatus = ent.runtime.guaranteeStatus;
    const iStatus = ent.runtime.insuranceStatus;

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-institution">
        <div class="op-guide-title">
          📋 Tab5 担保与保险协作台 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-institution').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 担保公司视角处理担保申请/保前审查/反担保; 保险公司视角处理投保/核保/保单/理赔。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①担保申请</span><span class="op-arrow">→</span>
          <span class="op-step">②保前审查</span><span class="op-arrow">→</span>
          <span class="op-step">③反担保登记</span><span class="op-arrow">→</span>
          <span class="op-step">④保单生效→利率优惠</span> |
          <span class="op-step">⑤投保→核保→保单→理赔</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">担保生效</span> 银行竞标利率额外-0.5%,额度+10%,信用分+15(等级受限企业需担保才能融资);
          <span class="op-trigger">保险生效</span> 利率额外-0.3%,信用分+10,B级可升至A级,覆盖应收账款违约风险;
          <span class="op-trigger">代偿触发</span> 企业资金抽逃时担保公司代偿→流程转向追偿;
          <span class="op-trigger">保险理赔</span> 应收账款违约时保险公司赔付.
        </div>
      </div>

      <div class="card-grid card-grid-2">
        <!-- 担保公司视角 -->
        <div class="card">
          <div class="card-title">
            <span>担保公司 — ${guarantor.name}</span>
            <span class="tag tag-${gStatus === 'active' ? 'green' : gStatus === 'pending' ? 'orange' : 'red'}">${{ none: '未申请', pending: '审查中', active: '已生效', claimed: '已代偿' }[gStatus]}</span>
          </div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">担保模式 (多选)</span>
              <span class="metric-value" style="font-size:13px;color:var(--accent-orange)">${ViewEnterprise.formatCooperationLabel(ent, 'guarantorMode', { recommend: '推荐', collaborate: '协同', managed: '托管', compensation: '代偿', none: '无' })}</span>
            </div>
            <div class="metric">
              <span class="metric-label">担保费率</span>
              <span class="metric-value" style="font-size:14px">${guarantor.guaranteeRate}</span>
            </div>
            <div class="metric">
              <span class="metric-label">在保项目</span>
              <span class="metric-value">${guarantor.activeGuarantees}</span>
            </div>
            <div class="metric">
              <span class="metric-label">当前企业</span>
              <span class="metric-value" style="font-size:13px">${ent.name}</span>
            </div>
          </div>

          <div class="divider"></div>

          <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">保前审查状态</div>
          <div style="font-size:13px;line-height:1.8">
            <div>① 企业资质审核: ${gStatus !== 'none' ? '✅ 通过' : '⏳ 待申请'}</div>
            <div>② 财务状况评估: ${gStatus !== 'none' ? '✅ 通过' : '⏳ 待申请'}</div>
            <div>③ 反担保措施: ${gStatus === 'active' ? '✅ 已落实' : '⏳ 待落实'}</div>
            <div>④ 风险评级: ${gStatus !== 'none' ? '✅ A级' : '⏳ 待评'}</div>
          </div>

          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${gStatus === 'none' ? `<button class="btn btn-primary btn-sm" onclick="State.activateGuarantee()" title="快捷申请+受理一步完成 → 银行利率-0.5% → 信用评分+15">📝 申请担保增信</button><span style="font-size:11px;color:var(--text-muted)">或先去Tab2发起申请再来</span>` : ''}
            ${gStatus === 'pending' ? `<button class="btn btn-success btn-sm" style="animation:pulse-btn 1.5s infinite" onclick="State.activateGuarantee()" title="保前审查通过 → 担保正式生效(利率-0.5%/额度+10%/信用分+15)">✓ 受理激活(保前审查通过)</button><span style="font-size:11px;color:var(--text-muted)">← 收到来自Tab2的申请,请点此激活</span>` : ''}
            ${gStatus === 'active' ? `<button class="btn btn-danger btn-sm" onclick="ViewInstitution.simulateCompensation()" title="模拟代偿触发 → 担保公司赔付银行 → 启动追偿流程">模拟代偿</button>` : ''}
            ${gStatus === 'claimed' ? '<span class="tag tag-red">追偿流程进行中</span>' : ''}
          </div>

          ${gStatus === 'active' ? `
            <div class="divider"></div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">反担保管理</div>
            <div style="font-size:12px;color:var(--text-muted)">
              <div>反担保方式: 企业股权质押 + 实际控制人连带责任</div>
              <div>反担保价值: ${State.formatAmount(ent.financials.accountBalance * 2)}</div>
              <div>状态: <span class="tag tag-green">已登记</span></div>
            </div>
          ` : ''}
        </div>

        <!-- 保险公司视角 -->
        <div class="card">
          <div class="card-title">
            <span>保险公司 — ${insurer.name}</span>
            <span class="tag tag-${iStatus === 'active' ? 'green' : iStatus === 'pending' ? 'orange' : 'red'}">${{ none: '未投保', pending: '核保中', active: '已生效', claimed: '已理赔' }[iStatus]}</span>
          </div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">保险模式 (多选)</span>
              <span class="metric-value" style="font-size:13px;color:var(--accent-purple)">${ViewEnterprise.formatCooperationLabel(ent, 'insuranceMode', { channel: '渠道', joint_underwriting: '联合承保', claim_collab: '理赔协作', risk_sharing: '风险共担', none: '无' })}</span>
            </div>
            <div class="metric">
              <span class="metric-label">保险费率</span>
              <span class="metric-value" style="font-size:14px">${insurer.premiumRate}</span>
            </div>
            <div class="metric">
              <span class="metric-label">有效保单</span>
              <span class="metric-value">${insurer.activePolicies}</span>
            </div>
            <div class="metric">
              <span class="metric-label">投保标的</span>
              <span class="metric-value" style="font-size:13px">应收账款</span>
            </div>
          </div>

          <div class="divider"></div>

          <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">核保审查状态</div>
          <div style="font-size:13px;line-height:1.8">
            <div>① 投保申请受理: ${iStatus !== 'none' ? '✅ 已受理' : '⏳ 待申请'}</div>
            <div>② 交易真实性核验: ${iStatus !== 'none' ? '✅ 通过' : '⏳ 待核验'}</div>
            <div>③ 买方信用评估: ${iStatus !== 'none' ? '✅ 通过' : '⏳ 待评估'}</div>
            <div>④ 保单签发: ${iStatus === 'active' ? '✅ 已签发' : '⏳ 待签发'}</div>
          </div>

          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${iStatus === 'none' ? `<button class="btn btn-primary btn-sm" style="border-color:var(--accent-purple);color:var(--accent-purple)" onclick="State.activateInsurance()" title="快捷投保+核保一步完成 → 银行利率-0.3% → 信用评分+10">📝 申请应收款保险</button><span style="font-size:11px;color:var(--text-muted)">或先去Tab2发起申请再来</span>` : ''}
            ${iStatus === 'pending' ? `<button class="btn btn-success btn-sm" style="animation:pulse-btn 1.5s infinite" onclick="State.activateInsurance()" title="核保通过 → 保险正式生效(利率-0.3%/B级可升至A级/信用分+10)">✓ 核保通过,签发保单</button><span style="font-size:11px;color:var(--text-muted)">← 收到来自Tab2的投保,请点此激活</span>` : ''}
            ${iStatus === 'active' ? `<button class="btn btn-danger btn-sm" onclick="ViewInstitution.simulateClaim()" title="模拟理赔触发 → 保险公司赔付 → 信用分-20但资金回笼">模拟理赔</button>` : ''}
            ${iStatus === 'claimed' ? '<span class="tag tag-orange">理赔已完成</span>' : ''}
          </div>

          ${iStatus === 'active' ? `
            <div class="divider"></div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">保单信息</div>
            <div style="font-size:12px;color:var(--text-muted)">
              <div>保单号: POL-2026-${ent.id}-001</div>
              <div>保险金额: ${State.formatAmount(ent.financials.pendingAR * 0.8)}</div>
              <div>免赔额: ${State.formatAmount(50000)}</div>
              <div>保险期限: 2026-01-01 ~ 2026-12-31</div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- 担保/保险对融资条件的影响 -->
      <div class="card">
        <div class="card-title">增信效果汇总</div>
        <table class="data-table">
          <thead><tr><th>增信类型</th><th>状态</th><th>利率影响</th><th>额度影响</th><th>确权等级影响</th></tr></thead>
          <tbody>
            <tr>
              <td>担保增信</td>
              <td>${gStatus === 'active' ? '<span class="tag tag-green">已生效</span>' : '<span class="tag tag-orange">未生效</span>'}</td>
              <td>${gStatus === 'active' ? '<span class="green">-0.5%</span>' : '-'}</td>
              <td>${gStatus === 'active' ? '<span class="green">+10%</span>' : '-'}</td>
              <td>-</td>
            </tr>
            <tr>
              <td>应收款保险</td>
              <td>${iStatus === 'active' ? '<span class="tag tag-green">已生效</span>' : '<span class="tag tag-orange">未生效</span>'}</td>
              <td>${iStatus === 'active' ? '<span class="green">-0.3%</span>' : '-'}</td>
              <td>-</td>
              <td>${iStatus === 'active' ? '<span class="green">升至A级</span>' : '-'}</td>
            </tr>
            <tr style="background:rgba(63,185,80,0.1)">
              <td colspan="1"><strong>综合效果</strong></td>
              <td colspan="4"><strong>利率合计优惠: ${((gStatus === 'active' ? -0.5 : 0) + (iStatus === 'active' ? -0.3 : 0)).toFixed(1)}% | 确权等级上限: ${ent.runtime.creditGradeCap}级</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;
  },

  simulateCompensation() {
    State.simulateGuaranteeCompensation();
  },

  simulateClaim() {
    State.simulateInsuranceClaim();
  }
};

window.ViewInstitution = ViewInstitution;
