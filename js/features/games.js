// ═══════════════════════════════════════
//  ИГРЫ — раздел #/games (и #/games/<id> — сразу открыть игру)
// ═══════════════════════════════════════
// Здесь только витрина, загрузчик и общее API. Сами игры — js/games/*.js:
// грузятся лениво, при первом открытии (главная страница от них не тяжелеет).
// Игра регистрирует себя: GAME_IMPL[id] = { mount(el, api), unmount() }.
// Результаты — games.sql (game_result: XP за победы, рекорды); без входа —
// только локальная статистика в localStorage.
const GAMES_VER = '118';   // 118 — движок: «бежит сам» — клавиши, кнопки мыши, джойстик и кнопки телефона отпускаются, даже если «отпустил» не дошёл до игры (меню правой кнопки мимо игры, фокус в поле ввода, вкладку спрятали, отпустили мимо холста или за окном); приблизил камеру до упора (колесо, щипок, крестовина ↑) — вид от 1-го лица, отдалил — от 3-го (как в Роблоксе, ⚙️ «Камера»); камера от 3-го лица в бункере и подвале — у пола, а не над землёй; глубина резкости «Ультра» — автофокус туда, куда смотришь (без «мыла» от 1-го лица; ⚙️ «Глубина резкости»), кадр на компьютере не ниже 85 %, MSAA без FXAA поверх; шаг управления и столкновения «Кубомира» — без мусора; 117 — задания недели и сезонный путь (вещи сезонов и ⛄ новогоднего задания в гардеробе: charedit.js, wardrobe.js); 116 — «Кубомир»: две руки (левая — щит, факел, еда; F — поменять), бой ядром движка (js/engine/combat.js): перезарядка удара (часто — слабо), серия меча (рубка, обратная, укол), топор сверху выбивает щит, щит — блок и отбив (моб оглушён), лук с натяжкой и стрелы, мобы оглушаются и отлетают по силе удара; позы рук человечка (world3d.js, слой o.hold); паркур работает и без «Мира Денчика» (player.js в списке «Кубомира»); 115 — онлайн по ссылке-приглашению: комнаты (room.js, table.js, «Города», «Крокодил», Unity-игры, миры) ждут подключения сайта к Supabase до 8 с и при отсутствии связи говорят «Нет связи — попробуй ещё раз» (раньше — тихо к ботам / пустой экран), сообщения до подписки копятся (без REST); «Клеточки» и «Червячки» — в список игр без интернета (приложение, офлайн-страница); 114 — безопасность детей: в мире до 9 лет чат только читать, приглашения ребёнку до 13 — не от взрослых и не от «без возраста»; «Большой город» 16+; 113 — «Кубомир»: лёд не запирает и разбивается (проруби замерзают снова), паркур движка — залезть на 2 блока, повиснуть на краю, вылезти из воды на берег, «🆘 Я застрял», нокаут вместо смерти, подсказка постройки рамкой, чётче (анизотропия, без «мыла»), отражения воды и льда без полос, погода по климатическим зонам (где-то всегда зима, где-то зимы нет; снег ложится за минуты); 112 — новые io-игры: «Клеточки» (как agar.io) и «Червячки» (как slither.io) — боты, онлайн-комнаты до 10 человек (js/games/iokit.js), раунды по 5 минут; 111 — «Подземье»: новый интерфейс (вещи, крафт и сундук — листом с вкладками и крупными ячейками, «✅ Можно сделать», HUD без наложений, кнопки телефона с подписями, ⚙️ «⛏ Подземье», «🆘 Я застрял» в паузе), нокаут вместо смерти; свет и огонь — свет факела и лавы освещает только грань камня (в толщу и сквозь стену не проходит), ореол огня — в воздухе и не за стеной, живое пламя у факелов и печей, угольки, дымок, пузыри лавы; факел в руке светит (как в Террарии), свет вокруг героя и огненных снарядов держат стены; герой цепляется за край стены и подтягивается (⚙️ «Цепляться за края»); 110 — бонусы VIP и «💛 Донатера» в играх — без рекорда (подсказка «5 букв», 3-я+ отмена «2048», 4-й вариант «Орды»); 109 — настоящие адреса (js/ui/router.js): игры — /play/<игра>, ссылки «позвать», адрес комнаты и «игра поверх мира» в режиме адресов; 108 — «Змейка»: яблоко видно на ПК (смайлик рисовался с прозрачностью клеток поля); 107 — времена года медленнее (владелец: «хотя бы реальный месяц»): декабрь–февраль — зима, март–ноябрь — 7 сезонов по ≈ 39 суток, Наурыз — весной; 106 — «Мир Денчика»: погода и времена года движка (климат по месту: столица и города — умеренный, боевая зона и море — морской, горы — горный, равнины — степь; в детском городке без гроз), дождь и снег не идут под крышами, лёд на пруду и воде держит игрока, листва и трава карты желтеют осенью; 105 — погода, времена года и праздники движка (js/engine/climate.js, precip.js): дождь, снег, град, гроза, туман, зной по месту и климату; снег на крышах и земле, лужи, осенняя листва, лёд; календарь владельца (ноябрь — осень, декабрь–январь — зима, остальное — быстрые сезоны); салют и праздники разных стран (js/core/celebrate.js), новогоднее задание; «Студия 3D» — панель «🌦 Погода» и Weather.* в скриптах; «Кубомир» — времена года; 104 — «Кубомир»: деревья падают (подрубил ствол — валится от тебя, лёг — брёвна вещами; постройки не трогает), ⚙️ «Деревья падают»; движок: связный кусок с опорой (V.component), общий падающий кусок (fallGroup); 103 — «Кубомир»: под водой не моргает (запас по глубине глаз, плавно 0,25 с), видно 16–24 блока, звук под водой глуше и тише с тихим фоном; цвет травы плавно у границ биомов, у новых миров — извилистые границы и пятна снега; инструменты — пиксель-арт 32×32, вещь в руке выдавлена по пикселям; 102 — «Мир Денчика»: въезд в зоны без рывков (шейдеры зоны собираются заранее и в фоне, постройка — по бюджету кадра, одна зона за раз, вывески и картинки — по одной), стены зданий боевой зоны выбиваются (дыра; бункер и базы — прочные); 101 — «Кубомир»: погода по биому — дождь (небо и туман темнее, капли вокруг, брызги, круги на воде, шум, под крышей — глухо и сухо, изредка далёкий гром), снег в снегах, в пустыне сухо; расписание от зерна и дня; ⚙️ «Погода»; клубы дыма меньше и мягче; 100 — «Кубомир»: оживление — мобы ходят плавно (шаг, дыхание, взгляд на цель, замах и выпад, отпрянул от удара, смерть набок с «пуфом», появление из облачка; руки зомби вперёд), песок и гравий давят факелы и цветы, вещи прыгают, скользят, качаются на воде и тянутся к игроку, осколки-кубики, пыль из-под ног и при приземлении, крен камеры и красные края при ударе, шире обзор на бегу, блок «пружинит»; вода — всплеск, след, пузыри; дымок и ореол у факелов, угольки над лавой, светлячки ночью, падающие листья; 99 — «Мир Денчика»: транспорт живее (подвеска и крены, занос с дымом и следами шин, пыль, брызги и след лодки, пыль от винта, удары трясут корпус и камеру, звук под нагрузкой); разрушения (js/engine/destruct.js): деревья валятся на брёвна (танк), столбы, скамейки, окна, мешки, ящики — на куски, машины теряют двери/бампер/колёса, дым → огонь → остов; жители убегают; проверка логики (жители не в стенах, пассажир и ворота, такси, техника носом в свободное); рельеф подгружается без рывков; 98 — «Кубомир»: после Esc мышь снова управляет камерой (захват мыши холстом движок не видел), прицел без захвата спрятан, подсказка «🖱 Нажми на мир, чтобы играть», нажатие-захват не ломает блок; 97 — «Кубомир»: сложность «Сложно» (до 9 мобов, урон ×1,5, голод убивает, вещи выпадают); 96 — «Кубомир»: текстуры 32×32 (фактура, фаски, жилы руд), рельеф текстур на «высокой», книга рецептов «Можно сделать», сортировка, подсказки новичку, понятная смерть, баланс по сложности, проверка логики; 95 — слияние: «Подземье» (проход 3) и «Мир Денчика» (карта-рельеф); 94 — «Подземье»: цели первых часов (карточка под здоровьем, Проводник подсказывает), совет на экране смерти; отброс по силе оружия и стойкости моба; медные инструменты делаются заново; филин замахивается перед пикированием; 93 — «Мир Денчика»: вокруг мира — большая карта-рельеф (js/engine/worldmap.js): горы, равнины, реки, озёра, море; гавань боевой зоны открыта в океан; 93 — «Подземье»: рисунок блоков и существ богаче (камни по Вороному без шва, самородки с искрой, рябь песка, сугробы, грани льда, доски с гвоздями, кора, листва с бликами; слизни — желе с бликом и ядром, зомби в рваной рубахе, жук с лапками, бес с рогами и хвостом, контур у существ; «пуф» при смерти); 92 — «Мир Денчика» (ветка агента мира, на ней были 79–91): лобби с телепортами и картой (M), Солнечный городок 0+, Большой город 18+ (небоскрёбы, канал, в каждое здание можно зайти — js/engine/interior.js), Боевая зона 12+ с 12 участками военных баз, транспорт (js/engine/vehicle*.js, js/games/mir-veh.js), жители по расписанию, «вид мэра», такси, тест-драйв, ворота «Кубомира» и «Подземья»; 89 — «Подземье»: кирка, топор и молоток бьют мобов (слабее меча); факел и блоки ЛКМ только ставит (Shift не подаёт молоток, пустая рука после последнего не копает); мобы реже (шанс за секунду, днём меньше), только за экраном, не ближе 16 клеток, 20 с тишины после входа и возрождения; 88 — «Кубомир» 2: цветной свет блоков, руки как в Майне, управление как в Minecraft Java, импорт из Minecraft, шейдеры движка; 87 — на крыше крыша не прячется (зона «внутри» ниже крыши), чужой не бежит сам, если от него нет вестей; джойстик и клавиши отпускаются при сворачивании; 86 — Java в «Студии 3D» (js/engine/lang-java.js); 85 — страж графики: потеря контекста WebGL — не поломка (после возврата — отражения и тени заново); наборы шейдеров, этап 2: глубина резкости в «Ультра», второй слой звёзд, ореол луны; 84 — наборы шейдеров 3D (Обычные, Красивые, Ультра, Мультяшные, Ретро) и страж графики; 83 — «Подземье»: отделка — камера плавнее (взгляд по ходу), осколки блоков и брызги по ходу удара, цифры урона «выпрыгивают» (крит крупнее), красные края экрана при ранении, звуки места (огонь, лава, вода, ветер), шрифт сайта; озёра и лава — в чашах (гладь ровная, не утекает); 82 — шейдеры 2D (js/engine/shade2d.js): наборы «Обычные / Красивые / Ультра / Ретро», ⚙️ → Графика → «Шейдеры»; 81 — «Подземье»: управление как в Террарии (умный курсор, Shift, крюк, зелья, строитель на телефоне); 80 — «Подземье»: свет как в Террарии (режим «Цвет»), ореолы, фон по краям; 79 — «Кубомир» (свой движок кубиков, моды); 78 — откат исправления травы (телефоны); 76 — «Подземье»; 75 — графика на телефонах: highp-сэмплеры, проверка глубины, телефон — «средняя»; 74 — «Набеги»; 73 — графика: NIS, трассировка лучей, генерация кадров, фото с трассировкой пути (js/engine/pathtrace.js); 72 — ссылки «позвать» с кодом приглашения (room, mir, studio, studio3d), вещи «за друзей» в гардеробе
const GAMES = [
  { id: 'world',    age: '12+', ageWhy: 'Онлайн-мир: общение с незнакомыми игроками в чате.', icon: '🌍', title: 'Мир Денчика',     desc: 'Онлайн-мир сайта в 3D, как в Роблоксе: бегай, прыгай и лазай своим персонажем, заходи в кафе и домики, садись за столик — и партия в шахматы, «Дурака» или бильярд начнётся с тем, кто сел напротив.', scripts: ['js/games/room.js', 'js/games/world3d.js', 'js/games/charedit.js', 'js/games/world.js', 'js/engine/core.js', 'js/engine/physics.js', 'js/engine/controls.js', 'js/engine/input.js', 'js/engine/player.js', 'js/engine/camera.js', 'js/engine/interact.js', 'js/engine/synth.js', 'js/engine/gfx.js', 'js/engine/render.js', 'js/engine/post.js', 'js/engine/climate.js', 'js/engine/precip.js', 'js/engine/perf.js', 'js/engine/actors.js', 'js/engine/ui.js', 'js/engine/fx.js', 'js/engine/npc.js', 'js/engine/interior.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/vehicle-air.js', 'js/engine/worldmap.js', 'js/engine/destruct.js', 'js/games/mir-play.js', 'js/games/mir-base.js', 'js/games/mir-zones.js', 'js/games/mir-city.js', 'js/games/mir-war.js', 'js/games/mir-veh.js', 'js/games/mir.js'], color: '#22c55e' },
  // io-игры (js/games/iokit.js — комната на 2–10, хозяин считает, боты; агент 22.10.2026)
  { id: 'kletochki', age: '6+', ageWhy: 'Онлайн с другими игроками (без чата, только эмодзи); клетки «съедают» друг друга — мультяшно, без крови.', icon: '🦠', title: 'Клеточки', desc: 'Как agar.io: ты клетка — ешь точки и тех, кто меньше, делись и выбрасывай массу, прячься за колючками. Раунды по 5 минут, топ-10, боты и онлайн с друзьями.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/iokit.js', 'js/games/kletochki.js'], top: 'kletochki', topLabel: 'самая большая масса', color: '#22c55e' },
  { id: 'chervyachki', age: '6+', ageWhy: 'Онлайн с другими игроками (без чата, только эмодзи); червячки «рассыпаются на огоньки» — мультяшно, без крови.', icon: '🐛', title: 'Червячки', desc: 'Как slither.io: ползай, ешь огоньки и расти; держи — ускорение. Врезался головой в чужого червячка — рассыпаешься на огоньки. Раскраски, боты и онлайн с друзьями.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/iokit.js', 'js/games/chervyachki.js'], top: 'chervyachki', topLabel: 'самая большая длина', color: '#a855f7' },
  { id: 'podzem',   age: '12+', ageWhy: 'Бои с мультяшными монстрами (зомби, слизни, летучие мыши) и боссами; без крови — побеждённый герой «без сил» и встаёт дома.', icon: '⛏', title: 'Подземье', desc: 'Песочница сбоку, как Террария: бесконечный мир — копай вглубь, строй дом, плавь руду, переживи ночь и победи боссов. Свой персонаж, моды и сохранения в браузере.', scripts: ['js/core/char2d.js', 'js/engine/core.js', 'js/engine/controls.js', 'js/engine/synth.js', 'js/games/podzem-core.js', 'js/engine/shade2d.js', 'js/games/podzem-gl.js', 'js/games/podzem-ui.js', 'js/games/podzem-mods.js', 'js/games/podzem.js'], top: 'podzem', topLabel: 'метров вглубь', color: '#d9783a' },
  // набеги на участки «Мира Денчика» (docs/RAIDS.md): каталог — mir-base.js, бой — raid-sim.js (его же считает сервер)
  { id: 'raid',     age: '12+', ageWhy: 'Мультяшные сражения: армии человечков штурмуют участки других игроков (без крови).', icon: '⚔️', title: 'Набеги', desc: 'Как Clash of Clans: строй пушки и вышки на своём участке в «Мире Денчика», тренируй армию в казарме и нападай на базы других игроков. Звёзды, кубки, лиги, поход по лагерям разбойников — и месть обидчику.', scripts: ['js/games/mir-base.js', 'js/games/raid-sim.js', 'js/games/raid.js'], color: '#ef4444' },
  { id: 'studio',   age: '6+', ageWhy: 'Конструктор игр; игры других игроков — со своей меткой.', icon: '🛠️', title: 'Студия игр',      desc: 'Сделай свою игру: раннер, ловилка, летун, викторина, космобой — без кода. Или своим кодом с помощью ИИ. Зови друзей играть по ссылке!', scripts: ['js/games/studio-tpl.js', 'js/games/studio.js'], color: '#38bdf8' },
  { id: 'studio3d', age: '6+', ageWhy: 'Конструктор 3D-миров; миры других игроков — со своей меткой.', icon: '🧱', title: 'Студия 3D',       desc: 'Построй свой 3D-мир, как в Roblox Studio: детали, деревья и фонари, материалы, холмы и вода, время суток. Оживи детали скриптами — двери, монетки, лава, платформы — и пройди свой мир персонажем.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/world3d.js', 'js/engine/core.js', 'js/engine/physics.js', 'js/engine/controls.js', 'js/engine/input.js', 'js/engine/player.js', 'js/engine/camera.js', 'js/engine/interact.js', 'js/engine/synth.js', 'js/engine/gfx.js', 'js/engine/render.js', 'js/engine/post.js', 'js/engine/climate.js', 'js/engine/precip.js', 'js/engine/batch.js', 'js/engine/perf.js', 'js/engine/actors.js', 'js/engine/ui.js', 'js/engine/fx.js', 'js/engine/npc.js', 'js/engine/model.js', 'js/engine/scene.js', 'js/engine/rigid.js', 'js/engine/gizmo.js', 'js/engine/terrain.js', 'js/engine/script.js', 'js/engine/lang-lua.js', 'js/engine/lang-cs.js', 'js/engine/lang-java.js', 'js/engine/lang-wasm.js', 'js/engine/net.js', 'js/engine/net-transport.js', 'js/engine/edit-input.js', 'js/engine/modes.js', 'js/engine/views.js', 'js/games/studio3d.js', 'js/games/studio3d-gfx.js', 'js/games/studio3d-ui.js', 'js/games/studio3d-touch.js', 'js/games/studio3d-pad.js', 'js/games/studio3d-tools.js', 'js/games/studio3d-modes.js', 'js/games/studio3d-play.js', 'js/games/studio3d-learn.js', 'js/games/studio3d-weather.js'], color: '#f59e0b' },
  { id: 'kubomir',  age: '6+', ageWhy: 'Мультяшные монстры ночью (зомби, слизни) и падение с высоты — без крови.', icon: '🧊', title: 'Кубомир', desc: 'Свой бесконечный мир из кубиков, как в Майнкрафте: копай руды, крафти инструменты на верстаке, строй дом и переживи ночь. Выживание и творчество, моды и сохранения.', scripts: ['js/games/world3d.js', 'js/engine/core.js', 'js/engine/controls.js', 'js/engine/input.js', 'js/engine/player.js', 'js/engine/camera.js', 'js/engine/synth.js', 'js/engine/gfx.js', 'js/engine/render.js', 'js/engine/post.js', 'js/engine/climate.js', 'js/engine/precip.js', 'js/engine/perf.js', 'js/engine/actors.js', 'js/engine/combat.js', 'js/engine/ui.js', 'js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-stream.js', 'js/engine/voxel-render.js', 'js/engine/voxel-store.js', 'js/engine/voxel-mods.js', 'js/engine/voxel-worker.js', 'js/games/kubomir-ents.js', 'js/games/kubomir-ui.js', 'js/games/kubomir-mods.js', 'js/games/kubomir-light.js', 'js/games/kubomir-input.js', 'js/games/kubomir-hand.js', 'js/engine/mc-nbt.js', 'js/engine/mc-map.js', 'js/engine/mc-formats.js', 'js/engine/mc-packs.js', 'js/engine/mc-worker.js', 'js/games/kubomir-mc.js', 'js/games/kubomir-weather.js', 'js/games/kubomir.js'], top: 'kubomir', topLabel: 'достижений в «Выживании»', color: '#4f8cff' },
  { id: 'unity',    age: '12+', ageWhy: 'Игры игроков с других сайтов: модератор проверяет, но автор может обновить игру.', icon: '🕹️', title: 'Unity-игры',      desc: 'Игры, которые игроки сделали в Unity: играй прямо на сайте и зови друзей в комнату по ссылке — кто зашёл первым, тот хост. Делаешь игры в Unity? Добавь свою.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/unity-host.js'], color: '#7dd3fc' },
  { id: 'krokodil', age: '12+', ageWhy: 'Онлайн-игра компанией: чат и рисунки других игроков (мат и ссылки закрыты, есть жалобы на рисунок).', icon: '🐊', title: 'Крокодил', desc: 'Рисуй загаданное слово — остальные угадывают в чате. Компанией до 10 человек онлайн по ссылке, против бота или просто порисовать.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/krokodil.js'], top: 'krokodil', topLabel: 'очков в «Угадай рисунок бота»', color: '#22c55e' },
  { id: 'horde',    age: '12+', ageWhy: 'Сражения с мультяшными монстрами, боссы «Дракон» и «Жнец».', icon: '🧟', title: 'Орда',            desc: 'Выживи 10 минут против орды монстров, как в Vampire Survivors: оружие бьёт само, ты выбираешь улучшения. Герои, боссы, монеты — и дуэль с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/netplay.js', 'js/games/horde.js'], top: 'horde', topLabel: 'очков за забег', color: '#a855f7' },
  { id: 'arena',    age: '12+', ageWhy: 'Перестрелка двух персонажей (мультяшная, без крови).', icon: '🔫', title: 'Арена',           desc: 'Перестрелка 1 на 1 в реальном времени: бегай, прячься в кустах, копи «супер». Против бота или с другом онлайн — двумя пальцами на телефоне.', scripts: ['js/games/room.js', 'js/games/netplay.js', 'js/games/arena.js'], top: 'arena_hard', topLabel: 'побед над сложным ботом', color: '#f97316' },
  { id: 'td',       age: '6+', ageWhy: 'Башни отбиваются от мультяшных монстров.', icon: '🏰', title: 'Башни',           desc: 'Защита замка: ставь башни у дороги, улучшай и не пускай монстров. 20 волн и боссы. Битва с отправкой монстров другу или вдвоём на одной карте.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/netplay.js', 'js/games/td.js'], top: 'td', topLabel: 'очков за игру', color: '#f97316' },
  { id: 'balda',    age: '0+', icon: '🔠', title: 'Балда', desc: 'Словесная игра на поле 5×5: добавь букву и составь слово по соседним клеткам. Против бота трёх уровней, вдвоём на экране или онлайн с другом.', scripts: ['js/games/room.js', 'js/games/nouns-common.js', 'js/games/nouns-data.js', 'js/games/balda.js'], top: 'balda_hard', topLabel: 'очков в партии со «Сложным»', color: '#f59e0b' },
  { id: 'fillword', age: '0+', icon: '🔎', title: 'Филворд', desc: 'Найди все слова в поле из букв — каждое спрятано «змейкой». Уровни от 4×4 до 9×9, «Филворд дня» — один на всех, и наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/nouns-common.js', 'js/games/fillword.js'], top: 'fillword_daily', topLabel: 'очков в «Филворде дня»', color: '#a855f7' },
  { id: 'sudoku',   age: '0+', icon: '🔢', title: 'Судоку',          desc: 'Судоку четырёх уровней и «Судоку дня» — одно на всех, новое каждый день. Заметки, подсказки, рекорды дня и соревнование с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/sudoku.js'], top: 'sudoku_daily', topLabel: 'очков в «Судоку дня»', color: '#60a5fa' },
  { id: 'mahjong',  age: '0+', icon: '🀄', title: 'Маджонг Коннект', desc: 'Соедини пары одинаковых картинок линией не больше чем с двумя поворотами. Уровни, падающие фишки, подсказки — и наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/mahjong.js'], top: 'mahjong', topLabel: 'очков', color: '#f59e0b' },
  { id: 'miner',    age: '0+', icon: '💣', title: 'Сапёр',           desc: 'Классический «Сапёр» из Windows: Новичок, Любитель и Профи. Первый ход безопасный, флажок — долгим нажатием на телефоне. И наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/miner.js'], top: 'miner2', topLabel: 'очков («Любитель»)', color: '#ef4444' },
  { id: 'kosynka',  age: '0+', icon: '♥️', title: 'Косынка',         desc: 'Пасьянс «Косынка» как в Windows: по 1 или по 3 карты, отмена ходов, подсказки и автосбор. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/solitaire.js'], top: 'kosynka', topLabel: 'очков', color: '#22c55e' },
  { id: 'freecell', age: '0+', icon: '♣️', title: 'Свободная ячейка', desc: 'Пасьянс FreeCell: все карты открыты, 4 свободные ячейки. Раздачи с номерами как в Windows (№1–32000), отмена ходов, подсказки. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/solitaire.js'], top: 'freecell', topLabel: 'очков', color: '#38bdf8' },
  { id: 'pauk',     age: '0+', icon: '🕷️', title: 'Паук',            desc: 'Пасьянс «Паук»: 1, 2 или 4 масти. Собери 8 стопок от короля до туза. Отмена ходов, подсказки, игра сохраняется.', scripts: ['js/games/solitaire.js'], top: 'pauk1', topLabel: 'очков (1 масть)', color: '#a855f7' },
  { id: 'blocks',   age: '0+', icon: '🟦', title: 'Блоки',           desc: 'Головоломка как Block Blast: ставь фигуры на поле 8×8 и собирай полные ряды и столбцы. Комбо, рекорды, игра сохраняется. И соревнование с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/blocks.js'], top: 'blocks', topLabel: 'очков', color: '#3b82f6' },
  { id: 'domino',   age: '0+', icon: '🐐', title: 'Домино', desc: 'Домино «Козёл» на 2–4 игроков: с ботами или онлайн с друзьями по ссылке. Приставляй костяшки, бери из базара и не останься козлом!', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/domino.js'], top: 'domino', topLabel: 'очков за игру с ботами', color: '#e5e7eb' },
  { id: 'chess',    age: '0+', icon: '♟️', title: 'Шахматы',         desc: 'Шахматы со всеми правилами: с компьютером трёх уровней, вдвоём на одном экране или онлайн с другом по ссылке.', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/chess.js'], top: 'chess_hard', topLabel: 'побед над «Мастером»', color: '#e5e7eb' },
  { id: 'uno',      age: '0+', icon: '🃏', title: 'Одна!',           desc: 'Карточная игра по правилам Уно: с ботами или онлайн с друзьями до 4 человек. Сбрось все карты первым и не забудь крикнуть «Одна!».', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/uno.js'], top: 'uno', topLabel: 'очков за победу', color: '#e5383b' },
  { id: 'durak',    age: '0+', icon: '♠️', title: 'Дурак',           desc: 'Подкидной дурак на 36 карт: с ботами или онлайн с друзьями до 4 человек. Отбивайся, подкидывай и не останься дураком!', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/durak.js'], top: 'durak', topLabel: 'побед', color: '#d42a3b' },
  { id: 'pool',     age: '0+', icon: '🎱', title: 'Бильярд',         desc: 'Американский пул «восьмёрка»: против бота трёх уровней, вдвоём на одном телефоне или онлайн с другом по ссылке.', scripts: ['js/games/room.js', 'js/games/pool.js'], top: 'pool_hard', topLabel: 'побед над сложным ботом', color: '#1f9a5a' },
  { id: 'ludo',     age: '0+', icon: '🎲', title: 'Лудо',            desc: 'Кубик и фишки, как в Ludo King: с ботами или онлайн с друзьями до 4 человек. Выводи фишки на шестёрку и сбивай чужие!', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/ludo.js'], top: 'ludo', topLabel: 'побед', color: '#3b82f6' },
  { id: 'nardy',    age: '0+', icon: '🎯', title: 'Нарды',           desc: 'Длинные нарды: против бота двух уровней или онлайн с другом по ссылке. Проведи все 15 шашек домой первым!', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/nardy.js'], top: 'nardy_hard', topLabel: 'побед над сложным ботом', color: '#8b1d2c' },
  { id: 'wardrobe', age: '0+', icon: '🎭', title: 'Мой персонаж',   desc: 'Собери своего 3D-человечка, как в Роблоксе: тело, лицо, причёска, одежда, аксессуары и любые цвета. Он же — твой герой в играх.', scripts: ['js/games/world3d.js', 'js/games/charedit.js', 'js/games/wardrobe.js'], color: '#ff6fb5' },
  { id: 'cities',   age: '0+', icon: '🌍', title: 'Города',          desc: 'Называй город на последнюю букву — против бота трёх уровней или онлайн с другом по ссылке. 2 700+ городов.', scripts: ['js/games/room.js', 'js/games/cities-data.js', 'js/games/cities.js'], top: 'cities_hard', topLabel: 'цепочка на «Сложном»', color: '#29b6f6' },
  { id: 'words',    age: '0+', icon: '🔤', title: '5 букв',          desc: 'Угадай слово из 5 букв за 6 попыток. Новое слово дня каждый день, свободная игра и соревнование с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/words-data.js', 'js/games/words.js'], top: 'words', topLabel: 'лучшая попытка в слове дня', color: '#22c55e' },
  { id: 'guess',    age: '12+', ageWhy: 'Кусочки превью роликов канала — бывают страшилки.', icon: '🎬', title: 'Угадай видео',    desc: 'По кусочку превью угадай ролик dan4ik37. 10 раундов, чем быстрее — тем больше очков. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/guess-video.js'], top: 'guess', topLabel: 'из 10', color: '#ff2d55' },
  { id: '2048',     age: '0+', icon: '🧩', title: '2048',            desc: 'Складывай плитки — стрелки, WASD или свайпы. Дойдёшь до 2048? Или кто больше за 3 минуты — с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/g2048.js'], top: '2048', topLabel: 'очков', color: '#ffd166' },
  { id: 'checkers', age: '0+', icon: '⚫', title: 'Шашки',           desc: 'Русские шашки: против бота трёх уровней, вдвоём на экране или онлайн с другом по ссылке.', scripts: ['js/games/room.js', 'js/games/checkers.js'], top: 'checkers_hard', topLabel: 'шашек сохранено в победе на «Сложном»', color: '#e5e7eb' },
  { id: 'catch',    age: '0+', icon: '💰', title: 'Лови донаты',     desc: 'Аркада: лови падающие донаты, уворачивайся от банов и бомб. С другом — одинаковый дождь донатов у обоих.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/catch.js'], top: 'catch', topLabel: 'очков', color: '#ffd166' },
  { id: 'sea',      age: '0+', icon: '🚢', title: 'Морской бой',     desc: 'Классика 10×10: против бота трёх уровней или онлайн с другом по ссылке. Расставь флот и топи корабли.', scripts: ['js/games/room.js', 'js/games/sea.js'], top: 'sea_hard', topLabel: 'палуб уцелело в победе на «Сложном»', color: '#38bdf8' },
  { id: 'snake',    age: '0+', icon: '🐍', title: 'Змейка',          desc: 'Ешь яблоки, расти и не врезайся в стены и хвост. Стрелки, WASD или свайпы. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/snake.js'], top: 'snake', topLabel: 'яблок', color: '#22c55e' },
  { id: 'memory',   age: '0+', icon: '🃏', title: 'Найди пару',      desc: 'Игра на память: открывай карточки и находи пары за минимум ходов. С другом — одинаковая раскладка.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/memory.js'], top: 'memory', topLabel: 'очков', color: '#f472b6' },
  { id: 'ttt',      age: '0+', icon: '❌', title: 'Крестики-нолики', desc: 'Против бота (последний уровень не проигрывает), вдвоём на экране или онлайн с другом.', scripts: ['js/games/room.js', 'js/games/tictactoe.js'], top: 'ttt_hard', topLabel: 'ничьих/побед у непобедимого', color: '#9147ff' },
  { id: 'reaction', age: '0+', icon: '⚡', title: 'Реакция',          desc: 'Жми, как только экран станет зелёным. 5 попыток — узнай свою скорость и сравни с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/reaction.js'], top: 'reaction', topLabel: 'очков (1000 − мс)', color: '#22c55e' },
  { id: 'emoji',    age: '6+', ageWhy: 'Названия игр, в том числе хорроров и стрелялок (только эмодзи).', icon: '🤔', title: 'Угадай игру по эмодзи', desc: 'По четырём эмодзи угадай игру: Майнкрафт, FNAF, GTA… 10 раундов на скорость — и можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/emoji.js'], top: 'emoji', topLabel: 'очков за 10 раундов', color: '#f59e0b' },
  { id: 'clicker',  age: '0+', icon: '👆', title: 'Кликер',          desc: 'Кликай на скорость и собирай комбо. Старая добрая классика сайта.', href: '#/clicker', color: '#ff9f43' },
  { id: 'quiz',     age: '6+', ageWhy: 'Тесты про героев игр, в том числе хорроров (FNAF).', icon: '🧩', title: 'Тесты',           desc: 'Какой ты моб из Майнкрафта? Кто ты из FNAF и Роблокса? 8 вопросов — и результат, которым можно поделиться.', href: '/quiz', color: '#38bdf8' },
  { id: 'wheel',    age: '0+', icon: '🎡', title: 'Колесо фортуны',  desc: 'Впиши варианты и крути: во что поиграть, кто моет посуду, кто выиграл приз. Честный рандом и ссылка для друзей.', href: '/tools/wheel', color: '#f472b6' },
  { id: 'random',   age: '0+', icon: '🔢', title: 'Рандомайзер',     desc: 'Случайное число в любом диапазоне, монетка «орёл или решка», кубики. Для розыгрышей и споров.', href: '/tools/random', color: '#22c55e' },
  { id: 'typing',   age: '0+', icon: '⌨️', title: 'Тест печати',     desc: 'Сколько знаков в минуту ты печатаешь? Короткие тексты про игры, рекорд и вызов другу.', href: '/tools/typing', color: '#a78bfa' },
  { id: 'cps',      age: '0+', icon: '🖱', title: 'CPS тест',        desc: 'Сколько кликов в секунду ты успеешь? 1, 5 или 10 секунд, звание и рекорд — и вызов другу.', href: '/tools/cps', color: '#f59e0b' },
  { id: 'fonts',    age: '0+', icon: '✒️', title: 'Шрифты для ника', desc: 'Сделай ник красивым: 𝓓𝓪𝓷, 𝕯𝖆𝖓, Ⓓⓐⓝ, ꧁ник꧂ и 70+ символов. Нажал — скопировано.', href: '/tools/fonts', color: '#c084fc' },
];
// Скрытые страницы: открываются по адресу #/games/<id>, но их нет в каталоге, поиске и рекордах
const GAMES_HIDDEN = [
  { id: 'sprites', age: '0+', icon: '🎞', title: '2D-персонажи', scripts: ['js/core/char2d.js', 'js/games/sprite-view.js'] },   // проверка 2D-проекции персонажа
];
// Разделы витрины: у игры может быть несколько. «С друзьями» — есть игра вдвоём/компанией онлайн или на одном экране
const GAME_CATS = [
  ['all', '🎮', 'Все'], ['new', '🆕', 'Новые'], ['friends', '👥', 'С друзьями'], ['cards', '🃏', 'Карты и настолки'],
  ['action', '⚔️', 'Экшен'], ['brain', '🧠', 'Головоломки'], ['tools', '🛠', 'Тесты и инструменты'],
];
const GAME_TAGS = {
  podzem: 'new action tools',   // «Подземье»: песочница (строить — как инструмент) и бои
  kletochki: 'new friends action', chervyachki: 'new friends action',
  kubomir: 'new action brain', krokodil: 'new friends', balda: 'new friends brain', domino: 'new friends cards', fillword: 'new friends brain',
  world: 'new friends', raid: 'new friends action', studio: 'new tools', unity: 'new friends tools', sudoku: 'new friends brain', mahjong: 'new friends brain', miner: 'new friends brain', kosynka: 'new friends cards brain', pauk: 'new cards brain', freecell: 'new friends cards brain', blocks: 'new friends brain', chess: 'new friends cards', arena: 'new friends action', horde: 'new friends action', td: 'new friends action', uno: 'new friends cards', durak: 'new friends cards', pool: 'new friends cards',
  ludo: 'new friends cards', nardy: 'new friends cards', wardrobe: 'new', cities: 'friends brain', words: 'friends brain',
  guess: 'friends brain', '2048': 'friends brain', checkers: 'friends cards', catch: 'friends action', sea: 'friends cards',
  snake: 'friends action', memory: 'friends brain', ttt: 'friends cards', reaction: 'friends action', emoji: 'new friends brain',
  clicker: 'action', quiz: 'tools', wheel: 'tools', random: 'tools', typing: 'tools', cps: 'tools action', fonts: 'tools',
};
let gamesCat = 'all';
try { gamesCat = localStorage.getItem('d37_games_cat') || 'all'; } catch (e) {}
function setGamesCat(c){
  gamesCat = c;
  try { localStorage.setItem('d37_games_cat', c); } catch (e) {}
  const grid = document.getElementById('gamesGrid');
  if (grid) delete grid.dataset.ready;
  renderGamesHub();
}
const GAME_IMPL = window.GAME_IMPL = window.GAME_IMPL || {};
// Задание дня — коды и порядок совпадают с daily_quest_code()/daily_quest_done() в games.sql
const DAILY_QUESTS = {
  win_cities:   { text: 'Победи бота в «Города» (любая сложность)', game: 'cities' },
  play3:        { text: 'Сыграй 3 партии в любые игры', game: null },
  guess7:       { text: 'Угадай 7+ роликов из 10 в «Угадай видео»', game: 'guess' },
  catch500:     { text: 'Набери 500+ очков в «Лови донаты»', game: 'catch' },
  win_checkers: { text: 'Выиграй партию в шашки', game: 'checkers' },
  reaction:     { text: 'Средняя реакция 300 мс или быстрее', game: 'reaction' },
  score2048:    { text: 'Набери 2000+ очков в «2048»', game: '2048' },
  win_ttt:      { text: 'Выиграй в крестики-нолики (Средний, Непобедимый или онлайн)', game: 'ttt' },
  win_sea:      { text: 'Выиграй в «Морской бой» (Средний, Сложный или онлайн)', game: 'sea' },
  snake20:      { text: 'Съешь 20+ яблок в «Змейке»', game: 'snake' },
  memory:       { text: 'Найди все пары в «Найди пару» за 20 ходов или меньше', game: 'memory' },
  words:        { text: 'Угадай слово дня в «5 букв»', game: 'words' },
};

