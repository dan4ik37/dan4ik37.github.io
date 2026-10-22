// T-086: общая мини-карточка игрока, светлая тема и флаги отката — проверки без браузера (node, ~0,1 с).
//   1) D37Mini decide() — какие кнопки и пометки: приватность (скрытый профиль, «не принимает заявки»), безопасность детей
//      (D37Age: kb — личные каналы закрыты, kp — дружба и «📍 К нему» закрыты), вход, свой профиль, блокировка, жалоба, модерация;
//      PROFILE_HREF — какие ссылки открывают карточку; неверный id без ника — ни разметки, ни ошибок
//   2) скрипт темы в <head>: index.html и api/_lib/page.js (THEME_HEAD) — один и тот же текст; что он ставит (тёмная / светлая /
//      «Авто» по системе / мусор / localStorage недоступен); стоит в <head> до стилей страницы, без async/defer
//   3) «тёмные острова» (игры, телефон, студии, фоторедактор, Shorts) — один список в index.html и в css/ui2.css
//   4) контраст светлой темы ≥ 4,5 (WCAG AA): текстовые токены на всех светлых фонах (сайт, чат, серверные страницы);
//      цвет текста акцентом VIP (accentInk в profile.js) — для всех готовых акцентов
//   5) флаги отката UI_V2 / THEME_LIGHT в config.js, подключение файлов (index.html, msgview → D37Mini)
// Запуск из корня сайта: node scripts/ui-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, x) => { if (c) pass++; else { fail++; console.log('FAIL', name, x === undefined ? '' : JSON.stringify(x)); } };

