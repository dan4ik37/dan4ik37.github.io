# «Вселенная Денчика», step 1 — «Живой город»: implementation plan (T-014)

Plan v1, 2026-10-22. Sources: docs/superpowers/specs/2026-10-16-universe-design.md (§2, §6.4–6.6, §10 step 1), docs/NATIONS.md (stage 1, «денки»), docs/ENGINE_ECONOMY.md (C, C½, E), docs/WORLD_MAP.md, docs/REALMS.md (v2: big city 16+), CLAUDE.md (master instruction, items 27–31 and 34, «Мир Денчика» 3D, «Район участков»).
Paths are relative to the repo root (E:\site\dan4ik37.github.io). **(P)** = a proposed number. The master instruction says only the owner sets prices, amounts and limits. So every (P) number lives in one catalog plus an admin override (§3.1) and can change without code.

## 0. Decisions (one line each)
- One currency, «денки» 💵. One server wallet per account. Inventories are per city ("city lockers"). There are two separate markets: `kids` (Солнечный городок, 0+) and `metro` (Большой город, `MirZones.ADULT_AGE` = 16 after T-010).
- Value lives only in the new `city.sql`: wallets, goods, skills, shifts, market, treasury, housing, projects, mayor. The client sends intents, shows an instant preview (shared `Rules`) and draws visuals.
- The pattern copies `bases.sql` / `js/games/mir-base.js`. The catalog is written in JS (`js/games/mir-econ.js`) and generated into `city_defs()` by a script. JS and SQL share the same `Rules`. A PGlite test checks parity.
- Every producing profession has two modes. **«На город»**: the treasury pays a wage and the city keeps the output. **«На себя»**: you use your own tool and inputs, keep the goods and sell them on the market. "На себя" unlocks at skill level 2.
- No transfers between players, ever. Value moves only through the market, with price bands, fees, caps and a rule that suspected twin accounts never match.
- Money enters only through (a) the start grant, (b) the treasury: daily issuance by a central-bank controller plus revenue from NPC demand. It leaves through fees, NPC wages, upkeep, events and a treasury cap. VIP and 💎 have no effect on denki.
- Everything is lazy: no cron, no new Vercel function. `city_tick_` runs at most once per minute per city, triggered by any city RPC. Daily settlement runs on the first call after 00:00 MSK.
- Needs (food, rest, lessons) only give bonuses, never penalties. Yields are fixed (no random loot), so nothing resembles gambling.
- Realtime traffic stays at zero added load: no presence fields, no new subscriptions. City data comes over RPC with revision polling.
- Guests, and anyone while `city.sql` is not yet applied, play in **trial mode**: the current browser wallet, labelled «пробные». It is never imported.
- The role-play roles (robber, judge, cashier variant, family, pets) stay client-only role-play with no denki effect. The old local «бизнесмен» role becomes «скоро» until P7.
- Site coins 🪙 for city work stay as they are (`rt.payTask`, `coin_run_cap('rp')`, ≤ 60/day). The two economies stay separate.

## 1. Player loop

### Kids' town (0+)
- **First 10 min:** Open «🧰 Работа» → 12 kind professions, each with skill stars → choose «Пекарь» (на город). You get the uniform (existing zx.r). Steps: take grain → knead (hold E/✋) → bake → put on the shelf → `+6 💵, Пекарь 1/30`. The first city action pays a one-time start grant of 50 💵 (P). Buy a bun for 5 💵 → «Сыт: +5 % 30 мин». Open 📱 → 🏦 «Банк» to see wages, taxes and history. Expect about 8 tasks, roughly 50 💵 plus the grant.
- **First day (30–45 min, about 40 tasks):** reach «Работник» in one profession (30 tasks). Try a second job (fatigue in one job pushes variety; §2.4). Buy a hoe (30 💵) and farm «на себя» → sell apples or grain on 📈 «Рынок» with «Продать сейчас» (city bid) or a limit order. Rent a flat in «Радужный дом» (40 💵/week) → sleep → «Выспался +10 % 2 ч». Watch the shared construction stage on «Стройка» grow as builders work and kart drivers bring materials.
- **First week:** reach «Специалист» (150 tasks), which unlocks better recipes (pie) and makes «на себя» pay more than wages. A city project completes: a new house appears on a free lot with new flats. On Monday the «Мэр недели» is announced (top contributor). As mayor you choose the next project, set the «копилка» (sales tax) and call a fair.

### Big city (16+, server-gated)
- **First 10 min:** pass the gate → 13 professions, including police → e.g. «Водитель» (taxi fares now; truck freight in P3) or «Шахтёр» at the quarry. Buy a coffee or meal buff. Look at ore and steel prices in 📈.
- **First day:** take the miner path toward «Специалист» (unlocks ore). Rent a flat in ЖК «Солнечный» (120 💵/week). Sell ore to steel-mill workers and to the city's bids. Police patrols pay a wage.
- **First week:** become an expert factory worker making steel «на себя» (machine fee) → sell into the apartment-block project's buy orders → stand for mayor. After P7: rent a kiosk that sells meals by time; collect revenue.

## 2. Professions as data (`js/games/mir-econ.js` → `city_defs()`)

### 2.1 Schema
```js
PROFS.miner = { n: 'Шахтёр', e: '⛏️', ph: 2,                        // ph = phase that enables it
  cities: { kids: ['k_quarry'], metro: ['m_quarry'] },               // place = stable building ids (K_BLD/M_BLD)
  age: 0, kind: 'raw', modes: ['city', 'self'], tool: 'pick',
  min: 25,                       // server minimum seconds per task at L1
  in: null, out: { stone: 3 },   // per task at L1 (self mode → own locker; city mode → city warehouse)
  unlock: { 3: { metro: { ore: 1 } } },   // extra output by skill level
  wage: 6, npc: { rate: 3, cost: 3 }, svc: null, steps: 'miner',     // npc: units/h and 💵/h per NPC worker; steps = client task template
  look: { hat: 'hard', vest: '#a16207' }, desc: '…' }
```
`SERVER` uses `pickKeys(PROFS, ['cities','age','kind','modes','tool','min','in','out','unlock','wage','npc','svc','ph'])`, the same way mir-base.js does.

