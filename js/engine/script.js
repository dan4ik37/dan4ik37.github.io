// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — скрипты в объектах (как Script в Roblox), язык — JavaScript с привычными именами Roblox:
//  script.Parent, part.Touched.Connect, TweenService, Instance.new, task.wait, Players, leaderstats…
// ═══════════════════════════════════════
// Безопасность: код игроков работает в отдельном потоке (Worker) внутри песочницы (iframe sandbox="allow-scripts"
// + CSP без сети): ни сайта, ни аккаунта, ни сети он не видит; завис (бесконечный цикл) — поток убивается, сайт живёт.
// С миром скрипт общается сообщениями: читает копию свойств, а меняет командами (set/new/destroy/tween…), которые
// хозяин мира проверяет и применяет. SH = D37E.scripts(host) → SH.start(scene, players) / SH.event(…) / SH.tick(dt) / SH.stop().
// host: { apply(cmd) — команда из скрипта, print(text, kind), error(script, line, msg), hang() }.
// Языки: у скрипта obj.lang ('js' по умолчанию). Другие языки — файлы js/engine/lang-*.js: D37E.lang(id, { label, short,
// icon, kind: 'text' | 'binary' (код — base64, например .wasm), worker() — функция, которая работает ВНУТРИ песочницы и
// регистрирует globalThis.D37Lang[id] = { run(code, env, ctx) }, examples: [[название, код]], ai: «задание для ИИ», placeholder }).
// env — те же имена, что у JavaScript (script, game, workspace, Instance, Vector3, …); ctx — служебное: name, error(msg, line),
// err(e), signal, proxyOf, playerOf, objs, players, send. Код языка уходит в песочницу текстом (worker.toString()).
(() => {
  const E = window.D37E = window.D37E || {};

  // ═══ То, что работает внутри песочницы (Worker). Ничего снаружи эта функция не видит ═══
  function runtime(){
    'use strict';
    const objs = new Map();   // id → { id, cls, parent, children: [], p: {свойства} }
    const H = { touched: new Map(), touchEnded: new Map(), clicked: new Map(), prompt: new Map(), heartbeat: new Set(), playerAdded: new Set(), playerRemoving: new Set(), died: new Set() };
    const tweens = new Map(), players = new Map();
    let seq = 0, curScript = '';
    const send = (t, d) => postMessage(Object.assign({ t }, d));
    const lineOf = st => { st = String(st || ''); const m = /\), <anonymous>:(\d+):\d+/.exec(st) || /> Function:(\d+):\d+/.exec(st) || /<anonymous>:(\d+):\d+/.exec(st); return m ? +m[1] : 0; };
    const err = (where, e) => {
      const m = String(e && e.message || e);
      const ln = lineOf(e && e.stack);
      send('error', { script: where || curScript, line: ln && LINE0 ? Math.max(0, ln - LINE0) : 0, msg: m.slice(0, 300) });
    };
    // ── Типы ──
    class Vector3 {
      constructor(x = 0, y = 0, z = 0){ this.X = +x || 0; this.Y = +y || 0; this.Z = +z || 0; }
      get x(){ return this.X; } get y(){ return this.Y; } get z(){ return this.Z; }
      add(o){ return new Vector3(this.X + o.X, this.Y + o.Y, this.Z + o.Z); } sub(o){ return new Vector3(this.X - o.X, this.Y - o.Y, this.Z - o.Z); }
      mul(k){ return typeof k === 'number' ? new Vector3(this.X * k, this.Y * k, this.Z * k) : new Vector3(this.X * k.X, this.Y * k.Y, this.Z * k.Z); }
      div(k){ return typeof k === 'number' ? new Vector3(this.X / k, this.Y / k, this.Z / k) : new Vector3(this.X / k.X, this.Y / k.Y, this.Z / k.Z); }
      get Magnitude(){ return Math.hypot(this.X, this.Y, this.Z); }
      get Unit(){ const m = this.Magnitude || 1; return new Vector3(this.X / m, this.Y / m, this.Z / m); }
      Lerp(o, a){ return new Vector3(this.X + (o.X - this.X) * a, this.Y + (o.Y - this.Y) * a, this.Z + (o.Z - this.Z) * a); }
      Dot(o){ return this.X * o.X + this.Y * o.Y + this.Z * o.Z; }
      Cross(o){ return new Vector3(this.Y * o.Z - this.Z * o.Y, this.Z * o.X - this.X * o.Z, this.X * o.Y - this.Y * o.X); }
      FuzzyEq(o, eps = 1e-5){ return Math.abs(this.X - o.X) <= eps && Math.abs(this.Y - o.Y) <= eps && Math.abs(this.Z - o.Z) <= eps; }
      toString(){ return `${this.X.toFixed(2)}, ${this.Y.toFixed(2)}, ${this.Z.toFixed(2)}`; }
      static new(x, y, z){ return new Vector3(x, y, z); }
    }
    Vector3.zero = new Vector3(0, 0, 0); Vector3.one = new Vector3(1, 1, 1);
    // CFrame (как в Roblox): позиция + матрица поворота 3×3 по строкам; углы — радианы, Orientation деталей — градусы, порядок YXZ
    const multi = a => { Object.defineProperty(a, '__multi', { value: true }); return a; };   // несколько значений (для Lua: local x, y, z = cf:ToOrientation())
    const mm3 = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
    const RX = t => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
    const RY = t => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
    const RZ = t => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
    class CFrame {
      constructor(x = 0, y = 0, z = 0, R = null){ this.X = +x || 0; this.Y = +y || 0; this.Z = +z || 0; this.R = R || [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
      get x(){ return this.X; } get y(){ return this.Y; } get z(){ return this.Z; }
      get Position(){ return new Vector3(this.X, this.Y, this.Z); } get p(){ return this.Position; }
      get Rotation(){ return new CFrame(0, 0, 0, this.R.slice()); }
      get LookVector(){ const R = this.R; return new Vector3(-R[2], -R[5], -R[8]); }
      get RightVector(){ const R = this.R; return new Vector3(R[0], R[3], R[6]); }
      get UpVector(){ const R = this.R; return new Vector3(R[1], R[4], R[7]); }
      get XVector(){ return this.RightVector; } get YVector(){ return this.UpVector; } get ZVector(){ const R = this.R; return new Vector3(R[2], R[5], R[8]); }
      mul(o){
        const a = this.R;
        if (o instanceof Vector3) return new Vector3(a[0] * o.X + a[1] * o.Y + a[2] * o.Z + this.X, a[3] * o.X + a[4] * o.Y + a[5] * o.Z + this.Y, a[6] * o.X + a[7] * o.Y + a[8] * o.Z + this.Z);
        if (!(o instanceof CFrame)) throw new Error('CFrame * : нужен CFrame или Vector3');
        const p = this.mul(new Vector3(o.X, o.Y, o.Z));
        return new CFrame(p.X, p.Y, p.Z, mm3(a, o.R));
      }
      add(v){ return new CFrame(this.X + v.X, this.Y + v.Y, this.Z + v.Z, this.R.slice()); }
      sub(v){ return new CFrame(this.X - v.X, this.Y - v.Y, this.Z - v.Z, this.R.slice()); }
      Inverse(){ const a = this.R, T = [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; return new CFrame(-(T[0] * this.X + T[1] * this.Y + T[2] * this.Z), -(T[3] * this.X + T[4] * this.Y + T[5] * this.Z), -(T[6] * this.X + T[7] * this.Y + T[8] * this.Z), T); }
      ToWorldSpace(c){ return this.mul(c); } ToObjectSpace(c){ return this.Inverse().mul(c); }
      PointToWorldSpace(v){ return this.mul(v); } PointToObjectSpace(v){ return this.Inverse().mul(v); }
      VectorToWorldSpace(v){ return this.Rotation.mul(v); } VectorToObjectSpace(v){ return this.Rotation.Inverse().mul(v); }
      toOrient(){ const R = this.R, sx = Math.max(-1, Math.min(1, -R[5])), x = Math.asin(sx); return Math.abs(R[5]) < 0.9999999 ? [x, Math.atan2(R[2], R[8]), Math.atan2(R[3], R[4])] : [x, Math.atan2(-R[6], R[0]), 0]; }
      ToOrientation(){ return multi(this.toOrient()); } ToEulerAnglesYXZ(){ return multi(this.toOrient()); }
      ToEulerAnglesXYZ(){ const R = this.R, y = Math.asin(Math.max(-1, Math.min(1, R[2]))); return multi(Math.abs(R[2]) < 0.9999999 ? [Math.atan2(-R[5], R[8]), y, Math.atan2(-R[1], R[0])] : [Math.atan2(R[7], R[4]), y, 0]); }
      GetComponents(){ return multi([this.X, this.Y, this.Z, ...this.R]); } components(){ return this.GetComponents(); }
      Lerp(o, k){   // позиция — прямо, поворот — по кратчайшей дуге (кватернионы)
        const qa = CFrame.quat(this.R), qb = CFrame.quat(o.R); let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
        if (d < 0) { for (let i = 0; i < 4; i++) qb[i] = -qb[i]; d = -d; }
        let q;
        if (d > 0.9995) q = qa.map((v, i) => v + (qb[i] - v) * k);
        else { const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - k) * th) / s, wb = Math.sin(k * th) / s; q = qa.map((v, i) => v * wa + qb[i] * wb); }
        const m = Math.hypot(...q) || 1;
        return CFrame.fromQuat(this.X + (o.X - this.X) * k, this.Y + (o.Y - this.Y) * k, this.Z + (o.Z - this.Z) * k, q[0] / m, q[1] / m, q[2] / m, q[3] / m);
      }
      toString(){ return [this.X, this.Y, this.Z, ...this.R].map(n => +n.toFixed(3)).join(', '); }
      static quat(R){
        const t = R[0] + R[4] + R[8];
        if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s, s / 4]; }
        if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; return [s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s, (R[7] - R[5]) / s]; }
        if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; return [(R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s, (R[2] - R[6]) / s]; }
        const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; return [(R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4, (R[3] - R[1]) / s];
      }
      static fromQuat(x, y, z, qx, qy, qz, qw){ return new CFrame(x, y, z, [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw), 2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw), 2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]); }
      static new(a, b, c, ...r){
        if (a instanceof Vector3) return b instanceof Vector3 ? CFrame.lookAt(a, b) : new CFrame(a.X, a.Y, a.Z);
        if (r.length === 9) return new CFrame(a, b, c, r.map(Number));
        if (r.length === 4) { const m = Math.hypot(r[0], r[1], r[2], r[3]) || 1; return CFrame.fromQuat(a, b, c, r[0] / m, r[1] / m, r[2] / m, r[3] / m); }
        return new CFrame(a, b, c);
      }
      static Angles(rx = 0, ry = 0, rz = 0){ return new CFrame(0, 0, 0, mm3(mm3(RX(+rx || 0), RY(+ry || 0)), RZ(+rz || 0))); }
      static fromEulerAnglesXYZ(rx, ry, rz){ return CFrame.Angles(rx, ry, rz); }
      static fromEulerAnglesYXZ(rx = 0, ry = 0, rz = 0){ return new CFrame(0, 0, 0, mm3(mm3(RY(+ry || 0), RX(+rx || 0)), RZ(+rz || 0))); }
      static fromOrientation(rx, ry, rz){ return CFrame.fromEulerAnglesYXZ(rx, ry, rz); }
      static fromAxisAngle(v, t){ const u = v.Unit, c = Math.cos(t), s = Math.sin(t), k = 1 - c, x = u.X, y = u.Y, z = u.Z; return new CFrame(0, 0, 0, [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k]); }
      static fromMatrix(p, vx, vy, vz){ const z = vz || vx.Cross(vy); return new CFrame(p.X, p.Y, p.Z, [vx.X, vy.X, z.X, vx.Y, vy.Y, z.Y, vx.Z, vy.Z, z.Z]); }
      static lookAt(at, target, up = new Vector3(0, 1, 0)){
        const f = target.sub(at).Unit;
        let r = f.Cross(up); if (r.Magnitude < 1e-6) r = f.Cross(new Vector3(0, 0, 1)); r = r.Unit;
        const u = r.Cross(f);
        return new CFrame(at.X, at.Y, at.Z, [r.X, u.X, -f.X, r.Y, u.Y, -f.Y, r.Z, u.Z, -f.Z]);
      }
    }
    CFrame.identity = new CFrame();
    const DEG = 180 / Math.PI;
    const cfOf = (pos, rot) => { const c = CFrame.fromOrientation((rot?.[0] || 0) / DEG, (rot?.[1] || 0) / DEG, (rot?.[2] || 0) / DEG); c.X = pos?.[0] || 0; c.Y = pos?.[1] || 0; c.Z = pos?.[2] || 0; return c; };
    const rotOf = cf => cf.toOrient().map(r => Math.round(r * DEG * 1e4) / 1e4);
    // BrickColor: имена цветов Roblox → '#rrggbb' (как Color у детали)
    const BRICK = [['White', '#f2f3f3'], ['Grey', '#a1a5a2'], ['Light yellow', '#f3cf9b'], ['Brick yellow', '#d7c59a'], ['Light reddish violet', '#e8bac8'], ['Pastel Blue', '#80bbdc'], ['Nougat', '#cc8e69'],
      ['Bright red', '#c4281c'], ['Bright blue', '#0d69ac'], ['Bright yellow', '#f5cd30'], ['Black', '#1b2a35'], ['Dark green', '#287f47'], ['Medium green', '#a1c48c'], ['Bright green', '#4b974b'],
      ['Dark orange', '#a05f35'], ['Light blue', '#b4d2e4'], ['Bright orange', '#da8541'], ['Bright bluish green', '#008f9c'], ['Earth green', '#27462d'], ['Sand blue', '#74869d'], ['Sand green', '#789082'],
      ['Bright violet', '#6b327c'], ['Bright yellowish green', '#a4bd47'], ['Medium stone grey', '#a3a2a5'], ['Dark stone grey', '#635f62'], ['Light stone grey', '#e5e4df'], ['Reddish brown', '#694028'],
      ['Medium blue', '#6e99ca'], ['Bright reddish violet', '#923978'], ['Brown', '#7c5c46'], ['Gold', '#efb838'], ['Institutional white', '#f8f8f8'], ['Mid gray', '#cdcdcd'], ['Really black', '#111111'],
      ['Really red', '#ff0000'], ['Deep orange', '#ffb000'], ['Alder', '#b480ff'], ['Dusty Rose', '#a34b4b'], ['Olive', '#c1be42'], ['New Yeller', '#ffff00'], ['Really blue', '#0000ff'], ['Navy blue', '#002060'],
      ['Deep blue', '#2154b9'], ['Cyan', '#04afec'], ['CGA brown', '#aa5500'], ['Magenta', '#aa00aa'], ['Pink', '#ff66cc'], ['Teal', '#12eed4'], ['Toothpaste', '#00ffff'], ['Lime green', '#00ff00'],
      ['Camo', '#3a7d15'], ['Grime', '#7f8e64'], ['Lavender', '#8c5b9f'], ['Pastel light blue', '#afddff'], ['Pastel orange', '#ffc9c9'], ['Pastel violet', '#b1a7ff'], ['Pastel green', '#ccffcc'],
      ['Pastel yellow', '#ffffcc'], ['Royal purple', '#6225d1'], ['Hot pink', '#ff00bf'], ['Neon orange', '#d5733d'], ['Persimmon', '#ff5959'], ['Maroon', '#7b002e'], ['Crimson', '#970000'],
      ['Electric blue', '#0989cf'], ['Forest green', '#1f801d'], ['Baby blue', '#98c2db'], ['Cool yellow', '#fdea8d'], ['Salmon', '#ff9494'], ['Smoky grey', '#5b5d69'], ['Fossil', '#9fa1ac'], ['Dark taupe', '#5a4c42']];
    const bcCache = new Map();
    class BrickColor {
      constructor(name, hex){ this.Name = name; this.Color = hex; this.Number = BRICK.findIndex(b => b[0] === name) + 1; }
      get r(){ return parseInt(this.Color.slice(1, 3), 16) / 255; } get g(){ return parseInt(this.Color.slice(3, 5), 16) / 255; } get b(){ return parseInt(this.Color.slice(5, 7), 16) / 255; }
      toString(){ return this.Name; }
      static byName(n){ const e = BRICK.find(b => b[0].toLowerCase() === String(n).toLowerCase()) || BRICK[23]; if (!bcCache.has(e[0])) bcCache.set(e[0], new BrickColor(e[0], e[1])); return bcCache.get(e[0]); }
      static nearest(hex){ const v = parseInt(String(hex).slice(1), 16) || 0; let best = BRICK[0], bd = Infinity; for (const e of BRICK) { const w = parseInt(e[1].slice(1), 16), d = ((v >> 16) - (w >> 16)) ** 2 + ((v >> 8 & 255) - (w >> 8 & 255)) ** 2 + ((v & 255) - (w & 255)) ** 2; if (d < bd) { bd = d; best = e; } } return BrickColor.byName(best[0]); }
      static new(a, g, b){
        if (a instanceof BrickColor) return a;
        if (typeof a === 'number' && g !== undefined) return BrickColor.nearest(Color3.new(a, g, b));
        if (typeof a === 'string') return /^#[0-9a-f]{6}$/i.test(a) ? BrickColor.nearest(a) : BrickColor.byName(a);
        return BrickColor.byName('Medium stone grey');
      }
      static random(){ return BrickColor.byName(BRICK[Math.floor(Math.random() * BRICK.length)][0]); }
      static White(){ return BrickColor.byName('White'); } static Gray(){ return BrickColor.byName('Medium stone grey'); } static DarkGray(){ return BrickColor.byName('Dark stone grey'); }
      static Black(){ return BrickColor.byName('Black'); } static Red(){ return BrickColor.byName('Bright red'); } static Yellow(){ return BrickColor.byName('Bright yellow'); }
      static Green(){ return BrickColor.byName('Dark green'); } static Blue(){ return BrickColor.byName('Bright blue'); }
    }
    const brickHex = v => v instanceof BrickColor ? v.Color : typeof v === 'string' ? BrickColor.new(v).Color : null;
    const V = a => new Vector3(a[0], a[1], a[2]), A = v => v instanceof Vector3 ? [v.X, v.Y, v.Z] : v instanceof CFrame ? [v.X, v.Y, v.Z] : Array.isArray(v) ? v.slice(0, 3).map(Number) : null;
    const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const Color3 = {
      fromRGB: (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b),
      new: (r, g, b) => '#' + hex2(r * 255) + hex2(g * 255) + hex2(b * 255),
      fromHex: h => (/^#?[0-9a-f]{6}$/i.test(h) ? '#' + h.replace('#', '') : '#ffffff').toLowerCase(),
      fromHSV: (h, s, v) => { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return Color3.new(f(5), f(3), f(1)); },
    };
    const Enum = { Material: { Plastic: 'plastic', SmoothPlastic: 'smooth', Neon: 'neon', Glass: 'glass', Metal: 'metal', DiamondPlate: 'diamond', Wood: 'wood', WoodPlanks: 'planks', Brick: 'brick', Concrete: 'concrete', Cobblestone: 'cobble', Asphalt: 'asphalt', Grass: 'grass', Sand: 'sand', Rock: 'rock', Ground: 'dirt', Snow: 'snow', Ice: 'ice', Marble: 'marble', Fabric: 'fabric', Tiles: 'tiles' },
      PartType: { Block: 'block', Ball: 'ball', Cylinder: 'cyl', Wedge: 'wedge' }, EasingStyle: { Linear: 'linear', Quad: 'quad', Sine: 'sine', Back: 'back', Bounce: 'bounce', Elastic: 'elastic', Cubic: 'quad', Quart: 'quad', Quint: 'quad', Exponential: 'quad', Circular: 'sine' },
      EasingDirection: { In: 'in', Out: 'out', InOut: 'inout' } };
    // ── События ──
    function signal(reg){
      const list = new Set();
      return {
        Connect(fn){ if (typeof fn !== 'function') throw new Error('Connect: нужна функция'); const w = { fn, s: curScript }; list.add(w); reg && reg(true, list.size); return { Disconnect(){ list.delete(w); reg && reg(false, list.size); }, get Connected(){ return list.has(w); } }; },
        Wait(){ return new Promise(res => { const c = this.Connect((...a) => { c.Disconnect(); res(a[0]); }); }); },
        Once(fn){ const c = this.Connect((...a) => { c.Disconnect(); return fn(...a); }); return c; },
        _fire(...a){ for (const w of [...list]) { const prev = curScript; curScript = w.s; try { const r = w.fn(...a); if (r && r.catch) r.catch(e => err(w.s, e)); } catch (e) { err(w.s, e); } curScript = prev; } },
        _size: () => list.size,
      };
    }
    const evOf = (map, id, want) => { if (!map.has(id)) map.set(id, signal((on, n) => send('want', { ev: want, id, on: n > 0 }))); return map.get(id); };
    // ── Объекты мира: прокси к копии свойств; изменения — командами хозяину ──
    // Объекты «только в песочнице» (rt: Folder, IntValue и др. значения, ClickDetector, ProximityPrompt) хозяин не видит:
    // их родитель — объект (parent), игрок (pl, папка leaderstats) или никто (nil). Папка в workspace или в детали — модель мира.
    const PROPS = { Position: 'pos', Size: 'size', Orientation: 'rot', Rotation: 'rot', Color: 'color', Material: 'mat', Transparency: 'alpha', CanCollide: 'collide', Anchored: 'anchored', CastShadow: 'shadow', Shape: 'shape', Text: 'text', Range: 'range', Brightness: 'power', Name: 'name' };
    const RPROPS = { pos: 'Position', size: 'Size', rot: 'Orientation', color: 'Color', mat: 'Material', alpha: 'Transparency', collide: 'CanCollide', anchored: 'Anchored', shadow: 'CastShadow', shape: 'Shape', text: 'Text', range: 'Range', power: 'Brightness', name: 'Name' };
    const VEC = new Set(['pos', 'size', 'rot']);
    const VALUE_DEF = { IntValue: () => 0, NumberValue: () => 0, StringValue: () => '', BoolValue: () => false, ObjectValue: () => null, Vector3Value: () => new Vector3(), Color3Value: () => '#000000', CFrameValue: () => new CFrame() };
    const RT_CLS = new Set(['Folder', 'ClickDetector', 'ProximityPrompt', ...Object.keys(VALUE_DEF)]);
    const PP = { ActionText: 'action', ObjectText: 'object', HoldDuration: 'hold', Enabled: 'enabled', MaxActivationDistance: 'dist', KeyboardKeyCode: 'key', GamepadKeyCode: 'gkey', RequiresLineOfSight: 'los', Style: 'style', ClickablePrompt: 'click', Exclusivity: 'excl', UIOffset: 'uioff' };
    const ISA = { Part: ['BasePart', 'PVInstance'], Spawn: ['SpawnLocation', 'Part', 'BasePart', 'PVInstance'], Light: ['PointLight'], Model: ['PVInstance'], Prefab: ['Model', 'PVInstance'] };
    for (const k of Object.keys(VALUE_DEF)) ISA[k] = ['ValueBase'];
    const prox = new Map(), SIGS = new Map();
    const sigOf = (id, n) => { let m = SIGS.get(id); if (!m) SIGS.set(id, m = {}); return m[n] || (m[n] = signal()); };
    const fire = (id, n, ...a) => { const m = SIGS.get(id); if (m && m[n]) m[n]._fire(...a); };
    const isRoot = o => !o.parent && !o.pl && !o.nil;   // лежит прямо в workspace
    const inWs = o => { for (let n = 0; o && n < 1000; n++) { if (!o.parent) return isRoot(o); o = objs.get(o.parent); } return false; };
    function proxyOf(id){
      if (!id) return null;
      if (prox.has(id)) return prox.get(id);
      const O = () => objs.get(id);
      const self = {
        get Name(){ return O()?.p.name; }, set Name(v){ set(id, 'name', String(v).slice(0, 40)); },
        get ClassName(){ return O()?.cls; },
        IsA(c){ const k = O()?.cls; return c === k || c === 'Instance' || !!(ISA[k] && ISA[k].includes(c)); },
        get Parent(){ const o = O(); return o ? (o.parent ? proxyOf(o.parent) : o.pl ? playerOf(o.pl) : o.nil ? null : workspace) : null; },
        set Parent(v){ setParent(id, v); },
        get __id(){ return id; },
        GetChildren(){ return (O()?.children || []).map(proxyOf); },
        GetDescendants(){ const out = []; const walk = i => { for (const c of objs.get(i)?.children || []) { out.push(proxyOf(c)); walk(c); } }; walk(id); return out; },
        FindFirstChild(name, rec){ return findIn(O()?.children || [], name, rec); },
        FindFirstChildOfClass(c){ const k = (O()?.children || []).find(i => objs.get(i)?.cls === c); return k ? proxyOf(k) : null; },
        FindFirstChildWhichIsA(c){ const k = (O()?.children || []).find(i => proxyOf(i).IsA(c)); return k ? proxyOf(k) : null; },
        FindFirstAncestor(name){ for (let o = O(); o && o.parent;) { o = objs.get(o.parent); if (o && o.p.name === name) return proxyOf(o.id); } return null; },
        IsDescendantOf(x){ if (x === workspace) return inWs(O()); for (let o = O(); o && o.parent;) { if (x && x.__id === o.parent) return true; o = objs.get(o.parent); } return false; },
        GetFullName(){ const n = []; let o = O(), top = o; for (; o; o = o.parent ? objs.get(o.parent) : null) { n.unshift(o.p.name); top = o; } return (top && top.pl ? 'Players.' + (players.get(top.pl)?.name || '') + '.' : top && isRoot(top) ? 'Workspace.' : '') + n.join('.'); },
        WaitForChild(name, t){ return waitChild(() => this.FindFirstChild(name), t, name); },
        ClearAllChildren(){ for (const c of (O()?.children || []).slice()) destroy(c); },
        Destroy(){ destroy(id); }, Remove(){ destroy(id); },
        Clone(){ return cloneTree(id); },
        GetAttribute(k){ return (O()?.p.attrs || {})[k]; },
        SetAttribute(k, v){ const o = O(); if (!o) return; o.p.attrs = Object.assign({}, o.p.attrs, { [k]: v }); if (!o.rt) send('set', { id, k: 'attrs', v: o.p.attrs }); fire(id, 'A:' + k); },
        GetAttributes(){ return Object.assign({}, O()?.p.attrs); },
        GetAttributeChangedSignal(k){ return sigOf(id, 'A:' + k); },
        get Touched(){ return evOf(H.touched, id, 'touched'); }, get TouchEnded(){ return evOf(H.touchEnded, id, 'touchEnded'); },
        get Clicked(){ return evOf(H.clicked, id, 'clicked'); },
        get MouseClick(){ return O()?.cls === 'ClickDetector' ? sigOf(id, 'MouseClick') : this.Clicked; },
        get MouseHoverEnter(){ return sigOf(id, 'MouseHoverEnter'); }, get MouseHoverLeave(){ return sigOf(id, 'MouseHoverLeave'); }, get RightMouseClick(){ return sigOf(id, 'RightMouseClick'); },
        get Triggered(){ return sigOf(id, 'Triggered'); }, get TriggerEnded(){ return sigOf(id, 'TriggerEnded'); },
        get PromptShown(){ return sigOf(id, 'PromptShown'); }, get PromptHidden(){ return sigOf(id, 'PromptHidden'); },
        get Changed(){ return sigOf(id, 'Changed'); }, GetPropertyChangedSignal(n){ return sigOf(id, 'P:' + n); },
        get ChildAdded(){ return sigOf(id, 'ChildAdded'); }, get ChildRemoved(){ return sigOf(id, 'ChildRemoved'); }, get Destroying(){ return sigOf(id, 'Destroying'); },
        get Value(){ return O()?.p.value; },
        get BrickColor(){ return BrickColor.nearest(O()?.p.color || '#a3a2a5'); },
        get CFrame(){ const o = O(); return cfOf(o?.p.pos, o?.p.rot); },
        Prompt(text = 'Нажать', hold = 0){ const s = evOf(H.prompt, id, 'prompt'); send('prompt', { id, text: String(text).slice(0, 40), hold: Math.max(0, Math.min(10, +hold || 0)) }); return { Triggered: s }; },
        MoveTo(v){ set(id, 'pos', A(v)); },
        PivotTo(cf){ if (cf instanceof CFrame) { set(id, 'pos', [cf.X, cf.Y, cf.Z]); set(id, 'rot', rotOf(cf)); } else set(id, 'pos', A(cf)); },
        GetPivot(){ return this.CFrame; },
        toString(){ return O()?.p.name || id; },
      };
      const p = new Proxy(self, {
        get(t, k){
          if (k in t) return t[k];
          const o = objs.get(id), key = PROPS[k];
          if (key && o && !o.rt) { const v = o.p[key]; return VEC.has(key) && v ? V(v) : v; }
          if (o && o.rt && typeof k === 'string') { if (o.cls === 'ProximityPrompt' && PP[k]) return o.p[PP[k]]; if (o.cls === 'ClickDetector' && k === 'MaxActivationDistance') return o.p.dist; }
          if (typeof k === 'string') {
            const c = (o?.children || []).find(cid => objs.get(cid)?.p.name === k); if (c) return proxyOf(c);
            if ((k === 'ClickDetector' || k === 'ProximityPrompt') && o && !o.rt) return Instance.new(k, p);   // как вставленный в Studio
          }
          return undefined;
        },
        set(t, k, v){
          if (k === 'Name' || k === 'Parent') { t[k] = v; return true; }
          const o = objs.get(id); if (!o) return true;
          if (o.rt) { rtSet(o, k, v); return true; }
          if (k === 'BrickColor') { const h = brickHex(v); if (!h) throw new Error('BrickColor: нужен BrickColor.new("Bright red")'); set(id, 'color', h); return true; }
          if (k === 'CFrame') { if (!(v instanceof CFrame)) throw new Error('CFrame: нужен CFrame.new(x, y, z)'); set(id, 'pos', [v.X, v.Y, v.Z]); set(id, 'rot', rotOf(v)); return true; }
          const key = PROPS[k];
          if (!key) throw new Error('Нельзя менять свойство ' + String(k));
          set(id, key, VEC.has(key) ? A(v) : v);
          return true;
        },
      });
      prox.set(id, p);
      return p;
    }
    function findIn(ids, name, rec){
      for (const c of ids) { if (objs.get(c)?.p.name === name) return proxyOf(c); }
      if (rec) for (const c of ids) { const r = findIn(objs.get(c)?.children || [], name, true); if (r) return r; }
      return null;
    }
    function set(id, k, v){
      const o = objs.get(id); if (!o) return;
      if (VEC.has(k)) { if (!Array.isArray(v) || v.some(n => !isFinite(n))) throw new Error('Нужен Vector3'); }
      if (k === 'color' && !/^#[0-9a-f]{6}$/i.test(String(v))) throw new Error('Цвет: Color3.fromRGB(r, g, b) или "#rrggbb"');
      if (k === 'alpha') v = Math.max(0, Math.min(1, +v || 0));
      o.p[k] = v;
      if (o.rt) { if (k === 'name') { markStats(); checkWaiters(); } return; }
      send('set', { id, k, v });
      if (k === 'name') checkWaiters();
      if (SIGS.has(id)) { const n = RPROPS[k] || k; fire(id, 'Changed', n); fire(id, 'P:' + n); }
    }
    // ── значения, ClickDetector, ProximityPrompt (только в песочнице) ──
    function rtSet(o, k, v){
      if (k === 'Value' && VALUE_DEF[o.cls]) { setValue(o, v); return; }
      if (o.cls === 'ProximityPrompt' && PP[k]) {
        o.p[PP[k]] = k === 'HoldDuration' || k === 'MaxActivationDistance' ? Math.max(0, +v || 0) : k === 'ActionText' || k === 'ObjectText' ? String(v ?? '').slice(0, 40) : k === 'Enabled' || k === 'RequiresLineOfSight' || k === 'ClickablePrompt' ? !!v : v;
        promptSync(o); return;
      }
      if (o.cls === 'ClickDetector' && k === 'MaxActivationDistance') { o.p.dist = +v || 0; return; }
      throw new Error('Нельзя менять свойство ' + String(k) + ' у ' + o.cls);
    }
    function setValue(o, v){
      const c = o.cls;
      if (c === 'IntValue') v = Math.round(+v || 0);
      else if (c === 'NumberValue') v = +v || 0;
      else if (c === 'StringValue') v = v === undefined || v === null ? '' : String(v);
      else if (c === 'BoolValue') v = !!v;
      else if (c === 'Vector3Value') v = v instanceof Vector3 ? v : V(A(v) || [0, 0, 0]);
      else if (c === 'Color3Value') v = /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : '#000000';
      else if (c === 'CFrameValue') v = v instanceof CFrame ? v : new CFrame();
      else if (v === undefined) v = null;
      if (o.p.value === v) return;
      o.p.value = v;
      fire(o.id, 'Changed', v); fire(o.id, 'P:Value');
      markStats();
    }
    function rtBind(o){   // ClickDetector / ProximityPrompt — к детали-родителю (события clicked / prompt хозяина)
      if (o.link) { o.link.Disconnect(); o.link = null; }
      const par = o.parent ? objs.get(o.parent) : null;
      if (!par || par.rt) return;
      if (o.cls === 'ClickDetector') o.link = evOf(H.clicked, par.id, 'clicked').Connect(pl => fire(o.id, 'MouseClick', pl));
      else { o.link = evOf(H.prompt, par.id, 'prompt').Connect(pl => { if (o.p.enabled !== false) { fire(o.id, 'Triggered', pl); fire(o.id, 'TriggerEnded', pl); } }); promptSync(o); }
    }
    function promptSync(o){
      const par = o.parent ? objs.get(o.parent) : null;
      if (!par || par.rt || !o.link || o.cls !== 'ProximityPrompt') return;
      send('prompt', { id: par.id, text: String(o.p.object ? o.p.object + ': ' + o.p.action : o.p.action).slice(0, 40), hold: Math.max(0, Math.min(10, +o.p.hold || 0)) });
    }
    // ── родитель: workspace, объект или игрок ──
    function where(v){
      if (v === undefined || v === null || v === workspace) return {};
      const i = v.__id; if (i && objs.has(i)) return { pid: i };
      const pl = v.__pid; if (pl && players.has(pl)) return { pl };
      throw new Error('Parent: нужен объект мира, workspace или игрок');
    }
    function detach(o){
      if (o.parent) { const par = objs.get(o.parent); if (par) { par.children = par.children.filter(c => c !== o.id); fire(o.parent, 'ChildRemoved', proxyOf(o.id)); } }
      o.parent = null; o.pl = null; o.nil = false;
    }
    function setParent(id, v){
      const o = objs.get(id); if (!o) return;
      if (v === null || v === undefined) {
        if (!o.rt) { destroy(id); return; }   // деталь без родителя удаляется (как раньше)
        detach(o); o.nil = true; if (o.link) rtBind(o); markStats(); return;
      }
      const w = where(v);
      if (w.pid === id) return;
      for (let a = w.pid; a; a = objs.get(a)?.parent) if (a === id) throw new Error('Parent: нельзя положить объект в его же потомка');
      if (!o.rt) {
        if (w.pl) throw new Error('Деталь нельзя положить в игрока — в игрока кладут папку leaderstats');
        if (w.pid && objs.get(w.pid).rt && objs.get(w.pid).cls === 'Folder') materialize(w.pid);
        detach(o); o.parent = w.pid || null;
        if (o.parent) objs.get(o.parent).children.push(id);
        send('parent', { id, parent: o.parent && !objs.get(o.parent).rt ? o.parent : null });
      } else {
        detach(o); o.parent = w.pid || null; o.pl = w.pl || null;
        if (o.parent) objs.get(o.parent).children.push(id);
        if (o.cls === 'Folder' && !o.pl && (!o.parent || !objs.get(o.parent).rt)) materialize(id);
        if (o.cls === 'ClickDetector' || o.cls === 'ProximityPrompt') rtBind(o);
        markStats();
      }
      fire(o.parent || (o.pl ? '' : 'ws'), 'ChildAdded', proxyOf(id));
      checkWaiters();
    }
    function materialize(fid){   // папка песочницы → модель мира (хозяин получает «new»), её детали переезжают в неё
      const f = objs.get(fid); if (!f || !f.rt || f.cls !== 'Folder' || f.pl) return;
      let par = f.parent ? objs.get(f.parent) : null;
      if (par && par.rt && par.cls === 'Folder') { materialize(par.id); par = objs.get(par.id); }
      if (par && par.rt) return;   // в игроке или в значении — остаётся в песочнице
      f.rt = false; f.nil = false;
      send('new', { id: fid, cls: 'Model', props: { name: f.p.name }, parent: par ? par.id : null });
      for (const c of f.children) { const co = objs.get(c); if (co && !co.rt) send('parent', { id: c, parent: fid }); }
    }
    // ── leaderstats: значения в папке игрока → его таблица очков (команда stat) ──
    let statQ = false;
    const markStats = () => { if (!statQ) { statQ = true; Promise.resolve().then(flushStats); } };
    const lsFolder = pid => { for (const o of objs.values()) if (o.pl === pid && !o.parent && o.cls === 'Folder' && o.p.name === 'leaderstats') return o; return null; };
    const lsChild = (pid, k) => { const f = lsFolder(pid); if (!f) return null; for (const c of f.children) { const o = objs.get(c); if (o && o.p.name === k && VALUE_DEF[o.cls]) return o; } return null; };
    function flushStats(){
      statQ = false;
      for (const [pid, P] of players) {
        const f = lsFolder(pid); if (!f) continue;
        P.stats = P.stats || {}; P.sent = P.sent || {};
        for (const c of f.children) {
          const o = objs.get(c); if (!o || !VALUE_DEF[o.cls]) continue;
          const k = String(o.p.name).slice(0, 20), x = o.p.value, v = typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 'да' : 'нет') : String(x ?? '');
          P.stats[k] = x;
          if (P.sent[k] !== v) { P.sent[k] = v; send('player', { pid, cmd: 'stat', v: { k, v } }); }
        }
      }
    }
    // ── WaitForChild: ждём, пока объект появится (как в Roblox; через 5 с — предупреждение) ──
    const waiters = [];
    function waitChild(find, t, name){
      const r = find(); if (r) return r;
      return new Promise(res => {
        const w = { find, res };
        waiters.push(w);
        if (t !== undefined && t !== null) setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, Math.max(0, +t || 0) * 1000);
        else setTimeout(() => { if (waiters.includes(w)) warn('WaitForChild("' + name + '"): ждём уже 5 с — такого объекта нет'); }, 5000);
      });
    }
    function checkWaiters(){ if (!waiters.length) return; for (const w of waiters.slice()) { const r = w.find(); if (r) { waiters.splice(waiters.indexOf(w), 1); w.res(r); } } }
    function destroy(id){
      const o = objs.get(id); if (!o) return;
      fire(id, 'Destroying');
      for (const c of o.children.slice()) destroy(c);
      if (o.parent && objs.get(o.parent)) { objs.get(o.parent).children = objs.get(o.parent).children.filter(c => c !== id); fire(o.parent, 'ChildRemoved', proxyOf(id)); }
      if (o.link) { o.link.Disconnect(); o.link = null; }
      objs.delete(id); prox.delete(id); SIGS.delete(id);
      for (const k of ['touched', 'touchEnded', 'clicked', 'prompt']) H[k].delete(id);
      if (o.rt) markStats(); else send('destroy', { id });
    }
    function newId(){ return 'w' + (++seq).toString(36) + Math.random().toString(36).slice(2, 5); }
    function cloneTree(id){
      const src = objs.get(id); if (!src) return null;
      const map = {}, made = [];
      const walk = (sid, parent) => {
        const o = objs.get(sid); if (!o) return null;
        const nid = newId(); map[sid] = nid;
        const n = { id: nid, cls: o.cls, parent, children: [], p: o.rt ? Object.assign({}, o.p) : JSON.parse(JSON.stringify(o.p)) };
        if (o.rt) n.rt = true;
        objs.set(nid, n); made.push(n);
        if (parent) objs.get(parent).children.push(nid);
        for (const c of o.children) walk(c, nid);
        return nid;
      };
      const root = walk(id, src.rt ? null : src.parent || null);
      if (src.rt) objs.get(root).nil = true;   // копия из песочницы — без родителя, как в Roblox
      else send('clone', { src: id, map });
      for (const n of made) if (n.cls === 'ClickDetector' || n.cls === 'ProximityPrompt') rtBind(n);
      return proxyOf(root);
    }
    const Instance = {
      new(cls, parent){
        if (RT_CLS.has(cls)) {
          const id = newId(), p = { name: cls };
          if (VALUE_DEF[cls]) p.value = VALUE_DEF[cls]();
          if (cls === 'ProximityPrompt') Object.assign(p, { action: 'Нажать', object: '', hold: 0, enabled: true, dist: 10 });
          if (cls === 'ClickDetector') p.dist = 32;
          objs.set(id, { id, cls, parent: null, children: [], p, rt: true, nil: true, pl: null });
          if (parent !== undefined && parent !== null) setParent(id, parent);
          return proxyOf(id);
        }
        const C = { Part: 'Part', WedgePart: 'Part', SpawnLocation: 'Spawn', PointLight: 'Light', Model: 'Model' }[cls];
        if (!C) throw new Error('Instance.new("' + cls + '") — есть Part, WedgePart, SpawnLocation, PointLight, Model, Folder, IntValue, NumberValue, StringValue, BoolValue, ObjectValue, Vector3Value, ClickDetector, ProximityPrompt');
        const w = where(parent);
        if (w.pl) throw new Error('Деталь нельзя положить в игрока — в игрока кладут папку leaderstats');
        const pid = w.pid || null;
        if (pid && objs.get(pid).rt && objs.get(pid).cls === 'Folder') materialize(pid);
        const id = newId(), p = { name: cls === 'WedgePart' ? 'Клин' : cls, ...(C === 'Part' ? { shape: cls === 'WedgePart' ? 'wedge' : 'block', pos: [0, 5, 0], rot: [0, 0, 0], size: [4, 1, 2], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true } : C === 'Light' ? { pos: [0, 4, 0], color: '#fff1c4', range: 18, power: 2 } : {}) };
        objs.set(id, { id, cls: C, parent: pid, children: [], p });
        if (pid) objs.get(pid).children.push(id);
        send('new', { id, cls: C, props: p, parent: pid && !objs.get(pid).rt ? pid : null });
        fire(pid || 'ws', 'ChildAdded', proxyOf(id));
        checkWaiters();
        return proxyOf(id);
      },
    };
    const workspace = new Proxy({
      Name: 'Workspace', ClassName: 'Workspace',
      IsA(c){ return c === 'Workspace' || c === 'Model' || c === 'PVInstance' || c === 'Instance'; },
      GetChildren(){ return [...objs.values()].filter(isRoot).map(o => proxyOf(o.id)); },
      GetDescendants(){ return [...objs.values()].filter(inWs).map(o => proxyOf(o.id)); },
      FindFirstChild(name, rec){ return findIn([...objs.values()].filter(isRoot).map(o => o.id), name, rec); },
      FindFirstChildOfClass(c){ const o = [...objs.values()].find(x => isRoot(x) && x.cls === c); return o ? proxyOf(o.id) : null; },
      FindFirstChildWhichIsA(c){ const o = [...objs.values()].find(x => isRoot(x) && proxyOf(x.id).IsA(c)); return o ? proxyOf(o.id) : null; },
      WaitForChild(name, t){ return waitChild(() => this.FindFirstChild(name, true), t, name); },
      get ChildAdded(){ return sigOf('ws', 'ChildAdded'); },
      GetFullName(){ return 'Workspace'; }, toString(){ return 'Workspace'; },
    }, { get(t, k){ if (k in t) return t[k]; if (typeof k === 'string') return t.FindFirstChild(k); } });
    // ── Игроки ──
    function charOf(pid){   // персонаж (Model): hit.Parent в Touched, player.Character
      const P = players.get(pid); if (!P) return null;
      if (P.char) return P.char;
      const pl = playerOf(pid), cmd = (c, v) => send('player', { pid, cmd: c, v });
      const tp = v => { const a = A(v); if (a && a.every(n => isFinite(n))) cmd('teleport', a); };
      const part = (name, dy, size) => ({
        Name: name, ClassName: 'Part', __player: pid, Size: new Vector3(size[0], size[1], size[2]),
        get Position(){ const q = P.pos || [0, 0, 0]; return new Vector3(q[0], q[1] + dy, q[2]); },
        set Position(v){ const a = A(v); if (a) tp([a[0], a[1] - dy, a[2]]); },
        get CFrame(){ return CFrame.new(this.Position); }, set CFrame(v){ this.Position = v; },
        get Parent(){ return P.char; },
        IsA(c){ return c === 'Part' || c === 'BasePart' || c === 'PVInstance' || c === 'Instance'; },
        GetFullName(){ return 'Workspace.' + P.name + '.' + name; }, toString(){ return name; },
      });
      const root = part('HumanoidRootPart', 1, [2, 2, 1]), head = part('Head', 2.5, [2, 1, 1]);
      P.char = {
        get Name(){ return P.name; }, ClassName: 'Model', __player: pid,
        get Parent(){ return workspace; },
        get Humanoid(){ return pl.Humanoid; }, HumanoidRootPart: root, Head: head, PrimaryPart: root,
        get Position(){ return V(P.pos || [0, 0, 0]); }, set Position(v){ tp(v); },
        FindFirstChild(n){ return n === 'Humanoid' ? pl.Humanoid : n === 'HumanoidRootPart' ? root : n === 'Head' ? head : null; },
        WaitForChild(n){ return this.FindFirstChild(n); },
        FindFirstChildOfClass(c){ return c === 'Humanoid' ? pl.Humanoid : null; },
        FindFirstChildWhichIsA(c){ return c === 'Humanoid' ? pl.Humanoid : c === 'BasePart' || c === 'Part' ? root : null; },
        GetChildren(){ return [root, head, pl.Humanoid]; }, GetDescendants(){ return [root, head, pl.Humanoid]; },
        IsA(c){ return c === 'Model' || c === 'PVInstance' || c === 'Instance'; },
        MoveTo(v){ tp(v); }, PivotTo(v){ tp(v); }, SetPrimaryPartCFrame(v){ tp(v); },
        GetPivot(){ return CFrame.new(V(P.pos || [0, 0, 0])); }, GetPrimaryPartCFrame(){ return this.GetPivot(); },
        BreakJoints(){ pl.Humanoid.Health = 0; },
        GetFullName(){ return 'Workspace.' + P.name; }, toString(){ return P.name; },
      };
      return P.char;
    }
    const charAdded = pid => { const P = players.get(pid); if (P && P.ca) P.ca._fire(charOf(pid)); };
    function playerOf(pid){
      const P = players.get(pid); if (!P) return null;
      if (P.proxy) return P.proxy;
      const cmd = (c, v) => send('player', { pid, cmd: c, v });
      P.stats = P.stats || {};
      const stat = k => ({ get Value(){ return P.stats[k] ?? 0; }, set Value(v){ P.stats[k] = v; cmd('stat', { k, v }); }, Name: k });
      // старый способ (без папки leaderstats): player.leaderstats.Монеты.Value
      const ls = new Proxy({}, { get(t, k){ if (k === 'FindFirstChild' || k === 'WaitForChild') return n => stat(n); if (k === 'GetChildren') return () => Object.keys(P.stats).map(stat); return typeof k === 'string' ? stat(k) : undefined; } });
      const kids = () => [...objs.values()].filter(o => o.pl === pid && !o.parent);
      const hum = {
        Name: 'Humanoid', ClassName: 'Humanoid',
        IsA(c){ return c === 'Humanoid' || c === 'Instance'; },
        get Parent(){ return charOf(pid); }, get RootPart(){ return charOf(pid).HumanoidRootPart; },
        get WalkSpeed(){ return P.walk ?? 16; }, set WalkSpeed(v){ P.walk = Math.max(0, Math.min(100, +v || 0)); cmd('walk', P.walk); },
        get JumpPower(){ return P.jump ?? 50; }, set JumpPower(v){ P.jump = Math.max(0, Math.min(200, +v || 0)); cmd('jump', P.jump); },
        get JumpHeight(){ return Math.round(7.2 * ((P.jump ?? 50) / 50) ** 2 * 100) / 100; }, set JumpHeight(v){ this.JumpPower = 50 * Math.sqrt(Math.max(0, +v || 0) / 7.2); },
        get Health(){ return P.health ?? 100; }, set Health(v){ P.health = Math.max(0, Math.min(P.maxHealth ?? 100, +v || 0)); cmd('health', P.health); if (P.hc) P.hc._fire(P.health); },
        get MaxHealth(){ return P.maxHealth ?? 100; }, set MaxHealth(v){ P.maxHealth = Math.max(1, +v || 100); cmd('maxHealth', P.maxHealth); },
        TakeDamage(n){ this.Health = (P.health ?? 100) - Math.max(0, +n || 0); },
        get Died(){ return P.died || (P.died = signal()); },
        get HealthChanged(){ return P.hc || (P.hc = signal()); },
        GetFullName(){ return 'Workspace.' + P.name + '.Humanoid'; }, toString(){ return 'Humanoid'; },
      };
      P.proxy = {
        get Name(){ return P.name; }, get UserId(){ return pid; }, get DisplayName(){ return P.name; },
        ClassName: 'Player', get __pid(){ return pid; },
        IsA(c){ return c === 'Player' || c === 'Instance'; }, get Parent(){ return Players; },
        get Position(){ return V(P.pos || [0, 0, 0]); },
        get Character(){ return charOf(pid); },
        get CharacterAdded(){ return P.ca || (P.ca = signal()); }, get CharacterRemoving(){ return P.cr || (P.cr = signal()); },
        Humanoid: hum,
        get leaderstats(){ const f = lsFolder(pid); return f ? proxyOf(f.id) : ls; },
        FindFirstChild(n){ const o = kids().find(x => x.p.name === n); return o ? proxyOf(o.id) : null; },
        WaitForChild(n, t){ return waitChild(() => this.FindFirstChild(n), t, n); },
        GetChildren(){ return kids().map(o => proxyOf(o.id)); },
        FindFirstChildOfClass(c){ const o = kids().find(x => x.cls === c); return o ? proxyOf(o.id) : null; },
        SetStat(k, v){ const c = lsChild(pid, k); if (c) setValue(c, v); else ls[k].Value = v; },
        GetStat(k){ const c = lsChild(pid, k); return c ? c.p.value : ls[k].Value; },
        AddStat(k, d){ const c = lsChild(pid, k); if (c) setValue(c, (+c.p.value || 0) + (+d || 0)); else ls[k].Value = (+ls[k].Value || 0) + (+d || 0); },
        Kill(){ this.Humanoid.Health = 0; }, LoadCharacter(){ cmd('respawn'); },
        Teleport(v){ cmd('teleport', A(v)); },
        Message(text, sec){ cmd('message', { text: String(text).slice(0, 140), sec: +sec || 3 }); },
        Kick(msg){ cmd('message', { text: String(msg || 'Тебя выгнали из игры').slice(0, 140), sec: 5 }); },
        GetFullName(){ return 'Players.' + P.name; }, toString(){ return P.name; },
      };
      return P.proxy;
    }
    const Players = {
      Name: 'Players', ClassName: 'Players',
      PlayerAdded: signal(), PlayerRemoving: signal(),
      GetPlayers(){ return [...players.keys()].map(playerOf); },
      GetChildren(){ return [...players.keys()].map(playerOf); },
      GetPlayerFromCharacter(c){ return c && c.__player ? playerOf(c.__player) : null; },
      GetPlayerByUserId(u){ return players.has(u) ? playerOf(u) : null; },
      FindFirstChild(n){ for (const [pid, P] of players) if (P.name === n) return playerOf(pid); return null; },
      get LocalPlayer(){ return playerOf([...players.keys()][0]); },
      IsA(c){ return c === 'Players' || c === 'Instance'; }, toString(){ return 'Players'; },
    };
    // ── Сервисы ──
    const RunService = { Heartbeat: signal((on, n) => send('want', { ev: 'heartbeat', on: n > 0 })), get Stepped(){ return this.Heartbeat; } };
    const TweenService = {
      Create(inst, info = {}, goals = {}){
        const id = inst && inst.__id; if (!id) throw new Error('TweenService.Create: нужен объект');
        if (objs.get(id)?.rt) throw new Error('TweenService: плавно меняются только детали и модели');
        const tid = newId(), g = {};
        for (const [k, v] of Object.entries(goals)) {
          if (k === 'CFrame' && v instanceof CFrame) { g.pos = [v.X, v.Y, v.Z]; g.rot = rotOf(v); continue; }
          if (k === 'BrickColor') { const h = brickHex(v); if (h) g.color = h; continue; }
          const key = PROPS[k]; if (!key) continue; g[key] = VEC.has(key) ? A(v) : v;
        }
        const Completed = signal();
        const tw = { tid, Completed, Play(){ send('tween', { tid, id, goals: g, time: Math.max(0, +(typeof info === 'number' ? info : info.Time) || 1), ease: (info && info.EasingStyle) || 'quad', reverses: !!(info && info.Reverses), repeat: Math.max(-1, Math.min(1000, +(info && info.RepeatCount) || 0)), delay: Math.max(0, +(info && info.DelayTime) || 0) }); tweens.set(tid, tw); return tw; }, Cancel(){ send('tweenCancel', { tid }); tweens.delete(tid); }, Pause(){ this.Cancel(); } };
        return tw;
      },
    };
    const TweenInfo = { new: (Time = 1, EasingStyle = 'quad', _dir, RepeatCount = 0, Reverses = false, DelayTime = 0) => ({ Time, EasingStyle, RepeatCount, Reverses, DelayTime }) };
    const wait = s => new Promise(res => { const t0 = Date.now(); setTimeout(() => res((Date.now() - t0) / 1000), Math.max(0, (+s || 0.03) * 1000)); });
    const task = { wait, spawn(fn, ...a){ setTimeout(() => { try { const r = fn(...a); if (r && r.catch) r.catch(e => err('', e)); } catch (e) { err('', e); } }, 0); }, delay(s, fn, ...a){ setTimeout(() => { try { fn(...a); } catch (e) { err('', e); } }, (+s || 0) * 1000); } };
    const Debris = { AddItem(inst, s){ setTimeout(() => inst && inst.Destroy && inst.Destroy(), Math.max(0, (+s || 0) * 1000)); } };
    const print = (...a) => send('print', { text: a.map(x => typeof x === 'object' ? (x && x.toString !== Object.prototype.toString ? String(x) : JSON.stringify(x)) : String(x)).join(' ').slice(0, 500), kind: 'log' });
    const warn = (...a) => send('print', { text: a.map(String).join(' ').slice(0, 500), kind: 'warn' });
    const gui = { message: (text, sec) => send('gui', { cmd: 'message', text: String(text).slice(0, 140), sec: +sec || 3 }), text: (key, text) => send('gui', { cmd: 'text', key: String(key).slice(0, 30), text: String(text).slice(0, 120) }), clear: key => send('gui', { cmd: 'clear', key: String(key).slice(0, 30) }) };
    const sound = { play: (name, at) => send('sound', { name: String(name).slice(0, 30), pos: at && at.__id ? objs.get(at.__id)?.p.pos : A(at) }) };
    const random = (a, b) => b === undefined ? (a === undefined ? Math.random() : Math.floor(Math.random() * a) + 1) : Math.floor(Math.random() * (b - a + 1)) + a;
    const game = { Name: 'Game', ClassName: 'DataModel', Workspace: workspace, Players, GetService: n => ({ Players, RunService, TweenService, Workspace: workspace, Debris })[n] || null, get workspace(){ return workspace; },
      IsA(c){ return c === 'DataModel' || c === 'Instance'; }, toString(){ return 'Game'; } };
    const scriptObj = s => ({ Name: s.name, Parent: s.parent ? proxyOf(s.parent) : workspace, ClassName: 'Script', Disabled: false,
      IsA(c){ return c === 'Script' || c === 'BaseScript' || c === 'LuaSourceContainer' || c === 'Instance'; },
      FindFirstChild(){ return null; }, GetChildren(){ return []; }, Destroy(){}, GetFullName(){ return (s.parent && proxyOf(s.parent) ? proxyOf(s.parent).GetFullName() : 'Workspace') + '.' + s.name; }, toString(){ return s.name; } });
    let LINE0 = 0;
    // ── Сообщения от хозяина мира ──
    onmessage = e => {
      const d = e.data || {};
      if (d.t === 'ping') { postMessage({ t: 'pong' }); return; }
      if (d.t === 'init') {
        for (const o of d.objs) objs.set(o.id, { id: o.id, cls: o.cls, parent: o.parent || null, children: [], p: o.p });
        for (const o of objs.values()) if (o.parent && objs.get(o.parent)) objs.get(o.parent).children.push(o.id);
        for (const p of d.players || []) players.set(p.id, p);
        // смещение строк: первая строка кода игрока
        try { new Function('throw new Error("x")')(); } catch (e2) { LINE0 = lineOf(e2.stack); }
        // библиотеки языков (lang-*.js) приходят текстом — регистрируются в globalThis.D37Lang
        globalThis.D37Lang = globalThis.D37Lang || {};
        for (const id of Object.keys(d.libs || {})) { try { (0, eval)(d.libs[id]); } catch (e5) { send('error', { script: '', line: 0, msg: 'Язык ' + id + ': ' + String(e5 && e5.message || e5).slice(0, 200) }); } }
        const API = { game, workspace, Instance, Vector3, Color3, Enum, TweenService, TweenInfo, RunService, Players, Debris, task, wait, print, warn, gui, sound, random, BrickColor, CFrame };
        for (const s of d.scripts) {
          curScript = s.name;
          if (s.lang && s.lang !== 'js') {
            const L = globalThis.D37Lang[s.lang], nm = s.name;
            if (!L || typeof L.run !== 'function') { err(nm, new Error('Язык «' + s.lang + '» не загрузился')); continue; }
            const scr = scriptObj(s);
            const ctx = { name: nm, error: (msg, line) => send('error', { script: nm, line: Math.max(0, line | 0), msg: String(msg).slice(0, 300) }), err: e => err(nm, e),
              signal, proxyOf, playerOf, objs, players, send, setCurrent: n => { curScript = n; } };
            try { const r = L.run(s.code, Object.assign({ script: scr }, API), ctx); if (r && r.catch) r.catch(e6 => err(nm, e6)); } catch (e7) { err(nm, e7); }
            continue;
          }
          try {
            const fn = new Function('script', 'game', 'workspace', 'Instance', 'Vector3', 'Color3', 'Enum', 'TweenService', 'TweenInfo', 'RunService', 'Players', 'Debris', 'task', 'wait', 'print', 'warn', 'gui', 'sound', 'random', 'BrickColor', 'CFrame',
              'return (async () => {\n' + s.code + '\n})();');
            const scr = scriptObj(s);
            const r = fn(scr, game, workspace, Instance, Vector3, Color3, Enum, TweenService, TweenInfo, RunService, Players, Debris, task, wait, print, warn, gui, sound, random, BrickColor, CFrame);
            const nm = s.name; if (r && r.catch) r.catch(e3 => err(nm, e3));
          } catch (e4) { err(s.name, e4); }
        }
        curScript = '';
        for (const p of players.keys()) Players.PlayerAdded._fire(playerOf(p));
        setTimeout(() => { for (const p of players.keys()) charAdded(p); }, 30);   // персонаж появляется чуть позже входа (CharacterAdded)
        postMessage({ t: 'ready' });
        return;
      }
      if (d.t === 'tick') { if (d.players) for (const p of d.players) { const P = players.get(p.id); if (P) P.pos = p.pos; } if (d.dt) RunService.Heartbeat._fire(d.dt); return; }
      if (d.t === 'sync') { const o = objs.get(d.id); if (o) Object.assign(o.p, d.p); return; }
      if (d.t === 'ev') {
        if (d.id && (d.ev === 'touched' || d.ev === 'touchEnded' || d.ev === 'clicked' || d.ev === 'prompt') && !objs.has(d.id)) return;
        const pl = d.player ? playerOf(d.player) : null;
        const hit = pl ? { Name: pl.Name, ClassName: 'Part', Parent: charOf(d.player), __player: d.player, IsA(c){ return c === 'Part' || c === 'BasePart' || c === 'Instance'; }, get Position(){ return charOf(d.player).HumanoidRootPart.Position; }, toString(){ return pl.Name; } } : null;
        if (d.ev === 'touched') H.touched.get(d.id)?._fire(hit, pl);
        else if (d.ev === 'touchEnded') H.touchEnded.get(d.id)?._fire(hit, pl);
        else if (d.ev === 'clicked') H.clicked.get(d.id)?._fire(pl);
        else if (d.ev === 'prompt') H.prompt.get(d.id)?._fire(pl);
        else if (d.ev === 'tweenDone') { const tw = tweens.get(d.tid); if (tw) { tweens.delete(d.tid); tw.Completed._fire('Completed'); } }
        else if (d.ev === 'playerAdded') { players.set(d.p.id, d.p); Players.PlayerAdded._fire(playerOf(d.p.id)); setTimeout(() => charAdded(d.p.id), 30); }
        else if (d.ev === 'playerRemoving') { const p = playerOf(d.id); if (p) Players.PlayerRemoving._fire(p); for (const o of [...objs.values()]) if (o.pl === d.id) destroy(o.id); players.delete(d.id); }
        else if (d.ev === 'died') { const P = players.get(d.player); if (P) { P.health = 0; P.died && P.died._fire(); } }
        else if (d.ev === 'respawned') { const P = players.get(d.player); if (P) { P.health = P.maxHealth ?? 100; charAdded(d.player); } }
        return;
      }
    };
  }

  // ═══ Песочница: iframe (CSP без сети) — внутри поток с runtime; iframe пересылает сообщения и следит, не завис ли поток ═══
  function frameHtml(){
    const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
let w = null, last = Date.now(), dead = false;
const up = m => parent.postMessage(m, '*');
addEventListener('message', e => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.t === 'boot') {
    try { w = new Worker(URL.createObjectURL(new Blob(['(' + d.code + ')()'], { type: 'text/javascript' }))); }
    catch (er) { up({ t: 'error', script: '', line: 0, msg: 'Не удалось запустить скрипты: ' + er.message }); return; }
    w.onmessage = ev => { last = Date.now(); if (ev.data && ev.data.t !== 'pong') up(ev.data); };
    w.onerror = ev => { up({ t: 'error', script: '', line: ev.lineno || 0, msg: ev.message || 'ошибка' }); ev.preventDefault(); };
    last = Date.now();
    setInterval(() => { if (dead || !w) return; w.postMessage({ t: 'ping' }); if (Date.now() - last > 3000) { dead = true; w.terminate(); up({ t: 'hang' }); } }, 700);
    return;
  }
  if (w && !dead) w.postMessage(d);
});
up({ t: 'frame' });
<\/script>`;
  }

  E.scripts = function (host){
    const SH = { running: false, wantBeat: false, want: { touched: new Set(), touchEnded: new Set(), clicked: new Set() } };
    let frame = null, onMsg = null, queue = [], ready = false, posT = 0;
    const post = m => { if (frame?.contentWindow && ready) frame.contentWindow.postMessage(m, '*'); else queue.push(m); };
    SH.start = (scene, players) => {
      SH.stop();
      const scripts = scene.all().filter(o => o.cls === 'Script' && o.enabled !== false && String(o.code || '').trim()).map(o => {
        const lang = o.lang && E.langs[o.lang] ? o.lang : 'js', bin = E.langs[lang].kind === 'binary';
        return { id: o.id, name: o.name, parent: o.parent, lang, code: String(o.code).slice(0, bin ? 3e6 : 200000) };
      });
      const libs = {};
      for (const s of scripts) if (s.lang !== 'js' && !libs[s.lang] && E.langs[s.lang].worker) libs[s.lang] = '(' + E.langs[s.lang].worker.toString() + ')();';
      SH.running = true;
      if (!scripts.length) return false;
      const objs = scene.all().filter(o => o.cls !== 'Script').map(o => {
        const p = {}; for (const k of ['name', 'shape', 'pos', 'rot', 'size', 'color', 'mat', 'alpha', 'collide', 'anchored', 'shadow', 'range', 'power', 'kind', 'text', 'attrs']) if (o[k] !== undefined) p[k] = JSON.parse(JSON.stringify(o[k]));
        return { id: o.id, cls: o.cls, parent: o.parent, p };
      });
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      frame.srcdoc = frameHtml();
      onMsg = e => {
        if (e.source !== frame?.contentWindow) return;
        const d = e.data || {};
        if (d.t === 'frame') { ready = true; frame.contentWindow.postMessage({ t: 'boot', code: runtime.toString() }, '*'); frame.contentWindow.postMessage({ t: 'init', objs, scripts, players, libs }, '*'); for (const m of queue) frame.contentWindow.postMessage(m, '*'); queue = []; return; }
        if (d.t === 'want') { if (d.ev === 'heartbeat') SH.wantBeat = !!d.on; else if (SH.want[d.ev]) { if (d.on) SH.want[d.ev].add(d.id); else SH.want[d.ev].delete(d.id); } if (d.ev === 'clicked' || d.ev === 'prompt') host.apply?.(d); return; }
        if (d.t === 'print') { host.print?.(String(d.text || ''), d.kind); return; }
        if (d.t === 'error') { host.error?.(String(d.script || ''), +d.line || 0, String(d.msg || '')); return; }
        if (d.t === 'hang') { host.hang?.(); SH.running = false; return; }
        if (d.t === 'ready') return;
        host.apply?.(d);
      };
      window.addEventListener('message', onMsg);
      document.body.appendChild(frame);
      return true;
    };
    SH.event = (ev, data = {}) => { if (SH.running) post({ t: 'ev', ev, ...data }); };
    // Heartbeat — каждый шаг, только если скрипт подписан; иначе позиции игроков — 10 раз в секунду (player.Position)
    SH.tick = (dt, players) => {
      if (!SH.running) return;
      if (SH.wantBeat) { post({ t: 'tick', dt, players }); return; }
      posT += dt; if (posT >= .1) { posT = 0; post({ t: 'tick', dt: 0, players }); }
    };
    SH.sync = (id, p) => { if (SH.running) post({ t: 'sync', id, p }); };
    SH.stop = () => {
      SH.running = false; SH.wantBeat = false; for (const s of Object.values(SH.want)) s.clear();
      if (onMsg) window.removeEventListener('message', onMsg);
      frame?.remove(); frame = null; onMsg = null; ready = false; queue = [];
    };
    return SH;
  };
  E.scripts.runtime = runtime;

  // ═══ Реестр языков скриптов (JavaScript — встроенный) ═══
  E.langs = E.langs || {};
  E.lang = (id, def) => { E.langs[id] = Object.assign({ id, label: id, short: id, icon: '📜', kind: 'text', examples: [], ai: '', placeholder: '' }, E.langs[id], def); return E.langs[id]; };
  E.lang('js', { label: 'JavaScript', short: 'JS', icon: '📜', kind: 'text' });
})();
