# «Вселенная Денчика» — путь от микроба до звёзд: весь путь игрока и порядок постройки (T-053)

Plan v1, 2026-10-22. Sources: `docs/superpowers/specs/2026-10-16-universe-design.md` (§2, §5–§7, §10, §13), `docs/plans/universe-step1.md`
(P1 is live; «Owner decisions» 6–7 and the correction), `docs/plans/planet.md` (T-051, branch `worktree-agent-a580b564af45ca9d2`),
`docs/CITY_ECONOMY.md`, `js/games/mir-econ.js`, `docs/plans/kubomir-modpacks.md` (§3.3, §6.1, §6.4, §7½), `docs/MOBS.md`, `docs/COMBAT.md`,
`docs/NATIONS.md`, `docs/ENGINE_ECONOMY.md`, `docs/WORLD_MAP.md`, `docs/WORLD_EXPANSION.md`, `docs/REALMS.md`, CLAUDE.md (master instruction,
«Мир Денчика» 3D, «Живой город», «Клеточки», «Кубомир», «Подземье», «Студия 3D», «Возраст»).
**(P)** = a proposed number. It lives in a catalog with an admin override, because the master instruction says numbers belong to the owner.
Sizes as in planet.md: **S** < 1 agent run, **M** ≈ 1, **L** ≈ 2–3, **XL** ≥ 4. This task writes no game code.

> Board numbers: the plan originally proposed T-054…T-070; T-054 and T-055 were already used on the board, so every new number here is shifted by +2 (T-056…T-072) by the coordinator on 22.10.

## Для владельца (кратко, по-русски)
1. Путь игрока: микроб в капле воды → существо на суше → «Пробуждение» разума → племя у костра → своё поселение с нуля → эпохи (каменный век → древний мир → средневековье → заводы → наше время) → будущее и космос. Всё — на одной планете (её основу делает T-051), и все стадии живут на ней одновременно.
2. Клетка — на основе «Клеточек»: между раундами улучшаешь клетку за ДНК, клетки слипаются в колонию, в конце выбираешь, кем выйдешь на сушу (≈ 1 ч).
3. Существо — редактор тела (как в Spore), еда, гнездо, стая, зима и жара, поколения: состарился — играешь потомком; разум растёт, как в Ancestors. Через ≈ 2–3 ч — «Пробуждение»; род можно развивать и дальше, десятки часов.
4. Житель — твой нынешний персонаж из гардероба; род даёт ему «наследие» (рожки, хвост, узоры — украшения, не сила).
5. Племя: огонь, каменные орудия, шалаши, запасы на зиму (зима — декабрь–февраль, по твоему календарю), приручение зверей. Если играешь один — тебя примет племя-ИИ, и ты станешь вождём.
6. У каждого поселения своя эпоха; она открывается делами (стройки, жители, ремёсла, знания), а не опытом. Такси, полиция и телефон в руке появятся только в «наше время».
7. Столица, Солнечный городок и Большой город в день «Начало времён» (его назначишь ты) начнут с костра и палаток; их нынешние улицы станут чертежом «нашего времени», к которому город и придёт.
8. Остаются: денки и навыки, дома на участках, военные базы, монеты и 💎. Площадь с играми и боевая зона — вне эпох, мини-игры доступны с первой минуты.
9. Нынешние игроки — «Первопоселенцы»: сразу живут в поселениях; пройти свой род с микроба — по желанию, с наградой. Новые игроки начинают микробом.
10. Чтобы мир не был пустым, племена и сёла-ИИ живут и растут сами, а первыми жителями городов станут нынешние игроки.
11. Дети: мирные поселения и земли 0+, без оружия и набегов; ребёнок и взрослый не могут быть в одном племени (как сейчас с личкой).
12. Заработок сайта — только облики на каждой стадии (окраски, узоры, стили домов, одежда эпох) и реклама на естественных паузах («прошли миллионы лет», «прошли века»). Силы за деньги нет.
13. Строим с клетки: клетка → скелет существ (заодно красивые мобы «Кубомира») → редактор существ → жизнь существа → племя; рядом — ядро эпох для городов; потом ремёсла, жильё, «Начало времён», эпохи II–V, вся планета, космос.
14. Нужны 5 твоих решений (раздел 8): сколько длится обязательный путь новичка, «Первопоселенцы», день «Начала времён», что остаётся вне эпох, телефон до «нашего времени».

---



## Owner decisions (22.10.2026) — they override the recommendations of §8

1. **Long path to awakening: ≈ 15–20 h** (cell ≈ 1–2 h, creature the rest), not the short 3–4 h gate. Mitigate the empty
   civilization layer with NPC tribes and settlements that grow by themselves (T-060) and with visible progress of others.
2. **Everyone starts as a microbe — no «Первопоселенцы» shortcut**, existing players included. Coordinator decision (owner may
   override): site-wide things stay with the account (🪙, 💎, wardrobe items, VIP, levels, achievements — red line «заработанное —
   к аккаунту»); world-layer progress from P1 (денки, profession skills) is kept but becomes usable when the player reaches the
   settlement stage.
3. **Only the plaza with the games stays outside the eras.** The plots district (homes) and the battle zone with military bases
   also follow the eras: homes from huts to houses, fights from clubs and bows through catapults and early guns to today's
   vehicles; the current district/bases content becomes the modern-era (E5) version. Era packs T-064…T-067 must include them.
4. **Phones and satellites must be logical**: the site phone (chat, friends, calls) always works; the phone in the character's hand
   and in-world apps (taxi, GPS, bank) only from «наше время». Several different satellites with real coverage — navigation (GPS),
   communication/internet, maybe TV/weather; out of coverage or underground a service does not work (relays in caves, towers in
   cities, as in kubomir-modpacks §7½). Applies to T-072 and the space steps SP-1…SP-4.
5. «Начало времён» day — the owner sets it later.


## Checking in a big world (owner 22.10: «а если мир станет больше? Может, чуть больше свободы, но по-другому проверять, переложить
## ответственность или сделать проверку внутри мира чем-то другим?»)

Principle: strict server checks only where cheating breaks the game for everyone; freedom everywhere else, verified differently.
1. **Hard core on the server (stays strict, it is cheap):** money and items appearing or moving, ownership of land and buildings,
   ratings and rewards. One RPC per action, indexed, a few ms — scales with T-045/T-071. Never moved to browsers.
