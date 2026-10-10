// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — сеть для миров игроков: хозяин (кто раньше в комнате) считает мир и скрипты, гости рисуют копию
//  и сами ведут своего персонажа. Ушёл хозяин — хозяином становится следующий по времени входа и продолжает с копии.
// ═══════════════════════════════════════
// Транспорт — любой (net-transport.js: Supabase + WebRTC; в тестах — модель сети): ненадёжные пакеты байтами, каждому
// по отдельности. Всё остальное — здесь: номера пакетов и подтверждения (32 последних битами), повтор потерянного,
// часы хозяина (RTT, сдвиг), надёжные события по порядку, репликация объектов сцены, персонажи, смена хозяина.
//
// S = D37E.net.session({ transport, scene, now, nick, info, extra, replicate, interest, hostTimeout, onHost(isHost, info),
//   onPlayer('join' | 'leave' | 'data', p), onEvent(type, data, from), onGuestEvent (у хозяина — события гостей), onCharacter(id,
//   pose), onBlob(name, bytes, text), onReady, onTeleport([x, y, z], 'tp' | 'fix' | 'script'), onCheat(id, info), validate, validTeleport })
//   S.tick(dt) — каждый шаг игры: приём, отправка, плавные позиции; S.setMyCharacter(state) — свой персонаж (поза player.js
//   + vx, vy, vz, on: id детали под ногами); S.teleported() — прыгнул сам (возрождение); S.remotes() — чужие для рисования;
//   S.sendEvent(type, data, to) — надёжно: гость → хозяину ('host') или всем ('all' — хозяин разошлёт), хозяин → id | 'all';
//   S.teleport(id, [x, y, z]) / S.setLimits(id, { walk, jump }) — хозяин двигает/настраивает чужого; S.setPlayerData(id, d);
//   S.setBlob(name, bytes | text) — большие данные всем (ландшафт, скрипты для нового хозяина); S.latest(id) — последний
//   проверенный снимок (хозяину, для скриптов); S.players(); S.hostNow() — часы хозяина; S.markDirty(obj); S.stats(); S.close().
// Сцена — как D37E.scene: all(), get(id), add(cls, props, parent, id), set(obj, k, v, silent), remove(obj), reparent(obj, p).
// Хозяин находит изменения сам: set/add/remove/reparent этой сцены обёрнуты (на время сессии) — каждый шаг проверяются
// только тронутые объекты; полный обход — раз в секунду (свойства, записанные мимо set). Гость сцену сам не меняет.
// Пакет: заголовок 18 байт (seq, ack + 32 бита, время, эхо времени) + разделы: персонажи, объекты (id, маска, поля),
// удаления, надёжные сообщения, сводка (хеши корзин). Позиции — см (varint), углы — 0,1°, цвет — 3 байта.
// Интерес: близкие объекты — в каждом пакете, дальние — реже (до 2 с), по накопленному приоритету, в пределах бюджета
// пакета; персонажи — 15 раз/с напрямую, 5 — через Supabase; чужие рисуются с запасом 80–150 мс сверх самого быстрого пути.
// Тест: node scripts/net-test.cjs (модель сети: задержка, потери, перестановка, двойники; смена хозяина; читеры; WebRTC).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const te = new TextEncoder(), td = new TextDecoder();
  const VER = 0xD1;

  // ═══ Байты ═══
  class W {
    constructor(n = 1500){ this.b = new Uint8Array(n); this.n = 0; }
    room(k){ if (this.n + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k + 256)); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
    u8(v){ this.room(1); this.b[this.n++] = v & 255; }
    u16(v){ this.room(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255; }
    u32(v){ this.room(4); v >>>= 0; this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255; this.b[this.n++] = (v >>> 16) & 255; this.b[this.n++] = (v >>> 24) & 255; }
    vu(v){ this.room(8); v = v > 0 ? Math.floor(v) : 0; while (v >= 128) { this.b[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); } this.b[this.n++] = v; }
    vs(v){ v = Math.round(v); this.vu(v < 0 ? -2 * v - 1 : 2 * v); }
    bytes(u){ this.room(u.length); this.b.set(u, this.n); this.n += u.length; }
    str(s){ const u = te.encode(String(s)); this.vu(u.length); this.bytes(u); }
    out(){ return this.b.slice(0, this.n); }
  }
  class R {
    constructor(u){ this.b = u; this.n = 0; }
    left(){ return this.b.length - this.n; }
    need(k){ if (this.n + k > this.b.length) throw new Error('short'); }
    u8(){ this.need(1); return this.b[this.n++]; }
    u16(){ this.need(2); const v = this.b[this.n] | (this.b[this.n + 1] << 8); this.n += 2; return v; }
    u32(){ this.need(4); const b = this.b, n = this.n; this.n += 4; return (b[n] | (b[n + 1] << 8) | (b[n + 2] << 16) | (b[n + 3] << 24)) >>> 0; }
    vu(){ let v = 0, m = 1; for (let i = 0; i < 8; i++) { const c = this.u8(); v += (c & 127) * m; if (c < 128) return v; m *= 128; } throw new Error('varint'); }
    vs(){ const v = this.vu(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    bytes(k){ this.need(k); const u = this.b.subarray(this.n, this.n + k); this.n += k; return u; }
    str(max = 4000){ const k = this.vu(); if (k > max) throw new Error('str'); return td.decode(this.bytes(k)); }
  }
  // номера пакетов по кругу 16 бит: a новее b
  const newer = (a, b) => { const d = (a - b) & 0xFFFF; return d > 0 && d < 0x8000; };
  const fnv = (h, u) => { for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
  const hashStr = s => fnv(2166136261, te.encode(s));

  // ═══ Свойства объектов: квантование и коды ═══
  const CLS = ['Part', 'Spawn', 'Light', 'Prefab', 'Model', 'Mesh', 'Script', 'Folder'];
  const MATS = ['plastic', 'smooth', 'neon', 'glass', 'metal', 'diamond', 'wood', 'planks', 'brick', 'concrete', 'cobble', 'asphalt', 'grass', 'sand', 'rock', 'dirt', 'snow', 'ice', 'marble', 'fabric', 'tiles'];
  const SHAPES = ['block', 'ball', 'cyl', 'wedge'];
  // только булевы значения: строковое свойство с тем же именем (touch у детали студии: kill | coin | …) — не флаг, оно идёт в _extra
  const FLAGS = ['collide', 'anchored', 'shadow', 'enabled', 'click', 'touch'];
  // [ключ, вид]; номер в списке — бит маски. _flags — все да/нет одним полем, _extra — свои свойства (opts.extra) JSON
  const PROPS = [['pos', 'v3s'], ['rot', 'ang'], ['size', 'v3u'], ['color', 'col'], ['alpha', 'u8f'], ['mat', 'enum', MATS], ['shape', 'enum', SHAPES],
    ['_flags', 'flags'], ['name', 'str'], ['text', 'str'], ['kind', 'str'], ['scale', 'f100'], ['range', 'f100'], ['power', 'f100'],
    ['attrs', 'json'], ['parent', 'ref'], ['prompt', 'json'], ['_extra', 'json']];
  const NP = PROPS.length, B_POS = 1, B_ROT = 2, B_PARENT = 1 << 15, ALL = (1 << NP) - 1, SPAWN = 1 << 20;
  const PI2 = Math.PI * 2;
  const q100 = v => Math.round((+v || 0) * 100);
  const angQ = d => { let a = Math.round((+d || 0) * 10) % 3600; if (a < 0) a += 3600; return a; };
  const v3 = (a, f) => Array.isArray(a) && a.length >= 3 ? [f(a[0]), f(a[1]), f(a[2])] : null;
  const jsonOf = v => { if (v === undefined || v === null) return ''; try { const s = JSON.stringify(v); return s && s.length <= 4000 ? s : ''; } catch (e) { return ''; } };
  const eqQ = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

  // Квантованное значение свойства i у объекта (undefined — свойства нет). ctx: nidOf(sid), extra — список своих ключей
  function quant(i, o, ctx){
    const [k, kind] = PROPS[i];
    if (kind === 'flags') { let has = 0, val = 0; FLAGS.forEach((f, j) => { if (typeof o[f] === 'boolean') { has |= 1 << j; if (o[f]) val |= 1 << j; } }); return has ? has << 8 | val : undefined; }
    if (k === '_extra') { if (!ctx.extra.length) return undefined; const x = {}; let any = false; for (const e of ctx.extra) if (o[e] !== undefined) { x[e] = o[e]; any = true; } return any ? jsonOf(x) : undefined; }
    const v = o[k];
    if (k === 'parent') return v ? ctx.nidOf(v) : 0;
    if (v === undefined || v === null) return (kind === 'json' || kind === 'str') && k in o ? '' : undefined;   // убрали — пустая строка
    switch (kind) {
      case 'v3s': return v3(v, q100) || undefined;
      case 'ang': return v3(v, angQ) || undefined;
      case 'v3u': return v3(v, x => Math.max(0, q100(x))) || undefined;
      case 'col': { const m = /^#([0-9a-f]{6})$/i.exec(String(v)); return m ? parseInt(m[1], 16) : undefined; }
      case 'u8f': return Math.max(0, Math.min(255, Math.round((+v || 0) * 255)));
      case 'enum': { const j = PROPS[i][2].indexOf(v); return j >= 0 ? j : String(v).slice(0, 40); }
      case 'str': return String(v).slice(0, 400);
      case 'f100': return Math.max(0, q100(v));
      case 'json': return jsonOf(v);
    }
  }
  // Значение для сцены из квантованного
  function unq(i, q, ctx){
    const kind = PROPS[i][1];
    switch (kind) {
      case 'v3s': case 'v3u': return [q[0] / 100, q[1] / 100, q[2] / 100];
      case 'ang': return [q[0] / 10, q[1] / 10, q[2] / 10];
      case 'col': return '#' + (q >>> 0).toString(16).padStart(6, '0');
      case 'u8f': return Math.round(q / 255 * 1000) / 1000;
      case 'enum': return typeof q === 'number' ? PROPS[i][2][q] : q;
      case 'str': return q;
      case 'f100': return q / 100;
      case 'json': if (!q) return null; try { return JSON.parse(q); } catch (e) { return null; }
      case 'ref': return q ? ctx.sidOf(q) : null;
      case 'flags': return q;
    }
  }
  function writeQ(w, i, q){
    switch (PROPS[i][1]) {
      case 'v3s': w.vs(q[0]); w.vs(q[1]); w.vs(q[2]); break;
      case 'ang': w.u16(q[0]); w.u16(q[1]); w.u16(q[2]); break;
      case 'v3u': w.vu(q[0]); w.vu(q[1]); w.vu(q[2]); break;
      case 'col': w.u8(q & 255); w.u8((q >>> 8) & 255); w.u8((q >>> 16) & 255); break;
      case 'u8f': w.u8(q); break;
      case 'enum': if (typeof q === 'number') w.u8(q); else { w.u8(255); w.str(q); } break;
      case 'str': case 'json': w.str(q); break;
      case 'f100': case 'ref': w.vu(q); break;
      case 'flags': w.u16(q); break;
    }
  }
  function readQ(r, i){
    switch (PROPS[i][1]) {
      case 'v3s': return [r.vs(), r.vs(), r.vs()];
      case 'ang': return [r.u16() % 3600, r.u16() % 3600, r.u16() % 3600];
      case 'v3u': return [r.vu(), r.vu(), r.vu()];
      case 'col': return r.u8() | (r.u8() << 8) | (r.u8() << 16);
      case 'u8f': return r.u8();
      case 'enum': { const j = r.u8(); return j === 255 ? r.str(40) : j; }
      case 'str': return r.str(400);
      case 'json': return r.str(4000);
      case 'f100': case 'ref': return r.vu();
      case 'flags': return r.u16();
    }
  }
  // Хеш объекта для сводки: те же байты, что ушли бы в «появление»
  const hw = new W(256);
  function hashRep(rp){
    hw.n = 0; hw.vu(rp.nid); hw.str(rp.sid); hw.u8(rp.ci); if (rp.ci === 255) hw.str(rp.cls);
    for (let i = 0; i < NP; i++) if (rp.q[i] !== undefined) { hw.u8(i); writeQ(hw, i, rp.q[i]); }
    return fnv(2166136261, hw.b.subarray(0, hw.n));
  }
  const NB = 64;   // корзин в сводке
  const bucketOf = sid => hashStr(sid) & (NB - 1);

  // ═══ Персонаж: снимок ~22 байта ═══
  // slot, t (время хозяина, мс), флаги, tp (счётчик телепортов: сменился — не тянуть, а переставить), on (деталь под ногами:
  // тогда x, y, z — от её центра, и чужие видят нас на ней, а не рядом), x y z см, yaw, скорость см/с, поза для человечка
  const PK = ['', 'vault', 'mantle', 'climb', 'hang', 'pullup'];
  function writeChar(w, c){
    const ext = c.roll >= 0 || !!c.pk || c.seatY != null || !!c.hang || !!c.ladder;
    w.u8(c.slot); w.u32(Math.round(c.t));
    w.u8((c.moving ? 1 : 0) | (c.air ? 2 : 0) | (c.sit ? 4 : 0) | (c.hang ? 8 : 0) | (c.ladder ? 16 : 0) | (c.rollBack ? 32 : 0) | (c.on ? 64 : 0) | (ext ? 128 : 0));
    w.u8(c.tp & 255);
    if (c.on) w.vu(c.on);
    w.vs(c.x * 100); w.vs(c.y * 100); w.vs(c.z * 100);
    w.u16(Math.round((((c.yaw || 0) % PI2) + PI2) % PI2 / PI2 * 65536) & 0xFFFF);
    w.vs((c.vx || 0) * 100); w.vs((c.vy || 0) * 100); w.vs((c.vz || 0) * 100);
    w.u8(Math.min(255, Math.round((c.speed || 0) * 10))); w.u8(Math.round(Math.max(0, Math.min(1, c.crouch || 0)) * 255));
    if (ext) {
      w.u8(c.roll >= 0 ? Math.round(Math.min(1, c.roll) * 254) : 255); w.u8(Math.max(0, PK.indexOf(c.pk || ''))); w.u8(Math.round(Math.max(0, Math.min(1, c.pkK || 0)) * 255));
      w.u8(Math.round((((c.climbPh || 0) % PI2) + PI2) % PI2 / PI2 * 255) & 255); w.vs(c.seatY == null ? 0 : Math.round(c.seatY * 100) + (c.seatY >= 0 ? 1 : -1));
    }
  }
  function readChar(r){
    const c = { slot: r.u8(), t: r.u32() }, f = r.u8();
    c.tp = r.u8(); c.on = f & 64 ? r.vu() : 0;
    c.x = r.vs() / 100; c.y = r.vs() / 100; c.z = r.vs() / 100; c.yaw = r.u16() / 65536 * PI2;
    c.vx = r.vs() / 100; c.vy = r.vs() / 100; c.vz = r.vs() / 100; c.speed = r.u8() / 10; c.crouch = r.u8() / 255;
    c.moving = !!(f & 1); c.air = !!(f & 2); c.sit = !!(f & 4); c.hang = !!(f & 8); c.ladder = !!(f & 16); c.rollBack = !!(f & 32);
    c.roll = -1; c.pk = ''; c.pkK = 0; c.climbPh = 0; c.seatY = null;
    if (f & 128) { const ro = r.u8(); c.roll = ro === 255 ? -1 : ro / 254; c.pk = PK[r.u8()] || ''; c.pkK = r.u8() / 255; c.climbPh = r.u8() / 255 * PI2; const sy = r.vs(); c.seatY = sy === 0 ? null : (sy > 0 ? sy - 1 : sy + 1) / 100; }
    return c;
  }
  const wrapA = a => { a %= PI2; if (a > Math.PI) a -= PI2; else if (a < -Math.PI) a += PI2; return a; };

  // ═══ Плавный показ чужого персонажа: буфер снимков, задержка по разбросу пути, сплайн по скоростям, мягкая поправка ═══
  const SNAP = 4.5;      // скачок больше — телепорт (переставить)
  const MAXEX = 250;     // мс: дальше последнего снимка «угадываем» не дольше
  function mkRemote(id){ return { id, buf: [], lates: [], minL: 0, p95L: 0, nL: 0, iv: 66, delay: -1, off: [0, 0, 0], rawPrev: null, rtPrev: 0, tpPrev: -1, pose: null, lastArr: 0 }; }
  const worldOf = (s, posOf) => { if (s.on) { const p = posOf(s.on); if (p) return [p[0] + s.x, p[1] + s.y, p[2] + s.z]; } return [s.x, s.y, s.z]; };
  // Положение на момент rt (местные мс): { p, yaw, s (снимок для позы), k (доля к следующему), n (следующий) }
  function evalRemote(rc, rt, posOf, g){
    const b = rc.buf, n = b.length; if (!n) return null;
    if (rt <= b[0].t) return { p: worldOf(b[0], posOf), yaw: b[0].yaw, s: b[0], k: 0, n: b[0] };
    for (let i = n - 1; i > 0; i--) {
      const A = b[i - 1], Bs = b[i];
      if (rt < A.t) continue;
      if (rt > Bs.t) break;
      const pa = worldOf(A, posOf), pb = worldOf(Bs, posOf), dt = (Bs.t - A.t) / 1000;
      if (A.tp !== Bs.tp || dt <= 0) return { p: pa, yaw: A.yaw, s: A, k: 0, n: Bs };
      const k = (rt - A.t) / (Bs.t - A.t), p = [0, 0, 0];
      if (A.on === Bs.on && Math.hypot(pb[0] - pa[0], pb[2] - pa[2]) < SNAP + 12 * dt) {
        // кубический сплайн Эрмита по скоростям (прыжок — точная парабола), без вылетов за отрезок
        const k2 = k * k, k3 = k2 * k, h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2, h11 = k3 - k2;
        const va = [A.vx, A.vy, A.vz], vb = [Bs.vx, Bs.vy, Bs.vz];
        for (let j = 0; j < 3; j++) {
          let v = h00 * pa[j] + h10 * dt * va[j] + h01 * pb[j] + h11 * dt * vb[j];
          const lo = Math.min(pa[j], pb[j]), hi = Math.max(pa[j], pb[j]), m = .35 * (hi - lo) + .03;
          if (j === 1) v = Math.max(lo - .03, Math.min(hi + (A.air || Bs.air ? 3 : m), v)); else v = Math.max(lo - m, Math.min(hi + m, v));
          p[j] = v;
        }
      } else for (let j = 0; j < 3; j++) p[j] = pa[j] + (pb[j] - pa[j]) * k;
      return { p, yaw: A.yaw + wrapA(Bs.yaw - A.yaw) * k, s: A, k, n: Bs };
    }
    // дальше последнего — по скорости, недолго (стоял — стоит)
    const L = b[n - 1], p = worldOf(L, posOf), tau = Math.min(rt - L.t, MAXEX) / 1000;
    if (tau > 0 && (L.moving || L.air)) {
      const v = Math.hypot(L.vx, L.vz), k = v * tau > 1.5 ? 1.5 / (v * tau) : 1;
      p[0] += L.vx * tau * k; p[2] += L.vz * tau * k;
      if (L.air) p[1] = Math.max(p[1] - 3, p[1] + L.vy * tau - g * tau * tau / 2);
    }
    return { p, yaw: L.yaw, s: L, k: 0, n: L, ex: true };
  }
  // Новый снимок (t — уже в местных мс). Задержка: путь (минимум за окно) + запас на разброс и шаг снимков: 80–150 мс
  // (реже 5 раз в секунду — запас растёт до шага + 70 мс). Меняется плавно (≤ 10 % хода времени)
  function pushRemote(rc, smp, arr, posOf, g){
    const b = rc.buf;
    if (b.length && Math.abs(b[b.length - 1].t - smp.t) < .5) return;   // повтор
    let i = b.length;
    while (i > 0 && b[i - 1].t > smp.t) i--;
    if (i < b.length && Math.abs(b[i].t - smp.t) < .5) return;
    const prev = i > 0 ? b[i - 1] : null;
    if (prev && i === b.length && (smp.moving || prev.moving)) { const d = smp.t - prev.t; if (d > 20 && d < 400) rc.iv += (d - rc.iv) * .2; }
    b.splice(i, 0, smp);
    rc.lates.push(arr - smp.t); if (rc.lates.length > 48) rc.lates.shift();
    if (++rc.nL % 6 === 1 || rc.delay < 0) { const s = rc.lates.slice().sort((x, y) => x - y); rc.minL = s[0]; rc.p95L = s[Math.min(s.length - 1, Math.floor(s.length * .95))]; }
    // мягкая поправка: то, что уже показали, не прыгает (кроме телепорта)
    if (rc.rawPrev) {
      const e = evalRemote(rc, rc.rtPrev, posOf, g);
      if (e) { const d = [rc.rawPrev[0] - e.p[0], rc.rawPrev[1] - e.p[1], rc.rawPrev[2] - e.p[2]]; if (Math.hypot(...d) < SNAP) for (let j = 0; j < 3; j++) rc.off[j] += d[j]; rc.rawPrev = e.p; }
    }
    rc.lastArr = arr;
  }
  function remoteDelayTarget(rc){
    const iv = Math.max(30, Math.min(300, rc.iv));
    return rc.minL + Math.max(80, Math.min(Math.max(150, iv + 70), rc.p95L - rc.minL + iv + 12));
  }
  // Каждый шаг: поза на (сейчас − задержка) + затухающая поправка
  function stepRemote(rc, tNow, dt, posOf, g){
    if (!rc.buf.length) return null;
    const target = remoteDelayTarget(rc);
    if (rc.delay < 0) rc.delay = target;
    else { const mx = dt * 1000 * .1; rc.delay += Math.max(-mx, Math.min(mx, target - rc.delay)); }
    const rt = tNow - rc.delay, e = evalRemote(rc, rt, posOf, g);
    const k = Math.exp(-dt / .12);
    for (let j = 0; j < 3; j++) rc.off[j] *= k;
    if (e.s.tp !== rc.tpPrev) { if (rc.tpPrev !== -1) rc.off = [0, 0, 0]; rc.tpPrev = e.s.tp; }   // телепорт — сразу на месте
    rc.rawPrev = e.p; rc.rtPrev = rt;
    while (rc.buf.length > 3 && rc.buf[1].t < rt - 600) rc.buf.shift();
    const s = e.s, n = e.n, k2 = e.k;
    rc.pose = { x: e.p[0] + rc.off[0], y: e.p[1] + rc.off[1], z: e.p[2] + rc.off[2], yaw: e.yaw, moving: s.moving, speed: s.speed + (n.speed - s.speed) * k2, air: s.air,
      crouch: s.crouch + (n.crouch - s.crouch) * k2, sit: s.sit, seatY: s.seatY, roll: s.roll >= 0 && n.roll >= 0 ? s.roll + (n.roll - s.roll) * k2 : s.roll, rollBack: s.rollBack,
      hang: s.hang, ladder: s.ladder, climbPh: s.climbPh, pk: s.pk, pkK: s.pk && n.pk === s.pk ? s.pkK + (n.pkK - s.pkK) * k2 : s.pkK };
    rc.ex = !!e.ex;
    return rc.pose;
  }

  // ═══ Плавное движение объектов у гостя: свой буфер у pos и rot ═══
  function ipPush(ip, t, v, cur, gap){
    const b = ip.b;
    while (b.length && b[b.length - 1].t >= t) b.pop();   // обновления идут по порядку пакетов: новое — всегда последнее
    if (!b.length) b.push({ t: t - gap, v: cur });
    else { const L = b[b.length - 1]; if (t - L.t > 2.5 * gap + 100) b.push({ t: t - gap, v: L.v }); else ip.iv += (Math.min(1000, t - L.t) - ip.iv) * .25; }
    b.push({ t, v });
    if (b.length > 8) b.splice(0, b.length - 8);
  }
  function ipEval(ip, rt, ang){
    const b = ip.b, n = b.length;
    if (rt >= b[n - 1].t) return { v: b[n - 1].v, done: true };
    if (rt <= b[0].t) return { v: b[0].v, done: false };
    for (let i = n - 1; i > 0; i--) {
      const A = b[i - 1], Bs = b[i];
      if (rt < A.t) continue;
      const k = (rt - A.t) / Math.max(1e-6, Bs.t - A.t);
      return { v: ang ? A.v.map((a, j) => { let d = (Bs.v[j] - a) % 360; if (d > 180) d -= 360; else if (d < -180) d += 360; return a + d * k; }) : A.v.map((a, j) => a + (Bs.v[j] - a) * k), done: false };
    }
    return { v: b[0].v, done: false };
  }

  // ═══ Сессия ═══
  const epNewer = (a, b) => { const d = (a - b) & 255; return d > 0 && d < 128; };
  // Бюджет на одного: напрямую (WebRTC) — 15 пакетов/с по ≤ 1200 байт; через Supabase — 5/с (не чаще 205 мс: NetPlay режет
  // всё, что чаще 190 мс). bulk — пакет крупнее, когда идут большие надёжные данные (мир новичку, ландшафт)
  const LIM = { p2p: { rate: 15, mtu: 1200, bulk: 8000, burst: 2, gap: 30 }, relay: { rate: 5, mtu: 4000, bulk: 12000, burst: 1, gap: 205 } };

  function session(o){
    const tr = o.transport, scene = o.scene;
    const now = o.now || (() => (root.performance ? root.performance.now() : Date.now()));
    const extra = (o.extra || []).slice(0, 16);
    const repl = o.replicate || (obj => obj.cls !== 'Script');
    const IN = Object.assign({ near: 48, farMax: 2000, charFar: 160 }, o.interest || {});
    const U = E.UNIT || 2.1 / 1.8, GRAV = o.gravity || 20 * U;
    const HOST_TIMEOUT = o.hostTimeout || 5000, HOOK = o.hook !== false, SCAN_MS = o.scanMs || (HOOK ? 1000 : 50);
    const S = { myId: tr.myId, isHost: false, hostId: null, epoch: 0, ready: false, closed: false };
    const links = new Map();                     // хозяин: гости; гость: один — хозяин
    const reps = new Map(), byNid = new Map();   // копия мира: sid → запись, nid → запись
    let nextNid = 1;
    const tomb = new Set();                      // удалённые nid (гость: опоздавшее «появление» не воскрешает)
    const pend = new Map();                      // nid родителя → [записи детей], пока родителя нет
    const players = new Map();                   // id → { id, slot, nick, info, data, lim, strikes, … }
    const remotes = new Map();                   // id → плавный показ
    const chars = new Map();                     // хозяин: id → последний проверенный снимок
    const blobs = new Map(), blobIn = new Map(); // хозяин: name → { u, ver }; гость: сборка
    let members = [];
    const dead = new Set();                      // не кандидаты в хозяева (молчали)
    let my = null, myTp = 0, lastScan = -1e9, scanAll = true;
    const dirtyNow = new Set();
    const clock = { off: 0, ok: false, smp: [] };
    const ctx = { extra, nidOf: sid => { const rp = reps.get(sid); return rp ? rp.nid : 0; }, sidOf: nid => byNid.get(nid)?.sid || null };
    const lim = id => { const l = (tr.limits && tr.limits(id)) || { mode: 'p2p' }; const d = LIM[l.mode === 'p2p' ? 'p2p' : 'relay']; return Object.assign({}, d, l, { mode: l.mode || 'p2p' }); };
    const hostNow = () => now() + (S.isHost ? 0 : clock.off);
    const call = (f, ...a) => { try { return f && f(...a); } catch (e) { (root.console || console).error(e); } };

    // ── Связь с одним игроком ──
    function mkLink(id){
      const t = now();
      return { id, born: t, seq: 0, rmax: -1, rbits: 0, sent: new Map(), rel: [], rs: 0, rin: 0, rbuf: new Map(),
        rtt: 0, rv: 0, rttN: 0, pt: 0, ptAt: 0, ptHas: false, lastRx: 0, lastTx: 0, owe: 0, oweAt: 0, tok: 1, tokAt: t,
        alive: false, objs: new Map(), dest: new Map(), chs: new Map(), chAt: new Map(), myLast: null, myTp: -1, pos: null, digAt: t + 2500, digR: 0, synced: false,
        trs: [], minT: 0, p95T: 0, nT: 0, piv: 66, win: [], lastPk: 0, objPend: false, objNext: 0, spawnBacklog: 0,
        st: { txP: 0, txB: 0, rxP: 0, rxB: 0, lost: 0, acked: 0, t0: t } };
    }
    function relPush(L, kind, u){ L.rel.push({ rs: L.rs, kind, u, inf: -1 }); L.rs = (L.rs + 1) & 0xFFFF; }
    const relJson = (L, m) => relPush(L, 1, te.encode(JSON.stringify(m)));
    // приём номера пакета: false — повтор или старше окна в 32
    function recvSeq(L, s){
      if (L.rmax < 0) { L.rmax = s; L.rbits = 0; return true; }
      if (s === L.rmax) return false;
      if (newer(s, L.rmax)) {
        const d = (s - L.rmax) & 0xFFFF;
        L.rbits = d > 32 ? 0 : d === 32 ? 0x80000000 : ((L.rbits << d) | (1 << (d - 1))) >>> 0;
        L.rmax = s; return true;
      }
      const d = (L.rmax - s) & 0xFFFF;
      if (d > 32) return false;
      const bit = (1 << (d - 1)) >>> 0;
      if (L.rbits & bit) return false;
      L.rbits = (L.rbits | bit) >>> 0; return true;
    }
    function onAck(L, ack, bits){
      for (const [s, rec] of L.sent) {
        const d = (ack - s) & 0xFFFF;
        if (d === 0 || (d <= 32 && (bits >>> (d - 1)) & 1)) { L.sent.delete(s); acked(L, rec); }
      }
    }
    function acked(L, rec){
      L.st.acked++;
      if (rec.rel.length) { for (const e of rec.rel) e.done = true; L.rel = L.rel.filter(e => !e.done); }
      const ob = rec.ob;
      for (let i = 0; i < ob.length; i += 3) { const G = L.objs.get(ob[i]); if (G) { G.fl--; if (ob[i + 2] && G.sp === 1) G.sp = 2; } }
      for (const nid of rec.de) L.dest.delete(nid);
    }
    function lost(L, rec){
      L.st.lost++;
      for (const e of rec.rel) if (!e.done) e.inf = -1;
      const ob = rec.ob;
      for (let i = 0; i < ob.length; i += 3) { const G = L.objs.get(ob[i]); if (G) { G.fl--; G.d |= ob[i + 1]; if (ob[i + 2] && G.sp === 1) { G.sp = 0; G.d = 0; } L.objPend = true; L.objNext = 0; } }
      for (const nid of rec.de) { const x = L.dest.get(nid); if (x) x.inf = -1; }
      // снимок персонажа, после которого новых не было, — перепослать (последнее положение доходит всегда)
      for (let i = 0; i < rec.ch.length; i += 2) if (L.chs.get(rec.ch[i]) === rec.ch[i + 1]) L.chs.delete(rec.ch[i]);
    }
    function lossCheck(L, t){
      const l = lim(L.id), to = Math.max(150, Math.min(2500, (L.rttN ? L.rtt + 4 * L.rv : 700) + 1000 / l.rate + 80));
      for (const [s, rec] of L.sent) if (t - rec.t > to || L.sent.size > 200) { L.sent.delete(s); lost(L, rec); }
    }
    // ── Часы: RTT по эху, часы хозяина по самому быстрому из последних ответов (как NTP) ──
    function rttSample(L, s){
      if (!L.rttN) { L.rtt = s; L.rv = s / 2; } else { L.rv += (Math.abs(s - L.rtt) - L.rv) / 4; L.rtt += (s - L.rtt) / 8; }
      L.rttN++;
    }
    function clockSample(H, rtt, t){
      clock.smp.push([rtt, H + rtt / 2 - t]); if (clock.smp.length > 24) clock.smp.shift();
      let best = clock.smp[0]; for (const x of clock.smp) if (x[0] < best[0]) best = x;
      if (!clock.ok || Math.abs(best[1] - clock.off) > 80) { clock.off = best[1]; clock.ok = true; } else clock.off += (best[1] - clock.off) * .2;
    }
    function transitSample(L, v){
      L.trs.push(v); if (L.trs.length > 64) L.trs.shift();
      if (++L.nT % 8 === 1) { const s = L.trs.slice().sort((a, b) => a - b); L.minT = s[0]; L.p95T = s[Math.min(s.length - 1, Math.floor(s.length * .95))]; }
    }
    function header(w, L, host){
      const t = now();
      w.u8(VER); w.u8((host ? 1 : 0) | (L.ptHas ? 2 : 0) | (L.rmax >= 0 ? 4 : 0)); w.u8(S.epoch & 255);
      w.u16(L.seq); w.u16(L.rmax & 0xFFFF); w.u32(L.rbits); w.u32(Math.round(t) >>> 0);
      w.u16(L.pt & 0xFFFF); w.u16(L.ptHas ? Math.min(65535, Math.round(t - L.ptAt)) : 0);
    }
    function ship(L, w, rec){
      const u = w.out(), t = now();
      rec.t = t; L.sent.set(L.seq, rec);
      L.seq = (L.seq + 1) & 0xFFFF; L.lastTx = t; L.owe = 0; L.oweAt = 0; L.tok -= 1; L.win.push(t);
      L.st.txP++; L.st.txB += u.length;
      tr.send(L.id, u);
    }
    function tokens(L, t){
      const l = lim(L.id);
      L.tok = Math.min(l.burst, L.tok + (t - L.tokAt) / 1000 * l.rate); L.tokAt = t;
      while (L.win.length && t - L.win[0] > 1000.5) L.win.shift();   // строго: в любой секунде не больше rate
      L.full = L.win.length >= l.rate;   // за последнюю секунду уже rate пакетов — ждём
      return l;
    }
    // Надёжные сообщения в пакет: по порядку, что ещё не в пути; бюджет байт
    function writeRel(w, L, rec, budget){
      const list = [];
      let size = 0;
      for (const e of L.rel) { if (e.inf !== -1) continue; const k = e.u.length + 6; if (w.n + size + k + 4 > budget) break; list.push(e); size += k; if (list.length >= 64) break; }
      if (!list.length) return;
      w.u8(4); w.vu(list.length);
      for (const e of list) { w.u16(e.rs); w.u8(e.kind); w.vu(e.u.length); w.bytes(e.u); e.inf = L.seq; rec.rel.push(e); }
    }
    function readRel(L, r, from){
      const n = r.vu();
      for (let i = 0; i < n; i++) {
        const rs = r.u16(), kind = r.u8(), len = r.vu(); if (len > 20000) throw new Error('rel');
        const u = r.bytes(len).slice();
        if (rs === L.rin) { relDeliver(L, kind, u, from); L.rin = (L.rin + 1) & 0xFFFF; while (L.rbuf.has(L.rin)) { const x = L.rbuf.get(L.rin); L.rbuf.delete(L.rin); relDeliver(L, x[0], x[1], from); L.rin = (L.rin + 1) & 0xFFFF; } }
        else if (((rs - L.rin) & 0xFFFF) < 4096 && L.rbuf.size < 512) L.rbuf.set(rs, [kind, u]);
      }
    }

    // ── Приём пакета ──
    function onPacket(from, u8){
      if (S.closed || !u8 || u8.length < 18) return;
      const r = new R(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
      let fl, ep, seq, ack, bits, time, echo, hold;
      try { if (r.u8() !== VER) return; fl = r.u8(); ep = r.u8(); seq = r.u16(); ack = r.u16(); bits = r.u32(); time = r.u32(); echo = r.u16(); hold = r.u16(); } catch (e) { return; }
      const fromHost = !!(fl & 1);
      if (fromHost) {
        if (S.isHost ? !yieldTo(from, ep) : !acceptHost(from, ep)) {
          // прежний хозяин ожил (вкладка «спала» дольше HOST_TIMEOUT, хозяин уже мы): шлём ему свои пакеты — он увидит эпоху
          // новее и уступит, когда его гости замолчат (иначе хозяев так и осталось бы двое). Кандидатом он не становится (dead)
          if (S.isHost && dead.has(from) && !links.has(from) && members.some(m => m.id === from)) addGuest(from);
          return;
        }
      } else {
        if (!S.isHost || !members.some(m => m.id === from)) return;
        if (!links.has(from)) addGuest(from);
      }
      const L = links.get(from);
      if (!L || !recvSeq(L, seq)) return;
      const t = now();
      L.lastRx = t; L.st.rxP++; L.st.rxB += u8.length;
      if (!L.alive) { L.alive = true; if (S.isHost) L.digAt = t + (L.synced ? 300 : 3000); }
      if (fl & 2) { const rs = ((Math.round(t) - echo) & 0xFFFF) - hold; if (rs >= 0 && rs < 15000) { rttSample(L, rs); if (fromHost) clockSample(time, rs, t); } }
      L.pt = time; L.ptAt = t; L.ptHas = true;
      if (fl & 4) onAck(L, ack, bits);
      // метка для плавности: время хозяина + самый быстрый путь до нас (часы не нужны, смена хозяина не ломает)
      if (fromHost) { transitSample(L, t - time); if (L.lastPk && t - L.lastPk < 1000) L.piv += (Math.max(30, Math.min(400, t - L.lastPk)) - L.piv) * .1; L.lastPk = t; pktT = time + L.minT; }
      L.owe++; if (!L.oweAt) L.oweAt = t;
      try {
        while (r.left() > 0) {
          const ty = r.u8();
          if (ty === 4) readRel(L, r, from);
          else if (fromHost && ty === 1) readChars(L, r, t);
          else if (fromHost && ty === 2) readObjs(L, r, seq);
          else if (fromHost && ty === 3) readDest(r, seq);
          else if (fromHost && ty === 5) readDigest(L, r, seq);
          else if (!fromHost && ty === 7) readMyChar(L, r, t);
          else break;
        }
      } catch (e) {}
    }

    // ═══ Хозяин: изменения сцены ═══
    let plDirty = false;
    function newRep(sid, cls, nid){
      const ci = CLS.indexOf(cls);
      const rp = { sid, cls, ci: ci >= 0 ? ci : 255, nid: nid || nextNid++, q: new Array(NP), raw: new Array(NP), h: 0, b: bucketOf(sid), seq: new Uint16Array(NP), se: -1, sps: 0, spe: -1, ip: null, mt: 0 };
      if (rp.nid >= nextNid) nextNid = rp.nid + 1;
      reps.set(sid, rp); byNid.set(rp.nid, rp);
      return rp;
    }
    const newG = sp => ({ d: 0, sp, acc: 0, last: 0, fl: 0 });
    // Свойства объекта сравниваются сначала «как есть» (без новых массивов), квантуются — только если что-то поменялось
    function scanObj(rp, obj, t){
      let m = 0;
      for (let i = 0; i < NP; i++) {
        const k = PROPS[i][0], c = rp.raw[i];
        let v;
        if (k === '_flags') { v = 0; for (let j = 0; j < FLAGS.length; j++) { const f = obj[FLAGS[j]]; v = v * 3 + (typeof f !== 'boolean' ? 0 : f ? 2 : 1); } if (c === v) continue; rp.raw[i] = v; }
        else if (k === '_extra') { if (!extra.length) continue; v = extra.map(e => obj[e]); if (c && v.every((x, j) => x === c[j])) continue; rp.raw[i] = v; }
        else {
          v = obj[k];
          if (Array.isArray(v)) { if (c && c[0] === v[0] && c[1] === v[1] && c[2] === v[2]) continue; rp.raw[i] = [v[0], v[1], v[2]]; }
          else { if (c === v && (v !== undefined || i in rp.raw)) continue; rp.raw[i] = v; }
        }
        const q = quant(i, obj, ctx);
        if (!eqQ(q, rp.q[i])) { rp.q[i] = q; m |= 1 << i; }
      }
      if (m) {
        rp.h = 0; if (m & 3) rp.mt = t;
        for (const L of links.values()) { const G = L.objs.get(rp.nid); if (G && G.sp) { G.d |= m; L.objPend = true; L.objNext = 0; } }
      }
    }
    let scanNo = 0;
    function ensureRep(obj){ let rp = reps.get(obj.id); if (!rp) { rp = newRep(obj.id, obj.cls); for (const L of links.values()) { L.objs.set(rp.nid, newG(0)); L.objPend = true; L.objNext = 0; } } return rp; }
    // Полный обход — раз в секунду (страховка: свойства, записанные мимо scene.set); каждый шаг — только то, что трогали
    function scan(t){
      lastScan = t; scanNo++;
      const all = scene.all();
      for (const obj of all) if (repl(obj)) ensureRep(obj).sn = scanNo;
      for (const obj of all) if (repl(obj)) scanObj(reps.get(obj.id), obj, t);
      for (const rp of reps.values()) if (rp.sn !== scanNo) dropRep(rp);
      dirtyNow.clear(); hintRm.clear();
    }
    function scanHints(t){
      for (const obj of dirtyNow) if (repl(obj) && scene.get(obj.id) === obj) ensureRep(obj);
      for (const obj of dirtyNow) { const rp = reps.get(obj.id); if (rp && scene.get(obj.id) === obj) scanObj(rp, obj, t); }
      dirtyNow.clear();
      for (const id of hintRm) { const rp = reps.get(id); if (rp && !scene.get(id)) dropRep(rp); }
      hintRm.clear();
    }
    // Подсказки от сцены: оборачиваем set/add/remove/reparent этой сцены (на время сессии; S.close() возвращает как было)
    const hintRm = new Set(), orig = {};
    if (HOOK) for (const f of ['set', 'add', 'remove', 'reparent']) {
      const fn = scene[f]; if (typeof fn !== 'function') continue;
      orig[f] = fn;
      scene[f] = function (obj, ...a){
        const r = fn.call(this, obj, ...a);
        if (S.isHost && !S.closed) { if (f === 'add') { if (r) dirtyNow.add(r); } else if (f === 'remove') { if (obj) hintRm.add(obj.id); } else if (obj) dirtyNow.add(obj); }
        return r;
      };
    }
    function dropRep(rp){
      for (const L of links.values()) { const G = L.objs.get(rp.nid); if (G) { L.objs.delete(rp.nid); if (G.sp) L.dest.set(rp.nid, { b: rp.b, inf: -1 }); } }
      reps.delete(rp.sid); byNid.delete(rp.nid);
    }
    const present = rp => { let m = 0; for (let i = 0; i < NP; i++) if (rp.q[i] !== undefined) m |= 1 << i; return m; };
    function writeUpd(w, rp, spawn, mask){
      const m = (spawn ? present(rp) : mask & present(rp));
      w.vu(rp.nid); w.vu(m | (spawn ? SPAWN : 0));
      if (spawn) { w.u8(rp.ci); if (rp.ci === 255) w.str(rp.cls); w.str(rp.sid); }
      for (let i = 0; i < NP; i++) if (m & (1 << i)) writeQ(w, i, rp.q[i]);
      return m;
    }
    const objPos = rp => rp.q[0] ? [rp.q[0][0] / 100, rp.q[0][1] / 100, rp.q[0][2] / 100] : null;
    // Интерес: близкие (≤ near) — в каждом пакете; дальние — не чаще раза в 0,1–2 с и с меньшим приоритетом
    function writeObjs(w, L, rec, budget, t){
      const dtL = Math.min(.5, Math.max(0, (t - (L.objAt || t)) / 1000)) || .016; L.objAt = t;
      const cand = []; let nextAt = Infinity;
      for (const [nid, G] of L.objs) {
        if (G.sp === 1 || (G.sp === 2 && !G.d)) continue;
        const rp = byNid.get(nid); if (!rp) continue;
        const p = objPos(rp), d = p && L.pos ? Math.hypot(p[0] - L.pos[0], (p[1] - L.pos[1]) * .5, p[2] - L.pos[2]) : 0;
        const near = d <= IN.near, iv = near ? 0 : Math.min(IN.farMax, (d - IN.near) / IN.near * 500 + 100);
        if (t - G.last < iv) { nextAt = Math.min(nextAt, G.last + iv); continue; }
        G.acc += dtL * (near ? 1 : Math.max(.03, (IN.near / d) ** 2)) * (G.sp === 0 ? 2 : t - rp.mt < 300 ? 1.5 : 1);
        G.nid = nid; cand.push(G);
      }
      L.objNext = nextAt;
      if (!cand.length) { L.objPend = nextAt < Infinity; return; }
      cand.sort((a, b) => b.acc - a.acc);
      w.u8(2); const at = w.n; w.u16(0);
      let n = 0;
      for (const G of cand) {
        if (w.n + 24 > budget) break;
        const save = w.n, rp = byNid.get(G.nid), spawn = G.sp === 0;
        const m = writeUpd(w, rp, spawn, G.d);
        if (w.n > budget && n) { w.n = save; break; }
        n++; G.last = t; G.acc = 0; G.fl++; G.d = 0; if (spawn) G.sp = 1;
        rec.ob.push(G.nid, m, spawn ? 1 : 0);
        if (n >= 4000) break;
      }
      if (!n) { w.n = at - 1; return; }
      w.b[at] = n & 255; w.b[at + 1] = n >> 8;
      L.objPend = n < cand.length || nextAt < Infinity;
    }
    // Сводка: хеши «чистых» корзин (у гостя всё подтверждено) — гость сверяет и просит перепослать несовпавшие
    function writeDigest(w, L){
      const clean = new Uint8Array(NB).fill(1), hs = new Uint32Array(NB);
      for (const rp of reps.values()) {
        const b = rp.b; if (!clean[b]) continue;
        const G = L.objs.get(rp.nid);
        if (!G || G.sp !== 2 || G.d || G.fl) { clean[b] = 0; continue; }
        if (!rp.h) rp.h = hashRep(rp) || 1;
        hs[b] = (hs[b] ^ rp.h) >>> 0;
      }
      for (const x of L.dest.values()) clean[x.b] = 0;
      let n = 0; for (let b = 0; b < NB; b++) n += clean[b];
      if (!n) return false;
      L.digR = (L.digR + 1) & 0xFFFF;
      w.u8(5); w.u16(L.digR); w.u8(n);
      for (let b = 0; b < NB; b++) if (clean[b]) { w.u8(b); w.u32(hs[b]); }
      return true;
    }
    function writeDest(w, L, rec){
      const list = [];
      for (const [nid, x] of L.dest) if (x.inf === -1 && list.length < 300) list.push(nid);
      if (!list.length) return;
      w.u8(3); w.vu(list.length);
      for (const nid of list) { w.vu(nid); L.dest.get(nid).inf = L.seq; rec.de.push(nid); }
    }
    // Персонажи: свежий снимок каждого (кроме самого гостя); дальние — не чаще 4 раз в секунду
    const bigOf = prev => !prev || flagsOf(my) !== flagsOf(prev) || myTp !== prev.tp || Math.hypot(my.vx - prev.vx, my.vy - prev.vy, my.vz - prev.vz) > 3;
    const myDue = (L, t, l) => { if (!my) return false; const since = t - (L.chAt.get(S.myId) || 0); return (since >= 1000 / l.rate - 5 && (since >= 1000 || !L.myLast || myChanged(L.myLast) || L.chs.get(S.myId) === undefined || L.redund > 0)) || (since >= 30 && bigOf(L.myLast)); };
    function writeChars(w, L, rec, t, l){
      const list = [];
      if (myDue(L, t, l) || (my && L.myLast && myChanged(L.myLast) && t - (L.chAt.get(S.myId) || 0) >= 30)) {
        if (bigOf(L.myLast)) L.redund = 3; else if (L.redund > 0) L.redund--;
        let c = chars.get(S.myId); if (!c || t - c.rx > 25) c = sampleHost(t); list.push([S.myId, c]); L.myLast = Object.assign({ tp: myTp }, my);
      }
      for (const [id, c] of chars) {
        if (id === L.id || id === S.myId || L.chs.get(id) === c.t) continue;
        if (L.pos && Math.hypot(c.wx - L.pos[0], c.wz - L.pos[2]) > IN.charFar && t - (L.chAt.get(id) || 0) < 250) continue;
        list.push([id, c]);
      }
      if (!list.length) return;
      w.u8(1); w.vu(list.length);
      for (const [id, c] of list) { writeChar(w, c); L.chs.set(id, c.t); L.chAt.set(id, t); rec.ch.push(id, c.t); }
    }
    function hostSend(L, t){
      const l = tokens(L, t);
      if (L.tok < .999 || L.full || t - L.lastTx < l.gap) return;
      const relDue = L.rel.some(e => e.inf === -1);
      let destDue = false; for (const x of L.dest.values()) if (x.inf === -1) { destDue = true; break; }
      let chDue = L.alive && myDue(L, t, l);
      if (L.alive && !chDue) for (const [id, c] of chars) if (id !== L.id && id !== S.myId && L.chs.get(id) !== c.t) { chDue = true; break; }
      const objDue = L.alive && L.objPend && t >= (L.objNext || 0) - 1;
      const digDue = L.alive && t >= L.digAt;
      const ackDue = L.owe && t - L.oweAt >= (l.mode === 'p2p' ? 40 : 150);
      if (!(relDue || destDue || chDue || objDue || digDue || ackDue || t - L.lastTx >= 1000)) return;
      const rec = { t, rel: [], ob: [], de: [], ch: [] };
      let budget = l.mtu;
      const first = L.rel.find(e => e.inf === -1);
      if (first && first.u.length + 400 > budget) budget = Math.min(l.bulk, first.u.length + 600);
      if (L.spawnBacklog > 20) budget = l.bulk;
      const w = new W(budget + 64);
      header(w, L, true);
      writeDest(w, L, rec);
      if (L.alive) writeChars(w, L, rec, t, l);
      writeRel(w, L, rec, budget - 40);
      if (digDue && w.n < budget - 340) { writeDigest(w, L); L.digAt = t + 5000; }
      if (L.alive && L.objPend) writeObjs(w, L, rec, budget, t);
      ship(L, w, rec);
    }
    const myChanged = prev => !prev || !my || Math.abs(my.x - prev.x) + Math.abs(my.y - prev.y) + Math.abs(my.z - prev.z) > .01 || Math.abs(wrapA((my.yaw || 0) - (prev.yaw || 0))) > .01 || flagsOf(my) !== flagsOf(prev) || my.on !== prev.on;
    const flagsOf = c => (c.moving ? 1 : 0) | (c.air ? 2 : 0) | (c.sit ? 4 : 0) | (c.hang ? 8 : 0) | (c.ladder ? 16 : 0) | (c.roll >= 0 ? 32 : 0) | (c.pk ? 64 : 0);
    // свой снимок (общий вид для хозяина и гостя): позиция от детали под ногами, если она в копии мира
    function mySample(t){
      const p = players.get(S.myId), c = Object.assign({}, my, { slot: p ? p.slot : 0, t, tp: myTp, on: 0 });
      const rp = my.on ? reps.get(my.on) : null, ob = rp && scene.get(rp.sid);
      c.wx = my.x; c.wy = my.y; c.wz = my.z;
      if (ob && Array.isArray(ob.pos)) { c.on = rp.nid; c.x = my.x - ob.pos[0]; c.y = my.y - ob.pos[1]; c.z = my.z - ob.pos[2]; }
      return c;
    }
    function sampleHost(t){ const c = mySample(t); c.rx = t; chars.set(S.myId, c); return c; }

    // ── Проверка чужого персонажа: скорость с запасом, прыжок, телепорт только туда, куда разрешено ──
    function canTeleport(p, wp){
      if (p.expect && Math.hypot(wp[0] - p.expect[0], wp[1] - p.expect[1], wp[2] - p.expect[2]) < 3) { p.expect = null; p.fixing = false; return true; }
      if (p.fixing) return false;   // велели вернуться — принимаем только туда
      if (o.validTeleport) return !!call(o.validTeleport, p.id, wp);
      const sp = scene.all().filter(x => x.cls === 'Spawn' && Array.isArray(x.pos));
      if (!sp.length) return true;
      return sp.some(s => Math.hypot(s.pos[0] - wp[0], s.pos[2] - wp[2]) < Math.max(s.size?.[0] || 4, s.size?.[2] || 4) / 2 + 3 && Math.abs(s.pos[1] - wp[1]) < 8);
    }
    // Время снимка: по часам владельца, но не быстрее моих (+250 мс за всё время): «отставание» lag = моё − его опускается
    // не быстрее 2 мс в секунду — ускоренные часы не дают лишнего пути. Разрешённый путь = запас из прошлого (не больше 3)
    // + скорость × 1,25 × время с прошлого снимка; прошёл больше — не принимаем. Вверх — свой запас (прыжок, лестница),
    // падать можно как угодно. Пропали пакеты — время больше, путь больше: честного не ловит
    function validChar(p, c, t){
      const prev = p.last, lag = t - c.t;
      if (p.minLag === undefined || !prev) { p.minLag = lag; p.lagAt = t; }
      else if (lag < p.minLag) p.minLag = Math.max(lag, p.minLag - (t - p.lagAt) * .002);
      p.lagAt = t;
      c.te = Math.min(c.t, t - p.minLag + 250);
      if (!prev) { p.cred = 3; p.credY = 2.5; return true; }
      if (c.t <= prev.t) return false;
      const lm = p.lim || {}, run = (lm.walk != null ? lm.walk / 16 : 1) * 7 * U, jv = Math.sqrt(2 * GRAV * 1.2 * U) * (lm.jump != null ? lm.jump / 50 : 1);
      const dt = Math.max(0, Math.min(3, (c.te - prev.te) / 1000));
      let why = '', h = 0, up = 0;
      if (c.tp !== prev.tp) { if (!canTeleport(p, [c.wx, c.wy, c.wz])) why = 'teleport'; }
      else {
        const same = c.on === prev.on, a = same ? [c.x - prev.x, c.y - prev.y, c.z - prev.z] : [c.wx - prev.wx, c.wy - prev.wy, c.wz - prev.wz];
        h = Math.hypot(a[0], a[2]) - (same ? 0 : 1.5); up = Math.max(0, a[1] - (same ? 0 : 1.5));
        if (Math.min(3, p.cred) + run * 1.25 * dt - h < -.25) why = 'speed';
        else if (Math.min(2.5, p.credY) + Math.max(jv, run) * 1.25 * dt - up < -.25) why = 'fly';
      }
      if (!why && o.validate && call(o.validate, p.id, c, prev) === false) why = 'custom';
      if (!why) {
        if (c.tp !== prev.tp) { p.cred = 3; p.credY = 2.5; }
        else { p.cred = Math.min(3, p.cred) + run * 1.25 * dt - Math.max(0, h); p.credY = Math.min(2.5, p.credY) + Math.max(jv, run) * 1.25 * dt - up; }
        // скорость в снимке — не больше разрешённой: другие «угадывают» вперёд по ней
        const vh = Math.hypot(c.vx, c.vz), vm = run * 1.3; if (vh > vm) { c.vx *= vm / vh; c.vz *= vm / vh; }
        if (c.vy > Math.max(jv, run) * 1.3) c.vy = Math.max(jv, run) * 1.3;
        return true;
      }
      p.strikes++;
      if (t - p.fixAt > 1000) { p.fixAt = t; p.fixing = true; p.expect = [prev.wx, prev.wy, prev.wz]; const L = links.get(p.id); if (L) relJson(L, { k: 'fix', p: p.expect }); }
      call(o.onCheat, p.id, { why, n: p.strikes, dt, h: Math.round(h * 100) / 100, up: Math.round(up * 100) / 100, cred: Math.round(p.cred * 100) / 100, gap: c.t - prev.t, te: c.te - prev.te });
      return false;
    }
    function readMyChar(L, r, t){
      const c = readChar(r), p = players.get(L.id);
      if (!p) return;
      c.slot = p.slot;
      const rp = c.on ? byNid.get(c.on) : null, ob = rp && scene.get(rp.sid);
      if (c.on && !(ob && Array.isArray(ob.pos))) c.on = 0;
      c.wx = c.x + (c.on ? ob.pos[0] : 0); c.wy = c.y + (c.on ? ob.pos[1] : 0); c.wz = c.z + (c.on ? ob.pos[2] : 0);
      if (!validChar(p, c, t)) return;
      c.rx = t; p.last = c; chars.set(L.id, c); L.pos = [c.wx, c.wy, c.wz];
      let rc = remotes.get(L.id); if (!rc) remotes.set(L.id, rc = mkRemote(L.id));
      pushRemote(rc, Object.assign({}, c), t, posOfNid, GRAV);
    }
    const posOfNid = nid => { const rp = byNid.get(nid), ob = rp && scene.get(rp.sid); return ob && Array.isArray(ob.pos) ? ob.pos : null; };
    function ensurePlayer(id){
      let p = players.get(id);
      if (!p) {
        const used = new Set([...players.values()].map(x => x.slot)); let s = 1; while (used.has(s) && s < 250) s++;
        p = { id, slot: s, nick: '', info: null, data: null, lim: null, strikes: 0, fixAt: 0, expect: null, last: null, ev: [] };
        players.set(id, p); plDirty = true;
      }
      return p;
    }
    function addGuest(id, synced){
      const L = mkLink(id); L.chAt = new Map();
      for (const rp of reps.values()) L.objs.set(rp.nid, newG(synced ? 2 : 0));
      L.objPend = !synced; L.spawnBacklog = synced ? 0 : reps.size; L.synced = !!synced;
      links.set(id, L); ensurePlayer(id);
      return L;
    }
    // данные игроков (очки) — тоже в списке: новичок не получал то, что записали до его входа
    const plMsg = () => ({ k: 'pl', e: S.epoch, l: [...players.values()].map(p => [p.id, p.slot, p.nick, p.info, p.data ?? null]) });
    function hostTick(t){
      if (t - lastScan >= SCAN_MS || scanAll) { scanAll = false; scan(t); }
      else if (dirtyNow.size || hintRm.size) scanHints(t);
      if (plDirty) { plDirty = false; const m = plMsg(); for (const L of links.values()) relJson(L, m); }
      for (const L of links.values()) {
        lossCheck(L, t);
        if (!L.synced && L.alive && (!L.chk || t - L.chk > 200)) {
          L.chk = t; let n = 0; for (const G of L.objs.values()) if (G.sp !== 2) n++;
          L.spawnBacklog = n; if (!n) { L.synced = true; relJson(L, { k: 'sync' }); }
        }
        hostSend(L, t);
      }
    }

    // ═══ Гость: копия мира ═══
    const ipActive = new Set(), bSeq = new Array(NB).fill(null), bySlot = new Map();
    let pktT = 0;   // время пакета хозяина (местные мс) — метка для плавного движения
    function touchB(b, seq){ const x = bSeq[b]; if (!x || x.e !== S.epoch || newer(seq, x.s)) bSeq[b] = { s: seq, e: S.epoch }; }
    function readObjs(L, r, seq){
      const n = r.u16();
      for (let i = 0; i < n; i++) readUpd(L, r, seq);
    }
    function readUpd(L, r, seq){
      const nid = r.vu(), mk = r.vu(), spawn = !!(mk & SPAWN), m = mk & ALL;
      let cls = '', sid = '';
      if (spawn) { const ci = r.u8(); cls = ci === 255 ? r.str(40) : CLS[ci]; sid = r.str(64); }
      const qs = new Array(NP);
      for (let i = 0; i < NP; i++) if (m & (1 << i)) qs[i] = readQ(r, i);
      if (tomb.has(nid) || S.isHost) return;
      let rp = byNid.get(nid);
      if (spawn) {
        if (!cls || !sid) return;
        if (rp && rp.sid !== sid) byNid.delete(nid);
        rp = reps.get(sid);
        if (rp && rp.nid !== nid) { byNid.delete(rp.nid); rp.nid = nid; byNid.set(nid, rp); }
        if (!rp) rp = newRep(sid, cls, nid);
        if (rp.cls !== cls) { rp.cls = cls; rp.ci = CLS.indexOf(cls) >= 0 ? CLS.indexOf(cls) : 255; const ob = scene.get(sid); if (ob) scene.remove(ob); }
        rp.sps = seq; rp.spe = S.epoch;
      } else if (!rp) return;
      if (rp.se !== S.epoch) { rp.se = S.epoch; rp.ok = 0; }
      let ap = 0;
      for (let i = 0; i < NP; i++) {
        const bit = 1 << i;
        if (!(m & bit) && !spawn) continue;
        if ((rp.ok & bit) && !newer(seq, rp.seq[i])) continue;   // уже есть новее (пакеты без порядка)
        rp.seq[i] = seq; rp.ok |= bit;
        if (m & bit) { if (!eqQ(rp.q[i], qs[i])) { rp.q[i] = qs[i]; ap |= bit; } }
        else if (rp.q[i] !== undefined) { rp.q[i] = undefined; }   // у хозяина свойства больше нет
      }
      rp.h = 0; touchB(rp.b, seq); if (ap & 3) rp.nUpd = (rp.nUpd || 0) + 1;
      applyRep(L, rp, ap, spawn);
    }
    function setProp(props, i, q){
      const [k, kind] = PROPS[i];
      if (kind === 'flags') { FLAGS.forEach((f, j) => { if ((q >> 8) & (1 << j)) props[f] = !!(q & (1 << j)); }); return; }
      if (k === '_extra') { const x = unq(i, q, ctx); if (x && typeof x === 'object') for (const e of extra) if (e in x) props[e] = x[e]; return; }
      if (k !== 'parent') props[k] = unq(i, q, ctx);
    }
    const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, j) => x === b[j])) || (a && b && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
    function applyRep(L, rp, m, spawn){
      let ob = scene.get(rp.sid);
      if (ob && ob.cls !== rp.cls) { scene.remove(ob); ob = null; }
      if (!ob) {
        const props = {};
        for (let i = 0; i < NP; i++) if (rp.q[i] !== undefined) setProp(props, i, rp.q[i]);
        const pn = rp.q[15] || 0, par = pn ? byNid.get(pn) : null, pob = par ? scene.get(par.sid) : null;
        try { ob = scene.add(rp.cls, props, pob, rp.sid); } catch (e) { return; }
        if (!ob) return;
        for (const k of Object.keys(props)) if (!same(ob[k], props[k])) scene.set(ob, k, props[k], true);   // чего add не взял
        if (pn && !pob) { if (!pend.has(pn)) pend.set(pn, []); pend.get(pn).push(rp); }
        const kids = pend.get(rp.nid);
        if (kids) { pend.delete(rp.nid); for (const c of kids) { const co = scene.get(c.sid); if (co && c.q[15] === rp.nid && scene.reparent) scene.reparent(co, ob); } }
        if (rp.ip) { rp.ip = null; ipActive.delete(rp); }
        return;
      }
      for (let i = 0; i < NP; i++) {
        if (!(m & (1 << i))) continue;
        const [k, kind] = PROPS[i], q = rp.q[i];
        if (q === undefined) continue;
        if (i <= 1 && !spawn && L) { ipQueue(L, rp, i, ob); continue; }
        if (kind === 'flags') { FLAGS.forEach((f, j) => { if ((q >> 8) & (1 << j)) { const v = !!(q & (1 << j)); if (ob[f] !== v) scene.set(ob, f, v, true); } }); continue; }
        if (k === '_extra') { const x = unq(i, q, ctx) || {}; for (const e of extra) if (e in x && !same(ob[e], x[e])) scene.set(ob, e, x[e], true); continue; }
        if (k === 'parent') {
          const par = q ? byNid.get(q) : null, pob = par ? scene.get(par.sid) : null;
          if (q && !pob) { if (!pend.has(q)) pend.set(q, []); pend.get(q).push(rp); continue; }
          if ((ob.parent || null) !== (pob ? pob.id : null) && scene.reparent) scene.reparent(ob, pob || null);
          continue;
        }
        const v = unq(i, q, ctx);
        if (!same(ob[k], v)) scene.set(ob, k, v, true);
      }
    }
    function ipQueue(L, rp, i, ob){
      const v = unq(i, rp.q[i], ctx), k = PROPS[i][0];
      if (!rp.ip) rp.ip = [null, null];
      const gap = Math.max(30, Math.min(400, L.piv || 66));
      let ip = rp.ip[i]; if (!ip) ip = rp.ip[i] = { b: [], iv: gap };
      ipPush(ip, pktT, v, Array.isArray(ob[k]) ? ob[k].slice() : v, gap);
      ipActive.add(rp);
    }
    // Каждый шаг: объекты на (сейчас − задержка): путь от хозяина + запас 80–150 мс (у редких — шаг их обновлений)
    function stepObjects(t){
      const L = links.get(S.hostId); if (!L) return;
      const spread = Math.max(0, L.p95T - L.minT);
      for (const rp of ipActive) {
        const ob = scene.get(rp.sid);
        if (!ob || !rp.ip) { ipActive.delete(rp); continue; }
        let busy = false;
        for (let i = 0; i < 2; i++) {
          const ip = rp.ip[i]; if (!ip || !ip.b.length) continue;
          const iv = Math.max(30, Math.min(1000, ip.iv)), delay = Math.max(80, Math.min(Math.max(150, iv + 70), spread + iv + 12));
          const e = ipEval(ip, t - delay, i === 1), k = PROPS[i][0], cur = ob[k];
          if (!Array.isArray(cur) || Math.abs(cur[0] - e.v[0]) + Math.abs(cur[1] - e.v[1]) + Math.abs(cur[2] - e.v[2]) > 1e-5) scene.set(ob, k, e.v.slice(), true);
          if (e.done) { if (ip.b.length > 1) ip.b.splice(0, ip.b.length - 1); } else busy = true;
        }
        if (!busy) ipActive.delete(rp);
      }
    }
    function finishIp(){
      for (const rp of ipActive) { const ob = scene.get(rp.sid); if (ob) for (let i = 0; i < 2; i++) if (rp.q[i] !== undefined) scene.set(ob, PROPS[i][0], unq(i, rp.q[i], ctx), true); rp.ip = null; }
      ipActive.clear();
    }
    function guestDrop(rp){
      const ob = scene.get(rp.sid);
      if (ob) {
        const ids = [], walk = x => { for (const c of x.children || []) { ids.push(c); const co = scene.get(c); if (co) walk(co); } };
        walk(ob); scene.remove(ob);
        for (const id of ids) { const c = reps.get(id); if (c && !scene.get(id)) { reps.delete(id); byNid.delete(c.nid); ipActive.delete(c); } }
      }
      reps.delete(rp.sid); if (byNid.get(rp.nid) === rp) byNid.delete(rp.nid); ipActive.delete(rp);
    }
    function readDest(r, seq){
      const n = r.vu();
      for (let i = 0; i < n; i++) {
        const nid = r.vu(); if (S.isHost) continue;
        tomb.add(nid);
        const rp = byNid.get(nid); if (rp) { touchB(rp.b, seq); guestDrop(rp); }
      }
      if (tomb.size > 50000) tomb.clear();
    }
    // у гостя объекта нет в сцене (удалили мимо сети) — хеш не совпадёт, и хозяин перепошлёт
    function bucketHashes(){ const hs = new Uint32Array(NB); for (const rp of reps.values()) { if (!scene.get(rp.sid)) continue; if (!rp.h) rp.h = hashRep(rp) || 1; hs[rp.b] = (hs[rp.b] ^ rp.h) >>> 0; } return hs; }
    function readDigest(L, r, seq){
      const round = r.u16(), n = r.u8(), hs = bucketHashes(), bad = [];
      for (let i = 0; i < n; i++) {
        const b = r.u8() & (NB - 1), h = r.u32(), x = bSeq[b];
        if (x && x.e === S.epoch && newer(x.s, seq)) continue;   // корзина менялась позже сводки
        if (hs[b] !== h) bad.push(b);
      }
      S.digests = (S.digests || 0) + 1;
      if (bad.length) { S.digestBad = (S.digestBad || 0) + bad.length; relJson(L, { k: 'dq', r: round, b: bad }); }
    }
    function readChars(L, r, t){
      const n = r.vu();
      for (let i = 0; i < n; i++) {
        const c = readChar(r), id = bySlot.get(c.slot);
        if (!id || id === S.myId) continue;
        let rc = remotes.get(id); if (!rc) remotes.set(id, rc = mkRemote(id));
        pushRemote(rc, c, t, posOfNid, GRAV);
      }
    }

    // ═══ Надёжные сообщения ═══
    const evRate = p => { const t = now(); p.ev = p.ev.filter(x => t - x < 1000); if (p.ev.length >= 30) return false; p.ev.push(t); return true; };
    function relDeliver(L, kind, u, from){
      if (kind === 2) { if (!S.isHost) blobPart(u); return; }
      let m; try { m = JSON.parse(td.decode(u)); } catch (e) { return; }
      if (!m || typeof m.k !== 'string') return;
      if (S.isHost) {
        const p = players.get(from); if (!p) return;
        if (m.k === 'hi') {
          const first = !p.nick; p.nick = String(m.nick || 'Игрок').slice(0, 24); p.info = m.info && JSON.stringify(m.info).length < 3000 ? m.info : null; plDirty = true;
          for (const name of blobs.keys()) sendBlob(L, name);
          if (first) call(o.onPlayer, 'join', pubP(p));
        } else if (m.k === 'ev') {
          if (typeof m.ty !== 'string' || !evRate(p)) return;
          call(o.onGuestEvent || o.onEvent, m.ty, m.d, from);
          if (m.to === 'all') for (const L2 of links.values()) if (L2.id !== from) relJson(L2, { k: 'ev', ty: m.ty, d: m.d, fr: from });
        } else if (m.k === 'dq' && Array.isArray(m.b)) {
          S.resyncs = (S.resyncs || 0) + m.b.length;
          for (const b0 of m.b.slice(0, NB)) {
            const b = b0 & (NB - 1), list = [];
            for (const rp of reps.values()) if (rp.b === b) { list.push(rp.nid); const G = L.objs.get(rp.nid); if (G) { G.sp = 0; G.d = 0; } }
            L.objPend = true; L.objNext = 0;
            relJson(L, { k: 'bk', b, a: L.seq, n: list });
          }
        }
        return;
      }
      if (m.k === 'pl' && Array.isArray(m.l)) {
        const seen = new Set();
        bySlot.clear();
        for (const [id, slot, nick, info, data] of m.l.slice(0, 250)) {
          if (typeof id !== 'string' || !(slot > 0 && slot < 256)) continue;
          seen.add(id); bySlot.set(slot, id);
          let p = players.get(id), isNew = !p;
          if (!p) players.set(id, p = { id, slot, nick: '', info: null, data: null, lim: null, strikes: 0, fixAt: 0, expect: null, last: null, ev: [] });
          p.slot = slot; p.nick = String(nick || ''); p.info = info || null;
          const dch = data !== undefined && JSON.stringify(p.data ?? null) !== JSON.stringify(data ?? null);
          if (dch) p.data = data ?? null;
          if (isNew && id !== S.myId) call(o.onPlayer, 'join', pubP(p));
          else if (dch) call(o.onPlayer, 'data', pubP(p));
        }
        for (const [id, p] of players) if (!seen.has(id)) { players.delete(id); remotes.delete(id); if (id !== S.myId) call(o.onPlayer, 'leave', pubP(p)); }
      } else if (m.k === 'pd') { const p = players.get(m.id); if (p) { p.data = m.d; call(o.onPlayer, 'data', pubP(p)); } }
      else if (m.k === 'ev') call(o.onEvent, m.ty, m.d, m.fr || S.hostId);
      else if ((m.k === 'tp' || m.k === 'fix') && Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) { call(o.onTeleport, m.p, m.k); myTp = (myTp + 1) & 255; }
      else if (m.k === 'sync') {
        // мир пришёл целиком: лишнее в сцене (своё, не от хозяина) — убрать
        if (o.cleanStray !== false) for (const ob of scene.all()) if (repl(ob) && !reps.has(ob.id) && scene.get(ob.id)) scene.remove(ob);
        if (!S.ready) { S.ready = true; call(o.onReady); }
      }
      else if (m.k === 'bk' && Array.isArray(m.n)) {
        const keep = new Set(m.n), b = m.b & (NB - 1);
        for (const rp of [...reps.values()]) if (rp.b === b && !keep.has(rp.nid) && !(rp.spe === S.epoch && (rp.sps === m.a || newer(rp.sps, m.a)))) guestDrop(rp);
      }
    }
    // Большие данные: куски по 6000 байт надёжными сообщениями; новичку — после «привет»
    const CHUNK = 6000;
    function sendBlob(L, name){
      const b = blobs.get(name); if (!b) return;
      const total = Math.max(1, Math.ceil(b.u.length / CHUNK));
      for (let i = 0; i < total; i++) { const w = new W(CHUNK + 64); w.str(name); w.vu(b.ver); w.vu(i); w.vu(total); w.bytes(b.u.subarray(i * CHUNK, (i + 1) * CHUNK)); relPush(L, 2, w.out()); }
    }
    function blobPart(u){
      const r = new R(u); let name, ver, i, total;
      try { name = r.str(80); ver = r.vu(); i = r.vu(); total = r.vu(); } catch (e) { return; }
      if (total > 2000 || i >= total) return;
      let x = blobIn.get(name);
      if (!x || x.ver !== ver) blobIn.set(name, x = { ver, total, parts: new Array(total), got: 0 });
      if (x.parts[i]) return;
      x.parts[i] = u.slice(r.n); x.got++;
      if (x.got < x.total) return;
      let len = 0; for (const p of x.parts) len += p.length;
      const all = new Uint8Array(len); let n = 0; for (const p of x.parts) { all.set(p, n); n += p.length; }
      blobIn.delete(name); blobs.set(name, { u: all, ver });
      call(o.onBlob, name, all, () => td.decode(all));
    }
    const pubP = p => ({ id: p.id, slot: p.slot, nick: p.nick, info: p.info, data: p.data, host: p.id === S.hostId, me: p.id === S.myId });

    // ═══ Гость: отправка, молчание хозяина ═══
    function guestSend(L, t){
      const l = tokens(L, t);
      if (L.tok < .999 || L.full || t - L.lastTx < l.gap) return;
      const relDue = L.rel.some(e => e.inf === -1);
      let chDue = false;
      if (my && clock.ok) {
        const since = t - (L.chAt.get(S.myId) || 0), iv = 1000 / l.rate - 5, prev = L.myLast;
        const ch = !prev || myChanged(prev);
        const big = prev && (flagsOf(my) !== flagsOf(prev) || myTp !== L.myTp || Math.hypot((my.vx || 0) - (prev.vx || 0), (my.vy || 0) - (prev.vy || 0), (my.vz || 0) - (prev.vz || 0)) > 3);
        chDue = (ch && since >= iv) || (big && since >= 30) || since >= 1000 || (L.chs.get(S.myId) === undefined && since >= iv) || (L.redund > 0 && since >= iv);
        L.big = big;
      }
      const ackDue = L.owe && t - L.oweAt >= (l.mode === 'p2p' ? 40 : 200);
      if (!(relDue || chDue || ackDue || t - L.lastTx >= 1000)) return;
      const rec = { t, rel: [], ob: [], de: [], ch: [] };
      const first = L.rel.find(e => e.inf === -1);
      let budget = l.mtu; if (first && first.u.length + 300 > budget) budget = Math.min(l.bulk, first.u.length + 400);
      const w = new W(budget + 64);
      header(w, L, false);
      if (chDue || (my && clock.ok && L.myLast && myChanged(L.myLast))) {   // пакет всё равно идёт — свежий снимок с ним
        const c = mySample(now()); w.u8(7); writeChar(w, c); L.chs.set(S.myId, c.t); L.chAt.set(S.myId, t); L.myLast = Object.assign({}, my); L.myTp = myTp; rec.ch.push(S.myId, c.t);
        if (L.big) L.redund = 2; else if (L.redund > 0) L.redund--;   // важное (стоп, прыжок, телепорт) — ещё в двух пакетах
      }
      writeRel(w, L, rec, budget - 8);
      ship(L, w, rec);
    }
    function guestTick(t){
      const L = links.get(S.hostId); if (!L) return;
      lossCheck(L, t);
      if (t - (L.lastRx || L.born) > (L.lastRx ? HOST_TIMEOUT : HOST_TIMEOUT * 2)) { dead.add(S.hostId); S.takeovers = (S.takeovers || 0) + 1; computeHost(); return; }
      guestSend(L, t);
    }

    // ═══ Кто хозяин: самый ранний в комнате (кроме замолчавших); новый хозяин — новая «эпоха» ═══
    function computeHost(){
      const c = members.filter(m => !dead.has(m.id)), hid = c.length ? c[0].id : null;
      if (hid && hid !== S.hostId) setHost(hid);
    }
    function setHost(hid){
      const prev = S.hostId, was = S.isHost;
      const oldL = !was && prev ? links.get(prev) : null;
      S.hostId = hid;
      if (hid === S.myId) becomeHost(prev); else becomeGuest(hid, was, oldL);
    }
    function becomeHost(prev){
      const t = now();
      finishIp();
      S.isHost = true; S.epoch = (S.epoch + 1) & 255; S.migratedAt = prev ? t : 0;
      if (!S.ready) { S.ready = true; call(o.onReady); }
      for (const rp of reps.values()) rp.raw = new Array(NP);
      links.clear(); tomb.clear(); pend.clear(); chars.clear();
      clock.off = 0; clock.ok = true;
      for (const id of [...players.keys()]) if (id !== S.myId && (dead.has(id) || !members.some(m => m.id === id))) { const p = players.get(id); players.delete(id); remotes.delete(id); call(o.onPlayer, 'leave', pubP(p)); }
      const me = ensurePlayer(S.myId); me.nick = me.nick || String(o.nick || 'Игрок').slice(0, 24); me.info = me.info || o.info || null;
      for (const m of members) if (m.id !== S.myId && !dead.has(m.id)) addGuest(m.id, !!prev);
      plDirty = true; scanAll = true;
      call(o.onHost, true, { epoch: S.epoch, prev, migrated: !!prev });
    }
    function becomeGuest(hid, wasHost, oldL){
      S.isHost = false;
      if (wasHost) { for (const rp of reps.values()) { rp.se = -1; } chars.clear(); }
      links.clear();
      const L = mkLink(hid); links.set(hid, L);
      clock.ok = false; clock.smp = [];
      relJson(L, { k: 'hi', nick: String(o.nick || 'Игрок').slice(0, 24), info: o.info || null });
      if (oldL) for (const e of oldL.rel) if (!e.done && e.kind === 1) { try { const m = JSON.parse(td.decode(e.u)); if (m.k === 'ev') relJson(L, m); } catch (er) {} }   // события не теряются
      call(o.onHost, false, { hostId: hid, epoch: S.epoch });
    }
    function newEpoch(ep){ if (ep !== S.epoch) { S.epoch = ep; tomb.clear(); } }
    // Перехват хозяйства: только от следующего по очереди и только когда прежний хозяин ушёл или молчит — иначе любой
    // мог бы объявить себя хозяином. Сам хозяин уступает, только если гости его давно не слышат (его отрезало) или
    // тот же «номер» у старшего (оба решили, что хозяева, пока не увидели друг друга)
    const successor = () => { const c = members.filter(m => !dead.has(m.id) && m.id !== S.hostId); return c.length ? c[0].id : null; };
    function hostGone(){
      if (!S.hostId || dead.has(S.hostId) || !members.some(m => m.id === S.hostId)) return true;
      const L = links.get(S.hostId); return !!L && now() - (L.lastRx || L.born) > HOST_TIMEOUT / 2;
    }
    function acceptHost(from, ep){
      if (from === S.hostId) { if (epNewer(ep, S.epoch)) newEpoch(ep); else if (ep !== S.epoch) return false; return true; }
      if (!epNewer(ep, S.epoch) || !hostGone() || from !== successor()) return false;
      for (const m of members) { if (m.id === from) break; dead.add(m.id); }   // все, кто раньше, выбыли
      setHost(from); newEpoch(ep);
      return true;
    }
    function yieldTo(from, ep){
      const iMe = members.findIndex(m => m.id === S.myId), iHe = members.findIndex(m => m.id === from);
      if (iHe < 0) return false;
      let quiet = true; for (const L of links.values()) if (L.lastRx && now() - L.lastRx < HOST_TIMEOUT) { quiet = false; break; }
      if (!((epNewer(ep, S.epoch) && quiet) || (ep === S.epoch && iHe < iMe))) return false;
      for (const m of members) { if (m.id === from) break; dead.add(m.id); }
      setHost(from); newEpoch(ep);
      return true;
    }
    function onMembers(list){
      const before = new Set(members.map(m => m.id));
      members = (list || []).filter(m => m && typeof m.id === 'string').map(m => ({ id: m.id, t: +m.t || 0 })).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
      const ids = new Set(members.map(m => m.id));
      for (const id of [...dead]) if (!ids.has(id)) dead.delete(id);
      for (const id of before) if (!ids.has(id)) {
        if (S.isHost) { links.delete(id); chars.delete(id); }
        const p = players.get(id);
        if (p) { players.delete(id); if (S.isHost) plDirty = true; call(o.onPlayer, 'leave', pubP(p)); }
        remotes.delete(id);
      }
      if (S.isHost) for (const m of members) if (m.id !== S.myId && !links.has(m.id) && !dead.has(m.id)) addGuest(m.id, false);
      if (ids.has(S.myId)) computeHost();
    }
    // ═══ Наружу ═══
    S.tick = dt => {
      if (S.closed) return;
      const t = now();
      if (S.isHost) hostTick(t); else { guestTick(t); stepObjects(t); }
      for (const rc of remotes.values()) { const ps = stepRemote(rc, t, dt || 1 / 60, posOfNid, GRAV); if (ps && o.onCharacter && players.has(rc.id)) call(o.onCharacter, rc.id, ps, rc); }
      if (tr.flush) tr.flush();
    };
    S.setMyCharacter = st => {
      if (!st) { my = null; return; }
      my = { x: +st.x || 0, y: +st.y || 0, z: +st.z || 0, yaw: +st.yaw || 0, vx: +st.vx || 0, vy: +st.vy || 0, vz: +st.vz || 0, moving: !!st.moving, speed: +st.speed || 0, air: !!st.air,
        crouch: +st.crouch || 0, sit: !!st.sit, seatY: st.seatY ?? null, roll: st.roll ?? -1, rollBack: !!st.rollBack, hang: !!st.hang, ladder: !!st.ladder, climbPh: +st.climbPh || 0,
        pk: st.pk || '', pkK: +st.pkK || 0, on: typeof st.on === 'string' ? st.on : null };
    };
    S.teleported = () => { myTp = (myTp + 1) & 255; };
    // rt — какой момент показываем (по часам владельца), buffer — запас сверх самого быстрого пути, мс
    S.remotes = () => { const out = []; for (const rc of remotes.values()) { const p = players.get(rc.id); if (rc.pose && p && rc.id !== S.myId) out.push({ id: rc.id, slot: p.slot, nick: p.nick, info: p.info, pose: rc.pose, rt: rc.rtPrev, buffer: rc.delay - rc.minL, extrapolating: !!rc.ex }); } return out; };
    S.players = () => [...players.values()].map(pubP);
    S.latest = id => (S.isHost ? chars.get(id) : null) || null;
    S.markDirty = obj => { if (obj && S.isHost) dirtyNow.add(obj); };
    S.sendEvent = (type, data, to = 'host') => {
      const m = { k: 'ev', ty: String(type).slice(0, 40), d: data === undefined ? null : data, to };
      if (JSON.stringify(m).length > 8000) return false;
      if (!S.isHost) { const L = links.get(S.hostId); if (!L) return false; relJson(L, m); return true; }
      if (to === S.myId || to === 'host') { call(o.onGuestEvent || o.onEvent, m.ty, m.d, S.myId); return true; }
      for (const L of links.values()) if (to === 'all' || to === L.id) relJson(L, { k: 'ev', ty: m.ty, d: m.d, fr: S.myId });
      return true;
    };
    S.teleport = (id, p) => {
      if (!S.isHost || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return;
      if (id === S.myId) { call(o.onTeleport, p.slice(), 'tp'); myTp = (myTp + 1) & 255; return; }
      const pl = players.get(id), L = links.get(id); if (!pl || !L) return;
      pl.expect = p.slice(); relJson(L, { k: 'tp', p: p.slice() });
    };
    S.setLimits = (id, l) => { const p = players.get(id); if (p) p.lim = Object.assign({}, p.lim, l); };
    S.setPlayerData = (id, d) => { if (!S.isHost) return; const p = players.get(id); if (!p) return; p.data = d; for (const L of links.values()) relJson(L, { k: 'pd', id, d }); };
    S.playerData = id => players.get(id)?.data ?? null;
    S.setBlob = (name, data) => {
      if (!S.isHost) return;
      const u = typeof data === 'string' ? te.encode(data) : new Uint8Array(data), old = blobs.get(name);
      blobs.set(name, { u, ver: old ? old.ver + 1 : 1 });
      for (const L of links.values()) if (players.get(L.id)?.nick) sendBlob(L, name);
    };
    S.blob = name => blobs.get(name)?.u || null;
    S.hostNow = hostNow;
    S.stats = () => {
      const t = now(), out = [];
      for (const L of links.values()) {
        const s = L.st, dt = Math.max(.001, (t - s.t0) / 1000);
        out.push({ id: L.id, mode: lim(L.id).mode, rtt: Math.round(L.rtt), loss: s.lost / Math.max(1, s.lost + s.acked), txPs: s.txP / dt, txBs: s.txB / dt, rxPs: s.rxP / dt, rxBs: s.rxB / dt, inflight: L.sent.size, rel: L.rel.length });
      }
      return out;
    };
    S.clockOffset = () => clock.off;
    S.close = () => { if (S.closed) return; S.closed = true; for (const f of Object.keys(orig)) scene[f] = orig[f]; try { tr.close && tr.close(); } catch (e) {} };
    S._dbg = { reps, byNid, links, players, remotes, chars, clock, members: () => members, dead, ipActive, newRep };
    tr.listen({ message: onPacket, members: onMembers });
    return S;
  }
  E.net = Object.assign(E.net || {}, { session, _t: { W, R, PROPS, quant, unq, writeQ, readQ, writeChar, readChar, hashRep, bucketOf, newer, evalRemote, pushRemote, stepRemote, mkRemote, LIM } });
})();
