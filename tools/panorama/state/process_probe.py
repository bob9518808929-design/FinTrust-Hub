# 文件名：process_probe.py
# 职责：探测本地进程存活状态（uvicorn/vite/docker compose 等）
# 设计哲学：白盒可解释 + 强制隔离（仅本地）

"""进程探测器

仅探测本地开发环境的进程：
  - uvicorn (FastAPI 后端)
  - vite (前端 dev server)
  - docker compose ps (容器状态)

绝不读取 production 进程信息。
"""

from __future__ import annotations

import subprocess


def probe_processes() -> dict:
    """探测关键进程存活状态

    Returns:
        {
            "uvicorn": {"alive": True, "pid": 12345, "cmd": "..."},
            "vite": {"alive": False, "error": "..."},
            ...
        }
    """
    return {
        "uvicorn": _probe_by_name("uvicorn"),
        "vite": _probe_by_name("vite") or _probe_by_name("esbuild"),
        "node": _probe_by_name("node"),
    }


def _probe_by_name(proc_name: str) -> dict:
    """通过 psutil 探测进程（缺失则降级为 ps 命令）"""
    # 优先 psutil
    try:
        import psutil
        for p in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                name = (p.info.get("name") or "").lower()
                cmdline = " ".join(p.info.get("cmdline") or [])
                if proc_name.lower() in name or proc_name.lower() in cmdline.lower():
                    return {
                        "alive": True,
                        "pid": p.info.get("pid"),
                        "cmd": cmdline[:200],
                    }
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return {"alive": False, "error": "未找到进程"}
    except ImportError:
        # 降级：用 tasklist（Windows）/ps（Unix）
        return _probe_by_shell(proc_name)


def _probe_by_shell(proc_name: str) -> dict:
    """降级方案：通过 shell 命令探测"""
    try:
        if subprocess.run(["which", "tasklist"],
                          capture_output=True).returncode == 0:
            # Windows
            r = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {proc_name}*"],
                               capture_output=True, text=True, timeout=3)
            alive = proc_name.lower() in r.stdout.lower()
        else:
            # Unix
            r = subprocess.run(["pgrep", "-f", proc_name],
                               capture_output=True, text=True, timeout=3)
            alive = bool(r.stdout.strip())
        return {"alive": alive, "source": "shell"}
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return {"alive": False, "error": "无法探测"}


if __name__ == "__main__":
    res = probe_processes()
    for name, info in res.items():
        status = "✅ 运行中" if info.get("alive") else "❌ 未运行"
        print(f"{name}: {status} {info}")
