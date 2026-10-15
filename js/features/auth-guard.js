// ═══════════════════════════════════════
//  ВХОД ПО ССЫЛКЕ (#access_token…) — только свой (D37AuthUrl): защита от «подсунутого» чужого аккаунта
// ═══════════════════════════════════════
// Supabase (поток implicit) возвращает на сайт токены входа во фрагменте адреса: письма «подтверди почту» и «смени пароль», вход
// через Google / Discord / Twitch / GitHub. Раньше supabase-js сам принимал ЛЮБУЮ такую ссылку: ссылка, сделанная кем-то из своего
// аккаунта, молча впускала человека в ЧУЖОЙ аккаунт (он вписывает там логин для доната, покупает 💎, пишет в чат — всё достаётся
// автору ссылки). Теперь (владелец 15.10.2026, «дальше работай»):
//  • фрагмент забирает и сразу стирает из адреса крошечный скрипт в <head> index.html — ДО Метрики (у неё url: location.href) и
//    рекламы, иначе токены ушли бы в чужие счётчики → window.__d37AuthHash; supabase-js — detectSessionInUrl: false (chat.js);
//  • молча входим, только если вход начинали В ЭТОМ браузере: отметка d37_authmark (регистрация по почте и «Забыли пароль?» —
//    отпечаток почты, сутки) или d37_oauth (кнопка Google / Discord / Twitch / GitHub, 15 мин, social-login.js) + совпавшая
//    одноразовая метка ?oa=… в адресе возврата — и если на этом устройстве сейчас не открыт ДРУГОЙ аккаунт (тогда спрашиваем всегда);
//  • иначе — окно «Войти как <ник>?» (ник — по самому токену: /auth/v1/user → profiles_public): «Да, это я» / «Нет, не входить»
//    и подсказка детям: такие ссылки присылает только сайт, на твою почту — не бери их у других людей;
//  • после «да» — как раньше делал supabase-js: смена пароля → форма нового пароля, подтверждение почты / вход → d37:auth (и
//    d37:signup новому аккаунту). Переход с одного аккаунта на другой — перезагрузкой страницы (чужое не остаётся в памяти).
// PKCE (flowType 'pkce') не берём: письмо, открытое на другом устройстве (компьютер → телефон), тогда не смогло бы ни войти после
// подтверждения почты, ни сменить пароль — код из письма меняется на вход только в браузере, где его просили.
// Ключи браузера — только свои: d37_authmark (localStorage), d37_url_after (sessionStorage, на одну перезагрузку).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37AuthUrl) return;
  const doc = root.document;
  const MARK = 'd37_authmark', AFTER = 'd37_url_after', MARK_TTL = 24 * 3600e3;
  const BUILTIN = ['google', 'discord', 'twitch', 'github'];
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const ssGet = k => { try { return root.sessionStorage ? root.sessionStorage.getItem(k) : null; } catch (e) { return null; } };
  const ssSet = (k, v) => { try { if (!root.sessionStorage) return; if (v == null) root.sessionStorage.removeItem(k); else root.sessionStorage.setItem(k, String(v)); } catch (e) {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) ? sbClient : null;
  const sbUrl = () => (typeof SB_URL !== 'undefined' ? SB_URL : '');
  const sbKey = () => (typeof SB_KEY !== 'undefined' ? SB_KEY : '');
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); else root.console?.log?.(t); };
  const NAMES = { google: 'Google', discord: 'Discord', twitch: 'Twitch', github: 'GitHub', email: 'почта' };

  // ═══ Фрагмент адреса → что пришло ═══
  function parse(h) {
    const s = String(h || '').replace(/^#/, '');
    if (!s || s.startsWith('/')) return null;
    let q;
    try { q = new URLSearchParams(s); } catch (e) { return null; }
    if (q.get('access_token')) {
      const at = q.get('access_token'), rt = q.get('refresh_token') || '';
      if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(at) || at.length > 8192 || !rt || rt.length > 512) return { bad: true };
      return { at, rt, type: String(q.get('type') || '').slice(0, 20) };   // provider_token сервиса сюда даже не берём
    }
    if (q.get('error') || q.get('error_code') || q.get('error_description'))
      return { err: { error: String(q.get('error') || '').slice(0, 60), code: String(q.get('error_code') || '').slice(0, 60), desc: String(q.get('error_description') || '').slice(0, 200) } };
    return null;
  }
  // Что сохранил скрипт из <head> (он же стёр адрес); нет его (старый index.html в кэше) — сами
  let P = null;
  try {
    const h = root.__d37AuthHash != null ? root.__d37AuthHash : String(root.location?.hash || '');
    P = parse(h);
    if (P && root.__d37AuthHash == null) root.history?.replaceState?.(null, '', String(root.location.pathname || '/') + String(root.location.search || ''));
  } catch (e) { P = null; }

  // ═══ Отметки «вход начат здесь»: регистрация по почте / «Забыли пароль?» — отпечаток почты (не сама почта), сутки ═══
  async function hashMail(e) {
    const s = String(e || '').trim().toLowerCase();
    if (!s || !root.crypto?.subtle) return '';
    const b = new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode('d37:' + s)));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  function marks() {
    try { const a = JSON.parse(lsGet(MARK) || '[]'); return Array.isArray(a) ? a.filter(m => m && Date.now() - (+m.at || 0) < MARK_TTL) : []; }
    catch (e) { return []; }
  }
  async function mark(kind, email) {
    if (!['signup', 'recovery', 'magiclink'].includes(kind)) return;
    const e = await hashMail(email);
    if (!e) return;
    const a = marks().filter(m => !(m.k === kind && m.e === e)).concat({ k: kind, e, at: Date.now() }).slice(-6);
    lsSet(MARK, JSON.stringify(a));
  }
  const KINDS = { signup: ['signup'], magiclink: ['magiclink', 'signup'], recovery: ['recovery'] };
  async function findMark(type, email) {
    const kinds = KINDS[type];
    if (!kinds) return null;
    const e = await hashMail(email);
    return e ? marks().find(m => kinds.includes(m.k) && m.e === e) || null : null;
  }
  function dropMark(m) { if (m) lsSet(MARK, JSON.stringify(marks().filter(x => !(x.k === m.k && x.e === m.e && x.at === m.at)))); }

  // ═══ Решение: молча или спросить (чистая функция — проверяется в node) ═══
  // o: { type, uid — чей токен, cur — кто открыт сейчас, mark — отметка подходит, pend — d37_oauth, providers — входы аккаунта токена }
  function decide(o) {
    if (o.cur && o.cur !== o.uid) return 'ask';      // на устройстве открыт ДРУГОЙ аккаунт — спрашиваем всегда
    if (o.cur && o.cur === o.uid) return 'silent';   // тот же аккаунт (привязка входа, смена своего пароля) — ничего не меняется
    const t = o.type || '';
    if (KINDS[t]) return o.mark ? 'silent' : 'ask';
    if (!t) {   // Google / Discord / Twitch / GitHub: кнопку нажимали здесь, недавно, метка ?oa=… этого входа совпала, у аккаунта есть этот вход
      const p = o.pend;
      return p && p.m === 'login' && o.nonceOk && BUILTIN.includes(p.p) && (o.providers || []).includes(p.p) ? 'silent' : 'ask';
    }
    return 'ask';   // invite, email_change и прочее — только с согласия
  }

  // ═══ Сервер Supabase: чей это токен (без входа на сайте) и какой у него ник ═══
  async function fetchUser(at) {
    try {
      const r = await root.fetch(`${sbUrl()}/auth/v1/user`, { headers: { apikey: sbKey(), Authorization: 'Bearer ' + at } });
      if (!r.ok) return null;
      const u = await r.json();
      return u && typeof u.id === 'string' ? u : null;
    } catch (e) { return null; }
  }
  async function fetchNick(uid, at) {
    for (const t of ['profiles_public', 'profiles']) {
      try {
        const r = await root.fetch(`${sbUrl()}/rest/v1/${t}?id=eq.${encodeURIComponent(uid)}&select=nick`, { headers: { apikey: sbKey(), Authorization: 'Bearer ' + at } });
        if (!r.ok) continue;
        const a = await r.json();
        if (Array.isArray(a) && a[0]?.nick) return String(a[0].nick).slice(0, 40);
      } catch (e) {}
    }
    return '';
  }
  // Кто открыт на этом устройстве сейчас (сохранённая сессия supabase-js) → { id, at }
  async function current() {
    try { const { data } = await sb().auth.getSession(); const s = data?.session; return s?.user?.id ? { id: s.user.id, at: s.access_token } : null; }
    catch (e) { return null; }
  }
  const maskMail = e => { const [u, d] = String(e || '').split('@'); return d && !/\.invalid$/i.test(d) ? u.slice(0, 2) + '•••@' + d : ''; };
  const pending = () => { try { return root.D37Login?.pending?.() || null; } catch (e) { return null; } };

  // ═══ Окно «Войти как …?» ═══
  function css() {
    if (!doc?.head || doc.getElementById('d37UrlCss')) return;
    const s = doc.createElement('style'); s.id = 'd37UrlCss';
    s.textContent = `
.ulg-ov{position:fixed;inset:0;z-index:100700;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem;
  background:rgba(5,4,10,.86);backdrop-filter:blur(10px);font-family:Montserrat,system-ui,sans-serif;color:#f0f0f8}
.ulg-box{margin:auto 0;width:min(400px,100%);padding:1.25rem 1.2rem 1.1rem;border-radius:18px;background:#15131f;border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.65)}
.ulg-h{font:800 1.08rem/1.3 Montserrat,system-ui,sans-serif;margin:0 0 .7rem}
.ulg-who{display:flex;align-items:center;gap:.7rem;padding:.7rem .8rem;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);margin-bottom:.7rem}
.ulg-av{width:42px;height:42px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;background:linear-gradient(135deg,#9147ff,#ff2d55);color:#fff}
.ulg-who b{display:block;font-size:.95rem;word-break:break-word}.ulg-who small{display:block;font-size:.72rem;color:#9a9ab5;margin-top:.1rem}
.ulg-box p{margin:.35rem 0 .55rem;font-size:.8rem;line-height:1.5;color:rgba(240,240,248,.86)}
.ulg-cur{color:#ffd166!important}
.ulg-warn{padding:.6rem .7rem;border-radius:12px;background:rgba(255,45,85,.08);border:1px solid rgba(255,45,85,.3);font-size:.74rem!important}
.ulg-act{display:flex;gap:.5rem;margin-top:.85rem;flex-wrap:wrap}
.ulg-act button{flex:1 1 140px;min-height:44px;border-radius:12px;font:800 .82rem Montserrat,system-ui,sans-serif;cursor:pointer}
.ulg-yes{border:0;background:linear-gradient(135deg,#9147ff,#6d28d9);color:#fff}
.ulg-no{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#f0f0f8}
.ulg-act button:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
    doc.head.appendChild(s);
  }
  // → Promise<boolean>: true — «Да, это я»
  function askModal(o) {
    return new Promise(resolve => {
      if (!doc?.body) { resolve(false); return; }
      css();
      const t = o.type || '';
      const head = t === 'recovery' ? '🔑 Сменить пароль?' : t === 'signup' ? '✅ Почта подтверждена' : '🔐 Войти по ссылке?';
      const lead = t === 'recovery' ? 'Ссылка — для смены пароля этого аккаунта. После «Да» ты войдёшь в него и придумаешь новый пароль.'
        : t === 'signup' ? 'Войти в этот аккаунт на этом устройстве?'
        : 'Ссылка открывает вход в этот аккаунт. Входить, только если это твой аккаунт и ты сам(а) только что входил(а).';
      const via = (o.user?.identities || []).map(i => NAMES[i.provider]).filter(Boolean);
      const sub = [maskMail(o.user?.email), via.length ? 'вход: ' + [...new Set(via)].join(', ') : ''].filter(Boolean).join(' · ');
      const ov = doc.createElement('div');
      ov.className = 'ulg-ov ym-hide-content'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'ulgH');
      ov.innerHTML = `<div class="ulg-box">
        <div class="ulg-h" id="ulgH">${head}</div>
        <div class="ulg-who"><span class="ulg-av" aria-hidden="true">${esc((o.nick || '?').slice(0, 2).toUpperCase())}</span><div><b>${esc(o.nick || 'Аккаунт без ника')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>
        <p>${esc(lead)}</p>
        ${o.curNick !== undefined ? `<p class="ulg-cur">Сейчас на этом устройстве открыт аккаунт «${esc(o.curNick || 'другой')}». «Да» — выйдешь из него и войдёшь в «${esc(o.nick || 'этот')}».</p>` : ''}
        <p class="ulg-warn">⚠️ Ссылку для входа присылает только сайт — тебе на почту и только когда ты сам(а) просил(а). Если ссылку прислал кто-то другой (в чате, в игре, в личке) — нажми «Нет»: так тебя пытаются впустить в чужой аккаунт, и всё, что ты там сделаешь, достанется ему.</p>
        <div class="ulg-act"><button type="button" class="ulg-yes">Да, это я</button><button type="button" class="ulg-no">Нет, не входить</button></div>
      </div>`;
      const done = v => { ov.remove(); doc.removeEventListener('keydown', key, true); resolve(v); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); } };
      ov.querySelector('.ulg-yes').onclick = () => done(true);
      ov.querySelector('.ulg-no').onclick = () => done(false);
      doc.addEventListener('keydown', key, true);
      doc.body.appendChild(ov);
      try { ov.querySelector('.ulg-no').focus({ preventScroll: true }); } catch (e) {}   // по умолчанию — «Нет»
    });
  }

  // ═══ Ошибки ссылок (письмо устарело и т. п.) ═══
  const ERR_TEXT = {
    otp_expired: 'Ссылка из письма устарела или уже использована. Войди как обычно или запроси новое письмо («Забыли пароль?»).',
    expired: 'Ссылка для входа устарела или уже использована. Войди как обычно.',
    other: 'Вход по ссылке не удался. Попробуй войти как обычно.',
  };
  function showErr(text) {
    const signedIn = typeof currentUser !== 'undefined' && !!currentUser;
    if (!signedIn && typeof openLoginModal === 'function') {
      try { openLoginModal('login'); } catch (e) {}
      const el = doc?.getElementById('gauthErr');
      if (el) { el.style.color = ''; el.textContent = text; return; }
    }
    toast(text);
  }

  // ═══ После входа — то же, что раньше делал supabase-js ═══
  const go = h => { if (root.location.hash !== h) root.location.hash = h; else if (/^#\/profile/.test(h) && typeof renderProfilePage === 'function') renderProfilePage(); };
  function afterAccept(a, user) {
    if (a.t === 'recovery') {   // было: событие PASSWORD_RECOVERY → форма нового пароля (chat.js)
      if (typeof openLoginModal === 'function') { try { openLoginModal(); switchAuthTab('reset'); } catch (e) {} }
      return;
    }
    if (a.t === 'signup') {
      toast('✅ Почта подтверждена — ты вошёл!');
      if (Date.now() - (Date.parse(user?.created_at || '') || 0) < 3 * 864e5) root.D37Login?.signup?.('email', user.id);   // первый вход нового аккаунта
      go('#/profile');
      return;
    }
    if (a.t === 'oauth') { root.D37Login?.afterOAuth?.(user, a.asked); if (a.asked) toast('👋 Ты вошёл'); return; }   // d37_after_login (chat.js) — в профиль, как раньше
    toast('👋 Ты вошёл');
  }
  // Приняли вход по ссылке
  async function accept(link, user, o) {
    const switching = !!(o.cur && o.cur !== user.id);
    let res;
    try { res = await sb().auth.setSession({ access_token: link.at, refresh_token: link.rt }); } catch (e) { res = { error: e }; }
    const u = res?.data?.user || res?.data?.session?.user;
    if (res?.error || !u) { showErr(ERR_TEXT.expired); return false; }
    dropMark(o.mark);
    const a = { t: link.type || 'oauth', u: u.id, asked: !!o.asked };
    if (switching) {   // был открыт другой аккаунт — начисто, перезагрузкой; что сделать после — на одну перезагрузку
      ssSet(AFTER, JSON.stringify(a));
      root.location.reload();
      return true;
    }
    if (typeof onAuthStateChange === 'function') { try { await onAuthStateChange(u); } catch (e) {} }
    afterAccept(a, u);
    return true;
  }

  // ═══ Главное: пришла ссылка с токенами ═══
  async function handle(link) {
    if (!sb()) return;
    if (link.bad) { showErr(ERR_TEXT.expired); return; }
    const user = await fetchUser(link.at);   // проверяет сам Supabase (подпись и срок токена)
    if (!user) { showErr(ERR_TEXT.expired); return; }
    const cs = await current();
    const cur = cs?.id || null;
    const m = !cur && KINDS[link.type] ? await findMark(link.type, user.email) : null;
    const pend = pending();
    const nonceOk = !!(pend && pend.n && root.__d37OA && pend.n === root.__d37OA);   // метка из адреса возврата (?oa=…) — своего входа
    root.__d37OA = null;   // метка — на одну ссылку
    const decision = decide({ type: link.type, uid: user.id, cur, mark: !!m, pend, nonceOk, providers: (user.identities || []).map(i => i.provider) });
    if (decision === 'silent') return accept(link, user, { cur, mark: m });
    const nick = await fetchNick(user.id, link.at);
    const curNick = cur && cur !== user.id
      ? ((typeof currentProfile !== 'undefined' && currentProfile?.id === cur && currentProfile.nick) || await fetchNick(cur, cs.at))
      : undefined;
    const yes = await askModal({ type: link.type, user, nick, curNick });
    if (!yes) { toast('Вход по ссылке отменён — всё осталось как было'); return; }
    return accept(link, user, { cur, mark: m, asked: true });
  }
  async function handleErr(err) {
    if (pending()) return;   // вход через Google / Discord… начинали здесь — ошибку покажет social-login.js
    const s = `${err.code} ${err.error} ${err.desc}`.toLowerCase();
    showErr(/otp_expired|expired|invalid/.test(s) ? ERR_TEXT.otp_expired : ERR_TEXT.other);
  }

  // После перезагрузки (смена аккаунта): дождаться входа и сделать «что после». Подписка — сразу при загрузке файла: вход из
  // сохранённой сессии (init.js → onAuthStateChange → d37:auth) может случиться ещё до DOMContentLoaded
  function afterReload() {
    let a = null;
    try { a = JSON.parse(ssGet(AFTER) || 'null'); } catch (e) {}
    if (!a || !root.addEventListener) return;
    let done = false;
    const stop = () => { done = true; root.removeEventListener('d37:auth', run); ssSet(AFTER, null); };
    function run() {
      const u = typeof currentUser !== 'undefined' ? currentUser : null;
      if (done || !u) return;
      stop();
      if (u.id === a.u) setTimeout(() => afterAccept(a, u), 0);
    }
    root.addEventListener('d37:auth', run);
    setTimeout(stop, 20000);
  }
  afterReload();

  function boot() {
    const link = P; P = null;
    if (!link) return;
    if (link.err) { handleErr(link.err); return; }
    handle(link).catch(e => { root.console?.warn?.('вход по ссылке:', e); showErr(ERR_TEXT.other); });
  }
  if (doc?.addEventListener) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    // токены пришли без перезагрузки (ссылка «#access_token…» на этой же странице) — убрать из адреса и разобрать так же
    root.addEventListener?.('hashchange', () => {
      const link = parse(root.location.hash);
      if (!link || (!link.at && !link.bad)) return;
      root.history?.replaceState?.(null, '', String(root.location.pathname || '/') + String(root.location.search || ''));
      handle(link).catch(() => showErr(ERR_TEXT.other));
    });
  }

  root.D37AuthUrl = { mark, _test: { parse, decide, hashMail, marks, findMark, dropMark, KINDS } };
})();
