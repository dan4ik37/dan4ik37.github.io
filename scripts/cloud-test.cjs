// ☁️ Облачные сохранения (js/core/cloud.js + V.store.packWorld / unpackWorld / replaceWorld) без браузера: node scripts/cloud-test.cjs
// Числа облака = cloud_rule() в ugc.sql; сжатие туда-обратно; мир «Кубомира» в байты и обратно (правки, плитки, «основа»), испорченные
// файлы не принимаются; правило версий (resolve); запись на подменном сервере (как ugc.sql: место → файл → готово, конфликт версий,
// старый файл удаляется, файл не дошёл — версия не меняется); размер и время упаковки мира на 400 чанков.
// SQL — отдельно, на PGlite: E:\claude-tmp\coop\test-cloud.mjs.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sec = t => console.log('— ' + t);

function load(files, extra = {}){
  const ls = new Map();
  const ctx = { console, Math, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float32Array, Float64Array, Map, Set, WeakMap, Object, Array, JSON, Number, String, Boolean, Error, TypeError, RangeError, Promise, Date, RegExp, Symbol,
    setTimeout, clearTimeout, setInterval, clearInterval, performance, ArrayBuffer, DataView, TextEncoder, TextDecoder, Blob: global.Blob, DecompressionStream: global.DecompressionStream, CompressionStream: global.CompressionStream, Response: global.Response,
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) }, ...extra };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  ctx.btoa = s => Buffer.from(s, 'binary').toString('base64');
  ctx.atob = s => Buffer.from(s, 'base64').toString('binary');
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

// ── подменный Supabase: rpc cloud_* (как ugc.sql) и хранилище saves ──
function fakeSb(uid){
  const rows = new Map(), files = new Map(), S = { rows, files, failUpload: false, calls: [] };
  const key = (g, w) => g + '|' + w;
  let clock = 1e6;
  S.tick = s => { clock += s * 1000; };
  const RPC = {
    cloud_list({ p_game }){ const list = [...rows.values()].filter(r => r.game === p_game && r.path).map(r => ({ world: r.world, name: r.name, bytes: r.bytes, ver: r.ver, gt: r.gt, device: r.device, path: r.path, at: new Date(r.at).toISOString() })); return { ok: true, slots: 3, max_bytes: 5242880, used: list.length, list }; },
    cloud_begin(a){
      if (!/^[a-z]{2,16}$/.test(a.p_game) || !/^[A-Za-z0-9_-]{2,40}$/.test(a.p_world)) return { ok: false, reason: 'bad' };
      if (!(a.p_bytes >= 1 && a.p_bytes <= 5242880)) return { ok: false, reason: 'size' };
      let r = rows.get(key(a.p_game, a.p_world));
      if (r) {
        if (r.path && clock - r.at < 20000) return { ok: false, reason: 'too_fast' };
        if (r.path && !a.p_force && a.p_base !== r.ver) return { ok: false, reason: 'conflict', ver: r.ver, gt: r.gt, at: r.at, device: r.device };
      } else {
        if ([...rows.values()].filter(x => x.game === a.p_game).length >= 3) return { ok: false, reason: 'slots', slots: 3 };
        r = { game: a.p_game, world: a.p_world, name: a.p_name, ver: 0, gt: 0, device: '', path: null, bytes: 0, at: clock };
        rows.set(key(a.p_game, a.p_world), r);
      }
      r.pending = `${uid}/${a.p_game}/${a.p_world}/${r.ver + 1}-${Math.random().toString(36).slice(2, 8)}.kbw`;
      return { ok: true, path: r.pending, ver: r.ver };
    },
    cloud_commit(a){
      const r = rows.get(key(a.p_game, a.p_world));
      if (!r) return { ok: false, reason: 'not_found' };
      if (r.pending !== a.p_path) return { ok: false, reason: 'stale' };
      if (!files.has(a.p_path)) return { ok: false, reason: 'nofile' };
      const old = r.path;
      Object.assign(r, { ver: r.ver + 1, path: a.p_path, pending: null, bytes: files.get(a.p_path).length, gt: a.p_gt, device: a.p_device, name: a.p_name || r.name, at: clock });
      return { ok: true, ver: r.ver, old };
    },
    cloud_delete(a){ const k = key(a.p_game, a.p_world), r = rows.get(k); if (!r) return { ok: false, reason: 'not_found' }; rows.delete(k); return { ok: true, path: r.path, pending: r.pending }; },
  };
  S.client = {
    async rpc(fn, args){ S.calls.push(fn); const f = RPC[fn]; if (!f) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; return { data: JSON.parse(JSON.stringify(f(args))), error: null }; },
    storage: { from: b => ({
      async upload(p, blob){ if (S.failUpload) return { error: { message: 'сеть' } }; if (files.has(p)) return { error: { message: 'Duplicate' } }; if (!p.startsWith(uid + '/')) return { error: { message: 'RLS' } }; files.set(p, new Uint8Array(await blob.arrayBuffer())); return { data: { path: p } }; },
      async download(p){ const f = files.get(p); return f ? { data: new Blob([f]) } : { error: { message: 'Object not found' } }; },
      async remove(list){ for (const p of list) files.delete(p); return { data: list }; },
      async list(dir){ return { data: [...files.keys()].filter(p => p.startsWith(dir + '/')).map(p => ({ name: p.slice(dir.length + 1) })) }; },
    }) },
  };
  return S;
}

