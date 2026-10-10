// Тест сети движка (js/engine/net.js) в node, без браузера: модель сети (задержка, разброс, потери, перестановка пакетов,
// ограничение скорости канала и ограничитель NetPlay «не чаще 190 мс» через Supabase), хозяин + гости, минуты модельного
// времени: сходимость копий мира, плавность чужих персонажей, новичок посреди игры, смена хозяина (ушёл / завис),
// защита от «бега сквозь стены», пакеты/с и байт/с на каждого. Запуск из корня сайта: node scripts/net-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
for (const f of ['core', 'net']) vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
const E = globalThis.D37E, NT = E.net._t, U = E.UNIT;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };
const f1 = v => (Math.round(v * 10) / 10).toFixed(1), f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// ═══ Очередь событий модели ═══
class Heap {
  constructor(){ this.a = []; }
  get size(){ return this.a.length; }
  peek(){ return this.a[0]; }
  push(x){ const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } }
  pop(){ const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && lt(a[l], a[m])) m = l; if (r < a.length && lt(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
}
const lt = (x, y) => x.t < y.t || (x.t === y.t && x.n < y.n);

// ═══ Сцена как D37E.scene (те же правила add/set/remove/reparent, без Three.js) ═══
const DEF = {
  Part: { name: 'Деталь', shape: 'block', pos: [0, .5, 0], rot: [0, 0, 0], size: [4, 1, 2], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true },
  Spawn: { name: 'Точка появления', shape: 'block', pos: [0, .2, 0], rot: [0, 0, 0], size: [6, .4, 6], color: '#5b6b82', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true },
  Light: { name: 'Свет', pos: [0, 4, 0], color: '#fff1c4', range: 18, power: 2 },
  Prefab: { name: 'Предмет', kind: 'tree', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, text: 'Привет!', color: '#7c3aed' },
  Model: { name: 'Модель' },
  Script: { name: 'Скрипт', code: '', enabled: true, lang: 'js' },
};
const SAVE = ['name', 'shape', 'pos', 'rot', 'size', 'color', 'mat', 'alpha', 'collide', 'anchored', 'shadow', 'range', 'power', 'kind', 'scale', 'text', 'code', 'lang', 'src', 'enabled', 'attrs', 'locked'];
const copy = v => Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
function fakeScene(){
  const objects = new Map(), order = [];
  const SC = { objects, sets: 0 };
  SC.get = id => objects.get(id) || null;
  SC.all = () => order.slice();
  SC.add = (cls, props = {}, parent = null, id = null) => {
    if (!DEF[cls]) throw new Error('класс: ' + cls);
    const obj = { id: id || 'o' + Math.random().toString(36).slice(2, 9), cls, parent: null, children: [], ...copy(DEF[cls]) };
    for (const k of SAVE) if (props[k] !== undefined) obj[k] = copy(props[k]);
    if (props.name) obj.name = String(props.name).slice(0, 40);
    objects.set(obj.id, obj); order.push(obj);
    if (parent) { const p = objects.get(typeof parent === 'string' ? parent : parent.id); if (p) { obj.parent = p.id; p.children.push(obj.id); } }
    return obj;
  };
  SC.remove = obj => {
    if (!obj || !objects.has(obj.id)) return;
    for (const cid of obj.children.slice()) SC.remove(objects.get(cid));
    objects.delete(obj.id); order.splice(order.indexOf(obj), 1);
    if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
  };
  SC.reparent = (obj, parent) => {
    if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
    obj.parent = null;
    if (parent && parent !== obj) { obj.parent = parent.id; parent.children.push(obj.id); }
  };
  SC.set = (obj, key, val) => { if (!obj) return; obj[key] = copy(val); SC.sets++; };
  return SC;
}
// Одинаковы ли копии (по квантованным свойствам, как их видит сеть)
const QCTX = sc => ({ extra: [], nidOf: sid => sid, sidOf: x => x });
function compareScenes(host, guest, skip){
  const res = { missing: 0, extra: 0, diff: 0, first: '' };
  const hq = QCTX(host), gq = QCTX(guest);
  for (const o of host.all()) {
    if (o.cls === 'Script' || (skip && skip(o))) continue;
    const g = guest.get(o.id);
    if (!g) { res.missing++; if (!res.first) res.first = 'нет ' + o.id; continue; }
    for (let i = 0; i < NT.PROPS.length; i++) {
      const a = NT.quant(i, o, hq), b = NT.quant(i, g, gq);
      if (JSON.stringify(a) !== JSON.stringify(b)) { res.diff++; if (!res.first) res.first = `${o.id}.${NT.PROPS[i][0]}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`; break; }
    }
  }
  for (const g of guest.all()) if (g.cls !== 'Script' && !host.get(g.id)) { res.extra++; if (!res.first) res.first = 'лишний ' + g.id; }
  res.ok = !res.missing && !res.extra && !res.diff;
  return res;
}

// ═══ Модель сети ═══
// Канал в одну сторону: задержка ± разброс (равномерно), потери, иногда «перестановка» (+20–60 мс), полоса (байт/с)
const NET = {
  p2p: { lat: 75, jit: 30, loss: .03, reorder: .03, dup: .01, bw: 250000 },     // RTT 150 ± 30 мс, 3 % потерь, 1 % двойных
  relay: { lat: 100, jit: 40, loss: .01, reorder: .02, dup: .005, bw: 60000 },  // через Supabase: RTT 200 ± 40 мс
};
function makeSim(cfg){
  const rnd = E.rng(cfg.seed || 1);
  const sim = { t: 0, n: 0, heap: new Heap(), peers: new Map(), presence: [], cfg, rnd, limiterDrops: 0, links: new Map(), free: new Map(), relayAt: new Map() };
  sim.at = (t, f) => sim.heap.push({ t, n: sim.n++, f });
  sim.mode = (a, b) => (cfg.mode ? cfg.mode(a, b, sim.t) : 'p2p');
  sim.link = (a, b) => { const k = a + '>' + b; let L = sim.links.get(k); if (!L) sim.links.set(k, L = { msgs: [], sz: [], bytes: 0, n: 0, lost: 0 }); return L; };
  sim.send = (from, to, u8) => {
    const P = sim.peers.get(from), Q = sim.peers.get(to);
    if (!P || P.crashed || P.left) return;
    const mode = sim.mode(from, to), net = Object.assign({}, NET[mode], cfg.net?.[mode]);
    const L = sim.link(from, to); L.msgs.push(sim.t); L.sz.push(u8.length); L.bytes += u8.length; L.n++;
    if (mode === 'relay') {   // как NetPlay: быстрые сообщения через комнату — не чаще 190 мс
      const k = from + '>' + to, last = sim.relayAt.get(k) ?? -1e9;
      if (sim.t - last < 190) { sim.limiterDrops++; return; }
      sim.relayAt.set(k, sim.t);
    }
    if (rnd() < net.loss) { L.lost++; return; }
    const fk = from + '>' + to, start = Math.max(sim.t, sim.free.get(fk) || 0), done = start + u8.length / net.bw * 1000;
    sim.free.set(fk, done);
    let d = net.lat + (rnd() * 2 - 1) * net.jit;
    if (rnd() < net.reorder) d += 20 + rnd() * 40;
    const copyU = u8.slice();
    sim.at(done + Math.max(1, d), () => { if (Q && !Q.crashed && !Q.left && Q.h.message) Q.h.message(from, copyU); });
    if (rnd() < (net.dup || 0)) { sim.dups = (sim.dups || 0) + 1; sim.at(done + Math.max(1, d) + 5 + rnd() * 80, () => { if (Q && !Q.crashed && !Q.left && Q.h.message) Q.h.message(from, copyU.slice()); }); }
  };
  // Присутствие (как Supabase presence): каждый узнаёт о входе/выходе с задержкой 150–500 мс
  sim.presenceChanged = () => {
    for (const P of sim.peers.values()) {
      if (P.crashed || P.left) continue;
      sim.at(sim.t + 150 + rnd() * 350, () => { if (!P.crashed && !P.left && P.h.members) P.h.members(sim.presence.map(m => ({ id: m.id, t: m.t }))); });
    }
  };
  sim.run = until => { while (sim.heap.size && sim.heap.peek().t <= until) { const e = sim.heap.pop(); sim.t = e.t; e.f(); } sim.t = until; };
  return sim;
}
function simTransport(sim, P){
  P.h = {};
  return {
    myId: P.id,
    send: (to, u8) => sim.send(P.id, to, u8),
    limits: to => ({ mode: sim.mode(P.id, to) }),
    listen: x => { P.h.message = x.message; P.h.members = x.members; },
    flush(){},
    close(){},
  };
}

// ═══ Путь персонажа: ходьба и бег по кругу, остановки, прыжки, «слалом»; раз в 40 с — телепорт на точку появления ═══
const WALK = 4 * U, RUN = 7 * U, G = 20 * U, JV = Math.sqrt(2 * G * 1.2 * U);
const CYCLE = 40;
const centerOf = (k, c) => [k * 30 - 45 + (c % 3) * 6, 0, (c % 2) * 10 - 5];
const RAD = 9;
function angleAt(s){   // s — секунды внутри цикла; угол по кругу (непрерывный)
  const w = WALK / RAD, r = RUN / RAD;
  if (s < 8) return s * w;
  if (s < 10) return 8 * w;
  if (s < 18) return 8 * w + (s - 10) * r;
  if (s < 20) return 8 * w + 8 * r;
  return 8 * w + 8 * r + (s - 20) * w;
}
const radAt = s => s >= 30 ? RAD + 2 * Math.sin(3 * (s - 30)) : RAD;
function jumpY(s){ if (s < 20.5 || s >= 29) return [0, 0]; const q = (s - 20.5) % 1.5, T = 2 * JV / G; if (q > T || s - q > 28.1) return [0, 0]; return [JV * q - G * q * q / 2, JV - G * q]; }   // прыжки в 20,5…28 с, каждый кончается до 29 с
function charAt(k, tMs){
  const T = tMs / 1000 + k * 7.3, c = Math.floor(T / CYCLE), s = T - c * CYCLE, C = centerOf(k, c);
  const pos = s2 => { const a = angleAt(s2), r = radAt(s2); return [C[0] + Math.cos(a) * r, C[2] + Math.sin(a) * r]; };
  const [x, z] = pos(s), e = .001, s0 = Math.max(0, s - e), s1 = Math.min(CYCLE - 1e-6, s + e), p0 = pos(s0), p1 = pos(s1);
  const vx = (p1[0] - p0[0]) / (s1 - s0), vz = (p1[1] - p0[1]) / (s1 - s0), sp = Math.hypot(vx, vz), [y, vy] = jumpY(s);
  return { x, y, z, yaw: sp > .1 ? Math.atan2(vx, vz) : 0, vx, vy, vz, moving: sp > .3, speed: sp, air: y > .01, tp: c, spawn: [C[0] + RAD, 0, C[2]] };
}
const truthAt = charAt;
// Положение игрока модели: путь (или путь читера) + сдвиг от телепорта хозяина (до конца текущего круга: там — точка появления)
const cycleOf = (k, t) => Math.floor((t / 1000 + k * 7.3) / CYCLE);
function charOf(P, t){
  const c = (P.charFn || truthAt)(P.k, t);
  let off = null;
  for (const o of P.offs) if (o[0] <= t && o[4] === cycleOf(P.k, t)) off = o;
  if (off) { c.x += off[1]; c.y += off[2]; c.z += off[3]; c.tp = c.tp * 1000 + P.offs.indexOf(off) + 1; }   // телепорт от хозяина — тоже «телепорт» для замеров
  return c;
}

// ═══ Мир хозяина: основание, 400 камней по полю ±150, 20 платформ (10 рядом с игроками, 10 далеко), 10 вертушек,
//  5 домов-моделей со стенами, точки появления, свет, дерево, скрипт (скрипт не реплицируется) ═══
const MATS = ['plastic', 'smooth', 'neon', 'glass', 'metal', 'diamond', 'wood', 'planks', 'brick', 'concrete', 'cobble', 'asphalt', 'grass', 'sand', 'rock', 'dirt', 'snow', 'ice', 'marble', 'fabric', 'tiles'];
const hex = n => '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');
function buildWorld(sc){
  const R = E.rng(37);
  sc.add('Part', { name: 'Основание', pos: [0, -.5, 0], size: [300, 1, 300], color: '#6b7a8f', mat: 'concrete' }, null, 'base');
  for (let k = 0; k < 5; k++) for (let c = 0; c < 6; c++) { const C = centerOf(k, c); sc.add('Spawn', { pos: [C[0] + RAD, .2, C[2]] }, null, `sp${k}_${c}`); }
  for (let i = 0; i < 400; i++) sc.add('Part', { name: 'Камень ' + i, pos: [(R() * 2 - 1) * 150, R() * 5, (R() * 2 - 1) * 150], size: [1 + R() * 4, 1 + R() * 3, 1 + R() * 4], rot: [0, Math.round(R() * 360), 0], color: hex(R() * 0xffffff), mat: MATS[i % 21] }, null, 's' + i);
  for (let i = 0; i < 20; i++) sc.add('Part', { name: 'Платформа ' + i, pos: [0, 2, 0], size: [4, .5, 4], color: '#f5cd30', mat: 'neon' }, null, 'm' + i);
  for (let i = 0; i < 10; i++) sc.add('Part', { name: 'Вертушка ' + i, pos: [i * 8 - 40, 1, 30], size: [6, .4, .6], color: '#ff0000' }, null, 'r' + i);
  for (let i = 0; i < 5; i++) { const m = sc.add('Model', { name: 'Дом ' + i }, null, 'h' + i); for (let j = 0; j < 4; j++) sc.add('Part', { name: 'Стена', pos: [i * 20 - 40, 2, -40 + j], size: [6, 4, .5], color: '#c4281c', mat: 'brick' }, m, `h${i}w${j}`); }
  sc.add('Light', { pos: [0, 6, 0] }, null, 'L1');
  sc.add('Prefab', { kind: 'tree', pos: [10, 0, 10] }, null, 'tree1');
  sc.add('Script', { name: 'Скрипт', code: 'print(1)' }, null, 'scr1');
}
// «Скрипты» хозяина: платформы и вертушки каждый шаг, цвет раз в 250 мс, новая деталь раз в 1,5 с, удаление раз в 2,3 с,
// перенос в другую модель раз в 5 с, прочие свойства раз в 3 с. После смены хозяина продолжает новый (как перезапуск скриптов)
function mkScript(sim, P){
  const R = E.rng(1000 + P.k * 77), sc = P.scene, st = { col: 0, spawn: 0, dest: 0, rep: 0, attr: 0, n: 0 };
  const dyn = () => sc.all().filter(o => o.id[0] === 'd');
  const statics = i => sc.get('s' + (i % 400));
  return t => {
    if (sim.frozen) return;
    for (let i = 0; i < 20; i++) {
      const o = sc.get('m' + i); if (!o) continue;
      const near = i < 10, k = t / 1000 * (near ? .8 : .5) + i, cx = near ? i * 10 - 45 : 130, cz = near ? 15 : (i - 15) * 20, r = near ? 5 : 6;
      sc.set(o, 'pos', [cx + Math.cos(k) * r, 2 + Math.sin(k * 2) * .5, cz + Math.sin(k) * r]);
    }
    for (let i = 0; i < 10; i++) { const o = sc.get('r' + i); if (o) sc.set(o, 'rot', [0, (o.rot[1] + 1.5) % 360, 0]); }
    if (t >= st.col) {
      st.col = t + 250;
      const o = statics(R() * 400 | 0); if (o) { const v = hex(R() * 0xffffff); sc.set(o, 'color', v); sim.change(o, 'color', v); }
    }
    if (t >= st.spawn) {
      st.spawn = t + 1500;
      const id = 'd' + P.k + '_' + (st.n++), par = R() < .3 ? sc.get('h' + (R() * 5 | 0)) : null;
      const o = sc.add('Part', { name: 'Новая ' + st.n, pos: [(R() * 2 - 1) * 60, 1 + R() * 3, (R() * 2 - 1) * 40], size: [1, 1, 1], color: hex(R() * 0xffffff), mat: MATS[R() * 21 | 0] }, par, id);
      sim.change(o, 'exists', true);
    }
    if (t >= st.dest) {
      st.dest = t + 2300;
      const d = dyn(); if (d.length > 8) { const o = d[R() * d.length | 0]; sc.remove(o); sim.change(o, 'gone', true); }
    }
    if (t >= st.rep) {
      st.rep = t + 5000;
      const d = dyn(); if (d.length) { const o = d[R() * d.length | 0], to = R() < .5 ? null : sc.get('h' + (R() * 5 | 0)); sc.reparent(o, to); }
    }
    if (t >= st.attr) {
      st.attr = t + 3000;
      const o = statics(R() * 400 | 0);
      if (o) { sc.set(o, 'attrs', { hp: R() * 100 | 0, tag: 'x' + st.n }); sc.set(o, 'alpha', Math.round(R() * 10) / 10); sc.set(o, 'size', [1 + R() * 3, 1, 1 + R() * 3]); sc.set(o, 'mat', MATS[R() * 21 | 0]); sc.set(o, 'name', 'Камень*' + st.n); sc.set(o, 'prompt', R() < .5 ? { text: 'Открыть', hold: 0 } : null); }
    }
  };
}

