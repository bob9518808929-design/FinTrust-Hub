/* ============================================================
 * FinTrust Hub v5.0
 * view-reform.js — Tab0 企业改造工作台
 * simulation-plan.md v5.0 对齐 · 六大功能分区 + 流水线主按钮
 *
 * 分区布局:
 *   ┌─────────────┬────────────────────────────────────────┐
 *   │ 操作指引栏  (全局折叠/展开)                            │
 *   ├─────────────┼───────────────┬────────────────────────┤
 *   │ A1 8维评分卡 │ A2 参数控制台  │    激进程度 Pill +       │
 *   │ · 雷达/条形图 │ · 目标等级下拉  │    自主度(L2/L3/L4)    │
 *   │ · 当前/目标/ │ · R1-R10状态墙 │    R1-R10 执行状态快照 │
 *   │   改造前对比 │                 │                        │
 *   ├─────────────┼───────────────┴────────────────────────┤
 *   │ A3 差距诊断与方案集     │ A4 任务调度 DAG + 进度监控   │
 *   │ · R2 差距详情(关键缺口) │ · 任务卡片(关键路径高亮)     │
 *   │ · 违规识别(红/灰/绿)    │ · 阶段分组 P1~P4            │
 *   │ · 3路径方案卡对比       │ · 进度条 + 完成动作 timeline│
 *   ├─────────────┼────────────────────────────────────────┤
 *   │ A5 银行匹配 R9 │ A6 执行引擎家族 R5 + 合规审查 R7      │
 *   │ · 匹配银行Top3 │ · 8类执行器状态卡 (R5-A~R5-H)         │
 *   │ · 获批概率/额度│ · 合规评分 + 红线/灰区/绿区明细        │
 *   │ · 案例推荐 R10│ · 自主度边界提示(L2 文档生成→L4)       │
 *   └─────────────┴────────────────────────────────────────┘
 *   [AI诊断 R1+R2] [生成方案 R3] [选定路径 R4 调度] [执行 R5] [银行匹配 R9] [案例检索 R10]
 * ============================================================ */
'use strict';

