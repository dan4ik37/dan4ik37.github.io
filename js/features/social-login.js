// ═══════════════════════════════════════
//  ВХОД ЧЕРЕЗ ДРУГИЕ СЕРВИСЫ (D37Login) и «я не робот» (D37Captcha)
// ═══════════════════════════════════════
// Владелец 15.10.2026: «можно сделать вход через другие сервисы, но чтобы не было обходов и вредных действий для сайта и ботов».
// Входы — только включённые (кнопки появляются сами):
//  • свои, через сервер сайта (api/_lib/routes/oauth.js): VK ID, Яндекс ID, Telegram — /api/oauth?a=providers (переменные Vercel +
//    auth-links.sql). Вход: /auth/<p>/start?b=<отпечаток секрета вкладки> → сервис → #d37auth=<пропуск> → /api/oauth?a=finish {k, f}
//    → verifyOtp({ token_hash, type: 'magiclink' }). Пропуск откроется только в этом браузере (секрет вкладки — в d37_oauth);
//  • встроенные в Supabase: Google, Discord, Twitch, GitHub — /auth/v1/settings → external.<p>.
// Привязать / отвязать — профиль → «Способы входа» (#profileLogins, #/profile/logins): только со свежим входом (не старше 15 мин —
// иначе «Подтверди, что это ты»); последний способ войти отвязать нельзя (сервер тоже не даст). Модераторам — «связанные входы».
// Новый аккаунт через любой из этих входов → событие d37:signup { provider, userId } (код приглашения и т. п. — у других модулей).
// Ключи браузера — только свои: d37_oauth (начатый вход), d37_login_fails (неудачные входы), d37_signup_<id>; чужие не трогаем.
// «Я не робот» — Cloudflare Turnstile: номер сайта TURNSTILE_SITE_KEY в js/core/config.js (пусто — выключено). Пошагово — docs/LOGIN_PROVIDERS.md.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Login) return;
  const doc = root.document;
  const BUILTIN = ['google', 'discord', 'twitch', 'github'];
  const OWN = ['vk', 'yandex', 'tg'];
  const ORDER = ['vk', 'tg', 'yandex', 'google', 'discord', 'twitch', 'github'];   // для зрителей из России и Казахстана
  const NAME = { vk: 'VK ID', tg: 'Telegram', yandex: 'Яндекс ID', google: 'Google', discord: 'Discord', twitch: 'Twitch', github: 'GitHub' };
  const PEND = 'd37_oauth', FAILS = 'd37_login_fails', FRESH = 15 * 60, PEND_TTL = 15 * 60e3;
  const ERR_CODES = ['denied', 'state', 'used', 'expired', 'browser', 'provider', 'banned', 'rate', 'busy', 'taken', 'has', 'reauth', 'off', 'server',
    'last', 'other', 'bad', 'auth', 'not_found'];
  const ICON = {
    vk: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.204.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.254-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.763-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>',
    yandex: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#FC3F1D"/><text x="12" y="17.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="15" fill="#fff">Я</text></svg>',
    google: '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
    discord: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
    twitch: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>',
    github: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
    email: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.4V17h16V7.4l-8 5.3-8-5.3zM5.6 7l6.4 4.2L18.4 7H5.6z"/></svg>',
  };

  // ═══ Мелочи ═══
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (root.localStorage) root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const lsDel = k => { try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) ? sbClient : null;
  const me = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const role = () => (typeof currentRole !== 'undefined' ? currentRole : null);
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); else root.console?.log?.(t); };
  const b64u = bytes => root.btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rnd = () => { const a = new Uint8Array(32); root.crypto.getRandomValues(a); return b64u(a); };
  async function shaB64(s) { return b64u(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
  function b64json(s) {
    try {
      let x = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
      while (x.length % 4) x += '=';
      const bin = root.atob(x), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  const fmtDate = iso => { const t = Date.parse(iso || ''); return t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  const maskMail = e => { const [u, d] = String(e || '').split('@'); return d ? (u.slice(0, 2) + '•••@' + d) : ''; };
  const isSynthetic = u => !!u && (/@id\.invalid$/i.test(String(u.email || '')) || (!!u.app_metadata?.d37_synth_email && u.app_metadata.d37_synth_email === u.email));

  // ═══ «Начал вход / привязку» — своя отметка (секрет вкладки для пропуска, что делать после) ═══
  function setPending(o) { lsSet(PEND, JSON.stringify({ ...o, at: Date.now() })); }
  function getPending() {
    try { const o = JSON.parse(lsGet(PEND) || 'null'); return o && typeof o === 'object' && Date.now() - (+o.at || 0) < PEND_TTL ? o : null; }
    catch (e) { return null; }
  }
  const clearPending = () => lsDel(PEND);

  // ═══ Возврат во фрагменте адреса — только наш (#d37auth / #d37auth_err / #d37link / #tgAuthResult / ошибка Supabase) ═══
  function parseReturn(hash) {
    const h = String(hash || '').replace(/^#/, '');
    if (!h || h.startsWith('/')) return null;
    const tg = h.match(/(?:^|&)tgAuthResult=([A-Za-z0-9_=+/-]{4,4000})(?:&|$)/);
    if (tg) { const j = b64json(tg[1]); return j && typeof j === 'object' && !Array.isArray(j) ? { tg: j } : null; }
    let q;
    try { q = new URLSearchParams(h); } catch (e) { return null; }
    if (q.has('d37auth')) { const k = q.get('d37auth') || ''; return /^[A-Za-z0-9_-]{20,4000}$/.test(k) ? { auth: k } : null; }
    if (q.has('d37auth_err')) {
      const e = q.get('d37auth_err'), p = q.get('p') || '';
      return { err: ERR_CODES.includes(e) ? e : 'server', p: NAME[p] ? p : '' };
    }
    if (q.has('d37link')) { const p = q.get('d37link'); return { link: OWN.includes(p) ? p : undefined }; }
    if (q.has('error') && (q.has('error_description') || q.has('error_code')))
      return { sb: { error: String(q.get('error') || '').slice(0, 60), code: String(q.get('error_code') || '').slice(0, 60), desc: String(q.get('error_description') || '').slice(0, 200) } };
    return null;
  }
  // Сразу при загрузке (до роутера): наш фрагмент забрать и стереть из адреса (в истории браузера пропуска не останется)
  let early = null, sbReturn = false;
  try {
    const h = String(root.location?.hash || '');
    sbReturn = /(?:^#|&)access_token=/.test(h);   // вернулись из Google / Discord… — сессию из адреса заберёт supabase-js
    const r = parseReturn(h);
    if (r && (!r.sb || getPending())) {
      early = r;
      root.history?.replaceState?.(null, '', String(root.location.pathname || '/') + String(root.location.search || ''));
    }
  } catch (e) {}

  // ═══ Какие входы включены ═══
  let provP = null;
  function buttons(b, o) {
    b = b || {}; o = o || {};
    return ORDER.filter(p => BUILTIN.includes(p) ? b[p] === true : p === 'tg' ? !!(o.tg && (o.tg.mode === 'oidc' || (o.tg.mode === 'widget' && o.tg.id))) : o[p] === true);
  }
  function providers(force) {
    if (provP && !force) return provP;
    const url = typeof SB_URL !== 'undefined' ? SB_URL : '', key = typeof SB_KEY !== 'undefined' ? SB_KEY : '';
    const b = url && root.fetch ? root.fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then(r => (r.ok ? r.json() : {})).then(j => j?.external || {}).catch(() => ({})) : Promise.resolve({});
    const o = root.fetch ? root.fetch('/api/oauth?a=providers').then(r => (r.ok ? r.json() : {})).catch(() => ({})) : Promise.resolve({});
    provP = Promise.all([b, o]).then(([bb, oo]) => ({ b: bb || {}, o: oo || {}, list: buttons(bb, oo) }));
    return provP;
  }

  // ═══ Тексты (детям понятно, без кодов) ═══
  const ERR = {
    denied: 'Вход отменён — ничего страшного, можно попробовать ещё раз.',
    state: 'Вход устарел или открыт в другой вкладке. Нажми кнопку ещё раз и не закрывай эту вкладку.',
    used: 'Эта попытка входа уже использована. Нажми кнопку ещё раз.',
    expired: 'Вход занял слишком много времени. Нажми кнопку ещё раз.',
    browser: 'Вход начали в другом браузере или окне. Открой сайт там же, где нажимал кнопку, и попробуй снова.',
    provider: '{P} сейчас не ответил. Попробуй ещё раз через минуту.',
    banned: 'Этот аккаунт {P} заблокирован на сайте за нарушение правил — новый аккаунт через него не создать.',
    rate: 'С твоего интернета сегодня уже создали много аккаунтов. Попробуй завтра или войди в свой аккаунт.',
    busy: 'Сейчас на сайте слишком много новых аккаунтов. Попробуй через час.',
    taken: 'Этот {P} уже привязан к другому аккаунту сайта. Войди через него или сначала отвяжи его там.',
    has: 'К твоему аккаунту уже привязан другой {P}. Сначала отвяжи его.',
    reauth: 'Для безопасности войди ещё раз (вход должен быть не старше 15 минут) и повтори.',
    auth: 'Сначала войди в свой аккаунт.',
    off: 'Вход через {P} пока выключен.',
    last: 'Это последний способ войти в аккаунт — сначала привяжи другой.',
    other: 'Это другой аккаунт {P}, не тот, что привязан к твоему профилю. Выбери свой.',
    not_found: 'Этот вход уже отвязан.',
    bad: 'Что-то пошло не так. Нажми кнопку ещё раз.',
    server: 'Что-то пошло не так. Попробуй ещё раз чуть позже.',
    linkoff: 'Привязка входов пока не включена на сайте.',
    sbfail_login: 'Не получилось войти через {P}. Если у тебя уже есть аккаунт с этой почтой — войди как обычно и привяжи {P} в профиле → «Способы входа». Если этот {P} заблокирован на сайте — новый аккаунт через него не создать.',
    sbfail_link: 'Не получилось привязать {P}. Так бывает, если он заблокирован на сайте или его почта — почта другого аккаунта сайта. Войди ещё раз и попробуй снова.',
    signup_off: 'Новые аккаунты через {P} сейчас не создаются.',
  };
  const errText = (code, p) => (ERR[code] || ERR.server).replace(/\{P\}/g, NAME[p] || 'сервис');
  // Ошибка встроенного входа Supabase → наш код
  function sbCode(e, mode) {
    const s = `${e?.code || ''} ${e?.error_code || ''} ${e?.error || ''} ${e?.message || ''} ${e?.desc || ''}`.toLowerCase();
    if (/identity_already_exists|already.*linked|already exists/.test(s)) return 'taken';
    if (/manual_linking_disabled|manual linking/.test(s)) return 'linkoff';
    if (/access_denied|denied|cancel/.test(s)) return 'denied';
    if (/signup.*(disabled|not allowed)/.test(s)) return 'signup_off';
    if (/single_identity|at least 2|last/.test(s)) return 'last';
    if (/reauth|aal|session/.test(s) && mode === 'link') return 'reauth';
    if (/failed to fetch|network/.test(s)) return 'provider';
    return mode === 'link' ? 'sbfail_link' : 'sbfail_login';
  }

  // ═══ Свежий вход (amr — время, когда человек ВХОДИЛ, а не продлевал сессию) ═══
  function freshAt(tok) {
    const c = b64json(String(tok || '').split('.')[1]);
    const t = (Array.isArray(c?.amr) ? c.amr : []).map(a => +a?.timestamp).filter(Number.isFinite);
    return t.length ? Math.max(...t) : 0;
  }
  const isFresh = tok => { const at = freshAt(tok), now = Date.now() / 1000; return at > now - FRESH && at < now + 300; };
  async function accessToken() { try { const { data } = await sb().auth.getSession(); return data?.session?.access_token || ''; } catch (e) { return ''; } }

  // ═══ Способы входа: сколько их и можно ли отвязать (последний — нельзя) ═══
  function ways(m, enabled) {
    if (!m) return 0;
    const on = p => (enabled || []).includes(p);
    return (m.email ? 1 : 0) + (m.links || []).filter(l => on(l.provider)).length + (m.identities || []).filter(i => on(i.provider)).length;
  }
  const canUnlink = (m, enabled, p) => ways(m, enabled) - ((enabled || []).includes(p) ? 1 : 0) >= 1;

  async function postJson(url, body, token) {
    try {
      const r = await root.fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
      return await r.json().catch(() => ({ ok: false, reason: r.status === 401 ? 'auth' : 'server' }));
    } catch (e) { return { ok: false, reason: 'provider' }; }
  }
  async function rpc(name, args) {   // нет auth-links.sql → null (тогда без своих входов, как раньше)
    try {
      const { data, error } = await sb().rpc(name, args || {});
      if (error) return error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || '') ? null : { ok: false, reason: 'server' };
      return data;
    } catch (e) { return { ok: false, reason: 'server' }; }
  }
  function signup(provider, userId) {   // первый вход нового аккаунта — один раз
    if (!userId || lsGet('d37_signup_' + userId)) return;
    lsSet('d37_signup_' + userId, '1');
    try { root.dispatchEvent(new root.CustomEvent('d37:signup', { detail: { provider, userId } })); } catch (e) {}
  }
  function go(h) {
    if (root.location.hash !== h) { root.location.hash = h; return; }
    if (/^#\/profile/.test(h) && typeof renderProfilePage === 'function') renderProfilePage(h.split('/')[2] || undefined);
  }
  // Токены сервиса (provider_token) supabase-js кладёт в сохранённую сессию — сайту они не нужны, убираем
  function scrubProviderTokens() {
    try {
      const url = typeof SB_URL !== 'undefined' ? SB_URL : '';
      if (!url) return;
      const k = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
      const s = JSON.parse(lsGet(k) || 'null');
      if (s && (s.provider_token || s.provider_refresh_token)) { delete s.provider_token; delete s.provider_refresh_token; lsSet(k, JSON.stringify(s)); }
    } catch (e) {}
  }

  // ═══ Telegram: виджет (окошко Telegram поверх) ═══
  let tgP = null;
  function loadTg() {
    if (root.Telegram?.Login?.auth) return Promise.resolve();
    if (!tgP && doc) tgP = new Promise((res, rej) => {
      const s = doc.createElement('script');
      s.src = 'https://telegram.org/js/telegram-widget.js?22'; s.async = true;
      s.onload = () => res(); s.onerror = () => { tgP = null; rej(new Error('tg')); };
      doc.head.appendChild(s);
    });
    return tgP || Promise.reject(new Error('tg'));
  }
  async function tgPopup(o, mode, opts = {}) {
    if (!root.Telegram?.Login?.auth) { loadTg().catch(() => {}); note(mode, 'Секунду — Telegram ещё загружается. Нажми кнопку ещё раз.'); return; }
    setPending({ p: 'tg', m: mode, uid: opts.uid || null, then: opts.then || null });
    root.Telegram.Login.auth({ bot_id: o.id, request_access: false, lang: 'ru' }, user => { if (!user) { clearPending(); return; } tgDone(user); });
  }
  async function tgDone(user) {
    const pend = getPending() || { p: 'tg', m: 'login' };
    if (pend.m === 'link') {
      const r = await postJson('/api/oauth?a=tglink', { user }, await accessToken());
      clearPending();
      if (r?.ok) { toast('✅ Telegram привязан — теперь можно входить и через него'); renderMethods(); return; }
      if (r?.reason === 'reauth' || r?.reason === 'auth') { showReauth('tg'); return; }
      return methodsStatus(errText(r?.reason, 'tg'), true);
    }
    const r = await postJson('/api/oauth?a=tg', { user, n: '#/profile', x: pend.m === 'reauth' ? pend.uid : undefined });
    return finishToken(r, pend);
  }

  // ═══ Вход ═══
  async function start(p, opts = {}) {
    const mode = opts.mode || 'login';   // login | reauth («подтверди, что это ты»)
    const P = await providers();
    if (!P.list.includes(p)) return showErr('off', p, mode);
    if (typeof root.va === 'function') { try { root.va('event', { name: 'oauth_click', data: { provider: p } }); } catch (e) {} }
    if (BUILTIN.includes(p)) {
      if (!sb()) return showErr('server', p, mode);
      setPending({ p, m: mode, uid: opts.uid || null, then: opts.then || null });
      if (mode === 'login') lsSet('d37_after_login', '#/profile');   // как раньше: после входа — свой профиль (chat.js)
      const { error } = await sb().auth.signInWithOAuth({ provider: p, options: { redirectTo: root.location.origin + '/' } });
      if (error) { clearPending(); showErr(sbCode(error, 'login'), p, mode); }
      return;
    }
    if (p === 'tg' && P.o.tg?.mode === 'widget') return tgPopup(P.o.tg, mode, opts);
    const f = rnd(), b = await shaB64(f);
    setPending({ p, m: mode, f, uid: opts.uid || null, then: opts.then || null });
    let u = `/auth/${p}/start?b=${b}&n=${encodeURIComponent(opts.next || '#/profile')}`;
    if (mode === 'reauth') u += `&m=reauth&u=${encodeURIComponent(opts.uid || '')}`;
    root.location.href = u;
  }
  async function finishHandoff(k) {
    const pend = getPending();
    if (!pend?.f) return showErr('browser', pend?.p || '', pend?.m);
    const r = await postJson('/api/oauth?a=finish', { k, f: pend.f });
    return finishToken(r, pend);
  }
  async function finishToken(r, pend) {
    const p = r?.provider || pend?.p || '';
    if (!r?.ok) return showErr(r?.reason || 'server', p, pend?.m);
    if (!sb()) return showErr('server', p, pend?.m);
    let res = await sb().auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
    if (res.error) res = await sb().auth.verifyOtp({ token_hash: r.token_hash, type: 'email' });
    const user = res.data?.user || res.data?.session?.user;
    if (res.error || !user) return showErr('server', p, pend?.m);
    clearPending();
    if (typeof onAuthStateChange === 'function') { try { await onAuthStateChange(user); } catch (e) {} }
    if (r.new) signup(p, user.id);
    if (typeof closeGlobalAuth === 'function') { try { closeGlobalAuth(); } catch (e) {} }
    if (pend?.m === 'reauth') { cont = pend.then || null; toast('🔐 Готово — это ты'); return go('#/profile/logins'); }
    toast(r.new ? `🎉 Аккаунт создан через ${NAME[p]}! Придумай ник — так тебя увидят в чате и играх` : `👋 Вход через ${NAME[p]}`);
    go(r.new ? '#/profile' : (r.next || '#/profile'));
  }
  // Ошибка: вход — в окне входа; привязка — в «Способах входа»
  function showErr(code, p, mode) {
    const t = errText(code, p);
    clearPending();
    if (mode === 'link' || mode === 'reauth' || (me() && ['taken', 'has', 'reauth', 'last', 'linkoff'].includes(code))) {
      if (doc?.getElementById('profileLogins') && /^#\/profile/.test(root.location.hash)) methodsStatus(t, true);
      else { errAfter = t; go('#/profile/logins'); }
      return;
    }
    if (!me() && typeof openLoginModal === 'function') { try { openLoginModal('login'); } catch (e) {} }
    const el = doc?.getElementById('gauthErr');
    if (el && doc.getElementById('globalAuthModal')?.classList.contains('open')) { el.style.color = ''; el.textContent = t; }
    else toast(t);
  }
  const note = (mode, t) => { if (mode === 'login') { const el = doc?.getElementById('gauthErr'); if (el) { el.style.color = 'var(--muted)'; el.textContent = t; return; } } methodsStatus(t); };

  // Вернулись на сайт: свой пропуск / ошибка / привязка / Telegram / ошибка Supabase
  function resume() {
    if (!early) return;
    const e = early; early = null;
    if (e.auth) return finishHandoff(e.auth);
    if (e.err) return showErr(e.err, e.p, getPending()?.m);
    if (e.link) { clearPending(); toast(`✅ ${NAME[e.link] || 'Вход'} привязан — теперь можно входить и через него`); return go('#/profile/logins'); }
    if (e.tg) { const pend = getPending(); if (pend?.p === 'tg') return tgDone(e.tg); return; }   // чужая ссылка с данными Telegram — не наша
    if (e.sb) { const pend = getPending(); if (pend) showErr(sbCode(e.sb, pend.m), pend.p, pend.m); }
  }
  // Встроенный вход (Google, Discord…) вернул сессию → новый аккаунт? привязка? «это ты»?
  function afterAuth() {
    if (!sbReturn) return;
    const pend = getPending();
    if (!pend || !BUILTIN.includes(pend.p) || !me()) return;
    sbReturn = false;
    clearPending();
    scrubProviderTokens();
    const u = me(), has = (u.identities || []).some(i => i.provider === pend.p);
    if (pend.m === 'link') { if (has) toast(`✅ ${NAME[pend.p]} привязан — теперь можно входить и через него`); return go('#/profile/logins'); }
    if (pend.m === 'reauth') {
      if (pend.uid && u.id !== pend.uid) { errAfter = 'Ты вошёл в другой аккаунт. Чтобы привязать вход к прежнему — выйди и войди в него.'; return go('#/profile/logins'); }
      cont = pend.then || null; return go('#/profile/logins');
    }
    const created = Date.parse(u.created_at || '') || 0;
    if (has && Date.now() - created < 10 * 60e3) signup(pend.p, u.id);
  }

  // ═══ Окно входа: блок «Войти через…» (#gauthOauth в index.html) ═══
  function modalMode() {
    const r = doc?.getElementById('gauthRegisterFields'), x = doc?.getElementById('gauthResetFields');
    return x && x.style.display === 'block' ? 'reset' : r && r.style.display === 'block' ? 'register' : 'login';
  }
  const btnHtml = (p, reg) => `<button type="button" class="lgn-btn lgn-${p}" data-lgn-login="${p}" aria-label="${reg ? 'Зарегистрироваться' : 'Войти'} через ${esc(NAME[p])}"><span class="lgn-ic" aria-hidden="true">${ICON[p]}</span><span class="lgn-t">${esc(NAME[p])}</span></button>`;
  async function renderModal(mode) {
    if (!doc) return;
    css();
    const box = doc.getElementById('gauthOauth');
    if (!box) return;
    mode = mode || modalMode();
    if (mode === 'reset') { box.hidden = true; return; }
    D37Captcha.mount(mode === 'register' ? 'register' : 'login');
    const P = await providers();
    if (!P.list.length) { box.hidden = true; box.innerHTML = ''; return; }
    if (P.list.includes('tg') && P.o.tg?.mode === 'widget') loadTg().catch(() => {});
    const reg = mode === 'register';
    box.innerHTML = `<div class="lgn-head">${reg ? '⚡ Регистрация в один клик' : '⚡ Быстрый вход'}</div>
      <div class="lgn-grid${P.list.length === 1 ? ' one' : ''}">${P.list.map(p => btnHtml(p, reg)).join('')}</div>
      <p class="lgn-note">${reg ? 'Уже есть аккаунт по почте? Войди как обычно и привяжи сервис в профиле → «Способы входа» — иначе получится второй аккаунт.'
        : 'Без пароля. Сайт узнает только имя и аватарку — пароль и переписку сервиса не видит.'}</p>
      <div class="auth-or"><span>или по почте</span></div>`;
    box.hidden = false;
  }

  // ═══ Профиль → «Способы входа» (#profileLogins) ═══
  let mState = null, cont = null, errAfter = null;
  function methodsStatus(t, err) {
    const s = doc?.querySelector('#profileLogins .lgn-mstatus');
    if (!s) { toast(t); return; }
    s.textContent = t || ''; s.classList.toggle('err', !!err);
  }
  function identityName(u, p) {
    const d = (u?.identities || []).find(i => i.provider === p)?.identity_data || {};
    return String(d.user_name || d.preferred_username || d.custom_claims?.global_name || d.full_name || d.name || '').slice(0, 40);
  }
  async function renderMethods() {
    const box = doc?.getElementById('profileLogins');
    if (!box) return;
    if (!me() || !sb()) { box.hidden = true; return; }
    css();
    const [P, ur, m0] = await Promise.all([providers(), sb().auth.getUser().catch(() => ({})), rpc('auth_login_methods')]);
    const user = ur?.data?.user || me();
    const sqlOk = !!(m0 && m0.ok);
    const m = sqlOk ? m0 : {
      links: [], email: !isSynthetic(user) && !!user.email && !!(user.email_confirmed_at || user.confirmed_at),
      identities: (user.identities || []).filter(i => BUILTIN.includes(i.provider)).map(i => ({ provider: i.provider, at: i.created_at })),
    };
    const enabled = P.list.filter(p => BUILTIN.includes(p) || sqlOk);
    mState = { m, enabled, user };
    const linked = p => (OWN.includes(p) ? m.links : m.identities).find(x => x.provider === p);
    const shown = ORDER.filter(p => linked(p) || enabled.includes(p));
    if (!shown.length) { box.hidden = true; box.innerHTML = ''; return; }
    const rows = [];
    if (m.email) rows.push(`<div class="lgn-row on"><span class="lgn-ic lgn-email" aria-hidden="true">${ICON.email}</span><div class="lgn-rt"><b>Почта и пароль</b><small>${esc(maskMail(user.email))}</small></div></div>`);
    for (const p of shown) {
      const l = linked(p), on = enabled.includes(p);
      let sub, act = '';
      if (l) {
        const nm = OWN.includes(p) ? (l.name || '') : identityName(user, p);
        sub = [nm, l.at ? 'с ' + fmtDate(l.at) : ''].filter(Boolean).join(' · ') || 'привязан';
        if (!on) sub += ' · вход выключен на сайте';
        const can = canUnlink(m, enabled, p);
        if (OWN.includes(p) && (l.name || l.avatar)) act += `<button type="button" class="lgn-mini" data-lgn-hide="${p}" title="Не хранить имя и аватарку из ${esc(NAME[p])}">Скрыть имя</button>`;
        act += `<button type="button" class="lgn-mini${can ? '' : ' dis'}" data-lgn-unlink="${p}"${can ? '' : ' aria-disabled="true" title="Это последний способ войти — сначала привяжи другой"'}>Отвязать</button>`;
      } else {
        sub = 'не привязан';
        act = `<button type="button" class="lgn-mini go" data-lgn-link="${p}">Привязать</button>`;
      }
      const two = (act.match(/<button/g) || []).length > 1;   // две кнопки — на телефоне уходят под название
      rows.push(`<div class="lgn-row${l ? ' on' : ''}${two ? ' two' : ''}"><span class="lgn-ic lgn-c-${p}" aria-hidden="true">${ICON[p]}</span><div class="lgn-rt"><b>${esc(NAME[p])}</b><small>${esc(sub)}</small></div><div class="lgn-act">${act}</div></div>`);
    }
    box.innerHTML = `<div class="pf-kicker" style="margin-bottom:.45rem">🔐 Способы входа</div>
      <p class="lgn-mhint">Входи как удобно. Сайт видит только имя и аватарку из сервиса — пароль от него никогда.</p>
      ${cont ? `<div class="lgn-cont">✅ Готово, это ты. <button type="button" class="lgn-mini go" data-lgn-link="${esc(cont)}">Привязать ${esc(NAME[cont] || '')}</button></div>` : ''}
      <div class="lgn-list">${rows.join('')}</div>
      <div class="lgn-reauth" hidden></div>
      <div class="lgn-mstatus" aria-live="polite"></div>
      <p class="lgn-mnote">🛡 Хотя бы один способ входа нужен всегда — последний отвязать нельзя. Привязать новый можно только сразу после входа.</p>`;
    box.hidden = false;
    cont = null;
    if (errAfter) { methodsStatus(errAfter, true); errAfter = null; }
    if (enabled.includes('tg') && P.o.tg?.mode === 'widget') loadTg().catch(() => {});
  }
  // «Подтверди, что это ты»: войти ещё раз (паролем или через уже привязанный сервис) — и продолжить привязку
  function showReauth(then) {
    const box = doc?.querySelector('#profileLogins .lgn-reauth');
    if (!box || !mState) return;
    const { m, enabled, user } = mState;
    const via = ORDER.filter(p => enabled.includes(p) && (OWN.includes(p) ? m.links : m.identities).some(x => x.provider === p));
    box.innerHTML = `<b>🔐 Подтверди, что это ты</b>
      <p>Чтобы привязать ${esc(NAME[then] || 'вход')}, нужен свежий вход — не старше 15 минут. Так никто, кто взял твой телефон или компьютер, не привяжет к твоему аккаунту свой.</p>
      ${m.email ? `<div class="lgn-pass"><input type="password" class="auth-inp" autocomplete="current-password" aria-label="Пароль от аккаунта" placeholder="Пароль"><button type="button" class="lgn-mini go" data-lgn-pass="${esc(then)}">Подтвердить</button></div><div class="auth-captcha" data-captcha="reauth"></div>` : ''}
      ${via.length ? `<div class="lgn-via">${m.email ? '<small>или войди заново через:</small>' : ''}${via.map(p => `<button type="button" class="lgn-mini" data-lgn-reauth="${p}" data-then="${esc(then)}">${ICON[p] ? `<span class="lgn-ic sm lgn-c-${p}" aria-hidden="true">${ICON[p]}</span>` : ''}${esc(NAME[p])}</button>`).join('')}</div>` : ''}
      ${!m.email && !via.length ? '<p>Выйди и войди снова — потом привяжи.</p>' : ''}`;
    box.hidden = false;
    if (m.email) D37Captcha.mount('reauth', box.querySelector('.auth-captcha'));
    void user;
  }
  async function reauthPassword(then, btn) {
    const box = doc.querySelector('#profileLogins .lgn-reauth'), inp = box?.querySelector('input[type=password]');
    const u = mState?.user;
    if (!inp || !u?.email) return;
    if (!inp.value) { methodsStatus('Введи пароль от аккаунта', true); return; }
    btn.disabled = true;
    const captchaToken = D37Captcha.on() ? await D37Captcha.token('reauth', box.querySelector('.auth-captcha')) : null;
    const { data, error } = await sb().auth.signInWithPassword({ email: u.email, password: inp.value, options: captchaToken ? { captchaToken } : undefined });
    D37Captcha.done('reauth', !error);
    btn.disabled = false;
    if (error) { methodsStatus(typeof humanErrCap === 'function' ? humanErrCap(error) : 'Неверный пароль', true); return; }
    inp.value = '';
    if (typeof onAuthStateChange === 'function' && data?.user) { try { await onAuthStateChange(data.user); } catch (e) {} }
    box.hidden = true;
    link(then);
  }
  async function link(p) {
    if (!me() || !sb()) return;
    const P = await providers();
    if (!P.list.includes(p)) return methodsStatus(errText('off', p), true);
    if (!isFresh(await accessToken())) { showReauth(p); methodsStatus(''); return; }
    methodsStatus('Открываем ' + NAME[p] + '…');
    if (BUILTIN.includes(p)) {
      const r = await rpc('auth_link_intent', { p_provider: p });   // null — нет auth-links.sql: без разрешения (и без защиты в базе)
      if (r && !r.ok) { if (r.reason === 'reauth') { showReauth(p); methodsStatus(''); return; } return methodsStatus(errText(r.reason, p), true); }
      setPending({ p, m: 'link' });
      const { error } = await sb().auth.linkIdentity({ provider: p, options: { redirectTo: root.location.origin + '/' } });
      if (error) { clearPending(); methodsStatus(errText(sbCode(error, 'link'), p), true); }
      return;
    }
    if (p === 'tg' && P.o.tg?.mode === 'widget') return tgPopup(P.o.tg, 'link');
    const f = rnd(), b = await shaB64(f);
    const t = await postJson('/api/oauth?a=ticket', { p, b }, await accessToken());
    if (!t?.ok) { if (t?.reason === 'reauth' || t?.reason === 'auth') { showReauth(p); methodsStatus(''); return; } return methodsStatus(errText(t?.reason, p), true); }
    setPending({ p, m: 'link', f });
    root.location.href = `/auth/${p}/start?m=link&b=${b}&t=${encodeURIComponent(t.t)}&n=${encodeURIComponent('#/profile/logins')}`;
  }
  async function unlink(p) {
    if (!mState || !sb()) return;
    if (!canUnlink(mState.m, mState.enabled, p)) return methodsStatus(errText('last', p), true);
    if (root.confirm && !root.confirm(`Отвязать ${NAME[p]}? Входить через него в этот аккаунт больше не получится (потом можно привязать снова).`)) return;
    if (OWN.includes(p)) {
      const r = await rpc('auth_link_remove', { p_provider: p });
      if (!r?.ok) return methodsStatus(errText(r?.reason || 'server', p), true);
    } else {
      const { data } = await sb().auth.getUserIdentities();
      const id = (data?.identities || []).find(i => i.provider === p);
      if (id) {
        const { error } = await sb().auth.unlinkIdentity(id);
        if (error) return methodsStatus(errText(sbCode(error, 'unlink') === 'last' ? 'last' : 'server', p), true);
        try { await sb().auth.refreshSession(); } catch (e) {}
      }
    }
    toast(`Вход через ${NAME[p]} отвязан`);
    renderMethods();
  }
  async function hideName(p) {
    const r = await rpc('auth_link_hide', { p_provider: p, p_hide: true });
    if (!r?.ok) return methodsStatus(errText(r?.reason || 'server', p), true);
    toast('Имя и аватарка из ' + NAME[p] + ' больше не хранятся');
    renderMethods();
  }

  // ═══ Модераторам на чужом профиле: «связанные входы» (какие сервисы и сколько — без номеров и почты) ═══
  async function staffNote(uid) {
    doc?.getElementById('profileStaffLogins')?.remove();
    if (!uid || !sb() || !['admin', 'moderator'].includes(role()) || uid === me()?.id) return;
    const d = await rpc('auth_links_staff', { p_user: uid });
    if (!d?.ok || (typeof profileViewedId !== 'undefined' && profileViewedId !== uid)) return;
    const at = doc.getElementById('profileRoleBadge');
    if (!at) return;
    css();
    const el = doc.createElement('div');
    el.id = 'profileStaffLogins'; el.className = 'lgn-staff';
    el.title = 'Видно только модераторам: какие входы у аккаунта (без номеров, имён и почты)';
    el.textContent = `🔗 Входы (${d.n}): ${(d.list || []).join(', ') || 'нет'}${d.banned ? ` · в бане: ${d.banned}` : ''}`;
    at.insertAdjacentElement('afterend', el);
  }

  // ═══ Кнопки (одна делегированная подписка) ═══
  async function onClick(e) {
    const b = e.target?.closest?.('[data-lgn-login],[data-lgn-link],[data-lgn-unlink],[data-lgn-hide],[data-lgn-reauth],[data-lgn-pass]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.lgnLogin) return start(b.dataset.lgnLogin);
    if (b.dataset.lgnLink) return link(b.dataset.lgnLink);
    if (b.dataset.lgnUnlink) return unlink(b.dataset.lgnUnlink);
    if (b.dataset.lgnHide) return hideName(b.dataset.lgnHide);
    if (b.dataset.lgnPass) return reauthPassword(b.dataset.lgnPass, b);
    if (b.dataset.lgnReauth) return start(b.dataset.lgnReauth, { mode: 'reauth', uid: me()?.id, then: b.dataset.then || null, next: '#/profile/logins' });
  }

  // ═══ «Я не робот» — Cloudflare Turnstile (Supabase → Authentication → Bot and Abuse Protection) ═══
  // Регистрация — всегда видимая галочка; вход — невидимо (Cloudflare сам решит), после 2 неудачных входов — видимая.
  const D37Captcha = (() => {
    const key = () => { try { return typeof TURNSTILE_SITE_KEY === 'string' ? TURNSTILE_SITE_KEY.trim() : ''; } catch (e) { return ''; } };
    const fails = () => { try { return +root.sessionStorage.getItem(FAILS) || 0; } catch (e) { return 0; } };
    const setFails = v => { try { root.sessionStorage.setItem(FAILS, String(v)); } catch (e) {} };
    let loading = null;
    const W = {};
    function load() {
      if (root.turnstile) return Promise.resolve();
      if (!loading) loading = new Promise((res, rej) => {
        const s = doc.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
        s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('captcha')); };
        doc.head.appendChild(s);
      });
      return loading;
    }
    function boxFor(kind, el) {
      if (el) return el;
      const host = doc?.getElementById(kind === 'register' ? 'gauthRegisterFields' : 'gauthLoginFields');
      if (!host) return null;
      let b = host.querySelector('.auth-captcha');
      if (!b) { b = doc.createElement('div'); b.className = 'auth-captcha'; b.dataset.captcha = kind; host.insertBefore(b, host.querySelector('.auth-submit')); }
      return b;
    }
    async function mount(kind, el) {
      if (!key() || !doc) return;
      const box = boxFor(kind, el);
      if (!box) return;
      const visible = kind !== 'login' || fails() >= 2;
      const old = W[kind];
      if (old && old.box === box && old.visible === visible && box.isConnected) return;
      try { await load(); } catch (e) { return; }
      if (old) { try { root.turnstile.remove(old.id); } catch (e) {} }
      box.innerHTML = '';
      const st = W[kind] = { box, visible, token: null, waiters: [] };
      st.id = root.turnstile.render(box, {
        sitekey: key(), theme: 'dark', language: 'ru', size: 'flexible', appearance: visible ? 'always' : 'interaction-only', 'refresh-expired': 'auto',
        callback: t => { st.token = t; st.waiters.splice(0).forEach(f => f(t)); },
        'expired-callback': () => { st.token = null; }, 'error-callback': () => { st.token = null; },
      });
    }
    async function token(kind, el) {
      if (!key()) return null;
      await mount(kind, el);
      const st = W[kind];
      if (!st) return '';   // скрипт Cloudflare не загрузился — пусть ответит Supabase («не прошла проверка»)
      if (st.token) return st.token;
      return new Promise(res => { st.waiters.push(res); setTimeout(() => res(st.token || ''), 15000); });
    }
    // После каждой попытки: токен одноразовый — новый. count — считать ли неудачный вход (после 2 — галочка видна)
    function done(kind, okRes, count = kind === 'login') {
      const st = W[kind];
      if (st) { st.token = null; try { root.turnstile.reset(st.id); } catch (e) {} }
      if (count) { setFails(okRes ? 0 : fails() + 1); if (!okRes && fails() >= 2) mount('login'); }
    }
    return { on: () => !!key(), mount, token, done };
  })();

  // ═══ Стили (свои — чтобы не трогать premium.css) ═══
  function css() {
    if (!doc?.head || doc.getElementById('d37LoginCss')) return;
    const s = doc.createElement('style'); s.id = 'd37LoginCss';
    s.textContent = `
.lgn-box{margin-bottom:.2rem}
.lgn-head{font:800 .74rem/1.2 Montserrat,system-ui,sans-serif;letter-spacing:.4px;color:var(--muted,#9a9ab5);margin:0 0 .55rem}
.lgn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:.5rem}
.lgn-grid.one{grid-template-columns:1fr}
.lgn-btn{display:flex;align-items:center;justify-content:center;gap:.45rem;min-height:44px;padding:.5rem .5rem;border-radius:12px;border:1px solid rgba(255,255,255,.14);
  font:700 13px/1.1 Montserrat,system-ui,sans-serif;color:#fff;cursor:pointer;transition:filter .15s,transform .15s;-webkit-tap-highlight-color:transparent;min-width:0}
.lgn-grid .lgn-btn:last-child:nth-child(odd){grid-column:1/-1}
.lgn-btn:hover{filter:brightness(1.08)}.lgn-btn:active{transform:scale(.98)}
.lgn-btn:focus-visible,.lgn-mini:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lgn-btn .lgn-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lgn-ic{display:inline-flex;width:18px;height:18px;flex:none}.lgn-ic svg{width:100%;height:100%;display:block}
.lgn-ic.sm{width:16px;height:16px}
.lgn-vk{background:#0077ff;border-color:#0077ff}.lgn-tg{background:#2aabee;border-color:#2aabee}.lgn-yandex{background:#000;border-color:rgba(255,255,255,.22)}
.lgn-google{background:#fff;color:#1f1f1f;border-color:#dadce0}.lgn-discord{background:#5865f2;border-color:#5865f2}
.lgn-twitch{background:#9146ff;border-color:#9146ff}.lgn-github{background:#24292f;border-color:rgba(255,255,255,.22)}
.lgn-note{margin:.55rem 0 0;font-size:.68rem;line-height:1.45;color:var(--muted,#9a9ab5)}
#profileLogins .lgn-mhint,#profileLogins .lgn-mnote{font-size:.72rem;line-height:1.5;color:var(--muted,#9a9ab5);margin:.1rem 0 .6rem}
#profileLogins .lgn-mnote{margin:.7rem 0 0}
.lgn-list{display:flex;flex-direction:column;gap:.4rem}
.lgn-row{display:flex;align-items:center;gap:.6rem;padding:.55rem .65rem;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.025)}
.lgn-row.on{background:rgba(34,197,94,.06);border-color:rgba(34,197,94,.25)}
.lgn-row>.lgn-ic{width:30px;height:30px;padding:6px;border-radius:9px;background:rgba(255,255,255,.08);box-sizing:border-box;color:#fff}
.lgn-c-vk{background:#0077ff!important}.lgn-c-tg{background:#2aabee!important}.lgn-c-yandex{background:#000!important;padding:3px!important}
.lgn-c-google{background:#fff!important}.lgn-c-discord{background:#5865f2!important}.lgn-c-twitch{background:#9146ff!important}.lgn-c-github{background:#24292f!important}
.lgn-ic.sm.lgn-c-vk,.lgn-ic.sm.lgn-c-tg,.lgn-ic.sm.lgn-c-google,.lgn-ic.sm.lgn-c-discord,.lgn-ic.sm.lgn-c-twitch,.lgn-ic.sm.lgn-c-github,.lgn-ic.sm.lgn-c-yandex{border-radius:4px;padding:2px;box-sizing:border-box}
.lgn-email{color:var(--text,#f0f0f8)}
.lgn-rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:.1rem}
.lgn-rt b{font-size:.8rem}.lgn-rt small{font-size:.68rem;color:var(--muted,#9a9ab5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lgn-act{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}
.lgn-mini{display:inline-flex;align-items:center;gap:.35rem;min-height:32px;padding:.3rem .7rem;border-radius:9px;border:1px solid var(--border,rgba(255,255,255,.14));
  background:rgba(255,255,255,.05);color:var(--text,#f0f0f8);font:700 .7rem Montserrat,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.lgn-mini.go{border:0;background:linear-gradient(135deg,var(--tw,#9147ff),#6d28d9);color:#fff}
.lgn-mini.dis{opacity:.45;cursor:not-allowed}
.lgn-reauth{margin-top:.65rem;padding:.8rem .85rem;border-radius:12px;border:1px dashed rgba(255,209,102,.5);background:rgba(255,209,102,.06);font-size:.76rem}
.lgn-reauth p{margin:.35rem 0 .55rem;color:var(--muted,#9a9ab5);line-height:1.5}
.lgn-pass{display:flex;gap:.45rem}.lgn-pass .auth-inp{margin:0;flex:1;min-width:0}
.lgn-via{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.5rem}.lgn-via small{width:100%;color:var(--muted,#9a9ab5)}
.lgn-cont{margin:.1rem 0 .6rem;padding:.6rem .75rem;border-radius:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);font-size:.76rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.lgn-mstatus{min-height:1em;margin-top:.45rem;font-size:.72rem;color:var(--muted,#9a9ab5)}.lgn-mstatus.err{color:#f87171}
.lgn-staff{display:inline-block;margin-top:.35rem;padding:.2rem .55rem;border-radius:8px;font-size:.66rem;font-weight:700;color:#c4b5fd;background:rgba(145,71,255,.12);border:1px solid rgba(145,71,255,.3)}
.auth-captcha{margin:.1rem 0 .55rem;min-height:0}.auth-captcha:empty{display:none}
@media(max-width:520px){.lgn-row.two{flex-wrap:wrap}.lgn-row.two .lgn-act{width:100%;justify-content:flex-start;padding-left:calc(30px + .6rem)}}
@media(max-width:360px){.lgn-grid{grid-template-columns:1fr 1fr}.lgn-btn{font-size:12px;padding:.45rem .35rem;gap:.3rem}.lgn-row{flex-wrap:wrap}.lgn-act{width:100%}}`;
    doc.head.appendChild(s);
  }

  // ═══ Запуск ═══
  if (doc?.addEventListener) {
    doc.addEventListener('click', onClick);
    const boot = () => { css(); resume(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    root.addEventListener?.('d37:auth', () => setTimeout(afterAuth, 0));
    // Наш фрагмент пришёл без перезагрузки (та же страница) — разобрать так же; слушатель раньше роутера (router.js грузится позже)
    root.addEventListener?.('hashchange', () => {
      const r = parseReturn(root.location.hash);
      if (!r || (r.sb && !getPending())) return;
      early = r;
      root.history?.replaceState?.(null, '', String(root.location.pathname || '/') + String(root.location.search || ''));
      resume();
    });
  }

  root.D37Captcha = D37Captcha;
  root.D37Login = {
    NAME, ORDER, BUILTIN, OWN, providers, start, renderModal, renderMethods, staffNote, link, unlink, isSynthetic,
    _test: { parseReturn, buttons, ways, canUnlink, isSynthetic, freshAt, isFresh, errText, sbCode, setPending, getPending, clearPending, early: () => early },
  };
})();
