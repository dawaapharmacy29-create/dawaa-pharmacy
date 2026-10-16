-- 20261016150000_overtime_approval_freshness_v1: approvals must match current attendance truth; policy_version changes
-- invalidate; stale approvals block every finalization route; no existing row changes.

-- 1. Objects, grants, and untouched history.
do $$
begin
  if to_regprocedure('public.dawaa_stale_approved_overtime_count_v1(uuid,date,date)') is null then
    raise exception 'stale count function missing';
  end if;
  if has_function_privilege('anon', 'public.dawaa_stale_approved_overtime_count_v1(uuid,date,date)', 'execute')
     or has_function_privilege('authenticated', 'public.dawaa_stale_approved_overtime_count_v1(uuid,date,date)', 'execute')
     or has_function_privilege('anon', 'public.dawaa_overtime_approval_freshness_guard_v1()', 'execute')
     or has_function_privilege('anon', 'public.dawaa_block_stale_overtime_payroll_finalization_v1()', 'execute') then
    raise exception 'an internal overtime freshness function is executable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.dawaa_stale_approved_overtime_count_v1(uuid,date,date)', 'execute') then
    raise exception 'service_role cannot count stale overtime';
  end if;
  if (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_hr_invalidate_overtime_on_attendance_change_v1')
     not like '%time_off_request_id, policy_version, id, staff_id, attendance_date ON public.attendance_daily_summary%' then
    raise exception 'invalidation trigger does not watch every fingerprint input';
  end if;
  if (select md5(string_agg(o::text, '|' order by o.id)) from public.staff_overtime_approvals o)
     is distinct from (select rows_md5 from public.test_before_rows) then
    raise exception 'the migration changed existing overtime rows';
  end if;
  -- the stale set is exactly the reviewed categories: diverged (A 09-26), no fingerprint linked/unlinked (B), boundary (D 09-25)
  if public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000a1', '2026-09-26', '2026-10-25') <> 1
     or public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000b1', '2026-09-26', '2026-10-25') <> 2
     or public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000d1', '2026-09-26', '2026-10-25') <> 0
     or public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000d1', '2026-08-26', '2026-09-25') <> 1
     or public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000f1', '2026-09-26', '2026-10-25') <> 0 then
    raise exception 'stale count does not match the reviewed predicate';
  end if;
  -- the Production trigger did not invalidate on a policy_version change (the gap this migration closes)
  if (select status_after_policy_change from public.test_gap_before) <> 'approved'
     or (select stale_count_after_policy_change from public.test_gap_before) <> 1 then
    raise exception 'fixture did not reproduce the policy_version invalidation gap';
  end if;
end;
$$;

-- 2. Approvals must carry the current fingerprint of the approved attendance day of the same staff and date.
do $$
declare v_case text;
begin
  foreach v_case in array array[
    'update public.staff_overtime_approvals set status = ''approved'', source_resolution_fingerprint = null where id = ''00000000-0000-4000-8000-00000000e002''',
    'update public.staff_overtime_approvals set status = ''approved'', source_resolution_fingerprint = ''not-the-current-truth'' where id = ''00000000-0000-4000-8000-00000000e002''',
    'update public.staff_overtime_approvals set status = ''approved'', source_resolution_id = null where id = ''00000000-0000-4000-8000-00000000e002''',
    'update public.staff_overtime_approvals set status = ''approved'', source_resolution_id = ''00000000-0000-4000-8000-0000000b1003'', source_resolution_fingerprint = public.attendance_resolution_fingerprint_v2(''00000000-0000-4000-8000-0000000b1003'') where id = ''00000000-0000-4000-8000-00000000e002''',
    'insert into public.staff_overtime_approvals (staff_id, attendance_date, overtime_hours, status) values (''00000000-0000-4000-8000-0000000000f1'', ''2026-10-06'', 1, ''approved'')',
    'update public.staff_overtime_approvals set overtime_amount = 99 where id = ''00000000-0000-4000-8000-00000000e003''',
    'update public.staff_overtime_approvals set overtime_hours = 3 where id = ''00000000-0000-4000-8000-00000000e926'''] loop
    begin
      execute v_case;
      raise exception using errcode = 'P0901', message = 'accepted a stale approval write: ' || v_case;
    exception
      when sqlstate 'P0901' then raise;
      when sqlstate '55000' then
        if sqlerrm not like 'overtime_approval_requires_%' then raise; end if;
    end;
  end loop;

  -- the approved truth turned non-approved: approving against it is refused
  begin
    update public.attendance_daily_summary set status = 'pending_review' where id = '00000000-0000-4000-8000-0000000a1002';
    update public.staff_overtime_approvals set status = 'approved' where id = '00000000-0000-4000-8000-00000000e002';
    raise exception using errcode = 'P0901', message = 'approved against a non-approved attendance day';
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate '55000' then null;
  end;
end;
$$;

-- 3. Fresh approvals still work, and manager re-review restores a stale approval (both rolled back).
do $$
begin
  begin
    update public.staff_overtime_approvals
    set status = 'approved', decided_by_name = 'test', decided_at = now()
    where id = '00000000-0000-4000-8000-00000000e002';
    if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e002') <> 'approved' then
      raise exception 'a fresh approval was not stored';
    end if;
    insert into public.staff_overtime_approvals (staff_id, attendance_date, overtime_hours, overtime_amount, status, source_resolution_id, source_resolution_fingerprint)
    values ('00000000-0000-4000-8000-0000000000f1', '2026-10-06', 1, 10, 'pending', null, null);

    -- re-review of the diverged approval: back to pending, then approved against the current truth
    update public.staff_overtime_approvals set status = 'pending' where id = '00000000-0000-4000-8000-00000000e926';
    update public.staff_overtime_approvals
    set status = 'approved', source_resolution_fingerprint = public.attendance_resolution_fingerprint_v2(source_resolution_id)
    where id = '00000000-0000-4000-8000-00000000e926';
    if public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000a1', '2026-09-26', '2026-10-25') <> 0 then
      raise exception 're-review did not restore validity';
    end if;
    insert into public.payroll_finalized_snapshots_v2 (snapshot_id, staff_id, staff_username, staff_name, month_cycle, snapshot_fingerprint, payload, finalized_by, finalized_by_name)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'a', 'A', '2026-10', 'fp', '{}', gen_random_uuid(), 'test');

    -- notes and evidence on an existing stale approval can still be edited (history is not forced to change)
    update public.staff_overtime_approvals set decision_note = 'reviewed later' where id = '00000000-0000-4000-8000-00000000e003';
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then null;
  end;
