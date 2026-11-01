-- Violations carry the staff row id too: the monthly evaluation scores staff.id, violations are
-- recorded on staff_accounts.id, so without it no recorded violation reached the compliance factor.
-- Same filters and scope as before; only the staff_id column is added (at the end).

drop function if exists public.list_staff_violations_v1(date, date, text);

create function public.list_staff_violations_v1(p_from date, p_to date, p_branch text default null)
returns table (
  id uuid, staff_account_id uuid, staff_name text, branch_key text, category text, points smallint,
  occurred_on date, note text, recorded_by_name text, recorded_at timestamptz, withdrawn boolean, withdraw_reason text,
  staff_id text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_scope text := public.staff_violation_actor_scope_v1();
  v_branch text := public.dawaa_customer_request_branch_key(p_branch);
begin
  if v_actor is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  return query
    select v.id, v.staff_account_id, sa.name, v.branch_key, v.category, v.points, v.occurred_on, v.note,
           rb.name, v.recorded_at, v.withdrawn_at is not null, v.withdraw_reason, nullif(btrim(sa.staff_id), '')
    from public.staff_compliance_violations v
    join public.staff_accounts sa on sa.id = v.staff_account_id
    left join public.staff_accounts rb on rb.id = v.recorded_by
    where v.occurred_on between p_from and p_to
      and (v_branch is null or v.branch_key = v_branch)
      and (v_scope = 'ALL' or (v_scope <> 'NONE' and v.branch_key = v_scope) or v.staff_account_id = v_actor)
    order by v.occurred_on desc, v.recorded_at desc;
end;
$function$;

revoke all on function public.list_staff_violations_v1(date, date, text) from public;
grant execute on function public.list_staff_violations_v1(date, date, text) to anon, authenticated;
