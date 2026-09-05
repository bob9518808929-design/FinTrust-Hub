/**
 * view-approval.js — Tab3 人工审批工作台
 * L3/L4 待办列表 + AI决策建议包 + 决策详情展开 + 同意/否决/退回补充材料
 */

const ViewApproval = {
  expandedReqs: new Set(),

  render() {
    const container = document.getElementById('view-approval');
    if (!container) return;

    const queue = State.approvalQueue;
    const pending = queue.filter(q => q.status === 'pending');
    const processed = queue.filter(q => q.status !== 'pending');

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-approval">
        <div class="op-guide-title">
          📋 Tab3 人工审批工作台 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-approval').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 人工处理L3/L4级融资审批工单，查看AI决策建议和完整决策上下文，决定通过/否决/退回补充材料。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①查看待办列表</span><span class="op-arrow">→</span>
          <span class="op-step">②点击"展开决策详情"</span><span class="op-arrow">→</span>
          <span class="op-step">③查看水位/责任链/五流/政策</span><span class="op-arrow">→</span>
          <span class="op-step">④同意/否决/退回</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">工单来源</span> Tab2中金额≥500万或自主度≤L2的融资请求自动推送至此;
          <span class="op-trigger">AI建议</span> 置信度≥80%建议通过, 60-80%建议谨慎, <60%建议否决;
          <span class="op-trigger">同意</span> 流程继续→资金到账; <span class="op-trigger">否决</span> 流程终止; <span class="op-trigger">退回</span> 要求补充材料.
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>人工审批工作台 — L3/L4 待办</span>
          <span class="tag tag-${pending.length > 0 ? 'orange' : 'green'}">${pending.length}件待办</span>
        </div>
        ${pending.length === 0 ? `
          <div style="text-align:center;color:var(--text-muted);padding:30px">
            <div style="font-size:16px;margin-bottom:4px">暂无待审批工单</div>
            <div style="font-size:12px">在Tab2中发起金额≥500万的融资，或切换至高风险企业(L3)发起融资，工单将出现在此</div>
          </div>
        ` : ''}
        ${pending.map(req => this.renderRequest(req)).join('')}
      </div>

      ${processed.length > 0 ? `
        <div class="card">
          <div class="card-title">已处理 (${processed.length})</div>
          ${processed.slice(-5).reverse().map(req => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-light)">
              <div>
                <span style="font-weight:600">${req.enterpriseName}</span>
                <span style="color:var(--text-muted);margin-left:8px">${State.formatAmount(req.amount)}</span>
                ${req.supplementNote ? `<span style="font-size:11px;color:var(--accent-orange);margin-left:8px">退回: ${req.supplementNote.substring(0, 20)}</span>` : ''}
              </div>
              <span class="tag tag-${req.status === 'approved' ? 'green' : req.status === 'supplement' ? 'orange' : 'red'}">${req.status === 'approved' ? '已通过' : req.status === 'supplement' ? '已退回' : '已否决'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
      </div>
    `;
  },

  renderRequest(req) {
    const isExpanded = this.expandedReqs.has(req.id);
    const isReformLegal = req.type === 'reform_legal' && req.reform;
    // 改造合规工单无融资 ctx,独立渲染
    if (isReformLegal) {
      const r = req.reform;
      const sevColor = r.severityLevel === 'red' ? 'red' : r.severityLevel === 'gray' ? 'orange' : 'blue';
      return `
        <div style="border:1px solid var(--border-color);border-radius:6px;padding:12px;margin-bottom:12px;background:linear-gradient(135deg, var(--bg-tertiary) 0%, ${sevColor==='red'?'rgba(248,81,73,0.06)':sevColor==='gray'?'rgba(210,153,34,0.06)':'rgba(88,166,255,0.06)'} 100%);border-left:4px solid var(--accent-${sevColor})">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div>
              <span style="font-weight:600;font-size:15px">${req.enterpriseName}</span>
              <span style="color:var(--text-muted);margin-left:8px">${req.timestamp}</span>
              <div style="margin-top:4px">
                <span class="tag tag-${sevColor}" style="font-size:12px">${r.severityLabel} · 改造合规审查</span>
                <span class="tag tag-${sevColor}" style="margin-left:4px">${r.currentAutonomy}</span>
                <span class="tag tag-blue" style="margin-left:4px">${r.executorName}</span>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="tag tag-${r.severityLevel==='red'?'red':r.severityLevel==='gray'?'orange':'blue'}">${r.severityLevel==='red'?'🔴 红线':r.severityLevel==='gray'?'🟡 灰区':'🔵 L2边界'}</span>
              <span class="tag tag-orange">${req.routeLevel}</span>
            </div>
          </div>

          <div class="card-grid card-grid-2" style="margin-bottom:8px">
            <div class="metric">
              <span class="metric-label">任务 ID / 维度</span>
              <span class="metric-value" style="font-size:14px">${r.taskId} · ${({subject:'主体',finance:'财务',tax:'税务',business:'业务',assets:'资产',credit:'信用',policy:'政策',capital:'资本'})[r.taskDim]||r.taskDim}</span>
            </div>
            <div class="metric">
              <span class="metric-label">改造任务成本</span>
              <span class="metric-value ${req.riskScore > 700 ? 'red' : req.riskScore > 600 ? 'orange' : 'green'}" style="font-size:14px">${State.formatAmount(req.amount)}</span>
            </div>
          </div>

          <div style="background:${r.severityLevel==='red'?'rgba(248,81,73,0.08)':r.severityLevel==='gray'?'rgba(210,153,34,0.08)':'rgba(88,166,255,0.08)'};padding:8px 10px;border-radius:4px;margin-bottom:8px;font-size:13px;border:1px solid ${r.severityLevel==='red'?'rgba(248,81,73,0.2)':r.severityLevel==='gray'?'rgba(210,153,34,0.2)':'rgba(88,166,255,0.2)'}">
            <strong>📝 任务描述:</strong> ${r.taskLabel}
            ${r.summary ? `<div style="margin-top:4px"><strong>🔔 ${r.severityLabel}详情:</strong> ${r.summary}</div>` : ''}
          </div>

          <div style="background:rgba(88,166,255,0.12);padding:8px;border-radius:4px;margin-bottom:8px;font-size:13px;border:1px solid rgba(88,166,255,0.2)">
            <strong>🤖 AI决策建议包:</strong> ${req.aiSuggestion}
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="font-size:11px;color:var(--text-muted)">置信度</span>
              <div class="confidence-bar" style="flex:1;max-width:150px">
                <div class="confidence-fill" style="width:${req.aiConfidence}%"></div>
              </div>
              <span style="font-size:12px;font-weight:600">${req.aiConfidence}%</span>
            </div>
          </div>

          ${isExpanded ? this.renderReformDecisionDetails(r, req) : `
            <button class="btn btn-outline btn-sm" onclick="ViewApproval.toggleDetail('${req.id}')" style="width:100%;margin-bottom:8px">📋 展开 R7 合规审查发现 ▼</button>
          `}

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-success btn-sm" onclick="State.approveRequest('${req.id}', true)" title="通过: 将任务直接标记 done 并调用 advanceReformTask 推进改造进度">✓ 人工通过</button>
            <button class="btn btn-danger btn-sm" onclick="ViewApproval._rejectReform('${req.id}')" title="否决: 标记任务 failed 并触发 R6 动态重排 (任务拆分成并行子任务)">✗ 否决并触发 R6</button>
            <button class="btn btn-warning btn-sm" onclick="ViewApproval._escalateAutonomy('${req.id}')" title="提升至 L4 全流程自主: 直接把企业的改造自主度切换至 L4,让 R5 自己执行">⚡ 提升至 L4</button>
            ${isExpanded ? `<button class="btn btn-outline btn-sm" onclick="ViewApproval.toggleDetail('${req.id}')">收起</button>` : ''}
          </div>
        </div>
      `;
    }
    // ===== 融资审批工单 (原有逻辑) =====
    const ctx = State.getApprovalContext(req);
    return `
      <div style="border:1px solid var(--border-color);border-radius:6px;padding:12px;margin-bottom:12px;background:var(--bg-tertiary)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <span style="font-weight:600;font-size:15px">${req.enterpriseName}</span>
            <span style="color:var(--text-muted);margin-left:8px">${req.timestamp}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="tag tag-${ctx ? (ctx.riskProfile === 'premium' ? 'green' : ctx.riskProfile === 'normal' ? 'blue' : 'red') : 'red'}">${ctx ? ctx.riskLabel : ''}</span>
            <span class="tag tag-orange">${req.routeLevel}</span>
          </div>
        </div>
        <div class="card-grid card-grid-3" style="margin-bottom:8px">
          <div class="metric">
            <span class="metric-label">融资金额</span>
            <span class="metric-value" style="font-size:16px">${State.formatAmount(req.amount)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">风险评分</span>
            <span class="metric-value ${req.riskScore > 700 ? 'green' : req.riskScore > 600 ? 'orange' : 'red'}" style="font-size:16px">${req.riskScore}</span>
          </div>
          <div class="metric">
            <span class="metric-label">确权等级</span>
            <span class="metric-value" style="font-size:16px">${req.creditGrade}级</span>
          </div>
        </div>
        <div style="background:rgba(88,166,255,0.12);padding:8px;border-radius:4px;margin-bottom:8px;font-size:13px;border:1px solid rgba(88,166,255,0.2)">
          <strong>🤖 AI决策建议包:</strong> ${req.aiSuggestion}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="font-size:11px;color:var(--text-muted)">置信度</span>
            <div class="confidence-bar" style="flex:1;max-width:150px">
              <div class="confidence-fill" style="width:${req.aiConfidence}%"></div>
            </div>
            <span style="font-size:12px;font-weight:600">${req.aiConfidence}%</span>
          </div>
        </div>
        ${req.needsSupplement ? `
          <div style="background:rgba(210,153,34,0.12);padding:8px 10px;border-radius:4px;margin-bottom:8px;font-size:13px;border:1px solid rgba(210,153,34,0.3);border-left:3px solid var(--accent-orange)">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:16px">⚠️</span>
              <strong style="color:var(--accent-orange)">待补充材料:</strong>
              <span style="color:var(--text-secondary)">${req.supplementNote || '请补充经营数据与回款凭证'}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">企业补充材料后,工单状态将自动流转,请重新审批</div>
          </div>
        ` : ''}

        ${isExpanded && ctx ? this.renderDecisionDetails(req, ctx) : `
          <button class="btn btn-outline btn-sm" onclick="ViewApproval.toggleDetail('${req.id}')" style="width:100%;margin-bottom:8px" title="展开查看决策所需的完整上下文: 水位/责任链/五流/政策/路由原因">📊 展开决策详情 ▼</button>
        `}

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-success btn-sm" onclick="State.approveRequest('${req.id}', true)" title="审批通过 → 融资流程继续 → 资金到账 → 水位更新">✓ 同意</button>
          <button class="btn btn-danger btn-sm" onclick="State.approveRequest('${req.id}', false)" title="审批否决 → 融资流程终止 → 记录否决原因">✗ 否决</button>
          <button class="btn btn-warning btn-sm" onclick="ViewApproval.rejectSupplement('${req.id}')" title="退回企业补充材料 → 融资暂缓 → 要求补充经营数据/回款凭证">↩ 退回补充材料</button>
          ${isExpanded ? `<button class="btn btn-outline btn-sm" onclick="ViewApproval.toggleDetail('${req.id}')">收起</button>` : ''}
        </div>
      </div>
    `;
  },

  // 决策详情面板: 展示审批所需的完整上下文
  renderDecisionDetails(req, ctx) {
    const flowLabels = { fund: '资金', contract: '合同', invoice: '发票', iot: '物联', logistics: '物流', people: '人流' };
    return `
      <div style="border:1px solid var(--border-color);border-radius:6px;padding:12px;margin-bottom:8px;background:rgba(0,0,0,0.2)">
        <div style="font-size:13px;font-weight:700;color:var(--accent-blue);margin-bottom:10px">📊 决策详情 — 审批所需完整上下文</div>

        <!-- 路由原因 -->
        <div style="padding:8px;background:rgba(210,153,34,0.1);border-radius:4px;margin-bottom:10px;font-size:12px">
          <strong style="color:var(--accent-orange)">📌 路由原因:</strong> ${ctx.routeReason}
        </div>

        <div class="card-grid card-grid-3" style="gap:8px">
          <!-- 资金水位 -->
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">💰 资金水位</div>
            <div style="font-size:13px;font-weight:600">${(ctx.waterLevel * 100).toFixed(0)}%</div>
            <div class="progress-bar" style="margin-top:4px">
              <div class="progress-fill ${ctx.waterLevel > 0.6 ? 'green' : ctx.waterLevel > 0.3 ? 'orange' : 'red'}" style="width:${ctx.waterLevel * 100}%"></div>
            </div>
          </div>
          <!-- 监管账户余额 -->
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🏦 监管账户余额</div>
            <div style="font-size:13px;font-weight:600">${State.formatAmount(ctx.accountBalance)}</div>
          </div>
          <!-- 应收款 -->
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">📥 应收款</div>
            <div style="font-size:13px;font-weight:600">${State.formatAmount(ctx.pendingAR)}</div>
          </div>
        </div>

        <div class="card-grid card-grid-2" style="gap:8px;margin-top:8px">
          <!-- 责任链 -->
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🔗 责任链完整度</div>
            <div style="font-size:13px;font-weight:600">${ctx.chainConfirmed}/${ctx.chainTotal} 节点已确认 (${(ctx.chainCompleteness * 100).toFixed(0)}%)</div>
            <div class="progress-bar" style="margin-top:4px">
              <div class="progress-fill ${ctx.chainCompleteness >= 0.7 ? 'green' : ctx.chainCompleteness >= 0.4 ? 'orange' : 'red'}" style="width:${ctx.chainCompleteness * 100}%"></div>
            </div>
          </div>
          <!-- 行业政策 -->
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">📋 行业政策</div>
            <div style="font-size:13px;font-weight:600">
              <span class="tag tag-${ctx.industryPolicy === 'encourage' ? 'green' : ctx.industryPolicy === 'restrict' ? 'red' : 'blue'}">${ctx.policyLabel}</span>
            </div>
          </div>
        </div>

        <!-- 五流合一状态 -->
        <div style="margin-top:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">🔄 五流合一 (${ctx.openFlows}/6 通过)</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${Object.entries(ctx.fiveStreams).map(([k, v]) => `
              <span style="font-size:11px;padding:2px 8px;border-radius:4px;${v ? 'background:rgba(63,185,80,0.15);color:var(--accent-green)' : 'background:rgba(248,81,73,0.15);color:var(--accent-red)'}">${flowLabels[k] || k} ${v ? '✓' : '✗'}</span>
            `).join('')}
          </div>
        </div>

        <!-- 营收支出 -->
        <div class="card-grid card-grid-2" style="gap:8px;margin-top:8px">
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">📈 月营收</div>
            <div style="font-size:13px;font-weight:600;color:var(--accent-green)">${State.formatAmount(ctx.monthlyRevenue)}</div>
          </div>
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">📉 月支出</div>
            <div style="font-size:13px;font-weight:600;color:var(--accent-red)">${State.formatAmount(ctx.monthlyExpense)}</div>
          </div>
        </div>

        ${ctx.fundFlowBlocked ? `
          <div style="margin-top:8px;padding:6px 8px;background:rgba(248,81,73,0.1);border-radius:4px;font-size:12px;color:var(--accent-red)">⚠ 该企业资金流已被冻结</div>
        ` : ''}
        ${ctx.guaranteeStatus === 'active' ? `
          <div style="margin-top:4px;padding:6px 8px;background:rgba(63,185,80,0.08);border-radius:4px;font-size:12px;color:var(--accent-green)">担保已生效，可适当放宽审批</div>
        ` : ''}

        <div style="margin-top:8px;padding:6px 0;border-top:1px dashed var(--border-light);font-size:11px;color:var(--text-muted)">
          💡 决策提示: 综合水位、责任链、五流、政策判断风险。水位<0.3或责任链<50%建议否决或退回补充材料。
        </div>
      </div>
    `;
  },

  // ===== spec 联动 5.5: R7 合规审查发现面板 =====
  renderReformDecisionDetails(r, req) {
    const findings = r.findings || [];
    const dimLabel = { subject:'主体', finance:'财务', tax:'税务', business:'业务', assets:'资产', credit:'信用', policy:'政策', capital:'资本' };
    return `
      <div style="border:1px solid var(--border-color);border-radius:6px;padding:12px;margin-bottom:8px;background:rgba(0,0,0,0.2)">
        <div style="font-size:13px;font-weight:700;color:var(--accent-${r.severityLevel==='red'?'red':r.severityLevel==='gray'?'orange':'blue'});margin-bottom:10px">
          📋 R7 合规审查发现 &mdash; ${r.severityLabel} (共 ${findings.length} 项)
        </div>

        <!-- 路由原因/摘要 -->
        <div style="padding:8px;background:${r.severityLevel==='red'?'rgba(248,81,73,0.08)':r.severityLevel==='gray'?'rgba(210,153,34,0.08)':'rgba(88,166,255,0.08)'};border-radius:4px;margin-bottom:10px;font-size:12px">
          <strong style="color:${r.severityLevel==='red'?'var(--accent-red)':r.severityLevel==='gray'?'var(--accent-orange)':'var(--accent-blue)'}">📌 原因:</strong> ${r.summary || r.taskLabel}
        </div>

        <div class="card-grid card-grid-2" style="gap:8px;margin-bottom:10px">
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🏭 执行器</div>
            <div style="font-size:13px;font-weight:600">${r.executorName}</div>
          </div>
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🔗 任务维度</div>
            <div style="font-size:13px;font-weight:600">${(dimLabel[r.taskDim]||r.taskDim)} · ${r.taskId}</div>
          </div>
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🤖 当前自主度</div>
            <div style="font-size:13px;font-weight:600">${r.currentAutonomy}</div>
          </div>
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">💼 审批路由</div>
            <div style="font-size:13px;font-weight:600">${req.routeLevel} (企业合规官 → CRO → 法务)</div>
          </div>
        </div>

        <!-- R7 逐条 findings -->
        ${findings.length > 0 ? `
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">🔍 R7 合规引擎审查结果</div>
          <div style="max-height:180px;overflow-y:auto;padding-right:4px">
            ${findings.map(f => {
              const fcolor = f.level === 'red' ? 'red' : f.level === 'gray' ? 'orange' : 'green';
              return `
                <div style="padding:6px 8px;margin-bottom:4px;border-radius:4px;background:${fcolor==='red'?'rgba(248,81,73,0.06)':fcolor==='gray'?'rgba(210,153,34,0.06)':'rgba(63,185,80,0.06)'};border-left:3px solid var(--accent-${fcolor})">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                    <div style="font-size:12px;font-weight:600">
                      <span class="tag tag-${fcolor} tag-xs" style="margin-right:6px">${f.level==='red'?'红线':f.level==='gray'?'灰区':'绿'}</span>
                      ${f.label}
                    </div>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${f.detail || ''}</div>
                  ${f.action ? `<div style="font-size:11px;color:var(--accent-blue);margin-top:2px">➤ 建议: ${f.action}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="padding:8px;font-size:12px;color:var(--text-muted)">无 R7 逐条 findings (为 L2 + requiresLegal 触发的自主度边界阻断)</div>
        `}

        <div style="margin-top:10px;padding:6px 0;border-top:1px dashed var(--border-light);font-size:11px;color:var(--text-muted)">
          💡 操作建议: 红线 → 建议否决并升级 L4 人工介入;灰区 → 材料齐全可通过;L2边界 → 直接提升至 L3/L4 即可自动放行。
        </div>
      </div>
    `;
  },

  // ===== 改造合规审批的辅助操作 =====
  _rejectReform(reqId) {
    const reason = window.prompt('请输入否决原因(留空使用默认):', '触碰合规红线或证据不足,不允许通过');
    State.approveRequest(reqId, false, reason);
  },

  _escalateAutonomy(reqId) {
    // 一键把当前企业的改造自主度提升到 L4,并把工单改为通过 (L4 允许法务签章)
    const req = State.approvalQueue.find(q => q.id === reqId);
    if (!req || req.type !== 'reform_legal' || !req.reform) return;
    State.setReformAutonomyLevel('L4');
    // L4 下可以直接执行,因此把该工单通过
    if (typeof AIModal !== 'undefined') {
      AIModal.toast({
        type: 'info',
        title: '⚡ 已提升至 L4 全流程自主',
        text: `R5 家族可以直接执行法务签章类动作 (含 ${req.reform.executorName} 等 8 类执行器),任务将在下次"单步推进"时自动放行`,
        color: 'blue',
        duration_ms: 5000
      });
    }
    State.log('reform', `⚡ [联动5.5] Tab3 审批员点击"提升至 L4" → 改造任务 ${req.reform.taskId} 将在下次推进时由 R5 家族自动执行`, 'reform');
  },

  toggleDetail(reqId) {
    if (this.expandedReqs.has(reqId)) {
      this.expandedReqs.delete(reqId);
    } else {
      this.expandedReqs.add(reqId);
    }
    this.render();
  },

  rejectSupplement(reqId) {
    const req = State.approvalQueue.find(q => q.id === reqId);
    // 改造合规工单不走补充材料 (走提升至 L4 或 否决 R6),直接禁用并提示
    if (req && req.type === 'reform_legal') {
      if (typeof AIModal !== 'undefined') {
        AIModal.toast({
          type: 'warning',
          title: '改造合规工单不支持退回补充材料',
          text: '请选择 "人工通过" / "否决并触发 R6" / "提升至 L4" 三种操作之一',
          color: 'orange',
          duration_ms: 4000
        });
      }
      return;
    }
    const note = window.prompt('请输入退回补充材料的原因(留空使用默认):', '请补充近3个月经营数据与回款凭证');
    State.rejectWithSupplement(reqId, note);
  }
};

window.ViewApproval = ViewApproval;
