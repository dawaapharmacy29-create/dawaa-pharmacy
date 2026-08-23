create or replace view public.staff_account_assignment_health_v1 as
select
  sa.id as account_id,
  sa.staff_id,
  coalesce(nullif(trim(sa.staff_name),''),nullif(trim(sa.name),''),sa.username) as account_name,
  sa.username,
  sa.role as account_role,
  sa.branch as account_branch,
  sa.job_title as account_job_title,
  sa.active as account_active,
  sa.can_login,
  sa.is_active as legacy_is_active,
  s.name as staff_name,
  s.role as staff_role,
  s.branch as staff_branch,
  s.active as staff_active,
  case
    when s.id is null then false
    when lower(trim(coalesce(sa.branch,''))) <> lower(trim(coalesce(s.branch,''))) then true
    else false
  end as branch_mismatch,
  case
    when s.id is null then false
    when coalesce(sa.active,false) = true and coalesce(sa.can_login,false) = true and coalesce(s.active,false) = false then true
    else false
  end as active_account_inactive_staff,
  case
    when coalesce(sa.active,false) = true and coalesce(sa.can_login,false) = true
      and (
        (s.id is not null and lower(trim(coalesce(sa.branch,''))) <> lower(trim(coalesce(s.branch,''))))
        or (s.id is not null and coalesce(s.active,false) = false)
      )
    then true else false
  end as operational_issue
from public.staff_accounts sa
left join public.staff s on s.id::text = sa.staff_id;

create or replace view public.staff_account_permission_override_health_v1 as
with entries as (
  select
    sa.id as account_id,
    coalesce(nullif(trim(sa.staff_name),''),nullif(trim(sa.name),''),sa.username) as account_name,
    sa.username,
    sa.role,
    sa.branch,
    sa.active,
    sa.can_login,
    e.key as permission_key,
    case when jsonb_typeof(e.value)='boolean' then (e.value::text)::boolean else false end as allowed,
    jsonb_typeof(e.value) as value_type
  from public.staff_accounts sa
  cross join lateral jsonb_each(coalesce(sa.permissions,'{}'::jsonb)) e
), classified as (
  select *,
    case
      when permission_key like 'manage_%'
        or permission_key like 'approve_%'
        or permission_key like 'delete_%'
        or permission_key in ('import_customers','import_sales_invoices','create_reward','create_deduction','edit_points_transaction')
      then true else false
    end as sensitive_permission
  from entries
)
select
  account_id,
  account_name,
  username,
  role,
  branch,
  active,
  can_login,
  permission_key,
  allowed,
  value_type,
  sensitive_permission,
  case
    when allowed = true
      and sensitive_permission = true
      and role in ('assistant','cleaning_supervisor','delivery','pharmacist','customer_service')
    then true else false
  end as restricted_role_sensitive_grant,
  case
    when coalesce(active,false)=true and coalesce(can_login,false)=true
      and allowed=true
      and sensitive_permission=true
      and role in ('assistant','cleaning_supervisor','delivery','pharmacist','customer_service')
    then true else false
  end as operational_review
from classified;
