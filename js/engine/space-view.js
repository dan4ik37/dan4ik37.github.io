// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — небо системы (D37E.spaceView) и карта системы (D37E.spaceMap). Тела летят по рельсам Кеплера
//  (js/engine/orbit.js, system.js), здесь — только картинка. План — docs/plans/planet-space.md §1.5, §2 (T-079 PS-1).
// ═══════════════════════════════════════
// SV = D37E.spaceView(R, V, S, { observer, stubs }) — R: рендерер движка, V: вид планеты (planet-view.js), S: D37E.system.create().
//   Все тела неба — ОДИН вызов отрисовки (экземпляры): луна — шар с фазой, морями и кратерами, сквозь тот же воздух, что и небо
//   (дымка днём, краснеет у горизонта), в тени планеты — лунное затмение по точкам диска (край тени ползёт, в тени — красная);
//   далёкие планеты — точки с блеском по фазе и расстоянию; солнце из космоса — диск и свечение (в воздухе его рисует атмосфера).
//   Каждый кадр перед V.update: SV.update(t, ms) — t секунды мира (D37E.clock.t()), ms — то же в мс (времена года).
//   Отдаёт планете: V.skyM (поворот «небо системы → BF»: звёзды там же, где планеты) и V.sunK (доля солнца: солнечное затмение).
//   SV.list — что в небе (system.js S.sky), SV.moon — фаза Луны, SV.cpu — мс на кадр, SV.dispose().
// M = D37E.spaceMap(el, S, { observer, time(), clock, stubs, onLook(id), onClose }) — карта «🪐 Система» (2D, холст): орбиты, тела
//   с освещённой стороной, тень планеты, «ты здесь», фазы Луны и ближайшие затмения, предпросмотр времени (только на карте).
//   M.open() / M.close() / M.isOpen / M.dispose(). Пока закрыта — ничего не делает.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const sqrt = Math.sqrt, max = Math.max, min = Math.min, abs = Math.abs;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const now = () => (root.performance ? root.performance.now() : Date.now());
  const lin = h => { const n = parseInt(String(h).slice(1), 16) || 0xcccccc, f = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)]; };

  // ═══ Шейдер тел неба (атмосфера — общие куски planet-view.js: тела светят сквозь тот же воздух) ═══
  // вершины — квадрат-«картинка» к камере; воздух до тела (дымка и ослабление) — в вершине (тело маленькое: по диску почти
  // одинаково); 8 varying — минимум WebGL1
  const vert = G => `#define NSAMP 4
attribute vec4 aCen;
attribute vec4 aSun;
attribute vec4 aFwd;
attribute vec4 aUp;
attribute vec4 aCol;
attribute vec4 aTru;
uniform vec4 uSky;
${G.ATMO}
${G.PHASE}
varying vec4 vA; varying vec4 vI; varying vec4 vX; varying vec3 vSun; varying vec3 vFwd; varying vec3 vUp; varying vec3 vCol; varying vec4 vTru;
void main(){
  vec4 mv = viewMatrix * vec4( aCen.xyz, 1.0 );
  mv.xy += position.xy * aCen.w;
  gl_Position = projectionMatrix * mv;
  vec3 d = normalize( aCen.xyz - cameraPosition );
  vec3 inR, inM, T; d37Atmo( uCamP, d, 1e30, inR, inM, T );
  float c = dot( d, uSunL );
  vec3 ins = uSky.x * ( uBetaR * inR * d37PhR( c ) + uBetaM * inM * d37PhM( c, uAtm3.z ) );
  vA = vec4( position.xy, aFwd.w, aUp.w );
  vI = vec4( ins, T.x ); vX = vec4( T.y, T.z, aSun.w, aCol.w );
  vSun = aSun.xyz; vFwd = aFwd.xyz; vUp = aUp.xyz; vCol = aCol.rgb; vTru = aTru;
}`;
  const frag = G => `
uniform vec3 uSunL;
uniform float uSunAng;
uniform float uPR;
uniform float uAirRed;
uniform float uSunW;
varying vec4 vA; varying vec4 vI; varying vec4 vX; varying vec3 vSun; varying vec3 vFwd; varying vec3 vUp; varying vec3 vCol; varying vec4 vTru;
float d37Hb( vec3 p ){ p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float d37Nb( vec3 x ){
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( d37Hb( i ), d37Hb( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( d37Hb( i + vec3( 0.0, 1.0, 0.0 ) ), d37Hb( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
              mix( mix( d37Hb( i + vec3( 0.0, 0.0, 1.0 ) ), d37Hb( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( d37Hb( i + vec3( 0.0, 1.0, 1.0 ) ), d37Hb( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
void main(){
  float rr = dot( vA.xy, vA.xy );
  if ( rr > 1.0 ) discard;
  vec3 T = vec3( vI.w, vX.x, vX.y );
  float light0 = vX.z;
  vec3 col;
  if ( vA.z > 1.5 ) {
    // солнце из космоса: диск (край темнее) и свечение; картинка — 6 радиусов солнца
    float r = sqrt( rr ) * 6.0, q = clamp( 1.0 - r * r, 0.0, 1.0 );
    float disc = 1.0 - clamp( ( r - 0.97 ) / 0.06, 0.0, 1.0 );
    float halo = exp( -2.6 * max( r - 1.0, 0.0 ) ) * ( 1.0 - sqrt( rr ) );
    col = vCol * ( disc * 60.0 * ( 0.6 + 0.4 * sqrt( q ) ) + halo * 2.4 ) * light0 * uSunW;
  } else {
    // нормаль шара: оси камеры (строки матрицы вида) → мир
    vec3 nV = vec3( vA.xy, sqrt( 1.0 - rr ) );
    vec3 n = normalize( nV.x * vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ) + nV.y * vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] )
                      + nV.z * vec3( viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2] ) );
    vec3 S = normalize( vSun ), F = normalize( vFwd ), Up = normalize( vUp - F * dot( vUp, F ) ), Rt = cross( Up, F );
    vec3 p = vec3( dot( n, F ), dot( n, Up ), dot( n, Rt ) );   // точка шара в осях тела (у луны — «к планете», полюс, вбок)
    vec3 alb = vCol;
    if ( vA.z < 0.5 ) {   // камень, луна: моря (тёмные пятна) и кратеры
      float mr = d37Nb( p * 2.2 + 3.1 ) * 0.65 + d37Nb( p * 4.7 - 1.3 ) * 0.35;
      alb *= mix( 1.08, 0.6, smoothstep( 0.5, 0.64, mr ) );
      float cr = d37Nb( p * 11.0 ) * 0.6 + d37Nb( p * 23.0 + 7.0 ) * 0.4;
      alb *= 0.86 + 0.28 * cr;
    } else {   // газ: полосы вдоль широт
      alb *= 0.84 + 0.16 * sin( p.y * 17.0 + d37Nb( p * 3.0 ) * 2.4 );
    }
    float ndl = dot( n, S ), lit = clamp( ( ndl + 0.02 ) / 1.02, 0.0, 1.0 );
    // тень планеты наблюдателя на диске (лунное затмение): настоящая точка шара → расстояние до оси тени; ширина полутени —
    // по угловому радиусу солнца
    float sh = 1.0;
    if ( vTru.w > 0.0 ) {
      vec3 q = vTru.xyz + n * vTru.w;
      float x = -dot( q, uSunL );
      if ( x > 0.0 ) {
        float rho = length( q + uSunL * x ), ru = uPR - x * uSunAng, rp = uPR + x * uSunAng;
        float k = clamp( ( rho - ru ) / max( rp - ru, 1.0 ), 0.0, 1.0 );
        sh = k * k * ( 3.0 - 2.0 * k );
        if ( ru < 0.0 ) sh = max( sh, 1.0 - uPR * uPR / max( x * x * uSunAng * uSunAng, 1.0 ) );
      }
    }
    // в тени планеты с воздухом — красный свет (преломился в её атмосфере), пепельный свет планеты — на ночной стороне
    vec3 toP = vTru.w > 0.0 ? normalize( -vTru.xyz ) : S;
    float shine = 0.5 + 0.5 * dot( S, toP );
    vec3 red = uAirRed * vec3( 0.62, 0.17, 0.07 ) * ( 1.0 - sh ) * 0.07 * max( ndl, 0.0 );
    vec3 disc = alb * ( 2.2 * lit * light0 * sh + red + 0.016 * shine * max( dot( n, toP ), 0.0 ) );
    // точка (меньше 3 пикселей): пятнышко с блеском по фазе и расстоянию; между — плавно
    vec3 dot0 = normalize( vCol + 1e-4 ) * 1.6 * vX.w * exp( -4.5 * rr ) * light0;
    col = mix( dot0, disc, vA.w );
  }
  gl_FragColor = vec4( col * T + vI.xyz, 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

  E.spaceView = function (R, V, S, o = {}){
    const T = R.T, G = E.planetView && E.planetView.GLSL, P = V.P, PD = P.def, A = PD.atmo;
    if (!G || !V.U) throw new Error('space-view: нужен planet-view.js с общими кусками атмосферы');
    const obs = S.body(o.observer || PD.id || 'home');
    if (!obs || obs.isStar) throw new Error('space-view: нет тела ' + (o.observer || PD.id));
    const CAP = 24;
    const g = new T.InstancedBufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const att = name => { const a = new T.InstancedBufferAttribute(new Float32Array(CAP * 4), 4); a.setUsage(T.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const aCen = att('aCen'), aSun = att('aSun'), aFwd = att('aFwd'), aUp = att('aUp'), aCol = att('aCol'), aTru = att('aTru');
    g.instanceCount = 0;
    const uni = { ...V.U, uSunAng: { value: .0047 }, uPR: { value: P.SEAR }, uAirRed: { value: A ? 1 : 0 }, uSunW: { value: 1 } };
    const mat = new T.ShaderMaterial({ name: 'planet-bodies', uniforms: uni, vertexShader: vert(G), fragmentShader: frag(G), fog: false, lights: false });
    mat.customProgramCacheKey = () => 'd37bodies1';
    const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 899; mesh.name = 'planet-bodies';
    R.scene.add(mesh);
    const SV = { S, obs, list: [], t: 0, ms: 0, cpu: 0, dead: false, stubs: !!o.stubs, F: { M: new Float64Array(9), sun: new Float64Array(3) },
      moon: { id: '', lit: 0, wax: false, elong: 0 } };
    const CAM = new Float64Array(3), L3 = [0, 0, 0], COL = new Map(), SKYO = { stubs: false, F: SV.F };   // SKYO — один объект на все кадры
    const colOf = b => { let c = COL.get(b); if (!c) { c = lin(b.isStar ? '#fff4e0' : (b.look && b.look.color) || '#cccccc'); COL.set(b, c); } return c; };
    const moonId = (obs.def.moons || []).find(x => typeof x === 'string' && S.byId.get(x));
    let ready = false;
    // ── Каждый кадр (до V.update): где все тела, поворот неба, затмение солнца у камеры ──
    SV.update = (t, ms) => {
      if (SV.dead) return;
      const t0 = now();
      SV.t = t; SV.ms = ms;
      const cam = R.camera;
      P.toBF(V.fr, cam.position.x, cam.position.y, cam.position.z, CAM);
      SKYO.stubs = SV.stubs; S.sky(obs, t, ms, CAM, SV.list, SKYO);
      V.skyM = SV.F.M;
      const sun = SV.list[SV.list.length - 1];
      V.sunK = sun && sun.kind === 'sun' ? sun.light : 1;
      if (moonId) { const ph = S.phase(obs, moonId, t); SV.moon.id = moonId; SV.moon.lit = ph.lit; SV.moon.wax = ph.wax; SV.moon.elong = ph.elong; }
      ready = true;
      SV.cpu = now() - t0;
    };
    // ── Перед кадром (после planet-view: дальность камеры уже своя) — в оси куска, картинки на 0,9 дальности ──
    const pre = () => {
      if (SV.dead || !ready) return;
      const t0 = now(), cam = R.camera, far = cam.far, fr = V.fr;
      const pxK = 2 * Math.tan(cam.fov * Math.PI / 360) / max(1, R.h || R.r.domElement.height || 600);   // радиан на пиксель
      const alt = V.alt, top = A ? A.top : 0;
      // вес солнца-картинки: в воздухе солнце рисует атмосфера (купол); выше — картинка (как вес оболочки неба)
      const kf = A ? clamp((alt - top * .9) / (top * 1.6), 0, 1) : 1;
      uni.uSunW.value = kf;
      let n = 0;
      const cx = CAM[0], cy = CAM[1], cz = CAM[2], cr = sqrt(cx * cx + cy * cy + cz * cz), rA = P.SEAR + top;
      for (let k = 0; k < SV.list.length && n < CAP; k++) {
        const e = SV.list[k];
        if (e.kind === 'sun') {
          if (kf <= 0) continue;
          // луч на солнце задевает воздух или планету — солнце рисует атмосфера (или его не видно)
          const b = cx * e.d[0] + cy * e.d[1] + cz * e.d[2], c2 = cr * cr - rA * rA, disc = b * b - c2;
          if (cr <= rA || (disc > 0 && -b - sqrt(disc) > 0)) continue;
        }
        P.dirToL(fr, e.d[0], e.d[1], e.d[2], L3);
        const dd = min(e.dist, far * .9), ang = e.kind === 'sun' ? e.rad * 6 : max(e.rad, 2.2 * pxK), rd = dd * Math.tan(min(ang, 1.2));
        const j = 4 * n;
        aCen.array[j] = cam.position.x + L3[0] * dd; aCen.array[j + 1] = cam.position.y + L3[1] * dd; aCen.array[j + 2] = cam.position.z + L3[2] * dd; aCen.array[j + 3] = rd;
        P.dirToL(fr, e.sun[0], e.sun[1], e.sun[2], L3);
        aSun.array[j] = L3[0]; aSun.array[j + 1] = L3[1]; aSun.array[j + 2] = L3[2]; aSun.array[j + 3] = e.light;
        const c3 = colOf(e.b);
        if (e.kind === 'sun') {
          aFwd.array[j] = 1; aFwd.array[j + 1] = 0; aFwd.array[j + 2] = 0; aFwd.array[j + 3] = 2;
          aUp.array[j] = 0; aUp.array[j + 1] = 1; aUp.array[j + 2] = 0; aUp.array[j + 3] = 1;
          aCol.array[j] = c3[0]; aCol.array[j + 1] = c3[1]; aCol.array[j + 2] = c3[2]; aCol.array[j + 3] = 1;
          aTru.array[j] = aTru.array[j + 1] = aTru.array[j + 2] = aTru.array[j + 3] = 0;
        } else {
          P.dirToL(fr, e.fwd[0], e.fwd[1], e.fwd[2], L3);
          aFwd.array[j] = L3[0]; aFwd.array[j + 1] = L3[1]; aFwd.array[j + 2] = L3[2]; aFwd.array[j + 3] = e.b.type === 'gas' ? 1 : 0;
          P.dirToL(fr, e.up[0], e.up[1], e.up[2], L3);
          // разрешённость: настоящий радиус больше 3 пикселей — шар, меньше 1 — точка
          aUp.array[j] = L3[0]; aUp.array[j + 1] = L3[1]; aUp.array[j + 2] = L3[2]; aUp.array[j + 3] = clamp((e.rad / pxK - 1) / 2, 0, 1);
          // блеск точки: логарифм потока (как звёздная величина), ярче звёзд неба
          const br = clamp(.9 + .12 * (Math.log10(max(e.flux, 1e-30)) + 10), .25, 2.2);
          aCol.array[j] = c3[0]; aCol.array[j + 1] = c3[1]; aCol.array[j + 2] = c3[2]; aCol.array[j + 3] = br;
          // настоящий центр от центра планеты (оси куска) и радиус — для тени планеты на диске; далеко за тенью — без неё
          const near = e.dist < P.SEAR * 600;
          P.dirToL(fr, e.cen[0], e.cen[1], e.cen[2], L3);
          aTru.array[j] = L3[0]; aTru.array[j + 1] = L3[1]; aTru.array[j + 2] = L3[2]; aTru.array[j + 3] = near ? e.b.R : 0;
        }
        n++;
      }
      g.instanceCount = n;
      aCen.needsUpdate = aSun.needsUpdate = aFwd.needsUpdate = aUp.needsUpdate = aCol.needsUpdate = aTru.needsUpdate = true;
      mesh.visible = n > 0;
      SV.cpu += now() - t0;
    };
    R.preRender.push(pre);
    SV.dispose = () => {
      if (SV.dead) return;
      SV.dead = true;
      R.scene.remove(mesh); g.dispose(); mat.dispose();
      const i = R.preRender.indexOf(pre); if (i >= 0) R.preRender.splice(i, 1);
      if (V.skyM === SV.F.M) V.skyM = null;
      V.sunK = 1;
    };
    return SV;
  };

  // ═══ Карта системы «🪐 Система» (2D) ═══
  const CSS = `
