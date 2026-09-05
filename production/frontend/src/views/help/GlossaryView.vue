<!--
  GlossaryView.vue — FinTrust Hub 金融术语白话文词典
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
  把所有金融术语放一张表里, 配白话文翻译, 让用户像查字典一样查.
  支持搜索 + 分类筛选 + 一键跳转使用 PlainTextTooltip.

  路由: /glossary (由 router/index.ts 单独集成, 本组件不注册路由)
-->
<template>
  <div class="glossary-view">
    <el-card class="glossary-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div class="header-title">
            <el-icon><Reading /></el-icon>
            <span>金融术语白话文词典</span>
            <el-tag type="info" size="small" round>{{ filteredTerms.length }} 条</el-tag>
          </div>
          <div class="header-actions">
            <el-input
              v-model="keyword"
              placeholder="搜术语或白话文, 例如 反向保理 / LPR"
              clearable
              class="search-input"
              :prefix-icon="Search"
            />
            <el-select v-model="activeCategory" placeholder="全部分类" clearable class="category-select">
              <el-option
                v-for="cat in categories"
                :key="cat"
                :label="cat"
                :value="cat"
              />
            </el-select>
          </div>
        </div>
      </template>

      <el-empty v-if="filteredTerms.length === 0" description="没找到对应术语, 试试其他关键词" />

      <el-table
        v-else
        :data="filteredTerms"
        stripe
        :default-sort="{ prop: 'category', order: 'ascending' }"
        :row-class-name="rowClassName"
      >
        <el-table-column prop="term" label="专业术语" width="180">
          <template #default="{ row }">
            <PlainTextTooltip :term="row.term">
              <strong>{{ row.term }}</strong>
            </PlainTextTooltip>
          </template>
        </el-table-column>
        <el-table-column prop="plain" label="白话文 (一句话)" min-width="240">
          <template #default="{ row }">
            <span class="plain-text">{{ row.plain }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="详细说明" min-width="280">
          <template #default="{ row }">
            <span v-if="row.detail" class="detail-text">{{ row.detail }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="140">
          <template #default="{ row }">
            <el-tag :type="categoryTagType(row.category)" size="small" effect="dark">
              {{ row.category }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="aliases" label="别名/缩写" width="180">
          <template #default="{ row }">
            <template v-if="row.aliases && row.aliases.length">
              <el-tag
                v-for="alias in row.aliases"
                :key="alias"
                size="small"
                type="info"
                effect="plain"
                class="alias-tag"
              >
                {{ alias }}
              </el-tag>
            </template>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="card-footer">
        <el-text type="info" size="small">
          <el-icon><InfoFilled /></el-icon>
          悬停术语列可看到白话文气泡; 找不到的词请反馈给财务顾问补充.
        </el-text>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import PlainTextTooltip from '@/components/common/PlainTextTooltip.vue';
import {
  getAllTerms,
  getTermsByCategory,
  type GlossaryCategory,
  type GlossaryEntry,
} from '@/utils/plainTextTranslator';

defineOptions({ name: 'GlossaryView' });

const allTerms = getAllTerms();
const byCategory = getTermsByCategory();
const categories = Object.keys(byCategory) as GlossaryCategory[];

const keyword = ref('');
const activeCategory = ref<GlossaryCategory | ''>('');

const filteredTerms = computed<GlossaryEntry[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  return allTerms.filter((entry) => {
    if (activeCategory.value && entry.category !== activeCategory.value) return false;
    if (!kw) return true;
    const haystack = [
      entry.term,
      entry.plain,
      entry.detail ?? '',
      entry.category,
      ...(entry.aliases ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(kw);
  });
});

function rowClassName({ row }: { row: GlossaryEntry }) {
  return `row-${row.category}`;
}

function categoryTagType(cat: GlossaryCategory): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const map: Record<GlossaryCategory, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    融资工具: 'primary',
    担保增信: 'success',
    资产证券化: 'warning',
    监管指标: 'danger',
    货币政策: 'info',
    风险与评级: 'danger',
    合规与反洗钱: 'warning',
    跨境与外债: 'primary',
    债券市场: 'success',
    结构与分层: 'info',
  };
  return map[cat] ?? 'info';
}
</script>

<style lang="scss" scoped>
.glossary-view {
  .glossary-card {
    background: $bg-card;

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: $spacing-lg;
      flex-wrap: wrap;

      .header-title {
        display: flex;
        align-items: center;
        gap: $spacing-sm;
        font-size: $font-size-lg;
        font-weight: 600;
        color: $text-primary;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: $spacing-sm;

        .search-input {
          width: 280px;
        }

        .category-select {
          width: 160px;
        }
      }
    }

    .plain-text {
      color: $color-success;
      font-weight: 500;
    }

    .detail-text {
      color: $text-regular;
      font-size: $font-size-sm;
    }

    .alias-tag {
      margin-right: 4px;
      margin-bottom: 2px;
    }

    .card-footer {
      margin-top: $spacing-base;
      display: flex;
      justify-content: center;
    }
  }
}
</style>
