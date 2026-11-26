// ═══════════════════════════════════════
//  «👍 Лайк на YouTube» ПО-НАСТОЯЩЕМУ (D37YtLike) — владелец 26.11.2026: «Yes, prepare it»
// ═══════════════════════════════════════
// Флаг YT_LIKE_REAL (js/core/config.js): 'off' — кнопка остаётся честной ссылкой (js/core/vlike.js, как раньше); 'test' — только админы
// сайта и YT_LIKE_TEST_IDS (Google сам пускает только «тестовых пользователей» проекта); 'on' — все. Нет YT_CLIENT_ID — выключено.
// Как работает (кнопка та же и там же — меняется только поведение):
//  нажал 👍 → (гость — то же окно входа D37Intent.need; вход спрашивает у Google ТОЛЬКО openid/email/profile) → переход на экран
//  разрешения Google (OAuth 2.0 для браузера, response_type=token, include_granted_scopes=true) с ОДНИМ правом youtube.force-ssl —
//  самым узким, с которым можно videos.rate (другие: youtube — то же «управление», youtubepartner — для владельцев контента) →
//  назад на «/» → тот же раздел, тот же Short, тот же ролик с той же секунды (D37Intent.park + resume, никакой второй системы) →
//  videos.rate?rating=like (50 ед. квоты) без второго нажатия → «👍 Лайк поставлен на YouTube». Повторное нажатие на залитую 👍 —
//  rating=none (снять). videos.getRating (1 ед.) — залитая 👍, если аккаунт YouTube уже лайкнул ролик (только пока есть разрешение).
// Почему переход, а не всплывающее окно Google Identity Services: после входа гостя нажатия уже нет — всплывающее окно браузер
// заблокирует, а переход работает и на телефоне, и в приложении-ярлыке (PWA). Почему не Supabase linkIdentity / signInWithOAuth с
// правом: человек мог войти почтой / VK — тогда к его аккаунту привязался бы Google (или вошёл бы другой аккаунт), а токен Google
// лёг бы в сохранённую сессию supabase-js (localStorage). Здесь токен идёт Google → этот браузер, мимо нашего сервера и базы.
// Токен: только память и sessionStorage (d37_ytl_tok, ≤ 1 ч, со своим id аккаунта сайта — другой вошёл / вышел → стёрт), никогда
// localStorage, сервер, база, адрес, журнал. Фрагмент #access_token… забирает и стирает скрипт в <head> index.html (window.__d37YtHash)
// до Метрики и рекламы. state=ytl.<метка> сверяется с sessionStorage (d37_ytl_state) — чужую ссылку с чужим токеном не примем.
// Не вышло → кнопка снова ссылка на YouTube и одна строка «почему»: встроенный браузер, отказ в разрешении (до конца визита), нет
// канала YouTube, ролик не даёт лайк, токен отозван, квота (10 000 ед. в сутки = ~200 лайков на ВЕСЬ сайт; кончилась — ссылка до
// полуночи по Тихоокеанскому времени, d37_ytl_quota в localStorage — это дата, не токен), ошибка сети. Строка говорит, что сделает
// СЛЕДУЮЩЕЕ нажатие, и оно это делает (d37_ytl_link — «следующее нажатие на этот ролик — ссылка»). На экран Google — только по нажатию
// или сразу после входа гостя, нажавшего 👍; вернулся без ответа Google (Назад, кэш, перезагрузка, новая вкладка) — сам не уводим.
// Правила YouTube API: наград за лайк нет и не будет (III.F.3.c); действие подписано «на YouTube» (III.C.2); лайк — только по нажатию
// человека (III.E.3.d). Дети до 13 (D37Age.kid) и ролики не по возрасту (обложка, кнопки нет) — как раньше. Пошагово для владельца:
// docs/areas/youtube-like-setup-RU.md.
// ПОДПИСКА (владелец 26.11: «а с подпиской так можно сделать? Как с лайками») — ТА ЖЕ система, не вторая: тот же флаг, то же право
// youtube.force-ssl (Google discovery: subscriptions.insert и .list его принимают), тот же экран Google, тот же токен, D37Intent
// ('ytsub'), те же запасные пути и строки. Кнопки — все ссылки «▶ Подписаться на YouTube» (href …?sub_confirmation=1: главная, окно
// ролика, Shorts, раздел видео) — нажатие ловится здесь. subscriptions.list?mine=true&forChannelId=<канал> (1 ед.) → «✓ Ты подписан»;
// subscriptions.insert (50 ед.) — только если list сказал «не подписан» (уже подписан — insert не зовём). Отписки с сайта НЕТ: второе
// нажатие на «✓ Ты подписан» открывает канал. Канал @Dan4ik37Yt = UCztYAfPrieiG6kI93yE-Hdg (og:url страницы youtube.com/@Dan4ik37Yt
// и ссылки подписки в описаниях роликов самого канала, api/_lib/video-details.js). Наград за подписку нет (III.F); «на YouTube» в надписи.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37YtLike) return;
  const doc = root.document;
  const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = 'https://www.googleapis.com/youtube/v3/';
  const REVOKE = 'https://oauth2.googleapis.com/revoke';
  const RE = /^[A-Za-z0-9_-]{11}$/, CID_RE = /^[\w-]{6,120}\.apps\.googleusercontent\.com$/;
  const TOK = 'd37_ytl_tok', ST = 'd37_ytl_state', NO = 'd37_ytl_no', LINK = 'd37_ytl_link', QUOTA = 'd37_ytl_quota';
  const COST = { rate: 50, getRating: 1, subInsert: 50, subList: 1 };
  const PATH = { rate: 'videos/rate', getRating: 'videos/getRating', subInsert: 'subscriptions', subList: 'subscriptions' };
  // подписка: канал @Dan4ik37Yt; SUB — ключ подписки там, где у лайка id ролика (state, ответ Google, linkNext, paintId)
  const CHANNEL = 'UCztYAfPrieiG6kI93yE-Hdg', CH_URL = 'https://www.youtube.com/@Dan4ik37Yt', SUB = 'sub';
  const SUB_SEL = 'a[data-ytsub], a[href*="sub_confirmation=1"]';
  const isKey = id => id === SUB || RE.test(String(id || ''));
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(root.location?.hostname || ''));
  const ssGet = k => { try { return root.sessionStorage ? root.sessionStorage.getItem(k) : null; } catch (e) { return null; } };
  const ssSet = (k, v) => { try { if (!root.sessionStorage) return; if (v == null) root.sessionStorage.removeItem(k); else root.sessionStorage.setItem(k, String(v)); } catch (e) {} };
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const jget = (k, ls) => { try { const o = JSON.parse((ls ? lsGet : ssGet)(k) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  const me = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const role = () => (typeof currentRole !== 'undefined' ? currentRole : null);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); };

  // ═══ Флаг (на localhost проверка может подменить его через window.__d37YtLikeTest — на сайте это не работает) ═══
  function cfg() {
    let mode = typeof YT_LIKE_REAL === 'string' ? YT_LIKE_REAL : 'off';
    let cid = typeof YT_CLIENT_ID === 'string' ? YT_CLIENT_ID : '';
    let ids = typeof YT_LIKE_TEST_IDS !== 'undefined' && Array.isArray(YT_LIKE_TEST_IDS) ? YT_LIKE_TEST_IDS : [];
    const o = LOCAL ? root.__d37YtLikeTest : null;
    if (o && typeof o === 'object') { if (typeof o.mode === 'string') mode = o.mode; if (typeof o.cid === 'string') cid = o.cid; if (Array.isArray(o.ids)) ids = o.ids; }
    if (!['off', 'test', 'on'].includes(mode) || !CID_RE.test(cid)) mode = 'off';
    return { mode, cid, ids: ids.map(String) };
  }
  // день квоты YouTube — по Тихоокеанскому времени (квота обнуляется в полночь PT)
  const ptDay = () => { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  const quotaToday = () => lsGet(QUOTA) === ptDay();

  // ═══ Токен Google: память + sessionStorage, со своим аккаунтом сайта ═══
  let tok = null;
  const rating = new Map();   // id → 'like' | 'none' | 'dislike' (что сказал YouTube этому аккаунту)
  let subbed = null;          // подписан ли этот аккаунт YouTube на канал: null — не спрашивали, true / false — ответ subscriptions.list
  function dropTok() { tok = null; ssSet(TOK, null); rating.clear(); subbed = null; }
  function setTok(t, sec, uid) { tok = { t, exp: Date.now() + Math.max(60, Math.min(+sec || 3600, 3600)) * 1000, u: String(uid || ''), at: Date.now() }; ssSet(TOK, JSON.stringify(tok)); }
  function token() {
    if (!tok) { const o = jget(TOK); if (o && typeof o.t === 'string') tok = o; }
    if (!tok) return null;
    const u = me();
    if (Date.now() > (+tok.exp || 0) - 60e3 || !u || (tok.u && tok.u !== u.id)) { dropTok(); return null; }
    return tok.t;
  }

  // ═══ Ответ Google после разрешения (#state=ytl.…&access_token=… | #error=access_denied&state=ytl.…) ═══
  let ret = null;   // { id, n, err? } — ждёт обработчика D37Intent (или сироту — см. orphan); n — метка этого перехода (= args.p задуманного)
  (function takeReturn() {
    let h = root.__d37YtHash;
    try { delete root.__d37YtHash; } catch (e) { root.__d37YtHash = undefined; }
    if (h == null) {   // старый index.html из кэша — без скрипта в <head>
      const lh = String(root.location?.hash || '');
      if (!/(?:^#|&)state=ytl\./.test(lh)) return;
      h = lh;
      try { root.history.replaceState(null, '', String(root.location.pathname || '/') + String(root.location.search || '')); } catch (e) {}
    }
    let q;
    try { q = new URLSearchParams(String(h).replace(/^#/, '')); } catch (e) { return; }
    const st = jget(ST);
    ssSet(ST, null);
    const n = String(q.get('state') || '').slice(4);
    if (!st || !isKey(st.id) || st.n !== n || Date.now() - (+st.at || 0) > 20 * 60e3) { ret = { id: st && isKey(st.id) ? st.id : null, err: 'state' }; return; }
    ret = { id: st.id, n, u: String(st.u || '') };
    const err = q.get('error');
    if (err) { ret.err = err === 'access_denied' ? 'denied' : 'broken'; return; }
    const at = String(q.get('access_token') || '');
    if (!/^[\w.~+/-]{16,4096}=*$/.test(at)) { ret.err = 'broken'; return; }
    // «гранулярное» согласие: галочку YouTube могли снять — тогда права нет
    if (q.has('scope') && !String(q.get('scope') || '').split(/\s+/).includes(SCOPE)) { ret.err = 'denied'; return; }
    setTok(at, +q.get('expires_in') || 3600, st.u);
  })();

  // ═══ Можно ли сейчас настоящий лайк: null — да; 'off' — как раньше молча; иначе причина (ссылка + строка) ═══
  function why() {
    const c = cfg();
    if (c.mode === 'off' || !root.D37Intent?.ON || typeof root.D37Intent.park !== 'function') return 'off';
    const u = me();
    if (c.mode === 'test' && !(u && (role() === 'admin' || c.ids.includes(String(u.id))))) return 'off';
    try { if (root.D37Age?.kid?.()) return 'off'; } catch (e) {}
    if (root.D37Intent.inApp?.()) return 'inapp';
    if (quotaToday()) return 'quota';
    const no = ssGet(NO);
    if (no === 'denied' || no === 'channel' || no === 'broken') return no;
    return null;
  }
  const LINE = {
    inapp: 'Во встроенном браузере Google не даёт разрешение — лайк ставится на самом YouTube. С сайта — открой его в Chrome или Safari.',
    quota: 'Лайки с сайта на сегодня закончились (лимит YouTube) — лайк ставится на самом YouTube.',
    denied: 'Без разрешения Google сайт лайк не ставит — лайк ставится на самом YouTube.',
    channel: 'Этот аккаунт Google не может ставить лайки на YouTube (нет канала или не подтверждена почта) — лайк ставится на самом YouTube.',
    expired: 'Разрешение Google больше не действует — лайк ставится на самом YouTube.',
    video: 'YouTube не дал поставить лайк этому ролику — лайк ставится на самом YouTube.',
    broken: 'Не получилось связаться с YouTube — лайк ставится на самом YouTube.',
    back: 'Разрешение Google не дано — лайк не поставлен.',
  };
  // что сделает СЛЕДУЮЩЕЕ нажатие — строка обещает ровно это (tap() держит обещание: linkNext / снова экран Google)
  const AGAIN = ' Нажми 👍 ещё раз — откроется YouTube.';
  const AGAIN_GOOGLE = { expired: ' Нажми 👍 ещё раз — Google спросит разрешение снова.', back: ' Нажми 👍 ещё раз — снова откроется экран Google.' };
  // те же причины — для подписки ('video' у подписки — YouTube отказал в подписке: свой канал, лимит подписок, много подряд)
  const LINE_SUB = {
    inapp: 'Во встроенном браузере Google не даёт разрешение — подписка оформляется на самом YouTube. С сайта — открой его в Chrome или Safari.',
    quota: 'Подписки с сайта на сегодня закончились (лимит YouTube) — подписка оформляется на самом YouTube.',
    denied: 'Без разрешения Google сайт не подписывает — подписка оформляется на самом YouTube.',
    channel: 'Этот аккаунт Google не может подписываться на YouTube (нет канала или не подтверждена почта) — подписка оформляется на самом YouTube.',
    expired: 'Разрешение Google больше не действует — подписка оформляется на самом YouTube.',
    video: 'YouTube не дал подписаться с сайта (свой канал, лимит подписок или много подписок подряд) — подписка оформляется на самом YouTube.',
    broken: 'Не получилось связаться с YouTube — подписка оформляется на самом YouTube.',
    back: 'Разрешение Google не дано — подписка не оформлена.',
  };
  const AGAIN_SUB = ' Нажми «Подписаться» ещё раз — откроется YouTube.';
  const AGAIN_GOOGLE_SUB = { expired: ' Нажми «Подписаться» ещё раз — Google спросит разрешение снова.', back: ' Нажми «Подписаться» ещё раз — снова откроется экран Google.' };
  const said = new Map();
  function line(w, async, id) {
    const sub = id === SUB;
    const k = (sub ? 's:' : '') + w + (async ? '+' : '');
    if (Date.now() - (said.get(k) || 0) < 10 * 60e3 && !async) return;   // без потока одинаковых строк
    said.set(k, Date.now());
    const L = sub ? LINE_SUB : LINE;
    toast((L[w] || L.broken) + (async ? ((sub ? AGAIN_GOOGLE_SUB : AGAIN_GOOGLE)[w] || (sub ? AGAIN_SUB : AGAIN)) : ''));
  }
  // «следующее нажатие на ЭТОТ ролик — ссылка на YouTube» (строка это пообещала, а вкладку открыть не дали): 'video' — до конца визита
  // (ролик лайк не даёт), 'broken' — одно нажатие. sessionStorage d37_ytl_link: { id: [причина, одноразово] }, не больше 50 роликов
  function linkNext(id, w, once) {
    if (!isKey(id)) return;
    const m = jget(LINK) || {};
    delete m[id]; m[id] = [w, once ? 1 : 0];
    const ks = Object.keys(m); for (let i = 0; i < ks.length - 50; i++) delete m[ks[i]];
    ssSet(LINK, JSON.stringify(m));
  }
  function linkTake(id) {
    const m = jget(LINK);
    const v = m && Array.isArray(m[id]) ? m[id] : null;
    if (!v) return null;
    if (v[1]) { delete m[id]; ssSet(LINK, JSON.stringify(m)); }
    return String(v[0] || 'broken');
  }

  // ═══ YouTube Data API (токен — только в заголовке, адрес без токена) ═══
  const stats = { rate: 0, getRating: 0, subInsert: 0, subList: 0, units: 0, errors: 0 };
  function classify(status, reason) {
    if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) return 'quota';
    if (/youtubeSignupRequired|emailNotVerified|subscriberNotFound|accountClosed|accountSuspended/i.test(reason)) return 'channel';
    if (status === 401) return 'expired';
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) return 'denied';
    if (status === 404 || /videoRatingDisabled|videoNotFound|videoPurchaseRequired|^forbidden$|subscriptionForbidden|publisherNotFound/.test(reason)) return 'video';
    return 'broken';
  }
  // name — ключ PATH / COST; body — JSON (subscriptions.insert)
  async function api(name, method, params, body) {
    const t = token();
    if (!t) return { ok: false, why: 'expired' };
    stats[name]++; stats.units += COST[name] || 0;
    const headers = { Authorization: 'Bearer ' + t };
    if (body) headers['Content-Type'] = 'application/json';
    let r;
    try { r = await root.fetch(API + PATH[name] + '?' + new URLSearchParams(params), { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' }); }
    catch (e) { stats.errors++; return { ok: false, why: 'broken' }; }
    if (r.ok) { let j = null; if (r.status !== 204) { try { j = await r.json(); } catch (e) {} } return { ok: true, j }; }
    stats.errors++;
    let reason = '';
    try { const j = await r.json(); reason = String(j?.error?.errors?.[0]?.reason || j?.error?.status || ''); } catch (e) {}
    return { ok: false, why: classify(r.status, reason), reason };
  }
  // неудача: запомнить, что надо (квота — до полуночи PT; отказ / нет канала — до конца визита), сказать одну строку; если нажатие ещё
  // «свежее» (браузер разрешает открыть вкладку) — сразу открыть ролик на YouTube, как делала ссылка
  // «истёк» (401) на токене, который Google выдал только что (< 5 мин), — не истёк: снова на Google не шлём (был бы круг), это сбой
  let brokenN = 0;
  function fail(w, id, o = {}) {
    if (w === 'expired' && tok && Date.now() - (+tok.at || 0) < 5 * 60e3) w = 'broken';
    let all = false;   // ссылка до конца визита для ВСЕХ роликов (why() это скажет)
    if (w === 'quota') { lsSet(QUOTA, ptDay()); all = true; }
    else if (w === 'denied' || w === 'channel') { ssSet(NO, w); all = true; }
    else if (w === 'expired') dropTok();
    else if (w === 'broken' && ++brokenN >= 2) { ssSet(NO, 'broken'); all = true; }
    if (w === 'video') linkNext(id, 'video', false);   // ролик лайк не даёт — дальше всегда ссылка
    paintId(id);
    if (o.silent) return;
    let opened = false;
    if (o.gesture && w !== 'back' && w !== 'expired' && isKey(id) && root.navigator?.userActivation?.isActive) {
      const url = id === SUB ? CH_URL + '?sub_confirmation=1' : root.D37VLike ? root.D37VLike.url(id, !!o.s) : 'https://www.youtube.com/watch?v=' + id;
      try { opened = !!root.open(url, '_blank', 'noopener'); } catch (e) {}
    }
    // строка скажет «нажми ещё раз — откроется YouTube»: следующее нажатие на этот ролик (на «Подписаться») должно открыть ссылку
    if (!opened && w === 'broken' && !all) linkNext(id, 'broken', true);
    line(w, !opened, id);
  }

  // ═══ Кнопки: залитая 👍 — YouTube сказал «like» этому аккаунту ═══
  const busy = new Set();
  function paintBtn(a) {
    const id = a.getAttribute('data-vlike');
    const known = why() === null && !!token() && rating.has(id);
    const on = known && rating.get(id) === 'like';
    a.classList.toggle('ytl-on', on);
    a.classList.toggle('ytl-busy', busy.has(id));
    if (!known) { a.removeAttribute('aria-pressed'); return; }
    a.classList.toggle('vl-on', false);
    a.setAttribute('aria-pressed', on ? 'true' : 'false');
    a.title = on ? 'Ты лайкнул этот ролик на YouTube — нажми, чтобы убрать лайк' : 'Поставить лайк на YouTube от твоего аккаунта';
    const m = a.querySelector('.vl-mark');
    if (m) m.textContent = on ? ' ✓' : '';
  }
  // «▶ Подписаться на YouTube»: YouTube сказал «подписан» → «✓ Ты подписан», ссылка ведёт на канал (без ?sub_confirmation); иначе —
  // прежние надпись и ссылка (вернуть то, что было: содержимое, href, title). data-ytsub — исходный href, пока надпись подменена.
  const subOrig = new WeakMap();
  function paintSub(a) {
    const on = why() === null && !!token() && subbed === true;
    a.classList.toggle('ytl-busy', busy.has(SUB));
    if (on && !subOrig.has(a)) {
      subOrig.set(a, { nodes: [...a.childNodes].map(n => n.cloneNode(true)), title: a.getAttribute('title'), href: a.getAttribute('href') });
      a.setAttribute('data-ytsub', a.getAttribute('href') || '');
      a.textContent = '✓ Ты подписан';
      a.setAttribute('href', CH_URL);
      a.title = 'Ты подписан на канал на YouTube — нажми, чтобы открыть канал';
      a.classList.add('ytl-on');
    } else if (!on && subOrig.has(a)) {
      const o = subOrig.get(a); subOrig.delete(a);
      a.replaceChildren(...o.nodes);
      if (o.href != null) a.setAttribute('href', o.href);
      if (o.title == null) a.removeAttribute('title'); else a.title = o.title;
      a.removeAttribute('data-ytsub');
      a.classList.remove('ytl-on');
    }
  }
  function paintId(id) {
    if (!doc) return;
    if (id === SUB) { doc.querySelectorAll(SUB_SEL).forEach(paintSub); return; }
    if (RE.test(String(id || ''))) doc.querySelectorAll('a[data-vlike]').forEach(a => { if (a.getAttribute('data-vlike') === id) paintBtn(a); });
  }
  let askT = 0;
  function paint(scope) {
    if (!doc || cfg().mode === 'off') return;   // выключено — кнопки не трогаем вовсе
    const sc = scope && scope.querySelectorAll ? scope : doc;
    sc.querySelectorAll('a[data-vlike]').forEach(paintBtn);
    sc.querySelectorAll(SUB_SEL).forEach(paintSub);
    if (why() !== null || !token()) return;
    clearTimeout(askT);
    askT = setTimeout(ask, 300);
  }
  // subscriptions.list?mine=true&forChannelId=<канал> (1 ед.): подписан ли аккаунт YouTube. Один запрос на всех (кнопки и нажатие ждут его)
  let subQ = null, subAskFail = 0;
  function subState() {
    if (subbed !== null) return Promise.resolve({ ok: true });
    if (subQ) return subQ;
    subQ = api('subList', 'GET', { part: 'id', mine: 'true', forChannelId: CHANNEL, maxResults: '1' }).then(r => {
      if (r.ok) subbed = (Array.isArray(r.j?.items) ? r.j.items : []).length > 0;
      return r.ok ? { ok: true } : r;
    }).finally(() => { subQ = null; });
    return subQ;
  }
  async function askSub() {
    if (subbed !== null || why() !== null || !token() || !doc || Date.now() - subAskFail < 30e3 || !doc.querySelectorAll(SUB_SEL).length) return;
    const r = await subState();
    if (!r.ok) { subAskFail = Date.now(); if (r.why === 'quota' || r.why === 'expired' || r.why === 'denied') fail(r.why, null, { silent: true }); return; }
    paintId(SUB);
  }
  // getRating — одним запросом на все видимые кнопки без ответа (до 50 id = 1 ед. квоты)
  let askFail = 0;   // getRating не ответил — не переспрашивать при каждой перерисовке ленты (30 с)
  async function ask() {
    askSub();
    if (why() !== null || !token() || !doc || Date.now() - askFail < 30e3) return;
    const ids = [...new Set([...doc.querySelectorAll('a[data-vlike]')].map(a => a.getAttribute('data-vlike')).filter(id => RE.test(String(id || '')) && !rating.has(id)))].slice(0, 50);
    if (!ids.length) return;
    const r = await api('getRating', 'GET', { id: ids.join(',') });
    if (!r.ok) { askFail = Date.now(); if (r.why === 'quota' || r.why === 'expired' || r.why === 'denied') fail(r.why, null, { silent: true }); return; }
    const items = Array.isArray(r.j?.items) ? r.j.items : [];
    for (const id of ids) rating.set(id, 'none');
    for (const it of items) if (RE.test(String(it?.videoId || '')) && /^(like|dislike|none|unspecified)$/.test(String(it.rating || ''))) rating.set(it.videoId, it.rating === 'unspecified' ? 'none' : it.rating);
    ids.forEach(paintId);
  }

  // ═══ Действия ═══
  async function rate(id, value, o = {}) {
    if (busy.has(id)) return;
    busy.add(id); paintId(id);
    let r;
    try { r = await api('rate', 'POST', { id, rating: value }); } finally { busy.delete(id); }
    if (!r.ok) { fail(r.why, id, o); return; }
    brokenN = 0;
    rating.set(id, value);
    paintId(id);
    // после возврата лента Shorts / окно ролика могли ещё не дорисоваться — подкрасить кнопку, когда появится (до 10 с)
    if (doc && ![...doc.querySelectorAll('a[data-vlike]')].some(a => a.getAttribute('data-vlike') === id)) (async () => {
      for (let i = 0; i < 40 && ![...doc.querySelectorAll('a[data-vlike]')].some(a => a.getAttribute('data-vlike') === id); i++) await sleep(250);
      paintId(id);
    })();
    toast(value === 'like' ? '👍 Лайк поставлен на YouTube' : 'Лайк на YouTube убран');
  }
  const nonce = () => { const a = new Uint8Array(24); root.crypto.getRandomValues(a); return root.btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  // подписка (id = SUB): уже подписан (list) — insert не зовём; insert ответил subscriptionDuplicate — тоже «подписан»
  async function subscribe(o = {}) {
    if (busy.has(SUB)) return;
    busy.add(SUB); paintId(SUB);
    let r;
    try {
      r = await subState();
      if (r.ok && subbed === true) r = { ok: true, already: true };
      else if (r.ok) r = await api('subInsert', 'POST', { part: 'snippet' }, { snippet: { resourceId: { kind: 'youtube#channel', channelId: CHANNEL } } });
    } finally { busy.delete(SUB); }
    if (!r.ok && r.reason === 'subscriptionDuplicate') r = { ok: true, already: true };
    if (!r.ok) { fail(r.why, SUB, o); return; }
    brokenN = 0;
    subbed = true;
    paintId(SUB);
    toast(r.already ? '✓ Ты уже подписан на канал на YouTube' : '✓ Ты подписан на канал на YouTube');
  }
  // экран разрешения Google (переход); место и действие — D37Intent.park, назад — resumed()
  // Зовётся ТОЛЬКО по свежему нажатию (run из tap) или сразу после входа гостя, который нажал 👍 (resumed с args.g). Метка n — в state
  // (Google вернёт), в sessionStorage этой вкладки (d37_ytl_state) и в задуманном (args.p): лайк после возврата — только если все три сошлись.
  async function permit(id, o = {}) {
    const c = cfg(), u = me();
    const n = nonce();
    ssSet(ST, JSON.stringify({ n, id, at: Date.now(), u: u ? u.id : '' }));
    if (id === SUB) await root.D37Intent.park('ytsub', { p: n }, { media: o.media || null });
    else await root.D37Intent.park('ytlike', { id, s: !!o.s, p: n }, { media: o.media || null });
    const q = new URLSearchParams({ client_id: c.cid, redirect_uri: String(root.location.origin) + '/', response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: 'ytl.' + n });
    root.D37YtLike._go(AUTH + '?' + q.toString());
  }
  async function run(id, o = {}) {
    if (!me()) {   // гость (только 'on'): обычное окно входа, после входа — resumed()
      await root.D37Intent.need('ytlike', { id, s: !!o.s, g: 1 }, { label: 'Войди — и 👍 поставится на YouTube сам' });
      return;
    }
    if (token()) return rate(id, rating.get(id) === 'like' ? 'none' : 'like', o);
    return permit(id, o);
  }

  // нажали «👍 Лайк на YouTube» (vlike.js, до перехода по ссылке): true — нажатие наше, ссылку не открываем
  function tap(e, a, id) {
    if (!RE.test(String(id || ''))) return false;
    const w = why();
    if (w === 'off') return false;            // как раньше, без слов
    if (w) { line(w, false); return false; }  // ссылка откроется сама + строка «почему»
    if (linkTake(id)) return false;           // строка обещала «нажми ещё раз — откроется YouTube»: ссылка откроется сама
    if (e && e.preventDefault) e.preventDefault();
    run(id, { gesture: true, s: !!(a && a.closest && a.closest('.sh-item')) }).catch(() => fail('broken', id, {}));
    return true;
  }
  // нажали «▶ Подписаться на YouTube» (ловим здесь, на всём документе, раньше обработчиков разделов): true — нажатие наше
  async function runSub(o = {}) {
    if (!me()) {   // гость (только 'on'): то же окно входа, после входа — resumed(…, 'ytsub')
      await root.D37Intent.need('ytsub', { g: 1 }, { label: 'Войди — и подписка на YouTube оформится сама' });
      return;
    }
    if (token()) return subscribe(o);
    return permit(SUB, o);
  }
  function tapSub(e) {
    const w = why();
    if (w === 'off') return false;                         // как раньше, без слов
    if (w) { line(w, false, SUB); return false; }          // ссылка откроется сама + строка «почему»
    if (subbed === true && token()) return false;          // «✓ Ты подписан»: ссылка ведёт на канал (отписки с сайта нет)
    if (linkTake(SUB)) return false;                       // строка обещала «нажми ещё раз — откроется YouTube»
    if (e && e.preventDefault) e.preventDefault();
    runSub({ gesture: true }).catch(() => fail('broken', SUB, {}));
    return true;
  }

  // после входа гостя / после экрана Google — D37Intent вернул на место и зовёт сюда.
  // args.p — задуманное отложено перед экраном Google (permit): лайк — только если этот же переход вернулся с ответом Google (ret.n === p);
  // нет ответа (нажал «Назад», страница из кэша, перезагрузка) — к Google сами НЕ идём, строка «нажми ещё раз» (в другую вкладку
  // отложенное не попадает вовсе — D37Intent.park привязан к вкладке).
  // args.g — задумано гостем до входа: сразу после его входа — экран разрешения (единственный переход на Google без нового нажатия).
  // sub — то же для подписки (D37Intent 'ytsub'): ключ SUB вместо id ролика, действие — subscribe()
  let consumed = false;
  async function resumed(args, ctx = {}, sub = false) {
    const id = sub ? SUB : RE.test(String(args?.id || '')) ? args.id : null;
    if (!id) return {};
    args = args || {};
    const p = typeof args.p === 'string' && args.p ? args.p : null;
    // «поставить», не «переключить»: стоявший лайк не снимется; подписка — только если ещё не подписан
    const act = () => sub ? subscribe({}) : rate(id, 'like', { s: !!args.s });
    if (ret && ret.id === id && (!p || ret.n === p)) {
      const r = ret; ret = null; consumed = true;
      if (r.err) { fail(r.err === 'state' ? 'broken' : r.err, id, {}); return {}; }
      await act();
      return {};
    }
    if (p) { fail('back', id, {}); return {}; }
    const w = why();
    if (w === 'off') { toast(sub ? 'Ты вошёл. Подписка на YouTube оформляется на самом YouTube.' + AGAIN_SUB : 'Ты вошёл. Лайк на YouTube ставится на самом YouTube.' + AGAIN); return {}; }
    if (w) { fail(w, id, {}); return {}; }
    if (token()) { await act(); return {}; }
    if (!args.g) { line('back', true, id); return {}; }   // не от входа гостя (старое задуманное) — без нажатия на Google не уводим
    await permit(id, { gesture: false, s: !!args.s, media: ctx.media || null });
    return {};
  }
  // «Назад» с экрана Google вернул страницу из кэша браузера (скрипты не перезапускались): отложенное для Google — забыть, сказать почему
  function abandoned(e) {
    if (!e || !e.persisted || ret) return;
    const it = root.D37Intent?.pending?.();
    if (!it || (it.kind !== 'ytlike' && it.kind !== 'ytsub') || !it.args?.p) return;
    root.D37Intent.clear?.();
    ssSet(ST, null);
    fail('back', it.kind === 'ytsub' ? SUB : RE.test(String(it.args.id || '')) ? it.args.id : null, {});
  }
  // ответ Google есть, а задуманное потерялось (прошло > 10 мин) — лайк всё равно ставим (место не восстанавливаем)
  async function orphan() {
    if (!ret || consumed || !me()) return;
    const it = root.D37Intent?.pending?.();
    if (it && (it.kind === 'ytlike' || it.kind === 'ytsub')) return;
    await sleep(2500);
    if (!ret || consumed || root.D37Intent?.busy?.()) return;
    const r = ret; ret = null; consumed = true;
    if (r.id) await resumed(r.id === SUB ? {} : { id: r.id }, {}, r.id === SUB).catch(() => {});
    else if (r.err) fail('broken', null, {});
  }

  // отозвать разрешение (Google: POST /revoke, без CORS — ответ не читаем) и забыть токен
  async function revoke() {
    const t = tok?.t || jget(TOK)?.t;
    dropTok(); ssSet(NO, null);
    if (t) { try { await root.fetch(REVOKE, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t), credentials: 'omit', referrerPolicy: 'no-referrer' }); } catch (e) {} }
    if (doc) paint(doc);
  }

  function css() {
    if (!doc?.head || doc.getElementById('d37YtLikeCss')) return;
    const s = doc.createElement('style'); s.id = 'd37YtLikeCss';
    s.textContent = `
a[data-vlike].ytl-on{border-color:#f00!important;background:rgba(255,0,0,.22)!important}
a[data-vlike].ytl-on .vl-mark{color:#ff4d4d}
a[data-vlike].ytl-busy{opacity:.6;pointer-events:none}
a[data-ytsub].ytl-on{filter:saturate(.6)}
a[href*="sub_confirmation=1"].ytl-busy{opacity:.6;pointer-events:none}`;
    doc.head.appendChild(s);
  }

  root.D37YtLike = {
    SCOPE, CHANNEL, tap, tapSub, paint, why, revoke, mode: () => cfg().mode,
    _go: url => { root.location.assign(url); },   // переход на Google (проверка может подменить)
    _test: { cfg, token, rating, stats, classify, ptDay, ret: () => ret, resumed, abandoned, COST, subbed: () => subbed },
  };
  if (root.D37Intent?.on) { root.D37Intent.on('ytlike', resumed); root.D37Intent.on('ytsub', (a, c) => resumed(a, c, true)); }
  if (root.addEventListener) {
    root.addEventListener('pageshow', abandoned);
    // «▶ Подписаться на YouTube» — на всём документе и раньше обработчиков разделов (как «👍» в vlike.js); 'off' — не трогаем вовсе
    if (doc?.addEventListener) doc.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest(SUB_SEL) : null;
      if (!a || cfg().mode === 'off') return;
      tapSub(e);
    }, true);
    root.addEventListener('d37:auth', () => { if (!me()) dropTok(); else { token(); setTimeout(orphan, 50); } if (doc) paint(doc); });
    // лента / Shorts / окно ролика перерисовали кнопки (новый ответ /api/feed после возврата с Google и т.п.) — новые a[data-vlike]
    // без ytl-on: подкрасить их (и спросить getRating только про ещё неизвестные ролики). Только при флаге не 'off'.
    let mT = 0;
    const watch = () => {
      if (!root.MutationObserver || !doc?.body) return;
      new root.MutationObserver(ms => {
        if (mT) return;
        for (const m of ms) for (const nd of m.addedNodes) {
          if (nd.nodeType === 1 && (nd.matches?.('a[data-vlike], ' + SUB_SEL) || nd.querySelector?.('a[data-vlike], ' + SUB_SEL))) { mT = setTimeout(() => { mT = 0; paint(doc); }, 60); return; }
        }
      }).observe(doc.body, { childList: true, subtree: true });
    };
    const boot = () => { css(); if (me()) setTimeout(orphan, 50); if (cfg().mode !== 'off') { paint(doc); watch(); } };
    if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }
})();
