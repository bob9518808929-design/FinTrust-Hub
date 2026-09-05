# 文件名：doc_health_analyzer.py
# 职责：文档健康分析 —— 扫描项目所有 .md 与代码现状对齐，分类 + 归档 + 出对齐报告

"""文档健康分析器 (Doc Health Analyzer).

全景导航的"文档对齐"基座。文档 (尤其 COMPLETION_MATRIX / ROADMAP / SPEC) 会随代码
演进而过期, 仅靠单一文档判定完成度必然失准。本模块做三件事:

1. 对齐  : 提取每份文档引用的代码文件路径, 验证是否仍存在 → 失效引用
2. 分类  : current(有效) / stale(过期) / completed(任务已完成) / report(时点报告)
3. 归档  : 时点报告/变更日志/实验记录类移入 docs/_archive/ (可逆, 不物理删除);
           规格/路线图类只标记不移动 (保留设计参考价值), 在报告中给下一步建议

输出 dict 结构见 analyze_document_health() 返回值, 供 collect.py 嵌入快照与
html_renderer 渲染"文档健康"板块。
"""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# 遍历时直接剪枝的目录 (rglob 会穿透 node_modules, Windows 下数万文件极慢)
_SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", ".git",
              "dist", ".cache", "_archive", ".idea", ".vscode", "site-packages",
              "test-results", "playwright-report", "coverage", ".pytest_cache"}


