/**
 * scene-loader.js — 场景加载功能
 * v4.3: 6个预设场景一键加载 (4个基础场景 + 2个生产系统能力演示场景)
 *   场景1: 标准融资
 *   场景2: 政策红利
 *   场景3: 风险预警
 *   场景4: 季末冲量
 *   场景5: API 接入优先 (v4.3 新增 — 演示三档分类的 API 接入档)
 *   场景6: 独立运行兜底 (v4.3 新增 — 演示零外部机构接入下的独立运行能力)
 * v5.0 v=36 补齐: 新增 3 个改造场景 (simulation-plan 二补.7)
 *   场景7: 改造·保守版 (Tab0 改造工作台 · 绿区合规 · 快速体验)
 *   场景8: 改造·平衡版 (Tab0 改造工作台 · 含灰区 · 触发法务审核)
 *   场景9: 改造·创新版 (Tab0 改造工作台 · 全合规空间 · 资本运作)
 * v6.0 新增: 3 个供应链金融场景 (simulation-plan 第七章)
 *   场景10: 核心企业保理 (Tab11 SCF · 应收账款融资 · SC1-SC10 全链路)
 *   场景11: 供应链风险预警 (Tab11 SCF · 黑名单触发 · 风险扩散分析)
 *   场景12: 经销商预付款 (Tab11 SCF · 预付款融资 · 反向融资路径)
 */

const SceneLoader = {
  scenes: [
    { id: 'standard', name: '标准融资', desc: '正常经营企业的标准融资流程', icon: '🏢' },
    { id: 'policy_bonus', name: '政策红利', desc: '高新技术企业享受政策鼓励', icon: '🌟' },
    { id: 'risk_alert', name: '风险预警', desc: '高风险企业触发资金抽逃', icon: '🚨' },
    { id: 'quarter_end', name: '季末冲量', desc: '季末银行信贷窗口期', icon: '📅' },
    { id: 'api_priority', name: 'API 接入优先', desc: '演示三档分类的 API 接入档: 15 个外部 API 全接入, C1-C7 全待命, 兜底降级链 1 级', icon: '🟢' },
    { id: 'independent_fallback', name: '独立运行兜底', desc: '演示零外部机构接入下的独立运行能力: 15 个外部 API 全断, C1-C7 全激活, 独立运行模式开启, 全栈降级演示', icon: '🟣' },
    // ===== v5.0 v=36 补齐: 3 个改造场景 (simulation-plan 二补.7) =====
    { id: 'reform_A', name: '改造·保守版 (A)', desc: 'Tab0 企业改造 · 仅绿区合规动作 · 快速体验改造闭环 · 无灰区法务节点', icon: '🟢', group:'reform' },
    { id: 'reform_B', name: '改造·平衡版 (B)', desc: 'Tab0 企业改造 · 绿区+灰区 · 含反向收购/股权代持 · 自动触发 Tab3 法务审核 (联动5.5)', icon: '🔵', group:'reform' },
    { id: 'reform_C', name: '改造·创新版 (C)', desc: 'Tab0 企业改造 · 全合规空间 · 含资本运作 R5-H 节点 · 成本/时长翻倍 · 通过率最高', icon: '🟠', group:'reform' },
    // ===== v6.0 新增: 3 个供应链金融场景 (simulation-plan 第七章) =====
    { id: 'scf_anchor', name: 'SCF·核心企业保理', desc: 'Tab11 供应链金融 · 应收账款融资 · E001宏达精密核心 + SCF-S001东方钢材供应商 · SC1-SC10 全链路一键跑通', icon: '🚛', group:'scf' },
    { id: 'scf_risk', name: 'SCF·供应链风险预警', desc: 'Tab11 供应链金融 · 黑名单触发 · SCF-S005虚假贸易/SCF-S006关联循环 · SC2准入拦截+SC7风险扩散分析', icon: '⚠️', group:'scf' },
    { id: 'scf_distributor', name: 'SCF·经销商预付款', desc: 'Tab11 供应链金融 · 预付款融资 · E001宏达精密 + SCF-D001北方机电经销商 · 反向融资路径演示', icon: '📦', group:'scf' }
  ],

  renderSelector() {
    // 在顶部导航栏渲染场景选择器（由app.js调用）
    return `
      <select id="scene-select" class="log-select" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3)" title="一键加载预设场景: 12个场景 · 6个基础/兜底 + 3个 v5.0 改造场景 + 3个 v6.0 SCF 场景 → 自动配置企业+数据流+模块+激进程度+改造/SCF流水线状态">
        <option value="">📦 加载场景...</option>
        <optgroup label="📑 基础场景 (4个)">
          ${this.scenes.filter(s=>!s.group).slice(0,4).map(s => `<option value="${s.id}" style="color:var(--text-primary);background:var(--bg-secondary)">${s.icon} ${s.name}</option>`).join('')}
        </optgroup>
        <optgroup label="🏗 三档分类演示 (2个)">
          ${this.scenes.filter(s=>!s.group).slice(4,6).map(s => `<option value="${s.id}" style="color:var(--text-primary);background:var(--bg-secondary)">${s.icon} ${s.name}</option>`).join('')}
        </optgroup>
        <optgroup label="🔧 v5.0 改造场景 (3个 · simulation-plan 二补.7)">
          ${this.scenes.filter(s=>s.group==='reform').map(s => `<option value="${s.id}" style="color:var(--text-primary);background:rgba(139,92,246,0.15)">${s.icon} ${s.name}</option>`).join('')}
        </optgroup>
        <optgroup label="🚛 v6.0 SCF 场景 (3个 · simulation-plan 第七章)">
          ${this.scenes.filter(s=>s.group==='scf').map(s => `<option value="${s.id}" style="color:var(--text-primary);background:rgba(57,197,207,0.15)">${s.icon} ${s.name}</option>`).join('')}
        </optgroup>
      </select>
    `;
  },

  init() {
    const select = document.getElementById('scene-select');
    if (select) {
      select.onchange = (e) => {
        if (e.target.value) {
          State.loadScene(e.target.value);
          // 场景加载后跳转到相关 Tab
          if (e.target.value === 'api_priority' || e.target.value === 'independent_fallback') {
            setTimeout(() => {
              if (typeof App !== 'undefined' && App.switchTab) App.switchTab('fallback');
            }, 300);
          } else if (e.target.value && e.target.value.startsWith('reform_')) {
            // v5.0 改造场景 → 跳转到 Tab0 改造工作台
            setTimeout(() => {
              if (typeof App !== 'undefined' && App.switchTab) App.switchTab('reform');
            }, 200);
          } else if (e.target.value && e.target.value.startsWith('scf_')) {
            // v6.0 SCF 场景 → 跳转到 Tab11 供应链金融工作台
            setTimeout(() => {
              if (typeof App !== 'undefined' && App.switchTab) App.switchTab('scf');
            }, 300);
          }
          e.target.value = '';
        }
      };
    }
  }
};

window.SceneLoader = SceneLoader;
