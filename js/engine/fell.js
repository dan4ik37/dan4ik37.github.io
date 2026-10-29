// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — рубка дерева как в жизни (D37E.fell): подруб со стороны падения, запил с другой, недопил держит
// ═══════════════════════════════════════
// T-138 (owner 29.10: «дерево не распадается, а просто падает вниз, и его надо дорубить; огромным деревьям нужен большой угол»).
// Spec: E:\d37-core\spec\STRUCTURE_HAZARDS.md §2.4 S1.C (voxel form: 4 horizontal sides instead of 16 sectors — a voxel trunk is
// 1×1, 2×2 or 3×3 cells). Pure integers, no three.js / DOM. The fall itself is D37E.topple (same slots as tipping structures).
//
//   s = FL.state(D)            — Int32Array(8): [cut +x, cut −x, cut +z, cut −z (eighths of a cell from that face of the section,
//                                0…8·D), D (trunk width, cells), notch side (−1 none), hits, flags]
//   FL.hit(s, side, step)      — one swing on a side (0 +x · 1 −x · 2 +z · 3 −z): + step eighths; the first side that reaches the
//                                notch depth (⌈8D/3⌉, a third of the trunk) becomes the notch → s
//   FL.step(D, need)           — eighths per swing: a wider trunk takes more swings per eighth (wood ∝ width) → 1
//   FL.decide(s, lean, out)    — does it go? out.go 0/1, out.dir (side it falls to), out.kind 1 proper felling: a notch (≥ ⅓, cut
//                                first) + a back cut from the other side down to the hinge — falls to the notch, the hinge steers it ·
//                                2 the trunk's centre of mass is beyond the wood that is left (a one-sided cut past the middle falls
//                                TOWARD the cut; a too-small notch with a deep back cut falls BACK, toward the back cut) or the axis is
//                                cut (nearly) through without a proper notch (falls to the side the centre of mass is on) · 3 the
//                                centre of mass with the crown lean is beyond it: a heavy crown leans over by itself (slow);
//                                out.hinge — eighths of wood left. lean = [crown offset +x, +z in eighths × crown mass share ‰]
//                                (owner: «огромным деревьям нужен большой угол» — the notch needs ⅓ of the trunk: 2×2 — 6/16, 3×3 —
//                                8/24; a smaller one does not steer the fall)
//   FL.cell(s, i, j, out)      — render cut of section cell (i along x, j along z, 0…D−1): out[0..3] = cut from +x, −x, +z, −z
//                                (eighths 0…8) → true if the cell is cut through (removed)
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const FL = E.fell = E.fell || {};
  FL.VERSION = 1;
  FL.OPP = [1, 0, 3, 2];
  FL.notchNeed = D => Math.ceil(8 * D / 3);   // a third of the trunk on the fall side
  FL.hingeMax = D => Math.max(1, D);          // the hinge: ≤ 1/8 of the trunk is left (D eighths across 8·D)
  FL.state = D => { const s = new Int32Array(8); s[4] = Math.max(1, Math.min(3, D | 0)); s[5] = -1; return s; };
  FL.step = () => 1;
  FL.hit = (s, side, step = 1) => {
    const D = s[4], full = 8 * D, o = FL.OPP[side];
    s[side] = Math.min(full - s[o], s[side] + Math.max(1, step | 0));   // never more than what is left across
    s[6]++;
    if (s[5] < 0 && s[side] >= FL.notchNeed(D) && s[o] === 0) s[5] = side;   // the notch: cut first, a third deep, nothing behind it yet
    return s;
  };
  FL.decide = (s, lean, out = { go: 0, dir: 0, kind: 0, hinge: 0 }) => {
    const D = s[4], full = 8 * D, hmax = FL.hingeMax(D), n = s[5];
    out.go = 0; out.kind = 0; out.dir = 0; out.hinge = full;
    // 1) proper felling: notch + back cut, the hinge (wood between them) ≤ hmax → falls to the notch
    if (n >= 0) {
      const o = FL.OPP[n], rem = full - s[n] - s[o];
      out.hinge = rem;
      if (s[o] > 0 && rem <= hmax) { out.go = 1; out.dir = n; out.kind = 1; return out; }
    }
    // 2) / 3) the centre of mass over the wood that is left, per axis (eighths from the − face: wood [s[b], full − s[a]], trunk axis 4D,
    //    with the crown lean 4D + lean): beyond an edge — tips that way (trunk alone — 2, only with the crown — 3, slow); cut (nearly)
    //    through without a proper notch — to the side of the centre of mass (ties: the crown, the deeper cut, the lowest side)
    let k3 = -1;
    for (let ax = 0; ax < 2; ax++) {
      const a = ax * 2, b = a + 1, lo = s[b], hi = full - s[a], rem = hi - lo, c0 = 4 * D, ln = lean ? lean[ax] : 0, c1 = c0 + ln;
      if (c0 > hi || c0 < lo) { out.go = 1; out.kind = 2; out.hinge = Math.max(0, rem); out.dir = c0 > hi ? a : b; return out; }
      if (rem <= hmax) { out.go = 1; out.kind = 2; out.hinge = Math.max(0, rem); const m2 = lo + hi; out.dir = 2 * c1 > m2 ? a : 2 * c1 < m2 ? b : s[a] > s[b] ? a : s[b] > s[a] ? b : a; return out; }
      if (k3 < 0 && lean && ((c1 >= hi + D && s[a] > 0) || (c1 <= lo - D && s[b] > 0))) k3 = c1 > hi ? a : b;   // the crown: over the CUT side, beyond by ≥ 1/8 of the trunk (the wood bends a little; uncut — the roots hold a leaning tree)
    }
    if (k3 >= 0) { const o = FL.OPP[k3]; out.go = 1; out.kind = 3; out.dir = k3; out.hinge = full - s[k3] - s[o]; }
    return out;
  };
  FL.cell = (s, i, j, out) => {
    const D = s[4], cl = v => v < 0 ? 0 : v > 8 ? 8 : v;
    out[0] = cl(s[0] - 8 * (D - 1 - i)); out[1] = cl(s[1] - 8 * i); out[2] = cl(s[2] - 8 * (D - 1 - j)); out[3] = cl(s[3] - 8 * j);
    return out[0] + out[1] >= 8 || out[2] + out[3] >= 8;
  };
  // pack / unpack a per-cell cut (6 sides × 4 bits: +x, −x, +y, −y, +z, −z, eighths 0…8) — the F1 cut state of one cell
  FL.pack = (px, nx, py, ny, pz, nz) => (px & 15) | (nx & 15) << 4 | (py & 15) << 8 | (ny & 15) << 12 | (pz & 15) << 16 | (nz & 15) << 20;
  FL.side = (c, f) => (c >>> (f * 4)) & 15;   // f: 0 +x · 1 −x · 2 +y · 3 −y · 4 +z · 5 −z (the mesher's direction order)
  FL.through = c => FL.side(c, 0) + FL.side(c, 1) >= 8 || FL.side(c, 2) + FL.side(c, 3) >= 8 || FL.side(c, 4) + FL.side(c, 5) >= 8;
  FL.left = c => (8 - FL.side(c, 0) - FL.side(c, 1)) * (8 - FL.side(c, 2) - FL.side(c, 3)) * (8 - FL.side(c, 4) - FL.side(c, 5));   // 512 = whole
})();
