// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика: рендерер, свет и тени, небо с солнцем и облаками, материалы (PBR + текстуры с рельефом),
//  вода, детали (как блоки в Роблоксе), готовые предметы и склейка статичного мира в несколько вызовов отрисовки;
//  лампы — постоянный набор настоящих источников, тени перерисовываются по делу, динамическое разрешение, постобработка
// ═══════════════════════════════════════
// R = D37E.renderer(container, { quality, post, lights, dynRes }) → { T, K (World3D.kit: человечки), r, scene, camera, q, sun }.
// Качество: low (слабые телефоны, «Экономный» режим) — без теней, текстур и постобработки; mid — тени 1024, 4 лампы;
// high — мягкие тени 2048, текстуры с картами нормалей, 8 ламп. Свой выбор — localStorage d37_gfx (low/mid/high).
// Свет — как упрощённый HDRP: солнце (направленный свет с тенями, коробка теней ездит за игроком — R.follow(x, z)),
// небо (освещение и отражения от неба: PMREM из купола), тональная кривая ACES. Материалы: R.mat(цвет, { rough, metal,
// flat, emissive }), R.tex(имя, { tint, tile (м на повтор), rough }) — img/tex/<имя>.jpg + _n.jpg (нормали; CC0 из Unity-
// проекта, scripts/make-textures.py); R.canvasTex(…) — текстура кодом. R.water(цвет) — вода (рябь движется).
// Детали: R.part(parent, { s: 'box'|'cyl'|'cone'|'ball'|'ico'|'torus'|'ring'|'disc'|'plane', x, y, z, w, h, d (r), yaw, rx, rz,
// c: цвет, m: 'basic'|'glow'|'ds'|материал }). Предметы: R.prefab(имя, opts, phys). Всё статичное — в R.static, затем
// R.bakeStatic(): склейка по материалу + UV «по миру» (текстура ложится ровно на любой размер) + тень у земли (AO).
// Каждый кадр: R.update(dt) (облака, вода), R.follow(x, z) (тени за игроком), R.render().
// Лампы: R.lights.add(src) — src: THREE.PointLight (вне сцены) или { position, color, intensity, distance, decay };
// настоящих источников всегда max (4/8, на low 0) — число света в шейдерах не меняется, шейдеры не пересобираются;
// каждый кадр им достаются самые важные лампы (видны, близко, ярко; плавная смена), у всех — ореол-свечение.
// Тени: карта солнца рисуется, только когда надо — R.shadowDirty() (что-то поменялось), R.shadowDirty(true) (движется —
// на high каждый кадр, на mid через кадр), коробка теней уехала; плюс страховка раз в 1,5 с.
// Свечение (bloom): R.bloom(материал, сила) — неон и лампочки светятся ореолом (js/engine/post.js).
// Перед кадром — R.preRender (склейка сцены js/engine/batch.js); счётчики кадра — R.stats (F3 — js/engine/perf.js).
// Графика v3 (js/engine/gfx.js, 15.10.2026): небо по времени суток (E.skyModel: солнце, луна, звёзды, заря, дымка) — купол
// рисуется последним из непрозрачного; свет неба (полусфера) и отражения (PMREM из купола 64–128 px, не чаще раза в 2–6 с);
// туман: по расстоянию + высотный + тёплый к солнцу (куски шейдеров three — E.gfxPatch); мягкие тени (PCSS-lite);
// вода v2 (R.water: рябь двумя слоями, глубина, пена, френель). R.lighting.gfx — настройки графики мира (E.worldGfx;
// полный объект освещения — мир загрузили — сбрасывает их, частичный — дописывает). Настройки игрока (window.D37Opt.gfx,
// js/core/gfx-settings.js) → E.gfxResolve → R.applyGfx(o): тени и их качество, AO, вода, отражения, сглаживание, туман,
// дальность (camera.far), цвет кадра, лимит FPS (E.fpsCap — core.js E.loop), масштаб разрешения, экономия батареи;
// пресет «Авто» сам снижает/поднимает ступени (E.autoSteps) по времени кадра. R.setUnder(вкл) — туман под водой.
(() => {
  const E = window.D37E = window.D37E || {};
  const PI = Math.PI, TAU = PI * 2;
  const TEX_DIR = 'img/tex/';

  E.gfxQuality = () => { try { const v = localStorage.getItem('d37_gfx'); if (['low', 'mid', 'high'].includes(v)) return v; } catch (e) {} return E.quality(); };
  // FSR (как режимы DLSS): кадр рисуется в доле разрешения, AMD FSR 1 в post.js чётко растягивает до экрана (d37_fsr).
  // «авто» — доля меняется сама (динамическое разрешение), растягивает тоже FSR
  E.FSR = { quality: .77, balanced: .67, performance: .59 };
  // 'native' — всегда 100% (без динамического разрешения): выбор в окне ⚙️ Настройки (js/core/settings.js)
  E.fsrMode = () => { try { const v = localStorage.getItem('d37_fsr'); if (E.FSR[v] || v === 'native') return v; } catch (e) {} return 'auto'; };

  // ── Динамическое разрешение — автомат без DOM (проверяется в node): D = E.dynRes({ target (мс кадра), min, step });
  // каждый кадр D.tick(интервал мс, ЦП кадра мс, now) → масштаб min…1. Решает 2 раза в секунду по среднему без худших 10%.
  // Медленно ≥ 1,5 с и упираемся не в скрипты — шаг вниз; не стало быстрее — вернуть и не трогать (30 с, дальше дольше).
  // Ровно ≥ 4 с — пробуем шаг вверх; стало медленно — назад и ждём (8 с, 16 с … до 2 мин): без «дёрганья».
  E.dynRes = (o = {}) => {
    const N = 48, buf = new Float32Array(N), cpu = new Float32Array(N), tmp = new Float32Array(N);
    const D = { on: o.on !== false, scale: 1, min: o.min ?? .6, max: o.max ?? 1, step: o.step ?? .1, target: o.target ?? 1000 / 60, changes: 0, avg: 0, cpuAvg: 0, why: '' };
    let n = 0, i = 0, next = 0, slow = 0, good = 0, upBack = 8000, downBack = 30000, noUp = 0, noDown = 0, probe = 0, probeEnd = 0, downFrom = 0, downAvg = 0, holdTo = 0;
    const r2 = v => Math.round(v * 100) / 100;
    const fresh = now => { n = 0; i = 0; next = now + 500; slow = 0; good = 0; };
    D.set = (s, now = 0) => { D.scale = Math.max(D.min, Math.min(D.max, s === 0 ? 0 : +s || 1)); probe = 0; downFrom = 0; fresh(now); return D.scale; };
    // подождать (второй автомат только что сменил своё — кадры до смены не считать)
    D.hold = (ms, now) => { holdTo = now + ms; fresh(now); };
    D.tick = (dt, c, now) => {
      if (!D.on || !(dt > 0)) return D.scale;
      if (dt > 250) { n = 0; i = 0; return D.scale; }   // пауза, вкладка в фоне — историю заново
      if (now < holdTo) { n = 0; i = 0; return D.scale; }
      buf[i] = dt; cpu[i] = c || 0; i = (i + 1) % N; if (n < N) n++;
      if (n < 24 || now < next) return D.scale;
      next = now + 500;
      for (let k = 0; k < n; k++) tmp[k] = buf[k];
      for (let k = n; k < N; k++) tmp[k] = 1e9;
      tmp.sort();
      const m = Math.max(1, Math.floor(n * .9));
      let sum = 0, cs = 0;
      for (let k = 0; k < m; k++) sum += tmp[k];
      for (let k = 0; k < n; k++) cs += cpu[k];
      const avg = D.avg = sum / m, cpuAvg = D.cpuAvg = cs / n, T = D.target;
      const isSlow = avg > T * 1.18, isOk = avg < T * 1.07, cpuBound = cpuAvg > T * .85;   // кадр занят скриптами — пиксели не помогут
      if (downFrom) {   // только что опустили: не стало быстрее на 6% — дело не в пикселях
        const f = downFrom; downFrom = 0;
        if (avg > downAvg * .94) { D.scale = f; noDown = now + downBack; downBack = Math.min(240000, downBack * 2); D.changes++; D.why = 'не помогло'; fresh(now); return D.scale; }
      }
      if (probe) {   // только что подняли: стало медленно — назад, вверх не скоро
        if (isSlow) { D.scale = probe; probe = 0; noUp = now + upBack; upBack = Math.min(120000, upBack * 2); D.changes++; D.why = 'назад'; fresh(now); return D.scale; }
        if (now > probeEnd) { probe = 0; upBack = Math.max(8000, upBack * .7); }
      }
      if (isSlow && !cpuBound) {
        good = 0;
        if (++slow >= 3 && D.scale > D.min + .001 && now >= noDown) { downFrom = D.scale; downAvg = avg; D.scale = r2(Math.max(D.min, D.scale - D.step)); D.changes++; D.why = 'медленно'; fresh(now); }
      } else if (isOk) {
        slow = 0;
        if (++good >= 8 && D.scale < D.max - .001 && now >= noUp) { probe = D.scale; probeEnd = now + 3000; D.scale = r2(Math.min(D.max, D.scale + D.step)); D.changes++; D.why = 'запас'; fresh(now); }
      } else { slow = Math.max(0, slow - 1); good = 0; }
      return D.scale;
    };
    return D;
  };

  // ── Выбор ламп для настоящего света (проверяется в node): recs — [{ score, slot }], n лучших с score > 0 → out
  // (по убыванию). У уже горящих (slot ≥ 0) запас 30% — при равных лампы не мигают туда-сюда.
  E.pickLights = (recs, n, out) => {
    out.length = 0;
    if (n <= 0) return out;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i], s = r.score * (r.slot >= 0 ? 1.3 : 1);
      r.eff = s;
      if (!(s > 0)) continue;
      if (out.length < n) out.push(r);
      else if (s > out[out.length - 1].eff) out[out.length - 1] = r;
      else continue;
      for (let k = out.length - 1; k > 0 && out[k].eff > out[k - 1].eff; k--) { const t = out[k]; out[k] = out[k - 1]; out[k - 1] = t; }
    }
    return out;
  };

  E.renderer = function (container, o = {}){
    const T = window.THREE, q = o.quality || E.gfxQuality();
    E.gfxPatch?.(T);   // туман и тени v3 — до первого материала (gfx.js)
    const K = window.World3D.kit(T, { q });   // человечки — по качеству
    // постобработка (post.js): сцена — в буфер HDR, сглаживает она (MSAA буфера или FXAA) — холсту своё не нужно
    const wantPost = q !== 'low' && o.post !== false && typeof E.post === 'function';
    const r = new T.WebGLRenderer({ antialias: q !== 'low' && !wantPost, powerPreference: 'high-performance' });
    let PR0 = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'mid' ? 1.5 : 2);   // плотность пикселей качества (R.applyGfx: prCap)
    r.setPixelRatio(PR0);
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = q === 'low' ? 1.0 : .98;
    r.info.autoReset = false;   // счётчики — за весь кадр (тени + сцена + постобработка); сброс — в R.render
    const shadows = q !== 'low';
    if (shadows) { r.shadowMap.enabled = true; r.shadowMap.type = q === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap; r.shadowMap.autoUpdate = false; }
    r.domElement.className = 'e-gl';
    container.prepend(r.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 1, .2, 800);
    const R = { T, K, r, scene, camera, q, static: new T.Group(), w: 1, h: 1, dead: false, anims: [], own: [], preRender: [], post: null, pr0: PR0, renderH: 1 };
    scene.add(R.static);
    // счётчики кадра (perf.js читает и сбрасывает суммы): вызовы отрисовки, треугольники, время
    const ST = R.stats = { calls: 0, tris: 0, scene: 0, sceneNoSh: 0, post: 0, shadow: 0, shadowNow: false, cpu: 0, cpuFrame: 0, dt: 0, frames: 0, sumDt: 0, maxDt: 0, sumCpu: 0, maxCpu: 0, sumR: 0, shadowUpd: 0 };

    // ═══ Свет: небо (полусфера) + солнце днём / луна ночью, с тенями ═══
    const SUN_DIR = new T.Vector3(-.55, .78, .3).normalize();   // направление на источник (солнце или луна)
    const hemi = new T.HemisphereLight('#d4eaff', '#7d6a4a', q === 'low' ? 1.0 : .42);
    scene.add(hemi);
    const sun = new T.DirectionalLight('#ffeccf', q === 'low' ? 1.25 : 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(90);
    if (shadows) {
      sun.castShadow = true;
      const s = q === 'high' ? 2048 : 1024, e = q === 'high' ? 34 : 26;
      sun.shadow.mapSize.set(s, s);
      Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 200 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.bias = -.00035; sun.shadow.normalBias = .035;
      sun.shadow.radius = q === 'high' ? 2 : 1.5;   // мягкость (тексели) — R.applyGfx / мягкость теней мира
    }
    scene.add(sun); scene.add(sun.target);
    R.sun = sun; R.hemi = hemi; R.sunDir = SUN_DIR;

    // ═══ Тени: карта солнца перерисовывается по делу (на неподвижной сцене — почти никогда) ═══
    // every — раз в сколько кадров, пока что-то движется; idle — страховка (мс); step — на сколько уехала коробка теней
    const SH = R.shadow = { every: q === 'high' ? 1 : 2, idle: 1500, step: q === 'high' ? 1.5 : 2, dirty: true, dyn: 0, n: 0, last: 0, updates: 0, ahead: .65 };
    R.shadowDirty = moving => { if (moving) SH.dyn = SH.every + 1; else SH.dirty = true; };
    function shadowTick(now){
      if (!shadows || !sun.castShadow) return false;
      SH.n++;
      const up = SH.dirty || (SH.dyn > 0 && SH.n % SH.every === 0) || now - SH.last > SH.idle;
      if (SH.dyn > 0) SH.dyn--;
      if (!up) return false;
      r.shadowMap.needsUpdate = true; SH.dirty = false; SH.last = now; SH.updates++;
      shTgt.copy(tgt);
      return true;
    }
    // Коробка теней едет за игроком и сдвинута туда, куда смотрит камера (SH.ahead — доля полуразмера впереди: за спиной
    // камеры тени почти не видно); шаг — ровно на тексель (иначе тени «дрожат» при ходьбе). Пока карта не перерисована,
    // приёмники берут старую матрицу тени — тени верные, просто коробка догонит при следующей перерисовке
    const lr = new T.Vector3(), lu = new T.Vector3(), tgt = new T.Vector3(), shTgt = new T.Vector3(1e9, 0, 0), camFw = new T.Vector3(), UPV = new T.Vector3(0, 1, 0);
    const FGself = { x: 0, y: 0, z: 0, ok: false };
    lr.crossVectors(UPV, SUN_DIR).normalize(); lu.crossVectors(SUN_DIR, lr).normalize();
    R.follow = (x, z, y = 0) => {
      FGself.x = x; FGself.y = y; FGself.z = z; FGself.ok = true;   // генерация кадров: свой персонаж — подвижный
      tgt.set(x, y, z);
      if (shadows) {
        const e = sun.shadow.camera.right;
        if (SH.ahead > 0) {
          camera.getWorldDirection(camFw); camFw.y = 0;
          const l = camFw.length();
          if (l > .2) {
            const fx = camFw.x / l, fz = camFw.z / l, along = (x - camera.position.x) * fx + (z - camera.position.z) * fz, k = Math.max(0, e * SH.ahead - along);
            tgt.x += fx * k; tgt.z += fz * k;
          }
        }
        const tex = (e * 2) / sun.shadow.mapSize.x;
        const a = tgt.dot(lr), b = tgt.dot(lu), da = Math.round(a / tex) * tex - a, db = Math.round(b / tex) * tex - b;
        tgt.addScaledVector(lr, da).addScaledVector(lu, db);
        if (tgt.distanceToSquared(shTgt) > SH.step * SH.step) SH.dirty = true;
      }
      sun.target.position.copy(tgt);
      sun.position.copy(tgt).addScaledVector(SUN_DIR, 100);
    };

    // ═══ Небо: купол по модели неба (gfx.js E.skyModel) — рисуется последним из непрозрачного, на дальней плоскости:
    //     пиксели под зданиями и землёй не считаются. Туман — цвета горизонта, к солнцу — теплее ═══
    const skyMat = E.skyMaterial(T);
    const sky = new T.Mesh(new T.SphereGeometry(10, 32, 16), skyMat);
    sky.renderOrder = 900; sky.frustumCulled = false; sky.userData.sky = true;
    scene.add(sky);
    scene.fog = new T.Fog('#bfe3ff', 110, 320);
    scene.background = new T.Color('#bfe3ff');
    // Освещение и отражения от неба (IBL): купол (+ земля) → кубическая карта 64/128 → PMREM; пересборка — по делу
    // (сменили свет — через 0,25 с; во время смены суток — не чаще раза в 2/4 с и если солнце сдвинулось)
    let envOut = null, envRT = null, envCam = null, envScene = null, envGnd = null, pmrem = null, envDue = 0, envAt = -1e9;
    const envSun = new T.Vector3(9, 9, 9);
    const hdr = r.capabilities.isWebGL2 ? r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float') : false;
    function makeEnv(){
      if (q === 'low' || R.dead) return;
      if (!pmrem) {
        pmrem = new T.PMREMGenerator(r);
        envRT = new T.WebGLCubeRenderTarget(q === 'high' ? 128 : 64, { type: hdr ? T.HalfFloatType : T.UnsignedByteType });
        envCam = new T.CubeCamera(.1, 50, envRT);
        envScene = new T.Scene();
        const em = E.skyMaterial(T, true); em.uniforms = skyMat.uniforms;
        envScene.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), em));
        envGnd = new T.Mesh(new T.CircleGeometry(9, 24), new T.MeshBasicMaterial({ color: '#6f7f55', toneMapped: false }));
        envGnd.rotation.x = -PI / 2; envGnd.position.y = -1.5; envScene.add(envGnd);
        R.own.push(em, envGnd.geometry, envGnd.material, envScene.children[0].geometry);
      }
      envGnd.material.color.setRGB(M.gnd[0] * .5 + M.ambGnd[0] * .5, M.gnd[1] * .5 + M.ambGnd[1] * .5, M.gnd[2] * .5 + M.ambGnd[2] * .5);
      envCam.update(r, envScene);
      const rt = pmrem.fromCubemap(envRT.texture);
      envOut?.dispose(); envOut = rt;
      if (R.opt.refl) scene.environment = rt.texture;
      envAt = performance.now(); envSun.copy(skyMat.uniforms.uSun.value);
    }
    R.envNow = () => { envDue = 0; makeEnv(); };

    // ═══ Время суток (как Lighting в Roblox): time 0–24, brightness, ambient, fogEnd, shadows + gfx — графика мира ═══
    const M = R.sky = E.skyModel(14);   // модель неба — один объект, без мусора
    const GU = E.GFXU, c3 = [0, 0, 0];
    const num = (v, d) => Number.isFinite(+v) ? +v : d;
    R.lighting = { time: 14, brightness: 1, ambient: 1, fogEnd: 320, shadows: true, gfx: E.worldGfx() };
    R.night = 0;
    let skyOver = null, under = null, skyT = 0;
    // полный объект освещения (мир загрузили из файла, шаблон, блок world гостю) — графика мира заново (не тянется
    // от прошлого мира); частичный (ползунок, смена суток) — дописывается (gfx.js E.mergeLighting)
    R.setLighting = (L = {}) => {
      if (!L || typeof L !== 'object') L = {};
      if ('time' in L && 'brightness' in L && 'fogEnd' in L) skyOver = null;
      E.mergeLighting(R.lighting, L);
      applyLighting();
    };
    // Старый способ (цвета неба вручную): верх, горизонт, низ; туман до far
    R.setSky = (top, mid, bot, near = 110, far = 320) => {
      skyOver = { zen: E.lin(top), hor: E.lin(mid), gnd: E.lin(bot || mid) };
      R.lighting.fogEnd = far;
      applyLighting();
    };
    function applyLighting(){
      const Lg = R.lighting, G = Lg.gfx, O = R.opt;
      E.skyModel(Lg.time, G.sky, M);
      if (skyOver) for (let j = 0; j < 3; j++) { M.zen[j] = skyOver.zen[j]; M.hor[j] = skyOver.hor[j]; M.gnd[j] = skyOver.gnd[j]; M.fogSun[j] = skyOver.hor[j]; }
      if (G.fog.color) {   // свой цвет тумана мира: и горизонт к нему
        E.lin(G.fog.color, c3);
        for (let j = 0; j < 3; j++) { M.hor[j] = M.hor[j] * .4 + c3[j] * .6; M.fogSun[j] = M.fogSun[j] * .5 + c3[j] * .5; M.gnd[j] = M.gnd[j] * .5 + c3[j] * .3; }
      }
      E.skyUniforms(skyMat.uniforms, M, skyT);
      // свет: солнце/луна
      const b = Math.max(0, num(Lg.brightness, 1)), amb = Math.max(0, num(Lg.ambient, 1));
      const moved = SUN_DIR.x !== M.lightDir[0] || SUN_DIR.y !== M.lightDir[1] || SUN_DIR.z !== M.lightDir[2];
      SUN_DIR.set(M.lightDir[0], M.lightDir[1], M.lightDir[2]);
      lr.crossVectors(UPV, SUN_DIR).normalize(); lu.crossVectors(SUN_DIR, lr).normalize();
      sun.color.setRGB(M.light[0], M.light[1], M.light[2]);
      sun.intensity = (q === 'low' ? 1.25 : 2.6) * M.lightI * b;
      // свет неба: цвет — небо (днём наполовину к белому, ночью синее), сила — по яркости неба (ночью — как лунный свет:
      // темно, но играть можно; на low света неба больше — без отражений неба)
      const mx = Math.max(M.ambSky[0], M.ambSky[1], M.ambSky[2], 1e-4), lumS = .2126 * M.ambSky[0] + .7152 * M.ambSky[1] + .0722 * M.ambSky[2], wh = .5 - .25 * M.night;
      hemi.color.setRGB(wh + (1 - wh) * M.ambSky[0] / mx, wh + (1 - wh) * M.ambSky[1] / mx, wh + (1 - wh) * M.ambSky[2] / mx);
      hemi.groundColor.setRGB(Math.min(.55, M.ambGnd[0] / mx), Math.min(.55, M.ambGnd[1] / mx), Math.min(.55, M.ambGnd[2] / mx));
      hemi.intensity = (q === 'low' ? 1 : .42) * Math.max(lumS / .44, .19 + .2 * (1 - M.night)) * amb;
      R.night = M.night;
      applyFog();
      // облака: цвет по свету (ночью тёмные), сколько видно — облачность мира
      const cn = Math.round(clouds.length * G.sky.clouds);
      for (let i = 0; i < clouds.length; i++) { const s = clouds[i]; s.visible = i < cn; s.material.color.setRGB(M.cloud[0], M.cloud[1], M.cloud[2]); s.material.opacity = .9 * (1 - .35 * M.night); }
      sun.castShadow = shadows && Lg.shadows !== false && O.shadows && M.lightI > .02;   // ночью без луны — теней нет
      if (moved) SH.dirty = true;
      r.toneMappingExposure = (q === 'low' ? 1 : .98) * (1 + .25 * M.night) * Math.pow(2, G.exposure);
      applyGrade();
      applyShadowQ();
      // вода мира: прозрачность, пена, свой цвет
      R.waterU.uClear.value = G.water.clarity; R.waterU.uFoam.value = G.water.foam;
      for (const m of R.waters) { const wc = m.userData.fixedColor ? m.userData.baseColor : G.water.color || m.userData.baseColor; if (m.userData._wc !== wc) { m.userData._wc = wc; m.color.set(wc); } }
      // отражения неба: заново, когда свет устоялся; в смене суток — если солнце сдвинулось на ~2° и прошло 2/4 с
      const now = performance.now(), dSun = envSun.distanceToSquared(skyMat.uniforms.uSun.value);
      if (!envDue && dSun > 1e-3) envDue = Math.max(now + 250, envAt + (q === 'high' ? 2000 : 4000));
      for (const f of R.onLight) f(Lg, { day: M.day > .5, night: M.night, dusk: M.dusk01 });
    }
    R.onLight = [];
    // Туман: обычный по расстоянию (дальность — настройка игрока × туман мира), высотный, тёплый к солнцу; под водой — свой
    function applyFog(){
      const Lg = R.lighting, G = Lg.gfx, O = R.opt, fog = scene.fog;
      const fe = Math.max(40, num(Lg.fogEnd, 320)) * O.dist * (O.fog ? 1 : 1.6);
      const far = Math.min(3000, Math.max(160, fe * 1.08 + 30));
      if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
      cloudsFit(far);
      if (under) {
        fog.color.set(under); fog.near = 0; fog.far = 9; scene.background.copy(fog.color);
        GU.fogA[3] = 0; GU.fogB[3] = 0;
        return;
      }
      fog.color.setRGB(M.hor[0], M.hor[1], M.hor[2]); fog.near = fe * (O.fog ? .3 : .6); fog.far = fe;
      scene.background.copy(fog.color);
      const sl = Math.hypot(M.sun[0], M.sun[2]) || 1, fx = O.fog && q !== 'low';   // low — только обычный туман (легко)
      GU.fogA[0] = M.sun[0] / sl; GU.fogA[1] = 0; GU.fogA[2] = M.sun[2] / sl; GU.fogA[3] = fx && !skyOver ? G.fog.sun : 0;   // к солнцу — по горизонтали
      GU.fogB[0] = M.fogSun[0]; GU.fogB[1] = M.fogSun[1]; GU.fogB[2] = M.fogSun[2]; GU.fogB[3] = fx ? G.fog.density * G.fog.density * .03 : 0;
      GU.fogC[0] = G.fog.height; GU.fogC[1] = .05 + .06 * (1 - G.fog.density); fogCam();
    }
    // высотный туман: плотность на высоте камеры — один раз за кадр (а не в каждом пикселе)
    function fogCam(){ GU.fogC[2] = GU.fogB[3] > 0 ? GU.fogB[3] * Math.exp(-GU.fogC[1] * Math.max(camera.position.y - GU.fogC[0], -20)) : 0; }
    // Под водой (mir.js: камера ниже уровня пруда): синий густой туман, вышли — как было
    R.setUnder = (on, color = '#1d6f96') => { const was = under; under = on ? color : null; if (was !== under) applyFog(); };

    // ═══ Облака: мягкие спрайты кодом, медленно плывут; группа ездит с камерой (как небо), при малой дальности — ближе
    //     и меньше (тот же вид); цвет — по свету (applyLighting), сколько видно — облачность мира ═══
    const clouds = [], cloudG = new T.Group();
    scene.add(cloudG);
    const cloudsFit = far => { const k = Math.min(1, far * .8 / 250); if (cloudG.scale.x !== k) cloudG.scale.setScalar(k); };
    R.clouds = (n = 14, seed = 7) => {
      const rnd = E.rng(seed), tex = cloudTex();
      for (let i = 0; i < n; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: .9 }));
        const a = rnd() * TAU, d = 110 + rnd() * 130, k = 34 + rnd() * 40;
        s.position.set(Math.cos(a) * d, 34 + rnd() * 34, Math.sin(a) * d);
        s.scale.set(k * 1.9, k * .75, 1);
        s.userData.v = 1.2 + rnd() * 1.6;
        cloudG.add(s); clouds.push(s); R.own.push(s.material);
      }
      if (R.opt) applyLighting();
    };
    function cloudTex(){
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d'), rnd = E.rng(3);
      for (let i = 0; i < 22; i++) {
        const x = 40 + rnd() * 176, y = 50 + rnd() * 40, rr = 18 + rnd() * 34;
        const gr = g.createRadialGradient(x, y, 2, x, y, rr);
        gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(.6, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; R.own.push(t); return t;
    }

    // ═══ Лампы: постоянный набор настоящих источников + ореолы ═══
    const LMAX = Math.max(0, Math.min(16, o.lights ?? (q === 'high' ? 8 : q === 'mid' ? 4 : 0)));
    const L = R.lights = { max: LMAX, list: [], slots: [], lit: 0, fade: .3 };
    const lpick = [], lsph = new T.Sphere(), lfr = new T.Frustum(), lm4 = new T.Matrix4(), lwp = new T.Vector3();
    let halo = null, lstamp = 0;
    // Создать набор заранее (одна пересборка шейдеров сейчас, а не при первой лампе)
    L.prepare = () => {
      if (L.slots.length || !LMAX) return;
      for (let i = 0; i < LMAX; i++) {
        const pl = new T.PointLight('#ffffff', 0, 1, 2);
        pl.position.set(0, -1e4, 0); pl.castShadow = false; scene.add(pl);
        L.slots.push({ pl, rec: null, w: 0 });
      }
    };
    L.add = src => {
      if (!src) return null;
      L.prepare();
      const rec = { src, score: 0, eff: 0, slot: -1, w: 0, want: 0 };
      L.list.push(rec);
      return rec;
    };
    L.remove = h => {
      const i = L.list.findIndex(x => x === h || x.src === h); if (i < 0) return;
      const rec = L.list[i];
      if (rec.slot >= 0) { const s = L.slots[rec.slot]; s.rec = null; s.w = 0; s.pl.intensity = 0; }
      L.list.splice(i, 1);
    };
    const posOf = src => src.parent ? src.getWorldPosition(lwp) : src.position;
    L.update = (dt, cam) => {
      const list = L.list;
      if (!list.length && !L.lit) { if (halo) halo.visible = false; return; }
      lstamp++;
      cam.updateMatrixWorld();
      lm4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); lfr.setFromProjectionMatrix(lm4);
      const cp = cam.position;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i], s = rec.src, p = posOf(s), range = s.distance > 0 ? s.distance : 40;
        lsph.center.copy(p); lsph.radius = range;
        const d = Math.sqrt(p.distanceToSquared(cp));
        rec.score = s.visible !== false && s.intensity > 0 && lfr.intersectsSphere(lsph) ? s.intensity * range / (range + d) : 0;
      }
      E.pickLights(list, LMAX, lpick);
      for (let i = 0; i < lpick.length; i++) lpick[i].want = lstamp;
      const k = Math.min(1, dt / L.fade);
      let lit = 0;
      for (let i = 0; i < L.slots.length; i++) {   // не нужна — гаснет; нужна — разгорается
        const sl = L.slots[i];
        if (sl.rec && sl.rec.want !== lstamp) { sl.w -= k; if (sl.w <= 0) { sl.rec.slot = -1; sl.rec.w = 0; sl.rec = null; sl.w = 0; } }
        else if (sl.rec) sl.w = Math.min(1, sl.w + k);
      }
      for (let i = 0; i < lpick.length; i++) {   // новым — свободные места
        const rec = lpick[i]; if (rec.slot >= 0) continue;
        for (let j = 0; j < L.slots.length; j++) { const sl = L.slots[j]; if (!sl.rec) { sl.rec = rec; sl.w = 0; rec.slot = j; break; } }
      }
      for (let i = 0; i < L.slots.length; i++) {
        const sl = L.slots[i], pl = sl.pl, rec = sl.rec;
        if (!rec) { if (pl.intensity !== 0) pl.intensity = 0; continue; }
        const s = rec.src, w = sl.w * sl.w * (3 - 2 * sl.w);
        rec.w = w; lit++;
        pl.position.copy(posOf(s)); pl.color.copy(s.color); pl.intensity = s.intensity * w; pl.distance = s.distance; pl.decay = s.decay ?? 2;
      }
      L.lit = lit;
      haloUpdate(cam);
    };
    // Ореолы: все лампы одним вызовом отрисовки (точки с размером в метрах); у негорящих — ярче (свет «издалека»)
    function haloInit(cap){
      if (halo) { halo.geometry.dispose(); scene.remove(halo); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('hcol', new T.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('hsize', new T.BufferAttribute(new Float32Array(cap), 1).setUsage(T.DynamicDrawUsage));
      const m = halo?.material || new T.ShaderMaterial({
        uniforms: { uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
        vertexShader: 'attribute vec3 hcol; attribute float hsize; uniform float uScale; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(hsize * uScale / max(0.1, -mv.z), 0.0, 384.0); vC = hcol; }',
        fragmentShader: 'varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(0.0, 1.0 - length(d) * 2.0); a *= a; gl_FragColor = vec4(vC, a); }',
      });
      halo = new T.Points(g, m); halo.frustumCulled = false; halo.renderOrder = 3; halo.userData.cap = cap;
      scene.add(halo);
    }
    function haloUpdate(cam){
      const list = L.list;
      if (!list.length) { if (halo) halo.visible = false; return; }
      if (!halo || halo.userData.cap < list.length) haloInit(Math.max(16, (halo?.userData.cap || 8) * 2, list.length));
      const g = halo.geometry, P = g.attributes.position.array, C = g.attributes.hcol.array, S = g.attributes.hsize.array;
      const day = .3 + .7 * (R.night || 0);   // днём ореол еле виден, ночью — в полную силу
      for (let i = 0; i < list.length; i++) {
        const rec = list[i], s = rec.src, p = posOf(s), k = s.visible === false ? 0 : Math.min(1.4, (s.intensity || 0) / 2.5) * (1 - .55 * rec.w) * day;
        P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
        C[i * 3] = s.color.r * k; C[i * 3 + 1] = s.color.g * k; C[i * 3 + 2] = s.color.b * k;
        S[i] = 1.1 + Math.sqrt(Math.max(0, s.distance || 16)) * .16;
      }
      g.setDrawRange(0, list.length);
      g.attributes.position.needsUpdate = g.attributes.hcol.needsUpdate = g.attributes.hsize.needsUpdate = true;
      halo.material.uniforms.uScale.value = R.renderH / (2 * Math.tan(cam.fov * PI / 360));
      halo.visible = true;
    }

    // ═══ Разрешение: плотность пикселей качества × динамический масштаб (на слабом кадре — меньше пикселей) ═══
    const DR = R.dynRes = E.dynRes({ on: o.dynRes !== false });
    let scaleNow = 1;
    function applyScale(){
      const s = scaleNow = DR.scale;
      R.pr0 = PR0;
      if (R.post) R.post.setSize(Math.max(1, Math.round(R.w * PR0 * s)), Math.max(1, Math.round(R.h * PR0 * s)), PR0 * s);
      else { r.setPixelRatio(PR0 * s); r.setSize(R.w, R.h, false); }
      R.renderH = Math.max(1, Math.round(R.h * PR0 * s));
      r.domElement.style.width = R.w + 'px'; r.domElement.style.height = R.h + 'px';
    }
    R.pixelRatio = () => PR0 * scaleNow;
    R.resize = () => {
      const b = container.getBoundingClientRect();
      R.w = Math.max(100, b.width); R.h = Math.max(100, b.height);
      if (R.post) { r.setPixelRatio(PR0); r.setSize(R.w, R.h, false); }
      applyScale();
      camera.aspect = R.w / R.h; camera.fov = camera.userData.fov0 = R.w < R.h ? 58 : 50; camera.updateProjectionMatrix();
    };
    R.update = dt => {
      for (let i = 0; i < clouds.length; i++) { const s = clouds[i]; s.position.x += s.userData.v * dt; if (s.position.x > 300) s.position.x = -300; }
      R.waterU.uTime.value += dt; skyT += dt; skyMat.uniforms.uP.value.w = skyT % 1000;
      for (let i = 0; i < R.anims.length; i++) R.anims[i](dt);
    };
    // ═══ Кадр: склейка/лампы → отражения неба (если пора) → тени по делу → сцена (через постобработку или прямо) →
    //     счётчики, разрешение и автокачество ═══
    // ═══ «Генерация кадров (×2)» (post.js P.renderGen): настоящий кадр — через раз, промежуточный — прошлый, переложенный
    //     под новую камеру. Сама выключается (настоящий кадр), когда будет плохо: камера прыгнула или резко повернулась,
    //     сменился вид / размер, R.cut() (телепорт, смена сцены), стрелки редактора, кто-то рядом движется слишком быстро ═══
    const FG = R.fg = { want: false, on: false, last: 'real', cut: 0, camPos: new T.Vector3(), camQ: new T.Quaternion(), fov: 0, aspect: 0,
      lastRealT: 0, snap: new Map(), movers: [], why: '' };
    R.cut = (n = 2) => { FG.cut = Math.max(FG.cut, n); };
    // подвижные: свой персонаж (R.follow) + что даст игра (R.fgMovers → [[ключ, x, y, z], …]); [x, y, z] — ступни
    const MOV_R = .62 * (E.UNIT || 1), MOV_H = 2.3 * (E.UNIT || 1);
    function fgSources(){
      const out = FGself.ok ? [['@', FGself.x, FGself.y, FGself.z]] : [];
      if (typeof R.fgMovers === 'function') { try { const L = R.fgMovers(); if (Array.isArray(L)) for (const m of L) if (m && m[0] !== '@') out.push(m); } catch (e) {} }
      return out;
    }
    function fgSnap(){
      FG.snap.clear();
      for (const m of fgSources()) FG.snap.set(m[0], [m[1], m[2], m[3]]);
      FG.camPos.copy(camera.position); FG.camQ.copy(camera.quaternion); FG.fov = camera.fov; FG.aspect = camera.aspect;
    }
    function fgMovers(){
      const L = [];
      for (const m of fgSources()) {
        const s = FG.snap.get(m[0]); if (!s) continue;
        L.push([s[0], s[1] + .05, s[2], MOV_R, MOV_H, m[1] - s[0], m[2] - s[1], m[3] - s[2], (s[0] - camera.position.x) ** 2 + (s[2] - camera.position.z) ** 2]);
      }
      L.sort((a, b) => a[8] - b[8]);
      return L.length > 8 ? L.slice(0, 8) : L;
    }
    // промежуточный ли кадр сейчас
    function fgGen(){
      const ok = FG.want && R.post && R.post.on && R.post.fg?.ok;
      if (!ok) { if (R.post?.fg?.on) R.post.setFg(false); FG.on = false; FG.last = 'real'; return false; }
      if (!R.post.fg.on) R.post.setFg(true);
      FG.on = true;
      if (FG.last !== 'real' || !R.post.fg.have) return false;
      if (FG.cut > 0) { FG.cut--; FG.why = 'смена сцены'; return false; }
      if (R.post.lastOver) { FG.why = 'редактор'; return false; }
      if (camera.position.distanceTo(FG.camPos) > 2.5 * (E.UNIT || 1) || 1 - Math.abs(camera.quaternion.dot(FG.camQ)) > .015 || camera.fov !== FG.fov || camera.aspect !== FG.aspect) { FG.why = 'камера резко'; return false; }
      const M = fgMovers();
      for (const m of M) if (Math.hypot(m[5], m[6], m[7]) > 1.2 * (E.UNIT || 1)) { FG.why = 'быстро рядом'; return false; }
      FG.movers = M; FG.why = '';
      return true;
    }
    let lastT = 0;
    R.render = () => {
      const t0 = performance.now(), dt = lastT ? t0 - lastT : 0;
      lastT = t0;
      if (R.photo) { R.photo(); return; }   // «📸 Фото с трассировкой пути» (pathtrace.js): пока окно открыто, кадр — его
      if (fgGen()) {   // промежуточный кадр: ни теней, ни сцены — одна перекладка (логика игры и интерфейс шли как обычно)
        r.info.reset();
        R.post.renderGen(camera, FG.movers);
        FG.last = 'gen';
        const t1 = performance.now();
        ST.cpu = t1 - t0; ST.dt = dt; ST.calls = r.info.render.calls; ST.post = ST.calls; ST.gen = (ST.gen || 0) + 1;
        if (dt > 0 && dt < 1000) { ST.frames++; ST.sumDt += dt; if (dt > ST.maxDt) ST.maxDt = dt; ST.sumR += ST.cpu; }
        if (E.perf?.on) E.perf.frame(R);
        const O = window.D37Opt; if (O && O.rev !== optRev) optSync(O);
        return;
      }
      for (let i = 0; i < R.preRender.length; i++) R.preRender[i](R, t0);
      sky.position.copy(camera.position); cloudG.position.set(camera.position.x, 0, camera.position.z);
      if (GU.fogB[3] > 0) fogCam();
      if (envDue && t0 >= envDue) { envDue = 0; makeEnv(); }
      L.update(Math.min(.1, dt / 1000), camera);
      ST.shadowNow = shadowTick(t0);
      r.info.reset();
      if (GU.rt) GU.rt[0] = q !== 'low' ? R.lighting.gfx.rt?.wet || 0 : 0;   // мокрое — мира (данные общие на страницу: после кадра — 0)
      if (R.post && R.post.on) R.post.render(scene, camera);
      else { r.render(scene, camera); ST.scene = r.info.render.calls; ST.post = 0; }
      if (GU.rt) GU.rt[0] = 0;
      const inf = r.info.render;
      ST.calls = inf.calls; ST.tris = inf.triangles;
      if (ST.shadowNow) { ST.shadowUpd++; if (ST.sceneNoSh) ST.shadow = Math.max(0, ST.scene - ST.sceneNoSh); } else ST.sceneNoSh = ST.scene;
      const t1 = performance.now(), cpu = t1 - t0, f0 = E.frameT0 && t0 - E.frameT0 < 50 ? E.frameT0 : t0;
      ST.cpu = cpu; ST.cpuFrame = t1 - f0; ST.dt = dt;
      if (dt > 0 && dt < 1000) { ST.frames++; ST.sumDt += dt; if (dt > ST.maxDt) ST.maxDt = dt; ST.sumCpu += ST.cpuFrame; if (ST.cpuFrame > ST.maxCpu) ST.maxCpu = ST.cpuFrame; ST.sumR += cpu; }
      ST.real = (ST.real || 0) + 1; ST.realN = (ST.realN || 0) + 1;   // настоящих кадров (счётчик FPS: «60 (30 настоящих)»)
      // генерация кадров: запомнить камеру и подвижных этого настоящего кадра; автоматам разрешения и качества — время
      // настоящего кадра на 2 (на экране кадр в 2 раза чаще)
      let dtq = dt;
      if (FG.on) { FG.last = 'real'; fgSnap(); dtq = FG.lastRealT ? (t0 - FG.lastRealT) / 2 : 0; }
      FG.lastRealT = t0;
      if (DR.on && dtq > 0 && DR.tick(dtq, ST.cpuFrame, t0) !== scaleNow) { applyScale(); AQ?.D.hold(2500, t0); }
      if (AQ && !AQ.off && dtq > 0) {   // автокачество: ступень лесенки по времени кадра (разрешение и ступени — по очереди)
        const s = AQ.D.tick(dtq, ST.cpuFrame, t0), i = Math.round((1 - s) * (AQ.L.length - 1));
        if (i !== AQ.i) { AQ.i = i; applyOpts(AQ.L[i]); DR.hold(2500, t0); }
      }
      if (E.perf?.on) E.perf.frame(R);
      const O = window.D37Opt; if (O && O.rev !== optRev) optSync(O);   // настройки поменялись (js/core/settings.js)
    };
    // ── Настройки «на живую» (окно ⚙️, js/core/settings.js + gfx-settings.js → window.D37Opt): FSR, тени, графика ──
    let optRev = -1;
    function optSync(O){
      optRev = O.rev;
      const want = O.fsr || 'auto';
      if (want !== optFsr) { optFsr = want; if (R.w > 1) R.setFsr(want); }
      R.userShadows = O.shadows !== false;
      R.applyGfx(E.gfxResolve({ ...(O.gfx || {}), shadows: O.shadows !== false }, devInfo()));
    }
    // устройство для E.gfxResolve: каркас, WebGL2, телефон ли, точна ли глубина кадра (post.js проверяет при запуске)
    function devInfo(){ return { q, gl2: r.capabilities.isWebGL2, mobile: !!E.isMobile?.(), depthFx: !R.post || R.post.depthOK !== false }; }
    let optFsr = E.fsrMode();
    R.userShadows = true;
    R.setShadows = on => { R.userShadows = !!on; applyShadowQ(); };
    // ── Графика игрока: base — E.gfxResolve(…). Пресет «Авто» — лесенка E.autoSteps (сам снижает и поднимает ступени) ──
    let AQ = null;
    R.applyGfx = base => {
      R.optBase = base;
      const tgt = 1000 / Math.min(60, base.fpsCap || 60);
      DR.target = tgt;
      if (base.auto) {
        const L = E.autoSteps(base);
        if (!AQ || JSON.stringify(AQ.L) !== JSON.stringify(L)) AQ = L.length > 1 ? { L, i: 0, off: false, D: E.dynRes({ min: 0, max: 1, step: 1 / (L.length - 1), target: tgt }) } : null;
        else AQ.D.target = tgt;
        applyOpts(AQ ? AQ.L[AQ.i] : base);
      } else { AQ = null; applyOpts(base); }
      return R.opt;
    };
    R.autoQ = () => AQ ? { step: AQ.i, steps: AQ.L.length, off: AQ.off, D: AQ.D } : null;   // D — автомат (для проверок)
    R.setAuto = on => { if (AQ) { AQ.off = !on; if (!on && AQ.i) { AQ.i = 0; AQ.D.set(1); applyOpts(AQ.L[0]); } } };   // замер — на лучшей ступени
    const gradeU = { gain: [1, 1, 1], sat: 1, con: 0, vig: 0 };
    function applyOpts(op){
      R.opt = op;
      FG.want = !!op.framegen;   // генерация кадров (×2) — настройка игрока
      const pr = Math.min(window.devicePixelRatio || 1, op.prCap || 2);
      if (pr !== PR0) { PR0 = pr; if (R.w > 1) { r.setPixelRatio(PR0); r.setSize(R.w, R.h, false); } }
      DR.max = Math.max(.5, Math.min(1, (op.res || 100) / 100));
      R.setFsr(optFsr, false);
      E.fpsCap = op.fpsCap || 0;
      applyShadowQ();
      scene.environment = op.refl && q !== 'low' ? envOut?.texture || null : null;
      R.waterU.uWQ.value = op.water === 'good' ? 1 : 0;
      R.post?.setOpts?.({ ao: op.ao, aa: op.aa, upscaler: op.upscaler, sharp: op.sharp, rt: op.rt || 'off' });
      applyGrade();
      applyFog();
      if (R.w > 1) applyScale();
    }
    // Тени по качеству (E.SHADOW_Q) и мягкости мира: карта, коробка, выборки, PCSS-lite, как часто при движении
    function applyShadowQ(){
      if (!shadows || !R.opt) return;
      const op = R.opt, Q = E.SHADOW_Q[op.shadowQ] || E.SHADOW_Q.mid, soft = R.lighting.gfx.shadow.soft, cam = sun.shadow.camera;
      const map = Math.min(Q.map, r.capabilities.maxTextureSize || 4096);
      if (sun.shadow.mapSize.x !== map) { sun.shadow.mapSize.set(map, map); sun.shadow.map?.dispose(); sun.shadow.map = null; SH.dirty = true; }
      if (cam.right !== Q.box) { cam.left = -Q.box; cam.right = Q.box; cam.top = Q.box; cam.bottom = -Q.box; cam.updateProjectionMatrix(); SH.dirty = true; }
      sun.shadow.radius = Q.radius * (.6 + 1.6 * soft);
      GU.sh[0] = Q.taps; GU.sh[1] = Q.blk; GU.sh[2] = (cam.far - cam.near) * (.006 + .05 * soft) / (Q.box * 2 / map); GU.sh[3] = 1;
      SH.every = Q.every; SH.step = Q.box > 30 ? 1.5 : 2;
      const on = op.shadows && R.lighting.shadows !== false && R.userShadows !== false;   // castShadow меняет шейдеры — только по настройке
      if (sun.castShadow !== on) { sun.castShadow = on; SH.dirty = true; }
    }
    // Цвет кадра (post.js): цветокоррекция мира (если у игрока не выключена), свечение — сила мира
    function applyGrade(){
      if (!R.post || !R.opt) return;
      const G = R.lighting.gfx;
      E.gradeUniforms(E.gradeOf(G.grade), R.opt.grade, 0, gradeU);
      gradeU.sat *= 1 - .35 * M.night;   // ночью цвета блёкнут (как видит глаз в темноте)
      R.post.setGrade?.(gradeU);
      R.post.bloom.strength = (q === 'high' ? 1 : .9) * G.bloom;
    }
    // Разрешение вручную (замер, настройки): s — доля от плотности качества; dynRes выключается, пока не включат снова
    R.setRes = (s, auto = false) => { DR.on = !!auto; DR.set(s); applyScale(); };
    // Режим FSR: quality / balanced / performance — постоянная доля кадра; auto — динамическое разрешение (без постобработки
    // FSR нет — тогда только меньше пикселей); масштаб разрешения игрока (DR.max) — потолок. Возвращает режим, который включился.
    R.fsr = 'auto';
    R.setFsr = (mode, apply = true) => {
      const s = E.FSR[mode], mx = DR.max;
      R.fsr = s && wantPost ? mode : mode === 'native' ? 'native' : 'auto';   // native — всегда 100% (настройки)
      if (R.fsr === 'auto') { DR.on = o.dynRes !== false; DR.set(mx); }
      else if (R.fsr === 'native') { DR.on = false; DR.set(mx); }
      else { DR.min = Math.min(DR.min, s, mx); DR.on = false; DR.set(Math.min(s, mx)); }
      if (apply && R.w > 1) applyScale();
      return R.fsr;
    };
    R.setFsr(E.fsrMode(), false);
    const v3 = new T.Vector3(), PRJ = [0, 0, false];
    // Точка мира → экран (для подписей): [x, y, видна ли] — один и тот же массив (разбирать сразу)
    R.project = (x, y, z) => { v3.set(x, y, z).project(camera); PRJ[0] = (v3.x + 1) / 2 * R.w; PRJ[1] = (1 - v3.y) / 2 * R.h; PRJ[2] = v3.z < 1 && Math.abs(v3.x) < 1.25 && Math.abs(v3.y) < 1.25; return PRJ; };
    // Экран → луч мира (для клика)
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    R.screenRay = (cx, cy) => {
      const b = r.domElement.getBoundingClientRect();
      ndc.set((cx - b.left) / b.width * 2 - 1, -((cy - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return { ox: ray.ray.origin.x, oy: ray.ray.origin.y, oz: ray.ray.origin.z, dx: ray.ray.direction.x, dy: ray.ray.direction.y, dz: ray.ray.direction.z };
    };
    R.dispose = () => {
      R.dead = true;
      for (const f of R.preRender) f.dispose?.();
      R.post?.dispose();
      if (halo) { halo.geometry.dispose(); halo.material.dispose(); }
      for (const sl of L.slots) scene.remove(sl.pl);
      scene.traverse(x => { if (x.isMesh && x.userData.own) x.geometry.dispose(); });
      for (const m of mats.values()) m.dispose();
      for (const t of texCache.values()) t.dispose();
      for (const x of R.own) x.dispose?.();
      envOut?.dispose(); envRT?.dispose(); pmrem?.dispose();
      sky.geometry.dispose(); skyMat.dispose();
      GU.fogA.fill(0); GU.fogB.fill(0); GU.fogC.fill(0); GU.sh.fill(0); E.fpsCap = 0;   // общие данные шейдеров — как без движка
      r.dispose(); r.forceContextLoss?.(); r.domElement.remove();
    };

    // ═══ Материалы ═══
    const mats = new Map(), texCache = new Map();
    const cache = (k, f) => mats.get(k) || (mats.set(k, f()), mats.get(k));
    // Обычный материал: PBR (шероховатый «пластик/краска»), на слабых — Ламберт
    R.mat = (c, o = {}) => cache(`m${c}|${o.rough ?? ''}|${o.metal ?? ''}|${o.flat ? 1 : 0}|${o.emissive || ''}|${o.ds ? 1 : 0}`, () => {
      const p = { color: c, side: o.ds ? T.DoubleSide : T.FrontSide };
      if (o.emissive) { p.emissive = new T.Color(o.emissive); p.emissiveIntensity = o.ei ?? 1; }
      if (q === 'low') return new T.MeshLambertMaterial({ ...p, flatShading: !!o.flat });
      return new T.MeshStandardMaterial({ ...p, roughness: o.rough ?? .82, metalness: o.metal ?? 0, flatShading: !!o.flat, envMapIntensity: o.env ?? .65 });
    });
    // Свечение (bloom): непрозрачный материал пишет в альфу буфера 1 + сила — постобработка размывает такие пиксели.
    // Шейдер общий для всех (сила — uniform). Копия материала (clone) метку не наследует — прозрачные копии не светятся
    function bloomPatch(sh){
      const U = sh.uniforms.uBloom = { value: this.userData.bloom || 1 };
      this.userData._bloomU = U;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBloom;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#ifdef OPAQUE\ngl_FragColor.a = 1.0 + uBloom;\n#endif');
    }
    R.bloomPatch = bloomPatch;
    R.bloom = (m, k = 1) => {
      if (!m || !m.isMaterial) return m;
      m.userData.bloom = +k || 0;
      if (m.userData._bloomU) m.userData._bloomU.value = m.userData.bloom;
      if (m.onBeforeCompile !== bloomPatch) { m.onBeforeCompile = bloomPatch; m.needsUpdate = true; }
      return m;
    };
    const glow = c => cache('glow' + c, () => R.bloom(new T.MeshBasicMaterial({ color: c, toneMapped: false }), 1));
    R.glow = glow;
    // Текстура из img/tex (грузится в фоне; пока грузится — материал просто цветной)
    const loader = new T.TextureLoader();
    const loadTex = (file, srgb) => {
      if (texCache.has(file)) return texCache.get(file);
      const t = loader.load(TEX_DIR + file, tt => { tt.needsUpdate = true; });
      t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = q === 'high' ? 8 : 4;
      if (srgb) t.encoding = T.sRGBEncoding;
      texCache.set(file, t);
      return t;
    };
    R.tex = (name, o = {}) => cache(`t${name}|${o.tint || ''}|${o.tile || ''}|${o.rough ?? ''}|${o.ns ?? ''}`, () => {
      const tint = o.tint || '#ffffff';
      if (q === 'low') { const m = new T.MeshLambertMaterial({ color: o.flatColor || tint }); m.userData.tile = 0; return m; }
      const m = new T.MeshStandardMaterial({ color: tint, roughness: o.rough ?? .9, metalness: 0, map: loadTex(name + '.jpg', true), envMapIntensity: .8 });
      if (q === 'high' && o.normal !== false) { m.normalMap = loadTex(name + '_n.jpg', false); m.normalScale = new T.Vector2(o.ns ?? 1, o.ns ?? 1); }
      m.userData.tile = (o.tile || 2) * (E.UNIT || 1);
      return m;
    });
    // Текстура кодом (трава, черепица…): draw(g, size, rnd)
    R.canvasTex = (key, size, draw, o = {}) => {
      if (texCache.has(key)) return texCache.get(key);
      const c = document.createElement('canvas'); c.width = c.height = size;
      draw(c.getContext('2d'), size, E.rng(o.seed || 11));
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = q === 'high' ? 8 : 4;
      if (o.srgb !== false) t.encoding = T.sRGBEncoding;
      texCache.set(key, t);
      return t;
    };
    // Нормали из «высоты» (Собель) — для текстур кодом
    R.normalFrom = (key, size, height, strength = 2) => R.canvasTex(key, size, (g, n) => {
      const H = height(n), img = g.createImageData(n, n), at = (x, y) => H[((y + n) % n) * n + ((x + n) % n)];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
        img.data[i] = (-dx / l * .5 + .5) * 255; img.data[i + 1] = (dy / l * .5 + .5) * 255; img.data[i + 2] = (1 / l * .5 + .5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, { srgb: false });
    // Готовые текстуры кодом (для материалов как в Roblox): трава, песок, камень, кирпич, снег, рифлёный металл, черепица
    R.proc = name => {
      const P = {
        grass: () => R.canvasTex('p:grass', 256, (g, n, rnd) => {
          g.fillStyle = '#56a845'; g.fillRect(0, 0, n, n);
          for (let i = 0; i < 70; i++) { const x = rnd() * n, y = rnd() * n, r = 10 + rnd() * 40, l = rnd() < .5; const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, l ? 'rgba(150,215,95,.42)' : 'rgba(38,105,40,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.save(); g.translate(dx, dy); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore(); } }
          for (let i = 0; i < 1600; i++) { const x = rnd() * n, y = rnd() * n, h = 3 + rnd() * 5; g.strokeStyle = rnd() < .5 ? 'rgba(45,110,40,.55)' : 'rgba(170,225,120,.5)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 2, y - h); g.stroke(); }
        }),
        sand: () => R.canvasTex('p:sand', 256, (g, n, rnd) => {
          g.fillStyle = '#e6d3a3'; g.fillRect(0, 0, n, n);
          for (let i = 0; i < 9000; i++) { const v = rnd(); g.fillStyle = v < .5 ? `rgba(160,130,80,${.1 + rnd() * .25})` : `rgba(255,248,220,${.1 + rnd() * .3})`; g.fillRect(rnd() * n, rnd() * n, 1 + (rnd() < .1), 1); }
          for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(170,140,90,.18)'; g.lineWidth = 3; g.beginPath(); const y = rnd() * n; g.moveTo(0, y); g.bezierCurveTo(n * .3, y + 12, n * .6, y - 12, n, y); g.stroke(); }
        }),
        rock: () => R.canvasTex('p:rock', 256, (g, n, rnd) => {
          g.fillStyle = '#8d8f94'; g.fillRect(0, 0, n, n);
          for (let i = 0; i < 260; i++) { const x = rnd() * n, y = rnd() * n, r = 4 + rnd() * 26, s = 90 + rnd() * 70 | 0; g.fillStyle = `rgba(${s},${s},${s + 6},.35)`; g.beginPath(); g.ellipse(x, y, r, r * (.5 + rnd() * .5), rnd() * 3, 0, 7); g.fill(); }
          for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(40,40,45,.35)'; g.lineWidth = 1; g.beginPath(); let x = rnd() * n, y = rnd() * n; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - .5) * 40; y += (rnd() - .5) * 40; g.lineTo(x, y); } g.stroke(); }
        }),
        brick: () => R.canvasTex('p:brick', 256, (g, n, rnd) => {
          g.fillStyle = '#d8d2c8'; g.fillRect(0, 0, n, n);
          const bh = n / 8, bw = n / 4;
          for (let row = 0; row < 8; row++) for (let i = -1; i < 5; i++) {
            const x = i * bw + (row % 2) * bw / 2, y = row * bh, v = 150 + rnd() * 60 | 0;
            g.fillStyle = `rgb(${v},${v * .45 | 0},${v * .32 | 0})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
            g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + 2, y + bh - 6, bw - 4, 4);
          }
        }),
        snow: () => R.canvasTex('p:snow', 128, (g, n, rnd) => {
          g.fillStyle = '#f3f7fb'; g.fillRect(0, 0, n, n);
          for (let i = 0; i < 1500; i++) { g.fillStyle = rnd() < .5 ? 'rgba(200,215,235,.35)' : 'rgba(255,255,255,.8)'; g.fillRect(rnd() * n, rnd() * n, 1, 1); }
        }),
        diamond: () => R.canvasTex('p:diamond', 128, (g, n) => {
          g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, n, n);
          for (let y = 0; y < n; y += 16) for (let x = 0; x < n; x += 16) {
            g.save(); g.translate(x + 8, y + 8); g.rotate(((x + y) / 16) % 2 ? .6 : -.6);
            const gr = g.createLinearGradient(-6, 0, 6, 0); gr.addColorStop(0, '#d5dade'); gr.addColorStop(1, '#6b7178');
            g.fillStyle = gr; g.fillRect(-6, -1.6, 12, 3.2); g.restore();
          }
        }),
        dirt: () => R.canvasTex('p:dirt', 256, (g, n, rnd) => {
          g.fillStyle = '#7a5a3c'; g.fillRect(0, 0, n, n);
          for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < .5 ? 'rgba(60,40,25,.35)' : 'rgba(150,115,80,.3)'; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
        }),
      };
      return (P[name] || P.grass)();
    };
    // Материалы v2: рельеф для текстур кодом — карта нормалей из их же яркости (кирпич, камень, рифлёнка выпуклые); только high
    const PROC_N = { grass: 1.1, sand: 1.4, rock: 2.6, brick: 3, snow: .9, dirt: 1.6, diamond: 3.2 };
    R.procN = name => {
      if (q !== 'high' || !PROC_N[name]) return null;
      const src = R.proc(name).image;
      if (!src?.getContext) return null;
      return R.normalFrom('pN:' + name, src.width, n => {
        const d = src.getContext('2d').getImageData(0, 0, n, n).data, H = new Float32Array(n * n);
        for (let i = 0; i < n * n; i++) H[i] = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255;
        return H;
      }, PROC_N[name]);
    };
    // «Трассировка лучей»: прозрачное блестящее (вода, стекло, лёд) — пока она включена, пишет в альфу буфера сцены 0 (E.rtMark)
    R.rtClear = new Set();
    R.rtMarkAll = on => { R.rtOn = !!on; for (const m of R.rtClear) E.rtMark?.(T, m, R.rtOn); };
    const rtAdd = m => { if (m?.transparent && E.rtMark) { R.rtClear.add(m); if (R.rtOn) E.rtMark(T, m, true); } return m; };
    // Стекло, лёд: френель — под углом отражают сильнее и меньше просвечивают (прозрачные не склеиваются — правка шейдера можно)
    R.fresnel = (m, k = .7) => {
      if (q === 'low' || !m?.transparent || !m.isMeshStandardMaterial) return m;
      m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', '#include <output_fragment>\n  gl_FragColor.a = clamp( mix( gl_FragColor.a, 1.0, pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 4.0 ) * ' + (+k).toFixed(2) + ' ), 0.0, 1.0 );'); };
      m.customProgramCacheKey = () => 'd37-fr' + (+k).toFixed(2);
      return rtAdd(m);
    };
    R.texMat = (key, map, o = {}) => cache('cm' + key + (o.tint || ''), () => {
      if (q === 'low') return new T.MeshLambertMaterial({ color: o.flatColor || o.tint || '#ffffff', map: o.lowMap ? map : null });
      const m = new T.MeshStandardMaterial({ color: o.tint || '#ffffff', map, roughness: o.rough ?? .9, metalness: 0, envMapIntensity: .8 });
      if (o.normalMap && q === 'high') { m.normalMap = o.normalMap; m.normalScale = new T.Vector2(o.ns ?? 1, o.ns ?? 1); }
      m.userData.tile = (o.tile || 2) * (E.UNIT || 1);
      return m;
    });
    // Вода v2 (gfx.js E.waterMaterial): рябь двумя слоями по миру, френель (у горизонта — зеркало неба), по глубине — цвет
    // и прозрачность, пена у берега. wo — { key (свой материал), depth: { tex, rect } (дно — E.waterDepthTex), fixedColor }.
    // Общие для мира: R.waterU (время, прозрачность и пена мира, uWQ — «Вода: простая/красивая» игрока). На low — простая.
    R.waterU = { uTime: { value: 0 }, uClear: { value: .55 }, uFoam: { value: .6 }, uWQ: { value: 1 } };
    R.waters = [];
    R.water = (c = '#3fa9e0', wo = {}) => cache('water' + c + (wo.key || ''), () => {
      const m = q === 'low' ? new T.MeshLambertMaterial({ color: c, transparent: true, opacity: .9 }) : E.waterMaterial(R, c, wo);
      m.userData.baseColor = c; m.userData.fixedColor = !!wo.fixedColor; m.userData.noCast = true;
      R.waters.push(m);
      if (q !== 'low') rtAdd(m);
      if (R.opt && !m.userData.fixedColor && R.lighting.gfx.water.color) m.color.set(R.lighting.gfx.water.color);
      return m;
    });

    // ═══ Детали ═══
    const matOf = p => p.m === 'basic' || p.m === 'glow' ? glow(p.c || '#ffffff') : p.m === 'ds' ? R.mat(p.c || '#cccccc', { ds: true }) : p.m?.isMaterial ? p.m
      : R.mat(p.c || '#cccccc', { flat: p.s === 'ico' || p.flat, rough: p.rough, metal: p.metal, emissive: p.emissive });
    const f3 = v => (+v).toFixed(3);
    const geoOf = p => {
      const s = p.s || 'box';
      if (s === 'box') return K.geo(`ebox${f3(p.w)}_${f3(p.h)}_${f3(p.d)}`, () => new T.BoxGeometry(p.w, p.h, p.d));
      if (s === 'cyl') return K.geo(`ecyl${f3(p.r)}_${f3(p.r2 ?? p.r)}_${f3(p.h)}_${p.seg || 14}`, () => new T.CylinderGeometry(p.r2 ?? p.r, p.r, p.h, p.seg || 14));
      if (s === 'cone') return K.geo(`econe${f3(p.r)}_${f3(p.h)}_${p.seg || 12}`, () => new T.ConeGeometry(p.r, p.h, p.seg || 12));
      if (s === 'ball') return K.geo(`eball${f3(p.r)}_${p.seg || 14}`, () => new T.SphereGeometry(p.r, p.seg || 14, Math.max(6, Math.round((p.seg || 14) * .7))));
      if (s === 'ico') return K.geo(`eico${f3(p.r)}_${p.det ?? 1}`, () => new T.IcosahedronGeometry(p.r, p.det ?? 1));
      if (s === 'torus') return K.geo(`etor${f3(p.r)}_${f3(p.t)}_${f3(p.arc ?? TAU)}`, () => new T.TorusGeometry(p.r, p.t, 8, 32, p.arc ?? TAU));
      if (s === 'ring') return K.geo(`ering${f3(p.r)}_${f3(p.r2)}`, () => new T.RingGeometry(p.r2, p.r, 40));
      if (s === 'disc') return K.geo(`edisc${f3(p.r)}`, () => new T.CircleGeometry(p.r, 40));
      if (s === 'plane') return K.geo(`eplane${f3(p.w)}_${f3(p.d)}`, () => new T.PlaneGeometry(p.w, p.d));
      throw new Error('деталь: ' + s);
    };
    R.part = (parent, p) => {
      const m = new T.Mesh(geoOf(p), matOf(p));
      m.position.set(p.x || 0, p.y || 0, p.z || 0);
      if (p.yaw || p.rx || p.rz) m.rotation.set(p.rx || 0, p.yaw || 0, p.rz || 0);
      if (p.sx || p.sy || p.sz) m.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
      if (p.dyn) m.userData.dyn = true;   // двигается — не склеивать
      if (p.noCast) m.userData.noCast = true;
      if (shadows && p.dyn) { m.castShadow = !p.noCast; m.receiveShadow = true; }
      parent.add(m);
      return m;
    };
    R.group = (parent, x = 0, y = 0, z = 0, yaw = 0) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = yaw; (parent || R.static).add(g); return g; };
    // Тени у подвижного/несклеиваемого объекта (крыши, человечки)
    R.shadowsOn = (obj, cast = true, receive = true) => { if (!shadows) return; obj.traverse(m => { if (m.isMesh && !m.isSprite) { m.castShadow = cast && !m.material?.userData?.noCast; m.receiveShadow = receive; } }); };
    // UV «по миру» для отдельного объекта (крыша и т. п.): текстура ложится ровно, плитка — material.userData.tile
    R.worldUV = (mesh, tile) => {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const pos = g.attributes.position, nor = g.attributes.normal, mw = mesh.matrixWorld, nm = new T.Matrix3().getNormalMatrix(mw);
      const p = new T.Vector3(), n = new T.Vector3(), uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mw); n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        boxUV(p, n, tile, uv, i);
      }
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mesh.geometry = g; mesh.userData.own = true;
    };
    function boxUV(p, n, tile, out, i){
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let u, v;
      if (ay >= ax && ay >= az) { u = p.x; v = n.y > 0 ? -p.z : p.z; }
      else if (ax >= az) { u = n.x > 0 ? -p.z : p.z; v = p.y; }
      else { u = n.z > 0 ? p.x : -p.x; v = p.y; }
      out[i * 2] = u / tile; out[i * 2 + 1] = v / tile;
    }

    // ═══ Готовые предметы (параметры — opts; тела — в phys) ═══
    const PF = {
      // дерево: ствол + 3 «облака» кроны (низкополигональные, с тенью); v — вариант цвета, k — размер
      tree(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), k = o.k || 1;
        const greens = o.colors || ['#3f8f3a', '#4ea544', '#62b84f', '#367d34'], v = o.v || 0;
        R.part(g, { s: 'cyl', r: .32 * k, r2: .22 * k, h: 1.9 * k, y: .95 * k, c: '#7a4f2c', seg: 7, rough: .95 });
        [[0, 2.45, 0, 1.25], [-.7, 2.0, .25, .9], [.7, 2.05, -.15, .95], [.1, 2.95, .1, .8]].forEach(([dx, dy, dz, rr], j) =>
          R.part(g, { s: 'ico', r: rr * k, x: dx * k, y: dy * k, z: dz * k, c: greens[(v + j) % greens.length], sy: .9, det: 1 }));
        ph?.addCyl({ x: o.x, z: o.z, y: 1.2 * k, r: .38 * k, hy: 1.2 * k, tag: 'tree' });
        return g;
      },
      pine(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z), k = o.k || 1;
        R.part(g, { s: 'cyl', r: .26 * k, h: 1.2 * k, y: .6 * k, c: '#6b4426', seg: 6 });
        [[1.5, 1.6, 1.6], [1.15, 1.4, 2.6], [.78, 1.2, 3.45]].forEach(([rr, hh, y]) => R.part(g, { s: 'cone', r: rr * k, h: hh * k, y: y * k, c: o.c || '#2f7d4a', seg: 8, flat: true }));
        ph?.addCyl({ x: o.x, z: o.z, y: 1.2 * k, r: .32 * k, hy: 1.2 * k, tag: 'tree' });
        return g;
      },
      bush(o){
        const g = R.group(o.parent, o.x, 0, o.z), k = o.k || 1;
        [[0, .45, 0, .6], [.45, .35, .1, .45], [-.4, .35, -.05, .42]].forEach(([dx, dy, dz, rr]) => R.part(g, { s: 'ico', r: rr * k, x: dx * k, y: dy * k, z: dz * k, c: o.c || '#3f9a4c', det: 1 }));
        return g;
      },
      rock(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), k = o.k || 1;
        R.part(g, { s: 'ico', r: .7 * k, y: .3 * k, c: o.c || '#8b929c', det: 0, sy: .7, rough: .95 });
        ph?.addCyl({ x: o.x, z: o.z, y: .35 * k, r: .6 * k, hy: .4 * k, tag: 'rock' });
        return g;
      },
      flowers(o){
        const g = R.group(o.parent, o.x, 0, o.z), n = o.n || 6, rnd = E.rng(o.seed || 1);
        for (let i = 0; i < n; i++) {
          const a = rnd() * TAU, d = rnd() * .8;
          R.part(g, { s: 'cyl', r: .025, h: .35, x: Math.cos(a) * d, y: .17, z: Math.sin(a) * d, c: '#3f9a4c', seg: 4 });
          R.part(g, { s: 'ball', r: .09, x: Math.cos(a) * d, y: .38, z: Math.sin(a) * d, c: o.c || '#f472b6', seg: 6 });
        }
        return g;
      },
      lamp(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z);
        R.part(g, { s: 'cyl', r: .1, r2: .07, h: 3, y: 1.5, c: '#2d2a3a', seg: 8, rough: .5, metal: .6 });
        R.part(g, { s: 'cyl', r: .22, h: .12, y: .06, c: '#2d2a3a', seg: 10, rough: .5, metal: .6 });
        R.part(g, { s: 'ball', r: .26, y: 3.1, c: '#fff3b0', m: 'glow', seg: 12 });
        if (q !== 'low') { const hl = new T.Sprite(halo2()); hl.position.set(0, 3.1, 0); hl.scale.setScalar(1.05); g.add(hl); }
        R.part(g, { s: 'cone', r: .32, h: .22, y: 3.38, c: '#2d2a3a', seg: 10, rough: .5, metal: .6 });
        ph?.addCyl({ x: o.x, z: o.z, y: 1.5, r: .16, hy: 1.5, tag: 'lamp' });
        return g;
      },
      bench(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), wood = o.m || R.mat(o.c || '#a0673a', { rough: .75 });
        R.part(g, { s: 'box', w: 2.2, h: .14, d: .62, y: .55, m: wood });
        R.part(g, { s: 'box', w: 2.2, h: .5, d: .12, y: .92, z: -.26, m: o.m2 || wood });
        for (const s of [-1, 1]) R.part(g, { s: 'box', w: .12, h: .55, d: .5, x: s * .9, y: .27, c: '#2f2a26', rough: .5, metal: .5 });
        ph?.addBox({ x: o.x, z: o.z, y: .5, hx: 1.1, hy: .5, hz: .33, yaw: o.yaw || 0, tag: 'bench', data: { seat: true, yaw: o.yaw || 0 } });
        return g;
      },
      sign(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0);
        R.part(g, { s: 'box', w: .14, h: 1.6, d: .14, y: .8, c: '#6b4426' });
        // надпись: текстура и материал общие для одинаковых табличек (раньше — новые на каждую и до закрытия мира)
        const key = 'sign:' + (o.c || '#7c3aed') + '|' + (o.text || '');
        const mat = cache(key, () => { const t = textTex(o.text || '', o.c || '#7c3aed'); texCache.set(key, t); return new T.MeshBasicMaterial({ map: t, toneMapped: false }); });
        const m = new T.Mesh(K.geo('signplane', () => new T.PlaneGeometry(1.8, .7)), mat);
        m.position.set(0, 1.75, .08); m.userData.dyn = true; g.add(m);
        R.part(g, { s: 'box', w: 1.9, h: .8, d: .1, y: 1.75, c: '#3b2a1c' });
        ph?.addBox({ x: o.x, z: o.z, y: .8, hx: .1, hy: .8, hz: .1, tag: 'sign' });
        return g;
      },
      fence(o, ph){
        // забор от (x1, z1) до (x2, z2)
        const dx = o.x2 - o.x1, dz = o.z2 - o.z1, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz) - PI / 2;
        const g = R.group(o.parent, (o.x1 + o.x2) / 2, 0, (o.z1 + o.z2) / 2, yaw), n = Math.max(1, Math.round(len / 1.6));
        for (let i = 0; i <= n; i++) R.part(g, { s: 'box', w: .14, h: 1, d: .14, x: -len / 2 + len * i / n, y: .5, c: o.c || '#efe2c6' });
        for (const y of [.35, .75]) R.part(g, { s: 'box', w: len, h: .1, d: .06, y, c: o.c || '#efe2c6' });
        ph?.addBox({ x: (o.x1 + o.x2) / 2, z: (o.z1 + o.z2) / 2, y: .5, hx: len / 2, hy: .5, hz: .1, yaw, tag: 'fence' });
        return g;
      },
    };
    let haloMat = null;
    function halo2(){
      if (haloMat) return haloMat;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,240,190,.5)'); gr.addColorStop(.35, 'rgba(255,225,150,.16)'); gr.addColorStop(1, 'rgba(255,220,140,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; R.own.push(t);
      haloMat = new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }); R.own.push(haloMat);
      return haloMat;
    }
    R.prefab = (name, opts = {}, ph) => { const f = PF[name] || R.prefabs[name]; if (!f) throw new Error('предмет: ' + name); return f(opts, ph, R); };
    R.prefabs = {};   // игра может добавить свои

    // Текст на плоскости (табличка)
    function textTex(text, bg){
      const c = document.createElement('canvas'); c.width = 512; c.height = 200;
      const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 200);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 70; g.font = `900 ${size}px Montserrat, Arial, sans-serif`;
      while (g.measureText(text).width > 470 && size > 26) { size -= 4; g.font = `900 ${size}px Montserrat, Arial, sans-serif`; }
      g.fillText(text, 256, 104);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
    }
    R.textTex = textTex;

    // ═══ Склейка статичного мира: детали R.static → по одной сетке на материал (в участке мира, если задан R.bakeChunk);
    //     UV по миру; тень у земли; тени. Участки (м) отсекаются по видимости и в карте теней по отдельности, но вызовов
    //     больше: «Мир Денчика» (≈110 материалов, 190 тыс. треуг.) с участками 64 м — 305 сеток вместо 111 и дороже по ЦП,
    //     поэтому по умолчанию 0 — одна сетка на материал на весь мир (как раньше). Огромные мира с тяжёлой геометрией — 64 ═══
    R.bakeChunk = o.bakeChunk ?? 0;
    R.bakeStatic = (opt = {}) => {
      const CH = opt.chunk ?? R.bakeChunk;
      R.static.updateMatrixWorld(true);
      const by = new Map(), drop = [], sph = new T.Sphere();
      R.static.traverse(m => {
        if (!m.isMesh || m.userData.dyn || m.isInstancedMesh) return;
        let p = m.parent, dyn = false;
        while (p && p !== R.static) { if (p.userData.dyn) { dyn = true; break; } p = p.parent; }
        if (dyn) return;
        let key = '', cx = 0, cz = 0;
        if (CH > 0) {   // огромное (земля, небосвод холмов) — в общий участок
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          sph.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
          if (sph.radius <= CH * .75) { const ix = Math.floor(sph.center.x / CH), iz = Math.floor(sph.center.z / CH); key = ix + ',' + iz; cx = (ix + .5) * CH; cz = (iz + .5) * CH; }
        }
        const gk = m.material.uuid + '|' + key;
        let G = by.get(gk);
        if (!G) by.set(gk, (G = { mat: m.material, list: [], cx, cz }));
        G.list.push(m);
        drop.push(m);
      });
      let calls = 0;
      const p = new T.Vector3(), n = new T.Vector3(), aoMats = new Map();
      for (const { mat, list, cx, cz } of by.values()) {
        let cnt = 0;
        const parts = list.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); cnt += g.attributes.position.count; return g; });
        const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
        const tile = mat.userData?.tile, ao = !mat.userData?.noAO && q !== 'low' && !mat.isMeshBasicMaterial, col = ao ? new Float32Array(cnt * 3) : null;
        let k = 0;
        for (const g of parts) {
          const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
          pos.set(gp.array, k * 3);
          if (gn) nor.set(gn.array, k * 3);
          for (let i = 0; i < gp.count; i++) {
            p.fromBufferAttribute(gp, i);
            if (gn) n.fromBufferAttribute(gn, i); else n.set(0, 1, 0);
            if (tile) boxUV(p, n, tile, uv, k + i);
            else if (gu) { uv[(k + i) * 2] = gu.getX(i); uv[(k + i) * 2 + 1] = gu.getY(i); }
            if (col) {   // тень у земли: стены и столбы темнее внизу (как AO в HDRP — дёшево, вершинами)
              const vert = Math.abs(n.y) < .6, a = vert ? .58 + .42 * Math.min(1, Math.max(0, p.y / 1.4)) : 1;
              col[(k + i) * 3] = col[(k + i) * 3 + 1] = col[(k + i) * 3 + 2] = a;
            }
            pos[(k + i) * 3] -= cx; pos[(k + i) * 3 + 2] -= cz;   // вершины — от середины участка (сортировка «ближе — раньше»)
          }
          k += gp.count; g.dispose();
        }
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3)); mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        let useMat = mat;
        if (col) {
          mg.setAttribute('color', new T.BufferAttribute(col, 3));
          useMat = aoMats.get(mat);
          if (!useMat) {
            useMat = mat.clone(); useMat.vertexColors = true; R.own.push(useMat); aoMats.set(mat, useMat);
            if (mat.userData.bloom) R.bloom(useMat, mat.userData.bloom);   // копия метку свечения не наследует
          }
        }
        mg.computeBoundingSphere();
        const mesh = new T.Mesh(mg, useMat); mesh.userData.own = true;
        mesh.position.set(cx, 0, cz); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        if (shadows) { mesh.castShadow = !mat.userData?.noCast && !mat.isMeshBasicMaterial; mesh.receiveShadow = !mat.isMeshBasicMaterial; }
        scene.add(mesh); calls++;
      }
      drop.forEach(m => m.parent?.remove(m));
      SH.dirty = true;
      return calls;
    };

    // ═══ Постобработка (post.js): создаётся последней — ей нужен готовый рендерер ═══
    if (wantPost) {
      try { R.post = E.post(R); } catch (e) { console.warn('постобработка выключена:', e); R.post = null; }
      if (R.post && !R.post.ok) { R.post.dispose(); R.post = null; }
      if (!R.post) r.setPixelRatio(PR0);
    }
    if (window.D37Opt?.fps && E.perf && !E.perf.on) E.perf.toggle(true);   // настройки: «Счётчик FPS» — сразу при входе в 3D
    // графика игрока (настройки) и свет по умолчанию — сразу, до первого кадра
    { const O = window.D37Opt; if (O) optSync(O); else R.applyGfx(E.gfxResolve({}, devInfo())); }
    applyLighting();
    R.envNow();   // отражения неба — до первого кадра (иначе шейдеры соберутся дважды: без них и с ними)
    return R;
  };

  // Камера — js/engine/camera.js (E.cameraRig)
})();
