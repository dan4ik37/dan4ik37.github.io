# HUD 2.0: few buttons, nothing on the face (T-123)

Owner, 29.10 (plays mostly on a PHONE): «интерфейс везде удобней сделай, меньше кнопок и красивее, чтобы пол-экрана не загромождал,
а инвентарь тоже чуть спрячь, чтобы не было на пол-лица; лечь, сесть, прыгнуть». About warnings: «с предупреждением в телефоне —
зачем это вообще». Earlier complaints we must not repeat: «не так размашисто кнопку Инвентарь… а то пол-экрана всё» (T-074),
«Зачем тут 2 меню?» (T-043).

This file is the spec for the build agents (A, B, C, see §11). The baseline numbers come from the T-123 audits
(E:\claude-tmp\t123\audit0, audit1, audit2; screenshots in E:\claude-tmp\t123\before\). CLAUDE.md "Game HUD" points here.

---

## 1. Principles

1. **The world comes first.** On a phone, at least 85–90 % of the screen shows the game, and nothing persistent sits on the
   character's head or upper body or on the screen centre (§2.3).
2. **Few always-on controls.** A game screen has at most **5** always-visible controls (§2.1). Everything else is
   *contextual* (it shows up only when it makes sense) or sits inside the **one** ☰ menu.
3. **One button per job, the same icon in every game.** One contextual action button (its icon names the verb), one jump, one
   pose button, one item tray, one ☰. No duplicates such as a second menu, a second 📱, 🔄 next to ⛶, or 🔊 next to ⚙️ → Звук.
4. **Panels are sheets, not walls.** Inventory, phone, crafting and "more actions" open as a side sheet (landscape) or a
   bottom sheet (portrait) that covers at most half of the game. The camera shifts so the character stays visible (§4.3).
5. **Quiet by default.** Debug and info panels are off. Each hint is shown once per device. Controls you are not touching fade
   (opacity only; they never disappear). There are no nag banners and no warnings on the phone (§5).
6. **Same gameplay on phone and PC.** HUD 2.0 changes only how actions are reached. Physics, damage, speeds and keyboard and
   gamepad bindings stay the same. New keys are only *added* (unbound or on a free key), and none are re-mapped.
7. **No layout thrash.** HUD code never writes to the DOM in a frame unless a value actually changed. Styles are written only
   on resize or a settings change. Shared site animations stop while a game is open (§9.12).
8. **One shared kit.** Every game uses the same widgets from js/engine/ui.js + js/core/touch-layout.js + css/hud2.css (§8).
   No game invents its own radial, tray or sheet.
9. **Every action is still reachable** within 1–2 taps or one gesture (§10.3). Nothing is lost; it only moves.
10. **Behind a flag.** Each game has a one-line rollback (`HUD2.<game> = 0`, §9.13). When the flag is off, the game shows
    exactly the old HUD.

## 2. Budgets (measured by scripts/hud2-e2e.cjs, §10)

### 2.1 Always-visible controls: N = 5
These are counted: every tappable element inside the game window that is visible (opacity > 0.3, not hidden) during normal
play with no panel open.

These are not counted: the floating joystick (invisible until touched); contextual controls while their context holds
(✋ near a door, 🏘️ inside the plot district, ⤓ while flying, 🛡 while a shield is held); a radial or a sheet while it is open.
At most **2** contextual controls may show at the same time.

| Situation | Allowed |
|---|---|
| Normal play | ≤ 5 |
| Combat zone or match | ≤ 5. Social buttons (📱, 💬) fold into ☰ while in combat. |
| The player switched on an advanced mode (Kubomir "cross" mode, Podzem ✛ precise) | ≤ 7 |
| Strategy unit dock (Raid) | The dock counts as 1 control |

### 2.2 HUD coverage (COVER method from scripts/touch-hud-e2e.cjs: union of painted HUD rects inside the game window, 2 px grid)
Measured in steady state: 8 s after start, nothing opened, standing still.

| Profile | Character games (Mir, Studio, terra, Kubomir, Podzem) and round games (io, Horde, Arena) | Raid (strategy) |
|---|---|---|
| Phone landscape 844×390 | cap **≤ 12 %**, goal ≤ 8 % | ≤ 22 % |
| Phone portrait 412×915 | cap **≤ 15 %**, goal ≤ 10 % | ≤ 25 % |
| PC 1280×720 | cap ≤ 6 % | ≤ 15 % |

- During the first 6 s (a hint or zone toast showing): cap + 4 pp.
- A sheet opened by the player: ≤ 50 % of the window (the phone sheet in portrait: ≤ 60 %). A radial is transient and is not
  measured, but it must never stay open without a finger on it (sticky mode closes after 3 s).
- No regression: a scene that is already under its goal must not grow by more than 1 pp.
- **Game window share of the screen.** Character games on a phone in portrait: ≥ 95 % (now 67 %, because the site nav, the
  stage bar, the world bar and the emoji bar take the rest; see §6.3). On PC the whole game window is above the fold at
  1280×720.

### 2.3 Keep-clear zone (the "face" rule)
- **Static zone:** x 30–70 %, y 22–70 % of the game window. No persistent HUD element may intersect it. Allowed there only
  briefly: a toast (≤ 2.2 s), a radial while it is held, and the crosshair in first person or while aiming.
- **Character zone (third person):** the projected head box (sphere r = 0.3 m around the capsule top − 0.25 m) is covered
  **0 %** by persistent HUD. The upper-body box (0.8 m × the upper 60 % of the capsule) is covered ≤ 5 %. In 2D games: the hero
  box. When a sheet is open, the camera view offset (§4.3) keeps the head box outside the sheet.
- The crosshair is never drawn on the player's own face. In third person it shows only while aiming, firing or using a tool
  (and for 1.5 s after), or with the over-the-shoulder option (§9.2 war).

### 2.4 Touch targets
- Hit area ≥ 44 px for everything (≥ 40 px only for chips in a dense row). The *visual* size may be smaller: the kit adds a
  transparent `::after` hit ring (`.e2-hit`). COVER counts only painted pixels, so the ring costs nothing.
- Kit sizes: primary button (jump, fire, brake) visual 56 px, hit 68 px. Normal button visual 46 px, hit 58 px. Chip
  visual 32–36 px tall, hit 44 px. ⚙️ "Размер кнопок" (touchSize 70–150 %) still scales all of them.

