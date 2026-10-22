// «Кубомир» — две руки и бой без браузера: node scripts/kubomir-combat-test.cjs [путь к three@0.149]
// Что в руках (хват: двуручный лук, щит из панели — в левой, лук в левой — за спиной), F — поменять руки; ПКМ: правая главнее
// (блок ставится и со щитом в левой), нечего правой — левая (щит — блок, факел — поставить, еда — съесть); удар ядром боя
// (D37E.combat): дуга по мобам, перезарядка (часто — слабо), серия, отброс, не сквозь стену; моб бьёт: щит — блок (износ),
// вовремя — отбив (моб оглушён, не бьёт), без щита — урон; лук: натянуть, отпустить — стрела летит, попадает, втыкается,
// подбирается; одинаково при 30 / 60 / 144 кадрах (цикл движка E.loop).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let THREE;
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { THREE = require(fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p); break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/kubomir-combat-test.cjs <путь>/node_modules/three'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

globalThis.window = globalThis; globalThis.self = globalThis; globalThis.THREE = THREE;
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const run = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/gfx.js', 'js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-render.js',
  'js/engine/physics.js', 'js/engine/controls.js', 'js/engine/player.js', 'js/engine/combat.js', 'js/games/kubomir-ents.js', 'js/games/kubomir-weather.js', 'js/games/kubomir.js']) run(f);
const E = window.D37E, V = E.vox, ID = V.ID, CB = E.combat, KB = window.GAME_IMPL.kubomir._test, T = THREE, MOBS = window.KubomirEnts.MOBS;
KB.opts({});
const DT = 1 / 60;

// ── мир-коробка: ниже y 10 — камень, выше — воздух; правки — Map (как в kubomir-hand-test) ──
function boxWorld(){
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  return { seed: 11, listeners: [], cells,
    raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 10 ? ID.stone : 0) : v; },
    get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & 0xfff; },
    set(x, y, z, v, o = {}){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); const was = this.raw(x, y, z); if (was === v) return false; cells.set(key(x, y, z), v); if (!o.silent) for (const f of this.listeners) f(x, y, z, was, v, o); return true; },
    lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 10, chunk: () => null, chunkAt: () => null, tile: () => null, dropTile: () => null };
}
const R0 = { T, r: { capabilities: { isWebGL2: true }, properties: { get: () => ({}) } }, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 16 / 9, .2, 500), q: 'high', night: 1, shadowDirty(){}, lighting: { time: 22 } };
const VR = V.renderer(R0);
// игрок у (x, z) на камне (y 10), смотрит вдоль −z (yaw 0); мобы и стрелы — настоящие (KubomirEnts)
function mk(o = {}){
  const W = boxWorld();
  const P = { x: 20.5, y: 10, z: 20.5, vx: 0, vy: 0, vz: 0, w: .6, h: 1.8, onGround: true, fly: false, sneak: false, sprint: false, water: 0, lava: 0, climb: false, eyeWater: false,
    fallTop: 10, hp: 20, food: 20, sat: 5, exh: 0, air: 15, inv: new Array(36).fill(null), off: null, sel: 0, cursor: null, dead: false, hurtT: 0 };
  const rig = { yaw: 0, fp: 0, tx: 0, tz: 0, motion: 1, mode: 'first', fwd(){ return { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) }; }, right(){ return { x: Math.cos(rig.yaw), z: -Math.sin(rig.yaw) }; }, kick(){}, land(){}, shake(){} };
  const sounds = [];
  const st = { R: R0, VR, W, P, rig, ox: 0, oz: 0, meta: { diff: o.diff || 'normal' }, ST: { rd: 6 }, creative: !!o.creative, C: E.controls({ listen: false }), K: null,
    I: { touch: false, locked: true }, F: CB.fighter({ invT: .5, poise: 3, poiseRegen: 1, stagT: .45 }), hands: { mainS: null, offS: null, mainW: null, offW: null, two: false, offStow: false, mainOff: false },
    H: { toast(){} }, AU: { play: n => sounds.push(n), step(){}, loop: () => ({ set(){}, stop(){} }) }, stats: {}, mine: { key: '', t: 0, need: 0, st: -1, cool: 0 }, placeCool: 0, eat: null, hit: null, guardIn: false, atkDir: null, sounds, steps: 0 };
  const X = window.KubomirEnts.create(st); st.ents = X; X.spawnT = 1e9;
  W.listeners.push((x, y, z, was, v) => X.onBlockChanged(x, y, z, was, v));
  X.hookHurt = (n, m) => KB.mobHit(st, n, m); X.give = s => { for (let i = 0; i < 36; i++) { const q = P.inv[i]; if (q && q.id === s.id && q.n + s.n <= 64) { q.n += s.n; return 0; } } for (let i = 0; i < 36; i++) if (!P.inv[i]) { P.inv[i] = { id: s.id, n: s.n }; return 0; } return s.n; };
  X.room = () => true;
  return { st, W, P, X };
}
// смотреть на точку (как KB.aim, но на своём st)
const aimAt = (st, x, y, z) => { const ex = st.P.x, ey = st.P.y + 1.62, ez = st.P.z, dx = x - ex, dy = y - ey, dz = z - ez; st.rig.yaw = Math.atan2(-dx, -dz); st.rig.fp = Math.atan2(-dy, Math.hypot(dx, dz)); };
// шаг игры: бой (1/60) и мобы (каждый 3-й шаг, 1/20)
const steps = (S, n, f) => { for (let i = 0; i < n; i++) { f?.(i); KB.combatStep(S.st, DT); if (S.st.steps % 3 === 0) S.X.tick(1 / 20); S.st.steps++; } };

