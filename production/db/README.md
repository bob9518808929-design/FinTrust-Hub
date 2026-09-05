# FinTrust Hub 数据库 Schema

## 技术栈 (spec.md L3503)
- **PostgreSQL 16**: 主交易库 (企业 / 改造 / ECO 业务数据)
- **Redis 7**: 缓存 + 限流 + 会话 + 阅后即焚原始数据临时存储
- **ClickHouse**: 时序指标 (改造进度 / 行为挖矿 / 行业指数历史)
- **Neo4j 5**: 关系图谱 (企业-银行-担保-保险 多方关系 / 责任链节点)

## 目录结构
```
db/
├── README.md                    本文件
├── postgresql/                  PostgreSQL DDL + 种子数据
│   ├── 01_init.sql              建表 DDL (与 ORM models 对齐)
│   ├── 02_seed.sql              种子数据 (镜像 simulation mock-data.js)
│   └── 03_indexes.sql           性能索引 + 扩展
├── redis/                        Redis 初始化脚本
│   └── 01_init.lua              限流 / 缓存 key 规范
├── clickhouse/                  ClickHouse 时序库
│   └── 01_metrics.sql            指标表 DDL
├── neo4j/                        Neo4j 图谱
│   └── 01_graph.cypher          节点/关系约束
└── migrations/                  Alembic 迁移 (Python ORM -> DDL)
    ├── alembic.ini              Alembic 配置
    └── env.py                   迁移环境
```

## 使用方式
```bash
# 1. PostgreSQL (Docker)
docker exec -i fintrust-postgres psql -U fintrust -d fintrust_hub < db/postgresql/01_init.sql
docker exec -i fintrust-postgres psql -U fintrust -d fintrust_hub < db/postgresql/02_seed.sql
docker exec -i fintrust-postgres psql -U fintrust -d fintrust_hub < db/postgresql/03_indexes.sql

# 2. Alembic 迁移 (生产)
cd backend && alembic upgrade head

# 3. ClickHouse
docker exec -i fintrust-clickhouse clickhouse-client < db/clickhouse/01_metrics.sql

# 4. Neo4j
cat db/neo4j/01_graph.cypher | docker exec -i fintrust-neo4j cypher-shell -u neo4j -p fintrust
```

## 设计约束 (project_memory)
- 所有表使用 UUID 字符串主键 (IdMixin)
- 多租户隔离: tenant_id 字段 (TenantMixin)
- 软删除: deleted_at 字段 (SoftDeleteMixin)
- 时间戳: created_at + updated_at (TimestampMixin, 自动维护)
- JSON 字段用于半结构化数据 (评分卡 / 责任链 / 配置等)
