-- ═══════════════════════════════════════════════════════════════════
--  «МИР ДЕНЧИКА» (#/games/world) — пропуск игрока: ник, роль и VIP нельзя подделать
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно. Нужны: progression.sql (vip_tier_of),
--  xp.sql (xp_ledger, xp_level) — они уже применены; pgcrypto (в Supabase включён: схема extensions).
--
--  Как работает: при входе в мир браузер создаёт пару ключей и просит world_pass(свой открытый ключ) —
--  сервер подписывает (HMAC, секрет только в базе) «этот id + этот ключ, до такого-то времени». Соседи по
--  миру проверяют пропуск через world_check(пропуск, ключ) и получают ник/роль/VIP/уровень из базы, а каждое
--  сообщение игрока подписано его ключом. Без пропуска (гость или файл не применён) — игрок «не проверен».
--  Проверка: select public.world_check('x', 'y'); → null (функция есть).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.world_secret (
  id int primary key default 1 check (id = 1),
  k text not null
);
alter table public.world_secret enable row level security;   -- политик нет: читают только функции ниже
revoke all on public.world_secret from anon, authenticated;
insert into public.world_secret (id, k)
  values (1, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

-- Пропуск на 12 часов: «uid.срок.подпись»; подпись покрывает и хеш открытого ключа
create or replace function public.world_pass(p_pub text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); exp bigint; s text; body text;
begin
  if uid is null or p_pub is null or length(p_pub) < 40 or length(p_pub) > 200 then return null; end if;
  exp := extract(epoch from now())::bigint + 12 * 3600;
  select k into s from public.world_secret where id = 1;
  body := uid::text || '.' || exp || '.' || encode(extensions.digest(p_pub, 'sha256'), 'hex');
  return uid::text || '.' || exp || '.' || encode(extensions.hmac(body, s, 'sha256'), 'hex');
end; $$;
revoke all on function public.world_pass(text) from public, anon;
grant execute on function public.world_pass(text) to authenticated;

-- Проверка пропуска соседом: верный и не просрочен → кто это (из базы), иначе null
create or replace function public.world_check(p_pass text, p_pub text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare parts text[]; uid uuid; exp bigint; s text; body text; p record; xp bigint;
begin
  parts := string_to_array(coalesce(p_pass, ''), '.');
  if coalesce(array_length(parts, 1), 0) <> 3 or p_pub is null or length(p_pub) > 200 then return null; end if;
  begin
    uid := parts[1]::uuid;
    exp := parts[2]::bigint;
  exception when others then return null;
  end;
  if exp < extract(epoch from now())::bigint then return null; end if;
  select k into s from public.world_secret where id = 1;
  body := parts[1] || '.' || parts[2] || '.' || encode(extensions.digest(p_pub, 'sha256'), 'hex');
  if encode(extensions.hmac(body, s, 'sha256'), 'hex') <> parts[3] then return null; end if;
  select pr.id, pr.nick, pr.role into p from public.profiles pr where pr.id = uid;
  if not found then return null; end if;
  select coalesce(sum(l.amount), 0) into xp from public.xp_ledger l where l.user_id = uid;
  return jsonb_build_object(
    'uid', p.id,
    'nick', p.nick,
    'role', coalesce(p.role, 'user'),
    'vip', public.vip_tier_of(p.id),
    'level', public.xp_level(xp),
    'banned', exists (select 1 from public.banned_nicks b where lower(b.nick) = lower(p.nick))
  );
end; $$;
grant execute on function public.world_check(text, text) to anon, authenticated;