// ═══ Игрок модели ═══
function addPeer(sim, id, k, opts = {}){
  const P = { id, k, offs: [], blobs: new Map(), cpu: 0, off: 1000 + sim.rnd() * 5e6, scene: fakeScene(), crashed: false, left: false, hostLog: [], events: [], tele: [], cheats: [], plog: [], readyAt: 0, joinAt: sim.t, script: null, charFn: opts.charFn || null, lastTp: undefined, pending: [] };
  P.now = () => sim.t + P.off;
  if (opts.world) (opts.build || buildWorld)(P.scene);
  const tr = simTransport(sim, P);
  P.S = E.net.session({ transport: tr, scene: P.scene, now: P.now, nick: 'Игрок ' + k, info: { k }, hostTimeout: opts.hostTimeout,
    onHost: (isHost, info) => { P.hostLog.push([sim.t, isHost, info]); P.script = isHost ? (opts.script || mkScript)(sim, P) : null; },
    onReady: () => { if (!P.readyAt) P.readyAt = sim.t; },
    onEvent: (ty, d, from) => P.events.push([sim.t, ty, d, from]),
    onTeleport: (p, kind) => { P.tele.push([sim.t, p, kind]); const c = (P.charFn || truthAt)(P.k, sim.t); P.offs.push([sim.t, p[0] - c.x, p[1] - c.y, p[2] - c.z, cycleOf(P.k, sim.t)]); },
    onCheat: (who, info) => { P.cheats.push([sim.t, who, info.why]); if (process.env.NET_DEBUG) console.log('cheat?', P.id, '→', who, Math.round(sim.t), JSON.stringify(info)); },
    onPlayer: (ev, p) => P.plog.push([sim.t, ev, p.id]),
    onBlob: (name, u, text) => P.blobs.set(name, text()),
  });
  sim.peers.set(id, P);
  sim.presence.push({ id, t: sim.t });
  sim.presenceChanged();
  const step = () => {
    if (P.crashed || P.left) return;
    const c = charOf(P, sim.t);
    if (P.lastTp !== undefined && c.tp !== P.lastTp) P.S.teleported();
    P.lastTp = c.tp;
    P.S.setMyCharacter(c);
    if (P.S.isHost && P.script) P.script(sim.t);
    const c0 = process.hrtime.bigint(); P.S.tick(1 / 60); P.cpu += Number(process.hrtime.bigint() - c0) / 1e6;
    measure(sim, P);
    sim.at(sim.t + 1000 / 60, step);
  };
  sim.at(sim.t + sim.rnd() * 16, step);
  return P;
}
function leavePeer(sim, P){ P.left = true; sim.presence = sim.presence.filter(m => m.id !== P.id); sim.presenceChanged(); }
function crashPeer(sim, P, presenceMs){ P.crashed = true; sim.at(sim.t + presenceMs, () => { sim.presence = sim.presence.filter(m => m.id !== P.id); sim.presenceChanged(); }); }

