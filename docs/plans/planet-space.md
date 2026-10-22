# Планета дальше: другие планеты, орбиты с физикой, спутники, метеориты, терраформирование (T-078)

Plan v1, 2026-10-22. Builds on `docs/plans/planet.md` (T-051: `D37E.planet`, PlanetProfile v1, the proof `/play/planet`, steps PL-*, adapters
M*/K-P*/P-P*/S-P*, space SP-1…SP-4), `docs/plans/universe-path.md` (eras E5–E7, «Owner decisions» 4, «Checking in a big world»),
`docs/superpowers/specs/2026-10-16-universe-design.md` (§3 техника, §4 живая планета, §7 космос, §8 честность), `docs/SEASONS.md` + `js/engine/climate.js`,
`docs/PHYSICS_PLAN.md`, `docs/plans/kubomir-modpacks.md` (§6.4 PlanetProfile, §7½ GPS-телефон, ретрансляторы), `docs/SERVER.md` (T-045, anti-cheat feed),
CLAUDE.md (мастер-инструкция, «Набеги» — server replay precedent). Idea source: the general mechanic of The Planet Crafter
(machines drive visible terraforming stages); the owner's local copy is only an installer — nothing opened or copied.
Units: engine units **u** (1 m = `E.UNIT` ≈ 1.1667 u); game gravity `g0 = 20·U = 23.33 u/s²` (player.js). **(M)** = computed by the design calculator
`E:\claude-tmp\t078\calc.mjs` (not game code, not in the repo); **(P)** = proposal to tune in the step.

## Для владельца (кратко, по-русски)
1. Другие планеты и луны — такие же «данные», как родная: каменные, океанские, ледяные, пустынные, огненные, ядовитые, газовые гиганты (без земли — летающие станции), пояса астероидов. Первые — «ручные» (Луна, Песчаная, Огненная, Ядовитая, Великан с лунами, Пояс), другие звёздные системы — от зерна.
2. Планеты и луны летят по настоящим орбитам (законы Кеплера) — у всех одинаково без сети: видно на небе, бывают затмения; с Луны родная планета всегда висит в одной точке неба.
3. Корабль — с настоящей физикой: тяжесть, топливо, ступени, сопротивление воздуха, нагрев при входе в атмосферу. На орбиту ≈ 2 минуты, один виток ≈ 11 минут; запуск на восток экономит топливо — планета крутится.
4. На телефоне — помощники: карта с линией полёта, «автопилот на орбиту», «перелёт к Луне», «автопосадка», «стыковка». Управление одинаковое на телефоне и ПК, автопилот у всех один.
5. Чтобы по сети не ждать часами, перелёт между телами идёт в «разгонном режиме» (Луна ≈ 5 мин, планеты ≈ 10 мин), а топливо и выгодные окна — честные. Можно задать план полёта и выйти — корабль долетит сам.
6. Спутники — настоящие объекты на орбитах: навигация (GPS), связь, погода, разведка. Работают, только пока спутник над горизонтом: 1 спутник — GPS «иногда и примерно», 3 на «неподвижной» орбите — ¾ планеты всегда, 18 — точно почти везде. В пещерах — ретрансляторы, в городах — вышки, у обратной стороны Луны связи нет без своего спутника.
7. Метеориты — по расписанию от зерна: на небе часто, крупные — редко и с предупреждением (телескоп, спутник, телефон). Кратер, жар, ударная волна; внутри — метеоритное железо и редкая руда, у каждого своя добыча. Где есть воздух, мелкие сгорают; на Луне — наоборот, мелкие падают часто.
8. Безопасность: метеориты никогда не падают на площадь с играми, детские земли и дома игроков; в поселения — только если там сами включили; всё повреждённое чинится, ничего не теряется навсегда.
9. Терраформирование: у планеты 6 «ручек» — давление, кислород, тепло, вода, жизнь, ядовитость. Машины игроков крутят их со временем (считает сервер): небо голубеет, тает лёд, появляются озёра, мох, трава, леса — потом можно дышать без шлема, приходят животные и новая эволюция. Только вместе: машины «назад» нет, этапы не откатываются, родная планета всегда стабильна, за 💎 ничего не ускорить.
10. Везде: «Мир Денчика» — космодром и телефон со спутниками; «Кубомир» — блочные планеты, ракеты, терраформирование блоками; «Подземье» — 2D-планеты и метеориты, как в Террарии; «Студия 3D» — планеты, орбиты и миссии без кода.
11. Порядок (§7): небесная механика → ракета на скрытой странице /play/planet → метеориты → спутники → связь под землёй → Луна (и открытая мини-игра «🚀 Ракета») → станции → типы планет → терраформирование; каждый шаг играется сам.
12. Нужны 5 твоих решений (§7.4): разгонный режим, кому служат спутники, где падают метеориты и «стримовый метеорит», темп терраформирования, состав и имена планет.

## 0. Decisions (one line each; the owner can change any of them)
- Everything is shared engine modules (no game owns space code): `D37E.orbit` (pure math, rails, prediction, transfers), `D37E.ship` (space flight
  physics and autopilots), `D37E.system` (systems as data), `D37E.signal` (coverage), `D37E.meteor` (schedule and impacts), `D37E.terraform`
  (planet variables and stages), `D37E.clock` (world time). Games add adapters. New files only; `planet.js`/`planet-view.js` get small additive hooks.