let gamesActive = null;        // id открытой игры
let gamesTopKey = 'cities_hard';
let gamesTopWeek = true;       // рекорды за 7 дней (иначе — за всё время)
const gamesScriptCache = new Map();

// js/games/gamekit.js — общее для игр («точно?», правила, «чей ход»): грузится раньше любого файла игры (и в окне поверх мира)
const GAMES_KIT = 'js/games/gamekit.js';
function gamesLoadScript(src){
  if (gamesScriptCache.has(src)) return gamesScriptCache.get(src);
  const kit = src !== GAMES_KIT && src.startsWith('js/games/') ? gamesLoadScript(GAMES_KIT) : null;
  const p = (kit || Promise.resolve()).then(() => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src + '?v=' + GAMES_VER;
    s.onload = res;
    s.onerror = () => rej(new Error('Не загрузилось: ' + src));
    document.head.appendChild(s);
  }));
  p.catch(() => { if (gamesScriptCache.get(src) === p) gamesScriptCache.delete(src); });   // не загрузилось — в другой раз ещё попытка
  gamesScriptCache.set(src, p);
  return p;
}

// Роутер зовёт при каждом заходе на #/games[/id]
function renderGamesPage(param){
  const [first, ...rest] = String(param || '').split('/');
  const id = GAMES.some(g => g.id === first && !g.href) || GAMES_HIDDEN.some(g => g.id === first) ? first : null;
  if (id) openGame(id, rest.join('/') || null); else closeGame(true);
}

