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
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37YtLike) return;
  const doc = root.document;
  const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = 'https://www.googleapis.com/youtube/v3/videos/';
  const REVOKE = 'https://oauth2.googleapis.com/revoke';
  const RE = /^[A-Za-z0-9_-]{11}$/, CID_RE = /^[\w-]{6,120}\.apps\.googleusercontent\.com$/;
  const TOK = 'd37_ytl_tok', ST = 'd37_ytl_state', NO = 'd37_ytl_no', LINK = 'd37_ytl_link', QUOTA = 'd37_ytl_quota';
  const COST = { rate: 50, getRating: 1 };
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
  function dropTok() { tok = null; ssSet(TOK, null); rating.clear(); }
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
    if (!st || !RE.test(String(st.id || '')) || st.n !== n || Date.now() - (+st.at || 0) > 20 * 60e3) { ret = { id: st && RE.test(String(st.id || '')) ? st.id : null, err: 'state' }; return; }
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
  const said = new Map();
  function line(w, async) {
    const k = w + (async ? '+' : '');
    if (Date.now() - (said.get(k) || 0) < 10 * 60e3 && !async) return;   // без потока одинаковых строк
    said.set(k, Date.now());
    toast((LINE[w] || LINE.broken) + (async ? (AGAIN_GOOGLE[w] || AGAIN) : ''));
  }
  // «следующее нажатие на ЭТОТ ролик — ссылка на YouTube» (строка это пообещала, а вкладку открыть не дали): 'video' — до конца визита
  // (ролик лайк не даёт), 'broken' — одно нажатие. sessionStorage d37_ytl_link: { id: [причина, одноразово] }, не больше 50 роликов
  function linkNext(id, w, once) {
    if (!RE.test(String(id || ''))) return;
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
  const stats = { rate: 0, getRating: 0, units: 0, errors: 0 };
  function classify(status, reason) {
    if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) return 'quota';
    if (/youtubeSignupRequired|emailNotVerified/i.test(reason)) return 'channel';
    if (status === 401) return 'expired';
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) return 'denied';
    if (status === 404 || /videoRatingDisabled|videoNotFound|videoPurchaseRequired|^forbidden$/.test(reason)) return 'video';
    return 'broken';
  }
  async function api(path, method, params) {
    const t = token();
    if (!t) return { ok: false, why: 'expired' };
    stats[path]++; stats.units += COST[path] || 0;
    let r;
    try { r = await root.fetch(API + path + '?' + new URLSearchParams(params), { method, headers: { Authorization: 'Bearer ' + t }, cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' }); }
    catch (e) { stats.errors++; return { ok: false, why: 'broken' }; }
    if (r.ok) { let j = null; if (r.status !== 204) { try { j = await r.json(); } catch (e) {} } return { ok: true, j }; }
    stats.errors++;
    let reason = '';
    try { const j = await r.json(); reason = String(j?.error?.errors?.[0]?.reason || j?.error?.status || ''); } catch (e) {}
    return { ok: false, why: classify(r.status, reason) };
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
    if (o.gesture && w !== 'back' && w !== 'expired' && RE.test(String(id || '')) && root.navigator?.userActivation?.isActive) {
      try { opened = !!root.open(root.D37VLike ? root.D37VLike.url(id, !!o.s) : 'https://www.youtube.com/watch?v=' + id, '_blank', 'noopener'); } catch (e) {}
    }
    // строка скажет «нажми ещё раз — откроется YouTube»: следующее нажатие на этот ролик должно открыть ссылку
    if (!opened && w === 'broken' && !all) linkNext(id, 'broken', true);
    line(w, !opened);
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
  function paintId(id) { if (doc && RE.test(String(id || ''))) doc.querySelectorAll('a[data-vlike]').forEach(a => { if (a.getAttribute('data-vlike') === id) paintBtn(a); }); }
  let askT = 0;
  function paint(scope) {
    if (!doc || cfg().mode === 'off') return;   // выключено — кнопки не трогаем вовсе
    const list = (scope && scope.querySelectorAll ? scope : doc).querySelectorAll('a[data-vlike]');
    list.forEach(paintBtn);
    if (why() !== null || !token()) return;
    clearTimeout(askT);
    askT = setTimeout(ask, 300);
  }
  // getRating — одним запросом на все видимые кнопки без ответа (до 50 id = 1 ед. квоты)
  let askFail = 0;   // getRating не ответил — не переспрашивать при каждой перерисовке ленты (30 с)
  async function ask() {
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
  // экран разрешения Google (переход); место и действие — D37Intent.park, назад — resumed()
  // Зовётся ТОЛЬКО по свежему нажатию (run из tap) или сразу после входа гостя, который нажал 👍 (resumed с args.g). Метка n — в state
  // (Google вернёт), в sessionStorage этой вкладки (d37_ytl_state) и в задуманном (args.p): лайк после возврата — только если все три сошлись.
  async function permit(id, o = {}) {
    const c = cfg(), u = me();
    const n = nonce();
    ssSet(ST, JSON.stringify({ n, id, at: Date.now(), u: u ? u.id : '' }));
    await root.D37Intent.park('ytlike', { id, s: !!o.s, p: n }, { media: o.media || null });
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

  // после входа гостя / после экрана Google — D37Intent вернул на место и зовёт сюда.
  // args.p — задуманное отложено перед экраном Google (permit): лайк — только если этот же переход вернулся с ответом Google (ret.n === p);
  // нет ответа (нажал «Назад», страница из кэша, перезагрузка) — к Google сами НЕ идём, строка «нажми ещё раз» (в другую вкладку
  // отложенное не попадает вовсе — D37Intent.park привязан к вкладке).
  // args.g — задумано гостем до входа: сразу после его входа — экран разрешения (единственный переход на Google без нового нажатия).
  let consumed = false;
  async function resumed(args, ctx = {}) {
    const id = RE.test(String(args?.id || '')) ? args.id : null;
    if (!id) return {};
    const p = typeof args.p === 'string' && args.p ? args.p : null;
    if (ret && ret.id === id && (!p || ret.n === p)) {
      const r = ret; ret = null; consumed = true;
      if (r.err) { fail(r.err === 'state' ? 'broken' : r.err, id, {}); return {}; }
      await rate(id, 'like', { s: !!args.s });   // «поставить», не «переключить»: стоявший лайк не снимется
      return {};
    }
    if (p) { fail('back', id, {}); return {}; }
    const w = why();
    if (w === 'off') { toast('Ты вошёл. Лайк на YouTube ставится на самом YouTube.' + AGAIN); return {}; }
    if (w) { fail(w, id, {}); return {}; }
    if (token()) { await rate(id, 'like', { s: !!args.s }); return {}; }
    if (!args.g) { line('back', true); return {}; }   // не от входа гостя (старое задуманное) — без нажатия на Google не уводим
    await permit(id, { gesture: false, s: !!args.s, media: ctx.media || null });
    return {};
  }
  // «Назад» с экрана Google вернул страницу из кэша браузера (скрипты не перезапускались): отложенное для Google — забыть, сказать почему
  function abandoned(e) {
    if (!e || !e.persisted || ret) return;
    const it = root.D37Intent?.pending?.();
    if (!it || it.kind !== 'ytlike' || !it.args?.p) return;
    root.D37Intent.clear?.();
    ssSet(ST, null);
    fail('back', RE.test(String(it.args.id || '')) ? it.args.id : null, {});
  }
  // ответ Google есть, а задуманное потерялось (прошло > 10 мин) — лайк всё равно ставим (место не восстанавливаем)
  async function orphan() {
    if (!ret || consumed || !me()) return;
    const it = root.D37Intent?.pending?.();
    if (it && it.kind === 'ytlike') return;
    await sleep(2500);
    if (!ret || consumed || root.D37Intent?.busy?.()) return;
    const r = ret; ret = null; consumed = true;
    if (r.id) await resumed({ id: r.id }, {}).catch(() => {});
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
a[data-vlike].ytl-busy{opacity:.6;pointer-events:none}`;
    doc.head.appendChild(s);
  }

  root.D37YtLike = {
    SCOPE, tap, paint, why, revoke, mode: () => cfg().mode,
    _go: url => { root.location.assign(url); },   // переход на Google (проверка может подменить)
    _test: { cfg, token, rating, stats, classify, ptDay, ret: () => ret, resumed, abandoned, COST },
  };
  if (root.D37Intent?.on) root.D37Intent.on('ytlike', resumed);
  if (root.addEventListener) {
    root.addEventListener('pageshow', abandoned);
    root.addEventListener('d37:auth', () => { if (!me()) dropTok(); else { token(); setTimeout(orphan, 50); } if (doc) paint(doc); });
    // лента / Shorts / окно ролика перерисовали кнопки (новый ответ /api/feed после возврата с Google и т.п.) — новые a[data-vlike]
    // без ytl-on: подкрасить их (и спросить getRating только про ещё неизвестные ролики). Только при флаге не 'off'.
    let mT = 0;
    const watch = () => {
      if (!root.MutationObserver || !doc?.body) return;
      new root.MutationObserver(ms => {
        if (mT) return;
        for (const m of ms) for (const nd of m.addedNodes) {
          if (nd.nodeType === 1 && (nd.matches?.('a[data-vlike]') || nd.querySelector?.('a[data-vlike]'))) { mT = setTimeout(() => { mT = 0; paint(doc); }, 60); return; }
        }
      }).observe(doc.body, { childList: true, subtree: true });
    };
    const boot = () => { css(); if (me()) setTimeout(orphan, 50); if (cfg().mode !== 'off') { paint(doc); watch(); } };
    if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }
})();
