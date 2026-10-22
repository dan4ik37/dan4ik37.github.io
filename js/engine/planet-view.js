// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — вид планеты (D37E.planetView): куски поверхности по мере приближения (потоки, бюджет кадра, сшивка),
//  атмосфера (с орбиты и с земли — одна и та же формула), солнце, луна, звёзды, плавающее начало координат и «плоский кусок»
//  для физики. Математика — js/engine/planet.js (без three.js); план — docs/plans/planet.md (T-051).
// ═══════════════════════════════════════
// V = D37E.planetView(R, P, o) — R: рендерер движка (render.js), P: D37E.planet.create(профиль). o: { K, maxL, budget, workers, url,
//   dir (якорь при старте), onRebase }.
// Каждый кадр: V.update(dt, t) — t: секунды игры (вращение планеты). Камера — R.camera в координатах плоского куска (x — восток,
//   y — вверх, z — юг; начало — якорь на уровне моря). V.fr — текущий кусок, V.camBF — камера в системе планеты.
// V.setAnchor(dir) — переехать (позиции p' = Q p + t: слушатели V.onRebase(f) двигают игрока, камеру, машины);
// V.physics(ph) — земля и вода для physics.js (ph.terrain.sample, ph.waterLevel) в координатах куска;
// V.stats() — цифры (куски, очередь, сборка, вызовы); V.dispose() — всё убрать (потоки, сетки, небо движка — как было).
// Пока вид открыт, солнце движка (E.sunAt → небо, свет, отражения у человечков) — настоящее солнце планеты; купол неба движка
// спрятан (небо рисует атмосфера), дальность камеры — по высоте (на 24-битной глубине: море — часть сетки, небо — на дальней плоскости).
(() => {
  const E = window.D37E = window.D37E || {};
  const sqrt = Math.sqrt, max = Math.max, min = Math.min, abs = Math.abs;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const now = () => performance.now();

  // Солнце движка: обёртка E.sunAt (один раз на страницу) — пока планета открыта, небо и свет движка берут её солнце
  const SUNP = E.__sunProv || (E.__sunProv = { f: null });
  function wrapSun(){
    if (E.__sunWrapped || typeof E.sunAt !== 'function') return;
    const base = E.sunAt;
    E.sunAt = (t, out = [0, 1, 0]) => SUNP.f ? SUNP.f(t, out) : base(t, out);
    E.__sunWrapped = true;
  }

  // ═══ GLSL: атмосфера (Рэлей + Ми, оптическая глубина к солнцу — приближение функции Чепмена, Шулер, GPU Pro 3;
  //     та же формула на JS — D37E.planet.chapman, сверка с численным интегралом — scripts/planet-test.cjs) ═══
  const ATMO = `
uniform vec3 uCamP;
uniform vec3 uSunL;
uniform vec4 uAtm;
uniform vec4 uAtm2;
uniform vec4 uAtm3;
uniform vec3 uBetaR;
uniform float uBetaM;
vec2 d37RaySph( vec3 o, vec3 d, float r ){
  float b = dot( o, d ), c = dot( o, o ) - r * r, q = b * b - c;
  if ( q < 0.0 ) return vec2( 1e30, -1e30 );
  q = sqrt( q ); return vec2( -b - q, -b + q );
}
float d37Chap( float X, float h, float mu ){
  float x = X + h, c = sqrt( 1.5707963 * x );
  if ( mu >= 0.0 ) return exp( -h ) * c / ( ( c - 1.0 ) * mu + 1.0 );
  float x0 = x * sqrt( max( 1.0 - mu * mu, 0.0 ) );
  if ( x0 < X ) return 1e20;
  float c0 = sqrt( 1.5707963 * x0 );
  return max( 2.0 * c0 * exp( min( x - x0 - h, 80.0 ) ) - exp( -h ) * c / ( ( 1.0 - c ) * mu + 1.0 ), 0.0 );
}
vec3 d37SunT( vec3 p ){
  float r = length( p ), h = max( r - uAtm.x, 0.0 ), mu = dot( p, uSunL ) / r;
  float tr = d37Chap( uAtm2.x, h * uAtm2.z, mu ) * uAtm3.x, tm = d37Chap( uAtm2.y, h * uAtm2.w, mu ) * uAtm3.y;
  return exp( -( uBetaR * tr + uBetaM * 1.1 * tm ) );
}
void d37Atmo( vec3 o, vec3 d, float tMax, out vec3 inR, out vec3 inM, out vec3 T ){
  inR = vec3( 0.0 ); inM = vec3( 0.0 ); T = vec3( 1.0 );
  vec2 ta = d37RaySph( o, d, uAtm.y );
  float t0 = max( ta.x, 0.0 ), t1 = min( ta.y, tMax );
  vec2 tg = d37RaySph( o, d, uAtm.x );
  if ( tg.x > 0.0 ) t1 = min( t1, tg.x );
  if ( t1 <= t0 ) return;
  // выборки гуще там, где воздух плотнее: у ближайшей к планете точки луча (у края планеты с орбиты — тонкий слой),
  // у начала (смотрим вверх с земли) или у конца (с орбиты на землю); вес ds — по шагу этой раскладки
  float Ls = t1 - t0, tc = clamp( -dot( o, d ), t0, t1 ), sa = tc - t0, sb = t1 - tc, odR = 0.0, odM = 0.0;
  for ( int i = 0; i < NSAMP; i ++ ) {
    float u = ( float( i ) + 0.5 ) / float( NSAMP ), t, ds;
    if ( sa < 0.05 * Ls ) { t = t0 + u * u * Ls; ds = 2.0 * u * Ls / float( NSAMP ); }
    else if ( sb < 0.05 * Ls ) { float v = 1.0 - u; t = t1 - v * v * Ls; ds = 2.0 * v * Ls / float( NSAMP ); }
    else { float w = u * 2.0 - 1.0, sd = w < 0.0 ? sa : sb; t = tc + w * abs( w ) * sd; ds = 4.0 * abs( w ) * sd / float( NSAMP ); }
    vec3 p = o + d * t;
    float r = length( p ), h = max( r - uAtm.x, 0.0 );
    float dR = exp( -h * uAtm.z ) * ds, dM = exp( -h * uAtm.w ) * ds;
    float mu = dot( p, uSunL ) / r;
    float sr = d37Chap( uAtm2.x, h * uAtm2.z, mu ) * uAtm3.x, sm = d37Chap( uAtm2.y, h * uAtm2.w, mu ) * uAtm3.y;
    vec3 tr = exp( -( uBetaR * ( odR + dR * 0.5 + sr ) + uBetaM * 1.1 * ( odM + dM * 0.5 + sm ) ) );
    inR += tr * dR; inM += tr * dM;
    odR += dR; odM += dM;
  }
  T = exp( -( uBetaR * odR + uBetaM * 1.1 * odM ) );
}`;
  const PHASE = `
float d37PhR( float c ){ return 0.0596831 * ( 1.0 + c * c ); }
float d37PhM( float c, float g ){ float g2 = g * g; return 0.1193662 * ( 1.0 - g2 ) * ( 1.0 + c * c ) / ( ( 2.0 + g2 ) * pow( max( 1.0 + g2 - 2.0 * g * c, 1e-4 ), 1.5 ) ); }`;

  // ── Поверхность: цвет вершины (sRGB) → линейный; солнце с затуханием в воздухе, свет неба по высоте солнца, вода с бликом,
  //    дымка до камеры (в вершине), пятно тени под игроком ──
  const TERRAIN_V = `#define NSAMP 3
attribute vec4 aCol;
${ATMO}
uniform vec3 uPlanetC;
varying vec4 vCol; varying vec3 vN; varying vec3 vUp; varying vec3 vW; varying vec3 vInR; varying vec3 vInM; varying vec3 vExt; varying vec3 vSunT;
void main(){
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  vec3 pp = w.xyz - uPlanetC;
  vUp = normalize( pp );
  vN = normalize( mat3( modelMatrix ) * normal );
  vCol = aCol;
  vec3 d = pp - uCamP; float dl = length( d );
  vec3 inR, inM, T; d37Atmo( uCamP, d / max( dl, 1e-6 ), dl, inR, inM, T );
  vInR = inR; vInM = inM; vExt = T;
  vSunT = d37SunT( pp );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
  const TERRAIN_F = `
uniform vec3 uSunL;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform vec4 uAtm3;
uniform vec4 uLit;
uniform vec4 uBlob;
uniform float uTime;
varying vec4 vCol; varying vec3 vN; varying vec3 vUp; varying vec3 vW; varying vec3 vInR; varying vec3 vInM; varying vec3 vExt; varying vec3 vSunT;
${PHASE}
float d37H( vec2 p ){ vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float d37N( vec2 p ){ vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( d37H( i ), d37H( i + vec2( 1.0, 0.0 ) ), f.x ), mix( d37H( i + vec2( 0.0, 1.0 ) ), d37H( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
vec3 d37Amb( float mu ){
  vec3 day = vec3( 0.30, 0.42, 0.62 ), dusk = vec3( 0.32, 0.22, 0.20 ), night = vec3( 0.010, 0.013, 0.026 );
  float k = smoothstep( -0.22, 0.35, mu ), kd = exp( -pow( ( mu - 0.02 ) / 0.12, 2.0 ) );
  return mix( night, day, k ) + dusk * kd * 0.5;
}
void main(){
  vec3 alb = vCol.rgb * vCol.rgb * 0.74;
  // мелкие пятна у камеры (камешки, трава, тень от неровностей): два слоя шума по координатам куска, вдали — гладко
  float cd = length( cameraPosition - vW ), nk = smoothstep( 160.0, 15.0, cd );
  if ( nk > 0.0 ) alb *= 1.0 + nk * ( ( d37N( vW.xz * 0.9 ) - 0.5 ) * 0.22 + ( d37N( vW.xz * 4.3 + 17.0 ) - 0.5 ) * 0.14 );
  // альфа: 0…0,5 — суша (выше над морем — меньше), 0,5…1 — вода (глубже — больше): берег — где альфа = 0,5
  float a = vCol.a, wf = smoothstep( 0.494, 0.51, a ), water = clamp( ( a - 0.5 ) * 2.6, 0.0, 1.0 );
  vec3 N = normalize( vN ), L = uSunL, V = normalize( cameraPosition - vW );
  float mu = dot( vUp, L );
  vec3 sun = uLit.x * vSunT;
  vec3 amb = d37Amb( mu ) * uLit.y;
  vec3 col = vec3( 0.0 ), colW = vec3( 0.0 );
  if ( wf > 0.0 ) {
    float dist = length( cameraPosition - vW ), k = smoothstep( 900.0, 60.0, dist );
    vec2 q = vW.xz;
    vec3 wn = vec3( sin( q.x * 0.21 + uTime * 1.3 ) + sin( q.x * 0.083 - q.y * 0.11 + uTime * 0.9 ), 0.0, sin( q.y * 0.17 + uTime * 1.1 ) + sin( q.y * 0.061 + q.x * 0.07 - uTime * 0.7 ) );
    vec3 Nw = normalize( vUp + ( wn.x * cross( vUp, vec3( 0.0, 0.0, 1.0 ) ) + wn.z * cross( vUp, vec3( 1.0, 0.0, 0.0 ) ) ) * 0.035 * k );
    vec3 deep = mix( vec3( 0.020, 0.13, 0.17 ), vec3( 0.004, 0.025, 0.07 ), water );
    float ndv = max( dot( Nw, V ), 0.0 ), F = 0.02 + 0.98 * pow( 1.0 - ndv, 5.0 );
    vec3 Rf = reflect( -V, Nw );
    float sp = pow( max( dot( Rf, L ), 0.0 ), 260.0 );
    vec3 sky = d37Amb( mu ) * 1.6 * uLit.y;
    colW = deep * ( sun * max( dot( Nw, L ), 0.0 ) * 0.6 + amb ) * ( 1.0 - F ) + sky * F + sun * sp * 4.0;
  }
  if ( wf < 1.0 ) {
    float nl = max( dot( N, L ), 0.0 );
    float shade = 1.0;
    if ( uBlob.w > 0.0 ) { vec3 dv = vW - uBlob.xyz; float dd = length( dv.xz ); shade = mix( 0.55, 1.0, smoothstep( uBlob.w * 0.25, uBlob.w, dd ) + step( 3.0, abs( dv.y ) ) ); }
    col = alb * ( sun * nl * shade + amb * ( 0.6 + 0.4 * max( dot( N, vUp ), 0.0 ) ) * mix( 0.8, 1.0, shade ) );
  }
  col = mix( col, colW, wf );
  vec3 Vd = normalize( vW - cameraPosition );
  float c = dot( Vd, L );
  vec3 ins = uLit.z * ( uBetaR * vInR * d37PhR( c ) + uBetaM * vInM * d37PhM( c, uAtm3.z ) );
  gl_FragColor = vec4( col * vExt + ins, 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  // ── Небо: купол у камеры (кольца гуще у горизонта) и оболочка вокруг планеты (с орбиты); на дальней плоскости, сложением ──
  const SKY_V = `#define NSAMP 6
${ATMO}
uniform float uMode;
varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vec3 d = uMode < 0.5 ? normalize( mat3( modelMatrix ) * position ) : normalize( wp.xyz - cameraPosition );
  vDir = d;
  vec3 inR, inM, T; d37Atmo( uCamP, d, 1e30, inR, inM, T );
  vR = inR; vM = inM; vT = T;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p; gl_Position.z = p.w * 0.99999;
}`;
  const SKY_F = `
uniform vec3 uSunL;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform vec4 uAtm3;
uniform vec4 uSky;
varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vDir;
${PHASE}
void main(){
  vec3 d = normalize( vDir );
  float c = dot( d, uSunL );
  vec3 col = uSky.x * ( uBetaR * vR * d37PhR( c ) + uBetaM * vM * d37PhM( c, uAtm3.z ) );
  float disc = smoothstep( uSky.y - 0.00004, uSky.y, c );
  col += vT * disc * uSky.z;
  gl_FragColor = vec4( col * uSky.w, 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  const STAR_V = `attribute float aMag;
uniform float uPx;
uniform float uK;
varying float vB;
void main(){
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p; gl_Position.z = p.w * 0.999995;
  gl_PointSize = uPx * ( 1.0 + aMag * 1.6 );
  vB = uK * ( 0.25 + aMag * 0.9 );
}`;
  const STAR_F = `varying float vB;
void main(){
  float r = length( gl_PointCoord - 0.5 );
  gl_FragColor = vec4( vec3( vB ) * smoothstep( 0.5, 0.1, r ), 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  const MOON_V = `#define NSAMP 4
${ATMO}
varying vec3 vN; varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vD; varying vec3 vP;
void main(){
  vN = normalize( mat3( modelMatrix ) * normal );
  vP = position;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vec3 d = normalize( w.xyz - cameraPosition ); vD = d;
  vec3 inR, inM, T; d37Atmo( uCamP, d, 1e30, inR, inM, T );
  vR = inR; vM = inM; vT = T;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
  const MOON_F = `
uniform vec3 uSunL;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform vec4 uAtm3;
uniform vec4 uSky;
uniform vec3 uTint;
varying vec3 vN; varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vD; varying vec3 vP;
${PHASE}
void main(){
  vec3 p = normalize( vP );
  float cr = sin( p.x * 13.0 + 2.0 * sin( p.y * 9.0 ) ) * sin( p.y * 11.0 + 1.7 ) * sin( p.z * 12.0 + 3.0 * sin( p.x * 7.0 ) );
  vec3 alb = uTint * uTint * ( 0.75 + 0.25 * smoothstep( -0.4, 0.6, cr ) );
  float nl = max( dot( normalize( vN ), uSunL ), 0.0 );
  float c = dot( normalize( vD ), uSunL );
  vec3 col = alb * nl * 2.2 * vT + uSky.x * ( uBetaR * vR * d37PhR( c ) + uBetaM * vM * d37PhM( c, uAtm3.z ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

  // ═══ Вид ═══
  E.planetView = function (R, P, o = {}){
    wrapSun();
    const T = R.T, PL = E.planet, D = P.def, q = R.q || 'mid', mob = !!E.isMobile?.(), low = q === 'low';
    const N = 32, K = o.K ?? (mob || low ? 1.0 : 1.4), maxL = o.maxL ?? 12, BUDGET = o.budget ?? (mob || low ? 2 : 4);
    const CAP = o.cap ?? (mob || low ? 260 : 480);
    const V = { P, R, fr: P.patch(o.dir || P.dirFromLatLon(43.2, 76.9)), camBF: new Float64Array(3), camL: new Float64Array(3), t: 0, alt: 0, altG: 0, dead: false,
      onRebase: f => { lis.push(f); return () => { const i = lis.indexOf(f); if (i >= 0) lis.splice(i, 1); }; } };
    const lis = o.onRebase ? [o.onRebase] : [];
    const grp = new T.Group(); grp.name = 'planet'; grp.matrixAutoUpdate = false;
    R.scene.add(grp);
    const own = [];

    // ── Атмосфера: числа для шейдеров ──
    const A = D.atmo, Rg = P.SEAR;
    const U = {
      uCamP: { value: new T.Vector3() }, uSunL: { value: new T.Vector3(0, 1, 0) }, uPlanetC: { value: new T.Vector3() },
      uAtm: { value: new T.Vector4(Rg, A ? Rg + A.top : Rg + 1, A ? 1 / A.Hr : 1, A ? 1 / A.Hm : 1) },
      // функция Чепмена (Шулер, GPU Pro 3: Ch ≈ c / ((c − 1) μ + 1), c = √(πX/2)): X = R / H, высота — в долях H
      uAtm2: { value: new T.Vector4(A ? Rg / A.Hr : 1, A ? Rg / A.Hm : 1, A ? 1 / A.Hr : 1, A ? 1 / A.Hm : 1) },
      uAtm3: { value: new T.Vector4(A ? A.Hr : 1, A ? A.Hm : 1, A ? A.g : .76, 0) },
      uBetaR: { value: new T.Vector3(...(A ? A.tauR.map(x => x / A.Hr) : [0, 0, 0])) }, uBetaM: { value: A ? A.tauM / A.Hm : 0 },
      // x — сила солнца у поверхности, y — свет неба, z — дымка до камеры (чуть слабее неба: дали темнее неба за ними)
      uLit: { value: new T.Vector4(2.3, 1, 30 * (A ? A.sun : 0), 0) }, uBlob: { value: new T.Vector4(0, 0, 0, 0) }, uTime: { value: 0 },
      uSky: { value: new T.Vector4(40 * (A ? A.sun : 0), Math.cos(.0047 * (D.sky?.sunSize || 1)), 60, 1) },
    };
    const terrainMat = new T.ShaderMaterial({ name: 'planet', uniforms: U, vertexShader: TERRAIN_V, fragmentShader: TERRAIN_F, fog: false, lights: false });
    terrainMat.customProgramCacheKey = () => 'd37planet1';
    own.push(terrainMat);
    // небо: купол (у камеры) и оболочка (вокруг планеты)
    const mkSky = mode => {
      const u = { ...U, uMode: { value: mode }, uSky: { value: new T.Vector4().copy(U.uSky.value) } };
      const m = new T.ShaderMaterial({ name: 'planet-sky', uniforms: u, vertexShader: SKY_V, fragmentShader: SKY_F, fog: false, lights: false, depthWrite: false,
        transparent: true, blending: T.AdditiveBlending, side: T.BackSide });
      m.customProgramCacheKey = () => 'd37planetsky1';
      own.push(m); return m;
    };
    const dome = new T.Mesh(domeGeo(T), mkSky(0)); dome.frustumCulled = false; dome.renderOrder = 901; own.push(dome.geometry);
    dome.material.side = T.DoubleSide;   // купол вокруг камеры: каждый луч пересекает его один раз
    const shell = new T.Mesh(new T.SphereGeometry(1, mob || low ? 96 : 160, mob || low ? 48 : 80), mkSky(1)); shell.frustumCulled = false; shell.renderOrder = 902; own.push(shell.geometry);
    shell.matrixAutoUpdate = false;
    if (A) { R.scene.add(dome); R.scene.add(shell); }
    // звёзды
    const stars = makeStars(T, D.seed, mob ? 1400 : 2400); stars.renderOrder = 900; own.push(stars.geometry, stars.material); stars.matrixAutoUpdate = false;
    R.scene.add(stars);
    // луны
    const moons = D.moons.map(m => {
      const u = { ...U, uTint: { value: new T.Color(m.tint) } };
      const mat = new T.ShaderMaterial({ name: 'planet-moon', uniforms: u, vertexShader: MOON_V, fragmentShader: MOON_F, fog: false, lights: false });
      mat.customProgramCacheKey = () => 'd37planetmoon1';
      const mesh = new T.Mesh(new T.SphereGeometry(1, 40, 20), mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      own.push(mat, mesh.geometry); R.scene.add(mesh);
      return { m, mesh };
    });

    // ── Небо движка: купол прячем (небо — атмосфера), фон — чёрный (космос), тени выключены (у поверхности своё освещение) ──
    const engineSky = R.scene.children.find(x => x.userData && x.userData.sky);
    const skyWas = engineSky ? engineSky.visible : true;
    if (engineSky) engineSky.visible = false;
    const black = new T.Color(0, 0, 0);
    const SUN = [0, 1, 0];
    SUNP.f = (t, out) => { out[0] = SUN[0]; out[1] = SUN[1]; out[2] = SUN[2]; return out; };

    // ── Общие индексы сшивки (16 масок) ──
    const IDX = [];
    for (let m = 0; m < 16; m++) { const a = new T.BufferAttribute(PL.indices(N, m), 1); IDX.push(a); }

    // ── Куски: кэш, очередь, потоки ──
    const chunks = new Map();   // ключ → { key, n, data, mesh, used, state: 0 нет / 1 в очереди / 2 строится / 3 готов }
    P.onNode = n => { const c = chunks.get(n.key); if (c && c.data) P.nodeRange(n, c.data.hmin, c.data.hmax); };
    const ST = V.st = { built: 0, buildMs: 0, buildMax: 0, integ: 0, integMs: 0, integMax: 0, selMs: 0, selMax: 0, sel: 0, mainBuilds: 0, rebases: 0, evicted: 0, errors: 0, workerOk: false };
    const queue = [];   // ожидают сборки (узлы)
    const workers = [];
    let reqId = 0;
    const inflight = new Map();   // id → chunk
    const wanted = o.workers ?? ((navigator.hardwareConcurrency || 4) <= 4 || mob ? 1 : 2);
    try {
      if (typeof Worker === 'function' && o.workers !== 0) {
        const url = o.url || 'js/engine/planet-worker.js?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
        for (let k = 0; k < wanted; k++) {
          const w = new Worker(url), W = { w, busy: 0, ok: false, ids: new Set() };
          w.onmessage = e => onResult(W, e.data);
          // поток упал — его куски снова в очередь (построит другой поток или страница)
          w.onerror = () => { W.dead = true; ST.errors++; for (const i of W.ids) { const c = inflight.get(i); inflight.delete(i); if (c && c.state === 2) c.state = 0; } W.ids.clear(); dirty = true; };
          w.postMessage({ t: 'init', def: D });
          workers.push(W);
        }
      }
    } catch (e) { console.warn('планета: потоков нет — строим на странице', e); }
    function onResult(W, d){
      if (d.t === 'ready') { W.ok = true; ST.workerOk = true; return; }
      W.busy--; W.ids.delete(d.id);
      const c = inflight.get(d.id); inflight.delete(d.id);
      if (!c) return;
      if (d.err) { ST.errors++; c.state = 0; console.warn('планета: кусок не собрался', d.err); return; }
      ST.built++; ST.buildMs += d.ms || 0; ST.buildMax = max(ST.buildMax, d.ms || 0);
      c.data = d; c.state = 4;   // 4 — данные пришли, сетку соберём в бюджет кадра
      ready.push(c);
    }
    const ready = [];
    function chunkOf(n){ let c = chunks.get(n.key); if (!c) { c = { key: n.key, n, data: null, mesh: null, used: 0, state: 0, mask: -1 }; chunks.set(n.key, c); } c.n = n; return c; }
    // сетка из данных (на странице): атрибуты, общие индексы, матрица — от якоря
    function integrate(c){
      const t0 = now(), d = c.data;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(d.nrm, 3, true));
      g.setAttribute('aCol', new T.BufferAttribute(d.col, 4, true));
      g.setIndex(IDX[0]);
      g.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), d.radius);
      const m = new T.Mesh(g, terrainMat);
      m.matrixAutoUpdate = false; m.userData.planet = true;
      c.mesh = m; c.mask = 0; c.state = 3;
      placeMesh(c);
      if (c.n) P.nodeRange(c.n, d.hmin, d.hmax);
      const ms = now() - t0; ST.integ++; ST.integMs += ms; ST.integMax = max(ST.integMax, ms);
      dirty = true;
    }
    let dirty = false;
    // матрица куска: [Bᵀ | Bᵀ (C − A)] — в double; three умножит на камеру тоже в double
    function placeMesh(c){
      const fr = V.fr, B = fr.B, Cc = c.data.centre, Aa = fr.A, dx = Cc[0] - Aa[0], dy = Cc[1] - Aa[1], dz = Cc[2] - Aa[2];
      c.mesh.matrix.set(
        B[0], B[1], B[2], B[0] * dx + B[1] * dy + B[2] * dz,
        B[3], B[4], B[5], B[3] * dx + B[4] * dy + B[5] * dz,
        B[6], B[7], B[8], B[6] * dx + B[7] * dy + B[8] * dz,
        0, 0, 0, 1);
      c.mesh.matrixWorldNeedsUpdate = true;
    }
    // индексы общие: перед dispose отвязать (иначе three удалит буфер, которым рисуют другие куски)
    const dropGeo = g => { g.setIndex(null); g.dispose(); };
    function freeChunk(c){
      if (c.mesh) { grp.remove(c.mesh); dropGeo(c.mesh.geometry); c.mesh = null; }
      c.data = null; c.state = 0; chunks.delete(c.key); ST.evicted++;
    }
    // сразу: 6 корневых кусков (на странице) — всегда есть чем закрыть
    for (let f = 0; f < 6; f++) { const n = P.node(f, 0, 0, 0), c = chunkOf(n); c.data = P.buildChunk(f, 0, 0, 0, N); c.root = true; ST.mainBuilds++; integrate(c); }

    function pump(t0){
      // в потоки — по важности (крупнее и ближе — раньше), не больше 2 в работе у каждого
      let live = 0;
      for (const W of workers) if (W.ok && !W.dead) live++;
      if (live) {
        for (const W of workers) while (W.ok && !W.dead && W.busy < 2 && queue.length) {
          const n = queue.shift(), c = chunkOf(n);
          if (c.state !== 1) continue;
          c.state = 2; const id = ++reqId; inflight.set(id, c); W.busy++; W.ids.add(id);
          W.w.postMessage({ t: 'build', id, f: n.f, L: n.L, i: n.i, j: n.j, N });
        }
      } else if (queue.length && (!workers.length || workers.every(W => W.dead) || now() - started > 4000)) {
        // запасной путь: потоков нет — на странице, по одному за кадр и не дольше 3 мс
        while (queue.length && now() - t0 < 3) {
          const n = queue.shift(), c = chunkOf(n);
          if (c.state !== 1) continue;
          const tb = now();
          c.data = P.buildChunk(n.f, n.L, n.i, n.j, N); c.state = 4; ST.mainBuilds++; ST.built++;
          const ms = now() - tb; ST.buildMs += ms; ST.buildMax = max(ST.buildMax, ms);
          ready.push(c);
          break;
        }
      }
      // готовые данные → сетки, по бюджету
      let k = 0;
      while (ready.length && k < BUDGET) { const c = ready.shift(); if (c.state === 4 && chunks.get(c.key) === c) { integrate(c); k++; } }
    }
    const started = now();

    // ── Выбор и показ: листья → что рисуем (не готов — ближайший готовый предок), маска сшивки — по тому, что нарисовано ──
    const leaves = [], shown = new Set(), showList = [];
    let showMark = 1, lastSel = -1e9, selX = Infinity, selY = Infinity, selZ = Infinity;
    const isShown = n => n.vis === showMark;
    function select(force){
      const t0 = now();
      const cx = V.camBF[0], cy = V.camBF[1], cz = V.camBF[2];
      P.select(cx, cy, cz, { K, maxL }, leaves);
      P.balance(leaves);
      selX = cx; selY = cy; selZ = cz; lastSel = t0;
      // что нужно построить
      queue.length = 0;
      showMark++;
      const vis = showList; vis.length = 0;
      for (const n of leaves) {
        const c = chunkOf(n); c.used = showMark;
        const dx = cx - n.cp[0], dy = cy - n.cp[1], dz = cz - n.cp[2];
        if (c.state === 3) { if (n.vis !== showMark) { n.vis = showMark; vis.push(n); } continue; }
        if (c.state === 0) { c.state = 1; }
        if (c.state === 1) { n.imp = n.size / max(1, sqrt(dx * dx + dy * dy + dz * dz)); queue.push(n); }
        // закрыть ближайшим готовым предком
        let a = n.par;
        while (a && chunks.get(a.key)?.state !== 3) a = a.par;
        if (a) { chunks.get(a.key).used = showMark; if (a.vis !== showMark) { a.vis = showMark; vis.push(a); } }
      }
      // показанный предок закрывает своих показанных потомков (без наложений)
      let w = 0;
      for (const n of vis) { let a = n.par, hid = false; while (a) { if (a.vis === showMark) { hid = true; break; } a = a.par; } if (!hid) vis[w++] = n; else n.vis = 0; }
      vis.length = w;
      // маски сшивки по показанному
      for (const n of vis) {
        let m = 0;
        for (let e = 0; e < 4; e++) {
          const nb = P.neighbor(n, e);
          let a = nb.par;
          if (!isShown(nb) && a && isShown(a)) m |= 1 << e;
        }
        const c = chunks.get(n.key);
        if (c.mask !== m) { c.mask = m; c.mesh.geometry.setIndex(IDX[m]); }
      }
      // в сцену / из сцены
      const now2 = new Set();
      for (const n of vis) now2.add(n.key);
      for (const k2 of shown) if (!now2.has(k2)) { const c = chunks.get(k2); if (c?.mesh) grp.remove(c.mesh); }
      for (const n of vis) if (!shown.has(n.key)) { const c = chunks.get(n.key); if (c?.mesh) grp.add(c.mesh); }
      shown.clear(); for (const k2 of now2) shown.add(k2);
      // кэш: старые — прочь (не показанные, не корни)
      if (chunks.size > CAP) {
        const old = [];
        for (const c of chunks.values()) if (!c.root && c.state === 3 && !shown.has(c.key)) old.push(c);
        old.sort((a, b) => a.used - b.used);
        for (let k2 = 0; k2 < old.length && chunks.size > CAP * .9; k2++) freeChunk(old[k2]);
      }
      // в очереди — только то, что ещё нужно (остальным вернуть «нет»); важнее — крупнее и ближе
      for (const c of chunks.values()) if (c.state === 1 && c.used !== showMark) c.state = 0;
      if (queue.length > 1) queue.sort((a, b) => b.imp - a.imp);
      dirty = false;
      const ms = now() - t0; ST.sel++; ST.selMs += ms; ST.selMax = max(ST.selMax, ms);
    }

    // ── Якорь (плавающее начало) ──
    const TM = [0, 0, 0];
    V.setAnchor = dir => {
      const old = V.fr, fr = P.patch(dir), map = P.rebaseMap(old, fr);
      V.fr = fr;
      for (const c of chunks.values()) if (c.mesh) placeMesh(c);
      ST.rebases++;
      const ev = { Q: map.Q, t: map.t, from: old, to: fr, point: (x, y, z, out = [0, 0, 0]) => P.mapPoint(map, x, y, z, out), dir: (x, y, z, out = [0, 0, 0]) => P.mapDir(map, x, y, z, out) };
      for (const f of lis.slice()) { try { f(ev); } catch (e) { console.error(e); } }
      R.cut?.(2); R.shadowDirty?.();
      return ev;
    };
    V.toBF = (x, y, z, out = [0, 0, 0]) => P.toBF(V.fr, x, y, z, out);
    V.toL = (X, Y, Z, out = [0, 0, 0]) => P.toL(V.fr, X, Y, Z, out);
    // земля и вода для physics.js (координаты куска; после переезда — сами по новому якорю)
    V.physics = ph => {
      ph.terrain = { sample: (x, z) => P.patchGround(V.fr, x, z) };
      ph.waterLevel = (x, z) => P.patchWater(V.fr, x, z);
      return ph;
    };
    V.ground = (x, z) => P.patchHeight(V.fr, x, z, true);

    // ── Небо, свет, дальность — каждый кадр (перед рисованием) ──
    const SB = [0, 0, 0], ML = [0, 0, 0], MB = [0, 0, 0];
    let lightAt = -1e9, lastHour = -1, nearFar = [0, 0];
    const m4 = new T.Matrix4(), m4b = new T.Matrix4();
    function sky(){
      const cam = R.camera, fr = V.fr, B = fr.B;
      // камера в системе планеты
      P.toBF(fr, cam.position.x, cam.position.y, cam.position.z, V.camBF);
      const cx = V.camBF[0], cy = V.camBF[1], cz = V.camBF[2], Dc = sqrt(cx * cx + cy * cy + cz * cz);
      V.alt = Dc - P.SEAR;
      // центр планеты в L и камера относительно центра (оси L) — в double
      P.toL(fr, 0, 0, 0, TM); U.uPlanetC.value.set(TM[0], TM[1], TM[2]);
      U.uCamP.value.set(cam.position.x - TM[0], cam.position.y - TM[1], cam.position.z - TM[2]);
      // солнце
      P.sunDir(V.t, V.ms, SB); P.dirToL(fr, SB[0], SB[1], SB[2], SUN);
      U.uSunL.value.set(SUN[0], SUN[1], SUN[2]);
      // дальность: до горизонта + самая высокая гора за ним; ближняя — по высоте над землёй
      const rocc = P.R + P.renderMin, rmax = P.R + P.maxH;
      const hz = sqrt(max(0, Dc * Dc - rocc * rocc)) + sqrt(max(0, rmax * rmax - rocc * rocc));
      const g = V.ground(cam.position.x, cam.position.z);
      V.altG = cam.position.y - g;
      let near = clamp(V.altG * .08, .1, 1e6), far = max(hz * 1.08, near * 50, 2000);
      if (Dc > rmax) near = max(near, (Dc - rmax) * .5);
      if (abs(near - nearFar[0]) > nearFar[0] * .02 || abs(far - nearFar[1]) > nearFar[1] * .02) {
        nearFar[0] = near; nearFar[1] = far; cam.near = near; cam.far = far; cam.updateProjectionMatrix();
      }
      R.scene.background = R.scene.background && R.scene.background.isColor ? R.scene.background.copy(black) : black.clone();
      // купол у камеры: оси L; оболочка: центр планеты, радиус верха атмосферы; переход по высоте
      if (A) {
        dome.position.copy(cam.position); dome.scale.setScalar(10); dome.updateMatrix();
        const top = A.top, kf = clamp((V.alt - top * .9) / (top * 1.6), 0, 1);
        dome.material.uniforms.uSky.value.w = 1 - kf; shell.material.uniforms.uSky.value.w = kf;
        dome.visible = kf < .999; shell.visible = kf > .001;
        const rs = P.SEAR + top;
        shell.matrix.makeScale(rs, rs, rs).setPosition(TM[0], TM[1], TM[2]); shell.matrixWorldNeedsUpdate = true;
        // звёзды видно, когда небо тёмное у камеры: космос или ночь
        const up = [cx / Dc, cy / Dc, cz / Dc], mu = up[0] * SB[0] + up[1] * SB[1] + up[2] * SB[2];
        const tauUp = A.tauR[2] * Math.exp(-max(0, V.alt) / A.Hr);   // сколько воздуха над камерой (синий)
        stars.material.uniforms.uK.value = clamp(1 - tauUp * 40 * clamp((mu + .15) / .3, 0, 1), 0, 1);
      } else stars.material.uniforms.uK.value = 1;
      // звёзды вертятся с небом: неподвижные → система планеты (поворот на −θ) → L
      const th = P.spin(V.t), c = Math.cos(th), s = Math.sin(th);
      // Rbf = поворот вокруг Y на −θ: x' = c x − s z, z' = s x + c z
      m4b.set(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1);
      m4.set(B[0], B[1], B[2], 0, B[3], B[4], B[5], 0, B[6], B[7], B[8], 0, 0, 0, 0, 1).multiply(m4b);
      stars.matrix.copy(m4); stars.matrix.scale(TMP_V.set(10, 10, 10)); stars.matrix.setPosition(cam.position.x, cam.position.y, cam.position.z); stars.matrixWorldNeedsUpdate = true;
      // луны: место по времени, на дальности не дальше 0,9 far (тот же угловой размер)
      for (let k = 0; k < moons.length; k++) {
        const Mn = moons[k];
        P.moonPos(k, V.t, MB);
        P.toL(fr, MB[0], MB[1], MB[2], ML);
        const dx = ML[0] - cam.position.x, dy = ML[1] - cam.position.y, dz = ML[2] - cam.position.z, dl = sqrt(dx * dx + dy * dy + dz * dz);
        const dd = min(dl, far * .9), k2 = dd / dl, rr = Mn.m.radius * k2;
        Mn.mesh.matrix.makeScale(rr, rr, rr).setPosition(cam.position.x + dx * k2, cam.position.y + dy * k2, cam.position.z + dz * k2);
        Mn.mesh.matrixWorldNeedsUpdate = true;
      }
      U.uTime.value = V.t % 1000;
      // свет движка (человечки, предметы): небо по настоящему солнцу — не чаще 4 раз в секунду или когда солнце сдвинулось
      const tn = now(), hour = P.localHour([cx / Dc, cy / Dc, cz / Dc], V.t);
      if (tn - lightAt > 250 || abs(hour - lastHour) > .25) {
        lightAt = tn; lastHour = hour;
        try { R.setLighting({ time: hour }); } catch (e) {}
        cam.near = nearFar[0]; cam.far = nearFar[1]; cam.updateProjectionMatrix();   // setLighting сам ставит дальность (до 3000) — вернуть свою
      }
    }
    const TMP_V = new T.Vector3();
    // AO, отражения в экране и генерация кадров читают глубину кадра — на дальностях планеты (десятки км при ближней 0,1) они
    // неточны, и страж графики решил бы, что они сломаны, и выключил бы их НАВСЕГДА для этого устройства (во всех играх).
    // Пока открыта планета — без них (настройки игрока не трогаем; разделение глубины на два прохода — шаг PL-4 плана)
    let tamed = null;
    const tame = () => {
      const b = R.optBase;
      if (!b || b === tamed) return;
      if (b.ao || (b.rt && b.rt !== 'off') || b.framegen) { R.applyGfx({ ...b, ao: false, rt: 'off', framegen: false }); }
      tamed = R.optBase;
    };
    tame();
    const pre = () => { if (!V.dead) { tame(); sky(); } };
    R.preRender.push(pre);
    R.setLighting({ fogEnd: 3000, shadows: false });

    // ── Каждый кадр: выбор (≤ 8 раз в секунду и если камера сдвинулась), очередь, сборка в бюджет ──
    V.ms = Date.now();
    V.update = (dt, t, ms = Date.now()) => {
      if (V.dead) return;
      const t0 = now();
      V.t = t; V.ms = ms;
      const cam = R.camera;
      P.toBF(V.fr, cam.position.x, cam.position.y, cam.position.z, V.camBF);
      const moved = Math.hypot(V.camBF[0] - selX, V.camBF[1] - selY, V.camBF[2] - selZ);
      const step = max(2, (V.altG > 0 ? V.altG : 10) * .05);
      if (t0 - lastSel > 125 && (moved > step || dirty || queue.length || ready.length) || moved > step * 20) select();
      pump(t0);
      V.cpu = now() - t0;
    };
    V.shown = () => shown.size;
    V.stats = () => ({
      shown: shown.size, leaves: leaves.length, cached: chunks.size, queued: queue.length, building: inflight.size, ready: ready.length,
      built: ST.built, buildAvg: ST.built ? ST.buildMs / ST.built : 0, buildMax: ST.buildMax, integ: ST.integ, integAvg: ST.integ ? ST.integMs / ST.integ : 0,
      integMax: ST.integMax, selAvg: ST.sel ? ST.selMs / ST.sel : 0, selMax: ST.selMax, mainBuilds: ST.mainBuilds, rebases: ST.rebases, evicted: ST.evicted,
      errors: ST.errors, workers: workers.filter(W => W.ok && !W.dead).length, nodes: P.nodes.size, alt: V.alt, altG: V.altG, near: nearFar[0], far: nearFar[1],
      gpuKB: Math.round([...chunks.values()].reduce((s, c) => s + (c.mesh ? c.data.pos.byteLength + c.data.nrm.byteLength + c.data.col.byteLength : 0), 0) / 1024),
    });
    V.dispose = () => {
      if (V.dead) return;
      V.dead = true;
      for (const W of workers) try { W.w.terminate(); } catch (e) {}
      for (const c of chunks.values()) if (c.mesh) { grp.remove(c.mesh); dropGeo(c.mesh.geometry); }
      chunks.clear();
      R.scene.remove(grp); R.scene.remove(dome); R.scene.remove(shell); R.scene.remove(stars);
      for (const Mn of moons) R.scene.remove(Mn.mesh);
      for (const x of own) x.dispose?.();
      const i = R.preRender.indexOf(pre); if (i >= 0) R.preRender.splice(i, 1);
      if (engineSky) engineSky.visible = skyWas;
      SUNP.f = null; P.onNode = null;
    };
    // пятно тени под игроком (своего освещения у поверхности; тени движка выключены): x, y, z ступней, r — 0 — нет
    V.blob = (x, y, z, r) => U.uBlob.value.set(x, y, z, r);
    return V;
  };

  // купол неба: кольца гуще у горизонта (там небо меняется сильнее всего)
  function domeGeo(T){
    const EL = [-90, -40, -20, -10, -5, -2.5, -1, 0, 1, 2, 3.5, 5.5, 8, 11, 15, 20, 26, 33, 41, 50, 60, 70, 80, 90], AZ = 64;
    const pos = [], idx = [];
    for (let r = 0; r < EL.length; r++) for (let a = 0; a <= AZ; a++) {
      const el = EL[r] * Math.PI / 180, az = a / AZ * Math.PI * 2;
      pos.push(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    }
    for (let r = 0; r < EL.length - 1; r++) for (let a = 0; a < AZ; a++) {
      const i0 = r * (AZ + 1) + a, i1 = i0 + 1, j0 = i0 + AZ + 1, j1 = j0 + 1;
      idx.push(i0, j0, i1, i1, j0, j1);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  }
  // звёзды: по зерну, на единичной сфере; яркость — от 0 до 1
  function makeStars(T, seed, n){
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const pos = new Float32Array(n * 3), mag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos[i * 3] = r * Math.cos(a); pos[i * 3 + 1] = z; pos[i * 3 + 2] = r * Math.sin(a);
      mag[i] = Math.pow(rnd(), 6);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aMag', new T.BufferAttribute(mag, 1));
    const m = new T.ShaderMaterial({ name: 'planet-stars', uniforms: { uPx: { value: Math.min(2, window.devicePixelRatio || 1) * 1.4 }, uK: { value: 1 } }, vertexShader: STAR_V, fragmentShader: STAR_F,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    m.customProgramCacheKey = () => 'd37planetstars1';
    const p = new T.Points(g, m); p.frustumCulled = false;
    return p;
  }
})();