function renderGamesHub(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || grid.dataset.ready) return;
  grid.dataset.ready = '1';
  let cats = document.getElementById('gamesCats');
  if (!cats) { cats = document.createElement('div'); cats.id = 'gamesCats'; cats.className = 'gm-cats'; cats.setAttribute('role', 'tablist'); grid.before(cats); }
  if (!GAME_CATS.some(c => c[0] === gamesCat)) gamesCat = 'all';
  cats.innerHTML = GAME_CATS.map(([k, ic, name]) => {
    const n = k === 'all' ? GAMES.length : GAMES.filter(g => (GAME_TAGS[g.id] || '').split(' ').includes(k)).length;
    return `<button type="button" role="tab" class="gm-cat${k === gamesCat ? ' active' : ''}" aria-selected="${k === gamesCat}" onclick="setGamesCat('${k}')">${ic} ${name} <i>${n}</i></button>`;
  }).join('');
  const list = gamesCat === 'all' ? GAMES : GAMES.filter(g => (GAME_TAGS[g.id] || '').split(' ').includes(gamesCat));
  grid.innerHTML = list.map(g => {
    const st = gameLocalStats(g.id);
    const rec = st.best ? `<span class="gm-rec">🏆 ${esc(gameBestLabel(g.id, st.best))}</span>` : '';
    return `<a class="gm-card" href="${g.href ? D37Route.href(g.href) : '/play/' + g.id}" style="--gc:${g.color}">
      ${window.D37Age ? D37Age.badge(g.age, { title: g.ageWhy || 'Без ограничений' }) : ''}
      <span class="gm-ic">${g.icon}</span>
      <span class="gm-title">${esc(g.title)}</span>
      <span class="gm-desc">${esc(g.desc)}</span>
      <span class="gm-foot"><span class="gm-play">Играть →</span>${rec}</span>
    </a>`;
  }).join('');
  window.D37AdPlaces?.feed(grid, { place: 'feed_games', every: 10, max: 2 });   // карточка «Реклама» после каждой 10-й (ad-places.js)
  const tabs = document.getElementById('gamesTopTabs');
  tabs.innerHTML = `<button class="gm-tab duel${gamesTopKey === 'duels' ? ' active' : ''}" data-key="duels" onclick="setGamesTop('duels')">⚔️ Чемпионы дуэлей</button>` +
    GAMES.filter(g => g.top).map(g =>
    `<button class="gm-tab${g.top === gamesTopKey ? ' active' : ''}" data-key="${g.top}" onclick="setGamesTop('${g.top}')">${g.icon} ${esc(g.title)}</button>`).join('');
  document.querySelectorAll('#gamesTopPeriod button').forEach(b => b.classList.toggle('active', (b.dataset.week === '1') === gamesTopWeek));
  renderGamesTop();
  renderDailyQuest();
  renderQuests();
  renderGamesMe();
  const hubAd = document.getElementById('gamesHubAd');
  if (hubAd && !hubAd.dataset.adDone) { hubAd.dataset.adDone = '1'; window.D37Ads?.render(hubAd, 'games_hub'); }
}

