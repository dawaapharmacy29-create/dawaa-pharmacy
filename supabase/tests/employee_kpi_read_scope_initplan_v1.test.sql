-- 20261015150300_employee_kpi_read_scope_initplan_v1: identical KPI rows for every actor, options and grants
-- kept, the per-row helper gone, and a mutation of the scope rules is detected.
create function pg_temp.assert_kpi_equivalence() returns integer language plpgsql as $$
declare v_actor text; v_new text; v_old text; v_checked integer := 0; v_nonempty integer := 0;
begin
  for v_actor in
    select '' union all select 'c0000000-0000-4000-8000-0000000000aa' union all select id::text from public.staff_accounts
  loop
    perform set_config('test.account_id', v_actor, true);
    set local role anon;
    select coalesce(json_agg(k order by k.staff_id)::text, '[]') into v_new from public.employee_kpi_30d_summary k;
    select coalesce(json_agg(k order by k.staff_id)::text, '[]') into v_old from public.test_old_employee_kpi_30d_summary k;
    reset role;
    if v_new is distinct from v_old then
      raise exception 'employee KPI rows changed for actor [%]: new % old %', v_actor, v_new, v_old;
    end if;
    if v_new <> '[]' then v_nonempty := v_nonempty + 1; end if;
    v_checked := v_checked + 1;
  end loop;
  if v_nonempty < 4 then raise exception 'KPI matrix too weak: % actors saw rows', v_nonempty; end if;
  return v_checked;
end;
$$;

do $$
declare v_checked integer; v text[];
begin
  v_checked := pg_temp.assert_kpi_equivalence();
  if v_checked < 16 then raise exception 'KPI matrix too small: %', v_checked; end if;

  -- Anchor: a branch manager (padded branch) sees active staff of the same trimmed branch only.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  select array_agg(staff_name order by staff_name) into v from public.employee_kpi_30d_summary;
  reset role;
  if v is distinct from array['أ','ب'] then raise exception 'branch manager KPI scope: %', v; end if;
end;
$$;

do $$
declare v_def text := pg_get_viewdef('public.employee_kpi_30d_summary'::regclass);
begin
  if v_def ~ 'dawaa_can_read_staff_kpi\(' then raise exception 'KPI view still calls the per-row helper'; end if;
  if (select reloptions from pg_class where oid = 'public.employee_kpi_30d_summary'::regclass) is distinct from array['security_invoker=true'] then
    raise exception 'KPI view must stay security_invoker';
  end if;
  if not has_table_privilege('anon', 'public.employee_kpi_30d_summary', 'select') then raise exception 'KPI view grant lost'; end if;
  if (select provolatile from pg_proc where oid = 'public.dawaa_staff_kpi_read_scope_v1()'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'public.dawaa_staff_kpi_read_scope_v1()'::regprocedure) then
    raise exception 'KPI scope function must be STABLE SECURITY DEFINER';
  end if;
end;
$$;

-- Mutations (rolled back): dropping the view_team requirement, or letting empty-branch managers through.
do $$
begin
  begin
    create or replace function public.dawaa_staff_kpi_read_scope_v1()
    returns table(read_mode text, branch_scope text) language sql stable security definer set search_path to 'public'
    as $m$ select case when lower(trim(coalesce(sa.role,''))) in ('general_manager','executive_manager','branches_manager') then 'all' else 'branch' end,
                  trim(coalesce(sa.branch,''))
           from public.staff_accounts sa
           where sa.id = public.dawaa_current_staff_account_id_strict() and coalesce(sa.active,false) and coalesce(sa.can_login,false) $m$;
    perform pg_temp.assert_kpi_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation (view_team and role list dropped) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^employee KPI rows changed' then raise; end if;
  end;
  perform pg_temp.assert_kpi_equivalence();
end;
$$;