### 2.2 The 13 professions plus mayor (wages and rates are P)
| id | Profession | Places kids / metro | Age | Modes, tool | min s | Task at L1 | City wage | NPC fallback | Phase |
|---|---|---|---|---|---|---|---|---|---|
| cook | Повар / пекарь 👨‍🍳 | k_bake / m_rest, m_coffee | 0 | city, self | 30 | P1: shelf +3; P3: 2 wheat → 3 bread; L3: 1 bread + 2 veg → 2 meal («пирог» in kids) | 6 | 1 batch/h, 3/h | P1 |
| seller | Продавец 🛒 | k_ice, k_pets, k_bake / m_shop, m_mall, m_coffee | 0 | city | 20 | serve one customer (+1 sale from shop stock in P5) | 5 | base NPC demand | P1 |
| doctor | Врач (kids: врач и ветеринар) 🩺 | k_hosp / m_hosp | 0 | city | 30 | treat a patient (existing templates doctor/vet) | 6 | svc health ≤ 40 | P1 |
| fire | Пожарный / спасатель 🚒 | k_fire / m_fire | 0 | city | 25 | drill or put out a fire (P5 real fire events, +10) | 6 | svc fire ≤ 40 | P1 |
| builder | Строитель 👷 | k_site, lots / metro lots | 0 | city (project funds) | 30 | one work unit (P1: shared stage counter; P4: projects) | 7 | 1 unit/h, 5/h | P1 |
| teacher | Учитель / учёный 📚 | k_school (lessons) / m_city3 lab floor (research) | 0 | city | 30 | a lesson quiz for NPC pupils / research → research points | 6 | svc edu ≤ 40 | P1 |
| police | Полицейский 👮 | — / m_police | 16 | city | 30 | patrol 3 points (existing); arrests are role-play only | 7 | svc safety ≤ 40 | P1 |
| driver | Водитель / логист 🚚 | k_store (cargo kart) / m_taxi (fares), m_depot (truck) | 0 (kids) / 16 | city | by route ≥ 40 | taxi ride (P1); haul 30 units warehouse → hopper (P3) | 10 per run | 10 units/h trickle, 3/h | P1/P3 |
| mech | Механик 🔧 | k_play, karts, k_works / m_gas, m_wash | 0 | city; wrench in self mode | 30 | repair a vehicle or kiosk; P3: facility condition +5 | 6 | condition decays slower | P1 |
| miner | Шахтёр ⛏️ | k_quarry / m_quarry | 0 | city, self, pick | 25 | → stone 3; metro L3 adds ore 1 | 6 | 3/h, 3/h | P2 |
| lumber | Лесоруб 🪓 | k_grove / m_forest | 0 | city, self, axe | 25 | → log 3 (every 4th task: replant, no output) | 6 | 3/h, 3/h | P2 |
| farmer | Фермер / садовник 🌾 | k_farm / m_farm | 0 | city, self, hoe | 25 | → wheat 3 or veg 3 (choose the bed) | 6 | 3/h, 3/h | P2 |
| worker | Рабочий цеха (kids: мастер в мастерской) 🏭 | k_works / m_saw, m_brick, m_steel | 0 | city, self (fee 1 💵) | 30 | one recipe batch | 6 | 1 batch/h, 3/h | P3 |
| mayor | Мэр 🎩 | k_hall / m_hall | 0 / 16 | — | — | §5 | 30 / 50 per day | NPC mayor | P6 |

Kids' town gets 12 professions: no police; no court, army or weapons. Metro gets all 13.

Role mapping from today's code: baker→cook; icecream→seller; fireman→fire; doctor/vet→doctor (variants); builder→builder; medic→doctor; cashier→seller (bank-teller variant); taxi→driver.
`robber`, `judge`, family roles and pets stay role-play (`rp: 1`), with no denki. Bail becomes a 45 s wait only. The ATM shows balance and history; the cash/bank split and robbery of real denki are removed in server mode.

### 2.3 Goods and recipes (reference prices P)
| id | Good | Category | Ref 💵 | City | Comes from → goes to |
|---|---|---|---|---|---|
| log, stone, wheat, veg | Брёвна, камень, зерно, овощи/фрукты | raw | 3 each | both | miner, lumber, farmer → factories, cook |
| ore | Руда | raw | 5 | metro | miner L3 → steel |
| plank, brick | Доски, кирпич | part | 8 | both | sawmill 3 log → 2 plank; kiln 3 stone → 2 brick |
| steel | Сталь | part | 20 | metro | worker L3: 2 ore + 1 stone → 1 steel |
| bread | Хлеб / булочка | food | 5 | both | cook: 2 wheat → 3 bread. Buff +5 % for 30 min |
| meal | Обед (kids: «Пирог») | food | 15 | both | cook L3: 1 bread + 2 veg → 2 meal. Buff +10 % for 60 min |
| pick, axe, hoe | Кирка, топор, мотыга | tool | 30 (40 uses) | both | tool shop (city) → self mode |
| wrench | Ключ | tool | 40 (60 uses) | both | mechanic self repairs |

Do not use 🧱 for the city brick: it is already the currency of the district (bases).

### 2.4 Skill, fatigue, caps, buffs (all P)
- **Skill:** XP is +1 per task, per profession.
  - Levels at 0 / 30 / 150 / 500 / 1500 tasks: Ученик / Работник / Специалист / Эксперт / Мастер.
  - Wage and output multiplier: 100 / 110 / 125 / 140 / 160 %. Minimum task time: 100 / 95 / 90 / 85 / 80 %.
  - L2 unlocks «на себя». L3 unlocks advanced outputs (ore, steel, meal/pie). L5 shows the title over the nick.
