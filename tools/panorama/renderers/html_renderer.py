# 文件名：html_renderer.py
# 职责：生成 panorama_dashboard.html（v-tree 静态树 + 4 大指标区块）
# 设计哲学：v1.0 先用 v-tree 不用 D3，等数据稳定后升级

"""panorama_dashboard.html 渲染器

页面结构：
  - 顶部：4 大指标区块（完成度/最近变更/Git 分支/风险）
  - 左侧：v-tree 静态目录树（可折叠）
  - 右侧：模块详情卡片（点击左侧节点加载）
  - 底部：数据更新时间

设计哲学：
  - 静态懒加载：HTML 不含数据，JS 请求 ./data/summary.json
  - 无 WebSocket：网页展示"数据更新于"时间，一眼可知是否过期
  - 傻瓜式操作：无需配置，双击 HTML 即可打开
"""

from __future__ import annotations

import html
import json
from pathlib import Path


def render_dashboard_html(snapshot, config: dict) -> str:
    """渲染 panorama_dashboard.html

    Args:
        snapshot: PanoramaSnapshot 实例
        config: 配置 dict

    Returns:
        HTML 字符串
    """
    # 把数据嵌入（兜底，如果 JS fetch 失败也能显示）
    orphan_edges = [e for e in snapshot.contract_edges if e.get("is_orphan")]
    summary_json = json.dumps({
        "generated_at": snapshot.generated_at,
        "mode": snapshot.mode,
        "total_files": snapshot.total_files,
        "total_modules": snapshot.total_modules,
        "total_lines": snapshot.total_lines,
        "completion_rate": snapshot.completion_rate,
        "completed_modules": snapshot.completed_modules,
        "git_summary": snapshot.git_summary,
        "risks": snapshot.risks,
        "missing_annotations": snapshot.missing_annotations,
        "contract_edges_count": len(snapshot.contract_edges),
        "orphan_count": len(orphan_edges),
        "contract_edges": snapshot.contract_edges,
        "dependency_edges_count": len(snapshot.dependency_edges),
        "completion_breakdown": snapshot.completion_breakdown,
        "doc_health": snapshot.doc_health,
    }, ensure_ascii=False, indent=2)

    # 文件树数据（含影响面/符号, 供三视角+搜索+高风险标红）
    tree_data = _build_tree_data(snapshot.files)

    # 在 <script> 中嵌入 JSON：不能使用 html.escape（&quot; 在 JS 中非法）
    # 只需防止 </script> 注入：把 </ 替换为 <\/
    summary_safe = summary_json.replace("</", "<\\/")
    tree_safe = json.dumps(tree_data, ensure_ascii=False).replace("</", "<\\/")

    return _HTML_TEMPLATE.format(
        summary_json=summary_safe,
        tree_data=tree_safe,
        generated_at=snapshot.generated_at,
        mode=snapshot.mode,
    )


def _build_tree_data(files) -> dict:
    """构建文件树数据结构"""
    root = {"name": "production", "children": {}}
    for fi in files:
        parts = fi.path.replace("\\", "/").split("/")
        node = root
        for i, part in enumerate(parts):
            if part not in node["children"]:
                node["children"][part] = {
                    "name": part,
                    "children": {},
                    "is_file": (i == len(parts) - 1),
                    "path": "/".join(parts[:i+1]),
                }
            node = node["children"][part]
            if i == len(parts) - 1:
                node["name_cn"] = fi.name_cn or "📝 待补充"
                node["responsibility_cn"] = fi.responsibility_cn
                node["language"] = fi.language
                node["line_count"] = fi.line_count
                node["status"] = fi.status
                node["impl_status"] = fi.impl_status
                node["impl_markers"] = fi.impl_markers
                # 影响面（被多少文件引用 = 改动风险）+ 符号（类名/函数名搜索）
                node["ibc"] = len(fi.imported_by)   # imported-by count
                node["ib"] = fi.imported_by[:15]     # 引用方（封顶 15 防膨胀）
                node["ic"] = len(fi.imports)         # imports count
                node["sym"] = fi.symbols[:30]
                node["cc"] = fi.class_count          # 类数量
                node["fc"] = fi.function_count       # 函数数量
                node["preview"] = fi.source_preview  # 源码前 30 行
                # 依赖明细 / 第三方库 / Git 变更 / 结构化类与函数 / 待办计数
                node["deps"] = list(fi.imports[:20])
                node["libs"] = list(fi.imports_external[:15])
                node["gitlog"] = list(fi.git_log[:3])
                node["cls"] = [
                    {"n": c.get("n", ""), "m": list(c.get("m", [])),
                     "d": c.get("d", "")} for c in fi.classes[:20]
                ]
                node["fns"] = [
                    {"n": f.get("n", ""), "d": f.get("d", "")}
                    for f in fi.functions[:30]
                ]
                node["todo"] = fi.todo_count

    # 目录节点补中文名（取该目录 __init__.py 的中文名）
    def set_dir_cn(node):
        for child in node.get("children", {}).values():
            if child.get("is_file"):
                continue
            init_f = child["children"].get("__init__.py")
            if init_f and init_f.get("name_cn") and init_f["name_cn"] != "📝 待补充":
                child["dcn"] = init_f["name_cn"]
            set_dir_cn(child)
    set_dir_cn(root)

    # 转为数组结构
    def to_array(node):
        children = node.get("children", {})
        if not children:
            node.pop("children", None)
            return node
        node["children"] = [to_array(c) for c in children.values()]
        return node
    return to_array(root)


# ============================================================================
# HTML 模板（嵌入式，无外部依赖）
# ============================================================================

_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FinTrust Hub 全景导航 - 数据更新于 {generated_at}</title>
<style>
:root {{
  /* 深色设计 token — 克制专业风 (GitHub Dark / Linear 调性) */
  --bg-base: #0d1117;
  --bg-surface: #161b22;
  --bg-elevated: #1c2128;
  --border: #2d333b;
  --border-muted: #21262d;
  --text-primary: #e6edf3;
  --text-secondary: #adbac7;
  --text-muted: #768390;
  --accent: #4493f8;
  --accent-fg: #79b8ff;
  --accent-bg: rgba(68,147,248,0.12);
  --green: #3fb950;
  --green-fg: #56d364;
  --green-bg: rgba(63,185,80,0.12);
  --yellow: #d29922;
  --yellow-fg: #e3b341;
  --yellow-bg: rgba(210,153,34,0.14);
  --red: #f85149;
  --red-fg: #ff7b72;
  --red-bg: rgba(248,81,73,0.12);
  --radius-card: 10px;
  --radius-ctrl: 6px;
  --mono: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, Monaco, monospace;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}}
::selection {{ background: rgba(68,147,248,0.35); }}
::-webkit-scrollbar {{ width: 10px; height: 10px; }}
::-webkit-scrollbar-track {{ background: transparent; }}
::-webkit-scrollbar-thumb {{
  background: #30363d; border-radius: 5px;
  border: 2px solid var(--bg-base);
}}
::-webkit-scrollbar-thumb:hover {{ background: #3d444d; }}
code {{
  font-family: var(--mono); font-size: 12px;
  background: var(--bg-elevated); color: var(--accent-fg);
  padding: 1px 5px; border-radius: 4px;
}}

/* === 顶栏 === */
.header {{
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  padding: 18px 28px;
}}
.header h1 {{
  font-size: 19px; font-weight: 700; letter-spacing: 0.2px;
  margin-bottom: 4px; display: flex; align-items: center; gap: 10px;
}}
.header h1::before {{
  content: ''; width: 4px; height: 18px; border-radius: 2px;
  background: var(--accent);
}}
.header .meta {{ font-size: 12px; color: var(--text-muted); padding-left: 14px; }}

/* === 指标卡片 === */
.metrics-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
  padding: 20px 24px 4px;
}}
.metric-card {{
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-card);
  padding: 14px 16px;
  border-left: 3px solid var(--accent);
  display: flex; flex-direction: column; gap: 6px;
  transition: border-color .15s ease, transform .15s ease;
}}
.metric-card:hover {{ border-color: var(--border); transform: translateY(-1px); }}
.metric-card.completion {{ border-left-color: var(--green); }}
.metric-card.recent {{ border-left-color: var(--accent); }}
.metric-card.branch {{ border-left-color: var(--yellow); }}
.metric-card.risk {{ border-left-color: var(--red); }}
.metric-card h3 {{
  font-size: 12px; color: var(--text-muted); font-weight: 500;
  margin-bottom: 8px; letter-spacing: 0.3px;
}}
.metric-card pre {{
  font-family: var(--mono); font-size: 13px;
  white-space: pre-wrap; line-height: 1.6;
  color: var(--text-secondary);
}}
.metric-card.completion pre {{ color: var(--green-fg); }}
.metric-card.branch pre {{ color: var(--yellow-fg); }}
.metric-card.risk pre {{ color: var(--red-fg); }}

/* === 主内容双栏 === */
.main-content {{
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 16px;
  padding: 16px 24px 24px;
  align-items: start;
}}
.sidebar {{
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-card);
  padding: 14px;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  position: sticky;
  top: 16px;
}}
.sidebar h2 {{
  font-size: 13px; margin-bottom: 10px; padding-bottom: 8px;
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-secondary); font-weight: 600;
}}
.tree-node {{ margin-left: 14px; }}
.tree-toggle {{
  cursor: pointer; user-select: none;
  padding: 3px 6px; border-radius: 4px; color: var(--text-secondary);
}}
.tree-toggle:hover {{ background: var(--bg-elevated); }}
.tree-toggle::before {{
  content: '▶'; display: inline-block; width: 12px;
  font-size: 9px; color: var(--text-muted); transition: transform 0.15s;
}}
.tree-toggle.expanded::before {{ transform: rotate(90deg); }}
.tree-children {{ display: none; }}
.tree-children.expanded {{ display: block; }}
.tree-file {{
  display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px;
  padding: 3px 6px; cursor: pointer; border-radius: 4px;
  color: var(--text-secondary); font-size: 13px;
}}
.tree-file .fname {{ color: var(--text-primary); font-weight: 500; }}
.fname-cn {{
  font-size: 11px; color: var(--text-muted);
  max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}}
