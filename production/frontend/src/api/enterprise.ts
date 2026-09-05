/**
 * api/enterprise.ts — 企业模块 API
 */

import type {
  Enterprise,
  Id,
  PaginatedResult,
  PageQuery,
  DataFlowFlags,
  EnterpriseFinancials,
  Industry,
  IndustryPolicy,
  RiskProfile,
} from '@contracts/common';
import { get, post, put, patch } from './client';

/**
 * 创建企业入参 (对齐后端 EnterpriseCreate schema, runtime/reform 后端自动填充).
 * dataFlows/modules/cooperation/dataVisibility 后端有 default_factory, 前端可省略.
 */
export interface EnterpriseCreatePayload {
  name: string;
  industry: Industry;
  industryLabel: string;
  industryPolicy: IndustryPolicy;
  riskProfile: RiskProfile;
  riskLabel: string;
  dataFlows?: DataFlowFlags;
  financials: EnterpriseFinancials;
}

/** 更新企业入参 (部分字段, 全部可选, 对齐后端 EnterpriseUpdate schema) */
export interface EnterpriseUpdatePayload {
  name?: string;
  industry?: Industry;
  industryLabel?: string;
  industryPolicy?: IndustryPolicy;
  riskProfile?: RiskProfile;
  riskLabel?: string;
  dataFlows?: DataFlowFlags;
  financials?: EnterpriseFinancials;
}

/** 企业列表 */
export async function listEnterprises(): Promise<Enterprise[]> {
  return get<Enterprise[]>('/enterprises');
}

/** 分页查询 */
export async function queryEnterprises(query: PageQuery & {
  industry?: string;
  riskProfile?: string;
  keyword?: string;
}): Promise<PaginatedResult<Enterprise>> {
  return get<PaginatedResult<Enterprise>>('/enterprises/query', { params: query });
}

/** 单个企业详情 */
export async function getEnterprise(id: Id): Promise<Enterprise> {
  return get<Enterprise>(`/enterprises/${id}`);
}

/** 创建企业 (运营台操作) */
export async function createEnterprise(payload: EnterpriseCreatePayload): Promise<Enterprise> {
  return post<Enterprise>('/enterprises', payload);
}

/** 更新企业 (含配置: dataFlows / dataVisibility / cooperation / modules) */
export async function updateEnterprise(
  id: Id,
  patchData: EnterpriseUpdatePayload,
): Promise<Enterprise> {
  return patch<Enterprise>(`/enterprises/${id}`, patchData);
}

/** 应用改造结果回写 (project_memory 硬约束: hasReformed/afterLevel/afterScorecard 完整写回) */
export async function applyReformResult(
  id: Id,
  patch: {
    hasReformed: boolean;
    reformedAt: string;
    afterLevel: Enterprise['reform']['afterLevel'];
    afterScorecard: Enterprise['reform']['afterScorecard'];
    financingUnlocked: boolean;
  },
): Promise<Enterprise> {
  return post<Enterprise>(`/enterprises/${id}/apply-reform-result`, patch);
}

/** 重置改造状态 (project_memory: 同步清零 hasReformed/reformedAt/afterLevel 等) */
export async function resetReform(id: Id): Promise<Enterprise> {
  return post<Enterprise>(`/enterprises/${id}/reset-reform`, {});
}
