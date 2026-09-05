---
name: "panorama-serve"
description: "全景导航面板（panorama_dashboard）的本地静态服务启动、数据刷新、HTTP 健康探测与 404 排查标准工作流。Invoke when user asks to 启动/打开/重启全景导航面板、刷新面板数据/完成度、面板 404/数据不更新/@vite/client 报错，或代码对齐归档后需要验证面板完成度。"
---

# panorama-serve — 全景导航面板服务工作流

仓库根目录: `c:\Users\Windws\Desktop\caiwu\jinrong`
面板入口: `tools/panorama/panorama_dashboard.html`
数据文件: `tools/panorama/data/summary.json` + `panorama_data.json`
专用服务器: `tools/panorama/serve.py`（带 204 兜底，见步骤 2）

## 步骤 1 — 按需刷新数据（先于启动服务）

在仓库根目录执行（PowerShell）：

- 日常改动后快速刷新（文件指纹缓存，~0.8s）：
  `python tools/panorama/collect.py --quick`
- 以下情况必须全量刷新（~7s）：发版/里程碑后、修改了 `collect.py` 检测规则后、文档代码全量对齐归档：
  `python tools/panorama/collect.py --full`
- 注意：`--quick` 按文件指纹复用缓存，**改检测规则不会对未改动文件生效**，规则调整后必须 `--full`。

## 步骤 2 — 启动静态服务（用 serve.py，不要用 http.server）

```powershell
cd C:\Users\Windws\Desktop\caiwu\jinrong
python tools/panorama/serve.py 8765
```

- 用 `run_in_background` 启动；成功后输出「全景导航面板: http://localhost:8765/panorama_dashboard.html」。
- **不要**用 `python -m http.server 8765`：它对 `/@vite/client`、`/favicon.ico` 返回 404 噪声日志。`serve.py` 对这两个路径返回 204（`/@vite/client` 来自前端 vite-plugin-pwa 的 Service Worker 残留注入，非面板引用）。
- **端口避让**：启动前检查占用：
  `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue`
  被占用时换端口参数（如 `python tools/panorama/serve.py 8770`），不要直接 kill 用户终端里的进程。
- **禁止** `Stop-Process -Name python`：会误杀用户终端中的 http.server/uvicorn 等全部 Python 进程。需要停后台任务时用 StopCommand 传具体 command_id。

## 步骤 3 — HTTP 健康探测（三个端点）

```powershell
(Invoke-WebRequest "http://127.0.0.1:8765/panorama_dashboard.html" -UseBasicParsing).StatusCode   # 期望 200
(Invoke-WebRequest "http://127.0.0.1:8765/data/summary.json" -UseBasicParsing).StatusCode        # 期望 200
(Invoke-WebRequest "http://127.0.0.1:8765/@vite/client" -UseBasicParsing -SkipHttpErrorCheck).StatusCode  # 期望 204
```

进一步校验 summary.json 的 `generated_at` 为当前时间、`mode` 为 quick/full、`completion_rate` 字段存在。

## 步骤 4 — 给出预览与刷新提示

- 用 OpenPreview 打开 `http://localhost:8765/panorama_dashboard.html`。
- 提示用户：浏览器 F5 刷新；数据仍旧时 Ctrl+F5 硬刷新或 URL 加 `?fresh=1`。

## 常见问题

| 现象 | 根因与处理 |
|---|---|
| 日志刷 `GET /@vite/client 404` | PWA Service Worker 残留（该 origin 历史跑过 Vite dev server）。serve.py 已 204 兜底；彻底清除：DevTools → Application → Service Workers → Unregister，并清站点缓存 |
| 面板数据不更新 | 先确认 summary.json 的 generated_at；`--quick` 缓存未失效则跑 `--full`；浏览器侧 Ctrl+F5 |
| 完成度没变（改了桩文件） | 桩标记判定在 collect.py `_detect_impl_status`：TODO/FIXME/NotImplementedError/桩实现/待接入(注释或桩载荷行) 命中即 partial/skeleton；运行时降级文案不算。改代码后必须 `--full` |
| favicon.ico 404 | 正常噪声，serve.py 已 204 静默 |
