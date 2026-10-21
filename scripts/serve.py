# Локальный сервер сайта С ЗАГОЛОВКАМИ и ПЕРЕАДРЕСАЦИЯМИ из vercel.json («python -m http.server» их не делает).
# Нужен, чтобы локально работала сборка Rust в студии (studio/rust.html получает Document-Isolation-Policy) и настоящие адреса
# разделов (/chat, /forum/42, /play/chess — js/ui/router.js): как на Vercel — redirects → файл → rewrites → 404.html (статус 404).
# Запуск из корня сайта:  python scripts/serve.py 5500   →  http://localhost:5500/
# /api/* — функции Vercel: локально 404 (серверные страницы /forum, /games/<id>, /videos… тоже — их rewrite ведёт в /api).
import http.server, json, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500

with open(os.path.join(ROOT, 'vercel.json'), encoding='utf-8') as f:
    VJ = json.load(f)

# Шаблон Vercel (path-to-regexp): /a/:id, /a/:path*, /a/:path+ → регулярное выражение с именованными группами
def compile_src(src):
    out, i = '', 0
    for m in re.finditer(r'/:([A-Za-z_]\w*)([*+]?)', src):
        out += re.escape(src[i:m.start()])
        name, mod = m.group(1), m.group(2)
        if mod == '*':
            out += '(?:/(?P<%s>.*))?' % name
        elif mod == '+':
            out += '/(?P<%s>.+)' % name
        else:
            out += '/(?P<%s>[^/]+)' % name
        i = m.end()
    out += re.escape(src[i:])
    return re.compile('^' + out + '$')

def fill(dest, m):
    return re.sub(r':([A-Za-z_]\w*)[*+]?', lambda x: (m.groupdict().get(x.group(1)) or ''), dest)

HEADERS = [(re.compile('^' + h['source'] + '$'), h['headers']) for h in VJ.get('headers', [])]
REDIRECTS = [(compile_src(r['source']), r['destination'], r.get('permanent', True)) for r in VJ.get('redirects', [])]
REWRITES = [(compile_src(r['source']), r['destination']) for r in VJ.get('rewrites', [])]

def is_file(p):
    f = os.path.normpath(os.path.join(ROOT, p.lstrip('/')))
    return f.startswith(ROOT) and os.path.isfile(f)

# Куда ведёт адрес: ('redirect', куда, код) | ('file', путь) | ('api', путь) | ('404', None) — то же решение, что у Vercel
def resolve(path):
    for rx, dest, perm in REDIRECTS:
        m = rx.match(path)
        if m:
            return ('redirect', fill(dest, m), 308 if perm else 307)
    if path == '/' or is_file(path):
        return ('file', '/index.html' if path == '/' else path)
    for rx, dest in REWRITES:
        m = rx.match(path)
        if m:
            d = fill(dest, m)
            target = d.split('?')[0]
            if target.startswith('/api/'):
                return ('api', d)
            return ('file', target) if is_file(target) else ('404', None)
    return ('404', None)

class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows иногда отдаёт .js как text/plain — модули и потоки так не грузятся
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml'}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _route(self):
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path) or '/'
        if path != '/' and path.endswith('/') and VJ.get('trailingSlash') is False:
            return ('redirect', path.rstrip('/') + (('?' + u.query) if u.query else ''), 308)
        r = resolve(path)
        if r[0] == 'redirect' and u.query:
            r = (r[0], r[1] + ('&' if '?' in r[1] else '?') + u.query, r[2])
        return r

    def send_head(self):
        kind, *rest = self._route()
        if kind == 'redirect':
            self.send_response(rest[1])
            self.send_header('Location', rest[0])
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        if kind == 'file':
            self.path = rest[0]
            return super().send_head()
        # /api/* (функции Vercel) и неизвестные адреса — 404.html со статусом 404
        f = os.path.join(ROOT, '404.html')
        body = open(f, 'rb').read()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        return None

    def end_headers(self):
        path = self.path.split('?')[0].split('#')[0]
        for rx, hs in HEADERS:
            if rx.match(path):
                for h in hs:
                    self.send_header(h['key'], h['value'])
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get('D37_SERVE_QUIET') != '1':
            super().log_message(fmt, *args)

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
