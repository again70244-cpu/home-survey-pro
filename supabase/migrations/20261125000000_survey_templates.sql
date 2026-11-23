-- =====================================================================
-- 場勘模板欄位值 + 照片拍攝項目（增量遷移：只新增，可重複執行）
--
-- survey_templates：每筆場勘、每種模板一筆（例如洗衣機模板），欄位值存在 values（jsonb）。
--   id 由前端以 survey_id + template_id 決定性產生，兩台裝置離線各自建立也會是同一筆。
--   template_version 記錄填寫時的模板版本，模板日後改版不影響舊案件。
-- survey_photos.shot_key：照片對應的拍攝清單項目（可為空，舊照片不受影響）。
-- 與其他場勘資料表相同：只能存取自己的資料、沒有 DELETE（軟刪除）、revision 同步。
-- 前置：20261117000000_init.sql
-- =====================================================================

create table if not exists public.survey_templates (
  id                uuid primary key,
  survey_id         uuid not null references public.surveys (id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id       text not null check (template_id ~ '^[a-z0-9_]{1,40}$'),
  template_version  integer not null check (template_version > 0),
  install_area_id   uuid,                                   -- 安裝位置（survey_areas.id；區域刪除時自動改用預設）
  "values"          jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object' and pg_column_size("values") < 32768),
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at        timestamptz,
  unique (survey_id, template_id)
);
create index if not exists survey_templates_user_sync_idx on public.survey_templates (user_id, server_updated_at);

drop trigger if exists survey_templates_sync_columns on public.survey_templates;
create trigger survey_templates_sync_columns
  before insert or update on public.survey_templates
  for each row execute function public.tg_sync_columns();

alter table public.survey_templates enable row level security;

drop policy if exists survey_templates_select on public.survey_templates;
create policy survey_templates_select on public.survey_templates
  for select to authenticated using (user_id = auth.uid());
drop policy if exists survey_templates_insert on public.survey_templates;
create policy survey_templates_insert on public.survey_templates
  for insert to authenticated with check (user_id = auth.uid() and public.can_access_survey(survey_id));
drop policy if exists survey_templates_update on public.survey_templates;
create policy survey_templates_update on public.survey_templates
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_survey(survey_id));

revoke all on public.survey_templates from anon, authenticated;
grant select, insert, update on public.survey_templates to authenticated;
grant all on public.survey_templates to service_role;

-- 照片拍攝項目
alter table public.survey_photos add column if not exists shot_key text;
do $$ begin
  alter table public.survey_photos add constraint survey_photos_shot_key_chk check (shot_key is null or shot_key ~ '^[a-z0-9_]{1,40}$');
exception when duplicate_object then null; end $$;

-- 撤回（只在確定要移除此功能時執行；不影響場勘、區域、照片本身）：
-- drop table if exists public.survey_templates;
-- alter table public.survey_photos drop constraint if exists survey_photos_shot_key_chk;
-- alter table public.survey_photos drop column if exists shot_key;
