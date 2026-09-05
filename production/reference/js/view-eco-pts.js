// FinTrust Hub v3.1 - ECO-06 积分商城与行为挖矿 - UI 视图
'use strict';

/**
 * EcoPtsView — ECO-06 积分商城与行为挖矿 UI 视图
 *
 * 设计哲学 (spec.md L2283):
 *   让基层员工因为"顺手一扫"获得实惠, 物流端配合度从 10% 飙升至 90%
 *
 * 视图布局 (6 大区块, 全部使用深色主题 CSS 变量, 禁止浅色硬编码):
 *   ┌──────────────────────────────────────────────────────┐
 *   │ P0 顶部控制台: 企业选择 + 工人选择 + 演示按钮组          │
 *   ├───────────────────────────┬──────────────────────────┤
 *   │ P1 工人积分账户卡片         │  P2 商品商城 (网格 + 兑换)  │
 *   │ 三种积分余额 + 连续天数     │  5 个商品 (财务顾问公司团购) │
 *   ├───────────────────────────┼──────────────────────────┤
 *   │ P3 月度排行榜 Top10         │  P4 兑换订单列表           │
 *   │ (高亮 Top10 + 现金红包)     │  (待采购→采购中→配送→送达)  │
 *   ├───────────────────────────┴──────────────────────────┤
 *   │ P5 月度积分消耗统计 → 老板责任链健康度指标              │
 *   │ (配合度 10%→90% + 单员工月均成本 30-50 元 + 健康度评分) │
 *   └──────────────────────────────────────────────────────┘
 *
 * 自挂载入口:
 *   - 默认容器 #view-eco-pts (若 index.html 已包含则自动 render)
 *   - 也可手动调用 EcoPtsView.render('some-container-id')
 *
 * 依赖: window.EcoPts (eco-pts.js), window.State (只读)
 */