- **Fatigue, per profession per day:**
  - Tasks 1–40: full wage and XP.
  - Tasks 41–60: half wage, XP still counts («смени работу»).
  - After 60: no city wage or XP. Self-mode output stops at 100 tasks per profession per day.
- **Global gross city-wage cap:** 400 💵 per day.
- **Buffs:** bread +5 %/30 min; meal +10 %/60 min; rested (sleep at your own home, once per 6 h) +10 %/2 h; lesson +25 % skill XP for 24 h (once per day). Buffs add up to at most +20 %.

## 3. Server: `city.sql` (one new area file)

### 3.1 Conventions
- **File:** idempotent, one transaction. The owner re-runs the whole file after every phase. The header lists deps and the REST checks.
- **Dependencies:** `profiles`, `auth.users`, `banned_nicks`, `age_group_of` (age.sql, applied), `user_level` (progression.sql, applied). Do not call anything from raids.sql or referrals2.sql: write an own `city_marks`.
- **Catalog:** `city_defs()` is generated by `node scripts/gen-city-defs.cjs [--check]` from `MirEcon.SERVER`. The metro age is read from `MirZones.ADULT_AGE`. `city_defs()` returns the base catalog merged with `city_cfg.data` (admin overrides on whitelisted keys). `->>'v'` is the server phase; the client gates features with `MirEcon.sv >= n`.
- **Time:** `city_now()` (epoch seconds; tests override through `test.now`, like `base_now`) and `city_today()` (MSK date).
- **Writes:** only through `security definer` functions. RLS is on with no policies. Helpers ending in `_` are revoked from anon and authenticated.
- **Lock order** (prevents deadlocks): `pg_advisory_xact_lock(hashtext('cm:'||city||':'||item))` → user rows (own first, then counterparties) → `cities` → `city_facs` → `city_projects`. `city_tick_` only uses `for update skip locked` and `pg_try_advisory_xact_lock`.

### 3.2 Tables (phase in brackets)
- `city_cfg(id int pk = 1, data jsonb)` [P1]: admin overrides (start, wages, caps, bank, taxes, rents).
- `city_bank(id int pk = 1, k int (‰), m_avg int, actives int, day date, stats jsonb)` [P1]: global controller.
- `cities(id text pk check (id in ('kids','metro')), treasury bigint ≥ 0, tax jsonb {sales, income, rent}, wage_k int, stock jsonb {item: qty}, ref jsonb {item: price}, pop int, happy int, svc jsonb {health, fire, safety, edu, repair}, site int, research int, mayor uuid, mayor_kind text ('npc'|'week'|'admin'), mayor_until bigint, cool jsonb, frozen bool, t_tick bigint, day date, rev int, stats jsonb, events jsonb)` [P1; columns added per phase]. Seeded with treasury 5,000 (kids) / 10,000 (metro) (P).
- `city_people(user_id pk → profiles, cash bigint ≥ 0, granted bool, skills jsonb, xpd jsonb, job text, job_city text, job_mode text, task_n text, task_t bigint, task_k int, run jsonb, day date, wage_day int, buffs jsonb, act_t bigint, act_n int, mk_t bigint, mk_n int, orders_day int, rev int, created_at, updated_at)` [P1].
- `city_inv(user_id, city, items jsonb, tw jsonb (uses left on the current tool), pk(user_id, city))` [P2]. Cap 400 units per city (P).
- `city_ledger(id bigserial, user_id uuid null (null = treasury), city, amount int, bal bigint, kind text, ref text, at bigint, day date)` [P1]. Indexes (user_id, id desc), (city, day, kind). Keep 30 days.
- `city_contrib(city, user_id, week text, pts int, days int, pk(...))` [P1 write, P6 read].
- `city_marks(user_id, kind ('ip'|'dev'), hash, seen_at, pk(user_id, kind, hash))` [P1]. md5 of IP from `request.headers` and of `p_dev` (= `D37Ref.device()`, localStorage `d37_dev`). Keep 30 days.
- `city_orders(id bigserial, city, item, side char(1), user_id uuid null (null = city), proj bigint null, price int, qty int, left int, esc bigint, at bigint, until bigint, status char(1))` [P2]. Index (city, item, side, status, price, at).
- `city_trades(id, city, item, price, qty, buyer uuid null, seller uuid null, at)` [P2], keep 14 days.
- `city_prices(city, item, day, vwap, vol, hi, lo, pk(city, item, day))` [P2].
- `city_facs(id text pk = building id, city, kind, hop jsonb, cap jsonb, npc int, cond int, t0 bigint, rev)` [P3].
- `city_projects(id bigserial, city, kind, lot text, need jsonb, have jsonb, work int, work_need int, funds bigint, npc int, status text, by uuid, t0 bigint, done_at bigint, rev)` [P4].
- `city_homes(unit text pk, city, kind, bld text, tenant uuid null, until bigint, rent int, rest_at bigint)` with unique (city, tenant) [P4]. Units are generated from apartment lots (`MirZones.lotsOf`) and from completed projects.
- `city_log(id bigserial, city, user_id uuid null, act text, data jsonb, at bigint)` [P6]: public mayor and treasury log.
- `city_biz(id text pk = premise lot, city, owner uuid, kind, recipe, stock jsonb, till int, npc int, t0 bigint, until bigint)` [P7].

