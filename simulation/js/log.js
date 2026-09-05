/**
 * log.js — 联动日志面板 (因果链输出 + 过滤 + 搜索 + 导出 + 哈希指纹存证 MOD-08)
 */

const LogPanel = {
  // MOD-08: 简易哈希函数(FNV-1a 32位) → 模拟区块链存证指纹
  _hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  },

  // 计算单条日志指纹
  entryHash(l) {
    return this._hash(`${l.timestamp}|${l.view}|${l.type}|${l.message}`);
  },

  // 计算全部日志的 Merkle 根指纹 (模拟MOD-08区块链存证)
  merkleRoot() {
    const logs = State.linkageLog;
    if (logs.length === 0) return '00000000';
    let layer = logs.map(l => this.entryHash(l));
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        next.push(this._hash(layer[i] + (layer[i + 1] || layer[i])));
      }
      layer = next;
    }
    return layer[0];
  },

  render() {
    const container = document.getElementById('log-panel-body');
    if (!container) return;

    const { view, type, keyword } = State.logFilter;
    let logs = State.linkageLog;

    if (view !== 'all') logs = logs.filter(l => l.view === view);
    if (type !== 'all') logs = logs.filter(l => l.type === type);
    if (keyword) logs = logs.filter(l => l.message.includes(keyword));

    if (logs.length === 0) {
      container.innerHTML = '<div class="log-empty">暂无日志记录</div>';
      return;
    }

    const typeColors = {
      config: '#2196f3',
      financing: '#4caf50',
      alert: '#f44336',
      policy: '#9c27b0',
      info: '#607d8b',
      system: '#607d8b',
      fallback: '#ff9800',
      reform: '#10b981'
    };

    const viewLabels = {
      enterprise: '企业端',
      flow: '流程',
      approval: '审批',
      bank: '银行端',
      institution: '担保与保险',
      advisor: '运营台',
      cockpit: 'AI驾驶舱',
      fallback: '兜底引擎',
      regulatory: '监管',
      partner: '机构',
      system: '系统',
      reform: '改造工作台'
    };

    container.innerHTML = logs.slice(-200).reverse().map(l => {
      const color = typeColors[l.type] || typeColors.info;
      const isAlert = l.type === 'alert';
      const isArrow = l.message.startsWith('→');
      const fp = this.entryHash(l);
      return `
        <div class="log-entry ${isAlert ? 'log-alert' : ''} ${isArrow ? 'log-arrow' : ''}">
          <span class="log-time">${l.timestamp}</span>
          <span class="log-view" style="color:${color}">[${viewLabels[l.view] || l.view}]</span>
          <span class="log-msg">${l.message}</span>
          <span class="log-hash" title="MOD-08 区块链存证指纹">${fp}</span>
        </div>
      `;
    }).join('');

    // 自动滚动到最新
    container.scrollTop = 0;
  },

  renderHeader() {
    const header = document.getElementById('log-panel-header');
    if (!header) return;

    const { view, type } = State.logFilter;
    const viewOptions = [
      { value: 'all', label: '全部' },
      { value: 'reform', label: '改造工作台' },
      { value: 'enterprise', label: '企业端' },
      { value: 'flow', label: '流程' },
      { value: 'approval', label: '审批' },
      { value: 'bank', label: '银行端' },
      { value: 'fallback', label: '兜底引擎' },
      { value: 'system', label: '系统' }
    ];
    const typeOptions = [
      { value: 'all', label: '全部类型' },
      { value: 'reform', label: '改造' },
      { value: 'config', label: '配置' },
      { value: 'financing', label: '融资' },
      { value: 'alert', label: '预警' },
      { value: 'policy', label: '政策' },
      { value: 'fallback', label: '兜底' }
    ];

    header.innerHTML = `
      <div class="log-controls">
        <span class="log-title">📋 联动日志</span>
        <span class="log-merkle" title="MOD-08 区块链存证 Merkle根指纹 (全部日志不可篡改证明)">⛓ ${this.merkleRoot()}</span>
        <select id="log-filter-view" class="log-select">
          ${viewOptions.map(o => `<option value="${o.value}" ${view === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <select id="log-filter-type" class="log-select">
          ${typeOptions.map(o => `<option value="${o.value}" ${type === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <input type="text" id="log-search" class="log-search" placeholder="搜索关键词..." value="${State.logFilter.keyword}">
        <button id="log-export" class="log-btn">导出</button>
        <button id="log-clear" class="log-btn">清空</button>
        <button id="log-toggle" class="log-btn">${State.logPanelCollapsed ? '展开 ▲' : '折叠 ▼'}</button>
      </div>
    `;

    document.getElementById('log-filter-view').onchange = (e) => {
      State.logFilter.view = e.target.value;
      this.render();
    };
    document.getElementById('log-filter-type').onchange = (e) => {
      State.logFilter.type = e.target.value;
      this.render();
    };
    document.getElementById('log-search').oninput = (e) => {
      State.logFilter.keyword = e.target.value;
      this.render();
    };
    document.getElementById('log-export').onclick = () => this.export();
    document.getElementById('log-clear').onclick = () => {
      State.linkageLog = [];
      this.render();
    };
    document.getElementById('log-toggle').onclick = () => {
      State.logPanelCollapsed = !State.logPanelCollapsed;
      const panel = document.getElementById('log-panel');
      const body = document.getElementById('log-panel-body');
      if (panel) panel.classList.toggle('collapsed', State.logPanelCollapsed);
      if (body) body.style.display = State.logPanelCollapsed ? 'none' : 'block';
      document.getElementById('log-toggle').textContent = State.logPanelCollapsed ? '展开 ▲' : '折叠 ▼';
    };
  },

  export() {
    const text = State.linkageLog.map(l => `[${l.timestamp}] [${l.view}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fintrust-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  },

  update() {
    this.renderHeader();
    this.render();
    const panel = document.getElementById('log-panel');
    const body = document.getElementById('log-panel-body');
    if (panel) panel.classList.toggle('collapsed', State.logPanelCollapsed);
    if (body) body.style.display = State.logPanelCollapsed ? 'none' : 'block';
  }
};

window.LogPanel = LogPanel;