2. **Simulation in players' browsers (more freedom):** movement, physics, building, fights, creatures run at the region host
   (a player's browser) as now. Checked by plausibility at the host (speed, reach, rate), by deterministic re-simulation of
   samples on the server (like raids already do), and by peers: 2–3 nearby players act as witnesses; a disagreement
   triggers a server replay of that event instead of trusting one side.
3. **Responsibility inside the world (part of the game, era-appropriate):** settlement leaders approve building projects and set
   local rules; elders/guards/police/courts by era handle griefing; reputation that NPC traders, guards and other settlements
   react to; weighted reports with trust (as designed for mods in docs/MODS.md); exile from a settlement as a consequence. Kids'
   realm: only soft tools (blocks, reports to staff), never courts.
4. **Statistics instead of checking every step:** the server watches aggregates (the city economy log, wealth spikes, impossible
   production, twin clusters) and flags them for the owner; suspicious accounts get stricter checks (more samples) automatically.
5. **Everything reversible:** an action journal and per-region snapshots, so a missed cheat or griefing can be rolled back
   (fits the rule «nothing is lost forever»).
6. **A separate anti-cheat service** (owner 22.10: «можно ещё античит сделать, который другая система проверяет, а не сам сервер»; board T-073): its own container (later its own small server), not the game server. It reads an append-only event journal (actions from the RPC layer, auditable inputs from rooms/regions via the T-045 «anti-cheat feed», economy statistics), re-simulates deterministic parts in its own time, keeps a risk score per account (hashed ids, no personal data) and acts softly: flag for the owner, more sampling, temporary limits, rollback requests — final bans by the owner/moderators. It never slows gameplay and can be updated independently; browser-side checks stay only as a first filter (they are easy to bypass).
Owner of this design: T-045 (server), T-071 (regions on our server), T-058/T-060 (leaders and rules), T-037 (elections).

## Owner decision 22.10.2026 (evening): more animal stages between the cell and the land; the sea is 3D underwater
Owner: «так разве мы не должны пройти этап рыба и другое?» → chose «Ещё больше стадий» and «3D под водой». This overrides the
single «Существо» stage of §1.1: the animal part of the path is now FIVE stages, each with its own body rules, all on the shared
creature core (T-020 rig + T-057 editor + T-059 life core — needs, food, nest, generations, mind):

| # | Stage | View | Where | Body and rules | Ends with |
|---|---|---|---|---|---|
| 1 | 🦠 Клетка (built, T-056) | 2D top-down | tide pool: Лужа → Риф → Глубина | parts for DNA, colony | C4 — the cell's plan (Пловец / Панцирник / Ползун) becomes the starting body of the sea stage; button «🌊 В море» |
| 2 | 🐟 Море (fish) | 3D underwater, 3rd person | the real sea of the home planet near the lineage's homeland: shallows, reef, open sea, deep | swimming (fins, tail, jaws, eyes, armour, electric/poison organs), food chain, predators, schools with friends, depth zones need adaptations | «Лёгкие и лапы» → «🐸 На берег» |
| 3 | 🐸 Берег (amphibian) | 3D, water + land | coasts, swamps, rivers | breath in water and air, legs from lobe-fins, eggs must stay near water, dries out away from it | «Яйцо в скорлупе» → «🦎 Вглубь суши» |
| 4 | 🦎 Ящеры (reptiles) | 3D | inland: steppe, desert, forest | shell eggs on land, scales, cold-blooded (warm up in the sun — climate.js day/night/seasons matter), big forms possible | «Тёплая кровь» → choose 🐾 Звери or 🐦 Птицы |
| 5 | 🐾 Звери / 🐦 Птицы (mammals / birds) | 3D | everywhere; birds fly | warm-blooded (fur / feathers, active at night and in cold), care for the young, packs and flocks; birds — wings and flight | «Пробуждение» → the Person and the tribe (§1.4) |

Rules: everyone passes all stages (owner: «все с микроба»); each stage is playable and useful on its own (records, encyclopedia,
cosmetics of the lineage — no coins for money, no paid speed-ups beyond the normal XP boost rule); the creature editor grows with
the stages (new part groups unlock per stage); NPC wildlife of the planet uses the same species (players' designs become wildlife
only after review, §2.5); kids — peaceful lands, knockout instead of death. Lengths (P, tune with sims): sea 2–3 h, shore 1–2 h,
reptiles 2–3 h, mammals/birds 3–5 h to awakening. Order: T-020 (rig, after trees/fire) → T-057 (editor) → T-059a (life core) →
T-092 Море → T-093 Берег → T-094 Ящеры → T-095 Звери и птицы (each after the previous) → awakening (T-059b) → tribe (T-060).

## 0. Decisions (one line each; the owner can change any of them)
- **The path:** cell → creature → awakening → the Person: tribe (a settlement in era 0) → settlement eras → future and space. One account = one Person
  (the site avatar) + lineages («род»): 1 slot free, VIP or donor +1 (P). Extra slots are comfort, not power.
- **The Person is the existing avatar** (world3d, wardrobe, 🪙/💎 items keep working). The lineage grants *heritage* cosmetics (horns, ears, tail,
  skin pattern, eye colour). Creature bodies never walk in settlements, so doors, vehicles and interiors stay human-scaled.
- **The hub is a timeless meta-space** («Площадь Источника»: fountain, café and club tables, stage, wardrobe, game gates). Every account's Person may be
  there from minute one, as today. Outside the hub you play your current stage until you awaken.
- **New accounts start as a microbe.** The gate to the civilization layer is awakening. The short path is ≈ 3–4 h (P: cell ≈ 1 h + first creature arc
  ≈ 2–3 h). The full creature stage (10–30 h) and tribe stage (5–15 h) keep the spec's lengths as optional depth with the best rewards.
- **Accounts that exist before the gate ships are «Первопоселенцы»**: awakened by default, they keep everything (§4).
- **A tribe is a settlement in era 0** («Стоянка»). One server model (the P1 `cities` table, extended) covers camps, villages and cities, and every
  settlement has its own era.
- **Eras:** E0 Стоянка · E1 Каменный век · E2 Древний мир · E3 Средневековье · E4 Заводы · E5 Наше время · E6 Будущее · E7 Космос (owner's order;
  mapping to the spec's I–VII in §3.3). Eras are unlocked by deeds counted on the server, never by XP or 💎.
- **«Эпоха места»:** inside a settlement only the tools, vehicles and services of its era work. In the wild you use your home settlement's era.
  Nobody can harm anybody at a different stage.
- **One currency, денки 💵, in every era.** Shells → coins → notes is only a look. P1 wallets, skills, ledgers and treasuries carry over unchanged.
- **Professions keep their P1 ids** (`cook`, `seller`, …). Each era gives a variant (name, tool, place, task steps), and skills carry across eras.
- **Today's city layouts become the E5 blueprints.** A settlement grows toward its plan ring by ring. A lot keeps its function across eras while its
  look follows the era (`D37E.arch`).
- **Outside the eras:** the hub, the plots district (personal homes, `bases.sql`) and the battle zone with military bases (own progression; era skins later).
- **Phones:** the site menu (chat, friends, calls, settings) works in every era, shown as an era-skinned «Дневник». The phone in hand and in-world apps
  (taxi, GPS, mobile bank) appear only from E5. GPS needs the first satellite (`D37E.signal`, planet.md SP-2).
- **Server files:** evolution (cell, creature, lineage, species, finds) goes in a new area file `evo.sql`. All civilization (tribes, settlements, eras,
  economy) stays in `city.sql`. No new Vercel functions, no crons and no new presence fields (lazy formulas, as in P1).
- **Geography:** wild lands v1 are the nature of today's Mir map (phase A). The whole planet comes after T-051 M1/M2 (phase B, §2.1).
- **NPC life:** wildlife moves by seed + time with no network traffic. NPC tribes and villages grow lazily by formula, are capped at E2 (P) and adopt
  solo players.
- **Kids:** 0+ settlements and lands are peaceful. Joining a tribe is invite-based and goes through `kid_pair_ok` (no child ↔ adult/unknown tribes, as
  T-010). Children under 13 build names from presets. Every new table gets `realm text default 'all'` for a future full split (REALMS §1).
- **Money:** per-stage cosmetics and ads at natural pauses only. Nothing paid speeds evolution, mind, eras, projects or votes. NATIONS §9½ «Меценат»
  shrinks to cosmetic plaques and fireworks, and there is no 💎 → денки exchange (step1 §9).
- **Temporary bypass:** until the creature stage ships, C4 «На сушу» grants awakening directly (a server flag).
- **The old P2–P6 plan (T-033…T-037) is replaced** by era-aware steps (§6.3). Nothing is built in a modern-only form that the reset would erase.

## 1. The player journey

### 1.1 Overview
| # | Stage | View | Where | Length (P) | Next stage opens | Built on | Age |
|---|---|---|---|---|---|---|---|
| 1 | Клетка | 2D, top-down | micro-arenas tied to a coast point: лужа → риф → глубина | 45–75 min to C4; 1–2 h in full | C4 «На сушу» | «Клеточки» (`iokit`, `PARTS`) | 6+ |
| 2 | Существо | 3D, 3rd person | wild lands | first arc 2–3 h → awakening; 10–30 h in full | awakening (and you can keep playing) | `D37E.creature` (T-020), editor, `player.js`, `D37E.combat`, `climate.js` | 6+; duels 12+ |
| 3 | Племя | 3D, the Person | tribal lands (a camp = settlement E0) | 5–15 h to E1 | founding E1 | world3d, `D37E.tech`, `city.sql`, survival ideas of «Кубомир»/«Подземье» | 6+; raids 12+ |
| 4 | Поселение и эпохи | 3D + view from above for leaders | settlements | E1 → E5 ≈ 3–4 months for an active settlement; no end | E7 | P1 «Живой город», `mir-city.js`/`mir-zones.js`, `interior.js`, `D37E.arch` | 0+ / 12+ / 16+ per settlement |
| 5 | Будущее и космос | 3D, orbit, system map | sky, orbit, Moon, other systems | no end | — | planet.md SP-1…SP-4 | 6+; battles 12+ |

### 1.2 Cell (built on «Клеточки»)
- **Mode «Путь клетки»** sits beside the classic arena. Classic rooms, rewards and the keys `kletochki` / `kletochki_online` stay exactly as they are.
- **Lineage:** the cell design is a list of parts. The existing `PARTS` (membrane, flagellum, spikes, eye, jaw, chloroplast) gain new parts as data (P):
  cilia (turning), adhesion (needed for a colony), toxin cloud (slows chasers), armour membrane (loses less mass), photophore (sight in the dark, glow)
  and pigment (cosmetic). Each part has a DNA cost, membrane slots and stats through `bodyStats`. Trade-offs (speed against size) mean no part is
  strictly best.
- **DNA** comes from nutrients: sugars (light, chloroplast), proteins (eating cells) and minerals (deep, rare). The daily cap is 300 (P). The first
  rounds of the day pay ×2 («отдохнувший»): a bonus, never a penalty.
- **Micro-biomes:** Лужа (bright, safe, weak bots — the tutorial), Риф (rich, predator bots with jaws) and Глубина (dark, minerals, giant NPC cells; eyes
  and photophores matter). Milestones open them.
- **Light and season come from the planet.** The lineage has a home coast point. Local hour = `D37E.planet` `localHour` (a pure module, T-051), or
  `E.dayClock` until that merges; the season comes from `climate.js`. Chloroplasts pay in daylight and photophores at night, so the real hour matters
  and players have a reason to return at different times.
- **Colony (C3):** with adhesion, split pieces stay linked by springs (up to 7 cells (P)). Roles follow part placement (mover, eater, guard). This is
  the bridge to a body plan.
- **C4 «На сушу»:** choose a body plan (Ползун — legs early; Пловец — fins; Панцирник — shell (P)) and a diet (plants / meat / both). This sets the
  creature's starting template and parts. The transition screen «Прошли миллионы лет» is a natural ad pause.
- **Together:** path rooms are split by micro-biome tier (separate from the classic `pub` rooms). Bots fill them, the 20 s newbie shield stays, there is
  emoji only (as now) and «Позвать друга».
- **Rewards:** only DNA and cosmetics. The site's XP and 🪙 still come only from the existing `kletochki` keys, so there are no new faucets.
- **Guests** keep a trial lineage in the browser. It is imported once on first login, capped at C3 (P).

### 1.3 Creature
- **Start:** at the coast near your tide pool (your lineage's homeland). Controls: joystick + 4 buttons on the phone (bite/act, call, eat, sense), pad
  and keyboard. Results are the same at 30/60/144 FPS.
- **Body** comes from the editor (T-057). Parts set speed, stamina, bite, defence, senses, swim and climb (glide later), plus a size class
  (small/medium/large (P)) that sizes the `player.js` capsule.
- **Loop:**
  - forage, and hunt NPC prey (knockout → «искры еды», no bodies);
  - drink and rest;
  - avoid predators (their attacks are telegraphed, like Kubomir mobs);
  - weather and seasons from `climate.js`: fur and fat win in the owner's winter, heat tolerance in summer;
  - nest, raise young, mark territory.
- **Generations (Ancestors):**
  - a life is 40–60 min of play (P), then you mate with an NPC of your species or with a friend's creature (mutual consent);
  - you pick 1 of 3 young (your parts + seeded mutations + DNA picks) and play it;
  - the elder «уходит на покой» and fades into the tree of life;
  - nothing is lost: a branch that did badly «засыпает» and you continue from the nearest one.
- **Mind:** 5 branches × 5 nodes (P):
  - Чуткость (sense view), Ловкость (dodge, speed), Память (map memory, stores), Общение (pack calls, taming), Смекалка (sticks and stones as tools);
  - points come from first-time deeds, discoveries and social acts;
  - half of them pass to the young (P).
- **Awakening (P):** generation ≥ 3, Смекалка ≥ 3, Общение ≥ 2 and a visit to a monolith → a cinematic → the Person opens. Heritage looks are granted
  from the final form.
- **The long game (10–30 h):**
  - legendary beasts (fought with a pack or friends);
  - seasonal migrations and every biome;
  - the encyclopedia (whoever finds a thing first names it);
  - records (largest, fastest, oldest lineage) and the lineage museum;
  - after review, your species lives on as wildlife for everyone.
- **PvP:** none by default. Duels need mutual consent and are 12+ only; children never duel.

### 1.4 Awakening and the Person
- The Person is the site avatar (wardrobe, 46 slots, world3d): the same one in the hub, the mini-games and the sprites (char2d).
- Heritage: 6–10 granted parts (P) derived from the final creature (horn shape, ear type, tail, skin pattern, eye colour, glow spots). They use a new
  `grant` kind 4 in `D37Char.PARTS` (1 friends, 2 season, 3 advent exist), are granted by `evo.sql` and are checked by `char_save` like season items.
- Small earned perks from the mind tree are capped at ≤ +5 % in one activity (P). They are the same for anyone who plays their lineage, Первопоселенцы
  included.
- After awakening you can:
  - (a) join any settlement and live in its era (a newcomer to a medieval town starts medieval);
  - (b) found or join a tribe in the wild;
  - (c) keep playing the lineage.
  You switch between the Person and the lineage at the fountain or from the menu.

### 1.5 Tribe
- **Who:** 1–8 awakened Persons + NPC members (hired with food (P)). Alone, an NPC tribe adopts you. With no other players you become the chief, and it
  becomes your tribe.
- **Where:** a camp on free land in the wild (rules in §2.4). A camp is a settlement in era 0.
- **Loop:**
  - gather sticks, stones, fibre and berries at seeded spots that regrow by time;
  - make things: knapping, cordage, spear, basket, fire drill, torch (`D37E.tech` — the same ideas as early «Кубомир»/«Подземье»);
  - keep the fire: it burns fuel over time and gives warmth, cooking and safety;
  - build lean-to → hut → longhouse → palisade as projects;
  - store for winter in the communal stock on the server;
  - hunt NPC wildlife with knockout (0+ camps track, herd and tame instead);
  - tame a wolf into a dog (later the Person's pet);
  - treat mild illness with a healer's herbs;
  - hold rituals and raise totems (culture points);
  - earn «озарения»: the first time you make a thing, the camp learns its next step.
- **Seasons:** autumn — stock up; winter (December–February by the owner's calendar) — cold, needs hides and stock; spring — the Наурыз festival;
  summer — long days.
- **Neighbours:** trade, alliances and help. Soft raids are 12+ only, behind a flag, and come later (§2.4).
- **Leader:** the chief («вождь»), elected by members under the owner's anti-fraud rules (T-037). The founder leads until the first vote.
- **End:** when the E1 requirements are met (§3.4), «Основать посёлок» turns the camp into a village with a plan and lots, and the members become its
  founders. A tribe can also join an existing settlement (migration).

### 1.6 Settlement and eras
- **Personal life** is the P1 loop (professions by era, skills, wages in денки, food buffs) + homes, own business and leadership (the revised P2–P7, §6).
- **Settlement loop:** projects → deeds → the next era. Settlements race each other in the «Летопись мира» (the first to each era gets a monument),
  build roads, trade and form alliances. Countries and wars come later under NATIONS rules (12+; peaceful settlements never).
- **Leaders by era:** вождь (E0–E1) → совет старейшин (E2) → правитель (E3) → мэр и совет (E4+). Powers follow step1 §5 with era tools; elections follow
  owner decision 6 of step1.

### 1.7 Future and space
- E5 ends with a spaceport and the first satellite, which gives GPS to the settlement and its allies (P) (`D37E.signal`).
- E6 «Будущее» (biotech and symbiosis) needs the living planet (spec step 2, T-070).
- E7 «Космос»: ships, orbit, the Moon and other systems (planet.md SP-1…SP-4). Citizens of other eras may ride as passengers (tourism).

### 1.8 What keeps it long and interesting
| Stage | Session | Day | Week | Long term | Together | Discovery |
|---|---|---|---|---|---|---|
| Клетка | round goals (eat 30 sugars, survive the reef) | a cell task of the day (seeded) | a new part or micro-biome | records, colony shapes, patterns | path rooms, invite a friend | the micro-life encyclopedia |
| Существо | hunt, nest, escape | a migration or weather event (calendar) | a new generation and mind node | 10+ generations, legendary beasts, museum | a pack with friends, consent duels | the first finder names it |
| Племя | gather, build, hunt | keep the fire, feed the camp | a new hut or insight | winter survival, founding | 2–8 friends + NPCs, chief elections | places and monoliths |
| Поселение | shifts (P1) | jobs, market | a project stage, era deeds | the era race, leadership, business | city chat, elections, trade | eras and wonders |
| Космос | flights | trade runs | a new body visited | colonies | crews | planets named by their finders |
The story thread (spec §5.4, item 7) costs only data and a few models. The fountain plaza is the «Источник», older than any era, and monoliths stand
across the planet. Each stage reveals a piece: cells feel its glow, creatures find monoliths, tribes keep the stories, settlements decode them, and space
finds where they point.

## 2. One shared planet, all stages at once («развитие мира везде»)

### 2.1 Two phases of geography
- **Phase A (now, until T-051 M2):** everything lives in today's Mir map (6144 u ≈ 5.3 km, `worldmap.js`):
  - tide pools sit on its sea coasts, rivers and lakes;
  - wild lands are the nature outside zones and claims;
  - the free land between cities (WORLD_MAP §3) holds tribal lands and settlement sites;
  - the «сёла» that WORLD_MAP planned become NPC villages.
- **Phase B (after M1/M2):** the map becomes the region `mir` of the home planet (R 128 000 u ≈ 110 km, planet.md §1.3 and §10.1) — the «Старые земли»
  with the hub. Tide pools appear on every coast (`D37E.biomes`), wild lands cover the continents, new settlements appear far away, and regions and
  channels follow planet.md §5.
- Nothing from phase A is redone in phase B: positions are stored as region + local coordinates from the start (`site: { region: 'mir', x, z }`).

### 2.2 Zones
| Zone | For | Phase A / phase B | Rules |
|---|---|---|---|
| Первичный океан (лужи, рифы, глубина) | cells | coasts of the map / every coast by biome | 2D micro-arenas tied to a coast point; nothing changes in 3D |
| Дикие земли | creatures; travellers and hunters | map nature outside claims / most of the planet | NPC wildlife; only nests and camps may be placed |
| Земли племён | tribes | camp radius 150 m (P) | members build; visitors trade |
| Поселения | settlements | radius by era: E1 250 m … E5 1.2 km (P) | «эпоха места»; age class 0+ / 12+ / 16+ |
| Вне времени | everybody | the hub + the plots district; the battle zone (12+) as its own mode | always reachable; mini-games; no eras |
| Мирные земли | children first | 0+ settlements + 300 m around them (P) + the hub | no PvP, raids or wars; gentle wildlife; presets for under-13 |

### 2.3 What each stage sees of the others
| Who | Sees | Can do with other stages |
|---|---|---|
| Cell | its arena; the day, night and season of its coast; «тени великанов» (creatures passing above, from the seeded wildlife schedule — no network) | nothing outside the arena, except receive a scientist's gift (below) |
| Creature | wild lands, NPC wildlife, players' creatures (🐾 + lineage name), smoke and fires of camps, settlement walls, monoliths | pack with friends; befriend a tribe by mutual consent → «спутник» (follows a friend's Person, like Far Cry Primal); cannot enter interiors or harm people and buildings |
| Person (tribe or settlement) | the whole macro world; creature players marked 🐾 | trade, visit, travel; NPC wildlife: hunt (knockout) in 6+ lands, track, herd and tame in 0+ lands; cannot harm player creatures; later a scientist with a lens (E3) or microscope (E4) can watch a tide pool (spectator of a path room) and drop a nutrient gift |
| Settlement | other settlements on the map and in the «Летопись» | trade only goods allowed in the receiver's era; roads; alliances; contact gives both sides research (P) — a reward for trading, not for being behind (NATIONS §5¾) |
| Space (E7) | orbit and other bodies | satellites give GPS; ships carry passengers of any era |

### 2.4 Anti-grief
1. **No harm across stages.** The server and every client drop damage events between different stages.
2. **Conflict inside a stage is bounded:**
   - cells: the classic arena rules (tiers, newbie shield);
   - creatures: consent duels, 12+;
   - tribes: raids 12+, behind a flag, only in raid windows; the defenders lose at most 10 % of their stock (P) and never huts, tools or homes; new and
     small tribes get shields; a tribe with any member under 13 can never be raided;
   - settlements: NATIONS rules (windows, shields, nothing personal lost); peaceful settlements never fight.
3. **Land:**
   - claims keep their distance: a camp ≥ 300 m from other camps and ≥ 500 m from settlements (P);
   - never in the hub, zones, peaceful buffers or NPC sites;
   - one citizenship per account;
   - a camp with no member activity for 30 days falls asleep and its site frees up after 90 days (P); its data is never deleted, so members can refound.
4. **Text:** presets for under-13; filters and reports for everyone else (one complaints module, docs/MODS.md). Species designs are reviewed before
   they become wildlife, and children see only approved species and names.
5. **Twins:** device and IP marks (like `city_marks`) apply to founding, votes and era deeds, counted by device as A7 is.
6. **«Эпоха места»:** no tank in a stone-age village, no car before E4 roads.
7. **Spawn protection:** cells 20 s (exists), creatures 2 min after spawning or a knockout (P).

### 2.5 Kids and age realms
- **Age classes:**
  - the path stages are 6+ (cartoon, knockout, «пуф» — like «Клеточки» and «Кубомир»);
  - duels and raids are 12+;
  - settlements are 0+ (peaceful), 12+ (standard; wars later) or 16+ (adult role play: police, courts, banks — like the big city now,
    `MirZones.ADULT_AGE`).
- **Under 13:**
  - free access to 0+ and 6+ places;
  - 12+ places only to visit with «взрослый разрешил» (`D37Age.canOpen`);
  - 16+ places only as far as `D37Age` allows visits today;
  - citizenship and work in 12+ and 16+ settlements only for teen/adult by year, decided on the server (as `city_age_ok_`; unknown age is refused).
- **Private contact (T-010) applies everywhere:** tribe invites and joins, pack invites, duel requests and settlement council chats all go through
  `kid_pair_ok` / `kid_why` on the server. Under 9: emoji and presets only.
- **Names** of species, tribes, settlements and discoveries: under-13 use a preset builder (like the nick generator); others type filtered text that is
  moderated. Public pages show children as «Игрок» (`publicNick`).
- **0+ settlements** have no police, guards, weapons, raids, wars or robbery role play. Hunting becomes tracking and taming.
- **Realm-ready:** `realm text default 'all'` on the new tables (lineages, species, settlements, members). If the full split of REALMS §1 is ever turned
  on, inhabitants and channels split by realm while the seed-made planet stays shared.

## 3. Cities from zero

### 3.1 One model for camps, villages and cities (extends P1 `cities`)
```
cities        + kind ('official'|'player'|'npc'), name, age (0|12|16), era smallint, era_t bigint,
                site jsonb {region, x, z, r}, plan jsonb {seed, kind: 'blueprint'|'ring'|'grid'|'river', rings},
                leader uuid, leader_kind, realm text default 'all', status ('active'|'sleep'), founded_at, founders jsonb, era_mode bool
                (the check id in ('kids','metro') is relaxed: 'kids', 'metro', 'cap', 's' + base32; the communal stock is `stock` jsonb)
city_members  (user_id pk, city, role, since, moved_at)        -- one citizenship
city_lots     (city, lot, ring, type, era_built, state, proj)  -- the plan: the type persists, the look follows era_built
city_projects (step1 §3.2 + era, lot, kind 'build'|'era'|'road'|'wonder')
city_deeds    (city, era, key, n)                              -- counters for era requirements
```
Kinds: `official` (capital 0+, kids' town 0+, big city 16+), `player` (founded by a tribe) and `npc` (seeded tribes and villages, computed lazily,
capped at E2 (P)).

### 3.2 Founding and citizenship
- **Camp (E0):** 1–8 awakened players (+ NPC members) on a free site (§2.4). It costs only a campfire (P), so tribes form easily.
- **Village (E1)** comes by deeds (§3.4).
- **Citizenship:** one per account. Moving is free with a 7-day cooldown (P), and the old settlement keeps your contributions in its history.
- **Capacity (P):** at most 3 player camps per km² in phase A, and at most 200 active settlements per planet before the region server (T-071).

### 3.3 Eras and what each unlocks
| Era (spec §6.3) | Building types | Tools and tech (`D37E.tech`) | Transport | Services | Looks |
|---|---|---|---|---|---|
| E0 Стоянка | campfire, tents, drying rack | fire drill, sharp stone, basket | on foot, carrying | warmth | hides, ochre |
| E1 Каменный век (I) | huts, longhouse, palisade, store pit, totem, «камень рода» | knapped axe and spear, cordage, hides, bow (late) | raft, log boat | fire, healer, storyteller | hides, bone and feather jewellery |
| E2 Древний мир (I–II) | mud-brick houses, granary, well, fields, pottery, market, «камень памяти», dirt roads | pottery, loom, bronze, wheel, plough, writing | ox or donkey cart, rowing boat | water, food store, market prices, culture | linen, clay beads |
| E3 Средневековье (II) | timber and stone houses, mill, smithy, library, guild hall, bathhouse, walls (12+/16+ only), cobbled roads | iron, water mill, glass, paper, compass, sails | horse wagon, sailing ship | watch (never in 0+), fire watch, school, hygiene | wool, leather, tunics |
| E4 Заводы (III) | brick houses, factory, mine, rail station, hospital, fire station, post, gas lamps | steam, coal, steel, rail, telegraph, late electricity | train, steamship, first cars and trucks | fire brigade, hospital, rail, post | coats, caps |
| E5 Наше время (IV) | the blueprint: today's buildings (shops, restaurant, police, hospital, bank, mall, towers) | cars, phones, internet, satellites (late) | today's vehicles: car, taxi (16+), police car (16+), kart (kids), boat, helicopter, plane; metro and airports (T-029 content) | police (16+), bank, taxi (16+), phones, internet | today's clothes |
| E6 Будущее (V–VI) | glass domes, green towers, bio-labs | biotech, symbiosis, clean energy, robots | maglev, drones | planet care (needs T-070) | future wear |
| E7 Космос (VII) | spaceport, orbital station | rockets, ships | rockets, shuttles | space trade | suits |
Taxis, police and phones in hand exist only from E5. Earlier eras get period counterparts (porter, carter, coachman; storyteller, scribe; watch).

### 3.4 Unlock by deeds (P; numbers in the catalog, admin overrides, checked by `city-sim` with eras)
| Transition | Residents (players + NPC; players counted by device, ≥ 5 deeds in the era) | Projects completed | Production or stock | Knowledge | Min days in era |
|---|---|---|---|---|---|
| E0 → E1 | 3 (≥ 1 player) | fire, 3 huts, «камень рода» | 200 food, 100 wood stocked | 3 | 2 |
| E1 → E2 | 8 (≥ 3) | field, granary, well, palisade, potter's workshop | 50 pots, 300 grain in 7 days | 10 | 7 |
| E2 → E3 | 15 (≥ 5) | market, a road to a neighbour or a trade route, smithy, library | 50 iron tools; 3 chains active | 25 | 14 |
| E3 → E4 | 25 (≥ 8) | water mill, mine, 4 workshops, school, bridge or road | coal and steel chains; 4 chains | 50 | 21 |
| E4 → E5 | 40 (≥ 12) | power station, railway, hospital, school, factory | electricity and steel; 5 chains | 90 | 28 |
| E5 → E6 | 60 (≥ 16) | spaceport + satellite, digital services, clean-up (planet health, T-070) | — | 150 | 35 |
| E6 → E7 | 80 (≥ 20) | orbital station | — | 220 | 42 |
- **Knowledge points** come from storyteller, scribe and teacher tasks, insights and trade contact.
- **Evaluation:** requirements are evaluated lazily in `city_tick_` from `city_deeds`, projects, production counters and residents.
- **Eras never go down** («nothing is lost forever»). The first settlement to reach an era gets a monument and a line in the «Летопись».
- **Pace:** the minimum days alone make E1 → E5 at least 70 days; an active settlement takes about 3–4 months.
- **NPCs:** NPC residents keep production and services running, but era deeds need players (NPC villages are capped at E2).

### 3.5 Professions by era (P1 ids stay; the era picks the variant)
| id | E1 Каменный век | E2 Древний мир | E3 Средневековье | E4 Заводы | E5 Наше время |
|---|---|---|---|---|---|
| `cook` | Повар у костра | Пекарь лепёшек | Пекарь | Повар столовой | Повар |
| `seller` | — (barter at the fire) | Торговец на рынке | Лавочник | Продавец | Продавец |
| `doctor` | Знахарь (herbs) | Лекарь | Лекарь | Врач | Врач |
| `fire` | Хранитель огня | Водонос | Пожарный дозор | Пожарная команда | Пожарный |
| `builder` | Строитель шалашей | Строитель | Плотник / каменщик | Строитель | Строитель |
| `teacher` | Сказитель | Писец | Летописец / учитель | Учитель | Учитель / учёный |
| `police` | — | — | Стражник (12+/16+ only) | Городовой (16+) | Полицейский (16+) |
| `driver` | Носильщик | Возничий | Возчик / лодочник | Машинист / кучер | Водитель; таксист (16+) |
| `mech` | — | Тележник | Мастер-кузнец | Механик | Механик |
| `miner` | Камнетёс | Рудокоп | Рудокоп | Шахтёр | Шахтёр |
| `lumber` | Дровосек | Лесоруб | Лесоруб | Лесопильщик | Лесоруб |
| `farmer` | Собиратель | Земледелец | Крестьянин | Фермер | Фермер |
| `worker` | Мастер орудий (flint) | Гончар / медник | Кузнец / ткач | Рабочий завода | Рабочий цеха |
| `hunter` (new) | Охотник | Охотник / пастух | Охотник / пастух | — | — |
| `mayor` | Вождь | Старейшина | Правитель | Мэр | Мэр |
- **0+ settlements:** never police or guards; `hunter` becomes «Следопыт» (tracking, herding, taming).
- **Places are lot types** (food, shop, health, fire, build, school, guard, transport, repair, quarry, wood, farm, workshop), not building ids. The era
  variant picks the model, the tool and the task steps (the P1 TaskRunner templates: walk, hold, carry, use — with era props).
- **Data:** `PROFS.cook.v = { 1: { n, tool, steps }, 2: { … }, … }`. The P1 field `cities` (building ids per city) gives way to a lot type `place`;
  P1 wages, minimum times and skill levels apply unchanged.

### 3.6 Buildings in the style of the era (`D37E.arch`), plans and rings
- **`arch.plan(seed, kind, rings)`** returns `{ lots: [{ id, ring, x, z, w, d, type, yaw }], streets }`. The `blueprint` kind reads today's tables
  (`K_BLD`, `M_BLD`, `MirZones.lotsOf`); `ring`, `grid` and `river` are generated for player settlements and the capital. Rings open by population and
  era, like `WAR.ring` for bases: E1 ring 1 … E5 ring 5 (P).
- **`arch.build(type, era, lot, seed, out)`** returns records (coloured boxes, wedges, cylinders) merged the way `mir-base.js` already does (`M.rec` /
  `M.mergeGen`, 21 bytes per vertex, near and far LOD). A settlement is a few merged meshes: ≤ +10 draw calls nearby (step1 §8), silhouettes far away.
- **Style kits per era are data:**
  - materials: hide, thatch, mud brick, timber frame, stone, brick, concrete and glass, future;
  - roof forms, windows, doors and props;
  - street surfaces: path → dirt → cobble → asphalt;
  - lights: torches → oil → gas → electric;
  - a bright palette variant for 0+ settlements (like the `kids` palette in `mir-zones.js`).
- **Construction stages are part of a kit** (markers → frame → walls → roof → done), and the project stage drives the look (P1 `SITE` already had 5
  stages).
- **Interiors:** `interior.js` gets `ctx.era` (furniture sets per era); doors keep `MirZones.accessRules`.
- **Rules carried over:** build code yields after every statement (the zone build budget, WORLD_MAP §10) and shaders are warmed by `warmer()`.
- **Inhabitants and vehicles:** residents (`residentAt`) and NPC staff wear era outfits; zone vehicles (`def.vehicles`) and traffic appear only in their era.

### 3.7 The capital, the kids' town and the big city become empty sites
- **Capital (`cap`, 0+):**
  - the hub stays (plaza, fountain, café, club, stage, wardrobe, gates, park);
  - the capital settlement is founded at E0 beside it, on the free ring south of the plaza where today's street with 4 houses stands;
  - its plan is a `ring` around the plaza, and the 4 houses become its first E5 lots;
  - it gets a new treasury of 5 000 (P).
- **Kids' town (`kids`, 0+) and big city (`metro`, 16+):**
  - on the switch day their modern buildings stop being drawn, and each zone shows an E0 camp: campfire, tents, the NPC tribe «Первые» and the
    Первопоселенцы;
  - the plan is their current table (`K_BLD`, `M_BLD`); lots appear ring by ring, each with the era's building of the same type (the restaurant lot is a
    fire pit in E1, a tavern in E2–E3, a canteen in E4 and today's restaurant in E5);
  - their sites can move to the WORLD_MAP stage (b) spots (far apart) on the switch day, because there is nothing to move (T-029 is re-scoped, §6.3).
- **Treasuries stay.** The P1 shared building site (`cities.site`) becomes the first project, «Дом первопоселенцев»: a monument with a plaque of P1
  builders (children shown as «Игрок»).
- **Rollback:** the per-settlement flag `era_mode` (off = P1 modern mode) allows a rollback for 30 days (P).

### 3.8 Migration of P1 data
| P1 data | After the switch |
|---|---|
| `city_people.cash` (денки) | unchanged |
| `city_people.skills` | unchanged; era variants read the same ids, so levels carry over |
| `cities.treasury`, ledger, contributions, marks, days | unchanged (new columns only) |
| `cities.site` | progress of «Дом первопоселенцев» |
| P1 job places (`k_bake`, `m_rest`, …) | lot types (food, shop, health, …) → the era's place |
| police and taxi jobs (16+) | dormant until E3 (guard) or E5; skills stay |
| `city_cfg` overrides (wages, minimum times) | still apply to the same profession ids |
| open market orders, prepaid rent (if T-061/T-062 shipped before the switch) | refunded in full when the new era cannot hold them; personal lockers stay |
| trial денки (guests) | unchanged and never imported (as now) |
| `MirEcon.V` | 2 (era mode); the client gates features by `sv` |
The conservation check («Проверка» in «Экономика города») must show 0 drift before and after. PGlite runs the migration on a copy of P1 data.

### 3.9 Coordinator decisions — confirm or change
1. **The hub stays timeless (confirm).** The mini-games stay reachable on day 1. The story: the Plaza of the Source exists in every era.
2. **The battle zone and military bases stay a separate mode (confirm).** They keep their own progression (`bases.sql`, `raids.sql`) and age 12+. Era
   weapon skins come later, and the zone becomes the battlefield for future NATIONS wars.
3. **The plots district stays timeless (new, confirm).** Personal homes and furniture fall under «nothing is lost». Era facade skins can come later as
   cosmetics.
4. **Phones (new, confirm):** as in §0.
5. **The Person keeps its body (new):** heritage instead of creature bodies in cities (§1.4).
6. **City sites move on the switch day (technical):** the kids' town and big city go to their WORLD_MAP (b) spots.
Items 1–4 are owner decisions 4–5 in §8.

## 4. Existing players: start as a microbe, or join directly?
| Option | For | Against |
|---|---|---|
| A. Everybody starts as a microbe | one rule for all | punishes loyal players; cities stay empty for days; clashes with «nothing is lost» (their homes, денки) |
| B. «Первопоселенцы» join settlements directly; their own lineage is optional | populates the reborn cities on day 1; fair; simple | they skip the story (answer: the lineage is an optional path with rewards) |
| C. Choose at first login | flexible | confusing; most would pick B anyway |
**Recommendation: B.**
- Every account created before the awakening gate ships (the T-059 release) is awakened by default.
- Everyone keeps the Person, денки, skills, homes, bases and 🪙/💎 items.
- The title «Первопоселенец» and a name on the plaque go to accounts with P1 city activity before the switch day.
- A one-time card «Начать свой род» offers a heritage reward for reaching C4 and for awakening.
- Their Persons can found or join a tribe, or live in the official settlements from E0.

## 5. «Везде»: every game plugs in

### 5.1 Games
| Game | Role in the universe | Shares | Adapter task |
|---|---|---|---|
| «Клеточки» | the cell stage (mode «Путь клетки»); the classic arena stays | `D37Evo` (cell parts, DNA), `iokit` rooms | T-056 |
| «Червячки» and the other mini-games (cards, boards, arcades, «Орда», «Арена», «Башни») | the hub (timeless); profession tasks in settlements reuse small task steps | — | — |
| «Кубомир» | block-planet places (planet.md §10.2) and the survival sandbox | `D37E.creature` + bestiary (its mobs), `D37E.tech` (tool tiers and recipes by era), `D37E.accessories` (T-049), PlanetProfile | T-020 adapter; an S task after T-058 maps its item ids to `D37E.tech` |
| «Подземье» | the underground and caves (2D) | bestiary sprites baked from the rig, `D37E.tech`, accessories (second adapter), planet wrap (P-P1…P-P3) | S tasks after T-020 and T-058 |
| «Мир Денчика» | the civilization layer of the home planet: hub, settlements, wild lands (phase A) | `MirEcon` + `city.sql`, `D37E.arch`, `D37E.tech`, residents, vehicles by era | T-058…T-067; T-059 (`mir-wild.js`); T-060 (`mir-tribe.js`) |
| «Студия 3D» | player-made places and tools | creature parts (NPC creatures), era building kits and tech items as no-code parts, the planet world type (S-P1) | S–M tasks after T-057 and T-064 |
| Military bases, «Набеги» | the battle zone, separate | era skins later | — |
| Wardrobe, `charedit` | the Person and heritage parts; the creature editor reuses its editor patterns (sections, cards, palettes, undo, mirror) | `D37Char` grant kind 4 | T-057, T-059 |
| Phone | the era-skinned menu; in-world apps by era | `D37Phone` | T-062, T-067 |
| `climate.js`, `celebrate.js` | seasons and holidays in every stage | — | used as they are |

### 5.2 Shared engine modules and data catalogs (one catalog per number; thin adapters per game)
| Module | Status | Holds | Used by |
|---|---|---|---|
| `D37E.planet` (+ view, regions), `D37E.biomes` | T-051 (proof built), PL-3 | sphere, regions, local hour, biome lookup | all stages in phase B; cell light from the local hour |
| `D37E.creature` + `D37E.bestiary` | T-020 (re-scoped) | rig from parts, gaits, LOD, merged meshes, sprite baking; species JSON (kubomir-modpacks §6.1), spawn rules, encyclopedia | creature stage, wildlife, Kubomir mobs, Podzem sprites, Studio parts |
| `D37E.combat` | done (T-012) | moves as data, knockout, poses packed for the network | bites, rams, tail swipes, hunting, duels |
| `D37E.tech` | new (T-058) | items, recipes, stations and insights by era (pure data, node-loadable) | tribe, settlements; id maps for «Кубомир» and «Подземье» |
| `D37E.arch` | new (T-058) | era styles, plans, rings, construction stages | settlements, Studio era kits |
| `MirEcon` + `city.sql` | P1 done | the one catalog of civilization numbers: eras, deeds, professions, goods (era data in `mir-eras.js`, merged by `gen-city-defs`) | settlements, tribes |
| `D37Evo` + `evo.sql` | new (T-056) | cell parts, creature part costs, mind tree, milestones, caps, `Rules` | cell, creature, awakening |
| `D37E.accessories`, `D37E.signal` | T-049, planet.md SP-2 | worn helpers; GPS and relays | the Person: watch → compass → atlas → phone with GPS |
| `D37E.quests` | T-049 K1.10 | goals of the day and week | every stage (until then, simple goal lists like Podzem `GOALS`) |
| `npc.js` + residents, `climate.js`, `net.js` / `iokit` / rooms | exist | people, schedules, weather, rooms | everywhere |

## 6. Build order (from the cell, as the owner asked)

### 6.1 Lanes and waves (4–6 agents at once, CLAUDE.md)
- **Path (the owner's order):** T-056 cell → T-057 editor → T-059 creature life. The tribe (T-060) is the next step of the path but lives in the city lane.
- **Creatures engine:** T-020 starts together with T-056 (disjoint files).
- **City:** T-058 era core starts in wave 2, in parallel with the editor; it also adds the денки sinks P1 lacks (CITY_ECONOMY: M grows 3–9× the target
  by day 90). Then T-060 tribe → T-061 → T-063 «Начало времён» → T-064…T-067 era packs; T-062 and T-068 fit in between.
- **Planet:** T-051 → PL-2, PL-4, PL-5 → M1 → M2 → T-069 → T-070 → space.
- **Waves:** 1 — T-056, T-020; 2 — T-057, T-058; 3 — T-059, T-060; 4 — T-061; 5 — T-062, T-063; 6 — T-037, T-064…T-068, T-069 (when M2 is ready);
  7 — T-070, T-071, T-072, space.
- **Estimate (P):** the path lane up to awakening ≈ 7–9 agent runs; the city lane up to the switch ≈ 11–13 runs.

### 6.2 Steps → board tasks (each is playable and useful on its own)
| # | Task | Step | Size | After | Playable result and value for the site | Main files |
|---|---|---|---|---|---|---|
| 1 | **T-056** | «Клетка»: cell stage v1 on «Клеточки» | L | — (T-009 done) | «Клеточки» gains a lineage and an evolution editor: a reason to return daily; SEO «эволюция клетки онлайн» | new `kletochki-path.js`, `evo.js`, `evo.sql`; a small seam in `kletochki.js` |
| 2 | **T-020** (re-scoped) | «Существа: скелет и бестиарий» (`D37E.creature`, `D37E.bestiary`), then the MOBS.md monsters through it | L + M (Kubomir adapter) | T-012 done; the adapter after T-019 if it touches `kubomir-ents.js` | non-box Kubomir mobs, new monsters, Podzem sprites | new `js/engine/creature.js`, `bestiary.js`; `KubomirEnts.mobView` |
| 3 | **T-057** | «Редактор существ» (Spore-like, phone first) | M | T-020, T-056 | make and share a creature (share card for traffic); a creature part in «Студия 3D» | new `evo-editor.js` |
| 4 | **T-058** | «Эпохи: поселение с нуля» (era core: settlements, plans, lots and rings, eras E0–E1, deeds, projects, profession variants, communal stock, `D37E.arch` kit E0–E1, `D37E.tech` v1, `era_mode` and migration code, a test site «Новая стоянка») | XL (a: server and catalog — L; b: buildings and client — L) | T-032 done; wave 2 | anyone can build a stone-age village on the test site while the official cities stay modern; new денки sinks | `city.sql`, `mir-econ.js` + new `mir-eras.js`, new `js/engine/arch.js`, `js/engine/tech.js`, `mir-city.js`, `mir-zones.js` |
| 5 | **T-059** | «Жизнь существа» (first arc to awakening) | XL (a: body, needs, food, nest, wildlife — L; b: generations, mind, awakening, encyclopedia, heritage parts — L) | T-057 | a creature survival game in the wild lands; the awakening gate for new accounts | new `mir-wild.js`, `evo.js`, `evo.sql`; hooks in `mir.js` |
| 6 | **T-060** | «Племя и стоянки» (camps, gathering, making, fire, shelters, hunting and taming, seasons, NPC tribes, chief, founding E1) | XL (a: camp, gathering, making, fire, shelters — L; b: hunting and taming, seasons, NPC tribes, founding — L) | T-058; the awakening hook from T-059 (Первопоселенцы can play as soon as T-060a lands) | survive with friends or NPCs and found a settlement | new `mir-tribe.js`, `city.sql`, `tech.js` |
| 7 | **T-061** | «Ремёсла, склады и рынок по эпохам» (old P2 + P3: lockers, raw goods, recipes and chains by era, logistics from porters to trucks, the order book from E2) | L | T-060 | trade and production chains (also in today's modern cities until the switch) | `city.sql`, `mir-econ.js`, `mir-city.js`, phone apps |
| 8 | **T-062** | «Жильё, службы и спрос по эпохам» (old P4 + P5: homes from huts to flats, rent and rest, shops with NPC demand, services, happiness) | L | T-061 | homes and shops; more sinks | same as T-061 |
| 9 | **T-063** | «Начало времён»: the three cities restart at E0; Первопоселенцы; announcement; rollback flag | M | T-058, T-060a, T-061 (T-062 recommended) + the owner's day | all cities from zero, on stream | `city.sql` migration, `mir-city.js`, `mir-zones.js` |
| 10 | **T-037** (re-scoped) | «Вождь → мэр: выборы» (leaders by era, the owner's anti-fraud vote rules) | L | T-060, T-062 | leadership and elections | `city.sql`, `mir-city.js` |
| 11 | **T-064** | Era pack II «Древний мир» (arch kit, profession variants, tech, carts and boats, services, looks) | L | T-063 | settlements can reach E2 | catalog + kit |
| 12 | **T-065** | Era pack III «Средневековье» | L | T-064 | E3 | same |
| 13 | **T-066** | Era pack IV «Заводы» (rail — part of T-029's content) | L | T-065 | E4 | same + `vehicle-rail` |
| 14 | **T-067** | Era pack V «Наше время» (the blueprints, today's vehicles, metro and airports, in-world phone apps) | L | T-066 | E5: today's city returns | same |
| 15 | **T-068** | «Своё дело по эпохам» (old P7: stall → workshop → shop) | M | T-062 | own business | `city.sql`, `mir-city.js` |
| 16 | **T-069** | «Дикие земли на всей планете» (tide pools on every coast, wildlife and camps across the planet, region channels) | L | T-051 M1/M2, PL-3, T-059 | the whole planet | planet adapters |
| 17 | **T-070** | «Живая планета, этап 1» (fertility, water and herds per area — spec §4, step 2 — affect creatures, farms, E6) | XL | T-069, T-061 | a living planet | engine + `city.sql` |
| 18 | **T-071** | «Регионы на своём сервере» (busy regions hosted by T-045: wildlife fights, raids and duels authoritative; Supabase + browser host as fallback) | L | T-045, T-069 | scale beyond the free tier | server + `net.js` |
| 19 | **T-072** | «Помощники жителя» (T-049 accessories for the Person: watch → compass → atlas; phone with GPS after the first satellite) | S–M | T-049, T-063 | shared accessories | adapters |
| 20 | SP-1…SP-4 | Space (planet.md §10.5): the E5 satellite, E7 ships, the Moon, systems | L / M / L / XL | T-067, PL-9 | space | engine |

### 6.3 What happens to tasks already on the board
| Task | Now |
|---|---|
| T-020 | re-scoped as step 2: the rig and bestiary first, then the new monsters through them |
| T-029 | split: city sites move far apart on the T-063 switch day (nothing to move); trunk roads become era projects (E2+); metro, airports and ports go into the E4–E5 packs (T-066, T-067) |
| T-033 (P2) | → T-058 (raw goods, communal stock) + T-061 (lockers, market from E2) |
| T-034 (P3) | → T-061 |
| T-035 (P4) | → T-058 (projects) + T-062 (homes) |
| T-036 (P5) | → T-062 |
| T-037 (P6) | re-scoped: leaders by era (step 10) |
| T-049, T-050 | unchanged; T-072 reuses the accessories for the Person |
| T-051 | unchanged; its M1/M2 feed T-069 |
| T-045 | unchanged; T-071 uses it |
| T-052 | unchanged; special monsters use the T-020 rig and never appear in 0+ lands |
| T-023 | weather «как в Симс» later serves creatures and the Person (cold, wet) |

### 6.4 Done means (every step)
- Playable on phone, PC and pad, with the same results at 30/60/144 FPS (automatic test).
- Numbers before and after on the phone profile (CPU ×4, «средняя»): frame CPU and draw calls. No garbage per frame in hot loops, no leaks over 20
  open/close cycles, no errors in a 10–15 min soak. A fallback when something fails: no SQL → trial mode; no WebGL → a message; a broken shader → the
  graphics guard.
- Server: the area file runs twice in PGlite; JS ↔ SQL parity on random moves; caps and age gates are tested; REST checks for the owner go into CLAUDE.md
  «Ожидает запуска»; without the new SQL the site says «появится, когда сайт обновится». The owner applies SQL in one batch at the end.
- Simulations: `evo-sim` (time to C4 and to awakening) and `city-sim` with eras (pace at 5/20/100/300 players, money corridor) pass their gates.
- `GAMES_VER` is bumped; a short English report goes to the coordinator (CLAUDE.md format).
- Step-specific acceptance:
  - T-056: the median bot reaches C4 in 45–75 min; the server enforces the DNA cap; path rooms never mix tiers; the classic arena tests stay green.
  - T-020: 10 template species at ≤ 8 draw calls each, ≤ 24 rendered; sprites bake; Kubomir hitboxes and fixed-step results stay unchanged.
  - T-057: a design always validates (parts, symmetry, size bounds) or explains why not; it saves and shares.
  - T-058: era-up works in PGlite with time travel; the P1 migration dry run shows 0 drift; official cities stay untouched while `era_mode` is off.
  - T-059: two clients see the same wildlife without network; the median bot awakens in 2–3 h; knockout, never death.
  - T-060: a camp reaches E1 with 3 players, or 1 player + NPCs; the server refuses a child ↔ adult tribe join.
  - T-063: dry run on a copy, rollback, Первопоселенцы flags, a 0-drift audit before and after.

## 7. Risks and mitigations
| Risk | Mitigation |
|---|---|
| An empty civilization layer at launch: nobody reaches cities for days | Первопоселенцы live in settlements from E0. NPC tribes and villages grow by formula (capped at E2) and adopt solo players. Official settlements have NPC residents and services. The short path is ≈ 3–4 h. Stream events («Великое переселение»: viewers found a settlement live). The hub stays busy with mini-games. Era requirements are catalog numbers with admin overrides, checked by `city-sim` at 5–300 players. |
| The gate scares newcomers away | a short gate; the hub and mini-games from minute one; friends can join the cell and creature stages; awakening fits in 5–8 evenings at most (P) |
| The owner's existing work (today's big city, taxi, police) disappears for months | the blueprints guarantee it returns in E5; the switch is a flag with rollback; an announcement in advance; the plaque «Дом первопоселенцев» |
| The scope is huge for agents with weekly limits | every step is playable alone; sizes are fixed; shared modules; era packs are data; E2–E4 content can start thin; if the budget stops, everything built keeps working |
| Phone performance (creatures + settlements + planet) | budgets: a creature ≤ 8 draw calls, ≤ 24 rendered, herds instanced or sprites far away, wildlife AI ≤ 1.5 ms per frame on the phone profile; settlements ≤ +10 draw calls with the build budget; planet budgets as planet.md §1.4; every step measured; quality switches |
| Server load and free tier (500 MB database, 2 M realtime messages a month, 200 concurrent connections) | lazy formulas (no ticks, no crons); wildlife by seed + time (0 messages); movement sent only on change; region channels; compact JSON (lineage ≤ 2 KB, design ≤ 1 KB); retention; T-071 for busy regions; usage checked before and after each step |
| Kids' safety | §2.5: `kid_pair_ok` on every group invite, presets, review before species become wildlife, peaceful 0+ lands, 16+ gated on the server |
| Rude creature shapes or names (the Spore problem) | parts are constrained (no free meshes) and symmetric by default; species reach other players only after review; reports hide them; children see approved ones only |
| Cheating (client-reported DNA and hunts) | server caps per day, minimum times and nonces (like `city_act`); hunts give lineage progress only (no денки), so cheating hurts nobody else; duels and raids are decided by the host or T-071 |
| Денки inflation (P1 has almost no sinks) | T-058 adds NPC wages on projects and building upkeep (destroyed) plus tool wear; T-061 adds the market fee; the central bank stays |
| Anachronism and cross-era grief | «эпоха места»; no harm across stages; trade limited by the receiver's era |
| File conflicts between parallel agents | file owners in §6.2; small seams (`kletochki-path.js`, `mir-wild.js`, `mir-tribe.js`); only hooks in `mir.js`; `GAMES_VER` above both branches |
| The planet is late | phase A runs on today's map; coordinates are region + local from day one |
| Red lines (paid strength, paid randomness) | cosmetics only; mutations are seeded and free; no paid DNA, eras, projects or votes; rewarded ads only for comfort (revive in place, keep the carried food) and never in records |
| Legal | names, art and text are ours; Spore, Ancestors and Thrive appear only as comparisons on SEO pages |

## 8. Owner decisions (5)
1. **Mandatory path for newcomers:** short (≈ 3–4 h to awakening: cell ≈ 1 h + the first creature arc ≈ 2–3 h; the full creature and tribe stages
   optional) or long (≈ 15–20 h)? Recommendation: short. **DECIDED by the owner 29.10: LONG — «чем дольше, тем лучше»** (the full
   creature and tribe stages are part of the path; keep every hour varied — no grind walls; magic branches from the cell stage on).
2. **Existing players are «Первопоселенцы»:** they keep everything and live in settlements at once; their own lineage from the microbe is optional,
   with a reward. Recommendation: yes.
3. **«Начало времён»:** the day the three cities go back to the campfire (after T-058, T-060a and T-061; ideally on stream), and the pace: stone age →
   today ≈ 3–4 months for an active settlement (adjustable later). Recommendation: the owner picks the day; the pace as proposed.
4. **Outside the eras:** the plaza with games, the plots district (personal homes) and the battle zone with military bases. Recommendation: yes; era
   skins for houses later, as cosmetics.
5. **Phones before today:** the site menu (chat, friends, calls, settings) in every era as a «Дневник»; the phone in hand and in-world apps (taxi, GPS,
   mobile bank) only from «наше время»; GPS after the first satellite. Recommendation: yes.

## Appendix A. Data and server sketches (for the step agents; final shapes in each step's plan)
```js
// js/games/evo.js → window.D37Evo (pure; SERVER → evo_defs() by scripts/gen-evo-defs.cjs, --check in CI)
CELL = { flagellum: { cost: 20, slots: 1, speed: 1.12 }, cilia: { cost: 15, slots: 1, turn: 1.2 },
         adhesion: { cost: 40, slots: 1, colony: 1 }, photophore: { cost: 30, slots: 1, dark: 1.5 }, … }   // + kletochki PARTS fields
BIOMES = { pool: { light: 1, food: 1, bots: 'weak' }, reef: { food: 1.6, bots: 'jaw' }, deep: { light: 0, minerals: 1, giants: 1 } }
MILESTONES = { c2: { parts: 1 }, c3: { dna: 400, colony: 3, minMin: 20 }, c4: { colony: 5, biomes: ['reef'], minMin: 40 } }
BODY = { leg: { cost: 30, maxPairs: 3 }, fin: {…}, horn: {…}, jaw: {…}, beak: {…}, fur: {…}, shell: {…}, ear: {…}, eye: {…} }
MIND = { sense: [/* 5 nodes: { cost, gives } */], agile: […], memory: […], social: […], wit: […] }
AWAKE = { gen: 3, wit: 3, social: 2, monolith: 1 }
CAPS = { dnaDay: 300, actMin: 30, roundMin: 60 }
```
```sql
-- evo.sql (new area file; deps: profiles, banned_nicks, age.sql — age_group_of, kid_pair_ok; idempotent, one transaction)
evo_lineage (user_id, slot, stage ('cell'|'land'|'awake'), dna, dna_day, dna_today, parts jsonb, plan, diet, design jsonb,
             gen, mind jsonb, home jsonb {region, x, z}, name, realm default 'all', awake_at, rev, pk (user_id, slot))
evo_species (id, user_id, slot, design jsonb, name, status ('draft'|'review'|'public'|'hidden'), reports, realm, at)
evo_finds   (kind, key, user_id, name, status, at, pk (kind, key))        -- the first finder names it
evo_defs() · evo_state() · evo_act(p_act, p_a, p_dev) · evo_public(p_kind, p_ver) · evo_admin(p_act, p_a)
-- evo_act: cell_round {dna, t, biome} · part_buy · parts_set · milestone · name · design_save · gen_next · mind_pick · find · awaken
```
```js
// js/games/mir-eras.js (data; merged into MirEcon.SERVER by scripts/gen-city-defs.cjs)
ERAS   = [{ id: 0, n: 'Стоянка', kit: 'e0', ring: 0, leader: 'chief' }, { id: 1, n: 'Каменный век', kit: 'e1', ring: 1 }, …]
DEEDS  = { 1: { pop: 3, players: 1, proj: ['fire', 'hut*3', 'stone'], stock: { food: 200, wood: 100 }, know: 3, days: 2 }, 2: { … } }
BTYPES = { food: { 1: 'firepit', 2: 'tavern', 3: 'tavern', 4: 'canteen', 5: 'blueprint' }, … }
PROFS.cook.v = { 1: { n: 'Повар у костра', tool: 'stick', steps: 'roast' }, 2: { n: 'Пекарь лепёшек' }, 5: { n: 'Повар' } }
```
`city.sql` additions:
- `city_found(p_a)`, `city_join(p_city)` (invites and joins pass `kid_pair_ok`), `city_leave()`, `city_contribute(p_proj, p_a)`;
- era evaluation inside `city_tick_`;
- `city_public` also returns the era, open rings, the lots revision and deed progress;
- `city_letopis()` (anon) feeds the public page `/world` («Летопись мира»: settlements, eras, firsts). Like `/bestiary` (approved species and finds),
  it is a route in `api/pages.js` (no new function), with standard ads and children shown as «Игрок».
