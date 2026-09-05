"""业务服务层.

设计原则:
    1. 服务层封装业务逻辑, API 路由只做参数校验和响应包装
    2. 开发期使用内存 mock (seed_data), 零机构接入时仍可独立运行
    3. 生产期通过 SQLAlchemy 持久化到 PostgreSQL, Redis 缓存热点
    4. 所有方法 async/await (project_memory: 禁止 callback 风格)

对齐: simulation/reference/js/*.js 的业务语义, contracts/*.ts 的类型契约.
"""
