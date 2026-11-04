// Проверка разбора ответов в scripts/sql-rest.cjs без сети (ревью шага 0 от 05.11, D6: «функция есть, аргументы неверные» ≠ «не применён»).
// Запуск: node scripts/sql-rest-test.cjs → строка на случай и «sql-rest-test: N/N OK».
const { classify } = require('./sql-rest.cjs');
let ok = 0, n = 0;
const check = (name, got, want) => { n++; const pass = got.kind === want; if (pass) ok++; console.log(`${pass ? 'OK  ' : 'FAIL'} ${name} → ${got.kind} (${got.note})`); };
const J = o => JSON.stringify(o);

check('200 with a value → ok', classify('game_win_xp', true, 200, '4'), 'ok');
check('function missing, no hint → missing', classify('nope_fn', true, 404, J({ code: 'PGRST202', details: 'Searched for the function public.nope_fn without parameters…', hint: null, message: 'Could not find the function public.nope_fn without parameters in the schema cache' })), 'missing');
check('wrong argument name, hint names the SAME function → bad_args', classify('game_win_xp', true, 404, J({ code: 'PGRST202', details: 'Searched for the function public.game_win_xp with parameter p_gameX…', hint: 'Perhaps you meant to call the function public.game_win_xp(p_game)', message: 'Could not find the function public.game_win_xp(p_gameX) in the schema cache' })), 'bad_args');
check('hint names ANOTHER function (game_win_xp2) → missing', classify('game_win_xp', true, 404, J({ code: 'PGRST202', hint: 'Perhaps you meant to call the function public.game_win_xp2(p_game)', message: 'Could not find the function public.game_win_xp(p_game) in the schema cache' })), 'missing');
check('hint names a function that only starts the same (game_win) → missing', classify('game_win', true, 404, J({ code: 'PGRST202', hint: 'Perhaps you meant to call the function public.game_win_xp(p_game)', message: 'Could not find the function public.game_win(p_game)' })), 'missing');
check('table missing PGRST205 → missing', classify('cloud_savez', false, 404, J({ code: 'PGRST205', hint: "Perhaps you meant the table 'public.cloud_saves'", message: "Could not find the table 'public.cloud_savez' in the schema cache" })), 'missing');
check('401 42501 permission denied → ok (exists, closed to guests)', classify('cloud_saves', false, 401, J({ code: '42501', message: 'permission denied for table cloud_saves' })), 'ok');
check('{"ok":false,"reason":"auth"} with 200 → ok (exists, needs a login)', classify('coins_add', true, 200, J({ ok: false, reason: 'auth' })), 'ok');
check('500 with another error → other', classify('x_fn', true, 500, J({ code: 'P0001', message: 'boom' })), 'other');

// второй взгляд (GET без параметров, только чтение)
const { probeSays } = require('./sql-rest.cjs');
const probe = (name, got, want) => { n++; const pass = got === want; if (pass) ok++; console.log(`${pass ? 'OK  ' : 'FAIL'} ${name} → ${got}`); };
probe('probe: zero-arg function answers 200 → exists', probeSays('world_now', 200, '1793819486964'), 'exists');
probe('probe: volatile function in a read-only GET (25006) → exists', probeSays('coins_add', 400, J({ code: '25006', message: 'cannot execute INSERT in a read-only transaction' })), 'exists');
probe('probe: needs arguments, hint names the same function → exists', probeSays('game_win_xp', 404, J({ code: 'PGRST202', hint: 'Perhaps you meant to call the function public.game_win_xp(p_game)' })), 'exists');
probe('probe: PGRST202, no hint → missing', probeSays('nope_fn', 404, J({ code: 'PGRST202', hint: null })), 'missing');

console.log(`sql-rest-test: ${ok}/${n} ${ok === n ? 'OK' : 'FAILED'}`);
process.exit(ok === n ? 0 : 1);