- Bodies are **data**: PlanetProfile v2 extends v1 (§1.1); one profile serves Мир, Кубомир, Подземье, Студия 3D; hero bodies by hand, others from seed.
- Celestial bodies move on **deterministic Kepler rails** as a pure function of world time; flyable bodies are Kepler-consistent (period from μ).
- Ships use **real Newtonian physics** (gravity ∝ 1/r², thrust, rocket equation, drag, heat) at the engine's fixed step 1/60 s, with **patched conics**
  (one body's gravity inside its sphere of influence) and **rails while coasting**. Same code in the browser and on the server (replay).
- Determinism across Chrome/Safari/Firefox/Node: orbit and ship math use only IEEE basic operations (+ − × ÷ sqrt) and their own polynomial
  `sin/cos/atan2/exp/log` (`O.m`), like td.js already avoids `sin/cos`; golden-value tests.
- Shared worlds never warp the world clock. Inter-body coasts run in the **transfer drive** («разгонный режим»: real geometry and Δv, compressed coast,
  §2.6); flight plans execute while the player is away. Solo worlds (Кубомир, Студия, Подземье) may warp their own clock.
- Satellites are server-registered objects with orbital elements; coverage = geometry (elevation above the local horizon, planet shadow, battery,
  rock/blocks above, relays). «Вне зоны — не работает» everywhere, including the in-world phone (T-072).
- Meteors: small ones from a public seed (cosmetic + small loot), big ones from a **server secret** revealed only through the player's warning tech;
  impacts never in protected zones (hub, kids' lands, homes; settlements opt in); damage repairable; loot personal and capped.
- Terraforming: 6 planet variables, machines on players' claims, **lazy server integration in 1-hour steps**, stages are monotone (floors), the home
  planet is locked (only regional «health», T-070).
- All server state of planets and space — ONE area file `planet.sql` (created by the first step that needs it — PS-1 with `world_now()`; PL-6 edits,
  space, meteors and terraforming append parts). Flight replay runs in a route of `api/pages.js` (`api/_lib/routes/space.js`, like `raid.js`) —
  no new Vercel function (10 of 12 used).
- Eras (universe-path): satellites and uncrewed rockets — late E5; crewed orbit and the orbital station — E6; the transfer drive, Луна, planets, terraforming —
  E7. The proof page, Кубомир, Подземье and Студия 3D use their own progression (no era gate).
- Age: space flight, satellites, meteors and terraforming are 6+ (cartoon, knockout instead of death); space combat stays out of this plan (12+, later).


## Owner decisions (22.10.2026) — they override the recommendations of §7

1. **Honest travel time first, faster ships later** (owner: «настоящие сначала, потом можно улучшать корабль — это будет ближе к
   будущему»): no transfer drive at the start — real coast times (Луна ≈ 1 h, planets long); engine tech upgrades by era/research
   shorten trips (better chemical → nuclear → ion/fusion → «future» drives), so speed is progression, never paid. Flight plans keep
   running while the player is away; design the waiting (station life, radio, cargo planning) so long trips are fun, not dead time.
2. **Satellites serve their owner's settlement; later cities can RENT coverage to others for денки** (owner: «для своего поселения,
   потом города можно давать в аренду пользоваться и получать за это деньги — система экономики»): satellite services become a
   business in the city economy (contracts, prices in a corridor, coverage SLA computed from real geometry, revenue to the owner
   settlement's treasury).
3. **Meteors fall everywhere except the kids' realm and the game hub** (owner: «везде, кроме детей и площади»): settlements, homes and
   bases can be hit; all damage is repairable or rolled back (nothing lost forever), warnings come first, danger is real but fair.
4. **Terraforming is slow: half a year and more** (owner: «медленнее — полгода и больше») — a long shared server goal; tune with the
   terra-sim script to that pace.
5. Home system names: start with Луна and Песчаная; the rest later.

## 1. Other planets and moons as data

### 1.1 PlanetProfile v2 (validated by `D37E.planet.def(p)`; v1 profiles upgrade silently; unknown fields kept for adapters)
```js
{ v: 2, id: 'desert', title: 'Песчаная', type: 'desert', system: 'home', hero: true, seed: 4242,
  radius: 64000, g: .6,                 // μ = g·g0·R² (5.73e10 u³/s², M); gas giants: g at the 1-bar level
  surface: 'solid',                     // 'solid' | 'none' (gas giant: no terrain, cloud deck)
  sea: null, liquid: null,              // sea level (u) and 'water' | 'lava' | 'methane' | null; terraforming may set water later
  gen: 'desert1', relief: { amp: 3200, dunes: 40, canyons: .6, craters: .3 },        // generator id + params (registry PL.GEN)
  air: { p: 6, o2: 0, co2: .95, n2: .03, toxic: 0, dust: .4 },                      // gameplay air (kPa, fractions); null — vacuum
  atmo: { top: 16000, Hr: 2000, Hm: 900, tint: '#d08a5a' },                         // visual scattering; omitted parts derived from air (§1.5)
  temp: { mean: -40, dayAmp: 35, latAmp: 30 }, climate: { kinds: ['dust', 'polar'], storm: 'dust' },
  day: 2600, tilt: 25, locked: false,   // locked: day = orbital period, one face to the parent
  orbit: { parent: 'sun', a: 6.0e9, e: .06, i: 1.8, node: 49, peri: 286, M0: 1.2, epoch: 0 },   // degrees; period from the parent μ
  rails: 'kepler',                      // 'kepler' (flyable) | 'visual' (decoration: may set its own period)
  rings: null, belt: null,              // rings { inner, outer, tint, alpha } · belt { a, width, density } (belt bodies only)
  moons: ['phob', 'deim'],              // child bodies (own profiles); v1 decorative moon objects stay allowed
  resources: [{ id: 'iron_ox', where: 'surface', k: 1 }, { id: 'ice', where: 'poles|buried', k: .6 }, { id: 'rare_earth', where: 'canyons', k: .2 }],
  hazards: ['thin_air', 'cold', 'dust_storm'], danger: 1, age: 6,                    // danger 0 calm … 3 harsh (soft for kids)
  meteors: { rate: 1, big: 1 },         // multipliers of the type defaults (§4.1)
  terra: { on: true, vars0: { p: 6, o2: 0, t: -40, w: .05, b: 0, x: 0 } },           // inertia = area ratio (R / R_home)², computed
  regions: [{ id: 'port', lat: 4, lon: 10, kind: 'spaceport' }],
  games: { kubomir: { palette: 'red_sand', size: 512 }, podzem: { tiles: 'mars', width: 4200 } } }
```
- v1 → v2: `orbit.period: 'year'` stays the owner's calendar for the home planet; decorative `moons[{ dist, period }]` stay as `rails: 'visual'`.
- **Kepler consistency (decision):** the v1 home moon (dist 2.4e6 u, period 16 800 s) breaks Kepler's law for the home μ. v2 Луна keeps the period
  (4.7 h, nice in the sky) and moves to **a = 1 398 144 u (10.9 R)** (M): angular diameter 2.6° instead of 1.5° — bigger, prettier, flyable.
- **Home seasons stay the owner's calendar** (climate.js φ), while the home planet's heliocentric position runs on a uniform 365.25-day rail (for
  the sky and transfers). The tiny mismatch (sun longitude vs calendar season) is invisible; other planets get seasons from their own orbit and tilt.

### 1.2 Body types (look, play, resources, dangers, phone budget on top of the planet.md terrain budget ≤ 60 calls)
| Type (gen) | Looks | Plays | Resources | Dangers | Phone extra |
|---|---|---|---|---|---|
| Rocky (`rocky1`, exists) | continents, seas, biomes | home-like; settlements | everything common | weather, PHYSICS_PLAN disasters | 0 |
| Ocean (`ocean1`) | 90–98 % water, archipelagos, trenches | floating bases, boats, diving (PL-8 water mesh, T-022c waves) | fish/algae food, salt, deep nodules | storms, depth (pressure) | +2 (water mesh) |
| Ice (`ice1`) | white-blue crust, crevasses, geysers, dark sky | sledges, drilling to the subsurface ocean (PL-7 caves later) | water ice, ammonia, deuterium | cold (suit heater energy), thin ice, whiteout | +1 (geyser pool) |
| Desert (`desert1`) | dunes along the wind, canyons, mesas, polar caps, red sky | rovers, dust storms, **first terraforming target** | iron oxide, silicon/glass, rare earths, buried ice | thin air, cold nights, dust storms (solar power ↓) | +1 (dust pool) |
| Lava (`lava1`) | black basalt, glowing rivers and lakes (emissive vertex colour), eruptions | tidally locked: eternal day side, frozen night side, playable terminator ring | obsidian, sulfur, heavy metals, geothermal power | heat (cooling), lava (knockout), scheduled eruptions | 0 (+ bloom on mid/high only) |
| Toxic (`toxic1`) | dense yellow air (300 u visibility), acid rain, hot surface | floating station above the clouds; surface trips in sealed rovers; late terraforming | sulfur chemicals, CO2, rare gases | toxicity (filters), corrosion (wear), pressure | 0 (atmosphere params) |
| Gas giant (`gas1`, view only) | banded sphere, storm ovals, rings and their shadow | cloud stations at the 1-bar deck, fuel scooping dives | hydrogen, helium-3 | depth (auto escape), drag heat | 2–3 total (sphere, rings, cloud layer); no terrain |
| Moon (`moon1`) | craters (same crater function as meteor impacts, §4.3), maria, regolith; black sky with the parent in it | low g, suits, landers, first base off-world | regolith (helium-3), polar ice in shadowed craters, titanium | vacuum, cold/heat by day, frequent small impacts | −2 (no sky dome and shell) |
| Asteroid belt (`belt` + `aster1`) | sector cells along a torus: 0–3 big rocks + many small | dock-to-mine (anchor, drill, cargo); walking needs PL-10 | iron-nickel, platinum group, carbon ice | soft bumps, no air | +2 (instanced rocks + points), ≤ 3 detailed rocks ≤ 12 calls |
All generators are pure functions of direction like `rocky1` (Worker-safe, shared vertices agree). Crater fields use one shared crater profile
(bowl + rim + ejecta) from a seeded catalog with size-frequency N(>D) ∝ D⁻² — the same function the meteor edits use, so natural and new craters match.

### 1.3 The home system «Система Денчика» (hero bodies, proposal P; numbers from the calculator where marked)
| Body | Type | R (u) | g | Day | Orbit | Year / period | Role |
|---|---|---|---|---|---|---|---|
| Солнце | star | — | μ = 2.54e15 (M, from the calendar year at a = 4e9) | — | — | — | light, seasons, transfer geometry |
| Огненная | lava | 48 000 | .5 | locked | sun, a 1.6e9 | 92 d (M) | heat, metals, eruptions |
| Ядовитая | toxic | 120 000 | .9 | 8 h, retrograde (the sun rises in the west) | sun, a 2.8e9 | 214 d (M) | floating station, late terraforming |
| **Родная** | rocky | 128 000 | 1 | 2 400 s | sun, a 4.0e9 | 365.25 d | home, spaceport |
| **Луна** | moon | 32 000 | .4 | locked (16 800 s) | home, a 1 398 144 (M) | 16 800 s | first landing, first base, terraforming 1 |
| **Песчаная** | desert | 64 000 | .6 | 2 600 s | sun, a 6.0e9 | 671 d (M) | terraforming 2, rovers |
| Фоб, Дейм | asteroid moonlets | 1 800 / 1 200 | micro | — | Песчаная | hours | first asteroid docking |
| Пояс | belt | — | — | — | sun, a ≈ 8.5e9 ± 0.6e9 | 1 131 d (M) | mining |
| Великан | gas giant + rings | 900 000 | 2.0 | 1 800 s | sun, a 1.6e10 | 2 922 d (M) | cloud station, fuel |
| Ледяная | ice moon | 40 000 | .3 | locked | Великан, a 4.0e6 | ≈ 2.3 h | water, geysers |
| Океания | ocean moon (tidally heated, hazy air) | 70 000 | .7 | locked | Великан, a 7.0e6 | ≈ 5.3 h | water world, terraforming 3 (O2 + heat) |
Bodies arrive one per step (§7); the catalog lives in `D37E.system.HOME` (data), the planet views use the same profiles.

### 1.4 Procedural bodies and systems (PS-16)
- `D37E.system.gen(seed)` → star class (colour, luminosity, μ), 3–9 planets by zone: inner hot (lava, desert), temperate (rocky, ocean, toxic),
  outer (ice, gas giants with 1–5 moons), one belt between inner and outer; spacing Titius–Bode-like with seeded noise; each profile from type ranges.
- Names: seeded syllables (Russian-friendly) + player discovery names (moderated; under-13 — preset builder, as universe-path §2.5).
- A procedural body is the same profile as a hero body; only `hero: false` and no pinned regions.

### 1.5 What the view and generators need
- Atmosphere derived from air when `atmo` parts are omitted: `tauR ∝ p / 101`, Mie from `dust` and `toxic` (yellow), tint from composition;
  vacuum → no sky dome and shell (−2 calls). Terraforming changes air → the same derivation (§5.3).
- Lava, ice, toxic, desert: vertex colours + emissive in the existing terrain shader (no new materials); geysers, dust, eruptions — `fx.js` pools.
- Gas giant (`gas1`): one sphere with a banded shader (latitude bands + noise + storms), ring mesh (radial texture by code, ring shadow analytic in the
  planet shader), cloud deck as the «ground» for stations (patch physics stands on station colliders; falling below the deck → auto glide back).
- Distant bodies: ONE instanced impostor draw call for all bodies (phase and limb in the shader), the parent planet in a moon's sky drawn the same way;
  satellites visible at dusk as moving points (sunlit while the ground is dark) — one Points call (≤ 64).
- New climate kinds for `C.CLIMATES` (additive): `vacuum` (no weather), `dust`, `polar_co2`, `ice_crust`, `lava`, `toxic` (acid rain as a precip state),
  `ocean_storm`; `C.world({ climateAt, … })` gets an optional `air` modifier from terraforming (§5.3). `C.exposure(s, o)` grows `o.air` (§1.6).

### 1.6 Dangers and suits (one function for all games)
- `D37E.planet.exposure(profile, place, gear, terra)` → `{ o2, cold, heat, toxic, press }` per second: suit tank (oxygen minutes), heater/cooler energy,
  filters. Depleted → slowed, then **knockout** (fade, wake at the nearest own base/ship/spaceport, items kept) — never death (master instruction).
- Kids: same rules, softer numbers (tanks ×2), clear warnings; no harsh planets (`danger 3`) for under-13 without «взрослый разрешил».

## 2. Orbits with physics

### 2.1 Frames and time
- **World clock** `D37E.clock`: `now()` = Date.now() + offset; offset from the Supabase RPC `world_now()` (ms, median of 3 with RTT/2, every 10 min),
  refined by T-045 server time and `net.js` host clocks. Seconds since the epoch `2026-01-01T00:00Z` in doubles. Before the first offset: Date.now().
  50 ms error ≈ 75 u at orbital speed — fine for visuals; docking is relative (§2.7), coverage has margins (§3.2). `planet.sql` not applied yet
  (PGRST202) → offset 0, everything still works locally.
- **System frame**: star at the origin; body positions = sum of rails up the parent chain. **PCI** (body-centred inertial, non-rotating): ship physics
  inside a body's sphere of influence (SOI). **BF** (planet.md: rotating with the body): terrain, regions, edits, air. **Patch L** (planet.md): walking,
  driving, landing near the ground.
- BF ↔ PCI: rotation by the spin angle `2π t / day` (with `O.m.sin/cos`). Air co-rotates: drag uses `v − ω × r`.

### 2.2 Bodies on rails (`D37E.orbit`, pure: node, Worker, page, server)
```js
const O = D37E.orbit;
O.m.sin / cos / atan2 / acos / exp / log           // deterministic polynomials, IEEE basic ops only; golden tests
O.el({ a, e, i, node, peri, M0, epoch }, mu)        // elements (radians inside), period from mu
O.state(el, t, out6) / O.fromState(mu, r, v, t, el) // Kepler (Newton 8 fixed iterations; hyperbolic too) ↔ state vectors
O.posAt(sys, id, t, out) / velAt                     // system frame, parent chain
O.soi(sys, id) · O.which(sys, pos, t)                // SOI radius r = a (m/M)^0.4 · deepest body containing a point
O.predict(sys, ship, t, horizon, out)                // patched segments [{ body, el, t0, t1, end: 'soi'|'impact'|'atmo'|'horizon' }] ≤ 6
O.hohmann(mu, r1, r2) · O.lambert(mu, r1, r2, tof, cw) // transfers (universal variables, fixed iterations)
O.drive(tofPhys) → real seconds                      // transfer drive rule (§2.6)
O.shadow(sys, pos, t) → 0…1                          // in a body's shadow (power, dusk visibility)
```
Moons and planets: no integration, no network; visible, eclipses happen by themselves (planet.md moon impostor generalised).

### 2.3 Ships (`D37E.ship`, pure physics + autopilots; `js/engine/vehicle-space.js` adds the `rocket` kind for the patch)
- State in PCI doubles: r, v, attitude (quaternion), mass, fuel per stage, heat, part damage. Gravity `−μ r/|r|³` of the SOI body only (patched conics).
- Thrust from engines along the attitude; mass flow `F / (Isp·g0)`; staging drops empty stages (they become debris on rails, removed after 10 min).
- Atmosphere: `ρ = ρ0·exp(−h/Hr)` (`O.m.exp`), drag `½ ρ |v_air| v_air Cd A / m`; **no drag above `atmo.top`** (hard top, as KSP; a stable low orbit
  at `top + 4 000`). Substeps in air: `1 + min(3, ⌊|v|/800⌋)` (from state, not frame time).
- Heat (Sutton–Graves): `q = k √(ρ/rn) |v|³`; shield ablates, cooling radiates; overheat damages parts, the capsule never breaks: knockout →
  parachute → lands somewhere safe (patch mode).
- **Rails when coasting**: no thrust and above the atmosphere → elements, analytic propagation (exact, free, warpable in solo); any force → physics.
- **Patch hand-off**: altitude < 1 500 u and ground-relative speed < 300 u/s → the `rocket` vehicle kind in patch L (flat gravity −Y, ground and water
  from `V.physics`, legs, collisions; like `vehicle-air.js` planes); back to PCI above 2 000 u or 400 u/s (hysteresis, at a fixed-step boundary).
- Ship design on phones: a **stack builder** (capsule/payload, 1–4 tanks, engine, side boosters, fairing, heat shield, legs, parachutes) from a catalog
  (mass, thrust, Isp, fuel, Cd, heat limits); Δv shown live. A free-form editor (spec §7, «как Spore») is cosmetics later.

### 2.4 Numbers for the home system (M unless marked)
| | Родная | Луна | Песчаная |
|---|---|---|---|
| Surface gravity / μ | 23.33 u/s² / 3.82e11 | 9.33 / 9.56e9 | 14.0 / 5.73e10 |
| Orbital speed at the surface / escape | 1 728 / 2 444 u/s | 547 / 773 | 947 / 1 339 |
| Low orbit (altitude) — speed, period | 36 000 — 1 527 u/s, **11.2 min** | 3 000 — 523, 7.0 min | 20 000 — 826, 10.6 min |
| Stationary orbit radius | 382 079 (period = day 2 400 s) | none: beyond the SOI (319 689) | 214 137 |
| Equator spin speed | 335 u/s (a launch east saves ≈ 330 u/s) | — | 155 |
| Δv surface → low orbit | **≈ 2 500 u/s, 130 s** (2D sim, T/W 1.5, simple gravity turn, east; 2 840 without the spin) | ≈ 650 (P) | ≈ 1 300 (P) |
- Low orbit → Луна: departure burn 516 u/s, physical coast **58 min**, v∞ 283, capture into low lunar orbit 269, landing ≈ 600 (P) → ≈ 1 400 u/s from
  low orbit to the lunar surface.
- Low orbit → stationary: 279 + 225 = 504 u/s, coast 12.1 min (real time is fine: inside the home zone).
- Interplanetary: the calendar year makes the sun's μ small, so from low home orbit **≈ 634–643 u/s reaches any planet** (v∞ 74–211 u/s), but physical
  Hohmann coasts last **107–722 days** → the transfer drive (§2.6). Capture and landing costs depend on the target (Песчаная: aerobraking possible).
- Reentry from low orbit at ≈ 1 527 u/s; from the Moon at ≈ 2 200 u/s → ≈ 3× the heat flux (v³): a heat shield becomes a real upgrade.

### 2.5 Controls and helpers (same physics on phone, PC, pad; T-043 menu rules; all actions rebindable in `controls.js`)
- **Phone**: left stick — attitude (SAS hold on by default), right vertical slider — throttle, big buttons: «Ступень», «🗺 Карта», «🤖 Автопилот ▾».
  **PC**: W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle, Z/X full/cut, Space stage, M map, T SAS, R RCS. **Pad**: left stick attitude, triggers
  throttle, Ⓐ stage, Ⓨ map, Ⓧ autopilot, LB/RB RCS mode.
- **Map**: the current orbit (ellipse), predicted segments through SOI changes (colours), apoapsis/periapsis with heights and «через 3:20», targets on
  their rails, encounter marker, reentry corridor (green band of periapsis heights), landing point estimate in air. ≤ 6 draw calls; prediction analytic
  (≤ 0.1 ms at 4 Hz), patched prediction ≤ 0.3 ms at 1 Hz, a short numeric prediction only in air (≤ 300 steps of 1 s, ≤ 0.2 ms).
- **Manoeuvre nodes without 3D gizmos**: tap the orbit → node; six «petal» buttons ± prograde / normal / radial (hold to repeat) + magnitude slider;
  «Выполнить» starts the burn at the right time. The planner offers one-tap plans: «На орбиту», «Скруглить», «Перелёт к Луне: 516 сейчас / 498 через 4 мин»,
  «Сойти с орбиты к космодрому», «Посадка», «Стыковка».
- **Autopilots** (deterministic input generators — their outputs go into the flight log, §2.9): ascent (gravity turn with apoapsis feedback, then
  circularize), circularize, node executor, transfer (Hohmann/Lambert + drive), suicide-burn landing (airless) and shield-first entry + parachutes +
  final burn (air), docking approach to 50 u. Records (fastest orbit, landing) count **manual** flights separately; autopilot is never an advantage in a
  rating with rewards.

### 2.6 Transfers and time in multiplayer
- **No global warp** in shared worlds (everyone shares one clock: rails, weather, day/night).
- **Transfer drive** («разгонный режим», a game rule like the spec's jump, honest about it in the UI): only for planner transfers between bodies. It
  compresses the planned coast between the departure burn and the capture burn: it engages when the departure burn ends and no other craft or station
  is within 2 000 u, and disengages 60 s before the capture burn. Real duration `T_real = T_phys` if ≤ 60 s, else `min(600, 60 + 45·log2(T_phys/60))` s
  (Луна: 58 min → ≈ 5.4 min; planets: 107–722 days → 10 min). The Lambert conic aims at where the target will really be at the drive exit; during the
  drive the ship slides along the drawn patched path by compressed time, ghosted (no contact) and shown as «в разгоне»; at the exit its state is the
  physical patched-conic state relative to the target, re-anchored to the target's real rail — the same rule on the server. Δv, fuel and windows stay
  real: Луна's cheap window returns every ≈ 12 min (the low-orbit synodic period); planets have cheap and expensive days, travel is always possible
  (the planner shows «сейчас» and «лучшее за 7 дней»).
- **Flight plans while away**: a plan = burns (time, Δv vector) + coasts; the ship's state is a pure function of time, so the player may close the app.
  Arrival is noticed lazily on the next visit («Корабль у Луны уже 2 ч») and by push if the existing `push-check` cron gets a tiny arrivals query.
- **Solo worlds** (Кубомир solo, Студия test, Подземье): classic warp ×1…×1000 while on rails (the world clock of that world warps; its weather and
  day follow).
- Waits near a body (e.g., half an orbit before a burn, ≤ 6 min) stay real time — plan and leave if bored.

### 2.7 Docking and stations
- Stations are server objects on rails (modules: core, power, docking ports, hab, hangar); built by settlements (E6 deed «орбитальная станция»).
- Docking: relative motion shown in the station's Hill frame (UI only), RCS translation joystick, «Подлететь» autopilot to 50 u, final approach assisted;
  magnetic capture at ≤ 0.6 u/s and ≤ 8°. Docked ships ride the station's rails (state = station elements + offset) — zero traffic.
- Inside: interior.js rooms; zero-g walking needs a gravity vector in `player.js` (PL-10) — «float» mode (push off walls, handrails).
- Anti-grief: no damage between players' craft (soft push, ghosting after 2 s of overlap); stations cannot be rammed; a docking is validated on the
  server from both registered plans (§2.9).

### 2.8 Reentry, landing, failures
- Entry corridor shown on the map; too steep → overheat → knockout + parachute; too shallow → skip back to space (aerobraking is a skill that saves fuel).
- Landing on airless bodies: suicide burn with margin; legs check slope (≤ 20°); dust particles (pool).
- Any crash: the craft becomes a wreck (repairable, towable, like the Мир car hulk) — rockets are spent consumables (fuel, stages), never «lost items».

### 2.9 Network, determinism, anti-cheat replay
- Registry is the network: coasting ships and satellites register elements/plans on change (RPC, rare); everyone computes positions — 0 realtime
  messages. Thrusting ships near others (stations, launch pads) send state + input on change at ≤ 5 Hz in a space channel `space-<body>-<zone>` (Supabase
  or T-045, ≤ 4 track/31 s rule), others extrapolate with the same physics.
- **Flight log**: start state (pad id or a registered plan), then input changes per step (throttle 0…255, attitude target quantized, stage, RCS) —
  2–8 KB per flight. Autopilots only produce inputs, so replays never depend on autopilot code versions.
- **Server replay** (precedent: raids): `POST /api/space` → `api/_lib/routes/space.js` (in `api/pages.js`) loads the claim, runs `OrbitSim` (a generated
  ESM copy of the pure ship/orbit code, like `make-raid-sim.mjs`) and calls `space_settle` (service_role only) to register a satellite, a landing, a
  docking or a delivery. Cost (P): 10 800 steps for a 3-min launch ≈ 5 ms in Node; coasts are analytic. Tolerance-based compare (relative 1e-9) in case a
  browser differs in an ulp. Claims without a valid replay are refused («полёт не сходится»).
- T-073 feed: space channels mark `in` events auditable (SERVER.md «Anti-cheat feed»); the checker samples replays; risk scores, never instant bans.
- Tests: same flight at 30/60/144 FPS → bit-identical result; replay = live; rails ↔ physics round trip; SOI hand-over; golden `O.m` values in node and Chrome.

## 3. Satellites as real objects (`D37E.signal`)

### 3.1 The satellite object
`{ id, owner, group: 'me'|'friends'|'settlement'|'public', type: 'nav'|'comm'|'weather'|'scan'|'relay', el (elements around a body), epoch, power:
{ solar, battery_min }, born, sleeping }` — server row in `planet.sql` (§App. A). Position = pure function of time. Power: sunlit unless in a body's
shadow (`O.shadow`); in shadow it runs on battery for `battery_min`; empty → that service is off until sunlight — deterministic, so everybody agrees.

### 3.2 Coverage geometry (M)
- A ground point sees a satellite when its elevation above the local horizon ≥ el_min (nav 10°, comm 5°, weather downlink 20°) — this also handles the
  planet blocking the line of sight. Low-elevation satellites (< 25°) also test terrain: 6 samples of `P.height` along the ray (2 Hz, only those).
- One satellite covers a cap: low orbit (r 164 000) 6.6 % of the planet, a pass ≤ 1.9 min of 11.2; r 320 000 — 22.6 %, a pass ≤ 9.7 min of 30.7;
  stationary (r 382 079) — 25.6 %, always the same place.
- Constellations at any moment (≥ 1 / ≥ 2 / ≥ 3 / ≥ 4 visible): 3 stationary — 76 % / 0 / 0 / 0 (poles uncovered); Walker 6/3/1 r 320 000 i 55° —
  83 / 47 / 7 / 0 %; 12/3/1 — 100 / 100 / 61 / 11 %; **18/3/1 — 100 / 100 / 98.5 / 79 %**; 24/4/1 — 100 / 100 / 100 / 98.9 %.
- Луна is locked: its far side never sees the home planet and it has no stationary orbit (beyond its SOI) → far-side bases need lunar relay satellites
  or ground relays — the owner's «вне зоны — не работает» by geometry.

### 3.3 Services and rules
- **Navigation (GPS)**, by usable nav satellites in view: 1 → «примерно» (circle ±400 u, direction to waypoints, «следующий пролёт через 4:30»); 2 → ±60 u;
  **3 on the ground → exact** (height is known from the map, as real receivers); 4 → exact in the air and in space. So the first satellite already helps
  (sometimes, roughly), 3 stationary ones cover the mid-latitudes, 18 make it exact almost everywhere.
- **Communication** (in-world phone apps: taxi, bank, in-world chat, alerts): quality 0…1 via a comm satellite, a city tower (E5 settlements, 2 000 u on
  the surface, not underground) or a relay chain. Towers alone give a rough position too («по вышкам»). The site phone (chat, friends, calls) always works
  (universe-path owner decision 4).
- **Weather**: the climate model is deterministic, so a weather satellite unlocks the forecast `W.at(x, z, future)` for N w-hours over its coverage and
  early storm/tornado/tsunami warnings (PHYSICS_PLAN: 60 s → 3–5 min with a satellite).
- **Scan**: maps the ground track (the planet map fog lifts like a mapping satellite), shows resource deposits from the generator, detects big meteors
  early (§4.2), reads terraforming variables of other bodies.
- **Relay satellite**: carries comm between bodies (Луна far side, other planets: «связь с домом»).

### 3.4 Underground, caves, buildings, relays, towers
- Attenuation: smooth planet — rock above the head (surface height − y; caves PL-7) → > 3 u of rock = no sky signal; Кубомир — along the ray to the satellite
  (≤ 64 blocks): stone −8 dB, dirt −6, water −4, wood −3, glass/leaves −1, margin 20 dB; Подземье — tiles above the player in the column (same table).
  Buildings: settlements from E5 have indoor repeaters (no loss inside), metro stations included.
- **Relays** (craftable/buildable, need power): range 120 u underground / 600 u in the open, line of sight between relays (one ray each, terrain or
  blocks), a graph per region; BFS from nodes with sky or tower signal, recomputed only when a relay or nearby terrain edit changes (cached). A player is
  covered when within range of a covered relay with line of sight (≤ 3 rays per query, 2 Hz). Quality drops 10 % per hop. Dead zone → «нет сигнала».
- Ground stations (E5): uplink for comm satellites and a free cap of tower coverage; a settlement's first satellite needs one.

### 3.5 Ownership, caps, kids
- A satellite serves its group: owner, friends, settlement + allies, or everybody (switch per satellite; decision 2). No harm between satellites.
- Caps (P): 6 per player, 24 per settlement per body; the stationary ring has **36 slots of 10°** (a real-world-like rule) — first come; a slot of an owner
  inactive 90 days falls asleep and frees after 180 days (the satellite keeps working for its group until then; nothing deleted).
- Satellites never decay above the atmosphere; deorbit only by the owner. Kids may launch and use satellites. Names of craft, satellites and stations:
  presets under 13, filtered and moderated text otherwise, always rendered through textContent.

### 3.6 API and adapters
```js
const S = D37E.signal.create({ geo: 'sphere'|'blockPlanet'|'blockFlat'|'circle2d', body, sats: () => list, towers, relays,
                               rock(x, y, z, dx, dy, dz) → dB, groups });
S.at(pos, t, who, out) → { nav: { n, fix: 0…3, acc }, comm: { q, via: 'sat'|'tower'|'relay'|'' }, weather, scan, next }   // ≤ 0.05 ms, 2 Hz
S.passes(pos, t0, t1) → [{ sat, rise, set, maxEl }] · S.relaysChanged(region) · S.stats()
```
- `blockFlat` (infinite Кубомир worlds): no orbit geometry — a satellite gives coverage in passes (`period`, `onShare`) or always (stationary item);
  `circle2d` (Подземье): a satellite at angle θ(t) covers |Δθ| < arccos(R/r) − margin.
- UX: phone status bar 📶 + 🛰 n/4; apps grey out with the reason («под землёй — поставь ретранслятор», «спутник появится через 3:10»); GPS dot with an
  accuracy circle.

## 4. Meteorites (`D37E.meteor`)

### 4.1 Schedule (deterministic)
- **Small and showers — public seed**: each real hour of each body has `hash(seed, body, hour)` → shower or not, streak times and directions, small
  impacts. **Big — server secret**: `HMAC(secret, body, week)` → 0–2 events per week per body, created lazily by `meteor_upcoming()`; returned only inside
  the caller's warning horizon; once revealed everybody gets the same record (place, time, size, composition, seed).
- Air matters (logical): streaks need air; small rocks burn up in air (fireballs/airbursts), while airless bodies get frequent small impacts.
| Body (P) | Streaks | Fireballs / airbursts | Small impacts (crater r 2–6 u) | Big impacts (r 25–80 u) | Huge (r 150–300 u) |
|---|---|---|---|---|---|
| Родная | 2 showers a day (20–60 streaks in 20 min), 1 per 5 min at night | ≈ 1 a day | iron only, ≈ 1 per 2 days in the wild | ≈ 1 a week, warning ≥ 2 h with tech | owner-scheduled only (stream event) |
| Луна, airless | none (flashes of impacts) | — | 1 per 10 min somewhere (≈ 1 per hour within 2 km) | 1 per 3 days | owner only |
| Песчаная (thin air) | rare | some | 1 per 30 min | 1 a week | owner only |
| Terraformed ≥ stage 2 | as Родная | as Родная | small ones burn up — «небо защищает» | unchanged | — |

### 4.2 Warnings
- Without tech: a glowing trail and a growing roar ≈ 60 s before a big one (everyone nearby). Telescope (E3 observatory, Кубомир item): big events 2 h ahead
  with the place on the map. Scan/weather satellite coverage: 24 h ahead. In-world phone alert at T−10 min and T−2 min — only with comm coverage (logic).
- Owner/admin stream events (`meteor_admin_add`) are announced site-wide (event banner like holidays); natural ones are not.

### 4.3 Impact physics
- Entry: a streak/fireball from the event direction; airburst if the place is protected (§4.5) or the rock is small; otherwise impact.
- Crater = a planet edit op `{ op: 'crater', c: [x, z], r, depth, rim, seed }` in the region data of PL-6 (the same crater function as `moon1`); before
  PL-6 the 3D impact is a temporary scorch decal + rock props that vanish on the place's restore time. Wild-land craters fade to 30 % depth over 14 days
  and grass returns; big ones stay as named landmarks («Кратер 12 ноября»), crater lakes when it rains.
- Shock: `D37E.destruct.hit(x, z, 3r, dmg)` (props, trees), `D37E.support` (T-022a) recomputes buildings near; players: knockback within 6r, camera shake by
  energy/d², knockout only inside 1.5r (never death); vehicles pushed. Heat: hot rock glows and cools 2 min; fire radius 2r in flammable biomes (PHYSICS_PLAN
  §4 when built; rain puts it out). Sound arrives `d / 400 u/s` later (343 m/s × U). An ocean impact of the huge class triggers the PHYSICS_PLAN tsunami
  event (when built) with its own warnings.

### 4.4 Rewards
- Composition from the seed: stone, iron (meteorite iron), ice (water — Луна!), rare («звёздный металл» for late tools and ship parts).
- **Personal loot**: everybody near at impact (≤ 600 u) or arriving within 30 min gets their own pile (spawned locally from the event seed + player id);
  the server checks a claim (event id, time window, the player's region from presence/region host, daily caps). No fights over loot, kid-safe.
- Amounts (P): small 1–3 pieces, big 10–20 + rare chance, huge 30+ guaranteed rare; daily cap per account; Кубомир/Подземье worlds — their own items.

### 4.5 Safety rules (all worlds)
- Never: the hub/game plaza, kids' town and 0+ lands (+300 m), plots district homes, raid-protected bases, spawn points, launch pads and
  spaceports. Protection is decided by clients from zone data (protected → airburst only), so a wrong server place can never hit a protected zone.
- Opt-in danger levels per place: «нет» (default for settlements), «можно» (settlement vote; more loot), wild lands — on (decision 3). Battle zone: on
  (12+, auto-repair as destruct already does). Кубомир/Подземье: world option «выкл / только небо / падают вдали от построек (default) / везде».
- Nothing lost forever: buildings become «повреждённые» (repair job, NATIONS rule) or restore after the place's time; Кубомир «везде» is the player's
  own choice for his world. Players cannot summon meteors (no weapon or item does it); only the server secret and the owner.

### 4.6 2D and 3D adapters
- `M = D37E.meteor.create({ body, seed, zones, danger, big: () => events })` · `M.at(t0, t1, out)` → events · `M.warning(ev, tech)` · `M.effects(ev)` →
  { crater, shock, knock, fire, sound } · adapters turn a crater into an edit: planet region op, Кубомир voxel carve (sphere + rim + «метеоритное железо»
  blocks + hot glowing blocks), Подземье tile carve (circle + rim + meteorite ore tiles, hot until cooled, like Terraria's meteor event), Студия part.
- Budget: schedule O(1) per minute; streaks one pooled LineSegments (≤ 32); impact effects from `fx.js` pools; the crater edit rebuilds 1–4 chunks under
  the normal LOD budget.

## 5. Terraforming (`D37E.terraform`)

### 5.1 Planet-level variables (spec §4.2 «Планета» level)
| Var | Unit | Meaning | Visual drivers |
|---|---|---|---|
| p | kPa | air pressure (home 101) | haze → blue sky (tauR ∝ p), sunsets, small meteors burn up |
| o2 | % of air | oxygen | breathing without a mask |
| t | °C mean | temperature | ice caps (iceAt shift), frost, rain vs snow |
| w | 0…1 | water: share of basins filled | sea level `= h_min + w·basinDepth`, clouds, rain |
| b | 0…1 | biomass cover of fertile land | moss → grass → forests (terrain colours, PL-3 props) |
| x | 0…1 | toxicity | yellow fog, acid rain, plants die above .2 |

### 5.2 Machines and processes (server-trusted, lazy)
- Machines are buildings on the player's claims on that body (PL-6 claims): Нагреватель (t+), Испаритель льда (w+, p+), Газовый завод (p+), Кислородная
  ферма (o2+, needs w ≥ .05), Биокупол/семена (b+, needs stage ≥ 6), Очиститель (x−), Орбитальное зеркало (t+, a satellite-like object — ties §3 and §5),
  Магнитный щит (stops the leak, one per body, settlement project), «Комета с водой» (late project: a scheduled icy impact in the target's wild lands,
  w+ big, makes a crater lake — ties §4 and §5). Each machine has a power need; base power (solar weaker far from the sun, geothermal on lava) scales its rate.
- Model per hour step: `v += Σ machine rates / A + natural couplings − leak`, `A = (R / R_home)²` (machines fight the body's size; natural processes
  act on the intensive variables directly). Couplings (P): greenhouse
  `t += α·log(1 + p/p0)`; ice melts above −5 °C into w (from the polar ice reservoir); plants grow logistically if w > .1, t > 2, x < .1, p > 10 and
  produce o2; rain washes toxicity. Leak: `dp −= p·leak(g)` without the shield (half-life 30 days on Луна).
- **Lazy integration**: the server stores `(vars, anchor time, machine set hash)`; `terra_state(body)` integrates from the anchor to now in 1-hour steps
  (catch-up > 60 days → 6-hour steps) and writes the anchor back at most once per hour; every machine change re-anchors. The same JS (`D37E.terraform.sim`)
  predicts between fetches; parity on random histories (as `base_act`) in PGlite.
- **Floors**: reaching a stage records a milestone; variables never fall below the thresholds of reached stages (leak and coupling stop there) —
  progress is never lost.

### 5.3 Stages and what everyone sees (thresholds P)
| # | Stage | Condition | What changes |
|---|---|---|---|
| 0 | Мёртвая | p < 1 | black sky, stars by day, sharp shadows |
| 1 | Дымка | p ≥ 1 | thin haze on the horizon |
| 2 | Голубое небо | p ≥ 15, x < .5 | blue day sky, red sunsets, small meteors burn up |
| 3 | Облака | w ≥ .05, t ≥ −30 | thin clouds, frost at dawn |
| 4 | Таяние | t ≥ −5 | polar caps shrink, puddles in season |
| 5 | Озёра | t ≥ 2, w ≥ .15 | lowlands fill (sea level), rain |
| 6 | Мох | b ≥ .02, x < .2 | grey-green rocks, lichen props |
| 7 | Трава | b ≥ .15, o2 ≥ 3 | grass colours and props |
| 8 | Леса | b ≥ .4, t ≥ 8 | trees (PL-3 densities by biome) |
| 9 | Можно дышать | o2 ≥ 16, p ≥ 60, x < .05 | no mask; suits off |
| 10 | Живая | b ≥ .6, w ≥ .3 | animals, tide pools → evolution (§5.5) |
- `T.apply(profile, vars)` → view and climate params (atmosphere derivation §1.5, `tOff`, ice shift, sea level, green factor, cloud factor, fog).
  Clients fetch `terra_state` on entering the body and every 10 min (cached).
- **Sea level changes rebuild terrain chunks**: the ocean is part of the chunk mesh (planet.md §0), so sea level is quantized (1 % of the basin depth)
  and joins the chunk cache key; a step rebuilds visible chunks under the LOD budget, at most once per real hour.

### 5.4 Pace (decision 4; tuned by a `terra-sim` script like `economy-sim`)
- Calibrate machine rates so a simulated community of 20 active players (≤ 3 machines each, 1 h a day) reaches stage 9 on **Луна (A = 1/16) in 6–8
  weeks** and on **Песчаная (A = 1/4) in 3–4 months**; Океания (A ≈ 0.3, water present) ≈ 2 months; a full-size planet needs a big alliance (≈ a year).
- Stage 2 «Голубое небо» on Луна in ≈ 1 week — an early visible reward (stream moment).

### 5.5 Life and evolution
- Stage 10 adds «первичный океан» tide pools on the body's coasts: new lineages can start there (the cell stage of universe-path T-056 on another world).
- Seeding: settlements release approved species (T-057/T-059 designs, reviewed; children see approved ones only) as wildlife adapted to the body's g
  (low g — taller, lighter animals by the creature rig rules).

### 5.6 Economy
- Machines cost денки and planet materials (each body has unique resources → space trade, E7); **no 💎, no boosts** (red line «бусты — только опыт и сезонный
  путь»). Rewards for contributions are cosmetic (titles «Терраформер», frames) and a place in the body's «Летопись»; new breathable land → new settlements.

### 5.7 Multiplayer ownership and anti-grief
- Variables are shared per body (one realm-independent world; inhabitants may split by realm later). Contributions add up — cooperative by design.
- No negative machines in shared worlds (only Очиститель lowers toxicity — a positive change). Machines only on own claims; caps (P): 6 per player,
  30 per settlement per body; machines of owners inactive 30 days sleep (not deleted; floors keep progress). Twins: device/IP marks as `city_marks`.
- Kids take part fully (peaceful, cooperative).

### 5.8 The home planet stays stable
- Home variables are locked. Only T-070 «planet health» per region (pollution, forest cover) moves inside a corridor (≤ 30 % visual effect), cleaned by era
  deeds; no player or event can make the home planet uninhabitable; home sea level never changes (cities).

## 6. «Везде»: every game, shared modules only
| Module | Мир Денчика | Кубомир | Подземье | Студия 3D |
|---|---|---|---|---|
| `D37E.system` + PlanetProfile v2 | home system in the sky, spaceport region | block planets as bodies (K-P1/K-P2), other block planets by rocket | 2D planets/moons as worlds (P-P1/P-P2) | world type «Планета», Planet part |
| `D37E.orbit` + `D37E.ship` | rockets from the spaceport, stations (E6), Луна and planets (E7) | rocket between block planets (solo warp allowed; co-op host T-019) | rocket scene with a 2D orbit mini-map | Rocket part, Orbit mover (Kepler rails), «Космическая миссия» mode |
| `D37E.signal` | in-world phone apps (T-072), towers, metro relays | GPS phone accessory (T-049 phase 4), relays through blocks | GPS accessory, relays through tiles | Satellite part with a coverage zone |
| `D37E.meteor` | showers, wild-land impacts, owner stream event | world option, voxel craters, meteorite iron | night event like Terraria, tile crater, meteor ore | Meteor spawner part |
| `D37E.terraform` | colonies on Луна/Песчаная; home health only | machine blocks change world vars: sky, ice → water, lakes in lowest unedited columns, grass spreads on unedited dirt | lite: sky gradient, ice tiles melt, grass and trees spread | world variables + Terraform machine part |
- **Мир Денчика** (after T-076 M1/M2): a spaceport region (pad, assembly hangar, control room, telescope), launches in the shared world, satellites passing
  at dusk, the in-world phone needs coverage (site phone always works), meteors in wild lands, the owner's weekly stream meteor; kids' town untouched.
- **Кубомир**: rockets and planets stay inside the player's world family (each world its own system; satellites saved in the world, synced to co-op
  guests); impacts default «вдали от построек» (no impact in chunks with player edits within the crater radius).
- **Подземье**: a planet world wraps (P-P1); other 2D planets by rocket (P-P2, a short flight scene — natural ad pause); meteor event at night (opt-in).
- **Студия 3D**: no code: parts Planet, Moon, Orbit mover, Rocket, Satellite, Meteor spawner, Terraform machine, Gravity zone (PL-10); mode «Космическая
  миссия» (objectives: altitude, orbit, land on X, dock, deploy satellite, collect meteorite); scripts `Orbit.*`, `Signal.*`, `Meteor.*`, `Terraform.*` in
  JS, Lua, C#, Java (table-driven like `Weather.*`).
- **The site**: a public mini-game «🚀 Ракета» (`/games/raketa`, SEO «симулятор ракеты онлайн», daily challenges «выведи спутник на заданную орбиту»,
  manual records only) once Луна works (PS-6); share cards «Я сел на Луну за 4:12»; ads only at natural pauses (between flights, the drive start screen),
  never during a burn; 💎 — cosmetics only (ship and satellite paint, launch trails, station decor).

## 7. Build order, risks, owner decisions

### 7.1 Steps → board tasks (sizes as planet.md: S < 1 agent run, M ≈ 1, L ≈ 2–3, XL ≥ 4; each step playable alone)
| Step | What (playable result) | Size | After | Main files |
|---|---|---|---|---|
| **PS-1** | «Небесная механика»: `D37E.orbit` (rails, elements, SOI, prediction, Hohmann/Lambert, `O.m`), `D37E.clock` + `world_now()`, PlanetProfile v2 (`PL.def` upgrade, Kepler Луна), `D37E.system.HOME`; on `/play/planet` the sky shows Луна and planets moving on rails + a «🪐 Система» map. Replaces PL-9. | M | PL-1 (T-051 ✅) | new `orbit.js`, `system.js`, `space-view.js`; additive `planet.js` v2; `planet.sql` part «time»; `orbit-test.cjs` |
| **PS-2** | «Ракета: на орбиту и обратно» on `/play/planet`: stack builder, `D37E.ship` (thrust, staging, drag, heat, rails), `rocket` patch kind, map with prediction, autopilots (ascent, circularize, deorbit, landing), knockout, flight log + replay test (30/60/144 FPS) | L | PS-1; T-075 (PL-2/PL-4) recommended | new `ship.js`, `vehicle-space.js`; `planet-demo.js`; `ship-test.cjs` |
| **PS-3** | «Метеориты»: `D37E.meteor` (public schedule, streaks, fireballs, airbursts, warnings, effects), `meteor_upcoming`/`meteor_claim` in `planet.sql`, adapters: `/play/planet` (temporary craters), Кубомир (voxel craters, meteorite iron, world option), Подземье (tile event) | M | PS-1; Кубомир/Подземье adapters after their running lanes (T-074…); T-022a optional | new `meteor.js`; small adapter files per game |
| **PS-4** | «Спутники»: payload types, release to orbit, server registry + `/api/space` replay route + `space_settle`, `D37E.signal` (sphere: elevation, shadow, battery, GPS levels, comm, weather forecast, scan), phone status UI and coverage map on the proof page | M | PS-2 | new `signal.js`, `api/_lib/routes/space.js`, `api/_lib/orbit-sim.js` (generated); `ship.js` (payload release); `planet.sql` part «space» |
| **PS-5** | «Связь под землёй и в городах»: relays, towers, ground stations, attenuation (sphere / blockPlanet / blockFlat / circle2d adapters); hooks for the in-world phone (T-072) and Кубомир GPS accessory (T-049 phase 4) | M | PS-4 | `signal.js` adapters; game hooks by their lanes |
| **PS-6** | «Луна»: `moon1` generator, vacuum, g .4, suits and oxygen (`exposure`), transfer planner + drive, landing autopilot, a first lunar base claim; first-landing share card; public mini-game «🚀 Ракета» (keys in `games-more.sql`, SEO page in `games-seo.js`) | L | PS-2 (PS-4 recommended); PL-5 | `planet.js` GEN, `ship.js`, new `raketa.js` game page |
| PS-7 | «Стыковка и станция»: stations on rails (server), docking assist, zero-g walking, hangar/spawn | M | PS-2, PL-10 | `ship.js`, `player.js` (float mode), `planet.sql` |
| PS-8 | «Типы планет и система Денчика»: `desert1`, `ice1`, `lava1`, `toxic1`, `ocean1` (+ PL-8), `gas1` view + rings + cloud station, belt field + `aster1`, new climate kinds, dangers; hero bodies of §1.3 | L | PS-6; T-075, T-077 (PL-3); PL-8 + T-022c for the ocean | `planet.js` GEN, `space-view.js`, `climate.js` (additive) |
| PS-9 | «Терраформирование, этап 1» on Луна, then Песчаная: `D37E.terraform` (vars, machines, lazy sim, floors, stages, `T.apply`), `planet.sql` part «terra», `terra-sim` pace check, «Терраформеры» chronicle | L | PS-6 (Луна), PS-8 (Песчаная); PL-6 (claims) | new `terraform.js`; `planet.sql` |
| PS-10 | «Мир Денчика: космодром»: spaceport region, launches from the shared world, satellites in the sky and the in-world phone, wild-land meteors, owner stream meteor | L | T-076 (M1), M2, PS-4, PS-5; era logic after T-067 | `mir-*` hooks by the Мир lane |
| PS-11 | «Кубомир в космосе»: rockets between block planets, per-world satellites, terraforming with blocks | M | K-P1, K-P2, PS-2, PS-9, T-019 | Кубомир adapters |
| PS-12 | «Подземье в космосе»: rocket scene, 2D satellites, terraforming lite | M | P-P1, P-P2, PS-3, PS-5 | Подземье adapters |
| PS-13 | «Студия 3D: космос без кода»: parts, «Космическая миссия» mode, scripts in 4 languages | S–M | PS-2, S-P1, S-P2 | `studio3d-*` extension files |
| PS-14 | «Полёты по сети»: space channels on T-045/T-071, station hosts, region-authoritative impacts and edits, T-073 auditable inputs | L | T-045 ✅, T-071, T-073, PS-7 | `net.js` region channels, server |
| PS-15 | «Жизнь на новой планете»: tide pools and seeding on terraformed worlds | M | PS-9, T-056, T-059 | evolution adapters |
| PS-16 | «Другие системы и галактика» (old SP-4): `system.gen(seed)`, jump, discovery names, colonies | XL | PS-8, PS-14 | `system.js`, views |

### 7.2 Mapping and lanes
- planet.md SP-1 → PS-1 + PS-2 + PS-4 (registration); SP-2 → PS-4 + PS-5; SP-3 → PS-6; SP-4 → PS-16; PL-9 → PS-1. The coordinator adds a pointer to this file in planet.md §10.5/§13 and universe-path §6.2 row 20.
- Lanes (disjoint files, 4–6 agents at once with the other work): **«Полёт»** (`ship.js`, `vehicle-space.js`, `planet-demo.js`): PS-2 → PS-4 → PS-6 →
  PS-7 (PS-7 after PL-10); **«Небо»** (`meteor.js`, `signal.js` adapters): PS-3 (parallel with PS-2) → PS-5 (after PS-4); **«Планеты»** (`planet.js` GEN,
  `space-view.js`, `climate.js`, `terraform.js`): PS-8 (after PS-6, T-075, T-077) → PS-9. PS-1 first, alone. Adapters PS-10…PS-13 by the owning game lanes
  when their prerequisites land; PS-14…PS-16 last.
- Done means (every step, universe-path §6.4): phone/PC/pad; same results at 30/60/144 FPS; numbers before/after on the phone profile (CPU ×4,
  «средняя»): frame CPU, draw calls; no per-frame garbage; 20 open/close without leaks; a 10–15 min soak without errors; fallbacks (no SQL → local trial
  mode; no Worker → budgeted main thread; broken shader → the graphics guard); `planet.sql` twice in PGlite + JS ↔ SQL parity; `GAMES_VER` bumped;
  REST checks for the owner in CLAUDE.md «Ожидает запуска».
- Budgets per step (phone profile): ship step ≤ 0.02 ms (≤ 0.08 with air substeps); map ≤ 6 calls; impostors 1 call; satellites 1 call; signal query
  ≤ 0.05 ms at 2 Hz; meteor schedule O(1)/min, streaks 1 call; terraform: 0 per frame (fetch every 10 min); total frame within planet.md §1.4 (≤ 16 ms).

### 7.3 Risks
| Risk | Mitigation |
|---|---|
| Scope (space is huge) | each step playable alone on the hidden page first; stop points after PS-2, PS-4, PS-6; shared modules reused by four games |
| Determinism across browsers (`Math.sin/exp` differ in the last bit between engines) | `O.m` polynomials with basic IEEE ops; golden tests in node and Chrome; tolerance compare in replays; a real-iPhone check in PS-2 |
| Clock skew between clients | `D37E.clock` offset from `world_now()` and T-045; relative docking; coverage margins (±1°) and hysteresis |
| «Это не физика» (the drive) | honest UI («разгонный режим», shows the physical time); real Δv, fuel and windows; solo worlds may warp for real; owner decision 1 |
| Phone performance with more bodies and effects | impostors in one call, pooled effects, no atmosphere shell on airless bodies, budgets above, measured each step |
| Free tier (500 MB, 2 M realtime messages) | registry instead of streams (coasting craft 0 messages), elements on change, cached meteor events, one terraform row per body |
| Cheating (fake satellites, loot, docking) | server replay of flights (raids precedent), plan validation, caps and time windows, T-073 sampling |
| Grief (satellite spam, slot squatting, ramming, impacts) | caps, 36 stationary slots with sleep/free rules, no damage between craft, nobody can summon meteors, protected zones decided by clients |
| Sea level and stage changes rebuild terrain | quantized steps, chunk cache key, LOD budget, ≤ once per hour |
| Kids | 6+ cartoon rules, knockout, presets for names, no impacts in 0+ lands, cooperative terraforming, `kid_pair_ok` for crews and stations |
| Other lanes' files (`planet-view.js`, `kubomir*`, `podzem*`, `mir*`) | new files + one-line hooks; adapters by the owning lanes; PS-1 view parts in `space-view.js` |
| Engine hand-off at planet scale (far plane, AO, SSR) | PL-4 (T-075) first for in-air flight views; impostors at the far plane as planet.md does |

### 7.4 Owner decisions (5)
1. **Перелёты по сети**: «разгонный режим» (Луна ≈ 5 мин, планеты ≈ 10 мин; топливо, расход и окна честные) — или честное время (Луна ≈ 1 ч, планеты —
   месяцы, только «план полёта и выйти»)? Рекомендация: разгонный режим.
2. **Кому служит спутник**: по умолчанию «своим» (хозяин, друзья, поселение и союзники) с переключателем «для всех» — или всегда всем? Рекомендация: своим,
   с переключателем.
3. **Где падают метеориты**: дикие земли — да; поселения — только по их выбору (больше добычи); площадь, детские земли, дома — никогда; боевая зона — да
   (12+, сама чинится). И «стримовый метеорит» — ты назначаешь раз в неделю место и время в диких землях. Рекомендация: так.
4. **Темп терраформирования**: Луна «можно дышать» ≈ 6–8 недель активного сообщества, Песчаная ≈ 3–4 месяца (голубое небо на Луне — через неделю).
   Рекомендация: так; цифры — в каталоге, потом подкрутим.
5. **Система Денчика**: Луна, Песчаная (+ 2 спутника-астероида), Огненная, Ядовитая, Великан с Ледяной и Океанией, Пояс — имена и состав твои.
   Рекомендация: начать с Луны и Песчаной.

## Appendix A. Data sketches (final shapes in each step; all in `planet.sql`, idempotent, `realm text default 'all'` on new tables)
```text
space_craft(id, owner, kind, design jsonb ≤ 2 KB, state jsonb, plan jsonb, body, updated)        -- registered plans (elements + burns)
space_sats(id, owner, grp, type, body, el jsonb, power jsonb, slot int, born, sleeping)           -- coverage source; public select of el/type/grp
space_stations(id, owner_settlement, body, el jsonb, modules jsonb, ports int)
space_claims(id, account, kind 'sat'|'land'|'dock'|'deliver', log bytea ≤ 8 KB, verdict, t)       -- replay inputs (route space.js → space_settle)
meteor_events(id, body, t, place jsonb, size, comp, seed, source 'secret'|'admin')                 -- created lazily by meteor_upcoming()
meteor_loot(event, account, n, t)                                                                  -- daily caps, one row per claim
terra_bodies(body, vars jsonb, anchor_t, milestones int, mhash)                                    -- lazy state
terra_machines(id, body, owner, claim, kind, level, power, born, sleeping)
terra_log(body, account, kind, amount, t)                                                          -- chronicle and «Терраформеры»
RPC: world_now(), space_sats(p_body), space_plan_set(...), space_settle(...) [service_role], meteor_upcoming(p_body, p_tech),
     meteor_claim(p_event), meteor_admin_add(...) [admin], terra_state(p_body), terra_act(p_body, p_op, p_args)
```
Flight log: `{ v: 1, ship, start: { pad | plan }, t0, steps: [[stepIndex, throttle, ax, ay, az, flags], …] }` (changes only). Meteor event:
`{ id, body, t, dir: [x, y, z], size: 0…4, comp, seed }`. Satellite: §3.1. Terraform vars: §5.1.

## Appendix B. Calculator output (M; `node E:\claude-tmp\t078\calc.mjs`)
```text
home: R 128000 g 23.33 mu 3.823e11 | v_orb(surf) 1728 v_esc 2444 | low orbit alt 36000: v 1527 T 11.2 min | stationary r 382079 | eq. spin 335 u/s
luna: R 32000 g 9.33 mu 9.557e9 | v_orb(surf) 547 v_esc 773 | low orbit alt 3000: v 523 T 7.0 min
desert: R 64000 g 14.00 mu 5.734e10 | v_orb(surf) 947 v_esc 1339 | low orbit alt 20000: v 826 T 10.6 min | stationary r 214137 | eq. spin 155
luna a for T=16800 s: 1398144 u (10.9 R); SOI 319689 u; angular diameter 2.62°
LEO->luna: TMI dv 516, TOF 58 min phys, v_inf at luna 283, capture to low luna orbit 269, landing ~601
LEO->stationary: dv1 279 dv2 225 TOF 12.1 min
home->lava 1.6e9: year 92 d, Hohmann 107 d, from LEO 641 · toxic 2.8e9: 214 d, 143 d, 634 · desert 6.0e9: 671 d, 255 d, 634
home->belt 8.5e9: 1131 d, 357 d, 636 · giant 1.6e10: 2922 d, 722 d, 643 · home SOI 1.18e8 u · mu_sun 2.54e15
ascent to 36000 orbit, T/W 1.5, Isp 300: no rotation 2836 u/s 127 s · east 2502 u/s 129 s · T/W 2 east 2469 u/s 111 s · T/W 1.2 east 2656 u/s 155 s
one satellite (el ≥ 10°): r 164000 cap 29.8° 6.6 %, pass ≤ 1.9 of 11.2 min · r 320000 22.6 %, ≤ 9.7 of 30.7 · r 382000 25.6 %, ≤ 13.5 of 40.0
walker ≥1/≥2/≥3/≥4: 3 stationary 76.4/0.1/0/0 · 6/3/1 82.7/46.8/7.0/0 · 9/3/1 98.4/82.2/21.6/0 · 12/3/1 100/100/60.6/10.8
                    18/3/1 100/100/98.5/79.0 · 24/4/1 r 320000 100/100/100/98.9 · 24/4/1 r 260000 100/100/99.0/84.7
```
