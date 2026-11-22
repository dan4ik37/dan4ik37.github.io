// Главная студии — одна дверь (T-176, EDITOR_ONE S1) в node, без браузера:
//  1) ряд «Создать режим» = заготовки в коде: js/games/studio-blanks.js собирается из studio3d-modes.js (T: id, значок, название) и
//     js/engine/modes.js (MODES[режим].desc — строка карточки; режим и возраст — из того, что заготовка сама ставит в settings);
//     файл должен совпадать с тем, что собирается сейчас (поменяли заготовку — node scripts/studio-home-test.cjs --write);
//  2) каждый адрес карточки принимает «Студия 3D» (mpParam + newKindOk), а неизвестная заготовка мир не создаёт (startPick);
//  3) картинки карточек лежат в img/studio/modes/<id>.webp и небольшие;
//  4) флаг STUDIO_ONE: false — главная студии и список скриптов как раньше, true — новая главная (десять карточек, «Создать», без «скоро»);
//  5) чужой текст в «Мои проекты» и «Игры игроков» не становится разметкой; возраст в «Играх игроков» — как в /hub.
// Запуск из корня сайта: node scripts/studio-home-test.cjs [--write]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const OUT = 'js/games/studio-blanks.js';
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };

// ═══ Окружение: модули движка и «Студии 3D» в одном контексте (как scripts/studio-net-test.cjs) ═══
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/net.js', 'js/engine/scene.js', 'js/engine/modes.js', 'js/games/studio3d.js', 'js/games/studio3d-modes.js'])
  vm.runInThisContext(src(f), { filename: f });
const E = globalThis.D37E, MO = E.modes, S3 = globalThis.GAME_IMPL.studio3d._test;

// ═══ 1. Сборка списка карточек из самих заготовок ═══
// строки для двух заготовок без своего режима в modes.js (написаны в этом шаге; режим у них — обби)
const OWN_LINE = {
  'm-side': 'Беги вправо по платформам, прыгай через лаву, собирай монетки — вид сбоку, как в 2D.',
  'm-cams': 'Дом с камерами в углах комнат: вид меняется по комнатам, как в ужастиках. Собери монетки и дойди до финиша.',
};
const COLOR = { obby: '#0ea5e9', race: '#475569', ffa: '#b45309', teams: '#7c3aed', koth: '#16a34a', hide: '#0d9488', coins: '#ca8a04', survival: '#7f1d1d' };
const OWN_COLOR = { 'm-side': '#2563eb', 'm-cams': '#9d174d' };
function fakeScene(){ const objs = []; return { objs, settings: null, add(cls, p, parent){ const o = { cls, ...(p || {}), parent: parent || null }; objs.push(o); return o; } }; }
function buildList(){
  const T = E.studioTemplates;
  return Object.keys(T).filter(id => /^m-/.test(id)).map(id => {
    const S = fakeScene();
    T[id].build(S, null, { COLORS: [], EXAMPLES: [], flatTerrain(){}, generateHills(){} });
    const mode = S.settings?.game?.mode, age = S.settings?.age;
    const line = OWN_LINE[id] || MO.MODES[mode]?.desc || '';
    return { id, icon: T[id].icon, name: T[id].name, mode, age, line, color: OWN_COLOR[id] || COLOR[mode] || '#475569' };
  });
}
const LIST = buildList();
const fileText = list => `// СГЕНЕРИРОВАНО: node scripts/studio-home-test.cjs --write — из js/games/studio3d-modes.js (заготовки T: id, значок, название; режим и
// возраст — то, что заготовка сама ставит в settings) и js/engine/modes.js (MODES[режим].desc — строка карточки). Руками не править.
// Ряд «Создать режим» на главной студии (js/games/studio-home.js, T-176); картинки — img/studio/modes/<id>.webp (снимки самих заготовок:
// node scripts/studio-home-e2e.cjs shots).
window.D37StudioBlanks = [
${list.map(b => '  ' + JSON.stringify(b)).join(',\n')},
];
`;
if (process.argv.includes('--write')) { fs.writeFileSync(path.join(SITE, OUT), fileText(LIST)); console.log('записано', OUT, LIST.length, 'карточек'); }

