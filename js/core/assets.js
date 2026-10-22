// ═══════════════════════════════════════
//  ОБЩЕЕ ХРАНИЛИЩЕ МАТЕРИАЛОВ (D37Assets) — картинки, видео, звук, модели, тексты, проекты — между инструментами сайта
// ═══════════════════════════════════════
// Инструменты не гоняют файлы через «Скачать»: фоторедактор кладёт картинку сюда, другой инструмент (видео, «Студия 3D»,
// персонаж…) берёт её по номеру. Всё лежит ТОЛЬКО в этом браузере (IndexedDB «d37-assets»), на сервер не уходит.
// Запись: { id, type, name, mime, size, w, h, dur, tool (кто сделал), license, owner, thumb (data URL ≤ 24 КБ), pinned,
// created, updated, used } + сам файл (Blob) отдельно (список не тянет файлы в память).
// Место: своё ограничение (телефон 300 МБ, компьютер 1 ГБ) и квота браузера (navigator.storage.estimate) — не влезает новое →
// удаляются самые давно не открытые незакреплённые; всё равно не влезает → ошибка «Мало места», старое не трогаем.
// Изменения видны другим вкладкам (BroadcastChannel «d37-assets») и событием on(fn).
// Тест: node scripts/photo-test.cjs (поддельная IndexedDB).
(function (root) {
  'use strict';
  const DB = 'd37-assets', VER = 1;
  const TYPES = ['image', 'video', 'audio', 'model', 'text', 'project'];
  const MAX_FILE = 200e6;                 // один файл
  const THUMB_MAX = 24000;                // знаков в data URL превью
  let idbImpl = null, dbp = null, bc = null;
  const subs = new Set();
  const isPhone = () => { try { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches) || (root.navigator && /Android|iPhone|iPad|Mobile/i.test(root.navigator.userAgent || '')); } catch (e) { return false; } };
  const capBytes = () => (api.cap != null ? api.cap : (isPhone() ? 300e6 : 1e9));
  const fail = (m, code) => { const e = new Error(m); e.user = true; e.code = code || 'error'; throw e; };
  const idb = () => idbImpl || root.indexedDB || null;

  // ═══ IndexedDB ═══
  function open(){
    if (dbp) return dbp;
    const I = idb();
    if (!I) return Promise.reject(Object.assign(new Error('Хранилище браузера недоступно (приватный режим?)'), { user: true, code: 'noidb' }));
    dbp = new Promise((res, rej) => {
      let r;
      try { r = I.open(DB, VER); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' });
      };
      r.onsuccess = () => { const d = r.result; try { d.onversionchange = () => { d.close(); dbp = null; }; } catch (e) {} res(d); };
      r.onerror = () => rej(r.error || new Error('IndexedDB'));
      r.onblocked = () => rej(new Error('Хранилище занято другой вкладкой'));
    }).catch(e => { dbp = null; throw e; });
    return dbp;
  }
  // Одна транзакция: fn(stores) → значение; готово — когда транзакция завершилась
  function tx(names, mode, fn){
    return open().then(d => new Promise((res, rej) => {
      let t, out;
      try { t = d.transaction(names, mode); } catch (e) { rej(e); return; }
      const st = {}; for (const n of names) st[n] = t.objectStore(n);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error || new Error('IndexedDB'));
      t.onabort = () => rej(t.error || new Error('IndexedDB: отменено'));
      Promise.resolve(fn(st)).then(v => { out = v; }, e => { try { t.abort(); } catch (er) {} rej(e); });
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const allMeta = () => tx(['meta'], 'readonly', s => req(s.meta.getAll()));

  // ═══ Помощники ═══
  function newId(){
    let r = '';
    try { const b = new Uint8Array(6); root.crypto.getRandomValues(b); r = Array.from(b, x => (x % 36).toString(36)).join(''); }
    catch (e) { r = Math.random().toString(36).slice(2, 8); }
    return 'a' + Date.now().toString(36) + r;
  }
  const cleanName = n => String(n == null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'Без названия';
  const num = v => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 1000) / 1000 : 0);
  function cleanMeta(m, blob){
    const type = String(m.type || '');
    if (!TYPES.includes(type)) fail('Неизвестный вид материала: ' + type, 'type');
    const o = {
      type, name: cleanName(m.name), mime: String(m.mime || (blob && blob.type) || '').slice(0, 80),
      size: blob ? blob.size : 0, w: num(m.w) | 0, h: num(m.h) | 0, dur: num(m.dur),
      tool: String(m.tool || '').replace(/[^a-z0-9_]/g, '').slice(0, 24), license: String(m.license || 'own').slice(0, 60),
      owner: String(m.owner || '').slice(0, 60), thumb: '', pinned: !!m.pinned,
    };
    if (typeof m.thumb === 'string' && m.thumb.length <= THUMB_MAX && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.thumb)) o.thumb = m.thumb;
    if (m.extra && typeof m.extra === 'object') { try { const s = JSON.stringify(m.extra); if (s.length <= 4000) o.extra = JSON.parse(s); } catch (e) {} }
    return o;
  }
  function changed(type, meta){
    const d = { type, id: meta && meta.id, asset: meta || null };
    subs.forEach(f => { try { f(d); } catch (e) {} });
    try {
      if (!bc && root.BroadcastChannel) { bc = new root.BroadcastChannel('d37-assets'); bc.onmessage = e => subs.forEach(f => { try { f(Object.assign({ remote: true }, e.data)); } catch (er) {} }); }
      bc && bc.postMessage({ type, id: d.id });
    } catch (e) {}
  }

  // ═══ Место ═══
  async function usage(){
    const list = await allMeta();
    const bytes = list.reduce((s, m) => s + (m.size || 0), 0);
    let quota = 0, used = 0;
    try { if (root.navigator && root.navigator.storage && root.navigator.storage.estimate) { const e = await root.navigator.storage.estimate(); quota = e.quota || 0; used = e.usage || 0; } } catch (e) {}
    return { count: list.length, bytes, cap: capBytes(), quota, used };
  }
  // Освободить место под need байт: самые давно не открытые незакреплённые — удаляются. → удалённые id
  async function makeRoom(need){
    const u = await usage();
    let over = Math.max(0, u.bytes + need - u.cap);
    if (u.quota) over = Math.max(over, Math.ceil(u.used + need - u.quota * 0.8));
    if (over <= 0) return [];
    const list = (await allMeta()).filter(m => !m.pinned).sort((a, b) => (a.used || a.updated || 0) - (b.used || b.updated || 0));
    const gone = []; let freed = 0;
    for (const m of list) { if (freed >= over) break; freed += m.size || 0; gone.push(m.id); }
    if (freed < over) fail(`Мало места для материалов: нужно ещё ${Math.ceil((over - freed) / 1048576)} МБ. Удали ненужное в «📁 Материалы».`, 'quota');
    await tx(['meta', 'data'], 'readwrite', s => { for (const id of gone) { s.meta.delete(id); s.data.delete(id); } });
    gone.forEach(id => changed('remove', { id }));
    return gone;
  }

  // ═══ API ═══
  // Положить файл: put(blob, { type, name, tool, w, h, thumb, … }) → запись (meta)
  async function put(blob, meta = {}){
    if (!blob || typeof blob.size !== 'number') fail('Нет файла', 'blob');
    if (blob.size > MAX_FILE) fail(`Файл больше ${Math.round(MAX_FILE / 1e6)} МБ`, 'big');
    const m = cleanMeta(meta, blob);
    await makeRoom(blob.size);
    const now = Date.now();
    const rec = Object.assign({ id: meta.id && /^a[a-z0-9]{6,30}$/.test(meta.id) ? meta.id : newId(), created: now, updated: now, used: now }, m);
    await tx(['meta', 'data'], 'readwrite', s => { s.meta.put(rec); s.data.put({ id: rec.id, blob }); });
    changed('put', rec);
    return rec;
  }
  // Заменить файл у той же записи (проект сохранили ещё раз)
  async function replace(id, blob, patch = {}){
    const old = await getMeta(id);
    if (!old) fail('Материал не найден', 'missing');
    if (blob.size > MAX_FILE) fail(`Файл больше ${Math.round(MAX_FILE / 1e6)} МБ`, 'big');
    const m = cleanMeta(Object.assign({}, old, patch, { type: old.type }), blob);
    await makeRoom(Math.max(0, blob.size - (old.size || 0)));
    const rec = Object.assign({}, old, m, { id, updated: Date.now(), used: Date.now() });
    await tx(['meta', 'data'], 'readwrite', s => { s.meta.put(rec); s.data.put({ id, blob }); });
    changed('put', rec);
    return rec;
  }
  async function getMeta(id){ return (await tx(['meta'], 'readonly', s => req(s.meta.get(String(id))))) || null; }
  // Взять: { meta, blob } (и отметить «открывали» — для очистки места)
  async function get(id){
    // оба запроса — сразу (без await внутри транзакции: она закрывается, когда нет ожидающих запросов)
    const r = await tx(['meta', 'data'], 'readonly', s => Promise.all([req(s.meta.get(String(id))), req(s.data.get(String(id)))]).then(([meta, data]) => ({ meta, data })));
    if (!r.meta || !r.data) return null;
    tx(['meta'], 'readwrite', s => { r.meta.used = Date.now(); s.meta.put(r.meta); }).catch(() => {});
    return { meta: r.meta, blob: r.data.blob };
  }
  // Список: { type, tool, limit } → записи, новые сверху
  async function list(o = {}){
    let l = await allMeta();
    if (o.type) l = l.filter(m => m.type === o.type);
    if (o.tool) l = l.filter(m => m.tool === o.tool);
    l.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return o.limit ? l.slice(0, o.limit) : l;
  }
  async function update(id, patch = {}){
    const old = await getMeta(id); if (!old) return null;
    const rec = Object.assign({}, old);
    if (patch.name != null) rec.name = cleanName(patch.name);
    if (patch.pinned != null) rec.pinned = !!patch.pinned;
    if (patch.thumb != null) rec.thumb = cleanMeta({ type: old.type, thumb: patch.thumb }).thumb;
    rec.updated = Date.now();
    await tx(['meta'], 'readwrite', s => { s.meta.put(rec); });
    changed('update', rec);
    return rec;
  }
  async function remove(id){
    await tx(['meta', 'data'], 'readwrite', s => { s.meta.delete(String(id)); s.data.delete(String(id)); });
    changed('remove', { id: String(id) });
    return true;
  }
  function on(fn){ subs.add(fn); return () => subs.delete(fn); }
  // Попросить браузер не стирать материалы при нехватке места (без окон — браузер решает сам)
  async function persist(){ try { return !!(root.navigator && root.navigator.storage && root.navigator.storage.persist && await root.navigator.storage.persist()); } catch (e) { return false; } }

  const api = { TYPES, MAX_FILE, cap: null, put, replace, get, meta: getMeta, list, update, remove, usage, on, persist, makeRoom,
    _setIDB(x){ idbImpl = x; dbp = null; }, _reset(){ dbp = null; } };
  root.D37Assets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
