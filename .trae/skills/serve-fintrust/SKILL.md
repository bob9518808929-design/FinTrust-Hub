---
name: "serve-fintrust"
description: "Windows 下 FinTrust Hub 前后端服务启动/重启/联调标准工作流：端口避让、Vite proxy 配置、健康探测、性能排查。Invoke when user asks to 启动服务/重启服务/前后端联调/接口不通/页面卡顿 or reports 404/timeout/proxy errors."
---

# serve-fintrust — FinTrust Hub 服务启动与联调工作流

本 skill 固化 Windows 环境下 FinTrust Hub（`c:\Users\Windws\Desktop\caiwu\jinrong`）前后端服务启动、端口避让、代理联调、性能排查的完整流程。所有命令均适配 PowerShell，**禁止使用 bash 语法**（`&&`、`tail`、`curl` 简写、`ls -la` 均会失败或挂起）。

## 0. 关键背景（必读）

- **端口 8000 被 taiji-engine 项目占用**（`api.server:app`），FinTrust 后端固定使用 **8001**，不要试图杀掉 8000 的进程。
- 前端 5173（Vite dev）、全景导航 8765（python http.server）、后端 8001。
- DeepSeek API Key 配置在 `production/backend/.env`（已 gitignore），**绝不硬编码到源码**。
- 浏览器访问入口：`http://127.0.0.1:5173/`（用 127.0.0.1 不用 localhost）。

## 1. 启动前检查（一次搞清端口与配置）

```powershell
# 检查端口占用（PowerShell 原生语法）
foreach ($p in 8000, 5173, 8001, 8765) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $pr = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; Write-Output "端口 $p : 占用 (PID $($c.OwningProcess) / $($pr.ProcessName))" }
  else { Write-Output "端口 $p : 空闲" }
}
```

如果 5173/8001 已被本项目的旧进程占用，先停旧进程再启动（见第 4 节重启闭环）。

## 2. 启动后端（后台运行）

```powershell
# cwd 必须是 production/backend
python -m uvicorn app.main:app --port 8001 --host 127.0.0.1
```

用 run_in_background 启动，**必须等待就绪后再宣称成功**（不要只凭"命令已执行"）：

```powershell
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 1000
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8001/health" -UseBasicParsing -TimeoutSec 3
    Write-Output "OK /health $($r.StatusCode)"; $ok = $true; break
  } catch {}
}
if (-not $ok) { Get-Content "<后台任务 output.log>" -Tail 20 }
```

健康响应：`{"code":0,...,"data":{"status":"ok","version":"3.1.0",...}}`

## 3. 启动前端（Vite dev）

```powershell
# cwd 必须是 production/frontend；node_modules 已存在
npm.cmd run dev
```

同样后台运行 + 轮询 `http://127.0.0.1:5173/` 直到 200。

### 3.1 proxy 配置铁律（踩过的坑，勿回退）

文件 `production/frontend/.env.development.local`（已 gitignore，不入库）：

```ini
# 8000 被 taiji-engine 占用，FinTrust 后端用 8001
# 用 127.0.0.1 不用 localhost：避免 Node 解析 localhost 先走 IPv6(::1) 失败回退的延迟
VITE_PROXY_TARGET=http://127.0.0.1:8001
```

**绝对不要设 `VITE_BACKEND_URL`**！该变量被 `src/api/client.ts` 用作浏览器直连 axios baseURL，设了会导致浏览器直连后端并丢失 `/api/v1` 前缀 → 所有接口 404（症状：后端日志出现 `GET /enterprises 404`，缺少 `/api/v1`）。正确链路：浏览器走相对路径 `/api/v1/*` → Vite proxy → 8001。

`vite.config.ts` 中 proxy target 读取顺序：`VITE_PROXY_TARGET || VITE_BACKEND_URL || 'http://localhost:8000'`。

**proxyTimeout 必须保持 65000**（`vite.config.ts`）：
- 普通接口实测 4-22ms，超时无影响；
- DeepSeek LLM 请求（R1 画像 / deep_score / 合同提取）需 2-10s，曾被设为 3500ms 导致 AI 请求全部被切断 → 前端报错重试 → 用户感知"卡顿离谱"；
- 后端未启动时 ECONNREFUSED 立即失败，不依赖超时。

### 3.2 vite.config.ts 变更后必须重启 Vite

env 文件与 vite.config.ts 的改动**不会热更新 proxy**。重启闭环见第 4 节。

## 4. 重启闭环（停止→确认端口释放→启动→验证）

```powershell
# 1. 停旧进程（用 StopCommand 停后台任务，再兜底杀端口占用者）
$c = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { Stop-Process -Id $c.OwningProcess -Force; Start-Sleep -Seconds 1 }

# 2. 重启（后台）→ 3. 轮询就绪 → 4. 用 httpx 验证 proxy 链路（见第 5 节）
```

**进程-终端-端口映射纪律**：后端/前端/全景导航各自固定一个后台任务，不要在同一终端交替启动不同服务；停止时只操作对应的 command_id。

