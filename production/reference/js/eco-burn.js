/** 文件名：eco-burn.js 职责：ECO-01 阅后即焚零信任诊断模拟器,SGX enclave 内隔离执行画像与差距诊断 */
//
// 模块定位: MOD-16.1 阅后即焚零信任诊断 (P0, 破解"企业数据裸奔"恐惧)
// 对齐 spec.md L2841-2863 (Gherkin 场景) + tasks.md L2843-2856 (BURN.1-BURN.7) +
//       checklist.md L1775-1784 (验收项)
//
// ============================================================================
// 模拟器实现说明 (真实环境 vs 浏览器模拟)
// ============================================================================
// 真实环境 (Intel SGX / ARM TrustZone):
//   - 原始银行流水/税务明细/两套账凭证仅在 SGX enclave 内解密
//   - R1 画像 + R2 差距诊断在 enclave 内 CPU 指令级隔离执行
//   - 宿主 OS / hypervisor 不可读取 enclave 内存
//   - secure_delete 调用 SGX SDK 的 sgx_destroy_enclave + EREMOVE 指令
//
// 浏览器端模拟 (本文件):
//   - 用 window.crypto.subtle.digest('SHA-256') 模拟画像哈希 (SGX 不可见)
//   - 用闭包私有变量 _rawData 模拟 "TeeSecureMemory" (不落盘, 仅 JS 堆)
//   - 用 setTimeout + setInterval 模拟 120 秒 "内存计算" 倒计时
//   - 用 Blob + URL.createObjectURL 在销毁前提供 "最后下载机会"
//   - 用 localStorage.removeItem('eco_burn_raw_*') 模拟 Redis raw_* 清空
//   - "物理销毁": 变量置 null + 三重覆写 (0x00/0xFF/random) + WeakRef 兜底
//   - 脱敏产物持久化到 localStorage.eco_burn_desensitized_<entId>
//   - 销毁审计报告 (MOD-08 链上存证) 持久化到 localStorage.eco_burn_audit_<entId>
// ============================================================================

'use strict';