### 3.3 RPCs
| RPC | Who | Args → returns |
|---|---|---|
| `city_defs()` | anon | catalog merged with cfg (cached client-side by `v` in `d37_city_defs`) |
| `city_public(p_city text, p_rev int default null)` | anon | runs `city_tick_` → `{ok, rev, treasury, tax, wage_k, pop, happy, svc, site, mayor{nick, kind, until}, facs[], projects[], prices{item:[ref, last, vol24]}, events[], homes{free, total}}`, or `{ok, same: true}` when `p_rev` = rev. Response ≤ 2 KB |
| `city_state(p_city text)` | auth | own cash, skills, levels, job, task, buffs, day counters, inventory, home, open orders, eligibility |
| `city_act(p_act text, p_a jsonb, p_dev text default null)` | auth | §3.4. ≤ 60 per minute. Returns `{ok, …state, got, wage, tax, next}` or `{ok: false, reason}` |
| `city_market(p_act text, p_a jsonb, p_dev text default null)` | auth | `bid`/`ask {city, item, price, qty}`, `cancel {id}`, `mine {city}`. ≤ 20 per minute |
| `city_book(p_city text, p_item text)` | anon | top 5 bid and ask levels `[price, qty]`, last 20 trades `[price, qty, at]` with no user ids, 14-day VWAP |
| `city_mayor(p_act text, p_a jsonb)` | auth (current mayor) | §5 |
| `city_log_read(p_city text, p_before bigint)` | anon | public log, 30 rows per page |
| `city_admin(p_act text, p_a jsonb)` | admin/moderator (`profiles.role`) | `cfg {…}`, `grant {city, n, why}`, `mayor {city, uid\|null, days}`, `freeze {city, on}`, `audit {uid}`, `sum` (conservation check) |

Internal, revoked: `city_now`, `city_today`, `city_tick_`, `city_settle_day_`, `city_pay_(uid, city, n, kind, ref)`, `city_tr_(city, n, kind, ref)`, `city_inv_add_`, `city_lvl_(xp)`, `city_age_ok_(uid, city)` (rank of `age_group_of` against the city age: 16 → teen16 or adult; unknown → refused), `city_banned_(uid)` (`banned_nicks`), `city_mark_`, `city_alt_(a, b)`, `city_match_`, `city_fac_step_`, `city_audit_`.

Error reasons: `auth, args, city, age, prof, mode, job, nonce, too_soon, too_fast, day_cap, no_slots, tool, inputs, full, cash, band, orders, twin, frozen, mayor, cooldown, corridor, treasury, taken, none, sv`.

### 3.4 `city_act` actions and checks
- `job {city, prof, mode, place}` [P1]. Checks: profession enabled (`ph ≤ v`); place listed for the city; `city_age_ok_`; not banned. Self mode needs level ≥ 2 and the tool. Any current job is ended automatically. Sets `task_n` (8-hex random), `task_t = now`, `task_k` (0–9 target index; the client maps it to a spot). The first `city_act` auto-creates the user row and pays the start grant once per account (also writes marks).
- `quit` [P1].
- `task {n}` [P1], checked in this order:
  1. Row lock and rate limit.
  2. `n = task_n`.
  3. `now − task_t ≥ ceil(min × fast[lvl] / 100)`.
  4. Day rollover.
  5. Fatigue and caps.
  6. City mode: treasury ≥ reserve (3 days of public wages), otherwise `no_slots`; P3+ hopper inputs available, otherwise `inputs`; warehouse space. Self mode: tool uses > 0, own inputs, locker space.
  7. Apply: outputs; gross wage `w = wage × mult[lvl]/100 × (100 + buff)/100 × wage_k/100` (floor, at least 1); income tax `floor(w × tax.income / 100)` stays in the treasury; ledger rows (player and treasury); XP; contribution points; new nonce and target.
- `eat {city, item}` [P1]: consume food from the locker (P2+) or buy it at the shop (P1) → buff.
- `buy {city, item, qty}`: food [P1], tools [P2]. Price = ref × 1.25 from the city shop; the money goes to the treasury.
- `run {city, to, item}` / `drop` [P3]: driver run. Warehouse → in transit (stored in `run`) → hopper. Allowed after the route minimum seconds (catalog: 30 + distance / 8 s, P). Abandoned runs (`quit`, or 30 min) return the goods.
- `repair {city, item}` [P3]: tool repair at the workshop, 12 💵 to the treasury, restores 50 % of uses.
- `rent {city, unit}`, `unrent {city}`, `rest {city}` [P4]. One home per city per user. Rent is paid weekly in advance and auto-renews lazily when there is cash; otherwise 48 h grace, then the home is freed. No debt.
- `lesson {city}` [P5]: the student side of school; at most 1 per day → XP buff.

### 3.5 Lazy simulation (`city_tick_(city, now)`, integer math, mirrored in `MirEcon.Rules`)
- **Entry:** skip if `now − t_tick < 60`. Lock with `for update skip locked`. Δ = min(now − t_tick, 72 h). steps = ceil(Δ / 3600). Each step `s` runs, in order:
  1. **Logistics trickle [P3]:** `move = min(stock[i], cap[i] − hop[i], floor(10 × npcDrv × s / 3600))`.
  2. **NPC production per facility [P2/P3]:**
     - `b = min(floor(npc × rate × condK × s_acc / 3600), inputs / in, space / out, floor(treasury / costPerBatch))`.
     - `condK = (50 + cond/2) / 100`.
     - The time remainder carries over in `t0`, as in `base_collect_`. If inputs, space or budget limit the batch, `t0 = now` (no banking idle time).
     - NPC wage `npc × cost × s / 3600` is destroyed (sink).
  3. **NPC demand at shops [P5]:**
     - `sold = min(hop[i], floor(pop × perCap[i] × (800 + 4 × happy) / 1000 × k / 1000 × s / 86400 / shops))`.
     - Revenue = sold × ref × 1.2 → treasury (faucet).
  4. **Service decay [P5]:** each service drops 1 per hour, down to an NPC floor of 20 × npc staff (at most 60).
  5. **Facility condition [P3]:** drops 2 per day.
  6. **Fire events [P5]:** server-scheduled; 4 % per hour per city (P) from `hashtext(city||hour)`. Unresolved after 30 min → facility condition −20. Nothing is ever destroyed; player inventories are never touched.
