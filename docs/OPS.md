# Ops: error monitoring, CI, backups, 404 (T-016)

Owner-facing step-by-step for backups is `docs/BACKUPS.md` (Russian). This file is for agents.

## 1. Client error monitoring

**Goal**: know what breaks for real visitors, with no personal data, ~0 cost on a normal page.

| Piece | File | Notes |
|---|---|---|
| Single source | `api/_lib/errlog.js` | `errCore()` (sanitizing helpers), `errHook()` (stage 1), `errLog(K, S)` (stage 2), server-side `cleanItem/cleanMeta`. The same `errCore` runs in the browser and on the server (via `toString()`). |
| Stage 1 (inline, ~2 KB / 1.1 KB gz) | block between `<!-- errlog:begin -->` / `<!-- errlog:end -->` in `index.html`; `ERR_HEAD` in `api/_lib/page.js` for server pages | Two listeners only (`error` in capture phase, `unhandledrejection`). Does nothing until the first *own* error. Drops ads / Metrika / extensions / cross-origin "Script error." / ResizeObserver itself (ad-blocker users must never download stage 2). First record → after 0.3 s injects stage 2. |
| Stage 2 (~13 KB, generated) | `js/core/errlog.js?v=<sha1 of file>` | Sanitize, dedupe by (message, file, line), pick, batch, limits, `POST /api/diag`. **Generated** — never edit by hand. |
| Generator | `node scripts/make-errlog.mjs` (`--check` = verify) | Rewrites `js/core/errlog.js` and the index.html block. **Run it after every edit of `api/_lib/errlog.js`**; `errlog-test` and `ci-run` fail if stale. |
| Server route | `api/_lib/routes/diag.js` → `api/pages.js` (`diag`) + rewrite `/api/diag` in `vercel.json` | POST only. 16 KB cap, per-instance limits (240 req/min total, 30 req/10 min per hashed IP — hash is salted per instance, never stored; 30 because a mobile carrier shares one IP among hundreds of people), re-sanitizes everything, one RPC `ops_err_ingest` (service_role). Missing env / missing `ops.sql` / DB down / daily cap → quiet `{ok:0, stop:N}` and the instance stops calling the DB for a while. `DIAG_DISABLED=1` is the kill switch. Still 10 serverless functions (12 max). |
| Storage | `ops.sql` (own area, idempotent) | `ops_err` (one row per distinct error), `ops_err_day` (per day), `ops_quota` (caps per MSK day: 6000 reports, 20 000 items, 300 new keys → extra goes to one `overflow` row; browsers get `stop`/`rate`). 14-day retention, purged on the first report of each day (no cron). RLS on; only `service_role` writes (`ops_err_ingest` is revoked from anon/authenticated); only admins read (`ops_err_admin`, `ops_err_act`, select policy). |
| Admin view | profile → "👑 Панель администратора" → "🩺 Ошибки сайта": `js/features/ops-admin.js` (lazy-loaded by `openSiteErrors()` in `role-management.js`) | Top errors for 24 h / 7 d / 14 d, counts, visits, first/last seen, versions, routes, browsers, device, stack, "📋 Для ИИ" (copy a description), hide, clear. Everything from the DB is rendered with `textContent`. |

**Privacy rules (hard)**: no nick, id, e-mail, token, URL with query/hash, IP, user text. `clean()` masks URLs (own → path only, others → `<url>`), e-mail, JWT, uuid, long keys, long numbers/phones, JSON-error snippets, quoted text (only short identifier-like names survive).
It cannot detect free text: **never put player data into the text of `throw new Error(...)`, `Promise.reject(...)` or `d37Err(...)`**. Privacy policy (index.html modal + privacy.html) has one sentence about this.

**Limits per browser**: ≤ 8 distinct errors per visit, ≤ 4 sends per visit (≥ 30 s apart, `sendBeacon` on page hide), ≤ 40 items and ≤ 8 sends per day (`localStorage d37_el`), server `{stop}` (≤ 24 h) and `{rate}` are remembered there.

**Manual report**: `window.d37Err('where', err)` (same limits, type `x`) for caught errors worth knowing about.

**Debugging**: `ops_err_admin` shows nothing? Check `/api/diag` in the Vercel function logs (one warning per cause: no env, no `ops.sql`, DB error); check `localStorage.d37_el` (`off`, `rate`, counters) in the browser; run `node scripts/errlog-e2e.cjs` (real Chrome; the page is served at `https://dan4ik37.vercel.app/` by intercepting requests, no real network except jsDelivr).

