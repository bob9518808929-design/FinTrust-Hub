/**
 * view-modal.js — 通用 AI 决策弹窗 + 非阻塞Toast通知
 * ⛔ 阻塞Modal(队列): 需立即三操作决策 → approval审批 / bankAction银行风控
 * 💬 非阻塞Toast(右下角滑入): 仅通知/建议 → aiSuggestion AI研判 / penetration 穿透报告提醒
 * 三操作: 确认采纳 / 回复补充 / 提出不同意见
 */

const AIModal = {
  queue: [],               // modal 阻塞队列 (最多同时3个, 超过转toast防止无限弹窗链)
  current: null,
  maxModalQueue: 3,        // 防止弹窗链把用户锁死
  autoPopDisabled: false,  // 用户点"本次不再自动弹"后置true
  toastContainerId: 'ai-toast-container',
  toastSeq: 0,

  // 入队一个阻塞决策弹窗 (自动弹出下一个; 队列超上限转toast防滥用)
  enqueue(item) {
    if (this.queue.length >= this.maxModalQueue) {
      // 队列已满 → 降级为toast通知, 附"点此处理"跳转
      this.toast({
        type: item.type,
        title: item.title,
        text: (item.aiSuggestion || '').substring(0, 80) + '...',
        color: (item.type === 'approval') ? 'orange' : (item.type === 'bankAction' ? 'blue' : 'purple'),
        actionLabel: '点此处理',
        onAction: () => { if (typeof App !== 'undefined') {
          if (item.type === 'approval') App.switchTab('approval');
          else if (item.type === 'bankAction') App.switchTab('bank');
          else if (item.type === 'penetration') App.switchTab('regulatory');
          else App.switchTab('cockpit');
        }}
      });
      this.logSystem(`模态队列已满(${this.maxModalQueue}), 已降级为Toast: ${item.title}`);
      return;
    }
    this.queue.push(item);
    if (!this.current) this.showNext();
  },

  // 立即显示阻塞模态(跳过队列, 用于用户主动点击触发的即时弹窗)
  show(item) {
    if (this.current) {
      this.queue.unshift(item);
      return;
    }
    this._render(item);
  },

  showNext() {
    if (this.current) return;
    const next = this.queue.shift();
    if (next) this._render(next);
  },

  // === 非阻塞Toast通知 (右下角滑入, 不遮挡任何操作, 堆叠, 自动消失) ===
  // opts: { type, title, text, color(red/orange/blue/green/purple), duration_ms(默认6000), actionLabel, onAction, noDismiss }
  toast(opts) {
    // 确保toast容器存在
    let container = document.getElementById(this.toastContainerId);
    if (!container) {
      container = document.createElement('div');
      container.id = this.toastContainerId;
      container.className = 'ai-toast-container';
      document.body.appendChild(container);
    }
    const seq = ++this.toastSeq;
    const id = 'ai-toast-' + seq;
    const colorMap = {
      red: 'var(--accent-red)', orange: 'var(--accent-orange)', blue: 'var(--accent-blue)',
      green: 'var(--accent-green)', purple: 'var(--accent-purple)', cyan: 'var(--accent-cyan)'
    };
    const color = colorMap[opts.color] || colorMap.blue;
    const iconMap = {
      approval: '📋', penetration: '🔍', bankAction: '🏦', aiSuggestion: '🧠',
      alert: '⚠', info: 'ℹ', success: '✅'
    };
    const icon = iconMap[opts.type] || '💡';
    const duration = opts.duration_ms || 6000;

    const el = document.createElement('div');
    el.className = 'ai-toast';
    el.id = id;
    el.style.borderLeft = `4px solid ${color}`;
    el.innerHTML = `
      <div class="ai-toast-head">
        <span class="ai-toast-icon" style="color:${color}">${icon}</span>
        <div class="ai-toast-title">${opts.title || ''}</div>
        ${!opts.noDismiss ? `<button class="ai-toast-close" title="关闭" onclick="AIModal.closeToast('${id}')">✕</button>` : ''}
      </div>
      ${opts.text ? `<div class="ai-toast-text">${opts.text}</div>` : ''}
      ${opts.actionLabel && opts.onAction ? `<button class="ai-toast-action" onclick="AIModal.runToastAction('${id}', ${typeof opts.onAction === 'function' ? '1' : '0'})" title="点击跳转到对应页面处理">${opts.actionLabel}</button>` : ''}
      <div class="ai-toast-progress" style="background:${color}"></div>
    `;
    // 把onAction存在元素上（闭包保留引用）
    el._onAction = typeof opts.onAction === 'function' ? opts.onAction : null;
    el._timeoutHandle = setTimeout(() => this.closeToast(id), duration);
    container.appendChild(el);
    // 滑入动画触发
    requestAnimationFrame(() => { el.classList.add('ai-toast-enter'); });
    return id;
  },

  closeToast(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el._timeoutHandle) clearTimeout(el._timeoutHandle);
    el.classList.remove('ai-toast-enter');
    el.classList.add('ai-toast-exit');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
  },

  runToastAction(id, hasFn) {
    const el = document.getElementById(id);
    if (el && el._onAction) {
      try { el._onAction(); } catch (e) { console.warn('toast action err:', e); }
    }
    this.closeToast(id);
  },

  logSystem(msg) {
    try { State.log('system', msg, 'info'); } catch (e) {}
  },

  _render(item) {
    this.current = item;
    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay';
    overlay.id = 'ai-modal-overlay';

    const typeMeta = {
      approval: { icon: '📋', label: 'L3/L4 人工审批', color: 'var(--accent-orange)' },
      penetration: { icon: '🔍', label: '监管穿透报告', color: 'var(--accent-green)' },
      bankAction: { icon: '🏦', label: '银行风控操作', color: 'var(--accent-blue)' },
      aiSuggestion: { icon: '🧠', label: 'AI 综合研判', color: 'var(--accent-purple)' }
    };
    const meta = typeMeta[item.type] || typeMeta.aiSuggestion;

    overlay.innerHTML = `
      <div class="ai-modal-card">
        <!-- 头部 -->
        <div class="ai-modal-header" style="border-left:4px solid ${meta.color}">
          <div class="ai-modal-title">
            <span style="font-size:20px">${meta.icon}</span>
            <div>
              <div style="font-size:15px;font-weight:700">${item.title}</div>
              <div style="font-size:11px;color:var(--text-muted)">${meta.label} · ${item.timestamp || ''}</div>
            </div>
          </div>
          <button class="ai-modal-close" onclick="AIModal.dismiss('skip')" title="关闭(跳过本次决策,稍后可在对应Tab处理)">✕</button>
        </div>

        <div class="ai-modal-body">
          <!-- AI 建议区 -->
          ${item.aiSuggestion ? `
            <div class="ai-modal-section ai-modal-ai">
              <div class="ai-modal-section-title">🤖 AI 建议</div>
              <div class="ai-modal-ai-text">${item.aiSuggestion}</div>
              ${item.aiConfidence != null ? `
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                  <span style="font-size:11px;color:var(--text-muted)">置信度</span>
                  <div class="confidence-bar" style="flex:1;max-width:200px">
                    <div class="confidence-fill" style="width:${item.aiConfidence}%"></div>
                  </div>
                  <span style="font-size:13px;font-weight:700;color:${item.aiConfidence >= 80 ? 'var(--accent-green)' : item.aiConfidence >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)'}">${item.aiConfidence}%</span>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <!-- 决策上下文区 (自定义HTML) -->
          ${item.contextHTML ? `
            <div class="ai-modal-section">
              <div class="ai-modal-section-title">📊 决策上下文</div>
              ${item.contextHTML}
            </div>
          ` : ''}

          <!-- 可输入区 (回复/不同意见时显示) -->
          <div class="ai-modal-input-wrap" id="ai-modal-input-wrap" style="display:none">
            <div class="ai-modal-section-title" id="ai-modal-input-label">回复内容</div>
            <textarea class="ai-modal-textarea" id="ai-modal-textarea" placeholder="请输入回复/不同意见说明..." rows="3"></textarea>
          </div>
        </div>

        <!-- 操作区 -->
        <div class="ai-modal-actions">
          <button class="btn btn-success btn-sm" onclick="AIModal.confirm()" title="采纳AI建议,执行对应流程">${item.confirmLabel || '✓ 确认采纳'}</button>
          <button class="btn btn-warning btn-sm" onclick="AIModal.replyMode()" title="补充材料/回复说明,退回流程">${item.replyLabel || '↩ 回复补充'}</button>
          <button class="btn btn-danger btn-sm" onclick="AIModal.dissentMode()" title="否决/提出不同意见,终止或调整">${item.dissentLabel || '✗ 提出不同意见'}</button>
        </div>

        ${this.queue.length > 0 ? `<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:4px 0 0">队列中还有 ${this.queue.length} 项待处理</div>` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    // 点击遮罩外区域不关闭(防止误跳过决策), 仅ESC可跳过
  },

  // 切换到回复输入模式
  replyMode() {
    const wrap = document.getElementById('ai-modal-input-wrap');
    const label = document.getElementById('ai-modal-input-label');
    const ta = document.getElementById('ai-modal-textarea');
    wrap.style.display = 'block';
    label.textContent = '回复/补充说明:';
    ta.placeholder = '请输入回复内容或补充材料说明...';
    ta.focus();
    // 替换操作按钮为提交
    this._setActions([
      { label: '✓ 提交回复', cls: 'btn-success', action: 'submitReply' },
      { label: '← 返回', cls: 'btn-outline', action: 'resetActions' }
    ]);
  },

  // 切换到不同意见输入模式
  dissentMode() {
    const wrap = document.getElementById('ai-modal-input-wrap');
    const label = document.getElementById('ai-modal-input-label');
    const ta = document.getElementById('ai-modal-textarea');
    wrap.style.display = 'block';
    label.textContent = '不同意见说明:';
    ta.placeholder = '请说明您的不同意见及理由...';
    ta.focus();
    this._setActions([
      { label: '✗ 提交否决', cls: 'btn-danger', action: 'submitDissent' },
      { label: '← 返回', cls: 'btn-outline', action: 'resetActions' }
    ]);
  },

  // 重置回三操作
  resetActions() {
    const wrap = document.getElementById('ai-modal-input-wrap');
    if (wrap) wrap.style.display = 'none';
    const item = this.current;
    if (!item) return;
    this._setActions([
      { label: item.confirmLabel || '✓ 确认采纳', cls: 'btn-success', action: 'confirm' },
      { label: item.replyLabel || '↩ 回复补充', cls: 'btn-warning', action: 'replyMode' },
      { label: item.dissentLabel || '✗ 提出不同意见', cls: 'btn-danger', action: 'dissentMode' }
    ]);
  },

  // 确认采纳
  confirm() {
    const item = this.current;
    if (item && item.onConfirm) item.onConfirm('');
    this._afterAction('confirm');
  },

  // 提交回复
  submitReply() {
    const text = document.getElementById('ai-modal-textarea').value.trim();
    const item = this.current;
    if (item && item.onReply) item.onReply(text);
    this._afterAction('reply');
  },

  // 提交不同意见
  submitDissent() {
    const text = document.getElementById('ai-modal-textarea').value.trim();
    const item = this.current;
    if (item && item.onDissent) item.onDissent(text);
    this._afterAction('dissent');
  },

  // 跳过/关闭
  dismiss(reason) {
    const item = this.current;
    if (item && item.onDismiss) item.onDismiss(reason);
    this._afterAction('dismiss');
  },

  _afterAction(reason) {
    const overlay = document.getElementById('ai-modal-overlay');
    if (overlay) overlay.remove();
    this.current = null;
    // 弹下一个
    setTimeout(() => this.showNext(), 100);
  },

  _setActions(actions) {
    const actionsEl = document.querySelector('.ai-modal-actions');
    if (!actionsEl) return;
    actionsEl.innerHTML = actions.map(a =>
      `<button class="btn ${a.cls} btn-sm" onclick="AIModal.${a.action}()" title="">${a.label}</button>`
    ).join('');
  }
};

window.AIModal = AIModal;
