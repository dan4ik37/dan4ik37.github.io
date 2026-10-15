// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — чтение файлов Minecraft (для переноса в «Кубомир»): NBT (Java — big-endian, Bedrock — little-endian),
//  gzip / zlib / raw deflate, zip (в т. ч. ZIP64), упакованные long-массивы блоков
// ═══════════════════════════════════════
// Только форматы файлов (совместимость): ни кода, ни картинок Mojang здесь нет. Работает в окне, в потоке (mc-worker.js) и в node.
// MC.inflate(u8, 'gzip' | 'deflate' | 'deflate-raw') → Promise<Uint8Array>; MC.unpack(u8) — сам узнаёт gzip/zlib/без сжатия.
// MC.nbt(u8, { le }) → { name, value }: compound — объект без прототипа, list — массив, byte/int-массивы — Int8Array/Int32Array,
// long-массив — { longs: Uint32Array [hi, lo, hi, lo…] }, long — число (точно до 2^53). MC.bits(longs, bits, n, spanning) — индексы
// палитры из long-массива (Java: до 1.16 «через границу long», с 1.16 — нет). MC.unzip(u8, filter) → { путь: Uint8Array }.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const MC = E.mc = E.mc || {};

  // ═══ Сжатие ═══
  async function viaStream(u8, kind, max){
    const ds = new DecompressionStream(kind);
    const rd = new Blob([u8]).stream().pipeThrough(ds).getReader(), parts = [];
    let len = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      len += value.length; if (len > max) { try { await rd.cancel(); } catch (e) {} throw new Error('распакованный файл слишком большой'); }
      parts.push(value);
    }
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  MC.inflate = async (u8, kind = 'gzip', max = 512e6) => {
    if (typeof DecompressionStream !== 'undefined') {
      try { return await viaStream(u8, kind, max); }
      catch (e) { if (kind === 'deflate' || kind === 'gzip') throw e; throw e; }
    }
    if (typeof require === 'function') {   // node (проверки)
      const z = require('zlib');
      return new Uint8Array(kind === 'gzip' ? z.gunzipSync(u8) : kind === 'deflate' ? z.inflateSync(u8) : z.inflateRawSync(u8));
    }
    throw new Error('браузер не умеет распаковывать (нужен Chrome, Edge, Firefox или Safari посвежее)');
  };
  // gzip (1f 8b) / zlib (78 xx) / как есть
  MC.unpack = u8 => {
    if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) return MC.inflate(u8, 'gzip');
    if (u8.length > 2 && u8[0] === 0x78 && ((u8[0] << 8) | u8[1]) % 31 === 0) return MC.inflate(u8, 'deflate');
    return Promise.resolve(u8);
  };

  // ═══ NBT ═══
  // теги: 0 End, 1 Byte, 2 Short, 3 Int, 4 Long, 5 Float, 6 Double, 7 ByteArray, 8 String, 9 List, 10 Compound, 11 IntArray, 12 LongArray
  const TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  MC.nbt = (u8, o = {}) => {
    const le = !!o.le, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), N = u8.length;
    let p = o.offset | 0, nodes = 0;
    const need = n => { if (p + n > N) throw new Error('NBT: файл обрывается'); };
    const i8 = () => { need(1); return dv.getInt8(p++); };
    const i16 = () => { need(2); const v = dv.getInt16(p, le); p += 2; return v; };
    const u16 = () => { need(2); const v = dv.getUint16(p, le); p += 2; return v; };
    const i32 = () => { need(4); const v = dv.getInt32(p, le); p += 4; return v; };
    const f32 = () => { need(4); const v = dv.getFloat32(p, le); p += 4; return v; };
    const f64 = () => { need(8); const v = dv.getFloat64(p, le); p += 8; return v; };
    const i64 = () => { need(8); const hi = le ? dv.getInt32(p + 4, true) : dv.getInt32(p), lo = le ? dv.getUint32(p, true) : dv.getUint32(p + 4); p += 8; return hi * 4294967296 + lo; };
    const str = () => { const n = u16(); need(n); const s = TD ? TD.decode(u8.subarray(p, p + n)) : String.fromCharCode(...u8.subarray(p, p + n)); p += n; return s; };
    function val(t, depth){
      if (++nodes > 5e7) throw new Error('NBT: слишком много данных');
      if (depth > 512) throw new Error('NBT: слишком глубоко');
      switch (t) {
        case 1: return i8();
        case 2: return i16();
        case 3: return i32();
        case 4: return i64();
        case 5: return f32();
        case 6: return f64();
        case 7: { const n = i32(); if (n < 0) throw new Error('NBT: длина < 0'); need(n); const a = new Int8Array(u8.buffer.slice(u8.byteOffset + p, u8.byteOffset + p + n)); p += n; return a; }
        case 8: return str();
        case 9: {
          const et = i8(), n = i32(); if (n < 0 || n > 1e8) throw new Error('NBT: список испорчен');
          const a = new Array(n);
          for (let i = 0; i < n; i++) a[i] = val(et, depth + 1);
          return a;
        }
        case 10: {
          const obj = Object.create(null);
          for (;;) { const ct = i8(); if (ct === 0) break; const k = str(); obj[k] = val(ct, depth + 1); }
          return obj;
        }
        case 11: { const n = i32(); if (n < 0) throw new Error('NBT: длина < 0'); need(n * 4); const a = new Int32Array(n); for (let i = 0; i < n; i++) { a[i] = dv.getInt32(p, le); p += 4; } return a; }
        case 12: {
          const n = i32(); if (n < 0) throw new Error('NBT: длина < 0'); need(n * 8);
          const a = new Uint32Array(n * 2);   // [hi, lo] на каждый long
          for (let i = 0; i < n; i++) { if (le) { a[i * 2 + 1] = dv.getUint32(p, true); a[i * 2] = dv.getUint32(p + 4, true); } else { a[i * 2] = dv.getUint32(p); a[i * 2 + 1] = dv.getUint32(p + 4); } p += 8; }
          return { longs: a };
        }
        default: throw new Error('NBT: неизвестный тег ' + t);
      }
    }
    const t = i8();
    if (t !== 10) throw new Error('это не NBT (первый тег — ' + t + ')');
    const name = str(), value = val(10, 0);
    return { name, value, end: p };
  };
  // NBT Bedrock: level.dat — 8 байт заголовка (версия, длина), .mcstructure — сразу NBT
  MC.nbtLE = (u8, offset = 0) => MC.nbt(u8, { le: true, offset });

  // ═══ Упакованные индексы палитры ═══
  // longs — [hi, lo]…; bits — бит на блок; spanning — значение может переходить в следующий long (Java до 1.16, litematic)
  MC.bits = (L, bits, n, spanning) => {
    const out = n <= 65536 ? new Uint16Array(n) : new Uint32Array(n), mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1, cnt = L.length / 2;
    const bitAt = (i, sh, w) => {   // w бит из long i начиная с бита sh (0 — младший)
      const hi = L[i * 2] >>> 0, lo = L[i * 2 + 1] >>> 0;
      if (sh >= 32) return (hi >>> (sh - 32)) & ((1 << w) - 1 >>> 0);
      if (sh + w <= 32) return (lo >>> sh) & (w >= 32 ? 0xffffffff : (1 << w) - 1);
      const loPart = lo >>> sh, loBits = 32 - sh;
      return (loPart | (hi << loBits)) & (w >= 32 ? 0xffffffff : (1 << w) - 1);
    };
    if (!spanning) {
      const per = Math.floor(64 / bits);
      for (let i = 0; i < n; i++) { const li = Math.floor(i / per); if (li >= cnt) break; out[i] = bitAt(li, (i % per) * bits, bits) & mask; }
    } else {
      for (let i = 0; i < n; i++) {
        const b0 = i * bits, li = Math.floor(b0 / 64), sh = b0 % 64; if (li >= cnt) break;
        if (sh + bits <= 64) out[i] = bitAt(li, sh, bits) & mask;
        else { const w1 = 64 - sh, a = bitAt(li, sh, w1), b = li + 1 < cnt ? bitAt(li + 1, 0, bits - w1) : 0; out[i] = (a | (b << w1)) & mask; }
      }
    }
    return out;
  };
  // varint-массив (.schem BlockData)
  MC.varints = (u8, n) => {
    const out = n <= 65536 * 4 ? new Uint32Array(n) : new Uint32Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      let v = 0, sh = 0, b;
      do { if (p >= u8.length) return out; b = u8[p++] & 255; v |= (b & 127) << sh; sh += 7; } while (b & 128 && sh < 35);
      out[i] = v >>> 0;
    }
    return out;
  };

  // ═══ Zip: чтение (без сжатия и deflate, ZIP64), filter(path, size) → брать ли файл ═══
  MC.unzip = async (u8, filter, o = {}) => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), N = u8.length;
    let eocd = -1;
    for (let i = N - 22; i >= Math.max(0, N - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('это не zip-архив (или он испорчен)');
    let count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    // ZIP64
    if ((count === 0xffff || cdOff === 0xffffffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(eocd - 12, true));
      if (dv.getUint32(z64, true) === 0x06064b50) { count = Number(dv.getBigUint64(z64 + 32, true)); cdOff = Number(dv.getBigUint64(z64 + 48, true)); }
    }
    if (count > 200000) throw new Error('в архиве слишком много файлов');
    const out = {}, td = TD || { decode: b => String.fromCharCode(...b) };
    let p = cdOff, total = 0;
    for (let k = 0; k < count; k++) {
      if (p + 46 > N || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: оглавление испорчено');
      const method = dv.getUint16(p + 10, true), flags = dv.getUint16(p + 8, true);
      let csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
      // ZIP64: настоящие размеры — в доп. поле 0x0001
      if (csz === 0xffffffff || usz === 0xffffffff || lho === 0xffffffff) {
        let q = p + 46 + nl; const qe = q + xl;
        while (q + 4 <= qe) {
          const id = dv.getUint16(q, true), sz = dv.getUint16(q + 2, true);
          if (id === 1) { let r = q + 4; if (usz === 0xffffffff) { usz = Number(dv.getBigUint64(r, true)); r += 8; } if (csz === 0xffffffff) { csz = Number(dv.getBigUint64(r, true)); r += 8; } if (lho === 0xffffffff) { lho = Number(dv.getBigUint64(r, true)); } break; }
          q += 4 + sz;
        }
      }
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || (flags & 1)) continue;   // папка или шифрованный
      if (name.includes('..') || name.startsWith('/')) continue;
      if (filter && !filter(name, usz)) continue;
      if (lho + 30 > N || dv.getUint32(lho, true) !== 0x04034b50) continue;
      const dOff = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = u8.subarray(dOff, dOff + csz);
      total += usz; if (total > (o.max || 1.5e9)) throw new Error('архив слишком большой');
      if (method === 0) out[name] = data.slice();
      else if (method === 8) out[name] = await MC.inflate(data, 'deflate-raw', Math.max(usz * 1.1, 1024) + 1024);
      else continue;   // другое сжатие — пропустить
      o.progress?.(k / count);
    }
    return out;
  };

  // ═══ Мелочи ═══
  // «minecraft:oak_log[axis=y]» ↔ { name: 'oak_log', ns: 'minecraft', props: { axis: 'y' } }
  MC.parseState = s => {
    s = String(s || '');
    const b = s.indexOf('['), nm = (b >= 0 ? s.slice(0, b) : s).trim(), props = Object.create(null);
    if (b >= 0) for (const kv of s.slice(b + 1, s.lastIndexOf(']')).split(',')) { const e = kv.indexOf('='); if (e > 0) props[kv.slice(0, e).trim()] = kv.slice(e + 1).trim(); }
    const c = nm.indexOf(':');
    return { ns: c >= 0 ? nm.slice(0, c) : 'minecraft', name: c >= 0 ? nm.slice(c + 1) : nm, props };
  };
  MC.stateStr = (name, props) => {
    const ks = props ? Object.keys(props).filter(k => props[k] != null).sort() : [];
    return (name.includes(':') ? name : 'minecraft:' + name) + (ks.length ? '[' + ks.map(k => k + '=' + String(props[k])).join(',') + ']' : '');
  };
})();
