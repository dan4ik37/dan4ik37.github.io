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
//   FL.decide(s, lean, out)    — does it go? out.go 0/1, out.dir (side it falls to), out.kind 1 notch + back cut (falls to the notch,
//                                the hinge steers it) · 2 cut through without a notch (falls to the hinge side: away from the deeper
//                                cut, or where the crown leans) · 3 heavy crown leans over a deep cut by itself (slow lean);
//                                out.hinge — eighths of wood left. lean = [crown offset +x, +z in eighths × crown mass share ‰]
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
    // 1) notch + back cut: the hinge (wood between them) ≤ hmax → falls to the notch
    if (n >= 0) {
      const o = FL.OPP[n], rem = full - s[n] - s[o];
      out.hinge = rem;
      if (rem <= hmax) { out.go = 1; out.dir = s[o] > 0 ? n : o; out.kind = s[o] > 0 ? 1 : 2; return out; }   // no back cut: one deep cut — the wood left is behind it
    }
    // 2) an axis cut (nearly) through without a proper notch: falls to the side where the wood is left (away from the deeper cut);
    //    equal cuts — to the crown lean along that axis, else the lowest side
    for (let ax = 0; ax < 2; ax++) {
      const a = ax * 2, b = a + 1, rem = full - s[a] - s[b];
      if (rem > hmax || n === a || n === b) continue;   // the notch axis is handled above
      const ln = lean ? lean[ax] : 0;
      out.go = 1; out.kind = 2; out.hinge = rem;
      out.dir = s[a] > s[b] ? b : s[b] > s[a] ? a : ln > 0 ? a : ln < 0 ? b : a;
      return out;
    }
    // 3) heavy crown over a deep cut: the cut side carries the crown's moment — leans over by itself (slow)
    if (lean) for (let side = 0; side < 4; side++) {
      const o = FL.OPP[side], ln = side === 0 ? lean[0] : side === 1 ? -lean[0] : side === 2 ? lean[1] : -lean[1];
      const rem = full - s[side] - s[o];
      if (ln >= 8 * D && s[side] * 2 >= full && rem * 3 <= full) { out.go = 1; out.dir = side; out.kind = 3; out.hinge = rem; return out; }
    }
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
