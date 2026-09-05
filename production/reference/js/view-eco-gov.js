/** 文件名：view-eco-gov.js 职责：ECO-08 政府背书催化剂视图,监管机构接入面板+脱敏报告生成器 */
//
// 模块定位: Tab ECO-08 监管/政府背书催化剂 控制台
// 对齐 spec.md L1804-1822 (Gherkin 场景) + checklist.md L1851-1858 (GOV.1-GOV.5)
//
// ============================================================================
// 视图布局:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ EG0 顶部控制台: 模块标题 + 调度启停 + 操作指引               │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EG1 监管机构接入面板 (2 家机构卡片 + 在线状态 + 推送节奏)     │
//   │   · 金融监管局卡片 (在线/离线切换 + 节奏切换 + 推送按钮)      │
//   │   · 工信局中小企业服务中心卡片 (同上)                         │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EG2 脱敏报告生成器 (一键生成 + 预览)                          │
//   │   · 生成按钮 + 脱敏合规声明 + 单户不可识别校验结果            │
//   │   · 报告内容: 接入企业数 / 行业分布 / 融资需求规模            │
//   │              改造进展 / 五流通过率分布 / 责任链完整度分布      │
//   │              信用健康指数趋势                                    │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EG3 推送历史时间线 (txId + 链式 hash + 接收机构 + 期数)       │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EG4 指导意见文件展示区 (生成文本 + 下载按钮)                  │
//   │   · 状态: none / pending / endorsed                          │
//   │   · 申请背书按钮 + 生成《指导意见》文本 + 下载                │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EG5 推荐标识状态卡片 ("XX 监管局推荐平台" 徽章)              │
//   └──────────────────────────────────────────────────────────────┘
// ============================================================================
//
// 深色主题: 全部使用 CSS 变量 (var(--bg-*) / var(--text-*) / var(--accent-*))
//           严禁浅色硬编码 (禁止 #ffffff / #000000 直接出现)

'use strict';

