// «Набеги» в настоящем Chrome (headless, DevTools Protocol, без npm): учебный набег гостем; с подменённым сервером
// (stubServer ниже — base_* / raid_* и /api/raid на том же коде боя) — штаб, «Позвать друга» (ссылка с кодом приглашения),
// казарма, набег (разведка → высадка мышью и «кистью» → итог сервера = итог браузера), «Поделиться повтором», журнал защиты,
// повтор, «Месть», поход, лиги, улучшения, дружеский бой по ссылке; ПК 1280×800 и телефон 412×915 (касания).
// Запуск: python scripts/serve.py 5559 (в другом окне), потом node scripts/raid-e2e.cjs http://localhost:5559 [pc|phone]
// Снимки — в папку SHOTS (по умолчанию %TEMP%/d37-raid-shots). Chrome — переменная CHROME или стандартный путь Windows.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.argv[2] || 'http://localhost:5559').replace(/\/+$/, '');
const ONLY = process.argv[3] || '';
const OUT = process.env.SHOTS || path.join(os.tmpdir(), 'd37-raid-shots');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); if (!c) fails++; };

// Подменённый сервер (выполняется в странице): участок с армией, соперники-боты, итог тем же RaidSim
function stubServer(){
  const uid = 'aaaaaaaa-0000-4000-8000-000000000001';
  const now = () => Math.floor(Date.now() / 1000);
  const MB = () => window.MirBase, RS = () => window.RaidSim;
  const W = { coins: 500, gems: 300 };
  const P = { trophies: 312, shield: 0, newbie: 0, camp: { 1: 3, 2: 1 }, tut: false, skins: [], skin: '', army_skin: '', n_battle: 2, n_search: 3, n_bot: 0, loot_day: 400, week: { stars: 4, wins: 2 }, log: [], attacks: [], shield_buy: 0 };
  const raids = {};
  let base = null;
  function mkBase(){
    const S = MB().SERVER, L = RS().bot(103, S, 1).map(it => (it.k === 'mine' ? { ...it, t0: now() - 3 * 3600 } : it));
    if (!L.some(it => it.k === 'barracks')) L.push({ i: 950, k: 'barracks', x: 10, z: 10, r: 0, l: 3 });
    const b = { plot: 7, bricks: 2400, seq: 999, access: 'all', likes: 3, gift: '', own: {}, layout: L, room: [], rev: 1, army: { fighter: 20, archer: 14, tank: 2, breaker: 4 }, out: {}, queue: [], q2: false };
    return b;
  }
  const view = () => { MB().Rules.norm(base, now()); return { ok: true, now: now(), ...JSON.parse(JSON.stringify(base)), gift: true, coins: W.coins, trophies: P.trophies, skin: P.skin, shield: P.shield }; };
  const H = {
    base_state: () => (base ? view() : { ok: false, reason: 'none', now: now() }),
    base_street: ({ p_street }) => ({ ok: true, now: now(), street: p_street, max: 7, plots: base ? [{ p: 7, uid, nick: 'Я', layout: base.layout, access: 'all', rev: 1, likes: 3, tr: P.trophies, skin: P.skin, sh: P.shield }, { p: 8, uid: 'bbbb', nick: 'Боря', layout: RS().bot(102, MB().SERVER, 2), access: 'all', rev: 1, likes: 0, tr: 280, skin: 'winter', sh: 0 }] : [] }),
    base_claim: () => { base = mkBase(); return view(); },
    base_act: ({ p_act, p_a }) => { const w = { coins: W.coins }; const r = MB().Rules.act(base, p_act, p_a || {}, now(), w); if (!r.ok) return { ok: false, reason: r.reason, now: now() }; W.coins = w.coins; return { ...view(), ...r, spent: r.coins }; },
    raid_state: () => ({ ok: true, now: now(), trophies: P.trophies, league: MB().league(P.trophies), shield: P.shield, guard: 0, newbie: P.newbie, th: MB().Rules.th(base), skin: P.skin, army_skin: P.army_skin, skins: P.skins, q2: base.q2, shield_buy: P.shield_buy, camp: P.camp, tut: P.tut, dv: 'x',
      day: { battles: P.n_battle, search: P.n_search, bots: P.n_bot, loot: P.loot_day, lootCap: 10000 }, week: { key: '2026-W42', stars: P.week.stars, wins: P.week.wins, chest: P.week.wins >= 3 }, stats: { wins: 5, losses: 2, def_won: 3, def_lost: 1, best: 340 },
      active: Object.values(raids).find(r => r.status === 'active') ? (r => ({ id: r.id, token: r.token, mode: r.mode, started_at: r.started_at, go_at: r.go_at, deadline: r.deadline }))(Object.values(raids).find(r => r.status === 'active')) : null,
      log: P.log, attacks: P.attacks }),
    raid_start: ({ p_mode, p_ref }) => {
      const S = MB().SERVER, th = MB().Rules.th(base), mode = p_mode === 'next' ? 'find' : p_mode;
      for (const r of Object.values(raids)) if (r.status === 'active') { if (r.go_at) return { ok: false, reason: 'active', id: r.id }; r.status = 'canceled'; base.army = { ...base.army, ...r.army }; }
      const army = mode === 'tut' ? S.raid.tutArmy : { ...base.army };
      if (mode !== 'tut') { if (!Object.values(army).some(n => n > 0)) return { ok: false, reason: 'army' }; base.out = army; base.army = {}; }
      const id = 'r' + Math.random().toString(16).slice(2, 12).padEnd(10, '0') + '0123456789', seed = Math.floor(Math.random() * 1e9);
      let layout = null, lvl = null, def = null, offer = null, variant = 0, tr = null, pve = null;
      if (mode === 'find' || mode === 'revenge') {
        layout = RS().bot(102 + (seed % 2), S, seed % 4).map(it => (it.k === 'mine' ? { ...it, t0: now() - 5 * 3600 } : it));
        def = { nick: ['Боря', 'Вика', 'Хома'][seed % 3], th: layout.find(it => it.k === 'th').l, tr: 330, league: 1, skin: seed % 2 ? 'winter' : '', plot: 9 };
        offer = RS().offer(S, { layout, bricks: 4200 }, th, now());
        const T3 = RS().trophies(S, P.trophies, 330, 3), T0 = RS().trophies(S, P.trophies, 330, 0); tr = { win: T3.win, lose: T0.lose };
      } else { lvl = mode === 'camp' ? +p_ref : mode === 'bot' ? 100 + th : 0; variant = seed % 4; pve = { loot: mode === 'camp' ? S.raid.camp[lvl - 1] : mode === 'bot' ? S.raid.bot[th - 1] : (P.tut ? 0 : S.raid.tut), best: P.camp[lvl] || 0 }; }
      const r = raids[id] = { id, token: 'f'.repeat(64), seed, mode, lvl, variant, layout, offer, army, hero: th, def, tr, pve, started_at: now(), go_at: null, deadline: now() + 60, status: 'active' };
      return { ok: true, ...JSON.parse(JSON.stringify(r)), now: now(), scout: S.raid.scout, go: S.raid.go, cost: 0, defs: S };
    },
    raid_go: ({ p_id }) => { const r = raids[p_id]; if (!r) return { ok: false, reason: 'id' }; r.go_at = r.go_at || now(); r.deadline = r.go_at + 420; P.n_battle++; return { ok: true, go_at: r.go_at, deadline: r.deadline, now: now() }; },
    raid_cancel: ({ p_id }) => { const r = raids[p_id]; if (r && r.status === 'active' && !r.go_at) { r.status = 'canceled'; if (r.mode !== 'tut') { base.army = r.army; base.out = {}; } } return { ok: true, status: 'canceled' }; },
    raid_replay: ({ p_id }) => { const r = raids[p_id]; if (!r || r.status !== 'done') return { ok: false, reason: 'id' }; return { ok: true, id: r.id, mode: r.mode, seed: r.seed, lvl: r.lvl, variant: r.variant, layout: r.layout, army: r.army, hero: r.hero, inputs: r.inputs, result: r.result, att: { nick: 'Я', skin: '' }, def: r.def || { nick: 'Разбойники' }, same: true, defs: MB().SERVER }; },
    raid_top: ({ p_kind }) => (p_kind === 'all' ? [{ nick: 'dan4ik37', tr: 980, league: 3 }, { nick: 'Боря', tr: 560, league: 2 }, { nick: 'Я', tr: P.trophies, league: 1 }] : [{ nick: 'Боря', stars: 9, wins: 4, tr: 560, league: 2 }, { nick: 'Я', stars: P.week.stars, wins: P.week.wins, tr: P.trophies, league: 1 }]),
    raid_buy: ({ p_item }) => { const Sh = MB().SERVER.raid.shop; if (p_item === 'sh1') { if (W.gems < Sh.sh1.g) return { ok: false, reason: 'gems' }; W.gems -= Sh.sh1.g; P.shield = now() + Sh.sh1.h * 3600; P.shield_buy = now(); return { ok: true, gems: Sh.sh1.g, balance: W.gems, shield: P.shield }; } if (p_item.startsWith('skin:')) { const k = p_item.slice(5); P.skins.push(p_item); P.skin = k; return { ok: true }; } if (p_item === 'q2c') { base.q2 = true; W.coins -= 1500; return { ok: true }; } return { ok: false, reason: 'item' }; },
    raid_skin: ({ p_kind, p_id }) => { if (p_kind === 'skin') P.skin = p_id; else P.army_skin = p_id; return { ok: true }; },
    raid_chest: () => ({ ok: true, got: 200 }),
  };
  sbClient.rpc = async (name, args) => { const h = H[name]; if (!h) return { data: null, error: { message: 'stub: ' + name, code: 'STUB' } }; try { return { data: h(args || {}), error: null }; } catch (e) { console.error('stub', name, e); return { data: null, error: { message: String(e) } }; } };
  const realFetch = window.fetch;
  window.fetch = async (url, o) => {
    if (String(url).endsWith('/api/raid')) {
      const body = JSON.parse(o.body), r = raids[body.id];
      if (!r) return new Response(JSON.stringify({ ok: false, reason: 'token' }));
      if (r.status === 'done') return new Response(JSON.stringify({ ...r.result, ok: true, again: true }));
      const S = MB().SERVER, layout = r.layout || RS().bot(r.lvl, S, r.variant), x = RS().run({ defs: S, layout, army: r.army, hero: r.hero, seed: r.seed }, body.inputs);
      if (!x.ok) return new Response(JSON.stringify({ ok: false, reason: 'bad_input', why: x.reason }));
      if (x.deployed === 0) { r.status = 'canceled'; base.army = r.army; base.out = {}; return new Response(JSON.stringify({ ok: true, canceled: true })); }
      let res;
      if (r.offer) { const s = RS().settle(S, r.offer, x, { attTh: r.hero, attTr: P.trophies, defTr: 330, lootDay: P.loot_day, lossDay: 0, attBricks: base.bricks, attCap: MB().Rules.cap(base), defBricks: 4200, defProt: r.offer.prot, mines: Object.fromEntries(Object.entries(r.offer.mn).map(([k, v]) => [k, v * 3])) }); res = { stars: x.stars, pct: x.pct, loot: s.total, bonus: s.bonus, added: s.added, tr: s.tr, zero: false }; P.trophies = s.attTr; }
      else { const loot = RS().pve(S, r.mode, r.mode === 'bot' ? r.hero : r.lvl, x.stars, { bots: P.n_bot, best: P.camp[r.lvl] || 0, tut: P.tut }); res = { stars: x.stars, pct: x.pct, loot, bonus: 0, added: Math.min(loot, MB().Rules.cap(base) - base.bricks), tr: 0 }; if (r.mode === 'camp') P.camp[r.lvl] = Math.max(P.camp[r.lvl] || 0, x.stars); if (r.mode === 'tut' && x.stars) P.tut = true; }
      base.bricks += res.added;
      if (r.mode !== 'tut') { const back = {}; for (const [u, n] of Object.entries(r.army)) { const left = n - (x.used[u] || 0); if (left > 0) back[u] = left; } for (const [u, n] of Object.entries(back)) base.army[u] = (base.army[u] || 0) + n; base.out = {}; }
      r.status = 'done'; r.inputs = body.inputs; r.result = { ...res, used: x.used };
      P.attacks.unshift({ id: r.id, t: now(), mode: r.mode, lvl: r.lvl, nick: r.def?.nick || '', stars: x.stars, pct: x.pct, loot: res.added, tr: res.tr, status: 'done' });
      P.log.unshift({ id: r.id, t: now() - 3600, mode: 'find', nick: 'Вика', stars: 2, pct: 63, loot: 320, tr: -12, status: 'done', revenge: true });
      return new Response(JSON.stringify({ ...res, ok: true, sim: { stars: x.stars } }));
    }
    return realFetch(url, o);
  };
  window.__raidStub = { H, raids, P, W, get base(){ return base; }, set base(v){ base = v; }, mkBase, view };
  window.__raidStubGo = withBase => { if (withBase) base = mkBase(); currentUser = { id: uid, email: 'stub@local' }; return 'stub ok'; };
  return 'stub loaded';
}

