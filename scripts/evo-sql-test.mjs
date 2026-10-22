// evo.sql («Путь от микроба», шаг «Клетка», T-056) на PGlite с заглушками живой базы Supabase: роли anon / authenticated, auth.uid() через
// request.jwt.claim.sub, profiles, banned_nicks, права по умолчанию «всем всё» (как у Supabase — файл обязан сам закрыть). Проверяет: файл
// применяется дважды (и поверх данных), каталог = D37Evo.SERVER, права и RLS, билет жизни (номер, биом закрыт), ДНК жизни (лимит в минуту по
// часам сервера, «отдохнувший» ×2, лимит дня, минералы только в Глубине, цель), минуты пути, биомы, «Микромир», рекорды, задание дня, вехи
// стадий 1→4, покупки (стадия, сколько можно, цена), облик (места, части на 2 места, купленное, раскраска и «Пигмент»), имя, «На сушу»
// (только стадия 4, один раз, «Пробуждение»), перенос пробного рода (один раз, в пустой род, не дальше «Колонии», купленное не дороже
// потраченного), частота ходов, новый день, бан, админ (сводка, дни, настройки из белого списка), одни и те же случайные ходы через
// JS (D37Evo.Rules) и SQL — состояние совпадает, время ответа на 20 000 родов.
// Запуск из корня сайта: node scripts/evo-sql-test.mjs       (PGlite — PGLITE_PATH=<папка>, как у city-sql-test.mjs)
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } };
async function findPglite() {
  const cands = [process.env.PGLITE_PATH, path.join(os.tmpdir(), 'd37-pglite'), 'E:/claude-tmp/d37raid/pg', SITE].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pj.name !== '@electric-sql/pglite') continue;
      const m = await import(pathToFileURL(path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js')).href);
      if (m.PGlite) return m.PGlite;
    } catch (e) { /* дальше */ }
  }
  return null;
}
const PGlite = await findPglite();
if (!PGlite) {
  const msg = 'evo-sql-test: PGlite не найден — пропущено. npm install --prefix <папка> @electric-sql/pglite и PGLITE_PATH=<папка>';
  if (process.env.OPS_SQL_REQUIRED) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg); process.exit(0);
}
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/evo.js'), 'utf8'), { filename: 'evo.js' });
const E = globalThis.D37Evo, RU = E.Rules;
const SQL = fs.readFileSync(path.join(SITE, 'evo.sql'), 'utf8');

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated, service_role;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, nick text, role text default 'user');
create table public.banned_nicks (nick text primary key, reason text, created_at timestamptz default now());
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select on public.profiles to anon, authenticated;
`);
const U = (c, i = 0) => `${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${String(i).padStart(12, c)}`;
const A = U('a'), B = U('b'), C = U('c'), BAN = U('9'), ADM = U('8'), MOD = U('7'), IMP = U('6'), IMP2 = U('5');
for (const [id, nick, role] of [[A, 'Аня', 'user'], [B, 'Боря', 'user'], [C, 'Вика', 'user'], [BAN, 'Плохиш', 'user'], [ADM, 'dan4ik37', 'admin'], [MOD, 'Модер', 'moderator'], [IMP, 'Гоша', 'user'], [IMP2, 'Даша', 'user']]) {
  await db.exec(`insert into auth.users values ('${id}'); insert into public.profiles values ('${id}', '${nick}', '${role}');`);
}
await db.exec(`insert into public.banned_nicks (nick) values ('плохиш')`);

// ═══ 1. Файл дважды, каталог ═══
let t0 = performance.now();
await db.exec('begin;\n' + SQL + '\ncommit;');
const tFirst = performance.now() - t0;
await db.exec('begin;\n' + SQL + '\ncommit;');
ok(true, 'evo.sql применён дважды');
await db.exec(`create or replace function public.evo_now() returns bigint language sql stable as $$ select coalesce(nullif(current_setting('test.now', true), '')::bigint, floor(extract(epoch from now()))::bigint) $$;`);
const NOW = 1792800000;   // 2026-10-23 03:00 МСК — от него отсчитываются времена ходов
let CLK = NOW;
const setNow = async t => { CLK = t; await db.exec(`select set_config('test.now', '${t}', false)`); };
await setNow(NOW);
const as = async id => db.exec(`reset role; set role ${id ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${id || ''}', false);`);
const su = async () => db.exec('reset role;');
const q1 = async s => (await db.query(`select ${s} r`)).rows[0].r;
const rows = async s => (await db.query(s)).rows;
const tryQ = async s => { try { await db.query(s); return true; } catch (e) { return false; } };
const J = o => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const act = async (a, g = {}) => q1(`public.evo_act('${a}', ${J(g)}, null)`);
const deepEq = (a, b) => { if (a === b) return true; if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false; if (Array.isArray(a) !== Array.isArray(b)) return false; const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEq(a[k], b[k])); };
const diff = (a, b) => Object.keys({ ...a, ...b }).filter(k => !deepEq(a[k], b[k])).map(k => [k, a[k], b[k]]);

await as(null);
const defs = await q1('public.evo_defs()');
ok(deepEq({ ...defs, cv: undefined }, { ...JSON.parse(JSON.stringify(E.SERVER)), cv: undefined }) && defs.cv === 0, 'evo_defs() = D37Evo.SERVER (+cv 0)', { cv: defs.cv });
ok(JSON.stringify(defs).length < 4096, 'каталог < 4 КБ', JSON.stringify(defs).length);
const D = E.merge(E.SERVER, {}, 0);

// ═══ 2. Права и RLS ═══
for (const f of ['evo_state()', "evo_act('start', '{}'::jsonb, null)", "evo_admin('sum')", 'evo_now()', 'evo_defs0()', `evo_banned_('${A}')`, "evo_stat_('x', 1)", 'evo_nonce_()'])
  ok(!(await tryQ(`select public.${f}`)), `гостю закрыто: ${f}`);
await as(A);
for (const f of ['evo_now()', 'evo_defs0()', `evo_banned_('${A}')`, "evo_stat_('x', 1)", 'evo_nonce_()', `evo_home_('${A}', '{}'::jsonb)`, "evo_cap_('{}'::jsonb)"])
  ok(!(await tryQ(`select public.${f}`)), `игроку закрыто: ${f}`);
for (const t of ['evo_lineage', 'evo_cfg', 'evo_days']) {
  ok(!(await tryQ(`select * from public.${t} limit 1`)) || (await rows(`select * from public.${t} limit 1`)).length === 0, `${t}: читать напрямую нельзя`);
  ok(!(await tryQ(`insert into public.${t} default values`)), `${t}: писать напрямую нельзя`);
}
ok((await q1(`public.evo_admin('sum')`)).reason === 'rights', 'игроку админка — отказ');

// ═══ 3. Новый род, билет жизни, ДНК ═══
await as(A);
let st = await q1('public.evo_state()');
ok(st.ok && st.new === true && st.st.stage === 1 && st.st.dna === 0 && E.HOMES.some(h => h.id === st.st.home?.id), 'новичок: стадия «Клетка», родина — место у воды', st.st.home);
const home0 = st.st.home;
ok(deepEq({ ...st.st, home: null }, { ...RU.fresh(), home: null }), 'пустой род = Rules.fresh()', diff({ ...st.st, home: null }, { ...RU.fresh(), home: null }));
let r = await act('start', { b: 'reef' });
ok(!r.ok && r.reason === 'locked', 'Риф закрыт на стадии «Клетка»', r);
ok((await act('life', { n: 'deadbeef' })).reason === 'nonce', 'жизнь без билета — nonce');
r = await act('start', { b: 'pool' });
ok(r.ok && /^[0-9a-f]{8}$/.test(r.got.n) && r.st.tb === 'pool' && r.st.tt === NOW, 'билет жизни: номер, биом, время сервера', r.got);
let tk = r.got.n;
await setNow(NOW + 60);
r = await act('life', { n: tk, s: 500, p: 0, m: 0, g: 0, col: 1, kills: 0, mass: 60, life: 60, pel: 40, seen: ['drop', 'teeth', 'spike'] });
// за 60 с: не больше 40 + 15 = 55 сырой; «отдохнувший»: первые 60 ×2 → 110
ok(r.ok && r.got.raw === 55 && r.got.cut === 445 && r.got.bonus === 55 && r.got.gain === 110 && r.st.dna === 110 && r.st.today === 110 && r.st.raw === 55, 'лимит в минуту жизни (40/мин + 15) и «отдохнувший» ×2', r.got);
ok(r.st.play === 60 && deepEq(r.st.biomes, ['pool']) && deepEq(r.st.finds, ['drop', 'spike']), 'минуты пути, биом, «Микромир» (Зубастик не живёт в Луже)', [r.st.play, r.st.biomes, r.st.finds]);
ok(r.st.rec.mass === 60 && r.st.rec.lives === 1 && r.st.tk === null, 'рекорды и жизнь закрыта', r.st.rec);
ok((await act('life', { n: tk, s: 5 })).reason === 'nonce', 'тот же билет второй раз — nonce');
// минералы — только в Глубине, цель — не больше 1
r = await act('start', { b: 'pool' }); tk = r.got.n;
await setNow(NOW + 400);
r = await act('life', { n: tk, s: 10, p: 4, m: 7, g: 3, life: 200 });
ok(r.ok && r.got.raw === 10 + 4 + 0 + 8 && r.got.bonus === 5, 'минералы вне Глубины не считаются, цель — одна (+8), остаток «отдохнувшего» 5', r.got);
ok(r.st.rec.life === 200 && r.st.play === 60 + 330, 'жизнь в рекорды — не дольше, чем по часам сервера; в минуты — не больше 330 с', [r.st.rec.life, r.st.play]);
// короткая жизнь: минуты не идут, ДНК — по лимиту
r = await act('start', { b: 'pool' }); tk = r.got.n;
await setNow(NOW + 403);
r = await act('life', { n: tk, s: 30 });
ok(r.ok && r.got.raw === 2 + 15 && r.st.play === 390, 'жизнь 3 с: 2 за 3 секунды + slack 15, минуты пути не идут', [r.got, r.st.play]);
// лимит дня
let today = r.st.today;
for (let i = 0; i < 6; i++) { const s = await act('start', { b: 'pool' }); await setNow(NOW + 403 + (i + 1) * 300); r = await act('life', { n: s.got.n, s: 400, p: 0 }); }
ok(r.ok && r.st.today === 300 && r.st.dna === r.st.earned, 'лимит дня 300 ДНК', [r.st.today, r.st.dna]);
const s2 = await act('start', { b: 'pool' }); await setNow(NOW + 3000);
r = await act('life', { n: s2.got.n, s: 50 });
ok(r.ok && r.got.gain === 0 && r.got.raw === 50 && r.st.dna === 300, 'сверх лимита — 0 (жизнь и минуты всё равно идут)', r.got);
ok(r.st.cut > 0, 'срезанное копится для статистики', r.st.cut);

// ═══ 4. Покупки, облик, вехи ═══
ok((await act('buy', { part: 'jaw' })).reason === 'stage', 'хищный рот — со стадии «Органоиды»');
ok((await act('buy', { part: 'nope' })).reason === 'args' && (await act('buy', { part: 'constructor' })).reason === 'args', 'чужая часть — отказ');
r = await act('buy', { part: 'flagellum' });
ok(r.ok && r.st.owned.flagellum === 1 && r.st.dna === 275 && r.st.stage === 2 && r.got.up === 2, 'жгутик за 25 → стадия «Органоиды»', r.got);
r = await act('buy', { part: 'flagellum' });
ok(r.ok && r.st.owned.flagellum === 2 && (await act('buy', { part: 'flagellum' })).reason === 'max', 'жгутиков — не больше 2');
for (const p of ['adhesion', 'adhesion', 'eye', 'pigment']) r = await act('buy', { part: p });
ok(r.ok && r.st.dna === 275 - 25 - 60 - 60 - 25 - 15, 'ещё: 2 липкости, глазок, пигмент', r.st.dna);
ok((await act('buy', { part: 'armour' })).reason === 'stage', 'панцирь — со стадии «Колония»');
const dsg = { s: ['eye', 'adhesion', 'flagellum', 'adhesion', 'flagellum', ''], f: 'wedge', k: { p: 9, a: '#FF0000', b: '#00ff00' } };
r = await act('design', { d: dsg });
ok(r.ok && deepEq(r.st.design, { ...dsg, k: { p: 9, a: '#ff0000', b: '#00ff00' } }), 'облик: части, клин, «Неон» с пигментом (цвета — строчными)', r.st.design);
for (const [bad, why] of [[{ ...dsg, s: dsg.s.slice(0, 5) }, 'args'], [{ ...dsg, f: 'blob' }, 'args'], [{ ...dsg, s: ['eye', 'eye', '', '', '', ''] }, 'owned'],
  [{ ...dsg, s: ['=', '', '', '', '', ''] }, 'args'], [{ ...dsg, s: ['jaw', '', '', '', '', ''] }, 'owned'], [{ ...dsg, s: ['pigment', '', '', '', '', ''] }, 'args'],
  [{ ...dsg, k: { p: 10, a: '#000000', b: '#ffffff' } }, 'args'], [{ ...dsg, k: { p: '5', a: '#000000', b: '#ffffff' } }, 'args'], [{ ...dsg, s: [1, '', '', '', '', ''] }, 'args']]) {
  const x = await act('design', { d: bad });
  ok(!x.ok && x.reason === why, `плохой облик — ${why}: ${JSON.stringify(bad.s)} ${bad.f} ${JSON.stringify(bad.k)}`, x.reason);
}
r = await act('name', { a: 3, b: 7 });
ok(r.ok && deepEq(r.st.name, { a: 3, b: 7 }) && (await act('name', { a: 99, b: 0 })).reason === 'args', 'имя рода — из готовых слов');
// стадия 3: earned ≥ 250, колония 3, 20 минут
await setNow(NOW + 86400);   // новый день
let s3 = await act('start', { b: 'reef' });
ok(s3.ok && s3.st.tc === 5 && s3.st.today === 0 && s3.st.raw === 0, 'новый день: счётчики с нуля; колония облика в билете — 5', s3.st);
await setNow(NOW + 86400 + 330);
r = await act('life', { n: s3.got.n, s: 40, p: 20, col: 9, kills: 2, mass: 120, life: 330, pel: 70, seen: ['teeth', 'hedge', 'firefly'] });
ok(r.ok && r.st.col === 5 && deepEq(r.st.finds, ['drop', 'teeth', 'hedge', 'spike']) && deepEq(r.st.biomes, ['pool', 'reef']), 'колония — не больше, чем позволяет облик (5); Риф в биомах', [r.st.col, r.st.finds, r.st.biomes]);
const ti = RU.taskOf(NOW + 86400 + 330), T = E.TASKS[ti];
ok(r.got.task === (['pel', 'kills'].includes(T.k) && (T.k === 'pel' ? 70 >= T.v : 2 >= T.v) || T.k === 'mass' && 120 >= T.v || T.k === 'life' && 330 >= T.v ? 25 : 0), `задание дня «${T.n}» засчитано по жизни`, [r.got.task, T]);
ok(r.st.stage === 3 && r.got.up === 3, 'стадия «Колония» (ДНК, колония 5, 20+ минут)', [r.st.stage, r.st.earned, r.st.play, r.st.col]);
// стадия 4: earned ≥ 550, 45 минут, Глубина
for (let i = 0; i < 12 && r.st.stage < 4; i++) {
  const b = i % 2 ? 'deep' : 'reef', x = await act('start', { b });
  await setNow(CLK + 340);
  r = await act('life', { n: x.got.n, s: 40, p: 10, m: 5, col: 5, life: 330, pel: 50, seen: ['firefly', 'giant', 'mineral'] });
  if (r.st.today >= 300) await setNow(CLK + 86400);   // лимит дня — завтра
}
ok(r.st.stage === 4 && r.st.biomes.includes('deep') && r.st.finds.includes('mineral'), 'стадия «Готов к суше»: ДНК, 45 минут, Риф и Глубина', [r.st.stage, r.st.earned, r.st.play, r.st.biomes]);
ok((await act('land', { plan: 'crawler', diet: 'meat!' })).reason === 'args', '«На сушу»: питание — из списка');
r = await act('land', { plan: 'crawler', diet: 'meat' });
ok(r.ok && r.st.stage === 5 && r.st.plan === 'crawler' && r.st.land?.design?.f === 'wedge' && r.st.awake === CLK && r.got.awake === true, '«На сушу»: план, питание, облик на тот момент, «Пробуждение» (временный обход)', r.st.land);
ok((await act('land', { plan: 'shell', diet: 'both' })).reason === 'stage', '«На сушу» — один раз');
const tpl = E.landTemplate(E.Rules.sanitize(r.st));
ok(tpl && tpl.body.legs === 2 && tpl.body.eyes === 3 && tpl.diet === 'meat' && tpl.look.p === 9, 'шаблон существа из рода (ноги, глаза, питание, раскраска)', tpl);

// ═══ 5. Частота, бан ═══
await as(B);
await setNow(NOW);
let fast = 0;
for (let i = 0; i < 35; i++) { const x = await act('name', { a: i % 20, b: 1 }); if (x.reason === 'too_fast') fast++; }
ok(fast === 5, 'не больше 30 ходов в минуту', fast);
await setNow(NOW + 61);
ok((await act('name', { a: 1, b: 1 })).ok, 'через минуту — снова можно');
await as(BAN);
const sb = await act('start', { b: 'pool' }); await setNow(NOW + 120);
ok((await act('life', { n: sb.got.n, s: 5 })).reason === 'banned', 'заблокированному — ДНК не идёт');

// ═══ 6. Перенос пробного рода ═══
await as(IMP);
await setNow(NOW);
const trial = { stage: 4, dna: 2000, earned: 3000, play: 99999, col: 7, owned: { flagellum: 2, adhesion: 3, eye: 2, jaw: 1, armour: 1, toxin: 1, pigment: 1, photo: 9 },
  design: { s: ['jaw', 'eye', 'adhesion', 'adhesion', 'armour', '='], f: 'ring', k: { p: 8, a: '#123456', b: '#abcdef' } }, biomes: ['pool', 'reef', 'deep'], finds: ['giant', 'drop', 'nope'],
  rec: { mass: 999, life: 300, kills: 7, lives: 40 }, name: { a: 5, b: 6 } };
r = await act('import', { st: trial });
ok(r.ok && r.st.earned === 400 && r.st.dna === 300 && r.st.play === 1500 && r.st.col === 3 && r.st.stage <= 3 && r.st.imported, 'перенос: ДНК, минуты и колония — не больше потолка, стадия не дальше «Колонии»', [r.st.earned, r.st.dna, r.st.play, r.st.col, r.st.stage]);
const spent = Object.entries(r.st.owned).reduce((x, [id, n]) => x + n * E.CELL[id].cost, 0);
ok(spent <= 400 - 300 && !r.st.owned.photo, 'купленное — не дороже потраченного (400 − 300), лишнее не переносится', [r.st.owned, spent]);
ok(deepEq(r.st.finds, ['drop', 'giant']) && deepEq(r.st.name, { a: 5, b: 6 }) && r.st.rec.mass === 999, '«Микромир», имя и рекорды — перенесены (чужое отброшено)', [r.st.finds, r.st.name]);
const js = RU.act(D, RU.fresh(), 'import', { st: trial }, NOW);
ok(deepEq({ ...js.st, home: null, act_t: 0, act_n: 0 }, { ...r.st, home: null, act_t: 0, act_n: 0 }), 'перенос: JS и SQL одинаково', diff({ ...js.st, home: null }, { ...r.st, home: null }));
ok((await act('import', { st: trial })).reason === 'done', 'перенос — один раз');
await as(IMP2);
const x0 = await act('start', { b: 'pool' }); await setNow(NOW + 100);
await act('life', { n: x0.got.n, s: 5 });
ok((await act('import', { st: trial })).reason === 'has', 'в род с прогрессом перенос не идёт');

// ═══ 7. Админ ═══
await as(MOD);
let ad = await q1(`public.evo_admin('sum')`);
ok(ad.ok && ad.lineages >= 5 && ad.stages['5'] === 1 && ad.awake === 1 && ad.cut > 0, 'сводка: роды по стадиям, «Пробуждение», срезанное', ad);
ok((await q1(`public.evo_admin('days', '{"days":7}'::jsonb)`)).days.length >= 1, 'журнал по дням');
ok((await q1(`public.evo_admin('cfg', '{"set":{"caps.day":500}}'::jsonb)`)).reason === 'rights', 'модератору менять числа нельзя');
await as(ADM);
ok((await q1(`public.evo_admin('cfg', '{"set":{"caps.life":9}}'::jsonb)`)).reason === 'args', 'ключ не из белого списка — отказ');
ok((await q1(`public.evo_admin('cfg', '{"set":{"caps.day":99999}}'::jsonb)`)).reason === 'args', 'вне пределов — отказ');
ad = await q1(`public.evo_admin('cfg', '{"set":{"caps.day":500,"cell.jaw.cost":30}}'::jsonb)`);
ok(ad.ok && ad.defs.caps.day === 500 && ad.defs.cell.jaw.cost === 30 && ad.defs.cv === 1, 'админ меняет лимит дня и цену части', ad.defs?.caps);
await as(null);
const d2 = await q1('public.evo_defs()');
ok(d2.caps.day === 500 && d2.cv === 1 && deepEq(E.merge(E.SERVER, { 'caps.day': 500, 'cell.jaw.cost': 30 }, 1), d2), 'каталог с настройками = D37Evo.merge', d2.caps);
await as(ADM);
await q1(`public.evo_admin('cfg', '{"set":{"caps.day":null,"cell.jaw.cost":null}}'::jsonb)`);

// ═══ 8. Одинаково: случайные ходы через JS (Rules) и SQL ═══
{
  let seed = 12345;
  const R = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const pick = a => a[Math.floor(R() * a.length)];
  const users = [];
  for (let i = 0; i < 6; i++) { const id = U('d', i + 1); await su(); await db.exec(`insert into auth.users values ('${id}'); insert into public.profiles values ('${id}', 'P${i}', 'user');`); users.push({ id, js: null }); }
  let t = 1793000000, same = 0, bad = 0, firstBad = null, n = 0;
  await setNow(t);
  const PARTS = E.PART_IDS;
  for (let k = 0; k < 900; k++) {
    const u = pick(users);
    await as(u.id);
    t += Math.floor(R() < .08 ? R() * 50000 : R() * 140);
    await setNow(t);
    const st0 = u.js;
    let a, g;
    const x = R();
    if (x < .28) { a = 'start'; g = { b: pick(['pool', 'pool', 'reef', 'deep', 'mars']) }; }
    else if (x < .58) { a = 'life'; g = { n: st0?.tk && R() < .9 ? st0.tk : 'zzzzzzzz', s: Math.floor(R() * 60), p: Math.floor(R() * 20), m: Math.floor(R() * 6), g: Math.floor(R() * 2), col: Math.floor(R() * 8), kills: Math.floor(R() * 4), mass: Math.floor(R() * 400), life: Math.floor(R() * 340), pel: Math.floor(R() * 120), seen: [pick(E.MICRO_IDS), pick(E.MICRO_IDS)] }; }
    else if (x < .74) { a = 'buy'; g = { part: pick(PARTS) }; }
    else if (x < .86) {
      a = 'design';
      const s = ['', '', '', '', '', ''];
      for (let i = 0; i < 6; i++) if (R() < .5) s[i] = pick(PARTS);
      if (R() < .3) { const i = Math.floor(R() * 6); s[i] = 'armour'; s[(i + 1) % 6] = '='; }
      g = { d: { s, f: pick(['chain', 'ring', 'wedge']), k: { p: Math.floor(R() * 11), a: '#' + Math.floor(R() * 16777215).toString(16).padStart(6, '0'), b: '#00ff88' } } };
    }
    else if (x < .9) { a = 'name'; g = { a: Math.floor(R() * 26), b: Math.floor(R() * 26) }; }
    else if (x < .96) { a = 'land'; g = { plan: pick(['crawler', 'swimmer', 'shell', 'bird']), diet: pick(['plant', 'meat', 'both']) }; }
    else { a = 'import'; g = { st: { earned: Math.floor(R() * 900), dna: Math.floor(R() * 500), play: Math.floor(R() * 4000), col: Math.floor(R() * 9), owned: { flagellum: 1, adhesion: Math.floor(R() * 4), eye: 1 }, biomes: ['pool', 'deep'] } }; }
    const rs = await q1(`public.evo_act('${a}', ${J(g)}, null)`);
    const base = st0 || { ...RU.fresh(), home: rs.st?.home };
    const rj = RU.act(D, base, a, g, t, () => rs.st?.tk || 'xxxxxxxx');
    n++;
    const eq = rj.ok === rs.ok && (rj.ok || rj.reason === rs.reason) && deepEq(rj.st, rs.st) && (!rj.ok || deepEq(rj.got, rs.got));
    if (eq) same++; else { bad++; if (!firstBad) firstBad = { a, g, js: { ok: rj.ok, reason: rj.reason, got: rj.got }, sql: { ok: rs.ok, reason: rs.reason, got: rs.got }, diff: diff(rj.st, rs.st || {}) }; }
    u.js = rs.st || u.js;   // дальше — от состояния сервера (расхождение не копится)
  }
  const stages = users.map(u => u.js?.stage);
  ok(bad === 0, `JS и SQL: одинаково на ${n} случайных ходах (6 игроков, время прыгает)`, firstBad);
  ok(stages.some(s => s >= 2), 'случайные ходы доводят до стадий выше первой', stages);
}

// ═══ 9. Скорость на «живом» объёме ═══
{
  await su();
  await db.exec(`insert into auth.users select gen_random_uuid() from generate_series(1, 20000);`);
  await db.exec(`insert into public.profiles (id, nick) select id, 'u' || left(id::text, 6) from auth.users where id not in (select id from public.profiles);`);
  await db.exec(`insert into public.evo_lineage (user_id, slot, stage, dna, earned, play, home) select id, 0, 1 + (abs(hashtext(id::text)) % 4), 100, 300, 1800, '{"id":"pond"}'::jsonb from public.profiles where id not in (select user_id from public.evo_lineage);`);
  const cnt = (await rows('select count(*)::int n from public.evo_lineage'))[0].n;
  await as(C);
  await setNow(NOW + 900000);
  const times = [];
  for (let i = 0; i < 40; i++) {
    const a = performance.now();
    const x = await act('start', { b: 'pool' });
    await setNow(NOW + 900000 + (i + 1) * 120);
    await act('life', { n: x.got.n, s: 20, p: 5, col: 1, life: 100, pel: 30, seen: ['drop'] });
    times.push(performance.now() - a);
  }
  times.sort((x, y) => x - y);
  const med = times[20] / 2, p95 = times[38] / 2;
  ok(cnt > 20000 && med < 25, `ход за ${med.toFixed(2)} мс (медиана; 95 % — до ${p95.toFixed(2)} мс) при ${cnt} родах`, [med, p95]);
  await su();
  const plan = (await rows(`explain select * from public.evo_lineage where user_id = '${C}' and slot = 0`)).map(x => x['QUERY PLAN']).join(' | ');
  ok(/Index Scan|Index Only Scan/.test(plan), 'род ищется по ключу (индекс)', plan);
  await as(C);
  const big = JSON.stringify(await q1('public.evo_state()')).length;
  ok(big < 3000, `ответ evo_state — ${big} Б`, big);
  console.log(`  файл: первый запуск ${tFirst.toFixed(0)} мс; ход (start + life): медиана ${med.toFixed(2)} мс, 95 % ${p95.toFixed(2)} мс; родов ${cnt}; evo_state ${big} Б`);
}

// ═══ 10. Файл ещё раз — поверх данных: роды и настройки на месте ═══
{
  await as(A);
  const before = await q1('public.evo_state()');
  await su();
  await db.exec('begin;\n' + SQL + '\ncommit;');
  await db.exec(`create or replace function public.evo_now() returns bigint language sql stable as $$ select coalesce(nullif(current_setting('test.now', true), '')::bigint, floor(extract(epoch from now()))::bigint) $$;`);
  await as(A);
  const after = await q1('public.evo_state()');
  ok(deepEq(before.st, after.st) && after.st.stage === 5, 'evo.sql ещё раз поверх данных — род как был', diff(before.st, after.st));
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);
