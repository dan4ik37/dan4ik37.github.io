# Планета — общий модуль движка `D37E.planet` (T-051): план и первый образец

Plan v1, 2026-10-22. Sources: `docs/superpowers/specs/2026-10-16-universe-design.md` (§3 техника, §9, §10), `docs/plans/kubomir-modpacks.md`
(§6.4 PlanetProfile, §7½ GPS-телефон после спутника и ретрансляторы), `docs/WORLD_MAP.md`, `docs/PHYSICS_PLAN.md`, `docs/SEASONS.md`,
CLAUDE.md («Движок D37E», «Мир Денчика» 3D, «Кубомир», «Подземье», «Студия 3D», мастер-инструкция).
Units: engine units **u** (1 m = `E.UNIT` = 1.1667 u). Numbers marked **(M)** were measured by the proof (§12); others are estimates.

## Для владельца (кратко, по-русски)
1. Сделали основу круглой планеты как ОБЩИЙ модуль движка (`D37E.planet`), а не код одной игры: его подключат «Мир Денчика», «Кубомир», «Подземье», «Студия 3D» и космос.
2. Планета грузится кусками: издалека — один шар, ближе — 6 граней, дальше каждая делится на 4, ещё на 4… до клеток в 3 м у ног. Остальное — только зерно и данные.
3. Под игроком держится «плоский кусок» (ровно как сейчас в «Мире»), он сам переезжает за игроком — ходьба, прыжки, машины, стройка и погода работают без переделки.
4. День и ночь — от вращения планеты (у каждого места своё время), времена года — по твоему календарю (зима — декабрь–февраль, ноябрь — осень).
5. Небо считается «как в жизни» (рассеяние света в воздухе), но дёшево — чтобы на телефоне было видно и с орбиты, и с земли, без экранов загрузки.
6. Образец: скрытая страница /play/planet — с орбиты летишь вниз, садишься и идёшь своим персонажем; замеры на профиле телефона — в §12.
7. Предлагаю родную планету радиусом ≈ 110 км (облёт на реактивном самолёте ≈ 20 мин, орбита ≈ 8 мин); нынешняя карта «Мира» станет одним краем этой планеты, города останутся.
8. «Кубомир» — планеты из кубиков как новый тип мира (6 граней-сеток, обычный бесконечный мир остаётся); «Подземье» — мир по кругу + другие планеты на ракете.
9. Космос — потом: ракета, спутник (после него заработает GPS в телефоне, в пещерах — ретрансляторы), Луна.
10. Дальше — по шагам (§13): каждый шаг — отдельная задача с размером, первыми — доработка движка и переходник «Мира Денчика».

