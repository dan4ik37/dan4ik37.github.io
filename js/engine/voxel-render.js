// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика «Кубомира» на Three.js: текстуры-слои (массив; WebGL1 — атлас), материалы со светом
//  кубиков, сетки чанков из пула (без мусора и пересоздания буферов), рамка выделения, трещины, вещи в 3D, значки
// ═══════════════════════════════════════
// VR = V.renderer(R) — R из D37E.renderer (небо по времени суток, солнце/луна с тенями, туман, постобработка, FSR — всё
// движка). Материал — Ламберт движка + свой кусок шейдера: свет солнца и неба умножается на «свет неба» кубика (в пещере
// темно и днём), ЦВЕТНОЙ свет факелов, лавы, ламп (три канала из сетки, плавно по вершинам, факелы чуть мерцают) добавляется
// своим цветом, углы — AO; факел, лава, лампа светятся сами (не темнеют ночью). Настоящие лампы движка (R.lights) освещают
// без «света неба» — в пещере тоже. Вода — блики солнца и отражение неба под острым углом (рябь кодом).
// Шейдер не собрался (бывает на старых телефонах) — VR сам переходит на простой (атлас, без мерцания и бликов): VR.safe.
// VR.setChunk(c, m) / dropChunk(c) — сетки чанка (m — ответ потока); VR.setOrigin(ox, oz) — сдвиг начала координат (далеко
// от нуля float32 дрожит: сцена всегда рядом с нулём); VR.select(hit), VR.crack(x, y, z, стадия), VR.itemMesh(имя, свет),
// VR.itemLight(геометрия, свет клетки) — свет вещи (W.lightAt: небо << 12 | R << 8 | G << 4 | B), VR.itemLightF(геометрия,
// [небо, R, G, B]) — то же дробными уровнями 0…15 (плавный свет), V.icon(имя, размер) — значок.
// Существа (человечки world3d, мобы, рука от 1-го лица) — VR.entityMaterial(материал, униформа, { fp }): копия материала
// с тем же светом, что у кубиков (униформа { value: Vector4(небо, R, G, B) } — уже по кривой, см. KubomirEnts.Lit); fp —
// «вид из глаз»: глубина сжата к ближней плоскости (рука и вещь не уходят в стену, друг друга закрывают правильно).
(() => {
  const E = window.D37E = window.D37E || {};
  const V = E.vox = E.vox || {};
  const H = V.H;

  // ═══ Значки вещей (2D canvas, без WebGL): блок — изометрический кубик, вещь — спрайт ═══
  const iconCache = new Map(), tileCache = new Map();
  function tileCanvas(layer){
    if (tileCache.has(layer)) return tileCache.get(layer);
    const t = V.tex[layer], d = V.paint(t.name, V.specOf ? V.specOf(t.name) : t.spec || V.TEX_SPECS[t.name]);
    const TS = V.TEX || 16, c = document.createElement('canvas'); c.width = c.height = TS;
    const g = c.getContext('2d'), im = g.createImageData(TS, TS); im.data.set(d); g.putImageData(im, 0, 0);
    tileCache.set(layer, c);
    return c;
  }
  // тонировка (трава, листва) для значка
  function tinted(layer, rgb){
    const k = 'tint:' + layer + ':' + rgb.join(',');
    if (tileCache.has(k)) return tileCache.get(k);
    const TS = V.TEX || 16, src = tileCanvas(layer), c = document.createElement('canvas'); c.width = c.height = TS;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, TS, TS);
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = im.data[i] * rgb[0] / 255; im.data[i + 1] = im.data[i + 1] * rgb[1] / 255; im.data[i + 2] = im.data[i + 2] * rgb[2] / 255; }
    g.putImageData(im, 0, 0); tileCache.set(k, c);
    return c;
  }
  V.icon = (name, size = 40) => {
    const key = name + '@' + size;
    if (iconCache.has(key)) return iconCache.get(key);
    const it = V.item(name), b = it?.place ? V.block(it.place) : null;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    try {
      if (b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex) {
        const f = b.texf, tint = b.tint ? (b.tint === V.TINT.birch ? [128, 167, 85] : b.tint === V.TINT.spruce ? [97, 153, 97] : [124, 189, 90]) : [255, 255, 255];
        const mul = (c, k) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)], W3 = [255, 255, 255];
        const sideT = b.tint && b.tint !== V.TINT.grass ? tint : W3;
        const top = tinted(f.top, tint), side = tinted(f.side, mul(sideT, .8)), front = tinted(f.front >= 0 ? f.front : f.side, mul(sideT, .62));
        // изометрия: верх — ромб, слева — бок, справа — «перед» (у печи и сундука — их лицевая сторона)
        const s = size * .46, hs = s * .95, cx = size / 2, y0 = size * .04, cy = y0 + s / 2, T1 = V.TEX || 16, T2 = T1 * 2;
        g.setTransform(s / T1, s / T2, -s / T1, s / T2, cx, y0); g.drawImage(top, 0, 0);
        g.setTransform(s / T1, s / T2, 0, hs / T1, cx - s, cy); g.drawImage(side, 0, 0);
        g.setTransform(s / T1, -s / T2, 0, hs / T1, cx, cy + s / 2); g.drawImage(front, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        const layer = it?.texL ?? (b ? b.texf?.side : null);
        if (layer != null && layer >= 0) {
          const tint = b && b.tint === V.TINT.grass ? [124, 189, 90] : null;
          g.drawImage(tint ? tinted(layer, tint) : tileCanvas(layer), size * .06, size * .06, size * .88, size * .88);
        }
      }
    } catch (e) { g.fillStyle = '#f0f'; g.fillRect(0, 0, size, size); }
    iconCache.set(key, c);
    return c;
  };
  V.iconURL = (name, size = 40) => { const c = V.icon(name, size); return c._url || (c._url = c.toDataURL()); };
  V.iconsReset = () => { iconCache.clear(); tileCache.clear(); };

  // ═══ Шейдеры (куски для Ламберта движка) ═══
  // Ветер — движка (наборы шейдеров, docs/SHADERS3D.md): uD37Wind = E.GFXU.wind (x — время, y — сила: у «Обычных» 0 — листва
  // стоит, zw — направление по миру). Листва и трава (вершины с флагом «качается») сдвигаются по ветру с порывами, у каждого
  // места — своя дрожь; смещение — в единицах сетки (1/16 блока). Материалы листвы — R.wave (define D37_WAVE ставит движок)
  const SWAY_FN = `
vec2 d37Sway( vec3 wp ) {
  float ph = wp.x * 0.7 + wp.z * 0.9 + wp.y * 0.3;
  float wd = dot( wp.xz, uD37Wind.zw ) * 0.35 + uD37Wind.x * 1.7;
  float gu = ( 0.65 + 0.35 * sin( uD37Wind.x * 0.31 + wp.x * 0.021 + wp.z * 0.017 ) ) * uD37Wind.y * uSway;
  float k = ( sin( wd ) * 0.6 + 0.4 ) * 0.9;
  return vec2( uD37Wind.z * k + sin( uD37Wind.x * 2.3 + ph ) * 0.35, uD37Wind.w * k + cos( uD37Wind.x * 1.9 + ph ) * 0.3 ) * gu;
}`;
  // vd.w: AO (0–1) | свечение грани 0…15 (2–5) | флаги (14–15: 1 — качается на ветру); lt: небо, R, G, B — ×4 (0…60)
  const VS_HEAD = `
attribute vec4 vd;
attribute vec4 lt;
varying vec3 vUvL;
varying vec4 vLt;
varying float vAo;
varying float vEm;
uniform float uTime;
uniform float uFlick;
uniform float uSway;
uniform vec4 uD37Wind;
#ifdef D37_WATER
varying vec3 vWp;
#endif` + SWAY_FN + `
vec3 d37N( float i ) {
  if ( i < 0.5 ) return vec3( 1.0, 0.0, 0.0 );
  if ( i < 1.5 ) return vec3( -1.0, 0.0, 0.0 );
  if ( i < 2.5 ) return vec3( 0.0, 1.0, 0.0 );
  if ( i < 3.5 ) return vec3( 0.0, -1.0, 0.0 );
  if ( i < 4.5 ) return vec3( 0.0, 0.0, 1.0 );
  if ( i < 5.5 ) return vec3( 0.0, 0.0, -1.0 );
  return vec3( 0.0, 1.0, 0.0 );
}`;
  const VS_NORMAL = `
vec3 objectNormal = d37N( floor( vd.z / 4096.0 ) );`;
  // «вид из глаз» (рука, вещь в руке): глубина — в первом проценте диапазона (ближе любой стены), порядок внутри сохраняется;
  // свет, тени и туман считаются по настоящему месту. Ветер движка в project_vertex (для моделей без масштаба) у нас не нужен —
  // свой (d37Sway, в единицах сетки) уже сдвинул вершины: define снимаем до куска движка
  const VS_FP = `
#ifdef D37_WAVE
#undef D37_WAVE
#endif
#include <project_vertex>
#ifdef D37_FP
gl_Position.z = gl_Position.z * 0.01 - gl_Position.w * 0.99;
#endif`;
  // свет: кривая «как в играх-кубиках» (l / (4 − 3l)) — там она в гамма-пространстве, а у нас свет линейный: поэтому
  // свет блоков — в квадрате (у факела ярко, хвост тёмный — видно «пятно»), свет неба — в степени 1,5 (тень под деревом,
  // вход в пещеру); у цветного света кривая — по самому яркому каналу (оттенок не меняется); мерцание факелов — своё у
  // каждого места (по мировым координатам), только у света блоков
  const VS_BEGIN = (simple) => `
vec3 transformed = vec3( position );
float d37w = vd.w;
float d37f = floor( d37w / 16384.0 );
vUvL = vec3( vd.x / 16.0, vd.y / 16.0, mod( vd.z, 4096.0 ) );
vec4 d37l = clamp( lt / 60.0, 0.0, 1.0 );
float d37m = max( max( d37l.y, d37l.z ), d37l.w );
float d37s = d37l.x / ( 4.0 - 3.0 * d37l.x );
float d37k = 4.0 - 3.0 * d37m;
vec4 d37c = vec4( d37s * sqrt( d37s ), d37l.yzw * d37m / ( d37k * d37k ) );
vec4 d37wp = modelMatrix * vec4( transformed, 1.0 );
${simple ? 'float d37fl = 1.0;' : `float d37h = d37wp.x * 1.31 + d37wp.z * 1.73 + d37wp.y * 0.71;
float d37fl = 1.0 + uFlick * ( 0.07 * sin( uTime * 8.7 + d37h ) + 0.045 * sin( uTime * 15.3 + d37h * 2.1 ) );`}
vLt = vec4( d37c.x, d37c.yzw * d37fl );
vAo = mod( d37w, 4.0 ) / 3.0;
vEm = mod( floor( d37w / 4.0 ), 16.0 ) / 15.0;
#ifdef D37_WATER
vWp = d37wp.xyz;
#endif
#ifdef D37_WAVE
if ( d37f > 0.5 && d37f < 1.5 ) {
  vec2 d37sw = d37Sway( d37wp.xyz );
  transformed.x += d37sw.x;
  transformed.z += d37sw.y;
}
#endif`;
  // тень вырезного (листва, трава, стекло, факелы): по альфе текстуры — дырявая, как сам блок; листва в тени качается с тем же
  // ветром (у теней нет define набора — смотрим на силу ветра: 0 — стоит)
  const VSD_HEAD = `
attribute vec4 vd;
varying vec3 vUvL;
uniform float uTime;
uniform float uSway;
uniform vec4 uD37Wind;` + SWAY_FN;
  const VSD_BEGIN = `
vec3 transformed = vec3( position );
vUvL = vec3( vd.x / 16.0, vd.y / 16.0, mod( vd.z, 4096.0 ) );
if ( floor( vd.w / 16384.0 ) > 0.5 && floor( vd.w / 16384.0 ) < 1.5 && uD37Wind.y > 0.0 ) {
  vec2 d37sw = d37Sway( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz );
  transformed.x += d37sw.x;
  transformed.z += d37sw.y;
}`;
  const FS_COMMON = `
varying vec3 vUvL;
varying vec4 vLt;
varying float vAo;
varying float vEm;
uniform float uTime;
uniform float uMinAmb;
uniform float uBlockK;
uniform float uEmK;
uniform float uDay;
uniform float uBloomK;
uniform vec3 uSunV;
uniform vec3 uSunC;
uniform vec3 uSkyC;
vec3 d37pt = vec3( 0.0 );
#ifdef D37_WATER
varying vec3 vWp;
#endif`;
  const FS_TEX2 = `
uniform highp sampler2DArray uTex;
vec4 d37Tex( vec3 p ) { return texture( uTex, p ); }
#ifdef D37_NMAP
uniform highp sampler2DArray uNTex;
uniform float uNStr;
// рельеф текстуры («высокая»): карта нормалей из яркости рисунка (печётся при сборке текстур), базис грани — по производным
// места и UV (без касательных в вершинах)
vec3 d37Bump( vec3 n, vec3 p, vec2 uv, vec3 m ) {
  vec3 q0 = dFdx( p ), q1 = dFdy( p );
  vec2 s0 = dFdx( uv ), s1 = dFdy( uv );
  vec3 a = cross( q1, n ), b = cross( n, q0 );
  vec3 t = a * s0.x + b * s1.x, bt = a * s0.y + b * s1.y;
  float k = max( dot( t, t ), dot( bt, bt ) );
  k = k > 0.0 ? inversesqrt( k ) : 0.0;
  return normalize( t * ( m.x * k ) + bt * ( m.y * k ) + n * m.z );
}
#endif`;
  const FS_NMAP = `
#include <normal_fragment_maps>
#ifdef D37_NMAP
{
  vec3 d37nm = texture( uNTex, vUvL ).xyz * 2.0 - 1.0;
  d37nm.xy *= uNStr;
  normal = d37Bump( normal, - vViewPosition, vUvL.xy, d37nm );
}
#endif`;
  const FS_TEX1 = `
uniform sampler2D uTex;
uniform float uAtlasN;
uniform float uTS;
vec4 d37Tex( vec3 p ) {
  vec2 tile = vec2( mod( p.z, uAtlasN ), floor( p.z / uAtlasN ) );
  vec2 f = clamp( fract( p.xy ) * uTS, 0.5, uTS - 0.5 );
  return texture2D( uTex, ( tile * uTS + f ) / ( uAtlasN * uTS ) );
}`;
  const FS_MAP = `
vec3 d37uv = vUvL;
#ifdef D37_WATER
d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );
#endif
vec4 d37c = d37Tex( d37uv );
diffuseColor *= d37c;`;
  const FS_COLOR = `
#if defined( USE_COLOR )
diffuseColor.rgb *= vColor * vColor;
#endif`;
  // солнце/луна — только где есть «свет неба» (в пещере днём темно), лампы движка (d37pt) — везде; свет блоков — своим цветом
  // (днём под открытым небом его почти не видно — как в жизни: факел на солнце не светит пятном); светящиеся грани (факел,
  // лава, лампа) — сами
  const FS_LIGHT = `
float d37ao = 0.42 + 0.58 * vAo;
vec3 d37sun = reflectedLight.directDiffuse - d37pt;
reflectedLight.directDiffuse = d37sun * vLt.x * d37ao + d37pt * ( d37ao * ( 1.0 - 0.6 * vEm ) );
reflectedLight.indirectDiffuse *= max( vLt.x, uMinAmb ) * d37ao;
reflectedLight.indirectDiffuse += diffuseColor.rgb * vLt.yzw * ( uBlockK * ( 1.0 - 0.72 * uDay * vLt.x ) * ( 1.0 - 0.8 * vEm ) ) * d37ao;
totalEmissiveRadiance += diffuseColor.rgb * vEm * uEmK;`;
  // свечение (bloom) у светящихся граней — метка в альфе, как у R.bloom движка (только на «высокой»: uBloomK > 0)
  // (запись — целым вектором, без ветвления: так советует страж графики движка — меньше простора драйверу ошибиться)
  const FS_BLOOM = `
#ifdef OPAQUE
gl_FragColor = vec4( gl_FragColor.rgb, ( uBloomK > 0.0 && vEm > 0.01 ) ? 1.0 + vEm * uBloomK : gl_FragColor.a );
#endif`;
  // вырезное по альфе (листва, трава, цветы, факелы, стекло) — код травы движка (E.FOLIAGE_GLSL после output_fragment, uniform
  // d37Rt = E.GFXU.rt): AO и контактные тени его не учитывают — без тёмных пятен вокруг травинок; флаг ставит движок (post.js)
  const foliageGLSL = () => typeof E.FOLIAGE_GLSL === 'string' && E.GFXU?.rt ? E.FOLIAGE_GLSL : '';
  // вода: рябь по мировым координатам → блик солнца/луны и небо под острым углом (френель)
  const FS_WATER = `
#ifdef D37_WATER
{
  vec3 d37V = normalize( vViewPosition );
  float d37a = uTime * 1.3;
  vec3 d37pw = vec3( sin( vWp.x * 1.7 + d37a ) * 0.06 + sin( vWp.z * 2.3 - d37a * 1.3 ) * 0.04, 0.0, cos( vWp.z * 1.9 + d37a * 0.9 ) * 0.06 + cos( vWp.x * 2.9 - d37a * 1.1 ) * 0.04 );
  vec3 d37n = normalize( normal + ( viewMatrix * vec4( d37pw, 0.0 ) ).xyz );
  float d37fr = pow( 1.0 - max( dot( d37n, d37V ), 0.0 ), 4.0 );
  vec3 d37r = reflect( -d37V, d37n );
  float d37sp = pow( max( dot( d37r, uSunV ), 0.0 ), 90.0 );
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, uSkyC * vLt.x, d37fr * 0.55 );
  totalEmissiveRadiance += uSunC * d37sp * vLt.x;
  diffuseColor.a = min( 1.0, diffuseColor.a + d37fr * 0.3 );
}
#endif`;
  // существа (Ламберт / мультяшный / Фонг world3d, коробки мобов): тот же свет, что у кубиков, но одним значением на всё
  // существо (uD37L — небо и цветной свет блоков в его клетке, плавно); солнце и небо — по «свету неба», лампы движка — везде,
  // свет блоков — своим цветом; у «плоских» (MeshBasic: глаза, блики) — просто яркость
  const ENT_FS_HEAD = `
uniform vec4 uD37L;
uniform float uMinAmb;
uniform float uBlockK;
uniform float uDay;
vec3 d37pt = vec3( 0.0 );
vec3 d37ps = vec3( 0.0 );`;
  const ENT_FS_LIGHT = `
#ifdef D37_ENT_LIT
{
  reflectedLight.directDiffuse = ( reflectedLight.directDiffuse - d37pt ) * uD37L.x + d37pt;
  reflectedLight.directSpecular = ( reflectedLight.directSpecular - d37ps ) * uD37L.x + d37ps;
  reflectedLight.indirectDiffuse *= max( uD37L.x, uMinAmb );
  reflectedLight.indirectSpecular *= max( uD37L.x, uMinAmb );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uD37L.yzw * ( uBlockK * ( 1.0 - 0.72 * uDay * uD37L.x ) );
}
#else
reflectedLight.indirectDiffuse *= clamp( vec3( max( uD37L.x * ( 0.3 + 0.7 * uDay ), uMinAmb ) ) + uD37L.yzw * uBlockK, 0.0, 1.0 );
#endif`;

  V.renderer = function (R, opts = {}){
    const T = R.T, gl2real = !!R.r.capabilities.isWebGL2;
    const VR = { chunks: new Set(), ox: 0, oz: 0, stats: { meshes: 0, quads: 0, poolFree: 0, bytes: 0 }, safe: !!opts.safe };
    let gl2 = gl2real && !VR.safe;   // простой режим — атлас (texture2D) и на WebGL2
    // ── текстуры ──
    let tex = null, atlasN = 1, ntex = null;
    const nmapOn = () => gl2 && !VR.safe && R.q === 'high' && opts.nmap !== false;
    const aniso = () => R.q === 'low' ? 1 : Math.max(1, Math.min(R.q === 'high' ? 16 : 8, R.r.capabilities.getMaxAnisotropy?.() || 1));
    VR.aniso = aniso;
    function buildTextures(){
      const all = V.paintAll(), L = all.length, TS = V.TEX || 16;
      if (tex) tex.dispose();
      if (gl2) {
        const data = new Uint8Array(TS * TS * 4 * L);
        all.forEach((d, i) => data.set(d, i * TS * TS * 4));
        tex = new T.DataArrayTexture(data, TS, TS, L);
        tex.format = T.RGBAFormat; tex.type = T.UnsignedByteType;
        tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestMipmapLinearFilter; tex.generateMipmaps = true;
        // анизотропия (21.10.2026, «всё мылит»): земля под углом без неё — каша из усреднённых пикселей; на средней и высокой — сколько
        // умеет видеокарта (до 16; дёшево), увеличение — «по пикселям» (Nearest), как в Майнкрафте
        tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.encoding = T.sRGBEncoding; tex.anisotropy = aniso();
      } else {
        atlasN = Math.ceil(Math.sqrt(L));
        const S = atlasN * TS, data = new Uint8Array(S * S * 4), RW = TS * 4;
        all.forEach((d, i) => { const tx = (i % atlasN) * TS, ty = Math.floor(i / atlasN) * TS; for (let y = 0; y < TS; y++) data.set(d.subarray(y * RW, y * RW + RW), ((ty + y) * S + tx) * 4); });
        tex = new T.DataTexture(data, S, S, T.RGBAFormat, T.UnsignedByteType);
        tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.encoding = T.sRGBEncoding;
      }
      tex.needsUpdate = true;
      U.uTex.value = tex; U.uAtlasN.value = atlasN; U.uTS.value = TS;
      // карта нормалей из яркости (рельеф: светлое — выше, тёмные швы и трещины — вглубь), только когда её рисуют
      if (ntex) { ntex.dispose(); ntex = null; }
      if (gl2 && nmapOn()) {
        const nd = new Uint8Array(TS * TS * 4 * L), hgt = new Float32Array(TS * TS);
        all.forEach((d, l) => {
          for (let i = 0; i < TS * TS; i++) hgt[i] = d[i * 4 + 3] < 128 ? 0 : (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255;
          const o = l * TS * TS * 4, h = (x, y) => hgt[((y + TS) % TS) * TS + ((x + TS) % TS)];
          for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
            const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2, il = 1 / Math.hypot(dx, dy, 1), j = o + (y * TS + x) * 4;
            nd[j] = Math.round((-dx * il * .5 + .5) * 255); nd[j + 1] = Math.round((-dy * il * .5 + .5) * 255); nd[j + 2] = Math.round((il * .5 + .5) * 255); nd[j + 3] = 255;
          }
        });
        ntex = new T.DataArrayTexture(nd, TS, TS, L);
        ntex.format = T.RGBAFormat; ntex.type = T.UnsignedByteType; ntex.magFilter = T.NearestFilter; ntex.minFilter = T.LinearMipmapLinearFilter; ntex.generateMipmaps = true;
        ntex.wrapS = ntex.wrapT = T.RepeatWrapping; ntex.anisotropy = aniso(); ntex.needsUpdate = true;
      }
      U.uNTex.value = ntex;
    }
    const U = { uTex: { value: null }, uAtlasN: { value: 1 }, uTS: { value: V.TEX || 16 }, uNTex: { value: null }, uNStr: { value: .75 }, uTime: { value: 0 }, uFlick: { value: 1 }, uMinAmb: { value: .055 }, uBlockK: { value: 1.7 }, uEmK: { value: 1.25 },
      uDay: { value: 1 }, uBloomK: { value: 0 }, uSway: { value: 1 }, uD37Wind: { value: E.GFXU?.wind || new Float32Array([0, 0, .8, .6]) },
      uSunV: { value: new T.Vector3(0, 1, 0) }, uSunC: { value: new T.Color(0, 0, 0) }, uSkyC: { value: new T.Color(.5, .6, .8) } };
    VR.U = U;
    // ── материалы ──
    // Для «паков» шейдеров движка (своих правок этого файла им не нужно): у каждой сетки V.LAYERS свой материал VR.mats[слой]
    // с метками material.userData.d37vox = { layer, cutout, foliage, water, glass, emissive: 'vertex' } и defines D37_VOX,
    // D37_<СЛОЙ> (D37_SOLID, D37_CUTOUT, D37_WATER, D37_FOLIAGE, D37_GLASS); меш чанка — userData.d37vox = слой, name «vox:слой».
    // Вершины: position — Uint16 ×3 (1/16 блока, меш в масштабе 1/16), vd — u, v (×16), слой текстуры | нормаль << 12,
    // AO (0…3) | свечение 0…15 << 2 | флаги << 14 (1 — качается, 2 — вода); lt — небо, R, G, B (×4, 0…60); color — цвет биома.
    // В шейдере после наших кусков: vUvL (u, v, слой), vLt (свет: небо, R, G, B — уже по кривой), vAo, vEm (свечение 0…1),
    // d37Tex(vUvL) — цвет текстуры. Свой кусок — VR.onShader(слой | '*', (sh, info) => {…}) (сработает после наших; пересборка
    // сама), свой материал целиком — VR.setLayerMaterial(слой, материал). Листва и трава качаются ветром движка (R.wave на
    // материалах foliage и cutout, сила и направление — E.GFXU.wind; VR.U.uSway — свой множитель, 0 — стоят); вырезное по альфе
    // пишет код травы движка (E.FOLIAGE_GLSL) — AO и контактные тени его не трогают.
    // лампы движка (точечные) — до солнца в куске lights_fragment_begin: запомнить их вклад (d37pt), чтобы «свет неба» их не гасил
    const LFB = String(T.ShaderChunk.lights_fragment_begin || ''), SPOT = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
    const LFB2 = LFB.includes(SPOT) ? LFB.replace(SPOT, 'd37pt = reflectedLight.directDiffuse;\n' + SPOT) : '';
    const LAYERS = V.LAYERS || ['solid', 'cutout', 'water', 'foliage', 'glass'];
    const shaderHooks = new Map();   // слой | '*' → [{ id, fn }]
    const hookKey = kind => [...(shaderHooks.get(kind) || []), ...(shaderHooks.get('*') || [])].map(h => h.id).join(',');
    VR.onShader = (layer, fn, id) => {
      if (typeof fn !== 'function') return () => {};
      const h = { id: String(id || 'h' + (++hookSeq)), fn };
      if (!shaderHooks.has(layer)) shaderHooks.set(layer, []);
      shaderHooks.get(layer).push(h);
      for (const m of Object.values(mats)) m.needsUpdate = true;
      return () => { const a = shaderHooks.get(layer) || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); for (const m of Object.values(mats)) m.needsUpdate = true; };
    };
    let hookSeq = 0;
    function patch(m, kind){
      const simple = VR.safe, FOL = !simple && (LAYER_OPTS[kind] || {}).alphaTest ? foliageGLSL() : '';
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        if (FOL) sh.uniforms.d37Rt = { value: E.GFXU.rt };
        // #include — только с новой строки (иначе шейдер не собирается)
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + VS_HEAD)
          .replace('#include <beginnormal_vertex>', VS_NORMAL)
          .replace('#include <begin_vertex>', VS_BEGIN(simple))
          .replace('#include <project_vertex>', VS_FP);
        let fs = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FS_COMMON + (FOL ? '\nuniform vec4 d37Rt;' : '') + (gl2 ? FS_TEX2 : FS_TEX1))
          .replace('#include <map_fragment>', FS_MAP)
          .replace('#include <color_fragment>', FS_COLOR)
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FS_LIGHT + (simple ? '' : FS_WATER));
        if (LFB2 && !simple) fs = fs.replace('#include <lights_fragment_begin>', LFB2);
        if (!simple) fs = fs.replace('#include <normal_fragment_maps>', FS_NMAP);
        if (FOL) fs = fs.replace('#include <output_fragment>', '#include <output_fragment>\n' + FOL);
        if (!simple) fs = fs.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FS_BLOOM);
        sh.fragmentShader = fs;
        // куски движка (паки шейдеров): после наших; ошибка в куске — без него (кубики важнее)
        if (!simple) for (const h of [...(shaderHooks.get(kind) || []), ...(shaderHooks.get('*') || [])]) {
          const v0 = sh.vertexShader, f0 = sh.fragmentShader;
          try { h.fn(sh, { layer: kind, gl2, material: m, fp: !!m.defines?.D37_FP }); } catch (e) { sh.vertexShader = v0; sh.fragmentShader = f0; console.warn('Кубомир: кусок шейдера «' + h.id + '» —', e); }
        }
      };
      m.customProgramCacheKey = () => 'd37vox5-' + kind + (gl2 ? '2' : '1') + (simple ? 's' : '') + (m.defines?.D37_FP ? 'f' : '') + (FOL ? 'F' : '') + (simple ? '' : hookKey(kind));
      return m;
    }
    const LAYER_OPTS = {
      solid: {},
      cutout: { alphaTest: .5 },
      // вода пишет глубину (21.10.2026): иначе AO, контактные тени и отражения в экране считались по дну — по льду и воде шли
      // тёмные полосы и «призраки» от того, что под водой
      water: { transparent: true, opacity: .82, depthWrite: true },
      foliage: { alphaTest: .5 },
      glass: { alphaTest: .5 },
    };
    const makeMat = (k, fp) => {
      const opt = LAYER_OPTS[k] || { alphaTest: .5 };
      const m = patch(new T.MeshLambertMaterial({ vertexColors: true, ...opt }), k);
      m.defines = { D37_VOX: 1, ['D37_' + k.toUpperCase()]: 1 };
      if (fp) m.defines.D37_FP = 1;
      if (nmapOn() && k !== 'water') m.defines.D37_NMAP = 1;   // рельеф текстур — на «высокой» (WebGL2)
      m.userData.d37vox = { layer: k, cutout: !!opt.alphaTest, foliage: k === 'foliage', water: k === 'water', glass: k === 'glass', emissive: 'vertex', fp: !!fp };
      return m;
    };
    const makeMats = () => { const o = {}; for (const k of LAYERS) o[k] = makeMat(k); return o; };
    // вещь «из глаз» (в руке от 1-го лица): те же слои с D37_FP — по одной на слой, по первому запросу
    let fpMats = {};
    const fpMat = k => fpMats[k] || (fpMats[k] = makeMat(k, true));
    // тень вырезного — по альфе текстуры (одна на слой; пересобирается с простым режимом)
    let depthMats = {};
    function depthMat(k){
      if (!(LAYER_OPTS[k] || {}).alphaTest) return undefined;
      if (depthMats[k]) return depthMats[k];
      const m = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, alphaTest: .5 });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VSD_HEAD).replace('#include <begin_vertex>', VSD_BEGIN);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vUvL;' + (gl2 ? FS_TEX2 : FS_TEX1))
          .replace('#include <map_fragment>', 'diffuseColor.a = d37Tex( vUvL ).a;');
      };
      m.customProgramCacheKey = () => 'd37voxdepth-' + (gl2 ? '2' : '1');
      return depthMats[k] = m;
    }
    // свой материал слоя целиком (пак движка): у всех сеток этого слоя сразу; null — вернуть наш
    const ownMats = {};
    VR.setLayerMaterial = (k, m) => {
      if (!LAYERS.includes(k)) return false;
      if (m) ownMats[k] = m; else delete ownMats[k];
      const use = ownMats[k] || mats[k];
      for (const c of VR.chunks) { const me = c.vis?.[k]; if (me) me.material = use; }
      return true;
    };
    VR.layerMaterial = k => ownMats[k] || mats[k];
    let mats = makeMats();
    VR.mats = mats;
    // отражения в экране («Трассировка лучей» движка): вода — блестящее прозрачное (код в альфе пишет E.rtMark, пока она включена)
    const regRt = () => { R.rtAdd?.(mats.water); };
    regRt();
    // ветер движка: листва и трава (слои foliage и cutout) — R.wave (define D37_WAVE ставит движок, когда набор шейдеров с ветром)
    const regWave = () => { if (typeof R.wave === 'function') for (const k of ['foliage', 'cutout']) if (mats[k]) R.wave(mats[k], { kind: 'leaves' }); };
    regWave();
    buildTextures();
    VR.rebuildTextures = () => { buildTextures(); V.iconsReset(); };

    // ── общие индексы (0 1 2 0 2 3 + 4k) ──
    let index = null, indexQ = 0;
    function ensureIndex(q){
      if (q <= indexQ) return;
      let n = Math.max(16384, indexQ || 0); while (n < q) n *= 2;
      const a = new Uint32Array(n * 6);
      for (let i = 0, v = 0; i < n * 6; i += 6, v += 4) { a[i] = v; a[i + 1] = v + 1; a[i + 2] = v + 2; a[i + 3] = v; a[i + 4] = v + 2; a[i + 5] = v + 3; }
      const old = index;
      index = new T.BufferAttribute(a, 1); indexQ = n;
      if (old) { for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) m.geometry.setIndex(index); } for (const list of pool.values()) for (const g of list) g.setIndex(index); }
    }
    ensureIndex(16384);
    // ── пул геометрий по ёмкости (квадратов): степени двойки от 256 ──
    const pool = new Map(), VB = 21;   // байт на вершину: pos 6 + vd 8 + цвет 3 + свет 4
    const capOf = n => { let c = 256; while (c < n) c *= 2; return c; };
    function takeGeo(n){
      const cap = capOf(n), list = pool.get(cap);
      if (list && list.length) return list.pop();
      ensureIndex(cap);
      const g = new T.BufferGeometry();
      const dyn = T.DynamicDrawUsage;
      g.setAttribute('position', new T.BufferAttribute(new Uint16Array(cap * 12), 3).setUsage(dyn));
      g.setAttribute('vd', new T.BufferAttribute(new Uint16Array(cap * 16), 4).setUsage(dyn));
      g.setAttribute('color', new T.BufferAttribute(new Uint8Array(cap * 12), 3, true).setUsage(dyn));
      g.setAttribute('lt', new T.BufferAttribute(new Uint8Array(cap * 16), 4, false).setUsage(dyn));
      g.setIndex(index);
      g.userData.cap = cap;
      g.boundingSphere = new T.Sphere(new T.Vector3(), 1);
      VR.stats.bytes += cap * 4 * VB;
      return g;
    }
    function giveGeo(g){
      const cap = g.userData.cap, list = pool.get(cap) || [];
      if (list.length >= 12) { g.dispose(); VR.stats.bytes -= cap * 4 * VB; return; }
      list.push(g); pool.set(cap, list);
    }
    function fill(g, m, yMax){
      const n = m.n, P = g.attributes.position, D = g.attributes.vd, C = g.attributes.color, L = g.attributes.lt;
      P.array.set(m.pos); D.array.set(m.vd); C.array.set(m.col);
      if (m.lt) L.array.set(m.lt); else L.array.fill(60, 0, n * 16);
      P.updateRange.offset = 0; P.updateRange.count = n * 12; P.needsUpdate = true;
      D.updateRange.offset = 0; D.updateRange.count = n * 16; D.needsUpdate = true;
      C.updateRange.offset = 0; C.updateRange.count = n * 12; C.needsUpdate = true;
      L.updateRange.offset = 0; L.updateRange.count = n * 16; L.needsUpdate = true;
      g.setDrawRange(0, n * 6);
      const hy = (yMax + 2) * 8;
      g.boundingSphere.center.set(128, hy, 128); g.boundingSphere.radius = Math.sqrt(128 * 128 * 2 + hy * hy);
      g.userData.n = n;
    }
    const meshPool = [];
    function placeMesh(mesh, c){ mesh.position.set(c.cx * 16 - VR.ox, 0, c.cz * 16 - VR.oz); mesh.updateMatrix(); }
    VR.setChunk = (c, m) => {
      const vis = c.vis || (c.vis = {});
      for (const k of LAYERS) {
        const d = m[k], cur = vis[k];
        if (!d) { if (cur) { R.scene.remove(cur); giveGeo(cur.geometry); cur.geometry = null; meshPool.push(cur); vis[k] = null; } continue; }
        let mesh = cur;
        if (!mesh) {
          mesh = meshPool.pop() || new T.Mesh(undefined, mats[k]);
          mesh.material = ownMats[k] || mats[k]; mesh.matrixAutoUpdate = false; mesh.scale.setScalar(1 / 16);
          mesh.castShadow = k !== 'water'; mesh.receiveShadow = true; mesh.renderOrder = k === 'water' ? 5 : 0;
          mesh.customDepthMaterial = depthMat(k);
          mesh.userData.d37vox = k; mesh.name = 'vox:' + k;
          mesh.geometry = takeGeo(d.n);
          placeMesh(mesh, c); R.scene.add(mesh); vis[k] = mesh;
        } else if (mesh.geometry.userData.cap < d.n) { giveGeo(mesh.geometry); mesh.geometry = takeGeo(d.n); }
        fill(mesh.geometry, d, m.yMax ?? H - 1);
      }
      VR.chunks.add(c);
      R.shadowDirty?.();
    };
    VR.dropChunk = c => {
      if (!c.vis) return;
      for (const k of LAYERS) { const m = c.vis[k]; if (m) { R.scene.remove(m); giveGeo(m.geometry); m.geometry = null; meshPool.push(m); } }
      c.vis = null; VR.chunks.delete(c);
    };
    VR.setOrigin = (ox, oz) => {
      VR.ox = ox; VR.oz = oz;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) placeMesh(m, c); }
    };
    VR.count = () => {
      let meshes = 0, quads = 0, free = 0;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) { meshes++; quads += m.geometry.userData.n || 0; } }
      for (const l of pool.values()) free += l.length;
      VR.stats.meshes = meshes; VR.stats.quads = quads; VR.stats.poolFree = free;
      return VR.stats;
    };

    // ── рамка выделения и трещины ──
    const selGeo = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
    const sel = new T.LineSegments(selGeo, new T.LineBasicMaterial({ color: '#111111', transparent: true, opacity: .55 }));
    sel.visible = false; sel.renderOrder = 6; R.scene.add(sel);
    VR.select = hit => {
      if (!hit) { sel.visible = false; return; }
      const b = hit.box || V.boxOf(hit.v, false) || [0, 0, 0, 1, 1, 1], e = .004;   // box — своя рамка (лёд на озере — до глади)
      sel.scale.set(b[3] - b[0] + e * 2, b[4] - b[1] + e * 2, b[5] - b[2] + e * 2);
      sel.position.set(hit.x - VR.ox + (b[0] + b[3]) / 2, hit.y + (b[1] + b[4]) / 2, hit.z - VR.oz + (b[2] + b[5]) / 2);
      sel.visible = true;
    };
    const crackFS2 = 'precision highp sampler2DArray; uniform sampler2DArray uTex; uniform float uLayer; varying vec2 vUv; void main(){ vec4 c = texture(uTex, vec3(vUv.x, 1.0 - vUv.y, uLayer)); if (c.a < 0.1) discard; gl_FragColor = vec4(c.rgb * 0.2, c.a * 0.75); }';
    const crackFS1 = 'uniform sampler2D uTex; uniform float uAtlasN; uniform float uTS; uniform float uLayer; varying vec2 vUv; void main(){ vec2 tile = vec2(mod(uLayer, uAtlasN), floor(uLayer / uAtlasN)); vec2 f = clamp(vec2(vUv.x, 1.0 - vUv.y) * uTS, 0.5, uTS - 0.5); vec4 c = texture2D(uTex, (tile * uTS + f) / (uAtlasN * uTS)); if (c.a < 0.1) discard; gl_FragColor = vec4(c.rgb * 0.2, c.a * 0.75); }';
    const crackMat = new T.ShaderMaterial({
      uniforms: { uTex: U.uTex, uAtlasN: U.uAtlasN, uTS: U.uTS, uLayer: { value: 0 } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: gl2 ? crackFS2 : crackFS1,
    });
    const crack = new T.Mesh(new T.BoxGeometry(1.004, 1.004, 1.004), crackMat);
    crack.visible = false; crack.renderOrder = 7; R.scene.add(crack);
    const D0 = V.texIdx.get('destroy_0');
    // b — рамка в долях блока (лёд на озере — до глади 0,875); нет — целый кубик
    VR.crack = (x, y, z, st, b) => {
      if (st < 0 || st == null) { crack.visible = false; return; }
      crackMat.uniforms.uLayer.value = D0 + Math.max(0, Math.min(7, st | 0));
      if (b) { crack.scale.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]); crack.position.set(x - VR.ox + (b[0] + b[3]) / 2, y + (b[1] + b[4]) / 2, z - VR.oz + (b[2] + b[5]) / 2); }
      else { crack.scale.set(1, 1, 1); crack.position.set(x - VR.ox + .5, y + .5, z - VR.oz + .5); }
      crack.visible = true;
    };

    // ── вещь в 3D (в руке, на земле): тот же формат вершин, что у чанков ──
    const ltOf = (L, out) => { out[0] = ((L >>> 12) & 15) * 4; out[1] = ((L >>> 8) & 15) * 4; out[2] = ((L >>> 4) & 15) * 4; out[3] = (L & 15) * 4; return out; };
    const LT0 = [60, 0, 0, 0];
    VR.itemGeo = (name, L = 15 << 12) => {
      const it = V.item(name), b = it?.place ? V.block(it.place) : null;
      const quads = [], lt = ltOf(L, [0, 0, 0, 0]);
      const glow = b ? V.T.emit[b.id] : 0;
      if (b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex) {
        const tint = b.tint ? (b.tint === V.TINT.birch ? [128, 167, 85] : b.tint === V.TINT.spruce ? [97, 153, 97] : [124, 189, 90]) : [255, 255, 255];
        for (let d = 0; d < 6; d++) {
          const D = V.MESH_DIRS[d], layer = V.texFor(V.T, b.id, 0, d), col = b.tint && !(b.tint === V.TINT.grass && d !== 2) ? tint : [255, 255, 255];
          const q = [];
          for (let k = 0; k < 4; k++) {
            const du = D.c[k][0], dv = D.c[k][1], p = [0, 0, 0];
            p[d >> 1] = (d & 1) ? 0 : 1; p[D.ua] = du; p[D.va] = dv;
            const U2 = d === 2 || d === 3 ? [p[0], p[2]] : d === 0 ? [1 - p[2], 1 - p[1]] : d === 1 ? [p[2], 1 - p[1]] : d === 4 ? [p[0], 1 - p[1]] : [1 - p[0], 1 - p[1]];
            q.push({ p: [p[0] - .5, p[1] - .5, p[2] - .5], uv: U2, layer, nrm: d, col });
          }
          quads.push(q);
        }
      } else {
        const layer = it?.texL ?? b?.texf?.side ?? 0, col = b && b.tint === V.TINT.grass ? [124, 189, 90] : [255, 255, 255];
        // плоская вещь — толщиной в 1/16 (как в Майнкрафте): лицо и спина по картинке, бока — по краю непрозрачных пикселей своим
        // цветом (слой «снег» почти белый — цвет даёт вершина; боковые грани шейдер затеняет сам). Без бортов вещь с ребра — чёрная нитка
        const th = it && !b ? 1 / 32 : 0, P = [[-.5, -.5, th], [-.5, .5, th], [.5, .5, th], [.5, -.5, th]], UV = [[0, 1], [0, 0], [1, 0], [1, 1]];
        quads.push(P.map((p, i) => ({ p, uv: UV[i], layer, nrm: 4, col })));
        quads.push([3, 2, 1, 0].map(i => ({ p: [P[i][0], P[i][1], th ? -th : -.001], uv: UV[i], layer, nrm: 5, col })));
        const tx = th ? V.tex[layer] : null, snow = V.texIdx?.get('snow');
        if (tx && snow != null) {
          const px = V.paint(tx.name, V.specOf ? V.specOf(tx.name) : tx.spec), n = Math.round(Math.sqrt(px.length / 4)), op = (x, y) => x >= 0 && y >= 0 && x < n && y < n && px[(y * n + x) * 4 + 3] > 100;
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            if (!op(x, y)) continue;
            const o = (y * n + x) * 4, c = [px[o], px[o + 1], px[o + 2]], X0 = x / n - .5, X1 = (x + 1) / n - .5, Y0 = .5 - (y + 1) / n, Y1 = .5 - y / n;
            const side = (pp, nrm) => quads.push(pp.map((p, k) => ({ p, uv: UV[k], layer: snow, nrm, col: c })));
            if (!op(x + 1, y)) side([[X1, Y0, th], [X1, Y0, -th], [X1, Y1, -th], [X1, Y1, th]], 0);
            if (!op(x - 1, y)) side([[X0, Y0, -th], [X0, Y0, th], [X0, Y1, th], [X0, Y1, -th]], 1);
            if (!op(x, y - 1)) side([[X0, Y1, -th], [X0, Y1, th], [X1, Y1, th], [X1, Y1, -th]], 2);
            if (!op(x, y + 1)) side([[X0, Y0, th], [X0, Y0, -th], [X1, Y0, -th], [X1, Y0, th]], 3);
          }
        }
      }
      const n = quads.length, pos = new Float32Array(n * 12), vd = new Uint16Array(n * 16), cl = new Uint8Array(n * 12), lta = new Uint8Array(n * 16), idx = [];
      quads.forEach((q, qi) => q.forEach((v, k) => {
        const o = qi * 4 + k;
        pos.set(v.p, o * 3); vd[o * 4] = Math.round(v.uv[0] * 16); vd[o * 4 + 1] = Math.round(v.uv[1] * 16); vd[o * 4 + 2] = v.layer | (v.nrm << 12); vd[o * 4 + 3] = 3 | (glow << 2);
        cl.set(v.col, o * 3); lta.set(lt, o * 4);
      }));
      for (let qi = 0; qi < n; qi++) idx.push(qi * 4, qi * 4 + 1, qi * 4 + 2, qi * 4, qi * 4 + 2, qi * 4 + 3);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('vd', new T.BufferAttribute(vd, 4)); g.setAttribute('color', new T.BufferAttribute(cl, 3, true));
      g.setAttribute('lt', new T.BufferAttribute(lta, 4, false));
      g.setIndex(idx);
      g.userData.flat = !(b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex);
      g.userData.L = L;
      return g;
    };
    // свет вещи (в пещере — темнее, у факела — тёплая): переписать свет вершин; L — свет клетки (W.lightAt)
    const LTtmp = [0, 0, 0, 0];
    VR.itemLight = (g, L) => {
      if (g.userData.L === L) return;
      g.userData.L = L; g.userData.Lf = -1;
      const a = g.attributes.lt; if (!a) return;
      ltOf(L, LTtmp);
      for (let i = 0; i < a.count; i++) { a.array[i * 4] = LTtmp[0]; a.array[i * 4 + 1] = LTtmp[1]; a.array[i * 4 + 2] = LTtmp[2]; a.array[i * 4 + 3] = LTtmp[3]; }
      a.needsUpdate = true;
    };
    // то же дробными уровнями (0…15): [небо, R, G, B] — плавный свет (KubomirEnts.Lit); в вершинах — четверть уровня
    VR.itemLightF = (g, lv) => {
      const s = Math.max(0, Math.min(60, Math.round(lv[0] * 4))), r = Math.max(0, Math.min(60, Math.round(lv[1] * 4))), gg = Math.max(0, Math.min(60, Math.round(lv[2] * 4))), b = Math.max(0, Math.min(60, Math.round(lv[3] * 4)));
      const key = s * 16777216 + r * 65536 + gg * 256 + b;
      if (g.userData.Lf === key) return;
      g.userData.Lf = key; g.userData.L = -1;
      const a = g.attributes.lt; if (!a) return;
      for (let i = 0; i < a.count; i++) { a.array[i * 4] = s; a.array[i * 4 + 1] = r; a.array[i * 4 + 2] = gg; a.array[i * 4 + 3] = b; }
      a.needsUpdate = true;
    };
    // o.fp — вещь «из глаз» (рука от 1-го лица): материал с D37_FP
    VR.itemMesh = (name, L, o) => {
      const g = VR.itemGeo(name, L), it = V.item(name), b = it?.place ? V.block(it.place) : null, s = b ? V.T.stream?.[b.id] : 0;
      const k = g.userData.flat ? 'cutout' : s === 3 ? 'foliage' : s === 4 ? 'glass' : 'solid';   // листва и стекло в руке — по альфе
      const m = new T.Mesh(g, o?.fp ? fpMat(k) : mats[k]);
      m.userData.item = name; m.userData.layer = k;
      if (o?.fp) m.userData.fp = true;
      return m;
    };
    // ── существа: копия материала со светом кубиков (см. ENT_FS_*); u — { value: Vector4 } одна на существо ──
    const lfbEnt = () => {
      const c = String(T.ShaderChunk.lights_fragment_begin || '');
      return c.includes(SPOT) ? c.replace(SPOT, 'd37pt = reflectedLight.directDiffuse;\nd37ps = reflectedLight.directSpecular;\n' + SPOT) : c;
    };
    VR.entityMaterial = (src, u, o = {}) => {
      const m = src.clone(), lit = !src.isMeshBasicMaterial, fp = !!o.fp, prev = src.onBeforeCompile;
      m.defines = Object.assign({}, src.defines || {}, { D37_ENT: 1 });
      if (lit) m.defines.D37_ENT_LIT = 1;
      if (fp) m.defines.D37_FP = 1;
      m.onBeforeCompile = (sh, r) => {
        if (typeof prev === 'function') try { prev.call(m, sh, r); } catch (e) {}
        sh.uniforms.uD37L = u; sh.uniforms.uMinAmb = U.uMinAmb; sh.uniforms.uBlockK = U.uBlockK; sh.uniforms.uDay = U.uDay;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + ENT_FS_HEAD)
          .replace('#include <lights_fragment_begin>', lfbEnt())
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + ENT_FS_LIGHT);
        if (fp) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', VS_FP);
      };
      const key0 = typeof src.customProgramCacheKey === 'function' ? String(src.customProgramCacheKey()) : '';
      m.customProgramCacheKey = () => 'd37ent1' + (lit ? 'L' : 'B') + (fp ? 'f' : '') + key0;
      m.userData.d37ent = { fp, kind: o.kind || '' };
      return m;
    };
    // материал не собрался (старый телефон) — true: тогда существу — обычная копия без своего куска
    VR.failed = m => failed(m);
    void LT0;
    // ── «призрак» блока: куда встанет блок из руки (полупрозрачный кубик); VR.ghost(null) — спрятать ──
    let ghostMat = null, ghost = null, ghostName = '';
    VR.ghost = (blockName, x, y, z, itemName) => {
      if (!blockName) { if (ghost) ghost.visible = false; return; }
      const name = itemName || blockName;
      if (!ghostMat) ghostMat = patch(new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .45, depthWrite: false }), 'ghost');
      if (ghostName !== name) {
        ghostName = name;
        if (ghost) ghost.geometry.dispose();
        else { ghost = new T.Mesh(undefined, ghostMat); ghost.renderOrder = 8; ghost.matrixAutoUpdate = true; R.scene.add(ghost); }
        ghost.geometry = VR.itemGeo(name, (15 << 12) | 0x666);
        ghost.scale.setScalar(1.002);
      }
      ghost.position.set(x - VR.ox + .5, y + .5, z - VR.oz + .5);
      ghost.visible = true;
    };

    // ── рамка «куда встанет блок» (21.10.2026, вместо полупрозрачного «призрака»): двойная — тёмные планки по рёбрам клетки и
    // светлые чуть внутри; видна на снегу и в тёмной пещере. Планки — объёмные (несколько точек экрана даже вдали; линии WebGL —
    // всегда в 1 точку), без света и тона, поверх соседних граней (сдвиг глубины), глубину не пишут. VR.preview({ x, y, z, h }) —
    // клетка (h — высота: дверь — 2); null — спрятать ──
    const prevGeo = new Map(), DARK = [.06, .06, .07], LIGHT = [.97, .97, .95];
    function frameGeo(h){
      if (prevGeo.has(h)) return prevGeo.get(h);
      const pos = [], col = [], idx = [];
      const bar = (a, b, t, c) => {   // планка — коробка от a до b (по одной оси), толщина t
        const lo = [0, 1, 2].map(k => Math.min(a[k], b[k]) - t / 2), hi = [0, 1, 2].map(k => Math.max(a[k], b[k]) + t / 2);
        const v0 = pos.length / 3;
        for (let i = 0; i < 8; i++) { pos.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]); col.push(c[0], c[1], c[2]); }
        for (const q of [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]]) idx.push(v0 + q[0], v0 + q[1], v0 + q[2], v0 + q[0], v0 + q[2], v0 + q[3]);
      };
      const edges = (x0, y0, z0, x1, y1, z1, t, c) => {
        for (const y of [y0, y1]) for (const z of [z0, z1]) bar([x0, y, z], [x1, y, z], t, c);
        for (const x of [x0, x1]) for (const z of [z0, z1]) bar([x, y0, z], [x, y1, z], t, c);
        for (const x of [x0, x1]) for (const y of [y0, y1]) bar([x, y, z0], [x, y, z1], t, c);
      };
      edges(-.004, -.004, -.004, 1.004, h + .004, 1.004, .026, DARK);   // снаружи — тёмная
      edges(.026, .026, .026, .974, h - .026, .974, .012, LIGHT);       // внутри — светлая
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      prevGeo.set(h, g);
      return g;
    }
    const prevMat = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    let prev = null;
    VR.preview = c => {
      if (!c) { if (prev) prev.visible = false; return; }
      const h = c.h > 1 ? 2 : 1;
      if (!prev) { prev = new T.Mesh(frameGeo(h), prevMat); prev.renderOrder = 8; prev.frustumCulled = false; prev.matrixAutoUpdate = true; prev.name = 'vox:preview'; R.scene.add(prev); }
      else if (prev.geometry !== frameGeo(h)) prev.geometry = frameGeo(h);
      prev.position.set(c.x - VR.ox, c.y, c.z - VR.oz);
      prev.visible = true;
    };
    VR.previewMesh = () => prev;

    // ── простой режим: шейдер не собрался (старый телефон) — пересобрать без мерцания, бликов и массива текстур ──
    let checkN = 0;
    function failed(m){
      const p = R.r.properties.get(m)?.currentProgram;
      return !!(p && p.diagnostics && p.diagnostics.runnable === false);
    }
    function goSafe(){
      if (VR.safe) return;
      VR.safe = true; gl2 = false;
      const old = mats, oldD = depthMats, oldF = fpMats;
      mats = VR.mats = makeMats(); depthMats = {}; fpMats = {};
      buildTextures();
      crackMat.fragmentShader = crackFS1; crackMat.needsUpdate = true;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) { m.material = ownMats[k] || mats[k]; m.customDepthMaterial = depthMat(k); } }
      for (const m of meshPool) m.material = mats.solid;
      const swap = new Map(LAYERS.map(k => [old[k], mats[k]]));
      for (const k in oldF) swap.set(oldF[k], fpMat(k));
      R.scene.traverse(o => { if (o.isMesh && swap.has(o.material)) o.material = swap.get(o.material); });
      for (const m of Object.values(old)) { R.waveMats?.delete?.(m); R.rtClear?.delete?.(m); m.dispose(); }
      regRt();
      for (const m of Object.values(oldF)) m.dispose();
      regWave();
      for (const m of Object.values(oldD)) m.dispose();
      if (ghostMat) { ghostMat.dispose(); ghostMat = null; ghostName = ''; if (ghost) { R.scene.remove(ghost); ghost.geometry?.dispose(); ghost = null; } }
      V.iconsReset();
      if (typeof console !== 'undefined') console.warn('Кубомир: шейдер кубиков не собрался — простой режим');
      VR.onSafe?.();
    }
    VR.goSafe = goSafe;

    // ── каждый кадр: время, мерцание, солнце (в координатах камеры) и небо для воды; проверка шейдеров первые кадры ──
    const sv = new T.Vector3();
    VR.update = (dt, t) => {
      U.uTime.value = t % 1000;
      const cam = R.camera;
      if (R.sunDir && cam) { sv.copy(R.sunDir).transformDirection(cam.matrixWorldInverse); U.uSunV.value.copy(sv); }
      if (R.sun) { const k = Math.min(1.6, R.sun.intensity * .55); U.uSunC.value.copy(R.sun.color).multiplyScalar(R.sun.castShadow || R.sun.intensity > .05 ? k : 0); }
      if (R.sky?.hor) { const s = R.sky, zc = s.zen || s.hor; U.uSkyC.value.setRGB(s.hor[0] * .6 + zc[0] * .4, s.hor[1] * .6 + zc[1] * .4, s.hor[2] * .6 + zc[2] * .4); }
      U.uDay.value = 1 - Math.max(0, Math.min(1, R.night || 0));
      U.uBloomK.value = R.q === 'high' && R.post ? .7 : 0;
      if (!VR.safe && checkN < 240) { checkN++; if ((checkN & 7) === 0 && LAYERS.some(k => failed(mats[k]))) goSafe(); }
    };
    VR.dispose = () => {
      for (const c of [...VR.chunks]) VR.dropChunk(c);
      for (const list of pool.values()) for (const g of list) g.dispose();
      pool.clear(); meshPool.length = 0;
      for (const m of Object.values(mats)) { R.rtClear?.delete?.(m); m.dispose(); }
      for (const m of Object.values(depthMats)) m.dispose();
      for (const m of Object.values(fpMats)) m.dispose();
      tex?.dispose(); ntex?.dispose(); selGeo.dispose(); sel.material.dispose(); crack.geometry.dispose(); crackMat.dispose();
      R.scene.remove(sel); R.scene.remove(crack);
      if (ghost) { R.scene.remove(ghost); ghost.geometry?.dispose(); } ghostMat?.dispose();
      if (prev) R.scene.remove(prev); for (const g of prevGeo.values()) g.dispose(); prevGeo.clear(); prevMat.dispose();
    };
    return VR;
  };
})();
