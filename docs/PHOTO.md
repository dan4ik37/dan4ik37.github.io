# 🖼 Photo editor (T-017) — base choice, architecture, AI commands

Owner (21–22.10): «Фотошоп на сайте, стабильный, с ИИ-функциями и под управление ИИ»; «за основу взять бесплатную работу (ArtCraft)»;
«оптимизированный код, чтобы не вылетало и не лагало»; «работа между двумя функциями — фотошоп сразу отправить в другое».
Live: SEO page `/tools/photo` («Фоторедактор онлайн») → editor `/photo` (SPA section, loaded only when opened).

## 1. Base evaluation (22.10.2026, measured, nothing vendored)

Harness: headless Chrome 155 over DevTools, phone profile 412×915 DPR 2.6, CPU ×4, cache off, same local server for all;
memory = private bytes of all processes of that Chrome instance; soak = 10 min of random taps/drags/pinches/keys/sliders.
Scripts and raw numbers: `E:\claude-tmp\photo\tools\editors.cjs`, `E:\claude-tmp\photo\out\*.json`, screenshots `…\shots`.

| | PhotoCraft 0.12.0 (ArtCraft) | miniPaint 4.14.3 | TOAST UI Image Editor 3.15.3 | Filerobot 4.8.1 | **fabric.js 7.4.0 → chosen** |
|---|---|---|---|---|---|
| License | MIT OR Apache-2.0 (Rust crate tree not audited) | MIT, **but `dist/bundle.js` includes AlertifyJS 1.14.0 — GPL-3.0** (JS + CSS) | MIT (+ fabric 4.2 MIT, tui-* MIT) | MIT (top level; deps React, Konva, @scaleflex/ui — not audited) | MIT, zero dependencies |
| Maintained | very active, «early alpha» (daily releases) | yes (04.2026) | **archived** (2023) | yes (v5 beta) | yes (05.2026) |
| CDN at exact version | **no** — only a GitHub release zip (must self-host) | yes (jsDelivr `gh/…@v4.14.3`) | yes (npm) | **no** (jsDelivr `+esm` fails: `prop-types` export error) | yes (`npm/fabric@7.4.0`) |
| Download | **11.4 MB** (24 MB wasm) | 0.3 MB | 0.3 MB | — | ≈0.11 MB fabric (compressed) + our code 0.21 MB raw / 57 KB brotli |
| Ready, phone profile | 1.9 s | 1.3 s | 0.9 s | — | section ready **0.53 s** (median of 5, opened from the loaded site) |
| 12-MP photo, memory | **+411 MB** on open (≈700 MB total) | +34 MB open, +80 MB edits | +122 MB open | — | +271 MB open, +365 MB after edits (§5) |
| 10-min soak | 0 JS errors, memory up to **1.08 GB** | 0 errors | **13 uncaught TypeErrors** | — | 2298 actions, 0 errors, peak +485 MB (§5) |
| Phone UI | desktop layout squeezed: canvas ≈100 px wide, menus cut | own mobile layout, 16/26 targets < 40 px | header overlaps, panel clipped, 32/35 targets < 40 px | mobile-friendly (could not run) | ours: mobile-first, 40–52 px targets |
| Drivable by our commands/AI | no JS API on web (JSON control channel is desktop-only) | partly (`window.Layers`, module internals) | yes | no | fully (our layer) |
| Layers | yes (PSD-level) | yes | no | no | ours |

Decision: no candidate passes all bars (permissive license incl. bundled deps, CDN at exact version, phone UX, stability).
miniPaint fails the license rule (GPL-3.0 AlertifyJS inside its bundle), TOAST UI is archived and broken on phones, Filerobot
cannot be loaded from jsDelivr, PhotoCraft must be self-hosted and is desktop-only. So the base is **fabric.js 7.4.0 (MIT)** —
the engine TOAST UI Image Editor itself is built on: objects/layers, touch-ready transform handles, text editing, WebGL filters
with a 2D fallback, rendering, export. Ours on top: document/layers model, history with a memory budget, raster brush/eraser,
crop/resize/rotate, mobile UI, worker jobs, «d37 v1» commands, asset store, «Send to…».

**PhotoCraft — owner's decision later.** Legal risk: its «clean-room» claim is disputed (one developer + an LLM, no independent
audit; commentary points to trade dress/patents, not code copyright); «Photoshop» is Adobe's trademark. To host it we would have
to put the release into our repo (needs owner permission). Exact files (`photocraft-web-0.12.0.zip`, SHA-256
`c2451e19bfd448de780d01a2dfc233924223a0020370af432c58c0c5ee9ec21e`): `index.html` 2.3 KB, `photocraft-web-boot-35697f51dbdd0a9.js`
27 KB, `…_bg.wasm` 99 KB, `app/photocraft-web.js` 174 KB, `app/photocraft-web-46e89eeadedc7931.part-aa` 11.6 MB (gzipped wasm),
`app/parts.txt`, `LICENSE-MIT`, `LICENSE-APACHE` — ≈ 11.9 MB per version. Even then it is unusable at 412 px width today.

