# FinTrust Hub 全景导航工具设计确认书 v1.0

> **版本演进**：v0.1 原方案（结构可视化+状态+诊断）→ v0.1.1 DeepSeek 补丁（跨语言契约边、增量更新、视角预设、生产隔离、trace_report 复用）→ **v1.0 整合 + Agent 防漂移升级**（双产出、强制加载、4 大指标、静态懒加载）
>
> **归档日期**：2026-09-04
>
> **设计依据**：`../.trae/specs/build-fintech-trust-hub/spec.md` v3.1+SCF v6.0
>
> **核心哲学**："先稳固基础，再攀登高峰" + "傻瓜式操作" + "API 接入优先 + 自研护城河 + 独立兜底备选" + "配置优于训练" + "白盒可解释" + "渐进调节"

## 1. 设计目标与定位

### 1.1 双重定位（核心升级）

| 维度 | 定位 | 消费方 |
|---|---|---|
| 开发者仪表盘 | 结构可视化+状态监控+诊断指引 | 人类（开发者/PM/架构师） |
| **Agent 防漂移底座** | 开机自检清单，杜绝幻觉、防止跑偏、规避上下文限制 | AI Agent（Cursor/Claude/Trae） |

> DeepSeek 第二轮的核心洞察：**为 Agent 设计的导航，必须优先输出"机器可读的文本摘要"，而非仅"人类可读的网页"**。Agent 看不懂 HTML（除非 OCR），只能读 Markdown/JSON/TXT。

### 1.2 五大核心目标

1. 结构可视化：代码目录树、依赖关系、模块职责
2. 中文注释：每文件/模块有中文名称+功能说明
3. 实时状态：模块运行状态五分类
4. 诊断指引：异常模块错误摘要+修复建议
5. **Agent 上下文**：机器可读摘要，强制加载，每次开发前回忆项目全貌

### 1.3 受众与使用场景

| 受众 | 用途 |
|---|---|
| 上帝视角 | 系统整体架构、模块边界、核心依赖链 |
| 总架构师 | 架构一致性、循环依赖检测 |
| 开发者 | 具体实现追踪、代码路径调试 |
| **AI Agent** | 项目骨架快速回忆，杜绝幻觉 |

| 阶段 | 用途 |
|---|---|
| 开发阶段 | 分析结构、调试运行、定位问题、**Agent 防漂移** |
| 生产阶段 | 只读监控（状态面板无运行控制，状态显示降级） |

## 2. 工程约束与硬红线

### 2.1 零侵入
- 工具代码独立存放 `tools/panorama/`
- 不修改核心引擎代码，不挤占 `production/`

### 2.2 生产安全底线（强制）
- 生产环境只部署静态 HTML，**不包含任何 DB 探测脚本**
- 状态栏统一显示"🟡 降级（生产环境不开放实时状态）"
- 状态探测仅检测本地开发环境：`localhost:5432 / 6379 / 8123 / 7687`，**绝不读取 production 连接串**

### 2.3 双产出强制
`collect.py` 每次运行必须生成两份产物，且同步更新：

| 产物 | 消费方 | 内容特点 |
|---|---|---|
| `panorama_dashboard.html` | 人类 | v-tree 静态树、色块、4 大指标区块 |
| `AGENT_CONTEXT.md`（新增） | AI Agent | 纯文本+Markdown 表格，20-50KB，含项目骨架/已实现模块/待开发清单/最近变更 |

## 3. 项目结构映射（基于实际代码）

### 3.1 真实目录骨架

```
production/
├── ai-engine/services/{llm_service.py}              # AI 服务
├── backend/app/                                      # FastAPI 后端
│   ├── api/v1/{auth,bank,eco_adapter,eco_bid,eco_bot,eco_burn,
│   │            eco_credential,eco_gov,eco_index,eco_pricing,
│   │            eco_pts,enterprises,operations,reform,router,scf}.py
│   ├── api/v1/{core,data,infra,modules}/
│   ├── models/{base,eco,enterprise,reform}.py
│   ├── services/  # 55+ 个 service 文件（bank/chain/credit/eco/iot/risk/...）
│   ├── workers/
│   ├── config.py / database.py / deps.py / main.py
├── contracts/                                       # TS 类型契约
├── db/                                              # PostgreSQL/Redis/ClickHouse/Neo4j
├── frontend/src/                                    # Vue 3 + TS
│   ├── views/{advisor,approval,bank,cockpit,eco,enterprise,fallback,
│   │          financing,help,institution,mobile,partner,portal,
│   │          reform,regulatory,scf}/
│   ├── {api,components,composables,layouts,router,stores,styles,utils}/
├── infra/{ci-cd,docker,k8s,nginx,observability,temporal}/
├── mobile/
└── reference/                                       # 业务逻辑参考（纯 JS）
```

