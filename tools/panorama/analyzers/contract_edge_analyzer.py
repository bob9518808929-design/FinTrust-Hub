# 文件名：contract_edge_analyzer.py
# 职责：捕获跨语言契约边（frontend api/*.ts → backend api/v1/*.py）
# 算法：扫描 axios URL + @router 装饰器，路径归一化后匹配，孤儿标记
# 关联 spec：MOD-01（API v1 契约）

"""跨语言契约边分析器

输入：
  - project_root: Path (production/)
  - files: List[FileInfo]（已扫描的文件列表）
输出：
  - List[ContractEdge]

边类型：契约调用边（虚线蓝）
孤儿契约（前端调了但后端没注册）标记 is_orphan=True

设计哲学：
  - 白盒可解释：每条边带源文件路径+行号
  - 配置优于训练：正则模式可调整
  - 渐进调节：AST 可选，正则兜底
"""

from __future__ import annotations

import re
from pathlib import Path
from dataclasses import dataclass


@dataclass
class ContractEdge:
    """跨语言契约边"""
    frontend_file: str
    backend_file: str
    http_method: str
    path: str
    is_orphan: bool = False
    frontend_line: int = 0  # axios 调用行号
    backend_line: int = 0  # @router 装饰器行号


# ============================================================================
# 正则模式
# ============================================================================

# 前端 HTTP 调用模式
# 兼容三种写法：
#   1) axios.get('/url') / client.get('/url')          # 传统 axios 风格
#   2) get('/url') / post('/url', payload)              # 解构导入风格（本项目主流）
#   3) get<T>('/url') / post<T>('/url', payload)        # 泛型调用
#   4) get(`/bank/${id}/decisions`)                     # 模板字符串
FRONTEND_CALL_PATTERN = re.compile(
    r"""
    \b                                          # 词边界
    (?:axios|client|http|api|request|instance)? # 可选调用方
    \.?
    (get|post|put|delete|patch|head|options)   # HTTP 方法
    \s*                                         # 空白
    (?:<[^>]*>)?                                # 可选泛型 <T>
    \s*
    \(\s*                                       # (
    [`'"]                                       # 引号开始
    ([^`'"]+)                                   # URL 字面量（捕获组 2）
    [`'"]                                        # 引号结束
    """,
    re.IGNORECASE | re.VERBOSE
)

# 后端 @router.get("/path") 装饰器模式
# 兼容：
#   1) @router.get("/path")                            # 通用
#   2) @bank_router.get("/path")                       # 项目主流（XXX_router 命名）
#   3) @app.get("/path")                               # FastAPI app 直挂
#   4) @api_router.get("/path")                        # alias
# 注意：装饰器内 path 是相对路径，真实路径 = APIRouter(prefix) + path
BACKEND_ROUTER_PATTERN = re.compile(
    r"""
    @
    (\w+)                                       # 装饰器变量名（捕获组 1，如 router/bank_router/app）
    \s*\.\s*
    (get|post|put|delete|patch|head|options)    # HTTP 方法
    \s*\(\s*                                    # (
    [`'"]                                       # 引号
    ([^`'"]*)                                    # 路径（允许空串，如 @router.get("")）
    [`'"]                                        # 引号
    """,
    re.IGNORECASE | re.VERBOSE
)

# APIRouter(prefix="/xxx") 声明模式
# 用于建立 var_name → prefix 映射，组合出真实路由路径
# 兼容：
#   1) router = APIRouter(prefix="/enterprises", tags=["企业"])
#   2) bank_router = APIRouter(prefix="/bank", ...)
#   3) router = APIRouter()  # 无 prefix，默认 ""
#   4) router = APIRouter(prefix="/x", response_model=..., tags=[...])
APIROUTER_DECL_PATTERN = re.compile(
    r"""
    ^
    (\w+)                                       # 变量名（捕获组 1，如 router/bank_router）
    \s*=\s*
    APIRouter
    \s*\(
    (?:.*?,)*?                                  # 可选其他参数（逗号分隔，非贪婪）
    prefix
    \s*=\s*
    [`'"]                                       # 引号
    ([^`'"]+)                                    # prefix 值（捕获组 2）
    [`'"]
    """,
    re.IGNORECASE | re.VERBOSE | re.MULTILINE
)

# 用于回退兼容（旧引用）
AXIOS_PATTERN = FRONTEND_CALL_PATTERN
ROUTER_PATTERN = BACKEND_ROUTER_PATTERN

# 字符串拼接片段模式：+ var 或 + 'string' 或 + "string"
# 用于合并 '/base/' + var + '/path' → /base/{var}/path
CONCAT_PATTERN = re.compile(
    r"""\s*\+\s*
    (?:
        (\w+)                    # 变量名（捕获组 1）
        |
        ['"]([^'"]*)['"]        # 单/双引号字符串（捕获组 2）
        |
        `([^`]*)`                # 模板字符串（捕获组 3）
    )
    """,
    re.VERBOSE
)


