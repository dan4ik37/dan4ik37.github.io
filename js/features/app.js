// ═══════════════════════════════════════
//  ПРИЛОЖЕНИЕ 📲 (D37App) — сайт как программа на ПК и телефоне (PWA, «как Discord / Roblox»), реклама — как на сайте
// ═══════════════════════════════════════
// Почему PWA, а не программа на Electron/Tauri: AdSense запрещает свой код в программах («pop-ups, emails or software»), а
// установленный PWA — тот же сайт в движке браузера: реклама AdSense / РСЯ работает как на сайте. Магазины — docs/APPS.md.
//  • Установка: кнопка браузера (beforeinstallprompt — Chrome, Edge, Яндекс на ПК и Android); «📲 Установить приложение» в меню
//    «Ещё», в профиле и в ⚙️ Настройки → Сайт (всё с [data-app-install] прячется, когда установлено); разовая карточка с 3-го
//    захода (cardDue: не вместе с окошком возраста, не поверх игры и окон); инструкция с картинками (iPhone/iPad, Android,
//    Firefox, Mac — js/features/app-guide.js, грузится при открытии); адрес #/app — сразу инструкция (для ссылок в соцсетях);
//    «спасибо» после установки; Vercel Analytics app_* и цель Метрики app_installed (только ОС и браузер, без личного).
//  • Вид приложения (окно без браузера): html.app-standalone (+ app-wco, app-ios / app-android / app-desktop), тёмная полоса
//    окна, без «резинки», «⟳ Обновить» в меню, «Назад» на Android закрывает окна сайта (backArm); на ПК шапка сайта — заголовок
//    окна (window-controls-overlay: кнопки окна не закрывают меню, окно тянется за шапку).
//  • Значок на иконке (setAppBadge): непрочитанные ЛС + пропущенные звонки + 🔔 — по событиям d37:dm-unread, d37:notif,
//    d37:badges (phone.js), d37:callstate; своих опросов нет. Выключить — ⚙️ Настройки → Сайт.
//  • Запуск: «Поделиться» из других приложений (share_target → ?share_title / share_text / share_url → общий чат или другу),
//    ссылки web+denchik:… (?proto=), ярлыки и ссылки в уже открытом окне (launch_handler focus-existing → launchQueue).
//  • Обновления: новая версия sw.js ждёт → «✨ Доступна новая версия — Обновить» (SKIP_WAITING → перезагрузка). Игры без
//    интернета: установленному приложению файлы игр OFFLINE_GAMES уходят в кэш sw.js — один раз на GAMES_VER.
//  • Сборка для Google Play (TWA, ?app=play): html.app-play — покупки скрыты (правила Play о цифровых товарах), docs/APPS.md.
// D37App.install(откуда) / guide() / state() / standalone() / settingsRow() / toast(текст); _test — для scripts/pwa-test.cjs.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37App) return;
  const doc = root.document, nav = root.navigator || {};
  const loc = () => root.location || { href: '', hash: '', search: '', pathname: '/', origin: '' };
  const VER = '1';                 // js/features/app-guide.js?v=VER — поменял инструкцию, подними
  const LS = 'd37_app';            // { v: заходов, first, last, n: показов карточки, sv: на каком заходе, x: закрыта, inst, nb: без значка, ao: запусков приложения }
  const SS_VISIT = 'd37_app_v', SS_SRC = 'd37_app_src', SS_OPEN = 'd37_app_open';
  const ORIGIN = 'https://dan4ik37.vercel.app';
  // Игры, которым не нужен интернет (бот, свои правила, всё в браузере) — их файлы приложение держит в кэше
  const OFFLINE_GAMES = ['sudoku', '2048', 'kosynka', 'freecell', 'pauk', 'blocks', 'miner', 'mahjong', 'snake', 'memory', 'reaction', 'ttt', 'checkers', 'chess', 'sea', 'words', 'catch'];
  const now = () => Date.now();
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const ssGet = k => { try { return root.sessionStorage ? root.sessionStorage.getItem(k) : null; } catch (e) { return null; } };
  const ssSet = (k, v) => { try { if (root.sessionStorage) root.sessionStorage.setItem(k, String(v)); } catch (e) {} };
  const mm = q => { try { return !!root.matchMedia && root.matchMedia(q).matches; } catch (e) { return false; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = () => { try { const v = JSON.parse(lsGet(LS) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  let st = read();
  const save = () => lsSet(LS, JSON.stringify(st));
  // Статистика: Vercel Analytics (события) и цель Метрики — только «откуда нажали», ОС и браузер
  function track(name, data){
    try { if (typeof root.va === 'function') root.va('event', data ? { name, data } : { name }); } catch (e) {}
    try { if (name === 'app_installed' && typeof root.ym === 'function') root.ym(113596397, 'reachGoal', 'app_installed'); } catch (e) {}
  }

  // ═══ Где открыт сайт (только чтобы показать нужную инструкцию) ═══
  // ua — строка браузера; o: { platform, touch } (iPadOS притворяется Mac). → { os, br, ios, ios26, mobile, inapp, how }
  // how: android · android-firefox · ios · ios-other · desktop-chrome · desktop-edge · desktop-yandex · firefox-win ·
  //      firefox-no · mac-safari · inapp · none — ключ шагов в app-guide.js
  function detect(ua, o = {}){
    ua = String(ua || '');
    const ipadMac = o.platform === 'MacIntel' && (o.touch || 0) > 1;
    const os = /iPhone|iPod/.test(ua) ? 'ios' : /iPad/.test(ua) || ipadMac ? 'ipad' : /Android/i.test(ua) ? 'android'
      : /CrOS/.test(ua) ? 'chromeos' : /Windows/.test(ua) ? 'windows' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other';
    const br = /YaBrowser|YaSearchBrowser/.test(ua) ? 'yandex' : /SamsungBrowser/.test(ua) ? 'samsung' : /EdgA?\/|EdgiOS|Edg\//.test(ua) ? 'edge'
      : /OPR\/|OPiOS|OPT\/|Opera/.test(ua) ? 'opera' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /CriOS|Chrome\/|Chromium/.test(ua) ? 'chrome'
      : /Safari\//.test(ua) ? 'safari' : 'other';
    const ios = os === 'ios' || os === 'ipad';
    // встроенный просмотр в приложении (Telegram, ВКонтакте, Instagram…): кнопки «Установить» там нет
    const inapp = /; wv\)|FBAN|FBAV|Instagram|VKAndroidApp|VKClient|vkontakte|OKApp|Telegram|MicroMessenger|\bLine\/|YaApp_|GSA\//i.test(ua) || (ios && !/Safari\//.test(ua));
    const ios26 = ios && br === 'safari' && +((/Version\/(\d+)/.exec(ua) || [])[1] || 0) >= 26;
    let how;
    if (inapp) how = 'inapp';
    else if (ios) how = br === 'safari' ? 'ios' : 'ios-other';
    else if (os === 'android') how = br === 'firefox' ? 'android-firefox' : 'android';
    else if (br === 'firefox') how = os === 'windows' ? 'firefox-win' : 'firefox-no';
    else if (br === 'safari') how = os === 'mac' ? 'mac-safari' : 'none';
    else if (br === 'edge') how = 'desktop-edge';
    else if (br === 'yandex') how = 'desktop-yandex';
    else if (br === 'chrome') how = 'desktop-chrome';
    else how = 'none';
    return { os, br, ios, ios26, mobile: ios || os === 'android', inapp, how };
  }
  const ENV = detect(nav.userAgent, { platform: nav.platform, touch: nav.maxTouchPoints });

  // Окно приложения? (а не вкладка). Считаем один раз при загрузке: полный экран игры потом меняет display-mode на fullscreen
  const DM = ['standalone', 'window-controls-overlay', 'minimal-ui'];
  const SA = DM.some(m => mm(`(display-mode: ${m})`)) || nav.standalone === true;
  // Откуда запущено: ?app=play | rustore | ms — сборка для магазина (startUrl в apps/), android-app://<пакет> — приложение
  // Android (TWA; пакет app.vercel.dan4ik37.twa — Google Play, ….rustore — RuStore). Запоминаем до конца сеанса (sessionStorage:
  // у TWA хранилище общее с Chrome — localStorage спрятал бы магазин и в обычном браузере)
  const srcOf = (app, ref) => {
    if (app && /^(play|rustore|ms|twa)$/.test(app)) return app;
    const m = /^android-app:\/\/([\w.]+)/.exec(ref || '');
    if (!m) return '';
    return /\.rustore$/.test(m[1]) ? 'rustore' : /^app\.vercel\.dan4ik37\./.test(m[1]) ? 'play' : 'twa';
  };
  const bootHref = loc().href;
  (() => {
    let q = null; try { q = new URLSearchParams(loc().search || ''); } catch (e) {}
    const s = srcOf(q?.get('app'), doc?.referrer);
    if (s && (q?.get('app') || !ssGet(SS_SRC))) ssSet(SS_SRC, s);
  })();
  const SRC = ssGet(SS_SRC) || '';

  // ═══ Разовая карточка «Установи приложение» ═══
  // С 3-го захода, когда человек уже что-то нажимал и смотрит сайт ≥ 25 с; не в тот заход, когда было окошко возраста; не поверх
  // игры, окон, звонка. Показов — не больше 2 (второй — если первый не заметили, через 3 захода); ✕ или «Установить» — больше никогда.
  function cardDue(s, env){
    if (!env || env.standalone || env.installed || s.inst || s.x) return false;
    if (!env.can) return false;
    if ((s.v || 0) < 3) return false;
    if ((s.n || 0) >= 2) return false;
    if (s.n && (s.v || 0) - (s.sv || 0) < 3) return false;
    if (env.ageSession || env.busy || env.hidden) return false;
    if ((env.sinceLoad || 0) < 25e3 || !env.touched) return false;
    return true;
  }
  // Можно ли поставить «в одно-два касания»: кнопка браузера или телефон с понятными шагами (для карточки; меню — всегда)
  const easyHow = h => ['ios', 'ios-other', 'android', 'android-firefox'].includes(h);

  // ═══ Значок на иконке: ЛС + пропущенные звонки + 🔔 ═══
  const badgeCount = c => Math.max(0, (+c.msgs || 0) + (+c.calls || 0) + (+c.notif || 0));

  // ═══ «Поделиться» из другого приложения → текст сообщения ═══
  // p: { title, text, url } (что прислала система) → одна строка-сообщение (без управляющих символов, до 1000 знаков)
  function shareText(p){
    const clean = s => Array.from(String(s || '')).filter(c => c === '\n' || c.charCodeAt(0) >= 32).join('').trim();
    const text = clean(p?.text), title = clean(p?.title);
    let url = clean(p?.url);
    if (url && !/^https?:\/\/\S+$/i.test(url)) url = '';
    const parts = [];
    if (title && !text.includes(title) && title !== url) parts.push(title);
    if (text) parts.push(text);
    if (url && !text.includes(url)) parts.push(url);
    return parts.join('\n').slice(0, 1000);
  }

  // ═══ Ссылки web+denchik:<путь> → адрес на сайте (только свои разделы; что не узнали — главная) ═══
  const HASH_ROOTS = /^(chat|games|phone|profile|forum|shop|home|ideas|lfg|shorts|donate)$/;
  function protoTarget(raw){
    let s = String(raw || '');
    try { s = decodeURIComponent(s); } catch (e) {}
    s = s.trim().replace(/^web\+(?:denchik|dan4ik37):/i, '').replace(/^\/+/, '').split(/[?#]/)[0].replace(/\/+$/, '');
    let m;
    if ((m = /^c\/([a-z0-9]{4,16})$/i.exec(s))) return '/#/chat/join/' + m[1].toLowerCase();
    if ((m = /^g\/([A-Za-z0-9]{4,16})$/.exec(s))) return '/g/' + m[1];
    if ((m = /^v\/([A-Za-z0-9_-]{11})$/.exec(s))) return '/v/' + m[1];
    if ((m = /^call\/([a-z0-9]{8,16})$/.exec(s))) return '/#/phone/call/' + m[1];
    if (s === 'world') return '/#/games/world';
    const seg = s.split('/');
    if (HASH_ROOTS.test(seg[0]) && seg.length <= 5 && seg.slice(1).every(x => /^[A-Za-z0-9_-]{1,40}$/.test(x))) return '/#/' + s;
    return '/#/home';
  }

  // ═══ Адрес запуска (ярлык, «Поделиться», web+denchik:, ссылка в уже открытом окне) → что сделать ═══
  // → { share: {title, text, url} } | { go: '#/…' } | { open: '/путь' } | { focus: true } (просто показать окно) | null (чужой адрес)
  function launchAction(href, origin){
    let u; try { u = new URL(href, origin || ORIGIN); } catch (e) { return null; }
    if (origin && u.origin !== origin) return null;
    const q = u.searchParams;
    if (q.has('share_title') || q.has('share_text') || q.has('share_url')) return { share: { title: q.get('share_title') || '', text: q.get('share_text') || '', url: q.get('share_url') || '' } };
    if (q.has('proto')) { const t = protoTarget(q.get('proto')); return t.startsWith('/#') ? { go: t.slice(1) } : { open: t }; }
    if (u.pathname === '/' || u.pathname === '/index.html') return u.hash && u.hash.length > 2 ? { go: u.hash } : { focus: true };
    return { open: u.pathname + u.search + u.hash };
  }

  // ─────────── дальше — только в браузере ───────────
  const pub = {
    standalone: () => SA, source: () => SRC, env: () => ENV,
    state: () => Object.assign({}, st, { standalone: SA, prompt: !!bip, src: SRC, how: ENV.how }),
    _test: { detect, cardDue, easyHow, badgeCount, shareText, protoTarget, launchAction, srcOf, OFFLINE_GAMES },
  };
  root.D37App = pub;
  let bip = null;
  if (!doc || !doc.addEventListener) return;
  const html = doc.documentElement;
  const t0 = now();
  let touched = false;

  // ── Классы окна приложения ──
  if (SA) html.classList.add('app-standalone', ENV.ios ? 'app-ios' : ENV.os === 'android' ? 'app-android' : 'app-desktop');
  if (SRC === 'play') html.classList.add('app-play');
  if (SA) {
    // полоса окна / строка состояния — цвета шапки сайта (в браузере остаётся фирменная розовая)
    const m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#09090f');
  }

  // ── Заходы (вкладка браузера) и запуски приложения ──
  if (!SA && !ssGet(SS_VISIT)) { ssSet(SS_VISIT, 1); st.v = (st.v || 0) + 1; st.first = st.first || now(); st.last = now(); save(); }
  if (SA && !ssGet(SS_OPEN)) {
    ssSet(SS_OPEN, 1); st.ao = (st.ao || 0) + 1; if (!st.inst) st.inst = 1; save();
    track('app_open', { mode: mm('(display-mode: window-controls-overlay)') ? 'wco' : 'standalone', os: ENV.os, src: SRC || 'pwa' });
  }

  // ═══ Тост ═══
  let toastT = 0;
  function toast(text, ms = 4200){
    let t = doc.getElementById('appToast');
    if (!t) { t = doc.createElement('div'); t.id = 'appToast'; t.className = 'apt'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); doc.body.appendChild(t); }
    t.textContent = text;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
  }
  pub.toast = toast;

  // ═══ Установка ═══
  root.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();      // вместо полоски браузера — своя карточка, вовремя
    bip = e;
    if (st.inst && !SA) { st.inst = 0; save(); }   // браузер снова предлагает — значит, приложение удалили
    sync();
    root.D37AppGuide?.refresh?.();
  });
  root.addEventListener('appinstalled', () => {
    st.inst = 1; st.x = 1; save(); bip = null;
    hideCard(); root.D37AppGuide?.close?.(); sync();
    track('app_installed', { os: ENV.os, br: ENV.br });
    toast(ENV.mobile ? '🎉 Готово! Значок dan4ik37 — на экране телефона' : '🎉 Готово! dan4ik37 — в меню «Пуск» и на рабочем столе', 6500);
  });
  // уже установлено? (Chrome / Edge на Android и ПК; related_applications в manifest.json указывает на себя)
  function checkRelated(){
    if (SA || !nav.getInstalledRelatedApps) return;
    try { nav.getInstalledRelatedApps().then(list => { if ((list || []).some(a => a.platform === 'webapp') && !st.inst) { st.inst = 1; save(); sync(); } }).catch(() => {}); } catch (e) {}
  }

  async function install(from){
    track('app_install_click', { from: from || 'button', how: bip ? 'prompt' : ENV.how });
    st.x = 1; save(); hideCard();      // про приложение знает — карточка больше не нужна
    if (bip) {
      const e = bip; bip = null;
      try {
        await e.prompt();
        const r = await e.userChoice;
        track(r && r.outcome === 'accepted' ? 'app_install_accept' : 'app_install_dismiss', { from: from || 'button', os: ENV.os });
      } catch (er) { guide(); }
      sync();
      return;
    }
    guide();
  }
  // Инструкция по шагам (js/features/app-guide.js — грузится при первом открытии)
  let guideP = null;
  function loadGuide(){
    if (root.D37AppGuide) return Promise.resolve(root.D37AppGuide);
    if (guideP) return guideP;
    guideP = new Promise((res, rej) => {
      const s = doc.createElement('script');
      s.src = '/js/features/app-guide.js?v=' + VER;
      s.onload = () => (root.D37AppGuide ? res(root.D37AppGuide) : rej(new Error('guide')));
      s.onerror = () => { guideP = null; rej(new Error('guide')); };
      doc.head.appendChild(s);
    });
    return guideP;
  }
  function guide(how){
    loadGuide().then(G => G.open({ env: ENV, how: how || ENV.how, prompt: () => !!bip, install: () => install('guide'), installed: SA || !!st.inst }))
      .catch(() => toast('Не загрузилось — проверь интернет и нажми ещё раз'));
  }
  pub.install = install; pub.guide = guide;
  root.installPWA = () => install('old');   // старое имя (было в push-pwa.js)

  // Всё с [data-app-install] видно, только пока приложение не установлено
  const canOffer = () => !SA && !st.inst;
  function sync(){
    const on = canOffer();
    doc.querySelectorAll('[data-app-install]').forEach(el => { el.hidden = !on; });
    html.classList.toggle('app-can-install', on);
  }
  pub.sync = sync;

  // ── Пункт в меню «Ещё» (на телефоне — плитка в ☰); в приложении — «⟳ Обновить» ──
  function placeMenu(){
    const links = doc.getElementById('navLinks');
    if (!links || doc.getElementById('navApp')) return;
    const panel = doc.getElementById('navMorePanel') || links;
    const b = doc.createElement('button');
    b.type = 'button'; b.id = 'navApp'; b.className = 'nav-app';
    if (SA) { b.dataset.appAct = 'reload'; b.textContent = '⟳ Обновить страницу'; }
    else { b.dataset.appAct = 'install'; b.dataset.from = 'menu'; b.setAttribute('data-app-install', ''); b.textContent = '📲 Установить приложение'; }
    panel.appendChild(b);
    sync();
  }

  // ── ⚙️ Настройки → Сайт: строка «📲 Приложение» (settings.js зовёт settingsRow) ──
  function settingsRow(){
    const lbl = (t, s) => `<div class="gs-lbl"><b>📲 Приложение</b><small>${s}</small></div><div class="gs-ctl">${t}</div>`;
    let body;
    if (SA) {
      body = lbl(`<button type="button" class="gs-btn${st.nb ? ' primary' : ''}" data-app-act="badge">${st.nb ? '🔴 Включить счётчик' : '✅ Счётчик включён — выключить'}</button>`,
        'Ты в приложении. Число на значке — непрочитанные сообщения, пропущенные звонки и уведомления.');
    } else if (st.inst) {
      body = lbl('<span class="age-set-y">✅ Установлено</span>', 'Открывай dan4ik37 значком на рабочем столе или экране телефона — своё окно, без вкладок.');
    } else {
      body = lbl(`<button type="button" class="gs-btn primary" data-app-act="install" data-from="settings">📲 Установить</button>`,
        'Сайт как программа: своё окно без вкладок, значок на экране, уведомления, игры без интернета. Бесплатно, места почти не занимает.');
    }
    return `<div class="gs-row app-srow">${body}</div>`;
  }
  pub.settingsRow = settingsRow;

  // ═══ Карточка ═══
  function cardEnv(){
    const b = doc.body;
    const busy = !b || b.classList.contains('game-on') || html.classList.contains('gs-full') || html.classList.contains('gs-set-open') || html.classList.contains('ph-open')
      || !!doc.querySelector('.age-sheet, #appSheet, #appShare, #globalAuthModal.open, #modal.open, #confirmModal.open, #privacyModal.open, #cmdPalette.open, #perfPopup.show, .s3, .wld-edit')
      || !!root.D37Calls?.inCall?.();
    return { standalone: SA, installed: !!st.inst, can: !!bip || easyHow(ENV.how), ageSession: !!ssGet('d37_age_seen'), busy, hidden: doc.visibilityState === 'hidden', sinceLoad: now() - t0, touched };
  }
  let cardT = 0;
  function maybeCard(delay){
    clearTimeout(cardT);
    cardT = setTimeout(() => { if (cardDue(st, cardEnv())) showCard(); }, delay == null ? 1500 : delay);
  }
  function showCard(){
    if (doc.getElementById('appCard')) return;
    st.n = (st.n || 0) + 1; st.sv = st.v || 0; save();
    const c = doc.createElement('div');
    c.id = 'appCard'; c.className = 'apc'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-labelledby', 'apcT');
    c.innerHTML = `<img class="apc-i" src="/icon-192.png" alt="" width="48" height="48">
      <div class="apc-t"><b id="apcT">Приложение dan4ik37</b><span>${ENV.mobile ? 'Значок на экране, уведомления, игры без интернета' : 'Своё окно без вкладок, значок на панели задач'}</span></div>
      <button type="button" class="apc-go" data-app-act="install" data-from="card">Установить</button>
      <button type="button" class="apc-x" data-app-card="x" aria-label="Не сейчас" title="Не сейчас">✕</button>`;
    doc.body.appendChild(c);
    requestAnimationFrame(() => c.classList.add('on'));
    track('app_card_show', { os: ENV.os, how: bip ? 'prompt' : ENV.how });
  }
  function hideCard(acted){
    const c = doc.getElementById('appCard');
    if (acted && c) { st.x = 1; save(); }
    if (!c) return;
    c.classList.remove('on'); setTimeout(() => c.remove(), 260);
  }

  // ═══ Значок на иконке ═══
  const cnt = { msgs: 0, calls: 0, notif: 0 };
  let badgeT = 0, badgeLast = -1;
  function badgeApply(force){
    const P = root.D37Phone;
    if (P?.badge) cnt.calls = P.badge('calls') || 0;     // пропущенные — в телефоне (d37_missed)
    const n = st.nb ? 0 : badgeCount(cnt);
    if (n === badgeLast && !force) return;
    badgeLast = n;
    try {
      if (!nav.setAppBadge) return;
      const p = n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge ? nav.clearAppBadge() : nav.setAppBadge(0);
      p?.catch?.(() => {});
    } catch (e) {}
  }
  const badgeSoon = () => { clearTimeout(badgeT); badgeT = setTimeout(badgeApply, 250); };
  root.addEventListener('d37:dm-unread', e => { cnt.msgs = +e.detail || 0; badgeSoon(); });
  root.addEventListener('d37:notif', e => { cnt.notif = +e.detail || 0; badgeSoon(); });
  root.addEventListener('d37:badges', e => { const d = e.detail || {}; for (const k of ['msgs', 'calls', 'notif']) if (k in d) cnt[k] = +d[k] || 0; badgeSoon(); });
  root.addEventListener('d37:callstate', badgeSoon);
  root.addEventListener('d37:hand', badgeSoon);
  root.addEventListener('d37:auth', () => { if (!(typeof currentUser !== 'undefined' && currentUser)) { cnt.msgs = 0; cnt.notif = 0; } badgeSoon(); });
  pub.badge = () => (st.nb ? 0 : badgeCount(cnt));

  // ═══ Окно приложения на ПК: шапка сайта — заголовок окна (window-controls-overlay) ═══
  function wco(){
    const o = nav.windowControlsOverlay;
    const upd = () => {
      const on = !!o?.visible;
      html.classList.toggle('app-wco', on);
      let r = null; if (on) try { r = o.getTitlebarAreaRect(); } catch (e) {}
      const W = root.innerWidth || html.clientWidth || 0;
      html.style.setProperty('--app-tb-l', (r && r.width ? Math.max(0, Math.round(r.x)) : 0) + 'px');
      html.style.setProperty('--app-tb-r', (r && r.width ? Math.max(0, Math.round(W - r.x - r.width)) : 0) + 'px');
      html.style.setProperty('--app-tb-h', (r && r.width ? Math.round(r.height) : 0) + 'px');
      requestAnimationFrame(fitNav);
      setTimeout(() => requestAnimationFrame(fitNav), 450);   // ещё раз — когда шапка точно перестроилась
    };
    try { o?.addEventListener('geometrychange', upd); } catch (e) {}
    let t = 0;
    root.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(upd, 150); });
    upd();
    if (doc.fonts?.ready) doc.fonts.ready.then(() => requestAnimationFrame(fitNav));
  }
  // В окне программы шапке тесно (окно уже экрана, справа — кнопки окна): лишние пункты уезжают в «Ещё ▾». Только в окне
  // приложения на ПК — вкладку браузера не трогаем
  const SPARE = ['shorts', 'forum', 'ideas', 'profile', 'world'];
  const moved = [];   // [пункт, сосед справа до переноса] — окно расширили / шрифты догрузились: вернуть и разложить заново
  function fitNav(){
    if (!SA || ENV.mobile) return;
    const bar = doc.getElementById('nav'), links = doc.getElementById('navLinks'), panel = doc.getElementById('navMorePanel');
    if (!bar || !links || !panel) return;
    while (moved.length) { const [a, next] = moved.pop(); links.insertBefore(a, next && next.parentNode === links ? next : links.querySelector(':scope > .nav-more')); }
    if ((root.innerWidth || 0) <= 1180) return;
    const limit = (root.innerWidth || 0) - (parseFloat(html.style.getPropertyValue('--app-tb-r')) || 0) - 6;
    const right = () => Math.max(0, ...[...bar.children].filter(c => c.offsetParent && c.getBoundingClientRect().width).map(c => c.getBoundingClientRect().right));
    for (const r of SPARE) {
      if (right() <= limit) break;
      const a = links.querySelector(`:scope > a[data-route="${r}"]`);
      if (a) { moved.push([a, a.nextSibling]); panel.insertBefore(a, panel.firstChild); }
    }
  }

  // ═══ «Назад» на Android в приложении: закрыть открытое окно сайта, а не уйти со страницы ═══
  // Окно открыли нажатием → своя запись в истории (тот же адрес); «Назад» её снимает → закрываем окно. Закрыли сами (✕, Esc)
  // → запись убираем history.back(). Меню ☰ сюда не входит: из него уходят по ссылке, а при переходе роутер закрывает его сам.
  const disp = el => !!el && (root.getComputedStyle ? root.getComputedStyle(el).display !== 'none' : !el.hidden);
  const OVERLAYS = [
    () => doc.getElementById('appSheet') && (() => root.D37AppGuide?.close?.()),
    () => doc.getElementById('appShare') && closeShare,
    () => root.D37Phone?.isOpen?.() && !root.D37Phone.isDocked?.() && (() => root.D37Phone.close()),
    () => (doc.querySelector('#cmdPalette.open, #modal.open, #confirmModal.open, #privacyModal.open') || disp(doc.getElementById('globalAuthModal'))
      || disp(doc.getElementById('settingsAdminModal')) || disp(doc.getElementById('pollAdminModal'))) && (() => root.closeAnyOpenModal?.()),
    () => root.D37Settings?.isOpen?.() && (() => root.D37Settings.close()),
  ];
  const topOverlay = () => { for (const f of OVERLAYS) { let c = null; try { c = f(); } catch (e) {} if (c) return c; } return null; };
  let backTok = 0, backSeq = 0, ignorePop = 0;
  const foreignState = s => !!s && typeof s === 'object' && (s.gsFull || s.mp);   // полный экран игры, «игра поверх мира» — у них своё «Назад»
  function backSync(){
    const h = root.history; if (!h?.pushState) return;
    const open = !!topOverlay();
    if (open && !backTok && !foreignState(h.state)) {
      backTok = ++backSeq;
      try { h.pushState({ d37back: backTok }, '', loc().href); } catch (e) { backTok = 0; }
    } else if (!open && backTok) {
      // поверх нашей записи уже чужая (полный экран игры копирует состояние) — её не трогаем, наша останется позади
      if (h.state?.d37back === backTok && !foreignState(h.state)) { ignorePop++; try { h.back(); } catch (e) { ignorePop--; } }
      backTok = 0;
    }
  }
  function backPop(){
    if (ignorePop > 0) { ignorePop--; return; }
    const s = root.history.state;
    if (backTok && s?.d37back !== backTok) {
      backTok = 0;
      const close = topOverlay();
      if (close) { try { close(); } catch (e) {} }
    }
    // запись, оставшуюся позади перехода, не «проскакиваем» сами: чужой history.back() (полный экран игры) ушёл бы со страницы
  }
  function backArm(){
    if (!SA || !ENV.mobile) return;
    const later = () => setTimeout(backSync, 0);
    doc.addEventListener('click', later, true);
    doc.addEventListener('keyup', later, true);
    root.addEventListener('hashchange', later);
    root.addEventListener('popstate', backPop);
  }

  // ═══ Запуск: «Поделиться», web+denchik:, ярлыки ═══
  function takeLaunch(){
    const a = launchAction(bootHref, loc().origin);
    let q = null; try { q = new URLSearchParams(loc().search || ''); } catch (e) {}
    const special = !!q && (q.has('app') || q.has('proto') || !!a?.share);
    if (special) {
      // служебные параметры — прочь из адреса (закладки, «скопировать ссылку», Метрика)
      const keep = new URLSearchParams(); q.forEach((v, k) => { if (!/^(app|proto|share_title|share_text|share_url)$/.test(k)) keep.set(k, v); });
      const rest = keep.toString();
      try { root.history.replaceState(root.history.state, '', '/' + (rest ? '?' + rest : '') + (loc().hash || '')); } catch (e) {}
    }
    if (a?.share) setTimeout(() => shareSheet(a.share), 400);
    else if (q?.has('proto')) { if (a?.go) { if (loc().hash !== a.go) loc().hash = a.go; } else if (a?.open) loc().assign(a.open); }
  }
  function launchQ(){
    const L = root.launchQueue; if (!L?.setConsumer) return;
    let first = true;
    L.setConsumer(p => {
      const url = p?.targetURL; if (!url) return;
      if (first) { first = false; if (url === bootHref) return; }   // этот адрес уже открыт при загрузке
      const a = launchAction(url, loc().origin); if (!a) return;
      // в уже открытом окне — без перезагрузки: звонок, чат и мир не рвутся
      if (a.share) shareSheet(a.share);
      else if (a.go) { if (loc().hash !== a.go) loc().hash = a.go; }
      else if (a.open) loc().assign(a.open);
      try { root.focus(); } catch (e) {}
    });
  }
  // #/app — инструкция (ссылка для соцсетей); роутер такого раздела не знает и показывает главную
  function hashApp(){
    if (!/^#\/app\/?$/.test(loc().hash || '')) return;
    try { root.history.replaceState(root.history.state, '', '#/home'); } catch (e) {}
    if (SA) toast('✅ Ты уже в приложении dan4ik37'); else setTimeout(() => guide(), 300);
    track('app_link_open', { how: ENV.how });
  }

  // ── Окошко «Поделиться на dan4ik37» ──
  function closeShare(){ doc.getElementById('appShare')?.remove(); }
  function shareSheet(p){
    const text = shareText(p); if (!text) return;
    closeShare();
    const s = doc.createElement('div');
    s.id = 'appShare'; s.className = 'aps aps-share'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'apShT');
    s.innerHTML = `<div class="aps-box">
      <button type="button" class="aps-x" data-share="x" aria-label="Закрыть">✕</button>
      <div class="aps-h" id="apShT">📤 Поделиться на dan4ik37</div>
      <blockquote class="aps-q">${esc(text).replace(/\n/g, '<br>')}</blockquote>
      <div class="aps-acts">
        <button type="button" class="aps-go" data-share="chat">💬 В общий чат</button>
        <button type="button" class="aps-go ghost" data-share="dm">✉️ Другу в личку</button>
        <button type="button" class="aps-go ghost" data-share="copy">📋 Скопировать</button>
      </div>
      <small class="aps-small">Сообщение не уйдёт само — проверишь и нажмёшь «Отправить».</small>
    </div>`;
    doc.body.appendChild(s);
    s.addEventListener('click', ev => {
      if (ev.target === s) { closeShare(); return; }
      const b = ev.target.closest?.('[data-share]'); if (!b) return;
      const k = b.dataset.share;
      closeShare();
      if (k === 'chat') { if (!/^#\/chat(\/|$)/.test(loc().hash || '')) loc().hash = '#/chat'; fillComposer('#chat .mv-in', text, 120e3, '#chat .mv-gate'); }
      else if (k === 'dm') {
        const authed = typeof currentUser !== 'undefined' && !!currentUser;
        if (!authed) { copy(text); toast('🔑 Войди в аккаунт — и выбери друга. Текст уже скопирован'); root.openGlobalAuth?.(); return; }
        root.D37Phone?.open?.('msgs');
        toast('✉️ Выбери друга — текст появится в поле сообщения', 5000);
        fillComposer('.ph .mv-in', text, 180e3);
      } else if (k === 'copy') { copy(text); toast('📋 Скопировано'); }
    });
    s.querySelector('[data-share="chat"]')?.focus?.();
    track('app_share_in', {});
  }
  function copy(text){ try { nav.clipboard?.writeText?.(text)?.catch?.(() => {}); } catch (e) {} }
  // Вставить текст в поле сообщения, как только оно появится (чат грузится, друга ещё выбирают, гость ещё не вошёл).
  // Не появилось за wait — скопировать. gate — «Войти как гость / в аккаунт» вместо поля: подсказать один раз
  function fillComposer(sel, text, wait, gate){
    let done = false, mo = null, t = 0, hinted = false;
    const tryFill = () => {
      if (gate && !hinted) { const g = doc.querySelector(gate); if (g && !g.hidden && g.getClientRects().length) { hinted = true; toast('👤 Нажми «Войти как гость» или войди в аккаунт — текст сам встанет в поле сообщения', 6000); } }
      const el = doc.querySelector(sel);
      if (!el || el.disabled || !el.getClientRects().length) return false;   // нет / выключено / не видно (гость, «обложка»)
      el.value = el.value ? el.value + ' ' + text : text;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
      toast('✍️ Текст в поле сообщения — проверь и отправь');
      return true;
    };
    const stop = () => { done = true; mo?.disconnect(); clearTimeout(t); };
    if (tryFill()) return;
    mo = new MutationObserver(() => { if (!done && tryFill()) stop(); });
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'disabled'] });
    t = setTimeout(() => { if (done) return; stop(); copy(text); toast('📋 Поле сообщения не открылось — текст скопирован, вставь его сам'); }, wait);
  }
  pub.share = shareSheet;

  // ═══ Сборка для Google Play: цифровые товары в приложении из Play — только через Google Play Billing ═══
  root.addEventListener('hashchange', () => {
    if (SRC === 'play' && /^#\/shop(\/|$)/.test(loc().hash || '')) { try { loc().replace('#/home'); } catch (e) {} toast('💎 Магазин недоступен в этой версии приложения'); }
  });

  // ═══ Service Worker (sw.js): регистрация, «Доступна новая версия», игры без интернета ═══
  let reg = null, swWaiting = null, wantReload = false, reloading = false, updLater = false, lastCheck = now();
  const swOk = () => 'serviceWorker' in nav && root.isSecureContext !== false;
  function swInit(){
    if (!swOk()) return;
    const go = () => nav.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(r => {
      reg = r;
      if (r.waiting && nav.serviceWorker.controller) waiting(r.waiting);
      r.addEventListener('updatefound', () => {
        const w = r.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && nav.serviceWorker.controller) waiting(w); });
      });
      offlineGames();
    }).catch(() => {});
    if (doc.readyState === 'complete') go(); else root.addEventListener('load', go);
    nav.serviceWorker.addEventListener('controllerchange', () => { if (!wantReload || reloading) return; reloading = true; loc().reload(); });
    nav.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'CACHED' && e.data.n) console.info('[app] офлайн-файлов в кэше:', e.data.n); });
    // окно приложения открыто днями — проверять обновление, когда к нему вернулись (не чаще раза в 6 ч)
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState !== 'visible') return;
      if (reg && now() - lastCheck > 6 * 3600e3) { lastCheck = now(); try { reg.update().catch(() => {}); } catch (e) {} }
      if (swWaiting && updLater) waiting(swWaiting);
    });
  }
  // новая версия ждёт: не поверх игры и звонка — тогда после
  function waiting(w){
    setTimeout(() => {
      if (!reg || reg.waiting !== w) return;        // сразу встала сама (переход со старого sw.js) — сообщать нечего
      swWaiting = w;
      const b = doc.body;
      if (!b || b.classList.contains('game-on') || html.classList.contains('gs-full') || root.D37Calls?.inCall?.()) { updLater = true; return; }
      updLater = false;
      if (doc.getElementById('appUpdate') || ssGet('d37_app_updx')) return;
      const t = doc.createElement('div');
      t.id = 'appUpdate'; t.className = 'apu'; t.setAttribute('role', 'status');
      t.innerHTML = `<span>✨ Доступна новая версия сайта</span><button type="button" class="apu-go" data-upd="go">Обновить</button><button type="button" class="apu-x" data-upd="x" aria-label="Позже" title="Позже">✕</button>`;
      doc.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add('on'));
      t.addEventListener('click', ev => {
        const k = ev.target.closest?.('[data-upd]')?.dataset.upd; if (!k) return;
        if (k === 'x') { ssSet('d37_app_updx', 1); t.remove(); return; }
        wantReload = true;
        t.querySelector('span').textContent = '⏳ Обновляем…';
        try { (reg.waiting || swWaiting).postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
        setTimeout(() => { if (!reloading) { reloading = true; loc().reload(); } }, 4000);   // ответа нет — всё равно перезагрузить
        track('app_update', {});
      });
    }, 800);
  }
  root.addEventListener('hashchange', () => { if (swWaiting && updLater) waiting(swWaiting); });
  // установленное приложение: файлы игр без интернета — в кэш (один раз на GAMES_VER)
  function offlineGames(){
    if (!SA || !reg || typeof GAMES === 'undefined' || typeof GAMES_VER === 'undefined') return;
    const key = GAMES_VER + ':' + OFFLINE_GAMES.length;
    if (lsGet('d37_app_off') === key) return;
    setTimeout(() => {
      const w = reg.active; if (!w) return;
      const urls = new Set();
      // общее для всех игр (games.js грузит его раньше файла игры; без него игра не откроется) и тексты «📖 Правила»
      const kit = typeof GAMES_KIT !== 'undefined' ? GAMES_KIT : 'js/games/gamekit.js';
      for (const s of [kit, 'js/games/rules-data.js']) urls.add('/' + s + '?v=' + GAMES_VER);
      for (const id of OFFLINE_GAMES) {
        const g = GAMES.find(x => x.id === id);
        for (const s of g?.scripts || []) urls.add('/' + String(s).replace(/^\/+/, '') + '?v=' + GAMES_VER);
      }
      try { w.postMessage({ type: 'CACHE_URLS', urls: [...urls] }); lsSet('d37_app_off', key); } catch (e) {}
    }, 20e3);   // не мешаем загрузке сайта
  }

  // ═══ Нажатия ═══
  doc.addEventListener('click', e => {
    touched = true;
    const x = e.target?.closest?.('[data-app-card="x"]');
    if (x) { hideCard(true); track('app_card_close', {}); return; }
    const b = e.target?.closest?.('[data-app-act]'); if (!b) return;
    const act = b.dataset.appAct;
    if (act === 'install') {
      e.preventDefault();
      if (doc.getElementById('navLinks')?.classList.contains('open')) root.toggleNav?.();
      install(b.dataset.from || 'button');
    } else if (act === 'reload') { loc().reload(); }
    else if (act === 'badge') { st.nb = st.nb ? 0 : 1; save(); badgeApply(true); root.D37Settings?.refresh?.(); }
  });
  doc.addEventListener('keydown', () => { touched = true; }, { once: true });

  // ═══ Запуск ═══
  const boot = () => {
    placeMenu(); sync(); checkRelated(); wco(); backArm(); takeLaunch(); launchQ(); hashApp();
    badgeApply(true);
    if (!SA) maybeCard(26e3);
  };
  swInit();
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  root.addEventListener('hashchange', () => { hashApp(); if (!SA) maybeCard(2500); });
  doc.addEventListener('visibilitychange', () => { if (!SA && doc.visibilityState === 'visible') maybeCard(4000); });
  root.addEventListener('d37:fullscreen', e => { if (e.detail?.on) hideCard(); });
})();
