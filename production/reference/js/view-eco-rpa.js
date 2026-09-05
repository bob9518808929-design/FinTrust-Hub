/** 文件名：view-eco-rpa.js 职责：ECO-03 无接口适配器视图,银行冷启动申报书预览与 CSV/HTML 下载 */
//
// 视图定位: 银行冷启动期"无接口"破局层运营台。企业选择器 + 银行模板选择器 +
// 申报书预览(基本信息+8维画像+五流摘要+建议授信+AI预审章) + 下载(CSV/HTML) +
// 银行反馈回填 + 放款业绩统计 + API 升级价值评估报告。
//
// 接入策略: 不修改 index.html / app.js (遵守"禁止修改任何已有文件"约束)。
//   DOMContentLoaded 后注入一个悬浮按钮, 点击打开全屏深色主题覆盖面板承载本视图。
//   全部使用深色主题 CSS 变量, 无浅色硬编码。

window.EcoRpaView = (function () {
  'use strict';

  // 视图内部状态
  const _state = {
    open: false,
    selectedEntId: null,
    selectedBankId: 'CMB',
    activePanel: 'generate',     // generate | stats | report
    currentDoc: null,            // 当前预览的申报书对象
    lastMessage: null,           // { type, text }
    feedbackForm: { result: 'approved', amount: '', rate: '', term: '', note: '' }
  };

  // ============================================================
  //  悬浮按钮 + 覆盖面板挂载 (自包含, 不污染已有 DOM)
  // ============================================================
  let _fabMounted = false;

  function _mountFab() {
    if (_fabMounted || typeof document === 'undefined') return;
    _fabMounted = true;
    const btn = document.createElement('button');
    btn.id = 'eco-rpa-fab';
    btn.title = 'ECO-03 INFRA-05 无接口适配器 · 银行冷启动期破局 (AI 生成标准信贷申报书)';
    btn.innerHTML = '📜 <span>无接口适配器</span>';
    btn.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:9500',
      'padding:10px 16px', 'font-size:13px', 'font-weight:700',
      'color:#fff', 'background:linear-gradient(135deg,#1f6feb 0%,#bc8cff 100%)',
      'border:none', 'border-radius:22px', 'cursor:pointer',
      'box-shadow:0 4px 14px rgba(188,140,255,0.35)',
      'display:flex', 'align-items:center', 'gap:6px', 'transition:all .2s'
    ].join(';') + ';';
    btn.onmouseenter = () => { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 6px 18px rgba(188,140,255,0.45)'; };
    btn.onmouseleave = () => { btn.style.transform = 'translateY(0)'; btn.style.boxShadow = '0 4px 14px rgba(188,140,255,0.35)'; };
    btn.onclick = () => open();
    document.body.appendChild(btn);
  }

  function _ensureOverlay() {
    let overlay = document.getElementById('eco-rpa-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'eco-rpa-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9600',
      'background:rgba(0,0,0,0.55)', 'backdrop-filter:blur(3px)',
      'display:none', 'overflow:auto'
    ].join(';') + ';';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    return overlay;
  }

  // ============================================================
  //  开 / 关
  // ============================================================
  function open() {
    _state.open = true;
    // 默认选中当前企业
    if (typeof window !== 'undefined' && window.State && window.State.currentEnterpriseId) {
      _state.selectedEntId = window.State.currentEnterpriseId;
    }
    _render();
  }
  function close() {
    _state.open = false;
    const overlay = document.getElementById('eco-rpa-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ============================================================
  //  主渲染
  // ============================================================
  function _render() {
    if (!_state.open) return;
    const overlay = _ensureOverlay();
    overlay.style.display = 'block';
    overlay.innerHTML = `
      <div style="max-width:1180px;margin:24px auto;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.5);overflow:hidden">
        ${_renderHeader()}
        ${_renderTabs()}
        <div style="padding:18px 22px;max-height:72vh;overflow:auto">
          ${_renderMessage()}
          ${_state.activePanel === 'generate' ? _renderGeneratePanel() : ''}
          ${_state.activePanel === 'stats' ? _renderStatsPanel() : ''}
          ${_state.activePanel === 'report' ? _renderReportPanel() : ''}
        </div>
      </div>
    `;
    _bindEvents();
  }

  function _renderHeader() {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;background:linear-gradient(135deg,var(--bg-secondary) 0%,var(--bg-tertiary) 100%);border-bottom:1px solid var(--border-color)">
        <div>
          <div style="font-size:17px;font-weight:800;color:var(--text-primary)">
            📜 ECO-03 INFRA-05 无接口适配器
            <span style="font-size:11px;color:var(--accent-purple);margin-left:8px">银行冷启动期破局</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            AI 生成《XX 银行标准信贷申报书(含 AI 预审章)》PDF/Excel · 银行零开发接入 · 坏账率下降后触发 API 直连升级
          </div>
        </div>
        <button id="eco-rpa-close" title="关闭" style="background:transparent;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:4px">✕</button>
      </div>
    `;
  }

  function _renderTabs() {
    const tabs = [
      { id: 'generate', label: '📝 申报书生成', title: '生成与预览标准信贷申报书' },
      { id: 'stats', label: '📊 放款业绩', title: '银行无接口放款业绩统计 + 反馈回填' },
      { id: 'report', label: '🚀 API 升级报告', title: 'API 直连价值评估报告' }
    ];
    return `
      <div style="display:flex;gap:4px;padding:10px 22px 0;background:var(--bg-secondary);border-bottom:1px solid var(--border-color)">
        ${tabs.map(t => `
          <button class="eco-rpa-tab" data-panel="${t.id}" title="${t.title}"
            style="padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;border:none;border-bottom:2px solid ${_state.activePanel === t.id ? 'var(--accent-purple)' : 'transparent'};background:transparent;color:${_state.activePanel === t.id ? 'var(--text-primary)' : 'var(--text-muted)'};border-radius:4px 4px 0 0">
            ${t.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function _renderMessage() {
    if (!_state.lastMessage) return '';
    const m = _state.lastMessage;
    const color = m.type === 'error' ? 'var(--accent-red)' : m.type === 'warn' ? 'var(--accent-orange)' : 'var(--accent-green)';
    const bg = m.type === 'error' ? 'rgba(248,81,73,0.10)' : m.type === 'warn' ? 'rgba(210,153,34,0.10)' : 'rgba(63,185,80,0.10)';
    return `<div style="background:${bg};border-left:3px solid ${color};padding:8px 12px;border-radius:4px;font-size:12px;color:${color};margin-bottom:12px">${m.text}</div>`;
  }

  function _setMsg(type, text) {
    _state.lastMessage = { type, text };
  }

  // ============================================================
  //  面板 1: 申报书生成 (企业选择器 + 银行模板选择器 + 一键多银行 + 预览 + 下载)
  // ============================================================
  function _renderGeneratePanel() {
    const enterprises = (window.State && window.State.enterprises) || [];
    if (!_state.selectedEntId && enterprises.length) _state.selectedEntId = enterprises[0].id;
    const banks = window.EcoRpa.bankList;
    const bank = window.EcoRpa.banks[_state.selectedBankId];
    const doc = window.EcoRpa.findDoc(_state.selectedEntId, _state.selectedBankId);
    _state.currentDoc = doc;

    return `
      <!-- 控制区: 企业选择 + 银行选择 + 操作按钮 -->
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:14px">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">企业</label>
          <select id="eco-rpa-ent" style="background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:6px 10px;font-size:13px;min-width:220px">
            ${enterprises.map(e => `<option value="${e.id}" ${e.id === _state.selectedEntId ? 'selected' : ''}>${e.id} ${e.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">银行模板</label>
          <select id="eco-rpa-bank" style="background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:6px 10px;font-size:13px;min-width:180px">
            ${banks.map(b => `<option value="${b.id}" ${b.id === _state.selectedBankId ? 'selected' : ''}>${b.icon} ${b.name} (${b.importFormat.toUpperCase()})</option>`).join('')}
          </select>
        </div>
        <button id="eco-rpa-gen" style="padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--accent-blue);color:#fff;border:none;border-radius:4px">⚡ 生成申报书</button>
        <button id="eco-rpa-multibank" title="一键为该企业生成全部 5 家银行版本(并行投递, 自动加盖 AI 预审章)" style="padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--accent-purple);color:#fff;border:none;border-radius:4px">🚀 一键多银行</button>
        ${doc ? `
          <button id="eco-rpa-sign" title="AI 预审章电子签章 + MOD-08 链上存证 (SHA-256 不可篡改)" style="padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--accent-green);color:#fff;border:none;border-radius:4px">${doc.aiPreApproval && doc.aiPreApproval.signed ? '✅ 已盖章' : '🛡 盖 AI 预审章'}</button>
          <button id="eco-rpa-dl-csv" style="padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px">⬇ CSV</button>
          <button id="eco-rpa-dl-html" style="padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px">⬇ HTML</button>
        ` : ''}
      </div>

      <!-- 银行模板信息 -->
      <div style="background:rgba(188,140,255,0.06);border:1px solid var(--border-color);border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--text-secondary)">
        <b style="color:${bank.color}">${bank.icon} ${bank.name} · ${bank.productLine}</b>
        &nbsp;|&nbsp; 利率基准 ${bank.baseRate}% &nbsp;|&nbsp; 额度上限 ${(bank.maxAmount / 10000).toFixed(0)} 万
        &nbsp;|&nbsp; 期限 ${bank.defaultTerm} 月 &nbsp;|&nbsp; ${bank.requiresGuarantee ? '需担保' : '无担保'}
        &nbsp;|&nbsp; 导入格式 <b>${bank.importFormat.toUpperCase()}</b>
        &nbsp;|&nbsp; 必填 ${bank.requiredFields.length} 项
        <div style="margin-top:4px;color:var(--text-muted)">💡 ${bank.remark}</div>
      </div>

      ${doc ? _renderDocPreview(doc) : `
        <div style="text-align:center;padding:48px 20px;color:var(--text-muted)">
          <div style="font-size:40px;margin-bottom:10px">📄</div>
          <div>尚未生成申报书</div>
          <div style="font-size:12px;margin-top:6px">选择企业与银行模板, 点击「⚡ 生成申报书」自动渲染《${bank.name}标准信贷申报书》</div>
        </div>
      `}
    `;
  }

  // 申报书预览 (企业基本信息 + 8 维画像 + 五流摘要 + 建议授信 + AI 预审章)
  function _renderDocPreview(doc) {
    const bank = window.EcoRpa.banks[doc.bankId];
    const sc = doc.scorecard;
    const fs = doc.fiveStreams;
    const rc = doc.recommendedCredit;
    const ap = doc.aiPreApproval || {};
    const dims = window.EcoRpa.dimMeta;
    const dimKeys = Object.keys(dims);
    const amt = (n) => {
      if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
      if (n >= 10000) return (n / 10000).toFixed(0) + ' 万';
      return n + ' 元';
    };
    const streamBadge = (label, val) => {
      const color = val >= 100 ? 'var(--accent-green)' : val >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:12px">
          <span style="color:var(--text-secondary)">${label}</span>
          <span style="color:${color};font-weight:700">${val}%</span>
        </div>`;
    };

    return `
      <div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden">
        <!-- 申报书头 -->
        <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${bank.icon} ${doc.bankName} · ${doc.productLine}标准信贷申报书</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">编号 ${doc.docId} · 生成 ${doc.generatedAtLabel} · 导入格式 ${doc.importFormat.toUpperCase()}</div>
          </div>
          ${ap.signed ? `<span style="font-size:11px;color:var(--accent-green);border:1px solid var(--accent-green);padding:2px 8px;border-radius:10px">✅ 已盖 AI 预审章</span>` : `<span style="font-size:11px;color:var(--accent-orange);border:1px solid var(--accent-orange);padding:2px 8px;border-radius:10px">⏳ 待盖章</span>`}
        </div>

        <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- 左: 基本信息 + 五流 -->
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--accent-blue);margin-bottom:8px;border-left:3px solid var(--accent-blue);padding-left:6px">一、企业基本信息</div>
            ${_kvTable([
              ['客户名称', doc.basic.name],
              ['统一社会信用代码', doc.basic.creditCode],
              ['成立日期', doc.basic.establishDate],
              ['法定代表人', doc.basic.legalRep],
              ['注册资本', amt(doc.basic.registeredCapital)],
              ['所属行业', doc.basic.industry],
              ['经营范围', doc.basic.businessScope]
            ])}

            <div style="font-size:12px;font-weight:700;color:var(--accent-orange);margin:14px 0 8px;border-left:3px solid var(--accent-orange);padding-left:6px">三、五流证据链摘要</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${streamBadge('合同流', fs.contract)}
              ${streamBadge('发票流', fs.invoice)}
              ${streamBadge('物流流', fs.logistics)}
              ${streamBadge('资金流', fs.fund)}
              ${streamBadge('物联流', fs.iot)}
            </div>
          </div>

          <!-- 右: 8 维画像 + 建议授信 -->
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--accent-purple);margin-bottom:8px;border-left:3px solid var(--accent-purple);padding-left:6px">二、改造后 8 维画像</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${dimKeys.map(k => {
                const v = sc[k] || 0;
                const color = v >= 80 ? 'var(--accent-green)' : v >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)';
                return `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:11px">
                    <span style="color:var(--text-secondary)">${dims[k].icon} ${dims[k].label}</span>
                    <span style="color:${color};font-weight:700">${v}</span>
                  </div>`;
              }).join('')}
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:11px;grid-column:span 2">
                <span style="color:var(--text-secondary)">纳税等级 / 资产负债率 / 流动比率</span>
                <span style="color:var(--text-primary);font-weight:700">${_taxGradeLabel(sc.tax)} · ${doc.ratios.debtRatio}% · ${doc.ratios.currentRatio}</span>
              </div>
            </div>

            <div style="font-size:12px;font-weight:700;color:var(--accent-green);margin:14px 0 8px;border-left:3px solid var(--accent-green);padding-left:6px">四、建议授信额度 (MOD-16.9 测算)</div>
            ${_kvTable([
              ['建议授信额度', `<b style="color:var(--accent-green)">${amt(rc.amount)}</b>`],
              ['建议利率', rc.rate + '%'],
              ['建议期限', rc.term + ' 个月'],
              ['风险评级', rc.grade + ' 级'],
              ['建议产品', rc.productLine]
            ])}
          </div>
        </div>

        <!-- AI 预审章 -->
        <div style="margin:0 16px 14px;padding:12px;border:2px dashed var(--accent-purple);border-radius:8px;background:rgba(188,140,255,0.06);text-align:center">
          <div style="font-size:14px;font-weight:700;color:var(--accent-purple)">🛡 AI 预审章 (电子签章 + MOD-08 链上存证)</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:6px">
            AI 预审置信度: <b style="color:var(--accent-blue)">${ap.confidence}%</b>
            &nbsp;|&nbsp; 风险评级: <b>${ap.riskGrade || '-'}</b>
          </div>
          ${ap.signed ? `
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.7">
              链上存证哈希: <code style="color:var(--accent-green)">${ap.hash}</code><br>
              存证编号: <code>${ap.chainEvidenceId}</code> · 签发: ${ap.signedAt}<br>
              签发方: ${ap.signer}
            </div>
          ` : `<div style="font-size:11px;color:var(--accent-orange);margin-top:6px">未签发 · 点击「🛡 盖 AI 预审章」生成 SHA-256 不可篡改存证</div>`}
          <div style="font-size:10px;color:var(--text-muted);margin-top:8px;border-top:1px dashed var(--border-color);padding-top:6px">${ap.disclaimer}</div>
        </div>
      </div>
    `;
  }

  function _kvTable(rows) {
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      ${rows.map(r => `
        <tr>
          <td style="padding:5px 8px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-secondary);width:42%">${r[0]}</td>
          <td style="padding:5px 8px;border:1px solid var(--border-color);color:var(--text-primary)">${r[1]}</td>
        </tr>`).join('')}
    </table>`;
  }

  function _taxGradeLabel(taxScore) {
    if (taxScore >= 90) return 'A';
    if (taxScore >= 80) return 'B';
    if (taxScore >= 70) return 'C';
    if (taxScore >= 60) return 'M';
    return 'D';
  }

  // ============================================================
  //  面板 2: 放款业绩统计 + 银行反馈回填表单
  // ============================================================
  function _renderStatsPanel() {
    const banks = window.EcoRpa.bankList;
    const bankId = _state.selectedBankId;
    const stats = window.EcoRpa.getBankStats(bankId);
    const feedback = window.EcoRpa.listBankFeedback(bankId);
    const amt = (n) => {
      if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
      if (n >= 10000) return (n / 10000).toFixed(0) + ' 万';
      return n + ' 元';
    };

    return `
      <!-- 银行选择 -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${banks.map(b => `
          <button class="eco-rpa-stat-bank" data-bank="${b.id}" title="${b.remark}"
            style="padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;border-radius:4px;border:1px solid ${b.id === bankId ? 'var(--accent-purple)' : 'var(--border-color)'};background:${b.id === bankId ? 'rgba(188,140,255,0.15)' : 'var(--bg-tertiary)'};color:${b.id === bankId ? 'var(--accent-purple)' : 'var(--text-secondary)'}">
            ${b.icon} ${b.shortName}
          </button>
        `).join('')}
      </div>

      <!-- 业绩指标卡 -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
        ${_metricCard('累计放款', stats.totalLoans + ' 笔', 'var(--accent-blue)',
          `阈值 ${stats.threshold} 笔 · 进度 ${stats.progressToThreshold}%`)}
        ${_metricCard('累计金额', amt(stats.totalAmount), 'var(--accent-green)',
          `本系统推荐资产规模`)}
        ${_metricCard('本系统坏账率', (stats.ourBadDebtRate * 100).toFixed(2) + '%', 'var(--accent-green)',
          `坏账 ${stats.badDebtCount} 笔`)}
        ${_metricCard('该行整体坏账率', (stats.bankOverallBadDebtRate * 100).toFixed(2) + '%', 'var(--accent-orange)',
          `对比基准`)}
        ${_metricCard('坏账率降低', stats.badDebtReduction + '%', stats.badDebtReduction >= 50 ? 'var(--accent-green)' : 'var(--accent-orange)',
          stats.apiUpgradeTriggered ? '✅ 已触发 API 升级' : `差 ${stats.remainingToThreshold} 笔触发`)}
      </div>

      <!-- 进度条 -->
      <div style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:6px;padding:10px 12px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px">
          <span>API 直连升级进度 (累计放款 ${stats.totalLoans}/${stats.threshold} 笔 + 坏账率需低于该行整体 50%)</span>
          <span style="color:${stats.apiUpgradeTriggered ? 'var(--accent-green)' : 'var(--text-muted)'}">${stats.apiUpgradeTriggered ? '已满足' : '未满足'}</span>
        </div>
        <div style="height:8px;background:var(--bg-primary);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${stats.progressToThreshold}%;background:${stats.apiUpgradeTriggered ? 'var(--accent-green)' : 'linear-gradient(90deg,var(--accent-blue),var(--accent-purple))'};transition:width .3s"></div>
        </div>
      </div>

      <!-- 反馈回填表单 -->
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px">📝 银行审批结果回填 (APP-03 顾问运营台接口)</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">企业</label>
            <select id="eco-rpa-fb-ent" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
              ${((window.State && window.State.enterprises) || []).map(e => `<option value="${e.id}">${e.id} ${e.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">审批结果</label>
            <select id="eco-rpa-fb-result" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
              <option value="approved" ${_state.feedbackForm.result === 'approved' ? 'selected' : ''}>✅ 通过</option>
              <option value="rejected" ${_state.feedbackForm.result === 'rejected' ? 'selected' : ''}>❌ 拒绝</option>
              <option value="adjusted" ${_state.feedbackForm.result === 'adjusted' ? 'selected' : ''}>⚖ 调整额度</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">批复金额(元)</label>
            <input id="eco-rpa-fb-amount" type="number" placeholder="如 5000000" value="${_state.feedbackForm.amount}" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">批复利率(%) / 期限(月)</label>
            <div style="display:flex;gap:6px">
              <input id="eco-rpa-fb-rate" type="number" step="0.01" placeholder="利率" value="${_state.feedbackForm.rate}" style="flex:1;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
              <input id="eco-rpa-fb-term" type="number" placeholder="期限" value="${_state.feedbackForm.term}" style="flex:1;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
            </div>
          </div>
          <div style="grid-column:span 2">
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">备注</label>
            <input id="eco-rpa-fb-note" type="text" placeholder="风控意见 / 调整原因" value="${_state.feedbackForm.note}" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:5px 8px;font-size:12px">
          </div>
        </div>
        <button id="eco-rpa-fb-submit" style="margin-top:10px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;background:var(--accent-blue);color:#fff;border:none;border-radius:4px">提交回填</button>
      </div>

      <!-- 反馈记录列表 -->
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px">📋 ${stats.bankName} 反馈记录 (${feedback.length})</div>
        ${feedback.length === 0 ? `
          <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">暂无反馈记录 · 上方表单回填审批结果后将计入放款业绩</div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:6px">
            ${feedback.slice(0, 10).map(f => {
              const resultMap = { approved: { label: '通过', color: 'var(--accent-green)' }, rejected: { label: '拒绝', color: 'var(--accent-red)' }, adjusted: { label: '调整', color: 'var(--accent-orange)' } };
              const r = resultMap[f.result];
              return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-tertiary);border-radius:4px;font-size:12px">
                  <span style="color:${r.color};font-weight:700;min-width:40px">${r.label}</span>
                  <span style="color:var(--text-primary);min-width:160px">${f.enterpriseId}</span>
                  <span style="color:var(--text-secondary)">${f.approvedAmount ? amt(f.approvedAmount) : '-'}</span>
                  <span style="color:var(--text-muted);margin-left:auto;font-size:11px">${f.feedbackAtLabel}</span>
                </div>`;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  function _metricCard(label, value, color, sub) {
    return `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-left:3px solid ${color};border-radius:6px;padding:10px">
        <div style="font-size:11px;color:var(--text-muted)">${label}</div>
        <div style="font-size:18px;font-weight:700;color:${color};margin:3px 0">${value}</div>
        <div style="font-size:10px;color:var(--text-muted)">${sub}</div>
      </div>`;
  }

  // ============================================================
  //  面板 3: API 直连价值评估报告
  // ============================================================
  function _renderReportPanel() {
    const banks = window.EcoRpa.bankList;
    const bankId = _state.selectedBankId;
    const report = window.EcoRpa.getApiUpgradeReport(bankId);
    const m = report.metrics;

    return `
      <!-- 银行选择 -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${banks.map(b => `
          <button class="eco-rpa-report-bank" data-bank="${b.id}"
            style="padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;border-radius:4px;border:1px solid ${b.id === bankId ? 'var(--accent-purple)' : 'var(--border-color)'};background:${b.id === bankId ? 'rgba(188,140,255,0.15)' : 'var(--bg-tertiary)'};color:${b.id === bankId ? 'var(--accent-purple)' : 'var(--text-secondary)'}">
            ${b.icon} ${b.shortName}
          </button>
        `).join('')}
      </div>

      <!-- 报告正文 -->
      <div style="background:var(--bg-secondary);border:1px solid ${report.triggered ? 'var(--accent-green)' : 'var(--border-color)'};border-radius:8px;overflow:hidden">
        <div style="padding:14px 16px;background:linear-gradient(135deg,var(--bg-tertiary),var(--bg-secondary));border-bottom:1px solid var(--border-color)">
          <div style="font-size:16px;font-weight:800;color:${report.triggered ? 'var(--accent-green)' : 'var(--accent-orange)'}">
            🚀 《${report.bankName} API 直连价值评估报告》
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">生成时间 ${report.generatedAt} · ${report.specRef}</div>
        </div>

        <div style="padding:16px">
          <div style="background:${report.triggered ? 'rgba(63,185,80,0.10)' : 'rgba(210,153,34,0.10)'};border-left:3px solid ${report.triggered ? 'var(--accent-green)' : 'var(--accent-orange)'};padding:10px 12px;border-radius:4px;font-size:13px;font-weight:600;color:${report.triggered ? 'var(--accent-green)' : 'var(--accent-orange)'};margin-bottom:14px">
            ${report.headline}
          </div>

          <!-- 量化指标 -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
            ${_metricCard('累计放款笔数', m.totalLoans + ' 笔', 'var(--accent-blue)', `阈值 ${m.threshold} 笔`)}
            ${_metricCard('累计放款金额', m.totalAmount, 'var(--accent-green)', '本系统推荐规模')}
            ${_metricCard('本系统坏账率', m.ourBadDebtRate, 'var(--accent-green)', `vs 该行 ${m.bankOverallBadDebtRate}`)}
            ${_metricCard('坏账率降幅', m.badDebtReduction, parseFloat(m.badDebtReduction) >= 50 ? 'var(--accent-green)' : 'var(--accent-orange)', parseFloat(m.badDebtReduction) >= 50 ? '✅ 显著低于该行' : '⚠ 未达 50% 阈值')}
          </div>

          <!-- 建议 -->
          <div style="background:var(--bg-tertiary);border-radius:6px;padding:12px 14px;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:var(--accent-blue);margin-bottom:6px">📌 价值评估结论与建议</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7">${report.recommendation}</div>
          </div>

          <!-- 升级后路径 -->
          <div style="background:rgba(188,140,255,0.06);border:1px dashed var(--accent-purple);border-radius:6px;padding:12px 14px">
            <div style="font-size:12px;font-weight:700;color:var(--accent-purple);margin-bottom:6px">🔄 升级后路径</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7">${report.actionOnUpgrade}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:8px">
              冷启动期 (INFRA-05 无接口) → 信任建立后 → 热启动 (INFRA-01b API 直连) · 同一银行可并存, 推荐期用 INFRA-05, 直连后切 INFRA-01b
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function _bindEvents() {
    const $ = (id) => document.getElementById(id);

    $('eco-rpa-close').onclick = () => close();

    // Tab 切换
    document.querySelectorAll('.eco-rpa-tab').forEach(btn => {
      btn.onclick = () => { _state.activePanel = btn.dataset.panel; _render(); };
    });

    // 生成面板
    const entSel = $('eco-rpa-ent');
    const bankSel = $('eco-rpa-bank');
    if (entSel) entSel.onchange = () => { _state.selectedEntId = entSel.value; _state.lastMessage = null; _render(); };
    if (bankSel) bankSel.onchange = () => { _state.selectedBankId = bankSel.value; _state.lastMessage = null; _render(); };

    const genBtn = $('eco-rpa-gen');
    if (genBtn) genBtn.onclick = () => _handleGenerate(false);

    const mbBtn = $('eco-rpa-multibank');
    if (mbBtn) mbBtn.onclick = () => _handleGenerate(true);

    const signBtn = $('eco-rpa-sign');
    if (signBtn) signBtn.onclick = () => _handleSign();

    const csvBtn = $('eco-rpa-dl-csv');
    if (csvBtn) csvBtn.onclick = () => window.EcoRpa.downloadApplication(_state.selectedEntId, _state.selectedBankId, 'csv');

    const htmlBtn = $('eco-rpa-dl-html');
    if (htmlBtn) htmlBtn.onclick = () => window.EcoRpa.downloadApplication(_state.selectedEntId, _state.selectedBankId, 'html');

    // 业绩面板银行切换
    document.querySelectorAll('.eco-rpa-stat-bank').forEach(btn => {
      btn.onclick = () => { _state.selectedBankId = btn.dataset.bank; _render(); };
    });
    // 报告面板银行切换
    document.querySelectorAll('.eco-rpa-report-bank').forEach(btn => {
      btn.onclick = () => { _state.selectedBankId = btn.dataset.bank; _render(); };
    });

    // 反馈表单提交
    const fbBtn = $('eco-rpa-fb-submit');
    if (fbBtn) fbBtn.onclick = () => _handleFeedback();
  }

  async function _handleGenerate(multiBank) {
    try {
      if (multiBank) {
        _setMsg('warn', '正在为该企业并行生成全部银行版本(自动加盖 AI 预审章)...');
        _render();
        const results = await window.EcoRpa.generateMultiBank(_state.selectedEntId);
        const ok = results.filter(r => !r.error);
        _setMsg('success', `一键多银行完成: 成功生成 ${ok.length}/${results.length} 家银行版本(并行投递, 已盖 AI 预审章)`);
        _render();
      } else {
        const doc = await window.EcoRpa.generateApplication(_state.selectedEntId, _state.selectedBankId);
        _state.currentDoc = doc;
        _setMsg('success', `已生成《${doc.bankName}标准信贷申报书》(${doc.docId}) · 可下载或盖 AI 预审章`);
        _render();
      }
    } catch (e) {
      _setMsg('error', '生成失败: ' + e.message);
      _render();
    }
  }

  async function _handleSign() {
    try {
      const doc = window.EcoRpa.findDoc(_state.selectedEntId, _state.selectedBankId);
      if (!doc) { _setMsg('error', '请先生成申报书'); _render(); return; }
      const ap = await window.EcoRpa.signAiPreApproval(doc.docId);
      _setMsg('success', `AI 预审章已签发 · 链上存证哈希 ${ap.hash.substring(0, 16)}... · 存证编号 ${ap.chainEvidenceId}`);
      _render();
    } catch (e) {
      _setMsg('error', '签章失败: ' + e.message);
      _render();
    }
  }

  async function _handleFeedback() {
    try {
      const entId = document.getElementById('eco-rpa-fb-ent').value;
      const result = document.getElementById('eco-rpa-fb-result').value;
      const amount = parseFloat(document.getElementById('eco-rpa-fb-amount').value) || 0;
      const rate = parseFloat(document.getElementById('eco-rpa-fb-rate').value) || null;
      const term = parseInt(document.getElementById('eco-rpa-fb-term').value, 10) || null;
      const note = document.getElementById('eco-rpa-fb-note').value;
      _state.feedbackForm = { result, amount: document.getElementById('eco-rpa-fb-amount').value, rate: document.getElementById('eco-rpa-fb-rate').value, term: document.getElementById('eco-rpa-fb-term').value, note };
      const rec = await window.EcoRpa.recordBankFeedback(_state.selectedBankId, { enterpriseId: entId, result, approvedAmount: amount, approvedRate: rate, approvedTerm: term, note });
      const labelMap = { approved: '通过', rejected: '拒绝', adjusted: '调整额度' };
      _setMsg('success', `已回填 ${rec.bankName} 审批结果: ${labelMap[rec.result]}${amount ? ' · ' + amount + ' 元' : ''}`);
      _render();
    } catch (e) {
      _setMsg('error', '回填失败: ' + e.message);
      _render();
    }
  }

  // ============================================================
  //  启动: 挂载悬浮按钮
  // ============================================================
  function _boot() {
    _mountFab();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _boot);
    } else {
      _boot();
    }
  }

  // ============================================================
  //  公共 API 导出
  // ============================================================
  return {
    render: _render,
    open,
    close,
    version: 'ECO-03 INFRA-05 View v3.1'
  };
})();
