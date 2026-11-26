// ═══════════════════════════════════════
//  «СНАЧАЛА ДЕЙСТВИЕ — ПОТОМ ВХОД» (D37Intent) и короткий первый вход нового аккаунта (D37Welcome)
// ═══════════════════════════════════════
// Владелец 25.11.2026: «вход через гугл и другие платформы, чтобы люди могли ставить нормально лайк и смотреть видео и стримы».
// Гость нажал ❤ / «Следить» / «Написать» → D37Intent.need(kind, args, { label }) запоминает, ЧТО он хотел и ГДЕ был (адрес раздела,
// прокрутка, открытый ролик и секунда, раскрытый плеер Twitch), и открывает ОДНО окно входа (global-auth.js, кнопки — social-login.js).
// Вошёл (Google и др. — через переход на сервис и обратно; почта — без перехода) → новый аккаунт через сервис сначала проходит
// D37Welcome (год рождения — разделение детей и взрослых держится; ник — подсказка из имени в сервисе по правилам js/core/nick.js),
// потом: тот же раздел, та же прокрутка, тот же ролик с той же секунды → действие доделывается само (обработчик D37Intent.on(kind, fn)
// регистрирует модуль, который умеет его делать; игры грузятся лениво — ждём обработчик до 25 с). Окно входа открыто «просто так»
// (кнопка «Войти») — тоже запоминаем место: после входа человек остаётся там же (раньше — всегда свой профиль).
// Закрыл окно, не войдя, — задуманное забывается (через секунду: переход на Google окно не закрывает). Место живёт 30 минут, действие — 10.
// Ключи браузера — только свои: d37_intent (localStorage: переход на Google и обратно — новая загрузка страницы), d37_welcome_<id>.
// Откат — AUTH_SOCIAL = false (js/core/config.js): need() просто открывает окно входа, как раньше, ничего не запоминается.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Intent) return;
  const doc = root.document;
  const ON = (() => { try { return typeof AUTH_SOCIAL === 'undefined' || !!AUTH_SOCIAL; } catch (e) { return true; } })();
  const KEY = 'd37_intent', TTL = 30 * 60e3, ACT_TTL = 10 * 60e3, WAIT_HANDLER = 25e3, NEW_MS = 30 * 60e3;
  const KIND_RE = /^[a-z][a-z0-9_]{0,31}$/, YT_RE = /^[A-Za-z0-9_-]{11}$/;
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const me = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); else root.console?.log?.(t); };
  const routeHash = () => (root.D37Route ? root.D37Route.hash() : String(root.location?.hash || '')) || '#/home';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ═══ Секунда ролика: плеер YouTube (enablejsapi=1) сам шлёт currentTime, если его «послушать» — как делает YouTube IFrame API ═══
  const ytTime = new WeakMap();   // contentWindow → последняя секунда
  root.addEventListener?.('message', e => {
    if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(String(e.origin || ''))) return;
    let m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
    const t = m?.info?.currentTime;
    if (typeof t === 'number' && isFinite(t) && e.source) ytTime.set(e.source, t);
  });
  function listen(fr) { try { fr?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) {} }
  // что сейчас смотрит человек → { k: 'yt', id, title, t } | { k: 'tw' } | null
  async function captureMedia() {
    const modal = doc?.getElementById('modal');
    const vid = typeof modalVidId !== 'undefined' ? modalVidId : null;
    if (modal?.classList.contains('open') && YT_RE.test(String(vid || ''))) {
      const fr = doc.querySelector('#mVid iframe');
      if (fr && !ytTime.has(fr.contentWindow)) { listen(fr); await sleep(350); }
      const t = fr ? ytTime.get(fr.contentWindow) : undefined;
      return { k: 'yt', id: vid, title: String(doc.getElementById('mTitle')?.textContent || '').slice(0, 200), t: typeof t === 'number' ? Math.max(0, Math.floor(t)) : 0 };
    }
    if (doc?.getElementById('autoStreamWrap')?.classList.contains('open') && /^#\/(home)?$/.test(routeHash())) return { k: 'tw' };
    return null;
  }
  function restoreMedia(m) {
    if (!m) return;
    if (m.k === 'yt' && YT_RE.test(String(m.id || '')) && typeof openVid === 'function') {
      const open = doc.getElementById('modal')?.classList.contains('open') && typeof modalVidId !== 'undefined' && modalVidId === m.id;
      if (!open) openVid(m.id, String(m.title || ''), '', '', Math.max(0, +m.t || 0));
    } else if (m.k === 'tw' && typeof setTwitchOpen === 'function') setTwitchOpen(true);
  }

  // ═══ Задуманное ═══
  function read() {
    try {
      const o = JSON.parse(lsGet(KEY) || 'null');
      if (!o || typeof o !== 'object' || Date.now() - (+o.at || 0) > TTL || Date.now() < (+o.at || 0) - 60e3) return null;
      // ДЕЙСТВИЕ живёт 10 минут (место — 30): на общем устройстве чужое задуманное «Следить» / ❤ не достанется следующему, кто войдёт
      if (o.kind && Date.now() - (+o.at || 0) > ACT_TTL) { o.kind = null; o.args = null; o.label = ''; }
      return o;
    } catch (e) { return null; }
  }
  const write = o => lsSet(KEY, o ? JSON.stringify(o) : null);
  const clear = () => { write(null); setHead(null); };

  // ═══ Подпись в окне входа: «Войди — и ❤ поставится сам» ═══
  function setHead(label) {
    const head = doc?.querySelector('#gauthLogin .gauth-head');
    if (!head) return;
    let p = doc.getElementById('gauthIntent');
    if (!label) { if (p) p.hidden = true; return; }
    if (!p) { p = doc.createElement('p'); p.id = 'gauthIntent'; p.className = 'gauth-intent'; head.appendChild(p); }
    p.textContent = '👉 ' + label;
    p.hidden = false;
  }

  // → true: уже вошёл, делай сейчас. false: окно входа открыто, после входа сделаем сами (обработчик D37Intent.on(kind))
  async function need(kind, args, o = {}) {
    if (me()) return true;
    if (!ON) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return false; }
    if (!KIND_RE.test(String(kind || ''))) kind = null;
    let a = null;
    try { a = args == null ? null : JSON.parse(JSON.stringify(args)); if (a && JSON.stringify(a).length > 2000) a = null; } catch (e) { a = null; }
    const label = String(o.label || '').slice(0, 80);
    const media = await captureMedia().catch(() => null);
    write({ kind, args: a, label, hash: routeHash(), y: Math.round(root.scrollY || 0), media, at: Date.now() });
    if (typeof openLoginModal === 'function') openLoginModal('login');
    setHead(label || null);
    return false;
  }
  // окно входа открыли «просто так» (кнопка «Войти» и т. п.) — запомнить место (не трогая уже задуманное действие)
  async function remember() {
    if (!ON || me()) return;
    const cur = read();
    if (cur && cur.kind) { setHead(cur.label || null); return; }
    const media = await captureMedia().catch(() => null);
    write({ kind: null, args: null, label: '', hash: routeHash(), y: Math.round(root.scrollY || 0), media, at: Date.now() });
    setHead(null);
  }
  // УЖЕ вошёл, но действие уводит со страницы и обратно (разрешение Google для «👍 Лайк на YouTube» — js/core/ytlike.js): запомнить
  // действие и место так же, как need() гостю; после возврата resume() (страница загрузится заново, вход восстановится) вернёт туда же
  // и вызовет обработчик kind. o.media — ролик и секунда, если их знает вызвавший (плеер мог ещё не сказать свою секунду).
  async function park(kind, args, o = {}) {
    if (!ON || !KIND_RE.test(String(kind || ''))) return false;
    let a = null;
    try { a = args == null ? null : JSON.parse(JSON.stringify(args)); if (a && JSON.stringify(a).length > 2000) a = null; } catch (e) { a = null; }
    let media = await captureMedia().catch(() => null);
    const om = o.media;
    if (om && om.k === 'yt' && YT_RE.test(String(om.id || '')) && (!media || (media.k === 'yt' && media.id === om.id && (+media.t || 0) < (+om.t || 0)))) media = { k: 'yt', id: om.id, title: String(om.title || media?.title || '').slice(0, 200), t: Math.max(0, Math.floor(+om.t || 0)) };
    write({ kind, args: a, label: String(o.label || '').slice(0, 80), hash: routeHash(), y: Math.round(root.scrollY || 0), media, at: Date.now() });
    return true;
  }
  // закрыл окно, не войдя: задуманное забыть (через секунду — уход на Google тоже «закрывает» страницу, но не окно)
  function onClose() {
    if (!ON) return;
    setTimeout(() => { if (!me() && !doc?.getElementById('globalAuthModal')?.classList.contains('open') && !root.D37Login?.pending?.()) clear(); }, 1000);
  }

  // ═══ Обработчики: модуль, который умеет действие, регистрирует его ═══
  const H = new Map();
  function on(kind, fn) { if (KIND_RE.test(String(kind || '')) && typeof fn === 'function') H.set(kind, fn); }
  async function waitHandler(kind) {
    const t0 = Date.now();
    while (!H.has(kind) && Date.now() - t0 < WAIT_HANDLER) await sleep(150);
    return H.get(kind) || null;
  }

  // ═══ Новый аккаунт через сервис? (Google / Discord / Twitch / GitHub — app_metadata.provider; VK / Яндекс / Telegram — почта-заглушка) ═══
  const SOCIAL = ['google', 'discord', 'twitch', 'github'];
  function isSocial(u) {
    if (!u) return false;
    const p = u.app_metadata?.provider;
    return SOCIAL.includes(p) || !!root.D37Login?.isSynthetic?.(u);
  }
  function isNewSocial(u) {
    if (!isSocial(u) || lsGet('d37_welcome_' + u.id)) return false;
    const c = Date.parse(u.created_at || '') || 0;
    return c > 0 && Date.now() - c < NEW_MS;
  }

  // ═══ Вошёл → (первый вход) → то же место → действие ═══
  let running = false;
  async function resume() {
    const u = me();
    if (!ON || !u || running) return;
    const it = read();
    const fresh = isNewSocial(u);
    if (!it && !fresh) return;
    running = true;
    try {
      if (typeof closeGlobalAuth === 'function' && doc?.getElementById('globalAuthModal')?.classList.contains('open')) { try { closeGlobalAuth(); } catch (e) {} }
      if (fresh) await D37Welcome.show(u);
      if (!it) return;
      write(null); setHead(null);
      if (it.hash && routeHash() !== it.hash && root.D37Route) {
        root.D37Route.go(it.hash);
        await sleep(700);
      }
      if (+it.y > 0) { try { root.scrollTo(0, +it.y); } catch (e) {} }
      restoreMedia(it.media);
      if (!it.kind) return;
      const fn = await waitHandler(it.kind);
      if (!fn) { toast('Ты вошёл — нажми ещё раз, чтобы закончить'); return; }
      let r = null;
      try { r = await fn(it.args, { resumed: true, media: it.media || null }); } catch (e) { r = { ok: false }; }
      if (+it.y > 0) { try { root.scrollTo(0, +it.y); } catch (e) {} }   // перерисовка раздела могла сдвинуть страницу
      if (r && r.msg) toast(r.msg);
    } finally { running = false; lastAt = Date.now(); }
  }
  let lastAt = 0;
  const busy = () => running || Date.now() - lastAt < 5000;   // только что вернули человека на место — не уводить в профиль

  // ═══ D37Welcome: короткий первый вход нового аккаунта через сервис — год рождения и ник ═══
  // Год — как везде (D37Age.set: аккаунт → age.sql, гость — браузер); «Не хочу указывать» — правила «возраст не указан» (как у всех
  // без года: 18+ закрыто, с детьми до 13 не общается — решает сервер). Ник — подсказка из имени в сервисе (только имя, без фамилии),
  // проверка D37Nick.check (смайлики можно), запись — как в профиле (profiles.nick; замок ника от админа держит сервер: nick_my_lock —
  // если ник поставил админ, поле не показываем). Показывается один раз на аккаунт (d37_welcome_<id>) и только новому (≤ 30 мин).
  const D37Welcome = (() => {
    let box = null;
    const AUTO_NICK = /^user_[0-9a-f]{6,32}$/i;
    // имя из сервиса → подсказка ника (или '')
    function suggest(u) {
      const m = u?.user_metadata || {};
      const raw = [m.given_name, m.first_name, m.preferred_username, m.user_name, m.nickname, String(m.full_name || m.name || '').split(/\s+/)[0]]
        .map(x => String(x || '').trim()).filter(Boolean);
      for (const r0 of raw) {
        let s = r0.replace(/[^A-Za-zА-Яа-яЁё0-9_. \-©®‼-㊙\u{1F000}-\u{1FAFF}‍️]/gu, '').slice(0, 24).trim();
        if (s && root.D37Nick) { const c = root.D37Nick.check(s, { self: false }); if (c.ok) return c.nick; if (s.length < 2) continue; }
        else if (s.length >= 2) return s;
      }
      return '';
    }
    async function nickLocked() {
      try { const r = await root.D37Phone?.rpc?.('nick_my_lock'); return !!r?.data?.locked; } catch (e) { return false; }
    }
    function close() { if (box) { box.remove(); box = null; } }
    function css() {
      if (!doc?.head || doc.getElementById('d37WelcomeCss')) return;
      const s = doc.createElement('style'); s.id = 'd37WelcomeCss';
      s.textContent = `
.wlc-ov{position:fixed;inset:0;z-index:100650;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem;background:rgba(5,4,10,.82);backdrop-filter:blur(8px)}
.wlc-box{margin:auto 0;width:min(420px,100%);padding:1.2rem 1.1rem 1rem;border-radius:18px;background:var(--card,#15131f);color:var(--text,#f0f0f8);border:1px solid rgba(var(--fg-rgb),.14);box-shadow:0 24px 70px rgba(0,0,0,.55);font-family:Montserrat,system-ui,sans-serif}
.wlc-h{font:800 1.08rem/1.3 Montserrat,system-ui,sans-serif;margin:0 0 .35rem}
.wlc-box p{margin:.2rem 0 .7rem;font-size:.78rem;line-height:1.5;color:var(--muted,#9a9ab5)}
.wlc-f{display:flex;flex-direction:column;gap:.3rem;margin:.55rem 0}
.wlc-f span{font-size:.74rem;font-weight:700}
.wlc-f input,.wlc-f select{width:100%;box-sizing:border-box;min-height:44px;border-radius:12px;border:1.5px solid var(--border,rgba(var(--fg-rgb),.14));background:rgba(var(--fg-rgb),.05);color:var(--text,#f0f0f8);padding:.55rem .8rem;font:600 .9rem Montserrat,system-ui,sans-serif}
.wlc-f small{font-size:.68rem;color:var(--muted,#9a9ab5);line-height:1.4}
.wlc-err{min-height:1em;font-size:.74rem;color:#f87171;margin:.2rem 0}
.wlc-ok{width:100%;min-height:46px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--tw,#9147ff),#6d28d9);color:#fff;font:800 .88rem Montserrat,system-ui,sans-serif;cursor:pointer;margin-top:.3rem}
.wlc-ok:disabled{opacity:.6}
.wlc-ok:focus-visible,.wlc-f input:focus-visible,.wlc-f select:focus-visible{outline:2px solid var(--tw,#9147ff);outline-offset:2px}
.wlc-links{margin-top:.7rem;font-size:.68rem;text-align:center;color:var(--muted,#9a9ab5)}.wlc-links a{color:inherit}`;
      doc.head.appendChild(s);
    }
    // → Promise (закрывается после «Готово»; закрыть без ответа нельзя — возраст обязателен хотя бы как «не хочу указывать»)
    async function show(u) {
      if (!doc?.body || !u) return;
      if (lsGet('d37_welcome_' + u.id)) return;
      css(); close();
      const locked = await nickLocked();
      const cur = (typeof currentProfile !== 'undefined' && currentProfile?.id === u.id) ? String(currentProfile.nick || '') : '';
      const askNick = !locked && (!cur || AUTO_NICK.test(cur));
      const sug = askNick ? suggest(u) : '';
      const A = root.D37Age;
      const ageKnown = !!(A && A.known && A.known() && A.year && A.year());
      return new Promise(resolve => {
        box = doc.createElement('div');
        box.className = 'wlc-ov ym-hide-content';
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'wlcH');
        box.innerHTML = `<div class="wlc-box">
          <div class="wlc-h" id="wlcH">👋 Добро пожаловать!</div>
          <p>Ещё два шага — и всё готово.</p>
          ${askNick ? `<label class="wlc-f"><span>Ник — так тебя увидят в чате и играх</span><input type="text" class="wlc-nick" maxlength="64" autocomplete="nickname" placeholder="Придумай ник"><small>Буквы, цифры и смайлики, от 2 до 24 символов. Сменить можно потом в профиле.</small></label>` : ''}
          ${ageKnown ? '' : `<label class="wlc-f"><span>🎂 Год рождения</span><select class="wlc-year ym-disable-keys" aria-label="Год рождения">${A?.yearOptions ? A.yearOptions(null).replace('>Год рождения<', '>Не хочу указывать<') : '<option value="">Не хочу указывать</option>'}</select><small>🔒 Год видишь только ты. Нужен, чтобы показывать подходящие игры и ролики и чтобы дети общались отдельно от взрослых.</small></label>`}
          <div class="wlc-err" aria-live="polite"></div>
          <button type="button" class="wlc-ok">Готово</button>
          <div class="wlc-links"><a href="/terms" target="_blank" rel="noopener">Пользовательское соглашение</a> · <a href="/privacy" target="_blank" rel="noopener">Конфиденциальность</a></div>
        </div>`;
        doc.body.appendChild(box);
        const inp = box.querySelector('.wlc-nick'), sel = box.querySelector('.wlc-year'), err = box.querySelector('.wlc-err'), ok = box.querySelector('.wlc-ok');
        if (inp) inp.value = sug;   // имя из сервиса — только через value (не разметка)
        ok.addEventListener('click', async () => {
          err.textContent = '';
          let nick = inp ? inp.value : '';
          if (inp) {
            const c = root.D37Nick ? root.D37Nick.check(nick, { self: false }) : { ok: nick.trim().length >= 2, nick: nick.trim(), err: 'Ник: от 2 до 24 символов' };
            if (!c.ok) { err.textContent = c.err; inp.focus?.(); return; }
            nick = c.nick;
          }
          ok.disabled = true;
          if (sel) {
            const y = +sel.value;
            if (y) { const r = await A.set(y); if (!r?.ok) { ok.disabled = false; err.textContent = A.errText ? A.errText(r) : 'Не получилось сохранить год — попробуй ещё раз'; return; } }
            else if (A?.skip) A.skip();
          }
          if (inp && nick && typeof sbClient !== 'undefined' && sbClient) {
            let e1 = null;
            try { ({ error: e1 } = await sbClient.from('profiles').update({ nick }).eq('id', u.id)); } catch (e) { e1 = e; }
            if (e1) { ok.disabled = false; err.textContent = 'Такой ник сейчас нельзя — попробуй другой'; return; }
            if (typeof currentProfile !== 'undefined' && currentProfile) currentProfile.nick = nick;
            try { if (typeof chatNick !== 'undefined') chatNick = nick; localStorage.setItem('d37_nick', nick); } catch (e) {}
            try { if (typeof updateGlobalAuthBtn === 'function') updateGlobalAuthBtn(); } catch (e) {}
          }
          lsSet('d37_welcome_' + u.id, '1');
          close();
          toast(nick ? `🎉 Готово, ${nick}!` : '🎉 Готово!');
          resolve(true);
        });
        try { (inp || sel || ok).focus({ preventScroll: true }); } catch (e) {}
      });
    }
    return { show, suggest, close, _test: { AUTO_NICK } };
  })();

  // ═══ Встроенные браузеры (Telegram, VK, Instagram, TikTok, Facebook…): Google в них не пускает — подсказка «открой в браузере» ═══
  const INAPP_RE = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|Bytedance|BytedanceWebview|Telegram|VKAndroidApp|VKClient|vkclient|Snapchat|MicroMessenger|OKApp|; wv\)/i;
  function inApp(ua) { return INAPP_RE.test(String(ua != null ? ua : (root.navigator?.userAgent || ''))); }
  const isAndroid = ua => /Android/i.test(String(ua != null ? ua : (root.navigator?.userAgent || '')));
  // ссылка «открыть в браузере»: Android — в Chrome (intent://), остальное — копировать адрес
  function openOutside() {
    const url = String(root.location?.href || '').split('#')[0];
    if (isAndroid()) {
      const u = new URL(url);
      root.location.href = 'intent://' + u.host + u.pathname + u.search + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
      return;
    }
    const done = () => toast('Ссылка скопирована — открой Safari или Chrome и вставь её');
    try { root.navigator.clipboard.writeText(url).then(done, () => root.prompt?.('Скопируй ссылку и открой её в Safari или Chrome:', url)); }
    catch (e) { root.prompt?.('Скопируй ссылку и открой её в Safari или Chrome:', url); }
  }

  // ═══ Запуск ═══
  if (ON && root.addEventListener) {
    root.addEventListener('d37:auth', () => { if (me()) setTimeout(resume, 60); });
    // вход из сохранённой сессии мог случиться раньше этого файла
    const boot = () => { if (me()) resume(); };
    if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }

  root.D37Welcome = D37Welcome;
  root.D37Intent = {
    ON, need, park, on, remember, onClose, pending: read, clear, resume, busy, inApp, openOutside,
    _test: { read, write, captureMedia, restoreMedia, isNewSocial, isSocial, ytTime, handlers: H, KEY, INAPP_RE },
  };
})();
