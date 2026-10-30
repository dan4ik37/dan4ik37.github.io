<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Движок D37E (js/engine/*) — перенос систем из Unity-проекта владельца (D:\UnityProjects\Backrooms)
- Владелец просил «движок адаптировать с игры юнити, а не игру»: перенесены СИСТЕМЫ (не Backrooms). Файлы и порядок
  подключения — в шапке js/engine/core.js. Единицы: 1 м Unity = E.UNIT (2,1/1,8) — все цифры Unity «× U».
- controls.js (Core/Controls.cs): действия вместо клавиш, 2 клавиши на действие (d37_keys), геймпад, кнопки телефона
  C.press; down/held/up/hold/tap/doubleTap/chordDown. player.js (PlayerController/PlayerStamina/Parkour/GripFinder):
  шаг 4 / бег 7 / присед 2 м/с, прыжок 1,2 м, выносливость (бег −14/с, выдохся — с 30 %), кувырок, перелезть/подтянуться/
  повиснуть/по краю, лестницы (E.ladder), сесть (sitOn, seat.stand — стоя у бильярда). camera.js (CameraFeel.cs): 3-е/1-е
  лицо, бег +8° FOV, приземление, kick/shake; стены с data.cam держат камеру. interact.js (PlayerInteractor): «[E] …»,
  удержание. build.js (BuildDefs/BuildGrid/BuildPiece*): стройка как в Rust — пока не подключена к миру. inventory.js
  (Crafting/InventoryStore/StorageBox). synth.js (AudioSynth.cs): звуки шумом, без файлов (d37_games_mute). physics.js:
  луч, начатый внутри тела, его не видит (как в Unity).
  Ступеньки (лестницы, скаты крыш моделей из коробок): тело встаёт сразу, картинка и камера догоняют за ~0,1 с — P.stepOff
  (pose().y и camera.js); камеру держат только высокие коробки модели (стены), не ступеньки крыши.
  Плавание (player.js): игра задаёт ph.waterLevel(x, z) → уровень или −∞; глубже ~1,1 м — P.swim: у поверхности, бег быстрее,
  «присесть» — нырнуть (до дна или 3 м), Пробел у берега — выпрыгнуть; события splash/swim (звуки), поза swim/dive (world3d
  animate). Студия: вода ландшафта. Звуки-петли окружения (synth.js): A.loop(amb_fire | amb_rain | amb_wind | amb_water | amb_magic,
  { x, y, z, vol }) — громкость и сторона пересчитываются в A.listener; в «Студии 3D» в игре — у эффектов и у воды.
- «Бежит сам» (T-042, 22.10): C.releaseAll(why) отпускает всё (клавиши, кнопки мыши, кнопки телефона, стик; C.released — счётчик,
  C.lastRelease — почему) на blur, pagehide, спрятанную вкладку, меню правой кнопки мимо игры (не отменённое), фокус в поле ввода;
  кнопки мыши, Shift и Alt сверяются с каждым событием мыши (e.buttons / e.shiftKey). input.js: палец/мышь отпущены где угодно
  (pointerup/pointercancel на window, lostpointercapture), ui.js — кнопки телефона при перерисовке. Своих keyup/pointerup на
  холст не вешать — только C / I. Тест — engine-test «Бежит сам». C.step и V.moveBox — без мусора (было ~2,7 КБ на шаг и ~40 Б
  на вызов; moveBox — обёртка, числа через Float64Array: дробные аргументы невстроенного вызова V8 упаковывает в кучу).
  Колесо/щипок/геймпад до упора — от 1-го лица (camera.js rig.autoFirst; действия zoomIn/zoomOut, крестовина ↑/↓; ⚙️ «Камера» →
  zoomFirst): rig.setMode(m, { why, blend }) — переход 0,22 с, отодвинул — снова 3-е лицо (гистерезис, пауза 0,3 с), игре —
  rig.onMode(m, why) (прицел, мышь); views.js — только в видах rig, V.reset возвращает. Мир, Студия 3D; «Кубомир» — нет (колесо —
  ячейки). Камера 3-го лица — не ниже пола под ней + 0,4 (phys.groundAt; бункер, подвалы), а не y ≥ 0,4.
- Бой — js/engine/combat.js (D37E.combat, T-012; docs/COMBAT.md §3): без Three.js, шаг фиксированный, без мусора за шаг. Данные —
  KINDS (оружие: grip one/two/off, hold, cool, reach, dmg, kb, moves, chain, block, bow) и MOVES (axis h/v/t, wind/act/rec). Боец —
  CB.fighter / CB.init(свой объект; у мобов поля прямо в мобе). Шаг: equip → guard → bow → step; attack по нажатию (во время удара —
  запомнит 0,2 с); попадания — sweepBegin(глаз, взгляд) → sweepHit(коробка, id) → hit → applyHp; без бойца (зверь, стрела) — receive.
  Урон × (0,2 + 0,8·заряд²), серия при заряде ≥ 0,8, размах по нескольким — только полный заряд; щит: отбив 0,2 с с подъёма (не чаще
  0,7 с) → ударивший оглушён 1 с; топор выбивает щит на 2,5 с. CB.pose → { r, l, m, mh, v, g, d, p }, CB.pack — одно 32-битное число
  (для сети). Номера HOLDS / MOTIONS — те же в world3d.js (только дописывать в конец). world3d: слой рук o.hold (actors: a.hold) —
  без него позы как были; главная вещь — в суставах armL (у человечка armL — ПРАВАЯ рука, названия — для смотрящего спереди).
  Тест: node scripts/combat-test.cjs (80; 30/60/144 кадра, без мусора).
- Волны — js/engine/waves.js (D37E.waves, T-022c; docs/PHYSICS_PLAN.md §5): ОДНА функция — сумма 4 волн Герстнера — в шейдере воды
  (gfx.js E.waterMaterial: opts.waves = поле, wavesMode 'v' — смещение вершин, 'f' — только нормали) и в JS (F.sample — высота в точке
  мира Ньютоном; видеокарта = JS до 1 мм — waves-e2e look). Поле: W.field({ kind: ocean|lake|pond|canal|river|side, seed, grid, solo });
  частоты кратны 2π/P (P = 96 с), время — W.time() = Date.now() по модулю P (у всех одно, без сети); направления волн постоянные
  (от зерна), ветер меняет только их силу (иначе фазы вдали «прыгают»). Погода → F.weather({ wind, windDir, thunder, ice }) — раз в
  2 с из своего мира погоды игры (не S.wx: у него «детский» флаг). Море мира — «блин» W.patch вокруг камеры (кольца, рядом шаг 0,5;
  меш БЕЗ поворота и масштаба), маска клеток моря и сетка глубины/«открытости» (WM.seaGrid: у берега волны гаснут, гавань — 0,75);
  дальние короткие волны в шейдере гаснут (только картинка). Лодки (vehicle-water.js): env.waves(x, z) → поле; качка пружинами по 5
  точкам корпуса, борт не уходит под гребень, глиссирование, удар о волну (env.onSlam), в шторм руль хуже и сносит, маленькую (длина
  ≤ 7) крутой поворот на полном ходу в шторм переворачивает (env.onCapsize; флаг FL.capsized в снимке; встаёт через 8 с, без урона);
  чужие/стоящие — BOAT.pose (качка у себя). Часы волн лодки — W.clock (шаг; одинаково при 30/60/144). Пловцы — ph.waveAt (player.js).
  Страж: ключ 'waves' (post.js) → W.disable(): define прочь, «блин» спрятан, в физике волн нет; нельзя волн в картинке (низкая,
  WebGL1, страж) — нет и в физике. Мир закрыли — W.free(поле) (снимает и материалы: они держат рендерер). 2D — kind 'side' (Q = 0,
  F.at1 / W.GLSL1 / W.sync1), «Подземье»: гладь под небом и в больших озёрах (биты 1–7 канала a у T1 — podzem.js wvRows). Тесты:
  node --expose-gc scripts/waves-test.cjs (64), scripts/waves-e2e.cjs [look|perf|soak|capsize|reopen|podzem] [pc|phone].
- Тесты: `node scripts/engine-test.cjs` (128 проверок: управление, бег/выносливость, прыжок, кувырок, паркур, лестница,
  стройка, вещи, звуки, клин, ландшафт, скрипты). Меняешь цифры движка — прогони.
- Графика (render.js, владелец 12.10.2026: «мир слабенький — свет, тени»): ACES, солнце с тенями (коробка теней ездит за
  игроком R.follow, шаг по текселю), свет и отражения неба (PMREM из купола), небо с солнцем, облака-спрайты, вода R.water
  (рябь кодом), R.mat (PBR) / R.tex (img/tex — CC0 из Unity-проекта, пересобрать: `python -X utf8 scripts/make-textures.py`),
  R.canvasTex/R.normalFrom (текстуры кодом), склейка R.bakeStatic: UV «по миру» (material.userData.tile) + тень у земли
  вершинами. Качество low/mid/high (E.gfxQuality, d37_gfx; кнопка 🖥 в мире): low — без теней и текстур (Ламберт).
- Кадр в полный размер из встроенного браузера: R.render() и сразу canvas.toDataURL (иначе пусто) → большой ответ
  javascript_tool сам ложится в файл → base64 в jpg (python) → Read.

## 🌦 Погода, времена года и праздники (движок; агент 16.10.2026, GAMES_VER 105; подробно — docs/SEASONS.md)
- Владелец: «не как в Майне, а лучше: погода меняется везде — свойством движка, с временами года и холодом». Ядро —
  js/engine/climate.js (D37E.climate, без three.js — грузится и на страницах сайта: index.html после gfx-settings.js): календарь
  владельца — фаза года φ (0 весна … 3 зима) по МСК (C.ZONE = 180): декабрь–февраль — зима (φ = 3 + доля 90/91 суток), март–ноябрь —
  C.FAST = 7 сезонов по 275/7 ≈ 39,3 суток (весна 1 мар – 8 апр с Наурызом, лето, осень, зима 26 июн – 3 авг, весна, лето, осень
  23 окт – 30 ноя — весь ноябрь; до 21.10 было 38 сезонов по неделе — «слишком быстро»); φ непрерывна на всех стыках. Праздники — по МЕСТНОМУ времени игрока (C.HOLIDAYS — данные: Новый год с отсчётом 10 с и салютом,
  Старый Новый год, Лунный (таблица 2026–2040), Наурыз 21–23 марта «Наурыз құтты болсын!», Сонгкран, Рош ха-Шана и 1 мухаррама
  (таблицы, только поздравление), Энкутаташ, Тыквенная ночь; фазы pre / burst / day). C.advent — новогоднее задание (1–31 декабря).
- Погода — W = C.world({ seed, mode: calendar | cycle (N игровых суток на сезон) | fixed | off, weather: auto | состояние,
  climateAt, lapse, seaY, front, hourAt, gameTime, storm }); W.at(x, z, мс, y) → { season, state (clear … heat), temp, feels, cloud,
  rain, snow, hail, thunder, fog, heat, wind, windDir, wet, puddle, snowCover, ice, autumn, bare, fresh } — от зерна и времени, у
  всех одинаково без сети. «Погодные часы»: общий мир — 7,5 реальных мин, части по 6 (45 мин), события: осадки, гроза, туман,
  зной, тучи (собираются за 1 w-ч до дождя); климаты temperate / steppe / mountain / desert / sea / snow / tropic (осадки и снег
  — по температуре в точке; фронт идёт с запада); «ощущается» — ветро-холод и BoM; накопители (мокро, лужи, снег на земле, лёд)
  — по прошлым 30 w-ч. C.exposure(s, { clothes, inside, umbrella, near }) → { cold, heat, wet } — задел «как в Симс» (после 21.10).
  C.on('holiday' | 'season' | 'weather', f), C.tick(мс). Тест: node scripts/climate-test.cjs (61).
- Картинка — js/engine/precip.js: X = D37E.climate.attach(R, { world, where, skyTop, water, origin, hour, sound, occlusion,
  particles, sky }); каждый кадр сам (R.preRender) или X.frame(dt). Небо/свет/туман — R.setWeather (render.js, после E.skyModel;
  E.weatherSky в gfx.js; прямой свет не ниже 0,021 — castShadow не меняется); частицы (дождь, град, снег, брызги, круги) — пулы
  вокруг камеры, капля — только выше skyTop (D37E.precip.physTop(ph) — луч физики); молния (R.flashK) + wx_thunder; радуга
  (D37_RBOW на куполе). Поверхности — кусок gfx.js D37_CLIM (normal_pars_fragment + normal_fragment_maps; только STANDARD и
  LAMBERT, непрозрачное; D37_NOCLIM — выкл): снег на смотрящем вверх с шумным краем, мокро и лужи-зеркала, листва D37_LEAF
  (E.leafMaterial: grass 1 / leaves 2 / needles 3 — хвоя не желтеет; R.wave и prefab'ы ставят сами; batch.js переносит), лёд воды
  движка; «что над головой» — карта высот сверху 256² (E.GFXU.occRT, общая на страницу: clone() отдаёт себя; рисуется раз в ~2,5 с
  только пока есть снег/мокро; человечки userData.actor — не крыша), у «Кубомира» — свет неба блока (D37_VOX). Данные E.GFXU.cl*
  — только на время кадра (R.wx.pre/post). Подводный туман (R.setUnder с { k }) — ПОСЛЕ погоды: погода и небо его не перебивают.
- Страж графики: ключ 'clim' — не собралась программа STANDARD/LAMBERT → сначала без куска погоды (E.climUnpatch, пересборка), не
  помогло → без своих кусков → «низкая»; кадр с погодой чернеет / «не числа» (R.wxOn) → без погоды сразу. render-test раздел 23.
- js/core/celebrate.js (D37Celebrate, на всех страницах): холст салюта (z 100250), поздравления, отсчёт, конфетти/фонарики/лепестки/
  капли по стилю праздника, свой маленький звук (или synth fw_launch / fw_boom / fw_crackle); «🎄 Новогоднее задание» — карточка
  .cel-adv (в играх свёрнута до значка, убрать нельзя) и полоса .cel-ban на главной, 31 задание ADVENT (события d37:game из
  games.js report, переходы #/…, свой d37:chatmsg, d37:advent { kind }), прогресс d37_advent; награда за день — с сервера (T-024,
  advent_claim в games-more.sql: проверенное — 10 🪙 + 5 XP, иначе 5 🪙; 20 дней — ⛄ «Снеговик»; на карточке «⛄ N/20»; сделанное без
  входа забирается после входа — srvSync), крючок onAdventDone (docs/SEASONS.md §9). ⚙️ «🌦 Погода» (ключи wxFx, wxAmt, holidays): эффекты, частицы, «Салют и поздравления».
- «Студия 3D», волны (T-085): вода ландшафта (terrain.js) — поле волн «озеро» TR.waves (нормали в шейдере, 'f'), TR.waveAt →
  ph.waveAt (пловцы качаются), высота — от погоды мира (studio3d-weather.js, раз в 2 с); поле снимается в TR.dispose / R.dispose.
- «Студия 3D»: js/games/studio3d-weather.js — «🌦 Погода» (SC.settings.weather: mode, days, season, weather, climate, seed — в мире,
  у гостей блоком world), Weather.* в скриптах (script.js WS/Weather; Lua, C#, Java): State, Season, Temperature, FeelsLike, Wind,
  Rain, Snow, Today, события Changed(state, season) и Holiday(id, text), Weather.Set(state) — у хозяина на время игры (гостям 'wx').
- «Кубомир»: kubomir-weather.js берёт сезон и силу дождя/снега у движка (климат по биому — BIOME_CLIM), частицы свои; зимой снег на
  верхних гранях, осенью цвет биома желтеет (VR.onShader), озёра под открытым небом — лёд: вид + V.iceTest в voxel.js (верхний
  блок воды твёрдый до глади, блоки мира не меняются), весной тает; ⚙️ «🧊 Кубомир» → «Времена года» (calendar / cycle 3 суток /
  off — всегда лето). Без climate.js — прежнее расписание (atOld).
- Замер (ПК, 1280×720, «высокая», scripts/climate-e2e.cjs): студия — ЦП 0,96 мс / 53 вызова без погоды → 1,16 мс / 57 в снег, 1,20 мс /
  57 в дождь; «Кубомир» — 3,15 мс / 583 → 3,44 мс / 585. Снимки — E:\claude-tmp\climate\shots. X3595 на Direct3D — было и до погоды.

## 🌪 Weather by biome — D37E.wx + D37E.wxfx (T-135, steps WX0–WX2, 29.10.2026, GAMES_VER 152; spec E:\d37-core\spec\BIOME_WEATHER.md v2)
- Owner: «в разных биомах свои особенности: песчаная буря, пыльная буря, перекати-поле, зимой буран, град» + «реалистичнее, редкие
  исключения» + «град вредит по-настоящему». Data (WX0, Layer-1, append-only): data/wx/weather_events.csv (53 rows: spec rows 1–48 +
  49–53 realism: desert winter rain mostly evaporates or falls cold, snow in a desert ≈ 0.2 per game year on winter nights only, hail in
  the tropics rare), climate_classes.csv (the ONE place of the class integers 0 temperate … 8 warm, default surfaces/features per
  class), wx_levels.csv (hail harm by class: shared / kids ‰ per 10 s and health floors — kids never below 50 %, crop damage, dents;
  VIS_RATE, dB, fire classes, Kp, glaze: walk ×0.5, car steering ×0.7, braking ×0.6, no spins). `node scripts/make-wx.mjs` writes them
  into the <wx-data> block of js/engine/wx.js (`--check` in CI). Copy the CSVs to E:\d37-core\spec\data once the Backrooms lead OKs.
- Core (WX1): js/engine/wx.js, loaded after climate.js only in games (index.html keeps the light climate.js). climate.js gets a ~25-line
  hook: `sample()` calls `E.wx.apply()` after the ribbon mix — inside a special's window the parts follow the integer event (precip
  type, hail, temperature band, wind ≥ the row's, direction), outside every window `null` → every old field bit-identical (golden vs
  the pre-T-135 climate.js from git). New states are APPENDED by wx.js (only where it loads: the site and Studio keep nine) (sandstorm, duststorm, buran, whiteout, hail, downpour, freezing_rain,
  seafog) and appear only in `s.stateX` (C.labelX); `state` / C.label unchanged. New fields: special, sp, vis (m, 510 = clear), dust,
  dustC, tint, tintK, flat, hailSize (cm), freezing, fireRisk, sign/signKey (lead: in-world signs only), funnel, flav/flav2, glaze, drift.
- Schedule: integer twin of the ribbon (`slotKindQ` = slotEvent, 0 mismatches in 168,000 slots), salts 0x5758 / 60+; one main special
  per place per slot (rows own ‰ intervals, acc ≤ 1000 checked on a grid), groups 0/3 independent; fronts move west → east with
  W.front (a place 8,000 u east sees the same special exactly 8,000 / front w-h later); «Стихии» `elements` 'rare' (default: strong rows
  half as often) | 'real' | 'off'. Region record per place: `wxRegionAt(x, z)` → { cls, smask, F, alt, kc }; else `WX.biomeAt(W, x, z)`
  (the ONE biome adapter — T-116 switches it; `W.biomeAt` callback until then) → `WX.regionOfBiome`; else the climate key.
  T-145: a world on the logical biomes passes `wxRegionAt: D37E.wx.regionOf(src)` (src = `D37E.biomes.t1(seed, { gen })` |
  `.kb(G)`) — `B.region` per 128 m weather cell (majority class of five samples, surfaces OR-ed, coast/high), cached; class, surface
  and feature bit orders are the same in wx.js and biomes.js (climate_classes.csv). Used by «Новая земля» and by «Кубомир» v4 worlds.
  Kids' city (kc) and W.storm === false: no strong rows. Realm 'kids' (default): hail at most HA1 (1.3 cm), wind W9 halved.
- AI: `WX.visQ`, `WX.sight(d, vq, kind‰)`, `WX.limitAt(x, z)` (cell 64 u × 2 s cache) — creatures never see farther than the player's fog
  (≤ 4× for natives); npc.js caps follow/flee radius by it (`E.wx.AI = false` — off).
- Visuals (WX2): js/engine/wx-fx.js — sky/fog tint and visibility through R.setWeather (render.js applyFog: fog end = min(fog, vis),
  floor 15; gfx.js E.weatherSky: horizon/zenith to the storm colour, pale sun, light ≥ 45 %, whiteout `flat`), grains (Points) and low
  streaks (LineSegments) around the camera, lazily created, hidden = 0 draw calls, ≤ 2 draws in a storm; phone/'mid' 45 %, 'low' tint
  only; louder/lower wind loop; hail streak length by size. precip.js attaches it itself (Mir, Studio when loaded, Planet when loaded);
  Kubomir attaches its own (kubomir-weather.js: weather cells 128×128 by five generator samples, `pushSky` because Kubomir darkens its
  own sky). Flags: `D37E.climate.SPECIAL = false` (all off), `D37E.wxfx.ON = false` (no visuals), graphics guard key 'wxfx'.
- Mir: `mirWxRegion` (mir.js) — 64-u cells: steppe (dust storms, tumbleweed wind, буран, позёмка), mountains (high: fog, hail), sea /
  war coast (coast: sea fog, squalls, waterspouts), capital and cities (town: hoarfrost, freezing rain, valley mist); kids' city kc.
- Planet (wired in T-145): the planet scripts load wx.js and wx-fx.js; desert latitudes get sandstorms by themselves (class by the
  latitude's climate key). planet-demo `planetWx(v, st.wx.wfx)` passes the smoothed wx-fx numbers (dust, flat, vis; tint linear →
  sRGB) into planet-view `V.setWeather` 4×/s: sky dome toward the storm colour, sun dimmer, the ground fades into the tint at vis.
  Only near the ground: fades from 2000 u, off from 8000 u (from orbit the planet is not tinted by the storm below).
- «Новая земля» (terra-demo.js, T-145, flag TERRA_WX): calendar weather in metres of the world (anchor + u / U), climate of rain and
  snow by `biomes.climateAtFn`, specials by `wx.regionOf(biomes.t1(SEED, { gen: 2 }))`, the sky ends over the core height (no rain
  in caves). «Кубомир» v4 worlds: kubomir-weather.js kbRegion takes zone-0 cells from `D37E.biomes.region` (biomes.js in its scripts).
  Phone ×4 'mid' (scripts/t145-e2e.cjs): «Новая земля» walking, clear, CPU per frame 4.24 ms with weather vs 4.32 ms without (noise);
  walking in a sandstorm 4.70 ms (77 grains + 42 streaks, fog at 62 u). Coast: sea strips of 4 m only over core ground below the sea
  (SEA_FINE) — a pit 4+ m from the shore is dry to the eye too, as for physics (TS.water).
- **The place's own climate** (T-145 review, 30.10): `C.world({ placeAt(x, z) → { t, amp, ph } })` — the yearly mean °C, the seasonal
  half-range and a season shift in quarters (2 — the southern hemisphere; not in mode fixed / off). climate.js takes the season
  temperature from it instead of the class row (`seasonTemp`), the ribbon season and the accumulators too; wx.js `regionAt` copies it
  into the region record (`t10`, `a10`, `pq`) and the integer `T_q`, the season and the roll cache key use it. No placeAt (Mir, Kubomir,
  Studio) — bit-identical to before. Sources: `D37E.biomes.placeAtFn(src)` (32 m cells: `B.meanC(ts)` — the Whittaker borders ts .07 /
  .22 / .40 / .62 / .80 are −15 / −3 / 7 / 17 / 24 °C; `B.ampC(tBase, m)` — 9…16 by dryness, ×0.35 where the sea-level base is hot)
  and `P.placeAtFn()` (planet.js, 64 u cells: `tempAt` at sea level, half-range 20·|sin lat|^1.2, ×0.5 over the sea, south `ph = 2`
  — the same declination as `P.sunDir`). Flags: TERRA_PLACE (terra-demo.js), PLANET_PLACE (planet-demo.js). Before: a hot savanna by a
  desert used the steppe row (t 7, amp 21: −14 °C, snow, буран), the planet's 10° N used 'temperate' (snow at the equator) and both
  hemispheres had one season. Numbers (scripts/place-climate-test.cjs, January, land within 400 m of a desert, 258 cells): class
  climate — 164 below −5 °C and 171 with snow; the place's own — 7 and 13 (cool steppe hills only), hot biomes 0 / 0.
- «Новая земля» since the review: day and night (TERRA_DAY: `E.dayClock(ms, 40, .2)` as Mir; the weather's `hourAt` is the same
  function of the moment — before it was the page light fixed at 10:30, so hail, afternoon storms and night specials never came);
  fog solid at the block ring's edge (TERRA_FOG: `(radius − 0.55) · 32 m` divided by the player's distance setting — from the air
  the cut world edge is not seen); rain stops at `TS.skyTop(x, z)` — the height field plus the column's edits (a dug pit gets rain
  to its floor, a fill shelters), the weather origin is one reused array.
- Tests: wx-test (55: data, grid, twin, season, T_q ±1.1°, golden, §2.11 frequencies, kids, fronts, order, AI, WxRec, speed),
  wxfx-test (11: pools, caps, low, roof, pushSky, 0.22 B/frame), wx-e2e (Chrome: Mir + Kubomir storms, phone ×4, soak),
  world-reopen-e2e with REOPEN_WX=sandstorm (20× phone, no leaks).

## 🪐 Планета (D37E.planet; T-051, 22.10.2026; план и замеры — docs/plans/planet.md)
- T-145, слияние: после посадки и прыжка на орбиту показ застревал (дыры в планете, 188 кусков вместо ~12) — выбор раз в 0,5 с, пока показ
  ждёт, и через 1 с без делений/слияний один выбор со сбросом (P.lodShow flush: мельче цели — прочь, на месте — готовая цель); стоя — 0 выборов.
- T-075 (PL-2 LOD v2 + PL-4 движок) — ВКЛЮЧЕНО с T-145 (29.10): флаги D37E.planetView.FLAGS (откат одной строкой: `const FLAGS = { ...FLAGS_OFF }`; на устройстве — localStorage d37_planet_v2 = '0' | '1'); выкл — старые пути (выбор кусков, 1 диапазон глубины, туман движка байт-в-байт, без погоды). T-145: показ после прыжка на землю не застревает, перетекание — атрибут куска, два прохода глубины — только с AO/отражениями, тени на земле 'auto' (телефон «средняя» — без них), тень солнечного затмения (флаг eclipse), крючок погоды V.setWeather({ …, dust, tint, vis, flat }); замеры — docs/plans/planet.md §12b. Всегда включено: E.setSunProvider, обод куска по диагонали физики, поток перезапускается (до 3), R.guardVolatile. Как продолжить — docs/plans/planet.md §12a; проверки: planet-lod-test (--fast в ci-run), gfx-strict PAGE=planet, planet-perf V2=1.
- Владелец 22.10: «планета — основа мира и вселенной, параллельно, скоро»; «планету нужно будет реализовать в других играх» → ОБЩИЙ модуль
  движка, у игр — только переходники (план §10: «Мир Денчика», «Кубомир», «Подземье», «Студия 3D», космос). Сейчас — образец на скрытой
  странице /play/planet (с T-145 — в каталоге для всех, «Планета», 0+; откат — T145_OPEN): полёт с орбиты до земли без загрузки, посадка, ходьба обычным player.js, сутки от вращения.
- Файлы: js/engine/planet.js (без three.js — node, поток, страница: профиль PL.def/PL.HOME, куб-сфера, шум, выбор кусков, сетки, плоский кусок,
  солнце и луна), planet-worker.js (сетки кусков в потоке), planet-view.js (three.js: куски, атмосфера, звёзды, луна), js/games/planet-demo.js.
- Решётка общая: вершина — целая точка куба M = N·2^L, искажение tan по оси → общие вершины соседних кусков (та же грань, другая, уровень
  крупнее) совпадают до бита; сшивка — 16 общих индексов по маске «сосед крупнее» (P.stitchMask), юбки — на время подгрузки.
- Плавающее начало: вершины — float32 от центра куска, матрица куска [Bᵀ | Bᵀ(C − A)] в double (three умножает на камеру в double).
  Плоский кусок V.fr (x — восток, y — вверх, z — юг; якорь — центр области ≈ 785 ед., P.region) — physics.js и player.js как есть:
  V.physics(ph) ставит ph.terrain.sample (= нарисованный треугольник самого мелкого уровня, P.patchGround) и ph.waterLevel. Переезд якоря —
  V.setAnchor(dir) ТОЛЬКО в шаге логики (одинаково на телефоне и ПК); слушатели V.onRebase(ev) двигают своё (ev.point / ev.dir).
- Пока вид открыт: E.sunAt отдаёт настоящее солнце планеты (небо, свет, отражения движка у человечков), купол неба движка спрятан, тени выкл,
  дальность камеры — своя каждый кадр (render.js ставит ≤ 3000 — вид возвращает); AO, отражения в экране и генерация кадров выключены
  (на глубинах в десятки км страж графики счёл бы их сломанными и выключил бы НАВСЕГДА для устройства). Море — часть сетки (вершины ниже
  моря подняты к нему; альфа цвета — высота у берега: берег — линия 0,5 между вершинами).
- Атмосфера — в вершинах (телефоны): Рэлей + Ми, толща к солнцу — функция Чепмена (Шулер; JS-копия PL.chapman, сверка с интегралом ≤ 15 %),
  выборки гуще у плотного воздуха; купол у камеры + оболочка с орбиты (переход по высоте).
- Тесты: node scripts/planet-test.cjs (83: решётка, соседи, покрытие, 2:1, швы, индексы, горизонт, переезд, физика = сетка, точность в
  10 000 км, сутки и календарь владельца, Чепмен); Chrome: node scripts/planet-perf.cjs [perf | soak N | reopen N] (профиль телефона, ЦП ×4;
  ЗАМЕЧАНИЕ: замедление ЦП в Chrome НЕ замедляет потоки — время сборки куска в потоке — как на ПК, для телефона ×4).
- С 22.10 (T-079) профиль — v2 (ниже): PL.HOME.moons = ['luna'] (Луна — тело системы, её рисует space-view.js), прежний v1 — PL.HOME_V1
  (луна-«украшение» rails 'visual'; поверхность родной — та же до бита, planet-test проверяет).

## 🛰 Небесная механика — D37E.orbit / system / clock / spaceView (T-079, шаг PS-1, 22.10.2026; план — docs/plans/planet-space.md)
- Файлы: js/engine/orbit.js (чистая математика, без three.js и DOM: O.m, рельсы Кеплера, элементы ↔ состояние, универсальные переменные,
  Гоман, Ламберт, сферы влияния, прогноз по кускам конусов O.predict), system.js (системы — ДАННЫЕ: SYS.HOME «Система Денчика», S.at / which /
  shadow / frame / sky / phase / moonEvents / orbitPath), clock.js (часы мира), space-view.js (небо системы — ОДИН вызов отрисовки на все тела;
  карта «🪐 Система» — 2D-холст), planet.sql (world_now()). Порядок в странице: clock → planet → orbit → system → planet-view → space-view.
- ОДИНАКОВОСТЬ ДО БИТА: в рельсах, прогнозе, перелётах, небе системы — только + − × ÷ √, floor/round/abs и O.m (свои многочлены вместо
  Math.sin/cos/atan2/exp/log/pow — у браузеров последний бит Math.* разный). Свёртка «золотых» значений — SYS.golden() / D37E.orbitGolden():
  число в orbit-test и сверка в Chrome (`node scripts/planet-perf.cjs golden`). Поменял O.m — новое число в orbit-test и O.m.VER + 1.
  Углы держать маленькими (O.m.frac / wrap; рельсы считают M долей периода).
- Единицы и оси: u, секунды; μ = g·G0·R² (G0 = 20·U — тяжесть player.js); оси движка, Y — полюс эклиптики (плоскость орбиты родной), долгота
  растёт от +X к −Z (как planet.js). Элементы в профилях — ГРАДУСЫ (a, e, i, node, peri, M0, epoch), период — из μ родителя (Кеплер у всех).
  Время мира t — секунды от 2026-01-01 00:00 UTC (O.EPOCH_MS = C.EPOCH); ms для времён года = EPOCH + t·1000.
- Небо родной с календарём владельца: вся система для неба поворачивается вокруг полюса эклиптики на ΔL = (долгота солнца по календарю) −
  (настоящая), поэтому солнце на небе = P.sunDir (до 10⁻⁹), а углы между телами (фазы, затмения) — точные. Склонение теперь точное
  (sin δ = sin ε·sin L; от прежнего ε·sin L ≤ 0,25°). S.frame(obs, t, ms).M — поворот «небо системы → BF тела».
- Профиль v2 (PL.def): v1 поднимается сам (air/o2/pressure → air {p кПа, o2…}, temp число → {mean, dayAmp, latAmp}, луны-объекты → rails
  'visual'); v2 без поля — нейтральные умолчания (ни Луны, ни воздуха, ни календаря); def(def(p)) = def(p); генератора ещё нет (moon1,
  desert1…) — id сохраняется, рисует rocky1 (P.genOk false). PL.seasonOf / declinationOf / subSolarLonOf — без создания планеты.
- «Система Денчика» (имена — решение владельца 22.10): Луна (a 1 398 144, T 16 800 с, e .012, наклон 15°, узел 120° — сезоны затмений дважды
  в год ~6 недель, один — сейчас; при 5° затмения были бы каждый оборот: тень родной на расстоянии Луны — 10° неба) и Песчаная (a 6·10⁹, год
  671 сут). Остальное (Фоб, Дейм, Огненная, Ядовитая, Великан, Ледяная, Океания, Пояс) — stub: орбиты и проверки есть, в небе и на карте не
  видны ({ stubs: true } — показать). Солнце: μ — из года родной (365,25 сут на 4·10⁹ u), радиус = 0,0047 · 4·10⁹ (как диск в небе).
- Вид: SV = D37E.spaceView(R, V, S, { observer }) → каждый кадр ДО V.update: SV.update(t, ms) (ставит V.skyM — звёзды в той же системе, и
  V.sunK — доля солнца у камеры: солнечное затмение тушит свет, небо и свет движка). Тела — квадраты-«картинки» на 0,9 дальности: Луна — шар с
  фазой, морями, пепельным светом и тенью родной ПО ТОЧКАМ ДИСКА (лунное затмение: край тени ползёт, в тени — красная); мельче 3 пикселей —
  точка с блеском по фазе и расстоянию; солнце из космоса — диск и свечение (в воздухе солнце рисует атмосфера; вес — как у оболочки неба).
  Хуки planet-view.js: V.U, E.planetView.GLSL (ATMO, PHASE), V.skyM, V.sunK; луны-«украшения» — только объекты профиля.
- Часы: C = D37E.clock; off = C.start() … off(); C.t(); сверка — 3 × world_now(), медиана, RTT/2, раз в 10 мин и при возврате на вкладку;
  нет planet.sql (PGRST202/404) — часы устройства (state 'nosql', полчаса не спрашивает); C.feed(serverMs, rtt) — для T-045 / net.js.
  /play/planet: время = часы мира + своё ускорение (st.off копится шагами по 1/60 с); ночь над стартом — сдвиг до 9 утра («⏩ своё время»).
- Замер (профиль телефона 412×915×2, ЦП ×4, «средняя»; одна страница, небо системы вкл/выкл окнами по 5 с по очереди — машина была
  загружена другими агентами, отдельные прогоны «до/после» шумели ±2 мс): орбита 2,06 → 2,42 мс ЦП на кадр (медиана 2,0 → 2,4; 6 пар,
  разница 0,24–0,49), земля 3,21 → 3,35 (2,8 → 3,1; позже машина была перегружена — кадры по 30–60 за 5 с, не в счёт); вызовов +1, а если
  ни одного тела над горизонтом (или все за планетой из космоса) — ни одного: тело целиком за шаром моря не рисуется (проверено: сутки на
  земле и на орбите, 96 + 96 точек — ни одного видимого не спрятало). Данные тел — один буфер (одна загрузка за кадр). Node (ПК): небо
  5–6 мкс, рельсы 0,3 мкс, Ламберт 8,6 мкс, прогноз 0,3 мс, события Луны 1,2–1,4 мс (только при открытой карте, раз в 30 с); карта —
  2,3–4,3 мс на её кадр (~30 кадров/с; 3D в это время не рисуется). За кадр — только упакованные числа (~86 байт).
  Утечки: 21 открытие/закрытие с картой — рендереров 2 → 2, геометрий 54 → 54, материалов 9 → 9, куча 14,6 → 15,7 МБ (после — 13,8);
  12,7 мин игры (полёты, посадки, ходьба, время ×300, орбита) — куча 24–28 МБ ровно, 0 ошибок. Грабли: таймер из mount (подсказка 9 с)
  держал ВЕСЬ прошлый мир (замыкание видит R) — снимать в unmount (было и до T-079: reopen×20 рос 15 → 53–61 МБ, теперь не растёт).
  Проверка утечек в Chrome через Runtime.queryObjects — ручки отпускать (Runtime.releaseObjectGroup), иначе замер сам держит объекты.
- Не сделано в PS-1 (по плану — дальше): разгонного режима нет (решение владельца 1: честное время; O.drive не делали), корабли и полёт (PS-2),
  спутники и связь (PS-4/5), шейдер тени Луны на земле (сейчас — общая доля V.sunK у камеры), имена и вид заготовок (PS-8).
- Тесты: node scripts/orbit-test.cjs (95: O.m против BigInt-эталона ≤ 2,6 ULP, «золотые» значения, Кеплер против RK4, элементы ↔ состояние,
  числа плана, Гоман/Ламберт, прогноз (к Луне, пролёт, уход к солнцу, удар, атмосфера), небо и затмения, 30/60/144 кадра, точность в 10¹² u и
  через 100 лет, часы), PGlite scripts/planet-sql-test.mjs (8); planet-test (95, с профилем v2); Chrome: planet-perf.cjs [perf | soak N | reopen N
  | map N | golden].

## 🧱 Обрушение и прочность — D37E.support (js/engine/support.js; T-022a, 22.10.2026, GAMES_VER 128; docs/PHYSICS_PLAN.md §1)
- Владелец: «физику обрушения, держания — для наших пресетов во всех движках», «как для 2D, так и 3D». ОДНО ядро без Three.js (окно, поток,
  node): держание 0…1000 (‰) как в Valheim, только целые числа и постоянный порядок обхода — у всех одинаково (по сети — только «сломано»),
  без мусора за вызов. Материалы S.MATS (потеря ‰ за шаг вверх / вбок / вниз, cap, min, bear): wood, stone, brick, concrete, metal, glass
  (держится, но не держит), dirt, sand, snow, rock / soil (природное: вверх 0 — толща, вбок 100 / 300 — свод пещеры), slab, steel. Режимы
  S.MODES soft (вверх ×¼, вбок и вниз ×½) / real; S.prof(режим) — таблицы. Опора — «сосед с 1000» (биты gnd 1 снизу / 2 сбоку / 4 сверху).
  Новый материал (мод) — S.defineMat.
- S.grid({ dims, down }) — клетки 2D/3D: build(seeds, read, { r, rn, P }) — связный кусок от правки (природное с 3 природными под ним —
  опора; дальше rn — оценка); collapse(P) считает «до» (семена на месте) и «после» → падает только то, что держалось ДО и не держится ПОСЛЕ
  (пещеры генератора и импорт не трогаем); estimate(P) — «удержится ли новый блок». S.boxes() — детали-коробки (Студия, здания мира).
  S.drop / dropStep — падение куском шагами игры (30/60/144 кадра — одинаково). S.level / color — синий (на опоре) → зелёный → жёлтый →
  красный → тёмно-красный.
- «Кубомир» (kubomir-support.js, st.sup): meta.support 'soft' | 'real' — выбор при создании (нет поля — выкл, старые миры не трогаем).
  breakCell: st.sup.code ДО W.set, st.sup.removed — после; placeBlock / hostHooks.placeAs — canPlace; рамка — T.tint → VR.preview. Падает —
  очередь кусков ≤ 400 клеток снизу вверх (бюджет 260 клеток за такт 20/с — одинаково на телефоне и ПК), fallGroup { drop } (быстрая сетка: шаблон блока + без граней
  между кубиками), 1–3 блока — сразу; легло — блоками (природный камень — булыжником, занято — вещью). Вместе — считает хозяин ('fell' k:'d').
- «Подземье» (podzem-support.js, G.sup): W.support при создании; поставленное игроком — бит c.pl (сохраняется: pl), природное — своды пещер;
  стены фона блоки не держат; падающее — S.drop (рисунок — плитки атласа, G.alpha), легло — плитками; canPlace с подсказкой, точки цветом.
- «Студия 3D» (studio3d-support.js): SC.settings.support { mode, show }, у детали smat (в SAVE и NET_EXTRA); панель «🧱 Прочность»; в игре
  не держится — anchored false → Rapier; Support.Mode / Holds / Get / Break / Collapsed — в JS, Lua, C#, Java.
- «Мир Денчика» (mir-support.js, rt.sup): здания modular боевой зоны — выбили деталь (DS onBreak) → верх над дырой осыпается по очереди
  (rt.update → M.step; задержки от номеров — у всех одинаково, без рассылки); базы/бункер — steel; M.hold — осыпавшееся не возвращается без опоры.
- Замеры: дом 1932 клетки — пересчёт 0,6–1,4 мс (node); «Кубомир», Chrome, телефон ЦП ×4 — кусок 2267 клеток 6,9 мс (медиана, худший 21),
  балка 112 блоков падает — кадр 14,1 мс (как без падения), p95 24, худший 29; «Подземье» ×4 — стена 1000 плиток 2,9 мс на плитку, мост
  падает — кадр 1,8–2,1 → 2,0–2,8 мс; память не растёт (12 кругов; мир закрыть/открыть 20 раз — «Кубомир» полка ~112 МБ, «Подземье» 20,3 → 20,7); 10 мин игры в мире «реализм» — 0 ошибок (оба; kubomir-e2e KB_SUPPORT=1 KB_MODE=soak / reopen KB_N=20). Проверки: support-test (44), kubomir-hand-test §12, podzem-support-test (11,
  10 мин игры), studio-support-test (19), mir-support-test (11); Chrome — kubomir-e2e KB_MODE=support, podzem-support-e2e.

### Structure v2 — load (T-124, 29.10.2026, GAMES_VER 143; spec E:\d37-core\spec\STRUCTURE_HAZARDS.md §2.1 S1.L, steps SH0.1, SH0.2, SH1)
- v1 is pinned: `scripts/support-hash.js` hashes sup[] + groups over a seeded 36,000-step build (3D real/soft, 2D, a cave dug cell
  by cell, boxes) at 30/60/144 fps; `V1_HASH` in support-test.cjs (`--chrome` checks the same hash in Chrome). Any v1 change breaks it.
- Opt-in per world: Kubomir `meta.load = 1`, Podzem `W.load = 1`, Studio `SC.settings.phys.load = 1` (no UI toggle yet — SH0.5b).
  Rollback for every world: `D37E.support.LOAD = false` (v1, never "support off"). `S.VERSION = 2`.
- Kernel (support.js, after boxes): `S.loadJob(geo)` — a resumable job ('rm' = edit removed seeds, 'add' = landing / placement,
  'now' = as is): build (resumable BFS: `G.begin` / `G.more`) → pass 1 (v1 values, disabled links respected) → strict order
  (1000 − sup, then key = height, x, z; radix) → pass 2 (W, Mx, Mz, My in half-units; stand wins; equal split to all side / hang
  supporters) → checks (crush, side joint about its face, hang, storey overturning of each cut, 8 directions, ×181/128) → "held
  before" failure (after > 1000 ‰, before ≤ 1000 ‰, raised) → cut in strict order (≤ 3 rounds) → groups (+ crushed cells).
  Budget: `S.SOLVE_BUDGET` ops per world tick (weights `S.OPW` ≈ equal time per op). Placement: `S.placeCheck` (or placeStart /
  placeResult time-sliced) — refuses when v1 refuses, a node goes ≤ 1000 → > 1000 ‰, or an overloaded node gets more; G.full / unk → allowed.
- Material load data: `LOADV` in support.js (spec §3 start values); soft × 2 (calibrated: × 3 let the 5-long cliff cantilever stand).
- Anchors: true (ground, bedrock, natural col(), soft natural, EST estimate) — the joint to it is checked with the cell's own
  capacity (cantilever out of a cliff fails at its root); boundary (piece edge r / rn, G.full, beyond 512, unloaded = code 5 from
  the adapters; v1 treats 5 as 1) — absorbs load unchecked, nodes adjacent / whose load passes through / receiving its load = unk,
  unk never fails.
- Interim until S1.T (SH3): a storey (overturning) failure is reported (`res.tips`, `res.tipD`) and refuses placement, but is not cut —
  a straight drop cannot move what rests on its support. Cuts act on joint / hang / crush.
- Adapters: jobs at the world tick (Kubomir st.sup.step; Podzem every 3rd 1/60 step), FIFO + one pending job that collects nearby
  seeds, an edit inside the active piece restarts it with the union of seeds (≤ 2), creak when a job takes > 1 tick, landing re-check
  as an 'add' job (cascade ≤ 2; a group that landed in place is not re-checked), crushed → keep items, build tint at the tick.
- SH0.2 (all worlds): chest / furnace contents (W.tile) move with a collapsing group (or spill as keep items); keep items never
  despawn or get evicted; `ents.itemBatch(keep)` merges an event's items into stacks (≤ 32 entities; felled trees too); Podzem — a
  chest on a collapsed build spills keep items instead of hanging.
- Numbers (29.10): node, house 1,932 nodes — v1 sync 0.4–1.3 ms, v2 worst 4,096-op tick 0.15–0.34 ms, 23–29 ticks. Chrome kernel
  (typed world, 2,816 nodes, quiet run) ×4: worst tick median 1.3 ms, max 2.1 (v1 sync 3.5 ms). Kubomir page (house 2,269 nodes):
  v1 sync ×4 13.4 ms median; v2 ×1 worst tick median 0.8–1.2 ms, 29–35 ticks; v2 ×4 in-page not measured cleanly (machine contended:
  8–22 ms) — re-measure on a quiet machine before signing SOLVE_BUDGET; the Kubomir world read makes the in-page cost ~2–4× the kernel.
- Tests: support-load-test.cjs (G7 + §3 verdicts = T-120 prototype numbers, props, held-before, placement, 5 seeds, code 5, landing,
  boxes, ticks 30/60/144, per-tick time, alloc), kubomir-hand-test §12, podzem-support-test, studio-support-test; Chrome: kubomir-e2e
  `KB_LOAD=1` (support / soak / reopen), podzem-support-e2e `PZ_LOAD=1`.
- Review fixes (T-124 review, GAMES_VER 144): a side supporter needs strictly higher sup (equal ones only when nothing else holds
  the node) — ties by key had sent load along a ring (9×9 roof corner 1309 ‰ → 971, mirror cells ±2); job option `early` — the v1
  groups are published right after the two pass-1 solves (`J.early`; castle 3,408 nodes: tick 18 instead of 62), load failures
  come later; `J.warn` — creak only when a load failure is coming; placement on a cut-off piece (G.full) skips the load passes;
  JIT warm-up of a load world's own grids in idle ticks (`S.warmTick` / `S.warmStop`, ≤ 1 ms, not game state; warming another grid
  does not carry over); grid / job / L fields declared in the literals (a later property deoptimised every job). Adapters: v1 part
  of placement and tint on a v1-size grid (exactly v1), load part from the tick estimate for that exact cell (Kubomir cache keyed by
  the piece's chunk revisions); Podzem cursor/preview never run the full check (`canPlace(f, x, y, real)`); seeds re-read at job
  start / restart / apply (support put back during the job → no fall); groups that cannot move stay; crushed cells pop attached
  blocks and spill chest contents (Podzem: neighbours re-checked); `X.flush()` on stopWorld / journal (Kubomir kubomir.js, Podzem
  podzem.js) finishes jobs and lands groups; co-op: a guest window on a moved chest gets `shut`, edits follow the tile object, a spill
  waits for the guest's close; `KubomirSupport.TILES = false` — one-line rollback of the SH0.2 tile move. Studio: crushed parts fall.

## 🪓 Крен и опрокидывание, рубка «как в жизни» — D37E.topple + D37E.fell (T-138 шаг 1, 29.10.2026, GAMES_VER 150; спека E:\d37-core\spec\STRUCTURE_HAZARDS.md §0.9, §2.2 S1.T, §2.4 S1.C, §5.x)
- Владелец 29.10: «как в Teardown: ломаешь — по частям с этой стороны; плохо держится — перевес, падает; дерево падает целым, его надо
  дорубить; великанам нужен большой подруб»; «физика с наклоном: что не держит вес — не стоит» (LEAN BEFORE FALL). Ядра без three.js /
  DOM (окно, поток, node); всё, что решает игру, — целые числа: длины — ВОСЬМЫЕ клетки от начала тела (надрубы — восьмые; спека говорит
  о половинках — отступление записано здесь), массы — кг (S.MATS / P.mass), углы — 65 536 на оборот (+8 бит у интегратора), такт мира
  20 Гц × 4 подшага. Таблицы sin/atan округлены до целых — одинаковы везде: `TP.tableHash()` = 17280408 (золотое число для Rust / C#).
- js/engine/topple.js — D37E.topple: `TP.body(max)` (буфер тела: клетки, масса, опоры со следом и прочностью на изгиб), `TP.analyze`
  (одно тело на опоре), `TP.storeys` (все этажи постройки: часть выше слоя L на клетках слоя L — как «storey» нагрузки v2), правило:
  центр масс за краем следа → опрокидывание сразу; внутри, но край перегружен → КРЕН (медленно, скрип) → центр масс уходит за край →
  падение одним телом. Раскачка (sway: real 50 ‰ / soft 25 ‰ на клетку высоты) × «тонкая опора» (площадь самого широкого этажа выше /
  площадь следа, ≤ 25): столб 1×1×25 из дерева стоит (как в спеке), гриб на ножке — кренится к тяжёлой стороне (ничья — +x, −x, +z, −z).
  `TP.world({ slots 16, smp 64, reads 2048 })` — слоты на типизированных массивах: крен (постоянная скорость, °/с), падение (маятник
  θ'' = K·sin(θ − θc), K из масс, полуявный Эйлер), до 64 точек «передней поверхности» по дуге — упёрлось ниже оси впереди → перекат
  через свес (≤ 2), выше оси и < 60° → ВИСИТ (держатель ушёл — дальше), ≥ 60° или 90° → лёг: поворот на четверть вокруг оси + сдвиг
  переката + спуск до опоры (`Wd.land` — целые клетки). Бюджет — чтений мира за такт ≤ 2048 на все тела (лишние ждут такт, не теряются).
- js/engine/fell.js — D37E.fell: сечение ствола 1×1 / 2×2 / 3×3 — 4 стороны (вместо 16 секторов спеки), подруб ≥ ⌈8D/3⌉ восьмых (треть) —
  сторона падения, запил с другой: недопил ≤ D восьмых → падает к подрубу; без подруба — к стороне, где осталось дерево (от рубящего),
  тяжёлая крона над срезом ≥ ½ — кренится сама. `FL.cell` — срез каждой клетки сечения, `FL.pack/side/through/left` — срез клетки (6 сторон
  × 4 бита) для F1.
- Сетка чанка (voxel-mesh.js): `V.meshChunk(..., cuts)` + `V.applyCuts(reg, cuts)` — надрубленная клетка (cuts: [rx, y, rz, значение,
  срез]) рисуется коробкой без снятого (срез бревна — торцом с кольцами), для света и граней соседей — пустая; voxel-stream `o.cuts(cx, cz)`,
  поток — `cuts` в сообщении. Без срезов — сетка байт в байт как была (hand-test §14).
- Игры: «Кубомир» — kubomir-topple.js (docs/areas/kubomir.md). Подземье / Студия / Мир / ядро d37-core — позже (те же модули).
- Цифры (node, topple-test): подрубленная башня 3×3×8 — до 5° 19 тактов, легла на 59-м; гриб на ножке — до 5° 50 тактов (2,5 с крена,
  3 скрипа), лёг на 124-м; повис на стене на 15,4°; 16 тел — худший такт 1 980 чтений (≤ 2 048), 560 отложенных шагов, все легли;
  8 тел — 85–107 мкс на такт, мусор 0 Б за такт (после прогрева); рубка — тонкий 7 ударов, 2×2 — 14 × 2 (в 4× дольше), 3×3 — 21 × 3 (в 9×).
- Потолок §5.x на сайте — в счётчиках за такт мира: тела ≤ 2 048 чтений, проверки этажей ≤ 2 048 клеток обхода (но одна проверка за
  такт всегда, ≤ 1 536 клеток постройки), «легло» ≤ 48 клеток; летящее тело не бросается (ждёт такт). Общего «дирижёра» с ИИ и
  нагрузкой v2 (приоритет ИИ → постройки → бедствия, доля 25 % для идущего обрушения) пока нет — у каждого свой счётчик.
- Упрощения (для шага 2 / golden SH11): после переката маятник считает K и θc от первой оси (движение — вокруг новой); диагонали
  спеки сведены к 4 осям (ложится четвертью оборота на сетку); раскачка × «тонкая опора» — своё правило T-138 (в спеке такого нет).
- Тесты: `node --expose-gc scripts/topple-test.cjs` (42, в ci-run), kubomir-hand-test §14 (27); Chrome — `KB_MODE=topple` в kubomir-e2e.cjs.
- Шаг 2 (29.10, GAMES_VER 152): `Wd.om` (угловая скорость слота, доли за подшаг) — для удара о землю (что отломится: ω·r выше прочности
  материала, kubomir-topple.js impact); исправлено: «лёг» не опускался на землю, если клетки тела ложились на 1 выше его начала (сравнение
  дна мира шло по y от начала тела — ствол над пнём висел на высоте среза). Обломки — раздел ниже (D37E.debris).
- Проверка (29.10, GAMES_VER 153): `solid(x, y, z)` слотов теперь 0 / 1 / 2 — 2 «земля»: держит падающее, но не держит повисшее (≥ 5° —
  LAND под этим углом; адаптер кладёт тело на месте); `Wd.place(s, x, y, z, out)` — клетка под центром клетки тела в текущей позе (любой
  угол, относительно начала тела, как `Wd.land`; на 90° с осью на краю клетки — то же, что `Wd.land`); `Wd.drop(s, восьмые, сдвиг)` —
  спуск и соскальзывание вдоль падения (1,5 клетки за такт; `Wd.offset` и `Wd.land` их учитывают); `Wd.save / Wd.load` — состояние
  движения слота (заглянуть, куда ляжет, без изменений — для сохранения). Центр масс ровно над осью (θc = 0) — толчок ω = rate (раньше
  ω = 0 навсегда); «tip» с θc > 0 (центр на волосок внутри после округления) — сначала крен, а не падение с нуля назад.
- D37E.fell (проверка): подруб решает сторону, только если он настоящий (≥ ⅓, первым) и есть запил с другой стороны до недопила;
  иначе — центр масс над оставшимся деревом (`[s[−], 8D − s[+]]`, ось 4D): за краем — валится туда (с одной стороны за середину — к
  срезу; маленький подруб + глубокий запил — назад, к запилу); с кроной — медленно, если она над срезанной стороной и дальше ≥ 1/8
  ствола; почти насквозь без подруба — к стороне центра масс. topple-test: 2×2 — подруб 6 → +x за 14 ударов, 2 / 4 / без → −x за
  11 / 13 / 9; 3×3 — 8 → +x (21), 7 → −x (20).
- Обломки (проверка): `X.tick(reads)` в kubomir-debris.js — 0 → пол 256 (постройки съели потолок), < 0 → своя доля 1 024 (было наоборот);
  `X.pending(f)` — куда лёг бы каждый летящий обломок (для сохранения).
- Вторая проверка (30.10, GAMES_VER 154): `Wd.more(s, восьмые, сдвиг)` — после REST падать дальше отсюда (адаптер не нашёл опору за один
  поиск: kubomir-topple.js ищет до 48 клеток за раз, по частям в потолке такта — T138-V3 / V5), скорость спуска не сбрасывается, итог —
  сумма; сдвиг идёт к цели в обе стороны (раньше — только от нуля: сдвиг назад прыгнул бы). topple-test: мусор шага меряется всегда (gc
  через флаги v8; раньше без --expose-gc проверка проходила сама).

## 🪨 Обломки — D37E.debris (js/engine/debris.js; T-138 шаг 2, 29.10.2026, GAMES_VER 152; спека E:\d37-core\spec\STRUCTURE_HAZARDS.md §0.9 SH-R, §5.x)
- Владелец 29.10: «блоки и предметы могут улетать в зависимости от веса и катиться со скалы». Ядро без three.js / DOM (окно, поток,
  node); всё целое: место — Q16 клетки (1/65 536; в Float64Array — точные целые), скорость — Q16 за подшаг, такт мира 20 Гц × 4 подшага,
  g = 100 Q16/подшаг² (9,8 м/с², клетка = метр); деление со знаком — к нулю (Math.trunc = «/» Rust / C#), номер клетки — floor (÷ 2^16,
  точно) | 0. Числа с плавающей точкой входят только на границе игры (`DB.q`, `DB.vq`).
- `D = DB.world({ max, reads })` — пул на типизированных массивах: `D.add(x, y, z, vx, vy, vz, кг, ребро в восьмых, roll ‰, tag)` → слот
  или −1 (пул полон — игра кладёт блок / вещь сразу, ничего не теряется); `D.tick(solid, reads)` → события D.ev [слот, тип, a, b, c]:
  1 SLEEP (клетка покоя — игра делает блок / вещь и D.free), 2 HIT (скорость удара — звук), 3 LOST (ниже мира); `D.blast(x, y, z, J, r)` —
  толчок Δv = J·f / m (+⅓ вверх; лёгкое летит дальше тяжёлого), будит спящих; `D.pos`, `D.speed`, `D.hash`, `D.setMat(отскок, трение)`.
- Ход: гравитация; по осям Y → X → Z — коробка против клеток (ряд ≤ 2×2), отскок от 2 м/с (бревно 250 ‰, камень 200, кубик 120), трение
  на земле (бревно 0,12, камень 0,3, кубик 0,45; катится вниз — только качение). Правило земли раз в такт: центр над пустотой — переваливается
  от опоры (край обрыва); иначе `DB.slope` (общее — для вещей игры тоже): высоты 4 соседних столбиков (−3…+2), склон только если с той
  стороны НИЖЕ (у подножия стены — не склон): круглое (roll ≥ 500 — бревно, камень, вещь) катится при перепаде ≥ 2 на 2 клетки (лестница
  45°), кубик — ≥ 3 (край обрыва); ускорение g·sin·(5/7 круглое, ½ кубик). Тихо 0,5 с — SLEEP; 30 с в полёте — засыпает где есть.
- События — буфер 4N: SLEEP / LOST ≤ 1 на кусок за такт, HIT — не больше 3N (лишние удары без звука; буфер не переполняется).
- Бюджет — чтения клеток за такт (кусок ≤ 68); не влез — ждёт такт (не теряется). Мусор — 0 Б за такт (после прогрева JIT); номера клеток —
  int32, иначе обработчик мира получает «кучные» числа и мусорит при нескольких мирах (проверено).
- Цифры (debris-test, 24): падение с 10 клеток — удар на 28-м такте (√(2h/g) = 28,6); бревно скатилось с 7 ступеней на 6 клеток за
  подножие; кубик на той же лестнице стоит; кубик у края обрыва 6 — внизу, центром над обрывом — перевалился, в клетке от края — стоит;
  толчок 40 кг × 8 м/с: 40 кг улетело на 5 клеток, 2 400 кг — на 1; 30 / 60 / 144 кадров — тот же ход (хеш 3915467009); 64 куска —
  12 мкс на такт, мусор 0 Б; бюджет 200 чтений — отложено 723 шага, все 40 легли.
- Общий потолок §5.x на сайте (KT.CEIL = 6 144 операций за такт мира, kubomir-topple.js): постройки (проверки этажей, тела в полёте,
  «легло» × 4) — первыми, обломкам — остаток (не меньше KD.FLOOR 256, не больше KD.READS 1 024); строка окна 20 тактов —
  st.topple.stats.ceilLine / ceil / ceilMax. ИИ мобов в этот счёт пока не входит (у него свой бюджет).
- Chrome (телефон ×4, «средняя», «Кубомир»): такт обломков — медиана худшего за круг 1,9–2,6 мс (макс. 4,4) при 16–20 кусках; A/B
  на одной странице — ЦП кадра с обломками и без одинаков (12,9 мс); 10 мин игры — 0 ошибок, потолок — худшее окно 2 348 из 6 144.
- Игры: «Кубомир» — kubomir-debris.js (docs/areas/kubomir.md). Подземье / Студия / Мир / d37-core — позже (то же ядро). Тест —
  `node --expose-gc scripts/debris-test.cjs` (в ci-run).

## 🔥 Огонь — D37E.fire (js/engine/fire.js; T-022d, 22.10.2026, GAMES_VER 135; docs/PHYSICS_PLAN.md §4)
- Владелец: «огонь — особенностью движка, во все игры». ОДНО ядро без Three.js: FI.grid (клетки 2D/3D) и FI.parts (детали); материалы
  FI.MATS (wood, planks, leaves, grass, turf, cloth, fuel, char, flame, tree; моды — FI.defineMat); такты по шагам игры, бюджет за такт,
  случайность — хеш места и номера такта (у деталей — ключ по координатам, не номер: у игроков с другим порядком деталей пожар тот же),
  без мусора за такт; save/load продолжает ровно; 2D — ещё «жар через клетку» (срез мира). Ветер и дождь — от погоды игры.
- Горючесть — ТОЛЬКО по полям блока (новые блоки модов и деревьев T-022b горят сами): «Кубомир» V.burnOf(b) — burn, liquid, emit, glass,
  shape, foliage, layer, tint, sound, axis, bounce; «Подземье» PZFire.burnOf — поле плитки burn, P.EMIS/LR/LG/LB, LEAFY, KIND, TOOL, SUP,
  CLIMB, HARD, GROUP (группа досок), GRASSY. Поле burn главнее ('none' — не горит). Сгоревший ствол — путём топора (ents.fellTree /
  fellTree), сгоревшая опора — обрушение своим путём (D37E.support).
- Картинка — fx.js FX.flames (языки шейдером, дрожь воздуха, дым, угли, лампы R.lights; смешивание «поверх с подсветкой»), одна на игру.
- «Кубомир» (kubomir-fire.js): блоки в конце списка после 'bed' — 'fire', 'charred_planks'; вещь 'flint_steel' (Огниво, после
  'bucket_lava'; iron_ingot + flint); meta.fire 'spread' (при создании; «реализм» — вкл; старые миры — выкл; ⚙️ «🧊 Кубомир»),
  meta.fireState; вместе — считает хозяин. «Подземье» (podzem-fire.js): плитка 49 'charwood', вещь 'firestarter' (bar_iron + stone),
  W.fire / W.fireState; свет очагов — одним заливом (dynFillN), пока горит — пересчёт не чаще раза в 3 кадра. «Мир» (mir-fire.js):
  только боевая зона, событие {k:'fire', x, y, z, r, s, t}, догорело — DS.breakId без рассылки. «Студия 3D» (studio3d-fire.js):
  свойства burn / fire (SAVE), onfire (NET_EXTRA; 9 — вечный), Fire.* в JS / Lua / C# / Java.
- Откат одной строкой: KubomirFire.ON, PZFire.ON, MirFire.ON, ON в studio3d-fire.js. Проверки: fire-test, podzem-fire-test,
  mir-fire-test, studio-fire-test, kubomir-hand-test §13; Chrome — kubomir-e2e KB_MODE=fire / firecycle (KB_FIRE=1 — soak / reopen),
  podzem-fire-e2e [perf|look|reopen|soak], studio-fire-e2e, world-perf … fire.

## 🌳 Деревья пород — D37E.trees (js/engine/trees.js + trees3d.js; T-022b, 22.10.2026; docs/PHYSICS_PLAN.md §2)
- Владелец: «деревья как в модах — реалистичные стволы», «можно будет применять в разных играх». ОДНО ядро без three.js (окно, поток,
  node; TR.code — текст модуля для потоков из строки): породы TR.SPECIES — данные (oak, birch, spruce, pine, acacia, willow, tropical, dead,
  giant_oak, giant_spruce) → TR.grow(порода, зерно, { g — рост .12…1 }) → скелет (segs по 11 чисел, blobs по 8, hang по 5; только + − × ÷
  floor sqrt, свои sin/cos/pw — до бита везде). Переходники: TR.voxels (0 листва / 1 тонкая ветка / 2 бревно / 3 корень + ось; толщина
  .7…1,05 — ось на углу клетки = ствол 2×2), TR.cells2d ({ style: 'side' } — как в Террарии), TR.mesh (кора трубами, листва облаками, lod 0…2), TR.cut.
- ФОРМА — ЧАСТЬ СОХРАНЁННЫХ МИРОВ («Кубомир» v3, «Подземье» trees 3: несохранённые чанки строятся заново по зерну): grow / voxels /
  cells2d и числа пород не трогать — только новой версией мира со своей веткой (trees-test сверяет CHECK и CHECK2D). Новая порода — в конец
  SPECIES (номер по порядку входит в зерно). Сетку TR.mesh менять можно (не хранится).
- «Кубомир»: genVer 3 — только новые миры (KB_GEN в kubomir.js; откат — 2); v1/v2 — блоки как были. Порода по биому — pick3 / TREE_P3
  (густота) в voxel-gen.js; дерево целиком через границу чанка (treeVox, кэш G.tc ≤ 1500; дальше 15 блоков от ствола нельзя). Новые блоки —
  в КОНЦЕ реестра (после bed): log/leaves/planks/sapling _acacia и _jungle, leaves_willow, sapling_willow, log_<oak|birch|spruce|acacia|jungle>_thin
  (форма SHAPE.branch 9: стержень по оси + «руки» к соседям, V.BRANCH_W). Поле блока tree ('log' | 'thin' | 'leaves' | 'sapling') и decid
  (листва опадает) — у всех брёвен, листвы, ростков, и старых → V.T.tree (1…4) / V.T.decid: огонь, рубка, рост узнают дерево по ним, не по имени.
- Рубка — ents.fellTree = X.fellAt(x, y, z, by) (пустая клетка — можно: сгорело бревно): кусок над срезом и по 4 сторонам; своя листва —
  обход от всех брёвен рядом (своё ближе чужого, ≤ 2400), великан — целиком; вместе — хозяин. Ростки — X.grow (meta.grow ≤ 400, по meta.gt:
  молодое через 4–8 мин игры, взрослое ещё через 8–16; только хозяин). Зима — V.shedLeaves в потоке ДО света (доля голых 0 / .3 / .55 / .72).
- «Мир Денчика»: worldmap.js (TREES_3D; откат — false) — те же места и зерно, 5 видов экземплярами вблизи (вызов на вид) + 2 простых вдали; ветер
  R.wave, зима — D37_BARE. Разрушения: ствол ломается по месту удара (высота — младшие 6 бит зерна 'brk'), пень стоит, падает верх (TR.cut).
  trees3d.js — геометрии на рендерер (WeakMap; закрыл мир — release), E.prefabs.tree_<порода>. «Студия 3D» — studio3d-trees.js (studioExt:
  «🌳 Деревья» в ➕ Деталь, порода, «🎲 Другое дерево» — obj.seed, в NET_EXTRA). Деревья столицы и городов — прежние R.prefab 'tree' / 'pine'.
- «Подземье»: новые миры w.trees = 3 (PZ_TREES в podzem.js; откат — false): на местах прежних деревьев, порода по биому, клетки — cells2d side
  (кэш 2000); рубка — fellTree3 (всё выше среза по клеткам своего дерева, G.gen.treeAt).
- Замеры (профиль телефона 412×915, ЦП ×4, «средняя»; 3 прогона «до/после» по очереди): «Кубомир» — ЦП кадра в лесу 11,1 → 11,0 мс,
  ели сверху 10,9 → 9,6, равнина 9,4 → 8,9, лес сверху (великаны) 11,8 → 13,8 (лучший 11,7 → 12,0); вызовов на чанк столько же (2,1–2,3),
  квадратов на чанк +9…21 %; генерация чанка (ЦП ×4) v2 4,0 → v3 4,5 мс, поток (ПК) 2,6 → 3,5 мс + сетка 6,8 → 7,6 мс; память JS +8 МБ
  (94,6 → 102,8). «Мир Денчика» — вызовов 59 → 62, треугольников 113 → 152 тыс., ЦП кадра 7,3 → 7,4 мс, пересадка деревьев у камеры
  5,7 → 0,7 мс, пролёт p95 24 → 18 мс. «Подземье» — чанк 17,1 → 16,7 мс (node), кадр не меняется (картинка чанка от содержимого не зависит).
  20 раз закрыть/открыть: «Кубомир» 109,6 → 113,7 МБ, «Мир» (каждый раз в лесу) 15,4 → 18,1 МБ (+0,05 на круг, прошлых миров 0); 10 мин
  игры: «Кубомир» 62 дерева упало, 107 ростков выросло, «Мир» 43 удара, 6 км пролёта — 0 ошибок, память не растёт.
- Тесты: trees-test (42), kubomir-hand-test (деревья), destruct-test, worldmap-test; Chrome — scripts/trees-e2e.cjs (kb-shots, kb-gallery, kb-perf,
  kb-reopen, kb-soak, mir-shots, mir-perf, mir-replant, mir-soak, mir-tank, studio, pz-shots, pz-perf — шумный: подгрузка чанков; SITE_DIR —
  копия «до»), world-reopen-e2e с REOPEN_FOREST=1 (каждый круг в лесу); «Подземье» с деревьями в node — podzem-sim { pre: ['js/engine/trees.js'] }.

## ⛰ Terrain core T1 — D37E.terra (T-111, W1, 29.10.2026; plan E:\d37-core\spec\PLAN.md; crate E:\d37-terrain)
- Source of truth: Rust crate `E:\d37-terrain` (derived from the owner's native_core: same formulas, seeds, 32³ blocks, edits
  `[x, y, z, r, mode]`). f64 with IEEE basic ops only → `js/engine/terra.wasm` (53 KB), the DLL and the JS port
  `js/engine/terra-core.js` are BIT-IDENTICAL; `scripts/terra-golden.txt` (Rust `cargo run --bin golden`) is checked by
  `node scripts/terra-test.cjs` (CI). Change a formula → change src/lib.rs AND terra-core.js in the same order of operations, then
  `build.ps1 -Site <site>` (copies wasm + golden). Output is chunk-local (positions relative to cx*32, cy*32, cz*32).
- Files: terra-core.js (core + wasm loader), terra-worker.js (wasm in workers, self-test, JS fallback on load error or trap, messages
  before init are queued, buffer pool), terra.js (rings, column probes `t1_column`, ≤ 2 jobs per worker, edits quantized to 1/64 m and
  applied in order, affected blocks rebuilt first, `ground()` / `blocked()` from the shown mesh — cave floors, `ray()`; an edited block —
  from the density field at the edit's tick until its re-mesh is shown, T-145 review TECH-3, rollback `editDensity: false`), terra-mesh.js (pooled
  geometries, one shared index buffer — detach it before `dispose()`, sRGB→linear vertex colours in the vertex shader, anchor),
  js/games/terra-demo.js (hidden /play/terra; `D37E.terra.ON` — rollback; `localStorage d37_terra_wasm = '0'` forces the JS core).
  Units: core = meters; the game converts with U = E.UNIT; the floating anchor (multiple of 32 m) moves only in the logic step.
- Physics = the SHOWN mesh (review fix 29.10): at TS.recycle (terra-mesh showed the block) the block's triangles become its physics
  (Uint16 copy packed by the worker after the mesh: buffer = q·104 B, T1.physPack; xz index 34×34 built on first query). TS.ground =
  highest floor under yRef+1.1 on the vertical line; facing by parity from the open sky (column hmax + fills) — per-quad normals are
  unreliable on near-vertical faces. Block not shown yet → the old density path (TS.densityGround). |ground − mesh| ≤ 7 mm (was up
  to 0.4 m at craters, 8.3 m at river banks). Phys hooks, opt-in (other games unchanged): ph.terrain.col (terrain hits are grippable),
  .blocked(x, z, y0, y1, r) (stand/mantle room), .normal(x, y, z, out, dx, dy, dz) (field normal; horizontal rays → the face 0.3 m
  lower). Parkour then works on steep faces (river banks); dig/fill spheres at 1 m Surface Nets are ≤ ~55° cones — no ledge there.
- Edits are bucketed by 32 m cell (EB): TS.ray / TS.solid / column probes read one cell's edits (sign-exact; 5040 edits: 0.21 ms per ray
  vs 1.4 ms over all edits). TS.density stays the core's exact point density (all edits).
- Pitfalls: a URL handed to a worker must be absolute and resolved against `document.baseURI` (real addresses /play/… + `<base href="/">`;
  `location.href` gave /play/js/… → 404 → silent JS fallback). Chrome CPU throttling does NOT slow workers (worker ms = desktop).
  A stalled terra.wasm download → JS core after 6 s (init `wasmMs`). terra-e2e leak FAILS on heap +6 MB (LEAK_MB), live workers,
  changed three.js counts or console errors (heap = least of 3 GC'd samples — one sample right after a close was noisy ±28 MB).
- Tests: terra-test (golden, edit re-mesh, worker protocol in worker_threads incl. stalled wasm, ground == drawn mesh at craters /
  fills / banks, parkour hooks, edit buckets, wasm vs JS timing); Chrome: `node scripts/terra-e2e.cjs perf | leak [N] | soak [min] |
  shots` (PC=1 — desktop). C# (Unity) binding + managed port + tests: E:\d37-terrain\csharp, contract E:\d37-terrain\spec\API.md.

## 🌍 T-145 track L — new land tails (T-115) and logical biomes (T-116), 29.10.2026 (branch t145-land)
- Also merged here: the T-111 review fixes (d62cbfe, physics = drawn mesh, Phys terrain hooks, edit buckets) — they had never
  reached main (main had merged the earlier f3535dd).
- T1 core ABI 2 (E:\d37-terrain 12414bc, spec/API.md §3a): generator v2 (logical climate → Whittaker; biomes 11 Steppe, 12 Jungle),
  world rules (0 earth, 1 mono, 2 patchwork, 3 absurd islands, 4 inverted), flatten edits (mode 2). Heights unchanged — only the
  surface colour differs between v1 and v2. wasm == JS == DLL == C# bit for bit (golden G 200, R 72, Q2 50). terra.js:
  create({ gen, rules, param, compact }), TS.flatten / TS.climate / TS.ceiling; workers get gen/rules in init and re-apply them
  after a JS fallback; inverted worlds route edits through the mirrored test (TE.touchesW).
- D37E.biomes (js/engine/biomes.js, new, English): one API for T1 and Kubomir v4 — at(src, x, z) → biome, class (climate_classes.csv
  integers), surface bits, ts / tp / m, tempC; region(src, x, z, cell) → integer record { ck, cls, smask, F, alt } (BIOME_WEATHER
  §1.2, five fixed samples); climateKey / climateAtFn (climate.js keys for C.world({ climateAt })); PRESETS (strange worlds as data,
  mirror of E:\d37-terrain\data\world_presets.json). This is the name agreed for the weather track (T-135).
- /play/terra flags (js/games/terra-demo.js, one-line rollbacks): TERRA_GEN = 2 (logical biomes; HUD shows the biome and °C),
  SEA_TILES (sea = 32 m tiles over columns whose own terrain is below 0 — a pit on land stays dry; coast / river columns keep water),
  CAM_CLIMB (camera rig option `climb`: in a crater the rig searches, every 0.2 s with 3 rays, a steeper pitch with a clear line
  and eases into it — not into the back of the head), COMPACT (blocks as u16 positions = the physics numbers, octahedral normals u8×2,
  rgb: 44 B per quad on the page and GPU instead of 80 B geometry + 24 B physics; TS.recycle(b, meshPosArray) — the physics reads
  the mesh's own array). Tool «▭ Выровнять» (flatten pad r 6 m at the hit point). Phys: opt-in `terrain.ceiling(x, z, y)` — a jump
  stops at a cave roof / overhang / fill (the DRAWN roof), walking under a roof lower than the head is blocked, crouching passes.
- Tests: terra-test (+ compact block, compact physics == old, pad within 0.015 m, roofs = drawn mesh, Phys ceiling), biomes-test
  (new, in ci-run), Rust `cargo test` (v2 adjacency / distance / patches / column == point / inverted mirror / flatten / 0 allocations
  for every rule), C# tests. Chrome: `node scripts/terra-e2e.cjs t145` (phone ×4: biome, inland crater stays dry, camera climb on/off,
  flatten pad level; Page.setDownloadBehavior deny).
- Numbers 29.10 (Chrome headless, phone 412×915×2, CPU ×4, «mid», before = 2412cc0 / after, machine shared with other agents):
  wasm walk frame CPU 4.68 → 3.26 ms (p95 9.3 → 5.0), fly 4.10 → 4.37 ms (p95 8.6 → 9.5); JS core walk 4.43 → 3.76, fly 4.12 → 4.09;
  worker block 5.3 / 6.3 → 4.9 / 7.2 ms (walk / fly); upload per block 0.50 → 0.48 ms; GPU 37.1 → 20.1 MB; page heap after the run
  77.4 → 46.7 MB (wasm), 125.4 → 66.1 MB (JS). 20× open / close: heap 14.2 → 15.1 MB (flat after 10), workers 0, renderers 1,
  geometries 43, materials 18 — equal; 10 min soak: 287 edits, 11 540 blocks, heap 35–51 MB without growth, 0 errors, 0 fallbacks.
  Crater (inland, 20 m deep, below the sea): no sea tile over it; camera 7.5 m from the head with climb, 3.1 m without. Flatten pad
  r 6 m: ground inside within 0.001 m in Chrome (0.015 m in node). SSAO angle bias (post.js AO_ANGLE 0.2, rollback 0): AO darkening
  on open terrain at «high» −40…50 % (mean 3.7 → 2.2 %, 1.2 → 0.6 %, 2.0 → 1.2 % in three close-ups); the bands themselves did not
  show in headless shots — check on a real phone.

## 🧠 AI LOD P1 — «ум толпы» on the site (T-127, 29.10.2026, GAMES_VER 148, review fixes 149; spec E:\d37-core\spec\AI_LOD.md §10.2, §12 P1)
- Owner decisions (docs/progress.md 29.10): D1 Horde — one enemy cap for every device; D4 Mir — the same 16 residents on phone
  and PC, phones draw the extra ones as simple figures; D5 Studio survival — ≤ 64 zombies alive at once across waves.
- `js/engine/shash.js` (D37E.shash, new, loaded before npc.js / horde.js in GAMES scripts): one uniform grid on typed arrays,
  rebuilt per step (`clear` / `add(x, y, ref, tag, rad)`), queries `cand` / `query` / `knear` / `touching` / `pairs` (each touching
  pair once: own cell + 4 forward cells; cell ≥ 2 × the largest radius; a forward cell farther than r + maxR is skipped — same
  pairs, ~23 instead of ~33 checks per call). No garbage after the first growth.
- `js/engine/npc.js` (flag `LOD`, rollback `const LOD = false`): brain state in typed arrays (SoA, slot `e.i`), think (nearest
  player, new wander target) every 8 steps in the least-loaded phase (64 NPCs → 8 per phase), steering / contact / facing every
  step; per-NPC mulberry32 stream seeded by FNV-1a(seed || id) — no Math.random; player.js bodies from a pool (≤ 64; `wake`
  reuses, `remove` / `stop` return); B3 sleep — idle + grounded + not on a rigid body + speed < 0.02 for 30 steps → no body
  update; wakes on a move intent, a push (velocity), leaving the ground, or a collider change near it (`ph.watch`, unwatched on
  stop / dispose; without `ph.watch` nobody sleeps). `N.stats()` → { n, awake, asleep, pool, phases }. Public API unchanged
  (N.list entries keep o / P / key / near).
- 0 garbage per step, awake bodies included (review #4). `Math.hypot` → `hyp = sqrt(x² + y²)` in the hot paths (sqrt is correctly
  rounded on every engine). The review found where awake bodies really allocated (200–290 B per NPC per step; the old "field
  representation Any" note was wrong — %DebugPrint in a release build prints "Any" for every field, the double fields are fine):
  `Set.clear()` on an empty trigger set (V8 allocates a new table), doubles passed as arguments to calls V8 did not inline
  (fall → _support → query, circleHit / inside, ph.move's speed, angTo), `list.length = 0` on the query lists (V8 frees the backing
  store, the next push allocates again), step / land event objects built for nobody, a `number | null` local in npc.js. Fixes:
  physics queries read their area from fields (`_b0…_b3`, circle `_cx / _cz / _cr`, `_supportQ`, `circleHitQ` / `insideQ` read
  `CQ`), internal query lists are written from 0 and never shrunk (count `_qn`, busy flag per slot, `_qr` releases), `ph.move(ch,
  dt, wish × speed, 1)`, the body turn inlined, `E.emitter().has(e)` — player.js builds 'step' / 'land' only when someone listens.
  Same results to the bit (digests unchanged). Measure garbage in the MAIN context with a big young generation (`node --expose-gc
  --min-semi-space-size=64 --max-semi-space-size=64`): in a vm context `Math` is looked up through the sandbox, V8 cannot inline
  Math.* and boxes every result; with the default young generation a scavenge inside the window hides the garbage.
- `js/engine/actors.js` V2 figures: `A.impostors({ cap, far, focus })` — actors added with `{ npc: true }` (npc.js does it) get a
  full rig only for the `cap` nearest to the camera (or to `focus()` — Studio passes its own player for top-down views) within `far` (4 m bonus for an existing rig — no flip-flop); the rest are simple
  figures (legs / torso / head in the human's colours, `World3D.impColors`) drawn by three shared InstancedMesh (3 draw calls for
  all, instanceColor created before the first render, frustumCulled off, disposed in `A.dispose`). A new NPC starts as a figure (no K.build), ≤ 1 rig build per 0.25 s pass.
  Figures are filled nearest-first (the `tiers` order) and the buffer grows 128 → 1 024 by doubling (review #3: the 129th figure
  and later were never drawn — zombies next to the player could be invisible); a removed actor leaves the figures at once.
  `A.tierOf(key)` → V0 / V1 / V2, `A.impCount()`.
- Mir (`mir-zones.js npcCaps`, rollback `MIR_LOD = false`): NPC_CAP 16 / RES_CAP 7 / NPC_ADD 2 on every device; RIG_CAP 8 phone or
  «low», 16 PC, RIG_FAR 56; `npcTick` reuses its rows (no arrays per tick), `npcPick` is the pure choice.
- Horde (`horde.js`, rollback `const LOD = false`): `CAP` 260 for all (coop × 1.25); `SPAWN_R` 600 (spawn / relocation × 1.6 no
  longer from the viewport); the canvas zoom keeps the visible half-diagonal ≤ SPAWN_R − 30 (only a full-screen tall phone zooms
  in, ≈ 1.2× on 412 × 915 — without it enemies would pop in at the top and bottom; the windowed phone canvas is ≤ 1.7 : 1 and does
  not zoom); run seed = FNV-1a(runId) when none is given; separation = touching pairs from the shash (cell 44, ≤ SEP_K 6 per
  enemy, half the enemies per step by id parity with a doubled push) + a boss pass; weapons' `near()` uses the same hash.
  Rules "on screen" (lightning targets, bomb pickup) use one circle `FAIR_R` 420 around the hero (area of a 16 : 9 PC screen), not
  the device's view rectangle (review #2: Robot with bombs, same seed and input, 3 min — phone 2 500 vs PC 2 515 points before,
  2 519 = 2 519 now); rollback LOD = false — the view rectangle.
- Studio 3D survival (`studio3d-play.js`, rollback `Z_LOD = false`): a wave of n queues; ≤ `Z_MAX` 64 alive, 2 spawns per host
  step, the wave is cleared only when alive + queue = 0; positions and looks from E.rng(FNV-1a('zw:' + round + ':' + wave)).
  The queue rides in the host snapshot (`view.zq = [queued, wave, spawned]`); a new host re-seeds the stream, skips 2 draws per
  spawned zombie, and subtracts the ones that came out after a stale snapshot (their number is in the seed `z<round>-<wave>-<i>`)
  — the same zombies as without the host change (review #7: the queued rest was lost).
  Phones / «low»: 16 rigs, the rest figures (`studio3d.js`, own rollback `S3_IMP = false`, review #6).
- Tests (in ci-run): `npc-lod-test` (digest 30 / 60 / 144 FPS, no Math.random, phases, sleep / push / floor removed, pool, rollback,
  shash vs brute force; garbage: a child process with the engine in the main context — 200 sleepers, 64 chasing zombies, 64
  wanderers among 40 boxes, each < 64 B per step and 0 GC, best of 3 windows after 3 600 steps; it was flaky before, 5 of 14 runs),
  `horde-lod-test` (one cap / radius, the same run at 30 / 60 / 144 FPS and on phone / wide PC, Robot + bombs phone = PC, bomb
  kills the same enemies, no Math.random, crowd spreads better than the old in-cell pairs, near-linear 1 000 vs 260, rollback),
  `studio-waves-test` (fake studio: 7 waves, 64 alive + queue, same seeds twice, rollback = 30, host change mid-wave from a stale
  snapshot → the same 80, S3_IMP), `mir-npc-lod-test` (caps equal, the same 16 chosen, 8 rigs + 8 figures on phone, ≤ 1 build per
  frame, rollback; figures with a THREE stub: 144 of 144 drawn, near zombies always, 1 024 cap nearest-first, removal). Bench:
  `node --expose-gc scripts/ailod-bench.cjs` (its gc / B per step columns include JIT warm-up — use npc-lod-test for garbage);
  Chrome phone ×4: `node scripts/ailod-e2e.cjs mir,horde,studio phone` (SITE_DIR / D37_OVERRIDE for the "before" column).
- Numbers after the review (29.10 evening; node 24 desktop, render stubbed, p95 ms per 60 Hz step, two alternating runs against a
  clean export of 64033ac; phone reference ≈ × 4). npc.js residents (wander, Mir-like) N 16 / 64 / 260 / 1 000: before 0.03–0.05 /
  0.11–0.18 / 0.29–0.44 / 0.93–1.75 → after 0.015–0.027 / 0.04–0.08 / 0.20 / 0.32 (466 of 1 000 asleep); zombies (follow + bite,
  Studio-like): 0.03–0.04 / 0.11–0.14 / 0.25–0.34 / 0.72–2.3 → 0.02–0.04 / 0.02–0.08 / 0.13–0.15 / 0.36–0.63. Garbage per step
  (main context, 64 MB young generation, steady state): 64 zombies 19–41 KB before T-127, 13 KB at fc32513, 0–3 B now; 64
  wanderers 15–37 KB / 7.2 KB / 0–4 B; 260 wanderers among 40 boxes 32–64 KB / 28–41 KB / 0–3 B; 200 sleepers 25–46 KB / 290 B /
  0–2 B. Horde (crowd held, no weapons) p50 170 / 260 / 1 000: before 0.022–0.025 / 0.029–0.035 / 0.15–0.18 → after 0.026–0.029 /
  0.045–0.046 / 0.18–0.20; real run at 260: 0.029–0.043 → 0.056–0.061 (the separation now also works across cell borders —
  deep overlaps at 260: 46 vs 101, at 1 000: 414 vs 619; the review's ×2 became ×1.4–1.6 with the forward-cell skip). The first
  "before" column in this file (0.06–0.07 / 0.33–0.42) was about ×2 too high. Heap per step at 260: 12.4 KB → 2.7 KB.
  Chrome phone 412 × 915, CPU × 4, «mid» (scripts/ailod-e2e.cjs; render.js CPU ms per frame). Absolute numbers on this PC drift
  ± 50 % between runs (other sessions share the CPU), so only a same-session A/B decides. Review A/B (pre-review fc32513 vs after,
  alternating, 2 runs each): Horde late wave at 260 — main-thread task 5.1–8.4 vs 5.6–8.5 ms per frame, frame p50 7.5 both, p95
  8.0–15.2 vs 8.1–15.5 (no difference; D1 = 260 holds); Studio wave 6 (64 alive, 48 figures) — 10.4–12.6 vs 8.8–14.8 ms, NPC step
  0.175–0.18 vs 0.12–0.19 ms; Mir Big City — 9.3–17.3 vs 12.3–16.1 ms, NPC step 0.023–0.037 vs 0.029–0.033 ms. First pass (before
  T-127 vs fc32513): Mir Big City NPC step 0.16–0.19 → 0.015–0.025 ms; Studio wave 6: 30 alive (old cap) 14–25 ms, 479–587 calls →
  64 alive 8.5–14 ms, ≈ 320 calls; A/B at 64: figures off 34.1 ms / 1 174 calls, on 14.0 / 328.
  20 × open / close (world-reopen-e2e, phone × 4) after the review fixes: Mir heap 14.3 → 17.6 MB, Studio 10.1 → 11.8 MB, 0.03 MB per
  cycle, listeners / intervals / rAF / workers / WebGL contexts / DOM nodes equal, no exceptions — 0 FAIL (PC by the builder: same).