.fname-cn.missing {{ font-style: italic; opacity: 0.55; }}
.tree-file .impl-badge {{ margin-left: auto; }}
.tree-file:hover {{ background: var(--bg-elevated); }}
.tree-file.active {{ background: var(--accent-bg); color: var(--accent-fg); }}
.detail-panel {{
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  min-height: 300px;
}}
.detail-panel h2 {{ font-size: 15px; margin-bottom: 12px; font-weight: 600; }}
.badge {{
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 11px; margin-left: 8px; font-weight: 500;
  border: 1px solid transparent;
}}
.badge.healthy {{ background: var(--green-bg); color: var(--green-fg); border-color: rgba(63,185,80,0.3); }}
.badge.degraded {{ background: var(--yellow-bg); color: var(--yellow-fg); border-color: rgba(210,153,34,0.3); }}
.badge.fault {{ background: var(--red-bg); color: var(--red-fg); border-color: rgba(248,81,73,0.3); }}
.badge.no_state {{ background: var(--bg-elevated); color: var(--text-muted); border-color: var(--border); }}
.status-dot {{
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; margin-right: 6px;
}}
.impl-badge {{
  display: inline-block; padding: 0 5px; margin-left: 6px;
  border-radius: 4px; font-size: 10px; cursor: help; font-weight: 600;
}}
.impl-partial {{ background: var(--yellow-bg); color: var(--yellow-fg); }}
.impl-skeleton {{ background: var(--accent-bg); color: var(--accent-fg); }}
.impl-placeholder {{ background: var(--bg-elevated); color: var(--text-muted); }}
.search-box {{
  width: 100%; padding: 7px 11px;
  border: 1px solid var(--border); border-radius: var(--radius-ctrl);
  font-size: 13px; margin-bottom: 10px;
  background: var(--bg-base); color: var(--text-primary);
  outline: none; transition: border-color .15s, box-shadow .15s;
}}
.search-box::placeholder {{ color: var(--text-muted); }}
.search-box:focus {{ border-color: var(--accent); box-shadow: 0 0 0 3px rgba(68,147,248,0.15); }}
.empty {{ color: var(--text-muted); text-align: center; padding: 32px; }}

/* === 系统总览 === */
.system-overview {{
  margin: 16px 24px 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-card);
  padding: 20px 24px;
}}
.system-overview h2 {{
  font-size: 15px; margin-bottom: 16px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-primary); font-weight: 600;
  display: flex; align-items: center; gap: 8px;
}}
.system-overview h2::before {{
  content: ''; width: 3px; height: 14px; border-radius: 2px;
  background: var(--accent);
}}
.system-overview h3 {{
  font-size: 13px; color: var(--text-secondary); margin: 16px 0 8px;
  padding-left: 10px; border-left: 3px solid var(--accent);
  font-weight: 600;
}}
.system-overview p {{ font-size: 13px; color: var(--text-secondary); line-height: 1.8; margin-bottom: 6px; }}
.system-overview ul {{ margin: 4px 0 8px 20px; }}
.system-overview li {{ font-size: 13px; color: var(--text-secondary); line-height: 1.9; }}
.system-overview .tag {{
  display: inline-block; padding: 1px 9px; border-radius: 4px;
  font-size: 11px; margin: 2px;
  background: var(--bg-elevated); color: var(--text-secondary);
  border: 1px solid var(--border-muted);
}}
.system-overview .tag.core {{ background: var(--accent-bg); color: var(--accent-fg); border-color: rgba(68,147,248,0.25); }}
.system-overview .tag.crit {{ background: var(--red-bg); color: var(--red-fg); border-color: rgba(248,81,73,0.25); }}

/* === 诊断区 === */
.diagnostics-section {{
  margin: 16px 24px 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-card);
  padding: 16px 20px;
}}
.diagnostics-section h2 {{
  font-size: 14px; margin-bottom: 12px; padding-bottom: 8px;
  border-bottom: 1px solid var(--border-muted); font-weight: 600;
}}
.diag-tabs {{ display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }}
.diag-tab {{
  padding: 5px 13px; border-radius: var(--radius-ctrl); cursor: pointer;
  font-size: 12px; background: var(--bg-elevated); color: var(--text-secondary);
  border: 1px solid var(--border-muted); transition: all .15s;
}}
.diag-tab:hover {{ border-color: var(--border); color: var(--text-primary); }}
.diag-tab.active {{
  background: var(--accent); color: #fff;
  border-color: var(--accent); font-weight: 600;
}}
.diag-table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
.diag-table th {{
  text-align: left; padding: 8px 10px;
  background: var(--bg-elevated); color: var(--text-muted);
  font-weight: 600; font-size: 11px; letter-spacing: 0.4px;
  border-bottom: 1px solid var(--border);
}}
.diag-table td {{
  padding: 8px 10px; border-bottom: 1px solid var(--border-muted);
  color: var(--text-secondary); word-break: break-all;
}}
.diag-table tbody tr {{ transition: background .12s; }}
.diag-table tbody tr:hover {{ background: var(--bg-elevated); }}
.diag-table tr.orphan {{ background: var(--red-bg); }}
.diag-table tr.orphan:hover {{ background: rgba(248,81,73,0.18); }}
.diag-table tr.matched {{ background: var(--green-bg); }}
.diag-table tr.matched:hover {{ background: rgba(63,185,80,0.18); }}
.badge-orphan {{
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 11px; background: var(--red-bg); color: var(--red-fg); font-weight: 500;
}}
.badge-matched {{
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 11px; background: var(--green-bg); color: var(--green-fg); font-weight: 500;
}}
.diag-panel {{ display: none; }}
.diag-panel.active {{ display: block; }}
.missing-list {{
  max-height: 300px; overflow-y: auto; font-size: 12px;
  color: var(--text-secondary);
}}
.missing-list li {{ padding: 5px 0; border-bottom: 1px solid var(--border-muted); }}

/* === 三视角切换 === */
.perspective-bar {{ display: flex; gap: 6px; margin-bottom: 10px; }}
.persp-btn {{
  flex: 1; padding: 6px 4px; border-radius: var(--radius-ctrl); cursor: pointer;
  font-size: 12px; background: var(--bg-elevated); color: var(--text-secondary);
  border: 1px solid var(--border-muted); text-align: center;
  user-select: none; transition: all .15s;
}}
.persp-btn:hover {{ border-color: var(--border); color: var(--text-primary); }}
.persp-btn.active {{
  background: var(--accent); color: #fff;
  border-color: var(--accent); font-weight: 600;
}}
.persp-hint {{ font-size: 11px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.6; }}

/* === 影响面角标 === */
.impact-badge {{
  display: inline-block; padding: 0 7px; margin-left: 4px;
  border-radius: 999px; font-size: 10px; font-weight: 600;
  background: var(--bg-elevated); color: var(--text-muted);
  border: 1px solid var(--border-muted); cursor: help;
}}
.impact-badge.mid {{ background: var(--yellow-bg); color: var(--yellow-fg); border-color: rgba(210,153,34,0.3); }}
.impact-badge.high {{ background: var(--red-bg); color: var(--red-fg); border-color: rgba(248,81,73,0.3); }}
.tree-file.high-risk {{ background: rgba(248,81,73,0.08); }}
.tree-file.high-risk:hover {{ background: rgba(248,81,73,0.16); }}
.tree-file.high-risk .fname {{ color: var(--red-fg); font-weight: 600; }}

.impact-panel {{
  margin: 10px 0; padding: 10px 14px; border-radius: var(--radius-ctrl);
  font-size: 13px; line-height: 1.7;
  border: 1px solid var(--border-muted);
}}
.impact-panel.high {{ background: var(--red-bg); border-left: 3px solid var(--red); }}
.impact-panel.mid {{ background: var(--yellow-bg); border-left: 3px solid var(--yellow); }}
.impact-panel.low {{ background: var(--green-bg); border-left: 3px solid var(--green); }}
.impact-panel ul {{ margin: 6px 0 0 18px; font-size: 12px; color: var(--text-secondary); }}

/* === 诊断折叠 === */
details.diag-details {{
  margin: 16px 24px 24px; background: var(--bg-surface);
  border: 1px solid var(--border-muted); border-radius: var(--radius-card);
  padding: 14px 20px;
}}
details.diag-details > summary {{
  cursor: pointer; font-size: 14px; font-weight: 600;
  color: var(--text-primary);
  list-style: none; user-select: none; padding: 4px 0;
}}
details.diag-details > summary::-webkit-details-marker {{ display: none; }}
details.diag-details > summary::before {{
  content: '▶'; display: inline-block; margin-right: 8px;
  font-size: 10px; color: var(--text-muted); transition: transform 0.15s;
}}
details.diag-details[open] > summary::before {{ transform: rotate(90deg); }}
.diag-summary-line {{
  display: inline-block; font-size: 12px; font-weight: 400;
  color: var(--text-secondary); margin-left: 8px;
}}
.diag-summary-line .pill {{
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  background: var(--bg-elevated); color: var(--text-secondary);
  margin-left: 6px; font-size: 11px; border: 1px solid var(--border-muted);
}}
.diag-summary-line .pill.warn {{ background: var(--yellow-bg); color: var(--yellow-fg); border-color: rgba(210,153,34,0.3); }}
.diag-summary-line .pill.danger {{ background: var(--red-bg); color: var(--red-fg); border-color: rgba(248,81,73,0.3); }}
.diag-summary-line .pill.ok {{ background: var(--green-bg); color: var(--green-fg); border-color: rgba(63,185,80,0.3); }}
.diag-body {{ margin-top: 12px; }}

