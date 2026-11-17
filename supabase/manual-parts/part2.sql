-- 家電場勘助手 Pro 資料庫 2/5（請依序執行 1→5）
create table if not exists public.surveys (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  team_id           uuid references public.teams (id) on delete set null,
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
  deleted_at        timestamptz
);
create index if not exists surveys_user_sync_idx on public.surveys (user_id, server_updated_at);
create index if not exists surveys_team_idx on public.surveys (team_id) where team_id is not null;
drop trigger if exists surveys_sync_columns on public.surveys;
create trigger surveys_sync_columns
  before insert or update on public.surveys
  for each row execute function public.tg_sync_columns();
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
create table if not exists public.survey_photos (
  id                uuid primary key,
  survey_id         uuid not null references public.surveys (id) on delete cascade,
  area_id           uuid not null references public.survey_areas (id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path      text not null unique,
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
