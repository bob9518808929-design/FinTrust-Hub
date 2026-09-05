/**
 * view-fallback.js — Tab8 独立兜底引擎控制台 (v4.3 新增 + v5.0 R1-R10 扩展)
 *
 * 六大功能分区:
 *   🟢 分区 1: 外部 API 适配层 (INFRA-01b) — 15 个 API 状态卡片 + 全断/恢复/限流风暴
 *   🟡 分区 2: B1-B12 自研护城河模块矩阵 (4×3 网格 + 详情侧栏)
 *   🟣 分区 2b: R1-R10 改造引擎矩阵 (v5.0 新增, simulation-plan 自研档 R 层)
 *   🔴 分区 3: C1-C7 兜底子模块状态 + 兜底降级链可视化
 *   🟣 分区 4: 独立运行模式控制面板 (S3 修正)
 *   📊 分区 5: 三档开发投入占比仪表盘 (S4+S7 修正)
 *
 * 数据来源: State.externalApis / State.fallbackEngine / State.selfDevelopedModules / State.tierInvestment
 *           State.reformEngine.engineStatus / MockData.REFORM_ENGINES
 * 视图辅助: FallbackEngine (fallback-engine.js)
 */

const ViewFallback = {
  // 当前展开详情的 C 模块 ID
  _expandedCModuleId: null,
  // 当前选中的 B 模块 ID
  _selectedBModuleId: null,
  // 三档仪表盘当前维度
  _tierMode: 'modules',

  render() {
    const root = document.getElementById('view-fallback');
    if (!root) return;
    const summary = FallbackEngine.getFallbackChainSummary();
    const indMode = State.fallbackEngine.independentMode;

    root.innerHTML = `
      <div class="fallback-console">
        <div class="fallback-header">
          <div>
            <h2 style="margin:0;font-size:18px;color:var(--text-primary)">🛡 Tab8 独立兜底引擎控制台</h2>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
              MOD-15 + INFRA-01b + B1-B12 + C1-C7 · spec v2.0 三档分类演示 · 自营兜底标注: <span style="color:var(--accent-red);font-weight:700">⚠️ ${State.fallbackEngine.selfOperatedTag}</span>
            </div>
          </div>
          <div class="fallback-status-summary" style="display:flex;gap:14px;flex-wrap:wrap">
            <div class="stat-pill" style="border-left:4px solid var(--accent-green)">
              <div class="stat-label">🟢 外部 API</div>
              <div class="stat-value">${summary.connectedApis}/${summary.totalApis}</div>
            </div>
            <div class="stat-pill" style="border-left:4px solid #8b5cf6">
              <div class="stat-label">🟣 R1-R10 改造引擎</div>
              <div class="stat-value">${Object.keys(MockData.REFORM_ENGINES || {}).length}/10 active</div>
            </div>
            <div class="stat-pill" style="border-left:4px solid var(--accent-orange)">
              <div class="stat-label">🟠 激活兜底</div>
              <div class="stat-value">${summary.activeFallbacks}/${summary.totalFallbacks}</div>
            </div>
            <div class="stat-pill" style="border-left:4px solid ${summary.levelColor}">
              <div class="stat-label">${summary.levelIcon} 降级链</div>
              <div class="stat-value" style="color:${summary.levelColor}">L${summary.currentLevel} ${summary.levelLabel}</div>
            </div>
            <div class="stat-pill" style="border-left:4px solid ${indMode.enabled ? 'var(--accent-purple)' : 'var(--text-muted)'}">
              <div class="stat-label">${indMode.enabled ? '🟣' : '⚪'} 独立运行</div>
              <div class="stat-value" style="color:${indMode.enabled ? 'var(--accent-purple)' : 'var(--text-muted)'}">${indMode.enabled ? '开启' : '关闭'}</div>
            </div>
          </div>
        </div>

        <!-- 分区 1: 外部 API 适配层 -->
        ${this._renderApiSection()}

        <!-- 分区 2: B1-B12 自研护城河矩阵 -->
        ${this._renderBModulesSection()}

        <!-- 分区 2b: R1-R10 改造引擎矩阵 (v5.0 新增, simulation-plan 自研档 R 层) -->
        ${this._renderRModulesSection()}

        <!-- 分区 3: C1-C7 兜底子模块 + 降级链 -->
        ${this._renderCModulesSection()}

        <!-- 分区 4: 独立运行模式控制面板 -->
        ${this._renderIndependentModeSection()}

        <!-- 分区 5: 三档开发投入占比仪表盘 -->
        ${this._renderTierInvestmentSection()}

        <!-- C 模块详情侧栏 (点击 C 模块时展开) -->
        ${this._expandedCModuleId ? this._renderCModuleDetailPanel() : ''}
      </div>
    `;

    // 绑定事件
    this._bindEvents();
  },

  // === 🟢 分区 1: 外部 API 适配层 (15 个卡片) ===
  _renderApiSection() {
    const apis = State.externalApis;
    const cards = apis.map(api => {
      const vis = FallbackEngine.getApiStatusVisual(api);
      const fallback = State.getCModuleById(api.fallbackTo);
      const limitBar = api.rateLimitCount > 0
        ? `<div class="api-limit-bar" style="height:3px;background:var(--border-color);border-radius:2px;margin-top:4px;overflow:hidden">
             <div style="height:100%;width:${Math.min(100, api.rateLimitCount)}%;background:${api.rateLimitCount > 80 ? 'var(--accent-red)' : api.rateLimitCount > 50 ? 'var(--accent-orange)' : 'var(--accent-green)'};transition:width .3s"></div>
           </div>`
        : '';
      const latency = api.lastLatencyMs != null ? `${api.lastLatencyMs}ms` : '—';
      return `
        <div class="api-card ${api.status === 'connected' ? '' : 'api-card-disconnected'}" data-api-id="${api.id}" title="${api.id} ${api.name}">
          <div class="api-card-head">
            <span style="font-size:14px">${vis.icon}</span>
            <span class="api-card-id">${api.id}</span>
            <span class="api-card-status" style="color:${vis.color}">${vis.label}</span>
          </div>
          <div class="api-card-name">${api.name}</div>
          <div class="api-card-meta">
            <span>延迟 ${latency}</span> · <span>限流 ${api.rateLimitCount}/${api.rateLimitMax}</span>
          </div>
          ${limitBar}
          <div class="api-card-meta" style="margin-top:4px">
            <span>熔断: <b style="color:${api.circuitState === 'closed' ? 'var(--accent-green)' : api.circuitState === 'half_open' ? 'var(--accent-orange)' : 'var(--accent-red)'}">${api.circuitState}</b></span>
          </div>
          <div class="api-card-fallback">兜底 → <b style="color:var(--accent-orange)">${api.fallbackTo}</b> ${fallback ? fallback.name : ''}</div>
          <div class="api-card-actions">
            ${api.circuitState === 'forced_off'
              ? '<span style="font-size:10px;color:var(--accent-purple)">强制断开(独立运行)</span>'
              : `<button class="btn-mini" onclick="FallbackEngine.toggleApiStatus('${api.id}')" title="${api.status === 'connected' ? '断开此 API → 触发对应兜底子模块激活' : '恢复接入(不自动关闭对应兜底子模块,避免抖动)'}">${api.status === 'connected' ? '⏏ 断开' : '🔌 恢复'}</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    return `
      <section class="fallback-section" data-section="api">
        <div class="fallback-section-head">
          <h3>🟢 分区 1: 外部 API 适配层 <span class="section-spec-tag">INFRA-01b</span></h3>
          <div class="fallback-section-actions">
            <button class="btn btn-sm btn-danger" onclick="State.simulateAllApisDisconnect()" title="模拟外部 API 全断 → 触发兜底降级链 1→2 → C1-C7 按依赖激活">⏏ 一键全断</button>
            <button class="btn btn-sm btn-success" onclick="State.simulateAllApisRecover()" title="恢复全部外部 API 接入(仅恢复 connected 状态,C 模块需手动关闭)">🔌 恢复全部</button>
            <button class="btn btn-sm btn-warning" onclick="State.simulateApiRateLimitStorm()" title="模拟限流风暴 → 所有 connected API rateLimitCount 飙升至 80+/100,部分熔断器进入半开状态">⚡ 模拟限流风暴</button>
          </div>
        </div>
        <div class="api-grid">
          ${cards}
        </div>
        <div class="fallback-section-foot">
          默认状态: 11/15 已接入,4/15 断开(API-06 物流 GPS、API-11 担保公司、API-13 法律意见、API-14 外部审计) — 演示"系统在部分外部机构未接入时的兜底运行"
        </div>
      </section>
    `;
  },

  // === 🟡 分区 2: B1-B12 自研护城河模块矩阵 ===
  _renderBModulesSection() {
    const bs = State.selfDevelopedModules;
    const cards = bs.map(b => {
      const vis = FallbackEngine.getBModuleStatusVisual(b);
      const isSelected = this._selectedBModuleId === b.id;
      return `
        <div class="b-card ${isSelected ? 'b-card-selected' : ''}" onclick="ViewFallback._selectBModule('${b.id}')" title="点击查看 ${b.id} 模块详情">
          <div class="b-card-head">
            <span class="b-card-id">${b.id}</span>
            <span class="b-card-status" style="color:${vis.color}">${vis.icon} ${vis.label}</span>
          </div>
          <div class="b-card-name">${b.name}</div>
          <div class="b-card-metric">${b.keyMetric}</div>
          <div class="b-card-moat" title="护城河说明">${b.moatSummary}</div>
          <div class="b-card-action">[详情]</div>
        </div>
      `;
    }).join('');

    const selectedB = this._selectedBModuleId ? State.getBModuleById(this._selectedBModuleId) : null;

    return `
      <section class="fallback-section" data-section="b-modules">
        <div class="fallback-section-head">
          <h3>🟡 分区 2: B1-B12 自研护城河模块矩阵 <span class="section-spec-tag">FinTrust Hub 独有创新</span></h3>
          <div class="fallback-section-tip">点击卡片 → 联动规则 4.13 输出护城河演示日志 + 高亮在其他 Tab 的体现位置</div>
        </div>
        <div class="b-grid">
          ${cards}
        </div>
        ${selectedB ? this._renderBModuleDetailPanel(selectedB) : ''}
        <div class="fallback-section-foot">
          护城河说明: 这些模块行业普遍没有,是 FinTrust Hub 独有创新 — 这是 72% 工时投入的核心竞争力所在
        </div>
      </section>
    `;
  },

  _renderBModuleDetailPanel(b) {
    return `
      <div class="b-detail-panel" style="border:1px solid var(--accent-orange);background:rgba(255,152,0,0.04);border-radius:8px;padding:14px 16px;margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:15px;font-weight:700;color:var(--accent-orange)">${b.id} ${b.name}</div>
            <div style="font-size:11px;color:var(--text-muted)">Spec 引用: ${b.specRef}</div>
          </div>
          <button class="ai-modal-close" onclick="ViewFallback._closeBModuleDetail()" title="关闭">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px;color:var(--text-primary)">
          <div><b>关键指标:</b> ${b.keyMetric}</div>
          <div><b>状态:</b> <span style="color:var(--accent-green)">${b.status}</span></div>
        </div>
        <div style="margin-top:10px;padding:10px;background:rgba(210,153,34,0.12);border-radius:6px;font-size:12px;color:var(--text-primary)">
          <div style="font-weight:700;color:var(--accent-orange);margin-bottom:4px">🏰 护城河说明</div>
          ${b.moatSummary}
        </div>
        <div style="margin-top:10px;padding:10px;background:#e3f2ff;border-radius:6px;font-size:12px;color:var(--text-primary)">
          <div style="font-weight:700;color:#2196f3;margin-bottom:4px">📍 在其他 Tab 的体现位置</div>
          ${b.embodiedIn}
        </div>
      </div>
    `;
  },

  _selectBModule(bId) {
    this._selectedBModuleId = bId;
    State.selectBModule(bId); // 触发 4.13 联动规则
  },
  _closeBModuleDetail() {
    this._selectedBModuleId = null;
    State._notify();
  },

  // === 🟣 分区 2b: R1-R10 改造引擎矩阵 (v5.0 新增, simulation-plan 自研档 R 层) ===
  _renderRModulesSection() {
    const engines = MockData.REFORM_ENGINES || {};
    const engineRuntime = State.reformEngine ? State.reformEngine.engineStatus : {};
    const ordered = ['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10'];
    const cards = ordered.map(id => {
      const e = engines[id];
      if (!e) return '';
      const rt = engineRuntime[id] || { status:'idle', lastRunAt:null, result:null };
      const statusLabel = rt.status === 'completed' ? '✅ 已运行'
        : rt.status === 'active' || rt.status === 'running' ? '⚡ 运行中'
        : rt.status === 'replanning_scheduled' ? '🔄 重规划中'
        : rt.status === 'refreshed' || rt.status === 'boundary_updated' ? '🔧 边界刷新'
        : rt.status === 'retry_scheduled' ? '⏱ 待重试'
        : rt.status === 'manual_intervention_required' ? '🔴 需人工'
        : rt.status === 'failed' ? '❌ 失败'
        : '⏸ 待命';
      const statusColor = rt.status === 'completed' || rt.status === 'active' ? '#10b981'
        : rt.status === 'failed' || rt.status === 'manual_intervention_required' ? '#ef4444'
        : rt.status === 'refreshed' || rt.status === 'boundary_updated' || rt.status === 'replanning_scheduled' ? '#f59e0b'
        : '#8b949e';
      return `
        <div class="b-card" style="border-left:4px solid ${e.color || '#8b5cf6'}" title="simulation-plan.md 二补.3 R1-R10 引擎定义 · 点击引擎 ID 跳转到 Tab0 改造工作台体验">
          <div class="b-card-head">
            <span class="b-card-id" style="color:${e.color}">${e.id}</span>
            <span class="b-card-status" style="color:${statusColor}">${statusLabel}</span>
          </div>
          <div class="b-card-name">${e.name}</div>
          <div class="b-card-metric">${e.keyMetric}</div>
          <div class="b-card-moat" title="护城河说明">${e.desc}</div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--text-muted)">
            <span>输入: ${(e.inputs||[]).length} 项</span>
            <span>输出: ${(e.outputs||[]).length} 项</span>
            <button class="btn-mini" onclick="App.switchTab('reform')" style="font-size:10px;padding:2px 6px">→ Tab0 体验</button>
          </div>
        </div>
      `;
    }).join('');

    // 汇总: 各引擎的核心职责，对应 simulation-plan 二补.3 表格
    const summary = [
      ['画像+诊断(R1+R2)', '采集8维数据，反向对标银行准入要求，识别硬缺口/可修复项'],
      ['方案+调度(R3+R4)', '约束求解生成3条改造路径，按DAG+关键路径调度任务'],
      ['执行+重排(R5+R6)', '8类执行器(L2-L4)执行，失败任务自动拆分3路并行重跑'],
      ['合规+进度(R7+R8)', '红6条/灰5条/绿6条零幻觉边界，关键里程碑预警提前3天'],
      ['银行+学习(R9+R10)', '改造中/后实时匹配银行产品，入库案例持续蒸馏提升精度']
    ];

    return `
      <section class="fallback-section" data-section="r-modules">
        <div class="fallback-section-head">
          <h3>🟣 分区 2b: R1-R10 改造引擎矩阵 (v5.0 自研档 R 层) <span class="section-spec-tag">simulation-plan 二补.3</span></h3>
          <div class="fallback-section-tip">
            这是 FinTrust Hub v5.0 的最核心能力 — 把"有潜力但不合规"的企业改造为银行可准入主体，全链路 10 个 AI 引擎零幻觉运行
            <button class="btn-mini" style="margin-left:12px" onclick="App.switchTab('reform')">🚀 去 Tab0 体验完整改造流水线</button>
          </div>
        </div>
        <!-- R1-R10 能力概览 5 个组合（便于快速理解闭环） -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px">
          ${summary.map(([pair,desc]) => `
            <div style="padding:8px 10px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:6px">
              <div style="font-size:12px;font-weight:700;color:#a78bfa;margin-bottom:3px">${pair}</div>
              <div style="font-size:11px;color:var(--text-secondary);line-height:1.3">${desc}</div>
            </div>
          `).join('')}
        </div>
        <!-- R1-R10 10 张引擎卡片 (2行5列网格, 对齐 B 模块样式) -->
        <div class="b-grid">
          ${cards}
        </div>
        <div class="fallback-section-foot">
          v5.0 定位升级: 系统从"融资撮合平台"升级为"企业改造+融资撮合一体化平台"，改造引擎是 FinTrust Hub 的"第一层护城河能力"
        </div>
      </section>
    `;
  },

  // === 🔴 分区 3: C1-C7 兜底子模块 + 降级链可视化 ===
  _renderCModulesSection() {
    const cs = State.fallbackEngine.modules;
    const summary = FallbackEngine.getFallbackChainSummary();
    const cards = cs.map(c => {
      const vis = FallbackEngine.getCModuleStatusVisual(c);
      const api = State.getApiById(c.relatedApi);
      const apiVis = api ? FallbackEngine.getApiStatusVisual(api) : null;
      const isHighlighted = State._highlightCModuleId === c.id;
      const isExpanded = this._expandedCModuleId === c.id;
      return `
        <div class="c-card ${isExpanded ? 'c-card-expanded' : ''} ${isHighlighted ? 'c-card-highlight' : ''}" style="background:${vis.bgColor};${isHighlighted ? 'box-shadow:0 0 0 3px var(--accent-purple)' : ''}">
          <div class="c-card-head" onclick="ViewFallback._toggleCModuleDetail('${c.id}')" style="cursor:pointer">
            <span style="font-size:14px">${vis.icon}</span>
            <span class="c-card-id">${c.id}</span>
            <span class="c-card-name">${c.name}</span>
            <span class="c-card-status" style="color:${vis.color}">${vis.label}</span>
          </div>
          <div class="c-card-related">← ${api ? `${api.id} ${api.name}` : '无关联 API'} <span style="color:${apiVis ? apiVis.color : 'var(--text-muted)'}">${apiVis ? apiVis.label : ''}</span></div>
          <div class="c-card-spec" style="font-size:10px;color:var(--text-muted)">${c.specRef}</div>
          <div class="c-card-services" title="服务能力">${c.servicesProvided}</div>
          <div class="c-card-bounds" title="能力边界">${c.capabilityBounds}</div>
          <div class="c-card-actions">
            ${c.enabled
              ? (c.status === 'standby'
                  ? `<button class="btn-mini btn-warning" onclick="State.activateFallbackModule('${c.id}')" title="手动激活此兜底子模块">⚡ 手动激活</button>`
                  : `<button class="btn-mini" onclick="State.deactivateFallbackModule('${c.id}')" title="手动休眠此兜底子模块(若关联 API 已恢复)">⏸ 手动休眠</button>`)
              : '<span style="font-size:10px;color:var(--text-muted)">已禁用</span>'
            }
            <button class="btn-mini" onclick="ViewFallback._generateFallbackReport('${c.id}')" title="生成兜底报告(强制带 ⚠️ 自营兜底标注 + 能力边界明示)">📄 生成报告</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <section class="fallback-section" data-section="c-modules">
        <div class="fallback-section-head">
          <h3>🔴 分区 3: C1-C7 兜底子模块状态 + 兜底降级链 <span class="section-spec-tag">MOD-15</span></h3>
          <div class="fallback-section-actions">
            <button class="btn btn-sm btn-warning" onclick="ViewFallback._batchActivateAllCModules()" title="批量激活 C1-C7 (不切换独立运行模式)">⚡ 批量激活 C1-C7</button>
            <button class="btn btn-sm" style="background:var(--accent-purple);color:#fff" onclick="FallbackEngine.confirmThenToggleIndependentMode(true)" title="一键切换至独立运行模式 → 强制所有 API 断开 + C1-C7 全部激活(阻塞式二次确认)">🟣 一键切独立运行模式</button>
          </div>
        </div>
        ${this._renderFallbackChainVisualization(summary)}
        <div class="c-grid">
          ${cards}
        </div>
        <div class="fallback-section-foot">
          兜底降级链: 1.API接入 → 2.C兜底 → 3.独立运行 → 4.拒绝服务 — 单个 API 断开会自动激活对应 C 模块(升至 2 级);切换独立运行模式升至 3 级
        </div>
      </section>
    `;
  },

  // === 兜底降级链可视化 ===
  _renderFallbackChainVisualization(summary) {
    const levels = MockData.FALLBACK_CHAIN_LEVELS;
    const current = summary.currentLevel;
    const chain = [1, 2, 3, 4].map(lv => {
      const def = levels[lv];
      const isCurrent = lv === current;
      const isPast = lv < current;
      const bg = isCurrent ? `background:${def.color};color:#fff` : isPast ? `background:rgba(76,175,80,0.10);color:${def.color}` : `background:var(--bg-tertiary);color:var(--text-muted)`;
      return `
        <div class="chain-node ${isCurrent ? 'chain-current' : ''}" style="${bg}" title="${def.desc}">
          <div style="font-size:18px">${def.icon}</div>
          <div style="font-size:12px;font-weight:700">${lv}级</div>
          <div style="font-size:11px">${def.label}</div>
          ${isCurrent ? '<div style="font-size:10px;margin-top:2px">▶ 当前</div>' : ''}
        </div>
      `;
    }).join('');
    return `
      <div class="fallback-chain-vis" style="display:flex;align-items:center;gap:6px;padding:10px;background:var(--bg-tertiary);border-radius:8px;margin-bottom:12px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--text-muted);margin-right:6px">兜底降级链:</div>
        ${chain}
      </div>
    `;
  },

  _toggleCModuleDetail(cId) {
    this._expandedCModuleId = this._expandedCModuleId === cId ? null : cId;
    State._notify();
  },

  _batchActivateAllCModules() {
    State.fallbackEngine.modules.forEach(m => {
      if (m.enabled && m.status !== 'active') {
        State.activateFallbackModule(m.id);
      }
    });
  },

  _generateFallbackReport(cId) {
    const report = FallbackEngine.buildFallbackReportView(cId);
    if (!report) return;
    const reportHtml = `
      <div style="border:2px solid var(--accent-red);background:rgba(244,67,54,0.04);border-radius:8px;padding:14px 16px;margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--accent-red)">📄 兜底报告 ${report.reportId}</div>
            <div style="font-size:11px;color:var(--text-muted)">生成时间: ${report.generatedAt} · ${report.cModuleId} ${report.cModuleName} · 关联 ${report.relatedApi ? report.relatedApi.id + ' (' + report.relatedApi.status + ')' : '无'}</div>
          </div>
          <button class="ai-modal-close" onclick="ViewFallback._closeFallbackReport()" title="关闭">✕</button>
        </div>
        <div style="background:rgba(248,81,73,0.12);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:12px;color:var(--accent-red);font-weight:700">
          ⚠️ ${report.tag}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
          <div style="padding:8px;background:rgba(63,185,80,0.12);border-radius:4px;font-size:12px">
            <div style="font-weight:700;color:var(--accent-green);margin-bottom:4px">✅ 服务能力 (含)</div>
            ${report.capabilities}
          </div>
          <div style="padding:8px;background:rgba(248,81,73,0.12);border-radius:4px;font-size:12px">
            <div style="font-weight:700;color:var(--accent-red);margin-bottom:4px">❌ 能力边界 (不含)</div>
            ${report.bounds}
          </div>
        </div>
        <div style="margin-top:8px;padding:8px;background:rgba(210,153,34,0.12);border-radius:4px;font-size:12px;color:var(--text-secondary)">
          💡 建议: ${report.suggestion}
        </div>
      </div>
    `;
    this._currentFallbackReport = reportHtml;
    State._notify();
  },
  _closeFallbackReport() {
    this._currentFallbackReport = null;
    State._notify();
  },

  // === 🟣 分区 4: 独立运行模式控制面板 (S3 修正) ===
  _renderIndependentModeSection() {
    const ind = State.fallbackEngine.independentMode;
    const summary = FallbackEngine.getFallbackChainSummary();
    return `
      <section class="fallback-section" data-section="independent-mode" style="border-left:4px solid var(--accent-purple)">
        <div class="fallback-section-head">
          <h3>🟣 分区 4: 独立运行模式控制面板 <span class="section-spec-tag">S3 修正 + CORE-03</span></h3>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;padding:14px;background:${ind.enabled ? 'rgba(156,39,176,0.06)' : 'var(--bg-tertiary)'};border-radius:8px">
          <div style="display:flex;align-items:center;gap:14px">
            <span style="font-size:13px;color:var(--text-primary)">独立运行模式:</span>
            <label class="toggle-switch">
              <input type="checkbox" ${ind.enabled ? 'checked' : ''} onchange="FallbackEngine.confirmThenToggleIndependentMode(this.checked)" />
              <span class="toggle-slider"></span>
            </label>
            <span style="font-size:12px;color:${ind.enabled ? 'var(--accent-purple)' : 'var(--text-muted)'};font-weight:700">${ind.enabled ? '已开启' : '已关闭'}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);display:grid;grid-template-columns:auto auto;gap:4px 12px">
            <span>当前状态:</span><b style="color:${ind.enabled ? 'var(--accent-purple)' : 'var(--accent-green)'}">${ind.enabled ? '独立运行模式' : '依赖外部 API 模式'}</b>
            <span>接入外部 API 数:</span><b>${summary.connectedApis}/${summary.totalApis}</b>
            <span>兜底子模块激活数:</span><b>${summary.activeFallbacks}/${summary.totalFallbacks}</b>
            <span>开启时间:</span><b>${ind.activatedAt ? new Date(ind.activatedAt).toLocaleString('zh-CN') : '—'}</b>
          </div>
        </div>
        ${ind.enabled ? this._renderIndependentModeServiceList() : ''}
        <div class="fallback-section-foot">
          开启独立运行模式 → 所有外部 API 强制断开 + C1-C7 全部激活 + 所有兜底报告统一标注"自营兜底·非外部机构背书" — 演示"零外部机构接入"场景下 FinTrust Hub 仍能独立提供价值
        </div>
      </section>
    `;
  },

  _renderIndependentModeServiceList() {
    const ind = State.fallbackEngine.independentMode;
    if (!ind.enabled) return '';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px">
        <div>
          <div style="font-weight:700;color:var(--accent-red);font-size:12px;margin-bottom:6px">❌ 已降级服务 (${ind.degradedServices.length} 项)</div>
          <ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text-secondary);line-height:1.7">
            ${ind.degradedServices.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
        <div>
          <div style="font-weight:700;color:var(--accent-green);font-size:12px;margin-bottom:6px">✅ 仍可提供服务 (${ind.availableServices.length} 项)</div>
          <ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text-secondary);line-height:1.7">
            ${ind.availableServices.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  },

  // === 📊 分区 5: 三档开发投入占比仪表盘 (S4+S7 修正) ===
  _renderTierInvestmentSection() {
    const view = FallbackEngine.getTierInvestmentView(this._tierMode);
    const rows = view.rows.map(r => `
      <tr style="background:${r.color}10">
        <td style="padding:8px 10px">
          <span style="display:inline-block;width:10px;height:10px;background:${r.color};border-radius:50%;margin-right:6px"></span>
          <b style="color:${r.color}">${r.label}</b>
        </td>
        <td style="padding:8px 10px;text-align:right">${r.value}${view.unit}</td>
        <td style="padding:8px 10px;text-align:right"><b>${r.percentage}%</b></td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">${r.desc}</td>
      </tr>
    `).join('');

    const echartsData = view.rows.map(r => ({ value: r.percentage, name: r.label, itemStyle: { color: r.color } }));

    return `
      <section class="fallback-section" data-section="tier-investment">
        <div class="fallback-section-head">
          <h3>📊 分区 5: 三档开发投入占比仪表盘 <span class="section-spec-tag">S4+S7 修正</span></h3>
          <div class="fallback-section-actions">
            <div class="tier-mode-tabs">
              ${['modules', 'hours', 'percentage'].map(m => `
                <button class="tier-mode-tab ${this._tierMode === m ? 'active' : ''}" onclick="ViewFallback._setTierMode('${m}')" title="按${m === 'modules' ? '模块数' : m === 'hours' ? '工时' : '百分比'}重绘仪表盘">
                  ${m === 'modules' ? '按模块数' : m === 'hours' ? '按工时' : '按百分比'}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px">
          <div>
            <table class="tier-table" style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:var(--bg-tertiary);color:var(--text-muted)">
                  <th style="padding:8px 10px;text-align:left">档位</th>
                  <th style="padding:8px 10px;text-align:right">${view.dimensionLabel}</th>
                  <th style="padding:8px 10px;text-align:right">占比</th>
                  <th style="padding:8px 10px;text-align:left">说明</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:10px;padding:12px;background:rgba(210,153,34,0.12);border-radius:6px;font-size:11px;color:var(--text-secondary);border-left:3px solid var(--accent-orange)">
              <b style="color:var(--accent-orange)">设计哲学:</b> ${view.philosophy}
            </div>
          </div>
          <div id="tier-echarts" style="width:100%;height:240px;display:flex;align-items:center;justify-content:center"></div>
        </div>
        <div class="fallback-section-foot">
          为什么要按维度切换? 按"工时"模式时,自研档 1280 工时 (72%) 直观说明 B1-B12 是核心投入;按"模块数"时三档差距缩小;按"百分比"是默认报告视图
        </div>
      </section>
    `;
  },

  _setTierMode(mode) {
    this._tierMode = mode;
    State.setTierDashboardMode(mode);
  },

  // === C 模块详情侧栏(展开)===
  _renderCModuleDetailPanel() {
    if (!this._expandedCModuleId) return '';
    const c = State.getCModuleById(this._expandedCModuleId);
    if (!c) return '';
    const api = State.getApiById(c.relatedApi);
    const apiVis = api ? FallbackEngine.getApiStatusVisual(api) : null;
    return `
      <div class="c-detail-panel" style="position:fixed;right:20px;top:80px;width:380px;background:var(--bg-secondary);box-shadow:0 6px 18px rgba(0,0,0,0.15);border-radius:8px;padding:14px 16px;z-index:9400;border-top:4px solid var(--accent-orange)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--accent-orange)">${c.id} ${c.name}</div>
            <div style="font-size:11px;color:var(--text-muted)">Spec 引用: ${c.specRef}</div>
          </div>
          <button class="ai-modal-close" onclick="ViewFallback._toggleCModuleDetail('${c.id}')" title="关闭">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
          <div><b>状态:</b> <span style="color:${c.status === 'active' ? 'var(--accent-orange)' : 'var(--text-muted)'}">${c.status === 'active' ? '激活' : '待命'}</span></div>
          <div><b>关联外部 API:</b> ${api ? `${api.id} ${api.name}` : '无'} <span style="color:${apiVis ? apiVis.color : 'var(--text-muted)'}">(${apiVis ? apiVis.label : ''})</span></div>
          ${c.lastActivatedAt ? `<div><b>最后激活:</b> ${new Date(c.lastActivatedAt).toLocaleString('zh-CN')}</div>` : ''}
        </div>
        <div style="padding:8px;background:rgba(63,185,80,0.12);border-radius:4px;margin:6px 0;font-size:11px">
          <div style="font-weight:700;color:var(--accent-green);margin-bottom:3px">✅ 服务能力</div>
          ${c.servicesProvided}
        </div>
        <div style="padding:8px;background:rgba(248,81,73,0.12);border-radius:4px;margin:6px 0;font-size:11px">
          <div style="font-weight:700;color:var(--accent-red);margin-bottom:3px">❌ 能力边界</div>
          ${c.capabilityBounds}
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          ${c.status === 'standby'
            ? `<button class="btn-mini btn-warning" onclick="State.activateFallbackModule('${c.id}')" title="手动激活">⚡ 激活</button>`
            : `<button class="btn-mini" onclick="State.deactivateFallbackModule('${c.id}')" title="手动休眠">⏸ 休眠</button>`
          }
          <button class="btn-mini" onclick="ViewFallback._generateFallbackReport('${c.id}')" title="生成兜底报告">📄 生成报告</button>
        </div>
      </div>
    `;
  },

  // === 全局事件绑定 ===
  _bindEvents() {
    // 在渲染完成后初始化 ECharts 环形图
    setTimeout(() => this._renderEcharts(), 50);

    // 如果存在 fallback report,把它插入到 C 模块分区下方
    if (this._currentFallbackReport) {
      const cSection = document.querySelector('[data-section="c-modules"] .c-grid');
      if (cSection) {
        const wrap = document.createElement('div');
        wrap.innerHTML = this._currentFallbackReport;
        cSection.parentNode.insertBefore(wrap, cSection.nextSibling);
      }
    }
  },

  _renderEcharts() {
    const container = document.getElementById('tier-echarts');
    if (!container || typeof echarts === 'undefined') return;
    const view = FallbackEngine.getTierInvestmentView(this._tierMode);
    const chart = echarts.init(container);
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c}% ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 10, color: '#8b949e' } },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        label: { show: true, position: 'center', formatter: '三档\n投入', fontSize: 12, color: '#8b949e' },
        labelLine: { show: false },
        data: view.rows.map(r => ({ value: r.percentage, name: r.label, itemStyle: { color: r.color } }))
      }]
    });
  }
};

window.ViewFallback = ViewFallback;