### 3.2 模块树根节点（8 个一级目录）
`ai-engine / backend / contracts / db / frontend / infra / mobile / reference`

## 4. 中文注释提取规范（多语言）

### 4.1 提取优先级

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1 | `# 文件名：` / `// 文件名：` / `-- 文件名：` / `<!-- 文件名： -->` / `/* 文件名： */` | 按语言前缀 |
| 2 | `# 职责：` / `// 职责：` / `-- 职责：` | 按语言前缀 |
| 3 | `__doc__` / `@description` JSDoc | Python/JS/TS |
| 4 | 文件名推断（fallback，snake_case → 中文映射表） | 全部 |
| 5 | 人工覆盖（`manual_overrides.yaml`） | 全部 |

### 4.2 多语言注释前缀映射

| 语言 | 扩展 | 注释前缀 |
|---|---|---|
| Python | .py | `#` |
| TypeScript/JavaScript | .ts/.js/.mjs/.cjs | `//` |
| Vue SFC | .vue | `<!-- -->`（template/style）+ `//`（script）+ `@` JSDoc |
| SQL | .sql | `--` |
| YAML | .yml/.yaml | `#` |
| Dockerfile | Dockerfile* | `#` |

### 4.3 边界情况
- **Vue SFC 三段式**：从 `<script>` 块顶部提取
- **文件夹 vs 文件**：先取文件夹 `README.md` 的 `#` 标题，再取文件 `# 文件名：`
- **缺失处理**：显示 📝 待补充中文名，并在 AGENT_CONTEXT.md 单独列出"待补充注释文件清单"方便批量补全

## 5. 跨语言依赖图（边定义）

### 5.1 三类边

