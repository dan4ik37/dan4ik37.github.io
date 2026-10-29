# Планета — общий модуль движка `D37E.planet` (T-051): план и первый образец

Plan v1, 2026-10-22. Sources: `docs/superpowers/specs/2026-10-16-universe-design.md` (§3 техника, §9, §10), `docs/plans/kubomir-modpacks.md`
(§6.4 PlanetProfile, §7½ GPS-телефон после спутника и ретрансляторы), `docs/WORLD_MAP.md`, `docs/PHYSICS_PLAN.md`, `docs/SEASONS.md`,
CLAUDE.md («Движок D37E», «Мир Денчика» 3D, «Кубомир», «Подземье», «Студия 3D», мастер-инструкция).
Units: engine units **u** (1 m = `E.UNIT` = 1.1667 u). **(M)** = measured by the proof (§12); everything else is an estimate.

> Space, other planets, orbits with physics, satellites, meteors and terraforming are planned in docs/plans/planet-space.md (T-078). Mapping: PL-9 → PS-1; SP-1 → PS-1 + PS-2 + PS-4; SP-2 → PS-4 + PS-5; SP-3 → PS-6; SP-4 → PS-16.

## Для владельца (кратко, по-русски)
1. Сделали основу круглой планеты как ОБЩИЙ модуль движка (`D37E.planet`), а не код одной игры: его подключат «Мир Денчика», «Кубомир», «Подземье», «Студия 3D» и космос.
2. Планета грузится кусками: издалека — один шар, ближе — 6 граней, дальше каждая делится на 4, ещё на 4… до клеток в 3 м у ног. Остальное — только зерно и данные.
3. Под игроком держится «плоский кусок» (ровно как сейчас в «Мире»), он сам переезжает за игроком — ходьба, прыжки, машины, стройка и погода работают без переделки.
4. День и ночь — от вращения планеты (у каждого места своё время), времена года — по твоему календарю (зима — декабрь–февраль, ноябрь — осень).
5. Небо считается «как в жизни» (рассеяние света в воздухе), но дёшево — видно и с орбиты (голубой ореол, луна, звёзды), и с земли, без экранов загрузки.
6. Образец — скрытая страница /play/planet: с орбиты летишь вниз, садишься и бежишь своим персонажем. На слабом телефоне: 2–4 мс на кадр, до 73 вызовов, без рывков; 20 минут полёта — без ошибок, память не растёт.
7. Предлагаю родную планету радиусом ≈ 110 км (облёт на реактивном самолёте ≈ 20 мин, круг по орбите ≈ 8 мин); нынешняя карта «Мира» станет одним краем этой планеты, города останутся.
8. «Кубомир» — планеты из кубиков как новый тип мира (6 граней-сеток; обычный бесконечный мир остаётся); «Подземье» — мир по кругу + другие планеты на ракете.
9. Космос — потом: ракета, спутник (после него заработает GPS в телефоне, в пещерах — ретрансляторы), Луна.
10. Дальше — по шагам (§13): каждый шаг — отдельная задача с размером; первыми — доработка движка (без «прыжков» деталей, деревья и камни) и переходник «Мира Денчика».

