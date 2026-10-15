// ═══════════════════════════════════════
//  👥 ПРИГЛАШЕНИЯ ДРУЗЕЙ — код, ссылки, «кто позвал» (сервер — referrals2.sql; страница — js/features/invite.js)
// ═══════════════════════════════════════
// Ссылка: dan4ik37.vercel.app/r/<код> (серверная страница с превью, api/_lib/routes/ref.js) или ?ref=<код> на любой странице;
// старые ?ref=<ник> тоже работают. Код ловится при загрузке (до init.js — старый captureReferralCode уже ничего не найдёт: ?ref=
// убран из адреса) и ждёт в браузере keepDays дней. Первое касание: чужая ссылка позже не перебивает первую.
// После входа ЛЮБЫМ способом (почта, Google, VK, Telegram…) — событие d37:auth → ref_claim (сервер решает: новый ли аккаунт,
// не сам ли себя). Регистрация по почте ещё и кладёт код в метаданные (global-auth.js читает зеркало d37_ref) — привязка сразу.
// Хранилище: d37_ref2 — { c: код, k: code|nick, t: когда, s: откуда, p: куда }, d37_ref — зеркало кода (его читает старый код),
// d37_ref_my — { u, c } свой код (для «позвать в игру» — wrap), d37_dev — случайный ключ браузера (проверка «сам себя»).
// Те же правила ловли — в <head> серверных страниц (REF_HEAD в api/_lib/page.js), scripts/referral-test.cjs сверяет.
// API (window.D37Ref): RULES, LADDER — как ref_rule / ref_ladder в referrals2.sql; valid, parse, gen, capture, pending, code, clear,
// device, mine, setMine, link(code, to), wrap(url), touch(), shareUrls(url, text), afterAuth(), publicInfo(code), hasFrame(uid), on(fn).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Ref) return;
  // Числа — как ref_rule() в referrals2.sql
  const RULES = { pct: 10, months: 12, gemsMonth: 500, claimDays: 7, keepDays: 30, dayCap: 10, monthCap: 60, ipBurst: 3, marksDays: 90, freshDays: 30 };
  // Лестница — как ref_ladder() в referrals2.sql (m — уровни друга, w — подарок новичку, t — ступени пригласившего)
  const LADDER = {
    m: [{ id: 'l3', lv: 3, xp: 25, coins: 30 }, { id: 'l5', lv: 5, xp: 25, coins: 50 }, { id: 'l10', lv: 10, coins: 100 }],
    w: { lv: 3, coins: 50, part: 'trail:confetti', text: 'След «Конфетти»' },
    t: [{ id: 't1', n: 1, lv: 5, part: 'pet:parrot', text: 'Питомец «Попугай»' },
        { id: 't2', n: 3, lv: 5, part: 'item:megaphone', text: '«Мегафон» в руку' },
        { id: 't3', n: 5, lv: 5, frame: 1, text: 'Рамка аватара «Посол»' },
        { id: 't4', n: 10, lv: 10, coins: 500, part: 'trail:fireworks', text: 'След «Салют» и 500 🪙' }],
  };
  // Код: 6 знаков — цифры 2–9 и согласные без l, x, y (как ref_new_code); старый ник — буквы, цифры, пробел _ . -
  const ALPHABET = '23456789bcdfghjkmnpqrstvwz';
  const CODE_RE = /^[2-9bcdfghjkmnpqrstvwz]{6}$/;
  const BAD = /(pzd|fck|fkn|bdsm|kkk|ss|wtf|gvn)/;
  const NICK_RE = /^[\p{L}\p{N} _.-]{1,24}$/u;
  const PLACE_RE = /^[A-Za-z0-9/_-]{1,80}$/;
  const DAY = 864e5, KEEP = RULES.keepDays * DAY;
  const SITE = 'https://dan4ik37.vercel.app';
  const LS = 'd37_ref2', LS_OLD = 'd37_ref', LS_MY = 'd37_ref_my', LS_DEV = 'd37_dev', LS_DONE = 'd37_ref_done', LS_PING = 'd37_ref_ping', LS_TOUCH = 'd37_ref_touch';

  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const jget = k => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };
  const now = () => Date.now();
  const today = () => new Date(now() + 3 * 3600e3).toISOString().slice(0, 10);   // день по Москве
  const listeners = new Set();
  const emit = (type, data) => { listeners.forEach(fn => { try { fn(type, data); } catch (e) {} }); };

  const valid = c => CODE_RE.test(String(c || ''));
  // Код как ref_new_code: случайные знаки алфавита, без плохих сочетаний (rand — для проверок)
  function gen(rand = Math.random){
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      if (!BAD.test(c)) return c;
    }
  }
  // Что угодно → { c, k }: «/r/AbC234», ссылка с ?ref=, «ab c-234» (пробелы и дефисы прочь), старый ник
  function parse(input){
    let s = String(input == null ? '' : input).trim();
    if (!s) return null;
    const m = /\/r\/([A-Za-z0-9]{6})(?:[/?#]|$)/.exec(s) || /[?&]ref=([^&#]+)/.exec(s);
    if (m) { try { s = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { s = m[1]; } }
    s = s.trim().toLowerCase();
    const compact = s.replace(/[\s-]/g, '');
    if (CODE_RE.test(compact)) return { c: compact, k: 'code' };
    if (NICK_RE.test(s) && s.length <= 24) return { c: s, k: 'nick' };
    return null;
  }

  // Откуда и куда звали — по адресу, куда пришёл (сервер проверит сам)
  function sourceOf(path){
    const p = String(path || '').replace(/^#?\/+/, '');
    if (/^games\/world(\/|$)/.test(p)) return 'world';
    if (/^games\/studio3?d?\/play\//.test(p) || /^games\/studio\/play\//.test(p) || /^g\//.test(p)) return 'studio';
    if (/^games\/[a-z0-9_-]+\/(coop\/)?[a-z0-9]{4,12}$/.test(p)) return 'room';
    if (/^games(\/|$)/.test(p)) return 'game';
    if (/^v\//.test(p)) return 'video';
    if (/^c\//.test(p) || /^chat\/join\//.test(p)) return 'community';
    return 'link';
  }

  // Записанное приглашение (просроченное — стираем)
  function pending(){
    const r = jget(LS);
    if (!r || typeof r.c !== 'string' || !r.t) { if (r) { lsSet(LS, null); lsSet(LS_OLD, null); } return null; }
    if (now() - r.t >= KEEP || now() < r.t - DAY) { lsSet(LS, null); lsSet(LS_OLD, null); return null; }
    return r;
  }
  const code = () => pending()?.c || '';
  function clear(){ lsSet(LS, null); lsSet(LS_OLD, null); }
  const mine = () => { const m = jget(LS_MY); return m && valid(m.c) ? m : null; };
  function setMine(uid, c){ if (uid && valid(c)) lsSet(LS_MY, JSON.stringify({ u: uid, c })); }

  // Запомнить код (первое касание): свой код и мусор — нет; уже есть живой — он и остаётся
  function store(input, src, place){
    const p = parse(input);
    if (!p) return null;
    const my = mine();
    if (my && my.c === p.c) return null;
    const cur = pending();
    if (cur) return cur;
    const rec = { c: p.c, k: p.k, t: now(), s: /^[a-z0-9_]{1,16}$/.test(src || '') ? src : 'link', p: PLACE_RE.test(place || '') ? place : '' };
    lsSet(LS, JSON.stringify(rec));
    lsSet(LS_OLD, rec.c);
    emit('stored', rec);
    return rec;
  }

  // При загрузке страницы: ?ref= → запомнить, из адреса убрать (чтобы не пересылали дальше чужой код)
  function capture(loc = root.location, hist = root.history){
    if (!loc) return pending();
    let rec = null;
    try {
      const u = new URL(loc.href);
      const raw = u.searchParams.get('ref');
      if (raw != null) {
        const place = (u.hash || '').replace(/^#\/?/, '') || u.pathname.replace(/^\/+/, '');
        rec = store(raw, sourceOf(place || ''), place.replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 80));
        u.searchParams.delete('ref');
        if (hist?.replaceState) hist.replaceState(hist.state, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {}
    return rec || pending();
  }

  // Случайный ключ браузера (не отпечаток устройства — просто число в localStorage): «сам себя» с того же браузера
  function device(){
    let d = lsGet(LS_DEV);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(d || '')) {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
      const a = new Uint8Array(24);
      try { root.crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 24; i++) a[i] = Math.floor(Math.random() * 256); }
      d = Array.from(a, x => abc[x & 63]).join('');
      lsSet(LS_DEV, d);
    }
    return d;
  }

  const origin = () => {
    try { const o = root.location?.origin; if (o && /^https?:\/\//.test(o)) return o; } catch (e) {}
    return SITE;
  };
  // Своя ссылка: /r/<код>, to — куда позвать (games/chess/abcd, games/world, g/<id>…)
  function link(c, to){
    if (!valid(c)) return '';
    const t = String(to || '').replace(/^#?\/+/, '');
    return origin() + '/r/' + c + (t && PLACE_RE.test(t) ? '?to=' + encodeURIComponent(t) : '');
  }
  const user = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (e) { return null; } };
  const sbc = () => { try { return typeof sbClient !== 'undefined' ? sbClient : null; } catch (e) { return null; } };
  // Мой код — только если он этого же аккаунта
  const myCode = () => { const m = mine(), u = user(); return m && u && m.u === u.id ? m.c : ''; };
  // Ссылка сайта → с моим кодом (поделиться игрой, комнатой, миром, роликом). Чужие адреса и уже с ref — как есть
  function wrap(url){
    const c = myCode();
    if (!c || !url) return url;
    try {
      const u = new URL(url, origin());
      const own = u.origin === origin() || /(^|\.)dan4ik37\.vercel\.app$/.test(u.hostname);
      if (!own || u.searchParams.has('ref') || /^\/r\//.test(u.pathname)) return url;
      u.searchParams.set('ref', c);
      touch();
      return u.toString();
    } catch (e) { return url; }
  }
  // Поделился ссылкой — сервер запомнит IP/устройство (раз в день; без этого не поймать «пригласил сам себя»)
  function touch(){
    const u = user(), sb = sbc(), k = u ? u.id + ':' + today() : '';
    if (!u || !sb || lsGet(LS_TOUCH) === k) return;
    lsSet(LS_TOUCH, k);
    try { sb.rpc('ref_ping', { p_dev: device(), p_active: true }).then(({ data }) => { if (data?.code) setMine(u.id, data.code); }, () => {}); } catch (e) {}
  }
  // Поделиться: Telegram, ВКонтакте, WhatsApp
  function shareUrls(url, text){
    const e = encodeURIComponent;
    return { tg: `https://t.me/share/url?url=${e(url)}&text=${e(text || '')}`, vk: `https://vk.com/share.php?url=${e(url)}&title=${e(text || '')}`,
      wa: `https://wa.me/?text=${e((text ? text + ' ' : '') + url)}` };
  }

  // Нет таблиц/функций на сервере (referrals2.sql не запущен) — ждём, ничего не теряем
  const noSql = err => /PGRST202|42883|42P01|does not exist|Could not find/i.test(String(err?.code || '') + ' ' + String(err?.message || ''));
  let busy = false;
  // После входа: привязать приглашение (если есть) и раз в день — свой код и метки (только у тех, кто зовёт, и у новичков)
  async function afterAuth(){
    const u = user(), sb = sbc();
    if (!u || !sb || busy) return;
    busy = true;
    try {
      const p = pending(), dev = device();
      if (p && lsGet(LS_DONE) !== u.id) {
        const { data, error } = await sb.rpc('ref_claim', { p_code: p.c, p_dev: dev, p_src: p.s || 'link', p_place: p.p || null });
        if (!error && data) {
          // ответ окончательный (привязан, «уже», «старый аккаунт», «нет кода», «сам себя») — код больше не нужен
          if (data.reason !== 'auth') { clear(); lsSet(LS_DONE, u.id); }
          emit('claim', data);
        } else if (error && !noSql(error)) { /* сеть — попробуем при следующем входе */ }
      }
      const k = u.id + ':' + today();
      if (lsGet(LS_PING) !== k) {
        const { data, error } = await sb.rpc('ref_ping', { p_dev: dev, p_active: false });
        if (!error) { lsSet(LS_PING, k); if (data?.code) setMine(u.id, data.code); }
      }
    } catch (e) {}
    busy = false;
  }

  // Кто позвал по коду (для плашки новичку): { ok, nick, gift }; кэш на визит
  const pubCache = new Map();
  async function publicInfo(c){
    if (!c) return null;
    if (pubCache.has(c)) return pubCache.get(c);
    const sb = sbc();
    if (!sb) return null;
    const pr = sb.rpc('ref_public', { p_code: c }).then(({ data, error }) => (error ? null : data), () => null);
    pubCache.set(c, pr);
    return pr;
  }

  // Рамка «Посол» (ступень t3): пачкой, с кэшем
  const frames = new Map();
  let fq = new Map(), ft = 0, fOff = false;
  function hasFrame(uid){
    if (!uid || fOff) return Promise.resolve(false);
    if (frames.has(uid)) return Promise.resolve(frames.get(uid));
    return new Promise(res => {
      if (!fq.has(uid)) fq.set(uid, []);
      fq.get(uid).push(res);
      clearTimeout(ft);
      ft = setTimeout(flushFrames, 60);
    });
  }
  async function flushFrames(){
    const q = fq; fq = new Map();
    const ids = [...q.keys()], sb = sbc();
    let got = new Set();
    if (sb && ids.length) {
      try {
        const { data, error } = await sb.rpc('ref_frames', { p_ids: ids.slice(0, 200) });
        if (error) { if (noSql(error)) fOff = true; } else got = new Set((data || []).map(x => typeof x === 'string' ? x : x.ref_frames || x.user_id || Object.values(x)[0]));
      } catch (e) {}
    }
    for (const [id, fns] of q) { const v = got.has(id); frames.set(id, v); fns.forEach(f => f(v)); }
  }
  const forgetFrame = uid => { if (uid) frames.delete(uid); else frames.clear(); };

  capture();
  if (root.addEventListener) root.addEventListener('d37:auth', () => { afterAuth(); });

  root.D37Ref = {
    RULES, LADDER, ALPHABET, CODE_RE, SITE,
    valid, parse, gen, capture, store, pending, code, clear, device, mine, setMine, myCode, link, wrap, touch, shareUrls,
    afterAuth, publicInfo, hasFrame, forgetFrame, sourceOf, noSql,
    on(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