// «Мой персонаж» над карточками: персонаж, монеты, бонус дня, вход в гардероб (js/core/avatar.js, coins.js)
function renderGamesMe(){
  const box = document.getElementById('gamesMe');
  if (!box || !window.D37Char || !window.D37Coins) return;
  box.hidden = false;
  box.innerHTML = `<a class="gm-me-char" href="/play/wardrobe" title="Мой персонаж — гардероб" aria-label="Мой персонаж"><canvas width="112" height="112"></canvas></a>
    <div class="gm-me-body"><b>Мой персонаж</b><span>🪙 <b class="js-coins">${Number(D37Coins.coins()).toLocaleString('ru')}</b> монет${window.D37Gems?.isOn() ? ` · <a class="gm-gems" href="/shop" title="Магазин кристаллов">💎 <b class="js-gems">${D37Gems.num(D37Gems.balance())}</b></a>` : ''}</span></div>
    ${D37Coins.canDaily() ? '<button type="button" class="gm-me-btn" onclick="gamesDailyBonus(this)">🎁 Бонус дня</button>' : ''}
    ${window.D37AdPlaces?.coinOffer?.('hub') || ''}
    <a class="gm-me-btn ghost" href="/play/wardrobe">🎭 Гардероб</a>`;
  D37Char.draw(box.querySelector('canvas').getContext('2d'), D37Char.look(), 56, 106, 88, { t: 0 });
}
async function gamesDailyBonus(btn){
  btn.disabled = true;
  const r = await D37Coins.daily();
  if (r?.ok) { gameToast(`🎁 Бонус дня: +${r.got} 🪙`); gameSfx('win'); }
  renderGamesMe();
}
window.addEventListener('d37:auth', () => { setTimeout(() => { if (document.getElementById('gamesMe') && !document.getElementById('gamesHub')?.hidden) renderGamesMe(); }, 600); });
window.D37Char?.on(() => { if (!document.getElementById('gamesHub')?.hidden) renderGamesMe(); });
// 💎 баланс на плашке — когда кошелёк кристаллов загрузился (js/core/premium.js)
window.D37Gems?.on(() => { if (D37Gems.isOn() && !document.getElementById('gamesHub')?.hidden && document.getElementById('gamesMe') && !document.querySelector('#gamesMe .gm-gems')) renderGamesMe(); });

// Реклама под игрой — только после окончания партии (не во время), обновляется не чаще раза в 90 с.
// Есть диспетчер (ad-places.js) — он: на компьютере каждая 3-я партия — «☕ Перерыв», Google без обновлений, VIP без рекламы
let gamesAdAt = 0;
function gamesAdAfterRound(){
  // «Игра поверх мира» (js/games/mir-play.js): партия в окне поверх мира — реклама в его полоске итога, а не под миром
  const stage = window.MirPlay?.adStage?.() || document.getElementById('gamesStage');
  if (window.D37AdPlaces) { window.D37AdPlaces.afterRound(stage); return; }
  if (!stage || stage.hidden || !window.D37Ads || Date.now() - gamesAdAt < 90000) return;
  let box = document.getElementById('gamesAd');
  if (!box) { box = document.createElement('div'); box.id = 'gamesAd'; stage.appendChild(box); }
  if (window.D37Ads.render(box, 'game_over')) gamesAdAt = Date.now();
}

async function renderDailyQuest(){
  const box = document.getElementById('gamesDaily');
  if (!box || !sbClient) return;
  const { data, error } = await sbClient.rpc('daily_quest');
  if (error || !data?.code || !DAILY_QUESTS[data.code]) { box.hidden = true; return; }   // games.sql ещё не выполнен
  const q = DAILY_QUESTS[data.code];
  box.hidden = false;
  let right;
  if (!currentUser) right = `<button class="dq-btn ghost" onclick="openGlobalAuth()">Войти</button>`;
  else if (data.claimed) right = `<span class="dq-done">✅ Награда получена</span>`;
  else if (data.done) right = `<button class="dq-btn" onclick="claimDailyQuest(this)">🎁 Забрать ${dailyQuestPrize()}</button>`;
  else right = q.game ? `<a class="dq-btn ghost" href="/play/${q.game}">Играть →</a>` : '';
  box.innerHTML = `<span class="dq-ic">🎯</span>
    <div class="dq-body"><b>Задание дня</b><span>${esc(q.text)}</span><small>${currentUser ? (data.done ? 'Выполнено!' : 'Новое задание — каждый день в полночь по МСК') : 'Войди, чтобы получить награду'}</small></div>
    ${right}`;
}
// Награда за задание дня — XP (xp_rule('daily'), economy.sql) и монеты (coin_rule('quest'), coins.sql); числа — XP_NUM / RULES
function dailyQuestPrize(){
  const xp = typeof XP_NUM !== 'undefined' ? XP_NUM.daily : 25, c = window.D37Coins?.RULES?.quest;
  return `+${xp} XP${c ? ` и ${c} 🪙` : ''}`;
}
async function claimDailyQuest(btn){
  btn.disabled = true;
  const { data } = await sbClient.rpc('claim_daily_quest');
  if (data?.ok) {
    gameToast(`🎯 Задание дня выполнено: +${data.xp} XP${window.D37Coins?.RULES?.quest ? ` и ${D37Coins.RULES.quest} 🪙` : ''}${questHub ? ` · +${QUEST_NUM.s_daily} ⭐ сезона` : ''}`);
    if (typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
    window.D37Coins?.sync?.();
    questAt = 0; renderQuests();
  }
  renderDailyQuest();
}

// ═══ Задания недели и бесплатный сезонный путь (T-015, 22.10.2026; games-more.sql: quest_hub, claim_weekly_quest, season_claim,
//     season_title_set, season_frame_set, season_frames). Прогресс и награды считает сервер; награды гарантированные (без
//     случайности), рейтинги не трогают, платного пути нет. Числа — как quest_rule(), задания — weekly_quest_pool(), лестница —
//     season_ladder(), темы — season_themes() (scripts/economy-test.cjs сверяет). Все числа — предложение, решает владелец. ═══
const QUEST_NUM = { w_xp: 5, w_coins: 10, w_pts: 40, s_win: 2, s_win_day: 10, s_daily: 20, s_lv: 70, s_levels: 25, s_months: 1, s_dup: 40,
  a_coins: 10, a_xp: 5, a_small: 5, a_big: 20, a_big_coins: 150, a_day_cap: 2, a_age_h: 24 };
// Задания недели: место (slot), сколько нужно (n), что считает сервер (stat) — как weekly_quest_pool(); значок, текст, куда идти
const WEEKLY_QUESTS = {
  w_play15:    { slot: 1, n: 15, stat: 'plays', icon: '🎮', text: 'Сыграй 15 партий в любые игры', go: '/play' },
  w_play25:    { slot: 1, n: 25, stat: 'plays', icon: '🎮', text: 'Сыграй 25 партий в любые игры', go: '/play' },
  w_win8:      { slot: 2, n: 8, stat: 'wins', icon: '🏆', text: 'Победи 8 раз в любых играх', go: '/play' },
  w_win12:     { slot: 2, n: 12, stat: 'wins', icon: '🏆', text: 'Победи 12 раз в любых играх', go: '/play' },
  w_games5:    { slot: 3, n: 5, stat: 'games', icon: '🧭', text: 'Сыграй в 5 разных игр', go: '/play' },
  w_wingames3: { slot: 3, n: 3, stat: 'wingames', icon: '🎯', text: 'Победи в 3 разных играх', go: '/play' },
  w_games7:    { slot: 3, n: 7, stat: 'games', icon: '🧭', text: 'Сыграй в 7 разных игр', go: '/play' },
  w_daily4:    { slot: 4, n: 4, stat: 'daily', icon: '📌', text: 'Выполни «Задание дня» 4 раза', go: null },
  w_words3:    { slot: 4, n: 3, stat: 'words', icon: '🔤', text: 'Угадай слово дня в «5 букв» 3 раза', go: '/play/words' },
  w_sudoku3:   { slot: 4, n: 3, stat: 'sudoku', icon: '🔢', text: 'Реши «Судоку дня» 3 раза', go: '/play/sudoku' },
  w_fill3:     { slot: 4, n: 3, stat: 'fillword', icon: '🔎', text: 'Пройди «Филворд дня» 3 раза', go: '/play/fillword/daily' },
  w_online3:   { slot: 5, n: 3, stat: 'online', icon: '🤝', text: 'Сыграй 3 партии с живыми людьми: онлайн, «Соревнование» или «Вместе»', go: '/play' },
  w_hard1:     { slot: 5, n: 1, stat: 'hard', icon: '💪', text: 'Победи компьютер на самом сложном уровне', go: '/play' },
  w_boards4:   { slot: 5, n: 4, stat: 'boards', icon: '♟️', text: 'Выиграй 4 партии в настольные или карточные игры', go: '/play' },
  w_visit5:    { slot: 6, n: 5, stat: 'visits', icon: '📅', text: 'Заходи на сайт 5 разных дней', go: null },
  w_watch5:    { slot: 6, n: 5, stat: 'watch', icon: '📺', text: 'Посмотри 5 роликов на сайте (от минуты)', go: '/' },
  w_puzzle5:   { slot: 6, n: 5, stat: 'puzzles', icon: '🧩', text: 'Реши 5 головоломок: судоку, пасьянсы, сапёр, маджонг, филворд', go: '/play' },
};
// Лестница сезона — как season_ladder(): coins — 🪙, title — 1 «участник» / 2 «легенда», item — вещь темы, frame — рамка темы
const SEASON_LADDER = [
  { lv: 1, coins: 10 }, { lv: 2, coins: 10 }, { lv: 3, coins: 10 }, { lv: 4, title: 1 }, { lv: 5, coins: 15 },
  { lv: 6, coins: 15 }, { lv: 7, coins: 15 }, { lv: 8, coins: 15 }, { lv: 9, coins: 20 }, { lv: 10, item: 1 },
  { lv: 11, coins: 20 }, { lv: 12, coins: 20 }, { lv: 13, coins: 20 }, { lv: 14, coins: 20 }, { lv: 15, frame: 1 },
  { lv: 16, coins: 25 }, { lv: 17, coins: 25 }, { lv: 18, coins: 25 }, { lv: 19, coins: 25 }, { lv: 20, coins: 30 },
  { lv: 21, coins: 25 }, { lv: 22, coins: 25 }, { lv: 23, coins: 30 }, { lv: 24, coins: 30 }, { lv: 25, title: 2, coins: 50 },
];
// Темы сезонов по месяцу начала — как season_themes(): рамка — .lv-frame-ss[data-ss=id] (css/premium.css), вещь — avatar.js PARTS
const SEASON_THEMES = [
  { m: 1, id: 'jan', icon: '🐧', name: 'Зимние забавы', item: 'skin:pet:penguin', color: '#7dd3fc' },
  { m: 2, id: 'feb', icon: '🧊', name: 'Ледяные узоры', item: 'skin:trail:ice', color: '#93c5fd' },
  { m: 3, id: 'mar', icon: '🌷', name: 'Наурыз', item: 'skin:item:tulip', color: '#f472b6' },
  { m: 4, id: 'apr', icon: '💧', name: 'Капель', item: 'skin:trail:drops', color: '#38bdf8' },
  { m: 5, id: 'may', icon: '🐝', name: 'Цветение', item: 'skin:pet:bee', color: '#facc15' },
  { m: 6, id: 'jun', icon: '🍉', name: 'Лето', item: 'skin:item:melon', color: '#4ade80' },
  { m: 7, id: 'jul', icon: '🐢', name: 'Море', item: 'skin:pet:turtle', color: '#22d3ee' },
  { m: 8, id: 'aug', icon: '🌠', name: 'Звездопад', item: 'skin:trail:starfall', color: '#a78bfa' },
  { m: 9, id: 'sep', icon: '📚', name: 'Знания', item: 'skin:item:books', color: '#fb923c' },
  { m: 10, id: 'oct', icon: '🎃', name: 'Тыквы', item: 'skin:pet:pumpkin', color: '#f97316' },
  { m: 11, id: 'nov', icon: '☂️', name: 'Осенний дождь', item: 'skin:item:umbrella', color: '#d97706' },
  { m: 12, id: 'dec', icon: '🎁', name: 'Новогодний', item: 'skin:item:gift', color: '#ef4444' },
];
const QUEST_MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const questDay = (ymd, shift = 0) => { const [y, m, d] = String(ymd).split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + shift)); return `${t.getUTCDate()} ${QUEST_MON[t.getUTCMonth()]}`; };
const seasonThemeById = id => SEASON_THEMES.find(t => t.id === id) || null;
// Вещь темы: эмодзи и название из avatar.js (PARTS) — 'skin:pet:penguin' → { v: '🐧', name: 'Пингвин' }
function seasonItem(item){
  const m = /^skin:(\w+):(\w+)$/.exec(item || ''), p = m && window.D37Char?.part?.(m[1], m[2]);
  return p && p.id === m[2] ? p : { v: '🎁', name: 'Вещь сезона' };
}
// Титул сезона ('ss:ГГГГ-ММ:1|2', season_claim) → { icon, title, desc } — для ника в чате, профиля (xp.js, achievements.js)
function seasonTitleDef(code){
  const m = /^ss:(\d{4})-(\d{2}):([12])$/.exec(code || ''), t = m && SEASON_THEMES.find(x => x.m === +m[2]);
  if (!t) return null;
  return m[3] === '2' ? { icon: '🏆', title: `Легенда: ${t.name} ${m[1]}`, desc: `Прошёл весь путь сезона «${t.name}» ${m[1]}` }
    : { icon: t.icon, title: `${t.name} ${m[1]}`, desc: `Участник сезона «${t.name}» ${m[1]}` };
}
function seasonRewardText(e, t){
  const it = e.item ? seasonItem(t.item) : null, parts = [];
  if (e.title) parts.push(e.title === 2 ? `🏆 титул «Легенда сезона»` : `🏷 титул «${t.icon} ${t.name}»`);
  if (it) parts.push(`${it.v} ${it.name} — персонажу`);
  if (e.frame) parts.push(`🖼 рамка аватара «${t.name}»`);
  if (e.coins) parts.push(`${e.coins} 🪙`);
  return parts.join(' + ');
}
function seasonRewardIcon(e, t){ return e.item ? seasonItem(t.item).v : e.frame ? '🖼' : e.title === 2 ? '🏆' : e.title ? '🏷' : '🪙'; }

