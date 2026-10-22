// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — сохранения «Кубомира»: IndexedDB «d37-kubomir» — миры, правки чанков, библиотека модов
// ═══════════════════════════════════════
// Мир по зерну генерируется заново, поэтому храним только ПРАВКИ игрока: чанк → Uint32Array пар (номер ячейки << 16 |
// значение) + «плитки» (сундуки, печи). Ключ чанка — «мир|область|cx|cz» (область — 32×32 чанка, как регионы): мир
// удаляется и выгружается одним диапазоном ключей. Значения — по «палитре» мира (номер → имя блока), так моды можно
// включать и выключать, не ломая сохранения. Закрыли вкладку — последние правки синхронно падают в localStorage
// (журнал), при следующем входе дописываются в базу. Нет IndexedDB (приватный режим) — память + журнал.
// S = V.store: worlds() / world(id) / putWorld(w) / delWorld(id) / chunkKeys(id) / chunk(id, cx, cz) / putChunks(id, [rec]) /
// mods() / putMod(m) / delMod(id) / journal(id, data) / takeJournal(id) / exportWorld(id) / importWorld(obj) / packEdits / unpackEdits.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const DB = 'd37-kubomir', VER = 1;
  let dbp = null, mem = null;
  const idb = () => root.indexedDB || null;
  function open(){
    if (dbp) return dbp;
    dbp = new Promise(res => {
      const I = idb();
      if (!I) { mem = mem || memStore(); res(null); return; }
      let rq;
      try { rq = I.open(DB, VER); } catch (e) { mem = mem || memStore(); res(null); return; }
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
        if (!d.objectStoreNames.contains('mods')) d.createObjectStore('mods', { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { mem = mem || memStore(); res(null); };
      rq.onblocked = () => {};
      setTimeout(() => { mem = mem || memStore(); res(null); }, 6000);   // база не ответила — работаем в памяти
    });
    return dbp;
  }
  function memStore(){ return { worlds: new Map(), chunks: new Map(), mods: new Map() }; }
  const reqP = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const txDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('отменено')); });
  async function st(name, mode = 'readonly'){ const d = await open(); if (!d) return null; return d.transaction(name, mode).objectStore(name); }

  const RG = 32;   // область — 32×32 чанка
  const ckey = (id, cx, cz) => `${id}|${Math.floor(cx / RG)},${Math.floor(cz / RG)}|${cx}|${cz}`;
  const S = V.store = {
    ready: () => open().then(d => !!d),
    persistent: () => !!(dbp && !mem),
    async worlds(){
      const s = await st('worlds');
      const list = s ? await reqP(s.getAll()) : [...mem.worlds.values()];
      return list.sort((a, b) => (b.played || 0) - (a.played || 0));
    },
    async world(id){ const s = await st('worlds'); return s ? (await reqP(s.get(id))) || null : mem.worlds.get(id) || null; },
    async putWorld(w){ const s = await st('worlds', 'readwrite'); if (s) await reqP(s.put(w)); else mem.worlds.set(w.id, w); return w; },
    async delWorld(id){
      const d = await open();
      if (!d) { mem.worlds.delete(id); for (const k of [...mem.chunks.keys()]) if (k.startsWith(id + '|')) mem.chunks.delete(k); return; }
      const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').delete(id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound(id + '|', id + '|￿'));
      await txDone(tx);
      try { root.localStorage?.removeItem('d37_kb_j_' + id); } catch (e) {}
    },
    // какие чанки мира сохранены: Set('cx|cz')
    async chunkKeys(id){
      const out = new Set();
      const d = await open();
      if (!d) { for (const k of mem.chunks.keys()) if (k.startsWith(id + '|')) { const p = k.split('|'); out.add(p[2] + '|' + p[3]); } return out; }
      const keys = await reqP(d.transaction('chunks').objectStore('chunks').getAllKeys(IDBKeyRange.bound(id + '|', id + '|￿')));
      for (const k of keys) { const p = String(k).split('|'); out.add(p[2] + '|' + p[3]); }
      return out;
    },
    async chunk(id, cx, cz){ const s = await st('chunks'); const k = ckey(id, cx, cz); return s ? (await reqP(s.get(k))) || null : mem.chunks.get(k) || null; },
    // recs: [{ cx, cz, e: Uint32Array, t: [[i, плитка]] }] — одной транзакцией
    async putChunks(id, recs){
      if (!recs.length) return;
      const d = await open();
      const empty = r => r.e && r.e.length === 0 && !(r.t && r.t.length) && !(r.b && r.b.length);   // b — «основа» чанка (мир из Minecraft)
      if (!d) { for (const r of recs) { if (empty(r)) mem.chunks.delete(ckey(id, r.cx, r.cz)); else mem.chunks.set(ckey(id, r.cx, r.cz), r); } return; }
      const tx = d.transaction('chunks', 'readwrite'), s = tx.objectStore('chunks');
      for (const r of recs) { if (empty(r)) s.delete(ckey(id, r.cx, r.cz)); else s.put(r, ckey(id, r.cx, r.cz)); }
      await txDone(tx);
    },
    async mods(){ const s = await st('mods'); return s ? await reqP(s.getAll()) : [...mem.mods.values()]; },
    async putMod(m){ const s = await st('mods', 'readwrite'); if (s) await reqP(s.put(m)); else mem.mods.set(m.id, m); return m; },
    async delMod(id){ const s = await st('mods', 'readwrite'); if (s) await reqP(s.delete(id)); else mem.mods.delete(id); },
    // ── журнал (localStorage, синхронно): закрыли вкладку — не потерять последние правки ──
    journal(id, data){
      try {
        const txt = JSON.stringify(data);
        if (txt.length > 1.5e6) return false;   // слишком много — успеет база
        root.localStorage.setItem('d37_kb_j_' + id, txt); return true;
      } catch (e) { return false; }
    },
    takeJournal(id){
      try { const t = root.localStorage.getItem('d37_kb_j_' + id); if (!t) return null; root.localStorage.removeItem('d37_kb_j_' + id); return JSON.parse(t); } catch (e) { return null; }
    },
    peekJournal(id){ try { return !!root.localStorage.getItem('d37_kb_j_' + id); } catch (e) { return false; } },
    clearJournal(id){ try { root.localStorage.removeItem('d37_kb_j_' + id); } catch (e) {} },
    // ── правки ↔ числа ──
    packEdits(map){ const a = new Uint32Array(map.size); let i = 0; for (const [k, v] of map) a[i++] = ((k & 0x7fff) << 16 | (v & 0xffff)) >>> 0; return a; },
    unpackEdits(a, out = new Map()){ for (let i = 0; i < a.length; i++) out.set(a[i] >>> 16, a[i] & 0xffff); return out; },
    b64(u8){ let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return root.btoa(s); },
    unb64(s){ const b = root.atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
    // ── файл мира: { format: 'kubomir', v, world, chunks: [{ cx, cz, e: base64, t }] } ──
    async exportWorld(id){
      const w = await S.world(id); if (!w) return null;
      const d = await open(), chunks = [];
      const push = r => chunks.push(Object.assign({ cx: r.cx, cz: r.cz, e: S.b64(new Uint8Array(r.e.buffer, r.e.byteOffset, r.e.byteLength)), t: r.t || [] }, r.b && r.b.length ? { b: S.b64(new Uint8Array(r.b.buffer, r.b.byteOffset, r.b.byteLength)) } : {}));
      if (!d) { for (const [k, r] of mem.chunks) if (k.startsWith(id + '|')) push(r); }
      else { const all = await reqP(d.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound(id + '|', id + '|￿'))); all.forEach(push); }
      return { format: 'kubomir', v: 1, exported: Date.now(), world: w, chunks };
    },
    // проверка файла и запись как новый мир → id
    async importWorld(obj, newId){
      if (!obj || obj.format !== 'kubomir' || !obj.world || !Array.isArray(obj.chunks)) throw new Error('это не файл мира «Кубомира»');
      if (obj.chunks.length > 200000) throw new Error('слишком большой мир');
      const w = Object.assign({}, obj.world);
      if (typeof w.name !== 'string' || !w.seed && w.seed !== 0) throw new Error('в файле нет названия или зерна');
      w.id = newId; w.name = String(w.name).slice(0, 40); w.played = Date.now();
      if (!Array.isArray(w.palette)) w.palette = null;
      const recs = [];
      for (const c of obj.chunks) {
        if (!Number.isInteger(c.cx) || !Number.isInteger(c.cz) || typeof c.e !== 'string') continue;
        const u8 = S.unb64(c.e);
        if (u8.length % 4) continue;
        const e = new Uint32Array(u8.buffer.slice(0), 0, u8.length / 4);
        let okc = true;
        for (let i = 0; i < e.length; i++) if ((e[i] >>> 16) >= V.CELLS) { okc = false; break; }
        if (!okc) continue;
        const rec = { cx: c.cx, cz: c.cz, e, t: Array.isArray(c.t) ? c.t.slice(0, 4096) : [] };
        // «основа» чанка (мир из Minecraft): повторы (сколько, значение) — сумма ровно V.CELLS
        if (typeof c.b === 'string') { const ub = S.unb64(c.b); if (ub.length % 2 === 0) { const b = new Uint16Array(ub.buffer.slice(0), 0, ub.length / 2); let n = 0; for (let i = 0; i < b.length; i += 2) n += b[i]; if (n === V.CELLS) rec.b = b; } }
        recs.push(rec);
      }
      await S.putWorld(w);
      for (let i = 0; i < recs.length; i += 500) await S.putChunks(newId, recs.slice(i, i + 500));
      return w;
    },
    // ── облако (js/core/cloud.js) и игра вместе: мир одним двоичным файлом (сжимает облако) ──
    // 'KBW1' · u32 длина JSON · JSON { v, world, n } · по чанку: i32 cx, i32 cz, u32 правок, u32 байт плиток, u32 чисел «основы»;
    // правки — номера ячеек по возрастанию разностями (u16), потом значения (u16; палитра мира); плитки — JSON [[i, плитка]]; «основа» — u16
    async allChunks(id){
      const d = await open();
      if (!d) { const out = []; for (const [k, r] of mem.chunks) if (k.startsWith(id + '|')) out.push(r); return out; }
      return reqP(d.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound(id + '|', id + '|￿')));
    },
    packRecs(world, recs){
      const enc = new TextEncoder(), head = enc.encode(JSON.stringify({ v: 1, world, n: recs.length }));
      const tj = recs.map(r => r.t && r.t.length ? enc.encode(JSON.stringify(r.t)) : null);
      let size = 8 + head.length;
      for (let i = 0; i < recs.length; i++) size += 20 + (recs[i].e ? recs[i].e.length * 4 : 0) + (tj[i] ? tj[i].length : 0) + (recs[i].b ? recs[i].b.length * 2 : 0);
      const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
      u8[0] = 75; u8[1] = 66; u8[2] = 87; u8[3] = 49;   // KBW1
      dv.setUint32(4, head.length, true); u8.set(head, 8);
      let o = 8 + head.length;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i], e = r.e || new Uint32Array(0), nb = r.b ? r.b.length : 0;
        const s = Array.from(e).sort((a, b) => a - b);   // по номеру ячейки (значение — в младших битах: порядок тот же)
        dv.setInt32(o, r.cx, true); dv.setInt32(o + 4, r.cz, true); dv.setUint32(o + 8, s.length, true); dv.setUint32(o + 12, tj[i] ? tj[i].length : 0, true); dv.setUint32(o + 16, nb, true); o += 20;
        let prev = 0;
        for (let k = 0; k < s.length; k++) { const c = s[k] >>> 16; dv.setUint16(o, c - prev, true); prev = c; o += 2; }
        for (let k = 0; k < s.length; k++) { dv.setUint16(o, s[k] & 0xffff, true); o += 2; }
        if (tj[i]) { u8.set(tj[i], o); o += tj[i].length; }
        for (let k = 0; k < nb; k++) { dv.setUint16(o, r.b[k], true); o += 2; }
      }
      return u8;
    },
    async packWorld(id){
      const w = await S.world(id); if (!w) return null;
      return S.packRecs(w, await S.allChunks(id));
    },
    // разобрать (с проверкой всего: размеры, номера ячеек, «основа» — ровно V.CELLS) → { world, recs }
    unpackWorld(u8){
      if (!(u8 instanceof Uint8Array) || u8.length < 8 || u8[0] !== 75 || u8[1] !== 66 || u8[2] !== 87 || u8[3] !== 49) throw new Error('это не мир «Кубомира»');
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
      const hl = dv.getUint32(4, true); if (8 + hl > u8.length) throw new Error('файл обрезан');
      const head = JSON.parse(dec.decode(u8.subarray(8, 8 + hl)));
      const w = head && head.world;
      if (!w || typeof w !== 'object' || typeof w.name !== 'string' || (!w.seed && w.seed !== 0)) throw new Error('в файле нет мира');
      if (!Number.isInteger(head.n) || head.n < 0 || head.n > 200000) throw new Error('слишком большой мир');
      const recs = [], LIM = Math.ceil((V.LIMIT || 3e7) / 16) + 2;
      let o = 8 + hl;
      const need = k => { if (o + k > u8.length) throw new Error('файл обрезан'); };
      for (let i = 0; i < head.n; i++) {
        need(20);
        const cx = dv.getInt32(o, true), cz = dv.getInt32(o + 4, true), ne = dv.getUint32(o + 8, true), tl = dv.getUint32(o + 12, true), nb = dv.getUint32(o + 16, true); o += 20;
        if (Math.abs(cx) > LIM || Math.abs(cz) > LIM || ne > V.CELLS || tl > 4e6 || nb > V.CELLS * 2) throw new Error('испорченный чанк');
        need(ne * 4 + tl + nb * 2);
        const e = new Uint32Array(ne); let c = 0;
        for (let k = 0; k < ne; k++) { c += dv.getUint16(o + k * 2, true); if (c >= V.CELLS) throw new Error('испорченный чанк'); e[k] = c << 16; }
        o += ne * 2;
        for (let k = 0; k < ne; k++) e[k] = (e[k] | dv.getUint16(o + k * 2, true)) >>> 0;
        o += ne * 2;
        let t = [];
        if (tl) { const a = JSON.parse(dec.decode(u8.subarray(o, o + tl))); if (Array.isArray(a)) t = a.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < V.CELLS && x[1] && typeof x[1] === 'object').slice(0, 4096); o += tl; }
        const rec = { cx, cz, e, t };
        if (nb) {
          const b = new Uint16Array(nb); let n = 0;
          for (let k = 0; k < nb; k++) b[k] = dv.getUint16(o + k * 2, true);
          o += nb * 2;
          for (let k = 0; k < nb; k += 2) n += b[k];
          if (n === V.CELLS && nb % 2 === 0) rec.b = b;
        }
        recs.push(rec);
      }
      return { world: w, recs };
    },
    // заменить мир целиком (одной транзакцией: не выйдет — старый остаётся как был)
    async replaceWorld(id, w, recs){
      w.id = id;
      const d = await open();
      const empty = r => r.e && r.e.length === 0 && !(r.t && r.t.length) && !(r.b && r.b.length);
      if (!d) {
        for (const k of [...mem.chunks.keys()]) if (k.startsWith(id + '|')) mem.chunks.delete(k);
        mem.worlds.set(id, w); for (const r of recs) if (!empty(r)) mem.chunks.set(ckey(id, r.cx, r.cz), r);
      } else {
        const tx = d.transaction(['worlds', 'chunks'], 'readwrite'), cs = tx.objectStore('chunks');
        cs.delete(IDBKeyRange.bound(id + '|', id + '|￿'));
        tx.objectStore('worlds').put(w);
        for (const r of recs) if (!empty(r)) cs.put(r, ckey(id, r.cx, r.cz));
        await txDone(tx);
      }
      S.clearJournal(id);
      return w;
    },
  };
})();
