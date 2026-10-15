// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — постройки и миры Minecraft → «сырые» блоки (имена Minecraft): .schem, .schematic, .litematic, .mcstructure,
//  регионы Java (.mca, папка мира в .zip), миры Bedrock (.mcworld — LevelDB, «как получится»)
// ═══════════════════════════════════════
// Постройка: { kind: 'build', w, h, l, palette: ['minecraft:stone', …], idx (номер в палитре; порядок x + w × (z + l × y)),
// hole — номер «пусто» (не трогать: structure_void, вне области) или −1, bedrock (имена Bedrock), notes: [] }.
// Мир: { kind: 'world', chunks: Map 'cx|cz' → { cx, cz, palette, idx (16 × 16 × h: x + 16 × (z + 16 × y)) }, yMin, h, spawn, notes }.
// Чтение — MC.read(файлы, { area, yMin, h, progress }) сам узнаёт формат по имени и содержимому. Тяжёлое — в потоке (mc-worker.js).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const MC = E.mc = E.mc || {};
  const MAXV = 24e6;   // постройка: не больше ~24 млн клеток (≈ 300 × 256 × 300)

  const ci = o => { const r = Object.create(null); for (const k in o || {}) r[k.toLowerCase()] = o[k]; return r; };   // ключи без регистра (Width/width)
  const nbtStr = (name, props) => MC.stateStr(String(name), props ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === 'object' ? String(v) : String(v)])) : null);

  // ═══ .schem (Sponge Schematic v1, v2, v3 — WorldEdit, FAWE, Amulet) ═══
  MC.readSchem = (root0) => {
    let r = root0;
    if (r.Schematic && typeof r.Schematic === 'object') r = r.Schematic;   // v3: { Schematic: { … } }
    const R = ci(r), w = R.width | 0, h = R.height | 0, l = R.length | 0;
    if (!(w > 0 && h > 0 && l > 0)) throw new Error('.schem: нет размеров');
    if (w * h * l > MAXV) throw new Error(`постройка слишком большая (${w}×${h}×${l})`);
    const B = R.blocks && typeof R.blocks === 'object' && !ArrayBuffer.isView(R.blocks) ? ci(R.blocks) : null;   // v3
    const pal = (B ? B.palette : R.palette) || {}, data = B ? B.data : R.blockdata;
    if (!data) throw new Error('.schem: нет BlockData');
    const palette = []; for (const [k, v] of Object.entries(pal)) palette[v | 0] = k;
    for (let i = 0; i < palette.length; i++) if (palette[i] == null) palette[i] = 'minecraft:air';
    const idx = MC.varints(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w * h * l);
    const hole = palette.indexOf('minecraft:structure_void');
    return { kind: 'build', w, h, l, palette, idx, hole, notes: [], version: R.version | 0 };
  };

  // ═══ .schematic (MCEdit, старые числовые id) ═══
  MC.readSchematic = (r) => {
    const R = ci(r), w = R.width | 0, h = R.height | 0, l = R.length | 0;
    if (!(w > 0 && h > 0 && l > 0) || !R.blocks) throw new Error('.schematic: нет Width/Height/Length/Blocks');
    if (w * h * l > MAXV) throw new Error(`постройка слишком большая (${w}×${h}×${l})`);
    if (R.materials && R.materials !== 'Alpha') throw new Error('.schematic «' + R.materials + '» (нужен «Alpha» — Java)');
    const n = w * h * l, blocks = R.blocks, data = R.data, add = R.addblocks;
    const palette = [], map = new Map(), idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let id = blocks[i] & 255;
      if (add) id |= ((i & 1 ? add[i >> 1] >> 4 : add[i >> 1]) & 15) << 8;
      const d = data ? data[i] & 15 : 0, key = id * 16 + d;
      let k = map.get(key);
      if (k === undefined) { const s = MC.legacy(id, d); k = palette.length; palette.push(nbtStr(s.name, s.props)); map.set(key, k); }
      idx[i] = k;
    }
    return { kind: 'build', w, h, l, palette, idx, hole: -1, notes: [] };
  };

  // ═══ .litematic (Litematica): регионы с позицией и размером (бывает отрицательный) ═══
  MC.readLitematic = (r) => {
    const regs = r.Regions; if (!regs) throw new Error('.litematic: нет Regions');
    const parts = [];
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (const [name, g] of Object.entries(regs)) {
      const P = g.Position || {}, Sz = g.Size || {};
      const sx = Sz.x | 0, sy = Sz.y | 0, sz = Sz.z | 0;
      const ax = Math.abs(sx), ay = Math.abs(sy), az = Math.abs(sz);
      if (!ax || !ay || !az) continue;
      const ox = (P.x | 0) + (sx < 0 ? sx + 1 : 0), oy = (P.y | 0) + (sy < 0 ? sy + 1 : 0), oz = (P.z | 0) + (sz < 0 ? sz + 1 : 0);
      parts.push({ name, g, ax, ay, az, ox, oy, oz });
      x0 = Math.min(x0, ox); y0 = Math.min(y0, oy); z0 = Math.min(z0, oz); x1 = Math.max(x1, ox + ax); y1 = Math.max(y1, oy + ay); z1 = Math.max(z1, oz + az);
    }
    if (!parts.length) throw new Error('.litematic: пустой');
    const w = x1 - x0, h = y1 - y0, l = z1 - z0;
    if (w * h * l > MAXV) throw new Error(`постройка слишком большая (${w}×${h}×${l})`);
    const palette = ['minecraft:structure_void'], key = new Map([['minecraft:structure_void', 0]]);
    const idx = new Uint32Array(w * h * l);   // 0 — пусто (между регионами)
    for (const p of parts) {
      const pal = (p.g.BlockStatePalette || []).map(e => nbtStr(e.Name, e.Properties));
      const map = pal.map(s => { let k = key.get(s); if (k === undefined) { k = palette.length; palette.push(s); key.set(s, k); } return k; });
      const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, pal.length))));
      const n = p.ax * p.ay * p.az, L = p.g.BlockStates?.longs;
      if (!L) continue;
      const raw = MC.bits(L, bits, n, true);
      for (let y = 0; y < p.ay; y++) for (let z = 0; z < p.az; z++) for (let x = 0; x < p.ax; x++) {
        const v = raw[(y * p.az + z) * p.ax + x];
        const gx = p.ox - x0 + x, gy = p.oy - y0 + y, gz = p.oz - z0 + z;
        idx[(gy * l + gz) * w + gx] = map[v] ?? 0;
      }
    }
    return { kind: 'build', w, h, l, palette, idx, hole: 0, notes: [], name: r.Metadata?.Name || '' };
  };

  // ═══ .mcstructure (Bedrock, little-endian NBT): индексы — z быстрее всех, потом y, потом x ═══
  MC.readMcstructure = (r) => {
    const sz = r.size, S = r.structure;
    if (!Array.isArray(sz) || sz.length !== 3 || !S) throw new Error('.mcstructure: нет size/structure');
    const [w, h, l] = sz.map(v => v | 0);
    if (w * h * l > MAXV) throw new Error(`постройка слишком большая (${w}×${h}×${l})`);
    const layers = S.block_indices || [], L0 = layers[0] || [], L1 = layers[1] || [];
    const bp = S.palette?.default?.block_palette || [];
    const palette = bp.map(e => nbtStr(e.name, e.states));
    const isWater = k => k >= 0 && /^minecraft:(flowing_)?water(\[|$)/.test(palette[k] || '');
    const hole = palette.length; palette.push('minecraft:structure_void');
    const idx = new Uint32Array(w * h * l);
    let i = 0;
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < l; z++, i++) {
      let v = L0[i] ?? -1;
      if ((v < 0 || /^minecraft:air(\[|$)/.test(palette[v])) && isWater(L1[i] ?? -1)) v = L1[i];   // вода второго слоя (под водой)
      idx[(y * l + z) * w + x] = v < 0 ? hole : v;
    }
    return { kind: 'build', w, h, l, palette, idx, hole, notes: [], bedrock: true };
  };

  // ═══ Регион Java (.mca): чанки 32 × 32; area — { x0, z0, x1, z1 } в блоках (включительно), yMin, h — окно по высоте ═══
  async function chunkNbt(u8, i){
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const e = dv.getUint32(i * 4), off = (e >>> 8) * 4096, cnt = e & 255;
    if (!off || !cnt || off + 5 > u8.length) return null;
    const len = dv.getUint32(off), type = u8[off + 4];
    if (len < 1 || off + 4 + len > u8.length) return null;
    if (type & 128) return { error: 'чанк вынесен в отдельный файл (.mcc)' };
    const data = u8.subarray(off + 5, off + 4 + len);
    let raw;
    if (type === 1) raw = await MC.inflate(data, 'gzip');
    else if (type === 2) raw = await MC.inflate(data, 'deflate');
    else if (type === 3) raw = data;
    else return { error: 'сжатие LZ4 (тип ' + type + ') — не поддерживается' };
    return MC.nbt(raw).value;
  }
  // разделы чанка → «сырые» блоки окна высоты
  function chunkBlocks(c, yMin, h){
    const dvn = c.DataVersion | 0, L = c.Level || c, palette = ['minecraft:air'], key = new Map([['minecraft:air', 0]]);
    const idx = new Uint16Array(16 * 16 * h);
    const pk = s => { let k = key.get(s); if (k === undefined) { k = palette.length; palette.push(s); key.set(s, k); } return k; };
    const secs = c.sections || L.Sections || L.sections || [];
    let any = false;
    for (const s of secs) {
      const sy = s.Y | 0, by = sy * 16;
      if (by + 16 <= yMin || by >= yMin + h) continue;
      let pal = null, data = null, legacy = null;
      if (s.block_states) { pal = s.block_states.palette; data = s.block_states.data?.longs || null; }
      else if (s.Palette) { pal = s.Palette; data = s.BlockStates?.longs || null; }
      else if (s.Blocks) legacy = s;
      let get;
      if (pal) {
        const m = pal.map(e => pk(nbtStr(e.Name, e.Properties)));
        if (!data) get = () => m[0];
        else { const bits = Math.max(4, Math.ceil(Math.log2(Math.max(2, pal.length)))), raw = MC.bits(data, bits, 4096, dvn > 0 && dvn < 2529); get = i => m[raw[i]] ?? 0; }
      } else if (legacy) {
        const B = legacy.Blocks, A = legacy.Add, D = legacy.Data, cache = new Map();
        get = i => {
          let id = B[i] & 255; if (A) id |= ((i & 1 ? A[i >> 1] >> 4 : A[i >> 1]) & 15) << 8;
          const d = D ? (i & 1 ? D[i >> 1] >> 4 : D[i >> 1]) & 15 : 0, kk = id * 16 + d;
          let v = cache.get(kk); if (v === undefined) { const t = MC.legacy(id, d); v = pk(nbtStr(t.name, t.props)); cache.set(kk, v); }
          return v;
        };
      } else continue;
      any = true;
      for (let y = 0; y < 16; y++) {
        const wy = by + y - yMin; if (wy < 0 || wy >= h) continue;
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) idx[(wy * 16 + z) * 16 + x] = get((y * 16 + z) * 16 + x);
      }
    }
    return any ? { palette, idx } : null;
  }
  MC.readRegion = async (u8, name, o = {}) => {
    if (u8.length < 8192) throw new Error('регион пустой или испорчен');
    const m = /r\.(-?\d+)\.(-?\d+)\.mca$/i.exec(name || ''), rx = m ? +m[1] : 0, rz = m ? +m[2] : 0;
    const out = o.out || new Map(), notes = o.notes || [], area = o.area, yMin = o.yMin ?? 11, h = o.h ?? 128;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let done = 0;
    for (let i = 0; i < 1024; i++) {
      if (!dv.getUint32(i * 4)) continue;
      const cx = rx * 32 + (i & 31), cz = rz * 32 + (i >> 5);
      if (area && (cx * 16 + 15 < area.x0 || cx * 16 > area.x1 || cz * 16 + 15 < area.z0 || cz * 16 > area.z1)) continue;
      if (o.listOnly) { out.set(cx + '|' + cz, { cx, cz }); continue; }
      try {
        const c = await chunkNbt(u8, i);
        if (!c) continue;
        if (c.error) { if (notes.length < 20) notes.push(`чанк ${cx}, ${cz}: ${c.error}`); continue; }
        const st = String(c.Status || c.Level?.Status || '');
        if (st && !/full|minecraft:full|postprocessed|fullchunk/.test(st)) continue;   // недостроенный край мира
        const b = chunkBlocks(c, yMin, h);
        if (b) out.set(cx + '|' + cz, Object.assign({ cx, cz }, b));
      } catch (e) { if (notes.length < 20) notes.push(`чанк ${cx}, ${cz}: ${e.message || e}`); }
      if ((++done & 7) === 0) o.progress?.(done);
    }
    return { kind: 'world', chunks: out, yMin, h, notes };
  };

  // ═══ Bedrock (.mcworld): LevelDB — журнал (.log) и таблицы (.ldb), сжатие zlib / raw deflate («как получится») ═══
  function varint(u8, p){ let v = 0, sh = 0, b; do { b = u8[p.o++]; v += (b & 127) * Math.pow(2, sh); sh += 7; } while (b & 128 && sh < 63); return v; }
  async function ldbBlock(u8, off, size){
    const type = u8[off + size], raw = u8.subarray(off, off + size);
    if (type === 0) return raw;
    if (type === 2) return MC.inflate(raw, 'deflate');
    if (type === 4) return MC.inflate(raw, 'deflate-raw');
    throw new Error('сжатие ' + type + ' (snappy) — не поддерживается');
  }
  function blockEntries(b, cb){
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), nr = dv.getUint32(b.length - 4, true), end = b.length - 4 - nr * 4;
    const p = { o: 0 }; let last = new Uint8Array(0);
    while (p.o < end) {
      const shared = varint(b, p), nsh = varint(b, p), vl = varint(b, p);
      const key = new Uint8Array(shared + nsh); key.set(last.subarray(0, shared)); key.set(b.subarray(p.o, p.o + nsh), shared); p.o += nsh;
      const val = b.subarray(p.o, p.o + vl); p.o += vl;
      last = key; cb(key, val);
    }
  }
  async function readLdb(u8, put){
    const N = u8.length; if (N < 48) return;
    const p = { o: N - 48 };
    const mo = varint(u8, p), ms = varint(u8, p), io = varint(u8, p), is = varint(u8, p); void mo; void ms;
    const idx = await ldbBlock(u8, io, is), handles = [];
    blockEntries(idx, (k, v) => { const q = { o: 0 }; handles.push([varint(v, q), varint(v, q)]); });
    for (const [o, s] of handles) {
      try {
        const b = await ldbBlock(u8, o, s);
        blockEntries(b, (k, v) => {
          if (k.length < 8) return;
          const t = k.length - 8; let seq = 0; for (let i = 7; i >= 1; i--) seq = seq * 256 + k[t + i];   // номер записи: новее — главнее
          put(k.subarray(0, t), k[t] === 1 ? v.slice() : null, seq);
        });
      } catch (e) { /* испорченный блок — пропустить */ }
    }
  }
  function readLog(u8, put){
    // записи по 32 КБ: crc 4, длина 2, тип 1 (1 целая, 2 начало, 3 середина, 4 конец) → пачки: seq 8, count 4, записи (тип, ключ, значение)
    let buf = [], p = 0;
    const batch = b => {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), q = { o: 12 }, n = dv.getUint32(8, true), seq0 = dv.getUint32(0, true) + dv.getUint32(4, true) * 4294967296;
      for (let i = 0; i < n && q.o < b.length; i++) {
        const t = b[q.o++], kl = varint(b, q), k = b.subarray(q.o, q.o + kl); q.o += kl;
        if (t === 1) { const vl = varint(b, q), v = b.subarray(q.o, q.o + vl); q.o += vl; put(k, v.slice(), seq0 + i); } else put(k, null, seq0 + i);
      }
    };
    while (p + 7 <= u8.length) {
      const blk = 32768 - (p % 32768); if (blk < 7) { p += blk; continue; }
      const len = u8[p + 4] | (u8[p + 5] << 8), type = u8[p + 6];
      if (!type && !len) { p += blk; continue; }
      const data = u8.subarray(p + 7, p + 7 + len); p += 7 + len;
      if (type === 1) batch(data);
      else if (type === 2) buf = [data];
      else if (type === 3) buf.push(data);
      else if (type === 4) { buf.push(data); const all = new Uint8Array(buf.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of buf) { all.set(x, o); o += x.length; } buf = []; try { batch(all); } catch (e) {} }
    }
  }
  // подчанк Bedrock (версии 8, 9): слои палитр; блоки — x × 256 + z × 16 + y
  function subchunk(v, notes){
    const ver = v[0];
    if (ver !== 8 && ver !== 9) { if (notes.length < 6) notes.push('старый формат подчанков Bedrock (' + ver + ') — пропущен'); return null; }
    let o = ver === 9 ? 3 : 2;
    const layers = Math.min(v[1], 2), out = [];
    for (let l = 0; l < layers; l++) {
      const head = v[o++], bpb = head >> 1;
      if (bpb === 0) {   // один блок на весь подчанк (длина палитры бывает записана, бывает — нет)
        if (v[o] !== 0x0a) o += 4;
        const r = MC.nbtLE(v, o); o = r.end; out.push({ pal: [r.value], get: () => 0 }); continue;
      }
      const per = Math.floor(32 / bpb), words = Math.ceil(4096 / per), dv = new DataView(v.buffer, v.byteOffset + o, words * 4);
      const raw = new Uint16Array(4096), mask = (1 << bpb) - 1;
      for (let i = 0; i < 4096; i++) { const w = dv.getUint32(Math.floor(i / per) * 4, true); raw[i] = (w >>> ((i % per) * bpb)) & mask; }
      o += words * 4;
      const pn = new DataView(v.buffer, v.byteOffset + o, 4).getInt32(0, true); o += 4;
      const pal = [];
      for (let k = 0; k < pn; k++) { const r = MC.nbtLE(v, o); o = r.end; pal.push(r.value); }
      out.push({ pal, get: i => raw[i] });
    }
    return out;
  }
  MC.readMcworld = async (files, o = {}) => {
    const notes = [], db = new Map(), seqs = new Map();
    // запись с бо́льшим номером — новее (журнал и таблицы читаются в любом порядке)
    const put = (k, v, seq) => {
      const s = Array.from(k, b => b.toString(16).padStart(2, '0')).join('');
      if ((seqs.get(s) ?? -1) > seq) return;
      seqs.set(s, seq);
      if (v) db.set(s, v); else db.delete(s);
    };
    const names = Object.keys(files);
    const ldb = names.filter(n => /(^|\/)db\/\d+\.ldb$/i.test(n)).sort(), logs = names.filter(n => /(^|\/)db\/\d+\.log$/i.test(n)).sort();
    if (!ldb.length && !logs.length) throw new Error('в .mcworld нет папки db (LevelDB)');
    let k = 0;
    for (const n of ldb) { try { await readLdb(files[n], put); } catch (e) { notes.push(n + ': ' + (e.message || e)); } o.progress?.(++k / (ldb.length + logs.length)); }
    for (const n of logs) { try { readLog(files[n], put); } catch (e) { notes.push(n + ': ' + (e.message || e)); } o.progress?.(++k / (ldb.length + logs.length)); }
    // точка появления — level.dat (8 байт заголовка)
    let spawn = null;
    const ld = names.find(n => /(^|\/)level\.dat$/i.test(n));
    if (ld) { try { const L = MC.nbtLE(files[ld], 8).value; spawn = { x: L.SpawnX | 0, y: L.SpawnY | 0, z: L.SpawnZ | 0 }; } catch (e) {} }
    // ключи подчанков: x(4) z(4) [измерение(4)] 0x2f y(1)
    const area = o.area, yMin = o.yMin ?? 11, h = o.h ?? 128, out = new Map();
    for (const [hex, v] of db) {
      const L = hex.length / 2; if (L !== 10) continue;   // только обычный мир (без номера измерения)
      if (parseInt(hex.slice(16, 18), 16) !== 0x2f) continue;
      const b = new Uint8Array(L); for (let i = 0; i < L; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      const dv = new DataView(b.buffer), cx = dv.getInt32(0, true), cz = dv.getInt32(4, true), sy = dv.getInt8(9);
      if (area && (cx * 16 + 15 < area.x0 || cx * 16 > area.x1 || cz * 16 + 15 < area.z0 || cz * 16 > area.z1)) continue;
      if (o.listOnly) { out.set(cx + '|' + cz, { cx, cz }); continue; }
      const by = sy * 16; if (by + 16 <= yMin || by >= yMin + h) continue;
      let sub; try { sub = subchunk(v, notes); } catch (e) { if (notes.length < 10) notes.push(`подчанк ${cx}, ${cz}, ${sy}: ${e.message || e}`); continue; }
      if (!sub || !sub.length) continue;
      let c = out.get(cx + '|' + cz);
      if (!c) { c = { cx, cz, palette: ['minecraft:air'], key: new Map([['minecraft:air', 0]]), idx: new Uint16Array(16 * 16 * h) }; out.set(cx + '|' + cz, c); }
      const maps = sub.map(s => s.pal.map(e => { const st = nbtStr(e.name, e.states); let q = c.key.get(st); if (q === undefined) { q = c.palette.length; c.palette.push(st); c.key.set(st, q); } return q; }));
      const water = c.key.get('minecraft:water');
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) {
        const wy = by + y - yMin; if (wy < 0 || wy >= h) continue;
        const i = (x << 8) | (z << 4) | y;
        let v0 = maps[0][sub[0].get(i)] ?? 0;
        if (v0 === 0 && sub[1] && water !== undefined) { const v1 = maps[1][sub[1].get(i)]; if (v1 === water) v0 = water; }
        c.idx[(wy * 16 + z) * 16 + x] = v0;
      }
    }
    for (const c of out.values()) delete c.key;
    return { kind: 'world', chunks: out, yMin, h, notes, spawn, bedrock: true };
  };

  // ═══ Узнать формат и прочитать ═══
  // files — { имя: Uint8Array } (один файл или распакованный zip)
  MC.sniff = (name, u8) => {
    const n = String(name || '').toLowerCase();
    if (/\.mca$/.test(n)) return 'region';
    if (/\.schem$/.test(n)) return 'schem';
    if (/\.schematic$/.test(n)) return 'schematic';
    if (/\.litematic$/.test(n)) return 'litematic';
    if (/\.mcstructure$/.test(n)) return 'mcstructure';
    if (/\.(mcworld)$/.test(n)) return 'mcworld';
    if (/\.(mcaddon|mcpack)$/.test(n)) return 'addon';
    if (/\.jar$/.test(n)) return 'jar';
    if (/\.nbt$/.test(n)) return 'structure';   // структура Java (структурный блок)
    if (u8 && u8[0] === 0x50 && u8[1] === 0x4b) return 'zip';
    return 'unknown';
  };
  // структура Java (.nbt, структурный блок): size, palette, blocks [{ pos, state }]
  MC.readStructureNbt = (r) => {
    const sz = r.size, pal = r.palette || r.palettes?.[0], blocks = r.blocks;
    if (!Array.isArray(sz) || !Array.isArray(pal) || !Array.isArray(blocks)) throw new Error('.nbt: это не структура');
    const [w, h, l] = sz.map(v => v | 0);
    if (w * h * l > MAXV) throw new Error(`постройка слишком большая (${w}×${h}×${l})`);
    const palette = pal.map(e => nbtStr(e.Name, e.Properties)), hole = palette.length;
    palette.push('minecraft:structure_void');
    const idx = new Uint32Array(w * h * l).fill(hole);
    for (const b of blocks) { const p = b.pos; if (!p) continue; const x = p[0] | 0, y = p[1] | 0, z = p[2] | 0; if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l) continue; idx[(y * l + z) * w + x] = b.state | 0; }
    return { kind: 'build', w, h, l, palette, idx, hole, notes: [] };
  };
  MC.readBuild = async (name, u8) => {
    const kind = MC.sniff(name, u8);
    const raw = kind === 'mcstructure' ? u8 : await MC.unpack(u8);
    if (kind === 'mcstructure') return MC.readMcstructure(MC.nbtLE(raw).value);
    const n = MC.nbt(raw).value;
    if (kind === 'litematic' || n.Regions) return MC.readLitematic(n);
    if (kind === 'schematic' || (n.Blocks && n.Materials)) return MC.readSchematic(n);
    if (kind === 'structure' || (n.palette && n.blocks)) return MC.readStructureNbt(n);
    return MC.readSchem(n);
  };
})();
