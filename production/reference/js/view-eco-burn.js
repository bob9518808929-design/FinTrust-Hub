/** 文件名：view-eco-burn.js 职责：ECO-01 阅后即焚零信任诊断视图,沙漏倒计时+脱敏体检报告+销毁审计 */
//
// 模块定位: APP-02 企业端展示 "倒计时沙漏 + 脱敏体检报告 + 销毁审计"
// 对齐 spec.md L2855-2856 (沙漏 UI + 归零提示) + checklist.md BURN.7
//
// ============================================================================
// 视图布局:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ EB0 顶部控制台: 企业选择器 + 原始数据加载 + 一键诊断 + 状态徽章 │
//   ├──────────────────────────┬───────────────────────────────────┤
//   │ EB1 零信任沙漏 (120s SVG) │ EB2 脱敏体检报告 (8维 + 12项 Gap)  │
//   │ · 实时倒计时 + 沙漏动效   │ · 8 维评分卡 + 弱项红框            │
//   │ · 状态/阶段提示          │ · 12 项 Gap 列表 + 改造建议摘要     │
//   │ · 最后下载机会按钮        │ · 脱敏产物持久化说明               │
//   ├──────────────────────────┴───────────────────────────────────┤
//   │ EB3 数据销毁审计报告 (MOD-08 链上存证)                       │
//   │ · 三重销毁留痕 (覆写/清零/Redis清空)                          │
//   │ · 链上 txId + blockNumber + chainHash + 验证命令              │
//   ├──────────────────────────────────────────────────────────────┤
//   │ EB4 销毁后归零提示条                                          │
//   │ "✅ 您的原始数据已彻底销毁, 仅保留脱敏体检报告"               │
//   └──────────────────────────────────────────────────────────────┘
// ============================================================================
//
// 深色主题: 全部使用 CSS 变量 (var(--bg-*) / var(--text-*) / var(--accent-*))
//           严禁浅色硬编码 (禁止 #ffffff / #000000 直接出现)

'use strict';

