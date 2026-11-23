-- =====================================================================
-- 場勘案件選擇的產品與規格快照（增量遷移：只新增資料表，可重複執行）
--
-- 每筆場勘可選擇多個 LG 產品。選擇當下把產品規格完整複製到 spec_snapshot，
-- 之後 Google Sheets／產品知識庫再怎麼更新，舊案件的快照都不會改變。
-- 資料庫層保證：spec_snapshot 建立後無法被 UPDATE 改寫（trigger 會保留原值）。
-- 與 surveys / survey_areas 相同：只能存取自己的資料、沒有 DELETE（軟刪除）、revision 同步。
-- 前置：20261117000000_init.sql、20261120000000_product_catalog.sql
-- =====================================================================

create table if not exists public.survey_products (
  id                      uuid primary key,                 -- 前端產生 UUID（離線可建立）
  survey_id               uuid not null references public.surveys (id) on delete cascade,
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  catalog_product_id      uuid references public.catalog_products (id) on delete set null, -- 產品停用或移除都不影響
  model_code              text not null,
  display_name            text,
  category                text,
  spec_snapshot           jsonb not null,                   -- 選擇當下的完整規格（不可變）
  snapshot_at             timestamptz not null,
  catalog_spec_hash       text,                             -- 快照對應的產品規格版本
  catalog_spec_updated_at timestamptz,
  sort_order              integer not null default 0,
  revision                integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  server_updated_at       timestamptz not null default clock_timestamp(),
  deleted_at              timestamptz
);
create index if not exists survey_products_survey_idx on public.survey_products (survey_id);
create index if not exists survey_products_user_sync_idx on public.survey_products (user_id, server_updated_at);

drop trigger if exists survey_products_sync_columns on public.survey_products;
create trigger survey_products_sync_columns
  before insert or update on public.survey_products
  for each row execute function public.tg_sync_columns();

-- 快照不可變：UPDATE 時一律保留原本的快照與來源資訊
create or replace function public.tg_survey_products_freeze_snapshot()
returns trigger
language plpgsql
as $$
begin
  new.spec_snapshot := old.spec_snapshot;
  new.snapshot_at := old.snapshot_at;
  new.catalog_spec_hash := old.catalog_spec_hash;
  new.catalog_spec_updated_at := old.catalog_spec_updated_at;
  new.model_code := old.model_code;
  new.catalog_product_id := old.catalog_product_id;
  new.survey_id := old.survey_id;
  return new;
end;
$$;
drop trigger if exists survey_products_freeze_snapshot on public.survey_products;
create trigger survey_products_freeze_snapshot
  before update on public.survey_products
  for each row execute function public.tg_survey_products_freeze_snapshot();

alter table public.survey_products enable row level security;

drop policy if exists survey_products_select on public.survey_products;
create policy survey_products_select on public.survey_products
  for select to authenticated using (user_id = auth.uid());
drop policy if exists survey_products_insert on public.survey_products;
create policy survey_products_insert on public.survey_products
  for insert to authenticated with check (user_id = auth.uid() and public.can_access_survey(survey_id));
drop policy if exists survey_products_update on public.survey_products;
create policy survey_products_update on public.survey_products
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_survey(survey_id));

revoke all on public.survey_products from anon, authenticated;
grant select, insert, update on public.survey_products to authenticated;
grant all on public.survey_products to service_role;

-- 撤回（只在確定要移除此功能時執行；不影響場勘、區域、照片資料）：
-- drop table if exists public.survey_products;
-- drop function if exists public.tg_survey_products_freeze_snapshot();
