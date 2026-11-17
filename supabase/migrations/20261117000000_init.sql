-- =====================================================================
-- 家電場勘助手 Pro — 初始資料庫結構
-- 部署方式：Supabase Dashboard → SQL Editor → 貼上全文 → Run
-- 這份檔案可重複執行（使用 if not exists / or replace / drop policy if exists）
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. 共用：版本號與伺服器時間戳記
--    revision          每次 UPDATE 由伺服器 +1，用於樂觀鎖與衝突偵測
--    server_updated_at 伺服器寫入時間（clock_timestamp），用於增量下載
--    user_id / created_at 不允許被 UPDATE 竄改
-- ---------------------------------------------------------------------
create or replace function public.tg_sync_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    new.revision := old.revision + 1;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. profiles：使用者基本資料（註冊時自動建立）
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. teams / team_members：為未來多人協作預留（v1 不使用）
-- ---------------------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ---------------------------------------------------------------------
-- 3. surveys：場勘主資料
-- ---------------------------------------------------------------------
create table if not exists public.surveys (
  id                uuid primary key,                       -- 由前端產生 UUID（離線可建立）
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  team_id           uuid references public.teams (id) on delete set null,  -- 未來團隊用
  customer_name     text not null default '',
  customer_phone    text,
  survey_date       date,
  customer_address  text,
  product           text,
  product_model     text,
  notes             text,
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at        timestamptz                              -- 軟刪除標記
);

create index if not exists surveys_user_sync_idx on public.surveys (user_id, server_updated_at);
create index if not exists surveys_team_idx on public.surveys (team_id) where team_id is not null;

drop trigger if exists surveys_sync_columns on public.surveys;
create trigger surveys_sync_columns
  before insert or update on public.surveys
  for each row execute function public.tg_sync_columns();

-- ---------------------------------------------------------------------
-- 4. survey_areas：場勘區域與尺寸
--    尺寸為 NULL 代表「尚未測量」，絕不以 0 代替
-- ---------------------------------------------------------------------
create table if not exists public.survey_areas (
  id                uuid primary key,
  survey_id         uuid not null references public.surveys (id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('balcony', 'elevator', 'stairs', 'other')),
  name              text not null,
  width_cm          numeric(8, 1) check (width_cm is null or width_cm >= 0),
  depth_cm          numeric(8, 1) check (depth_cm is null or depth_cm >= 0),
  height_cm         numeric(8, 1) check (height_cm is null or height_cm >= 0),
  notes             text,
  sort_order        integer not null default 0,
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at        timestamptz
);

create index if not exists survey_areas_survey_idx on public.survey_areas (survey_id);
create index if not exists survey_areas_user_sync_idx on public.survey_areas (user_id, server_updated_at);

drop trigger if exists survey_areas_sync_columns on public.survey_areas;
create trigger survey_areas_sync_columns
  before insert or update on public.survey_areas
  for each row execute function public.tg_sync_columns();

-- ---------------------------------------------------------------------
-- 5. survey_photos：照片中繼資料（圖片本體在 Storage，不存 Base64）
--    以 area_id（UUID）關聯，與區域名稱無關，改名不會失聯
-- ---------------------------------------------------------------------
create table if not exists public.survey_photos (
  id                uuid primary key,
  survey_id         uuid not null references public.surveys (id) on delete cascade,
  area_id           uuid not null references public.survey_areas (id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path      text not null unique,                   -- {user_id}/{survey_id}/{photo_id}.jpg
  caption           text,
  sort_order        integer not null default 0,
  width             integer,
  height            integer,
  size_bytes        integer,
  mime_type         text not null default 'image/jpeg',
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at        timestamptz
);

create index if not exists survey_photos_area_idx on public.survey_photos (area_id);
create index if not exists survey_photos_survey_idx on public.survey_photos (survey_id);
create index if not exists survey_photos_user_sync_idx on public.survey_photos (user_id, server_updated_at);

drop trigger if exists survey_photos_sync_columns on public.survey_photos;
create trigger survey_photos_sync_columns
  before insert or update on public.survey_photos
  for each row execute function public.tg_sync_columns();

-- ---------------------------------------------------------------------
-- 6. 權限判斷函式（集中一處，未來加入團隊權限只需改這裡）
-- ---------------------------------------------------------------------
create or replace function public.can_access_survey(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.surveys s
    where s.id = p_survey_id
      and s.user_id = auth.uid()
      -- 未來團隊協作：
      -- or (s.team_id is not null and exists (
      --       select 1 from public.team_members m
      --       where m.team_id = s.team_id and m.user_id = auth.uid()))
  );
$$;

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.surveys       enable row level security;
alter table public.survey_areas  enable row level security;
alter table public.survey_photos enable row level security;

-- profiles：只能讀寫自己的
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- teams / team_members：v1 只開放成員讀取，建立與管理留待團隊功能
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (select 1 from public.team_members m where m.team_id = teams.id and m.user_id = auth.uid())
  );
