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
  // рисунок слоя (RGBA TS×TS): готовый — из последней сборки текстур (V.painted; тот же слой — по имени: моды переиспользуют номера
  // слоёв), иначе — нарисовать (V.paint — до 18 мс на рисунок на телефоне ×4; T-049)
  V.layerPixels = layer => {
    const t = V.tex[layer], p = V.painted;
    if (p && p.names && p.names[layer] === t.name && p[layer]) return p[layer];
    return V.paint(t.name, V.specOf ? V.specOf(t.name) : t.spec || V.TEX_SPECS[t.name]);
  };
  function tileCanvas(layer){
    if (tileCache.has(layer)) return tileCache.get(layer);
    const t = V.tex[layer], d = V.layerPixels(layer);
    const TS = V.TEX || 16, c = document.createElement('canvas'); c.width = c.height = TS;
    const g = c.getContext('2d'), im = g.createImageData(TS, TS); im.data.set(d); g.putImageData(im, 0, 0);
    tileCache.set(layer, c);
    return c;
  }
  // тонировка (трава, листва) для значка — прямо из рисунка слоя (раньше: drawImage → getImageData — чтение холста с видеокарты,
  // на телефоне до десятков мс при первом значке травы или листвы)
  function tinted(layer, rgb){
    const k = 'tint:' + layer + ':' + rgb.join(',');
    if (tileCache.has(k)) return tileCache.get(k);
    const d = V.layerPixels(layer);
    const TS = V.TEX || 16, c = document.createElement('canvas'); c.width = c.height = TS;
    const g = c.getContext('2d'), im = g.createImageData(TS, TS), o = im.data;
    for (let i = 0; i < o.length; i += 4) { o[i] = d[i] * rgb[0] / 255; o[i + 1] = d[i + 1] * rgb[1] / 255; o[i + 2] = d[i + 2] * rgb[2] / 255; o[i + 3] = d[i + 3]; }
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
  // vd.w: AO (0–1) | свечение грани 0…15 (2–5) | флаги (14–15: 1 — качается на ветру); lt: небо, R, G, B — ×4 (0…60);
  // у неба ещё + 64 × климатическая зона столба (V.climZone: 0 / 1 — всегда зима / 2 — зимы нет) → vD37Z (погода, D37_VOXZ)
  const VS_HEAD = `
attribute vec4 vd;
attribute vec4 lt;
varying vec3 vUvL;
varying vec4 vLt;
varying float vD37Z;
varying float vAo;
varying float vEm;
uniform float uTime;
uniform float uFlick;
uniform float uSway;
uniform vec4 uD37Wind;
#ifdef D37_WATER
varying vec3 vWp;
#endif
#ifdef D37_TEXFX
varying vec3 vD37C;
varying vec3 vD37W;
varying float vD37F;
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
  // вода (не в простом режиме): глубина у 4 углов грани (блоки) и биты «берег» — из сетки (voxel-mesh.js), смешиваются в пикселе
  const VS_WHEAD = `
#ifdef D37_WATER
varying vec4 vWD;
varying float vWS;
#endif`;
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
float d37zn = floor( lt.x / 64.0 + 0.001 );
vD37Z = d37zn;
vec4 d37l = clamp( vec4( lt.x - 64.0 * d37zn, lt.yzw ) / 60.0, 0.0, 1.0 );
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
vUvL.xy = mod( vd.xy, 32.0 ) / 16.0;${simple ? '' : `
vec2 d37q = floor( vd.xy / 32.0 );
vWD = vec4( mod( d37q.x, 32.0 ), floor( d37q.x / 32.0 ), mod( d37q.y, 32.0 ), floor( d37q.y / 32.0 ) ) / 3.0;
vWS = mod( floor( d37w / 64.0 ), 16.0 );`}
#endif
#ifdef D37_WAVE
if ( d37f > 0.5 && d37f < 1.5 ) {
  vec2 d37sw = d37Sway( d37wp.xyz );
  transformed.x += d37sw.x;
  transformed.z += d37sw.y;
}
#endif
if ( d37f > 2.5 ) {   // пламя факела (T-096a): верх «танцует»; в чанке 16 единиц на блок, у вещи — 1
  float d37fp = d37wp.x * 7.13 + d37wp.z * 5.27;
#if defined( D37_FP ) || defined( D37_ACT )
  float d37fa = 0.0625;
#else
  float d37fa = 1.0;
#endif
  transformed.y += ( 0.55 * sin( uTime * 11.0 + d37fp ) + 0.35 * sin( uTime * 17.3 + d37fp * 1.7 ) ) * 0.55 * uFlick * d37fa;
  transformed.x += sin( uTime * 8.3 + d37fp * 1.3 ) * 0.28 * uFlick * d37fa;
  transformed.z += cos( uTime * 9.1 + d37fp * 0.7 ) * 0.28 * uFlick * d37fa;
}
#ifdef D37_TEXFX
vD37W = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vD37F = floor( vd.z / 4096.0 );
vD37C = vD37W - d37N( vD37F ) * 0.5;
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
varying float vD37Z;
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
  // «Живые» текстуры (T-096a; D37_TEXFX — только WebGL2 и не простой режим; страж графики может выключить: ключ kbtex): у слоя
  // флаги uLF (r — биты: 1 поворот картинки в клетке на четверть по хешу места, 2 течёт (лава), 4 блёстки; g — сила рельефа / 1,5;
  // b, a — низ и верх яркости рисунка — высота рельефа растягивается на 0…1); uLFP: x — число слоёв, zw — сдвиг начала координат
  // по модулю 256 (поворот клетки не меняется при переезде сцены). Поворот: картинка внутри клетки, производные для мипов — те же,
  // повёрнутые (textureGrad: без «шва» на краю клетки). Рельеф (D37_POM): глубина картинки по её яркости — луч в глубь грани
  // D37_POMN шагами + уточнение; только твёрдые блоки, близко (uPom: x — глубина, y…z — затухание по расстоянию), не у вещей
  const FS_TEXFX = `
#ifdef D37_TEXFX
uniform sampler2D uLF;
uniform vec4 uLFP;
uniform vec4 uPom;
varying vec3 vD37C;
varying vec3 vD37W;
varying float vD37F;
float d37hash( vec3 p ) { vec3 q = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
vec2 d37R( vec2 uv, float q ) {
  vec2 i = floor( uv ), f = uv - i;
  if ( q > 2.5 ) f = vec2( f.y, 1.0 - f.x ); else if ( q > 1.5 ) f = 1.0 - f; else if ( q > 0.5 ) f = vec2( 1.0 - f.y, f.x );
  return i + f;
}
vec2 d37RG( vec2 g, float q ) { return q > 2.5 ? vec2( g.y, - g.x ) : q > 1.5 ? - g : q > 0.5 ? vec2( - g.y, g.x ) : g; }
#endif`;
  const FS_POMH = `
#ifdef D37_POM
float d37Hq( vec2 cell, float q, float l, vec2 r, float inv ) {
  vec4 c = textureLod( uTex, vec3( d37R( ( cell + 0.5 ) / uLFP.y, q ), l ), 0.0 );
  float h = clamp( ( dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) - r.x ) / max( r.y - r.x, 0.02 ), 0.0, 1.0 );
  h = mix( h, 1.0 - h, inv );
  return floor( h * 4.0 + 0.5 ) * 0.25;
}
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
#ifdef D37_TEXFX
  vec3 d37nm = textureGrad( uNTex, vec3( d37R( d37uv.xy, d37rq ), d37uv.z ), d37RG( d37gx, d37rq ), d37RG( d37gy, d37rq ) ).xyz * 2.0 - 1.0;
  d37nm.xy = d37RG( d37nm.xy, mod( 4.0 - d37rq, 4.0 ) );   // наклон картинки — обратно в оси клетки
#else
  vec3 d37nm = texture( uNTex, vUvL ).xyz * 2.0 - 1.0;
#endif
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
  // (строку сдвига текстуры воды ищет крючок льда kubomir-weather.js — менять вместе с ним; d37IceK — сколько льда, его ставит
  // тот же крючок; d37dl — солнце/луна с тенью, его копит свет three: кусок lights_fragment_begin воды)
  const FS_MAP = `
vec3 d37uv = vUvL;
float d37glint = 0.0;
#ifdef D37_WATER
float d37IceK = 0.0;
vec3 d37dl = vec3( 0.0 );
d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );
#endif
#ifdef D37_TEXFX
vec4 d37lf = texture2D( uLF, vec2( ( vUvL.z + 0.5 ) / uLFP.x, 0.5 ) );
float d37bits = floor( d37lf.r * 255.0 + 0.5 ), d37rq = 0.0;
#if !defined( D37_FP ) && !defined( D37_ACT )
if ( mod( d37bits, 2.0 ) > 0.5 ) d37rq = floor( d37hash( mod( floor( vD37C ) + vec3( uLFP.z, 0.0, uLFP.w ), 256.0 ) ) * 3.999 );
#endif
if ( mod( floor( d37bits * 0.5 ), 2.0 ) > 0.5 ) d37uv.xy += uTime * vec2( 0.017, 0.029 );
vec2 d37gx = dFdx( d37uv.xy ), d37gy = dFdy( d37uv.xy );
float d37pk = 1.0;
#if defined( D37_POM ) && !defined( D37_FP ) && !defined( D37_ACT )
{
  float d37ps = d37lf.g * 1.5 * uPom.x * ( 1.0 - smoothstep( uPom.y, uPom.z, length( vViewPosition ) ) );
  if ( d37ps > 0.0005 && vD37F < 5.5 ) {
    vec3 d37T = vec3( 1.0, 0.0, 0.0 ), d37B = vec3( 0.0, - 1.0, 0.0 ), d37N3 = vec3( 0.0, 0.0, 1.0 );
    if ( vD37F < 0.5 ) { d37T = vec3( 0.0, 0.0, - 1.0 ); d37N3 = vec3( 1.0, 0.0, 0.0 ); }
    else if ( vD37F < 1.5 ) { d37T = vec3( 0.0, 0.0, 1.0 ); d37N3 = vec3( - 1.0, 0.0, 0.0 ); }
    else if ( vD37F < 2.5 ) { d37B = vec3( 0.0, 0.0, 1.0 ); d37N3 = vec3( 0.0, 1.0, 0.0 ); }
    else if ( vD37F < 3.5 ) { d37B = vec3( 0.0, 0.0, 1.0 ); d37N3 = vec3( 0.0, - 1.0, 0.0 ); }
    else if ( vD37F > 4.5 ) { d37T = vec3( - 1.0, 0.0, 0.0 ); d37N3 = vec3( 0.0, 0.0, - 1.0 ); }
    vec3 d37V3 = normalize( cameraPosition - vD37W );
    // сдвиг на всю глубину — в клетках рисунка; вскользь не больше ~2,5 глубины (иначе рисунок «размазывается»)
    vec2 d37dir = - vec2( dot( d37V3, d37T ), dot( d37V3, d37B ) ) / ( max( dot( d37V3, d37N3 ), 0.0 ) + 0.25 ) * d37ps * uLFP.y;
    vec2 d37p = d37uv.xy * uLFP.y, d37cl = floor( d37p ), d37sg = sign( d37dir ), d37as = abs( d37sg );
    vec2 d37iv = 1.0 / max( abs( d37dir ), vec2( 1e-4 ) );
    vec2 d37tm = d37as * ( ( d37cl + max( d37sg, 0.0 ) - d37p ) * d37sg * d37iv ) + ( 1.0 - d37as ) * 1e4;
    vec2 d37td = d37as * d37iv + ( 1.0 - d37as ) * 1e4;
    float d37iv2 = step( 7.5, mod( d37bits, 16.0 ) );
    float d37h = d37Hq( d37cl, d37rq, d37uv.z, d37lf.ba, d37iv2 ), d37t = 1.0 - d37h, d37sd = 0.0, d37dn = step( 0.999, d37h );
    if ( d37dn > 0.5 ) d37t = 0.0;
    for ( int i = 0; i < D37_POMN; i ++ ) {
      if ( d37dn < 0.5 ) {
        float d37tn = min( d37tm.x, d37tm.y );
        if ( 1.0 - d37h <= d37tn ) { d37t = 1.0 - d37h; d37dn = 1.0; }   // опустился до верха этой клетки внутри неё
        else {
          if ( d37tm.x < d37tm.y ) { d37cl.x += d37sg.x; d37tm.x += d37td.x; } else { d37cl.y += d37sg.y; d37tm.y += d37td.y; }
          d37h = d37Hq( d37cl, d37rq, d37uv.z, d37lf.ba, d37iv2 );
          if ( d37h >= 1.0 - d37tn ) { d37t = d37tn; d37sd = 1.0; d37dn = 1.0; }   // упёрся в бок соседнего столбика
          else d37t = 1.0 - d37h;
        }
      }
    }
    vec2 d37q = d37p + d37dir * d37t;
    if ( d37sd > 0.5 ) d37q = clamp( d37q, d37cl + 0.002, d37cl + 0.998 );   // точка на стенке — в клетке столбика (его цвет)
    d37uv.xy = d37q / uLFP.y;
    d37pk = d37sd > 0.5 ? 0.7 + 0.15 * d37h : 0.8 + 0.2 * ( 1.0 - d37t );   // стенки и глубина темнее
  }
}
#endif
vec4 d37c = textureGrad( uTex, vec3( d37R( d37uv.xy, d37rq ), d37uv.z ), d37RG( d37gx, d37rq ), d37RG( d37gy, d37rq ) );
if ( mod( floor( d37bits * 0.25 ), 2.0 ) > 0.5 ) {   // блёстки: яркий цветной пиксель (жила руды) вспыхивает на миг, у каждого — своё время
  float d37sat = max( max( d37c.r, d37c.g ), d37c.b ) - min( min( d37c.r, d37c.g ), d37c.b );
  float d37gh = d37hash( vec3( floor( d37R( d37uv.xy, d37rq ) * uLFP.y ), floor( vUvL.z ) ) );
  d37glint = pow( max( 0.0, sin( uTime * ( 1.7 + d37gh * 1.3 ) + d37gh * 6.2832 ) ), 32.0 ) * smoothstep( 0.12, 0.3, d37sat );
}
d37c.rgb *= d37pk;
#else
vec4 d37c = d37Tex( d37uv );
#endif
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
totalEmissiveRadiance += diffuseColor.rgb * vEm * uEmK;
totalEmissiveRadiance += diffuseColor.rgb * d37glint * 2.2;`;
  // свечение (bloom) у светящихся граней — метка в альфе, как у R.bloom движка (только на «высокой»: uBloomK > 0)
  // (запись — целым вектором, без ветвления: так советует страж графики движка — меньше простора драйверу ошибиться)
  const FS_BLOOM = `
