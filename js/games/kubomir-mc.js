// ═══════════════════════════════════════
//  «КУБОМИР» — «📥 Импорт из Minecraft»: постройки и миры (в новый мир или рядом с игроком), пакеты данных, дополнения Bedrock,
//  моды Java (.jar — только данные), пакеты текстур. Всё переводится ОДИН раз, при импорте; файлы игрока — только в его браузере
// ═══════════════════════════════════════
// window.KubomirMC: open(el, { back, st }) — окно импорта (меню миров, «🧩 Моды», меню паузы) · beforeWorld(meta) — перед запуском
// мира: цветные блоки «mc:…» в реестр, пакет текстур поверх картинок · rle(cells) / unrle(u16, out) — «основа» чанка (мир из Minecraft
// хранится не правками, а целым слоем, сжатым повторами). Тяжёлое (zip, NBT, регионы, LevelDB) — в потоке js/engine/mc-worker.js.
(() => {
  const VX = () => window.D37E.vox, MCx = () => window.D37E.mc;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ver = () => (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
  const H = () => VX().H;
  const SEA_OFF = 11;          // y Minecraft = наш y + 11 (уровень моря 63 → 52)
  const MAX_FILE = 600e6;
  const RESPACK = '__respack';

  // ═══ Поток ═══
  let worker = null, seq = 0;
  const waits = new Map();   // id → { res, rej, prog, want }
  function wk(){
    if (worker) return worker;
    worker = new Worker('js/engine/mc-worker.js?v=' + ver());
    worker.onmessage = e => {
      const d = e.data || {}, w = waits.get(d.id); if (!w) return;
      if (d.t === 'p') { w.prog?.(d.k, d.text); return; }
      if (d.t === 'err') { waits.delete(d.id); w.rej(new Error(d.msg)); return; }
      if (w.want.includes(d.t)) { waits.delete(d.id); w.res(d); }
    };
    worker.onerror = e => { for (const [id, w] of waits) { waits.delete(id); w.rej(new Error('поток импорта: ' + (e.message || 'ошибка'))); } worker = null; };
    return worker;
  }
  const call = (msg, want, prog, transfer) => new Promise((res, rej) => { waits.set(msg.id, { res, rej, prog, want }); wk().postMessage(msg, transfer || []); });

  // ═══ «Основа» чанка: повторы (count, value)… — мир из Minecraft не правками (их было бы миллионы), а слоем ═══
  function rle(cells){
    const out = []; let v = cells[0], n = 0;
    for (let i = 0; i < cells.length; i++) { const c = cells[i]; if (c === v && n < 65535) n++; else { out.push(n, v); v = c; n = 1; } }
    out.push(n, v);
    return Uint16Array.from(out);
  }
  function unrle(u, out){
    let p = 0;
    for (let i = 0; i + 1 < u.length && p < out.length; i += 2) { const n = u[i], v = u[i + 1]; out.fill(v, p, Math.min(out.length, p + n)); p += n; }
    return p;
  }

  // ═══ Цветные блоки «mc:имя» (в Кубомире своего нет) и пакет текстур ═══
  let rp = null, rpLoaded = false;   // { name, tex: { наша: rgba }, mc: { имя: rgba } }
  async function loadRespack(){
    if (rpLoaded) return rp; rpLoaded = true;
    try { const all = await VX().store.mods(); const r = all.find(x => x.id === RESPACK); rp = r ? r.pack : null; } catch (e) { rp = null; }
    return rp;
  }
  async function saveRespack(p){ rp = p; rpLoaded = true; if (p) await VX().store.putMod({ id: RESPACK, pack: p, manifest: { name: p.name } }); else await VX().store.delMod(RESPACK); }
  // картинка 16×16 RGBA из PNG (пакеты 32×, 64× — сглаженно уменьшаем)
  async function png16(bytes){
    const blob = new Blob([bytes], { type: 'image/png' });
    const img = window.createImageBitmap ? await createImageBitmap(blob) : await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('картинка')); i.src = URL.createObjectURL(blob); });
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    const s = Math.min(img.width, img.height);
    g.imageSmoothingEnabled = s > 16; if (g.imageSmoothingEnabled) g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s, s, 0, 0, 16, 16);
    img.close?.();
    return new Uint8Array(g.getImageData(0, 0, 16, 16).data.buffer);
  }
  // перед запуском мира: блоки «mc:…» мира, пакет текстур
  async function beforeWorld(meta){
    const V = VX(), MC = MCx();
    await loadRespack().catch(() => null);
    V.texOverride.clear();
    if (rp?.tex) for (const [k, d] of Object.entries(rp.tex)) if (V.texIdx.has(k) && d?.length === 1024) V.texOverride.set(k, { rgba: d });
    const names = Array.isArray(meta?.mc?.blocks) ? meta.mc.blocks : [];
    if (names.length && MC) registerBlocks(names);
  }
  function registerBlocks(names){
    const V = VX(), MC = MCx(); let n = 0;
    const from = V.blocks.length;
    for (const nm of names) {
      if (typeof nm !== 'string' || !/^mc:[a-z0-9_]{1,64}$/.test(nm) || V.block(nm) || V.blocks.length >= 4000) continue;
      const d = MC.blockDef(nm), k = nm.slice(3);
      const pic = rp?.mc?.[k];
      const spec = pic?.length === 1024 ? { rgba: pic } : d.leaves ? { k: 'leaves', c: d.color } : d.glass ? { k: 'glass', c: d.color } : d.ore ? { k: 'ore', base: '#7d7d80', c: d.color, n: 5 }
        : /planks/.test(k) ? { k: 'planks', c: d.color } : d.pillar ? { k: 'log', c: d.color } : /bricks/.test(k) ? { k: 'bricks', c: d.color, m: '#6b6b6b' } : { k: 'noise', c: d.color, a: /wool|concrete|glazed/.test(k) ? .05 : .12 };
      V.texture(nm, spec);
      const cut = d.cut || d.leaves || d.glass;
      V.defineBlock({ name: nm, title: k.replace(/_/g, ' '), tex: nm, layer: cut ? 2 : 1, opaque: !cut, op: cut ? (d.leaves ? 1 : 0) : 15, emit: d.emit, lcol: d.lcol ? [parseInt(d.lcol.slice(1, 3), 16) / 255, parseInt(d.lcol.slice(3, 5), 16) / 255, parseInt(d.lcol.slice(5, 7), 16) / 255] : undefined,
        hard: d.hard, tool: d.tool, tier: d.tool === 'pick' ? 1 : 0, sound: d.sound, axis: d.pillar, glass: d.glass, foliage: d.leaves, mod: 'mc' });
      n++;
    }
    if (n) { V.blockItems(from); V.compile(); V.iconsReset?.(); }
    return n;
  }

  // ═══ Палитра постройки/мира → наши блоки ═══
  function resolver(bedrock){
    const V = VX(), MC = MCx();
    try { MC.extend(window.KubomirMods?.mcMaps?.() || {}); } catch (e) {}
    const mods = new Set(V.blocks.map(b => b.name).filter(n => n.includes(':') && !n.startsWith('mc:')));
    const cache = new Map(), rep = { unknown: new Map(), thin: 0, approx: 0, flow: 0, mcBlocks: new Set(), mods: new Set() };
    const res = s => {
      let r = cache.get(s); if (r) return r;
      r = MC.resolve(s, { mods, bedrock });
      if (r.unknown) rep.unknown.set(r.mc || s, 0);
      if (r.name.startsWith('mc:')) rep.mcBlocks.add(r.name);
      else if (r.name.includes(':')) rep.mods.add(r.name.split(':')[0]);
      cache.set(s, r);
      return r;
    };
    return { res, rep };
  }
  // счёт для отчёта (сколько клеток каждого неизвестного)
  function tally(rep, r, n){ if (r.unknown) rep.unknown.set(r.mc, (rep.unknown.get(r.mc) || 0) + n); else if (r.thin) rep.thin += n; else if (r.approx) rep.approx += n; else if (r.flow) rep.flow += n; }
  function repHtml(rep, head){
    const un = [...rep.unknown].sort((a, b) => b[1] - a[1]);
    return `<div class="kb-note">${head}</div>`
      + (rep.mcBlocks?.size ? `<div class="kb-note">🎨 Блоков, которых в «Кубомире» нет, сделано по цвету: ${rep.mcBlocks.size} (с пакетом текстур — со своими картинками).</div>` : '')
      + (rep.approx ? `<div class="kb-note">🧱 Ступени, плиты, заборы и стены — целыми блоками своего материала: ${rep.approx}.</div>` : '')
      + (rep.thin ? `<div class="kb-note">🪶 Тонкое (ковры, кнопки, рельсы, таблички, цветы…) пропущено: ${rep.thin}.</div>` : '')
      + (rep.flow ? `<div class="kb-note">💧 Текущая вода и лава убраны (потечёт сама из источников): ${rep.flow}.</div>` : '')
      + (un.length ? `<div class="kb-warn">❓ ${un.length} блоков не нашлись (показаны розово-чёрными): ${un.slice(0, 24).map(([n, c]) => esc(n) + (c ? ' ×' + c : '')).join(', ')}${un.length > 24 ? '…' : ''}. Таблицу можно дополнить модом («minecraft» в mod.json).</div>` : '');
  }

  // ═══ Новый мир: из постройки или области мира ═══
  function newMeta(name, extra){
    const V = VX(), van = V.blocks.slice(0, V.VANILLA_BLOCKS || V.blocks.length).map(b => b.name);
    return Object.assign({ id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || 'Из Minecraft').slice(0, 40), seed: 'minecraft', mode: 'creative', diff: 'peaceful',
      created: Date.now(), played: Date.now(), time: 9, mods: [], palette: van, player: null, v: 1, gen: 'void', mc: { blocks: [] } }, extra || {});
  }
  // палитра мира: имя → номер (новые — в конец)
  function palOf(meta){ const m = new Map(meta.palette.map((n, i) => [n, i])); return n => { let i = m.get(n); if (i === undefined) { i = meta.palette.length; meta.palette.push(n); m.set(n, i); } return i; }; }
  async function saveBase(meta, chunks, prog){
    const V = VX(), recs = [];
    let k = 0;
    for (const [key, cells] of chunks) {
      const [cx, cz] = key.split('|').map(Number);
      recs.push({ cx, cz, e: new Uint32Array(0), t: [], b: rle(cells) });
      if (recs.length >= 64) { await V.store.putChunks(meta.id, recs.splice(0)); prog?.(++k * 64 / chunks.size); }
    }
    if (recs.length) await V.store.putChunks(meta.id, recs);
  }
  // постройка → новый мир: на площадке травы, игрок — перед постройкой
  async function worldFromBuild(b, name, prog){
    const V = VX(), { res, rep } = resolver(b.bedrock), meta = newMeta(name), pal = palOf(meta), CELLS = V.CELLS;
    const hh = Math.min(b.h, H() - 4), base = Math.max(2, Math.min(52, H() - 2 - hh)), ox = -Math.floor(b.w / 2), oz = -Math.floor(b.l / 2);
    const chunks = new Map(), cellsOf = (x, z) => { const k = (x >> 4) + '|' + (z >> 4); let c = chunks.get(k); if (!c) { c = new Uint16Array(CELLS); chunks.set(k, c); } return c; };
    const vals = b.palette.map((s, i) => { if (i === b.hole) return -1; const r = res(s); if (r.name === 'air') return 0; return pal(r.name) | (r.st << 12); });
    // площадка: трава в один слой под всей постройкой и вокруг (8 блоков)
    const grass = pal('grass'), dirt = pal('dirt');
    for (let x = ox - 8; x < ox + b.w + 8; x++) for (let z = oz - 8; z < oz + b.l + 8; z++) { const c = cellsOf(x, z), i = ((x & 15) << 11) | ((z & 15) << 7); c[i | (base - 1)] = grass; c[i | (base - 2)] = dirt; c[i | (base - 3)] = dirt; }
    const counts = new Map();
    for (let y = 0; y < hh; y++) for (let z = 0; z < b.l; z++) for (let x = 0; x < b.w; x++) {
      const pi = b.idx[(y * b.l + z) * b.w + x], v = vals[pi]; counts.set(pi, (counts.get(pi) || 0) + 1);
      if (v <= 0) continue;   // пусто или воздух (мир и так пустой)
      const wx = ox + x, wz = oz + z, c = cellsOf(wx, wz), i = ((wx & 15) << 11) | ((wz & 15) << 7) | (base + y);
      c[i] = v;
    }
    for (const [pi, n] of counts) if (pi !== b.hole) tally(rep, res(b.palette[pi]), n);
    if (b.h > hh) rep.cut = b.h - hh;
    meta.mc.blocks = [...rep.mcBlocks]; meta.mods = [...rep.mods];
    meta.spawn = { x: ox - 4 + .5, y: base + .1, z: oz + b.l + 4 + .5 };
    meta.player = null;
    prog?.(.5, 'сохраняем мир');
    await saveBase(meta, chunks, k => prog?.(.5 + k * .5, 'сохраняем мир'));
    await V.store.putWorld(meta);
    return { meta, rep };
  }
  // область мира → новый мир (координаты как в Minecraft; y — со сдвигом)
  async function worldFromArea(chunks0, o, prog){
    const V = VX(), { res, rep } = resolver(o.bedrock), meta = newMeta(o.name), pal = palOf(meta), CELLS = V.CELLS, h = Math.min(o.h, H());
    const chunks = new Map();
    let k = 0;
    for (const c of chunks0) {
      const vals = c.palette.map(s => { const r = res(s); return r.name === 'air' ? 0 : pal(r.name) | (r.st << 12); });
      const cnt = new Uint32Array(c.palette.length);
      const out = new Uint16Array(CELLS);
      for (let y = 0; y < h; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const pi = c.idx[(y * 16 + z) * 16 + x]; cnt[pi]++;
        out[(x << 11) | (z << 7) | y] = vals[pi];
      }
      for (let i = 0; i < cnt.length; i++) if (cnt[i]) tally(rep, res(c.palette[i]), cnt[i]);
      chunks.set(c.cx + '|' + c.cz, out);
      if ((++k & 15) === 0) prog?.(k / chunks0.length * .5, 'переводим блоки');
    }
    meta.mc.blocks = [...rep.mcBlocks]; meta.mods = [...rep.mods];
    // где появиться: точка мира Minecraft (если в области) или середина области — на верх земли
    const sp = o.spawn && o.spawn.x >= o.area.x0 && o.spawn.x <= o.area.x1 && o.spawn.z >= o.area.z0 && o.spawn.z <= o.area.z1 ? o.spawn : { x: (o.area.x0 + o.area.x1) >> 1, z: (o.area.z0 + o.area.z1) >> 1 };
    const col = chunks.get((sp.x >> 4) + '|' + (sp.z >> 4)); let y = h - 2;
    if (col) { const i = ((sp.x & 15) << 11) | ((sp.z & 15) << 7); y = h - 2; while (y > 1 && !col[i | y]) y--; y++; }
    meta.spawn = { x: sp.x + .5, y: Math.min(H() - 2, y + .1), z: sp.z + .5 };
    prog?.(.5, 'сохраняем мир');
    await saveBase(meta, chunks, q => prog?.(.5 + q * .5, 'сохраняем мир'));
    await V.store.putWorld(meta);
    return { meta, rep };
  }
  // постройка → в открытый мир, перед игроком (только загруженные чанки)
  function pasteBuild(st, b){
    const V = VX(), { res, rep } = resolver(b.bedrock);
    const need = new Set(); for (const s of b.palette) { const r = res(s); if (r.name.startsWith('mc:') && !V.block(r.name)) need.add(r.name); }
    if (need.size) st.addBlocks?.([...need]);
    const P = st.P, f = st.rig ? { x: -Math.sin(st.rig.yaw), z: -Math.cos(st.rig.yaw) } : { x: 0, z: -1 };
    const ox = Math.floor(P.x + f.x * (b.w / 2 + 3) - b.w / 2), oz = Math.floor(P.z + f.z * (b.l / 2 + 3) - b.l / 2), oy = Math.max(1, Math.min(H() - b.h - 1, Math.floor(P.y)));
    const vals = b.palette.map((s, i) => { if (i === b.hole) return -1; const r = res(s); const bl = r.name === 'air' ? V.blocks[0] : V.block(r.name) || V.block('missing'); return bl.id | (r.st << 12); });
    let set = 0, out = 0; const touched = new Set(), counts = new Map();
    for (let y = 0; y < b.h; y++) for (let z = 0; z < b.l; z++) for (let x = 0; x < b.w; x++) {
      const pi = b.idx[(y * b.l + z) * b.w + x], v = vals[pi]; counts.set(pi, (counts.get(pi) || 0) + 1);
      if (v < 0) continue;
      const wx = ox + x, wy = oy + y, wz = oz + z;
      if (wy >= H()) continue;
      if (!st.W.loaded(wx, wz)) { out++; continue; }
      if (st.W.set(wx, wy, wz, v, { silent: true })) { set++; touched.add((wx >> 4) + '|' + (wz >> 4)); }
    }
    for (const [pi, n] of counts) if (pi !== b.hole) tally(rep, res(b.palette[pi]), n);
    for (const k of touched) { const [cx, cz] = k.split('|').map(Number); const c = st.W.chunk(cx, cz); if (c) st.unsaved.add(c.key); st.ST.touch(cx * 16, cz * 16, 2); st.ST.touch(cx * 16 + 15, cz * 16 + 15, 2); }
    return { set, out, rep, at: [ox, oy, oz] };
  }

  // ═══ Пакеты: данные, дополнения, моды .jar, текстуры → моды библиотеки / пакет текстур ═══
  async function installMods(list){
    const done = [], bad = [];
    for (const m of list) {
      try { const r = await window.KubomirMods.install(m.files); done.push(r.m.name); }
      catch (e) { bad.push((m.manifest?.name || m.manifest?.id || 'мод') + ': ' + String(e.message || e).split('\n').slice(0, 2).join('; ')); }
    }
    return { done, bad };
  }
  const applyRespackFiles = (files, name, setStatus) => applyRespack(MCx().respack(files, name), setStatus);
  async function applyRespack(r, setStatus){
    if (!r || !r.count) return { r, ok: false };
    const tex = {}, mc = {}; let k = 0;
    const all = [...Object.entries(r.tex).map(e => ['t', ...e]), ...Object.entries(r.mc).map(e => ['m', ...e])];
    for (const [kind, n, png] of all) {
      try { const d = await png16(png); (kind === 't' ? tex : mc)[n] = d; } catch (e) {}
      if ((++k & 15) === 0) setStatus?.(k / all.length);
    }
    await saveRespack({ name: r.name, tex, mc, added: Date.now(), bedrock: r.bedrock });
    return { r, ok: true, n: Object.keys(tex).length + Object.keys(mc).length };
  }
  function reportPack(rep){
    const un = Object.entries(rep.unsupported || {}).sort((a, b) => b[1] - a[1]);
    return (rep.skipped.length ? `<div class="kb-warn">Пропущено: ${rep.skipped.slice(0, 12).map(esc).join('; ')}${rep.skipped.length > 12 ? '…' : ''}</div>` : '')
      + (un.length ? `<div class="kb-warn">Команды, которых в «Кубомире» нет (строки стали комментариями): ${un.slice(0, 16).map(([c, n]) => esc(c) + ' ×' + n).join(', ')}</div>` : '')
      + rep.notes.map(n => `<div class="kb-note">ℹ️ ${esc(n)}</div>`).join('');
  }

  // ═══ Окно ═══
  function open(sc, o = {}){
    if (!sc) return;
    const st = o.st || null;
    sc.innerHTML = `<div class="kb-menu kb-mc"><h3>📥 Импорт из Minecraft</h3>
      <p class="kb-note">Перетащи файл сюда или выбери. Всё переводится один раз и хранится только в твоём браузере — файлы Minecraft на сайт не уходят.</p>
      <div class="kb-mcdrop" tabindex="0"><b>📂 Выбрать файл</b><small>Постройки: <b>.schem</b>, <b>.schematic</b>, <b>.litematic</b>, <b>.mcstructure</b>, <b>.nbt</b> · Миры: <b>.zip</b> папки мира Java, <b>.mca</b>, <b>.mcworld</b> (Bedrock, «как получится») · <b>.mcaddon</b> / <b>.mcpack</b> (дополнения Bedrock) · <b>.zip</b> пакета данных или текстур · <b>.jar</b> мода Java (только данные)</small></div>
      <input type="file" class="kb-mcfile" accept=".schem,.schematic,.litematic,.mcstructure,.nbt,.mca,.zip,.mcworld,.mcaddon,.mcpack,.jar" hidden>
      <div class="kb-mcprog" hidden><div class="kb-mcbar"><i></i></div><small></small></div>
      <div class="kb-mres" aria-live="polite"></div>
      <div class="kb-mcrp"></div>
      <div class="kb-mbtns"><button type="button" class="kb-btn" data-mc="back">← Назад</button></div>
      <p class="kb-note kb-mclegal">«Кубомир» не связан с Mojang и Microsoft. Импорт читает форматы файлов; картинки Minecraft сайт не хранит и не раздаёт. Моды Java (.jar) переносятся только данными: блоки, предметы, рецепты, картинки — код мода в браузере не запускается (его поведение можно переписать скриптом — <a href="https://github.com/dan4ik37/dan4ik37.github.io/blob/main/docs/MODS.md#перенос-из-minecraft" target="_blank" rel="noopener">инструкция</a>).</p></div>`;
    const res = sc.querySelector('.kb-mres'), pg = sc.querySelector('.kb-mcprog'), bar = pg.querySelector('i'), ptx = pg.querySelector('small');
    const show = (html, bad) => { res.innerHTML = html ? `<div class="${bad ? 'kb-warn' : 'kb-note'}">${html}</div>` : ''; };
    const progress = (k, t) => { pg.hidden = k == null; if (k != null) { bar.style.width = Math.round(k * 100) + '%'; ptx.textContent = t || ''; } };
    sc.querySelector('[data-mc="back"]').onclick = () => { closeAll(); o.back?.(); };
    const drop = sc.querySelector('.kb-mcdrop'), inp = sc.querySelector('.kb-mcfile');
    drop.onclick = () => inp.click();
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); });
    inp.onchange = () => { const f = inp.files?.[0]; inp.value = ''; if (f) take(f); };
    const box = sc.querySelector('.kb-mc');
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drop'); });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) take(f); });
    let cur = 0;
    const closeAll = () => { if (cur) { try { wk().postMessage({ t: 'close', id: cur }); } catch (e) {} cur = 0; } };
    drawRp();
    if (o.file && o.file.name) setTimeout(() => take(o.file), 0);   // файл перетащили на «🧩 Моды»
    async function drawRp(){
      const b = sc.querySelector('.kb-mcrp'); if (!b) return;
      const p = await loadRespack().catch(() => null);
      b.innerHTML = p ? `<div class="kb-mod"><div><b>🖼 Пакет текстур: ${esc(p.name)}</b><small>Картинок: ${Object.keys(p.tex || {}).length + Object.keys(p.mc || {}).length}. Работает во всех мирах (откроется со следующего входа в мир).</small></div><div class="kb-wb"><button type="button" class="kb-btn danger" data-rp="off">Убрать</button></div></div>` : '';
      const off = b.querySelector('[data-rp="off"]'); if (off) off.onclick = async () => { await saveRespack(null); VX().texOverride.clear(); drawRp(); show('Пакет текстур убран — со следующего входа в мир всё как было.'); };
    }
    async function take(file){
      closeAll();
      if (file.size > MAX_FILE) { show('Файл больше 600 МБ — возьми меньшую область мира или постройку.', true); return; }
      show(''); progress(0, 'читаем файл');
      try {
        const buf = await file.arrayBuffer();
        cur = ++seq;
        const d = await call({ t: 'open', id: cur, name: file.name, buf }, ['opened'], progress, [buf]);
        progress(null);
        if (d.kind === 'build') return buildUi(d.build, file.name);
        if (d.kind === 'builds') return buildsUi(d.names, file.name);
        if (d.kind === 'world') return worldUi(file.name, d.bedrock);
        return packUi(d.kind, d.files || {}, file.name, d.info || {});
      } catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); }
    }
    // ── постройка ──
    function buildUi(b, name){
      const { res: rsv, rep } = resolver(b.bedrock), n = b.w * b.h * b.l;
      const used = new Set(); for (let i = 0; i < b.idx.length; i += Math.max(1, Math.floor(b.idx.length / 200000))) used.add(b.idx[i]);
      for (const pi of used) if (pi !== b.hole) rsv(b.palette[pi]);
      const nm = String(b.name || name).split('/').pop().replace(/\.(schem|schematic|litematic|mcstructure|nbt|zip)$/i, '');
      show(`🏗 Постройка «${esc(nm)}»: ${b.w} × ${b.h} × ${b.l} (${n.toLocaleString('ru')} клеток), видов блоков: ${b.palette.length}.${b.h > H() - 4 ? ` Выше ${H() - 4} блоков — верх обрежется.` : ''}`);
      res.insertAdjacentHTML('beforeend', `${rep.unknown.size ? `<div class="kb-warn">❓ Не нашлись: ${[...rep.unknown.keys()].slice(0, 16).map(esc).join(', ')}${rep.unknown.size > 16 ? '…' : ''}</div>` : ''}
        <div class="kb-mbtns">${st ? '<button type="button" class="kb-btn primary" data-b="paste">🏗 Поставить перед собой</button>' : ''}<button type="button" class="kb-btn${st ? '' : ' primary'}" data-b="world">🌍 Новый мир с этой постройкой</button></div>`);
      res.querySelector('[data-b="world"]').onclick = async () => {
        progress(0, 'строим мир');
        try { const r = await worldFromBuild(b, nm, progress); progress(null); done(r.meta, r.rep, `🌍 Мир «${esc(r.meta.name)}» готов: постройка стоит на площадке.`); }
        catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); }
      };
      const pb = res.querySelector('[data-b="paste"]');
      if (pb) pb.onclick = () => {
        try {
          const r = pasteBuild(st, b);
          res.innerHTML = repHtml(r.rep, `✅ Поставлено блоков: ${r.set.toLocaleString('ru')}${r.out ? `, не поместилось (далеко, мир не загружен): ${r.out.toLocaleString('ru')} — подойди ближе или сделай новый мир` : ''}. Угол постройки: ${r.at.join(', ')}.`);
          st.H?.toast('🏗 Постройка поставлена', true);
        } catch (e) { show('⛔ ' + esc(e.message || e), true); }
      };
    }
    function buildsUi(names, name){
      show(`📦 В архиве «${esc(name)}» построек: ${names.length}. Выбери:`);
      res.insertAdjacentHTML('beforeend', `<div class="kb-mods">${names.slice(0, 60).map((n, i) => `<div class="kb-mod"><div><b>${esc(n.split('/').pop())}</b></div><div class="kb-wb"><button type="button" class="kb-btn" data-pick="${i}">Открыть</button></div></div>`).join('')}</div>`);
      res.querySelectorAll('[data-pick]').forEach(bt => bt.onclick = async () => {
        progress(0, 'читаем постройку');
        try { const d = await call({ t: 'build', id: cur, name: names[+bt.dataset.pick] }, ['build'], progress); progress(null); buildUi(d.build, names[+bt.dataset.pick]); }
        catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); }
      });
    }
    // ── мир: карта чанков, область, высота ──
    async function worldUi(name, bedrock){
      progress(0, 'смотрим мир');
      let L;
      try { L = await call({ t: 'list', id: cur }, ['listed'], progress); } catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); return; }
      progress(null);
      const ch = L.chunks; if (!ch.length) { show('В мире нет готовых чанков.', true); return; }
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [cx, cz] of ch) { x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz); }
      const sp = L.spawn && Number.isFinite(L.spawn.x) ? L.spawn : null;
      let ccx = sp ? sp.x >> 4 : (x0 + x1) >> 1, ccz = sp ? sp.z >> 4 : (z0 + z1) >> 1, rad = 6, yFrom = SEA_OFF;
      show(`🌍 Мир «${esc(name)}»${bedrock ? ' (Bedrock — «как получится»)' : ''}: чанков ${ch.length.toLocaleString('ru')}. Выбери область (нажми на карту — середина) и высоту.`);
      res.insertAdjacentHTML('beforeend', `<canvas class="kb-mcmap" width="320" height="320"></canvas>
        <label class="kb-mcrow">Размер области: <input type="range" min="2" max="16" value="${rad}" data-w="rad"> <b data-w="radv"></b></label>
        <label class="kb-mcrow">Высота: Minecraft y от <input type="number" value="${yFrom}" min="-64" max="256" step="1" data-w="y" class="kb-in kb-mcy"> до <b data-w="yv"></b> <small>(в «Кубомире» мир высотой ${H()}; ${SEA_OFF} — уровень моря как у нас)</small></label>
        <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-w="go">🌍 Создать мир из этой области</button></div>`);
      const cv = res.querySelector('.kb-mcmap'), g = cv.getContext('2d'), have = new Set(ch.map(([a, b]) => a + '|' + b));
      const span = Math.max(x1 - x0 + 1, z1 - z0 + 1, 8), sc2 = 320 / span;
      const draw = () => {
        g.fillStyle = '#0d1424'; g.fillRect(0, 0, 320, 320);
        g.fillStyle = '#3f7d4f'; for (const [cx, cz] of ch) g.fillRect((cx - x0) * sc2, (cz - z0) * sc2, Math.max(1, sc2), Math.max(1, sc2));
        g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.strokeRect((ccx - rad - x0) * sc2, (ccz - rad - z0) * sc2, (rad * 2 + 1) * sc2, (rad * 2 + 1) * sc2);
        if (sp) { g.fillStyle = '#ff5050'; g.fillRect(((sp.x >> 4) - x0) * sc2 - 2, ((sp.z >> 4) - z0) * sc2 - 2, 5, 5); }
        const n = [...have].filter(k => { const [a, b] = k.split('|').map(Number); return Math.abs(a - ccx) <= rad && Math.abs(b - ccz) <= rad; }).length;
        res.querySelector('[data-w="radv"]').textContent = `${(rad * 2 + 1) * 16} × ${(rad * 2 + 1) * 16} блоков (чанков с землёй: ${n})`;
        res.querySelector('[data-w="yv"]').textContent = String(yFrom + H() - 1);
      };
      cv.onclick = e => { const r = cv.getBoundingClientRect(); ccx = Math.floor((e.clientX - r.left) / r.width * 320 / sc2) + x0; ccz = Math.floor((e.clientY - r.top) / r.height * 320 / sc2) + z0; draw(); };
      res.querySelector('[data-w="rad"]').oninput = e => { rad = +e.target.value; draw(); };
      res.querySelector('[data-w="y"]').oninput = e => { yFrom = Math.max(-64, Math.min(256, Math.round(+e.target.value || 0))); draw(); };
      draw();
      res.querySelector('[data-w="go"]').onclick = async () => {
        const area = { x0: (ccx - rad) * 16, z0: (ccz - rad) * 16, x1: (ccx + rad) * 16 + 15, z1: (ccz + rad) * 16 + 15 };
        progress(0, 'читаем чанки');
        try {
          const A = await call({ t: 'area', id: cur, area, yMin: yFrom, h: H() }, ['area'], progress);
          if (!A.chunks.length) throw new Error('в этой области нет чанков с блоками');
          progress(.6, 'переводим блоки');
          const r = await worldFromArea(A.chunks, { name: String(name).replace(/\.(zip|mca|mcworld)$/i, ''), area, h: H(), spawn: sp ? { x: sp.x, z: sp.z } : null, bedrock }, (k, t) => progress(.6 + k * .4, t));
          progress(null);
          done(r.meta, r.rep, `🌍 Мир «${esc(r.meta.name)}» готов: чанков ${A.chunks.length}.` + (A.notes?.length ? ` <small>⚠️ ${A.notes.slice(0, 4).map(esc).join('; ')}</small>` : ''));
        } catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); }
      };
    }
    // ── пакеты ──
    async function packUi(kind, files, name, info){
      const MC = MCx();
      try {
        if (kind === 'respack') {
          progress(0, 'картинки пакета');
          const r = await applyRespackFiles(files, name, k => progress(k, 'картинки пакета'));
          progress(null);
          if (!r.ok) { show('В пакете нет знакомых картинок блоков.', true); return; }
          show(`🖼 Пакет текстур «${esc(r.r.name)}» включён: картинок ${r.n}. Откроется со следующего входа в мир. Картинки хранятся только в этом браузере.`);
          drawRp(); return;
        }
        let out;
        if (kind === 'datapack') out = MC.datapack(files, name);
        else if (kind === 'addon') out = MC.addon(files, name);
        else if (kind === 'jar') out = MC.jar(files, name, { classes: info.classes });
        else { show('Не знаю, что в этом архиве: нет построек, мира, пакета данных, дополнения, мода или пакета текстур.', true); return; }
        progress(.5, 'ставим в библиотеку модов');
        const ins = await installMods(out.mods);
        let rpTxt = '';
        if (out.respack) { const r2 = await applyRespack(out.respack).catch(() => null); if (r2?.ok) { rpTxt = ` Картинки ванили из дополнения стали пакетом текстур (${r2.n}).`; drawRp(); } }
        progress(null);
        const R = out.report;
        const head = kind === 'jar'
          ? `☕ Мод Java «${esc(out.info?.name || out.ns || name)}»: перенесено ${R.blocks} блоков, ${R.items} предметов, ${R.recipes} рецептов, картинок ${R.textures}.${R.classes ? ` Код мода (${R.classes} файлов .class) не запускается — его поведение можно переписать на Java по инструкции.` : ''}`
          : kind === 'addon' ? `🧩 Дополнение Bedrock: перенесено ${R.blocks} блоков, ${R.items} предметов, ${R.recipes} рецептов${R.functions ? `, функций ${R.functions}` : ''}${R.scripts ? `, скриптов @minecraft/server ${R.scripts}` : ''}.${rpTxt}`
          : `📜 Пакет данных: рецептов ${R.recipes}${R.functions ? `, функций ${R.functions} (команды /function и по именам)` : ''}.`;
        res.innerHTML = `<div class="kb-note">${head}</div>`
          + (ins.done.length ? `<div class="kb-note">✅ В библиотеке модов: ${ins.done.map(esc).join(', ')}. Включи при создании мира (или в игре: меню → «🧩 Моды мира»).</div>` : '')
          + (ins.bad.length ? `<div class="kb-warn">⛔ ${ins.bad.map(esc).join('<br>')}</div>` : '')
          + reportPack(R);
      } catch (e) { progress(null); show('⛔ ' + esc(e.message || e), true); }
    }
    function done(meta, rep, head){
      res.innerHTML = repHtml(rep, head) + `<div class="kb-mbtns"><button type="button" class="kb-btn primary" data-go>▶ Играть</button></div>`;
      res.querySelector('[data-go]').onclick = () => { closeAll(); o.play?.(meta.id); };
    }
  }

  window.KubomirMC = { open, beforeWorld, registerBlocks, rle, unrle, loadRespack, _test: { worldFromBuild, worldFromArea, pasteBuild, resolver, rle, unrle, applyRespackFiles, saveRespack } };
})();
