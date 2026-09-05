/**
 * fallback-engine.js — Tab8 独立兜底引擎控制台核心逻辑 (v4.3 新增)
 *
 * 职责:
 *   1. 暴露 State 中 v4.3 三档分类相关方法给 view-fallback.js 使用(避免直接调用 State 私有字段)
 *   2. 提供 API 状态切换的便捷封装 (toggleApiStatus / setApiStatus)
 *   3. 提供兜底降级链状态查询与可视化辅助 (getFallbackChainSummary)
 *   4. 提供独立运行模式切换的阻塞式 Modal 确认流程 (confirmThenToggleIndependentMode)
 *   5. 提供兜底报告生成的渲染数据 (buildFallbackReportView)
 *
 * 设计哲学: 该文件仅做"逻辑编排 + 视图数据准备",所有状态读写一律走 State,
 * 不缓存任何业务状态,避免出现两份状态源。
 */

const FallbackEngine = {
  // === 1. 便捷封装: 切换 API 状态 ===
  //   connected → disconnected: 触发对应 C 兜底子模块自动激活
  //   disconnected → connected: 仅记录日志,不自动关闭 C 模块(避免抖动)
  toggleApiStatus(apiId) {
    const api = State.getApiById(apiId);
    if (!api) return;
    const newStatus = api.status === 'connected' ? 'disconnected' : 'connected';
    State.handleApiStatusChange(apiId, newStatus);
  },

  setApiStatus(apiId, newStatus) {
    State.handleApiStatusChange(apiId, newStatus);
  },

  // === 2. 兜底降级链摘要 (供 view-fallback 渲染可视化用) ===
  getFallbackChainSummary() {
    const level = State.fallbackEngine.fallbackChain.currentLevel;
    const levelDef = MockData.FALLBACK_CHAIN_LEVELS[level] || MockData.FALLBACK_CHAIN_LEVELS[1];
    const events = State.fallbackEngine.fallbackChain.triggerEvents || [];
    return {
      currentLevel: level,
      levelLabel: levelDef.label,
      levelColor: levelDef.color,
      levelIcon: levelDef.icon,
      levelDesc: levelDef.desc,
      triggerEvents: events,
      connectedApis: State.getConnectedApiCount(),
      totalApis: State.externalApis.length,
      activeFallbacks: State.getActiveFallbackCount(),
      totalFallbacks: State.fallbackEngine.modules.length
    };
  },

  // === 3. 独立运行模式切换 — 阻塞式 Modal 二次确认 (S3 + CORE-04) ===
  //   切换至独立运行模式是不可逆操作(会强制所有 API 断开),必须用 Modal 二次确认
  confirmThenToggleIndependentMode(enabled) {
    if (enabled) {
      // 开启 → 紫色重度不可逆 Modal (使用独立渲染避免污染 AIModal 队列)
      this._showIndependentModeConfirmModal();
    } else {
      // 关闭 → 直接恢复 (可逆操作,无需二次确认)
      State.toggleIndependentMode(false);
      AIModal.toast({
        type: 'info',
        title: '已恢复依赖外部 API 模式',
        text: 'API 状态已恢复至切换前快照,C1-C7 兜底子模块重置为默认',
        color: 'blue',
        duration_ms: 5000
      });
    }
  },

  // === 3.1 内部: 独立运行模式确认 Modal (紫色重度不可逆) ===
  _showIndependentModeConfirmModal() {
    // 若已有同名 Modal 则不重复弹出
    if (document.getElementById('independent-mode-modal-overlay')) return;
    const degraded = MockData.INDEPENDENT_MODE_CAPABILITIES.degradedServices;
    const available = MockData.INDEPENDENT_MODE_CAPABILITIES.availableServices;
    const overlay = document.createElement('div');
    overlay.id = 'independent-mode-modal-overlay';
    overlay.className = 'ai-modal-overlay';
    overlay.innerHTML = `
      <div class="ai-modal-card" style="max-width:680px;border-top:4px solid var(--accent-purple)">
        <div class="ai-modal-header" style="border-left:4px solid var(--accent-purple);background:rgba(156,39,176,0.06)">
          <div class="ai-modal-title">
            <span style="font-size:20px">🟣</span>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--accent-purple)">确认切换至独立运行模式?</div>
              <div style="font-size:11px;color:var(--text-muted)">MOD-15 · 不可逆操作 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</div>
            </div>
          </div>
          <button class="ai-modal-close" onclick="FallbackEngine._closeIndependentModeModal()" title="取消">✕</button>
        </div>
        <div class="ai-modal-body">
          <div style="border:2px solid var(--accent-purple);background:rgba(156,39,176,0.06);border-radius:8px;padding:14px 16px;margin:8px 0">
            <div style="color:var(--accent-purple);font-weight:700;font-size:14px;margin-bottom:8px">⚠️ 不可逆操作 — 后果预览</div>
            <ul style="margin:0;padding-left:20px;color:var(--text-primary);font-size:12px;line-height:1.8">
              <li>所有 <b>15 个外部 API</b> 将被强制断开 (熔断器 forced_off)</li>
              <li><b>C1-C7 全部 7 个兜底子模块</b> 将被强制激活</li>
              <li>兜底降级链升至 <b>3 级 (独立运行)</b></li>
              <li><b>${degraded.length} 项服务降级</b>: ${degraded.slice(0, 3).join(' / ')} 等</li>
              <li><b>${available.length} 项服务仍可提供</b>: ${available.slice(0, 3).join(' / ')} 等</li>
              <li>所有兜底报告统一标注 "<b>自营兜底·非外部机构背书</b>"</li>
            </ul>
            <div style="margin-top:10px;font-size:11px;color:var(--text-secondary);background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.25);padding:6px 8px;border-radius:4px">
              💡 演示价值: 验证"零外部机构接入"场景下 FinTrust Hub 仍能独立提供价值
            </div>
          </div>
        </div>
        <div class="ai-modal-actions" style="justify-content:center">
          <button class="btn btn-sm" style="background:var(--text-muted);color:#fff" onclick="FallbackEngine._closeIndependentModeModal()" title="取消(保留当前状态)">取消</button>
          <button class="btn btn-sm" style="background:var(--accent-purple);color:#fff;font-weight:700" onclick="FallbackEngine._confirmIndependentMode()" title="确认开启(不可回退)">✓ 确认开启(不可回退)</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  _closeIndependentModeModal() {
    const overlay = document.getElementById('independent-mode-modal-overlay');
    if (overlay) overlay.remove();
  },
  _confirmIndependentMode() {
    this._closeIndependentModeModal();
    State.toggleIndependentMode(true);
    AIModal.toast({
      type: 'success',
      title: '独立运行模式已开启',
      text: '15 个外部 API 全部断开,C1-C7 兜底子模块全部激活',
      color: 'purple',
      duration_ms: 6500,
      actionLabel: '查看 Tab8 详情',
      onAction: () => { if (typeof App !== 'undefined') App.switchTab('fallback'); }
    });
  },

  // === 4. 兜底报告视图数据 (联动规则 4.14) ===
  buildFallbackReportView(cId) {
    const report = State.generateFallbackReport(cId);
    if (!report) return null;
    return {
      reportId: report.reportId,
      generatedAt: report.generatedAt,
      cModuleName: report.cModule.name,
      cModuleId: report.cModule.id,
      relatedApi: report.relatedApi,
      tag: report.tag,
      capabilities: report.capabilities,
      bounds: report.bounds,
      suggestion: report.suggestion,
      specRef: report.cModule.specRef,
      status: report.cModule.status
    };
  },

  // === 5. 三档投入仪表盘视图数据 (联动规则 4.15) ===
  getTierInvestmentView(mode) {
    const ti = State.tierInvestment;
    const dims = {
      modules:    { label: '模块数',  unit: '',   getValue: (d) => d.modules },
      hours:      { label: '工时',    unit: 'h',  getValue: (d) => d.hours },
      percentage: { label: '占比',    unit: '%',  getValue: (d) => d.percentage }
    };
    const dim = dims[mode] || dims.modules;
    return {
      mode,
      dimensionLabel: dim.label,
      unit: dim.unit,
      rows: [
        { key: 'apiAccess',     label: ti.apiAccess.label,     color: ti.apiAccess.color,     value: dim.getValue(ti.apiAccess),     percentage: ti.apiAccess.percentage,     desc: ti.apiAccess.desc },
        { key: 'selfDeveloped', label: ti.selfDeveloped.label, color: ti.selfDeveloped.color, value: dim.getValue(ti.selfDeveloped), percentage: ti.selfDeveloped.percentage, desc: ti.selfDeveloped.desc },
        { key: 'fallback',      label: ti.fallback.label,      color: ti.fallback.color,      value: dim.getValue(ti.fallback),      percentage: ti.fallback.percentage,      desc: ti.fallback.desc }
      ],
      total: ti.apiAccess.modules + ti.selfDeveloped.modules + ti.fallback.modules,
      philosophy: '不重复造轮子(API档),也不放弃独立运行能力(兜底档),把精力集中在独有创新(自研档)'
    };
  },

  // === 6. 辅助: 获取当前选中的 B 模块 (联动规则 4.13 详情侧栏用) ===
  getSelectedBModule() {
    const bId = State._selectedBModuleId;
    if (!bId) return null;
    return State.getBModuleById(bId);
  },

  // === 7. 辅助: 根据 view 名称推断应该高亮的 C 模块 (跨视图快捷入口) ===
  //   Tab1 企业端 → C7 替代征信兜底
  //   Tab2 流程模拟器 → C4 法律兜底 / C6 合同兜底
  //   Tab4 银行端 → C1 担保兜底 / C2 保险兜底
  //   Tab5 担保保险协作台 → C1 / C2
  //   Tab7 AI 驾驶舱 → C5 审计兜底
  getHighlightCModuleByView(viewName) {
    const map = {
      enterprise: 'C7',
      flow: 'C4',
      bank: 'C1',
      institution: 'C1',
      cockpit: 'C5',
      approval: 'C4',
      advisor: 'C10', // 无对应
      scf: 'C7' // v6.0: SCF 子系统对应 C7 数据自主兜底
    };
    return map[viewName] || null;
  },

  // === 8. 辅助: 获取 API 状态颜色与图标 ===
  getApiStatusVisual(api) {
    if (api.status === 'connected') {
      if (api.circuitState === 'half_open') {
        return { color: 'var(--accent-orange)', icon: '🟠', label: '半开' };
      }
      return { color: 'var(--accent-green)', icon: '🟢', label: '已接入' };
    }
    if (api.circuitState === 'forced_off') {
      return { color: 'var(--accent-purple)', icon: '🟣', label: '强制断开' };
    }
    return { color: 'var(--accent-red)', icon: '🔴', label: '断开' };
  },

  // === 9. 辅助: 获取 C 模块状态颜色与图标 ===
  getCModuleStatusVisual(cModule) {
    if (cModule.status === 'active') {
      return { color: 'var(--accent-orange)', icon: '🟠', label: '激活', bgColor: 'rgba(210,153,34,0.15)' };
    }
    return { color: 'var(--text-muted)', icon: '⚪', label: '待命', bgColor: 'rgba(110,118,129,0.15)' };
  },

  // === 10. 辅助: 获取 B 模块状态颜色与图标 ===
  getBModuleStatusVisual(bModule) {
    if (bModule.status === 'active') {
      return { color: 'var(--accent-green)', icon: '🟢', label: 'active' };
    }
    return { color: 'var(--text-muted)', icon: '⚪', label: 'standby' };
  },

  // === 11. 跳转到 Tab8 并高亮关联 C 模块 (跨视图快捷入口) ===
  jumpToTab8(highlightCId) {
    if (App && typeof App.switchTab === 'function') {
      App.switchTab('fallback');
    }
    if (highlightCId) {
      State._highlightCModuleId = highlightCId;
      setTimeout(() => { State._highlightCModuleId = null; }, 5000);
    }
  }
};

window.FallbackEngine = FallbackEngine;
