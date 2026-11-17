-- 家電場勘助手 Pro 資料庫 5/5（請依序執行 1→5）
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