/* === 文档健康 === */
.doc-health-grid {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px; margin: 12px 0;
}}
.dh-card {{
  background: var(--bg-elevated); border-radius: var(--radius-ctrl);
  padding: 12px 14px; border: 1px solid var(--border-muted);
  border-top: 3px solid var(--accent);
}}
.dh-card.ok {{ border-top-color: var(--green); }}
.dh-card.warn {{ border-top-color: var(--yellow); }}
.dh-card.danger {{ border-top-color: var(--red); }}
.dh-card .num {{ font-size: 24px; font-weight: 700; color: var(--text-primary); font-family: var(--mono); }}
.dh-card .lbl {{ font-size: 12px; color: var(--text-muted); margin-top: 2px; }}
.dh-realtime {{
  font-size: 12px; color: var(--text-secondary);
  background: var(--accent-bg); border: 1px solid rgba(68,147,248,0.2);
  border-radius: var(--radius-ctrl); padding: 7px 12px; margin: 10px 0;
}}
.dh-realtime .dot-live {{
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--green-fg); margin-right: 6px;
  animation: dh-pulse 1.6s infinite;
}}
@keyframes dh-pulse {{
  0%, 100% {{ opacity: 1; }} 50% {{ opacity: 0.25; }}
}}
.dh-list {{ margin: 6px 0 6px 18px; font-size: 12px; color: var(--text-secondary); }}
.dh-list li {{ margin-bottom: 5px; line-height: 1.7; }}
.dh-nextsteps {{
  background: var(--green-bg); border: 1px solid rgba(63,185,80,0.25);
  border-radius: var(--radius-ctrl); padding: 10px 14px;
  margin-top: 12px; font-size: 12px; color: var(--green-fg); line-height: 1.8;
}}
.dh-toggle {{ cursor: pointer; color: var(--accent-fg); font-size: 12px; user-select: none; }}
.dh-toggle:hover {{ text-decoration: underline; }}

/* === 详情面板: 状态条 / 元信息 / 代码结构 / 源码预览 === */
.impl-badge.done {{
  background: var(--green-bg); color: var(--green-fg);
}}
.detail-title-cn {{
  font-size: 14px; font-weight: 400; color: var(--text-muted);
  margin-left: 10px;
}}
.detail-meta {{
  display: flex; flex-wrap: wrap; gap: 6px 16px;
  font-size: 12px; color: var(--text-muted);
  padding: 8px 0 12px; border-bottom: 1px solid var(--border-muted);
  margin-bottom: 12px;
}}
.detail-meta b {{ color: var(--text-secondary); font-weight: 600; }}
.status-strip {{
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px;
  padding: 8px 12px; border-radius: var(--radius-ctrl);
  font-size: 13px; margin: 10px 0;
  border: 1px solid var(--border-muted);
}}
.status-strip.done {{ background: var(--green-bg); border-color: rgba(63,185,80,0.3); }}
.status-strip.done strong {{ color: var(--green-fg); }}
.status-strip.partial {{ background: var(--yellow-bg); border-color: rgba(210,153,34,0.3); }}
.status-strip.partial strong {{ color: var(--yellow-fg); }}
.status-strip.skeleton {{ background: var(--accent-bg); border-color: rgba(68,147,248,0.3); }}
.status-strip.skeleton strong {{ color: var(--accent-fg); }}
.status-strip.placeholder {{ background: var(--bg-elevated); }}
.status-strip.placeholder strong {{ color: var(--text-muted); }}
.status-markers {{ font-size: 11px; color: var(--text-muted); }}
.impact-sub {{ font-size: 12px; color: var(--text-muted); margin-top: 6px; }}
.detail-h3 {{
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  margin: 18px 0 8px; padding-left: 9px;
  border-left: 3px solid var(--accent);
}}
.h3-sub {{ font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }}
.detail-resp {{
  font-size: 13px; color: var(--text-secondary);
  line-height: 1.8; background: var(--bg-elevated);
  border: 1px solid var(--border-muted); border-radius: var(--radius-ctrl);
  padding: 10px 14px;
}}
.sym-chips {{ display: flex; flex-wrap: wrap; gap: 6px; }}
.sym-chip {{
  font-family: var(--mono); font-size: 11px;
  padding: 3px 9px; border-radius: 999px;
  background: var(--bg-elevated); border: 1px solid var(--border-muted);
  color: var(--text-secondary);
}}
.sym-chip.cls {{ background: var(--accent-bg); color: var(--accent-fg); border-color: rgba(68,147,248,0.25); }}
.sym-chip.fn {{ background: var(--green-bg); color: var(--green-fg); border-color: rgba(63,185,80,0.25); }}
.code-preview {{
  background: #0a0e14; border: 1px solid var(--border-muted);
  border-radius: var(--radius-ctrl);
  padding: 12px 0; overflow-x: auto;
  font-family: var(--mono); font-size: 12px; line-height: 1.7;
}}
.code-preview code {{
  background: none; color: var(--text-secondary); padding: 0;
  display: block;
}}
.code-preview .ln {{
  display: inline-block; width: 44px; text-align: right;
  padding-right: 12px; margin-right: 12px;
  color: #444c56; user-select: none;
  border-right: 1px solid var(--border-muted);
}}
.missing-note {{
  margin-top: 16px; padding: 10px 14px;
  background: var(--yellow-bg); border: 1px solid rgba(210,153,34,0.3);
  border-radius: var(--radius-ctrl);
  font-size: 12px; color: var(--yellow-fg); line-height: 1.8;
}}
.detail-empty {{
  min-height: 320px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; gap: 6px;
  color: var(--text-muted);
}}
.detail-empty-icon {{ font-size: 40px; opacity: 0.7; margin-bottom: 8px; }}
.detail-empty h2 {{ font-size: 16px; color: var(--text-secondary); font-weight: 600; }}
.detail-empty p {{ font-size: 13px; }}
.detail-empty-tip {{ margin-top: 10px; font-size: 12px; line-height: 2; }}

/* === 首页 / 模块概览 / 依赖 / 类结构 / Git === */
.detail-nav {{ display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }}
.back-btn {{
  cursor: pointer; font-size: 12px; color: var(--accent-fg);
  background: var(--bg-elevated); border: 1px solid var(--border-muted);
  border-radius: var(--radius-ctrl); padding: 3px 10px; user-select: none;
}}
.back-btn:hover {{ border-color: var(--accent); }}
.breadcrumb {{ font-size: 11px; color: var(--text-muted); }}
.detail-path {{ font-size: 12px; color: var(--text-muted); margin-bottom: 8px; word-break: break-all; }}
.home-intro {{
  font-size: 13px; color: var(--text-secondary);
  background: var(--bg-elevated); border-left: 3px solid var(--accent);
  padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 14px;
}}
.home-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; }}
.home-panel {{
  background: var(--bg-elevated); border: 1px solid var(--border-muted);
  border-radius: var(--radius-card); padding: 12px 14px;
}}
.home-panel .detail-h3 {{ margin-top: 0; }}
.mod-list {{ list-style: none; margin: 0; padding: 0; }}
.mod-item {{
  padding: 5px 8px; border-radius: 5px; cursor: pointer;
  font-size: 13px; color: var(--text-secondary);
  display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px;
}}
.mod-item:hover {{ background: var(--bg-surface); color: var(--accent-fg); }}
.dep-list {{ list-style: none; margin: 0; padding: 0; }}
.dep-item {{
  padding: 3px 8px; border-radius: 5px; cursor: pointer;
  font-size: 12px; color: var(--text-secondary);
}}
.dep-item:hover {{ background: var(--bg-elevated); color: var(--accent-fg); }}
.sym-chip.lib {{ background: var(--yellow-bg); color: var(--yellow-fg); border-color: rgba(210,153,34,0.25); }}
.cls-defs {{ font-size: 13px; }}
details.cls-item {{
  margin: 4px 0; border: 1px solid var(--border-muted);
  border-radius: var(--radius-ctrl); background: var(--bg-elevated); padding: 4px 10px;
}}
details.cls-item summary {{
  cursor: pointer; color: var(--text-secondary); font-size: 13px; list-style: none;
}}
details.cls-item summary::-webkit-details-marker {{ display: none; }}
.cls-name {{ color: #b58cff; font-weight: 600; font-family: var(--mono); }}
.fn-name {{ color: var(--green-fg); font-weight: 600; font-family: var(--mono); }}
.cls-doc {{ color: var(--text-muted); font-size: 12px; margin: 4px 0 2px 14px; }}
.cls-methods {{ margin: 6px 0 2px 14px; }}
.fn-item {{ margin: 6px 0; }}
.git-table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
.git-table td {{
  padding: 4px 8px; border-bottom: 1px solid var(--border-muted);
  color: var(--text-secondary);
}}
.git-table .d {{ color: var(--text-muted); white-space: nowrap; font-family: var(--mono); }}
.dir-bars {{ display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }}
.dir-row {{ display: flex; align-items: center; gap: 10px; font-size: 12px; }}
.dir-name {{
  width: 170px; color: var(--text-secondary); text-align: right;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}}
.dir-bar-wrap {{
  flex: 1; background: var(--bg-elevated);
  border-radius: 4px; height: 14px; overflow: hidden;
}}
.dir-bar {{
  display: block; height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-fg));
  border-radius: 4px;
}}
.dir-num {{ width: 170px; color: var(--text-muted); white-space: nowrap; }}
.todo-badge {{
  font-size: 10px; font-weight: 600;
  background: var(--yellow-bg); color: var(--yellow-fg);
  border-radius: 4px; padding: 0 5px; margin-left: auto;
}}

