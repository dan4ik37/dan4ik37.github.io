# Локальный сервер сайта С ЗАГОЛОВКАМИ из vercel.json («python -m http.server» их не ставит).
# Нужен, чтобы локально работала сборка Rust в студии: studio/rust.html получает Document-Isolation-Policy.
# Запуск из корня сайта:  python scripts/serve.py 5500   →  http://localhost:5500/#/home
# /api/* локально по-прежнему 404 (это функции Vercel). Переписывания адресов (rewrites) тоже не делает.
import http.server, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500

with open(os.path.join(ROOT, 'vercel.json'), encoding='utf-8') as f:
    RULES = [(re.compile('^' + h['source'] + '$'), h['headers']) for h in json.load(f).get('headers', [])]

class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows иногда отдаёт .js как text/plain — модули и потоки так не грузятся
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml'}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        path = self.path.split('?')[0].split('#')[0]
        for rx, hs in RULES:
            if rx.match(path):
                for h in hs:
                    self.send_header(h['key'], h['value'])
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
