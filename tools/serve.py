#!/usr/bin/env python3
"""開発用静的サーバー。全レスポンスに no-store を付け、JS/GLB/画像の
差し替えが即座にブラウザへ反映されるようにする（キャッシュ起因の
「更新したのに変わらない」を根絶する）。"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
