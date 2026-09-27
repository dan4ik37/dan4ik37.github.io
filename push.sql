-- ═══════════════════════════════════════════════════════════════════
--  PUSH-УВЕДОМЛЕНИЯ (новое видео / начало стрима) — даже при закрытом сайте
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--
--  Таблицу напрямую не читает и не пишет никто, кроме сервера (service role,
--  api/push-check.js). Посетители (и гости) подписываются/отписываются только
--  через RPC ниже: знание endpoint (длинный секретный URL от браузера) и есть
--  доказательство, что подписка «своя».
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references auth.users(id) on delete set null,
  want_videos boolean not null default true,
  want_streams boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
-- Политик нет намеренно: anon/authenticated не видят таблицу, service role обходит RLS.

create or replace function public.push_subscribe(
  p_endpoint text, p_p256dh text, p_auth text,
  p_videos boolean default true, p_streams boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 40 and 200
     or coalesce(length(p_auth), 0) not between 10 and 100 then
    raise exception 'bad subscription';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, want_videos, want_streams)
  values (p_endpoint, p_p256dh, p_auth, auth.uid(), coalesce(p_videos, true), coalesce(p_streams, true))
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh, auth = excluded.auth,
    user_id = coalesce(excluded.user_id, push_subscriptions.user_id),
    want_videos = excluded.want_videos, want_streams = excluded.want_streams,
    updated_at = now();
end; $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

grant execute on function public.push_subscribe(text, text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;

-- Что уже разослано (последнее видео, идёт ли эфир) — пишет только сервер
create table if not exists public.push_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.push_state enable row level security;