def _iter_files(root: Path, exts: set[str] | None = None):
    """os.walk 剪枝遍历, 比 rglob 快两个数量级 (跳过 node_modules 等)."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if exts is None or Path(fn).suffix.lower() in exts:
                yield Path(dirpath) / fn

# 视为"代码/配置"的扩展名 (出现在文档里即可能是引用)
CODE_EXT = {
    ".py", ".ts", ".vue", ".js", ".tsx", ".jsx", ".sql",
    ".yaml", ".yml", ".json", ".toml", ".ini", ".cfg", ".sh", ".ps1",
}

# markdown 链接 / 反引号代码 / 裸路径中的文件引用
# 形如: [xx](app/services/a.py)  `backend/app/main.py`  src/api/eco.ts  app/api/v1/
_LINK_RE = re.compile(r"\]\(([^)]+\.(?:py|ts|vue|json|js|sql|ya?ml|sh|ps1))[^)]*\)")
_BACKTICK_RE = re.compile(r"`([^`]+\.(?:py|ts|vue|json|js|sql|ya?ml|sh|ps1))`")
_BARE_RE = re.compile(
    r"(?<![\w./\\-])((?:[a-zA-Z0-9_@\-]+/)+[a-zA-Z0-9_.\-]+\.(?:py|ts|vue|json|js|sql|ya?ml|sh|ps1))"
)
# 目录引用 (以 / 结尾)
_DIR_RE = re.compile(r"`?((?:[a-zA-Z0-9_\-]+/){1,5}[a-zA-Z0-9_\-]+/)`?")

# 任务/规划类文档关键词
_PLAN_KEYWORDS = ("roadmap", "plan", "spec", "matrix", "todo", "任务", "路线图",
                  "规划", "待开发", "待实现", "未实现", "phase", "阶段计划")
# 时点报告/日志类 (归档无争议)
_REPORT_HINTS = ("printable_report", "delivery", "changes_", "changelog",
                 "chaos-", "report", "_log", "degradation_logs", "交付报告")

_STALE_DAYS = 21  # 文档比代码最新版本旧这么多天 → 过期警告
_STALE_BROKEN_RATIO = 0.3  # 失效引用占比阈值


@dataclass
class DocInfo:
    """单份文档的健康信息."""
    rel_path: str
    name: str
    kb: float
    mtime: float
    mtime_iso: str
    age_days: float
    kind: str = "doc"           # plan/report/guide/readme/doc
    refs: list = field(default_factory=list)        # 提取到的引用路径
    broken_refs: list = field(default_factory=list)  # 失效引用
    ref_total: int = 0
    ref_ok: int = 0
    health: str = "current"     # current/stale/completed/report/orphan
    health_reason: str = ""
    archived: bool = False
    archive_note: str = ""


def _classify_kind(name_lower: str, content: str) -> str:
    if name_lower.startswith("readme"):
        return "readme"
    if any(h in name_lower for h in _REPORT_HINTS):
        return "report"
    if any(k in name_lower for k in ("guide", "config", "setup", "deployment",
                                      "integration", "指南", "配置", "部署")):
        return "guide"
    head = content[:1500].lower()
    if any(k in name_lower for k in _PLAN_KEYWORDS) or \
       any(k in head for k in ("roadmap", "待开发", "待实现", "路线图", "todo", "phase")):
        return "plan"
    return "doc"


def _extract_refs(content: str) -> list[str]:
    """提取文档中可能引用代码/配置文件的路径, 去重保序."""
    found: list[str] = []
    for rx in (_LINK_RE, _BACKTICK_RE, _BARE_RE):
        for m in rx.finditer(content):
            p = m.group(1).strip().strip("'\"")
            # 去掉锚点 / 查询
            p = p.split("#")[0].split("?")[0]
            if p and p not in found:
                found.append(p)
    return found


def _normalize_ref(ref: str, production_root: Path) -> str:
    """把文档里五花八门的写法归一化为 production/ 相对路径 (正斜杠)."""
    p = ref.replace("\\", "/").strip().strip("'\"")
    # file:///c:/Users/.../production/backend/app/x.py → backend/app/x.py
    m = re.match(r"file:///(?:[a-zA-Z]:/)?(.+)$", p)
    if m:
        p = m.group(1)
        idx = p.find("/production/")
        if idx >= 0:
            p = p[idx + len("/production/"):]
    p = p.lstrip("/")
    # 文档偶尔带 production/ 前缀 (根目录就是 production)
    if p.startswith("production/"):
        p = p[len("production/"):]
    while p.startswith("./"):
        p = p[2:]
    return p


def _resolve_ref(ref: str, production_root: Path,
                 code_rel: set[str], dir_rel: set[str]) -> bool:
    """文档引用是否仍能对应到真实文件/目录.

    文档写法多样 ('services/x.py' / 'app/services/x.py' /
    'backend/app/services/x.py' / 'frontend/src/api/eco.ts'), 直接候选 +
    全量代码索引后缀匹配双重解析; 命中任一真实文件即视为有效。
    """
    p = _normalize_ref(ref, production_root)
    if not p:
        return True
    is_dir = p.endswith("/")
    p = p.rstrip("/")

    # 1) 通配 (eco-*.js): 对真实文件集合做 fnmatch
    if "*" in p or "?" in p:
        import fnmatch
        hay = dir_rel if is_dir else code_rel
        return any(fnmatch.fnmatch(name, p) or fnmatch.fnmatch(name, "*/" + p)
                   for name in hay)

    # 2) 直接候选 (补常见前缀)
    tails = [p]
    if not p.startswith(("backend/", "frontend/", "docs/", "infra/", "db/",
                        "mobile/", "reference/", "contracts/", "ai-engine/")):
        tails += [f"backend/{p}", f"frontend/{p}",
                  f"backend/app/{p}", f"frontend/src/{p}"]
    hay = dir_rel if is_dir else code_rel
    for t in tails:
        if t in hay:
            return True

    # 3) 后缀匹配: 真实文件路径以引用路径结尾 (services/x.py ← backend/app/services/x.py)
    for name in hay:
        if name == p or name.endswith("/" + p):
            return True
    return False


def analyze_document_health(production_root: Path,
                            archive: bool = True) -> dict:
    """扫描所有 .md, 与代码现状对齐, 返回健康报告 dict.

    Args:
        production_root: production/ 目录绝对路径
        archive: 是否真实归档 (False = 只报告不移动, dry-run)
    """
    production_root = Path(production_root)
    docs_root = production_root / "docs"
    archive_root = docs_root / "_archive"

    # 一次遍历: 代码最新 mtime + 全量代码/目录相对路径索引 (供引用解析)
    code_mtimes = []
    code_rel: set[str] = set()
    for p in _iter_files(production_root, CODE_EXT):
        rel = str(p.relative_to(production_root)).replace("\\", "/")
        code_rel.add(rel)
        try:
            code_mtimes.append(p.stat().st_mtime)
        except OSError:
            pass
    # 目录索引 (文档里常引用目录, 如 app/api/v1/)
    dir_rel: set[str] = set()
    for dirpath, dirnames, _ in os.walk(production_root):
        dirnames[:] = [d for d in dirnames
                       if d not in _SKIP_DIRS and not d.startswith(".")]
        for d in dirnames:
            full = Path(dirpath) / d
            dir_rel.add(str(full.relative_to(production_root))
                        .replace("\\", "/"))

    # 全景工具自身目录 (PANORAMA_NAVIGATION_DESIGN 等文档引用 tools/panorama/ 下文件)
    tool_root = production_root.parent / "tools" / "panorama"
    if tool_root.is_dir():
        for p in _iter_files(tool_root, CODE_EXT | {".md"}):
            rel = "tools/panorama/" + str(p.relative_to(tool_root)).replace("\\", "/")
            code_rel.add(rel)
        for dirpath, dirnames, _ in os.walk(tool_root):
            dirnames[:] = [d for d in dirnames
                           if d not in _SKIP_DIRS and not d.startswith(".")]
            for d in dirnames:
                full = Path(dirpath) / d
                dir_rel.add("tools/panorama/" +
                            str(full.relative_to(tool_root)).replace("\\", "/"))

    newest_code = max(code_mtimes) if code_mtimes else datetime.now(timezone.utc).timestamp()
    now = datetime.now(timezone.utc).timestamp()

    docs: list[DocInfo] = []
    md_files = sorted(_iter_files(production_root, {".md"}),
                      key=lambda p: str(p).lower())
    for md in md_files:
        try:
            content = md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = str(md.relative_to(production_root)).replace("\\", "/")
        st = md.stat()
        info = DocInfo(
            rel_path=rel,
            name=md.name,
            kb=round(st.st_size / 1024, 1),
            mtime=st.st_mtime,
            mtime_iso=datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d"),
            age_days=round((now - st.st_mtime) / 86400, 1),
        )
        info.kind = _classify_kind(md.name.lower(), content)

        # 引用对齐
        refs = _extract_refs(content)
        info.refs = refs
        info.ref_total = len(refs)
        for ref in refs:
            if _resolve_ref(ref, production_root, code_rel, dir_rel):
                info.ref_ok += 1
            else:
                info.broken_refs.append(ref)

        # === 健康分类 ===
        broken_ratio = (len(info.broken_refs) / info.ref_total) if info.ref_total else 0.0
        is_stale_age = (newest_code - info.mtime) / 86400 > _STALE_DAYS

        if info.kind == "report":
            info.health = "report"
            info.health_reason = "时点报告/变更日志/实验记录, 属历史快照"
        elif info.kind == "plan":
            # 任务/路线图: 引用大量失效或长期未更新 → 过期
            if broken_ratio >= _STALE_BROKEN_RATIO and info.ref_total > 0:
                info.health = "stale"
                info.health_reason = (f"规划文档失效引用 {len(info.broken_refs)}/"
                                      f"{info.ref_total}, 与代码脱节")
            elif is_stale_age and info.ref_total == 0:
                info.health = "stale"
                info.health_reason = f"规划文档 {info.age_days:.0f} 天未更新且无代码引用"
            elif broken_ratio > 0:
                info.health = "stale"
                info.health_reason = f"部分引用失效 ({len(info.broken_refs)} 处)"
            else:
                info.health = "current"
                info.health_reason = "规划与代码现状一致"
        elif info.kind == "guide":
            if broken_ratio >= _STALE_BROKEN_RATIO and info.ref_total > 0:
                info.health = "stale"
                info.health_reason = f"配置/部署指南失效引用 {len(info.broken_refs)} 处"
            elif is_stale_age and info.ref_total > 0 and broken_ratio > 0:
                info.health = "stale"
                info.health_reason = f"指南 {info.age_days:.0f} 天未更新, 引用有失效"
            else:
                info.health = "current"
                info.health_reason = "指南引用有效"
        else:
            # readme / 普通 doc
            if broken_ratio >= 0.5 and info.ref_total >= 2:
                info.health = "stale"
                info.health_reason = f"文档失效引用 {len(info.broken_refs)}/{info.ref_total}"
            else:
                info.health = "current"
                info.health_reason = "内容有效"

        docs.append(info)

    # === 归档 (只处理 docs/ 下; report 类归档; 其余只标记) ===
    archived: list[dict] = []
    if archive and docs_root.exists():
        archive_root.mkdir(parents=True, exist_ok=True)
        for info in docs:
            src = production_root / info.rel_path
            # 仅归档 docs/ 直属的 report 类 (安全可逆, 不动 readme/散落文档)
            if info.kind == "report" and info.rel_path.startswith("docs/") and \
               not info.archived and src.is_file():
                dst = archive_root / info.name
                try:
                    shutil.move(str(src), str(dst))
                    info.archived = True
                    info.archive_note = f"已移入 docs/_archive/{info.name}"
                    archived.append({
                        "name": info.name,
                        "reason": info.health_reason,
                        "to": f"docs/_archive/{info.name}",
                    })
                except OSError as e:
                    info.archive_note = f"归档失败: {e}"

    # 归档区累计内容（含历史已归档; _archive 不在扫描索引内, 单独统计）
    archive_total = 0
    archived_names: list[str] = []
    if docs_root.exists() and archive_root.exists():
        archived_names = sorted(
            p.name for p in archive_root.iterdir()
            if p.is_file() and p.suffix.lower() in (".md", ".markdown"))
        archive_total = len(archived_names)

    # === 汇总 ===
    def cnt(h): return sum(1 for d in docs if d.health == h)
    total_refs = sum(d.ref_total for d in docs)
    total_broken = sum(len(d.broken_refs) for d in docs)

    stale_docs = [
        {
            "name": d.name, "rel_path": d.rel_path, "kind": d.kind,
            "age_days": d.age_days, "mtime": d.mtime_iso,
            "reason": d.health_reason,
            "broken_refs": d.broken_refs[:8],
            "broken_count": len(d.broken_refs),
            "archived": d.archived,
        }
        for d in docs if d.health in ("stale", "report")
    ]

    health_rate = round(
        100.0 * sum(1 for d in docs if d.health == "current") / max(1, len(docs)), 1
    )

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "total_docs": len(docs),
        "current": cnt("current"),
        "stale": cnt("stale"),
        "report": cnt("report"),
        "archived_count": len(archived),
        "archived": archived,
        "archive_total": archive_total,
        "archive_names": archived_names,
        "health_rate": health_rate,
        "ref_total": total_refs,
        "ref_broken": total_broken,
        "newest_code_at": datetime.fromtimestamp(newest_code).strftime("%Y-%m-%d"),
        "stale_details": stale_docs,
        "all_docs": [
            {"name": d.name, "rel_path": d.rel_path, "kind": d.kind,
             "health": d.health, "age_days": d.age_days, "mtime": d.mtime_iso,
             "kb": d.kb, "ref_total": d.ref_total,
             "broken_count": len(d.broken_refs), "reason": d.health_reason,
             "archived": d.archived}
            for d in sorted(docs, key=lambda x: (x.health != "stale", x.rel_path))
        ],
    }


# 自检
if __name__ == "__main__":
    import json
    # doc_health_analyzer.py → analyzers → panorama → tools → jinrong
    root = Path(__file__).resolve().parents[3] / "production"
    report = analyze_document_health(root, archive=False)
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("all_docs", "stale_details")},
                     ensure_ascii=False, indent=2))