end;
$$;

-- 4a. Every fingerprint input, and each of the two schedule-window extras, invalidates the approval on its day when it
-- changes; fingerprint inputs also change the fingerprint, the extras do not (each case rolled back).
do $$
declare v_case record; v_fp_before text; v_fp_changed boolean;
begin
  v_fp_before := public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000a1001');
  for v_case in select * from (values
      ('status', 'status = ''pending_review''', true),
      ('resolution_status', 'resolution_status = ''late''', true),
      ('candidate_hours', 'candidate_hours = candidate_hours + 1', true),
      ('payroll_eligible_hours', 'payroll_eligible_hours = payroll_eligible_hours + 1', true),
      ('schedule_id', 'schedule_id = gen_random_uuid()', true),
      ('first_in', 'first_in = first_in - interval ''5 minutes''', true),
      ('last_out', 'last_out = last_out + interval ''5 minutes''', true),
      ('late_minutes', 'late_minutes = 5', true),
      ('early_leave_minutes', 'early_leave_minutes = 5', true),
      ('time_off_request_id', 'time_off_request_id = gen_random_uuid()', true),
      ('policy_version', 'policy_version = ''attendance_policy_v3''', true),
      ('id', 'id = ''00000000-0000-4000-8000-0000000a9999''', true),
      ('staff_id', 'staff_id = ''00000000-0000-4000-8000-0000000000f1''', true),
      ('attendance_date', 'attendance_date = ''2026-10-10''', true),
      ('scheduled_start_at (extra)', 'scheduled_start_at = scheduled_start_at - interval ''30 minutes''', false),
      ('scheduled_end_at (extra)', 'scheduled_end_at = scheduled_end_at + interval ''30 minutes''', false)
    ) x(input, set_clause, fingerprint_input) loop
    begin
      execute 'update public.attendance_daily_summary set ' || v_case.set_clause || ' where id = ''00000000-0000-4000-8000-0000000a1001''';
      v_fp_changed := coalesce(public.attendance_resolution_fingerprint_v2(
          case when v_case.input = 'id' then '00000000-0000-4000-8000-0000000a9999'::uuid else '00000000-0000-4000-8000-0000000a1001'::uuid end), '')
        is distinct from v_fp_before;
      if v_fp_changed is distinct from v_case.fingerprint_input then
        raise exception 'input % fingerprint membership is %, expected %', v_case.input, v_fp_changed, v_case.fingerprint_input;
      end if;
      if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e001') <> 'pending'
         or (select source_resolution_fingerprint from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e001') is not null then
        raise exception 'changing % did not invalidate the approval', v_case.input;
      end if;
      if exists (select 1 from public.employee_transactions where staff_id = '00000000-0000-4000-8000-0000000000a1' and source = 'attendance_overtime_v2')
         or not exists (select 1 from public.employee_transactions where staff_id = '00000000-0000-4000-8000-0000000000a1' and source = 'conversation_evaluation') then
        raise exception 'invalidation side effects for % differ from Production', v_case.input;
      end if;
      raise exception using errcode = 'P0902', message = 'rollback';
    exception when sqlstate 'P0902' then null;
    end;
  end loop;
end;
$$;

-- 4b. Metadata that is neither a fingerprint input nor an overtime window does not invalidate (each case rolled back).
do $$
declare v_set text; v_fp_before text;
begin
  v_fp_before := public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000a1001');
  foreach v_set in array array[
    'branch = ''فرع الشامي''', 'total_hours = total_hours + 1', 'missing_punch = true', 'source = ''attendance_resolution_v2_dirty_reconcile''',
    'resolution_version = 3', 'resolution_snapshot = ''{"reconciled": true}''', 'approved_at = now()', 'approved_by = ''system:auto-attendance-v2''',
    'approved_by_name = ''النظام التلقائي للحضور''', 'approval_note = ''note''', 'resolution_origin = ''system''', 'review_required = true',
    'resolved_at = now()', 'sync_complete_through = now()', 'updated_at = now()', 'created_at = now()'] loop
    begin
      execute 'update public.attendance_daily_summary set ' || v_set || ' where id = ''00000000-0000-4000-8000-0000000a1001''';
      if public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000a1001') is distinct from v_fp_before then
        raise exception 'metadata % changed the fingerprint', v_set;
      end if;
      if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e001') <> 'approved' then
        raise exception 'metadata change % falsely invalidated a fresh approval', v_set;
      end if;
      raise exception using errcode = 'P0902', message = 'rollback';
    exception when sqlstate 'P0902' then null;
    end;
  end loop;
end;
$$;

-- 4c. Dirty-day reconciler rewrite (same SET list as dawaa_reconcile_attendance_dirty_day_v1): a policy_version-only
-- difference invalidates explicitly instead of leaving a silently stale approval; an identical-truth rewrite does not
-- invalidate; a repeated change does not invalidate twice (rolled back).
do $$
declare v_stale_before integer;
begin
  v_stale_before := public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000a1', '2026-09-26', '2026-10-25');
  begin
    -- identical truth, every column rewritten as the reconciler does
    update public.attendance_daily_summary set
      branch = branch, first_in = first_in, last_out = last_out, total_hours = candidate_hours, late_minutes = late_minutes,
      early_leave_minutes = early_leave_minutes, missing_punch = false, status = 'approved',
      source = 'attendance_resolution_v2_dirty_reconcile', schedule_id = schedule_id, scheduled_start_at = scheduled_start_at,
      scheduled_end_at = scheduled_end_at, candidate_hours = candidate_hours, payroll_eligible_hours = payroll_eligible_hours,
      resolution_status = resolution_status, resolution_version = 2, resolution_snapshot = '{"auto_reconciled_from_stale_approved": true}',
      approved_at = now(), approved_by = 'system:auto-attendance-v2', approved_by_name = 'النظام التلقائي للحضور', approval_note = null,
      updated_at = now(), resolution_origin = 'system', review_required = false, resolved_at = now(),
      time_off_request_id = time_off_request_id, policy_version = policy_version, sync_complete_through = now()
    where id = '00000000-0000-4000-8000-0000000a1001';
    if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e001') <> 'approved' then
      raise exception 'an identical-truth reconcile falsely invalidated the approval';
    end if;
    -- policy_version-only difference
    update public.attendance_daily_summary set
      status = 'approved', source = 'attendance_resolution_v2_dirty_reconcile', policy_version = 'attendance_policy_v3',
      updated_at = now(), resolution_snapshot = '{"auto_reconciled_from_stale_approved": true}'
    where id = '00000000-0000-4000-8000-0000000a1001';
    if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000e001') <> 'pending' then
      raise exception 'a reconciler policy_version change left the approval approved';
    end if;
    if public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000a1', '2026-09-26', '2026-10-25') > v_stale_before then
      raise exception 'the reconciler created a silently stale approval';
    end if;
    -- repeated change: nothing approved is left to invalidate, the conversation points stay
    update public.attendance_daily_summary set policy_version = 'attendance_policy_v4' where id = '00000000-0000-4000-8000-0000000a1001';
    if (select count(*) from public.staff_overtime_approvals where staff_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending') <> 2
       or not exists (select 1 from public.employee_transactions where source = 'conversation_evaluation') then
      raise exception 'a repeated change invalidated twice or removed unrelated points';
    end if;
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then null;
  end;
end;
$$;

-- 4d. Fresh approvals stay approved and payroll-eligible.
do $$
begin
  if (select count(*) from public.staff_overtime_approvals where id in ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d926', '00000000-0000-4000-8000-00000000f005') and status = 'approved') <> 3
     or public.dawaa_stale_approved_overtime_count_v1('00000000-0000-4000-8000-0000000000f1', '2026-09-26', '2026-10-25') <> 0 then
    raise exception 'a fresh approval is no longer valid';
  end if;
end;
$$;

-- 5. Finalization refuses stale approved overtime on every route; cycle boundary 26 -> 25 respected.
do $$
declare v_case record;
begin
  for v_case in select * from (values
      ('00000000-0000-4000-8000-0000000000a1'::uuid, '2026-10', null::date, null::date, false),
      ('00000000-0000-4000-8000-0000000000b1'::uuid, '2026-10', null, null, false),
      ('00000000-0000-4000-8000-0000000000d1'::uuid, '2026-09', null, null, false),
      ('00000000-0000-4000-8000-0000000000d1'::uuid, '2026-09', '2026-08-26'::date, '2026-09-25'::date, false),
      ('00000000-0000-4000-8000-0000000000d1'::uuid, '2026-10', null, null, true),
      ('00000000-0000-4000-8000-0000000000f1'::uuid, '2026-10', '2026-09-26'::date, '2026-10-25'::date, true)
    ) x(staff_id, month_cycle, cycle_start, cycle_end, allowed) loop
    begin
      insert into public.payroll_finalized_snapshots_v2 (snapshot_id, staff_id, staff_username, staff_name, month_cycle, cycle_start, cycle_end, snapshot_fingerprint, payload, finalized_by, finalized_by_name)
      values (gen_random_uuid(), v_case.staff_id, 'u', 'n', v_case.month_cycle, v_case.cycle_start, v_case.cycle_end, 'fp', '{}', gen_random_uuid(), 'test');
      if not v_case.allowed then
        raise exception using errcode = 'P0901', message = format('finalized %s %s with stale approved overtime', v_case.staff_id, v_case.month_cycle);
      end if;
      raise exception using errcode = 'P0902', message = 'rollback';
    exception
      when sqlstate 'P0901' then raise;
      when sqlstate 'P0902' then null;
      when sqlstate '55000' then
        if v_case.allowed or sqlerrm not like 'stale_approved_overtime_blocks_payroll_finalization: %' then raise; end if;
    end;
  end loop;
end;
$$;

-- 6. No duplicate overtime for a staff day; no row changed by the test itself.
do $$
begin
  begin
    insert into public.staff_overtime_approvals (staff_id, attendance_date, overtime_hours, status)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-10-01', 1, 'pending');
    raise exception using errcode = 'P0901', message = 'duplicate overtime for one staff day accepted';
  exception
    when sqlstate 'P0901' then raise;
    when unique_violation then null;
  end;
  if (select md5(string_agg(o::text, '|' order by o.id)) from public.staff_overtime_approvals o)
     is distinct from (select rows_md5 from public.test_before_rows) then
    raise exception 'overtime rows changed during the test';
  end if;
end;
$$;
