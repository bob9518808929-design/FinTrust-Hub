# 文件名：markdown_renderer.py
# 职责：生成 AGENT_CONTEXT.md（机器可读摘要，目标 20-50KB，硬上限 100KB）
# 8 大区块：项目骨架/已实现模块/待开发清单/最近变更/4 大指标/待补充注释/已知阻塞/上次完成位置

"""AGENT_CONTEXT.md 渲染器

设计哲学：
  - 机器可读优先：纯文本 + Markdown 表格
  - 白盒可解释：每条信息都有溯源
  - 渐进调节：超限时截断
  - 傻瓜式操作：Agent 只读这一份文件即可回忆项目全貌
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def render_agent_context(snapshot, config: dict) -> str:
    """渲染 AGENT_CONTEXT.md

    Args:
        snapshot: PanoramaSnapshot 实例（含所有数据）
        config: 配置 dict

    Returns:
        Markdown 字符串
    """
    sections = [
        _render_header(snapshot),
        _render_section_1_skeleton(snapshot, config),
        _render_section_2_modules(snapshot, config),
        _render_section_3_pending(snapshot),
        _render_section_4_recent_commits(snapshot),
        _render_section_5_metrics(snapshot),
        _render_section_5b_doc_alignment(snapshot),
        _render_section_6_missing_annotations(snapshot),
        _render_section_7_blockers(snapshot),
        _render_section_8_last_position(snapshot),
        _render_agent_behavior_constraints(),
    ]
    return "\n\n".join(sections)


# ============================================================================
# 区块渲染
# ============================================================================

def _render_header(snapshot) -> str:
    """文档头"""
    return f"""# FinTrust Hub Agent 上下文

> **生成时间**：{snapshot.generated_at}
> **生成模式**：{snapshot.mode}
> **数据源**：`production/` 实时扫描
> **硬约束**：本文件供 AI Agent 在每次开发前强制读取，杜绝幻觉与跑偏

