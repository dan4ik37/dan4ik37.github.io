// scripts/d37core-golden/harness.cjs — the golden replay of the shared core d37-core, COPIED VERBATIM from the core's own test
// (M:\d37\d37-core js/test.mjs at tag drop/c1b = 2c22de5: lines 15-48 = hashLines, lines 165-501 = the C-001 contact / world replay,
// CmdGen, soak, fpsRun, replay). Do not edit here: a new drop brings a new copy (scripts/core-world-test.cjs checks the drop).
// Used by scripts/core-world-test.cjs (C-002): the same replay runs through the site API js/engine/core-world.js on wasm and on
// the JS fallback, and every line must equal scripts/d37core-golden/{hash,contact,world}.txt.
'use strict';
module.exports = function (D37Core, goldenContact, goldenWorld) {
  const J = D37Core.js;
  function hashLines(api) {
    const out = [];
    const fixed = [[0, 0, 0, 0, 0], [1, 2, 3, 4, 5], [0xFFFFFFFF, -1, -1, -1, 0xFFFFFFFF], [37, 100, -100, 7, 3], [0x9E3779B9, -2147483648, 2147483647, 0, 1], [12345, -7, 0, 65536, 0xD37D]];
    for (const [s, x, y, z, k] of fixed) out.push(`h32 ${s} ${x} ${y} ${z} ${k} ${api.h32(s, x, y, z, k)}`);
    let st = D37Core.js.smSeed(12345);
    const u32 = () => { const r = D37Core.js.smNext(st); st = r.state; return Number(r.value >> 32n); };
    for (let i = 0; i < 200; i++) {
      const s = u32(), x = u32() | 0, y = u32() | 0, z = u32() | 0, k = u32();
      out.push(`h32 ${s} ${x} ${y} ${z} ${k} ${api.h32(s, x, y, z, k)}`);
    }
    for (const seed of [0, 1, 37, 0xFFFFFFFF, 12345]) {
      const s0 = api.smSeed(seed);
      out.push(`smseed ${seed} ${hex(s0)}`);
      const f = api.smFill(s0, 8);
      out.push(`sm ${seed} ` + Array.from(f.values, hex).join(' '));
    }
    for (const [seed, n] of [[1, 10], [2, 1000], [3, 1], [4, 0xFFFFFFFF], [5, 0]]) {
      let s = api.smSeed(seed); const v = [];
      for (let i = 0; i < 10; i++) { const r = api.smBelow(s, n); v.push(r.value); s = r.state; }
      out.push(`below ${seed} ${n} ${v.join(' ')}`);
    }
    const vals = [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 255n, 256n, 65535n, 65536n, 1n << 32n, (1n << 64n) - 1n, (1n << 64n) - 2n, 1n << 63n];
    let s7 = D37Core.js.smSeed(777);
    for (let i = 0; i < 40; i++) {
      const a = D37Core.js.smNext(s7); s7 = a.state;
      const b = D37Core.js.smNext(s7); s7 = b.state;
      const sh = (b.value >> 32n) * 64n >> 32n;
      vals.push(a.value >> sh);
    }
    for (const v of vals) out.push(`isqrt ${v} ${api.isqrt64(v)}`);
    let d = 0; [1, 2, 3].forEach((v, i) => { d = api.digest(d, i, v); }); out.push(`digest ${d}`);
    d = 5; [0, 255, 7].forEach((v, i) => { d = api.digest(d, i, v); }); out.push(`digest8 ${d}`);
    return out;
  }
  function Rng(seed) { this.st = J.smState(seed >>> 0); }
  Rng.prototype.u32 = function () { J.smStep(this.st); return this.st[3]; };
  Rng.prototype.below = function (n) { return J.smBelowS(this.st, n >>> 0); };
  const u = x => x >>> 0;
  const r2 = (r, n) => r.below(n);
  const wiTmp = new Int32Array(15);
  // ContactIn words <-> the 26 golden fields
  function fmtIn(w) {
    return [u(w[0]), u(w[1]), u(w[2]), u(w[3]), u(w[4]), u(w[5]), w[6] | 0, w[7] | 0, u(w[8]), u(w[9]), w[10] & 0xFFFF, w[10] >>> 16, w[11] & 0xFFFF, w[11] >>> 16,
      w[12] & 255, (w[12] >>> 8) & 255, (w[12] >>> 16) & 255, w[12] >>> 24, w[13] & 255, (w[13] >>> 8) & 255, (w[13] >>> 16) & 255, w[13] >>> 24,
      w[14] & 255, (w[14] >>> 8) & 255, (w[14] >>> 16) & 255, w[14] >>> 24].join(' ');
  }
  function packIn(f, w) {
    for (let k = 0; k < 10; k++) w[k] = f[k];
    w[10] = f[10] | (f[11] << 16); w[11] = f[12] | (f[13] << 16);
    w[12] = f[14] | (f[15] << 8) | (f[16] << 16) | (f[17] << 24); w[13] = f[18] | (f[19] << 8) | (f[20] << 16) | (f[21] << 24);
    w[14] = f[22] | (f[23] << 8) | (f[24] << 16) | (f[25] << 24);
  }
  const outFields = o => [o[0] | 0, o[1] | 0, o[2] & 255, (o[2] >>> 8) & 255, (o[2] >>> 16) & 255, o[2] >>> 24, o[3] & 0xFFFF, o[3] >>> 16, u(o[4]), o[5] & 0xFFFF, o[5] >>> 16, o[6] & 0xFFFF, o[6] >>> 16];
  function randPair(r, w) {
    const f = new Array(26).fill(0);
    f[0] = r.u32(); f[1] = r.below(256); f[2] = r.u32(); f[3] = r.below(256);
    f[14] = r.below(3); f[15] = r.below(4);
    f[20] = f[14] === 2 ? 2 : r.below(6);
    if (f[20] === 5) f[15] = 3;
    f[4] = r.below(16) === 0 ? r.u32() : 2000 + r.below(300000);
    f[5] = r.below(16) === 0 ? r.u32() : 2000 + r.below(600000);
    f[6] = r.below(12000) - 1000; f[7] = r.below(6000) - 2000;
    if (r.below(32) === 0) f[6] = r.u32() | 0;
    f[8] = r.u32(); f[9] = r.u32(); f[10] = r.below(3200); f[11] = r.below(3200);
    f[12] = r.below(2) === 0 ? 0 : 1000 + r.below(8000); f[13] = r.below(2500);
    { const g = r.below(3); f[16] = g | (r.below(4) << 2); }
    { const g = r.below(3); f[17] = g | (r.below(4) << 2); }
    f[18] = r.below(181); f[19] = r.below(181); f[21] = r.below(5);
    f[22] = 16 + r.below(8);
    f[23] = (f[15] === 3 && r.below(2) === 0) ? r.below(8) : 16 + r.below(8);
    f[24] = r.below(8); f[25] = r.below(16);
    if (r.below(50) === 0) {
      const k = r.below(4);
      if (k === 0) f[14] = 3 + r.below(10); else if (k === 1) f[20] = 6 + r.below(10); else if (k === 2) f[18] = 181 + r.below(70); else f[21] = 5 + r.below(9);
    }
    packIn(f, w);
  }
  function contactLines(core) {
    const out = [], wi = new Int32Array(15), wo = new Int32Array(7), blk = new Rng(0xC0010B10);
    const cal = name => { const l = goldenContact.find(x => x.startsWith('cal ' + name + ' ')); const t = l.split(' '); const w = new Int32Array(15); packIn(t.slice(2, 28).map(Number), w); return w; };
    const calAt = k => { const l = goldenContact.filter(x => x.startsWith('cal '))[k]; const w = new Int32Array(15); packIn(l.split(' ').slice(2, 28).map(Number), w); return w; };
    for (const line of goldenContact) {
      const t = line.split(' ');
      if (t[0] === 'tun') out.push(line); // checked against spec/data/contact.csv by the Rust test
      else if (t[0] === 'cal' || t[0] === 'rnd') {
        packIn(t.slice(2, 28).map(Number), wi);
        core.contact(wi, 1, wo);
        out.push(`${t[0]} ${t[1]} ${fmtIn(wi)} -> ${outFields(wo).join(' ')}`);
      } else if (t[0] === 'blk') {
        let d = 0, k = 0, bad = 0;
        for (let j = 0; j < 100; j++) {
          randPair(blk, wi);
          if (core.contact(wi, 1, wo) !== 0) bad++;
          for (const v of outFields(wo)) { d = J.digest(d, k, v); k++; }
        }
        out.push(`blk ${t[1]} ${bad} ${d}`);
      } else if (t[0] === 'rate') {
        const w = cal(t[1]), n = Number(t[2]);
        let da = 0, db = 0;
        for (let tk = 0; tk < n; tk++) { w[8] = tk; core.contact(w, 1, wo); da += (wo[2] >>> 16) & 255; db += wo[2] >>> 24; }
        out.push(`rate ${t[1]} ${n} ${da} ${db}`);
      } else if (t[0] === 'batch') {
        const c0 = calAt(0), c1 = calAt(1), bad = cal('invalid_kind_a');
        const g = new Int32Array(30), b = new Int32Array(45), og = new Int32Array(14), ob = new Int32Array(21);
        g.set(c0, 0); g.set(c1, 15); b.set(c0, 0); b.set(bad, 15); b.set(c1, 30);
        const cg = core.contact(g, 2, og), cb = core.contact(b, 3, ob);
        out.push(`batch ${cg} ${cb} ${outFields(ob.subarray(7, 14)).join(' ')} ${outFields(ob.subarray(14, 21)).join(' ')}`);
      } else out.push('unknown ' + line);
    }
    return out;
  }

  // ---- the shared command generator (golden_world.rs CmdGen): writes 13 cmd words; after each apply note() every command
  // with its result (in order), as the Rust / C# generators
  function CmdGen(rngSeed, scen, seedLo, seedHi, gv, actors) {
    this.r = new Rng(rngSeed); this.pool = new Uint32Array(96); this.pver = new Uint32Array(48); this.npool = 0; this.pv = 0; this.nextIndex = 0; this.scen = scen;
    this.seedLo = seedLo >>> 0; this.seedHi = seedHi >>> 0; this.gv = gv; this.sent = new Int32Array(32 * 13); this.nsent = 0; this.cnt = 0; this.actors = actors;
    this.id = new Uint32Array(2);
  }
  CmdGen.prototype.add = function (lo, hi, ver) {
    let k;
    if (this.npool < 48) { k = this.npool; this.npool++; } else k = this.r.below(48);
    this.pool[2 * k] = lo; this.pool[2 * k + 1] = hi; this.pver[k] = ver;
  };
  /** feedback: the command at o[b..b + 13] with its result at res[rb..rb + 4] */
  CmdGen.prototype.note = function (o, b, res, rb) {
    const op = o[b + 5] & 0xFFFF;
    if (res[rb] !== 0 || op === 7) return;
    const lo = o[b + 3] >>> 0, hi = o[b + 4] >>> 0;
    let k = -1;
    for (let i = 0; i < this.npool; i++) if (this.pool[2 * i] === lo && this.pool[2 * i + 1] === hi) { k = i; break; }
    if (op === 1 && k < 0) this.add(lo, hi, res[rb + 1] >>> 0);
    else if (op === 2) {
      if (k >= 0) { this.npool--; const m = this.npool; this.pool[2 * k] = this.pool[2 * m]; this.pool[2 * k + 1] = this.pool[2 * m + 1]; this.pver[k] = this.pver[m]; }
    } else if (k >= 0) this.pver[k] = res[rb + 1] >>> 0;
  };
  CmdGen.prototype.noteAll = function (o, n, res) { for (let k = 0; k < n; k++) this.note(o, k * 13, res, k * 4); };
  CmdGen.prototype.pick = function () {
    if (this.npool === 0 || this.r.below(12) === 0) { this.id[0] = this.r.u32(); this.id[1] = this.r.u32(); this.pv = 0; }
    else { const k = this.r.below(this.npool); this.id[0] = this.pool[2 * k]; this.id[1] = this.pool[2 * k + 1]; this.pv = this.pver[k]; }
    return this.id;
  };
  CmdGen.prototype.dist = function () { const k = this.r.below(40); return k === 0 ? -1 : k < 5 ? 3000 + this.r.below(1000) : this.r.below(2500); };
  CmdGen.prototype.next = function (o, b) {
    const r = this.r;
    if (this.nsent > 0 && r.below(100) < 8) { const k = r.below(this.nsent); for (let z = 0; z < 13; z++) o[b + z] = this.sent[k * 13 + z]; return; }
    this.cnt++;
    for (let z = 0; z < 13; z++) o[b + z] = 0;
    o[b] = this.cnt; o[b + 1] = (0xC0010000 | this.scen) | 0;
    const k = r.below(100);
    const op = k < 14 ? 1 : k < 26 ? 2 : k < 46 ? 3 : k < 60 ? 4 : k < 76 ? 5 : k < 90 ? 6 : k < 98 ? 7 : 8 + r.below(50);
    o[b + 5] = op;
    o[b + 2] = op === 7 ? (r.below(5) === 0 ? 1 : 0) : r.below(Math.min(this.actors, 6));
    if (op === 1) {
      if (this.npool > 0 && r.below(10) === 0) { const id = this.pick(); o[b + 3] = id[0]; o[b + 4] = id[1]; }
      else {
        const rx = r.below(64) - 32, rz = r.below(64) - 32;
        J.worldId(this.seedLo, this.seedHi, this.gv, rx, 0, rz, this.nextIndex, this.id);
        this.nextIndex++;
        o[b + 3] = this.id[0]; o[b + 4] = this.id[1];
      }
    } else if (op !== 7) { const id = this.pick(); o[b + 3] = id[0]; o[b + 4] = id[1]; }
    const tv = this.pv;
    const p = b + 7;
    if (op === 1) {
      const kind = 1 + r.below(20), owner = r.below(40) === 0 ? 2 : r.below(8) === 0 ? 1 : 0, ck = r.below(4);
      const surf = ck === 2 ? 16 + r.below(8) : ck === 3 ? (r.below(2) === 0 ? r.below(8) : 16 + r.below(8)) : r.below(256);
      o[p] = kind | (owner << 16) | (ck << 20) | (surf << 24);
      o[p + 1] = r.below(10);
      o[p + 2] = r.below(3) === 0 ? 0 : o[p + 1] + r.below(10);
      o[p + 3] = r.below(4);
      const hp = r.below(3200), brk = r.below(2) === 0 ? 0 : 2000 + r.below(6000);
      o[p + 4] = hp | (brk << 16);
      o[p + 5] = 1000 + r.below(200000);
    } else if (op === 2) o[p + 5] = this.dist();
    else if (op === 3 || op === 4) {
      o[p] = r.below(20) === 0 ? 0 : 1 + r.below(3);
      if (r.below(2) === 1) { const id = this.pick(); o[p + 1] = id[0]; o[p + 2] = id[1]; }
      o[p + 5] = this.dist();
    } else if (op === 5) {
      o[p] = 1000 + r.below(150000); o[p + 1] = r.below(9000);
      const mv = r.below(20) === 0 ? 4 : r.below(4), area = r.below(5), pa0 = r.below(3), pa = pa0 | (r.below(4) << 2), fl = r.below(16);
      o[p + 2] = mv | (area << 8) | (pa << 16) | (fl << 24);
      o[p + 3] = r.below(3000);
      const pb0 = r.below(3), pb = pb0 | (r.below(4) << 2), fa = r.below(181), fb = r.below(181);
      o[p + 4] = pb | (fa << 8) | (fb << 16);
      o[p + 5] = this.dist();
    } else if (op === 6) {
      o[p] = r.below(5); o[p + 1] = r.below(2) === 0 ? -1 : r.below(4); o[p + 5] = this.dist();
    } else if (op === 7) {
      o[p] = 1 + r.below(6); o[p + 1] = r.below(8) === 0 ? 0 : 1;
      if (r.below(2) === 0) { const id = this.pick(); o[p + 2] = id[0]; o[p + 3] = id[1]; }
    }
    if (op !== 1 && op !== 7 && r.below(6) === 0) o[b + 6] = r.below(2) === 0 ? tv : r.below(4);
    const s = ((this.cnt - 1) & 31) * 13;
    for (let z = 0; z < 13; z++) this.sent[s + z] = o[b + z];
    if (this.nsent < 32) this.nsent++;
  };
  const MASK64 = (1n << 64n) - 1n;
  const big = h => (BigInt(h[1] >>> 0) << 32n) | BigInt(h[0] >>> 0);
  const fold64 = (h, v) => {
    let z = ((h ^ v) + 0x9E3779B97F4A7C15n) & MASK64;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
    return z ^ (z >> 31n);
  };
  const hex = v => v.toString(16).padStart(16, '0');
  const desc = (seedLo, seedHi, gv, mo, ec, cr, ma, reach) => Int32Array.from([seedLo, seedHi, gv, mo, ec, cr, ma, reach, 0, 0]);
  function soak(core, seed, ticks, pt) {
    const w = core.createWorld(desc(seed, 0, 1, 512, 256, 4096, 8, 0)).world;
    const g = new CmdGen(seed, 9, seed, 0, 1, 8);
    const cmds = new Int32Array(Math.max(pt, 4) * 13), res = new Int32Array(Math.max(pt, 4) * 4), ev = new Int32Array(256 * 13), dr = new Int32Array(1024 * 4), h = new Uint32Array(2);
    for (let a = 1; a < 5; a++) { const b = (a - 1) * 13; cmds[b] = a; cmds[b + 1] = 0x50AC; cmds[b + 5] = 7; cmds[b + 7] = a; cmds[b + 8] = 1; }
    w.apply(cmds, 4, res);
    let n = 0, ok = 0, ovf = 0, minutes = 0n;
    for (let t = 0; t < ticks; t++) {
      for (let j = 0; j < pt; j++) g.next(cmds, j * 13);
      w.apply(cmds, pt, res);
      g.noteAll(cmds, pt, res);
      for (let j = 0; j < pt; j++) { n++; if (res[j * 4] === 0) ok++; }
      if (w.events(ev, 256) === -8) ovf++;
      w.dirty(dr, 1024);
      w.step(1);
      if ((t + 1) % 1200 === 0) { w.hash(h); minutes = fold64(minutes, big(h)); }
    }
    w.hash(h);
    w.destroy();
    return [big(h), minutes, n, ok, ovf];
  }
  function fpsRun(core, fps, ticks, seed) {
    const w = core.createWorld(desc(seed, 0, 1, 256, 512, 0, 8, 0)).world;
    const g = new CmdGen(seed, 3, seed, 0, 1, 8), rt = new Rng((seed ^ 0x5EED) >>> 0);
    const next = new Int32Array(13), batch = new Int32Array(64 * 13), res = new Int32Array(64 * 4), ev = new Int32Array(512 * 13), h = new Uint32Array(2);
    let nextT = 0, acc = 0, tick = 0;
    g.next(next, 0);
    const frameUs = Math.trunc(1000000 / fps);
    while (tick < ticks) {
      acc += frameUs;
      while (acc >= 50000 && tick < ticks) {
        acc -= 50000;
        const end = (tick + 1) * 50;
        let nb = 0;
        while (nextT < end && nb < 64) { batch.set(next, nb * 13); nb++; nextT += rt.below(120); g.next(next, 0); }
        w.apply(batch, nb, res);
        g.noteAll(batch, nb, res);
        w.events(ev, 512);
        w.step(1);
        tick++;
      }
    }
    w.hash(h);
    w.destroy();
    return big(h);
  }
  function replay(core, seed, n) {
    const a = core.createWorld(desc(seed, 0, 1, 512, 0, 0, 8, 0)).world, b = core.createWorld(desc(seed, 0, 1, 512, 0, 0, 8, 0)).world;
    const g = new CmdGen(seed, 5, seed, 0, 1, 8), cmds = new Int32Array(n * 13);
    const rw = core.createWorld(desc(seed, 0, 1, 512, 0, 0, 8, 0)).world, r1 = new Int32Array(4); // feeds the generator one by one
    for (let i = 0; i < n; i++) { g.next(cmds, i * 13); rw.apply(cmds.subarray(i * 13, i * 13 + 13), 1, r1); g.note(cmds, i * 13, r1, 0); }
    rw.destroy();
    const res = new Int32Array(64 * 4), ev = new Int32Array(4096 * 13), ha = new Uint32Array(2), hb = new Uint32Array(2);
    let i = 0, k = 1;
    while (i < n) { const e = Math.min(i + k, n); a.apply(cmds.subarray(i * 13, e * 13), e - i, res); a.events(ev, 4096); i = e; k = k % 7 + 1; }
    for (let s = 0; s < n; s += 64) { const c = Math.min(64, n - s); b.apply(cmds.subarray(s * 13, (s + c) * 13), c, res); b.events(ev, 4096); }
    a.hash(ha); b.hash(hb); a.destroy(); b.destroy();
    return [big(ha), big(hb)];
  }
  const DIRECTIVES = new Set(['world', 'free', 'cmd', 'apply', 'query', 'events', 'dirty', 'read', 'step', 'hash', 'info', 'snap', 'snapcap', 'restorebad', 'id', 'child', 'soak', 'fps', 'replay']);
  function worldLines(core) {
    const out = [], worlds = [], pending = [];
    for (let i = 0; i < 10; i++) pending.push([]);
    const h2 = new Uint32Array(2);
    const dig8 = (b, n) => { let d = 0; for (let i = 0; i < n; i++) d = J.digest(d, i, b[i]); return d; };
    for (const line of goldenWorld) {
      const t = line.split(' ');
      if (!DIRECTIVES.has(t[0])) continue;
      out.push(line);
      const N = k => Number(t[k]);
      const w = worlds[N(1)];
      switch (t[0]) {
        case 'world': {
          if (worlds[N(1)]) worlds[N(1)].destroy();
          const r = core.createWorld(desc(N(2), N(3), N(4), N(5), N(6), N(7), N(8), N(9)));
          worlds[N(1)] = r.world;
          out.push(`= ${r.code}`);
          break;
        }
        case 'free': if (w) w.destroy(); worlds[N(1)] = null; break;
        case 'cmd': {
          const c = new Int32Array(13);
          c[0] = N(2); c[1] = N(3); c[2] = N(4); c[3] = N(5); c[4] = N(6); c[5] = N(7) | (N(8) << 16); c[6] = N(9);
          for (let k = 0; k < 6; k++) c[7 + k] = N(10 + k);
          pending[N(1)].push(c);
          break;
        }
        case 'apply': {
          const list = pending[N(1)]; pending[N(1)] = [];
          const cmds = new Int32Array(list.length * 13), res = new Int32Array(list.length * 4);
          list.forEach((c, k) => cmds.set(c, k * 13));
          w.apply(cmds, list.length, res);
          for (let k = 0; k < list.length; k++) out.push(`r ${res[k * 4]} ${u(res[k * 4 + 1])} ${u(res[k * 4 + 2])} ${u(res[k * 4 + 3])}`);
          break;
        }
        case 'query': {
          const q = new Int32Array(10), o = new Int32Array(2);
          q[0] = N(2); q[1] = N(3); q[2] = N(4); q[3] = N(5) | (N(6) << 16);
          for (let k = 0; k < 6; k++) q[4 + k] = N(7 + k);
          w.query(q, 1, o);
          out.push(`q ${o[0]} ${o[1] & 0xFFFF}`);
          break;
        }
        case 'events': {
          const cap = N(2), b = new Int32Array(cap * 13 + 1);
          const code = w.events(b, cap), n = w.count;
          out.push(`= ${code} ${n}`);
          for (let k = 0; k < n; k++) {
            const e = b.subarray(k * 13, k * 13 + 13);
            out.push(`e ${e[0] & 0xFFFF} ${e[0] >>> 16} ${u(e[1])} ${u(e[2])} ${u(e[3])} ${u(e[4])} ${u(e[5])} ${u(e[6])} ${u(e[7])} ${u(e[8])} ${e[9]} ${e[10]} ${e[11]} ${e[12]}`);
          }
          break;
        }
        case 'dirty': {
          const cap = N(2), b = new Int32Array(cap * 4 + 1);
          const code = w.dirty(b, cap), n = w.count;
          out.push(`= ${code} ${n}`);
          for (let k = 0; k < n; k++) out.push(`d ${b[k * 4] & 0xFFFF} ${u(b[k * 4 + 1])} ${u(b[k * 4 + 2])} ${u(b[k * 4 + 3])}`);
          break;
        }
        case 'read': {
          const o = new Int32Array(12), f = w.read(Int32Array.from([N(2), N(3)]), 1, o);
          out.push(`o ${u(o[0])} ${u(o[1])} ${u(o[2])} ${u(o[3])} ${o[4] & 0xFFFF} ${(o[4] >>> 16) & 255} ${o[4] >>> 24} ${o[5] & 255} ${(o[5] >>> 8) & 255} ${o[5] >>> 16} ${o[6]} ${o[7]} ${o[8]} ${o[9]} ${o[10]} ${u(o[11])} ${f}`);
          break;
        }
        case 'step': w.step(N(2)); break;
        case 'hash': w.hash(h2); out.push(`h ${hex(big(h2))}`); break;
        case 'info': { const x = new Int32Array(8); w.info(x); out.push('i ' + Array.from(x, u).join(' ')); break; }
        case 'snap': {
          w.snapshot(null);
          const b = new Uint8Array(w.len);
          w.snapshot(b);
          const rc = worlds[N(2)].restore(b, b.length);
          out.push(`s ${b.length} ${dig8(b, b.length)} ${rc}`);
          break;
        }
        case 'snapcap': { const code = w.snapshot(new Uint8Array(N(2))); out.push(`= ${code} ${w.len}`); break; }
        case 'restorebad': {
          const src = worlds[N(2)];
          src.snapshot(null);
          const b = new Uint8Array(src.len);
          src.snapshot(b);
          let len = b.length;
          const r32 = p => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
          const na = r32(36), no = r32(40), kind = N(3);
          if (kind === 0) len--;
          else if (kind === 1) b[0] = 88;
          else if (kind === 2) b[8] ^= 1;
          else if (kind === 3 && no >= 2) { const p = 48 + na * 12; b.copyWithin(p + 44, p, p + 8); }
          else if (kind >= 5 && kind <= 8) new DataView(b.buffer).setUint32([36, 40, 44, 36][kind - 5], kind === 8 ? 0x15555556 : 0xFFFFFFFF, true);
          out.push(`= ${w.restore(b, len)}`);
          break;
        }
        case 'id': { core.worldId(N(1), N(2), N(3), N(4), N(5), N(6), N(7), h2); out.push(`= ${h2[0]} ${h2[1]}`); break; }
        case 'child': { core.childId(N(1), N(2), N(3), h2); out.push(`= ${h2[0]} ${h2[1]}`); break; }
        case 'soak': { const [h, m, n, ok, ovf] = soak(core, N(1), N(2), N(3)); out.push(`= ${hex(h)} ${hex(m)} ${n} ${ok} ${ovf}`); break; }
        case 'fps': out.push(`= ${hex(fpsRun(core, N(1), N(2), N(3)))}`); break;
        case 'replay': { const [a, b] = replay(core, N(1), N(2)); out.push(`= ${hex(a)} ${hex(b)}`); break; }
      }
    }
    for (const w of worlds) if (w) w.destroy();
    return out;
  }
  return { hashLines, contactLines, worldLines, CmdGen, Rng, randPair, packIn, fmtIn, outFields, desc, big, hex, fold64, soak, fpsRun, replay, wiTmp };
};
