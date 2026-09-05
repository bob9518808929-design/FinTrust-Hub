/**
 * plainTextTranslator.ts — FinTrust Hub 白话文翻译器
 *
 * 设计哲学 (project_memory 傻瓜式操作):
 *   金融术语对老板/仓管/物流工人来说如同天书, 这里把每一个术语翻译成
 *   一句不超过 30 字的白话文, 让用户"一眼就懂, 不用查百度".
 *
 * 用法:
 *   import { translateToPlain, getAllTerms } from '@/utils/plainTextTranslator';
 *   translateToPlain('反向保理'); // "大企业先付款, 小企业才能贷款"
 *
 * 词典覆盖 (≥ 50 条): 应收账款 / 保理 / 贴现 / 背书 / 信用证 / 担保 /
 *   反担保 / 再担保 / 连带责任 / 抵押 / 质押 / 留置 / 保函 / 银团贷款 /
 *   委贷 / 信托 / 租赁 / 融资租赁 / 售后回租 / ABS / MBS / CLO /
 *   信用利差 / 违约概率 / 违约损失率 / 风险加权资产 / 资本充足率 /
 *   杠杆率 / 流动性覆盖率 / 净稳定资金比率 / Basel / LPR / MLF / SLF /
 *   SLO / OMO / RRR / 准备金 / 再贷款 / 再贴现 / 同业拆借 / Shibor /
 *   信用评级 / 五级分类 / 不良贷款 / 拨备覆盖率 / 尽职免责 / 问责制 /
 *   合规 / 风控 / 反洗钱 / KYC / 穿透监管 / 关联交易 / 内保外贷 /
 *   跨境融资 / 外债额度 / 征信 / 增信 / 劣后级 / 优先级 / 夹层 /
 *   夹层融资 / 资产重组 / 债务重组 / 债转股 / 信用债券 / 可转债 /
 *   永续债 / 次级债 / 绿色债券 / 熊猫债 / 点心债 / 收益凭证 / 收益权 /
 *   ABS 出表 / REITs / SPV / 特殊目的信托 等.
 */

export type GlossaryCategory =
  | '融资工具'
  | '担保增信'
  | '资产证券化'
  | '监管指标'
  | '货币政策'
  | '风险与评级'
  | '合规与反洗钱'
  | '跨境与外债'
  | '债券市场'
  | '结构与分层';

export interface GlossaryEntry {
  /** 专业术语 (规范写法, 大小写敏感的英文缩写全大写) */
  term: string;
  /** 白话文翻译 (≤ 30 字, 给非金融用户看) */
  plain: string;
  /** 详细解释 (一句话补充, 可选) */
  detail?: string;
  /** 分类 */
  category: GlossaryCategory;
  /** 别名/英文/缩写, 用于模糊匹配 */
  aliases?: string[];
}

