// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — стрелки редактора (как в Roblox Studio): двигать (3 оси), вращать (3 кольца), размер (6 ручек),
//  привязка к сетке и к углу; рисуются поверх всего, на экране всегда одного размера
// ═══════════════════════════════════════
// G = D37E.gizmo(R); G.setMode('move' | 'rotate' | 'scale' | null); G.attach({ pos, rot, size, model }) или null;
// каждый кадр G.update(); мышь/палец: G.hover(raycaster), G.down(raycaster) → true, если взялись за ручку;
// G.drag(raycaster) → { pos?, rot?, size? } (новые значения, уже с привязкой); G.up() → были ли изменения.
// G.snap — шаг сетки (0 — свободно), G.rsnap — шаг угла в градусах (0 — свободно). Двигать и вращать — по осям мира,
// размер — по осям самой детали и только с одной стороны (как в Roblox: тянешь грань — сдвигается только она).
(() => {
  const E = window.D37E = window.D37E || {};
  const DEG = Math.PI / 180;

  E.gizmo = function (R){
    const T = R.T, root = new T.Group();
    root.visible = false; root.renderOrder = 999;
    R.scene.add(root);
    const COL = ['#ef4444', '#22c55e', '#3b82f6'], AX = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
    const top = (c, o = .95) => new T.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, opacity: o, toneMapped: false, fog: false });
    const hitMat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, colorWrite: false });
    const own = [hitMat];
    const mk = (geo, mat, parent) => { const m = new T.Mesh(geo, mat); m.renderOrder = 999; parent.add(m); own.push(geo); if (mat !== hitMat) own.push(mat); return m; };
    const G = { mode: null, target: null, snap: 1, rsnap: 15, dragging: false, changed: false, hot: null };

    // ── Двигать: стрелки ──
    const moveG = new T.Group(); root.add(moveG);
    const moveHits = [];
    AX.forEach((a, i) => {
      const g = new T.Group(); moveG.add(g);
      const mat = top(COL[i]);
      const shaft = mk(new T.CylinderGeometry(.035, .035, 1.5, 8), mat, g); shaft.position.y = .75;
      const head = mk(new T.ConeGeometry(.13, .38, 14), mat, g); head.position.y = 1.65;
      const hit = mk(new T.CylinderGeometry(.2, .2, 1.95, 6), hitMat, g); hit.position.y = .98;
      hit.userData.h = { kind: 'move', axis: i, mat };
      moveHits.push(hit);
      if (i === 0) g.rotation.z = -Math.PI / 2; else if (i === 2) g.rotation.x = Math.PI / 2;
    });
    // ── Вращать: кольца ──
    const rotG = new T.Group(); root.add(rotG);
    const rotHits = [];
    AX.forEach((a, i) => {
      const mat = top(COL[i], .9);
      const ring = mk(new T.TorusGeometry(1.35, .025, 6, 64), mat, rotG);
      const hit = mk(new T.TorusGeometry(1.35, .14, 6, 32), hitMat, rotG);
      for (const m of [ring, hit]) { if (i === 0) m.rotation.y = Math.PI / 2; else if (i === 1) m.rotation.x = Math.PI / 2; }
      hit.userData.h = { kind: 'rot', axis: i, mat, ring };
      rotHits.push(hit);
    });
    // ── Размер: ручки на гранях (по осям детали) ──
    const scaleG = new T.Group(); root.add(scaleG);
    const scaleHits = [];
    AX.forEach((a, i) => [1, -1].forEach(sg => {
      const mat = top(COL[i]);
      const cube = mk(new T.SphereGeometry(.13, 12, 8), mat, scaleG);
      const hit = mk(new T.SphereGeometry(.3, 8, 6), hitMat, scaleG);
      cube.position.copy(a).multiplyScalar(1.2 * sg); hit.position.copy(cube.position);
      hit.userData.h = { kind: 'scale', axis: i, sign: sg, mat, cube };
      scaleHits.push(hit);
    }));

    G.setMode = m => { G.mode = m; G.update(); };
    G.attach = t => { G.target = t; G.update(); };
    const center = new T.Vector3(), quat = new T.Quaternion(), eu = new T.Euler();
    G.update = () => {
      const t = G.target;
      root.visible = !!t && !!G.mode;
      if (!root.visible) return;
      moveG.visible = G.mode === 'move'; rotG.visible = G.mode === 'rotate'; scaleG.visible = G.mode === 'scale' && !t.model && !!t.size;
      center.set(...t.center);
      root.position.copy(center);
      // модель вращается только вокруг вертикали
      rotG.children.forEach((m, k) => { m.visible = !t.model || (k >> 1) === 1; });
      const cam = R.camera.position, s = Math.max(.25, center.distanceTo(cam) * .085);
      root.scale.setScalar(s);
      // ручки размера — по осям детали и у её граней
      if (scaleG.visible) {
        eu.set((t.rot?.[0] || 0) * DEG, (t.rot?.[1] || 0) * DEG, (t.rot?.[2] || 0) * DEG, 'YXZ'); quat.setFromEuler(eu);
        scaleG.quaternion.copy(quat);
        scaleHits.forEach(h => {
          const d = h.userData.h, off = (t.size[d.axis] / 2) / s + .32;
          h.position.copy(AX[d.axis]).multiplyScalar(off * d.sign); d.cube.position.copy(h.position);
        });
      }
    };
    const hits = () => G.mode === 'move' ? moveHits : G.mode === 'rotate' ? rotHits.filter(h => h.parent.visible && h.visible !== false && (!G.target?.model || h.userData.h.axis === 1)) : G.mode === 'scale' ? scaleHits : [];
    function pickHandle(ray){
      if (!root.visible) return null;
      root.updateMatrixWorld(true);
      const hs = ray.intersectObjects(hits(), false);
      return hs.length ? hs[0].object.userData.h : null;
    }
    // Подсветка ручки под мышью
    G.hover = ray => {
      if (G.dragging) return;
      const h = pickHandle(ray);
      if (h === G.hot) return;
      if (G.hot) G.hot.mat.opacity = G.hot.kind === 'rot' ? .9 : .95;
      G.hot = h;
      if (h) h.mat.opacity = .45;
    };

    // ── Тянем ──
    let D = null;
    const tmp = new T.Vector3(), tmp2 = new T.Vector3(), plane = new T.Plane(), hitP = new T.Vector3();
    function lineParam(P0, A, ray){   // t на прямой P0 + t·A, ближайший к лучу
      const O = ray.ray.origin, Dd = ray.ray.direction;
      const w0 = tmp.copy(P0).sub(O), a = A.dot(A), b = A.dot(Dd), c = Dd.dot(Dd), d = A.dot(w0), e = Dd.dot(w0), den = a * c - b * b;
      if (Math.abs(den) < 1e-6) return null;
      return (b * e - c * d) / den;
    }
    function planeAngle(axis, ray){
      plane.setFromNormalAndCoplanarPoint(AX[axis], center);
      if (!ray.ray.intersectPlane(plane, hitP)) return null;
      const v = tmp2.copy(hitP).sub(center), u = AX[(axis + 1) % 3], w = AX[(axis + 2) % 3];
      return Math.atan2(v.dot(w), v.dot(u));
    }
    const snapV = (v, s) => s > 0 ? Math.round(v / s) * s : v;
    G.down = ray => {
      const h = pickHandle(ray), t = G.target;
      if (!h || !t) return false;
      D = { h, pos: t.pos.slice(), rot: (t.rot || [0, 0, 0]).slice(), size: t.size ? t.size.slice() : null, center: t.center.slice() };
      center.set(...t.center);
      if (h.kind === 'move') D.t0 = lineParam(center.clone(), AX[h.axis], ray);
      else if (h.kind === 'rot') { D.a0 = planeAngle(h.axis, ray); eu.set(D.rot[0] * DEG, D.rot[1] * DEG, D.rot[2] * DEG, 'YXZ'); D.q0 = new T.Quaternion().setFromEuler(eu); }
      else { eu.set(D.rot[0] * DEG, D.rot[1] * DEG, D.rot[2] * DEG, 'YXZ'); D.q0 = new T.Quaternion().setFromEuler(eu); D.dir = AX[h.axis].clone().applyQuaternion(D.q0); D.t0 = lineParam(center.clone(), D.dir, ray); }
      if (D.t0 === null || D.a0 === null) { D = null; return false; }
      G.dragging = true; G.changed = false;
      return true;
    };
    G.drag = ray => {
      if (!D) return null;
      const h = D.h, c0 = new T.Vector3(...D.center);
      if (h.kind === 'move') {
        const t = lineParam(c0, AX[h.axis], ray); if (t === null) return null;
        let d = snapV(t - D.t0, G.snap);
        const pos = D.pos.slice(); pos[h.axis] = +(D.pos[h.axis] + d).toFixed(4);   // шаг сетки — от исходного места (как в Roblox)
        G.changed = G.changed || d !== 0;
        return { pos };
      }
      if (h.kind === 'rot') {
        const a = planeAngle(h.axis, ray); if (a === null) return null;
        let da = (a - D.a0) / DEG; da = snapV(da, G.rsnap);
        const qd = new T.Quaternion().setFromAxisAngle(AX[h.axis], da * DEG), qn = qd.multiply(D.q0.clone());
        eu.setFromQuaternion(qn, 'YXZ');
        const rot = [eu.x / DEG, eu.y / DEG, eu.z / DEG].map(v => { let r = +(((v % 360) + 360) % 360).toFixed(2); if (r > 359.99) r = 0; return r; });
        G.changed = G.changed || da !== 0;
        return { rot };
      }
      // размер: тянем грань по оси детали
      const t = lineParam(c0, D.dir, ray); if (t === null) return null;
      let grow = snapV((t - D.t0) * h.sign, G.snap);
      const size = D.size.slice(), ns = Math.max(.1, +(D.size[h.axis] + grow).toFixed(4));
      grow = ns - D.size[h.axis]; size[h.axis] = ns;
      const off = D.dir.clone().multiplyScalar(grow / 2 * h.sign);
      const pos = [D.pos[0] + off.x, D.pos[1] + off.y, D.pos[2] + off.z].map(v => +v.toFixed(4));
      G.changed = G.changed || grow !== 0;
      return { size, pos };
    };
    G.up = () => { const ch = G.changed; D = null; G.dragging = false; G.changed = false; return ch; };
    G.dispose = () => { R.scene.remove(root); own.forEach(x => x.dispose?.()); };
    return G;
  };
})();