---"""


def _render_section_1_skeleton(snapshot, config) -> str:
    """区块 1：项目骨架"""
    lines = ["## 1. 项目骨架（8 个一级目录）", ""]
    lines.append("```")
    lines.append(f"production/")
    top_modules = config.get("project", {}).get(
        "top_level_modules", ["ai-engine", "backend", "contracts", "db",
                                "frontend", "infra", "mobile", "reference"]
    )
    # 按目录归类文件
    files_by_module = {}
    for fi in snapshot.files:
        mod = fi.path.split("/")[0] if "/" in fi.path else fi.path
        files_by_module.setdefault(mod, 0)
        files_by_module[mod] += 1

    for mod in top_modules:
        count = files_by_module.get(mod, 0)
        lines.append(f"├── {mod}/  ({count} 个文件)")
    lines.append("```")
    return "\n".join(lines)


def _render_section_2_modules(snapshot, config) -> str:
    """区块 2：已实现模块列表（按目录归类）"""
    lines = ["## 2. 已实现模块列表", ""]
    # 按一级目录归类
    by_module = {}
    for fi in snapshot.files:
        mod = fi.path.split("/")[0] if "/" in fi.path else fi.path
        by_module.setdefault(mod, []).append(fi)

    for mod in sorted(by_module.keys()):
        files = by_module[mod]
        lines.append(f"### {mod}/ ({len(files)} 个文件)")
        lines.append("")
        lines.append("| 文件 | 中文名 | 职责 |")
        lines.append("|---|---|---|")
        # 限制每个模块显示前 20 个文件，避免膨胀
        for fi in files[:20]:
            name = fi.name_cn or "📝 待补充"
            resp = (fi.responsibility_cn[:40] + "...") if \
                len(fi.responsibility_cn) > 40 else fi.responsibility_cn
            lines.append(f"| `{fi.path}` | {name} | {resp} |")
        if len(files) > 20:
            lines.append(f"| ... 还有 {len(files)-20} 个文件 | | |")
        lines.append("")
    return "\n".join(lines)


def _render_section_3_pending(snapshot) -> str:
    """区块 3：空目录/待开发清单"""
    lines = ["## 3. 待开发清单（空目录/缺文件）", ""]
    # 检测空目录：top_level_modules 下没有文件的目录
    expected = ["ai-engine", "backend", "contracts", "db", "frontend",
                "infra", "mobile", "reference"]
    found = set()
    for fi in snapshot.files:
        mod = fi.path.split("/")[0] if "/" in fi.path else fi.path
        found.add(mod)
    missing_dirs = [m for m in expected if m not in found]
    if missing_dirs:
        lines.append("**缺失的一级目录**：")
        for d in missing_dirs:
            lines.append(f"- ⚠️ `{d}/` 完全缺失")
        lines.append("")
    else:
        lines.append("（无缺失的一级目录，所有 8 个目录均有代码）")
        lines.append("")
    return "\n".join(lines)


def _render_section_4_recent_commits(snapshot) -> str:
    """区块 4：最近 5 次变更摘要"""
    lines = ["## 4. 最近 5 次变更记录", ""]
    commits = snapshot.git_summary.get("recent_commits", [])
    if not commits:
        lines.append("（无法获取 Git 历史）")
        return "\n".join(lines)
    lines.append("```")
    lines.append("📝 最近变更（按时间倒序）：")
    for c in commits[:5]:
        lines.append(f"- {c.get('date','')} | {c.get('author','')} | "
                     f"{c.get('message','')[:60]}")
    lines.append("```")
    return "\n".join(lines)


def _render_section_5_metrics(snapshot) -> str:
    """区块 5：4 大指标区块"""
    lines = ["## 5. 系统开发进展（4 大指标）", ""]
    # 完成度
    rate = snapshot.completion_rate * 100
    completed = snapshot.completed_modules
    in_prog = snapshot.in_progress_modules
    not_started = snapshot.not_started_modules
    blocked = snapshot.blocked_modules
    lines.append("```")
    lines.append(f"📊 代码实测完成度：{rate:.1f}%（逐文件扫描 impl 标记加权, 代码即事实）")
    bd = snapshot.completion_breakdown or {}
    ca = bd.get("code_actual") or {}
    if ca:
        lines.append(f"├── ✅ 已实现: {ca.get('done',0)} 文件")
        lines.append(f"├── 🟡 部分实现: {ca.get('partial',0)} 文件")
        lines.append(f"├── 📋 骨架: {ca.get('skeleton',0)} 文件")
        lines.append(f"└── 🔜 占位: {ca.get('placeholder',0)} 文件"
                     f"（共 {ca.get('total',0)} 个代码文件）")
    lines.append("")
    if bd.get("total"):
        lines.append(f"📋 规划口径(MATRIX): {bd.get('weighted',0)}%"
                     f"{'  ⚠️ MATRIX 已过期' if bd.get('matrix_stale') else ''}")
        lines.append(f"   ✅{bd.get('done',0)} 🟡{bd.get('partial',0)} "
                     f"📋{bd.get('doc',0)} 🔜{bd.get('roadmap',0)}"
                     f" / {bd.get('total',0)} 项任务")
    for note in bd.get("cross_check_notes", []):
        lines.append(f"   {note}")
    lines.append("```")
    lines.append("")

    # 最近变更（已在区块 4）
    # Git 分支
    git = snapshot.git_summary
    lines.append("```")
    lines.append(f"🌿 当前分支: {git.get('branch','unknown')}")
    lines.append(f"📦 未提交变更: {git.get('uncommitted_count',0)} 个文件")
    lines.append(f"🚀 领先 origin: {git.get('ahead_of_origin',0)} 个 commits")
    lines.append("```")
    lines.append("")

    # 风险
    risks = snapshot.risks
    lines.append("```")
    lines.append("🚨 当前风险/阻塞：")
    if not risks:
        lines.append("- 无阻断级错误")
    else:
        for r in risks[:10]:
            sev = r.get("severity", "info")
            icon = {"blocker": "🔴", "warning": "⚠️",
                    "info": "ℹ️"}.get(sev, "ℹ️")
            lines.append(f"- {icon} [{r.get('type','unknown')}] "
                         f"{r.get('detail','')[:80]}")
    lines.append("```")
    return "\n".join(lines)


def _render_section_5b_doc_alignment(snapshot) -> str:
    """区块 5b：文档健康对齐报告（过期/归档/下一步）"""
    dh = snapshot.doc_health or {}
    lines = ["## 5b. 文档健康对齐报告", ""]
    if not dh or dh.get("error") or not dh.get("total_docs"):
        lines.append("（--quick 模式未跑文档对齐；运行 `--full` 生成）")
        return "\n".join(lines)

    lines.append("```")
    lines.append(f"📄 文档健康率: {dh.get('health_rate',0)}%"
                 f"（{dh.get('current',0)} 有效 / {dh.get('stale',0)} 过期 / "
                 f"{dh.get('report',0)} 时点报告，共 {dh.get('total_docs',0)} 份）")
    lines.append(f"🔗 失效代码引用: {dh.get('ref_broken',0)}/{dh.get('ref_total',0)} 处")
    lines.append(f"⏱ 扫描时间: {dh.get('generated_at','?')}"
                 f" | 代码最新变更日: {dh.get('newest_code_at','?')}")
    lines.append(f"📦 归档区累计: {dh.get('archive_total', dh.get('archived_count',0))} 份"
                 f"（本次新增 {dh.get('archived_count',0)}）→ docs/_archive/（可逆）")
    lines.append("```")
    lines.append("")

    # 过期/报告文档明细
    details = dh.get("stale_details", [])
    if details:
        lines.append("**需处理文档清单**：")
        lines.append("")
        lines.append("| 状态 | 文档 | 原因 | 失效引用 | 更新日期 |")
        lines.append("|---|---|---|---|---|")
        for d in details:
            icon = "📦报告" if d.get("health") == "report" else "⚠️过期"
            name = f"`{d.get('rel_path','')}`"
            if d.get("archived"):
                name += " ✅已归档"
            lines.append(f"| {icon} | {name} | {d.get('reason','')} "
                         f"| {d.get('broken_count',0)} 处 "
                         f"| {d.get('mtime','')} |")
        lines.append("")

    # 归档清单（归档区累计内容）
    archive_names = dh.get("archive_names", []) or [
        a.get("name", "") for a in dh.get("archived", [])]
    if archive_names:
        lines.append("**归档区 `docs/_archive/` 清单**（时点报告/变更日志，可随时恢复）：")
        for n in archive_names:
            lines.append(f"- 📦 `{n}`")
        lines.append("")

    # 对齐问题与下一步解决方案
    lines.append("**对齐发现的问题与下一步**：")
    bd = snapshot.completion_breakdown or {}
    if bd.get("matrix_stale"):
        lines.append("- ⚠️ **COMPLETION_MATRIX.md 已过期**：仍引用旧版 view-*.js 原型"
                     "与旧目录结构；完成度口径已切换为代码实测（逐文件扫描），"
                     "建议下次迭代后重写 MATRIX 或将其归档")
    if dh.get("stale", 0) > 0:
        lines.append(f"- ⚠️ **{dh['stale']} 份文档引用失效**：多为旧原型路径"
                     "（vanilla JS → Vue3 迁移、目录扁平化），需人工复核："
                     "已完成使命的归档，仍有参考价值的更新引用路径")
    if dh.get("report", 0) > 0:
        lines.append(f"- 📦 **{dh['report']} 份时点报告/变更日志**：属历史快照，"
                     "由 `--full` 自动归档，不物理删除")
    lines.append("- ✅ 日常开发用 `--quick`（0.8s）刷新；发版/里程碑后跑 `--full` 做全量对齐")
    lines.append("")
    return "\n".join(lines)


def _render_section_6_missing_annotations(snapshot) -> str:
    """区块 6：待补充注释文件清单"""
    lines = ["## 6. 待补充中文注释的文件", ""]
    missing = [fi for fi in snapshot.files if fi.name_source == "missing"]
    if not missing:
        lines.append("（所有文件都有中文名，无需补充）")
        return "\n".join(lines)
    lines.append(f"共 **{len(missing)}** 个文件缺中文注释，建议批量补全：")
    lines.append("")
    lines.append("| 文件路径 | 推断 | 建议补全 |")
    lines.append("|---|---|---|")
    for fi in missing[:30]:
        suggest = f"`# 文件名：`（请填写）"
        lines.append(f"| `{fi.path}` | {fi.name_cn or '📝'} | {suggest} |")
    if len(missing) > 30:
        lines.append(f"| ... 还有 {len(missing)-30} 个 | | |")
    return "\n".join(lines)


def _render_section_7_blockers(snapshot) -> str:
    """区块 7：已知阻塞项与风险（含修复建议）"""
    lines = ["## 7. 已知阻塞项与风险（含修复建议）", ""]
    risks = snapshot.risks
    if not risks:
        lines.append("（当前无已知阻塞项）")
        return "\n".join(lines)
    for r in risks[:20]:
        sev = r.get("severity", "info")
        icon = {"blocker": "🔴", "warning": "⚠️",
                "info": "ℹ️"}.get(sev, "ℹ️")
        lines.append(f"### {icon} [{r.get('type','unknown')}] "
                     f"{r.get('rule_id', '')}")
        lines.append(f"- 详情：{r.get('detail','')}")
        if "remediation" in r:
            rem = r["remediation"]
            lines.append(f"- 建议命令：`{rem.get('command','')}`")
            lines.append(f"- 解释：{rem.get('explanation','')}")
            lines.append(f"- 置信度：{rem.get('confidence',0)} | "
                        f"来源：{rem.get('source','')} | "
                        f"待人工确认：{'是' if rem.get('requires_human') else '否'}")
            lines.append(f"- **Agent 行为约束**：仅可向用户建议执行，"
                         f"不得自动 shell 调用")
        lines.append("")
    return "\n".join(lines)


def _render_section_8_last_position(snapshot) -> str:
    """区块 8：上次完成位置（对抗上下文窗口限制）"""
    lines = ["## 8. 上次完成位置（防止 Agent 失忆）", ""]
    git = snapshot.git_summary
    lines.append(f"- 当前 Git HEAD 分支：`{git.get('branch','unknown')}`")
    lines.append(f"- 未提交文件数：{git.get('uncommitted_count',0)}")
    uncommitted = git.get("uncommitted_files", [])
    if uncommitted:
        lines.append("- 未提交文件列表：")
        for u in uncommitted[:20]:
            lines.append(f"  - `{u.get('status','?')}` {u.get('file','')}")
        if len(uncommitted) > 20:
            lines.append(f"  - ... 还有 {len(uncommitted)-20} 个")
    lines.append("")
    lines.append(f"- 孤儿契约边数：{sum(1 for e in snapshot.contract_edges if e.get('is_orphan'))}")
    lines.append("")
    lines.append("> **Agent 续作指引**：如果未提交文件数 > 0，"
                 "优先查看这些文件的最后修改内容；"
                 "如未提交数 = 0，从最近一次 commit message 推进下一步。")
    return "\n".join(lines)


def _render_agent_behavior_constraints() -> str:
    """区块 9：Agent 行为约束"""
    return """## 9. Agent 行为硬约束（必读）

