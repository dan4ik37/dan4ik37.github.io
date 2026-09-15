-- ═══════════════════════════════════════════════════════════════════
--  ФИКС: бакет "banners" режется блокировщиками рекламы
--  Слово "banners" есть в фильтрах AdBlock/uBlock (баннерная реклама),
--  поэтому любой URL с ним получает ERR_BLOCKED_BY_CLIENT ещё в браузере,
--  до всякого запроса к серверу. Переименовываем в нейтральное.
--  Выполнить в Supabase → SQL Editor после profile-system.sql.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Новый бакет с безопасным именем
insert into storage.buckets (id, name, public)
values ('profile-covers', 'profile-covers', true)
on conflict (id) do nothing;

-- 2. Политики для него (копия тех, что были у banners)
drop policy if exists "Обложки читают все" on storage.objects;
create policy "Обложки читают все"
  on storage.objects for select
  using (bucket_id = 'profile-covers');

drop policy if exists "Свою обложку могу загружать/менять/удалять" on storage.objects;
create policy "Свою обложку могу загружать/менять/удалять"
  on storage.objects for all
  using (bucket_id = 'profile-covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Сбрасываем старые ссылки на banners — они всё равно блокируются,
--    пусть люди перезальют фон (он один, это не потеря данных).
update public.profiles
set banner_url = null
where banner_url like '%/banners/%';

-- 4. Старый бакет можно удалить руками в Storage → banners → Delete,
--    когда убедишься, что всё работает. Автоматически не удаляю: если
--    в нём остались чьи-то файлы, лучше глянуть глазами.