// ═══ Замеры ═══
// Плавность: показ чужого персонажа сравниваем с его настоящим путём в момент (сейчас − задержка показа); «рывок» —
// сдвиг за кадр больше, чем позволяет настоящая скорость (× 1,3 + 2 см), на 5 см и более. После телепорта — 1,2 с не считаем
function measure(sim, P){
  if (sim.t < sim.warm) return;
  for (const r of P.S.remotes()) {
    const Q = sim.peers.get(r.id); if (!Q || Q.crashed || Q.left) continue;
    const key = P.id + '>' + r.id;
    let M = sim.cm.get(key); if (!M) sim.cm.set(key, M = { err: [], snaps: 0, fixes: 0, frames: 0, maxEx: 0, prev: null, tp: null, skip: 0, delay: [], buf: [], ex: 0, win: [] });
    const tt = r.rt - Q.off, tr = charOf(Q, tt), p = r.pose;   // показываемый момент — по часам владельца
    if (tr.tp !== M.tp) { M.tp = tr.tp; M.skip = sim.t + 1200; }
    const inWin = sim.windows.some(w => sim.t >= w[0] && sim.t < w[1]);
    if (sim.t >= M.skip) {
      const e = Math.hypot(p.x - tr.x, p.y - tr.y, p.z - tr.z);
      if (inWin) M.win.push(e); else M.err.push(e);
      if (M.prev) {
        const v = Math.max(...[-50, 0, 50].map(d => { const q = charOf(Q, tt + d); return Math.hypot(q.vx, q.vy, q.vz); }));
        const d = Math.hypot(p.x - M.prev.x, p.y - M.prev.y, p.z - M.prev.z), ex = d - (v * 1.3 / 60 + .02);
        if (process.env.NET_DEBUG && ex > (+process.env.NET_DEBUG || 1) && !inWin) console.log('snap', key, Math.round(sim.t), 'ex', f2(ex), 'tt', Math.round(tt), 'tp', tr.tp, 'buf', Math.round(r.buffer), 'xtr', r.extrapolating, 'pose', f2(p.x), f2(p.y), f2(p.z), 'prev', f2(M.prev.x), f2(M.prev.y), f2(M.prev.z), 'truth', f2(tr.x), f2(tr.y), f2(tr.z));
        if (!inWin) { M.frames++; if (ex > .3) M.snaps++; else if (ex > .05) M.fixes++; if (ex > M.maxEx) M.maxEx = ex; if (r.extrapolating) M.ex++; M.delay.push(sim.t - tt); M.buf.push(r.buffer); }
      }
    }
    M.prev = { x: p.x, y: p.y, z: p.z };
  }
  // задержка изменений: цвет / появление / удаление дошли до гостя
  if (!P.S.isHost && P.pending.length) {
    P.pending = P.pending.filter(c => {
      const host = sim.hostScene(), ho = host && host.get(c.sid), o = P.scene.get(c.sid);
      if (c.k === 'color') { if (!ho || ho.color !== c.v) return false; if (o && o.color === c.v) { sim.lat.push([c.near, sim.t - c.t0, 'color']); return false; } }
      else if (c.k === 'exists') { if (!ho) return false; if (o) { sim.lat.push([c.near, sim.t - c.t0, 'spawn']); return false; } }
      else if (c.k === 'gone') { if (!o) { sim.lat.push([c.near, sim.t - c.t0, 'gone']); return false; } }
      return sim.t - c.t0 < 30000;
    });
  }
}
function mkWorld(cfg){
  const sim = makeSim(cfg);
  sim.cm = new Map(); sim.lat = []; sim.windows = []; sim.warm = cfg.warm || 5000; sim.frozen = false;
  sim.hostScene = () => { for (const P of sim.peers.values()) if (!P.left && !P.crashed && P.S.isHost) return P.scene; return null; };
  sim.change = (o, k, v) => {
    for (const P of sim.peers.values()) {
      if (P.left || P.crashed || P.S.isHost || !P.readyAt) continue;
      const tr = charOf(P, sim.t), pos = o.pos || [0, 0, 0];
      P.pending.push({ sid: o.id, k, v, t0: sim.t, near: Math.hypot(pos[0] - tr.x, pos[2] - tr.z) <= 48 });
    }
  };
  return sim;
}
// Пакеты/с и байт/с по каждому каналу (от → кому) за отрезок [a, b]; пик — за любое окно 1 с
function linkStats(sim, a, b){
  const out = [];
  for (const [k, L] of sim.links) {
    const ts = [], dur = (b - a) / 1000; let bytes = 0;
    L.msgs.forEach((t, i) => { if (t >= a && t < b) { ts.push(t); bytes += L.sz[i]; } });
    if (!ts.length) continue;
    let peak = 0, j = 0; for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] >= 1000) j++; peak = Math.max(peak, i - j + 1); }
    out.push({ k, ps: ts.length / dur, peak, Bs: bytes / dur, n: L.n, lost: L.lost });
  }
  return out;
}

// ═══ 0. Кодирование ═══
{
  const w = new NT.W(4);
  w.u8(200); w.u16(65000); w.u32(4000000000); w.vu(0); w.vu(127); w.vu(128); w.vu(2 ** 40 + 5); w.vs(-1); w.vs(-123456); w.vs(98765); w.str('Привет, мир 🌍');
  const r = new NT.R(w.out());
  ok(r.u8() === 200 && r.u16() === 65000 && r.u32() === 4000000000 && r.vu() === 0 && r.vu() === 127 && r.vu() === 128 && r.vu() === 2 ** 40 + 5 && r.vs() === -1 && r.vs() === -123456 && r.vs() === 98765 && r.str() === 'Привет, мир 🌍' && r.left() === 0, 'байты: числа, varint, zigzag, строка');
  let bad = false; try { new NT.R(new Uint8Array([5])).u32(); } catch (e) { bad = true; } ok(bad, 'короткий пакет — ошибка, а не мусор');
  ok(NT.newer(1, 65535) && !NT.newer(65535, 1) && NT.newer(100, 99) && !NT.newer(5, 5), 'номера пакетов по кругу');
  const ctx = { extra: ['glow'], nidOf: () => 7, sidOf: () => 'p' };
  const o = { cls: 'Part', pos: [12.345, -0.004, 1999.996], rot: [-90, 450.04, 359.96], size: [4, .05, 1000], color: '#A1B2C3', alpha: .5, mat: 'neon', shape: 'wedge', collide: false, anchored: true, shadow: true, name: 'Дверь', text: '', attrs: { hp: 3 }, parent: 'p', prompt: { text: 'Открыть', hold: 1 }, glow: 2, kind: 'tree', scale: 1.5, range: 18, power: 2 };
  const back = {};
  for (let i = 0; i < NT.PROPS.length; i++) {
    const q = NT.quant(i, o, ctx); if (q === undefined) continue;
    const ww = new NT.W(); NT.writeQ(ww, i, q); const q2 = NT.readQ(new NT.R(ww.out()), i);
    if (JSON.stringify(q) !== JSON.stringify(q2)) back.err = NT.PROPS[i][0];
    back[NT.PROPS[i][0]] = NT.unq(i, q2, ctx);
  }
  ok(!back.err, 'свойства: запись = чтение', back.err);
  ok(back.pos.every((v, j) => Math.abs(v - o.pos[j]) <= .005), 'позиция — до 0,5 см', back.pos);
  ok(Math.abs(back.rot[0] - 270) < .051 && Math.abs(back.rot[1] - 90) < .051 && Math.abs(back.rot[2] - 0) < .051, 'углы по кругу, 0,1°', back.rot);
  ok(back.color === '#a1b2c3' && back.mat === 'neon' && back.shape === 'wedge' && back.alpha > .49 && back.alpha < .51 && back.name === 'Дверь' && back.parent === 'p' && back.attrs.hp === 3 && back.prompt.text === 'Открыть' && back.scale === 1.5, 'цвет, материал, форма, текст, родитель, attrs, подсказка');
  const fl = back._flags; ok(((fl >> 8) & 7) === 7 && (fl & 1) === 0 && (fl & 2) === 2, 'да/нет — только те, что есть у объекта');
  const c = { slot: 3, t: 123456789, tp: 7, on: 0, x: -12.344, y: 3.5, z: 99.999, yaw: -1, vx: 8.17, vy: -3.2, vz: 0, speed: 8.17, crouch: .5, moving: true, air: true, sit: false, hang: false, ladder: false, rollBack: false, roll: .25, pk: 'mantle', pkK: .5, climbPh: 1, seatY: null };
  const ww = new NT.W(); NT.writeChar(ww, c); const cb = NT.readChar(new NT.R(ww.out()));
  ok(ww.n <= 30 && cb.slot === 3 && cb.t === 123456789 && cb.tp === 7 && Math.abs(cb.x - c.x) <= .005 && Math.abs(cb.z - c.z) <= .005 && Math.abs(cb.yaw - (c.yaw + Math.PI * 2)) < .001 && cb.air && cb.moving && cb.pk === 'mantle' && Math.abs(cb.roll - .25) < .01 && Math.abs(cb.vx - 8.17) < .006, 'персонаж: снимок ≤ 30 байт, туда-обратно', ww.n);
  const w2 = new NT.W(); NT.writeChar(w2, { slot: 1, t: 5, tp: 0, on: 0, x: 1, y: 0, z: 1, yaw: 0, vx: 0, vy: 0, vz: 0, speed: 0, crouch: 0, roll: -1, seatY: null }); ok(w2.n <= 22, 'стоящий персонаж ≤ 22 байт', w2.n);
}