// ═══ 1. Мини-карточка: решение «какие кнопки» ═══
{
  const errs = [];
  const ctx = { console: { error: (...a) => errs.push(a.join(' ')), log(){}, warn(){} }, performance, setTimeout, clearTimeout, Promise, Map, Set, RegExp, Object, String, Math, JSON };
  ctx.window = ctx; ctx.addEventListener = () => {};
  ctx.document = { addEventListener(){} };   // createElement нет: если карточка начнёт строиться без причины — будет ошибка
  ctx.location = { hash: '' };
  ctx.D37Age = { kidMsg: k => 'KID:' + k };
  vm.createContext(ctx);
  vm.runInContext(src('js/features/minicard.js'), ctx, { filename: 'minicard.js' });
  const M = ctx.D37Mini, T = M && M._test;
  ok(T && typeof T.decide === 'function', 'D37Mini._test.decide есть');
  const U = '0b5a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
  const D = s => T.decide(Object.assign({ uid: U, self: false, logged: true, guest: false, status: 'none' }, s));
  const ks = r => r.acts.map(a => a.k + (a.dis ? '!' : '')).join(',');
  const has = (r, k) => r.acts.some(a => a.k === k);
  // гость (не вошёл)
  let r = D({ logged: false, status: null, canReport: true });
  ok(ks(r) === 'profile' && r.notes.includes('Войди, чтобы дружить, писать и звонить'), 'гость: только «Профиль» и «Войди…»', [ks(r), r.notes]);
  ok(!has(r, 'report') && !has(r, 'block') && !has(r, 'dm'), 'гость: ни жалобы, ни блокировки, ни ЛС');
  r = D({ logged: false, status: null, join: { label: '📍 К нему' } });
  ok(has(r, 'join'), 'гость: «📍 К нему» можно (как было в чате — общее «кто онлайн»)');
  // свой профиль
  r = D({ self: true, status: null, canReport: true, mods: [['ban', 'Бан']], hidden: true, join: { label: '📍' } });
  ok(ks(r) === 'profile' && r.acts[0].t.includes('Мой профиль') && !r.mods.length && !r.lock, 'свой: «Мой профиль», без дружбы, жалобы, модерации, замка и «К нему»', [ks(r), r.mods, r.lock]);
  // дружба
  r = D({ status: 'none' });
  ok(ks(r) === 'profile,friend-add,block', 'чужой: «В друзья» и «Заблокировать»', ks(r));
  r = D({ status: 'none', accepts: false });
  ok(ks(r) === 'profile,!,block' && r.acts[1].t.includes('Не принимает'), 'не принимает заявки — кнопка выключена', ks(r));
  r = D({ status: 'none', why: 'Лимит друзей: 15' });
  ok(ks(r) === 'profile,!,block' && r.notes.includes('Лимит друзей: 15'), 'нельзя по лимиту — кнопка выключена и почему', [ks(r), r.notes]);
  r = D({ status: 'none', kp: 'agefriend', join: { label: '📍 К нему' } });
  ok(ks(r) === 'profile,!,block' && r.notes.includes('KID:agefriend') && !has(r, 'join'), 'ребёнок и взрослый: дружбы нет, «К нему» нет, пометка D37Age', [ks(r), r.notes]);
  r = D({ status: 'friends' });
  ok(ks(r) === 'profile,dm,call,block', 'друзья: «Написать» и «Позвонить»', ks(r));
  r = D({ status: 'friends', kb: 'u9' });
  ok(ks(r) === 'profile,!,block' && r.acts[1].t.includes('Только дружба') && r.notes.includes('KID:u9') && !has(r, 'dm') && !has(r, 'call'), 'друзья, личные каналы закрыты (до 9 / ребёнок со взрослым) — ни ЛС, ни звонка', [ks(r), r.notes]);
  r = D({ status: 'pending_received' });
  ok(ks(r) === 'profile,friend-acc,block', 'входящая заявка — «Принять»', ks(r));
  r = D({ status: 'pending_received', kp: 'agefriend' });
  ok(ks(r) === 'profile,!,block' && r.notes.includes('KID:agefriend'), 'входящая заявка, но дружба по возрасту закрыта — «Нельзя»', [ks(r), r.notes]);
  r = D({ status: 'pending_sent' });
  ok(ks(r) === 'profile,!,block' && r.acts[1].t.includes('отправлена'), 'заявка отправлена — выключено', ks(r));
  r = D({ status: null });
  ok(ks(r) === 'profile,block', 'дружба ещё не известна — кнопок дружбы нет (место держит заглушка)', ks(r));
  r = D({ status: 'none', blocked: true });
  ok(r.acts.find(a => a.k === 'block').t.includes('Разблокировать'), 'заблокирован — «Разблокировать»');
  // жалоба, модерация, скрытый профиль
  ok(has(D({ canReport: true }), 'report') && !has(D({ canReport: false }), 'report'), 'жалоба — только если лента дала report()');
  ok(D({ mods: [['mute', 'Мут']] }).mods.length === 1, 'модерация — из крючка ленты');
  r = D({ hidden: true, vis: 'friends' });
  ok(r.lock === '🔒 Профиль видят только друзья', 'скрыт для всех, кроме друзей — замок', r.lock);
  r = D({ hidden: true, vis: 'nobody' });
  ok(r.lock === '🔒 Пользователь скрыл профиль', 'скрыл профиль — замок', r.lock);
  // гость чата (без аккаунта)
  r = T.decide({ uid: null, self: false, logged: true, guest: true, status: null, canReport: true, mods: [['ban', 'Бан']] });
  ok(ks(r) === 'report' && r.mods.length === 1 && !r.notes.length, 'гость чата: жалоба и модерация, без профиля и дружбы', [ks(r), r.notes]);
  // тексты кнопок — без разметки (вывод — через esc в minicard.js)
  ok(!JSON.stringify(D({ status: 'friends' })).includes('<'), 'в решении нет разметки');
  // какие ссылки открывают карточку
  const H = T.PROFILE_HREF;
  ok(H.test('#/profile/' + U) && H.test('/profile/' + U) && H.test('/#/profile/' + U) && H.test('/profile/' + U + '/'), 'ссылки на профиль: #/profile/<id>, /profile/<id>, /#/profile/<id>');
  ok(!H.test('/profile/vip') && !H.test('#/profile/' + U + '/logins') && !H.test('https://evil.example/profile/' + U) && !H.test('/profile/abc'), 'не профиль (vip, logins, чужой сайт, не id) — обычная ссылка');
  // неверный id и без ника — ничего не строится, ошибок нет
  const p = M.open('<img src=x onerror=alert(1)>', {});
  ok(p && typeof p.then === 'function' && !errs.length, 'open(не id, без ника) — пустой ответ, без разметки и ошибок', errs);
  ok(typeof ctx.openMiniProfile === 'function', 'старое имя openMiniProfile → D37Mini');
}

