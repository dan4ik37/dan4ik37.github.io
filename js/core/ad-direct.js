// ═══════════════════════════════════════
//  ПРЯМАЯ РЕКЛАМА — кампании из кабинета рекламодателя (#/adv, ads.sql): выбор, показ, засчитывание показа
// ═══════════════════════════════════════
// Подключается после ad-places.js (и в SPA, и на серверных страницах). Сам места не ищет — его зовёт диспетчер мест
// (D37AdPlaces.show → wants/fill): если сейчас есть подходящая одобренная кампания — она вместо рекламы сети, иначе —
// как раньше (сеть, своя подсказка или пусто). VIP, персонал, «рядом нельзя» и частота — уже проверены диспетчером.
//  • ad_live() — есть ли сейчас работающие кампании по форматам (кэш 5 мин): без них ни одного лишнего запроса;
//  • ad_pick(место, контекст) — сервер выбирает кампанию: раздел, телефон/компьютер, возраст (D37Age, если есть),
//    страна (/api/geo; неизвестна — считаем Россией: без erid там нельзя), ширина места, уже показанные на странице;
//  • показ засчитывается (ad_view), только когда реклама видна ≥ 50 % не меньше секунды (IntersectionObserver) и вкладка
//    на экране. Во встроенном браузере IO стоит, пока панель не видна, — там показы не засчитываются (это не ошибка);
//  • клик — ссылка /go/<id>?t=<подпись> (сервер сайта засчитывает и перенаправляет на сайт рекламодателя);
//  • у каждой рекламы — «Реклама · рекламодатель» (+ erid) и «ⓘ О рекламе» (ИНН/БИН, сайт, пожаловаться).
// Картинки — закрытое хранилище 'ads': подписанная ссылка на час (видна только у одобренных кампаний).
// Щит «Мира Денчика» — billboard()/seen() (зовёт js/games/mir-promo.js). Кабинет — cabinet() грузит js/features/adcab.js.
// Пока ads.sql не выполнен (PGRST202) — тихо выключено, сайт работает как раньше. ?adsdebug=1 — показы не засчитываются.
(() => {
  // Supabase: те же адрес и открытый ключ, что в chat.js (на серверных страницах chat.js нет)
  const sbUrl = () => (typeof SB_URL !== 'undefined' && SB_URL) || 'https://zdisuowyjgqirhvcyjfq.supabase.co';
  const sbKey = () => (typeof SB_KEY !== 'undefined' && SB_KEY) || 'sb_publishable_55GhvJbDxDQA1JEawZRQ6g_ozx_cgMV';
  const now = () => Date.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Правила (те же — ads.sql и api/_lib/ad-rules.js; тесты сверяют) ──
  const BAD_WORDS = [
    'казино', 'casino', 'kazino', 'букмекер', 'bookmaker', 'betting', 'беттинг', 'ставки на спорт', 'ставка на спорт', 'тотализатор',
    '1xbet', '1win', 'mostbet', 'melbet', 'fonbet', 'winline', 'parimatch', 'leonbets', 'betcity', 'ggbet', 'pin-up', 'pinup', 'vavada',
    'azino', 'азино', 'joycasino', 'рулетк', 'roulette', 'джекпот', 'jackpot', 'лотере', 'lottery', 'игровые автоматы', 'покер', 'poker',
    'ggdrop', 'casebattle', 'case-battle', 'case battle', 'кейсбатл', 'кейс батл', 'forcedrop', 'easydrop', 'bulldrop', 'skinbox',
    'открытие кейсов', 'открывай кейсы', 'промокод на деп', 'депозит',
    'алкогол', 'alcohol', 'водка', 'vodka', 'пиво', 'beer', 'коньяк', 'виски', 'whisky', 'whiskey',
    'сигарет', 'cigarette', 'табак', 'tobacco', 'вейп', 'вэйп', 'vape', 'электронк', 'снюс', 'snus', 'кальян', 'hookah', 'iqos', 'насвай',
    'порно', 'porn', 'xxx', 'секс', 'эротик', 'erotic', 'интим', '18+', 'onlyfans', 'знакомства', 'dating', 'эскорт', 'escort',
    'оружи', 'weapon', 'пистолет', 'травмат', 'боеприпас', 'патрон',
    'криптовалют', 'crypto', 'bitcoin', 'биткоин', 'биткойн', 'nft', 'форекс', 'forex', 'трейдинг', 'инвестиц', 'пассивный доход',
    'легкие деньги', 'быстрые деньги', 'easy money', 'заработок без вложений', 'микрозайм', 'займ', 'кредит',
    'лекарств', 'таблетк', 'антибиотик', 'похуден', 'жиросжиг', 'бады',
    'наркот', 'марихуан', 'cannabis', 'спайс',
    'ты выиграл', 'вы выиграли', 'you won', 'скачай', 'бесплатные робуксы', 'робуксы бесплатно', 'free robux', 'free v-bucks',
    'читы', 'взлом аккаунт',
  ];
  const SHORT_HOSTS = ['bit.ly', 'bitly.com', 'clck.ru', 'cutt.ly', 'tinyurl.com', 'goo.su', 't.ly', 'is.gd', 'v.gd', 'ow.ly', 'rebrand.ly',
    'shorturl.at', 'u.to', 'vk.cc', 'rb.gy', 'tiny.cc', 'qps.ru', 's.id', 'surl.li'];
  // Цены и лимиты по умолчанию (как ad_settings в ads.sql) — до запуска SQL кабинет показывает их
  const DEF = {
    prices: { native: { cpm: 70, day: 60 }, banner: { cpm: 50, day: 50 }, rail: { cpm: 60, day: 40 }, board: { cpm: 100, day: 100 } },
    min_budget: 200, max_budget: 100000, min_topup: 50, max_days: 30, dedup_min: 30, freq_day: 6, terms: '2026-10-15',
  };
  const SIZES = { native: [640, 360], b300x250: [600, 500], b728x90: [1456, 180], r160x600: [320, 1200], r300x600: [600, 1200], board: [1024, 512] };
  const KIND_GROUP = { native: 'native', b300x250: 'banner', b728x90: 'banner', r160x600: 'rail', r300x600: 'rail', board: 'board' };
  // Место диспетчера → группа форматов
  const GROUP = { feed: 'native', feed_games: 'native', feed_videos: 'native', feed_ugc: 'native', loading: 'banner', break: 'banner',
    game_over: 'banner', games_hub: 'banner', seo_game: 'banner', video_page: 'banner', home_mid: 'banner', rail: 'rail', billboard: 'board' };
  const LAT = 'aeopcxykmtbh', CYR = 'аеорсхукмтвн';
  const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
  const toCyr = s => s.replace(/[aeopcxykmtbh]/g, c => CYR[LAT.indexOf(c)]);
  function textBad(t){ const n = norm(t), l = toCyr(n); return BAD_WORDS.find(w => n.includes(w) || l.includes(w)) || ''; }
  const ctrl = s => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127) return true; } return false; };
  function urlBad(u){
    u = String(u ?? '').trim();
    if (!u) return 'empty';
    if (u.length > 500) return 'long';
    if (u.slice(0, 8) !== 'https://') return 'https';
    if (/[\s<>"\\]/.test(u) || ctrl(u)) return 'chars';
    const h = ((/^https:\/\/([^/?#]*)/.exec(u) || [])[1] || '').toLowerCase();
    if (!h || /[@:]/.test(h) || !/^[a-z0-9.-]+$/.test(h) || !/\.[a-z0-9-]{2,}$/.test(h) || /^[0-9.]+$/.test(h) || /\.\./.test(h) || /^[.-]/.test(h)) return 'host';
    if (SHORT_HOSTS.some(w => h === w || h.endsWith('.' + w))) return 'short';
    if (textBad(u)) return 'bad';
    return '';
  }
  const hostOf = u => (((/^https:\/\/([^/?#]*)/.exec(String(u ?? '').trim()) || [])[1] || '').toLowerCase()).replace(/^www\./, '');
  const base = k => /^feed/.test(k) && !GROUP[k] ? 'feed' : k;
  const groupOf = k => GROUP[k] || GROUP[base(k)] || '';

  // ── Состояние ──
  let off = false;          // ads.sql не выполнен (PGRST202) — до перезагрузки не спрашиваем
  let live = null;          // { on, f: { native: n, … }, t }
  let liveP = null;
  const shown = new Set();  // кампании, уже показанные на этой странице (раздел SPA) — второй раз в том же списке не надо
  const dbg = () => { try { return !!window.D37AdPlaces?.debug?.(); } catch (e) { return false; } };
  const ss = { get(k){ try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v){ try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const ls = { get(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  try { if (ss.get('d37_adoff')) off = true; } catch (e) {}

  // Вход: токен сессии Supabase из браузера (на серверных страницах SDK нет) — сервер узнаёт рекламодателя и не считает
  // его показы; просрочен — как гость
  function session(){
    try {
      const ref = (/^https:\/\/([a-z0-9]+)\./.exec(sbUrl()) || [])[1];
      const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || 'null');
      const tok = s?.access_token || s?.currentSession?.access_token;
      const exp = s?.expires_at || s?.currentSession?.expires_at || 0;
      return tok && exp * 1000 > now() + 30e3 ? tok : '';
    } catch (e) { return ''; }
  }
  async function rpc(fn, args, o = {}){
    if (off && !o.force) return null;
    const tok = o.anon ? '' : session();
    const headers = { apikey: sbKey(), 'Content-Type': 'application/json' };
    if (tok) headers.Authorization = 'Bearer ' + tok;
    let r;
    try { r = await fetch(`${sbUrl()}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}) }); }
    catch (e) { return null; }
    if (r.status === 401 && tok) return rpc(fn, args, { ...o, anon: true });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      if (r.status === 404 && (j?.code === 'PGRST202' || /Could not find the function/i.test(j?.message || ''))) { off = true; ss.set('d37_adoff', 1); }
      return null;
    }
    return r.json().catch(() => null);
  }

  // ── Что сейчас работает (подсказка: спрашивать ли выдачу) ──
  function loadLive(force){
    if (off) return Promise.resolve(null);
    if (!force && liveP) return liveP;
    liveP = rpc('ad_live').then(v => {
      if (v && typeof v === 'object') { live = { on: !!v.on, f: v.f || {}, t: now() }; ls.set('d37_adlive', live); }
      return live;
    }).finally(() => { setTimeout(() => { liveP = null; }, 1000); });
    return liveP;
  }
  {
    const c = ls.get('d37_adlive');
    if (c && c.t && now() - c.t < 10 * 60e3) live = c;
  }
  function freshLive(){ if (!off && (!live || now() - live.t > 5 * 60e3)) loadLive(); }
  // Ждать подсказку не дольше ms (серверные страницы: места, которые заполняются сразу при загрузке)
  function ready(fn, ms = 700){
    if (off || (live && now() - live.t < 5 * 60e3)) { fn(); return; }
    let done = false; const go = () => { if (!done) { done = true; fn(); } };
    loadLive().then(go, go); setTimeout(go, ms);
  }
  const perk = () => { try { return !!window.D37AdPlaces?.noAdsPerk?.(); } catch (e) { return false; } };
  // Возраст (js/core/age.js → ADS_RULES.age в ad-places.js): где у группы реклама сетей выключена — и прямой нет.
  // Щит мира = «спонсор» (детям — только свои промо сайта)
  const ageOff = key => { try { return !!window.D37AdPlaces?.ageOff?.(groupOf(key) === 'board' ? 'sponsor' : /^feed/.test(key) ? 'feed' : key); } catch (e) { return false; } };
  function has(key){
    const g = groupOf(key);
    if (!g || off || perk() || ageOff(key)) return false;
    freshLive();
    return !!(live && live.on && live.f && live.f[g] > 0);
  }
  const wants = (key, o = {}) => !o.noDirect && has(key);

  // ── Контекст для выдачи ──
  function serverSection(p){
    if (/^\/(v\/|videos|topic|top\b|history|about)/.test(p)) return 'videos';
    if (/^\/(games|quiz|tools)/.test(p)) return 'games';
    if (/^\/(studio|g\/)/.test(p)) return 'studio';
    return p === '/' || p === '/index.html' ? 'videos' : 'other';
  }
  function section(){
    const h = String(location.hash || '').toLowerCase(), p = String(location.pathname || '/').toLowerCase();
    if (/^#\/games\/world\b/.test(h)) return 'world';
    if (/^#\/games\/(studio|studio3d|unity)\b/.test(h)) return 'studio';
    if (/^#\/games\b/.test(h)) return 'games';
    if (/^#\/(chat|forum|lfg|profile|c|phone|ideas)\b/.test(h)) return 'chat';
    if (/^#\/(home|shorts)\b/.test(h)) return 'videos';
    if (/^#\/./.test(h)) return 'other';
    return serverSection(p);
  }
  const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 768px)').matches; } catch (e) { return false; } };
  // Возраст: группа из D37Age (для таргетинга «кому показывать», в т. ч. «не указан») и группа рекламы ad-places.js (adAge:
  // «не указан» — по ADS_RULES.age.unknown, «сайт для детей» — строже) — по ней сервер не выдаёт кампанию с меткой старше группы
  const age = () => { try { const g = window.D37Age?.group?.(); return ['child', 'teen', 'teen16', 'adult'].includes(g) ? g : 'unknown'; } catch (e) { return 'unknown'; } };
  const adAge = () => { try { return window.D37AdPlaces?.adAge?.() || ''; } catch (e) { return ''; } };
  // Страна — только код от сервера сайта (/api/geo; Vercel знает по IP), один раз за визит. Нет ответа — '' (= как Россия)
  let geoP = null;
  function geo(){
    if (geoP) return geoP;
    const c = ss.get('d37_geo');
    if (c && typeof c.c === 'string') return (geoP = Promise.resolve(c.c));
    geoP = fetch('/api/geo', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      const cc = /^[A-Z]{2}$/.test(j?.c || '') ? j.c : '';
      ss.set('d37_geo', { c: cc });
      return cc;
    }).catch(() => '');
    return geoP;
  }
  function widthOf(el){
    let n = el, w = 0;
    for (let i = 0; n && i < 4 && !w; i++, n = n.parentElement) w = Math.round(n.getBoundingClientRect?.().width || 0);
    return w || (typeof innerWidth === 'number' ? innerWidth : 0);
  }
  async function pickFor(key, el, extra = {}){
    const ctx = { section: extra.section || section(), device: isTouch() ? 'mobile' : 'desktop', age: age(), ar: adAge(), country: await geo(),
      w: extra.w ?? (el ? widthOf(el) : 0), ex: [...shown].slice(-20) };
    const p = await rpc('ad_pick', { p_place: key, p_ctx: ctx });
    if (!p || typeof p !== 'object' || !p.id || !Array.isArray(p.cr) || !p.cr.length || typeof p.t !== 'string') return null;
    shown.add(p.id);
    return p;
  }
  addEventListener?.('hashchange', () => shown.clear());

  // ── Картинки: подписанная ссылка на час (хранилище закрытое) ──
  const IMG = new Map(Object.entries(ss.get('d37_adimg') || {}));
  async function imgUrl(path){
    if (!/^[0-9a-f-]{36}\/[a-z0-9]{8,40}\.(webp|png|jpg)$/.test(String(path || ''))) return '';
    const c = IMG.get(path);
    if (c && c.exp > now() + 5 * 60e3) return c.u;
    const headers = { apikey: sbKey(), 'Content-Type': 'application/json' };
    const tok = session(); if (tok) headers.Authorization = 'Bearer ' + tok;
    try {
      const r = await fetch(`${sbUrl()}/storage/v1/object/sign/ads/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers, body: JSON.stringify({ expiresIn: 3600 }) });
      const j = r.ok ? await r.json() : null;
      const s = j?.signedURL || j?.signedUrl || '';
      if (!/^\/object\/sign\/ads\//.test(s)) return '';
      const u = `${sbUrl()}/storage/v1${s}`;
      IMG.set(path, { u, exp: now() + 3600e3 });
      if (IMG.size > 40) IMG.delete(IMG.keys().next().value);
      ss.set('d37_adimg', Object.fromEntries(IMG));
      return u;
    } catch (e) { return ''; }
  }

  // ── Рисование ──
  const goHref = (p, place) => `/go/${encodeURIComponent(p.id)}?t=${encodeURIComponent(p.t)}${dbg() ? '&d=1' : ''}`;
  const ageTxt = p => (p.age === 0 || p.age > 0) && [0, 6, 12, 16, 18].includes(+p.age) ? `${+p.age}+` : '';   // возрастная метка кампании
  const mark = p => `Реклама${ageTxt(p) ? ' ' + ageTxt(p) : ''} · ${p.adv || 'рекламодатель'}${p.erid ? ' · erid: ' + p.erid : ''}`;
  const label = p => `<div class="dad-lbl"><span class="dad-lbl-t" title="${esc(mark(p))}">Реклама${ageTxt(p) ? ` <span class="dad-age">${ageTxt(p)}</span>` : ''} · <b>${esc(p.adv || 'рекламодатель')}</b>${p.erid ? ` · erid: ${esc(p.erid)}` : ''}</span>` +
    `<button type="button" class="dad-i" data-dad-about aria-label="О рекламе" title="О рекламе">ⓘ</button></div>`;
  function chooseKind(p, g, w){
    const k = new Set(p.cr.map(c => c.kind));
    if (g === 'banner') return w >= 728 && k.has('b728x90') ? 'b728x90' : k.has('b300x250') ? 'b300x250' : 'b728x90';
    if (g === 'rail') return w >= 300 && k.has('r300x600') ? 'r300x600' : k.has('r160x600') ? 'r160x600' : 'r300x600';
    return g === 'board' ? 'board' : 'native';
  }
  const SHOW = { native: [320, 180], b300x250: [300, 250], b728x90: [728, 90], r160x600: [160, 600], r300x600: [300, 600], board: [512, 256] };
  async function render(el, key, p){
    const g = p.g || groupOf(key), w = widthOf(el), kind = chooseKind(p, g, w);
    const cr = p.cr.find(c => c.kind === kind) || p.cr[0];
    const src = await imgUrl(cr.image);
    if (!el.isConnected) return false;
    const [dw, dh] = SHOW[cr.kind] || [300, 250];
    const alt = esc(cr.title || p.adv || 'Реклама');
    const host = esc(p.host || '');
    const img = src ? `<img src="${esc(src)}" alt="${alt}" width="${dw}" height="${dh}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="dad-noimg">${alt}</span>`;
    const a = `<a class="dad-a" href="${esc(goHref(p, key))}" target="_blank" rel="sponsored noopener nofollow" data-dad-go>`;
    let html;
    if (cr.kind === 'native') {
      html = `<div class="dad dad-native">${label(p)}${a}<span class="dad-img">${img}</span><b class="dad-t">${esc(cr.title)}</b>` +
        (cr.body ? `<span class="dad-d">${esc(cr.body)}</span>` : '') +
        `<span class="dad-foot"><span class="dad-host">${host} ↗</span>${cr.cta ? `<span class="dad-cta">${esc(cr.cta)}</span>` : ''}</span></a></div>`;
    } else {
      html = `<div class="dad dad-${g} dad-k-${cr.kind}" style="--dad-w:${dw}px;--dad-ar:${dw}/${dh}">${label(p)}${a}${img}</a><a class="dad-host" href="${esc(goHref(p, key))}" target="_blank" rel="sponsored noopener nofollow">${host} ↗</a></div>`;
    }
    el.hidden = false;
    el.classList.add('d37-ad', 'd37-dad');
    el.classList.remove('d37-house');
    el.innerHTML = html;
    el.dataset.dad = p.id;
    const box = el.querySelector('.dad');
    box.querySelector('[data-dad-about]')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); about(p, box); });
    return true;
  }

  // ── «О рекламе» ──
  function about(p, box){
    document.querySelectorAll('.dad-pop').forEach(x => x.remove());
    const pop = document.createElement('div');
    pop.className = 'dad-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'О рекламе');
    pop.innerHTML = `<b>О рекламе</b>
      <div class="dad-pop-row"><span>Рекламодатель</span><b>${esc(p.adv || '—')}</b></div>
      ${p.inn ? `<div class="dad-pop-row"><span>ИНН / БИН</span><b>${esc(p.inn)}</b></div>` : ''}
      ${ageTxt(p) ? `<div class="dad-pop-row"><span>Возраст</span><b>${ageTxt(p)}</b></div>` : ''}
      ${p.erid ? `<div class="dad-pop-row"><span>erid</span><b>${esc(p.erid)}</b></div>` : ''}
      ${p.host ? `<div class="dad-pop-row"><span>Сайт</span><a href="${esc(goHref(p))}" target="_blank" rel="sponsored noopener nofollow">${esc(p.host)} ↗</a></div>` : ''}
      <p>Размещено через кабинет рекламодателя этого сайта и прошло проверку. С VIP рекламы нет. <a href="/ads-terms" target="_blank">Правила рекламы</a></p>
      <div class="dad-pop-act"><button type="button" data-dad-rep>Пожаловаться</button><button type="button" data-dad-x>Закрыть</button></div>
      <div class="dad-pop-st" role="status"></div>`;
    (box || document.body).appendChild(pop);
    if (!box) pop.classList.add('dad-pop-fixed');
    pop.querySelector('[data-dad-x]').onclick = () => pop.remove();
    pop.querySelector('[data-dad-rep]').onclick = async e => {
      const st = pop.querySelector('.dad-pop-st'), b = e.currentTarget;
      if (!session()) { st.textContent = 'Пожаловаться могут вошедшие — войди на сайт.'; return; }
      const why = (typeof prompt === 'function' ? prompt('Что не так с этой рекламой? (необязательно)', '') : '') ;
      if (why === null) return;
      b.disabled = true;
      const r = await rpc('ad_report', { p_id: p.id, p_reason: String(why || '').slice(0, 200) });
      st.textContent = r?.ok ? 'Спасибо! Жалоба отправлена — модератор посмотрит.' : 'Не получилось — попробуй позже.';
    };
    setTimeout(() => {
      const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
      document.addEventListener('pointerdown', close, true);
    }, 0);
    return pop;
  }

  // ── Показ засчитан: видно ≥ 50 % не меньше секунды, вкладка на экране ──
  const sent = new Set();
  function seen(p){
    if (!p || !p.t || sent.has(p.t) || dbg()) return false;
    sent.add(p.t);
    rpc('ad_view', { p_id: p.id, p_token: p.t });
    return true;
  }
  const watchers = new Set();
  function watch(el, p){
    if (dbg() || typeof IntersectionObserver !== 'function') return null;
    const w = { el, p, t: 0, vis: false, done: false, io: null };
    const arm = () => { if (!w.t && !w.done && w.vis && document.visibilityState !== 'hidden') w.t = setTimeout(fire, 1000); };
    const disarm = () => { if (w.t) { clearTimeout(w.t); w.t = 0; } };
    function fire(){
      w.t = 0;
      if (w.done || !el.isConnected || !w.vis || document.visibilityState === 'hidden') return;
      w.done = true; stop(); seen(p);
    }
    function stop(){ try { w.io.disconnect(); } catch (e) {} watchers.delete(w); }
    w.io = new IntersectionObserver(es => {
      for (const e of es) { w.vis = !!e.isIntersecting && e.intersectionRatio >= 0.5; if (w.vis) arm(); else disarm(); }
    }, { threshold: [0, 0.5, 1] });
    w.io.observe(el);
    w.arm = arm; w.disarm = disarm; w.stop = stop;
    watchers.add(w);
    return w;
  }
  document.addEventListener?.('visibilitychange', () => {
    for (const w of watchers) { if (!w.el.isConnected) { w.stop(); continue; } if (document.visibilityState === 'hidden') w.disarm(); else w.arm(); }
  });
  setInterval(() => { for (const w of watchers) if (!w.el.isConnected) w.stop(); }, 30e3);

  // ── Главное: занять место своей кампанией (диспетчер уже засчитал место) ──
  // o.fallback() — кампании не нашлось / не отрисовалась: диспетчер ставит рекламу сети или прячет место; o.onShown(p)
  async function fill(el, key, o = {}){
    let p = null;
    try { p = await pickFor(key, el); } catch (e) { p = null; }
    let ok = false;
    if (p && el.isConnected) { try { ok = await render(el, key, p); } catch (e) { ok = false; } }
    if (!ok) { if (el.isConnected) o.fallback?.(); return null; }
    watch(el.querySelector('.dad') || el, p);
    try { o.onShown?.(p); } catch (e) {}
    try { window.va?.('event', { name: 'ad_direct', data: { place: key } }); } catch (e) {}
    return p;
  }

  // ── Щит в «Мире Денчика»: одобренная кампания с форматом «щит» (mir-promo.js рисует её на месте спонсора) ──
  // → { id, title, text, url (/go/…), advertiser, erid, inn, host, bg, fg, img (загруженная картинка или null), direct: выдача }
  async function billboard(){
    if (!has('billboard')) return null;
    const p = await pickFor('billboard', null, { section: 'world', w: 1024 });
    if (!p) return null;
    const cr = p.cr.find(c => c.kind === 'board') || p.cr[0];
    const src = await imgUrl(cr.image);
    const img = src && typeof Image === 'function' ? await new Promise(res => {
      const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      const t = setTimeout(() => res(null), 8000);
      im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); };
      im.src = src;
    }) : null;
    return { id: p.id, age: ageTxt(p), title: cr.title || p.adv, text: p.host ? p.host + ' ↗' : '', url: goHref(p, 'billboard'), advertiser: p.adv, erid: p.erid, inn: p.inn,
      host: p.host, bg: '#0f172a', fg: '#ffffff', img, direct: p };
  }

  // ── Кабинет рекламодателя (#/adv): грузится при первом заходе ──
  let cabP = null;
  function loadCss(href){
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
  }
  function cabinet(param){
    loadCss('css/adcab.css?v=1');
    if (window.D37AdCab) return window.D37AdCab.render(param);
    if (!cabP) cabP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'js/features/adcab.js?v=1';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    const root = document.getElementById('advRoot');
    if (root && !root.childElementCount) root.innerHTML = '<div class="adc-load">Загружаем кабинет…</div>';
    return cabP.then(() => window.D37AdCab?.render(param)).catch(() => { if (root) root.innerHTML = '<div class="adc-load">Не загрузилось — обнови страницу.</div>'; });
  }

  // ── Стили (свои, и для серверных страниц) ──
  function css(){
    if (!document.head || document.getElementById('d37DadCss')) return;
    const s = document.createElement('style');
    s.id = 'd37DadCss';
    s.textContent = `
.d37-dad{position:relative;text-align:left}
.d37-feed.d37-dad{padding:.5rem .55rem .6rem;justify-content:flex-start}
.dad{position:relative;display:flex;flex-direction:column;gap:.35rem;min-width:0;font-family:Montserrat,system-ui,sans-serif}
.dad-lbl{display:flex;align-items:center;gap:.35rem;min-width:0;font-size:.64rem;line-height:1.3;color:var(--muted,#8d8daa);letter-spacing:.02em}
.dad-lbl-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dad-lbl-t b{color:var(--text,#f0f0f8);font-weight:700}
.dad-age{display:inline-block;padding:0 .3rem;border-radius:5px;border:1px solid currentColor;font-size:.6rem;font-weight:800;line-height:1.35;opacity:.85}
.dad-i{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid var(--border,rgba(255,255,255,.18));background:rgba(255,255,255,.05);color:inherit;font-size:.72rem;line-height:1;cursor:pointer;padding:0}
.dad-i:hover{color:#fff;border-color:rgba(255,255,255,.4)}
.dad-a{display:flex;flex-direction:column;gap:.35rem;color:inherit;text-decoration:none;min-width:0}
.dad-native .dad-img{display:block;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.05)}
.dad-native .dad-img img{width:100%;height:100%;object-fit:cover;display:block}
.dad-t{font-size:.86rem;font-weight:800;line-height:1.3;color:var(--text,#f0f0f8);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dad-d{font-size:.74rem;line-height:1.4;color:var(--muted,#8d8daa);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dad-foot{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:auto;font-size:.7rem}
.dad-host{color:var(--muted,#8d8daa);font-size:.68rem;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dad-cta{flex:none;padding:.3rem .65rem;border-radius:999px;background:var(--accent,#ff2d55);color:#fff;font-weight:800}
.dad-a:hover .dad-t{text-decoration:underline}
.dad-banner,.dad-rail{align-items:center;margin:0 auto;max-width:100%}
.dad-banner .dad-lbl,.dad-rail .dad-lbl{width:min(100%,var(--dad-w));}
.dad-rail .dad-lbl{align-items:flex-start}.dad-rail .dad-lbl-t{white-space:normal}   /* узкий столбик: рекламодатель целиком, в две строки */
.dad-banner .dad-a,.dad-rail .dad-a{width:min(100%,var(--dad-w));aspect-ratio:var(--dad-ar);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.04)}
.dad-banner img,.dad-rail img{width:100%;height:100%;display:block;object-fit:cover}
.dad-banner .dad-host,.dad-rail .dad-host{width:min(100%,var(--dad-w));text-align:right}
.dad-noimg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:.6rem;box-sizing:border-box;font-weight:800;text-align:center}
.list-view .d37-feed .dad-native .dad-a,.d37-feed.row .dad-native .dad-a{flex-direction:row;align-items:center;gap:.7rem}
.list-view .d37-feed .dad-native .dad-img,.d37-feed.row .dad-native .dad-img{flex:none;width:min(42%,220px)}
.list-view .d37-feed .dad-foot,.d37-feed.row .dad-foot{margin-top:.2rem}
.dad-pop{position:absolute;z-index:30;left:0;right:0;top:1.6rem;margin:0 auto;max-width:320px;padding:.8rem .9rem;border-radius:14px;background:#16161f;border:1px solid rgba(255,255,255,.16);box-shadow:0 18px 40px rgba(0,0,0,.55);color:#f0f0f8;font:600 .74rem/1.45 Montserrat,system-ui,sans-serif;text-align:left}
.dad-pop-fixed{position:fixed;z-index:100250;top:auto;bottom:1rem;left:1rem;right:1rem}
.dad-pop>b{display:block;font-size:.82rem;margin-bottom:.35rem}
.dad-pop-row{display:flex;justify-content:space-between;gap:.6rem;padding:.2rem 0;border-bottom:1px solid rgba(255,255,255,.07)}
.dad-pop-row span{color:#8d8daa}.dad-pop-row b,.dad-pop-row a{text-align:right;word-break:break-all;color:#fff}
.dad-pop p{margin:.45rem 0 0;color:#a9a9c2;font-size:.68rem}
.dad-pop p a{color:#7cc4ff}
.dad-pop-act{display:flex;gap:.4rem;margin-top:.55rem}
.dad-pop-act button{flex:1;padding:.42rem .5rem;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff;font:700 .7rem Montserrat,system-ui,sans-serif;cursor:pointer}
.dad-pop-st{margin-top:.35rem;font-size:.68rem;color:#ffd166;min-height:0}
.d37-rail .d37-dad{min-height:0}`;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', css); else css();
  // Подсказка «что работает» — сразу (к моменту, когда места подъедут к экрану, ответ уже есть)
  if (!off && !perk()) setTimeout(freshLive, 0);

  window.D37AdDirect = {
    has, wants, fill, ready, billboard, seen, about, cabinet, geo, section, refresh: () => loadLive(true), img: imgUrl,
    live: () => live, isOff: () => off, DEF,
    rules: { BAD_WORDS, SHORT_HOSTS, SIZES, KIND_GROUP, GROUP, textBad, urlBad, hostOf },
    _test: { pickFor, render, watch, chooseKind, imgUrl, session, rpc, shown, sent, watchers, setLive: v => { live = v; }, setOff: v => { off = v; }, groupOf, goHref, mark,
      resetGeo: () => { geoP = null; } },
  };
})();
