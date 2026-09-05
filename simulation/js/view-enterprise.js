/**
 * view-enterprise.js — Tab1 企业端工作台
 * 包含: 资金看板 + 企业配置引擎(数据流/模块/自主度) + 责任链全景图 + 实时影响预览
 */

const ViewEnterprise = {
  render() {
    const ent = State.currentEnterprise;
    const container = document.getElementById('view-enterprise');
    if (!container) return;

    const openFlows = State.countOpenFlows(ent);
    const maxAmount = State.getMaxAmount(ent);
    const chain = ent.runtime.responsibilityChain;
    const confirmedCount = chain.nodes.filter(n => n.status === 'confirmed').length;

    container.innerHTML = `
      <!-- 操作指引 -->
      <div class="op-guide" id="guide-enterprise">
        <div class="op-guide-title">
          📋 Tab1 企业端工作台 — 操作指引
          <span class="op-guide-toggle" onclick="document.getElementById('guide-enterprise').classList.toggle('collapsed')">收起/展开</span>
        </div>
        <div class="op-guide-body">
          <strong>本Tab用途:</strong> 模拟企业端配置融资条件、管理责任链、控制数据可见范围。<br>
          <strong>操作流程:</strong>
          <span class="op-step">①切换企业</span><span class="op-arrow">→</span>
          <span class="op-step">②配置数据流/模块</span><span class="op-arrow">→</span>
          <span class="op-step">③设置自主度上限</span><span class="op-arrow">→</span>
          <span class="op-step">④确认责任链节点</span><span class="op-arrow">→</span>
          <span class="op-step">⑤配置字段可见范围</span><span class="op-arrow">→</span>
          <span class="op-step">⑥去Tab2发起融资</span><br>
          <strong>触发条件说明:</strong>
          <span class="op-trigger">数据流开关</span> 开放流数越多→信用完整度越高→融资额度越大/利率越低;
          <span class="op-trigger">IoT模块</span> 启用后五流合一→确权等级可达A级;
          <span class="op-trigger">责任链确认</span> 每确认1节点信用分+3, 全部确认+10;
          <span class="op-trigger">自主度L1-L4</span> 控制AI可自主处理的融资额度上限;
          <span class="op-trigger">模拟超时/缺席</span> 触发管理风险预警, 信用分下降.
        </div>
      </div>

      <!-- 资金看板 -->
      <div class="card">
        <div class="card-title">
          <span>资金看板 — ${ent.name}</span>
          <span class="tag tag-${ent.riskProfile === 'premium' ? 'green' : ent.riskProfile === 'normal' ? 'blue' : 'red'}">${ent.riskLabel}</span>
        </div>
        <div class="card-grid card-grid-3">
          <div class="metric">
            <span class="metric-label">账户余额</span>
            <span class="metric-value">${State.formatAmount(ent.financials.accountBalance)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">月营收</span>
            <span class="metric-value">${State.formatAmount(ent.financials.monthlyRevenue)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">月支出</span>
            <span class="metric-value red">${State.formatAmount(ent.financials.monthlyExpense)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">应收款</span>
            <span class="metric-value">${State.formatAmount(ent.financials.pendingAR)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">信用评分</span>
            <span class="metric-value ${ent.runtime.creditScore > 700 ? 'green' : ent.runtime.creditScore > 600 ? 'orange' : 'red'}">${ent.runtime.creditScore}</span>
          </div>
          <div class="metric">
            <span class="metric-label">动态水位</span>
            <div class="progress-bar" style="margin-top:4px">
              <div class="progress-fill ${ent.runtime.waterLevel > 0.6 ? 'green' : ent.runtime.waterLevel > 0.3 ? 'orange' : 'red'}" style="width:${ent.runtime.waterLevel * 100}%"></div>
            </div>
            <span class="metric-delta">${(ent.runtime.waterLevel * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div class="card-grid card-grid-2">
        <!-- 企业配置引擎 -->
        <div class="card">
          <div class="card-title">企业配置引擎</div>

          <!-- 数据流配置 -->
          <div style="margin-bottom:12px">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">数据流配置 (${openFlows}/6)</div>
            ${Object.entries(ent.dataFlows).map(([key, val]) => `
              <div class="toggle-row" title="开关${MockData.DATA_FLOW_LABELS[key]}数据 → 联动信用维度完整度 → 影响额度乘数/利率/确权等级">
                <span class="toggle-label">${MockData.DATA_FLOW_LABELS[key]}</span>
                <label class="toggle-switch">
                  <input type="checkbox" ${val ? 'checked' : ''} onchange="ViewEnterprise.toggleFlow('${key}')">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            `).join('')}
            <div style="margin-top:6px">
              <div class="progress-bar">
                <div class="progress-fill ${ent.runtime.creditCompleteness >= 0.67 ? 'green' : ent.runtime.creditCompleteness >= 0.33 ? 'orange' : 'red'}" style="width:${ent.runtime.creditCompleteness * 100}%"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">信用维度完整度: ${(ent.runtime.creditCompleteness * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div class="divider"></div>

          <!-- 模块配置 -->
          <div style="margin-bottom:12px">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">模块配置</div>
            ${Object.entries(ent.modules).map(([key, val]) => {
              if (key === 'aiAutonomyMax') {
                return `
                  <div class="toggle-row" title="AI自主度上限: L1全自主(<100万) / L2自主+通知(<500万) / L3建议+审批 / L4人工执行">
                    <span class="toggle-label">${State.getModuleLabel(key)}</span>
                    <select class="input-field" style="width:auto;padding:2px 6px" onchange="ViewEnterprise.changeAutonomy('${key}', this.value)">
                      <option value="L1" ${val === 'L1' ? 'selected' : ''}>L1 全自主</option>
                      <option value="L2" ${val === 'L2' ? 'selected' : ''}>L2 自主+通知</option>
                      <option value="L3" ${val === 'L3' ? 'selected' : ''}>L3 建议+审批</option>
                      <option value="L4" ${val === 'L4' ? 'selected' : ''}>L4 人工执行</option>
                    </select>
                  </div>
                `;
              } else if (key === 'fundMonitor') {
                return `
                  <div class="toggle-row" title="资金监管强度: 强监管(实时拦截) / 弱监管(事后告警) / 不监管">
                    <span class="toggle-label">${State.getModuleLabel(key)}</span>
                    <select class="input-field" style="width:auto;padding:2px 6px" onchange="ViewEnterprise.changeModule('${key}', this.value)">
                      <option value="strong" ${val === 'strong' ? 'selected' : ''}>强监管</option>
                      <option value="weak" ${val === 'weak' ? 'selected' : ''}>弱监管</option>
                      <option value="none" ${val === 'none' ? 'selected' : ''}>不监管</option>
                    </select>
                  </div>
                `;
              } else {
                return `
                  <div class="toggle-row" title="开关${State.getModuleLabel(key)} → 联动五流合一验证/确权等级/利率优惠">
                    <span class="toggle-label">${State.getModuleLabel(key)}</span>
                    <label class="toggle-switch">
                      <input type="checkbox" ${val ? 'checked' : ''} onchange="ViewEnterprise.toggleModule('${key}')">
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                `;
              }
            }).join('')}
          </div>
        </div>

        <!-- 实时影响预览 -->
        <div class="card">
          <div class="card-title">实时影响预览</div>
          <div class="card-grid">
            <div class="metric">
              <span class="metric-label">融资额度上限</span>
              <span class="metric-value">${State.formatAmount(maxAmount)}</span>
              <span class="metric-delta">基数 × ${ent.runtime.maxAmountMultiplier.toFixed(1)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">利率</span>
              <span class="metric-value ${ent.runtime.rateDiscount > 0 ? 'red' : ent.runtime.rateDiscount < 0 ? 'green' : ''}">${State.getRateString(ent)}</span>
              <span class="metric-delta">${ent.runtime.rateDiscount > 0 ? '+' : ''}${ent.runtime.rateDiscount}% 调整</span>
            </div>
            <div class="metric">
              <span class="metric-label">确权等级上限</span>
              <span class="metric-value">${ent.runtime.creditGradeCap}级</span>
              <span class="metric-delta">${MockData.CREDIT_GRADES[ent.runtime.creditGradeCap]?.desc || ''}</span>
            </div>
            <div class="metric">
              <span class="metric-label">审批速度</span>
              <span class="metric-value">${{ fast: '快速', normal: '正常', slow: '缓慢' }[ent.runtime.approvalSpeed]}</span>
            </div>
            <div class="metric">
              <span class="metric-label">行业政策</span>
              <span class="metric-value" style="font-size:14px">
                <span class="tag tag-${ent.industryPolicy === 'encourage' ? 'green' : ent.industryPolicy === 'restrict' ? 'red' : 'blue'}">${State.getPolicyLabel(ent.industryPolicy)}</span>
              </span>
              <span class="metric-delta">${ent.industryLabel}</span>
            </div>
            <div class="metric">
              <span class="metric-label">AI自主度上限</span>
              <span class="metric-value" style="font-size:14px">${MockData.AUTONOMY_LEVELS[ent.modules.aiAutonomyMax]?.label || ent.modules.aiAutonomyMax}</span>
            </div>
          </div>

          <div class="divider"></div>

          <!-- 持有票据 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600;color:var(--text-secondary)">持有票据 (${ent.financials.billsHeld.length})</span>
            <button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px" onclick="State.addBill()" title="新增一张持有票据(阶段二自定义)">+ 新增票据</button>
          </div>
          ${ent.financials.billsHeld.length > 0 ? `
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
                    <td><button class="btn btn-danger btn-sm" style="font-size:10px;padding:1px 6px" onclick="State.removeBill('${b.billId}')" title="删除该票据">删除</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">暂无持有票据,点击"新增票据"添加</div>'}
        </div>
      </div>

      <!-- 字段级数据可见范围配置(多选矩阵: 每个字段独立勾选银行/担保/保险) -->
      <div class="card">
        <div class="card-title">
          <span>🔒 字段级数据可见范围配置</span>
          <span style="font-size:11px;color:var(--text-muted);font-weight:400;margin-left:8px">支持多选: 同一字段可同时对银行+担保+保险可见(每行独立勾选,三类机构互不覆盖)</span>
        </div>

        <!-- 快捷预设批量按钮 -->
        <div style="margin-bottom:10px;padding:8px 10px;background:var(--bg-tertiary);border-radius:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span style="font-size:12px;color:var(--text-secondary);font-weight:600;margin-right:4px">⚡ 快捷预设:</span>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('bank_core')" title="只向银行开放KYC核心字段(名称/法人/资本/信用/交易)">银行核心(KYC)</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('guarantor_mortgage')" title="担保公司=名称/法人/信用/财务/票据(押品评估需要)">担保押品评估</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('insurance_risk')" title="保险公司=名称/信用/财务/票据(保费厘定&理赔核赔)">保险核保核赔</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('all_open')" title="全量字段对银行+担保+保险均可见(仅用于演示/测试)">全量开放(演示)</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('minimum')" title="最小可见:仅企业名称+信用评分可见(最严格)">最小可见(严格)</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.visibilityPreset('layered')" title="分层可见(推荐):银行≥担保≥保险(按业务需要阶梯式开放)">分层可见·推荐</button>
        </div>

        <!-- 多选矩阵表头: 字段名 | 银行端 | 担保公司 | 保险公司 -->
        <div class="visibility-matrix" id="visibility-fields" style="font-size:12px">
          <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:4px 10px;padding:6px 8px;background:var(--bg-tertiary);border-radius:6px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;position:sticky;top:0;z-index:1">
            <div>字段 (敏感字段以🟠标记)</div>
            <div style="text-align:center;color:var(--accent-blue)">🏦 银行端可见</div>
            <div style="text-align:center;color:var(--accent-orange)">🛡 担保公司可见</div>
            <div style="text-align:center;color:var(--accent-purple)">🛡 保险公司可见</div>
          </div>
          ${this.renderVisibilityMatrix(ent)}
        </div>

        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.toggleVisibilityPreview()" title="并排预览三方视角差异:银行/担保/保险,未开放字段以—显示">${this._visibilityPreview ? '隐藏三方脱敏预览' : '并排预览三方视角'}</button>
          ${this._visibilityPreview ? `<span style="font-size:11px;color:var(--text-muted)">↓ 同屏对比银行/担保/保险三方可见差异</span>` : ''}
        </div>
        ${this._visibilityPreview ? this.renderAllVisibilityPreviews(ent) : ''}
      </div>

      <!-- 企业自定义扩展 (阶段二) -->
      <div class="card">
        <div class="card-title">
          <span>⚙️ 企业自定义扩展</span>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.resetEnterprise()" title="恢复企业默认配置(行业/风险/财务/合作模式)">重置默认</button>
        </div>
        <div class="card-grid card-grid-2">
          <!-- 行业与风险编辑 -->
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">行业与风险等级</div>
            <div class="toggle-row">
              <span class="toggle-label">行业</span>
              <select class="input-field" style="width:auto;padding:2px 6px;font-size:12px" onchange="ViewEnterprise.editIndustry(this.value)">
                <option value="manufacturing" ${ent.industry === 'manufacturing' ? 'selected' : ''}>制造业</option>
                <option value="high_tech" ${ent.industry === 'high_tech' ? 'selected' : ''}>高新技术</option>
                <option value="real_estate_related" ${ent.industry === 'real_estate_related' ? 'selected' : ''}>房地产关联</option>
              </select>
            </div>
            <div class="toggle-row">
              <span class="toggle-label">风险等级</span>
              <select class="input-field" style="width:auto;padding:2px 6px;font-size:12px" onchange="ViewEnterprise.editRiskProfile(this.value)">
                <option value="premium" ${ent.riskProfile === 'premium' ? 'selected' : ''}>优质</option>
                <option value="normal" ${ent.riskProfile === 'normal' ? 'selected' : ''}>正常</option>
                <option value="high_risk" ${ent.riskProfile === 'high_risk' ? 'selected' : ''}>高风险</option>
              </select>
            </div>
          </div>

          <!-- 合作模式(多选: 同一类机构可同时承担多个角色,如银行=贷前+贷后+咨询) -->
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);display:flex;align-items:center;gap:6px">
              合作模式
              <span style="font-size:10px;color:var(--text-muted);font-weight:400">(支持多选·点击切换·全不选=无)</span>
            </div>
            ${this.renderCooperationPills(ent, 'enterpriseMode', [
              { v: 'custody',           label: '托管' },
              { v: 'advisory',          label: '顾问' },
              { v: 'financing_advisory',label: '融资顾问' },
              { v: 'planning',          label: '规划' }
            ], 'var(--accent-blue)')}
            ${this.renderCooperationPills(ent, 'bankMode', [
              { v: 'post_loan',  label: '贷后' },
              { v: 'discovery',  label: '发现' },
              { v: 'consulting', label: '咨询' },
              { v: 'delegation', label: '委派' },
              { v: 'pre_loan',   label: '贷前' }
            ], 'var(--accent-green)')}
            ${this.renderCooperationPills(ent, 'guarantorMode', [
              { v: 'recommend',     label: '推荐' },
              { v: 'collaborate',   label: '协同' },
              { v: 'managed',       label: '托管' },
              { v: 'compensation',  label: '代偿' }
            ], 'var(--accent-orange)')}
            ${this.renderCooperationPills(ent, 'insuranceMode', [
              { v: 'channel',           label: '渠道' },
              { v: 'joint_underwriting',label: '联合承保' },
              { v: 'claim_collab',      label: '理赔协作' },
              { v: 'risk_sharing',      label: '风险共担' }
            ], 'var(--accent-purple)')}
          </div>
        </div>

        <div class="divider"></div>

        <!-- 财务数据编辑 -->
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">财务数据编辑 (实时重算所有指标)</div>
        <div class="card-grid card-grid-3">
          <div class="metric">
            <span class="metric-label">月营收 (元)</span>
            <input type="number" class="input-field" style="font-size:13px" value="${ent.financials.monthlyRevenue}" onchange="ViewEnterprise.editFinancial('monthlyRevenue', this.value)">
          </div>
          <div class="metric">
            <span class="metric-label">月支出 (元)</span>
            <input type="number" class="input-field" style="font-size:13px" value="${ent.financials.monthlyExpense}" onchange="ViewEnterprise.editFinancial('monthlyExpense', this.value)">
          </div>
          <div class="metric">
            <span class="metric-label">账户余额 (元)</span>
            <input type="number" class="input-field" style="font-size:13px" value="${ent.financials.accountBalance}" onchange="ViewEnterprise.editFinancial('accountBalance', this.value)">
          </div>
          <div class="metric">
            <span class="metric-label">应收款 (元)</span>
            <input type="number" class="input-field" style="font-size:13px" value="${ent.financials.pendingAR}" onchange="ViewEnterprise.editFinancial('pendingAR', this.value)">
          </div>
        </div>
      </div>

      <!-- 责任链全景图 -->
      <div class="card">
        <div class="card-title">
          <span>🔗 责任链全景图</span>
          <span class="tag tag-${chain.completeness >= 0.7 ? 'green' : chain.completeness >= 0.4 ? 'orange' : 'red'}">完整度 ${(chain.completeness * 100).toFixed(0)}% (${confirmedCount}/${chain.nodes.length})</span>
        </div>
        <div class="responsibility-chain">
          ${chain.nodes.map((node, i) => `
            <div class="chain-node ${node.status}" onclick="ViewEnterprise.clickNode('${node.nodeId}')" title="点击确认此责任节点 → 信用分+1 → 生成溯源码">
              <span class="chain-node-icon">${node.status === 'confirmed' ? '✅' : node.status === 'timeout' ? '❌' : node.status === 'absent' ? '🚨' : '⏳'}</span>
              <span class="chain-node-name">${node.name}</span>
              <span class="chain-node-person">${node.operator}</span>
            </div>
            ${i < chain.nodes.length - 1 ? '<span class="chain-arrow">→</span>' : ''}
          `).join('')}
        </div>
        <div style="margin-top:8px">
          <div class="progress-bar">
            <div class="progress-fill ${chain.completeness >= 0.7 ? 'green' : chain.completeness >= 0.4 ? 'orange' : 'red'}" style="width:${chain.completeness * 100}%"></div>
          </div>
        </div>
        ${chain.complianceReport ? `
          <div style="margin-top:8px;padding:8px;background:rgba(63,185,80,0.1);border-radius:4px;font-size:12px;color:var(--text-secondary)">
            📋 《责任合规报告》已生成 | 评级: ${chain.complianceReport.grade} | 完整度: ${(chain.complianceReport.completeness * 100).toFixed(0)}%
          </div>
        ` : ''}
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-success btn-sm" onclick="ViewEnterprise.confirmAll()" title="一键确认全部12个责任节点 → 信用分+10 → 责任链完整度100%">全部确认</button>
      <button class="btn btn-outline btn-sm" style="border-color:var(--accent-blue)" onclick="State.simulateFullBusinessCycle()" title="模拟完整经营周期: 融资→采购→生产→销售→回款→还款, 逐步推进业务流并触发4.10联动">🔄 完整周期</button>
          <button class="btn btn-warning btn-sm" onclick="ViewEnterprise.simulateTimeout()" title="模拟责任节点超时未确认 → 信用分-5 → 触发管理风险预警">模拟超时</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.simulateNodePassiveConfirm()" title="责任链节点消极确权: 责任人未响应→启动48h倒计时(3秒模拟)→到期自动确权→标记消极确权">节点消极确权倒计时</button>
          <button class="btn btn-danger btn-sm" onclick="ViewEnterprise.simulateAbsence()" title="模拟责任人无法联系 → 管理风险预警 → 信用分-5 → 银行端收到预警">模拟责任人缺席</button>
        </div>

        <div class="divider"></div>

        <!-- 边缘案例模拟 -->
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">⚡ 边缘案例模拟</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-danger btn-sm" onclick="State.simulateFundFlight()" title="综合特征: 白名单外大额转账 → 信用分-100 → 水位30% → 资金流冻结 → 红牌预警">🚨 资金抽逃(综合)</button>
          <button class="btn btn-danger btn-sm" onclick="State.simulateFundFlight('hollowing')" title="空心化(spec MOD-02): 监管账户只有过桥还款流入，日常硬支出不走该账户 → 信用分-80 → 水位35% → 资金流异常">🏭 空心化</button>
          <button class="btn btn-danger btn-sm" onclick="State.simulateFundFlight('repayment_cliff')" title="回款断崖(spec MOD-02): 回款额骤降但开票纳税数据增长 → 信用分-70 → 水位40% → 回款率骤降">📉 回款断崖</button>
          <button class="btn btn-danger btn-sm" onclick="State.simulateFundFlight('settlement_disorder')" title="结算紊乱(spec MOD-02): 采购付款周期突然异常变化 → 信用分-60 → 水位45% → 合同流异常">🔀 结算紊乱</button>
          <button class="btn btn-outline btn-sm" onclick="State.simulateWhitelistBlock()" title="模拟白名单外转账拦截 → 推送审批台 → 银行端收到预警">白名单外转账拦截</button>
          <button class="btn btn-warning btn-sm" onclick="ViewEnterprise.simulateQuarterEnd()" title="推进至季末冲量窗口 → 银行端利率优惠激活 → 融资推荐增加提示">季末冲量窗口</button>
          <button class="btn btn-outline btn-sm" onclick="ViewEnterprise.simulateBuyerPassiveConfirm()" title="买方消极确权(spec MOD-05): 买方不配合盖章→三方数据授权发送加密确权请求→48h未异议视为默认确认→应收款可纳入融资">📋 买方消极确权(应收款)</button>
        </div>
      </div>

      <!-- 跨视图快捷入口 -->
      <div style="text-align:center;padding:8px">
        ${(() => {
          // ===== BP-02 修复 (simulation-plan L15): 改造优先铁律 — 融资入口基于 financingUnlocked 控制 =====
          // ===== 兜底: 同时检查 reformEngine.status==='completed' 和 ent.reform.hasReformed, 三重保险 =====
          const ent = State.currentEnterprise;
          const re = State.reformEngine || {};
          const unlockedByRuntime = ent && ent.runtime && ent.runtime.financingUnlocked === true;
          const unlockedByReformEngine = re.status === 'completed';
          const unlockedByEntReform = ent && ent.reform && ent.reform.hasReformed === true;
          const unlocked = unlockedByRuntime || unlockedByReformEngine || unlockedByEntReform;
          if (unlocked) {
            // 已解锁: 正常跳转 + 显示推荐银行 (来自 R9 撮合)
            const bids = (State.bankBids || []).filter(b => b.enterpriseId === ent.id).slice(0, 3);
            const bidCards = bids.map(b => `
              <div style="display:inline-block;padding:6px 10px;margin:3px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:5px;font-size:11px">
                🏦 <b>${b.bankName}</b> · ${b.product} · ${b.amountText} · ${b.rate} · 匹配度 ${b.probability}%${b.preApproval?' ✅预审批':''}
              </div>`).join('');
            return `
              <div style="margin:8px 0;padding:8px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:6px">
                <div style="font-size:12px;color:#10b981;font-weight:600;margin-bottom:4px">✅ 改造已完成 · 融资入口已解锁 (financingUnlocked=true · 等级 ${re.currentLevel || ent.runtime.creditGradeCap || 'A'})</div>
                ${bids.length ? `<div style="margin-top:4px">${bidCards}</div>` : '<div style="font-size:11px;color:var(--text-muted)">R9 银行撮合尚未运行, 可在 Tab0 点击 ⑥ 银行匹配 生成推荐</div>'}
              </div>
              <button class="btn btn-primary btn-sm" onclick="App.switchTab('flow')" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:0" title="改造已完成, 跳转到Tab2融资流程模拟器，发起融资">🚀 前往融资流程模拟器 →</button>
              <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
            `;
          } else {
            // 未解锁: 阻塞 + 引导去 Tab0 完成改造
            const reStatus = re.status || 'idle';
            const progress = re.progress ? Math.round(re.progress * 100) : 0;
            const hint = reStatus === 'idle' ? '尚未启动改造流程' :
                         reStatus === 'completed' ? '改造已完成但融资入口未解锁(异常, 请联系系统)' :
                         `改造进行中 (${reStatus} · 进度 ${progress}%)`;
            return `
              <div style="margin:8px 0;padding:8px;background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.3);border-radius:6px">
                <div style="font-size:12px;color:#f87373;font-weight:600;margin-bottom:4px">🔒 融资入口未解锁 (改造优先铁律 · simulation-plan L15)</div>
                <div style="font-size:11px;color:var(--text-secondary)">${hint}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:3px">所有融资撮合必须以企业已完成合规化改造为前置条件, 当前企业未通过改造验收</div>
              </div>
              <button class="btn btn-warning btn-sm" onclick="App.switchTab('reform')" style="background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;border:0" title="跳转到Tab0企业改造工作台, 完成改造后解锁融资入口">🛠 去Tab0 完成改造 →</button>
              <button class="btn btn-outline btn-sm" onclick="App.switchTab('cockpit')" title="跳转到Tab7 AI驾驶舱，查看AI决策回溯和操作日志">查看AI日志 →</button>
            `;
          }
        })()}
      </div>
    `;
  },

  // === 字段级数据可见范围(多选矩阵: 银行+担保+保险独立勾选) ===
  _visibilityTarget: 'bank', // 兼容旧属性, 不再作为唯一视角
  _visibilityPreview: false,

  VISIBILITY_TARGETS: [
    { key: 'bank',      label: '银行端',   short: '银行', color: 'var(--accent-blue)',   icon: '🏦' },
    { key: 'guarantor', label: '担保公司', short: '担保', color: 'var(--accent-orange)', icon: '🛡' },
    { key: 'insurance', label: '保险公司', short: '保险', color: 'var(--accent-purple)', icon: '🛡' }
  ],

  ALL_FIELDS: [
    { key: 'enterpriseName', label: '企业名称' },
    { key: 'legalRep', label: '法人代表' },
    { key: 'registeredCapital', label: '注册资本' },
    { key: 'establishDate', label: '成立日期' },
    { key: 'transactions', label: '交易流水' },
    { key: 'counterparty_desensitized', label: '对手方名称(脱敏)' },
    { key: 'employeeCount', label: '员工人数' },
    { key: 'salaryTotal', label: '薪酬总额' },
    { key: 'accountNumber', label: '具体账户号' },
    { key: 'accountBalance', label: '账户余额' },
    { key: 'creditScore', label: '信用评分' },
    { key: 'transactionHistory', label: '交易历史' },
    { key: 'billsHeld', label: '持有票据' },
    { key: 'financials', label: '财务数据' }
  ],

  SENSITIVE_FIELDS: ['employeeCount', 'salaryTotal', 'accountNumber'],

  FIELD_VALUES: {
    enterpriseName: (ent) => ent.name,
    legalRep: (ent) => '王总',
    registeredCapital: (ent) => State.formatAmount(50000000),
    establishDate: (ent) => '2015-03-12',
    transactions: (ent) => `${ent.financials.monthlyRevenue ? '4笔本月' : '无'}`,
    counterparty_desensitized: (ent) => State.desensitize('张三有限公司'),
    employeeCount: (ent) => '156人',
    salaryTotal: (ent) => State.formatAmount(1800000),
    accountNumber: (ent) => '6228480402564890018',
    accountBalance: (ent) => State.formatAmount(ent.financials.accountBalance),
    creditScore: (ent) => ent.runtime.creditScore,
    transactionHistory: (ent) => '近12个月4笔交易',
    billsHeld: (ent) => `${ent.financials.billsHeld.length}张`,
    financials: (ent) => `月营收${State.formatAmount(ent.financials.monthlyRevenue)}`
  },

  // 渲染多选矩阵: 每个字段一行 + 3列独立checkbox(银行/担保/保险)
  renderVisibilityMatrix(ent) {
    const targets = this.VISIBILITY_TARGETS;
    return `
      <div style="display:flex;flex-direction:column;gap:2px">
        ${this.ALL_FIELDS.map((f, i) => {
          const isSensitive = this.SENSITIVE_FIELDS.includes(f.key);
          const bg = i % 2 === 0 ? 'background:transparent' : 'background:rgba(255,255,255,0.02)';
          return `
          <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:4px 10px;padding:6px 8px;border-radius:5px;align-items:center;${bg}"
               onmouseover="this.style.background='rgba(88,166,255,0.06)'"
               onmouseout="this.style.background='${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}">
            <div style="display:flex;align-items:center;gap:6px">
              <span>${f.label}</span>
              ${isSensitive ? '<span class="tag tag-orange" style="font-size:9px">🟠 敏感</span>' : ''}
            </div>
            ${targets.map(t => {
              const list = ent.dataVisibility[t.key] || [];
              const checked = list.includes(f.key);
              return `
                <div style="text-align:center">
                  <label class="toggle-switch" style="display:inline-flex;vertical-align:middle" title="${t.label}可见 ${checked ? '✓ 已开' : '✗ 未开'}">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                           onchange="ViewEnterprise.toggleVisibility('${t.key}','${f.key}', this.checked)">
                    <span class="toggle-slider" style="${checked ? `--switch-accent:${t.color}` : ''}"></span>
                  </label>
                </div>
              `;
            }).join('')}
          </div>
          `;
        }).join('')}
      </div>
      <div style="margin-top:8px;padding:6px 10px;background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.18);border-radius:5px;font-size:11px;color:var(--text-secondary);line-height:1.7">
        📝 <strong>多选说明:</strong> 同一字段可同时勾选银行+担保+保险,三类机构的可见列表独立存储互不覆盖。<br>
        示例: 「账户余额」可设置为 ✓银行(贷后监管需要) / ✗担保(仅看押品) / ✗保险(无需账户)
      </div>
    `;
  },

  // 切换单个字段+单个机构的可见性(底层存储不变,三份独立)
  toggleVisibility(target, fieldKey, checked) {
    const ent = State.currentEnterprise;
    const list = ent.dataVisibility[target] || [];
    const idx = list.indexOf(fieldKey);
    if (checked && idx === -1) list.push(fieldKey);
    else if (!checked && idx !== -1) list.splice(idx, 1);
    ent.dataVisibility[target] = list;
    const tCfg = this.VISIBILITY_TARGETS.find(t => t.key === target);
    const fCfg = this.ALL_FIELDS.find(f => f.key === fieldKey);
    State.log('enterprise',
      `[字段可见性·多选] ${tCfg ? tCfg.label : target}: ${fCfg ? fCfg.label : fieldKey} ${checked ? '✅开放' : '⛔关闭'} (银行/担保/保险互不影响)`,
      'config');
    State._notify();
  },

  switchVisibilityTarget(target) {
    this._visibilityTarget = target;
    this.render();
  },

  toggleVisibilityPreview() {
    this._visibilityPreview = !this._visibilityPreview;
    this.render();
  },

  // 三栏并排预览: 银行 | 担保 | 保险 一次看清三方可见差异
  renderAllVisibilityPreviews(ent) {
    const self = this;
    const targets = this.VISIBILITY_TARGETS;
    const renderOne = (t) => {
      const visible = ent.dataVisibility[t.key] || [];
      return `
        <div style="flex:1;min-width:0;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.18)">
          <div style="padding:7px 10px;background:linear-gradient(135deg, ${t.color}22, transparent);border-bottom:1px solid var(--border-color);
                      font-size:12px;font-weight:700;color:${t.color};display:flex;justify-content:space-between;align-items:center">
            <span>${t.icon} ${t.label}视角</span>
            <span class="tag tag-blue" style="font-size:10px">可见 ${visible.length}/${self.ALL_FIELDS.length}</span>
          </div>
          <div style="padding:8px 10px;font-size:11px">
            ${self.ALL_FIELDS.map(f => {
              const isVisible = visible.includes(f.key);
              const value = self.FIELD_VALUES[f.key] ? self.FIELD_VALUES[f.key](ent) : '-';
              const display = isVisible ? value
                : (f.key === 'counterparty_desensitized' ? State.desensitize('某某公司') : '— (未开放)');
              return `
                <div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px dashed rgba(255,255,255,0.04)">
                  <span style="color:var(--text-muted);min-width:95px;flex-shrink:0">${f.label}:</span>
                  <span style="color:${isVisible ? 'var(--text-primary)' : 'var(--text-muted)'};
                               font-weight:${isVisible ? '500' : '400'};
                               text-decoration:${isVisible ? 'none' : 'line-through'};
                               text-decoration-color:rgba(255,255,255,0.15)">
                    ${display}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
          <div style="padding:5px 10px;border-top:1px solid var(--border-color);font-size:10px;color:var(--text-muted)">
            ⚙ FPE/FF1 格式保留加密 · 未开放字段显式 "—"
          </div>
        </div>
      `;
    };
    return `
      <div style="margin-top:10px;padding:10px;background:var(--bg-tertiary);border:1px dashed var(--border-light);border-radius:6px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-secondary)">
          🔍 三方视角并排对比 (同一字段是否可见一目了然)
        </div>
        <div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap">
          ${targets.map(t => renderOne(t)).join('')}
        </div>
      </div>
    `;
  },

  // 快捷预设: 一键批量设定(兼容多选项)
  visibilityPreset(name) {
    const ent = State.currentEnterprise;
    const ALL = this.ALL_FIELDS.map(f => f.key);
    const set = (t, arr) => { ent.dataVisibility[t] = [...arr]; };
    let desc = '';

    switch (name) {
      case 'bank_core': { // 仅银行 KYC
        set('bank',      ['enterpriseName','legalRep','registeredCapital','creditScore','transactions','accountBalance','transactionHistory','financials']);
        set('guarantor', ['enterpriseName','creditScore']);
        set('insurance', ['enterpriseName']);
        desc = '银行核心 KYC(7项) · 担保/保险最小可见';
        break;
      }
      case 'guarantor_mortgage': { // 担保:押品评估需要财务+票据
        set('bank',      ['enterpriseName','legalRep','registeredCapital','establishDate','transactions','creditScore','accountBalance','transactionHistory','financials']);
        set('guarantor', ['enterpriseName','legalRep','creditScore','financials','billsHeld','registeredCapital','accountBalance']);
        set('insurance', ['enterpriseName','creditScore']);
        desc = '担保押品评估(7项) · 银行全面 · 保险最小';
        break;
      }
      case 'insurance_risk': { // 保险:保费厘定&理赔核赔
        set('bank',      ['enterpriseName','legalRep','registeredCapital','establishDate','transactions','creditScore','accountBalance','transactionHistory','financials']);
        set('guarantor', ['enterpriseName','legalRep','creditScore','financials','registeredCapital']);
        set('insurance', ['enterpriseName','creditScore','financials','billsHeld','registeredCapital']);
        desc = '保险核保核赔(5项) · 银行全面 · 担保中等';
        break;
      }
      case 'all_open': {
        ['bank','guarantor','insurance'].forEach(t => set(t, ALL));
        desc = '全量开放 (演示/压力测试专用)';
        break;
      }
      case 'minimum': { // 最小可见:仅企业名称+信用评分
        ['bank','guarantor','insurance'].forEach(t => set(t, ['enterpriseName','creditScore']));
        desc = '最小可见模式:仅名称+信用';
        break;
      }
      case 'layered':
      default: { // 分层推荐: 银行(≥12) > 担保(≥8) > 保险(≥5)
        set('bank',      ALL);
        set('guarantor', ['enterpriseName','legalRep','registeredCapital','establishDate','creditScore','financials','billsHeld','accountBalance','transactionHistory']);
        set('insurance', ['enterpriseName','creditScore','financials','billsHeld','registeredCapital']);
        desc = '分层可见·推荐:银行=14全量 / 担保=9项 / 保险=5项';
        break;
      }
    }

    State.log('enterprise', `[字段可见性·预设] 方案=${name} → ${desc}`, 'config');
    // 切换企业以触发联动(如需后续扩展联动到Tab4/Tab5/Tab6)
    State._notify();
    this.render();
  },

  toggleFlow(key) {
    State.toggleDataFlow(key);
  },

  // === 企业自定义扩展方法 ===
  INDUSTRY_LABELS: {
    manufacturing: '制造业',
    high_tech: '高新技术',
    real_estate_related: '房地产关联'
  },

  editIndustry(newIndustry) {
    const ent = State.currentEnterprise;
    const prevIndustry = ent.industryLabel;
    ent.industry = newIndustry;
    ent.industryLabel = this.INDUSTRY_LABELS[newIndustry] || newIndustry;
    // 根据当前政策版本重新判定行业政策
    const policyData = MockData.POLICY_VERSIONS.find(p => p.version === State.policyVersion);
    if (policyData) {
      ent.industryPolicy = policyData[newIndustry] || 'neutral';
    }
    State.log('enterprise', `行业变更: ${prevIndustry} → ${ent.industryLabel}`, 'config');
    State.log('enterprise', `→ 行业政策: ${State.getPolicyLabel(ent.industryPolicy)}`, 'config');
    State.recalcCreditCompleteness(ent);
    State.applyPolicyEffect(ent);
    State._notify();
  },

  editRiskProfile(newRisk) {
    const ent = State.currentEnterprise;
    const prevRisk = ent.riskLabel;
    ent.riskProfile = newRisk;
    ent.riskLabel = { premium: '优质', normal: '正常', high_risk: '高风险' }[newRisk];
    // 联动规则 4.3: 风险等级 → AI自主度建议
    const autonomyMap = { premium: 'L1', normal: 'L2', high_risk: 'L3' };
    const suggestedAutonomy = autonomyMap[newRisk];
    State.log('enterprise', `风险等级变更: ${prevRisk} → ${ent.riskLabel}`, 'config');
    State.log('enterprise', `→ AI自主度上限建议: ${suggestedAutonomy} (${newRisk === 'premium' ? 'AI可全自主' : newRisk === 'normal' ? 'AI自主+通知' : '更保守，需人工介入'})`, 'config');
    State._notify();
  },

  // 合作模式多选pill渲染: 每个角色一个可点击按钮,选中高亮(支持多选)
  // 兼容旧数据: cooperation[modeKey] 可能是 string(旧) 或 array(新), 统一用 hasCooperation 判断
  renderCooperationPills(ent, modeKey, options, accentColor) {
    const raw = ent.cooperation[modeKey];
    // 兼容旧 string: 'custody' → ['custody']; 'none'/空 → []
    const arr = Array.isArray(raw) ? raw : (raw && raw !== 'none' ? [raw] : []);
    const modeLabels = {
      enterpriseMode: '企业模式', bankMode: '银行模式',
      guarantorMode: '担保模式', insuranceMode: '保险模式'
    };
    return `
      <div class="toggle-row" style="padding:4px 0;align-items:flex-start;flex-wrap:wrap">
        <span class="toggle-label" style="min-width:70px;padding-top:3px">${modeLabels[modeKey]}</span>
        <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">
          ${options.map(o => {
            const active = arr.includes(o.v);
            return `
              <button type="button"
                      onclick="ViewEnterprise.toggleCooperation('${modeKey}','${o.v}')"
                      style="padding:3px 10px;font-size:11px;border-radius:12px;cursor:pointer;
                             border:1px solid ${active ? accentColor : 'var(--border-color)'};
                             background:${active ? accentColor : 'transparent'};
                             color:${active ? '#fff' : 'var(--text-secondary)'};
                             font-weight:${active ? '600' : '400'};
                             transition:all .15s"
                      onmouseover="if(!${active}) this.style.borderColor='${accentColor}'"
                      onmouseout="if(!${active}) this.style.borderColor='var(--border-color)'"
                      title="${active ? '✓ 已选,点击取消' : '点击选中'}">
                ${active ? '✓ ' : ''}${o.label}
              </button>
            `;
          }).join('')}
          ${arr.length === 0 ? '<span style="font-size:10px;color:var(--text-muted);padding-top:3px">(未选=无合作)</span>' : ''}
        </div>
      </div>
    `;
  },

  // 切换某个合作模式的某个角色(多选 toggle)
  toggleCooperation(modeKey, value) {
    const ent = State.currentEnterprise;
    const raw = ent.cooperation[modeKey];
    // 兼容旧 string → 转 array
    const arr = Array.isArray(raw) ? [...raw] : (raw && raw !== 'none' ? [raw] : []);
    const idx = arr.indexOf(value);
    if (idx === -1) arr.push(value);
    else arr.splice(idx, 1);
    ent.cooperation[modeKey] = arr; // 统一存为 array
    const modeLabels = {
      enterpriseMode: '企业模式', bankMode: '银行模式',
      guarantorMode: '担保模式', insuranceMode: '保险模式'
    };
    State.log('enterprise',
      `[合作模式·多选] ${modeLabels[modeKey]}: ${arr.length === 0 ? '无' : arr.join(' + ')} (可叠加多个角色)`,
      'config');
    State._notify();
  },

  // 兼容性 helper: 判断企业是否启用了某个合作角色(供其他Tab调用)
  // 用法: ViewEnterprise.hasCooperation(ent, 'bankMode', 'pre_loan')
  hasCooperation(ent, modeKey, value) {
    const raw = ent.cooperation[modeKey];
    if (Array.isArray(raw)) return raw.includes(value);
    if (typeof raw === 'string') return raw === value;
    return false;
  },

  // 兼容性 helper: 把 cooperation.*Mode (可能array/string/none/[]) 翻译成显示标签串
  // 用法: ViewEnterprise.formatCooperationLabel(ent, 'bankMode', {post_loan:'贷后',pre_loan:'贷前',consulting:'咨询',discovery:'发现',delegation:'委派',none:'无'})
  formatCooperationLabel(ent, modeKey, labelMap) {
    const raw = ent.cooperation[modeKey];
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') arr = raw === 'none' ? [] : [raw];
    if (!arr || arr.length === 0) return labelMap.none || '无';
    // 按 labelMap 顺序翻译成中文,多个用+分隔(最多展示前3个)
    const shown = arr.map(v => labelMap[v] || v).filter(Boolean);
    if (shown.length === 0) return labelMap.none || '无';
    if (shown.length <= 3) return shown.join(' + ');
    return shown.slice(0, 3).join('+') + ` 等${arr.length}项`;
  },

  editCooperation(modeKey, newValue) {
    // 兼容旧调用入口,内部转多选(单值=只选这一个,清空其他)
    const ent = State.currentEnterprise;
    ent.cooperation[modeKey] = [newValue];
    const modeLabels = {
      enterpriseMode: '企业模式', bankMode: '银行模式', guarantorMode: '担保模式', insuranceMode: '保险模式'
    };
    State.log('enterprise', `${modeLabels[modeKey]}(单选兼容): → ${newValue}`, 'config');
    State._notify();
  },

  editFinancial(field, value) {
    const ent = State.currentEnterprise;
    const numValue = parseInt(value) || 0;
    const prevValue = ent.financials[field];
    ent.financials[field] = numValue;
    const fieldLabels = {
      monthlyRevenue: '月营收', monthlyExpense: '月支出', accountBalance: '账户余额', pendingAR: '应收款'
    };
    State.log('enterprise', `财务数据变更: ${fieldLabels[field]} ${State.formatAmount(prevValue)} → ${State.formatAmount(numValue)}`, 'config');
    // 账户余额变化影响水位
    if (field === 'accountBalance') {
      ent.runtime.waterLevel = Math.min(0.95, Math.max(0.1, numValue / 5000000));
      State.log('enterprise', `→ 动态水位重算: ${ent.runtime.waterLevel.toFixed(2)}`, 'config');
    }
    State._notify();
  },

  resetEnterprise() {
    const ent = State.currentEnterprise;
    const original = MockData.ENTERPRISES.find(e => e.id === ent.id);
    if (!original) return;
    ent.industry = original.industry;
    ent.industryLabel = original.industryLabel;
    ent.industryPolicy = original.industryPolicy;
    ent.riskProfile = original.riskProfile;
    ent.riskLabel = original.riskLabel;
    ent.cooperation = JSON.parse(JSON.stringify(original.cooperation));
    ent.financials = JSON.parse(JSON.stringify(original.financials));
    ent.runtime.waterLevel = original.runtime.waterLevel;
    State.log('enterprise', `企业[${ent.name}]已重置为默认配置`, 'config');
    State.recalcCreditCompleteness(ent);
    State._notify();
  },

  toggleModule(key) {
    State.toggleModule(key);
  },

  changeAutonomy(key, value) {
    const ent = State.currentEnterprise;
    ent.modules[key] = value;
    State.log('enterprise', `${State.getModuleLabel(key)}调整为: ${value}`, 'config');
    State.log('enterprise', `→ AI自主度上限: ${value}`, 'config');
    State._notify();
  },

  changeModule(key, value) {
    const ent = State.currentEnterprise;
    ent.modules[key] = value;
    State.log('enterprise', `${State.getModuleLabel(key)}切换为: ${State.getModuleValueLabel(key, value)}`, 'config');
    State._notify();
  },

  clickNode(nodeId) {
    const ent = State.currentEnterprise;
    const node = ent.runtime.responsibilityChain.nodes.find(n => n.nodeId === nodeId);
    if (!node) return;
    if (node.status === 'pending') {
      State.confirmResponsibilityNode(nodeId);
    }
  },

  confirmAll() {
    const ent = State.currentEnterprise;
    ent.runtime.responsibilityChain.nodes.forEach(n => {
      if (n.status === 'pending') {
        State.confirmResponsibilityNode(n.nodeId);
      }
    });
  },

  simulateTimeout() {
    const ent = State.currentEnterprise;
    const pending = ent.runtime.responsibilityChain.nodes.filter(n => n.status === 'pending');
    if (pending.length > 0) {
      State.simulateResponsibilityTimeout(pending[0].nodeId);
    }
  },

  simulateNodePassiveConfirm() {
    const ent = State.currentEnterprise;
    const pending = ent.runtime.responsibilityChain.nodes.filter(n => n.status === 'pending');
    if (pending.length > 0) {
      State.simulateNodePassiveConfirm(pending[0].nodeId);
    } else {
      State.log('enterprise', '所有节点已确认，无需消极确权', 'alert');
      State._notify();
    }
  },

  // 应收款买方消极确权（spec MOD-05：买方48小时未异议视为默认确认）
  simulateBuyerPassiveConfirm() {
    const arId = 'AR_' + Date.now().toString().slice(-4);
    State.simulateBuyerPassiveConfirm(arId);
  },

  simulateAbsence() {
    const ent = State.currentEnterprise;
    const pending = ent.runtime.responsibilityChain.nodes.filter(n => n.status === 'pending');
    if (pending.length > 0) {
      State.simulateResponsibilityAbsence(pending[0].nodeId);
    } else {
      State.log('enterprise', '所有节点已确认，无缺席场景', 'alert');
      State._notify();
    }
  },

  // 季末冲量模拟
  simulateQuarterEnd() {
    const d = new Date(State.systemDate);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    
    // 计算下一个季末日期
    let targetDate;
    if (month <= 3) {
      targetDate = new Date(d.getFullYear(), 2, 28); // 3月28日
    } else if (month <= 6) {
      targetDate = new Date(d.getFullYear(), 5, 28); // 6月28日
    } else if (month <= 9) {
      targetDate = new Date(d.getFullYear(), 8, 28); // 9月28日
    } else {
      targetDate = new Date(d.getFullYear(), 11, 28); // 12月28日
    }
    
    State.systemDate = targetDate.toISOString().slice(0, 10);
    State.updateSeasonalWindow();
    State.log('enterprise', `📅 季末冲量模拟: 系统日期推进至 ${State.systemDate}`, 'policy');
    State.log('enterprise', `→ 季节性窗口: ${MockData.SEASONAL_WINDOWS[State.seasonalWindow].label}`, 'policy');
    if (State.seasonalWindow === 'quarter_end') {
      State.log('enterprise', `→ 银行端利率优惠已激活 (季末冲量窗口)`, 'policy');
    }
    State._notify();
  }
};

window.ViewEnterprise = ViewEnterprise;