// ═══ 2. Скрипт темы в <head> ═══
const html = src('index.html'), page = src('api/_lib/page.js');
{
  const hs = /<script>(\(function\(\)\{try\{var d=document\.documentElement,D='[a-z]+'[^<]*)<\/script>/.exec(html);
  const ps = /export const THEME_HEAD = `<script>([^`]*)<\/script>`;/.exec(page);
  ok(!!hs && !!ps, 'скрипт темы есть в index.html и THEME_HEAD в page.js');
  ok(hs && ps && hs[1] === ps[1], 'index.html и серверные страницы — один и тот же скрипт темы');
  ok(/\$\{AGE_HEAD\}\s*\$\{THEME_HEAD\}/.test(page), 'page.js: THEME_HEAD в <head> сразу после AGE_HEAD');
  const at = hs ? html.indexOf(hs[0]) : -1, endHead = html.indexOf('</head>'), body = html.search(/<body[\s>]/), css1 = html.search(/<style[\s>]/);
  ok(at > 0 && at < endHead && at < body && at < css1, 'index.html: скрипт темы — в <head>, до стилей страницы и <body> (тема до первого кадра)', [at, css1, endHead]);
  ok(!/<script[^>]*(async|defer)[^>]*>\(function\(\)\{try\{var d=document\.documentElement,D=/.test(html), 'скрипт темы — без async/defer');
  // что он делает
  const run = ({ ls, sys = false, lsThrows = false }) => {
    const attrs = {};
    const c = {
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; } } },
      localStorage: { getItem: k => { if (lsThrows) throw new Error('нет доступа'); return k === 'd37_theme' && ls !== undefined ? ls : null; } },
      matchMedia: q => ({ matches: /light/.test(q) ? sys : !sys }),
    };
    vm.runInNewContext(hs[1], c);
    return attrs;
  };
  if (hs) {
    const def = /D='([a-z]+)'/.exec(hs[1])[1];
    ok(['dark', 'auto', 'light'].includes(def), 'тема по умолчанию — из списка (' + def + ')', def);
    let a = run({});
    ok(a['data-theme-def'] === def && (def === 'light' ? a['data-theme'] === 'light' : def === 'auto' ? true : !a['data-theme']), 'ничего не выбрано — тема по умолчанию (' + def + ')', a);
    ok(run({ ls: 'light' })['data-theme'] === 'light', 'выбрана светлая — data-theme="light"');
    ok(!run({ ls: 'dark', sys: true })['data-theme'], 'выбрана тёмная — светлая система не мешает');
    ok(run({ ls: 'auto', sys: true })['data-theme'] === 'light' && !run({ ls: 'auto', sys: false })['data-theme'], '«Авто» — как в системе');
    ok(!run({ ls: '"><img src=x>' })['data-theme'], 'мусор в d37_theme — тёмная');
    let threw = false; try { a = run({ lsThrows: true }); } catch (e) { threw = true; }
    ok(!threw && !a['data-theme'], 'localStorage недоступен (приватный режим) — без ошибки, тёмная');
    ok(def === 'dark', 'по умолчанию — тёмная (решение владельца в docs/progress.md; «Авто» — поменять D в обоих скриптах)', def);
  }
  // settings.js знает тему по умолчанию от скрипта (data-theme-def) — тот же список
  const st = src('js/core/settings.js');
  ok(/const THEMES = \['auto', 'dark', 'light'\]/.test(st) && /data-theme-def/.test(st) && /k: 'd37_theme'/.test(st), 'settings.js: тема — тот же ключ d37_theme и data-theme-def');
}

// ═══ 3. Тёмные острова — один список ═══
{
  const set = s => s.split(',').map(x => x.trim()).filter(Boolean).sort().join(',');
  const a = /:root,:root\[data-theme="light"\] :is\(([^)]+)\)\{/.exec(html), b = /:where\(:root\[data-theme="light"\]\) :where\(([^)]+)\)\{color-scheme:dark/.exec(html);
  ok(a && b && set(a[1]) === set(b[1]), 'index.html: острова в токенах и в цвете текста — один список', [a && a[1], b && b[1]]);
  const isl = new Set(a ? a[1].split(',').map(x => x.trim()) : []);
  ok(['#gamesStage', '.s3', '.ph', '.pe', '.shorts-page'].every(x => isl.has(x)), 'острова: игры, студия 3D, телефон, фоторедактор, Shorts');
  const ui2 = src('css/ui2.css');
  const lists = [...ui2.matchAll(/:not\(:is\((#gamesStage[^)]*)\) \*\)/g)].map(m => m[1]);
  ok(lists.length > 0 && lists.every(l => l.split(',').every(x => isl.has(x.trim()))), 'css/ui2.css: исключения островов — только из того же списка', lists.filter(l => !l.split(',').every(x => isl.has(x.trim()))));
}

// ═══ 4. Контраст светлой темы ═══
const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = h => { const c = rgb(h); return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]); };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const tokens = block => { const o = {}; for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) o[m[1]] = m[2]; return o; };
function contrast(where, T, texts, bgs){
  const bad = [];
  for (const t of texts) for (const b of bgs) {
    if (!T[t] || !T[b]) { bad.push(`${t}/${b}: нет токена`); continue; }
    const c = cr(T[t], T[b]); if (c < 4.5) bad.push(`${t} ${T[t]} на ${b} ${T[b]}: ${c.toFixed(2)}`);
  }
  ok(!bad.length, `${where}: контраст текста ≥ 4,5 (${texts.length} × ${bgs.length})`, bad);
}
{
  const L = /:root\[data-theme="light"\]\{([^}]+)\}/.exec(html), T = tokens(L ? L[1] : '');
  contrast('сайт, светлая', T, ['text', 'muted', 'text-hi', 'ok-t', 'gold-t', 'bad-t', 'tw-t'], ['bg', 'bg2', 'card', 'panel', 'input']);
  contrast('чат, светлая', T, ['c-t1', 'c-t2', 'c-t3', 'c-t4', 'c-link', 'c-at', 'c-atme', 'c-new', 'c-soft-bad', 'c-soft-ok', 'c-warn', 'c-voice', 'c-glink', 'c-ev'], ['ds-main', 'ds-side', 'c-card', 'c-pop', 'ds-me', 'bg2']);
  contrast('лист чата, светлая', T, ['c-sheet-tx'], ['c-sheet']);
  ok(cr(T['on-accent'] || '#fff', '#b8203d') >= 4.5, 'белый текст на цветной кнопке (акцент по умолчанию, тёмный край) ≥ 4,5');
  // акцент по умолчанию в тексте: color-mix(#ff2d55 72 %, чёрный)
  const mix = c => '#' + rgb(c).map(v => Math.round(v * .72).toString(16).padStart(2, '0')).join('');
  ok(cr(mix('#ff2d55'), T.bg2) >= 4.5 && cr(mix('#ff2d55'), T.bg) >= 4.5, 'текст акцентом по умолчанию (--accent-t) ≥ 4,5', cr(mix('#ff2d55'), T.bg2).toFixed(2));
  // VIP-акценты: accentInk() из profile.js на всех готовых цветах
  const prof = src('js/features/profile.js');
  const i0 = prof.indexOf('function accentInk('), end = i0 >= 0 ? prof.slice(i0).search(/\r?\n\}\r?\n/) : -1;
  const body = end > 0 ? prof.slice(i0, i0 + end) + '\n}\n' : '';
  const c = {}; if (body) vm.runInNewContext(body + ';this.accentInk = accentInk;', c);
  const presets = [...prof.matchAll(/a1: '(#[0-9a-f]{6})'/gi)].map(m => m[1]);
  ok(typeof c.accentInk === 'function' && presets.length >= 5, 'accentInk и готовые акценты найдены', presets);
  const bad = presets.filter(p => { const ink = c.accentInk(p); return !ink || cr(ink, T.bg2) < 4.5 || cr(ink, T.bg) < 4.5; });
  ok(!bad.length, 'текст акцентом VIP (--accent-ink) на светлом ≥ 4,5 для всех готовых акцентов', bad.map(p => p + '→' + c.accentInk(p)));
  ok(c.accentInk('#ffd700') !== '#b89b00', '«Золотой» темнеет сильнее, чем 72 % (иначе 2,5:1)');
  ok(c.accentInk('red') === '' && c.accentInk('') === '' && c.accentInk('#12345') === '', 'не #rrggbb — без --accent-ink (остаётся color-mix)');
  ok(/--accent-t:var\(--accent-ink,color-mix\(in srgb,var\(--accent\) 72%,#000\)\)/.test(html), 'index.html: --accent-t светлой = --accent-ink или color-mix 72 %');
  // серверные страницы
  const P = /:root\[data-theme="light"\]\{([^}]+)\}/.exec(page), PT = tokens(P ? P[1] : '');
  contrast('серверные страницы, светлая', PT, ['text', 'muted', 'text-hi', 'link', 'gold-t', 'gold-hi', 'accent-t', 'ok-t', 'ok-hi', 'pink-t', 'gem-t'], ['bg', 'card', 'panel']);
  // тёмная (как была): основной текст
  const DK = /:root,:root\[data-theme="light"\] :is\([^)]+\)\{([^}]+)\}/.exec(html), DT = tokens(DK ? DK[1] : '');
  contrast('сайт, тёмная', DT, ['text', 'muted'], ['bg', 'card', 'panel']);
}

// ═══ 5. Флаги отката и подключение ═══
{
  const cfg = src('js/core/config.js');
  ok(/const UI_V2 = (true|false);/.test(cfg) && /const THEME_LIGHT = (true|false);/.test(cfg), 'config.js: флаги UI_V2 и THEME_LIGHT (откат — одна строка)');
  ok(/if \(!THEME_LIGHT\) \{[^}]*localStorage\.removeItem\('d37_theme'\)[^}]*removeAttribute\('data-theme'\)/.test(cfg), 'THEME_LIGHT = false — выбор стирается и светлая снимается сразу');
  ok(/if \(UI_V2\) document\.documentElement\.classList\.add\('ui2'\)/.test(cfg), 'UI_V2 — класс html.ui2 (профиль 2.0 только под ним)');
  const i1 = html.indexOf('js/core/config.js'), i2 = html.indexOf('js/features/minicard.js'), i3 = html.indexOf('js/features/msgview.js');
  ok(i1 > 0 && i2 > i1, 'index.html: minicard.js подключён (после config.js)', [i1, i2]);
  ok(/<link rel="stylesheet" href="css\/ui2\.css">/.test(html), 'index.html: css/ui2.css подключён');
  ok(!/id="miniProfilePopover"/.test(html), 'старой мини-карточки профиля в разметке нет (одна на сайт)');
  const mv = src('js/features/msgview.js');
  ok(/V\.userCard = [^\n]*/.test(mv) && /D37Mini\.open\(/.test(mv), 'msgview.js: карточка автора — D37Mini (крючки ленты — actions)');
  ok(i3 > 0 && i2 > 0, 'index.html: лента (msgview.js) и мини-карточка — обе на странице');
  const ui2 = src('css/ui2.css');
  ok(!/animation:[^;]*infinite/.test(ui2.replace(/body\.high[^{]*\{[^}]*\}/g, '')), 'css/ui2.css: бесконечных анимаций вне body.high нет');
}

console.log(`ui-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
