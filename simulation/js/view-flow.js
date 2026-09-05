/**
 * view-flow.js — Tab2 融资流程模拟器
 * 包含: 发起融资 + 六流验证 + 自主度路由 + 责任人确认 + 银行竞标
 */

const ViewFlow = {
  // 当前流程状态
  flowState: {
    amount: 3000000,
    stage: 'idle', // idle / ai_analyzing / ai_routing / ai_verifying / ai_bidding / ai_executing / completed / pending_approval / rejected
    routeResult: null,
    verifyResult: null,
    bidAccepted: false,
    aiSteps: [],     // AI操作步骤实时记录
    currentStep: -1  // 当前执行到哪一步
  },

  render() {
    const ent = State.currentEnterprise;
    const container = document.getElementById('view-flow');
    if (!container) return;

    const maxAmount = State.getMaxAmount(ent);
    const fs = this.flowState;

    // Tab2担保/保险状态辅助: 生成状态标签 + 按钮可用态 (之前按钮旁完全没状态,用户点了不知道发生了啥)
    const gStatus = ent.runtime.guaranteeStatus;
    const iStatus = ent.runtime.insuranceStatus;
    const gTagHTML = (() => {
      if (gStatus === 'none')    return '<span class="tag tag-red" style="margin-left:6px">未申请</span>';
      if (gStatus === 'pending') return '<span class="tag tag-orange" style="margin-left:6px">⏳待Tab5受理</span>';
      if (gStatus === 'active')  return '<span class="tag tag-green" style="margin-left:6px">✅已生效</span>';
      if (gStatus === 'claimed') return '<span class="tag tag-red" style="margin-left:6px">追偿中</span>';
      return '';
    })();
    const iTagHTML = (() => {
      if (iStatus === 'none')    return '<span class="tag tag-red" style="margin-left:6px">未投保</span>';
      if (iStatus === 'pending') return '<span class="tag" style="background:var(--accent-purple);margin-left:6px">⏳待Tab5核保</span>';
      if (iStatus === 'active')  return '<span class="tag tag-green" style="margin-left:6px">✅已生效</span>';
      if (iStatus === 'claimed') return '<span class="tag tag-orange" style="margin-left:6px">理赔完成</span>';
      return '';
    })();
    // 按钮禁用样式: none→可点, pending/active/claimed→禁用(灰色)
    const gDisabled = gStatus !== 'none' ? 'opacity:.45;cursor:not-allowed;pointer-events:none' : '';
    const iDisabled = iStatus !== 'none' ? 'opacity:.45;cursor:not-allowed;pointer-events:none' : '';

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-flow">
        <div class="op-guide-title">
          📋 Tab2 融资流程模拟器 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-flow').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 模拟企业发起融资→AI路由→六流验证→银行竞标→资金到账的全链路闭环。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①选择金额</span><span class="op-arrow">→</span>
          <span class="op-step">②点击"发起融资"</span><span class="op-arrow">→</span>
          <span class="op-step">③查看AI路由结果</span><span class="op-arrow">→</span>
          <span class="op-step">④六流验证(五流+责任确认)</span><span class="op-arrow">→</span>
          <span class="op-step">⑤银行竞标比价</span><span class="op-arrow">→</span>
          <span class="op-step">⑥资金到账/推送审批</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">金额&lt;100万</span> + 自主度≥L1 → AI全自主(L1);
          <span class="op-trigger">金额&lt;500万</span> + 自主度≥L2 → AI自主+通知(L2);
          <span class="op-trigger">金额≥500万</span> 或自主度≤L2 → 推送人工审批(L3/L4);
          <span class="op-trigger">六流验证</span> 需在Tab1开放对应数据流+启用IoT模块才能通过.
        </div>
      </div>

      <!-- 发起融资 -->
      <div class="card">
        <div class="card-title">
          <span>融资流程模拟器 — ${ent.name}</span>
          <span class="tag tag-${ent.modules.aiAutonomyMax === 'L1' ? 'green' : ent.modules.aiAutonomyMax === 'L2' ? 'blue' : 'orange'}">自主度上限 ${ent.modules.aiAutonomyMax}</span>
        </div>
        <div class="card-grid card-grid-2">
          <div>
            <div class="metric">
              <span class="metric-label">融资金额 (最大可贷: ${State.formatAmount(maxAmount)})</span>
              <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
                <input type="number" class="input-field" id="financing-amount" value="${fs.amount}" min="100000" step="100000" style="flex:1">
                <span style="color:var(--text-muted);font-size:12px">元</span>
                <button class="btn btn-primary btn-sm" onclick="ViewFlow.startFinancing()" title="触发AI逐步执行: 风险分析→自主度路由→六流验证→银行竞标→资金到账">发起融资</button>
              </div>
            </div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-outline btn-sm" onclick="ViewFlow.setAmount(500000)" title="设置融资金额50万 → 金额<100万 + 自主度≥L1 → AI全自主(L1)">50万</button>
              <button class="btn btn-outline btn-sm" onclick="ViewFlow.setAmount(3000000)" title="设置融资金额300万 → 金额<500万 + 自主度≥L2 → AI自主+通知(L2)">300万</button>
              <button class="btn btn-outline btn-sm" onclick="ViewFlow.setAmount(8000000)" title="设置融资金额800万 → 金额≥500万 → 推送人工审批(L3/L4)">800万</button>
            </div>
            <!-- 联动规则4.8: 担保/保险申请入口 (两步工作流第一步: 发起申请→Tab5受理) -->
            <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-color)">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-outline btn-sm" style="border-color:var(--accent-purple);color:var(--accent-purple);${gDisabled}" onclick="State.applyGuarantee()" title="发起担保申请 → 推送至Tab5担保公司保前审查 → 激活后利率-0.5%+额度上浮10%">📝 申请担保</button>
                ${gTagHTML}
                <button class="btn btn-outline btn-sm" style="border-color:var(--accent-cyan);color:var(--accent-cyan);${iDisabled}" onclick="State.applyInsurance()" title="发起应收款保险申请 → 推送至Tab5保险公司核保 → 激活后利率-0.3%+确权可达A">📝 申请保险</button>
                ${iTagHTML}
              </div>
              <div style="margin-top:6px;font-size:11px;color:var(--text-muted);line-height:1.5">
                <div>👉 <b>两步工作流</b>: Tab2「📝申请」= 提交申请单 (状态→待处理); Tab5「受理激活」= 保前审查/核保通过后才真正生效 (利率/额度/信用分联动)</div>
                <div>💡 <b>快捷操作</b>: 若你不想跳Tab5受理,可直接在Tab5卡片点按钮一步完成申请+激活 (已内置快捷入口)</div>
              </div>
            </div>
          </div>
          <div>
            <div class="metric">
              <span class="metric-label">路由预览</span>
              <div style="font-size:13px;margin-top:4px;line-height:1.8">
                <div>金额 &lt; 100万 + 自主度≥L1 → <span class="tag tag-green">L1 全自主</span></div>
                <div>100-500万 + 自主度≥L2 → <span class="tag tag-blue">L2 自主+通知</span></div>
                <div>≥500万 或 自主度≤L3 → <span class="tag tag-orange">L3 人工审批</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 持有票据及再贴现 -->
      ${ent.financials.billsHeld.length > 0 ? `
        <div class="card">
          <div class="card-title">
            <span>💳 持有票据 (${ent.financials.billsHeld.length}张)</span>
            <span class="tag tag-blue">可用于再贴现</span>
          </div>
          <table class="data-table">
            <thead><tr><th>票据号</th><th>金额</th><th>到期日</th><th>类型</th><th>投保</th><th>操作</th></tr></thead>
            <tbody>
              ${ent.financials.billsHeld.map(b => `
                <tr>
                  <td>${b.billId}</td>
                  <td>${State.formatAmount(b.amount)}</td>
                  <td>${b.dueDate}</td>
                  <td>${b.type === 'bank_acceptance' ? '银行承兑' : '商业承兑'}</td>
                  <td>${b.insured ? '<span class="tag tag-green">已投保</span>' : '<span class="tag tag-orange">未投保</span>'}</td>
                  <td><button class="btn btn-sm btn-outline" onclick="ViewFlow.doBillRediscount('${b.billId}')" title="票据再贴现: AI撮合贴现, 资金快速到账">票据再贴现</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${fs.stage !== 'idle' ? this.renderStages() : '<div style="text-align:center;color:var(--text-muted);padding:40px">点击"发起融资"开始模拟流程</div>'}
    `;
  },

  renderStages() {
    const ent = State.currentEnterprise;
    const fs = this.flowState;
    let html = '';

    // === AI操作实时面板 (核心: 展示AI作为操作者) ===
    html += `
      <div class="card" style="border:2px solid #58a6ff;background:var(--bg-secondary)">
        <div class="card-title">
          <span>🤖 AI操作实时面板</span>
          ${fs.stage === 'completed' ? '<span class="tag tag-green">✅ AI执行完成</span>' :
            fs.stage === 'pending_approval' ? '<span class="tag tag-orange">📤 已推送人工审批</span>' :
            fs.stage === 'rejected' ? '<span class="tag tag-red">❌ 已否决</span>' :
            '<span class="tag tag-blue"><span class="ai-pulse"></span> AI正在操作...</span>'}
        </div>
        <div class="ai-steps-container">
          ${fs.aiSteps.map((step, i) => `
            <div class="ai-step ${step.status === 'running' ? 'ai-step-running' : 'ai-step-done'}">
              <div class="ai-step-icon ${step.status === 'running' ? 'spinning' : ''}">${step.status === 'running' ? '⚙️' : step.icon}</div>
              <div class="ai-step-content">
                <div class="ai-step-title">${step.title}</div>
                <div class="ai-step-desc">${step.desc}</div>
                <div class="ai-step-detail">${step.detail}</div>
              </div>
              <div class="ai-step-status">${step.status === 'running' ? '⏳执行中' : '✅完成'}</div>
            </div>
          `).join('')}
          ${fs.aiSteps.length === 0 ? '<div style="color:var(--text-muted);text-align:center;padding:20px">等待AI启动...</div>' : ''}
        </div>
      </div>
    `;

    html += '<div class="card-grid card-grid-2">';

    // 阶段1: 自主度路由
    html += `
      <div class="card">
        <div class="card-title">
          <span>① 自主度路由</span>
          ${fs.routeResult ? `<span class="tag tag-${fs.routeResult.routeLevel === 'L1' ? 'green' : fs.routeResult.routeLevel === 'L2' ? 'blue' : 'orange'}">${fs.routeResult.routeLevel} ${fs.routeResult.routeDesc}</span>` : '⏳'}
        </div>
        ${fs.routeResult ? `
          <div style="font-size:13px;line-height:1.8">
            <div>融资金额: <strong>${State.formatAmount(fs.routeResult.amount)}</strong></div>
            <div>企业自主度上限: <strong>${ent.modules.aiAutonomyMax}</strong></div>
            <div>风险评分: <strong>${ent.runtime.creditScore}</strong> (${ent.riskLabel})</div>
            <div>路由结果: <strong>${fs.routeResult.routeLevel} - ${fs.routeResult.routeDesc}</strong></div>
          </div>
        ` : '<div style="color:var(--text-muted)">等待AI路由...</div>'}
      </div>
    `;

    // 阶段2: 六流验证
    html += `
      <div class="card">
        <div class="card-title">
          <span>② 六流验证</span>
          ${fs.verifyResult ? `<span class="tag tag-${fs.verifyResult.grade === 'A' ? 'green' : fs.verifyResult.grade === 'B' ? 'blue' : 'orange'}">确权 ${fs.verifyResult.grade}级</span>` : '⏳'}
        </div>
        ${fs.verifyResult ? this.renderStreamVerification(fs.verifyResult) : `
          <div style="color:var(--text-muted);font-size:13px">五流验证 + 责任人确认 = 六流模型</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">人流（责任流）为第零流，贯穿全程</div>
        `}
      </div>
    `;

    // 阶段3: 银行竞标
    if (State.bankBids.length > 0) {
      html += `
        <div class="card">
          <div class="card-title">
            <span>③ 银行竞标比价</span>
            <span class="tag tag-green">${State.bankBids.length}家报价</span>
          </div>
          <table class="data-table">
            <thead><tr><th>银行</th><th>利率</th><th>额度</th><th>条件</th><th></th></tr></thead>
            <tbody>
              ${State.bankBids.map((b, i) => `
                <tr style="${i === 0 ? 'background:rgba(63,185,80,0.15)' : ''}">
                  <td>${b.bankName}${i === 0 ? ' ⭐' : ''}</td>
                  <td><strong>${b.rate}</strong></td>
                  <td>${State.formatAmount(b.amount)}</td>
                  <td>${b.condition}</td>
                  <td>${b.canFulfill ? '<span class="tag tag-green">充足</span>' : '<span class="tag tag-red">不足</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${State.bankBids[0] ? `<div style="margin-top:6px;font-size:12px;color:var(--accent-green)">🤖 AI推荐: ${State.bankBids[0].bankName} (利率最低${State.bankBids[0].canFulfill ? '+额度充足' : ''})</div>` : ''}
        </div>
      `;
    }

    // 阶段4: 执行结果
    if (fs.stage === 'completed') {
      html += `
        <div class="card">
          <div class="card-title">
            <span>④ 执行结果</span>
            <span class="tag tag-green">✅ 完成</span>
          </div>
          <div style="font-size:13px;line-height:1.8">
            <div>融资状态: <strong style="color:var(--accent-green)">${fs.routeResult.routeLevel === 'L1' || fs.routeResult.routeLevel === 'L2' ? '🤖 AI自动审批通过，资金已到账' : '已推送人工审批台'}</strong></div>
            <div>监管账户余额: <strong>${State.formatAmount(ent.financials.accountBalance)}</strong></div>
            <div>动态水位: <strong>${(ent.runtime.waterLevel * 100).toFixed(0)}%</strong></div>
          </div>
          <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="ViewFlow.reset()" title="清空当前流程状态，重新发起融资">重新发起</button>
          <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border-color)">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">边缘案例模拟 (MOD-12/MOD-05)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" style="font-size:11px;border-color:var(--accent-orange);color:var(--accent-orange)" onclick="State.simulateIoTDisconnect()" title="MOD-12 IoT断线: 五流降级四流+物联流❌+确权锁定B">📡 IoT断线</button>
              <button class="btn btn-outline btn-sm" style="font-size:11px;border-color:var(--accent-purple);color:var(--accent-purple)" onclick="ViewFlow.triggerPassiveConfirm()" title="MOD-05 消极确权: 责任人未响应→48h倒计时→到期自动确权">⏳ 消极确权倒计时</button>
            </div>
          </div>
        </div>
      `;
    }

    // 阶段3.5: 责任人确认 (如果路由到L3)
    if (fs.routeResult && (fs.routeResult.routeLevel === 'L3' || fs.routeResult.routeLevel === 'L4') && (fs.stage === 'pending_approval' || fs.stage === 'rejected')) {
      html += `
        <div class="card">
          <div class="card-title">
            <span>③ 人工审批 (L3/L4)</span>
            ${fs.stage === 'rejected' ? '<span class="tag tag-red">❌ 已否决</span>' : '<span class="tag tag-orange">待人工审批</span>'}
          </div>
          <div style="font-size:13px;line-height:1.8">
            <div>该融资请求已由🤖 AI推送至<span class="tag tag-orange">人工审批工作台</span></div>
            <div>🤖 AI建议: <span class="tag tag-green">${ent.runtime.creditScore > 700 ? '建议通过(置信度72%)' : '建议谨慎审查(置信度58%)'}</span></div>
            <div>风险评分: <strong>${ent.runtime.creditScore}</strong></div>
          </div>
          ${fs.stage !== 'rejected' ? `
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-success btn-sm" onclick="ViewFlow.manualApprove(true)" title="模拟人工审批通过 → 资金到账 → 水位更新">模拟: 审批通过</button>
              <button class="btn btn-danger btn-sm" onclick="ViewFlow.manualApprove(false)" title="模拟人工审批否决 → 融资流程终止">模拟: 审批否决</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    html += '</div>';

    // 跨视图快捷入口
    html += `
      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;
    return html;
  },

  renderStreamVerification(verifyResult) {
    const { results, grade } = verifyResult;
    const streamLabels = { contract: '合同流', invoice: '发票流', logistics: '物流流', fund: '资金流', iot: '物联流' };

    return `
      <div>
        ${Object.entries(results).map(([key, r]) => `
          <div class="stream-row">
            <span style="width:60px;font-size:13px">${streamLabels[key]}</span>
            <div class="stream-bar ${r.passed ? 'passed' : 'failed'}" style="flex:1"></div>
            <span class="stream-status">${r.passed ? '✅' : '❌'}</span>
            <span class="stream-desc">${r.desc}</span>
          </div>
        `).join('')}
        <div style="margin-top:6px;font-size:12px;color:var(--text-muted)">
          ${grade === 'A' ? '五流合一验证通过 → 确权A级' : grade === 'B' ? '四流验证通过 → 确权B级' : '基础验证 → 确权C级'}
        </div>
      </div>
      <div style="margin-top:8px;font-size:12px;padding:6px;background:var(--bg-tertiary);border-radius:4px;color:var(--text-secondary)">
        <strong>第零流：人流（责任流）</strong><br>
        所有业务操作必须有责任人签名确认，构成不可抵赖的证据链
      </div>
    `;
  },

  setAmount(amount) {
    this.flowState.amount = amount;
    this.render();
  },

  startFinancing() {
    const amountInput = document.getElementById('financing-amount');
    const amount = parseInt(amountInput?.value || this.flowState.amount);
    this.flowState.amount = amount;
    this.flowState.stage = 'ai_analyzing';
    this.flowState.routeResult = null;
    this.flowState.verifyResult = null;
    this.flowState.aiSteps = [];
    this.flowState.currentStep = -1;
    this.render();

    // AI逐步执行，每步间隔800ms让用户看到AI在工作
    this._aiStep(0, amount);
  },

  // AI逐步执行引擎
  _aiStep(step, amount) {
    const fs = this.flowState;
    const ent = State.currentEnterprise;
    const steps = [
      // Step 0: AI分析请求
      () => {
        fs.stage = 'ai_analyzing';
        fs.aiSteps.push({
          icon: '🔍', title: 'AI风险分析',
          desc: `正在分析${ent.name}的融资请求 ${State.formatAmount(amount)}`,
          detail: `读取信用评分(${ent.runtime.creditScore})、风险等级(${ent.riskLabel})、数据流完整度(${(ent.runtime.creditCompleteness*100).toFixed(0)}%)、行业政策(${ent.industryLabel})`,
          status: 'running'
        });
        fs.currentStep = 0;
        State.log('flow', `🤖 AI启动: 正在分析融资请求 ${State.formatAmount(amount)}`, 'financing');
        this.render();
      },
      // Step 1: AI路由决策
      () => {
        fs.aiSteps[0].status = 'done';
        fs.stage = 'ai_routing';
        const routeResult = State.routeFinancing(amount);
        fs.routeResult = routeResult;
        fs.aiSteps.push({
          icon: '🧭', title: `AI自主度路由 → ${routeResult.routeLevel}`,
          desc: routeResult.routeDesc,
          detail: `规则匹配: 金额${amount < 1000000 ? '<100万' : amount < 5000000 ? '<500万' : '≥500万'} + 自主度上限${ent.modules.aiAutonomyMax} → ${routeResult.routeLevel}`,
          status: 'done'
        });
        fs.currentStep = 1;
        State.log('flow', `🤖 AI决策: 路由至 ${routeResult.routeLevel} ${routeResult.routeDesc}`, 'financing');
        this.render();
      },
      // Step 2: AI六流验证
      () => {
        fs.stage = 'ai_verifying';
        const verifyResult = State.verifyFiveStreams();
        fs.verifyResult = verifyResult;
        const passedFlows = Object.entries(verifyResult.results).filter(([,r]) => r.passed).map(([k]) => k).join('/');
        fs.aiSteps.push({
          icon: '✅', title: `AI六流验证 → ${verifyResult.passedCount}/5通过 (${verifyResult.grade}级)`,
          desc: `验证结果: ${passedFlows}`,
          detail: verifyResult.allFive ? '五流合一验证通过，确权A级' : verifyResult.fourPlus ? '四流验证通过，确权B级' : '基础验证，确权C级',
          status: 'done'
        });
        fs.currentStep = 2;
        State.log('flow', `🤖 AI验证: ${verifyResult.passedCount}/5流通过 → 确权${verifyResult.grade}级`, 'financing');
        this.render();
      },
      // Step 2.5: 责任人确认（六流验证通过后）
      () => {
        const chain = ent.runtime.responsibilityChain;
        const keyNodes = chain.nodes.filter(n => n.creditWeight > 0).slice(0, 3); // 取关键3个节点
        fs.stage = 'ai_confirming';
        fs.aiSteps.push({
          icon: '🔗', title: '责任人确认（第零流：人流）',
          desc: `需要${keyNodes.length}个关键责任人确认交易`,
          detail: keyNodes.map(n => `${n.operator}(${n.role})`).join(', '),
          status: 'running'
        });
        fs.currentStep = 3;
        State.log('flow', `🤖 AI触发: 责任人确认步骤 (${keyNodes.length}个关键节点)`, 'financing');
        this.render();

        // 模拟责任人自动确认
        setTimeout(() => {
          keyNodes.forEach(n => {
            if (n.status !== 'confirmed') {
              State.confirmResponsibilityNode(n.nodeId);
            }
          });
          fs.aiSteps[3].status = 'done';
          const rateAdj = ent.runtime.rateDiscount;
          const chainTier = chain.completeness >= 0.9 ? '评级提升+合规报告' : chain.completeness >= 0.7 ? '利率优惠0.3%' : chain.completeness < 0.5 ? '利率上浮0.5%' : '无利率调整';
          fs.aiSteps.push({
            icon: '✅', title: '责任人确认完成',
            desc: `${keyNodes.length}个关键节点已确认，责任链完整度更新`,
            detail: `信用分 +${keyNodes.reduce((s,n) => s + n.creditWeight, 0)} | 完整度 ${(chain.completeness*100).toFixed(0)}% | 利率联动: ${chainTier} (调整${rateAdj >= 0 ? '+' : ''}${rateAdj}%)`,
            status: 'done'
          });
          fs.currentStep = 4;
          State.log('flow', `🤖 AI完成: ${keyNodes.length}个责任人已确认，责任链完整度${(chain.completeness*100).toFixed(0)}% → 利率联动${chainTier}`, 'financing');
          this.render();

          // 继续下一步
          setTimeout(() => this._aiStep(step + 1, amount), 800);
        }, 1500);
      },
      // Step 3: AI执行 (L1/L2) 或 AI推送审批 (L3/L4)
      () => {
        const routeLevel = fs.routeResult.routeLevel;
        if (routeLevel === 'L1' || routeLevel === 'L2') {
          // AI自主执行
          fs.stage = 'ai_bidding';
          fs.aiSteps.push({
            icon: '🏦', title: 'AI发起银行竞标',
            desc: `正在向${State.banks.length}家银行发起报价请求`,
            detail: 'AI根据信用评分、行业政策、季节性窗口动态计算各银行利率',
            status: 'running'
          });
          fs.currentStep = 5;
          State.log('flow', `🤖 AI执行: 发起银行竞标`, 'financing');
          this.render();

          // 等待后执行竞标+放款
          setTimeout(() => {
            fs.aiSteps[5].status = 'done';
            fs.stage = 'ai_executing';
            State.executeFinancing(amount, routeLevel, fs.routeResult.routeDesc);
            fs.aiSteps.push({
              icon: '💰', title: `AI${routeLevel}执行完成 — 资金已到账`,
              desc: `${State.formatAmount(amount)}已自动放款至监管账户`,
              detail: `AI全自主完成: 审批→竞标→选行→放款→水位更新`,
              status: 'done'
            });
            fs.currentStep = 6;
            fs.stage = 'completed';
            State.log('flow', `🤖 AI完成: ${routeLevel}全流程自主执行完毕`, 'financing');
            this.render();
          }, 1200);
        } else {
          // AI推送人工审批
          fs.stage = 'pending_approval';
          fs.aiSteps.push({
            icon: '📤', title: `AI推送人工审批 (${routeLevel})`,
            desc: `融资请求已推送至Tab3人工审批工作台`,
            detail: `AI建议: ${ent.runtime.creditScore > 700 ? '建议通过(置信度72%)' : '建议谨慎审查(置信度58%)'}`,
            status: 'done'
          });
          fs.currentStep = 5;
          State.executeFinancing(amount, routeLevel, fs.routeResult.routeDesc);
          State.log('flow', `🤖 AI执行: 推送至人工审批工作台 (${routeLevel})`, 'financing');
          this.render();
        }
      }
    ];

    if (step < steps.length) {
      steps[step]();
      // 下一步延迟执行 (最后一步内部有setTimeout处理)
      if (step < 2) {
        setTimeout(() => this._aiStep(step + 1, amount), 1000);
      } else if (step === 2) {
        setTimeout(() => this._aiStep(step + 1, amount), 800);
      }
    }
  },

  manualApprove(approved) {
    const ent = State.currentEnterprise;
    const fs = this.flowState;

    if (approved) {
      State.log('flow', `人工审批通过: 融资${State.formatAmount(fs.amount)}`, 'financing');
      State.simulateBankBids(fs.amount);
      ent.financials.accountBalance += fs.amount;
      ent.runtime.waterLevel = Math.min(0.95, ent.runtime.waterLevel + fs.amount / 10000000);
      State.log('flow', `→ 资金${State.formatAmount(fs.amount)}已到账`, 'financing');
      State.log('flow', `→ 监管账户余额: ${State.formatAmount(ent.financials.accountBalance)}`, 'financing');
      State.log('flow', `→ 动态水位: ${ent.runtime.waterLevel.toFixed(2)}`, 'financing');

      State.logAIOperation({
        action: `融资${State.formatAmount(fs.amount)}人工审批通过`,
        level: 'L3',
        confidence: 85,
        enterprise: ent.name,
        reasoning: [
          '触发事件: 人工审批通过',
          `融资金额: ${State.formatAmount(fs.amount)}`,
          `风险评分: ${ent.runtime.creditScore}`,
          '执行结果: 资金已到账'
        ]
      });

      fs.stage = 'completed';
    } else {
      State.log('flow', `人工审批否决: 融资${State.formatAmount(fs.amount)}`, 'financing');
      State.log('flow', `→ 融资流程终止`, 'financing');
      fs.stage = 'rejected';
    }

    State._notify();
    this.render();
  },

  reset() {
    this.flowState = {
      amount: 3000000,
      stage: 'idle',
      routeResult: null,
      verifyResult: null,
      bidAccepted: false
    };
    State.bankBids = [];
    this.render();
  },

  // 票据再贴现
  doBillRediscount(billId) {
    State.simulateBillRediscount(billId);
    this.render();
  },

  // MOD-05 消极确权倒计时入口 (在流程模拟器触发)
  triggerPassiveConfirm() {
    const ent = State.currentEnterprise;
    const chain = ent.runtime.responsibilityChain;
    const pending = chain.nodes.filter(n => n.status === 'pending');
    if (pending.length === 0) {
      State.log('flow', '无待确认责任节点, 无需消极确权', 'config');
      State._notify();
      return;
    }
    State.simulateNodePassiveConfirm(pending[0].nodeId);
    this.render();
  }
};

window.ViewFlow = ViewFlow;
