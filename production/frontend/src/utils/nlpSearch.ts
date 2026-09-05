/**
 * utils/nlpSearch.ts — 运营台异常清单自然语言搜索
 *
 * 设计哲学 (FinTrust Hub "傻瓜式操作"):
 *   - 用户不做选择题, 只做判断题或填空题
 *   - 把自然语言查询转成结构化筛选条件, 不接 LLM, 纯本地关键词匹配
 *
 * 实现:
 *   - parseNlpQuery(query) 用内置关键词模式识别意图, 返回 ParsedFilter
 *   - applyFilter(rows, filter) 按 ParsedFilter 过滤异常清单
 *   - 至少 8 个关键词模式 (融资被拒/改造落后/红灯/逾期/异常/低分/未授信/待审批 等)
 *
 * 契约对齐: 后端 /api/v1/reform/* + 企业 runtime/reform 字段.
 */

/** 解析后的筛选条件 (filterKey 命中后, filterValue 为比较基准值). */
export interface ParsedFilter {
  /** 命中的筛选键 (与异常行字段对齐) */
  filterKey:
    | 'financingStatus'
    | 'reformProgress'
    | 'redLightCount'
    | 'hasOverdue'
    | 'hasAbnormal'
    | 'creditScore'
    | 'creditGrade'
    | 'approvalStatus'
    | 'riskProfile'
    | 'financingUnlocked'
    | 'enterpriseName';
  /** 筛选基准值 (字符串/数字/布尔) */
  filterValue: string | number | boolean;
  /** 比较算子 */
  operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains';
  /** 给 UI 展示的可读标签 */
  label: string;
}

/** 异常清单行 (与 AdvisorWorkbenchView 内部结构对齐). */
export interface AbnormalRow {
  enterpriseId: string;
  enterprise: string;
  abnormalType: string;
  light: 'green' | 'yellow' | 'red';
  redLightCount: number;
  financingStatus: string;
  reformProgress: number;
  hasOverdue: boolean;
  hasAbnormal: boolean;
  creditScore: number;
  creditGrade: string;
  approvalStatus: string;
  riskProfile: string;
  financingUnlocked: boolean;
}

/** 关键词模式定义. */
interface KeywordPattern {
  /** 正则 (小写匹配) */
  regex: RegExp;
  filterKey: ParsedFilter['filterKey'];
  extractValue: (match: RegExpMatchArray | null) => { value: string | number | boolean; operator: ParsedFilter['operator'] };
  label: string;
}

