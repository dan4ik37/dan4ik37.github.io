// SDK Денчика для Unity — мост WebGL-сборки с сайтом dan4ik37.vercel.app (window.postMessage).
// Протокол (версия 1): каждое сообщение — объект { d37u: 1, t: '<тип>', ...поля }.
//   Игра → сайт: hello, score, over, toast, log, room.create, room.join, room.leave, room.send (их собирает D37.cs).
//   Сайт → игра: init, player, room.state, room.msg, room.error, result — уходят в C# через
//   SendMessage('<объект моста>', 'D37Receive', json) (объект создаёт D37.Init, см. D37Bridge.cs).
// Безопасность: принимаем только сообщения от родительского окна (страница сайта, в которую встроена игра) с адреса сайта
// (или localhost — для проверки у себя), а после init — только с того адреса, что прислал init. Шлём тоже только на
// адрес сайта — никогда на '*' (иначе чужая страница, встроившая игру, читала бы её сообщения).
// Всё нужное — в объекте D37B: Emscripten переносит функции библиотеки в сборку ТЕКСТОМ, переменные этого файла вне
// mergeInto туда не попадают. Только ES5 (var, function) — так собирается во всех версиях Unity с 2021.3.
var D37BridgeLib = {
  $D37B: {
    go: '',
    site: '',
    queue: [],
    listening: false,
    sites: ['https://dan4ik37.vercel.app', 'https://dan4ik37.github.io'],

    allowed: function (o) {
      if (typeof o !== 'string') return false;
      if (D37B.sites.indexOf(o) >= 0) return true;
      return /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/.test(o);
    },
    parent: function () {
      try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
    },
    // Кому слать hello, пока адрес сайта не известен: адрес из ancestorOrigins / referrer (если разрешён) и все сайты списка
    targets: function () {
      var t = [], i, o;
      try { o = window.location.ancestorOrigins; if (o && o.length && D37B.allowed(o[0])) t.push(o[0]); } catch (e) {}
      try { o = document.referrer ? new URL(document.referrer).origin : ''; if (D37B.allowed(o) && t.indexOf(o) < 0) t.push(o); } catch (e) {}
      for (i = 0; i < D37B.sites.length; i++) if (t.indexOf(D37B.sites[i]) < 0) t.push(D37B.sites[i]);
      return t;
    },
    post: function (msg) {
      var p = D37B.parent(), t, i;
      if (!p) return false;
      msg.d37u = 1;
      if (D37B.site) { try { p.postMessage(msg, D37B.site); } catch (e) {} return true; }
      if (msg.t === 'hello') {
        t = D37B.targets();
        for (i = 0; i < t.length; i++) { try { p.postMessage(msg, t[i]); } catch (e) {} }
        return true;
      }
      if (D37B.queue.length < 64) D37B.queue.push(msg);   // до init адрес сайта неизвестен — подождём его
      return true;
    },
    deliver: function (json) {
      if (!D37B.go) return;
      try {
        if (typeof SendMessage === 'function') SendMessage(D37B.go, 'D37Receive', json);
        else if (typeof Module !== 'undefined' && Module.SendMessage) Module.SendMessage(D37B.go, 'D37Receive', json);
      } catch (e) { console.warn('[D37] SendMessage:', e); }
    },
    onMessage: function (e) {
      var p = D37B.parent(), d, q, i, json;
      if (!p || !e || e.source !== p || !D37B.allowed(e.origin)) return;
      d = e.data;
      if (!d || typeof d !== 'object' || d.d37u !== 1 || typeof d.t !== 'string') return;
      if (D37B.site && e.origin !== D37B.site) return;
      if (!D37B.site) {
        if (d.t !== 'init') return;
        D37B.site = e.origin;
        q = D37B.queue; D37B.queue = [];
        for (i = 0; i < q.length; i++) { try { p.postMessage(q[i], D37B.site); } catch (er) {} }
      }
      try { json = JSON.stringify(d); } catch (er) { return; }
      D37B.deliver(json);
    },
    // Строка JS → память сборки. Возвращённую в C# строку освобождает сам IL2CPP (free), поэтому _free здесь не зовём
    str: function (s) {
      var n = lengthBytesUTF8(s) + 1, ptr = _malloc(n);
      stringToUTF8(s, ptr, n);
      return ptr;
    }
  },

  // Запуск моста: имя объекта для SendMessage и hello (JSON: версия SDK и Unity). 1 — отправлено, 0 — игра не на сайте
  D37_Init: function (goPtr, helloPtr) {
    var hello = {};
    D37B.go = UTF8ToString(goPtr);
    if (!D37B.listening) { D37B.listening = true; window.addEventListener('message', D37B.onMessage); }
    try { hello = JSON.parse(UTF8ToString(helloPtr)) || {}; } catch (e) { hello = {}; }
    hello.t = 'hello';
    return D37B.post(hello) ? 1 : 0;
  },

  // Любое сообщение игры сайту: JSON-объект с полем t. 1 — ушло (или ждёт init), 0 — не JSON или игра не на сайте
  D37_Post: function (jsonPtr) {
    var m;
    try { m = JSON.parse(UTF8ToString(jsonPtr)); } catch (e) { return 0; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return 0;
    return D37B.post(m) ? 1 : 0;
  },

  // 1 — игра открыта внутри другой страницы (на сайте), 0 — отдельно: тогда C# играет без сайта
  D37_IsEmbedded: function () {
    return D37B.parent() ? 1 : 0;
  },

  // Для отладки (D37.DebugInfo): адрес страницы, откуда открыли, адрес сайта после init — строкой JSON
  D37_PageInfo: function () {
    var info = { href: '', referrer: '', site: D37B.site, embedded: !!D37B.parent() };
    try { info.href = String(window.location.href); info.referrer = String(document.referrer || ''); } catch (e) {}
    return D37B.str(JSON.stringify(info));
  }
};

autoAddDeps(D37BridgeLib, '$D37B');
mergeInto(LibraryManager.library, D37BridgeLib);