{
  const WANT = ['m-obby', 'm-race', 'm-ffa', 'm-teams', 'm-koth', 'm-hide', 'm-coins', 'm-survival', 'm-side', 'm-cams'];
  ok(JSON.stringify(LIST.map(b => b.id)) === JSON.stringify(WANT), 'заготовок режимов в коде — десять, в том же порядке, что в меню «Файл → Режимы игры»', LIST.map(b => b.id));
  ok(LIST.every(b => MO.MODES[b.mode] && b.mode !== 'none'), 'у каждой заготовки — настоящий режим из modes.js', LIST.map(b => [b.id, b.mode]));
  ok(LIST.every(b => b.age === (MO.PVP.has(b.mode) ? 12 : 6)), 'возраст карточки — тот, что ставит заготовка: бои 12+, остальное 6+', LIST.map(b => [b.id, b.age]));
  ok(LIST.filter(b => !OWN_LINE[b.id]).every(b => b.line === MO.MODES[b.mode].desc), 'строка восьми карточек — описание режима из modes.js');
  ok(LIST.every(b => b.line && b.line.length <= 200 && b.name && b.icon), 'у каждой карточки есть название, значок и строка (не длиннее 200)');
  const have = fs.existsSync(path.join(SITE, OUT)) ? src(OUT) : '';
  ok(have === fileText(LIST), `${OUT} совпадает с заготовками в коде (поменяли заготовку — node scripts/studio-home-test.cjs --write)`);
  delete globalThis.D37StudioBlanks;
  vm.runInThisContext(have, { filename: OUT });
  ok(JSON.stringify(globalThis.D37StudioBlanks) === JSON.stringify(LIST), 'файл карточек читается в странице и даёт тот же список');
}

