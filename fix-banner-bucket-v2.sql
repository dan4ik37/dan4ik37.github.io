-- ═══════════════════════════════════════════════════════════════════
--  ФИКС #2: "profile-covers" ТОЖЕ попал под блокировку
--  Первое переименование (banners → profile-covers) не помогло — слово
--  "covers" тоже встречается в фильтрах блокировщиков (обложки/covers у
--  рекламных виджетов). На этот раз без всякого гадания по словам —
--  переименовываем во что-то максимально нейтральное и техническое,
--  что вообще не пересекается с рекламной лексикой.
--  Выполнить в Supabase → SQL Editor после profile-system.sql и
--  fix-banner-bucket.sql (тот, что создал profile-covers).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Новый бакет
insert into storage.buckets (id, name, public)
values ('profile-bg', 'profile-bg', true)
on conflict (id) do nothing;

-- 2. Политики
drop policy if exists "Фон профиля читают все" on storage.objects;
create policy "Фон профиля читают все"
  on storage.objects for select
  using (bucket_id = 'profile-bg');

drop policy if exists "Свой фон профиля могу загружать/менять/удалять" on storage.objects;
create policy "Свой фон профиля могу загружать/менять/удалять"
  on storage.objects for all
  using (bucket_id = 'profile-bg' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-bg' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Сбрасываем ссылки на profile-covers — снова попросим перезалить
update public.profiles
set banner_url = null
where banner_url like '%/profile-covers/%';

-- 4. Старые бакеты banners и profile-covers можно удалить руками в
--    Storage, когда убедишься, что всё работает с новым именем.
