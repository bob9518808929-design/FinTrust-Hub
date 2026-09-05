---@diagnostic disable: undefined-global
-- FinTrust Hub Redis 初始化脚本
-- 技术栈: Redis 7 (缓存 + 限流 + 会话 + 阅后即焚临时数据)
--
-- 双模式设计:
--   1) 初始化模式 (无 KEYS/ARGV): redis-cli --eval db/redis/01_init.lua
--      跳过限流逻辑, 仅作 Key 规范文档载入, 返回 'init-ok'
--   2) 限流模式 (带 KEYS+ARGV): redis-cli --eval db/redis/01_init.lua <key> , <window> <max_req> <now_ms>
--      执行滑动窗口限流判定, 返回 1 (放行) / 0 (限流)
--
-- 全局变量说明 (Redis EVAL 注入, 非 Lua 标准):
--   KEYS[]    - redis-cli --eval 传入的 Redis Key 列表
--   ARGV[]    - redis-cli --eval 在 ',' 之后传入的参数列表
--   redis     - Redis 提供的全局对象 (调用 redis.call / redis.pcall)
--   math      - Lua 5.1 标准库 (Redis 内嵌 Lua 5.1)

-- ============================================================================
-- Key 命名规范
-- ============================================================================
-- fintrust:cache:{entity}:{id}          缓存 (企业/银行/改造状态等)
-- fintrust:ratelimit:{module}:{id}      限流 (ECO-09 bot 60/min, ECO-06 防刷分)
-- fintrust:session:{token}              会话 (JWT 黑名单)
-- fintrust:burn:raw:{enterprise_id}     阅后即焚原始数据 (TTL 120s, 过期自动销毁)
-- fintrust:burn:progress:{enterprise_id} 阅后即焚进度
-- fintrust:lock:{resource}              分布式锁 (反向竞拍出价 / 改造执行)
-- fintrust:seq:{entity}                 序列号生成器

-- ============================================================================
-- 1. 阅后即焚原始数据 key 规范 (TTL 120 秒, 过期自动物理销毁)
-- ============================================================================
-- SET fintrust:burn:raw:{enterprise_id} <encrypted_payload> EX 120
-- SET fintrust:burn:progress:{enterprise_id} <progress_json> EX 120

-- ============================================================================
-- 2. 限流脚本 (滑动窗口, ECO-09 数字分身 60/min)
-- ============================================================================
-- KEYS[1] = fintrust:ratelimit:bot:{enterprise_id}
-- ARGV[1] = 60 (窗口大小, 秒)
-- ARGV[2] = 60 (最大请求数)
-- ARGV[3] = current_timestamp_ms

if KEYS[1] and ARGV[1] and ARGV[2] and ARGV[3] then
    local key = KEYS[1]
    local window = tonumber(ARGV[1])
    local max_req = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local clear_before = now - window * 1000

    redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)
    local count = redis.call('ZCARD', key)
    if count >= max_req then
        return 0  -- 限流
    end
    redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random(1000000, 9999999)))
    redis.call('EXPIRE', key, window + 1)
    return 1  -- 放行
end

-- 初始化模式 (无 KEYS/ARGV): 不执行限流, 直接返回成功标识
return 'init-ok'

-- ============================================================================
-- 3. 防刷分窗口 (ECO-06, 5 分钟内同物料不重发)
-- ============================================================================
-- KEYS[1] = fintrust:ratelimit:scan:{worker_id}:{material_id}
-- TTL = 300 (5 分钟)
-- SET fintrust:ratelimit:scan:{worker_id}:{material_id} 1 EX 300 NX

-- ============================================================================
-- 4. 分布式锁 (反向竞拍出价, 防并发)
-- ============================================================================
-- SET fintrust:lock:bid:{tender_id}:{bank_id} <request_id> NX EX 30

-- ============================================================================
-- 5. 缓存预热 (企业列表 / 银行列表 / 改造状态)
-- ============================================================================
-- SET fintrust:cache:enterprises:list <json> EX 300
-- SET fintrust:cache:banks:list <json> EX 600
-- SET fintrust:cache:reform:{enterprise_id} <json> EX 60
