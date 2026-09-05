/**
 * view-cockpit.js — Tab7 AI驾驶舱 (全局观察台)
 * 包含: AI操作实时流 + L1-L4分布 + 决策链路回溯(含置信度) + 责任链回溯
 */

const ViewCockpit = {
  chart: null,
  expandedOps: new Set(),
  whatIfId: null,

  render() {
    const container = document.getElementById('view-cockpit');
    if (!container) return;

    const ops = State.aiOperations;
    const levelCounts = { L1: 0, L2: 0, L3: 0, L4: 0 };
    ops.forEach(o => { if (o.level in levelCounts) levelCounts[o.level]++; });

    // === [验证日志] 饼图数据源 ===
    console.group('%c[AI驾驶舱] render() — 数据流验证', 'color:#58a6ff;font-weight:bold');
    console.log('AI操作总数 (aiOperations.length):', ops.length);
    console.log('L1-L4 分布统计:', levelCounts);
    console.log('分布校验: L1+L2+L3+L4 =', levelCounts.L1 + levelCounts.L2 + levelCounts.L3 + levelCounts.L4, ops.length === (levelCounts.L1 + levelCounts.L2 + levelCounts.L3 + levelCounts.L4) ? '✅一致' : '❌不一致');
    console.log('待审批工单数:', State.approvalQueue.filter(q => q.status === 'pending').length);
    console.log('联动日志条数:', State.linkageLog.length);
    console.table(ops.slice(0, 10).map(o => ({
      id: o.id, level: o.level, confidence: o.confidence, enterprise: o.enterprise, action: o.action.substring(0, 30)
    })));
    console.groupEnd();

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-cockpit">
        <div class="op-guide-title">
          📋 Tab7 AI驾驶舱 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-cockpit').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 全局观察AI所有操作，回溯决策链路(含置信度)，查看L1-L4自主度分布，进行假设分析。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①查看全局统计</span><span class="op-arrow">→</span>
          <span class="op-step">②查看L1-L4分布饼图</span><span class="op-arrow">→</span>
          <span class="op-step">③点击AI操作展开决策回溯</span><span class="op-arrow">→</span>
          <span class="op-step">④点击"假设分析"查看如果否决会怎样</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">AI操作来源</span> Tab2融资路由/IoT监测/责任链审计/边缘案例自动记录;
          <span class="op-trigger">L1全自主</span> AI全权处理小额融资; <span class="op-trigger">L2自主+通知</span> AI处理+通知企业;
          <span class="op-trigger">L3建议+审批</span> AI建议→人工确认; <span class="op-trigger">L4人工执行</span> 全人工处理;
          <span class="op-trigger">假设分析</span> 展开后可模拟"如果当时否决/通过会怎样"的替代结果.
        </div>
      </div>

      <!-- 全局统计 -->
      <div class="card">
        <div class="card-title">
          <span>🤖 AI驾驶舱 — 全局观察台</span>
          <span class="tag tag-blue">总操作: ${ops.length}</span>
        </div>
        <div class="card-grid card-grid-3">
          <div class="metric">
            <span class="metric-label">L1 全自主</span>
            <span class="metric-value green">${levelCounts.L1}</span>
          </div>
          <div class="metric">
            <span class="metric-label">L2 自主+通知</span>
            <span class="metric-value" style="color:var(--accent-blue)">${levelCounts.L2}</span>
          </div>
          <div class="metric">
            <span class="metric-label">L3 建议+审批</span>
            <span class="metric-value orange">${levelCounts.L3}</span>
          </div>
          <div class="metric">
            <span class="metric-label">L4 人工执行</span>
            <span class="metric-value red">${levelCounts.L4}</span>
          </div>
          <div class="metric">
            <span class="metric-label">待审批工单</span>
            <span class="metric-value">${State.approvalQueue.filter(q => q.status === 'pending').length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">联动日志条数</span>
            <span class="metric-value">${State.linkageLog.length}</span>
          </div>
        </div>
      </div>

      <!-- AI综合研判面板 -->
      ${this.renderAIConclusionPanel()}

      <div class="card-grid card-grid-2">
        <!-- L1-L4 分布图 -->
        <div class="card">
          <div class="card-title">AI自主度分布</div>
          <div id="autonomy-chart" style="width:100%;height:200px"></div>
          ${ops.length === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:20px 0">暂无AI操作记录<br><span style="font-size:12px">发起融资后将自动记录</span></div>' : ''}
        </div>

        <!-- 最近联动日志摘要 -->
        <div class="card">
          <div class="card-title">最近联动日志 (最新10条)</div>
          <div style="max-height:200px;overflow-y:auto">
            ${State.linkageLog.slice(-10).reverse().map(l => `
              <div style="font-size:12px;padding:2px 0;font-family:Consolas,monospace">
                <span style="color:var(--text-muted)">${l.timestamp}</span>
                <span style="color:${l.type === 'alert' ? 'var(--accent-red)' : l.type === 'config' ? 'var(--accent-blue)' : l.type === 'financing' ? 'var(--accent-green)' : 'var(--accent-purple)'}">[${l.view}]</span>
                <span>${l.message}</span>
              </div>
            `).join('') || '<div style="color:var(--text-muted);text-align:center;padding:20px">暂无日志</div>'}
          </div>
        </div>
      </div>

      <!-- AI操作实时流 -->
      <div class="card">
        <div class="card-title">
          <span>AI操作实时流 (点击展开决策回溯)</span>
          <button class="btn btn-danger btn-sm" onclick="State.runComboTestScene();App.switchTab('cockpit')" title="一键触发组合测试: 切换高风险企业→推进至季末→触发资金抽逃→验证六流降级, 控制台输出详细日志">🧪 组合测试: 资金抽逃+季末冲量</button>
        </div>
        ${ops.length === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:30px">暂无AI操作<br><span style="font-size:12px">在Tab1/Tab2中操作后，AI操作记录将显示在此</span></div>' : ''}
        <div id="ai-ops-list">
          ${ops.slice(0, 20).map(op => this.renderOperation(op)).join('')}
        </div>
      </div>
    `;

    // 渲染图表 (即使无数据也渲染，显示"暂无数据"占位)
    this.renderChart(levelCounts);
  },

  renderOperation(op) {
    const isExpanded = this.expandedOps.has(op.id);
    const levelColors = { L1: '#3fb950', L2: '#58a6ff', L3: '#d29922', L4: '#f85149' };
    const levelLabels = { L1: 'L1 全自主', L2: 'L2 自主+通知', L3: 'L3 建议+审批', L4: 'L4 人工执行' };

    // === [验证日志] 决策链路回溯数据 ===
    console.log('%c[决策链路回溯]', 'color:#d29922', {
      id: op.id,
      action: op.action,
      level: op.level,
      confidence: op.confidence,
      enterprise: op.enterprise,
      timestamp: op.timestamp,
      reasoningSteps: op.reasoning ? op.reasoning.length : 0,
      reasoning: op.reasoning,
      expanded: isExpanded
    });

    return `
      <div class="ai-operation ${isExpanded ? 'expanded' : ''}" onclick="ViewCockpit.toggleExpand('${op.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="ai-level-badge" style="background:${levelColors[op.level]};color:#fff">${levelLabels[op.level]}</span>
              <span style="font-size:14px;font-weight:600">${op.action}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted)">${op.enterprise || ''} · ${op.timestamp}</div>
            <div style="margin-top:4px">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:11px;color:var(--text-muted)">置信度</span>
                <div class="confidence-bar" style="flex:1;max-width:200px">
                  <div class="confidence-fill" style="width:${op.confidence}%"></div>
                </div>
                <span style="font-size:12px;font-weight:600;color:${op.confidence >= 80 ? 'var(--accent-green)' : op.confidence >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)'}">${op.confidence}%</span>
              </div>
            </div>
          </div>
          <span style="color:var(--text-secondary);font-size:12px">${isExpanded ? '▲' : '▼'}</span>
        </div>
        ${isExpanded ? `
          <div class="ai-reasoning">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px;color:#1a237e">推理链路:</div>
            ${op.reasoning.map((step, i) => `
              <div class="ai-reasoning-step">${i + 1}. ${step}</div>
            `).join('')}
            ${this.renderChainTrace(op)}
            <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)">
              <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();ViewCockpit.toggleWhatIf('${op.id}')" title="假设分析: 模拟如果当时否决此操作，会触发哪些连锁反应">${this.whatIfId === op.id ? '收起假设分析' : '🔍 假设分析: 如果当时否决会怎样?'}</button>
              ${this.whatIfId === op.id ? this.renderWhatIf(op) : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  toggleExpand(opId) {
    if (this.expandedOps.has(opId)) {
      this.expandedOps.delete(opId);
      this.whatIfId = null;
      console.log('%c[决策回溯] 收起操作', 'color:#8b949e', opId);
    } else {
      this.expandedOps.add(opId);
      const op = State.aiOperations.find(o => o.id === opId);
      console.group('%c[决策回溯] 展开操作 — 推理链路', 'color:#d29922;font-weight:bold');
      console.log('操作ID:', opId);
      if (op) {
        console.log('操作:', op.action);
        console.log('自主度:', op.level);
        console.log('置信度:', op.confidence + '%');
        console.log('企业:', op.enterprise);
        console.log('时间:', op.timestamp);
        console.log('推理链路步骤数:', op.reasoning ? op.reasoning.length : 0);
        op.reasoning.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
      } else {
        console.warn('未找到操作记录:', opId);
      }
      console.groupEnd();
    }
    this.render();
  },

  // 责任链可下钻回溯 (点击AI操作 → 展开该企业责任链节点状态)
  renderChainTrace(op) {
    if (!op.enterprise) return '';
    const ent = State.enterprises.find(e => e.name === op.enterprise);
    if (!ent) return '';
    const chain = ent.runtime.responsibilityChain;
    const confirmed = chain.nodes.filter(n => n.status === 'confirmed').length;
    const timeouts = chain.nodes.filter(n => n.status === 'timeout').length;
    const absent = chain.nodes.filter(n => n.status === 'absent').length;
    const pending = chain.nodes.filter(n => n.status === 'pending').length;
    const statusLabels = { confirmed: '✅已确认', timeout: '⚠超时', absent: '✗缺席', pending: '⏳待确认' };
    const statusColors = { confirmed: 'var(--accent-green)', timeout: 'var(--accent-orange)', absent: 'var(--accent-red)', pending: 'var(--text-muted)' };
    return `
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--accent-purple)">🔗 责任链回溯 (可下钻):</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">完整度 ${(chain.completeness * 100).toFixed(0)}% | ✅${confirmed} ⚠${timeouts} ✗${absent} ⏳${pending} / 共${chain.nodes.length}节点</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:10px">
          ${chain.nodes.map(n => `<span style="padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.05);color:${statusColors[n.status]};border:1px solid ${statusColors[n.status]}33" title="${n.role} (${n.stage})">${n.nodeId.split('_')[0]}·${statusLabels[n.status]}</span>`).join('')}
        </div>
        ${chain.complianceReport ? `<div style="margin-top:6px;font-size:11px;color:var(--accent-green)">📋 《责任合规报告》已生成 | 评级: ${chain.complianceReport.grade}</div>` : ''}
      </div>
    `;
  },

  toggleWhatIf(opId) {
    this.whatIfId = (this.whatIfId === opId) ? null : opId;
    this.render();
  },

  renderWhatIf(op) {
    const isApproved = op.action.includes('通过') || op.action.includes('审批通过');
    const isL1L2 = op.level === 'L1' || op.level === 'L2';
    const amount = op.action.match(/[\d.]+万/)?.[0] || op.action.match(/[\d.]+亿/)?.[0] || '该笔';

    if (isApproved) {
      return `
        <div style="margin-top:6px;padding:8px;background:rgba(210,153,34,0.1);border-radius:4px;font-size:12px;line-height:1.7">
          <div style="font-weight:600;color:var(--accent-orange);margin-bottom:4px">📉 假设: 如果当时否决该笔融资</div>
          <div>① 企业资金链: ${amount}资金未到账，监管账户余额不足</div>
          <div>② 动态水位: 下降约0.15，可能触发水位预警</div>
          <div>③ 业务影响: 采购计划搁置，供应链可能中断</div>
          <div>④ 信用影响: 企业需寻求其他融资渠道，融资成本上升</div>
          <div>⑤ AI学习: 该决策被标记为"保守否决"，纳入后续模型训练</div>
          <div style="margin-top:4px;color:var(--text-muted)">💡 分析结论: 基于当时信用评分${op.confidence}%置信度，否决将导致企业资金紧张，建议维持通过决策</div>
        </div>
      `;
    } else {
      return `
        <div style="margin-top:6px;padding:8px;background:rgba(63,185,80,0.1);border-radius:4px;font-size:12px;line-height:1.7">
          <div style="font-weight:600;color:var(--accent-green);margin-bottom:4px">📈 假设: 如果当时通过该笔融资</div>
          <div>① 资金到账: ${amount}资金即时注入监管账户</div>
          <div>② 风险敞口: 银行端风险敞口增加，需加强贷后监管</div>
          <div>③ AI学习: 该决策被标记为"激进通过"，后续若发生违约将降低类似场景置信度</div>
          <div style="margin-top:4px;color:var(--text-muted)">💡 分析结论: 基于当前风险评分，通过决策存在一定风险，人工审批否决是更稳健的选择</div>
        </div>
      `;
    }
  },

  renderChart(levelCounts) {
    setTimeout(() => {
      const el = document.getElementById('autonomy-chart');
      if (!el) {
        console.warn('%c[饼图] DOM元素 #autonomy-chart 不存在，跳过渲染', 'color:#f85149');
        return;
      }
      if (this.chart) this.chart.dispose();
      this.chart = echarts.init(el);
      const chartData = [
        { value: levelCounts.L1, name: 'L1 全自主', itemStyle: { color: '#3fb950' } },
        { value: levelCounts.L2, name: 'L2 自主+通知', itemStyle: { color: '#58a6ff' } },
        { value: levelCounts.L3, name: 'L3 建议+审批', itemStyle: { color: '#d29922' } },
        { value: levelCounts.L4, name: 'L4 人工执行', itemStyle: { color: '#f85149' } }
      ].filter(d => d.value > 0);

      // === [验证日志] 饼图渲染数据 ===
      console.group('%c[饼图] renderChart() — ECharts数据验证', 'color:#3fb950;font-weight:bold');
      console.log('输入 levelCounts:', levelCounts);
      console.log('过滤后 chartData (value>0):', chartData);
      console.log('chartData 总数:', chartData.reduce((s, d) => s + d.value, 0));
      console.log('是否使用占位数据:', chartData.length === 0 ? '是 (显示"暂无数据")' : '否');
      if (chartData.length > 0) {
        chartData.forEach(d => {
          const pct = chartData.reduce((s, x) => s + x.value, 0) > 0
            ? ((d.value / chartData.reduce((s, x) => s + x.value, 0)) * 100).toFixed(1)
            : '0';
          console.log(`  ${d.name}: ${d.value}次 (${pct}%)`);
        });
      }
      console.log('ECharts实例已创建:', !!this.chart);
      console.groupEnd();

      this.chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: {c}次 ({d}%)', backgroundColor: '#161b22', borderColor: '#30363d', textStyle: { color: '#e6edf3' } },
        legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11, color: '#8b949e' } },
        series: [{
          type: 'pie',
          radius: ['35%', '65%'],
          center: ['50%', '40%'],
          label: { show: true, formatter: '{b}\n{c}次', fontSize: 11, color: '#e6edf3' },
          labelLine: { lineStyle: { color: '#30363d' } },
          itemStyle: { borderColor: '#0d1117', borderWidth: 2 },
          emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
          data: chartData.length > 0 ? chartData : [{ value: 1, name: '暂无数据', itemStyle: { color: '#30363d' } }]
        }]
      });
      this.chart.resize();
    }, 200);
  },

  // === AI综合研判面板 ===
  renderAIConclusionPanel() {
    const conclusion = State.generateAIConclusion();
    const riskColors = { green: '#3fb950', orange: '#d29922', red: '#f85149', blue: '#58a6ff' };
    const riskIcons = { green: '🟢', orange: '🟡', red: '🔴', blue: '🔵' };

    // 自动弹出 urgent/warning 类建议(每轮只弹第一个未处理的)
    this._maybeAutoPopupSuggestion(conclusion);

    const panelHTML = `
      <div class="card" style="background:linear-gradient(135deg, rgba(88,166,255,0.08) 0%, rgba(63,185,80,0.05) 100%);border:1px solid var(--border-light)">
        <div class="card-title" style="border-bottom:2px solid var(--accent-blue)">
          <span style="font-size:16px;font-weight:700">🧠 AI 综合研判</span>
          <span style="font-size:11px;color:var(--text-muted)">更新于 ${conclusion.generatedAt}</span>
        </div>
        <!-- 核心结论区 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:12px 0;border-bottom:1px dashed var(--border-light)">
          <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${riskColors[conclusion.overallRiskLevel.color]}">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">整体风险等级</div>
            <div style="font-size:14px;font-weight:700;color:${riskColors[conclusion.overallRiskLevel.color]}">
              ${riskIcons[conclusion.overallRiskLevel.color]} ${conclusion.overallRiskLevel.level}
            </div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${conclusion.overallRiskLevel.desc}</div>
          </div>
          <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${riskColors[conclusion.distributionHealth.color]}">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">AI分布健康度</div>
            <div style="font-size:14px;font-weight:700;color:${riskColors[conclusion.distributionHealth.color]}">
              ${conclusion.distributionHealth.status}
            </div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">L1+L2占比 ${conclusion.stats.l1l2Ratio}%</div>
          </div>
          <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${riskColors[conclusion.chainTrend.color]}">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">责任链趋势</div>
            <div style="font-size:14px;font-weight:700;color:${riskColors[conclusion.chainTrend.color]}">
              ${conclusion.chainTrend.status}
            </div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${conclusion.chainStats.map(c=>c.name.substring(0,3)+':'+c.confirmed+'/12').join(' | ')}</div>
          </div>
          <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid #58a6ff">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">关键指标</div>
            <div style="font-size:12px;font-weight:600;color:var(--text-primary)">
              均分: ${conclusion.stats.avgCreditScore} | 待批: ${conclusion.stats.pendingApprovals} | 告警: ${conclusion.stats.alertLogs}
            </div>
          </div>
        </div>
        <!-- 重点关注企业 -->
        ${conclusion.focusEnterprises.length > 0 ? `
          <div style="padding:12px 0;border-bottom:1px dashed var(--border-light)">
            <div style="font-size:12px;font-weight:600;color:var(--accent-orange);margin-bottom:8px">🎯 重点关注企业</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${conclusion.focusEnterprises.map(fe => `
                <div style="padding:6px 10px;background:rgba(210,153,34,0.1);border:1px solid rgba(210,153,34,0.3);border-radius:6px;font-size:11px">
                  <span style="font-weight:600;color:var(--accent-orange)">${fe.name.substring(0,6)}</span>
                  <span style="color:var(--text-secondary);margin-left:4px">${fe.issues.join('; ')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <!-- AI建议动作 -->
        <div style="padding:12px 0">
          <div style="font-size:12px;font-weight:600;color:var(--accent-green);margin-bottom:8px">💡 AI建议动作</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${conclusion.recommendations.map((rec, i) => {
              const recColors = { urgent: '#f85149', warning: '#d29922', focus: '#da3633', optimize: '#58a6ff', opportunity: '#3fb950', info: '#8b949e' };
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-left:3px solid ${recColors[rec.type] || '#8b949e'};border-radius:4px;cursor:${rec.action ? 'pointer' : 'default'}" 
                     ${rec.action ? `onclick="ViewCockpit.executeRecommendation('${rec.action}')"` : ''}>
                  <span style="font-size:14px">${rec.icon}</span>
                  <span style="font-size:12px;color:var(--text-primary);flex:1">${rec.text}</span>
                  ${rec.action ? '<span style="font-size:10px;color:var(--accent-blue)">执行 →</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    return panelHTML;
  },

  // === 执行AI建议动作 (格式: "动作类型|参数") ===
  executeRecommendation(action) {
    if (!action) return;
    console.log('%c[AI建议执行]', 'color:#58a6ff', action);
    const [cmd, ...rest] = action.split('|');
    const arg = rest.join('|');

    if (cmd === 'switchTab') {
      if (arg) App.switchTab(arg);
    } else if (cmd === 'switchEnterpriseByName') {
      if (arg) {
        const ent = State.enterprises.find(e => e.name === arg);
        if (ent) {
          State.switchEnterprise(ent.id);
          App.switchTab('enterprise');
        } else {
          console.warn('未找到企业:', arg);
        }
      }
    } else if (cmd === 'scrollToAlert') {
      const alertLogs = State.linkageLog.filter(l => l.type === 'alert');
      if (alertLogs.length > 0) {
        const lastAlert = alertLogs[alertLogs.length - 1];
        console.log('最近告警:', lastAlert);
        App.switchTab('regulatory');
      } else {
        console.log('当前无告警日志');
      }
    }
  },

  // === AI研判建议自动通知: 改非阻塞Toast, 不遮挡Tab7操作流 ===
  _popupedSuggestions: new Set(),
  _maybeAutoPopupSuggestion(conclusion) {
    if (typeof AIModal === 'undefined') return;
    const priority = conclusion.recommendations.find(r =>
      (r.type === 'urgent' || r.type === 'warning' || r.type === 'focus') && !this._popupedSuggestions.has(r.text)
    );
    if (!priority) return;
    this._popupedSuggestions.add(priority.text);
    const typeMeta = {
      urgent:    { label: '紧急', color: 'red' },
      warning:   { label: '警告', color: 'orange' },
      focus:     { label: '关注', color: 'orange' },
      optimize:  { label: '优化', color: 'blue' },
      opportunity:{ label: '机会', color: 'green' }
    };
    const meta = typeMeta[priority.type] || typeMeta.optimize;
    const stats = conclusion.stats;
    const summary = `风险${conclusion.overallRiskLevel.level} · L1+L2 ${stats.l1l2Ratio}% · 待批${stats.pendingApprovals} · 告警${stats.alertLogs}`;

    // urgent 紧急(红) 停留久一点, 其他默认6s
    const duration_ms = priority.type === 'urgent' ? 9000 : 6500;
    AIModal.toast({
      type: 'aiSuggestion',
      title: `🧠 AI研判 · ${meta.label} · ${conclusion.generatedAt || ''}`,
      text: priority.text,
      color: meta.color,
      duration_ms,
      actionLabel: priority.action ? '✓ 采纳并跳转' : '查看详情 →',
      onAction: () => {
        if (priority.action) {
          this.executeRecommendation(priority.action);
          State.log('system', `AI建议已采纳(Toast采纳): ${priority.text}`, 'config');
          State._notify();
        } else {
          if (typeof App !== 'undefined') App.switchTab('cockpit');
        }
      }
    });
    // 同时记录到system日志, 让可追溯
    State.log('system', `AI研判建议[${meta.label}]: ${priority.text}${priority.action ? ' (附跳转动作)' : ''}`, 'info');
  }
};

const riskColorsGlobal = { green: '#3fb950', orange: '#d29922', red: '#f85149', blue: '#58a6ff' };
const riskIconsGlobal = { green: '🟢', orange: '🟡', red: '🔴', blue: '🔵' };

window.ViewCockpit = ViewCockpit;