| 边类型 | 捕获方式 | 渲染 |
|---|---|---|
| 同语言 import | AST 解析（Python ast / TS ts-morph） | 实线 |
| 跨语言契约调用 | frontend/src/api/*.ts 的 axios URL ↔ backend/app/api/v1/*.py 的 @router 装饰器路径 | 虚线（蓝） |
| 数据库读写 | services/*.py 的 SQL 字符串/ORM 模型引用 → db/ schema | 点划线（灰） |

### 5.2 跨语言契约边捕获机制

1. 扫描 `frontend/src/api/*.ts` 中所有 `axios.get/post/put/delete` 调用的 URL 字面量
2. 扫描 `backend/app/api/v1/*.py` 中所有 `@router.get/post/put/delete` 装饰器路径
3. 路径归一化（去 `/api/v1` 前缀，去参数占位符）
4. 匹配成功生成契约边：`{前端文件, 后端文件, HTTP方法, 路径}`
5. **匹配失败的（前端调了但后端没注册）标记为"孤儿契约"**，红色虚线+警告图标，提示可能缺失端点

> **价值**：D3 图不再是"两座孤岛"，真正展示"前端点了哪个按钮→调了后端哪个接口"的业务链路，对架构师排障价值极高。成本：轻量级正则/AST 解析，不涉及运行时注入。

## 6. 状态监控（五分类）

| 状态 | 图标 | 颜色 | 定义 |
|---|---|---|---|
| 健康 | ✅ | 绿 | 进程存活+最近 5 分钟无错误日志+依赖服务可连接 |
| 降级 | ⚠️ | 黄 | 进程存活但有 WARNING/某依赖不可用/响应延迟高 |
| 故障 | ❌ | 红 | 进程未存活/最近 1 分钟有 ERROR 日志 |
| 未启动 | ⬜ | 灰 | 已知模块但无对应进程 |
| 无状态 | — | 无 | 工具脚本/测试文件，非常驻服务 |

**采集方式（仅本地开发环境）**：
- 进程存活（psutil）
- 端口监听（socket connect localhost）
- 错误日志（解析 `backend/logs/` 最近 10 行）
- DB 连接（仅 ping localhost，**绝不读 production 连接串**）
- 增量错误计数（`.cache/log_offsets.json` 持久化 offset）

## 7. 增量更新机制

### 7.1 文件级指纹缓存
- 首次运行：每个文件生成 `mtime + size + hash(head_50_lines)` 指纹
- 存入 `tools/panorama/.cache/file_fingerprints.json`
- 下次运行：仅指纹变化的文件重新提取中文注释和 AST 依赖

### 7.2 Git 日志增量
- `git log --since="5 minutes ago"` 只拉取最近变更
- 文件级 `last_commit_at` 缓存

### 7.3 三种运行模式

| 模式 | 命令 | 耗时 | 用途 |
|---|---|---|---|
| `--quick` | `collect.py --quick` | < 3 秒 | **Agent 启动前快速刷新**，仅扫最近变更+Git 日志 |
| `--incremental` | `collect.py --incremental` | < 10 秒 | 日常开发，基于文件指纹增量 |
| `--full` | `collect.py --full` | 全量 | 首次运行/CI 定期（每小时） |
| `--text` | `collect.py --text` | < 3 秒 | 仅生成 AGENT_CONTEXT.md，不跑 AST |

## 8. 视角切换（三套预设，定死不给自定义）

| 视角 | 可见内容 | 隐藏内容 |
|---|---|---|
| 上帝视角 | 全部 8 个目录+全部文件+跨语言契约边+健康状态 | 无 |
| 总架构师 | 顶层 8 个目录+二级模块级（不展开到文件）+循环依赖检测结果 | 具体 .py/.vue 文件名、代码统计 |
| 开发者 | 仅当前 `git config user.name` 最近 3 个月提交过的文件+其直接依赖 | 无关目录、历史归档文件 |

> 开发者打开工具只看"我的代码+我调了谁"，不迷路。直接定死三套预设，避免功能膨胀。

## 9. 首页 4 大硬指标区块（强制输出）

### 9.1 总体完成度（基于 Spec 章节 vs 代码文件映射）

```
📊 总体完成度：72% (31/43 个核心模块)
├── ✅ 已完成: MOD-01, MOD-02, MOD-07, MOD-14, APP-02-a (PWA) ...
├── 🚧 进行中: MOD-16.5 (任务执行族), APP-03 (运营台改造)
├── ⏳ 未开始: MOD-08 (司法取证深度集成), APP-02-b (小程序)
└── ⚠️ 阻塞项: 银行 API 适配层（等待招商银行提供测试环境）
```

### 9.2 最近 5 次变更记录（精确到文件+目的）

```
📝 最近变更（按时间倒序）：
- 2026-09-04 10:23 | backend/api/v1/eco_pts.py | 新增 worker-login 端点 (Feat)
- 2026-09-04 09:15 | frontend/src/views/mobile/ScanConfirmView.vue | 修复 GPS 围栏误报 (Fix)
- 2026-09-03 17:40 | contracts/ReformPlan.ts | 增加激进程度字段 (Feat)
```

### 9.3 当前 Git 分支与未提交代码量

```
🌿 当前分支: feature/pwa-offline-queue
📦 未提交变更: 3 个文件 (1 新增, 2 修改)
🚀 领先 origin: 2 个 commits
```

### 9.4 硬红线/风险提示

```
🚨 当前风险/阻塞：
- 无阻断级错误
- ⚠️ 注意：PostgreSQL 连接池使用率已达 85%（开发环境）
```

## 10. 实时更新机制（无 WebSocket，静态懒加载）

- 网页（HTML）本身**不含数据**，只含布局+JS
- 页面加载时，JS 请求 `./data/summary.json` 和 `./data/AGENT_CONTEXT.md`
- `collect.py` 每次运行覆盖写入这两个静态文件
- 网页展示"数据更新于：2026-09-04 10:25:03"，一眼可知是否过期
- **根本不需要常驻后端进程**，完美符合快照模式

**触发时机**：
- 开发服务器启动时（pre-action hook）
- Git commit 后（post-commit hook，可选）
- 手动 `pnpm run panorama:refresh`
- CI 定时（每小时一次全量）

## 11. Agent 强制加载机制

### 11.1 方案 A（最优）：`.cursorrules` / `AGENTS.md`

在项目根目录 `.cursorrules` 或 `AGENTS.md` 写入强制指令：

```markdown
## 强制开机自检（MANDATORY BOOTSTRAP）
在开始任何代码编写、修改、重构之前，**必须先读取** `tools/panorama/AGENT_CONTEXT.md` 文件。
若该文件不存在，立即执行 `cd tools/panorama && python collect.py --quick` 生成后再读取。
严禁在未读取全景状态的情况下直接编写代码。
```

### 11.2 方案 B（补充）：Pre-action Hook

在 `package.json` 或 `Makefile` 增加 pre-dev 钩子：

```json
"scripts": {
  "dev": "npm run panorama:quick && vite",
  "panorama:quick": "cd tools/panorama && python collect.py --quick"
}
```

每次启动本地开发服务器自动刷新全景快照（< 3 秒），Agent 随后读取到的永远是最新的。

### 11.3 方案 C（兜底）：手动 CLI

```bash
python tools/panorama/collect.py --text
```

## 12. AGENT_CONTEXT.md 数据契约

### 12.1 内容结构
1. 项目骨架（8 个一级目录树）
2. 已实现模块列表（按目录归类）
3. 空目录/待开发清单
4. 最近 5 次变更摘要
5. 4 大指标区块（同首页）
6. 待补充注释文件清单
7. 已知阻塞项与风险
8. **上次完成位置**（git HEAD + 未提交文件列表）——对抗上下文窗口限制

### 12.2 大小约束
- 目标 20-50KB
- 超过 50KB 启用截断策略：只保留最近 3 个月变更+当前活跃模块
- **硬上限 100KB**（避免吃光 Agent 上下文窗口）

## 13. trace_report.json 复用路径

### 13.1 适配器函数
在 `collect.py` 中增加 `adapt_trace_report()`：
- 读取 `tools/trace_report.json`
- 将 `file_path` 字段按 `production/` 下的一级目录自动归类到模块树
- 输出"规范对齐"栏（每文件对应 spec 哪章节）

### 13.2 容错策略
- 如果 `trace_report.json` 不存在，`collect.py` 静默跳过规范对齐栏
- 不报错，**渐进式增强**
- 不强制依赖其他脚本先运行

> 避免与既有 `tools/spec_*.py` 系列重复扫描导致两套结果打架。

## 14. 工具目录结构

```
tools/panorama/
├── collect.py                    # 主采集脚本（--quick/--incremental/--full/--text）
├── extractors/                   # 多语言注释提取器
│   ├── python_extractor.py
│   ├── ts_extractor.py
│   ├── vue_extractor.py
│   ├── sql_extractor.py
│   └── yaml_extractor.py
├── analyzers/                    # 依赖与契约分析
│   ├── python_ast_analyzer.py    # Python import 关系
│   ├── ts_analyzer.py            # TS import 关系
│   ├── contract_edge_analyzer.py # 跨语言契约边
│   └── db_edge_analyzer.py      # 数据库读写边
├── state/                        # 状态采集（仅本地开发环境）
│   ├── process_probe.py
│   ├── port_probe.py
│   ├── log_parser.py
│   └── db_probe.py
├── renderers/                    # 渲染器
│   ├── html_renderer.py          # → panorama_dashboard.html
│   ├── markdown_renderer.py      # → AGENT_CONTEXT.md
│   └── json_renderer.py          # → data/summary.json
├── adapters/
│   └── trace_report_adapter.py   # adapt_trace_report()
├── .cache/                       # 增量缓存（.gitignore）
│   ├── file_fingerprints.json
│   └── log_offsets.json
├── data/                         # 产出数据（.gitignore）
│   ├── summary.json
│   └── AGENT_CONTEXT.md
├── templates/                    # HTML 模板
├── manual_overrides.yaml         # 人工中文注释覆盖
├── config.yaml                   # 视角预设、状态阈值
└── requirements.txt              # psutil, ts-morph 等
```

## 15. MVP 切片

### 15.1 第一阶段（地基，必须）
1. `collect.py` 主框架（支持 `--quick/--incremental/--full/--text`）
2. 多语言注释提取器（Python+TS+Vue+SQL+YAML）
3. 文件级指纹缓存（增量基础）
4. Git 增量日志采集
5. 生成 `panorama_data.json`（数据底座）
6. **生成 `AGENT_CONTEXT.md`（机器可读摘要）**
7. 生成 `panorama_dashboard.html`（v-tree 静态树，**不用 D3**）

### 15.2 第二阶段（核心，紧随）
1. 跨语言契约边捕获（frontend ↔ backend）
2. 4 大指标区块（完成度/变更/分支/风险）
3. 三视角预设
4. `.cursorrules` / `AGENTS.md` 强制加载
5. pre-action hook（package.json scripts）

### 15.3 第三阶段（增强，可推迟）
1. 数据库读写边捕获
2. 状态监控（仅本地开发环境）
3. `trace_report.json` 复用适配器
4. 力导向图（D3，等数据稳定后升级）
5. 循环依赖检测（架构师视角，Tarjan SCC）

## 16. 安全清单（部署前自检）

- [ ] 生产环境部署的 `panorama/` 不含 `db_probe.py`
- [ ] 状态栏统一显示"🟡 降级"
- [ ] `AGENT_CONTEXT.md` 不含任何连接串/凭据
- [ ] `.cache/` 与 `data/` 已加入 `.gitignore`
- [ ] `collect.py` 在 production 环境变量下自动跳过 DB 探测
- [ ] 力导向图节点数 > 500 时自动聚类，避免浏览器卡死
- [ ] `AGENT_CONTEXT.md` 大小 < 100KB

## 17. 待澄清问题（v1.1 议题）

1. 修复建议是规则匹配还是 LLM 生成？（v1.0 默认规则匹配，先积累语料）
2. 力导向图何时引入？（等文件数稳定后）
3. 循环依赖检测算法选择？（Tarjan SCC vs NetworkX）
4. `AGENT_CONTEXT.md` 的截断策略是否需要 Agent 配置项？

## 18. 与既有工具的关系

| 工具 | 职责 | 关系 |
|---|---|---|
| `tools/spec_*.py` 系列 | 规范-代码对齐审计 | panorama 通过 `trace_report_adapter` 复用其输出，**不重新扫描** |
| `tools/panorama/`（新） | 结构可视化+状态+Agent 上下文 | 互补，职责清晰 |

## 19. 设计哲学对齐

| 原则 | 本方案体现 |
|---|---|
| 先稳固基础，再攀登高峰 | 第一阶段先做地基（注释+数据底座），力导向图推迟 |
| 傻瓜式操作 | Agent 不做选择题，只读 AGENT_CONTEXT.md 即可 |
| API 接入优先+自研护城河 | 复用 spec_*.py 资产+自研 panorama 提取器 |
| 配置优于训练 | manual_overrides.yaml 人工覆盖优先 |
| 白盒可解释 | 所有边/状态都有溯源（文件路径+行号） |
| 渐进调节 | 三种运行模式渐进，trace_report 缺失静默跳过 |

---

## 附录 A：DeepSeek 对话补丁来源

本 v1.0 整合了以下两轮 DeepSeek 补丁：

**第一轮补丁（v0.1.1）**：
1. 跨语言契约边的具体捕获机制（扫描 frontend/src/api + backend @router 装饰器）
2. 快照生成器的增量更新机制（文件级指纹缓存）
3. 视角切换三套预设的具体定义（上帝/架构师/开发者）
4. 强制隔离：新工具绝不读取生产数据库
5. trace_report.json 复用路径明确（adapt_trace_report 适配器）

**第二轮补丁（Agent 防漂移升级）**：
1. 核心洞察：为 Agent 设计必须优先输出机器可读文本摘要
2. 双产出强制（panorama_dashboard.html + AGENT_CONTEXT.md）
3. Agent 强制加载机制（.cursorrules / pre-action hook / 手动 CLI）
4. 首页 4 大硬指标区块（完成度/变更/分支/风险）
5. 实时更新机制（无 WebSocket，静态懒加载）
6. AGENT_CONTEXT.md 数据契约（含上次完成位置，对抗上下文窗口限制）

---

**最终结论**：本 v1.0 方案可直接作为开发排期依据。下一步建议细化 `collect.py` 伪代码（数据流图+函数签名），或直接进入第一阶段开发排期。