## 2. Architecture

- `js/apps/apps.js` — `D37Apps`: tiny loader in index.html; on `/photo` loads fabric (jsDelivr, exact version, cached by sw.js),
  `js/core/{tools,assets,ai-bridge}.js`, `js/apps/photo/*`, `css/photo.css`; leaving the section disposes everything.
- `js/apps/photo/photo-core.js` — `D37PhotoCore.create(host)`: document (w×h), layers = fabric objects (`raster` canvas or `text`),
  history (each step `{undo, redo, bytes, free}`; budget phone 64–96 MB / PC 320–600 MB, oldest dropped; a command reports how many steps it
  really stored — `ctx.steps`, 0 when nothing changed; typing into a just-created caption stays in its «Надпись» step), brush/eraser (dabs,
  undo = 256×256 tile copies on the GPU, no readbacks), crop (non-destructive), resize (worker resample), rotate/flip (lossless),
  merge/flatten, export. Adjustments: on screen a ≤1536 px (phone) / ≤4096 px (PC) proxy filtered by fabric's WebGL backend;
  on export/merge the **same fabric filter classes** run at full size in the worker (`importScripts(fabric)`, their 2D path mirrors
  the shader). Memory budget (`D37PhotoCmds.budget`): phone ≤ 4096 px side / ≤ 12.6 MP per layer (bigger photos are downscaled
  in the worker with a warning), total raster pixels capped. Worker is recycled after heavy jobs on phones; WebGL backend and
  canvases are released on close.
- `js/apps/photo/photo-worker.js` — decode+downscale, resample, encode PNG/JPEG/WebP, fabric filters at full size, histogram stats.
  Every job has an in-page fallback (no OffscreenCanvas / worker failure / offline).
- `js/apps/photo/photo-ui.js` — UI (phone: canvas + bottom sheet + tool strip; PC: tool rail + side panel). Sliders preview live and
  commit one command on release. Ads: only `D37AdPlaces.loading` while the editor loads and a `rail` column beside the editor on
  ≥1400 px desktops — never over the canvas.
- `js/apps/photo/photo-cmds.js` — pure: command schemas, colors, fonts (OFL, Cyrillic), blend modes, adjustments → fabric filter
  specs, budgets, aspect math, auto-enhance from histogram.

## 3. Tool pipeline (base of T-027) and «d37 v1»

- `js/core/tools.js` — `D37Tools.register(tool, { title, describe(), state(), undo(), commands: { name: { args: JSONSchema, run } } })`.
  `D37Tools.run(tool, cmd, args)` validates (types, ranges, enums, required, no extra fields, defaults) then runs — **buttons and AI
  use the same path**; every state-changing command is one undo step. Plan: `{"d37":1,"steps":[{"tool","cmd","args"}]}`, all steps
  validated before the first runs, `"$N.field"` passes results between steps, `undoSteps()` rolls a plan back.
- Photo commands: `info new open place crop resize rotate flip adjust filter auto text textEdit layerNew layer layerOrder layerDup
  layerDelete layerMerge flatten select fill draw export undo redo`.
- `js/core/assets.js` — `D37Assets`: IndexedDB «d37-assets», typed (image/video/audio/model/text/project), meta + blob stored apart,
  own cap (phone 300 MB / PC 1 GB) + browser quota; LRU eviction of unpinned; BroadcastChannel to other tabs. Local only.
- «📤 Send to»: download PNG/JPG/WebP; «Мои материалы»; **«Студия 3D»** — a picture plane (OBJ+MTL+PNG) compiled by the existing
  `D37E.models.compile/save` → appears in Studio 3D «🧩 Модели». Stubs (disabled, with reason): video editor (T-018), avatar decal,
  chat (needs moderation rules — kids). Other tools open an image in the editor via `/photo/<asset id>`.
- Project `.d37photo` (whole work with layers): 8-byte magic `D37PHOT1` + JSON length + JSON (layer props, adjustments, filter,
  text) + layer images (lossless PNG; an untouched photo keeps its original JPEG/WebP — smaller, no recompression). Download it or
  keep it in «Мои материалы»; open from the file picker / drag-and-drop / `open` command. A foreign file is fully validated
  (`D37PhotoCmds.readProject`: known fields only, numbers clamped, sizes and offsets checked, no `__proto__` effects) and is
  scaled down to the device budget if it came from a bigger device. **Draft:** leaving `/photo` with unsaved edits stores the work
  as one pinned draft project (replaced each time) and then closes the editor; the start card offers «↩ Продолжить». Coming back
  while it is still saving resumes the same editor; if saving fails (no space) the editor stays hidden so the work is not lost.
