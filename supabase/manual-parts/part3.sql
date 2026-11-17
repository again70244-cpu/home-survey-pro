-- 家電場勘助手 Pro 資料庫 3/5（請依序執行 1→5）
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
  );
$$;
alter table public.profiles      enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.surveys       enable row level security;
alter table public.survey_areas  enable row level security;
alter table public.survey_photos enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (select 1 from public.team_members m where m.team_id = teams.id and m.user_id = auth.uid())
  );
drop policy if exists team_members_select_self on public.team_members;
create policy team_members_select_self on public.team_members
  for select to authenticated using (user_id = auth.uid());
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select to authenticated using (user_id = auth.uid());
drop policy if exists surveys_insert on public.surveys;
create policy surveys_insert on public.surveys
  for insert to authenticated with check (user_id = auth.uid() and team_id is null);
drop policy if exists surveys_update on public.surveys;
create policy surveys_update on public.surveys
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists survey_areas_select on public.survey_areas;
create policy survey_areas_select on public.survey_areas
  for select to authenticated using (user_id = auth.uid());
drop policy if exists survey_areas_insert on public.survey_areas;
create policy survey_areas_insert on public.survey_areas
  for insert to authenticated with check (user_id = auth.uid() and public.can_access_survey(survey_id));