const EcoPtsView = {
  // 当前选择的企业 ID / 工人 ID
  _entId: null,
  _workerId: null,

  // ============================================================
  // 主入口
  // ============================================================

  /** 渲染到指定容器 (默认 'view-eco-pts') */
  render(containerId) {
    const cid = containerId || 'view-eco-pts';
    const container = document.getElementById(cid);
    if (!container) {
      // 容器不存在, 静默退出 (便于在未挂载的页面跳过)
      return;
    }

    // 初始化默认企业/工人
    if (!this._entId) {
      this._entId = (typeof window !== 'undefined' && window.State && window.State.currentEnterpriseId)
        ? window.State.currentEnterpriseId
        : 'E001';
    }
    const workers = window.EcoPts.getWorkersByEnterprise(this._entId);
    if (!this._workerId || !workers.find(w => w.workerId === this._workerId)) {
      this._workerId = workers.length > 0 ? workers[0].workerId : null;
    }

    // 渲染整体布局
    container.innerHTML = `
      ${this._renderP0_Console()}
      <div class="card-grid card-grid-2">
        ${this._renderP1_AccountCard()}
        ${this._renderP2_Shop()}
      </div>
      <div class="card-grid card-grid-2">
        ${this._renderP3_Ranking()}
        ${this._renderP4_Orders()}
      </div>
      ${this._renderP5_Consumption()}
      ${this._renderFooter()}
    `;

    // 绑定事件
    this._bindEvents();
  },

  /** 自动挂载: 若 #view-eco-pts 存在则渲染 */
  mount() {
    this.render('view-eco-pts');
  },

  // ============================================================
  // P0 顶部控制台
  // ============================================================
  _renderP0_Console() {
    const entId = this._entId;
    const enterprises = (typeof window !== 'undefined' && window.State && Array.isArray(window.State.enterprises) && window.State.enterprises.length > 0)
      ? window.State.enterprises
      : window.EcoPts.WORKER_ROSTER.reduce((acc, w) => {
          if (!acc.find(e => e.id === w.entId)) acc.push({ id: w.entId, name: w.entName });
          return acc;
        }, []);
    const workers = window.EcoPts.getWorkersByEnterprise(entId);
    const currentWorker = window.EcoPts.getWorkerById(this._workerId);

    return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          <span>🌱 ECO-06 积分商城与行为挖矿 (MOD-14 P1)</span>
          <span style="font-size:11px;color:var(--text-muted)">扫码确权发积分 → 兑换实物 → 物流配合度 10%→90%</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text-secondary);margin-bottom:10px">
          <label>企业:
            <select id="eco-ent-select" class="input-field" style="width:auto;display:inline-block;margin-left:6px">
              ${enterprises.map(e => `<option value="${e.id}" ${e.id === entId ? 'selected' : ''}>${e.name}</option>`).join('')}
            </select>
          </label>
          <label>工人:
            <select id="eco-worker-select" class="input-field" style="width:auto;display:inline-block;margin-left:6px">
              ${workers.map(w => `<option value="${w.workerId}" ${w.workerId === this._workerId ? 'selected' : ''}>${w.name} (${w.role})</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-success btn-sm" id="eco-btn-scan" title="模拟扫码确权 → 触发 PTS.1 行为挖矿积分发放 (信用+2/碳+5/信易+3)">📷 演示: 扫码确权</button>
          <button class="btn btn-primary btn-sm" id="eco-btn-exception" title="模拟异常上报 → PTS.2 正向激励 (信用+3/碳+2/信易+5)">⚠️ 演示: 异常上报</button>
          <button class="btn btn-warning btn-sm" id="eco-btn-oof" title="GPS 围栏外扫码 → PTS.5 积分减半">📍 演示: GPS 围栏外</button>
          <button class="btn btn-danger btn-sm" id="eco-btn-fraud" title="设备指纹不一致 → PTS.5 代签清零预警">🚨 演示: 代签清零</button>
          <button class="btn btn-outline btn-sm" id="eco-btn-streak" title="触发连续 7 天奖励 → +20 信用分">🔥 触发 7 天奖励</button>
          <button class="btn btn-outline btn-sm" id="eco-btn-seed" title="首次访问空数据库时填充演示数据">🌱 填充种子数据</button>
          <button class="btn btn-outline btn-sm" id="eco-btn-reset" title="清空 ECO-06 所有 localStorage 数据 (调试用)">🗑 重置数据</button>
        </div>
        ${currentWorker ? `
          <div style="margin-top:10px;padding:8px 10px;background:rgba(88,166,255,0.06);border-radius:6px;font-size:12px;color:var(--text-secondary)">
            当前工人: <strong style="color:var(--text-primary)">${currentWorker.name}</strong>
            (${currentWorker.role} · ${currentWorker.entName} · 设备指纹 <code>${currentWorker.deviceFp}</code>)
          </div>
        ` : ''}
      </div>
    `;
  },

  // ============================================================
  // P1 工人积分账户卡片
  // ============================================================
  _renderP1_AccountCard() {
    const acc = this._workerId ? window.EcoPts.getAccount(this._workerId) : null;
    if (!acc) {
      return `
        <div class="card">
          <div class="card-title"><span>💰 工人积分账户</span></div>
          <div style="text-align:center;color:var(--text-muted);padding:30px">请选择工人</div>
        </div>
      `;
    }
    const streakPct = Math.min(100, Math.round(acc.streak.consecutiveDays / 7 * 100));
    const canClaimStreak = acc.streak.streak7dEligible && !acc.streak.streak7dClaimedToday;

    return `
      <div class="card">
        <div class="card-title">
          <span>💰 工人积分账户 · ${acc.workerName}</span>
          <span class="tag tag-blue">${acc.role}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">${acc.entName}</div>
        <div class="card-grid card-grid-3" style="margin-bottom:10px">
          <div class="metric" style="padding:10px;background:var(--bg-tertiary);border-radius:6px;border-left:3px solid var(--accent-blue)">
            <span class="metric-label">信用分 (责任链)</span>
            <span class="metric-value" style="font-size:24px;color:var(--accent-blue)">${acc.balances.credit}</span>
          </div>
          <div class="metric" style="padding:10px;background:var(--bg-tertiary);border-radius:6px;border-left:3px solid var(--accent-green)">
            <span class="metric-label">碳积分 (环保)</span>
            <span class="metric-value green" style="font-size:24px">${acc.balances.carbon}</span>
          </div>
          <div class="metric" style="padding:10px;background:var(--bg-tertiary);border-radius:6px;border-left:3px solid var(--accent-purple)">
            <span class="metric-label">信易分 (信用)</span>
            <span class="metric-value" style="font-size:24px;color:var(--accent-purple)">${acc.balances.easyTrust}</span>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:10px">
          <div>
            <div style="font-size:11px;color:var(--text-muted)">可兑换总积分</div>
            <div style="font-size:22px;font-weight:700;color:var(--accent-orange)">${acc.totalPoints}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--text-muted)">累计发放 / 累计兑换</div>
            <div style="font-size:13px;color:var(--text-secondary)">
              ${acc.totalEarned.credit + acc.totalEarned.carbon + acc.totalEarned.easyTrust} / ${acc.totalRedeemed}
            </div>
          </div>
        </div>
        <div style="padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px">
            <span>🔥 连续确权 ${acc.streak.consecutiveDays}/7 天</span>
            <span>${acc.streak.lastConfirmDate ? '最后: ' + acc.streak.lastConfirmDate : '尚无记录'}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${streakPct >= 100 ? 'green' : 'orange'}" style="width:${streakPct}%"></div>
          </div>
          ${canClaimStreak ? `
            <div style="margin-top:8px;font-size:11px;color:var(--accent-green)">
              ✓ 已达成连续 7 天, 可领取 +20 奖励 (点击上方"触发 7 天奖励")
            </div>
          ` : acc.streak.streak7dClaimedToday ? `
            <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">今日已领取 7 天奖励</div>
          ` : ''}
        </div>
        ${acc.recentActions && acc.recentActions.length > 0 ? `
          <details style="margin-top:8px">
            <summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">最近 ${acc.recentActions.length} 条行为记录</summary>
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
              ${acc.recentActions.map(a => this._renderActionRow(a)).join('')}
            </div>
          </details>
        ` : ''}
      </div>
    `;
  },

  /** 行为记录行 */
  _renderActionRow(a) {
    const typeMap = {
      scan_confirm: { label: '扫码确权', color: 'blue', icon: '📷' },
      exception_report: { label: '异常上报', color: 'orange', icon: '⚠️' },
      streak_7d: { label: '7天奖励', color: 'green', icon: '🔥' },
      redeem: { label: '兑换', color: 'purple', icon: '🎁' }
    };
    const t = typeMap[a.type] || { label: a.type, color: 'gray', icon: '•' };
    const ts = a.ts ? new Date(a.ts).toLocaleString('zh-CN', { hour12: false }) : '';
    let detail = '';
    if (a.awarded) {
      const parts = [];
      if (a.awarded.credit) parts.push(`信用+${a.awarded.credit}`);
      if (a.awarded.carbon) parts.push(`碳+${a.awarded.carbon}`);
      if (a.awarded.easyTrust) parts.push(`信易+${a.awarded.easyTrust}`);
      detail = parts.join(' / ');
    } else if (a.deduct && a.itemName) {
      detail = `${a.itemName} -${a.deduct.credit + a.deduct.carbon + a.deduct.easyTrust}`;
    } else if (a.action === 'cleared') {
      detail = `<span style="color:var(--accent-red)">代签清零: ${a.reason || ''}</span>`;
    }
    return `
      <div style="padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:4px;font-size:11px;color:var(--text-secondary)">
        <span>${t.icon}</span>
        <span class="tag tag-${t.color} tag-xs">${t.label}</span>
        <span style="color:var(--text-muted);margin:0 6px">${ts}</span>
        <span style="color:var(--text-primary)">${detail}</span>
        ${a.factor && a.factor < 1 ? `<span style="color:var(--accent-orange);margin-left:6px">(减半)</span>` : ''}
      </div>
    `;
  },

  // ============================================================
  // P2 商品商城
  // ============================================================
  _renderP2_Shop() {
    const items = window.EcoPts.getShopItems();
    const acc = this._workerId ? window.EcoPts.getAccount(this._workerId) : null;
    const myPoints = acc ? acc.totalPoints : 0;

    return `
      <div class="card">
        <div class="card-title">
          <span>🛒 企业福利商城</span>
          <span style="font-size:11px;color:var(--text-muted)">财务顾问公司团购 · 成本计入 C5 运营成本</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          spec: 积分可在 APP-02 移动端兑换实物, 商品由企业行政/财务顾问公司统一采购配送
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
          ${items.map(it => {
            const affordable = myPoints >= it.creditCost;
            const stockPct = Math.min(100, Math.round(it.stock / (it.id === 'shop-004' ? 200 : 100) * 100));
            const stockColor = it.stock > 30 ? 'green' : it.stock > 10 ? 'orange' : 'red';
            return `
              <div style="padding:12px;background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:8px;display:flex;flex-direction:column;gap:6px;${affordable ? '' : 'opacity:0.6'}">
                <div style="font-size:28px;text-align:center">${it.icon}</div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);text-align:center;min-height:32px">${it.name}</div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="tag tag-${it.category === '电子' ? 'blue' : it.category === '生活' ? 'green' : it.category === '餐饮' ? 'orange' : it.category === '通讯' ? 'purple' : 'gray'} tag-xs">${it.category}</span>
                  <span style="font-size:14px;font-weight:700;color:var(--accent-orange)">${it.creditCost} 分</span>
                </div>
                <div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">库存: ${it.stock}</div>
                  <div class="progress-bar" style="height:4px"><div class="progress-fill ${stockColor}" style="width:${stockPct}%"></div></div>
                </div>
                <button class="btn ${affordable && it.stock > 0 ? 'btn-primary' : 'btn-outline'} btn-sm"
                  ${affordable && it.stock > 0 ? '' : 'disabled'}
                  onclick="EcoPtsView.onRedeem('${it.id}')"
                  title="兑换 → 扣积分 → 生成订单 → 财务顾问公司采购配送">
                  ${it.stock <= 0 ? '缺货' : affordable ? '兑换' : '积分不足'}
                </button>
              </div>
            `;
          }).join('')}
        </div>
        <div style="margin-top:10px;padding:8px 10px;background:rgba(188,140,255,0.06);border-radius:6px;font-size:11px;color:var(--text-secondary)">
          💡 单员工月均成本控制目标: ¥${window.EcoPts.MONTHLY_COST_MIN}-${window.EcoPts.MONTHLY_COST_MAX}
          (spec: 性价比远超传统管理督促)
        </div>
      </div>
    `;
  },

  // ============================================================
  // P3 月度排行榜
  // ============================================================
  _renderP3_Ranking() {
    const rank = window.EcoPts.getRanking(this._entId);
    return `
      <div class="card">
        <div class="card-title">
          <span>🏆 月度积分排行榜</span>
          <span class="tag tag-orange">${rank.month}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          spec: 月度确权积分 Top10 员工额外奖励 (现金红包), 激发良性竞争
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${rank.all.length === 0 ? `
            <div style="text-align:center;color:var(--text-muted);padding:20px">暂无排行数据</div>
          ` : rank.all.map(r => {
            const isMe = r.workerId === this._workerId;
            const inTop10 = r.inTop10;
            const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
            const rowBg = inTop10
              ? (r.rank <= 3 ? 'rgba(255,193,7,0.08)' : 'rgba(63,185,80,0.06)')
              : 'rgba(255,255,255,0.02)';
            const borderColor = inTop10
              ? (r.rank <= 3 ? 'var(--accent-orange)' : 'var(--accent-green)')
              : 'var(--border-light)';
            return `
              <div style="padding:8px 10px;background:${rowBg};border:1px solid ${borderColor};border-radius:6px;display:flex;align-items:center;gap:8px;${isMe ? 'box-shadow:0 0 0 2px var(--accent-blue);' : ''}">
                <span style="width:32px;text-align:center;font-weight:700;color:${inTop10 ? 'var(--accent-orange)' : 'var(--text-muted)'}">
                  ${medal || '#' + r.rank}
                </span>
                <div style="flex:1">
                  <div style="font-size:13px;color:var(--text-primary);font-weight:${inTop10 ? '600' : '400'}">
                    ${r.workerName}
                    ${isMe ? '<span class="tag tag-blue tag-xs" style="margin-left:4px">我</span>' : ''}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted)">${r.role} · 连续 ${r.streak} 天</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:14px;font-weight:700;color:var(--accent-blue)">${r.monthTotal}</div>
                  ${r.bonus > 0 ? `<div style="font-size:11px;color:var(--accent-green)">红包 ¥${r.bonus}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${rank.totalBonusPool > 0 ? `
          <div style="margin-top:10px;padding:8px 10px;background:rgba(63,185,80,0.06);border-radius:6px;font-size:12px;color:var(--text-secondary)">
            Top10 奖金池: <strong style="color:var(--accent-green)">¥${rank.totalBonusPool}</strong>
            (🥇 ¥100 / 🥈🥉 ¥50 / 4-10 名 ¥20)
          </div>
        ` : ''}
      </div>
    `;
  },

  // ============================================================
  // P4 兑换订单列表
  // ============================================================
  _renderP4_Orders() {
    const orders = this._workerId ? window.EcoPts.getRedeemOrders(this._workerId) : [];
    const statusMap = {
      pending:    { label: '待采购', color: 'orange', icon: '⏳' },
      procuring:  { label: '采购中', color: 'blue',   icon: '📦' },
      shipping:   { label: '配送中', color: 'purple', icon: '🚚' },
      delivered:  { label: '已送达', color: 'green',  icon: '✅' }
    };
    return `
      <div class="card">
        <div class="card-title">
          <span>📋 兑换订单</span>
          <span style="font-size:11px;color:var(--text-muted)">采购配送闭环: 财务顾问公司团购 → 物流配送</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          spec: 系统核销积分, 生成兑换订单, 商品由企业行政/财务顾问公司统一采购配送
        </div>
        ${orders.length === 0 ? `
          <div style="text-align:center;color:var(--text-muted);padding:20px">
            暂无兑换订单<br>
            <span style="font-size:12px">在左侧商城选择商品兑换</span>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto">
            ${orders.slice(0, 20).map(o => {
              const st = statusMap[o.status] || statusMap.pending;
              const canAdvance = o.status !== 'delivered';
              const nextLabel = o.status === 'pending' ? '采购' : o.status === 'procuring' ? '发货' : '送达';
              return `
                <div style="padding:8px 10px;background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:6px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span style="font-size:18px">${o.itemIcon}</span>
                      <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${o.itemName}</span>
                      <span class="tag tag-${st.color} tag-xs">${st.icon} ${st.label}</span>
                    </div>
                    <span style="font-size:11px;color:var(--text-muted)">${o.creditCost} 分</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between">
                    <code>${o.orderId}</code>
                    <span>${new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                  ${o.fulfillment ? `
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                      渠道: ${o.fulfillment.channel} · 物流: ${o.fulfillment.logisticsPartner} · 预计 ${o.fulfillment.estDeliveryDays} 天
                    </div>
                  ` : ''}
                  ${canAdvance ? `
                    <button class="btn btn-outline btn-sm" style="margin-top:6px;width:100%;font-size:11px"
                      onclick="EcoPtsView.onAdvanceOrder('${o.orderId}')"
                      title="推进订单状态: ${o.status} → ${nextLabel}">
                      → 推进至: ${nextLabel}
                    </button>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  },

  // ============================================================
  // P5 月度积分消耗统计 → 老板责任链健康度指标
  // ============================================================
  _renderP5_Consumption() {
    const mc = window.EcoPts.getMonthlyConsumption(this._entId);
    const coopPct = Math.round(mc.cooperationRate * 100);
    const healthPct = mc.healthScore;
    const baselinePct = Math.round(window.EcoPts.COOPERATION_BASELINE * 100);
    const targetPct = Math.round(window.EcoPts.COOPERATION_TARGET * 100);

    // 健康度颜色
    const healthColor = healthPct >= 80 ? 'var(--accent-green)' :
                        healthPct >= 60 ? 'var(--accent-blue)' :
                        healthPct >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)';
    // 配合度颜色
    const coopColor = coopPct >= 80 ? 'var(--accent-green)' :
                      coopPct >= 50 ? 'var(--accent-blue)' :
                      coopPct >= 30 ? 'var(--accent-orange)' : 'var(--accent-red)';
    // 成本控制
    const costColor = mc.costInTargetRange ? 'var(--accent-green)' :
                      mc.perWorkerCost === 0 ? 'var(--text-muted)' :
                      mc.perWorkerCost < window.EcoPts.MONTHLY_COST_MIN ? 'var(--accent-orange)' : 'var(--accent-red)';

    return `
      <div class="card">
        <div class="card-title">
          <span>📊 月度积分消耗统计 → 老板责任链健康度指标</span>
          <span class="tag tag-blue">${mc.month}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">
          spec: 财务顾问公司每月统计各企业积分消耗, 作为"责任链配合度"健康度指标推送给老板
          (高消耗=员工积极配合=责任链健康)
        </div>

        <!-- 4 维核心指标 -->
        <div class="card-grid card-grid-3" style="margin-bottom:14px">
          <div class="metric" style="padding:12px;background:var(--bg-tertiary);border-radius:8px;border-top:3px solid ${coopColor}">
            <span class="metric-label">物流端配合度</span>
            <span class="metric-value" style="font-size:28px;color:${coopColor}">${coopPct}%</span>
            <span class="metric-delta">基线 ${baselinePct}% → 目标 ${targetPct}%</span>
          </div>
          <div class="metric" style="padding:12px;background:var(--bg-tertiary);border-radius:8px;border-top:3px solid ${healthColor}">
            <span class="metric-label">责任链健康度评分</span>
            <span class="metric-value" style="font-size:28px;color:${healthColor}">${healthPct}</span>
            <span class="metric-delta">等级 ${mc.healthGrade}</span>
          </div>
          <div class="metric" style="padding:12px;background:var(--bg-tertiary);border-radius:8px;border-top:3px solid ${costColor}">
            <span class="metric-label">单员工月均成本</span>
            <span class="metric-value" style="font-size:28px;color:${costColor}">¥${mc.perWorkerCost.toFixed(2)}</span>
            <span class="metric-delta">目标 ¥${window.EcoPts.MONTHLY_COST_MIN}-${window.EcoPts.MONTHLY_COST_MAX}</span>
          </div>
        </div>

        <!-- 配合度进度条 -->
        <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px">
            <span>🚚 物流端配合度提升轨迹</span>
            <span style="color:${coopColor};font-weight:600">${baselinePct}% → ${coopPct}% (目标 ${targetPct}%)</span>
          </div>
          <div class="progress-bar" style="height:12px;position:relative">
            <div class="progress-fill ${coopPct >= 80 ? 'green' : coopPct >= 50 ? 'blue' : 'orange'}" style="width:${coopPct}%"></div>
            <!-- 目标线 90% -->
            <div style="position:absolute;top:0;left:90%;width:2px;height:100%;background:var(--accent-green);opacity:0.6"></div>
            <!-- 基线 10% -->
            <div style="position:absolute;top:0;left:10%;width:2px;height:100%;background:var(--accent-red);opacity:0.6"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-top:4px">
            <span>10%</span><span>50%</span><span>90% 目标</span>
          </div>
        </div>

        <!-- 健康度仪表 + 老板视角 -->
        <div class="card-grid card-grid-2">
          <div style="padding:12px;background:var(--bg-secondary);border-radius:8px">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">📈 老板视角 · 责任链配合度健康度</div>
            <div style="display:flex;align-items:center;gap:14px">
              <!-- 圆环仪表 (SVG) -->
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="${healthColor}" stroke-width="8"
                  stroke-dasharray="${2 * Math.PI * 34}"
                  stroke-dashoffset="${2 * Math.PI * 34 * (1 - healthPct / 100)}"
                  stroke-linecap="round"
                  transform="rotate(-90 40 40)"/>
                <text x="40" y="46" text-anchor="middle" fill="${healthColor}" font-size="22" font-weight="700">${healthPct}</text>
              </svg>
              <div style="flex:1;font-size:12px;color:var(--text-secondary);line-height:1.7">
                <div>健康等级: <strong style="color:${healthColor}">${mc.healthGrade}</strong></div>
                <div>配合度: <strong style="color:${coopColor}">${mc.bossIndicator.cooperationPct}</strong></div>
                <div>月度总成本: <strong>${mc.bossIndicator.monthlyCostTotal}</strong></div>
                <div>趋势: <strong style="color:${mc.cooperationRate >= window.EcoPts.COOPERATION_TARGET ? 'var(--accent-green)' : mc.cooperationRate >= 0.5 ? 'var(--accent-blue)' : 'var(--accent-orange)'}">${mc.bossIndicator.trend}</strong></div>
              </div>
            </div>
            <div style="margin-top:10px;padding:8px 10px;background:var(--bg-tertiary);border-radius:6px;font-size:11px;color:var(--text-secondary)">
              💡 ${mc.bossIndicator.advice}
            </div>
          </div>

          <div style="padding:12px;background:var(--bg-secondary);border-radius:8px">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">📋 月度运营数据</div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
              <div style="display:flex;justify-content:space-between">
                <span>本月积分发放</span>
                <strong style="color:var(--accent-blue)">${mc.stats.earned}</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span>本月积分兑换</span>
                <strong style="color:var(--accent-orange)">${mc.stats.redeemed}</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span>本月兑换订单数</span>
                <strong>${mc.stats.orders}</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span>本月总采购成本</span>
                <strong>¥${(mc.stats.currencyCost || 0).toFixed(2)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-light);padding-top:6px;margin-top:4px">
                <span>总工人 / 活跃工人</span>
                <strong>${mc.activeWorkers} / ${mc.totalWorkers}</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span>工人参与率</span>
                <strong style="color:var(--accent-blue)">${(mc.participationRate * 100).toFixed(1)}%</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- 防刷分日志摘要 (PTS.5 透明度) -->
        ${this._renderFraudSummary()}
      </div>
    `;
  },

  /** 防刷分日志摘要 */
  _renderFraudSummary() {
    const log = window.EcoPts.getFraudLog(5);
    if (log.length === 0) return '';
    return `
      <div style="margin-top:12px;padding:10px;background:rgba(248,81,73,0.04);border:1px solid rgba(248,81,73,0.2);border-radius:6px">
        <div style="font-size:12px;font-weight:600;color:var(--accent-red);margin-bottom:6px">🚨 防刷分预警 (最近 ${log.length} 条)</div>
        <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-secondary)">
          ${log.map(l => `
            <div style="padding:4px 6px;background:var(--bg-tertiary);border-radius:4px">
              <span style="color:var(--text-muted)">${new Date(l.ts).toLocaleString('zh-CN', { hour12: false })}</span>
              · 工人 <code>${l.workerId}</code>
              · <strong style="color:var(--accent-orange)">${l.reason}</strong>
              ${l.detail ? `<div style="color:var(--text-muted);margin-top:2px">${l.detail}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  /** 底部跨视图入口 */
  _renderFooter() {
    return `
      <div style="text-align:center;padding:12px;font-size:11px;color:var(--text-muted)">
        ECO-06 积分商城与行为挖矿 · FinTrust Hub v3.1 · MOD-14 P1
        <span style="margin:0 8px;color:var(--border-color)">|</span>
        持久化: localStorage.eco_pts_* · 浏览器端纯 JS, 无后端
      </div>
    `;
  },

  // ============================================================
  // 事件绑定
  // ============================================================
  _bindEvents() {
    const $ = (id) => document.getElementById(id);

    const entSel = $('eco-ent-select');
    if (entSel) {
      entSel.onchange = () => {
        this._entId = entSel.value;
        const ws = window.EcoPts.getWorkersByEnterprise(this._entId);
        this._workerId = ws.length > 0 ? ws[0].workerId : null;
        this.render();
      };
    }

    const wSel = $('eco-worker-select');
    if (wSel) {
      wSel.onchange = () => {
        this._workerId = wSel.value;
        this.render();
      };
    }

    const bind = (id, fn) => {
      const el = $(id);
      if (el) el.onclick = fn;
    };

    bind('eco-btn-scan',    () => this._act('scan'));
    bind('eco-btn-exception',() => this._act('exception'));
    bind('eco-btn-oof',     () => this._act('oof'));
    bind('eco-btn-fraud',   () => this._act('fraud'));
    bind('eco-btn-streak',  () => this._act('streak'));
    bind('eco-btn-seed',    () => this._act('seed'));
    bind('eco-btn-reset',   () => this._act('reset'));
  },

  /** 演示动作统一入口 */
  async _act(kind) {
    if (!window.EcoPts) {
      alert('EcoPts 引擎未加载');
      return;
    }
    if (kind !== 'seed' && kind !== 'reset' && !this._workerId) {
      alert('请先选择工人');
      return;
    }
    try {
      let r;
      let msg = '';
      switch (kind) {
        case 'scan':
          r = await window.EcoPts.demoScanConfirm(this._workerId);
          msg = r.ok
            ? `✅ 扫码确权成功\n${r.workerName} 获得:\n  信用分 +${r.awarded.credit}\n  碳积分 +${r.awarded.carbon}\n  信易分 +${r.awarded.easyTrust}${r.fraudNote ? '\n  ⚠️ ' + r.fraudNote : ''}${r.streakBonus && r.streakBonus.ok ? '\n\n🔥 连续 7 天奖励已触发: 信用分 +' + r.streakBonus.awarded.credit : ''}`
            : `❌ ${r.message || r.reason}`;
          break;
        case 'exception':
          r = await window.EcoPts.demoExceptionReport(this._workerId);
          msg = r.ok
            ? `✅ 异常上报激励已发放\n${r.workerName} 获得:\n  信用分 +${r.awarded.credit}\n  碳积分 +${r.awarded.carbon}\n  信易分 +${r.awarded.easyTrust}\n\n(spec: 鼓励诚实而非隐瞒)`
            : `❌ ${r.message || r.reason}`;
          break;
        case 'oof':
          r = await window.EcoPts.demoScanOutOfFence(this._workerId);
          msg = r.ok
            ? `📍 GPS 围栏外扫码完成\n积分减半:\n  信用分 +${r.awarded.credit} (原 2)\n  碳积分 +${r.awarded.carbon} (原 5)\n  信易分 +${r.awarded.easyTrust} (原 3)`
            : `❌ ${r.message || r.reason}`;
          break;
        case 'fraud':
          r = await window.EcoPts.demoScanWithFraudFingerprint(this._workerId);
          msg = r.ok
            ? `✅ 操作完成`
            : `🚨 代签清零预警\n${r.message || r.reason}\n\n该工人所有积分已清零, 防刷分日志已记录`;
          break;
        case 'streak':
          r = await window.EcoPts.awardStreakBonus(this._workerId);
          msg = r.ok
            ? `🔥 连续 7 天奖励已发放\n${r.workerName} 获得信用分 +${r.awarded.credit}\n当前连续天数: ${r.currentStreak}`
            : `❌ ${r.message || r.reason}`;
          break;
        case 'seed':
          r = await window.EcoPts.seedDemoDataIfEmpty();
          msg = r.ok
            ? `🌱 种子数据已填充\n  确权次数: ${r.totalAwarded}\n  兑换订单: ${r.totalOrders}`
            : `ℹ️ ${r.reason === 'already_seeded' ? '数据已存在, 无需重复填充 (如需重置请点"重置数据")' : r.reason}`;
          break;
        case 'reset':
          if (!confirm('确定清空所有 ECO-06 数据? 此操作不可恢复!')) return;
          r = await window.EcoPts.resetAll();
          msg = r.ok ? `🗑 已清空 ${r.removed} 个 localStorage 键` : '❌ 重置失败';
          break;
      }
      alert(msg);
      this.render();
    } catch (e) {
      console.error('[EcoPtsView] action error:', e);
      alert('操作失败: ' + (e.message || e));
    }
  },

  // ============================================================
  // P2 兑换商品回调
  // ============================================================
  async onRedeem(itemId) {
    if (!this._workerId) {
      alert('请先选择工人');
      return;
    }
    const item = window.EcoPts.SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return;
    if (!confirm(`确认兑换 "${item.name}"?\n将扣除 ${item.creditCost} 积分`)) return;
    const r = await window.EcoPts.redeem(this._workerId, itemId);
    if (r.ok) {
      alert(`✅ 兑换成功\n商品: ${item.icon} ${item.name}\n订单号: ${r.orderId}\n剩余总积分: ${r.balances.credit + r.balances.carbon + r.balances.easyTrust}\n\n订单将由财务顾问公司统一采购配送`);
    } else {
      alert(`❌ 兑换失败: ${r.message || r.reason}`);
    }
    this.render();
  },

  // ============================================================
  // P4 推进订单状态回调
  // ============================================================
  async onAdvanceOrder(orderId) {
    const orders = JSON.parse(localStorage.getItem(window.EcoPts.ORDERS_STORAGE_KEY) || '[]');
    const o = orders.find(x => x.orderId === orderId);
    if (!o) return;
    const next = o.status === 'pending' ? 'procuring' :
                o.status === 'procuring' ? 'shipping' :
                o.status === 'shipping' ? 'delivered' : null;
    if (!next) return;
    const r = await window.EcoPts.advanceOrder(orderId, next);
    if (!r.ok) {
      alert('状态推进失败: ' + (r.reason || ''));
      return;
    }
    this.render();
  }
};

// 暴露到全局
window.EcoPtsView = EcoPtsView;

// 自动挂载 (若 #view-eco-pts 存在则渲染)
if (typeof document !== 'undefined') {
  const _autoMount = () => {
    if (document.getElementById('view-eco-pts')) {
      EcoPtsView.mount();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoMount);
  } else {
    _autoMount();
  }
}