- **Daily settle** (`city_settle_day_`, at most 7 missed days):
  1. Issuance (§3.6).
  2. `k` update (global row, once per day).
  3. Ref prices: move toward 7-day VWAP by at most ±10 % per day, bounded to 50–200 % of the catalog price; needs volume ≥ 50, otherwise drift 2 %/day toward the base.
  4. Refresh city standing orders with `pg_try_advisory_xact_lock`.
  5. Expire orders after 72 h and refund escrow.
  6. Treasury cap: anything above 30 days of public wages is destroyed.
  7. Mayor rotation on Monday [P6].
  8. Retention: ledger > 30 days, trades > 14 days, marks > 30 days (≤ 5,000 rows per run).
  9. Stats snapshot.

### 3.6 Money flows (P)
| Faucets (new money) | Sinks (destroyed) | Transfers (circulate) |
|---|---|---|
| Start grant 50 once per account | Market fee 1 % (2 % when M > 1.3 T) | Wages, treasury → player |
| Issuance per day per city: `min(cap, base + per × A7) × k/1000`; kids base 300, per 120, cap 6,000; metro 500 / 160 / 12,000. A7 = residents with ≥ 5 tasks on ≥ 2 of the last 7 days | NPC wages (3–5 💵/h per NPC) | Taxes: income 5 % kids / 10 % metro (corridor 0–10 / 0–15); sales 3 % / 5 % (corridor 0–8 / 0–12) |
| NPC demand revenue (P5) | Events (fair 200 / 400), facility upkeep | Shop purchases, tools, repairs, machine fee, rent → treasury |
| — | Treasury above 30 days of public wages | Market trades, player ↔ player |

- **City standing orders [P2]:** bids at 80 % of ref × min(1, treasury / reserve) for `(target stock 300 − stock)` units (raw and parts); asks at 125 % of ref for stock above half the target. Together they bound prices when liquidity is thin.
- **Central bank, daily:**
  - M = average cash of players active in the last 14 days. Target T = 1,500 💵 (P).
  - M > 1.3 T: k −50. M > 1.1 T: k −20. M < 0.7 T: k +50. M < 0.9 T: k +20. Otherwise k drifts ±10 toward 1000. Clamp to [500, 1500] ‰.
  - k scales issuance and NPC demand.
- **Rent [P4]:** base (kids flat 40, kids house 80, metro flat 120 per week) × tax.rent % × (100 + max(0, occupancy % − 70)) / 100. 20 % of rent is destroyed as upkeep.

### 3.7 Anti-abuse
- **Server time gates:** per-task minimum seconds and a nonce chain, so tasks cannot be skipped or parallelized. Rate limits: `city_act` 60 per minute, `city_market` 20 per minute.
- **Caps (P):** wage 400 per day; fatigue tiers; XP 60 per profession per day; self-mode 100 tasks per profession per day; city-bid sales 150 units per item per day per seller; shop food 20 per day; 100 new orders per day; 30 open orders; locker 400.
- **No farming by idling:** nothing pays for time online. Player-owned lazy assets (P7) hold at most 8 h of output and need inputs (like base mines).
- **Twins:** IP/device marks on first action, on orders and on rent. Orders never match an alt (`city_alt_`: shared hash within 30 days). The start grant is per account only.
- **New accounts:** under 3 days old or below level 3 → 20 sell orders per day and no bids above 1.2 × ref.
- **Price bands:** limit price must be within 50–200 % of ref, and ref moves at most 10 % per day, so absurd prices can't be used to move money.
- **Mayor:** corridors, cooldowns, no access to any wallet, public log, admin override and freeze (§5).
- **Conservation:** `city_audit_` checks that Σ cash + Σ escrow + Σ treasury equals faucets − sinks from the ledger. Tests require zero drift; an admin `sum` view reports it.
- **Kids:** the market is anonymous (no nicks, no ids). No free text anywhere in city features (presets only). The metro is server-gated at 16+. Homes are owner-only (no guests in v1).
- **Accepted limitation:** the server cannot verify player position. It is bounded by time gates and caps.

### 3.8 What stays client-only
Task steps (walk, hold, carry, spot markers, effects), how the target index maps to a spot, vehicle physics and routes, the crowd of NPC residents (`residentAt`), NPC staff visuals at facilities, price charts, interpolation of stock counters between polls (pure function of time and rate), the mayor overview rendering, role-play roles and their effects, trial mode (`d37_mir_kids` / `d37_mir_metro`, labelled «пробные»), uniforms, and held tools (`zx.r`, `zx.w`).

## 4. Client modules and hooks

**New files (only where a pure, node-loadable module is unavoidable):**
- `js/games/mir-econ.js` → `window.MirEcon`. No Three.js or DOM at load. Contains:
  - `DEFS` (CITIES, GOODS, PROFS, RECIPES, FACS, PROJECTS, HOMES, SKILL, CAPS, BANK, MAYOR, BUFF) and `SERVER`.
  - `Rules`: `lvl, mult, minS, wage, gate, act(state, a, g, now, city)` (mirror of `city_act`), `facStep, demandStep, logiStep, band, rent, kNext, issue`.
  - `api`: `ready() → sv`, `state(city)`, `act(a, g)` (promise chain like mir-base `doAct`), `market`, `book`, `pub(city)` with revision polling, `log`, `on/off('state'|'pub')`.
  - `trial` (local `Rules.act` over `d37_city_trial`).
- `scripts/gen-city-defs.cjs`, `scripts/city-test.cjs`, `scripts/city-sim.cjs`.
- PGlite: `E:\claude-tmp\city\pg\test-city.mjs` (same harness as `E:\claude-tmp\d37raid\pg\test-bases.mjs`).

