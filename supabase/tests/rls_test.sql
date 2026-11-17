\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
insert into auth.users values (:'A','a@x.com'), (:'B','b@x.com');
select 'profiles auto-created: ' || count(*) from public.profiles;

-- User A
set role authenticated; select set_config('request.jwt.claim.sub', :'A', false);
insert into surveys (id, customer_name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'A 客戶');
insert into survey_areas (id, survey_id, kind, name) values ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','balcony','陽台');
insert into survey_photos (id, survey_id, area_id, storage_path) values ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1', :'A' || '/aaaaaaaa-0000-0000-0000-000000000001/f1.jpg');
insert into storage.objects (bucket_id, name) values ('survey-photos', :'A' || '/s/f1.jpg');
select 'A sees surveys: ' || count(*) from surveys;
-- 樂觀鎖：revision 1 → 2
update surveys set customer_name='A 改名' where id='aaaaaaaa-0000-0000-0000-000000000001' and revision=1 returning 'update ok, revision=' || revision;
-- 舊版本更新應該 0 筆（衝突）
with u as (update surveys set customer_name='過期' where id='aaaaaaaa-0000-0000-0000-000000000001' and revision=1 returning 1) select 'stale update rows: ' || count(*) from u;
-- 試圖竄改 user_id 應被 trigger 保持原值
update surveys set user_id=:'B' where id='aaaaaaaa-0000-0000-0000-000000000001';
select 'user_id still A: ' || (user_id = :'A') from surveys;

-- User B
select set_config('request.jwt.claim.sub', :'B', false);
select 'B sees surveys: ' || count(*) from surveys;
select 'B sees areas: ' || count(*) from survey_areas;
select 'B sees photos: ' || count(*) from survey_photos;
select 'B sees storage objects: ' || count(*) from storage.objects;
with u as (update surveys set customer_name='hack' returning 1) select 'B update rows: ' || count(*) from u;
\set ON_ERROR_STOP 0
\echo '--- 以下每一行都應該出現 ERROR ---'
insert into survey_areas (id, survey_id, kind, name) values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','other','B 塞區域到 A 的場勘');
insert into surveys (id, user_id, customer_name) values (gen_random_uuid(), :'A', 'B 冒充 A');
insert into storage.objects (bucket_id, name) values ('survey-photos', :'A' || '/s/evil.jpg');
delete from surveys;
\set ON_ERROR_STOP 1

-- 匿名
reset role; set role anon;
\set ON_ERROR_STOP 0
select count(*) from surveys;
\set ON_ERROR_STOP 1
reset role;
select 'bucket public = ' || public from storage.buckets;
