/**
 * useCoachMark.ts — FinTrust Hub 全局"一键求助" Coach Mark 引导系统
 * -------------------------------------------------------------
 * 设计哲学 (project_memory 傻瓜式操作):
 *   新手按 F1 或点"求助"按钮, 当前页面关键元素依次弹出气泡说明,
 *   像 Intro.js 一样. 用户不需要阅读文档, 跟着走就能学会.
 *
 * 提供:
 *   - state: visible / steps / currentStepIndex
 *   - actions: startTour / next / prev / close / skip / jumpTo
 *   - localStorage 记忆已完成, 不再自动弹出
 *   - routeToTour: 路由 name → 默认 tour steps 映射 (内置常用路由)
 *
 * 用法 (CoachMark.vue 内部 + AppHeader 求助按钮调用):
 *   const coach = useCoachMark();
 *   coach.startTour([
 *     { target: '.app-header', title: '顶部栏', content: '...' },
 *   ]);
 */

import { computed, ref } from 'vue';
import type { Ref } from 'vue';

export type CoachPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface CoachStep {
  /** 目标元素 CSS selector, 例如 '.app-header .user-info' */
  target: string;
  /** 气泡标题 */
  title: string;
  /** 气泡正文 (支持 \n 换行) */
  content: string;
  /** 气泡位置, 默认 'bottom' */
  placement?: CoachPlacement;
  /** 跳过本步时的回退 selector (元素不存在时跳到下一步) */
  fallback?: string;
}

const STORAGE_KEY = 'fintrust-coachmark-completed';
const STORAGE_PER_ROUTE_KEY = 'fintrust-coachmark-completed-routes';

// 简单响应式 store 单例 (Pinia 风格但不需要 install, 模块级单例即可)
const visible: Ref<boolean> = ref(false);
const steps: Ref<CoachStep[]> = ref([]);
const currentStepIndex: Ref<number> = ref(0);