## 0. Decisions (one line each; the owner can change any of them)
- One shared engine module family: `planet.js` (pure math and data: no three.js, no DOM — runs in node, in a Worker and on the page), `planet-worker.js` (chunk building), `planet-view.js` (three.js view). Games add thin adapters; no game owns planet code.
- A planet is **data** (PlanetProfile v1, §2.1), extending the Kubomir §6.4 contract instead of making a second space model.
- Terrain = cube-sphere quadtree (6 faces, equi-angular warp), chunk grid 32 × 32 quads, stitched edges + small skirts, chunks built in Workers, integrated on the page under a per-frame budget.
- All far data is procedural (seed + generator id + params); only player edits are stored, per region.
- Precision: planet math in double (JS numbers); the GPU sees only chunk-local float32 vertices and matrices relative to a **patch anchor** near the camera (floating origin). three.js multiplies `modelViewMatrix` in double on the CPU, which gives camera-relative precision for free.
- Gravity: the existing 2.5D physics and `player.js` stay unchanged. They run in a **local tangent patch** (x east, y up, z south) whose origin is a fixed **region anchor** (a quadtree node, ≈ 785 u on the home planet). Leaving the region rebases everything at a fixed-step boundary (same result on phone and PC).
- The ocean is part of the terrain mesh (vertices below sea level are lifted to sea level; the colour alpha carries the height near the coast, so the coastline is the 0.5 contour between vertices, smooth even on coarse chunks). No land/water z-fighting at planet-scale depth ranges on 24-bit depth.
- Day/night: rotation of the planet (sub-solar longitude moves with time). Seasons: declination from `climate.js` phase φ for the home planet (owner's calendar), from orbit phase for other planets.
- Atmosphere: single scattering, sun optical depth by the Chapman approximation (Schüler), evaluated per vertex (terrain, camera-centred sky dome, planet-centred shell for orbit), phase functions per fragment. No lookup tables; works on WebGL1 and phones.
- Home planet radius **128 000 u (≈ 110 km)** (table in §1.3). The current «Мир Денчика» map becomes one region of it (§10.1).
- Engine hand-off without editing `render.js`/`gfx.js`/`post.js`: while mounted, the view provides `E.sunAt` (the engine sky model, lights and reflections follow the real sun), hides the engine dome, sets the camera near/far each frame and keeps AO, screen-space reflections and frame generation off (their depth-based self-test would otherwise disable them permanently for the device). A formal hook in `gfx.js` and a two-range depth pass are PL-4.
- Proof page: hidden game `planet` (`/play/planet`, `GAMES_HIDDEN`), not in the catalog, search or records.

## 1. Goals, constraints, budgets

### 1.1 Goals
1. A round planet that streams in layers (galaxy → system → planet → faces → chunks → detail) and runs on a mid phone.
2. Fly from orbit to the ground and walk there with the existing controller, with no loading screen.
3. Day and night from rotation, seasons from tilt (and the owner's calendar on the home planet), visible moon and stars.
4. One module for many games: Мир, Кубомир (block planets), Подземье (2D wrap), Студия 3D (planet world type, planet parts), space path.

### 1.2 Constraints (master instruction)
Phone first; same gameplay on phone and PC (fixed step 1/60 s, rebase only between steps, nothing depends on frame rate); every change measured on the
phone profile (Chrome, CPU ×4 slower, «средняя»); no per-frame garbage in hot loops; no leaks after 20 open/close cycles; a fallback path on failure
(no Worker → budgeted main-thread builds; a Worker dies → its chunks go back to the queue; no WebGL → the page says so, the site lives).

### 1.3 Home planet size (decision with numbers)
| Radius (u) | ≈ km | Sea horizon at eye 2.1 u | Plane 48 u/s loop | Jet 600 u/s loop | Low orbit period (g = 20 U) | LOD levels (3 u spacing) | Мир map flat-facet error edge / corner | Patch tilt at 384 u |
|---|---|---|---|---|---|---|---|---|
| 32 000 | 27 | 367 u | 70 min | 5.6 min | 3.9 min | 10 | 148 / 295 u | 0.69° |
| **128 000** | **110** | **733 u** | 279 min | **22 min** | **7.8 min** | **12** | **37 / 74 u** | **0.17°** |
| 512 000 | 439 | 1466 u | 1117 min | 89 min | 15.5 min | 14 | 9 / 18 u | 0.04° |
The middle row keeps the existing map nearly flat, gives a ~20 min jet loop (spec §12: «облёт ~15–20 мин») and an 8 min orbit, and the horizon falls
where today's phone fog is (430–640 u). Moons and other planets: 16 000–64 000 u. LOD level count barely depends on the radius, so bigger planets
cost almost nothing more to render; they cost travel time.

### 1.4 Phone budgets (targets for v1 and what the proof measured, §12)
| Item | Target, phone (412 × 915, ×4 CPU, «средняя») | Proof, phone (M) | Target / proof, PC (1280 × 720, high) |
|---|---|---|---|
| Draw calls (whole frame; the character ≈ 18, sky + moon + stars 3) | ≤ 60 terrain | 17 orbit · 36 avg / 55 max descending · 64–73 on the ground | ≤ 120 / 21 · 66 · 122–140 |
| Whole frame CPU (logic + render) | ≤ 16 ms | 1.6 orbit · 2.4 descending · 4.0 on the ground (p95 2.6–6.3, max 26); 0 frames > 50 ms | ≤ 4 ms / 0.3–1.3 (max 3) |
| Planet update on the page | ≤ 1.5 ms | 0.02–0.14 ms avg (p95 ≤ 0.9); selection 1.2–1.3 ms avg, ≤ 6.4 ms max, ≤ 8 per second | ≤ 0.5 / 0.003–0.03; selection 0.3 |
| New chunks integrated per frame | ≤ 2 | 2 (0.14–0.17 ms avg each) | ≤ 4 / 4 (0.02 ms) |
| Chunk build in a Worker | ≤ 15 ms | 2.9–3.1 ms avg, 9 ms max on a PC core (Chrome does not slow Workers) → ≈ 12 ms on a phone | ≤ 4 ms / 3.1–3.4 avg |
| Chunk cache (GPU + JS copy) | ≤ 260 chunks ≈ 7 MB | 238–254 chunks ≈ 5.4–5.8 MB | ≤ 480 / 436–476 ≈ 9.9–10.8 MB |
| Memory over a long flight | flat | 20 min: 0 errors; JS heap after GC 22.5 → 25.1 MB, flat at 24–25 MB from minute 3 (LOD nodes pruned) | flat |

## 2. Module map and API

### 2.1 PlanetProfile v1 (data; validated by `D37E.planet.def(p)`, unknown fields kept for game adapters)
```js
{ v: 1, id: 'home', title: 'Родная планета', seed: 37,
  radius: 128000,                          // u, sea-level radius
  sea: 0,                                  // sea level above radius (u); null — no ocean
  gen: 'rocky1',                           // generator id in D37E.planet.GEN (rocky1, flat; later moon1, ice1, desert1, blocks, flatmap)
  relief: { amp: 2600, land: .42, hills: 140, detail: 7, warp: .35 },   // generator params (u; land share 0…1)
  atmo: { top: 32000, Hr: 4000, Hm: 800, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 } | null,   // null — airless
  air: true, o2: .21, pressure: 1,         // gameplay: breathing, suits (Kubomir §6.4 «air»)
  g: 1,                                    // gravity relative to the home planet (player.gravity × g, jumps scale)
  day: 2400, phase: 0,                     // rotation period (s of game time; = today's 40-min «Мир» day) and sub-solar longitude at t = 0
  tilt: 23.4, year: 'calendar',            // axial tilt (deg); 'calendar' = owner's calendar via climate.js, else seconds per year
  temp: 14,                                // mean °C: equator ≈ +28, 60° ≈ +3, poles ≈ −16, −6.5° per km of height
  orbit: { parent: 'sun', a: 4.0e9, e: 0, period: 'year', phase: 0 },   // on rails (PL-9); moons use parent: '<planet id>'
  moons: [{ id: 'luna', radius: 32000, dist: 2.4e6, period: 16800, phase: 1.1, incl: 5, tint: '#cfcfcf' }],
  sky: { stars: 1, sunSize: 1 },
  regions: [{ id: 'mir', lat: 43.2, lon: 76.9, yaw: 0, kind: 'flatmap', half: 3072 }],   // pinned game regions (§10.1, M1)
  hazards: [], mobs: [], requires: { rocket: 0 },                         // Kubomir §6.4 fields, same meaning
  games: { kubomir: { … }, podzem: { … } } }                             // per-game extensions (block palettes, 2D biomes)
```
Atmosphere numbers: Rayleigh scale height 4000 u (≈ 3.4 km), Earth-like colour ratios at half Earth's density, so the blue haze reaches ~30 km;
`top` = 8 scale heights.

### 2.2 API (★ = in the proof)
```js
const PL = D37E.planet;
PL.def(p) ★ · PL.HOME ★ · PL.create(def) → P ★ · PL.indices(N, mask) → shared stitched index buffer ★ · PL.chapman(X, h, mu) ★
P.height(x, y, z) — height above the radius at a unit direction ★ · P.surf(d, out) → { h, water, r, g, b } ★ · P.tempAt / moistAt / iceAt ★
P.dirOf(face, s, t, out) · P.faceOf(x, y, z, out) · P.latLon(d) · P.dirFromLatLon(lat, lon) ★
P.node(f, L, i, j) · P.select(cx, cy, cz, { K, maxL, cull, keep }, out) · P.balance(leaves) · P.stitchMask(node) · P.neighbor(node, e) ★
P.horizonVisible(node, cx, cy, cz) · P.buildChunk(f, L, i, j, N) → { centre, pos, nrm, col, hmin, hmax, radius } ★ · P.prune(keep) ★
P.patch(dir) → { dir, Ra, A, B } · P.basis(dir, out9) · P.toBF / toL / dirToBF / dirToL (frame, x, y, z, out) ★
P.rebaseMap(old, new) → { Q, t } · P.mapPoint / mapDir ★ · P.region(d, level) → { key, node, dir } ★
P.patchHeight(frame, x, z, clampSea) · P.patchGround · P.patchWater · P.patchSea · P.patchIce · P.upL ★
P.season(ms) · P.declination(ms) · P.subSolarLon(t) · P.sunDir(t, ms, out) · P.localHour(d, t) · P.moonPos(i, t, out) · P.spin(t) ★
V = D37E.planetView(R, P, { dir, K, maxL, budget, cap, workers, url, onRebase }) ★
V.update(dt, t, ms) · V.setAnchor(dir) → ev · V.onRebase(f) · V.physics(ph) · V.ground(x, z) · V.blob(x, y, z, r) · V.toBF / V.toL · V.stats() · V.dispose() ★
```
Later: `PL.orbit` (on-rails Kepler, PL-9), `PL.galaxy(seed)` (stars as data), `PL.edits` (per-region edits, PL-6), `D37E.signal` (GPS/relays, SP-2),
`D37E.biomes` (shared biome catalog with Kubomir/Podzem, PL-3).

## 3. Coordinates, precision, floating origin
- **Body frame (BF)**: origin = planet centre, +Y = north pole (spin axis). Direction from latitude φ, longitude λ: `d = (cos φ cos λ, sin φ, −cos φ sin λ)`.
  Terrain, regions, edits and cities live here (fixed to the ground). Rotation only moves the sun, moon and stars.
- **System frame**: sun at origin; planet centres and moons on rails from time (no integration → the same for everybody, no network).
- **Patch frame (L)**: origin = anchor point `A` (sea-level point of a region centre), basis `B = [east, up, south]` (right-handed, three.js
  convention). Near the poles `east` uses +Z instead of +Y as reference (a smooth local choice; a rebase handles the switch).
  `p_L = Bᵀ (P_BF − A)`, `P_BF = A + B p_L`. Rebase old → new: `p_new = Q p_old + t`, `Q = B_newᵀ B_old`, `t = B_newᵀ (A_old − A_new)`; velocities use Q;
  yaw: rotate the forward vector by Q and read the new heading.
- **GPU**: chunk vertices are float32 relative to the chunk centre `C` (double). Chunk matrix = `[Bᵀ | Bᵀ (C − A)]`, computed in double; three.js forms
  `modelView = view × model` in double on the CPU, so only small numbers reach float32 near the camera. Matrices change only on rebase.
- **Errors (M)**: 10 000 km from the planet centre, a vertex 2 u from the camera lands within **1.3e-5 u** through this pipeline (float32 GPU math
  emulated in the test); "everything absolute in float32" puts it **0.72 u** off (`planet-test` «точность»).
- Depth: per frame `near = clamp(0.08 × height above ground, 0.1, …)` (above the highest mountain: at least half the distance to it), `far` =
  1.08 × (distance to the sea horizon + the tallest mountain beyond it). The ocean is inside the terrain mesh, so there are no coplanar surfaces
  far away; sky, stars and the moon impostor sit at the far plane.

## 4. Terrain: cube-sphere quadtree LOD

### 4.1 Mapping, lattice, seams
- Faces `+X −X +Y −Y +Z −Z` with (u, v) axes so that `u × v = n`. Equi-angular warp `s' = tan(s π/4)`: cell area across a face varies **1.41×**
  (plain normalize: 5.17×) (M). Node `(face, L, i, j)` covers `s ∈ [−1 + 2i/2^L, −1 + 2(i+1)/2^L]`; numeric key `((face·32 + L)·2^20 + i)·2^20 + j`.
- **Global lattice**: every vertex is an integer point on the cube of side `M = N·2^L`; the warp is applied per axis from that integer (exact ±1 at
  the cube edges), so a vertex shared by two chunks — same face, another face, or one level coarser (`2X/M ≡ 4X/2M` exactly in IEEE) — has a
  **bit-identical** direction and height (M: every cube-edge vertex of a 64-lattice, 500 random coarse/fine pairs). Float32 per chunk leaves
  ≤ 2·10⁻⁷ of the chunk radius; skirts hide it.
- Normals: central differences on the chunk lattice with one extra ring computed beyond the face edge (warp extrapolated), so neighbours agree.

### 4.2 Selection, balance, stitching, culling (pure, tested in node)
- Split when `distance(camera, node centre at its sampled height) − half-diagonal < K × node size`, `K` = 1.25 PC / 1.0 phone, merge back at × 1.15
  (hysteresis); max level 12 (3 u spacing, like `worldmap.js` 4 u). Selection runs at most 8 times per second and only if the camera moved more
  than `max(2, 0.05 × height above ground)` or new chunks arrived.
- Node objects keep links to parent, children and neighbours (no table lookups in the hot path) and are pruned when unused (the node count
  stays at 2 600–4 000 over a 10-minute flight (M)).
- **Balance (2:1)**: neighbours differ by ≤ 1 level; neighbours across cube edges are found by stepping half a cell outside the face square and
  re-projecting onto the cube (`p / max|p|`) — no adjacency tables (M: mutual for all nodes of levels 0–4).
- **Stitching**: each shown chunk picks one of 16 shared index buffers by its "coarser neighbour" edge mask, computed against what is actually
  shown (a missing chunk is covered by its ancestor). The border ring is four trapezoids (outer edge → inner square), triangulated by a zipper that
  skips odd outer vertices on stitched edges; interior quads use the physics diagonal (M: every mask tiles exactly N², all triangles face out).
- **Skirts** (radial, depth `2 + 6 %` of chunk size) cover transient two-level gaps while children load.
- **Horizon culling**: a node (centre direction, angular radius, height range) is hidden when the angle to the camera direction minus its radius
  exceeds `acos(r_sea/D) + acos(r_sea/r_max)`; the rendered surface never goes below sea level, so the sea sphere is a safe occluder (M: never hides
  anything visible; a camera within 3 u of the sea keeps < 700 leaves). Frustum culling is three.js's own per mesh.

### 4.3 Streaming
- Requests sorted by importance (size / distance); in flight ≤ 2 per Worker; 1 Worker on ≤ 4-core devices and phones, 2 elsewhere; results are
  transferable typed arrays (positions float32 relative to centre, normals int8, colour + coast/depth uint8, ≈ 23 KB per chunk). The page
  integrates ≤ 2 (phone) / 4 (PC) per frame.
- A missing leaf is drawn by its nearest ready ancestor (its ready descendants are hidden) — no holes, no overlaps (same rule as `worldmap.js`).
- 6 root chunks are built on the page at start and never evicted; LRU cache 260 / 480. CPU copies are kept (three needs them after a WebGL
  context loss). Shared index buffers are detached before a chunk geometry is disposed (three would otherwise delete the shared GL buffer).
- No Worker: the same builder runs on the page, one chunk per frame within 3 ms. A Worker error sends its in-flight chunks back to the queue.

### 4.4 Generator `rocky1`, biomes, water (deterministic, double)
- Seeded improved-Perlin 3D noise; continents = domain-warped fbm (land share ≈ 46 %); ridged mountains in belts (peaks ≈ 2 600 u); hills; fine
  detail (≈ 10 u) everywhere — the same function for every LOD, so shared vertices agree. **1.9–2.8 µs per sample** on a PC core (M).
- Colours per vertex: temperature from latitude and altitude, moisture from low-frequency noise with desert belts at ±24°, slope → rock;
  beaches, grass, steppe, forest, taiga, tundra, snow; polar sea ice (≈ 12 % of the surface) is solid (physics stands on it).
- Near the camera the terrain shader adds two octaves of world-space value noise (pebbles/grass patches), fading out by 160 u.
- Later: `D37E.biomes` shared catalog (Kubomir and Podzem use the same `biomeAt`), props (trees/rocks instanced per finest chunk), caves (spec §3.4:
  smooth voxels near the player), simplex noise and an octave budget if Worker time becomes the bottleneck.

## 5. Gravity and the flat patch
- In the patch, terrain height is the exact rendered finest-level triangle under `(x, z)`: direction → face lattice → 3 vertex heights (cached by
  global lattice key, 8192-slot open hash, no garbage) → plane in L. Curvature is included (sea drops `d²/2R` away from the anchor), so what you see
  is what you stand on (M: ≤ 2 cm inside a chunk; the corner quads of the border ring use the other diagonal, ≤ 3 u there).
- `ph.terrain.sample(x, z)` and `ph.waterLevel(x, z)` are the only hooks; `player.js`, `physics.js`, `vehicle*.js`, `build.js`, `climate.js`/`precip.js`
  keep working in L (M: the proof lands and runs with the stock `player.js`, swims at sea, stands on polar ice). Sample cost 0.7–1.5 µs (M).
- Gravity is the patch −Y; its error grows as `distance/R` (0.17° at 384 u on the home planet, M), so regions are ≈ 785 u and a rebase happens when
  the player enters another region.
- Rebase = one fixed step: `V.onRebase(ev)` listeners move the player (`ch` position and velocity, yaw), camera rig, actors, vehicles, local bodies
  and particles (`ev.point`, `ev.dir`); the physics height cache stays (keys are global). `R.cut()` and `R.shadowDirty()` after a rebase.
- Network: region anchors are deterministic (`P.region`), so everybody in a region shares the same L coordinates — `net.js`, presence and
  `mir-<регион>-<N>` channels send small local numbers; a player crossing regions moves channel (≤ 4 track per 31 s rule).
- Tiny planets (Studio parts, R < 2 000 u) need re-anchoring every step and a gravity vector in `player.js` — a separate engine step (PL-10).

## 6. Light: day/night, seasons, sun, moons, stars
- Sub-solar point: latitude `δ`, longitude `λ_s(t) = phase − 2π t / day`; sun direction (BF) = `d(δ, λ_s)`. Local hour = `12 + (λ − λ_s)·12/π (mod 24)`
  — day on one side of the planet, night on the other (M: noon under the sun, midnight opposite, +1 h per 15° east, same sun after a day).
- Home planet: `δ = tilt · cos((φ − 1.5)·π/2)` with φ from `D37E.climate.phaseCal` (or the same formula inside the Worker): highest sun in mid-summer,
  lowest in mid-January, no jumps at the calendar seams (M); winter stays December–February, November is autumn. Other planets: φ from their year.
- Moons on circular rails (period, distance, inclination, phase), turned into BF by the planet's spin; drawn as lit spheres at a scaled distance
  (same angular size) so they never leave the far plane; phases appear by themselves. Stars: seeded points at the far plane, turning with the sky,
  faded by the air above the camera times daylight.
- Engine hand-off: `E.sunAt` → the real sun in L, so `R.setLighting` (≤ 4 times per second) colours the engine sun, sky light and reflections for
  characters and props; the engine dome is hidden (the atmosphere draws the sky); engine shadows are off (terrain has its own light and a contact
  blob under the player; receiving engine shadows on near chunks is PL-4).

## 7. Atmosphere (orbit → ground, phone-friendly)
- Exponential Rayleigh and Mie layers (`Hr`, `Hm`), zenith optical depths `tauR`, `tauM`, Cornette–Shanks phase with g = 0.76.
- Optical depth to the sun at a point: Chapman approximation `Ch ≈ c/((c − 1)μ + 1)`, `c = √(πX/2)` (Schüler, GPU Pro 3), with the tangent-point
  identity below the horizon and a planet shadow test; within **12.6 %** of a numerical integral for both layers (M; `PL.chapman` = the GLSL).
- View-ray integral with samples placed densest where the air is densest (closest approach to the planet, the start or the end of the ray):
  6 samples for sky vertices, 4 for the moon, 3 for terrain vertices; phases per fragment; the sun disc is attenuated by the view transmittance.
  Without the dense placement the limb glow from orbit had a dark gap (found in the proof).
- Meshes: a camera-centred sky dome (24 rings, denser near the horizon) near the ground and a planet-centred shell (96 × 48 on phones, 160 × 80 on PC)
  for orbit, cross-faded by altitude — the same function, so the fade does not show. Terrain vertices get in-scatter + transmittance (aerial
  perspective), slightly weaker than the sky so distant land stays darker than the sky behind it.
- Cost is per vertex, so it scales with geometry, not with screen pixels.
- Later (PC «Ультра»): Hillaire sky-view LUT per frame; a cloud layer; city lights on the night side; aerial perspective for engine materials (PL-4).

## 8. Orbit ↔ surface without loading screens; layered loading
1. **Galaxy** (PL-9 data, SP-4 view): stars as seeded data (position, class, number of planets); a map, no meshes.
2. **System**: planets and moons on rails from the system seed; drawn as spheres/impostors.
3. **Planet from far**: the 6 root chunks + shell; nothing else is fetched (M: 17–27 draw calls, 1.5 ms CPU on the phone profile).
4. **Descent**: the quadtree refines under the budget; the parent stays until children are ready; Workers build by importance.
5. **Near the player**: finest chunks + physics patch + region data (cities, edits); props and detail objects (PL-3).
6. **Very near**: creatures, items, interiors (existing systems in L).
- Flight model in the proof: free flight in BF doubles (speed grows with height above ground, 14 → 90 000 u/s, ×6 with «run»); the anchor
  follows the sub-camera point when high (rebased after drifting a quarter of the altitude) and snaps to region anchors below 1 500 u.
  «🛬 Сесть» places the player on the ground (or the water) under the camera; «✈ Взлететь» returns to flight. Real ships (rocket physics,
  orbits) are SP-1.

## 9. Saving player edits per region; network frames
- Region key = `(planet id, region node key)`; region data = `{ rev, ops: [...] }` — terrain brushes (raise/lower/flatten/paint: centre in region L,
  radius, strength), placed objects (kind, L position, yaw), removed generated props (seed ids).
- Height with edits = generator + Σ ops in reach; Workers get the ops of regions a chunk overlaps (the chunk cache key includes the region revs →
  rebuilt on change); physics uses the same function.
- Storage: IndexedDB `d37-planet` per planet/region (offline, single player); server table `planet_edits(planet, region, rev, ops, owner)` with RLS,
  size caps and moderation like `ugc` (only for shared worlds; SQL in its own area file when it is built — PL-6).
- Positions over the network: region key + L coordinates (small floats). Ships in space: BF doubles (JSON numbers), each client computes its patch.

## 10. Adapters (each is a separate later task; sizes S < 1 agent run, M ≈ 1, L ≈ 2–3, XL ≥ 4)

### 10.1 «Мир Денчика» — the current map becomes one region of the home planet
- **M1 (L)**: the map (6144 u square, `worldmap.js`, zones, cities) stays exactly as it is, as a **flat facet** pinned at the `mir` region
  (`regions[].kind = 'flatmap'`): the generator raises land there (on seed 37 that spot is open sea today), the facet plane is joined to the sphere
  by a blend ring (≈ 3 km; 37–74 u at the facet edge for R = 128 000; ocean surface slope ≈ 0.7°). The planet view draws everything beyond the
  map's far edge; the sky becomes the atmosphere when you climb. No edits in `mir*.js` beyond one hook to start the view.
- **M2 (L)**: physics outside the facet in region patches (cars, boats, planes keep `vehicle*.js`); climate by latitude (`climateAt` from the
  planet); network channels per region; the plane can leave the map and fly around the planet; time of day follows the rotation (the 40-minute
  shared clock = the rotation period; night length then depends on season and latitude — decided: physical day/night).
- **M3 (M)**: «Реактивный самолёт» (cruise 600–800 u/s, ~20 min loop) and long routes from WORLD_MAP stage (г) as planet routes (airports on other
  continents are new regions with pads).
- **M4 (XL, optional, decide after M1 numbers)**: migrate zones to per-zone frames on the curved surface (each city flat in its own frame, natural
  terrain fully spherical) — removes the facet; only if the facet ring is noticeable.

### 10.2 «Кубомир» — block planets as a world type (cube-sphere vs torus, measured)
| | Cube-sphere blocks (6 face grids) | Wrapped torus (x, z modulo W) |
|---|---|---|
| Real round planet from orbit, sky and horizon | yes (same `planet-view` shell, orbit, moons) | no (only a fake "curved world" bend; no poles, no orbit view) |
| Block shape | distorted near cube edges/corners: area and edge length vary 1.41× across a face, corner cells sheared 30° (M) | perfect cubes everywhere |
| Physics (`V.moveBox`) | unchanged in face-grid space; crossing a cube edge = rebase with a 90° turn | unchanged |
| Mesher cost on phone | warp per vertex: 43 ns in a Worker (M) = 0.9 ms per 20 000-vertex chunk on PC (≈ 3.5 ms on a phone), or ≈ 15 ALU in the vertex shader with no CPU cost (recommended) | none |
| Chunk neighbours (light, AO) | across face edges need an index remap (special code at 12 edges and 8 corners) | modulo only |
| World size | bounded: R = 256 / 512 / 1024 blocks → 4 056 / 15 606 / 61 206 chunk columns; walk around in 6 / 12.5 / 25 min (M) | any |
| Fit with the Universe (rockets, other planets) | direct (PlanetProfile, same sun/orbit) | needs a separate fake space view |
**Recommendation**: keep the infinite flat world as the default; add «Планета» as a new world type with cube-sphere face grids for small block
planets (R 256–1024 blocks), depth layers to the core, gravity per face, warp in the vertex shader, sky/orbit/moons from `planet-view`. Torus only
as a cheap "world wraps around" option for flat worlds. Steps: **K-P1 (L)** face grids + warp + edge crossing + generator on the sphere; **K-P2 (M)**
orbit view and the shell/sky from `planet-view` + day/night from rotation; **K-P3 (L)** rockets and the Moon (E5 in kubomir-modpacks, same
PlanetProfile; air/vacuum, `g`).

### 10.3 «Подземье» — 2D planets
- **P-P1 (M)**: «Планета» world option: the world wraps horizontally (x modulo circumference in tiles); the generator samples noise on a cylinder
  (cos/sin of x) so the wrap is seamless (new worlds only, genVer bump); the 2D sky uses the planet's day/night and moons.
- **P-P2 (M)**: other planets by rocket as separate 2D worlds (each a PlanetProfile with its own seed, gravity, air, palette); the flight is a short
  scene (natural ad pause, universe spec §8).
- **P-P3 (S)**: GPS/satellite and relays through `D37E.signal` (shared with Кубомир §7½ and the Мир phone).

### 10.4 «Студия 3D»
- **S-P1 (L)**: world type «Планета» (`SC.settings.world = { type: 'planet', profile }`): radius, seed, sea, relief, atmosphere colour, day length,
  moons — without code; the editable `terrain.js` area is a facet region; outside is generated; publishing keeps only the profile + edits.
- **S-P2 (M)**: planet parts: Planet / Moon (decorative spheres with atmosphere), Orbit mover (part moves on a circle by time), Gravity zone (radial
  gravity inside a sphere — needs PL-10), Launch pad (teleport to another planet world).
- **S-P3 (S)**: scripts `Planet.*` (LatLon, LocalTime, SunDirection, Gravity, GoTo(planet)) in JS, Lua, C#, Java.

### 10.5 Space path (later, universe spec §7)
- **SP-1 (L)**: rocket vehicle kind (thrust, fuel, staging), on-rails orbits for bodies + integrated ship orbit in BF doubles with time warp; launching a
  **satellite** registers it (orbit elements on the server) → unlocks GPS for the player/world.
- **SP-2 (M)**: `D37E.signal` — GPS coverage = satellites above the local horizon (orbits are deterministic → no network), signal through terrain/blocks
  attenuates; **relay stations** (range, power, line of sight) carry it into caves; «нет сигнала» in dead zones (kubomir-modpacks §7½).
- **SP-3 (L)**: the Moon as the first other body (same LOD terrain, `moon1` generator with craters, g 0.4, vacuum, suit oxygen).
- **SP-4 (XL)**: star systems and the galaxy map (layers 1–2), jumps, colonies (universe spec §7).

## 11. Risks
- **Depth precision** at planet-scale far planes (24-bit): handled by the ocean-in-terrain rule, per-frame near/far and far-plane sky; overlapping
  far geometry (clouds, props far away) needs a second depth range (two-pass) — PL-4.
- **Popping** when LOD changes: stitching removes cracks but not popping (visible during a fast descent); geomorphing (CDLOD) is PL-2.
- **Engine coupling**: `render.js` forces `camera.far ≤ 3000` and owns fog/sky; the view overrides per frame and wraps `E.sunAt` while mounted;
  AO / SSR / frame generation are kept off on the planet (the graphics guard would otherwise switch them off for good). PL-4 makes this formal.
- **Measurement gap**: headless Chrome renders on the desktop GPU and does not throttle Workers, so phone GPU time and phone Worker time are
  estimates (×4 for Workers); a real-phone check belongs to PL-2.
- **Workers** blocked or slow on old phones → main-thread fallback with a budget; root chunks always present.
- **Gravity tilt** grows with distance from the anchor: regions ≈ 785 u on the home planet; tiny planets need PL-10.
- **Same gameplay on all devices**: rebase only at fixed-step boundaries, from positions (not from frame time); heights are pure functions.
- **Shader failures** (страж графики): new materials are plain `ShaderMaterial`s without engine chunks; checked on ANGLE D3D11 in Chrome
  (SwiftShader/GL — in PL-2 via `gfx-strict.cjs`).
- **Other agents' files**: the proof touches only new files plus one hidden entry in `games.js`, a test line in `ci-run.cjs` and a CLAUDE.md note.
- **Scope**: the Мир adapter must not stall Living City work (T-032…): M1 adds a view around the map without changing city files.

## 12. Proof (Part B): what was built and the numbers
**Built** (branch `worktree-agent-a580b564af45ca9d2`): `js/engine/planet.js` (≈ 700 lines), `js/engine/planet-worker.js`,
`js/engine/planet-view.js` (≈ 650 lines), `js/games/planet-demo.js` (hidden page `/play/planet`: orbit start over a desert coast at 29° N 81° E,
«⬇ Вниз» auto-descent, «🛬 Сесть» / «✈ Взлететь», «🛰 Орбита», time ×1/×30/×300, phone joystick and buttons, HUD with altitude, speed, place, local
time, chunks, draw calls, FPS, CPU), `scripts/planet-test.cjs` (83 checks, in `ci-run`), `scripts/planet-perf.cjs` (Chrome: `perf`, `soak N`,
`reopen N`); `games.js` — one `GAMES_HIDDEN` entry, `GAMES_VER` 125 (after merging main); a CLAUDE.md note. Shaders checked on ANGLE D3D11 and SwiftShader.

**Numbers — node** (PC core): height 1.9–2.8 µs; chunk 32 × 32 (with normals ring and skirts) 3.2–4.6 ms; selection + 2:1 + masks at ground level
0.4–0.9 ms; physics ground sample 0.7–1.5 µs; precision 10 000 km out 1.3e-5 u vs 0.72 u naive; cube-face area ratio 1.41; Chapman error ≤ 12.6 %.

**Numbers — Chrome, phone profile** (412 × 915 × 2, CPU ×4, «средняя», `node scripts/planet-perf.cjs perf`, final code; FPS is on the desktop GPU):
| Stage | FPS | CPU per frame avg / p95 / max | Frames > 50 ms | Draw calls avg / max | Triangles | Planet update avg / p95 / max |
|---|---|---|---|---|---|---|
| Orbit (5 s) | 128 | 1.6 / 2.6 / 9.7 ms | 0 | 17 / 27 | 22 k | 0.02 / 0.2 / 0.5 ms |
| Auto descent orbit → ground (≈ 40 s) | 121 | 2.4 / 4.2 / 10.7 ms | 0 | 36 / 55 | 61 k | 0.14 / 0.9 / 6.8 ms |
| Standing on the ground (6 s) | 99 | 4.0 / 6.3 / 25.8 ms | 0 | 64 / 64 | 103 k | 0.02 / 0.2 / 0.4 ms |
| Running 20 s (new chunks, a region rebase) | 96 | 4.0 / 6.1 / 16.3 ms | 0 | 65 / 73 | 105 k | 0.09 / 0.3 / 3.1 ms |
| Fresh descent elsewhere (30 s) | 119 | 2.6 / 4.4 / 16.1 ms | 0 | 42 / 57 | 74 k | 0.10 / 0.5 / 3.4 ms |
Chunks: 189–226 shown, 238–254 cached (5.4–5.8 MB); Worker build 2.9–3.1 ms avg / 9 ms max (unthrottled, ≈ ×4 on a phone); integration
0.14–0.17 ms avg; selection 1.2–1.3 ms avg / 6.4 ms max; whole-page JS heap 22–30 MB. Runs made while other agents loaded the machine showed
3–42 frames > 50 ms in the running stage; quiet runs show none. After merging main (new camera/controls/input/post code) the page runs
without errors; timings taken then were noisy from machine load — an A/B run of the pre-merge snapshot under the same load was just as noisy. **PC** (1280 × 720, high, `PC=1`): 0.3–1.3 ms CPU, 21 → 66 → 122–140 draw calls.
**Soak** (`soak 20`: orbit → descent → landing → running → time ×300 → orbit at 8 places around the planet, ×4 CPU; final code): 20 minutes,
0 errors, 0 console warnings, 12 470 chunks built, 51 region rebases, chunk cache 238–256, JS heap after GC 22.5 → 25.1 MB and flat at 24–25 MB
from minute 3 (LOD node objects are pruned; their count oscillates 2 700–4 000). Two earlier 10-minute runs: the same picture.
**Reopen** ×20: the Worker is gone after each close, no errors, heap after GC plateaus at 40–50 MB (site caches).
Screenshots: `E:\claude-tmp\t051\shots` (`1-orbit` … `7-time`, `phone-*`), SwiftShader — `shots-ss`.

**Not done in the proof** (on purpose): geomorphing (pops are visible during a fast descent), props/trees/rocks, caves, edits and saving, engine
shadows on terrain, clouds, wave geometry, any game adapter (Мир/Кубомир/Подземье/Студия), rockets/orbits/network; the flight is a free camera, not a
vehicle; the start is a natural coast because the `mir` spot is sea on seed 37 (M1 pins land there); real-phone GPU time is not measured.

## 12a. T-075 — paused (PL-2 LOD v2 + PL-4 engine integration; 22.10.2026, weekly limit) — finished and ON since T-145, see §12b
Branch `worktree-agent-a22547bb6ee7652aa`. **Everything new is behind flags that are OFF by default** — `/play/planet` behaves as before
T-075 (checked: `gfx-strict PAGE=planet PLANET_V2=0` on SwiftShader green — 1 depth range, no AO/shadows/haze, guard writes nothing; Chrome
smoke — 214 chunks on the ground, 5.7 MB chunk memory, 1 worker on the phone profile, 0 errors). Turn on: `localStorage d37_planet_v2 = '1'`
+ reopen the planet (read when the view opens), or `o.flags` in `D37E.planetView(R, P, { flags })`; defaults — `D37E.planetView.FLAGS`
(`lod2, morph, prefetch, split, shadows, aerial, weather`). Flag off = old code paths: `P.select` with `K`, old show/stitch logic, old worker
count, `buildChunk(…, { lite: true })` (ring 1, no parent data; pos/nrm/col bit-identical — planet-test), shader without `D37_MORPH`/`D37_PSH`,
sky on layer 0, fog chunks byte-identical to pre-T-075 (all 10 patched chunks compared).
Always on (finished, tested): `E.setSunProvider` (same behaviour as the old `E.sunAt` wrap), edge-ring triangulation = physics diagonal b–c
(physics = mesh < 0.02 u at chunk edges), stale-parent relink in `P.node`, worker respawn (≤ 3), `R.guardVolatile` API in post.js (used only
with `split`), planet-lod-test in `ci-run`.

**Done (with flags on):** screen-space error selection (ρ = eK·proj/d; β 0.5, γ 1.96, measured eK from 4 kids, near floor, hysteresis 1.15;
τ phone 3 / PC 2.2 px, adaptive bias for leaf budget 220 / 450); CDLOD geomorph (per-vertex parent shape: offset int16, normal int8, colour
uint8 = +16 B/vertex; chunk k from parent error, fade-in 0.12 s, shared edge k, 4-quad edge blend); step-by-step display `P.lodShow` (gate 0.05 /
0.15 px, 2:1 kept on screen, stand-ins only without shown descendants); tiered build queue + `P.peek` prefetch 0.6 s ahead; worker pool (phone 2 on
≥ 6 cores, PC cores − 2 ≤ 3); upload budget 2 / 4 chunks, 96 / 256 KB, 4 ms per frame; two-range depth `R.depthSplit` (near 0.12…S, far 0.95 S…;
S = clamp(2·altG, 600, 6000); sky on layer 1; post.js/render.js draw both, near pass without background) → AO and SSR on the planet again; guard
decisions on the planet are session-only; engine shadows on the terrain near the player (4-tap, highp sampler); aerial perspective in the engine
fog chunk (`E.GFXU.apA…apD`); `P.climateAt` by latitude + `V.climateAt` / `V.weatherPos` / `V.setWeather` → engine weather on the demo (rain,
snow, sun dims under clouds).
**Numbers so far.** Node model (`scripts/planet-lod-test.cjs`, phone throughput 1.5 builds/frame): max pop on a normal descent 8.23 → 0.054 px
(avg 1.30 → 0.001), very fast descent 25 963 → 0.085 px (converges 2.4 s vs 2.0 s), ascent 1 680 → 0.114 px; chunks at the ground: sea 111 → 80,
mountains 250 → 221; builds per descent 445 → 670 (prefetch); select + show 0.16–0.3 ms, morph 0.006–0.012 ms per frame. Chrome (D3D11, phone
size, no throttle): ground 214 → 165 chunks, draw calls 72 → 69–72, popMax 0, 0 errors; chunk GPU memory 5.6 → ~10.5 MB (parent data); worker
build 3.2–4.6 → ~5.3 ms avg (ring 2 + parent data; loaded machine). `gfx-strict PAGE=planet` with the flag: SwiftShader, GL, Vulkan green
(AO, SSR, shadows, haze, bright sky, nothing switched off by the guard). Tests: planet-test 109, planet-lod-test 17, orbit-test 95, render-test 387.
**Half-done / not done:** phone-profile A/B (CPU ×4) before → after — started, stopped at the pause; 10-min soak and reopen ×21 with the flag
(`planet-perf.cjs` now reports three.js object counts and guard state); real phone; GPU memory of parent data (+84 %: pack colp/np only for odd
vertices or int8 offsets on coarse levels, or lower CAP on phones); worker cost on phones (Chrome's CPU throttle does not slow workers — ×4 by hand);
haze and weather on the terrain — done later the same day (see «Resumed» below);
CLAUDE.md «🪐 Планета» and docs/progress.md not updated yet.
**Resume:** (1) `localStorage.setItem('d37_planet_v2','1')`; (2) `node scripts/planet-test.cjs`, `node scripts/planet-lod-test.cjs` (full),
`node scripts/render-test.cjs <three r149>`, `PAGE=planet node scripts/gfx-strict.cjs swiftshader|gl|vulkan high`, `V2=1 node scripts/planet-perf.cjs
perf` (and `SITE_DIR=<copy before T-075>` for «before»), `V2=1 … soak 10`, `V2=1 … reopen 21`; (3) numbers OK → `FLAGS` defaults
→ true, GAMES_VER, CLAUDE.md, docs/progress.md. Files: `js/engine/planet.js` (sse walk, `lodShow`, `lodMorph`, `peek`, `buildChunk` md/np/colp/err,
`indices`), `planet-view.js` (FLAGS, pool, budget, morph uniforms, split cameras, shadows, haze, weather API), `planet-worker.js`, `gfx.js`
(sun provider, haze), `post.js` / `render.js` (two passes, guard `G.vol`), `js/games/planet-demo.js` (weather), `scripts/planet-lod-test.cjs`,
`planet-test.cjs`, `gfx-strict.cjs` (PAGE=planet, PLANET_V2), `planet-perf.cjs` (V2). Temp files: `E:\claude-tmp\t075`.

**Resumed 22.10 evening, paused again (weekly limit) — still OFF by default.** Added since the pause (all behind the flags):
- Haze: gfx.js no longer has a load-time switch — the fog chunk with haze is set by the planet itself while it is open
  (`E.aerialPatch(T, true/false)`, before scene materials compile); the rest of the site keeps the old fog chunk byte-for-byte. Guard key
  `'aerial'` (post.js): a frame with haze has «not numbers» / is black by day → haze off at once (`d37ApA.w = 0`); a fog program fails to
  compile while haze is on → old chunk + rebuild; remembered per device (render-test 391 covers it; ⚙️ label «дымка атмосферы на планете»).
- GPU memory: a chunk hidden longer than 3 s releases its GPU buffers (JS data stays; three re-uploads when shown) — `V.stats().gpuKB` =
  resident, `cacheKB` = all data. Phone profile, on the ground: 10.6 MB data, 7.7–7.8 MB on the GPU (was 10.5 on both); flag off — 5.5 MB.
- Weather on the terrain (`D37_PWX`, flag `weather`): snow cover on up-facing ground and darker wet ground within 3000 u of the camera (the
  weather is local; farther — other climates), not on water. Rain shelter is not needed yet — the planet is a heightfield (no roofs, caves).
- `select` no longer spins every 60 ms while standing with waits that cannot resolve by themselves (2:1 neighbour, chunk still building):
  only 0.4 s after the last change. Planet update on the ground (×4): 0.375 → 0.27 ms.
- Switches per device: `localStorage d37_planet_v2` = `'1'` / `'0'`, single flags — `d37_planet_flags` = `'{"weather":false}'` (known keys
  only). planet-perf: `V2=0|1`, `PF='{"split":false}'`; soak reports three.js object counts.
**Numbers** (phone profile 412×915×2, CPU ×4, «средняя», machine loaded by other agents, one pair after the fixes; CPU ms per frame avg / p95,
flag off → on): orbit 1.51 / 2.9 → 2.14 / 3.7; descent 2.25 / 4.1 → 2.86 / 5.2; ground 3.27 / 4.8 → 5.24 / 7.5; running 5.0 / 9.2 → 5.6 / 8.8;
fresh descent elsewhere 2.48 / 4.6 (19 frames > 50 ms) → 3.21 / 5.7 (0). Shown chunks on the ground 214 → 165, JS heap 27.9 → 35.7 MB, worker
build 3.2 → 3.5 ms, 0 errors, guard clean in both. Before the two fixes the same pair gave ground 4.7 → 7.46 and running 4.3 → 8.2.
**Decision: keep OFF** — +2 ms CPU on the ground (+60 %) on the phone profile is a regression. Suspects, in order: per-chunk material
re-upload (most shown chunks are mid-morph: ~115 k uploads per minute; fix — k per chunk without `uniformsNeedUpdate`, e.g. a tiny per-chunk
attribute buffer or one draw per level), the second render pass (near + far scene traversal), engine shadows, weather particles.
**Not done:** breakdown runs (`V2=1 PF='{"weather":false}'`, `{"split":false}`, `{"shadows":false}`, LOD only — runner
`E:\claude-tmp\t075\meas2.cjs parts`), 10-min soak and reopen ×21 with the flag, real phone, CLAUDE.md / progress.md text for «on».

## 12b. T-145 — T-075 finished and turned ON (29.10.2026); T-088 eclipse shadow, world clock from our server
Branch `t145-planet`. **Default ON** (`D37E.planetView.FLAGS`); one-line rollback in planet-view.js: `const FLAGS = { ...FLAGS_OFF };` (= the
pre-T-075 view); per device `localStorage d37_planet_v2 = '0' | '1'`, single flags `d37_planet_flags` (lod2, morph, prefetch, split, shadows,
aerial, weather, eclipse).
**Found and fixed.**
- **LOD v2 stuck after a jump to the ground** (teleport, reopen, any `goto`): the show stayed on 4–37 of 165 chunks for ever while ~120 chunks
  per second were built and evicted. Cause: with the cache over CAP, `select` evicted the *ready* children (and grandchildren) of a shown node
  that waits to split (coarser neighbour, not settled, or children beyond the horizon that the selection culls) — next select needed them
  again. Fix: the whole leaf→shown path and the 4 kids (+ grandkids of splitting kids) of every shown splitting node are «used». After: 165 shown
  in ≤ 1 s, 0 evictions and 0 selects while standing (dbg run, 3 reopenings). This is also why the 22.10 numbers (ground +2 ms) were measured
  on a half-built ground after a descent.
- **Per-draw material re-upload (§12a suspect #1)**: morph numbers of a chunk (k, displacement scale, 4 edge k packed 11 bits each) are now one
  instanced `vec4` attribute per chunk (`aMk`, `InstancedBufferGeometry`, 1 instance; 7 vertex attributes ≤ WebGL1 minimum 8; WebGL1 without
  ANGLE_instanced_arrays → morph off). Uploaded only when a value changes: standing — 0 uploads (was 4 580–5 096 full material uploads per
  second on the phone profile), walking — only chunks in the morph band. No `onBeforeRender` on chunks any more.
- `P.lodMorph` runs only when the camera moved (> 0.002 u), the show / projection changed, or a fade is running (it now returns «busy»;
  `o.dcMax` keeps fades smooth after a pause): standing — planet update 0.28 → 0.03 ms (×4).
- Chunk matrices are set once in `placeMesh` (`matrixWorld = matrix`, the planet group is out of the scene's matrix traversal); the per-frame
  loops reach the chunk through `node.ch` (no Map lookups with 47-bit keys).
- **Two depth ranges only when they give something** (`split` + AO or screen-space reflections on): phone «средняя» / «низкая» have neither, so
  the second scene pass was pure cost (profile: `Js.render` 581 → 498 ms/s). With split: far-only chunks go to layer 1 (the near pass skips them
  before the frustum test) and the scene's matrices are updated once per frame (`scene.onAfterRender` after the far pass).
- Ground shadows `shadows: 'auto'`: off on a phone at «средняя» / «низкая» (the player keeps the blob shadow), on elsewhere.
**Numbers** (phone profile 412×915×2, CPU ×4, «средняя»; the machine was at 93–100 % CPU from other agents the whole evening, so wall ms per
frame jumped 3–11 ms between identical rounds. New `planet-perf.cjs trace` mode: main-thread CPU per frame from Chrome trace `tdur` of rAF
tasks — no preemption; ×4 throttling is not in it, so ×4 wall ≈ 4 × thread). On the ground at (29°, 81°), 10 paired rounds v1 (off) → v2 (default):
thread median 1.161 → 1.378 ms, **median of paired differences +0.07 ms thread (≈ +0.3 ms at ×4)**; wall medians 4.40 → 5.29 ms (paired
differences median +0.67, quiet pairs ≥ 130 fps: +0.16, +0.52, −0.54); running: thread 1.380 → 1.456, wall 5.64 → 5.84. 22.10 (before): ground
3.27 → 5.24 (+1.97). LOD only (no weather / shadows / haze / eclipse), 4 rounds: thread 1.767 → 1.885 (morph attributes ≈ +0.03 of it).
Profile (×4, ms of CPU per second, all v2 flags, before → after): `P.lodMorph` 30 → 0, `morphUp` 31 → 0, `updateMatrixWorld` 49 → 21 (v1 37),
`intersectsObject` 44.5 → 30.7, `Js.render` (incl.) 581 → 498. What is left over v1: three's per-draw cost of 7 attributes instead of 3 (CDLOD
parent data: `WebGLObjects.update`, `bindingStates.setup`, instanced draw) and +5 draw calls (69 vs 64), weather particles ≈ 0.1 ms ×4.
10-min soak (orbit ↔ ground, 8 places, defaults): JS heap 28.5–31.4 MB flat, chunk cache 234–258, GPU 4.6–7.5 MB, three objects stable
(geometries 372–400, materials 59, textures 32), 0 errors, guard clean. Reopen ×21: after GC 28.6–29.4 MB (no growth), workers 0 after close,
renderers 1, geometries 43, materials 18, 0 errors. gfx-strict PAGE=planet SwiftShader «высокая»: green (split + AO, shadows, haze, sky).
Tests: planet-test 109, planet-lod-test 17, orbit-test 105 (+10: clock from our server, eclipse shadow), render-test 391, rt-test 146 (+2: /time).
**T-088.** Solar eclipse shadow on the ground (flag `eclipse`): see planet-space.md §2.1; screenshots from orbit show the umbra with a soft
penumbra moving across the ground (~2 min of totality at a point). World clock: `GET <RT_URL>/time` first, Supabase `world_now()` — fallback
(the live server needs the update below; until then the clock quietly uses Supabase).
**Weather hook (for the weather track, BIOME_WEATHER.md v2 §WX2).** One call: `V.setWeather(wx)` (planet-demo.js `planetWx` passes the engine
weather's visual state 4×/s) — besides `cloud, rain, fog, storm, snowCover, wet` it takes `dust` 0…1, `tint` [r, g, b] or '#rrggbb' (sRGB),
`vis` (visibility, u: the distance fades into the tint) and `flat` 0…1 (whiteout); the sky dome around the camera takes the tint too (the
shell seen from orbit does not: weather is local). Terrain and sky branches are uniform-gated (0 cost when unused). Screenshots: sandstorm,
whiteout, smoke — E:/claude-tmp/t145/planet/wx2/shots; eclipse — E:/claude-tmp/t145/planet/ecl/shots.
**Not done:** real phone check (owner); the old v1 path still drops a face to its root chunk for ~0.1 s when a new leaf is not ready yet while
walking (pre-existing; v2 does not) — v1 is only the rollback now.

**Integration (branch t145-planet-all, 29.10.2026).** The planet is in the site catalog for everyone (0+, tag «Новые»; SEO page
/games/planet; rollback T145_OPEN in js/features/games.js and api/_lib/games-seo.js). Weather by biome is wired: the planet scripts load
wx.js + wx-fx.js, planet-demo planetWx(v, st.wx.wfx) feeds V.setWeather with dust / flat / vis / tint (linear → sRGB) 4×/s; desert
latitudes get sandstorms by their climate class. Phone ×4 'mid' (scripts/t145-e2e.cjs, loaded machine): ground 4.75 ms CPU per frame
with the specials vs 4.42 with the one-line rollback (D37E.climate.SPECIAL = false + wxfx.ON = false); in a sandstorm 4.17 ms (fog at
62 u, 46 draw calls instead of 70); orbit 3.81 ms. The debug line (chunks, CPU) is hidden, F3 shows it.

## 13. Step list → board tasks
| Step | What | Size | After |
|---|---|---|---|
| PL-1 | This plan + proof (`planet.js`, `planet-worker.js`, `planet-view.js`, `/play/planet`, tests, phone measurements) | L | — (T-051) |
| PL-2 | LOD v2: geomorphing (no popping), screen-space error, prefetch along velocity, Worker pool and GPU upload budget, real-phone check, `gfx-strict` on SwiftShader/GL — **T-075: built behind a flag, paused (§12a)** | M | PL-1 |
| PL-3 | Props and biomes: `D37E.biomes` shared catalog; trees/rocks instanced per finest chunk; colliders near the player | M | PL-1 |
| PL-4 | Engine integration: formal sun provider in `gfx.js`, terrain receives engine shadows, two-range depth (AO/SSR back on), aerial perspective in the engine fog chunk, `climateAt` from latitude — **T-075: built behind a flag, paused (§12a)** | M | PL-1 (after T-042, T-043) |
| PL-5 | Rebase API for all engine systems (actors, npc, destruct, fx, precip, rigid/Rapier shift, vehicles) + region channels for `net.js` | M | PL-1 |
| PL-6 | Edits per region (brushes, placed objects): IndexedDB + `planet.sql` (RLS, caps) | L | PL-5 |
| PL-7 | Smooth voxel caves near the player (surface nets in Workers, spec §3.4) | XL | PL-6 |
| PL-8 | Near ocean: separate water mesh with `E.waves` (T-022), seabed under water | M | PL-1, T-022 |
| PL-9 | `PL.orbit` on-rails bodies + `PL.galaxy(seed)` data (layers 1–2) | S | PL-1 |
| PL-10 | Gravity vector in `player.js` + per-step re-anchoring for tiny planets (Studio parts) | M | PL-5 |
| M1 / M2 / M3 / M4 | «Мир Денчика» adapter (§10.1) | L / L / M / XL | PL-4, PL-5; M2 after T-029 |
| K-P1 / K-P2 / K-P3 | «Кубомир» block planets (§10.2) | L / M / L | T-019, T-049 wave 0 |
| P-P1 / P-P2 / P-P3 | «Подземье» planets (§10.3) | M / M / S | PL-9; P-P3 after SP-2 |
| S-P1 / S-P2 / S-P3 | «Студия 3D» planets (§10.4) | L / M / S | PL-4; S-P2 after PL-10 |
| SP-1 … SP-4 | Space path (§10.5) | L / M / L / XL | PL-9; SP-2 feeds the Кубомир GPS phone (T-049 Phase 4) |
Order proposal: PL-2 and PL-4 next (quality and engine hand-off), then M1 (the owner sees his world on a planet), then PL-5 → M2, PL-9 → SP-1.
