-- Lightweight finalized payroll history read model V3.
-- Avoid returning the full frozen employee statement payload for history lists.

create or replace function public.list_payroll_finalized_snapshot_history_v3(
  p_staff_id uuid default null,
  p_month_cycle text default null,
  p_limit integer default 100
)
returns table(
  id uuid,
  snapshot_id uuid,
  staff_id uuid,
  staff_username text,
  staff_name text,
  branch text,
  month_cycle text,
  cycle_start date,
  cycle_end date,
  snapshot_fingerprint text,
  net_salary numeric,
  deductions_total numeric,
  finalized_at timestamptz,
  finalized_by_name text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_finalized_payroll_history' using errcode='42501';
  end if;

  return query
  select
    f.id,
    f.snapshot_id,
    f.staff_id,
    f.staff_username,
    f.staff_name,
    f.branch,
    f.month_cycle,
    f.cycle_start,
    f.cycle_end,
    f.snapshot_fingerprint,
    coalesce(
      nullif(f.payload->'financial_composition'->>'display_net_salary','')::numeric,
      nullif(f.payload->'financial_composition'->>'preview_net_salary','')::numeric,
      0
    ) as net_salary,
    coalesce(
      nullif(f.payload->'financial_composition'->'adjustments'->>'deductions_total','')::numeric,
      0
    ) as deductions_total,
    f.finalized_at,
    f.finalized_by_name
  from public.payroll_finalized_snapshots_v2 f
  where (p_staff_id is null or f.staff_id=p_staff_id)
    and (p_month_cycle is null or trim(p_month_cycle)='' or f.month_cycle=p_month_cycle)
    and public.dawaa_can_manage_payroll_staff_v1(f.staff_username)
  order by f.finalized_at desc
  limit greatest(1,least(coalesce(p_limit,100),300));
end;
$function$;

revoke execute on function public.list_payroll_finalized_snapshot_history_v3(uuid,text,integer)
  from public,anon;
grant execute on function public.list_payroll_finalized_snapshot_history_v3(uuid,text,integer)
  to authenticated,service_role;

comment on function public.list_payroll_finalized_snapshot_history_v3(uuid,text,integer)
  is 'Canonical lightweight payroll history reader. Full frozen statement payload is fetched only on demand.';