/* === 响应式: 窄屏单列 === */
@media (max-width: 1024px) {{
  .main-content {{ grid-template-columns: 1fr; }}
  .sidebar {{ max-height: none; position: static; }}
}}
@media (max-width: 900px) {{
  .home-grid {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
<div class="header">
  <h1>FinTrust Hub 全景导航</h1>
  <div class="meta">模式：{mode} | 数据更新于：{generated_at} |
    <span id="data-status">✅ 静态嵌入</span></div>
</div>

<div class="system-overview" id="system-overview">
  <h2>📋 系统总结说明</h2>

  <h3>项目定位</h3>
  <p>AI 驱动的金融信任枢纽系统（FinTrust Hub）——财务顾问公司的整合平台 + AI 信任枢纽。</p>
  <p>不替代银行核心 / 担保业务 / 保险核心 / 评估 / 法律 / 审计等具体业务系统，而是作为<strong>信任中介</strong>连接企业、银行、担保、保险四方。</p>
  <p><strong>核心价值</strong>：让中小企业融资从"盲盒"变成"白盒"——通过 AI 评估 + 渐进解锁机制，降低信息不对称，培育金融机构对小企业的信任。</p>

  <h3>技术栈</h3>
  <p>
    <span class="tag core">FastAPI</span>
    <span class="tag core">Vue 3 + TS</span>
    <span class="tag core">PostgreSQL</span>
    <span class="tag">Redis</span>
    <span class="tag">Temporal</span>
    <span class="tag">EMQX/MQTT</span>
    <span class="tag">Loki + Promtail</span>
    <span class="tag">K8s/Helm</span>
    <span class="tag">Docker Compose</span>
    <span class="tag">psutil</span>
  </p>

  <h3>核心设计哲学</h3>
  <ul>
    <li><strong>结构驱动</strong>：配置优于训练，结构第一性</li>
    <li><strong>白盒可逆</strong>：所有决策可追溯、可解释、可回滚</li>
    <li><strong>知识从 LLM 蒸馏</strong>：将 LLM 能力固化为规则与结构化数据</li>
    <li><strong>渐进调节</strong>：取类比象，P2 暂定性，P21 控制节律，P25 元变量演化</li>
    <li><strong>API 接入优先</strong>：A 档 API 接入 + B 档自研护城河 + C 档独立兜底备选</li>
    <li><strong>机构接入是增量而非前提</strong>：零机构接入时系统仍能为企业提供独立价值</li>
    <li><strong>傻瓜式操作</strong>：不让用户做选择题，只让用户做判断题或填空题</li>
    <li><strong>互联网免费 / 对赌思维</strong>：打穿传统行业壁垒</li>
  </ul>

  <h3>业务架构（四层）</h3>
  <ul>
    <li><strong>企业层</strong>：注册 → 数字化改造 → 融资入口解锁 → 持续培育</li>
    <li><strong>银行层</strong>：信任培育期 4 阶段渐进解锁（L4 只读 → L3 咨询 → L2 小额自动 → L1 全自动）</li>
    <li><strong>担保/保险层</strong>：押品评估、核保核赔、风险共担</li>
    <li><strong>监管层</strong>：沙盒穿透报告、监管账户、授信乘数、冻结/解冻</li>
  </ul>

  <h3>关键硬约束（摘选）</h3>
  <ul>
    <li><span class="tag crit">CRITICAL</span> 所有中间件必须使用 async/await，禁用回调风格</li>
    <li><span class="tag crit">CRITICAL</span> AI 决策弹窗队列上限为 3，超限降级为非阻塞 toast</li>
    <li><span class="tag crit">CRITICAL</span> 不可逆决策（审批/风控）必须阻塞模态窗二次确认</li>
    <li><span class="tag crit">CRITICAL</span> 所有 AI 通知 toast 需含 × 关闭 + 操作按钮，z-index=9500</li>
    <li><span class="tag crit">CRITICAL</span> 合作模式（企业/银行/担保/保险）必须支持多选 pill 按钮组</li>
    <li><span class="tag crit">CRITICAL</span> 边缘案例触发后必须在所有 Tab 顶部显示全局告警横幅</li>
    <li><span class="tag crit">CRITICAL</span> 改造完成后必须回写 hasReformed / financingUnlocked</li>
    <li>系统字体栈优先（避免 Google Fonts CDN 在国内 3.3s 首屏阻塞）</li>
    <li>所有资源 URL 需加版本参数（?v=22）强制刷新缓存</li>
  </ul>

  <h3>📄 文档健康与实时对齐状态</h3>
  <div id="doc-health-block">
    <p style="color:#909399;">文档对齐数据加载中（运行 <code>--full</code> 后由代码索引实时生成）…</p>
  </div>

  <h3>模块完成度概览</h3>
  <p>8 大业务模块：企业/银行/担保/保险/监管/改造/授信/评估——详见下方指标卡片与模块树。</p>
  <p style="color: #909399; font-size: 12px; margin-top: 10px;">
    本面板由 <code>tools/panorama/collect.py</code> 自动生成。如需刷新数据：运行
    <code>python tools/panorama/collect.py --quick</code>（0.8s）或
    <code>--full</code>（6s，含契约边+状态监控+文档对齐归档）。
  </p>
</div>

<div class="metrics-grid" id="metrics-grid">
  <div class="metric-card completion">
    <h3>📊 总体完成度</h3>
    <pre id="metric-completion">加载中...</pre>
  </div>
  <div class="metric-card recent">
    <h3>📝 最近变更记录</h3>
    <pre id="metric-recent">加载中...</pre>
  </div>
  <div class="metric-card branch">
    <h3>🌿 Git 分支状态</h3>
    <pre id="metric-branch">加载中...</pre>
  </div>
  <div class="metric-card risk">
    <h3>🚨 风险/阻塞</h3>
    <pre id="metric-risk">加载中...</pre>
  </div>
</div>

<details class="diag-details" id="problems_and_diagnostics">
  <summary>🔍 问题与诊断
    <span class="diag-summary-line" id="diag-summary-line">
      <span class="pill" id="pill-contracts">契约边 -</span>
      <span class="pill" id="pill-incomplete">未完成 -</span>
      <span class="pill" id="pill-missing">缺注释 -</span>
      <span class="pill" id="pill-docs">文档 -</span>
      &nbsp;（点击展开明细）
    </span>
  </summary>
  <div class="diag-body">
  <div class="diag-tabs">
    <div class="diag-tab active" data-panel="contracts">契约边 (<span id="diag-contracts-count">0</span>)</div>
    <div class="diag-tab" data-panel="incomplete">未完成项 (<span id="diag-incomplete-count">0</span>)</div>
    <div class="diag-tab" data-panel="missing">缺失注释 (<span id="diag-missing-count">0</span>)</div>
  </div>
  <div class="diag-panel active" id="panel-contracts">
    <p style="color: #909399; margin-bottom: 8px; font-size: 12px;">
      前端 API 调用 ↔ 后端路由匹配。🔴 红色行 = 孤儿契约（前端调了但后端未注册），🟢 绿色行 = 已匹配。
    </p>
    <div id="diag-contracts-table">加载中...</div>
  </div>
  <div class="diag-panel" id="panel-incomplete">
    <p style="color: #909399; margin-bottom: 8px; font-size: 12px;">
      代码实测口径（逐文件扫描 TODO/桩/骨架标记）。🟡 = 部分实现，📋 = 骨架（NotImplementedError），🔜 = 占位（&lt;3 行有效代码）。
    </p>
    <div id="diag-incomplete-table">加载中...</div>
  </div>
  <div class="diag-panel" id="panel-missing">
    <p style="color: #909399; margin-bottom: 8px; font-size: 12px;">
      以下文件缺少中文注释（# 文件名：/ # 职责：），建议批量补全。
    </p>
    <ul class="missing-list" id="diag-missing-list"></ul>
  </div>
  </div>
</details>

<div class="main-content">
  <div class="sidebar">
    <h2>📁 模块树</h2>
    <div class="perspective-bar" id="perspective-bar">
      <div class="persp-btn" data-persp="god" title="只展开顶层目录，先看清系统由哪几大块组成">① 上帝视角</div>
      <div class="persp-btn active" data-persp="arch" title="按架构分层浏览（展开到模块层）">② 架构师</div>
      <div class="persp-btn" data-persp="dev" title="目录树全部展开，配合搜索精确定位">③ 开发者</div>
    </div>
    <div class="persp-hint" id="persp-hint"></div>
    <input type="text" class="search-box" id="search-box"
           placeholder="搜索文件名/中文名/类名/函数名...">
    <div id="tree-container">加载中...</div>
  </div>
  <div class="detail-panel" id="detail-panel">
    <div class="detail-empty">
      <div class="detail-empty-icon">📄</div>
      <h2>点击左侧文件查看代码细节</h2>
      <p>每个文件展示：实现状态 · 影响面 · 中文职责 · 类/函数结构 · 源码预览</p>
      <p class="detail-empty-tip">
        提示：③ 开发者视角全展开目录；搜索框支持文件名 / 中文名 / 类名 / 函数名<br>
        数据刷新：<code>python tools/panorama/collect.py --quick</code>
      </p>
    </div>
  </div>
</div>

<script>
// 静态嵌入的兜底数据（collect.py 生成时写入）
const EMBEDDED_SUMMARY = {summary_json};
const EMBEDDED_TREE = {tree_data};

// 渲染 4 大指标
function renderMetrics(summary) {{
  // 完成度：双口径交叉验证（代码实测为准, MATRIX 规划作对照）
  const rate = (summary.completion_rate * 100).toFixed(1);
  const bd = summary.completion_breakdown || {{}};
  const ca = bd.code_actual || {{}};
  let completionStr;
  if (ca.total) {{
    completionStr =
      `📊 代码实测完成度：${{rate}}%（代码即事实）\\n` +
      `├── ✅ 已实现: ${{ca.done}} 文件\\n` +
      `├── 🟡 部分实现: ${{ca.partial}} 文件\\n` +
      `├── 📋 骨架: ${{ca.skeleton}} 文件\\n` +
      `└── 🔜 占位: ${{ca.placeholder}} 文件\\n` +
      `   共 ${{ca.total}} 代码文件 / ${{summary.total_lines}} 行\\n` +
      `───────────────\\n` +
      `📋 规划口径(MATRIX): ${{bd.weighted || '-'}}%` +
      (bd.matrix_stale ? ' ⚠️已过期' : '') + `\\n` +
      `   ✅${{bd.done||0}} 🟡${{bd.partial||0}} 📋${{bd.doc||0}} 🔜${{bd.roadmap||0}}` +
      ` / ${{bd.total||0}} 项任务`;
    // 分层完成度 + 核心服务桩清单（防止"前端完成数稀释核心服务桩"）
    const layers = ca.layers || {{}};
    if (layers.core_services) {{
      const cs = layers.core_services;
      completionStr += `\\n───────────────\\n` +
        `🧩 分层完成度：前端 ${{layers.frontend.weighted}}% · ` +
        `后端 ${{layers.backend.weighted}}% · ` +
        `🎯核心服务层 ${{cs.weighted}}%\\n` +
        `   核心服务 ${{cs.total}} 个：✅${{cs.done}} 🟡${{cs.partial}} 📋${{cs.skeleton}} 🔜${{cs.placeholder}}`;
      const stubs = ca.core_stubs || [];
      if (stubs.length) {{
        completionStr += `\\n🔌 桩/mock 兜底待真实接入（未完成硬证据）：` +
          stubs.map(s => {{
            const nm = s.path.split('/').pop().replace('.py','').replace('_service','');
            const tag = s.status === 'skeleton' ? '📋' : s.status === 'placeholder' ? '🔜' : '🟡';
            return tag + nm;
          }}).join(' ');
      }}
    }}
    const notes = bd.cross_check_notes || [];
    if (notes.length) completionStr += `\\n───────────────\\n` + notes.join(`\\n`);
  }} else {{
    completionStr =
      `📊 完成度：${{rate}}% (${{(summary.completed_modules||[]).length}}/${{summary.total_modules}} 个目录)\\n` +
      `└── 📦 总文件: ${{summary.total_files}} / 总行: ${{summary.total_lines}}`;
  }}
  document.getElementById('metric-completion').textContent = completionStr;

  // 最近变更
  const commits = (summary.git_summary && summary.git_summary.recent_commits) || [];
  let recentStr = '📝 最近变更：\\n';
  commits.slice(0,5).forEach(c => {{
    recentStr += `- ${{c.date}} | ${{c.author}} | ${{(c.message||'').slice(0,50)}}\\n`;
  }});
  if (!commits.length) recentStr += '- 无 Git 历史';
  document.getElementById('metric-recent').textContent = recentStr;

  // 分支
  const g = summary.git_summary || {{}};
  document.getElementById('metric-branch').textContent =
    `🌿 当前分支: ${{g.branch || 'unknown'}}\\n` +
    `📦 未提交变更: ${{g.uncommitted_count || 0}} 个文件\\n` +
    `🚀 领先 origin: ${{g.ahead_of_origin || 0}} 个 commits\\n` +
    `🔗 孤儿契约边: ${{summary.orphan_count || 0}} 条`;

  // 风险
  const risks = summary.risks || [];
  let riskStr = '🚨 当前风险/阻塞：\\n';
  if (!risks.length) {{
    riskStr += '- 无阻断级错误';
  }} else {{
    risks.slice(0,10).forEach(r => {{
      const icon = r.severity === 'blocker' ? '🔴' :
                   r.severity === 'warning' ? '⚠️' : 'ℹ️';
      riskStr += `- ${{icon}} [${{r.type||'unknown'}}] ${{(r.detail||'').slice(0,60)}}\\n`;
    }});
  }}
  document.getElementById('metric-risk').textContent = riskStr;
}}

// 渲染问题与诊断区块
function renderDiagnostics(summary) {{
  const edges = summary.contract_edges || [];
  const orphanCount = summary.orphan_count || 0;
  const totalCount = summary.contract_edges_count || edges.length;

  // 契约边计数
  document.getElementById('diag-contracts-count').textContent =
    totalCount + ' (孤儿 ' + orphanCount + ')';

  // 契约边表格
  const container = document.getElementById('diag-contracts-table');
  if (!edges.length) {{
    container.innerHTML = '<div class="empty">--quick 模式跳过契约边捕获，运行 --full 查看完整分析</div>';
  }} else {{
    let html = '<table class="diag-table"><thead><tr>' +
      '<th>方法</th><th>路径</th><th>前端文件:行号</th>' +
      '<th>后端文件:行号</th><th>状态</th>' +
      '</tr></thead><tbody>';
    edges.forEach(e => {{
      const isOrphan = e.is_orphan;
      const rowClass = isOrphan ? 'orphan' : 'matched';
      const badge = isOrphan
        ? '<span class="badge-orphan">🔴 孤儿</span>'
        : '<span class="badge-matched">🟢 已匹配</span>';
      const feLine = e.frontend_file
        ? e.frontend_file + ':' + (e.frontend_line || 0) : '-';
      const beLine = !isOrphan && e.backend_file
        ? e.backend_file + ':' + (e.backend_line || 0) : '-';
      const method = (e.http_method || '').toUpperCase();
      html += '<tr class="' + rowClass + '">' +
        '<td><code>' + method + '</code></td>' +
        '<td><code>' + (e.path || '') + '</code></td>' +
        '<td>' + feLine + '</td>' +
        '<td>' + beLine + '</td>' +
        '<td>' + badge + '</td>' +
        '</tr>';
    }});
    html += '</tbody></table>';
    container.innerHTML = html;
  }}

  // === 未完成项（代码实测: walk 文件树收集 impl_status != done）===
  const incomplete = [];
  (function walk(n) {{
    if (n.is_file && n.impl_status && n.impl_status !== 'done') {{
      incomplete.push(n);
    }}
    (n.children || []).forEach(walk);
  }})(EMBEDDED_TREE);
  const order = {{ skeleton: 0, placeholder: 1, partial: 2 }};
  incomplete.sort((a, b) =>
    (order[a.impl_status] ?? 9) - (order[b.impl_status] ?? 9));
  document.getElementById('diag-incomplete-count').textContent = incomplete.length;
  const incContainer = document.getElementById('diag-incomplete-table');
  if (!incomplete.length) {{
    incContainer.innerHTML = '<div class="empty">✅ 代码实测全部完成（无 TODO/桩/骨架标记）</div>';
  }} else {{
    const icons = {{ partial: '🟡', skeleton: '📋', placeholder: '🔜' }};
    const labels = {{ partial: '部分实现', skeleton: '骨架', placeholder: '占位' }};
    let html = '<table class="diag-table"><thead><tr>' +
      '<th>状态</th><th>文件</th><th>中文名</th><th>检测标记</th>' +
      '</tr></thead><tbody>';
    incomplete.forEach(n => {{
      const st = n.impl_status;
      const rowCls = st === 'partial' ? '' : 'orphan';
      html += '<tr class="' + rowCls + '"><td>' + (icons[st]||'?') + ' ' +
        (labels[st]||st) + '</td><td><code>' + n.path + '</code></td>' +
        '<td>' + (n.name_cn && n.name_cn !== '📝 待补充' ? n.name_cn : '-') +
        '</td><td style="font-size:11px;color:#909399;">' +
        (n.impl_markers || []).join(', ') + '</td></tr>';
    }});
    html += '</tbody></table>';
    incContainer.innerHTML = html;
  }}

  // 缺失注释列表
  const missing = summary.missing_annotations || [];
  document.getElementById('diag-missing-count').textContent = missing.length;
  const missingList = document.getElementById('diag-missing-list');
  if (!missing.length) {{
    missingList.innerHTML = '<li style="color: #67c23a;">✅ 所有文件均有中文注释</li>';
  }} else {{
    missingList.innerHTML = missing.map(f =>
      '<li><code>' + f + '</code></li>').join('');
  }}

  // === 折叠栏摘要 pills ===
  const dh = summary.doc_health || {{}};
  const staleN = (dh.stale || 0) + (dh.report || 0);
  setPill('pill-contracts', '契约边 ' + totalCount + (orphanCount ? '·孤儿'+orphanCount : ''),
    orphanCount ? 'danger' : 'ok');
  setPill('pill-incomplete', '未完成 ' + incomplete.length,
    incomplete.length ? 'warn' : 'ok');
  setPill('pill-missing', '缺注释 ' + missing.length,
    missing.length ? 'warn' : 'ok');
  setPill('pill-docs', '文档 ' + (dh.total_docs || 0) + '份·过期' + staleN,
    staleN ? 'warn' : (dh.total_docs ? 'ok' : ''));
}}

function setPill(id, text, cls) {{
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'pill' + (cls ? ' ' + cls : '');
}}

// === 文档健康板块（系统总结区内, 实时对齐状态）===
function renderDocHealth(summary) {{
  const block = document.getElementById('doc-health-block');
  const dh = summary.doc_health;
  if (!dh || dh.error || !dh.total_docs) {{
    block.innerHTML = '<p style="color:#909399;font-size:12px;">' +
      '文档对齐数据未生成（--quick 模式复用缓存或跳过）。运行 ' +
      '<code>python tools/panorama/collect.py --full</code> 扫描全部文档并自动归档时点报告。</p>';
    return;
  }}
  const rateCls = dh.health_rate >= 80 ? 'ok' : dh.health_rate >= 50 ? 'warn' : 'danger';
  let html = '<div class="doc-health-grid">' +
    dhCard(dh.health_rate + '%', '文档健康率', rateCls) +
    dhCard(dh.current, '当前有效', 'ok') +
    dhCard(dh.stale, '已过期（需复核）', dh.stale ? 'danger' : 'ok') +
    dhCard(dh.report, '时点报告（待归档）', dh.report ? 'warn' : 'ok') +
    dhCard((dh.archive_total != null ? dh.archive_total : dh.archived_count),
           '已归档报告（_archive）' + (dh.archived_count ? ' ·本次+' + dh.archived_count : ''),
           (dh.archive_total || dh.archived_count) ? 'ok' : 'ok') +
    dhCard(dh.ref_broken + '/' + dh.ref_total, '失效代码引用', dh.ref_broken ? 'warn' : 'ok') +
    '</div>';

  // 实时对齐状态
  const reused = dh.reused ? '（--quick 复用上次扫描结果）' : '';
  html += '<div class="dh-realtime"><span class="dot-live"></span>' +
    '<strong>实时对齐状态：</strong>文档扫描于 ' + dh.generated_at + reused +
    ' ｜ 代码最新变更日 ' + (dh.newest_code_at || '?') +
    ' ｜ 每次运行 <code>collect.py</code> 自动重新对齐</div>';

  // 过期/报告文档明细（可折叠）
  const staleDetails = dh.stale_details || [];
  if (staleDetails.length) {{
    html += '<p style="margin-top:8px;"><span class="dh-toggle" id="dh-stale-toggle">' +
      '▶ 查看 ' + staleDetails.length + ' 份需处理文档（过期 ' + dh.stale +
      ' / 时点报告 ' + dh.report + '）</span></p>';
    html += '<ul class="dh-list" id="dh-stale-list" style="display:none;">';
    staleDetails.forEach(d => {{
      const icon = d.health === 'report' ? '📦' : '⚠️';
      html += '<li>' + icon + ' <code>' + d.rel_path + '</code>' +
        (d.archived ? ' <span style="color:#67c23a;">已归档</span>' : '') +
        '<br>&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#909399;">' +
        d.reason + '（' + d.mtime + '，失效引用 ' + d.broken_count +
        ' 处）</span></li>';
    }});
    html += '</ul>';
  }}

  // 归档清单（本次新归档 + 归档区累计内容）
  if ((dh.archived && dh.archived.length) || (dh.archive_names && dh.archive_names.length)) {{
    html += '<p style="margin-top:6px;font-size:12px;">📦 <code>docs/_archive/</code> 归档区' +
      '（可逆，随时恢复）：</p><ul class="dh-list">';
    (dh.archive_names || []).forEach(n => {{
      html += '<li>📦 <code>' + n + '</code></li>';
    }});
    (dh.archived || []).forEach(a => {{
      if ((dh.archive_names || []).indexOf(a.name) === -1)
        html += '<li>📦 <code>' + a.name + '</code> → ' + a.to + '</li>';
    }});
    html += '</ul>';
  }}

  // 下一步解决方案
  const bd = summary.completion_breakdown || {{}};
  const notes = bd.cross_check_notes || [];
  html += '<div class="dh-nextsteps"><strong>📌 对齐结论与下一步：</strong><br>';
  if (dh.stale > 0) {{
    html += '1. 上述 <strong>' + dh.stale + ' 份过期文档</strong>引用的代码路径已失效' +
      '（旧版 view-*.js 原型/旧目录结构），请人工复核：已完成使命的归档，仍有参考价值的更新引用路径；<br>';
  }}
  if (bd.matrix_stale) {{
    html += '2. <strong>COMPLETION_MATRIX.md 已过期</strong>，完成度口径已切换为代码实测（逐文件扫描标记），建议下次迭代后重写 MATRIX 或归档；<br>';
  }}
  html += '3. 时点报告/变更日志由 <code>--full</code> 自动归档至 <code>docs/_archive/</code>，不物理删除；<br>' +
    '4. 日常开发用 <code>--quick</code>（0.8s）刷新面板，发版前跑 <code>--full</code> 做一次全量对齐。';
  if (notes.length) {{
    html += '<br><span style="color:#909399;">交叉校准：' + notes.join('；') + '</span>';
  }}
  html += '</div>';

  block.innerHTML = html;
  const toggle = document.getElementById('dh-stale-toggle');
  if (toggle) {{
    toggle.onclick = function() {{
      const list = document.getElementById('dh-stale-list');
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? 'block' : 'none';
      toggle.textContent = (hidden ? '▼' : '▶') + toggle.textContent.slice(1);
    }};
  }}
}}

function dhCard(num, lbl, cls) {{
  return '<div class="dh-card ' + (cls || '') + '"><div class="num">' + num +
    '</div><div class="lbl">' + lbl + '</div></div>';
}}

// 诊断区块 Tab 切换
function setupDiagTabs() {{
  document.querySelectorAll('.diag-tab').forEach(tab => {{
    tab.onclick = function() {{
      document.querySelectorAll('.diag-tab').forEach(t =>
        t.classList.remove('active'));
      document.querySelectorAll('.diag-panel').forEach(p =>
        p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = 'panel-' + tab.dataset.panel;
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');
    }};
  }});
}}

// === 三视角：控制树默认展开深度 ===
// god=只看顶层大块; arch=展开到模块层; dev=全展开
const PERSP_DEPTH = {{ god: 1, arch: 3, dev: 99 }};
const PERSP_HINT = {{
  god: '① 上帝视角：仅展开顶层大块（backend / frontend / docs…），先看清系统由哪几大块组成',
  arch: '② 架构师视角：展开到模块层（app/services、src/views…），按架构分层浏览',
  dev: '③ 开发者视角：目录树全部展开，配合搜索框按文件名/中文名/类名/函数名定位'
}};
let currentPersp = 'arch';

// 影响面阈值：被 >=HIGH 个文件引用 = 高风险改动（红色）
const IMPACT_HIGH = 5;
const IMPACT_MID = 2;

// 渲染文件树（depth = 剩余展开层数, 目录 depth>0 默认展开）
function renderTree(node, container, depth) {{
  if (depth === undefined) depth = PERSP_DEPTH[currentPersp];
  const item = document.createElement('div');
  item.className = 'tree-node';
  if (!node.is_file && node.children && node.children.length > 0) {{
    const expanded = depth > 0;
    const toggle = document.createElement('div');
    toggle.className = 'tree-toggle' + (expanded ? ' expanded' : '');
    toggle.textContent = node.name + '/';
    if (node.dcn) toggle.title = node.dcn;
    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children' + (expanded ? ' expanded' : '');
    node.children.forEach(child => renderTree(child, childContainer, depth - 1));
    toggle.onclick = function() {{
      toggle.classList.toggle('expanded');
      childContainer.classList.toggle('expanded');
      showModuleDetail(node);   // 点目录名同时打开模块概览（子目录+文件清单+统计）
    }};
    item.appendChild(toggle);
    item.appendChild(childContainer);
  }} else {{
    const fileDiv = document.createElement('div');
    fileDiv.className = 'tree-file';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const status = node.status || 'no_state';
    dot.style.background = status === 'healthy' ? '#67c23a' :
                            status === 'fault' ? '#f56c6c' :
                            status === 'degraded' ? '#e6a23c' : '#c0c4cc';
    fileDiv.appendChild(dot);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'fname';
    nameSpan.textContent = node.name;
    fileDiv.appendChild(nameSpan);
    // 中文名（始终显示; 缺失时灰色提示）
    const cnSpan = document.createElement('span');
    cnSpan.className = 'fname-cn' +
      (!node.name_cn || node.name_cn === '📝 待补充' ? ' missing' : '');
    cnSpan.textContent = node.name_cn && node.name_cn !== '📝 待补充'
      ? node.name_cn : '待补中文名';
    fileDiv.appendChild(cnSpan);
    // 影响面角标：被 N 处引用（红色=高风险改动）
    const ibc = node.ibc || 0;
    if (ibc >= IMPACT_MID) {{
      const ib = document.createElement('span');
      ib.className = 'impact-badge ' + (ibc >= IMPACT_HIGH ? 'high' : 'mid');
      ib.textContent = '⬆被' + ibc + '引用';
      ib.title = '该文件被 ' + ibc + ' 个文件引用，改动影响面大';
      fileDiv.appendChild(ib);
      if (ibc >= IMPACT_HIGH) fileDiv.classList.add('high-risk');
    }}
    // 待办角标（TODO/FIXME 计数, 点击详情可看热点榜）
    if (node.todo > 0) {{
      const tb = document.createElement('span');
      tb.className = 'todo-badge';
      tb.textContent = '🔧' + node.todo;
      tb.title = '该文件有 ' + node.todo + ' 处 TODO/FIXME/HACK/XXX 标记';
      fileDiv.appendChild(tb);
    }}
    // 实现状态标识（所有文件都显示: done=✅ / partial=🟡 / skeleton=📋 / placeholder=🔜）
    if (node.impl_status) {{
      const badge = document.createElement('span');
      badge.className = 'impl-badge impl-' + node.impl_status;
      const icons = {{done: '✅', partial: '🟡', skeleton: '📋', placeholder: '🔜'}};
      badge.textContent = icons[node.impl_status] || '?';
      badge.title = ({{
        done: '已实现', partial: '部分实现（含降级/桩标记）',
        skeleton: '骨架（NotImplementedError）', placeholder: '占位（有效代码<3行）'
      }})[node.impl_status] +
        ((node.impl_markers && node.impl_markers.length)
          ? '：' + node.impl_markers.join(', ') : '');
      fileDiv.appendChild(badge);
    }}
    fileDiv.onclick = function() {{
      document.querySelectorAll('.tree-file.active').forEach(el =>
        el.classList.remove('active'));
      fileDiv.classList.add('active');
      showDetail(node);
    }};
    item.appendChild(fileDiv);
  }}
  container.appendChild(item);
}}

// 显示文件详情
function escHtml(s) {{
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}}

function showDetail(node) {{
  const panel = document.getElementById('detail-panel');
  const titleCn = (node.name_cn && node.name_cn !== '📝 待补充') ? node.name_cn : '';
  let html = '<div class="detail-nav"><span class="back-btn" onclick="goHome()">← 返回首页</span>' +
    '<span class="breadcrumb">文件</span></div>';
  html += '<h2>' + escHtml(node.name) +
    (titleCn ? '<span class="detail-title-cn">' + escHtml(titleCn) + '</span>' : '') + '</h2>';
  html += '<div class="detail-meta">';
  html += '<span>路径 <code>' + escHtml(node.path || '') + '</code></span>';
  if (node.language) html += '<span>语言 <b>' + escHtml(node.language) + '</b></span>';
  if (node.line_count) html += '<span>行数 <b>' + node.line_count + '</b></span>';
  if (typeof node.cc === 'number') html += '<span>类 <b>' + node.cc + '</b></span>';
  if (typeof node.fc === 'number') html += '<span>函数 <b>' + node.fc + '</b></span>';
  html += '</div>';

  // 实现状态（深色状态条）
  if (node.impl_status) {{
    const labels = {{
      done: '✅ 已实现', partial: '🟡 部分实现',
      skeleton: '📋 骨架代码', placeholder: '🔜 占位文件'
    }};
    html += '<div class="status-strip ' + node.impl_status + '">' +
      '<strong>' + (labels[node.impl_status] || node.impl_status) + '</strong>';
    if (node.impl_markers && node.impl_markers.length) {{
      html += '<span class="status-markers">检测标记：' +
        escHtml(node.impl_markers.join(', ')) + '</span>';
    }}
    if (node.todo > 0) {{
      html += '<span class="status-markers">🔧 ' + node.todo + ' 处 TODO/FIXME 待办</span>';
    }}
    html += '</div>';
  }}

  // === 影响面（先看被多少文件引用, 再动手改）===
  if (node.is_file) {{
    const ibc = node.ibc || 0;
    const ic = node.ic || 0;
    let level, title;
    if (ibc >= IMPACT_HIGH) {{
      level = 'high';
      title = '🔴 高影响面：被 ' + ibc + ' 个文件引用 —— 修改前必须评估回归风险！';
    }} else if (ibc >= IMPACT_MID) {{
      level = 'mid';
      title = '🟡 中影响面：被 ' + ibc + ' 个文件引用';
    }} else if (ibc === 1) {{
      level = 'low';
      title = '🟢 低影响面：被 1 个文件引用';
    }} else {{
      level = 'low';
      title = '⚪ 叶子文件：暂无其他文件引用（改动影响面最小）';
    }}
    html += '<div class="impact-panel ' + level + '"><strong>' + title + '</strong>';
    if (ibc > 0 && node.ib && node.ib.length) {{
      html += '<ul>' + node.ib.map(p => '<li class="dep-item" data-dep="' + escHtml(p) + '"><code>' + escHtml(p) + '</code></li>').join('');
      if (ibc > node.ib.length) html += '<li>…另有 ' + (ibc - node.ib.length) + ' 个</li>';
      html += '</ul>';
    }}
    html += '<div class="impact-sub">该文件自身依赖 ' + ic + ' 个文件</div></div>';

    // === 依赖三区: 它依赖谁（可点击跳转）+ 第三方库 ===
    const deps = node.deps || [];
    html += '<h3 class="detail-h3">它依赖谁 <span class="h3-sub">' + deps.length +
      ' 个内部文件（点击跳转）</span></h3>';
    if (deps.length) {{
      html += '<ul class="dep-list">' + deps.map(p =>
        '<li class="dep-item" data-dep="' + escHtml(p) + '">▸ <code>' + escHtml(p) + '</code></li>'
      ).join('') + '</ul>';
    }} else {{
      html += '<div class="hint">无内部依赖</div>';
    }}
    const libs = node.libs || [];
    html += '<h3 class="detail-h3">第三方库</h3>';
    html += libs.length
      ? '<div class="sym-chips">' + libs.map(l =>
          '<span class="sym-chip lib">' + escHtml(l) + '</span>').join('') + '</div>'
      : '<div class="hint">无</div>';
  }}

  if (node.responsibility_cn) {{
    html += '<h3 class="detail-h3">职责</h3>';
    html += '<p class="detail-resp">' + escHtml(node.responsibility_cn) + '</p>';
  }}

  // === 代码结构: 类(方法+doc) / 顶层函数 / 兜底符号 chips ===
  if (node.cls && node.cls.length) {{
    html += '<h3 class="detail-h3">代码结构 <span class="h3-sub">' +
      node.cls.length + ' 个类 · ' + ((node.fns || []).length) + ' 个顶层函数</span></h3>';
    html += '<div class="cls-defs">';
    node.cls.forEach(c => {{
      html += '<details class="cls-item"><summary>' +
        '<span class="cls-name">▣ class ' + escHtml(c.n) + '</span>' +
        '<span class="h3-sub">（' + (c.m || []).length + ' 个方法）</span></summary>' +
        (c.d ? '<div class="cls-doc">' + escHtml(c.d) + '</div>' : '') +
        ((c.m && c.m.length)
          ? '<div class="cls-methods">' + c.m.map(m =>
              '<span class="sym-chip fn">ƒ ' + escHtml(m) + '</span>').join('') + '</div>'
          : '') +
        '</details>';
    }});
    (node.fns || []).forEach(fn => {{
      html += '<div class="fn-item"><span class="fn-name">ƒ ' + escHtml(fn.n) + '()</span>' +
        (fn.d ? '<div class="cls-doc">' + escHtml(fn.d) + '</div>' : '') + '</div>';
    }});
    html += '</div>';
  }} else if (node.sym && node.sym.length) {{
    html += '<h3 class="detail-h3">代码结构 <span class="h3-sub">' +
      node.sym.length + ' 个类/函数（顶层符号）</span></h3>';
    html += '<div class="sym-chips">' + node.sym.map(s => {{
      const isClass = /^[A-Z]/.test(s);
      return '<span class="sym-chip ' + (isClass ? 'cls' : 'fn') + '">' +
        (isClass ? '▣ ' : 'ƒ ') + escHtml(s) + '</span>';
    }}).join('') + '</div>';
  }}

  // === 最近变更（本文件最近 3 条 Git 提交）===
  if (node.gitlog && node.gitlog.length) {{
    html += '<h3 class="detail-h3">最近变更 <span class="h3-sub">' +
      node.gitlog.length + ' 条提交</span></h3>';
    html += '<table class="git-table">' + node.gitlog.map(g =>
      '<tr><td class="d">' + escHtml(g.d) + '</td><td>' + escHtml(g.m) + '</td></tr>'
    ).join('') + '</table>';
  }}

  // === 源码预览（前 30 行）===
  if (node.preview) {{
    const lines = node.preview.split('\\n');
    html += '<h3 class="detail-h3">源码预览 <span class="h3-sub">前 ' +
      lines.length + ' 行</span></h3>';
    html += '<pre class="code-preview"><code>' + lines.map((ln, i) =>
      '<span class="ln">' + (i + 1) + '</span>' + escHtml(ln)
    ).join('\\n') + '</code></pre>';
  }}

  if (!node.name_cn || node.name_cn === '📝 待补充') {{
    html += '<div class="missing-note">📝 该文件缺中文注释，建议在文件首行添加：' +
      '<code># 文件名：&lt;中文名&gt; 职责：……</code></div>';
  }}
  panel.innerHTML = html;
  // 依赖跳转（它依赖谁 / 谁依赖它 的可点击项）
  panel.querySelectorAll('[data-dep]').forEach(li => {{
    li.onclick = function() {{
      const target = findFileByPath(li.dataset.dep);
      if (target) showDetail(target);
    }};
  }});
}}

// ---- 工具: 树遍历 / 按路径找文件节点 ----
function walkFiles(node, out) {{
  if (node.is_file) {{ out.push(node); return; }}
  (node.children || []).forEach(c => walkFiles(c, out));
}}

function findFileByPath(path) {{
  let found = null;
  (function w(n) {{
    if (found) return;
    if (n.is_file && n.path === path) {{ found = n; return; }}
    (n.children || []).forEach(w);
  }})(EMBEDDED_TREE);
  return found;
}}

// ---- 模块概览（点目录名触发）: 子目录 + 文件清单 + 递归统计 ----
function showModuleDetail(node) {{
  const panel = document.getElementById('detail-panel');
  const all = [];
  walkFiles(node, all);
  const totalLines = all.reduce((s, f) => s + (f.line_count || 0), 0);
  const st = {{ done: 0, partial: 0, skeleton: 0, placeholder: 0 }};
  all.forEach(f => {{ st[f.impl_status] = (st[f.impl_status] || 0) + 1; }});
  const initFile = (node.children || []).find(c => c.is_file && c.name === '__init__.py');
  const titleCn = node.dcn ||
    (initFile && initFile.name_cn && initFile.name_cn !== '📝 待补充' ? initFile.name_cn : '');
  const duty = initFile ? (initFile.responsibility_cn || '') : '';

  let html = '<div class="detail-nav"><span class="back-btn" onclick="goHome()">← 返回首页</span>' +
    '<span class="breadcrumb">模块</span></div>';
  html += '<h2>📁 ' + escHtml(node.name) +
    (titleCn ? '<span class="detail-title-cn">' + escHtml(titleCn) + '</span>' : '') + '</h2>';
  html += '<div class="detail-path">' + escHtml(node.path || '') + '/</div>';
  if (duty) html += '<p class="detail-resp">' + escHtml(duty) + '</p>';
  html += '<div class="detail-meta">' +
    '<span>📄 文件 <b>' + all.length + '</b></span>' +
    '<span>📏 <b>' + totalLines.toLocaleString() + '</b> 行</span>' +
    '<span>✅ ' + (st.done || 0) + '</span><span>🟡 ' + (st.partial || 0) + '</span>' +
    '<span>📋 ' + (st.skeleton || 0) + '</span><span>🔜 ' + (st.placeholder || 0) + '</span>' +
    '</div>';

  const subs = (node.children || []).filter(c => !c.is_file);
  if (subs.length) {{
    html += '<h3 class="detail-h3">子目录 <span class="h3-sub">' + subs.length + ' 个</span></h3>';
    html += '<ul class="mod-list">';
    subs.forEach(s => {{
      const sf = [];
      walkFiles(s, sf);
      html += '<li class="mod-item" data-dir="' + escHtml(s.name) + '">📁 <b>' + escHtml(s.name) + '</b>' +
        (s.dcn ? ' <span class="fname-cn">' + escHtml(s.dcn) + '</span>' : '') +
        ' <span class="h3-sub">' + sf.length + ' 文件</span></li>';
    }});
    html += '</ul>';
  }}

  const direct = (node.children || []).filter(c => c.is_file);
  html += '<h3 class="detail-h3">本目录文件 <span class="h3-sub">' + direct.length +
    ' 个（点击看代码细节）</span></h3>';
  html += '<ul class="mod-list">';
  const icons = {{ done: '✅', partial: '🟡', skeleton: '📋', placeholder: '🔜' }};
  direct.slice(0, 200).forEach(f => {{
    html += '<li class="mod-item" data-file="' + escHtml(f.name) + '">📄 <b>' + escHtml(f.name) + '</b>' +
      (f.name_cn && f.name_cn !== '📝 待补充'
        ? ' <span class="fname-cn">' + escHtml(f.name_cn) + '</span>' : '') +
      ' <span class="impl-badge impl-' + (f.impl_status || 'done') + '">' +
      (icons[f.impl_status] || '') + '</span>' +
      ' <span class="h3-sub">' + (f.line_count || 0) + ' 行</span></li>';
  }});
  html += '</ul>';
  if (direct.length > 200) {{
    html += '<div class="hint">……其余 ' + (direct.length - 200) + ' 个文件请用搜索定位</div>';
  }}
  panel.innerHTML = html;
  panel.querySelectorAll('[data-file]').forEach(li => {{
    li.onclick = function() {{
      const child = (node.children || []).find(c => c.is_file && c.name === li.dataset.file);
      if (child) showDetail(child);
    }};
  }});
  panel.querySelectorAll('[data-dir]').forEach(li => {{
    li.onclick = function() {{
      const child = (node.children || []).find(c => !c.is_file && c.name === li.dataset.dir);
      if (child) showModuleDetail(child);
    }};
  }});
}}

// ---- 首页: 高影响面 Top12 + 待办热点 Top10 + 研发投入分布条形图 ----
function showHome() {{
  const panel = document.getElementById('detail-panel');
  const files = [];
  walkFiles(EMBEDDED_TREE, files);

  const byImpact = files.filter(f => (f.ibc || 0) > 0)
    .sort((a, b) => (b.ibc || 0) - (a.ibc || 0)).slice(0, 12);
  const todos = files
    .filter(f => (f.todo || 0) > 0 || (f.impl_status && f.impl_status !== 'done'))
    .sort((a, b) =>
      ((b.todo || 0) + (b.impl_markers || []).length) -
      ((a.todo || 0) + (a.impl_markers || []).length))
    .slice(0, 10);

  // 按前两级路径聚合代码行（研发投入分布, 长短腿一眼可见）
  const dirs = {{}};
  files.forEach(f => {{
    const p = (f.path || '').split('/');
    const key = p.length > 2 ? p.slice(0, 2).join('/') : (p[0] || '/');
    if (!dirs[key]) dirs[key] = {{ lines: 0, files: 0 }};
    dirs[key].lines += f.line_count || 0;
    dirs[key].files += 1;
  }});
  const dirRows = Object.entries(dirs).sort((a, b) => b[1].lines - a[1].lines);
  const maxLines = Math.max.apply(null, dirRows.map(r => r[1].lines).concat([1]));

  let html = '<div class="home-intro">这是<b>FinTrust Hub 全景地图</b>：左侧模块树导航，' +
    '本区展示态势总览。改动代码后运行 <code>python tools/panorama/collect.py --quick</code> 刷新。</div>';

  html += '<div class="home-grid">';
  // 高影响面榜单
  html += '<div class="home-panel"><h3 class="detail-h3">🔥 高影响面文件 Top ' + byImpact.length +
    '<span class="h3-sub">改动需格外小心</span></h3><ul class="mod-list">';
  byImpact.forEach(f => {{
    html += '<li class="mod-item" data-hit="' + escHtml(f.path) + '">📄 <b>' + escHtml(f.name) + '</b>' +
      (f.name_cn && f.name_cn !== '📝 待补充'
        ? ' <span class="fname-cn">' + escHtml(f.name_cn) + '</span>' : '') +
      ' <span class="impact-badge high">⬆被' + f.ibc + '引用</span></li>';
  }});
  html += '</ul></div>';
  // 待办热点榜
  html += '<div class="home-panel"><h3 class="detail-h3">🔧 待办热点 Top ' + todos.length +
    '<span class="h3-sub">开工先看，避免重复造轮子</span></h3><ul class="mod-list">';
  if (!todos.length) {{
    html += '<li class="hint">无待办标记</li>';
  }}
  const hIcons = {{ partial: '🟡', skeleton: '📋', placeholder: '🔜' }};
  todos.forEach(f => {{
    const n = (f.todo || 0) + (f.impl_markers || []).length;
    html += '<li class="mod-item" data-hit="' + escHtml(f.path) + '">' +
      (hIcons[f.impl_status] || '🔧') + ' <b>' + escHtml(f.name) + '</b>' +
      (f.name_cn && f.name_cn !== '📝 待补充'
        ? ' <span class="fname-cn">' + escHtml(f.name_cn) + '</span>' : '') +
      ' <span class="todo-badge">' + n + ' 处</span></li>';
  }});
  html += '</ul></div></div>';

  // 投入分布条形图
  html += '<h3 class="detail-h3">📊 研发投入分布 <span class="h3-sub">按代码行自动统计 · 看长短腿</span></h3>';
  html += '<div class="dir-bars">';
  dirRows.slice(0, 12).forEach(r => {{
    const pct = Math.max((r[1].lines / maxLines) * 100, r[1].lines > 0 ? 2 : 0);
    html += '<div class="dir-row" title="' + escHtml(r[0]) + '">' +
      '<span class="dir-name">' + escHtml(r[0]) + '</span>' +
      '<span class="dir-bar-wrap"><span class="dir-bar" style="width:' + pct.toFixed(1) + '%"></span></span>' +
      '<span class="dir-num">' + r[1].lines.toLocaleString() + ' 行 · ' + r[1].files + ' 文件</span></div>';
  }});
  html += '</div>';

  // 用法说明
  html += '<h3 class="detail-h3">怎么用这张地图</h3>' +
    '<div class="hint" style="line-height:2">' +
    '① <b>上帝视角</b>：只展开顶层目录，先看清系统由哪几大块组成；<br>' +
    '② <b>架构师视角</b>：展开到模块层（app/services、src/views…）；<br>' +
    '③ <b>开发者视角</b>：目录树全部展开，配合搜索框按文件名 / 中文名 / 类名 / 函数名定位；<br>' +
    '④ 点开任意文件，先看<b>影响面</b>再动手改——红色 = 高风险；点目录名看模块概览。</div>';

  panel.innerHTML = html;
  panel.querySelectorAll('[data-hit]').forEach(li => {{
    li.onclick = function() {{
      const target = findFileByPath(li.dataset.hit);
      if (target) showDetail(target);
    }};
  }});
}}

function goHome() {{
  document.querySelectorAll('.tree-file.active').forEach(el =>
    el.classList.remove('active'));
  showHome();
}}

// 搜索过滤（文件名 / 中文名 / 路径 / 类名 / 函数名）
function setupSearch(rootNode) {{
  const box = document.getElementById('search-box');
  box.oninput = function() {{
    const q = box.value.trim().toLowerCase();
    const container = document.getElementById('tree-container');
    container.innerHTML = '';
    if (!q) {{
      renderTree(rootNode, container);  // 回到当前视角深度
      return;
    }}
    const matched = [];
    function walk(node) {{
      const hay = (node.name + ' ' + (node.name_cn || '') + ' ' +
                   (node.path || '') + ' ' + ((node.sym || []).join(' '))
                  ).toLowerCase();
      if (hay.includes(q)) matched.push(node);
      if (node.children) node.children.forEach(walk);
    }}
    walk(rootNode);
    if (matched.length === 0) {{
      container.innerHTML = '<div class="empty">无匹配（可搜文件名/中文名/类名/函数名）</div>';
    }} else {{
      // 搜索结果全展开（开发者视角）
      matched.slice(0, 50).forEach(m => renderTree(m, container, 99));
    }}
  }};
}}

// 三视角切换
function setupPerspective(rootNode) {{
  const hint = document.getElementById('persp-hint');
  document.querySelectorAll('.persp-btn').forEach(btn => {{
    btn.onclick = function() {{
      document.querySelectorAll('.persp-btn').forEach(b =>
        b.classList.remove('active'));
      btn.classList.add('active');
      currentPersp = btn.dataset.persp;
      hint.textContent = PERSP_HINT[currentPersp];
      const container = document.getElementById('tree-container');
      container.innerHTML = '';
      renderTree(rootNode, container, PERSP_DEPTH[currentPersp]);
      // 视角切换清空搜索框
      const box = document.getElementById('search-box');
      if (box.value) {{ box.value = ''; }}
    }};
  }});
  hint.textContent = PERSP_HINT[currentPersp];
}}

// 初始化
function init() {{
  renderMetrics(EMBEDDED_SUMMARY);
  renderDiagnostics(EMBEDDED_SUMMARY);
  renderDocHealth(EMBEDDED_SUMMARY);
  setupDiagTabs();
  const container = document.getElementById('tree-container');
  renderTree(EMBEDDED_TREE, container, PERSP_DEPTH[currentPersp]);
  setupSearch(EMBEDDED_TREE);
  setupPerspective(EMBEDDED_TREE);
  showHome();   // 详情区默认展示首页态势（榜单+投入分布+用法）
  // 尝试 fetch 更新（如果通过 http 访问）
  if (location.protocol.startsWith('http')) {{
    fetch('./data/summary.json').then(r => r.json()).then(s => {{
      renderMetrics(s);
      renderDiagnostics(s);
      renderDocHealth(s);
      document.getElementById('data-status').textContent = '✅ 已加载最新数据';
    }}).catch(() => {{
      document.getElementById('data-status').textContent = 'ℹ️ 使用静态嵌入数据';
    }});
  }}
}}
init();
</script>
</body>
</html>
"""