const EcoBurnView = (() => {

  // ============================================================
  // 私有: 订阅清理 (Tab 切换 / 企业切换时 unsubscribe 旧回调)
  // ============================================================
  let _unsubscribe = null;
  let _lastEntId = null;

  // ============================================================
  // 私有: 当前企业 ID (从 State.currentEnterpriseId 读, 只读)
  // ============================================================
  function _currentEntId() {
    if (typeof State !== 'undefined' && State.currentEnterpriseId) {
      return State.currentEnterpriseId;
    }
    return null;
  }

  function _currentEnt() {
    if (typeof State === 'undefined') return null;
    return State.enterprises.find(e => e.id === State.currentEnterpriseId) || State.enterprises[0] || null;
  }

  // ============================================================
  // 私有: 8 维评分 → 颜色映射
  // ============================================================
  function _scoreColor(score) {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 65) return 'var(--accent-blue)';
    if (score >= 50) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  function _urgencyColor(urgency) {
    if (urgency === 'critical') return 'var(--accent-red)';
    if (urgency === 'high') return 'var(--accent-orange)';
    if (urgency === 'medium') return 'var(--accent-blue)';
    return 'var(--accent-green)';
  }

  function _statusColor(status) {
    switch (status) {
      case 'destroyed': return 'var(--accent-green)';
      case 'completed': return 'var(--accent-blue)';
      case 'diagnosing': return 'var(--accent-orange)';
      case 'loaded': return 'var(--accent-purple)';
      default: return 'var(--text-muted)';
    }
  }

  // ============================================================
  // 私有: 状态徽章 HTML
  // ============================================================
  function _statusBadge(status) {
    const labels = {
      idle: '未加载',
      loaded: '原始数据已载入内存',
      diagnosing: '内存诊断中 (零信任)',
      completed: '诊断完成待销毁',
      destroyed: '已物理销毁'
    };
    const text = labels[status] || status || '未加载';
    return `<span class="eco-burn-badge" style="color:${_statusColor(status)};border-color:${_statusColor(status)}">${text}</span>`;
  }

  // ============================================================
  // 私有: 120s 沙漏 SVG (动态倒计时)
  // ----------------------------------------------------------
  // 上三角沙子高度随 percent 减少, 下三角沙子高度随 percent 增加
  // 中央显示剩余秒数 + 阶段提示
  // ============================================================
  function _renderHourglass(progress, status) {
    const total = (typeof EcoBurn !== 'undefined' && EcoBurn.TOTAL_SECONDS) || 120;
    const elapsed = progress ? progress.elapsedSec : 0;
    const remaining = progress ? progress.remainingSec : total;
    const percent = progress ? progress.percent : 0;
    const phase = progress ? progress.phase : 'idle';

    // 沙漏几何参数 (200x240 viewBox)
    const cx = 100;       // 中心 x
    const topY = 20;      // 上沿 y
    const midY = 120;     // 漏口 y (中心)
    const botY = 220;     // 下沿 y
    const outerR = 80;    // 顶/底半宽
    const neckR = 6;      // 漏口半宽

    // 上半沙子高度比例 (从满 → 0)
    const topFill = Math.max(0, 1 - percent / 100);
    // 下半沙子高度比例 (从 0 → 满)
    const botFill = Math.min(1, percent / 100);

    // 上半沙子多边形 (倒三角, 随时间下降)
    // sandTopY = midY - (midY - topY) * topFill
    const upperSandTop = midY - (midY - topY) * topFill;
    // 上半沙子宽度沿漏斗收窄
    const upperHalfWidth = (w, y) => {
      const t = (y - topY) / (midY - topY); // 0 at top, 1 at neck
      return outerR * (1 - t) + neckR * t;
    };
    const upperSandPath = `M ${cx - upperHalfWidth(0, upperSandTop)} ${upperSandTop}
                           L ${cx + upperHalfWidth(0, upperSandTop)} ${upperSandTop}
                           L ${cx + neckR} ${midY}
                           L ${cx - neckR} ${midY} Z`;

    // 下半沙子多边形 (从漏口向下堆积)
    const lowerSandTop = botY - (botY - midY) * botFill;
    const lowerHalfWidth = (y) => {
      const t = (y - midY) / (botY - midY); // 0 at neck, 1 at bottom
      return neckR * (1 - t) + outerR * t;
    };
    const lowerSandPath = `M ${cx - neckR} ${midY}
                           L ${cx + neckR} ${midY}
                           L ${cx + lowerHalfWidth(botY)} ${botY}
                           L ${cx - lowerHalfWidth(botY)} ${botY} Z
                           M ${cx - neckR} ${midY}
                           L ${cx + neckR} ${midY}
                           L ${cx + lowerHalfWidth(lowerSandTop)} ${lowerSandTop}
                           L ${cx - lowerHalfWidth(lowerSandTop)} ${lowerSandTop} Z`;

    // 沙漏玻璃外框 (上下两个三角形 + 漏口)
    const glassPath = `M ${cx - outerR} ${topY}
                       L ${cx + outerR} ${topY}
                       L ${cx + neckR} ${midY}
                       L ${cx + outerR} ${botY}
                       L ${cx - outerR} ${botY}
                       L ${cx - neckR} ${midY} Z`;

    // 阶段提示文字
    let phaseText;
    if (status === 'destroyed') {
      phaseText = '✅ 已彻底销毁';
    } else if (status === 'completed') {
      phaseText = '诊断完成, 销毁中...';
    } else if (status === 'diagnosing') {
      phaseText = '内存诊断中, 零信任保护';
    } else if (status === 'loaded') {
      phaseText = '已载入, 待启动诊断';
    } else {
      phaseText = '请先加载原始数据';
    }

    const sandColor = status === 'destroyed' ? 'var(--accent-green)' : 'var(--accent-orange)';
    const glassStroke = status === 'destroyed' ? 'var(--accent-green)' : 'var(--text-muted)';
    const textColor = status === 'destroyed' ? 'var(--accent-green)' : 'var(--text-primary)';

    return `
      <div class="eco-burn-hourglass-wrap">
        <svg class="eco-burn-hourglass" viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
          <!-- 玻璃外框 -->
          <path d="${glassPath}" fill="rgba(255,255,255,0.03)" stroke="${glassStroke}" stroke-width="2" stroke-linejoin="round"/>
          <!-- 沙漏木架 (上下两条横木) -->
          <rect x="${cx - outerR - 8}" y="${topY - 8}" width="${(outerR + 8) * 2}" height="8" rx="2" fill="var(--bg-tertiary)" stroke="${glassStroke}" stroke-width="1.5"/>
          <rect x="${cx - outerR - 8}" y="${botY}" width="${(outerR + 8) * 2}" height="8" rx="2" fill="var(--bg-tertiary)" stroke="${glassStroke}" stroke-width="1.5"/>
          <!-- 上半沙子 -->
          ${topFill > 0.001 ? `<path d="${upperSandPath}" fill="${sandColor}" opacity="0.85"/>` : ''}
          <!-- 下半沙子 -->
          ${botFill > 0.001 ? `<path d="${lowerSandPath}" fill="${sandColor}" opacity="0.85"/>` : ''}
          <!-- 沙流 (中间细线, diagnosing 时显示) -->
          ${status === 'diagnosing' ? `<line x1="${cx}" y1="${midY - 2}" x2="${cx}" y2="${lowerSandTop}" stroke="${sandColor}" stroke-width="1.5" stroke-dasharray="2,3"><animate attributeName="stroke-dashoffset" from="0" to="-10" dur="0.6s" repeatCount="indefinite"/></line>` : ''}
          <!-- 中央倒计时数字 -->
          <text x="${cx}" y="${midY - 30}" text-anchor="middle" font-size="22" font-weight="700" fill="${textColor}" font-family="monospace">${remaining}</text>
          <text x="${cx}" y="${midY - 12}" text-anchor="middle" font-size="9" fill="var(--text-muted)">剩余秒</text>
        </svg>
        <div class="eco-burn-hourglass-phase" style="color:${textColor}">${phaseText}</div>
        <div class="eco-burn-hourglass-progress">
          <div class="eco-burn-progress-track">
            <div class="eco-burn-progress-fill" style="width:${percent}%;background:${sandColor}"></div>
          </div>
          <span class="eco-burn-progress-text">${elapsed}/${total}s · ${percent}%</span>
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 8 维评分卡渲染
  // ============================================================
  function _renderScorecard(desens) {
    if (!desens || !desens.eightDimScore) {
      return `<div class="eco-burn-empty">尚未生成脱敏体检报告 (启动诊断后展示)</div>`;
    }
    const score = desens.eightDimScore;
    const dims = score.dims || {};
    const targetDims = score.targetDims || {};

    const items = (EcoBurn.DIM_KEYS || Object.keys(dims)).map(k => {
      const cur = dims[k] || 0;
      const tgt = targetDims[k] || 0;
      const label = (EcoBurn.DIM_LABELS && EcoBurn.DIM_LABELS[k]) || k;
      const barWidth = Math.min(100, cur);
      const tgtLeft = Math.min(100, tgt);
      const color = _scoreColor(cur);
      const gap = Math.max(0, tgt - cur);
      return `
        <div class="eco-burn-dim-item">
          <div class="eco-burn-dim-head">
            <span class="eco-burn-dim-label">${label}</span>
            <span class="eco-burn-dim-score" style="color:${color}">${cur}</span>
            ${gap > 0 ? `<span class="eco-burn-dim-gap" style="color:var(--accent-orange)">目标 ${tgt} / 缺口 ${gap}</span>` : `<span class="eco-burn-dim-gap" style="color:var(--accent-green)">达标</span>`}
          </div>
          <div class="eco-burn-dim-bar">
            <div class="eco-burn-dim-bar-fill" style="width:${barWidth}%;background:${color}"></div>
            <div class="eco-burn-dim-bar-target" style="left:${tgtLeft}%"></div>
          </div>
        </div>
      `;
    }).join('');

    const weakHtml = (score.weakDims && score.weakDims.length)
      ? `<div class="eco-burn-weak-list">
           <span class="eco-burn-weak-title">⚠️ 薄弱维度 (${score.weakDims.length}):</span>
           ${score.weakDims.map(w => `<span class="eco-burn-weak-pill">${w.label} ${w.value}</span>`).join('')}
         </div>`
      : `<div class="eco-burn-weak-list"><span style="color:var(--accent-green)">✅ 无薄弱维度 (&lt;60)</span></div>`;

    return `
      <div class="eco-burn-scorecard">
        <div class="eco-burn-score-summary">
          <span>加权平均: <b style="color:var(--accent-blue)">${score.weightedAvg}</b></span>
          <span>目标等级: <b style="color:var(--accent-purple)">B+</b> 银行准入线</span>
        </div>
        ${items}
        ${weakHtml}
      </div>
    `;
  }

  // ============================================================
  // 私有: 12 项 Gap 列表渲染
  // ============================================================
  function _renderGapList(desens) {
    if (!desens || !desens.twelveGap || !desens.twelveGap.length) {
      return `<div class="eco-burn-empty">尚无 Gap 诊断结果</div>`;
    }
    const gaps = desens.twelveGap;
    const summary = desens.gapSummary || {};

    const summaryHtml = `
      <div class="eco-burn-gap-summary">
        <span class="eco-burn-gap-pill" style="color:var(--accent-red);border-color:var(--accent-red)">关键 ${summary.criticalCount || 0}</span>
        <span class="eco-burn-gap-pill" style="color:var(--accent-orange);border-color:var(--accent-orange)">高 ${summary.highCount || 0}</span>
        <span class="eco-burn-gap-pill" style="color:var(--accent-blue);border-color:var(--accent-blue)">中 ${summary.mediumCount || 0}</span>
        <span class="eco-burn-gap-pill" style="color:var(--accent-green);border-color:var(--accent-green)">低 ${summary.lowCount || 0}</span>
        <span class="eco-burn-gap-total">缺口合计 ${summary.totalGapPoints || 0} 分</span>
      </div>
    `;

    const items = gaps.map(g => `
      <div class="eco-burn-gap-item" style="border-left-color:${_urgencyColor(g.urgency)}">
        <div class="eco-burn-gap-head">
          <span class="eco-burn-gap-id">${g.gapId}</span>
          <span class="eco-burn-gap-label">${g.dimLabel}</span>
          <span class="eco-burn-gap-urgency" style="color:${_urgencyColor(g.urgency)}">${({ critical: '关键', high: '高', medium: '中', low: '低' })[g.urgency] || g.urgency}</span>
        </div>
        <div class="eco-burn-gap-score">
          当前 <b style="color:${_scoreColor(g.current)}">${g.current}</b>
          <span style="color:var(--text-muted)">→</span>
          目标 <b style="color:var(--accent-purple)">${g.target}</b>
          <span style="color:var(--accent-orange);margin-left:8px">缺口 ${g.gap}</span>
        </div>
        <div class="eco-burn-gap-suggestion">${g.suggestion || '—'}</div>
      </div>
    `).join('');

    const briefHtml = desens.reformSuggestionBrief
      ? `<div class="eco-burn-reform-brief">💡 ${desens.reformSuggestionBrief}</div>`
      : '';

    return `
      <div class="eco-burn-gap-list">
        ${summaryHtml}
        <div class="eco-burn-gap-items">${items}</div>
        ${briefHtml}
        <div class="eco-burn-desens-note">
          🔒 脱敏产物持久化到 localStorage.<code>eco_burn_desensitized_${desens.enterpriseId || ''}</code>
          <br>已永久移除字段: ${(desens.rawFieldsRemoved || []).join(', ')} — ${desens.rawFieldsRemovedNote || '原始对手/金额已销毁'}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 销毁审计报告 (MOD-08 链上存证) 渲染
  // ============================================================
  function _renderAuditTrail(audit) {
    if (!audit) {
      return `<div class="eco-burn-empty">尚无销毁审计报告 (启动诊断并完成 120s 销毁后展示)</div>`;
    }
    const t = audit.threeTrails || {};
    return `
      <div class="eco-burn-audit">
        <div class="eco-burn-audit-header">
          <span class="eco-burn-audit-tx">txId: <code>${audit.txId}</code></span>
          <span class="eco-burn-audit-block">block #${audit.blockNumber}</span>
          <span class="eco-burn-audit-network">${audit.network}</span>
        </div>
        <div class="eco-burn-audit-hash-row">
          <div class="eco-burn-audit-hash">
            <span class="eco-burn-audit-hash-label">销毁前原始画像哈希</span>
            <code class="eco-burn-audit-hash-value">${(audit.rawHashBeforeDestroy || '').slice(0, 32)}...</code>
          </div>
          <div class="eco-burn-audit-hash">
            <span class="eco-burn-audit-hash-label">销毁后脱敏产物哈希</span>
            <code class="eco-burn-audit-hash-value">${(audit.desensitizedHashAfterPersist || '').slice(0, 32)}...</code>
          </div>
          <div class="eco-burn-audit-hash">
            <span class="eco-burn-audit-hash-label">链上存证 hash (chainHash)</span>
            <code class="eco-burn-audit-hash-value">${(audit.chainHash || '').slice(0, 32)}...</code>
          </div>
          <div class="eco-burn-audit-hash">
            <span class="eco-burn-audit-hash-label">前向 hash (链式)</span>
            <code class="eco-burn-audit-hash-value">${(audit.prevHash || '').slice(0, 32)}...</code>
          </div>
        </div>
        <div class="eco-burn-audit-trails">
          <div class="eco-burn-audit-trail" style="border-left-color:var(--accent-green)">
            <span class="eco-burn-audit-trail-icon">1️⃣</span>
            <span class="eco-burn-audit-trail-text">${t.overwriteTrail || 'secure_delete 3-pass 已执行'}</span>
          </div>
          <div class="eco-burn-audit-trail" style="border-left-color:var(--accent-blue)">
            <span class="eco-burn-audit-trail-icon">2️⃣</span>
            <span class="eco-burn-audit-trail-text">${t.memoryZeroTrail || 'TeeSecureMemory 已清零'}</span>
          </div>
          <div class="eco-burn-audit-trail" style="border-left-color:var(--accent-purple)">
            <span class="eco-burn-audit-trail-icon">3️⃣</span>
            <span class="eco-burn-audit-trail-text">${t.redisClearTrail || 'Redis raw_* 已清空'}</span>
          </div>
        </div>
        <div class="eco-burn-audit-meta">
          <span>销毁时间: ${audit.destroyedAt}</span>
          <span>覆写单元数: ${audit.overwrittenCells || 0}</span>
          <span>Redis 清空键数: ${audit.redisKeysCleared || 0}</span>
          <span>存证节点: ${audit.witnessNode || 'MOD-08'}</span>
        </div>
        <div class="eco-burn-audit-verify">
          <span class="eco-burn-audit-verify-label">链上验证命令:</span>
          <code class="eco-burn-audit-verify-cmd">${audit.verificationCmd || ''}</code>
        </div>
        <div class="eco-burn-audit-irreversibility">
          🔒 ${audit.irreversibility || '原始数据已物理销毁, 仅脱敏产物永久保存'}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: EB0 顶部控制台
  // ============================================================
  function _renderTopConsole(ent, status, rawMeta) {
    const enterprises = (typeof State !== 'undefined' && State.enterprises) ? State.enterprises : [];
    const entId = ent ? ent.id : '';
    const dataTypeOptions = [
      { v: 'all', l: '全部 (银行流水+税务明细+两套账凭证)' },
      { v: 'bank', l: '银行流水' },
      { v: 'tax', l: '税务明细' },
      { v: 'twoBooks', l: '两套账凭证' }
    ];

    return `
      <div class="card eco-burn-card eco-burn-top">
        <div class="card-title">
          <span>🔥 ECO-01 阅后即焚零信任诊断 · MOD-16.1</span>
          <span class="eco-burn-version">v3.1 / 模拟器</span>
        </div>
        <div class="eco-burn-controls">
          <label>企业:</label>
          <select id="eco-burn-ent-select" class="eco-burn-select">
            ${enterprises.map(e => `<option value="${e.id}" ${e.id === entId ? 'selected' : ''}>${e.name}</option>`).join('')}
          </select>
          <label>原始数据类型:</label>
          <select id="eco-burn-datatype-select" class="eco-burn-select">
            ${dataTypeOptions.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}
          </select>
          <button id="eco-burn-btn-load" class="btn-primary">📥 1. 加载原始数据到内存</button>
          <button id="eco-burn-btn-diagnose" class="btn-primary" ${status === 'idle' ? 'disabled' : ''}>🚀 2. 启动 120s 零信任诊断</button>
          <button id="eco-burn-btn-download" class="btn-mini" ${!rawMeta ? 'disabled' : ''}>💾 最后下载机会</button>
          <button id="eco-burn-btn-reset" class="btn-danger">🔄 重置</button>
        </div>
        <div class="eco-burn-status-row">
          <span>状态: ${_statusBadge(status)}</span>
          ${rawMeta ? `<span class="eco-burn-raw-meta">内存区: <code>${rawMeta.memoryRegion || 'TeeSecureMemory'}</code> · ${rawMeta.recordCount} 条 · ${(rawMeta.bytes / 1024).toFixed(1)} KB · hash <code>${(rawMeta.hash || '').slice(0, 12)}...</code> · ${rawMeta.inMemory ? '✅ 在内存' : '⚠️ 已销毁'}</span>` : '<span class="eco-burn-raw-meta" style="color:var(--text-muted)">未加载原始数据</span>'}
        </div>
        <div class="eco-burn-philosophy">
          💡 设计哲学: 原始银行流水/税务明细<strong>仅在内存中</strong>完成 R1-R2 差距计算, 完成后<strong>立即物理销毁</strong>, 数据湖只永久保存脱敏后的 8 维评分 + 12 项 Gap. 此为"零信任架构"核心, 破解"企业数据裸奔"恐惧.
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: EB1+EB2 双栏 (沙漏 + 脱敏报告)
  // ============================================================
  function _renderMainRow(entId, status, progress, desens) {
    return `
      <div class="card-grid card-grid-2">
        <div class="card eco-burn-card eco-burn-hourglass-card">
          <div class="card-title"><span>⏳ EB1 零信任沙漏 · 120 秒倒计时</span></div>
          ${_renderHourglass(progress, status)}
          <div class="eco-burn-stage-help">
            <div class="eco-burn-stage-line"><span class="eco-burn-stage-dot" style="background:${status === 'loaded' || status === 'diagnosing' || status === 'completed' || status === 'destroyed' ? 'var(--accent-green)' : 'var(--text-muted)'}"></span> ① 载入 TeeSecureMemory</div>
            <div class="eco-burn-stage-line"><span class="eco-burn-stage-dot" style="background:${status === 'diagnosing' || status === 'completed' || status === 'destroyed' ? 'var(--accent-orange)' : 'var(--text-muted)'}"></span> ② 120s 内存诊断 (R1+R2, 不落盘)</div>
            <div class="eco-burn-stage-line"><span class="eco-burn-stage-dot" style="background:${status === 'completed' || status === 'destroyed' ? 'var(--accent-blue)' : 'var(--text-muted)'}"></span> ③ 诊断完成</div>
            <div class="eco-burn-stage-line"><span class="eco-burn-stage-dot" style="background:${status === 'destroyed' ? 'var(--accent-green)' : 'var(--text-muted)'}"></span> ④ 物理销毁 + 链上存证</div>
          </div>
        </div>
        <div class="card eco-burn-card eco-burn-report-card">
          <div class="card-title"><span>🩺 EB2 脱敏体检报告</span><span class="eco-burn-report-sub">8 维评分 + 12 项 Gap</span></div>
          ${_renderScorecard(desens)}
          ${_renderGapList(desens)}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 私有: EB3 销毁审计
  // ============================================================
  function _renderAuditCard(audit) {
    return `
      <div class="card eco-burn-card eco-burn-audit-card">
        <div class="card-title"><span>🔐 EB3 数据销毁审计报告 · MOD-08 链上存证</span><span class="eco-burn-report-sub">三重销毁留痕</span></div>
        ${_renderAuditTrail(audit)}
      </div>
    `;
  }

  // ============================================================
  // 私有: EB4 归零提示条
  // ============================================================
  function _renderCompletionBanner(status) {
    if (status !== 'destroyed') return '';
    return `
      <div class="eco-burn-completion-banner">
        ✅ 您的原始数据已彻底销毁, 仅保留脱敏体检报告
        <div class="eco-burn-completion-sub">原始银行流水/税务明细/两套账凭证已通过 secure_delete (3-pass 覆写) + TeeSecureMemory 清零 + Redis raw_* 清空永久销毁, 不可恢复. 销毁动作已上链存证, 见上方 EB3 审计报告.</div>
      </div>
    `;
  }

  // ============================================================
  // 私有: 事件绑定
  // ============================================================
  function _bindEvents(container, entId) {
    // 企业选择器
    const entSel = container.querySelector('#eco-burn-ent-select');
    if (entSel) {
      entSel.addEventListener('change', (e) => {
        if (typeof State !== 'undefined' && typeof State.switchEnterprise === 'function') {
          State.switchEnterprise(e.target.value);
        }
        // 重新渲染
        EcoBurnView.renderTab(container);
      });
    }

    // 加载原始数据
    const loadBtn = container.querySelector('#eco-burn-btn-load');
    const dtSel = container.querySelector('#eco-burn-datatype-select');
    if (loadBtn) {
      loadBtn.addEventListener('click', async () => {
        const targetEnt = _currentEntId() || entId;
        const dt = dtSel ? dtSel.value : 'all';
        loadBtn.disabled = true;
        loadBtn.textContent = '⏳ 加载中...';
        try {
          const res = await EcoBurn.loadRawData(targetEnt, dt);
          if (typeof State !== 'undefined' && typeof State.log === 'function') {
            State.log('burn', `[BURN] 原始数据已载入: ${res.recordCount} 条 / ${(res.bytes / 1024).toFixed(1)} KB / hash ${res.hash.slice(0, 12)}...`, 'config');
          }
        } catch (err) {
          alert('加载失败: ' + err.message);
        } finally {
          loadBtn.disabled = false;
          loadBtn.textContent = '📥 1. 加载原始数据到内存';
          EcoBurnView.renderTab(container);
        }
      });
    }

    // 启动诊断
    const diagBtn = container.querySelector('#eco-burn-btn-diagnose');
    if (diagBtn) {
      diagBtn.addEventListener('click', async () => {
        const targetEnt = _currentEntId() || entId;
        diagBtn.disabled = true;
        diagBtn.textContent = '⏳ 诊断中 (120s)...';
        try {
          await EcoBurn.runDiagnosis(targetEnt);
        } catch (err) {
          alert('诊断启动失败: ' + err.message);
          diagBtn.disabled = false;
          diagBtn.textContent = '🚀 2. 启动 120s 零信任诊断';
        }
        // 倒计时由 subscribeProgress 驱动刷新, 不在这里阻塞
      });
    }

    // 最后下载机会
    const dlBtn = container.querySelector('#eco-burn-btn-download');
    if (dlBtn) {
      dlBtn.addEventListener('click', async () => {
        const targetEnt = _currentEntId() || entId;
        try {
          const res = await EcoBurn.offerLastDownload(targetEnt);
          if (res.url) {
            const a = document.createElement('a');
            a.href = res.url;
            a.download = res.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // 释放 Blob URL (避免内存泄漏)
            setTimeout(() => { try { URL.revokeObjectURL(res.url); } catch (_) {} }, 60000);
          } else {
            alert('当前环境不支持 Blob 下载');
          }
        } catch (err) {
          alert('下载失败: ' + err.message);
        }
      });
    }

    // 重置
    const resetBtn = container.querySelector('#eco-burn-btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const targetEnt = _currentEntId() || entId;
        if (!confirm('确认重置该企业的阅后即焚状态? (已上链的销毁审计报告会被清除, 仅供演示)')) return;
        EcoBurn.reset(targetEnt);
        EcoBurnView.renderTab(container);
      });
    }
  }

  // ============================================================
  // 私有: 进度订阅 → 局部刷新沙漏 (避免整个 Tab re-render)
  // ============================================================
  function _subscribeProgressForHourglass(container) {
    // 清理旧订阅 (Tab 切换 / 企业切换)
    if (_unsubscribe) {
      try { _unsubscribe(); } catch (_) {}
      _unsubscribe = null;
    }
    if (typeof EcoBurn === 'undefined' || !EcoBurn.subscribeProgress) return;
    _unsubscribe = EcoBurn.subscribeProgress((payload) => {
      const entId = payload.enterpriseId;
      const curEnt = _currentEntId();
      // 只更新当前企业对应 DOM
      if (entId !== curEnt) return;
      const hourglassWrap = container.querySelector('.eco-burn-hourglass-card');
      if (!hourglassWrap) return;
      // 仅在 diagnosing/destroyed 阶段刷新沙漏内容
      const status = EcoBurn.getStatus(entId);
      const progress = EcoBurn.getBurnProgress(entId);
      // 重建沙漏 + 阶段帮助行 (沙漏部分)
      const oldHourglass = hourglassWrap.querySelector('.eco-burn-hourglass-wrap');
      const oldStage = hourglassWrap.querySelector('.eco-burn-stage-help');
      const tmp = document.createElement('div');
      tmp.innerHTML = _renderHourglass(progress, status);
      const newHourglass = tmp.firstChild;
      if (oldHourglass && newHourglass) hourglassWrap.replaceChild(newHourglass, oldHourglass);

      // 归零或销毁 → 整体刷新 (展示脱敏报告 + 审计 + 完成横幅)
      if (status === 'destroyed' || (status === 'completed' && (progress.remainingSec === 0))) {
        EcoBurnView.renderTab(container);
      }
      // 阶段提示行颜色 (无需整体刷新)
      if (oldStage) {
        // noop: stage-help 颜色在 renderTab 整体重渲染时已更新
      }
    });
  }

  // ============================================================
  // 公共 API: renderTab(container)
  // ----------------------------------------------------------
  // 渲染整个 ECO-01 Tab 内容. container 为父容器 DOM.
  // 父 agent 集成时:
  //   - index.html 增加 <section id="view-eco-burn" class="view"></section>
  //   - app.js renderActiveView() 增加 case 'eco-burn': EcoBurnView.renderTab(...)
  //   - 顶部导航增加对应 tab 按钮
  //   - <script src="js/eco-burn.js"></script>
  //   - <script src="js/view-eco-burn.js"></script>
  // ============================================================
  function renderTab(container) {
    if (!container) {
      container = (typeof document !== 'undefined') ? document.getElementById('view-eco-burn') : null;
    }
    if (!container) return;

    const ent = _currentEnt();
    const entId = ent ? ent.id : '';
    _lastEntId = entId;

    const status = (typeof EcoBurn !== 'undefined') ? EcoBurn.getStatus(entId) : 'idle';
    const progress = (typeof EcoBurn !== 'undefined') ? EcoBurn.getBurnProgress(entId) : null;
    const desens = (typeof EcoBurn !== 'undefined') ? EcoBurn.getDesensitizedReport(entId) : null;
    const audit = (typeof EcoBurn !== 'undefined') ? EcoBurn.getAuditTrail(entId) : null;
    const rawMeta = (typeof EcoBurn !== 'undefined') ? EcoBurn.getRawMeta(entId) : null;

    container.innerHTML = `
      ${_renderTopConsole(ent, status, rawMeta)}
      ${_renderMainRow(entId, status, progress, desens)}
      ${_renderAuditCard(audit)}
      ${_renderCompletionBanner(status)}
    `;

    _bindEvents(container, entId);
    _subscribeProgressForHourglass(container);
  }

  // ============================================================
  // 公共 API: render() —— 兼容 App.renderActiveView 风格
  // ============================================================
  function render() {
    let container = (typeof document !== 'undefined') ? document.getElementById('view-eco-burn') : null;
    if (!container) {
      // 兜底: 父容器可能用 view-eco-burn 以外的 id (由父 agent 决定)
      container = (typeof document !== 'undefined') ? document.querySelector('[data-eco-burn-view]') : null;
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
  window.EcoBurnView = EcoBurnView;
}
// CommonJS 兼容 (供 node --check / 单测 mock)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcoBurnView;
}
