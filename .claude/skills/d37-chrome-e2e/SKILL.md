---
name: d37-chrome-e2e
description: Write or run a headless Chrome end-to-end / perf test of the dan4ik37 site (scripts/*-e2e.cjs, DevTools Protocol, no npm) on the phone profile (CPU x4, quality "mid") with downloads denied, temp files on drive E and the HEAVY.lock taken. Use for any game loop, leak (20x open/close), soak (10-15 min) or load-time measurement of the site.
---

# Chrome e2e on the site

Canonical harness: `scripts/terra-e2e.cjs` lines 1–75 (static server, Chrome spawn, CDP send/eval, error log, screenshots,
object counters). Copy its pattern; do not add npm packages.

## Must-haves
- Downloads denied (29.10 an «Экспорт GLB» click left 26 model.glb in the owner's C:\Users\…\Downloads): right after
  `Page.enable` send `Page.setDownloadBehavior {behavior:'deny'}`; also send `Browser.setDownloadBehavior {behavior:'deny'}` on
  the browser target (`/json/version` → webSocketDebuggerUrl). Never click export / download / save-file buttons. Before and after
  the run count files in the Downloads folder — the count must not change (report it).
- Temp on E: `--user-data-dir` = `fs.mkdtempSync(E:/claude-tmp/<task>/chrome-)`, spawn env `TMP`/`TEMP` = E:\claude-tmp (drive C
  is almost full); remove the profile dir at the end.
- Chrome flags: `--headless=new --remote-debugging-port=<random 9300–9700> --no-first-run --no-default-browser-check --mute-audio
  --ignore-gpu-blocklist --enable-precise-memory-info --js-flags=--expose-gc`.
- Phone profile (default): viewport 412 × 915 × DPR 2, `Emulation.setCPUThrottlingRate {rate: 4}`, quality "mid"; PC profile
  (`PC=1`): 1280 × 720, no throttle, "high". Chrome does NOT throttle workers: worker times are desktop numbers (× 4 to estimate).
- Lock: `node E:\d37-core\scripts\heavy-lock.mjs run --session site --job "<test> e2e" --min <M> -- node scripts/<test>-e2e.cjs <mode>`.
- Fresh JS: serve the worktree with `Cache-Control: no-cache` (the built-in browser caches old js; there use
  `fetch(url, {cache:'reload'})`). Service workers do not run in the built-in browser.

## What to measure and print (numbers or it is not accepted)
frame CPU avg / p95 / worst, FPS, long frames (> 50 ms), load + init ms; leak mode: 20× open/close → heap after GC, canvases,
workers, three.js renderers / geometries / materials, listeners — flat; soak 10–15 min: errors (Runtime.exceptionThrown +
console errors) = 0, heap per minute; flat-cost: minute-10 ms ≤ minute-1 ms + 5 %. Print a one-line summary and exit ≠ 0 on any
FAIL, NOT_RUN or missing summary. Screenshots (jpeg) only when they decide something, into E:\claude-tmp\<task>\shots.