let questHub = null, questAt = 0, questOff = false, questBusy = null, questHintAt = 0;
// quest_hub() — задания недели и сезон одним запросом (не чаще раза в 30 с, если не force); нет games-more.sql — всё скрыто
function questLoad(force){
  if (questOff || typeof sbClient === 'undefined' || !sbClient) return Promise.resolve(null);
  if (!force && questHub && Date.now() - questAt < 30e3) return Promise.resolve(questHub);
  if (questBusy) return questBusy;
  questBusy = (async () => {
    try {
      const { data, error } = await sbClient.rpc('quest_hub');
      if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) questOff = true; return null; }
      questHub = data; questAt = Date.now();
      return data;
    } catch (e) { return null; } finally { questBusy = null; }
  })();
  return questBusy;
}
const seasonLv = s => s ? Math.min(Math.floor((s.pts || 0) / (s.per || QUEST_NUM.s_lv)), s.levels || QUEST_NUM.s_levels) : 0;

function seasonHtml(s, compact){
  const t = seasonThemeById(s.theme) || SEASON_THEMES[9], per = s.per || QUEST_NUM.s_lv, top = s.levels || QUEST_NUM.s_levels;
  const lv = seasonLv(s), can = Math.max(0, lv - (s.claimed || 0)), pts = s.pts || 0;
  const into = lv >= top ? per : pts - lv * per, pct = Math.round(into / per * 100);
  const name = (s.no > 0 ? `Сезон ${s.no}` : 'Пробный сезон') + ` · «${t.name}»`;
  const head = `<div class="sq-h"><span class="sq-ic" aria-hidden="true">${t.icon}</span><div class="sq-t"><b>${esc(name)}</b><small>Бесплатный путь · до ${questDay(s.end, -1)} включительно</small></div>
    <span class="sq-lv">ур. <b>${lv}</b>/${top}</span></div>
    <div class="sq-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${per}" aria-valuenow="${into}" aria-label="До следующего уровня сезона"><i style="width:${pct}%"></i></div>
    <div class="sq-sub">${lv >= top ? `⭐ ${pts} — весь путь пройден!` : `⭐ ${pts} · до ${lv + 1} уровня — ещё ${per - into} ⭐`}${s.auth ? '' : ' · <a href="#" onclick="openGlobalAuth();return false">войди</a>, чтобы копить ⭐'}</div>`;
  const claim = can ? `<button type="button" class="dq-btn" onclick="seasonClaim(this)">🎁 Забрать награды (${can})</button>` : '';
  const prev = (s.prev || []).filter(p => p.lv > p.claimed).map(p => { const pt = seasonThemeById(p.theme); return `<button type="button" class="dq-btn ghost" onclick="seasonClaim(this, ${+p.no})">🎁 «${esc(pt ? pt.name : 'прошлый сезон')}»: ${p.lv - p.claimed}</button>`; }).join('');
  if (compact) return head + (claim || prev ? `<div class="sq-f">${claim}${prev}</div>` : '');
  const path = SEASON_LADDER.map(e => {
    const st = e.lv <= (s.claimed || 0) ? ' got' : e.lv <= lv ? ' ready' : '';
    return `<span class="sq-c${st}${e.coins && !e.item && !e.frame && !e.title ? '' : ' big'}" data-lv="${e.lv}" title="${esc(`Уровень ${e.lv}: ${seasonRewardText(e, t)}`)}">${seasonRewardIcon(e, t)}${e.coins && !e.title ? `<small>${e.coins}</small>` : ''}</span>`;
  }).join('');
  const how = `<details class="sq-how"><summary>Как получать ⭐</summary><ul>
      <li>🏆 Победа в любой игре — +${QUEST_NUM.s_win} ⭐ (первые ${QUEST_NUM.s_win_day} побед в день${s.auth ? `, сегодня: ${Math.min(s.wins_today || 0, QUEST_NUM.s_win_day)}` : ''})</li>
      <li>🎯 Задание дня — +${QUEST_NUM.s_daily} ⭐</li><li>📅 Задание недели — +${QUEST_NUM.w_pts} ⭐ за каждое</li>
      <li>Уровень — каждые ${per} ⭐. Награды твои навсегда, их можно забрать и после конца сезона. Новый сезон — каждый месяц, с новой темой.</li></ul></details>`;
  return head + `<div class="sq-path" role="list" aria-label="Награды сезона">${path}</div>`
    + `<div class="sq-f">${claim}${prev}${how}${seasonMineHtml(s)}</div>`;
}
// «🎒 Мои награды сезонов»: титулы и рамки (вещи — в гардеробе)
function seasonMineHtml(s){
  const own = s.owned || [], titles = own.filter(o => o.kind === 'title'), frames = own.filter(o => o.kind === 'frame');
  if (!titles.length && !frames.length) return '';
  const tb = titles.map(o => { const d = seasonTitleDef(o.code); return d ? `<button type="button" class="sq-pick${s.title === o.code ? ' on' : ''}" onclick="seasonSetTitle(this, '${esc(o.code)}')">${d.icon} ${esc(d.title)}</button>` : ''; }).join('');
  const fb = frames.map(o => { const t = seasonThemeById(o.code); return t ? `<button type="button" class="sq-pick${s.frame === o.code ? ' on' : ''}" onclick="seasonSetFrame(this, '${t.id}')">🖼 ${t.icon} ${esc(t.name)}</button>` : ''; }).join('');
  return `<details class="sq-how sq-mine"><summary>🎒 Мои награды сезонов (${titles.length + frames.length})</summary>
    ${tb ? `<div class="sq-picks"><span>Титул рядом с ником:</span>${tb}${s.title && /^ss:/.test(s.title) ? '<button type="button" class="sq-pick" onclick="seasonSetTitle(this, \'\')">— без титула</button>' : ''}</div>` : ''}
    ${fb ? `<div class="sq-picks"><span>Рамка аватара:</span>${fb}${s.frame ? '<button type="button" class="sq-pick" onclick="seasonSetFrame(this, \'\')">— рамка уровня</button>' : ''}</div>` : ''}
    <small>Вещи сезонов — в <a href="/play/wardrobe">гардеробе</a>.</small></details>`;
}
function weeklyHtml(w, compact){
  const list = (w.list || []).filter(q => WEEKLY_QUESTS[q.code]);
  const done = list.filter(q => q.claimed).length, ready = list.filter(q => q.done && !q.claimed).length;
  const head = `<div class="sq-h"><span class="sq-ic" aria-hidden="true">📅</span><div class="sq-t"><b>Задания недели</b><small>Новые — в понедельник, ${questDay(w.ends)} · за каждое +${w.xp} XP, ${w.coins} 🪙, ${w.pts} ⭐</small></div>
    <span class="sq-lv"><b>${done}</b>/${list.length}</span></div>`;
  if (compact) return head + (ready && w.auth ? `<div class="sq-sub">🎁 Можно забрать: ${ready} — <a href="/play">в «Играх»</a></div>` : '');
  const rows = list.map(q => {
    const d = WEEKLY_QUESTS[q.code], pct = Math.round(Math.min(q.have, q.n) / q.n * 100);
    const right = !w.auth ? '' : q.claimed ? '<span class="dq-done">✅</span>'
      : q.done ? `<button type="button" class="dq-btn" onclick="weeklyClaim(this, '${q.code}')">🎁 Забрать</button>`
      : d.go ? `<a class="dq-btn ghost" href="${d.go}">Играть</a>` : '';
    return `<li class="sq-q${q.claimed ? ' ok' : q.done ? ' ready' : ''}"><span class="sq-qi" aria-hidden="true">${d.icon}</span>
      <div class="sq-qb"><span>${esc(d.text)}</span><span class="sq-pb"><i style="width:${pct}%"></i></span><small>${Math.min(q.have, q.n)} / ${q.n}</small></div>${right}</li>`;
  }).join('');
  return head + `<ul class="sq-list">${rows}</ul>` + (w.auth ? '' : '<div class="sq-sub"><a href="#" onclick="openGlobalAuth();return false">Войди</a> — и задания недели дадут XP, монеты и ⭐ сезона</div>');
}
// Витрина «Игр»: сезон и задания недели (под заданием дня)
async function renderQuests(){
  const sb = document.getElementById('gamesSeason'), wb = document.getElementById('gamesWeekly');
  if (!sb || !wb) return;
  const h = await questLoad(false);
  if (!h?.season || !h?.weekly) { sb.hidden = wb.hidden = true; return; }
  if (!sb.hidden && sb.dataset.at === String(questAt)) return;   // те же данные — DOM не трогаем
  sb.dataset.at = String(questAt);
  const t = seasonThemeById(h.season.theme);
  sb.style.setProperty('--sc', t ? t.color : '#ffd166');
  sb.innerHTML = seasonHtml(h.season, false); sb.hidden = false;
  wb.innerHTML = weeklyHtml(h.weekly, false); wb.hidden = false;
  // к ближайшей награде — в кадре (без лишней синхронной раскладки страницы)
  requestAnimationFrame(() => {
    const path = sb.querySelector('.sq-path'), cur = path?.querySelector('.sq-c:not(.got)');
    if (path && cur) path.scrollLeft = Math.max(0, cur.offsetLeft - path.offsetLeft - path.clientWidth / 3);
  });
}
// Профиль (свой): сезон и задания недели коротко
async function renderProfileQuests(uid, isOwn){
  const card = document.getElementById('profileQuestsCard'), box = document.getElementById('profileQuests');
  if (!card || !box) return;
  if (!isOwn || !uid) { card.hidden = true; return; }
  const h = await questLoad(false);
  if (!h?.season || !h?.weekly || !h.season.auth) { card.hidden = true; return; }
  const t = seasonThemeById(h.season.theme);
  box.innerHTML = `<div class="sq sq-in" style="--sc:${t ? t.color : '#ffd166'}">${seasonHtml(h.season, true)}</div><div class="sq sq-in sq-w">${weeklyHtml(h.weekly, true)}</div>
    <div class="sq-more"><a class="dq-btn ghost" href="/play">Все задания и награды сезона →</a></div>`;
  card.hidden = false;
}
// перерисовать то, что сейчас на экране (витрина «Игр» или свой профиль) — без лишних запросов на других страницах
function questsRerender(){
  const route = document.body.dataset.route;
  if (route === 'games' && !document.getElementById('gamesHub')?.hidden) renderQuests();
  if (route === 'profile' && !document.getElementById('profileQuestsCard')?.hidden && currentUser) renderProfileQuests(currentUser.id, true);
}
async function weeklyClaim(btn, code){
  if (!WEEKLY_QUESTS[code] || !currentUser) return;
  btn.disabled = true;
  const { data } = await sbClient.rpc('claim_weekly_quest', { p_code: code });
  if (data?.ok) {
    gameToast(`📅 Задание недели: +${data.xp} XP · +${data.coins} 🪙 · +${data.pts} ⭐`); gameSfx('win');
    if (typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
    window.D37Coins?.sync?.();
  } else if (data?.reason === 'not_done') gameToast('Задание ещё не выполнено — сервер видит только сыгранное с входом в аккаунт');
  await questLoad(true); questsRerender();
}
async function seasonClaim(btn, no){
  if (!currentUser) return;
  btn.disabled = true;
  const { data } = await sbClient.rpc('season_claim', { p_no: no ?? null });
  if (data?.ok && data.got?.length) {
    const bits = [];
    if (data.coins) bits.push(`+${data.coins} 🪙`);
    for (const g of data.got) {
      if (g.item && !g.dup) { const it = seasonItem(g.item); bits.push(`${it.v} ${it.name}`); }
      if (g.frame && !g.dup) bits.push('🖼 рамка');
      if (g.title) bits.push('🏷 титул');
    }
    gameToast(`🏆 Награды сезона: ${bits.join(' · ')}`); gameSfx('win');
    window.D37Coins?.sync?.();   // монеты и вещи (гардероб)
  } else if (data && !data.ok) gameToast(data.reason === 'coins' ? 'Монеты пока недоступны — попробуй позже' : 'Не получилось — попробуй ещё раз');
  await questLoad(true); questsRerender();
}
async function seasonSetTitle(btn, code){
  if (!currentUser) return;
  btn.disabled = true;
  const { data } = code ? await sbClient.rpc('season_title_set', { p_code: code }) : await sbClient.rpc('set_title', { p_code: null });
  if (data?.ok) {
    if (typeof xpTitleCache !== 'undefined') xpTitleCache.set(currentUser.id, code || null);
    gameToast(code ? `🏷 Титул: ${seasonTitleDef(code)?.title || ''}` : 'Титул снят');
  }
  await questLoad(true); questsRerender();
}
async function seasonSetFrame(btn, theme){
  if (!currentUser) return;
  btn.disabled = true;
  const { data } = await sbClient.rpc('season_frame_set', { p_theme: theme || '' });
  if (data?.ok) { seasonFrameCache.set(currentUser.id, theme || null); gameToast(theme ? '🖼 Рамка сезона надета' : 'Снова рамка уровня'); }
  await questLoad(true); questsRerender();
}
// Надетые рамки сезонов — пачкой, с кэшем (для applyLevelFrame в xp.js)
const seasonFrameCache = new Map();
let seasonFrameQ = new Map(), seasonFrameT = 0, seasonFrameOff = false;
function seasonFrameOf(uid){
  if (!uid || seasonFrameOff || typeof sbClient === 'undefined' || !sbClient) return Promise.resolve(null);
  if (seasonFrameCache.has(uid)) return Promise.resolve(seasonFrameCache.get(uid));
  return new Promise(res => {
    if (!seasonFrameQ.has(uid)) seasonFrameQ.set(uid, []);
    seasonFrameQ.get(uid).push(res);
    clearTimeout(seasonFrameT);
    seasonFrameT = setTimeout(async () => {
      const q = seasonFrameQ; seasonFrameQ = new Map();
      const got = new Map();
      try {
        const { data, error } = await sbClient.rpc('season_frames', { p_ids: [...q.keys()].slice(0, 200) });
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) seasonFrameOff = true; }
        else (data || []).forEach(r => { if (seasonThemeById(r.theme)) got.set(r.user_id, r.theme); });
      } catch (e) {}
      for (const [id, fns] of q) { const v = got.get(id) || null; seasonFrameCache.set(id, v); fns.forEach(f => f(v)); }
    }, 60);
  });
}
// После партии (не чаще раза в 45 с): задание недели выполнено или новый уровень сезона — подсказка
async function questAfterGame(){
  if (questOff || !currentUser || Date.now() - questHintAt < 45e3) return;
  questHintAt = Date.now();
  const prev = questHub, h = await questLoad(true);
  if (!h || !prev) return;
  const fresh = (h.weekly?.list || []).find(q => q.done && !q.claimed && !(prev.weekly?.list || []).some(p => p.code === q.code && p.done));
  if (fresh && WEEKLY_QUESTS[fresh.code]) setTimeout(() => gameToast(`📅 Задание недели выполнено: «${WEEKLY_QUESTS[fresh.code].text}» — забери награду в «Играх»`), 2600);
  else if (seasonLv(h.season) > seasonLv(prev.season)) setTimeout(() => gameToast(`🏆 Сезон: уровень ${seasonLv(h.season)}! Награда ждёт в «Играх»`), 2600);
}
window.addEventListener('d37:auth', () => { questHub = null; questAt = 0; seasonFrameCache.clear(); setTimeout(questsRerender, 700); });