(async () => {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-raid-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), subs = new Set(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [res, rej] = cb.get(d.id); cb.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('ERR ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Page.javascriptDialogOpening') { errors.push('DIALOG ' + d.params.message.slice(0, 200)); send('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const ev = async (expr, wait = true) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: wait, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, ms = 15000, label = expr) => {
    const t = Date.now();
    while (Date.now() - t < ms) { try { const v = await ev(`return (${expr});`); if (v) return v; } catch (e) {} await sleep(150); }
    ok(false, 'ждали: ' + label); return null;
  };
  const load = url => new Promise(res => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); res(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(res, 20000); });
  let mobile = false;
  const shot = async name => {
    await ev(`document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast').forEach(e=>e.remove()); return 1;`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name);
  };
  // центр элемента → настоящий клик/касание
  const center = async sel => ev(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; let r = e.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight) { e.scrollIntoView({block:'center'}); await new Promise(r=>setTimeout(r,120)); r = e.getBoundingClientRect(); } return [r.left + r.width/2, r.top + r.height/2];`);
  const tapAt = async ([x, y]) => {
    if (mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(40);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    await sleep(120);
  };
  const click = async sel => { const c = await center(sel); ok(!!c, 'есть кнопка ' + sel); if (c) await tapAt(c); return !!c; };
  const drag = async (pts) => {   // провести пальцем/мышью по точкам
    if (mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] });
      for (const [x, y] of pts.slice(1)) { await sleep(140); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
      for (const [x, y] of pts.slice(1)) { await sleep(140); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); }
      const l = pts[pts.length - 1];
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', clickCount: 1 });
    }
    await sleep(150);
  };
  // клетки поля → точки экрана (через вид боя)
  const ringPts = async cells => ev(`const st = GAME_IMPL.raid._test.state(), V = st.bt.V, r = V.cv.getBoundingClientRect();
    return ${JSON.stringify(cells)}.map(([cx, cz]) => { const [sx, sy] = V.p(cx, cz); return [r.left + sx * r.width / V.W, r.top + sy * r.height / V.H]; });`);
  const btState = () => ev(`const st = GAME_IMPL.raid._test.state(); const bt = st && st.bt; if (!bt) return { screen: st && st.screen }; return { screen: st.screen, kind: bt.kind, phase: bt.phase, tick: bt.B.tick, over: bt.B.over, ins: bt.ins.length, left: bt.B.left, res: bt.result, server: bt.server, ended: !!bt.ended };`);
  const ffwd = ms => ev(`const bt = GAME_IMPL.raid._test.state().bt; if (bt && bt.t0) bt.t0 -= ${ms}; return bt && bt.B.tick;`);   // только для проверки: «перемотать» часы боя

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  const stubIn = async () => {
    await send('Runtime.evaluate', { expression: '(' + stubServer.toString() + ')()' });
    await ev(`__raidStubGo(true);
      try { localStorage.setItem('d37_ref_my', JSON.stringify({ u: 'aaaaaaaa-0000-4000-8000-000000000001', c: 'k7m2qz' })); } catch (e) {}
      window.__clip = null; try { navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; } catch (e) { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); }
      return 1;`);
  };
  const remount = async (hash = '#/games/raid') => { await ev(`location.hash = '#/games'; return 1;`); await sleep(500); await ev(`location.hash = ${JSON.stringify(hash)}; return 1;`); };

  try {
    // ═══ ПК ═══
    if (!ONLY || ONLY === 'pc') {
      console.log('ПК 1280×800');
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await load(BASE + '/?e2e=' + Date.now() + '#/games/raid');
      await waitFor(`window.GAME_IMPL && GAME_IMPL.raid && document.querySelector('.rd .rd-help, .rd .rd-grid')`, 20000, 'экран набегов');
      ok(await ev(`return document.querySelectorAll('.rd .rd').length === 0;`), 'нет вложенного .rd в .rd');
      await shot('pc-01-help');
      await click('.rd [data-a="hub"]');
      await waitFor(`document.querySelector('.rd-grid')`, 5000, 'штаб гостя');
      await shot('pc-02-guest-hub');
      // учебный набег
      await click('.rd-grid [data-a="tut"]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && document.querySelector('.rdCv')`, 5000, 'поле боя');
      await sleep(800);
      await shot('pc-03-tut-start');
      ok(await ev(`const r = document.querySelector('.rd-field').getBoundingClientRect(); return r.top >= 50 && r.bottom <= innerHeight + 1;`), 'поле боя целиком на экране', await ev(`const r = document.querySelector('.rd-field').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight];`));
      await click('.rd-u[data-u="fighter"]');
      let pts = await ringPts([[1.3, 4], [1.3, 7], [1.3, 10], [1.3, 13]]);
      for (const p of pts) await tapAt(p);
      let s = await btState();
      ok(s.phase === 'fight' && s.ins >= 4, 'учебный: высадка нажатием', s);
      await click('.rd-u[data-u="archer"]');
      const pts2 = await ringPts([[3, 1.3], [5, 1.3], [7, 1.3], [9, 1.3], [11, 1.3]]);
      await drag(pts2);
      s = await btState();
      ok(s.ins >= 6, 'учебный: высадка «кистью» (ведёшь мышью)', s);
      // нельзя в середину
      const mid = await ringPts([[8, 8]]);
      const before = s.ins; await tapAt(mid[0]); s = await btState();
      ok(s.ins === before && await ev(`return !document.querySelector('.rdTip').hidden && /нельзя/.test(document.querySelector('.rdTip').textContent);`), 'в середину участка высадить нельзя — подсказка');
      await click('.rd-u[data-u="hero"]');
      await tapAt((await ringPts([[1.3, 8.5]]))[0]);
      await sleep(2500);
      await shot('pc-04-tut-fight');
      // «Удар» героя, когда можно
      for (let i = 0; i < 40; i++) { if (await ev(`const b = document.querySelector('.rd-u.ab'); return b && !b.disabled;`)) { await click('.rd-u.ab'); break; } await sleep(250); }
      const t0 = Date.now();
      while (Date.now() - t0 < 200000) { s = await btState(); if (s.ended) break; await sleep(1000); }
      ok(s.ended && s.res, 'учебный набег закончился сам (реальное время)', { tick: s.tick, res: s.res, sec: Math.round((Date.now() - t0) / 1000) });
      await sleep(600);
      await shot('pc-05-tut-result');

      // ═══ с подменённым сервером ═══
      await stubIn();
      await remount();
      await waitFor(`document.querySelector('.rdHubCv')`, 8000, 'штаб со своим участком');
      await sleep(500);
      ok(await ev(`return document.querySelectorAll('.rd .rd').length === 0;`), 'нет вложенного .rd (штаб)');
      await shot('pc-06-hub');
      // позвать друга штурмовать
      await click('[data-a="invite"]');
      await sleep(300);
      const clip1 = await ev(`return window.__clip;`);
      ok(/#\/games\/raid\/friendly\/7/.test(clip1 || '') && /[?&]ref=k7m2qz/.test(clip1 || ''), '«Позвать друга»: ссылка на дружеский бой с кодом приглашения', clip1);
      // казарма
      await click('.rd [data-a="train"]');
      await waitFor(`document.querySelector('.rd-units')`, 5000, 'казарма');
      await click('[data-t^="fighter:"]');
      await sleep(500);
      ok(await ev(`return !!document.querySelector('.rd-q') && GAME_IMPL.raid._test.state().base.queue.length > 0;`), 'казарма: отряд встал в очередь');
      await shot('pc-07-train');
      await click('.rd [data-a="hub"]');
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб');
      // набег на игрока
      await click('[data-a="find"]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && GAME_IMPL.raid._test.state().bt.kind === 'raid'`, 8000, 'набег начался');
      await sleep(900);
      s = await btState();
      ok(s.phase === 'scout', 'набег: сначала разведка', s.phase);
      await shot('pc-08-scout');
      const types = await ev(`return [...document.querySelectorAll('.rd-u[data-u]')].map(b => b.dataset.u);`);
      const edge = [[1.3, 3], [1.3, 5], [1.3, 7], [1.3, 9], [1.3, 11], [1.3, 13], [3, 1.3], [5, 1.3], [7, 1.3], [9, 1.3], [11, 1.3], [13, 1.3]];
      let k = 0;
      for (const u of types.filter(u => u !== 'hero')) {
        await click(`.rd-u[data-u="${u}"]`);
        const P = await ringPts(edge.slice(k % 12, k % 12 + 4).concat(edge.slice(0, Math.max(0, k % 12 + 4 - 12))));
        await drag(P); k += 3;
        await drag(P);
      }
      await click('.rd-u[data-u="hero"]'); await tapAt((await ringPts([[1.3, 8]]))[0]);
      s = await btState();
      ok(s.phase === 'fight' && s.ins > 8, 'набег: высадка началась, бой идёт', { phase: s.phase, ins: s.ins });
      await sleep(2500);
      await shot('pc-09-raid-fight');
      // остаток боя — перематываем часы (тот же ввод, тот же итог)
      for (let i = 0; i < 80; i++) { s = await btState(); if (s.ended) break; await ffwd(4000); await sleep(250); }
      await waitFor(`(() => { const bt = GAME_IMPL.raid._test.state().bt; return bt && bt.server && bt.server.ok; })()`, 15000, 'итог засчитан сервером');
      s = await btState();
      ok(s.server && s.server.ok && s.server.stars === s.res.stars, 'итог сервера = итог браузера (звёзды)', { srv: s.server, res: s.res });
      await sleep(400);
      await shot('pc-10-raid-result');
      await click('.rd-res [data-a="share"]');
      await sleep(300);
      const clip2 = await ev(`return window.__clip;`);
      ok(/#\/games\/raid\/replay\/r[0-9a-f]+/.test(clip2 || '') && /ref=k7m2qz/.test(clip2 || ''), '«Поделиться повтором»: ссылка с кодом приглашения', clip2);
      // журнал защиты, повтор, месть
      await click('.rd-res [data-a="hub"]');
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб после боя');
      await click('.rd [data-a="log"]');
      await waitFor(`document.querySelector('.rd-list')`, 5000, 'журнал');
      await shot('pc-11-log');
      await click('[data-rp]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && GAME_IMPL.raid._test.state().bt.kind === 'replay'`, 5000, 'повтор');
      await sleep(1500);
      await click('[data-a="speed"]'); await click('[data-a="speed"]');
      await sleep(1500);
      await shot('pc-12-replay');
      for (let i = 0; i < 160; i++) { s = await btState(); if (s.over) break; await sleep(500); }
      ok(s.over && s.res && s.res.stars === (await ev(`return GAME_IMPL.raid._test.state().bt.data.result.stars;`)), 'повтор дошёл до того же итога', s.res);
      await click('.rd-res [data-a="hub"]');   // после повтора — окно итога поверх поля
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб');
      await click('.rd [data-a="log"]');
      await waitFor(`document.querySelector('[data-rv]')`, 5000, 'кнопка «Месть»');
      await click('[data-rv]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && GAME_IMPL.raid._test.state().bt.kind === 'raid'`, 8000, 'месть: набег');
      ok((await btState()).phase === 'scout', 'месть: разведка');
      await click('.rdHome');
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'отмена на разведке → штаб');
      for (const [a, sel, nm] of [['camp', '[data-camp]', 'pc-13-camp'], ['top', '.rdTopA .rd-row', 'pc-14-top'], ['shop', '[data-buy]', 'pc-15-shop']]) {
        await click(`.rd [data-a="${a}"]`); await waitFor(`document.querySelector(${JSON.stringify(sel)})`, 5000, a); await sleep(300); await shot(nm);
        await click('.rd-back'); await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб');
      }
      // дружеский бой по ссылке
      await remount('#/games/raid/friendly/8');
      await waitFor(`GAME_IMPL.raid._test.state().bt && GAME_IMPL.raid._test.state().bt.kind === 'friendly'`, 8000, 'дружеский бой');
      await sleep(800);
      await shot('pc-16-friendly');
    }

    // ═══ Телефон ═══
    if (!ONLY || ONLY === 'phone') {
      console.log('Телефон 412×915');
      mobile = true;
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setUserAgentOverride', { userAgent: PHONE });
      await load(BASE + '/?e2e=' + Date.now() + '#/games/raid');
      await waitFor(`window.GAME_IMPL && GAME_IMPL.raid && document.querySelector('.rd .rd-help, .rd .rd-grid')`, 20000, 'экран набегов');
      await stubIn();
      await ev(`localStorage.setItem('d37_raid_help', '1'); return 1;`);
      await remount();
      await waitFor(`document.querySelector('.rdHubCv')`, 8000, 'штаб (телефон)');
      await sleep(500);
      ok(await ev(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'телефон: нет прокрутки вбок', await ev(`return [document.documentElement.scrollWidth, innerWidth];`));
      await shot('ph-01-hub');
      await ev(`window.scrollTo(0, 99999); return 1;`); await sleep(300);
      await shot('ph-02-hub-bottom');
      await ev(`window.scrollTo(0, 0); return 1;`);
      await click('[data-a="find"]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && GAME_IMPL.raid._test.state().bt.kind === 'raid'`, 8000, 'набег (телефон)');
      await sleep(900);
      const fieldBox = await ev(`const r = document.querySelector('.rd-field').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)];`);
      ok(fieldBox[1] <= 915 && fieldBox[1] >= 380, 'телефон: поле помещается по высоте', fieldBox);
      await shot('ph-03-scout');
      const types = await ev(`return [...document.querySelectorAll('.rd-u[data-u]')].map(b => b.dataset.u);`);
      await click(`.rd-u[data-u="${types[0]}"]`);
      await drag(await ringPts([[1.3, 3], [1.3, 5], [1.3, 7], [1.3, 9], [1.3, 11], [1.3, 13]]));
      let s = await btState();
      ok(s.phase === 'fight' && s.ins >= 3, 'телефон: высадка пальцем (ведёшь)', { phase: s.phase, ins: s.ins });
      for (const u of types.slice(1).filter(u => u !== 'hero')) { await click(`.rd-u[data-u="${u}"]`); await drag(await ringPts([[3, 1.3], [5, 1.3], [7, 1.3], [9, 1.3], [11, 1.3]])); }
      await sleep(2000);
      await shot('ph-04-fight');
      for (let i = 0; i < 80; i++) { s = await btState(); if (s.ended) break; await ffwd(4000); await sleep(250); }
      await waitFor(`(() => { const bt = GAME_IMPL.raid._test.state().bt; return bt && bt.server && bt.server.ok; })()`, 15000, 'итог (телефон)');
      s = await btState();
      ok(s.server && s.server.ok && s.server.stars === s.res.stars, 'телефон: итог сервера = итог браузера', { srv: s.server, res: s.res });
      await sleep(400);
      await shot('ph-05-result');
      await click('.rd-res [data-a="hub"]');
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб');
      await click('.rd [data-a="train"]');
      await waitFor(`document.querySelector('.rd-units')`, 5000, 'казарма (телефон)');
      await shot('ph-06-train');
      await click('.rd [data-a="hub"]');
      await waitFor(`document.querySelector('.rdHubCv')`, 5000, 'штаб');
      await click('.rd [data-a="tut"]');
      await waitFor(`GAME_IMPL.raid._test.state().bt && document.querySelector('.rdCv')`, 5000, 'учебный (телефон)');
      await sleep(800);
      await shot('ph-07-tut');
    }
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  finally {
    console.log('Ошибки страницы:', errors.length ? '\n  ' + errors.slice(0, 30).join('\n  ') : 'нет');
    console.log(fails ? `✗ ${fails} проверок не прошло` : '✓ всё прошло', '· снимки:', OUT);
    ws.close(); proc.kill(); await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
