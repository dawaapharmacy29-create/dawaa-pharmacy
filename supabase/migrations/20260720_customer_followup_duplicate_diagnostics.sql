-- Diagnostic-only view for open follow-up duplicates.
-- No rows are deleted or modified by this migration.

create or replace view public.customer_followup_open_duplicate_diagnostics
with (security_invoker = true)
as
with open_rows as (
  select
    id,
    customer_id,
    nullif(trim(customer_code), '') as customer_code,
    regexp_replace(coalesce(customer_phone, phone, ''), '\D', '', 'g') as phone_digits,
    nullif(trim(branch), '') as branch,
    coalesce(request_type, followup_type, category, '') as case_type,
    created_at,
    duplicate_of,
    is_duplicate,
    completed_at,
    cancelled_at,
    archived_at,
    is_hidden
  from public.daily_followups
  where completed_at is null
    and cancelled_at is null
    and archived_at is null
    and coalesce(is_hidden, false) = false
), keyed as (
  select
    *,
    case
      when customer_id is not null and trim(customer_id) <> '' then 'id:' || trim(customer_id)
      when customer_code is not null then 'code:' || customer_code
      when phone_digits ~ '^(20)?01[0125][0-9]{8}$' then
        'phone:' || case when phone_digits like '20%' then '0' || substring(phone_digits from 3) else phone_digits end
      else null
    end as customer_identity
  from open_rows
)
select
  customer_identity,
  branch,
  case_type,
  count(*) as open_rows_count,
  array_agg(id order by created_at desc) as followup_ids,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at
from keyed
where customer_identity is not null
  and duplicate_of is null
group by customer_identity, branch, case_type
having count(*) > 1;

revoke all on public.customer_followup_open_duplicate_diagnostics from public;
grant select on public.customer_followup_open_duplicate_diagnostics to authenticated;
