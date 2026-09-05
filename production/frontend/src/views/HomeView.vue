<template>
  <div class="home-view">
    <!-- ========== 多端门户入口 (前因: 用户进系统不知道"我是谁", 顶部 5 张大卡片做身份分流) ========== -->
    <el-card shadow="never" class="portal-entry">
      <template #header>
        <div class="portal-header">
          <span>🚪 我是谁? 请选择你的身份进入对应端</span>
          <span class="portal-hint">点卡片即跳转, 不知道选哪个就选「我是财务顾问」</span>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col
          v-for="portal in portals"
          :key="portal.key"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
          :xl="5"
          class="portal-col"
        >
          <el-card
            shadow="hover"
            :class="['portal-card', `portal-${portal.theme}`]"
            @click="onPortalClick(portal)"
          >
            <div class="portal-content">
              <el-icon :size="40" :color="portal.color">
                <component :is="portal.icon" />
              </el-icon>
              <div class="portal-info">
                <div class="portal-title">{{ portal.title }}</div>
                <div class="portal-desc">{{ portal.desc }}</div>
              </div>
            </div>
            <div class="portal-cta">
              <el-button type="primary" size="small" plain>
                {{ portal.cta }} →
              </el-button>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 卡片下方业务场景说明区 (前因后果: 解释每个身份对应的核心业务场景) -->
      <el-divider content-position="left">
        <span class="scene-title">📋 各身份业务场景说明</span>
      </el-divider>
      <el-row :gutter="12">
        <el-col
          v-for="portal in portals"
          :key="portal.key"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
          :xl="5"
          class="portal-col"
        >
          <el-card shadow="never" class="scene-card">
            <div class="scene-head">
              <el-icon :size="18" :color="portal.color"><component :is="portal.icon" /></el-icon>
              <span class="scene-name">{{ portal.title }}</span>
            </div>
            <div class="scene-body">
              <p v-for="(line, i) in portal.scenes" :key="i" class="scene-line">{{ line }}</p>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="6" v-for="card in statCards" :key="card.key">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <el-icon :size="32" :color="card.color"><component :is="card.icon" /></el-icon>
            <div class="stat-info">
              <div class="stat-label">{{ card.label }}</div>
              <div class="stat-value">{{ card.value }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="quick-entry" header="🚀 快速入口">
      <el-row :gutter="16">
        <el-col :span="6" v-for="entry in quickEntries" :key="entry.path">
          <el-button type="primary" plain class="entry-btn" @click="$router.push(entry.path)">
            <el-icon><component :is="entry.icon" /></el-icon>
            <span>{{ entry.label }}</span>
          </el-button>
        </el-col>
      </el-row>
    </el-card>

    <!-- ========== 业务流程指引 (线性链路 + AI 提示当前该做哪一步) ========== -->
    <el-card class="flow-guide" shadow="never">
      <template #header>
        <div class="flow-guide-head">
          <span class="flow-guide-title">🧭 业务流程指引</span>
          <el-tag type="success" effect="light" round>{{ flowGuide.hint }}</el-tag>
        </div>
      </template>
      <el-steps :active="flowGuide.activeStep" align-center finish-status="success" class="flow-steps">
        <el-step
          v-for="(step, idx) in flowSteps"
          :key="step.path"
          :title="step.title"
          :status="idx === flowGuide.activeStep ? 'process' : undefined"
        >
          <template #description>
            <div class="flow-step-desc">
              <span>{{ step.desc }}</span>
              <el-button
                v-if="idx === flowGuide.activeStep"
                type="primary"
                size="small"
                round
                class="flow-next-btn"
                @click="$router.push(step.path)"
              >
                {{ step.cta }} →
              </el-button>
              <el-button
                v-else
                link
                type="info"
                size="small"
                @click="$router.push(step.path)"
              >
                进入
              </el-button>
            </div>
          </template>
        </el-step>
      </el-steps>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card header="📋 当前企业改造进度">
          <template v-if="enterpriseStore.currentEnterprise">
            <p>企业: <strong>{{ enterpriseStore.currentEnterprise.name }}</strong></p>
            <p>信用分: <strong>{{ enterpriseStore.currentEnterprise.runtime.creditScore }}</strong></p>
            <el-progress
              :percentage="reformStore.progressPercent"
              :status="reformStore.isReady ? 'success' : undefined"
            />
            <p class="hint">
              改造状态: {{ reformStore.state?.status || '未启动' }} ·
              当前等级: {{ reformStore.currentLevel }} → 目标: {{ reformStore.targetLevel }}
            </p>
          </template>
          <el-empty v-else description="请先选择企业" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card header="📊 ECO 模块状态">
          <el-table :data="ecoStatus" size="small">
            <el-table-column prop="code" label="模块" width="100" />
            <el-table-column prop="name" label="名称" />
            <el-table-column prop="status" label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.statusType" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  Odometer, OfficeBuilding, Money, Bell,
  Tools, Wallet, ChatLineRound,
  UserFilled, CreditCard, Lock, Iphone,
} from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';
import { useAlertStore } from '@/stores/alertStore';
import { useScfStore } from '@/stores/scf';
import { isMobileDevice } from '@/composables/useDevice';

