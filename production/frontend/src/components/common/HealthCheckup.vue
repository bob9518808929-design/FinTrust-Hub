<!-- 文件名：HealthCheckup.vue 职责：企业健康体检仪,红绿灯+体检分数+异常项清单+改善建议,对标 A 档基线 -->
<template>
  <!--
    HealthCheckup.vue — 企业健康体检仪 (UX-01)
    设计: 类似人体体检报告 — 红绿灯 + 体检分数 + 异常项清单 + 改善建议.
    数据来自改造引擎 R2 差距诊断语义 (本地按标准分计算, 与后端 DEFAULT_SCORECARD_A 对齐).
    "傻瓜式": 不做选择题, 只做判断题; 红黄灯汇总 + 一键发起改造.
  -->
  <el-card class="health-checkup" shadow="never">
    <template #header>
      <div class="hc-header">
        <span>🏢 企业健康体检仪</span>
        <el-tag size="small" type="info" effect="plain">对标 A 档基线</el-tag>
      </div>
    </template>

    <div v-if="!scorecard" class="hc-empty">
      <el-empty description="暂无评分数据，请先完成全景画像 (R1)" :image-size="80" />
    </div>

    <div v-else class="hc-body">
      <!-- 1. 整体体检分数 -->
      <div class="hc-overall">
        <div class="hc-score-ring">
          <el-progress
            type="dashboard"
            :percentage="overallScore"
            :color="overallColor"
            :width="140"
            :stroke-width="10"
          >
            <template #default>
              <div class="hc-score-text">
                <span class="hc-score-num">{{ overallScore }}</span>
                <span class="hc-score-unit">分</span>
              </div>
              <span class="hc-score-label">{{ overallLevel }}</span>
            </template>
          </el-progress>
        </div>
        <div class="hc-summary">
          <h3>{{ overallVerdict.title }}</h3>
          <p>{{ overallVerdict.desc }}</p>
          <div class="hc-light-summary">
            <el-tag type="success" effect="dark" size="small">绿灯 {{ greenCount }}</el-tag>
            <el-tag type="warning" effect="dark" size="small">黄灯 {{ yellowCount }}</el-tag>
            <el-tag type="danger" effect="dark" size="small">红灯 {{ redCount }}</el-tag>
          </div>
        </div>
      </div>

      <!-- 2. 8 维分项红绿灯 -->
      <div class="hc-dims">
        <div class="hc-dims-title">8 维分项体检 (点击查看详情)</div>
        <div class="hc-dim-grid">
          <el-tooltip
            v-for="d in dimChecks"
            :key="d.key"
            placement="top"
            effect="dark"
          >
            <template #content>
              <div class="hc-tooltip">
                <div><b>{{ d.label }}</b></div>
                <div>当前: {{ d.current }} 分 | 标准: {{ d.standard }} 分</div>
                <div>差距: -{{ d.gap }} 分</div>
                <div class="hc-tip-suggest">{{ d.suggestion }}</div>
              </div>
            </template>
            <div class="hc-dim-chip" :class="`light-${d.light}`" @click="onDimClick(d)">
              <span class="hc-dot" :class="`dot-${d.light}`" />
              <span class="hc-dim-name">{{ d.label }}</span>
              <span class="hc-dim-score">{{ d.current }}</span>
            </div>
          </el-tooltip>
        </div>
      </div>

      <!-- 3. 异常项清单 (红灯 + 黄灯汇总) -->
      <div class="hc-abnormal">
        <div class="hc-abnormal-title">
          异常项清单 ({{ abnormalItems.length }} 项)
          <el-tooltip content="红灯=严重偏离标准，黄灯=轻度偏离，建议按序改善" placement="top" effect="dark">
            <el-icon class="hc-help"><InfoFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-table v-if="abnormalItems.length" :data="abnormalItems" size="small" stripe>
          <el-table-column label="维度" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.light === 'red' ? 'danger' : 'warning'" effect="dark">
                {{ row.label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="当前分" width="80" prop="current" />
          <el-table-column label="标准分" width="80" prop="standard" />
          <el-table-column label="差距" width="70">
            <template #default="{ row }">
              <span class="hc-gap">-{{ row.gap }}</span>
            </template>
          </el-table-column>
          <el-table-column label="改善建议 (白话文)" min-width="320">
            <template #default="{ row }">
              <span class="hc-suggest">{{ row.suggestion }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="体检全绿，企业健康度达标 🎉" :image-size="60" />
      </div>

      <!-- 4. 一键发起改造 -->
      <div class="hc-action">
        <el-button type="primary" size="large" @click="onStartReform">
          🛠 一键发起改造 (基于体检报告生成方案)
        </el-button>
        <span class="hc-action-tip">改造完成后融资入口自动解锁</span>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { InfoFilled } from '@element-plus/icons-vue';
import type { Scorecard8D } from '@contracts/scorecard';

/** 8 维度键类型 */
type DimKey = keyof Scorecard8D;

interface DimCheck {
  key: DimKey;
  label: string;
  current: number;
  standard: number;
  gap: number;
  light: 'green' | 'yellow' | 'red';
  suggestion: string;
}

const props = defineProps<{
  enterpriseId: string;
  scorecard?: Scorecard8D | null;
}>();

const emit = defineEmits<{
  (e: 'start-reform', enterpriseId: string): void;
  (e: 'dim-click', dim: DimKey): void;
}>();

/** 8 维标准分 (对标后端 DEFAULT_SCORECARD_A, A 档基线). */
const STANDARDS: Record<DimKey, number> = {
  subject: 85,
  finance: 82,
  tax: 88,
  business: 80,
  assets: 85,
  credit: 82,
  policy: 90,
  capital: 80,
};

/** 维度中文标签. */
const DIM_LABELS: Record<DimKey, string> = {
  subject: '主体',
  finance: '财务',
  tax: '税务',
  business: '业务',
  assets: '资产',
  credit: '信用',
  policy: '政策',
  capital: '资本',
};

/** 白话文改善建议 (按维度). */
const SUGGESTIONS: Record<DimKey, string> = {
  subject: '您的企业主体资质材料不够完整，建议补齐营业执照、法人信息、股权结构等基础证照，提升主体合规度',
  finance: '您的财务报表不够规范，建议每月按时记账并出具规范的资产负债表、利润表、现金流量表',
  tax: '您的税务合规存在风险，建议按时申报纳税、保留完税凭证，避免欠税或处罚记录',
  business: '您的业务真实性证据不足，建议完善合同台账、物流单据和履约凭证，形成可追溯业务链',
  assets: '您的资产质量待提升，建议清理不良资产、盘活固定资产并优化存货周转',
  credit: '您的信用穿透度不够，建议接入银行数据流、积累还款记录并主动进行信用修复',
  policy: '您对行业政策的适配度不足，建议关注扶持政策、主动申报资质并享受税收优惠',
  capital: '您的资本结构需优化，建议优化股权结构、控制负债率并引入战略投资',
};

const dimChecks = computed<DimCheck[]>(() => {
  const sc = props.scorecard;
  if (!sc) return [];
  return (Object.keys(DIM_LABELS) as DimKey[]).map((key) => {
    const current = sc[key] ?? 0;
    const standard = STANDARDS[key];
    const gap = standard - current;
    let light: DimCheck['light'] = 'green';
    if (gap > 20) light = 'red';
    else if (gap > 5) light = 'yellow';
    return {
      key, label: DIM_LABELS[key], current, standard, gap, light,
      suggestion: SUGGESTIONS[key],
    };
  });
});

const overallScore = computed<number>(() => {
  if (!dimChecks.value.length) return 0;
  const total = dimChecks.value.reduce((s, d) => s + d.current, 0);
  return Math.round(total / dimChecks.value.length);
});

const overallColor = computed<string>(() => {
  const s = overallScore.value;
  if (s >= 85) return '#10b981';
  if (s >= 60) return '#f59e0b';
  return '#ef4444';
});

const overallLevel = computed<string>(() => {
  const s = overallScore.value;
  if (s >= 85) return '健康';
  if (s >= 60) return '亚健康';
  return '高风险';
});

const overallVerdict = computed<{ title: string; desc: string }>(() => {
  const s = overallScore.value;
  if (s >= 85) {
    return {
      title: '企业健康度优秀',
      desc: '各维度基本达标，建议保持当前经营节奏，关注黄灯项预防性改善。',
    };
  }
  if (s >= 60) {
    return {
      title: '企业处于亚健康',
      desc: '部分维度偏离标准，建议优先处理红灯项，启动针对性改造。',
    };
  }
  return {
    title: '企业存在较高风险',
    desc: '多维度严重偏离标准，强烈建议立即发起改造以解锁融资入口。',
  };
});

const greenCount = computed(() => dimChecks.value.filter((d) => d.light === 'green').length);
const yellowCount = computed(() => dimChecks.value.filter((d) => d.light === 'yellow').length);
const redCount = computed(() => dimChecks.value.filter((d) => d.light === 'red').length);

const abnormalItems = computed<DimCheck[]>(() =>
  dimChecks.value
    .filter((d) => d.light === 'red' || d.light === 'yellow')
    .sort((a, b) => b.gap - a.gap),
);

function onDimClick(d: DimCheck): void {
  emit('dim-click', d.key);
}

function onStartReform(): void {
  emit('start-reform', props.enterpriseId);
}
</script>

<style lang="scss" scoped>
.health-checkup {
  background: $bg-card;

  .hc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    color: $text-primary;
  }

  .hc-empty {
    padding: $spacing-xl 0;
  }

  .hc-body {
    display: flex;
    flex-direction: column;
    gap: $spacing-lg;
  }

  // 1. 整体分数
  .hc-overall {
    display: flex;
    gap: $spacing-xl;
    align-items: center;
    padding: $spacing-base;
    background: rgba(15, 23, 42, 0.4);
    border-radius: $radius-lg;

    .hc-score-ring {
      flex-shrink: 0;
    }
    .hc-score-text {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 2px;
      .hc-score-num {
        font-size: 32px;
        font-weight: 700;
        color: $text-primary;
      }
      .hc-score-unit {
        font-size: 14px;
        color: $text-secondary;
      }
    }
    .hc-score-label {
      display: block;
      margin-top: 4px;
      font-size: 13px;
      color: $text-secondary;
    }
    .hc-summary {
      flex: 1;
      h3 {
        margin: 0 0 8px;
        font-size: 16px;
        color: $text-primary;
      }
      p {
        margin: 0 0 12px;
        font-size: 13px;
        line-height: 1.6;
        color: $text-regular;
      }
      .hc-light-summary {
        display: flex;
        gap: $spacing-sm;
      }
    }
  }

  // 2. 8 维红绿灯
  .hc-dims {
    .hc-dims-title {
      margin-bottom: $spacing-base;
      font-size: 13px;
      color: $text-secondary;
    }
    .hc-dim-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: $spacing-base;
    }
    .hc-dim-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: $bg-tertiary;
      border-radius: $radius-base;
      cursor: pointer;
      transition: background $transition-fast;
      &:hover {
        background: $bg-hover;
      }
      .hc-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .dot-green { background: $color-success; box-shadow: 0 0 6px rgba(16, 185, 129, 0.6); }
      .dot-yellow { background: $color-warning; box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }
      .dot-red { background: $color-danger; box-shadow: 0 0 6px rgba(239, 68, 68, 0.6); }
      .hc-dim-name {
        font-size: 13px;
        color: $text-regular;
      }
      .hc-dim-score {
        margin-left: auto;
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
      }
    }
  }

  // 3. 异常清单
  .hc-abnormal {
    .hc-abnormal-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: $spacing-base;
      font-size: 13px;
      color: $text-secondary;
      .hc-help {
        color: $text-muted;
        cursor: help;
      }
    }
    .hc-gap {
      color: $color-danger;
      font-weight: 600;
    }
    .hc-suggest {
      font-size: 13px;
      color: $text-regular;
      line-height: 1.5;
    }
  }

  // 4. 一键发起
  .hc-action {
    display: flex;
    align-items: center;
    gap: $spacing-base;
    padding-top: $spacing-base;
    border-top: 1px dashed $border-color;
    .hc-action-tip {
      font-size: 12px;
      color: $text-secondary;
    }
  }
}

.hc-tooltip {
  line-height: 1.6;
  max-width: 260px;
  .hc-tip-suggest {
    margin-top: 4px;
    color: #fde68a;
  }
}
</style>
