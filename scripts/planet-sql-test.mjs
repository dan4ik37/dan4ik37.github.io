// planet.sql (планеты и космос; часть «time» — T-079, шаг PS-1) на PGlite с заглушками живой базы Supabase: роли anon / authenticated /
// service_role, права по умолчанию «всем всё» (как у Supabase — файл обязан сам закрыть лишнее).
// Проверяет: файл применяется дважды; world_now() — миллисекунды с 1970 по часам сервера (рядом с Date.now(), растёт, дробная часть
// есть), доступна гостю, вошедшему и серверу, у прочих ролей прав нет; вызов идёт через RPC PostgREST (POST, volatile — не кэшируется).
// Запуск из корня сайта: node scripts/planet-sql-test.mjs   (PGlite в репозиторий не кладём — PGLITE_PATH=<папка>; без пакета — пропуск)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

async function findPglite() {
  const cands = [process.env.PGLITE_PATH, process.env.DEPS_DIR, path.join(os.tmpdir(), 'd37-pglite'), path.join(SITE, '..', 'd37-pglite'), SITE].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) {
    for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pj.name !== '@electric-sql/pglite') continue;
        const entry = path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js');
        const m = await import(pathToFileURL(entry).href);
        if (m.PGlite) return m.PGlite;
      } catch (e) { /* дальше */ }
    }
  }
  return null;
}
const PGlite = await findPglite();
if (!PGlite) {
  const msg = 'planet-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

const SQL = fs.readFileSync(path.join(SITE, 'planet.sql'), 'utf8');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role stranger;
grant usage on schema public to anon, authenticated, service_role, stranger;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
// файл — дважды (идемпотентно)
let err = null;
try { await db.exec(SQL); await db.exec(SQL); } catch (e) { err = e.message; }
ok(!err, 'planet.sql применяется дважды без ошибок', err);
const call = async role => {
  await db.exec(`set role ${role}`);
  try { const r = await db.query('select public.world_now() as v'); return r.rows[0].v; }
  finally { await db.exec('reset role'); }
};
for (const role of ['anon', 'authenticated', 'service_role']) {
  const a = Date.now(), v = await call(role), b = Date.now();
  ok(typeof v === 'number' && v >= a - 5000 && v <= b + 5000, `world_now() у ${role} — миллисекунды «сейчас»`, { v, a });
}
let denied = false;
try { await call('stranger'); } catch (e) { denied = /permission denied/i.test(e.message); }
ok(denied, 'у прочих ролей вызова нет (revoke from public)');
// растёт и с дробной частью (clock_timestamp, не начало транзакции)
const v1 = await call('anon');
await new Promise(r => setTimeout(r, 15));
const v2 = await call('anon');
ok(v2 > v1, 'время идёт (второй вызов позже первого)', { v1, v2 });
const r3 = await db.query(`select public.world_now() as a, pg_sleep(0.02), public.world_now() as b`);
ok(r3.rows[0].b > r3.rows[0].a, 'внутри одного запроса — тоже идёт (clock_timestamp, а не now())', r3.rows[0]);
const info = await db.query(`select provolatile, prorettype::regtype::text as t from pg_proc where proname = 'world_now'`);
ok(info.rows[0].provolatile === 'v' && info.rows[0].t === 'double precision', 'функция volatile (не кэшируется), double precision', info.rows[0]);
console.log(`planet-sql-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
