---
name: d37-sql-verify
description: Verify from the server (Supabase REST, as a guest with the public publishable key) that the owner really applied a site SQL file — PGRST202/PGRST205 means not applied — and prepare the ordered SQL list for the owner. Use after the owner says SQL is "done", before relying on a new column or function, and when writing a new or changed *.sql file.
---

# SQL: write, hand over, verify

Rules (CLAUDE.md "Owner, language, tokens" + "Pitfalls"): one idempotent SQL file per area in the repo root (`create or replace`,
`if not exists`, `add column if not exists`); no new SQL files without need; the owner runs them by hand in ONE batch at the end,
in the order you give; the SQL Editor applies a file all-or-nothing; "done" from the owner ≠ applied — always verify.
History and expected answers per file: docs/areas/sql-history.md (each entry lists its REST checks).

## Verify (guest, read-only)
`node scripts/sql-rest.cjs <rpc> '<json body>' … table:<name> …` — reads SB_URL and the publishable key from
js/features/chat.js itself (never paste keys into prompts, files or chat).
- `node scripts/sql-rest.cjs world_now '{}' game_win_xp '{"p_game":"tiles"}'` → `200 <number>`, `200 4`
- Meaning: 200 + the expected value = applied, newest version; `PGRST202` (function) / `PGRST205` (table) with no other sign =
  NOT applied (exit 2). BUT `PGRST202` whose hint says «Perhaps you meant to call the function public.<the same name>(…)», or a
  function that answers a read-only GET without parameters = the function EXISTS and YOUR check used wrong argument names
  (exit 3, "аргументы проверки неверные"): fix the JSON body from the SQL signature — never ask the owner to re-run that SQL.
  `401 42501 permission denied` = exists but closed to guests (often intended: e.g. cloud_saves); `{"ok":false,"reason":"auth"}` =
  exists, needs a login; an old value (e.g. achievement_xp creator 500 instead of 250) = an OLD version is applied.
  Offline self-test of the answer parsing: `node scripts/sql-rest-test.cjs` (13 cases).
- Pick one check per file that only the NEWEST version passes (a new function, a new rule value).
- Write the result into docs/areas/sql-history.md (date, file, check → answer) and the board.

## Before handing SQL to the owner
- Check the live DB first: columns and functions you rely on exist (REST as above); the new file adds what it needs itself.
- Test in PGlite with stubs identical to the live DB (`scripts/*-sql-test.mjs`, needs DEPS_DIR with @electric-sql/pglite).
- Give the owner ONE ordered list (file names only, dependencies first), and the line "после запуска напиши «всё»".
