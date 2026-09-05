// FinTrust Hub v3.1 - ECO-06 积分商城与行为挖矿 - 模拟器实现
'use strict';

/**
 * EcoPts — 积分商城与行为挖矿核心引擎 (ECO-06 / MOD-14)
 *
 * 设计哲学 (spec.md L2283):
 *   仓管、物流司机觉得"扫码确权"是额外负担 → 给他们即时正向反馈
 *   工人每确认一次责任节点 → 同步发放"行为挖矿"积分 → 兑换实物
 *   物流端配合度从 10% 飙升至 90%
 *
 * 三种积分余额:
 *   credit    信用分  (责任链完整度, +2/次扫码确权)
 *   carbon    碳积分  (按时确权减少纸质单据, 环保属性, +5/次)
 *   easyTrust 信易分  (按时确权提升企业信用, 连带收益, +3/次)
 *
 * 持久化:
 *   localStorage.eco_pts_account_<entId>_<workerId>  → 个人账户
 *   localStorage.eco_pts_orders_registry             → 全局兑换订单流水
 *   localStorage.eco_pts_consumption_monthly        → 月度消耗统计
 *   localStorage.eco_pts_shop_stock                 → 商品库存
 *   localStorage.eco_pts_fraud_log                  → 防刷分审计日志
 *
 * 浏览器端纯 JS, 所有方法 async/await, 无后端依赖
 */

