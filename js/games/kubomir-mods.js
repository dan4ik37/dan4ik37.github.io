// ═══════════════════════════════════════
//  «КУБОМИР» — моды: библиотека (IndexedDB), установка .d37mod / папки / mod.json, примеры, моды мира, запуск песочниц
// ═══════════════════════════════════════
// window.KubomirMods: ready() → Promise · list() → [{ id, manifest, files, added, size }] · library(el, { back }) — экран «🧩 Моды» ·
// forWorld(meta) → { features, loaded, missing, failed, skipped } (реестр блоков и вещей мира) · run(st, state, hooks) → песочницы
// скриптов (V.mods.runner) · worldPanel(st, wrapEl, { restart }) — окно «Моды мира» в игре · install(files) · remove(id) ·
// pack(ids) / unpack(list) — моды внутри файла мира (.kubomir). Проверка mod.json, zip и песочница — js/engine/voxel-mods.js.
(() => {
  const VX = () => window.D37E.vox;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const u8 = f => f instanceof Uint8Array ? f : typeof f === 'string' ? new TextEncoder().encode(f) : new Uint8Array(f || 0);
  const text = f => typeof f === 'string' ? f : new TextDecoder().decode(f);
  let lib = [], libP = null;

  // ═══ Библиотека модов (IndexedDB «d37-kubomir», хранилище mods; без базы — в памяти вкладки) ═══
  function ready(){ return libP || (libP = refresh()); }
  async function refresh(){
    try { lib = (await VX().store.mods()) || []; } catch (e) { lib = []; }
    lib.sort((a, b) => String(a.manifest?.name || a.id).localeCompare(String(b.manifest?.name || b.id), 'ru'));
    return lib;
  }
  const list = () => lib;
  const find = id => lib.find(r => r.id === id) || null;

  // files: { путь: Uint8Array | строка } — из архива или папки; mod.json в корне
  async function install(files){
    const MJ = files['mod.json'];
    if (MJ == null) throw new Error('в моде нет mod.json (он должен лежать в корне архива или папки)');
    const M = VX().mods, r = M.validate(text(MJ), files);
    if (!r.ok) { const e = new Error(r.errors.slice(0, 8).join('\n')); e.list = r.errors; throw e; }
    const manifest = JSON.parse(text(MJ).replace(/^[^{]*/, ''));
    // храним только то, что нужно моду: картинки текстур и файлы скриптов
    const keep = {};
    for (const t of Object.values(r.m.textures)) if (t.png) keep[t.png] = u8(files[t.png]);
    for (const s of Array.isArray(manifest.scripts) ? manifest.scripts : []) { const p = String((typeof s === 'string' ? s : s?.file) || '').replace(/^\.?\//, ''); if (p && files[p] != null) keep[p] = u8(files[p]); }
    const old = find(r.m.id);
    const rec = { id: r.m.id, manifest, files: keep, added: old?.added || Date.now(), updated: Date.now(), size: r.m.size, warnings: r.warnings.slice(0, 20) };
    await VX().store.putMod(rec);
    await refresh();
    return { rec, updated: !!old, warnings: r.warnings, m: r.m };
  }
  async function remove(id){ await VX().store.delMod(id); await refresh(); }
  // файл(ы) из <input> → { путь: Uint8Array }
  async function readInput(fileList){
    const arr = [...(fileList || [])];
    if (!arr.length) return null;
    if (arr.length === 1 && !arr[0].webkitRelativePath) {
      const f = arr[0];
      if (f.size > 8e6) throw new Error('файл больше 8 МБ — мод должен быть до 4 МБ');
      const b = new Uint8Array(await f.arrayBuffer());
      if (b[0] === 0x50 && b[1] === 0x4b) return VX().mods.unzip(b);   // «PK» — zip (.d37mod)
      return { 'mod.json': b };
    }
    // папка: только нужные файлы (картинки, скрипты, json), без скрытых
    const out = {}; let total = 0;
    for (const f of arr) {
      const p = String(f.webkitRelativePath || f.name).replace(/\\/g, '/');
      if (/(^|\/)\./.test(p) || !/\.(json|png|js|lua|txt|md)$/i.test(p) || f.size > 1e6) continue;
      total += f.size; if (total > 6e6 || Object.keys(out).length > 600) throw new Error('папка слишком большая — мод должен быть до 4 МБ');
      out[p] = new Uint8Array(await f.arrayBuffer());
    }
    const names = Object.keys(out), first = names.length ? names[0].split('/')[0] : '';
    const top = names.length && names.every(k => k.includes('/') && k.split('/')[0] === first) ? first + '/' : '';
    const res = {}; for (const k of names) res[top ? k.slice(top.length) : k] = out[k];
    return res;
  }
  // мод → файл .d37mod (zip без сжатия)
  function zipOf(rec){ return VX().mods.zip(Object.assign({ 'mod.json': JSON.stringify(rec.manifest, null, 2) }, rec.files || {})); }
  function download(name, bytes, type){
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/zip' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // моды внутри файла мира: base64 файлов
  async function pack(ids){
    await ready();
    const S = VX().store, out = [];
    for (const id of ids || []) { const r = find(id); if (!r) continue; const files = {}; for (const [p, f] of Object.entries(r.files || {})) files[p] = S.b64(u8(f)); out.push({ id: r.id, manifest: r.manifest, files }); }
    return out;
  }
  async function unpack(listIn){
    await ready();
    const S = VX().store, added = [], kept = [], bad = [];
    for (const x of (Array.isArray(listIn) ? listIn : []).slice(0, 32)) {
      try {
        if (!x || typeof x.id !== 'string' || !x.manifest) continue;
        if (find(x.id)) { kept.push(x.id); continue; }   // свой такой мод уже есть — не трогаем (может быть новее)
        const files = { 'mod.json': JSON.stringify(x.manifest) };
        for (const [p, b] of Object.entries(x.files || {})) if (typeof b === 'string' && b.length < 6e6) files[p] = S.unb64(b);
        const r = await install(files); added.push(r.m.name);
      } catch (e) { bad.push(x?.id + ': ' + (e.message || e)); }
    }
    return { added, kept, bad };
  }

  // ═══ PNG → 16×16 RGBA (без сглаживания; не квадрат — верхний квадрат, как кадр анимации) ═══
  async function png16(bytes){
    const blob = new Blob([bytes], { type: 'image/png' });
    let img = null, url = '';
    if (window.createImageBitmap) img = await createImageBitmap(blob);
    else { url = URL.createObjectURL(blob); img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('картинка не открылась')); i.src = url; }); }
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
    const w = img.width, h = img.height, s = Math.min(w, h);
    g.drawImage(img, 0, 0, s, s, 0, 0, 16, 16);
    img.close?.(); if (url) URL.revokeObjectURL(url);
    return new Uint8Array(g.getImageData(0, 0, 16, 16).data.buffer);
  }
  const b64bytes = s => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
  async function decodeTextures(m, files){
    const out = {};
    for (const [tn, t] of Object.entries(m.textures)) {
      if (t.draw) continue;
      try { out[tn] = await png16(t.png ? u8(files[t.png]) : b64bytes(String(t.data).split(',')[1] || '')); } catch (e) {}
    }
    return out;
  }
  // превью текстур мода (до 8) — data URL
  const prevCache = new Map();
  async function previews(rec, m){
    const key = rec.id + '|' + (rec.updated || rec.added);
    if (prevCache.has(key)) return prevCache.get(key);
    const V = VX(), rgba = await decodeTextures(m, rec.files || {}), urls = [];
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d');
    for (const [tn, t] of Object.entries(m.textures).slice(0, 8)) {
      const d = t.draw ? V.paint(m.id + ':' + tn, Object.assign({}, t.draw)) : rgba[tn];
      if (!d) continue;
      g.putImageData(new ImageData(new Uint8ClampedArray(d), 16, 16), 0, 0);
      urls.push(c.toDataURL());
    }
    prevCache.set(key, urls);
    return urls;
  }

  // ═══ Моды мира: реестр перед запуском ═══
  function loadJs(src){
    if (typeof window.gamesLoadScript === 'function') return window.gamesLoadScript(src);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src + '?v=' + (window.GAMES_VER || ''); s.onload = res; s.onerror = () => rej(new Error('Не загрузилось: ' + src)); document.head.appendChild(s); });
  }
  async function forWorld(meta){
    await ready();
    const V = VX(), M = V.mods;
    M.reset();
    const ids = Array.isArray(meta.mods) ? meta.mods.filter(x => typeof x === 'string').slice(0, 32) : [];
    const loaded = [], missing = [], failed = [], skipped = [];
    for (const id of ids) {
      const rec = find(id);
      if (!rec) { missing.push(id); continue; }
      const r = M.validate(rec.manifest, rec.files || {});
      if (!r.ok) { failed.push({ id, name: rec.manifest?.name || id, why: r.errors[0] }); continue; }
      try { const rgba = await decodeTextures(r.m, rec.files || {}); M.register(r.m, rgba, { recipes: false }); loaded.push({ m: r.m, rec }); }
      catch (e) { failed.push({ id, name: r.m.name, why: e.message || String(e) }); }
    }
    // рецепты — когда все блоки и вещи уже есть (мод может брать вещи другого мода)
    for (const L of loaded) skipped.push(...M.recipes(L.m).map(s => L.m.name + ': ' + s));
    const features = M.features(loaded.flatMap(L => L.m.features));
    if (loaded.some(L => L.m.scripts.some(s => s.lang === 'lua')) && !window.D37E?.langs?.lua?.worker) await loadJs('js/engine/lang-lua.js').catch(() => {});
    return { features, loaded, missing, failed, skipped };
  }
  function run(st, state, hooks){
    if (state.missing?.length) setTimeout(() => hooks.toast?.(`🧩 Нет модов: ${state.missing.join(', ')} — их блоки показаны пустыми, вещи пропали. Добавь мод в «🧩 Моды» и открой мир снова.`, false), 1200);
    for (const f of state.failed || []) setTimeout(() => hooks.toast?.(`🧩 Мод «${f.name}» не загрузился: ${f.why}`, false), 1500);
    if (!state.loaded?.length) return null;
    return VX().mods.runner(st, state.loaded, hooks);
  }

  // ═══ Экран «🧩 Моды» (меню миров) ═══
  async function library(sc, o = {}){
    if (!sc) return;
    await ready();
    const M = VX().mods;
    sc.innerHTML = `<div class="kb-menu kb-modlib"><h3>🧩 Моды</h3>
      <p class="kb-note">Моды добавляют новые блоки, вещи, рецепты, руды и поведение (скрипты на JavaScript или Lua). Скрипты работают в закрытой «песочнице»: без интернета и без доступа к сайту. Мод включают при создании мира (или в игре: меню → «🧩 Моды мира»).</p>
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-a="file">📥 Добавить мод (.d37mod, .zip, mod.json)</button><button type="button" class="kb-btn" data-a="dir">📁 Папка с модом</button><button type="button" class="kb-btn" data-a="back">← Назад</button></div>
      <input type="file" class="kb-mfile" accept=".d37mod,.zip,.json,application/zip,application/json" hidden><input type="file" class="kb-mdir" webkitdirectory multiple hidden>
      <div class="kb-mres" aria-live="polite"></div>
      <div class="kb-mods kb-mylist"></div>
      <h3 class="kb-mh">📦 Примеры</h3><p class="kb-note">Готовые моды — поставь и посмотри, как они сделаны («📤» — скачать файл и открыть mod.json и скрипты). Как сделать свой — <a href="https://github.com/dan4ik37/dan4ik37.github.io/blob/main/docs/MODS.md#7-кубомир-3d-game-voxel--особенности" target="_blank" rel="noopener">инструкция для авторов модов</a> (формат общий с «Подземьем»).</p>
      <div class="kb-mods kb-exlist"></div>
      <div class="kb-mods"><div class="kb-mod off"><div><b>🌐 Каталог модов</b><small>Скоро: моды других игроков после проверки модератором. Пока делись файлом .d37mod.</small></div><button type="button" class="kb-btn" disabled>Скоро</button></div></div></div>`;
    const res = sc.querySelector('.kb-mres');
    const show = (html, bad) => { res.innerHTML = html ? `<div class="${bad ? 'kb-warn' : 'kb-note'}">${html}</div>` : ''; };
    async function draw(){
      const mine = sc.querySelector('.kb-mylist'), ex = sc.querySelector('.kb-exlist');
      if (!mine) return;
      mine.innerHTML = lib.length ? '' : '<div class="kb-empty">Модов пока нет. Добавь файл мода или поставь пример ниже.</div>';
      for (const rec of lib) {
        const r = M.validate(rec.manifest, rec.files || {}), m = r.m || { name: rec.id, blocks: [], items: [], recipes: [], scripts: [], features: [], textures: {} };
        const card = document.createElement('div'); card.className = 'kb-mod' + (r.ok ? '' : ' off');
        card.innerHTML = `<div><b>${esc(m.name)} <small>${esc(m.version || '')}${m.author ? ' · ' + esc(m.author) : ''}${m.game === 'both' ? ' · для обеих игр' : ''}</small></b>
          <small>${esc(m.description || '')}</small>
          <div class="kb-modtex"></div>
          <small>🧱 ${m.blocks.length} · 🎒 ${m.items.length} · 📜 ${m.recipes.length}${m.features.length ? ' · 🌍 ' + m.features.length : ''}${m.scripts.length ? ' · ⚙️ ' + m.scripts.map(s => s.lang === 'lua' ? 'Lua' : 'JS').join(', ') : ''} · ${Math.max(1, Math.round((rec.size || 0) / 1024))} КБ</small>
          ${r.ok ? '' : `<small class="err">⛔ ${esc(r.errors.slice(0, 3).join(' · '))}</small>`}</div>
          <div class="kb-wb"><button type="button" class="kb-btn" data-r="dl" title="Скачать файл мода">📤</button><button type="button" class="kb-btn danger" data-r="del" title="Удалить из библиотеки">🗑</button></div>`;
        card.querySelector('[data-r="dl"]').onclick = () => download(rec.id + '.d37mod', zipOf(rec));
        card.querySelector('[data-r="del"]').onclick = async () => {
          const ok = window.GameKit?.ask ? await window.GameKit.ask(`Удалить мод «${m.name}»? В мирах с ним его блоки станут пустыми, пока не добавишь мод снова.`, { yes: '🗑 Удалить', no: 'Нет' }) : confirm(`Удалить мод «${m.name}»?`);
          if (ok) { await remove(rec.id); draw(); }
        };
        mine.appendChild(card);
        if (r.ok) previews(rec, m).then(urls => { const box = card.querySelector('.kb-modtex'); if (box) box.innerHTML = urls.map(u => `<img src="${u}" alt="">`).join(''); }).catch(() => {});
      }
      ex.innerHTML = '';
      for (const x of M.EXAMPLES) {
        const have = !!find(x.manifest.id), mf = x.manifest;
        const card = document.createElement('div'); card.className = 'kb-mod';
        card.innerHTML = `<div><b>${esc(mf.name)}</b><small>${esc(mf.description)}</small></div>
          <div class="kb-wb"><button type="button" class="kb-btn${have ? '' : ' primary'}" data-e="add">${have ? '✅ Есть' : '➕ Поставить'}</button><button type="button" class="kb-btn" data-e="dl" title="Скачать файл мода">📤</button></div>`;
        card.querySelector('[data-e="add"]').onclick = async () => { try { await install(Object.assign({ 'mod.json': JSON.stringify(mf) }, x.files)); show(`✅ Мод «${esc(mf.name)}» добавлен. Включи его при создании мира.`); draw(); } catch (e) { show('⛔ ' + esc(e.message || e).replace(/\n/g, '<br>'), true); } };
        card.querySelector('[data-e="dl"]').onclick = () => download(mf.id + '.d37mod', zipOf({ manifest: mf, files: x.files }));
        ex.appendChild(card);
      }
    }
    async function addFrom(files){
      if (!files) return;
      show('⏳ Проверяем мод…');
      try {
        const map = await readInput(files);
        const r = await install(map);
        show(`✅ Мод «${esc(r.m.name)}» ${r.updated ? 'обновлён' : 'добавлен'}: блоков ${r.m.blocks.length}, вещей ${r.m.items.length}, рецептов ${r.m.recipes.length}${r.m.scripts.length ? ', скриптов ' + r.m.scripts.length : ''}.` + (r.warnings.length ? `<br><small>⚠️ ${r.warnings.slice(0, 4).map(esc).join('<br>⚠️ ')}</small>` : ''));
        draw();
      } catch (e) { show('⛔ Мод не добавлен:<br>' + esc(e.message || e).replace(/\n/g, '<br>'), true); }
    }
    sc.querySelector('.kb-mbtns').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'back') o.back?.();
      else if (b.dataset.a === 'file') sc.querySelector('.kb-mfile').click();
      else if (b.dataset.a === 'dir') sc.querySelector('.kb-mdir').click();
    });
    sc.querySelector('.kb-mfile').addEventListener('change', e => { addFrom(e.target.files); e.target.value = ''; });
    sc.querySelector('.kb-mdir').addEventListener('change', e => { addFrom(e.target.files); e.target.value = ''; });
    // перетащить файл мода на окно
    const menu = sc.querySelector('.kb-modlib');
    menu.addEventListener('dragover', e => { e.preventDefault(); menu.classList.add('drop'); });
    menu.addEventListener('dragleave', () => menu.classList.remove('drop'));
    menu.addEventListener('drop', e => { e.preventDefault(); menu.classList.remove('drop'); addFrom(e.dataTransfer?.files); });
    draw();
  }

  // ═══ Окно «🧩 Моды мира» (в игре, меню паузы) ═══
  async function worldPanel(st, wrapEl, o = {}){
    if (!st || !wrapEl || wrapEl.querySelector('.kb-modwin')) return;
    await ready();
    st.I?.unlock?.();
    const R = st.modRun, state = st.mods || { loaded: [] }, on = new Set(Array.isArray(st.meta.mods) ? st.meta.mods : []);
    const box = document.createElement('div'); box.className = 'kb-inv kb-modwin kb-ui';
    const status = R ? R.status() : [];
    const logs = R ? R.logs : [];
    const modCard = L => {
      const s = status.find(x => x.id === L.m.id), lines = logs.filter(x => x.mod === L.m.id).slice(-12);
      const st0 = !s ? '✅ блоки и вещи' : s.off ? `⛔ выключен: ${esc(s.off)}` : !s.ready ? '⏳ запускается…' : s.errors ? `⚠️ работает, ошибок: ${s.errors}` : '✅ работает';
      return `<div class="kb-mod${s?.off ? ' off' : ''}"><div><b>${esc(L.m.name)} <small>${esc(L.m.version)}</small></b><small>${st0}${L.m.scripts.length ? ` · ⚙️ ${L.m.scripts.length}` : ''}</small>
        ${lines.length ? `<div class="kb-modlog">${lines.map(x => (x.bad ? '⚠️ ' : '') + esc(x.t)).join('\n')}</div>` : ''}</div></div>`;
    };
    box.innerHTML = `<div class="kb-panel kb-mw"><div class="kb-ptitle"><b>🧩 Моды мира</b><button type="button" class="kb-x" data-x title="Закрыть">✕</button></div>
      <div class="kb-mods">${state.loaded?.length ? state.loaded.map(modCard).join('') : '<div class="kb-empty">В этом мире модов нет.</div>'}
      ${(state.missing || []).map(id => `<div class="kb-mod off"><div><b>${esc(id)}</b><small class="err">Мода нет в библиотеке — добавь его в «🧩 Моды» (меню миров).</small></div></div>`).join('')}
      ${(state.failed || []).map(f => `<div class="kb-mod off"><div><b>${esc(f.name)}</b><small class="err">⛔ ${esc(f.why)}</small></div></div>`).join('')}
      ${state.skipped?.length ? `<div class="kb-warn">${state.skipped.slice(0, 6).map(esc).join('<br>')}</div>` : ''}</div>
      <h4 class="kb-mh">Включить в этом мире</h4>
      ${lib.length ? `<div class="kb-modpick">${lib.map(r => `<label class="kb-chk"><input type="checkbox" data-mod="${esc(r.id)}"${on.has(r.id) ? ' checked' : ''}> ${esc(r.manifest?.name || r.id)} <small>${esc(r.manifest?.version || '')}</small></label>`).join('')}</div>` : '<p class="kb-note">Библиотека пуста: моды добавляют в меню миров → «🧩 Моды».</p>'}
      <p class="kb-note">Мир сохранится и откроется заново с выбранными модами. Блоки выключенного мода в мире не пропадут — вернутся, когда включишь его снова.</p>
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-apply>🔄 Применить</button><button type="button" class="kb-btn" data-x>Закрыть</button></div></div>`;
    const close = () => { box.remove(); st.C?.reset_state?.(); if (st.modWin === box) st.modWin = null; };
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('[data-x]')) { close(); return; }
      if (e.target.closest('[data-apply]')) {
        const ids = [...box.querySelectorAll('[data-mod]:checked')].map(x => x.dataset.mod);
        const same = ids.length === on.size && ids.every(x => on.has(x));
        close();
        if (!same) o.restart?.(ids);
      }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    wrapEl.appendChild(box); st.modWin = box;
    box.querySelector('[data-x]')?.focus?.();
  }

  window.KubomirMods = { ready, list, refresh, install, remove, readInput, forWorld, run, library, worldPanel, pack, unpack, zipOf, _test: { png16, decodeTextures } };
})();
