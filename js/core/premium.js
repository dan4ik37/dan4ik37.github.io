// ═══════════════════════════════════════
//  💎 КРИСТАЛЛЫ — донатная валюта сайта (premium.sql; магазин #/shop — js/features/shop.js; оплата — api/pay.js)
// ═══════════════════════════════════════
// Название, пакеты и товары — CFG ниже (одно место для сайта). Те же цифры — premium.sql (premium_packs,
// premium_items) и api/_lib/premium.js (серверные страницы /shop, /terms): поменял тут — поменяй там (тест сверяет).
// Кристаллы — отдельно от монет 🪙 (coins.js): только за деньги — картой (api/pay.js) или донатом DonationAlerts,
// тратятся только на сервере. Пока premium.sql не выполнен — магазин показывает витрину и «скоро», донат даёт VIP как раньше.
//
// API (window.D37Gems):
//   CFG — название, пакеты, товары; word(n) — «кристалл / кристалла / кристаллов»; num(n) — «1 200»
//   sync() → состояние: баланс, режим доната, лимиты, история; state(); balance(); ready() — premium.sql выполнен
//   methods() → способы оплаты с сервера (/api/pay?a=config); [] — пока не подключены
//   order(pack, method) → заказ на сервере; pay(res) — открыть оплату; watch(orderId) — дождаться зачисления
//   spend(item, target) — потратить; setMode('vip' | 'gems') — что даёт донат
//   on(fn) — подписка; элементы .js-gems обновляются сами, #navGems виден вошедшим
(() => {
  const CFG = {
    icon: '💎', name: 'Кристаллы', forms: ['кристалл', 'кристалла', 'кристаллов'],
    donateUrl: 'https://www.donationalerts.com/r/dan4ik37',
    // gems — сколько даёт (бонус уже внутри), rub / kzt — цена
    packs: [
      { id: 'p100', gems: 100, bonus: 0, rub: 100, kzt: 590 },
      { id: 'p300', gems: 300, bonus: 0, rub: 300, kzt: 1770 },
      { id: 'p550', gems: 550, bonus: 50, rub: 500, kzt: 2950 },
      { id: 'p1200', gems: 1200, bonus: 200, rub: 1000, kzt: 5900 },
      { id: 'p2600', gems: 2600, bonus: 600, rub: 2000, kzt: 11800 },
    ],
    items: [
      { id: 'vip:1', kind: 'vip', months: 1, price: 100, title: 'VIP на 1 месяц' },
      { id: 'vip:3', kind: 'vip', months: 3, price: 270, title: 'VIP на 3 месяца' },
      { id: 'vip:12', kind: 'vip', months: 12, price: 960, title: 'VIP на 12 месяцев' },
      { id: 'gift:1', kind: 'gift', months: 1, price: 100, title: 'VIP на месяц в подарок' },
      { id: 'coins:100', kind: 'coins', coins: 100, price: 10, title: '100 монет' },
      { id: 'coins:550', kind: 'coins', coins: 550, price: 50, title: '550 монет' },
      { id: 'coins:1200', kind: 'coins', coins: 1200, price: 100, title: '1200 монет' },
      { id: 'skin:hat:gemcrown', kind: 'skin', price: 150, title: 'Кристальная корона' },
      { id: 'skin:back:gemwings', kind: 'skin', price: 300, title: 'Кристальные крылья' },
      { id: 'skin:trail:gems', kind: 'skin', price: 100, title: 'След из кристаллов' },
    ],
  };
  const word = n => { const a = Math.abs(n) % 100, b = a % 10; return CFG.forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b > 1 && b < 5 ? 1 : 2]; };
  const num = n => Number(n || 0).toLocaleString('ru');

  // ready: null — ещё не спрашивали, true — premium.sql на сервере есть, false — нет (не спрашиваем до перезагрузки)
  let S = { ok: false, ready: null, balance: 0, debt: 0, mode: 'vip', packs: CFG.packs, items: CFG.items, history: [], orders: [] };
  const listeners = new Set();
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
  const client = () => (typeof sbClient !== 'undefined' && sbClient) || null;

  function emit(){
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    // Пока premium.sql не выполнен — без числа (значок в шапке всё равно ведёт в магазин)
    document.querySelectorAll('.js-gems').forEach(el => { el.textContent = S.ok ? num(S.balance) : ''; });
    const chip = document.getElementById && document.getElementById('navGems');
    if (chip) chip.hidden = !authed();
    listeners.forEach(fn => { try { fn(S); } catch (e) {} });
  }

  // Вызов функции базы: { data } или { error } (PGRST202 — premium.sql не выполнен)
  async function rpc(name, args){
    const sb = client();
    if (!sb || S.ready === false) return { error: { code: 'off' } };
    try {
      const { data, error } = await sb.rpc(name, args || {});
      if (error) {
        if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { S.ready = false; S.ok = false; }
        return { error };
      }
      return { data };
    } catch (e) { return { error: e }; }
  }

  let syncing = null;
  function sync(){
    if (syncing) return syncing;
    syncing = (async () => {
      const { data } = await rpc('premium_state');
      if (data) S = { ...S, ...data, ready: true, ok: !!data.ok && authed() };
      else S = { ...S, ok: false, balance: 0 };
      if (!authed()) S = { ...S, ok: false, balance: 0, history: [], orders: [] };
      emit();
      return S;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // Способы оплаты картой — решает сервер (ключи провайдеров в Vercel). Локально /api нет → []
  let methodsP = null;
  function methods(force){
    if (!methodsP || force) methodsP = fetch('/api/pay?a=config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => (j && Array.isArray(j.methods)) ? j : { methods: [] })
      .catch(() => ({ methods: [] }));
    return methodsP;
  }

  async function token(){
    try { const { data } = await client().auth.getSession(); return data?.session?.access_token || ''; } catch (e) { return ''; }
  }
  // Заказ создаёт сервер: проверяет вход, лимиты и согласие взрослого, отдаёт, как платить
  async function order(pack, method){
    if (!authed()) return { ok: false, reason: 'auth' };
    const t = await token();
    if (!t) return { ok: false, reason: 'auth' };
    try {
      const r = await fetch('/api/pay?a=order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ pack, method, consent: true, pd: true }) });   // pd — согласие на обработку данных (галочка в окне оплаты)
      const j = await r.json().catch(() => null);
      return j || { ok: false, reason: 'server' };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  function loadScript(src){
    return new Promise((ok, fail) => {
      if (!/^https:\/\/[^\s"'<>]+$/.test(String(src || ''))) return fail(new Error('script'));   // адрес виджета отдаёт наш сервер; чужую схему и кавычки не берём (T-011)
      if (document.querySelector(`script[src="${src}"]`) && window.tiptop) return ok();
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => ok(); s.onerror = () => fail(new Error('script')); document.head.appendChild(s);
    });
  }
  // Открыть оплату: виджет TipTop Pay — тут же; Freedom Pay — переход на страницу оплаты; Kaspi — инструкция (решает магазин)
  async function pay(res){
    const p = res?.pay || {};
    if (p.type === 'redirect' && /^https:\/\//.test(p.url || '')) { location.href = p.url; return { status: 'redirect' }; }
    if (p.type === 'widget') {
      try { await loadScript(p.script); } catch (e) { return { status: 'error', reason: 'script' }; }
      try {
        const w = new window.tiptop.Widget();
        const r = await w.start(p.params);
        return { status: r?.status === 'success' ? 'success' : r?.type === 'cancel' || r?.status === 'cancel' ? 'cancel' : 'fail', raw: r };
      } catch (e) { return { status: 'error', reason: 'widget' }; }
    }
    return { status: p.type || 'none' };
  }

  // Ждём, пока сервер получит уведомление провайдера (обычно секунды)
  async function watch(orderId, ms = 120000){
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const { data } = await rpc('premium_order_status', { p_order: orderId });
      if (data?.ok && data.status === 'paid') { await sync(); return data; }
      if (data?.ok && (data.status === 'failed' || data.status === 'refunded')) return data;
      await new Promise(r => setTimeout(r, 2500));
    }
    return { ok: false, status: 'timeout' };
  }

  async function spend(item, target){
    const { data, error } = await rpc('premium_spend', { p_item: item, p_target: target || null });
    if (error || !data) return { ok: false, reason: error?.code === 'off' || S.ready === false ? 'off' : 'server' };
    if ('balance' in data) { S.balance = data.balance; emit(); }
    if (data.ok) sync();
    return data;
  }
  async function setMode(mode){
    const { data, error } = await rpc('premium_set_mode', { p_mode: mode });
    if (error || !data) return { ok: false, reason: S.ready === false ? 'off' : 'server' };
    if (data.ok) await sync();
    return data;
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('d37:auth', () => { sync(); });
  }
  window.D37Gems = {
    CFG, word, num, sync, methods, order, pay, watch, spend, setMode,
    state: () => S, balance: () => S.balance || 0, ready: () => S.ready, isOn: () => !!S.ok,
    item: id => (S.items || CFG.items).find(x => x.id === id) || null,
    on(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

// ═══════════════════════════════════════
//  💛 ДОНАТЕР — статус за поддержку стрима (premium.sql, разделы 6 и 8; 22.10.2026)
// ═══════════════════════════════════════
// Донат DonationAlerts (пока выключатель site_config 'donate_rewards' = off) даёт не VIP и не 💎, а временный статус: уровень =
// сумма привязанных донатов за последние RULES.days дней (скользящее окно), бонусы — как у VIP того же ранга (perk). Считает сервер.
// API (window.D37Donor):
//   LEVELS, RULES, RESERVED — числа и занятые имена (= premium.sql donor_levels / donor_rule / donor_name_reserved =
//     api/_lib/premium.js; scripts/pay-test.cjs сверяет). ПРЕДЛОЖЕНИЕ — решает владелец
//   reserved(name) — «Аноним», «гость», «без имени»… (нельзя ни ником, ни логином для доната)
//   levelFor(sum), perkOf(lv) → 'bronze' | 'silver' | 'gold', label(lv) → «💛 Донатер II», rgb(lv), untilText(iso) → «до 21.11»
//   me() — свой статус (donor_me), sync() — обновить; levelOf(uid), untilOf(uid) — из кэша (свой — из me)
//   badges(uids) → загрузить значки пачкой (кэш 5 мин); queue() — заполнить .dn-badge[data-dn-uid] на странице
//   событие 'd37:donor' — свой статус обновился
(() => {
  const LEVELS = [
    { lv: 1, min: 100, perk: 'bronze' },
    { lv: 2, min: 300, perk: 'silver' },
    { lv: 3, min: 700, perk: 'gold' },
    { lv: 4, min: 1500, perk: 'gold' },
  ];
  const RULES = { days: 30, auto_max: 300, claims_day: 5 };
  const RESERVED = {
    exact: ['аноним', 'анонимно', 'анонимный', 'анонимная', 'анонимус', 'анон', 'anonymous', 'anonym', 'anonim', 'anonimus', 'anon',
      'гость', 'гостья', 'guest', 'без имени', 'безымянный', 'безымянная', 'noname', 'no name', 'nameless', 'unknown',
      'неизвестный', 'неизвестная', 'неизвестно', 'нет имени', 'ваше имя', 'your name', 'имя', 'name', 'никто', 'nobody',
      'user', 'пользователь', 'donationalerts', 'донатер', 'донатёр', 'donater', 'donator', 'donor'],
    prefix: ['аноним', 'anonym', 'anonim'],
  };
  const RGB = ['', '255,205,70', '255,176,46', '255,140,40', '255,96,140'];
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const UP = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', LO = 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе', LAT = 'aeopcxykmhbt0', CYR = 'аеорсхукмнвто';
  // Ключ имени — как donor_name_key в premium.sql: регистр, ё → е, латинские «двойники» → кириллица, только буквы и цифры
  function nameKey(t){
    let out = '';
    for (let ch of String(t == null ? '' : t)) {
      let i = UP.indexOf(ch); if (i >= 0) ch = LO[i];
      if (ch >= 'A' && ch <= 'Z') ch = ch.toLowerCase();
      i = LAT.indexOf(ch); if (i >= 0) ch = CYR[i];
      if (/^[a-zа-я0-9]$/.test(ch)) out += ch;
    }
    return out;
  }
  const EXACT = new Set(RESERVED.exact.map(nameKey)), PREF = RESERVED.prefix.map(nameKey);
  const reserved = t => { const k = nameKey(t); return k === '' || EXACT.has(k) || PREF.some(p => k.startsWith(p)); };
  const levelFor = sum => LEVELS.reduce((a, l) => (Number(sum) || 0) >= l.min ? l.lv : a, 0);
  const perkOf = lv => (LEVELS.find(l => l.lv === lv) || {}).perk || null;
  const roman = lv => ROMAN[Math.max(1, Math.min(8, lv | 0))];
  const label = lv => '💛 Донатер ' + roman(lv);
  const rgb = lv => RGB[Math.max(1, Math.min(RGB.length - 1, lv | 0))];
  const untilText = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : 'до ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }); };

  const client = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const myId = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null;
  let ready = null;                     // null — не спрашивали; false — premium.sql (22.10) ещё не применён
  let ME = { ok: false, level: 0 };
  const cache = new Map();              // uid → { lv, until, at }
  const TTL = 5 * 60 * 1000;
  const fresh = c => c && Date.now() - c.at < TTL;

  async function rpc(name, args){
    const sb = client();
    if (!sb || ready === false) return { error: { code: 'off' } };
    try {
      const { data, error } = await sb.rpc(name, args || {});
      if (error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || ''))) ready = false;
      return error ? { error } : { data };
    } catch (e) { return { error: e }; }
  }
  let syncing = null;
  function sync(){
    if (syncing) return syncing;
    syncing = (async () => {
      const { data } = await rpc('donor_me');
      if (data) { ready = true; ME = data.ok && myId() ? data : { ok: false, level: 0, mode: data.mode }; }
      else ME = { ok: false, level: 0 };
      const id = myId();
      if (id) cache.set(id, { lv: ME.level || 0, until: ME.until || null, any: ME.until_any || null, at: Date.now() });
      try { window.dispatchEvent(new CustomEvent('d37:donor', { detail: ME })); } catch (e) {}
      return ME;
    })().finally(() => { syncing = null; });
    return syncing;
  }
  // Значки пачкой; чужие скрывшие донаты (privacy.sql) не приходят — у них «нет статуса»
  async function badges(uids){
    const need = [...new Set((uids || []).filter(u => u && /^[0-9a-f-]{36}$/i.test(u) && !fresh(cache.get(u))))];
    for (let i = 0; i < need.length; i += 200) {
      const part = need.slice(i, i + 200);
      const { data, error } = await rpc('donor_badges', { p_uids: part });
      if (error) { part.forEach(u => cache.set(u, { lv: 0, at: Date.now() })); continue; }
      const got = new Map((data || []).map(x => [x.id, x]));
      part.forEach(u => { const x = got.get(u); cache.set(u, { lv: x ? x.lv : 0, until: x ? x.until : null, at: Date.now() }); });
    }
    return cache;
  }
  const levelOf = uid => { if (!uid) return 0; if (uid === myId() && ME.ok) return ME.level || 0; const c = cache.get(uid); return c ? c.lv || 0 : 0; };
  const untilOf = uid => { if (uid === myId() && ME.ok) return ME.until || null; const c = cache.get(uid); return c ? c.until || null : null; };
  const untilAnyOf = uid => { if (uid === myId() && ME.ok) return ME.until_any || ME.until || null; const c = cache.get(uid); return c ? c.any || c.until || null : null; };
  const RANK = { bronze: 1, silver: 2, gold: 3 };

  // ── Значки на странице: <span class="dn-badge" data-dn-uid="…"> рядом с ником (чат, участники, карточки) ──
  let qt = 0;
  function queue(){ clearTimeout(qt); qt = setTimeout(fill, 300); }
  async function fill(){
    if (typeof document === 'undefined' || ready === false) return;
    const els = [...document.querySelectorAll('.dn-badge[data-dn-uid]:not([data-dn])')];
    if (!els.length) return;
    await badges(els.map(e => e.dataset.dnUid));
    els.forEach(el => {
      const uid = el.dataset.dnUid, lv = levelOf(uid);
      el.dataset.dn = lv;
      if (!lv) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = '💛 ' + roman(lv);
      el.title = 'Донатер ' + roman(lv) + (untilOf(uid) ? ' — ' + untilText(untilOf(uid)) : '') + ' · статус за поддержку стрима';
      el.style.setProperty('--dn', rgb(lv));
      // VIP-значок рядом — только если VIP «выше» (бонусы — по лучшей ветке, подпись — тоже)
      const vip = el.parentElement && el.parentElement.querySelector('[data-vrank]');
      if (vip && RANK[perkOf(lv)] >= +vip.dataset.vrank) vip.hidden = true;
      const nick = el.parentElement && el.parentElement.querySelector('.mv-nick');
      if (nick && !nick.getAttribute('style')) nick.style.color = 'rgb(' + rgb(lv) + ')';
    });
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('d37:auth', () => { cache.clear(); sync(); queue(); });
  }
  window.D37Donor = {
    LEVELS, RULES, RESERVED, nameKey, reserved, levelFor, perkOf, label, roman, rgb, untilText,
    sync, me: () => ME, ready: () => ready, badges, levelOf, untilOf, untilAnyOf, queue, fill,
    rank: lv => RANK[perkOf(lv)] || 0,
  };
})();
