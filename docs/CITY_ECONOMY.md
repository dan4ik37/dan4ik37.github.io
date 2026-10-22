# «Живой город» — the city economy (денки 💵), phase P1

Plan: `docs/plans/universe-step1.md` (§2 professions, §3 server, §7 P1). Owner 22.10.2026: numbers are a proposal —
«потом посмотрим — сделаем лог, чтобы проверить баланс». The log is the admin window «🏙️ Экономика города»; this file
holds the numbers, where to change them, what differs from the plan, and the simulation tables.

## Where the numbers live
- **One catalog:** `js/games/mir-econ.js` (`CITIES`, `PROFS`, `GOODS`, `SKILL`, `CAPS`, `BUFF`, `BANK`, `RATE`, `SITE`, `KEEP`,
  `CFGK`). `MirEcon.SERVER` is the part the server knows; `node scripts/gen-city-defs.cjs` writes it into `city_defs0()` in
  `city.sql` (never edit that JSON by hand; `--check` fails CI when it is stale).
- **Live changes without code:** profile → admin → «🏙️ Экономика города» → «⚙️ Настройки» (admin only; moderators read).
  Only keys from the `CFGK` whitelist, integers within their bounds (same check in `cfgOk` and `city_cfgok_`). Stored in
  `city_cfg.data`, merged over the catalog by `city_defs()`; `cv` (version) makes clients re-read the catalog. History of the
  last 30 changes is shown in the same window.
- **The same rules twice:** `MirEcon.Rules` (client preview, trial mode, simulation) and `city_act` / `city_settle_` (server
  decides). `scripts/city-sql-test.mjs` drives the same random moves through both (520 moves, 0 mismatches required).

## Numbers (P1)
| What | Kids' town 🧸 (0+) | Big city 🏙️ (16+) |
|---|---|---|
| Start treasury (`seed`) | 5 000 | 10 000 |
| Reserve (below it: «касса пуста») | 300 | 500 |
| Treasury cap | 30 × daily budget | 30 × daily budget |
| Income tax / sales tax (P2), % | 5 / 3 (corridor 0–10 / 0–8) | 10 / 5 (corridor 0–15 / 0–12) |
| Issuance per day | min(6 000, 300 + 120 × A7) × k / 1000 | min(12 000, 500 + 160 × A7) × k / 1000 |
| Shops | bakery: bun, pie; ice-cream kiosk | shop: apple, juice, burger; restaurant: pizza, soup, coffee; mall |

- **Start grant:** 50 💵 once per account (first job or purchase), minted.
- **Professions** (wage per task before multipliers, minimum seconds per task at level 0):
  cook 6 / 20, seller 5 / 15, doctor 6 / 20, firefighter 6 / 25, builder 7 / 20 (moves the shared building site),
  teacher 6 / 20, mechanic 6 / 15 — both cities; police 7 / 25 and taxi driver 10 / 40 — big city only (16+).
- **Skill** (tasks in that profession): 0 / 30 / 150 / 500 / 1500 → Ученик / Работник / Специалист / Эксперт / Мастер;
  wage × 100 / 110 / 125 / 140 / 160 %, minimum time × 100 / 95 / 90 / 85 / 80 %.
- **Fatigue per profession per day:** tasks 1–40 full wage, 41–60 half, then «смени работу». **Daily gross wage cap:** 400 💵.
- **Food:** price = ref × 1.25 (bun 5, pie 15, ice cream 5, apple 4, juice 5, coffee 8, burger 13, pizza 15, soup 13);
  buff +3…+10 % for 20–60 min, buffs never exceed +20 %; at most 20 bought per day, 10 of one kind in the pocket.
- **Wage math:** gross in hundredths = wage × skill % × (100 + buff) % × wage_k % × city rate %; tax = floor(gross × income % / 100)
  stays in the treasury; the net goes through a carry of hundredths (`frac`), so +5 % from food is real even at a 6 💵 wage.
- **Central bank** (once per day, global): M = average cash of players seen in the last 14 days, T = 1 500.
  M > 1.3 T: k − 50; > 1.1 T: − 20; < 0.7 T: + 50; < 0.9 T: + 20; otherwise k drifts by 10 toward 1000; k ∈ [500, 1500] ‰.
- **A7** = residents with ≥ 5 paid tasks on ≥ 2 of the last 7 days in that city, counted **by browser** (accounts sharing a
  `city_marks` device hash are one resident).
- **City rate (ставка города):** full wages while the treasury is at least one daily budget (base + per × A7, without k) above the
  reserve; below that, wages fall linearly to 10 % at the reserve. `rate.min`, `rate.days` are in the admin form.
