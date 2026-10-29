<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## «Студия 3D» (#/games/studio3d, js/games/studio3d.js) — свой 3D-мир как в Roblox Studio
- Владелец 13.10.2026: «предметы ставить легче, освещение, текстуры, траву, землю, объекты и вкладывать в них скрипты как в рб».
  Окно — поверх сайта (.s3, классы s3-*): Проводник (дерево, перетаскивание = в модель), Свойства, Вывод, редактор скрипта.
  Камера: ПКМ — осмотреться, WASD/QE — лететь, F — к выбранному; 1–4 — выбор/двигать/размер/вращать; Ctrl+Z/Y/D/S, Delete.
  Несколько: Ctrl/Shift + клик (стрелки двигают и крутят группу вокруг вертикали — G.target.group, moveBy/turnAround), Ctrl+A,
  Ctrl+C/X/V (буфер d37_s3_clip — и в другой мир), Ctrl+G / Ctrl+U — группа в модель и обратно; клик по детали модели выбирает
  всю модель (Alt — деталь); 🔒 locked — не выбирается кликом в мире; поиск по имени над Проводником.
  «Касание — без кода» (свойство touch у детали/модели): 💀 kill, 🦘 bounce, ⚡ speed (×1,8 на 3 с), 💰 coin (+1 «Монеты», исчезает),
  🏁 finish (время + конфетти) — studio3d touchAct; несколько точек появления — чекпоинты (коснулся — там и возрождаешься).
- NPC (js/engine/npc.js, класс сцены NPC; SC.npc = D37E.npcs(R, phys)): свои человечки (actors) и «мозги» на том же player.js
  (ступеньки, стены, вода): act idle (смотрит на игрока) / wander (radius) / follow / flee, speed, damage (урон в секунду при
  касании — зомби подходит вплотную), text (облачко над головой при подходе, не чаще раза в 8 с); look: random по seed, me, zombie,
  robot, alien, fairy (кожа tone). ➕ Деталь → «🧍 Персонажи»: прохожий, торговец, зомби, пугливый, робот-спутник.
- Физика деталей (js/engine/rigid.js + Rapier, агент 13.10.2026): незакреплённые детали (anchored: false) — настоящие твёрдые тела.
  Rapier @dimforge/rapier3d-compat 0.19.3 (Apache-2.0, ≈0,6 МБ brotli) грузится с jsDelivr только если такие детали есть (studio:
  заранее при ▶ и при снятии «Закреплена»); пока грузится — простое падение. SC.step сам создаёт SC.rigid; «Стоп» → SC.fromJSON его
  закрывает. Статика зеркалится из Phys (точная форма деталей), рельеф — карта высот, сдвинутая закреплённая деталь — кинематическая.
  Тело Phys детали двигается на месте (c.rb) — игрок стоит/едет/толкает (pushForce 700, вес charMass 15), мелочь пинает, падающее
  ложится на голову. Всё спит и рядом никого — шаг Rapier пропускается. Соединения RG.joint(weld|hinge|ball|rope|spring|slider, a, b, opt).
  physics.js: целые ключи сетки, ph.update / ph.reuse…reuseEnd (в colliders() — на каждом выходе reuseEnd!), ph.watch; Phys.circleHit
  отдаёт ОБЩИЙ объект (копировать, если хранить). Studio: упавшие ниже −200 удаляются (fallen), сдвинутые — скриптам 10 раз/с
  (SH.sync). Тесты: node scripts/physics-test.cjs (85; Rapier: npm install --prefix "%TEMP%/d37-rapier" --ignore-scripts
  @dimforge/rapier3d-compat@0.19.3 или RAPIER_PATH). Проверено в браузере: 24 ящика и мяч падают, кувыркаются, игрок толкает.
- Скрипты на C++ и Rust (js/engine/lang-wasm.js + sdk/, агент 13.10.2026): языки cpp (⚙️) и rust (🦀), kind binary — .wasm (base64)
  в obj.code, исходник в obj.src; исполняет wasmRuntime() в той же песочнице. ABI «d37»: номера i32 (0 — нет/Workspace), строки (адрес,
  длина) UTF-8 с проверкой границ, обработчики — экспорт d37_event(cb, arg), кадр — d37_update(dt) после want_update(1), старт — d37_start().
  Список функций — шапка sdk/d37.h (то же в sdk/d37.rs, тест сверяет); ABI менять только добавлением. Лимиты за вызов: 200 000 обращений,
  5000 команд, 200 строк; 2000 таймеров; 30 ошибок или 256 МБ — скрипт остановлен.
  C++ собирается на сайте («⚙️ Собрать»): @yowasp/clang 22 (ISC; LLVM — Apache-2.0) с jsDelivr, 23,1 МБ brotli один раз (дальше кэш),
  в module Worker; wasm32-wasip1 + libc++ (std::string, vector, printf → «Вывод»), -fno-exceptions, sdk/d37.h через -include; ошибки clang —
  по-русски со строкой. Rust тоже собирается на сайте (владелец 13.10: «чтобы через сайт работал на компе у того кто делает»):
  studio/rust.html + studio/rust-build.js — невидимая рамка (compileRust в lang-wasm.js). Настоящий rustc с LLVM и встроенным
  lld, собранный в wasm32-wasip1-threads (github.com/oligamiq/rust_wasm v0.2.1, MIT/Apache; файлы с его GitHub Pages:
  rustc_opt.wasm.br 19,8 МБ + wasm32-unknown-unknown.tar.br 18,1 МБ → Cache Storage d37-rust-<версия>); потоки и файлы WASI —
  @oligami/browser_wasi_shim-threads 0.5.0 + @bjorn3/browser_wasi_shim 0.4.2, brotli — brotli-dec-wasm (всё с jsDelivr).
  Потокам нужен SharedArrayBuffer → рамке заголовок Document-Isolation-Policy: isolate-and-require-corp (vercel.json; только
  Chrome/Edge/Яндекс 137+ на компьютере, иначе — понятный отказ и «📦 Загрузить .wasm»), студия при этом НЕ изолирована.
  Файлы — один корень «/» (sysroot, work, tmp: rustc заводит /rustcXXXX в корне), SDK sdk/d37.rs подкладывается рядом
  (нет «mod d37» — дописываем в строку 1, номера строк не сдвигаются). Каждая сборка — СВОЙ поток rustc (второй запуск в
  том же библиотека не умеет: «worker request failed: Protocol»), модуль и ферма общие. rustc собран с panic=abort: после
  ошибок в коде он «падает» unreachable — это обычный отказ (ошибки уже в stderr, JSON → по-русски, DICT). Локально
  заголовки ставит scripts/serve.py (launch.json «site»). Проверено 13.10 в браузере: первый раз ~7 с (38 МБ из кэша
  ~1 с), дальше 1–3 с; 6 примеров — 25–30 КБ; ошибки по-русски со строкой и подсказкой; «Монетка» в игре крутится.
  Rust у себя (cargo, sdk/rust-template → «📦 Загрузить .wasm») по-прежнему можно; для людей — sdk/README.md. Тест: node scripts/lang-wasm-test.cjs (110; настоящие clang из %TEMP%/d37-wasm/clang и cargo в профиле;
  D37_SKIP=cpp,rust — без них). Проверено в браузере: «Монетка» на C++ собралась за 6 с (42 КБ) и в игре дала +1.
