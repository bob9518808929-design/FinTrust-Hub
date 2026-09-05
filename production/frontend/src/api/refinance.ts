/**
 * api/refinance.ts — MOD-11 再融资/再贴现闭环 API
 *
 * 后端契约: backend/app/api/v1/modules/refinance.py
 *   GET  /modules/refinance/{enterpriseId}/cashflow     6 个月现金流预测
 *   GET  /modules/refinance/{enterpriseId}/entrance     再融资入口判定 + 缺口规模标签
 *   GET  /modules/refinance/{enterpriseId}/recommend    AI 推荐 4 款再融资产品
 *   POST /modules/refinance/{enterpriseId}/submit?recId=xxx  提交再融资申请
 */

import type { Id, IsoTimestamp, AmountInCents } from '@contracts/common';
import { get, post } from './client';

export type GapSizeLabel = 'small' | 'medium' | 'large';

export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected';

export interface CashflowForecast {
  enterpriseId: Id;
  monthIso: string;
  projectedInflowCents: AmountInCents;
  projectedOutflowCents: AmountInCents;
  gapCents: number;
  cumulativeGapCents: number;
}

export interface RefinanceEntrance {
  enterpriseId: Id;
  eligible: boolean;
  gapSizeLabel: GapSizeLabel;
  suggestedSchemes: string[];
}

export interface AIRecommendation {
  recId: Id;
  productName: string;
  lender: string;
  amountCents: AmountInCents;
  annualRatePct: number;
  termMonths: number;
  expectedApprovalProb: number;
  totalCostCents: AmountInCents;
  reasons: string[];
}

export interface RefinanceSubmission {
  enterpriseId: Id;
  recId: Id;
  status: SubmissionStatus;
  createdAt: IsoTimestamp;
}

/** 6 个月现金流预测 */
export async function forecastCashflow(
  enterpriseId: Id,
  months = 6,
): Promise<CashflowForecast[]> {
  return get<CashflowForecast[]>('/modules/refinance/' + enterpriseId + '/cashflow', {
    params: { months },
  });
}

/** 再融资入口判定与缺口规模标签 */
export async function computeEntrance(enterpriseId: Id): Promise<RefinanceEntrance> {
  return get<RefinanceEntrance>('/modules/refinance/' + enterpriseId + '/entrance');
}

/** AI 推荐 4 款再融资产品 */
export async function aiRecommend(
  enterpriseId: Id,
  useLlm = true,
): Promise<AIRecommendation[]> {
  return get<AIRecommendation[]>('/modules/refinance/' + enterpriseId + '/recommend', {
    params: { useLlm },
  });
}

/** 提交再融资申请 (指定 recId) */
export async function submitApplication(
  enterpriseId: Id,
  recId: Id,
): Promise<RefinanceSubmission> {
  return post<RefinanceSubmission>(
    '/modules/refinance/' + enterpriseId + '/submit',
    null,
    { params: { recId } },
  );
}