let gamesParam = null;
async function openGame(id, param){
  const g = GAMES.find(x => x.id === id) || GAMES_HIDDEN.find(x => x.id === id);
  const hub = document.getElementById('gamesHub');
  const stage = document.getElementById('gamesStage');
  const box = document.getElementById('gamesStageBox');
  if (!g || !stage) return;
  if (gamesActive === id && gamesParam === (param || null) && box.childElementCount) return;
  unmountActiveGame();
  gamesActive = id;
  gamesParam = param || null;
  hub.hidden = true; stage.hidden = false;
  document.body.classList.add('game-on');   // телефон: нижнее меню прячем (CSS) — под ним была клавиша «ВВОД» в «5 букв»
  // узкий телефон — без названия, только значок и возраст (.gm-tt — gamekit.js)
  document.getElementById('gamesStageTitle').innerHTML = `${g.icon} <span class="gm-tt">${esc(g.title)}</span>${window.D37Age && g.age ? ' ' + D37Age.badge(g.age, { title: g.ageWhy || 'Без ограничений' }) : ''}`;
  // полный экран и настройки (js/core/fullscreen.js, settings.js): телефон лёжа — игра во весь экран; «во весь экран при запуске»
  stage.dataset.game = id; gamesSyncMute();
  window.D37Full?.auto(stage);
  if (window.D37Settings?.get('autoFull') && !window.D37Full?.active()) window.D37Full?.enter(stage);
  // «Игра поверх мира»: пришли сюда из «Мира Денчика» (и после перезагрузки) — в шапке «↩ В мир» (js/games/mir-play.js)
  try { if (id !== 'world' && sessionStorage.getItem('d37_from_world')) gamesLoadScript('js/games/mir-play.js').then(() => window.MirPlay?.shell(), () => {}); } catch (e) {}
  // Возраст (js/core/age.js): игра не по возрасту — «обложка» вместо игры (12+/16+ — «Взрослый разрешил» до конца визита)
  if (window.D37Age?.cover(box, g.age, { why: g.ageWhy, title: `${g.icon} ${g.title}`, back: () => closeGame(), onOpen: () => { gamesActive = null; openGame(id, param); } })) return;
  box.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Загружаем игру…</div>';
  const adL = window.D37AdPlaces?.loading({ anchor: box.firstChild, game: id, param: gamesParam });   // реклама, если грузится дольше 1,5 с (ad-places.js)
  try {
    for (const s of g.scripts) await gamesLoadScript(s);
    if (gamesActive !== id) return;   // пока грузилось, ушли на другую игру
    box.innerHTML = '';
    GAME_IMPL[id].mount(box, { ...gamesApi(id), param: gamesParam });
    gamesFitSoon();   // телефон лёжа во весь экран — игру подогнать по высоте
    window.scrollTo({ top: document.getElementById('games-page').offsetTop - 70, behavior: 'smooth' });
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><span class="empty-state-icon">😵</span><div class="empty-state-title">Игра не загрузилась</div><div class="empty-state-text">Проверь интернет и обнови страницу.</div></div>`;
  } finally { adL?.done(); }
}

function closeGame(fromRouter){
  unmountActiveGame();
  gamesActive = null;
  document.body.classList.remove('game-on');
  const hub = document.getElementById('gamesHub');
  const stage = document.getElementById('gamesStage');
  gamesFullOff(stage);
  if (hub) hub.hidden = false;
  if (stage) stage.hidden = true;
  const grid = document.getElementById('gamesGrid');
  if (grid) delete grid.dataset.ready;   // перерисовать рекорды
  renderGamesHub();
  if (!fromRouter) location.hash = '#/games';
}

function unmountActiveGame(){
  if (gamesActive && GAME_IMPL[gamesActive]?.unmount) {
    try { GAME_IMPL[gamesActive].unmount(); } catch (e) {}
  }
  const box = document.getElementById('gamesStageBox');
  if (box) box.innerHTML = '';
  document.getElementById('gamesStage')?.classList.remove('gm-own-bar');   // своя панель игры (мир) — снова шапка игры
}
// Ушли со страницы игр — останавливаем таймеры/анимации игры
window.addEventListener('d37:route', () => {
  if (gamesActive && !/^#\/games/.test(D37Route.hash())) { unmountActiveGame(); gamesActive = null; }
  if (!/^#\/games\/./.test(D37Route.hash())) { document.body.classList.remove('game-on'); gamesFullOff(document.getElementById('gamesStage')); }
});
// Игру закрыли — выйти из полного экрана и не ждать поворота телефона (js/core/fullscreen.js)
function gamesFullOff(stage){
  window.D37Full?.auto(null);
  if (stage) { window.D37Full?.release(stage); delete stage.dataset.game; }
}
// Полный экран на телефоне лёжа (html.gs-compact): игра выше экрана — уменьшаем её целиком (transform: на нажатия не
// влияет — игры считают их по getBoundingClientRect), чтобы влезла без прокрутки. У 3D-мира, Студии, «Орды» и Unity размер свой.
const GAMES_NOFIT = new Set(['world', 'studio3d', 'horde', 'unity', 'podzem', 'kletochki', 'chervyachki']);
let gamesFitT = 0, gamesFitRO = null, gamesFitMO = null;
function gamesFit(){
  const box = document.getElementById('gamesStageBox'), stage = document.getElementById('gamesStage');
  if (!box || !stage) return;
  box.style.transform = ''; box.classList.remove('gm-fit');
  if (!document.documentElement.classList.contains('gs-compact') || !stage.classList.contains('gs-fs') || !gamesActive || GAMES_NOFIT.has(gamesActive)) return;
  // размер игры — по её верхним блокам (scrollHeight врёт из-за спрятанных окошек внутри), место — по рамке (без полос прокрутки)
  const r0 = box.getBoundingClientRect(), st = box.scrollTop, sl = box.scrollLeft;
  let bottom = 0, right = 0;
  for (const c of box.children) {
    const r = c.getBoundingClientRect(); if (!r.width && !r.height) continue;
    bottom = Math.max(bottom, r.bottom - r0.top + st + (parseFloat(getComputedStyle(c).marginBottom) || 0));
    right = Math.max(right, r.right - r0.left + sl);
  }
  if (!bottom || !r0.height) return;
  const s = Math.min(1, r0.height / bottom, r0.width / Math.max(right, 1));
  if (s > .985) return;
  if (s < .45) return;   // совсем не влезает — пусть прокручивается, мелко не делаем
  box.scrollTop = 0; box.scrollLeft = 0;
  box.style.transform = `scale(${s.toFixed(4)})`; box.classList.add('gm-fit');
}
function gamesFitSoon(){
  clearTimeout(gamesFitT); gamesFitT = setTimeout(gamesFit, 90);
  // игра перерисовалась (другой уровень, раздача) — подогнать заново; следим за размерами верхних блоков игры
  const box = document.getElementById('gamesStageBox');
  if (!box || !window.ResizeObserver) return;
  if (!gamesFitRO) gamesFitRO = new ResizeObserver(() => { clearTimeout(gamesFitT); gamesFitT = setTimeout(gamesFit, 90); });
  gamesFitRO.disconnect();
  if (document.documentElement.classList.contains('gs-compact')) for (const c of box.children) gamesFitRO.observe(c);
  if (!gamesFitMO && window.MutationObserver) { gamesFitMO = new MutationObserver(() => { if (document.documentElement.classList.contains('gs-compact')) gamesFitSoon(); }); gamesFitMO.observe(box, { childList: true }); }
}
window.addEventListener('d37:fullscreen', gamesFitSoon);
window.addEventListener('resize', () => { if (document.documentElement.classList.contains('gs-compact') || document.getElementById('gamesStageBox')?.classList.contains('gm-fit')) gamesFitSoon(); });

// ── Локальная статистика (работает и без входа) ──
function gameLocalStats(id){
  try { return JSON.parse(localStorage.getItem('d37_game_' + id) || '{}'); } catch (e) { return {}; }
}
function gameSaveLocal(id, patch){
  const st = { plays: 0, wins: 0, best: 0, ...gameLocalStats(id), ...patch };
  try { localStorage.setItem('d37_game_' + id, JSON.stringify(st)); } catch (e) {}
  return st;
}
function gameBestLabel(id, best){
  if (id === 'reaction') return `${1000 - best} мс`;
  if (id === 'guess') return `${best}/10`;
  if (id === 'cities') return `цепочка ${best}`;
  if (id === 'ttt') return best >= 2 ? 'победа над непобедимым' : best >= 1 ? 'ничья с непобедимым' : '—';
  if (id === 'checkers') return `${best} ${best === 1 ? 'шашка' : best < 5 ? 'шашки' : 'шашек'} в победе`;
  if (id === 'catch') return `${Number(best).toLocaleString('ru')} очков`;
  if (id === 'sea') return `${best} из 20 палуб`;
  if (id === 'snake') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'яблоко' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'яблока' : 'яблок'}`;
  if (id === 'kubomir') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'достижение' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'достижения' : 'достижений'}`;
  if (id === 'podzem') return `${Number(best).toLocaleString('ru')} м вглубь`;   // «Подземье»: рекорд глубины, метры
  if (id === 'kletochki') return `масса ${Number(best).toLocaleString('ru')}`;     // лучшая масса за жизнь
  if (id === 'chervyachki') return `длина ${Number(best).toLocaleString('ru')}`;   // лучшая длина за жизнь
  if (['krokodil', 'balda', 'domino', 'fillword'].includes(id)) return `${Number(best).toLocaleString('ru')} ${best % 10 === 1 && best % 100 !== 11 ? 'очко' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'очка' : 'очков'}`;
  if (id === 'memory' || id === 'emoji' || id === 'horde' || id === 'td' || id === 'uno' || id === 'blocks' || id === 'kosynka' || id === 'pauk' || id === 'freecell' || id === 'miner' || id === 'mahjong' || id === 'sudoku') return `${Number(best).toLocaleString('ru')} очков`;
  if (id === 'chess') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'arena') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'nardy') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'ludo') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'pool') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'durak') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'победа' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'победы' : 'побед'}`;
  if (id === 'words') return `с ${7 - best}-й попытки`;
  return String(best);
}