defineOptions({ name: 'HomeView' });

const router = useRouter();
const enterpriseStore = useEnterpriseStore();
const reformStore = useReformStore();
const alertStore = useAlertStore();
const scfStore = useScfStore();

// ========== 业务流程指引 (线性 5 步, 系统直接告诉用户"下一步点哪") ==========
interface FlowStep {
  title: string;
  desc: string;
  cta: string;
  path: string;
}

const flowSteps: FlowStep[] = [
  { title: '① 选企业', desc: '从企业列表选择要服务的企业', cta: '去选企业', path: '/enterprise' },
  { title: '② 改造工作台', desc: 'AI 全景画像 → 诊断 → 解锁融资入口', cta: '去改造', path: '/reform' },
  { title: '③ 融资流程', desc: '改造达标后提交融资申请', cta: '去融资', path: '/financing' },
  { title: '④ 人工审批台', desc: 'AI 建议 + 人工决策 (批准/退回)', cta: '去审批', path: '/approval' },
  { title: '⑤ 银行工作台', desc: '银行端授信/放款处理', cta: '去银行端', path: '/bank' },
];

// 根据当前状态计算"该做哪一步", 傻瓜式引导
const flowGuide = computed(() => {
  const hasEnterprise = !!enterpriseStore.currentEnterprise;
  const reformStatus = reformStore.state?.status;
  const reformDone = reformStore.isReady;

  if (!hasEnterprise) {
    return { activeStep: 0, hint: '👇 先选择一家企业开始' };
  }
  if (reformStatus === 'in_progress') {
    return { activeStep: 1, hint: '改造进行中, 去工作台看进度' };
  }
  if (!reformDone) {
    return { activeStep: 1, hint: '该企业尚未完成改造, 先做 AI 画像诊断' };
  }
  // 改造完成 → 融资解锁
  if (reformDone) {
    return { activeStep: 2, hint: '改造已达标, 融资入口已解锁, 去申请融资' };
  }
  return { activeStep: 0, hint: '👇 先选择一家企业开始' };
});

interface PortalEntry {
  key: string;
  title: string;
  desc: string;
  cta: string;
  path: string;
  icon: typeof OfficeBuilding;
  color: string;
  theme: string;
  isExternal?: boolean;
  /** 业务场景说明 (前因后果), 每条一行 */
  scenes: string[];
}

