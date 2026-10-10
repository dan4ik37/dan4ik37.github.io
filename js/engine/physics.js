// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — физика «2,5D»: персонаж-капсула против статичного мира (коробки и цилиндры), ступеньки,
//  прыжки, потолки, зоны-триггеры, луч (клик по миру), сетка проходимости и путь A*
// ═══════════════════════════════════════
// Без Three.js и DOM — проверяется в node. Мир: стоячие коробки (box: центр, полуразмеры, поворот вокруг Y)
// и вертикальные цилиндры (cyl). Персонаж не наклоняется: в плане он круг радиуса r, по высоте — [y, y + h].
// Препятствие сбоку — то, что выше ступеньки (top > y + step); на всё, что ниже, персонаж заходит сам.
// Единицы — метры движка (человечек ≈ 2,3 высотой), ось Y вверх.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const CELL = 4;

  class Phys {
    constructor(o = {}){
      this.ground = o.ground ?? 0;          // высота земли (плоскость), null — без земли (падать бесконечно)
      this.grid = new Map();
      this.cols = new Set();
      this.seq = 0;
      this.qmark = 0;
    }
    // ── Добавить/убрать тело ──
    addBox(o){
      const c = { type: 'box', x: +o.x || 0, y: +o.y || 0, z: +o.z || 0, hx: Math.abs(o.hx), hy: Math.abs(o.hy), hz: Math.abs(o.hz), yaw: +o.yaw || 0,
        trigger: !!o.trigger, tag: o.tag || '', data: o.data ?? null, solid: o.solid !== false, id: ++this.seq, mark: 0 };
      c.cos = Math.cos(c.yaw); c.sin = Math.sin(c.yaw);
      const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hz, ez = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hz;
      c.minx = c.x - ex; c.maxx = c.x + ex; c.minz = c.z - ez; c.maxz = c.z + ez;
      c.bottom = c.y - c.hy; c.top = c.y + c.hy;
      return this._add(c);
    }
    addCyl(o){
      const c = { type: 'cyl', x: +o.x || 0, y: +o.y || 0, z: +o.z || 0, r: Math.abs(o.r), hy: Math.abs(o.hy), trigger: !!o.trigger, tag: o.tag || '',
        data: o.data ?? null, solid: o.solid !== false, id: ++this.seq, mark: 0 };
      c.minx = c.x - c.r; c.maxx = c.x + c.r; c.minz = c.z - c.r; c.maxz = c.z + c.r;
      c.bottom = c.y - c.hy; c.top = c.y + c.hy;
      return this._add(c);
    }
    _add(c){
      this.cols.add(c);
      for (let gx = Math.floor(c.minx / CELL); gx <= Math.floor(c.maxx / CELL); gx++)
        for (let gz = Math.floor(c.minz / CELL); gz <= Math.floor(c.maxz / CELL); gz++) {
          const k = gx + ',' + gz;
          let list = this.grid.get(k);
          if (!list) { list = []; this.grid.set(k, list); }
          list.push(c);
        }
      return c;
    }
    remove(c){
      if (!c || !this.cols.delete(c)) return;
      for (let gx = Math.floor(c.minx / CELL); gx <= Math.floor(c.maxx / CELL); gx++)
        for (let gz = Math.floor(c.minz / CELL); gz <= Math.floor(c.maxz / CELL); gz++) {
          const list = this.grid.get(gx + ',' + gz);
          if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
        }
    }
    clear(){ this.grid.clear(); this.cols.clear(); }
    // Все тела, чей прямоугольник в плане задевает область (без повторов)
    query(minx, minz, maxx, maxz, out = []){
      const mark = ++this.qmark;
      for (let gx = Math.floor(minx / CELL); gx <= Math.floor(maxx / CELL); gx++)
        for (let gz = Math.floor(minz / CELL); gz <= Math.floor(maxz / CELL); gz++) {
          const list = this.grid.get(gx + ',' + gz);
          if (!list) continue;
          for (const c of list) {
            if (c.mark === mark || c.maxx < minx || c.minx > maxx || c.maxz < minz || c.minz > maxz) continue;
            c.mark = mark; out.push(c);
          }
        }
      return out;
    }

    // ── Круг (x, z, r) против следа тела в плане: { d: глубина, nx, nz: куда выталкивать } или null ──
    static circleHit(c, x, z, r){
      if (c.type === 'cyl') {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), rr = r + c.r;
        if (d >= rr) return null;
        if (d < 1e-6) return { d: rr, nx: 1, nz: 0 };
        return { d: rr - d, nx: dx / d, nz: dz / d };
      }
      // в систему коробки (поворот на −yaw): local = R(−yaw) · (p − c)
      const px = x - c.x, pz = z - c.z;
      const lx = c.cos * px - c.sin * pz, lz = c.sin * px + c.cos * pz;
      const cx = Math.max(-c.hx, Math.min(c.hx, lx)), cz = Math.max(-c.hz, Math.min(c.hz, lz));
      let dx = lx - cx, dz = lz - cz, d = Math.hypot(dx, dz), nlx, nlz, depth;
      if (d > 1e-6) {
        if (d >= r) return null;
        nlx = dx / d; nlz = dz / d; depth = r - d;
      } else {
        // центр внутри коробки — выталкиваем через ближнюю грань
        const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
        if (ox < oz) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = ox + r; }
        else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = oz + r; }
      }
      // обратно в мир: R(yaw)
      return { d: depth, nx: c.cos * nlx + c.sin * nlz, nz: -c.sin * nlx + c.cos * nlz };
    }
    // Точка (x, z) внутри следа тела, с запасом pad (pad > 0 — шире)
    static inside(c, x, z, pad = 0){
      if (c.type === 'cyl') return Math.hypot(x - c.x, z - c.z) <= c.r + pad;
      const px = x - c.x, pz = z - c.z, lx = c.cos * px - c.sin * pz, lz = c.sin * px + c.cos * pz;
      return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad;
    }

    // ── Персонаж ──
    character(o = {}){
      return { x: o.x || 0, y: o.y ?? this.ground ?? 0, z: o.z || 0, vx: 0, vy: 0, vz: 0, r: o.r || .42, h: o.h || 2.1, step: o.step ?? .62,
        g: o.g || 40, jumpV: o.jumpV || 11.3, grounded: true, onCol: null, inside: new Set(), airT: 0, landed: 0 };
    }
    // Высота опоры под кругом (x, z, r): самая высокая крыша не выше yMax (и земля)
    supportAt(x, z, r, yMax, skip){
      let best = this.ground == null ? -Infinity : this.ground, col = null;
      const list = this.query(x - r, z - r, x + r, z + r, this._tmp || (this._tmp = []));
      for (const c of list) {
        if (c.trigger || !c.solid || c === skip || c.top > yMax + 1e-4) continue;
        if (c.top <= best) continue;
        if (Phys.circleHit(c, x, z, r * .7) || Phys.inside(c, x, z)) { best = c.top; col = c; }
      }
      list.length = 0;
      return { y: best, col };
    }
    // Один шаг движения персонажа: wish — желаемое направление (x, z, длина 0…1), speed, jump
    move(ch, dt, wish = { x: 0, z: 0 }, speed = 0, jump = false){
      // разгон к нужной скорости (на земле быстро, в воздухе плавнее; ch.accG / ch.accA — свои)
      const acc = (ch.grounded ? ch.accG ?? 46 : ch.accA ?? 16) * dt, tx = (wish.x || 0) * speed, tz = (wish.z || 0) * speed;
      ch.vx += Math.max(-acc * (Math.abs(tx - ch.vx) > 3 ? 1.6 : 1), Math.min(acc * (Math.abs(tx - ch.vx) > 3 ? 1.6 : 1), tx - ch.vx));
      ch.vz += Math.max(-acc * (Math.abs(tz - ch.vz) > 3 ? 1.6 : 1), Math.min(acc * (Math.abs(tz - ch.vz) > 3 ? 1.6 : 1), tz - ch.vz));
      if (jump && ch.grounded) { ch.vy = ch.jumpV; ch.grounded = false; ch.airT = 0; }
      this.slide(ch, ch.vx * dt, ch.vz * dt);
      this.fall(ch, dt);
      this.triggers(ch);
      return ch;
    }
    // По горизонтали на (mx, mz) — короткими шажками, чтобы не проскочить тонкую стену; упёрся — скользит вдоль
    slide(ch, mx, mz){
      const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (ch.r * .5)));
      for (let i = 0; i < n; i++) { ch.x += mx / n; ch.z += mz / n; this.pushOut(ch); }
    }
    // По вертикали: стоит — держится опоры (ступеньки вверх/вниз), в воздухе — тяжесть, потолок, приземление.
    // ch.impact — скорость удара о землю в момент приземления (для «жёсткого приземления» и камеры)
    fall(ch, dt){
      ch.landed = 0; ch.impact = 0;
      if (ch.grounded) {
        const s = this.supportAt(ch.x, ch.z, ch.r, ch.y + ch.step);
        if (s.y >= ch.y - ch.step - 1e-4) { ch.y = s.y; ch.vy = 0; ch.onCol = s.col; }   // ступенька вверх/вниз — идём по ней
        else { ch.grounded = false; ch.vy = Math.min(ch.vy, 0); ch.airT = 0; }          // шагнули с края — падаем
      }
      if (!ch.grounded) {
        ch.airT += dt;
        ch.vy -= ch.g * dt;
        let ny = ch.y + ch.vy * dt;
        if (ch.vy > 0) {   // потолок: тело над головой
          const list = this.query(ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r, []);
          for (const c of list) {
            if (c.trigger || !c.solid) continue;
            if (c.bottom >= ch.y + ch.h - 1e-3 && ny + ch.h > c.bottom && Phys.circleHit(c, ch.x, ch.z, ch.r * .8)) { ny = c.bottom - ch.h; ch.vy = 0; }
          }
        }
        const s = this.supportAt(ch.x, ch.z, ch.r, Math.max(ch.y, ny) + (ch.vy <= 0 ? .05 : 0));
        if (ch.vy <= 0 && ny <= s.y) { ch.impact = -ch.vy; ch.landed = Math.min(1, -ch.vy / 25); ny = s.y; ch.vy = 0; ch.grounded = true; ch.onCol = s.col; }
        ch.y = ny;
        if (this.ground != null && ch.y < this.ground - 60) { ch.y = this.ground; ch.vy = 0; ch.grounded = true; }   // упал за край мира — обратно
      }
    }
    // Есть ли твёрдое тело в вертикальном цилиндре (x, z, r) от y0 до y1 (влезет ли тело: присесть, встать, залезть)
    blocked(x, z, y0, y1, r, skip){
      const list = this.query(x - r, z - r, x + r, z + r, []);
      for (const c of list) {
        if (c.trigger || !c.solid || c === skip || c.top <= y0 + 1e-3 || c.bottom >= y1 - 1e-3) continue;
        if (Phys.circleHit(c, x, z, r)) return c;
      }
      return null;
    }
    // Вытолкнуть из стен (2 прохода) и погасить скорость в стену — скольжение вдоль
    pushOut(ch){
      for (let it = 0; it < 3; it++) {
        let moved = false;
        const list = this.query(ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r, this._tmp2 || (this._tmp2 = []));
        for (const c of list) {
          if (c.trigger || !c.solid) continue;
          if (c.top <= ch.y + ch.step + 1e-4 || c.bottom >= ch.y + ch.h - .02) continue;   // ниже ступеньки или над головой
          const hit = Phys.circleHit(c, ch.x, ch.z, ch.r);
          if (!hit) continue;
          ch.x += hit.nx * hit.d; ch.z += hit.nz * hit.d;
          const vn = ch.vx * hit.nx + ch.vz * hit.nz;
          if (vn < 0) { ch.vx -= vn * hit.nx; ch.vz -= vn * hit.nz; }
          moved = true;
        }
        list.length = 0;
        if (!moved) break;
      }
    }
    // Зоны-триггеры: ch.inside — где сейчас; события enter/exit — в ch.events (их забирает игра)
    triggers(ch){
      const now = new Set(), list = this.query(ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r, []);
      for (const c of list) {
        if (!c.trigger || c.top < ch.y || c.bottom > ch.y + ch.h) continue;
        if (Phys.inside(c, ch.x, ch.z)) now.add(c);
      }
      const ev = ch.events || (ch.events = []);
      for (const c of now) if (!ch.inside.has(c)) ev.push({ type: 'enter', col: c });
      for (const c of ch.inside) if (!now.has(c)) ev.push({ type: 'exit', col: c });
      ch.inside = now;
    }

    // ── Луч: от (ox, oy, oz) по (dx, dy, dz) (нормирован), ближайшее твёрдое тело или земля ──
    raycast(ox, oy, oz, dx, dy, dz, maxT = 500, filter){
      let best = { t: maxT, col: null, nx: 0, ny: 1, nz: 0 };
      if (this.ground != null && dy < -1e-6) { const t = (this.ground - oy) / dy; if (t >= 0 && t < best.t) best = { t, col: null, nx: 0, ny: 1, nz: 0 }; }
      // по ячейкам сетки вдоль луча (грубо: прямоугольник проекции отрезка)
      const ex = ox + dx * Math.min(maxT, best.t), ez = oz + dz * Math.min(maxT, best.t);
      const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), []);
      for (const c of list) {
        if (c.trigger || (filter && !filter(c))) continue;
        const h = c.type === 'cyl' ? rayCyl(c, ox, oy, oz, dx, dy, dz) : rayBox(c, ox, oy, oz, dx, dy, dz);
        if (h && h.t >= 0 && h.t < best.t) best = { ...h, col: c };
      }
      if (best.t >= maxT) return null;
      return { t: best.t, x: ox + dx * best.t, y: oy + dy * best.t, z: oz + dz * best.t, nx: best.nx, ny: best.ny, nz: best.nz, col: best.col };
    }

    // ── Сетка проходимости (для «иди сюда» по клику): ячейка закрыта, если в неё не влезает круг агента ──
    navGrid(o){
      const cell = o.cell || .5, r = o.r || .42, minx = o.minx, minz = o.minz, w = Math.ceil((o.maxx - minx) / cell), h = Math.ceil((o.maxz - minz) / cell);
      const blocked = new Uint8Array(w * h), y = o.y ?? this.ground ?? 0, step = o.step ?? .62, ht = o.h || 2.1;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = minx + (i + .5) * cell, z = minz + (j + .5) * cell;
        const list = this.query(x - r, z - r, x + r, z + r, []);
        for (const c of list) {
          if (c.trigger || !c.solid || c.top <= y + step || c.bottom >= y + ht) continue;
          if (Phys.circleHit(c, x, z, r * .92)) { blocked[j * w + i] = 1; break; }
        }
      }
      return { cell, minx, minz, w, h, blocked };
    }
  }

  // Луч против коробки (в её системе: slab-тест)
  function rayBox(c, ox, oy, oz, dx, dy, dz){
    const px = ox - c.x, pz = oz - c.z;
    const lox = c.cos * px - c.sin * pz, loz = c.sin * px + c.cos * pz, loy = oy - c.y;
    const ldx = c.cos * dx - c.sin * dz, ldz = c.sin * dx + c.cos * dz, ldy = dy;
    let t0 = -Infinity, t1 = Infinity, ax = 0;
    const slab = (o, d, h, axis) => {
      if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
      let a = (-h - o) / d, b = (h - o) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) { t0 = a; ax = axis * (d > 0 ? -1 : 1); }
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    // луч, начатый внутри тела, это тело не видит (как Physics.Raycast в Unity)
    if (!slab(lox, ldx, c.hx, 1) || !slab(loy, ldy, c.hy, 2) || !slab(loz, ldz, c.hz, 3) || t0 < 0) return null;
    const t = t0;
    let nx = 0, ny = 0, nz = 0;
    if (Math.abs(ax) === 2) ny = Math.sign(ax);
    else { const lnx = Math.abs(ax) === 1 ? Math.sign(ax) : 0, lnz = Math.abs(ax) === 3 ? Math.sign(ax) : 0; nx = c.cos * lnx + c.sin * lnz; nz = -c.sin * lnx + c.cos * lnz; }
    return { t, nx, ny, nz };
  }
  // Луч против вертикального цилиндра (бок + крышка сверху/снизу)
  function rayCyl(c, ox, oy, oz, dx, dy, dz){
    let best = null;
    const px = ox - c.x, pz = oz - c.z, a = dx * dx + dz * dz;
    if (a > 1e-9) {
      const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - c.r * c.r, disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a), y = oy + dy * t;
        if (t >= 0 && y >= c.bottom && y <= c.top) { const hx = px + dx * t, hz = pz + dz * t; best = { t, nx: hx / c.r, ny: 0, nz: hz / c.r }; }
      }
    }
    if (Math.abs(dy) > 1e-9) for (const [yy, ny] of [[c.top, 1], [c.bottom, -1]]) {
      if (ny * dy > 0) continue;   // крышку видно только снаружи: верхнюю — сверху, нижнюю — снизу
      const t = (yy - oy) / dy;
      if (t < 0 || (best && t >= best.t)) continue;
      const hx = px + dx * t, hz = pz + dz * t;
      if (hx * hx + hz * hz <= c.r * c.r) best = { t, nx: 0, ny, nz: 0 };
    }
    return best;
  }

  // ── Путь по сетке: A* (8 направлений, без срезания углов) + спрямление по прямой видимости ──
  function navCell(g, x, z){ return [Math.max(0, Math.min(g.w - 1, Math.floor((x - g.minx) / g.cell))), Math.max(0, Math.min(g.h - 1, Math.floor((z - g.minz) / g.cell)))]; }
  function navFree(g, i, j){ return i >= 0 && j >= 0 && i < g.w && j < g.h && !g.blocked[j * g.w + i]; }
  function nearestFree(g, i, j){
    if (navFree(g, i, j)) return [i, j];
    for (let r = 1; r < 24; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (navFree(g, i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  }
  function lineFree(g, x1, z1, x2, z2){
    const d = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(d / (g.cell * .5));
    for (let k = 1; k < n; k++) {
      const [i, j] = navCell(g, x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n);
      if (!navFree(g, i, j)) return false;
    }
    return true;
  }
  function findPath(g, sx, sz, tx, tz, maxIter = 40000){
    const s0 = nearestFree(g, ...navCell(g, sx, sz)), g0 = nearestFree(g, ...navCell(g, tx, tz));
    if (!s0 || !g0) return [];
    const goalFree = navFree(g, ...navCell(g, tx, tz));
    const end = goalFree ? [tx, tz] : [g.minx + (g0[0] + .5) * g.cell, g.minz + (g0[1] + .5) * g.cell];
    if (lineFree(g, sx, sz, end[0], end[1])) return [end];
    const W = g.w, start = s0[1] * W + s0[0], goal = g0[1] * W + g0[0];
    const gs = new Float32Array(W * g.h).fill(Infinity), from = new Int32Array(W * g.h).fill(-1), closed = new Uint8Array(W * g.h);
    const heap = [], push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const gx = g0[0], gz = g0[1], H = (i, j) => { const dx = Math.abs(i - gx), dz = Math.abs(j - gz); return Math.max(dx, dz) + .41421 * Math.min(dx, dz); };
    gs[start] = 0; push(H(s0[0], s0[1]), start);
    let it = 0;
    while (heap.length && it++ < maxIter) {
      const [, cur] = pop();
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      const ci = cur % W, cj = (cur - ci) / W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!navFree(g, ni, nj)) continue;
        if (di && dj && (!navFree(g, ci + di, cj) || !navFree(g, ci, cj + dj))) continue;
        const nk = nj * W + ni, ng = gs[cur] + (di && dj ? 1.41421 : 1);
        if (ng < gs[nk]) { gs[nk] = ng; from[nk] = cur; push(ng + H(ni, nj), nk); }
      }
    }
    if (from[goal] < 0 && goal !== start) return [];
    const cells = [];
    for (let k = goal; k >= 0 && k !== start; k = from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map(k => [g.minx + (k % W + .5) * g.cell, g.minz + (Math.floor(k / W) + .5) * g.cell]);
    pts[pts.length - 1] = end;
    // спрямление: из текущей точки — к самой дальней видимой
    const out = [];
    let px = sx, pz = sz, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !lineFree(g, px, pz, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); px = pts[j][0]; pz = pts[j][1]; i = j + 1;
    }
    return out;
  }

  E.Phys = Phys;
  E.nav = { findPath, lineFree, navCell, navFree, nearestFree };
})();
