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
        body: JSON.stringify({ pack, method, consent: true }) });
      const j = await r.json().catch(() => null);
      return j || { ok: false, reason: 'server' };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  function loadScript(src){
    return new Promise((ok, fail) => {
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