// ═══ 1. Основной: напрямую RTT 150 ± 30 мс, 3 % потерь, 3 % перестановок; B — через Supabase (5 пакетов/с);
//  новичок C на 60-й с; порча копии у C на 100-й; хозяин H уходит на 150-й; заморозка на 205-й, сверка на 215-й ═══
const R1 = {};
{
  const sim = mkWorld({ seed: 7, mode: (a, b) => (a === 'B' || b === 'B') ? 'relay' : 'p2p' });
  sim.windows.push([150000, 157000]);
  const H = addPeer(sim, 'H', 0, { world: true });
  sim.run(500); const A = addPeer(sim, 'A', 1);
  sim.run(1000); const B = addPeer(sim, 'B', 2);
  sim.run(3000);
  const WORLD = 'Ландшафт и скрипты: ' + 'холм '.repeat(9000);   // ~55 КБ — 10 кусков
  H.S.setBlob('world', WORLD); H.S.setPlayerData('A', { coins: 5, title: 'Строитель' });
  sim.run(60000);
  ok(A.blobs.get('world') === WORLD && B.blobs.get('world') === WORLD, 'большие данные (55 КБ) дошли до гостей (B — через Supabase)', [A.blobs.get('world')?.length, B.blobs.get('world')?.length]);
  ok(B.S.playerData('A')?.coins === 5, 'данные игрока (очки) видны гостям');
  const hostCount0 = H.scene.all().filter(o => o.cls !== 'Script').length;
  const C = addPeer(sim, 'C', 3);
  let fullAt = 0;
  for (let t = 60000; t < 90000 && !fullAt; t += 100) { sim.run(t); if (C.scene.all().length >= hostCount0 - 2 && !H.scene.all().some(o => o.cls !== 'Script' && o.id[0] === 's' && !C.scene.get(o.id))) fullAt = sim.t; }
  sim.run(99000);
  R1.join = { ready: C.readyAt - 60000, full: fullAt - 60000, objs: hostCount0, rx: sim.links.get('H>C')?.bytes || 0 };
  ok(C.readyAt > 0 && C.readyAt - 60000 < 6000, 'новичок: весь мир за < 6 с', C.readyAt - 60000);
  ok(fullAt > 0, 'новичок: все объекты на месте', fullAt);
  ok(C.blobs.get('world') === WORLD, 'новичку — большие данные тоже');
  // порча копии у C: объект удалён мимо сети, цвет испорчен, лишняя запись
  sim.run(100000);
  const dg = C.S._dbg;
  C.scene.remove(C.scene.get('s5'));
  const r6 = dg.reps.get('s6'); r6.q[3] = 0x123456; r6.h = 0; C.scene.set(C.scene.get('s6'), 'color', '#123456');
  const rz = dg.newRep('zz1', 'Part', 900000); rz.q = dg.reps.get('s7').q.slice(); rz.se = C.S.epoch; C.scene.add('Part', { pos: [0, 50, 0] }, null, 'zz1');
  sim.run(116000);
  const hs6 = H.scene.get('s6');
  ok(C.scene.get('s5') && hs6 && C.scene.get('s6')?.color === hs6.color && !C.scene.get('zz1') && !dg.reps.get('zz1'), 'сводка: копия у C починилась за 16 с (вернули, перекрасили, убрали лишнее)', [!!C.scene.get('s5'), C.scene.get('s6')?.color, hs6?.color, !!C.scene.get('zz1')]);
  R1.repair = { digests: C.S.digests || 0, bad: C.S.digestBad || 0, resyncs: H.S.resyncs || 0 };
  // часы хозяина у гостей
  sim.run(140000);
  R1.clock = [A, B, C].map(P => P.S.hostNow() - H.now());
  ok(R1.clock.every(e => Math.abs(e) < 25), 'часы хозяина у гостей точнее 25 мс', R1.clock.map(Math.round));
  // подделка: C шлёт B пакет «я хозяин, эпоха новее» с телепортом — B не верит
  {
    const w = new NT.W(), msg = new TextEncoder().encode(JSON.stringify({ k: 'tp', p: [999, 0, 999] }));
    w.u8(0xD1); w.u8(1 | 4); w.u8((B.S.epoch + 1) & 255); w.u16(7); w.u16(0); w.u32(0); w.u32(Math.round(C.now())); w.u16(0); w.u16(0);
    w.u8(4); w.vu(1); w.u16(0); w.u8(1); w.vu(msg.length); w.bytes(msg);
    const tele0 = B.tele.length;
    sim.send('C', 'B', w.out()); sim.run(141000);
    ok(B.S.hostId === 'H' && B.tele.length === tele0 && B.S.epoch === H.S.epoch, 'подделка «я хозяин» от гостя не принята', [B.S.hostId, B.tele.length - tele0]);
  }
  // хозяин уходит
  sim.run(150000);
  R1.links = linkStats(sim, 10000, 145000);
  R1.limiter = sim.limiterDrops;
  leavePeer(sim, H);
  const t0 = sim.t;
  let tA = 0, tB = 0, tC = 0;
  for (let t = t0; t < t0 + 20000; t += 20) {
    sim.run(t);
    if (!tA && A.S.isHost) tA = sim.t;
    const rx = P => { const L = P.S._dbg.links.get('A'); return P.S.hostId === 'A' && L && L.lastRx > P.now() - (sim.t - t0); };
    if (!tB && rx(B)) tB = sim.t;
    if (!tC && rx(C)) tC = sim.t;
    if (tA && tB && tC) break;
  }
  R1.migr = { a: tA - t0, b: tB - t0, c: tC - t0 };
  ok(tA && tB && tC && Math.max(tA, tB, tC) - t0 < 2500, 'хозяин ушёл: A — хозяин, B и C с ним < 2,5 с', R1.migr);
  ok(A.blobs.get('world') === WORLD && A.S.blob('world') && A.S.playerData('A')?.coins === 5, 'у нового хозяина есть большие данные и очки игроков');
  sim.run(170000);
  const D = addPeer(sim, 'D', 4);
  sim.run(205000);
  ok(D.readyAt > 0 && D.blobs.get('world') === WORLD, 'новичок после смены хозяина: мир и большие данные — от A', [D.readyAt, D.blobs.get('world')?.length]);
  sim.frozen = true;
  sim.run(215000);
  const cB = compareScenes(A.scene, B.scene), cC = compareScenes(A.scene, C.scene);
  ok(cB.ok, 'после смены хозяина: копия B = миру A', cB);
  ok(cC.ok, 'после смены хозяина: копия C = миру A', cC);
  const cD = compareScenes(A.scene, D.scene); ok(cD.ok, 'новичок D: копия = миру A', cD);
  ok(A.S.isHost && !B.S.isHost && !C.S.isHost && B.S.hostId === 'A' && C.S.hostId === 'A' && B.S.epoch === A.S.epoch, 'все согласны: хозяин A, одна эпоха');
  ok(A.S.players().length === 4 && B.S.players().length === 4 && D.S.players().length === 4, 'игроки: A, B, C, D (H ушёл)', A.S.players().map(p => p.id));
  R1.dups = sim.dups || 0;
  ok(sim.peers.get('A').cheats.length === 0 && H.cheats.length === 0, 'честных не считает читерами (потери и разброс)', [H.cheats.slice(0, 3), A.cheats.slice(0, 3)]);
  R1.cm = sim.cm; R1.lat = sim.lat; R1.limiter2 = sim.limiterDrops; R1.sim = sim;
  const nu = ids => mean(ids.map(id => (C.S._dbg.reps.get(id)?.nUpd || 0) / ((sim.t - 60000) / 1000)));
  R1.rate = { near: nu(['m8', 'm9']), far: nu(['m10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19']) };   // C ходит у x ≈ 45–57: m8, m9 рядом, m10–m19 (x = 130) далеко
  ok(R1.rate.near > 10 && R1.rate.far < R1.rate.near / 3, 'интерес: платформы рядом — часто, далеко — редко', R1.rate);
  // события: гость → хозяину, хозяин → всем
  B.S.sendEvent('prompt', { id: 's10' }); C.S.sendEvent('chat', { text: 'привет' }, 'all');
  sim.run(218000);
  ok(A.events.some(e => e[1] === 'prompt' && e[2].id === 's10' && e[3] === 'B'), 'событие гостя дошло до хозяина ([E] у двери)');
  ok(B.events.some(e => e[1] === 'chat' && e[3] === 'C') && A.events.some(e => e[1] === 'chat'), 'чат «всем» — через хозяина');
  A.S.teleport('B', [5, 1, 5]);
  sim.run(220000);
  ok(B.tele.some(e => e[2] === 'tp' && e[1][0] === 5), 'хозяин телепортирует гостя');
}

