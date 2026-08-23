create or replace view public.staff_account_permission_health_v1 as
with active_dupes as (
  select staff_id, count(*) filter (where active = true and coalesce(can_login,true) = true) as active_account_count
  from public.staff_accounts
  where staff_id is not null and btrim(staff_id) <> ''
  group by staff_id
), base as (
  select
    sa.*,
    coalesce(ad.active_account_count,0) as active_account_count_for_staff,
    case
      when sa.staff_id is null or btrim(sa.staff_id) = '' then false
      when sa.role = 'general_manager' and lower(btrim(sa.staff_id)) = 'admin' then false
      when exists (select 1 from public.staff s where s.id::text = sa.staff_id) then false
      when exists (select 1 from public.delivery_staff ds where ds.id::text = sa.staff_id) then false
      else true
    end as orphan_staff_link_calc
  from public.staff_accounts sa
  left join active_dupes ad on ad.staff_id = sa.staff_id
)
select
  b.id as account_id,
  b.staff_id,
  coalesce(nullif(btrim(b.staff_name),''), nullif(btrim(b.name),''), b.username) as staff_name,
  b.username,
  b.role,
  b.staff_role,
  b.branch,
  b.active,
  b.is_active,
  b.can_login,
  b.role_scope,
  b.branch_scope,
  b.active_account_count_for_staff,
  case when b.is_active is not null and b.active is distinct from b.is_active then true else false end as active_state_mismatch,
  case when lower(coalesce(btrim(b.staff_name), btrim(b.name), '')) in ('غير محدد','غير معروف','unknown','undefined','null','user') then true else false end as placeholder_identity,
  b.orphan_staff_link_calc as orphan_staff_link,
  case when b.active_account_count_for_staff > 1 then true else false end as duplicate_active_staff_account,
  case
    when jsonb_typeof(b.permissions)='object'
     and nullif(btrim(b.permissions->>'role'),'') is not null
     and lower(btrim(b.permissions->>'role')) <> lower(btrim(coalesce(b.role,'')))
    then true else false end as permission_role_metadata_mismatch,
  case
    when jsonb_typeof(b.permissions)='object'
     and nullif(btrim(b.permissions->>'branch'),'') is not null
     and lower(replace(btrim(b.permissions->>'branch'),'الكل','كل الفروع')) <> lower(replace(btrim(coalesce(b.branch,'')),'الكل','كل الفروع'))
    then true else false end as permission_branch_metadata_mismatch,
  case
    when jsonb_typeof(b.permissions)='object'
     and nullif(btrim(b.permissions->>'staff_name'),'') is not null
     and lower(btrim(b.permissions->>'staff_name')) <> lower(btrim(coalesce(b.staff_name,b.name,'')))
    then true else false end as permission_name_metadata_mismatch,
  case
    when b.active=true and coalesce(b.can_login,true)=true and (
      (b.is_active is not null and b.active is distinct from b.is_active)
      or lower(coalesce(btrim(b.staff_name), btrim(b.name), '')) in ('غير محدد','غير معروف','unknown','undefined','null','user')
      or b.orphan_staff_link_calc
      or b.active_account_count_for_staff > 1
      or (jsonb_typeof(b.permissions)='object' and nullif(btrim(b.permissions->>'role'),'') is not null and lower(btrim(b.permissions->>'role')) <> lower(btrim(coalesce(b.role,''))))
      or (jsonb_typeof(b.permissions)='object' and nullif(btrim(b.permissions->>'branch'),'') is not null and lower(replace(btrim(b.permissions->>'branch'),'الكل','كل الفروع')) <> lower(replace(btrim(coalesce(b.branch,'')),'الكل','كل الفروع')))
      or (jsonb_typeof(b.permissions)='object' and nullif(btrim(b.permissions->>'staff_name'),'') is not null and lower(btrim(b.permissions->>'staff_name')) <> lower(btrim(coalesce(b.staff_name,b.name,''))))
    ) then true else false end as needs_review
from base b;