const EcoPts = {
  // ============================================================
  // 配置常量
  // ============================================================
  VERSION: '3.1',
  MODULE_CODE: 'ECO-06',

  STORAGE_PREFIX: 'eco_pts_account_',
  ORDERS_STORAGE_KEY: 'eco_pts_orders_registry',
  CONSUMPTION_STORAGE_KEY: 'eco_pts_consumption_monthly',
  SHOP_STOCK_KEY: 'eco_pts_shop_stock',
  FRAUD_LOG_KEY: 'eco_pts_fraud_log',

  // PTS.1 行为挖矿积分发放规则 (spec.md L2287-2291)
  POINT_RULES: {
    // 扫码确权: 信用分+2 / 碳积分+5 / 信易分+3
    scan_confirm:      { credit: 2,  carbon: 5, easyTrust: 3, label: '扫码确权' },
    // 异常上报正向激励 (spec.md L2299): 鼓励诚实而非隐瞒
    exception_report:  { credit: 3,  carbon: 2, easyTrust: 5, label: '异常上报' },
    // 连续 7 天准时确权 +20 (spec.md L2291)
    streak_7d:         { credit: 20, carbon: 0, easyTrust: 0, label: '连续7天奖励' }
  },

  // 连续确权奖励阈值
  STREAK_THRESHOLD_DAYS: 7,

  // 防刷分: 重复扫码窗口 (5 分钟内同物料不重发)
  REPEAT_SCAN_WINDOW_MS: 5 * 60 * 1000,

  // PTS.3 商品库 (spec.md L2293-2295) - 由财务顾问公司团购, 成本计入运营成本 C5
  SHOP_ITEMS: [
    { id: 'shop-001', name: '充电宝 10000mAh',   icon: '🔋', creditCost: 30, currencyCost: 35, stock: 50,  category: '电子' },
    { id: 'shop-002', name: '保温杯 316不锈钢',   icon: '☕', creditCost: 20, currencyCost: 25, stock: 80,  category: '生活' },
    { id: 'shop-003', name: '外卖券 30元',         icon: '🍱', creditCost: 25, currencyCost: 30, stock: 100, category: '餐饮' },
    { id: 'shop-004', name: '话费充值 50元',       icon: '📱', creditCost: 40, currencyCost: 50, stock: 200, category: '通讯' },
    { id: 'shop-005', name: '电影票 2D',           icon: '🎬', creditCost: 35, currencyCost: 40, stock: 60,  category: '娱乐' }
  ],

  // 单员工月均成本控制 (spec.md L2311: 30-50 元)
  MONTHLY_COST_MIN: 30,
  MONTHLY_COST_MAX: 50,

  // PTS.7 物流端配合度基线 (spec.md L2283: 10% → 90%)
  COOPERATION_BASELINE: 0.10,
  COOPERATION_TARGET: 0.90,

  // 工人花名册 — 衍生自 mock-data.js 责任链节点 N01-N12 的 operator 字段
  // 跨 4 家企业 (E001-E004), 每家 3-4 名关键岗位工人
  WORKER_ROSTER: [
    // E001 宏达精密制造有限公司
    { workerId: 'E001-W01', name: '孙物流', role: '物流司机',   entId: 'E001', entName: '宏达精密制造有限公司', deviceFp: 'fp-sun-001' },
    { workerId: 'E001-W02', name: '张仓库', role: '仓库管理员', entId: 'E001', entName: '宏达精密制造有限公司', deviceFp: 'fp-zhang-002' },
    { workerId: 'E001-W03', name: '赵生产', role: '生产负责人', entId: 'E001', entName: '宏达精密制造有限公司', deviceFp: 'fp-zhao-003' },
    { workerId: 'E001-W04', name: '周销售', role: '销售',       entId: 'E001', entName: '宏达精密制造有限公司', deviceFp: 'fp-zhou-004' },
    // E002 智芯科技有限公司
    { workerId: 'E002-W01', name: '陈物流', role: '物流司机',   entId: 'E002', entName: '智芯科技有限公司',     deviceFp: 'fp-chen-101' },
    { workerId: 'E002-W02', name: '林仓管', role: '仓库管理员', entId: 'E002', entName: '智芯科技有限公司',     deviceFp: 'fp-lin-102' },
    { workerId: 'E002-W03', name: '黄财务', role: '财务人员',   entId: 'E002', entName: '智芯科技有限公司',     deviceFp: 'fp-huang-103' },
    // E003 鑫达贸易有限公司
    { workerId: 'E003-W01', name: '吴司机', role: '物流司机',   entId: 'E003', entName: '鑫达贸易有限公司',     deviceFp: 'fp-wu-201' },
    { workerId: 'E003-W02', name: '郑仓管', role: '仓库管理员', entId: 'E003', entName: '鑫达贸易有限公司',     deviceFp: 'fp-zheng-202' },
    // E004 (第四家, 跨企业演示)
    { workerId: 'E004-W01', name: '冯司机', role: '物流司机',   entId: 'E004', entName: '盛源食品有限公司',     deviceFp: 'fp-feng-301' },
    { workerId: 'E004-W02', name: '钱仓管', role: '仓库管理员', entId: 'E004', entName: '盛源食品有限公司',     deviceFp: 'fp-qian-302' }
  ],

  // GPS 围栏 (企业仓库坐标, 简化模拟)
  // 真实生产环境由 APP-02 移动端扫码传入
  GEO_FENCES: {
    'E001': { lat: 22.5431, lng: 113.9136, radiusKm: 1.0, name: '深圳宝安工业园' },
    'E002': { lat: 22.6589, lng: 114.0571, radiusKm: 1.0, name: '深圳龙华科技园' },
    'E003': { lat: 22.9347, lng: 113.8921, radiusKm: 1.0, name: '东莞松山湖仓库' },
    'E004': { lat: 23.0810, lng: 113.3240, radiusKm: 1.0, name: '广州黄埔仓库' }
  },

  // ============================================================
  // 内部辅助方法
  // ============================================================

  /** 写日志 (联动 State.log 若存在) */
  _log(message, type = 'info') {
    if (typeof window !== 'undefined' && window.State && typeof window.State.log === 'function') {
      try { window.State.log('eco', message, type); } catch (e) { /* swallow */ }
    }
  },

  /** localStorage 安全读取 */
  _lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  /** localStorage 安全写入 */
  _lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this._log(`localStorage 写入失败: ${key} - ${e.message}`, 'error');
      return false;
    }
  },

  /** 当前 ISO 时间戳 */
  _now() { return new Date(); },

  /** 今日日期字符串 YYYY-MM-DD */
  _todayStr() { return this._now().toISOString().slice(0, 10); },

  /** 本月字符串 YYYY-MM */
  _monthStr() { return this._now().toISOString().slice(0, 7); },

  /** 生成账户存储 key */
  _storageKey(workerId) {
    const w = this.getWorkerById(workerId);
    if (!w) return this.STORAGE_PREFIX + 'unknown_' + workerId;
    return `${this.STORAGE_PREFIX}${w.entId}_${w.workerId}`;
  },

  /** Haversine 距离 (km) */
  _haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  /** 判断 GPS 是否在企业围栏内 */
  _isInFence(entId, gps) {
    if (!gps || typeof gps.lat !== 'number' || typeof gps.lng !== 'number') return true; // 缺省放行
    const fence = this.GEO_FENCES[entId];
    if (!fence) return true;
    const dist = this._haversineKm(gps.lat, gps.lng, fence.lat, fence.lng);
    return dist <= fence.radiusKm;
  },

  // ============================================================
  // 工人/企业查询
  // ============================================================

  /** 按工号查工人 */
  getWorkerById(workerId) {
    return this.WORKER_ROSTER.find(w => w.workerId === workerId) || null;
  },

  /** 按企业 ID 拿工人列表 */
  getWorkersByEnterprise(entId) {
    return this.WORKER_ROSTER.filter(w => w.entId === entId);
  },

  /** 获取当前企业 ID (优先 State.currentEnterpriseId) */
  _currentEntId() {
    if (typeof window !== 'undefined' && window.State && window.State.currentEnterpriseId) {
      return window.State.currentEnterpriseId;
    }
    return 'E001';
  },

  /** 获取企业名 (优先读 State.enterprises, 兜底 WORKER_ROSTER.entName) */
  _entName(entId) {
    if (typeof window !== 'undefined' && window.State && Array.isArray(window.State.enterprises)) {
      const ent = window.State.enterprises.find(e => e.id === entId);
      if (ent && ent.name) return ent.name;
    }
    const w = this.WORKER_ROSTER.find(x => x.entId === entId);
    return w ? w.entName : entId;
  },

  // ============================================================
  // PTS.1 / PTS.2 行为挖矿 - 积分账户
  // ============================================================

  /** 创建/初始化工人积分账户 */
  _newAccount(workerId) {
    const w = this.getWorkerById(workerId);
    if (!w) return null;
    const now = this._now().toISOString();
    return {
      workerId: w.workerId,
      workerName: w.name,
      role: w.role,
      entId: w.entId,
      entName: w.entName,
      // 三种积分余额
      balances: { credit: 0, carbon: 0, easyTrust: 0 },
      // 累计发放 (用于排行/统计)
      totalEarned: { credit: 0, carbon: 0, easyTrust: 0 },
      // 累计兑换 (积分)
      totalRedeemed: 0,
      // 连续确权状态
      streak: {
        consecutiveDays: 0,
        lastConfirmDate: null,
        streak7dClaimedDates: []   // 已发放 7 天奖励的日期, 防止同一天重复发放
      },
      // 最近 50 次行为 (用于防刷分检测)
      recentActions: [],
      // 设备指纹历史 (代签检测)
      knownDeviceFps: [w.deviceFp],
      // 月度发放记录 { 'YYYY-MM': { credit, carbon, easyTrust } }
      monthlyEarned: {},
      // 月度兑换记录 { 'YYYY-MM': points }
      monthlyRedeemed: {},
      createdAt: now,
      updatedAt: now
    };
  },

  /** 加载账户 (不存在则初始化) */
  _loadAccount(workerId) {
    const w = this.getWorkerById(workerId);
    if (!w) return null;
    const key = this._storageKey(workerId);
    let acc = this._lsGet(key);
    if (!acc) {
      acc = this._newAccount(workerId);
      this._lsSet(key, acc);
    }
    return acc;
  },

  /** 保存账户 */
  _saveAccount(acc) {
    if (!acc || !acc.workerId) return false;
    acc.updatedAt = this._now().toISOString();
    return this._lsSet(this._storageKey(acc.workerId), acc);
  },

  /**
   * PTS.1 行为挖矿发放积分 (核心 API)
   * @param {string} workerId - 工号
   * @param {Object} action - 行为对象
   *   action.type:        'scan_confirm' | 'exception_report' | 'streak_7d'
   *   action.materialId:  物料/单据号 (重复扫码检测)
   *   action.node:        责任节点 (N01-N12)
   *   action.gps:         { lat, lng } (GPS 围栏检测)
   *   action.deviceFp:    设备指纹 (代签检测)
   *   action.note:        备注
   * @returns {Promise<Object>} 发放结果
   */
  async awardPoints(workerId, action) {
    const w = this.getWorkerById(workerId);
    if (!w) {
      return { ok: false, reason: 'worker_not_found', message: `工号不存在: ${workerId}` };
    }
    const type = action && action.type;
    const rule = this.POINT_RULES[type];
    if (!rule) {
      return { ok: false, reason: 'unknown_action', message: `未知行为类型: ${type}` };
    }

    // 防刷分检测
    const fraud = this.detectFraud({ ...action, workerId });
    if (!fraud.passed && fraud.penalty === 'zero') {
      // 代签清零并预警
      const acc0 = this._loadAccount(workerId);
      if (acc0) {
        acc0.balances = { credit: 0, carbon: 0, easyTrust: 0 };
        acc0.recentActions.unshift({
          ts: this._now().toISOString(),
          type, action: 'cleared', reason: fraud.reason,
          materialId: action.materialId || null
        });
        acc0.recentActions = acc0.recentActions.slice(0, 50);
        this._saveAccount(acc0);
      }
      this._log(`[防刷分] 代签清零预警: ${w.name} (${workerId}) - ${fraud.reason}`, 'warn');
      return {
        ok: false, reason: fraud.reason, penalty: 'zero',
        message: `设备指纹不一致, 积分清零并预警: ${fraud.reason}`
      };
    }

    // 重复扫码不重发 (PTS.5)
    if (fraud.penalty === 'skip') {
      this._log(`[防刷分] 重复扫码不重发: ${w.name} (${workerId}) - ${fraud.reason}`);
      return {
        ok: false, reason: fraud.reason, penalty: 'skip',
        message: `重复扫码不重发: ${fraud.reason}`
      };
    }

    // GPS 围栏外减半 (PTS.5)
    const factor = fraud.penalty === 'half' ? 0.5 : 1.0;

    // 加载账户
    const acc = this._loadAccount(workerId);
    if (!acc) {
      return { ok: false, reason: 'account_init_failed', message: '账户初始化失败' };
    }

    // 计算实际发放
    const credit = Math.round(rule.credit * factor);
    const carbon = Math.round(rule.carbon * factor);
    const easyTrust = Math.round(rule.easyTrust * factor);
    const month = this._monthStr();

    // 累加余额
    acc.balances.credit += credit;
    acc.balances.carbon += carbon;
    acc.balances.easyTrust += easyTrust;

    // 累计发放
    acc.totalEarned.credit += credit;
    acc.totalEarned.carbon += carbon;
    acc.totalEarned.easyTrust += easyTrust;

    // 月度发放
    if (!acc.monthlyEarned[month]) {
      acc.monthlyEarned[month] = { credit: 0, carbon: 0, easyTrust: 0 };
    }
    acc.monthlyEarned[month].credit += credit;
    acc.monthlyEarned[month].carbon += carbon;
    acc.monthlyEarned[month].easyTrust += easyTrust;

    // 更新连续确权状态 (仅 scan_confirm 触发)
    if (type === 'scan_confirm') {
      this._updateStreak(acc);
    }

    // 记录设备指纹 (若是新设备)
    if (action.deviceFp && !acc.knownDeviceFps.includes(action.deviceFp)) {
      // 这里仅追加, 真正的"代签"判定已在 detectFraud 完成
      acc.knownDeviceFps.push(action.deviceFp);
    }

    // 行为日志 (用于防刷分检测的最近窗口)
    acc.recentActions.unshift({
      ts: this._now().toISOString(),
      type,
      materialId: action.materialId || null,
      node: action.node || null,
      gps: action.gps ? { lat: action.gps.lat, lng: action.gps.lng, inFence: !fraud.outOfFence } : null,
      deviceFp: action.deviceFp || null,
      awarded: { credit, carbon, easyTrust },
      factor,
      note: action.note || null
    });
    acc.recentActions = acc.recentActions.slice(0, 50);

    this._saveAccount(acc);

    // 写入月度消耗统计 (发放也算"消耗"统计的活跃度)
    this._bumpMonthlyConsumption(acc.entId, month, 'earned', credit + carbon + easyTrust);

    this._log(`[行为挖矿] ${w.name}(${workerId}) ${rule.label} → 信用+${credit}/碳+${carbon}/信易+${easyTrust}${factor < 1 ? ' (GPS围栏外减半)' : ''}`);

    return {
      ok: true,
      workerId,
      workerName: w.name,
      action: type,
      awarded: { credit, carbon, easyTrust },
      factor,
      fraudNote: fraud.penalty === 'half' ? 'GPS围栏外, 积分减半' : null,
      balances: { ...acc.balances },
      streak: { ...acc.streak }
    };
  },

  /** 更新连续确权天数 (内部) */
  _updateStreak(acc) {
    const today = this._todayStr();
    const last = acc.streak.lastConfirmDate;
    if (last === today) {
      // 当天已确权过, 不重置但不递增
      return;
    }
    // 判断昨天是否确权过
    const yesterday = this._dateMinusDays(today, 1);
    if (last === yesterday) {
      acc.streak.consecutiveDays += 1;
    } else {
      acc.streak.consecutiveDays = 1; // 从今天重新计数
    }
    acc.streak.lastConfirmDate = today;
  },

  /** 日期减 N 天, 返回 YYYY-MM-DD */
  _dateMinusDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  },

  /**
   * PTS.2 触发连续 7 天奖励 (内部由 checkAndAwardStreakBonus 调用)
   * 连续 7 天准时确权, 额外 +20 奖励分 (spec.md L2291)
   * @param {string} workerId
   * @returns {Promise<Object>}
   */
  async awardStreakBonus(workerId) {
    const acc = this._loadAccount(workerId);
    if (!acc) return { ok: false, reason: 'account_not_found' };

    if (acc.streak.consecutiveDays < this.STREAK_THRESHOLD_DAYS) {
      return {
        ok: false, reason: 'streak_not_met',
        message: `连续确权天数不足: ${acc.streak.consecutiveDays}/${this.STREAK_THRESHOLD_DAYS}`,
        currentStreak: acc.streak.consecutiveDays
      };
    }
    const today = this._todayStr();
    if (acc.streak.streak7dClaimedDates.includes(today)) {
      return {
        ok: false, reason: 'already_claimed_today',
        message: '今日已领取连续 7 天奖励',
        currentStreak: acc.streak.consecutiveDays
      };
    }

    // 发放 +20 信用分
    const bonus = this.POINT_RULES.streak_7d;
    acc.balances.credit += bonus.credit;
    acc.totalEarned.credit += bonus.credit;
    const month = this._monthStr();
    if (!acc.monthlyEarned[month]) acc.monthlyEarned[month] = { credit: 0, carbon: 0, easyTrust: 0 };
    acc.monthlyEarned[month].credit += bonus.credit;
    acc.streak.streak7dClaimedDates.push(today);

    // 记录行为
    acc.recentActions.unshift({
      ts: this._now().toISOString(),
      type: 'streak_7d',
      awarded: { ...bonus },
      note: `连续 ${acc.streak.consecutiveDays} 天准时确权奖励`
    });
    acc.recentActions = acc.recentActions.slice(0, 50);

    this._saveAccount(acc);
    this._bumpMonthlyConsumption(acc.entId, month, 'earned', bonus.credit);

    this._log(`[连续奖励] ${acc.workerName}(${workerId}) 连续${acc.streak.consecutiveDays}天 +${bonus.credit}信用分`);
    return {
      ok: true,
      workerId,
      workerName: acc.workerName,
      awarded: { ...bonus },
      currentStreak: acc.streak.consecutiveDays,
      balances: { ...acc.balances }
    };
  },

  /**
   * PTS.1+PTS.2 查询积分账户 (核心 API)
   * @param {string} workerId
   * @returns {Object|null} 账户信息 (含三种余额)
   */
  getAccount(workerId) {
    const acc = this._loadAccount(workerId);
    if (!acc) return null;
    // 计算总积分 (三种余额合计, 用于兑换)
    const total = acc.balances.credit + acc.balances.carbon + acc.balances.easyTrust;
    return {
      workerId: acc.workerId,
      workerName: acc.workerName,
      role: acc.role,
      entId: acc.entId,
      entName: acc.entName,
      balances: { ...acc.balances },
      totalPoints: total,
      totalEarned: { ...acc.totalEarned },
      totalRedeemed: acc.totalRedeemed,
      streak: {
        consecutiveDays: acc.streak.consecutiveDays,
        lastConfirmDate: acc.streak.lastConfirmDate,
        streak7dEligible: acc.streak.consecutiveDays >= this.STREAK_THRESHOLD_DAYS,
        streak7dClaimedToday: acc.streak.streak7dClaimedDates.includes(this._todayStr())
      },
      recentActions: acc.recentActions.slice(0, 10),
      updatedAt: acc.updatedAt
    };
  },

  // ============================================================
  // PTS.5 防刷分检测
  // ============================================================

  /**
   * 防刷分检测 (spec.md L2301)
   *   - 同一物料短时间内重复扫码不重发  → penalty='skip'
   *   - GPS 不在围栏内确权积分减半      → penalty='half'
   *   - 设备指纹不一致积分清零并预警    → penalty='zero'
   * @param {Object} action - { workerId, type, materialId, gps, deviceFp }
   * @returns {Object} { passed, penalty, reason, outOfFence }
   */
  detectFraud(action) {
    if (!action) return { passed: true, penalty: 'none', reason: null, outOfFence: false };

    const workerId = action.workerId;
    const w = workerId ? this.getWorkerById(workerId) : null;
    const acc = w ? this._loadAccount(workerId) : null;

    // 1. 代签检测 (设备指纹不一致) — 最高优先级, 直接清零
    if (action.deviceFp && w && w.deviceFp && action.deviceFp !== w.deviceFp) {
      // 如果该指纹不在已知设备列表, 视为代签
      if (acc && !acc.knownDeviceFps.includes(action.deviceFp)) {
        this._logFraud({ workerId, type: action.type, reason: 'device_fingerprint_mismatch', detail: `期望=${w.deviceFp}, 实际=${action.deviceFp}` });
        return {
          passed: false, penalty: 'zero',
          reason: '设备指纹不一致, 疑似代签', outOfFence: false
        };
      }
    }

    // 2. 重复扫码检测 (5 分钟内同物料)
    if (action.materialId && acc && Array.isArray(acc.recentActions) && acc.recentActions.length > 0) {
      const now = Date.now();
      const dup = acc.recentActions.find(a =>
        a.type === 'scan_confirm' &&
        a.materialId === action.materialId &&
        a.ts &&
        (now - new Date(a.ts).getTime()) < this.REPEAT_SCAN_WINDOW_MS
      );
      if (dup) {
        return {
          passed: false, penalty: 'skip',
          reason: `5分钟内重复扫码: 物料 ${action.materialId}`,
          outOfFence: false
        };
      }
    }

    // 3. GPS 围栏外检测
    let outOfFence = false;
    if (action.gps && w) {
      outOfFence = !this._isInFence(w.entId, action.gps);
      if (outOfFence) {
        this._logFraud({ workerId, type: action.type, reason: 'gps_out_of_fence', detail: `lat=${action.gps.lat},lng=${action.gps.lng}` });
        return {
          passed: true, penalty: 'half',
          reason: 'GPS 不在围栏内, 积分减半', outOfFence: true
        };
      }
    }

    return { passed: true, penalty: 'none', reason: null, outOfFence: false };
  },

  /** 防刷分日志写入 */
  _logFraud(entry) {
    const log = this._lsGet(this.FRAUD_LOG_KEY) || [];
    log.unshift({ ...entry, ts: this._now().toISOString() });
    this._lsSet(this.FRAUD_LOG_KEY, log.slice(0, 200));
  },

  /** 读取防刷分日志 (UI 用) */
  getFraudLog(limit = 20) {
    const log = this._lsGet(this.FRAUD_LOG_KEY) || [];
    return log.slice(0, limit);
  },

  // ============================================================
  // PTS.3 / PTS.6 商品商城 + 兑换核销
  // ============================================================

  /** 获取商品库 (带实时库存) */
  getShopItems() {
    const stockMap = this._lsGet(this.SHOP_STOCK_KEY) || {};
    return this.SHOP_ITEMS.map(it => ({
      ...it,
      stock: (stockMap[it.id] !== undefined) ? stockMap[it.id] : it.stock
    }));
  },

  /** 扣减商品库存 (内部) */
  _decrStock(itemId, qty = 1) {
    const stockMap = this._lsGet(this.SHOP_STOCK_KEY) || {};
    const item = this.SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return false;
    if (stockMap[itemId] === undefined) stockMap[itemId] = item.stock;
    if (stockMap[itemId] < qty) return false;
    stockMap[itemId] -= qty;
    this._lsSet(this.SHOP_STOCK_KEY, stockMap);
    return true;
  },

  /** 还原商品库存 (内部, 兑换失败回滚) */
  _restoreStock(itemId, qty = 1) {
    const stockMap = this._lsGet(this.SHOP_STOCK_KEY) || {};
    if (stockMap[itemId] !== undefined) {
      stockMap[itemId] += qty;
      this._lsSet(this.SHOP_STOCK_KEY, stockMap);
    }
  },

  /**
   * PTS.6 兑换商品 (核心 API)
   * 扣积分 → 生成兑换订单 → 商品由企业行政/财务顾问公司统一采购配送 (spec.md L2307)
   * @param {string} workerId
   * @param {string} itemId
   * @returns {Promise<Object>}
   */
  async redeem(workerId, itemId) {
    const w = this.getWorkerById(workerId);
    if (!w) return { ok: false, reason: 'worker_not_found' };
    const item = this.SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'item_not_found' };

    // 加载账户, 检查余额
    const acc = this._loadAccount(workerId);
    if (!acc) return { ok: false, reason: 'account_not_found' };

    const total = acc.balances.credit + acc.balances.carbon + acc.balances.easyTrust;
    if (total < item.creditCost) {
      return {
        ok: false, reason: 'insufficient_points',
        message: `积分不足: 当前 ${total} / 需要 ${item.creditCost}`,
        current: total, need: item.creditCost
      };
    }

    // 检查库存
    const stockMap = this._lsGet(this.SHOP_STOCK_KEY) || {};
    const curStock = (stockMap[itemId] !== undefined) ? stockMap[itemId] : item.stock;
    if (curStock <= 0) {
      return { ok: false, reason: 'out_of_stock', message: `${item.name} 库存不足` };
    }

    // 扣减库存
    if (!this._decrStock(itemId, 1)) {
      return { ok: false, reason: 'stock_decr_failed' };
    }

    // 扣减积分 (顺序: 信用分 → 碳积分 → 信易分)
    let need = item.creditCost;
    const deduct = { credit: 0, carbon: 0, easyTrust: 0 };
    const order = ['credit', 'carbon', 'easyTrust'];
    for (const k of order) {
      if (need <= 0) break;
      const take = Math.min(acc.balances[k], need);
      acc.balances[k] -= take;
      deduct[k] = take;
      need -= take;
    }

    acc.totalRedeemed += item.creditCost;
    const month = this._monthStr();
    if (!acc.monthlyRedeemed[month]) acc.monthlyRedeemed[month] = 0;
    acc.monthlyRedeemed[month] += item.creditCost;

    // 生成兑换订单 (spec.md L2307: 生成兑换订单, 商品由企业行政/财务顾问公司统一采购配送)
    const orderRecord = {
      orderId: 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      workerId: acc.workerId,
      workerName: acc.workerName,
      entId: acc.entId,
      entName: acc.entName,
      itemId: item.id,
      itemName: item.name,
      itemIcon: item.icon,
      creditCost: item.creditCost,
      currencyCost: item.currencyCost,    // 企业采购成本 (C5)
      category: item.category,
      deduct,
      status: 'pending',                  // pending → procuring(采购中) → shipping(配送中) → delivered
      createdAt: this._now().toISOString(),
      // 采购配送闭环 (spec.md L2307: 企业行政/财务顾问公司统一采购配送)
      fulfillment: {
        channel: '财务顾问公司团购',
        estDeliveryDays: 3,
        procurementStatus: 'pending',     // 财务顾问公司待采购
        logisticsPartner: '顺达物流'
      }
    };

    // 持久化订单
    const orders = this._lsGet(this.ORDERS_STORAGE_KEY) || [];
    orders.unshift(orderRecord);
    this._lsSet(this.ORDERS_STORAGE_KEY, orders.slice(0, 1000));

    // 行为日志
    acc.recentActions.unshift({
      ts: this._now().toISOString(),
      type: 'redeem',
      itemId: item.id,
      itemName: item.name,
      deduct,
      orderId: orderRecord.orderId
    });
    acc.recentActions = acc.recentActions.slice(0, 50);
    this._saveAccount(acc);

    // 月度消耗统计
    this._bumpMonthlyConsumption(acc.entId, month, 'redeemed', item.creditCost);
    this._bumpMonthlyConsumption(acc.entId, month, 'currencyCost', item.currencyCost);
    this._bumpMonthlyConsumption(acc.entId, month, 'orders', 1);

    this._log(`[兑换] ${acc.workerName}(${workerId}) 兑换 ${item.name}, 扣 ${item.creditCost} 积分 → 订单 ${orderRecord.orderId}`);
    return {
      ok: true,
      orderId: orderRecord.orderId,
      workerId,
      workerName: acc.workerName,
      item: { id: item.id, name: item.name, icon: item.icon, creditCost: item.creditCost },
      deduct,
      balances: { ...acc.balances },
      order: orderRecord
    };
  },

  /**
   * 推进订单状态 (采购配送闭环, spec.md L2307)
   * @param {string} orderId
   * @param {string} nextStatus - 'procuring' | 'shipping' | 'delivered'
   */
  async advanceOrder(orderId, nextStatus) {
    const orders = this._lsGet(this.ORDERS_STORAGE_KEY) || [];
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx < 0) return { ok: false, reason: 'order_not_found' };
    const flow = ['pending', 'procuring', 'shipping', 'delivered'];
    const cur = flow.indexOf(orders[idx].status);
    const nxt = flow.indexOf(nextStatus);
    if (nxt < 0 || nxt <= cur) {
      return { ok: false, reason: 'invalid_status_transition' };
    }
    orders[idx].status = nextStatus;
    orders[idx].updatedAt = this._now().toISOString();
    if (orders[idx].fulfillment) {
      orders[idx].fulfillment.procurementStatus =
        nextStatus === 'procuring' ? '采购中' :
        nextStatus === 'shipping' ? '已发货' :
        nextStatus === 'delivered' ? '已送达' : orders[idx].fulfillment.procurementStatus;
    }
    this._lsSet(this.ORDERS_STORAGE_KEY, orders);
    this._log(`[兑换订单] ${orderId} 状态推进: ${nextStatus}`);
    return { ok: true, orderId, status: nextStatus, order: orders[idx] };
  },

  /**
   * 查询工人兑换订单 (核心 API)
   * @param {string} workerId
   * @returns {Array} 订单列表
   */
  getRedeemOrders(workerId) {
    const orders = this._lsGet(this.ORDERS_STORAGE_KEY) || [];
    return orders.filter(o => o.workerId === workerId);
  },

  /** 查询企业全部订单 (UI 用) */
  getOrdersByEnterprise(entId) {
    const orders = this._lsGet(this.ORDERS_STORAGE_KEY) || [];
    return orders.filter(o => o.entId === entId);
  },

  // ============================================================
  // PTS.4 月度排行榜 + Top10 奖励
  // ============================================================

  /**
   * 月度 Top10 排行榜 (核心 API)
   * spec.md L2297: 月度确权积分 Top10 员工额外奖励 (如现金红包), 激发良性竞争
   * @param {string} entId - 企业 ID (空则取当前企业)
   * @returns {Object} { month, enterprise, top10, totalParticipants }
   */
  getRanking(entId) {
    const eid = entId || this._currentEntId();
    const month = this._monthStr();
    const workers = this.getWorkersByEnterprise(eid);
    const rows = workers.map(w => {
      const acc = this._lsGet(this._storageKey(w.workerId));
      const monthEarned = (acc && acc.monthlyEarned && acc.monthlyEarned[month]) || { credit: 0, carbon: 0, easyTrust: 0 };
      const monthTotal = monthEarned.credit + monthEarned.carbon + monthEarned.easyTrust;
      return {
        workerId: w.workerId,
        workerName: w.name,
        role: w.role,
        entId: eid,
        monthEarned,
        monthTotal,
        streak: acc ? acc.streak.consecutiveDays : 0,
        // Top10 额外奖励金额 (spec.md L2297: 现金红包)
        // 第1名 ¥100, 第2-3名 ¥50, 第4-10名 ¥20, 其余 0
        bonus: 0
      };
    });
    rows.sort((a, b) => b.monthTotal - a.monthTotal);
    rows.forEach((r, i) => {
      if (i === 0) r.bonus = 100;
      else if (i <= 2) r.bonus = 50;
      else if (i <= 9) r.bonus = 20;
      r.rank = i + 1;
      r.inTop10 = i < 10;
    });
    return {
      month,
      entId: eid,
      entName: this._entName(eid),
      top10: rows.slice(0, 10),
      all: rows,
      totalParticipants: rows.length,
      totalMonthlyPoints: rows.reduce((s, r) => s + r.monthTotal, 0),
      totalBonusPool: rows.reduce((s, r) => s + r.bonus, 0)
    };
  },

  // ============================================================
  // PTS.7 月度积分消耗统计 → 老板责任链健康度指标
  // ============================================================

  /**
   * 月度积分消耗统计 (核心 API)
   * spec.md L2309: 高消耗=员工积极配合=责任链健康
   * spec.md L2311: 单员工月均成本控制在 30-50 元
   * @param {string} entId
   * @returns {Object}
   */
  getMonthlyConsumption(entId) {
    const eid = entId || this._currentEntId();
    const month = this._monthStr();
    const all = this._lsGet(this.CONSUMPTION_STORAGE_KEY) || {};
    const entMonthly = (all[eid] && all[eid][month]) || {
      earned: 0, redeemed: 0, currencyCost: 0, orders: 0
    };

    const workers = this.getWorkersByEnterprise(eid);
    const activeWorkerIds = new Set();
    // 统计本月有确权行为的工人数
    workers.forEach(w => {
      const acc = this._lsGet(this._storageKey(w.workerId));
      if (acc && acc.monthlyEarned && acc.monthlyEarned[month] &&
          (acc.monthlyEarned[month].credit + acc.monthlyEarned[month].carbon + acc.monthlyEarned[month].easyTrust) > 0) {
        activeWorkerIds.add(w.workerId);
      }
    });

    const totalWorkers = workers.length;
    const activeWorkers = activeWorkerIds.size;
    // 配合度计算 (spec.md L2283: 10% → 90%)
    // 公式: 基线 10% + (活跃工人占比 × 80%)  - 即全部活跃则达 90%
    const participationRate = totalWorkers > 0 ? activeWorkers / totalWorkers : 0;
    const cooperationRate = Math.min(
      this.COOPERATION_TARGET,
      this.COOPERATION_BASELINE + participationRate * (this.COOPERATION_TARGET - this.COOPERATION_BASELINE)
    );

    // 单员工月均成本 (spec.md L2311: 30-50 元)
    const perWorkerCost = activeWorkers > 0 ? entMonthly.currencyCost / activeWorkers : 0;
    const costInTargetRange = perWorkerCost >= this.MONTHLY_COST_MIN && perWorkerCost <= this.MONTHLY_COST_MAX;

    // 健康度评分 (0-100)
    // 维度: 配合度 50% + 兑换活跃度 30% + 成本控制 20%
    const redeemActivity = entMonthly.redeemed > 0
      ? Math.min(100, entMonthly.redeemed / 10)
      : 0;
    const costScore = perWorkerCost === 0 ? 50
      : costInTargetRange ? 100
      : perWorkerCost < this.MONTHLY_COST_MIN ? Math.round(perWorkerCost / this.MONTHLY_COST_MIN * 80)
      : Math.max(0, 100 - Math.round((perWorkerCost - this.MONTHLY_COST_MAX) / this.MONTHLY_COST_MAX * 100));
    const healthScore = Math.round(
      cooperationRate * 100 * 0.5 +
      redeemActivity * 0.3 +
      costScore * 0.2
    );

    return {
      month,
      entId: eid,
      entName: this._entName(eid),
      stats: { ...entMonthly },
      totalWorkers,
      activeWorkers,
      participationRate,
      cooperationRate,                                    // 物流端配合度 (10% → 90%)
      perWorkerCost,                                      // 单员工月均成本 (元)
      costInTargetRange,                                  // 是否在 30-50 元目标区间
      costTargetRange: [this.MONTHLY_COST_MIN, this.MONTHLY_COST_MAX],
      healthScore,                                        // 责任链健康度评分 0-100
      healthGrade: this._healthGrade(healthScore),
      // 老板视角: 责任链健康度指标
      bossIndicator: {
        label: '责任链配合度健康度',
        cooperationPct: (cooperationRate * 100).toFixed(1) + '%',
        healthScore,
        healthGrade: this._healthGrade(healthScore),
        perWorkerCost: '¥' + perWorkerCost.toFixed(2),
        monthlyCostTotal: '¥' + (entMonthly.currencyCost || 0).toFixed(2),
        trend: cooperationRate >= this.COOPERATION_TARGET ? '达标' :
               cooperationRate >= 0.5 ? '上升中' : '需关注',
        advice: cooperationRate >= this.COOPERATION_TARGET
          ? '员工积极配合, 责任链健康'
          : cooperationRate >= 0.5
            ? '配合度提升中, 持续激励'
            : '配合度偏低, 建议加强积分激励'
      }
    };
  },

  /** 健康度等级 */
  _healthGrade(score) {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B+';
    if (score >= 60) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  },

  /** 累加月度消耗统计 (内部) */
  _bumpMonthlyConsumption(entId, month, field, delta) {
    const all = this._lsGet(this.CONSUMPTION_STORAGE_KEY) || {};
    if (!all[entId]) all[entId] = {};
    if (!all[entId][month]) {
      all[entId][month] = { earned: 0, redeemed: 0, currencyCost: 0, orders: 0 };
    }
    all[entId][month][field] = (all[entId][month][field] || 0) + delta;
    this._lsSet(this.CONSUMPTION_STORAGE_KEY, all);
  },

  // ============================================================
  // 演示/种子数据 (首次访问空数据库时填充)
  // ============================================================

  /**
   * 生成唯一 materialId (避免毫秒级重复触发防刷分)
   * 格式: 前缀-时间戳36进制-4位随机
   */
  _genMaterialId(prefix) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  },

  /**
   * 模拟一次扫码确权 (UI 演示按钮调用)
   * 自动生成 materialId / GPS / deviceFp
   */
  async demoScanConfirm(workerId, options = {}) {
    const w = this.getWorkerById(workerId);
    if (!w) return { ok: false, reason: 'worker_not_found' };
    const fence = this.GEO_FENCES[w.entId] || { lat: 22.54, lng: 113.91 };
    const action = {
      workerId,
      type: 'scan_confirm',
      materialId: options.materialId || this._genMaterialId('MAT'),
      node: options.node || 'N05',
      gps: options.gps || {
        lat: fence.lat + (Math.random() - 0.5) * 0.01,
        lng: fence.lng + (Math.random() - 0.5) * 0.01
      },
      deviceFp: options.deviceFp || w.deviceFp,
      note: options.note || '演示扫码确权'
    };
    const result = await this.awardPoints(workerId, action);
    // 若触达 7 天阈值, 自动发放奖励
    if (result.ok && result.streak && result.streak.consecutiveDays >= this.STREAK_THRESHOLD_DAYS) {
      const bonus = await this.awardStreakBonus(workerId);
      result.streakBonus = bonus;
    }
    return result;
  },

  /**
   * 模拟一次异常上报 (UI 演示按钮调用) - PTS.2 异常上报正向激励
   * spec.md L2299: 上报真实异常(数量不符/货物损坏)同样给积分
   */
  async demoExceptionReport(workerId, exceptionType = 'quantity_mismatch') {
    const w = this.getWorkerById(workerId);
    if (!w) return { ok: false, reason: 'worker_not_found' };
    const labels = {
      quantity_mismatch: '数量不符',
      goods_damaged: '货物损坏',
      delivery_delay: '送达延迟',
      quality_issue: '质量问题'
    };
    return await this.awardPoints(workerId, {
      workerId,
      type: 'exception_report',
      materialId: this._genMaterialId('EXC'),
      node: 'N09',
      gps: {
        lat: this.GEO_FENCES[w.entId].lat,
        lng: this.GEO_FENCES[w.entId].lng
      },
      deviceFp: w.deviceFp,
      note: `异常上报: ${labels[exceptionType] || exceptionType}`
    });
  },

  /**
   * 演示 GPS 围栏外扫码 (PTS.5 验收 - 减半)
   */
  async demoScanOutOfFence(workerId) {
    const w = this.getWorkerById(workerId);
    if (!w) return { ok: false, reason: 'worker_not_found' };
    // 远离围栏 5km
    const fence = this.GEO_FENCES[w.entId];
    return await this.awardPoints(workerId, {
      workerId,
      type: 'scan_confirm',
      materialId: this._genMaterialId('MAT-OOF'),
      node: 'N05',
      gps: { lat: fence.lat + 0.05, lng: fence.lng + 0.05 },
      deviceFp: w.deviceFp,
      note: '演示: GPS 围栏外扫码'
    });
  },

  /**
   * 演示代签场景 (PTS.5 验收 - 清零预警)
   */
  async demoScanWithFraudFingerprint(workerId) {
    const w = this.getWorkerById(workerId);
    if (!w) return { ok: false, reason: 'worker_not_found' };
    return await this.awardPoints(workerId, {
      workerId,
      type: 'scan_confirm',
      materialId: this._genMaterialId('MAT-FRAUD'),
      node: 'N05',
      gps: { lat: this.GEO_FENCES[w.entId].lat, lng: this.GEO_FENCES[w.entId].lng },
      deviceFp: 'fp-fraud-' + Math.random().toString(36).slice(2, 8),
      note: '演示: 代签 (设备指纹不一致)'
    });
  },

  /**
   * 种子演示数据 - 首次访问自动填充, 让排行榜/统计不为空
   * 幂等: 仅当 localStorage 完全为空时执行
   */
  async seedDemoDataIfEmpty() {
    // 检查是否已有任何账户数据 (用正确的 storage key, 不依赖硬编码 workerId)
    const hasAnyAccount = this.WORKER_ROSTER.some(w =>
      this._lsGet(this._storageKey(w.workerId)) !== null
    );
    const hasOrders = this._lsGet(this.ORDERS_STORAGE_KEY) !== null;
    if (hasAnyAccount || hasOrders) {
      return { ok: false, reason: 'already_seeded' };
    }

    // 为每家企业的工人发放 3-8 次随机扫码确权
    const today = this._todayStr();
    let totalAwarded = 0;
    for (const w of this.WORKER_ROSTER) {
      const times = 3 + Math.floor(Math.random() * 6); // 3-8 次
      for (let i = 0; i < times; i++) {
        // 模拟过去 N 天的扫码行为
        const dayOffset = Math.floor(i / 1.2); // 每天一次, 部分天两次
        const actionDate = this._dateMinusDays(today, dayOffset);
        const fence = this.GEO_FENCES[w.entId];
        const result = await this.awardPoints(w.workerId, {
          workerId: w.workerId,
          type: 'scan_confirm',
          materialId: 'SEED-' + w.workerId + '-' + i + '-' + Date.now().toString(36),
          node: 'N05',
          gps: {
            lat: fence.lat + (Math.random() - 0.5) * 0.005,
            lng: fence.lng + (Math.random() - 0.5) * 0.005
          },
          deviceFp: w.deviceFp,
          note: '种子数据'
        });
        if (result.ok) totalAwarded++;
      }
    }

    // 为部分工人触发兑换 (生成订单, 让月度消耗有数据)
    const redeemCandidates = this.WORKER_ROSTER.slice(0, 6);
    let totalOrders = 0;
    for (const w of redeemCandidates) {
      const acc = this._loadAccount(w.workerId);
      if (!acc) continue;
      const total = acc.balances.credit + acc.balances.carbon + acc.balances.easyTrust;
      // 选一个能买得起的商品
      const affordable = this.SHOP_ITEMS.filter(it => it.creditCost <= total);
      if (affordable.length > 0) {
        const item = affordable[Math.floor(Math.random() * affordable.length)];
        const r = await this.redeem(w.workerId, item.id);
        if (r.ok) totalOrders++;
      }
    }

    this._log(`[ECO-06] 种子数据填充完成: ${totalAwarded} 次确权 + ${totalOrders} 次兑换`);
    return { ok: true, totalAwarded, totalOrders };
  },

  /**
   * 重置所有 ECO-06 数据 (调试用, 谨慎调用)
   * 不依赖 localStorage 可枚举性 (某些 polyfill 不支持 Object.keys)
   */
  async resetAll() {
    let removed = 0;
    // 1. 清除每个工人的账户 (按花名册枚举, 不靠 Object.keys)
    this.WORKER_ROSTER.forEach(w => {
      const k = this._storageKey(w.workerId);
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        removed++;
      }
    });
    // 2. 清除全局存储键
    [
      this.ORDERS_STORAGE_KEY,
      this.CONSUMPTION_STORAGE_KEY,
      this.SHOP_STOCK_KEY,
      this.FRAUD_LOG_KEY
    ].forEach(k => {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        removed++;
      }
    });
    this._log('[ECO-06] 所有数据已重置');
    return { ok: true, removed };
  }
};

// 暴露到全局
window.EcoPts = EcoPts;
