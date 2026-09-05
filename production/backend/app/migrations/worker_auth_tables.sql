-- 文件名：worker_auth_tables.sql 职责：APP-02 worker 登录迁移,为 enterprises 增加 enterprise_code、worker_accounts 增加 worker_no 并回填
-- Adds enterprise_code to enterprises and worker_no to worker_accounts
--
-- 兼容性: PostgreSQL (生产/开发默认). SQLite 不支持 IF NOT EXISTS 的 ALTER TABLE,
--          lifespan 迁移器对每条语句 try/except, 不阻断启动.
-- 执行: dev 环境 lifespan 自动按文件名排序执行; 生产环境用 alembic.

-- Step 1: Add columns (idempotent, IF NOT EXISTS)
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS enterprise_code VARCHAR(8) UNIQUE NOT NULL DEFAULT '';
ALTER TABLE worker_accounts ADD COLUMN IF NOT EXISTS worker_no VARCHAR(20) UNIQUE NOT NULL DEFAULT '';

-- Step 2: Backfill sample data from id prefix (PG 字符串 || 与 SUBSTRING)
UPDATE enterprises SET enterprise_code = 'E' || SUBSTRING(id, 1, 5) WHERE enterprise_code = '';
UPDATE worker_accounts SET worker_no = 'W' || SUBSTRING(id, 1, 5) WHERE worker_no = '';

-- Step 3: Verification (run manually to confirm)
-- SELECT id, enterprise_code FROM enterprises LIMIT 5;
-- SELECT id, worker_no FROM worker_accounts LIMIT 5;
