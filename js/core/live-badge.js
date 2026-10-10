// «🔴 dan4ik37 в эфире» на всех страницах (SPA и серверные /v/, /games, /quiz…): во время стрима зовём смотреть.
// Статус — decapi.me (как twitch.js), запоминается в sessionStorage на 2 минуты, чтобы переходы между страницами
// не дёргали decapi каждый раз. Закрыл ✕ — до конца визита не показываем.
// SPA: кнопка в углу (не на #/home — там свой плеер, не в #/chat, не во время игры). Серверные страницы — полоска под шапкой.
(function () {
  var KEY = 'd37_live', TTL = 120e3, CH = 'dan4ik37';
  var spa = !!document.getElementById('bottomTabbar');
  function get() { try { var s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && Date.now() - s.t < TTL ? s.live : null; } catch (e) { return null; } }
  function put(live) { try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), live: live })); } catch (e) {} }
  function closed() { try { return sessionStorage.getItem('d37_live_x') === '1'; } catch (e) { return false; } }
  function check() {
    var c = get();
    if (c !== null) return Promise.resolve(c);
    return fetch('https://decapi.me/twitch/uptime/' + CH, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { var live = !!t && !/offline|error|not found|could not|invalid/i.test(t); put(live); return live; })
      .catch(function () { return false; });
  }
  function hiddenHere() {
    if (!spa) return false;
    var r = document.body.dataset.route;
    return r === 'home' || r === 'chat' || document.body.classList.contains('game-on');
  }
  function render(live) {
    var el = document.getElementById('d37Live');
    if (!live || closed()) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'd37Live';
      el.className = spa ? 'd37-live d37-live-spa' : 'd37-live d37-live-bar';
      el.innerHTML = '<a href="/#/home" class="d37-live-go"><i></i><b>dan4ik37 сейчас в эфире</b><span>смотреть ›</span></a>' +
        '<button type="button" class="d37-live-x" aria-label="Скрыть">✕</button>';
      el.querySelector('.d37-live-x').onclick = function () { try { sessionStorage.setItem('d37_live_x', '1'); } catch (e) {} el.remove(); };
      el.querySelector('.d37-live-go').onclick = function () { if (window.va) window.va('event', { name: 'live_badge_click' }); };
      var head = document.querySelector('header.top');
      if (!spa && head) head.after(el); else document.body.appendChild(el);
    }
    el.hidden = hiddenHere();
  }
  function run() { check().then(render); }
  if (!document.getElementById('d37LiveCss')) {
    var st = document.createElement('style');
    st.id = 'd37LiveCss';
    st.textContent =
      '.d37-live{display:flex;align-items:center;gap:.4rem;font-family:Montserrat,system-ui,sans-serif;z-index:480}' +
      '.d37-live[hidden]{display:none}' +
      '.d37-live-go{display:flex;align-items:center;gap:.55rem;flex:1;min-width:0;text-decoration:none;color:#fff}' +
      '.d37-live-go i{width:10px;height:10px;border-radius:50%;background:#ff2d55;box-shadow:0 0 0 0 rgba(255,45,85,.7);animation:d37LivePulse 1.6s infinite;flex:none}' +
      '.d37-live-go b{font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.d37-live-go span{font-size:.78rem;font-weight:800;color:#ffd166;white-space:nowrap}' +
      '.d37-live-x{border:0;background:none;color:rgba(255,255,255,.7);font-size:.9rem;cursor:pointer;padding:.3rem .45rem}' +
      '.d37-live-bar{padding:.55rem 1rem;background:linear-gradient(90deg,rgba(145,71,255,.35),rgba(255,45,85,.3));border-bottom:1px solid rgba(255,255,255,.08)}' +
      '.d37-live-spa{position:fixed;left:14px;bottom:18px;max-width:calc(100vw - 28px);padding:.55rem .6rem .55rem .9rem;border-radius:999px;' +
        'background:rgba(16,16,26,.95);border:1px solid rgba(145,71,255,.55);box-shadow:0 12px 34px rgba(0,0,0,.55),0 0 24px -6px rgba(145,71,255,.7)}' +
      '@media(max-width:768px){.d37-live-spa{bottom:calc(70px + env(safe-area-inset-bottom))}}' +
      '@keyframes d37LivePulse{0%{box-shadow:0 0 0 0 rgba(255,45,85,.7)}70%{box-shadow:0 0 0 9px rgba(255,45,85,0)}100%{box-shadow:0 0 0 0 rgba(255,45,85,0)}}' +
      '@media(prefers-reduced-motion:reduce){.d37-live-go i{animation:none}}';
    document.head.appendChild(st);
  }
  run();
  setInterval(run, 3 * 60e3);
  // SPA: смена раздела — показать/спрятать (на главной и в чате не нужна)
  window.addEventListener('hashchange', function () { setTimeout(function () { var el = document.getElementById('d37Live'); if (el) el.hidden = hiddenHere(); }, 200); });
})();