# ============================================================================
# 主函数
# ============================================================================

def capture_contract_edges(project_root: Path, files: list) -> list:
    """捕获跨语言契约边

    Args:
        project_root: production/ 根目录
        files: List[FileInfo]（用于定位前端 api 和后端 routes）

    Returns:
        List[dict]（每条边序列化为 dict）
    """
    # 1. 收集前端的 axios 调用
    frontend_calls = _collect_frontend_calls(files)
    # 2. 收集后端的 @router 裯由
    backend_routes = _collect_backend_routes(files)
    # 3. 路径归一化并匹配
    edges = _match_calls_to_routes(frontend_calls, backend_routes)
    return [e for e in edges]


# ============================================================================
# 前端 axios 调用收集
# ============================================================================

def _collect_frontend_calls(files: list) -> list:
    """收集所有 frontend/src/api/*.ts 中的 HTTP 调用"""
    calls = []
    for fi in files:
        # 仅扫描 frontend/src/api/ 下的 .ts/.js 文件
        norm_path = fi.path.replace("\\", "/")
        if "frontend/src/api/" not in norm_path:
            continue
        if fi.language not in ("ts", "js"):
            continue
        try:
            content = Path(fi.absolute_path).read_text(encoding="utf-8")
        except (FileNotFoundError, UnicodeDecodeError, PermissionError):
            continue
        for line_no, line in enumerate(content.splitlines(), 1):
            for m in FRONTEND_CALL_PATTERN.finditer(line):
                method = m.group(1).lower()
                url = m.group(2).strip()
                # 检查字符串拼接：'/base/' + var + '/path'
                # 从第一个引号对结束位置开始，向后匹配 + var / + 'string'
                pos = m.end()
                while True:
                    cm = CONCAT_PATTERN.match(line, pos)
                    if not cm:
                        break
                    if cm.group(1):  # 变量名
                        url += "{" + cm.group(1) + "}"
                    elif cm.group(2) is not None:  # 单/双引号字符串
                        url += cm.group(2)
                    elif cm.group(3) is not None:  # 模板字符串
                        url += cm.group(3)
                    pos = cm.end()
                if not url or url.startswith("/") is False and not url.startswith("http"):
                    # 跳过相对路径或外部 URL
                    if not url.startswith("/"):
                        continue
                calls.append({
                    "frontend_file": fi.path,
                    "frontend_line": line_no,
                    "http_method": method,
                    "raw_url": url,
                })
    return calls


# ============================================================================
# 后端 @router 路由收集
# ============================================================================

def _collect_backend_routes(files: list) -> list:
    """收集所有 backend/app/api/ 下的 @xxx_router 装饰器

    关键修复：
      1. 解析 APIRouter(prefix="/xxx") 声明，组合 prefix + decorator_path
         得到真实路由路径，避免不同 router 的同 path 碰撞 + 占位符误匹配。
      2. 全文扫描（非逐行），支持多行装饰器写法：
         @bank_router.get(
             "/{bank_id}/trust-profile",
             response_model=...,
         )
    """
    routes = []
    for fi in files:
        # 扫描 backend/app/api/ 下的 .py 文件
        norm_path = fi.path.replace("\\", "/")
        if "backend/app/api/" not in norm_path:
            continue
        if fi.language != "python":
            continue
        try:
            content = Path(fi.absolute_path).read_text(encoding="utf-8")
        except (FileNotFoundError, UnicodeDecodeError, PermissionError):
            continue

        # 1. 先解析本文件内所有 APIRouter(prefix="/xxx") 声明
        #    建立 var_name → prefix 映射（per-file scope，避免跨文件污染）
        prefix_map: dict[str, str] = {}
        for m in APIROUTER_DECL_PATTERN.finditer(content):
            var_name = m.group(1)
            prefix_val = m.group(2)
            prefix_map[var_name] = prefix_val

        # 2. 全文扫描 @xxx_router.get("/path") 装饰器（支持多行）
        for m in BACKEND_ROUTER_PATTERN.finditer(content):
            decorator_var = m.group(1)  # 如 router/bank_router/app
            # 仅接受 *_router 或 router 或 app 的变量名
            if not (decorator_var.endswith("_router")
                     or decorator_var in ("router", "app", "api_router",
                                            "main_router")):
                continue
            method = m.group(2).lower()
            decorator_path = m.group(3).strip()
            # 组合 prefix + decorator_path 得到真实路径
            prefix = prefix_map.get(decorator_var, "")
            full_path = prefix + decorator_path
            # 从 match 位置反推行号
            line_no = content.count("\n", 0, m.start()) + 1
            routes.append({
                "backend_file": fi.path,
                "backend_line": line_no,
                "http_method": method,
                "raw_path": full_path,  # 用全路径参与匹配
                "decorator_path": decorator_path,  # 仅记录用
                "prefix": prefix,
                "decorator_var": decorator_var,
            })
    return routes


# ============================================================================
# 路径归一化与匹配
# ============================================================================