- Lua (js/engine/lang-lua.js, агент 13.10.2026) — как Luau в Roblox: свой Lua 5.1 + синтаксис Luau (+=, continue, типы, `строки {x}`,
  if-выражения, //, 0b, 1_000) без библиотек: лексер → разбор → перевод в JS, каждая функция Lua — function* (генератор), поэтому
  wait()/task.wait()/coroutine.yield останавливают код сквозь вложенные вызовы. D37E.lang('lua', …), код уходит в песочницу текстом.
  Мост: obj.X — свойство, obj:Метод(a) → obj.Метод(a); массивы JS ↔ таблицы с 1; функция Lua → функция JS (каждый вызов — новая
  сопрограмма); Promise мира (WaitForChild, Event:Wait()) — ожидание. Скрыты constructor/__proto__/prototype и всё на «_». Ошибки
  по-русски со строкой Lua, одинаковая — в «Вывод» не больше 3 раз. Строки — UTF-16 (#"привет" = 6), %a — только латиница.
  Общая песочница runtime() (и для JS): hit.Parent в Touched — персонаж (FindFirstChild("Humanoid"), GetPlayerFromCharacter),
  Folder/IntValue/…Value, ClickDetector, ProximityPrompt (→ события clicked/prompt детали), leaderstats в игроке → таблица очков,
  CFrame, BrickColor, Rotation, CharacterAdded; TopSurface/Locked и т. п. принимаются и ничего не делают (старый код не падает).
  Тест: node scripts/lang-lua-test.cjs (166). Меняешь script.js — прогони и его, и engine-test.cjs. Проверено в браузере 13.10.
- C# (js/engine/lang-cs.js, агент 13.10.2026) — язык cs «C# (как в Unity)»: свой переводчик C# → JavaScript внутри песочницы
  (worker() уходит туда текстом): лексер → парсер → генератор со статическими типами (int-деление, (int) к нулю, float — 7 знаков,
  True/False). Части JS помечены строками C# (карта строк + //# sourceURL=d37cs-N.js) — ошибки перевода и игры с номером строки C#.
  Два стиля: код верхнего уровня (C# 9) с API как в Roblox (part.Touched += (hit, player) => …, Prompt("…").Triggered += …) и классы
  : Script / : MonoBehaviour (Start, Update(dt), OnTouched/OnTriggerEnter, OnClicked, OnPlayerAdded, корутины IEnumerator +
  yield return new WaitForSeconds, Invoke, async/await Task.Delay); transform / gameObject / Destroy / Instantiate / GetComponent<T>()
  своих скриптов; LINQ (методами), HashSet/Queue/Stack, StringBuilder, switch-выражения, кортежи. List<T> = массив JS; методы C#
  (Add, Count, Where, ToUpper…) — на прототипах Array/String внутри песочницы (видны и JS-скриптам). Классы общие для всех C#-скриптов
  запуска (GameManager.Instance). Не поддерживается: from…select, goto, unsafe, record, операторы приведения; Rigidbody/Input/Physics/UI
  Unity — подсказка при переводе. Тест: node scripts/lang-cs-test.cjs (173). Новый член библиотеки — и в таблицу API (тип для
  перевода), и в объект A в boot() (тест сверяет). Проверено в браузере 13.10: MonoBehaviour, корутина, 7/2 = 3, вращение в Update.
- Java (js/engine/lang-java.js, агент 15.10.2026; владелец: «интегрировать джаву … чтобы можно было переносить всё») — язык java
  «☕ Java (как в модах Minecraft)»: свой переводчик Java → JavaScript внутри песочницы (как C#: worker() уходит туда текстом): лексер →
  парсер → генератор со статическими типами; ошибки и перевода, и игры — по-русски со строкой Java (//# sourceURL=d37java-N.js), опечатки —
  «может, length?». Числа ровно как в Java: int — 32 бита (|0, Math.imul), long — BigInt (точные 64 бита, но медленнее int — в горячих
  циклах int/double), float — Math.fround, char — строка из 1 знака ('a' + 1 = 98), печать как Double.toString / Float.toString; порядок
  HashMap/HashSet, Random(seed), String.hashCode, Collections.shuffle — как в Java. Поля объектов — ключи '#имя'; перегрузки — как javac
  (3 фазы). Стили: код верхнего уровня (как JShell / Java 25; переменные верхнего уровня — static-поля неявного класса $Main, лямбды
  могут их менять), public static void main, class X extends Script { start(), update(double dt), onTouched(Part, Player), onClicked(Player),
  onPlayerAdded(Player) … }. wait(сек) / Thread.sleep / TimeUnit.sleep / WaitForChild / Signal.Wait() — функция становится генератором
  (2 прохода перевода) и идёт сопрограммой, и в обработчиках событий тоже; в toString/equals/compareTo… ждать нельзя (SYNC_ONLY). Мир —
  имена как в Roblox, события — .Connect(лямбда); Enum.Material.Neon — мир, а не java.lang.Enum. Лямбда, отданная миру, — через $.js
  (ошибка внутри — со строкой Java). Классы общие для всех Java-скриптов запуска ($.X("Имя"), скрипт ниже — переводится после).
  В переведённом коде BigInt/Math/Number/String — локальные имена ($.JS; такие имена Java-переменных переименовываются — JSRES).
  Не поддерживается: потоки и synchronized, рефлексия, java.io/nio, сеть, Scanner. Отличие: == у Integer сравнивает значения (в Java —
  объекты; всё равно пиши equals). Библиотека — каталог LIBSRC/STUDIO_SRC (строка «Имя<T> : предки | члены») + объекты в boot();
  новый член — в оба места (тест сверяет). Тест: node scripts/lang-java-test.cjs (105). Моды «Кубомира»/«Подземья» на Java (фасад
  Fabric/Forge, крючки загрузчиков) и исследование .jar — НЕ сделаны (владелец 15.10: «только главное» — лимит), план — docs/JAVA.md.
- Расширения студии (13.10): новые инструменты, набор предметов, ИИ-помощник — своими файлами, studio3d.js не трогая:
  window.D37E.studioExt.push({ id, mount(api), unmount(), select(sel, selSet), play(), stop() }) — можно и после открытия студии
  (сразу mount). api: ed (состояние, ed.SC — сцена), slot (место для кнопок в верхней панели .s3-ext), insert, select, setSel,
  selected, pushHist (ДО правки — для «Отменить»), markDirty, refresh, msg, print, setBottom, showCode, playing. В режиме игрока
  (чужой мир по ссылке) расширения не подключаются. Ошибка в расширении студию не роняет (ext() ловит).
- Сеть для миров игроков (js/engine/net.js + net-transport.js, агент 13.10.2026; в студию подключена — см. «Игра по сети» ниже):
  D37E.net.session({ transport, scene, nick, info, onHost, onPlayer, onGuestEvent, onEvent, onCharacter, onBlob, onReady, onTeleport,
  onCheat }) — хозяин (самый ранний в комнате) считает мир и скрипты, гости рисуют копию и сами ведут своего персонажа. Транспорт —
  D37E.net.room('s3', code, { nick, max }) (канал s3-net-<код>, NetPlay на пару «хозяин — гость», через Supabase — пачкой раз
  в 200 мс) или D37E.net.duel(room, np) для двоих. Объекты: обёртка SC.set/add/remove/reparent + обход раз в секунду, шлются только
  изменившиеся свойства с подтверждениями; рядом — в каждом пакете, далеко — до раза в 2 с; сводка 64 хешей раз в 5 с чинит
  расхождения. Персонажи 15/с напрямую, 5/с через Supabase; хозяин режет скорость (бег × 1,25 + запас), телепорт — только
  разрешённый. Смена хозяина: ушёл — ~0,5 с, завис — 5 с. Гостю нельзя менять реплицируемые объекты (SC.step, скрипты);
  net.close() обязателен. Тест: node scripts/net-test.cjs (161 проверка, ~5 с).
- Игра по сети в студии (studio3d.js поверх net.js, агент 11.10.2026): «👥 Играть с друзьями» в выложенном мире → комната
  #/games/studio3d/play/<мир>/<код> (replaceState — без перезапуска, ссылка — в буфер); «👥 Тест вдвоём» в редакторе →
  #/games/studio3d/join/<код> («↗ Вторая вкладка»; у гостя сцена пустая: объекты — по сети, ландшафт/свет/скрипты/авторы моделей —
  блоком world). До 8 игроков; 9-й по ссылке на мир — играет один, по join — «Комната заполнена». Ключ присутствия — свой на вкладку.
  pl.role: solo / host / guest / wait. Хозяин считает скрипты, NPC, твины, Rapier, касания гостей по проверенным позициям (S.latest +
  sweepTouch); гость — только свой персонаж (смерть/батут/ускорение/чекпоинт — у себя), [E] и клик — sendEvent хозяину (проверяет
  расстояние), события принимает только от хозяина. Команды скриптов гостю (телепорт, WalkSpeed/JumpPower, здоровье, очки) — по сети,
  gui/звуки — всем. NET_EXTRA (touch, model, fit, rate, color2, look, seed, act, speed, radius, damage): новое визуальное свойство класса
  сцены — дописать туда (studio-net-test сверяет DEF/SAVE scene.js). Смена хозяина: скрипты из world заново («👑 Теперь ты хозяин мира»;
  PlayerAdded срабатывает снова, но SH.start(…, { restore }) возвращает очки, обнулённые «при входе»; твины — с нуля); хозяин «уснул» > 5 с — выбран новый, проснувшийся уступает. Стоп/выход/смена адреса →
  mpClose (канал Supabase убран). Гости не толкают незакреплённые детали; плавание чужих видно ходьбой (в снимке нет swim). Тест:
  node scripts/studio-net-test.cjs (48). Проверено двумя вкладками (и после слияния 11.10): гость вошёл, мир пришёл, таблица с 👑.
- Графика движка (batch.js, post.js, perf.js + render.js, агент 13.10.2026): batch.js (E.batcher(SC), в студии ed.B) — детали и
  предметы сливаются по материалу в чанках 48 м (цвет — в вершинах/экземплярах), шары/цилиндры и повторяющиеся сетки — InstancedMesh
  (UV «по метрам» считает шейдер); склеенные вынуты из сцены, матрицы свежие — SC.pick, рамка, стрелки как раньше. Правка → сразу
  отдельно, чанк пересобирается через 400 мс; ed.B.play() — меняющееся в игре и незакреплённое отдельно до ed.B.edit(). Двигать детали —
  только через SC.set (rigid двигает свои незакреплённые сам — они не склеиваются). Свои модели — holder.userData.batchable.
  render.js: R.lights — 8/4/0 настоящих ламп (high/mid/low), число света в шейдерах постоянно, остальным — ореол; тени — по делу
  (R.shadowDirty()), страховка 1,5 с; динамическое разрешение 0,6…1 (E.dynRes); R.bloom(материал) — свечение; R.r.info — за весь кадр;
  R.project и rig.fwd()/right() — ОБЩИЕ объекты (читать сразу). post.js: HDR-буфер, MSAA 4× (high) или FXAA, свечение, sRGB в конце;
  FSR 1 (AMD FidelityFX, MIT; 15.10): кадр меньше холста (динамическое разрешение или режим) → сборка в rtLdr → EASU (12 выборок,
  Ланцош-2 по направлению края) в rtUp размером холста → RCAS (резкость 0,2 ступени) на экран; только WebGL2 (texelFetch).
  Режимы как у DLSS: E.FSR quality .77 / balanced .67 / performance .59, R.setFsr(режим), localStorage d37_fsr, «авто» —
  динамическое разрешение. В мире — кнопка ⚡ FSR (без пересборки). Замер 15.10: резкость кадра 8,7 против 5,8 у растяжения.
  low — без поста. F3 / D37E.perf.toggle(); замер: await D37E.bench.studio(2000) / D37E.bench.world(). Тест: node scripts/render-test.cjs
  <scratchpad/three149/node_modules/three> (74). В браузере (13.10): студия 2000 объектов — 677 → 213 вызовов, ЦП 5,8 → 1,0 мс;
  мир — 143 вызова, 59 FPS, ЦП 1,5 мс.
- Графика v3 (агент движка 15.10.2026; js/engine/gfx.js, post.js, render.js, js/core/gfx-settings.js, js/games/studio3d-gfx.js): небо по
  времени суток — E.skyModel (восход 6, полдень 64°, закат 18; ключи цвета по высоте солнца + свечение Ми + заря; луна напротив солнца,
  звёзды в шейдере купола); купол рисуется последним. Свет: днём солнце, ночью луна, полусфера — цвета неба, отражения — PMREM из купола
  (не чаще раза в 2/4 с). Туман и тени — свои куски шейдеров three (E.gfxPatch, один раз на страницу): туман по расстоянию + высотный +
  тёплый к солнцу; тени — выборки 2×2 с весами по постоянной спирали Фогеля + наклон приёмника по производным (WebGL2) + PCSS-lite
  (E.SHADOW_Q: карта 1024…4096, 4…16 выборок); общие Float32Array E.GFXU (по ссылке
  у всех материалов). Коробка теней сдвинута по взгляду камеры. Вода v2: R.water(цвет, { key, depth: { tex, rect }, fixedColor }) —
  рябь, глубина, пена у берега, френель. SSAO (post.js, WebGL2+HDR, половинное разрешение, поворот — свой у пикселя, размытие —
  2 прохода по плоскости; стрелки и рамки renderOrder ≥ 990 — поверх). Глубина сцены — всегда 24 бита (текстурой). Цвет кадра E.GRADES (Обычный, Яркий, Тёплый, Холодный, Кино, Мягкий, Неон, Ретро, Ч/Б) + виньетка. R.procN — рельеф
  текстур (high), R.fresnel — стекло и лёд. Уровни: low — Ламберт без поста и теней; mid — тени 1024, FXAA, вода v2, туман, цвет,
  свечение; high — тени 2048 + PCSS, SSAO, MSAA 4×, рельеф, дальность 125 %; ultra — тени 4096, сильнее AO, дальность 160 %. «Авто» —
  лесенка E.autoSteps (AO → тени → MSAA → дальность → тени выкл) по времени кадра, по очереди с динамическим разрешением. Экономия
  батареи: 30 кадров, без AO, тени mid, плотность ×1. Лимит FPS — E.fpsCap (core.js).
- Графика мира — R.lighting.gfx (E.worldGfx: sky, fog, grade, bloom, exposure, water, shadow, preset): в файле мира, при «📤 Выложить» и
  гостям в блоке world. Полный объект освещения (time + brightness + fogEnd) СБРАСЫВАЕТ gfx, частичный — дописывает (E.mergeLighting).
  Студия: «🎨 Графика» (studio3d-gfx.js через studioExt) — настроения E.WORLD_PRESETS (Солнечный день, Закат, Ночь, Туманный лес,
  Неон-город) и все поля, «Сутки в игре длятся» (lighting.cycle). «Мир Денчика»: время суток общее для всех — E.dayClock(Date.now(), 40,
  .2) (сутки 40 мин, ночь — пятая часть), пруд v2, под водой — R.setUnder; S.fixedTime — остановить время (для проверок).
- Настройки игрока (⚙️ → «🎨 Графика», gfx-settings.js поверх settings.js): gfxPreset auto/low/mid/high/ultra/custom (тронул мелочь —
  «Своя»), shadows + shadowQ, ao, water, refl, aa, fog, dist, grade, fpsCap, res, battery; старый d37_gfx — «основа» (смена low/mid/high
  пересобирает мир). На живую: D37Opt.gfx → E.gfxResolve → R.applyGfx; настройки игрока — потолок для графики мира (туман выкл —
  без высотного; цвет выкл — без цвета мира; дальность = fogEnd мира × dist игрока). Тест: render-test (162). Замер 15.10: мир mid —
  ЦП ~1,4 мс (как было), high — 1,63 → 1,17 мс при AO+MSAA+PCSS.
- «RTX и генерация кадров» (владелец 15.10; агент движка). НЕ называть свои вещи RTX/DLSS (товарные знаки NVIDIA) — в интерфейсе
  «Трассировка лучей», «Генерация кадров»; NVIDIA — только настоящая: NIS. Всё — post.js / gfx.js / render.js / gfx-settings.js:
  • «Апскейлер: FSR 1 (AMD) / NIS (NVIDIA) / Выкл» + «Разрешение» (Авто, 100 %, 77/67/59 %) + «Резкость». NIS — NVIDIA Image Scaling
    SDK 1.0.3 (MIT, уведомление в post.js): NVScaler (окно 6×6, 4 направления, таблицы 64×6 — E.NIS, сверены с fp16-таблицами NVIDIA)
    и NVSharpen (резкость при 100 %); эталон на JS — scripts/nis-ref.cjs. Замер 1080p: NIS 0,15 мс, NVSharpen 0,05, FSR 0,11.
  • «Трассировка лучей» выкл/вкл/высокая (high/ultra — сами; автокачество снимает первой): отражения в экране (SSR) от воды, стекла,
    льда, металла, гладкого, мокрого пола — код блеска в АЛЬФЕ буфера сцены (gfx.js RT_*, E.rtEncode, только пока рисуется буфер
    трассировки), шаги по пикселям без шума + уточнение делением; контактные тени к солнцу — в проходе AO, размываются по плоскости.
    Мир: lighting.gfx.rt { refl 0…2, wet 0…1 } — студия «🎨 Графика»; «Неон-город» — мокрые улицы. Цена: +0,1…0,3 мс (1080p).
  • «Генерация кадров (×2)» (выкл): настоящий кадр через раз, между ними — прошлый, переложенный под новую камеру по глубине
    (E.FG: 4 шага поиска + второй старт для открывшегося фона; свой персонаж и игроки — R.fgMovers, сдвигаются сами). Резкий
    поворот / прыжок камеры / стрелки студии / смена сцены — настоящий кадр. Промежуточный: видеокарта 0,11 мс (настоящий 1,5),
    ЦП 0,01 мс. Счётчик FPS: «60 (30 настоящих)». Интерфейс сайта (DOM) не трогает.
  • «📸 Фото с трассировкой пути» (⚙️ → Графика → «📸 Снять»; js/engine/pathtrace.js грузится по кнопке): свой трассировщик —
    сцена → треугольники (D37E.ptScene) → BVH (ptBuild: SAH, глубина ≤ 36) → текстуры (ptPack) → шейдер (до 5 отскоков, солнце —
    лучом тени, небо движка, вода/стекло — преломление, вырез травы по альфе). 175–190 тыс. треугольников: BVH 0,4–0,7 с; RTX 5060 Ti,
    кадр 0,54 Мп — ~195 лучей на пиксель в секунду (~0,1 млрд путей/с, C.bench(64)): чисто — за ~5 с, на 4096 — стоп (видеокарта
    отдыхает). Темп — по меткам видеокарты (fenceSync, в работе ≤ 2 порции, иначе очередь команд растёт и страница «замерзает»).
    «💾 Сохранить» — PNG. Пока окно открыто, кадр рисует он (R.photo). three-gpu-pathtracer не подошёл (ES-модуль со своей копией
    three). Блок «Технологии» в ⚙️ → Графика — лицензии FSR 1, NIS, three.js. Тест: render-test (250).
  SSGI (цветной отражённый свет в экране) не делали: без буфера альбедо дешёвый вариант даёт ореолы.
- Телефоны (15.10.2026, владелец: «пятна» у фонтана и на площади — «агент починил?»): глубина в постобработке читалась lowp-
  сэмплером → fp16 → контактные тени и отражения рисовали пятна вблизи. Теперь: highp-сэмплеры (E.POST_PREC, E.SAMPLER_PREC —
  см. «Грабли»); при запуске post.js проверяет глубину (P.depthOK, P.probe: плоскость на глубине 0,9876543 → чтение → ошибка
  < 4e-6; P.prec — бит highp): неточно — AO, трассировка и генерация кадров выключены (gfxResolve dev.depthFx, в ⚙️ — пояснение).
  Телефон (E.isMobile) по умолчанию — «средняя» основа; в «Авто» на телефоне трассировки нет. Тест: render-test (261).
- Трава и листва без AO (16.10.2026, «мерцание у травы» → после отката «чёрной земли» — заново, по-телефонному): вырезанное по
  альфе (кустики mir.js, листья моделей, «Кубомир» — voxel-render.js) пишет в альфу код E.FOLIAGE_A = 1 + 4/1024 (точно в fp16)
  только пока d37Rt.z = 1 (post.js: AO считается и страж не выключил); проход AO с define D37_FOL (textureLod, маска
  умножением) их не считает ни заслонкой, ни затеняемым — без тёмных пятен у кустиков. Блеск (d37Rt.y) — как раньше, только с
  трассировкой. P.setFol(false) — AO собирается без травы (ровно прежний шейдер), P.codesOn() — пишутся ли коды.
- **Страж графики** (post.js E.gfxGuard(R) → R.guard, render.js; 16.10.2026): (1) программа шейдера не собралась (three r149:
  program.diagnostics.runnable === false; r.info.programs — на 2/10/40-м кадре, после смены проходов и раз в 5 с) → проход
  постобработки: выключить только его (трава в AO → AO, трассировка, генерация кадров, NIS, FSR, FXAA, свечение; сборка → без
  постобработки), программа сцены → без своих кусков шейдеров (E.gfxUnpatch; событие d37:gfxfallback { rebuild } — mir.js
  пересобирает мир, студия просит перезапуска) → не помогло → «низкая» (E.gfxQuality); (2) самопроверка кадра P.selfTest (45-й
  кадр, через 15 с, через 1,5 мин, после смены AO/трассировки/травы/свечения): сцена БЕЗ кодов и С кодами — цвет обязан совпасть
  (коды пишут только альфу; так ловится «чёрная земля»), AO — числа и не почти весь чёрный, отражения — числа, сборка не гасит
  яркое; днём весь кадр чёрный (только где темно не бывает: R.guardBlack — «Мир Денчика»; пещеры «Кубомира» — нет) / «не
  числа» в сцене (2 раза) → коды → свои куски → «низкая». Сетка 16×12 точек → RGBA8 → одно
  чтение на проверку (~кадр лишней работы). Решения — localStorage d37_gfx_guard до новой GAMES_VER; ⚙️ → Графика → «🛡 Страж
  графики»: «🩺 Проверить», «↺ Вернуть всё». Сообщает без личных данных: va('event', 'gfx_fallback' { what, why, prog, gpu
  (семейство и модель), q, v }) + цель Метрики gfx_fallback (её можно завести в Метрике: JavaScript-событие); 'gfx_dark' — днём
  тёмная земля (только сообщение). Проверено подменой: «драйвер портит цвет при кодах» (вышла ровно картинка владельца — страж
  выключил коды), AO в ноль, не собрались AO/трава/сборка/FSR/шейдер сцены. Строгий прогон — `node scripts/gfx-strict.cjs
  [swiftshader|vulkan|gl] [high|mid|ultra|auto] [плотность]`: настоящий Chrome (ANGLE не на Direct3D), профиль телефона, «Мир
  Денчика»: все программы собрались, без предупреждений, страж ничего не выключил, кадр не чёрный (16.10 — всё зелёное; правка
  68b0a36 на этих бэкендах тоже рисовала нормально — поломка только у драйвера телефона). Пятый параметр `lose` — ещё и потеря
  контекста WebGL. **Потеря контекста — НЕ поломка шейдеров**: чтение даёт нули, и страж без проверки gl.isContextLost() выключал
  ВСЁ (трава, коды, свои куски, «низкая», набор, AO, свечение, постобработка — навсегда до новой GAMES_VER), а мир пересобирался
  в чёрный кадр (найдено 16.10 на SwiftShader под нагрузкой). Теперь, пока контекст потерян, страж не проверяет, не решает и не
  считает кадры; вернулся — three.js сам всё пересоздаёт, render.js (webglcontextrestored) заново рисует отражения неба и тени
  (тот же мир, кадр как до потери: яркость 187,2 → 187,3).
- **Наборы шейдеров 3D** (16.10.2026, владелец: «сделай шейдеры для нашего движка, чтобы Майн, Террария и другие режимы работали
  красиво»; подробно и API для игр — docs/SHADERS3D.md): ⚙️ → Графика → «Шейдеры» — ключ `shaders` ОБЩИЙ с 2D (shade2d.js;
  `toon` в 2D = «Красивые»), `crt` — полоски у «Ретро». Обычные (= как было, новых программ нет) / Красивые (тон AgX через LUT
  поверх ACES, лучи солнца/луны, облака слоем, заря и звёзды, ветер в траве и листве, вода с каустикой, под водой) / Ультра (+
  ½-кадровые лучи, перистые облака, глубина резкости — автофокус по середине кадра) / Мультяшные (полосы света + контуры) / Ретро (пиксели ×3,
  цвет полосами, CRT). Набор — данные (gfx.js E.PACKS, E.packResolve, E.packLUT, E.packSanitize), всё новое — под define;
  на лету (render.js R.applyPack → post.js P.setPack). «Авто» — как у 2D (по пресету; пресет «Авто» — по устройству, сильный
  телефон — «Красивые»). Страж откатывает набор (`pack:<id>` → предыдущий). Игры: R.wave, R.bloom, R.lights.add, R.water,
  R.packFx, E.FOLIAGE_GLSL. Снимки и замер — E:\claude-tmp\engine\shots (листы sheet-*.jpg). Проверки: render-test (раздел 22),
  gfx-strict с набором. Глубина резкости и наборы целиком — без motion blur и объёмного света по карте теней (пока: лучи по экрану).
  Глубина резкости (T-042, 22.10; владелец: «мыло, будто −6 зрение» → «почини, а не отключай»): только «Ультра» на ПК; фокус —
  медиана 9 глубин середины кадра (проход FOCUS в буфер 1×1 RG8, лог-шкала, плавно τ 0,2 с — E.DOF), от 1-го лица — на то, куда
  смотришь; мягко: резко до 2× фокуса и всё ближе «игровой зоны» (25 м), ближе 0,7 ед. (рука, вещь) — никогда, радиус ≤ 4 точек
  половины кадра. Игра подстраивает R.dofSet = { k (сила, 0 — выкл), zone, dist (ручной фокус) } — «Кубомир» { k .55, zone ¾ дальности (96 блоков при 8 чанках) }.
  ⚙️ «Глубина резкости» (ключ dof, вкл); страж выключает только её ('dof'). Ещё против «мыла»: динамическое разрешение на ПК
  не ниже 85 %, MSAA и при уменьшенном кадре, на «ретине» (плотность > 1,25) MSAA нет и FXAA сверху не кладём.
- Частицы (js/engine/fx.js, объект Effect): огонь, дым, искры, конфетти, снег, дождь, магия, пузыри — пресеты KINDS; один
  эмиттер = один Points (свой шейдер: размер в мире, форма — круг/квадрат/кольцо/звёздочка), до 900 частиц, без мусора на кадр.
  Внутри детали — летит с её верхней грани (at), сам по себе — из pos; rate/scale — множители, свои цвета. Светящиеся (add)
  рисуются поверх дыма (renderOrder 6). На «низкой» графике частиц вдвое меньше. ➕ Деталь → «✨ Эффекты».
- Движок: scene.js (Part/Spawn/Light/Prefab/Model/Script; 21 материал MATS; тела: точно при повороте по Y и шагах 90° по X/Z,
  иначе описанная коробка; незакреплённые падают), gizmo.js (G.snap / G.rsnap — шаг сетки и угла), terrain.js (129×129 на
  192 м, кисти поднять/опустить/сгладить/выровнять/покрасить, 4 материала шейдером, на склонах — камень, вода; ph.terrain),
  physics.js: клин (addWedge, низ у локальной +z; круче ~55° — стена), ландшафт (groundAt, луч), render.js: R.setLighting
  (время суток, солнце/луна, звёзды, туман), R.proc (текстуры кодом: трава, песок, камень, кирпич, снег, рифлёнка, земля).
- Скрипты (script.js) — JavaScript с именами Roblox: script.Parent, Touched/TouchEnded/Clicked, Prompt(текст).Triggered,
  TweenService, Instance.new, Players/PlayerAdded, SetStat/AddStat (таблица очков), Humanoid (WalkSpeed, JumpPower, Health),
  RunService.Heartbeat, task.wait. Песочница: iframe sandbox + CSP без сети → Worker; завис > 3 с — поток убит. Мир меняется
  только командами — studio3d applyCmd/cleanProp проверяет каждую (не больше 4000 за шаг, 3000 объектов). Примеры — EXAMPLES,
  «🤖 Задание для ИИ» — AI_TASK. Номер строки ошибки — lineOf/LINE0 (Chrome «), <anonymous>:N», Firefox «> Function:N»).
- Миры — пока только в браузере: d37_s3_index + d37_s3_<id> (ландшафт gzip+base64; закрыл вкладку — сохраняется без сжатия),
  «📁 → Выгрузить/Загрузить» файл .d37world.json. Шаблоны: площадка, пустой, обби со скриптами, остров. Выкладывать миры
  для всех — ещё нет (план: ugc.sql kind 'place' + модерация, как у «Студии игр»).
- Проверка: `node scripts/engine-test.cjs` (клин, ландшафт, скрипты без браузера) + встроенный браузер (подмена rAF и
  document.hidden, GAME_IMPL.studio3d._test.state()). Проверено мышью: стрелки, размер, поворот; обби: монетка, лава, финиш,
  дверь [E], платформа, крутилка; «■ Стоп» возвращает мир как был.
- Свои модели (владелец 13.10.2026: «загрузить свою, видно только у себя, пока не выложишь и не скомпилируешь»):
  js/engine/model.js — свой разбор .glb / .gltf (+ .bin и картинки, выбранные вместе) / .obj (+ .mtl) без библиотек и сети
  (http-ссылки внутри модели запрещены). «Компиляция»: мир-матрицы узлов, нормали (нет — считаем), полосы → треугольники,
  склейка по материалу, размер: метры × E.UNIT, странный масштаб (< 0,1 или > 70 ед.) — подгон к 4; низ — y = 0; текстуры
  ужимаются до 1024 и перекодируются (jpeg, с прозрачностью — webp). Лимиты: 100 000 треугольников, 8 текстур, 12 МБ.
  Draco/meshopt, FBX — понятная ошибка (FBX → Blender → .glb). Хранилище — IndexedDB «d37e» (видно только автору);
  класс сцены Mesh (как MeshPart: model, pos — центр, size растягивает; тело — fit: precise — коробки по поверхности
  (M.colliders: кубики с точками треугольников → жадная склейка, ужаты до настоящих точек; внутри пусто; домик — 31 коробка)
  или box — одна коробка); геометрии и материалы общие на
  модель. В файл мира модели вкладываются (M.pack/M.unpack — с проверкой длин, номеров вершин, NaN). Меню «🧩 Модели»,
  перетаскивание файла в окно. Тест: `node scripts/model-test.cjs` (38: glb/gltf/obj собираются в самом тесте).
- «📤 Выложить» (нужен ugc.sql): свои модели мира → хранилище ugc3d `models/<автор>/<номер>.json` (файл не перезаписывается:
  изменённая модель = новый номер) + ugc_model_save (на проверку); мир → ugc_save(kind 'place', data = мир + models {номер: автор})
  → ugc_status link/review. Ссылка /g/<id> (api/_lib/routes/ugc.js ведёт в #/games/studio3d/play/<id>). Режим игрока (s3-player):
  без редактора, «🔁 Заново», ❤️, ничего не пишет в «Мои миры»; чужие модели — M.remote (скачивание из хранилища, только
  одобренные — решает RLS хранилища) → IndexedDB с пометкой foreign (не в «Моих моделях»); нет доступа — каркас коробки.
  Больше 40 ламп в чужом мире — лишние без света. Модератору в студии — «🛡» (модели на проверке: 👁 вставить и посмотреть, ✅, ⛔);
  сам 3D-мир на проверке — в общей очереди «Студии игр» (studio/mod). Проверено на подменном сервере в браузере: выложить с
  моделью, открыть по ссылке «другим игроком» (модель скачалась), ❤️, «Заново».

## «Студия 3D»: телефон, геймпад, компьютер, режимы игры, ракурсы, обучение (агент 15.10.2026)
- Владелец: «доработай создание под геймпады, телефоны и ПК, чтобы каждый мог делать режимы, доступно, ракурсы». Расширения (студия
  зовёт крючки extAny/extReduce, ядро — STUDIO_API.core): studio3d-ui.js (раскладка s3-compact / s3-port / s3-land, подсказки внизу —
  сами под клавиатуру/палец/геймпад по D37E.inputKind, шпаргалка «?»/F1, листы s3x-sheet), -touch.js (телефон: панель снизу, «•••
  Ещё», плашка выбранного, 🧲 сетка/угол/«на поверхность»; жесты D37E.gestures: тап, двойной — фокус, долгое — меню, один палец —
  вокруг выбранного, два — сдвиг/щипок/поворот; G.k — крупные ручки), -pad.js (геймпад D37E.padEdit: прицел, Ⓐ выбрать → взять →
  поставить, Ⓑ назад, Ⓧ/Ⓨ инструмент, LB/RB повернуть, крестовина — шаг сетки/угла, ☰ круговое меню, Start — играть), -tools.js
  (Num 7/1/3 — виды сверху/спереди/сбоку (далёкая камера с узким углом, не настоящая орто), Num 5 — обычный; закладки Alt+1…4,
  Alt+Shift — запомнить; M — «на поверхность», End — на землю, R — массив: ряд/столбик/лестница/кольцо/спираль), -modes.js («🎮
  Режим», «🎮 Для игры», свойства team/order/камеры, заготовки new:m-*), -learn.js («Первый мир за 5 минут», d37_s3_learn — только
  новичкам). Стили — css/studio3d-x.css (грузит сама студия, не premium.css).
- Режимы без кода — js/engine/modes.js: Обби, Гонка (круги, чекпоинты), Каждый сам за себя, Команды (2–4), Царь горы, Прятки, Сбор
  монет, Выживание (волны зомби); время, очки, возрождение, отсчёт, раунды, жизни. Модули игры D37E.studioPlay (pplug — работают и в
  чужом мире, и у гостя): studio3d-play.js. Ракурсы — js/engine/views.js: 3-е/1-е лицо, из-за плеча, сверху (2.5D), изометрия, сбоку
  (движение в плоскости), камеры в мире (класс Camera, детали внутри — зоны); переходы плавные, управление по виду. Настройки мира —
  SC.settings { game, camera, age } (сохраняются и выкладываются; «Отменить» не трогает; возраст по умолчанию: бои 12+, остальное 6+).
  Считает хозяин; гостям — событие 'mode' { v } и команды spawn/hurt/say/cam/shake/fx; удар гостя — { cmd: 'atk' } хозяину (проверяет
  дальность и направление); чекпоинт гонки — validTeleport. Удар — действие attack (F, RT, 👊). Скрипты: Game.* (Mode/State/Round/
  TimeLeft, RoundStart/RoundEnd/MatchEnd, AddScore/GetScore/GetTeam/SetTeam/EndRound/StartMatch) и Camera.* (Mode/SetMode/Shake) — в
  JS, Lua и C#. NET_EXTRA += fov, team, order. Тест: node scripts/studio-modes-test.cjs [путь к three@0.149] (178). Проверено мышью:
  все заготовки режимов одному, «Команды» и «Прятки» — вдвоём; на настоящем телефоне/геймпаде/iOS — ещё нет (синтетические события).

## AI3D /tools/3d — our Blender, A1 (T-112, 29.10.2026)
The owner's own 3D editor AI3D (from his package ai3d-mcp: ai3d.html, author — the owner) is a hidden page of the site. Plan: E:\d37-core\spec\PLAN.md
«AI3D = our Blender» (A1 done here; A2–A5 below). Studio 3D stays the game/world editor; AI3D is the asset workshop next to it.
- **Wiring.** Route `ai3d` ↔ address `/tools/3d` (router.js toPath/toHash special case; other /tools/* stay server pages), PAGES.ai3d = `#ai3d-page`
  (`#ai3dRoot`), vercel.json rewrites `/tools/3d`, `/tools/3d/:path+` → index.html + header `X-Robots-Tag: noindex`, sw.js SPA_PATH (VERSION v8),
  ROUTE_META + NOINDEX. Not in sitemap, search palette, menus or footer; hotkeys.js leaves the keyboard to the editor (`D37AI3D.active`) and the
  arrows never page into it. Loader js/apps/apps.js (`D37Apps.open('ai3d')`, VER 5): three r149 build (the same file as js/games/world3d.js; reused
  if a game loaded it), css/ai3d.css, js/apps/ai3d/{ai3d-gltf,ai3d-core,ai3d-ui}.js; leaving the route → `unmount()`.
- **Files.** ai3d-core.js — the owner's script wrapped in `D37AI3DCore.create(host, env)` (body between `/*@ai3d-body*/` markers also runs as a
  plain script in node); his op names and logic unchanged, site changes marked `site:`. ai3d-ui.js — shell: his panel and buttons (ids `a3-*`),
  «🎲 Пример» (the six demo scenes), «📦 В Студию 3D», «🔌 ИИ», WebGL fallback, context-loss notice. ai3d-gltf.js — GLB export + Studio import.
  Dark and light theme (.a3 tokens follow html[data-theme]); the 3D background is `--bg` of `.a3`.
- **Export (fixed).** r149 GLTFExporter (examples/jsm, jsDelivr 0.149.0) fetched, its `import … from 'three'` rewritten to read `window.THREE`,
  loaded from a blob: URL (no second copy of three); r149 call `parse(input, onDone, onError, options)` → real GLB. Export works on a clean copy:
  no userData extras (dog JSON chunk 3.36 MB → 88 KB, GLB 4.4 MB → 1.1 MB; fox 6.3 → 1.5 MB; island 13.8 → 2.6 MB); factors sRGB → linear while
  ColorManagement.legacyMode is on ('#a8754a' → 0.392), COLOR_0 always linear and only when the material uses vertex colours; textures tagged
  sRGB; full-detail geometry (the screen may show LOD copies / culled meshes); outline hulls skipped; TRS nodes; animations kept; the editor's
  geometries are never touched; equal materials are written once (the editor makes one per mesh: dog 41 → 3 glTF materials, so Studio 3D
  compile, which merges parts by glTF material, gives 4 parts instead of 41; fox 56 → 6). «📦 В Студию 3D» = this GLB → `D37E.models.compile` + `save` (IndexedDB «d37e») → «🧩 Модели» in Studio 3D,
  the same path as the photo editor. AI3D itself does not import GLB (OBJ only).
- **Fixed after the first real browser run.** r149 toon gradient (LuminanceFormat failed in WebGL2 texStorage → black gradient, dark anime faces)
  → RGBA; one offscreen renderer for snapshots / reference compare (each call made a new WebGL context); outline program per thickness; LOD
  copies built lazily when a mesh is far, ≤ 1 per frame, freed with their geometry (dog: 73 frames > 50 ms while orbiting → 0); adaptive resolution
  measured the input pace in "draw on changes" mode (phone stuck at 0.6×, a 247×214 canvas) → rAF interval after a rendered frame, CPU-bound
  frames do not lower it (now 2× = 824×716); the geometry cache is pruned after each build, only unused entries above max(60, objects + 20) (it evicted
  in-use ones: two characters re-made every geometry on each run); drawn/painted textures (TEXS) freed when no object, undo/redo
  snapshot or definition refers to them (never freed before: +25 per selftest, soak heap 71 MB after an empty scene); a WebGL context
  restore drops the old three objects and rebuilds (no stale "delete: object does not belong to this context" on close); clear colour set only when the theme changes; undo snapshots capped at ~12M chars (≤ 24 MB) (island JSON is 4 MB; 30 copies = phone crash); no
  `morphTargets` material parameter; ids scoped (`a3-`); bridge images only `data:image/…`; MCP bridge (server.mjs, ws://localhost:3737 or
  `/tools/3d?ws=ws://localhost:PORT`) only on demand and only to this computer; full cleanup on close.
- **Tests.** `node scripts/ai3d-test.cjs <three r149>` (CI, 114 checks): the owner's test.mjs (332) and test-run.mjs (58 rows ok, 15 skipped on
  stubs) from scripts/ai3d/, the body in strict mode on real three r149 (36/36 self-test command rows, selftest() 50/50), the six demos →
  GLB (magic, no extras, colours, COLOR_0, full detail, animations) → r149 GLTFLoader → D37E.models.compile; all 63 ops run (self-test rows
  + demos + scripts/ai3d/ops-extra.json); cache, texture and undo limits. `node scripts/ai3d-e2e.cjs
  smoke|shots|perf|leak [20]|soak [10]|look|retain` (Chrome; smoke is the CI e2e entry). Blender 5.2 headless (E:\claude-tmp\t112\blender\check.py):
  all six GLBs import with the same object/mesh/triangle counts, table top Base Color 0.3916 (linear), fur colour attributes, 1 action per
  animated scene; the browser-exported textured GLB: 15 images in sRGB, 30 shape keys.
- **Numbers (phone 412×915×2, CPU ×4, headless Chrome on a loaded PC; GPU not throttled).** Open: cold 5.5 s (whole site + three from
  the network), in-page 0.47–0.51 s. Demo build: dog 300 ms, fox 307, island 347. Orbit (touch drags), frame CPU p50/p95: table 1.3/2.4 ms,
  dog 2.4/4.0, fox 2.8/4.6, island (78k tris) 1.2/2.3, 0–3 frames > 50 ms; canvas 824×716 (2×); idle — 0 frames (render on demand). JS heap
  9–20 MB. 20 open/close: 0 renderers, 0 WebGL contexts, canvases and window/document listeners as before, heap 7.2 → 9.0 MB (flat from
  cycle 10). Soak 10 min of random ops (920: self-test rows, demos, undo/redo, 66 broken batches, 65 exports, 6 «В Студию 3D», 11 selftests,
  views, play, orbit): 0 errors, every rollback kept the scene, heap 16–58 MB per minute, 17 MB after an empty scene + GC (was 71–112 MB).
- **Next (A2–A5 need).** A2: shared skeleton (spec/BODY.md) — AI3D parts are rigid (no skin); rigAuto + gait clips → bones + skinned glTF;
  D37E model.js has no skin/animation playback yet. A3: colliders/mass/joints → glTF extension D37_physics (AI3D manifestOf has colliders).
  A4: terrain from core T1 instead of AI3D's own value noise; scatter → batch.js instancing, not one merged mesh. A5: command layer like the
  photo editor (D37Tools «d37 v1»: schema per op, per-step undo; AI3D now has whole-state rollback and no ANIM/CON rollback), short guide topics,
  MCP server. Also: inverted-hull outlines do not show
  on hard-edged boxes (face normals) — a classic limitation.
