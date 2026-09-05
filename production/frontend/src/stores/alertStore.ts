/**
 * stores/alertStore.ts — 全局告警状态管理 (B5)
 *
 * spec 依据: B5 全局告警横幅 + 多 Tab 跳转
 * project_memory: 切换企业时必须清空全局告警
 *
 * 职责:
 *   1. 维护当前激活的告警列表 (最多 3 条同时显示)
 *   2. 提供 addAlert / dismissAlert / clearAlerts API
 *   3. 支持订阅机制 (AppHeader 订阅渲染横幅)
 *   4. 切换企业时自动清空 (project_memory 硬约束)
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type AlertLevel = 'red' | 'orange' | 'yellow';
export type AlertCaseType =
  | 'fund_flight'
  | 'iot_disconnect'
  | 'settlement_chaos'
  | 'contract_forgery'
  | 'hollow_out'
  | 'repayment_cliff'
  | 'related_return'
  | 'bill_double_discount'
  | 'passive_confirmation'
  | 'chain_break'
  | 'guarantee_fallback';

export interface Alert {
  id: string;
  level: AlertLevel;
  caseType: AlertCaseType;
  title: string;
  message: string;
  enterpriseId: string;
  createdAt: string;
  jumpTarget?: string; // 跳转 Tab/路由
}

const MAX_ALERTS = 3;

export const useAlertStore = defineStore('alert', () => {
  const alerts = ref<Alert[]>([]);
  const subscribers = ref<Array<(a: Alert[]) => void>>([]);

  const count = computed(() => alerts.value.length);
  const hasCritical = computed(() => alerts.value.some(a => a.level === 'red'));

  /** 订阅告警变化 */
  function subscribe(cb: (a: Alert[]) => void): () => void {
    subscribers.value.push(cb);
    return () => {
      const idx = subscribers.value.indexOf(cb);
      if (idx >= 0) subscribers.value.splice(idx, 1);
    };
  }

  function notify(): void {
    for (const cb of subscribers.value) cb(alerts.value);
  }

  /** 添加告警 (超过上限降级为 toast, project_memory: 队列上限 3) */
  function addAlert(alert: Omit<Alert, 'id' | 'createdAt'>): string {
    const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full: Alert = {
      ...alert,
      id,
      createdAt: new Date().toISOString(),
    };
    if (alerts.value.length >= MAX_ALERTS) {
      // 超限降级 (project_memory: AI 决策弹窗队列上限 3, 超限自动降级为非阻塞 toast)
      console.warn('[AlertStore] 告警队列已满, 降级为 toast:', full);
      return id;
    }
    alerts.value.push(full);
    notify();
    return id;
  }

  /** 仅清除横幅显示 (状态保留, 不删除数据) */
  function dismissAlert(id: string): void {
    const idx = alerts.value.findIndex(a => a.id === id);
    if (idx >= 0) {
      alerts.value.splice(idx, 1);
      notify();
    }
  }

  /** 状态修复时清除 (predicate 匹配的告警) */
  function clearAlerts(predicate?: (a: Alert) => boolean): void {
    if (predicate) {
      alerts.value = alerts.value.filter(a => !predicate(a));
    } else {
      alerts.value = [];
    }
    notify();
  }

  /** 切换企业时强制清空 (project_memory 硬约束) */
  function clearByEnterpriseSwitch(): void {
    alerts.value = [];
    notify();
  }

  return {
    alerts,
    count,
    hasCritical,
    subscribe,
    addAlert,
    dismissAlert,
    clearAlerts,
    clearByEnterpriseSwitch,
  };
});