def _normalize_path(url: str) -> str:
    """路径归一化

    - 去 /api/v1 / /api 前缀
    - 模板字符串占位符 ${id} → {id}
    - 剥离 query 字符串后缀（${query} / ?xxx 两种形态）
    """
    p = url.strip()
    # 去 /api/v1 或 /api 前缀（多次匹配以兼容历史版本）
    p = re.sub(r"^/api/v\d+/", "/", p)
    p = re.sub(r"^/api/", "/", p)
    # 识别未闭合的三元模板 ${var ? ...}，截断到 ${ 前
    # 如 /scf/cases${qs ? `?${qs}` : ''} → /scf/cases
    p = re.sub(r"\$\{\w+\s*\?.*$", "", p)
    # 模板字符串占位符统一：${id} → {id}
    p = re.sub(r"\$\{(\w+)\}", r"{\1}", p)
    # 剥离 query 后缀：
    #   1) 字面 ?xxx=yyy 形式
    if "?" in p:
        p = p.split("?", 1)[0]
    #   2) 尾部 {query}/{qs}/{params}/{search} 模板变量（非路径段，前面不是 /）
    #      如 /bank/{id}/risk-letters{query} → /bank/{id}/risk-letters
    p = re.sub(r"(?<!/)\{(?:query|qs|params|search|q)\}$", "", p)
    # 去末尾 /
    p = p.rstrip("/") if len(p) > 1 else p
    return p


def _match_calls_to_routes(frontend_calls: list, backend_routes: list) -> list:
    """匹配前端调用与后端路由

    匹配规则：
      1. HTTP 方法一致
      2. 归一化路径一致（后端路径支持 {param} 占位符）
    """
    edges = []
    # 后端路由按 (method, normalized_path) 索引
    backend_index = {}
    for route in backend_routes:
        key = (route["http_method"], _normalize_path(route["raw_path"]))
        backend_index[key] = route

    # 后端路径模式用于占位符匹配（method -> [path_patterns]）
    backend_patterns = {}
    for route in backend_routes:
        method = route["http_method"]
        norm = _normalize_path(route["raw_path"])
        backend_patterns.setdefault(method, []).append((norm, route))

    for call in frontend_calls:
        norm_url = _normalize_path(call["raw_url"])
        method = call["http_method"]

        # 精确匹配
        key = (method, norm_url)
        if key in backend_index:
            route = backend_index[key]
            edges.append(_make_edge(call, route, is_orphan=False))
            continue

        # 模糊匹配：支持后端 {param} 占位符
        # 把后端路径转为正则：{param} → [^/]+
        matched = False
        for pattern, route in backend_patterns.get(method, []):
            if "{" not in pattern:
                continue
            regex = re.sub(r"\{[^}]+\}", r"[^/]+", pattern)
            regex = f"^{regex}$"
            if re.match(regex, norm_url):
                edges.append(_make_edge(call, route, is_orphan=False))
                matched = True
                break

        if not matched:
            # 孤儿契约：前端调了但后端没注册
            edges.append(_make_edge(call, None, is_orphan=True))

    return edges


def _make_edge(call: dict, route: dict | None, is_orphan: bool) -> dict:
    """构造边 dict"""
    edge = {
        "frontend_file": call["frontend_file"],
        "frontend_line": call["frontend_line"],
        "http_method": call["http_method"],
        "path": _normalize_path(call["raw_url"]),
        "is_orphan": is_orphan,
    }
    if route is not None:
        edge["backend_file"] = route["backend_file"]
        edge["backend_line"] = route["backend_line"]
    else:
        edge["backend_file"] = ""
        edge["backend_line"] = 0
    return edge


# ============================================================================
# 自检入口
# ============================================================================

if __name__ == "__main__":
    import sys
    # 自检：扫描某目录
    test_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    fake_files = []
    for ts_file in (test_root / "frontend" / "src" / "api").rglob("*.ts"):
        fake_files.append(type("F", (), {
            "path": str(ts_file.relative_to(test_root)).replace("\\", "/"),
            "absolute_path": str(ts_file),
            "language": "ts",
        }))
    for py_file in (test_root / "backend" / "app" / "api").rglob("*.py"):
        fake_files.append(type("F", (), {
            "path": str(py_file.relative_to(test_root)).replace("\\", "/"),
            "absolute_path": str(py_file),
            "language": "python",
        }))
    edges = capture_contract_edges(test_root, fake_files)
    print(f"找到 {len(edges)} 条契约边")
    orphan_count = sum(1 for e in edges if e["is_orphan"])
    print(f"其中孤儿契约：{orphan_count} 条")
    for e in edges[:10]:
        mark = "🔴" if e["is_orphan"] else "✅"
        print(f"  {mark} [{e['http_method'].upper()}] {e['path']}")
        print(f"     前端: {e['frontend_file']}:{e['frontend_line']}")
        if not e["is_orphan"]:
            print(f"     后端: {e['backend_file']}:{e['backend_line']}")
