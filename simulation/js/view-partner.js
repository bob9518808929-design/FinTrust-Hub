/**
 * view-partner.js — APP-07 关联机构端门户 (Tab9)
 * spec要求: 物流公司(运单确认) / 评估机构(资产评估) / 律师事务所(法律意见) / 会计师事务所(审计报告)
 * 场景: 任务接收 → 数据接收与处理(脱敏) → 报告回传 → 物流运单确认(GPS签收证明)
 */

const ViewPartner = {
  _activeInst: 'logistics', // logistics / appraisal / law / audit
  _selectedTask: null,

  render() {
    const container = document.getElementById('view-partner');
    if (!container) return;

    const inst = this._activeInst;
    const instConfig = MockData.PARTNER_INSTITUTIONS[inst];
    const tasks = State.getPartnerTasks(inst);

    container.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🤝 关联机构协作门户 (spec APP-07)</span>
          <span style="font-size:11px;color:var(--text-muted)">AI自动委派任务 → 脱敏数据包 → 报告回传</span>
        </div>
        <!-- 机构切换 -->
        <div class="tab-nav" style="margin-bottom:12px">
          ${Object.entries(MockData.PARTNER_INSTITUTIONS).map(([key, cfg]) => `
            <button class="tab-btn ${key === inst ? 'active' : ''}" style="font-size:12px;padding:4px 10px"
              onclick="ViewPartner.switchInst('${key}')"
              title="${cfg.desc}">${cfg.icon} ${cfg.name}</button>
          `).join('')}
        </div>
        <div style="padding:8px 10px;background:rgba(88,166,255,0.06);border-radius:6px;font-size:12px;color:var(--text-secondary);margin-bottom:10px">
          ${instConfig.icon} <strong>${instConfig.name}</strong> — ${instConfig.desc}<br>
          服务能力: ${instConfig.capabilities.join(' / ')}
        </div>
        <div class="card-grid card-grid-4">
          <div class="metric">
            <span class="metric-label">待办任务</span>
            <span class="metric-value ${tasks.filter(t => t.status === 'pending').length > 0 ? 'orange' : 'green'}" style="font-size:20px">${tasks.filter(t => t.status === 'pending').length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">处理中</span>
            <span class="metric-value" style="font-size:20px;color:var(--accent-blue)">${tasks.filter(t => t.status === 'processing').length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">已完成回传</span>
            <span class="metric-value green" style="font-size:20px">${tasks.filter(t => t.status === 'completed').length}</span>
          </div>
          <div class="metric">
            <span class="metric-label">累计报酬</span>
            <span class="metric-value" style="font-size:14px">${State.formatAmount(tasks.filter(t => t.status === 'completed').reduce((s, t) => s + t.fee, 0))}</span>
          </div>
        </div>
      </div>

      <!-- 待办任务列表 -->
      <div class="card">
        <div class="card-title">
          <span>📋 待办任务 (AI自动委派)</span>
          <button class="btn btn-outline btn-sm" onclick="ViewPartner.dispatchNewTask()" title="模拟AI自动委派一个新任务给当前机构">+ 模拟AI委派任务</button>
        </div>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">spec: 机构门户展示待办任务列表: 任务类型、企业信息(脱敏)、所需数据包、截止日期、报酬</div>
        ${tasks.length === 0 ? `
          <div style="text-align:center;color:var(--text-muted);padding:20px">
            暂无待办任务<br>
            <span style="font-size:12px">点击"+ 模拟AI委派任务"生成新任务</span>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${tasks.map(t => this.renderTask(t))}
          </div>
        `}
      </div>

      <!-- 物流运单确认 (物流专属) -->
      ${inst === 'logistics' ? this.renderLogisticsPanel() : ''}

      <!-- 报告回传区 -->
      ${this._selectedTask ? this.renderReportForm() : ''}

      <!-- 跨视图快捷入口 -->
      <div style="text-align:center;padding:8px">
        <button class="btn btn-outline btn-sm" onclick="App.switchTab('enterprise')" title="跳转到Tab1企业端工作台">返回企业端 →</button>
      </div>
    `;
  },

  renderTask(task) {
    const statusMap = {
      pending: { label: '待处理', color: 'orange', icon: '⏳' },
      processing: { label: '处理中', color: 'blue', icon: '🔄' },
      completed: { label: '已完成', color: 'green', icon: '✅' }
    };
    const st = statusMap[task.status];
    return `
      <div style="padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border-light);border-radius:8px;${this._selectedTask === task.id ? 'border-color:var(--accent-blue)' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
              <span style="font-size:14px">${st.icon}</span>
              <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${task.title}</span>
              <span class="tag tag-${st.color}">${st.label}</span>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">${task.desc}</div>
            <div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
              <span>企业: ${task.desensitizedEnt}</span>
              <span>截止: ${task.deadline}</span>
              <span>报酬: ${State.formatAmount(task.fee)}</span>
              <span>数据包: ${task.dataPackage}项</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${task.status === 'pending' ? `
              <button class="btn btn-primary btn-sm" onclick="ViewPartner.acceptTask('${task.id}')" title="接受任务 → 系统推送脱敏数据包 → 门户内查看处理">接受</button>
            ` : ''}
            ${task.status === 'processing' ? `
              <button class="btn btn-success btn-sm" onclick="ViewPartner.selectTask('${task.id}')" title="选中此任务 → 在下方填写并回传结构化报告">回传报告</button>
            ` : ''}
            ${task.status === 'completed' ? `
              <span style="font-size:11px;color:var(--accent-green)">报告已回传 ✓</span>
            ` : ''}
          </div>
        </div>
        ${task.status === 'processing' || task.status === 'completed' ? `
          <div style="margin-top:8px;padding:8px;background:rgba(88,166,255,0.05);border-radius:4px;font-size:11px;color:var(--text-secondary)">
            📦 脱敏数据包(门户内查看，不可下载): ${task.dataItems.map(d => `<code style="margin-right:4px">${d}</code>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  renderLogisticsPanel() {
    return `
      <div class="card">
        <div class="card-title">🚚 物流运单确认 (spec: 关联IoT GPS轨迹生成签收证明)</div>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">spec: 物流公司在门户确认运单信息(起运地、目的地、货物信息)，系统关联IoT GPS轨迹生成签收证明</div>
        <div class="card-grid card-grid-2">
          <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">运单信息</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:2">
              <div>运单号: <code>WL-2026-${Date.now().toString().slice(-6)}</code></div>
              <div>起运地: 深圳市宝安区工业园</div>
              <div>目的地: 东莞市松山湖仓库</div>
              <div>货物: 电子元器件 ×500箱</div>
              <div>承运: 顺达物流</div>
            </div>
          </div>
          <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">IoT GPS轨迹</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:2">
              <div>📍 起点: 22.5431°N, 113.9136°E (深圳宝安)</div>
              <div>📍 中转: 22.6589°N, 114.0571°E (途经)</div>
              <div>📍 终点: 22.9347°N, 113.8921°E (东莞松山湖)</div>
              <div>🛣️ 里程: 68.5km | ⏱ 用时: 1h42min</div>
              <div>🌡️ 温控: 正常 (15-25°C)</div>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;text-align:center">
          <button class="btn btn-success btn-sm" onclick="ViewPartner.confirmWaybill()" title="确认运单 → 关联GPS轨迹 → 生成签收证明 → 关联责任链节点N09">✅ 确认运单并生成签收证明</button>
        </div>
      </div>
    `;
  },

  renderReportForm() {
    const task = State.getPartnerTasks(this._activeInst).find(t => t.id === this._selectedTask);
    if (!task || task.status !== 'processing') return '';
    const inst = this._activeInst;
    const reportTypes = {
      logistics: '签收证明',
      appraisal: '资产评估报告',
      law: '法律意见书',
      audit: '审计报告'
    };
    return `
      <div class="card">
        <div class="card-title">
          <span>📤 报告回传 — ${reportTypes[inst]}</span>
          <span style="font-size:11px;color:var(--text-muted)">spec: 机构回传结构化报告 → 系统自动整合到业务流程</span>
        </div>
        <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:6px;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text-secondary)">目标任务: <strong>${task.title}</strong></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">企业: ${task.desensitizedEnt} | 报酬: ${State.formatAmount(task.fee)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="font-size:12px;color:var(--text-secondary)">${reportTypes[inst]}结论</label>
            <select id="report-conclusion" class="input-field" style="width:100%;margin-top:4px">
              ${inst === 'appraisal' ? `
                <option value="通过">资产评估值充足，覆盖融资金额</option>
                <option value="部分通过">资产评估值部分覆盖，建议追加担保</option>
                <option value="不通过">资产评估值不足，不建议融资</option>
              ` : inst === 'law' ? `
                <option value="无风险">法律审查通过，无重大法律风险</option>
                <option value="关注">存在轻微法律瑕疵，建议补充材料</option>
                <option value="高风险">存在重大法律风险，建议拒绝</option>
              ` : inst === 'audit' ? `
                <option value="标准无保留">财务报表公允反映，审计通过</option>
                <option value="保留意见">存在局部问题，出具保留意见</option>
                <option value="无法表示">无法获取充分审计证据</option>
              ` : `
                <option value="已签收">货物已签收，GPS轨迹吻合</option>
                <option value="异常">签收异常，货物信息不一致</option>
              `}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-secondary)">详细说明</label>
            <textarea id="report-detail" class="input-field" style="width:100%;margin-top:4px;min-height:60px;font-size:12px" placeholder="输入${reportTypes[inst]}的详细内容..."></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-success btn-sm" onclick="ViewPartner.submitReport()" title="回传报告 → 系统整合到业务流程 → 任务完成 → 累计报酬">📤 回传报告</button>
            <button class="btn btn-outline btn-sm" onclick="ViewPartner._selectedTask=null;ViewPartner.render()">取消</button>
          </div>
        </div>
      </div>
    `;
  },

  switchInst(key) {
    this._activeInst = key;
    this._selectedTask = null;
    this.render();
  },

  dispatchNewTask() {
    State.dispatchPartnerTask(this._activeInst);
    this.render();
  },

  acceptTask(taskId) {
    State.acceptPartnerTask(taskId);
    this.render();
  },

  selectTask(taskId) {
    this._selectedTask = taskId;
    this.render();
  },

  submitReport() {
    const conclusion = document.getElementById('report-conclusion').value;
    const detail = document.getElementById('report-detail').value;
    State.submitPartnerReport(this._selectedTask, conclusion, detail);
    this._selectedTask = null;
    this.render();
  },

  confirmWaybill() {
    State.confirmWaybill();
    this.render();
  }
};

window.ViewPartner = ViewPartner;