// ── API для игр ──
let gamesGuestHint = false;
const gamesCapHint = new Set();   // подсказки «XP на сегодня — всё» уже показаны ('game' | 'day')
function gamesApi(id){
  return {
    id,
    // key — ключ для сервера (напр. 'cities_hard'), localBest — число для витрины (чем больше, тем лучше)
    async report(key, win, score, localBest){
      try { window.dispatchEvent(new CustomEvent('d37:game', { detail: { id, key, win: !!win, score: +score || 0 } })); } catch (e) {}   // сыграл (новогоднее задание и др.)
      const prev = gameLocalStats(id);
      const lb = localBest ?? score;
      const isRecord = lb > (prev.best || 0);
      if (win || (isRecord && lb > 0)) gamesSupport(id, isRecord && lb > 0);
      gamesAdAfterRound();
      gameSaveLocal(id, { plays: (prev.plays || 0) + 1, wins: (prev.wins || 0) + (win ? 1 : 0), best: Math.max(prev.best || 0, lb) });
      if (!currentUser || !sbClient) {
        if (!gamesGuestHint) { gamesGuestHint = true; gameToast('🔑 Войди — и за победы будут XP, а рекорды попадут в таблицу'); }
        else if (isRecord) gameToast('🏆 Новый личный рекорд!');
        return null;
      }
      try {
        const { data, error } = await sbClient.rpc('game_result', { p_game: key, p_win: !!win, p_score: Math.round(score) || 0 });
        if (error || !data?.ok) { if (isRecord) gameToast('🏆 Новый личный рекорд!'); return null; }
        const parts = [];
        if (data.xp > 0) parts.push(`+${data.xp} XP`);
        if (data.record) parts.push('🏆 рекорд!');
        // победа без XP — лимит (economy.sql game_xp_award): говорим один раз за визит, почему
        if (win && !data.xp && data.xp_cap && !gamesCapHint.has(data.xp_cap)) {
          gamesCapHint.add(data.xp_cap);
          parts.push(data.xp_cap === 'game' ? `XP за эту игру сегодня — всё (${typeof XP_NUM !== 'undefined' ? XP_NUM.game_family : 3} победы), попробуй другую`
            : `XP за игры сегодня — всё (${typeof XP_NUM !== 'undefined' ? XP_NUM.game_day : 100}), рекорды и монеты — как обычно`);
        }
        if (parts.length) gameToast(parts.join(' · '));
        if (data.xp > 0 && typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
        if (typeof claimAchievements === 'function') setTimeout(claimAchievements, 800);   // игровые ачивки
        dailyQuestHint();
        questAfterGame();   // задание недели выполнено / новый уровень сезона — подсказка (не чаще раза в 45 с)
        return data;
      } catch (e) { return null; }
    },
    toast: gameToast,
    local: () => gameLocalStats(id),
    saveLocal: patch => gameSaveLocal(id, patch),
    sfx: gameSfx,
  };
}

// ── «Поддержать стрим» / «Позвать друга» — в моменты радости (победа, рекорд) ──
// Не чаще раза в 10 минут и не больше 3 раз за визит; крестик скрывает до конца визита.
let gamesSupportShown = 0, gamesSupportAt = 0, gamesSupportOff = false;
function gamesSupport(id, record){
  if (gamesSupportOff || gamesSupportShown >= 3 || Date.now() - gamesSupportAt < 10 * 60 * 1000) return;
  const stage = document.getElementById('gamesStage');
  if (!stage || stage.hidden) return;
  gamesSupportShown++; gamesSupportAt = Date.now();
  let box = document.getElementById('gamesSupport');
  if (!box) { box = document.createElement('div'); box.id = 'gamesSupport'; box.className = 'gm-support'; stage.appendChild(box); }
  const g = GAMES.find(x => x.id === id);
  box.hidden = false;
  box.innerHTML = `<div>${record ? '🏆 <b>Новый рекорд!</b>' : '🎉 <b>Победа!</b>'} Нравятся игры? Их делает стример dan4ik37 —
      поддержи стрим донатом (взамен — спасибо и статус <a href="/vip">«💛 Донатер»</a>) или позови друга сыграть.</div>
    <a class="sp-don" href="https://www.donationalerts.com/r/dan4ik37" target="_blank" rel="noopener">💜 Поддержать</a>
    <button class="sp-share" type="button">🔗 Позвать друга</button>
    <button class="sp-x" type="button" aria-label="Скрыть">✕</button>`;
  box.querySelector('.sp-x').onclick = () => { box.hidden = true; gamesSupportOff = true; };
  box.querySelector('.sp-share').onclick = e => gamesChallenge(e.target, id);
  if (typeof window.va === 'function') window.va('event', { name: 'game_support_shown', data: { game: id } });
}
// «📣 Вызов» — ссылка на страницу игры с лучшим результатом: в Telegram/ВК превью «Ник набрал N — побьёшь?»
async function gamesChallenge(btn, id = gamesActive){
  if (!id) return;
  const g = GAMES.find(x => x.id === id);
  const best = gameLocalStats(id).best || 0;
  const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || '';
  const url = (window.D37Ref?.wrap || (u => u))(location.origin + '/games/' + id + (best > 0 ? `?s=${best}&n=${encodeURIComponent(nick || 'Друг')}` : ''));   // 👥 с кодом приглашения
  const text = best > 0 ? `Мой рекорд в «${g?.title || 'игре'}» — ${gameBestLabel(id, best)}. Побьёшь?` : `Сыграй со мной в «${g?.title || 'игру'}» на сайте dan4ik37!`;
  if (typeof window.va === 'function') window.va('event', { name: 'game_challenge', data: { game: id } });
  if (navigator.share) { navigator.share({ title: g?.title || 'Игры', text, url }).catch(() => {}); return; }
  const old = btn.innerHTML;
  try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; setTimeout(() => { btn.innerHTML = old; }, 1800); }
  catch (e) { prompt('Скопируй ссылку и отправь другу:', url); }
}

// Уходим из игры — плашку прячем
window.addEventListener('d37:route', () => { ['gamesSupport', 'gamesAd'].forEach(id => { const b = document.getElementById(id); if (b) b.hidden = true; }); gamesAdAt = 0; });

// ── «Сегодня на сайте» (главная) и точка на «Игры» в нижнем меню ──
// Слово дня «5 букв»: номер дня — как в js/games/words.js (день №1 = 03.10.2026, смена в полночь МСК).
// Прогресс дня words.js пишет в localStorage d37_words_day — отсюда видно, сыграно ли сегодня.
function wordsDayNo(){ return Math.floor((Date.now() + 3 * 3600e3) / 864e5) - Math.floor(Date.UTC(2026, 9, 3) / 864e5) + 1; }
// «Судоку дня»: номер и итог (как в js/games/sudoku.js: день №1 = 10.10.2026 по МСК)
function sudokuDayNo(){ return Math.floor((Date.now() + 3 * 3600e3 - Date.UTC(2026, 9, 10)) / 864e5) + 1; }
function sudokuToday(){
  try { const d = JSON.parse(localStorage.getItem('d37_sudoku_daily')); return d && d.day === sudokuDayNo() ? d : null; } catch (e) { return null; }
}
// «Филворд дня»: номер и итог (как в js/games/fillword.js: день №1 = 15.10.2026 по МСК)
function fillwordDayNo(){ return Math.floor((Date.now() + 3 * 3600e3 - Date.UTC(2026, 9, 15)) / 864e5) + 1; }
function fillwordToday(){
  try { const d = JSON.parse(localStorage.getItem('d37_fillword_daily')); return d && d.day === fillwordDayNo() ? d : null; } catch (e) { return null; }
}
function wordsToday(){
  try { const s = JSON.parse(localStorage.getItem('d37_words_day')); return s && s.n === wordsDayNo() ? s : null; } catch (e) { return null; }
}
function gamesDailyDot(){
  const dot = document.getElementById('btGamesDot');
  if (dot) dot.hidden = !!wordsToday()?.done;
}
// «🆕 Новое на сайте» над «Сегодня на сайте»: один раз на каждую пачку новинок (WHATSNEW_VER), закрыл ✕ — не показываем.
// Для тех, кто заходил раньше и не знает про новые разделы. Новая пачка → поднять версию и поменять список.
const WHATSNEW_VER = '2026-10-22a';
const WHATSNEW = [['#/games/kletochki', '🦠', 'Клеточки — ешь и расти онлайн'], ['#/games/chervyachki', '🐛', 'Червячки — расти и подрезай'], ['#/games/podzem', '⛏', 'Подземье — копай, строй, бейся с боссами'], ['#/games/krokodil', '🐊', 'Крокодил — рисуй и угадывай компанией'], ['#/games/fillword', '🔎', 'Филворд дня'], ['#/games/balda', '🔠', 'Балда — игра в слова'], ['#/games/domino', '🐐', 'Домино «Козёл»'], ['#/games/unity', '🕹️', 'Unity-игры — выложи свою игру из Unity'], ['#/games/studio3d', '🧱', 'Студия 3D — построй свой мир со скриптами'], ['#/games/world', '🌍', 'Мир Денчика 3D: кафе, столики с играми, домики'], ['#/games/studio', '🛠️', 'Студия игр — сделай свою игру'], ['#/games/wardrobe', '🎭', '3D-персонаж: тело, одежда, любые цвета'], ['#/games/sudoku', '🔢', 'Судоку дня'], ['#/games/mahjong', '🀄', 'Маджонг Коннект'], ['#/games/miner', '💣', 'Сапёр'], ['#/games/kosynka', '♥️', 'Косынка'], ['#/games/pauk', '🕷️', 'Паук'], ['#/games/freecell', '♣️', 'Свободная ячейка'], ['#/games/blocks', '🟦', 'Блоки — как Block Blast'], ['#/games/chess', '♟️', 'Шахматы'], ['#/games/arena', '🔫', 'Арена 1 на 1'], ['#/games/nardy', '🎯', 'Нарды'], ['#/games/ludo', '🎲', 'Лудо'], ['#/games/pool', '🎱', 'Бильярд'], ['#/games/durak', '♠️', 'Дурак онлайн'], ['#/games/uno', '🃏', 'Одна! — карты как Уно'], ['#/games/horde', '🧟', 'Орда — выживание'], ['#/games/td', '🏰', 'Башни — защита замка'], ['#/games/emoji', '🤔', 'Угадай игру по эмодзи'], ['/quiz', '🧩', 'Тесты «Кто ты из игр»'], ['#/games/words/archive', '📚', 'Архив «5 букв»'], ['/tools/wheel', '🎡', 'Колесо фортуны'], ['/tools/fonts', '✒️', 'Шрифты для ника'], ['/tools/random', '🔢', 'Рандомайзер'], ['/tools/cps', '🖱', 'CPS тест'], ['/top', '🏆', 'Лучшие видео']];
function whatsNewHtml(){
  let seen = ''; try { seen = localStorage.getItem('d37_whatsnew') || ''; } catch (e) {}
  if (seen === WHATSNEW_VER) return '';
  return `<div class="whatsnew" id="whatsNew"><b>🆕 Новое на сайте</b><div class="wn-links">${WHATSNEW.slice(0, 10).map(([h, ic, t]) => `<a href="${D37Route.href(h)}">${ic} ${esc(t)}</a>`).join('')}<a href="/play">🎮 Все игры →</a></div>
    <button type="button" class="wn-x" aria-label="Скрыть" onclick="hideWhatsNew()">✕</button></div>`;
}
function hideWhatsNew(){ try { localStorage.setItem('d37_whatsnew', WHATSNEW_VER); } catch (e) {} document.getElementById('whatsNew')?.remove(); }

