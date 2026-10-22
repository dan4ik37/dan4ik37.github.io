// ☁️ Облачные сохранения (js/core/cloud.js + V.store.packWorld / unpackWorld / replaceWorld) без браузера: node scripts/cloud-test.cjs
// Числа облака = cloud_rule() в ugc.sql; сжатие туда-обратно; мир «Кубомира» в байты и обратно (правки, плитки, «основа»), испорченные
// файлы не принимаются; правило версий (resolve); запись на подменном сервере (как ugc.sql: место → файл → готово, конфликт версий,
// старый файл удаляется, файл не дошёл — версия не меняется); размер и время упаковки мира на 400 чанков; подпись мира (отправлять,
// только если поменялся); свой сервер вместо Supabase (setBackend); сколько весит мир после 1 и 5 часов игры (настоящий генератор).
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
    cloud_list({ p_game }){ const list = [...rows.values()].filter(r => r.game === p_game && r.path).map(r => ({ world: r.world, name: r.name, bytes: r.bytes, ver: r.ver, gt: r.gt, device: r.device, path: r.path, at: new Date(r.at).toISOString() })); return { ok: true, slots: S.slots, max_bytes: S.max, plus: S.slots > 2, full: S.full, used: list.length, list }; },
    cloud_begin(a){
      if (!/^[a-z]{2,16}$/.test(a.p_game) || !/^[A-Za-z0-9_-]{2,40}$/.test(a.p_world)) return { ok: false, reason: 'bad' };
      if (!(a.p_bytes >= 1 && a.p_bytes <= S.max)) return { ok: false, reason: 'size', max: S.max };
      if (S.full && !(rows.get(key(a.p_game, a.p_world))?.bytes >= a.p_bytes)) return { ok: false, reason: 'full' };
      let r = rows.get(key(a.p_game, a.p_world));
      if (r) {
        if (r.path && clock - r.at < 20000) return { ok: false, reason: 'too_fast' };
        if (r.path && !a.p_force && a.p_base !== r.ver) return { ok: false, reason: 'conflict', ver: r.ver, gt: r.gt, at: r.at, device: r.device };
      } else {
        if ([...rows.values()].filter(x => x.game === a.p_game).length >= S.slots) return { ok: false, reason: 'slots', slots: S.slots };
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
    cloud_usage(){ return { ok: true, site_bytes: [...files.values()].reduce((s, f) => s + f.length, 0), site_mb: 1024, cap_mb: 800, full: S.full, cloud_bytes: [...rows.values()].reduce((s, r) => s + r.bytes, 0), worlds: rows.size, users: 1 }; },
  };
  S.slots = 2; S.max = 2097152; S.full = false;
  S.client = {
    async rpc(fn, args){ S.calls.push(fn); const f = RPC[fn]; if (!f) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; return { data: JSON.parse(JSON.stringify(f(args))), error: null }; },
    storage: { from: b => ({
      async upload(p, blob){ if (S.failUpload) return { error: { message: 'сеть' } }; if (files.has(p)) return { error: { message: 'Duplicate' } }; if (!p.startsWith(uid + '/')) return { error: { message: 'RLS' } }; files.set(p, new Uint8Array(await blob.arrayBuffer())); return { data: { path: p } }; },
      async download(p){ const f = files.get(p); return f ? { data: new Blob([f]) } : { error: { message: 'Object not found' } }; },
      async remove(list){ for (const p of list) files.delete(p); return { data: list }; },
      async list(dir){ S.calls.push('list'); return { data: [...files.keys()].filter(p => p.startsWith(dir + '/')).map(p => ({ name: p.slice(dir.length + 1) })) }; },
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
  ok(rule('slots') === C.RULES.slots && rule('max_bytes') === C.RULES.maxBytes && C.RULES.slots === 2 && C.RULES.maxBytes === 2097152, 'обычный аккаунт: 2 мира по 2 МБ — как на сервере', [rule('slots'), rule('max_bytes')]);
  ok(rule('slots_plus') === C.RULES.slotsPlus && rule('max_bytes_plus') === C.RULES.maxBytesPlus && C.RULES.slotsPlus === 4 && C.RULES.maxBytesPlus === 4194304, 'VIP / Донатер: 4 мира по 4 МБ — как на сервере');
  ok(rule('site_mb') === C.RULES.siteMb && rule('cap_mb') === C.RULES.capMb && rule('min_gap_s') === C.RULES.minGapS && C.RULES.capMb < C.RULES.siteMb, 'хранилище сайта 1024 МБ, предел 800, частота — как на сервере');
  ok(/values \('saves', 'saves', false, 4194304/.test(sql) && (sql.match(/file_size_limit = 4194304/g) || []).length === 1, 'хранилище saves: закрытое, файл до 4 МБ (предел VIP)');
  ok(/'full', public\.cloud_full\(\)/.test(sql) && /'max_bytes', public\.cloud_max\(uid\)/.test(sql), 'cloud_list отдаёт пределы этого аккаунта и «переполнено»');
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
  { const huge = new Uint8Array(2.5e6); for (let i = 0; i < huge.length; i++) huge[i] = (Math.random() * 256) | 0; const n = SB.calls.length; const rs = await C.put('kubomir', 'w5', { data: huge }); ok(rs.reason === 'size' && rs.max === 2097152 && SB.calls.length === n, 'больше 2 МБ после сжатия — size без запроса (предел — из ответа cloud_list)', rs); }
  // брошенный файл прошлой попытки (дошёл, а «готово» — нет) убирается после следующей записи
  SB.tick(30); SB.files.set(UID + '/kubomir/w1/9-orphan.kbw', new Uint8Array(10));
  r = await C.put('kubomir', 'w1', { name: 'Мир', data, gt: 99, base: 3 });
  await new Promise(res => setTimeout(res, 20));
  ok(r.ok && !SB.files.has(UID + '/kubomir/w1/9-orphan.kbw') && [...SB.files.keys()].filter(p => p.includes('/w1/')).length === 1, 'брошенный файл в папке мира убран', [...SB.files.keys()]);
  // облако сайта переполнено: новый мир — full (спокойно), не растущий — сохраняется
  SB.full = true; SB.tick(30);
  ok((await C.put('kubomir', 'w6', { name: 'w6', data: new Uint8Array([1, 2, 3]), gt: 1 })).reason === 'full', 'переполнено — новый мир: full');
  ok((await C.list('kubomir')).full === true && C.limits().full === true, 'cloud_list: full — игра знает и не пытается зря');
  SB.full = false;
  const us = await C.usage();
  ok(us.ok && us.site_mb === 1024 && us.cap_mb === 800, 'usage (админ): занято, предел', us);

  sec('подпись мира: отправлять, только если поменялся');
  {
    const w0 = { id: 'ws', name: 'Подпись', seed: 's', palette: ['air', 'stone'], player: { x: 1.2, y: 70, z: 3.4, yaw: 1, hp: 20, food: 18, inv: [{ id: 'torch', n: 5, d: 0 }] }, gt: 10, time: 8, played: 1, cloud: { on: true, ver: 2 }, thumb: 'data:image/jpeg;base64,AAAA', ents: [{ t: 'zombie', x: 1 }] };
    const rc = [{ cx: 0, cz: 0, e: new Uint32Array([5 << 16 | 1]), t: [] }];
    const sg = (w, r2) => V.store.sig(w, V.store.packRecs(w, r2 || rc));
    const s0 = sg(w0), same = (a, b) => a.b === b.b && a.m === b.m && a.x === b.x;
    ok(s0 && /^[0-9a-f]{16}$/.test(s0.b) && /^[0-9a-f]{16}$/.test(s0.m), 'подпись: 16 знаков');
    ok(same(s0, sg(Object.assign({}, w0, { gt: 999, time: 20, played: 5, cloud: { on: true, ver: 7, dirty: true }, thumb: 'x', ents: [] }))), 'игровое время, время суток, отметки облака, картинка, мобы — не «поменялся»');
    const mv = sg(Object.assign({}, w0, { player: Object.assign({}, w0.player, { x: 1.9, yaw: 3 }) }));
    ok(same(s0, mv), 'шаг в той же клетке и поворот — не «поменялся»');
    const far = sg(Object.assign({}, w0, { player: Object.assign({}, w0.player, { x: 30.5 }) }));
    ok(far.b === s0.b && far.m === s0.m && far.x !== s0.x, 'ушёл далеко — только «при выходе» (x)');
    ok(sg(w0, [{ cx: 0, cz: 0, e: new Uint32Array([5 << 16 | 2]), t: [] }]).b !== s0.b, 'правка блока — поменялся (b)');
    ok(sg(Object.assign({}, w0, { player: Object.assign({}, w0.player, { inv: [{ id: 'torch', n: 4, d: 0 }] }) })).m !== s0.m, 'вещи — поменялся (m)');
    const t1 = performance.now(), big2 = V.store.packRecs(world, recs); for (let i = 0; i < 5; i++) V.store.sig(world, big2); const msSig = (performance.now() - t1) / 5;
    console.log(`  подпись мира ${(big2.length / 1024).toFixed(0)} КБ: ${msSig.toFixed(1)} мс`);
    ok(msSig < 40, 'подпись — быстро', msSig);
  }

  sec('свой сервер вместо Supabase (setBackend): игры ничего не меняют');
  {
    const files2 = new Map(), calls = [];
    const own = { name: 'own', ready: () => true,
      async rpc(fn, a){ calls.push(fn); const f = { cloud_list: () => ({ ok: true, slots: 2, max_bytes: 2097152, used: 0, list: [] }), cloud_begin: () => ({ ok: true, path: UID + '/kubomir/' + a.p_world + '/1-own.kbw', ver: 0 }), cloud_commit: () => ({ ok: true, ver: 1, old: null }), cloud_delete: () => ({ ok: true, path: UID + '/kubomir/' + a.p_world + '/1-own.kbw' }) }[fn]; return f ? f() : { ok: false, reason: 'off' }; },
      async upload(p, u8){ files2.set(p, u8); }, async download(p){ const f = files2.get(p); if (!f) throw new Error('нет файла'); return f; },
      async remove(ps){ for (const p of ps) files2.delete(p); }, async list(dir){ return [...files2.keys()].filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)); } };
    let bad = false; try { C.setBackend({ rpc(){} }); } catch (e) { bad = true; }
    ok(bad, 'неполный бэкенд — отказ');
    C.setBackend(own);
    const n0 = SB.calls.length;
    const rr = await C.put('kubomir', 'wo', { name: 'own', data: new Uint8Array([9, 8, 7]), gt: 1 });
    const back2 = rr.ok ? await C.get('kubomir', { path: rr.path }) : null;
    ok(rr.ok && files2.size === 1 && back2 && back2.length === 3 && back2[2] === 7 && SB.calls.length === n0 && calls.join() === 'cloud_begin,cloud_commit', 'свой сервер: место → файл → готово, скачать — байт в байт, Supabase не трогали', { rr, calls });
    ok(C.backend() === 'own', 'видно, какой бэкенд');
    C.setBackend(null);
    ok(C.backend() === 'supabase', 'setBackend(null) — снова Supabase');
  }

  sec('сколько весит мир после игры (настоящий генератор, «Кубомир»)');
  await sizes();

  sec('без входа');
  const ctx2 = load(['js/core/cloud.js'], { sbClient: SB.client, currentUser: null });
  ok(!ctx2.D37Cloud.available() && (await ctx2.D37Cloud.list('kubomir')).reason === 'auth', 'не вошёл — облака нет (auth)');
  const ctx3 = load(['js/core/cloud.js'], { sbClient: { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.cloud_list' } }) }, currentUser: { id: UID } });
  ok((await ctx3.D37Cloud.list('kubomir')).reason === 'off', 'SQL ещё не применён (PGRST202) — off');

  console.log(`\ncloud-test: ${pass} ok, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);

  // ── игра «на глаз» за час (занятой игрок «Выживания»; оценка сверху): строит дом и пристройки (≈ 400 блоков: пол, стены, окна,
  // крыша, верстак, печь, сундук с вещами, факелы), ровняет площадку (≈ 300), копает лестницу вниз и ходы 2×1 под землёй (≈ 1100
  // блоков, факел каждые 8 шагов), рубит 20 деревьев (в «Кубомире» дерево падает целиком — ствол и листва), гуляет и рвёт траву
  // и цветы (≈ 150). Каждый следующий час — дальше от дома (новые чанки), дом растёт. Сжатие — то же, что в браузере (gzip). ──
  async function sizes(){
    const g = load(['js/engine/voxel.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-store.js', 'js/core/cloud.js'], { sbClient: SB.client, currentUser: { id: UID } });
    const V2 = g.D37E.vox, ID = V2.ID, C2 = g.D37Cloud;
    const run = async (hours, seed) => {
      const G = V2.genInit(seed, { ver: 2 }), W = new V2.World({ seed });
      const ensure = (x, z) => { const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4; let c = W.chunk(cx, cz); if (!c) { c = new V2.Chunk(cx, cz, V2.genChunk(G, cx, cz).ids); W.add(c); } return c; };
      const get = (x, y, z) => { ensure(x, z); return W.get(x, y, z); };
      const T = { brk: 0, put: 0, trees: 0, torch: 0, tiles: 0 };
      const brk = (x, y, z) => { ensure(x, z); if (y > 0 && W.get(x, y, z) > 0 && W.set(x, y, z, 0)) T.brk++; };
      const put = (x, y, z, id, s = 0) => { ensure(x, z); if (W.set(x, y, z, V2.cell(id, s))) T.put++; };
      const top = (x, z) => { ensure(x, z); return W.heightAt(x, z); };
      let rs = 12345; const rnd = () => (rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296;
      const sp = V2.findSpawn(G, 0, 0), bx = Math.floor(sp.x), bz = Math.floor(sp.z);
      const stack = () => ({ id: ['cobble', 'dirt', 'planks_oak', 'log_oak', 'torch', 'sand', 'glass', 'coal'][Math.floor(rnd() * 8)], n: 1 + Math.floor(rnd() * 64), d: 0 });
      const chest = (x, y, z) => { put(x, y, z, ID.chest); const t = W.tile(x, y, z, () => ({ items: new Array(27).fill(null) })); for (let i = 0; i < 27; i++) if (rnd() < .5) t.items[i] = stack(); T.tiles++; };
      for (let h = 0; h < hours; h++) {
        // дом (пристройка) у дома: площадка 9×9 ровно (лишнее снять, ямы засыпать), пол, стены 4 в высоту, окна, крыша ступенями
        const hx = bx + 3 + (h % 3) * 11, hz = bz + 3 + Math.floor(h / 3) * 11, gy = top(hx + 4, hz + 4);
        for (let x = hx - 2; x < hx + 11; x++) for (let z = hz - 2; z < hz + 11; z++) { for (let y = gy; y < gy + 6; y++) if (get(x, y, z) > 0) brk(x, y, z); for (let y = gy - 3; y < gy; y++) if (get(x, y, z) === 0 || get(x, y, z) === ID.water) put(x, y, z, ID.dirt); }
        for (let x = hx; x < hx + 9; x++) for (let z = hz; z < hz + 9; z++) put(x, gy - 1, z, ID.planks_oak);
        for (let y = gy; y < gy + 4; y++) for (let x = hx; x < hx + 9; x++) for (let z = hz; z < hz + 9; z++) {
          const edge = x === hx || x === hx + 8 || z === hz || z === hz + 8; if (!edge) continue;
          const win = y === gy + 2 && ((x - hx) % 3 === 1 || (z - hz) % 3 === 1) && !(x === hx + 4 && z === hz);
          if (x === hx + 4 && z === hz && y < gy + 2) continue;   // дверной проём
          put(x, y, z, win ? ID.glass : (x === hx || x === hx + 8) && (z === hz || z === hz + 8) ? ID.log_oak : ID.cobble);
        }
        for (let k = 0; k < 4; k++) for (let x = hx + k; x < hx + 9 - k; x++) for (let z = hz + k; z < hz + 9 - k; z++) if (k === 3 || x === hx + k || x === hx + 8 - k || z === hz + k || z === hz + 8 - k) put(x, gy + 4 + k, z, ID.planks_spruce);
        put(hx + 4, gy, hz, ID.door_oak); put(hx + 4, gy + 1, hz, ID.door_oak, 8);
        put(hx + 1, gy, hz + 7, ID.crafting_table); put(hx + 2, gy, hz + 7, ID.furnace); T.tiles++; chest(hx + 7, gy, hz + 7);
        for (const [x, z] of [[hx + 1, hz + 1], [hx + 7, hz + 1], [hx + 1, hz + 5], [hx + 7, hz + 5]]) { put(x, gy, z, ID.torch); T.torch++; }
        // шахта: лестница вниз до y 16 и 4 хода по ~70 шагов (2×1), факел каждые 8 шагов
        let mx = bx - 6 - h * 5, mz = bz - 8 - h * 3, my = top(mx, mz);
        while (my > 17) { brk(mx, my, mz); brk(mx, my + 1, mz); brk(mx, my + 2, mz); mx++; my--; if ((mx & 7) === 0) { put(mx, my, mz + 1, ID.torch); T.torch++; } }
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { let x = mx, z = mz; for (let i = 0; i < 70; i++) { x += dx; z += dz; brk(x, my, z); brk(x, my + 1, z); if (i % 8 === 4) { put(x, my, z, ID.torch); T.torch++; } } }
        // деревья вокруг (дальше с каждым часом): ствол и листва целиком
        const R = 20 + h * 28;
        for (let n = 0, tries = 0; n < 20 && tries < 40000; tries++) {
          const a = rnd() * 6.283, d = R * (.3 + rnd() * 1.6), x = Math.floor(bx + Math.cos(a) * d), z = Math.floor(bz + Math.sin(a) * d), y0 = top(x, z);
          let lg = -1; for (let y = y0; y > y0 - 9 && y > 0; y--) { const t = get(x, y, z); if (t === ID.log_oak || t === ID.log_birch || t === ID.log_spruce) { lg = y; break; } }
          if (lg < 0) continue;
          const seen = new Set(), q = [[x, lg, z]], logs = [];
          while (q.length && seen.size < 400) { const [cx2, cy, cz2] = q.pop(), k = cx2 + ',' + cy + ',' + cz2; if (seen.has(k)) continue; seen.add(k); const t = get(cx2, cy, cz2); if (t === ID.log_oak || t === ID.log_birch || t === ID.log_spruce) { logs.push([cx2, cy, cz2]); for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) q.push([cx2 + ax, cy + ay, cz2 + az]); } }
          for (const [lx, ly, lz] of logs) for (let ax = -3; ax <= 3; ax++) for (let ay = -2; ay <= 3; ay++) for (let az = -3; az <= 3; az++) { const t = get(lx + ax, ly + ay, lz + az); if (t === ID.leaves_oak || t === ID.leaves_birch || t === ID.leaves_spruce) brk(lx + ax, ly + ay, lz + az); }
          for (const [lx, ly, lz] of logs) brk(lx, ly, lz);
          n++; T.trees++;
        }
        // гуляет: трава, цветы, немного земли и песка по пути
        for (let n = 0; n < 150; n++) { const a = rnd() * 6.283, d = R * rnd(), x = Math.floor(bx + Math.cos(a) * d), z = Math.floor(bz + Math.sin(a) * d), y = top(x, z); brk(x, y, z); if (rnd() < .3) brk(x, y - 1, z); }
      }
      const recs = []; for (const c of W.chunks.values()) if (c.edits || c.tiles) recs.push({ cx: c.cx, cz: c.cz, e: V2.store.packEdits(c.edits || new Map()), t: c.tiles ? [...c.tiles] : [] });
      const inv = new Array(36).fill(null).map((s, i) => i < 24 ? stack() : null);
      const ents = new Array(25).fill(0).map(() => ({ k: rnd() < .5 ? 'mob' : 'item', type: 'zombie', x: bx + rnd() * 40, y: 70, z: bz + rnd() * 40, hp: 20, s: stack() }));
      const meta = { id: 'wsim', name: 'Мой мир', seed, mode: 'survival', diff: 'easy', created: 1, played: 2, time: 13.5, mods: [], palette: V2.blocks.map(b => b.name), v: 1, genVer: 2, gt: hours * 3600, day: hours * 3,
        player: { x: bx + .5, y: 70, z: bz + .5, yaw: 1, pitch: 0, hp: 20, food: 17, sat: 3, sel: 2, fly: false, inv, off: null }, ents, spawn: { x: bx, y: 70, z: bz }, ach: { wood: 1, table: 1, pick: 1, stone: 1, iron: 1, night: 1 }, placed: T.put };
      const raw = V2.store.packRecs(meta, recs), gz = await C2.gzip(raw);
      return { hours, chunks: recs.length, edits: recs.reduce((s, r) => s + r.e.length, 0), raw: raw.length, gz: gz.length, ...T };
    };
    const kb = n => (n / 1024).toFixed(1).replace('.', ',') + ' КБ';
    const out = [];
    for (const hours of [1, 5]) for (const seed of ['облако37', 'сид-2']) { const r = await run(hours, seed); out.push(r); console.log(`  ${hours} ч (${seed}): ${r.chunks} чанков, ${r.edits} правок (сломал ${r.brk}, поставил ${r.put}, деревьев ${r.trees}, факелов ${r.torch}, сундуков/печей ${r.tiles}) → ${kb(r.raw)} → сжато ${kb(r.gz)}`); }
    const h1 = Math.max(...out.filter(r => r.hours === 1).map(r => r.gz)), h5 = Math.max(...out.filter(r => r.hours === 5).map(r => r.gz));
    ok(h1 < 200 * 1024 && h5 < 512 * 1024, `мир после 1 ч — ${kb(h1)}, после 5 ч — ${kb(h5)}: на 2 МБ хватает с запасом (до ${Math.floor(2097152 / h5 * 5)} ч такой игры)`, out);
    // мир из Minecraft (импорт области: «основа» каждого чанка + правки) — бывает больше: ему нужно место VIP или только браузер
    const G = V2.genInit('mc', { ver: 2 }), recsMc = [];
    for (let i = 0; i < 64; i++) { const ids = V2.genChunk(G, i % 8, i >> 3).ids, b = []; let cur = ids[0], n = 0; for (let k = 0; k < ids.length; k++) { if (ids[k] === cur && n < 65535) n++; else { b.push(n, cur); cur = ids[k]; n = 1; } } b.push(n, cur); recsMc.push({ cx: i % 8, cz: i >> 3, e: new Uint32Array(0), t: [], b: new Uint16Array(b) }); }
    const rawMc = V2.store.packRecs({ id: 'mc', name: 'из Minecraft', seed: 'mc' }, recsMc), gzMc = await C2.gzip(rawMc);
    console.log(`  мир из Minecraft, 64 чанка «основой»: ${kb(rawMc.length)} → сжато ${kb(gzMc.length)} (≈ ${kb(gzMc.length / 64)} на чанк: область 32×32 — ≈ ${(gzMc.length * 16 / 1048576).toFixed(1).replace('.', ',')} МБ)`);
    ok(gzMc.length < 2097152, 'мир из Minecraft на 64 чанка — в облако помещается');
    // хранилище сайта: сколько людей уместится при 800 МБ
    console.log(`  800 МБ: ≈ ${Math.floor(800 * 1048576 / (2 * h5))} человек с двумя мирами по 5 ч игры · все 2 мира по 2 МБ — ${Math.floor(800 / 4)} человек`);
  }
})().catch(e => { console.error(e); process.exit(1); });