(async () => {
  const UID = '11111111-2222-3333-4444-555555555555';
  const SB = fakeSb(UID);
  const ctx = load(['js/engine/voxel.js', 'js/engine/voxel-store.js', 'js/core/cloud.js'], { sbClient: SB.client, currentUser: { id: UID } });
  const V = ctx.D37E.vox, C = ctx.D37Cloud;

  sec('числа облака = cloud_rule() в ugc.sql');
  const sql = fs.readFileSync(path.join(SITE, 'ugc.sql'), 'utf8');
  const rule = k => { const m = new RegExp(`when '${k}' then (\\d+)`).exec(sql); return m ? +m[1] : null; };
  ok(rule('slots') === C.RULES.slots && rule('slots_vip') === C.RULES.slotsVip, 'места: 3 и VIP 5 — как на сервере', [rule('slots'), rule('slots_vip')]);
  ok(rule('max_bytes') === C.RULES.maxBytes && rule('total_mb') === C.RULES.totalMb && rule('min_gap_s') === C.RULES.minGapS, 'размер файла, всё облако, частота — как на сервере');
  ok(/values \('saves', 'saves', false, 5242880/.test(sql), 'хранилище saves: закрытое, файл до 5 МБ');
  ok(C.available(), 'вошёл + Supabase + сжатие → облако доступно');

  sec('сжатие');
  const big = new Uint8Array(3e6); for (let i = 0; i < big.length; i++) big[i] = (i * 7 + (i >> 10)) & 255;
  let t0 = performance.now();
  const gz = await C.gzip(big), msZ = performance.now() - t0;
  ok(C.isGz(gz) && gz.length < big.length, 'gzip: заголовок 1f 8b, меньше исходного', gz.length);
  const back = await C.gunzip(gz);
  ok(back.length === big.length && back.every((v, i) => v === big[i]), 'gunzip — байт в байт');
  ok((await C.gunzip(big.subarray(0, 10))).length === 10, 'не сжатое — как есть');
  let bomb = false; try { await C.gunzip(await C.gzip(new Uint8Array(2e6)), 1e6); } catch (e) { bomb = /большой/.test(e.message); }
  ok(bomb, 'распаковка больше предела — отказ (zip-бомба)');
  console.log(`  3 МБ: сжатие ${msZ.toFixed(0)} мс (кусками по 64 КБ)`);

  sec('мир «Кубомира» в байты и обратно');
  const rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296; })();
  const world = { id: 'w1', name: 'Тест «облако»', seed: 'кубы37', mode: 'survival', diff: 'easy', palette: V.blocks.map(b => b.name), player: { x: 1.5, y: 70, z: -3, inv: [{ id: 'torch', n: 5, d: 0 }] }, gt: 1234.5, genVer: 2 };
  const recs = [];
  for (let i = 0; i < 400; i++) {
    const n = Math.floor(rnd() * 300), m = new Map();
    for (let k = 0; k < n; k++) m.set(Math.floor(rnd() * V.CELLS), Math.floor(rnd() * 60) | (rnd() < .1 ? (Math.floor(rnd() * 15) << 12) : 0));
    const rec = { cx: Math.floor(rnd() * 200) - 100, cz: i - 200, e: V.store.packEdits(m), t: rnd() < .1 ? [[123, { items: [{ id: 'stone', n: 3 }, null] }]] : [] };
    if (i === 7) { rec.b = new Uint16Array([V.CELLS - 100, 1, 100, 0]); }
    recs.push(rec);
  }
  t0 = performance.now();
  const packed = V.store.packRecs(world, recs), msPack = performance.now() - t0;
  t0 = performance.now();
  const un = V.store.unpackWorld(packed), msUn = performance.now() - t0;
  ok(un.world.name === world.name && un.world.seed === world.seed && un.world.gt === world.gt && un.recs.length === recs.length, 'мир: название, зерно, игровое время, число чанков');
  const same = (a, b) => { const A = new Map(), B = new Map(); V.store.unpackEdits(a.e, A); V.store.unpackEdits(b.e, B); if (A.size !== B.size) return false; for (const [k, v] of A) if (B.get(k) !== v) return false; return a.cx === b.cx && a.cz === b.cz && JSON.stringify(a.t || []) === JSON.stringify(b.t || []); };
  ok(recs.every((r, i) => same(r, un.recs[i])), 'все правки, плитки — те же');
  ok(un.recs[7].b && un.recs[7].b.length === 4 && un.recs[7].b[0] === V.CELLS - 100, '«основа» чанка (мир из Minecraft) — та же');
  const gzW = await C.gzip(packed);
  console.log(`  400 чанков, ${recs.reduce((s, r) => s + r.e.length, 0)} правок: ${(packed.length / 1024).toFixed(0)} КБ → gzip ${(gzW.length / 1024).toFixed(0)} КБ · упаковка ${msPack.toFixed(1)} мс, разбор ${msUn.toFixed(1)} мс`);
  ok(msPack < 400 && msUn < 400, 'упаковка и разбор — быстро', [msPack, msUn]);
  const bad = u8 => { try { V.store.unpackWorld(u8); return false; } catch (e) { return true; } };
  ok(bad(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), 'не тот формат — отказ');
  ok(bad(packed.subarray(0, packed.length - 3)), 'обрезанный файл — отказ');
  { const p2 = packed.slice(); const dv = new DataView(p2.buffer); const hl = dv.getUint32(4, true); dv.setUint32(8 + hl + 8, V.CELLS + 5, true); ok(bad(p2), 'число правок больше ячеек — отказ'); }
  { const w2 = Object.assign({}, world); delete w2.seed; ok(bad(V.store.packRecs(w2, [])), 'мир без зерна — отказ'); }

  sec('заменить мир (без IndexedDB — память)');
  await V.store.putWorld({ id: 'wx', name: 'старый', seed: 1 });
  await V.store.putChunks('wx', [{ cx: 0, cz: 0, e: new Uint32Array([5 << 16 | 1]), t: [] }, { cx: 9, cz: 9, e: new Uint32Array([6 << 16 | 2]), t: [] }]);
  await V.store.replaceWorld('wx', un.world, un.recs.slice(0, 3));
  const keys = await V.store.chunkKeys('wx'), wx = await V.store.world('wx');
  ok(wx.name === world.name && wx.id === 'wx', 'мир заменён (id — свой)');
  ok(keys.size === 3 && !keys.has('9|9'), 'чанки старого мира убраны, новые на месте', [...keys]);
  const rp = await V.store.packWorld('wx');
  ok(rp && V.store.unpackWorld(rp).recs.length === 3, 'packWorld из хранилища');

  sec('правило версий');
  const R = C.resolve;
  ok(R(null, null) === 'new' && R({ on: true, ver: null }, null) === 'up', 'нет в облаке: не включено — new, включено — up');
  ok(R({ on: true, ver: 3, dirty: false }, { ver: 3 }) === 'same' && R({ on: true, ver: 3, dirty: true }, { ver: 3 }) === 'up', 'та же версия: не менялся — same, менялся — up');
  ok(R({ on: true, ver: 3, dirty: false }, { ver: 5 }) === 'down' && R({ on: true, ver: 3, dirty: true }, { ver: 5 }) === 'conflict', 'в облаке новее: здесь не менялся — down, менялся — conflict');
  ok(R({ on: true, ver: null }, { ver: 2 }) === 'conflict' && R(null, { ver: 2 }) === 'conflict', 'копия не сверялась, а в облаке есть — спросить');
  ok(R({ on: true, ver: 4, dirty: false }, null) === 'gone', 'убрали из облака на другом устройстве — gone');

  sec('запись на подменном сервере');
  const data = packed;
  let r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 100, base: null });
  ok(r.ok && r.ver === 1 && SB.files.size === 1, 'первая версия: 1, файл в хранилище', r);
  const p1 = r.path;
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 110, base: 1 });
  ok(!r.ok && r.reason === 'too_fast', 'сразу ещё раз — too_fast');
  SB.tick(30);
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 120, base: 1 });
  ok(r.ok && r.ver === 2 && !SB.files.has(p1) && SB.files.size === 1, 'вторая версия — старый файл удалён', r);
  SB.tick(30);
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 90, base: 1 });
  ok(!r.ok && r.reason === 'conflict' && r.ver === 2, 'база устарела (меняли на другом устройстве) — conflict', r);
  ok(SB.files.size === 1, 'при конфликте файл не загружался');
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 90, base: 1, force: true });
  ok(r.ok && r.ver === 3, '«оставить эту» (force) — поверх', r);
  SB.tick(30); SB.failUpload = true;
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 95, base: 3 });
  SB.failUpload = false;
  ok(!r.ok && r.reason === 'net' && SB.rows.get('kubomir|w1').ver === 3, 'файл не дошёл — версия прежняя, ответ net');
  const L = await C.list('kubomir');
  ok(L.ok && L.list.length === 1 && L.list[0].ver === 3 && L.list[0].gt === 90, 'список: версия и игровое время', L.list[0]);
  const got = await C.get('kubomir', L.list[0]);
  ok(got.length === data.length && got.every((v, i) => v === data[i]), 'скачанная версия — байт в байт');
  for (const w of ['w2', 'w3']) { SB.tick(30); await C.put('kubomir', w, { name: w, data: new Uint8Array([1, 2, 3]), gt: 1 }); }
  r = await C.put('kubomir', 'w4', { name: 'w4', data: new Uint8Array([1, 2, 3]), gt: 1 });
  ok(!r.ok && r.reason === 'slots', '4-й мир — нет мест');
  const d = await C.del('kubomir', 'w2');
  ok(d.ok && ![...SB.files.keys()].some(p => p.includes('/w2/')), 'удалить из облака — и файлы');
  ok((await C.put('kubomir', 'w/1', { data })).reason === 'bad' && (await C.put('Kubomir', 'w1', { data })).reason === 'bad', 'неправильные имена — отказ без запроса');
  { const huge = new Uint8Array(6.5e6); for (let i = 0; i < huge.length; i++) huge[i] = (Math.random() * 256) | 0; ok((await C.put('kubomir', 'w5', { data: huge })).reason === 'size', 'больше 5 МБ после сжатия — size (без запроса)'); }

  sec('без входа');
  const ctx2 = load(['js/core/cloud.js'], { sbClient: SB.client, currentUser: null });
  ok(!ctx2.D37Cloud.available() && (await ctx2.D37Cloud.list('kubomir')).reason === 'auth', 'не вошёл — облака нет (auth)');
  const ctx3 = load(['js/core/cloud.js'], { sbClient: { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.cloud_list' } }) }, currentUser: { id: UID } });
  ok((await ctx3.D37Cloud.list('kubomir')).reason === 'off', 'SQL ещё не применён (PGRST202) — off');

  console.log(`\ncloud-test: ${pass} ok, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