const portals: PortalEntry[] = [
  {
    key: 'advisor',
    title: '我是财务顾问',
    desc: '管理多家企业, 启动改造, 发起融资, 看驾驶舱',
    cta: '进入顾问运营台',
    path: '/advisor',
    icon: UserFilled,
    color: '#3b82f6',
    theme: 'blue',
    scenes: [
      '前因: 你是 FinTrust Hub 的运营主体, 一对多服务多家企业.',
      '核心场景: 给新企业跑 R0→R7 改造 8 阶段, 拉企业画像/差距诊断/方案生成.',
      '高频操作: 在「企业列表」选企业 →「改造工作台」启动 → 改造完了解锁融资.',
      '后果: 你做的每一步都会写入企业责任链 + 哈希指纹, 监管可追溯.',
    ],
  },
  {
    key: 'enterprise',
    title: '我是企业老板',
    desc: '看自己企业的改造进度/信用分/融资单, 跟 AI 数字分身对话',
    cta: '进入企业端',
    path: '/portal/enterprise',
    icon: OfficeBuilding,
    color: '#10b981',
    theme: 'green',
    scenes: [
      '前因: 老板看不懂报表, 需要一个"我的企业仪表板"只看自己公司.',
      '核心场景: 一眼看到信用分/改造进度/融资单状态/资金水位.',
      '高频操作: 用 ECO-09 数字分身用自然语言提问「我的改造进度怎么样了」.',
      '后果: 老板拍板的融资申请回流到顾问工作台, 顾问代为对接银行.',
    ],
  },
  {
    key: 'bank',
    title: '我是银行客户经理',
    desc: '看客户企业的资金水位/监管账户/审批融资申请',
    cta: '进入银行工作台',
    path: '/bank',
    icon: CreditCard,
    color: '#8b5cf6',
    theme: 'purple',
    scenes: [
      '前因: 银行要看清楚企业改造前后的信用变化, 才敢放款.',
      '核心场景: 客户企业资金水位监控 / 监管账户余额 / 融资审批决策.',
      '高频操作: 在人工审批台看 AI 研判建议 → 二次确认 → 通过/拒绝.',
      '后果: 银行端不可逆决策保持阻塞模态窗, 防止误操作.',
    ],
  },
  {
    key: 'institution',
    title: '我是担保/保险公司',
    desc: '处理担保代偿/保险理赔申请, 协同核保核赔',
    cta: '进入担保保险协作台',
    path: '/institution',
    icon: Lock,
    color: '#f59e0b',
    theme: 'amber',
    scenes: [
      '前因: 中小企业融资需要担保/保险增信, 银行才肯放款.',
      '核心场景: 接收顾问转交的担保/保险申请 → 核保核赔 → 出保单.',
      '高频操作: 在 Tab5 处理 pending 状态的申请, 必须有明确可交互元素.',
      '后果: 担保/保险状态写回企业 runtime.guaranteeStatus/insuranceStatus.',
    ],
  },
  {
    key: 'worker',
    title: '我是工人 (手机端)',
    desc: '扫码确权/积分钱包/我的数字分身, 仅支持手机访问',
    cta: '查看移动端入口',
    path: '/m/login',
    icon: Iphone,
    color: '#ec4899',
    theme: 'pink',
    isExternal: true,
    scenes: [
      '前因: 工人在车间/工地, 不可能用 PC, 必须有手机 PWA 入口.',
      '核心场景: 扫码完成责任链节点确权 (N01-N12) → 攒积分 → 兑换商品.',
      '高频操作: 扫码确权是首要高频操作, /m 默认跳 /m/scan.',
      '后果: 确权数据写入责任链, 直接影响企业 creditCompleteness 指标.',
    ],
  },
];

function onPortalClick(p: PortalEntry) {
  // 移动端用户点 PC 端入口卡片 → 弹提示, 避免被路由守卫默默重定向到 /m/scan
  const isMobile = isMobileDevice();
  if (isMobile && !p.isExternal) {
    ElMessage.warning(
      `当前是移动端访问, 「${p.title}」入口请在 PC 浏览器打开 (将自动跳到移动端扫码页)`,
    );
    // 仍然让路由守卫接管, 守卫会重定向到 /m/scan
    router.push(p.path);
    return;
  }
  // PC 端用户点"我是工人"卡片 → 弹提示, 不跳转 (PC 访问 /m/* 会被守卫跳回 /)
  if (!isMobile && p.isExternal) {
    ElMessage.info('请在手机端浏览器/微信扫码访问 /m/ 入口, PC 端不开放移动工作流');
    return;
  }
  // 移动端 + 工人卡片 → 跳 /m/login (路由守卫允许)
  // PC 端 + PC 卡片 → 正常跳转
  router.push(p.path);
}

const statCards = computed(() => [
  { key: 'enterprises', label: '签约企业', value: enterpriseStore.enterprises.length, icon: OfficeBuilding, color: '#3b82f6' },
  { key: 'reforming', label: '改造中', value: reformStore.isInProgress ? 1 : 0, icon: Tools, color: '#f59e0b' },
  { key: 'financing', label: '融资撮合', value: scfStore.cases.length, icon: Money, color: '#10b981' },
  { key: 'alerts', label: '未读告警', value: alertStore.count, icon: Bell, color: '#ef4444' },
]);

const quickEntries = [
  { path: '/reform', label: '改造工作台', icon: Tools },
  { path: '/financing', label: '发起融资', icon: Money },
  { path: '/eco/burn', label: 'ECO-01 阅后即焚', icon: Wallet },
  { path: '/eco/bot', label: '数字分身', icon: ChatLineRound },
];

