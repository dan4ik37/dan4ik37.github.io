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
| Download | **11.4 MB** (24 MB wasm) | 0.3 MB | 0.3 MB | — | 0.1 MB (+ our code ~0.3 MB raw, ~0.1 MB compressed) |
| Ready, phone profile | 1.9 s | 1.3 s | 0.9 s | — | section ready **0.68 s** (median of 5) |
| 12-MP photo, memory | **+411 MB** on open (≈700 MB total) | +34 MB open, +80 MB edits | +122 MB open | — | see §3 |
| 10-min soak | 0 JS errors, memory up to **1.08 GB** | 0 errors | **13 uncaught TypeErrors** | — | see §3 |
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
  history (each step `{undo, redo, bytes, free}`; budget phone 96–160 MB / PC 320–600 MB, oldest dropped), brush/eraser (dabs,
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

## 5. Numbers (phone profile, CPU ×4) and tests

See the T-017 report; reproduce: `node scripts/photo-e2e.cjs [smoke|load|big|leak|soak|shot] [min]`, `node scripts/photo-test.cjs`.