### 2.5 Performance (phone profile = CPU ×4, gfx "mid"; plus PC)
- Idle (standing, no input): style recalcs ≤ 3/s and layouts ≤ 2/s on every profile. Now: Mir PC 120–132/s, Raid 13–43/s,
  Kletochki 2/s at up to 35 ms each.
- No per-frame allocations in kit code (no closures, arrays or strings per frame). Values are quantized before they are
  compared: HP to 1 %, speed to 1 km/h, timers to 1 s, fuel to 1 %.
- 20 open/close cycles per game: the heap returns to ±3 %, and no listeners or timers are left behind (`dispose()` frees all).

---

## 3. The standard controls (every game with a walking character)

Bottom-right thumb cluster, mirrored for left-handed players:

| Control | Visual | Tap | Hold / gesture | PC / keyboard (unchanged) |
|---|---|---|---|---|
| **Jump** ⤒ | 56 px | jump (on a seat or lying: stand up) | — | Space / Pad0 |
| **Pose** (icon = current pose: ⬇ standing, 🪑 sitting, 🛌 lying, 🐛 crawling) | 46 px | toggles crouch (a latch). Tap while running = roll (a momentary 120 ms press, like C on the run). Tap while sitting or lying = stand up. | hold ≥ 250 ms or swipe out → **pose radial** (§3.1) | C hold = crouch; Q roll; **T** opens the same radial (new in games where T is free; see §9) |
| **Action** (one button; icon = verb) | 46 px | the verb (open, sit, talk, pick up, drive, get out…) | hold for hold-actions (a ring around the button) | E / Pad2 |

Combat adds 👊 (primary, 56 px). Vehicles swap the set (§9.2). Flying swaps pose for ⬇ вниз.

### 3.1 Pose radial
- It opens around the pose button, clamped so the whole ring fits inside the window and safe areas. Radius 92 px; items
  are 48 px visual / 52 px hit; at most 8 items; the 8th can be "➕ Ещё".
- **Slide-to-pick:** slide toward an item and release. The sector is the angle from the centre of the ring *as drawn* (it may be
  clamped to the edge or lifted over the finger), so sliding onto the visible icon picks it; nothing is picked until the finger
  has moved 28 px from where it pressed (T-136). Releasing in the dead zone (r < 28 px, the ✕) cancels. **Sticky mode:** if the
  finger lifts without moving, the ring stays open for 3 s for tap-picking (for players who do not know the gesture). A
  sector highlight and a label above the ring show the choice. `navigator.vibrate(8)` on each sector change, only if
  vibration is supported and the "shake" setting is on.
- Default items (games drop the ones they do not support):
  `⬇ Присесть · 🪑 Сесть · 🛌 Лечь · 🐛 Ползком (Kubomir) · 💃 · 👋 · 😂 · ➕ Ещё`. The 3 emote slots show the player's 3 most
  recent emotes (localStorage `d37_emo_recent`, per viewer; the defaults are 💃 👋 😂). "➕ Ещё" opens a small sheet with all 15
  `World3D.EMOTES` plus the zone acts (Mir cities: eat, drink, carry, hose, aim, heal, cook, fix, hold).
