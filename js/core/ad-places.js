// ═══════════════════════════════════════
//  МЕСТА РЕКЛАМЫ — диспетчер (после ads-core.js; и в SPA, и на серверных страницах)
// ═══════════════════════════════════════
// Каждое место спрашивает отсюда «можно ли сейчас»: частота (не в первые N секунд визита, не чаще раза в N секунд,
// не больше M за визит, раз в N партий), общий лимит показов за визит, VIP и персонал — без рекламы (за награду —
// только сами, по кнопке), «рядом нельзя»: ролики про кейсы/депозиты, чужие игры и миры без проверки, идёт партия.
// Визит — вкладка (sessionStorage), 30 минут тишины — новый визит. Номера блоков — window.ADS_IDS (ads-core.js).
// Новые места (что, где, как часто — ADS_RULES ниже):
//   loading — экран загрузки мира, Студии 3D, большой игры, компилятора C++/Rust: только если грузится дольше 1,5 с,
//             под прогрессом, рядом подсказка; загрузилось — реклама сразу убирается (игру не задерживаем ни на миг)
//   break   — компьютер, каждая 3-я партия: «☕ Перерыв» с рекламой ПОД игрой (не поверх, гаснет, как только снова играешь)
//   feed    — карточка «Реклама» в длинных списках: витрина игр, видео, каталоги «Студии игр» и Unity (только проверенные)
//   rail    — компьютер от 1400 px: один липкий столбик справа от игры, только если там правда пусто
// Щиты в «Мире Денчика» — не реклама сетей (её нельзя рисовать в 3D): свои промо и спонсор — js/games/mir-promo.js.
// Прямая реклама (кабинет рекламодателя #/adv, ads.sql) — js/core/ad-direct.js: подошла своя кампания — она раньше сети
// (show → direct), не нашлось — как раньше. Места считаются «есть» (hasId) и без номера блока, если такие кампании работают.
// Отладка (запоминается в браузере): ?adsdebug=1 — все места рамками с подписью вместо рекламы (запросов в сети нет),
// 2 — то же без лимитов частоты (для скриншотов), 3 — настоящая реклама, но обведена; ?adsdebug=0 — выключить.
(() => {
  const now = () => Date.now();
  const RULES = window.ADS_RULES = Object.assign({
    budget: 40,    // всего показов за визит (кроме «за награду»)
    vip: true,     // VIP и персонал — без рекламы
    places: {
      loading:      { delay: 1500, gap: 90, max: 6 },
      break:        { every: 3, first: 120, gap: 300, max: 4, desk: true },
      game_over:    { refresh: 90 },   // под игрой: обновить не чаще раза в 90 с и только у Яндекса (Google — без обновлений)
      interstitial: { after: 2, first: 60, gap: 180, max: 6, mob: true },
      floor:        { first: 12, max: 3, mob: true, minW: 320, maxW: 420 },   // РСЯ: overlay — только экраны 320–420 px
      rail:         { first: 15, gap: 60, max: 12, desk: true, minW: 1400 },
      feed:         { max: 16 },
    },
    // Реклама по возрасту (js/core/age.js → D37Age.group()). Google: tfat — «обработка» запроса (data-tag-for-age-treatment:
    // 1 — ребёнок, 2 — подросток; support.google.com/adsense/answer/3248194), npa — без персональной рекламы
    // (adsbygoogle.requestNonPersonalizedAds). У РСЯ в коде блока «детского» параметра нет — поэтому детям меньше мест:
    // off — каких мест у группы нет (reward — реклама за награду, sponsor — спонсор щитов мира), budget — свой лимит за визит.
    // unknown — как считать тех, кто возраст не указал: 'teen' — без персональной рекламы (Google платит меньше, зато спокойно с
    // законами о детях: аудитория — в основном дети); 'adult' — больше дохода, но дети без возраста получат персональную рекламу;
    // 'child' — строже всего. ADS_IDS.kids (ads-core.js) — весь сайт «для детей»: 1 — всем как ребёнку, 2 — не старше подростка.
    age: {
      unknown: 'teen',
      child:  { tfat: 1, npa: 1, off: ['interstitial', 'floor', 'reward', 'sponsor'], budget: 20 },
      teen:   { tfat: 2, npa: 1, off: [] },
      teen16: { tfat: 2, npa: 1, off: [] },
      adult:  { tfat: 0, npa: 0, off: [] },
    },
  }, window.ADS_RULES || {});
  // «Рядом нельзя»: что каждое состояние запрещает ('*' — всё, кроме рекламы за награду по кнопке)
  const CTX = { gambling: '*', ugc: ['loading', 'break', 'rail', 'feed'], playing: ['break'] };
  // Номера блоков: своё место → общее (Яндекс: перерыв — тот же блок, что под игрой; Google — запасные готовые блоки)
  const YA_FB = { break: 'game_over', interstitial: 'fullscreen' };
  const G_FB = { break: 'game_over', loading: 'game_over', rail: 'game_over', feed: 'games_hub' };
  const SIZE = { loading: 'до 728×250, адаптивный', break: '728×90 / 300×250', rail: '160×600 или 300×600', feed: 'карточка ~300×250', game_over: 'адаптивный', games_hub: 'адаптивный' };
  const base = k => /^feed/.test(k) ? 'feed' : k;
  const rule = k => RULES.places[base(k)] || {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 768px)').matches; } catch (e) { return false; } };
  const vw = () => (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 0;

  // ── Отладка ──
  const dbg = { on: false, frames: false, nocaps: false, log: [] };
  try {
    const m = /[?&]adsdebug=(\d)/.exec(location.search || '');
    if (m) { if (m[1] === '0') localStorage.removeItem('d37_ads_debug'); else localStorage.setItem('d37_ads_debug', m[1]); }
    const v = localStorage.getItem('d37_ads_debug');
    dbg.on = !!v; dbg.frames = v === '1' || v === '2'; dbg.nocaps = v === '2';
  } catch (e) {}
  function log(place, why){
    dbg.log.push([new Date().toLocaleTimeString('ru'), place, why]);
    if (dbg.log.length > 80) dbg.log.shift();
    if (dbg.on) try { console.info('[реклама]', place, why || 'показ'); } catch (e) {}
  }

  // ── Визит: сколько показано и когда ──
  const SK = 'd37_ads_s';
  let ST = null;
  function st(){
    if (ST) return ST;
    try { ST = JSON.parse(sessionStorage.getItem(SK) || 'null'); } catch (e) {}
    if (!ST || typeof ST !== 'object' || !ST.t0 || now() - (ST.at || 0) > 30 * 60e3) ST = { t0: now(), at: now(), n: 0, p: {}, rounds: 0, inter: 0 };
    ST.p = ST.p || {};
    return ST;
  }
  function save(){ const s = st(); s.at = now(); try { sessionStorage.setItem(SK, JSON.stringify(s)); } catch (e) {} }

  // ── VIP и персонал — без рекламы ──
  // Профиль в SPA (chat.js: currentProfile/currentRole) → и запоминаем в браузере (d37_noads), чтобы серверные страницы
  // и первые секунды SPA до загрузки профиля тоже были без рекламы. Обойти можно — как и блокировщиком, не страшно.
  const NK = 'd37_noads';
  const STAFF = ['admin', 'moderator', 'helper'];
  function perkFromProfile(){
    if (typeof currentProfile === 'undefined' || !currentProfile) return null;
    const p = currentProfile, role = (typeof currentRole !== 'undefined' && currentRole) || p.role;
    if (STAFF.includes(role)) return { until: now() + 7 * 864e5 };
    let tier = null;
    try { tier = typeof getVipTier === 'function' ? getVipTier(p) : null; } catch (e) {}
    let active = !!tier;
    if (!active) try { active = typeof isVipActive === 'function' ? isVipActive(p) : false; } catch (e) {}
    if (!active) return false;
    const until = p.vip_until ? Date.parse(p.vip_until) : 0;
    return { until: Math.min(until > now() ? until : Infinity, now() + 7 * 864e5) };
  }
  function noAdsPerk(){
    if (!RULES.vip) return false;
    const p = perkFromProfile();
    if (p !== null) return !!p;
    try { const c = JSON.parse(localStorage.getItem(NK) || 'null'); return !!(c && c.until > now()); } catch (e) { return false; }
  }
  function syncPerk(){
    const p = typeof currentUser !== 'undefined' && currentUser ? perkFromProfile() : false;
    try { if (p) localStorage.setItem(NK, JSON.stringify({ until: p.until })); else if (p === false) localStorage.removeItem(NK); } catch (e) {}
    if (gate()) purge();
  }

  // ── Возраст: группа для рекламы и её правила (RULES.age) ──
  function adAge(){
    const A = RULES.age || {};
    let g = (window.D37Age && typeof window.D37Age.group === 'function' && window.D37Age.group()) || 'unknown';
    if (g === 'unknown' || !A[g]) g = A[A.unknown] ? A.unknown : 'teen';
    const k = +((window.ADS_IDS && window.ADS_IDS.kids) || 0);   // весь сайт «для детей» — строже, чем по возрасту
    if (k === 1) g = 'child'; else if (k === 2 && g === 'adult') g = 'teen';
    return g;
  }
  const ageRule = () => (RULES.age || {})[adAge()] || {};
  const ageOff = what => (ageRule().off || []).includes(what);
  const budget = () => ageRule().budget ?? RULES.budget;
  // Запросы Google: без персональной рекламы по возрасту; пауза — у VIP. В <head> запросы на паузе с самого начала (index.html,
  // page.js) — здесь решаем и снимаем, поэтому даже «автоматическая реклама» не уйдёт раньше, чем узнаем возраст. → VIP ли
  function gate(){
    const on = noAdsPerk();
    try {
      const A = window.adsbygoogle = window.adsbygoogle || [];
      A.requestNonPersonalizedAds = ageRule().npa ? 1 : 0;
      if (on || window.__d37Paused) { A.pauseAdRequests = on ? 1 : 0; window.__d37Paused = on; }
    } catch (e) {}
    return on;
  }
  // Всё, что уже показано, — убрать (вошёл VIP)
  function purge(){
    document.querySelectorAll('.d37-feed, .d37-adload, .d37-adcard').forEach(e => e.remove());
    railOff();
    document.querySelectorAll('.d37-ad').forEach(e => { e.innerHTML = ''; e.hidden = true; });
    const ga = document.getElementById('gamesAd'); if (ga) { ga.innerHTML = ''; ga.hidden = true; delete ga.dataset.net; }   // и «Перерыв»
    ['ad-mid', 'ad-top', 'ad-bottom'].forEach(id => document.getElementById(id)?.classList.add('ad-empty'));
  }

  // ── Контексты «рядом нельзя» ──
  const ctxOn = new Set();
  const G = { playing: false };
  // Чужие игры и миры, пока не знаем, что они прошли проверку: страница игры игрока, редактор, модерация, вход по ссылке
  const ugcRoute = () => /^#\/games\/(?:studio|unity)\/(?:play|edit|new|mod)\b|^#\/games\/studio3d\/(?:play|join)\b/.test(location.hash || '');
  const isOn = c => c === 'ugc' ? ugcRoute() || ctxOn.has(c) : c === 'playing' ? G.playing || ctxOn.has(c) : ctxOn.has(c);
  // Ролики про кейсы/промокоды на депозит — как GAMBLING_RE в api/_lib/yt.js (тест сверяет)
  const GAMBLING_RE = /ggdrop|ггдроп|case\s*battle|casebattle|кейс\s*батл|кейсбатл|казино|casino|промокод на деп|\bдеп\b|депозит|рулетк|ставк[аиу]/i;
  const gambling = list => (list || []).some(t => GAMBLING_RE.test(String(t || '')));

  // ── Номера блоков ──
  function ids(key){
    const A = window.ADS_IDS || {}, Y = A.yandex || {}, Gg = A.google || {}, b = base(key);
    return { ya: Y[key] || Y[b] || Y[YA_FB[b]] || '', g: Gg[key] || Gg[b] || Gg[G_FB[b]] || '' };
  }
  function hasNet(key){
    const i = ids(key), b = base(key);
    if (b === 'interstitial') return !!i.ya || !!(window.ADS_IDS && window.ADS_IDS.h5games);
    if (b === 'floor') return !!i.ya;
    return !!(i.ya || i.g);
  }
  // Место «есть»: блок сети или работающая кампания из кабинета рекламодателя (прямая реклама, js/core/ad-direct.js)
  function hasId(key){ return hasNet(key) || !!window.D37AdDirect?.has?.(key); }
  const net = key => { const i = ids(key); return i.ya ? 'ya' : i.g ? 'g' : ''; };

  // Почему нельзя показать сейчас ('' — можно). o.ignoreId — без проверки номера блока (отладка рисует рамку), o.ugc — чужое
  function why(key, o = {}){
    const b = base(key), R = rule(key), t = now(), s = st(), p = s.p[b] || {};
    if (!o.ignoreId && !hasId(key)) return 'id';
    if (noAdsPerk()) return 'vip';
    if (ageOff(b)) return 'age';   // этого места у возрастной группы нет (детям — без полноэкранной и полоски)
    for (const c in CTX) if ((CTX[c] === '*' || CTX[c].includes(b)) && isOn(c)) return c;
    if (o.ugc && CTX.ugc.includes(b)) return 'ugc';
    const touch = isTouch(), w = vw();
    if (R.desk && touch) return 'desk';
    if (R.mob && !touch) return 'mob';
    if (R.minW && w < R.minW) return 'narrow';
    if (R.maxW && w > R.maxW) return 'wide';
    if (dbg.nocaps || o.nocap) return '';
    if (R.first && t - s.t0 < R.first * 1e3) return 'first';
    if (R.gap && p.at && t - p.at < R.gap * 1e3) return 'gap';
    if (R.max != null && (p.n || 0) >= R.max) return 'max';
    if (budget() && s.n >= budget()) return 'budget';
    return '';
  }
  function mark(key){
    const s = st(), b = base(key), p = s.p[b] = s.p[b] || { n: 0, at: 0 };
    p.n = (p.n || 0) + 1; p.at = now(); s.n++;
    save(); log(key, '');
  }
  // Пустое место в отладке: рамка с подписью, какое это место и какого размера блок нужен
  function placeholder(el, key){
    el.hidden = false; el.classList.add('d37-ad');
    const i = ids(key), has = i.ya ? 'РСЯ ' + i.ya : i.g ? 'Google ' + i.g : 'номера блока нет — ADS_IDS в js/core/ads-core.js';
    el.innerHTML = `<span class="d37-ad-label">Реклама</span><div class="d37-ad-ph" data-k="${esc(base(key))}"><b>${esc(key)}</b><span>${esc(SIZE[base(key)] || SIZE[key] || 'адаптивный')}</span><small>${esc(has)}</small></div>`;
    return true;
  }
  // Формат блока Google по месту (РСЯ адаптивный — по размеру контейнера)
  const FORMAT = { loading: 'rectangle, horizontal', break: 'horizontal, rectangle', rail: 'vertical', feed: 'rectangle' };
  // Показать в el (проверки уже пройдены или делаются тут). → true, если место занято рекламой (или рамкой в отладке)
  function show(el, key, o = {}){
    if (!el) return false;
    const r = o.checked ? '' : why(key, { ignoreId: true, ugc: o.ugc });
    if (r) { log(key, r); return false; }
    if (direct(el, key, o)) { mark(key); return true; }   // прямая реклама (кабинет рекламодателя) — раньше сети
    if (dbg.frames) { placeholder(el, key); mark(key); return true; }
    if (!hasNet(key)) { log(key, 'id'); return false; }
    const ok = netShow(el, key, o);
    if (ok) mark(key);
    return ok;
  }
  // Реклама сети в el (показ засчитывает вызывающий)
  function netShow(el, key, o){
    const empty = o.onEmpty && (() => { if (el.dataset.adEmpty) return; el.dataset.adEmpty = '1'; log(key, 'unfilled'); o.onEmpty(el); });
    const ok = !!window.D37Ads?.render(el, key, { checked: true, onEmpty: empty, format: FORMAT[base(key)] });
    // блокировщик рекламы или сеть молчит: через 8 с пустое место с подписью «Реклама» — убрать (или своя подсказка)
    if (ok && empty) setTimeout(() => { if (el.isConnected && !filled(el)) empty(); }, 8000);
    return ok;
  }
  // ── Прямая реклама (кабинет рекламодателя #/adv: ads.sql, js/core/ad-direct.js) ──
  // Есть работающая кампания этого формата → место её: сервер выберет по таргетингу; не нашлось — как раньше
  // (сеть, рамка отладки, своя подсказка или пусто). Проверки «можно ли» (VIP, «рядом нельзя», частота) — уже пройдены.
  function direct(el, key, o = {}){
    const D = window.D37AdDirect;
    if (!D?.wants?.(key, o)) return false;
    const box = () => el.closest?.('#gamesAd');
    D.fill(el, key, {
      onShown: () => { const b = box(); if (b) b.dataset.net = 'dir'; log(key, 'direct'); },
      fallback: () => {
        if (!el.isConnected) return;
        const b = box(); if (b) b.dataset.net = netOf(key);
        if (dbg.frames) { placeholder(el, key); return; }
        if (hasNet(key) && netShow(el, key, o)) return;
        log(key, 'id');
        if (o.onEmpty) o.onEmpty(el); else { el.innerHTML = ''; el.hidden = true; }
      },
    });
    return true;
  }
  // Сеть что-то нарисовала: у РСЯ — содержимое в контейнере, у Google — ins с data-ad-status="filled"
  function filled(el){
    const ya = el.querySelector('[id^="yandex_rtb"]');
    if (ya) return ya.childElementCount > 0;
    const ins = el.querySelector('ins.adsbygoogle');
    return !!ins && (ins.getAttribute('data-ad-status') === 'filled' || (!ins.hasAttribute('data-ad-status') && ins.childElementCount > 0));
  }

  // ═══ Экран загрузки ═══
  // loading({ anchor }) — реклама кладётся ВНУТРЬ экрана загрузки (под прогрессом, .wld-status / .s3-loading / .gm-loading);
  // loading({ host, card }) — своя карточка в углу host (сборка C++/Rust: студия при этом работает).
  // { game, param } — зовёт games.js при открытии игры: у мира и Студии 3D свой экран загрузки — реклама будет там, а время
  // уже потраченной загрузки засчитывается. Возвращает { done(), step(текст) }: done — загрузка кончилась, рекламу убрать.
  const SELF_LOAD = new Set(['world', 'studio3d']);
  const TIPS = {
    world: ['Сядь за столик в кафе — партия начнётся, когда напротив сядет второй игрок', 'В парке можно плавать: «присесть» — нырнуть', 'Свой участок и дом — в районе за кафе, через арку', 'Нажми на игрока — его карточка: дружба и «позвать в игру»', 'У костра в парке можно посидеть на бревне'],
    studio: ['▶ Играть — пройди свой мир своим персонажем', 'Скрипты — на JS, Lua, C#, C++ и Rust', 'Ctrl+D — копия детали, F — камера к выбранному', '📤 Выложить — мир по ссылке или в каталог после проверки'],
    compile: ['Компилятор скачивается один раз — дальше сборка за пару секунд', 'Ошибки сборки — во «Выводе», с номером строки'],
    game: ['За победы — XP, монеты 🪙 и место в рекордах', '📣 Вызов — ссылка другу с твоим рекордом', 'Монеты — на своего персонажа в гардеробе'],
  };
  let loadT0 = 0;
  const ugcGame = (id, param) => ['studio', 'unity', 'studio3d'].includes(id) && /^(?:play|edit|new|mod|join)\b/.test(String(param || ''));
  function loading(o = {}){
    const h = { el: null, done, step };
    let over = false, timer = 0, stepEl = null;
    const start = now();
    if (o.game) {   // games.js: открыли игру
      loadT0 = SELF_LOAD.has(o.game) ? start : 0;   // у мира и Студии 3D реклама будет на их экране загрузки — с этого момента
      if (loadT0 || ugcGame(o.game, o.param)) { log('loading', loadT0 ? 'self' : 'ugc'); return h; }
    }
    const inherit = !o.game && loadT0 && start - loadT0 < 60e3;   // часть загрузки уже прошла в games.js
    const t0 = inherit ? loadT0 : start;
    if (!o.game) loadT0 = 0;
    const at = Math.max(t0 + (rule('loading').delay ?? 1500), inherit ? start + 600 : 0);
    timer = setTimeout(go, Math.max(0, at - now()));
    function go(){
      timer = 0;
      const host = o.anchor || o.host;
      if (over || !host || !host.isConnected) return;
      const r = why('loading', { ignoreId: true, ugc: o.ugc });
      if (r) { log('loading', r); return; }
      if (!hasId('loading') && !dbg.frames) { log('loading', 'id'); return; }
      if (o.card) {   // карточка в углу: только если есть место (на телефоне студия и так тесная)
        const b = o.host.getBoundingClientRect();
        if (b.width < 480 || b.height < 340) { log('loading', 'small'); return; }
      } else if (o.anchor && typeof getComputedStyle === 'function' && /absolute|fixed/.test(getComputedStyle(o.anchor).position)) {
        // экран загрузки поверх окна (мир, студия): реклама целиком должна поместиться — обрезанной рекламы не бывает
        if (o.anchor.getBoundingClientRect().height < 380) { log('loading', 'small'); return; }
      }
      const tips = TIPS[o.tip] || TIPS.game, tip = tips[Math.floor(Math.random() * tips.length)];
      const el = h.el = document.createElement('div');
      el.className = o.card ? 'd37-adcard' : 'd37-adload';
      el.innerHTML = (o.card ? `<div class="d37-adcard-h"><b>${esc(o.card)}</b><span class="d37-adcard-st"></span><button type="button" class="d37-adcard-x" aria-label="Скрыть">✕</button></div>` : '') +
        `<div class="d37-adload-tip">💡 ${esc(tip)}</div><div class="d37-adload-ad"></div>`;
      stepEl = el.querySelector('.d37-adcard-st');
      if (stepEl && o.text) stepEl.textContent = o.text;
      el.querySelector('.d37-adcard-x')?.addEventListener('click', done);
      (o.anchor || o.host).appendChild(el);
      if (!show(el.querySelector('.d37-adload-ad'), 'loading', { checked: true, onEmpty: () => el.querySelector('.d37-adload-ad')?.remove() })) done();
    }
    function step(text){ if (stepEl) stepEl.textContent = String(text || ''); else o.text = text; }
    function done(){ over = true; if (timer) clearTimeout(timer); timer = 0; h.el?.remove(); h.el = null; }
    return h;
  }

  // ═══ После партии (games.js → gamesAdAfterRound) ═══
  // Компьютер: каждая 3-я партия — «☕ Перерыв» с рекламой под игрой; иначе — обычное место под игрой (game_over).
  // Телефон — только game_over (полноэкранную между партиями зовут сами игры: D37Ads.interstitial).
  const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
  // Обновить рекламу в том же месте можно только у Яндекса (не чаще раза в 30 с — у нас 90); Google — только по просьбе человека
  // (рамки отладки — как Яндекс; ?adsdebug=2 — и без 90 с)
  const refreshOk = box => !box.dataset.net || (/^(ya|dbg|dir)$/.test(box.dataset.net) && (dbg.nocaps || now() - (+box.dataset.at || 0) >= (rule('game_over').refresh || 90) * 1e3));   // dir — прямая реклама
  const netOf = key => dbg.frames ? 'dbg' : net(key);
  function afterRound(stage){
    if (!stage || stage.hidden) return false;
    const s = st(); s.rounds = (s.rounds || 0) + 1; save();
    G.playing = false;
    let box = stage.querySelector('#gamesAd');
    if (!box) { box = document.createElement('div'); box.id = 'gamesAd'; stage.appendChild(box); }
    const R = rule('break');
    // #gamesAd — только коробка; внутри каждый раз новый элемент (классы у одного и того же не переключаем: Chrome
    // со стилями :has() иногда не пересчитывает такой элемент)
    if (!isTouch() && s.rounds % (R.every || 3) === 0 && refreshOk(box) && !why('break', { ignoreId: true }) && (hasId('break') || dbg.frames)) {
      box.hidden = false; box.className = ''; box.dataset.at = now(); box.dataset.net = netOf('break');
      box.innerHTML = `<div class="d37-break"><div class="d37-break-t">☕ <b>Перерыв</b> · ${s.rounds} ${plural(s.rounds, 'партия', 'партии', 'партий')} подряд — отдохни минутку, следующая подождёт</div><div class="d37-break-ad"></div></div>`;
      if (show(box.querySelector('.d37-break-ad'), 'break', { checked: true, onEmpty: () => { box.hidden = true; } })) return 'break';
    }
    if (!refreshOk(box)) return false;
    const r = why('game_over', { ignoreId: true });
    if (r || (!hasId('game_over') && !dbg.frames)) { log('game_over', r || 'id'); return false; }   // показанное не трогаем
    box.hidden = false; box.className = ''; box.innerHTML = '<div></div>'; box.dataset.at = now(); box.dataset.net = netOf('game_over');
    if (show(box.firstChild, 'game_over', { checked: true })) return 'game_over';
    box.innerHTML = ''; delete box.dataset.net;
    return false;
  }
  // Снова играет (нажал в игре): «перерыв» гаснет — реклама остаётся обычным местом под игрой, без перезагрузки
  function onGameInput(e){
    if (!/^#\/games\/./.test(location.hash || '')) return;
    if (e.type === 'pointerdown' && !e.target?.closest?.('#gamesStageBox')) return;
    G.playing = true;
    const b = document.querySelector('#gamesAd .d37-break'), box = b?.parentNode;
    if (b && now() - (+box.dataset.at || 0) > 1500) { b.querySelector('.d37-break-t')?.remove(); b.classList.remove('d37-break'); b.classList.add('d37-break-off'); }
  }
  // Телефон, полноэкранная между партиями: игры зовут D37Ads.interstitial() — здесь счёт партий и частота
  function interRound(){
    const s = st(); s.inter = (s.inter || 0) + 1; save();
    if (s.inter < (rule('interstitial').after || 2)) { log('interstitial', 'first-round'); return false; }
    const r = why('interstitial');
    if (r) { log('interstitial', r); return false; }
    return true;
  }

  // ═══ Карточки «Реклама» в длинных списках ═══
  // feed(список, { place, every, start, max, row, cls, titles }) — после каждой every-й карточки (начиная со start-й), не
  // последней в списке; row — на всю строку сетки (у мелких карточек). titles — названия роликов: есть «азартные» — без
  // рекламы во всём списке. Реклама грузится, только когда карточка подъезжает к экрану; нет рекламы — своя подсказка.
  const HOUSE = [['🧟', 'Орда', 'Выживи 10 минут против орды монстров', '#/games/horde'], ['🌍', 'Мир Денчика', 'Онлайн-мир в 3D: кафе, столики, свой дом', '#/games/world'],
    ['🔤', 'Слово дня', 'Угадай слово из 5 букв — новое каждый день', '#/games/words'], ['🧱', 'Студия 3D', 'Построй свой мир со скриптами, как в Roblox', '#/games/studio3d'],
    ['✨', 'VIP', 'Цветной ник, стикеры и сайт без рекламы', '/vip']];
  const spaHref = h => h[0] === '#' && location.pathname !== '/' && location.pathname !== '/index.html' ? '/' + h : h;
  function house(c){
    const [ic, t, d, href] = HOUSE[Math.floor(Math.random() * HOUSE.length)];
    c.className = c.className.replace(/\bd37-ad\b/g, '').trim() + ' d37-house';
    c.innerHTML = `<a href="${esc(spaHref(href))}"><span class="d37-house-ic">${ic}</span><b>${esc(t)}</b><small>${esc(d)}</small><span class="d37-house-go">Открыть →</span></a>`;
  }
  let io = null;
  const lazyFns = new WeakMap();
  function lazy(el, fn){
    if (typeof IntersectionObserver !== 'function') { fn(); return; }
    if (!io) io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; io.unobserve(e.target); const f = lazyFns.get(e.target); lazyFns.delete(e.target); if (f && e.target.isConnected) f(); }), { rootMargin: '300px 0px' });
    lazyFns.set(el, fn); io.observe(el);
  }
  function feed(box, o = {}){
    if (!box) return 0;
    box.querySelectorAll(':scope > .d37-feed').forEach(e => e.remove());
    const place = o.place || 'feed', every = o.every || 8, start = o.start || every;
    const items = [...box.children];
    if (items.length <= start) return 0;
    if (o.titles && gambling(o.titles)) { log(place, 'gambling'); return 0; }
    const r = why(place, { ignoreId: true, nocap: true });
    if (r) { log(place, r); return 0; }
    if (!hasId(place) && !dbg.frames) { log(place, 'id'); return 0; }
    const s = st(), p = s.p.feed || {}, R = rule(place);
    let left = Math.min(o.max ?? 3, dbg.nocaps ? 99 : (R.max ?? 99) - (p.n || 0), dbg.nocaps || !budget() ? 99 : budget() - s.n);
    let n = 0;
    for (let i = start; i < items.length && n < left; i += every) {
      const c = document.createElement('div');
      c.className = 'd37-feed' + (o.row ? ' row' : '') + (o.cls ? ' ' + o.cls : '');
      c.dataset.place = place;
      items[i - 1].after(c); n++;
      lazy(c, () => {
        if (why(place, { ignoreId: true, nocap: true })) { c.remove(); return; }   // пока листал, вошёл VIP
        if (!show(c, place, { checked: true, onEmpty: () => house(c) })) house(c);
      });
    }
    return n;
  }

  // ═══ Столбик справа от игры (компьютер) ═══
  // AdSense: липкое — не шире 300 px, одно на экране (не зеркальные с двух сторон), не вплотную к содержимому и полосе
  // прокрутки, въезжает и уезжает вместе с разделом игры (липнет только пока раздел на экране — railStick). У Google —
  // ещё и ≥ 150 px от самой игры. Под окном Студии 3D, редактором персонажа и на весь экран — убираем (скрытой рекламы нет).
  const RAIL = { el: null, w: 0 };
  const GAP = 40, EDGE = 16, STICKY = 84;
  function gameRect(stage){
    const box = stage.querySelector('#gamesStageBox') || stage;
    let l = Infinity, r = -Infinity;
    box.querySelectorAll('canvas, button, input, select, textarea, a, iframe, [data-act], [role="button"], .wld-wrap').forEach(e => {
      const b = e.getBoundingClientRect(); if (b.width && b.height) { l = Math.min(l, b.left); r = Math.max(r, b.right); }
    });
    if (r < l) { const b = box.getBoundingClientRect(); return { left: b.left, right: b.right }; }
    return { left: l, right: r };
  }
  // Кнопки, прижатые к правому краю экрана (переключатель «Мощное/Слабое», «наверх»…): столбик левее их
  function edgeReserve(W){
    let r = 0;
    for (const e of document.body.children) {
      if (e.classList?.contains('d37-rail')) continue;
      const b = e.getBoundingClientRect?.();
      if (!b || !b.width || !b.height || b.right < W - 4 || b.width > 240) continue;
      if (typeof getComputedStyle === 'function' && getComputedStyle(e).position !== 'fixed') continue;
      r = Math.max(r, b.width);
    }
    return r;
  }
  // Где можно поставить столбик ({ left, top, height, w } от раздела игр) или null
  function railSpot(){
    if (!/^#\/games\/./.test(location.hash || '') || isTouch()) return null;
    const html = document.documentElement;
    if (['s3-open', 'wld-editing', 'hd-lock', 'gs-full'].some(c => html.classList.contains(c)) || document.fullscreenElement) return null;   // окно поверх / игра на весь экран
    const page = $('#games-page'), stage = $('#gamesStage');
    if (!page || !stage || stage.hidden || page.style.display === 'none') return null;
    const W = vw();
    if (W < (rule('rail').minW || 1400)) return null;
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return null;
    const edge = EDGE + edgeReserve(W), free = W - sr.right - GAP - edge;
    const w = free >= 300 ? 300 : free >= 160 ? 160 : 0;
    if (!w) return null;
    let x = sr.right + GAP + Math.floor((free - w) / 2);
    if (net('rail') === 'g') {   // Google: от края игры не ближе 150 px
      const gr = gameRect(stage);
      if (x - gr.right < 150) { x = Math.ceil(gr.right + 150); if (x + w > W - edge) return null; }
    }
    const pr = page.getBoundingClientRect();
    return { left: Math.round(x - pr.left), top: Math.round(sr.top - pr.top), height: Math.round(Math.max(sr.height, 640)), w };
  }
  function railOff(){ if (RAIL.el) { RAIL.el.remove(); RAIL.el = null; } }
  // «Липкий» вручную: у html и body сайта overflow-x: hidden — body становится областью прокрутки, и position: sticky
  // не липнет. Поэтому: пока раздел игры на экране — блок fixed на 84 px сверху, в начале и в конце раздела — уезжает с ним
  function railStick(){
    const el = RAIL.el, inner = el?.firstChild;
    if (!inner) return;
    const a = el.getBoundingClientRect(), h = inner.offsetHeight || 620;
    const mode = a.top >= STICKY ? 'top' : a.bottom - h <= STICKY ? 'bottom' : 'fixed';
    if (inner.dataset.stick === mode && mode !== 'fixed') return;
    inner.dataset.stick = mode;
    inner.style.cssText = mode === 'fixed' ? `position:fixed;top:${STICKY}px;bottom:auto;left:${Math.round(a.left)}px;width:${Math.round(a.width)}px`
      : `position:absolute;top:${mode === 'top' ? '0' : 'auto'};bottom:${mode === 'bottom' ? '0' : 'auto'};left:0;width:100%`;
  }
  const onScroll = () => { if (RAIL.el) railStick(); };   // событие прокрутки и так раз в кадр; стиль меняется только на границах
  // Столбик целиком закрыт (окно поверх, игра «на весь экран» своим способом) — скрытой рекламы не бывает: убрать.
  // Шапка, всплывашки и кнопки у края не считаются — только то, что накрывает весь видимый столбик.
  function railCovered(){
    const inner = RAIL.el?.firstChild;
    if (!inner || typeof document.elementFromPoint !== 'function') return false;
    const b = inner.getBoundingClientRect(), H = window.innerHeight || 0;
    const top = Math.max(b.top, 0), bot = Math.min(b.bottom, H), y = (top + bot) / 2;
    if (bot - top < 40) return false;
    const hit = document.elementFromPoint(b.left + b.width / 2, y);
    if (!hit || RAIL.el.contains(hit)) return false;
    for (let n = hit; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const c = n.getBoundingClientRect();
      if (c.left <= b.left && c.right >= b.right && c.top <= top && c.bottom >= bot) return true;
    }
    return false;
  }
  function railTick(){
    const spot = railSpot();
    if (!spot) { railOff(); return; }
    if (RAIL.el && RAIL.w !== spot.w) railOff();   // ширина поменялась — другой размер блока
    if (!RAIL.el) {
      const r = why('rail', { ignoreId: true });
      if (r) { if (r !== 'narrow') log('rail', r); return; }
      if (!hasId('rail') && !dbg.frames) return;
      const el = RAIL.el = document.createElement('aside');
      el.className = 'd37-rail'; el.setAttribute('aria-label', 'Реклама');
      el.innerHTML = '<div class="d37-rail-in"></div>';
      RAIL.w = spot.w;
      $('#games-page').appendChild(el);
      Object.assign(el.style, { left: spot.left + 'px', top: spot.top + 'px', height: spot.height + 'px', width: spot.w + 'px' });
      if (!show(el.firstChild, 'rail', { checked: true, onEmpty: railOff })) { railOff(); return; }
      railStick();
      return;
    }
    Object.assign(RAIL.el.style, { left: spot.left + 'px', top: spot.top + 'px', height: spot.height + 'px' });
    railStick();
    if (railCovered()) { log('rail', 'covered'); railOff(); }
  }

  // ═══ Монеты за рекламу 🪙 (обычные монеты, не донатная валюта и не деньги) ═══
  // coinOffer(где) → кнопка «📺 Реклама → +40 🪙» (или пусто). Только если есть блок «за награду» (rewardReady), монеты за
  // рекламу на сегодня не кончились (canAd: 8 в день, сервер coins_ad) и с прошлой награды здесь прошло 10 минут.
  // Нажатие ловит этот файл сам (data-d37-reward) — игре ничего делать не надо.
  const CD = 10 * 60e3, CDK = 'd37_coinad_at';
  const cdLeft = () => { let t = 0; try { t = +localStorage.getItem(CDK) || 0; } catch (e) {} return Math.max(0, t + CD - now()); };
  function coinOffer(where){
    const W = window.D37Coins, A = window.D37Ads;
    if (!W || !A?.rewardReady?.() || !W.canAd?.()) return '';
    const got = W.RULES?.ad ?? 40, left = cdLeft();
    if (left > 0) return `<button type="button" class="d37-coinad" disabled title="Награда за рекламу — раз в 10 минут">📺 +${got} 🪙 за рекламу — через ${Math.ceil(left / 60e3)} мин</button>`;
    return `<button type="button" class="d37-coinad" data-d37-reward="coins" data-where="${esc(where || '')}" title="Посмотреть рекламу и получить ${got} монет">📺 Реклама → +${got} 🪙</button>`;
  }
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); };
  async function onCoinAd(b){
    const W = window.D37Coins, A = window.D37Ads;
    if (!W || !A || b.disabled) return;
    b.disabled = true;
    const ok = await A.showReward('coins_' + (b.dataset.where || 'offer'));
    if (!ok) { toast('Реклама не досмотрена — монет нет'); b.disabled = false; return; }
    const r = await W.adCoins();
    if (r?.ok) {
      try { localStorage.setItem(CDK, String(now())); } catch (e) {}
      toast(`📺 +${r.got} 🪙 — спасибо!`); b.textContent = `✅ +${r.got} 🪙 · снова через 10 мин`;
      try { window.dispatchEvent(new CustomEvent('d37:coinad', { detail: { where: b.dataset.where || '', got: r.got } })); } catch (e) {}   // игра перерисует магазин
    } else { toast(r?.reason === 'day_cap' ? 'На сегодня награды за рекламу кончились' : 'Подожди минутку и попробуй снова'); b.disabled = false; }
  }

  // ═══ Спонсор на щитах «Мира Денчика» (site_config 'ad_sponsor', задаёт админ) ═══
  // Реклама по прямой договорённости: по закону (38-ФЗ, ст. 18.1) — пометка «Реклама», рекламодатель и erid из ОРД.
  const SPONSOR_KEY = 'ad_sponsor';
  const strip = (v, n) => { let s = ''; for (const ch of String(v ?? '')) s += ch.charCodeAt(0) < 32 ? ' ' : ch; return s.trim().slice(0, n); };
  function safeUrl(u){
    u = String(u || '').trim();
    if (/^#\/[\w\-/]*$/.test(u) || /^\/(?!\/)[\w\-/?=&.%#]*$/.test(u)) return u;   // свой раздел или страница сайта
    try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? x.href : ''; } catch (e) { return ''; }
  }
  function cleanSponsor(c){
    if (!c || typeof c !== 'object' || !c.on) return null;
    const title = strip(c.title, 40), url = safeUrl(c.url);
    if (!title || !url) return null;
    if (c.until && /^\d{4}-\d{2}-\d{2}$/.test(c.until) && Date.parse(c.until + 'T23:59:59+03:00') < now()) return null;
    const col = (v, d) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : d;
    return { title, text: strip(c.text, 90), url, advertiser: strip(c.advertiser, 60), erid: strip(c.erid, 40).replace(/[^\w-]/g, ''), bg: col(c.bg, '#0f172a'), fg: col(c.fg, '#ffffff'), until: /^\d{4}-\d{2}-\d{2}$/.test(c.until || '') ? c.until : '' };
  }
  let sponsorP = null, sponsorAt = 0;
  function sponsor(){
    if (noAdsPerk() || ageOff('sponsor')) return Promise.resolve(null);   // детям — только свои промо сайта
    if (sponsorP && now() - sponsorAt < 10 * 60e3) return sponsorP;
    sponsorAt = now();
    sponsorP = (async () => {
      if (typeof sbClient === 'undefined' || !sbClient) return null;
      try { const { data } = await sbClient.from('site_config').select('value').eq('key', SPONSOR_KEY).maybeSingle(); return cleanSponsor(data?.value ? JSON.parse(data.value) : null); }
      catch (e) { return null; }
    })();
    return sponsorP;
  }
  // Редактор спонсора — в «⚙️ Настройки сайта» (только админ: писать site_config может только он)
  function sponsorAdmin(){
    const modal = document.getElementById('settingsAdminModal');
    const card = modal?.firstElementChild;
    if (!card || card.querySelector('#d37Sponsor')) return;
    const box = document.createElement('div');
    box.id = 'd37Sponsor'; box.className = 'd37-spadm';
    box.innerHTML = `<div class="d37-spadm-h">📣 Спонсор на щитах «Мира Денчика»</div>
      <p>Щиты в 3D-мире показывают разделы сайта; сюда можно поставить рекламодателя по прямой договорённости. По закону — пометка «Реклама», рекламодатель и erid (выдаёт ОРД при регистрации креатива). VIP спонсора не видят.</p>
      <label class="d37-spadm-on"><input type="checkbox" data-f="on"> Показывать</label>
      <input data-f="title" maxlength="40" placeholder="Заголовок, напр. 🎧 Наушники X — скидка 20%">
      <input data-f="text" maxlength="90" placeholder="Текст под заголовком">
      <input data-f="url" maxlength="300" placeholder="Ссылка: https://… или /раздел сайта">
      <input data-f="advertiser" maxlength="60" placeholder="Рекламодатель (ООО «…» или ИП …)">
      <input data-f="erid" maxlength="40" placeholder="erid (токен из ОРД)">
      <div class="d37-spadm-row"><label>Фон <input type="color" data-f="bg" value="#0f172a"></label><label>Текст <input type="color" data-f="fg" value="#ffffff"></label><label>До <input type="date" data-f="until"></label></div>
      <button type="button" class="d37-spadm-save">Сохранить</button><div class="d37-spadm-st"></div>`;
    card.appendChild(box);
    const f = k => box.querySelector(`[data-f="${k}"]`);
    (async () => {
      try {
        const { data } = await sbClient.from('site_config').select('value').eq('key', SPONSOR_KEY).maybeSingle();
        const c = data?.value ? JSON.parse(data.value) : {};
        f('on').checked = !!c.on;
        for (const k of ['title', 'text', 'url', 'advertiser', 'erid', 'until']) if (c[k]) f(k).value = c[k];
        for (const k of ['bg', 'fg']) if (/^#[0-9a-f]{6}$/i.test(c[k] || '')) f(k).value = c[k];
      } catch (e) {}
    })();
    box.querySelector('.d37-spadm-save').onclick = async () => {
      const stEl = box.querySelector('.d37-spadm-st');
      const c = { on: f('on').checked };
      for (const k of ['title', 'text', 'url', 'advertiser', 'erid', 'bg', 'fg', 'until']) c[k] = f(k).value.trim();
      if (c.on && !cleanSponsor(c)) { stEl.textContent = '⚠ Нужны заголовок и ссылка (https://… или /раздел)'; return; }
      if (c.on && (!c.advertiser || !c.erid)) stEl.textContent = '⚠ Без рекламодателя и erid реклама не по закону — сохраняю, но лучше дописать';
      try {
        const { error } = await sbClient.from('site_config').upsert([{ key: SPONSOR_KEY, value: JSON.stringify(c) }]);
        if (error) throw error;
        sponsorP = null;
        stEl.textContent = (stEl.textContent ? stEl.textContent + ' · ' : '') + '✅ Сохранено';
      } catch (e) { stEl.textContent = '⚠ Не сохранилось: ' + (e.message || e); }
    };
  }

  // ═══ Щиты в «Мире Денчика»: mir.js зовёт worldPromo(S, { panel, go }) — сам модуль грузится только тут ═══
  function loadScript(src){
    if (typeof gamesLoadScript === 'function') return gamesLoadScript(src);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function worldPromo(S, ctx){
    const h = { dead: false, real: null, tap: () => false, dispose(){ h.dead = true; try { h.real?.dispose(); } catch (e) {} h.real = null; } };
    loadScript('js/games/mir-promo.js').then(() => {
      if (h.dead || !window.MirPromo || !S || S.stopped) return;
      h.real = window.MirPromo.start(S, ctx || {});
      h.tap = (x, y) => !!h.real?.tap(x, y);
    }).catch(() => {});
    return h;
  }

  // ═══ Серверные страницы: <div data-ad="ключ"> (data-ad-lazy — грузить, когда подъедет к экрану) ═══
  function fillAll(){
    document.querySelectorAll('[data-ad]').forEach(el => {
      if (el.dataset.adDone) return;
      el.dataset.adDone = '1';
      const key = el.dataset.ad;
      const go = () => {
        if (el.classList.contains('d37-feed')) { if (!show(el, key, { onEmpty: () => house(el) })) el.remove(); return; }
        if (!show(el, key)) el.hidden = true;
      };
      if (el.hasAttribute('data-ad-lazy')) lazy(el, go); else go();
    });
  }

  // ═══ Стили (свои — чтобы не трогать общий premium.css; и для серверных страниц) ═══
  function css(){
    if (document.getElementById('d37AdsCss')) return;
    const s = document.createElement('style');
    s.id = 'd37AdsCss';
    s.textContent = `
.d37-ad-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:90px;padding:10px;box-sizing:border-box;border:2px dashed rgba(255,209,102,.65);border-radius:12px;background:rgba(255,209,102,.07);color:#ffd166;font:700 12px/1.35 Montserrat,system-ui,sans-serif;text-align:center}
.d37-ad-ph span{font-weight:600;opacity:.9}.d37-ad-ph small{font-weight:600;opacity:.6;font-size:10.5px}
.d37-ad-ph[data-k="rail"]{min-height:600px}.d37-ad-ph[data-k="feed"]{min-height:190px}.d37-ad-ph[data-k="loading"]{min-height:100px}
html.d37-ads-debug .d37-ad{outline:2px dashed #22d3ee;outline-offset:3px}
.d37-ad:has(ins[data-ad-status="unfilled"]){display:none!important}
.d37-adload{display:flex;flex-direction:column;align-items:center;gap:6px;width:min(100%,728px);margin:10px auto 0;font-weight:600;flex:none}
.d37-adload>*{flex:none}
.s3-loading:has(>.d37-adload){align-content:center;row-gap:4px}
.d37-adload .d37-ad,.d37-adcard .d37-ad{margin:0 auto;width:100%;max-width:none;min-height:90px}
.d37-adload-ad{width:100%}
.d37-adload-tip{font-size:12.5px;line-height:1.45;opacity:.85;max-width:560px;text-align:center}
.d37-adcard{position:absolute;right:12px;bottom:12px;z-index:6;width:min(340px,calc(100% - 24px));padding:10px 12px 12px;border-radius:12px;background:rgba(12,10,24,.94);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 12.5px/1.4 Montserrat,system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.45)}
.d37-adcard-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.d37-adcard-h b{white-space:nowrap}
.d37-adcard-st{flex:1;min-width:0;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d37-adcard-x{flex:none;width:24px;height:24px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:11px}
.d37-adcard .d37-adload-tip{text-align:left;margin-bottom:8px}
.d37-break{margin:1.6rem auto 0;max-width:780px;padding:.8rem 1rem 1rem;border-radius:16px;background:rgba(255,255,255,.03);border:1px dashed var(--border,rgba(255,255,255,.14));text-align:center}
.d37-break-t{font-size:.8rem;color:var(--muted,#8d8daa);margin-bottom:.5rem}
.d37-break-t b{color:var(--text,#f0f0f8)}
.d37-break .d37-ad{margin:0 auto}
.d37-feed{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:250px;padding:.55rem .6rem .7rem;border-radius:18px;border:1px dashed var(--border,var(--line,rgba(255,255,255,.14)));background:rgba(255,255,255,.025);overflow:hidden;text-align:center}
.d37-feed[hidden]{display:none!important}
.d37-feed.d37-ad{margin:0;max-width:none}
.d37-feed.row{grid-column:1/-1;min-height:110px}
.list-view .d37-feed{min-height:120px}
.d37-feed .d37-ad-label{text-align:left;margin:0 0 .35rem .15rem}
.d37-feed .d37-ad-ph{flex:1}
.d37-house{display:flex;border-style:solid;padding:0}
.d37-house a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.35rem;padding:1.1rem;color:inherit;text-decoration:none}
.d37-house-ic{font-size:2rem;line-height:1}.d37-house small{color:var(--muted,#8d8daa);font-size:.76rem}
.d37-house-go{font-size:.74rem;font-weight:800;color:var(--accent,#ff2d55)}
.d37-rail{position:absolute;z-index:3}
.d37-rail-in{position:absolute;top:0;left:0;width:100%}
.d37-rail .d37-ad{margin:0;max-width:none;min-height:600px}
.d37-coinad{display:inline-flex;align-items:center;gap:.3rem;padding:.45rem .8rem;border-radius:10px;border:1px solid rgba(255,209,102,.45);background:rgba(255,209,102,.1);color:#ffd166;font:800 .74rem Montserrat,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.d37-coinad:disabled{opacity:.6;cursor:default}
.gm-me .d37-coinad{flex:none;padding:.55rem .85rem}
@media(max-width:480px){.gm-me .d37-coinad{flex:1;justify-content:center}}
.d37-spadm{background:rgba(255,209,102,.05);border:1px solid rgba(255,209,102,.18);border-radius:14px;padding:1.2rem;margin-top:1.2rem;display:flex;flex-direction:column;gap:.5rem}
.d37-spadm-h{font-size:.72rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffd166}
.d37-spadm p{font-size:.72rem;color:var(--muted);margin:0}
.d37-spadm input:not([type=checkbox]):not([type=color]){width:100%;background:rgba(255,255,255,.05);border:1.5px solid var(--border);border-radius:10px;padding:.55rem .8rem;color:var(--text);font:600 .78rem Montserrat,sans-serif;outline:none}
.d37-spadm-row{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.72rem;color:var(--muted);align-items:center}
.d37-spadm-on{font-size:.78rem;font-weight:700;display:flex;gap:.4rem;align-items:center}
.d37-spadm-save{padding:.6rem;border-radius:10px;border:0;background:linear-gradient(135deg,#f59e0b,#ffd166);color:#1a1205;font:800 .8rem Montserrat,sans-serif;cursor:pointer}
.d37-spadm-st{font-size:.72rem;min-height:1rem;text-align:center}
.wld-ad-mark{font-size:.7rem!important;opacity:.7}`;
    document.head.appendChild(s);
  }

  // ═══ Запуск ═══
  function init(){
    css();
    if (dbg.on) document.documentElement.classList.add('d37-ads-debug');
    gate();   // VIP — пауза; остальным — снять паузу из <head>, без персональной рекламы — по возрасту
    window.addEventListener('d37:auth', () => setTimeout(syncPerk, 50));
    window.addEventListener('d37:age', () => setTimeout(() => { gate(); railTick(); }, 0));   // указал / сменил возраст
    document.addEventListener('pointerdown', onGameInput, true);
    document.addEventListener('keydown', onGameInput, true);
    document.addEventListener('click', e => { const b = e.target?.closest?.('[data-d37-reward="coins"]'); if (!b) return; e.preventDefault(); e.stopPropagation(); onCoinAd(b); }, true);
    window.addEventListener('hashchange', () => {
      G.playing = false;
      const b = document.getElementById('gamesAd');   // ушли из игры — рекламу под ней убираем совсем (а не прячем)
      if (b) { b.innerHTML = ''; b.className = ''; delete b.dataset.net; delete b.dataset.at; }
      setTimeout(railTick, 450);   // роутер меняет разделы через 150 мс
    });
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(railTick, 250); });
    window.addEventListener('scroll', onScroll, { passive: true });
    setInterval(railTick, 2000);
    // «⚙️ Настройки сайта» (settings-panel.js грузится позже) — редактор спонсора при открытии
    const hook = () => {
      if (typeof window.openSettingsAdmin !== 'function' || window.openSettingsAdmin.__d37) return;
      const orig = window.openSettingsAdmin;
      window.openSettingsAdmin = function(){ const r = orig.apply(this, arguments); try { sponsorAdmin(); } catch (e) {} return r; };
      window.openSettingsAdmin.__d37 = true;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
  }

  window.D37AdPlaces = {
    RULES, why, mark, show, ids, hasId, net, loading, afterRound, interRound, feed, coinOffer, worldPromo, sponsor, fillAll, noAdsPerk,
    placeholder, gambling, railTick, direct, hasNet,
    adAge, ageOff, gate, googleTag: () => ageRule().tfat || 0,   // возраст: группа рекламы, место выключено, «обработка» Google
    ctx(name, on){ if (on) ctxOn.add(name); else ctxOn.delete(name); if (on && name !== 'playing') { railOff(); } },
    debug: () => dbg.on, frames: () => dbg.frames,
    state: () => ({ visit: JSON.parse(JSON.stringify(st())), vip: noAdsPerk(), age: adAge(), ugc: ugcRoute(), playing: G.playing, ctx: [...ctxOn], rail: RAIL.el ? RAIL.w : 0, log: dbg.log.slice(-30) }),
    _test: { st: () => st(), reset(){ ST = null; try { sessionStorage.removeItem(SK); } catch (e) {} loadT0 = 0; railOff(); G.playing = false; ctxOn.clear(); }, dbg, G, railSpot, gameRect, cleanSponsor, safeUrl, refreshOk, GAMBLING_RE, TIPS, RAIL, ugcRoute, cdLeft },
  };
  init();
})();