// ═══ 2. Адреса: каждая карточка открывается, неизвестная заготовка мир не создаёт ═══
{
  const p = S3.mpParam;
  for (const b of LIST) ok(p('new/' + b.id).newKind === b.id && S3.newKindOk(b.id) && S3.startPick(p('new/' + b.id), () => false).new === b.id, `адрес карточки new/${b.id} → новый мир из этой заготовки`);
  ok(S3.WORLD_TPL.every(k => S3.newKindOk(k)) && S3.startPick(p('new/grass'), () => false).new === 'grass', 'плитка «3D-мир» (new/grass) и шесть шаблонов миров — принимаются');
  for (const bad of ['new/m-nope', 'new/constructor', 'new/tostring', 'new/hasownproperty', 'new/m-koth/../x', 'new/__proto__', 'new/<img>', 'new/', 'new/a'])
    ok(!S3.startPick(p(bad), () => true).new, `неизвестная заготовка «${bad}» мир не создаёт`, p(bad));
  ok(S3.startPick(p('new/m-nope'), () => true).bad === true, 'неизвестная заготовка — открыт последний мир и честное сообщение');
  ok(p('open/abc123xy').openId === 'abc123xy' && S3.startPick(p('open/abc123xy'), id => id === 'abc123xy').open === 'abc123xy', 'open/<id> — этот мир из браузера');
  ok(!S3.startPick(p('open/zzzz9999'), () => false).open && S3.startPick(p('open/zzzz9999'), () => false).bad, 'open/<id>, которого нет — последний мир, без нового');
  ok(!p('open/<x>').openId && !p('open/a').openId, 'open/ — только буквы и цифры');
  // старые адреса — как были
  ok(p('play/abcd1234').playId === 'abcd1234' && p('play/abcd1234/qwerty').room === 'qwerty' && p('join/QWERTY').join === 'qwerty' && Object.keys(p('')).length === 0, 'старые адреса play/<мир>[/<комната>], join/<код>, пустой — как раньше');
  ok(S3.tplName('m-koth') === 'Царь горы' && S3.tplName('grass') === 'Мой мир' && S3.tplName('nope') === 'Мой мир', 'имя нового мира — как в «Файл → новый»');
  // «Студия 3D» сразу открывает окно режима: открывашка есть в расширении, само окно не менялось
  ok(typeof E.s3x.openModePanel === 'function', 'studio3d-modes.js отдаёт открывашку окна «🎮 Режим» (D37E.s3x.openModePanel)');
  const s3 = src('js/games/studio3d.js');
  ok(/ext\('mount', STUDIO_API\);[^\n]*\n(?:[^\n]*\n){0,3}\s*if \(ed\.fromBlank\) \{\s*s3Url\('#\/games\/studio3d\/open\/' \+ ed\.placeId\);[\s\S]{0,400}openModePanel\?\.\(\)/.test(s3), 'после расширений: адрес → open/<мир>, окно режима открыто');
  ok(/location\.hash = wasPlayer \|\| \(typeof STUDIO_ONE !== 'undefined' && STUDIO_ONE\) \? '#\/games\/studio' : '#\/games';/.test(s3), '«←» редактора: с флагом — главная студии, без флага — витрина игр, как раньше');
}

// ═══ 3. Картинки ═══
for (const b of LIST) {
  const f = path.join(SITE, 'img/studio/modes', b.id + '.webp');
  const st = fs.existsSync(f) ? fs.statSync(f) : null;
  const head = st ? fs.readFileSync(f).subarray(0, 12) : null;
  ok(st && st.size > 2000 && st.size < 90000 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP', `картинка ${b.id}.webp есть, это WebP, 2–90 КБ`, st && st.size);
}

// ═══ 4. Флаг STUDIO_ONE ═══
function fakeEl(){
  const el = { innerHTML: '', hidden: false, dataset: {}, classList: { toggle(){}, add(){}, remove(){} }, firstChild: null,
    addEventListener(){}, setAttribute(){}, remove(){}, appendChild(){}, querySelector: () => fakeEl(), querySelectorAll: () => [] };
  return el;
}
{
  const cfg = src('js/core/config.js');
  const m = /^const STUDIO_ONE = (true|false);/m.exec(cfg);
  ok(!!m, 'config.js: флаг STUDIO_ONE одной строкой (откат — false)');
  const games = src('js/features/games.js');
  const studioLine = games.split('\n').find(l => /\{ id: 'studio',/.test(l)) || '';
  ok(/scripts: \['js\/games\/studio-tpl\.js', \.\.\.\(typeof STUDIO_ONE !== 'undefined' && STUDIO_ONE \? \['js\/games\/studio-blanks\.js', 'js\/games\/studio-home\.js'\] : \[\]\), 'js\/games\/studio\.js'\]/.test(studioLine),
    'games.js: при STUDIO_ONE = false у «Студии игр» те же два файла, что раньше; при true — ещё список карточек и главная');
  const hub = src('js/features/hub.js');
  ok(/id: 'studio',[^\n]*href: STUDIO_ONE_ON \? '\/play\/studio' : '\/play\/studio3d'/.test(hub), 'плитка «Студия» в /hub: с флагом — главная студии, без — «Студия 3D», как раньше');

  // studio.js в node: главная при false и при true
  globalThis.GAME_IMPL = globalThis.GAME_IMPL || {};
  for (const f of ['js/games/studio-tpl.js', 'js/games/studio-home.js', 'js/games/studio.js']) vm.runInThisContext(src(f), { filename: f });
  const ST = globalThis.GAME_IMPL.studio;
  const mount = flag => {
    vm.runInThisContext(`var STUDIO_ONE = ${flag};`);
    const root = fakeEl();
    ST.mount(root, { param: '', toast(){} });
    const html = root.innerHTML; ST.unmount(); return html;
  };
  const off = mount(false), on = mount(true);
  ok(/Из шаблона — без кода/.test(off) && /📁 Мои игры/.test(off) && !/so-modes|Создать режим/.test(off), 'STUDIO_ONE = false — прежняя главная «Студии игр»');
  ok(/🎮 Создать режим/.test(on) && LIST.every(b => on.includes(`href="#/games/studio3d/new/${b.id}"`)), 'STUDIO_ONE = true — ряд «Создать режим», все десять карточек ведут в свою заготовку');
  ok((on.match(/class="so-mode"/g) || []).length === 10, 'карточек режимов ровно десять (столько, сколько заготовок)');
  const TPLS = globalThis.STUDIO_TPL.list;
  ok(on.includes('href="#/games/studio3d/new/grass"') && TPLS.every(t => on.includes(`href="#/games/studio/new/${t.id}"`)) && on.includes('href="#/games/studio/new/code"'), '«Создать»: 3D-мир, шесть шаблонов, «Свой код + ИИ»');
  ok(TPLS.length === 6, 'шаблонов шесть', TPLS.length);
  ok(!/скоро/i.test(on.replace(/совсем скоро/g, '')), 'на новой главной нет плиток «скоро»');
  ok(/📁 Мои проекты/.test(on) && /🌍 Игры игроков/.test(on) && /Правила:/.test(on), 'новая главная: «Мои проекты», «Игры игроков», правила');
  ok(!/three|rapier|engine\//i.test(src('js/games/studio-home.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')), 'главная не грузит three.js и движок (в коде нет ни одного такого файла)');
}

// ═══ 5. Чужой текст и возраст ═══
{
  const H = globalThis.D37StudioHome._test;
  const MARK = 'XSSMARK';
  const bad = [`<img src=x onerror=${MARK}()>`, `"><svg onload=${MARK}()>`, `' onfocus='${MARK}()' x='`, `javascript:${MARK}()`];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { esc, STATUS: { draft: ['📝', 'Черновик'], public: ['🌍', 'В каталоге'] }, num: n => String(n || 0), playHref: g => g.kind === 'place' ? `#/games/studio3d/play/${esc(g.id)}` : `#/games/studio/play/${esc(g.id)}`, ageB: () => '' };
  // разметка чистая: в тегах нет чужих атрибутов on…= (значения в кавычках убраны), нет чужих тегов, ссылки — только свои (# или img/)
  const clean = html => {
    const tags = html.match(/<[a-z][^>]*>/gi) || [];
    return tags.every(t => {
      const bare = t.replace(/"[^"]*"/g, '""');
      if (/\son\w+\s*=/i.test(bare) || /'/.test(bare)) return false;
      if (!/^<(a|span|b|small|i|div|img|button)\b/i.test(t)) return false;
      const href = /\s(?:href|src)="([^"]*)"/i.exec(t);
      return !href || /^(#\/|img\/studio\/modes\/)/.test(href[1]);
    });
  };
  for (const s of bad) {
    ok(clean(H.rowHtml({ src: 'srv', id: s, title: s, icon: s, status: s, kind: 'tpl', plays: s, likes: s }, C)), 'строка игры с сайта: чужое название не становится разметкой', s);
    ok(clean(H.rowHtml({ src: 'draft', id: s, title: s, icon: s, kind: 'html' }, C)), 'строка черновика: не становится разметкой', s);
    ok(clean(H.rowHtml({ src: 'world', id: s, name: s, n: s }, C)), 'строка 3D-мира: не становится разметкой', s);
    ok(clean(H.catCard({ id: s, title: s, icon: s, author: s, profiles: { nick: s }, plays: s, likes: s, kind: 'place' }, C)), 'карточка «Игр игроков»: ник и название не становятся разметкой', s);
    ok(clean(H.modeCard({ id: s, icon: s, name: s, line: s, age: 6, color: s })), 'карточка режима: и подменённые данные не становятся разметкой', s);
  }
  ok(H.rowHtml({ src: 'world', id: 'abcd1234', name: 'Царь горы' }, C).includes('href="#/games/studio3d/open/abcd1234"'), '3D-мир из браузера открывается своим адресом open/<id> (не «последний мир»)');
  ok(H.rowHtml({ src: 'srv', id: 'g1', title: 'x', kind: 'place', status: 'public' }, C).includes('href="#/games/studio3d/play/g1"'), 'выложенный 3D-мир: ▶ — в «Студию 3D», как раньше');
  // возраст как в /hub: без метки — видно, 16+ — только 16+ и взрослым (по умолчанию граница 12)
  ok(H.ageFits({ age_rating: null }) && H.ageFits({ age_rating: 12 }) && !H.ageFits({ age_rating: 16 }) && H.ageFits({ age_rating: 16 }, 16) && !H.ageFits({ age_rating: 18 }, 16), 'возраст в «Играх игроков» — правило /hub (12, для 16+ и взрослых — 16)');
  ok(/age: g\.age_rating == null \? null : \+g\.age_rating/.test(src('js/features/hub-catalog.js')) && /return g === 'teen16' \|\| g === 'adult' \? 16 : 12;/.test(src('js/features/hub-catalog.js')), 'правило /hub (hub-catalog.js) не поменялось — главная студии повторяет именно его');
  ok(/stateHtml\('err'/.test(src('js/games/studio-home.js')) && (src('js/games/studio-home.js').match(/data-retry/g) || []).length >= 1 && /'mine'\)/.test(src('js/games/studio-home.js')) && /'cat'\)/.test(src('js/games/studio-home.js')), '«Мои проекты» и «Игры игроков»: ошибка — «Не получилось» с «Повторить»');
}

console.log(`\nstudio-home-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