function readCompletedRoutes(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PER_ROUTE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeCompletedRoutes(routes: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_PER_ROUTE_KEY, JSON.stringify([...routes]));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

const completedRoutes = readCompletedRoutes();

/**
 * 内置路由 → 默认引导步骤 映射.
 * AppHeader "求助" 按钮根据当前 route.name 取这里.
 * 新路由可在 router/index.ts meta.tour 中补充, 优先级高于此处.
 */
export const DEFAULT_TOUR_MAP: Record<string, CoachStep[]> = {
  // ============================================================================
  // home — 工作台首页 (财务顾问每日入口)
  // 前因: 财务顾问一早打开系统, 需要一眼看到所有待办与异常, 不能漏单
  // 后果: 看完首页后, 决定今天先去哪个企业/哪个流程
  // ============================================================================
  home: [
    {
      target: '.app-header',
      title: '顶部全局栏',
      content:
        '这是全站通用的顶部栏.\n前因: 你同时服务多家企业, 必须随时知道当前在为哪家企业工作.\n后果: 切换企业后, 全站数据/告警/待办全部跟随切换, 不会串单.',
      placement: 'bottom',
    },
    {
      target: '.portal-entry',
      title: '🚪 我是谁? 多端身份分流卡片',
      content:
        '前因: FinTrust Hub 一套系统服务 5 类角色 (顾问/企业老板/银行/担保保险/工人), 用户进来不知道"我是谁"就会迷路, 必须先做身份分流.\n用法: 看顶部 5 张卡片, 点你对应身份的卡片直接进入对应端的工作台 (不知道选哪个就点"我是财务顾问").\n后果: 点击后跳到对应工作台, 例如点"我是银行客户经理"进入 /bank 银行工作台.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.portal-card',
      title: '身份卡片 (5 张)',
      content:
        '前因: 不同角色关心的事完全不同 (顾问看全盘, 老板看自己企业, 银行看水位审批, 担保保险看协同, 工人扫码确权), 必须用卡片分流.\n用法: 卡片标题说"我是 XX", 点击直接进入对应端.\n后果: 移动端点 PC 卡片会弹提示并跳 /m/scan, PC 点"我是工人"会提示去手机端, 路由守卫已加双端隔离.',
      placement: 'top',
      fallback: '.el-card',
    },
    {
      target: '.scene-card',
      title: '各身份业务场景说明',
      content:
        '前因: 光看卡片标题不够, 用户不知道这个身份进来后干什么, 卡片下方加了场景说明区, 每个身份 4 行 (前因/核心/高频/后果).\n用法: 滚动看 5 张说明卡片, 找到你的身份对应的核心业务场景.\n后果: 理解每个身份的核心场景后, 决定是否切换身份或继续当前身份操作.',
      placement: 'top',
      fallback: '.el-card',
    },
    {
      target: '.app-header .enterprise-select',
      title: '企业切换器',
      content:
        '前因: FinTrust Hub 是多企业 SaaS, 不选企业没法做任何业务.\n用法: 点开下拉, 选今天要服务的企业.\n后果: 切换后, 左侧菜单/告警铃铛/工作台首页全部刷新为新企业数据.',
      placement: 'bottom',
    },
    {
      target: '.app-header .alert-badge',
      title: '告警铃铛',
      content:
        '前因: 系统会自动监控企业改造/融资/审批状态, 出现需要你介入的事项就亮红.\n用法: 看到数字非 0 就点开, 按优先级处理.\n后果: 处理完告警, 数字归零, 表示这批待办已清.',
      placement: 'bottom',
    },
    {
      target: '.stat-card',
      title: 'KPI 卡片区',
      content:
        '前因: 财务顾问每天最关心 4 个数: 在管企业数 / 在途融资额 / 待审批单 / 本周到账.\n用法: 看哪个数字异常 (红色或突增) 就跳过去查详情.\n后果: 点对应卡片会跳到对应工作台.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.quick-entry',
      title: '快速入口',
      content:
        '前因: 高频操作不要每次都去翻左侧菜单.\n用法: 常用动作做成按钮直接点.\n后果: 跳到对应工作台或弹窗开始操作.',
      placement: 'top',
      fallback: '.el-button',
    },
    {
      target: '.app-header .help-button',
      title: '红色求助按钮',
      content:
        '前因: 系统功能多, 不可能全记住, 必须有"傻瓜式求助入口".\n用法: 任何时候不知道怎么做, 点这个红按钮或按 F1, 当前页面会一步步弹气泡教.\n后果: 学完一遍后不再自动弹, 需要复习再点红按钮.',
      placement: 'bottom',
    },
  ],

  // ============================================================================
  // enterprise-list — 企业列表
  // 前因: 新顾问入职/接手新客户, 需要从企业列表进入工作
  // 后果: 点击某企业进入详情, 设为当前企业后才能进入工作台
  // ============================================================================
  'enterprise-list': [
    {
      target: '.app-header',
      title: '企业列表入口',
      content:
        '前因: FinTrust Hub 服务多家企业, 必须先从列表选定一家才能进入业务流程.\n后果: 选定企业后, 整个系统上下文切换为该企业数据.',
      placement: 'bottom',
    },
    {
      target: '.enterprise-list-view',
      title: '企业列表区',
      content:
        '前因: 财务顾问要快速浏览所有在管企业, 看哪家需要优先处理.\n用法: 表格按行业/状态/在管金额排序, 也可以搜索企业名.\n后果: 点击某行进入该企业详情页.',
      placement: 'right',
      fallback: '.el-table',
    },
    {
      target: '.el-table',
      title: '企业表格',
      content:
        '前因: 列表必须用表格而非卡片, 因为顾问要横向对比多家企业.\n用法: 列含企业名/行业/改造状态/融资额/最近活动时间.\n后果: 点行进入详情, 点列头排序.',
      placement: 'top',
    },
    {
      target: '.app-header .enterprise-select',
      title: '设为当前企业',
      content:
        '前因: 进入详情不等于"设为当前企业", 必须在顶部选择器选定才算切换上下文.\n用法: 顶部下拉里点选, 也能在企业详情页点"设为当前".\n后果: 设为当前后, 左侧菜单的工作台首页/改造台/融资流程都会跟随切换.',
      placement: 'bottom',
    },
  ],

  // ============================================================================
  // enterprise-detail — 企业详情
  // 前因: 顾问一眼看全企业全貌 (基本信息+8维评分+改造进度+融资情况)
  // 后果: 基于详情决定下一步动作 (改造/融资/审批)
  // ============================================================================
  'enterprise-detail': [
    {
      target: '.enterprise-detail-view',
      title: '企业详情页',
      content:
        '前因: 财务顾问需要一份"企业体检报告"做决策依据, 不能在多个 Tab 间跳来跳去.\n后果: 看完后决定: 评分低→去改造台; 评分高→去融资流程.',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.el-card',
      title: '基本信息卡片',
      content:
        '前因: 银行/担保/保险要看企业基础画像判断风险.\n内容: 工商信息/法人/行业/注册资本/经营年限.\n后果: 基础信息缺失会影响后续融资准入, 缺什么补什么.',
      placement: 'bottom',
    },
    {
      target: '.bottom-actions',
      title: '底部操作区',
      content:
        '前因: 看完详情要能直接跳到下一步, 不要让顾问再翻菜单.\n用法: "设为当前企业" "进入改造" "查看融资" 三个按钮.\n后果: 点对应按钮直接进入对应工作台.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // reform — 改造工作台
  // 前因: 企业进入 FinTrust Hub 第一件事是"8 维评分卡改造", 否则融资流程被锁
  // 后果: 8 维全部达标后, 融资入口解锁, 可以进入融资流程
  // ============================================================================
  reform: [
    {
      target: '.app-header',
      title: '改造工作台',
      content:
        '前因: FinTrust Hub 设计哲学是"先稳固基础再攀登高峰", 企业必须先完成 8 维评分卡改造, 把信任分提上来, 才能去融资.\n后果: 改造完成后融资入口解锁, 否则访问 /financing 会被强制跳回这里.',
      placement: 'bottom',
    },
    {
      target: '.el-steps',
      title: '改造阶段进度',
      content:
        '前因: 改造不是一蹴而就, 拆成 5 个阶段让顾问按步推进, 每阶段都有可交付物.\n用法: 看当前在哪一阶段, 点对应卡片展开任务清单.\n后果: 阶段全部 completed, 整体改造状态变 completed, 融资入口解锁.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.el-card',
      title: '8 维评分卡',
      content:
        '前因: 银行/担保看企业不是凭感觉, 是看 8 个维度评分 (财务/经营/资信/合规/管理/技术/生态/创新).\n用法: 看哪些维度分数低 (红色), 优先补这些维度的材料.\n后果: 8 维全部 ≥ 60 分, 改造完成, 解锁融资.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '推进改造按钮',
      content:
        '前因: 每个改造任务有"提交材料/标记完成"动作, 需要明确 CTA.\n用法: 上传证明材料后点这个按钮提交.\n后果: 提交后该任务状态变 completed, 评分卡对应维度分数上升.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // financing — 融资流程
  // 前因: 企业改造完成后, 进入 15 步融资流程, 每步都是"是/否"判断
  // 后果: 走完 15 步, 资金到账, 进入还款监控
  // ============================================================================
  financing: [
    {
      target: '.app-header',
      title: '融资流程',
      content:
        '前因: 企业改造完成后要融资, 但融资流程复杂, 拆成 15 步让顾问每步只做"是/否"判断, 不让顾问做选择题.\n后果: 走完所有步骤, 资金到账, 企业进入还款监控期.',
      placement: 'bottom',
    },
    {
      target: '.el-steps',
      title: '15 步进度条',
      content:
        '前因: 融资流程太长, 必须有进度条让顾问知道走到哪了, 还剩多少.\n用法: 看当前步骤, 点已完成步骤可以回看历史.\n后果: 当前步骤完成后自动跳下一步, 不能跳过未完成步骤.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.el-card',
      title: '当前步骤卡片',
      content:
        '前因: 每个步骤需要展示"做什么/需要什么材料/系统判断/人工拍板"四要素.\n用法: 系统已替你做了 90% 判断, 你只需看决策依据后点"通过"或"退回".\n后果: 通过则跳下一步, 退回则回到上一步补充材料.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '决策按钮',
      content:
        '前因: 不可逆决策 (放款/签合同) 必须有显眼 CTA, 且要求二次确认.\n用法: 看完决策依据后点这个按钮.\n后果: 关键步骤会弹模态窗二次确认, 确认后不可撤回.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // bank — 银行工作台
  // 前因: 银行端需要看企业信任阶段、决策日志、风险提示函
  // 后果: 银行审批通过后, 资金从银行出, 进入放款环节
  // ============================================================================
  bank: [
    {
      target: '.app-header',
      title: '银行工作台',
      content:
        '前因: FinTrust Hub 不替代银行核心, 只给银行一个"信任枢纽视图", 让银行顾问快速做决策.\n后果: 银行在这里审批/调整授信/冻结监管账户, 决策回流到企业融资流程.',
      placement: 'bottom',
    },
    {
      target: '.header-card',
      title: '信任阶段卡片',
      content:
        '前因: 银行把企业分 5 个信任阶段 (cold/warm/trusted/prime/vip), 阶段越高授信越大.\n用法: 看当前企业在哪个阶段, 解锁了哪些额度.\n后果: 阶段由企业改造评分驱动, 顾问无法直接调阶段, 只能调授信乘数.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.header-actions',
      title: '银行可交互面板',
      content:
        '前因: 银行顾问需要可操作面板 (调整授信乘数/冻结/解冻监管账户), 不能只看不能动.\n用法: 调整乘数会影响该企业的可放款额度.\n后果: 调整后企业融资流程的"银行预审"步骤会感知到新额度.',
      placement: 'bottom',
      fallback: '.el-button',
    },
    {
      target: '.decision-list',
      title: '决策日志列表',
      content:
        '前因: 银行决策必须有审计日志, 出问题要能追溯.\n用法: 每条日志显示决策时间/操作人/动作/前后值.\n后果: 日志上链不可篡改, 作为监管沙盒穿透报告的依据.',
      placement: 'top',
      fallback: '.el-card',
    },
  ],

  // ============================================================================
  // approval — 人工审批台
  // 前因: 系统已替你做了 90% 判断, 剩下 10% 关键决策需要人拍板
  // 后果: 审批通过流程继续, 拒绝则回到上一步补充材料
  // ============================================================================
  approval: [
    {
      target: '.app-header',
      title: '人工审批台',
      content:
        '前因: FinTrust Hub 的设计哲学是"AI 替人做苦力, 人做关键拍板", 系统已经替你做了 90% 的判断, 你只需要看决策详情后拍板.\n后果: 你的审批决策会回流到融资流程对应步骤, 推动流程继续.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '审批待办列表',
      content:
        '前因: 多个企业多笔融资可能同时需要你审批, 必须有列表视图.\n用法: 按紧急程度排序, 点开看决策详情.\n后果: 审批后该项从待办移除, 进入已处理列表.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '审批决策按钮',
      content:
        '前因: 不可逆决策必须二次确认, 避免误操作.\n用法: 看完决策详情 (路由原因/资金水位/监管账户余额) 后, 点"通过"或"退回".\n后果: 通过则流程继续, 退回则申请人收到补充材料通知.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // institution — 担保保险协作台
  // 前因: 企业融资金额较大, 银行可能要求担保/保险增信才肯放款
  // 后果: 担保/保险介入后, 企业融资通过率显著提升
  // ============================================================================
  institution: [
    {
      target: '.app-header',
      title: '担保保险协作台',
      content:
        '前因: 企业融资金额大时, 银行风险高不肯直接放款, 必须引入担保/保险做风险分担, 这就是担保保险协作台的由来.\n后果: 担保/保险受理后, 银行端审批通过率显著上升.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '待协同申请列表',
      content:
        '前因: 担保/保险机构需要看哪些企业在请求增信.\n用法: 按企业/金额/紧急度排序处理.\n后果: 受理后保单/担保函生成, 回流到融资流程的"增信"步骤.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '受理/拒绝按钮',
      content:
        '前因: 增信决策必须显式 CTA, 不能静默通过.\n用法: 看完企业画像与风险评估后, 点"受理"或"拒绝".\n后果: 成功/失败均弹 toast 通知并含跳转按钮, 重复点击提示"无需重复操作".',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // advisor — 财务顾问运营台
  // 前因: 财务顾问管理多个企业的融资进程, 需要全局视图
  // 后果: 跟进在途单, 关闭已完成单
  // ============================================================================
  advisor: [
    {
      target: '.app-header',
      title: '财务顾问运营台',
      content:
        '前因: 一个财务顾问同时管 5-20 家企业, 必须有运营台统一看待办/在途/异常, 否则漏单.\n后果: 这里是顾问的工作入口, 决定今天先做哪件事.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '在途融资单',
      content:
        '前因: 顾问要追踪每笔融资走到哪一步, 卡在哪一步.\n用法: 按状态筛选 (待启动/进行中/已放款/已拒绝).\n后果: 点单进入对应企业的融资流程, 推进下一步.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '快速操作按钮',
      content:
        '前因: 高频动作 (催办/补充材料/联系客户) 要一键触发.\n用法: 点对应按钮触发动作, 不需要进企业详情再操作.\n后果: 动作记录回流到企业融资流程的步骤备注.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // cockpit — AI 驾驶舱
  // 前因: 用 AI 替顾问做趋势分析、风险预警、智能推荐
  // 后果: 看 AI 建议后决定是否调整策略
  // ============================================================================
  cockpit: [
    {
      target: '.app-header',
      title: 'AI 驾驶舱',
      content:
        '前因: 大量数据光看数字看不出趋势, 需要 AI 帮顾问解读"涨了还是跌了/要不要紧/怎么办", 这就是驾驶舱存在的意义.\n后果: 看 AI 建议后决定是否调整策略, 建议可一键采纳跳到对应工作台.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: 'AI 趋势分析',
      content:
        '前因: 单看 KPI 数字看不出趋势, AI 用历史数据预测下个季度走势.\n用法: 看红色预警项, 点"查看详情"看 AI 推理过程.\n后果: 采纳建议后跳到对应工作台执行.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '采纳建议按钮',
      content:
        '前因: AI 建议必须能一键落地, 不能让顾问看完还要手动跳转.\n用法: 看完建议后点"采纳并跳转".\n后果: 跳到对应工作台, 建议内容预填到操作面板.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // fallback — 独立兜底引擎
  // 前因: project_memory 硬约束"零机构接入时仍能独立运行", 没有银行也能跑流程
  // 后果: 兜底引擎替你模拟银行/担保决策, 让流程跑通
  // ============================================================================
  fallback: [
    {
      target: '.app-header',
      title: '独立兜底引擎',
      content:
        '前因: 项目设计哲学是"零机构接入时仍能为企业提供独立价值", 没有银行 API 接入也能跑通融资流程, 这就是兜底引擎存在的意义.\n后果: 兜底引擎替你模拟机构决策, 流程能跑通, 等真实机构接入后无缝切换.',
      placement: 'bottom',
    },
    {
      target: '.el-steps',
      title: '降级流程进度',
      content:
        '前因: 兜底也要按步骤走, 不能让顾问感觉"系统在乱跑".\n用法: 看当前降级到哪一步 (规则匹配/模拟决策/占位提示).\n后果: 真实机构接入后, 这些降级步骤会被真实 API 替换.',
      placement: 'bottom',
      fallback: '.el-card',
    },
    {
      target: '.el-card',
      title: '降级日志面板',
      content:
        '前因: 兜底决策必须有日志, 否则机构接入后无法对账.\n用法: 每条日志含 8 位哈希指纹 + Merkle 根指纹, 实时更新.\n后果: 日志作为后续机构接入时的对账依据, 不可篡改.',
      placement: 'right',
    },
  ],

  // ============================================================================
  // regulatory — 监管沙盒
  // 前因: 合规要求"先沙盒试错再生产", 避免违规直接上线
  // 后果: 沙盒跑通后才上生产
  // ============================================================================
  regulatory: [
    {
      target: '.app-header',
      title: '监管沙盒',
      content:
        '前因: 金融业务必须合规, 但创新又要试错, 监管沙盒就是"受控的试错环境", 让你在沙盒里跑通再去生产.\n后果: 沙盒跑通生成穿透报告, 报告合规后才能上生产.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '沙盒告警面板',
      content:
        '前因: 沙盒运行中可能出现可疑交易, 必须有告警面板.\n用法: 看到红色告警点"处理"跳到详情.\n后果: 处理完告警生成穿透报告, 报告归档备查.\n若沙盒无告警, 这里会显示"触发可疑交易"按钮以保证链路自包含.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '生成穿透报告',
      content:
        '前因: 监管要求每次沙盒运行必须出穿透报告, 不能跑完没记录.\n用法: 点这个按钮触发报告生成 (非阻塞 toast 通知).\n后果: 报告生成完成后, 在 Tab8 列表里以卡片形式待审阅.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ============================================================================
  // partner — 关联机构门户
  // 前因: 担保/保险/评估/法律/审计等机构作为生态伙伴接入
  // 后果: 伙伴收到协同请求后处理, 处理结果回流到企业流程
  // ============================================================================
  partner: [
    {
      target: '.app-header',
      title: '关联机构门户',
      content:
        '前因: 融资流程不止银行一家, 还需要担保/保险/评估/法律/审计等机构协同, 这些机构在这里收协同请求.\n后果: 伙伴处理结果回流到企业融资流程对应步骤.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '协同请求列表',
      content:
        '前因: 机构需要看哪些企业在请求协同服务, 按紧急度处理.\n用法: 按类型筛选 (担保/保险/评估/法律), 点开处理.\n后果: 处理完成后回流到企业融资流程, 推进对应步骤.',
      placement: 'right',
    },
  ],

  // ============================================================================
  // scf — 供应链金融工作台
  // 前因: 企业有上下游应收应付, 可以基于供应链做融资
  // 后果: 基于画像和关系图谱, 匹配合适的 SCF 产品
  // ============================================================================
  scf: [
    {
      target: '.app-header',
      title: '供应链金融工作台',
      content:
        '前因: 企业不止自己融资, 还可以基于上下游应收应付做供应链金融 (SCF), 这是 FinTrust Hub 的差异化能力.\n后果: 基于 13 维画像和关系图谱, 匹配合适的 SCF 产品, 推进保理融资.',
      placement: 'bottom',
    },
    {
      target: '.engine-col',
      title: 'SCF 引擎状态',
      content:
        '前因: SCF 引擎需要先初始化才能跑场景, 必须有状态显示.\n用法: 看引擎是否 ready, 不 ready 时点"启动引擎".\n后果: 引擎启动后才能用场景预设和定价计算器.',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.scenario-card',
      title: '场景预设区',
      content:
        '前因: SCF 场景复杂 (保理/反向保票/仓单质押等), 做成预设按钮避免顾问记不住.\n用法: 点对应场景预设快速进入配置.\n后果: 选定场景后, 13 维画像和关系图谱自动加载到该场景.',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.pricing-result',
      title: '定价计算器',
      content:
        '前因: SCF 定价要根据融资金额/账期/对手方信用动态算, 不能拍脑袋.\n用法: 填表单后点"计算定价"按钮, 结果显示在此区域.\n后果: 计算结果 (LPR + 风险溢价 - 担保抵扣) 作为融资流程"SCF 定价"步骤的输入.',
      placement: 'top',
      fallback: '.el-form',
    },
  ],

  // ============================================================================
  // ECO-01 ~ ECO-09 — 9 个增强模块
  // 共同前因: 核心流程跑通后, 用 ECO 模块做差异化能力 (护城河)
  // 共同后果: ECO 模块独立于核心流程, 不接入也能跑, 接入了能力更强
  // ============================================================================

  // ECO-01 阅后即焚
  'eco-burn': [
    {
      target: '.app-header',
      title: 'ECO-01 阅后即焚',
      content:
        '前因: 企业敏感数据 (流水/合同/发票) 用于评估后必须销毁, 符合数据最小化原则, 也让企业敢把数据交出来.\n后果: 三遍覆写销毁 + 弱引用终结 + 链上哈希留底, 销毁后原始数据不可恢复, 但可验证曾经存在.',
      placement: 'bottom',
    },
    {
      target: '.burn-progress',
      title: '诊断阶段进度',
      content:
        '前因: 阅后即焚不是简单删除, 是先诊断再销毁的完整流程.\n用法: 看当前在 loading/portrait/gap_analysis/finalizing/destroying 哪个阶段.\n后果: destroyed 阶段完成后, 数据永久消失, 只留哈希指纹.',
      placement: 'bottom',
      fallback: '.el-steps',
    },
    {
      target: '.action-buttons',
      title: '销毁触发按钮',
      content:
        '前因: 销毁是不可逆操作, 必须有显眼的红色按钮 + 二次确认.\n用法: 看完诊断报告后, 确认无误点其中的红色"物理销毁"按钮.\n后果: 三遍覆写 + Redis 清空 + 弱引用终结, 链上记录销毁证据.',
      placement: 'top',
      fallback: '.el-button--danger',
    },
  ],

  // ECO-02 阶梯定价
  'eco-pricing': [
    {
      target: '.app-header',
      title: 'ECO-02 阶梯定价',
      content:
        '前因: 融资成本不能一刀切, 改造难度高的企业应付更多, 但通过改造可以降档, 这就是阶梯定价的激励设计.\n后果: 难度档位 (green/yellow/orange/r5_lite) 决定费率, 企业改造越好费率越低.',
      placement: 'bottom',
    },
    {
      target: '.el-form',
      title: '定价输入表单',
      content:
        '前因: 定价要根据融资金额/原利率/达成利率/期限/难度 5 个变量算.\n用法: 填完 5 个字段后点"计算".\n后果: 计算结果作为融资流程"定价"步骤的输入, 不可手动覆盖.',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.el-button--primary',
      title: '计算按钮',
      content:
        '前因: 定价计算必须显式触发, 不能填完自动算 (避免误操作).\n用法: 填完表单点这个按钮.\n后果: 显示阶梯定价结果 (settlement 费率/分润), 结果可一键应用到融资流程.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-03 无接口适配器
  'eco-rpa': [
    {
      target: '.app-header',
      title: 'ECO-03 无接口适配器',
      content:
        '前因: 很多机构 (银行/税务/工商) 没 API 或 API 不全, 但有 Excel/网页/PDF, 用 RPA 桥接避免人工录入.\n后果: RPA 抓取的数据自动入流, 替代人工录入, 后续机构上 API 后无缝切换.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: 'RPA 任务列表',
      content:
        '前因: 多个 RPA 任务并行运行, 必须有列表看进度.\n用法: 看每个任务状态 (待启动/运行中/已完成/失败), 失败任务可重跑.\n后果: 任务完成后数据回流到对应业务字段.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '生成申请材料',
      content:
        '前因: RPA 不止抓数据, 还能生成申请材料 (融资申请表/资信报告).\n用法: 选定企业和融资场景后, 点这个按钮生成.\n后果: 生成材料后, 回流到融资流程的"材料准备"步骤.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-04 联盟链凭证
  'eco-credential': [
    {
      target: '.app-header',
      title: 'ECO-04 联盟链凭证',
      content:
        '前因: 企业改造成果需要可验证的链上凭证, 让下游银行/担保信任, 不能只靠口头证明.\n后果: 链上凭证让企业能"携带信任"跨机构流转, 减少重复尽调.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '企业凭证列表',
      content:
        '前因: 一个企业可能有多个凭证 (改造完成证/资信证/合规证), 必须有列表管理.\n用法: 看每个凭证的状态 (待签发/已签发/已撤销/已过期).\n后果: 凭证签发后, 银行/担保可在自己的工作台验证.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '签发凭证',
      content:
        '前因: 凭证签发是上链动作, 必须显式触发.\n用法: 看完凭证内容 (持有者/有效期/声明) 后点签发.\n后果: 上链后凭证不可篡改, 进入企业凭证列表.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-05 反向竞拍
  'eco-bid': [
    {
      target: '.app-header',
      title: 'ECO-05 反向竞拍',
      content:
        '前因: 资金方多家竞争时, 让企业选最优报价, 这就是反向竞拍——不是企业求银行, 是银行竞争给企业最低利率.\n后果: 竞拍结束后, 中标资金方的报价自动应用到融资流程.',
      placement: 'bottom',
    },
    {
      target: '.el-table',
      title: '竞拍大厅列表',
      content:
        '前因: 多个企业同时在竞拍, 顾问要看全局.\n用法: 看每个竞拍的状态 (待开始/进行中/已结束), 点行进入详情.\n后果: 进入详情后看各资金方报价, 选最优中标.',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.el-button--primary',
      title: '发起竞拍',
      content:
        '前因: 企业可以主动发起竞拍, 不等银行来问.\n用法: 填融资金额/期限/最低可接受利率后发起.\n后果: 竞拍进入大厅, 资金方收到通知来报价, 倒计时结束后选最低价中标.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-06 积分商城
  'eco-pts': [
    {
      target: '.app-header',
      title: 'ECO-06 积分商城',
      content:
        '前因: 企业贡献数据/完成行为可以"挖矿"积累积分, 积分兑换权益 (费率折扣/服务升级), 这是激励设计.\n后果: 积分消耗后, 对应权益生效, 如费率下降 0.5%.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '商城商品列表',
      content:
        '前因: 权益要可量化可兑换, 不能是模糊承诺.\n用法: 看每个权益的积分价格, 点兑换.\n后果: 兑换后积分扣除, 权益自动应用到企业融资流程.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '兑换按钮',
      content:
        '前因: 兑换是显式动作, 不能自动触发.\n用法: 看完权益详情后点兑换, 二次确认.\n后果: 积分不足时弹 toast 提示, 充足时权益立即生效.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-07 行业指数
  'eco-index': [
    {
      target: '.app-header',
      title: 'ECO-07 行业合规指数',
      content:
        '前因: 单个企业数据有限, 行业聚合指数提供基准, 让企业知道自己在行业里排第几.\n后果: 指数帮企业自评定位, 也帮银行做行业风险判断.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '指数图表区',
      content:
        '前因: 数字看不出趋势, 必须可视化.\n用法: 看本企业指数 vs 行业均值/中位数, 看历史走势.\n后果: 指数低于行业均值时, 建议优先改造对应维度.',
      placement: 'right',
    },
  ],

  // ECO-08 政府背书
  'eco-gov': [
    {
      target: '.app-header',
      title: 'ECO-08 政府背书',
      content:
        '前因: 政府担保/贴息能让融资成本大降, 这是中小微企业融资的关键政策红利.\n后果: 拿到政府背书后, 费率显著下降, 银行更愿意放款.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '可申请政策列表',
      content:
        '前因: 政府政策多, 企业不知道自己符合哪个, 必须有列表匹配.\n用法: 看每个政策的申请条件, 符合的点申请.\n后果: 申请通过后, 背书自动应用到融资流程的"政府增信"步骤.',
      placement: 'right',
    },
    {
      target: '.el-button--primary',
      title: '申请背书',
      content:
        '前因: 申请是显式动作, 不能自动匹配.\n用法: 看完政策条件后点申请, 上传必要材料.\n后果: 审批通过后背书生效, 费率折扣自动应用到阶梯定价.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],

  // ECO-09 数字分身
  'eco-bot': [
    {
      target: '.app-header',
      title: 'ECO-09 数字分身',
      content:
        '前因: 老板看不懂报表, 需要一个 AI 数字分身用老板能听懂的话解释, 不替老板做决策只给信息和选项.\n后果: 老板用自然语言提问, AI 给信息和选项, 老板拍板后回流到顾问工作台.',
      placement: 'bottom',
    },
    {
      target: '.chat-window',
      title: '对话区',
      content:
        '前因: 老板不喜欢看表格, 喜欢对话式交互, AI 用场景类比解释专业术语.\n用法: 在输入框输入问题, 如"改造进度怎么样了" "我的信用分多少", 回车或点发送.\n后果: 命中关键词的问题秒回, 复杂问题调 DeepSeek 生成回答 (有熔断/降级兜底).',
      placement: 'right',
      fallback: '.el-card',
    },
    {
      target: '.quick-cmd',
      title: '快捷指令',
      content:
        '前因: 老板可能不知道问什么, 提供快捷指令按钮降低使用门槛.\n用法: 点按钮触发预设问题.\n后果: AI 回答后, 给出"采纳并跳转"按钮, 一键跳到对应工作台执行.',
      placement: 'top',
      fallback: '.el-button--primary',
    },
  ],

  // ============================================================================
  // glossary — 金融词典
  // 前因: 财务顾问/企业老板不懂金融术语, 需要随时查
  // 后果: 查词典理解术语后再做决策
  // ============================================================================
  glossary: [
    {
      target: '.app-header',
      title: '金融词典',
      content:
        '前因: 财务顾问/企业老板不一定懂所有金融术语, 必须有随时可查的词典, 不能让用户因术语卡住.\n后果: 查完术语理解后, 回到原页面继续做决策.',
      placement: 'bottom',
    },
    {
      target: '.el-input',
      title: '搜索框',
      content:
        '前因: 词典条目多, 必须支持搜索.\n用法: 输入术语名或关键词, 实时筛选.\n后果: 看到匹配条目后, 点开看详细解释 + 场景例句.',
      placement: 'bottom',
      fallback: '.el-card',
    },
  ],

  // ============================================================================
  // about — 关于页
  // 前因: 用户需要了解系统定位、版本、技术栈, 知道系统能做什么不能做什么
  // 后果: 看完后对系统能力边界有清晰预期
  // ============================================================================
  about: [
    {
      target: '.app-header',
      title: '关于 FinTrust Hub',
      content:
        '前因: 用户在用系统前必须知道系统定位 (财务顾问公司的整合平台+AI 信任枢纽, 不替代银行/担保/保险核心), 否则会有错误预期.\n后果: 看完后知道系统能做什么不能做什么, 后续使用更顺.',
      placement: 'bottom',
    },
    {
      target: '.el-card',
      title: '系统信息卡片',
      content:
        '前因: 用户可能需要知道当前版本号反馈 bug 或查询功能.\n用法: 看版本号/构建时间/技术栈.\n后果: 反馈 bug 时附版本号, 便于排查.',
      placement: 'right',
    },
  ],

  // ============================================================================
  // not-found — 404 兜底
  // 前因: 用户访问了不存在的页面 (书签过期/手输错地址)
  // 后果: 返回工作台首页或后退
  // ============================================================================
  'not-found': [
    {
      target: '.app-header',
      title: '页面不存在',
      content:
        '前因: 你访问的页面不存在, 可能是书签过期/手动输错了地址/权限不足被重定向.\n后果: 点下面的按钮回工作台首页, 或按浏览器后退.',
      placement: 'bottom',
    },
    {
      target: '.el-button--primary',
      title: '返回首页按钮',
      content:
        '前因: 404 页必须给用户一个明确的"逃生通道", 不能让人卡死.\n用法: 点这个按钮回工作台首页.\n后果: 跳回首页, 可以重新开始导航.',
      placement: 'top',
      fallback: '.el-button',
    },
  ],
};

export function useCoachMark() {
  const currentStep = computed<CoachStep | null>(
    () => steps.value[currentStepIndex.value] ?? null,
  );

  const total = computed(() => steps.value.length);
  const isFirst = computed(() => currentStepIndex.value === 0);
  const isLast = computed(() => currentStepIndex.value >= steps.value.length - 1);

  function getTourForRoute(routeName: string | symbol | undefined): CoachStep[] {
    const key = String(routeName ?? '');
    return DEFAULT_TOUR_MAP[key] ?? [];
  }

  function isRouteCompleted(routeName: string | symbol | undefined): boolean {
    const key = String(routeName ?? '');
    return completedRoutes.has(key);
  }

  function markRouteCompleted(routeName: string | symbol | undefined): void {
    const key = String(routeName ?? '');
    if (!key) return;
    completedRoutes.add(key);
    writeCompletedRoutes(completedRoutes);
  }

  function clearAllCompleted(): void {
    completedRoutes.clear();
    writeCompletedRoutes(completedRoutes);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * 启动一个引导 tour.
   * @param tourSteps 引导步骤数组
   */
  function startTour(tourSteps: CoachStep[]): void {
    if (!tourSteps || tourSteps.length === 0) return;
    steps.value = [...tourSteps];
    currentStepIndex.value = 0;
    visible.value = true;
  }

  /**
   * 启动当前路由的默认引导.
   * 已完成且非 force 时给出提示 (调用方决定是否 ElMessage).
   * @returns true 表示成功启动, false 表示无默认 tour 或已完成.
   */
  function startTourForRoute(
    routeName: string | symbol | undefined,
    opts: { force?: boolean } = {},
  ): boolean {
    const tour = getTourForRoute(routeName);
    if (tour.length === 0) return false;
    if (!opts.force && isRouteCompleted(routeName)) {
      // 已完成, 调用方可提示, 这里不重复弹
      return false;
    }
    startTour(tour);
    return true;
  }

  function next(): void {
    if (currentStepIndex.value < steps.value.length - 1) {
      currentStepIndex.value += 1;
    }
  }

  function prev(): void {
    if (currentStepIndex.value > 0) {
      currentStepIndex.value -= 1;
    }
  }

  function jumpTo(index: number): void {
    if (index >= 0 && index < steps.value.length) {
      currentStepIndex.value = index;
    }
  }

  /** 完成引导 (走到最后) */
  function complete(routeName?: string | symbol | undefined): void {
    visible.value = false;
    if (routeName) markRouteCompleted(routeName);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }

  /** 跳过 (用户主动放弃) */
  function skip(): void {
    visible.value = false;
  }

  /** 关闭 (点击遮罩或 ESC) */
  function close(): void {
    visible.value = false;
  }

  // === F1 快捷键绑定 (CORE-04) ===
  // 全局监听 F1 键, 触发当前路由的引导 tour
  // 已挂载的 keydown handler 引用, 便于解绑
  let f1Handler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * 绑定 F1 快捷键到当前路由的引导 tour.
   * 应在 App.vue setup 顶层调用一次.
   *
   * @param getRouteName 路由名获取函数 (传入 useRoute().name 的 getter, 避免循环依赖)
   * @param opts.onNoTour 当路由未配置引导时的回调 (调用方决定 ElMessage 提示)
   * @returns 解绑函数 (组件卸载时调用)
   *
   * 设计哲学 (project_memory 傻瓜式操作):
   *   - 用户不知道菜单在哪, 不知道功能怎么用, 但 F1 是约定俗成的"求助"键
   *   - 任何页面按 F1, 当前页面关键元素依次弹出气泡说明
   *   - 已完成的路由默认不再自动弹, 但 F1 主动触发时 force=true 让用户随时复习
   *   - 输入框聚焦时不拦截, 避免和浏览器原生 F1 帮助冲突
   *   - 引导显示中按 F1 关闭 (与 ESC 同效)
   */
  function bindF1Shortcut(
    getRouteName: () => string | symbol | undefined,
    opts: { onNoTour?: () => void } = {},
  ): () => void {
    // 避免重复绑定
    if (f1Handler) {
      window.removeEventListener('keydown', f1Handler);
    }

    f1Handler = (e: KeyboardEvent) => {
      // F1 键 code = 'F1', keyCode = 112
      if (e.key !== 'F1' && e.keyCode !== 112) return;
      // 输入框聚焦时不拦截 (避免和浏览器帮助冲突)
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      // 引导显示中按 F1 关闭 (与 ESC 同效)
      if (visible.value) {
        close();
        return;
      }
      const routeName = getRouteName();
      const tour = getTourForRoute(routeName);
      if (tour.length === 0) {
        opts.onNoTour?.();
        return;
      }
      // F1 主动触发时, force=true (用户主动求助, 即便已看过也允许复习)
      startTourForRoute(routeName, { force: true });
    };

    window.addEventListener('keydown', f1Handler);

    return () => {
      if (f1Handler) {
        window.removeEventListener('keydown', f1Handler);
        f1Handler = null;
      }
    };
  }

  return {
    // state
    visible,
    steps,
    currentStepIndex,
    // getters
    currentStep,
    total,
    isFirst,
    isLast,
    // actions
    startTour,
    startTourForRoute,
    getTourForRoute,
    next,
    prev,
    jumpTo,
    complete,
    skip,
    close,
    isRouteCompleted,
    markRouteCompleted,
    clearAllCompleted,
    // F1 快捷键
    bindF1Shortcut,
  };
}