(async () => {
  // ═══ 1. Две руки: хват и «поменять руки» ═══
  sec('две руки: хват вещей, F — поменять руки');
  {
    const S = mk(), { st, P } = S;
    P.inv[0] = { id: 'sword_iron', n: 1 }; P.off = { id: 'shield', n: 1 };
    let H = KB.hands(st);
    ok(H.mainW.kind === 'sword' && H.offW.kind === 'shield' && !H.two && !H.offStow && H.mainW.dmg === 6, 'меч в правой (урон 6 у железного), щит в левой', { m: H.mainW.kind, o: H.offW.kind, dmg: H.mainW.dmg });
    ok(KB.weaponOf('axe_iron').dmg === 7 && KB.weaponOf('axe_iron').guardBreak > 0 && KB.weaponOf('torch').kind === 'torch' && KB.weaponOf('apple').kind === 'food' && KB.weaponOf('planks_oak').kind === 'block', 'топор тяжелее (7) и выбивает щит; факел, еда, блок — свои позы');
    KB.swap(st);
    H = KB.hands(st);
    ok(P.inv[0].id === 'shield' && P.off.id === 'sword_iron' && H.mainOff && H.offW.kind === 'shield' && !H.mainW && H.offStow, 'F: щит в панели — держит левой, правая свободна, меч из левой убран', H);
    KB.swap(st); P.inv[1] = { id: 'bow', n: 1 }; P.sel = 1;
    H = KB.hands(st);
    ok(H.two && H.mainW.kind === 'bow' && !H.offW && H.offStow, 'лук — двумя руками: щит убран', H);
    P.sel = 0; P.off = { id: 'bow', n: 1 }; H = KB.hands(st);
    ok(H.offStow && !H.offW && H.mainW.kind === 'sword', 'лук в левой ячейке — за спиной (не работает)', H);
    S.X.dispose();
  }

  // ═══ 2. ПКМ: правая главнее, нечего — левая ═══
  sec('ПКМ: правая главнее (блок ставится и со щитом), нечего — левая (щит, факел, еда)');
  {
    const S = mk(), { st, P, W } = S;
    P.inv[0] = { id: 'planks_oak', n: 5 }; P.off = { id: 'shield', n: 1 };
    aimAt(st, 20.5, 9.9, 18.5);
    const hit = V.raycast(W, P.x, P.y + 1.62, P.z, 0, -1.62 - .1, -2, 5);
    ok(hit && hit.y === 9, 'прицел — пол перед собой', hit);
    ok(!KB.offHands(st, hit, true) && !st.guardIn, 'доски в правой — ПКМ не поднимает щит');
    ok(KB.useAt(st, hit) && W.get(hit.x, hit.y + 1, hit.z) === ID.planks_oak && P.inv[0].n === 4, 'доска поставлена (щит в левой не мешает строить)');
    P.inv[0] = { id: 'sword_iron', n: 1 };
    ok(KB.offHands(st, hit, true) && st.guardIn, 'меч в правой — ПКМ держит щит');
    steps(S, 20, () => KB.offHands(st, hit, true));
    ok(near(st.F.guard, 1) && st.F.pw === 0, 'щит поднят (0,12 с), окно отбива прошло', { g: st.F.guard, pw: st.F.pw });
    steps(S, 20, () => KB.offHands(st, hit, false));
    ok(st.F.guard === 0, 'отпустил — опустил');
    // кирка в правой, факелы в левой — ПКМ ставит факел (как в Майнкрафте: шахтёр с факелами в левой)
    P.inv[0] = { id: 'pick_iron', n: 1 }; P.off = { id: 'torch', n: 3 };
    const h2 = V.raycast(W, P.x, P.y + 1.62, P.z, 1, -1.62 - .1, -1.5, 5);
    ok(KB.useAt(st, h2) && W.get(h2.x, h2.y + 1, h2.z) === ID.torch && P.off.n === 2 && P.inv[0].id === 'pick_iron', 'кирка в правой — факел из левой поставлен, кирка на месте', { b: V.blocks[W.get(h2.x, h2.y + 1, h2.z)]?.name, off: P.off });
    // еда в левой — съесть (голоден), рука — левая
    P.inv[0] = { id: 'sword_iron', n: 1 }; P.off = { id: 'apple', n: 2 }; P.food = 10;
    ok(KB.useAt(st, null) && st.eat && st.eat.hand === 'off' && st.eat.slot === -1, 'меч в правой, яблоко в левой — ест левой');
    st.eat = null; P.food = 20;
    ok(!KB.useAt(st, null), 'сыт — ничего');
    S.X.dispose();
  }

  // ═══ 3. Удар: дуга по мобу, перезарядка, серия, отброс, стена ═══
  sec('удар: дуга по мобу, часто — слабо, вовремя — серия; отброс; сквозь стену — нет');
  {
    const S = mk({ creative: true }), { st, P, X } = S;   // в творчестве зомби не нападает (мешать не будет)
    P.inv[0] = { id: 'sword_iron', n: 1 };
    const z = X.spawn('zombie', 20.5, 10, 18.4, { quiet: true });
    ok(z && z.cf && z.poiseMax === 1 && z.kbRes > 0, 'у зомби — поля боя (стойкость, неуязвимость, отброс)', z && { cf: z.cf, poise: z.poiseMax });
    aimAt(st, z.x, z.y + 1.2, z.z);
    const hp0 = z.hp;
    KB.attack(st, z, null); steps(S, 4);
    ok(z.hp === hp0, 'замах — ещё не попал');
    steps(S, 10);
    ok(near(hp0 - z.hp, 6, 1e-6) && z.stag > 0 && z.wind === 0, 'удар мечом: полный урон 6, зомби оглушён (сильный удар)', { dmg: hp0 - z.hp, stag: z.stag });
    ok(z.vz < -2, 'отброс — от игрока', z.vz);
    // сразу ещё (спам): неуязвимость и слабый
    const hp1 = z.hp;
    KB.attack(st, z, null); steps(S, 14);
    ok(hp1 - z.hp < 2, 'бьёт часто — слабо (или в неуязвимость)', hp1 - z.hp);
    // вовремя: серия
    steps(S, 150);   // серия забыта (больше 0,9 с после удара)
    const ids = [];
    for (let k = 0; k < 3; k++) { z.hp = 20; aimAt(st, z.x, z.y + 1.2, z.z); KB.attack(st, z, null); ids.push(st.F.mv?.id); steps(S, 42); }
    ok(ids.join() === 'slash,back,thrust', 'вовремя (0,7 с) — серия: рубка, обратная, укол', ids);
    // стена между — мимо
    S.W.set(20, 11, 19, ID.stone, { silent: true }); S.W.set(20, 12, 19, ID.stone, { silent: true });
    z.x = 20.5; z.z = 18.2; z.vx = z.vz = 0; z.hp = 20; z.inv = 0;
    steps(S, 50); aimAt(st, z.x, z.y + 1.2, z.z);
    KB.attack(st, z, null); steps(S, 20);
    ok(z.hp === 20, 'за стеной — мимо (дуга не бьёт сквозь блоки)', z.hp);
    S.X.dispose();
  }

  // ═══ 4. Моб бьёт: щит — блок, вовремя — отбив, без щита — урон ═══
  sec('моб бьёт: щит поднят — блок (износ), поднял прямо перед ударом — отбив (моб оглушён), без щита — урон');
  {
    const fight = mode => {
      const S = mk(), { st, P, X } = S;
      P.inv[0] = { id: 'sword_iron', n: 1 }; P.off = mode === 'none' ? null : { id: 'shield', n: 1 };
      const z = X.spawn('zombie', 20.5, 10, 19.6, { quiet: true });
      aimAt(st, z.x, z.y + 1.4, z.z);
      let hits = 0, raised = -1, out = null;
      for (let i = 0; i < 300 && !out; i++) {
        // блок: держит щит всё время; отбив: поднимает за 3 шага до конца замаха моба
        let rmb = false;
        if (mode === 'block') rmb = true;
        if (mode === 'parry' && z.wind > 0 && z.wind <= .05 && raised < 0) raised = i;
        if (mode === 'parry' && raised >= 0) rmb = true;
        KB.offHands(st, null, rmb);
        KB.combatStep(st, DT);
        if (st.steps % 3 === 0) { const hp = P.hp; X.tick(1 / 20); if (P.hp < hp) hits++; if (st.stats.parries || (mode === 'block' && st.sounds.includes('kb_block')) || hits) out = { hp: P.hp, z }; }
        st.steps++;
      }
      return { S, out, hits, P, z };
    };
    const B = fight('block');
    ok(B.out && B.P.hp === 20 && B.P.off.d > 0 && B.S.st.sounds.includes('kb_block'), 'щит поднят — блок: урона нет, щит изнашивается', { hp: B.P.hp, d: B.P.off?.d });
    B.S.X.dispose();
    const Pp = fight('parry');
    ok(Pp.out && Pp.P.hp === 20 && Pp.S.st.stats.parries === 1 && Pp.z.stag >= .9 && Pp.S.st.sounds.includes('kb_parry'), 'поднял вовремя — отбив: урона нет, зомби оглушён на 1 с', { hp: Pp.P.hp, stag: Pp.z.stag, parries: Pp.S.st.stats.parries });
    // оглушённый не бьёт: секунду — ни одного удара, даже без щита
    { const { S, P, z } = Pp; P.off = null; let n = 0; const hp = P.hp; for (let i = 0; i < 18; i++) { KB.offHands(S.st, null, false); KB.combatStep(S.st, DT); if (S.st.steps % 3 === 0) S.X.tick(1 / 20); S.st.steps++; } n = hp - P.hp;
      ok(n === 0 && z.stag > 0, 'оглушённый зомби не бьёт', { n, stag: z.stag }); }
    Pp.S.X.dispose();
    const N = fight('none');
    ok(N.hits === 1 && N.P.hp === 17, 'без щита — урон 3 («обычно»)', { hp: N.P.hp });
    N.S.X.dispose();
  }

  // ═══ 5. Лук и стрелы ═══
  sec('лук: натянуть (ПКМ), отпустить — стрела; попала в зомби, в стену — торчит и подбирается');
  {
    const S = mk({ creative: false }), { st, P, X, W } = S;
    P.inv[0] = { id: 'bow', n: 1 }; P.inv[8] = { id: 'arrow', n: 5 }; P.off = { id: 'shield', n: 1 };
    const z = X.spawn('zombie', 20.5, 10, 12.5, { quiet: true }); z.speed = 0;
    aimAt(st, z.x, z.y + 1.1, z.z);
    for (let i = 0; i < 66; i++) { KB.offHands(st, null, true); KB.combatStep(st, DT); }
    ok(st.F.drawOn && CB.drawK(st.F) >= 1, 'натянул за 1 с');
    KB.offHands(st, null, false);
    ok(X.arrows.length === 1 && P.inv[8].n === 4 && P.inv[0].d === 1, 'отпустил — стрела вылетела, одна потрачена, лук изнашивается', { a: X.arrows.length, n: P.inv[8].n });
    const hp0 = z.hp;
    for (let i = 0; i < 40 && X.arrows.length; i++) X.tick(1 / 20);
    ok(hp0 - z.hp === 6 && !X.arrows.length, 'стрела попала в зомби: урон 6 (полная натяжка), исчезла', { dmg: hp0 - z.hp });
    // в стену: торчит, подбирается
    z.x = 40; z.z = 40;
    for (let y = 10; y < 16; y++) for (let x = 15; x < 26; x++) W.set(x, y, 16, ID.stone, { silent: true });
    aimAt(st, 20.5, 11.5, 16);
    for (let i = 0; i < 40; i++) { KB.offHands(st, null, true); KB.combatStep(st, DT); }
    KB.offHands(st, null, false);
    for (let i = 0; i < 30; i++) X.tick(1 / 20);
    const a = X.arrows[0];
    ok(a && a.stuck && Math.abs(a.z - 16.9) < .4, 'стрела в стене — торчит', a && { z: a.z, stuck: a.stuck });
    P.x = a.x; P.z = a.z + .5; const n0 = P.inv[8].n;
    for (let i = 0; i < 20; i++) X.tick(1 / 20);
    ok(!X.arrows.length && P.inv[8].n === n0 + 1, 'подошёл — подобрал', { n: P.inv[8].n, n0 });
    // без стрел — не тянет
    P.inv[8] = null; for (let i = 0; i < 30; i++) { KB.offHands(st, null, true); KB.combatStep(st, DT); }
    ok(!st.F.drawOn, 'стрел нет — лук не натягивается');
    S.X.dispose();
  }

  // ═══ 6. Одинаково при 30 / 60 / 144 кадрах ═══
  sec('бой одинаковый при 30, 60 и 144 кадрах (настоящий цикл E.loop, ввод — по шагам игры)');
  {
    const loopRun = (frameMs, sec2, update) => {
      let now = 0; const q = [];
      const raf0 = globalThis.requestAnimationFrame, perf0 = globalThis.performance, doc0 = globalThis.document;
      globalThis.requestAnimationFrame = cb => { q.push(cb); return q.length; }; globalThis.cancelAnimationFrame = () => {};
      globalThis.performance = { now: () => now }; globalThis.document = { hidden: false };
      try { const L = E.loop(update, () => {}); while (now < sec2 * 1000) { now += frameMs; for (const cb of q.splice(0)) cb(now); } L.stop(); }
      finally { globalThis.requestAnimationFrame = raf0; globalThis.performance = perf0; globalThis.document = doc0; }
    };
    const duel = frameMs => {
      const S = mk(), { st, P, X } = S;
      P.inv[0] = { id: 'sword_iron', n: 1 }; P.off = { id: 'shield', n: 1 };
      const z = X.spawn('zombie', 20.5, 10, 16.5, { quiet: true }), z2 = X.spawn('slime', 21.5, 10, 17, { quiet: true });
      let t = 0, n = 0;
      const log = [];
      loopRun(frameMs, 9.2, dt => {
        if (n >= 540) return;   // сравниваем на одном и том же шаге (9 с игры)
        aimAt(st, z.x, z.y + 1.2, z.z);
        const atk = n > 30 && n % 44 === 0, rmb = (n % 150) > 100;
        KB.offHands(st, null, rmb);
        if (atk) KB.attack(st, null, null);
        KB.combatStep(st, dt);
        if (n % 3 === 0) X.tick(1 / 20);
        st.steps++; n++; t += dt;
        if (n % 60 === 0) log.push([+z.hp.toFixed(6), +z2.hp.toFixed(6), P.hp, +z.x.toFixed(6), +z.z.toFixed(6)]);
      });
      const out = { n, php: P.hp, zhp: z.hp, z2hp: z2.hp, zx: z.x, zz: z.z, parries: st.stats.parries | 0, log: JSON.stringify(log) };
      X.dispose();
      return out;
    };
    const A = duel(1000 / 60), B = duel(1000 / 144), C3 = duel(1000 / 30);
    if (A.log !== B.log || A.log !== C3.log) { const la = JSON.parse(A.log), lb = JSON.parse(B.log), lc = JSON.parse(C3.log); for (let i = 0; i < Math.max(la.length, lb.length, lc.length); i++) if (JSON.stringify(la[i]) !== JSON.stringify(lb[i]) || JSON.stringify(la[i]) !== JSON.stringify(lc[i])) { console.log('  расхождение', i, JSON.stringify(la[i]), JSON.stringify(lb[i]), JSON.stringify(lc[i])); break; } }
    ok(A.n === B.n && A.n === C3.n && A.log === B.log && A.log === C3.log && near(A.zx, B.zx) && near(A.zz, C3.zz), 'бой с зомби и слизнем (удары, щит, их удары): 60, 144 и 30 кадров — одинаково', { n: [A.n, B.n, C3.n] });
    ok(A.zhp < 20 && A.z2hp <= 8, '…и бой честный: мобам досталось', { zhp: A.zhp, z2hp: A.z2hp, php: A.php, parries: A.parries });
  }

  console.log(`\nkubomir-combat-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
