/** 文件名：eco-bid.js 职责：ECO-05 反向竞拍融资大厅模拟器,企业发布标书后 N 家银行在线竞价 */
//
// 模块定位: MOD-16.9 反向竞拍融资大厅 (P2, R9 终极形态, 脑洞3)
//   企业改造完成后进入"融资大厅"发布融资标书(类招投标), 系统内 N 家合作银行
//   在线竞价, 利率低/额度高/放款快者胜出. 把"企业求银行"翻转为"银行抢优质资产",
//   FinTrust Hub 掌握绝对的定价权.
//
// 对齐 spec.md L3311-3345 (反向竞拍 + 竞价反作弊 2 个 Gherkin 场景) +
//       tasks.md L2902-2914 (BID.1-BID.6 子任务) +
//       checklist.md L1819-1827 (BID.1-BID.6 验收)
//
// ============================================================================
// 模拟器实现说明 (真实环境 vs 浏览器模拟)
// ============================================================================
// 真实环境 (银行间竞价网络 + 联盟链):
//   - 标书发布/银行出价/中标确认 全程写入 MOD-08 联盟链存证
//   - 出价经银行私钥签名, 链上可审计不可篡改
//   - 多头防控查征信中心/银团数据, 5 倍净资产阈值实时校验
//   - 串通报价检测用图谱聚类 + 利率分布异常分析
//   - 未中标出价匿名归档供 MOD-16.10 行业利率基准分析
//
// 浏览器端模拟 (本文件):
//   - 标书/出价/归档持久化到 localStorage (eco_bid_tenders/eco_bid_bids/eco_bid_archive)
//   - 银行陆续出价用 setTimeout 模拟 T+24h 在线竞价
//   - 上链存证用 window.crypto.subtle.digest('SHA-256') 链式哈希
//   - 串通报价检测: 利率异常一致 (容差 0.01%) + 集团关联图谱
//   - 多头防控: 累计授信 = 企业全量出价金额合计 vs 5 倍净资产代理值
//   - 匿名归档: 未中标出价抹除银行名称, 仅留利率/额度/期限供基准分析
//   - ECO-04 凭证防御性接入: EcoCred 可用时取真实凭证, 否则 mock-cred 兜底
// ============================================================================

'use strict';

