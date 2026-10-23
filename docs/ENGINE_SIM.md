# D37E simulation patterns — notes for Backrooms `SimWorld`

Written 2026-10-23 by the site's coordinator session for the Backrooms session (it can't see our chat). Repo:
`E:\site\dan4ik37.github.io` — every path below is relative to it. Code is browser JavaScript (three.js); every number below was
measured or is enforced by a test in this repo. We never write into `D:\UnityProjects\Backrooms` (owner's rule) — copy this file
into `Docs\reference\` yourself if you want it there.

Our `js/engine/controls.js`, `player.js`, `camera.js`, `interact.js`, `build.js`, `inventory.js`, `synth.js` were ported FROM
Backrooms (Core/Controls.cs, PlayerController/Parkour/GripFinder, CameraFeel, PlayerInteractor, BuildDefs/BuildGrid,
Crafting/InventoryStore, AudioSynth) — skip those. Below is what we built or learned since.

## 1. One loop, fixed step

```js
// js/engine/core.js — E.loop(update, frame, step = 1 / 60)
const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
if (paused || document.hidden) return;
acc += dt;
let n = 0;
while (acc >= step && n < 5) { update(step); acc -= step; n++; }
if (n === 5) acc = 0;      // drop the backlog: a slow device runs the game slower instead of freezing
frame(dt, acc / step);     // render with alpha = fraction of the way to the next step
```

- A game passes ONE `update` that steps its systems in a fixed order; nothing in the simulation reads the frame `dt`.
- Slower systems keep their own rate inside the 60 Hz step (tick counter): Kubomir mobs, dropped items and falling sand — 20 Hz,
  drawn between ticks with `X.frac` (`js/games/kubomir-ents.js`); fire — 20 Hz in Kubomir, 30 Hz in Podzem (`hz` option of
  `js/engine/fire.js`); collapse queue — 20 Hz; sky and weather — 4 Hz.
- The FPS cap skips whole render frames; the simulation catches up with steps (still at most 5 per frame).

## 2. Determinism — the same world at 30/60/144 FPS, on a phone and on a PC

1. Input is STATE with timestamps, not events. `js/games/iokit.js` `inputLog(n)`: a ring of 128 records × n doubles
   (`Float64Array`, zero allocations); input handlers call `set(arr, t)`, the step at simulation time `t` reads `at(t)` — what
   was held at that moment. Holding a key for 0.5 s gives exactly the same world at 30, 60 and 144 FPS.
2. Rates are per second × step; never per frame.
3. Two RNG streams: the simulation RNG is seeded from the world (Podzem `G.srand`, Kubomir `X.rng`); particles use their own
   decorative RNG (`FR` in `kubomir-ents.js`). Particle counts depend on the quality setting — if effects drew from the
   simulation RNG, "low" and "high" graphics would produce different worlds.
4. Stateless randomness where possible: `hash(seed, x, y, z, tick)` (`fire.js`) — every peer computes the same fire spread with no
   messages, and save/load continues bit-exactly.
5. Budgets that change simulation state are COUNTS, not milliseconds: collapse queue `PART = 400` cells per piece,
   `BUDGET = 260` cells per 20 Hz tick (`js/games/kubomir-support.js`) — identical on a phone and a PC, so a collapse unfolds the
   same everywhere. Millisecond budgets are only for presentation work (§5).
6. Fixed iteration order: round-robin with a per-tick budget; a removed entry is replaced by the last one (`fire.js`).
7. Bit-exact math only where machines must agree to the last bit: `js/engine/orbit.js` uses only + − × ÷ √, floor/round/abs and
   its own polynomials (`O.m`) instead of Math.sin/cos/atan2/exp/log/pow (browsers differ in the last bit); a "golden" hash of
   known values is checked in `scripts/orbit-test.cjs` and in Chrome. (C#: Math/MathF can differ between Mono, IL2CPP, Burst and
   CPUs — that only matters for lockstep or server re-simulation.)
8. Test it: the same scripted trace at frame cadences 30/60/144 → identical state (`scripts/tiles-test.cjs` "частота кадров":
   ledge grab, pool, cliff — deviation 0; `kubomir-move-test.cjs`, `combat-test.cjs`, `waves-test.cjs`).

## 3. Zero garbage per step and per frame

- Fixed pools with hard caps per device. Debris (`js/engine/destruct.js`): 4 instanced pools (boxes, cylinders, foliage, glass)
  = 4 draw calls, cap 36 / 60 / 120 (low / phone / PC), settled pieces sleep (skipped), fade after 6–25 s. Kubomir particles:
  debris InstancedMesh 96, puffs Points 160, glows Points 72.
- Big populations as struct-of-arrays in typed arrays: io-games (`js/games/kletochki.js`, `chervyachki.js`) keep the world, a
  ring of path points and the collision grid in typed arrays — nothing is allocated per step or per frame.
- Shared result objects are documented: `Phys.circleHit` returns one shared object (copy it if you keep it).
- Measure it in tests: `scripts/char-test.cjs --alloc-phone` (≤ 32 bytes per frame), `combat-test.cjs` (no garbage per step).
  Our controls step + `V.moveBox` allocated ~2.7 KB per step because V8 boxes fractional arguments of a non-inlined call; passing
  the numbers through a `Float64Array` made it 0. (Unity: `GC.GetAllocatedBytesForCurrentThread()` delta around N ticks in an
  EditMode test == 0.)

## 4. Simulate only what matters

- Skip idle subsystems entirely: `js/engine/rigid.js` — all bodies asleep and no player near → the physics step is skipped.
- Activity area: Podzem mobs exist only in a 110×80-cell area around the hero (outside it they vanish); they spawn by a chance per
  second, outside the camera rectangle + 3 cells and ≥ 16 cells from the hero; liquids and sand simulate only near the hero,
  with a budget.
- Distance LOD with hysteresis (no thrashing at the border): characters detailed < 24 u, simple > 30 u (`js/engine/actors.js`
  `LOD_NEAR` / `LOD_FAR`); military bases detailed < 55 m, simple > 75 m; their physics bodies built < 35 m, removed > 50 m.
- Three tiers: (1) full simulation near the player; (2) coarse ticks far away; (3) **closed form when nobody looks** — state is
  f(seed, world time), or settled lazily from the last timestamp when someone looks again:
  - city residents follow schedules from seed + a shared day clock (`E.dayClock`) — everyone sees the same crowd with no
    network, and nothing is simulated off-screen;
  - production and income come from timestamps by one formula, the same in JS and SQL (`base_act`, `city_settle_`) — no
    per-visit simulation;
  - weather (`js/engine/climate.js` `W.at(x, z, ms, y)`) is a pure function of seed + time; wetness, puddles, snow cover and ice
    integrate the last 30 weather-hours on demand;
  - waves (`js/engine/waves.js`): ONE Gerstner sum used by the water shader and by boat/swimmer buoyancy; time =
    `Date.now() mod 96 s` → all peers agree with no messages.

## 5. Time-slicing heavy presentation work

- Open-world zone builders (`js/games/mir-zones.js`, `mir-city.js`, `mir-war.js`) are generators that `yield` after every
  statement; one zone per frame, nearest first; budget 3.5 ms (PC) / 3 ms (phone), ×3 closer than 85 u, ×6 closer than 25 u;
  representative materials are compiled in the background; text labels are drawn later, in pieces. Phone profile (CPU ×4):
  entering the two big zones went from 34 / 48 hitches (3–3.6 s) to 9 / 3 (0.3–0.7 s).
- Workers generate, the main thread applies a bounded amount (Podzem: at most 2 chunks per frame).
- **Bug to avoid (T-090, the open world grew +10 MB/s):** a multi-stage builder needs ONE "started" flag, set at the very
  beginning and kept until the build is done or cancelled. Ours only checked the generator stage; between "generator done" and
  "built" (cells, merge, finish) the 4 Hz streamer started the zone again — on slow frames forever — and every copy (meshes,
  physics bodies, breakables) stayed in memory.

## 6. Reopen without leaks (T-085: every closed world stayed in memory)

| What held the old world (JS) | Unity analog to look for |
|---|---|
| a listener on something that outlives the game (window, document, stage container) | `SceneManager.sceneLoaded +=`, `Application.onBeforeRender +=`, static events without `-=` |
| a subscription without unsubscribe | a C# event on a singleton / DontDestroyOnLoad manager |
| a module-level cache holding world objects | a static `Dictionary` / `List` of scene objects |
| shared GPU resources keeping per-renderer callbacks | shared materials / RenderTextures / NativeArrays never released |
| the network SDK keeping a closed channel's handlers ~10 s, handlers capturing world state | transport / voice callbacks capturing `this` |
| a timer created on mount (a 9 s hint) capturing the renderer | a coroutine on a persistent object, `Invoke`, a `Task.Delay` continuation capturing the world |

20 open/close cycles, heap after GC: 29.5 → 328.9 MB before the fix, 15.2 → 18.0 MB after (0.03 MB per cycle), 0 old worlds
alive. Tests: `scripts/world-reopen-e2e.cjs` (open/close N times, GC, a WeakRef to the old world must be dead),
`scripts/world-leak-test.cjs`. (Unity: a PlayMode test that loads/unloads the scene N times, `Resources.UnloadUnusedAssets()` +
`GC.Collect()`, a `WeakReference` to the old SimWorld must be dead, managed heap flat.)

## 7. A failing system must not kill the game

- Mods: 400 actions per event, 600 per second; 5 errors, a failed start or a 3 s hang → that mod is switched off, the game goes on.
- Kubomir helpers: each is wrapped by `KubomirX.feature(...)`; one that throws is switched off alone.
- Graphics guard (`js/engine/post.js` `E.gfxGuard`): checks shader compile results and a self-test frame; switches off only the
  broken feature, step by step; remembers the decision per device until the next version; sends an anonymous report.
- For SimWorld this suggests: wrap each system's tick, count consecutive exceptions, disable + report after N, keep the rest ticking.

## 8. Data, not names

- Systems read fields, never type names: fire decides flammability only from block fields (`V.burnOf`: burn, liquid, emit, glass,
  shape, foliage, …); falling trees and leaf shedding read the fields `tree` / `decid`. New blocks from mods and new tree species
  burn, fall and shed leaves with no code change.
- Materials, species and attack kinds are data tables: `support.js` `S.MATS`, `fire.js` `FI.MATS`, `trees.js` `TR.SPECIES`,
  `combat.js` `KINDS` / `MOVES`.
- One catalog → a generated copy for the other side + a test that both match (`scripts/gen-city-defs.cjs --check`,
  `gen-evo-defs.cjs`, `economy-test.cjs` compares SQL and JS numbers). This fits a build script that reads physics settings and
  item tables: one source table, a generated runtime asset, a test that code and table agree.
- Saved generated content is versioned: tree shapes are part of saved worlds, so generator output never changes in place — new
  output only under a new world version (`genVer`), old worlds keep the old generator (checksum test).

## 9. Network patterns that ride on this

- Cosmetic simulation by event + seed, not by state: debris `{ k: 'brk', id, s: seed, dx, dz }` — every client simulates the
  pieces itself; fire spreads from the hash, so nobody sends cells.
- Lockstep co-op (Tower Defense, `js/games/td.js`): commands carry a step number and run 10 steps later; checksum every 90 steps;
  mismatch → the host sends the full state (0 resyncs in tests).
- Host-authoritative snapshots: mobs 5–10 per second, binary; guests predict their own avatar.
- Server re-simulation: raids (`api/_lib/raid-sim.js`, integer math, 1/20 s step): the client sends only inputs `{ t, u, x, z }`,
  the server runs the same code and settles the result.

## 10. Systems worth comparing (`js/engine/`, no three.js inside unless noted)

- `combat.js` + `docs/COMBAT.md` — two-hand fighter: weapon kinds (grip one/two/off, hold, cool, reach, dmg, kb, moves, chain,
  block, bow), moves with wind-up / act / recover; damage × (0.2 + 0.8·charge²), combo at charge ≥ 0.8, several targets only at
  full charge; raising a shield gives a 0.2 s parry window (not more often than every 0.7 s) that stuns the attacker for 1 s; an
  axe knocks the shield out for 2.5 s; the whole pose is packed into one 32-bit int for the network; tested at 30/60/144 FPS with
  zero garbage.
- `support.js` (+ `docs/PHYSICS_PLAN.md` §1) — Valheim-style support 0…1000 ‰ in integers, materials as loss per step
  up / side / down; collapse = cells supported BEFORE the edit and not AFTER it (so generated caves never fall); falling pieces are
  stepped by game ticks.
- `fire.js` — 2D/3D grid and loose parts; materials as data; per-tick budgets; hash randomness; exact save/load.
- `trees.js` (+ `trees3d.js` for meshes) — species → skeleton with own sin/cos (bit-exact everywhere), adapters to voxels, 2D
  cells and meshes.
- `waves.js`, `climate.js` — §4. `destruct.js` — §3. `npc.js` — schedule-driven NPC brains on top of the player controller.
  `net.js` — host/guest replication: only changed properties with acks, a summary of 64 hashes every 5 s repairs divergence.