// === 内置关键词模式 (≥ 8 个, 覆盖运营台高频查询) ===
// 顺序敏感: 更具体的模式放前面 (如 "红灯超过3个" 优先于 "红灯")
const PATTERNS: KeywordPattern[] = [
  {
    // 1. 融资被拒 (financingStatus=rejected)
    regex: /(融资.{0,4}?(被拒|拒绝|驳回|拒了))|(financing.{0,4}?rejected)/i,
    filterKey: 'financingStatus',
    extractValue: () => ({ value: 'rejected', operator: 'eq' }),
    label: '融资被拒',
  },
  {
    // 2. 改造进度落后 (reformProgress < 阈值, 默认 50%)
    regex: /(改造.{0,4}?(落后|迟缓|缓慢|滞后|进度低))|(reform.{0,4}?lag)/i,
    filterKey: 'reformProgress',
    extractValue: () => ({ value: 50, operator: 'lt' }),
    label: '改造进度落后 (<50%)',
  },
  {
    // 3. 红灯超过 N 个 (redLightCount > N, 默认 >3)
    regex: /红灯.{0,4}?超过\s*(\d+)\s*个|红灯.{0,4}?(多于|大于)\s*(\d+)\s*个|redlight.{0,4}?gt\s*(\d+)/i,
    filterKey: 'redLightCount',
    extractValue: (m) => {
      const n = m ? parseInt((m[1] || m[2] || m[3] || '3'), 10) : 3;
      return { value: Number.isFinite(n) ? n : 3, operator: 'gt' };
    },
    label: '红灯超过 N 个',
  },
  {
    // 3b. 仅"红灯" (异常项含红灯)
    regex: /(红灯|redlight|red\s*light)/i,
    filterKey: 'redLightCount',
    extractValue: () => ({ value: 0, operator: 'gt' }),
    label: '存在红灯项 (>0)',
  },
  {
    // 4. 逾期 (hasOverdue=true)
    regex: /(逾期|过期|overdue|欠款|拖欠)/i,
    filterKey: 'hasOverdue',
    extractValue: () => ({ value: true, operator: 'eq' }),
    label: '存在逾期',
  },
  {
    // 5. 异常 (hasAbnormal=true, 兜底含黄灯+红灯)
    regex: /(异常|不正常|风险项|abnormal)/i,
    filterKey: 'hasAbnormal',
    extractValue: () => ({ value: true, operator: 'eq' }),
    label: '存在异常项',
  },
  {
    // 6. 低分 (creditScore < 阈值, 默认 600)
    regex: /(低分|信用低|信用差|分数低|credit.{0,4}?low|creditScore.{0,4}?lt\s*(\d+))/i,
    filterKey: 'creditScore',
    extractValue: (m) => {
      const n = m && m[2] ? parseInt(m[2], 10) : 600;
      return { value: Number.isFinite(n) ? n : 600, operator: 'lt' };
    },
    label: '信用分偏低 (<600)',
  },
  {
    // 7. 未授信 (creditGrade=none/C 或 financingUnlocked=false)
    regex: /(未授信|未开通|未解锁|无信用|信用等级\s*[CcDd]|unlocked\s*false|未融资)/i,
    filterKey: 'financingUnlocked',
    extractValue: () => ({ value: false, operator: 'eq' }),
    label: '融资未解锁 (未授信)',
  },
  {
    // 8. 待审批 (approvalStatus=pending)
    regex: /(待审批|待审|审批中|pending|未审批)/i,
    filterKey: 'approvalStatus',
    extractValue: () => ({ value: 'pending', operator: 'eq' }),
    label: '待审批',
  },
  {
    // 9. 高风险 (riskProfile=high_risk/distress)
    regex: /(高风险|风险高|高危|high.?risk|distress)/i,
    filterKey: 'riskProfile',
    extractValue: () => ({ value: 'high_risk', operator: 'eq' }),
    label: '高风险企业',
  },
  {
    // 10. 已解锁融资 (financingUnlocked=true)
    regex: /(已解锁|已授信|已开通|融资可用|unlocked\s*true)/i,
    filterKey: 'financingUnlocked',
    extractValue: () => ({ value: true, operator: 'eq' }),
    label: '融资已解锁',
  },
];

/**
 * 解析自然语言查询为结构化筛选条件.
 *
 * 匹配策略: 按 PATTERNS 顺序匹配第一个命中的模式.
 * 若无模式命中, 退化为"企业名模糊匹配" (filterKey=enterpriseName, contains).
 */
export function parseNlpQuery(query: string): ParsedFilter {
  const text = (query ?? '').trim();
  if (!text) {
    return { filterKey: 'enterpriseName', filterValue: '', operator: 'contains', label: '全部' };
  }
  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      const { value, operator } = p.extractValue(m);
      return { filterKey: p.filterKey, filterValue: value, operator, label: p.label };
    }
  }
  return { filterKey: 'enterpriseName', filterValue: text, operator: 'contains', label: `企业名含"${text}"` };
}

/**
 * 按解析后的筛选条件过滤异常清单行.
 *
 * @param rows 待过滤的异常清单
 * @param filter parseNlpQuery 返回的筛选条件
 * @returns 命中行 (新数组, 不修改原数组)
 */
export function applyFilter(rows: AbnormalRow[], filter: ParsedFilter): AbnormalRow[] {
  if (filter.filterKey === 'enterpriseName') {
    const kw = String(filter.filterValue ?? '').toLowerCase().trim();
    if (!kw) return [...rows];
    return rows.filter((r) => (r.enterprise ?? '').toLowerCase().includes(kw));
  }
  return rows.filter((r) => {
    const key = filter.filterKey as Exclude<ParsedFilter['filterKey'], 'enterpriseName'>;
    const actual = r[key];
    const expected = filter.filterValue;
    switch (filter.operator) {
      case 'eq':
        return actual === expected;
      case 'lt':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case 'lte':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'gt':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'gte':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      case 'contains':
        return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase());
      default:
        return true;
    }
  });
}

/** 便捷: 一步到位解析 + 过滤. */
export function nlpFilter(rows: AbnormalRow[], query: string): AbnormalRow[] {
  return applyFilter(rows, parseNlpQuery(query));
}

/** 搜索框提示文案 (轮换展示). */
export const NLP_HINTS: readonly string[] = [
  '试试输入：显示所有融资被拒的',
  '试试输入：哪些企业改造进度落后',
  '试试输入：红灯超过3个的企业',
  '试试输入：存在逾期的高风险企业',
  '试试输入：信用分偏低的待审批企业',
];
