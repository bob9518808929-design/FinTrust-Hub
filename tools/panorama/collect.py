#!/usr/bin/env python3
# 文件名：collect.py
# 职责：全景导航工具主采集脚本，支持 --quick/--incremental/--full/--text 四模式
# 关联 spec：MOD-00（基础设施）

"""
FinTrust Hub 全景导航 - 主采集脚本

四种运行模式：
  --quick        Agent 启动前快速刷新（< 3s，仅扫最近变更+Git 日志）
  --incremental  日常开发，基于文件指纹增量（< 10s）
  --full         首次运行/CI 定期（全量）
  --text         仅生成 AGENT_CONTEXT.md，不跑 AST

双产出：
  1. data/summary.json + data/panorama_data.json
  2. data/AGENT_CONTEXT.md
  3. panorama_dashboard.html（除非 --text）

用法：
  python collect.py --quick
  python collect.py --incremental
  python collect.py --full
  python collect.py --text
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

# 将本目录加入 sys.path 以便导入子模块
SELF_DIR = Path(__file__).resolve().parent
if str(SELF_DIR) not in sys.path:
    sys.path.insert(0, str(SELF_DIR))

# 项目的根目录（panorama 工具的祖父级 = jinrong 根）
PROJECT_ROOT = SELF_DIR.parent.parent  # tools/panorama -> tools -> jinrong
PRODUCTION_DIR = PROJECT_ROOT / "production"

try:
    import yaml
except ImportError:
    yaml = None  # 配置缺失时降级


# ============================================================================
# 数据模型
# ============================================================================

@dataclass
class FileInfo:
    """单个文件的信息"""
    path: str  # 相对 production/ 路径
    absolute_path: str
    language: str  # python/ts/vue/sql/yaml/unknown
    size: int
    mtime: float
    line_count: int = 0
    # 中文注释
    name_cn: str = ""  # 中文名
    responsibility_cn: str = ""  # 职责说明
    name_source: str = "missing"  # spec/manual/comment/filename/missing
    # 依赖
    imports: list = field(default_factory=list)  # 同语言 import（已解析为 rel path）
    imported_by: list = field(default_factory=list)  # 被哪些文件 import
    imports_raw: list = field(default_factory=list)  # 未解析的 import 描述（缓存用）
    # Git
    last_commit_at: str = ""
    last_commit_msg: str = ""
    last_commit_author: str = ""
    # 状态
    status: str = "no_state"  # healthy/degraded/fault/not_started/no_state（运行时）
    impl_status: str = "done"  # 实现状态: done/partial/skeleton/placeholder
    impl_markers: list = field(default_factory=list)  # 检测到的降级/mock 标记
    # 诊断
    diagnosis: dict = field(default_factory=dict)  # 匹配的修复建议
    # 代码统计
    class_count: int = 0
    function_count: int = 0
    symbols: list = field(default_factory=list)  # 顶层 def/class/函数名（搜索用）
    # 结构化代码细节（详情面板"代码结构"用）
    classes: list = field(default_factory=list)  # [{n,m:[方法名],d:doc首行}]（Python AST）
    functions: list = field(default_factory=list)  # [{n,d:doc首行}]
    imports_external: list = field(default_factory=list)  # 第三方库根包名
    todo_count: int = 0  # TODO/FIXME/HACK/XXX 计数（待办热点榜）
    # 源码预览（前 30 行, 供面板"代码层面细节"展示）
    source_preview: str = ""
    # 每文件 Git 最近提交（[{d,m}] ≤3 条, 详情面板"最近变更"）
    git_log: list = field(default_factory=list)
    # 指纹（用于增量缓存）
    fingerprint: str = ""


@dataclass
class ContractEdge:
    """跨语言契约边（frontend api/*.ts → backend api/v1/*.py）"""
    frontend_file: str
    backend_file: str
    http_method: str
    path: str
    is_orphan: bool = False  # 孤儿契约（前端调了但后端没注册）


@dataclass
class DependencyEdge:
    """同语言 import 依赖边"""
    source: str
    target: str
    edge_type: str  # import/contract_call/db_access


@dataclass
class GitSummary:
    """Git 状态摘要"""
    branch: str = ""
    uncommitted_count: int = 0
    uncommitted_files: list = field(default_factory=list)
    ahead_of_origin: int = 0
    recent_commits: list = field(default_factory=list)  # 最近 N 次


@dataclass
class PanoramaSnapshot:
    """全景快照（数据底座）"""
    generated_at: str = ""
    mode: str = ""
    project_root: str = ""
    # 4 大指标
    completion_rate: float = 0.0
    completed_modules: list = field(default_factory=list)
    in_progress_modules: list = field(default_factory=list)
    not_started_modules: list = field(default_factory=list)
    blocked_modules: list = field(default_factory=list)
    # 统计
    total_files: int = 0
    total_modules: int = 0
    total_lines: int = 0
    running_modules: int = 0
    healthy_modules: int = 0
    fault_modules: int = 0
    # 文件树
    files: list = field(default_factory=list)  # List[FileInfo]
    # 边
    contract_edges: list = field(default_factory=list)
    dependency_edges: list = field(default_factory=list)
    # Git
    git_summary: dict = field(default_factory=dict)
    # 待补充
    missing_annotations: list = field(default_factory=list)  # 缺中文注释的文件
    # 风险
    risks: list = field(default_factory=list)
    # trace_report 复用
    spec_alignment: dict = field(default_factory=dict)
    # 完成度分解（基于 COMPLETION_MATRIX.md 真实状态）
    completion_breakdown: dict = field(default_factory=dict)  # {done, partial, doc, roadmap, total, weighted}
    # 模块真实状态（key=path, value={status, detail}）
    module_status_detail: list = field(default_factory=list)
    # 文档健康（doc_health_analyzer 产出; 文档对齐状态 + 归档记录）
    doc_health: dict = field(default_factory=dict)


# ============================================================================
# 配置加载
# ============================================================================

def load_config() -> dict:
    """加载 config.yaml"""
    cfg_path = SELF_DIR / "config.yaml"
    if not cfg_path.exists():
        return {}
    if yaml is None:
        # 降级：返回默认配置
        return _default_config()
    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _default_config() -> dict:
    """降级默认配置（PyYAML 缺失时）"""
    return {
        "project": {
            "root": str(PRODUCTION_DIR),
            "top_level_modules": ["ai-engine", "backend", "contracts", "db",
                                   "frontend", "infra", "mobile", "reference"],
            "exclude_dirs": ["__pycache__", ".venv", "node_modules",
                             ".pytest_cache", ".git", "dist", "build", ".cache"],
            "include_extensions": [".py", ".ts", ".js", ".vue", ".sql", ".yaml", ".yml"],
        },
        "agent_context": {"target_size_kb": 50, "hard_limit_kb": 100},
        "remediation": {"rules_file": "remediation_rules.yaml",
                        "confidence_threshold": 0.7},
    }


# ============================================================================
# 工具函数
# ============================================================================

LANG_MAP = {
    ".py": "python",
    ".ts": "ts",
    ".tsx": "ts",
    ".js": "js",
    ".jsx": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".vue": "vue",
    ".sql": "sql",
    ".yaml": "yaml",
    ".yml": "yaml",
}


def get_language(file_path: Path) -> str:
    """从扩展名推断语言"""
    return LANG_MAP.get(file_path.suffix.lower(), "unknown")


def compute_fingerprint(file_path: Path, hash_lines: int = 50) -> str:
    """计算文件指纹：mtime + size + hash(head_50_lines)"""
    stat = file_path.stat()
    mtime = stat.st_mtime
    size = stat.st_size
    # 读前 N 行计算 hash
    h = hashlib.md5()
    try:
        with open(file_path, "rb") as f:
            for i, line in enumerate(f):
                if i >= hash_lines:
                    break
                h.update(line)
    except (PermissionError, UnicodeDecodeError):
        pass
    return f"{mtime:.0f}|{size}|{h.hexdigest()[:12]}"


def count_lines(file_path: Path) -> int:
    """统计文件行数"""
    try:
        with open(file_path, "rb") as f:
            return sum(1 for _ in f)
    except (PermissionError, OSError):
        return 0


# ============================================================================
# 主流程
# ============================================================================

class PanoramaCollector:
    """全景采集器主类"""

    def __init__(self, mode: str, config: dict):
        self.mode = mode
        self.config = config
        self.project_cfg = config.get("project", {})
        self.root = PRODUCTION_DIR
        self.exclude_dirs = set(self.project_cfg.get("exclude_dirs", []))
        self.include_exts = set(self.project_cfg.get("include_extensions", []))
        self.snapshot = PanoramaSnapshot(
            generated_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            mode=mode,
            project_root=str(self.root),
        )
        # 缓存
        self.cache_dir = SELF_DIR / ".cache"
        self.cache_dir.mkdir(exist_ok=True)
        self.fingerprint_cache_path = self.cache_dir / "file_fingerprints.json"
        self.fingerprint_cache: dict = self._load_fingerprint_cache()
        # 人工覆盖
        self.manual_overrides: dict = self._load_manual_overrides()
        # 上次快照
        self.prev_snapshot_path = SELF_DIR / "data" / "panorama_data.json"

    # ----- 缓存加载 -----

    def _load_fingerprint_cache(self) -> dict:
        """加载文件指纹缓存"""
        if self.fingerprint_cache_path.exists():
            try:
                with open(self.fingerprint_cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save_fingerprint_cache(self):
        """保存文件指纹缓存"""
        try:
            with open(self.fingerprint_cache_path, "w", encoding="utf-8") as f:
                json.dump(self.fingerprint_cache, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    def _load_manual_overrides(self) -> dict:
        """加载人工覆盖表"""
        path = SELF_DIR / "manual_overrides.yaml"
        if not path.exists() or yaml is None:
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            return data.get("overrides", {})
        except (yaml.YAMLError, OSError):
            return {}

    # ----- 文件扫描 -----

    def scan_files(self) -> list[FileInfo]:
        """扫描 production/ 下所有支持的文件"""
        files: list[FileInfo] = []
        skip_ast = self.config.get("modes", {}).get(self.mode, {}).get("skip_ast", False)

        for path in self._iter_project_files():
            rel_path = str(path.relative_to(self.root)).replace("\\", "/")
            lang = get_language(path)
            if lang == "unknown":
                continue
            # 计算指纹
            new_fp = compute_fingerprint(path)
            old_fp = self.fingerprint_cache.get(rel_path, {}).get("fingerprint", "")
            changed = (new_fp != old_fp) or self.mode == "full"

            fi = FileInfo(
                path=rel_path,
                absolute_path=str(path),
                language=lang,
                size=path.stat().st_size,
                mtime=path.stat().st_mtime,
                fingerprint=new_fp,
            )
            # 行数统计始终执行（即使 --quick 也保留，不耗资源）
            fi.line_count = count_lines(path)

            # 中文注释提取（仅变更的文件，或全量模式）
            if changed or self.mode == "full" or self.mode == "incremental":
                self._extract_annotation(fi)
                self._detect_impl_status(fi)
                self._extract_imports_and_symbols(fi)
            else:
                # 从缓存恢复
                cached = self.fingerprint_cache.get(rel_path, {})
                fi.name_cn = cached.get("name_cn", "")
                fi.responsibility_cn = cached.get("responsibility_cn", "")
                fi.name_source = cached.get("name_source", "missing")
                fi.impl_status = cached.get("impl_status", "done")
                fi.impl_markers = cached.get("impl_markers", [])
                fi.imports_raw = cached.get("imports_raw", [])
                fi.symbols = cached.get("symbols", [])
                fi.class_count = cached.get("class_count", 0)
                fi.function_count = cached.get("function_count", 0)
                fi.source_preview = cached.get("source_preview", "")
                fi.classes = cached.get("classes", [])
                fi.functions = cached.get("functions", [])
                fi.imports_external = cached.get("imports_external", [])
                fi.todo_count = cached.get("todo_count", 0)

            # 缺失注释统计（无论何种模式都检查，但跳过自动生成文件）
            _AUTOGEN_SUFFIXES = ("pnpm-lock.yaml", "yarn.lock", "package-lock.json",
                                 ".d.ts", "auto-imports.d.ts", "components.d.ts",
                                 "vite-env.d.ts", ".min.js", ".min.css")
            is_autogen = fi.path.endswith(_AUTOGEN_SUFFIXES)
            if fi.name_source == "missing" and not is_autogen \
                    and fi.path not in self.snapshot.missing_annotations:
                self.snapshot.missing_annotations.append(fi.path)

            # 更新缓存
            self.fingerprint_cache[rel_path] = {
                "fingerprint": new_fp,
                "name_cn": fi.name_cn,
                "responsibility_cn": fi.responsibility_cn,
                "name_source": fi.name_source,
                "impl_status": fi.impl_status,
                "impl_markers": fi.impl_markers,
                "imports_raw": fi.imports_raw,
                "symbols": fi.symbols,
                "class_count": fi.class_count,
                "function_count": fi.function_count,
                "source_preview": fi.source_preview,
                "classes": fi.classes,
                "functions": fi.functions,
                "imports_external": fi.imports_external,
                "todo_count": fi.todo_count,
                "line_count": fi.line_count,
            }

            files.append(fi)

        self._save_fingerprint_cache()
        return files

    def _iter_project_files(self):
        """遍历 production/ 下的文件（排除指定目录）"""
        if not self.root.exists():
            return
        for dirpath, dirnames, filenames in os.walk(self.root):
            # 过滤排除目录
            dirnames[:] = [d for d in dirnames if d not in self.exclude_dirs]
            for fname in filenames:
                ext = Path(fname).suffix.lower()
                if ext in self.include_exts:
                    yield Path(dirpath) / fname

    # ----- 注释提取（调用 extractors 子模块）-----

    def _extract_annotation(self, fi: FileInfo):
        """提取中文注释（按语言分派）"""
        # 1. 优先级最高：人工覆盖
        if fi.path in self.manual_overrides:
            ov = self.manual_overrides[fi.path]
            fi.name_cn = ov.get("name", "")
            fi.responsibility_cn = ov.get("responsibility", "")
            fi.name_source = "manual"
            return

        # 2. 按语言调用提取器
        try:
            if fi.language == "python":
                from extractors.python_extractor import extract_python_annotation
                name, resp, source = extract_python_annotation(fi.absolute_path)
            elif fi.language in ("ts", "js"):
                from extractors.ts_extractor import extract_ts_annotation
                name, resp, source = extract_ts_annotation(fi.absolute_path)
            elif fi.language == "vue":
                from extractors.vue_extractor import extract_vue_annotation
                name, resp, source = extract_vue_annotation(fi.absolute_path)
            elif fi.language == "sql":
                from extractors.sql_extractor import extract_sql_annotation
                name, resp, source = extract_sql_annotation(fi.absolute_path)
            elif fi.language == "yaml":
                from extractors.yaml_extractor import extract_yaml_annotation
                name, resp, source = extract_yaml_annotation(fi.absolute_path)
            else:
                name, resp, source = "", "", "missing"
            fi.name_cn = name
            fi.responsibility_cn = resp
            fi.name_source = source
        except Exception as e:
            # 提取失败，标记为待补充
            fi.name_source = "missing"
            if fi.path not in self.snapshot.missing_annotations:
                self.snapshot.missing_annotations.append(fi.path)

    # ----- 实现状态检测 -----
    #
    # 标记分三层 (经全量 343 文件仿真校准, 区分"工程未完成声明"与
    # "面向用户/日志的运行时降级文案"):
    #   1. 全文强标记: ASCII 开发记号 + 中文工程术语 (未实现/桩实现...),
    #      在注释/字符串/文档串任何位置命中都算 —— 它们只用于表达"未开发"。
    #   2. 仅注释强标记: 自然语言词 (待接入/mock 数据/暂不可用)。它们出现在
    #      字符串/日志/UI 文案/YAML 配置值里多为运行时提示 (如 mock 兜底文案
    #      "AI 引擎暂不可用, 已降级返回 mock 结果"), 不算未完成; 只有出现在
    #      注释里才是工程声明。
    #   3. 弱标记: 降级措辞 + "占位符"。仅注释、且必须与强标记【组合】才生效
    #      (project_memory 降级设计原则: 单独"降级"不算未完成, 降级+Mock/
    #      占位/未实现组合才算 partial)。
    # 另: 桩载荷行 —— 非注释行中 "待接入" 与桩指示词 (桩/stub/兼容接口) 同行,
    #      如 {"note": "桩实现: 待接入监管账户流水分析"}, 属明确桩实现标记。
    _MARKERS_STRONG_FULL = [
        "TODO", "FIXME", "HACK",
        "NotImplementedError", "NOT_IMPLEMENTED", "not implemented",
        "coming soon", "coming-soon",
        "mock_data",
        "未实现", "待实现", "桩实现", "桩函数",
    ]
    _MARKERS_SKELETON_FULL = [
        "raise NotImplementedError", "# placeholder", "pass  # TODO",
    ]
    _MARKERS_STRONG_COMMENT = [
        "暂不可用", "待接入", "mock 数据", "Mock 数据", "mock数据",
    ]
    _MARKERS_SKELETON_COMMENT = ["骨架代码"]
    _MARKERS_WEAK_COMMENT = [
        "降级到 Mock", "降级为 Mock", "降级到 mock", "降级为 mock",
        "降级到 super", "降级到 Super",
        "mock 降级", "Mock 降级",
        "降级返回", "降级到内存",
        "占位符",
    ]
    _STUB_LINE_RE = re.compile(
        r"待接入.*(?:桩|stub|兼容接口)|(?:桩|stub|兼容接口).*待接入",
        re.IGNORECASE,
    )
    _HASH_EXT = (
        ".py", ".yaml", ".yml", ".sh", ".toml", ".rb",
        ".conf", ".ini", ".cfg", ".env", ".txt",
    )
    _SLASH_EXT = (
        ".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte", ".java",
        ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".css", ".scss",
        ".less", ".html",
    )
    _DASH_EXT = (".sql",)
    _HTML_EXT = (".vue", ".html", ".svelte")

    def _split_comment(self, path: str, line: str) -> tuple[str, str]:
        """把一行拆成 (代码部分, 注释部分)，注释记号按文件扩展名选择。"""
        p = path.lower()
        if p.endswith(self._HTML_EXT) and "<!--" in line:
            before, after = line.split("<!--", 1)
            return before, after
        if p.endswith(self._SLASH_EXT):
            tok = "//"
        elif p.endswith(self._DASH_EXT):
            tok = "--"
        elif p.endswith(self._HASH_EXT):
            tok = "#"
        else:
            # json/md/其他数据与文档格式: 无注释概念, 整行视为内容
            return line, ""
        idx = line.find(tok)
        if idx < 0:
            return line, ""
        return line[:idx], line[idx + len(tok):]

    def _detect_impl_status(self, fi: FileInfo):
        """检测文件的实现状态（done/partial/skeleton/placeholder）

        - done: 无工程未完成标记，有实际代码
        - partial: 含 TODO/FIXME/未实现/桩实现/桩载荷，或 强标记+降级组合
        - skeleton: 含 NotImplementedError/# placeholder/骨架代码 等骨架标记
        - placeholder: 有效代码 < 3 行
        """
        try:
            content = Path(fi.absolute_path).read_text(
                encoding="utf-8", errors="ignore"
            )
        except Exception:
            fi.impl_status = "done"
            return

        # 去除注释行后的有效代码行
        lines = content.splitlines()
        code_lines = [
            ln for ln in lines
            if ln.strip()
            and not ln.strip().startswith(("#", "//", "--", "/*", "*", "<!--"))
        ]

        # placeholder: 有效代码 < 3 行（__init__.py 包标记本就 1 行, 不算未动工）
        if len(code_lines) < 3 and not fi.path.endswith("__init__.py"):
            fi.impl_status = "placeholder"
            return

        # 拆分每行的代码部分与注释部分
        code_parts: list[str] = []
        comment_parts: list[str] = []
        for ln in lines:
            code_part, comment_part = self._split_comment(fi.absolute_path, ln)
            code_parts.append(code_part)
            comment_parts.append(comment_part)
        comment_text = "\n".join(comment_parts)

        strong: list[str] = []
        skeleton: list[str] = []
        weak: list[str] = []

        for marker in self._MARKERS_STRONG_FULL:
            if marker in content:
                strong.append(marker)
        for marker in self._MARKERS_SKELETON_FULL:
            if marker in content:
                skeleton.append(marker)
        for marker in self._MARKERS_STRONG_COMMENT:
            if marker in comment_text:
                strong.append(marker)
        for marker in self._MARKERS_SKELETON_COMMENT:
            if marker in comment_text:
                skeleton.append(marker)
        # 桩载荷行 (代码/字符串行): "桩实现: 待接入..." / "兼容接口: 待接入..."
        for code_part in code_parts:
            if self._STUB_LINE_RE.search(code_part):
                strong.append("桩实现:待接入")
                break
        for marker in self._MARKERS_WEAK_COMMENT:
            if marker in comment_text:
                weak.append(marker)

        markers_found = list(strong) + list(skeleton)
        if strong or skeleton:
            # 弱标记 (降级/占位符) 仅在与强标记组合时生效
            markers_found += weak

        fi.impl_markers = sorted(set(markers_found))

        if skeleton:
            fi.impl_status = "skeleton"
        elif markers_found:
            fi.impl_status = "partial"
        else:
            fi.impl_status = "done"

    # ----- import 依赖图（影响面分析基座）-----
    #
    # 两阶段: 扫描期 _extract_imports_raw 只抽原始模块描述符 (随指纹缓存),
    # 全量索引就绪后 _build_import_graph 统一解析为文件级 imports/imported_by。
    _PY_FROM_RE = re.compile(r"^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$", re.M)
    _PY_IMPORT_RE = re.compile(r"^\s*import\s+([\w.]+)", re.M)
    _TS_FROM_RE = re.compile(
        r"""(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]""")
    _TS_REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
    _TS_DYNAMIC_RE = re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)""")
    _PY_DEF_RE = re.compile(r"^\s*(?:async\s+)?def\s+(\w+)", re.M)
    _PY_CLASS_RE = re.compile(r"^\s*class\s+(\w+)", re.M)
    _TS_FN_RE = re.compile(
        r"""(?:export\s+)?(?:async\s+)?function\s+(\w+)"""
        r"""|(?:export\s+)?class\s+(\w+)"""
        r"""|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w]+)\s*=>""")

    def _extract_imports_and_symbols(self, fi: FileInfo):
        """一次读盘, 抽取 import 描述符与顶层符号名 (供影响面/搜索使用)。"""
        try:
            content = Path(fi.absolute_path).read_text(
                encoding="utf-8", errors="ignore")
        except OSError:
            fi.imports_raw, fi.symbols = [], []
            return
        # 源码预览: 前 30 行, 每行截断 160 字符 (面板"代码层面细节"用)
        preview_lines = []
        for ln in content.splitlines()[:30]:
            preview_lines.append(ln[:160])
        fi.source_preview = "\n".join(preview_lines)
        raws: list[str] = []
        syms: list[str] = []

        # --- 符号名 (类/函数, 支持按类名/函数名搜索) ---
        if fi.language == "python":
            syms.extend(self._PY_CLASS_RE.findall(content))
            syms.extend(self._PY_DEF_RE.findall(content))
        elif fi.language in ("ts", "js", "vue"):
            for m in self._TS_FN_RE.finditer(content):
                syms.extend(g for g in m.groups() if g)
        # 过滤私有/魔术方法噪声, 去重保序, 封顶 40
        seen: set[str] = set()
        fi.symbols = [s for s in syms
                      if not (s.startswith("__") or s in seen or seen.add(s))][:40]

        if fi.language == "python":
            for m in self._PY_FROM_RE.finditer(content):
                dots, mod, names = m.group(1) or "", m.group(2) or "", m.group(3)
                level = len(dots)
                if level:
                    # 相对导入: 记录基准层级 + 模块
                    raws.append(f"pyrel:{level}:{mod}")
                    # from .pkg import sub —— sub 也可能是子模块
                    for nm in re.split(r"[,\s()]+", names):
                        nm = nm.strip().split(" as ")[0].strip()
                        if nm and nm.isidentifier():
                            raws.append(f"pyrel:{max(level-1,0)}:{mod}.{nm}"
                                        if mod else f"pyrel:{max(level-1,0)}:{nm}")
                elif mod:
                    raws.append(f"py:{mod}")
                    # from app.services import eco_service → 子模块
                    for nm in re.split(r"[,\s()]+", names):
                        nm = nm.strip().split(" as ")[0].strip()
                        if nm and nm.isidentifier():
                            raws.append(f"py:{mod}.{nm}")
            for m in self._PY_IMPORT_RE.finditer(content):
                raws.append(f"py:{m.group(1)}")
        elif fi.language in ("ts", "js", "vue"):
            specs = set()
            for rx in (self._TS_FROM_RE, self._TS_REQUIRE_RE, self._TS_DYNAMIC_RE):
                specs.update(rx.findall(content))
            for s in specs:
                if s.startswith(("@/", "./", "../")):
                    raws.append(f"ts:{s}")
        fi.imports_raw = raws
        # 类/函数计数复用符号提取结果
        fi.class_count = sum(1 for s in fi.symbols
                             if s[:1].isupper()) if fi.language == "python" else 0
        fi.function_count = len(fi.symbols) - fi.class_count

        # --- 结构化细节: 类(含方法)/函数/第三方库/待办计数 ---
        fi.todo_count = len(re.findall(r"\b(?:TODO|FIXME|HACK|XXX)\b", content))
        if fi.language == "python":
            self._extract_py_structure(fi, content)
        roots: set[str] = set()
        if fi.language == "python":
            for raw in raws:
                kind, _, rest = raw.partition(":")
                if kind == "py" and rest:
                    roots.add(rest.split(".")[0])
            internal_roots = {"app", "backend", "frontend", "tools", "production"}
            stdlib = getattr(sys, "stdlib_module_names", frozenset())
            fi.imports_external = sorted(
                r for r in roots if r not in stdlib and r not in internal_roots)[:15]
        elif fi.language in ("ts", "js", "vue"):
            # ts imports_raw 只存内部路径, 外部包需单独抓全部 from/import spec
            specs = set()
            for rx in (self._TS_FROM_RE, self._TS_REQUIRE_RE, self._TS_DYNAMIC_RE):
                specs.update(rx.findall(content))
            for s in specs:
                if s.startswith(("@/", "./", "../")):
                    continue
                roots.add("/".join(s.split("/")[:2]) if s.startswith("@") else s.split("/")[0])
            fi.imports_external = sorted(roots - {"types", "vite"})[:15]

    def _extract_py_structure(self, fi: FileInfo, content: str):
        """Python AST: 顶层类(方法列表+docstring首行)/顶层函数(带doc)。"""
        import ast
        try:
            tree = ast.parse(content)
        except SyntaxError:
            return

        def doc1(node) -> str:
            d = ast.get_docstring(node)
            return d.split("\n")[0][:80] if d else ""

        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                methods = [n.name for n in node.body
                           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                           and not (n.name.startswith("__") and n.name != "__init__")]
                fi.classes.append({"n": node.name, "m": methods[:25], "d": doc1(node)})
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fi.functions.append({"n": node.name, "d": doc1(node)})
        fi.classes = fi.classes[:20]
        fi.functions = fi.functions[:30]

    def _build_import_graph(self):
        """把 imports_raw 解析为文件级依赖, 填充 imports / imported_by / 边。"""
        import posixpath
        files = self.snapshot.files
        by_path = {f.path: f for f in files}

        # --- Python 模块索引: backend/app/services/x.py → 'app.services.x' ---
        py_mod_map: dict[str, str] = {}
        for f in files:
            if f.language != "python" or not f.path.startswith("backend/"):
                continue
            rel = f.path[len("backend/"):]
            if rel.endswith("/__init__.py"):
                mod = rel[:-len("/__init__.py")].replace("/", ".")
            elif rel.endswith(".py"):
                mod = rel[:-3].replace("/", ".")
            else:
                continue
            py_mod_map.setdefault(mod, f.path)

        def resolve_py(mod: str, src: str) -> str | None:
            if mod in py_mod_map:
                return py_mod_map[mod]
            # 兜底: 后缀匹配 (app.services.x ← backend/app/services/x.py)
            tail = mod.replace(".", "/")
            for p in by_path:
                if p.startswith("backend/") and p.endswith("/" + tail + ".py"):
                    return p
            return None

        def resolve_pyrel(level: int, mod: str, src: str) -> str | None:
            # src 例: backend/app/services/pkg/x.py → 当前包 app.services.pkg
            if not src.startswith("backend/"):
                return None
            rel = src[len("backend/"):]
            parts = rel.split("/")
            parts = parts[:-1]  # 去文件名 → 所在目录
            if rel.endswith("__init__.py"):
                parts = parts[:-1]  # __init__.py 的包就是所在目录本身
            base = parts[:len(parts) - level] if level else parts
            target_mod = ".".join(base + ([mod] if mod else []))
            return resolve_py(target_mod, src)

        def resolve_ts(spec: str, src: str) -> str | None:
            if spec.startswith("@/"):
                base = "frontend/src/" + spec[2:]
            else:  # ./ ../
                base = posixpath.normpath(
                    posixpath.join(posixpath.dirname(src), spec))
            # 尝试扩展名与 index
            cands = [base, base + ".ts", base + ".vue", base + ".js",
                     base + ".tsx", base + ".jsx",
                     base + "/index.ts", base + "/index.vue",
                     base + "/index.js"]
            for c in cands:
                if c in by_path:
                    return c
            return None

        for f in files:
            resolved: set[str] = set()
            for raw in f.imports_raw:
                try:
                    kind, _, rest = raw.partition(":")
                    if kind == "py":
                        t = resolve_py(rest, f.path)
                    elif kind == "pyrel":
                        lvl_s, _, mod = rest.partition(":")
                        t = resolve_pyrel(int(lvl_s or "0"), mod, f.path)
                    elif kind == "ts":
                        t = resolve_ts(rest, f.path)
                    else:
                        t = None
                except (ValueError, IndexError):
                    t = None
                if t and t != f.path:
                    resolved.add(t)
            f.imports = sorted(resolved)

        # 反向索引
        for f in files:
            f.imported_by = []
        for f in files:
            for t in f.imports:
                target = by_path.get(t)
                if target is not None and f.path not in target.imported_by:
                    target.imported_by.append(f.path)
        for f in files:
            f.imported_by.sort()

        # 依赖边（供 markdown/面板复用）
        self.snapshot.dependency_edges = [
            {"source": f.path, "target": t, "edge_type": "import"}
            for f in files for t in f.imports
        ]

    # ----- 文档健康（文档对齐基座）-----

    def _analyze_doc_health(self):
        """文档对齐扫描: --full 真实归档, --incremental dry-run, --quick 复用缓存。"""
        if self.mode == "text":
            return
        if self.mode == "quick":
            # 快速模式: 复用上一次落盘的 doc_health (若有)
            prev = self.data_dir_path() / "summary.json"
            try:
                if prev.exists():
                    with open(prev, "r", encoding="utf-8") as fp:
                        old = json.load(fp)
                    if old.get("doc_health"):
                        self.snapshot.doc_health = old["doc_health"]
                        self.snapshot.doc_health["reused"] = True
                        return
            except (json.JSONDecodeError, OSError):
                pass
            return  # quick 无缓存则跳过, 不拖慢启动
        try:
            from analyzers.doc_health_analyzer import analyze_document_health
            self.snapshot.doc_health = analyze_document_health(
                self.root, archive=(self.mode == "full"))
        except Exception as e:
            print(f"[panorama] 文档健康分析失败：{e}")
            self.snapshot.doc_health = {"error": str(e)}

    @staticmethod
    def data_dir_path() -> Path:
        return SELF_DIR / "data"

    # ----- 主入口 -----

    def run(self) -> PanoramaSnapshot:
        """主流程"""
        start_ts = time.time()
        print(f"[panorama] mode={self.mode} root={self.root}")

        # 1. 扫描文件
        print("[panorama] 扫描文件...")
        self.snapshot.files = self.scan_files()
        self.snapshot.total_files = len(self.snapshot.files)
        self.snapshot.total_lines = sum(f.line_count for f in self.snapshot.files)
        print(f"[panorama] 扫描完成：{self.snapshot.total_files} 个文件，"
              f"{self.snapshot.total_lines} 行")

        # 1b. import 依赖图（影响面分析; 全模式, 解析走缓存的 raw 描述符）
        print("[panorama] 构建 import 依赖图...")
        self._build_import_graph()

        # 2. Git 摘要
        print("[panorama] 采集 Git 状态...")
        self._collect_git_summary()
        self._collect_file_git_logs()

        # 3. 跨语言契约边（除非 --quick 或 --text）
        if self.mode not in ("quick", "text"):
            print("[panorama] 捕获跨语言契约边...")
            self._capture_contract_edges()

        # 4. 状态监控（仅本地开发环境 + 非 --text/--quick）
        if self.mode not in ("quick", "text"):
            print("[panorama] 状态监控（仅本地）...")
            self._probe_state()

        # 5. trace_report 复用
        print("[panorama] 复用 trace_report.json...")
        self._adapt_trace_report()

        # 5b. 文档健康对齐（--full 真实归档, --incremental dry-run, --quick 复用）
        print("[panorama] 文档健康对齐...")
        self._analyze_doc_health()

        # 6. 计算 4 大指标
        print("[panorama] 计算 4 大指标区块...")
        self._compute_metrics()

        # 7. 渲染产出
        print("[panorama] 渲染产出...")
        self._render_outputs()

        elapsed = time.time() - start_ts
        print(f"[panorama] 完成，耗时 {elapsed:.2f}s")
        return self.snapshot

    # ----- Git 摘要 -----

    def _collect_git_summary(self):
        """采集 Git 摘要（在项目根 jinrong/ 执行 git 命令）"""
        import subprocess
        git_cwd = PROJECT_ROOT  # 用 jinrong/ 根，而非 production/
        try:
            # 分支名
            r = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                                cwd=git_cwd, capture_output=True, text=True, timeout=3)
            branch = r.stdout.strip() if r.returncode == 0 else "unknown"
            # 未提交
            r = subprocess.run(["git", "status", "--porcelain"],
                               cwd=git_cwd, capture_output=True, text=True, timeout=3)
            uncommitted_files = []
            if r.returncode == 0:
                for line in r.stdout.strip().splitlines():
                    if line.strip():
                        uncommitted_files.append({
                            "status": line[:2].strip(),
                            "file": line[3:].strip(),
                        })
            # 领先 origin
            ahead = 0
            try:
                r = subprocess.run(["git", "rev-list", "--count", "@{u}..HEAD"],
                                   cwd=git_cwd, capture_output=True, text=True, timeout=3)
                if r.returncode == 0:
                    ahead = int(r.stdout.strip() or "0")
            except (subprocess.SubprocessError, ValueError):
                pass
            # 最近 N 次提交
            r = subprocess.run(
                ["git", "log", "-5", "--pretty=format:%H|%cI|%an|%s"],
                cwd=git_cwd, capture_output=True, text=True, timeout=5)
            recent_commits = []
            if r.returncode == 0:
                for line in r.stdout.strip().splitlines():
                    parts = line.split("|", 3)
                    if len(parts) == 4:
                        recent_commits.append({
                            "hash": parts[0][:8],
                            "date": parts[1],
                            "author": parts[2],
                            "message": parts[3],
                        })
            self.snapshot.git_summary = {
                "branch": branch,
                "uncommitted_count": len(uncommitted_files),
                "uncommitted_files": uncommitted_files,
                "ahead_of_origin": ahead,
                "recent_commits": recent_commits,
            }
        except (subprocess.SubprocessError, FileNotFoundError, OSError) as e:
            self.snapshot.git_summary = {"error": str(e)}

    def _collect_file_git_logs(self):
        """单次 git log 批量采集每文件最近 3 条提交（详情面板"最近变更"）。

        一条命令拿全仓 400 条提交+涉及文件，构建 path→log 映射，
        避免逐文件起子进程（343 文件逐个 git log 会慢 10 倍以上）。
        """
        import subprocess
        try:
            r = subprocess.run(
                ["git", "log", "-n", "400", "--date=short",
                 "--pretty=format:%x01%ad%x01%s", "--name-only"],
                cwd=PROJECT_ROOT, capture_output=True, text=True,
                encoding="utf-8", errors="ignore", timeout=10)
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            return
        if r.returncode != 0:
            return
        logs: dict[str, list] = {}
        date = msg = None
        for line in r.stdout.splitlines():
            if line.startswith("\x01"):
                parts = line.split("\x01")
                if len(parts) >= 3:
                    _, date, msg = parts[0], parts[1], parts[2]
            elif line.strip() and date:
                rel = line.strip().replace("\\", "/")
                if rel.startswith("production/"):
                    rel = rel[len("production/"):]
                    bucket = logs.setdefault(rel, [])
                    if len(bucket) < 3:
                        bucket.append({"d": date, "m": msg[:60]})
        for f in self.snapshot.files:
            f.git_log = logs.get(f.path, [])

    # ----- 跨语言契约边（占位，Phase 2.1 实现）-----

    def _capture_contract_edges(self):
        """捕获跨语言契约边（Phase 2.1）"""
        try:
            from analyzers.contract_edge_analyzer import capture_contract_edges
            # capture_contract_edges 已返回 list of dict，无需 asdict
            edges = capture_contract_edges(self.root, self.snapshot.files)
            self.snapshot.contract_edges = edges
        except ImportError:
            # Phase 1：占位跳过
            self.snapshot.contract_edges = []
        except Exception as e:
            print(f"[panorama] 契约边捕获失败：{e}")
            import traceback
            traceback.print_exc()
            self.snapshot.contract_edges = []

    # ----- 状态监控（占位，Phase 3.3 实现）-----

    def _probe_state(self):
        """状态监控（仅本地开发环境，Phase 3.3）"""
        env = os.environ.get("PANORAMA_ENV", "dev")
        allowed = self.config.get("state", {}).get("enabled_in_env", "dev,local")
        if env not in allowed.split(","):
            # 生产环境：状态栏统一显示降级
            for fi in self.snapshot.files:
                fi.status = "no_state"
            return
        try:
            from state.process_probe import probe_processes
            from state.port_probe import probe_ports
            from state.log_parser import parse_recent_logs
            # 仅探测本地端口
            ports_cfg = self.config.get("state", {}).get("ports", {})
            port_status = probe_ports(ports_cfg)
            # 进程
            proc_status = probe_processes()
            # 日志
            log_dir = self.root / self.config.get("state", {}).get(
                "log_dir", "backend/logs").replace("production/", "")
            log_status = parse_recent_logs(self.root / "backend" / "logs")
            # 合并到 files（简化：仅端口级别）
            self.snapshot.risks.extend(log_status.get("risks", []))
        except ImportError:
            # Phase 1：占位跳过
            pass
        except Exception as e:
            print(f"[panorama] 状态探测失败：{e}")

    # ----- trace_report 复用（占位，Phase 3.2 实现）-----

    def _adapt_trace_report(self):
        """复用 trace_report.json（Phase 3.2）"""
        trace_path = SELF_DIR.parent / "trace_report.json"
        silent = self.config.get("trace_report", {}).get("silent_skip_on_missing", True)
        if not trace_path.exists():
            if silent:
                return
        try:
            from adapters.trace_report_adapter import adapt_trace_report
            self.snapshot.spec_alignment = adapt_trace_report(trace_path, self.snapshot.files)
        except ImportError:
            # Phase 1：占位跳过
            pass
        except Exception as e:
            if not silent:
                print(f"[panorama] trace_report 复用失败：{e}")

    # ----- 4 大指标计算 -----

    def _compute_metrics(self):
        """计算 4 大指标区块（完成度多源交叉: MATRIX 规划口径 × 代码实测口径）"""
        top_modules = self.project_cfg.get("top_level_modules", [])
        self.snapshot.total_modules = len(top_modules)

        # === 口径 A: COMPLETION_MATRIX.md 规划任务口径 ===
        breakdown = {}
        matrix_path = self.root / "docs" / "COMPLETION_MATRIX.md"
        if matrix_path.exists():
            breakdown = self._parse_completion_matrix(matrix_path)
            self.snapshot.completed_modules = [
                m["name"] for m in breakdown.get("tasks", [])
                if m["status"] == "done"
            ]
        else:
            # 降级：目录存在+有文件 = 已完成（旧逻辑）
            completed = []
            for mod in top_modules:
                mod_dir = self.root / mod
                if mod_dir.exists() and any(mod_dir.rglob("*")):
                    completed.append(mod)
            self.snapshot.completed_modules = completed
            breakdown = {"weighted": round(100.0 * len(completed) /
                                          max(1, len(top_modules)), 1),
                         "tasks": [], "total": 0}

        # === 口径 B: 代码实测口径（逐文件 impl_status 加权, 代码即事实）===
        code_stats = {"done": 0, "partial": 0, "skeleton": 0, "placeholder": 0}
        for f in self.snapshot.files:
            if f.impl_status in code_stats:
                code_stats[f.impl_status] += 1
        code_total = sum(code_stats.values())
        code_weighted = round(
            (code_stats["done"] * 100 + code_stats["partial"] * 60 +
             code_stats["skeleton"] * 20 + code_stats["placeholder"] * 0)
            / max(1, code_total), 1)
        code_stats["total"] = code_total
        code_stats["weighted"] = code_weighted
        code_stats["done_ratio"] = round(
            100.0 * code_stats["done"] / max(1, code_total), 1)

        # === 分层完成度（防止"大量前端已完成文件稀释核心服务桩实现"）===
        def _layer_stat(pred):
            c = {"done": 0, "partial": 0, "skeleton": 0, "placeholder": 0}
            for f in self.snapshot.files:
                if pred(f) and f.impl_status in c:
                    c[f.impl_status] += 1
            tot = sum(c.values())
            c["total"] = tot
            c["weighted"] = round(
                (c["done"] * 100 + c["partial"] * 60 + c["skeleton"] * 20)
                / max(1, tot), 1)
            return c

        core_svc = _layer_stat(
            lambda f: f.language == "python"
            and f.path.startswith("backend/app/services/")
            and f.path.endswith(".py"))
        frontend_all = _layer_stat(lambda f: f.path.startswith("frontend/"))
        backend_all = _layer_stat(
            lambda f: f.path.startswith("backend/") and f.language == "python")
        code_stats["layers"] = {
            "core_services": core_svc,      # 后端核心服务（护城河）
            "backend": backend_all,
            "frontend": frontend_all,
        }
        # 核心服务层的桩/mock 清单（未完成硬证据, 按文件粒度点名）
        core_stubs = [
            {"path": f.path, "status": f.impl_status,
             "markers": f.impl_markers[:4]}
            for f in self.snapshot.files
            if f.language == "python"
            and f.path.startswith("backend/app/services/")
            and f.path.endswith(".py")
            and f.impl_status in ("partial", "skeleton", "placeholder")
        ]
        code_stats["core_stubs"] = core_stubs

        # === 交叉校准 ===
        dh = self.snapshot.doc_health or {}
        matrix_health = next(
            (d for d in dh.get("all_docs", [])
             if d.get("name") == "COMPLETION_MATRIX.md"), {})
        matrix_stale = matrix_health.get("health") == "stale"
        matrix_broken = matrix_health.get("broken_count", 0)

        notes: list[str] = []
        if matrix_stale:
            notes.append(
                f"⚠️ COMPLETION_MATRIX.md 已过期（{matrix_broken} 处代码引用失效，"
                f"最后更新 {matrix_health.get('mtime', '?')}），"
                f"其规划口径 {breakdown.get('weighted', 0)}% 不可直接采信")
        gap = round(breakdown.get("weighted", 0) - code_weighted, 1)
        if abs(gap) >= 5:
            notes.append(
                f"📊 规划口径 {breakdown.get('weighted', 0)}% 与代码实测 {code_weighted}% "
                f"相差 {abs(gap)} 个百分点（{'规划高估' if gap > 0 else '规划保守'}），"
                f"面板以代码实测为准")
        notes.append(
            f"🔎 代码实测（全文件口径）：{code_stats['done']} 完成 / "
            f"{code_stats['partial']} 部分 / {code_stats['skeleton']} 骨架 / "
            f"{code_stats['placeholder']} 占位（共 {code_total} 个代码文件）")
        cs = core_svc
        if cs["total"]:
            notes.append(
                f"🧩 分层：前端 {frontend_all['weighted']}% / 后端整体 "
                f"{backend_all['weighted']}% / 🎯核心服务层 {cs['weighted']}%"
                f"（{cs['done']}✅ {cs['partial']}🟡 {cs['skeleton']}📋，共 {cs['total']} 个服务）")
        stub_names = [Path(s["path"]).stem.replace("_service", "")
                      for s in core_stubs]
        if stub_names:
            notes.append(
                f"🔌 核心服务层 {len(stub_names)} 个服务为桩/mock 兜底、待 A 档真实接入："
                + "、".join(stub_names[:12])
                + ("…" if len(stub_names) > 12 else ""))
        if code_stats["skeleton"] + code_stats["placeholder"] > 0:
            notes.append(
                f"🔧 另有 {code_stats['skeleton'] + code_stats['placeholder']} 个"
                f"骨架/占位文件属未动工硬证据，详见文件树 📋🔜 标记")

        breakdown["code_actual"] = code_stats
        breakdown["matrix_stale"] = matrix_stale
        breakdown["cross_check_notes"] = notes
        breakdown["calibrated_weighted"] = code_weighted
        breakdown["calibrated_source"] = "code"
        self.snapshot.completion_breakdown = breakdown
        # 头部完成度 = 代码实测口径（代码即事实; MATRIX 仅作规划对照）
        self.snapshot.completion_rate = code_weighted / 100.0

        # 健康统计
        self.snapshot.healthy_modules = sum(
            1 for f in self.snapshot.files if f.status == "healthy"
        )
        self.snapshot.fault_modules = sum(
            1 for f in self.snapshot.files if f.status == "fault"
        )
        self.snapshot.running_modules = sum(
            1 for f in self.snapshot.files if f.status in ("healthy", "degraded")
        )

        # 风险从孤儿契约补充
        for edge in self.snapshot.contract_edges:
            if edge.get("is_orphan"):
                self.snapshot.risks.append({
                    "type": "orphan_contract",
                    "detail": f"前端 {edge['frontend_file']} 调用 {edge['path']} "
                              f"但后端未注册",
                    "severity": "warning",
                })

    def _parse_completion_matrix(self, matrix_path) -> dict:
        """解析 COMPLETION_MATRIX.md，返回真实完成度分解

        状态标记: ✅=done, 🟡=partial, 📋=doc, 🔜=roadmap
        加权: done=100%, partial=60%, doc=20%, roadmap=0%
        """
        import re as _re
        try:
            content = matrix_path.read_text(encoding="utf-8")
        except Exception:
            return {"weighted": 0.0, "tasks": []}

        tasks = []
        # 匹配表格行: | 编号 | 名称 | sim | prod | 状态 |
        # 编号支持: 数字(1), 带字母(3b, 19b), Phase编号(B1, SC1, R1, UX-01)
        for line in content.splitlines():
            m = _re.match(
                r"\|\s*([\w\-]+)\s*\|\s*(.+?)\s*\|.*\|\s*(✅|🟡|📋|🔜)\s*\|?\s*$",
                line
            )
            if m:
                task_id, name, status_icon = m.group(1), m.group(2).strip(), m.group(3)
                status_map = {"✅": "done", "🟡": "partial", "📋": "doc", "🔜": "roadmap"}
                tasks.append({
                    "id": task_id,
                    "name": name,
                    "status": status_map.get(status_icon, "unknown"),
                    "icon": status_icon,
                })

        counts = {"done": 0, "partial": 0, "doc": 0, "roadmap": 0}
        for t in tasks:
            if t["status"] in counts:
                counts[t["status"]] += 1

        total = len(tasks)
        weighted = 0.0
        if total > 0:
            weighted = round(
                (counts["done"] * 100 + counts["partial"] * 60 +
                 counts["doc"] * 20 + counts["roadmap"] * 0) / total, 1
            )

        return {
            "weighted": weighted,
            "total": total,
            "done": counts["done"],
            "partial": counts["partial"],
            "doc": counts["doc"],
            "roadmap": counts["roadmap"],
            "tasks": tasks,
        }

    # ----- 渲染产出 -----

    def _render_outputs(self):
        """渲染双产出"""
        data_dir = SELF_DIR / "data"
        data_dir.mkdir(exist_ok=True)

        # 1. summary.json（机器可读底座）
        orphan_edges = [e for e in self.snapshot.contract_edges
                        if e.get("is_orphan")]
        summary = {
            "generated_at": self.snapshot.generated_at,
            "mode": self.snapshot.mode,
            "total_files": self.snapshot.total_files,
            "total_modules": self.snapshot.total_modules,
            "total_lines": self.snapshot.total_lines,
            "completion_rate": self.snapshot.completion_rate,
            "completed_modules": self.snapshot.completed_modules,
            "in_progress_modules": self.snapshot.in_progress_modules,
            "not_started_modules": self.snapshot.not_started_modules,
            "blocked_modules": self.snapshot.blocked_modules,
            "healthy_modules": self.snapshot.healthy_modules,
            "fault_modules": self.snapshot.fault_modules,
            "running_modules": self.snapshot.running_modules,
            "git_summary": self.snapshot.git_summary,
            "risks": self.snapshot.risks,
            "missing_annotations": self.snapshot.missing_annotations,
            "contract_edges_count": len(self.snapshot.contract_edges),
            "orphan_count": len(orphan_edges),
            "contract_edges": self.snapshot.contract_edges,
            "dependency_edges_count": len(self.snapshot.dependency_edges),
            "completion_breakdown": self.snapshot.completion_breakdown,
            "doc_health": self.snapshot.doc_health,
        }
        with open(data_dir / "summary.json", "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[panorama] 写入 {data_dir/'summary.json'}")

        # 2. panorama_data.json（完整数据底座）
        full_data = asdict(self.snapshot)
        with open(data_dir / "panorama_data.json", "w", encoding="utf-8") as f:
            json.dump(full_data, f, ensure_ascii=False, indent=2,
                      default=str)
        print(f"[panorama] 写入 {data_dir/'panorama_data.json'}")

        # 3. AGENT_CONTEXT.md（机器可读摘要）
        try:
            from renderers.markdown_renderer import render_agent_context
            content = render_agent_context(self.snapshot, self.config)
            # 大小检查
            size_kb = len(content.encode("utf-8")) / 1024
            hard_limit = self.config.get("agent_context", {}).get(
                "hard_limit_kb", 100)
            if size_kb > hard_limit:
                print(f"[panorama] ⚠️ AGENT_CONTEXT.md {size_kb:.1f}KB 超过硬上限 "
                      f"{hard_limit}KB，启用截断")
                content = self._truncate_agent_context(content, hard_limit)
            with open(data_dir / "AGENT_CONTEXT.md", "w", encoding="utf-8") as f:
                f.write(content)
            print(f"[panorama] 写入 {data_dir/'AGENT_CONTEXT.md'} "
                  f"({size_kb:.1f}KB)")
        except ImportError:
            print("[panorama] Phase 1 跳过 AGENT_CONTEXT.md（Phase 2.2 实现）")
        except Exception as e:
            print(f"[panorama] AGENT_CONTEXT.md 渲染失败：{e}")

        # 4. panorama_dashboard.html（除非 --text）
        skip_html = self.config.get("modes", {}).get(self.mode, {}).get(
            "skip_html", False)
        if not skip_html:
            try:
                from renderers.html_renderer import render_dashboard_html
                html = render_dashboard_html(self.snapshot, self.config)
                out_path = SELF_DIR / "panorama_dashboard.html"
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(html)
                print(f"[panorama] 写入 {out_path}")
            except ImportError:
                print("[panorama] Phase 1 跳过 panorama_dashboard.html"
                      "（Phase 2.3 实现）")
            except Exception as e:
                print(f"[panorama] HTML 渲染失败：{e}")

    def _truncate_agent_context(self, content: str, limit_kb: int) -> str:
        """AGENT_CONTEXT.md 超限时截断（仅保留最近变更+当前活跃模块）"""
        # 简化：按行截断
        lines = content.splitlines(keepends=True)
        max_bytes = limit_kb * 1024 * 0.9  # 留 10% 余量
        result = []
        cur_size = 0
        for line in lines:
            line_size = len(line.encode("utf-8"))
            if cur_size + line_size > max_bytes:
                result.append("\n--- 截断：达到硬上限 ---\n")
                break
            result.append(line)
            cur_size += line_size
        return "".join(result)


# ============================================================================
# CLI 入口
# ============================================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="FinTrust Hub 全景导航 - 主采集脚本"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--quick", action="store_true",
                       help="Agent 启动前快速刷新（< 3s）")
    group.add_argument("--incremental", action="store_true",
                       help="日常开发增量（< 10s）")
    group.add_argument("--full", action="store_true",
                       help="全量扫描")
    group.add_argument("--text", action="store_true",
                       help="仅生成 AGENT_CONTEXT.md，不跑 AST")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.quick:
        mode = "quick"
    elif args.incremental:
        mode = "incremental"
    elif args.full:
        mode = "full"
    else:
        mode = "text"

    config = load_config()
    collector = PanoramaCollector(mode=mode, config=config)
    snapshot = collector.run()

    # 控制台摘要
    print("\n========== 全景快照摘要 ==========")
    print(f"模式: {snapshot.mode}")
    print(f"生成时间: {snapshot.generated_at}")
    print(f"总文件数: {snapshot.total_files}")
    print(f"总模块数: {snapshot.total_modules}")
    print(f"总代码行: {snapshot.total_lines}")
    print(f"完成度: {snapshot.completion_rate*100:.1f}%")
    print(f"已实现模块: {snapshot.completed_modules}")
    print(f"健康模块: {snapshot.healthy_modules}")
    print(f"故障模块: {snapshot.fault_modules}")
    print(f"Git 分支: {snapshot.git_summary.get('branch','unknown')}")
    print(f"孤儿契约边: {sum(1 for e in snapshot.contract_edges if e.get('is_orphan'))}")
    print(f"待补充注释文件: {len(snapshot.missing_annotations)}")
    print(f"风险数: {len(snapshot.risks)}")
    print("===================================")


if __name__ == "__main__":
    main()
