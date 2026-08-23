create or replace view public.staff_account_permission_health_v1 as
with active_dupes as (
  select staff_id, count(*) filter (where active = true and coalesce(can_login,true) = true) as active_account_count
  from public.staff_accounts
  where staff_id is not null and btrim(staff_id) <> ''
  group by staff_id
)
select
  sa.id as account_id,
  sa.staff_id,
  coalesce(nullif(btrim(sa.staff_name),''), nullif(btrim(sa.name),''), sa.username) as staff_name,
  sa.username,
  sa.role,
  sa.staff_role,
  sa.branch,
  sa.active,
  sa.is_active,
  sa.can_login,
  sa.role_scope,
  sa.branch_scope,
  coalesce(ad.active_account_count,0) as active_account_count_for_staff,
  case when sa.is_active is not null and sa.active is distinct from sa.is_active then true else false end as active_state_mismatch,
  case when lower(coalesce(btrim(sa.staff_name), btrim(sa.name), '')) in ('غير محدد','غير معروف','unknown','undefined','null','user') then true else false end as placeholder_identity,
  case when sa.staff_id is not null and btrim(sa.staff_id) <> '' and not exists (select 1 from public.staff s where s.id::text = sa.staff_id) then true else false end as orphan_staff_link,
  case when coalesce(ad.active_account_count,0) > 1 then true else false end as duplicate_active_staff_account,
  case
    when jsonb_typeof(sa.permissions)='object'
     and nullif(btrim(sa.permissions->>'role'),'') is not null
     and lower(btrim(sa.permissions->>'role')) <> lower(btrim(coalesce(sa.role,'')))
    then true else false end as permission_role_metadata_mismatch,
  case
    when jsonb_typeof(sa.permissions)='object'
     and nullif(btrim(sa.permissions->>'branch'),'') is not null
     and lower(replace(btrim(sa.permissions->>'branch'),'الكل','كل الفروع')) <> lower(replace(btrim(coalesce(sa.branch,'')),'الكل','كل الفروع'))
    then true else false end as permission_branch_metadata_mismatch,
  case
    when jsonb_typeof(sa.permissions)='object'
     and nullif(btrim(sa.permissions->>'staff_name'),'') is not null
     and lower(btrim(sa.permissions->>'staff_name')) <> lower(btrim(coalesce(sa.staff_name,sa.name,'')))
    then true else false end as permission_name_metadata_mismatch,
  case
    when sa.active=true and coalesce(sa.can_login,true)=true and (
      (sa.is_active is not null and sa.active is distinct from sa.is_active)
      or lower(coalesce(btrim(sa.staff_name), btrim(sa.name), '')) in ('غير محدد','غير معروف','unknown','undefined','null','user')
      or (sa.staff_id is not null and btrim(sa.staff_id) <> '' and not exists (select 1 from public.staff s where s.id::text = sa.staff_id))
      or coalesce(ad.active_account_count,0) > 1
      or (jsonb_typeof(sa.permissions)='object' and nullif(btrim(sa.permissions->>'role'),'') is not null and lower(btrim(sa.permissions->>'role')) <> lower(btrim(coalesce(sa.role,''))))
      or (jsonb_typeof(sa.permissions)='object' and nullif(btrim(sa.permissions->>'branch'),'') is not null and lower(replace(btrim(sa.permissions->>'branch'),'الكل','كل الفروع')) <> lower(replace(btrim(coalesce(sa.branch,'')),'الكل','كل الفروع')))
      or (jsonb_typeof(sa.permissions)='object' and nullif(btrim(sa.permissions->>'staff_name'),'') is not null and lower(btrim(sa.permissions->>'staff_name')) <> lower(btrim(coalesce(sa.staff_name,sa.name,''))))
    ) then true else false end as needs_review
from public.staff_accounts sa
left join active_dupes ad on ad.staff_id = sa.staff_id;