## 5. 健康探测与性能排查

### 5.1 用 Python httpx 测真实延迟（关键方法论）

PowerShell `Invoke-RestMethod` 会因**系统代理探测**给每个请求虚增约 2 秒（服务端其实只要几毫秒），曾导致误判"后端慢"。测真实延迟一律用：

```powershell
python -c "
import asyncio, time, httpx
async def main():
    async with httpx.AsyncClient(timeout=70) as c:
        for ep in ['/health', '/api/v1/enterprises', '/api/v1/reform/E001/state']:
            t=time.time(); r=await c.get('http://127.0.0.1:5173'+ep)
            print(f'{ep:40s} {int((time.time()-t)*1000):5d} ms  {r.status_code}')
asyncio.run(main())
"
```

（内嵌双引号脚本在 PowerShell 里转义易碎，长脚本写成临时 .py 文件执行，测完删除。）

预期：常规接口 4-22ms；R1 AI 画像（LLM）1-10s 且 HTTP 200（证明未被 proxyTimeout 切断）。

### 5.2 后端访问日志是链路铁证

后台任务 output.log 中 uvicorn 会打印每条请求。排查"前端接口不通"时**先看后端日志**：
- 出现 `GET /api/v1/enterprises 200` → 链路通，前端报错可能是旧 console 残留/时序误判；
- 出现 `GET /enterprises 404`（无 /api/v1 前缀）→ 违反 3.1 铁律，检查是否误设 VITE_BACKEND_URL；
- 完全没有请求记录 → proxy target 或端口不对。

### 5.3 AI 链路冒烟（DeepSeek）

`production/backend/.env` 中 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL=deepseek-chat`。四条真实链路（写临时脚本跑，测完删）：

1. `llm_service.chat` 直接问答（断言 `model=='deepseek-chat'` 且 `fallback in (None, False, 'none')`——注意成功时 fallback 是字符串 `"none"` 不是 False）
2. `performance_score_service.deep_score('E001')`（断言 data_sources 含 `llm_deep_score`）
3. `contract_service.extract_info`（断言 extraction_method 含 `llm`）
4. `ai_orchestrator handle_score`（断言返回 score）

HTTP 端点验证：`POST http://127.0.0.1:8001/api/v1/reform/E001/portrait` → 200 + 八维评分卡（subject/finance/tax/business/assets/credit/policy/capital）。

## 6. 浏览器端到端验证（browser_use 注意事项）

- 让 browser_use 用 `http://127.0.0.1:5173/`，**等 8 秒 network idle**，不要急着截图（曾误报 404 实为硬刷新瞬间旧 console 残留）；
- browser_use 报错与后端日志矛盾时，**以后端访问日志为准**（5.2）；
- dev 模式 PWA Service Worker 已禁用（`devOptions.enabled: false`），排除 SW 缓存嫌疑；
- browser_use 受控实例可能残留 Vite 错误覆盖层——要求它**关闭旧标签页、新开标签页**全新访问再判断；
- 用户自己的浏览器若残留旧覆盖层，按 F5 刷新即可。

## 7. 全景导航（附带）

```powershell
# cwd: tools/panorama
python -m http.server 8765   # 已有数据时直接起；刷新数据: python collect.py --quick (0.8s) / --full (7s)
```

面板：`http://localhost:8765/panorama_dashboard.html`（HTTP 模式下自动 fetch 最新 summary.json）。

## 8. 常见错误速查

| 症状 | 根因 | 处置 |
|------|------|------|
| 后端日志 `GET /enterprises 404`（无前缀） | 误设 VITE_BACKEND_URL，浏览器直连丢前缀 | 删掉该变量，用 VITE_PROXY_TARGET（3.1） |
| AI 请求报"网络异常/超时"，常规接口正常 | proxyTimeout 过小（3500ms）切断 LLM | 确认 vite.config.ts 为 65000（3.1） |
| proxy ECONNREFUSED / 偶发慢 | target 用 localhost 走 IPv6 失败回退 | target 用 `http://127.0.0.1:8001` |
| PowerShell 测出所有接口 2 秒 | Invoke-RestMethod 系统代理探测开销 | 用 httpx 测真实延迟（5.1） |
| 改了 .env.local / vite.config 后行为不变 | Vite proxy 不热更新 | 完整重启 Vite（第 4 节） |
| curl 命令挂起要求输入 Uri | PowerShell curl 是 Invoke-WebRequest 别名 | 一律 Invoke-RestMethod/-WebRequest 显式传参 |
| `&&` 或 `tail` 报错 | bash 语法不兼容 PowerShell | 用 PowerShell 原生语法或 Python 内做输出截断 |
| HomeView 白屏 + Vite 覆盖层 Undefined variable | SCSS 变量名不存在（间距只有 xs/sm/base/lg/xl/xxl，**没有 md**） | 查 `src/styles/variables.scss` 后修正变量名 |
