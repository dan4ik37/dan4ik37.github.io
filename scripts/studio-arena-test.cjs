// «Арена» на нашем движке (T-176 S2, js/games/studio-arena.js) — без браузера, на ЖИВОМ blocks.json и wasm канала preview:
//  1) каждая форма каждого блока строится из blocks.json (подписи, единицы, min / max / step, варианты, ссылки — пикеры по объектам
//     файла), в коде редактора нет ни одного id блока или параметра (всё — из реестра движка);
//  2) файлы, сделанные редактором, принимает проверка движка blocks_check: «С нуля», пример движка, и файл, где КАЖДЫЙ блок реестра
//     поставлен со значениями редактора по умолчанию;
//  3) путь причины движка («laws[3].do[1].n: …») находит своё место формы; сломанное значение — причина по-русски;
//  4) чужой текст файла (имена, надписи, ключи) не становится разметкой;
//  5) флаг STUDIO_ARENA: выключен — скрипт редактора не грузится, карточки на главной нет; включён — есть.
// Запуск из корня сайта: node scripts/studio-arena-test.cjs
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
const PRE = path.join(SITE, 'd37-preview');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };

(async () => {
  const B = JSON.parse(fs.readFileSync(path.join(PRE, 'blocks.json'), 'utf8'));
  const DEMO = fs.readFileSync(path.join(PRE, 'modes/trigger_demo.mode.json'), 'utf8');
  const src = fs.readFileSync(path.join(SITE, 'js/games/studio-arena.js'), 'utf8');
  const win = {};
  new Function('window', 'localStorage', 'history', 'document', src)(win, { getItem: () => null, setItem: () => {} }, {}, undefined);
  const A = win.D37StudioArena, T = A._test;
  ok(A && T && typeof A.mount === 'function', 'редактор загрузился');
  const wasm = await import(pathToFileURL(path.join(PRE, 'd37_web.js')).href);
  await wasm.default({ module_or_path: fs.readFileSync(path.join(PRE, 'd37_web_bg.wasm')) });
  ok(wasm.blocks_json() === fs.readFileSync(path.join(PRE, 'blocks.json'), 'utf8'), 'blocks.json рядом = blocks_json() движка');
  const check = f => JSON.parse(wasm.blocks_check(typeof f === 'string' ? f : JSON.stringify(f)));
  const M = T.index(B); T.setM(M);

  // ═══ 1. Формы из blocks.json ═══
  ok(B.blocks.length >= 39, 'в реестре все блоки', B.blocks.length);
  const file = T.newFile(M);
  for (const b of B.blocks) {
    const item = T.defaults(M, file, b.id);
    for (const p of b.params) {
      const h = T.field(M, file, 'x.' + p.id, p, item[p.id]);
      ok(h.includes(`data-path="x.${p.id}"`) && h.includes(`data-type="${p.type}"`), `${b.id}.${p.id}: поле с путём и типом`);
      ok(h.includes(p.label.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))), `${b.id}.${p.id}: подпись из blocks.json`);
      if (p.unit) ok(h.includes(p.unit), `${b.id}.${p.id}: единица`);
      if (p.type === 'number' || p.type === 'integer') {
        ok(/type="number"/.test(h) && (typeof p.min !== 'number' || h.includes(`min="${p.min}"`)) && (typeof p.max !== 'number' || h.includes(`max="${p.max}"`)), `${b.id}.${p.id}: число с min / max`);
        if (typeof p.step === 'number') ok(h.includes(`step="${p.step}"`), `${b.id}.${p.id}: шаг`);
      }
      if (p.type === 'choice') ok(p.options.every(o => h.includes(`value="${o.id}"`) && h.includes(o.name)), `${b.id}.${p.id}: все варианты с русскими именами`);
      if (p.type === 'bool') ok(/type="checkbox"/.test(h), `${b.id}.${p.id}: да / нет`);
      if (M.types.get(p.type)?.ns || p.type === 'text-key') ok(/<select/.test(h), `${b.id}.${p.id}: выбор из файла`);
    }
  }
  // ни одного id блока или параметра в коде (категории — часть формата файла: rule / object / law / event / check / action)
  const cats = new Set(B.categories.map(c => c.id));
  const lits = new Set([...src.matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]));
  const ids = new Set(B.blocks.map(b => b.id).filter(id => !cats.has(id)));
  for (const b of B.blocks) for (const p of b.params) ids.add(p.id);
  for (const k of ['id', 'b']) ids.delete(k);   // ключи конверта файла (file.object_keys / block_key)
  const hard = [...ids].filter(id => lits.has(id));
  ok(!hard.length, 'в коде редактора нет id блоков и параметров (всё из blocks.json)', hard);
  ok(!/Раунд|Зона|Предмет|Когда|Если/.test(src.replace(/\/\/.*$/gm, '')), 'в коде нет русских имён блоков и категорий');

  // ═══ 2. Файлы редактора принимает движок ═══
  const r0 = check(T.textOf(T.newFile(M)));
  ok(r0.ok, '«С нуля» — движок принимает', r0);
  ok(T.newFile(M).rules.length === M.cat('rule').length, '«С нуля» — все настройки режима по умолчанию');
  ok(check(DEMO).ok, 'пример движка принят');
  // КАЖДЫЙ блок со значениями по умолчанию: сначала объекты (на них ссылаются), потом правило на каждое событие / условие / действие
  const all = T.newFile(M);
  for (const b of M.cat('object')) T.addObject(M, all, b.id);
  ok(all.objects.length === M.cat('object').length && new Set(all.objects.map(o => o.id)).size === all.objects.length, 'объекты: имена уникальны');
  for (const b of M.cat('event')) { const li = T.addLaw(M, all); T.addPart(M, all, li, 'when', b.id); }
  for (const b of M.cat('check')) { const li = T.addLaw(M, all); T.addPart(M, all, li, 'if', b.id); }
  for (const b of M.cat('action')) { const li = T.addLaw(M, all); all.laws[li].do = []; T.addPart(M, all, li, 'do', b.id); }
  for (const b of M.cat('rule')) T.addRule(M, all, b.id);
  const rAll = check(T.textOf(all));
  ok(rAll.ok, 'файл со ВСЕМИ блоками по умолчанию — движок принимает', rAll);
  ok(rAll.warnings?.length === 0, 'и без предупреждений', rAll.warnings);
  const used = new Set([...all.rules, ...all.objects, ...all.laws.flatMap(l => [l.when, ...(l.if || []), ...l.do])].map(x => x.b));
  ok(B.blocks.filter(b => b.cat !== 'law').every(b => used.has(b.id)), 'в файле все блоки реестра');
  ok(all.engine_min === undefined || all.engine_min >= 1, 'engine_min');
  ok(T.sinceMax(M, all) === Math.max(...B.blocks.map(b => +b.since)), 'engine_min = наибольший since');
  // новое правило в пустом файле: ставит только то, что можно (ссылки есть)
  const e = T.newFile(M); T.addLaw(M, e);
  ok(check(T.textOf(e)).ok, 'первое правило в пустом файле — сразу рабочее', check(T.textOf(e)));
  ok(T.usable(M, e, M.cat('action').find(b => b.params.some(p => p.required && M.types.get(p.type)?.ns)).id) === false, 'блок без нужного объекта в меню недоступен');

  // ═══ 3. Причина — у своего места ═══
  const demo = JSON.parse(DEMO);
  const sec = T.sectionsHtml(M, demo);
  const paths = [...sec.matchAll(/data-path="([^"]+)"/g)].map(m => m[1]);
  for (const s of B.file.sections) ok(paths.includes(s.key), `раздел ${s.key} из file.sections`);
  ok(demo.laws.every((l, i) => paths.includes(`laws[${i}].when`)), 'у каждого правила есть «когда»');
  let cnt = 0;
  demo.objects.forEach((o, i) => M.by.get(o.b).params.forEach(p => { cnt++; ok(paths.includes(`objects[${i}].${p.id}`), `objects[${i}].${p.id} в форме`); }));
  demo.laws.forEach((l, i) => (l.do || []).forEach((d, j) => M.by.get(d.b).params.forEach(p => { cnt++; ok(paths.includes(`laws[${i}].do[${j}].${p.id}`), `laws[${i}].do[${j}].${p.id} в форме`); })));
  ok(cnt > 40, 'полей примера много', cnt);
  const broken = JSON.parse(DEMO); broken.objects[0].r = 'много';
  const rb = check(broken);
  ok(!rb.ok && /^objects\[0\]\.r: /.test(rb.error) && /[а-я]/.test(rb.error), 'сломанное число — причина по-русски с путём', rb);
  ok(T.placeFor(T.pathOf(rb.error), paths) === 'objects[0].r', 'причина ставится к полю objects[0].r');
  const b2 = JSON.parse(DEMO); b2.laws[3].do[1].b = 'nope';
  const r2 = check(b2);
  ok(T.placeFor(T.pathOf(r2.error), paths) === 'laws[3].do[1]', 'неизвестный блок — к своему действию', r2.error);
  const b3 = JSON.parse(DEMO); b3.laws[1].when.what = 'nope';
  ok(T.placeFor(T.pathOf(check(b3).error), paths) === 'laws[1].when.what', 'ссылка на несуществующий объект — к своему полю');
  ok(T.pathOf('файл режима — не JSON: …') === '', 'без пути — только в строке состояния');

  // ═══ 4. Чужой текст файла не становится разметкой ═══
  const XSS = '<img src=x onerror=window.__x=1>';
  const evil = JSON.parse(DEMO);
  evil.texts[XSS] = XSS; evil.texts.hello = XSS; evil.objects[0].id = XSS; evil.laws[0].id = XSS; evil.objects[0].look = XSS; evil.laws[1].when.what = XSS;
  const eh = T.sectionsHtml(M, evil);
  ok(!eh.includes('<img'), 'имена, надписи, ключи, варианты — экранированы');
  ok(!/innerHTML\s*=\s*[^;]*\b(error|warnings|msg)\b/.test(src) && /n\.textContent = msg/.test(src) && /el\.textContent = text/.test(src), 'причины и состояние — только textContent');

  // ═══ 5. Флаг ═══
  const cfg = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8');
  ok(/^const STUDIO_ARENA = (true|false);/m.test(cfg), 'флаг STUDIO_ARENA в config.js');
  const games = fs.readFileSync(path.join(SITE, 'js/features/games.js'), 'utf8');
  ok(/STUDIO_ARENA \? \['js\/games\/studio-arena\.js'\] : \[\]/.test(games), 'скрипт редактора — только при флаге');
  const home = fs.readFileSync(path.join(SITE, 'js/games/studio-home.js'), 'utf8');
  const w2 = {}; global.STUDIO_ARENA = false;
  new Function('window', 'localStorage', home)(w2, { getItem: () => null });
  w2.D37StudioBlanks = [];
  const C = { tpls: () => [] };
  ok(!w2.D37StudioHome._test.skeleton(C).includes('so-arena'), 'флаг выкл — карточки «Арена» нет');
  global.STUDIO_ARENA = true; w2.D37StudioArena = A;
  const sk = w2.D37StudioHome._test.skeleton(C);
  ok(sk.includes('so-arena') && sk.includes('#/games/studio/arena/new') && sk.includes('#/games/studio/arena/demo') && !/скоро/.test(sk), 'флаг вкл — карточка «Арена»: «С нуля» и «Из примера»');
  const row = w2.D37StudioHome._test.rowHtml({ src: 'arena', id: 'abcd1234', name: XSS });
  ok(row.includes('#/games/studio/arena/open/abcd1234') && !row.includes('<img') && /только в этом браузере/.test(row), '«Мои проекты»: строка «Арена» (только этот браузер), имя экранировано');
  const studio = fs.readFileSync(path.join(SITE, 'js/games/studio.js'), 'utf8');
  ok(/a === 'arena' && typeof STUDIO_ARENA !== 'undefined' && STUDIO_ARENA && window\.D37StudioArena/.test(studio), 'адрес #/games/studio/arena/… — только при флаге');

  console.log(`\nstudio-arena-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