**Extended files:**
- `js/games/mir-city.js`:
  - `ROLES_K/ROLES_M` built from `MirEcon.PROFS` plus the role-play roles.
  - `taskList` gains templates miner, lumber, farmer, worker, driver-freight, mech, teacher-lesson, scientist; steps unchanged; the final step calls `api.act('task', {n})`.
  - `jobBoard`: mode switch, slots («город нанимает»), skill and fatigue bars.
  - `wallet/earn/spend` → MirEcon adapter, with trial as the fallback.
  - `shop/buy` → server.
  - New panels: `marketPanel`, `lockerPanel`, `homePanel`, `projectPanel`; `mayorOffice` → `mayorPanel`.
  - New buildings in `K_BLD/M_BLD`: k_quarry, k_grove, k_farm, k_works, k_store, k_market; m_quarry, m_forest, m_farm, m_saw, m_brick, m_steel, m_depot, m_market. Build code yields after every statement (the zone build budget rule).
  - Project-stage layer per lot (a few merged boxes), rebuilt only when the stage changes.
  - Flat doors via `MirZones.accessRules`.
- `js/games/mir-zones.js`:
  - `WORKS` rects tied to each city (like `EXPAND`), included in `bounds()`, `blocked()` and `clusterRect()` (flat pad, no trees), and moved by T-029's zone shift.
  - `rt.overview`: an economy-label layer filled from `mod.ov(zid)`.
  - No changes to `cleanZX`/`ACTS` (reuse the 'fix', 'carry', 'cook', 'heal' poses and `zx.w` for the held tool).
- `js/engine/vehicle-ground.js`: defs `truck` (cargo 8 slots, 2,000 kg) and `cargo_kart` (kids, area 'kids').
- `js/features/phone.js`: APPS gains 🏦 bank, 📈 market, 🏙️ city (mod `econ`); `MODS.econ = ['js/games/mir-econ.js', 'js/features/phone-apps.js']`.
- `js/features/phone-apps.js`: `define('bank'|'market'|'city')`, touch-first. Trading from the phone is allowed anywhere.
- `js/features/games.js`: add `js/games/mir-econ.js` to the world scripts before mir-city.js; bump `GAMES_VER` every phase.
- `css/mir-zones.css`: `.mz-eco-*` panels.
- `mir.js`: no change expected (everything goes through the `S.zones` hooks).
- Docs: `docs/CITY_ECONOMY.md` (numbers, sim tables between `<!-- sim:… -->` markers, where to change numbers); a CLAUDE.md section «Живой город»; «Ожидает запуска владельцем» gets city.sql with checks.

## 5. Mayor v1 (elections come in step 3)
- **Who:**
  - Every Monday at 00:00 MSK (lazy) the «Мэр недели» is the eligible resident with the most contribution points over the last 7 days. Points: city task 1, project work unit 3, material sold to a project 1 per 10 💵, delivery 2.
  - Eligible = active on ≥ 3 days, account ≥ 14 days old, `user_level` ≥ 5 (kids) / 10 (metro) (P), passes the age gate, not banned, not a twin of the outgoing mayor. Ties go to the older account.
  - Nobody eligible → NPC mayor with default rules (auto-starts the next catalog project when treasury ≥ 1.2 × its cost).
  - Admin can appoint or remove (`city_admin('mayor')`). If the mayor is inactive for 3 days, the NPC mayor takes over.
- **Powers** (`city_mayor`). All are corridor-checked, each setting has its own cooldown, every action is logged with before/after:
  - `tax {sales, income, rent}`: corridors in §3.6; at most ±2 points per change; once per 24 h.
  - `wage {k}`: 80–120 % for public jobs; every 6 h.
  - `npc {fac, n}`: 0–3 NPC staff per facility.
  - `project {kind, lot}`: catalog presets only; at most 2 active plus 1 queued; funds reserved at start. `cancel {id}` only at stage 0, with full refund.
  - `event {kind}`: «Ярмарка» (2 h, market fee 0, NPC demand +20 %, costs 200 / 400, once per 3 days), «Субботник» (builder wage +25 % for 2 h).
  - `say {preset}`: preset announcements only.
- **Cannot:** touch any wallet or inventory, spend the treasury outside formulas, go below the reserve, type free text, act while the city is frozen.
- **Salary:** 30 (kids) / 50 (metro) 💵 per day, only on days with at least one action; counts toward the wage cap.
- **UI:** the existing `mayorOffice()` desk becomes the mayor panel, plus 🏙️ «Город» → «Мэрия» in the phone. The existing «вид мэра» (`rt.overview`) gains labels for facility stock, hopper, NPC count and condition, project progress, housing occupancy and the treasury. Touch pans with the joystick (existing `ovStep`).

## 6. Networking budget (Supabase free tier: 2M realtime messages per month, counted per delivered copy; presence ≤ 5 track/untrack per 30 s per client)
| Path | City adds | Budget |
|---|---|---|
| Presence `mir-<N>` | Nothing. City state is never put in presence (`retrack`/`presGate` unchanged) | 0 |
| Broadcast 'st' | `zx.r` (profession) and `zx.w` (held tool or cargo) only on change; city-driven zx changes debounced to ≥ 3 s | ≤ +3 'st' per minute per working player |
| Broadcast 'z' | `{k: 'cty', c, r}` sent only by the actor, after a mayor action or project stage change, ≤ 1 per minute | ~10–50 per day per city |
| postgres_changes | none | 0 |
| RPC (not realtime) | `city_act` about 1.5/min while working; `city_public` every 120 s in a city (`{same: true}` when unchanged); `city_book` every 20 s only while the market panel is open | 0 realtime; ≤ 2 KB per response, about 0.3 MB per active player per hour of egress |
| DB size | ledger ~1 row per task, 30-day retention → ≤ 20 MB at 100 daily actives | of the 500 MB DB |

Target: city features ≤ 5 % of realtime messages. Before and after each phase, ask the owner to check Supabase → Usage. Watch the risk in §8 (players stay longer in the world, so more 'st').

