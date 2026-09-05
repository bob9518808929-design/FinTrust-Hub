/**
 * app.js — FinTrust Hub 主入口
 * 职责: 初始化 + Tab切换 + 顶部导航 + 全局渲染调度 + 浮动操作指引
 */

const App = {
  init() {
    // v5.0: 强制默认首页 Tab0 企业改造工作台
    State.activeTab = 'reform';

    // 初始化状态
    State.init();

    // 订阅状态变更 → 自动重新渲染
    State.subscribe(() => this.renderAll());

    // 初始化顶部导航
    this.initTopBar();
    this.initTabs();

    // 初始化浮动操作指引
    GuideManager.init();

    // 首次渲染
    this.renderAll();
  },

  // === 顶部导航初始化 ===
  initTopBar() {
    // 企业选择器
    const select = document.getElementById('enterprise-select');
    if (select) {
      select.innerHTML = State.enterprises.map(e =>
        `<option value="${e.id}" ${e.id === State.currentEnterpriseId ? 'selected' : ''}>${e.name}</option>`
      ).join('');
      select.onchange = (e) => {
        State.switchEnterprise(e.target.value);
      };
    }

    // 场景选择器
    this.initSceneSelector();

    // 政策选择器
    this.initPolicySelector();

    // 日期推进
    const dateBtn = document.getElementById('date-forward');
    if (dateBtn) {
      dateBtn.onclick = () => State.advanceDate();
    }

    // 日期自动播放
    const autoBtn = document.getElementById('date-autoplay');
    if (autoBtn) {
      autoBtn.onclick = () => {
        State.toggleAutoPlay();
        this.updateAutoPlayBtn();
      };
    }

    // 资金抽逃模拟
    const flightBtn = document.getElementById('btn-fund-flight');
    if (flightBtn) {
      flightBtn.onclick = () => {
        State.simulateFundFlight();
        // 切换到AI驾驶舱查看预警
        this.switchTab('cockpit');
      };
    }

    // IoT断线模拟
    const iotBtn = document.getElementById('btn-iot-disconnect');
    if (iotBtn) {
      iotBtn.onclick = () => {
        State.simulateIoTDisconnect();
        this.switchTab('flow');
      };
    }
  },

  // === 场景选择器初始化 ===
  initSceneSelector() {
    const container = document.getElementById('scene-selector-container');
    if (!container) return;
    // 防御: sceneLoader.js 缺失时使用空内容,不抛 ReferenceError
    if (typeof SceneLoader === 'undefined' || !SceneLoader) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.innerHTML = SceneLoader.renderSelector();
    SceneLoader.init();
  },

  // === 政策选择器初始化 ===
  initPolicySelector() {
    const policySelect = document.getElementById('policy-select');
    if (!policySelect) return;
    policySelect.innerHTML = MockData.POLICY_VERSIONS.map(p =>
      `<option value="${p.version}" ${p.version === State.policyVersion ? 'selected' : ''}>${p.label}</option>`
    ).join('');
    policySelect.onchange = (e) => {
      State.switchPolicyVersion(e.target.value);
    };
  },

  // === 更新自动播放按钮状态 ===
  updateAutoPlayBtn() {
    const autoBtn = document.getElementById('date-autoplay');
    if (!autoBtn) return;
    if (State.isAutoPlaying) {
      autoBtn.textContent = '⏸暂停';
      autoBtn.style.background = '#ff9800';
    } else {
      autoBtn.textContent = '▶自动';
      autoBtn.style.background = '';
    }
  },

  // === Tab 切换 ===
  initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.onclick = () => {
        if (tab.disabled) return;
        this.switchTab(tab.dataset.tab);
      };
    });
  },

  switchTab(tabName) {
    // 更新Tab按钮
    document.querySelectorAll('.tab-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // 更新视图容器
    document.querySelectorAll('.view-container').forEach(v => {
      v.classList.remove('active');
    });
    const view = document.getElementById(`view-${tabName}`);
    if (view) view.classList.add('active');

    State.activeTab = tabName;
    this.renderActiveView();
    GuideManager.updateContent();
  },

  // === 全局渲染 ===
  renderAll() {
    // 更新顶部导航
    this.updateTopBar();

    // 渲染全局告警横幅(所有Tab顶部可见,反映边缘案例对整个桌面的影响)
    this.renderGlobalAlerts();

    // v4.3: 渲染跨视图查看兜底引擎快捷按钮(Tab1-7 顶部右侧悬浮)
    this.renderFallbackShortcut();

    // 渲染日志面板
    LogPanel.update();

    // 渲染当前活动视图
    this.renderActiveView();
  },

  // === v4.3: 跨视图查看兜底引擎快捷按钮 (Tab1-7 → Tab8) ===
  // 根据当前视图推断应高亮的 C 模块,点击后跳转到 Tab8 并高亮该模块
  renderFallbackShortcut() {
    let btn = document.getElementById('fallback-shortcut-btn');
    // 在 Tab8 兜底引擎控制台不显示快捷按钮(用户已在 Tab8 内)
    if (State.activeTab === 'fallback') {
      if (btn) btn.style.display = 'none';
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'fallback-shortcut-btn';
      btn.style.cssText = 'position:fixed;top:78px;right:14px;z-index:9000;' +
        'padding:6px 12px;font-size:11px;font-weight:700;color:#fff;background:#9c27b0;' +
        'border:none;border-radius:18px;box-shadow:0 2px 8px rgba(156,39,176,0.30);' +
        'cursor:pointer;display:flex;align-items:center;gap:4px;transition:all .2s';
      btn.onmouseenter = () => { btn.style.transform = 'translateY(-1px)'; btn.style.boxShadow = '0 4px 12px rgba(156,39,176,0.40)'; };
      btn.onmouseleave = () => { btn.style.transform = 'translateY(0)'; btn.style.boxShadow = '0 2px 8px rgba(156,39,176,0.30)'; };
      btn.onclick = () => {
        const highlightCId = FallbackEngine.getHighlightCModuleByView(State.activeTab);
        State.log('system', `[跨视图] ${State.activeTab} → Tab8 兜底引擎 (高亮 ${highlightCId || '无关联'} C 模块)`, 'fallback');
        FallbackEngine.jumpToTab8(highlightCId);
      };
      document.body.appendChild(btn);
    }
    btn.style.display = 'flex';
    const highlightCId = FallbackEngine.getHighlightCModuleByView(State.activeTab);
    const cModule = highlightCId ? State.getCModuleById(highlightCId) : null;
    btn.title = `查看 Tab8 独立兜底引擎控制台 → 高亮 ${cModule ? cModule.id + ' ' + cModule.name : '关联 C 模块'}`;
    btn.innerHTML = `🛡 查看兜底引擎${cModule ? ` (${cModule.id})` : ''}`;
  },

  // === 全局告警横幅(边缘案例触发后,所有Tab顶部可见,让用户立刻知道桌面状态变了) ===
  renderGlobalAlerts() {
    const banner = document.getElementById('global-alert-banner');
    if (!banner) return;
    const alerts = State.activeAlerts || [];
    if (alerts.length === 0) {
      banner.innerHTML = '';
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    const sevColor = { red: '#dc3545', orange: '#ff9800', yellow: '#ffc107' };
    const sevBg = { red: 'rgba(220,53,69,0.12)', orange: 'rgba(255,152,0,0.10)', yellow: 'rgba(255,193,7,0.10)' };
    banner.innerHTML = alerts.map(a => {
      const color = sevColor[a.severity] || sevColor.red;
      const bg = sevBg[a.severity] || sevBg.red;
      const ageMin = Math.floor((Date.now() - a.createdAt) / 60000);
      const ageTxt = ageMin < 1 ? '刚刚' : `${ageMin}分钟前`;
      return `
        <div class="alert-banner-item" style="background:${bg};border-left:4px solid ${color};padding:8px 14px;display:flex;align-items:center;gap:10px;font-size:12px">
          <span style="font-size:16px">${a.title.split(' ')[0] || '⚠'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:${color};font-size:13px">${a.title}</div>
            <div style="color:var(--text-secondary);font-size:11px;line-height:1.5;margin-top:2px">${a.text}</div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${ageTxt}</span>
          ${a.actionTab ? `<button class="btn btn-sm" style="padding:3px 10px;font-size:11px;border:1px solid ${color};color:${color};background:transparent;border-radius:3px;cursor:pointer" onclick="App.switchTab('${a.actionTab}');State.dismissAlert('${a.id}')" title="跳转到相关Tab处理">→ 处理</button>` : ''}
          <button class="btn btn-sm" style="padding:3px 8px;font-size:11px;border:none;background:transparent;color:var(--text-muted);cursor:pointer" onclick="State.dismissAlert('${a.id}')" title="忽略此告警(不影响实际状态)">✕</button>
        </div>
      `;
    }).join('');
  },

  renderActiveView() {
    switch (State.activeTab) {
      // v5.0 Tab0 企业改造工作台 (首页)
      case 'reform':
        if (typeof ViewReform !== 'undefined') ViewReform.render();
        break;
      case 'enterprise':
        ViewEnterprise.render();
        break;
      case 'flow':
        ViewFlow.render();
        break;
      case 'approval':
        ViewApproval.render();
        break;
      case 'bank':
        ViewBank.render();
        break;
      case 'institution':
        ViewInstitution.render();
        break;
      case 'advisor':
        ViewAdvisor.render();
        break;
      case 'cockpit':
        ViewCockpit.render();
        break;
      case 'fallback':
        if (typeof ViewFallback !== 'undefined') ViewFallback.render();
        break;
      case 'regulatory':
        ViewRegulatory.render();
        break;
      case 'partner':
        ViewPartner.render();
        break;
      case 'scf':
        if (typeof ViewSCF !== 'undefined') ViewSCF.render();
        break;
    }
  },

  // === 更新顶部导航状态 ===
  updateTopBar() {
    // 企业选择器
    const select = document.getElementById('enterprise-select');
    if (select && select.value !== State.currentEnterpriseId) {
      select.value = State.currentEnterpriseId;
    }

    // 政策选择器
    const policySelect = document.getElementById('policy-select');
    if (policySelect && policySelect.value !== State.policyVersion) {
      policySelect.value = State.policyVersion;
    }

    // 系统日期
    const dateEl = document.getElementById('system-date');
    if (dateEl) {
      dateEl.textContent = State.systemDate;
    }

    // 季节性窗口标签
    const seasonalEl = document.getElementById('seasonal-badge');
    if (seasonalEl) {
      const sw = MockData.SEASONAL_WINDOWS[State.seasonalWindow];
      seasonalEl.className = `seasonal-badge ${State.seasonalWindow}`;
      seasonalEl.textContent = State.seasonalWindow === 'normal' ? '' : sw.label;
    }

    // 自动播放按钮状态
    this.updateAutoPlayBtn();
  }
};

// === 启动 ===
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// === 浮动操作指引管理器 ===
const GuideManager = {
  _visible: false,
  _minimized: false,

  // 各Tab操作指引内容 (v=24 统一结构: 用途 → 上游 → 操作流程 → 触发条件 → 下游影响)
  guides: {
    reform: {
      title: 'Tab0 企业改造工作台 [v5.0 新增]',
      content: `
        <strong>📋 用途:</strong> AI驱动的企业改造引擎 — 把"有潜力但不合规"的D/C级企业通过8维改造地图(主体/财务/税务/业务/资产/信用/政策/资金)改造为"银行可准入"的B/A级合规主体,解决两本账/税不一致/业务佐证缺失/法人代持等顽疾。撮合只是改造完成后的最后一公里。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①mock-data.js 内置4家企业(含E004海川物流测试用不合规企业) + R1-R10引擎配置 + 3档激进程度 + L2-L4自主度 + 案例库;②State 联动规则5.1-5.5实时驱动改造状态刷新。<br><br>
        <strong>🔧 操作流程(6步流水线):</strong><br>
        <span class="op-step">①AI差距诊断 R1+R2</span><span class="op-arrow">→</span>
        <span class="op-step">②生成3条方案 R3</span><span class="op-arrow">→</span>
        <span class="op-step">③选定路径·调度 R4</span><span class="op-arrow">→</span>
        <span class="op-step">④一键执行改造 R5+R6+R7</span><span class="op-arrow">→</span>
        <span class="op-step">⑤银行匹配 R9</span><span class="op-arrow">→</span>
        <span class="op-step">⑥案例检索 R10</span><span class="op-arrow">→</span>
        <span class="op-step">去Tab1配置数据可见/责任链</span><span class="op-arrow">→</span>
        <span class="op-step">去Tab2发起融资</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">激进程度</span> 保守(仅绿区)/平衡(绿+灰区)/创新(全合规空间含资本运作) → 联动5.2: R3方案重生成+R7合规边界刷新;<br>
        <span class="op-trigger">自主度</span> L2=文档生成/L3=API对接/L4=全流程(含法务签章) → 联动5.5: R5执行引擎家族边界更新; 需法务的任务在L2下会被阻断;<br>
        <span class="op-trigger">目标等级</span> D/C/B-/B/B+/A-/A/A+ → 越高缺口越大,投入越高;<br>
        <span class="op-trigger">企业切换</span> 联动5.1: 自动加载该企业8维评分卡+重算当前等级+R10相似案例检索;<br>
        <span class="op-trigger">任务执行</span> 联动5.3: 每完成1个任务→8维评分卡↑+当前等级重判+信用分↑+融资能力实时联动+R9银行匹配刷新;<br>
        <span class="op-trigger">改造完成</span> 联动5.4: 进度100% → R9银行匹配自动触发 → 绿色Toast提示去Tab1配置合作模式/数据可见性, 再去Tab2发起融资。<br><br>
        <strong>📐 6大分区:</strong> A1 8维评分卡(改造前/当前/目标三段式) · A2 参数控制台+R1-R10状态墙 · A3 差距诊断+3路径方案 · A4 任务DAG+进度监控 · A5 银行匹配+相似案例 · A6 执行引擎家族+合规审查<br><br>
        <strong>⬆️ 下游影响:</strong> ①改造完成→Tab1融资入口解锁(需先在Tab1配置合作模式/数据可见性/责任链,再去Tab2发起融资);②8维评分卡提升→Tab1企业信用完整度/信用分实时联动;③R7合规审查结果→Tab3人工审批台(灰区任务需法务复核);④全部改造动作→Tab7 AI驾驶舱自动记录可回溯;⑤改造案例→R10案例库沉淀供后续企业参考。`
    },
    enterprise: {
      title: 'Tab1 企业端工作台',
      content: `
        <strong>📋 用途:</strong> 企业画像中枢 — 配置数据流开放范围 / 模块开关 / AI自主度 / 责任链,直接决定融资能力(额度/利率/确权等级)。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> mock-data.js 内置3家企业的财务/资质/责任链模板;切换企业即切换整个上下文。<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①开关5母流+人流</span><span class="op-arrow">→</span>
        <span class="op-step">②启停模块(IoT/票据/外汇…)</span><span class="op-arrow">→</span>
        <span class="op-step">③设自主度L1-L4</span><span class="op-arrow">→</span>
        <span class="op-step">④逐节点确认责任链</span><span class="op-arrow">→</span>
        <span class="op-step">⑤字段级脱敏配置(银行/担保/保险三方多选)</span><span class="op-arrow">→</span>
        <span class="op-step">⑥前往Tab2发起融资</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">数据流开放</span> 开放→信用维度完整度↑→额度乘数↑/利率↓/确权等级↑;关闭→反向;<br>
        <span class="op-trigger">IoT模块</span> 启用→五流合一可验证→确权A级; 停用→降级四流→确权B级;<br>
        <span class="op-trigger">自主度</span> L1=AI全自主(小额)/L2=AI+通知/L3=AI建议+人工/L4=纯人工;<br>
        <span class="op-trigger">责任链确认</span> +1节点→信用分+2/+3; ≥90%→评级提升+合规报告; ≥70%→利率-0.3%; <50%→利率+0.5%+管理风险预警;<br>
        <span class="op-trigger">消极确权</span> 责任人/买方未响应→48h倒计时(3秒模拟)→自动确权+标记消极;<br>
        <span class="op-trigger">字段可见性</span> 14字段×3机构多选 → 银行/担保/保险各看到不同视图(Tab4脱敏对比可见)。<br><br>
        <strong>⬆️ 下游影响:</strong> ①Tab2融资时AI读这些配置做风险分析/路由;②Tab4银行看到的就是Tab1脱敏后的画像;③Tab7 AI驾驶舱基于完整度生成研判建议;④Tab8合规检查基于数据流开放+责任链完整度。`
    },
    flow: {
      title: 'Tab2 融资流程模拟器',
      content: `
        <strong>📋 用途:</strong> 融资全流程沙盒 — 发起融资→AI逐步执行(风险分析→自主度路由→六流验证→银行竞标→资金到账),并集成担保/保险申请入口与边缘案例模拟器。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab1企业配置(自主度/数据流/责任链);②mock-data内置银行库与产品利率;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①设融资金额</span><span class="op-arrow">→</span>
        <span class="op-step">②点发起融资</span><span class="op-arrow">→</span>
        <span class="op-step">③观察AI五步执行</span><span class="op-arrow">→</span>
        <span class="op-step">④查六流验证结果</span><span class="op-arrow">→</span>
        <span class="op-step">⑤L3/L4→去Tab3审批</span><br>
        <span class="op-step">📝申请担保 / 📝申请保险</span> → 弹toast → 状态变「待Tab5受理」→ Tab5受理激活后利率/信用分联动<br>
        <span class="op-step">边缘案例模拟器</span> 资金抽逃 / IoT断线 / 结算紊乱 → 触发全局告警横幅(所有Tab顶部)<br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">50万</span> 金额<100万+自主度≥L1 → AI全自主(L1);<br>
        <span class="op-trigger">300万</span> 金额<500万+自主度≥L2 → AI自主+通知(L2);<br>
        <span class="op-trigger">800万</span> 金额≥500万 → 推送人工审批(L3/L4);<br>
        <span class="op-trigger">六流验证</span> 5母流+1责任流 → 确权A/B/C级 → 影响最终利率;<br>
        <span class="op-trigger">资金抽逃</span> 拦截白名单外转账 → 资金流冻结 → 五流降B → 顶部红牌告警;<br>
        <span class="op-trigger">IoT断线</span> 设备离线 → 物联流冻结 → 顶部橙牌告警。<br><br>
        <strong>⬆️ 下游影响:</strong> ①融资成功→Tab4银行端水位/回款更新;②审批类→Tab3人工审批台弹出工单;③所有AI操作→Tab7驾驶舱自动记录可回溯;④资金抽逃/IoT断线→Tab8监管沙盒立刻同步风险预警。`
    },
    approval: {
      title: 'Tab3 人工审批台',
      content: `
        <strong>📋 用途:</strong> L3/L4人工决策工作台 — 收到AI推送的高额/低自主度融资工单后,人工通过/退回/否决,属于不可逆决策(会真实改变融资生命周期),故用阻塞式模态+队列上限保护。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab2融资路由L3/L4自动推送工单(含企业画像/AI建议/置信度);<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①查待审工单队列</span><span class="op-arrow">→</span>
        <span class="op-step">②阅读AI建议+置信度</span><span class="op-arrow">→</span>
        <span class="op-step">③点击通过/退回/否决</span><span class="op-arrow">→</span>
        <span class="op-step">④填写理由(否决必填)</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">工单来源</span> Tab2 L3/L4路由自动推送;<br>
        <span class="op-trigger">AI建议</span> 置信度>80%=建议通过; 60-80%=建议复核; <60%=建议否决;<br>
        <span class="op-trigger">通过</span> → 融资流程继续→资金到账→Tab4水位更新;<br>
        <span class="op-trigger">退回</span> → 工单回Tab2要求补充材料→可二次提交;<br>
        <span class="op-trigger">否决</span> → 融资流程终止→记录否决原因→AI驾驶舱回溯;<br>
        <span class="op-trigger">队列保护</span> 最大3工单并发,超出自动降级为toast提示避免锁屏。<br><br>
        <strong>⬆️ 下游影响:</strong> ①通过→Tab2资金到账+Tab4水位更新+Tab7AI操作记录;②否决→Tab2流程终止+Tab7回溯标记;③退回→Tab2企业重新提交材料。`
    },
    bank: {
      title: 'Tab4 银行端工作台',
      content: `
        <strong>📋 用途:</strong> 银行风险监管中枢 — 信用画像(脱敏后) → 贷后动态水位/回款监管 → 预警分级 → 字段级可见性脱敏对比 → 责任合规报告;并接收资金抽逃/IoT断线的实时告警。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab1企业授权的脱敏数据(银行可见字段集);②Tab2融资到账后实时水位变动;③资金抽逃模拟→实时告警横幅;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①查信用画像(脱敏)</span><span class="op-arrow">→</span>
        <span class="op-step">②监控水位/回款</span><span class="op-arrow">→</span>
        <span class="op-step">③查预警列表</span><span class="op-arrow">→</span>
        <span class="op-step">④切换原始/脱敏对比</span><span class="op-arrow">→</span>
        <span class="op-step">⑤解冻资金流(若被冻结)</span><span class="op-arrow">→</span>
        <span class="op-step">⑥查责任合规报告</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">画像刷新</span> 企业切换/信用分变化→画像自动刷新;<br>
        <span class="op-trigger">水位预警</span> >0.9=红牌; >0.8=黄牌; <0.5=蓝牌;<br>
        <span class="op-trigger">脱敏对比</span> 切换原始/脱敏 → 直观看到Tab1字段可见性配置的真实效果;<br>
        <span class="op-trigger">资金抽逃</span> Tab2模拟→顶部红牌告警→此处可解冻资金流→告警自动清除;<br>
        <span class="op-trigger">责任合规</span> 责任链完整度→评级→利率联动: ≥90%评级提升 / ≥70%利率-0.3% / <50%利率+0.5%。<br><br>
        <strong>⬆️ 下游影响:</strong> ①解冻资金流→Tab2五流恢复A级+告警横幅消失;②水位/回款异常→Tab7 AI驾驶舱自动预警;③合规报告→Tab8监管沙盒可调阅。`
    },
    institution: {
      title: 'Tab5 担保与保险协作台',
      content: `
        <strong>📋 用途:</strong> 增信服务协作中枢 — 担保申请→保前审查→反担保→激活生效; 应收款保险投保→核保→保单→理赔;两步工作流+Tab5一步快捷入口双模式。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab2「📝申请担保/📝申请保险」按钮发起申请(状态→pending);②mock-data内置反担保/核保规则;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">两步工作流</span> Tab2发起申请→状态pending→Tab5点「申请担保增信」受理激活→状态active<br>
        <span class="op-step">快捷模式</span> 直接在Tab5点按钮一步完成 none→pending→active(无需跳Tab2)<br>
        <span class="op-step">模拟代偿/理赔</span> 已生效后按钮变「模拟代偿」→担保公司赔付银行→启动追偿流程<br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">4种状态</span> none(未申请)/pending(待处理)/active(已生效)/claimed(追偿中或理赔完成) — 每种点击按钮都有不同toast反馈;<br>
        <span class="op-trigger">申请担保生效</span> → 银行利率-0.5% / 额度+10% / 信用分+15;<br>
        <span class="op-trigger">申请保险生效</span> → 银行利率-0.3% / B级可升至A级 / 信用分+10;<br>
        <span class="op-trigger">模拟代偿</span> → 担保公司赔付银行→启动追偿;<br>
        <span class="op-trigger">模拟理赔</span> → 保险公司赔付→信用分-20但资金回笼;<br>
        <span class="op-trigger">按钮灰化</span> 状态≠none时按钮自动灰化+opacity0.45,防止重复点击。<br><br>
        <strong>⬆️ 下游影响:</strong> ①激活→Tab1融资能力(额度/利率)实时刷新;②激活→Tab4银行端画像同步更新;③激活→Tab7 AI驾驶舱生成「增信生效」研判记录;④代偿/理赔→信用分/利率重新评估。`
    },
    advisor: {
      title: 'Tab6 财务顾问运营台',
      content: `
        <strong>📋 用途:</strong> 顾问撮合中枢 — 全局仪表盘→跨企业撮合配对(企业+银行+担保三方)→客户管理→佣金结算。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①所有企业的融资记录/信用画像;②mock-data内置银行库+担保产品库;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①查全局仪表盘</span><span class="op-arrow">→</span>
        <span class="op-step">②撮合配对</span><span class="op-arrow">→</span>
        <span class="op-step">③查客户列表</span><span class="op-arrow">→</span>
        <span class="op-step">④查佣金结算</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">全局数据</span> 跨企业聚合→总融资额/平均利率/风险分布;<br>
        <span class="op-trigger">撮合配对</span> 企业+银行+担保→生成收益预估(利率/额度/担保费/佣金);<br>
        <span class="op-trigger">佣金结算</span> 按融资额×佣金比例→模拟顾问分成;<br>
        <span class="op-trigger">客户分级</span> 按信用分A/B/C分级管理,优先服务A级。<br><br>
        <strong>⬆️ 下游影响:</strong> ①撮合成功→可一键跳Tab2发起融资;②佣金数据→Tab7顾问视角运营指标统计;③客户画像→跨Tab共享。`
    },
    cockpit: {
      title: 'Tab7 AI驾驶舱',
      content: `
        <strong>📋 用途:</strong> AI决策全景台 — 全局统计→L1-L4分布饼图→决策链路回溯→假设分析→AI研判建议(非阻塞toast,不遮挡操作)。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab2融资路由的AI操作记录;②IoT监测/责任链审计/边缘案例的自动写入;③所有AI操作自带置信度+决策回溯;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①查全局统计</span><span class="op-arrow">→</span>
        <span class="op-step">②查L1-L4分布</span><span class="op-arrow">→</span>
        <span class="op-step">③点AI操作展开决策回溯</span><span class="op-arrow">→</span>
        <span class="op-step">④点假设分析</span><span class="op-arrow">→</span>
        <span class="op-step">⑤研判toast→「✓采纳并跳转」</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">AI操作来源</span> Tab2融资/IoT监测/责任链审计/边缘案例自动记录;<br>
        <span class="op-trigger">L1全自主</span> AI全权处理小额融资,无需人工;<br>
        <span class="op-trigger">L2自主+通知</span> AI处理+toast通知企业;<br>
        <span class="op-trigger">L3建议+审批</span> AI建议→人工Tab3确认;<br>
        <span class="op-trigger">L4纯人工</span> AI仅给参考,人工全程决策;<br>
        <span class="op-trigger">AI研判toast</span> 优先级urgent=9秒/普通=6.5秒,右下角滑入,不遮挡操作流,带「✓采纳并跳转」按钮;<br>
        <span class="op-trigger">全局告警横幅</span> 资金抽逃红牌/IoT断线橙牌 — 所有Tab顶部同步显示。<br><br>
        <strong>⬆️ 下游影响:</strong> ①研判采纳→自动跳Tab2/Tab4执行建议;②所有AI决策→Tab8监管沙盒可调阅审计;③告警横幅→点「→处理」跳相关Tab即时处置。`
    },
    regulatory: {
      title: 'Tab8 监管沙盒',
      content: `
        <strong>📋 用途:</strong> 穿透式监管台 — 合规三维度评估(责任链/数据流/AI操作) → 穿透式报告(脱敏账户+银行确权背书) → 全链路审计追踪(区块链存证)。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①所有企业的责任链/数据流/AI操作记录;②可疑交易自动触发;③区块链存证;<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①触发可疑交易</span><span class="op-arrow">→</span>
        <span class="op-step">②报告自动生成+toast通知</span><span class="op-arrow">→</span>
        <span class="op-step">③点击报告卡片打开审阅弹窗</span><span class="op-arrow">→</span>
        <span class="op-step">④4决策按钮(确认归档/需补充/误报/取消)</span><span class="op-arrow">→</span>
        <span class="op-step">⑤查全链路审计追踪</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">穿透报告</span> 大额可疑交易红牌→自动生成+toast通知(非阻塞,不打断工作);<br>
        <span class="op-trigger">审阅弹窗</span> 用户点击报告卡片打开→4决策按钮写入状态(pending→archived/need_more_info/false_positive);<br>
        <span class="op-trigger">审计追踪</span> 数据采集→AI决策→资金划转全链路日志+区块链存证验证;<br>
        <span class="op-trigger">合规检查</span> 责任链合规+数据流合规+AI操作合规三维度评估。<br><br>
        <strong>⬆️ 下游影响:</strong> ①归档报告→监管留档可二次调阅;②误报标记→AI模型迭代学习;③审计追踪→跨Tab调用证据链。`
    },
    partner: {
      title: 'Tab9 关联机构门户',
      content: `
        <strong>📋 用途:</strong> 物流/评估/律所/会计通用协作门户 — AI委派任务→脱敏数据包→机构处理→报告回传(结构化)→自动整合业务流程。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①Tab7 AI驾驶舱基于融资流程自动委派任务(任务类型+企业脱敏+数据包+截止日期+报酬);<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①切换机构类型</span><span class="op-arrow">→</span>
        <span class="op-step">②点「+模拟AI委派任务」</span><span class="op-arrow">→</span>
        <span class="op-step">③接受任务→查看脱敏数据包</span><span class="op-arrow">→</span>
        <span class="op-step">④回传报告(结构化)</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">任务接收</span> AI自动委派,含任务类型+企业脱敏名+数据包+截止日期+报酬;<br>
        <span class="op-trigger">数据处理</span> 脱敏数据包仅门户内查看,不可下载(保护数据安全);<br>
        <span class="op-trigger">报告回传</span> 评估报告/法律意见书/审计报告→系统自动整合到业务流程;<br>
        <span class="op-trigger">物流运单</span> 确认运单→关联IoT GPS轨迹→生成签收证明→关联责任链N09节点。<br><br>
        <strong>⬆️ 下游影响:</strong> ①评估报告→Tab4银行画像更新;②法律意见书→Tab3审批参考;③审计报告→Tab8监管调阅;④物流签收→Tab1责任链N09节点确权+Tab2物流流验证通过。`
    },
    fallback: {
      title: 'Tab8 独立兜底引擎控制台 [v4.3 新增]',
      content: `
        <strong>📋 用途:</strong> 生产系统能力总览台 — 回答三个核心问题:(1) 系统能接入哪些外部 API? (2) 系统独有哪些自研护城河? (3) 当外部机构全部断开时,系统还能独立提供什么?<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①mock-data.js 预置 15 个外部 API 状态 + C1-C7 兜底子模块默认配置 + B1-B12 自研护城河矩阵 + 三档投入数据;②State 联动规则 4.11-4.15 实时驱动降级链切换。<br><br>
        <strong>🔧 操作流程:</strong><br>
        <span class="op-step">①分区1: 15个API状态卡片</span><span class="op-arrow">→</span>
        <span class="op-step">②分区2: B1-B12 自研矩阵(点卡片看护城河)</span><span class="op-arrow">→</span>
        <span class="op-step">③分区3: C1-C7 兜底状态 + 降级链可视化</span><span class="op-arrow">→</span>
        <span class="op-step">④分区4: 独立运行模式开关(阻塞Modal确认)</span><span class="op-arrow">→</span>
        <span class="op-step">⑤分区5: 三档投入占比仪表盘(切维度)</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">API断开</span> → 联动规则4.11 → 对应C兜底子模块自动激活 + 降级链1→2级;<br>
        <span class="op-trigger">独立运行模式</span> → 联动规则4.12 → 所有API forced_off + C1-C7全激活 + 降级链3级;<br>
        <span class="op-trigger">B模块卡片</span> → 联动规则4.13 → 输出护城河说明 + 高亮在其他Tab的体现位置;<br>
        <span class="op-trigger">兜底报告</span> → 联动规则4.14 → 强制带 ⚠️ 自营兜底·非外部机构背书 标注 + 能力边界明示;<br>
        <span class="op-trigger">仪表盘切换</span> → 联动规则4.15 → 按模块数/工时/百分比三维度重绘 + 输出三档对比数据。<br><br>
        <strong>⬆️ 下游影响:</strong> ①独立运行模式 → 所有Tab顶部全局告警横幅(橙色);②C1/C2激活 → 全局橙色告警横幅 + 跳转Tab8;③其他C模块激活 → 非阻塞Toast(右下角6.5s);④兜底报告 → 强制标注"自营兜底"提示用户推动对应API接入。`
    },
    scf: {
      title: 'Tab11 供应链金融工作台 [v6.0 新增]',
      content: `
        <strong>📋 用途:</strong> 供应链金融独立闭环系统 — 围绕核心企业上下游,构建13维画像 + 关系图谱 + 黑白名单 + 信用传导 + 贸易背景核验 + 5类SCF产品路由 + 动态定价 + 风险扩散分析 + 机构撮合 + 履约监控 + 案例学习的完整业务闭环。SC1-SC10 引擎族独立运行,与R1-R10企业改造引擎并行,共享企业数据但独立维护供应链关系网络。<br><br>
        <strong>⬇️ 上游谁喂数据:</strong> ①scf-data.js 预置5家供应链企业(供应商/采购商/物流/经销商/核心企业)+关系图谱+贸易记录+黑白名单+案例库;②mock-data.js 中SCF_PRODUCTS(5类产品:应收账款融资/预付款融资/存货融资/订单融资/反向保理)+SCF_MARKET市场动态;③State.scfDatabase + State.scfEngine 独立分区持久化,localStorage自动保存。<br><br>
        <strong>🔧 操作流程(10步闭环):</strong><br>
        <span class="op-step">①SC1 入口+画像+图谱</span><span class="op-arrow">→</span>
        <span class="op-step">②SC2 黑白名单管理</span><span class="op-arrow">→</span>
        <span class="op-step">③SC3 信用传导计算</span><span class="op-arrow">→</span>
        <span class="op-step">④SC4 贸易背景核验</span><span class="op-arrow">→</span>
        <span class="op-step">⑤SC5 产品路由匹配</span><span class="op-arrow">→</span>
        <span class="op-step">⑥SC6 动态定价</span><span class="op-arrow">→</span>
        <span class="op-step">⑦SC7 风险扩散分析</span><span class="op-arrow">→</span>
        <span class="op-step">⑧SC8 机构撮合</span><span class="op-arrow">→</span>
        <span class="op-step">⑨SC9 履约监控</span><span class="op-arrow">→</span>
        <span class="op-step">⑩SC10 案例学习</span><br><br>
        <strong>⚡ 触发条件:</strong><br>
        <span class="op-trigger">SC1画像</span> 13维 = 8维继承(主体/财务/税务/业务/资产/信用/政策/资本)+5维新增(贸易稳定/真实性/忠诚度/可靠性/网络位置);<br>
        <span class="op-trigger">关系图谱</span> ECharts力导向图渲染 → 节点大小=度中心性,颜色=角色(核心橙/供应商蓝/采购商绿/物流紫/经销商青);<br>
        <span class="op-trigger">三级信用</span> 独立信用分 → 传导信用分(核心企业传导) → 场景信用分(SCF产品专属);<br>
        <span class="op-trigger">黑白名单</span> SC2自动检测违约/欺诈/关联风险 → 黑名单触发拒绝+告警,白名单触发绿色通道;<br>
        <span class="op-trigger">贸易核验</span> SC4核验四要素:合同+发票+物流+资金流 → 一致性评分≥80分通过;<br>
        <span class="op-trigger">产品路由</span> SC5根据企业角色+贸易类型+信用分匹配5类SCF产品 → 利率/额度/期限动态计算;<br>
        <span class="op-trigger">风险扩散</span> SC7图算法分析:度中心性/环检测/最短路径 → 单点风险扩散到全链的影响范围可视化;<br>
        <span class="op-trigger">一键流水线</span> S0顶部控制台「端到端模拟」按钮 → 自动执行SC1-SC10全流程 → 结果汇总toast。<br><br>
        <strong>📐 10大分区:</strong> S0顶部控制台(一键流水线+数据库总览) · S1企业入口+13维画像 · S2关系图谱(ECharts) · S3黑白名单 · S4信用传导 · S5贸易核验 · S6产品路由+定价 · S7风险扩散 · S8机构撮合 · S9履约监控 · S10案例学习<br><br>
        <strong>⬆️ 下游影响:</strong> ①SCF融资成功 → Tab4银行端水位/回款更新;②黑名单触发 → Tab3审批队列推送风险工单;③案例学习 → 沉淀到Tab0 R10案例库供改造参考;④所有SCF操作 → Tab7 AI驾驶舱自动记录;⑤机构撮合 → Tab6顾问运营台佣金结算联动。`
    }
  },

  init() {
    // 绑定浮动按钮事件
    const fab = document.getElementById('guide-fab-btn');
    if (fab) fab.onclick = () => this.toggle();

    // 绑定 Tab 导航右侧的"操作指引"永久入口按钮
    const tabGuideBtn = document.getElementById('tab-guide-btn');
    if (tabGuideBtn) tabGuideBtn.onclick = () => this.toggle();

    // 绑定面板按钮事件
    const closeBtn = document.getElementById('guide-close-btn');
    if (closeBtn) closeBtn.onclick = () => this.hide();
    const minBtn = document.getElementById('guide-minimize-btn');
    if (minBtn) minBtn.onclick = () => this.minimize();

    this.updateContent();

    // v=32: 首次访问自动展开操作指引, 让用户立刻看到当前 Tab 的操作流程
    // 只在 sessionStorage 没有标记时自动展开 (避免刷新/切Tab反复弹出)
    if (!sessionStorage.getItem('guideAutoShown')) {
      sessionStorage.setItem('guideAutoShown', '1');
      setTimeout(() => this.show(), 400);
    }
  },

  toggle() {
    const panel = document.querySelector('.guide-panel');
    if (!panel) return;
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  },

  show() {
    const panel = document.querySelector('.guide-panel');
    const fab = document.querySelector('.guide-fab');
    if (panel) {
      panel.classList.remove('hidden');
      this._visible = true;
      this._minimized = false;
    }
    if (fab) fab.style.display = 'none';
    // 同步 Tab 导航右侧入口按钮的高亮状态
    const tabBtn = document.getElementById('tab-guide-btn');
    if (tabBtn) tabBtn.classList.add('active');
    this.updateContent();
  },

  hide() {
    const panel = document.querySelector('.guide-panel');
    const fab = document.querySelector('.guide-fab');
    if (panel) {
      panel.classList.add('hidden');
      this._visible = false;
    }
    if (fab) fab.style.display = 'flex';
    const tabBtn = document.getElementById('tab-guide-btn');
    if (tabBtn) tabBtn.classList.remove('active');
  },

  minimize() {
    const panel = document.querySelector('.guide-panel');
    const fab = document.querySelector('.guide-fab');
    if (panel) {
      panel.classList.add('hidden');
      this._visible = false;
      this._minimized = true;
    }
    if (fab) fab.style.display = 'flex';
    const tabBtn = document.getElementById('tab-guide-btn');
    if (tabBtn) tabBtn.classList.remove('active');
  },

  updateContent() {
    const tab = State.activeTab;
    const guide = this.guides[tab];
    if (!guide) return;
    const titleEl = document.getElementById('guide-title');
    const bodyEl = document.getElementById('guide-body');
    if (titleEl) titleEl.textContent = guide.title;
    if (bodyEl) bodyEl.innerHTML = guide.content;
  }
};

window.GuideManager = GuideManager;
