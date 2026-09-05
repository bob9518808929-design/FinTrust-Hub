/**
 * stores/enterprise.ts — 企业状态管理
 *
 * 职责:
 *   1. 加载企业列表 (mock-data.js ENTERPRISES 镜像)
 *   2. 当前选中企业 (单例, 全局共享)
 *   3. 切换企业时清空全局告警 (project_memory 硬约束)
 *   4. 改造状态联动 (hasReformed / financingUnlocked 三重或条件)
 *
 * project_memory 硬约束:
 *   - 切企业时基于 ent.reform.hasReformed || ent.runtime.financingUnlocked===true 恢复改造状态
 *   - 全局告警横幅在企业切换时必须清空
 *   - 改造完成后 hasReformed/afterLevel/afterScorecard 完整写回企业数据对象
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Enterprise, Id } from '@contracts/common';
import * as enterpriseApi from '@/api/enterprise';
import { useAlertStore } from '@/stores/alertStore';
import { useReformStore } from '@/stores/reform';

export const useEnterpriseStore = defineStore('enterprise', () => {
  // === 状态 ===
  const enterprises = ref<Enterprise[]>([]);
  const currentEnterpriseId = ref<Id | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // === 计算属性 ===
  const currentEnterprise = computed<Enterprise | null>(() => {
    if (!currentEnterpriseId.value) return null;
    return enterprises.value.find((e) => e.id === currentEnterpriseId.value) ?? null;
  });

  const currentReformCompleted = computed<boolean>(() => {
    const ent = currentEnterprise.value;
    if (!ent) return false;
    // project_memory: 三重或条件
    return (
      ent.reform.hasReformed === true ||
      ent.runtime.financingUnlocked === true ||
      ent.runtime.guaranteeStatus === 'active'
    );
  });

  // === 动作 ===

  /** 拉取企业列表 */
  async function fetchEnterprises(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await enterpriseApi.listEnterprises();
      enterprises.value = result;
      // 自动选中第一个 (无当前选中时)
      if (!currentEnterpriseId.value && result.length > 0) {
        currentEnterpriseId.value = result[0]!.id;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[EnterpriseStore] 拉取企业列表失败:', e);
    } finally {
      loading.value = false;
    }
  }

  /** 切换当前企业 (project_memory: 必须清空全局告警 + 触发改造状态 reload) */
  async function switchEnterprise(id: Id): Promise<void> {
    if (id === currentEnterpriseId.value) return;
    currentEnterpriseId.value = id;
    // project_memory 硬约束: 切企业时清空全局告警横幅
    useAlertStore().clearByEnterpriseSwitch();
    // 触发改造状态 reload (router 守卫不再依赖隐式调用)
    void useReformStore().loadReformState(id).catch((e: unknown) => {
      console.warn('[EnterpriseStore] 切换企业后加载改造状态失败 (降级):', e);
    });
  }

  /** 获取单个企业 (按需加载详情) */
  async function fetchEnterpriseDetail(id: Id): Promise<Enterprise | null> {
    try {
      const ent = await enterpriseApi.getEnterprise(id);
      // 写回列表 (保证最新)
      const idx = enterprises.value.findIndex((e) => e.id === id);
      if (idx >= 0) {
        enterprises.value[idx] = ent;
      } else {
        enterprises.value.push(ent);
      }
      return ent;
    } catch (e) {
      console.error('[EnterpriseStore] 拉取企业详情失败:', e);
      return null;
    }
  }

  /** 更新企业改造状态 (改造完成后回写, project_memory 硬约束) */
  function applyReformResult(
    enterpriseId: Id,
    patch: {
      hasReformed: boolean;
      reformedAt: string;
      afterLevel: Enterprise['reform']['afterLevel'];
      afterScorecard: Enterprise['reform']['afterScorecard'];
      financingUnlocked: boolean;
    },
  ): void {
    const ent = enterprises.value.find((e) => e.id === enterpriseId);
    if (!ent) return;
    ent.reform.hasReformed = patch.hasReformed;
    ent.reform.reformedAt = patch.reformedAt;
    ent.reform.afterLevel = patch.afterLevel;
    ent.reform.afterScorecard = patch.afterScorecard;
    ent.runtime.financingUnlocked = patch.financingUnlocked;
  }

  return {
    // state
    enterprises,
    currentEnterpriseId,
    loading,
    error,
    // getters
    currentEnterprise,
    currentReformCompleted,
    // actions
    fetchEnterprises,
    switchEnterprise,
    fetchEnterpriseDetail,
    applyReformResult,
  };
}, {
  persist: {
    key: 'fintrust-enterprise',
    storage: localStorage,
    paths: ['currentEnterpriseId'],
  },
});
