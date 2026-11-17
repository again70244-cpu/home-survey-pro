-- 修補：撤銷登入使用者的 DELETE / TRUNCATE 權限（一律使用軟刪除）
-- 已包含在最新版 init.sql；舊專案只需執行這一段
revoke all on public.profiles, public.teams, public.team_members,
              public.surveys, public.survey_areas, public.survey_photos from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update on public.surveys, public.survey_areas, public.survey_photos to authenticated;
