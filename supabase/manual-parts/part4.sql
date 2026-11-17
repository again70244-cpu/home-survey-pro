-- 家電場勘助手 Pro 資料庫 4/5（請依序執行 1→5）
drop policy if exists survey_areas_update on public.survey_areas;
create policy survey_areas_update on public.survey_areas
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_survey(survey_id));
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
grant usage on schema public to authenticated;
revoke all on public.profiles, public.teams, public.team_members,
              public.surveys, public.survey_areas, public.survey_photos from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update on public.surveys, public.survey_areas, public.survey_photos to authenticated;
revoke execute on function public.can_access_survey(uuid) from anon, public;
grant execute on function public.can_access_survey(uuid) to authenticated;
