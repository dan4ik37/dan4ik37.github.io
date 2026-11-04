/* d37core.js — loader for d37core.wasm + pure-JS fallback for M0 (h32, splitmix64, isqrt64).
 * Classic script (sets window.D37Core / self.D37Core) or CommonJS (require). No modules, no dependencies.
 *
 *   const core = await D37Core.load('/js/engine/d37core.wasm'); // URL, ArrayBuffer or Uint8Array; never rejects
 *   core.backend            // 'wasm' or 'js' (fallback; core.error says why)
 *   core.h32(seed, x, y, z, k) → uint32
 *   core.smSeed(seed) → BigInt state;  core.smNext(st) → { value, state } (BigInt)
 *   core.smFill(state, n) → { values: BigUint64Array, state }
 *   core.isqrt64(BigInt) → number
 *   hot loops (no BigInt, no garbage; also when BigInt is missing):
 *   st = core.smState(seed) → Uint32Array(4);  core.smStep(st) → value in st[2] lo / st[3] hi;  core.smBelowS(st, n) → [0, n)
 * Bit-exact with Rust / C# (golden/hash.txt). M1/M2 (grid, flow) wasm exports exist but have no JS API yet.
 * ABI 5 (C-001), the same API on both backends (structs = Int32Array words laid out as the C structs, see W below):
 *   core.contact(inWords, n, outWords) → 0 | -3        the contact law (MOVER_COLLISION section 6), 15 -> 7 words per pair
 *   r = core.createWorld(descWords) → { code, world }   world.apply(cmds, n, res) / query(q, n, out) / events(out, cap) /
 *     dirty(out, cap) (count in world.count) / read(ids, n, out) / step(ticks) / info(out) / hash(out2) / snapshot(u8)
 *     (length in world.len) / restore(u8, len) / destroy()
 *   core.worldId(seedLo, seedHi, genVersion, rx, ry, rz, index, out2), core.childId(lo, hi, cut, out2); core.W, core.C
 * (word counts, constants). Bit-exact with golden/world.txt and golden/contact.txt (js/test.mjs). A wasm trap never throws
 * out of a world call: it returns -100 (E_PANIC) and that world is dead (world.dead, world.error); make a new one.
 * The file has no BigInt literals: an engine without BigInt still parses it and gets the fallback (smSeed / smNext /
 * smFill / smBelow / isqrt64 then throw; h32, the smState API, contact and the world work).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D37Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // a wasm with another ABI -> JS fallback. 5: world command/event core + contact law (C-001, 2026-11-05); 4: barrier
  // classes, mover profiles with priors, belief groups, FlowParams 48 bytes (2026-10-29); 3: one-way and crawl links
  var ABI = 5;
  var P2 = 0x85EBCA77 | 0, P3 = 0xC2B2AE3D | 0, P4 = 0x27D4EB2F | 0, P5 = 0x165667B1;
  // No BigInt literals anywhere in this file: they are a parse error in engines without BigInt, and then the
  // "no BigInt -> JS fallback" path could never run. BigInt constants are made on first use.
  var HAS_BIG = typeof BigInt === 'function';
  var M64, GAMMA, M1, M2, SEED_ADD, B0, B1, B2, B27, B30, B31, B32, B62;
  function big() {
    if (M64 !== undefined) return;
    if (!HAS_BIG) throw new Error('BigInt not available: use smState / smStep / smBelowS');
    B0 = BigInt(0); B1 = BigInt(1); B2 = BigInt(2); B27 = BigInt(27); B30 = BigInt(30); B31 = BigInt(31); B32 = BigInt(32); B62 = BigInt(62);
    M64 = (B1 << BigInt(64)) - B1;
    GAMMA = BigInt('0x9E3779B97F4A7C15'); M1 = BigInt('0xBF58476D1CE4E5B9'); M2 = BigInt('0x94D049BB133111EB');
    SEED_ADD = BigInt('0x632BE59BD9B4E019');
  }
  // the same constants as 32-bit halves (lo, hi) for the allocation-free API
  var GL = 0x7F4A7C15, GH = 0x9E3779B9, M1L = 0x1CE4E5B9, M1H = 0xBF58476D, M2L = 0x133111EB, M2H = 0x94D049BB;
  var SAL = 0xD9B4E019, SAH = 0x632BE59B;

  function round(h, v) {
    var t = (h + Math.imul(v, P3)) | 0;
    t = (t << 17) | (t >>> 15);
    return Math.imul(t, P4);
  }
  /** h32(seed, x, y, z, k): own 32-bit hash, same as Rust/C#. Arguments are taken mod 2^32. */
  function h32(seed, x, y, z, k) {
    var h = (seed + P5 + 16) | 0;
    h = round(h, x | 0); h = round(h, y | 0); h = round(h, z | 0); h = round(h, k | 0);
    h ^= h >>> 15; h = Math.imul(h, P2); h ^= h >>> 13; h = Math.imul(h, P3); h ^= h >>> 16;
    return h >>> 0;
  }
  /** h32 as int32 bits (h32i(...) >>> 0 == h32(...)); used where the result must not be boxed */
  function h32i(seed, x, y, z, k) {
    var h = (seed + P5 + 16) | 0;
    h = round(h, x | 0); h = round(h, y | 0); h = round(h, z | 0); h = round(h, k | 0);
    h ^= h >>> 15; h = Math.imul(h, P2); h ^= h >>> 13; h = Math.imul(h, P3); h ^= h >>> 16;
    return h;
  }
  function smSeed(seed) { big(); return (BigInt(seed >>> 0) * GAMMA + SEED_ADD) & M64; }
  function smNext(state) {
    big();
    var s = (state + GAMMA) & M64;
    var z = s;
    z = ((z ^ (z >> B30)) * M1) & M64;
    z = ((z ^ (z >> B27)) * M2) & M64;
    return { value: z ^ (z >> B31), state: s };
  }
  function smFill(state, n) {
    var out = new BigUint64Array(n), s = state;
    for (var i = 0; i < n; i++) { var r = smNext(s); out[i] = r.value; s = r.state; }
    return { values: out, state: s };
  }
  function smBelow(state, n) {
    var r = smNext(state);
    return { value: Number(((r.value >> B32) * BigInt(n >>> 0)) >> B32), state: r.state };
  }
  function isqrt64(v) {
    big();
    v = BigInt.asUintN(64, BigInt(v));
    var op = v, res = B0, one = B1 << B62;
    while (one > op) one >>= B2;
    while (one !== B0) {
      if (op >= res + one) { op -= res + one; res = (res >> B1) + one; } else res >>= B1;
      one >>= B2;
    }
    return Number(res);
  }

  // ---- allocation-free splitmix64 on 32-bit halves (no BigInt; same numbers). State: Uint32Array(4) =
  // [state lo, state hi, last value lo, last value hi]; updated in place, so hot loops allocate nothing.
  // Product scratch is a typed array: a uint32 >= 2^30 stored in a closure variable is boxed (a heap number per
  // store), which made every call allocate.
  var R = new Uint32Array(2);
  function mul32(a, b) { // full 64-bit product of two uint32 → R[0] lo, R[1] hi (16-bit pieces, every term < 2^32)
    var a0 = a & 0xFFFF, a1 = a >>> 16, b0 = b & 0xFFFF, b1 = b >>> 16;
    var m1 = a1 * b0, m2 = a0 * b1;
    var t = ((a0 * b0) >>> 16) + (m1 & 0xFFFF) + (m2 & 0xFFFF);
    R[0] = Math.imul(a, b);
    R[1] = a1 * b1 + (m1 >>> 16) + (m2 >>> 16) + (t >>> 16);
  }
  function mul64(aL, aH, bL, bH) { // (a * b) mod 2^64 → R[0] lo, R[1] hi
    mul32(aL, bL);
    R[1] = R[1] + Math.imul(aH, bL) + Math.imul(aL, bH);
  }
  /** New state for seed (== smSeed(seed) as two halves). */
  function smState(seed) {
    var st = new Uint32Array(4);
    mul64(seed >>> 0, 0, GL, GH);
    st[0] = R[0] + SAL;
    st[1] = R[1] + SAH + (st[0] < R[0] ? 1 : 0);
    return st;
  }
  /** Advance st; the 64-bit value goes to st[2] (lo), st[3] (hi). */
  function smStep(st) {
    var sL = st[0];
    st[0] = sL + GL;
    st[1] = st[1] + GH + (st[0] < sL ? 1 : 0);
    sL = st[0];
    var sH = st[1];
    mul64(sL ^ ((sL >>> 30) | (sH << 2)), sH ^ (sH >>> 30), M1L, M1H);
    var zL = R[0], zH = R[1];
    mul64(zL ^ ((zL >>> 27) | (zH << 5)), zH ^ (zH >>> 27), M2L, M2H);
    zL = R[0]; zH = R[1];
    st[2] = zL ^ ((zL >>> 31) | (zH << 1));
    st[3] = zH ^ (zH >>> 31);
  }
  /** Uniform integer in [0, n) from the next value (same as smBelow / Rust below / C# Below). */
  function smBelowS(st, n) {
    smStep(st);
    mul32(st[3], n >>> 0);
    return R[1];
  }
  function digest(d, i, v) { return h32(d, v | 0, i | 0, 0, 0xD37D); }

  // ================================================================== ABI 5 (C-001): contact law + world command core
  // Bit-exact JS fallback of src/contact.rs and src/world.rs (golden/contact.txt, golden/world.txt). Structs are Int32Array
  // "words" laid out exactly like the C structs (little-endian; u16 / u8 fields packed low to high), so the same buffers go
  // to the wasm build. Words per struct: Cmd 13, CmdResult 4, Query 10, QueryOut 2, Event 13, Dirty 4, ObjState 12,
  // WorldDesc 10, WorldInfo 8, ContactIn 15, ContactOut 7. No BigInt, no allocation per call (scratch typed arrays).
  // Integer math in doubles: every product stays below 2^53 (masses clamped to 50 t, speeds to 30 m/s) and every
  // division truncates (Math.trunc), as Rust / C# integer division.
  var W = { CMD: 13, RES: 4, QUERY: 10, QOUT: 2, EVENT: 13, DIRTY: 4, OBJ: 12, DESC: 10, INFO: 8, CIN: 15, COUT: 7 };
  var C = {
    E_OVERFLOW: -8,
    OP_SPAWN: 1, OP_DESPAWN: 2, OP_TAKE: 3, OP_PUT: 4, OP_HIT: 5, OP_USE: 6, OP_ACTOR: 7,
    EV_SPAWNED: 1, EV_DESPAWNED: 2, EV_STOCK_CHANGED: 3, EV_DAMAGE: 4, EV_STATE_CHANGED: 5, EV_RESYNC_NEEDED: 6, EV_ACTOR: 7,
    DIRTY_CHANGED: 1, DIRTY_GONE: 2, OBJ_BROKEN: 1, OBJ_CRACKED: 2,
    R_OK: 0, R_STALE: 1, R_NO_TARGET: 2, R_NO_ACTOR: 3, R_BAD_OP: 4, R_BAD_PARAMS: 5, R_NOT_ALLOWED: 6, R_EMPTY: 7, R_FULL: 8,
    R_OWNER_LOCKED: 9, R_DUPLICATE_ID: 10, R_OUT_OF_REACH: 11, R_ID_REUSED: 12,
    CK_BODY: 0, CK_PLAYER: 1, CK_PROP: 2, CK_STATIC: 3,
    CM_BUMP: 0, CM_SHOVE: 1, CM_BALLISTIC: 2, CM_RAM: 3, CM_PRESS: 4, CM_BLAST: 5,
    CA_BODY: 0, CA_FLAT: 1, CA_PROP_FACE: 2, CA_EDGE: 3, CA_CORNER: 4, SURF_MAT: 16,
    CF_KIDS: 1, CF_WALL_BACKED: 2, CF_SPRINT: 4, CF_OWN_DMG: 8,
    CO_SOFT: 1, CO_WALL: 2, CO_BROKE: 4, CO_CRACK: 8, CO_CONC_A: 16, CO_CONC_B: 32, CO_KIDS: 64, CO_CAPPED_A: 128, CO_TIP: 256,
    CO_BLOCKED: 512, CO_CRUSH: 1024, CO_PINNED: 2048, CO_WAIT: 4096, CO_SLOW_A: 8192, CO_IMPACT: 16384, CO_BAD: 32768
  };
  var STRUCT_SIZES = [16, 12, 32, 8, 8, 32, 8, 16, 16, 8, 48, 32, 16, 20, 44, 40, 52, 16, 40, 8, 52, 16, 48, 32, 60, 28];

  // ---- contact law (contact.rs)
  var MASS_MAX = 50000000, V_MAX = 30000;
  var PUSH_N = [736, 736, 60, 400, 1500, 4000, 0, 900];
  var HARD_CLASS = [600, 500, 700, 1000, 1000, 1000, 1000, 1000], HARD_MAT = [700, 1000, 500, 300, 700, 300, 800, 1000];
  var AREA = [200, 250, 350, 450, 600];
  var BAR_FLOOR = [150, 100, 40, 400, 1200, -1], BAR_BREAK = [3000, 450, 200, -1, -1, -1], BAR_HP = [140, 120, 30, 600, 1300, 0];
  var BAR_HPJ = [55, 100, 150, 106, 100, 0], BAR_SHOVE = [0, 1000, 1000, 0, 0, 0], BAR_BLAST = [3000, 3000, 4000, 1600, 1200, 0];
  var T = Math.trunc;
  function clampi(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  // large intermediates never cross a call (they would be boxed as heap numbers): X[0] = J (impulse), X[1] = E (energy q4),
  // X[2] = the isqrt input
  var X = new Float64Array(4);
  /** floor(sqrt(X[2])) for 0 <= X[2] < 2^53 (exact). */
  function isqrtX() {
    var v = X[2], r = Math.floor(Math.sqrt(v));
    while (r * r > v) r--;
    while ((r + 1) * (r + 1) <= v) r++;
    return r;
  }
  function energyQ4(m, v) { return v <= 0 ? 0 : T(T(m * v / 1000) * v * 8 / 1000000); }
  function e75Q4(v, hard, area) { return v <= 0 ? 0 : T(T(v * v * 6 * hard / 10000) * area / 1000000); }
  /** J / m (X[0] = J), clamped to [0, 2 V_MAX] */
  function dvOf(m) { return clampi(T(X[0] / m), 0, 2 * V_MAX); }
  /** body damage of E = X[1] */
  function bodyDmgQ4(hard, area) {
    var e = X[1];
    if (e <= 240) return 0;
    X[2] = (e - 240) * 256;
    return T(isqrtX() * 2500 * hard * area / 1000000000);
  }
  /** PropImpact damage of E = X[1] */
  function propDmgQ4() { var e = X[1]; if (e <= 0) return 0; X[2] = e * 256; return T(isqrtX() * 2500 / 4000); }
  function hardOf(code) { return code < 8 ? HARD_CLASS[code] : HARD_MAT[code - 16]; }
  function surfOk(code, allowClass) { return (allowClass && code < 8) || (code >= 16 && code < 24); }
  function brace(posture, facing, m, other) {
    var g = posture & 3, b = g === 0 ? 1500 : g === 1 ? 1200 : 1000;
    if (posture & 4) b = T(b * 1400 / 1000);
    if (facing > 110) b = T(b * 700 / 1000);
    if (posture & 8) b = T(b * 600 / 1000);
    if (other >= 4 * m && b > 1000) b = 1000;
    return b;
  }
  /** per-side reaction speed of J = X[0] */
  function sideS(m, br, uSelf, vc) {
    var me = Math.max(1, T(m * br / 1000));
    var r = clampi(T(uSelf * 1000 / vc), -500, 1000);
    return T(X[0] * 1000 / (me * (1000 + r)));
  }
  function bandOfS(s) { return s >= 3400 ? 3 : s >= 2200 ? 2 : s >= 1000 ? 1 : 0; }
  function pOfS(s) { return s < 3400 ? 0 : clampi(T((s - 3400) * 65536 / 1200), 0, 65536); }
  function bandOfE75(e) { return e >= 6880 ? 3 : e >= 2880 ? 2 : e >= 640 ? 1 : 0; }
  function pOfE75(e) { return e < 6880 ? 0 : clampi(T((e - 6880) * 65536 / 5920), 0, 65536); }
  function stunOfE75(e) { return clampi(500 + T(650 * (e - 2880) / 4000), 500, 1150); }

  // decoded contact input / output (scratch): CI fields in D37ContactIn order, CO in D37ContactOut order
  var I_ALO = 0, I_AHI = 1, I_BLO = 2, I_BHI = 3, I_MA = 4, I_MB = 5, I_UA = 6, I_UB = 7, I_TICK = 8, I_SEED = 9, I_HPA = 10, I_HPB = 11,
    I_BRK = 12, I_HOLD = 13, I_KA = 14, I_KB = 15, I_PA = 16, I_PB = 17, I_FA = 18, I_FB = 19, I_MV = 20, I_AREA = 21, I_SA = 22, I_SB = 23,
    I_MOV = 24, I_FL = 25;
  var O_SA = 0, O_SB = 1, O_BA = 2, O_BB = 3, O_DA = 4, O_DB = 5, O_STA = 6, O_STB = 7, O_E = 8, O_HPA = 9, O_HPB = 10, O_SURF = 11, O_FL = 12;
  var CI = new Float64Array(26), CO = new Float64Array(13);
  // one side being resolved: bandO, pO, bandI, pI, e75 (-1 = no impact), wall, hard; finish results: band, down, stun, conc
  var SD = new Float64Array(7), FR = new Float64Array(4);
  function draw(side, p) {
    if (p >= 65536) return true;
    if (p <= 0) return false;
    var k = (side + (((CI[I_AHI] ^ CI[I_BHI]) & 0x3FFFFFFF) >>> 0) * 4) >>> 0;
    return (h32i(CI[I_SEED] | 0, CI[I_TICK] | 0, CI[I_ALO] | 0, CI[I_BLO] | 0, k | 0) >>> 16) < p;
  }
  function sdReset() { SD[0] = 0; SD[1] = 0; SD[2] = 0; SD[3] = 0; SD[4] = -1; SD[5] = 0; SD[6] = 0; }
  function finish(side, m, playerInit) {
    var band = Math.max(SD[0], SD[2]), p = 0;
    if (band === 3) { if (SD[0] === 3) p = SD[1]; if (SD[2] === 3 && SD[3] > p) p = SD[3]; }
    if (band === 3 && m >= 300000) { band = 2; p = 0; }
    if (playerInit && band >= 1) { CO[O_FL] |= 128; band = 1; p = 0; }
    var d = band === 3 && draw(side, p);
    var impactStun = SD[2] >= 2 ? stunOfE75(SD[4]) : 0, stun;
    if (band === 0) stun = 0;
    else if (band === 1) stun = SD[5] ? 500 : 350;
    else if (band === 2) stun = Math.max(600, impactStun);
    else stun = d ? 1400 : Math.max(600, impactStun);
    var conc = SD[4] >= 0 && band >= 2 && SD[6] >= 1000;
    if (conc) stun += 1400;
    FR[0] = band; FR[1] = d ? 1 : 0; FR[2] = stun; FR[3] = conc ? 1 : 0;
  }
  function sat16(x) { return clampi(x, 0, 65535); }
  function cappedDmg(hard, area, hpmax) {
    var d = bodyDmgQ4(hard, area);
    if (hpmax > 0 && X[1] < 1500 * 16) { var cap = T(hpmax * 700 / 1000); if (d > cap) d = cap; }
    return d;
  }
  function propSide(v, mProp, brk, hpmax) {
    var e = X[1], d = v >= 2200 ? propDmgQ4() : 0;
    if (brk > 0) {
      var eb = energyQ4(mProp, brk);
      if (e >= eb) { CO[O_FL] |= 4; if (hpmax > d) d = hpmax; } else if (e >= T(eb * 250 / 1000)) CO[O_FL] |= 8;
    }
    CO[O_SURF] = sat16(d);
  }
  function barrierSide(cls, mul) {
    if (cls >= 5) return;
    var es = T(X[1] * mul / 1000);
    if (BAR_BREAK[cls] !== -1 && es >= BAR_BREAK[cls] * 16) { CO[O_FL] |= 4; CO[O_SURF] = sat16(BAR_HP[cls] * 16); return; }
    if (BAR_FLOOR[cls] === -1) return;
    var loss = T(Math.max(0, es - BAR_FLOOR[cls] * 16) * BAR_HPJ[cls] / 1000), cap = T(BAR_HP[cls] * 16 * 500 / 1000);
    if (loss > cap) loss = cap;
    CO[O_SURF] = sat16(loss);
  }
  function contactValid() {
    var ka = CI[I_KA], kb = CI[I_KB], mv = CI[I_MV];
    if (ka > 2 || kb > 3 || mv > 5 || CI[I_AREA] > 4) return false;
    if (CI[I_FA] > 180 || CI[I_FB] > 180) return false;
    if (ka !== 2 && (CI[I_PA] & 3) === 3) return false;
    if ((kb === 0 || kb === 1) && (CI[I_PB] & 3) === 3) return false;
    if (ka === 2 && (mv !== 2 || !surfOk(CI[I_SA], false))) return false;
    if (mv === 4 && (ka === 2 || CI[I_MOV] > 7)) return false;
    if (mv === 5 && kb !== 3) return false;
    if (kb === 3 && !surfOk(CI[I_SB], true)) return false;
    if (kb === 2 && !surfOk(CI[I_SB], false)) return false;
    return true;
  }
  /** The contact law on the decoded scratch CI -> CO. Returns false for an invalid pair (CO zero + CO_BAD). */
  function contactCore() {
    for (var z = 0; z < 13; z++) CO[z] = 0;
    if (!contactValid()) { CO[O_FL] = 32768; return false; }
    if (CI[I_FL] & 1) CO[O_FL] |= 64;
    var ma = clampi(CI[I_MA], 1, MASS_MAX), mb = clampi(CI[I_MB], 1, MASS_MAX);
    var ua = clampi(CI[I_UA], -V_MAX, V_MAX), ub = clampi(CI[I_UB], -V_MAX, V_MAX);
    var ka = CI[I_KA], kb = CI[I_KB], mv = CI[I_MV], sb = CI[I_SB], fl = CI[I_FL];
    var bodyA = ka !== 2, bodyB = kb === 0 || kb === 1, playerA = ka === 1, own = (fl & 8) !== 0;
    if (mv === 4) { press(ma, mb, ua, bodyB); return true; }
    if (kb === 3) {
      if (sb < 8) CO[O_FL] |= 2;
      var hard = hardOf(sb), v;
      if (mv === 0) {
        v = T(ua / 2);
        if (v <= 0) { CO[O_FL] |= 1; return true; }
        sdReset(); SD[5] = 1; SD[6] = hard;
        if (v >= 4000) { SD[0] = 3; SD[1] = 65536; } else if (v >= 2000) SD[0] = 1;
        finish(0, ma, playerA);
        CO[O_BA] = FR[0]; CO[O_DA] = FR[1]; CO[O_STA] = sat16(FR[2]);
        if (FR[0] === 1 && !playerA) CO[O_FL] |= 8192;
        return true;
      }
      v = ua;
      if (v <= 0) { CO[O_FL] |= 1; return true; }
      var e = energyQ4(ma, v);
      X[1] = e;
      CO[O_E] = e;
      CO[O_FL] |= 16384;
      if (mv !== 5) {
        sdReset(); SD[5] = 1; SD[6] = hard;
        if (v >= 4000) { SD[0] = 3; SD[1] = 65536; } else if (v >= 2000) SD[0] = 1;
        SD[4] = e75Q4(v, hard, AREA[CI[I_AREA]]);
        SD[2] = bandOfE75(SD[4]); SD[3] = pOfE75(SD[4]);
        finish(0, ma, playerA);
        CO[O_BA] = FR[0]; CO[O_DA] = FR[1]; CO[O_STA] = sat16(FR[2]);
        if (FR[3]) CO[O_FL] |= 16;
        if (FR[0] === 1 && !playerA) CO[O_FL] |= 8192;
        if (FR[0] >= 2 && !own) CO[O_HPA] = sat16(cappedDmg(hard, AREA[CI[I_AREA]], CI[I_HPA]));
      }
      if (!own) {
        if (sb < 8) {
          var mul = mv === 2 ? (sb < 5 ? BAR_SHOVE[sb] : 0) : mv === 5 ? (sb < 5 ? BAR_BLAST[sb] : 0) : 1000;
          barrierSide(sb, mul);
        } else propSide(v, mb, CI[I_BRK], CI[I_HPB]);
      }
      return true;
    }
    var vc = ua + ub;
    if (vc < 500) { CO[O_FL] |= 1; return true; }
    var mu = T(ma * mb / (ma + mb)), shove = mv === 1 ? 1500 : 1000;
    var j = kb === 2 ? T(T(mu * vc * 1200 / 1000) * shove / 1000) : T(mu * vc * shove / 1000);
    var en = energyQ4(mu, vc);
    X[0] = j; X[1] = en;
    CO[O_E] = en;
    var impactB = bodyB && (mv === 1 || mv === 2 || mv === 3), impactA = bodyA && mv === 2, area = AREA[CI[I_AREA]], s, br;
    if (bodyA) {
      br = mv === 1 ? 1500 : brace(CI[I_PA], CI[I_FA], ma, mb);
      s = sideS(ma, br, ua, vc);
      CO[O_SA] = s;
      sdReset(); SD[0] = bandOfS(s); SD[1] = pOfS(s);
      if (impactA) {
        SD[6] = bodyB ? 300 : hardOf(sb);
        SD[4] = e75Q4(dvOf(ma), SD[6], area); SD[2] = bandOfE75(SD[4]); SD[3] = pOfE75(SD[4]);
      }
      finish(0, ma, playerA);
      CO[O_BA] = FR[0]; CO[O_DA] = FR[1]; CO[O_STA] = sat16(FR[2]);
      if (FR[3]) CO[O_FL] |= 16;
      if (impactA && FR[0] >= 2 && !own) CO[O_HPA] = sat16(cappedDmg(SD[6], area, CI[I_HPA]));
      if (impactA || impactB) CO[O_FL] |= 16384;
    } else CO[O_SA] = Math.min(T(X[0] / ma), vc);
    if (bodyB) {
      br = brace(CI[I_PB], CI[I_FB], mb, ma);
      s = sideS(mb, br, ub, vc);
      CO[O_SB] = s;
      sdReset(); SD[0] = bandOfS(s); SD[1] = pOfS(s);
      if (impactB) {
        SD[6] = bodyA ? 300 : hardOf(CI[I_SA]);
        SD[4] = e75Q4(dvOf(mb), SD[6], area); SD[2] = bandOfE75(SD[4]); SD[3] = pOfE75(SD[4]);
        CO[O_FL] |= 16384;
      }
      finish(1, mb, false);
      CO[O_BB] = FR[0]; CO[O_DB] = FR[1]; CO[O_STB] = sat16(FR[2]);
      if (FR[3]) CO[O_FL] |= 32;
      if (impactB && !own && (FR[0] >= 2 || (!bodyA && vc >= 2200))) CO[O_HPB] = sat16(cappedDmg(SD[6], area, CI[I_HPB]));
      if (!bodyA && !own) propSide(vc, ma, CI[I_BRK], CI[I_HPA]);
    } else {
      var dv = Math.min(T(X[0] / mb), T(Math.max(ua, 0) * 1000 / 1000));
      CO[O_SB] = dv;
      if (dv > 3000) CO[O_FL] |= 256;
      if (!own) propSide(vc, mb, CI[I_BRK], CI[I_HPB]);
    }
    return true;
  }
  function press(ma, mb, ua, bodyB) {
    if (ua <= 0) { CO[O_FL] |= 1; return; }
    var hold = CI[I_HOLD], fl = CI[I_FL];
    if (hold < 170) { CO[O_FL] |= 4096; return; }
    var f = PUSH_N[CI[I_MOV]] * 1000;
    if (fl & 4) f = T(f * 1300 / 1000);
    var backed = CI[I_KB] === 3 || (fl & 2) !== 0;
    if (backed || f === 0) {
      CO[O_FL] |= 512;
      if (bodyB && (fl & 2) && f > 0 && hold >= 1500) { CO[O_FL] |= 2048; CO[O_BB] = 2; CO[O_STB] = 600; }
      return;
    }
    var w = T(mb * 981 / 100);
    var h = bodyB ? T(T(w * 600 / 1000) * brace(CI[I_PB], CI[I_FB], mb, ma) / 1000) : T(w * 500 / 1000);
    if (f > h) {
      var vr = T(ua * (f - h) / f);
      CO[O_SA] = vr; CO[O_SB] = vr;
      if (bodyB && f > 2 * h && hold >= 500) { CO[O_FL] |= 1024; CO[O_BB] = 2; CO[O_STB] = 600; }
    } else CO[O_FL] |= 512;
  }
  function decodeIn(a, b) {
    CI[I_ALO] = a[b] >>> 0; CI[I_AHI] = a[b + 1] >>> 0; CI[I_BLO] = a[b + 2] >>> 0; CI[I_BHI] = a[b + 3] >>> 0;
    CI[I_MA] = a[b + 4] >>> 0; CI[I_MB] = a[b + 5] >>> 0; CI[I_UA] = a[b + 6] | 0; CI[I_UB] = a[b + 7] | 0;
    CI[I_TICK] = a[b + 8] >>> 0; CI[I_SEED] = a[b + 9] >>> 0;
    var w = a[b + 10]; CI[I_HPA] = w & 0xFFFF; CI[I_HPB] = (w >>> 16) & 0xFFFF;
    w = a[b + 11]; CI[I_BRK] = w & 0xFFFF; CI[I_HOLD] = (w >>> 16) & 0xFFFF;
    w = a[b + 12]; CI[I_KA] = w & 255; CI[I_KB] = (w >>> 8) & 255; CI[I_PA] = (w >>> 16) & 255; CI[I_PB] = (w >>> 24) & 255;
    w = a[b + 13]; CI[I_FA] = w & 255; CI[I_FB] = (w >>> 8) & 255; CI[I_MV] = (w >>> 16) & 255; CI[I_AREA] = (w >>> 24) & 255;
    w = a[b + 14]; CI[I_SA] = w & 255; CI[I_SB] = (w >>> 8) & 255; CI[I_MOV] = (w >>> 16) & 255; CI[I_FL] = (w >>> 24) & 255;
  }
  function encodeOut(o, b) {
    o[b] = CO[O_SA]; o[b + 1] = CO[O_SB];
    o[b + 2] = CO[O_BA] | (CO[O_BB] << 8) | (CO[O_DA] << 16) | (CO[O_DB] << 24);
    o[b + 3] = CO[O_STA] | (CO[O_STB] << 16);
    o[b + 4] = CO[O_E];
    o[b + 5] = CO[O_HPA] | (CO[O_HPB] << 16);
    o[b + 6] = CO[O_SURF] | (CO[O_FL] << 16);
  }
  /** d37_ix_contact: n pairs (Int32Array, 15 words each) -> out (Int32Array, 7 words each). 0, or -3 if a pair was invalid. */
  function contact(input, n, out) {
    var bad = false;
    for (var k = 0; k < n; k++) {
      decodeIn(input, k * 15);
      if (!contactCore()) bad = true;
      encodeOut(out, k * 7);
    }
    return bad ? -3 : 0;
  }

  // ---- 64-bit helpers. Rule for the whole ABI 5 fallback (no garbage): a value that may leave the small-integer range
  // (ids, versions, seeds, hashes) never crosses a function call as an argument or a return value - it travels in typed
  // array scratch (K key, E event, F / FV fold) and lives in Int32Array storage; unsigned order is computed in locals.
  var F = new Int32Array(2), FV = new Int32Array(2), K = new Int32Array(2), E = new Int32Array(13), RV = new Int32Array(4);
  /** F = fold(F, FV) (world.rs fold): z = (F ^ FV) + GAMMA, splitmix64 finalizer; 64-bit products inline. */
  function foldv() {
    var zL = (F[0] ^ FV[0]) >>> 0, zH = (F[1] ^ FV[1]) >>> 0;
    var s = zL + GL;
    zL = s >>> 0; zH = (zH + GH + (s > 0xFFFFFFFF ? 1 : 0)) >>> 0;
    var aL = (zL ^ ((zL >>> 30) | (zH << 2))) >>> 0, aH = (zH ^ (zH >>> 30)) >>> 0;
    var a0 = aL & 0xFFFF, a1 = aL >>> 16, m1 = a1 * (M1L & 0xFFFF), m2 = a0 * (M1L >>> 16);
    var t = ((a0 * (M1L & 0xFFFF)) >>> 16) + (m1 & 0xFFFF) + (m2 & 0xFFFF);
    zL = Math.imul(aL, M1L) >>> 0;
    zH = (a1 * (M1L >>> 16) + (m1 >>> 16) + (m2 >>> 16) + (t >>> 16) + Math.imul(aH, M1L) + Math.imul(aL, M1H)) >>> 0;
    aL = (zL ^ ((zL >>> 27) | (zH << 5))) >>> 0; aH = (zH ^ (zH >>> 27)) >>> 0;
    a0 = aL & 0xFFFF; a1 = aL >>> 16; m1 = a1 * (M2L & 0xFFFF); m2 = a0 * (M2L >>> 16);
    t = ((a0 * (M2L & 0xFFFF)) >>> 16) + (m1 & 0xFFFF) + (m2 & 0xFFFF);
    zL = Math.imul(aL, M2L) >>> 0;
    zH = (a1 * (M2L >>> 16) + (m1 >>> 16) + (m2 >>> 16) + (t >>> 16) + Math.imul(aH, M2L) + Math.imul(aL, M2H)) >>> 0;
    F[0] = zL ^ ((zL >>> 31) | (zH << 1));
    F[1] = zH ^ (zH >>> 31);
  }
  var ID_TAG_L = 0x57494431, ID_TAG_H = 0x00443337, CHILD_TAG_L = 0x43484C44, CHILD_TAG_H = 0x00443337, HASH_TAG_L = 0x57485348, HASH_TAG_H = 0x00443337;
  /** Stable object id (world.rs world_id) -> out[0] lo, out[1] hi (Uint32Array(2) or a plain array). */
  function worldId(seedLo, seedHi, genVersion, rx, ry, rz, index, out) {
    F[0] = ID_TAG_L; F[1] = ID_TAG_H;
    FV[0] = seedLo; FV[1] = seedHi; foldv();
    FV[0] = genVersion; FV[1] = 0; foldv();
    FV[0] = rx; FV[1] = ry; foldv();
    FV[0] = rz; FV[1] = index; foldv();
    if (F[0] === 0 && F[1] === 0) F[0] = 1;
    out[0] = F[0] >>> 0; out[1] = F[1] >>> 0;
    return 0;
  }
  function childId(parentLo, parentHi, cutIndex, out) {
    F[0] = CHILD_TAG_L; F[1] = CHILD_TAG_H;
    FV[0] = parentLo; FV[1] = parentHi; foldv();
    FV[0] = cutIndex; FV[1] = 0; foldv();
    if (F[0] === 0 && F[1] === 0) F[0] = 1;
    out[0] = F[0] >>> 0; out[1] = F[1] >>> 0;
    return 0;
  }
  /** world.rs hidx of (a[i], b[j]), reduced to 30 bits (every table mask is smaller, so the index is the same). */
  function hidxA(a, i, b, j) { var k = Math.imul(a[i], 0x9E3779B1 | 0) ^ Math.imul(b[j], 0x85EBCA77 | 0); return (k ^ (k >>> 15)) & 0x3FFFFFFF; }
  /** id of slot i < id of slot j (unsigned 64-bit order). */
  function idLessA(lo, hi, i, j) { var ah = hi[i] >>> 0, bh = hi[j] >>> 0; return ah < bh || (ah === bh && (lo[i] >>> 0) < (lo[j] >>> 0)); }
  function pow2AtLeast(n) { var p = 16; while (p < n) p *= 2; return p; }

  /** d37_world_create (JS fallback). desc: 10 words (Int32Array / Uint32Array / array) or null = defaults. Returns
   * { code, world } (world null on error); every buffer is allocated here, once. */
  function createWorld(desc) {
    var d = desc || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var mo = (d[3] >>> 0) || 4096, ec = (d[4] >>> 0) || 4096, cr = (d[5] >>> 0) || 4096, ma = (d[6] >>> 0) || 256, reach = (d[7] >>> 0) || 2500;
    if (mo > 1048576 || ec > 1048576 || ma > 65536 || cr < 16 || cr > 65536 || (cr & (cr - 1)) !== 0 || reach > 0x7FFFFFFF) return { code: -2, world: null };
    return { code: 0, world: new JsWorld(d[0] | 0, d[1] | 0, d[2] | 0, mo, ec, cr, ma, reach) };
  }

  function JsWorld(seedLo, seedHi, gv, mo, ec, cr, ma, reach) {
    this.backend = 'js';
    // S: tickLo, tickHi, evSeq, seedLo, seedHi, genVersion, evLost, rev (the world revision), goneVer (u32 bits in int32)
    this.S = new Int32Array(10);
    this.S[3] = seedLo; this.S[4] = seedHi; this.S[5] = gv;
    this.maxObjects = mo; this.maxActors = ma; this.reach = reach;
    this.oLo = new Int32Array(mo); this.oHi = new Int32Array(mo); this.oVer = new Int32Array(mo); this.oGen = new Int32Array(mo);
    this.oKind = new Uint16Array(mo); this.oOwner = new Uint8Array(mo); this.oCk = new Uint8Array(mo); this.oSurf = new Uint8Array(mo);
    this.oFlags = new Uint8Array(mo); this.oBrk = new Uint16Array(mo); this.oStock = new Int32Array(mo); this.oSmax = new Int32Array(mo);
    this.oState = new Int32Array(mo); this.oHp = new Int32Array(mo); this.oHpMax = new Int32Array(mo); this.oMass = new Int32Array(mo);
    this.oLive = new Uint8Array(mo); this.oDmark = new Uint8Array(mo);
    this.free = new Int32Array(mo); for (var k = 0; k < mo; k++) this.free[k] = mo - 1 - k;
    this.nfree = mo; this.live = 0;
    var mapn = pow2AtLeast(mo * 2);
    this.map = new Int32Array(mapn); this.mapMask = mapn - 1;
    this.actReg = new Uint8Array(ma); this.actLo = new Int32Array(ma); this.actHi = new Int32Array(ma); this.nact = 0;
    this.cLo = new Int32Array(cr); this.cHi = new Int32Array(cr); this.cCmd = new Int32Array(cr * 13); this.cRes = new Int32Array(cr * 4); this.cHead = 0; this.cCount = 0;
    this.cmap = new Int32Array(cr * 2); this.cmapMask = cr * 2 - 1;
    this.ev = new Int32Array(ec * 13); this.evCap = ec; this.evHead = 0; this.evCount = 0;
    var dqn = mo * 2;
    this.dqKind = new Uint16Array(dqn); this.dqSlot = new Int32Array(dqn); this.dqLo = new Int32Array(dqn); this.dqHi = new Int32Array(dqn);
    this.dqGen = new Int32Array(dqn); this.dqCap = dqn; this.dqHead = 0; this.dqCount = 0; this.dqLost = false;
    this.order = new Int32Array(mo);
    this.pl = new Int32Array(4);   // plan: code, target slot, other slot, striker slot
    this.cur = new Int32Array(3);  // the command being applied: cmd lo, cmd hi, actor
    this.res = new Int32Array(4);  // its result
    this.count = 0; // the n of the last events / dirty drain
    this.len = 0;   // the length of the last snapshot
  }
  var JP = JsWorld.prototype;
  JP.find = function () { // the id in K
    var lo = K[0], hi = K[1];
    if (lo === 0 && hi === 0) return -1;
    var m = this.mapMask, map = this.map, oLo = this.oLo, oHi = this.oHi, i = hidxA(K, 0, K, 1) & m;
    for (;;) {
      var v = map[i];
      if (v === 0) return -1;
      if (oLo[v - 1] === lo && oHi[v - 1] === hi) return v - 1;
      i = (i + 1) & m;
    }
  };
  JP.mapInsert = function (slot) {
    var m = this.mapMask, i = hidxA(this.oLo, slot, this.oHi, slot) & m;
    while (this.map[i] !== 0) i = (i + 1) & m;
    this.map[i] = slot + 1;
  };
  JP.mapRemove = function (slot) {
    var m = this.mapMask, map = this.map, i = hidxA(this.oLo, slot, this.oHi, slot) & m;
    while (map[i] !== slot + 1) i = (i + 1) & m;
    var j = i;
    for (;;) {
      j = (j + 1) & m;
      var v = map[j];
      if (v === 0) break;
      var k = hidxA(this.oLo, v - 1, this.oHi, v - 1) & m;
      var inside = i <= j ? (i < k && k <= j) : (i < k || k <= j);
      if (!inside) { map[i] = v; i = j; }
    }
    map[i] = 0;
  };
  JP.cmdFind = function () { // the cmd id in K
    var lo = K[0], hi = K[1], m = this.cmapMask, cmap = this.cmap, i = hidxA(K, 0, K, 1) & m;
    for (;;) {
      var v = cmap[i];
      if (v === 0) return -1;
      if (this.cLo[v - 1] === lo && this.cHi[v - 1] === hi) return v - 1;
      i = (i + 1) & m;
    }
  };
  JP.cmapInsert = function (pos) {
    var m = this.cmapMask, i = hidxA(this.cLo, pos, this.cHi, pos) & m;
    while (this.cmap[i] !== 0) i = (i + 1) & m;
    this.cmap[i] = pos + 1;
  };
  JP.cmapRemove = function (pos) {
    var m = this.cmapMask, cmap = this.cmap, i = hidxA(this.cLo, pos, this.cHi, pos) & m;
    while (cmap[i] !== pos + 1) i = (i + 1) & m;
    var j = i;
    for (;;) {
      j = (j + 1) & m;
      var v = cmap[j];
      if (v === 0) break;
      var k = hidxA(this.cLo, v - 1, this.cHi, v - 1) & m;
      var inside = i <= j ? (i < k && k <= j) : (i < k || k <= j);
      if (!inside) { cmap[i] = v; i = j; }
    }
    cmap[i] = 0;
  };
  JP.cmdRecord = function (cmds, cb) { // id in this.cur[0..1], the command at cmds[cb..cb + 13], result in this.res
    var n = this.cLo.length, pos = this.cHead;
    if (this.cCount === n) this.cmapRemove(pos); else this.cCount++;
    this.cLo[pos] = this.cur[0]; this.cHi[pos] = this.cur[1];
    var cc = this.cCmd, d = pos * 13;
    for (var z = 0; z < 13; z++) cc[d + z] = cmds[cb + z];
    var b = pos * 4, r = this.res;
    this.cRes[b] = r[0]; this.cRes[b + 1] = r[1]; this.cRes[b + 2] = r[2]; this.cRes[b + 3] = r[3];
    this.cmapInsert(pos);
    this.cHead = (pos + 1) & (n - 1);
  };
  /** A re-send: everything but the cmd id (equal by lookup) and the ignored flags equals the window entry pos. */
  JP.sameCmd = function (pos, cmds, b) {
    var cc = this.cCmd, d = pos * 13;
    if (cc[d + 2] !== cmds[b + 2] || cc[d + 3] !== cmds[b + 3] || cc[d + 4] !== cmds[b + 4] || (cc[d + 5] & 0xFFFF) !== (cmds[b + 5] & 0xFFFF) || cc[d + 6] !== cmds[b + 6]) return false;
    for (var z = 7; z < 13; z++) if (cc[d + z] !== cmds[b + z]) return false;
    return true;
  };
  /** Starts event E for object slot (or slot -1: id 0, ver 0); the command and actor come from this.cur. */
  JP.evBegin = function (kind, flags, slot) {
    E[0] = kind | (flags << 16);
    if (slot >= 0) { E[2] = this.oLo[slot]; E[3] = this.oHi[slot]; E[4] = this.oVer[slot]; } else { E[2] = 0; E[3] = 0; E[4] = 0; }
    E[5] = this.cur[0]; E[6] = this.cur[1]; E[7] = this.cur[2]; E[8] = 0;
  };
  JP.emit = function () { // pushes E (seq assigned here)
    var S = this.S;
    E[1] = S[2];
    S[2] = S[2] + 1;
    var cap = this.evCap;
    if (this.evCount === cap) { if ((S[6] >>> 0) < 0xFFFFFFFF) S[6] = S[6] + 1; return; }
    var pos = this.evHead + this.evCount;
    if (pos >= cap) pos -= cap;
    var e = this.ev, b = pos * 13;
    for (var k = 0; k < 13; k++) e[b + k] = E[k];
    this.evCount++;
  };
  JP.pushDirty = function (kind, slot) {
    var cap = this.dqCap;
    if (this.dqCount === cap) { this.dqLost = true; return false; }
    var pos = this.dqHead + this.dqCount;
    if (pos >= cap) pos -= cap;
    this.dqKind[pos] = kind; this.dqSlot[pos] = slot; this.dqLo[pos] = this.oLo[slot]; this.dqHi[pos] = this.oHi[slot]; this.dqGen[pos] = this.oGen[slot];
    this.dqCount++;
    return true;
  };
  JP.mark = function (slot) { if (!this.oDmark[slot] && this.pushDirty(1, slot)) this.oDmark[slot] = 1; };
  /** Drain up to cap events (13 words each) into out; this.count = written. 0, 1 (more remain) or -8 (once, events lost). */
  JP.events = function (out, cap) {
    var n = 0, rc = this.evCap, e = this.ev, S = this.S;
    while (n < cap && this.evCount > 0) {
      var s = this.evHead * 13, d = n * 13;
      for (var k = 0; k < 13; k++) out[d + k] = e[s + k];
      this.evHead++; if (this.evHead === rc) this.evHead = 0;
      this.evCount--; n++;
    }
    if (S[6] !== 0) {
      if (n < cap) { var b = n * 13; for (var z = 0; z < 13; z++) out[b + z] = 0; out[b] = 6; out[b + 1] = -1; out[b + 9] = S[6]; n++; }
      S[6] = 0;
      this.count = n;
      return -8;
    }
    this.count = n;
    return this.evCount > 0 ? 1 : 0;
  };
  JP.dirty = function (out, cap) {
    var n = 0, rc = this.dqCap;
    while (n < cap && this.dqCount > 0) {
      var h = this.dqHead, b = n * 4;
      out[b] = this.dqKind[h]; out[b + 1] = this.dqLo[h]; out[b + 2] = this.dqHi[h]; out[b + 3] = this.dqGen[h];
      var s = this.dqSlot[h];
      if (this.dqKind[h] === 1 && this.oLive[s] && this.oGen[s] === this.dqGen[h]) this.oDmark[s] = 0;
      this.dqHead++; if (this.dqHead === rc) this.dqHead = 0;
      this.dqCount--; n++;
    }
    this.count = n;
    if (this.dqLost) { this.dqLost = false; return -8; }
    return this.dqCount > 0 ? 1 : 0;
  };
  function matSurf(s) { return s >= 16 && s < 24; }
  /** Validation shared by apply and query (world.rs check). a: Cmd words (isCmd) or Query words at offset b. Plan in
   * this.pl; for HIT the contact input in CI. Leaves K = the last id looked up. */
  JP.check = function (a, b, isCmd) {
    var pl = this.pl, actor, tLo, tHi, op, ev, pb;
    if (isCmd) { actor = a[b + 2] >>> 0; tLo = a[b + 3] | 0; tHi = a[b + 4] | 0; op = a[b + 5] & 0xFFFF; ev = a[b + 6] >>> 0; pb = b + 7; }
    else { actor = a[b] >>> 0; tLo = a[b + 1] | 0; tHi = a[b + 2] | 0; op = a[b + 3] & 0xFFFF; ev = 0; pb = b + 4; }
    pl[0] = 0; pl[1] = -1; pl[2] = -1; pl[3] = -1;
    if (op < 1 || op > 7) { pl[0] = 4; return; }
    if (actor !== 0 && (actor >= this.maxActors || !this.actReg[actor])) { pl[0] = 3; return; }
    var p0 = a[pb] | 0, p1 = a[pb + 1] | 0, p2 = a[pb + 2] | 0, p3 = a[pb + 3] | 0, p4 = a[pb + 4] | 0, p5 = a[pb + 5] | 0;
    if (op === 1) {
      var q0 = p0 >>> 0, kind = q0 & 0xFFFF, owner = (q0 >>> 16) & 15, ck = (q0 >>> 20) & 15, surf = q0 >>> 24;
      var surfBad = (ck === 2 && !matSurf(surf)) || (ck === 3 && !(surf < 8 || matSurf(surf)));
      if ((tLo === 0 && tHi === 0) || kind === 0 || owner > 1 || ck > 3 || surfBad || p1 < 0 || p2 < 0 || (p2 > 0 && p1 > p2) || p3 < 0 || p5 <= 0) { pl[0] = 5; return; }
      K[0] = tLo; K[1] = tHi;
      if (this.find() >= 0) pl[0] = 10;
      else if (this.live === this.maxObjects) pl[0] = 8;
      return;
    }
    if (op === 7) {
      if (actor !== 0) { pl[0] = 6; return; }
      if (p0 < 1 || p0 >= this.maxActors || (p1 !== 0 && p1 !== 1)) { pl[0] = 5; return; }
      if (p1 === 1) { if (p2 !== 0 || p3 !== 0) { K[0] = p2; K[1] = p3; pl[2] = this.find(); if (pl[2] < 0) pl[0] = 2; } }
      else if (!this.actReg[p0]) pl[0] = 3;
      return;
    }
    K[0] = tLo; K[1] = tHi;
    var t = this.find();
    pl[1] = t;
    if (t < 0) { pl[0] = 2; return; }
    if (ev !== 0 && ev !== (this.oVer[t] >>> 0)) { pl[0] = 1; return; }
    if (actor !== 0) {
      if (p5 < 0) { pl[0] = 5; return; }
      if (p5 > this.reach) { pl[0] = 11; return; }
    }
    if (op === 2) { if (this.oOwner[t] === 1 && actor !== 0) pl[0] = 9; return; }
    if (op === 3 || op === 4) {
      if (p0 < 1 || (p1 === tLo && p2 === tHi)) { pl[0] = 5; return; }
      if (p1 !== 0 || p2 !== 0) { K[0] = p1; K[1] = p2; pl[2] = this.find(); if (pl[2] < 0) { pl[0] = 2; return; } }
      var src = op === 3 ? t : pl[2], dst = op === 3 ? pl[2] : t;
      if (src >= 0 && this.oStock[src] < p0) pl[0] = 7;
      else if (dst >= 0) {
        var sum = this.oStock[dst] + p0;
        if (sum > 0x7FFFFFFF || (this.oSmax[dst] > 0 && sum > this.oSmax[dst])) pl[0] = 8;
      }
      return;
    }
    if (op === 5) {
      // the linked body strikes with its own mass (params[0] ignored); a link to a missing object -> NO_TARGET
      var la = -1, linked = actor !== 0 && (this.actLo[actor] !== 0 || this.actHi[actor] !== 0);
      if (linked) { K[0] = this.actLo[actor]; K[1] = this.actHi[actor]; la = this.find(); }
      pl[3] = la;
      if (linked && la < 0) { pl[0] = 2; return; }
      if ((la < 0 && p0 <= 0) || la === t) { pl[0] = 5; return; }
      var q2 = p2 >>> 0, q4 = p4 >>> 0, S = this.S;
      CI[I_ALO] = actor; CI[I_AHI] = 0; CI[I_BLO] = this.oLo[t] >>> 0; CI[I_BHI] = this.oHi[t] >>> 0;
      CI[I_MA] = p0 >>> 0; CI[I_MB] = this.oMass[t] >>> 0; CI[I_UA] = p1; CI[I_UB] = p3;
      CI[I_TICK] = S[0] >>> 0; CI[I_SEED] = (S[3] ^ S[4]) >>> 0;
      CI[I_HPA] = 0; CI[I_HPB] = clampi(this.oHpMax[t], 0, 65535); CI[I_BRK] = 0; CI[I_HOLD] = 0;
      CI[I_KA] = 0; CI[I_KB] = this.oCk[t]; CI[I_PA] = (q2 >>> 16) & 255; CI[I_PB] = q4 & 255; CI[I_FA] = (q4 >>> 8) & 255; CI[I_FB] = (q4 >>> 16) & 255;
      CI[I_MV] = q2 & 255; CI[I_AREA] = (q2 >>> 8) & 255; CI[I_SA] = 0; CI[I_SB] = this.oSurf[t]; CI[I_MOV] = 0; CI[I_FL] = q2 >>> 24;
      if (la >= 0) {
        CI[I_ALO] = this.oLo[la] >>> 0; CI[I_AHI] = this.oHi[la] >>> 0; CI[I_MA] = this.oMass[la] >>> 0; CI[I_KA] = this.oCk[la]; CI[I_SA] = this.oSurf[la];
        CI[I_HPA] = clampi(this.oHpMax[la], 0, 65535);
      }
      var tk = this.oCk[t];
      if (tk === 2 || tk === 3) CI[I_BRK] = this.oBrk[t];
      else if (la >= 0 && CI[I_KA] === 2) CI[I_BRK] = this.oBrk[la];
      if (CI[I_MV] === 4 || !contactValid()) { pl[0] = 5; return; }
      return;
    }
    if (op === 6) {
      if (p0 < 0) pl[0] = 5;
      else if (p1 !== -1 && p1 !== this.oState[t]) pl[0] = 1;
      else if ((this.oFlags[t] & 1) !== 0 || p0 === this.oState[t]) pl[0] = 6;
    }
  };
  /** The next world revision into S[7] (u32 bits, wraps, 0 skipped). */
  JP.nextRev = function () { var S = this.S; S[7] = S[7] + 1; if (S[7] === 0) S[7] = 1; };
  JP.touch = function (slot) { this.nextRev(); this.oVer[slot] = this.S[7]; this.mark(slot); };
  JP.stockAdd = function (slot, delta, other) {
    this.oStock[slot] += delta;
    this.touch(slot);
    this.evBegin(3, 0, slot);
    E[9] = delta; E[10] = this.oStock[slot];
    if (other >= 0) { E[11] = this.oLo[other]; E[12] = this.oHi[other]; } else { E[11] = 0; E[12] = 0; }
    this.emit();
  };
  JP.damage = function (slot, dmg, propSide, band, down, stun, s, flags) {
    var changed = false;
    if (dmg > 0 && this.oHp[slot] > 0) { this.oHp[slot] = Math.max(this.oHp[slot] - dmg, 0); changed = true; }
    if (propSide) {
      if ((flags & 4) && !(this.oFlags[slot] & 1)) { this.oFlags[slot] |= 1; this.oHp[slot] = 0; changed = true; }
      if ((flags & 8) && !(this.oFlags[slot] & 2)) { this.oFlags[slot] |= 2; changed = true; }
    }
    if (changed) this.touch(slot);
    this.evBegin(4, flags, slot);
    E[9] = band | (down << 8) | (stun << 16); E[10] = dmg; E[11] = s; E[12] = this.oHp[slot];
    this.emit();
  };
  JP.exec = function (c, b) {
    this.check(c, b, true);
    var pl = this.pl;
    if (pl[0] !== 0) return pl[0];
    var op = c[b + 5] & 0xFFFF, pb = b + 7;
    var p0 = c[pb] | 0, p1 = c[pb + 1] | 0, p2 = c[pb + 2] | 0, p3 = c[pb + 3] | 0, p4 = c[pb + 4] | 0, p5 = c[pb + 5] | 0, t = pl[1], o = pl[2], slot;
    if (op === 1) {
      this.nfree--;
      slot = this.free[this.nfree];
      var q0 = p0 >>> 0;
      this.nextRev();
      this.oLo[slot] = c[b + 3]; this.oHi[slot] = c[b + 4]; this.oVer[slot] = this.S[7]; this.oGen[slot] = this.oGen[slot] + 1;
      this.oKind[slot] = q0 & 0xFFFF; this.oOwner[slot] = (q0 >>> 16) & 15; this.oCk[slot] = (q0 >>> 20) & 15; this.oSurf[slot] = q0 >>> 24;
      this.oFlags[slot] = 0; this.oBrk[slot] = (p4 >>> 16) & 0xFFFF; this.oStock[slot] = p1; this.oSmax[slot] = p2; this.oState[slot] = p3;
      this.oHp[slot] = p4 & 0xFFFF; this.oHpMax[slot] = p4 & 0xFFFF; this.oMass[slot] = p5; this.oLive[slot] = 1; this.oDmark[slot] = 0;
      this.live++;
      this.mapInsert(slot);
      this.mark(slot);
      this.evBegin(1, 0, slot);
      E[9] = p0; E[10] = p1; E[11] = p3; E[12] = this.oHp[slot];
      this.emit();
    } else if (op === 2) {
      slot = t;
      this.nextRev();
      this.oVer[slot] = this.S[7]; this.S[8] = this.S[7];
      this.evBegin(2, 0, slot);
      E[9] = this.oKind[slot]; E[10] = this.oStock[slot]; E[11] = this.oState[slot]; E[12] = this.oHp[slot];
      this.emit();
      this.pushDirty(2, slot);
      this.mapRemove(slot);
      this.oLive[slot] = 0; this.oDmark[slot] = 0;
      this.free[this.nfree] = slot; this.nfree++;
      this.live--;
    } else if (op === 3 || op === 4) {
      if (op === 3) { this.stockAdd(t, -p0, o); if (o >= 0) this.stockAdd(o, p0, t); }
      else { this.stockAdd(t, p0, o); if (o >= 0) this.stockAdd(o, -p0, t); }
    } else if (op === 5) {
      contactCore();
      var tk = this.oCk[t], tProp = tk === 2 || tk === 3, fl = CO[O_FL];
      var ka = CI[I_KA], ba = CO[O_BA], da = CO[O_DA], sta = CO[O_STA], sa = CO[O_SA], hpa = CO[O_HPA], surf = CO[O_SURF];
      this.damage(t, tProp ? surf : CO[O_HPB], tProp, CO[O_BB], CO[O_DB], CO[O_STB], CO[O_SB], fl);
      var la = pl[3];
      if (la >= 0) {
        var aProp = ka === 2 && !tProp, dmgA = aProp ? surf : hpa;
        if (ba > 0 || dmgA > 0 || (aProp && (fl & 12) !== 0)) this.damage(la, dmgA, aProp, ba, da, sta, sa, fl);
      }
    } else if (op === 6) {
      var old = this.oState[t];
      this.oState[t] = p0;
      this.touch(t);
      this.evBegin(5, 0, t);
      E[9] = old; E[10] = p0; E[11] = 0; E[12] = 0;
      this.emit();
    } else if (op === 7) {
      this.evBegin(7, 0, -1);
      if (p1 === 1) {
        if (!this.actReg[p0]) { this.actReg[p0] = 1; this.nact++; }
        this.actLo[p0] = p2; this.actHi[p0] = p3;
        E[2] = p2; E[3] = p3; E[9] = p0; E[10] = 1; E[11] = 0; E[12] = 0;
      } else {
        this.actReg[p0] = 0; this.actLo[p0] = 0; this.actHi[p0] = 0; this.nact--;
        E[9] = p0; E[10] = 0; E[11] = 0; E[12] = 0;
      }
      this.emit();
    }
    return 0;
  };
  /** the target's ver (int32 bits), or 0 if it does not exist (the id at words a[b], a[b + 1]) */
  JP.verAt = function (a, b) { K[0] = a[b]; K[1] = a[b + 1]; var t = this.find(); return t < 0 ? 0 : this.oVer[t]; };
  /** d37_world_apply: n commands (13 words each) -> results (4 words each). cap = results capacity in records. */
  JP.apply = function (cmds, n, res, cap) {
    if (cap === undefined) cap = (res.length / 4) | 0;
    if (cap < n) return -2;
    var cur = this.cur, rr = this.res, S = this.S;
    for (var k = 0; k < n; k++) {
      var b = k * 13, rb = k * 4;
      cur[0] = cmds[b]; cur[1] = cmds[b + 1]; cur[2] = cmds[b + 2];
      var hasId = cur[0] !== 0 || cur[1] !== 0;
      if (hasId) {
        K[0] = cur[0]; K[1] = cur[1];
        var pos = this.cmdFind();
        if (pos >= 0) {
          // a re-send gets the first result; the same id with another command is ID_REUSED (nothing applied or recorded)
          if (this.sameCmd(pos, cmds, b)) { var q = pos * 4; res[rb] = this.cRes[q]; res[rb + 1] = this.cRes[q + 1]; res[rb + 2] = this.cRes[q + 2]; res[rb + 3] = this.cRes[q + 3]; }
          else { res[rb] = 12; res[rb + 1] = this.verAt(cmds, b + 3); res[rb + 2] = S[2]; res[rb + 3] = 0; }
          continue;
        }
      }
      var first = S[2], op = cmds[b + 5] & 0xFFFF, code, nv;
      if (!hasId) { code = 5; nv = this.verAt(cmds, b + 3); }
      else {
        code = this.exec(cmds, b);
        nv = code === 0 && op === 2 ? S[8] : op === 7 ? 0 : this.verAt(cmds, b + 3);
      }
      rr[0] = code; rr[1] = nv; rr[2] = first; rr[3] = S[2] - first;
      res[rb] = rr[0]; res[rb + 1] = rr[1]; res[rb + 2] = rr[2]; res[rb + 3] = rr[3];
      if (hasId) this.cmdRecord(cmds, b);
    }
    return 0;
  };
  /** d37_world_query: n queries (10 words each) -> out (2 words each: code, op). */
  JP.query = function (q, n, out) {
    for (var k = 0; k < n; k++) {
      var b = k * 10;
      this.check(q, b, false);
      out[k * 2] = this.pl[0]; out[k * 2 + 1] = q[b + 3] & 0xFFFF;
    }
    return 0;
  };
  /** d37_world_read: ids = n (lo, hi) pairs -> out (12 words each). Returns how many exist. */
  JP.read = function (ids, n, out) {
    var found = 0;
    for (var k = 0; k < n; k++) {
      K[0] = ids[2 * k]; K[1] = ids[2 * k + 1];
      var t = this.find(), b = k * 12;
      for (var z = 0; z < 12; z++) out[b + z] = 0;
      out[b] = K[0]; out[b + 1] = K[1];
      if (t < 0) continue;
      found++;
      out[b + 2] = this.oVer[t]; out[b + 3] = this.oGen[t];
      out[b + 4] = this.oKind[t] | (this.oOwner[t] << 16) | (this.oCk[t] << 24);
      out[b + 5] = this.oSurf[t] | (this.oFlags[t] << 8) | (this.oBrk[t] << 16);
      out[b + 6] = this.oStock[t]; out[b + 7] = this.oSmax[t]; out[b + 8] = this.oState[t]; out[b + 9] = this.oHp[t]; out[b + 10] = this.oHpMax[t]; out[b + 11] = this.oMass[t];
    }
    return found;
  };
  JP.step = function (ticks) {
    var S = this.S, s = (S[0] >>> 0) + (ticks >>> 0);
    S[0] = s;
    if (s > 0xFFFFFFFF) S[1] = S[1] + 1;
    return 0;
  };
  /** d37_world_info -> out (8 words). */
  JP.info = function (out) {
    var S = this.S;
    out[0] = S[0]; out[1] = S[1]; out[2] = this.live; out[3] = this.nact; out[4] = this.evCount; out[5] = this.dqCount; out[6] = S[2];
    out[7] = (S[6] !== 0 ? 1 : 0) | (this.dqLost ? 2 : 0);
    return 0;
  };
  // live slots sorted by id into this.order (in place heapsort, no allocation)
  function siftDown(o, lo, hi, root, cnt) {
    for (;;) {
      var c = 2 * root + 1;
      if (c >= cnt) return;
      if (c + 1 < cnt && idLessA(lo, hi, o[c], o[c + 1])) c++;
      if (!idLessA(lo, hi, o[root], o[c])) return;
      var t = o[root]; o[root] = o[c]; o[c] = t;
      root = c;
    }
  }
  JP.sortLive = function () {
    var n = 0, o = this.order, lo = this.oLo, hi = this.oHi;
    for (var s = 0; s < this.maxObjects; s++) if (this.oLive[s]) o[n++] = s;
    for (var st = (n >> 1) - 1; st >= 0; st--) siftDown(o, lo, hi, st, n);
    for (var end = n - 1; end > 0; end--) { var t2 = o[0]; o[0] = o[end]; o[end] = t2; siftDown(o, lo, hi, 0, end); }
    return n;
  };
  /** d37_world_hash -> out[0] lo, out[1] hi. */
  JP.hash = function (out) {
    var n = this.sortLive(), o = this.order, S = this.S;
    F[0] = HASH_TAG_L; F[1] = HASH_TAG_H;
    FV[0] = S[0]; FV[1] = S[1]; foldv();
    FV[0] = S[7]; FV[1] = 0; foldv();
    FV[0] = this.nact; FV[1] = 0; foldv();
    for (var a = 1; a < this.maxActors; a++) {
      if (!this.actReg[a]) continue;
      FV[0] = a; FV[1] = 0; foldv();
      FV[0] = this.actLo[a]; FV[1] = this.actHi[a]; foldv();
    }
    FV[0] = n; FV[1] = 0; foldv();
    for (var k = 0; k < n; k++) {
      var s = o[k];
      FV[0] = this.oLo[s]; FV[1] = this.oHi[s]; foldv();
      FV[0] = this.oVer[s]; FV[1] = this.oKind[s] | (this.oOwner[s] << 16) | (this.oCk[s] << 24); foldv();
      FV[0] = this.oSurf[s] | (this.oFlags[s] << 8) | (this.oBrk[s] << 16); FV[1] = this.oMass[s]; foldv();
      FV[0] = this.oStock[s]; FV[1] = this.oSmax[s]; foldv();
      FV[0] = this.oState[s]; FV[1] = this.oHp[s]; foldv();
      FV[0] = this.oHpMax[s]; FV[1] = 0; foldv();
    }
    out[0] = F[0]; out[1] = F[1];
    return 0;
  };
  JP.snapshotLength = function () { return 48 + this.nact * 12 + this.live * 44 + this.cCount * 68; };
  // little-endian writes / reads of typed-array cells (the value never crosses a call)
  function w16a(b, p, a, i) { var x = a[i]; b[p] = x & 255; b[p + 1] = (x >>> 8) & 255; }
  function w32a(b, p, a, i) { var x = a[i]; b[p] = x & 255; b[p + 1] = (x >>> 8) & 255; b[p + 2] = (x >>> 16) & 255; b[p + 3] = (x >>> 24) & 255; }
  function w32s(b, p, x) { b[p] = x & 255; b[p + 1] = (x >>> 8) & 255; b[p + 2] = (x >>> 16) & 255; b[p + 3] = (x >>> 24) & 255; }
  function r16(b, p) { return b[p] | (b[p + 1] << 8); }
  function r32a(b, p, a, i) { a[i] = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); }
  /** small values only (counts, handles) */
  function r32s(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
  /** d37_world_snapshot into out (Uint8Array). this.len = the needed length; out too short -> 1 (W_TRUNCATED), nothing written. */
  JP.snapshot = function (out) {
    var len = this.snapshotLength();
    this.len = len;
    if (!out || out.length < len) return 1;
    var n = this.sortLive(), o = this.order, b = out, S = this.S;
    b[0] = 68; b[1] = 51; b[2] = 55; b[3] = 87;
    b[4] = 2; b[5] = 0; b[6] = 0; b[7] = 0;
    w32a(b, 8, S, 3); w32a(b, 12, S, 4); w32a(b, 16, S, 5); w32a(b, 20, S, 7);
    w32a(b, 24, S, 0); w32a(b, 28, S, 1); w32a(b, 32, S, 2); w32s(b, 36, this.nact); w32s(b, 40, n); w32s(b, 44, this.cCount);
    var p = 48;
    for (var a = 1; a < this.maxActors; a++) if (this.actReg[a]) { w32s(b, p, a); w32a(b, p + 4, this.actLo, a); w32a(b, p + 8, this.actHi, a); p += 12; }
    for (var k = 0; k < n; k++) {
      var s = o[k];
      w32a(b, p, this.oLo, s); w32a(b, p + 4, this.oHi, s); w32a(b, p + 8, this.oVer, s); w16a(b, p + 12, this.oKind, s);
      b[p + 14] = this.oOwner[s]; b[p + 15] = this.oCk[s]; b[p + 16] = this.oSurf[s]; b[p + 17] = this.oFlags[s]; w16a(b, p + 18, this.oBrk, s);
      w32a(b, p + 20, this.oStock, s); w32a(b, p + 24, this.oSmax, s); w32a(b, p + 28, this.oState, s); w32a(b, p + 32, this.oHp, s);
      w32a(b, p + 36, this.oHpMax, s); w32a(b, p + 40, this.oMass, s);
      p += 44;
    }
    var r = this.cLo.length, first = (this.cHead + r - this.cCount) & (r - 1);
    for (var j = 0; j < this.cCount; j++) {
      var pos = (first + j) & (r - 1), q = pos * 4, cw = pos * 13;
      for (var z = 0; z < 13; z++) w32a(b, p + 4 * z, this.cCmd, cw + z); // the D37Cmd (op u16 | flags u16 << 16 is word 5)
      w32a(b, p + 52, this.cRes, q); w32a(b, p + 56, this.cRes, q + 1); w32a(b, p + 60, this.cRes, q + 2); w32a(b, p + 64, this.cRes, q + 3);
      p += 68;
    }
    return 0;
  };
  /** compares the u64 id at bytes b[p .. p + 8] with K (lo, hi), unsigned: -1, 0, 1 (int32 only, nothing boxed) */
  function cmpIdAt(b, p) {
    var hi = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) ^ 0x80000000, kh = K[1] ^ 0x80000000;
    if (hi !== kh) return hi < kh ? -1 : 1;
    var lo = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) ^ 0x80000000, kl = K[0] ^ 0x80000000;
    return lo < kl ? -1 : lo > kl ? 1 : 0;
  }
  /** is the id in K among the no snapshot objects at byte ob (ids ascending)? */
  function snapHas(b, ob, no) {
    var lo = 0, hi = no;
    while (lo < hi) {
      var mid = (lo + hi) >> 1, c = cmpIdAt(b, ob + mid * 44);
      if (c === 0) return true;
      if (c < 0) lo = mid + 1; else hi = mid;
    }
    return false;
  }
  /** d37_world_restore (all or nothing): 0, -2 (E_ARG: bad bytes, another seed / gen version), -6 (E_CAPACITY). Dirty after it:
   * pending GONE entries of ids the snapshot lacks (FIFO), GONE for every live object it lacks (id order), CHANGED for every
   * restored object (id order); a dirty overflow (pending or new) -> -8 on the next drain. */
  JP.restore = function (b, len) {
    if (len < 48) return -2;
    var S = this.S;
    r32a(b, 8, RV, 0); r32a(b, 12, RV, 1); r32a(b, 16, RV, 2);
    if (b[0] !== 68 || b[1] !== 51 || b[2] !== 55 || b[3] !== 87 || r16(b, 4) !== 2 || RV[0] !== S[3] || RV[1] !== S[4] || RV[2] !== S[5]) return -2;
    var na = r32s(b, 36), no = r32s(b, 40), nc = r32s(b, 44);
    if (na >= this.maxActors || no > this.maxObjects || nc > this.cLo.length) return -6;
    if (len !== 48 + na * 12 + no * 44 + nc * 68) return -2;
    var p = 48, k, last = 0;
    for (k = 0; k < na; k++) { var h = r32s(b, p); if (h <= last || h >= this.maxActors) return -2; last = h; p += 12; }
    RV[2] = 0; RV[3] = 0; // the previous id (lo, hi)
    for (k = 0; k < no; k++) {
      r32a(b, p, RV, 0); r32a(b, p + 4, RV, 1);
      var ih = RV[1] >>> 0, il = RV[0] >>> 0, ph = RV[3] >>> 0, plo = RV[2] >>> 0;
      if (!(ph < ih || (ph === ih && plo < il)) || r32s(b, p + 8) === 0 || r16(b, p + 12) === 0 || b[p + 14] > 1 || b[p + 15] > 3) return -2;
      RV[2] = RV[0]; RV[3] = RV[1]; p += 44;
    }
    for (k = 0; k < nc; k++) { if (r32s(b, p) === 0 && r32s(b, p + 4) === 0) return -2; p += 68; }
    // dirty for the engine's mirror (review C001-R5): keep pending GONE entries of ids the snapshot lacks, then GONE for every
    // live object it lacks (merge walk: both in id order)
    var ob = 48 + na * 12, dcap = this.dqCap, kept = 0;
    for (k = 0; k < this.dqCount; k++) {
      var di = this.dqHead + k; if (di >= dcap) di -= dcap;
      if (this.dqKind[di] !== 2) continue;
      K[0] = this.dqLo[di]; K[1] = this.dqHi[di];
      if (snapHas(b, ob, no)) continue;
      var dj = this.dqHead + kept; if (dj >= dcap) dj -= dcap;
      this.dqKind[dj] = 2; this.dqSlot[dj] = this.dqSlot[di]; this.dqLo[dj] = this.dqLo[di]; this.dqHi[dj] = this.dqHi[di]; this.dqGen[dj] = this.dqGen[di];
      kept++;
    }
    this.dqCount = kept;
    var nl = this.sortLive(), ord = this.order, sj = 0;
    for (k = 0; k < nl; k++) {
      var s0 = ord[k];
      K[0] = this.oLo[s0]; K[1] = this.oHi[s0];
      while (sj < no && cmpIdAt(b, ob + sj * 44) < 0) sj++;
      if (!(sj < no && cmpIdAt(b, ob + sj * 44) === 0)) this.pushDirty(2, s0);
    }
    r32a(b, 20, S, 7); r32a(b, 24, S, 0); r32a(b, 28, S, 1); r32a(b, 32, S, 2);
    var mo = this.maxObjects;
    for (var s = 0; s < mo; s++) { this.oLive[s] = 0; this.oDmark[s] = 0; this.free[s] = mo - 1 - s; }
    this.nfree = mo; this.live = 0;
    this.map.fill(0);
    this.actReg.fill(0); this.actLo.fill(0); this.actHi.fill(0); this.nact = 0;
    this.evHead = 0; this.evCount = 0; S[6] = 0;
    p = 48;
    for (k = 0; k < na; k++) { var hh = r32s(b, p); this.actReg[hh] = 1; r32a(b, p + 4, this.actLo, hh); r32a(b, p + 8, this.actHi, hh); this.nact++; p += 12; }
    for (k = 0; k < no; k++) {
      this.nfree--;
      var slot = this.free[this.nfree];
      r32a(b, p, this.oLo, slot); r32a(b, p + 4, this.oHi, slot); r32a(b, p + 8, this.oVer, slot); this.oGen[slot] = this.oGen[slot] + 1;
      this.oKind[slot] = r16(b, p + 12); this.oOwner[slot] = b[p + 14]; this.oCk[slot] = b[p + 15]; this.oSurf[slot] = b[p + 16]; this.oFlags[slot] = b[p + 17];
      this.oBrk[slot] = r16(b, p + 18); r32a(b, p + 20, this.oStock, slot); r32a(b, p + 24, this.oSmax, slot); r32a(b, p + 28, this.oState, slot);
      r32a(b, p + 32, this.oHp, slot); r32a(b, p + 36, this.oHpMax, slot); r32a(b, p + 40, this.oMass, slot); this.oLive[slot] = 1; this.oDmark[slot] = 0;
      this.live++;
      this.mapInsert(slot);
      this.mark(slot);
      p += 44;
    }
    this.cmap.fill(0);
    var rn = this.cLo.length;
    for (k = 0; k < nc; k++) {
      r32a(b, p, this.cLo, k); r32a(b, p + 4, this.cHi, k);
      var q = k * 4, cw = k * 13;
      for (var z = 0; z < 13; z++) r32a(b, p + 4 * z, this.cCmd, cw + z);
      r32a(b, p + 52, this.cRes, q); r32a(b, p + 56, this.cRes, q + 1); r32a(b, p + 60, this.cRes, q + 2); r32a(b, p + 64, this.cRes, q + 3);
      this.cmapInsert(k);
      p += 68;
    }
    this.cCount = nc;
    this.cHead = nc & (rn - 1);
    return 0;
  };
  JP.destroy = function () { return 0; };

  var JS = { backend: 'js', abi: ABI, h32: h32, smSeed: smSeed, smNext: smNext, smFill: smFill, smBelow: smBelow, isqrt64: isqrt64, digest: digest,
    smState: smState, smStep: smStep, smBelowS: smBelowS,
    contact: contact, createWorld: createWorld, worldId: worldId, childId: childId, W: W, C: C, STRUCT_SIZES: STRUCT_SIZES };

  function wrap(inst) {
    var e = inst.exports;
    if (typeof e.d37_abi_version !== 'function' || e.d37_abi_version() !== ABI) throw new Error('abi mismatch');
    var api = {
      backend: 'wasm', abi: ABI, exports: e,
      h32: function (s, x, y, z, k) { return e.d37_h32(s | 0, x | 0, y | 0, z | 0, k | 0) >>> 0; },
      smSeed: function (seed) { return BigInt.asUintN(64, e.d37_sm_seed(seed | 0)); },
      smNext: smNext, smBelow: smBelow, digest: digest, smState: smState, smStep: smStep, smBelowS: smBelowS,
      smFill: function (state, n) {
        var bytes = 8 + n * 8, p = e.d37_alloc(bytes);
        if (!p) return smFill(state, n);
        try {
          var mem = new BigUint64Array(e.memory.buffer, p, 1 + n);
          mem[0] = BigInt.asUintN(64, state);
          if (e.d37_sm_fill(p, p + 8, n) !== 0) throw new Error('sm_fill');
          mem = new BigUint64Array(e.memory.buffer, p, 1 + n); // memory may have grown
          return { values: mem.slice(1), state: mem[0] };
        } finally { e.d37_free(p, bytes); }
      },
      isqrt64: function (v) { return e.d37_isqrt64(BigInt.asIntN(64, BigInt(v))) >>> 0; }
    };
    // ---- ABI 5 (C-001) over the wasm exports: the same Int32Array layouts as the JS fallback. Buffers live in wasm memory,
    // allocated on first use and grown only when a call needs more (no allocation per call in steady state).
    var MV = { buf: null, u8: null, i32: null };
    function views() {
      if (MV.buf !== e.memory.buffer) { MV.buf = e.memory.buffer; MV.u8 = new Uint8Array(MV.buf); MV.i32 = new Int32Array(MV.buf); }
    }
    function Bufs() { this.p = {}; this.cap = {}; }
    Bufs.prototype.get = function (name, bytes) {
      var c = this.cap[name] || 0;
      if (c < bytes) {
        if (c) e.d37_free(this.p[name], c);
        var n = Math.max(64, bytes);
        this.p[name] = e.d37_alloc(n);
        this.cap[name] = n;
      }
      return this.p[name];
    };
    Bufs.prototype.freeAll = function () { for (var k in this.cap) if (this.cap[k]) { e.d37_free(this.p[k], this.cap[k]); this.cap[k] = 0; } };
    function put(src, words, ptr) { views(); var h = MV.i32, b = ptr >> 2; for (var i = 0; i < words; i++) h[b + i] = src[i]; }
    function get(dst, words, ptr) { views(); var h = MV.i32, b = ptr >> 2; for (var i = 0; i < words; i++) dst[i] = h[b + i]; }
    var cbufs = new Bufs();
    function wContact(input, n, out) {
      var pi = cbufs.get('in', n * 60 + 4), po = cbufs.get('out', n * 28 + 4);
      put(input, n * 15, pi);
      var r = e.d37_ix_contact(pi, n, po);
      get(out, n * 7, po);
      return r;
    }
    function WasmWorld(ptr) {
      this.backend = 'wasm'; this.ptr = ptr; this.b = new Bufs(); this.scr = e.d37_alloc(16); this.count = 0; this.len = 0;
      this.dead = false; this.error = '';
    }
    var WP = WasmWorld.prototype;
    // A wasm trap (a panic aborts in wasm32) must never throw out of the core: the call returns E_PANIC (-100) and the world is
    // dead from then on (every call -100; its memory is not reused). Engines resync into a new world from their own state.
    function trapped(w, err) { w.dead = true; w.error = String(err && err.message || err); w.count = 0; return -100; }
    WP.apply = function (cmds, n, res, cap) {
      if (this.dead) return -100;
      try {
        if (cap === undefined) cap = (res.length / 4) | 0;
        var pc = this.b.get('cmd', n * 52 + 4), pr = this.b.get('res', n * 16 + 4);
        put(cmds, n * 13, pc);
        var r = e.d37_world_apply(this.ptr, pc, n, pr, Math.min(cap, n));
        if (r === 0) get(res, n * 4, pr);
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.query = function (q, n, out) {
      if (this.dead) return -100;
      try {
        var pq = this.b.get('q', n * 40 + 4), po = this.b.get('qo', n * 8 + 4);
        put(q, n * 10, pq);
        var r = e.d37_world_query(this.ptr, pq, n, po);
        get(out, n * 2, po);
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.events = function (out, cap) {
      if (this.dead) return -100;
      try {
        var pe = this.b.get('ev', cap * 52 + 4);
        var r = e.d37_world_events(this.ptr, pe, cap, this.scr);
        views();
        var n = MV.i32[this.scr >> 2];
        get(out, n * 13, pe);
        this.count = n;
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.dirty = function (out, cap) {
      if (this.dead) return -100;
      try {
        var pd = this.b.get('dirty', cap * 16 + 4);
        var r = e.d37_world_dirty(this.ptr, pd, cap, this.scr);
        views();
        var n = MV.i32[this.scr >> 2];
        get(out, n * 4, pd);
        this.count = n;
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.read = function (ids, n, out) {
      if (this.dead) return -100;
      try {
        var pi = this.b.get('ids', n * 8 + 4), po = this.b.get('st', n * 48 + 4);
        put(ids, n * 2, pi);
        var r = e.d37_world_read(this.ptr, pi, n, po);
        get(out, n * 12, po);
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.step = function (ticks) {
      if (this.dead) return -100;
      try { return e.d37_world_step(this.ptr, ticks | 0); } catch (err) { return trapped(this, err); }
    };
    WP.info = function (out) {
      if (this.dead) return -100;
      try {
        var pi = this.b.get('info', 32);
        var r = e.d37_world_info(this.ptr, pi);
        get(out, 8, pi);
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.hash = function (out) {
      if (this.dead) return -100;
      try {
        var r = e.d37_world_hash(this.ptr, this.scr);
        views();
        out[0] = MV.i32[this.scr >> 2]; out[1] = MV.i32[(this.scr >> 2) + 1];
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.snapshot = function (out) {
      if (this.dead) return -100;
      try {
        var r = e.d37_world_snapshot(this.ptr, 0, 0, this.scr);
        views();
        var len = MV.i32[this.scr >> 2] >>> 0;
        this.len = len;
        if (!out || out.length < len) return 1;
        var ps = this.b.get('snap', len + 4);
        r = e.d37_world_snapshot(this.ptr, ps, len, this.scr);
        views();
        var u = MV.u8;
        for (var i = 0; i < len; i++) out[i] = u[ps + i];
        return r;
      } catch (err) { return trapped(this, err); }
    };
    WP.restore = function (bytes, len) {
      if (this.dead) return -100;
      try {
        var ps = this.b.get('snap', len + 4);
        views();
        var u = MV.u8;
        for (var i = 0; i < len; i++) u[ps + i] = bytes[i];
        return e.d37_world_restore(this.ptr, ps, len);
      } catch (err) { return trapped(this, err); }
    };
    WP.destroy = function () {
      if (!this.ptr) return -1;
      if (this.dead) { this.ptr = 0; return -100; } // a trapped world's memory is left alone
      var r = e.d37_world_destroy(this.ptr);
      this.ptr = 0;
      this.b.freeAll();
      e.d37_free(this.scr, 16);
      return r;
    };
    function wCreateWorld(desc) {
      var p = e.d37_alloc(48);
      if (!p) return { code: -6, world: null };
      var d = desc || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      put(d, 10, p);
      views(); MV.i32[(p >> 2) + 10] = 0;
      var r = e.d37_world_create(p, p + 40);
      views();
      var w = MV.i32[(p >> 2) + 10];
      e.d37_free(p, 48);
      return r === 0 ? { code: 0, world: new WasmWorld(w) } : { code: r, world: null };
    }
    var idp = 0;
    function idOut(a) { views(); a[0] = MV.i32[idp >> 2] >>> 0; a[1] = MV.i32[(idp >> 2) + 1] >>> 0; return 0; }
    api.contact = wContact;
    api.createWorld = wCreateWorld;
    api.worldId = function (sl, sh, gv, rx, ry, rz, index, out) {
      if (!idp) idp = e.d37_alloc(8);
      e.d37_world_id(sl | 0, sh | 0, gv | 0, rx | 0, ry | 0, rz | 0, index | 0, idp);
      return idOut(out);
    };
    api.childId = function (pl, ph, cut, out) {
      if (!idp) idp = e.d37_alloc(8);
      e.d37_world_child_id(pl | 0, ph | 0, cut | 0, idp);
      return idOut(out);
    };
    api.W = W; api.C = C; api.STRUCT_SIZES = STRUCT_SIZES;
    // the wasm must report the ABI 5 struct sizes this file was written for
    {
      var sp = e.d37_alloc(4 * 32);
      var ns = e.d37_struct_sizes(sp, 32);
      views();
      var okSizes = ns === STRUCT_SIZES.length;
      for (var si = 0; okSizes && si < ns; si++) if (MV.i32[(sp >> 2) + si] !== STRUCT_SIZES[si]) okSizes = false;
      e.d37_free(sp, 4 * 32);
      if (!okSizes) throw new Error('struct sizes mismatch');
    }
    // self-check against the JS reference before trusting the module
    var vec = [[0, 0, 0, 0, 0], [1, 2, 3, 4, 5], [0xFFFFFFFF, -1, -1, -1, 0xFFFFFFFF], [37, 100, -100, 7, 3]];
    for (var i = 0; i < vec.length; i++) {
      var a = vec[i];
      if (api.h32(a[0], a[1], a[2], a[3], a[4]) !== h32(a[0], a[1], a[2], a[3], a[4])) throw new Error('h32 self-check');
    }
    var f = api.smFill(smSeed(5), 3), g = smFill(smSeed(5), 3);
    for (var j = 0; j < 3; j++) if (f.values[j] !== g.values[j]) throw new Error('splitmix self-check');
    return api;
  }

  /** Load the wasm (URL string, ArrayBuffer, Uint8Array or WebAssembly.Module). Resolves to the wasm API or the JS fallback. */
  function load(src) {
    function fallback(err) { var o = Object.assign({}, JS); o.error = String(err && err.message || err); return o; }
    try {
      if (typeof WebAssembly !== 'object' || typeof BigInt !== 'function') return Promise.resolve(fallback('no WebAssembly/BigInt'));
      var p;
      if (typeof src === 'string') {
        p = fetch(src).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (b) { return WebAssembly.instantiate(b, {}); }).then(function (x) { return x.instance; });
      } else if (src instanceof WebAssembly.Module) {
        p = WebAssembly.instantiate(src, {});
      } else {
        p = WebAssembly.instantiate(src, {}).then(function (x) { return x.instance; });
      }
      return p.then(wrap).catch(fallback);
    } catch (err) {
      return Promise.resolve(fallback(err));
    }
  }

  return { load: load, js: JS, ABI: ABI };
});
