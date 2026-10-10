// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — физика «2,5D»: персонаж-капсула против статичного мира (коробки и цилиндры), ступеньки,
//  прыжки, потолки, зоны-триггеры, луч (клик по миру), сетка проходимости и путь A*
// ═══════════════════════════════════════
// Без Three.js и DOM — проверяется в node. Мир: стоячие коробки (box: центр, полуразмеры, поворот вокруг Y)
// и вертикальные цилиндры (cyl). Персонаж не наклоняется: в плане он круг радиуса r, по высоте — [y, y + h].
// Препятствие сбоку — то, что выше ступеньки (top > y + step); на всё, что ниже, персонаж заходит сам.
// Единицы — метры движка (человечек ≈ 2,3 высотой), ось Y вверх.
// Тела двигаются на месте: ph.update(тело, { x, y, z, hx, hy, hz, r, yaw, type, solid, trigger, tag, data }) — без remove + add
// (клетки сетки пересчитываются, только если тело ушло в другие). ph.reuse(список) … ph.reuseEnd(): addBox/addCyl/addWedge
// внутри берут тела из списка по порядку и двигают их (так scene.js двигает детали каждый кадр), лишние — убираются.
// ph.watch(f) → f('add' | 'move' | 'remove', тело) (так rigid.js зеркалит мир в Rapier); вернёт «отписаться».
// Крючки rigid.js: ph.onPush(ch, тело, nx, nz, скорость) — персонаж упёрся в тело с c.rb (движущаяся деталь),
// ph.onChar(ch) — персонаж сделал шаг. Горячие пути (шаг персонажа, луч, касания) — без новых объектов:
// Phys.circleHit отдаёт ОБЩИЙ объект { d, nx, nz } — скопируй, если нужен дольше.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const CELL = 4, INV = 1 / CELL, LIM = 16383;
  // клетка сетки — целое число (без строк gx + ',' + gz): x — старшие разряды, z — младшие (|g| ≤ 16383, ключ — малое целое)
  const cellOf = v => { const g = Math.floor(v * INV); return g < -LIM ? -LIM : g > LIM ? LIM : g; };
  const keyOf = (gx, gz) => gx * 32768 + gz;
  const HIT = { d: 0, nx: 0, nz: 0 };              // общий ответ circleHit
  const RH = { t: 0, nx: 0, ny: 0, nz: 0 };         // общий ответ лучей против тел

  class Phys {
    constructor(o = {}){
      this.ground = o.ground ?? 0;          // высота земли (плоскость), null — без земли (падать бесконечно)
      this.grid = new Map();
      this.cols = new Set();
      this.seq = 0;
      this.qmark = 0;
      this.terrain = null;
      this.watchers = [];
      this.onPush = null;                   // (ch, тело, nx, nz, скорость в тело) — для rigid.js
      this.onChar = null;                   // (ch) — персонаж сделал шаг
      this._lists = [[], [], [], [], [], [], []];   // свои списки для запросов (без new [] на каждый шаг)
      this._pool = []; this._pi = 0; this._reusing = false; this._emitting = 0;
      this._scol = null;
    }
    // ── Добавить/убрать тело ──
    addBox(o){ return this._make('box', o); }
    // Клин (пандус): как коробка, но крыша — скат от низа у +z (спереди) до верха у −z (сзади)
    addWedge(o){ return this._make('wedge', o); }
    // Высота крыши тела в точке (x, z) (для клина — на скате; точка прижимается к следу)
    static topAt(c, x, z){
      if (c.type !== 'wedge') return c.top;
      const px = x - c.x, pz = z - c.z, lz = Math.max(-c.hz, Math.min(c.hz, c.sin * px + c.cos * pz));
      return c.bottom + 2 * c.hy * (c.hz - lz) / (2 * c.hz);
    }
    addCyl(o){ return this._make('cyl', o); }
    _make(type, o){
      if (this._reusing && !this._emitting && this._pi < this._pool.length) return this.update(this._pool[this._pi++], o, type, false, true);
      // все тела одного вида (одни и те же поля) — быстрее для V8
      const c = { type, x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, r: 0, yaw: 0, cos: 1, sin: 0, minx: 0, maxx: 0, minz: 0, maxz: 0, bottom: 0, top: 0,
        trigger: false, tag: '', data: null, solid: true, id: ++this.seq, mark: 0, gx0: 0, gx1: -1, gz0: 0, gz1: -1, rb: null };
      fill(c, o, type, true);
      this.cols.add(c);
      this._cells(c);
      this._grid(c);
      this._emit('add', c);
      return c;
    }
    // Подвинуть/повернуть/изменить тело на месте. o — только то, что меняется (full — всё, как в add*: чего нет — по умолчанию).
    // silent — без события 'move' (rigid.js двигает свои тела сам)
    update(c, o, type, silent = false, full = false){
      if (!c) return c;
      const live = this.cols.has(c), gx0 = c.gx0, gx1 = c.gx1, gz0 = c.gz0, gz1 = c.gz1;
      fill(c, o, type || o.type || c.type, full);
      if (live) {
        this._cells(c);
        if (c.gx0 !== gx0 || c.gx1 !== gx1 || c.gz0 !== gz0 || c.gz1 !== gz1) { this._ungrid(c, gx0, gx1, gz0, gz1); this._grid(c); }
        if (!silent) this._emit('move', c);
      }
      return c;
    }
    // Следующие add* внутри reuse … reuseEnd двигают тела из списка (по порядку), а не создают новые
    reuse(list){
      this.reuseEnd();
      const P = this._pool;
      if (list) for (let i = 0; i < list.length; i++) if (this.cols.has(list[i])) P.push(list[i]);
      this._pi = 0; this._reusing = true;
    }
    reuseEnd(){
      if (!this._reusing) return;
      this._reusing = false;
      const P = this._pool;
      for (let i = this._pi; i < P.length; i++) this.remove(P[i]);
      P.length = 0; this._pi = 0;
    }
    remove(c){
      if (!c || !this.cols.delete(c)) return;
      this._ungrid(c, c.gx0, c.gx1, c.gz0, c.gz1);
      this._emit('remove', c);
    }
    clear(){
      if (this.watchers.length) for (const c of this.cols) this._emit('remove', c);
      this.grid.clear(); this.cols.clear();
    }
    watch(f){ this.watchers.push(f); return () => { const i = this.watchers.indexOf(f); if (i >= 0) this.watchers.splice(i, 1); }; }
    _emit(type, c){
      const W = this.watchers;
      if (!W.length) return;
      this._emitting++;
      try { for (let i = 0; i < W.length; i++) W[i](type, c); } finally { this._emitting--; }
    }
    _cells(c){ c.gx0 = cellOf(c.minx); c.gx1 = cellOf(c.maxx); c.gz0 = cellOf(c.minz); c.gz1 = cellOf(c.maxz); }
    _grid(c){
      for (let gx = c.gx0; gx <= c.gx1; gx++)
        for (let gz = c.gz0; gz <= c.gz1; gz++) {
          const k = keyOf(gx, gz);
          let list = this.grid.get(k);
          if (!list) { list = []; this.grid.set(k, list); }
          list.push(c);
        }
    }
    _ungrid(c, gx0, gx1, gz0, gz1){
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gz = gz0; gz <= gz1; gz++) {
          const list = this.grid.get(keyOf(gx, gz));
          if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
        }
    }
    // Земля под точкой: рельеф (terrain.sample) или плоскость; r — радиус (на склоне берём самое высокое из 5 точек)
    groundAt(x, z, r = 0){
      const T = this.terrain;
      if (!T) return this.ground == null ? -Infinity : this.ground;
      let h = T.sample(x, z);
      if (r > 0) { const k = r * .5; h = Math.max(h, T.sample(x + k, z), T.sample(x - k, z), T.sample(x, z + k), T.sample(x, z - k)); }
      return h;
    }
    // Все тела, чей прямоугольник в плане задевает область (без повторов)
    query(minx, minz, maxx, maxz, out = []){
      const mark = ++this.qmark, gx1 = cellOf(maxx), gz0 = cellOf(minz), gz1 = cellOf(maxz);
      for (let gx = cellOf(minx); gx <= gx1; gx++)
        for (let gz = gz0; gz <= gz1; gz++) {
          const list = this.grid.get(keyOf(gx, gz));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (c.mark === mark || c.maxx < minx || c.minx > maxx || c.maxz < minz || c.minz > maxz) continue;
            c.mark = mark; out.push(c);
          }
        }
      return out;
    }
    // Свой список для запроса (если он занят — вложенный вызов — новый)
    _q(slot, minx, minz, maxx, maxz){
      const l = this._lists[slot];
      return this.query(minx, minz, maxx, maxz, l.length ? [] : l);
    }

    // ── Круг (x, z, r) против следа тела в плане: { d: глубина, nx, nz: куда выталкивать } или null (объект общий!) ──
    static circleHit(c, x, z, r){
      if (c.type === 'cyl') {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), rr = r + c.r;
        if (d >= rr) return null;
        if (d < 1e-6) { HIT.d = rr; HIT.nx = 1; HIT.nz = 0; return HIT; }
        HIT.d = rr - d; HIT.nx = dx / d; HIT.nz = dz / d;
        return HIT;
      }
      // в систему коробки (поворот на −yaw): local = R(−yaw) · (p − c)
      const px = x - c.x, pz = z - c.z;
      const lx = c.cos * px - c.sin * pz, lz = c.sin * px + c.cos * pz;
      const cx = Math.max(-c.hx, Math.min(c.hx, lx)), cz = Math.max(-c.hz, Math.min(c.hz, lz));
      const dx = lx - cx, dz = lz - cz, d = Math.hypot(dx, dz);
      let nlx, nlz, depth;
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
      HIT.d = depth; HIT.nx = c.cos * nlx + c.sin * nlz; HIT.nz = -c.sin * nlx + c.cos * nlz;
      return HIT;
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
        g: o.g || 40, jumpV: o.jumpV || 11.3, grounded: true, onCol: null, inside: new Set(), airT: 0, landed: 0, impact: 0,
        tvx: 0, tvz: 0, events: null, _spare: null };
    }
    // Высота опоры под кругом (x, z, r): самая высокая крыша не выше yMax (и земля)
    supportAt(x, z, r, yMax, skip){ const y = this._support(x, z, r, yMax, skip); return { y, col: this._scol }; }
    _support(x, z, r, yMax, skip){
      let best = this.groundAt(x, z, r), col = null;
      const list = this._q(0, x - r, z - r, x + r, z + r);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.trigger || !c.solid || c === skip) continue;
        const top = c.type === 'wedge' ? Phys.topAt(c, x, z) : c.top;
        if (top > yMax + 1e-4 || top <= best) continue;
        if (Phys.circleHit(c, x, z, r * .7) || Phys.inside(c, x, z)) { best = top; col = c; }
      }
      list.length = 0;
      this._scol = col;
      return best;
    }
    // Один шаг движения персонажа: wish — желаемое направление (x, z, длина 0…1), speed, jump
    move(ch, dt, wish = { x: 0, z: 0 }, speed = 0, jump = false){
      // разгон к нужной скорости (на земле быстро, в воздухе плавнее; ch.accG / ch.accA — свои)
      const acc = (ch.grounded ? ch.accG ?? 46 : ch.accA ?? 16) * dt, tx = (wish.x || 0) * speed, tz = (wish.z || 0) * speed;
      ch.tvx = tx; ch.tvz = tz;   // куда хочет (толкать детали — rigid.js)
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
      const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (ch.r * .5))), seg = Math.hypot(mx, mz) / n;
      for (let i = 0; i < n; i++) {
        const ox = ch.x, oz = ch.z;
        ch.x += mx / n; ch.z += mz / n;
        if (this.terrain && ch.grounded) {   // склон круче ~55° — упор (как обрыв)
          const g = this.groundAt(ch.x, ch.z), rise = g - Math.max(ch.y, this.groundAt(ox, oz));
          if (rise > seg * 1.43 + .05 && g > ch.y + .05) { ch.x = ox; ch.z = oz; ch.vx *= .3; ch.vz *= .3; continue; }
        }
        this.pushOut(ch);
      }
    }
    // По вертикали: стоит — держится опоры (ступеньки вверх/вниз), в воздухе — тяжесть, потолок, приземление.
    // ch.impact — скорость удара о землю в момент приземления (для «жёсткого приземления» и камеры)
    fall(ch, dt){
      ch.landed = 0; ch.impact = 0;
      if (this.onChar) this.onChar(ch);
      if (ch.grounded) {
        const sy = this._support(ch.x, ch.z, ch.r, ch.y + ch.step);
        if (sy >= ch.y - ch.step - 1e-4) { ch.y = sy; ch.vy = 0; ch.onCol = this._scol; }   // ступенька вверх/вниз — идём по ней
        else { ch.grounded = false; ch.vy = Math.min(ch.vy, 0); ch.airT = 0; }          // шагнули с края — падаем
      }
      if (!ch.grounded) {
        ch.airT += dt;
        ch.vy -= ch.g * dt;
        let ny = ch.y + ch.vy * dt;
        if (ch.vy > 0) {   // потолок: тело над головой
          const list = this._q(4, ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r);
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (c.trigger || !c.solid) continue;
            if (c.bottom >= ch.y + ch.h - 1e-3 && ny + ch.h > c.bottom && Phys.circleHit(c, ch.x, ch.z, ch.r * .8)) { ny = c.bottom - ch.h; ch.vy = 0; }
          }
          list.length = 0;
        }
        const sy = this._support(ch.x, ch.z, ch.r, Math.max(ch.y, ny) + (ch.vy <= 0 ? .05 : 0));
        if (ch.vy <= 0 && ny <= sy) { ch.impact = -ch.vy; ch.landed = Math.min(1, -ch.vy / 25); ny = sy; ch.vy = 0; ch.grounded = true; ch.onCol = this._scol; }
        ch.y = ny;
        if (this.ground != null && ch.y < this.groundAt(ch.x, ch.z) - 60) { ch.y = this.groundAt(ch.x, ch.z, ch.r); ch.vy = 0; ch.grounded = true; }   // упал за край мира — обратно
      }
    }
    // Есть ли твёрдое тело в вертикальном цилиндре (x, z, r) от y0 до y1 (влезет ли тело: присесть, встать, залезть)
    blocked(x, z, y0, y1, r, skip){
      const list = this._q(2, x - r, z - r, x + r, z + r);
      let res = null;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.trigger || !c.solid || c === skip || c.top <= y0 + 1e-3 || c.bottom >= y1 - 1e-3) continue;
        if (Phys.circleHit(c, x, z, r)) { res = c; break; }
      }
      list.length = 0;
      return res;
    }
    // Вытолкнуть из стен (2 прохода) и погасить скорость в стену — скольжение вдоль
    pushOut(ch){
      for (let it = 0; it < 3; it++) {
        let moved = false;
        const list = this._q(1, ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.trigger || !c.solid) continue;
          if (c.bottom >= ch.y + ch.h - .02) continue;   // над головой
          if (c.rb && c.bottom > ch.y + ch.h - .35) continue;   // движущаяся деталь легла на голову — её держит «голова» в Rapier (rigid.js)
          // ниже ступеньки (на клине — скат у ног; клин круче ~55° — стена, как крутой склон земли)
          if ((c.type === 'wedge' && c.hy < c.hz * 1.43 ? Phys.topAt(c, ch.x, ch.z) : c.top) <= ch.y + ch.step + 1e-4) continue;
          const hit = Phys.circleHit(c, ch.x, ch.z, ch.r);
          if (!hit) continue;
          const d = hit.d, nx = hit.nx, nz = hit.nz;
          // упёрся в движущуюся деталь — толкнуть её (rigid.js); скорость — та, с которой идёт в неё (или хочет идти)
          if (c.rb && this.onPush) { const into = Math.max(-(ch.vx * nx + ch.vz * nz), -(ch.tvx * nx + ch.tvz * nz)); if (into > 0) this.onPush(ch, c, nx, nz, into); }
          ch.x += nx * d; ch.z += nz * d;
          const vn = ch.vx * nx + ch.vz * nz;
          if (vn < 0) { ch.vx -= vn * nx; ch.vz -= vn * nz; }
          moved = true;
        }
        list.length = 0;
        if (!moved) break;
      }
    }
    // Зоны-триггеры: ch.inside — где сейчас; события enter/exit — в ch.events (их забирает игра)
    triggers(ch){
      const now = ch._spare || new Set();
      now.clear();
      const list = this._q(3, ch.x - ch.r, ch.z - ch.r, ch.x + ch.r, ch.z + ch.r);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.trigger || c.top < ch.y || c.bottom > ch.y + ch.h) continue;
        if (Phys.inside(c, ch.x, ch.z)) now.add(c);
      }
      list.length = 0;
      const ev = ch.events || (ch.events = []);
      for (const c of now) if (!ch.inside.has(c)) ev.push({ type: 'enter', col: c });
      for (const c of ch.inside) if (!now.has(c)) ev.push({ type: 'exit', col: c });
      ch._spare = ch.inside; ch.inside = now;
    }

    // ── Луч: от (ox, oy, oz) по (dx, dy, dz) (нормирован), ближайшее твёрдое тело или земля ──
    raycast(ox, oy, oz, dx, dy, dz, maxT = 500, filter){
      let bt = maxT, bc = null, bnx = 0, bny = 1, bnz = 0;
      if (this.terrain) { if (rayTerrain(this.terrain, ox, oy, oz, dx, dy, dz, maxT) && RH.t < bt) { bt = RH.t; bnx = RH.nx; bny = RH.ny; bnz = RH.nz; } }
      else if (this.ground != null && dy < -1e-6) { const t = (this.ground - oy) / dy; if (t >= 0 && t < bt) { bt = t; bnx = 0; bny = 1; bnz = 0; } }
      // по ячейкам сетки вдоль луча (грубо: прямоугольник проекции отрезка)
      const ex = ox + dx * Math.min(maxT, bt), ez = oz + dz * Math.min(maxT, bt);
      const list = this._q(5, Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.trigger || (filter && !filter(c))) continue;
        const hit = c.type === 'cyl' ? rayCyl(c, ox, oy, oz, dx, dy, dz) : c.type === 'wedge' ? rayWedge(c, ox, oy, oz, dx, dy, dz) : rayBox(c, ox, oy, oz, dx, dy, dz);
        if (hit && RH.t >= 0 && RH.t < bt) { bt = RH.t; bc = c; bnx = RH.nx; bny = RH.ny; bnz = RH.nz; }
      }
      list.length = 0;
      if (bt >= maxT) return null;
      return { t: bt, x: ox + dx * bt, y: oy + dy * bt, z: oz + dz * bt, nx: bnx, ny: bny, nz: bnz, col: bc };
    }

    // ── Сетка проходимости (для «иди сюда» по клику): ячейка закрыта, если в неё не влезает круг агента ──
    navGrid(o){
      const cell = o.cell || .5, r = o.r || .42, minx = o.minx, minz = o.minz, w = Math.ceil((o.maxx - minx) / cell), h = Math.ceil((o.maxz - minz) / cell);
      const blocked = new Uint8Array(w * h), y = o.y ?? this.ground ?? 0, step = o.step ?? .62, ht = o.h || 2.1;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = minx + (i + .5) * cell, z = minz + (j + .5) * cell;
        const list = this._q(6, x - r, z - r, x + r, z + r);
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.trigger || !c.solid || c.top <= y + step || c.bottom >= y + ht) continue;
          if (Phys.circleHit(c, x, z, r * .92)) { blocked[j * w + i] = 1; break; }
        }
        list.length = 0;
      }
      return { cell, minx, minz, w, h, blocked };
    }
  }

  // Поля тела по виду и описанию o (full — как при создании: чего нет в o — значение по умолчанию)
  function fill(c, o, type, full){
    c.type = type;
    if (full || o.x !== undefined) c.x = +o.x || 0;
    if (full || o.y !== undefined) c.y = +o.y || 0;
    if (full || o.z !== undefined) c.z = +o.z || 0;
    if (full || o.hy !== undefined) c.hy = Math.abs(o.hy) || 0;
    if (type === 'cyl') {
      if (full || o.r !== undefined) c.r = Math.abs(o.r) || 0;
      c.hx = c.hz = c.r; c.yaw = 0; c.cos = 1; c.sin = 0;
      c.minx = c.x - c.r; c.maxx = c.x + c.r; c.minz = c.z - c.r; c.maxz = c.z + c.r;
    } else {
      if (full || o.hx !== undefined) c.hx = Math.abs(o.hx) || 0;
      if (full || o.hz !== undefined) c.hz = Math.abs(o.hz) || 0;
      if (full || o.yaw !== undefined) { const yaw = +o.yaw || 0; if (yaw !== c.yaw || full) { c.yaw = yaw; c.cos = Math.cos(yaw); c.sin = Math.sin(yaw); } }
      c.r = 0;
      const ac = Math.abs(c.cos), as = Math.abs(c.sin), ex = ac * c.hx + as * c.hz, ez = as * c.hx + ac * c.hz;
      c.minx = c.x - ex; c.maxx = c.x + ex; c.minz = c.z - ez; c.maxz = c.z + ez;
    }
    c.bottom = c.y - c.hy; c.top = c.y + c.hy;
    if (full || o.trigger !== undefined) c.trigger = !!o.trigger;
    if (full || o.tag !== undefined) c.tag = o.tag || '';
    if (full || o.data !== undefined) c.data = o.data ?? null;
    if (full || o.solid !== undefined) c.solid = o.solid !== false;
  }

  // Луч против коробки (в её системе: slab-тест); ответ — в RH
  let T0 = 0, T1 = 0, AX = 0;
  function slab(o, d, h, axis){
    if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
    let a = (-h - o) / d, b = (h - o) / d;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > T0) { T0 = a; AX = axis * (d > 0 ? -1 : 1); }
    if (b < T1) T1 = b;
    return T0 <= T1;
  }
  function rayBox(c, ox, oy, oz, dx, dy, dz){
    const px = ox - c.x, pz = oz - c.z;
    const lox = c.cos * px - c.sin * pz, loz = c.sin * px + c.cos * pz, loy = oy - c.y;
    const ldx = c.cos * dx - c.sin * dz, ldz = c.sin * dx + c.cos * dz, ldy = dy;
    T0 = -Infinity; T1 = Infinity; AX = 0;
    // луч, начатый внутри тела, это тело не видит (как Physics.Raycast в Unity)
    if (!slab(lox, ldx, c.hx, 1) || !slab(loy, ldy, c.hy, 2) || !slab(loz, ldz, c.hz, 3) || T0 < 0) return false;
    const ax = AX;
    let nx = 0, ny = 0, nz = 0;
    if (Math.abs(ax) === 2) ny = Math.sign(ax);
    else { const lnx = Math.abs(ax) === 1 ? Math.sign(ax) : 0, lnz = Math.abs(ax) === 3 ? Math.sign(ax) : 0; nx = c.cos * lnx + c.sin * lnz; nz = -c.sin * lnx + c.cos * lnz; }
    RH.t = T0; RH.nx = nx; RH.ny = ny; RH.nz = nz;
    return true;
  }
  // Луч против клина: коробка, обрезанная скатом y ≤ −z·(hy/hz) (в его системе)
  let W0 = 0, W1 = 0, WA = -1, WS = 0;
  function wslab(o, d, h, i){
    if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
    let a = (-h - o) / d, b = (h - o) / d;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > W0) { W0 = a; WA = i; WS = d > 0 ? -1 : 1; }
    if (b < W1) W1 = b;
    return true;
  }
  function rayWedge(c, ox, oy, oz, dx, dy, dz){
    const px = ox - c.x, pz = oz - c.z;
    const l0 = c.cos * px - c.sin * pz, l1 = oy - c.y, l2 = c.sin * px + c.cos * pz;
    const d0 = c.cos * dx - c.sin * dz, d1 = dy, d2 = c.sin * dx + c.cos * dz;
    W0 = -Infinity; W1 = Infinity; WA = -1; WS = 0;
    if (!wslab(l0, d0, c.hx, 0) || !wslab(l1, d1, c.hy, 1) || !wslab(l2, d2, c.hz, 2)) return false;
    let n0 = 0, n1 = 0, n2 = 0, has = WA >= 0;
    if (WA === 0) n0 = WS; else if (WA === 1) n1 = WS; else if (WA === 2) n2 = WS;
    // скат: f = y + k·z ≤ 0
    const k = c.hy / c.hz, fo = l1 + k * l2, fd = d1 + k * d2;
    if (Math.abs(fd) < 1e-9) { if (fo > 0) return false; }
    else {
      const tp = -fo / fd;
      if (fd < 0) { if (tp > W0) { W0 = tp; const l = Math.hypot(1, k); n0 = 0; n1 = 1 / l; n2 = k / l; has = true; } }
      else if (tp < W1) W1 = tp;
    }
    if (W0 > W1 || W0 < 0 || !has) return false;
    RH.t = W0; RH.nx = c.cos * n0 + c.sin * n2; RH.ny = n1; RH.nz = -c.sin * n0 + c.cos * n2;
    return true;
  }
  // Луч против рельефа: шагами по 0,5 до пересечения, потом уточнение делением пополам; ответ — в RH
  const tf = (T, ox, oy, oz, dx, dy, dz, t) => oy + dy * t - T.sample(ox + dx * t, oz + dz * t);
  function rayTerrain(T, ox, oy, oz, dx, dy, dz, maxT){
    let a = 0;
    if (tf(T, ox, oy, oz, dx, dy, dz, 0) < 0) return false;
    const stepL = .5, n = Math.min(4000, Math.ceil(maxT / stepL));
    for (let i = 1; i <= n; i++) {
      const b = Math.min(maxT, i * stepL), fb = tf(T, ox, oy, oz, dx, dy, dz, b);
      if (fb < 0) {
        let lo = a, hi = b;
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (tf(T, ox, oy, oz, dx, dy, dz, m) < 0) hi = m; else lo = m; }
        const t = hi, x = ox + dx * t, z = oz + dz * t, e = .25;
        const gx = T.sample(x + e, z) - T.sample(x - e, z), gz = T.sample(x, z + e) - T.sample(x, z - e), l = Math.hypot(gx, 2 * e, gz);
        RH.t = t; RH.nx = -gx / l; RH.ny = 2 * e / l; RH.nz = -gz / l;
        return true;
      }
      a = b;
      if (b >= maxT) break;
    }
    return false;
  }
  // Луч против вертикального цилиндра (бок + крышка сверху/снизу); ответ — в RH
  function rayCyl(c, ox, oy, oz, dx, dy, dz){
    let has = false, bt = 0, bnx = 0, bny = 0, bnz = 0;
    const px = ox - c.x, pz = oz - c.z, a = dx * dx + dz * dz;
    if (a > 1e-9) {
      const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - c.r * c.r, disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a), y = oy + dy * t;
        if (t >= 0 && y >= c.bottom && y <= c.top) { has = true; bt = t; bnx = (px + dx * t) / c.r; bny = 0; bnz = (pz + dz * t) / c.r; }
      }
    }
    if (Math.abs(dy) > 1e-9) {
      // крышку видно только снаружи: верхнюю — сверху, нижнюю — снизу
      if (dy < 0) {
        const t = (c.top - oy) / dy;
        if (t >= 0 && !(has && t >= bt)) { const hx = px + dx * t, hz = pz + dz * t; if (hx * hx + hz * hz <= c.r * c.r) { has = true; bt = t; bnx = 0; bny = 1; bnz = 0; } }
      } else {
        const t = (c.bottom - oy) / dy;
        if (t >= 0 && !(has && t >= bt)) { const hx = px + dx * t, hz = pz + dz * t; if (hx * hx + hz * hz <= c.r * c.r) { has = true; bt = t; bnx = 0; bny = -1; bnz = 0; } }
      }
    }
    if (!has) return false;
    RH.t = bt; RH.nx = bnx; RH.ny = bny; RH.nz = bnz;
    return true;
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
