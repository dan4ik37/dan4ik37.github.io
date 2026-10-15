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
  };
})();
