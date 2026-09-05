/**
 * scf-graph.js — 供应链关系图谱可视化 + 图算法分析
 * 对齐 simulation-plan.md 第七章.2 要素四 + spec.md MOD-16
 *
 * 功能:
 *   1. ECharts 力导向图渲染 (节点大小/颜色按角色区分)
 *   2. 图算法分析 (中心度/环检测/路径分析/连通性)
 */

const SCFGraph = {
  chartInstance: null,

  /** 渲染关系图谱 */
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (typeof echarts === 'undefined') {
      container.innerHTML = '<div class="scf-empty">ECharts 未加载</div>';
      return;
    }

    // 构建图谱数据 (如果尚未构建)
    if (!State.scfDatabase.graph.nodes.length) {
      SCFEngine.SC1_buildGraph();
    }
    const graph = State.scfDatabase.graph;

    if (this.chartInstance) {
      this.chartInstance.dispose();
    }
    this.chartInstance = echarts.init(container);

    const option = {
      title: {
        text: '供应链关系图谱',
        subtext: `${graph.nodes.length} 节点 / ${graph.edges.length} 边 / ${graph.clusters.length} 社区`,
        left: 'center',
        textStyle: { color: 'var(--text-primary, #fff)', fontSize: 14 },
        subtextStyle: { color: 'var(--text-secondary, #aaa)', fontSize: 11 }
      },
      tooltip: {
        formatter: (params) => {
          if (params.dataType === 'node') {
            const d = params.data;
            const roleLabel = { anchor: '🟠 核心企业', supplier: '🔵 供应商', distributor: '🟢 经销商' }[d.type] || d.type;
            return `<b>${d.name}</b><br/>${roleLabel}<br/>信用分: ${d.creditScore || '-'}<br/>画像分: ${d.profileScore || '-'}<br/>席位: ${d.seatLevel || '-'}`;
          } else if (params.dataType === 'edge') {
            return `贸易关系<br/>交易额: ${State.formatAmount ? State.formatAmount(params.data.tradeVolume) : params.data.tradeVolume}<br/>关系强度: ${(params.data.weight * 100).toFixed(0)}%`;
          }
          return '';
        }
      },
      legend: [{
        data: ['核心企业', '供应商', '经销商'],
        textStyle: { color: 'var(--text-secondary, #aaa)' },
        bottom: 10
      }],
      animationDurationUpdate: 1500,
      animationEasingUpdate: 'quinticInOut',
      series: [{
        type: 'graph',
        layout: 'force',
        data: graph.nodes.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
          creditScore: n.creditScore,
          profileScore: n.profileScore,
          seatLevel: n.seatLevel,
          status: n.status,
          symbolSize: this._getNodeSize(n),
          itemStyle: { color: this._getNodeColor(n), shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' },
          label: { show: true, position: 'right', color: 'var(--text-primary, #fff)', fontSize: 11 },
          category: n.type === 'anchor' ? '核心企业' : n.type === 'supplier' ? '供应商' : '经销商'
        })),
        links: graph.edges.map(e => ({
          source: e.source,
          target: e.target,
          value: e.tradeVolume,
          tradeVolume: e.tradeVolume,
          weight: e.weight,
          lineStyle: {
            width: Math.max(1, e.weight * 5),
            color: e.weight > 0.8 ? '#4caf50' : e.weight > 0.6 ? '#ff9800' : '#f44336',
            curveness: 0.2,
            opacity: 0.7
          }
        })),
        categories: [
          { name: '核心企业' },
          { name: '供应商' },
          { name: '经销商' }
        ],
        force: {
          repulsion: 250,
          edgeLength: [80, 200],
          gravity: 0.1,
          layoutAnimation: true
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 6, opacity: 1 },
          label: { fontSize: 13, fontWeight: 'bold' }
        },
        roam: true,
        draggable: true
      }]
    };

    this.chartInstance.setOption(option);

    // 点击事件
    this.chartInstance.off('click');
    this.chartInstance.on('click', (params) => {
      if (params.dataType === 'node') {
        const nodeId = params.data.id;
        if (params.data.type === 'anchor') {
          State.setSCFAnchor(nodeId);
        } else {
          State.setSCFPartner(nodeId);
        }
        if (typeof ViewSCF !== 'undefined' && ViewSCF.onGraphNodeClick) {
          ViewSCF.onGraphNodeClick(params.data);
        }
      }
    });

    // 响应式
    setTimeout(() => this.chartInstance && this.chartInstance.resize(), 200);
  },

  /** 节点大小: 核心企业最大, 信用分越高越大 */
  _getNodeSize(node) {
    if (node.type === 'anchor') return 60;
    const base = 25;
    const credit = node.creditScore || 600;
    return base + Math.max(0, (credit - 500) / 10);
  },

  /** 节点颜色: 按角色区分 */
  _getNodeColor(node) {
    if (node.status === 'blacklisted') return '#9e9e9e';
    const colors = {
      anchor: '#ff9800',
      supplier: '#2196f3',
      distributor: '#4caf50'
    };
    return colors[node.type] || '#999';
  },

  // ============================================================
  // 图算法分析
  // ============================================================

  /** 中心度分析 (Degree Centrality) */
  calcDegreeCentrality() {
    const graph = State.scfDatabase.graph;
    const degrees = {};
    graph.nodes.forEach(n => { degrees[n.id] = 0; });
    graph.edges.forEach(e => {
      degrees[e.source] = (degrees[e.source] || 0) + 1;
      degrees[e.target] = (degrees[e.target] || 0) + 1;
    });
    const max = Math.max(...Object.values(degrees), 1);
    return Object.entries(degrees)
      .map(([id, deg]) => {
        const node = graph.nodes.find(n => n.id === id);
        return {
          id,
          name: node ? node.name : id,
          type: node ? node.type : 'unknown',
          degree: deg,
          centrality: deg / max
        };
      })
      .sort((a, b) => b.degree - a.degree);
  },

  /** 环检测 (DFS) — 识别关联方循环交易 (复用 B7 图欺诈检测) */
  detectCycles() {
    const graph = State.scfDatabase.graph;
    const adj = {};
    graph.nodes.forEach(n => { adj[n.id] = []; });
    graph.edges.forEach(e => {
      adj[e.source] = adj[e.source] || [];
      adj[e.source].push(e.target);
    });

    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    const path = [];

    const dfs = (node) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      for (const neighbor of (adj[node] || [])) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          // 找到环
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart).concat(neighbor);
          cycles.push(cycle);
        }
      }

      path.pop();
      recStack.delete(node);
    };

    graph.nodes.forEach(n => {
      if (!visited.has(n.id)) dfs(n.id);
    });

    return cycles;
  },

  /** 路径分析 (BFS 最短路径) — 风险传导路径 */
  shortestPath(sourceId, targetId) {
    const graph = State.scfDatabase.graph;
    const adj = {};
    graph.nodes.forEach(n => { adj[n.id] = []; });
    graph.edges.forEach(e => {
      adj[e.source] = adj[e.source] || [];
      adj[e.source].push(e.target);
      adj[e.target] = adj[e.target] || [];
      adj[e.target].push(e.source);
    });

    const queue = [[sourceId]];
    const visited = new Set([sourceId]);

    while (queue.length) {
      const path = queue.shift();
      const node = path[path.length - 1];
      if (node === targetId) return path;
      for (const neighbor of (adj[node] || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  },

  /** 连通性分析 — 识别供应链子网络 */
  analyzeConnectivity() {
    const graph = State.scfDatabase.graph;
    const adj = {};
    graph.nodes.forEach(n => { adj[n.id] = []; });
    graph.edges.forEach(e => {
      adj[e.source] = adj[e.source] || [];
      adj[e.source].push(e.target);
      adj[e.target] = adj[e.target] || [];
      adj[e.target].push(e.source);
    });

    const visited = new Set();
    const components = [];

    graph.nodes.forEach(n => {
      if (!visited.has(n.id)) {
        const component = [];
        const queue = [n.id];
        visited.add(n.id);
        while (queue.length) {
          const node = queue.shift();
          component.push(node);
          for (const neighbor of (adj[node] || [])) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        components.push(component);
      }
    });

    return {
      totalComponents: components.length,
      components: components.map((comp, i) => ({
        id: `COMP-${i + 1}`,
        size: comp.length,
        members: comp
      }))
    };
  },

  /** 运行完整图算法分析报告 */
  runFullAnalysis() {
    const centrality = this.calcDegreeCentrality();
    const cycles = this.detectCycles();
    const connectivity = this.analyzeConnectivity();
    return {
      centrality,
      cycles,
      connectivity,
      summary: {
        totalNodes: State.scfDatabase.graph.nodes.length,
        totalEdges: State.scfDatabase.graph.edges.length,
        topNode: centrality[0] ? `${centrality[0].name} (度=${centrality[0].degree})` : '无',
        cycleCount: cycles.length,
        componentCount: connectivity.totalComponents
      }
    };
  },

  /** 释放图表实例 */
  dispose() {
    if (this.chartInstance) {
      this.chartInstance.dispose();
      this.chartInstance = null;
    }
  }
};

window.SCFGraph = SCFGraph;
