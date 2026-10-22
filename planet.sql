-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
--  planet.sql — планеты и космос (docs/plans/planet-space.md, Приложение A). ОДИН файл на всю область: следующие шаги
--  (правки участков PL-6, спутники PS-4, метеориты PS-3, терраформирование PS-9) дописывают сюда свои части.
--  Идемпотентно: можно запускать сколько угодно раз. От других файлов не зависит.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ═══ Часть «time» (T-079, шаг PS-1): часы мира ═══
-- world_now() — время сервера в миллисекундах с 1970 (с долями). Сайт (js/engine/clock.js) спрашивает его 3 раза, берёт среднюю
-- поправку и по ней считает небо, орбиты планет и лун — у всех игроков одно время, даже если часы телефона сбиты.
-- Проверка (publishable-ключ): POST /rest/v1/rpc/world_now {} → число около «сейчас» (1,76·10¹²…); PGRST202 — файл не запущен.
create or replace function public.world_now() returns double precision
  language sql volatile security invoker set search_path = ''
as $$ select (extract(epoch from clock_timestamp()) * 1000)::double precision $$;

revoke all on function public.world_now() from public;
grant execute on function public.world_now() to anon, authenticated, service_role;

comment on function public.world_now() is 'Часы мира (T-079): мс с 1970 по часам сервера, js/engine/clock.js';
