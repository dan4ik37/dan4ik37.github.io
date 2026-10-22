// ═══════════════════════════════════════
//  D37E.mapkit — мини-карта, точки, имена точек (T-049, docs/plans/kubomir-modpacks.md §4.6; общий модуль §3.3: «Кубомир» —
//  атлас (аксессуар), потом телефон «Мира Денчика», пещеры «Подземья», карта «Студии 3D»)
// ═══════════════════════════════════════
// Мини-карта — «окно» на холсте: 10 × 10 участков по 16 клеток вокруг игрока; участок рисуется в окно ОДИН раз (и заново — только
// когда поменялся), кадр карты — один drawImage окна + метки. Ушёл на 2 участка — окно сдвигается (старое переносится, новое
// дорисовывается). Без мусора за кадр: один ImageData 16×16 на всё; значки меток — готовыми картинками (не fillText на кадр).
//   M = D37E.mapkit.minimap(родитель, { size: 128, cls, onTap })
//   M.frame(x, z, yaw, tiles, marks) — нарисовать (сама решает, нужно ли: сдвиг ≥ 0,5 клетки, поворот ≥ 3°, новый участок, метки)
//     tiles — переходник игры: { rev(cx, cz) → номер правки участка или −1 (нет участка), fill(cx, cz, out Uint32Array(256)) → true }
//     marks — [{ x, z, ic, col }] (дом, вещи после нокаута, свои точки); за краем — точкой на краю
//   M.dirty(cx, cz) — участок поменялся (правка блока); M.show(вкл); M.dispose()
//   D37E.mapkit.cleanName(текст, 24) — имя точки: без ссылок, телефонов, @ников, мата и невидимых знаков
//   D37E.mapkit.ICONS — 24 значка точек, COLORS — 8 цветов; D37E.mapkit.shade(rgba, k) — светлее / темнее (рельеф)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const doc = root.document;
  const ICONS = ['📍', '🏠', '⛏', '💎', '🌲', '🏔', '🌊', '🏰', '🗿', '⭐', '❤', '⚔', '🔥', '🌾', '🐄', '🧟', '🚪', '🪜', '🕳', '⛺', '🎁', '🍎', '🧭', '🏁'];
  const COLORS = ['#ff5a5a', '#ffb02e', '#ffe14a', '#5fd36a', '#3fc7ff', '#5a7dff', '#c06bff', '#ffffff'];
  const CSS = `
.d37mm{position:absolute;right:10px;top:10px;border-radius:12px;overflow:hidden;border:2px solid rgba(255,255,255,.22);box-shadow:0 4px 14px rgba(0,0,0,.45);background:#0b1220;pointer-events:auto;cursor:pointer;touch-action:manipulation}
.d37mm[hidden]{display:none}
.d37mm canvas{display:block;image-rendering:pixelated}
.d37mm b{position:absolute;left:50%;top:2px;transform:translateX(-50%);font:800 10px Montserrat,system-ui,sans-serif;color:#ff6b6b;text-shadow:0 1px 2px #000;pointer-events:none}
`;
  function css(){ if (!doc || doc.getElementById('d37-mapkit-css')) return; const s = doc.createElement('style'); s.id = 'd37-mapkit-css'; s.textContent = CSS; doc.head.appendChild(s); }
  // RGBA в Uint32 (little-endian: 0xAABBGGRR) и обратно
  const pack = (r, g, b, a = 255) => ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
  const shade = (c, k) => { const r = Math.min(255, (c & 255) * k), g = Math.min(255, (c >>> 8 & 255) * k), b = Math.min(255, (c >>> 16 & 255) * k); return pack(r, g, b, c >>> 24); };

  const N = 10, T = 16;   // окно: 10 × 10 участков по 16
  // значок метки — картинкой: fillText эмодзи на каждом кадре карты стоил больше всего остального вместе (подбор цветного шрифта
  // на телефоне — ~1 мс на значок); рисуем каждый значок один раз на размер и дальше копируем drawImage
  const ICON_CV = new Map();   // размер → (значок → холст)
  function iconCv(ic, px){
    let m = ICON_CV.get(px); if (!m) ICON_CV.set(px, m = new Map());
    let c = m.get(ic);
    if (c) return c;
    if (m.size > 96) m.clear();
    const s = Math.ceil(px * 1.35); c = doc.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'); g.font = px + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ic, s / 2, s / 2 + px * .06);
    m.set(ic, c);
    return c;
  }
  function minimap(parent, o = {}){
    if (!doc || !parent) return null;
    css();
    const size = o.size || 128, dpr = Math.min(2, root.devicePixelRatio || 1);
    const el = doc.createElement('div'); el.className = 'd37mm' + (o.cls ? ' ' + o.cls : ''); el.style.width = el.style.height = size + 'px';
    el.innerHTML = '<canvas></canvas><b>С</b>';
    const cv = el.querySelector('canvas'); cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = size + 'px';
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const win = doc.createElement('canvas'); win.width = win.height = N * T;
    const wg = win.getContext('2d', { willReadFrequently: false }); wg.imageSmoothingEnabled = false;
    const tmp = doc.createElement('canvas'); tmp.width = tmp.height = N * T; const tg = tmp.getContext('2d');
    const img = wg.createImageData(T, T), px = new Uint32Array(img.data.buffer);
    const revs = new Int32Array(N * N).fill(-2), revs2 = new Int32Array(N * N);   // какой номер правки участка нарисован (−2 — ничего)
    const IPX = Math.round(12 * dpr);
    let ax = 0, az = 0, anchored = false, lastX = NaN, lastZ = NaN, lastYaw = NaN, need = true, scanI = 0, markKey = 0;
    parent.appendChild(el);
    if (o.onTap) el.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); o.onTap(e); });
    const M = { el, size };
    M.dirty = (cx, cz) => { const i = cx - ax, j = cz - az; if (i >= 0 && j >= 0 && i < N && j < N) { revs[j * N + i] = -3; need = true; } };
    // окно — вокруг участка (cx, cz); сдвиг — перенос уже нарисованного
    function anchor(cx, cz){
      const nx = cx - (N >> 1), nz = cz - (N >> 1);
      if (anchored && nx === ax && nz === az) return;
      const dx = nx - ax, dz = nz - az;
      if (anchored && Math.abs(dx) < N && Math.abs(dz) < N) {
        tg.clearRect(0, 0, N * T, N * T); tg.drawImage(win, 0, 0);
        wg.clearRect(0, 0, N * T, N * T); wg.drawImage(tmp, -dx * T, -dz * T);
        const old = revs2; old.set(revs); revs.fill(-2);   // раз в несколько участков пути — не за кадр
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const oi = i + dx, oj = j + dz; if (oi >= 0 && oj >= 0 && oi < N && oj < N) revs[j * N + i] = old[oj * N + oi]; }
        drawnN = 0; for (let k = 0; k < N * N; k++) if (revs[k] !== -2) drawnN++;
      } else { wg.clearRect(0, 0, N * T, N * T); revs.fill(-2); drawnN = 0; }
      ax = nx; az = nz; anchored = true; need = true;
    }
    // дорисовать участки, которые появились или поменялись (не больше k за кадр; пока окно почти пустое — быстрее)
    let drawnN = 0;
    function refresh(tiles, k){
      if (drawnN < N * N / 2) k *= 3;
      let n = 0;
      for (let s = 0; s < N * N && n < k; s++) {
        const idx = (scanI + s) % (N * N), i = idx % N, j = (idx / N) | 0, cx = ax + i, cz = az + j;
        const r = tiles.rev(cx, cz); if (r < 0 || r === revs[idx]) continue;
        if (!tiles.fill(cx, cz, px)) continue;
        if (revs[idx] === -2) drawnN++;
        wg.putImageData(img, i * T, j * T); revs[idx] = r; n++; need = true;
      }
      scanI = (scanI + 17) % (N * N);
      return n;
    }
    M.frame = (x, z, yaw, tiles, marks, mk) => {
      const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
      if (!anchored || Math.abs(cx - (ax + (N >> 1))) > 1 || Math.abs(cz - (az + (N >> 1))) > 1) anchor(cx, cz);
      refresh(tiles, 4);
      const moved = !(Math.abs(x - lastX) < .5 && Math.abs(z - lastZ) < .5), turned = !(Math.abs(yaw - lastYaw) < .05);
      if (!need && !moved && !turned && mk === markKey) return false;
      lastX = x; lastZ = z; lastYaw = yaw; markKey = mk; need = false;
      // окно → карта: игрок в середине, видно size / scale клеток
      const W = cv.width, sc = W / 96, sx = x - ax * T - 48, sz = z - az * T - 48;
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, W);
      g.drawImage(win, sx, sz, 96, 96, 0, 0, W, W);
      // метки: внутри — значок, за краем — точка на краю
      const c = W / 2;
      if (marks) for (let q = 0; q < marks.length; q++) {
        const m = marks[q]; let mx = (m.x - x) * sc, mz = (m.z - z) * sc;
        const lim = c - 7 * dpr, far = Math.abs(mx) > lim || Math.abs(mz) > lim;
        if (far) { const k = lim / Math.max(Math.abs(mx), Math.abs(mz)); mx *= k; mz *= k; g.fillStyle = m.col || '#ffd23f'; g.beginPath(); g.arc(c + mx, c + mz, 3.2 * dpr, 0, 6.2832); g.fill(); continue; }
        const ic = iconCv(m.ic || '📍', IPX), h = ic.width >> 1; g.drawImage(ic, Math.round(c + mx) - h, Math.round(c + mz) - h);
      }
      // игрок — стрелка по взгляду (север — вверх)
      g.translate(c, c); g.rotate(-yaw);
      g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(0, -7 * dpr); g.lineTo(5 * dpr, 6 * dpr); g.lineTo(0, 3 * dpr); g.lineTo(-5 * dpr, 6 * dpr); g.closePath(); g.fill(); g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0);
      return true;
    };
    let shown = true;
    M.show = v => { v = !!v; if (v !== shown) { shown = v; el.hidden = !v; if (v) need = true; } };
    M.dispose = () => { el.remove(); };
    M.stats = () => ({ anchor: [ax, az], drawn: revs.reduce((a, r) => a + (r >= 0 ? 1 : 0), 0) });
    return M;
  }

  // ═══ имя точки: без ссылок, телефонов, @ников, невидимых знаков и мата (своё — только у себя, но правило сайта) ═══
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  const BAD = [/ху[йеёяюи]/u, /п[иеё]зд/u, /бля/u, /[её]б[аеуиыл]/u, /сук[аиу]/u, /муда[кч]/u, /пид[ао]р/u, /шлюх/u, /залуп/u, /дроч/u, /fuck/u, /shit/u, /bitch/u];
  function cleanName(s0, max = 24){
    const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028) + '-' + String.fromCharCode(0x202e) + ']', 'g');
    let s = String(s0 ?? '').replace(CTRL, '').replace(/\s+/g, ' ').trim();
    s = s.replace(/(?:https?:\/\/|www\.)\S*/giu, '').replace(/\S+\.(?:ru|com|net|org|io|me|gg|su|рф|kz|xyz|app|tv)\b\S*/giu, '').replace(/@\S+/g, '').replace(/\+?\d[\d\s()-]{5,}\d/g, '');
    const raw = s.toLowerCase(), low = [...raw].map(c => LAT[c] || c).join('');   // латиница «под кириллицу» и как есть
    if (BAD.some(re => re.test(low) || re.test(raw))) s = '';
    s = s.replace(/\s+/g, ' ').trim();
    return [...s].slice(0, max).join('');
  }
  E.mapkit = { minimap, cleanName, ICONS, COLORS, pack, shade };
})();
