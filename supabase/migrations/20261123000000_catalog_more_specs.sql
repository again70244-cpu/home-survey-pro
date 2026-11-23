-- =====================================================================
-- LG 產品知識庫：新增 3 個安裝規格欄位（增量遷移，可重複執行）
-- 依實際試算表內容新增：
--   門開90度總寬（冰箱「門開90度總深125 總寬85」）
--   拆門總深（冰箱「拆門總深63.5」，搬運進門時使用）
--   抽屜全開總深（冰箱「抽屜全開總深140.6」，與洗衣機抽屜櫃的「全開總深」分開）
-- 只新增欄位並更新寫入函式；不修改、不刪除任何既有欄位或資料。
-- 前置：20261120000000_product_catalog.sql
-- =====================================================================

alter table public.catalog_products add column if not exists door_open_90_width_cm numeric(8, 1) check (door_open_90_width_cm >= 0);
alter table public.catalog_products add column if not exists door_removed_depth_cm numeric(8, 1) check (door_removed_depth_cm >= 0);
alter table public.catalog_products add column if not exists drawer_open_depth_cm  numeric(8, 1) check (drawer_open_depth_cm >= 0);

create or replace function public.catalog_apply_snapshot(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dataset   text := coalesce(p->>'dataset', 'production');
  v_mode      text := coalesce(p->>'mode', 'sync');
  v_trigger   text := coalesce(p->>'trigger', 'manual');
  v_force     boolean := coalesce((p->>'force')::boolean, false);
  v_hash      text := p->>'source_hash';
  v_products  jsonb := coalesce(p->'products', '[]'::jsonb);
  v_systems   jsonb := coalesce(p->'systems', '[]'::jsonb);
  v_run       uuid := gen_random_uuid();
  v_last_hash text;
  v_active    integer;
  v_new       integer := jsonb_array_length(v_products);
  v_diff      jsonb;
  v_counts    jsonb;
  v_status    text;
begin
  if v_dataset not in ('production', 'staging') then raise exception 'invalid dataset %', v_dataset; end if;
  if v_mode not in ('sync', 'full', 'preview') then raise exception 'invalid mode %', v_mode; end if;

  -- 防重放：同一個 request_id 只能使用一次
  insert into catalog_sync_nonces (request_id) values (p->>'request_id');
  delete from catalog_sync_nonces where used_at < now() - interval '2 days';

  select source_hash into v_last_hash from catalog_sync_runs
   where dataset = v_dataset and status = 'success' order by finished_at desc limit 1;

  -- 新快照的鍵
  create temp table _np on commit drop as
    select e->>'source_key' as source_key, e->>'content_hash' as content_hash, e->>'spec_hash' as spec_hash, e
      from jsonb_array_elements(v_products) e;
  create temp table _ns on commit drop as
    select e->>'source_key' as source_key, e->>'content_hash' as content_hash, e
      from jsonb_array_elements(v_systems) e;
  if (select count(*) from _np) <> (select count(distinct source_key) from _np) then
    raise exception 'duplicate product source_key in snapshot';
  end if;

  select count(*) into v_active from catalog_products where dataset = v_dataset and is_active;

  -- 差異
  v_diff := jsonb_build_object(
    'products', jsonb_build_object(
      'added', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _np n
                          where not exists (select 1 from catalog_products c where c.dataset = v_dataset and c.source_key = n.source_key)), '[]'),
      'reactivated', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _np n join catalog_products c
                          on c.dataset = v_dataset and c.source_key = n.source_key where not c.is_active), '[]'),
      'updated', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _np n join catalog_products c
                          on c.dataset = v_dataset and c.source_key = n.source_key where c.content_hash <> n.content_hash), '[]'),
      'spec_changed', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _np n join catalog_products c
                          on c.dataset = v_dataset and c.source_key = n.source_key where c.spec_hash <> n.spec_hash), '[]'),
      'deactivated', coalesce((select jsonb_agg(c.source_key order by c.source_key) from catalog_products c
                          where c.dataset = v_dataset and c.is_active and not exists (select 1 from _np n where n.source_key = c.source_key)), '[]')
    ),
    'systems', jsonb_build_object(
      'added', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _ns n
                          where not exists (select 1 from catalog_multi_split_systems c where c.dataset = v_dataset and c.source_key = n.source_key)), '[]'),
      'updated', coalesce((select jsonb_agg(n.source_key order by n.source_key) from _ns n join catalog_multi_split_systems c
                          on c.dataset = v_dataset and c.source_key = n.source_key where c.content_hash <> n.content_hash or not c.is_active), '[]'),
      'deactivated', coalesce((select jsonb_agg(c.source_key order by c.source_key) from catalog_multi_split_systems c
                          where c.dataset = v_dataset and c.is_active and not exists (select 1 from _ns n where n.source_key = c.source_key)), '[]')
    )
  );
  v_counts := jsonb_build_object(
    'products', v_new,
    'previous_active', v_active,
    'with_install', (select count(*) from _np where e->>'data_quality' <> 'missing'),
    'complete', (select count(*) from _np where e->>'data_quality' = 'complete'),
    'missing', (select count(*) from _np where e->>'data_quality' = 'missing'),
    'invalid', (select count(*) from _np where e->>'data_quality' = 'invalid'),
    'needs_review', (select count(*) from _np where e->>'data_quality' = 'needs_review'),
    'systems', jsonb_array_length(v_systems)
  );

  -- 資料沒有變（一般同步才略過；完整重新同步一定重新套用）
  if v_mode = 'sync' and not v_force and v_hash is not null and v_hash = v_last_hash then
    v_status := 'unchanged';
  -- 預覽：只回報差異，不寫入
  elsif v_mode = 'preview' then
    v_status := 'preview';
  -- 異常保護：快照為空或有效產品減少超過 30% → 拒絕（需人工以 force 確認）
  elsif not v_force and (v_new = 0 or (v_active > 0 and v_new < v_active * 0.7)) then
    v_status := 'rejected';
  else
    v_status := 'success';

    insert into catalog_products as c (
      dataset, source_key, source_sheet, source_row, model_code, model_raw, description, display_name, category_raw, category,
      image_urls, link_urls, video_urls, maintenance_notes, install_text_raw,
      width_cm, height_cm, depth_cm, door_open_90_depth_cm, door_open_90_width_cm, door_removed_depth_cm, full_open_depth_cm,
      drawer_open_depth_cm, full_open_height_cm, door_clearance_cm,
      power_cable_cm, water_inlet_hose_cm, drain_hose_cm, inlet_drain_hose_cm, package_width_cm, package_height_cm, package_depth_cm,
      install_extra, parse_issues, data_quality, content_hash, spec_hash, last_sync_run_id
    )
    select v_dataset, n.source_key, split_part(n.source_key, ':', 1), (e->>'source_row')::int, e->>'model_code', e->>'model_raw',
           e->>'description', e->>'display_name', e->>'category_raw', e->>'category',
           array(select jsonb_array_elements_text(coalesce(e->'image_urls', '[]'))),
           array(select jsonb_array_elements_text(coalesce(e->'link_urls', '[]'))),
           array(select jsonb_array_elements_text(coalesce(e->'video_urls', '[]'))),
           e->>'maintenance_notes', e->>'install_text_raw',
           (e->'specs'->>'width_cm')::numeric, (e->'specs'->>'height_cm')::numeric, (e->'specs'->>'depth_cm')::numeric,
           (e->'specs'->>'door_open_90_depth_cm')::numeric, (e->'specs'->>'door_open_90_width_cm')::numeric,
           (e->'specs'->>'door_removed_depth_cm')::numeric, (e->'specs'->>'full_open_depth_cm')::numeric,
           (e->'specs'->>'drawer_open_depth_cm')::numeric,
           (e->'specs'->>'full_open_height_cm')::numeric, (e->'specs'->>'door_clearance_cm')::numeric,
           (e->'specs'->>'power_cable_cm')::numeric, (e->'specs'->>'water_inlet_hose_cm')::numeric,
           (e->'specs'->>'drain_hose_cm')::numeric, (e->'specs'->>'inlet_drain_hose_cm')::numeric,
           (e->'specs'->>'package_width_cm')::numeric, (e->'specs'->>'package_height_cm')::numeric,
           (e->'specs'->>'package_depth_cm')::numeric,
           coalesce(e->'install_extra', '{}'), coalesce(e->'parse_issues', '[]'), e->>'data_quality',
           n.content_hash, n.spec_hash, v_run
      from _np n
    on conflict (dataset, source_key) do update set
      source_row = excluded.source_row, model_code = excluded.model_code, model_raw = excluded.model_raw,
      description = excluded.description, display_name = excluded.display_name,
      category_raw = excluded.category_raw, category = excluded.category,
      image_urls = excluded.image_urls, link_urls = excluded.link_urls, video_urls = excluded.video_urls,
      maintenance_notes = excluded.maintenance_notes, install_text_raw = excluded.install_text_raw,
      width_cm = excluded.width_cm, height_cm = excluded.height_cm, depth_cm = excluded.depth_cm,
      door_open_90_depth_cm = excluded.door_open_90_depth_cm, door_open_90_width_cm = excluded.door_open_90_width_cm,
      door_removed_depth_cm = excluded.door_removed_depth_cm, full_open_depth_cm = excluded.full_open_depth_cm,
      drawer_open_depth_cm = excluded.drawer_open_depth_cm,
      full_open_height_cm = excluded.full_open_height_cm, door_clearance_cm = excluded.door_clearance_cm,
      power_cable_cm = excluded.power_cable_cm, water_inlet_hose_cm = excluded.water_inlet_hose_cm,
      drain_hose_cm = excluded.drain_hose_cm, inlet_drain_hose_cm = excluded.inlet_drain_hose_cm,
      package_width_cm = excluded.package_width_cm, package_height_cm = excluded.package_height_cm,
      package_depth_cm = excluded.package_depth_cm,
      install_extra = excluded.install_extra, parse_issues = excluded.parse_issues, data_quality = excluded.data_quality,
      is_active = true, deactivated_at = null, last_synced_at = now(), last_sync_run_id = v_run,
      revision        = c.revision + (case when c.content_hash <> excluded.content_hash or not c.is_active then 1 else 0 end),
      last_changed_at = case when c.content_hash <> excluded.content_hash or not c.is_active then now() else c.last_changed_at end,
      spec_updated_at = case when c.spec_hash <> excluded.spec_hash then now() else c.spec_updated_at end,
      content_hash = excluded.content_hash, spec_hash = excluded.spec_hash;

    -- 試算表中已不存在：停用（軟刪除），不刪資料
    update catalog_products c set is_active = false, deactivated_at = now(), last_changed_at = now(),
           revision = c.revision + 1, last_sync_run_id = v_run
     where c.dataset = v_dataset and c.is_active and not exists (select 1 from _np n where n.source_key = c.source_key);

    -- 一對多
    insert into catalog_multi_split_systems as c (
      dataset, source_key, source_row, model_code, outdoor_text, capacity_kw, indoor_counts, notes, rules, issues, content_hash, last_sync_run_id
    )
    select v_dataset, n.source_key, (e->>'source_row')::int, e->>'model_code', e->>'outdoor_text', (e->>'capacity_kw')::numeric,
           array(select (jsonb_array_elements_text(coalesce(e->'indoor_counts', '[]')))::int),
           e->>'notes', coalesce(e->'rules', '[]'), coalesce(e->'issues', '[]'), n.content_hash, v_run
      from _ns n
    on conflict (dataset, source_key) do update set
      source_row = excluded.source_row, model_code = excluded.model_code, outdoor_text = excluded.outdoor_text,
      capacity_kw = excluded.capacity_kw, indoor_counts = excluded.indoor_counts, notes = excluded.notes,
      rules = excluded.rules, issues = excluded.issues, is_active = true, deactivated_at = null,
      last_synced_at = now(), last_sync_run_id = v_run,
      last_changed_at = case when c.content_hash <> excluded.content_hash or not c.is_active then now() else c.last_changed_at end,
      content_hash = excluded.content_hash;

    delete from catalog_multi_split_indoor_units u using catalog_multi_split_systems s, _ns n
     where u.system_id = s.id and s.dataset = v_dataset and s.source_key = n.source_key;
    insert into catalog_multi_split_indoor_units (system_id, position, model_code, series, capacity_kw, source_text)
    select s.id, (i->>'position')::int, i->>'model_code', i->>'series', (i->>'capacity_kw')::numeric, i->>'source_text'
      from _ns n
      join catalog_multi_split_systems s on s.dataset = v_dataset and s.source_key = n.source_key
      cross join lateral jsonb_array_elements(coalesce(n.e->'indoor_units', '[]')) i;

    update catalog_multi_split_systems c set is_active = false, deactivated_at = now(), last_changed_at = now(), last_sync_run_id = v_run
     where c.dataset = v_dataset and c.is_active and not exists (select 1 from _ns n where n.source_key = c.source_key);
  end if;

  insert into catalog_sync_runs (id, dataset, trigger, mode, status, request_id, spreadsheet_id, source_hash, counts, diff, warnings, error, started_at)
  values (v_run, v_dataset, v_trigger, v_mode, v_status, p->>'request_id', p->>'spreadsheet_id', v_hash, v_counts, v_diff,
          coalesce(p->'warnings', '[]'),
          case when v_status = 'rejected' then format('產品數量 %s 筆，比目前有效的 %s 筆少超過 30%%（或為 0），為避免誤刪已拒絕套用。確認無誤請使用「完整重新同步（強制）」。', v_new, v_active) end,
          coalesce((p->>'started_at')::timestamptz, now()));

  return jsonb_build_object('run_id', v_run, 'status', v_status, 'counts', v_counts, 'diff', v_diff);
end;
$$;

revoke all on function public.catalog_apply_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_apply_snapshot(jsonb) to service_role;
