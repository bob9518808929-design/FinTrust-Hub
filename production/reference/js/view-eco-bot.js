/** 文件名：view-eco-bot.js 职责：ECO-09 数字分身 AI Agent 视图,仿微信深色聊天 UI 与浮动面板 */
//
// 仿微信聊天界面（深色主题）：
//   - 左右对话气泡：机器人右侧蓝色 / 用户左侧灰色
//   - 输入框 + 发送按钮 + 语音输入按钮（麦克风图标）
//   - 敏感操作卡片渲染（带 ✓ 确认 / ✗ 取消 按钮）
//   - 对话历史滚动列表（自动滚到底部）
//   - 企业绑定状态展示
//   - 预设快捷指令按钮（"查应收到期" "申请融资" "查改造进度" 等）
//   - 全部使用深色主题 CSS 变量（var(--bg-*) / var(--text-*) / var(--accent-*)）
//
// 使用方式：
//   1. EcoBotView.render('containerId')          // 渲染到指定容器
//   2. EcoBotView.openFloating()                  // 浮动面板模式（不依赖 index.html 改动）
//   3. EcoBotView.closeFloating()                 // 关闭浮动面板
//   4. EcoBotView.switchEnterprise('E001')        // 切换绑定企业

(function () {
  'use strict';

  var QUICK_COMMANDS = [
    { label: '查应收到期', text: '帮我查下最近哪笔应收款快到期了' },
    { label: '申请融资',   text: '申请一笔 50 万的过桥资金' },
    { label: '查通过率',   text: '我这个月贷款通过率涨了没' },
    { label: '查改造进度', text: '我的改造还要做啥' },
    { label: '签承诺书',   text: '我要签承诺书' },
    { label: '帮助',       text: '你能做什么' }
  ];

  var CSS_INJECTED = false;
  var STYLE_ID = 'eco-bot-view-styles';

  // 一次性注入聊天专属样式（深色主题，全部用 CSS 变量）
  function injectStyles() {
    if (CSS_INJECTED) return;
    if (document.getElementById(STYLE_ID)) { CSS_INJECTED = true; return; }
    var css = `
.ecobot-wrap {
  display: flex; flex-direction: column;
  height: 100%; min-height: 520px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
}
.ecobot-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.ecobot-header-left { display: flex; align-items: center; gap: 8px; }
.ecobot-avatar {
  width: 36px; height: 36px; border-radius: 8px;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.ecobot-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.ecobot-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.ecobot-status-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent-green); margin-right: 4px;
  box-shadow: 0 0 6px rgba(63,185,80,0.6);
}
.ecobot-status-dot.offline { background: var(--text-muted); box-shadow: none; }
.ecobot-channel-chips { display: flex; gap: 6px; }
.ecobot-channel-chip {
  font-size: 10px; padding: 2px 7px; border-radius: 10px;
  background: rgba(88,166,255,0.12); color: var(--accent-blue);
  border: 1px solid rgba(88,166,255,0.3);
}
.ecobot-channel-chip.offline { background: rgba(110,118,129,0.12); color: var(--text-muted); border-color: var(--border-color); }
.ecobot-ent-select {
  background: var(--bg-tertiary); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 6px;
  padding: 4px 8px; font-size: 12px; outline: none;
}
.ecobot-ent-select option { background: var(--bg-secondary); }

.ecobot-quickbar {
  display: flex; gap: 6px; padding: 8px 12px; overflow-x: auto;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.ecobot-quickbar::-webkit-scrollbar { height: 4px; }
.ecobot-quickbar::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.ecobot-quick-btn {
  white-space: nowrap; flex-shrink: 0;
  padding: 5px 12px; font-size: 12px;
  background: var(--bg-tertiary); color: var(--text-secondary);
  border: 1px solid var(--border-color); border-radius: 14px;
  cursor: pointer; transition: all 0.15s;
}
.ecobot-quick-btn:hover {
  background: rgba(88,166,255,0.15); color: var(--accent-blue);
  border-color: var(--accent-blue);
}

.ecobot-msgs {
  flex: 1; overflow-y: auto; padding: 14px 12px;
  display: flex; flex-direction: column; gap: 12px;
  background: var(--bg-primary);
}
.ecobot-msgs::-webkit-scrollbar { width: 6px; }
.ecobot-msgs::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

.ecobot-msg { display: flex; gap: 8px; max-width: 88%; }
.ecobot-msg.user { align-self: flex-start; }
.ecobot-msg.bot  { align-self: flex-end; flex-direction: row-reverse; }
.ecobot-msg-avatar {
  width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.ecobot-msg.user .ecobot-msg-avatar { background: var(--bg-tertiary); color: var(--text-secondary); }
.ecobot-msg.bot  .ecobot-msg-avatar {
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
  color: #fff;
}
.ecobot-msg-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ecobot-msg.bot  .ecobot-msg-body { align-items: flex-end; }
.ecobot-msg.user .ecobot-msg-body { align-items: flex-start; }
.ecobot-msg-bubble {
  padding: 8px 12px; border-radius: 10px;
  line-height: 1.55; word-break: break-word;
  white-space: pre-wrap; font-size: 13px;
}
.ecobot-msg.user .ecobot-msg-bubble {
  background: var(--bg-tertiary); color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-top-left-radius: 2px;
}
.ecobot-msg.bot .ecobot-msg-bubble {
  background: var(--accent-blue-dark); color: #fff;
  border-top-right-radius: 2px;
}
.ecobot-msg-time { font-size: 10px; color: var(--text-muted); padding: 0 4px; }
.ecobot-msg.typing .ecobot-msg-bubble {
  display: inline-flex; gap: 3px; padding: 12px 14px;
}
.ecobot-msg.typing .ecobot-dot {
  width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.6);
  animation: ecobotBlink 1.4s infinite both;
}
.ecobot-msg.typing .ecobot-dot:nth-child(2) { animation-delay: 0.2s; }
.ecobot-msg.typing .ecobot-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ecobotBlink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.ecobot-card {
  background: var(--bg-tertiary); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 10px;
  padding: 10px 12px; max-width: 340px; min-width: 240px;
  border-top-right-radius: 2px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
}
.ecobot-card-title {
  font-size: 13px; font-weight: 700; color: var(--text-primary);
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
}
.ecobot-card-summary {
  font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;
  line-height: 1.5;
}
.ecobot-card-fields {
  display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;
  padding: 8px; background: var(--bg-secondary); border-radius: 6px;
}
.ecobot-card-field {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: 12px;
}
.ecobot-card-field-label { color: var(--text-muted); }
.ecobot-card-field-value { color: var(--text-primary); font-weight: 600; }
.ecobot-card-warnings {
  display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px;
}
.ecobot-card-warning {
  font-size: 11px; color: var(--accent-orange);
  background: rgba(210,153,34,0.1); border-left: 2px solid var(--accent-orange);
  padding: 4px 8px; border-radius: 4px;
}
.ecobot-card-actions { display: flex; gap: 8px; }
.ecobot-card-btn {
  flex: 1; padding: 7px 0; font-size: 12px; font-weight: 600;
  border: none; border-radius: 6px; cursor: pointer;
  transition: all 0.15s;
}
.ecobot-card-btn.confirm { background: var(--accent-green); color: #fff; }
.ecobot-card-btn.confirm:hover { box-shadow: 0 0 12px rgba(63,185,80,0.4); transform: translateY(-1px); }
.ecobot-card-btn.cancel { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color); }
.ecobot-card-btn.cancel:hover { color: var(--accent-red); border-color: var(--accent-red); }
.ecobot-card-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ecobot-card-status {
  font-size: 11px; color: var(--text-muted); margin-top: 6px; text-align: center;
}
.ecobot-card-status.ok { color: var(--accent-green); }
.ecobot-card-status.fail { color: var(--accent-red); }
.ecobot-card-status.cancelled { color: var(--text-muted); }

.ecobot-input-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
.ecobot-voice-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-tertiary); color: var(--text-secondary);
  border: 1px solid var(--border-color); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0; transition: all 0.15s;
}
.ecobot-voice-btn:hover { color: var(--accent-blue); border-color: var(--accent-blue); }
.ecobot-voice-btn.recording {
  background: var(--accent-red); color: #fff; border-color: var(--accent-red);
  animation: ecobotPulse 1.5s infinite;
}
.ecobot-voice-btn.disabled { opacity: 0.4; cursor: not-allowed; }
@keyframes ecobotPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248,81,73,0.5); }
  50% { box-shadow: 0 0 0 8px rgba(248,81,73,0); }
}
.ecobot-input {
  flex: 1; min-width: 0;
  background: var(--bg-tertiary); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 18px;
  padding: 8px 14px; font-size: 13px; outline: none;
  font-family: inherit;
}
.ecobot-input:focus { border-color: var(--accent-blue); }
.ecobot-input::placeholder { color: var(--text-muted); }
.ecobot-send-btn {
  padding: 8px 18px; font-size: 13px; font-weight: 600;
  background: var(--accent-blue); color: #fff;
  border: none; border-radius: 18px; cursor: pointer;
  flex-shrink: 0; transition: all 0.15s;
}
.ecobot-send-btn:hover { background: var(--accent-blue-dark); box-shadow: 0 0 12px rgba(88,166,255,0.4); }
.ecobot-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.ecobot-floating-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 9999; display: flex; align-items: center; justify-content: center;
  animation: ecobotFadeIn 0.2s;
}
@keyframes ecobotFadeIn { from { opacity: 0; } to { opacity: 1; } }
.ecobot-floating-panel {
  width: 460px; max-width: 95vw; height: 640px; max-height: 90vh;
  background: var(--bg-primary);
  border: 1px solid var(--border-color); border-radius: 12px;
  overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  animation: ecobotSlideUp 0.25s;
}
@keyframes ecobotSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.ecobot-close-btn {
  background: transparent; color: var(--text-muted);
  border: 1px solid var(--border-color); border-radius: 6px;
  width: 26px; height: 26px; cursor: pointer; font-size: 14px;
}
.ecobot-close-btn:hover { color: var(--accent-red); border-color: var(--accent-red); }
.ecobot-system-msg {
  align-self: center; font-size: 11px; color: var(--text-muted);
  background: var(--bg-secondary); padding: 3px 10px; border-radius: 10px;
  border: 1px solid var(--border-color);
}
.ecobot-empty {
  text-align: center; color: var(--text-muted); font-size: 12px;
  padding: 30px 10px; line-height: 1.8;
}
`;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
    CSS_INJECTED = true;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  //  EcoBotView 对象
  // ============================================================

  var EcoBotView = {
    _container: null,
    _containerId: null,
    _floatingMask: null,
    _typingId: null,

    // === 渲染到指定容器 ===
    render: function (containerId) {
      injectStyles();
      var container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;
      if (!container) {
        console.warn('[EcoBotView] 容器不存在:', containerId);
        return;
      }
      this._container = container;
      this._containerId = container.id || 'eco-bot-container';
      container.innerHTML = this._buildShellHTML();
      this._bindEvents();
      this._refreshHeader();
      this._renderMessages();
      // 首次进入自动问候
      this._autoGreetIfNeeded();
    },

    // === 浮动面板模式 ===
    openFloating: function () {
      if (this._floatingMask) {
        // 已打开，置顶
        return;
      }
      injectStyles();
      var mask = document.createElement('div');
      mask.className = 'ecobot-floating-mask';
      mask.innerHTML = '<div class="ecobot-floating-panel" id="ecobot-floating-root"></div>';
      document.body.appendChild(mask);
      this._floatingMask = mask;
      mask.addEventListener('click', function (e) {
        if (e.target === mask) EcoBotView.closeFloating();
      });
      this.render('ecobot-floating-root');
    },

    closeFloating: function () {
      if (this._floatingMask) {
        document.body.removeChild(this._floatingMask);
        this._floatingMask = null;
        this._container = null;
        this._containerId = null;
      }
    },

    // === 切换绑定企业 ===
    switchEnterprise: function (entId) {
      var ok = window.EcoBot.bindEnterprise(entId);
      if (ok) {
        this._refreshHeader();
        this._renderMessages();
        this._autoGreetIfNeeded();
      }
      return ok;
    },

    // ============================================================
    //  内部构建
    // ============================================================

    _buildShellHTML: function () {
      return [
        '<div class="ecobot-wrap" id="ecobot-wrap-' + this._containerId + '">',
        '  <div class="ecobot-header" id="ecobot-header-' + this._containerId + '"></div>',
        '  <div class="ecobot-quickbar">',
        QUICK_COMMANDS.map(function (q) {
          return '<button class="ecobot-quick-btn" data-cmd="' + escapeHtml(q.text) + '" title="' + escapeHtml(q.text) + '">' + escapeHtml(q.label) + '</button>';
        }).join(''),
        '  </div>',
        '  <div class="ecobot-msgs" id="ecobot-msgs-' + this._containerId + '"></div>',
        '  <div class="ecobot-input-bar">',
        '    <button class="ecobot-voice-btn" id="ecobot-voice-btn-' + this._containerId + '" title="语音输入（Web Speech API）">🎤</button>',
        '    <input type="text" class="ecobot-input" id="ecobot-input-' + this._containerId + '" placeholder="和数字员工聊天，比如「查应收到期」…" />',
        '    <button class="ecobot-send-btn" id="ecobot-send-btn-' + this._containerId + '">发送</button>',
        '  </div>',
        '</div>'
      ].join('');
    },

    _bindEvents: function () {
      var self = this;
      var cid = this._containerId;

      var sendBtn = document.getElementById('ecobot-send-btn-' + cid);
      var input = document.getElementById('ecobot-input-' + cid);
      var voiceBtn = document.getElementById('ecobot-voice-btn-' + cid);

      if (sendBtn) sendBtn.addEventListener('click', function () { self._onSend(); });
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            self._onSend();
          }
        });
      }
      if (voiceBtn) {
        voiceBtn.addEventListener('click', function () { self._onVoice(); });
        // 不支持语音时禁用
        if (!window.EcoBot.isVoiceSupported()) {
          voiceBtn.classList.add('disabled');
          voiceBtn.title = '当前浏览器不支持语音输入，已降级为文字';
        }
      }

      // 快捷指令
      var wrap = document.getElementById('ecobot-wrap-' + cid);
      if (wrap) {
        wrap.querySelectorAll('.ecobot-quick-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var text = btn.getAttribute('data-cmd');
            if (input) input.value = text;
            self._onSend();
          });
        });
      }
    },

    _refreshHeader: function () {
      var cid = this._containerId;
      var header = document.getElementById('ecobot-header-' + cid);
      if (!header) return;
      var info = window.EcoBot.getPlatformInfo();
      var entSelect = '';
      if (typeof State !== 'undefined' && Array.isArray(State.enterprises)) {
        var opts = State.enterprises.map(function (e) {
          var sel = e.id === info.enterpriseId ? ' selected' : '';
          return '<option value="' + escapeHtml(e.id) + '"' + sel + '>' + escapeHtml(e.name) + '</option>';
        }).join('');
        entSelect = '<select class="ecobot-ent-select" id="ecobot-ent-select-' + cid + '" title="切换绑定企业">' + opts + '</select>';
      }
      header.innerHTML =
        '<div class="ecobot-header-left">' +
        '  <div class="ecobot-avatar">🤖</div>' +
        '  <div>' +
        '    <div class="ecobot-title">数字员工 · 小融</div>' +
        '    <div class="ecobot-subtitle">' +
        '    <span class="ecobot-status-dot ' + (info.bound ? '' : 'offline') + '"></span>' +
        (info.bound ? ('已绑定: ' + escapeHtml(info.enterpriseName)) : '未绑定企业') +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '  <div class="ecobot-channel-chips">' +
        info.channels.map(function (ch) {
          return '<span class="ecobot-channel-chip ' + (ch.status === 'online' ? '' : 'offline') + '" title="' + escapeHtml(ch.name) + '">' +
                 ch.icon + ' ' + escapeHtml(ch.name.replace('机器人', '')) + '</span>';
        }).join('') +
        '  </div>' +
        entSelect +
        (this._floatingMask ? '<button class="ecobot-close-btn" id="ecobot-close-' + cid + '" title="关闭">✕</button>' : '') +
        '</div>';

      // 绑定企业切换
      var sel = document.getElementById('ecobot-ent-select-' + cid);
      if (sel) {
        var self = this;
        sel.addEventListener('change', function () {
          self.switchEnterprise(sel.value);
        });
      }
      var closeBtn = document.getElementById('ecobot-close-' + cid);
      if (closeBtn) {
        closeBtn.addEventListener('click', function () { EcoBotView.closeFloating(); });
      }
    },

    _getMsgsEl: function () {
      return document.getElementById('ecobot-msgs-' + this._containerId);
    },

    _getInputEl: function () {
      return document.getElementById('ecobot-input-' + this._containerId);
    },

    _getSendBtnEl: function () {
      return document.getElementById('ecobot-send-btn-' + this._containerId);
    },

    _getVoiceBtnEl: function () {
      return document.getElementById('ecobot-voice-btn-' + this._containerId);
    },

    _scrollToBottom: function () {
      var el = this._getMsgsEl();
      if (el) el.scrollTop = el.scrollHeight;
    },

    // === 渲染对话历史 ===
    _renderMessages: function () {
      var el = this._getMsgsEl();
      if (!el) return;
      var entId = window.EcoBot.getBoundEnterpriseId();
      var msgs = window.EcoBot.getConversation(entId);
      if (msgs.length === 0) {
        el.innerHTML = '<div class="ecobot-empty">👋 老板好，我是你的数字员工「小融」<br>直接告诉我你想做什么，或者点上面的快捷按钮<br>也可以点 🎤 用语音提问</div>';
        return;
      }
      var html = msgs.map(function (m) { return EcoBotView._renderMessageHTML(m); }).join('');
      el.innerHTML = html;
      this._scrollToBottom();
    },

    _renderMessageHTML: function (m) {
      // system 消息
      if (m.role === 'system') {
        return '<div class="ecobot-system-msg">' + escapeHtml(m.text) + '</div>';
      }
      var isBot = m.role === 'bot';
      var avatar = isBot ? '🤖' : '👤';
      var cls = isBot ? 'bot' : 'user';
      var html =
        '<div class="ecobot-msg ' + cls + '">' +
        '  <div class="ecobot-msg-avatar">' + avatar + '</div>' +
        '  <div class="ecobot-msg-body">' +
        '    <div class="ecobot-msg-bubble">' + escapeHtml(m.text) + '</div>' +
        '    <div class="ecobot-msg-time">' + escapeHtml(m.ts || '') + '</div>' +
        '  </div>' +
        '</div>';
      // 卡片（仅 bot 发送卡片）
      if (isBot && m.card) {
        html += EcoBotView._renderCardHTML(m.card);
      }
      return html;
    },

    _renderCardHTML: function (card) {
      if (!card) return '';
      var fields = (card.fields || []).map(function (f) {
        return '<div class="ecobot-card-field">' +
               '<span class="ecobot-card-field-label">' + escapeHtml(f.label) + '</span>' +
               '<span class="ecobot-card-field-value">' + escapeHtml(f.value) + '</span>' +
               '</div>';
      }).join('');
      var warnings = (card.warnings || []).map(function (w) {
        return '<div class="ecobot-card-warning">⚠ ' + escapeHtml(w) + '</div>';
      }).join('');

      var statusHTML = '';
      if (card.status === 'confirmed') {
        statusHTML = '<div class="ecobot-card-status ok">✓ 已确认</div>';
      } else if (card.status === 'cancelled') {
        statusHTML = '<div class="ecobot-card-status cancelled">✗ 已取消</div>';
      } else if (card.status === 'failed') {
        statusHTML = '<div class="ecobot-card-status fail">✗ 执行失败: ' + escapeHtml((card.result && card.result.error) || '未知错误') + '</div>';
      }

      var actionsHTML = '';
      if (!card.status) {
        actionsHTML =
          '<div class="ecobot-card-actions">' +
          '  <button class="ecobot-card-btn confirm" data-card-confirm="' + escapeHtml(card.id) + '">' + escapeHtml(card.confirmLabel || '✓ 确认') + '</button>' +
          '  <button class="ecobot-card-btn cancel" data-card-cancel="' + escapeHtml(card.id) + '">' + escapeHtml(card.cancelLabel || '✗ 取消') + '</button>' +
          '</div>';
      }

      return '<div class="ecobot-msg bot">' +
             '  <div class="ecobot-msg-avatar">🤖</div>' +
             '  <div class="ecobot-msg-body">' +
             '    <div class="ecobot-card" id="ecobot-card-' + escapeHtml(card.id) + '">' +
             '      <div class="ecobot-card-title">🔐 ' + escapeHtml(card.title || '敏感操作确认') + '</div>' +
             (card.summary ? '<div class="ecobot-card-summary">' + escapeHtml(card.summary) + '</div>' : '') +
             (fields ? '<div class="ecobot-card-fields">' + fields + '</div>' : '') +
             (warnings ? '<div class="ecobot-card-warnings">' + warnings + '</div>' : '') +
             actionsHTML +
             statusHTML +
             '    </div>' +
             '    <div class="ecobot-msg-time">' + escapeHtml(card.ts || '') + '</div>' +
             '  </div>' +
             '</div>';
    },

    // === 自动问候（首次进入或切换企业时） ===
    _autoGreetIfNeeded: function () {
      var entId = window.EcoBot.getBoundEnterpriseId();
      var msgs = window.EcoBot.getConversation(entId);
      if (msgs.length > 0) return;  // 已有对话记录，不打扰
      var ent = window.EcoBot.getBoundEnterprise();
      var greet = '👋 老板好，我是 ' + (ent ? ent.name : '你的企业') + ' 的数字员工「小融」。\n' +
                  '可以直接跟我聊天，比如：\n' +
                  '• 「查应收到期」— 看哪笔钱快到账\n' +
                  '• 「申请融资 50 万」— 帮你撮合银行并提交\n' +
                  '• 「改造进度」— 看企业改造还差啥\n' +
                  '也可以点 🎤 用语音提问。';
      window.EcoBot.appendMessage(entId, { role: 'bot', text: greet });
      this._renderMessages();
    },

    // === 发送一条用户消息 ===
    _onSend: async function () {
      var input = this._getInputEl();
      if (!input) return;
      var text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      var entId = window.EcoBot.getBoundEnterpriseId();
      if (!entId) {
        // 没绑定企业时也允许 chat（help 意图），但提示
        this._appendAndRender({ role: 'user', text: text });
        this._showTyping();
        var resp1 = await window.EcoBot.chat(text);
        this._hideTyping();
        this._appendAndRender({ role: 'bot', text: resp1.reply, card: resp1.card });
        return;
      }
      // 写入用户消息
      this._appendAndRender({ role: 'user', text: text });
      // 显示 typing
      this._showTyping();
      var self = this;
      // 模拟思考延迟（200-500ms）
      var delay = 200 + Math.floor(Math.random() * 300);
      setTimeout(async function () {
        try {
          var resp = await window.EcoBot.chat(text);
          self._hideTyping();
          var botMsg = { role: 'bot', text: resp.reply };
          if (resp.card) botMsg.card = resp.card;
          self._appendAndRender(botMsg);
        } catch (e) {
          self._hideTyping();
          self._appendAndRender({ role: 'bot', text: '抱歉，处理时出错了：' + (e.message || e) });
        }
      }, delay);
    },

    // === 语音输入 ===
    _onVoice: async function () {
      var btn = this._getVoiceBtnEl();
      var input = this._getInputEl();
      if (!btn) return;

      if (!window.EcoBot.isVoiceSupported()) {
        this._appendAndRender({ role: 'system', text: '当前浏览器不支持语音输入（Web Speech API 不可用），已降级为文字输入' });
        return;
      }
      if (window.EcoBot.isListening()) {
        window.EcoBot.stopVoiceInput();
        btn.classList.remove('recording');
        return;
      }
      btn.classList.add('recording');
      this._appendAndRender({ role: 'system', text: '🎤 录音中…请说话（说完会自动结束）' });
      var self = this;
      try {
        var result = await window.EcoBot.startVoiceInput();
        btn.classList.remove('recording');
        if (result.ok && result.text) {
          if (input) input.value = result.text;
          this._appendAndRender({ role: 'system', text: '✓ 语音识别: ' + result.text });
          this._onSend();
        } else {
          this._appendAndRender({ role: 'system', text: '✗ ' + (result.error || '语音识别失败') });
        }
      } catch (e) {
        btn.classList.remove('recording');
        this._appendAndRender({ role: 'system', text: '✗ 语音识别异常: ' + (e.message || e) });
      }
    },

    // === typing 动画 ===
    _showTyping: function () {
      var el = this._getMsgsEl();
      if (!el) return;
      var div = document.createElement('div');
      div.className = 'ecobot-msg bot typing';
      div.id = 'ecobot-typing-' + this._containerId;
      div.innerHTML =
        '<div class="ecobot-msg-avatar">🤖</div>' +
        '<div class="ecobot-msg-body"><div class="ecobot-msg-bubble">' +
        '<span class="ecobot-dot"></span><span class="ecobot-dot"></span><span class="ecobot-dot"></span>' +
        '</div></div>';
      el.appendChild(div);
      this._scrollToBottom();
    },

    _hideTyping: function () {
      var el = document.getElementById('ecobot-typing-' + this._containerId);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },

    // === 追加消息 + 立即渲染 + 绑定卡片事件 ===
    _appendAndRender: function (msg) {
      var entId = window.EcoBot.getBoundEnterpriseId();
      var saved = window.EcoBot.appendMessage(entId, msg);
      // 增量渲染（不重绘全部，提升性能）
      var el = this._getMsgsEl();
      if (el && saved) {
        // 清掉空状态提示
        var empty = el.querySelector('.ecobot-empty');
        if (empty) el.removeChild(empty);
        var tmp = document.createElement('div');
        tmp.innerHTML = this._renderMessageHTML(saved);
        while (tmp.firstChild) {
          el.appendChild(tmp.firstChild);
        }
        this._bindCardEvents(el);
        this._scrollToBottom();
      } else if (el && !saved) {
        // 没绑定企业时无法持久化，直接渲染
        var tmp2 = document.createElement('div');
        tmp2.innerHTML = this._renderMessageHTML(msg);
        while (tmp2.firstChild) el.appendChild(tmp2.firstChild);
        this._bindCardEvents(el);
        this._scrollToBottom();
      }
    },

    // === 绑定卡片确认/取消按钮 ===
    _bindCardEvents: function (root) {
      var self = this;
      var confirmBtns = root.querySelectorAll('.ecobot-card-btn.confirm:not([data-bound])');
      var cancelBtns = root.querySelectorAll('.ecobot-card-btn.cancel:not([data-bound])');
      confirmBtns.forEach(function (btn) {
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function () { self._onCardConfirm(btn); });
      });
      cancelBtns.forEach(function (btn) {
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function () { self._onCardCancel(btn); });
      });
    },

    _onCardConfirm: async function (btn) {
      var cardId = btn.getAttribute('data-card-confirm');
      if (!cardId) return;
      var cardEl = document.getElementById('ecobot-card-' + cardId);
      // 禁用按钮防止重复点击
      var card = this._findCardInDom(cardEl);
      if (card) {
        card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      }
      this._appendAndRender({ role: 'system', text: '⏳ 正在执行敏感操作…' });
      var result = await window.EcoBot.confirmCard(cardId);
      var reply;
      if (result.ok) {
        if (result.action && result.action.type === 'apply_financing') {
          reply = '✅ 融资申请已提交！\n' +
                  '• 金额: ' + (window.EcoBotPlainTalk ? window.EcoBotPlainTalk.money(result.amount) : result.amount) + '\n' +
                  '• 路由: ' + result.routeLevel + ' ' + result.routeDesc + '\n' +
                  (result.simulated ? '• （模拟器已模拟资金到账，可去 Tab2 查看流程）' : '• 资金已模拟到账，可去 Tab2 查看流程');
        } else if (result.signedAt) {
          reply = '✅ 承诺书已签署！\n' +
                  '• 签署时间: ' + result.signedAt + '\n' +
                  '• 已写入区块链存证（hash 上链），不可撤销\n' +
                  '• 已记录到企业改造动作历史';
        } else if (result.nav) {
          reply = '✅ 已为你打开「' + result.nav + '」工作台（如有 Tab 切换）';
        } else {
          reply = '✅ 操作已完成';
        }
      } else {
        reply = '✗ 操作失败: ' + (result.error || '未知错误');
      }
      this._appendAndRender({ role: 'bot', text: reply });
      // 重新渲染（让卡片显示状态）
      if (cardEl) {
        // 卡片状态由 _pendingCards 移除，所以渲染时不会再有按钮；这里直接更新该卡片 DOM
        var statusDiv = cardEl.querySelector('.ecobot-card-status');
        if (!statusDiv) {
          statusDiv = document.createElement('div');
          statusDiv.className = 'ecobot-card-status';
          cardEl.appendChild(statusDiv);
        }
        if (result.ok) {
          statusDiv.className = 'ecobot-card-status ok';
          statusDiv.textContent = '✓ 已确认 · 已执行';
        } else {
          statusDiv.className = 'ecobot-card-status fail';
          statusDiv.textContent = '✗ 执行失败: ' + (result.error || '未知错误');
        }
      }
    },

    _onCardCancel: function (btn) {
      var cardId = btn.getAttribute('data-card-cancel');
      if (!cardId) return;
      window.EcoBot.cancelCard(cardId);
      var cardEl = document.getElementById('ecobot-card-' + cardId);
      if (cardEl) {
        cardEl.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        var statusDiv = cardEl.querySelector('.ecobot-card-status');
        if (!statusDiv) {
          statusDiv = document.createElement('div');
          statusDiv.className = 'ecobot-card-status';
          cardEl.appendChild(statusDiv);
        }
        statusDiv.className = 'ecobot-card-status cancelled';
        statusDiv.textContent = '✗ 已取消';
      }
      this._appendAndRender({ role: 'system', text: '操作已取消' });
    },

    _findCardInDom: function (cardEl) {
      return cardEl;  // 简单返回，预留扩展
    },

    // === 公开: 清空对话 ===
    clearChat: function () {
      var entId = window.EcoBot.getBoundEnterpriseId();
      window.EcoBot.clearConversation(entId);
      this._renderMessages();
      this._autoGreetIfNeeded();
    }
  };

  // ============================================================
  //  导出
  // ============================================================
  window.EcoBotView = EcoBotView;

  // ============================================================
  //  开发者便捷入口（不修改 index.html，可用控制台唤起）
  //  控制台输入: EcoBotView.openFloating()
  // ============================================================
  // 也可以监听一个全局快捷键 Ctrl+Shift+B 唤起浮动面板
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      if (window.EcoBotView._floatingMask) {
        window.EcoBotView.closeFloating();
      } else {
        window.EcoBotView.openFloating();
      }
    }
  });

})();