// ═══ 2. Только через Supabase (строгий NAT у всех): RTT 200 ± 40 мс, 1 % потерь, 3 игрока, 90 с ═══
const R2 = {};
{
  const sim = mkWorld({ seed: 11, mode: () => 'relay' });
  const H = addPeer(sim, 'H', 0, { world: true });
  sim.run(400); const A = addPeer(sim, 'A', 1);
  sim.run(800); const B = addPeer(sim, 'B', 2);
  sim.run(80000); sim.frozen = true; sim.run(92000);
  const a = compareScenes(H.scene, A.scene), b = compareScenes(H.scene, B.scene);
  ok(a.ok && b.ok, 'через Supabase: копии сошлись', [a, b]);
  ok(A.readyAt && A.readyAt < 12000, 'через Supabase: мир у гостя за < 12 с', A.readyAt);
  R2.links = linkStats(sim, 10000, 80000); R2.cm = sim.cm; R2.limiter = sim.limiterDrops; R2.lat = sim.lat; R2.ready = A.readyAt - 400;
  ok(H.cheats.length === 0, 'через Supabase: без ложных «читеров»', H.cheats.slice(0, 3));
}

// ═══ 3. Хозяин завис (вкладка умерла): присутствие висит ещё 30 с — гости сами выбирают нового через 5 с тишины ═══
const R3 = {};
{
  const sim = mkWorld({ seed: 23, mode: () => 'p2p' });
  sim.windows.push([40000, 48000]);
  const H = addPeer(sim, 'H', 0, { world: true });
  sim.run(300); const A = addPeer(sim, 'A', 1);
  sim.run(600); const B = addPeer(sim, 'B', 2);
  sim.run(40000);
  crashPeer(sim, H, 30000);
  const t0 = sim.t; let tA = 0, tB = 0;
  for (let t = t0; t < t0 + 25000; t += 20) {
    sim.run(t);
    if (!tA && A.S.isHost) tA = sim.t;
    const L = B.S._dbg.links.get('A');
    if (!tB && B.S.hostId === 'A' && L && L.lastRx > B.now() - (sim.t - t0)) tB = sim.t;
    if (tA && tB) break;
  }
  R3.a = tA - t0; R3.b = tB - t0;
  ok(tA && tB && tB - t0 < 7000, 'хозяин завис: A перехватил, B с ним < 7 с', R3);
  sim.run(80000); sim.frozen = true; sim.run(90000);
  const c = compareScenes(A.scene, B.scene);
  ok(c.ok, 'после перехвата копия B = миру A', c);
  ok(A.S.players().length === 2, 'после ухода H из присутствия — 2 игрока', A.S.players().map(p => p.id));
  R3.cm = sim.cm;
}

// ═══ 4. Читеры: (а) бег втрое быстрее — хозяин режет до разрешённой скорости (бег × 1,25); (б) прыжок на 50 ед. без
//  телепорта — не принят, у других не виден; (в) часы спешат вдвое и бег × 1,8 — запас пути считается по настоящему времени ═══
const R4 = {};
{
  const sim = mkWorld({ seed: 31, mode: () => 'p2p', warm: 1e9 });
  const H = addPeer(sim, 'H', 0, { world: true });
  sim.run(300); const A = addPeer(sim, 'A', 1);
  let mode = '', t0 = 0;
  const cheater = (k, t) => {
    const c = truthAt(k, t), s = (t - t0) / 1000;
    if (mode === 'speed') return Object.assign({}, c, { x: c.x + s * RUN * 2, vx: c.vx + RUN * 2 });
    if (mode === 'blink') return Object.assign({}, c, { x: c.x + 50 });
    if (mode === 'clock') return Object.assign({}, c, { x: c.x + s * RUN * .8, vx: c.vx + RUN * .8 });
    return c;
  };
  sim.run(600); const X = addPeer(sim, 'X', 2, { charFn: cheater });
  const xOff = X.off;
  const watch = (a, b) => { const seen = []; for (let t = a; t < b; t += 50) { sim.run(t); const r = A.S.remotes().find(q => q.id === 'X'); if (r) seen.push([sim.t, r.pose.x, r.pose.z]); } return seen; };
  const maxSpeed = seen => { let m = 0, lastJump = -1; for (let i = 0, j = 0; i < seen.length; i++) { if (i && Math.hypot(seen[i][1] - seen[i - 1][1], seen[i][2] - seen[i - 1][2]) > 2.5) lastJump = i; while (seen[i][0] - seen[j][0] > 1000) j++; if (j > lastJump && seen[i][0] - seen[j][0] >= 900) m = Math.max(m, Math.hypot(seen[i][1] - seen[j][1], seen[i][2] - seen[j][2]) / ((seen[i][0] - seen[j][0]) / 1000)); } return m; };   // окна с телепортом («вернись») не считаем
  sim.run(20000);
  ok(H.cheats.length === 0, 'до читов — чисто', H.cheats.slice(0, 2));
  mode = 'speed'; t0 = sim.t;
  R4.speed = maxSpeed(watch(20000, 26000)); R4.n1 = H.cheats.length;
  ok(R4.n1 > 0, 'бег ×3 замечен', R4.n1);
  ok(R4.speed < RUN * 1.25 * 1.1 + 3, 'бег ×3: другие видят не быстрее разрешённого (бег × 1,25)', f2(R4.speed));
  mode = ''; sim.run(30000);
  const before = A.S.remotes().find(q => q.id === 'X');
  mode = 'blink'; t0 = sim.t;
  const seenB = watch(30000, 31000);
  R4.blink = Math.max(...seenB.map(q => Math.abs(q[1] - before.pose.x)));
  ok(R4.blink < 12, 'прыжок на 50 ед. без телепорта не виден другим', f2(R4.blink));
  mode = ''; sim.run(35000);
  const n2 = H.cheats.length;
  X.now = () => sim.t + xOff + Math.max(0, sim.t - 35000);   // часы читера спешат вдвое
  mode = 'clock'; t0 = sim.t;
  R4.clock = maxSpeed(watch(35000, 41000)); R4.n3 = H.cheats.length - n2;
  ok(R4.n3 > 0 && R4.clock < RUN * 1.25 * 1.1 + 3, 'спешащие часы не дают лишней скорости', [R4.n3, f2(R4.clock)]);
  R4.fix = X.tele.filter(e => e[2] === 'fix').length; R4.cheats = H.cheats.length;
  ok(R4.fix > 0, 'читеру велено вернуться (fix)', R4.fix);
  ok(H.cheats.every(c => c[1] === 'X') && A.cheats.length === 0, 'замечания только читеру');
}

