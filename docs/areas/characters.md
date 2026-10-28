<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Телефон в руке персонажа 📱 (как в ГТА; агент 15.10.2026)
- world3d.js (kit): слой телефона поверх любой позы (идёт/бежит, сидит, присел, прыжок — ноги свои; вода, лестница, вис, кувырок,
  паркур — телефон сразу в карман). Режимы: use (у груди, голова к экрану, палец стучит), call (у уха, плечо поднято, свободная рука
  жестикулирует), play (боком двумя руками), photo (двумя руками боком, «щёлк» со вспышкой). «Достать/убрать» — ch.phS.o 0…2 (1 — рука у
  кармана: телефон появляется, предмет из руки прячется; 2 — поза режима); убрать — тот же путь назад. Позы рук — двухзвенная рука
  (armIK/armFK) по размерам этого человечка (ch.phC). Корпус — общие геометрия/материалы, экран — картинка кодом (home/call/game/camera),
  свечение — только mid/high. API: o.phone ('' | use | call | play | photo | код 0…4; при snap — o.phoneK, спрайтам — o.phonePh),
  World3D.phonePose(ch, s), phoneSnap(ch, t), phoneCode/phoneName, K.phoneKeep(старый, новый), K.phoneView(ch) — от 1-го лица. Звуки —
  synth ph_pocket / ph_tap / ph_shutter (события ch.phS.ev). CHAR_VERSION 3 (кэш спрайтов перепечётся). Плечи — в ch.phS, не в позе
  (28 суставов, эталон char-test не трогать).
- actors.js: a.phone; a.fp = rig (1-е лицо → кисть с телефоном у камеры). phone.js: handFor(открыт, путь, звонок) → что в руке (camera →
  photo, game → play, разговор 1 на 1 → call и с закрытым экраном; компания/голосовой — без телефона). hooks.hand(s) → true, если
  показывает человечком: экран выезжает через 0,33 с (.ph-rise), закрыли — сначала экран, через 0,19 с персонаж убирает; события
  d37:hand (phone.js), d37:callstate (calls.js). Мини-игра «🐤 Птичка» (phone-apps.js, путь game). Телефон открыт в мире/студии — можно
  только идти (controls.js C.walk). Версия приложений телефона VER '2' (phone.js).
- Сеть: мир — поле ph (1…4) в 'st' (при смене; нет поля — 0) и 6-й элемент snap; presence не трогаем. Студия — net.js: телефон в
  старших битах байта паркура (pk | phone<<4) → «расширенная» часть снимка. Плоский мир (world.js) — сообщение 'ph' {s}, 📱/📞 у ника.
- Жители (npc.js, obj.phone; в мире — все FOLK): по расписанию от seed смотрят, говорят, играют; подошёл игрок — убирают
  (E.npcs.phoneAt). 2D-спрайты: анимации phone и call (char2d VER 2).
- Ограничения: у чиби короткие руки — у «малыша» (рост 0 + голова 4) телефон на щеке; фото — у груди, не у глаз; со спины телефон
  закрывает голова. Тесты: char-test (5274, в т. ч. --alloc-phone ≤ 32 байт), sprite-test, engine-test, net-test, community-test.

## 2D-персонаж — проекция настоящего 3D (js/core/char2d.js → D37Sprite; демо — js/games/sprite-view.js; агент 15.10.2026)
- Владелец 15.10: «2д персонажа проекцией настоящего с анимациями сбоку… под любое 2д и 2.5д»; «стилей можешь несколько». 3D-человечек
  (world3d.js) запекается в листы спрайтов. Виды: side (профиль; печём «влево», вправо — зеркало), iso4/iso8 (камера 32°; стороны 0 — к нам,
  2 — вправо, 4 — от нас; печём 0,7,6,5,4, правые — зеркало; opts.full — все), front (портрет). 26 анимаций: idle walk run jump fall crouch
  climb swim sit hurt use + 15 эмоций World3D.EMOTES с лицом (EMO_ANIM: эмодзи → анимация). 7 стилей: smooth toon flat pixel (16-бит)
  retro (8-бит, NES) sketch chibi; выбор игрока — гардероб «🎞 2D» или ⚙️ «🎞 2D-персонаж» (D37Settings 'spr2d', зеркало d37_spr_style),
  styleFor(стиль игры) — выбор игрока или стиль игры по умолчанию.
- Игре: H = D37Sprite.handle(look, { view, size, style: D37Sprite.styleFor('toon'), anims, key, noItem, pin }); каждый кадр
  H.draw(ctx, anim, t, x, y, { dir | flip, h, item, alpha }) — ноги в (x, y), h — «стандартный рост» в единицах ctx, item — эмодзи в кисть.
  Лист не готов / нет WebGL — старый D37Char.sprite/walker. Ещё: sheet() frame() pack() dir8 stats() budget() clear() myKey().
- Печь: один скрытый WebGLRenderer, по кадру в простое (сначала idle, остальное — по первому draw); мелкие листы (≤100 px) и пиксели —
  build(…, { lod: 1 }). PNG для кэша — в потоке. Память — LRU по байтам (64 МБ, слабые 24, свои — pin), IndexedDB «d37-sprites» (до 160
  листов): готовым листам Three.js не нужен (5 листов из кэша ~90 мс). Поменял позы/раскладку/стили — подними VER в char2d.js; персонаж в
  world3d.js поменялся — перепечётся сам (CHAR_VERSION + отпечаток кода kit в записи). Замер: ~2 мс ЦП на кадр, ~55 мс на лист; первый
  idle с нуля ~1 с (грузит Three.js).
- ВСЕ обращения к World3D — раздел «Переходник» (W3) в char2d.js: kit(T,{q}), build(look,key,{lod}), animate(…,{ snap: true }) на каждом
  кадре, кости body/torso/headP/arm/elbow/hand/leg/knee, предмет — handR; время «заморожено» (T0 ± 0,1) — циклы замкнуты. W3_KEYED — части,
  которые resolve() берёт по ключу игрока (тогда ключ входит в ключ кэша).
- Где: плоский мир (world.js, iso8, эмоции чата, ≤ 24 листов), «Орда» (сбоку, оружие героя в руке), «Арена» (iso8 по прицелу, бластер),
  «Студия игр» (D37.player / D37.drawPlayer в песочнице: атлас data URL PNG/WebP + таблица кадров; хозяин песочницы проверяет и пересобирает —
  cleanPlayer в studio/frame.html, CSP не менялся; шаблон «Раннер» — «🎭 Герой — персонаж игрока», sprite: 'pixel'; aiPrompt знает),
  гардероб («🎞 2D» и живое окошко вместо .ce-2d). Скрытая демо #/games/sprites — GAMES_HIDDEN в games.js (нет в каталоге и поиске).
- Тест: node scripts/sprite-test.cjs [путь к three@0.149] — 2885 проверок. Во встроенном браузере печь и игры стоят, пока панель скрыта:
  подменить requestAnimationFrame и requestIdleCallback на MessageChannel (setTimeout в фоне тормозится).