- `js/core/ai-bridge.js` — `D37AI`: «📋 copy task for AI» (rules + `D37Tools.describe` + goal; no keys, nothing sent), paste the
  answer back → extracted JSON → validated → run step by step with a progress list and «↶ undo all». Modes Ollama/WebLLM/cloud — later.

## 4. AI features

- Done: auto-enhance (levels/contrast/white balance/saturation from a histogram, worker) — no model needed.
- Done: «🪄 Убрать фон» (`removeBg` command) — on-device, only on click, nothing uploaded. Licenses verified 22.10.2026:
  model **U²-Netp** — Hugging Face `BritishWerewolf/U-2-Netp` pinned to commit `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8`, model card
  `license: apache-2.0`, upstream `xuebinqin/U-2-Net` LICENSE Apache-2.0 (4.6 MB `onnx/model.onnx`); runtime **ONNX Runtime Web
  1.30.0** — MIT (npm), bundled deps permissive (long Apache-2.0, protobufjs BSD-3, flatbuffers Apache-2.0, guid-typescript ISC,
  platform MIT); `ort.wasm.min.js` + `ort-wasm-simd-threaded.wasm` (13.6 MB raw) from jsDelivr. First use ≈ 8 MB / 9 s on PC
  (headless), single-thread WASM in the worker; undo restores the pixels. Quality: salient object (people, products, pets) —
  rough edges on busy backgrounds.
- Next candidates (same rules): MODNet (Apache-2.0, 6.6 MB, people), SlimSAM (Apache-2.0, click-to-select), BiRefNet-lite (MIT,
  115 MB — PC only). Do NOT use: briaai RMBG-1.4/2.0 (CC BY-NC), ISNet-ONNX (AGPL-3.0), `@imgly/background-removal` (AGPL).

## 5. Numbers (22.10.2026) and tests

Headless Chrome 155 on the owner's PC (RTX 5060 Ti), phone profile 412×915 DPR 2.6, CPU ×4 unless noted; memory = private bytes of
all processes of that Chrome **over the home page** (min of 3 after GC), page (renderer) and GPU process apart.

| Check | Result |
|---|---|
| First open of `/photo` from the loaded site, cache + SW off (`load`) | ready **0.53 s** median (0.39–0.82); **316 KB** transferred on the local server without compression (our 7 files 205 KB raw = 57 KB brotli; fabric.js from jsDelivr ≈110 KB) → ≈170 KB in production |
| 12-MP JPEG 4000×3000 (`big`) | open 1.05 s (decode in the worker, not downscaled); adjust preview 0.13 s; 5 brush strokes 0.58 s; full-size JPEG export with the same filters 4.7 s (3.0 MB). Memory: +271 MB after open, +348 MB adjust, **+365 MB peak** after strokes, +309 MB after export — page process below the home baseline, the rest is the GPU process. 24 MP → downscaled to 4096×2730 in the worker with a warning |
| 10-min random soak (`soak 10`: commands, taps, drags, pinches, sliders, menus) | final build (with drafts): **2139 actions, 0 errors, 0 crashes**, peak +408 MB (page +9 MB, GPU process 373 MB), undo history ≤ 91 MB (phone budget 96 MB); after closing (draft saved first) the page is 30 MB below the home baseline. Previous build: 2298 actions, 0 errors, peak +485 MB. First build, before the memory fixes: 1918 actions, up to 990 MB |
| 20 and 48 open/close (`leak [48]`, desktop profile, 1600×1200 photo + adjust each time) | page **−2.0 / −1.0 MB per cycle**, JS heap +0.6 / +0.7 MB total, DOM nodes flat, canvases 2 → 2, listeners 410 → 410; the GPU process wanders 440–830 MB, and after a «low memory» signal (`Memory.simulatePressureNotification`, what phones send) it returns to **488 MB = its level after warm-up** → Chrome's cache, not a leak |
| Touch UI on the phone profile (`ui`) | finger brush draws a line = one undo step; two-finger pinch zooms ×1.5+ and leaves no stroke; tap with «Текст» → caption, text from the field; crop 9:16 by buttons; layers panel; «↶» twice removes caption with its text |
| «🪄 Убрать фон» (`ai`, PC) | first use ≈ 9 s including ≈ 8 MB download (U²-Netp + ORT wasm), undo restores pixels |
| Project and draft (`proj`, phone profile) | save → open gives identical layers, pixels, text, adjustments, blend; undo returns the previous work; leave with edits → draft → «↩ Продолжить» restores all layers; leave and return at once → same editor; broken file → clear error, work intact |

Reproduce: `node scripts/photo-e2e.cjs smoke|ui|proj|ai|load|big|leak [N]|soak [min]|shot|all` (Chrome; temp files in
`E:\claude-tmp\photo`), `node scripts/photo-test.cjs` (166, no browser: D37Tools, D37Assets with a fake IndexedDB, D37AI,
D37PhotoCmds incl. the project format and hostile files, wiring of routes/sitemap/sw/index/games/age). Not done on real devices
(iPhone/Android) — only emulation.