const EcoGovView = (() => {

  // ============================================================
  // 私有: 订阅清理 (Tab 切换时 unsubscribe 旧回调)
  // ============================================================
  let _unsubscribe = null;

  // ============================================================
  // 私有: 颜色映射 (深色主题 CSS 变量)
  // ============================================================
  function _statusColor(status) {
    switch (status) {
      case 'online':     return 'var(--accent-green)';
      case 'offline':   return 'var(--text-muted)';
      case 'endorsed':  return 'var(--accent-green)';
      case 'pending':   return 'var(--accent-orange)';
      case 'rejected':  return 'var(--accent-red)';
      default:          return 'var(--text-muted)';  // none
    }
  }

  function _scoreColor(score) {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 65) return 'var(--accent-blue)';
    if (score >= 50) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  function _scheduleLabel(sched) {
    return sched === 'monthly' ? '月推 (模拟 30s)' : '周推 (模拟 7s)';
  }

  function _endorseStatusLabel(status) {
    const map = { none: '未申请', pending: '审核中', endorsed: '已背书', rejected: '已驳回' };
    return map[status] || status;
  }

  // ============================================================
  // 私有: 顶部控制台 (EG0)
  // ============================================================
  function _renderTopConsole() {
    const regs = (typeof EcoGov !== 'undefined') ? EcoGov.regulators() : [];
    const onlineCount = regs.filter(r => r.status === 'online').length;
    const endorsedCount = regs.filter(r => r.endorsementStatus === 'endorsed').length;
    const recommended = (typeof EcoGov !== 'undefined') ? EcoGov.isRecommended() : { recommended: false };

    return `
      <div class="eco-gov-top-console">
        <div class="eco-gov-title-row">
          <div class="eco-gov-title">
            <span class="eco-gov-title-icon">🏛</span>
            <span>ECO-08 政府背书催化剂</span>
            <span class="eco-gov-subtitle">主动对接金融监管局/工信局, 免费推送脱敏报告, 换取《指导意见》背书, 降低信任门槛</span>
          </div>
          <div class="eco-gov-top-stats">
            <span class="eco-gov-stat-pill" style="color:var(--accent-green);border-color:var(--accent-green)">在线 ${onlineCount}/${regs.length}</span>
            <span class="eco-gov-stat-pill" style="color:var(--accent-purple);border-color:var(--accent-purple)">背书 ${endorsedCount}/${regs.length}</span>
            ${recommended.recommended
              ? `<span class="eco-gov-stat-pill" style="color:var(--accent-green);border-color:var(--accent-green);background:rgba(63,185,80,0.1)">★ 已获推荐</span>`
              : `<span class="eco-gov-stat-pill" style="color:var(--text-muted);border-color:var(--text-muted)">未获推荐</span>`}
          </div>
        </div>
        <div class="eco-gov-actions">
          <button id="eco-gov-btn-start-all" class="eco-gov-btn eco-gov-btn-primary" title="启动全部在线监管机构的推送调度定时器 (weekly=7s / monthly=30s)">▶ 启动自动推送</button>
          <button id="eco-gov-btn-stop-all" class="eco-gov-btn" title="停止全部推送调度定时器">■ 停止自动推送</button>
          <button id="eco-gov-btn-reset" class="eco-gov-btn eco-gov-btn-warn" title="重置全部状态 (调试用, 会清空推送历史和背书状态)">↻ 重置</button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 监管机构卡片 (EG1)
  // ============================================================
  function _renderRegulatorCard(reg) {
    const statusColor = _statusColor(reg.status);
    const endColor = _statusColor(reg.endorsementStatus);
    const schedLabel = _scheduleLabel(reg.pushSchedule);

    const lastPush = reg.lastPushAt
      ? new Date(reg.lastPushAt).toLocaleString('zh-CN', { hour12: false })
      : '尚未推送';

    return `
      <div class="eco-gov-reg-card" data-reg-id="${reg.id}" style="border-left-color:${reg.status === 'online' ? 'var(--accent-green)' : 'var(--text-muted)'}">
        <div class="eco-gov-reg-head">
          <div class="eco-gov-reg-name">
            <span class="eco-gov-reg-type-tag" style="color:${statusColor};border-color:${statusColor}">${reg.typeLabel}</span>
            <b style="color:var(--text-primary)">${reg.shortName}</b>
          </div>
          <div class="eco-gov-reg-status">
            <span class="eco-gov-dot" style="background:${statusColor}"></span>
            <span style="color:${statusColor}">${reg.status === 'online' ? '在线' : '离线'}</span>
          </div>
        </div>
        <div class="eco-gov-reg-fullname" style="color:var(--text-muted)">${reg.fullName}</div>
        <div class="eco-gov-reg-meta">
          <div class="eco-gov-reg-meta-item">
            <span class="eco-gov-meta-label">通道:</span>
            <span style="color:var(--text-secondary)">${reg.channel}</span>
          </div>
          <div class="eco-gov-reg-meta-item">
            <span class="eco-gov-meta-label">推送节奏:</span>
            <span style="color:var(--accent-blue)">${schedLabel}</span>
            <select class="eco-gov-sched-select" data-reg-id="${reg.id}" title="切换推送节奏: 周推(7s)/月推(30s)">
              <option value="weekly" ${reg.pushSchedule === 'weekly' ? 'selected' : ''}>周推</option>
              <option value="monthly" ${reg.pushSchedule === 'monthly' ? 'selected' : ''}>月推</option>
            </select>
          </div>
          <div class="eco-gov-reg-meta-item">
            <span class="eco-gov-meta-label">累计推送:</span>
            <span style="color:var(--text-primary)">${reg.pushedCount || 0} 次</span>
          </div>
          <div class="eco-gov-reg-meta-item">
            <span class="eco-gov-meta-label">最近推送:</span>
            <span style="color:var(--text-secondary)">${lastPush}</span>
          </div>
        </div>
        <div class="eco-gov-reg-endorse">
          <span class="eco-gov-meta-label">背书状态:</span>
          <span class="eco-gov-badge" style="color:${endColor};border-color:${endColor}">${_endorseStatusLabel(reg.endorsementStatus)}</span>
          ${reg.endorsementStatus === 'endorsed' && reg.endorsedAt
            ? `<span style="color:var(--text-muted);font-size:11px">出具于 ${new Date(reg.endorsedAt).toLocaleDateString('zh-CN')}</span>`
            : ''}
        </div>
        <div class="eco-gov-reg-actions">
          <button class="eco-gov-btn eco-gov-btn-mini" data-action="toggle-status" data-reg-id="${reg.id}"
                  title="${reg.status === 'online' ? '切换为离线' : '切换为在线'}">
            ${reg.status === 'online' ? '⏸ 设为离线' : '▶ 设为在线'}
          </button>
          <button class="eco-gov-btn eco-gov-btn-mini eco-gov-btn-primary" data-action="push" data-reg-id="${reg.id}"
                  ${reg.status !== 'online' ? 'disabled' : ''}
                  title="立即推送一次脱敏报告给该机构">
            📤 立即推送
          </button>
          <button class="eco-gov-btn eco-gov-btn-mini" data-action="request-endorse" data-reg-id="${reg.id}"
                  title="申请《指导意见》背书 (需至少推送过 1 次报告)">
            ${reg.endorsementStatus === 'endorsed' ? '✓ 已获背书' : (reg.endorsementStatus === 'pending' ? '⏳ 审核中 (点击模拟通过)' : '📜 申请背书')}
          </button>
        </div>
      </div>
    `;
  }

  function _renderRegulatorsPanel() {
    const regs = (typeof EcoGov !== 'undefined') ? EcoGov.regulators() : [];
    if (!regs.length) {
      return `<div class="eco-gov-empty">尚未配置监管机构</div>`;
    }
    return `
      <div class="eco-gov-section">
        <div class="eco-gov-section-title">
          <span class="eco-gov-section-icon">🏛</span>
          <span>EG1 监管机构接入面板 (GOV.1)</span>
          <span class="eco-gov-section-hint" style="color:var(--text-muted)">2 家机构 · 在线状态可切换 · 推送节奏可配置</span>
        </div>
        <div class="eco-gov-reg-grid">
          ${regs.map(_renderRegulatorCard).join('')}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 脱敏报告生成器 (EG2)
  // ============================================================
  function _renderReportBuilder(report) {
    const check = report && report.desensitizationCheck;
    const checkBadge = check
      ? (check.passed
          ? `<span class="eco-gov-badge" style="color:var(--accent-green);border-color:var(--accent-green)">✓ 单户不可识别</span>`
          : `<span class="eco-gov-badge" style="color:var(--accent-red);border-color:var(--accent-red)">✗ 脱敏校验失败</span>`)
      : `<span class="eco-gov-badge" style="color:var(--text-muted);border-color:var(--text-muted)">未生成</span>`;

    return `
      <div class="eco-gov-section">
        <div class="eco-gov-section-title">
          <span class="eco-gov-section-icon">📊</span>
          <span>EG2 脱敏报告生成器 (GOV.2 + GOV.3)</span>
          <span class="eco-gov-section-hint" style="color:var(--text-muted)">辖区中小微企业经营脉搏脱敏报告</span>
        </div>
        <div class="eco-gov-builder-actions">
          <button id="eco-gov-btn-build-report" class="eco-gov-btn eco-gov-btn-primary" title="基于 window.State.enterprises 聚合统计, 生成脱敏报告">🔧 一键生成脱敏报告</button>
          ${checkBadge}
        </div>
        ${report ? _renderReportContent(report) : `<div class="eco-gov-empty">点击上方按钮生成报告 (基于 State.enterprises 聚合脱敏)</div>`}
      </div>
    `;
  }

  // ============================================================
  // 私有: 报告内容 (EG2 子区域)
  // ============================================================
  function _renderReportContent(report) {
    const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
    const fmtYuan = (n) => '¥' + fmt(n);

    // 1. 接入企业数 + 行业分布
    const industryRows = (report.industryDistribution || []).map(r => `
      <tr>
        <td style="color:var(--text-primary)">${r.industry}</td>
        <td style="color:var(--accent-blue)">${r.count}</td>
        <td style="color:var(--text-secondary)">${fmtYuan(r.aggregateAmount)}</td>
      </tr>
    `).join('');

    // 2. 融资需求规模分布
    const needRows = (report.financingNeedScale && report.financingNeedScale.distribution || []).map(r => `
      <tr>
        <td style="color:var(--text-primary)">${r.bucket}</td>
        <td style="color:var(--accent-blue)">${r.count}</td>
      </tr>
    `).join('');

    // 3. 改造进展
    const rp = report.reformProgress || {};
    const reformRows = [
      { label: '待改造', count: rp.pending || 0, color: 'var(--text-muted)' },
      { label: '改造中', count: rp.in_progress || 0, color: 'var(--accent-orange)' },
      { label: '已完成', count: rp.completed || 0, color: 'var(--accent-green)' }
    ].map(r => `
      <tr>
        <td style="color:${r.color}">${r.label}</td>
        <td style="color:var(--text-primary)">${r.count}</td>
      </tr>
    `).join('');

    // 4. 五流通过率分布
    const fiveRows = (report.fiveFlowPassDistribution || []).map(r => `
      <tr>
        <td style="color:var(--text-primary)">${r.bucket}</td>
        <td style="color:var(--accent-blue)">${r.count}</td>
      </tr>
    `).join('');

    // 5. 责任链完整度分布
    const chainRows = (report.chainIntegrityDistribution || []).map(r => `
      <tr>
        <td style="color:var(--text-primary)">${r.bucket}</td>
        <td style="color:var(--accent-purple)">${r.count}</td>
      </tr>
    `).join('');

    // 6. 信用健康指数趋势 (近 6 期)
    const idx = report.creditHealthIndex || { current: 0, trend: [] };
    const idxColor = _scoreColor(idx.current);
    const trendRows = (idx.trend || []).map((t, i) => `
      <tr>
        <td style="color:var(--text-muted)">${i + 1}</td>
        <td style="color:var(--text-secondary)">${t.period}</td>
        <td style="color:${_scoreColor(t.index)}">${t.index}</td>
      </tr>
    `).join('');

    // 7. 脱敏合规声明
    const ds = report.desensitization || {};

    return `
      <div class="eco-gov-report">
        <div class="eco-gov-report-head">
          <div>
            <div class="eco-gov-report-title">${report.title}</div>
            <div class="eco-gov-report-meta">
              <span>报告期: <b style="color:var(--accent-blue)">${report.period}</b></span>
              <span>生成时间: <span style="color:var(--text-secondary)">${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span></span>
              <span>报告 ID: <code style="color:var(--accent-purple)">${report.reportId}</code></span>
            </div>
          </div>
          <div class="eco-gov-report-fingerprint" title="报告指纹 (SHA-256)">
            <span style="color:var(--text-muted)">fingerprint:</span>
            <code style="color:var(--accent-cyan)">${(report.fingerprint || '').slice(0, 24)}...</code>
          </div>
        </div>

        <div class="eco-gov-report-grid">
          <div class="eco-gov-report-card">
            <div class="eco-gov-report-card-title">接入企业数</div>
            <div class="eco-gov-report-big" style="color:var(--accent-blue)">${report.enterpriseCount}<span class="eco-gov-unit">户</span></div>
          </div>
          <div class="eco-gov-report-card">
            <div class="eco-gov-report-card-title">融资需求总额 (聚合)</div>
            <div class="eco-gov-report-big" style="color:var(--accent-orange)">${fmtYuan(report.financingNeedScale && report.financingNeedScale.totalAmount)}</div>
            <div class="eco-gov-report-sub" style="color:var(--text-muted)">户均 ${fmtYuan(report.financingNeedScale && report.financingNeedScale.averageAmount)}</div>
          </div>
          <div class="eco-gov-report-card">
            <div class="eco-gov-report-card-title">信用健康指数</div>
            <div class="eco-gov-report-big" style="color:${idxColor}">${idx.current}</div>
            <div class="eco-gov-report-sub" style="color:var(--text-muted)">FinTrust 指数 v3.1</div>
          </div>
        </div>

        <div class="eco-gov-tables">
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">行业分布 (GOV.2)</div>
            <table class="eco-gov-table">
              <thead><tr><th>行业</th><th>户数</th><th>聚合需求</th></tr></thead>
              <tbody>${industryRows || `<tr><td colspan="3" style="color:var(--text-muted)">无数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">融资需求规模分布</div>
            <table class="eco-gov-table">
              <thead><tr><th>区间</th><th>户数</th></tr></thead>
              <tbody>${needRows || `<tr><td colspan="2" style="color:var(--text-muted)">无数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">改造进展统计 (GOV.2)</div>
            <table class="eco-gov-table">
              <thead><tr><th>阶段</th><th>户数</th></tr></thead>
              <tbody>${reformRows}</tbody>
            </table>
          </div>
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">五流验证通过率分布 (GOV.2)</div>
            <table class="eco-gov-table">
              <thead><tr><th>通过率区间</th><th>户数</th></tr></thead>
              <tbody>${fiveRows || `<tr><td colspan="2" style="color:var(--text-muted)">无数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">责任链完整度分布 (GOV.2)</div>
            <table class="eco-gov-table">
              <thead><tr><th>完整度区间</th><th>户数</th></tr></thead>
              <tbody>${chainRows || `<tr><td colspan="2" style="color:var(--text-muted)">无数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="eco-gov-table-block">
            <div class="eco-gov-table-title">信用健康指数趋势 (近 6 期, GOV.2)</div>
            <table class="eco-gov-table">
              <thead><tr><th>#</th><th>期</th><th>指数</th></tr></thead>
              <tbody>${trendRows || `<tr><td colspan="3" style="color:var(--text-muted)">无数据</td></tr>`}</tbody>
            </table>
          </div>
        </div>

        <div class="eco-gov-desens-block" style="border-color:var(--accent-green)">
          <div class="eco-gov-desens-title">脱敏合规声明 (GOV.3)</div>
          <div class="eco-gov-desens-text">${ds.compliance || '—'}</div>
          <div class="eco-gov-desens-regs">
            ${(ds.regulations || []).map(r => `<span class="eco-gov-badge" style="color:var(--accent-purple);border-color:var(--accent-purple)">${r}</span>`).join('')}
            <span class="eco-gov-badge" style="color:${ds.singleEntityIdentifiable === false ? 'var(--accent-green)' : 'var(--accent-red)'};border-color:currentColor">
              单户可识别: ${ds.singleEntityIdentifiable === false ? '否' : '是'}
            </span>
          </div>
          <div class="eco-gov-desens-removed">
            <span style="color:var(--text-muted)">已移除字段:</span>
            <code style="color:var(--text-secondary)">${(ds.rawFieldsRemoved || []).join(' · ')}</code>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 推送历史时间线 (EG3)
  // ============================================================
  function _renderHistoryTimeline() {
    const hist = (typeof EcoGov !== 'undefined') ? EcoGov.getReportHistory({ limit: 50 }) : [];
    if (!hist.length) {
      return `
        <div class="eco-gov-section">
          <div class="eco-gov-section-title">
            <span class="eco-gov-section-icon">🕒</span>
            <span>EG3 推送历史时间线</span>
          </div>
          <div class="eco-gov-empty">尚无推送记录 (点击 EG1 "立即推送" 或启动自动推送)</div>
        </div>
      `;
    }

    const items = hist.map(r => {
      const d = new Date(r.pushedAt);
      const time = d.toLocaleString('zh-CN', { hour12: false });
      return `
        <div class="eco-gov-timeline-item">
          <div class="eco-gov-timeline-dot" style="background:var(--accent-green)"></div>
          <div class="eco-gov-timeline-content">
            <div class="eco-gov-timeline-head">
              <span class="eco-gov-timeline-time">${time}</span>
              <span class="eco-gov-timeline-reg">${r.regulatorName}</span>
              <span class="eco-gov-badge" style="color:var(--accent-green);border-color:var(--accent-green)">${r.status}</span>
            </div>
            <div class="eco-gov-timeline-meta">
              <span>报告期: <b style="color:var(--accent-blue)">${r.period}</b></span>
              <span>企业数: <b style="color:var(--text-primary)">${r.enterpriseCount}</b></span>
              <span>信用健康指数: <b style="color:var(--accent-purple)">${r.creditHealthIndex}</b></span>
              <span>聚合融资额: <b style="color:var(--accent-orange)">¥${Number(r.totalFinancingNeed || 0).toLocaleString('zh-CN')}</b></span>
            </div>
            <div class="eco-gov-timeline-tx">
              <span style="color:var(--text-muted)">txId:</span>
              <code style="color:var(--accent-cyan)">${r.txId}</code>
              <span style="color:var(--text-muted);margin-left:8px">block:</span>
              <code style="color:var(--accent-cyan)">${r.blockNumber}</code>
            </div>
            <div class="eco-gov-timeline-chainhash" title="链式 hash (上一条 hash 作为本条 prevHash, 形成不可篡改链)">
              <span style="color:var(--text-muted)">chainHash:</span>
              <code style="color:var(--text-secondary)">${(r.chainHash || '').slice(0, 32)}...</code>
            </div>
            <div class="eco-gov-timeline-witness" style="color:var(--text-muted)">${r.witnessNode}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="eco-gov-section">
        <div class="eco-gov-section-title">
          <span class="eco-gov-section-icon">🕒</span>
          <span>EG3 推送历史时间线</span>
          <span class="eco-gov-section-hint" style="color:var(--text-muted)">共 ${hist.length} 条 · MOD-08 链上存证 · 链式 hash 不可篡改</span>
        </div>
        <div class="eco-gov-timeline">${items}</div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 指导意见文件展示区 (EG4)
  // ============================================================
  function _renderGuidancePanel() {
    const statuses = (typeof EcoGov !== 'undefined') ? EcoGov.getEndorsementStatus() : [];
    if (!statuses.length) {
      return `<div class="eco-gov-empty">尚无监管机构</div>`;
    }

    const cards = statuses.map(s => {
      const endColor = _statusColor(s.endorsementStatus);
      let docHtml = '';
      if (s.endorsementStatus === 'endorsed') {
        try {
          const doc = (typeof EcoGov !== 'undefined') ? EcoGov.generateGuidanceDoc(s.regulatorId) : null;
          if (doc) {
            docHtml = `
              <div class="eco-gov-guidance-doc">
                <div class="eco-gov-guidance-doc-head">
                  <span class="eco-gov-guidance-doc-id" style="color:var(--accent-purple)">${doc.docId}</span>
                  <span class="eco-gov-guidance-doc-issuer" style="color:var(--text-secondary)">${doc.issuer}</span>
                </div>
                <div class="eco-gov-guidance-doc-title">${doc.title}</div>
                <div class="eco-gov-guidance-doc-nature" style="color:var(--accent-orange)">${doc.nature}</div>
                <pre class="eco-gov-guidance-doc-text">${(doc.text || '').replace(/</g, '&lt;')}</pre>
                <div class="eco-gov-guidance-doc-notice" style="color:var(--text-muted)">${doc.notice}</div>
                <button class="eco-gov-btn eco-gov-btn-mini eco-gov-btn-primary" data-action="download-guidance" data-reg-id="${s.regulatorId}" title="下载《指导意见》文本 (.txt)">
                  ⬇ 下载《指导意见》
                </button>
              </div>
            `;
          }
        } catch (err) {
          docHtml = `<div class="eco-gov-empty" style="color:var(--accent-red)">生成《指导意见》失败: ${err.message}</div>`;
        }
      }

      return `
        <div class="eco-gov-guidance-card" data-reg-id="${s.regulatorId}" style="border-left-color:${endColor}">
          <div class="eco-gov-guidance-card-head">
            <b style="color:var(--text-primary)">${s.regulatorName}</b>
            <span class="eco-gov-badge" style="color:${endColor};border-color:${endColor}">${_endorseStatusLabel(s.endorsementStatus)}</span>
          </div>
          ${s.endorsementStatus === 'endorsed' && s.endorsedAt
            ? `<div class="eco-gov-guidance-meta" style="color:var(--text-muted)">出具于 ${new Date(s.endorsedAt).toLocaleString('zh-CN', { hour12: false })} · 文号 ${s.endorsementDocId || '—'}</div>`
            : ''}
          ${s.endorsementStatus === 'pending'
            ? `<div class="eco-gov-guidance-hint" style="color:var(--text-muted)">申请已提交, 模拟器可点击 EG1 该机构"申请背书/审核中"按钮模拟监管审核通过</div>`
            : ''}
          ${s.endorsementStatus === 'none'
            ? `<div class="eco-gov-guidance-hint" style="color:var(--text-muted)">需先推送至少 1 次报告, 才能申请背书</div>`
            : ''}
          ${docHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="eco-gov-section">
        <div class="eco-gov-section-title">
          <span class="eco-gov-section-icon">📜</span>
          <span>EG4 指导意见文件展示区 (GOV.4)</span>
          <span class="eco-gov-section-hint" style="color:var(--text-muted)">《关于推广使用 AI 合规融资平台的指导意见》(非强制背书)</span>
        </div>
        <div class="eco-gov-guidance-grid">${cards}</div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 推荐标识状态卡片 (EG5)
  // ============================================================
  function _renderRecommendationPanel() {
    const rec = (typeof EcoGov !== 'undefined') ? EcoGov.isRecommended() : { recommended: false, badges: [], endorsers: [] };

    if (!rec.recommended) {
      return `
        <div class="eco-gov-section">
          <div class="eco-gov-section-title">
            <span class="eco-gov-section-icon">★</span>
            <span>EG5 推荐标识状态 (GOV.5)</span>
          </div>
          <div class="eco-gov-rec-panel">
            <div class="eco-gov-rec-status" style="color:var(--text-muted)">
              <div class="eco-gov-rec-big">未获推荐</div>
              <div class="eco-gov-rec-sub">尚未获得任何监管机构《指导意见》背书</div>
              <div class="eco-gov-rec-hint" style="color:var(--text-muted)">在 EG1 完成推送 → 申请背书 → 监管审核通过 → 即可展示"XX 监管局推荐平台"标识</div>
            </div>
          </div>
        </div>
      `;
    }

    const endorserBadges = (rec.endorsers || []).map(e => `
      <div class="eco-gov-endorser">
        <div class="eco-gov-endorser-name" style="color:var(--accent-green)">★ ${e.regulatorName}推荐平台</div>
        <div class="eco-gov-endorser-meta" style="color:var(--text-muted)">出具于 ${new Date(e.endorsedAt).toLocaleDateString('zh-CN')} · 文号 ${e.endorsementDocId}</div>
      </div>
    `).join('');

    return `
      <div class="eco-gov-section">
        <div class="eco-gov-section-title">
          <span class="eco-gov-section-icon">★</span>
          <span>EG5 推荐标识状态 (GOV.5)</span>
          <span class="eco-gov-section-hint" style="color:var(--accent-green)">已获 ${rec.endorsers.length} 家监管机构推荐</span>
        </div>
        <div class="eco-gov-rec-panel" style="background:rgba(63,185,80,0.08);border-color:var(--accent-green)">
          <div class="eco-gov-rec-status" style="color:var(--accent-green)">
            <div class="eco-gov-rec-big">★ 已获政府背书推荐</div>
            <div class="eco-gov-rec-sub">APP-01 银行端 + APP-02 企业端将展示以下推荐标识, 降低信任门槛</div>
          </div>
          <div class="eco-gov-rec-badges">
            ${(rec.badges || []).map(b => `<span class="eco-gov-rec-badge" style="color:var(--accent-green);border-color:var(--accent-green);background:rgba(63,185,80,0.1)">★ ${b}</span>`).join('')}
          </div>
          <div class="eco-gov-rec-endorsers">${endorserBadges}</div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 事件绑定
  // ============================================================
  function _bindEvents(container) {
    // 启动全部调度
    const startAllBtn = container.querySelector('#eco-gov-btn-start-all');
    if (startAllBtn) {
      startAllBtn.addEventListener('click', () => {
        const ids = (typeof EcoGov !== 'undefined') ? EcoGov.startAllSchedulers() : [];
        if (typeof State !== 'undefined' && typeof State.log === 'function') {
          State.log('gov', `[GOV] 已启动 ${ids.length} 家监管机构的自动推送调度 (weekly=7s / monthly=30s)`, 'config');
        }
        EcoGovView.renderTab(container);
      });
    }

    // 停止全部调度
    const stopAllBtn = container.querySelector('#eco-gov-btn-stop-all');
    if (stopAllBtn) {
      stopAllBtn.addEventListener('click', () => {
        if (typeof EcoGov !== 'undefined') EcoGov.stopAllSchedulers();
        if (typeof State !== 'undefined' && typeof State.log === 'function') {
          State.log('gov', '[GOV] 已停止全部监管机构的推送调度', 'config');
        }
        EcoGovView.renderTab(container);
      });
    }

    // 重置
    const resetBtn = container.querySelector('#eco-gov-btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('确认重置 ECO-08 全部状态? (会清空监管机构配置/推送历史/背书状态, 仅供演示)')) return;
        if (typeof EcoGov !== 'undefined') EcoGov.reset();
        if (typeof State !== 'undefined' && typeof State.log === 'function') {
          State.log('gov', '[GOV] ECO-08 状态已重置', 'config');
        }
        EcoGovView.renderTab(container);
      });
    }

    // 一键生成报告
    const buildBtn = container.querySelector('#eco-gov-btn-build-report');
    if (buildBtn) {
      buildBtn.addEventListener('click', async () => {
        buildBtn.disabled = true;
        buildBtn.textContent = '⏳ 生成中...';
        try {
          const report = await EcoGov.buildPulseReport();
          if (typeof State !== 'undefined' && typeof State.log === 'function') {
            State.log('gov', `[GOV] 已生成《辖区中小微企业经营脉搏脱敏报告》 period=${report.period} 企业数=${report.enterpriseCount} 信用健康指数=${report.creditHealthIndex.current}`, 'config');
          }
        } catch (err) {
          alert('生成报告失败: ' + err.message);
        } finally {
          buildBtn.disabled = false;
          buildBtn.textContent = '🔧 一键生成脱敏报告';
          EcoGovView.renderTab(container);
        }
      });
    }

    // 监管机构卡片动作 (在线/离线, 立即推送, 申请背书)
    const actionBtns = container.querySelectorAll('.eco-gov-reg-actions .eco-gov-btn[data-action]');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const regId = btn.getAttribute('data-reg-id');
        if (!action || !regId || typeof EcoGov === 'undefined') return;

        if (action === 'toggle-status') {
          const reg = EcoGov.regulators().find(r => r.id === regId);
          if (!reg) return;
          const newStatus = reg.status === 'online' ? 'offline' : 'online';
          EcoGov.setRegulatorStatus(regId, newStatus);
          if (typeof State !== 'undefined' && typeof State.log === 'function') {
            State.log('gov', `[GOV] ${reg.shortName} 通道切换为 ${newStatus === 'online' ? '在线' : '离线'}`, 'config');
          }
          EcoGovView.renderTab(container);

        } else if (action === 'push') {
          btn.disabled = true;
          const oldText = btn.textContent;
          btn.textContent = '⏳ 推送中...';
          try {
            const rec = await EcoGov.pushReport(regId);
            const reg = EcoGov.regulators().find(r => r.id === regId);
            if (typeof State !== 'undefined' && typeof State.log === 'function') {
              State.log('gov', `[GOV] 已推送脱敏报告给 ${reg ? reg.shortName : regId} txId=${rec.txId} block=${rec.blockNumber}`, 'config');
            }
          } catch (err) {
            alert('推送失败: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.textContent = oldText;
            EcoGovView.renderTab(container);
          }

        } else if (action === 'request-endorse') {
          btn.disabled = true;
          const oldText = btn.textContent;
          btn.textContent = '⏳ 处理中...';
          try {
            const res = await EcoGov.requestEndorsement(regId);
            const reg = EcoGov.regulators().find(r => r.id === regId);
            if (typeof State !== 'undefined' && typeof State.log === 'function') {
              State.log('gov', `[GOV] ${reg ? reg.shortName : regId} 背书状态 → ${res.endorsementStatus}`, 'config');
            }
          } catch (err) {
            alert('申请背书失败: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.textContent = oldText;
            EcoGovView.renderTab(container);
          }
        }
      });
    });

    // 推送节奏切换
    container.querySelectorAll('.eco-gov-sched-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const regId = sel.getAttribute('data-reg-id');
        const sched = sel.value;
        if (!regId || typeof EcoGov === 'undefined') return;
        try {
          EcoGov.setPushSchedule(regId, sched);
          const reg = EcoGov.regulators().find(r => r.id === regId);
          if (typeof State !== 'undefined' && typeof State.log === 'function') {
            State.log('gov', `[GOV] ${reg ? reg.shortName : regId} 推送节奏切换为 ${sched === 'monthly' ? '月推' : '周推'}`, 'config');
          }
        } catch (err) {
          alert('切换节奏失败: ' + err.message);
        }
        EcoGovView.renderTab(container);
      });
    });

    // 下载《指导意见》
    container.querySelectorAll('button[data-action="download-guidance"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const regId = btn.getAttribute('data-reg-id');
        if (!regId || typeof EcoGov === 'undefined') return;
        try {
          const doc = EcoGov.generateGuidanceDoc(regId);
          const blob = new Blob([doc.text], { type: 'text/plain;charset=utf-8' });
          const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
          if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.download = `${doc.docId}.txt`;
            a.click();
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
          } else {
            alert('当前环境不支持 Blob 下载');
          }
        } catch (err) {
          alert('下载失败: ' + err.message);
        }
      });
    });
  }

  // ============================================================
  // 私有: 订阅状态变化 → 整体刷新
  // ============================================================
  function _subscribeChanges(container) {
    if (_unsubscribe) {
      try { _unsubscribe(); } catch (_) {}
      _unsubscribe = null;
    }
    if (typeof EcoGov === 'undefined' || !EcoGov.subscribeChanges) return;
    _unsubscribe = EcoGov.subscribeChanges((evt) => {
      // 自动推送/状态变化时整体刷新
      EcoGovView.renderTab(container);
    });
  }

  // ============================================================
  // 公共 API: renderTab(container)
  // ----------------------------------------------------------
  // 渲染整个 ECO-08 Tab 内容. container 为父容器 DOM.
  // 父 agent 集成时:
  //   - index.html 增加 <section id="view-eco-gov" class="view"></section>
  //   - app.js renderActiveView() 增加 case 'eco-gov': EcoGovView.renderTab(...)
  //   - 顶部导航增加对应 tab 按钮
  //   - <script src="js/eco-gov.js"></script>
  //   - <script src="js/view-eco-gov.js"></script>
  // ============================================================
  function renderTab(container) {
    if (!container) {
      container = (typeof document !== 'undefined') ? document.getElementById('view-eco-gov') : null;
    }
    if (!container) return;

    const lastReport = (typeof EcoGov !== 'undefined') ? EcoGov.getLastReport() : null;

    container.innerHTML = `
      ${_renderTopConsole()}
      ${_renderRegulatorsPanel()}
      ${_renderReportBuilder(lastReport)}
      ${_renderHistoryTimeline()}
      ${_renderGuidancePanel()}
      ${_renderRecommendationPanel()}
    `;

    _bindEvents(container);
    _subscribeChanges(container);
  }

  // ============================================================
  // 公共 API: render() —— 兼容 App.renderActiveView 风格
  // ============================================================
  function render() {
    let container = (typeof document !== 'undefined') ? document.getElementById('view-eco-gov') : null;
    if (!container) {
      container = (typeof document !== 'undefined') ? document.querySelector('[data-eco-gov-view]') : null;
    }
    renderTab(container);
  }

  // ============================================================
  // 公共 API 导出
  // ============================================================
  return {
    renderTab,
    render
  };

})();

// 暴露到 window
if (typeof window !== 'undefined') {
  window.EcoGovView = EcoGovView;
}
// CommonJS 兼容 (供 node --check / 单测 mock)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcoGovView;
}
