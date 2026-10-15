-- 20261015150100_attendance_read_scope_initplan_callers_v1: all five attendance readers return exactly what the
-- previous Production definitions return (or raise the same error) for every actor, no per-row helper remains,
-- and a mutation of the attendance scope is detected.
create function pg_temp.outcome(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'ERROR ' || sqlstate || ': ' || sqlerrm;
end;
$$;

create function pg_temp.assert_attendance_readers_equivalence() returns integer language plpgsql as $$
declare
  v_actor text;
  v_call record;
  v_new text;
  v_old text;
  v_checked integer := 0;
  v_with_rows integer := 0;
begin
  for v_actor in
    select '' union all select 'c0000000-0000-4000-8000-0000000000aa' union all select id::text from public.staff_accounts
  loop
    perform set_config('test.account_id', v_actor, true);
    for v_call in select * from (values
      ('overtime_truth_status_v2', $c$select (%s('2026-10-01','2026-10-10',null) - 'generated_at')::text$c$),
      ('overtime_truth_status_v2', $c$select (%s('2026-10-01','2026-10-10','فرع الشامي') - 'generated_at')::text$c$),
      ('attendance_review_triage_v1', $c$select (%s('2026-10-01','2026-10-10',null) - 'generated_at')::text$c$),
      ('attendance_policy_shadow_audit_v1', $c$select (%s('2026-10-01','2026-10-10',null) - 'generated_at')::text$c$),
      ('attendance_truth_cycle_v2', $c$select (%s('2026-10-01','2026-10-10',null) - 'generated_at')::text$c$),
      ('attendance_daily_command_v1', $c$select coalesce(json_agg(r order by r.staff_id)::text, '[]') from %s('2026-10-05',null) r$c$)
    ) calls(fn, template) loop
      set local role anon;
      v_new := pg_temp.outcome(format(v_call.template, 'public.' || v_call.fn));
      v_old := pg_temp.outcome(format(v_call.template, 'public.test_old_' || v_call.fn));
      reset role;
      if v_new is distinct from v_old then
        raise exception 'attendance reader % changed for actor [%]: new % old %', v_call.fn, v_actor, v_new, v_old;
      end if;
      if v_new !~ '^ERROR' and v_new ~ '"staff_id"' then v_with_rows := v_with_rows + 1; end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;
  if v_with_rows < 20 then raise exception 'attendance matrix too weak: % results carried staff rows', v_with_rows; end if;
  return v_checked;
end;
$$;

do $$
declare v_checked integer;
begin
  v_checked := pg_temp.assert_attendance_readers_equivalence();
  if v_checked < 14 * 6 then raise exception 'attendance matrix too small: %', v_checked; end if;
end;
$$;

-- No reader calls the per-row helper any more; each uses the shared scope once per statement.
do $$
declare v_fn text; v_def text;
begin
  foreach v_fn in array array['attendance_daily_command_v1','attendance_policy_shadow_audit_v1','attendance_review_triage_v1','attendance_truth_cycle_v2','overtime_truth_status_v2'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn;
    if v_def ~ 'dawaa_can_read_staff_attendance_log\(' then raise exception '% still calls the per-row helper', v_fn; end if;
    if v_def !~ 'dawaa_staff_attendance_log_read_scope_v1\(\) attn_scope' then raise exception '% does not use the shared scope', v_fn; end if;
    if not (select prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname = v_fn) then
      raise exception '% must stay SECURITY DEFINER', v_fn;
    end if;
  end loop;
end;
$$;

-- Mutation (rolled back): a looser attendance scope (shift supervisors treated as global) must be detected.
do $$
begin
  begin
    create or replace function public.dawaa_staff_attendance_log_read_scope_v1()
    returns table(read_mode text, subject_id uuid, branch_scope text) language sql stable security definer set search_path to 'public'
    as $m$ select case when lower(trim(sa.role)) in ('general_manager','executive_manager','branches_manager','admin','shift_supervisor_morning','branch_manager')
                       then 'all' else 'scoped' end,
                  public.dawaa_current_attendance_subject_id(), null::text
           from public.staff_accounts sa
           where sa.id = public.dawaa_current_staff_account_id_strict() and sa.active = true and sa.can_login = true $m$;
    perform pg_temp.assert_attendance_readers_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation (looser attendance scope) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^attendance reader ' then raise; end if;
  end;
  perform pg_temp.assert_attendance_readers_equivalence();
end;
$$;
