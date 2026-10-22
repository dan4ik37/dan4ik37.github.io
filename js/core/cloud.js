// ═══════════════════════════════════════
//  ☁️ ОБЛАЧНЫЕ СОХРАНЕНИЯ ИГР (D37Cloud) — копия мира на сервере: читает и пишет только хозяин аккаунта
// ═══════════════════════════════════════
// Общее для игр с мирами («Кубомир» сейчас, «Подземье» — потом): игра сама упаковывает мир в байты (V.store.packWorld), здесь —
// сжатие gzip (CompressionStream, кусками — без рывка кадра), место в облаке и версии. Сервер — ugc.sql (раздел «Облачные
// сохранения»): cloud_saves (имя, размер, версия, игровое время, устройство), cloud_list / cloud_begin / cloud_commit /
// cloud_delete / cloud_usage, закрытое хранилище saves: <uid>/<игра>/<мир>/<версия>-<случ>.kbw (новая версия — новый файл;
// загрузить можно только тот путь, что выдал cloud_begin; старый удаляется после записи).
// Где лежат файлы — «бэкенд» (B ниже): сейчас Supabase (функции ugc.sql + хранилище saves), потом — свой сервер владельца (T-045):
// D37Cloud.setBackend({ ready(), rpc(имя, args) → ответ функции, upload(путь, Uint8Array), download(путь) → Uint8Array,
// remove([пути]), list(папка) → [имена] }) — игры ничего не меняют.
// Браузер — главный: мир живёт в IndexedDB, облако — копия. Правило версий (resolve): у копии мира — meta.cloud { on, ver, dirty }
// (ver — с какой версией облака совпадает, dirty — менялся после отправки); в облаке новее и здесь не менялся — скачать; здесь
// менялся, а в облаке та же версия — отправить; поменялись оба — спросить «Какую версию оставить?» (подсказка — новее по игровому
// времени gt). Отправляет игра только то, что поменялось (подпись мира — V.store.sig), скачивает — только с другого устройства или
// по кнопке; опросов нет.
// Числа — на сервере, ОДНО место: cloud_rule() в ugc.sql (сколько миров и какого размера, предел всего хранилища сайта); cloud_list
// отдаёт их этому аккаунту (slots, max_bytes, full) — здесь RULES только для подписей до ответа (scripts/cloud-test.cjs сверяет).
//   D37Cloud.available() — вошёл, есть сервер и сжатие · list(game) → { ok, slots, max_bytes, plus, full, used, list: [{ world, name,
//   bytes, ver, gt, device, at, path }] } · put(game, world, { name, data: Uint8Array, gt, base, force }) → { ok, ver, bytes } |
//   { ok: false, reason: conflict|slots|full|size|too_fast|auth|net|off, … } · get(game, row) → Uint8Array (уже разжатый) ·
//   del(game, world) · resolve(meta.cloud, row) → same | up | down | conflict | new | gone · usage() — только админ: сколько занято
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Cloud) return;
  // Предложения владельцу (решает он; меняются в ОДНОМ месте — cloud_rule в ugc.sql; здесь копия для подписей до ответа сервера):
  // обычный аккаунт — 2 мира по 2 МБ, VIP или «💛 Донатер» — 4 по 4 МБ (только удобство); всё хранилище сайта — 1024 МБ (бесплатный
  // тариф Supabase, общее с моделями, эмодзи, рекламой); занято 800 МБ — новые сохранения в облако не принимаются
  const RULES = { slots: 2, maxBytes: 2 * 1024 * 1024, slotsPlus: 4, maxBytesPlus: 4 * 1024 * 1024, siteMb: 1024, capMb: 800, minGapS: 20, autosaveMs: 180000 };
  const BUCKET = 'saves', MAX_RAW = 80 * 1024 * 1024, PIECE = 64 * 1024;
  const client = () => { try { return typeof sbClient !== 'undefined' && sbClient ? sbClient : root.sbClient || null; } catch (e) { return root.sbClient || null; } };
  const user = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : root.currentUser || null; } catch (e) { return root.currentUser || null; } };
  const canZip = () => typeof root.CompressionStream === 'function' && typeof root.DecompressionStream === 'function';

  // ── бэкенд: Supabase (функции ugc.sql + закрытое хранилище saves) ──
  const err = e => String(e?.message || e || 'ошибка');
  const SUPA = {
    name: 'supabase',
    ready: () => !!client(),
    async rpc(fn, args){
      const c = client(); if (!c) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await c.rpc(fn, args);
        if (error) return { ok: false, reason: /PGRST202|Could not find the function/i.test(error.message || '') || error.code === 'PGRST202' ? 'off' : 'net', error: error.message };
        return data || { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net', error: err(e) }; }
    },
    async upload(path, u8){
      const r = await client().storage.from(BUCKET).upload(path, new Blob([u8], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false, cacheControl: '0' }).catch(e => ({ error: e }));
      if (r?.error) throw new Error(err(r.error));
    },
    async download(path){
      const { data, error } = await client().storage.from(BUCKET).download(path);
      if (error || !data) throw new Error('не скачалось: ' + (error?.message || 'нет файла'));
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths){ if (paths.length) await client().storage.from(BUCKET).remove(paths).catch(() => {}); },
    async list(dir){ const { data } = await client().storage.from(BUCKET).list(dir, { limit: 100 }); return (data || []).map(f => f?.name).filter(Boolean); },
  };
  let B = SUPA;
  const KEYS = ['ready', 'rpc', 'upload', 'download', 'remove', 'list'];
  function setBackend(b){ if (!b) { B = SUPA; return true; } if (!KEYS.every(k => typeof b[k] === 'function')) throw new Error('бэкенд облака: нужны ' + KEYS.join(', ')); B = b; return true; }
  const available = () => { try { return !!(B.ready() && user()?.id && canZip()); } catch (e) { return false; } };

  // ── сжатие: куски по 64 КБ (после каждого — отдать очередь событий: кадр игры не ждёт) ──
  async function pump(stream, u8, max){
    const w = stream.writable.getWriter(), rd = stream.readable.getReader(), parts = [];
    let total = 0, er = null;
    const reading = (async () => {
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        total += value.byteLength;
        if (max && total > max) { er = new Error('слишком большой файл после распаковки'); try { await rd.cancel(); } catch (e) {} break; }
        parts.push(value);
      }
    })();
    try {
      for (let i = 0; i < u8.length && !er; i += PIECE) { await w.ready; await w.write(u8.subarray(i, Math.min(u8.length, i + PIECE))); await new Promise(r => setTimeout(r, 0)); }
      if (!er) await w.close(); else try { await w.abort(); } catch (e) {}
    } catch (e) { er = er || e; }
    await reading.catch(e => { er = er || e; });
    if (er) throw er;
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
  const gzip = u8 => pump(new root.CompressionStream('gzip'), u8);
  const isGz = u8 => u8 && u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  const gunzip = (u8, max = MAX_RAW) => isGz(u8) ? pump(new root.DecompressionStream('gzip'), u8, max) : Promise.resolve(u8);

  // ── подпись: два 32-битных хеша (FNV-1a и перемешивание MurmurHash) → 16 знаков. Байты — словами по 4 (выровненная часть через
  // Int32Array — вчетверо меньше шагов), строка — по кодам знаков ──
  const hex = (a, b) => (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  function hashStr(s){
    let h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0;
    for (let i = 0, n = s.length; i < n; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); h2 ^= h2 >>> 15; }
    return hex(h1, h2);
  }
  function hashBytes(u8, from, to){
    let h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0;
    // слова считаются от начала куска (не от адреса в памяти): та же часть файла — та же подпись, где бы она ни лежала
    const a = (u8.byteOffset + from) & 3 ? u8.slice(from, to) : u8.subarray(from, to), n = a.length, nw = n >> 2;
    if (nw > 0) { const w = new Int32Array(a.buffer, a.byteOffset, nw); for (let k = 0; k < nw; k++) { const c = w[k]; h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); h2 ^= h2 >>> 15; } }
    for (let i = nw << 2; i < n; i++) { const c = a[i]; h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); h2 ^= h2 >>> 15; }
    return hex(h1 ^ n, h2);
  }
  const hash = (src, from = 0, to) => typeof src === 'string' ? hashStr(src) : hashBytes(src, from, to == null ? src.length : to);

  // ── это устройство: «pc:ab12cd» (кто сохранял — в вопросе «какую версию оставить») ──
  function device(){
    let id = '';
    try { id = root.localStorage.getItem('d37_cloud_dev') || ''; } catch (e) {}
    if (!/^[a-z0-9]{6}$/.test(id)) { id = Math.random().toString(36).slice(2, 8).padEnd(6, '0'); try { root.localStorage.setItem('d37_cloud_dev', id); } catch (e) {} }
    let phone = false; try { phone = !!(root.D37E?.isMobile?.() || root.matchMedia?.('(pointer: coarse)').matches); } catch (e) {}
    return (phone ? 'phone:' : 'pc:') + id;
  }
  const deviceName = d => !d ? 'другое устройство' : d === device() ? 'это устройство' : /^phone:/.test(d) ? 'телефон' : 'компьютер';

  const okGame = g => /^[a-z]{2,16}$/.test(String(g || ''));
  const okWorld = w => /^[A-Za-z0-9_-]{2,40}$/.test(String(w || ''));
  let last = null;   // последний ответ cloud_list: пределы этого аккаунта (slots, max_bytes, full)

  async function list(game){
    if (!okGame(game)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: user()?.id ? 'off' : 'auth' };
    const r = await B.rpc('cloud_list', { p_game: game });
    if (r.ok) { if (!Array.isArray(r.list)) r.list = []; last = { slots: r.slots, max_bytes: r.max_bytes, full: !!r.full, plus: !!r.plus, at: Date.now() }; }
    return r;
  }
  const maxBytes = () => last?.max_bytes > 0 ? last.max_bytes : RULES.maxBytesPlus;   // до ответа — больший (сервер всё равно проверит)
  // Записать версию: место (cloud_begin) → файл в хранилище → «готово» (cloud_commit, проверка версии ещё раз) → старое удалить
  async function put(game, world, o = {}){
    if (!okGame(game) || !okWorld(world)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: 'auth' };
    const t0 = Date.now(), raw = o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data || 0);
    let gz;
    try { gz = await gzip(raw); } catch (e) { return { ok: false, reason: 'zip', error: err(e) }; }
    if (gz.length > maxBytes()) return { ok: false, reason: 'size', bytes: gz.length, max: maxBytes() };
    const dev = device(), name = String(o.name || '').slice(0, 40), gt = Math.max(0, +o.gt || 0), base = Number.isInteger(o.base) ? o.base : null;
    const b = await B.rpc('cloud_begin', { p_game: game, p_world: world, p_name: name, p_bytes: gz.length, p_base: base, p_gt: gt, p_device: dev, p_force: !!o.force });
    if (!b.ok) { if (b.reason === 'full' && last) last.full = true; return b; }
    try { await B.upload(b.path, gz); } catch (e) { return { ok: false, reason: 'net', error: err(e) }; }
    const cm = await B.rpc('cloud_commit', { p_game: game, p_world: world, p_path: b.path, p_bytes: gz.length, p_gt: gt, p_device: dev, p_name: name, p_base: base, p_force: !!o.force });
    if (!cm.ok) { B.remove([b.path]).catch(() => {}); return cm; }
    // старая версия и брошенные файлы прошлых попыток (файл дошёл, а «готово» — нет) — убрать: место в хранилище общее на весь сайт
    const dir = b.path.slice(0, b.path.lastIndexOf('/')), gone = [];
    if (cm.old && cm.old !== b.path) gone.push(cm.old);
    try { for (const n of await B.list(dir)) { const p = dir + '/' + n; if (p !== b.path && !gone.includes(p)) gone.push(p); } } catch (e) {}
    if (gone.length) B.remove(gone).catch(() => {});
    return { ok: true, ver: cm.ver, bytes: gz.length, raw: raw.length, ms: Date.now() - t0, path: b.path };
  }
  // Скачать версию (строка из list): Uint8Array разжатого мира
  async function get(game, row){
    if (!okGame(game) || !row?.path) throw new Error('нет такой версии в облаке');
    if (!available()) throw new Error('войди в аккаунт');
    const u8 = await B.download(row.path);
    if (u8.length > RULES.maxBytesPlus * 1.2) throw new Error('слишком большой файл');
    return gunzip(u8);
  }
  async function del(game, world){
    if (!okGame(game) || !okWorld(world)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: 'auth' };
    const r = await B.rpc('cloud_delete', { p_game: game, p_world: world });
    if (r.ok) {
      const dir = user().id + '/' + game + '/' + world, paths = [r.path, r.pending].filter(Boolean);
      try { for (const n of await B.list(dir)) paths.push(dir + '/' + n); } catch (e) {}
      if (paths.length) await B.remove([...new Set(paths)]).catch(() => {});
    }
    return r;
  }
  // Сколько занято (только админ): { ok, site_bytes, site_mb, cap_mb, cloud_bytes, worlds, users, full }
  const usage = () => B.rpc('cloud_usage', {});
  // Что делать с копией мира: m — meta.cloud этой копии (или null), row — строка облака (или null)
  //   new — в облаке нет, копия не в облаке · up — отправить · down — скачать (здесь не менялся) · conflict — менялись оба (или
  //   связь копий неизвестна) — спросить · same — совпадают · gone — была в облаке, но там её убрали (с другого устройства)
  function resolve(m, row){
    const on = !!m?.on, base = Number.isInteger(m?.ver) ? m.ver : -1, dirty = !!m?.dirty;
    if (!row) return on && base > 0 ? 'gone' : on ? 'up' : 'new';
    if (base < 0) return 'conflict';   // в облаке такой мир есть, а эта копия с ним ни разу не сверялась — не затирать молча
    if (row.ver === base) return dirty ? 'up' : 'same';
    if (row.ver > base) return dirty ? 'conflict' : 'down';
    return 'up';   // здесь новее облака (облако откатили) — отправить
  }
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',').replace(',0', '') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
  const fmtTime = s => { s = Math.max(0, Math.round(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };

  root.D37Cloud = { RULES, BUCKET, available, canZip, gzip, gunzip, isGz, hash, device, deviceName, list, put, get, del, usage, resolve, fmtSize, fmtTime,
    setBackend, backend: () => B.name || 'своё', limits: () => last && Object.assign({}, last) };
})();
