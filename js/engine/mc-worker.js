// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — поток переноса из Minecraft: распаковка, NBT, регионы и LevelDB — тяжёлое не в кадре, с полоской прогресса
// ═══════════════════════════════════════
// new Worker('js/engine/mc-worker.js?v=…') — сам подгружает mc-nbt.js, mc-map.js, mc-formats.js, mc-packs.js с тем же ?v=.
// Сообщения (id — номер файла в сеансе):
//   { t: 'open', id, name, buf } → { t: 'opened', id, kind, names, files? (пакеты — разобранные файлы назад), build?, info }
//   { t: 'list', id } → { t: 'listed', id, chunks: [[cx, cz]…], spawn }        — мир: какие чанки есть
//   { t: 'area', id, area, yMin, h } → { t: 'area', id, chunks: [{ cx, cz, palette, idx }], notes }
//   { t: 'build', id, name } → { t: 'build', id, build }                        — одна постройка из архива
//   { t: 'close', id }; прогресс — { t: 'p', id, k: 0…1, text }; ошибка — { t: 'err', id, msg }.
// Подключён обычным <script> в окне (список файлов игры) — ничего не делает.
(() => {
  if (typeof window !== 'undefined' || typeof importScripts !== 'function') return;
  const q = (self.location && self.location.search) || '';
  importScripts('mc-nbt.js' + q, 'mc-map.js' + q, 'mc-formats.js' + q, 'mc-packs.js' + q);
  const MC = self.D37E.mc;
  const S = new Map();   // id → { name, kind, u8?, files? }
  const prog = (id, k, text) => self.postMessage({ t: 'p', id, k: Math.max(0, Math.min(1, k)), text });
  const tr = b => { const out = []; const add = a => { if (a && a.buffer && !out.includes(a.buffer)) out.push(a.buffer); }; if (b) { add(b.idx); } return out; };
  async function open(d){
    const u8 = new Uint8Array(d.buf), name = String(d.name || '');
    const kind0 = MC.sniff(name, u8);
    const s = { name, kind: kind0 };
    S.set(d.id, s);
    // одиночные файлы
    if (['schem', 'schematic', 'litematic', 'mcstructure', 'structure'].includes(kind0)) {
      prog(d.id, .2, 'читаем постройку');
      const b = await MC.readBuild(name, u8);
      self.postMessage({ t: 'opened', id: d.id, kind: 'build', names: [name], build: b }, tr(b));
      return;
    }
    if (kind0 === 'region') {
      s.kind = 'world'; s.regions = { [name.split('/').pop()]: u8 };
      self.postMessage({ t: 'opened', id: d.id, kind: 'world', names: [name] });
      return;
    }
    if (!(u8[0] === 0x50 && u8[1] === 0x4b)) {
      // может быть NBT (постройка с другим расширением)
      try { const b = await MC.readBuild(name, u8); self.postMessage({ t: 'opened', id: d.id, kind: 'build', names: [name], build: b }, tr(b)); return; }
      catch (e) { throw new Error('не знаю этот файл: ' + name + ' (нужны .schem, .schematic, .litematic, .mcstructure, .nbt, .mca, .zip мира, .mcworld, .mcaddon, .mcpack, .jar или .zip пакета)'); }
    }
    // архив
    prog(d.id, .02, 'распаковываем');
    let classes = 0;
    let files = await MC.unzip(u8, (p, sz) => { if (/\.class$/i.test(p)) { classes++; return false; } return !/\.(ogg|fsb|wav|mp3|txt|md)$/i.test(p) && sz < 256e6; }, { progress: k => prog(d.id, .02 + k * .5, 'распаковываем') });
    // .mcaddon — пакеты .mcpack внутри (zip в zip)
    for (const [p, f] of Object.entries(files)) if (/\.(mcpack|zip)$/i.test(p) && f[0] === 0x50 && f[1] === 0x4b) {
      try { const inner = await MC.unzip(f); delete files[p]; const dir = p.replace(/\.(mcpack|zip)$/i, '') + '/'; for (const [k, v] of Object.entries(inner)) files[dir + k] = v; } catch (e) {}
    }
    // папка в корне архива (мир «Мой мир/region/…», пакет «pack/assets/…») — снять
    files = stripTop(files);
    const kind = MC.kindOfZip(files, name);
    s.files = files; s.kind = kind;
    if (kind === 'javaworld' || kind === 'mcworld') {
      self.postMessage({ t: 'opened', id: d.id, kind: 'world', bedrock: kind === 'mcworld', names: Object.keys(files).filter(k => /\.mca$|level\.dat$/i.test(k)).slice(0, 200) });
      return;
    }
    if (kind === 'builds') {
      const names = Object.keys(files).filter(k => /\.(schem|schematic|litematic|mcstructure|nbt)$/i.test(k));
      self.postMessage({ t: 'opened', id: d.id, kind: 'builds', names });
      return;
    }
    // пакеты (данные, дополнения, моды .jar, текстуры) — разбор в окне (там картинки и библиотека модов)
    const keep = {};
    for (const [k, v] of Object.entries(files)) if (/\.(json|mcfunction|lang|png|mcmeta|toml|info|js)$/i.test(k) || /level\.dat$/.test(k)) keep[k] = v;
    S.delete(d.id);
    self.postMessage({ t: 'opened', id: d.id, kind, names: Object.keys(keep).slice(0, 50), files: keep, info: { classes } }, Object.values(keep).map(v => v.buffer).filter((b, i, a) => a.indexOf(b) === i));
  }
  function stripTop(files){
    const ks = Object.keys(files); if (!ks.length) return files;
    const top = ks[0].split('/')[0];
    if (ks.every(k => k.includes('/') && k.split('/')[0] === top) && !/^(assets|data|region|db|textures|blocks|items|scripts|functions|recipes)$/.test(top)) {
      const out = {}; for (const k of ks) out[k.slice(top.length + 1)] = files[k]; return out;
    }
    return files;
  }
  // регионы мира Java: { 'r.0.0.mca': u8 } (из .zip — region/…)
  const regionsOf = s => s.regions || Object.fromEntries(Object.entries(s.files || {}).filter(([k]) => /(^|\/)region\/r\.-?\d+\.-?\d+\.mca$/i.test(k)).map(([k, v]) => [k.split('/').pop(), v]));
  async function list(d){
    const s = S.get(d.id); if (!s) throw new Error('файл уже закрыт');
    const out = new Map(); let spawn = null;
    if (s.kind === 'mcworld') { const r = await MC.readMcworld(s.files, { listOnly: true, progress: k => prog(d.id, k, 'читаем базу мира') }); for (const k of r.chunks.keys()) out.set(k, 1); spawn = r.spawn; }
    else {
      const R = regionsOf(s), names = Object.keys(R);
      for (let i = 0; i < names.length; i++) { await MC.readRegion(R[names[i]], names[i], { listOnly: true, out }); prog(d.id, (i + 1) / names.length, 'смотрим регионы'); }
      const ld = s.files && Object.keys(s.files).find(k => /(^|\/)level\.dat$/i.test(k) && !/_old$/.test(k));
      if (ld) { try { const raw = await MC.unpack(s.files[ld]); const L = MC.nbt(raw).value.Data || {}; spawn = { x: L.SpawnX | 0, y: L.SpawnY | 0, z: L.SpawnZ | 0 }; } catch (e) {} }
    }
    self.postMessage({ t: 'listed', id: d.id, chunks: [...out.keys()].map(k => k.split('|').map(Number)), spawn });
  }
  async function area(d){
    const s = S.get(d.id); if (!s) throw new Error('файл уже закрыт');
    const o = { area: d.area, yMin: d.yMin, h: d.h };
    let res;
    if (s.kind === 'mcworld') res = await MC.readMcworld(s.files, Object.assign(o, { progress: k => prog(d.id, k, 'читаем базу мира') }));
    else {
      const R = regionsOf(s), names = Object.keys(R).filter(n => { const m = /r\.(-?\d+)\.(-?\d+)\.mca$/i.exec(n); if (!m || !d.area) return true; const rx = +m[1] * 512, rz = +m[2] * 512; return rx + 511 >= d.area.x0 && rx <= d.area.x1 && rz + 511 >= d.area.z0 && rz <= d.area.z1; });
      const out = new Map(), notes = [];
      let total = 0;
      for (let i = 0; i < names.length; i++) {
        await MC.readRegion(R[names[i]], names[i], Object.assign({}, o, { out, notes, progress: n => prog(d.id, (i + Math.min(1, (total + n) / 1024)) / names.length, 'читаем чанки') }));
        prog(d.id, (i + 1) / names.length, 'читаем чанки');
      }
      res = { chunks: out, notes };
    }
    const chunks = [...res.chunks.values()].filter(c => c.idx);
    self.postMessage({ t: 'area', id: d.id, chunks, notes: res.notes || [] }, chunks.map(c => c.idx.buffer));
  }
  async function build(d){
    const s = S.get(d.id); if (!s || !s.files) throw new Error('файл уже закрыт');
    const f = s.files[d.name]; if (!f) throw new Error('нет ' + d.name);
    const b = await MC.readBuild(d.name, f);
    self.postMessage({ t: 'build', id: d.id, build: b }, tr(b));
  }
  self.onmessage = async e => {
    const d = e.data || {};
    try {
      if (d.t === 'open') await open(d);
      else if (d.t === 'list') await list(d);
      else if (d.t === 'area') await area(d);
      else if (d.t === 'build') await build(d);
      else if (d.t === 'close') S.delete(d.id);
    } catch (err) { self.postMessage({ t: 'err', id: d.id, msg: String(err && err.message || err) }); }
  };
})();