// «Тест дня» на главной — по кругу от номера дня (тесты — api/_lib/quizzes.js, страницы /quiz/<slug>)
const QUIZ_DAY = [['minecraft', '⛏', 'Какой ты моб из Майнкрафта?'], ['fnaf', '🐻', 'Кто ты из FNAF?'], ['game', '🕹', 'Какая ты игра?'], ['roblox', '🟨', 'Кто ты в Роблоксе?'], ['poppy', '🧸', 'Кто ты из Poppy Playtime?'], ['cs2', '🎯', 'Какая ты роль в CS2?'], ['horror', '👻', 'Кто ты в хоррор-игре?'], ['hollow-knight', '🗡', 'Кто ты из Hollow Knight?'], ['streamer', '🎙', 'Какой ты стример?'], ['viewer', '📺', 'Какой ты зритель dan4ik37?']];

function renderToday(){
  const box = document.getElementById('today');
  if (!box) return;
  const s = wordsToday();
  const state = !s ? 'Угадай слово из 5 букв — новое каждый день'
    : s.done ? (s.win ? `✅ Угадано с ${s.rows.length}-й попытки · завтра новое` : '❌ Не угадано · завтра новое слово')
    : `Попытка ${s.rows.length + 1} из 6 — доиграй!`;
  const qz = QUIZ_DAY[wordsDayNo() % QUIZ_DAY.length], sd = sudokuToday(), fw = fillwordToday();
  const mmss = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  box.innerHTML = whatsNewHtml() + `<a class="today-online" id="todayOnline" href="/chat" hidden></a><div class="today-grid">
      <a class="today-card hot-slot${s?.done ? '' : ' hot'}" href="/play/words"><span class="ti">🔤</span><span class="tt"><b>Слово дня #${wordsDayNo()}</b><small>${esc(state)}</small></span></a>
      <a class="today-card" href="/quiz/${qz[0]}"><span class="ti">${qz[1]}</span><span class="tt"><b>Тест дня</b><small>${esc(qz[2])}</small></span></a>
      <a class="today-card${fw ? '' : ' hot'}" href="/play/fillword/daily"><span class="ti">🔎</span><span class="tt"><b>Филворд дня #${fillwordDayNo()}</b><small>${fw ? `✅ Решён за ${mmss(fw.sec)} · завтра новый` : 'Найди все слова — одно поле на всех'}</small></span></a>
      <a class="today-card${sd ? '' : ' hot'}" href="/play/sudoku"><span class="ti">🔢</span><span class="tt"><b>Судоку дня #${sudokuDayNo()}</b><small>${sd ? (sd.won ? `✅ Решено за ${mmss(sd.sec)} · завтра новое` : '❌ Не решено · завтра новое') : 'Одно на всех — кто решит быстрее?'}</small></span></a>
      ${window.__d37Daily ? `<a class="today-card today-vid" href="/v/${esc(window.__d37Daily.id)}"><span class="ti">🎬</span><span class="tt"><b>Видео дня</b><small>${esc(window.__d37Daily.title)}</small></span></a>`
        : '<a class="today-card" href="/top"><span class="ti">🏆</span><span class="tt"><b>Лучшие видео</b><small>Самые популярные ролики канала</small></span></a>'}
      <button type="button" class="today-card" onclick="d37Surprise(this)"><span class="ti">🎲</span><span class="tt"><b>Удиви меня</b><small>Случайное видео из почти 6000</small></span></button>
    </div>`;
  gamesDailyDot();
  renderTodayOnline();
}
// «🟢 Сейчас на сайте: N» — только если кроме тебя есть кто-то ещё (иначе «1 на сайте» выглядит пусто)
function renderTodayOnline(){
  const el = document.getElementById('todayOnline');
  if (!el) return;
  const n = window.__d37Online || 0;
  el.hidden = n < 2;
  el.innerHTML = `<i></i>Сейчас на сайте: <b>${n}</b> — заходи в чат →`;
}
window.addEventListener('d37:online', renderTodayOnline);
window.addEventListener('d37:daily', () => { if (document.body.dataset.route === 'home') renderToday(); });
window.gamesDailyDot = gamesDailyDot;
gamesDailyDot();
// Полночь по МСК: обновить точку и карточку, если сайт открыт долго
setInterval(() => { gamesDailyDot(); if (document.body.dataset.route === 'home') renderToday(); }, 5 * 60e3);

// ── Игровая статистика в профиле (#profileGameStatsCard) ──
// game_stats читают все (games.sql). Ключи вида cities_hard / words_duel → игра по префиксу из GAMES.
// Лучший результат — по ключу рекордов игры (GAMES[].top), как в таблице рекордов.
async function renderProfileGameStats(uid, isOwn){
  const card = document.getElementById('profileGameStatsCard');
  if (!card) return;
  card.hidden = true;
  if (!uid || !sbClient) return;
  const { data, error } = await sbClient.from('game_stats').select('game,plays,wins,best_score').eq('user_id', uid);
  if (error || !data) return;
  const rows = [];
  let plays = 0, wins = 0;
  for (const g of GAMES.filter(x => !x.href)) {
    const mine = data.filter(r => r.game.startsWith(g.id) && /^(_|\d|$)/.test(r.game.slice(g.id.length)));
    if (!mine.length) continue;
    const p = mine.reduce((s, r) => s + (r.plays || 0), 0), w = mine.reduce((s, r) => s + (r.wins || 0), 0);
    plays += p; wins += w;
    const top = mine.find(r => r.game === g.top);
    rows.push({ g, p, w, best: top && top.best_score > 0 ? gameBestLabel(g.id, top.best_score) : '' });
  }
  if (!rows.length && !isOwn) return;
  card.hidden = false;
  const box = document.getElementById('profileGameStats');
  document.getElementById('profileGameStatsSum').textContent = plays ? `${plays} ${plays % 10 === 1 && plays % 100 !== 11 ? 'партия' : [2, 3, 4].includes(plays % 10) && ![12, 13, 14].includes(plays % 100) ? 'партии' : 'партий'} · ${wins} побед` : '';
  box.innerHTML = rows.length ? rows.sort((a, b) => b.p - a.p).map(r => `<a class="pgs-item" href="/play/${r.g.id}" style="--gc:${r.g.color}">
      <span class="pgs-ic">${r.g.icon}</span>
      <span class="pgs-txt"><b>${esc(r.g.title)}</b><small>${r.p} игр · ${r.w} побед${r.best ? ' · 🏆 ' + esc(r.best) : ''}</small></span></a>`).join('')
    : '<div class="pgs-empty">Ещё не играл. <a href="/play">Сыграй во что-нибудь</a> — за победы дают XP, а рекорды попадут сюда.</div>';
}

// После партии: если задание дня выполнено и не забрано — напомнить
async function dailyQuestHint(){
  try {
    const { data } = await sbClient.rpc('daily_quest');
    if (data?.done && !data.claimed) setTimeout(() => gameToast(`🎯 Задание дня выполнено — забери ${dailyQuestPrize()} в «Играх»`), 1800);
  } catch (e) {}
}

function gameToast(text){
  if (typeof xpToast === 'function') { xpToast(text); return; }
  alert(text);
}

// Короткий звук (Web Audio), если у пользователя не выключен звук сайта
let gameAudioCtx = null;
function gameSfx(kind){
  try {
    if (localStorage.getItem('d37_games_mute') === '1') return;
    const k = window.D37Settings ? D37Settings.sfxGain() : 1;   // громкость: ⚙️ Настройки → Звук (общая × эффекты)
    if (k < .01) return;
    gameAudioCtx = gameAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = gameAudioCtx, o = ctx.createOscillator(), g = ctx.createGain();
    const map = { ok: [660, .08], bad: [180, .18], win: [880, .25], tick: [520, .03], move: [420, .04] };
    const [f, d] = map[kind] || map.tick;
    o.type = kind === 'bad' ? 'sawtooth' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(.07 * k, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + d);
    if (kind === 'win') setTimeout(() => gameSfx('ok'), 120);
  } catch (e) {}
}
function toggleGamesMute(btn){
  const muted = localStorage.getItem('d37_games_mute') === '1';
  if (window.D37Settings) D37Settings.set('mute', !muted);   // то же, что «Звук в играх» в ⚙️ Настройках
  else try { localStorage.setItem('d37_games_mute', muted ? '0' : '1'); } catch (e) {}
  gamesSyncMute();
}
// Кнопка 🔊/🔇 в шапке игры — по настоящему состоянию (раньше при входе всегда показывала 🔊)
function gamesSyncMute(){
  const b = document.getElementById('gamesMuteBtn'); if (!b) return;
  let m = false; try { m = localStorage.getItem('d37_games_mute') === '1'; } catch (e) {}
  b.textContent = m ? '🔇' : '🔊';
  b.title = m ? 'Звук выключен — включить' : 'Звук включён — выключить';
}
window.addEventListener('d37:settings', e => { if (['mute', '*'].includes(e.detail?.key)) gamesSyncMute(); });

// Побед в дуэлях с живыми соперниками (все игры) — за 7 дней или за всё время
async function renderDuelTop(list){
  const { data, error } = await sbClient.rpc('duel_top', { p_week: gamesTopWeek, lim: 10 });
  if (error) { list.innerHTML = '<div class="gm-top-empty">Таблица чемпионов скоро появится</div>'; return; }
  document.getElementById('gamesTopBox').hidden = false;
  if (!data?.length) { list.innerHTML = '<div class="gm-top-empty">Ещё никто не побеждал в дуэлях — позови друга по ссылке из любой игры!</div>'; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="gm-top-item" data-uid="${esc(r.user_id)}">
      <span class="gm-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="gm-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span>
      <span class="gm-top-score">${r.wins} ${r.wins % 10 === 1 && r.wins % 100 !== 11 ? 'победа' : [2, 3, 4].includes(r.wins % 10) && ![12, 13, 14].includes(r.wins % 100) ? 'победы' : 'побед'} из ${r.played}</span>
    </li>`).join('') + '<div class="gm-top-note">Дуэли: «Города», шашки и крестики-нолики онлайн, соревнования в остальных играх</div>';
  if (typeof xpQueueBadges === 'function') xpQueueBadges();
}

// ── Таблица рекордов ──
function setGamesTop(key){
  gamesTopKey = key;
  document.querySelectorAll('#gamesTopTabs .gm-tab').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  renderGamesTop();
}
function setGamesTopPeriod(week){
  gamesTopWeek = week;
  document.querySelectorAll('#gamesTopPeriod button').forEach(b => b.classList.toggle('active', (b.dataset.week === '1') === week));
  renderGamesTop();
}
async function renderGamesTop(){
  const list = document.getElementById('gamesTopList');
  if (!list) return;
  if (!sbClient) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="gm-top-empty">Загрузка…</div>';
  if (gamesTopKey === 'duels') return renderDuelTop(list);
  const g = GAMES.find(x => x.top === gamesTopKey);
  let { data, error } = gamesTopWeek
    ? await sbClient.rpc('game_top_week', { p_game: gamesTopKey, lim: 10 })
    : await sbClient.rpc('game_top', { p_game: gamesTopKey, lim: 10 });
  if (error && gamesTopWeek) ({ data, error } = await sbClient.rpc('game_top', { p_game: gamesTopKey, lim: 10 }));   // старый games.sql без недельных
  if (error) { document.getElementById('gamesTopBox').hidden = true; return; }   // games.sql ещё не выполнен
  document.getElementById('gamesTopBox').hidden = false;
  if (!data?.length) { list.innerHTML = `<div class="gm-top-empty">${gamesTopWeek ? 'На этой неделе ещё никто не сыграл' : 'Пока никто не сыграл'} — стань первым!</div>`; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="gm-top-item">
      <span class="gm-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="gm-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span>
      <span class="gm-top-score">${esc(gameBestLabel(g.id, r.best_score))}</span>
    </li>`).join('') + `<div class="gm-top-note">${esc(g.title)}: ${esc(g.topLabel)}</div>`;
  if (typeof xpQueueBadges === 'function') xpQueueBadges();
  // персонажи из гардероба — рядом с ником (у кого собран)
  window.D37Char?.looksOf(data.map(r => r.user_id)).then(m => list.querySelectorAll('li[data-uid]').forEach(li => {
    const look = m[li.dataset.uid];
    if (look && !li.querySelector('.gm-top-char')) li.querySelector('.gm-top-nick')?.insertAdjacentHTML('beforebegin', `<img class="gm-top-char" alt="" src="${D37Char.img(look, 40)}">`);
  }));
}