- Picking the pose you are already in = stand up.
- **PC:** T (or the game's free key) opens the radial at the screen centre. With pointer lock, the choice follows the summed
  `movementX/Y` (as in weapon wheels): do NOT unlock, because re-locking needs a new user gesture. Click or releasing T
  picks; Esc closes. Gamepad: no default binding; nothing changes.

### 3.2 Poses: what each one does (same code in all 3D games)
- **Sit** = `P.sitHere(seats)`: the nearest free non-bed seat within 4 m (the Mir logic from mir-zones.js `rt.sitHere`,
  moved into js/engine/player.js). Otherwise sit on the ground where you stand (only if grounded and `P.mode === 'move'`).
  Works **everywhere**: hub, park, cities, war zone, Studio, terra. Stand up as now (move, jump, crouch, interact; `tickSit`).
- **Lie** = `P.lieHere(beds)`: the nearest bed within 5 m means sleep (lie on the bed with eyes closed; Mir keeps its
  "😴 Спокойной ночи" toast and its bed logic). Otherwise lie on the ground (cosmetic; stand up with the same rules as sit).
- **Crouch** = the existing crouch. **Crawl** = Kubomir's prone pose (world3d state 12), unchanged.
- **Emotes** = the existing `World3D.EMOTES` and expressions.

### 3.3 Missing lying pose (A1 adds it; the B and C builds depend on it)
- js/games/world3d.js: new character state **13 "лежит"**: on the back, arms along the body or hands on the chest, slow
  breathing (chest scale ±2 %), eyes `closed` when `o.sleep`. It is chosen by `o.lie` (checked before `o.sit`), transition
  `XD[13] = .3`. Head and hands stay attached; no clipping into the ground at y = seat.y or ground.y + 0.12. Bump
  **`CHAR_VERSION` 4 → 5** (the comment says "5 — поза «лежит» (T-123)"). char2d sheets re-bake by themselves (version + kit
  fingerprint).
- js/engine/player.js: `P.sitOn(seat)` accepts `seat.lie`; `pose()` gains `lie: P.mode === 'sit' && !!P.seat?.lie` and
  `sleep: !!P.seat?.bed`. `P.sitHere(list)` / `P.lieHere(list)` as in §3.2.
- js/core/char2d.js: `ANIMS.lie = { name: 'Лежит', n: 2, lo: 1, dur: 3, loop: 1 }`, baked from state 13 (side view).
  `crouch` and `sit` already exist.
- Network: the Mir zx action `'lie'` is new. The remote decode at mir-zones.js:2128 now maps `'sleep'` and `'lie'` to
  `a.lie = true`. Today a remote sleeper is drawn *standing* on the bed (`a.sit = false; a.y = seat y`), which is a bug.
  Old clients ignore `'lie'` and draw the player standing, which is acceptable.

### 3.4 Action button (fixes the "no 🚪 in the car" bug)
- New `H.act(verb | null)`, where verb = `{ icon, label, hold? }`. It drives the one contextual button, **independent of the
  prompt text**. Today ui.js:62 hides the interact button whenever the prompt is empty, and mir-veh.js:211 sets `S.X.cur = null`,
  so on a phone there is no way out of a car.
- `E.verbIcon(text)` maps prompt words to icons from one table: Открыть 🚪 · Выйти 🚪 · Сесть 🪑 · Лечь 🛌 · Поговорить 💬 ·
  Взять ✋ · За руль 🚗 · Встать ⬆ · Купить 🛒 · Читать 📖. Anything else gets ✋.
- Touch: the target name shows as a small pill *next to the action button* (≤ 180 px, ellipsis), not in the screen centre.
  The hold ring is drawn around the button. PC: the "[E] Открыть" pill stays bottom-centre but moves to bottom 10 % (now
  22 %, which is on the character's legs; in a car it is on the car).

---

## 4. Items: tray, quick-select wheel, sheets

### 4.1 Item tray (replaces big hotbars and weapon bars)
- **Collapsed** (the default on phones): the selected item (48 px) plus 1 neighbour on each side (40 px, opacity .6). It sits at
  the game's anchor edge: bottom-centre for 3D games (bottom = safe area + 8 px, so it stays below the keep-clear zone),
  top-centre for Podzem. Width ≤ 160 px. An optional fixed extra slot sits at the end (Kubomir: left hand; Mir war: none).
- **Tap** expands the full row (Kubomir 9 + 🎒, Podzem 10 + 🎒, war 5). Cells are 40 px; if the window is too narrow, it wraps
  to 2 rows. **Swipe left/right** on the tray = previous/next item without expanding. It **auto-collapses** 3 s after the last
  tap. The expanded tray must not reach into the static keep-clear zone.
- **Hold** the tray = **quick-select wheel** (the same `E.radial`) with the hotbar items around the finger. This is the
  owner rule "inventory → radial, like a weapon wheel".
- 🎒 (the full inventory) is the last cell of the expanded tray; a swipe up on the tray opens it too. I/Tab are unchanged.
- PC: the tray is **expanded by default** (setting `hudTray: 'auto'`: phones collapsed, PC open). Digits and the mouse
  wheel are unchanged.
- The tray is an `avoid` rect for D37TouchLayout (both collapsed and expanded), so the editor never lets a button cover it.

### 4.2 Sheets (inventory, phone, crafting, chest, "➕ Ещё", score table)
- `H.sheet({ side: 'auto' })`: landscape = a side sheet on the right (on the left for left-handed players), width ≤ 50 %.
  Portrait = a bottom sheet, height ≤ 55 % (the 📱 phone ≤ 60 %).
- Content is **tabbed instead of stacked**, so it fits without scrolling on 844×390 (for example Kubomir: 🎒 Вещи / 🛠 Ремесло /
  💍 Кольца). Cells are 40–44 px.
- Close: ✕ (44 px hit), the same button that opened it, a swipe down (portrait) or right (landscape), Esc on PC.

### 4.3 Camera view offset (the character stays visible while a sheet is open)
- `H.inset()` returns the px that sheets cover `{ l, t, r, b }`, and an event fires when it changes.
- 3D games: `camera.setViewOffset(W, H, offX, offY, W, H)` shifts the projected centre into the free part of the window over
  200 ms. No camera movement, no gameplay change, one call per frame only while the tween runs. Clear it on close.
- 2D games: shift the camera target by the same amount.

---

## 5. Hints, banners, warnings, debug, toasts

- **Hints:** `H.hint(id, text)` shows a one-line pill at top-centre (under the top-corner row, never over buttons or the
  centre) **once per device** (the existing `d37_touch_seen` store), for ≤ 6 s or until the related action is used. After that,
  hints are listed only in ☰ → "💡 Подсказки" (no permanent 💡 button on screen). Button labels show only until the first
  press (the existing `.new` mechanism), at most 2 labels at a time.
- **No nag banners on the phone:** Podzem "🔄 Лёжа удобнее…" (.pz-rot) is removed when portrait immersive is on; otherwise it
  is shown once per device (now once per *session*), as a hint. The phone's guest banner "🔑 Войди…" (phone.js:440, large and
  red) becomes one muted 40 px row at the bottom of the phone home screen.
- **Hazards come without warnings** (owner rule; it also binds the T-120 spec): earthquake, tsunami, tornado, raid and fire
  have NO phone notifications, no pre-warning banners and no countdown. The player notices them from the world: sound,
  camera shake (within the ⚙️ "shake" setting), sky, water pulling back, the NPCs' reactions. At most a 2 s toast *after* the
  event starts ("🌊 Цунами!"). 📱 can keep a news app that the player reads *if they want to*, but it never pushes anything.
- **Zone banners** (Mir .mz-banner 3.6 s, 422×95 in war) become a top-centre pill (≤ 36 px tall, ≤ 60 % wide, 2.2 s).
- **Debug panels** (terra .tr-hud, any FPS or stats text): `H.debug(fn)` is hidden by default and toggled by **F3** or by ⚙️ →
  Интерфейс → "Отладка" (`hudDebug`, default off). `?debug=1` also works. `fn` runs only while the panel is visible.
- **Toasts:** they stay as they are (top 12 %, ≤ 2.2 s), with max-width 70 %.

---

## 6. Menus, top corner, shell, portrait

### 6.1 One ☰ per screen
- A game with its own menu (Mir, Kubomir, Podzem, Studio play, io games) receives the shell items through a new
  `D37Shell.items()` API (in games.js): 📣 Вызов (only games with a record), 📖 Правила, 🔊 Звук (quick toggle + volume
  slider), ⚙️ Настройки, 📱 Телефон, ⛶ / 🔄, ← Все игры. The game puts them into its own ☰, and the shell shows no buttons of
  its own while fullscreen is on.
- A game without its own menu (Horde, Arena, Raid, terra, card tables, all other shell games) gets the **shell ☰**:
  - portrait / PC: one row `← · title · ☰ · ⛶` (now 7 buttons);
  - compact landscape: one floating translucent ☰ (40 px, top-left; top-right for left-handed players) instead of the
    58 px left column (now 7 buttons, which also take 7 % of the width).
- The shell ☰ sheet appears over the site page, so it follows the light and dark tokens. In-game HUD stays a dark island.

### 6.2 Top corner (inside the game)
At most 3 always-on buttons: **☰** + up to 2 game-essential ones (Mir: 📱 and 💬). The online count, title and server go into
the ☰ header. Everything else is contextual or in ☰.

### 6.3 Portrait immersive (character games on a touch phone)
- Opening Mir, Kubomir, Podzem, Studio play or terra on a phone in portrait enters `D37Full.enter(stage, { api: false, auto: true })`
  (pseudo fullscreen: CSS only, safe areas via `viewport-fit=cover`; `html.gs-full` hides the site nav and bottom bar). This
  is new setting `autoPortrait` (default **on**, ⚙️ → Интерфейс), with flag `HUD2.portrait`. Rotating to landscape works as
  today (autoLand). Leaving the game exits.
- New class `html.gs-tall` (fullscreen, portrait, touch). Its CSS mirrors gs-compact: the world bar becomes an overlay row at
  the top, and the emoji bar is hidden (💬 opens it as a sheet).
- Round games (io, Horde, Arena, Raid) do **not** auto-enter in portrait. They keep the compact one-row shell bar, so the
  under-game `game_over` ad slot (#gamesAd, js/core/ad-places.js) is still seen at round end. Ads are never placed over
  gameplay.
- PC: `openGame` scrolls so the stage top sits right under the nav (now the "ИГРЫ" title stays, and the bottom 73–110 px of
  the game is below the fold at 1280×720).

---

## 7. Look

- Tokens (css/hud2.css, dark island; the same values in light theme):
  `--e2-bg: rgba(14,12,28,.42)` · `--e2-bg-on: rgba(124,58,237,.72)` · `--e2-line: rgba(255,255,255,.38)` (1.5 px) ·
  `--e2-text: #fff` · `--e2-shadow: 0 2px 10px rgba(0,0,0,.25)` · chips radius 12 px · buttons are circles · font Montserrat 800.
  `backdrop-filter: blur(6px)` only under `body.high`, because it is expensive on weak phones.
- These are the Kubomir `.kb-tbtn` values (the nicest current style). The engine `.e-btn` (50/62, .5 alpha) and the Podzem
  `.tb` (.62 alpha, labels inside) move to them. Icon = 0.44 × diameter; no permanent text inside buttons.
- **Idle fade:** 4 s after the last touch in the game window, the class `.e2-idle` on the HUD root sets `--e2-fade: .45`. Opacity =
  `calc(var(--gs-touch-a,1) * var(--e2-fade,1))`. Any pointerdown in the window restores it (one passive listener, one timer,
  `classList.toggle(name, on)` only when the state changes). Vitals that are full and unchanged for 5 s fade the same way;
  any change brings them back. Narrow ui.js's `transition: none!important` to `transition: opacity .3s` only (left/top stay
  without transition, so the layout editor still measures the new place). Setting `hudFade` (default on).
- **Safe areas:** every edge anchor uses `max(Npx, env(safe-area-inset-*))`.
- **Left-handed** (`html.gs-lefty`): the thumb cluster, the top corner, side sheets and the shell ☰ mirror; tray anchors on the
  bottom/top centre stay where they are.
- **Icons (one table for all games):** ⤒ jump · ⬇ crouch/pose · 🪑 sit · 🛌 lie · 🐛 crawl · ✋ action (or a verb from §3.4) ·
  ☰ menu · 📱 phone · 💬 chat · 🎒 inventory · 👊 attack · 🗺️ map · ⚙️ settings · ⛶ fullscreen. Avoid emoji newer than Emoji 12
  (🫳 and similar show as boxes on older Android phones).

---

## 8. Shared kit API (A1 builds it first)

### js/engine/ui.js
`E.ui(el, C, { v2: true, game })` is opt-in. Without `v2`, the behaviour is byte-for-byte the old one. The widgets are also
exported standalone (`D37E.radial`, `D37E.tray`, `D37E.sheet`, `D37E.chip`, `D37E.hint`, `D37E.fade`) for games that do not use
`E.ui` (Kubomir, Podzem, io and others). A1 adds `js/engine/ui.js` to their `scripts` lists in games.js.

```
H.buttons(list, o)            // as now; item.kind: 'jump'|'pose'|'act'|'btn', item.ctx: true = contextual (H.show)
H.act(verb|null)              // §3.4 — the one action button, independent of H.prompt
H.pose({ items, current, onPick })   // §3.1 — tap = crouch latch / roll on the run / stand up; hold = radial
H.tray(o) → T                 // §4.1 — o: { slots(), sel, onSel(i), anchor:'bottom'|'top', peek:1, extra, more:{icon,on}, ms:3000 }
                              //        T.set(i) · T.update(i) · T.open() · T.close() · T.rect() · T.dispose()
H.sheet(o) → S                // §4.2 — o: { side:'auto', title, body:el, tabs, onClose }; S.close()
H.inset()                     // §4.3 — { l,t,r,b } + 'e2:inset' event on el
H.chip(id, { icon, text, at:'tl'|'tc'|'tr'|'bl' }) → .set(text)   // writes only when the text changed
H.hint(id, text, { ms })      // §5 — once per device
H.debug(fn, { every:250 })    // §5 — hidden; F3 / hudDebug
H.toast(text, ok)             // as now
D37E.radial(host, { items:[{id,icon,label,on}], at:{x,y}, sticky:true, onPick, onCancel })   // the shared wheel
D37E.verbIcon(text)           // §3.4 table
```
Rules: the DOM is built once per H (the radial and sheet roots are created hidden and reused); `contain: layout paint` on the
tray, radial and sheet roots; pointermove computes the sector with `Math.atan2` and writes only when the index changes; all
timers and listeners are freed in `H.dispose()`.

### js/core/touch-layout.js
- `attach({ alias: { newId: 'oldId' } })`: saved custom positions migrate (Mir/Studio `crouch` → `pose`; Kubomir `sneak` →
  `pose`; dropped ids are forgotten). Pass a stable `layout` id (`'e3d-main'`, `'e3d-war'`), because today's hash of the
  button ids would change and reset the players' layouts.
- `avoid()` accepts the tray's collapsed and expanded rects, the top-corner row and an open sheet.
- `hintOnce(game, id)`, built on `seen/markSeen`. The editor (⚙️ → Управление → 🎮 Настроить кнопки) keeps working for
  jump, pose, action and the game buttons. The tray is not movable in v1 (it is an avoid zone).

### css/hud2.css (new, linked in index.html after premium.css)
Only `.e2-*` classes and the §7 tokens: `.e2-btn`, `.e2-hit`, `.e2-radial`, `.e2-tray`, `.e2-sheet`, `.e2-chip`,
`.e2-hint`, `.e2-idle`. Games use these classes; game-specific overrides stay in each game's own CSS.

### js/core/settings.js (new keys)
`hudFade` (bool, default true) · `hudTray` ('auto'|'open'|'closed', default 'auto') · `hudDebug` (bool, default false) ·
`autoPortrait` (bool, default true). They go in the Интерфейс tab, plus a "Сбросить подсказки" row.

### js/core/config.js (rollback flags, one object)
```
// HUD 2.0 (T-123, docs/HUD_V2.md): 0 — старый интерфейс игры
const HUD2 = { kit: 1, shell: 1, portrait: 1, chrome: 1, mir: 1, studio: 1, terra: 1, kubomir: 1, podzem: 1, io: 1, horde: 1, arena: 1, raid: 1 };
```
Games read `typeof HUD2 !== 'undefined' && HUD2.<id>`.

### js/engine/player.js, js/games/world3d.js, js/core/char2d.js
These are the pose helpers and the lying pose from §3.2–3.3.

---

## 9. Per-game mapping

Baseline (audits) → target. P = 412×915, L = 844×390, PC = 1280×720. The numbers are HUD coverage of the game window.

### 9.1 Shell (#gamesStage, applies to all games) — build A
| Now | HUD 2.0 |
|---|---|
| Portrait bar: ← 📣 📖 🔊 ⚙️ 🔄 ⛶ (7) + the site nav with its own ☰ above it | Round games: `← · title · ☰ · ⛶`. Character games: immersive, no bar (the items are in the game's ☰) |
| Landscape: 58 px left column with 7 buttons; terra's canvas covers it (bug) | One floating ☰, or none for games with their own menu |
| 📣 Вызов in games without a record (Mir) | Shown only when the game has a record |
| 🔊 duplicates ⚙️ → Звук; 🔄 duplicates ⛶ | Both are inside ☰; on phones ⛶ = rotate + fullscreen |
| PC: game bottom below the fold | Scroll the stage top under the nav |
Files: index.html:2032-2047, js/features/games.js (openGame, D37Shell, `immersive` flag in GAMES, ui.js in scripts lists),
css/premium.css 1653-1656 and 3696-3771, js/core/fullscreen.js (gs-tall, autoPortrait), js/games/gamekit.js:98.

### 9.2 Mir Denchika 3D — build A
**Hub / cities** (P 3.6–4.5 %, but the game window is only 67 % of the screen; L 5.8–7.5 %; PC 0.3–1.1 %)
| Now | HUD 2.0 |
|---|---|
| Portrait: site nav + stage bar + 2-row .wld-top + emoji bar (15 emoji + input) = 33 % of the screen | Immersive; the top-right row is ☰ · 📱 · 💬; the emoji bar lives in the 💬 sheet; the emoji are also in the pose radial |
| Landscape top: 👥 pill, 🗺️, 🏘️, 📱, 💬, ☰ (+🎬 in cities, +🏯 in war) = up to 7 | ☰ · 📱 · 💬. 🗺️ → ☰ "Карта" + the 📱 app + M key. 🏘️ is contextual (inside the plot district) and also in ☰. 👥 count → the ☰ header |
| Bottom-right: ⬇ присесть, ✋ (only with a prompt), ⤒ | pose · action (verb) · jump |
| 🎬 Действия panel (460×202) over the body (100 % in landscape); the ⬇/⤒ buttons drawn over its last row in portrait; only in cities | **Removed.** Its sit, sleep and dance go to the pose radial; the zone acts go to "➕ Ещё" (sheet). T opens the radial (today T toggles 🎬) |
| Sit only near seats or via 🎬; no ground sit or lie outside cities | `P.sitHere` / `P.lieHere` everywhere (§3.2) |
| Zone banner 3.6 s ("Лобби" 179×56) | Top pill, 2.2 s |
| 💵 wallet + 🏦 71×32 (under 40 px) | One chip "💵 120 ›", 44 px hit, tap = bank; it fades when idle |
| Per-frame `hidden = true` writes in drawTags/drawFolk (mir.js 1633, 1884-1887) | Cache the state per tag; write only when it changes |
| Coverage | L ≤ 6 %, P ≤ 8 %, game window ≥ 95 % of the portrait screen |

**📱 phone** (portrait: 100 % of the screen; landscape: 340×378, its ✕ 28×28 sits on ☰)
In game, the phone docks as a sheet: portrait bottom ≤ 60 % with the camera view offset; landscape right side ≤ 45 % that starts
*below* the top-corner row. ✕ gets a 44 px hit. The guest banner becomes one row (§5). Files: js/features/phone.js, css/phone.css.

**Vehicles** (P 7.5 %, L 10.2 %, PC 3.0 %; the pill and the PC prompt sit on the car)
- Car driver: 🅿️ brake (primary, replaces jump) · 🚀 · 📯 · action **🚪 Выйти via `H.act`** (this fixes the touch bug). Heli/plane:
  ⬆ (primary) · ⬇ · 🚀 · 🚪. Passenger: 🚪 · 🧑‍✈️.
- The speed pill becomes a top-centre chip that writes only when km/h or fuel % changes (now it rewrites every 150 ms). The PC
  prompt moves to bottom 10 %.
- Not HUD, but report it: the driver's hair pokes through the sedan roof.

**War zone** (P 16.3 % → 24.4 % with the banner; L 16.8 % → 28.5 %; the crosshair is on the face on all profiles)
| Now | HUD 2.0 |
|---|---|
| Weapon bar 5×44 at bottom:110 (under the feet) + 🔄 оружие | Tray at bottom-centre (the active weapon + its neighbours); tap = 5 slots, swipe = cycle, hold = weapon wheel. 🔄 removed |
| HP bar 260×12 under the weapon bar | Slim chip top-left "❤ 100" + a 110×6 bar |
| Score panel 217×64 | Top-centre chip "⏱ 4:57 · 0/0"; tap = table sheet |
| Crosshair at the screen centre = the face | Only while 👊 is held or fired + 1.5 s (and in first person). Option `HUD2.warShoulder` (default 0): over-the-shoulder framing via the view offset, aim unchanged |
| 5 buttons in 2 rows; portrait jump moves to bottom-centre | pose · 👊 (primary) · jump + action (contextual); the same positions as everywhere else |
| 📱, 💬, 🏯 in the top row | ☰ (📱 and 💬 inside it while in combat) + 🏯 (contextual) |
| Coverage | L ≤ 10 %, P ≤ 12 %, PC ≤ 4 %; the head box is 0 % covered |
Files: js/games/mir.js, mir-zones.js, mir-city.js, mir-base.js, mir-war.js, mir-veh.js, css/mir-zones.css,
scripts/war-hud-e2e.cjs (update its selectors).

### 9.3 Studio 3D play mode — build A
| Now | HUD 2.0 |
|---|---|
| The full editor toolbar (53 px, opaque) stays in play: ← 📱 ⚙️ ⛶ ■ Стоп | Floating ■ Стоп (top-left) + ☰ (top-right: 📱, ⚙️, ⛶, ← editor). The toolbar comes back on stop |
| PC: the 200 px "Вывод / Скрипт" dock stays open in play | Collapsed during play (▴ to open); script output goes to toasts plus a 💬 badge |
| Touch buttons drawn as grey squares (the `.s3 button` rule at premium.css:3293 leaks onto `.e-btn`) | Fix: `.s3 button:not(.e-btn):not([class*="e2-"])` |
| Health bar always shown | Only in worlds with damage or PVP, or after the first hit |
| No sit, lie or emotes; benches are decoration only | Pose radial. Seats = parts of the seat kinds (chair, bench, sofa, stool, bed) from the part library; otherwise the ground. Sync sit/lie/emote in multiplayer play (studio3d-play.js) with the same codes as Mir |
| pose / action / jump (+👊 PVP) | Same; ≤ 4 always-on |
Files: js/games/studio3d.js (startPlay 1294-1330), studio3d-play.js, css/studio3d-x.css; premium.css:3293 (A owns it).

### 9.4 Terra — build A
| Now | HUD 2.0 |
|---|---|
| BUG: the canvas covers the whole landscape shell column (wrap class `wld-wrap tr-wrap` picks up the Mir rules) | Own class `tr-wrap` + declare `gm-own-menu`, or give it the shell ☰ |
| The dev stats panel .tr-hud (9–12 % of the view) is always on | `H.debug` (F3 / ⚙️) |
| ✈ Полёт / ⛏ Копать / ❓ text pills | One round **tool** button: its icon shows the tool; tap = use (E); hold = radial 🚶 Ходить / ⛏ Копать / 🧱 Насыпать / ✈ Полёт. ❓ → ☰ "Правила" |
| Crosshair on the face in third person | Only while ⛏ or 🧱 is active, or in first person |
| Help box covers ⬇ for 9 s in portrait | `H.hint` once, top-centre |
| Q switches the tool AND rolls (engine roll is also on Q) | terra consumes Q in a capture listener before the engine sees it; the bindings are unchanged |
| No sit, lie or emotes | Pose radial (ground only) |
| Coverage L 14.8–17.4 %, P 15.3 % | L ≤ 7 %, P ≤ 9 % |
Files: js/games/terra-demo.js, scripts/terra-e2e.cjs.

### 9.5 Kubomir — build B
| Now | HUD 2.0 |
|---|---|
| Portrait: 3 header rows, 2 menus (site ☰ + red "☰ Меню" 73×40), the game window is 67 % of the screen | Immersive (A sets the flag); only ☰ 40×40 top-right; the title goes into the ☰ header |
| 🎒 вещи, ⬇ красться, 🐛 ползком, 🔄 руки, ⤒ прыжок + labels until the first press | **pose** (tap = sneak; hold = radial: Красться, 🐛 Ползком, 🪑 Сесть, 🛌 Лечь, emotes only if co-op syncs them) · **jump** · **tray** · ☰ = 4. 🔄 removed (tapping the left-hand slot already swaps). 🎒 → the tray's end cell + swipe up. ⤓ (flying) and 🛡 (held) stay contextual. Cross mode keeps ⛏/🧱 (advanced, ≤ 7) |
| Hotbar 9×32–34 px (under 40 px) + left-hand slot 32–34 | Tray: collapsed = selected 48 + neighbours 40 + left hand 40; expanded 9×40 + 🎒; hold = wheel. PC: expanded (as now, 1–9 and wheel unchanged) |
| Hearts and food 11 px | 12–13 px icons, stacked above the tray; fade when full and unchanged |
| Inventory 80.6 % of the portrait window; landscape and PC scroll | Sheet with tabs 🎒 Вещи / 🛠 Ремесло / 💍 Кольца, 40 px cells, no scroll at 844×390; chests and the crafting table use the same sheet |
| `Q.sit = false` hard-coded (kubomir.js:1974); "lie" only as prone 🐛; the лежанка sleep has no pose | Sit on the ground, or on a stair or slab block in front of you (the seat height comes from the block). Lie = world3d state 13; on a лежанка at night = sleep with that pose (kubomir-world.js:32-60 logic unchanged). Crawl unchanged (Z, double sneak, double Ⓑ) |
| F1 hide HUD and F5 camera are keyboard-only | ☰ → "Спрятать интерфейс" (tap the top-right corner to bring it back) and ☰ → "Камера" |
| Tip line 360×28 on every visit | `hintOnce` per device |
| PC: hotbar below the fold | Covered by the shell scroll fix (A); B verifies |
| PC key for the pose radial: T is chat in Kubomir | Add the action `pose` on **G** (free in kubomir-input.js), no pad default |
| Coverage L 10.8–14.1 %, P 13.8 %, PC 14.2 % | L ≤ 8 %, P ≤ 10 %, PC ≤ 6 % |
Files: js/games/kubomir.js (65-70, 910-1013, 1974, 2031-2062, 2132-2226, 2496), kubomir-input.js, kubomir-ui.js, kubomir-world.js,
css/kubomir.css.

### 9.6 Podzem — build C
| Now | HUD 2.0 |
|---|---|
| Portrait: site chrome 131 px; 2×5 hotbar grid at the top; rotate banner; joystick hint 120×120 → 28.6 % | Immersive (A); collapsed tray top-centre; no rotate banner; joystick hint = a 60 px ghost, once |
| Landscape: 58 px shell rail + the game's own ☰ (2 menus) | Podzem already has `gm-own-menu`; it takes `D37Shell.items()` into its ☰; no rail |
| Vitals 158×43 with numbers; goal button 148×44; clock line | Slim chip top-left (❤ and ★ bars 90×6, numbers on tap or change); 🎯 chip "1/10" (tap = full goal text); the clock goes into the ☰ header (landscape: small text in the vitals chip) |
| ⤒ 58, ⛏ 54, ✋ 46, 🎒 46, ✛ 42 (+🪝, ✓) with 8 px labels inside | jump · ⛏ use (hold = radial ⛏ Копать / 🧱 Ставить / ✛ Точно) · pose · tray · ☰ = 5. ✋ only near a door, chest or NPC (`.near` already knows). 🎒 → the tray. ✛ also in ☰. Labels only until the first press |
| Inventory 88–94 % of the window | Sheet ≤ 50 % / ≤ 55 %, 44 px cells, tabs; the camera target shifts so the hero stays visible |
| No crouch, sit or lie (char2d has crouch and sit; lie comes from A1) | Pose radial: Присесть, Сесть, Лечь, emotes. **Cosmetic** (no hitbox change); stand up on move. A bed: "Лечь" = lie anim (respawn as now) |
| .pz-status and .pz-clock rewritten every second | Write only on change (clock with minute resolution) |
| PC key | Add `pose` on G (B, H and P are taken; T is free but keep one key for both 2D and Kubomir) |
| Coverage L 22.4 %, P 28.6 %, PC 10.7 % | L ≤ 10 %, P ≤ 12 %, PC ≤ 6 % |
Files: js/games/podzem.js (1143 anim states, 1604 bed, 3079), podzem-ui.js (220-231, 320-402, 495-520, 881-889, 1077-1181).

### 9.7 io games: Kletochki, Chervyachki, Evo path — build C
| Now | HUD 2.0 |
|---|---|
| Leaderboard top-10 always open (9–10 % of the landscape view) | Top-3 + your own place; tap = top-10, auto-collapse 5 s. Evo single-player: your own line only |
| 😀 🔗 ☰ + shell column (10 small buttons in landscape) | 😀 · ☰ (🔗 "Позвать друга" and the shell items inside ☰; no shell column) |
| Action buttons 68/80 px (Chervyachki boost 80) | Visual 56/64, hit kept at 68/80 (`.e2-hit`) |
| Canvas minimap bottom-left (under the steering thumb), up to 96 px | ≤ 72 px, top-right under the collapsed leaderboard |
| Evo `.kp-hl` path strip on an extra line | Merged into the score line |
| Layouts up to 35 ms each; the leaderboard key string is built every frame | `contain: layout paint` on .io-hud / .io-lb; compare numbers, not strings |
| Coverage L 15–17 %, P 10–13 % | L ≤ 9 %, P ≤ 9 % |
Files: js/games/iokit.js (699-911), kletochki.js (1634-1710), chervyachki.js (1296-1348), kletochki-path.js (399, 744).

### 9.8 Horde — build C
⏸ 38×38 → `.e2-hit` (44 px). The caption `.hd-note` becomes a one-time hint (hidden after the first move). `trail = trail.filter(…)`
per tick → in-place compaction. The canvas HUD stays (it is the lightest one). Files: js/games/horde.js.

### 9.9 Arena — build C
The score row `.ar-top` becomes a chip over the top of the field (it gives back its height, so the field scales up in landscape;
the aspect ratio is unchanged). The controls caption becomes a one-time hint. In draw(): no querySelector, and the `ready`
toggle and `--sp` are written only on change (--sp quantized to 2 %). Files: js/games/arena.js.

### 9.10 Raid — build C
The full-width gradient bar `.rd-barB` becomes a compact unit dock the width of the units (a translucent pill). 🏠 Домой → the
shell ☰. The title pill fades after 3 s. The tutorial tip moves top-left (`H.hint`), off the base centre. `hud()` writes
textContent only on change and stops calling `B.result()` per frame (13–43 layouts/s → ≤ 3/s). Coverage P 34.2 % → ≤ 25 %,
L 36.8 % → ≤ 22 %. Files: js/games/raid.js.

### 9.11 Cross-game: emote favourites, verbs, keys
They live in the kit (§3, §8). Games only pass their item lists.

### 9.12 Site chrome under a game (`body.game-on`) — build A, flag `HUD2.chrome`
`.particle` animations (index.html:835) → `animation-play-state: paused` (or `display: none`) under `body.game-on`.
`.d37-secret` twinkle (premium.css:2101-2104) and `.donation-alert-icon` bounce (index.html:1109) are off under game-on.
js/core/celebrate.js:282/429-431 → `classList.toggle('cel-ban-on', on)` only when it changes (now `remove` every second).

### 9.13 Rollback (one line each, js/core/config.js `HUD2`)
`shell` · `portrait` · `chrome` · `mir` · `studio` · `terra` · `kubomir` · `podzem` · `io` · `horde` · `arena` · `raid` →
`0` = the old HUD for that part. The kit itself (`kit: 0`) is a no-op only when every game flag is 0. `HUD2.warShoulder`
defaults to 0.

---

## 10. Test plan

### 10.1 Runner (A1): scripts/hud2-e2e.cjs + scripts/hud2-cases/<game>.cjs
- Headless Chrome via CDP (like touch-hud-e2e). Temp files go under E:\claude-tmp\t123\. Profiles: P 412×915 and L 844×390
  (touch, CPU ×4, gfx mid, perf high, throttling switched on after load), PC 1280×720.
- Per scene, it reports: COVER %, game-window share of the screen, always-visible control count (§2.1), keep-clear hits (§2.3:
  static zone + projected head/body box, or the 2D hero box), hit size (elementFromPoint at the centre and ±(hit/2 − 2) px →
  the same control), idle LayoutCount / RecalcStyleCount per second over 5 s (Performance.getMetrics), and console errors. It
  saves a screenshot to E:\claude-tmp\t123\after\<game>-<prof>-<scene>.jpg. Exit code 1 when a cap is broken.
- A case module exports `{ open(page, prof), scenes: { name: async page => … }, reach: [...] }`. Ownership: A — world,
  studio, terra, shell; B — kubomir; C — podzem, io, horde, arena, raid.
- The baseline comes from the T-123 audits. Re-run E:\claude-tmp\t123\audit0\audit.cjs (Mir/Studio), audit1\audit.cjs
  (Kubomir/Podzem) and audit2 (others) for the "before" numbers where they are missing (some audit1/2 shots were deleted).

### 10.2 Scenes (minimum)
Mir: hub, city, pose radial open, ➕ Ещё, 📱, vehicle, war (first 3 s + steady). Studio: play (+ PVP). Terra: walk, fly,
tool radial. Kubomir: HUD 8 s, third person, tray expanded, wheel, inventory sheet, cross mode. Podzem: HUD, tray, inventory.
io: play. Horde, Arena, Raid: play.

### 10.3 Reachability (each must pass on P and L; taps or gestures counted from normal play)
| Action | ≤ | Path |
|---|---|---|
| Jump, crouch, interact verb, fire, exit vehicle | 1 | a button |
| Sit, lie, emote (3 recent) | 1 gesture | hold pose → slide (or sticky tap) |
| Any emote or zone act | 2 | radial → ➕ Ещё → item |
| Select a hotbar item | 1–2 | swipe the tray / hold → wheel / tap the tray → cell |
| Full inventory | 2 | tap the tray → 🎒 (or swipe up = 1) |
| Phone, chat (Mir) | 1 | 📱 / 💬 (in war: ☰ → 2) |
| Map, plot, settings, rules, sound, fullscreen, back to games, invite | 2 | ☰ → item |
| Bank (Mir city) | 1 | 💵 chip |
| Close any sheet | 1 | ✕ / swipe / the same button |
| Debug panel | — | F3 / ⚙️ (PC and settings only) |

### 10.4 Must stay green
- Keyboard and gamepad: `ACTIONS` defaults in js/engine/controls.js and kubomir-input.js only gain entries (a diff check in
  the runner). The existing e2e suites pass unchanged except for selector updates: scripts/war-hud-e2e.cjs, menu-e2e.cjs,
  terra-e2e.cjs, touch-hud-e2e.cjs (TH_MODE=full: every button tappable), and the Kubomir and Podzem e2e scripts.
- D37TouchLayout editor: open, move pose and jump, save, reload → same place; the old layout migrated through `alias`;
  left-handed mirror.
- Leaks: 20 open/close per game (heap ±3 %, listener count stable). Per-frame garbage: a 30 s sampling heap profile idle
  in Mir and Kubomir shows no allocations from ui.js.
- Light and dark: the shell ☰ sheet and 📱 in both themes (one shot each); the game HUD is a dark island.
- `node scripts/xss-test.cjs` (item names and verbs only via textContent), `node scripts/ci-run.cjs` once at the end, and
  `python -X utf8 scripts/merge-check.py` after each merge. Determinism tests are unaffected (HUD only).

### 10.5 Owner check on the phone (the coordinator translates it)
Open Mir in portrait (the whole screen is the game) → hold ⬇ → sit, lie, wave → get into a car and out with 🚪 → Kubomir:
swipe the tray, hold for the wheel, open 🎒 (half the screen, the face visible) → Podzem: no "Лёжа удобнее" banner.

---

## 11. Build split (disjoint files)

**Order.** A1 (the kit) merges first, because B and C use its widgets and the lying pose. Until then, B and C do the items
that do not need it: per-frame writes, removed duplicates, inventory tabs and layout. After A1 lands they rebase on main.
After A1, A2, B and C run in parallel. GAMES_VER (js/features/games.js) is bumped only by A or by the coordinator at merge
(resolve only the version line). Do not touch: js/apps/*, css/ai3d.css, js/ui/router.js, sw.js (the AI3D agent works there).

| Build | Owns (only these files) |
|---|---|
| **A1: kit** | js/engine/ui.js, js/core/touch-layout.js, css/hud2.css (new) + its `<link>` in index.html, js/core/config.js (`HUD2`), js/core/settings.js (keys + Интерфейс rows), js/engine/player.js (sitHere/lieHere/lie), js/games/world3d.js (state 13, CHAR_VERSION 5), js/core/char2d.js (lie), js/features/games.js (D37Shell.items, `immersive`, ui.js in scripts lists, GAMES_VER), scripts/hud2-e2e.cjs (new) |
| **A2: shell, Mir, Studio, terra, chrome** | index.html, css/premium.css, js/core/fullscreen.js, js/core/celebrate.js, js/features/games.js, js/games/gamekit.js, js/features/phone.js, css/phone.css, js/engine/interact.js, js/games/mir.js, mir-zones.js, mir-city.js, mir-base.js, mir-war.js, mir-veh.js, css/mir-zones.css, js/games/studio3d.js, studio3d-play.js, css/studio3d-x.css, js/games/terra-demo.js, scripts/hud2-cases/{shell,world,studio,terra}.cjs, scripts/war-hud-e2e.cjs, menu-e2e.cjs, terra-e2e.cjs, touch-hud-e2e.cjs |
| **B: Kubomir** | js/games/kubomir.js, kubomir-input.js, kubomir-ui.js, kubomir-world.js, css/kubomir.css, scripts/hud2-cases/kubomir.cjs, Kubomir e2e scripts |
| **C: Podzem, io, Horde, Arena, Raid** | js/games/podzem.js, podzem-ui.js, iokit.js, kletochki.js, chervyachki.js, kletochki-path.js, evo.js, horde.js, arena.js, raid.js, scripts/hud2-cases/{podzem,io,horde,arena,raid}.cjs, their e2e scripts |
B and C never edit premium.css, hud2.css, ui.js or games.js. If a shared rule is missing, ask A (through the coordinator) or
use a game-scoped rule in the game's own CSS block (iokit, podzem-ui and raid have inline CSS).

**Agent report** (as in CLAUDE.md): Done / Not done / Gaps / Tests: a before→after table per scene and profile (COVER, control
count, idle layouts/s, head covered) / Owner actions (no SQL expected) / Branch.

## 12. Decisions taken (to log in docs/progress.md)
- N = 5 always-on controls; caps L 12 % / P 15 % / PC 6 % (goals 8 / 10).
- Portrait immersive is on by default for character games only, so round games keep the under-game ad slot.
- The inventory is a collapsed tray + a hold-wheel + a half-screen sheet (the owner's "radial like a weapon wheel"), and not
  a full-screen window.
- Poses are cosmetic in 2D (Podzem), so there is no gameplay change. Sit and lie work in all 3D games, on the ground or on a seat.
- No phone or banner warnings for hazards and no nag banners; hints are shown once per device.
- 🎬 Действия is removed in favour of the pose radial + "➕ Ещё". 🔄 оружие and 🔄 руки are removed (the tray and the left-hand
  slot do the same).
