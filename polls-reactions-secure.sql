-- ═══════════════════════════════════════════════════════════════════
--  ЗАЩИТА ОПРОСОВ И РЕАКЦИЙ
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--
--  Было (старые скрипты): insert в poll_votes и message_reactions открыт
--  всем, delete реакций — тоже всем. «Один голос» держался только на
--  localStorage — очистил браузер или открыл инкогнито, и голосуй снова;
--  а из консоли можно было удалить все реакции всех людей.
--
--  Стало:
--   • опросы — голосуют только вошедшие, один голос на аккаунт на опрос
--     (старые голоса гостей остаются и продолжают считаться);
--   • реакции — вошедший ставит/снимает только свои (привязка к аккаунту),
--     гость может только ставить и не может выдать себя за
--     зарегистрированного пользователя; стафф может снять любую.
-- ═══════════════════════════════════════════════════════════════════

-- ── ОПРОСЫ ──
alter table public.poll_votes add column if not exists user_id uuid references public.profiles(id) on delete cascade;
create unique index if not exists poll_votes_one_per_user on public.poll_votes (poll_id, user_id) where user_id is not null;

drop policy if exists "insert" on public.poll_votes;
drop policy if exists "Голосует вошедший, один раз" on public.poll_votes;
create policy "Голосует вошедший, один раз" on public.poll_votes
  for insert with check (auth.uid() is not null and user_id = auth.uid());

-- Ник в голосе берём из профиля, а не из того, что прислал браузер
create or replace function public.poll_votes_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    select coalesce(nick, 'user') into new.nick from public.profiles where id = new.user_id;
    new.option := left(coalesce(new.option, ''), 200);
    new.created_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists poll_votes_before_insert on public.poll_votes;
create trigger poll_votes_before_insert before insert on public.poll_votes
  for each row execute function public.poll_votes_before_insert();

-- ── РЕАКЦИИ ──
alter table public.message_reactions add column if not exists user_id uuid references public.profiles(id) on delete cascade;

drop policy if exists "Anyone can add a reaction" on public.message_reactions;
drop policy if exists "Реакцию ставит гость или сам вошедший" on public.message_reactions;
create policy "Реакцию ставит гость или сам вошедший" on public.message_reactions
  for insert with check (
    (auth.uid() is null and user_id is null) or (auth.uid() is not null and user_id = auth.uid())
  );

drop policy if exists "Anyone can remove a reaction" on public.message_reactions;
drop policy if exists "Снять реакцию: свою или стафф" on public.message_reactions;
create policy "Снять реакцию: свою или стафф" on public.message_reactions
  for delete using (
    (auth.uid() is not null and user_id = auth.uid()) or public.is_staff_user(auth.uid())
  );

create or replace function public.message_reactions_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if;
  new.emoji := left(coalesce(new.emoji, ''), 64);
  if new.user_id is not null then
    -- вошедший — ник всегда из профиля
    select coalesce(nick, 'user') into new.nick from public.profiles where id = new.user_id;
  else
    -- гость — чистим ник как в чате и не даём занять ник зарегистрированного
    new.nick := left(btrim(regexp_replace(coalesce(new.nick, ''), '[^A-Za-zА-Яа-яЁё0-9_. -]', '', 'g')), 24);
    if new.nick = '' then raise exception 'Нужен ник' using errcode = 'P0001'; end if;
    if exists (select 1 from public.profiles where lower(nick) = lower(new.nick)) then
      raise exception 'Этот ник принадлежит зарегистрированному пользователю' using errcode = 'P0001';
    end if;
  end if;
  new.created_at := now();
  return new;
end; $$;
drop trigger if exists message_reactions_before_insert on public.message_reactions;
create trigger message_reactions_before_insert before insert on public.message_reactions
  for each row execute function public.message_reactions_before_insert();

-- Старые реакции зарегистрированных (до этого файла ставились только по нику) —
-- привязываем к аккаунту, чтобы их можно было снять. Ники уникальны (vip-secure.sql).
-- Для голосов в опросах так не делаем: двойные старые голоса сломали бы «один голос».
update public.message_reactions r
set user_id = p.id
from public.profiles p
where r.user_id is null and lower(p.nick) = lower(r.nick);