.sm{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:rgba(3,5,14,.94);color:#e2e8f0;font:600 12px/1.4 Montserrat,system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
.sm[hidden]{display:none}
.sm-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px 4px}
.sm-top b{font-size:14px;color:#fff;margin-right:auto}
.sm button{border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.32rem .66rem;background:rgba(14,12,32,.82);color:#fff;font:800 .76rem Montserrat,sans-serif;cursor:pointer;min-height:36px;min-width:36px}
.sm button.on{background:var(--accent,#9b6dff);border-color:transparent}
.sm-body{flex:1;display:flex;min-height:0}
.sm-cv{position:relative;flex:1;min-height:120px}
.sm-cv canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
.sm-time{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:4px 10px}
.sm-time span{min-width:150px;color:#c7d2fe;font-weight:700}
.sm-info{width:min(330px,38%);padding:6px 12px 10px;overflow:auto;white-space:pre-wrap;color:#cbd5e1;border-left:1px solid rgba(255,255,255,.08)}
.sm-info b{color:#fff}
.sm-clock{padding:0 10px 8px;color:#94a3b8;font-size:11px}
@media (max-width:760px){.sm-body{flex-direction:column}.sm-info{width:auto;max-height:36%;border-left:0;border-top:1px solid rgba(255,255,255,.08)}}
@media (max-width:640px){.sm button{padding:.26rem .5rem;font-size:.7rem}.sm-time span{min-width:0;flex-basis:100%}}`;
  const css = () => { if (!root.document || document.getElementById('sm-css')) return; const s = document.createElement('style'); s.id = 'sm-css'; s.textContent = CSS; document.head.appendChild(s); };
  const TYPE_RU = { rocky: 'каменная планета', ocean: 'планета-океан', ice: 'ледяная', desert: 'пустынная планета', lava: 'огненная', toxic: 'ядовитая', gas: 'газовый великан', moon: 'луна', aster: 'астероид', belt: 'пояс', star: 'звезда' };
  const U = 2.1 / 1.8;
  const fmtLen = u => { const km = u / U / 1000; return km >= 1e6 ? (km / 1e6).toFixed(km >= 1e7 ? 0 : 1) + ' млн км' : km >= 1000 ? Math.round(km).toLocaleString('ru-RU') + ' км' : km.toFixed(km >= 10 ? 0 : 1) + ' км'; };
  const fmtDur = s => {
    const a = abs(s);
    if (a < 90) return Math.round(a) + ' с';
    if (a < 5400) return Math.round(a / 60) + ' мин';
    if (a < 172800) { const h = Math.floor(a / 3600), m = Math.round((a - h * 3600) / 60); return h + ' ч' + (m ? ' ' + m + ' мин' : ''); }
    return (a / 86400).toFixed(a < 864000 ? 1 : 0) + ' сут';
  };
  const ECL_RU = { total: 'полное', annular: 'кольцевое', partial: 'частное', penumbral: 'полутеневое' };

  E.spaceMap = function (host, S, o = {}){
    css();
    const obs = S.body(o.observer || 'home');
    const el = document.createElement('div'); el.className = 'sm'; el.hidden = true;
    const top = document.createElement('div'); top.className = 'sm-top';
    const title = document.createElement('b'); title.textContent = '🪐 ' + (S.title || 'Система');
    top.appendChild(title);
    const btn = (txt, tip, f, box = top) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = tip; b.addEventListener('click', e => { e.stopPropagation(); f(b); }); box.appendChild(b); return b; };
    const focusBtns = [];
    const addFocus = (id, txt) => { const b = btn(txt, 'Показать', () => focus(id, true)); b.dataset.f = id; focusBtns.push(b); };
    addFocus('sun', '☀ Вся система');
    if (obs) addFocus(obs.id, '🌍 ' + obs.title.replace(/ планета$/, ''));
    for (const b of S.list) if (!b.stub && b !== obs && b.parent.isStar) addFocus(b.id, (b.type === 'desert' ? '🏜 ' : '🪐 ') + b.title);
    btn('✕', 'Закрыть (Esc)', () => M.close());
    const cvw = document.createElement('div'); cvw.className = 'sm-cv';
    const cv = document.createElement('canvas'); cvw.appendChild(cv);
    const tl = document.createElement('div'); tl.className = 'sm-time';
    const tlab = document.createElement('span');
    btn('−сут', 'На сутки назад (только на карте)', () => shift(-86400), tl);
    btn('−ч', 'На час назад', () => shift(-3600), tl);
    btn('Сейчас', 'Время мира', () => { prev = 0; anim = false; bAnim.classList.remove('on'); }, tl);
    btn('+ч', 'На час вперёд', () => shift(3600), tl);
    btn('+сут', 'На сутки вперёд', () => shift(86400), tl);
    const bAnim = btn('⏵ ×5000', 'Ускорить время на карте', b => { anim = !anim; b.classList.toggle('on', anim); }, tl);
    tl.appendChild(tlab);
    const info = document.createElement('div'); info.className = 'sm-info';
    const clk = document.createElement('div'); clk.className = 'sm-clock';
    const body = document.createElement('div'); body.className = 'sm-body';
    body.append(cvw, info);
    el.append(top, body, tl, clk);
    host.appendChild(el);
    const ctx = cv.getContext('2d');
    const M = { el, isOpen: false, sel: obs ? obs.id : 'sun', stats: { n: 0, ms: 0, max: 0 } };   // stats — время рисования карты (замеры)
    let raf = 0, last = 0, prev = 0, anim = false, W = 1, H = 1, DPR = 1, view = { x: 0, z: 0, s: 1e-8 }, goal = null, fol = 'home', evAt = -1e9, ev = null, infoAt = 0;
    const shift = d => { prev += d; };
    const tNow = () => (o.time ? o.time() : 0) + prev;
    // ── вид: центр (оси системы x, z) и масштаб (пикселей на u); «следить» за телом ──
    const P3 = new Float64Array(3), Q3 = new Float64Array(3);
    function fitScale(id){
      if (id === 'sun') { let r = 0; for (const b of S.list) if (!b.stub || o.stubs) if (b.parent.isStar) r = max(r, b.el.a * (1 + b.el.e)); for (const bl of S.belts) if (!bl.stub || o.stubs) r = max(r, bl.a + bl.width / 2); return .46 * min(W, H) / max(r, 1); }
      const b = S.byId.get(id); if (!b) return view.s;
      let r = b.R * 6;
      for (const k of b.kids) if (!k.stub || o.stubs) r = max(r, k.el.a * (1 + k.el.e) * 1.15);
      if (!b.kids.length || r === b.R * 6) r = max(r, b.R * 40);
      return .46 * min(W, H) / r;
    }
    function focus(id, user){
      fol = id; goal = { s: fitScale(id) }; M.sel = id; infoAt = 0;
      for (const b of focusBtns) b.classList.toggle('on', b.dataset.f === id);
      if (user) evAt = -1e9;
    }
    // ── рисование ──
    const PATH = new Map();   // тело → точки орбиты (от родителя, оси системы)
    let stars = null;
    function resize(){
      const r = cv.getBoundingClientRect(); DPR = min(2, root.devicePixelRatio || 1);
      W = max(1, r.width); H = max(1, r.height);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      stars = document.createElement('canvas'); stars.width = cv.width; stars.height = cv.height;
      const sc = stars.getContext('2d'); let s = 99; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 260; k++) { const a = .15 + .6 * rnd() ** 3; sc.fillStyle = `rgba(220,230,255,${a.toFixed(2)})`; sc.fillRect(rnd() * stars.width, rnd() * stars.height, DPR, DPR); }
    }
    const sx = x => (x - view.x) * view.s + W / 2, sy = z => (z - view.z) * view.s + H / 2;
    function draw(t){
      S.at(t);
      // следуем за телом; масштаб — плавно к цели
      if (fol && fol !== 'sun') { S.posOf(fol, t, P3); view.x = P3[0]; view.z = P3[2]; } else if (fol === 'sun') { view.x = 0; view.z = 0; }
      if (goal) { const k = .2, ls = Math.log(view.s) + (Math.log(goal.s) - Math.log(view.s)) * k; view.s = Math.exp(ls); if (abs(Math.log(view.s / goal.s)) < .002) { view.s = goal.s; goal = null; } }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#03050e'; ctx.fillRect(0, 0, W, H);
      if (stars) ctx.drawImage(stars, 0, 0, W, H);
      const big = 8 * max(W, H);
      // пояс
      for (const bl of S.belts) {
        if (bl.stub && !o.stubs) continue;
        const r0 = (bl.a - bl.width / 2) * view.s, r1 = (bl.a + bl.width / 2) * view.s;
        if (r1 < 2 || r0 > big) continue;
        ctx.beginPath(); ctx.arc(sx(0), sy(0), (r0 + r1) / 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(180,160,130,.16)'; ctx.lineWidth = max(1, r1 - r0); ctx.stroke();
      }
      // орбиты
      for (const b of S.list) {
        if (b.stub && !o.stubs) continue;
        const par = b.parent, rs = b.el.a * view.s;
        if (rs < 5) continue;
        let pts = PATH.get(b); if (!pts) { pts = S.orbitPath(b, 160); PATH.set(b, pts); }
        if (par.isStar) { P3[0] = P3[1] = P3[2] = 0; } else S.posOf(par, t, P3);
        const strong = b.id === M.sel || b === obs;
        ctx.strokeStyle = strong ? 'rgba(165,180,252,.75)' : 'rgba(148,163,184,.35)'; ctx.lineWidth = strong ? 1.6 : 1;
        if (rs > big) {   // огромная на экране: кусочек касательной у тела (иначе хорды «срезают» дугу)
          S.posOf(b, t, Q3); const X = sx(Q3[0]), Y = sy(Q3[2]);
          if (X < -W || X > 2 * W || Y < -H || Y > 2 * H) continue;
          S.velOf(b, t, P3); const vv = Math.hypot(P3[0], P3[2]) || 1, L = 3 * max(W, H);
          ctx.beginPath(); ctx.moveTo(X - P3[0] / vv * L, Y - P3[2] / vv * L); ctx.lineTo(X + P3[0] / vv * L, Y + P3[2] / vv * L); ctx.stroke();
          continue;
        }
        ctx.beginPath();
        for (let k = 0; k <= 160; k++) { const q = 3 * (k % 160), X = sx(P3[0] + pts[q]), Y = sy(P3[2] + pts[q + 2]); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
        ctx.stroke();
      }
      // солнце
      { const X = sx(0), Y = sy(0), r = max(5, S.star.R * view.s);
        const gr = ctx.createRadialGradient(X, Y, 0, X, Y, r * 4); gr.addColorStop(0, 'rgba(255,240,200,.9)'); gr.addColorStop(.25, 'rgba(255,200,120,.35)'); gr.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, r * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff4d6'; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); }
      // тела: тёмный круг + освещённая половина (к солнцу); у наблюдателя — тень от солнца (конус) и «ты здесь»
      ctx.font = '700 11px Montserrat, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const b of S.list) {
        if (b.stub && !o.stubs) continue;
        const par = b.parent;
        if (!par.isStar && b.el.a * view.s < 7) continue;   // луна на месте своей планеты — не видна
        S.posOf(b, t, Q3);
        const X = sx(Q3[0]), Y = sy(Q3[2]);
        if (X < -60 || X > W + 60 || Y < -60 || Y > H + 60) continue;
        const r = max(b.R * view.s, par.isStar ? 4.5 : 3.2), ang = Math.atan2(-Q3[2] * 1, -Q3[0] * 1);   // к солнцу (на экране y = z)
        if (b === obs && b.R * view.s > 2) {   // тень планеты (для лунных затмений): полоса от планеты прочь от солнца
          const L = min(big, b.el.a * .02 * view.s + 3 * max(W, H) * 0 + (b.kids[0] ? b.kids[0].el.a * 1.3 * view.s : 40)), dx = -Math.cos(ang), dy = -Math.sin(ang);
          ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath();
          ctx.moveTo(X - dy * r, Y + dx * r); ctx.lineTo(X - dy * r + dx * L, Y + dx * r + dy * L); ctx.lineTo(X + dy * r + dx * L, Y - dx * r + dy * L); ctx.lineTo(X + dy * r, Y - dx * r); ctx.closePath(); ctx.fill();
        }
        const c = (b.look && b.look.color) || '#cccccc';
        ctx.fillStyle = '#1b1f2e'; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X, Y, r, ang - Math.PI / 2, ang + Math.PI / 2); ctx.closePath(); ctx.fill();
        if (b.id === M.sel) { ctx.strokeStyle = '#a5b4fc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
        if (b === obs && o.where && b.R * view.s > 6) {   // «ты здесь»: точка на диске (точка камеры, оси системы)
          const w = o.where(); if (w) { ctx.fillStyle = '#ff5a6b'; ctx.beginPath(); ctx.arc(X + w[0] * b.R * view.s, Y + w[2] * b.R * view.s, 2.6, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.fillStyle = b === obs ? '#fde68a' : '#e2e8f0';
        ctx.fillText(b.title + (b === obs ? ' — ты здесь' : ''), X + r + 6, Y);
      }
      // масштаб: полоска
      { const target = 120 / view.s, p10 = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 5, 10].map(k => k * p10).filter(v => v <= target).pop() || p10, px = nice * view.s;
        ctx.strokeStyle = 'rgba(203,213,225,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, H - 14); ctx.lineTo(12 + px, H - 14); ctx.stroke();
        ctx.fillStyle = '#cbd5e1'; ctx.fillText(fmtLen(nice), 16 + px, H - 14); }
    }
    // ── сведения о выбранном теле, фазы и затмения ──
    function infoText(t){
      const b = S.byId.get(M.sel);
      const lines = [];
      if (!b || b.isStar) {
        lines.push('☀ ' + S.star.title + ' — звезда системы. Планеты летят по орбитам Кеплера: чем дальше, тем медленнее.');
        for (const x of S.list) if (x.parent.isStar && (!x.stub || o.stubs)) lines.push(`• ${x.title}: год ${fmtDur(x.T)}, орбита ${fmtLen(x.el.a)}`);
      } else {
        const D = b.def;
        lines.push(`${b.title} — ${TYPE_RU[b.type] || b.type}${b.stub ? ' (заготовка)' : ''}`);
        lines.push(`радиус ${fmtLen(b.R)} · тяжесть ${(D.g).toFixed(2)} g · ${D.locked ? 'всегда одной стороной к ' + b.parent.title : 'сутки ' + fmtDur(D.day)}`);
        lines.push(`${b.parent.isStar ? 'год' : 'оборот вокруг ' + b.parent.title} — ${fmtDur(b.T)} · ${D.air ? 'воздух ' + Math.round(D.air.p) + ' кПа' : 'без воздуха'}`);
        if (obs && b !== obs) { S.posOf(b, t, P3); S.posOf(obs, t, Q3); lines.push('от тебя: ' + fmtLen(Math.hypot(P3[0] - Q3[0], P3[1] - Q3[1], P3[2] - Q3[2]))); }
        const moonId = obs && (obs.def.moons || []).find(x => typeof x === 'string' && S.byId.get(x) && (!S.byId.get(x).stub || o.stubs));
        if (moonId && (b.id === moonId || b === obs)) {
          const ph = S.phase(obs, moonId, t), pc = Math.round(ph.lit * 100);
          const name = pc < 3 ? 'новолуние' : pc > 97 ? 'полнолуние' : (ph.wax ? 'растущая' : 'убывающая') + ' ' + pc + ' %';
          lines.push(`🌙 ${S.byId.get(moonId).title}: ${name}`);
          if (!ev || now() - evAt > 30000 || ev.t0 !== t && abs(ev.t0 - t) > 600) { ev = S.moonEvents(obs, moonId, t); ev.t0 = t; evAt = now(); }
          lines.push(`новолуние через ${fmtDur(ev.newMoon - t)} · полнолуние через ${fmtDur(ev.fullMoon - t)}`);
          lines.push(ev.solar ? `☀🌑 солнечное затмение (${ECL_RU[ev.solar.kind]}, где-то на ${obs.title.replace(/ая планета$/, 'ой планете')}) — через ${fmtDur(ev.solar.t - t)}` : '☀🌑 солнечных затмений в ближайшие дни нет (сезон затмений — дважды в год)');
          lines.push(ev.lunar ? `🌕🔴 лунное затмение (${ECL_RU[ev.lunar.kind]}) — через ${fmtDur(ev.lunar.t - t)}` : '🌕 лунных затмений в ближайшие дни нет');
        }
      }
      return lines.join('\n');
    }
    function clockText(){
      const C = o.clock;
      if (!C) return '';
      const d = new Date(C.now() + prev * 1000 + 3 * 3600000), p2 = x => String(x).padStart(2, '0');
      const when = `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} МСК`;
      const src = C.state === 'sync' ? `по часам сервера (±${Math.max(1, Math.round(C.rtt / 2))} мс)` : C.state === 'nosql' ? 'по часам устройства (planet.sql ещё не запущен)' : 'по часам устройства (сервер не ответил)';
      return `🕒 Время мира: ${when} · ${src}`;
    }
    // ── цикл карты (только пока открыта; ~30 кадров/с) ──
    function loop(ts){
      raf = root.requestAnimationFrame(loop);
      if (ts - last < 30) return;
      const dt = last ? min(.1, (ts - last) / 1000) : 0; last = ts;
      if (anim) prev += dt * 5000;
      const t = tNow();
      const d0 = now(); try { draw(t); } catch (e) { console.warn('карта системы:', e); } const dd = now() - d0; M.stats.n++; M.stats.ms += dd; if (dd > M.stats.max) M.stats.max = dd;
      if (ts - infoAt > 500) {
        infoAt = ts;
        info.textContent = infoText(t);
        clk.textContent = clockText();
        tlab.textContent = prev === 0 ? '⏱ сейчас (время мира)' : `⏱ ${prev > 0 ? '+' : '−'}${fmtDur(prev)} (только на карте)`;
      }
    }
    // ── мышь и пальцы: колесо и щипок — масштаб, тянуть — двигать, нажать — выбрать тело ──
    const ptr = new Map();
    let pinch = 0, moved = 0;
    const zoomAt = (k, X, Y) => {
      const wx = (X - W / 2) / view.s + view.x, wz = (Y - H / 2) / view.s + view.z;
      view.s = clamp(view.s * k, 1e-12, 1); goal = null; fol = null;
      view.x = wx - (X - W / 2) / view.s; view.z = wz - (Y - H / 2) / view.s;
      for (const b of focusBtns) b.classList.remove('on');
    };
    const onWheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * .0016), e.clientX - r.left, e.clientY - r.top); };
    const onDown = e => { cv.setPointerCapture?.(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } };
    const onMove = e => {
      const p = ptr.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (ptr.size === 1) { if (abs(dx) + abs(dy) > 0) { moved += abs(dx) + abs(dy); if (moved > 6) { view.x -= dx / view.s; view.z -= dy / view.s; fol = null; goal = null; for (const b of focusBtns) b.classList.remove('on'); } } }
      p.x = e.clientX; p.y = e.clientY;
      if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect(); if (pinch > 0 && d > 0) zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch = d; moved = 99; }
    };
    const onUp = e => {
      const had = ptr.has(e.pointerId); ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0;
      if (!had || moved > 6) return;
      // нажатие: ближайшее тело в 18 пикселях
      const r = cv.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top, t = tNow();
      let best = null, bd = 18;
      const tryB = (id, x, z) => { const d = Math.hypot(sx(x) - X, sy(z) - Y); if (d < bd) { bd = d; best = id; } };
      tryB('sun', 0, 0);
      for (const b of S.list) { if (b.stub && !o.stubs) continue; if (!b.parent.isStar && b.el.a * view.s < 7) continue; S.posOf(b, t, Q3); tryB(b.id, Q3[0], Q3[2]); }
      if (best) { M.sel = best; infoAt = 0; evAt = -1e9; }
    };
    const onKey = e => { if (M.isOpen && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); M.close(); } };
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    const ro = root.ResizeObserver ? new ResizeObserver(() => { if (M.isOpen) resize(); }) : null;
    ro?.observe(cvw);
    // «👁 Посмотреть» — у выбранного тела (кроме солнца и себя): игра поворачивает камеру к нему
    const look = btn('👁 Посмотреть', 'Повернуть камеру к телу', () => { if (M.sel && M.sel !== obs?.id && o.onLook) { M.close(); o.onLook(M.sel); } }, tl);
    M.open = () => {
      if (M.isOpen) return;
      M.isOpen = true; el.hidden = false; prev = 0; anim = false; bAnim.classList.remove('on');
      resize(); focus(fol && S.byId.get(fol) ? fol : obs ? obs.id : 'sun'); view.s = goal ? goal.s : view.s; goal = null;
      last = 0; infoAt = 0; evAt = -1e9;
      root.addEventListener('keydown', onKey, true);
      raf = root.requestAnimationFrame(loop);
    };
    M.close = () => {
      if (!M.isOpen) return;
      M.isOpen = false; el.hidden = true;
      root.cancelAnimationFrame(raf); raf = 0;
      root.removeEventListener('keydown', onKey, true);
      ptr.clear();
      o.onClose?.();
    };
    M.toggle = () => M.isOpen ? M.close() : M.open();
    M.dispose = () => { M.close(); ro?.disconnect(); cv.removeEventListener('wheel', onWheel); el.remove(); PATH.clear(); stars = null; };
    M._view = view; M._draw = t => { resize(); draw(t); }; M._info = t => infoText(t); M._focus = focus;
    void look;
    return M;
  };
})();