## 7. Phases (one agent each; each is playable; commit per step; card docs/tasks/T-NNN.md)
Every phase: `city.sql` re-run twice in PGlite (idempotent); `gen-city-defs --check`; JS/SQL parity on random action sequences; existing tests green (world-zones-test, base-test, mirplay-test, vehicle-test, economy-test, age-test); screenshots on phone and PC; `GAMES_VER` bump; a «Владельцу» REST check; with old SQL the site degrades gracefully («появится, когда сайт обновится»).

**P1 «Денки и смены»**
- Scope: mir-econ.js; city.sql v1 (cfg, bank, cities, people, ledger, contrib, marks; defs, public, state, act: job/quit/task/eat/buy-food; admin; tick with issuance and cleanup); 9 professions (cook, seller, doctor, fire, builder (shared site stage), teacher, police, driver-taxi, mech); job board, wallet HUD and shops go server-side; ⭐ becomes 💵 in server mode; trial mode for guests; 📱 🏦 Банк (balance, history, skills) plus an admin «⚙️ Экономика города» form (cfg); city-sim v1.
- Accept:
  - Server wage, XP and ledger survive a reload.
  - Refused: `too_soon`, wrong nonce, after caps, metro job for unknown or under-16 age, guest.
  - The builder stage is the same in two tabs.
  - No console errors without city.sql.
  - 30/60/144 FPS give the same task timeline.

**P2 «Сырьё и рынок»**
- Scope: inventory/lockers, raw goods and tools; miner, lumber and farmer (with self mode); WORKS sites; city warehouse; orders/trades/prices with book, bids/asks, city standing orders, bands, twin skip, expiry; 📈 Рынок (quick sell/buy, limit orders, my orders, 14-day chart); NPC raw production in the tick.
- Accept:
  - Two accounts trade: fee and tax are correct, escrow is conserved over 1,000 random orders.
  - Alts never match.
  - Band rejects out-of-range prices; expiry refunds.
  - `city_book` exposes no user ids.

**P3 «Заводы и логистика»**
- Scope: recipes, `city_facs` hoppers and condition, worker (city and self mode with fee), cook with real inputs, driver runs (truck and cargo kart), mechanic condition, NPC production and logistics, overview labels.
- Accept:
  - An empty hopper idles the factory, including its NPCs; a delivery resumes it.
  - Self mode turns your logs into your planks minus the fee.
  - Truck route time is the same at 30/60/144 ±2 %.

**P4 «Стройка и жильё»**
- Scope: projects (presets, stages 0–5, market buy orders with `proj`, builder work units, NPC builders); the completed building appears on its lot and can be entered (interior.js); homes from apartment lots and projects; rent, unrent, rest; owner-only doors.
- Accept:
  - A project finishes with players, and slowly with NPC only.
  - Two tabs see the same stage.
  - New flats can be rented.
  - Rent expires with no debt.

**P5 «Потребление и центробанк»**
- Scope: shops with NPC demand; seller throughput; food from stock; services, happiness and fire events; lessons; the k controller and VWAP ref prices; 📱 🏙️ Город (treasury, income/expenses by kind, happiness, projects).
- Accept (simulated): a city with 0 players survives 60 days (treasury ≥ 0); 200 bots keep M within bands; services visibly raise demand.

**P6 «Мэр v1»**
- Scope: §5 in full, plus `city_log` and the overview layer.
- Accept:
  - A tax change applies to the next trade.
  - Corridors and cooldowns are enforced; non-mayors are refused.
  - Monday rotation works with time travel; NPC fallback works.
  - Works on phone by touch.

**P7 «Свой бизнес v1» (stretch)**
- Scope: rent a premise lot; restock; it sells to NPC demand or runs a recipe by time with an 8 h hold; NPC staff cost per hour; collect. Replaces the local «бизнесмен».
- Accept: parity tests in the style of base_act; output stops at the hold cap; no output without inputs.

**Tests**
- `city-test.cjs`: catalog sanity, places exist in K_BLD/M_BLD, WORKS inside the pad and not overlapping anything, Rules units, and a pure TaskRunner extracted from mir-city.js driven by a fake clock at 30/60/144 FPS (same step times ±1 fixed step, same number of RPC calls, never sends `task` early).
- PGlite `test-city.mjs`: RLS, grants, parity, caps, age, market, tick with time travel, conservation, mayor.
- `city-sim.cjs` (reads `MirEcon.SERVER`, `--days 90 --players 5,20,100,300 --write --json`). Exits 1 if any of these fail:
  - M stays within 0.6–1.6 T after day 30.
  - The treasury never goes below 0.
  - A regular player can rent by day 2, reaches «Специалист» around day 4–5 and «Мастер» around day 40.
  - Top 1 % wealth ≤ 30 × the median.
  - 50 twins add ≤ 100 💵 to their main account.

Order: P1 → P2 → P3 → P4 → P5 → P6 (P7 after P5). Coordinate with T-010 (big city 16+) and T-029 (zone shift; work sites go in zone-relative WORKS): the same files must not be edited in parallel.

## 8. Risks and owner questions
| Risk | Mitigation |
|---|---|
| Economy drifts (inflation, deflation) or exploits | sim gates per phase, k controller, caps, bands, admin freeze and live cfg |
| JS ↔ SQL formula drift | generator plus PGlite parity on random sequences |
| Hot `cities` row (treasury) under load | fine at current scale; plan B: treasury deltas table folded in by the tick |
| Free-tier quotas (messages, egress, 500 MB DB) | 0 presence and subscriptions, revision polling, compact responses, retention |
| More time in the world → more 'st' messages | measure; if near the limit, raise the walking heartbeat from 2.5 s to 4 s inside cities |
| Bots automating tasks | time gates and daily caps bound gains to ≤ 400 💵 per account per day |
| Owner applies SQL late | `v` gating plus trial fallback |
| Phone performance (new sites) | merged static geometry, ≤ +10 draw calls per city, build budget, one zone at a time |

