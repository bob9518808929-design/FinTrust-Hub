/**
 * view-regulatory.js — APP-04 监管沙盒 (Tab8)
 * spec要求: 脱敏式穿透报告 + 合规检查 + 全链路审计追踪(含区块链存证验证)
 */

const ViewRegulatory = {
  _selectedTx: null,

  render() {
    const container = document.getElementById('view-regulatory');
    if (!container) return;

    const ent = State.currentEnterprise;
    const alertLogs = State.linkageLog.filter(l => l.type === 'alert');
    const aiOps = State.aiOperations;
    const auditTrail = State.getAuditTrail();
    const complianceStatus = State.getComplianceStatus();

    container.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🏛️ 监管沙盒 — 合规检查 / 脱敏穿透 / 审计追踪</span>
          <span class="tag tag-${complianceStatus.overall === '合规' ? 'green' : complianceStatus.overall === '关注' ? 'orange' : 'red'}">整体合规: ${complianceStatus.overall}</span>
        </div>
        <div class="card-grid card-grid-4">
          <div class="metric">
            <span class="metric-label">可疑交易告警</span>
            <span class="metric-value ${alertLogs.length > 0 ? 'red' : 'green'}" style="font-size:20px">${alertLogs.length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">AI操作审计记录</span>
            <span class="metric-value" style="font-size:20px">${aiOps.length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">区块链存证</span>
            <span class="metric-value green" style="font-size:20px">${auditTrail.filter(t => t.anchored).length}/${auditTrail.length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">穿透报告</span>
            <span class="metric-value" style="font-size:20px">${State.penetrationReports ? State.penetrationReports.length : 0}</span>
          </div>
        </div>
      </div>

      <!-- 脱敏式穿透报告 -->
      <div class="card">
        <div class="card-title">
          <span>📋 脱敏式穿透报告 (spec APP-04)</span>
          <span style="font-size:11px;color:var(--text-muted)">大额可疑交易 → 脱敏账户号 + 银行加密确权背书</span>
        </div>
        <div style="margin-bottom:10px;font-size:12px;color:var(--text-secondary)">
          触发条件: 大额可疑交易红色预警 → 自动生成《脱敏式穿透报告》
        </div>
        ${alertLogs.length === 0 ? `
          <div style="text-align:center;color:var(--text-muted);padding:20px">
            <div style="margin-bottom:10px">暂无可疑交易告警</div>
            <button class="btn btn-danger btn-sm" onclick="ViewRegulatory.triggerAlertForReport()" title="模拟触发白名单外大额转账 → 生成红色告警 → 可点击生成穿透报告">🚨 触发可疑交易(生成告警)</button>
            <div style="font-size:11px;margin-top:6px">点击后将生成告警日志，随后可点击告警条目生成脱敏式穿透报告</div>
          </div>
        ` : `
          <div style="margin-bottom:10px;font-size:13px;font-weight:600;color:var(--accent-orange)">⚠ 可疑交易列表 (点击生成穿透报告)</div>
          <div class="card-grid card-grid-2">
            ${alertLogs.slice(-6).reverse().map(log => `
              <div style="padding:10px;background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);border-radius:6px;cursor:pointer"
                   onclick="ViewRegulatory.generateReport('${log.id}')"
                   title="点击生成该交易的脱敏式穿透报告">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12px;font-weight:600;color:var(--accent-red)">🚨 ${log.message.substring(0, 40)}</span>
                  <span style="font-size:10px;color:var(--text-muted)">${log.timestamp}</span>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">来源: ${log.source} | 类型: ${log.type}</div>
              </div>
            `).join('')}
          </div>
        `}
        ${State.penetrationReports && State.penetrationReports.length > 0 ? this.renderReports() : ''}
      </div>

      <!-- 全链路审计追踪 -->
      <div class="card">
        <div class="card-title">
          <span>🔍 全链路审计追踪 (数据采集 → AI决策 → 资金划转)</span>
          <span style="font-size:11px;color:var(--text-muted)">含区块链存证验证</span>
        </div>
        <div style="margin-bottom:10px;font-size:12px;color:var(--text-secondary)">
          spec要求: 从数据采集→AI决策→资金划转的全链路日志，含区块链存证验证
        </div>
        ${auditTrail.length === 0 ? `
          <div style="text-align:center;color:var(--text-muted);padding:20px">暂无审计追踪记录</div>
        ` : `
          <div class="audit-trail">
            ${auditTrail.map((step, i) => `
              <div class="audit-step" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--border-light)">
                <div style="width:28px;height:28px;border-radius:50%;background:${step.anchored ? 'rgba(63,185,80,0.15)' : 'rgba(88,166,255,0.15)'};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">
                  ${step.icon}
                </div>
                <div style="flex:1">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${step.stage}</span>
                    <span style="font-size:10px;color:var(--text-muted)">${step.timestamp}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${step.desc}</div>
                  <div style="font-size:11px;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">
                    ${step.enterprise ? `<span style="color:var(--text-muted)">企业: ${step.enterprise}</span>` : ''}
                    ${step.traceCode ? `<span style="color:var(--accent-blue)">🔗 存证: ${step.traceCode.substring(0, 16)}...</span>` : ''}
                    ${step.anchored ? `<span style="color:var(--accent-green)">✅ 区块链已验证</span>` : `<span style="color:var(--accent-orange)">⏳ 待上链</span>`}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- 合规检查面板 -->
      <div class="card">
        <div class="card-title">✅ 合规检查面板</div>
        <div class="card-grid card-grid-3">
          <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${complianceStatus.chainColor}">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">责任链合规</div>
            <div style="font-size:14px;font-weight:600;color:${complianceStatus.chainColor}">${complianceStatus.chainLabel}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">完整度 ${(complianceStatus.chainCompleteness * 100).toFixed(0)}%</div>
          </div>
          <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${complianceStatus.dataColor}">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">数据流合规</div>
            <div style="font-size:14px;font-weight:600;color:${complianceStatus.dataColor}">${complianceStatus.dataLabel}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">维度完整度 ${(complianceStatus.dataCompleteness * 100).toFixed(0)}%</div>
          </div>
          <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${complianceStatus.aiColor}">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">AI操作合规</div>
            <div style="font-size:14px;font-weight:600;color:${complianceStatus.aiColor}">${complianceStatus.aiLabel}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">L3+L4审批率 ${complianceStatus.aiApprovalRate}%</div>
          </div>
        </div>
        <div style="margin-top:10px;padding:10px;background:rgba(63,185,80,0.05);border-radius:6px;font-size:12px;color:var(--text-secondary)">
          📝 合规建议: ${complianceStatus.recommendation}
        </div>
      </div>

      <!-- 跨视图快捷入口 -->
      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;
  },

  renderReports() {
    const reports = State.penetrationReports;
    const statusLabel = {
      pending:   { txt: '待审阅', cls: 'tag-orange' },
      archived:  { txt: '已归档', cls: 'tag-green' },
      need_more_info: { txt: '需补充', cls: 'tag-blue' },
      false_positive: { txt: '标记误报', cls: 'tag-red' }
    };
    return `
      <div class="divider"></div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--accent-green)">📄 已生成穿透报告 (点击卡片审阅归档)</div>
      <div class="card-grid card-grid-2">
        ${reports.slice(-3).reverse().map(r => {
          const st = statusLabel[r.status] || statusLabel.pending;
          return `
          <div style="padding:12px;background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.2);border-radius:8px;cursor:pointer;transition:box-shadow .2s"
               onmouseover="this.style.boxShadow='0 0 0 2px rgba(63,185,80,0.35)'"
               onmouseout="this.style.boxShadow='none'"
               onclick="State.openPenetrationModal('${r.id}')"
               title="点击打开审阅面板,进行确认归档/补充信息/标记误报">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:13px;font-weight:700;color:var(--accent-green)">《脱敏式穿透报告》${r.id}</span>
              <div style="display:flex;gap:4px;align-items:center">
                <span class="tag ${st.cls}" style="font-size:10px">${st.txt}</span>
                <span style="font-size:10px;color:var(--text-muted)">${r.generatedAt}</span>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.8">
              <div>🏦 银行账户: <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px">${r.desensitizedAccount}</code></div>
              <div>🏢 关联企业: ${r.desensitizedEnterprise}</div>
              <div>💰 交易金额: ${State.formatAmount(r.amount)}</div>
              <div>⚠️ 风险特征: ${r.riskFeatures}</div>
              <div>🔐 银行确权背书: <span style="color:var(--accent-green)">${r.bankEndorsement}</span></div>
              <div>🔗 区块链存证: <code style="font-size:10px">${r.chainHash.substring(0, 24)}...</code></div>
            </div>
            <div style="margin-top:8px;text-align:center;font-size:11px;color:var(--accent-green)">📋 点击此处审阅并归档</div>
          </div>
        `}).join('')}
      </div>
    `;
  },

  generateReport(logId) {
    State.generatePenetrationReport(logId);
    this.render();
  },

  // 触发一笔可疑交易告警 (供无告警时自包含演示穿透报告链路)
  triggerAlertForReport() {
    const ent = State.currentEnterprise;
    State.log('enterprise', `🚨 白名单外大额转账拦截: ${ent.name} 监管账户转出 ${State.formatAmount(2000000)} 至非白名单账户`, 'alert');
    State.log('enterprise', `→ 触发57维异常特征预警，已上报监管沙盒`, 'alert');
    State.logAIOperation({
      action: `可疑交易拦截: ${ent.name} 白名单外转账${State.formatAmount(2000000)}`,
      level: 'L3',
      confidence: 96,
      enterprise: ent.name,
      reasoning: [
        '触发事件: 监管账户向白名单外账户大额转账',
        '规则: 金额≥100万且对手方不在白名单 → 红色预警',
        '处理: 拦截交易 + 上报监管沙盒 + 生成穿透报告'
      ]
    });
    State._notify();
    this.render();
  }
};

window.ViewRegulatory = ViewRegulatory;
