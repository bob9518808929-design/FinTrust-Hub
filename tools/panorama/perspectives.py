# 文件名：perspectives.py
# 职责：三视角预设实现（上帝/总架构师/开发者）
# 设计哲学：定死三套预设，不给自定义，避免功能膨胀

"""视角过滤器

三套预设：
  - god（上帝视角）：全部目录+全部文件+跨语言契约边+健康状态
  - architect（总架构师）：顶层 8 个目录+二级模块级+循环依赖检测
  - developer（开发者）：仅当前 git user 最近 3 个月提交过的文件+直接依赖

视角切换 = 过滤器 + 隐藏字段，不改数据本身
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class PerspectiveResult:
    """视角过滤结果"""
    perspective: str
    visible_files: list  # 可见文件路径列表
    visible_modules: list  # 可见模块（二级目录）
    hidden_count: int  # 隐藏的文件数
    extra: dict = None  # 额外信息（如开发者 git user）


def apply_perspective(snapshot, perspective: str, config: dict,
                      project_root: Path = None) -> PerspectiveResult:
    """对快照应用视角过滤

    Args:
        snapshot: PanoramaSnapshot
        perspective: god/architect/developer
        config: 配置 dict
        project_root: 项目根目录（开发者视角需要 git 命令）

    Returns:
        PerspectiveResult
    """
    perspectives_cfg = config.get("perspectives", {})
    if perspective not in perspectives_cfg:
        # 默认 god
        perspective = "god"

    if perspective == "god":
        return _apply_god(snapshot, perspectives_cfg.get("god", {}))
    elif perspective == "architect":
        return _apply_architect(snapshot, perspectives_cfg.get("architect", {}))
    elif perspective == "developer":
        return _apply_developer(snapshot, perspectives_cfg.get("developer", {}),
                                 project_root or Path("."))
    else:
        return _apply_god(snapshot, {})


# ============================================================================
# 上帝视角：全部可见
# ============================================================================

def _apply_god(snapshot, cfg) -> PerspectiveResult:
    return PerspectiveResult(
        perspective="god",
        visible_files=[fi.path for fi in snapshot.files],
        visible_modules=_get_modules_level(snapshot.files, level=99),
        hidden_count=0,
        extra={"note": "上帝视角：全部可见"}
    )


# ============================================================================
# 总架构师视角：顶层 8 个目录 + 二级模块级，不展开到文件
# ============================================================================

def _apply_architect(snapshot, cfg) -> PerspectiveResult:
    # 二级模块（一级目录/二级目录）
    modules = _get_modules_level(snapshot.files, level=2)
    # 隐藏具体文件
    return PerspectiveResult(
        perspective="architect",
        visible_files=[],  # 不展开到文件
        visible_modules=modules,
        hidden_count=len(snapshot.files),
        extra={
            "note": "总架构师视角：仅看模块级+循环依赖",
            "modules_count": len(modules),
            "show_cycle_detection": cfg.get("show_cycle_detection", True),
        }
    )


# ============================================================================
# 开发者视角：仅当前 git user 最近 N 个月提交过的文件 + 直接依赖
# ============================================================================

def _apply_developer(snapshot, cfg, project_root: Path) -> PerspectiveResult:
    months = cfg.get("git_user_months", 3)
    git_user = _get_git_user(project_root)
    if not git_user:
        # 降级为 god
        return _apply_god(snapshot, {})

    # 取该用户最近 N 个月提交过的文件
    my_files = _get_user_committed_files(project_root, git_user, months)
    if not my_files:
        return PerspectiveResult(
            perspective="developer",
            visible_files=[],
            visible_modules=[],
            hidden_count=len(snapshot.files),
            extra={"note": f"未找到 {git_user} 最近 {months} 个月的提交",
                   "git_user": git_user}
        )

    # 加入直接依赖（同语言 import）
    direct_deps = set()
    file_path_set = set(my_files)
    for fi in snapshot.files:
        if fi.path in file_path_set:
            for imp in (fi.imports or []):
                # 简化：只加同目录的依赖
                direct_deps.add(imp)

    visible = list(set(my_files) | direct_deps)
    return PerspectiveResult(
        perspective="developer",
        visible_files=visible,
        visible_modules=_get_modules_level(
            [fi for fi in snapshot.files if fi.path in visible], level=2),
        hidden_count=len(snapshot.files) - len(visible),
        extra={
            "note": "开发者视角：仅我的代码+直接依赖",
            "git_user": git_user,
            "my_files_count": len(my_files),
            "direct_deps_count": len(direct_deps),
        }
    )


# ============================================================================
# 工具函数
# ============================================================================

def _get_modules_level(files, level: int) -> list:
    """提取 N 级模块路径"""
    modules = set()
    for fi in files:
        parts = fi.path.replace("\\", "/").split("/")
        if len(parts) >= level:
            modules.add("/".join(parts[:level]))
        else:
            modules.add("/".join(parts))
    return sorted(modules)


def _get_git_user(project_root: Path) -> str:
    """获取当前 git 用户名"""
    try:
        r = subprocess.run(
            ["git", "config", "user.name"],
            cwd=project_root, capture_output=True, text=True, timeout=3
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except (subprocess.SubprocessError, FileNotFoundError):
        return ""


def _get_user_committed_files(project_root: Path, user: str,
                                months: int) -> list:
    """获取某用户最近 N 个月提交过的文件"""
    try:
        # git log --author=USER --since=N months ago --name-only
        r = subprocess.run(
            ["git", "log",
             f"--author={user}",
             f"--since={months} months ago",
             "--name-only", "--pretty=format:"],
            cwd=project_root, capture_output=True, text=True, timeout=10
        )
        if r.returncode != 0:
            return []
        files = []
        for line in r.stdout.splitlines():
            line = line.strip()
            if line and line not in files:
                files.append(line)
        return files
    except (subprocess.SubprocessError, FileNotFoundError):
        return []


# ============================================================================
# 自检
# ============================================================================

if __name__ == "__main__":
    # 简单自检：在当前目录应用开发者视角
    class FakeSnap:
        files = []
    res = apply_perspective(FakeSnap(), "developer", {}, Path("."))
    print(f"视角：{res.perspective}")
    print(f"git user：{res.extra.get('git_user', '')}")
    print(f"可见文件数：{len(res.visible_files)}")
