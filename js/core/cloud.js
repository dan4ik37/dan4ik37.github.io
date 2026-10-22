// ═══════════════════════════════════════
//  ☁️ ОБЛАЧНЫЕ СОХРАНЕНИЯ ИГР (D37Cloud) — копия мира в Supabase Storage: читает и пишет только хозяин аккаунта
// ═══════════════════════════════════════
// Общее для игр с мирами («Кубомир» сейчас, «Подземье» — потом): игра сама упаковывает мир в байты (V.store.packWorld), здесь —
// сжатие gzip (CompressionStream, кусками — без рывка кадра), место в облаке и версии. Сервер — ugc.sql (раздел «Облачные
// сохранения»): cloud_saves (имя, размер, версия, игровое время, устройство), cloud_list / cloud_begin / cloud_commit /
// cloud_delete, закрытое хранилище saves: <uid>/<игра>/<мир>/<версия>-<случ>.kbw (новая версия — новый файл; загрузить можно только
// тот путь, что выдал cloud_begin; старый удаляется после записи).
// Браузер — главный: мир живёт в IndexedDB, облако — копия. Правило версий (resolve): у копии мира — meta.cloud { on, ver, dirty }
// (ver — с какой версией облака совпадает, dirty — менялся после отправки); в облаке новее и здесь не менялся — скачать; здесь
// менялся, а в облаке та же версия — отправить; поменялись оба — спросить «Какую версию оставить?» (подсказка — новее по игровому
// времени gt). Числа — RULES = cloud_rule() в ugc.sql (одно место на сервере; scripts/cloud-test.cjs сверяет).
//   D37Cloud.available() — вошёл, есть Supabase и сжатие · list(game) → { ok, slots, used, list: [{ world, name, bytes, ver, gt, device, at, path }] }
//   put(game, world, { name, data: Uint8Array, gt, base, force }) → { ok, ver } | { ok: false, reason: conflict|slots|full|size|too_fast|auth|net, … }
//   get(game, row) → Uint8Array (уже разжатый) · del(game, world) · resolve(meta.cloud, row) → same | up | down | conflict | new | gone
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Cloud) return;
  // Предложения владельцу (меняются в одном месте на сервере: cloud_rule в ugc.sql; здесь — копия для подписей)
  const RULES = { slots: 3, slotsVip: 5, maxBytes: 5 * 1024 * 1024, totalMb: 700, minGapS: 20, autosaveMs: 180000 };
  const BUCKET = 'saves', MAX_RAW = 80 * 1024 * 1024, PIECE = 64 * 1024;
  const client = () => { try { return typeof sbClient !== 'undefined' && sbClient ? sbClient : root.sbClient || null; } catch (e) { return root.sbClient || null; } };
  const user = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : root.currentUser || null; } catch (e) { return root.currentUser || null; } };
  const canZip = () => typeof root.CompressionStream === 'function' && typeof root.DecompressionStream === 'function';
  const available = () => !!(client() && user()?.id && canZip());

  // ── сжатие: куски по 64 КБ (после каждого — отдать очередь событий: кадр игры не ждёт) ──
  async function pump(stream, u8, max){
    const w = stream.writable.getWriter(), rd = stream.readable.getReader(), parts = [];
    let total = 0, err = null;
    const reading = (async () => {
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        total += value.byteLength;
        if (max && total > max) { err = new Error('слишком большой файл после распаковки'); try { await rd.cancel(); } catch (e) {} break; }
        parts.push(value);
      }
    })();
    try {
      for (let i = 0; i < u8.length && !err; i += PIECE) { await w.ready; await w.write(u8.subarray(i, Math.min(u8.length, i + PIECE))); await new Promise(r => setTimeout(r, 0)); }
      if (!err) await w.close(); else try { await w.abort(); } catch (e) {}
    } catch (e) { err = err || e; }
    await reading.catch(e => { err = err || e; });
    if (err) throw err;
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
  const gzip = u8 => pump(new root.CompressionStream('gzip'), u8);
  const isGz = u8 => u8 && u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  const gunzip = (u8, max = MAX_RAW) => isGz(u8) ? pump(new root.DecompressionStream('gzip'), u8, max) : Promise.resolve(u8);

  // ── это устройство: «pc:ab12cd» (кто сохранял — в вопросе «какую версию оставить») ──
  function device(){
    let id = '';
    try { id = root.localStorage.getItem('d37_cloud_dev') || ''; } catch (e) {}
    if (!/^[a-z0-9]{6}$/.test(id)) { id = Math.random().toString(36).slice(2, 8).padEnd(6, '0'); try { root.localStorage.setItem('d37_cloud_dev', id); } catch (e) {} }
    let phone = false; try { phone = !!(root.D37E?.isMobile?.() || root.matchMedia?.('(pointer: coarse)').matches); } catch (e) {}
    return (phone ? 'phone:' : 'pc:') + id;
  }
  const deviceName = d => !d ? 'другое устройство' : d === device() ? 'это устройство' : /^phone:/.test(d) ? 'телефон' : 'компьютер';

  async function rpc(fn, args){
    const c = client(); if (!c) return { ok: false, reason: 'net' };
    try {
      const { data, error } = await c.rpc(fn, args);
      if (error) return { ok: false, reason: /PGRST202|Could not find the function/i.test(error.message || '') || error.code === 'PGRST202' ? 'off' : 'net', error: error.message };
      return data || { ok: false, reason: 'net' };
    } catch (e) { return { ok: false, reason: 'net', error: String(e?.message || e) }; }
  }
  const okGame = g => /^[a-z]{2,16}$/.test(String(g || ''));
  const okWorld = w => /^[A-Za-z0-9_-]{2,40}$/.test(String(w || ''));

  async function list(game){
    if (!okGame(game)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: user()?.id ? 'off' : 'auth' };
    const r = await rpc('cloud_list', { p_game: game });
    if (r.ok && !Array.isArray(r.list)) r.list = [];
    return r;
  }
  // Записать версию: место (cloud_begin) → файл в хранилище → «готово» (cloud_commit, проверка версии ещё раз) → старый файл удалить
  async function put(game, world, o = {}){
    if (!okGame(game) || !okWorld(world)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: 'auth' };
    const t0 = Date.now(), raw = o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data || 0);
    let gz;
    try { gz = await gzip(raw); } catch (e) { return { ok: false, reason: 'zip', error: String(e?.message || e) }; }
    if (gz.length > RULES.maxBytes) return { ok: false, reason: 'size', bytes: gz.length };
    const dev = device(), name = String(o.name || '').slice(0, 40), gt = Math.max(0, +o.gt || 0);
    const b = await rpc('cloud_begin', { p_game: game, p_world: world, p_name: name, p_bytes: gz.length, p_base: Number.isInteger(o.base) ? o.base : null, p_gt: gt, p_device: dev, p_force: !!o.force });
    if (!b.ok) return b;
    const c = client(), S = c.storage.from(BUCKET);
    const up = await S.upload(b.path, new Blob([gz], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false, cacheControl: '0' }).catch(e => ({ error: e }));
    if (up?.error) return { ok: false, reason: 'net', error: String(up.error.message || up.error) };
    const cm = await rpc('cloud_commit', { p_game: game, p_world: world, p_path: b.path, p_bytes: gz.length, p_gt: gt, p_device: dev, p_name: name, p_base: Number.isInteger(o.base) ? o.base : null, p_force: !!o.force });
    if (!cm.ok) { S.remove([b.path]).catch(() => {}); return cm; }
    if (cm.old && cm.old !== b.path) S.remove([cm.old]).catch(() => {});
    return { ok: true, ver: cm.ver, bytes: gz.length, raw: raw.length, ms: Date.now() - t0, path: b.path };
  }
  // Скачать версию (строка из list): Uint8Array разжатого мира
  async function get(game, row){
    if (!okGame(game) || !row?.path) throw new Error('нет такой версии в облаке');
    if (!available()) throw new Error('войди в аккаунт');
    const { data, error } = await client().storage.from(BUCKET).download(row.path);
    if (error || !data) throw new Error('не скачалось: ' + (error?.message || 'нет файла'));
    if (data.size > RULES.maxBytes * 1.2) throw new Error('слишком большой файл');
    return gunzip(new Uint8Array(await data.arrayBuffer()));
  }
  async function del(game, world){
    if (!okGame(game) || !okWorld(world)) return { ok: false, reason: 'bad' };
    if (!available()) return { ok: false, reason: 'auth' };
    const r = await rpc('cloud_delete', { p_game: game, p_world: world });
    if (r.ok) {
      const S = client().storage.from(BUCKET), dir = user().id + '/' + game + '/' + world;
      const paths = [r.path, r.pending].filter(Boolean);
      try { const { data } = await S.list(dir, { limit: 100 }); for (const f of data || []) if (f?.name) paths.push(dir + '/' + f.name); } catch (e) {}
      if (paths.length) await S.remove([...new Set(paths)]).catch(() => {});
    }
    return r;
  }
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
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
  const fmtTime = s => { s = Math.max(0, Math.round(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };

  root.D37Cloud = { RULES, BUCKET, available, canZip, gzip, gunzip, isGz, device, deviceName, list, put, get, del, resolve, fmtSize, fmtTime };
})();