Owner must decide (5):
1. Should the kids' town switch from ⭐ «звёздочки» to the shared 💵 денки (one wallet; adults may also work in the kids' town)? Proposal: yes.
2. Mayor v1: automatic «Мэр недели» (the most useful eligible resident) with your override, or do you appoint mayors yourself? Proposal: automatic plus override.
3. Numbers (P): start 50 💵, about 6 💵 per task, cap 400 per day, rent 40 / 120 per week, taxes 3–5 % / 5–10 %. Approve, or change them later in «⚙️ Экономика города»?
4. Guests: city work saves only for logged-in players; guests get an unsaved trial. Proposal: yes.
5. Keep the small 🪙 site coins for city work (≤ 60 per day, as now)? Proposal: keep.

## 9. Not in step 1
- Any exchange between denki and 🪙/💎, «sponsored» denki for 💎, or 💎/VIP effects on the city economy.
- Player transfers, gifts, loans, credit, bonds, insurance, stocks.
- Elections, council, laws, courts, real police procedure, fines or robbery of real denki (step 3).
- Free building placement, zoning brushes, a road tool, player-owned city land (only P7 premise rental).
- Trains, ships, flights, regional prices between more than the 2 city markets (WORLD_MAP stages в–д).
- Soil, pollution, seasonal yields (step 2: keep a `k_season = 1` hook); tech tree and eras (step 4: research points are only a counter).
- New mini-games beyond step tasks.
- Free-text names or announcements; guests in private homes.
- New Vercel functions, crons, presence fields, realtime subscriptions.
- Importing local ⭐/💵 wallets.
- Changes to the bases, raids or 🪙 economies; any destruction of city buildings or homes.

### Critical Files for Implementation
- E:\site\dan4ik37.github.io\js\games\mir-econ.js (new: catalog, Rules, api, trial)
- E:\site\dan4ik37.github.io\city.sql (new: tables, RPCs, lazy tick; model: E:\site\dan4ik37.github.io\bases.sql)
- E:\site\dan4ik37.github.io\js\games\mir-city.js (job board, tasks, panels, new work sites)
- E:\site\dan4ik37.github.io\js\games\mir-zones.js (WORKS rects, accessRules, mayor overview layer)
- E:\site\dan4ik37.github.io\js\features\phone.js (bank, market and city apps; with phone-apps.js)

## Owner decisions (22.10.2026)
1. Kids' town switches from ⭐ to the shared 💵 денки — YES.
2. Mayor v1 — owner asked «это как тип с выбором?» (is it an election?). Answer given: v1 = automatic «Мэр недели» by contribution (no voting), owner can appoint/remove; real elections come in step 3. Waiting for his final word — P6 only, does not block P1–P5.
3. Numbers (start 50 💵, ~6 💵 per task, cap 400/day, rent 40/120 per week) — YES for now; owner: «потом посмотрим — сделаем лог, чтобы проверить баланс» → P1 MUST include an admin economy log: «📊 Экономика города» (per day: issued / destroyed / transferred by kind, money supply M vs target T, central-bank k, wage cap hits, top income kinds, suspicious accounts — no nicks of kids), plus CSV export; the city-sim tables in docs/CITY_ECONOMY.md.
4. Guests play a trial without saving — YES.
5. Keep the small 🪙 site coins for city work — YES.
6. Mayor — UPDATED by the owner (22.10): «голосование оставим, но чтобы не могли заходить с одного IP и устройства сразу несколько раз — не больше 3 аккаунтов, и защита от смены IP и другого, как ботов используют, чтобы не банило». So P6 = real ELECTIONS (weekly) instead of the automatic «Мэр недели»:
   - candidates: eligible residents (account ≥ 14 days, level ≥ 5 kids / 10 metro, age gate, not banned, real city activity in the last 14 days);
   - voters: the same activity/age/level gates; one vote per account;
   - anti-fraud WITHOUT bans («чтобы не банило» — families and schools share an IP): at most 3 counted votes per device hash and per IP hash per election (extra votes are silently not counted, not punished); device hash (D37Ref.device / d37_dev + stable browser signals) links accounts across IP changes / VPN, so switching IP does not add votes; accounts with no real gameplay (bot-like: no city tasks, no visits pattern) do not count; Turnstile captcha on the vote button when TURNSTILE_SITE_KEY is set (owner); suspicious clusters (many accounts on one device/IP, new accounts voting together) listed for the admin with «не считать» — never auto-ban;
   - the owner/admin can still appoint or remove a mayor and void an election;
   - results public, counts per candidate; ties → older account.

7. **Cities grow from ZERO through eras** (owner 22.10: «нужно постепенное развитие города, не сразу: сначала с нуля, потом с древнего
   мира до нынешнего»; chose «все города с нуля» and «у каждого поселения своя эпоха»). ALL cities — the capital's city part, the kids'
   town (0+, peaceful rules stay) and the big city (16+) — start as an empty site (campfire, tents) and are rebuilt by players through
   eras: stone age → ancient world → middle ages → industrial → modern (→ future / space with the planet plan T-051). Each settlement has
   its own era (they race and trade, like Civilization); an era is unlocked by deeds (population, resources, buildings, research), not
   by XP. Buildings, professions, tools, transport, services and looks depend on the era (no taxi/police/phones before the modern era).
   Coordinator decisions (one line each, owner may override): the spawn hub (plaza with the fountain, café and club with game tables,
   stage, portals to games) stays a neutral «timeless» area so the site's mini-games stay reachable on day 1; the battle zone and
   military bases stay a separate mode with their own progression (era-themed weapons later); players keep денки and skills from P1;
   the current city layouts become the modern-era blueprints. This reshapes P2–P7: a new plan (board T-053) comes BEFORE P2.
