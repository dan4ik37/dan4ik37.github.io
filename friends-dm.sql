-- ═══════════════════════════════════════════════════════════════════
--  ДРУЗЬЯ + ЛИЧНЫЕ СООБЩЕНИЯ
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Заявки в друзья / сами друзья — одна строка на пару, статус меняется
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid references auth.users(id) not null,
  addressee_id uuid references auth.users(id) not null,
  status text not null default 'pending', -- 'pending' | 'accepted'
  created_at timestamptz default now(),
  unique (requester_id, addressee_id),
  constraint no_self_friend check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

-- Видеть свои заявки/друзей (в любую сторону — и кому отправил, и кто прислал)
drop policy if exists "Свои заявки видит любая сторона" on public.friendships;
create policy "Свои заявки видит любая сторона"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Отправить заявку — только от своего имени
drop policy if exists "Отправить заявку можно только от себя" on public.friendships;
create policy "Отправить заявку можно только от себя"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

-- Принять заявку — только тот, кому её прислали
drop policy if exists "Принять заявку может только адресат" on public.friendships;
create policy "Принять заявку может только адресат"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (status = 'accepted');

-- Удалить/отклонить — любая сторона
drop policy if exists "Удалить дружбу может любая сторона" on public.friendships;
create policy "Удалить дружбу может любая сторона"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- 2. Личные сообщения — писать можно только подтверждённому другу,
--    проверяется прямо в RLS-политике (не только на фронтенде)
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid references auth.users(id) not null,
  recipient_id uuid references auth.users(id) not null,
  text text not null,
  created_at timestamptz default now(),
  read_at timestamptz
);

alter table public.direct_messages enable row level security;

drop policy if exists "ЛС видит только отправитель и получатель" on public.direct_messages;
create policy "ЛС видит только отправитель и получатель"
  on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "Писать ЛС можно только другу" on public.direct_messages;
create policy "Писать ЛС можно только другу"
  on public.direct_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = recipient_id)
          or (f.addressee_id = auth.uid() and f.requester_id = recipient_id))
    )
  );

-- Отметить прочитанным — только получатель
drop policy if exists "Отметить прочитанным может только получатель" on public.direct_messages;
create policy "Отметить прочитанным может только получатель"
  on public.direct_messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Индексы — без них поиск переписки/непрочитанных будет медленным
-- при большом количестве сообщений
create index if not exists idx_dm_conversation on public.direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);
create index if not exists idx_dm_recipient_unread on public.direct_messages (recipient_id) where read_at is null;

-- Включаем realtime для ЛС (как уже включён для messages/reactions) —
-- без этого новые сообщения не будут появляться без обновления страницы
alter publication supabase_realtime add table public.direct_messages;
