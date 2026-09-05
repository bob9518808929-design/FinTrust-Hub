"""
带 charset=utf-8、no-cache 和 Vite 桩的 SimpleHTTPServer
用法: python serve.py [port]
默认端口 8765

特性:
1. 为所有 text/* 响应添加 charset=utf-8 (避免含中文的 JS 被以 Latin-1 解码导致 SyntaxError)
2. 强制禁用缓存 (方便调试)
3. 对 /@vite/client 请求返回空 JS 桩,消除 Vite 残留的 ERR_ABORTED 和 SyntaxError 噪音
"""
import os
import sys
import http.server
import socketserver


VITE_STUB_JS = b"// vite-client stub: Vite HMR not available in production-like static server\n"


class UTF8HTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # 拦截 Vite HMR client 请求,返回空 JS 桩避免 ERR_ABORTED + SyntaxError
        if self.path == '/@vite/client' or self.path.startswith('/@vite/'):
            self.send_response(200)
            self.send_header('Content-type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(VITE_STUB_JS)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.end_headers()
            self.wfile.write(VITE_STUB_JS)
            return
        super().do_GET()

    def do_HEAD(self):
        # 同样拦截 HEAD 请求
        if self.path == '/@vite/client' or self.path.startswith('/@vite/'):
            self.send_response(200)
            self.send_header('Content-type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(VITE_STUB_JS)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.end_headers()
            return
        super().do_HEAD()

    def send_header(self, keyword, value):
        # 拦截 Content-type 响应头,为 text/* 添加 charset=utf-8
        if keyword.lower() == 'content-type' and value.startswith('text/') and 'charset' not in value:
            value = f'{value}; charset=utf-8'
        super().send_header(keyword, value)

    def end_headers(self):
        # 强制禁用缓存,方便调试
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = UTF8HTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', port), handler) as httpd:
        print(f'[serve] serving on http://localhost:{port}/ (UTF-8, no-cache, vite-stub)')
        print(f'[serve] serving directory: {os.getcwd()}')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n[serve] stopped')