#ifdef OPAQUE
gl_FragColor = vec4( gl_FragColor.rgb, ( uBloomK > 0.0 && vEm > 0.01 ) ? 1.0 + vEm * uBloomK : gl_FragColor.a );
#endif`;
  // существа и вещи (человечки, мобы, вещи в мире и в руках) — код 0,5 в альфе буфера сцены, пока рисуется кадр с отражениями
  // (E.GFXU.rt[1] = 1, post.js): отражения в экране (вода, лёд) их не показывают — «призрак» человечка под гладью читался как
  // «он под водой» (жалоба владельца 22.10, T-019). Светящееся (альфа > 1 — свечение) не трогаем. Небо и блоки отражаются как были
  const FS_ACT = `
#ifdef OPAQUE
gl_FragColor = vec4( gl_FragColor.rgb, ( uD37Act.y > 0.5 && gl_FragColor.a <= 1.0001 ) ? 0.5 : gl_FragColor.a );
#endif`;
  const ACT0 = new Float32Array(4);
  // руки и вещи «из глаз» (D37_FP): код травы движка в альфе (E.FOLIAGE_A), пока AO включён, — AO и контактные тени их не считают
  // заслонкой: глубина «из глаз» сжата к камере, и вокруг руки у стены было тёмное кольцо (T-096a). Только альфа — цвет тот же
  const FS_FPAO = u => `
#ifdef OPAQUE
gl_FragColor = vec4( gl_FragColor.rgb, ${u}.z > 0.5 ? ${(E.FOLIAGE_A || (1 + 4 / 1024)).toFixed(8)} : gl_FragColor.a );
#endif`;
  // вырезное по альфе (листва, трава, цветы, факелы, стекло) — код травы движка (E.FOLIAGE_GLSL после output_fragment, uniform
  // d37Rt = E.GFXU.rt): AO и контактные тени его не учитывают — без тёмных пятен вокруг травинок; флаг ставит движок (post.js)
  const foliageGLSL = () => typeof E.FOLIAGE_GLSL === 'string' && E.GFXU?.rt ? E.FOLIAGE_GLSL : '';
  // ── Вода (T-044, 22.10.2026; владелец: «и что за вода?» — плоская ядовито-синяя гладь с косыми полосами, у берега не видно дна,
  // ночью «пластик»). Только не в простом режиме (простой — текстура × цвет биома, как раньше).
  // Цвет: толща воды — цвет биома (сетка: океан глубокий синий, река светлее, болото зеленовато-бурое; чем зеленее — тем мутнее),
  // приглушённый; её освещает тот же свет, что кубики (солнце с тенью, небо, факелы, в пещере темно) — ночью вода тёмная, не неон.
  // Прозрачность: глубина под гладью (сетка: 4 угла грани, билинейно) по пути преломлённого луча — у берега видно дно, глубже —
  // темнее и мутнее (как туман цветом воды). Волны: карта нормалей uWN (128², мип-уровни — вдали волны сами гаснут, без «муара»)
  // двумя слоями под углом к осям; вдали и под острым углом — ещё спокойнее. Отражение: небо по Френелю — модель неба движка
  // (зенит → горизонт, с погодой — как у купола; вдали вода сама уходит в туман «Кубомира»: биом, непогода, пещера), заря у
  // солнца, свет факелов; в пещере (свет неба 0) неба в воде нет; блик солнца/луны — по d37dl (свет three с тенью: в тени дерева блика нет),
  // шире вдали (Токсвиг). Пена — у берега (биты сетки) с разрывами по высоте волн, мягко. Лёд (крючок kubomir-weather.js,
  // d37IceK) — без волн, пены и прозрачности. Итог — «предумноженный» цвет и покрытие: дно за водой гаснет ровно на (1 − F)·T.
  // uWP: x — сила волн, y — блеск (степень), z — пена, w — средняя яркость текстуры воды (лёгкий рисунок вблизи).
  // Числа без NaN: нормализуем только ненулевое, pow — от неотрицательного, деление — на max(…).
  const FS_WHEAD = `
#ifdef D37_WATER
varying vec4 vWD;
varying float vWS;
uniform sampler2D uWN;
uniform vec3 uZenC;
uniform vec3 uHorC;
uniform vec3 uSunW;
uniform vec3 uGlow;
uniform vec4 uWP;
#endif`;
  // до света: толща воды (цвет биома), глубина в пикселе, мутность
  const FS_WCOL = `
#ifdef D37_WATER
vec2 d37wq = clamp( vUvL.xy, 0.0, 1.0 );
float d37dep = mix( mix( vWD.x, vWD.y, d37wq.x ), mix( vWD.z, vWD.w, d37wq.x ), d37wq.y );
vec3 d37wt = vColor * vColor;
float d37wl = dot( d37wt, vec3( 0.2126, 0.7152, 0.0722 ) );
float d37mk = 1.0 - smoothstep( 0.4, 0.62, d37wt.b / max( d37wt.r + d37wt.g + d37wt.b, 0.001 ) );
float d37dist = length( vViewPosition );
float d37tx = ( dot( d37c.rgb, vec3( 0.3333 ) ) - uWP.w ) * ( 1.0 - smoothstep( 4.0, 14.0, d37dist ) );
diffuseColor = vec4( max( mix( vec3( d37wl ), d37wt, mix( 0.7, 0.85, d37mk ) ) * mix( 0.18, 0.5, d37mk ), vec3( 0.003 ) ) * ( 1.0 + 0.5 * d37tx ), diffuseColor.a );
#endif
#include <alphamap_fragment>`;
  // после света: волны, отражение, блик, прозрачность по глубине, пена
  const FS_WATER = `
#ifdef D37_WATER
{
  vec3 d37V = normalize( vViewPosition );
  vec3 d37up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float d37fl = smoothstep( 0.5, 0.9, dot( geometryNormal, d37up ) );
  float d37cv = clamp( dot( geometryNormal, d37V ), 0.0, 1.0 );
  float d37wk = uWP.x * d37fl * ( 1.0 - d37IceK ) * mix( 1.0, 0.3, smoothstep( 10.0, 64.0, d37dist ) ) * ( 0.25 + 0.75 * smoothstep( 0.05, 0.5, d37cv ) );
  vec2 d37p = vWp.xz;
  vec4 d37ta = texture2D( uWN, vec2( 2.0 * d37p.x + d37p.y, 2.0 * d37p.y - d37p.x ) * 0.0625 + uTime * vec2( 0.011, 0.007 ) );
  vec3 d37na = d37ta.xyz * 2.0 - 1.0;
  vec2 d37g = vec2( 2.0 * d37na.x - d37na.y, d37na.x + 2.0 * d37na.y ) * 0.4472;
  float d37len = length( d37na );
  float d37hh = d37ta.w;
#ifdef D37_WQ2
  vec4 d37tb = texture2D( uWN, vec2( 4.0 * d37p.x - 3.0 * d37p.y, 3.0 * d37p.x + 4.0 * d37p.y ) * 0.0625 + uTime * vec2( -0.019, 0.023 ) );
  vec3 d37nb = d37tb.xyz * 2.0 - 1.0;
  d37g = d37g * 0.8 + vec2( 4.0 * d37nb.x + 3.0 * d37nb.y, 4.0 * d37nb.y - 3.0 * d37nb.x ) * 0.11;
  d37len = min( d37len, length( d37nb ) );
  d37hh = d37hh * 0.55 + d37tb.w * 0.45;
#endif
  vec3 d37nw = normalize( vec3( d37g.x * d37wk, 1.0, d37g.y * d37wk ) );
  vec3 d37n = normalize( mix( geometryNormal, ( viewMatrix * vec4( d37nw, 0.0 ) ).xyz, d37fl ) );
  // отражение неба по Френелю (вода: F0 = 0,02)
  float d37ci = clamp( dot( d37n, d37V ), 0.0, 1.0 );
  float d37F = ( 0.02 + 0.98 * pow( 1.0 - d37ci, 5.0 ) ) * ( 1.0 - 0.3 * d37mk );   // мутная (болото) — тусклее
  vec3 d37rw = ( vec4( reflect( - d37V, d37n ), 0.0 ) * viewMatrix ).xyz;
  vec3 d37refl = ( mix( uHorC, uZenC, pow( clamp( d37rw.y, 0.0, 1.0 ), 0.55 ) ) + uGlow * pow( max( dot( d37rw, uSunW ), 0.0 ), 6.0 ) ) * vLt.x + vLt.yzw * 0.2;
  // блик солнца (ночью — луны): свет three с тенью (d37dl, со множителем π старого света three), шире там, где волны мельче пикселя
  vec3 d37L = normalize( ( viewMatrix * vec4( uSunW, 0.0 ) ).xyz );
  vec3 d37Hs = d37L + d37V;
  vec3 d37H = d37Hs * inversesqrt( max( dot( d37Hs, d37Hs ), 1e-8 ) );
  float d37pw = max( uWP.y / ( 1.0 + uWP.y * clamp( 1.0 - d37len - 0.006, 0.0, 1.0 ) ), 8.0 );   // Токсвиг; ±0,006 — 8 бит текстуры, не волны
  float d37fh = 0.02 + 0.98 * pow( 1.0 - clamp( dot( d37H, d37V ), 0.0, 1.0 ), 5.0 );
  float d37sp = pow( max( dot( d37n, d37H ), 0.0 ), d37pw ) * ( d37pw + 8.0 ) * 0.0398 * d37fh * 0.3183 * step( 0.0, dot( geometryNormal, d37L ) );
  vec3 d37gl = d37dl * ( d37sp * vLt.x * ( 1.0 - 0.7 * d37IceK ) );
  // дно: свет гаснет по пути преломлённого луча; лёд — непрозрачный
  float d37ct = sqrt( max( 1.0 - ( 1.0 - d37cv * d37cv ) * 0.5653, 0.0 ) );
  float d37T = mix( exp( - mix( 0.3, 1.6, d37mk ) * d37dep / max( d37ct, 0.25 ) ), 0.03, d37IceK );
  // пена у берега (биты углов грани → билинейно), рваная по высоте волн, чуть «дышит»
  float d37k = floor( vWS + 0.5 );
  vec4 d37sb = vec4( mod( d37k, 2.0 ), mod( floor( d37k * 0.5 ), 2.0 ), mod( floor( d37k * 0.25 ), 2.0 ), floor( d37k * 0.125 ) );
  float d37sh = mix( mix( d37sb.x, d37sb.y, d37wq.x ), mix( d37sb.z, d37sb.w, d37wq.x ), d37wq.y );
  float d37fo = smoothstep( 0.6, 1.0, d37sh + ( d37hh - 0.5 ) * 0.8 + 0.08 * sin( uTime * 1.25664 + d37hh * 6.2832 ) ) * d37fl * ( 1.0 - d37IceK ) * uWP.z
    * ( 1.0 - 0.7 * d37sb.x * d37sb.y * d37sb.z * d37sb.w ) * ( 1.0 - 0.6 * d37mk );   // канал в блок, лужица, болото — пены меньше
  // предумноженный цвет и покрытие (свет толщи — что посчитал Ламберт с нашим светом; облучённость — для пены)
  vec3 d37in = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 d37pm = d37F * d37refl + ( 1.0 - d37F ) * ( 1.0 - d37T ) * d37in;
  float d37al = 1.0 - ( 1.0 - d37F ) * d37T;
  d37pm = mix( d37pm, d37in / max( diffuseColor.rgb, vec3( 0.003 ) ) * 0.8, d37fo );
  d37al = mix( d37al, 1.0, d37fo );
  d37pm += d37gl;
  d37al = clamp( d37al + dot( d37gl, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );
  reflectedLight.directDiffuse = vec3( 0.0 );
  reflectedLight.indirectDiffuse = d37pm / max( d37al, 0.004 );
  totalEmissiveRadiance = vec3( 0.0 );
  diffuseColor = vec4( diffuseColor.rgb, d37al );
}
#endif`;
  // существа (Ламберт / мультяшный / Фонг world3d, коробки мобов): тот же свет, что у кубиков, но одним значением на всё
  // существо (uD37L — небо и цветной свет блоков в его клетке, плавно); солнце и небо — по «свету неба», лампы движка — везде,
  // свет блоков — своим цветом; у «плоских» (MeshBasic: глаза, блики) — просто яркость
  const ENT_FS_HEAD = `
uniform vec4 uD37L;
uniform vec4 uD37Act;
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
      V.painted = all; all.names = V.tex.map(t => t.name);   // T-049: готовые рисунки слоёв — значкам и мини-карте (V.layerPixels)
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
      // «живые» текстуры: флаги слоёв (по имени: V.texFx) и низ/верх яркости рисунка (5 % и 95 %, линейно — как читает шейдер)
      if (U.uLF.value) U.uLF.value.dispose();
      const lfd = new Uint8Array(L * 4), lum = new Float32Array(TS * TS);
      all.forEach((d, l) => {
        const fx = V.texFx ? V.texFx(V.tex[l].name) : { rot: false, flow: false, glint: false, pom: 0 };
        lfd[l * 4] = (fx.rot ? 1 : 0) | (fx.flow ? 2 : 0) | (fx.glint ? 4 : 0) | (fx.inv ? 8 : 0);
        lfd[l * 4 + 1] = Math.round(fx.pom / 1.5 * 255);
        let n = 0;
        if (fx.pom > 0) for (let i = 0; i < TS * TS; i++) if (d[i * 4 + 3] > 127) lum[n++] = .2126 * Math.pow(d[i * 4] / 255, 2.2) + .7152 * Math.pow(d[i * 4 + 1] / 255, 2.2) + .0722 * Math.pow(d[i * 4 + 2] / 255, 2.2);
        if (n > 8) { const a = lum.subarray(0, n).sort(), lo = Math.min(249, Math.round(a[Math.floor(n * .05)] * 255)); lfd[l * 4 + 2] = lo; lfd[l * 4 + 3] = Math.min(255, Math.max(lo + 6, Math.round(a[Math.floor(n * .95)] * 255))); }
        else { lfd[l * 4 + 2] = 0; lfd[l * 4 + 3] = 255; }
      });
      const lft = new T.DataTexture(lfd, L, 1, T.RGBAFormat, T.UnsignedByteType);
      lft.magFilter = lft.minFilter = T.NearestFilter; lft.generateMipmaps = false; lft.needsUpdate = true;
      U.uLF.value = lft; U.uLFP.value.x = L; U.uLFP.value.y = TS;
      // вода: средняя яркость её рисунка (линейная, как читает шейдер) — рисунок вблизи лишь чуть светлее/темнее толщи
      const wi = V.texIdx?.get('water'), wd = wi != null ? all[wi] : null;
      if (wd) { let s = 0; for (let i = 0; i < wd.length; i += 4) s += (Math.pow(wd[i] / 255, 2.2) + Math.pow(wd[i + 1] / 255, 2.2) + Math.pow(wd[i + 2] / 255, 2.2)) / 3; U.uWP.value.w = s / (wd.length / 4); }
    }
    // Волны воды — карта нормалей 128² (RGB — нормаль, A — высота: пена рвётся по гребням): сумма 20 волн с целыми частотами
    // (повторяется без шва), направления вразброс; производные — точные. Мип-уровни (усреднённые нормали короче — по ним блик
    // вдали шире) — сами
    function waterNormals(){
      const N = 128, d = new Uint8Array(N * N * 4), rnd = V.rng(0x77a7e5), W = [], used = new Set();
      while (W.length < 20) {
        const kx = Math.round((rnd() * 2 - 1) * 7), ky = Math.round((rnd() * 2 - 1) * 7), r2 = kx * kx + ky * ky;
        if (r2 < 2 || r2 > 49 || used.has(kx * 16 + ky) || used.has(-kx * 16 - ky)) continue;
        used.add(kx * 16 + ky);
        W.push([kx, ky, rnd() * 6.2832, Math.pow(r2, -.75) * (.75 + .5 * rnd())]);
      }
      const h = new Float32Array(N * N), gx = new Float32Array(N * N), gy = new Float32Array(N * N);
      let lo = 1e9, hi = -1e9, g2 = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0, dx = 0, dy = 0;
        for (const [kx, ky, p, a] of W) { const ph = 6.283185 * (kx * x + ky * y) / N + p, c = Math.cos(ph); s += a * Math.sin(ph); dx += a * kx * c; dy += a * ky * c; }
        const i = y * N + x; h[i] = s; gx[i] = dx; gy[i] = dy; g2 += dx * dx + dy * dy;
        if (s < lo) lo = s; if (s > hi) hi = s;
      }
      const k = .4 / Math.sqrt(g2 / (N * N));   // средний наклон волн ≈ 0,4
      for (let i = 0; i < N * N; i++) {
        const tx = -gx[i] * k, ty = -gy[i] * k, il = 1 / Math.hypot(tx, ty, 1), o = i * 4;
        d[o] = Math.round((tx * il * .5 + .5) * 255); d[o + 1] = Math.round((ty * il * .5 + .5) * 255); d[o + 2] = Math.round((il * .5 + .5) * 255);
        d[o + 3] = Math.round((h[i] - lo) / (hi - lo) * 255);
      }
      const t = new T.DataTexture(d, N, N, T.RGBAFormat, T.UnsignedByteType);
      t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.anisotropy = aniso(); t.needsUpdate = true;
      return t;
    }
    const WQ = R.q === 'low' ? 0 : 1;   // «низкая»: один слой волн, без пены
    const U = { uTex: { value: null }, uAtlasN: { value: 1 }, uTS: { value: V.TEX || 16 }, uNTex: { value: null }, uNStr: { value: .75 }, uTime: { value: 0 }, uFlick: { value: 1 }, uMinAmb: { value: .055 }, uBlockK: { value: 1.7 }, uEmK: { value: 1.25 },
      uDay: { value: 1 }, uBloomK: { value: 0 }, uSway: { value: 1 }, uD37Wind: { value: E.GFXU?.wind || new Float32Array([0, 0, .8, .6]) },
      uSunV: { value: new T.Vector3(0, 1, 0) }, uSunC: { value: new T.Color(0, 0, 0) }, uSkyC: { value: new T.Color(.5, .6, .8) },
      // вода: карта нормалей, небо (зенит, горизонт — модель неба движка с погодой), направление на солнце/луну (мир), свечение у
      // солнца на заре; uWP — сила волн, блеск, пена, средняя яркость рисунка воды
      uWN: { value: null }, uZenC: { value: new T.Color(.2, .38, .78) }, uHorC: { value: new T.Color(.62, .72, .86) }, uSunW: { value: new T.Vector3(0, 1, 0) },
      uGlow: { value: new T.Color(0, 0, 0) }, uWP: { value: new T.Vector4(WQ ? .42 : .36, 900, WQ ? .5 : 0, .8) },
      // погода по климатическим зонам (кусок D37_CLIM движка, D37_VOXZ): x — снег в «всегда зима», y, z — мокрое и лужи в «зимы
      // нет» (снега там нет), w — 1: зоны учитываются (0 — всё как обычная зона; ставит игра)
      d37ClZ: { value: new Float32Array([0, 0, 0, 0]) },
      // «живые» текстуры (T-096a): флаги слоёв, число слоёв и сдвиг начала координат по модулю 256, рельеф (глубина, затухание)
      uLF: { value: null }, uLFP: { value: new T.Vector4(1, 0, 0, 0) }, uPom: { value: new T.Vector4(.05, 7, 16, 0) } };
    VR.U = U;
    U.uWN.value = waterNormals();
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
    // вода: солнце/луна уже с тенью — копим цвет направленного света перед RE_Direct (блик в тени дерева гаснет); не нашли места
    // (другой three) — блика нет, остальное работает
    const DL_A = 'getDirectionalLightInfo( directionalLight, geometry, directLight );', DL_B = 'RE_Direct( directLight, geometry, material, reflectedLight );';
    const LFBW = (() => { const a = LFB2.indexOf(DL_A), b = a < 0 ? -1 : LFB2.indexOf(DL_B, a); return b < 0 ? '' : LFB2.slice(0, b) + 'd37dl += directLight.color;\n\t\t' + LFB2.slice(b); })();
    VR.waterLight = !!LFBW;
    const LAYERS = V.LAYERS || ['solid', 'cutout', 'water', 'foliage', 'glass'];
    const shaderHooks = new Map();   // слой | '*' → [{ id, fn }]
    const hookKey = kind => [...(shaderHooks.get(kind) || []), ...(shaderHooks.get('*') || [])].map(h => h.id).join(',');
    VR.onShader = (layer, fn, id) => {
      if (typeof fn !== 'function') return () => {};
      const h = { id: String(id || 'h' + (++hookSeq)), fn };
      if (!shaderHooks.has(layer)) shaderHooks.set(layer, []);
      shaderHooks.get(layer).push(h);
      const all = () => [...Object.values(mats), ...Object.values(fpMats), ...Object.values(actMats)];
      for (const m of all()) m.needsUpdate = true;
      return () => { const a = shaderHooks.get(layer) || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); for (const m of all()) m.needsUpdate = true; };
    };
    let hookSeq = 0;
    function patch(m, kind){
      const simple = VR.safe;
      // код травы в альфе: вырезное по альфе — всегда; «из глаз» (D37_FP — define ставят после patch, поэтому — при сборке)
      const folOf = () => !simple && ((LAYER_OPTS[kind] || {}).alphaTest || (!!m.defines?.D37_FP && !!E.GFXU?.rt)) ? foliageGLSL() : '';
      m.onBeforeCompile = sh => {
        const FOL = folOf();
        Object.assign(sh.uniforms, U);
        if (FOL) sh.uniforms.d37Rt = { value: E.GFXU.rt };
        const ACT = !simple && !!m.defines?.D37_ACT;
        if (ACT) sh.uniforms.uD37Act = { value: E.GFXU?.rt || ACT0 };
        // #include — только с новой строки (иначе шейдер не собирается)
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + VS_HEAD + (simple ? '' : VS_WHEAD))
          .replace('#include <beginnormal_vertex>', VS_NORMAL)
          .replace('#include <begin_vertex>', VS_BEGIN(simple))
          .replace('#include <project_vertex>', VS_FP);
        let fs = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FS_COMMON + (simple ? '' : FS_WHEAD) + (FOL ? '\nuniform vec4 d37Rt;' : '') + (ACT ? '\nuniform vec4 uD37Act;' : '') + (simple ? '' : FS_TEXFX) + (gl2 ? FS_TEX2 + (simple ? '' : FS_POMH) : FS_TEX1))
          .replace('#include <map_fragment>', FS_MAP)
          .replace('#include <color_fragment>', FS_COLOR)
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FS_LIGHT + (simple ? '' : FS_WATER));
        if (!simple && kind === 'water') fs = fs.replace('#include <alphamap_fragment>', FS_WCOL);
        if (LFB2 && !simple) fs = fs.replace('#include <lights_fragment_begin>', kind === 'water' && LFBW ? LFBW : LFB2);
        if (!simple) fs = fs.replace('#include <normal_fragment_maps>', FS_NMAP);
        if (FOL) fs = fs.replace('#include <output_fragment>', '#include <output_fragment>\n' + FOL);
        if (!simple) fs = fs.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FS_BLOOM + (ACT ? FS_ACT : ''));
        sh.fragmentShader = fs;
        // куски движка (паки шейдеров): после наших; ошибка в куске — без него (кубики важнее)
        if (!simple) for (const h of [...(shaderHooks.get(kind) || []), ...(shaderHooks.get('*') || [])]) {
          const v0 = sh.vertexShader, f0 = sh.fragmentShader;
          try { h.fn(sh, { layer: kind, gl2, material: m, fp: !!m.defines?.D37_FP }); } catch (e) { sh.vertexShader = v0; sh.fragmentShader = f0; console.warn('Кубомир: кусок шейдера «' + h.id + '» —', e); }
        }
      };
      m.customProgramCacheKey = () => 'd37vox7-' + kind + (gl2 ? '2' : '1') + (simple ? 's' : '') + (m.defines?.D37_FP ? 'f' : '') + (m.defines?.D37_ACT ? 'a' : '') + (folOf() ? 'F' : '') + (simple ? '' : hookKey(kind));
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
    const makeMat = (k, fp, act) => {
      const opt = LAYER_OPTS[k] || { alphaTest: .5 };
      const m = patch(new T.MeshLambertMaterial({ vertexColors: true, ...opt }), k);
      m.defines = { D37_VOX: 1, D37_VOXZ: 1, ['D37_' + k.toUpperCase()]: 1 };
      if (fp) m.defines.D37_FP = 1;
      if (act) m.defines.D37_ACT = 1;
      if (nmapOn() && k !== 'water') m.defines.D37_NMAP = 1;   // рельеф текстур — на «высокой» (WebGL2)
      fxDefines(m, k);
      if (k === 'water' && WQ) m.defines.D37_WQ2 = 1;   // вода: второй слой волн и пена (кроме «низкой»)
      m.userData.d37vox = { layer: k, cutout: !!opt.alphaTest, foliage: k === 'foliage', water: k === 'water', glass: k === 'glass', emissive: 'vertex', fp: !!fp };
      return m;
    };
    const makeMats = () => { const o = {}; for (const k of LAYERS) o[k] = makeMat(k); return o; };
    // «живые» текстуры и рельеф (T-096a): только WebGL2 и не простой режим; страж графики — ключ kbtex (post.js выключает при
    // тёмном кадре / «не числах» раньше своих кусков); рельеф — на компьютере, «высокая» (и «ультра»), V.POM / VR.setPom — выкл;
    // D37E.vox.TEXFX = false (до открытия мира) или VR.setTexFx(false) — шейдер кубиков ровно как был (откат одной строкой)
    const texFxOn = () => gl2 && !VR.safe && V.TEXFX !== false && !E.gfxSafe?.('kbtex');
    const POMN = 14;
    VR.pomUser = null;   // null — по качеству, true / false — вручную (проверки, ⚙️)
    const pomOn = () => texFxOn() && V.POM !== false && (VR.pomUser ?? (R.q === 'high' && !(E.isMobile?.())));
    function fxDefines(m, k){
      const d = m.defines, tfx = texFxOn() && k !== 'water', pom = tfx && k === 'solid' && pomOn();
      if (tfx) d.D37_TEXFX = 1; else delete d.D37_TEXFX;
      if (pom) { d.D37_POM = 1; d.D37_POMN = POMN; } else { delete d.D37_POM; delete d.D37_POMN; }
    }
    const allMats = () => [...Object.values(mats), ...Object.values(fpMats), ...Object.values(actMats)];
    function refx(){ for (const m of allMats()) { const k = m.userData.d37vox?.layer; if (k) { fxDefines(m, k); m.needsUpdate = true; } } }
    VR.setPom = on => { VR.pomUser = on == null ? null : !!on; refx(); return pomOn(); };
    VR.texFx = () => ({ on: texFxOn(), pom: pomOn() });
    VR.setTexFx = on => { V.TEXFX = !!on; refx(); };
    // для стража графики (post.js: E.vox.texFxActive / texFxDisable) — у последнего открытого мира; закрыли мир — убираем
    const fxActive = () => texFxOn(), fxDisable = () => VR.setTexFx(false);
    V.texFxActive = fxActive; V.texFxDisable = fxDisable;
    // вещь «из глаз» (в руке от 1-го лица): те же слои с D37_FP — по одной на слой, по первому запросу
    let fpMats = {};
    const fpMat = k => fpMats[k] || (fpMats[k] = makeMat(k, true));
    // вещь в мире и у человечка: те же слои с D37_ACT (в отражениях её нет — FS_ACT)
    let actMats = {};
    const actMat = k => actMats[k] || (actMats[k] = makeMat(k, false, true));
    // тень вырезного — по альфе текстуры (одна на слой; пересобирается с простым режимом)
    let depthMats = {};
    VR.depthMat = k => depthMat(k);   // тень по альфе для своих сеток в формате чанка (падающее дерево — kubomir-ents.js)
    function depthMat(k){
      if (!(LAYER_OPTS[k] || {}).alphaTest) return undefined;
      if (depthMats[k]) return depthMats[k];
      const m = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, alphaTest: .5 });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VSD_HEAD).replace('#include <begin_vertex>', VSD_BEGIN);
        // T-096a (владелец: «у цветов и травы нет нормальной тени»): альфа — с самого крупного уровня (без мип-уровней: вдали и
        // вскользь карта теней брала усреднённую альфу — стебли и лепестки «таяли»), тонкое (стебель в 1 тексель) — чуть толще
        // по уровню 1: тень по форме растения не пропадает в размытии теней. WebGL1 (атлас без мип-уровней) — как было
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vUvL;' + (gl2 ? FS_TEX2 : FS_TEX1))
          .replace('#include <map_fragment>', gl2 && V.SHADOW_DILATE !== false ? 'diffuseColor.a = max( textureLod( uTex, vUvL, 0.0 ).a, min( 1.0, textureLod( uTex, vUvL, 1.0 ).a * 1.4 ) );' : 'diffuseColor.a = d37Tex( vUvL ).a;');
      };
      m.customProgramCacheKey = () => 'd37voxdepth2-' + (gl2 ? '2' : '1') + (V.SHADOW_DILATE !== false ? 'd' : '');
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
      U.uLFP.value.z = ((ox % 256) + 256) % 256; U.uLFP.value.w = ((oz % 256) + 256) % 256;
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
      } else if (b && b.shape === V.SHAPE.torch && V.torchQuads && V.TORCH3D !== false) {
        // факел (T-096a): та же палочка с пламенем, что в мире (V.torchQuads), по картинке: низ палочки — низ вещи (−0,5), как у спрайта
        const layer = b.texf?.side ?? 0;
        V.torchQuads((Q, UVq, nrm, glow, flame) => quads.push(Q.map((p, k) => ({ p: [p[0] - .5, p[1] - .5, p[2] - .5], uv: [UVq[k][0], UVq[k][1]], layer, nrm, col: [255, 255, 255], gl: glow ? 15 : 0, fl: flame && (k === 1 || k === 2) ? 3 : 0 }))), true);
      } else {
        const layer = it?.texL ?? b?.texf?.side ?? 0, col = b && b.tint === V.TINT.grass ? [124, 189, 90] : [255, 255, 255];
        // плоская вещь — толщиной в 1/16 (как в Майнкрафте): лицо и спина по картинке, бока — по краю непрозрачных пикселей своим
        // цветом (слой «снег» почти белый — цвет даёт вершина; боковые грани шейдер затеняет сам). Без бортов вещь с ребра — чёрная нитка
        const th = it && !b ? 1 / 32 : 0, P = [[-.5, -.5, th], [-.5, .5, th], [.5, .5, th], [.5, -.5, th]], UV = [[0, 1], [0, 0], [1, 0], [1, 1]];
        quads.push(P.map((p, i) => ({ p, uv: UV[i], layer, nrm: 4, col })));
        quads.push([3, 2, 1, 0].map(i => ({ p: [P[i][0], P[i][1], th ? -th : -.001], uv: UV[i], layer, nrm: 5, col })));
        const tx = th ? V.tex[layer] : null, snow = V.texIdx?.get('snow');
        if (tx && snow != null) {
          const px = V.layerPixels(layer), n = Math.round(Math.sqrt(px.length / 4)), op = (x, y) => x >= 0 && y >= 0 && x < n && y < n && px[(y * n + x) * 4 + 3] > 100;
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
        pos.set(v.p, o * 3); vd[o * 4] = Math.round(v.uv[0] * 16); vd[o * 4 + 1] = Math.round(v.uv[1] * 16); vd[o * 4 + 2] = v.layer | (v.nrm << 12); vd[o * 4 + 3] = 3 | ((v.gl ?? glow) << 2) | ((v.fl || 0) << 14);
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
      const m = new T.Mesh(g, o?.fp ? fpMat(k) : actMat(k));
      if (!o?.fp) m.customDepthMaterial = depthMat(k);   // тень вещи (в руке, на земле) — по альфе картинки, а не квадратом (T-096a)
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
        sh.uniforms.uD37L = u; sh.uniforms.uMinAmb = U.uMinAmb; sh.uniforms.uBlockK = U.uBlockK; sh.uniforms.uDay = U.uDay; sh.uniforms.uD37Act = { value: E.GFXU?.rt || ACT0 };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + ENT_FS_HEAD)
          .replace('#include <lights_fragment_begin>', lfbEnt())
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + ENT_FS_LIGHT)
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FS_ACT + (fp ? FS_FPAO('uD37Act') : ''));   // в отражениях существ нет; «из глаз» — не заслонка AO
        if (fp) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', VS_FP);
      };
      const key0 = typeof src.customProgramCacheKey === 'function' ? String(src.customProgramCacheKey()) : '';
      m.customProgramCacheKey = () => 'd37ent3' + (lit ? 'L' : 'B') + (fp ? 'f' : '') + key0;
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
      const t = c.tint;   // обрушение (T-022a): светлые планки — цветом устойчивости (синий, зелёный, жёлтый, красный), тёмные — как были
      if (t) prevMat.color.setRGB(t[0], t[1], t[2]); else prevMat.color.setRGB(1, 1, 1);
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
      const old = mats, oldD = depthMats, oldF = fpMats, oldA = actMats;
      mats = VR.mats = makeMats(); depthMats = {}; fpMats = {}; actMats = {};   // actMats тоже заново (раньше вещи оставались со старым, несобравшимся шейдером)
      buildTextures();
      crackMat.fragmentShader = crackFS1; crackMat.needsUpdate = true;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) { m.material = ownMats[k] || mats[k]; m.customDepthMaterial = depthMat(k); } }
      for (const m of meshPool) m.material = mats.solid;
      const swap = new Map(LAYERS.map(k => [old[k], mats[k]]));
      for (const k in oldF) swap.set(oldF[k], fpMat(k));
      for (const k in oldA) swap.set(oldA[k], actMat(k));
      const dSwap = new Map(Object.entries(oldD).map(([k, m]) => [m, k]));
      R.scene.traverse(o => { if (o.isMesh && swap.has(o.material)) o.material = swap.get(o.material); if (o.isMesh && dSwap.has(o.customDepthMaterial)) o.customDepthMaterial = depthMat(dSwap.get(o.customDepthMaterial)); });
      for (const m of Object.values(old)) { R.waveMats?.delete?.(m); R.rtClear?.delete?.(m); m.dispose(); }
      regRt();
      for (const m of Object.values(oldF)) m.dispose();
      for (const m of Object.values(oldA)) m.dispose();
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
      // вода: небо для отражения — та же модель неба движка (с погодой и цветом тумана мира), что у купола; заря — свечение у солнца
      const M = R.sky;
      if (M?.hor) {
        U.uHorC.value.setRGB(M.hor[0], M.hor[1], M.hor[2]); if (M.zen) U.uZenC.value.setRGB(M.zen[0], M.zen[1], M.zen[2]);
        const g = M.glow, dk = M.dusk, dq = M.dusk01 || 0;
        if (g && dk) U.uGlow.value.setRGB(g[0] * .5 + dk[0] * dq * .6, g[1] * .5 + dk[1] * dq * .6, g[2] * .5 + dk[2] * dq * .6);
      }
      if (R.sunDir) U.uSunW.value.copy(R.sunDir);
      U.uDay.value = 1 - Math.max(0, Math.min(1, R.night || 0));
      U.uBloomK.value = R.q === 'high' && R.post ? .7 : 0;
      if (!VR.safe && checkN < 240) {
        checkN++;
        if ((checkN & 7) === 0 && LAYERS.some(k => failed(mats[k]))) {
          // не собралось: сначала без «живых» текстур (их кусок — новее всего; страж запомнит 'kbtex'), не помогло — простой режим
          if (texFxOn()) { R.guard?.off?.('kbtex', 'link', 'vox'); if (texFxOn()) VR.setTexFx(false); checkN = 0; }
          else goSafe();
        }
      }
    };
    VR.dispose = () => {
      if (V.texFxActive === fxActive) { V.texFxActive = null; V.texFxDisable = null; }
      for (const c of [...VR.chunks]) VR.dropChunk(c);
      for (const list of pool.values()) for (const g of list) g.dispose();
      pool.clear(); meshPool.length = 0;
      for (const m of Object.values(mats)) { R.rtClear?.delete?.(m); m.dispose(); }
      for (const m of Object.values(depthMats)) m.dispose();
      for (const m of Object.values(fpMats)) m.dispose();
      for (const m of Object.values(actMats)) m.dispose();
      tex?.dispose(); ntex?.dispose(); U.uWN.value?.dispose(); U.uLF.value?.dispose(); selGeo.dispose(); sel.material.dispose(); crack.geometry.dispose(); crackMat.dispose();
      R.scene.remove(sel); R.scene.remove(crack);
      if (ghost) { R.scene.remove(ghost); ghost.geometry?.dispose(); } ghostMat?.dispose();
      if (prev) R.scene.remove(prev); for (const g of prevGeo.values()) g.dispose(); prevGeo.clear(); prevMat.dispose();
    };
    return VR;
  };
})();