// ═══ 5. Настоящий транспорт (net-transport.js + js/games/netplay.js) поверх модели Supabase: presence и broadcast с
//  задержкой; WebRTC в node нет — всё «через комнату» пачками. 3 игрока, 60 с: копии сошлись, сообщений Supabase ≤ бюджета ═══
const R5 = {};
{
  globalThis.window = globalThis;
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/netplay.js'), 'utf8'), { filename: 'netplay.js' });
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/net-transport.js'), 'utf8'), { filename: 'net-transport.js' });
  delete globalThis.window;
  const sim = mkWorld({ seed: 41 });
  const hub = new Map(), cnt = { sent: 0, recv: 0, bytes: 0 };
  const client = {
    channel(name, cfg){
      const c = { name, key: cfg.config.presence.key, hb: [], hp: [], meta: null };
      c.on = (type, f, fn) => { (type === 'broadcast' ? c.hb : c.hp).push(fn); return c; };
      c.subscribe = cb => { let h = hub.get(name); if (!h) hub.set(name, h = new Set()); h.add(c); sim.at(sim.t + 80, () => cb('SUBSCRIBED')); return c; };
      const sync = () => { for (const x of hub.get(name) || []) sim.at(sim.t + 120 + sim.rnd() * 200, () => x.hp.forEach(f => f())); };
      c.track = meta => { c.meta = meta; sync(); return Promise.resolve(); };
      c.untrack = () => { c.meta = null; sync(); };
      c.presenceState = () => { const st = {}; for (const x of hub.get(name) || []) if (x.meta) (st[x.key] = st[x.key] || []).push(x.meta); return st; };
      c.send = ({ payload }) => {
        const s = JSON.stringify(payload); cnt.sent++; cnt.bytes += s.length;
        for (const x of hub.get(name) || []) if (x !== c) { cnt.recv++; if (sim.rnd() < .005) continue; sim.at(sim.t + 90 + sim.rnd() * 60, () => x.hb.forEach(f => f({ payload: JSON.parse(s) }))); }
        return Promise.resolve();
      };
      return c;
    },
    removeChannel(c){ const h = hub.get(c.name); if (h) { h.delete(c); for (const x of h) sim.at(sim.t + 150, () => x.hp.forEach(f => f())); } },
  };
  const peers = [];
  const mk = (id, k, world) => {
    const P = { id, k, offs: [], off: 1000 + sim.rnd() * 1e6, scene: fakeScene(), hostLog: [], readyAt: 0, pending: [], cheats: [] };
    P.now = () => sim.t + P.off;
    if (world) buildWorld(P.scene);
    const tr = E.net.room('s3test', 'abc123', { client, NetPlay: globalThis.NetPlay, key: id, joinedAt: 1e6 + sim.t, now: P.now, nick: 'Игрок ' + k });
    P.tr = tr;
    P.S = E.net.session({ transport: tr, scene: P.scene, now: P.now, nick: 'Игрок ' + k,
      onHost: is => { P.script = is ? mkScript(sim, P) : null; }, onReady: () => { if (!P.readyAt) P.readyAt = sim.t; }, onCheat: (w, i) => P.cheats.push([w, i.why]),
      onTeleport: p => { const c = (P.charFn || truthAt)(P.k, sim.t); P.offs.push([sim.t, p[0] - c.x, p[1] - c.y, p[2] - c.z, cycleOf(P.k, sim.t)]); } });
    P.id = tr.myId;
    const step = () => { const c = charOf(P, sim.t); if (P.lastTp !== undefined && c.tp !== P.lastTp) P.S.teleported(); P.lastTp = c.tp; P.S.setMyCharacter(c); if (P.S.isHost && P.script) P.script(sim.t); P.S.tick(1 / 60); sim.at(sim.t + 1000 / 60, step); };
    sim.at(sim.t + 5, step);
    peers.push(P); sim.peers.set(P.id, P);
    return P;
  };
  const H = mk('h', 0, true); sim.run(400);
  const A = mk('a', 1); sim.run(900);
  const B = mk('b', 2);
  sim.run(10000); const c0 = { ...cnt };
  sim.run(70000); const c1 = { ...cnt };
  sim.frozen = true; sim.run(80000);
  const ca = compareScenes(H.scene, A.scene), cb = compareScenes(H.scene, B.scene);
  ok(H.S.isHost && A.S.hostId === H.id && B.S.hostId === H.id, 'транспорт: хозяин — первый вошедший');
  ok(ca.ok && cb.ok, 'транспорт: копии сошлись (через комнату, пачками)', [ca, cb]);
  ok(A.readyAt && B.readyAt, 'транспорт: мир у гостей готов', [A.readyAt, B.readyAt]);
  ok(H.cheats.length === 0, 'транспорт: без ложных «читеров»', H.cheats.slice(0, 2));
  const rA = A.S.remotes().find(r => r.id === H.id);
  ok(rA && Math.hypot(rA.pose.x - charOf(H, rA.rt - H.off).x, rA.pose.z - charOf(H, rA.rt - H.off).z) < 1.5, 'транспорт: гость видит хозяина там, где он был', rA && rA.pose);
  R5.perMin = (c1.recv - c0.recv) / 1; R5.sentPerMin = c1.sent - c0.sent; R5.kbps = (c1.bytes - c0.bytes) / 60 / 1024;
  const sH = H.tr.stats();
  ok(R5.sentPerMin <= 3 * 5 * 60 && R5.perMin <= 3 * 5 * 60 * 2, 'транспорт: ≤ 5 broadcast в секунду с каждого', [R5.sentPerMin, R5.perMin]);
  R5.sig = sH.sigMsgs;
  for (const P of peers) P.tr.close();
  sim.run(81000);
  ok(!hub.get('s3test-net-abc123')?.size, 'транспорт: после выхода канал пуст');
}

// ═══ 6. Большой мир: 3000 деталей + 150 движущихся, хозяин + 2 гостя, новичок на 15-й с — время процессора на сеть ═══
const R6 = {};
{
  const sim = mkWorld({ seed: 53, mode: () => 'p2p', warm: 1e9 });
  const build = sc => {
    const R = E.rng(5);
    sc.add('Part', { name: 'Основание', pos: [0, -.5, 0], size: [400, 1, 400] }, null, 'base');
    for (let k = 0; k < 5; k++) for (let c = 0; c < 6; c++) { const C = centerOf(k, c); sc.add('Spawn', { pos: [C[0] + RAD, .2, C[2]] }, null, `sp${k}_${c}`); }
    for (let i = 0; i < 3000; i++) sc.add('Part', { name: 'Блок ' + i, pos: [(R() * 2 - 1) * 200, R() * 8, (R() * 2 - 1) * 200], size: [1 + R() * 3, 1 + R() * 3, 1 + R() * 3], rot: [0, Math.round(R() * 360), 0], color: hex(R() * 0xffffff), mat: MATS[i % 21] }, null, 'b' + i);
    for (let i = 0; i < 150; i++) sc.add('Part', { name: 'Ездит ' + i, pos: [0, 2, 0], size: [3, .5, 3], mat: 'neon' }, null, 'v' + i);
  };
  const script = (sim2, P) => { const R = E.rng(9); let next = 0; return t => {
    if (sim.frozen) return;
    for (let i = 0; i < 150; i++) { const o = P.scene.get('v' + i); if (!o) continue; const k = t / 1000 * .7 + i, cx = (i % 15) * 26 - 182, cz = Math.floor(i / 15) * 40 - 180; P.scene.set(o, 'pos', [cx + Math.cos(k) * 6, 2, cz + Math.sin(k) * 6]); }
    if (t >= next) { next = t + 100; const o = P.scene.get('b' + (R() * 3000 | 0)); if (o) P.scene.set(o, 'color', hex(R() * 0xffffff)); }
  }; };
  const H = addPeer(sim, 'H', 0, { world: true, build, script });
  sim.run(300); const A = addPeer(sim, 'A', 1);
  sim.run(600); const B = addPeer(sim, 'B', 2);
  sim.run(15000);
  const cpu0 = [H.cpu, A.cpu, B.cpu];
  const C = addPeer(sim, 'C', 3);
  sim.run(30000);
  const cpu1 = [H.cpu, A.cpu, B.cpu];
  sim.frozen = true; sim.run(36000);
  R6.ready = C.readyAt - 15000; R6.joinKB = (sim.links.get('H>C')?.bytes || 0) / 1024;
  R6.cpuH = (cpu1[0] - cpu0[0]) / 15; R6.cpuG = ((cpu1[1] - cpu0[1]) + (cpu1[2] - cpu0[2])) / 2 / 15;
  ok(C.readyAt && R6.ready < 8000, 'большой мир: новичок получил 3150 объектов < 8 с', R6.ready);
  const c = compareScenes(H.scene, C.scene), a = compareScenes(H.scene, A.scene);
  ok(c.ok && a.ok, 'большой мир: копии сошлись', [c, a]);
  ok(R6.cpuH < 150, 'большой мир: хозяину сеть стоит < 150 мс процессора в секунду (node)', f1(R6.cpuH));
  R6.links = linkStats(sim, 16000, 30000);
}

// ═══ 8. Для игр на двоих: D37E.net.duel поверх готовых GameRoom + NetPlay (здесь — их модель: комната и канал в памяти) ═══
const R8 = {};
{
  const sim = mkWorld({ seed: 71, warm: 1e9 });
  const mkSide = (id, t, k, world) => {
    const P = { id, k, offs: [], off: 5000 + sim.rnd() * 1e5, scene: fakeScene(), readyAt: 0, pending: [], cheats: [], lastTp: undefined };
    P.now = () => sim.t + P.off;
    if (world) buildWorld(P.scene);
    P.room = { myId: id, joinedAt: t, opp: null };
    P.np = { mode: () => 'p2p', sendBin: buf => { if (sim.rnd() < .03) return; const u = buf.slice(0); sim.at(sim.t + 60 + sim.rnd() * 30, () => P.other && P.other.tr.binary(u)); } };
    P.tr = E.net.duel(P.room, P.np);
    P.S = E.net.session({ transport: P.tr, scene: P.scene, now: P.now, nick: 'Игрок ' + k,
      onHost: is => { P.script = is ? mkScript(sim, P) : null; }, onReady: () => { if (!P.readyAt) P.readyAt = sim.t; }, onCheat: (w, i) => P.cheats.push([w, i.why]) });
    const step = () => { const c = charOf(P, sim.t); if (P.lastTp !== undefined && c.tp !== P.lastTp) P.S.teleported(); P.lastTp = c.tp; P.S.setMyCharacter(c); if (P.S.isHost && P.script) P.script(sim.t); P.S.tick(1 / 60); sim.at(sim.t + 1000 / 60, step); };
    sim.at(sim.t + 3, step);
    sim.peers.set(id, P);
    return P;
  };
  const H = mkSide('u1~1000', 1000, 0, true), G = mkSide('g-x~2000', 2000, 1, false);
  H.other = G; G.other = H;
  // GameRoom сообщает соперника (onPeer) — здесь сразу у обоих
  H.room.opp = { id: G.id, nick: 'Игрок 1' }; G.room.opp = { id: H.id, nick: 'Игрок 0' };
  H.tr.peer(); G.tr.peer();
  sim.run(25000); sim.frozen = true; sim.run(30000);
  const c = compareScenes(H.scene, G.scene);
  ok(H.S.isHost && !G.S.isHost && G.S.hostId === H.id, 'на двоих (duel): хозяин — кто раньше вошёл в GameRoom');
  ok(c.ok && G.readyAt, 'на двоих (duel): копия сошлась, мир готов', c);
  const r = G.S.remotes().find(x => x.id === H.id);
  ok(r && Math.hypot(r.pose.x - charOf(H, r.rt - H.off).x, r.pose.z - charOf(H, r.rt - H.off).z) < .5 && H.cheats.length === 0, 'на двоих (duel): персонаж хозяина виден точно, без ложных «читеров»');
}

