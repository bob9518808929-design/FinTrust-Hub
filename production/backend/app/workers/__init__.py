"""Temporal Workers 包 (CORE-01, R4.8).

子模块:
    temporal_worker: Temporal Worker 注册 + DAG 工作流定义, asyncio 兜底模式

设计依据: ROADMAP_REMAINING_V2.md R4.8
降级策略: temporalio 包未安装时, temporal_worker 降级为 asyncio DAG 执行器,
         保证 import 不报错, 业务可继续运行.
"""