// ============================================================================
// EcoBid 单例 (闭包模式, 与 EcoBurn/EcoRpa 风格一致)
// ============================================================================
const EcoBid = (() => {

  // ============================================================
  // 私有状态
  // ============================================================
  // _tenders —— 全部融资标书 (含匿名快照)
  //   结构: { id, enterpriseId, enterpriseName, amount, termMonths, rateFloor,
  //          rateFloorLabel, purpose, credentialRef, profileSummary,
  //          publishedAt, deadline, status, invitedBankIds, winnerBidId,
  //          chainEvidence: [{txId, block, hash, prevHash, action, ts}] }
  const _tenders = [];

  // _bids —— 全部银行出价
  //   结构: { id, tenderId, bankId, bankName, bankGroup, rate, amount,
  //          termMonths, timeToFundDays, conditions, submittedAt,
  //          status: 'pending'|'winner'|'archived'|'disqualified',
  //          isFraudulent, fraudReason, signedHash }
  const _bids = [];

  // _archive —— 未中标出价匿名归档 (供 MOD-16.10 行业基准分析)
  //   结构: { id, tenderId, rate, amount, termMonths, timeToFundDays,
  //          archivedAt, reason }
  const _archive = [];

  // _partnerBanks —— 平台已准入合作行白名单 (防外部恶意报价)
  //   初始化时复用 State.BANKS / mock-data BANKS, 否则用内置 mock 池
  const _partnerBanks = [];

  // _invitedBanks[tenderId] —— 该标书已邀请并即将出价的合作行 (排队中)
  const _invitedBanks = Object.create(null);

  // _chainHeadHash —— 链上最新 hash (链式存证, 创世块固定)
  let _chainHeadHash = '0'.repeat(64);

  // _blockNumber —— 模拟区块高度 (单调递增)
  let _blockNumber = 100000;

  // _subscribers —— 出价/状态变化订阅回调 (UI 刷新驱动)
  const _subscribers = new Set();

  // localStorage 键
  const LS_TENDERS = 'eco_bid_tenders';
  const LS_BIDS = 'eco_bid_bids';
  const LS_ARCHIVE = 'eco_bid_archive';
  const LS_CHAIN_HEAD = 'eco_bid_chain_head';
  const LS_BLOCK = 'eco_bid_block';

  // 综合成本排序权重 (spec L3328: 利率 60% + 额度 20% + 时效 20%)
  const W_RATE = 0.6;
  const W_AMOUNT = 0.2;
  const W_SPEED = 0.2;

  // T+24h 竞价截止 (毫秒). 模拟器加速: 实际截止按真实 24h 计算, 出价在窗口内陆续到达
  const BID_WINDOW_MS = 24 * 60 * 60 * 1000;

  // 多头防控: 累计授信不超过净资产 5 倍 (spec L3341)
  const MULTI_HEAD_MULTIPLE = 5;

  // 串通报价利率容差 (0.01% = 0.0001)
  const COLLUSION_RATE_TOLERANCE = 0.0001;

  // 净资产代理推导系数 (无后端征信时, 用财务指标代理净资产)
  // netAssets ≈ max(accountBalance, monthlyRevenue * 6) + pendingAR * 0.5
  // 这是浏览器端模拟的近似值, 真实环境来自征信/财报数据

  // ============================================================
  // 工具: SHA-256 (用 crypto.subtle 模拟链上哈希, 与 EcoBurn 口径一致)
  // ============================================================
  async function _sha256(text) {
    const str = String(text == null ? '' : text);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) { /* fall through */ }
    }
    // Fallback (node --check 环境 / 老 JS 引擎): 简易 64-bit hash
    let h1 = 0x12345678, h2 = 0x9abcdef0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = ((h1 << 5) - h1 + c) | 0;
      h2 = ((h2 << 7) ^ c) | 0;
    }
    return 'fallback_' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function _nowIso() { return new Date().toISOString(); }
  function _nowMs() { return Date.now(); }

  // 安全 localStorage 访问 (Node 环境直接返回 null)
  function _lsGet(key) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; }
    catch (_) { return null; }
  }
  function _lsSet(key, val) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, val); }
    catch (_) { /* 私密模式 / 配额满 */ }
  }

  // ============================================================
  // 内置合作行白名单 (mock)
  // ----------------------------------------------------------
  // 真实环境: 银行准入需监管备案 + 平台风控审核.
  // 模拟器: 初始化时若 State.BANKS 可用则复用, 否则用下列 5 家 mock 池,
  //         每家含集团归属 (用于串通检测: 同集团多家利率一致视为高风险).
  // ============================================================
  const _MOCK_PARTNER_BANKS = [
    { id: 'BK001', name: '招商银行', shortName: '招行', icon: '🏦', group: 'CMB', riskAppetite: 'flexible',  baseRate: 4.45 },
    { id: 'BK002', name: '工商银行', shortName: '工行', icon: '🏛', group: 'ICBC', riskAppetite: 'conservative', baseRate: 4.15 },
    { id: 'BK003', name: '网商银行', shortName: '网商', icon: '🌐', group: 'MYBK', riskAppetite: 'aggressive', baseRate: 4.95 },
    { id: 'BK004', name: '建设银行', shortName: '建行', icon: '🏗', group: 'CCB',  riskAppetite: 'balanced', baseRate: 4.25 },
    { id: 'BK005', name: '交通银行', shortName: '交行', icon: '🚦', group: 'BCM',  riskAppetite: 'flexible', baseRate: 4.35 }
  ];

  function _initPartnerBanks() {
    _partnerBanks.length = 0;
    // 优先复用 State.BANKS (mock-data 全局)
    try {
      if (typeof State !== 'undefined' && Array.isArray(State.BANKS) && State.BANKS.length) {
        State.BANKS.forEach(b => {
          if (b && b.id) {
            _partnerBanks.push({
              id: b.id,
              name: b.name || ('银行' + b.id),
              shortName: b.shortName || (b.name || b.id).slice(0, 2),
              icon: b.icon || '🏦',
              group: b.group || b.id,
              riskAppetite: b.riskAppetite || 'balanced',
              baseRate: b.baseRateValue || b.baseRate || 4.5
            });
          }
        });
      }
    } catch (_) { /* State 不可用, 走 mock */ }
    // mock 兜底
    if (!_partnerBanks.length) {
      _MOCK_PARTNER_BANKS.forEach(b => _partnerBanks.push(Object.assign({}, b)));
    }
  }

  function _getBank(bankId) {
    return _partnerBanks.find(b => b.id === bankId) || null;
  }

  function _isPartnerBank(bankId) {
    return _partnerBanks.some(b => b.id === bankId);
  }

  // ============================================================
  // 私有: 企业净资产代理值 (浏览器端无征信, 用财务指标推导)
  // ----------------------------------------------------------
  // 真实: 净资产 = 所有者权益 = 资产总计 - 负债总计 (来自财报).
  // 模拟: 优先取 enterprise.netAssets / enterprise.assets.netAssets;
  //       否则用 financials 推导: max(accountBalance, monthlyRevenue*6) + pendingAR*0.5
  // ============================================================
  function _deriveNetAssets(ent) {
    if (!ent) return 0;
    try {
      if (typeof ent.netAssets === 'number' && ent.netAssets > 0) return ent.netAssets;
      if (ent.assets && typeof ent.assets.netAssets === 'number') return ent.assets.netAssets;
      const fin = ent.financials || {};
      const accountBalance = Number(fin.accountBalance) || 0;
      const monthlyRevenue = Number(fin.monthlyRevenue) || 0;
      const pendingAR = Number(fin.pendingAR) || 0;
      const derived = Math.max(accountBalance, monthlyRevenue * 6) + pendingAR * 0.5;
      // 兜底: 若财务字段全空, 给一个保守默认值避免除零
      return derived > 0 ? derived : 5000000;
    } catch (_) {
      return 5000000;
    }
  }

  function _getEnterprise(entId) {
    try {
      if (typeof State !== 'undefined' && State.enterprises) {
        return State.enterprises.find(e => e.id === entId) || null;
      }
    } catch (_) {}
    return null;
  }

  // ============================================================
  // 私有: 改造画像摘要 (匿名发布用, 仅展示指标不含企业名)
  // ----------------------------------------------------------
  // 优先复用 reform-engine 产物 (afterScorecard), 否则用 runtime 指标推导.
  // ============================================================
  function _buildProfileSummary(ent) {
    if (!ent) return null;
    const runtime = ent.runtime || {};
    const reform = ent.reform || {};
    const scorecard = reform.afterScorecard || reform.beforeScorecard || {};
    const dims = ['subject', 'finance', 'tax', 'business', 'assets', 'credit', 'policy', 'capital'];
    const eightDim = {};
    let dimSum = 0, dimCount = 0;
    dims.forEach(d => {
      const v = Number(scorecard[d]);
      if (!isNaN(v)) { eightDim[d] = v; dimSum += v; dimCount++; }
    });
    const avgScore = dimCount ? Math.round(dimSum / dimCount) : 0;
    const fiveStreams = runtime.fiveStreams || {};
    const fiveStreamKeys = ['contract', 'invoice', 'logistics', 'fund', 'iot'];
    let passCount = 0;
    fiveStreamKeys.forEach(k => { if (fiveStreams[k]) passCount++; });
    const fiveStreamPassRate = passCount / fiveStreamKeys.length;
    const chain = runtime.responsibilityChain || {};
    return {
      creditScore: runtime.creditScore || 0,
      creditGrade: (reform.afterLevel || runtime.creditGradeCap || '—'),
      eightDimScore: eightDim,
      avgScore,
      fiveStreamPassRate,
      responsibilityChainCompleteness: (chain.completeness || 0),
      waterLevel: runtime.waterLevel || 0,
      industryLabel: ent.industryLabel || '—',
      riskLabel: ent.riskLabel || '—'
    };
  }

  // ============================================================
  // 私有: ECO-04 凭证防御性接入 (企业持凭证发标)
  // ----------------------------------------------------------
  // spec L3316: "Given 企业改造完成, 持有 MOD-08b 信用凭证"
  // ECO-05 消费 ECO-04 联盟链凭证. 用防御性检测避免硬依赖.
  // ============================================================
  function _getCredentialRef(entId) {
    try {
      if (typeof EcoCred !== 'undefined' && EcoCred.getCredentials) {
        const creds = EcoCred.getCredentials(entId);
        if (creds && creds[0]) {
          return creds[0].id || creds[0].credentialId || ('cred-' + entId);
        }
      }
    } catch (_) { /* EcoCred 异常, 走 mock */ }
    return 'mock-cred-' + entId;
  }

  // ============================================================
  // 私有: 链上存证 (链式 SHA-256, 模拟 MOD-08 联盟链)
  // ============================================================
  async function _appendChain(tenderId, action, payload) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) return null;
    const block = ++_blockNumber;
    const ts = _nowIso();
    const prev = _chainHeadHash;
    const content = JSON.stringify({ action, payload, prev, block, ts, tenderId });
    const hash = await _sha256(content);
    const txId = '0x' + hash.slice(0, 40);
    const evidence = { txId, block, hash, prevHash: prev, action, ts, payload };
    tender.chainEvidence = tender.chainEvidence || [];
    tender.chainEvidence.push(evidence);
    _chainHeadHash = hash;
    _lsSet(LS_CHAIN_HEAD, _chainHeadHash);
    _lsSet(LS_BLOCK, String(_blockNumber));
    _persist();
    return evidence;
  }

  // ============================================================
  // 私有: 出价签名哈希 (模拟银行私钥签名上链)
  // ============================================================
  async function _signBid(bid) {
    return await _sha256(JSON.stringify({
      tenderId: bid.tenderId, bankId: bid.bankId, rate: bid.rate,
      amount: bid.amount, termMonths: bid.termMonths, submittedAt: bid.submittedAt
    }));
  }

  // ============================================================
  // 私有: 持久化
  // ============================================================
  function _persist() {
    _lsSet(LS_TENDERS, JSON.stringify(_tenders));
    _lsSet(LS_BIDS, JSON.stringify(_bids));
    _lsSet(LS_ARCHIVE, JSON.stringify(_archive));
  }

  function _restore() {
    try {
      const t = _lsGet(LS_TENDERS);
      if (t) { const arr = JSON.parse(t); if (Array.isArray(arr)) _tenders.length = 0, arr.forEach(x => _tenders.push(x)); }
      const b = _lsGet(LS_BIDS);
      if (b) { const arr = JSON.parse(b); if (Array.isArray(arr)) _bids.length = 0, arr.forEach(x => _bids.push(x)); }
      const a = _lsGet(LS_ARCHIVE);
      if (a) { const arr = JSON.parse(a); if (Array.isArray(arr)) _archive.length = 0, arr.forEach(x => _archive.push(x)); }
      const h = _lsGet(LS_CHAIN_HEAD);
      if (h) _chainHeadHash = h;
      const blk = _lsGet(LS_BLOCK);
      if (blk) _blockNumber = parseInt(blk, 10) || 100000;
    } catch (_) { /* 损坏数据忽略 */ }
  }

  // ============================================================
  // 私有: 通知订阅者 (UI 刷新)
  // ============================================================
  function _notify(payload) {
    _subscribers.forEach(fn => {
      try { fn(payload || { type: 'update', ts: _nowIso() }); } catch (_) {}
    });
  }

  function _genId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ============================================================
  // 私有: 模拟单家银行出价 (依据画像 + 风险偏好定价)
  // ----------------------------------------------------------
  // 利率 = baseRate + 风险溢价 + 竞争下浮, 不低于企业利率下限则更有竞争力.
  // 额度 = 标书金额 * (0.85~1.0) 视银行风险偏好. 时效 = 1~7 天视偏好.
  // ============================================================
  function _simulateBankBid(tender, bank) {
    const profile = tender.profileSummary || {};
    const creditScore = profile.creditScore || 700;
    // 信用分越高, 风险溢价越低
    const riskPremium = Math.max(0, (750 - creditScore)) / 1000; // 0~0.15
    // 竞争下浮: 银行间竞争压低利率 0.05~0.3
    const competitionDiscount = 0.05 + Math.random() * 0.25;
    let rate = bank.baseRate + riskPremium - competitionDiscount;
    // 风险偏好调整
    if (bank.riskAppetite === 'aggressive') rate -= 0.15;
    else if (bank.riskAppetite === 'conservative') rate += 0.1;
    rate = Math.round(rate * 100) / 100; // 保留 2 位
    // 额度: 标书金额的 85%~100%
    const amountRatio = bank.riskAppetite === 'aggressive' ? (0.95 + Math.random() * 0.05)
      : bank.riskAppetite === 'conservative' ? (0.85 + Math.random() * 0.1)
      : (0.9 + Math.random() * 0.1);
    const amount = Math.round(tender.amount * amountRatio / 10000) * 10000;
    // 时效: 1~7 天
    const timeToFundDays = bank.riskAppetite === 'aggressive' ? (1 + Math.floor(Math.random() * 2))
      : bank.riskAppetite === 'conservative' ? (4 + Math.floor(Math.random() * 4))
      : (2 + Math.floor(Math.random() * 3));
    // 附加条件
    const conditionsPool = ['无担保', '信用贷', '需补充流水', '建议关联担保', '利率随 LPR 浮动', '承诺不抽贷'];
    const conditions = conditionsPool[Math.floor(Math.random() * conditionsPool.length)];
    return { rate, amount, termMonths: tender.termMonths, timeToFundDays, conditions };
  }

  // ============================================================
  // 公共 API: publishTender(entId, params)
  // ----------------------------------------------------------
  // BID.1 融资标书发布 (金额/期限/利率下限/画像摘要/凭证引用/用途)
  // BID.2 匿名发布 (隐企业名, 仅画像指标)
  // ============================================================
  async function publishTender(entId, params) {
    if (!entId) throw new Error('publishTender: entId 必填');
    const p = params || {};
    const amount = Number(p.amount);
    const termMonths = Number(p.termMonths);
    const rateFloor = Number(p.rateFloor);
    if (!amount || amount <= 0) throw new Error('publishTender: 融资金额必须 > 0');
    if (!termMonths || termMonths <= 0) throw new Error('publishTender: 期限必须 > 0');
    if (rateFloor == null || isNaN(rateFloor) || rateFloor <= 0) throw new Error('publishTender: 利率下限必须 > 0');

    const ent = _getEnterprise(entId);
    if (!ent) throw new Error('publishTender: 企业不存在 ' + entId);

    // ECO-04 凭证防御性接入
    const credentialRef = _getCredentialRef(entId);
    const profileSummary = _buildProfileSummary(ent);

    const now = _nowMs();
    const tenderId = _genId('BID-T');
    const tender = {
      id: tenderId,
      enterpriseId: entId,
      enterpriseName: ent.name || entId, // 内部保留, 匿名发布时不展示
      amount,
      termMonths,
      rateFloor,
      rateFloorLabel: p.rateFloorLabel || ('LPR+' + (rateFloor - 3.85).toFixed(1) + '%'),
      purpose: p.purpose || '补充流动资金',
      credentialRef,
      profileSummary,
      publishedAt: _nowIso(),
      publishedMs: now,
      deadline: new Date(now + BID_WINDOW_MS).toISOString(),
      deadlineMs: now + BID_WINDOW_MS,
      status: 'open', // open | bidding | awarded | closed
      invitedBankIds: [],
      winnerBidId: null,
      chainEvidence: [],
      anonymous: true // 匿名发布: 隐企业名, 仅展示画像指标
    };

    _tenders.unshift(tender);
    await _appendChain(tenderId, 'publish_tender', {
      enterpriseId: entId, amount, termMonths, rateFloor,
      credentialRef, profileHash: await _sha256(JSON.stringify(profileSummary))
    });
    _persist();
    _notify({ type: 'tender_published', tenderId });
    return tender;
  }

  // ============================================================
  // 公共 API: getTenders()
  // ============================================================
  function getTenders() {
    // 返回浅拷贝 (避免外部直接修改内部状态)
    return _tenders.map(t => Object.assign({}, t, { chainEvidence: (t.chainEvidence || []).slice() }));
  }

  function getTender(tenderId) {
    const t = _tenders.find(x => x.id === tenderId);
    return t ? Object.assign({}, t) : null;
  }

  // ============================================================
  // 公共 API: inviteBanks(tenderId)
  // ----------------------------------------------------------
  // BID.2 合作行竞价邀请 (T+24h 内在线出价)
  // 邀请 3-5 家合作行, 异步模拟陆续出价 (setTimeout 排队)
  // ============================================================
  async function inviteBanks(tenderId, opts) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) throw new Error('inviteBanks: 标书不存在 ' + tenderId);
    const o = opts || {};
    // 默认邀请 3-5 家, 可指定 bankIds / count
    let bankIds = o.bankIds;
    if (!bankIds || !bankIds.length) {
      const count = o.count || (3 + Math.floor(Math.random() * 3)); // 3-5
      const shuffled = _partnerBanks.slice().sort(() => Math.random() - 0.5);
      bankIds = shuffled.slice(0, Math.min(count, _partnerBanks.length)).map(b => b.id);
    }
    // 校验全部为合作行 (防外部恶意报价 - BID.5)
    const invalid = bankIds.filter(id => !_isPartnerBank(id));
    if (invalid.length) {
      await _appendChain(tenderId, 'invite_blocked', { invalidBankIds: invalid, reason: '非平台准入合作行' });
      _notify({ type: 'invite_blocked', tenderId, invalid });
      throw new Error('inviteBanks: 以下银行非平台准入合作行, 已拦截: ' + invalid.join(', '));
    }
    tender.invitedBankIds = bankIds.slice();
    tender.status = 'bidding';
    await _appendChain(tenderId, 'invite_banks', { bankIds: bankIds.slice() });
    _persist();
    _notify({ type: 'banks_invited', tenderId, bankIds });

    // 自动模拟各银行陆续出价 (除非 opts.autoBid === false)
    if (o.autoBid !== false) {
      _scheduleBids(tenderId, bankIds);
    }
    return { tenderId, invitedBankIds: bankIds.slice() };
  }

  // ============================================================
  // 私有: 安排合作行陆续出价 (setTimeout 模拟在线竞价)
  // ============================================================
  function _scheduleBids(tenderId, bankIds) {
    if (_invitedBanks[tenderId]) { clearTimeout(_invitedBanks[tenderId]); }
    bankIds.forEach((bankId, idx) => {
      // 每家出价间隔 800~2500ms (模拟真实陆续出价)
      const delay = 600 + idx * (800 + Math.floor(Math.random() * 1700));
      setTimeout(() => {
        // 标书可能已截止/中标
        const tender = _tenders.find(t => t.id === tenderId);
        if (!tender || tender.status === 'awarded' || tender.status === 'closed') return;
        if (Date.now() > tender.deadlineMs) return;
        const bank = _getBank(bankId);
        if (!bank) return;
        // 避免重复出价
        const existed = _bids.find(b => b.tenderId === tenderId && b.bankId === bankId);
        if (existed) return;
        const simulated = _simulateBankBid(tender, bank);
        submitBid(tenderId, bankId, simulated).catch(() => {});
      }, delay);
    });
  }

  // ============================================================
  // 公共 API: submitBid(tenderId, bankId, bidData)
  // ----------------------------------------------------------
  // BID.3 银行出价 (利率/额度/期限/时效/附加条件) + T+24h 截止
  // BID.5 出价前校验: 合作行 + 多头防控
  // ============================================================
  async function submitBid(tenderId, bankId, bidData) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) throw new Error('submitBid: 标书不存在 ' + tenderId);
    // BID.3: T+24h 截止校验
    if (Date.now() > tender.deadlineMs) {
      tender.status = 'closed';
      await _appendChain(tenderId, 'bid_rejected', { bankId, reason: '超过 T+24h 截止时间' });
      _persist();
      throw new Error('submitBid: 已超过 T+24h 竞价截止时间');
    }
    // BID.5: 合作行校验 (防外部恶意报价)
    if (!_isPartnerBank(bankId)) {
      await _appendChain(tenderId, 'bid_rejected', { bankId, reason: '非平台准入合作行' });
      _persist();
      throw new Error('submitBid: ' + bankId + ' 非平台准入合作行, 出价已拦截');
    }
    const bank = _getBank(bankId);
    const d = bidData || {};
    const rate = Number(d.rate);
    const amount = Number(d.amount);
    const termMonths = Number(d.termMonths) || tender.termMonths;
    const timeToFundDays = Number(d.timeToFundDays);
    if (!rate || rate <= 0) throw new Error('submitBid: 利率必须 > 0');
    if (!amount || amount <= 0) throw new Error('submitBid: 额度必须 > 0');
    if (!timeToFundDays || timeToFundDays <= 0) throw new Error('submitBid: 放款时效必须 > 0');

    // BID.5: 多头防控 - 出价额度 + 企业已有授信 <= 5 倍净资产
    const multiHead = getMultiHeadRisk(tender.enterpriseId);
    const projectedTotal = multiHead.existingCredit + amount;
    if (projectedTotal > multiHead.netAssetsCap) {
      const bid = {
        id: _genId('BID-B'), tenderId, bankId, bankName: bank.name, bankGroup: bank.group,
        rate, amount, termMonths, timeToFundDays,
        conditions: d.conditions || '—', submittedAt: _nowIso(),
        status: 'disqualified', isFraudulent: false,
        fraudReason: '多头防控: 累计授信 ' + projectedTotal + ' 超 5 倍净资产上限 ' + multiHead.netAssetsCap
      };
      bid.signedHash = await _signBid(bid);
      _bids.push(bid);
      await _appendChain(tenderId, 'bid_disqualified', { bidId: bid.id, bankId, reason: bid.fraudReason });
      _persist();
      _notify({ type: 'bid_disqualified', tenderId, bidId: bid.id });
      return bid;
    }

    const bid = {
      id: _genId('BID-B'), tenderId, bankId, bankName: bank.name, bankGroup: bank.group,
      rate, amount, termMonths, timeToFundDays,
      conditions: d.conditions || '—', submittedAt: _nowIso(),
      status: 'pending', isFraudulent: false, fraudReason: null
    };
    bid.signedHash = await _signBid(bid);
    _bids.push(bid);
    await _appendChain(tenderId, 'submit_bid', {
      bidId: bid.id, bankId, rate, amount, termMonths, timeToFundDays, signedHash: bid.signedHash
    });
    _persist();
    _notify({ type: 'bid_submitted', tenderId, bidId: bid.id });
    return bid;
  }

  // ============================================================
  // 公共 API: rankBids(tenderId)
  // ----------------------------------------------------------
  // BID.4 综合成本排序 (利率 60% + 额度 20% + 时效 20%)
  // 利率低 / 额度高 / 时效快 → 综合得分高
  // ============================================================
  function rankBids(tenderId) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) return [];
    const valid = _bids.filter(b => b.tenderId === tenderId && b.status !== 'disqualified');
    if (!valid.length) return [];

    // 归一化所需极值
    const rates = valid.map(b => b.rate);
    const amounts = valid.map(b => b.amount);
    const days = valid.map(b => b.timeToFundDays);
    const minRate = Math.min.apply(null, rates), maxRate = Math.max.apply(null, rates);
    const maxAmount = Math.max.apply(null, amounts), minAmount = Math.min.apply(null, amounts);
    const minDays = Math.min.apply(null, days), maxDays = Math.max.apply(null, days);

    const scored = valid.map(b => {
      // 利率分: 越低越好 (maxRate → 0, minRate → 1)
      const rateScore = (maxRate === minRate) ? 1 : (maxRate - b.rate) / (maxRate - minRate);
      // 额度分: 越高越好, 且不超过标书金额的部分不再加分
      const amountScore = (maxAmount === minAmount) ? 1 : (b.amount - minAmount) / (maxAmount - minAmount);
      // 时效分: 越快越好 (maxDays → 0, minDays → 1)
      const speedScore = (maxDays === minDays) ? 1 : (maxDays - b.timeToFundDays) / (maxDays - minDays);
      const composite = rateScore * W_RATE + amountScore * W_AMOUNT + speedScore * W_SPEED;
      return Object.assign({}, b, {
        rateScore: Math.round(rateScore * 1000) / 1000,
        amountScore: Math.round(amountScore * 1000) / 1000,
        speedScore: Math.round(speedScore * 1000) / 1000,
        compositeScore: Math.round(composite * 1000) / 1000,
        rank: 0
      });
    });
    // 降序排序
    scored.sort((a, b) => b.compositeScore - a.compositeScore || a.rate - b.rate);
    scored.forEach((b, i) => { b.rank = i + 1; });
    return scored;
  }

  // ============================================================
  // 公共 API: selectWinner(tenderId, bidId)
  // ----------------------------------------------------------
  // spec L3329: 竞价截止后, 企业从 Top3 出价中选择中标银行
  // BID.6 中标触发上链, 未中标出价匿名归档
  // ============================================================
  async function selectWinner(tenderId, bidId) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) throw new Error('selectWinner: 标书不存在 ' + tenderId);
    const ranked = rankBids(tenderId);
    // 仅允许从 Top3 选择
    const top3 = ranked.slice(0, 3);
    const winner = top3.find(b => b.id === bidId);
    if (!winner) {
      // 允许在非 Top3 选择但需标记 (spec 严格要求 Top3, 这里抛错)
      const any = ranked.find(b => b.id === bidId);
      if (any) {
        await _appendChain(tenderId, 'winner_select_warning', { bidId, rank: any.rank, reason: '非 Top3 选择' });
        throw new Error('selectWinner: 仅可从 Top3 出价中选择中标 (当前出价排名 #' + any.rank + ')');
      }
      throw new Error('selectWinner: 出价 ' + bidId + ' 不存在或已失格');
    }
    tender.winnerBidId = bidId;
    tender.status = 'awarded';
    // 标记中标
    const winnerBid = _bids.find(b => b.id === bidId);
    if (winnerBid) winnerBid.status = 'winner';
    // 未中标出价匿名归档
    const losers = _bids.filter(b => b.tenderId === tenderId && b.id !== bidId && b.status === 'pending');
    losers.forEach(b => {
      b.status = 'archived';
      _archive.push({
        id: _genId('BID-A'), tenderId,
        rate: b.rate, amount: b.amount, termMonths: b.termMonths,
        timeToFundDays: b.timeToFundDays, archivedAt: _nowIso(),
        // 匿名: 抹除 bankName/bankGroup (供 MOD-16.10 行业基准分析)
        reason: '未中标匿名归档'
      });
    });
    await _appendChain(tenderId, 'select_winner', {
      bidId, bankId: winner.bankId, rank: winner.rank,
      rate: winner.rate, amount: winner.amount,
      archivedLoserCount: losers.length
    });
    _persist();
    _notify({ type: 'winner_selected', tenderId, bidId });
    return { tenderId, winnerBidId: bidId, winner, archivedCount: losers.length };
  }

  // ============================================================
  // 公共 API: detectFraud(tenderId)
  // ----------------------------------------------------------
  // BID.5 竞价反作弊 (合作行校验 + 串通报价检测 + 多头防控 5 倍净资产)
  // spec L3339-3343: 3 项校验 + 串通标记人工复核 + 全程上链
  // ============================================================
  async function detectFraud(tenderId) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) return { tenderId, passed: false, checks: [], issues: ['标书不存在'] };
    const tenderBids = _bids.filter(b => b.tenderId === tenderId);
    const issues = [];
    const checks = [];

    // 1. 合作行校验 (防外部恶意报价)
    const nonPartner = tenderBids.filter(b => !_isPartnerBank(b.bankId));
    checks.push({
      name: '合作行准入校验',
      passed: nonPartner.length === 0,
      detail: nonPartner.length ? ('拦截 ' + nonPartner.length + ' 家非准入行: ' + nonPartner.map(b => b.bankId).join(',')) : '全部出价银行均为平台准入合作行'
    });
    nonPartner.forEach(b => { b.isFraudulent = true; b.fraudReason = '非平台准入合作行'; b.status = 'disqualified'; });

    // 2. 串通报价检测 (多家出价利率异常一致)
    const rateGroups = {};
    tenderBids.forEach(b => {
      if (b.status === 'disqualified') return;
      // 按 0.01% 容差聚类
      const key = Math.round(b.rate / COLLUSION_RATE_TOLERANCE) * COLLUSION_RATE_TOLERANCE;
      const k = key.toFixed(4);
      rateGroups[k] = rateGroups[k] || [];
      rateGroups[k].push(b);
    });
    const collusionGroups = [];
    Object.keys(rateGroups).forEach(k => {
      const group = rateGroups[k];
      if (group.length >= 2) {
        // 同集团多家利率一致 → 高风险串通
        const groups = {};
        group.forEach(b => { groups[b.bankGroup] = (groups[b.bankGroup] || 0) + 1; });
        const sameGroup = Object.keys(groups).some(g => groups[g] > 1);
        collusionGroups.push({ rate: k, bankIds: group.map(b => b.bankId), sameGroup });
        group.forEach(b => {
          b.isFraudulent = true;
          b.fraudReason = (b.fraudReason ? b.fraudReason + '; ' : '') + '疑似串通报价: 利率异常一致 ' + k + '%';
        });
      }
    });
    checks.push({
      name: '串通报价检测',
      passed: collusionGroups.length === 0,
      detail: collusionGroups.length
        ? ('发现 ' + collusionGroups.length + ' 组利率异常一致 (容差 0.01%): ' + collusionGroups.map(g => g.rate + '% [' + g.bankIds.join(',') + ']' + (g.sameGroup ? '(同集团)' : '')).join('; '))
        : '无利率异常一致, 未发现串通迹象'
    });
    if (collusionGroups.length) {
      issues.push('发现疑似串通报价, 系统已标记并需人工复核');
      collusionGroups.forEach(g => { issues.push('利率 ' + g.rate + '% 异常一致: ' + g.bankIds.join(',') + (g.sameGroup ? ' (同集团, 高风险)' : '')); });
    }

    // 3. 多头防控 (5 倍净资产)
    const multiHead = getMultiHeadRisk(tender.enterpriseId);
    checks.push({
      name: '多头防控 (5 倍净资产)',
      passed: !multiHead.exceeded,
      detail: '累计授信 ' + multiHead.existingCredit + ' / 净资产 ' + multiHead.netAssets + ' × 5 = 上限 ' + multiHead.netAssetsCap + (multiHead.exceeded ? ' (已超限)' : ' (未超限)')
    });
    if (multiHead.exceeded) {
      issues.push('多头防控告警: 累计授信 ' + multiHead.existingCredit + ' 超 5 倍净资产上限 ' + multiHead.netAssetsCap);
    }

    // 4. 凭证出示记录上链查询 (spec L3342: 已被采信次数 ≤ 阈值)
    const credUses = _countCredentialUses(tender.credentialRef);
    const credThreshold = 5;
    checks.push({
      name: '凭证采信次数校验',
      passed: credUses <= credThreshold,
      detail: '凭证 ' + tender.credentialRef + ' 已被采信 ' + credUses + ' 次 (阈值 ' + credThreshold + ')'
    });
    if (credUses > credThreshold) {
      issues.push('凭证采信次数超阈值 (' + credUses + ' > ' + credThreshold + ')');
    }

    const passed = checks.every(c => c.passed);
    await _appendChain(tenderId, 'fraud_detection', {
      passed, checks, issueCount: issues.length
    });
    _persist();
    _notify({ type: 'fraud_detected', tenderId, passed });
    return { tenderId, passed, checks, issues, multiHead };
  }

  // 私有: 凭证采信次数统计 (跨标书)
  function _countCredentialUses(credentialRef) {
    if (!credentialRef) return 0;
    return _tenders.filter(t => t.credentialRef === credentialRef).length;
  }

  // ============================================================
  // 公共 API: getMultiHeadRisk(entId)
  // ----------------------------------------------------------
  // BID.5 多头防控 (同一企业累计授信不超净资产 5 倍)
  // 累计授信 = 该企业全量出价(非失格)金额合计
  // ============================================================
  function getMultiHeadRisk(entId) {
    const ent = _getEnterprise(entId);
    const netAssets = _deriveNetAssets(ent);
    const netAssetsCap = netAssets * MULTI_HEAD_MULTIPLE;
    // 累计授信: 该企业所有标书的有效出价(含 winner + pending, 不含 disqualified) 金额
    const enterpriseTenders = _tenders.filter(t => t.enterpriseId === entId).map(t => t.id);
    const relevantBids = _bids.filter(b =>
      enterpriseTenders.indexOf(b.tenderId) >= 0 && b.status !== 'disqualified'
    );
    const existingCredit = relevantBids.reduce((s, b) => s + b.amount, 0);
    return {
      enterpriseId: entId,
      netAssets,
      netAssetsCap,
      existingCredit,
      remaining: Math.max(0, netAssetsCap - existingCredit),
      exceeded: existingCredit > netAssetsCap,
      multiple: MULTI_HEAD_MULTIPLE,
      bidCount: relevantBids.length
    };
  }

  // ============================================================
  // 公共 API: getArchivedBids()
  // ----------------------------------------------------------
  // BID.6 未中标出价匿名归档 (供 MOD-16.10 行业利率基准分析)
  // ============================================================
  function getArchivedBids() {
    return _archive.map(a => Object.assign({}, a));
  }

  // ============================================================
  // 公共 API: getBids(tenderId) / getChainEvidence(tenderId)
  // ============================================================
  function getBids(tenderId) {
    const arr = tenderId ? _bids.filter(b => b.tenderId === tenderId) : _bids;
    return arr.map(b => Object.assign({}, b));
  }

  function getChainEvidence(tenderId) {
    const t = _tenders.find(x => x.id === tenderId);
    return t ? (t.chainEvidence || []).slice() : [];
  }

  // ============================================================
  // 公共 API: subscribe(fn) — 出价/状态变化订阅
  // ============================================================
  function subscribe(fn) {
    if (typeof fn === 'function') _subscribers.add(fn);
    return () => { _subscribers.delete(fn); };
  }

  // ============================================================
  // 公共 API: getPartnerBanks() — 合作行白名单 (UI 渲染用)
  // ============================================================
  function getPartnerBanks() {
    return _partnerBanks.map(b => Object.assign({}, b));
  }

  // ============================================================
  // 公共 API: closeTender(tenderId) — 手动截止竞价
  // ============================================================
  async function closeTender(tenderId) {
    const tender = _tenders.find(t => t.id === tenderId);
    if (!tender) throw new Error('closeTender: 标书不存在');
    if (tender.status === 'awarded') throw new Error('closeTender: 标书已中标, 不可截止');
    tender.status = 'closed';
    await _appendChain(tenderId, 'close_tender', { reason: '手动截止 / 超时' });
    _persist();
    _notify({ type: 'tender_closed', tenderId });
    return tender;
  }

  // ============================================================
  // 公共 API: reset() — 清空全部 (调试用)
  // ============================================================
  function reset() {
    _tenders.length = 0;
    _bids.length = 0;
    _archive.length = 0;
    _chainHeadHash = '0'.repeat(64);
    _blockNumber = 100000;
    try {
      if (typeof localStorage !== 'undefined') {
        [LS_TENDERS, LS_BIDS, LS_ARCHIVE, LS_CHAIN_HEAD, LS_BLOCK].forEach(k => localStorage.removeItem(k));
      }
    } catch (_) {}
    _notify({ type: 'reset' });
  }

  // ============================================================
  // 初始化 (恢复持久化 + 准入合作行池)
  // ============================================================
  _restore();
  _initPartnerBanks();

  // ============================================================
  // 公共 API 导出
  // ============================================================
  return {
    // 核心 API (spec 规定)
    publishTender,
    getTenders,
    inviteBanks,
    submitBid,
    rankBids,
    selectWinner,
    detectFraud,
    getArchivedBids,
    getMultiHeadRisk,
    // 辅助 API (供 UI / 父 agent 使用)
    getTender,
    getBids,
    getChainEvidence,
    getPartnerBanks,
    closeTender,
    subscribe,
    reset,
    // 常量 (供 UI 显示)
    W_RATE, W_AMOUNT, W_SPEED,
    BID_WINDOW_MS,
    MULTI_HEAD_MULTIPLE,
    COLLUSION_RATE_TOLERANCE
  };

})();

// 暴露到 window (浏览器端全局)
if (typeof window !== 'undefined') {
  window.EcoBid = EcoBid;
}
// CommonJS 兼容 (供 node --check / 单测 mock)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcoBid;
}