// ═══ 7. Настоящий транспорт с WebRTC: модель RTCPeerConnection (предложение/ответ/ICE, два канала: быстрый без повторов
//  и надёжный), js/games/netplay.js как есть. Старший (хозяин) предлагает, гости отвечают; гости между собой не соединяются;
//  после соединения Supabase почти не тратится ═══
const R7 = {};
function fakeSupabase(sim, cnt){
  const hub = new Map();
  return { hub,
    channel(name, cfg){
      const c = { name, key: cfg.config.presence.key, hb: [], hp: [], meta: null };
      c.on = (type, f, fn) => { (type === 'broadcast' ? c.hb : c.hp).push(fn); return c; };
      c.subscribe = cb => { let h = hub.get(name); if (!h) hub.set(name, h = new Set()); h.add(c); sim.at(sim.t + 80, () => cb('SUBSCRIBED')); return c; };
      const sync = () => { for (const x of hub.get(name) || []) sim.at(sim.t + 120 + sim.rnd() * 200, () => x.hp.forEach(f => f())); };
      c.track = meta => { c.meta = meta; sync(); return Promise.resolve(); };
      c.untrack = () => { c.meta = null; sync(); };
      c.presenceState = () => { const st = {}; for (const x of hub.get(name) || []) if (x.meta) (st[x.key] = st[x.key] || []).push(x.meta); return st; };
      c.send = ({ payload }) => {
        const s = JSON.stringify(payload); cnt.sent++; if (payload.type === 'ns') cnt.sig++;
        for (const x of hub.get(name) || []) if (x !== c) { cnt.recv++; sim.at(sim.t + 90 + sim.rnd() * 60, () => x.hb.forEach(f => f({ payload: JSON.parse(s) }))); }
        return Promise.resolve();
      };
      return c;
    },
    removeChannel(c){ const h = hub.get(c.name); if (h) { h.delete(c); for (const x of h) sim.at(sim.t + 150, () => x.hp.forEach(f => f())); } },
  };
}
function installFakeRTC(sim){
  const pcs = new Map(); let ids = 0;
  class DC {
    constructor(pc, label, opt){ this.pc = pc; this.label = label; this.unrel = !!opt && opt.maxRetransmits === 0; this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null; }
    send(data){
      if (this.readyState !== 'open') throw new Error('closed');
      sim.p2pMsgs = (sim.p2pMsgs || 0) + 1;
      if (this.unrel && sim.rnd() < .03) return;   // быстрый канал без повторов теряет
      const peer = this.peer, copy = typeof data === 'string' ? data : data.slice(0), d = 40 + (this.unrel ? (sim.rnd() * 2 - 1) * 15 : 0);
      sim.at(sim.t + d, () => { if (peer.readyState === 'open' && peer.onmessage) peer.onmessage({ data: copy }); });
    }
    close(){ if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose && this.onclose(); const p = this.peer; if (p && p.readyState !== 'closed') { p.readyState = 'closed'; p.onclose && p.onclose(); } }
  }
  globalThis.RTCPeerConnection = class {
    constructor(){ this.id = ++ids; pcs.set(this.id, this); this.dcs = []; this.connectionState = 'new'; this.remoteDescription = null; this.localDescription = null; sim.pcs = (sim.pcs || 0) + 1; }
    createDataChannel(label, opt){ const d = new DC(this, label, opt); this.dcs.push(d); return d; }
    async createOffer(){ return { type: 'offer', sdp: 'o:' + this.id }; }
    async createAnswer(){ return { type: 'answer', sdp: 'a:' + this.id + ':' + this.remoteDescription.sdp }; }
    async setLocalDescription(d){ this.localDescription = { type: d.type, sdp: d.sdp, toJSON(){ return { type: d.type, sdp: d.sdp }; } }; sim.at(sim.t + 10, () => { if (this.onicecandidate && this.connectionState !== 'closed') this.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'c' + this.id }) } }); }); }
    async setRemoteDescription(d){
      this.remoteDescription = d;
      if (d.type !== 'answer') return;
      const other = pcs.get(+String(d.sdp).split(':')[1]); if (!other) return;
      sim.at(sim.t + 150, () => {   // соединились: у ответившего — те же каналы
        if (this.connectionState === 'closed' || other.connectionState === 'closed') return;
        for (const a of this.dcs) { const b = new DC(other, a.label, a.unrel ? { maxRetransmits: 0 } : {}); a.peer = b; b.peer = a; other.dcs.push(b); other.ondatachannel && other.ondatachannel({ channel: b }); }
        this.connectionState = other.connectionState = 'connected';
        for (const a of this.dcs) { a.readyState = 'open'; a.peer.readyState = 'open'; a.onopen && a.onopen(); a.peer.onopen && a.peer.onopen(); }
      });
    }
    addIceCandidate(){ return Promise.resolve(); }
    close(){ this.connectionState = 'closed'; for (const d of this.dcs) d.close(); }
  };
  return () => { delete globalThis.RTCPeerConnection; };
}
async function scenario7(){
  const sim = mkWorld({ seed: 61, warm: 1e9 });
  const restore = installFakeRTC(sim), cnt = { sent: 0, recv: 0, sig: 0 }, client = fakeSupabase(sim, cnt);
  const peers = [];
  const mk = (id, k, world) => {
    const P = { id, k, offs: [], off: 1000 + sim.rnd() * 1e6, scene: fakeScene(), readyAt: 0, pending: [], cheats: [], lastTp: undefined };
    P.now = () => sim.t + P.off;
    if (world) buildWorld(P.scene);
    const tr = E.net.room('s3rtc', 'xyz789', { client, NetPlay: globalThis.NetPlay, key: id, joinedAt: 1e6 + sim.t, now: P.now, nick: 'Игрок ' + k });
    P.tr = tr;
    P.S = E.net.session({ transport: tr, scene: P.scene, now: P.now, nick: 'Игрок ' + k,
      onHost: is => { P.script = is ? mkScript(sim, P) : null; }, onReady: () => { if (!P.readyAt) P.readyAt = sim.t; }, onCheat: (w, i) => P.cheats.push([w, i.why]),
      onTeleport: p => { const c = truthAt(P.k, sim.t); P.offs.push([sim.t, p[0] - c.x, p[1] - c.y, p[2] - c.z, cycleOf(P.k, sim.t)]); } });
    P.id = tr.myId;
    const step = () => { const c = charOf(P, sim.t); if (P.lastTp !== undefined && c.tp !== P.lastTp) P.S.teleported(); P.lastTp = c.tp; P.S.setMyCharacter(c); if (P.S.isHost && P.script) P.script(sim.t); P.S.tick(1 / 60); sim.at(sim.t + 1000 / 60, step); };
    sim.at(sim.t + 5, step);
    peers.push(P); sim.peers.set(P.id, P);
    return P;
  };
  const go = async until => { while (sim.t < until) { sim.run(Math.min(until, sim.t + 20)); await new Promise(r => setImmediate(r)); } };
  const H = mk('h', 0, true); await go(400);
  const A = mk('a', 1); await go(900);
  const B = mk('b', 2); await go(6000);
  const st = P => P.tr.stats().pairs.map(p => p.mode).join(',');
  R7.modes = { H: st(H), A: st(A), B: st(B) };
  ok(H.tr.mode(A.id) === 'p2p' && H.tr.mode(B.id) === 'p2p', 'WebRTC: хозяин соединился напрямую с обоими гостями', R7.modes);
  ok(A.tr.stats().pairs.length === 1 && B.tr.stats().pairs.length === 1, 'WebRTC: гости между собой не соединяются (только с хозяином)', R7.modes);
  const c0 = { ...cnt }, p0 = sim.p2pMsgs || 0;
  await go(36000);
  const c1 = { ...cnt }, p1 = sim.p2pMsgs || 0;
  R7.supaPerMin = (c1.sent - c0.sent) * 2; R7.p2pPerSec = (p1 - p0) / 30; R7.sig = c1.sig; R7.pcs = sim.pcs;
  ok(R7.supaPerMin <= 6, 'WebRTC: после соединения Supabase почти не тратится (≤ 6 broadcast/мин)', R7.supaPerMin);
  sim.frozen = true; await go(42000);
  const ca = compareScenes(H.scene, A.scene), cb = compareScenes(H.scene, B.scene);
  ok(ca.ok && cb.ok, 'WebRTC: копии сошлись', [ca, cb]);
  ok(H.cheats.length === 0 && A.readyAt && B.readyAt, 'WebRTC: мир готов, без ложных «читеров»', [A.readyAt, B.readyAt, H.cheats.slice(0, 2)]);
  const rB = B.S.remotes().find(r => r.id === A.id);
  ok(rB && Math.hypot(rB.pose.x - charOf(A, rB.rt - A.off).x, rB.pose.z - charOf(A, rB.rt - A.off).z) < .5, 'WebRTC: гость видит другого гостя (через хозяина) там, где тот был', rB && [rB.pose.x, rB.pose.z]);
  for (const P of peers) P.tr.close();
  await go(43000);
  restore();
}

