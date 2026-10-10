// ═══════════════════════════════════════
//  МОНЕТЫ 🪙 — игровая валюта сайта (coins.sql)
// ═══════════════════════════════════════
// Вошёл и coins.sql выполнен — кошелёк в базе (одинаковый на всех устройствах). Без входа (или пока SQL
// не выполнен) — копятся в этом браузере; при входе переносятся в аккаунт (до 1000, один раз).
// Купленное в браузере остаётся доступным и после входа (владение = база ∪ браузер).
// Лимиты и цены — как в coins.sql (coin_price, coin_run_cap, coins_*): поменял там — поменяй тут.
//
// API (window.D37Coins):
//   coins() — баланс, owns(item), price(item), perks() — VIP/персонал (×2 за забеги и бонус дня)
//   daily() — забрать бонус дня; canDaily()
//   run(game, amount, ref) — монеты из забега → { got }; double(ref) — ×2 за забег (после рекламы)
//   adCoins() — +40 за рекламу; canAd(); buy(item); revive(game); saveLook(look) — персонаж (js/core/avatar.js)
//   on(fn) — подписка на изменения; элементы .js-coins обновляются сами
(() => {
  const RULES = { daily: 30, ad: 40, adPerDay: 8, adGap: 45, doublePerDay: 5, runDay: 1500, runGap: 20, revive: 30 };
  const RUN_CAP = { horde: 300, td: 300, blocks: 150, kosynka: 40, pauk: 100, freecell: 30, miner: 60, mahjong: 40, sudoku: 60 };
  const HERO_PRICES = { ninja: 400, knight: 400, vampire: 800, robot: 1200, streamer: 2500 };
  const UP_PRICES = [100, 200, 400, 700, 1000], ARMOR_PRICES = [150, 400, 800];
  const LS = 'd37_coins';

  function price(item){
    if (item === 'revive') return RULES.revive;
    if (/^skin:/.test(item || '')) return window.D37Char?.price(item) ?? null;   // части персонажа — цены в avatar.js
    let m = /^hero:(\w+)$/.exec(item);
    if (m) return HERO_PRICES[m[1]] ?? null;
    m = /^up:(might|hp|speed|magnet|greed):([1-5])$/.exec(item);
    if (m) return UP_PRICES[m[2] - 1];
    m = /^up:armor:([1-3])$/.exec(item);
    if (m) return ARMOR_PRICES[m[1] - 1];
    return null;
  }

  // День по Москве — как coin_today() на сервере
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

  // ── Кошелёк в браузере ──
  function readLocal(){
    let L = {};
    try { L = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) {}
    L = { coins: 0, items: [], day: '', daily: false, ads: 0, adAt: 0, doubles: 0, run: 0, runAt: 0, runs: {}, imported: '', ...L };
    if (L.day !== today()) Object.assign(L, { day: today(), daily: false, ads: 0, doubles: 0, run: 0, runs: {} });
    return L;
  }
  function writeLocal(L){ try { localStorage.setItem(LS, JSON.stringify(L)); } catch (e) {} }

  let server = false;          // кошелёк в базе
  let serverMissing = false;   // coins.sql не выполнен — не спрашиваем снова до перезагрузки
  let S = { coins: 0, items: [], daily: false, ads: 0, doubles: 0, perks: false };
  const listeners = new Set();

  function clientPerks(){
    try { return typeof currentProfile !== 'undefined' && !!currentProfile && typeof hasPerks === 'function' && hasPerks(currentProfile.role, currentProfile); } catch (e) { return false; }
  }
  function fromLocal(){
    const L = readLocal();
    S = { coins: L.coins, items: L.items, daily: L.daily, ads: L.ads, doubles: L.doubles, perks: clientPerks() };
  }
  function emit(){
    document.querySelectorAll('.js-coins').forEach(el => { el.textContent = Number(S.coins).toLocaleString('ru'); });
    listeners.forEach(fn => { try { fn(S); } catch (e) {} });
  }
  function toast(text){ if (typeof xpToast === 'function') xpToast(text); }

  async function rpc(name, args){
    if (typeof sbClient === 'undefined' || !sbClient) return null;
    try {
      const { data, error } = await sbClient.rpc(name, args || {});
      if (error) {
        if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) serverMissing = true;
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  // Узнать, где кошелёк, и обновить баланс
  async function sync(){
    const authed = typeof currentUser !== 'undefined' && !!currentUser;
    if (!authed || serverMissing) { server = false; fromLocal(); emit(); return S; }
    const d = await rpc('coins_state');
    if (!d?.ok) { server = false; fromLocal(); emit(); return S; }
    server = true;
    S = { coins: d.coins, items: d.items || [], daily: d.daily, ads: d.ads, doubles: d.doubles, perks: !!d.perks };
    window.D37Char?.fromServer(d.look);
    // Монеты, накопленные без входа, — в аккаунт (один раз на аккаунт, до 1000)
    const L = readLocal();
    if (L.coins > 0 && !d.imported) {
      const r = await rpc('coins_import', { p_amount: L.coins });
      if (r?.ok && r.got > 0) { S.coins = r.coins; L.coins = 0; L.imported = currentUser.id; writeLocal(L); toast(`🪙 ${r.got} монет перенесены в аккаунт`); }
    }
    emit();
    return S;
  }

  const items = () => [...new Set([...(S.items || []), ...readLocal().items])];
  const owns = item => items().includes(item);

  function canDaily(){ return !S.daily; }
  async function daily(){
    if (S.daily) return { ok: false, reason: 'done' };
    if (server) {
      const r = await rpc('coins_daily');
      if (r?.ok) { S.coins = r.coins; S.daily = true; emit(); }
      else if (r?.reason === 'done') { S.daily = true; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    if (L.daily) return { ok: false, reason: 'done' };
    const got = RULES.daily * (clientPerks() ? 2 : 1);
    L.coins += got; L.daily = true; writeLocal(L); fromLocal(); emit();
    return { ok: true, got, coins: L.coins };
  }

  async function run(game, amount, ref){
    const cap = RUN_CAP[game];
    let amt = Math.max(0, Math.min(Math.floor(amount) || 0, cap || 0));
    if (!amt) return { ok: true, got: 0 };
    if (server) {
      const r = await rpc('coins_run', { p_game: game, p_amount: amt, p_ref: ref });
      if (r?.ok) { S.coins = r.coins; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    if (L.runs[ref]) return { ok: false, reason: 'dup' };
    if (Date.now() - L.runAt < RULES.runGap * 1000) return { ok: false, reason: 'too_fast' };
    amt = Math.min(amt, Math.max(0, RULES.runDay - L.run));
    if (!amt) return { ok: false, reason: 'day_cap' };
    const got = amt * (clientPerks() ? 2 : 1);
    L.coins += got; L.run += amt; L.runAt = Date.now(); L.runs[ref] = amt;
    writeLocal(L); fromLocal(); emit();
    return { ok: true, got, base: amt, coins: L.coins };
  }

  function canAd(){ return S.ads < RULES.adPerDay; }
  async function adCoins(){
    if (server) {
      const r = await rpc('coins_ad', { p_kind: 'coins', p_ref: '' });
      if (r?.ok) { S.coins = r.coins; S.ads++; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    if (L.ads >= RULES.adPerDay) return { ok: false, reason: 'day_cap' };
    if (Date.now() - L.adAt < RULES.adGap * 1000) return { ok: false, reason: 'too_fast' };
    L.coins += RULES.ad; L.ads++; L.adAt = Date.now(); writeLocal(L); fromLocal(); emit();
    return { ok: true, got: RULES.ad, coins: L.coins };
  }
  function canDouble(){ return S.doubles < RULES.doublePerDay; }
  async function double(ref){
    if (server) {
      const r = await rpc('coins_ad', { p_kind: 'double', p_ref: ref });
      if (r?.ok) { S.coins = r.coins; S.doubles++; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    const base = L.runs[ref];
    if (!base || L.runs[ref + ':x2']) return { ok: false, reason: 'run' };
    if (L.doubles >= RULES.doublePerDay) return { ok: false, reason: 'day_cap' };
    L.coins += base; L.doubles++; L.runs[ref + ':x2'] = 1; writeLocal(L); fromLocal(); emit();
    return { ok: true, got: base, coins: L.coins };
  }

  async function buy(item){
    const p = price(item);
    if (p == null || item === 'revive') return { ok: false, reason: 'item' };
    if (owns(item)) return { ok: false, reason: 'owned' };
    if (server) {
      const r = await rpc('coins_buy', { p_item: item });
      if (r && 'coins' in r) { S.coins = r.coins; if (r.items) S.items = r.items; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    const up = /^up:(\w+):(\d)$/.exec(item);
    if (up && +up[2] > 1 && !L.items.includes(`up:${up[1]}:${up[2] - 1}`)) return { ok: false, reason: 'order' };
    if (L.coins < p) return { ok: false, reason: 'coins' };
    L.coins -= p; L.items.push(item); writeLocal(L); fromLocal(); emit();
    return { ok: true, coins: L.coins, items: L.items };
  }

  async function revive(game){
    if (server) {
      const r = await rpc('coins_revive', { p_game: game });
      if (r && 'coins' in r) { S.coins = r.coins; emit(); }
      return r || { ok: false };
    }
    const L = readLocal();
    if (L.coins < RULES.revive) return { ok: false, reason: 'coins' };
    L.coins -= RULES.revive; writeLocal(L); fromLocal(); emit();
    return { ok: true, coins: L.coins };
  }

  // Надетый персонаж — в базу (сервер сам проверит, что всё своё); без входа avatar.js хранит его в браузере
  async function saveLook(look){
    if (!server) return { ok: true, local: true };
    let r = await rpc('char_save', { p_look: look });
    // старый char_save (до нового coins.sql) не знает частей 3D-человечка и своих цветов — сохраним то, что он понимает
    const C = window.D37Char;
    if (r && r.ok === false && r.reason === 'item' && C?.nearest) {
      const L = {};
      for (const s of C.SLOTS2D) if (look[s] != null) L[s] = C.nearest(s, look[s]);
      r = await rpc('char_save', { p_look: L });
      if (r?.ok) r.partial = true;
    }
    return r || { ok: false };
  }

  // Улучшение: сколько уровней куплено (up:might:1..5)
  function upLevel(stat){ let n = 0; while (owns(`up:${stat}:${n + 1}`)) n++; return n; }

  fromLocal();
  window.addEventListener('d37:auth', () => { sync(); });
  window.D37Coins = {
    RULES, price, sync, owns, items, upLevel,
    coins: () => S.coins, perks: () => S.perks || clientPerks(), isServer: () => server,
    canDaily, daily, run, canAd, adCoins, canDouble, double, buy, revive, saveLook,
    on(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