const ecoStatus = [
  { code: 'ECO-01', name: '阅后即焚零信任诊断', status: 'P0 待接入', statusType: 'info' as const },
  { code: 'ECO-02', name: '成果导向阶梯定价', status: 'P0 待接入', statusType: 'info' as const },
  { code: 'ECO-03', name: '无接口适配器', status: 'P1 待接入', statusType: 'info' as const },
  { code: 'ECO-04', name: '信用凭证联盟链', status: 'P1 待接入', statusType: 'info' as const },
  { code: 'ECO-05', name: '反向竞拍融资大厅', status: 'P2 待接入', statusType: 'info' as const },
  { code: 'ECO-06', name: '积分商城与行为挖矿', status: 'P1 待接入', statusType: 'info' as const },
  { code: 'ECO-07', name: 'FinTrust 企业合规指数', status: 'P2 待接入', statusType: 'info' as const },
  { code: 'ECO-08', name: '监管/政府背书催化剂', status: 'P1 待接入', statusType: 'info' as const },
  { code: 'ECO-09', name: '微信/钉钉数字分身', status: 'P2 待接入', statusType: 'info' as const },
];

onMounted(async () => {
  if (enterpriseStore.currentEnterpriseId && !reformStore.state) {
    await reformStore.loadReformState(enterpriseStore.currentEnterpriseId);
  }
  // 融资撮合案例库 (store 内部已 catch, 后端不可达时返回空数组, 不影响首页渲染)
  if (scfStore.cases.length === 0) {
    await scfStore.loadCases();
  }
});

void Odometer;
</script>

<style lang="scss" scoped>
.home-view {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;

  .portal-entry {
    .portal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .portal-hint {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }

    .portal-col {
      margin-bottom: 12px;
    }

    .portal-card {
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
      height: 100%;

      &:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }

      &.portal-blue { border-top: 3px solid #3b82f6; }
      &.portal-green { border-top: 3px solid #10b981; }
      &.portal-purple { border-top: 3px solid #8b5cf6; }
      &.portal-amber { border-top: 3px solid #f59e0b; }
      &.portal-pink { border-top: 3px solid #ec4899; }

      .portal-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;

        .portal-info {
          flex: 1;

          .portal-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--el-text-color-primary);
            margin-bottom: 4px;
          }

          .portal-desc {
            font-size: 12px;
            color: var(--el-text-color-secondary);
            line-height: 1.5;
          }
        }
      }

      .portal-cta {
        text-align: right;
      }
    }

    .scene-card {
      height: 100%;
      background: var(--el-fill-color-lighter);

      .scene-head {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--el-border-color);

        .scene-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }
      }

      .scene-body {
        .scene-line {
          font-size: 12px;
          line-height: 1.6;
          color: var(--el-text-color-regular);
          margin: 0 0 4px 0;

          &:last-child {
            margin-bottom: 0;
          }
        }
      }
    }

    .scene-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--el-text-color-secondary);
    }
  }

  .stat-card {
    .stat-content {
      display: flex;
      align-items: center;
      gap: $spacing-base;
    }

    .stat-info {
      .stat-label {
        color: $text-muted;
        font-size: $font-size-sm;
        margin-bottom: $spacing-xs;
      }

      .stat-value {
        font-size: $font-size-xxl;
        font-weight: 700;
        color: $text-primary;
      }
    }
  }

  .quick-entry {
    .entry-btn {
      width: 100%;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: $spacing-sm;
      font-size: $font-size-base;
    }
  }

  .flow-guide {
    margin-bottom: $spacing-lg;

    .flow-guide-head {
      display: flex;
      align-items: center;
      justify-content: space-between;

      .flow-guide-title {
        font-weight: 600;
        font-size: $font-size-lg;
      }
    }

    .flow-steps {
      padding: $spacing-base $spacing-sm 0;
    }

    .flow-step-desc {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: $text-muted;

      .flow-next-btn {
        margin-top: 4px;
        animation: flow-pulse 1.6s ease-in-out infinite;
      }
    }

    @keyframes flow-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.4); }
      50% { box-shadow: 0 0 0 6px rgba(64, 158, 255, 0); }
    }
  }

  .hint {
    margin-top: $spacing-sm;
    color: $text-muted;
    font-size: $font-size-sm;
  }
}
</style>
