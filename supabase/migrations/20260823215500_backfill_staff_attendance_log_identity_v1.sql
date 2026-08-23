with active_accounts as (
  select
    sa.id as account_id,
    sa.name,
    sa.branch,
    case
      when nullif(trim(sa.staff_id),'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then sa.staff_id::uuid
      else sa.id
    end as subject_id,
    regexp_replace(lower(sa.name), '[^[:alnum:]ء-ي]+', '', 'g') as name_key
  from public.staff_accounts sa
  where sa.active=true and sa.can_login=true
), unique_name_branch as (
  select
    name_key,
    branch,
    min(account_id::text)::uuid as account_id,
    min(subject_id::text)::uuid as subject_id,
    count(*) as candidate_count
  from active_accounts
  group by name_key, branch
), direct_account_matches as (
  select l.id, a.account_id, a.subject_id
  from public.staff_attendance_logs l
  join active_accounts a on l.staff_id = a.account_id
  where l.staff_id is distinct from a.subject_id
), missing_matches as (
  select l.id, u.account_id, u.subject_id
  from public.staff_attendance_logs l
  join unique_name_branch u
    on u.candidate_count=1
   and u.name_key = regexp_replace(lower(l.staff_name), '[^[:alnum:]ء-ي]+', '', 'g')
   and coalesce(u.branch,'') = coalesce(l.branch_name,'')
  where l.staff_id is null
), resolved as (
  select * from direct_account_matches
  union all
  select * from missing_matches
)
update public.staff_attendance_logs l
set staff_id = r.subject_id,
    created_by = r.account_id
from resolved r
where l.id = r.id;

comment on view public.staff_attendance_identity_health_v1 is
  'Attendance identity health after deterministic backfill. Historical rows are linked only through direct account-id matches or unique active name+branch matches.';