- **Anti-abuse:** nonce chain + minimum task time (`too_soon` with `wait`), 60 actions per minute, the caps above, age gate
  (big city: teen16 / adult only; unknown age is refused), banned nicks, IP/device marks (salted hashes, 30 days) for the twins list.

## Money flows in P1
| Faucets (new money) | Sinks (destroyed) | Transfers |
|---|---|---|
| start grant 50; daily issuance into each treasury; admin «+» | treasury above its cap; admin «−»; cash of deleted accounts | wages (treasury → player), food (player → treasury), tax stays in the treasury |

Conservation: Σ cash + Σ treasury = Σ minted − Σ burned (per-city counters, independent of the 30-day ledger retention).
«🔎 Проверка» in the admin window shows the drift; tests require 0.

## Differences from the plan (one line each)
- Net wages use a carry of hundredths instead of «floor, at least 1» — otherwise +5 % food and +10 % skill vanish at a 6 💵 wage.
- Reserve is a catalog number (300 / 500) instead of «3 days of public wages» — a jump in A7 would otherwise lock the treasury.
- Treasury cap = `capDays` × daily budget (the budget is known at settle time; «public wages» are not).
- **City rate is new** (not in the plan): without it the simulation at 300 players refused 33–39 % of the tasks of kids and
  casual players («касса пуста» — first come takes all) and A7 of the kids' town fell in a spiral down to 1 (refused tasks do not
  count → less issuance → more refusals). With the rate: refusals 0.1–3.7 %, A7 stays (184 / 91), XP keeps counting.
- A7 by browser (device hash) — 50 twins on one browser cannot multiply issuance.
- The kids' town has 7 jobs (no police; the cargo-kart driver is P3); the big city has 9.
- Daily settle is lazy: the first action or read of the day in a city runs it (up to 7 missed days of issuance).
- Trial денки (guests, or before city.sql) never move into the account.

