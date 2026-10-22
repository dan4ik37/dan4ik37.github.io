// js/core/errlog.js — ГЕНЕРИРУЕТСЯ: node scripts/make-errlog.mjs из api/_lib/errlog.js (руками не править). Мониторинг ошибок сайта,
// этап 2: очистка от личных данных, дедуп, пачки, лимиты, POST /api/diag. Подгружается этапом 1 (в <head>) только при первой ошибке.
(function () {
  var S = window.__d37el;
  if (!S || S.on) return;
  (function errLog(K, S) {
  var W = window;
  try {
    var L = W.location, host = String(L.host || '');
    var CFG = { url: '/api/diag', keys: 8, sends: 4, perDay: 40, sendsDay: 8, wait: 4000, gap: 30000, rate: 1, cap: 10, key: 'd37_el' };
    var seen = {}, byKey = {}, list = [], nk = 0, nz = 0, drop = 0, sends = 0, last = 0, timer = 0, on = null, st = null, busy = 0, hooked = 0, dead = 0;
    var N = W.navigator || {}, U = K.ua(N.userAgent, N.maxTouchPoints | 0);
    function ls(set) {
      try {
        if (set) W.localStorage.setItem(CFG.key, JSON.stringify(st));
        else st = JSON.parse(W.localStorage.getItem(CFG.key) || 'null') || {};
      } catch (e) { if (!st) st = {}; }
      if (!st || typeof st !== 'object') st = {};
    }
    // можно ли ещё отправлять сегодня с этого браузера (и не сказал ли сервер «хватит»)
    function allowed() {
      if (st === null) ls();
      var d = new Date().toISOString().slice(0, 10);
      if (st.d !== d) { st.d = d; st.n = 0; st.s = 0; }
      return !(st.off > Date.now()) && st.n < CFG.perDay && st.s < CFG.sendsDay;
    }
    function ver() { try { return typeof GAMES_VER !== 'undefined' ? String(GAMES_VER).slice(0, 12) : ''; } catch (e) { return ''; } }
    function hook() {
      if (hooked) return;
      hooked = 1;
      W.addEventListener('pagehide', function () { flush(true); });
      try { W.document.addEventListener('visibilitychange', function () { if (W.document.visibilityState === 'hidden') flush(true); }); } catch (e) {}
    }
    function arm() {
      if (timer || dead || sends >= CFG.sends) return;
      hook();
      timer = setTimeout(function () { timer = 0; flush(false); }, Math.max(CFG.wait, last ? CFG.gap - (Date.now() - last) : 0));
    }
    // ответ сервера: { stop: секунд молчать, rate: доля визитов } — запоминаем в браузере
    function reply(j) {
      try {
        if (!j || typeof j !== 'object') return;
        if (j.stop > 0) { st.off = Date.now() + Math.min(+j.stop, 86400) * 1000; dead = 1; }
        if (typeof j.rate === 'number' && j.rate >= 0 && j.rate <= 1) st.rate = j.rate;
        ls(true);
      } catch (e) {}
    }
    function post(body, fin) {
      try {
        if (fin && N.sendBeacon && typeof Blob === 'function') {
          try { if (N.sendBeacon(CFG.url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return; } catch (e) {}
        }
        if (typeof W.fetch === 'function') {
          W.fetch(CFG.url, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
            .then(function (r) { return r && r.json ? r.json() : null; })
            .then(reply)
            .catch(function () {});
        }
      } catch (e) {}
    }
    function flush(fin) {
      try {
        if (dead || sends >= CFG.sends) return;
        var items = [], out = [], i, e;
        for (i = 0; i < list.length && items.length < CFG.cap; i++) if (list[i].n > list[i].sent) items.push(list[i]);
        if (!items.length) return;
        if (!allowed()) { dead = 1; return; }
        if (st.n + items.length > CFG.perDay) items.length = CFG.perDay - st.n;
        for (i = 0; i < items.length; i++) {
          e = items[i];
          out.push({ t: e.t, m: e.m, f: e.f, l: e.l, c: e.c, r: e.r, n: e.n - e.sent, s: e.sent ? '' : e.s });
          e.sent = e.n;
        }
        sends++; last = Date.now(); st.n += out.length; st.s++; ls(true);
        post(JSON.stringify({ v: ver(), b: U.b, o: U.o, d: U.d, x: drop, e: out }), fin);
      } catch (x) {}
    }
    // одна ошибка (cnt раз уже случилась); p/h — адрес в момент ошибки
    function add(kind, msg, file, line, col, er, cnt, p, h) {
      var raw = kind + '|' + msg + '|' + file + '|' + line, e = seen[raw];
      if (e) { if (e.x) return; e.n += cnt; if (e.sent) arm(); return; }
      if (nk >= CFG.keys) { drop++; return; }
      if (on === null) { allowed(); on = Math.random() < (typeof st.rate === 'number' ? st.rate : CFG.rate); }
      // шум помним (чтобы не разбирать снова), но не больше 200 разных — в цикле с новым текстом каждый раз память не растёт
      if (!on || K.noise(msg, file, host)) { if (nz++ < 200) seen[raw] = { x: 1 }; return; }
      var sk = er && typeof er.stack === 'string' ? er.stack : '', ss = K.stack(sk, host), cf = K.urlPath(file, host), ln = line | 0;
      // обещание, у которого в стеке только чужие кадры (реклама, расширение), — не наше
      if (kind === 'p' && !ss.f && /(?:https?|chrome-extension|moz-extension|safari-web-extension):\/\//.test(sk)) { if (nz++ < 200) seen[raw] = { x: 1 }; return; }
      if (!cf && ss.f) { cf = ss.f; ln = ss.l; col = ss.c; }
      var cm = K.clean(msg, host), ck = kind + '|' + cm + '|' + cf + '|' + ln;
      e = byKey[ck];
      if (!e) { e = byKey[ck] = { t: kind, m: cm, f: cf, l: ln, c: col | 0, s: ss.s, r: K.route(p, h), n: 0, sent: 0 }; list.push(e); nk++; }
      seen[raw] = e; e.n += cnt;
      arm();
    }
    function onRec(r) {
      if (busy || dead) return;
      busy = 1;
      try {
        var n = r.n || 1;
        if (r.t === 'p') {
          var x = r.rr, m, er = null;
          if (x && typeof x === 'object') {
            m = typeof x.message === 'string' ? (x.name && x.name !== 'Error' ? x.name + ': ' : '') + x.message : '[' + K.short(x) + ']';
            if (typeof x.stack === 'string') er = x;
          } else m = String(x).slice(0, 300);
          add('p', m, '', 0, 0, er, n, r.p, r.h);
        } else if (r.t === 'r') {
          if (N.onLine !== false) add('r', r.m, r.u, 0, 0, null, n, r.p, r.h);
        } else add(r.t, r.m, r.f || '', r.l | 0, r.c | 0, r.er, n, r.p, r.h);
      } catch (x) {}
      busy = 0;
    }
    S.on = onRec;
    // для отладки в консоли: __d37el.stat()
    S.stat = function () { return { keys: nk, dropped: drop, sends: sends, seen: Object.keys(seen).length, noise: nz, dead: dead }; };
    var q = S.q.splice(0), i;
    for (i = 0; i < q.length; i++) onRec(q[i]);
  } catch (e) {}
})((function errCore() {
  // свой сайт: только настоящий адрес (не localhost, не file:, не копия на github.io, не предпросмотры Vercel)
  function site(h) { return /(^|\.)dan4ik37\.vercel\.app$/i.test(String(h || '')); }
  // Адрес → путь без запроса и #: свой — "/js/x.js", jsDelivr (наши зависимости) — "cdn:/npm/…", чужой и blob:/data: — ''
  function urlPath(u, host) {
    u = String(u == null ? '' : u).slice(0, 400);
    if (!u || (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u))) return '';
    var m = /^(?:https?:)?(?:\/\/([^\/?#]*))?([^?#]*)/i.exec(u);
    if (!m) return '';
    var h = (m[1] || '').toLowerCase().replace(/:\d+$/, ''), p = (m[2] || '').replace(/[^\w\/.@~+-]/g, '');
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.length > 100) p = p.slice(0, 100);
    if (!m[1]) return p;
    if (host && h === String(host).toLowerCase().replace(/:\d+$/, '')) return p;
    if (h === 'cdn.jsdelivr.net') return 'cdn:' + p;
    return '';
  }
  // Сообщение об ошибке → без личных данных и мусора, до 180 знаков. В кавычках остаётся только «имя из кода»
  function clean(s, host) {
    s = String(s == null ? '' : s);
    if (s.length > 700) s = s.slice(0, 700);
    s = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/^\s*Uncaught\s+/, '');
    s = s.replace(/https?:\/\/[^\s'"`<>()\[\]{}]+/gi, function (u) { return urlPath(u, host) || '<url>'; });
    s = s.replace(/\b(?:blob|data|javascript|file|chrome-extension|moz-extension|safari-extension|safari-web-extension):[^\s'"`<>()]+/gi, '<url>');
    if (/JSON/.test(s)) s = s.replace(/"[^"]*"/g, '"…"');
    s = s.replace(/(Failed to parse URL from|Invalid URL:?|not a valid URL:?)\s.*$/i, '$1');
    s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
    s = s.replace(/eyJ[\w-]{6,}\.[\w-]{6,}(?:\.[\w-]*)?/g, '<jwt>');
    s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
    // длинное с буквами и цифрами — ключ или хеш; путь файла через дефисы (всё строчное, есть - или /) оставляем
    s = s.replace(/(?=[A-Za-z0-9_+\/=-]*\d)(?=[A-Za-z0-9_+\/=-]*[A-Za-z])[A-Za-z0-9_+\/=-]{28,}/g, function (t) { return /[A-Z]/.test(t) || !/[-\/]/.test(t) ? '<tok>' : t; });
    s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, '<n>');
    s = s.replace(/\d{5,}/g, '<n>');
    s = s.replace(/(["'`])((?:(?!\1)[^\\\n]){0,200})\1/g, function (m, q, t) {
      var name = t.length === 1 || (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3}$/.test(t) && t.length <= 40 && (t.match(/\d/g) || []).length <= 2);
      return name || t === '' ? m : q + '…' + q;
    });
    s = s.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    return s.length > 180 ? s.slice(0, 177) + '…' : s;
  }
  // Стек → первые 4 «свои» кадра "имя /путь:строка:столбец"; f/l/c — самый верхний свой кадр
  function stack(st, host) {
    var out = { s: '', f: '', l: 0, c: 0 };
    if (typeof st !== 'string' || !st) return out;
    var lines = st.slice(0, 4000).split('\n'), res = [], i, m, p, nm, a;
    for (i = 0; i < lines.length && res.length < 4; i++) {
      m = /(https?:\/\/[^\s()'"]+?):(\d+):(\d+)/.exec(lines[i]);
      if (!m) continue;
      p = urlPath(m[1], host);
      if (!p) continue;
      nm = '';
      a = /^\s*(?:at\s+)?(?:async\s+)?(?:new\s+)?([\w$.<>\[\] ]{1,40}?)\s*(?:\(|@)/.exec(lines[i]);
      if (a) nm = a[1].replace(/\s+/g, ' ');
      if (!res.length) { out.f = p; out.l = +m[2] || 0; out.c = +m[3] || 0; }
      res.push((nm ? nm + ' ' : '') + p + ':' + m[2] + ':' + m[3]);
    }
    out.s = res.join('\n').slice(0, 360);
    return out;
  }
  // Раздел сайта: первый кусок адреса (play/<игра> — вместе с игрой); ничего длинного и похожего на id
  function route(path, hash) {
    var p = String(path || '/'), h = String(hash || '');
    if ((p === '/' || p === '') && /^#\/[\w\/-]{0,80}$/.test(h)) p = h.slice(1);
    var a = p.split('/').filter(Boolean), s = (a[0] || 'home').toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,19}$/.test(s)) return 'other';
    if ((s === 'play' || s === 'games') && a[1] && /^[a-z][a-z0-9_-]{0,23}$/i.test(a[1])) s += '/' + a[1].toLowerCase();
    return s;
  }
  // Браузер с большой версией, система и класс устройства — грубо (m — телефон, t — планшет, d — компьютер)
  function ua(u, touch) {
    u = String(u || '');
    var m, b = 'other', v = '', o, d;
    if ((m = /\b(?:EdgA?|Edg|EdgiOS)\/(\d+)/.exec(u))) { b = 'edge'; v = m[1]; }
    else if ((m = /\b(?:OPR|OPiOS|Opera)\/(\d+)/.exec(u))) { b = 'opera'; v = m[1]; }
    else if ((m = /\bYaBrowser\/(\d+)/.exec(u))) { b = 'yandex'; v = m[1]; }
    else if ((m = /\bSamsungBrowser\/(\d+)/.exec(u))) { b = 'samsung'; v = m[1]; }
    else if ((m = /\b(?:Firefox|FxiOS)\/(\d+)/.exec(u))) { b = 'firefox'; v = m[1]; }
    else if ((m = /\b(?:Chrome|CriOS|HeadlessChrome)\/(\d+)/.exec(u))) { b = 'chrome'; v = m[1]; }
    else if ((m = /\bVersion\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari/.exec(u))) { b = 'safari'; v = m[1]; }
    var pad = /iPad/.test(u) || (/Macintosh/.test(u) && touch > 1);
    o = pad || /iPhone|iPod/.test(u) ? 'ios' : /Android/.test(u) ? 'android' : /Windows/.test(u) ? 'windows' : /CrOS/.test(u) ? 'chromeos'
      : /Macintosh|Mac OS X/.test(u) ? 'mac' : /Linux|X11/.test(u) ? 'linux' : 'other';
    d = pad || /Tablet/.test(u) || (/Android/.test(u) && !/Mobile/.test(u)) ? 't' : /Mobi|iPhone|iPod|Android/.test(u) ? 'm' : 'd';
    return { b: v ? b + '/' + v : b, o: o, d: d };
  }
  // Что НЕ считаем ошибкой сайта: расширения, чужие скрипты, пропала сеть, запрет автозапуска звука
  function noise(msg, file, host) {
    msg = String(msg == null ? '' : msg).slice(0, 400); file = String(file == null ? '' : file);
    if (/^(?:chrome|moz|safari|safari-web)-extension:|^(?:webkit-masked-url|about|blob|data|javascript):/i.test(file)) return true;
    if (/^https?:\/\//i.test(file)) {
      var h = ((/^https?:\/\/([^\/?#]+)/i.exec(file) || [])[1] || '').toLowerCase().replace(/:\d+$/, '');
      if (h !== String(host || '').toLowerCase().replace(/:\d+$/, '') && h !== 'cdn.jsdelivr.net') return true;
    }
    if (!file && /^(?:Uncaught )?(?:Error: )?Script error\.?$/i.test(msg)) return true;
    if (/ResizeObserver loop|Non-Error promise rejection/i.test(msg)) return true;
    if (/^(?:Uncaught )?AbortError\b/i.test(msg)) return true;
    if (/^(?:Uncaught )?(?:\w*Error: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed|network error|The network connection was lost\.?|The Internet connection appears to be offline\.?|cancelled|Fetch is aborted|The user aborted a request\.?|The operation was aborted\.?)$/i.test(msg)) return true;
    if (/play\(\) (?:failed|request was interrupted)|The play\(\) request|The request is not allowed by the user agent/i.test(msg)) return true;
    if (/_AutofillCallbackHandler|webkit\.messageHandlers|Java object is gone|__gCrWeb|__firefox__|\bethereum\b|\bsolana\b|tronWeb|chrome\.runtime|browser\.runtime/i.test(msg)) return true;
    return false;
  }
  // Имя типа объекта для сообщений вида [Event]
  function short(o) {
    var n = '';
    try { n = (o && o.constructor && o.constructor.name) || typeof o; } catch (e) { n = 'object'; }
    return String(n).replace(/[^\w$]/g, '').slice(0, 30) || 'object';
  }
  return { site: site, urlPath: urlPath, clean: clean, stack: stack, route: route, ua: ua, noise: noise, short: short };
})(), S);
})();