const DICTIONARY: GlossaryEntry[] = [
  // === 融资工具 ===
  {
    term: '应收账款转让',
    plain: '把客户欠你的钱转给银行换贷款',
    detail: '你把"客户未来要付的款"卖给银行, 银行现在就给你钱',
    category: '融资工具',
    aliases: ['应收账款保理', '应收转让'],
  },
  {
    term: '应收账款',
    plain: '客户欠你的钱 (还没收回来的)',
    detail: '货发了但钱还没到账, 这部分就是应收账款',
    category: '融资工具',
  },
  {
    term: '反向保理',
    plain: '大企业先付款, 小企业才能贷款',
    detail: '银行信大企业, 大企业信小企业, 链条反过来才放款',
    category: '融资工具',
    aliases: ['reverse factoring'],
  },
  {
    term: '保理',
    plain: '把欠条卖给银行换现金',
    detail: '应收账款融资的统称, 含催收/坏账担保等服务',
    category: '融资工具',
  },
  {
    term: '贴现',
    plain: '把未到期的票据打折换成现金',
    detail: '票据还没到期, 你急用钱, 银行扣点利息先给你',
    category: '融资工具',
  },
  {
    term: '背书',
    plain: '在票据上签字, 把收款权转给别人',
    detail: '相当于"过户", 谁签字谁就要承担连带责任',
    category: '融资工具',
  },
  {
    term: '票据贴现背书链',
    plain: '一张票据被多次转让+贴现形成的链条',
    detail: '追溯每一手持票人, 用于风险传导分析',
    category: '融资工具',
  },
  {
    term: '信用证',
    plain: '银行替买家开出的"必付款"承诺书',
    detail: '英文 LC, 银行保证买家不付款时由银行付',
    category: '融资工具',
    aliases: ['LC', 'Letter of Credit'],
  },
  {
    term: '银团贷款',
    plain: '多家银行一起借钱给一家企业分摊风险',
    detail: '一家吃不消, 几家合伙凑钱, 风险共担',
    category: '融资工具',
  },
  {
    term: '委贷',
    plain: 'A 出钱, 银行做中间人, 借给 B',
    detail: '企业间不能直接借钱, 必须通过银行走委贷',
    category: '融资工具',
    aliases: ['委托贷款'],
  },
  {
    term: '信托',
    plain: '把财产交给受托人帮你管, 收益归受益人',
    detail: '财产隔离+代管的法律安排',
    category: '融资工具',
  },
  {
    term: '融资租赁',
    plain: '租设备的同时也在分期买设备',
    detail: '租赁公司买下设备租给你, 租期满设备归你',
    category: '融资工具',
  },
  {
    term: '售后回租',
    plain: '把自家设备卖给租赁公司, 再租回来用',
    detail: '等于拿设备做抵押换现金, 设备还能继续用',
    category: '融资工具',
    aliases: ['回租'],
  },
  {
    term: '租赁',
    plain: '用别人的东西, 付租金',
    detail: '不拥有所有权, 只拥有使用权',
    category: '融资工具',
  },

  // === 担保增信 ===
  {
    term: '担保',
    plain: '别人不还钱, 我替他还',
    detail: '给债权人的还款承诺',
    category: '担保增信',
  },
  {
    term: '反担保',
    plain: '我替你担保了, 你再给我一个担保',
    detail: '担保人向被担保人要的"保底", 防止自己吃亏',
    category: '担保增信',
  },
  {
    term: '再担保',
    plain: '给担保公司再上一道保险',
    detail: '担保公司也怕风险, 再找一层兜底',
    category: '担保增信',
  },
  {
    term: '连带责任',
    plain: '多人共同欠债, 谁有钱先找谁还',
    detail: '债权人可任选一人追全部, 不是"各还各的"',
    category: '担保增信',
  },
  {
    term: '抵押',
    plain: '拿房产/设备做担保, 不还钱银行可拍卖',
    detail: '东西还在你手里, 但被锁住了',
    category: '担保增信',
  },
  {
    term: '质押',
    plain: '把存单/股权交银行保管做担保',
    detail: '东西交到对方手里, 不还钱对方可直接处置',
    category: '担保增信',
  },
  {
    term: '留置',
    plain: '你欠我加工费, 我先扣你东西不还',
    detail: '合法占有对方财物, 直到对方付款',
    category: '担保增信',
  },
  {
    term: '保函',
    plain: '银行开出的"出事我赔"承诺信',
    detail: '替代保证金的金融工具, 如履约保函',
    category: '担保增信',
    aliases: ['银行保函', 'LG'],
  },
  {
    term: '增信',
    plain: '加一层保障让借款更安全',
    detail: '通过担保/保险/分级把信用等级提上去',
    category: '担保增信',
  },

  // === 资产证券化 ===
  {
    term: 'ABS',
    plain: '把一堆应收款打包成债券卖出去',
    detail: 'Asset-Backed Securities, 资产支持证券',
    category: '资产证券化',
    aliases: ['资产证券化', '资产支持证券'],
  },
  {
    term: 'ABS 出表',
    plain: '把资产从自己账上"挪走"卖出去',
    detail: '达到会计上的真实出售, 不再算自己的资产',
    category: '资产证券化',
    aliases: ['出表'],
  },
  {
    term: 'MBS',
    plain: '把一堆房贷打包成债券卖',
    detail: 'Mortgage-Backed Securities, 房贷支持证券',
    category: '资产证券化',
  },
  {
    term: 'CLO',
    plain: '把一堆企业贷款打包成债券卖',
    detail: 'Collateralized Loan Obligation, 企业贷款证券化',
    category: '资产证券化',
  },
  {
    term: 'REITs',
    plain: '众筹买房收租的基金',
    detail: '不动产投资信托基金, 像股票一样能交易',
    category: '资产证券化',
    aliases: ['不动产投资信托基金'],
  },
  {
    term: 'SPV',
    plain: '专门用来装资产的金壳子公司',
    detail: 'Special Purpose Vehicle, 风险隔离用',
    category: '资产证券化',
    aliases: ['特殊目的载体', '特殊目的公司'],
  },
  {
    term: '特殊目的信托',
    plain: '专门为发行 ABS 设立的信托',
    detail: '把基础资产装进去实现破产隔离',
    category: '资产证券化',
  },
  {
    term: '收益权',
    plain: '有权收这笔钱但不拥有这笔资产',
    detail: '比如收费公路的"过路费收费权"',
    category: '资产证券化',
  },
  {
    term: '收益凭证',
    plain: '券商发行的"还本付息"理财产品',
    detail: '证券公司以自身信用发行的债务工具',
    category: '资产证券化',
  },

  // === 监管指标 ===
  {
    term: '风险加权资产',
    plain: '按风险高低打折后的"风险总资产"',
    detail: '现金风险低权重小, 贷款风险高权重大',
    category: '监管指标',
    aliases: ['RWA'],
  },
  {
    term: '资本充足率',
    plain: '银行自有本钱占风险资产的比例',
    detail: '至少 8%, 越高越抗风险',
    category: '监管指标',
    aliases: ['CAR'],
  },
  {
    term: '杠杆率',
    plain: '借的钱是本钱的多少倍',
    detail: '负债/一级资本, 不能太高否则爆雷',
    category: '监管指标',
  },
  {
    term: '流动性覆盖率',
    plain: '银行短期够不够钱应对挤提',
    detail: 'LCR, 30 天内高流动性资产/净流出, ≥100%',
    category: '监管指标',
    aliases: ['LCR'],
  },
  {
    term: '净稳定资金比率',
    plain: '银行长期资金稳不稳',
    detail: 'NSFR, 一年内稳定资金/所需资金, ≥100%',
    category: '监管指标',
    aliases: ['NSFR'],
  },
  {
    term: 'Basel',
    plain: '全球银行监管的国际规则',
    detail: '巴塞尔协议, 由国际清算银行发布',
    category: '监管指标',
    aliases: ['巴塞尔', '巴塞尔协议'],
  },
  {
    term: '拨备覆盖率',
    plain: '银行给坏账准备了多少救命钱',
    detail: '贷款减值准备/不良贷款, ≥150% 较安全',
    category: '监管指标',
  },
  {
    term: '五级分类',
    plain: '贷款按好坏分五档: 正常/关注/次级/可疑/损失',
    detail: '后三档算不良贷款',
    category: '监管指标',
    aliases: ['贷款五级分类'],
  },
  {
    term: '不良贷款',
    plain: '收不回来的贷款 (后三类)',
    detail: '次级+可疑+损失类贷款合计',
    category: '监管指标',
    aliases: ['NPL'],
  },

  // === 货币政策 ===
  {
    term: 'LPR',
    plain: '银行给优质客户的贷款基准利率',
    detail: '贷款市场报价利率, 每月公布, 央行基准',
    category: '货币政策',
    aliases: ['贷款市场报价利率'],
  },
  {
    term: 'MLF',
    plain: '央行借钱给银行 3-12 个月的利率',
    detail: '中期借贷便利, 调节中期流动性',
    category: '货币政策',
    aliases: ['中期借贷便利'],
  },
  {
    term: 'SLF',
    plain: '银行缺钱时找央行紧急借钱的利率',
    detail: '常备借贷便利, 央行"最后贷款人"角色',
    category: '货币政策',
    aliases: ['常备借贷便利', '酸辣粉'],
  },
  {
    term: 'SLO',
    plain: '央行短期内突然投放/回收钱',
    detail: '短期流动性调节工具, 短期非常规操作',
    category: '货币政策',
    aliases: ['短期流动性调节工具'],
  },
  {
    term: 'OMO',
    plain: '央行日常公开市场买卖债券调钱',
    detail: '公开市场操作, 调节短期利率与流动性',
    category: '货币政策',
    aliases: ['公开市场操作'],
  },
  {
    term: 'RRR',
    plain: '银行必须存央行的钱比例',
    detail: '存款准备金率, 降准=释放更多可贷资金',
    category: '货币政策',
    aliases: ['存款准备金率', '降准'],
  },
  {
    term: '准备金',
    plain: '银行按比例存央行不能动的钱',
    detail: '用于应对储户提现, 是基础货币的一部分',
    category: '货币政策',
  },
  {
    term: '再贷款',
    plain: '央行直接借钱给特定银行',
    detail: '政策性投放工具, 如支小支农再贷款',
    category: '货币政策',
  },
  {
    term: '再贴现',
    plain: '银行把票据转给央行换钱',
    detail: '央行通过买票据给银行投放流动性',
    category: '货币政策',
  },
  {
    term: '同业拆借',
    plain: '银行之间互相借钱周转',
    detail: '短期无担保借贷, 通常隔夜到 7 天',
    category: '货币政策',
  },
  {
    term: 'Shibor',
    plain: '中国银行间互相借钱的参考利率',
    detail: '上海银行间同业拆放利率, 中国版 Libor',
    category: '货币政策',
    aliases: ['上海银行间同业拆放利率'],
  },

  // === 风险与评级 ===
  {
    term: '信用利差',
    plain: '高风险债券比国债多给的利息',
    detail: '信用债收益率-无风险利率, 越大越担心违约',
    category: '风险与评级',
  },
  {
    term: '违约概率',
    plain: '借款人还不上的可能性',
    detail: 'PD, Probability of Default, 0-100% 区间',
    category: '风险与评级',
    aliases: ['PD'],
  },
  {
    term: '违约损失率',
    plain: '违约后真正赔掉的比例',
    detail: 'LGD, Loss Given Default, 比如抵押品拍卖后还差多少',
    category: '风险与评级',
    aliases: ['LGD'],
  },
  {
    term: '信用评级',
    plain: '机构打的"还款能力"分数',
    detail: 'AAA 最好, D 已违约',
    category: '风险与评级',
  },
  {
    term: '信用评分5C分析',
    plain: '从 5 个角度判断借款人靠不靠谱',
    detail: '品格 Character / 能力 Capacity / 资本 Capital / 担保 Collateral / 环境 Conditions',
    category: '风险与评级',
    aliases: ['5C', '5C分析'],
  },
  {
    term: '风险传导引擎',
    plain: '模拟一家爆雷如何牵连上下游',
    detail: '基于图谱计算风险在企业/银行间的传染',
    category: '风险与评级',
  },
  {
    term: '实控人穿透',
    plain: '一层层查下去找到真正的老板',
    detail: '穿透多层股权结构识别最终受益所有人',
    category: '风险与评级',
    aliases: ['实控人', '穿透实控人'],
  },

  // === 合规与反洗钱 ===
  {
    term: '合规',
    plain: '按监管规定做事不违规',
    detail: '遵守法律法规与内部制度',
    category: '合规与反洗钱',
  },
  {
    term: '风控',
    plain: '事前识别风险、事中控制、事后追责',
    detail: '风险管理的全流程',
    category: '合规与反洗钱',
  },
  {
    term: '反洗钱',
    plain: '防止黑钱变白合法化',
    detail: 'AML, Anti-Money Laundering',
    category: '合规与反洗钱',
    aliases: ['AML'],
  },
  {
    term: 'KYC',
    plain: '了解你的客户是谁、干啥的',
    detail: 'Know Your Customer, 客户身份识别',
    category: '合规与反洗钱',
    aliases: ['了解你的客户'],
  },
  {
    term: '穿透监管',
    plain: '不能躲在壳公司后, 要查到最底层',
    detail: '识别多层嵌套后的真实资产与最终投资者',
    category: '合规与反洗钱',
  },
  {
    term: '关联交易',
    plain: '自己人和自己人做生意',
    detail: '需披露防利益输送',
    category: '合规与反洗钱',
  },
  {
    term: '尽职免责',
    plain: '该做的都做了, 出事不背锅',
    detail: '履行了尽职调查义务可免除追责',
    category: '合规与反洗钱',
  },
  {
    term: '问责制',
    plain: '出事有人负责, 不能甩锅',
    detail: '明确责任人, 失职必追究',
    category: '合规与反洗钱',
  },

  // === 跨境与外债 ===
  {
    term: '内保外贷',
    plain: '国内担保, 境外提款',
    detail: '境内开保函/备用信用证, 境外银行给境外公司放款',
    category: '跨境与外债',
  },
  {
    term: '跨境融资',
    plain: '从境外借钱或给境外借钱',
    detail: '受宏观审慎参数 (X 倍资本) 调节',
    category: '跨境与外债',
  },
  {
    term: '外债额度',
    plain: '企业能向境外借多少钱的上限',
    detail: '按净资产倍数核定, 备案登记后使用',
    category: '跨境与外债',
  },
  {
    term: '征信',
    plain: '记录你借钱还钱历史的档案',
    detail: '央行征信中心维护, 影响能否再贷款',
    category: '跨境与外债',
  },
  {
    term: '熊猫债',
    plain: '境外机构在中国发行的人民币债',
    detail: '境外主体在境内银行间市场发债',
    category: '跨境与外债',
  },
  {
    term: '点心债',
    plain: '境外发行的人民币债券',
    detail: 'Dim Sum Bond, 在香港等地发行',
    category: '跨境与外债',
    aliases: ['点心债'],
  },

  // === 债券市场 ===
  {
    term: '信用债券',
    plain: '只靠信誉发行、无抵押的债券',
    detail: '相比利率债, 需承担发行人违约风险',
    category: '债券市场',
  },
  {
    term: '可转债',
    plain: '能转成股票的债券',
    detail: '债+股票看涨期权的混合品种',
    category: '债券市场',
    aliases: ['可转换债券'],
  },
  {
    term: '永续债',
    plain: '理论上永远不用还本金的债',
    detail: '无固定到期, 利息可递延, 类似股权',
    category: '债券市场',
  },
  {
    term: '次级债',
    plain: '出事后最后一个才还的债',
    detail: '清偿顺序在普通债务之后、股权之前',
    category: '债券市场',
  },
  {
    term: '绿色债券',
    plain: '专款用于环保项目的债券',
    detail: '募集资金必须用于绿色产业',
    category: '债券市场',
  },

  // === 结构与分层 ===
  {
    term: '优先级',
    plain: '出事第一个先拿钱, 风险最低',
    detail: '优先级份额持有人优先受偿',
    category: '结构与分层',
  },
  {
    term: '劣后级',
    plain: '出事最后一个拿钱, 风险最高',
    detail: '相当于给优先级做担保, 收益也最高',
    category: '结构与分层',
    aliases: ['劣后'],
  },
  {
    term: '夹层',
    plain: '夹在优先和劣后之间那一层',
    detail: '中等风险中等收益, 常带转股特征',
    category: '结构与分层',
  },
  {
    term: '夹层融资',
    plain: '介于债和股之间的融资',
    detail: '次级债+认股权, 多用于并购',
    category: '结构与分层',
  },
  {
    term: '资产重组',
    plain: '把公司资产重新洗牌',
    detail: '出售/置换/注入资产以改善经营',
    category: '结构与分层',
  },
  {
    term: '债务重组',
    plain: '还不上了, 跟债主商量延期或打折',
    detail: '修改还款条件避免破产',
    category: '结构与分层',
  },
  {
    term: '债转股',
    plain: '把欠的钱转成股票',
    detail: '债权变股权, 不用还钱但要共担经营风险',
    category: '结构与分层',
  },
];

