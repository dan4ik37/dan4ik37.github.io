-- ═══════════════════════════════════════════════════════════════════
--  СИСТЕМА ПРОФИЛЕЙ
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Новые поля в profiles
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists banner_url text,
  add column if not exists bio text,
  add column if not exists is_vip boolean default false,
  add column if not exists vip_until timestamptz;

-- 2. Привязка сообщений чата к аккаунту (для мини-профиля по клику на
--    ник — раньше в messages был только текст ника, без account_id, и
--    для гостей, и для зарегистрированных. Гости так и останутся с
--    user_id = null, для них мини-профиль просто не будет открываться.
alter table public.messages
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- 3. Storage-бакеты под аватарки и баннеры (публичное чтение, пишет
--    только владелец в свою собственную папку — папка называется как
--    его uid, см. RLS-политики ниже)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

drop policy if exists "Аватарки читают все" on storage.objects;
create policy "Аватарки читают все"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Свою аватарку могу загружать/менять/удалять" on storage.objects;
create policy "Свою аватарку могу загружать/менять/удалять"
  on storage.objects for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Баннеры читают все" on storage.objects;
create policy "Баннеры читают все"
  on storage.objects for select
  using (bucket_id = 'banners');

drop policy if exists "Свой баннер могу загружать/менять/удалять" on storage.objects;
create policy "Свой баннер могу загружать/менять/удалять"
  on storage.objects for all
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════
--  VIP / анимированные аватарки (.gif)
--  Про автоматическую привязку доната к аккаунту — см. пояснение в
--  чате: DonationAlerts не знает, кто из донатеров залогинен на сайте
--  (донат анонимный текстовый ник, не Supabase-аккаунт). Поэтому VIP
--  выдаётся вручную: увидел донат ~200₽ в DonationAlerts/лидерборде →
--  зашёл в "👥 Роли" в настройках сайта → поставил галку VIP человеку
--  с соответствующим ником → готово. Стафф (admin/moderator/helper)
--  получает право на анимацию бесплатно и без этого флага — проверяется
--  прямо в коде (см. features/profile.js), is_vip им не нужен.
--
--  Выдать/снять VIP вручную одной командой (если не через UI):
--    update public.profiles set is_vip = true, vip_until = now() + interval '30 days'
--    where id = (select id from auth.users where email = 'его@почта.ру');
-- ═══════════════════════════════════════════════════════════════════
