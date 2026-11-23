-- =====================================================================
-- 場勘產品：手動修正規格 + 指定適用的檢查模板（增量遷移：只新增欄位，可重複執行）
--
-- spec_overrides：只屬於這筆場勘的規格修正，格式 {"fields": {"width_cm": 91, ...}, "note": "說明書", "updated_at": "..."}
--   規格快照（spec_snapshot）仍然不可變；檢查與報告以「修正值優先、否則快照值」計算，並標示手動修正。
--   產品知識庫（catalog_products）不受影響，永久修正請改 Google 試算表。
-- template_type：這個產品要套用哪個現場檢查（washer、fridge…；'none' = 不檢查；null = 依分類自動判斷）
-- 前置：20261124000000_survey_products.sql
-- =====================================================================

alter table public.survey_products add column if not exists spec_overrides jsonb;
alter table public.survey_products add column if not exists template_type text;

do $$ begin
  alter table public.survey_products add constraint survey_products_spec_overrides_chk
    check (spec_overrides is null or (jsonb_typeof(spec_overrides) = 'object' and pg_column_size(spec_overrides) < 8192));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.survey_products add constraint survey_products_template_type_chk
    check (template_type is null or template_type ~ '^[a-z0-9_]{1,40}$');
exception when duplicate_object then null; end $$;

-- 撤回（只在確定要移除此功能時執行；不影響規格快照）：
-- alter table public.survey_products drop constraint if exists survey_products_spec_overrides_chk;
-- alter table public.survey_products drop constraint if exists survey_products_template_type_chk;
-- alter table public.survey_products drop column if exists spec_overrides;
-- alter table public.survey_products drop column if exists template_type;
