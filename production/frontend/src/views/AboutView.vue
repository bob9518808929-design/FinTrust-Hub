<template>
  <div class="about-view">
    <el-card header="关于 FinTrust Hub v3.1">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="版本">v3.1.0</el-descriptions-item>
        <el-descriptions-item label="定位">企业改造与融资撮合信任枢纽</el-descriptions-item>
        <el-descriptions-item label="核心哲学">AI 作为操作者 + 改造引擎 + 市场化破局 + 傻瓜式操作</el-descriptions-item>
        <el-descriptions-item label="技术栈">Vue 3 + TS + Element Plus + FastAPI + PostgreSQL + Neo4j + ClickHouse</el-descriptions-item>
        <el-descriptions-item label="开发策略">API 接入优先 + 自研护城河 + 独立兜底备选</el-descriptions-item>
        <el-descriptions-item label="实施分期">P0 诊断变现 → P1 半自动撮合 → P2 全自动改造</el-descriptions-item>
      </el-descriptions>

      <el-divider />

      <h3>📁 项目结构</h3>
      <pre class="project-tree">
production/
├── contracts/        TypeScript 接口契约 (单一真相源)
├── frontend/         Vue 3 + TS + Element Plus + Vite
├── backend/          FastAPI + Spring Cloud
├── db/               PostgreSQL + Redis + ClickHouse + Neo4j
├── infra/            Docker Compose + K8s + CI/CD
├── reference/js/     ECO 模块业务逻辑参考 (从 simulation 迁移)
├── README.md         生产系统总说明
└── ARCHITECTURE.md   分层架构文档
      </pre>

      <el-divider />

      <h3>📋 Phase ECO 9 模块</h3>
      <el-table :data="ecoModules" size="small">
        <el-table-column prop="code" label="模块" width="100" />
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="stage" label="阶段" width="80" />
        <el-table-column prop="goal" label="商业化目标" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'AboutView' });

const ecoModules = [
  { code: 'ECO-01', name: '阅后即焚零信任诊断', stage: 'P0', goal: '破解企业数据隐私恐惧' },
  { code: 'ECO-02', name: '成果导向阶梯定价', stage: 'P0', goal: '破解冷启动门槛 (0 元接入)' },
  { code: 'ECO-03', name: '无接口适配器', stage: 'P1', goal: '破解银行接入惰性' },
  { code: 'ECO-04', name: '信用凭证联盟链', stage: 'P1', goal: '破解跨行确权难' },
  { code: 'ECO-05', name: '反向竞拍融资大厅', stage: 'P2', goal: '翻转银企博弈' },
  { code: 'ECO-06', name: '积分商城与行为挖矿', stage: 'P1', goal: '破解物流端配合度' },
  { code: 'ECO-07', name: 'FinTrust 企业合规指数', stage: 'P2', goal: '行业基准飞轮' },
  { code: 'ECO-08', name: '监管/政府背书催化剂', stage: 'P1', goal: '破解信任门槛' },
  { code: 'ECO-09', name: '微信/钉钉数字分身', stage: 'P2', goal: '傻瓜式操作' },
];
</script>

<style lang="scss" scoped>
.about-view {
  .project-tree {
    background: $bg-base;
    color: $text-regular;
    padding: $spacing-base;
    border-radius: $radius-base;
    font-size: $font-size-sm;
    overflow-x: auto;
  }
}
</style>