1. **强制开机自检**：在开始任何代码编写/修改/重构之前，必须先读取本文件。
2. **禁止自动执行修复命令**：第 7 区块的所有"建议命令"必须由人类用户拍板，Agent 仅可提议。
3. **置信度 < 0.7 的建议**：仅展示 reference，不展示 command。
4. **生产环境状态降级**：在生产环境部署的 panorama/ 不含 DB 探测脚本，状态栏统一显示"🟡 降级"。
5. **AGENT_CONTEXT.md 大小硬上限 100KB**：超限时截断，仅保留最近 3 个月变更+当前活跃模块。
6. **不重复造轮子**：已实现模块列表中存在的功能，禁止重复实现。

---

> 本文件由 `tools/panorama/collect.py` 自动生成，请勿手动编辑。
> 下次开发前自动刷新：`python tools/panorama/collect.py --quick`（< 3 秒）
"""


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    from dataclasses import dataclass, field
    @dataclass
    class FakeSnapshot:
        generated_at: str = "2026-09-04 10:00:00"
        mode: str = "full"
        project_root: str = "."
        completion_rate: float = 0.725
        completed_modules: list = field(default_factory=lambda: ["backend","frontend"])
        in_progress_modules: list = field(default_factory=lambda: ["ai-engine"])
        not_started_modules: list = field(default_factory=lambda: [])
        blocked_modules: list = field(default_factory=lambda: [])
        total_files: int = 100
        total_modules: int = 8
        total_lines: int = 50000
        running_modules: int = 5
        healthy_modules: int = 4
        fault_modules: int = 0
        files: list = field(default_factory=list)
        contract_edges: list = field(default_factory=list)
        git_summary: dict = field(default_factory=lambda: {
            "branch": "main",
            "uncommitted_count": 3,
            "uncommitted_files": [{"status":"M","file":"a.py"}],
            "ahead_of_origin": 2,
            "recent_commits": [{"date":"2026-09-04","author":"u","message":"test"}]
        })
        missing_annotations: list = field(default_factory=list)
        risks: list = field(default_factory=list)
        spec_alignment: dict = field(default_factory=dict)
    snap = FakeSnapshot()
    out = render_agent_context(snap, {"project": {"top_level_modules": ["backend","frontend"]}})
    print(out[:2000])
    print(f"\n... 总长度：{len(out)} 字符")
