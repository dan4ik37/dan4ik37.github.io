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
// LOD v2 (T-075, PL-2): куски — по экранной ошибке (o.tau пикселей), «перетекают» (CDLOD: кусок появляется в форме родителя и за
// ~0,12 с переходит в свою — без скачков), смена уровня — по шагу (planet.js P.lodShow / lodMorph); потоков — по ядрам (упали —
// новые), в видеокарту — не больше бюджета за кадр; дети следующего шага и «куда летим» строятся заранее.
// Движок (T-075, PL-4): солнце — через E.setSunProvider (gfx.js); глубина — два диапазона (R.depthSplit: ближний — человечки, AO,
// отражения; дальний — земля и небо; post.js рисует оба); тени движка ложатся на землю у игрока (V.setShadows); дымка до вещей
// движка — та же атмосфера (туман gfx.js: E.GFXU.apA…apD); погода — V.climateAt / V.weatherPos (по широте, js/engine/climate.js).
// T-075 НА ПАУЗЕ (22.10): всё это ВЫКЛ по умолчанию (FLAGS ниже; без флагов — вид как до T-075). Включить — localStorage
// d37_planet_v2 = '1' (всё сразу) или o.flags; что сделано и как продолжить — docs/plans/planet.md «T-075 — paused».
(() => {
  const E = window.D37E = window.D37E || {};
  const sqrt = Math.sqrt, max = Math.max, min = Math.min, abs = Math.abs;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const now = () => performance.now();

  // Солнце движка: формальный поставщик (gfx.js E.setSunProvider); старый gfx.js без него — обёртка E.sunAt (один раз на страницу)
  const SUNP = E.__sunProv || (E.__sunProv = { f: null });
  function wrapSun(){
    if (E.__sunWrapped || typeof E.sunAt !== 'function') return;
    const base = E.sunAt;
    E.sunAt = (t, out = [0, 1, 0]) => SUNP.f ? SUNP.f(t, out) : base(t, out);
    E.__sunWrapped = true;
  }
  const sunProvide = f => {
    if (typeof E.setSunProvider === 'function') return E.setSunProvider(f);
    wrapSun(); SUNP.f = f; return () => { if (SUNP.f === f) SUNP.f = null; };
  };
  // что включено. T-075 на паузе: всё новое ВЫКЛ, пока нет замеров на профиле телефона. Без флагов — как до T-075: прежний выбор
  // кусков и потоков, сборка без формы родителя, шейдер без перетекания и теней, небо и глубина — одним проходом, туман движка
  // обычный, без погоды. Включить: localStorage d37_planet_v2 = '1' (всё сразу; читается при открытии вида, дымке нужна и
  // перезагрузка — gfx.js E.aerialFog) или o.flags в D37E.planetView(R, P, { flags }); навсегда — true здесь
  const FLAGS = { lod2: false, morph: false, prefetch: false, split: false, shadows: false, aerial: false, weather: false };
  const FLAGS_ON = { lod2: true, morph: true, prefetch: true, split: true, shadows: true, aerial: true, weather: true };
  const FLAGS_OFF = { lod2: false, morph: false, prefetch: false, split: false, shadows: false, aerial: false, weather: false };
  const v2ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage.getItem('d37_planet_v2') : null; } catch (e) { return null; } };
  // замеры по частям и отладка: localStorage d37_planet_flags = '{"weather":false}' — отдельные флаги поверх (только известные)
  const v2flags = () => {
    const o2 = {};
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem('d37_planet_flags'), j = s ? JSON.parse(s) : null; if (j && typeof j === 'object') for (const k in FLAGS_ON) if (k in j) o2[k] = !!j[k]; } catch (e) {}
    return o2;
  };

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
  //    дымка до камеры (в вершине), пятно тени под игроком, тени движка у игрока (карта теней солнца движка) ──
  // Перетекание (CDLOD): k — 0 своя форма, 1 — форма родителя (сдвиг aMd × масштаб, нормаль и цвет родителя); k вершины — k куска,
  // у края — k края (общий с соседом: швов нет), между — плавно на ширине uMk.w клеток. D37_MORPH — перетекание, D37_PSH — тени
  // движка (флаги morph, shadows; без обоих — шейдер как до T-075). 8 varying — минимум WebGL1 (с тенями «верх» — во фрагменте)
  const TERRAIN_V = `#define NSAMP 3
attribute vec4 aCol;
#ifdef D37_MORPH
attribute vec4 aMd;
attribute vec4 aNp;
attribute vec4 aCp;
uniform vec4 uMk;
uniform vec4 uMe;
#endif
${ATMO}
uniform vec3 uPlanetC;
#ifdef D37_PSH
uniform mat4 uShM;
uniform vec4 uShP;
varying vec4 vSh;
#else
varying vec3 vUp;
#endif
varying vec4 vCol; varying vec3 vN; varying vec3 vW; varying vec3 vInR; varying vec3 vInM; varying vec3 vExt; varying vec3 vSunT;
#ifdef D37_MORPH
float d37Mk(){
  float a = floor( aMd.w * 32767.0 + 0.5 ), b = floor( aNp.w * 127.0 + 0.5 ), N = uMk.z, W = uMk.w, k = uMk.x;
  k = mix( uMe.x, k, clamp( a / W, 0.0, 1.0 ) );
  k = mix( uMe.y, k, clamp( ( N - a ) / W, 0.0, 1.0 ) );
  k = mix( uMe.z, k, clamp( b / W, 0.0, 1.0 ) );
  k = mix( uMe.w, k, clamp( ( N - b ) / W, 0.0, 1.0 ) );
  if ( b < 0.5 ) k = uMe.z; else if ( b > N - 0.5 ) k = uMe.w;
  if ( a < 0.5 ) k = uMe.x; else if ( a > N - 0.5 ) k = uMe.y;
  return k;
}
#endif
void main(){
#ifdef D37_MORPH
  float k = d37Mk();
  vec3 p = position + aMd.xyz * ( uMk.y * k );
#else
  vec3 p = position;
#endif
  vec4 w = modelMatrix * vec4( p, 1.0 );
  vW = w.xyz;
  vec3 pp = w.xyz - uPlanetC;
#ifdef D37_MORPH
  vN = normalize( mat3( modelMatrix ) * normalize( mix( normal, aNp.xyz, k ) ) );
  vCol = mix( aCol, aCp, k );
#else
  vN = normalize( mat3( modelMatrix ) * normal );
  vCol = aCol;
#endif
#ifndef D37_PSH
  vUp = normalize( pp );
#endif
  vec3 d = pp - uCamP; float dl = length( d );
  vec3 inR, inM, T; d37Atmo( uCamP, d / max( dl, 1e-6 ), dl, inR, inM, T );
  vInR = inR; vInM = inM; vExt = T;
  vSunT = d37SunT( pp );
#ifdef D37_PSH
  vSh = uShM * vec4( w.xyz + vN * uShP.w, 1.0 );
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;
  // тени движка: карта теней солнца (упакованная глубина, как у three) — 4 выборки, у края коробки теней — плавно на нет;
  // сэмплер — highp (телефоны: иначе глубина читается половинной точностью — «Грабли»)
  const TERRAIN_F = `#ifdef D37_PSH