## What to watch in the log (and what to change)
- **«по сниженной ставке» is high for days** → issuance is short. First raise `cities.*.issue.cap` (it binds from A7 ≈ 48 in the
  kids' town and ≈ 72 in the big city), then `issue.per`. With 300 players the simulation shows kids at a 38 % average rate.
- **M / T keeps rising and k sits at 500** → expected in P1: the only sink is food. Do not cut wages for that; P2 (rent) and
  P4 (market fee) add sinks. Raise `bank.T` only if prices for players (P2+) should follow.
- **«упёрлись в 400» is common** → grinders; that is the cap working. Lower `caps.wageDay` only if the top-1 % / median ratio in the
  simulation goes above 30.
- **«касса пуста» is non-zero for a whole day** → the treasury sits at the reserve; check `reserve` and issuance.
- **Twins list** (shared IP or browser): shared IP is normal for families and schools; many accounts on one browser with wages near
  the cap is the suspicious pattern. P1 has no transfers, so twins cannot move денки to a main account.

## Simulation
`node scripts/city-sim.cjs [--days 90] [--players 5,20,100,300] [--seed 37] [--write] [--json]` — every move goes through
`MirEcon.Rules.act`, the day through a copy of `city_settle_`. Player types: kids (35 %, kids' town, 55 % of days, 6–20 tasks),
casual (30 %, 45 % of days, 4–14), daily (25 %, 85 % of days, 28–40 tasks), grinders (10 %, every day until the 400 cap, change
profession after 40), one reference player (38 cook tasks every day, big city), and a twins run (50 accounts on one browser).
Every player has its own random stream, so the twins run changes only the economics, not the behaviour of the others.
`--write` refreshes the blocks below; exit code 1 means a P1 gate failed.

<!-- sim:summary -->
Simulation: 90 days, seed 37 (node scripts/city-sim.cjs). Numbers: MirEcon.SERVER (= city_defs0).

P1 gates: ✅ all pass (treasury ≥ 0, zero money drift, 400/day wage cap, k inside its corridor, top 1 % ≤ 30 × median, the reference player reaches Specialist by day 6 and Master by day 50, twins).

Twins (100 players + 50 twins on one browser, 2 days of 7 with 5–6 tasks): P1 has no player-to-player transfers (0); the main account (daily player, big city) got 1150 more than in the run without twins, his peers 1337 on average → -186 above peers (gate 100). A7 counts browsers, so 50 twins on one browser are one resident. The twins themselves hold 22 110 that P1 gives no way to pass on.

⚠ Report only (not a P1 gate): 5: after day 30 M reaches 13 849 (9.23 T); 20: after day 30 M reaches 9378 (6.25 T); 100: after day 30 M reaches 7290 (4.86 T); 300: after day 30 M reaches 4417 (2.94 T). P1 has no sinks except food, so M keeps growing and the central bank sits at kMin; the 0.6–1.6 T corridor needs the P2/P4 sinks (rent, market fee).
<!-- /sim:summary -->

<!-- sim:tables -->
**5 players** (kids 1, casual 2, daily 1, grinders 1; + the reference player)

| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4 | 0 / 0 | 1050 | 0 | 0.00 | 5315 / 9790 | 315 / 525 | 808 | 73 | 0 | 100 % | 0 | 239 / 365 (×1.5) |
| 3 | 3 | 0 / 3 | 1150 | 423 | 0.28 | 5990 / 10 000 | 345 / 1127 | 770 | 60 | 0 | 100 % | 0 | 625 / 995 (×1.6) |
| 7 | 6 | 2 / 3 | 1350 | 829 | 0.55 | 7559 / 11 999 | 729 / 1323 | 1034 | 65 | 0 | 100 % | 0 | 309 / 2256 (×7.3) |
| 14 | 5 | 2 / 4 | 1380 | 1816 | 1.21 | 12 326 / 17 838 | 745 / 1573 | 882 | 60 | 0 | 100 % | 0 | 657 / 4462 (×6.8) |
| 30 | 3 | 2 / 4 | 610 | 4259 | 2.84 | 16 200 / 21 854 | 329 / 695 | 935 | 60 | 271 | 100 % | 0 | 1105 / 9505 (×8.6) |
| 45 | 4 | 2 / 3 | 500 | 6541 | 4.36 | 13 326 / 17 073 | 270 / 490 | 1034 | 58 | 0 | 100 % | 0 | 1381 / 14 338 (×10.4) |
| 60 | 5 | 2 / 4 | 500 | 8966 | 5.98 | 14 399 / 11 701 | 270 / 570 | 1056 | 45 | 0 | 100 % | 0 | 1928 / 19 291 (×10) |
| 90 | 5 | 1 / 4 | 500 | 13 849 | 9.23 | 12 491 / 1137 | 210 / 570 | 1079 | 63 | 3810 | 86 % | 0 | 3243 / 29 198 (×9) |

Per player over 90 days: kids: wallet 3243, earned 3468 (39/day), city rate 100 %, «касса пуста» 0.0 % of tries; casual: wallet 2193, earned 2278 (25/day), city rate 99 %, «касса пуста» 0.0 % of tries; daily: wallet 19 956, earned 21 061 (234/day), city rate 100 %, «касса пуста» 0.0 % of tries; grinders: wallet 29 198, earned 32 418 (360/day), city rate 100 %, «касса пуста» 0.0 % of tries; reference: wallet 27 328, earned 27 278 (303/day), city rate 100 %, «касса пуста» 0.0 % of tries.
Reference player (38 cook tasks every day, big city): Worker on day 1, Specialist 4, Expert 14, Master 40; «касса пуста» 0 times.

**20 players** (kids 7, casual 6, daily 5, grinders 2; + the reference player)

| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 12 | 0 / 0 | 1050 | 0 | 0.00 | 4895 / 9170 | 315 / 525 | 1950 | 175 | 0 | 100 % | 0 | 213 / 365 (×1.7) |
| 3 | 12 | 5 / 6 | 1150 | 300 | 0.20 | 5043 / 8684 | 1035 / 1679 | 1865 | 163 | 0 | 100 % | 0 | 202 / 995 (×4.9) |
| 7 | 17 | 11 / 8 | 1350 | 577 | 0.38 | 10 263 / 11 608 | 2187 / 2403 | 2675 | 216 | 0 | 100 % | 0 | 325 / 2256 (×6.9) |
| 14 | 14 | 11 / 9 | 1500 | 1347 | 0.90 | 22 292 / 19 713 | 2430 / 2910 | 2812 | 183 | 0 | 100 % | 0 | 735 / 4492 (×6.1) |
| 30 | 16 | 10 / 8 | 870 | 3302 | 2.20 | 43 794 / 24 885 | 1305 / 1548 | 2972 | 185 | 0 | 100 % | 0 | 1574 / 9776 (×6.2) |
| 45 | 17 | 11 / 9 | 500 | 5105 | 3.40 | 41 994 / 13 251 | 810 / 970 | 3218 | 175 | 0 | 100 % | 0 | 2319 / 14 729 (×6.4) |
| 60 | 15 | 12 / 8 | 500 | 6977 | 4.65 | 43 490 / 953 | 870 / 890 | 2091 | 213 | 0 | 63 % | 0 | 3104 / 19 651 (×6.3) |
| 90 | 14 | 12 / 9 | 500 | 9378 | 6.25 | 44 024 / 862 | 870 / 970 | 2125 | 200 | 0 | 57 % | 0 | 4647 / 29 115 (×6.3) |

Per player over 90 days: kids: wallet 4391, earned 4625 (51/day), city rate 100 %, «касса пуста» 0.0 % of tries; casual: wallet 2078, earned 2226 (25/day), city rate 91 %, «касса пуста» 0.0 % of tries; daily: wallet 15 345, earned 16 453 (183/day), city rate 77 %, «касса пуста» 0.0 % of tries; grinders: wallet 28 925, earned 32 430 (360/day), city rate 58 %, «касса пуста» 0.0 % of tries; reference: wallet 21 075, earned 21 025 (234/day), city rate 78 %, «касса пуста» 0.0 % of tries.
Reference player (38 cook tasks every day, big city): Worker on day 1, Specialist 4, Expert 14, Master 40; «касса пуста» 0 times.

**100 players** (kids 35, casual 30, daily 25, grinders 10; + the reference player)

| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 56 | 0 / 0 | 1050 | 0 | 0.00 | 1289 / 5348 | 315 / 525 | 10 128 | 925 | 0 | 100 % | 0 | 223 / 365 (×1.6) |
| 3 | 65 | 27 / 19 | 1150 | 242 | 0.16 | 1738 / 1002 | 4071 / 4071 | 7345 | 949 | 0 | 54 % | 0 | 150 / 996 (×6.6) |
| 7 | 67 | 66 / 27 | 1350 | 542 | 0.36 | 13 704 / 4793 | 8100 / 6507 | 11 267 | 966 | 0 | 100 % | 0 | 300 / 2257 (×7.5) |
| 14 | 64 | 70 / 27 | 1500 | 1283 | 0.86 | 39 942 / 14 046 | 9000 / 7230 | 11 824 | 938 | 0 | 100 % | 0 | 585 / 4463 (×7.6) |
| 30 | 69 | 66 / 28 | 910 | 3061 | 2.04 | 73 994 / 16 749 | 5460 / 4531 | 12 877 | 956 | 0 | 100 % | 0 | 1277 / 9506 (×7.4) |
| 45 | 75 | 68 / 25 | 500 | 4547 | 3.03 | 38 618 / 500 | 3000 / 2250 | 10 448 | 1094 | 0 | 45 % | 44 | 2029 / 14 106 (×7) |
| 60 | 67 | 66 / 25 | 500 | 5738 | 3.83 | 2291 / 500 | 3000 / 2250 | 6329 | 992 | 0 | 29 % | 29 | 2719 / 17 485 (×6.4) |
| 90 | 63 | 66 / 27 | 500 | 7290 | 4.86 | 2284 / 509 | 3000 / 2410 | 6123 | 916 | 0 | 28 % | 38 | 3539 / 23 940 (×6.8) |

Per player over 90 days: kids: wallet 3383, earned 3641 (40/day), city rate 80 %, «касса пуста» 0.1 % of tries; casual: wallet 1517, earned 1641 (18/day), city rate 74 %, «касса пуста» 2.4 % of tries; daily: wallet 13 348, earned 14 437 (160/day), city rate 73 %, «касса пуста» 1.6 % of tries; grinders: wallet 23 122, earned 27 085 (301/day), city rate 32 %, «касса пуста» 0.8 % of tries; reference: wallet 12 695, earned 12 645 (141/day), city rate 50 %, «касса пуста» 0.0 % of tries.
Reference player (38 cook tasks every day, big city): Worker on day 1, Specialist 4, Expert 14, Master 40; «касса пуста» 0 times.

**300 players** (kids 105, casual 90, daily 75, grinders 30; + the reference player)

| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 204 | 0 / 0 | 1050 | 0 | 0.00 | 300 / 500 | 315 / 525 | 18 012 | 2972 | 0 | 57 % | 182 | 56 / 365 (×6.5) |
| 3 | 204 | 71 / 68 | 1150 | 112 | 0.07 | 1411 / 2044 | 6900 / 13 087 | 20 249 | 2917 | 0 | 47 % | 0 | 82 / 722 (×8.8) |
| 7 | 185 | 180 / 96 | 1350 | 377 | 0.25 | 1659 / 6120 | 8100 / 16 200 | 26 187 | 2834 | 0 | 75 % | 0 | 202 / 1976 (×9.8) |
| 14 | 197 | 183 / 102 | 1500 | 969 | 0.65 | 1592 / 8678 | 9000 / 18 000 | 30 593 | 2784 | 0 | 81 % | 0 | 404 / 4193 (×10.4) |
| 30 | 190 | 184 / 100 | 1140 | 2346 | 1.56 | 1242 / 3341 | 6840 / 13 680 | 23 558 | 2811 | 0 | 57 % | 0 | 858 / 9441 (×11) |
| 45 | 186 | 178 / 96 | 500 | 3071 | 2.05 | 865 / 500 | 3000 / 6000 | 11 828 | 2811 | 0 | 19 % | 132 | 1095 / 13 550 (×12.4) |
| 60 | 202 | 181 / 98 | 500 | 3519 | 2.35 | 854 / 500 | 3000 / 6000 | 11 938 | 2942 | 0 | 19 % | 139 | 1220 / 16 692 (×13.7) |
| 90 | 195 | 188 / 97 | 500 | 4417 | 2.94 | 758 / 500 | 3000 / 6000 | 11 726 | 2765 | 0 | 19 % | 145 | 1487 / 22 476 (×15.1) |

Per player over 90 days: kids: wallet 1426, earned 1693 (19/day), city rate 38 %, «касса пуста» 0.1 % of tries; casual: wallet 701, earned 851 (9/day), city rate 36 %, «касса пуста» 3.7 % of tries; daily: wallet 6259, earned 7347 (82/day), city rate 38 %, «касса пуста» 2.2 % of tries; grinders: wallet 21 497, earned 25 419 (282/day), city rate 31 %, «касса пуста» 1.0 % of tries; reference: wallet 11 226, earned 11 176 (124/day), city rate 44 %, «касса пуста» 0.0 % of tries.
Reference player (38 cook tasks every day, big city): Worker on day 1, Specialist 4, Expert 14, Master 40; «касса пуста» 1 times.
<!-- /sim:tables -->

<!-- sim:twins -->
**100 players** (kids 35, casual 30, daily 25, grinders 10; + the reference player) + 50 twins

| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 72 | 0 / 0 | 1050 | 0 | 0.00 | 1289 / 4859 | 315 / 525 | 10 617 | 925 | 0 | 100 % | 0 | 223 / 365 (×1.6) |
| 3 | 79 | 27 / 20 | 1150 | 200 | 0.13 | 1738 / 993 | 4071 / 4255 | 7398 | 949 | 0 | 52 % | 0 | 150 / 996 (×6.6) |
| 7 | 76 | 66 / 28 | 1350 | 407 | 0.27 | 13 704 / 4720 | 8100 / 6723 | 11 482 | 966 | 0 | 99 % | 0 | 300 / 2257 (×7.5) |
| 14 | 81 | 70 / 28 | 1500 | 900 | 0.60 | 39 942 / 12 335 | 9000 / 7470 | 12 392 | 938 | 0 | 100 % | 0 | 585 / 4463 (×7.6) |
| 30 | 84 | 66 / 29 | 1230 | 2145 | 1.43 | 90 794 / 23 636 | 7380 / 6322 | 13 413 | 956 | 0 | 100 % | 0 | 1277 / 9506 (×7.4) |
| 45 | 91 | 68 / 26 | 500 | 3310 | 2.21 | 76 358 / 500 | 3000 / 2330 | 10 530 | 1096 | 0 | 44 % | 75 | 2029 / 14 280 (×7) |
| 60 | 76 | 66 / 26 | 500 | 4179 | 2.79 | 31 306 / 500 | 3000 / 2330 | 9376 | 1001 | 0 | 43 % | 57 | 2814 / 18 190 (×6.5) |
| 90 | 87 | 66 / 25 | 500 | 5429 | 3.62 | 2284 / 500 | 3000 / 2250 | 6007 | 953 | 0 | 28 % | 94 | 3779 / 25 080 (×6.6) |

Per player over 90 days: kids: wallet 3702, earned 3961 (44/day), city rate 87 %, «касса пуста» 0.1 % of tries; casual: wallet 1672, earned 1801 (20/day), city rate 80 %, «касса пуста» 2.1 % of tries; daily: wallet 14 738, earned 15 831 (176/day), city rate 79 %, «касса пуста» 1.4 % of tries; grinders: wallet 24 022, earned 27 938 (310/day), city rate 35 %, «касса пуста» 0.7 % of tries; reference: wallet 14 301, earned 14 251 (158/day), city rate 55 %, «касса пуста» 0.0 % of tries; twins: wallet 442, earned 392 (4/day), city rate 70 %, «касса пуста» 27.0 % of tries.
Reference player (38 cook tasks every day, big city): Worker on day 1, Specialist 4, Expert 14, Master 40; «касса пуста» 0 times.
<!-- /sim:twins -->
