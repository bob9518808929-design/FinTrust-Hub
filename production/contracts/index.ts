/**
 * index.ts — FinTrust Hub 生产系统契约层总导出
 *
 * 设计依据: spec.md v3.1 + project_memory 工程约定
 * 适用层: frontend (Vue 3 + TS) / backend (FastAPI Pydantic 镜像) / db (PostgreSQL schema 镜像)
 *
 * 引用顺序:
 *   common (基础类型) → scorecard (评分卡+改造状态) → reform-engine (R0-R10) → eco (9 个 ECO 模块)
 *
 * 使用方式 (前端 Vue 3 + TS):
 *   import type { Enterprise, ReformState, EcoBurnEngine } from '@/contracts';
 *
 * 使用方式 (后端 FastAPI):
 *   Pydantic schema 镜像此契约字段名与语义, 不可偏离
 *   - 文件命名: snake_case (PEP 8)
 *   - 字段命名: snake_case
 *   - 字段类型: 映射规则见 docs/contracts-to-pydantic.md (TODO P6 生成)
 *
 * 使用方式 (数据库层):
 *   PostgreSQL schema 镜像此契约字段名 (转 snake_case)
 *   - 表名: 与 interface 名对应 (enterprises / banks / reform_states / ...)
 *   - 列名: snake_case (enterprise_id / created_at)
 *   - 索引: 按查询模式建 (高频查询字段)
 */

// 1. 基础类型
export * from './common';

// 2. 评分卡 + 改造状态
export * from './scorecard';

// 3. 改造引擎 R0-R10 接口
export * from './reform-engine';

// 4. 9 个 ECO 模块契约
export * from './eco';

// ============================================================================
// 顶层类型别名 (跨模块复用)
// ============================================================================

import type { Id } from './common';

/** 企业 ID (alias, 显式区分) */
export type EnterpriseId = Id;

/** 銀行 ID */
export type BankId = Id;

/** 担保公司 ID */
export type GuarantorId = Id;

/** 保险公司 ID */
export type InsurerId = Id;

/** 改造案例 ID */
export type CaseId = Id;
