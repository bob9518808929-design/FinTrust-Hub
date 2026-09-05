"""全景导航面板本地静态服务器.

用法 (在仓库根目录):
    python tools/panorama/serve.py [端口]   # 默认 8765

相比 `python -m http.server`, 额外处理两类与面板无关的浏览器请求:
    GET /@vite/client → 204
        来源: 同端口历史上跑过 Vite dev server (production/frontend 使用
        vite-plugin-pwa), 浏览器残留的 Service Worker / 磁盘缓存会向页面
        注入 Vite HMR 客户端引用; 纯静态服务器无此资源, 返回 204 静默.
        彻底清除: 浏览器 DevTools → Application → Service Workers → Unregister
                  并清空站点缓存.
    GET /favicon.ico  → 204
        面板无图标资源, 静默避免 404 噪声.
其余请求按 tools/panorama 目录静态资源正常返回.
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PANORAMA_DIR = Path(__file__).resolve().parent

# 静默兜底路径 (返回 204 No Content)
_SILENT_PATHS = {"/@vite/client", "/favicon.ico"}


class _PanelHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (http.server 命名约定)
        path = self.path.split("?", 1)[0]
        if path in _SILENT_PATHS:
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, fmt: str, *args: object) -> None:
        # 与 http.server 默认行为一致, 输出到 stderr
        sys.stderr.write(
            "%s - - [%s] %s\n"
            % (self.address_string(), self.log_date_time_string(), fmt % args)
        )


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(_PanelHandler, directory=str(PANORAMA_DIR))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"全景导航面板: http://localhost:{port}/panorama_dashboard.html")
        print(f"静态根目录: {PANORAMA_DIR}")
        print("提示: /@vite/client 与 /favicon.ico 返回 204 (Vite SW 残留兜底)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")


if __name__ == "__main__":
    main()
