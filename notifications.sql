-- ═══════════════════════════════════════════════════════════════════
--  УВЕДОМЛЕНИЯ НА САЙТЕ — колокольчик 🔔 (js/features/notifications.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Лучше после ideas.sql и referrals.sql — триггеры на них ставятся,
--  только если таблицы/колонки уже есть (можно перезапустить позже).
--
--  Что приходит:
--   💬 ответ в твоей теме на форуме
--   @  тебя упомянули в чате (@ник)
--   💡 твою идею взяли в планы / сняли / отклонили; голоса за идею (5, 10, 25, 50, 100)
--   🤝 заявка в друзья / заявку приняли
--   🔗 по твоей ссылке зарегистрировался друг
--  Личные сообщения сюда не дублируются — у них свой счётчик.
--
--  Создают уведомления ТОЛЬКО триггеры (security definer). Клиент может
--  читать свои, отмечать прочитанными (через RPC) и удалять свои.
--  Все триггеры обёрнуты в exception — сбой уведомления не ломает само действие.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_nick text,
  title text not null,
  body text not null default '',
  link text not null default '',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_notif_user_unread on public.notifications (user_id) where read_at is null;
create unique index if not exists notif_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

alter table public.notifications enable row level security;
drop policy if exists "Свои уведомления читает сам" on public.notifications;
create policy "Свои уведомления читает сам" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "Свои уведомления удаляет сам" on public.notifications;
create policy "Свои уведомления удаляет сам" on public.notifications for delete using (auth.uid() = user_id);

-- Realtime — чтобы колокольчик загорался сразу, без перезагрузки
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── Ядро ──
create or replace function public.notify(
  p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;           -- себе не шлём
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  insert into public.notifications (user_id, kind, actor_id, actor_nick, title, body, link, dedupe_key)
  values (p_user, p_kind, p_actor,
          (select nick from public.profiles where id = p_actor),
          left(p_title, 140), left(coalesce(p_body, ''), 200), coalesce(p_link, ''), p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  -- Храним не больше 200 последних на человека
  delete from public.notifications where user_id = p_user and id in (
    select id from public.notifications where user_id = p_user order by created_at desc offset 200
  );
end; $$;
revoke execute on function public.notify(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;

-- Отметить прочитанными: конкретные или все
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ── Форум: ответ в твоей теме ──
create or replace function public.notif_on_forum_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  begin
    select id, title, author_id into t from public.forum_threads where id = new.thread_id;
    if found then
      perform public.notify(t.author_id, 'forum_reply', new.author_id,
        'ответил(а) в твоей теме «' || left(t.title, 60) || '»',
        left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 140),
        '#/forum/' || t.id,
        -- много ответов подряд в одной теме — одно уведомление в 10 минут
        'forum:' || t.id || ':' || new.author_id || ':' || to_char(date_trunc('minute', now()) - (extract(minute from now())::int % 10) * interval '1 minute', 'YYYYMMDDHH24MI'));
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
drop trigger if exists notif_on_forum_post on public.forum_posts;
create trigger notif_on_forum_post after insert on public.forum_posts
  for each row execute function public.notif_on_forum_post();

-- ── Чат: @упоминание (только из сообщений вошедших — гостевой спам упоминаниями не пройдёт) ──
create or replace function public.notif_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text; target uuid; n int := 0;
begin
  begin
    if new.user_id is null or new.text is null or position('@' in new.text) = 0 then return null; end if;
    for m in select distinct lower((regexp_matches(new.text, '@([A-Za-zА-Яа-яЁё0-9_.-]{2,24})', 'g'))[1]) loop
      exit when n >= 3;                                   -- не больше трёх упоминаний на сообщение
      select id into target from public.profiles where lower(nick) = m limit 1;
      if target is not null then
        perform public.notify(target, 'mention', new.user_id,
          'упомянул(а) тебя в чате',
          left(new.text, 160),
          '#/chat',
          -- от одного человека — не чаще раза в 5 минут
          'mention:' || new.user_id || ':' || to_char(date_trunc('minute', now()) - (extract(minute from now())::int % 5) * interval '1 minute', 'YYYYMMDDHH24MI'));
        n := n + 1;
      end if;
    end loop;
  exception when others then null;
  end;
  return null;
end; $$;
drop trigger if exists notif_on_message on public.messages;
create trigger notif_on_message after insert on public.messages
  for each row execute function public.notif_on_message();

-- ── Друзья: заявка и её принятие ──
create or replace function public.notif_on_friendship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' and new.status = 'pending' then
      perform public.notify(new.addressee_id, 'friend_request', new.requester_id,
        'хочет добавить тебя в друзья', '', '#/profile', 'friendreq:' || new.requester_id);
    elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
      perform public.notify(new.requester_id, 'friend_accept', new.addressee_id,
        'принял(а) твою заявку в друзья', '', '#/profile/' || new.addressee_id, 'friendacc:' || new.addressee_id);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
drop trigger if exists notif_on_friendship on public.friendships;
create trigger notif_on_friendship after insert or update of status on public.friendships
  for each row execute function public.notif_on_friendship();

-- ── Идеи: статус и голоса ──
create or replace function public.notif_on_idea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status is distinct from old.status then
      perform public.notify(new.author_id, 'idea_' || new.status, null,
        case new.status
          when 'planned'  then '💡 Твою идею взяли в планы!'
          when 'done'     then '🎬 Твою идею сняли! +100 XP'
          when 'rejected' then 'Идею пока отложили'
          else 'Статус идеи изменён' end,
        '«' || left(new.title, 100) || '»',
        case when new.status = 'done' and new.video_id is not null then '/v/' || new.video_id else '#/ideas' end,
        'idea:' || new.id || ':' || new.status);
    elsif new.votes > old.votes and new.votes in (5, 10, 25, 50, 100) then
      perform public.notify(new.author_id, 'idea_votes', null,
        '🔥 Твою идею поддержали уже ' || new.votes || ' человек',
        '«' || left(new.title, 100) || '»', '#/ideas', 'ideavotes:' || new.id || ':' || new.votes);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

-- ── Реферал ──
create or replace function public.notif_on_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.referred_by is not null and (tg_op = 'INSERT' or old.referred_by is null) then
      perform public.notify(new.referred_by, 'referral', new.id,
        'зарегистрировался(ась) по твоей ссылке! +100 XP', '', '#/profile/' || new.id, 'ref:' || new.id);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

do $$
begin
  if to_regclass('public.ideas') is not null then
    drop trigger if exists notif_on_idea on public.ideas;
    create trigger notif_on_idea after update of status, votes on public.ideas
      for each row execute function public.notif_on_idea();
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'referred_by') then
    drop trigger if exists notif_on_referral on public.profiles;
    create trigger notif_on_referral after insert or update of referred_by on public.profiles
      for each row execute function public.notif_on_referral();
  end if;
end $$;
