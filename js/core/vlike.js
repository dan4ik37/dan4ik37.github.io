// ═══════════════════════════════════════
//  «👍 Лайк на YouTube» — честная кнопка лайка (владелец 05.11: «ставил лайк, и он не работал, хотя он же на сайт переносится»).
//  Сам сайт лайк на YouTube НЕ ставит и не видит: для этого нужен вход через Google с правом youtube.force-ssl, вызов videos.rate
//  и проверка приложения в Google (docs/areas/architecture.md, «Видео» — что нужно от владельца). Поэтому кнопка — обычная ссылка
//  на ролик на YouTube: телефон открывает приложение YouTube (или новую вкладку), компьютер — новую вкладку; лайк ставится там.
//  Вернулся на сайт — цифры ЭТОГО ролика спрашиваем у /api/vstats (api/_lib/routes/vstats.js, кэш 10 мин на ролик, квота
//  бережётся) и шлём событие 'd37:vstats' { id, views, likes, at, src } — карточка / окно ролика / страница /v/<id> пишут
//  «обновлено ЧЧ:ММ». Отметка «✓» на кнопке — только в этом браузере (localStorage d37_liked), это НЕ состояние лайка на YouTube.
//  Наград (XP, 🪙, задания) за лайки и подписки нет и не будет — правила YouTube API III.F.3.c; действие с YouTube — отдельной
//  кнопкой с надписью «на YouTube» (III.C.2).
//  Где: SPA (index.html → карточки youtube.js, окно ролика modal.js, Shorts shorts.js) и серверная /v/<id> (api/video.js).
//  Разметка: <a data-vlike="<id>" href="<D37VLike.url(id)>" target="_blank" rel="noopener">…<span class="vl-mark"></span></a> —
//  нажатие ловится здесь (на всём документе, до обработчиков карточек), ссылка открывается сама (без всплывающего окна —
//  телефоны его блокируют).
// ═══════════════════════════════════════
(function () {
  'use strict';
  if (window.D37VLike) return;
  var KEY = 'd37_liked', PEND = 'd37_vlike_pending';
  var RE = /^[A-Za-z0-9_-]{11}$/;
  var MIN_AWAY = 1500, MAX_AWAY = 30 * 60e3, MEM_MS = 60e3;
  var T_OFF = 'Откроется ролик на YouTube — лайк ставится там (нужен вход в YouTube). Сам сайт лайк не ставит.';
  var T_ON = '✓ — отметка только в этом браузере: ты открывал ролик на YouTube, чтобы поставить лайк. Поставлен ли лайк, видно только на YouTube.';
  var marks = null, pending = null, away = false, mem = {};

  function load() {
    if (marks) return marks;
    try { marks = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { marks = new Set(); }
    return marks;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(Array.from(load()))); } catch (e) {} }
  function readPend() { try { var p = JSON.parse(sessionStorage.getItem(PEND) || 'null'); return p && RE.test(p.id) ? p : null; } catch (e) { return null; } }
  function setPend(p) { try { if (p) sessionStorage.setItem(PEND, JSON.stringify(p)); else sessionStorage.removeItem(PEND); } catch (e) {} }

  var V = window.D37VLike = {
    T_OFF: T_OFF, T_ON: T_ON,
    url: function (id, short) { return 'https://www.youtube.com/' + (short ? 'shorts/' : 'watch?v=') + encodeURIComponent(String(id || '')); },
    marked: function (id) { return load().has(id); },
    // нажали «Лайк на YouTube»: отметка в этом браузере + ждём возврата на сайт
    go: function (id) {
      if (!RE.test(String(id || ''))) return;
      load().add(id); save();
      pending = { id: id, t: Date.now() }; away = false; setPend(pending);
      V.paint(document);
      // ролик на сайте ставим на паузу: человек ушёл на YouTube — иначе играл бы в спрятанной вкладке (плееры с enablejsapi=1)
      var fr = document.querySelectorAll('iframe[src*="youtube.com/embed/"][src*="enablejsapi=1"]');
      for (var i = 0; i < fr.length; i++) { try { fr[i].contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'); } catch (e) {} }
    },
    // отметки на всех кнопках внутри root
    paint: function (root) {
      var list = (root || document).querySelectorAll ? (root || document).querySelectorAll('a[data-vlike]') : [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i], on = V.marked(a.getAttribute('data-vlike'));
        if (a.classList) a.classList.toggle('vl-on', on);
        a.title = on ? T_ON : T_OFF;
        var m = a.querySelector && a.querySelector('.vl-mark');
        if (m) m.textContent = on ? ' ✓' : '';
      }
    },
    // настоящие цифры ролика с YouTube (через сервер сайта) → { id, views, likes, at, src } или null
    stats: function (id) {
      if (!RE.test(String(id || ''))) return Promise.resolve(null);
      var h = mem[id];
      if (h && Date.now() - h.t < MEM_MS) return h.p;
      var p = fetch('/api/vstats?id=' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || d.id !== id || !isFinite(+d.views) || !isFinite(+d.likes)) return null;
        return { id: id, views: +d.views, likes: +d.likes, at: String(d.at || ''), src: d.src === 'snapshot' ? 'snapshot' : 'live' };
      }).catch(function () { return null; });
      mem[id] = { t: Date.now(), p: p };
      p.then(function (s) { if (!s) delete mem[id]; });
      return p;
    },
    // спросить цифры и разослать 'd37:vstats'
    refresh: function (id) {
      return V.stats(id).then(function (s) {
        if (s) { try { window.dispatchEvent(new CustomEvent('d37:vstats', { detail: s })); } catch (e) {} }
        return s;
      });
    },
    // подпись времени: «обновлено 14:05» (сегодня) / «обновлено 3 нояб., 14:05» / у снимка — «данные YouTube на 5 нояб. 2026»
    when: function (s) {
      var d = new Date(s && s.at || 0);
      if (!s || isNaN(d)) return '';
      var tz = { timeZone: 'Europe/Moscow' };
      if (s.src === 'snapshot') return 'данные YouTube на ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      var t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz.timeZone });
      var same = d.toLocaleDateString('ru-RU', tz) === new Date().toLocaleDateString('ru-RU', tz);
      return 'обновлено ' + (same ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: tz.timeZone }) + ', ') + t;
    },
    // число как на серверных страницах (yt.js fmtCount): 1,2 тыс. / 3,4 млн
    fmt: function (n) {
      n = +n || 0;
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' млн';
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',').replace(',0', '') + ' тыс.';
      return String(n);
    },
    // для проверки (scripts/video-test.cjs)
    _state: function () { return { pending: pending, away: away }; }
  };

  // вернулся на сайт после «Лайк на YouTube» → цифры этого ролика
  function back() {
    if (document.visibilityState === 'hidden' || !pending || !away) return;
    var p = pending, dt = Date.now() - p.t;
    if (dt < MIN_AWAY) return;
    pending = null; away = false; setPend(null);
    if (dt <= MAX_AWAY) V.refresh(p.id);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { if (pending) away = true; } else back(); });
  window.addEventListener('blur', function () { if (pending) away = true; });
  window.addEventListener('focus', back);
  window.addEventListener('pageshow', back);
  // нажатие — на всём документе и раньше обработчиков карточек (те могут остановить всплытие); переход по ссылке не отменяем
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-vlike]') : null;
    if (a) V.go(a.getAttribute('data-vlike'));
  }, true);
  // телефон выгрузил вкладку, пока было открыто приложение YouTube, и сайт открылся заново — цифры всё равно обновим
  var was = readPend();
  if (was) { pending = was; away = true; setTimeout(back, 0); }
})();