drop policy if exists team_members_select_self on public.team_members;
create policy team_members_select_self on public.team_members
  for select to authenticated using (user_id = auth.uid());

-- surveys：只能存取自己的
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select to authenticated using (user_id = auth.uid());
drop policy if exists surveys_insert on public.surveys;
create policy surveys_insert on public.surveys
  for insert to authenticated with check (user_id = auth.uid() and team_id is null);
drop policy if exists surveys_update on public.surveys;
create policy surveys_update on public.surveys
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 不開放 DELETE：一律以 deleted_at 軟刪除，避免離線刪除後被舊資料復活

-- survey_areas：必須屬於自己且所屬場勘也是自己的
drop policy if exists survey_areas_select on public.survey_areas;
create policy survey_areas_select on public.survey_areas
  for select to authenticated using (user_id = auth.uid());
drop policy if exists survey_areas_insert on public.survey_areas;
create policy survey_areas_insert on public.survey_areas
  for insert to authenticated with check (user_id = auth.uid() and public.can_access_survey(survey_id));
drop policy if exists survey_areas_update on public.survey_areas;
create policy survey_areas_update on public.survey_areas
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_survey(survey_id));

-- survey_photos：同上，並確認區域屬於同一場勘
drop policy if exists survey_photos_select on public.survey_photos;
create policy survey_photos_select on public.survey_photos
  for select to authenticated using (user_id = auth.uid());
drop policy if exists survey_photos_insert on public.survey_photos;
create policy survey_photos_insert on public.survey_photos
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.can_access_survey(survey_id)
    and exists (select 1 from public.survey_areas a where a.id = area_id and a.survey_id = survey_photos.survey_id)
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );
drop policy if exists survey_photos_update on public.survey_photos;
create policy survey_photos_update on public.survey_photos
  for update to authenticated using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.can_access_survey(survey_id)
    and exists (select 1 from public.survey_areas a where a.id = area_id and a.survey_id = survey_photos.survey_id)
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

-- 資料表權限：匿名角色完全不能存取
-- （明確授權，即使建立專案時關閉「預設授權給 Data API」也能正常運作）
grant usage on schema public to authenticated;
revoke all on public.profiles, public.teams, public.team_members,
              public.surveys, public.survey_areas, public.survey_photos from anon;
grant select, update on public.profiles to authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update on public.surveys, public.survey_areas, public.survey_photos to authenticated;
revoke execute on function public.can_access_survey(uuid) from anon, public;
grant execute on function public.can_access_survey(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Storage：私有 Bucket（照片不可公開存取）
--    路徑規則：{user_id}/{survey_id}/{photo_id}.jpg
--    第一層資料夾必須等於登入者 UUID
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-photos', 'survey-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists survey_photos_obj_select on storage.objects;
create policy survey_photos_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'survey-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists survey_photos_obj_insert on storage.objects;
create policy survey_photos_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'survey-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists survey_photos_obj_update on storage.objects;
create policy survey_photos_obj_update on storage.objects
  for update to authenticated
  using (bucket_id = 'survey-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'survey-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists survey_photos_obj_delete on storage.objects;
create policy survey_photos_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'survey-photos' and (storage.foldername(name))[1] = auth.uid()::text);
