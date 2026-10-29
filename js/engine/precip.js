// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — погода на экране во всех 3D-играх (16.10.2026, docs/SEASONS.md): дождь, снег, град вокруг камеры,
//  брызги и круги, мокрое и лужи, снег на поверхностях, осенняя листва, лёд, молния и гром, радуга, шум дождя и ветра
// ═══════════════════════════════════════
// Подключается после climate.js, gfx.js и render.js. Одна строка в игре:
//   X = D37E.climate.attach(R, { world, where, skyTop, water, origin, hour, sound, occlusion })   (поля — docs/SEASONS.md, раздел 5)
//   каждый кадр, до R.render(): X.frame(dt); выход: X.dispose()
// Состояние погоды (E.climate, W.at) — раз в 0,5 с в точке игрока; картинка подходит к нему плавно (тучи и дождь — за ~3 с).
// Небо, свет и туман — R.setWeather (render.js); поверхности — общие данные шейдеров E.GFXU.cl* только на время кадра
// (R.wx.pre/post; кусок шейдера — gfx.js, D37_CLIM). Где «над головой» что-то есть — карта высот сверху (256², рисуется раз
// в ~2,5 с или когда камера ушла, и только пока на земле есть снег/мокро); у «Кубомира» вместо неё — свет неба блока.
// Частицы (как в «Кубомире», kubomir-weather.js): пулы вокруг камеры — дождь и град (отрезки), снег (точки), круги на воде и
// в лужах (InstancedMesh колец), брызги (точки); капля появляется только выше skyTop(x, z) и разбивается о него — под крышей
// дождя нет. «Низкая» графика — без частиц (только небо и туман); телефон и «средняя» — 45 %; ⚙️ «🌦 Погода» → «Частицы».
// Человечки (toon/phong) погоду не получают; их корни (actors.js: userData.actor) в карту «что над головой» не попадают.
(() => {
  const E = window.D37E = window.D37E || {};
  const C = E.climate;
  if (!C) return;
  const PR = E.precip = E.precip || {};
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const sm = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ZERO2 = [0, 0];
  const RAD = 15;   // радиус частиц вокруг камеры (единиц)

  // ── настройки игрока (⚙️ «🌦 Погода», js/core/celebrate.js): эффекты погоды, сколько частиц, праздники ──
  PR.opts = () => {
    const S = window.D37Settings;
    let fx = true, amt = 100;
    try { if (S?.get) { fx = S.get('wxFx') !== false; amt = +S.get('wxAmt'); if (!Number.isFinite(amt)) amt = 100; } } catch (e) {}
    return { fx, amount: cl(amt, 0, 100) / 100 };
  };
  // «Где кончается небо» из физики движка: луч сверху вниз — первая крыша, навес, земля (кэш по клеткам, сброс раз в 3 с)
  PR.physTop = (ph, yTop = 400) => {
    const cache = new Map(); let t = 0;
    const f = (x, z) => {
      const now = performance.now();
      if (now - t > 3000) { cache.clear(); t = now; }
      const k = Math.floor(x) * 65536 + Math.floor(z);
      let v = cache.get(k);
      if (v === undefined) {
        let h = null;
        try { h = ph.raycast(Math.floor(x) + .5, yTop, Math.floor(z) + .5, 0, -1, 0, yTop + 300, c => !c.trigger && c.solid !== false); } catch (e) {}
        v = h ? h.y : (ph.groundAt ? ph.groundAt(x, z) : 0);
        if (!Number.isFinite(v)) v = -1e9;
        cache.set(k, v);
      }
      return v;
    };
    f.clear = () => cache.clear();
    return f;
  };
  // Свой материал листвы (игры): осенью желтеет, зимой тусклая; 'grass' | 'leaves' | 'needles'
  C.leaf = (m, kind) => E.leafMaterial ? E.leafMaterial(m, kind) : m;

  // ═══ Подключение погоды к рендереру ═══
  C.attach = (R, o = {}) => {
    const T = R.T, GU = E.GFXU, cam = R.camera;
    let W = o.world && typeof o.world.at === 'function' ? o.world : C.world(o.world || {});
    C.use(W);
    const where = typeof o.where === 'function' ? o.where : () => [cam.position.x, cam.position.y, cam.position.z];
    const origin = typeof o.origin === 'function' ? o.origin : () => ZERO2;
    const skyTop = typeof o.skyTop === 'function' ? o.skyTop : null;
    const waterAt = typeof o.water === 'function' ? o.water : null;
    const waveAt = typeof o.waveAt === 'function' ? o.waveAt : null;   // волны (waves.js): высота над спокойной гладью — круги дождя на волне
    const A = o.sound || null;
    // particles: false — свои частицы у игры («Кубомир»); sky: false — небо и туман игра темнит сама; occlusion: false — без карты сверху
    const qBase = o.particles === false || R.q === 'low' ? 0 : (E.isMobile?.() || R.q === 'mid') ? .45 : 1, useSky = o.sky !== false;
    const FR = E.rng ? E.rng((C.seedOf('precip') ^ (Date.now() & 0xffff)) >>> 0 || 7) : Math.random;
    const KEYS = ['cloud', 'rain', 'snow', 'hail', 'fog', 'heat', 'thunder', 'wet', 'puddle', 'snowCover', 'ice', 'autumn', 'bare', 'fresh', 'wind'];
    const X = { W, R, state: C.blank(), vis: {}, opts: PR.opts(), q: qBase, label: 'clear', rainbow: 0, rainMem: 0, occ: null, t: 0 };
    for (const k of KEYS) X.vis[k] = 0;
    let tq = 0, tOpt = 0, pend = '', pendN = 0, pushAt = 0;
    const sent = {};

    // ── столбы неба (как в «Кубомире»): кэш по клеткам, сброс раз в 3 с ──
    const cols = new Map(); let colsT = 0, topW = false;
    function top(xw, zw){   // мировые координаты → высота, где кончается небо (и topW — там вода)
      const k = Math.floor(xw) * 65536 + Math.floor(zw);
      let c = cols.get(k);
      if (c === undefined) {
        let y = skyTop ? skyTop(xw, zw) : -1e9, w = 0;
        if (waterAt) { const wl = waterAt(xw, zw); if (Number.isFinite(wl) && wl >= y - .02) { y = wl; w = 1; } }
        if (!Number.isFinite(y)) y = -1e9;
        c = [y, w]; cols.set(k, c);
      }
      topW = c[1] === 1;
      return c[0];
    }
    X.top = top;

    // ── частицы: дождь и град — отрезки (низ виден, верх прозрачный), снег — точки, круги, брызги ──
    const N_R = Math.round(600 * qBase), N_S = Math.round(500 * qBase), N_RP = qBase ? 40 : 0, N_SP = qBase ? 96 : 0;
    const rx = new Float64Array(N_R), ry = new Float64Array(N_R), rz = new Float64Array(N_R), rv = new Float32Array(N_R), rl = new Float32Array(N_R), rt = new Float32Array(N_R), rw = new Uint8Array(N_R), rlive = new Uint8Array(N_R), rh = new Uint8Array(N_R), rcx = new Int32Array(N_R), rcz = new Int32Array(N_R);
    let rainO = null, rPos = null, rCol = null;
    if (N_R) {
      rPos = new Float32Array(N_R * 6); rCol = new Float32Array(N_R * 8);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(rPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(rCol, 4).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      rainO = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true }));
      rainO.frustumCulled = false; rainO.visible = false; rainO.renderOrder = 6; R.scene.add(rainO);
    }
    const sx = new Float64Array(N_S), sy = new Float64Array(N_S), sz = new Float64Array(N_S), sv = new Float32Array(N_S), sp = new Float32Array(N_S), stp = new Float32Array(N_S), slive = new Uint8Array(N_S), scx = new Int32Array(N_S), scz = new Int32Array(N_S);
    let snowO = null, sPos = null, sCol = null, flakeTex = null, dotTex = null;
    const roundTex = (n, soft) => {
      const d = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy), i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = r >= 1 ? 0 : Math.round(255 * Math.min(1, (1 - r) * soft)); }
      const t = new T.DataTexture(d, n, n, T.RGBAFormat); t.magFilter = t.minFilter = T.LinearFilter; t.needsUpdate = true; return t;
    };
    if (N_S) {
      sPos = new Float32Array(N_S * 3); sCol = new Float32Array(N_S * 3);
      flakeTex = roundTex(16, 1.8);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(sCol, 3).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      snowO = new T.Points(g, new T.PointsMaterial({ size: .15, map: flakeTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
      snowO.frustumCulled = false; snowO.visible = false; snowO.renderOrder = 6; R.scene.add(snowO);
    }
    // круги на воде и в лужах (сложение: гаснут цветом)
    const ppx = new Float64Array(N_RP), ppy = new Float32Array(N_RP), ppz = new Float64Array(N_RP), ppt = new Float32Array(N_RP).fill(9);
    let ripO = null, rpHead = 0, rpLive = 0;
    const DUM = new T.Object3D();
    if (N_RP) {
      const g = new T.RingGeometry(.3, .38, 18); g.rotateX(-Math.PI / 2);
      ripO = new T.InstancedMesh(g, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: .5, toneMapped: false }), N_RP);
      ripO.instanceMatrix.setUsage(T.DynamicDrawUsage);
      ripO.instanceColor = new T.InstancedBufferAttribute(new Float32Array(N_RP * 3), 3); ripO.instanceColor.setUsage(T.DynamicDrawUsage);
      ripO.count = 0; ripO.visible = false; ripO.frustumCulled = false; ripO.renderOrder = 6; R.scene.add(ripO);
    }
    const ripple = (x, y, z) => { const j = rpHead; rpHead = (rpHead + 1) % N_RP; ppx[j] = x; ppy[j] = y; ppz[j] = z; ppt[j] = 0; rpLive = 1; };
    // брызги: по 3 точки разлетаются и падают (0,3 с)
    const bx = new Float32Array(N_SP), by = new Float32Array(N_SP), bz = new Float32Array(N_SP), bvx = new Float32Array(N_SP), bvy = new Float32Array(N_SP), bvz = new Float32Array(N_SP), bt = new Float32Array(N_SP).fill(9);
    let splO = null, bPos = null, bCol = null, bHead = 0, bLive = 0;
    if (N_SP) {
      bPos = new Float32Array(N_SP * 3); bCol = new Float32Array(N_SP * 3); dotTex = roundTex(8, 1.4);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(bPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(bCol, 3).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, N_SP);
      splO = new T.Points(g, new T.PointsMaterial({ size: .07, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
      splO.frustumCulled = false; splO.visible = false; splO.renderOrder = 6; R.scene.add(splO);
    }
    const splash = (x, y, z, c) => {
      for (let n = 0; n < 3; n++) {
        const j = bHead; bHead = (bHead + 1) % N_SP;
        const a = FR() * 6.283, v = .6 + FR() * .8;
        bx[j] = x; by[j] = y + .03; bz[j] = z; bvx[j] = Math.cos(a) * v; bvz[j] = Math.sin(a) * v; bvy[j] = 1.2 + FR() * 1.2; bt[j] = 0;
        bCol[j * 3] = c * .85; bCol[j * 3 + 1] = c * .92; bCol[j * 3 + 2] = c;
      }
      bLive = 1;
    };
    for (const ob of [rainO, snowO, ripO, splO]) if (ob) R.occHide?.add(ob);
    // особая погода по биому (T-135, wx-fx.js): песок, пыль и снег в воздухе, позёмка, цвет неба и тумана, видимость
    const WFX = E.wxfx?.attach ? E.wxfx.attach(R, { top, origin, q: qBase }) : null;
    X.wfx = WFX;

    // капля / град / хлопок — в случайной точке над камерой, только если столб там открыт выше точки
    function spawnDrop(i, cx, cy, cz, fill, hail){
      const OO = origin(), ox = OO[0], oz = OO[1];
      for (let k = 0; k < 3; k++) {
        const x = cx + (FR() - .5) * 2 * RAD, z = cz + (FR() - .5) * 2 * RAD, y = fill ? cy - 5 + FR() * 19 : cy + 7 + FR() * 9, tp = top(x + ox, z + oz);
        if (tp >= y - .5) continue;
        rx[i] = x; ry[i] = y; rz[i] = z; rt[i] = Math.max(tp, cy - 40); rw[i] = topW ? 1 : 0; rh[i] = hail ? 1 : 0;
        const hs = hail ? +X.state.hailSize || 0 : 0;   // град особой погоды: длина по размеру (горошина … теннисный мяч)
        rv[i] = hail ? 19 + FR() * 4 : 13 + FR() * 4; rl[i] = hail ? (hs > 0 ? .06 + hs * .07 : .16) + FR() * .06 : .65 + FR() * .4; rlive[i] = 1; rcx[i] = Math.floor(x); rcz[i] = Math.floor(z);
        return;
      }
      rlive[i] = 0;
    }
    function spawnFlake(i, cx, cy, cz, fill){
      const OO = origin(), ox = OO[0], oz = OO[1];
      for (let k = 0; k < 3; k++) {
        const x = cx + (FR() - .5) * 2 * RAD, z = cz + (FR() - .5) * 2 * RAD, y = fill ? cy - 5 + FR() * 17 : cy + 8 + FR() * 6, tp = top(x + ox, z + oz);
        if (tp >= y - .3) continue;
        sx[i] = x; sy[i] = y; sz[i] = z; stp[i] = Math.max(tp, cy - 40); sv[i] = .9 + FR() * .8; sp[i] = FR() * 6.283; slive[i] = 1; scx[i] = Math.floor(x); scz[i] = Math.floor(z);
        return;
      }
      slive[i] = 0;
    }

    // ── карта «что над головой»: сверху вниз, высоты (16 бит на 256 единиц) в RGBA8; B = 1 — что-то есть ──
    function occInit(){
      if (X.occ || o.occlusion === false || !GU.occRT) return;
      const mob = !!E.isMobile?.(), px = mob ? 128 : 256, size = mob ? 96 : 128;
      GU.occRT.setSize(px, px);
      const camO = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, .1, 600);
      camO.up.set(0, 0, -1);
      const mat = new T.ShaderMaterial({
        uniforms: { uY0: { value: 0 } }, side: T.DoubleSide, fog: false, toneMapped: false,
        vertexShader: `varying float vY;
void main(){
#include <begin_vertex>
  vec4 d37w = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  d37w = instanceMatrix * d37w;
#endif
  d37w = modelMatrix * d37w;
  vY = d37w.y;
  gl_Position = projectionMatrix * viewMatrix * d37w;
}`,
        fragmentShader: `uniform float uY0; varying float vY;
void main(){
  float h = floor( clamp( ( vY - uY0 ) / 256.0, 0.0, 1.0 ) * 65535.0 ), hi = floor( h / 256.0 ), lo = h - hi * 256.0;
  gl_FragColor = vec4( hi / 255.0, lo / 255.0, 1.0, 1.0 );
}`,
      });
      mat.name = 'occ';
      X.occ = { cam: camO, mat, px, size, cx: 0, cz: 0, y0: 0, at: -1e9, ready: false, n: 0 };
    }
    function occUpdate(now){
      const Oc = X.occ; if (!Oc) return;
      const p = cam.position, d = Math.hypot(p.x - Oc.cx, p.z - Oc.cz);
      if (Oc.ready && now - Oc.at < 2500 && d < Oc.size * .18) return;
      const tex = Oc.size / Oc.px;
      Oc.cx = Math.round(p.x / tex) * tex; Oc.cz = Math.round(p.z / tex) * tex; Oc.y0 = Math.round(p.y) - 96;
      Oc.cam.position.set(Oc.cx, p.y + 220, Oc.cz); Oc.cam.lookAt(Oc.cx, p.y - 100, Oc.cz); Oc.cam.updateMatrixWorld();
      Oc.mat.uniforms.uY0.value = Oc.y0;
      // человечки и питомцы (actors.js) — не крыша: под ними снег не пропадает
      const hid = [];
      for (const c of R.scene.children) if (c.visible && c.userData?.actor) { c.visible = false; hid.push(c); }
      try { R.renderOcc(Oc.cam, GU.occRT, Oc.mat); Oc.ready = true; Oc.n++; } catch (e) { console.warn('погода: карта «что над головой»', e); X.occ = null; }
      for (const c of hid) c.visible = true;
      Oc.at = now;
    }

    // ── кадр: данные шейдеров погоды (только на время кадра) ──
    const shadersOn = () => X.opts.fx && E.climShaders && !E.gfxSafe?.('clim');
    R.wx = {
      pre(now){
        if (!shadersOn()) { R.wxOn = false; return; }
        const V = X.vis, p = cam.position, OO = origin(), ox = OO[0], oz = OO[1];
        R.wxOn = V.snowCover + V.wet + V.puddle + V.ice + V.autumn + V.bare + V.fresh > .02;   // страж графики: проверить кадр с погодой
        const need = V.snowCover > .01 || V.wet > .01 || V.puddle > .01;
        if (need && o.occlusion !== false) { occInit(); occUpdate(now); }
        GU.cl[0] = V.snowCover; GU.cl[1] = V.wet; GU.cl[2] = V.puddle; GU.cl[3] = V.ice;
        GU.cl2[0] = V.autumn; GU.cl2[1] = V.bare; GU.cl2[2] = V.fresh; GU.cl2[3] = V.rain;
        const wx = p.x + ox, wz = p.z + oz;
        GU.clO[0] = ((wx % 256) + 256) % 256; GU.clO[1] = ((wz % 256) + 256) % 256; GU.clO[2] = X.t % 1000; GU.clO[3] = X.occ?.ready && need ? 1 : 0;
        if (X.occ) { GU.clM[0] = X.occ.cx - p.x; GU.clM[1] = X.occ.cz - p.z; GU.clM[2] = 1 / X.occ.size; GU.clM[3] = X.occ.y0 - p.y; }
      },
      post(){ GU.cl.fill(0); GU.cl2.fill(0); GU.clO.fill(0); GU.clM.fill(0); },
    };

    // ── небо: радуга — только где купол её умеет (D37_RBOW) ──
    const skyM = R.scene.children.find(c => c.userData?.sky)?.material || null;
    if (skyM && skyM.uniforms?.uRb && R.q !== 'low') { skyM.defines = { ...(skyM.defines || {}), D37_RBOW: 1 }; skyM.needsUpdate = true; }

    // ── логика: состояние в точке игрока (раз в 0,5 с), картинка — плавно ──
    let hR = null, hW = null, thT = 15 + FR() * 20, thS = -1, fillR = true, fillS = true, naW = 0, nsW = 0;
    X.frame = (dt = 1 / 60) => {
      const d = Math.min(.1, Math.max(0, dt)), now = performance.now();
      X.t += d;
      if ((tOpt -= d) <= 0) { tOpt = 1; X.opts = PR.opts(); }
      if ((tq -= d) <= 0) {
        tq = .5;
        const [px, py, pz] = where(), OO = origin(), ox = OO[0], oz = OO[1];
        try { X.state = W.at(px + ox, pz + oz, Date.now(), py); } catch (e) { X.state = C.blank(); }
        // смена погоды — событие (после двух одинаковых замеров подряд: без дрожи на границе)
        const lb = X.state.state;
        if (lb !== X.label) { if (pend === lb) { if (++pendN >= 2) { const prev = X.label; X.label = lb; pend = ''; C.emit('weather', { state: lb, prev, s: X.state, world: W }); } } else { pend = lb; pendN = 1; } }
        else pend = '';
      }
      const S = X.state, V = X.vis, fx = X.opts.fx && W.mode !== 'off';
      const k1 = 1 - Math.exp(-d / 3), k2 = 1 - Math.exp(-d / 6);
      for (const k of KEYS) {
        const tgt = fx ? (k === 'wind' ? S.wind || 0 : S[k] || 0) : 0, kk = k === 'wet' || k === 'puddle' || k === 'snowCover' || k === 'ice' || k === 'autumn' || k === 'bare' || k === 'fresh' ? k2 : k1;
        V[k] += (tgt - V[k]) * kk;
        if (Math.abs(V[k] - tgt) < .002) V[k] = tgt;
      }
      // радуга: дождь недавно кончился, солнце светит и не высоко, туч мало
      X.rainMem = Math.max(X.rainMem * Math.exp(-d / 150), V.rain);
      const M = R.sky, sunY = M?.sun ? M.sun[1] : 1, sunOk = M && M.lightI > .3 && sunY > .05 && sunY < .62 ? 1 : 0;
      X.rainbow += ((fx && useSky ? sm(.25, .6, X.rainMem) * (1 - sm(.04, .14, V.rain)) * (1 - sm(.45, .75, V.cloud)) * sunOk : 0) - X.rainbow) * k1;
      if (WFX) WFX.frame(d, fx ? S : null, X.q * X.opts.amount, 1 - cl(R.night || 0, 0, 1));   // особая погода: плавно, частицы
      // небо, свет, туман — когда заметно сдвинулось (не чаще 4 раз в секунду)
      if (useSky && now - pushAt > 250) {
        const wx = { cloud: V.cloud, rain: V.rain, snow: V.snow, fog: V.fog, heat: V.heat, storm: V.thunder, rainbow: X.rainbow };
        if (WFX) WFX.skyInto(wx);   // + dust, tint, tintK, vis (м), flat — render.js / gfx.js
        let ch = false; for (const k in wx) if (k !== 'tint' && Math.abs((sent[k] ?? -1) - wx[k]) > (k === 'vis' ? .5 : .015)) ch = true;
        if (ch) { pushAt = now; Object.assign(sent, wx); R.setWeather(fx && (wx.cloud + wx.rain + wx.snow + wx.fog + wx.heat > .005 || wx.rainbow > .005 || (WFX && WFX.active())) ? wx : null); }
      }
      if (qBase) particles(d, now);
      if (A) sound(d);
    };

    function particles(d, now){
      const V = X.vis, S = X.state, amt = X.q * X.opts.amount, p = cam.position, cx = p.x, cy = p.y, cz = p.z, OO = origin(), ox = OO[0], oz = OO[1];
      if ((colsT -= d) <= 0) { colsT = 3; cols.clear(); }
      const day = 1 - cl(R.night || 0, 0, 1), lum = .34 + .56 * day;
      const wd = S.windDir || 0, ws = (V.wind || 0) * (.75 + .5 * (S.gust || .5)), windX = Math.cos(wd) * ws * .11, windZ = Math.sin(wd) * ws * .11;
      // дождь и град
      const hailK = cl(V.hail, 0, 1), na = rainO ? Math.round(N_R * cl(V.rain * (1 - .5 * hailK) + hailK * .5, 0, 1) * amt) : 0;
      if (rainO) {
        if (!na) { if (rainO.visible) { rainO.visible = false; rlive.fill(0); fillR = true; naW = 0; } }
        else {
          let born = 0;
          const cr = .7 * lum, cg = .78 * lum, cb = .94 * lum;
          for (let i = 0; i < na; i++) {
            if (!rlive[i]) { if (born < 90) { spawnDrop(i, cx, cy, cz, fillR, FR() < hailK * .6); born++; } }
            else {
              ry[i] -= rv[i] * d; rx[i] += windX * d; rz[i] += windZ * d;
              const ix = Math.floor(rx[i]), iz = Math.floor(rz[i]);
              if (ix !== rcx[i] || iz !== rcz[i]) { rcx[i] = ix; rcz[i] = iz; const tp = top(rx[i] + ox, rz[i] + oz); if (tp > ry[i]) spawnDrop(i, cx, cy, cz, false, rh[i] === 1); else { rt[i] = Math.max(tp, cy - 40); rw[i] = topW ? 1 : 0; } }
              if (rlive[i] && ry[i] <= rt[i]) {   // долетела: круг на воде / в луже, брызги
                const dx = rx[i] - cx, dz = rz[i] - cz;
                if (dx * dx + dz * dz < 100 && FR() < .35 && rt[i] > cy - 39) {
                  if (rw[i] && V.ice < .5) { if (ripO) ripple(rx[i], rt[i] + (waveAt ? waveAt(rx[i] + ox, rz[i] + oz) || 0 : 0), rz[i]); }   // на волне — круг на гребне (waves.js)
                  else if (V.puddle > .3 && FR() < V.puddle * .6) { if (ripO) ripple(rx[i], rt[i], rz[i]); }
                  else if (splO) splash(rx[i], rt[i], rz[i], rh[i] ? .95 : .75 * lum);
                }
                spawnDrop(i, cx, cy, cz, false, FR() < hailK * .6);
              } else if (rlive[i] && (Math.abs(rx[i] - cx) > RAD + 3 || Math.abs(rz[i] - cz) > RAD + 3)) spawnDrop(i, cx, cy, cz, false, rh[i] === 1);
            }
            const j6 = i * 6, j8 = i * 8;
            if (rlive[i]) {
              const l = rl[i], hl = rh[i] === 1;
              rPos[j6] = rx[i]; rPos[j6 + 1] = ry[i]; rPos[j6 + 2] = rz[i]; rPos[j6 + 3] = rx[i] - windX * l * .07; rPos[j6 + 4] = ry[i] + l; rPos[j6 + 5] = rz[i] - windZ * l * .07;
              const a = hl ? .95 : .6, c0 = hl ? .95 * lum + .05 : cr, c1 = hl ? .97 * lum + .05 : cg, c2 = hl ? lum + .05 : cb;
              rCol[j8] = c0; rCol[j8 + 1] = c1; rCol[j8 + 2] = c2; rCol[j8 + 3] = a; rCol[j8 + 4] = c0; rCol[j8 + 5] = c1; rCol[j8 + 6] = c2; rCol[j8 + 7] = hl ? .5 : 0;
            } else { rCol[j8 + 3] = 0; rCol[j8 + 7] = 0; rPos[j6 + 1] = rPos[j6 + 4] = -9999; }
          }
          fillR = false;
          for (let i = na; i < naW; i++) rlive[i] = 0;
          naW = na;
          const g = rainO.geometry; g.setDrawRange(0, na * 2); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; rainO.visible = true;
        }
      }
      // круги
      if (ripO && rpLive) {
        let k = 0;
        for (let j = 0; j < N_RP; j++) {
          if (ppt[j] >= .55) continue;
          ppt[j] += d; if (ppt[j] >= .55) continue;
          const f = ppt[j] / .55, s = .25 + .95 * f, c = .45 * (1 - f) * lum;
          DUM.position.set(ppx[j], ppy[j] + .015, ppz[j]); DUM.scale.set(s, 1, s); DUM.updateMatrix();
          ripO.setMatrixAt(k, DUM.matrix); ripO.instanceColor.setXYZ(k, c * .8, c * .9, c); k++;
        }
        ripO.count = k; ripO.visible = k > 0; rpLive = k;
        if (k) { ripO.instanceMatrix.needsUpdate = true; ripO.instanceColor.needsUpdate = true; }
      } else if (ripO && ripO.visible) ripO.visible = false;
      // брызги
      if (splO && bLive) {
        let live = 0;
        for (let j = 0; j < N_SP; j++) {
          if (bt[j] >= .3) { bPos[j * 3 + 1] = -9999; continue; }
          bt[j] += d; bvy[j] -= 9 * d; bx[j] += bvx[j] * d; by[j] += bvy[j] * d; bz[j] += bvz[j] * d; live++;
          bPos[j * 3] = bx[j]; bPos[j * 3 + 1] = bt[j] >= .3 ? -9999 : by[j]; bPos[j * 3 + 2] = bz[j];
        }
        bLive = live; splO.visible = live > 0;
        splO.geometry.attributes.position.needsUpdate = true; splO.geometry.attributes.color.needsUpdate = true;
      } else if (splO && splO.visible) splO.visible = false;
      // снег (в метель — быстрее и косее)
      const ns = snowO ? Math.round(N_S * cl(V.snow, 0, 1) * amt) : 0;
      if (snowO) {
        if (!ns) { if (snowO.visible) { snowO.visible = false; slive.fill(0); fillS = true; nsW = 0; } }
        else {
          let born = 0;
          const c = .9 * lum, bl = cl((V.wind - 7) / 8, 0, 1), fall = 1 + bl * 1.5;
          for (let i = 0; i < ns; i++) {
            if (!slive[i]) { if (born < 70) { spawnFlake(i, cx, cy, cz, fillS); born++; } }
            else {
              sy[i] -= sv[i] * fall * d; sx[i] += (windX * 2.4 + Math.sin(X.t * 1.3 + sp[i]) * .45) * d; sz[i] += (windZ * 2.4 + Math.cos(X.t * 1.1 + sp[i] * 1.3) * .45) * d;
              const ix = Math.floor(sx[i]), iz = Math.floor(sz[i]);
              if (ix !== scx[i] || iz !== scz[i]) { scx[i] = ix; scz[i] = iz; const tp = top(sx[i] + ox, sz[i] + oz); if (tp > sy[i]) spawnFlake(i, cx, cy, cz, false); else stp[i] = Math.max(tp, cy - 40); }
              if (slive[i] && (sy[i] <= stp[i] || Math.abs(sx[i] - cx) > RAD + 3 || Math.abs(sz[i] - cz) > RAD + 3)) spawnFlake(i, cx, cy, cz, false);
            }
            const j3 = i * 3;
            if (slive[i]) { sPos[j3] = sx[i]; sPos[j3 + 1] = sy[i]; sPos[j3 + 2] = sz[i]; sCol[j3] = c; sCol[j3 + 1] = c; sCol[j3 + 2] = c * 1.05; }
            else sPos[j3 + 1] = -9999;
          }
          fillS = false;
          for (let i = ns; i < nsW; i++) slive[i] = 0;
          nsW = ns;
          const g = snowO.geometry; g.setDrawRange(0, ns); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; snowO.visible = true;
        }
      }
      // молния: в сильную грозу раз в 25–60 с — вспышка (мягко: игра для детей), через 1–3 с — далёкий гром
      if (R.flashK > 0) R.flashK = R.flashK < .01 ? 0 : R.flashK * Math.exp(-d * 9);
      if (V.thunder > .55 && X.opts.fx) {
        if ((thT -= d) <= 0) {
          thT = 25 + FR() * 35;
          const [px, py, pz] = where(), covered = top(px + ox, pz + oz) > py + 2.5;
          R.flashK = (covered ? .25 : .55) + .2 * FR();
          thS = 1 + FR() * 2;
        }
      }
      if (thS > 0 && (thS -= d) <= 0) { thS = -1; try { A?.play?.('wx_thunder', { vol: .32 + .18 * FR(), rate: .85 + FR() * .3 }); } catch (e) {} }
    }
    // звук: шум дождя (под крышей — тише и глуше), ветер в метель и на сильном ветру
    function sound(d){
      if (!A?.loop) return;
      const V = X.vis, [px, py, pz] = where(), OO = origin(), ox = OO[0], oz = OO[1], covered = top(px + ox, pz + oz) > py + 2.5;
      const du = WFX ? Math.max(WFX.K.dust, WFX.K.flat * .5) : 0;   // буря: ветер громче и ниже (песок шипит, буран воет)
      const vr = V.rain * .5 * (covered ? .35 : 1), vw = Math.max(V.snow * .35, cl((V.wind - 6) / 10, 0, 1) * .3, du * .55) * (covered ? .4 : 1);
      if (vr > .005 && !hR) hR = A.loop('amb_rain', { vol: 0 });
      if (hR) { if (vr <= .005 && V.rain < .003) { hR.stop(); hR = null; } else hR.set({ vol: vr, rate: covered ? .76 : 1 }); }
      if (vw > .005 && !hW) hW = A.loop('amb_wind', { vol: 0 });
      if (hW) { if (vw <= .005) { hW.stop(); hW = null; } else hW.set({ vol: vw, rate: (covered ? .8 : 1) * (1 - .18 * du) }); }
    }

    // ── управление ──
    X.force = st => { W.set({ weather: st && C.STATES.includes(st) ? st : 'auto' }); tq = 0; };
    X.setWorld = w => { W = w && typeof w.at === 'function' ? w : C.world(w || {}); X.W = W; C.use(W); tq = 0; return W; };
    X.iceAt = (x, z) => X.vis.ice;   // по льду ходить — от .8
    X.stats = () => ({ state: X.label, season: X.state.season, temp: +(X.state.temp || 0).toFixed(1), rain: +X.vis.rain.toFixed(2), snow: +X.vis.snow.toFixed(2), cover: +X.vis.snowCover.toFixed(2),
      wet: +X.vis.wet.toFixed(2), drops: rainO?.visible ? rainO.geometry.drawRange.count / 2 : 0, flakes: snowO?.visible ? snowO.geometry.drawRange.count : 0, ripples: ripO?.visible ? ripO.count : 0,
      occ: X.occ ? X.occ.n : 0, shaders: shadersOn(), special: X.state.special || '', wx: WFX ? WFX.stats() : null });
    X.objects = () => ({ rain: rainO, snow: snowO, ripples: ripO, splash: splO, drops: { rx, ry, rz, rt, live: rlive, n: N_R }, flakes: { sx, sy, sz, stp, live: slive, n: N_S } });
    X.dispose = () => {
      hR?.stop(); hW?.stop(); hR = hW = null;
      WFX?.dispose();
      if (R.wx) { R.wx.post?.(); R.wx = null; }
      R.wxOn = false;
      R.flashK = 0;
      if (useSky) try { R.setWeather?.(null); } catch (e) {}
      for (const ob of [rainO, snowO, ripO, splO]) if (ob) { R.occHide?.delete(ob); R.scene.remove(ob); ob.geometry.dispose(); ob.material.dispose(); }
      flakeTex?.dispose(); dotTex?.dispose(); X.occ?.mat.dispose(); cols.clear();
      if (C.current() === W) C.use(null);
    };
    return X;
  };
})();