## 0. Decisions (one line each; the owner can change any of them)
- One shared engine module family: `planet.js` (pure math and data: no three.js, no DOM — runs in node, in a Worker and on the page), `planet-worker.js` (chunk building), `planet-view.js` (three.js view). Games add thin adapters; no game owns planet code.
- A planet is **data** (PlanetProfile v1, §2.1), extending the Kubomir §6.4 contract instead of making a second space model.
- Terrain = cube-sphere quadtree (6 faces, equi-angular warp), chunk grid 32 × 32 quads, stitched edges + small skirts, chunks built in Workers, integrated on the page under a per-frame budget.
- All far data is procedural (seed + generator id + params); only player edits are stored, per region.
- Precision: planet math in double (JS numbers); GPU sees only chunk-local float32 vertices and matrices relative to a **patch anchor** near the camera (floating origin). three.js already multiplies `modelViewMatrix` in double on the CPU, which gives camera-relative precision for free.
- Gravity: the existing 2.5D physics and `player.js` stay unchanged. They run in a **local tangent patch** (x east, y up, z south) whose origin is a fixed **region anchor** (a quadtree node at a fixed level). Leaving the region rebases everything at a fixed-step boundary (same result on phone and PC).
- The ocean is part of the terrain mesh (vertices below sea level are lifted to sea level and flagged as water). This avoids land/water z-fighting at planet-scale depth ranges on 24-bit depth.
- Day/night: rotation of the planet (sub-solar longitude moves with time). Seasons: declination from `climate.js` phase φ for the home planet (owner's calendar), from orbit phase for other planets.
- Atmosphere: single scattering with analytic optical depth (Chapman approximation) evaluated per vertex (terrain, camera-centred sky dome, planet-centred shell for orbit), phase functions per fragment. No lookup tables, works on WebGL1 and phones.
- Home planet radius **128 000 u (≈ 110 km)** (table in §1.3). The current «Мир Денчика» map becomes one region of it (§10.1).
- Engine hand-off without editing `render.js`/`gfx.js`: the view wraps `E.sunAt` with a provider while it is mounted (the engine sky model, lights and reflections follow the real sun), hides the engine dome and sets the camera near/far each frame. A formal hook in `gfx.js` is a follow-up (PL-4).
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
(no Worker → budgeted main-thread builds; atmosphere shader fails → plain sky colour; WebGL fails → the page says so, the site lives).

### 1.3 Home planet size (decision with numbers)
| Radius (u) | ≈ km | Sea horizon at eye 2.1 u | Plane 48 u/s loop | Jet 600 u/s loop | Low orbit period (g = 20 U) | LOD levels (3 u spacing) | Мир map flat-facet error edge / corner | Patch tilt at 384 u |
|---|---|---|---|---|---|---|---|---|
| 32 000 | 27 | 367 u | 70 min | 5.6 min | 3.9 min | 10 | 148 / 295 u | 0.69° |
| **128 000** | **110** | **733 u** | 279 min | **22 min** | **7.8 min** | **12** | **37 / 74 u** | **0.17°** |
| 512 000 | 439 | 1466 u | 1117 min | 89 min | 15.5 min | 14 | 9 / 18 u | 0.04° |
The middle row keeps the existing map nearly flat, gives a ~20 min jet loop (owner's «облёт ~15–20 мин») and an 8 min orbit, and the horizon falls
where today's phone fog is (430–640 u). Moons and other planets: 16 000–64 000 u.

### 1.4 Phone budgets (targets for v1; the proof's measured values are in §12)
| Item | Phone (412 × 915, ×4 CPU, «средняя») | PC (high) |
|---|---|---|
| Terrain draw calls | ≤ 60 | ≤ 120 |
| Planet CPU per frame (selection amortised, budgeted integration, uniforms) | ≤ 1.5 ms | ≤ 0.5 ms |
| New chunks integrated per frame | ≤ 2 | ≤ 4 |
| Chunk build in a Worker | ≤ 15 ms | ≤ 4 ms |
| Chunk cache (GPU) | ≤ 260 chunks ≈ 7 MB | ≤ 480 ≈ 13 MB |
| Atmosphere | per-vertex only; no full-screen loops | same + finer shell |
| Memory after a 10-min flight | flat (no growth beyond the cache cap) | same |

## 2. Module map and API

### 2.1 PlanetProfile v1 (data; validated by `D37E.planet.def(p)`, unknown fields kept for game adapters)
```js
{ v: 1, id: 'home', title: 'Родная', seed: 37,
  radius: 128000,                          // u, sea-level radius
  sea: 0,                                  // sea level above radius (u); null — no ocean
  gen: 'rocky1',                           // generator id in D37E.planet.GEN (rocky1; later moon1, ice1, desert1, blocks, flatmap)
  relief: { amp: 2600, land: .42, hills: 140, detail: 7 },   // generator params (units u, land share 0…1)
  atmo: { top: 19200, Hr: 2400, Hm: 480, tauR: [.046, .108, .265], tauM: .03, g: .76, sun: 1 } | null,   // null — airless
  air: true, o2: .21, pressure: 1,         // gameplay: breathing, suits (Kubomir §6.4 «air»)
  g: 1,                                    // gravity relative to the home planet (player.gravity × g, jumps scale)
  day: 2400, phase: 0,                     // rotation period (s of game time) and sub-solar longitude at t = 0
  tilt: 23.4, year: 'calendar',            // axial tilt (deg); 'calendar' = owner's calendar via climate.js, else seconds
  temp: 14,                                // mean °C at sea level, equator → poles and altitude lapse in climate adapter
  orbit: { parent: 'sun', a: 4.0e9, e: 0, period: 'year', phase: 0 },   // on rails; moons use parent: '<planet id>'
  moons: [{ id: 'luna', radius: 32000, dist: 2.4e6, period: 5400, phase: 1.1, tint: '#c9c9c9' }],
  sky: { stars: 1, sunSize: 1 },
  regions: [{ id: 'mir', lat: 43.2, lon: 76.9, yaw: 0, kind: 'flatmap', half: 3072 }],   // pinned game regions (§10.1)
  hazards: [], mobs: [], requires: { rocket: 0 },                         // Kubomir §6.4 fields, unchanged meaning
  games: { kubomir: { … }, podzem: { … } } }                             // per-game extensions (block palettes, 2D biomes)
```

### 2.2 API (proof implements the starred items ★)
```js
const PL = D37E.planet;
PL.def(profile) → normalized profile ★                  PL.HOME — home planet profile ★
PL.create(def) → planet P:
  P.height(dx, dy, dz) → height above radius at unit direction (u) ★       P.surface(d, out) → { h, water, col… } ★
  P.dirOf(face, s, t, out) / P.faceOf(d) → cube mapping ★                    P.latLon(d) / P.dirFromLatLon(lat, lon) ★
  P.node(face, L, i, j) / P.select(camBF, opts, out) → leaves ★             P.balance(leaves) / P.stitch(leaf) → edge mask ★
  P.buildChunk(face, L, i, j, N) → typed arrays (Worker or page) ★          P.horizonVisible(chunk, camBF) ★
  P.patch(anchorDir) → frame { A, B, toBF, fromBF, height(x, z), water(x, z), up(x, y, z) } ★
  P.rebaseMap(oldPatch, newPatch) → { Q, t } ★                             P.region(d, level) → region key and anchor ★
  P.sunDir(tSec, ms, out) (body frame) ★ / P.localHour(d, tSec) ★ / P.season(ms) ★ / P.moonPos(tSec, out) ★
V = D37E.planetView(R, P, { workers, budget, maxLevel, onRebase }) — three.js view ★
  V.update(dt, camBF) / V.setAnchor(dir) ★ / V.physics(ph) — ph.terrain + ph.waterLevel in patch coords ★
  V.stats() ★ / V.dispose() ★ / V.toLocal(XYZ) / V.toBF(xyz) ★
```
Later (not in the proof): `PL.orbit` (on-rails Kepler), `PL.galaxy(seed)` (stars as data), `PL.edits` (per-region edits), `D37E.signal` (GPS/relays),
`D37E.biomes` (shared biome catalog with Kubomir/Podzem).

## 3. Coordinates, precision, floating origin
- **Body frame (BF)**: origin = planet centre, +Y = north pole (spin axis). Direction from latitude φ, longitude λ: `d = (cos φ cos λ, sin φ, −cos φ sin λ)`.
  Terrain, regions, edits and cities live here (fixed to the ground). Rotation only moves the sun, moon and stars.
- **System frame**: sun at origin; planet centres and moons on rails from time (no integration → the same for everybody, no network).
- **Patch frame (L)**: origin = anchor point `A` (sea-level point of a region centre), basis `B = [east, up, south]` (right-handed, three.js
  convention). Near the poles `east` uses +Z instead of +Y as reference (a smooth local choice; a rebase handles the switch).
  `p_L = Bᵀ (P_BF − A)`, `P_BF = A + B p_L`. Rebase old → new: `p_new = Q p_old + t`, `Q = B_newᵀ B_old`, `t = B_newᵀ (A_old − A_new)`; velocities use Q;
  yaw: rotate the forward vector by Q and project to the new horizontal plane.
- **GPU**: chunk vertices are float32 relative to the chunk centre `C` (double). Chunk matrix = `[Bᵀ | Bᵀ (C − A)]`, computed in double; three.js forms
  `modelView = view × model` in double on the CPU, so only small numbers reach float32 near the camera. Matrices change only on rebase.
- **Errors (M)**: at 10 000 km from the origin, double keeps ~1e-9 relative (≈ 0.01 mm); a vertex 2 u from the camera is placed with < 1e-4 u
  error through the pipeline, while "absolute float32" places it ~1 u off (§12, `planet-test` «точность»).
- Depth: near/far per frame from altitude (`near = clamp(0.05 × altitude above ground, 0.1, …)`, `far` = distance to the horizon plus the tallest
  mountain beyond it); the ocean is inside the terrain mesh, so no coplanar surfaces far away. Sky and stars are drawn at the far plane (`z = 0.99999 w`).

## 4. Terrain: cube-sphere quadtree LOD

### 4.1 Mapping, lattice, seams
- Faces `+X −X +Y −Y +Z −Z` with (u, v) axes so that `u × v = n`. Equi-angular warp `s' = tan(s π/4)` (area ratio across a face ≈ 1.41 (M), plain
  normalize ≈ 5.2). Node `(face, L, i, j)` covers `s ∈ [−1 + 2i/2^L, −1 + 2(i+1)/2^L]`; numeric key `((face·32 + L)·2^20 + i)·2^20 + j` (< 2^53).
- **Global lattice**: every vertex is an integer point on the cube of side `M = N·2^L`; the warp is applied per axis from that integer
  (`tan((2X/M − 1)π/4)`), so a vertex shared by two chunks (same face, other face, or one level coarser: `2X_c/M_c ≡ 4X_c/2M_c` exactly in IEEE)
  has bit-identical position and height. Seams are exact in double; float32 per chunk leaves ≤ 2e-6 u at the finest level, hidden by skirts.
- Normals: central differences on the chunk lattice with one extra ring computed beyond the face edge (warp extrapolated), so neighbours agree.

### 4.2 Selection, balance, stitching, culling (pure, tested in node)
- Split when `distance(camera, node bounding sphere) < K × node size` (K 2.0 PC / 1.6 phone), merge back at `× 1.15` (hysteresis); max level
  12 (3 u spacing, like `worldmap.js` 4 u). Re-select at most 8 times per second or when the camera moved a tenth of the finest visible size.
- **Balance (2:1)**: neighbours differ by ≤ 1 level; neighbours across cube edges are found by stepping half a cell outside the face square and
  re-projecting onto the cube (`p / max|p|`), which needs no adjacency tables.
- **Stitching**: each leaf picks one of 16 shared index buffers by its "coarser neighbour" edge mask. The border ring is four trapezoids (outer edge
  → inner square), triangulated by a zipper that skips odd outer vertices on stitched edges; interior quads use the same diagonal as physics.
- **Skirts** (radial, depth `2 + 6 %` of chunk size) cover transient two-level gaps while children load.
- **Horizon culling**: chunk cap (centre direction, angular radius, radius range) is hidden when the angle to the camera direction minus its radius
  exceeds `acos(r_sea/D) + acos(r_sea/r_max)` (r_sea is a safe occluder because the rendered surface never goes below sea level). Frustum culling
  is three.js's own per mesh.

### 4.3 Streaming
- Requests sorted by importance (size / distance); in flight ≤ 2 per Worker; 1 Worker on 4-core phones, 2 elsewhere; results are transferable
  typed arrays (positions float32 relative to centre, normals int8, colours/water uint8). The page integrates ≤ 2 (phone) / 4 (PC) per frame.
- A missing leaf is drawn by its nearest ready ancestor (its ready descendants are hidden) — no holes, no overlaps (same rule as `worldmap.js`).
- 6 root chunks are built on the page at start (≈ 2 ms each) and never evicted; LRU cache 260 / 480; CPU copies of uploaded arrays are dropped.
- No Worker (blocked, old browser): the same builder runs on the page, 1 chunk per frame within 3 ms.

### 4.4 Generator `rocky1`, biomes, water (deterministic, double)
- Seeded 3D gradient noise; continents = warped fbm; ridged mountains masked by land and a mountain belt; hills; fine detail (≈ 10 u) everywhere
  (the same function for every LOD, so shared vertices agree). ≈ 2 µs per sample on PC (M).
- Colours per vertex: temperature from latitude and altitude, moisture from low-frequency noise, slope → rock; beaches, grass, steppe, forest,
  desert, tundra, snow and ice caps; sea depth for water colour (alpha channel; 0 = land).
- Later: `D37E.biomes` shared catalog (Kubomir and Podzem use the same `biomeAt`), props (trees/rocks instanced per finest chunk), caves (§3.4 of the
  spec: smooth voxels near the player).

## 5. Gravity and the flat patch
- In the patch, terrain height is the exact rendered finest-level triangle under `(x, z)`: direction → face lattice → 3 vertex heights (cached by
  global lattice key, 4096-slot open hash, no garbage) → ray–plane in L. Curvature is included (sea drops `d²/2R` away from the anchor), so what you see
  is what you stand on.
- `ph.terrain.sample(x, z)` and `ph.waterLevel(x, z)` are the only hooks; `player.js`, `physics.js`, `vehicle*.js`, `build.js`, `climate.js`/`precip.js`
  keep working in L. Gravity is the patch −Y; its error grows as `distance/R` (0.17° at 384 u on the home planet), so regions are ~768 u and a rebase
  happens at most every ~400 u of travel.
- Rebase = one fixed step: `onRebase({ Q, t })` listeners move the player (`ch` position and velocity, yaw), camera rig, actors, vehicles, local
  bodies and particles; the physics height cache stays (keys are global). `R.cut()` and `R.shadowDirty()` after a rebase.
- Network: region anchors are deterministic (quadtree level `LR`), so everybody in a region shares the same L coordinates — `net.js`, presence and
  `mir-<регион>-<N>` channels send small local numbers; a player crossing regions moves channel (≤ 4 track per 31 s rule).
- Tiny planets (Studio parts, R < 2000 u) need re-anchoring every step and a gravity vector in `player.js` — a separate engine step (PL-10).

## 6. Light: day/night, seasons, sun, moons, stars
- Sub-solar point: latitude `δ`, longitude `λ_s(t) = phase − 2π t / day`; sun direction (BF) = `d(δ, λ_s)`. Local hour at longitude λ =
  `12 + (λ − λ_s) · 12/π (mod 24)` — day on one side of the planet, night on the other.
- Home planet: `δ = tilt · sin(φ · π/2)` with φ from `D37E.climate.calendar(ms).phase` (spring 0, summer 1, autumn 2, winter 3), so long days come with
  the owner's summer and winter stays in December–February. Other planets: φ from their own year.
- Moons on circular rails (period, distance, phase) in the inertial frame → BF by rotation; drawn as lit spheres at a scaled distance (same angular size)
  so they never leave the far plane. Stars: seeded points at the far plane, rotating with the sky, dimmed by sky brightness.
- Engine hand-off: while mounted, the view provides `E.sunAt` (patch-frame sun), so `R.setLighting` (called ≈ 4 times per second) colours the
  engine sun, sky light and reflections for characters and props; the engine dome is hidden (the atmosphere draws the sky); shadows are off in the
  proof (terrain uses its own lighting and a contact blob under the player; receiving engine shadows on near chunks is PL-4).

## 7. Atmosphere (orbit → ground, phone-friendly)
- Exponential Rayleigh and Mie layers (`Hr`, `Hm`), zenith optical depths `tauR`, `tauM` (Earth-like by default), Henyey–Greenstein g = 0.76.
- Optical depth to the sun at a point: Chapman-function approximation (Schüler, GPU Pro 3) — analytic, no tables. View-ray optical depth: accumulated
  over the samples. 5 samples for sky vertices, 3 for terrain vertices; phases per fragment; sun disc attenuated by the view transmittance.
- Meshes: a camera-centred sky dome (rings dense near the horizon) near the ground and a planet-centred shell (fine tessellation at the limb) for
  orbit, cross-faded by altitude — same function, so the fade is invisible. Terrain vertices get in-scatter + transmittance (aerial perspective).
- Cost is per vertex (≈ 2 k dome + ≈ 10 k shell + terrain vertices), so it scales with geometry, not with screen pixels.
- Later (PC «Ультра»): Hillaire sky-view LUT per frame; clouds layer; city lights on the night side; aerial perspective for engine materials (fog chunk).

## 8. Orbit ↔ surface without loading screens; layered loading
1. **Galaxy** (later): stars as seeded data (position, class, number of planets); a map, no meshes.
2. **System** (later): planets and moons on rails from the system seed; drawn as spheres/impostors.
3. **Planet from far**: the 6 root chunks + shell; nothing else is fetched.
4. **Descent**: quadtree refines under the budget; the parent stays until children are ready; Workers build ahead of the camera (importance).
5. **Near the player**: finest chunks + physics patch + region data (cities, edits); props and detail objects (PL-3).
6. **Very near**: creatures, items, interiors (existing systems in L).
- Flight model in the proof: free flight in BF doubles (speed grows with altitude, from 20 u/s near the ground to 50 000 u/s in high orbit), the
  anchor follows the sub-camera point when high (rebased every `max(256, 0.25 × altitude)`), and a region anchor below 1500 u. «Приземлиться»
  places the player on the ground under the camera; «Взлететь» returns to flight. Real ships (rocket physics, orbits) are SP-1.

## 9. Saving player edits per region; network frames
- Region key = `(planet id, LR node key)`; region data = `{ rev, ops: [...] }` — terrain brushes (raise/lower/flatten/paint: centre in region L,
  radius, strength), placed objects (kind, L position, yaw), removed generated props (seed ids).
- Height with edits = generator + Σ ops in reach; Workers get the ops of regions a chunk overlaps (chunk key includes the region revs → rebuilt on change).
- Storage: IndexedDB `d37-planet` per planet/region (offline, single player); server table `planet_edits(planet, region, rev, ops, owner)` with RLS,
  size caps and moderation like `ugc` (only for shared worlds; SQL in its own area file when it is built — PL-6).
- Positions over the network: region key + L coordinates (small floats). Ships in space: BF doubles (JSON numbers) with the patch computed by each client.

## 10. Adapters (each is a separate later task; sizes S < 1 agent run, M ≈ 1, L ≈ 2–3, XL ≥ 4)

### 10.1 «Мир Денчика» — the current map becomes one region of the home planet
- **M1 (L)**: the map (6144 u square, `worldmap.js`, zones, cities) stays exactly as it is, as a **flat facet** pinned at the `mir` region
  (`regions[].kind = 'flatmap'`). Outside the facet the planet terrain is generated by seed; a blend ring (≈ 3 km) joins the facet plane to the
  sphere (37–74 u at the facet edge for R = 128 000; ocean surface slope ≈ 0.7°, not visible). The planet view draws everything beyond `worldmap`'s
  far edge; the sky becomes the atmosphere when you climb. No edits in `mir*.js` beyond one hook to start the view.
- **M2 (L)**: physics outside the facet in region patches (cars, boats, planes keep `vehicle*.js`); climate by latitude (`climateAt` from the
  planet); network channels per region; the plane can leave the map and fly around the planet; time of day follows the planet's rotation
  (the 40-minute shared clock becomes the rotation period; night length then depends on season and latitude — decided: physical day/night).
- **M3 (M)**: «Реактивный самолёт» (cruise 600–800 u/s, ~20 min loop) and long routes from WORLD_MAP stage (г) as planet routes (airports on other
  continents are new regions with pads).
- **M4 (XL, optional, decide after M1 numbers)**: migrate zones to per-zone frames on the curved surface (each city flat in its own frame, natural
  terrain fully spherical) — removes the facet; only if the facet ring is noticeable.

### 10.2 «Кубомир» — block planets as a world type (cube-sphere vs torus, measured)
| | Cube-sphere blocks (6 face grids) | Wrapped torus (x, z modulo W) |
|---|---|---|
| Real round planet from orbit, sky and horizon | yes (same `planet-view` shell, orbit, moons) | no (only a fake "curved world" bend; no poles, no orbit view) |
| Block shape | distorted near cube edges/corners: area ratio across a face 1.41, max corner shear ≈ 30° (M) | perfect cubes everywhere |
| Physics (`V.moveBox`) | unchanged in face grid space; crossing a cube edge = rebase with a 90° turn | unchanged |
| Mesher cost on phone | + warp per vertex (≈ 0.02 µs/vertex in the Worker, < 2 % of mesh time (M)) or 10 ALU in the vertex shader | none |
| Chunk neighbours (light, AO) | across face edges need an index remap (special code at 12 edges and 8 corners) | modulo only |
| World size | bounded: R = 512 blocks → 6 × 50² ≈ 15 000 chunk columns | any |
| Fit with the Universe (rockets, other planets) | direct (PlanetProfile, same sun/orbit) | needs a separate fake space view |
**Recommendation**: keep the infinite flat world as the default; add «Планета» as a new world type using cube-sphere face grids for small block
planets (R 256–1024 blocks), depth layers to the core, gravity per face, sky/orbit/moons from `planet-view`. Torus only as a cheap "world wraps around"
option for flat worlds. Steps: **K-P1 (L)** face grids + warp + edge crossing + generator on the sphere; **K-P2 (M)** orbit view and the shell/sky
from `planet-view` + day/night from rotation; **K-P3 (L)** rockets and the Moon (E5 in kubomir-modpacks, same PlanetProfile; air/vacuum, `g`).

### 10.3 «Подземье» — 2D planets
- **P-P1 (M)**: «Планета» world option: the world wraps horizontally (x modulo circumference in tiles); the generator samples noise on a cylinder
  (cos/sin of x) so the wrap is seamless (new worlds only, genVer bump); the 2D sky uses the planet's day/night and moons.
- **P-P2 (M)**: other planets by rocket as separate 2D worlds (each a PlanetProfile with its own seed, gravity, air, palette); the flight is a short
  scene (natural ad pause, docs: universe spec §8).
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
  far geometry (e.g. clouds) needs a second depth range (two-pass) later.
- **Popping** when LOD changes: stitching removes cracks but not popping; geomorphing (CDLOD) is PL-2.
- **Engine coupling**: `render.js` forces `camera.far ≤ 3000` and owns fog/sky; the view overrides per frame and wraps `E.sunAt` while mounted;
  post-processing (AO, SSR, frame generation) assumes small depth ranges — the proof runs with them as the player's settings say; PL-4 makes this formal.
- **Workers** blocked or slow on old phones → main-thread fallback with a budget; root chunks always present.
- **Gravity tilt** grows with distance from the anchor: keep regions ~768 u on the home planet; tiny planets need PL-10.
- **Same gameplay on all devices**: rebase only at fixed-step boundaries, from positions (not from frame time); heights are pure functions.
- **Shader failures** (страж графики): new materials are plain `ShaderMaterial`s without engine chunks; test on ANGLE D3D11, SwiftShader, GL.
- **Other agents' files**: the proof touches only new files plus one hidden entry in `games.js` and a test line in `ci-run.cjs`.
- **Scope**: the Мир adapter must not stall Living City work (T-032…): M1 adds a view around the map without changing city files.

## 12. Proof (Part B): what was built and the numbers
_Filled in after the proof is measured._

## 13. Step list → board tasks
| Step | What | Size | After |
|---|---|---|---|
| PL-1 | This plan + proof (`planet.js`, `planet-worker.js`, `planet-view.js`, `/play/planet`, tests, phone measurements) | L | — (T-051) |
| PL-2 | LOD v2: geomorphing (no popping), screen-space error, prefetch along velocity, Worker pool tuning, GPU upload budget | M | PL-1 |
| PL-3 | Props and biomes: `D37E.biomes` shared catalog; trees/rocks instanced per finest chunk; colliders near the player | M | PL-1 |
| PL-4 | Engine integration: formal sun provider in `gfx.js`, terrain receives engine shadows, aerial perspective in the engine fog chunk, `climateAt` from latitude | M | PL-1 (after T-042, T-043) |
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
| SP-1 … SP-4 | Space path (§10.5) | L / M / L / XL | PL-9; SP-2 feeds Кубомир GPS (T-049 Phase 4) |
Order proposal: PL-2 and PL-4 next (quality and engine hand-off), then M1 (the owner sees his world on a planet), then PL-5 → M2, PL-9 → SP-1.