#if __VERSION__ >= 300 || defined( GL_FRAGMENT_PRECISION_HIGH )
precision highp sampler2D;
#endif
#include <packing>
#endif
uniform vec3 uSunL;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform vec4 uAtm3;
uniform vec4 uLit;
uniform vec4 uBlob;
#ifdef D37_PWX
uniform vec4 uWx;
#endif
uniform float uTime;
#ifdef D37_PSH
uniform vec3 uPlanetC;
uniform sampler2D uShMap;
uniform vec4 uShP;
varying vec4 vSh;
#else
varying vec3 vUp;
#endif
varying vec4 vCol; varying vec3 vN; varying vec3 vW; varying vec3 vInR; varying vec3 vInM; varying vec3 vExt; varying vec3 vSunT;
${PHASE}
#ifdef D37_PSH
float d37Shadow(){
  if ( uShP.x <= 0.0 ) return 1.0;
  vec3 c = vSh.xyz / vSh.w;
  float fade = smoothstep( 0.0, 0.06, min( min( c.x, 1.0 - c.x ), min( c.y, 1.0 - c.y ) ) ) * step( c.z, 1.0 );
  float z = c.z + uShP.y, t = uShP.z, s = 0.0;
  s += step( z, unpackRGBAToDepth( texture2D( uShMap, c.xy + vec2( -0.5, -0.5 ) * t ) ) );
  s += step( z, unpackRGBAToDepth( texture2D( uShMap, c.xy + vec2( 0.5, -0.5 ) * t ) ) );
  s += step( z, unpackRGBAToDepth( texture2D( uShMap, c.xy + vec2( -0.5, 0.5 ) * t ) ) );
  s += step( z, unpackRGBAToDepth( texture2D( uShMap, c.xy + vec2( 0.5, 0.5 ) * t ) ) );
  return mix( 1.0, s * 0.25, fade * uShP.x );
}
#endif
float d37H( vec2 p ){ vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float d37N( vec2 p ){ vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( d37H( i ), d37H( i + vec2( 1.0, 0.0 ) ), f.x ), mix( d37H( i + vec2( 0.0, 1.0 ) ), d37H( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
vec3 d37Amb( float mu ){
  vec3 day = vec3( 0.30, 0.42, 0.62 ), dusk = vec3( 0.32, 0.22, 0.20 ), night = vec3( 0.010, 0.013, 0.026 );
  float k = smoothstep( -0.22, 0.35, mu ), kd = exp( -pow( ( mu - 0.02 ) / 0.12, 2.0 ) );
  return mix( night, day, k ) + dusk * kd * 0.5;
}
void main(){
#ifdef D37_PSH
  vec3 vUp = normalize( vW - uPlanetC );   // «вверх» от центра планеты (не varying: их 8 — минимум WebGL1)
#endif
  vec3 alb = vCol.rgb * vCol.rgb * 0.74;
  // мелкие пятна у камеры (камешки, трава, тень от неровностей): два слоя шума по координатам куска, вдали — гладко
  float cd = length( cameraPosition - vW ), nk = 1.0 - smoothstep( 15.0, 160.0, cd );
  if ( nk > 0.0 ) alb *= 1.0 + nk * ( ( d37N( vW.xz * 0.9 ) - 0.5 ) * 0.22 + ( d37N( vW.xz * 4.3 + 17.0 ) - 0.5 ) * 0.14 );
  // альфа: 0…0,5 — суша (выше над морем — меньше), 0,5…1 — вода (глубже — больше): берег — где альфа = 0,5
  float a = vCol.a, wf = smoothstep( 0.494, 0.51, a ), water = clamp( ( a - 0.5 ) * 2.6, 0.0, 1.0 );
  vec3 N = normalize( vN ), L = uSunL, V = normalize( cameraPosition - vW );
  float mu = dot( vUp, L );
#ifdef D37_PWX
  // погода у камеры (V.setWeather): снег ложится на смотрящее вверх (край — пятнами), мокрая земля темнее; дальше uWx.z — нет
  // (там свой климат); на воде — нет
  if ( uWx.x + uWx.y > 0.0 ) {
    float wk = ( 1.0 - smoothstep( uWx.z * 0.6, uWx.z, cd ) ) * ( 1.0 - wf );
    float sn = uWx.x * wk * smoothstep( 0.62, 0.86, dot( N, vUp ) + ( d37N( vW.xz * 0.35 ) - 0.5 ) * 0.3 );
    alb = mix( alb * ( 1.0 - 0.35 * uWx.y * wk ), vec3( 0.80, 0.83, 0.87 ), sn );
  }
#endif
#ifdef D37_PSH
  vec3 sun = uLit.x * vSunT * d37Shadow();
#else
  vec3 sun = uLit.x * vSunT;
#endif
  vec3 amb = d37Amb( mu ) * uLit.y;
  vec3 col = vec3( 0.0 ), colW = vec3( 0.0 );
  if ( wf > 0.0 ) {
    float dist = length( cameraPosition - vW ), k = 1.0 - smoothstep( 60.0, 900.0, dist );
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
    if ( uBlob.w > 0.0 ) { vec3 dv = vW - uBlob.xyz; float dd = length( dv.xz ); shade = mix( 0.55, 1.0, min( 1.0, smoothstep( uBlob.w * 0.25, uBlob.w, dd ) + step( 3.0, abs( dv.y ) ) ) ); }
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
  gl_FragColor = vec4( vec3( vB ) * ( 1.0 - smoothstep( 0.1, 0.5, r ) ), 1.0 );
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
    const T = R.T, PL = E.planet, D = P.def, q = R.q || 'mid', mob = !!E.isMobile?.(), low = q === 'low';
    const v2 = v2ls(), F = { ...FLAGS, ...(v2 === '1' ? FLAGS_ON : v2 === '0' ? FLAGS_OFF : {}), ...v2flags(), ...(o.flags || {}) };
    if (!F.lod2) F.morph = F.prefetch = false;
    const BO = { lite: !F.lod2 };   // без LOD v2 — кусок собирается как раньше (без формы родителя и его точности — дешевле)
    // дымка до вещей движка: кусок тумана с дымкой — только пока открыта планета (gfx.js E.aerialPatch; страж снимает — ключ 'aerial')
    const apOn = !!(F.aerial && E.aerialPatch && E.aerialPatch(T, true));
    // видеопамять: кусок, спрятанный дольше GPU_HOLD мс, отдаёт буферы видеокарты (данные в памяти страницы остаются — покажется
    // снова, three загрузит заново); с LOD v2
    const GPU_HOLD = o.gpuHold ?? 3000;
    const N = 32, K = o.K ?? (mob || low ? 1.0 : 1.25), maxL = o.maxL ?? 12;
    // LOD v2: экранная ошибка (пикселей CSS, телефон крупнее), перетекание (fade с, «осел» — k ≤ GATE), рядом с игроком — самый
    // мелкий уровень в пределах NEAR ед.; в видеокарту за кадр — не больше BUDGET кусков и BUDGET_B байт
    const TAU = o.tau ?? (mob || low ? 3 : 2.2), FULL = TAU * 1.7, FADE = o.fade ?? .12, GATE = .05, NEAR = o.near ?? 24;
    const BUDGET = o.budget ?? (mob || low ? 2 : 4), BUDGET_B = (o.budgetKB ?? (mob || low ? 96 : 256)) * 1024;
    const CAP = o.cap ?? (mob || low ? 260 : 480);
    const V = { P, R, fr: P.patch(o.dir || P.dirFromLatLon(43.2, 76.9)), camBF: new Float64Array(3), t: 0, alt: 0, altG: 0, dead: false, sunK: 1, skyM: null, flags: F,
      vel: new Float64Array(3), onRebase: f => { lis.push(f); return () => { const i = lis.indexOf(f); if (i >= 0) lis.splice(i, 1); }; } };
    const lis = o.onRebase ? [o.onRebase] : [];
    const grp = new T.Group(); grp.name = 'planet'; grp.matrixAutoUpdate = false;
    R.scene.add(grp);
    const own = [];
    // слой 1 — небо (купол, оболочка, звёзды, тела неба): только дальний проход глубины; камера движка видит оба слоя
    // (без двух диапазонов глубины — всё на слое 0, как раньше)
    const SKYL = F.split ? 1 : 0, camL1 = R.camera.layers.isEnabled(1);
    if (F.split) R.camera.layers.enable(1);

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
    V.U = U;   // общие числа атмосферы — и для неба системы (space-view.js: тела в небе — сквозь тот же воздух)
    // поверхность: свои числа — перетекание куска (на каждый кусок — перед его рисованием) и тени движка
    const TU = { ...U, uMk: { value: new T.Vector4(0, 0, N, 4) }, uMe: { value: new T.Vector4() }, uShM: { value: new T.Matrix4() }, uShMap: { value: null },
      uShP: { value: new T.Vector4(0, 0, 0, 0) }, uWx: { value: new T.Vector4(0, 0, 3000, 0) } };
    const terrainMat = new T.ShaderMaterial({ name: 'planet', uniforms: TU, vertexShader: TERRAIN_V, fragmentShader: TERRAIN_F, fog: false, lights: false,
      defines: { D37_MORPH: F.morph ? 1 : false, D37_PSH: F.shadows ? 1 : false, D37_PWX: F.weather ? 1 : false } });
    terrainMat.customProgramCacheKey = () => 'd37planet2' + (F.morph ? 'm' : '') + (F.shadows ? 's' : '') + (F.weather ? 'w' : '');
    own.push(terrainMat);
    // небо: купол (у камеры) и оболочка (вокруг планеты)
    const mkSky = mode => {
      const u = { ...U, uMode: { value: mode }, uSky: { value: new T.Vector4().copy(U.uSky.value) } };
      const m = new T.ShaderMaterial({ name: 'planet-sky', uniforms: u, vertexShader: SKY_V, fragmentShader: SKY_F, fog: false, lights: false, depthWrite: false,
        transparent: true, blending: T.AdditiveBlending, side: T.BackSide });
      m.customProgramCacheKey = () => 'd37planetsky1';
      own.push(m); return m;
    };
    const dome = new T.Mesh(domeGeo(T), mkSky(0)); dome.frustumCulled = false; dome.renderOrder = 901; own.push(dome.geometry); dome.layers.set(SKYL);
    dome.material.side = T.DoubleSide;   // купол вокруг камеры: каждый луч пересекает его один раз
    const shell = new T.Mesh(new T.SphereGeometry(1, mob || low ? 96 : 160, mob || low ? 48 : 80), mkSky(1)); shell.frustumCulled = false; shell.renderOrder = 902; own.push(shell.geometry); shell.layers.set(SKYL);
    shell.matrixAutoUpdate = false;
    if (A) { R.scene.add(dome); R.scene.add(shell); }
    // звёзды
    const stars = makeStars(T, D.seed, mob ? 1400 : 2400); stars.renderOrder = 900; own.push(stars.geometry, stars.material); stars.matrixAutoUpdate = false; stars.layers.set(SKYL);
    R.scene.add(stars);
    // луны-«украшения» профиля v1 (rails 'visual'); луны-тела (id) и планеты рисует js/engine/space-view.js по орбитам системы
    const moons = [];
    D.moons.forEach((m, idx) => {
      if (!m || typeof m !== 'object') return;
      const u = { ...U, uTint: { value: new T.Color(m.tint) } };
      const mat = new T.ShaderMaterial({ name: 'planet-moon', uniforms: u, vertexShader: MOON_V, fragmentShader: MOON_F, fog: false, lights: false });
      mat.customProgramCacheKey = () => 'd37planetmoon1';
      const mesh = new T.Mesh(new T.SphereGeometry(1, 40, 20), mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.layers.set(SKYL);
      own.push(mat, mesh.geometry); R.scene.add(mesh);
      moons.push({ m, mesh, idx });
    });

    // ── Небо движка: купол прячем (небо — атмосфера), фон — чёрный (космос), тени выключены (у поверхности своё освещение) ──
    const engineSky = R.scene.children.find(x => x.userData && x.userData.sky);
    const skyWas = engineSky ? engineSky.visible : true;
    if (engineSky) engineSky.visible = false;
    const black = new T.Color(0, 0, 0);
    const SUN = [0, 1, 0];
    const offSun = sunProvide((t, out) => { out[0] = SUN[0]; out[1] = SUN[1]; out[2] = SUN[2]; return out; });

    // ── Общие индексы сшивки (16 масок) ──
    const IDX = [];
    for (let m = 0; m < 16; m++) { const a = new T.BufferAttribute(PL.indices(N, m), 1); IDX.push(a); }

    // ── Куски: кэш, очередь, потоки ──
    const chunks = new Map();   // ключ → { key, n, data, mesh, used, state: 0 нет / 1 в очереди / 2 строится / 3 готов / 4 данные пришли }
    P.onNode = n => { const c = chunks.get(n.key); if (c && c.data) { P.nodeRange(n, c.data.hmin, c.data.hmax); P.nodeErr(n, c.data.err); } };
    const ST = V.st = { built: 0, buildMs: 0, buildMax: 0, integ: 0, integMs: 0, integMax: 0, integKB: 0, selMs: 0, selMax: 0, sel: 0, mainBuilds: 0, rebases: 0, evicted: 0, errors: 0, workerOk: false,
      respawns: 0, pre: 0, preBuilt: 0, splits: 0, merges: 0, popMax: 0, popSum: 0, popN: 0, morphMs: 0, upMs: 0, uploads: 0, gpuFreed: 0 };
    const queue = [], preQ = [];   // ждут сборки: шаг и листья; заранее (дети «вот-вот делимых» и «куда летим»)
    const workers = [];
    let reqId = 0;
    const inflight = new Map();   // id → chunk
    const cores = navigator.hardwareConcurrency || 4;
    // потоков: телефон — 2 при 6+ ядрах, компьютер — ядра − 2 (до 3); без LOD v2 — как раньше (1, компьютер с 5+ ядрами — 2);
    // упал — новый (до 3 раз), его куски — снова в очередь
    const wanted = o.workers ?? (!F.lod2 ? (cores <= 4 || mob ? 1 : 2) : mob ? (cores >= 6 ? 2 : 1) : clamp(cores - 2, 1, 3));
    const url = o.url || 'js/engine/planet-worker.js?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
    function spawn(slot){
      const w = new Worker(url), W = { w, busy: 0, ok: false, dead: false, ids: new Set(), slot };
      w.onmessage = e => onResult(W, e.data);
      w.onerror = () => {
        if (W.dead || V.dead) return;
        W.dead = true; ST.errors++;
        for (const i of W.ids) { const c = inflight.get(i); inflight.delete(i); if (c && c.state === 2) c.state = 0; }
        W.ids.clear(); dirty = true;
        try { w.terminate(); } catch (e) {}
        if (ST.respawns < 3) { ST.respawns++; setTimeout(() => { if (!V.dead) { try { workers[slot] = spawn(slot); } catch (e) {} } }, 400); }
      };
      w.postMessage({ t: 'init', def: D });
      return W;
    }
    try {
      if (typeof Worker === 'function' && o.workers !== 0) for (let k = 0; k < wanted; k++) workers.push(spawn(k));
    } catch (e) { console.warn('планета: потоков нет — строим на странице', e); }
    function onResult(W, d){
      if (d.t === 'ready') { W.ok = true; ST.workerOk = true; return; }
      W.busy--; W.ids.delete(d.id);
      const c = inflight.get(d.id); inflight.delete(d.id);
      if (!c) return;
      if (d.err && typeof d.err === 'string') { ST.errors++; c.state = 0; console.warn('планета: кусок не собрался', d.err); return; }
      ST.built++; ST.buildMs += d.ms || 0; ST.buildMax = max(ST.buildMax, d.ms || 0);
      if (c.pre) ST.preBuilt++;
      c.data = d; c.state = 4;   // 4 — данные пришли, сетку соберём в бюджет кадра
      if (c.n) { P.nodeRange(c.n, d.hmin, d.hmax); P.nodeErr(c.n, d.err); }   // ошибки — сразу (выбор кусков), сетка — потом
      ready.push(c);
    }
    const ready = [];
    function chunkOf(n){ let c = chunks.get(n.key); if (!c) { c = { key: n.key, n, data: null, mesh: null, used: 0, state: 0, mask: -1, pre: false, qm: 0, pri: 0, bytes: 0, root: false, gpu: false, hid: 0 }; chunks.set(n.key, c); } c.n = n; return c; }
    // буферы куска в видеокарте — прочь (общие индексы — не трогаем: отвязать, освободить, привязать снова)
    let gpuAt = 0;
    function gpuFree(c){
      const g = c.mesh.geometry;
      g.setIndex(null); g.dispose(); g.setIndex(IDX[c.mask >= 0 ? c.mask : 0]);
      c.gpu = false; ST.gpuFreed++;
    }
    // перед рисованием куска: его перетекание (k, k краёв, масштаб сдвига) — в общие числа материала; не изменилось — не трогаем
    const MK = TU.uMk.value, ME = TU.uMe.value, LAST = [NaN, NaN, NaN, NaN, NaN, NaN];
    function morphUp(){
      const c = this.userData.c, n = c.n, on = F.morph && n && n.ke;
      const k = on ? n.k : 0, ke = on ? n.ke : null;
      const e0 = ke ? ke[0] : 0, e1 = ke ? ke[1] : 0, e2 = ke ? ke[2] : 0, e3 = ke ? ke[3] : 0;
      // не перетекает (k и края 0) — масштаб не важен: у всех таких одно и то же (иначе каждый кусок перезаливал бы числа материала)
      const ms = !(k > 0) && !(e0 > 0) && !(e1 > 0) && !(e2 > 0) && !(e3 > 0) ? 0 : c.data ? c.data.mscale : 0;
      if (k === LAST[0] && ms === LAST[1] && e0 === LAST[2] && e1 === LAST[3] && e2 === LAST[4] && e3 === LAST[5]) return;
      LAST[0] = k; LAST[1] = ms; LAST[2] = e0; LAST[3] = e1; LAST[4] = e2; LAST[5] = e3;
      MK.x = k; MK.y = ms; ME.set(e0, e1, e2, e3);
      terrainMat.uniformsNeedUpdate = true; ST.uploads++;
    }
    // сетка из данных (на странице): атрибуты, общие индексы, матрица — от якоря
    function integrate(c){
      const t0 = now(), d = c.data;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(d.nrm, 3, true));
      g.setAttribute('aCol', new T.BufferAttribute(d.col, 4, true));
      const mo = F.morph && !!d.md;   // перетекание выкл — без этих буферов (память видеокарты — как раньше)
      if (mo) {
        g.setAttribute('aMd', new T.BufferAttribute(d.md, 4, true));   // сдвиг к форме родителя (int16) и столбец a
        g.setAttribute('aNp', new T.BufferAttribute(d.np, 4, true));   // нормаль родителя (int8) и строка b
        g.setAttribute('aCp', new T.BufferAttribute(d.colp, 4, true));
      }
      g.setIndex(IDX[0]);
      g.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), d.radius);
      const m = new T.Mesh(g, terrainMat);
      m.matrixAutoUpdate = false; m.userData.planet = true; m.userData.c = c; if (mo) m.onBeforeRender = morphUp;
      c.mesh = m; c.mask = 0; c.state = 3;
      c.bytes = d.pos.byteLength + d.nrm.byteLength + d.col.byteLength + (mo ? d.md.byteLength + d.np.byteLength + d.colp.byteLength : 0);
      placeMesh(c);
      if (c.n) { P.nodeRange(c.n, d.hmin, d.hmax); P.nodeErr(c.n, d.err); }
      const ms = now() - t0; ST.integ++; ST.integMs += ms; ST.integMax = max(ST.integMax, ms); ST.integKB += c.bytes / 1024;
      dirty = true;
      return c.bytes;
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
    for (let f = 0; f < 6; f++) { const n = P.node(f, 0, 0, 0), c = chunkOf(n); c.data = P.buildChunk(f, 0, 0, 0, N, BO); c.root = true; ST.mainBuilds++; integrate(c); }

    function send(W, c){
      const n = c.n; c.state = 2; const id = ++reqId; inflight.set(id, c); W.busy++; W.ids.add(id);
      W.w.postMessage({ t: 'build', id, f: n.f, L: n.L, i: n.i, j: n.j, N, lite: BO.lite });
    }
    function pump(t0){
      // в потоки — по важности: шаг (дети делимых, родители сливаемых), листья; если места хватает — заранее; не больше 2 у потока
      let live = 0;
      for (const W of workers) if (W && W.ok && !W.dead) live++;
      if (live) {
        for (const W of workers) {
          if (!W || !W.ok || W.dead) continue;
          while (W.busy < 2 && queue.length) { const c = queue.shift(); if (c.state === 1) { c.pre = false; send(W, c); } }
          while (W.busy < 2 && !queue.length && preQ.length) { const c = preQ.shift(); if (c.state === 1) { c.pre = true; ST.pre++; send(W, c); } }
        }
      } else if ((queue.length || preQ.length) && (!workers.length || workers.every(W => !W || W.dead) || now() - started > 4000)) {
        // запасной путь: потоков нет — на странице, по одному за кадр и не дольше 3 мс
        const Q = queue.length ? queue : preQ;
        while (Q.length && now() - t0 < 3) {
          const c = Q.shift();
          if (c.state !== 1) continue;
          const tb = now(), n = c.n;
          c.data = P.buildChunk(n.f, n.L, n.i, n.j, N, BO); c.state = 4; ST.mainBuilds++; ST.built++;
          const ms = now() - tb; ST.buildMs += ms; ST.buildMax = max(ST.buildMax, ms);
          P.nodeRange(n, c.data.hmin, c.data.hmax); P.nodeErr(n, c.data.err);
          ready.push(c);
          break;
        }
      }
      // готовые данные → сетки, по бюджету кадра: не больше BUDGET кусков и BUDGET_B байт (загрузка в видеокарту — при рисовании);
      // без LOD v2 — только BUDGET кусков, как раньше
      let k = 0, bytes = 0;
      while (ready.length && k < BUDGET && (!F.lod2 || ((k === 0 || bytes < BUDGET_B) && now() - t0 < 4))) {
        const c = ready.shift();
        if (c.state === 4 && chunks.get(c.key) === c) { bytes += integrate(c); k++; }
      }
    }
    const started = now();

    // ── Выбор и показ ──
    const leaves = [], shown = new Set(), showList = [], pre = [], nowSet = new Set();
    const isReady = n => { const c = chunks.get(n.key); return !!c && c.state === 3; };
    // проекция: пикселей (CSS) на единицу на расстоянии 1; узкий угол (телескоп) — не больше ×2 (иначе делилось бы всё вокруг)
    const projNow = () => { const cam = R.camera, h = R.h || 600, f = Math.tan(clamp(cam.fov, 1, 120) * Math.PI / 360); return h / (2 * max(f, Math.tan(Math.PI * 25 / 360) / 2)); };
    const PRED = [0, 0, 0], SSE = { proj: 1000, tau: TAU, near: NEAR, pred: null, pre: null, preK: .6 }, peekL = [];
    const MORPH = { tau: TAU, full: FULL, fade: FADE, proj: 1000 };
    // бюджет кусков: выбрано больше — допустимая ошибка на экране растёт (плавно: куски перетекают), меньше 80 % — назад
    const LEAF_MAX = o.leafMax ?? (mob || low ? 220 : 450), PRE_MAX = mob || low ? 6 : 12;
    let bias = 1;
    let showMark = 1, lastSel = -1e9, selX = Infinity, selY = Infinity, selZ = Infinity, waitMore = false, chgAt = 0;
    const LS = { split: 0, merge: 0 };
    function select(){
      const t0 = now(), wasDirty = dirty;
      const cx = V.camBF[0], cy = V.camBF[1], cz = V.camBF[2];
      if (F.lod2) {
        SSE.proj = MORPH.proj = projNow();
        SSE.tau = MORPH.tau = TAU * bias; MORPH.full = MORPH.tau * 1.7;
        // куда летим: через 0,6 с (быстро — заранее строим там)
        const v = V.vel, sp = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (F.prefetch && sp > 2) { PRED[0] = cx + v[0] * .6; PRED[1] = cy + v[1] * .6; PRED[2] = cz + v[2] * .6; SSE.pred = PRED; } else SSE.pred = null;
        SSE.pre = F.prefetch ? pre : null;
        P.select(cx, cy, cz, { maxL, sse: SSE }, leaves);
      } else P.select(cx, cy, cz, { K, maxL }, leaves);
      P.balance(leaves);
      selX = cx; selY = cy; selZ = cz; lastSel = t0;
      queue.length = 0; preQ.length = 0;
      showMark++;
      const vis = showList;
      if (F.lod2) {
        const st = P.lodShow(isReady, t0, { gate: F.morph ? GATE : 2, leaves }, vis);
        // скачок на смене уровня (оценка сверху, пикселей): у делимого — его k × его точность; у сливаемых — (1 − k детей) × их точность
        if (st.splits) for (const d of st.splits) popAdd(F.morph ? d.k : 1, d.err, d, MORPH.proj);
        if (st.merges) for (const p of st.merges) { let kmin = 1, e = 0; for (const c of p.kids || []) { kmin = min(kmin, F.morph ? c.k : 0); e = max(e, c.err); } popAdd(1 - kmin, e, p, MORPH.proj); }
        ST.splits += st.split; ST.merges += st.merge;
        LS.split = st.split; LS.merge = st.merge;
        // шаг показа идёт — выбирать чаще (60 мс). Ждём то, что само не изменится (сосед крупнее, кусок ещё строится) — не крутить
        // выбор вхолостую: через 0,4 с после последней перемены — как обычно (сдвинулась камера, готов новый кусок)
        if (st.split || st.merge || st.stand || wasDirty) chgAt = t0;
        waitMore = st.split > 0 || st.merge > 0 || ((st.wait > 0 || st.need.length > 0) && t0 - chgAt < 400);
        if (leaves.length > LEAF_MAX) bias = min(4, bias * 1.06); else if (leaves.length < LEAF_MAX * .8) bias = max(1, bias / 1.03);
        // в очередь по ступеням: шаг показа (дети делимых, родители сливаемых, поднявшееся из-за горизонта), на уровень вперёд,
        // «куда летим» (из-за горизонта), листья не глубже 2 уровней под показанным; глубже — потом (их черёд придёт шагами)
        const q2 = (n, tier) => { const c = chunkOf(n); c.used = showMark; if (c.state === 0) c.state = 1; if (c.state === 1 && c.qm !== showMark) { c.qm = showMark; c.pri = tier * 1e13 + min(n.imp || 0, 1e12); queue.push(c); } };
        for (const n of st.need) q2(n, 4);
        for (const n of st.ahead) q2(n, 3);
        if (F.prefetch && SSE.pred) for (const n of P.peek(cx, cy, cz, PRED[0], PRED[1], PRED[2], { cap: PRE_MAX }, peekL)) q2(n, 2);
        for (const n of leaves) {
          let a = n, dl = 0; while (a && a.dis !== st.mark) { a = a.par; dl++; }
          const c = chunkOf(n); c.used = showMark;
          if (dl && dl <= 2) { n.imp = n.rho || 0; q2(n, 1); }
        }
        // заранее (дети «вот-вот делимых») — если место в кэше есть и не больше PRE_MAX за выбор
        if (F.prefetch && chunks.size < CAP * .85) {
          let k2 = 0;
          for (const n of pre) {
            if (k2 >= PRE_MAX) break;
            const k = P.children(n);
            for (let i = 0; i < 4 && k2 < PRE_MAX; i++) { const c = chunkOf(k[i]); if (c.used < showMark - 1) c.used = showMark - 1; if (c.state === 0) { c.state = 1; k[i].imp = n.rho; preQ.push(c); k2++; } }
          }
        }
        if (preQ.length > 1) preQ.sort((a, b) => (b.n.imp || 0) - (a.n.imp || 0));
        for (const n of vis) { const c = chunks.get(n.key); c.used = showMark; if (n.par) { const pc = chunks.get(n.par.key); if (pc) pc.used = showMark; } }
      } else oldShow(cx, cy, cz, vis);
      // маски сшивки — по показанному
      for (const n of vis) {
        const c = chunks.get(n.key), m = F.lod2 ? n.mask : c.oldMask;
        if (c.mask !== m) { c.mask = m; c.mesh.geometry.setIndex(IDX[m]); }
      }
      // в сцену / из сцены
      nowSet.clear();
      for (const n of vis) nowSet.add(n.key);
      for (const k2 of shown) if (!nowSet.has(k2)) { const c = chunks.get(k2); if (c?.mesh) { grp.remove(c.mesh); c.hid = t0; } }
      for (const n of vis) if (!shown.has(n.key)) { const c = chunks.get(n.key); if (c?.mesh) { grp.add(c.mesh); c.gpu = true; } }
      shown.clear(); for (const k2 of nowSet) shown.add(k2);
      // спрятанные дольше GPU_HOLD — без буферов в видеокарте (корни — всегда с ними: ими закрываем, пока строится нужное)
      if (F.lod2 && t0 - gpuAt > 500) {
        gpuAt = t0;
        for (const c of chunks.values()) if (c.gpu && c.mesh && !c.root && !shown.has(c.key) && t0 - c.hid > GPU_HOLD) gpuFree(c);
      }
      // кэш: старые — прочь (не показанные, не корни, давно не нужные)
      if (chunks.size > CAP) {
        const old = [];
        for (const c of chunks.values()) if (!c.root && c.state === 3 && !shown.has(c.key) && c.used < showMark) old.push(c);
        old.sort((a, b) => a.used - b.used);
        for (let k2 = 0; k2 < old.length && chunks.size > CAP * .9; k2++) freeChunk(old[k2]);
      }
      // в очереди — только то, что ещё нужно (остальным вернуть «нет»)
      for (const c of chunks.values()) if (c.state === 1 && c.used < showMark - 1) c.state = 0;
      if (queue.length > 1) queue.sort(F.lod2 ? (a, b) => b.pri - a.pri : (a, b) => (b.n.imp || 0) - (a.n.imp || 0));
      dirty = false;
      const ms = now() - t0; ST.sel++; ST.selMs += ms; ST.selMax = max(ST.selMax, ms);
    }
    function popAdd(k, err, n, pj){
      if (!(err > 0) || !n.cp) return;
      const dx = V.camBF[0] - n.cp[0], dy = V.camBF[1] - n.cp[1], dz = V.camBF[2] - n.cp[2], d = max(1, sqrt(dx * dx + dy * dy + dz * dz) - n.ang * P.R);
      const px = k * err * pj / d;
      ST.popN++; ST.popSum += px; if (px > ST.popMax) ST.popMax = px;
    }
    // прежний показ (откат: FLAGS.lod2 = false): лист не готов — ближайший готовый предок, маска — по показанному
    function oldShow(cx, cy, cz, vis){
      vis.length = 0;
      for (const n of leaves) {
        const c = chunkOf(n); c.used = showMark;
        const dx = cx - n.cp[0], dy = cy - n.cp[1], dz = cz - n.cp[2];
        if (c.state === 3) { if (n.vis !== showMark) { n.vis = showMark; vis.push(n); } continue; }
        if (c.state === 0) { c.state = 1; }
        if (c.state === 1) { n.imp = n.size / max(1, sqrt(dx * dx + dy * dy + dz * dz)); queue.push(c); }
        let a = n.par;
        while (a && chunks.get(a.key)?.state !== 3) a = a.par;
        if (a) { chunks.get(a.key).used = showMark; if (a.vis !== showMark) { a.vis = showMark; vis.push(a); } }
      }
      let w = 0;
      for (const n of vis) { let a = n.par, hid = false; while (a) { if (a.vis === showMark) { hid = true; break; } a = a.par; } if (!hid) vis[w++] = n; else n.vis = 0; }
      vis.length = w;
      for (const n of vis) {
        let m = 0;
        for (let e = 0; e < 4; e++) { const nb = P.neighbor(n, e), a = nb.par; if (nb.vis !== showMark && a && a.vis === showMark) m |= 1 << e; }
        chunks.get(n.key).oldMask = m;
        if (n.ke) n.ke.fill(0); n.k = 0;
      }
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

    // ── Погода (climate.js): климат места — по широте, высоте, влаге (как цвет поверхности); координаты погоды — общие для всей
    //    планеты: x — на восток (долгота × R), z — на юг (−широта × R) — фронт идёт с запада, переезд якоря её не сдвигает ──
    const WD = [0, 0, 0];
    V.climateAt = (x, z) => P.climateAt(P.dirFromLatLon(clamp(-z / P.R * 180 / Math.PI, -90, 90), x / P.R * 180 / Math.PI, WD));
    // где камера (или точка куска x, y, z) для W.at(x, z, ms, высота над морем): [x, z, высота]
    V.weatherPos = (x, y, z, out = [0, 0, 0]) => {
      const X = P.toBF(V.fr, x, y, z, [0, 0, 0]), l = sqrt(X[0] * X[0] + X[1] * X[1] + X[2] * X[2]) || 1, ll = P.latLon([X[0] / l, X[1] / l, X[2] / l]);
      out[0] = ll[1] * Math.PI / 180 * P.R; out[1] = -ll[0] * Math.PI / 180 * P.R; out[2] = l - P.SEAR;
      return out;
    };
    // погода → свет планеты: тучи гасят солнце и дымку, небо серее; снег на земле и мокрая земля — у камеры (шейдер, флаг weather)
    // (wx: { cloud, rain, fog, storm, snowCover, wet } 0…1 | null). Навесов на планете нет (рельеф — поле высот): укрытие от дождя
    // (карта «что над головой» precip.js) не нужно, пока нет построек и пещер
    let wxK = { sun: 1, sky: 1, gray: 0 };
    V.setWeather = wx => {
      const W4 = TU.uWx.value;
      if (!wx) { wxK = { sun: 1, sky: 1, gray: 0 }; sunKAt = -1; W4.x = W4.y = 0; return; }
      const over = clamp(+wx.cloud || 0, 0, 1) ** 2, rain = clamp(+wx.rain || 0, 0, 1), fog = clamp(+wx.fog || 0, 0, 1), storm = clamp(+wx.storm || 0, 0, 1);
      wxK = { sun: clamp(1 - .78 * over - .1 * fog - .15 * storm, .08, 1), sky: clamp(1 - .35 * over - .15 * rain - .2 * storm, .3, 1), gray: clamp(.6 * over + .4 * fog, 0, 1) };
      W4.x = clamp(+wx.snowCover || 0, 0, 1); W4.y = clamp(+wx.wet || 0, 0, 1);
      sunKAt = -1;
    };

    // ── Два диапазона глубины (render.js / post.js: R.depthSplit): ближний [0,12 … S] — человечки, AO, отражения в экране; дальний
    //    [0,95 S … даль] — земля далеко и небо (слой 1). AO и отражения считают только ближний — на дальностях планеты страж графики
    //    их больше не «чинит». S — от высоты над землёй; высоко (ничего рядом) — ближний проход пустой (skipNear) ──
    const nearCam = new T.PerspectiveCamera(), farCam = new T.PerspectiveCamera();
    nearCam.layers.set(0); farCam.layers.set(0); farCam.layers.enable(1);
    const SPLIT = { near: nearCam, far: farCam, dist: 600, skipNear: false, planet: true };
    // та же камера, своя дальность (без copy(): та копирует и userData через JSON — мусор каждый кадр)
    const camSync = (dst, src, near, far) => {
      dst.position.copy(src.position); dst.quaternion.copy(src.quaternion); dst.up.copy(src.up);
      dst.fov = src.fov; dst.aspect = src.aspect; dst.zoom = src.zoom; dst.filmGauge = src.filmGauge; dst.filmOffset = src.filmOffset; dst.view = src.view;
      dst.near = near; dst.far = far; dst.updateProjectionMatrix(); dst.updateMatrixWorld(true);
    };
    function splitCams(cam, far){
      const S = clamp(max(600, V.altG * 2), 600, 6000);
      camSync(nearCam, cam, .12, S);
      camSync(farCam, cam, S * .95, max(far, S * 2));
      SPLIT.dist = S; SPLIT.skipNear = V.altG > S * 2 && !V.keepNear;
      R.depthSplit = SPLIT;
    }
    // страж графики: решения о том, что читает глубину кадра (AO, трава в AO, отражения, генерация кадров, глубина резкости, коды),
    // и вся постобработка — пока открыта планета, только на эту сессию (на её дальностях неверное «сломано» не должно выключить их
    // НАВСЕГДА); не собравшиеся шейдеры (наборы, свои куски) — как везде, навсегда
    const VOL = new Set(['ao', 'fol', 'rt', 'fg', 'dof', 'codes', 'test', 'post']);
    // (без двух диапазонов — как раньше: AO и отражений на планете нет вовсе, tame ниже)
    const guardVolWas = R.guardVolatile;
    if (F.split) R.guardVolatile = k => VOL.has(k);

    // ── Небо, свет, дальность — каждый кадр (перед рисованием) ──
    const SB = [0, 0, 0], ML = [0, 0, 0], MB = [0, 0, 0], UPD = [0, 0, 0];
    let lightAt = -1e9, lastHour = -1, nearFar = [0, 0], sunKAt = 1, lightK = 1, lightB = false;
    const m4 = new T.Matrix4(), m4b = new T.Matrix4();
    const GU = E.GFXU;
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
        // первые кадры — оба (вес невидимого 0): шейдеры соберутся сразу, а не рывком, когда купол впервые появится на спуске
        if (warm > 0) { warm--; dome.visible = shell.visible = true; }
        const rs = P.SEAR + top;
        shell.matrix.makeScale(rs, rs, rs).setPosition(TM[0], TM[1], TM[2]); shell.matrixWorldNeedsUpdate = true;
        // звёзды видно, когда небо тёмное у камеры: космос или ночь
        const mu = (cx * SB[0] + cy * SB[1] + cz * SB[2]) / Dc;
        const tauUp = A.tauR[2] * Math.exp(-max(0, V.alt) / A.Hr);   // сколько воздуха над камерой (синий)
        stars.material.uniforms.uK.value = clamp(1 - tauUp * 40 * clamp((mu + .15) / .3, 0, 1), 0, 1);
      } else stars.material.uniforms.uK.value = 1;
      // звёзды вертятся с небом: неподвижные → система планеты (поворот на −θ) → L; с системой (space-view.js) — её поворот
      // «небо системы → BF» (V.skyM, 9 чисел по строкам): звёзды стоят там же, где планеты и луна
      const SM = V.skyM;
      if (SM) m4b.set(SM[0], SM[1], SM[2], 0, SM[3], SM[4], SM[5], 0, SM[6], SM[7], SM[8], 0, 0, 0, 0, 1);
      else {
        const th = P.spin(V.t), c = Math.cos(th), s = Math.sin(th);
        // Rbf = поворот вокруг Y на −θ: x' = c x − s z, z' = s x + c z
        m4b.set(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1);
      }
      m4.set(B[0], B[1], B[2], 0, B[3], B[4], B[5], 0, B[6], B[7], B[8], 0, 0, 0, 0, 1).multiply(m4b);
      stars.matrix.copy(m4); stars.matrix.scale(TMP_V.set(10, 10, 10)); stars.matrix.setPosition(cam.position.x, cam.position.y, cam.position.z); stars.matrixWorldNeedsUpdate = true;
      // луны: место по времени, на дальности не дальше 0,9 far (тот же угловой размер)
      for (let k = 0; k < moons.length; k++) {
        const Mn = moons[k];
        P.moonPos(Mn.idx, V.t, MB);
        P.toL(fr, MB[0], MB[1], MB[2], ML);
        const dx = ML[0] - cam.position.x, dy = ML[1] - cam.position.y, dz = ML[2] - cam.position.z, dl = sqrt(dx * dx + dy * dy + dz * dz);
        const dd = min(dl, far * .9), k2 = dd / dl, rr = Mn.m.radius * k2;
        Mn.mesh.matrix.makeScale(rr, rr, rr).setPosition(cam.position.x + dx * k2, cam.position.y + dy * k2, cam.position.z + dz * k2);
        Mn.mesh.matrixWorldNeedsUpdate = true;
      }
      U.uTime.value = V.t % 1000;
      // солнечное затмение (space-view.js: V.sunK — какая доля диска солнца видна у камеры) и погода: свет солнца, неба и дымки тусклее
      const sk = V.sunK >= 0 && V.sunK <= 1 ? V.sunK : 1;
      if (sk !== sunKAt) {
        sunKAt = sk;
        const as = A ? A.sun : 0, ks = .03 + .97 * sk;
        U.uLit.value.x = 2.3 * sk * wxK.sun; U.uLit.value.y = (.12 + .88 * sk) * (1 - .25 * wxK.gray); U.uLit.value.z = 30 * as * ks * wxK.sky; U.uSky.value.x = 40 * as * ks * wxK.sky;
        dome.material.uniforms.uSky.value.x = shell.material.uniforms.uSky.value.x = 40 * as * ks * wxK.sky;
      }
      // свет движка (человечки, предметы): небо по настоящему солнцу — не чаще 4 раз в секунду или когда солнце сдвинулось
      UPD[0] = cx / Dc; UPD[1] = cy / Dc; UPD[2] = cz / Dc;
      const tn = now(), hour = P.localHour(UPD, V.t);
      if (tn - lightAt > 250 || abs(hour - lastHour) > .25 || abs(sk - lightK) > .02) {
        lightAt = tn; lastHour = hour; lightK = sk;
        try { R.setLighting(sk < 1 ? { time: hour, brightness: .1 + .9 * sk } : lightB ? { time: hour, brightness: 1 } : { time: hour }); lightB = sk < 1; } catch (e) {}
        cam.near = nearFar[0]; cam.far = nearFar[1]; cam.updateProjectionMatrix();   // setLighting сам ставит дальность (до 3000) — вернуть свою
      }
      // два диапазона глубины
      if (F.split) splitCams(cam, nearFar[1]); else if (R.depthSplit === SPLIT) R.depthSplit = null;
      // тени движка на земле у игрока: карта теней солнца движка (R.sun), её матрица — от последней перерисовки карты
      const sh = R.sun && R.sun.shadow, on = F.shadows && shOn && !low && R.sun.castShadow && sh && sh.map;
      if (on) {
        TU.uShMap.value = sh.map.texture; TU.uShM.value.copy(sh.matrix);
        TU.uShP.value.set(.85, sh.bias - .0004, 1 / sh.mapSize.x, max(.03, sh.normalBias));
      } else if (TU.uShP.value.x !== 0) { TU.uShP.value.x = 0; TU.uShMap.value = null; }
      // дымка до вещей движка (туман gfx.js): та же атмосфера у камеры — в общие числа E.GFXU.ap*
      if (F.aerial && E.aerialFog && A && GU && GU.apA) aerial(sk);   // E.aerialFog — кусок дымки в тумане есть (gfx.js)
    }
    // дымка «как у земли» для материалов движка (gfx.js FOG_F): σ рассеяния у камеры, пропускание до солнца, фаза Ми, сила
    function aerial(sk){
      const h = max(0, V.alt), rR = Math.exp(-h / A.Hr), rM = Math.exp(-h / A.Hm), bR = U.uBetaR.value, bM = U.uBetaM.value;
      const mu = (V.camBF[0] * SB[0] + V.camBF[1] * SB[1] + V.camBF[2] * SB[2]) / max(1, sqrt(V.camBF[0] ** 2 + V.camBF[1] ** 2 + V.camBF[2] ** 2));
      const tr = PL.chapman(Rg / A.Hr, h / A.Hr, mu) * A.Hr, tm = PL.chapman(Rg / A.Hm, h / A.Hm, mu) * A.Hm;
      GU.apA[0] = bR.x * rR; GU.apA[1] = bR.y * rR; GU.apA[2] = bR.z * rR; GU.apA[3] = 1;
      GU.apB[0] = bM * rM; GU.apB[1] = A.g; GU.apB[2] = 1 / A.Hr; GU.apB[3] = 1 / A.Hm;
      GU.apC[0] = SUN[0]; GU.apC[1] = SUN[1]; GU.apC[2] = SUN[2]; GU.apC[3] = U.uLit.value.z;
      GU.apD[0] = Math.exp(-(bR.x * tr + bM * 1.1 * tm)); GU.apD[1] = Math.exp(-(bR.y * tr + bM * 1.1 * tm)); GU.apD[2] = Math.exp(-(bR.z * tr + bM * 1.1 * tm)); GU.apD[3] = 0;
    }
    const TMP_V = new T.Vector3();
    let warm = 2, shOn = false;
    // тени движка на земле: игра включает у земли (идёт пешком), выключает в полёте (коробка теней — у игрока)
    V.setShadows = on => {
      if (!F.shadows) return;   // тени выкл (флаг) — как раньше: игра зовёт, ничего не меняется
      shOn = !!on;
      try { R.setLighting({ shadows: !!on && F.shadows }); } catch (e) {}
      const cam = R.camera; if (nearFar[0]) { cam.near = nearFar[0]; cam.far = nearFar[1]; cam.updateProjectionMatrix(); }
    };
    // AO, отражения в экране — с двумя диапазонами глубины снова можно (только ближний); генерация кадров и глубина резкости — нет
    // (на видах в десятки км глубина резкости размыла бы горы, перекладка кадров — небо). Без двух диапазонов — как раньше: без всех
    let tamed = null;
    const tame = () => {
      const b = R.optBase;
      if (!b || b === tamed) return;
      const off = F.split ? { framegen: false, dof: false } : { ao: false, rt: 'off', framegen: false, dof: false };
      if (b.framegen || b.dof !== false || (!F.split && (b.ao || (b.rt && b.rt !== 'off')))) R.applyGfx({ ...b, ...off });
      tamed = R.optBase;
    };
    tame();
    const pre2 = () => { if (!V.dead) { tame(); sky(); } };
    R.preRender.push(pre2);
    R.setLighting({ fogEnd: 3000, shadows: false });

    // ── Каждый кадр: выбор (≤ 8 раз в секунду и если камера сдвинулась или шаг показа не закончен), очередь, сборка в бюджет,
    //    перетекание (k кусков и краёв) ──
    V.ms = Date.now();
    const PV = new Float64Array(3);
    let pvT = 0;
    V.update = (dt, t, ms = Date.now()) => {
      if (V.dead) return;
      const t0 = now();
      V.t = t; V.ms = ms;
      const cam = R.camera;
      P.toBF(V.fr, cam.position.x, cam.position.y, cam.position.z, V.camBF);
      // скорость камеры (система планеты, сглажено) — для «куда летим»; переезд якоря её не портит (BF)
      if (pvT) { const dts = max(1e-3, (t0 - pvT) / 1000), a = min(1, dts * 4); for (let i = 0; i < 3; i++) V.vel[i] += ((V.camBF[i] - PV[i]) / dts - V.vel[i]) * a; }
      PV.set(V.camBF); pvT = t0;
      const moved = Math.hypot(V.camBF[0] - selX, V.camBF[1] - selY, V.camBF[2] - selZ);
      const step = max(2, (V.altG > 0 ? V.altG : 10) * .05);
      if (t0 - lastSel > (waitMore ? 60 : 125) && (moved > step || dirty || waitMore || queue.length || ready.length) || moved > step * 20) select();
      pump(t0);
      if (F.lod2) {
        const tm = now();
        MORPH.proj = projNow();
        if (F.morph) P.lodMorph(showList, V.camBF[0], V.camBF[1], V.camBF[2], t0, MORPH);
        ST.morphMs += now() - tm;
      }
      V.cpu = now() - t0;
    };
    V.shown = () => shown.size;
    V.stats = () => ({
      shown: shown.size, leaves: leaves.length, cached: chunks.size, queued: queue.length + preQ.length, building: inflight.size, ready: ready.length,
      built: ST.built, buildAvg: ST.built ? ST.buildMs / ST.built : 0, buildMax: ST.buildMax, integ: ST.integ, integAvg: ST.integ ? ST.integMs / ST.integ : 0,
      integMax: ST.integMax, integKB: Math.round(ST.integKB), selAvg: ST.sel ? ST.selMs / ST.sel : 0, selMax: ST.selMax, mainBuilds: ST.mainBuilds, rebases: ST.rebases, evicted: ST.evicted,
      errors: ST.errors, respawns: ST.respawns, workers: workers.filter(W => W && W.ok && !W.dead).length, nodes: P.nodes.size, alt: V.alt, altG: V.altG, near: nearFar[0], far: nearFar[1],
      pre: ST.pre, preBuilt: ST.preBuilt, splits: ST.splits, merges: ST.merges, popMax: +ST.popMax.toFixed(3), popAvg: ST.popN ? +(ST.popSum / ST.popN).toFixed(4) : 0, popN: ST.popN,
      uploads: ST.uploads, split: R.depthSplit === SPLIT ? SPLIT.dist : 0,
      // gpuKB — буферы кусков в видеокарте (показанные и спрятанные недавно; без LOD v2 — все с сеткой, как раньше), cacheKB — данные
      // всех кусков в памяти страницы
      gpuKB: Math.round([...chunks.values()].reduce((s, c) => s + (c.mesh && (!F.lod2 || c.gpu || c.root) ? c.bytes || 0 : 0), 0) / 1024),
      cacheKB: Math.round([...chunks.values()].reduce((s, c) => s + (c.mesh ? c.bytes || 0 : 0), 0) / 1024), gpuFreed: ST.gpuFreed,
    });
    V.dispose = () => {
      if (V.dead) return;
      V.dead = true;
      for (const W of workers) if (W) try { W.w.terminate(); } catch (e) {}
      for (const c of chunks.values()) if (c.mesh) { grp.remove(c.mesh); dropGeo(c.mesh.geometry); }
      chunks.clear(); P.lodReset();
      R.scene.remove(grp); R.scene.remove(dome); R.scene.remove(shell); R.scene.remove(stars);
      for (const Mn of moons) R.scene.remove(Mn.mesh);
      for (const x of own) x.dispose?.();
      const i = R.preRender.indexOf(pre2); if (i >= 0) R.preRender.splice(i, 1);
      if (engineSky) engineSky.visible = skyWas;
      if (R.depthSplit === SPLIT) R.depthSplit = null;
      if (R.guardVolatile && R.guardVolatile !== guardVolWas) R.guardVolatile = guardVolWas || null;
      if (!camL1) R.camera.layers.disable(1);
      if (apOn) E.aerialPatch(T, false); else if (GU && GU.apA) GU.apA[3] = 0;   // дымка движка — снова обычный туман (и кусок — прежний)
      TU.uShMap.value = null;
      offSun(); P.onNode = null;
    };
    // пятно тени под игроком (своего освещения у поверхности; тени движка выключены): x, y, z ступней, r — 0 — нет
    V.blob = (x, y, z, r) => U.uBlob.value.set(x, y, z, r);
    return V;
  };

  // куски шейдеров атмосферы — для неба системы (space-view.js): тела светят сквозь тот же воздух
  E.planetView.GLSL = { ATMO, PHASE };
  E.planetView.FLAGS = FLAGS;   // что включено по умолчанию (T-075 на паузе — всё false; см. начало файла)

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