// ═══ Сводка ═══
function charSummary(cm, filter){
  const rows = [];
  for (const [k, M] of cm) {
    if (filter && !filter(k)) continue;
    if (!M.frames) continue;
    rows.push({ k, mean: mean(M.err), p95: pct(M.err, .95), max: Math.max(0, ...M.err), snaps: M.snaps, fixes: M.fixes, frames: M.frames, maxEx: M.maxEx, ex: M.ex / M.frames, delay: mean(M.delay), buf: mean(M.buf), win: M.win.length ? Math.max(...M.win) : 0 });
  }
  return rows;
}
function printChars(title, rows){
  console.log(`\n${title}`);
  console.log('  кто>кого   ошибка ср/95%/макс (ед.)   рывков/поправок/кадров   макс за кадр   угадывание   видно с опозданием / запас, мс');
  for (const r of rows) console.log(`  ${r.k.padEnd(9)} ${f2(r.mean)} / ${f2(r.p95)} / ${f2(r.max)}`.padEnd(42) + `${r.snaps}/${r.fixes}/${r.frames}`.padEnd(25) + `${f2(r.maxEx)}`.padEnd(15) + `${f1(r.ex * 100)}%`.padEnd(13) + `${Math.round(r.delay)} / ${Math.round(r.buf)}${r.win ? `   (смена хозяина: макс ${f2(r.win)})` : ''}`);
}
function printLinks(title, list, budget){
  console.log(`\n${title}`);
  for (const l of list.sort((a, b) => a.k < b.k ? -1 : 1)) console.log(`  ${l.k.padEnd(6)} ${f1(l.ps)} пак/с (пик ${l.peak}/с, бюджет ${budget(l.k)})  ${f1(l.Bs / 1024)} КБ/с  потеряно моделью ${l.lost}/${l.n}`);
}
const relayOf = k => k.includes('B');
const r1 = charSummary(R1.cm);
printChars('1) Чужие персонажи, напрямую RTT 150±30 мс, 3% потерь (B — через Supabase 5/с):', r1);
for (const r of r1) {
  const relay = relayOf(r.k);
  ok(r.snaps <= (relay ? 3 : 0), `плавность ${r.k}: рывков (> 0,3 ед. за кадр сверх настоящей скорости) ${relay ? '≤ 3' : 'нет'}`, `${r.snaps}/${r.frames}`);
  ok(r.fixes / r.frames <= (relay ? .03 : .01), `плавность ${r.k}: мягких поправок ≤ ${relay ? 3 : 1}% кадров`, `${r.fixes}/${r.frames}`);
  ok(r.maxEx < (relay ? 1.2 : .45), `плавность ${r.k}: самый большой сдвиг за кадр сверх скорости < ${relay ? 1.2 : .45}`, f2(r.maxEx));
  ok(r.p95 < (relay ? 1.0 : .35), `точность ${r.k}: 95% ошибок < ${relay ? 1 : .35}`, f2(r.p95));
}
printLinks('   Каналы (10–145 с):', R1.links, k => relayOf(k) ? 5 : 15);
for (const l of R1.links) { const b = relayOf(l.k) ? 5 : 15; ok(l.ps <= b && l.peak <= b, `бюджет ${l.k}: ≤ ${b} пак/с`, `${f1(l.ps)} пик ${l.peak}`); }
ok(R1.limiter2 === 0, 'ограничитель NetPlay (190 мс) ни разу не сработал', R1.limiter2);
const latNear = R1.lat.filter(x => x[0] && x[2] === 'color').map(x => x[1]), latFar = R1.lat.filter(x => !x[0] && x[2] === 'color').map(x => x[1]), latSp = R1.lat.filter(x => x[2] === 'spawn').map(x => x[1]), latGone = R1.lat.filter(x => x[2] === 'gone').map(x => x[1]);
console.log(`   Изменения до гостя: цвет рядом ${Math.round(pct(latNear, .5))}/${Math.round(pct(latNear, .95))} мс (медиана/95%, ${latNear.length} шт.), далеко ${Math.round(pct(latFar, .5))}/${Math.round(pct(latFar, .95))} мс (${latFar.length}), появление ${Math.round(pct(latSp, .5))}/${Math.round(pct(latSp, .95))}, удаление ${Math.round(pct(latGone, .5))}/${Math.round(pct(latGone, .95))}`);
ok(pct(latNear, .95) < 1500 && pct(latFar, .95) < 4000, 'изменения доходят: рядом 95% < 1,5 с, далеко < 4 с', [pct(latNear, .95), pct(latFar, .95)]);
console.log(`   Обновления движущихся платформ у C (с 60-й по 215-ю с, 10 с из них — заморозка): рядом ${f1(R1.rate.near)}/с, далеко (~80 ед.) ${f1(R1.rate.far)}/с`);
console.log(`   Новичок C: мир готов через ${R1.join.ready} мс, все объекты (${R1.join.objs}) — через ${R1.join.full} мс; сводок ${R1.repair.digests}, несовпавших корзин ${R1.repair.bad}, перепослано ${R1.repair.resyncs}`);
console.log(`   Часы хозяина у гостей A/B/C: ошибка ${R1.clock.map(e => Math.round(e)).join(' / ')} мс; пакетов-двойников в модели ${R1.dups} (отброшены)`);
console.log(`   Хозяин H ушёл: A стал хозяином через ${R1.migr.a} мс, B принял через ${R1.migr.b} мс, C — через ${R1.migr.c} мс`);
const r2 = charSummary(R2.cm);
printChars('2) Только через Supabase (RTT 200±40 мс, 1% потерь, 5 пакетов/с):', r2);
for (const r of r2) { ok(r.snaps <= 3 && r.fixes / r.frames <= .03, `через Supabase ${r.k}: рывков ≤ 3, поправок ≤ 3%`, `${r.snaps}/${r.fixes}/${r.frames}`); ok(r.p95 < 1, `через Supabase ${r.k}: 95% ошибок < 1`, f2(r.p95)); }
printLinks('   Каналы (10–80 с):', R2.links, () => 5);
for (const l of R2.links) ok(l.ps <= 5 && l.peak <= 5, `через Supabase ${l.k}: ≤ 5 пак/с`, `${f1(l.ps)} пик ${l.peak}`);
ok(R2.limiter === 0, 'через Supabase: ограничитель NetPlay не сработал', R2.limiter);
console.log(`   Мир у гостя через ${R2.ready} мс`);
const r3 = charSummary(R3.cm);
printChars('3) Хозяин завис на 40-й с:', r3);
console.log(`   A перехватил через ${R3.a} мс, B переключился через ${R3.b} мс`);
console.log(`\n4) Читеры: замечаний ${R4.cheats}, «вернись» ${R4.fix}; бег ×3 у других — ${f2(R4.speed)} ед./с, часы ×2 и бег ×1,8 — ${f2(R4.clock)} ед./с (честный бег ${f2(RUN)}, допуск ×1,25 = ${f2(RUN * 1.25)}); прыжок на 50 ед. — у других сдвиг ${f2(R4.blink)}`);

console.log(`\n6) Большой мир (3150 объектов, 150 движутся): новичку — за ${R6.ready} мс (${f1(R6.joinKB)} КБ за всё время); процессор на сеть: хозяин ${f1(R6.cpuH)} мс/с, гость ${f1(R6.cpuG)} мс/с (node)`);
for (const l of R6.links) console.log(`   ${l.k.padEnd(6)} ${f1(l.ps)} пак/с, ${f1(l.Bs / 1024)} КБ/с`);
console.log(`\n5) Транспорт через модель Supabase (3 игрока, всё «через комнату»): ${R5.sentPerMin} broadcast/мин, ${R5.perMin} получений/мин (так считает лимит Supabase), ${f1(R5.kbps)} КБ/с; знакомство WebRTC — ${R5.sig} сигналов`);
console.log(`   Лимит 2 млн/мес: ≈ ${Math.round(2e6 / R5.perMin / 60)} ч такой игры втроём в месяц, если WebRTC не соединится ни у кого (напрямую Supabase не тратится)`);

// сценарий 7 — асинхронный (NetPlay ждёт обещаний): итог после него
scenario7().then(() => {
  console.log(`\n7) WebRTC (модель): режимы пар хозяин ${R7.modes.H}, гость A ${R7.modes.A}, гость B ${R7.modes.B}; соединений ${R7.pcs}, сигналов знакомства ${R7.sig}; потом через Supabase — ${R7.supaPerMin} broadcast/мин, напрямую — ${f1(R7.p2pPerSec)} пакетов/с на всех`);
  console.log(`\n${pass} ок, ${fail} ошибок`);
  process.exitCode = fail ? 1 : 0;
}, e => { console.log('FAIL сценарий 7:', e && e.stack || e); process.exitCode = 1; });