// ============================================================================
// EcoBurn 单例 (闭包模式, 与 ReformEngine/SCFEngine 风格一致)
// ============================================================================
const EcoBurn = (() => {

  // ============================================================
  // 私有状态 (TeeSecureMemory 模拟)
  // ============================================================
  // _rawData[entId] —— 原始敏感数据, 仅 JS 堆存在, 不落盘
  //   结构: { loadedAt, dataType, recordCount, bytes, records: [...], hash }
  //   records 包含真实交易对手名称/金额 (销毁后永久消失)
  const _rawData = Object.create(null);

  // _status[entId] —— 'idle' | 'loaded' | 'diagnosing' | 'completed' | 'destroyed'
  const _status = Object.create(null);

  // _progress[entId] —— { startedAt, elapsedSec, totalSec, phase }
  const _progress = Object.create(null);

  // _timers[entId] —— setInterval handle (倒计时驱动)
  const _timers = Object.create(null);

  // _desensitized[entId] —— 脱敏产物: 8 维评分 + 12 项 Gap (无原始对手/金额)
  const _desensitized = Object.create(null);

  // _auditTrail[entId] —— 销毁审计报告 (含 MOD-08 链上存证 hash)
  const _auditTrail = Object.create(null);

  // _rawHash[entId] —— 销毁前的原始数据画像哈希快照 (用于审计比对)
  const _rawHash = Object.create(null);

  // _redisKeysCleared[entId] —— 模拟 Redis raw_* 清空的键计数
  const _redisKeysCleared = Object.create(null);

  // _weakRefs[entId] —— WeakRef 兜底 (真实环境: SGX EDESTROY 上下文)
  const _weakRefs = Object.create(null);

  // _subscribers —— 进度订阅回调集合 (UI 沙漏动效驱动)
  const _subscribers = new Set();

  // localStorage 键前缀
  const LS_PREFIX = 'eco_burn_';
  const LS_DESENSITIZED = LS_PREFIX + 'desensitized_'; // 持久化脱敏产物
  const LS_AUDIT = LS_PREFIX + 'audit_';              // 持久化销毁审计
  const LS_RAW = LS_PREFIX + 'raw_';                  // 临时 Redis raw_* (销毁时清空)
  const LS_STATUS = LS_PREFIX + 'status_';           // 当前状态
  const LS_LAST_HASH = LS_PREFIX + 'audit_last_hash'; // 链上最后 hash (链式)

  // 120 秒 "内存计算" 倒计时 (spec L2855: 预计 120 秒后自动焚毁)
  const TOTAL_SECONDS = 120;

  // 12 项 Gap 维度 (8 维评分缺口 + 4 合规违规, 全部脱敏)
  const DIM_KEYS = ['subject', 'finance', 'tax', 'business', 'assets', 'credit', 'policy', 'capital'];
  const DIM_LABELS = {
    subject:  '主体资质',
    finance:  '财务健康',
    tax:      '税务合规',
    business: '业务连续',
    assets:   '资产质量',
    credit:   '信用穿透',
    policy:   '政策适配',
    capital:  '资本结构'
  };

  // ============================================================
  // 工具: SHA-256 (用 crypto.subtle 模拟 SGX 画像哈希)
  // ============================================================
  async function _sha256(text) {
    const str = String(text == null ? '' : text);
    // 优先浏览器 crypto.subtle (模拟 SGX enclave hash 不可见性)
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
  function _lsRemove(key) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); }
    catch (_) { /* ignore */ }
  }

  // ============================================================
  // 私有: 生成原始敏感数据 (银行流水/税务明细/两套账凭证)
  // ----------------------------------------------------------
  // 这些数据包含 "真实交易对手名称 + 金额", 是企业最怕泄露的把柄.
  // 加载后仅存于 _rawData[entId] (TeeSecureMemory), 销毁后永久消失.
  // ============================================================
  function _synthesizeRawRecords(ent, dataType) {
    const entName = (ent && ent.name) || '未知企业';
    const entId = (ent && ent.id) || 'UNKNOWN';
    const seed = entId.charCodeAt(entId.length - 1) || 7;
    const records = [];

    // 模拟对手方池 (仅用于模拟, 真实环境来自银行/税局 API)
    const counterparties = [
      '上海锐达贸易有限公司', '深圳恒信电子科技', '北京京华供应链集团',
      '广州永发金属制品', '苏州同创精密机械', '杭州联众物流',
      '东莞鑫源原材料厂', '宁波海天化工', '成都西峰实业',
      '武汉长江贸易有限', '青岛海港物流', '南京紫金制造'
    ];
    const memos = ['货款', '原料采购', '加工费', '回款', '服务费', '运费', '保证金', '尾款'];

    // -------- 银行流水 (dataType=bank/all) --------
    if (dataType === 'bank' || dataType === 'all') {
      const count = 24 + (seed % 8);
      for (let i = 0; i < count; i++) {
        const cp = counterparties[(i * 3 + seed) % counterparties.length];
        const isOut = (i + seed) % 3 !== 0;
        const amt = (isOut ? -1 : 1) * (50000 + ((i * 7919 + seed * 113) % 950000));
        records.push({
          recType: 'bank_flow',
          recId: `BF-${entId}-${String(i + 1).padStart(3, '0')}`,
          date: `2026-${String(((i % 6) + 3)).padStart(2, '0')}-${String(((i * 7) % 28) + 1).padStart(2, '0')}`,
          counterparty: cp,             // ← 敏感: 真实交易对手 (销毁后消失)
          account: `622848${(1000000 + i * 7777 + seed).toString().slice(0, 7)}`, // ← 敏感: 账号
          amount: amt,                  // ← 敏感: 真实金额 (销毁后消失)
          memo: memos[i % memos.length]
        });
      }
    }

    // -------- 税务明细 (dataType=tax/all) --------
    if (dataType === 'tax' || dataType === 'all') {
      const count = 12 + (seed % 4);
      for (let i = 0; i < count; i++) {
        const cp = counterparties[(i * 5 + seed) % counterparties.length];
        records.push({
          recType: 'tax_detail',
          recId: `TX-${entId}-${String(i + 1).padStart(3, '0')}`,
          invoiceNo: `INV${2026}${String(100000 + i * 1379 + seed).slice(0, 6)}`,
          date: `2026-Q${(i % 4) + 1}`,
          counterparty: cp,             // ← 敏感
          amount: 30000 + ((i * 5471 + seed * 211) % 480000), // ← 敏感
          taxCategory: i % 3 === 0 ? '增值税' : i % 3 === 1 ? '企业所得税' : '印花税',
          taxRate: i % 2 === 0 ? 0.13 : 0.06
        });
      }
    }

    // -------- 两套账凭证 (dataType=twoBooks/all) --------
    if (dataType === 'twoBooks' || dataType === 'all') {
      // 内账/外账差异指针 (最敏感, 销毁优先级最高)
      records.push({
        recType: 'two_books_pointer',
        recId: `TB-${entId}-LEDGER-INTERNAL`,
        ledgerType: 'internal',          // ← 敏感: 内账存在性
        counterparty: '内部关联方-华夏系', // ← 敏感
        diffAmount: -1800000,            // ← 敏感: 内外账差异金额
        memo: '内账调整-未申报'
      });
      records.push({
        recType: 'two_books_pointer',
        recId: `TB-${entId}-LEDGER-EXTERNAL`,
        ledgerType: 'external',
        counterparty: '对外申报口径',
        diffAmount: 0,
        memo: '外账已申报'
      });
    }

    return records;
  }

  // ============================================================
  // 私有: 在 enclave 内完成 R1 画像 + R2 差距诊断 (全程不落盘)
  // ----------------------------------------------------------
  // 输出脱敏后的 8 维评分 + 12 项 Gap (不含原始对手/金额).
  // 优先复用 ReformEngine.runR1/runR2 以保持与改造引擎口径一致;
  // 若 ReformEngine 不可用, 退化为本模块自实现的简化诊断.
  // ============================================================
  async function _runInEnclaveR1R2(ent, rawRecords) {
    const entId = ent.id;
    const entName = ent.name;

    // --- R1: 8 维评分 (脱敏, 仅 0-100 数值, 不含对手明细) ---
    let dims;
    if (typeof ReformEngine !== 'undefined' && ReformEngine.runR1) {
      try {
        const r1 = ReformEngine.runR1(ent);
        dims = r1 && r1.dims ? { ...r1.dims } : null;
      } catch (_) { dims = null; }
    }
    if (!dims) {
      // 退化: 从原始数据 + 企业元数据估算 (诊断逻辑仍在 enclave 内)
      const bankFlows = rawRecords.filter(r => r.recType === 'bank_flow');
      const taxDetails = rawRecords.filter(r => r.recType === 'tax_detail');
      const twoBooks = rawRecords.filter(r => r.recType === 'two_books_pointer');
      const inflow = bankFlows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const outflow = bankFlows.filter(r => r.amount < 0).reduce((s, r) => -s + r.amount, 0) * -1;
      const netCash = inflow - Math.abs(outflow);
      const taxPaid = taxDetails.reduce((s, r) => s + r.amount * r.taxRate, 0);
      const hasTwoBooksDiff = twoBooks.some(r => Math.abs(r.diffAmount) > 0);

      const cs = (ent.runtime && ent.runtime.creditScore) || 650;
      const cc = (ent.runtime && ent.runtime.creditCompleteness) || 0.5;
      const flows = ent.dataFlows ? Object.values(ent.dataFlows).filter(Boolean).length : 3;
      const before = (ent.reform && ent.reform.beforeScorecard) || {};

      dims = {
        subject:  Math.min(100, Math.round((before.subject  || 30) + flows * 6)),
        finance:  Math.min(100, Math.round((before.finance  || 30) + Math.max(0, 30 + netCash / 100000))),
        tax:      Math.min(100, Math.round((before.tax      || 30) + taxDetails.length * 1.5 - (hasTwoBooksDiff ? 20 : 0))),
        business: Math.min(100, Math.round((before.business || 30) + bankFlows.length * 0.8)),
        assets:   Math.min(100, Math.round((before.assets   || 30) + (ent.financials && ent.financials.billsHeld ? ent.financials.billsHeld.length * 6 : 0))),
        credit:   Math.min(100, Math.max(20, Math.round((cs - 500) / 4))),
        policy:   Math.min(100, Math.round((before.policy   || 30) + (ent.industryPolicy === 'encourage' ? 25 : ent.industryPolicy === 'neutral' ? 12 : 0))),
        capital:  Math.min(100, Math.round((before.capital  || 30) + cc * 25 + flows * 2))
      };
    }

    // --- R2: 12 项 Gap (8 维缺口 + 4 合规违规, 全部脱敏) ---
    const gaps = [];
    // 目标阈值 (B+ 银行准入线)
    const targetDims = { subject: 75, finance: 78, tax: 80, business: 72, assets: 70, credit: 75, policy: 68, capital: 72 };
    DIM_KEYS.forEach((k, idx) => {
      const cur = dims[k] || 0;
      const tgt = targetDims[k];
      const gap = Math.max(0, tgt - cur);
      gaps.push({
        gapId: `G${String(idx + 1).padStart(2, '0')}`,
        dim: k,
        dimLabel: DIM_LABELS[k],
        current: cur,
        target: tgt,
        gap,
        urgency: gap > 25 ? 'critical' : gap > 12 ? 'high' : 'low',
        // 改造建议摘要 (脱敏, 不含原始对手)
        suggestion: _getGapSuggestion(k, gap),
        // 无原始交易对手/金额 — 仅指标级摘要
        containsRaw: false
      });
    });

    // 4 项合规违规 (脱敏: 仅描述违规类型, 不暴露对手)
    const twoBooksDiff = rawRecords
      .filter(r => r.recType === 'two_books_pointer' && Math.abs(r.diffAmount) > 0)
      .reduce((s, r) => s + Math.abs(r.diffAmount), 0);
    const violations = [
      {
        gapId: 'G09',
        dim: 'compliance',
        dimLabel: '内外账一致性',
        current: twoBooksDiff > 0 ? 35 : 90,
        target: 95,
        gap: twoBooksDiff > 0 ? 60 : 5,
        urgency: twoBooksDiff > 0 ? 'critical' : 'low',
        suggestion: twoBooksDiff > 0 ? '检出内外账差异, 建议统一账务口径并补申报' : '账务口径一致, 维持现状',
        containsRaw: false
      },
      {
        gapId: 'G10',
        dim: 'compliance',
        dimLabel: '发票-合同匹配',
        current: 70, target: 90, gap: 20,
        urgency: 'high',
        suggestion: '补齐合同-发票-物流三单一致性校验链路',
        containsRaw: false
      },
      {
        gapId: 'G11',
        dim: 'compliance',
        dimLabel: '资金流可追溯',
        current: 68, target: 85, gap: 17,
        urgency: 'medium',
        suggestion: '接入银行资金流监控, 提升回款可追溯度',
        containsRaw: false
      },
      {
        gapId: 'G12',
        dim: 'compliance',
        dimLabel: '税务申报完整性',
        current: 73, target: 90, gap: 17,
        urgency: 'medium',
        suggestion: '补齐缺失税期申报, 完善进项票链',
        containsRaw: false
      }
    ];

    const allGaps = gaps.concat(violations);
    const totalGapPoints = allGaps.reduce((s, g) => s + g.gap, 0);
    const criticalCount = allGaps.filter(g => g.urgency === 'critical').length;
    const highCount = allGaps.filter(g => g.urgency === 'high').length;
    const weightedAvg = DIM_KEYS.reduce((s, k) => s + (dims[k] || 0), 0) / 8;

    return {
      enterpriseId: entId,
      enterpriseName: entName,
      generatedAt: _nowIso(),
      eightDimScore: {
        dims,
        targetDims,
        weightedAvg: Math.round(weightedAvg * 10) / 10,
        weakDims: DIM_KEYS.filter(k => (dims[k] || 0) < 60).map(k => ({ dim: k, label: DIM_LABELS[k], value: dims[k] }))
      },
      twelveGap: allGaps,
      gapSummary: {
        totalGapPoints,
        criticalCount,
        highCount,
        mediumCount: allGaps.filter(g => g.urgency === 'medium').length,
        lowCount: allGaps.filter(g => g.urgency === 'low').length
      },
      reformSuggestionBrief: _buildReformBrief(allGaps),
      // 显式声明: 不含任何原始交易对手/金额明细 (脱敏产物)
      rawFieldsRemoved: ['counterparty', 'account', 'amount', 'invoiceNo', 'diffAmount'],
      rawFieldsRemovedNote: '原始对手方/账号/金额/票号/内外账差异金额已永久销毁, 仅保留指标级评分与改造建议摘要'
    };
  }

  function _getGapSuggestion(dim, gap) {
    if (gap <= 0) return '已达目标, 维持现状';
    const map = {
      subject:  '补齐营业执照/资质证书, 完善主体档案',
      finance:  '优化现金流结构, 提升月度净流入与利润率',
      tax:      '补申报缺失税期, 完善进项票链与税务健康度',
      business: '强化业务连续性管理, 完善订单-交付-回款闭环',
      assets:   '提升票据/存货等动资产权属清晰度与流动性',
      credit:   '接入第三方信用穿透数据, 提升信用画像完整度',
      policy:   '对接产业政策库, 申请政策适配与补贴资格',
      capital:  '优化资本结构, 引入担保/保险增信降低资本成本'
    };
    return map[dim] || '针对性补齐该维度短板';
  }

  function _buildReformBrief(gaps) {
    const critical = gaps.filter(g => g.urgency === 'critical');
    const high = gaps.filter(g => g.urgency === 'high');
    const parts = [];
    if (critical.length) parts.push(`优先级 P0: ${critical.map(g => g.dimLabel).join('/')}`);
    if (high.length) parts.push(`优先级 P1: ${high.map(g => g.dimLabel).join('/')}`);
    parts.push('建议 30 天内启动改造, 90 天达成 B+ 准入');
    return parts.join(' | ');
  }

  // ============================================================
  // 私有: 三重覆写物理销毁 (secure_delete 模拟)
  // ----------------------------------------------------------
  // 真实环境: DoD 5220.22-M 三遍覆写 (0x00 → 0xFF → random)
  //          + sgx_destroy_enclave + EREMOVE 指令
  // 浏览器端: 覆写对象字段 3 次 + 置 null + WeakRef 兜底
  // ============================================================
  function _overwriteRaw3x(entId) {
    const raw = _rawData[entId];
    if (!raw || !raw.records) return 0;
    const records = raw.records;
    const fields = ['counterparty', 'account', 'amount', 'invoiceNo', 'diffAmount', 'memo', 'date'];

    // Pass 1: 0x00 (零字节)
    for (const r of records) {
      for (const f of fields) if (r[f] !== undefined) r[f] = '\x00'.repeat(32);
    }
    // Pass 2: 0xFF (全1)
    for (const r of records) {
      for (const f of fields) if (r[f] !== undefined) r[f] = '\xff'.repeat(32);
    }
    // Pass 3: random
    for (const r of records) {
      for (const f of fields) if (r[f] !== undefined) r[f] = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return records.length * fields.length * 3;
  }

  // 清空 Redis raw_* 前键 (localStorage.eco_burn_raw_* 模拟)
  function _clearRedisRaw(entId) {
    let cleared = 0;
    // 模拟 raw_<entId>_* 前键 (实际可能多条临时缓存)
    const keys = [
      LS_RAW + entId,
      LS_RAW + entId + '_bank',
      LS_RAW + entId + '_tax',
      LS_RAW + entId + '_twobooks',
      LS_RAW + entId + '_snapshot'
    ];
    for (const k of keys) {
      if (_lsGet(k) !== null) { _lsRemove(k); cleared++; }
    }
    _redisKeysCleared[entId] = cleared;
    return cleared;
  }

  // 释放 TeeSecureMemory 上下文 (模拟 SGX EDESTROY)
  function _destroyTeeContext(entId) {
    // 1. 三重覆写原始数据
    const overwrittenCells = _overwriteRaw3x(entId);
    // 2. 置空整个原始数据对象
    if (_rawData[entId]) {
      _rawData[entId] = null;
      delete _rawData[entId];
    }
    // 3. WeakRef 兜底 (真实环境: sgx_destroy_enclave 后 OS 也无法回收该内存)
    //    此处仅作语义占位, GC 实际由 V8 heap 管理
    _weakRefs[entId] = null;
    // 真实环境将调用:
    //   sgx_destroy_enclave(eid);
    //   memset(enclave_base, 0, ENCLAVE_SIZE);
    //   EREMOVE 指令移除 EPC 页
    return { overwrittenCells };
  }

  // ============================================================
  // 私有: 构建销毁审计报告 (MOD-08 链上存证)
  // ============================================================
  async function _buildAuditTrail(entId) {
    const destroyedAt = _nowIso();
    const destroyedAtMs = _nowMs();
    const rawHash = _rawHash[entId] || '0000000000000000000000000000000000000000000000000000000000000000';
    const desens = _desensitized[entId] || {};
    const desensitizedHash = await _sha256(JSON.stringify(desens));

    // 链式 hash: prevHash + txId + rawHash + destroyedAt + desensitizedHash
    const prevHash = _lsGet(LS_LAST_HASH) || '0000000000000000000000000000000000000000000000000000000000000000';
    const txId = `BURN_${entId}_${destroyedAtMs}`;
    const blockNumber = 880000 + Math.floor(destroyedAtMs / 1000) % 999999;
    const chainHash = await _sha256(prevHash + '|' + txId + '|' + rawHash + '|' + destroyedAt + '|' + desensitizedHash);

    _lsSet(LS_LAST_HASH, chainHash);

    return {
      txId,
      blockNumber,
      chainHash,
      prevHash,
      witnessNode: 'MOD-08 链上存证节点 N08 (FinTrust Chain)',
      network: 'FinTrust Chain testnet-v3.1',
      destroyedAt,
      rawHashBeforeDestroy: rawHash,
      desensitizedHashAfterPersist: desensitizedHash,
      threeTrails: {
        overwriteTrail: 'secure_delete 3-pass DoD 5220.22-M (0x00 → 0xFF → random) 已执行',
        memoryZeroTrail: 'TeeSecureMemory enclave 上下文已释放并清零 (sgx_destroy_enclave 等价)',
        redisClearTrail: `Redis raw_'${entId}'_* 前键已清空 (${_redisKeysCleared[entId] || 0} keys flushed)`
      },
      verificationCmd: `verify --tx ${txId} --block ${blockNumber} --chainhash ${chainHash.slice(0, 16)}...`,
      // 不可恢复声明
      irreversibility: '原始数据已物理销毁, 仅脱敏产物 (8维评分+12项Gap) 永久保存, 不可逆向还原对手方/金额'
    };
  }

  // ============================================================
  // 私有: 进度通知 (UI 沙漏动效驱动)
  // ============================================================
  function _notify(entId) {
    const payload = {
      enterpriseId: entId,
      status: _status[entId] || 'idle',
      progress: _getProgressSnapshot(entId),
      timestamp: _nowIso()
    };
    for (const cb of _subscribers) {
      try { cb(payload); } catch (_) { /* 单个订阅者异常不影响其他 */ }
    }
  }

  function _getProgressSnapshot(entId) {
    const p = _progress[entId];
    if (!p) return { elapsedSec: 0, remainingSec: TOTAL_SECONDS, percent: 0, phase: 'idle' };
    const elapsed = Math.min(p.totalSec, Math.floor((_nowMs() - p.startedAt) / 1000));
    const remaining = Math.max(0, p.totalSec - elapsed);
    return {
      elapsedSec: elapsed,
      remainingSec: remaining,
      percent: Math.min(100, Math.round(elapsed / p.totalSec * 100)),
      phase: p.phase
    };
  }

  // ============================================================
  // 公共 API: loadRawData
  // ----------------------------------------------------------
  // 模拟 Tier-2 付费 API 采集银行流水/税务明细/两套账凭证
  // 加载到 TeeSecureMemory (闭包私有变量, 不落盘)
  // ============================================================
  async function loadRawData(enterpriseId, dataType) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) throw new Error('loadRawData: 缺少 enterpriseId');
    const ent = (typeof State !== 'undefined' && State.enterprises)
      ? State.enterprises.find(e => e.id === entId)
      : null;
    if (!ent) throw new Error('loadRawData: 企业不存在 ' + entId);

    const dt = dataType || 'all';
    if (!['bank', 'tax', 'twoBooks', 'all'].includes(dt)) {
      throw new Error('loadRawData: dataType 必须为 bank|tax|twoBooks|all');
    }

    // 1. 合成原始敏感数据 (真实环境: 调用银行/税局 Tier-2 API)
    const records = _synthesizeRawRecords(ent, dt);
    // 2. 计算原始画像哈希 (SGX enclave hash, 宿主不可见)
    const serialized = JSON.stringify(records);
    const hash = await _sha256(serialized + '|' + entId + '|' + dt);

    // 3. 载入 TeeSecureMemory (闭包私有变量)
    _rawData[entId] = {
      enterpriseId: entId,
      loadedAt: _nowIso(),
      dataType: dt,
      recordCount: records.length,
      bytes: serialized.length,
      records: records,
      hash: hash
    };
    // 原始 hash 快照 (销毁审计比对用)
    _rawHash[entId] = hash;

    // 4. 临时缓存到 localStorage (模拟 Redis raw_* 缓存; 销毁时清空)
    _lsSet(LS_RAW + entId, JSON.stringify({
      hash, loadedAt: _rawData[entId].loadedAt, recordCount: records.length
      // 注意: 此处仅缓存摘要元数据, 真实原始 records 仅存 TeeSecureMemory
    }));

    // 5. 状态转移
    _status[entId] = 'loaded';
    _lsSet(LS_STATUS + entId, 'loaded');

    if (typeof State !== 'undefined' && typeof State.log === 'function') {
      State.log('burn', `[BURN] 原始数据已载入 TeeSecureMemory: ${ent.name} | 类型 ${dt} | ${records.length} 条 | 画像哈希 ${hash.slice(0, 12)}...`, 'config');
    }
    _notify(entId);

    return {
      enterpriseId: entId,
      dataType: dt,
      recordCount: records.length,
      bytes: serialized.length,
      hash: hash,
      loadedAt: _rawData[entId].loadedAt,
      memoryRegion: 'TeeSecureMemory (enclave-sim)',
      message: '原始数据已载入受保护内存区, 准备启动零信任诊断'
    };
  }

  // ============================================================
  // 公共 API: runDiagnosis
  // ----------------------------------------------------------
  // 启动 120 秒倒计时 + 内存计算 + 计算完成后物理销毁
  // 流程: load → diagnosing(120s) → completed → secureDelete → destroyed
  // ============================================================
  async function runDiagnosis(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) throw new Error('runDiagnosis: 缺少 enterpriseId');

    // 若未加载原始数据, 自动加载 (默认 all)
    if (!_rawData[entId]) {
      await loadRawData(entId, 'all');
    }

    const ent = (typeof State !== 'undefined' && State.enterprises)
      ? State.enterprises.find(e => e.id === entId) : null;
    if (!ent) throw new Error('runDiagnosis: 企业不存在 ' + entId);

    // 已在诊断中 → 幂等返回当前进度
    if (_timers[entId]) {
      return _getProgressSnapshot(entId);
    }

    // 已销毁 → 提示重新加载
    if (_status[entId] === 'destroyed') {
      throw new Error('runDiagnosis: 原始数据已销毁, 请重新 loadRawData 后再诊断');
    }

    // 状态: diagnosing
    _status[entId] = 'diagnosing';
    _lsSet(LS_STATUS + entId, 'diagnosing');
    _progress[entId] = {
      startedAt: _nowMs(),
      totalSec: TOTAL_SECONDS,
      phase: 'diagnosing'
    };

    if (typeof State !== 'undefined' && typeof State.log === 'function') {
      State.log('burn', `[BURN] 启动 120 秒零信任内存诊断: ${ent.name} | 沙漏倒计时开始, 完成后立即物理销毁原始数据`, 'burn');
    }
    _notify(entId);

    // 异步在 "enclave 内" 完成 R1+R2 (不落盘)
    // 真实环境: enclave 内 CPU 指令执行, 此处模拟同步计算
    const desensitized = await _runInEnclaveR1R2(ent, _rawData[entId].records);
    _desensitized[entId] = desensitized;
    // 持久化脱敏产物到 localStorage (数据湖永久保存)
    _lsSet(LS_DESENSITIZED + entId, JSON.stringify(desensitized));

    // 倒计时驱动 (每秒触发, 模拟沙漏动效)
    _timers[entId] = setInterval(() => {
      const snap = _getProgressSnapshot(entId);
      _notify(entId);
      if (snap.remainingSec <= 0) {
        // 120 秒到 → 物理销毁
        clearInterval(_timers[entId]);
        _timers[entId] = null;
        _progress[entId].phase = 'completed';
        _status[entId] = 'completed';
        _lsSet(LS_STATUS + entId, 'completed');
        // 异步执行物理销毁
        secureDelete(entId).then(audit => {
          if (typeof State !== 'undefined' && typeof State.log === 'function') {
            State.log('burn', `[BURN] ✅ 物理销毁完成: ${ent.name} | 链上存证 ${audit.txId} (block ${audit.blockNumber}) | 原始数据已彻底焚毁, 仅保留脱敏体检报告`, 'burn');
          }
        });
      }
    }, 1000);

    return _getProgressSnapshot(entId);
  }

  // ============================================================
  // 公共 API: getBurnProgress
  // ============================================================
  function getBurnProgress(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return { elapsedSec: 0, remainingSec: TOTAL_SECONDS, percent: 0, phase: 'idle' };
    return _getProgressSnapshot(entId);
  }

  // ============================================================
  // 公共 API: getDesensitizedReport
  // ----------------------------------------------------------
  // 返回脱敏后的 8 维评分 + 12 项 Gap (不含原始对手/金额)
  // 优先从内存, 回退 localStorage
  // ============================================================
  function getDesensitizedReport(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return null;
    if (_desensitized[entId]) return _desensitized[entId];
    const cached = _lsGet(LS_DESENSITIZED + entId);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) { return null; }
    }
    return null;
  }

  // ============================================================
  // 公共 API: secureDelete (物理销毁)
  // ----------------------------------------------------------
  // 三重覆写 + 置 null + 清空 Redis raw_* + 释放 Tee 上下文
  // + 生成销毁审计报告 (MOD-08 链上存证)
  // ============================================================
  async function secureDelete(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) throw new Error('secureDelete: 缺少 enterpriseId');

    // 0. 幂等: 已销毁则直接返回既有审计报告 (避免重复销毁/重复上链)
    if (_status[entId] === 'destroyed' && _auditTrail[entId]) {
      return _auditTrail[entId];
    }

    // 0.5 清理倒计时定时器 (若用户在 120s 内手动销毁, 防止 interval 继续触发)
    if (_timers[entId]) {
      clearInterval(_timers[entId]);
      _timers[entId] = null;
    }

    // 1. 销毁前快照原始画像哈希 (若尚未存在)
    if (!_rawHash[entId] && _rawData[entId]) {
      _rawHash[entId] = await _sha256(JSON.stringify(_rawData[entId].records) + '|' + entId);
    }

    // 2. 三重覆写 + 释放 Tee 上下文 (sgx_destroy_enclave 等价)
    const destroyResult = _destroyTeeContext(entId);

    // 3. 清空 Redis raw_* 前键
    const redisCleared = _clearRedisRaw(entId);

    // 4. 状态: destroyed
    _status[entId] = 'destroyed';
    _lsSet(LS_STATUS + entId, 'destroyed');

    // 5. 生成销毁审计报告 (MOD-08 链上存证)
    const audit = await _buildAuditTrail(entId);
    audit.overwrittenCells = destroyResult.overwrittenCells;
    audit.redisKeysCleared = redisCleared;
    _auditTrail[entId] = audit;
    _lsSet(LS_AUDIT + entId, JSON.stringify(audit));

    _notify(entId);
    return audit;
  }

  // ============================================================
  // 公共 API: getAuditTrail (销毁审计报告, 含上链存证 hash)
  // ============================================================
  function getAuditTrail(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return null;
    if (_auditTrail[entId]) return _auditTrail[entId];
    const cached = _lsGet(LS_AUDIT + entId);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) { return null; }
    }
    return null;
  }

  // ============================================================
  // 公共 API: subscribeProgress (进度订阅, UI 沙漏动效)
  // ============================================================
  function subscribeProgress(callback) {
    if (typeof callback !== 'function') {
      throw new Error('subscribeProgress: callback 必须为函数');
    }
    _subscribers.add(callback);
    // 返回 unsubscribe 函数 (便于 UI 切换 Tab 时清理)
    return function unsubscribe() {
      _subscribers.delete(callback);
    };
  }

  // ============================================================
  // 公共 API: 辅助方法 (供 UI / 父 agent 调用)
  // ============================================================

  // 当前状态查询 (供 UI 渲染分支)
  function getStatus(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return 'idle';
    return _status[entId] || _lsGet(LS_STATUS + entId) || 'idle';
  }

  // 获取原始数据元信息 (不含 records, 不暴露敏感字段; 用于 UI 显示 "已加载 N 条")
  function getRawMeta(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return null;
    const r = _rawData[entId];
    if (r) {
      return {
        enterpriseId: entId,
        loadedAt: r.loadedAt,
        dataType: r.dataType,
        recordCount: r.recordCount,
        bytes: r.bytes,
        hash: r.hash,
        inMemory: true,
        memoryRegion: 'TeeSecureMemory (enclave-sim)'
      };
    }
    const cached = _lsGet(LS_RAW + entId);
    if (cached) {
      try { return { ...JSON.parse(cached), inMemory: false }; } catch (_) { return null; }
    }
    return null;
  }

  // 最后下载机会 (销毁前导出原始数据快照 — 仅企业自身可见)
  // 真实环境: 数据销毁前企业可下载自己上交数据的加密副本 (留底)
  async function offerLastDownload(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) throw new Error('offerLastDownload: 缺少 enterpriseId');
    const r = _rawData[entId];
    if (!r) throw new Error('offerLastDownload: 原始数据不在内存 (已销毁或未加载)');

    const payload = {
      enterpriseId: entId,
      exportedAt: _nowIso(),
      hash: r.hash,
      recordCount: r.recordCount,
      dataType: r.dataType,
      records: r.records,
      notice: '此副本由企业自行留存, FinTrust Hub 已物理销毁原始内存数据'
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
    return {
      blob, url,
      filename: `eco_burn_raw_${entId}_${Date.now()}.json`,
      size: blob.size,
      notice: '销毁前最后下载机会: 此副本离开系统后由企业自行保管'
    };
  }

  // 重置某企业 (主要用于调试 / 重新演示)
  function reset(enterpriseId) {
    const entId = enterpriseId || (typeof State !== 'undefined' ? State.currentEnterpriseId : null);
    if (!entId) return;
    if (_timers[entId]) { clearInterval(_timers[entId]); _timers[entId] = null; }
    _rawData[entId] = null; delete _rawData[entId];
    _desensitized[entId] = null; delete _desensitized[entId];
    _auditTrail[entId] = null; delete _auditTrail[entId];
    _progress[entId] = null; delete _progress[entId];
    _rawHash[entId] = null; delete _rawHash[entId];
    _weakRefs[entId] = null; delete _weakRefs[entId];
    _status[entId] = 'idle';
    _lsRemove(LS_DESENSITIZED + entId);
    _lsRemove(LS_AUDIT + entId);
    _lsRemove(LS_RAW + entId);
    _lsRemove(LS_STATUS + entId);
    _notify(entId);
  }

  // ============================================================
  // 公共 API 导出
  // ============================================================
  return {
    // 核心 API (spec 规定)
    loadRawData,
    runDiagnosis,
    getBurnProgress,
    getDesensitizedReport,
    secureDelete,
    getAuditTrail,
    subscribeProgress,
    // 辅助 API (供 UI / 父 agent 使用)
    getStatus,
    getRawMeta,
    offerLastDownload,
    reset,
    // 常量 (供 UI 显示)
    TOTAL_SECONDS,
    DIM_KEYS,
    DIM_LABELS
  };

})();

// 暴露到 window (浏览器端全局)
if (typeof window !== 'undefined') {
  window.EcoBurn = EcoBurn;
}
// CommonJS 兼容 (供 node --check / 单测 mock)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcoBurn;
}