Tests: `errlog-test.cjs` (240), `ops-sql-test.mjs` (73, PGlite), `ops-test.cjs` (86: repo hygiene/secret scan, wiring, every `scripts/*-test` is in the CI list or explicitly excluded, admin window with a tiny DOM, 404 via serve.py), `errlog-e2e.cjs` (23, real Chrome).

**After deploy** (coordinator, once): `curl -s -X POST https://dan4ik37.vercel.app/api/diag -H "content-type: text/plain" -d '{"v":"115","b":"chrome/129","o":"windows","d":"d","x":0,"e":[{"t":"x","m":"deploy check","f":"","l":0,"c":0,"r":"home","n":1,"s":""}]}'` → `{"ok":0,"stop":21600}` until the owner runs `ops.sql`, then `{"ok":1,"rate":1}` and one row «deploy check» in «🩺 Ошибки сайта» (hide it with «🙈 Скрыть»). Also open `/js/core/errlog.js` — it must match `?v=` in the page's inline block (`ERR_VER`).

## 2. CI (GitHub Actions)

`.github/workflows/tests.yml` → on push to `main`, PRs and manual runs: `windows-latest`, Node 24, installs `three@0.149.0`, `@dimforge/rapier3d-compat@0.19.3`, `@electric-sql/pglite@0.5.8` into `$RUNNER_TEMP` (outside the repo), runs `node scripts/ci-run.cjs` (~55 checks, 3 at a time, per-check timeout, failing output tail + GitHub annotations + job summary). `CI_STRICT=1`: a skipped required check (missing dependency) fails the run.

- **Advisory by default**: a push to `main` is deployed by Vercel immediately and does not wait for this workflow; a red cross on the commit = investigate (revert if needed). **Gate option (not enabled, owner's call)**: Vercel *Deployment Checks* can hold the production *promotion* until a GitHub Actions job passes — Project → Settings → Build and Deployment → Deployment Checks → Add Checks → GitHub → job `Site tests (Windows, Node 24)` (docs: vercel.com/docs/deployment-checks; the changelog of 9 Oct 2025 says "available for all projects connected to GitHub repositories", no Hobby exclusion is documented — not verified on this project; "Force Promote" bypasses a red check; the job name is the check's identity, so renaming the job breaks the gate). Trade-off: every release waits ~4–6 min and a flaky check holds it. We did not turn it on because checks were only just added; revisit after a few weeks of green runs.
- Vercel Hobby numbers that matter here (vercel.com/docs/limits, fair-use-guidelines, read 22.10.2026): runtime logs live **1 hour**; 1 000 000 function invocations / month; 100 deployments / day; 12 functions. **Hobby is "non-commercial personal use only" and lists AdSense ads and taking payments as commercial use** — the site has both; flagged to the coordinator (pause risk; Pro plan would be the fix).
- Run locally before pushing: `DEPS_DIR=<folder with node_modules of the three packages> node scripts/ci-run.cjs` (`--only a,b`, `--list`, `--e2e` adds the Chrome checks).
- New check → add one line to `TESTS` in `scripts/ci-run.cjs` (`needs`, `t`, `retry`, `serial`). Checks that need Chrome, clang/cargo or network stay out of CI (`--e2e` or manual).
- Why Windows: every check was written and passes on Windows (owner PC, agent PCs); not verified on Linux. If you want Linux too, add a matrix entry and fix what breaks.
- The repo is **public**: never put secrets in the workflow, never upload artifacts with data. No DB dumps in Actions, ever.

## 3. Backups

Local only: `scripts/backup-db.ps1` → `E:\backups\dan4ik37\YYYY-MM-DD.sql.gz` (pg_dump of schemas `public` + `auth`, plain SQL with grants, verified before it replaces anything, keeps the last N). Connection string comes from `backup.env` that the OWNER creates (gitignored: `backup.env`, `*.env`, `*.sql.gz`, `backups/`). Tested with a stub `pg_dump` (`scripts/backup-test.cjs`, 109 checks in Windows PowerShell 5.1 and PowerShell 7); never run against the live DB by an agent. Storage-bucket files, auth settings and Vercel env are NOT in the dump. Restore is documented in `docs/BACKUPS.md`; **rehearse it on a throw-away project once** (not done yet).

## 4. 404

`404.html` is served by Vercel with status 404 for every path that is not a file or a rewrite (no catch-all rewrite in `vercel.json`; `routes-test` guards this). Verified on production 22.10: junk paths, `/js/nope.js`, `/.env`, `/Chat` (capital letter; the page itself redirects to `/chat`) → 404 + our page; `/api/nope` → 404 (plain); SPA prefixes (`/play/<junk>`, `/profile/<junk>`) → 200 `index.html` by design (noindex via the router and robots.txt). `/404.html` itself answers 200 (noindex, harmless).