// === 索引 (term/alias → entry, 大小写不敏感) ===
const INDEX: Map<string, GlossaryEntry> = new Map();

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '');

for (const entry of DICTIONARY) {
  INDEX.set(normalize(entry.term), entry);
  if (entry.aliases) {
    for (const a of entry.aliases) {
      INDEX.set(normalize(a), entry);
    }
  }
}

/**
 * 把金融术语翻译成白话文.
 * 找不到时返回原文, 不抛异常 (避免 UI 渲染失败).
 *
 * @example
 *   translateToPlain('反向保理')  // '大企业先付款, 小企业才能贷款'
 *   translateToPlain('LPR')       // '银行给优质客户的贷款基准利率'
 *   translateToPlain('不存在的词') // '不存在的词'
 */
export function translateToPlain(term: string): string {
  if (!term || typeof term !== 'string') return '';
  const key = normalize(term);
  const entry = INDEX.get(key);
  return entry ? entry.plain : term;
}

/**
 * 查询完整词条 (含白话、详细解释、分类、别名).
 * 找不到返回 undefined.
 */
export function lookupEntry(term: string): GlossaryEntry | undefined {
  if (!term) return undefined;
  return INDEX.get(normalize(term));
}

/**
 * 返回全部词典词条 (用于帮助页/术语表渲染).
 * 不暴露内部 Map, 返回只读数组引用.
 */
export function getAllTerms(): readonly GlossaryEntry[] {
  return DICTIONARY;
}

/**
 * 按分类分组返回, 便于帮助页 Tab/折叠展示.
 */
export function getTermsByCategory(): Record<GlossaryCategory, GlossaryEntry[]> {
  const result = {} as Record<GlossaryCategory, GlossaryEntry[]>;
  for (const entry of DICTIONARY) {
    if (!result[entry.category]) result[entry.category] = [];
    result[entry.category].push(entry);
  }
  return result;
}

/** 词条总数 */
export const GLOSSARY_SIZE: number = DICTIONARY.length;