const ViewReform = {

  // ===== 主入口 =====
  render() {
    const container = document.getElementById('view-reform');
    if (!container) return;
    const ent = State.currentEnterprise;
    const re  = State.reformEngine;
    const dims = MockData.REFORM_DIMENSIONS || this._fallbackDims();

    container.innerHTML = `
      <!-- 操作指引: 已迁移至全局 GuideManager (app.js guides.reform), 点击右下角悬浮按钮查看 -->

      <div class="card-grid card-grid-2">
        ${this._renderA1_Scorecard(ent, re, dims)}
        ${this._renderA2_ParamConsole(ent, re, dims)}
      </div>

      <div class="card-grid card-grid-2">
        ${this._renderA3_GapAndPlans(ent, re)}
        ${this._renderA4_TaskSchedule(ent, re)}
      </div>

      <div class="card-grid card-grid-2">
        ${this._renderA5_BankAndCases(ent, re)}
        ${this._renderA6_ExecutorsAndLegal(ent, re)}
      </div>

      <!-- 流水线 6 大主按钮 + 场景D 失败重规划 -->
      <div class="card" style="margin-top:16px">
        <div class="card-title">
          <span>🔧 改造流水线</span>
          <span style="font-size:12px;color:var(--text-muted);font-weight:400">
            状态:
            <span class="tag tag-${re.status==='completed'?'green':re.status==='executing'?'blue':re.status==='diagnosing'||re.status==='planning'?'orange':'gray'}">
              ${re.status==='completed'?'✅ 改造完成':re.status==='executing'?'⚙ 执行中':re.status==='diagnosing'?'🔍 诊断中':re.status==='planning'?'📝 方案制定中':'⏳ 待启动'}
            </span>
          </span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="ViewReform.pipelineStepDiagnose()" ${re.status==='executing'?'disabled':''}>
            🔍 ① AI差距诊断 (R1+R2)
          </button>
          <button class="btn" onclick="ViewReform.pipelineStepGeneratePlans()" ${!re.gapReport||re.status==='executing'?'disabled':''}>
            🧭 ② 生成3条方案 (R3)
          </button>
          <button class="btn" onclick="ViewReform.pipelineStepSchedule()" ${re.reformPlans.length===0||re.status==='executing'?'disabled':''}>
            🗂 ③ 选定路径·调度 (R4)
          </button>
          <button class="btn btn-green" onclick="ViewReform.pipelineStepExecute()" ${re.taskDAG.length===0||re.status==='executing'||re.status==='completed'?'disabled':''}>
            ⚡ ④ 一键执行改造 (R5+R6+R7)
          </button>
          <button class="btn" onclick="ViewReform.pipelineStepBankMatch()" ${re.status!=='completed'&&re.completedTasks<1?'disabled':''}>
            🏦 ⑤ 银行匹配 (R9)
          </button>
          <button class="btn" onclick="ViewReform.pipelineStepCases()">
            📚 ⑥ 案例检索 (R10)
          </button>
        </div>
        <!-- spec 二补.7 改造场景 A/B/C 快捷加载 + D失败重排 + E完成改造 (v=36 补齐) -->
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-color)">
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">
            <b>🧪 改造场景模拟器</b> <span style="color:var(--text-muted)">(spec 二补.7 场景A~E · 一键加载5类改造演示)</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-green" onclick="ViewReform.simulateScenarioA_conservative()" style="background:linear-gradient(135deg,#059669,#10b981)">
              🟢 场景A: 保守版 (仅绿区·快速体验)
            </button>
            <button class="btn btn-primary" onclick="ViewReform.simulateScenarioB_balanced()">
              🔵 场景B: 平衡版 (含灰区·触发法务审核)
            </button>
            <button class="btn" onclick="ViewReform.simulateScenarioC_innovative()" style="background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;border:0">
              🟠 场景C: 创新版 (含资本运作·最大收益)
            </button>
            <button class="btn btn-danger" onclick="ViewReform.simulateScenarioD_failureAndReplan()" ${re.taskDAG.length===0||re.status==='executing'||re.status==='completed'?'disabled':''}>
              🧨 场景D: 任务失败 → R6 重排
            </button>
            <button class="btn" onclick="ViewReform.simulateScenarioE_complete()" style="background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;border:0">
              ✅ 场景E: 一键完成改造 (R2复检达标·解锁Tab1)
            </button>
            <button class="btn btn-warning" onclick="ViewReform.simulateResetAll()" ${re.status==='idle'&&!re.gapReport?'disabled':''}>
              ♻ 重置 → 回到起点
            </button>
          </div>
          <!-- spec L307-329 FP-07: 改造流程暂停/恢复/放弃状态机 -->
          <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color)">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">⚙️ 流程状态机 (spec L307-329 · 断点保存/恢复/放弃)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="ViewReform.pauseReform()" ${re.status!=='executing'?'disabled':''} title="暂停改造流程, 执行中任务标记为 paused, 保留断点">
                ⏸ 暂停改造
              </button>
              <button class="btn btn-outline btn-sm" onclick="ViewReform.resumeReform()" ${re.status!=='paused'?'disabled':''} title="从断点恢复改造流程">
                ▶ 恢复改造
              </button>
              <button class="btn btn-danger btn-sm" onclick="ViewReform.abandonReform()" ${re.status==='idle'||re.status==='completed'||re.status==='abandoned'?'disabled':''} title="放弃改造, 未完成任务标记 cancelled, 已完成产物保留, 失败案例入库 R10">
                🛑 放弃改造 (二次确认)
              </button>
              <span style="font-size:11px;color:var(--text-secondary);align-self:center;margin-left:auto">
                当前状态: <b style="color:${re.status==='executing'?'#10b981':re.status==='paused'?'#f59e0b':re.status==='abandoned'?'#f87373':'var(--text-muted)'}">${re.status||'idle'}</b>
                ${re.pausedAt?` · 暂停于 ${new Date(re.pausedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:''}
                ${re.abandonedAt?` · 放弃于 ${new Date(re.abandonedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:''}
              </span>
            </div>
          </div>
          <!-- FP-05/06/10: R10 模型再训练 + 知识图谱更新 + H1-H7 假设验证 -->
          <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color)">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">🔬 高级工具 (spec L1059-1081 · L1273-1286 · 模型自进化 + 假设验证)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="ViewReform.triggerR10Retraining()" title="检查案例库是否达 50 阈值 → 触发模型再训练">
                🧠 R10 模型再训练
              </button>
              <button class="btn btn-outline btn-sm" onclick="ViewReform.updateKnowledgeGraph()" title="从最新案例提取实体/关系 → 更新知识图谱">
                📊 更新知识图谱
              </button>
              <button class="btn btn-outline btn-sm" onclick="ViewReform.validateHypotheses()" style="background:linear-gradient(135deg,#7c3aed20,#a78bfa20);border-color:#a78bfa" title="运行 7 个关键假设 H1-H7 自动验证">
                🔬 H1-H7 假设验证
              </button>
              <button class="btn btn-outline btn-sm" onclick="ViewReform.runMonthlyReview()" title="手动触发 R6 月度重规划评估">
                📅 月度重规划
              </button>
              <button class="btn btn-outline btn-sm" onclick="ViewReform.runR2Recheck()" title="手动触发 R2 改造完成复检 (12 项指标重新评分)">
                🔍 R2 复检
              </button>
            </div>
          </div>
        </div>
        ${re.status==='completed' ? `
          <div style="margin-top:12px;padding:10px 14px;background:rgba(16,185,129,0.1);border:1px solid #10b981;border-radius:6px;font-size:13px">
            🎉 恭喜! ${ent.name} 改造完成 · 当前等级 <strong>${re.currentLevel}</strong> · 累计完成 ${re.completedTasks} 个改造动作 · 请先前往 Tab1 配置合作模式/数据可见性, 之后再前往 Tab2 发起融资申请
            <button class="btn btn-sm btn-primary" style="margin-left:12px" onclick="App.switchTab('enterprise')">→ 去Tab1配置并查看融资能力</button>
          </div>` : ''}
      </div>
    `;
  },

  // ===== A1: 8维评分卡 =====
  _renderA1_Scorecard(ent, re, dims) {
    const cur = re.scorecard.current;
    const tgt = re.scorecard.target;
    const bef = re.scorecard.before || cur;
    const beforeLevel = bef ? State ? State._computeReformLevel ? State._computeReformLevel(bef) : 'D' : 'D' : 'D';
    return `
    <div class="card">
      <div class="card-title">
        <span>A1 · 8 维改造评分卡</span>
        <span class="tag tag-blue">8D Reform Map</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <span style="font-size:12px;color:var(--text-muted)">改造前 <b class="red">${beforeLevel}</b></span>
          <span>→</span>
          <span style="font-size:12px">当前 <b class="${re.currentLevel===re.targetLevel||['A+','A','A-','B+'].includes(re.currentLevel)?'green':re.currentLevel==='B'||re.currentLevel==='B-'?'orange':'red'}">${re.currentLevel}</b></span>
          <span>→</span>
          <span style="font-size:12px">目标 <b class="green">${re.targetLevel}</b></span>
        </span>
      </div>
      ${this._renderProgressBar(re.progress, re.totalTasks, re.completedTasks)}
      <div style="display:grid;gap:8px;margin-top:8px">
        ${Object.entries(dims).map(([k, cfg]) => {
          const c = cur[k] || 0, t = tgt[k] || 85, b = bef[k] || c;
          const pct = Math.round(c/t*100);
          const need = Math.max(0, t-c);
          const color = c>=t ? 'green' : need>20 ? 'red' : 'orange';
          return `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
              <span title="${cfg.description||''}"><b>${cfg.icon||'📊'}</b> ${cfg.label || cfg.name || k}
                <span style="color:var(--text-muted)">(权重 ${Math.round((cfg.weight||0.125)*100)}%)</span>
              </span>
              <span>
                <span style="color:var(--text-muted);font-size:11px">改造前${b} → </span>
                <b class="${color}">${c}</b>
                <span style="color:var(--text-muted)"> / 目标${t}</span>
                ${need>0 ? `<span class="tag tag-xs tag-${color}" style="margin-left:4px">缺口${need}</span>` : '<span class="tag tag-xs tag-green" style="margin-left:4px">达标</span>'}
              </span>
            </div>
            <div style="position:relative;height:16px;background:var(--bg-hover);border-radius:4px;overflow:hidden">
              <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.round(b/t*100)}%;background:var(--border-color);z-index:0"></div>
              <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100,pct)}%;background:${color==='green'?'#10b981':color==='orange'?'#f59e0b':'#ef4444'};z-index:1;transition:width .3s"></div>
              <div style="position:absolute;top:0;bottom:0;width:2px;background:#334155;z-index:2;left:${Math.round(100*Math.min(1, b/t))}%;box-shadow:0 0 4px rgba(0,0,0,.3)"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px;display:flex;gap:14px;font-size:12px;color:var(--text-muted)">
        <span>灰底:改造前 · 彩条:当前 · 灰竖线:基线</span>
        ${ent.reform && ent.reform.hasReformed ? '<span class="tag tag-green tag-sm">★ 改造标杆企业 · 已完成 '+ent.reform.completedActions.length+' 动作</span>' : ''}
      </div>
      <!-- spec 二补.1 新兴维度 (v5.0 预留): 🌐 跨境 · 📊 数据资产 · 🌱 ESG -->
      <div style="margin-top:10px;padding:8px 10px;border:1px dashed var(--border-color);border-radius:5px;background:rgba(139,92,246,0.06)">
        <div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:5px">🔮 新兴维度预留 (v5.0 roadmap · simulation-plan 二补.1 末行)</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          <div style="padding:5px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;opacity:0.75" title="跨境人民币结算、跨国供应链穿透、海关AEO认证、离岸业务合规">
            🌐 <b>跨境</b> · 待接入
          </div>
          <div style="padding:5px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;opacity:0.75" title="数据资产入表评估、知识产权证券化、数据要素质押融资、数据合规审计">
            📊 <b>数据资产</b> · 待接入
          </div>
          <div style="padding:5px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;opacity:0.75" title="ESG评级、双碳路径规划、绿色贴息匹配、社会责任信息披露">
            🌱 <b>ESG</b> · 待接入
          </div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">以上三维度为 8 维改造地图的前瞻性扩展，对应监管与资本市场趋势；当前改造流程中自动跳过，后续版本可独立激活并参与 R2 差距评分和 R3 方案约束求解</div>
      </div>
    </div>`;
  },
  _renderProgressBar(progress, total, done) {
    const pct = Math.round(progress*100);
    return `
      <div style="margin:6px 0 4px 0">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span><b>改造总进度</b></span>
          <span>${done}/${total} 任务 · ${pct}%</span>
        </div>
        <div style="position:relative;height:12px;background:var(--bg-hover);border-radius:6px;overflow:hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:linear-gradient(90deg,#10b981,#059669);transition:width .3s"></div>
        </div>
      </div>`;
  },

  // ===== A2: 参数控制台 + R1-R10 状态墙 =====
  _renderA2_ParamConsole(ent, re, dims) {
    const aggOptions = MockData.AGGRESSIVENESS_LEVELS || {};
    const autoOptions = MockData.REFORM_AUTONOMY_LEVELS || {};
    const engines = MockData.REFORM_ENGINES || this._fallbackEngines();
    return `
    <div class="card">
      <div class="card-title">
        <span>A2 · 参数控制 + R1-R10 引擎状态墙</span>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">改造激进程度 (联动 R7 合规边界 + R3 方案空间)</div>
        <div style="display:flex;gap:6px">
          ${Object.entries(aggOptions).map(([id,cfg]) => `
            <button class="pill-btn ${re.aggressiveness===id?'pill-btn-active':'pill-btn-'+(id==='conservative'?'green':id==='balanced'?'blue':'orange')}"
              onclick="State.setReformAggressiveness('${id}')" style="flex:1">
              <div style="font-size:15px">${cfg.icon} ${cfg.name}</div>
              <div style="font-size:10px;color:var(--text-muted)">${cfg.bounds}</div>
            </button>`).join('')}
        </div>
      </div>
      <div class="divider"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">自主度等级 (联动 R5 执行边界)</div>
          <select class="input-field" onchange="State.setReformAutonomyLevel(this.value)">
            ${Object.entries(autoOptions).map(([id,cfg]) => `
              <option value="${id}" ${re.autonomyLevel===id?'selected':''}>${id} · ${cfg.name} (${cfg.bounds})</option>
            `).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">目标银行准入等级</div>
          <select class="input-field" onchange="State.setReformTargetLevel(this.value)">
            ${['D','C','C+','B-','B','B+','A-','A','A+'].map(l => `
              <option value="${l}" ${re.targetLevel===l?'selected':''}>${l} 级</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="divider"></div>
      <!-- R1-R10 引擎状态墙 -->
      <div>
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">R1-R10 改造引擎状态墙</div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">
          ${Object.entries(engines).map(([rId,cfg]) => {
            const st = re.engineStatus[rId] || {status:'idle'};
            const badgeMap = { idle:'gray', completed:'green', running:'blue', refreshed:'blue', boundary_updated:'blue', planning:'orange', diagnosing:'orange', failed:'red', retry_scheduled:'orange', manual_intervention_required:'red', blocked:'red' };
            const statusText = { idle:'待命', completed:'已完成', running:'运行中', refreshed:'已刷新', boundary_updated:'边界更新', planning:'规划中', diagnosing:'诊断中', failed:'失败', retry_scheduled:'重排中', manual_intervention_required:'人工介入', blocked:'合规阻断' };
            const badge = badgeMap[st.status] || 'gray';
            return `
              <div class="engine-pill" title="${cfg.name}\n${cfg.scope}\n状态: ${st.lastRunAt?statusText[st.status]+' @ '+st.lastRunAt.slice(0,16):statusText[st.status]}">
                <div style="font-weight:700;font-size:14px">${rId}</div>
                <div style="font-size:10px;color:var(--text-secondary);line-height:1.2">${cfg.name.split(' ')[0]}</div>
                <span class="tag tag-xs tag-${badge}">${statusText[st.status]||st.status}</span>
              </div>`;
          }).join('')}
        </div>
      </div>
      <div class="divider"></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px">
        <div style="padding:8px;background:var(--bg-tertiary);border-radius:5px;text-align:center">
          <div style="color:var(--text-muted)">预估投入 (R3+激进乘数)</div>
          <div style="font-size:16px;font-weight:700;color:#0ea5e9;margin-top:2px">${State.formatAmount ? State.formatAmount(re.estimation.totalCost||0) : '¥'+(re.estimation.totalCost||0)}</div>
        </div>
        <div style="padding:8px;background:var(--bg-tertiary);border-radius:5px;text-align:center">
          <div style="color:var(--text-muted)">预估周期</div>
          <div style="font-size:16px;font-weight:700;color:#f59e0b;margin-top:2px">${re.estimation.totalDays||0} 天</div>
        </div>
        <div style="padding:8px;background:var(--bg-tertiary);border-radius:5px;text-align:center">
          <div style="color:var(--text-muted)">预计信用增益</div>
          <div style="font-size:16px;font-weight:700;color:#10b981;margin-top:2px">+${re.estimation.creditGain||0} 分</div>
        </div>
      </div>
    </div>`;
  },
  _fallbackEngines(){
    return {R1:{name:'R1 全景画像',scope:'数据采集+8维评分'},R2:{name:'R2 差距诊断',scope:'缺口分析+违规识别'},R3:{name:'R3 方案生成',scope:'3路径'},R4:{name:'R4 任务调度',scope:'DAG编排'},R5:{name:'R5 执行家族',scope:'5类执行器'},R6:{name:'R6 动态重规划',scope:'异常+重试'},R7:{name:'R7 合规审查',scope:'红/灰/绿'},R8:{name:'R8 进度监控',scope:'看板预警'},R9:{name:'R9 银行匹配',scope:'BIDS匹配'},R10:{name:'R10案例学习',scope:'KNN相似案例'}};
  },
  _fallbackDims(){
    return {subject:{label:'主体资质',weight:0.14,icon:'🏢',description:'法人/股权穿透/董监高'},finance:{label:'财务规范',weight:0.15,icon:'📊',description:'账套规范/财报/关联合规'},tax:{label:'税务合规',weight:0.14,icon:'🧾',description:'申报/补缴/发票/纳税评级'},business:{label:'业务真实性',weight:0.12,icon:'📦',description:'合同/物流/销售台账'},assets:{label:'资产确权',weight:0.10,icon:'🏗',description:'固定资产/存货/知识产权'},credit:{label:'信用维度',weight:0.15,icon:'💳',description:'逾期修复/增信/并表'},policy:{label:'政策红利',weight:0.08,icon:'🎖',description:'高新/专精特新/招商'},capital:{label:'资金管理',weight:0.12,icon:'💰',description:'实缴/保证金/质押'}};
  },

  // ===== A3: 差距诊断与方案集 =====
  _renderA3_GapAndPlans(ent, re) {
    const gap = re.gapReport;
    const plans = re.reformPlans;
    return `
    <div class="card" style="min-height:420px">
      <div class="card-title">
        <span>A3 · 差距诊断 (R2) + 方案集 (R3)</span>
        ${gap ? `<span class="tag tag-green tag-sm">已诊断</span>` : `<span class="tag tag-gray tag-sm">未诊断</span>`}
      </div>
      ${!gap ? `
        <div style="padding:30px 12px;text-align:center;color:var(--text-muted)">
          <div style="font-size:36px;margin-bottom:10px">🔍</div>
          点击下方 <b>「① AI差距诊断」</b> 启动 R1 全景画像 + R2 差距诊断<br>
          系统会自动识别: 8维缺口 / 两本账 / 税务滞纳 / 业务真实性 / 法人代持 等问题
        </div>` : `
        <!-- 差距概览 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
          <div style="background:${gap.criticalGaps>0?'rgba(239,68,68,0.1)':'var(--bg-tertiary)'};padding:6px;border-radius:5px;text-align:center">
            <div class="${gap.criticalGaps>0?'red':'green'}" style="font-size:18px;font-weight:700">${gap.criticalGaps}</div>
            <div style="font-size:11px;color:var(--text-muted)">严重缺口</div>
          </div>
          <div style="background:${gap.highGaps>0?'rgba(245,158,11,0.1)':'var(--bg-tertiary)'};padding:6px;border-radius:5px;text-align:center">
            <div class="${gap.highGaps>0?'orange':'green'}" style="font-size:18px;font-weight:700">${gap.highGaps}</div>
            <div style="font-size:11px;color:var(--text-muted)">较大缺口</div>
          </div>
          <div style="background:${gap.violations.length>0?'rgba(239,68,68,0.1)':'var(--bg-tertiary)'};padding:6px;border-radius:5px;text-align:center">
            <div class="${gap.violations.length>0?'red':'green'}" style="font-size:18px;font-weight:700">${gap.violations.length}</div>
            <div style="font-size:11px;color:var(--text-muted)">合规风险</div>
          </div>
          <div style="background:var(--bg-tertiary);padding:6px;border-radius:5px;text-align:center">
            <div style="font-size:18px;font-weight:700;color:#0ea5e9">${gap.estimatedBaseDays}</div>
            <div style="font-size:11px;color:var(--text-muted)">基准修复天数</div>
          </div>
        </div>
        <!-- 缺口列表 -->
        <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">维度缺口明细:</div>
        <div style="max-height:140px;overflow:auto;padding-right:4px">
          ${gap.gaps.map(g => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-bottom:1px dashed var(--border-color)">
              <span class="tag tag-xs tag-${g.urgency==='critical'?'red':g.urgency==='high'?'orange':'blue'}">${g.urgency==='critical'?'严重':g.urgency==='high'?'较大':'一般'}</span>
              <b style="min-width:70px">${g.dimLabel}</b>
              <span style="color:var(--text-muted);font-size:12px">${g.current}→${g.target} (缺${g.gap}分)</span>
              <span style="margin-left:auto;font-size:12px;color:#0369a1">💡 ${g.suggestion}</span>
            </div>`).join('')}
          ${gap.violations.map(v => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-bottom:1px dashed var(--border-color);background:${v.level==='red'?'rgba(248,81,73,0.12)':'rgba(245,158,11,0.1)'}">
              <span class="tag tag-xs tag-${v.level==='red'?'red':'orange'}">${v.level==='red'?'⚠ 红线':'△ 灰区'}</span>
              <b style="min-width:90px">合规 [${v.id}] ${v.label}</b>
              <span style="font-size:12px;color:var(--text-secondary);flex:1">${v.detail}</span>
            </div>`).join('')}
        </div>
        <!-- 3 路径方案卡 -->
        <div style="margin-top:10px">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">3 条改造路径方案 (点击选中,然后去步骤③调度):</div>
          ${plans.length === 0 ? `
            <div style="padding:14px;text-align:center;color:var(--text-muted);background:var(--bg-tertiary);border-radius:5px">
              诊断已完成, 请点击下方「② 生成3条方案」生成路径方案
            </div>` : `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              ${plans.map(p => {
                const sel = p.id === re.selectedPlanId;
                const cls = p.pathLevel==='conservative'?'green':p.pathLevel==='balanced'?'blue':'orange';
                return `
                <div class="plan-card ${sel?'plan-card-selected':'plan-card-'+cls}"
                  style="cursor:pointer"
                  onclick="ViewReform.selectPlan('${p.id}')">
                  <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
                    <span style="font-size:18px">${p.icon}</span>
                    <b>${p.pathName}</b>
                    ${p.recommended?'<span class="tag tag-xs tag-blue">推荐</span>':''}
                    ${sel?'<span class="tag tag-xs tag-green" style="margin-left:auto">已选</span>':''}
                  </div>
                  <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;line-height:1.4">${p.description}</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;margin-bottom:4px">
                    <div>🗓 ${p.timelineDays}天</div>
                    <div>💰 ${State.formatAmount ? State.formatAmount(p.totalCost) : p.totalCost}</div>
                    <div>✅ ${p.totalActions}动作</div>
                    <div>⭐ +${p.totalCreditGain}信用分</div>
                  </div>
                  <div style="font-size:10px;color:var(--text-muted);border-top:1px dashed var(--border-color);padding-top:4px">
                    合规: <span class="${p.complianceRisk==='low'?'green':p.complianceRisk==='medium'?'orange':'red'}">${p.complianceRisk==='low'?'低':p.complianceRisk==='medium'?'中':'高'}</span>
                    · 关键路径: ${p.criticalPath.join(' → ')} (${p.timelineDays}天)
                  </div>
                </div>`;
              }).join('')}
            </div>`}
        </div>`}
    </div>`;
  },

  // ===== A4: 任务 DAG + 进度监控 =====
  _renderA4_TaskSchedule(ent, re) {
    const tasks = re.taskDAG || [];
    const actions = re.completedActions || [];
    return `
    <div class="card" style="min-height:420px">
      <div class="card-title">
        <span>A4 · 任务调度 DAG (R4) + 进度监控 (R8)</span>
        ${tasks.length>0 ? `<span class="tag tag-blue tag-sm">${tasks.length} 任务</span>` : `<span class="tag tag-gray tag-sm">未调度</span>`}
      </div>
      ${tasks.length===0 ? `
        <div style="padding:30px 12px;text-align:center;color:var(--text-muted)">
          <div style="font-size:36px;margin-bottom:10px">🗂</div>
          请先完成 ①诊断 → ②生成方案 → ③选定路径并调度<br>
          R4 将自动生成 DAG 任务图, 按 4 阶段串联:
          <b style="color:#0369a1">P1 主体合规 → P2 财务税务 → P3 业务资产 → P4 增信资金</b>
        </div>` : `
        <!-- 四阶段进度 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
          ${['P1 主体合规','P2 财务税务','P3 业务资产','P4 增信资金'].map((pname,i) => {
            const id = 'P'+(i+1);
            const pts = tasks.filter(t => t.phase===id);
            const done = pts.filter(t => t.status==='done').length;
            const pct = pts.length ? Math.round(done/pts.length*100) : 0;
            return `
              <div style="padding:6px;background:var(--bg-tertiary);border-radius:5px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <b>${pname}</b><span>${done}/${pts.length}</span>
                </div>
                <div style="height:6px;background:var(--border-color);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${pct>=100?'#10b981':'#0ea5e9'}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
        <!-- 任务卡片网格 -->
        <div style="max-height:220px;overflow:auto;padding-right:4px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
            ${tasks.map(t => {
              const statusMap = { pending:'⏸ 待办', done:'✅ 完成', failed:'❌ 失败', blocked:'🛑 合规阻断', pending_approval:'🟡 待审批' };
              const colorMap  = { pending:'gray', done:'green', failed:'red', blocked:'red', pending_approval:'orange' };
              return `
              <div class="task-card task-${t.status||'pending'} ${t.isCritical?'task-critical':''}"
                title="${t.detail}\n执行器: ${t.executor}\n${t.requiresLegal?'⚠ 需法务签章':''}\n关键路径: ${t.isCritical?'是':'否'}">
                <div style="display:flex;align-items:center;gap:4px;font-size:12px">
                  <b style="font-family:monospace">${t.id}</b>
                  ${t.isCritical ? '<span style="color:#ef4444">★</span>' : ''}
                  <span class="tag tag-xs tag-${colorMap[t.status||'pending']}" style="margin-left:auto">${statusMap[t.status||'pending']}</span>
                </div>
                <div style="font-size:12px;margin:3px 0;line-height:1.3">${t.label}</div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted)">
                  <span>${t.executor} · ${t.phaseName}</span>
                  <span>⏱ ${t.hours}h · +${t.creditGain}分</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <!-- spec 二补.6 关键路径文字展示 (对齐 DAG 示例 T1→T2→T5→T7→T8→T9→T10 格式) -->
        ${tasks.length>0 ? (() => {
          const critical = tasks.filter(t => t.isCritical).sort((a,b) => (a.seq||0)-(b.seq||0));
          const critIds = critical.length ? critical.map(t => t.id) :
            ((re.selectedPlanId && re.reformPlans.find(p=>p.id===re.selectedPlanId) || {}).criticalPath || []);
          const critTotalDays = critIds.length ? Math.round(critIds.length * 6.5) : 0;
          return critIds.length>0 ? `
          <div style="margin-top:8px;padding:7px 10px;background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);border-radius:5px">
            <div style="font-size:11px;font-weight:600;color:#0ea5e9;margin-bottom:3px">🛤 关键路径 (simulation-plan 二补.6 · 决定总工期的最长依赖链)</div>
            <div style="font-family:monospace;font-size:12px;color:var(--text-primary);letter-spacing:0.5px;word-break:break-all">
              ${critIds.join(' → ')}
              <span style="color:var(--text-muted);font-family:sans-serif;margin-left:8px">(预计 ${critTotalDays || (tasks.filter(t=>t.isCritical).length*7 || 49)} 天)</span>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">并行路径 ${tasks.filter(t=>!t.isCritical).length} 条不影响总工期；关键路径任一任务延期将直接推迟改造完成日期</div>
          </div>` : '';
        })() : ''}
        <!-- 改造动作 Timeline -->
        <div style="margin-top:8px">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">已完成动作 (${actions.length}项, 最近5条):</div>
          ${actions.length===0 ? `<div style="font-size:12px;color:var(--text-muted);padding:6px">暂无完成记录, 点击「④ 一键执行改造」启动</div>` : `
            <div style="display:flex;flex-direction:column;gap:3px;max-height:90px;overflow:auto">
              ${[...actions].reverse().slice(0,5).map(a => `
                <div style="font-size:12px;padding:3px 6px;background:rgba(16,185,129,0.1);border-left:3px solid #10b981;border-radius:3px">
                  <span style="color:var(--text-muted);font-family:monospace">${a.completedAt||''}</span>
                  <b>[${a.dim||''}]</b> ${a.action}
                  <span style="margin-left:auto;color:#059669">+${a.creditGain||0}分</span>
                </div>`).join('')}
            </div>`}
        </div>`}
    </div>`;
  },

  // ===== A5: 银行匹配 + 案例推荐 =====
  _renderA5_BankAndCases(ent, re) {
    const banks = re.bankMatches || [];
    const cases = re.similarCases || [];
    return `
    <div class="card" style="min-height:360px">
      <div class="card-title">
        <span>A5 · 银行匹配 (R9) + 相似案例推荐 (R10)</span>
      </div>
      <!-- 银行匹配 -->
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">🏦 银行匹配结果 ${banks.length>0 ? `(${banks.filter(b=>b.preApproval).length} 家预审批通过)` : '(未匹配,改造完成后自动生成)'}</div>
      ${banks.length===0 ? `
        <div style="padding:18px;background:var(--bg-tertiary);border-radius:5px;color:var(--text-muted);text-align:center;font-size:12px;margin-bottom:10px">
          ⚡ 改造进行中 · 当前等级 <b>${re.currentLevel}</b> 达到目标后, R9 将自动基于 BIDS 引擎匹配适合贵企业的银行产品
        </div>` : `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
          ${banks.slice(0,3).map(b => `
            <div class="bank-match-card ${b.preApproval?'bank-match-approved':''}">
              <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
                <span style="font-size:16px">${b.logo||'🏛'}</span>
                <b style="font-size:13px">${b.bankName}</b>
                ${b.preApproval?'<span class="tag tag-xs tag-green">预审批</span>':'<span class="tag tag-xs tag-gray">待补充</span>'}
                <span style="margin-left:auto;font-size:11px;font-weight:700;color:${b.probability>=80?'#059669':b.probability>=60?'#f59e0b':'#ef4444'}">${b.probability}%</span>
              </div>
              <div style="font-size:11px;color:#0369a1;margin-bottom:4px">${b.product}</div>
              <div style="display:flex;justify-content:space-between;font-size:11px">
                <span>💰 ${b.amountText}</span>
                <span>📈 ${b.rate}</span>
              </div>
              <div style="margin-top:4px;display:flex;gap:3px;flex-wrap:wrap">
                ${(b.tags||[]).slice(0,2).map(t=>`<span class="tag tag-xs tag-blue" style="font-size:10px">${t}</span>`).join('')}
              </div>
            </div>`).join('')}
        </div>`}
      <!-- 案例推荐 -->
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">📚 R10 相似案例推荐 (KNN · Top ${Math.min(3,cases.length)})</div>
      ${cases.length===0 ? `
        <div style="font-size:12px;color:var(--text-muted);padding:10px;background:var(--bg-tertiary);border-radius:5px;text-align:center">案例库加载中...</div>` : `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${cases.map(c => `
            <div style="padding:8px;background:linear-gradient(90deg,rgba(14,165,233,0.08),var(--bg-tertiary));border-radius:6px;border-left:3px solid #0ea5e9">
              <div style="display:flex;align-items:center;gap:6px">
                <b style="font-size:13px">${c.enterprise}</b>
                <span class="tag tag-xs tag-gray">${c.industryLabel||c.industry}</span>
                <span class="tag tag-xs tag-green" style="margin-left:auto">相似度 ${Math.round((c.similarity||0.5)*100)}%</span>
              </div>
              <div style="font-size:12px;margin:3px 0">
                <span class="red">${c.beforeLevel}</span> → <span class="green">${c.afterLevel}</span>
                · ⏱ ${c.totalDays}天 · 💰 ${c.totalInvestmentText || (c.totalCost?(State.formatAmount ? State.formatAmount(c.totalCost) : c.totalCost):'N/A')}
                · ⭐ +${c.creditGain||0}分
              </div>
              <div style="font-size:11px;color:var(--text-secondary)">关键动作: ${(c.completedActions||c.highlights||[]).slice(0,3).map(a=>typeof a==='string'?a:a.action).join(' / ')}</div>
            </div>`).join('')}
        </div>`}
    </div>`;
  },

  // ===== A6: 执行引擎家族 + 合规审查 =====
  _renderA6_ExecutorsAndLegal(ent, re) {
    const execs = MockData.REFORM_EXECUTORS || this._fallbackExecutors();
    const autonomy = MockData.REFORM_AUTONOMY_LEVELS && MockData.REFORM_AUTONOMY_LEVELS[re.autonomyLevel] ? MockData.REFORM_AUTONOMY_LEVELS[re.autonomyLevel] : { name:'L2', bounds:'文档生成' };
    const agg = MockData.AGGRESSIVENESS_LEVELS && MockData.AGGRESSIVENESS_LEVELS[re.aggressiveness] ? MockData.AGGRESSIVENESS_LEVELS[re.aggressiveness] : { bounds:'平衡', complianceRisk:'medium' };
    // 计算合规分: 基于 R7 结果或默认
    let legalReport = null;
    try { if (typeof ReformEngine !== 'undefined') { const plan = (re.reformPlans||[]).find(p=>p.id===re.selectedPlanId); if (plan) legalReport = ReformEngine.runR7_once(plan); } } catch(e){}
    return `
    <div class="card" style="min-height:360px">
      <div class="card-title">
        <span>A6 · 执行引擎家族 (R5) + 合规审查 (R7)</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
        <div style="padding:8px;background:rgba(14,165,233,0.1);border-radius:6px;border:1px solid #0ea5e9">
          <div style="font-size:12px;color:#0369a1;font-weight:600">执行边界 (当前 ${re.autonomyLevel})</div>
          <div style="font-size:13px;font-weight:700;margin:3px 0;color:#0ea5e9">${autonomy.name}</div>
          <div style="font-size:11px;color:#0369a1">${autonomy.bounds}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">⚠ 需法务签章的任务请切到 L4 模式</div>
        </div>
        <div style="padding:8px;background:${agg.complianceRisk==='low'?'rgba(16,185,129,0.1)':agg.complianceRisk==='medium'?'rgba(245,158,11,0.1)':'rgba(239,68,68,0.1)'};border-radius:6px;border:1px solid ${agg.complianceRisk==='low'?'#10b981':agg.complianceRisk==='medium'?'#f59e0b':'#ef4444'}">
          <div style="font-size:12px;font-weight:600;color:${agg.complianceRisk==='low'?'var(--accent-green)':agg.complianceRisk==='medium'?'var(--accent-orange)':'var(--accent-red)'}">合规边界 (${agg.name||re.aggressiveness})</div>
          <div style="font-size:13px;font-weight:700;margin:3px 0">${agg.bounds}</div>
          <div style="font-size:11px;color:var(--text-secondary)">合规风险: <b class="${agg.complianceRisk==='low'?'green':agg.complianceRisk==='medium'?'orange':'red'}">${agg.complianceRisk==='low'?'低':agg.complianceRisk==='medium'?'中':'高'}</b></div>
        </div>
      </div>
      <!-- 5 类执行器 -->
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:6px 0">R5 执行引擎家族 (5 类 · 点击查看能力):</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:10px">
        ${Object.entries(execs).map(([id,cfg]) => {
          const st = (re.taskDAG||[]).filter(t=>t.executor===id);
          const done = st.filter(t=>t.status==='done').length;
          const r5Status = re.engineStatus['R5'];
          return `
            <div class="executor-card" title="${cfg.scope}\n${st.length}任务: ${done}/${st.length}完成">
              <div style="font-weight:700;font-size:13px">${id}</div>
              <div style="font-size:10px;color:var(--text-secondary);margin:2px 0;line-height:1.2">${cfg.name.split(' ')[0]}</div>
              <div style="font-size:10px">${done}/${st.length}✓</div>
            </div>`;
        }).join('')}
      </div>
      <!-- 合规审查 R7 详情 -->
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0">R7 合规审查详情 ${legalReport?('(合规分: <b class="'+(legalReport.canPass?'green':'red')+'">'+legalReport.score+'</b>)'):''}</div>
      ${!legalReport ? `
        <div style="padding:10px;background:var(--bg-tertiary);border-radius:5px;color:var(--text-muted);font-size:12px;text-align:center">
          选择路径后自动生成合规审查结果
        </div>` : `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px">
          <div style="padding:6px;background:${legalReport.redlinesTriggered>0?'rgba(239,68,68,0.1)':'rgba(16,185,129,0.1)'};border-radius:5px;text-align:center">
            <div class="${legalReport.redlinesTriggered>0?'red':'green'}" style="font-size:18px;font-weight:700">${legalReport.redlinesTriggered}</div>
            <div style="font-size:10px;color:var(--text-muted)">红线阻断</div>
          </div>
          <div style="padding:6px;background:${legalReport.grayZonesCount>0?'rgba(245,158,11,0.1)':'rgba(16,185,129,0.1)'};border-radius:5px;text-align:center">
            <div class="${legalReport.grayZonesCount>0?'orange':'green'}" style="font-size:18px;font-weight:700">${legalReport.grayZonesCount}</div>
            <div style="font-size:10px;color:var(--text-muted)">灰区(需复核)</div>
          </div>
          <div style="padding:6px;background:rgba(16,185,129,0.1);border-radius:5px;text-align:center">
            <div class="green" style="font-size:18px;font-weight:700">${legalReport.greenZonesCount}</div>
            <div style="font-size:10px;color:var(--text-muted)">绿区(自主)</div>
          </div>
        </div>
        <div style="max-height:90px;overflow:auto">
          ${legalReport.findings.map(f => `
            <div style="font-size:11px;padding:3px 6px;border-left:3px solid ${f.level==='red'?'#ef4444':f.level==='gray'?'#f59e0b':'#10b981'};background:${f.level==='red'?'rgba(239,68,68,0.1)':f.level==='gray'?'rgba(245,158,11,0.1)':'rgba(16,185,129,0.1)'};margin-bottom:2px;border-radius:3px">
              <b class="${f.level==='red'?'red':f.level==='gray'?'orange':'green'}">[${f.level==='red'?'红线':f.level==='gray'?'灰区':'绿区'}]</b>
              ${f.label} → <span style="color:var(--text-secondary)">${f.action}</span>
            </div>`).join('')}
        </div>`}
    </div>`;
  },
  _fallbackExecutors(){
    // spec 二补.4: R5-A~R5-H 8 类执行器 (对齐 reform-engine.js 的 R5_EXECUTORS)
    return {
      'R5-A':{name:'主体改造执行器',scope:'壳公司筛选/尽调/收购协议/资质申请/增资/法人变更'},
      'R5-B':{name:'财务改造执行器',scope:'调整分录/补税测算/报表重述/债转股方案/现金流优化'},
      'R5-C':{name:'税务修复执行器',scope:'补税申报/信用修复/优惠匹配/红冲重开/评级修复'},
      'R5-D':{name:'业务规范执行器',scope:'合同补签/流水规范/社保补缴/物流补单/业务台账'},
      'R5-E':{name:'资产盘活执行器',scope:'保理申请/质押登记/租赁方案/数据资产入表/知识产权'},
      'R5-F':{name:'信用修复执行器',scope:'异议申诉/信用修复/债务整合/结清证明/多头借贷优化'},
      'R5-G':{name:'政策对接执行器',scope:'担保基金申请/资质认定/贴息申请/政府对接/专精特新'},
      'R5-H':{name:'资本运作执行器',scope:'重组方案/估值建模/协议起草/引入战投/股权激励'}
    };
  },

  // ===== 流水线 6 步主按钮 =====
  async pipelineStepDiagnose() {
    if (!ReformEngine) return;
    const re = State.reformEngine;
    re.status = 'diagnosing'; State._notify();
    State.saveReformBeforeSnapshot();
    setTimeout(() => {
      const report = ReformEngine.pipelineDiagnose(State.currentEnterprise);
      re.status = 'idle';
      AIModal && AIModal.toast({ type:'success', title:'R1+R2 诊断完成', text: `识别 ${report.criticalGaps} 严重缺口 + ${report.violations.length} 合规风险`, duration_ms:3500 });
      State._notify();
    }, 500);
  },
  pipelineStepGeneratePlans() {
    if (!ReformEngine) return;
    const re = State.reformEngine;
    re.status = 'planning'; State._notify();
    setTimeout(() => {
      const plans = ReformEngine.pipelineGeneratePlans();
      re.status = 'idle';
      AIModal && AIModal.toast({ type:'success', title:'R3 方案生成完成', text: `生成 3 条路径, 推荐: ${plans.find(p=>p.recommended)?.pathName||'-'}`, duration_ms:3500 });
      State._notify();
    }, 500);
  },
  pipelineStepSchedule() {
    if (!ReformEngine) return;
    const re = State.reformEngine;
    if (!re.selectedPlanId && re.reformPlans[0]) re.selectedPlanId = re.reformPlans[0].id;
    re.status = 'planning'; State._notify();
    setTimeout(() => {
      const { tasks } = ReformEngine.pipelineSelectPlanAndSchedule(re.selectedPlanId);
      re.status = 'idle';
      AIModal && AIModal.toast({ type:'success', title:'R4 任务调度完成', text: `生成 ${tasks.length} 个任务 · 关键路径 ${tasks.filter(t=>t.isCritical).length} 步, 可以点击「④一键执行」`, duration_ms:4000 });
      State._notify();
    }, 500);
  },
  async pipelineStepExecute() {
    if (!ReformEngine) return;
    const re = State.reformEngine;
    if (re.taskDAG.length === 0) return;
    State.log('reform', `🚀 启动一键改造执行 (R5+R6+R7) · 共 ${re.taskDAG.length} 个任务, 每步600ms 模拟`, 'reform');
    AIModal && AIModal.toast({ type:'info', title:'执行中...', text: `正在模拟 ${re.taskDAG.length} 个改造任务, 请稍候`, duration_ms:3000 });
    await ReformEngine.pipelineAutoExecute(600);
    AIModal && AIModal.toast({ type:'success', title:'🎉 改造执行完成', text: `${State.currentEnterprise.name} 已升级到 ${re.currentLevel} 级, 请先前往 Tab1 配置合作模式并查看融资能力, 再去 Tab2 发起融资`, duration_ms:6000 });
    State._notify();
  },
  pipelineStepBankMatch() {
    if (!ReformEngine) return;
    const matches = ReformEngine.runR9(State.currentEnterprise);
    const top = matches[0];
    AIModal && AIModal.toast({ type: top && top.preApproval ? 'success' : 'info', title:'R9 银行匹配完成', text: top ? `${top.bankName} 匹配率 ${top.probability}% · ${top.amountText} · ${top.rate}` : '暂无匹配银行', duration_ms:5000 });
    State._notify();
  },
  pipelineStepCases() {
    if (!ReformEngine) return;
    const cases = ReformEngine.runR10(State.currentEnterprise);
    State.reformEngine.similarCases = cases;
    AIModal && AIModal.toast({ type:'success', title:'R10 案例检索完成', text: `Top1: ${cases[0]?cases[0].enterprise+' (相似度'+Math.round((cases[0].similarity||0)*100)+'%)':'无'}`, duration_ms:4000 });
    State._notify();
  },

  // ===== 方案选择 =====
  selectPlan(planId) {
    State.reformEngine.selectedPlanId = planId;
    const plan = State.reformEngine.reformPlans.find(p=>p.id===planId);
    if (plan && typeof State._computeReformEstimation === 'function') {
      State.reformEngine.estimation = State._computeReformEstimation(plan);
    }
    State.log('reform', `📌 选定方案: ${plan?.pathName||planId}`, 'reform');
    State._notify();
  },

  // ===== spec 二补.7 场景A: 保守版改造 (v=36 补齐) =====
  // 一键加载保守版方案: 切换激进程度 → 诊断 → 生成3方案 → 选方案1(保守) → 调度DAG → 可选: 自动执行
  simulateScenarioA_conservative() {
    if (!State || !ReformEngine) return;
    State.log('reform', '🟢 [场景A] 加载保守版改造方案 (仅绿区合规动作·无灰区·快速体验)', 'reform');
    State.setReformAggressiveness('conservative');
    setTimeout(() => {
      ViewReform.pipelineStepDiagnose();
      setTimeout(() => {
        ViewReform.pipelineStepGeneratePlans();
        setTimeout(() => {
          // 自动选中保守版的推荐方案 (通常是 plan_1 或 pathLevel=conservative 的)
          const re = State.reformEngine;
          const plan = (re.reformPlans||[]).find(p => p.pathLevel==='conservative' && p.recommended) || (re.reformPlans||[]).find(p => p.pathLevel==='conservative') || re.reformPlans[0];
          if (plan) ViewReform.selectPlan(plan.id);
          setTimeout(() => {
            ViewReform.pipelineStepSchedule();
            State.log('reform', '🟢 [场景A] 保守版方案已就绪: 10+ 绿区动作 · 无灰区法务节点 · 预计 3~6 月完成 · 可点击「④一键执行」直接跑完全流程', 'reform');
            AIModal && AIModal.toast({ type:'success', title:'🟢 场景A 保守版已就绪', text:'已生成 '+State.reformEngine.taskDAG.length+' 个绿区任务，可点击 ④一键执行 快速体验改造闭环', duration_ms:5000 });
          }, 350);
        }, 450);
      }, 450);
    }, 200);
  },

  // ===== spec 二补.7 场景B: 平衡版改造 (v=36 补齐) =====
  // 加载平衡版方案: 切换激进程度=balanced → 诊断+生成方案 → 选平衡版 → 调度 → 必定含反向收购/股权代持等灰区动作 (触发 Tab3 法务审核)
  simulateScenarioB_balanced() {
    if (!State || !ReformEngine) return;
    State.log('reform', '🔵 [场景B] 加载平衡版改造方案 (绿区+灰区·含反向收购/股权代持·触发 Tab3 法务复核)', 'reform');
    State.setReformAggressiveness('balanced');
    setTimeout(() => {
      ViewReform.pipelineStepDiagnose();
      setTimeout(() => {
        ViewReform.pipelineStepGeneratePlans();
        setTimeout(() => {
          const re = State.reformEngine;
          const plan = (re.reformPlans||[]).find(p => p.pathLevel==='balanced' && p.recommended) || (re.reformPlans||[]).find(p => p.pathLevel==='balanced') || re.reformPlans[1] || re.reformPlans[0];
          if (plan) ViewReform.selectPlan(plan.id);
          setTimeout(() => {
            ViewReform.pipelineStepSchedule();
            // 提示灰区节点会推送到 Tab3
            const grayTasks = State.reformEngine.taskDAG.filter(t => t.requiresLegal);
            State.log('reform', `🔵 [场景B] 平衡版方案就绪: 含 ${grayTasks.length} 个灰区动作(反向收购/股权代持等) → 执行到这些节点时将自动推送 Tab3 法务复核`, 'reform');
            AIModal && AIModal.toast({ type:'info', title:'🔵 场景B 平衡版已就绪', text:`生成 ${State.reformEngine.taskDAG.length} 任务 · ${grayTasks.length} 灰区节点 · 执行后自动推 Tab3 审批（联动5.5）`, duration_ms:5500 });
          }, 350);
        }, 450);
      }, 450);
    }, 200);
  },

  // ===== spec 二补.7 场景C: 创新版改造 (v=36 补齐) =====
  // 加载创新版方案: 激进程度=innovative → 诊断+生成方案 → 选创新版 → 调度 → 含资本运作(Pre-IPO重组/混改/跨境VIE等) · 成本+时长大幅增加
  simulateScenarioC_innovative() {
    if (!State || !ReformEngine) return;
    State.log('reform', '🟠 [场景C] 加载创新版改造方案 (全合规空间·含资本运作复杂组合·成本/时长翻倍·通过率最高)', 'reform');
    State.setReformAggressiveness('innovative');
    setTimeout(() => {
      ViewReform.pipelineStepDiagnose();
      setTimeout(() => {
        ViewReform.pipelineStepGeneratePlans();
        setTimeout(() => {
          const re = State.reformEngine;
          const plan = (re.reformPlans||[]).find(p => p.pathLevel==='innovative' && p.recommended) || (re.reformPlans||[]).find(p => p.pathLevel==='innovative') || re.reformPlans[2] || re.reformPlans.slice(-1)[0];
          if (plan) ViewReform.selectPlan(plan.id);
          setTimeout(() => {
            ViewReform.pipelineStepSchedule();
            const est = State.reformEngine.estimation || { totalCost:0, totalDays:0, creditGain:0 };
            State.log('reform', `🟠 [场景C] 创新版方案就绪: ${State.reformEngine.taskDAG.length} 任务 · 预估成本 ¥${(est.totalCost/10000).toFixed(1)}万 · 时长 ${est.totalDays}天 · 目标直达 A 级 · 含资本运作(R5-H)节点`, 'reform');
            AIModal && AIModal.toast({ type:'warning', title:'🟠 场景C 创新版已就绪', text:`任务数 ×1.5 · 成本 ¥${(est.totalCost/10000).toFixed(0)}万 · 时长 ${est.totalDays}天 · 包含 R5-H 资本运作执行器`, duration_ms:5500 });
          }, 350);
        }, 450);
      }, 450);
    }, 200);
  },

  // ===== spec 二补.7 场景D: 改造失败重规划 =====
  // 模拟随机选取 DAG 中第一个 pending 任务执行失败 → 触发 R6 拆分重排
  simulateScenarioD_failureAndReplan() {
    if (!ReformEngine || !State.reformEngine) return;
    const re = State.reformEngine;
    const pendingTasks = (re.taskDAG || []).filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) {
      AIModal && AIModal.toast({ type:'warning', title:'场景D 无可用任务', text:'DAG 中没有 pending 任务, 请先点击场景A/B/C 或执行步骤①②③', duration_ms:3000 });
      return;
    }
    const target = pendingTasks[0];
    State.log('reform', `🧨 [场景D] 模拟任务 ${target.id} (${target.label}) 执行失败, 启动 R6 动态重规划...`, 'reform');
    target.status = 'failed';
    target.result = { success:false, reason:'场景D 模拟失败: 外部税务接口超时 (人工触发)', retryable:true, nextTryAt: new Date(Date.now()+3600000).toISOString() };
    // 调用 R6 重排
    const r6Result = ReformEngine.runR6_onFailure(target);
    // 重算进度
    re.progress = re.totalTasks > 0 ? Math.min(1, re.completedTasks / re.totalTasks) : 0;
    AIModal && AIModal.toast({
      type: r6Result.retry ? 'info' : 'error',
      title: r6Result.retry ? `🧨 R6 重排触发 (${target.id})` : '🛑 R6 重试上限',
      text: r6Result.retry
        ? `任务 ${target.id} 拆分为 3 个并行子任务, 总任务数 +3 → ${re.totalTasks}, 进度回退, 关键路径延长`
        : `任务 ${target.id} 已达重试上限 3 次, 请升级 L4 人工介入`,
      duration_ms: 5000
    });
    State._notify();
  },

  // ===== spec 二补.7 场景E: 改造完成 (v=36 更正语义) =====
  // 所有任务标记完成 → R2 复检达标 → creditGradeCap = postReform 上限 → financingUnlocked=true → Tab1 解锁 → 自动推送至 Tab1/Tab2
  simulateScenarioE_complete() {
    if (!State || !State.reformEngine) return;
    const re = State.reformEngine;
    const ent = State.currentEnterprise;
    // 步骤1: 如果还没有 DAG 任务 (状态 idle), 先自动跑场景A生成任务, 然后再一次性标记完成
    const ensureDAG = (cb) => {
      if (re.taskDAG && re.taskDAG.length > 0) return cb();
      State.log('reform', '✅ [场景E] 当前 DAG 为空 → 自动调用场景A 生成任务后再一键完成', 'reform');
      // 切换到保守版并快速生成方案+调度
      State.setReformAggressiveness('conservative');
      setTimeout(() => {
        ViewReform.pipelineStepDiagnose(true);
        setTimeout(() => { ViewReform.pipelineStepGeneratePlans(true); setTimeout(() => {
          const plan = (re.reformPlans||[]).find(p=>p.recommended) || re.reformPlans[0];
          if (plan) ViewReform.selectPlan(plan.id);
          setTimeout(() => { ViewReform.pipelineStepSchedule(true); setTimeout(cb, 250); }, 250);
        }, 350); }, 350);
      }, 150);
    };
    ensureDAG(() => {
      if (!confirm(`场景E 将把 DAG 中 ${re.taskDAG.length} 个任务全部标记为完成、触发 R2 复检达标、解锁 Tab1 融资入口。确认执行?`)) return;
      // 步骤2: 所有任务标记 done
      let creditGainTotal = 0;
      (re.taskDAG || []).forEach(t => {
        if (t.status !== 'done') {
          t.status = 'done';
          t.result = {
            success:true,
            completedAt: new Date().toISOString(),
            scenarioE_autoComplete: true,
            outputDocument: t.id + '_SCENARIO_E_OUTPUT.pdf',
            creditGain: t.creditGain || 0,
            dimScoreDelta: t.dimScoreDelta || {},
            hours: t.hours, cost: t.cost
          };
          creditGainTotal += (t.creditGain || 0);
          re.completedTasks = (re.completedTasks || 0) + 1;
          re.completedActions.push({
            taskId: t.id, dim: t.dim, action: `[场景E 一键完成] ${t.label}`,
            creditGain: t.creditGain, completedAt: new Date().toLocaleTimeString('zh-CN',{hour12:false})
          });
          if (t.dimScoreDelta && typeof t.dimScoreDelta === 'object') {
            Object.entries(t.dimScoreDelta).forEach(([k,v]) => {
              re.scorecard.current[k] = Math.min(100, (re.scorecard.current[k]||0) + (typeof v==='number'?v:0));
            });
          }
        }
      });
      re.progress = re.totalTasks > 0 ? Math.min(1, re.completedTasks / re.totalTasks) : 1;
      re.status = 'completed';
      // 步骤3: 触发 R2 复检（把 current 拉升到目标）
      const tgt = re.scorecard.target || {};
      Object.keys(tgt).forEach(k => { re.scorecard.current[k] = Math.max(re.scorecard.current[k]||0, tgt[k]); });
      re.currentLevel = re.targetLevel;
      // 步骤4: 联动 5.3 → 企业融资入口解锁 + 信用分提升 + creditGradeCap 升级
      if (ent && ent.runtime) {
        ent.runtime.financingUnlocked = true;
        ent.runtime.creditGradeCap = re.targetLevel;
        ent.runtime.creditGradeCapReformed = true;
        if (ent.runtime.postReformCreditScore && ent.runtime.creditScore < ent.runtime.postReformCreditScore) {
          ent.runtime.creditScore = ent.runtime.postReformCreditScore;
        }
        ent.runtime.creditCompleteness = Math.min(1, ent.runtime.creditCompleteness + 0.45);
        // ===== 持久化到 ent.reform, 确保切换企业/刷新后状态不丢 =====
        if (!ent.reform) ent.reform = { beforeScorecard: {...(re.scorecard.before||re.scorecard.current)}, completedActions: [] };
        ent.reform.hasReformed = true;
        ent.reform.reformedAt = new Date().toISOString();
        ent.reform.afterLevel = re.targetLevel;
        ent.reform.afterScorecard = { ...re.scorecard.current };
        ent.reform.completedActions = [...re.completedActions];
      }
      // 步骤5: R8 进度监控里程碑 + R9 银行匹配自动触发
      re.engineStatus.R8 = { status:'completed', lastRunAt:new Date().toISOString(), result:'milestone_all_clear' };
      re.engineStatus.R2 = { status:'completed', lastRunAt:new Date().toISOString(), result:'复检_全部达标' };
      setTimeout(() => {
        if (typeof ViewReform.pipelineStepBankMatch === 'function') ViewReform.pipelineStepBankMatch();
      }, 350);
      State.log('reform', `✅ [场景E · 二补.7 对齐] 一键完成改造! 任务 ${re.completedTasks}/${re.totalTasks} · R2 复检达标 · 等级 ${re.currentLevel} · 融资入口已解锁(financingUnlocked=true) · 已触发 R9 银行匹配 · 建议跳转 Tab1/Tab2 继续融资流程`, 'reform');
      AIModal && AIModal.toast({
        type:'success',
        title:'✅ 场景E: 改造全部完成 (R2复检达标)',
        text:`${ent?ent.name:''} 信用等级 ${re.currentLevel} · Tab1 融资入口已解锁 · R9 自动匹配银行 · 请先前往 Tab1 配置合作模式并查看融资能力, 再去 Tab2 发起融资`,
        duration_ms:6500,
        actions:[{ label:'🚀 去 Tab1 配置并查看融资能力', onClick:()=>typeof App!=='undefined'&&App.switchTab&&App.switchTab('enterprise') }]
      });
      State._notify();
    });
  },

  // ===== 额外工具: 重置改造到起点 (原场景E, 语义更正后降级为普通操作) =====
  simulateResetAll() {
    if (!State || !State.reformEngine) return;
    const re = State.reformEngine;
    if (!confirm('确认重置当前企业的改造状态? 所有诊断/方案/DAG/进度将被清空, 回到改造前起点.')) return;
    // 备份 before snapshot (用于改造前对比)
    const beforeSnap = re.scorecard.before || JSON.parse(JSON.stringify(re.scorecard.current));
    re.status = 'idle';
    re.gapReport = null;
    re.reformPlans = [];
    re.selectedPlanId = null;
    re.taskDAG = [];
    re.completedActions = [];
    re.completedTasks = 0;
    re.progress = 0;
    re.bankMatches = [];
    re.similarCases = [];
    re.estimation = { totalCost:0, totalDays:0, creditGain:0 };
    re.engineStatus = Object.fromEntries(Object.keys(re.engineStatus).map(k => [k, { status:'idle', lastRunAt:null, result:null }]));
    // 把 8 维 current 回滚到 before
    re.scorecard.current = JSON.parse(JSON.stringify(beforeSnap));
    re.currentLevel = State._computeReformLevel ? State._computeReformLevel(re.scorecard.current) : 'D';
    // 撤销企业级融资入口解锁 (因为重置后未完成)
    if (State.currentEnterprise) {
      const ent = State.currentEnterprise;
      if (ent.runtime) {
        ent.runtime.financingUnlocked = false;
        ent.runtime.creditGradeCapReformed = false;
      }
      if (ent.reform) {
        ent.reform.hasReformed = false;
        ent.reform.reformedAt = null;
        ent.reform.afterLevel = null;
        ent.reform.afterScorecard = null;
        ent.reform.completedActions = [];
        ent.reform.totalInvestmentHours = 0;
        ent.reform.totalCost = 0;
      }
    }
    State.log('reform', '♻ [重置] 改造状态已清空 → 8 维评分卡回滚到改造前, 融资入口重新锁定, 可重新点击场景A/B/C 或 ① 诊断开始', 'reform');
    AIModal && AIModal.toast({ type:'success', title:'改造已重置', text:'所有状态已清空, 可重新点击场景A/B/C 或 ① AI差距诊断 开始', duration_ms:4000 });
    State._notify();
  },
  // ===== FP-07 (spec L307-329): 改造流程暂停/恢复/放弃状态机 =====
  pauseReform() {
    const reason = prompt('请输入暂停原因 (可选, 直接确定使用默认):', '用户主动暂停');
    if (reason === null) return; // 用户取消
    if (typeof ReformEngine !== 'undefined' && ReformEngine.pauseReform) {
      ReformEngine.pauseReform(reason);
    }
  },

  resumeReform() {
    if (typeof ReformEngine !== 'undefined' && ReformEngine.resumeReform) {
      ReformEngine.resumeReform();
    }
  },

  abandonReform() {
    const ent = State.currentEnterprise;
    const re = State.reformEngine || {};
    const doneCount = (re.taskDAG || []).filter(t => t.status === 'done').length;
    const totalCount = re.totalTasks || 0;
    if (!confirm(`⚠️ 放弃改造确认\n\n企业: ${ent?ent.name:''}\n当前进度: ${doneCount}/${totalCount}\n\n放弃后:\n• ${totalCount - doneCount} 个未完成任务将被标记为 cancelled\n• ${doneCount} 个已完成产物将保留 (作为下次重试参考)\n• 失败案例将入库 R10 案例库\n• 改造状态 → abandoned\n\n确认放弃? (二次确认)`)) return;
    if (!confirm(`🔴 最终确认: 放弃 ${ent?ent.name:''} 的改造流程?\n\n此操作不可撤销! 请输入大写 CONFIRM 后继续:`)) return;
    if (typeof ReformEngine !== 'undefined' && ReformEngine.abandonReform) {
      const ok = ReformEngine.abandonReform('CONFIRM_ABANDON');
      if (ok && AIModal && AIModal.toast) {
        AIModal.toast({ type:'error', title:'🛑 改造已放弃', text:`${ent?ent.name:''} 改造流程已放弃 · 失败案例入库 R10 · 可在 Tab0 重新启动新改造`, duration_ms:5000 });
      }
    }
  },

  // ===== FP-05: R10 模型再训练触发 =====
  triggerR10Retraining() {
    if (typeof ReformEngine === 'undefined' || !ReformEngine.runR10_retraining) {
      AIModal && AIModal.toast({ type:'warning', title:'R10 再训练不可用', text:'ReformEngine.runR10_retraining 未加载', duration_ms:3000 });
      return;
    }
    const result = ReformEngine.runR10_retraining();
    if (!result.triggered) {
      AIModal && AIModal.toast({ type:'info', title:'🧠 R10 再训练未触发', text:`案例数 ${result.currentCases} < 50 阈值, 需累积更多改造案例`, duration_ms:4500 });
    }
  },

  // ===== FP-06: 知识图谱更新 =====
  updateKnowledgeGraph() {
    if (typeof ReformEngine === 'undefined' || !ReformEngine.runR10_updateKnowledgeGraph) {
      AIModal && AIModal.toast({ type:'warning', title:'知识图谱更新不可用', text:'ReformEngine.runR10_updateKnowledgeGraph 未加载', duration_ms:3000 });
      return;
    }
    const result = ReformEngine.runR10_updateKnowledgeGraph();
    if (result.updated) {
      AIModal && AIModal.toast({ type:'success', title:'📊 知识图谱已更新', text:`新增 ${result.newNodeCount} 节点 / ${result.newEdgeCount} 关系 · 总计 ${result.totalNodes}/${result.totalEdges} · 版本 ${result.version}`, duration_ms:5000 });
    }
  },

  // ===== FP-10: H1-H7 假设验证 =====
  validateHypotheses() {
    if (typeof ReformEngine === 'undefined' || !ReformEngine.runHypothesesValidation) {
      AIModal && AIModal.toast({ type:'warning', title:'H1-H7 验证不可用', text:'ReformEngine.runHypothesesValidation 未加载', duration_ms:3000 });
      return;
    }
    const result = ReformEngine.runHypothesesValidation();
    // 详细结果在 toast 中已显示, 这里仅触发刷新
    State._notify();
  },

  // ===== FP-03: R6 月度重规划 =====
  runMonthlyReview() {
    if (typeof ReformEngine === 'undefined' || !ReformEngine.runR6_monthlyReview) {
      AIModal && AIModal.toast({ type:'warning', title:'月度重规划不可用', text:'ReformEngine.runR6_monthlyReview 未加载', duration_ms:3000 });
      return;
    }
    const result = ReformEngine.runR6_monthlyReview();
    AIModal && AIModal.toast({
      type: result.needsReplan ? 'info' : 'success',
      title: result.needsReplan ? `📅 月度重规划已触发` : `📅 月度评估通过`,
      text: result.needsReplan
        ? `缺口 Δ${result.gapDelta>0?'+':''}${result.gapDelta} · 已生成 ${result.newHardGaps} 个补充任务`
        : `无新增硬缺口, 维持原方案 (缺口 Δ${result.gapDelta})`,
      duration_ms: 5000
    });
    State._notify();
  },

  // ===== FP-02: R2 改造完成复检 =====
  runR2Recheck() {
    if (typeof ReformEngine === 'undefined' || !ReformEngine.runR2_recheck) {
      AIModal && AIModal.toast({ type:'warning', title:'R2 复检不可用', text:'ReformEngine.runR2_recheck 未加载', duration_ms:3000 });
      return;
    }
    const result = ReformEngine.runR2_recheck();
    AIModal && AIModal.toast({
      type: result.passed ? 'success' : 'error',
      title: result.passed ? `🔍 R2 复检通过` : `🔍 R2 复检失败`,
      text: result.passed
        ? `硬缺口 0 · 修复率 ${Math.round(result.repairRate*100)}% ≥ 80% · 可触发 MOD-16 完成流程`
        : `硬缺口 ${result.hardGapsRemaining} · 修复率 ${Math.round(result.repairRate*100)}% < 80% · 已触发 R6 重规划`,
      duration_ms: 6000
    });
    State._notify();
  }
};

window.ViewReform = ViewReform;
