-- 20261016145000_overtime_review_operational_closure_v1 (+ 20261016150000): in-app overtime decisions, stale approval
-- review with four manager decisions, and the readiness blocker, all inside the payroll scope; no row changes by itself.
create or replace function public.test_expect_error(p_actor uuid, p_sql text, p_errcode text, p_message_like text) returns void
language plpgsql as $$
begin
  update public.test_actor set account_id = p_actor;
  begin
    set local role anon;
    execute p_sql;
    reset role;
    raise exception using errcode = 'P0901', message = 'accepted: ' || p_sql;
  exception
    when sqlstate 'P0901' then reset role; raise;
    when others then
      reset role;
      if sqlstate <> p_errcode or sqlerrm not like p_message_like then
        raise exception 'expected % %, got % % for %', p_errcode, p_message_like, sqlstate, sqlerrm, p_sql;
      end if;
  end;
end;
$$;

-- 1. Grants and untouched history.
do $$
begin
  if not has_function_privilege('anon', 'public.decide_overtime_approval_v3(uuid,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.list_stale_overtime_approvals_v1(text,text)', 'execute')
     or not has_function_privilege('anon', 'public.review_stale_overtime_approval_v1(uuid,text,text,integer,numeric,numeric)', 'execute')
     or not has_function_privilege('anon', 'public.payroll_finalization_gate_current_v1(uuid,text)', 'execute') then
    raise exception 'the app (anon + verified session) cannot reach the overtime decision path';
  end if;
  if has_function_privilege('anon', 'public.dawaa_can_manage_payroll_staff_id_v1(uuid)', 'execute') then
    raise exception 'the internal payroll scope helper became client-callable';
  end if;
  if md5(btrim(regexp_replace(pg_get_functiondef('public.decide_overtime_approval_v3(uuid,text,text)'::regprocedure), '\s+', ' ', 'g')))
     <> '8c739c78aa528c4d704951df5dc19342' then
    raise exception 'decide_overtime_approval_v3 definition changed';
  end if;
  if (select md5(string_agg(o::text, '|' order by o.id)) from public.staff_overtime_approvals o)
     is distinct from (select rows_md5 from public.test_before_rows) then
    raise exception 'the migrations changed existing overtime rows';
  end if;
end;
$$;

-- 2. Authorization: no session, no permission, other branch.
do $$
begin
  perform public.test_expect_error(null, 'select * from public.list_stale_overtime_approvals_v1(''2026-10'')', '42501', 'not_authorized_for_overtime_review');
  perform public.test_expect_error(null, 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''confirm'', ''n'')', '42501', 'not_authorized_for_overtime_review');
  perform public.test_expect_error(null, 'select public.decide_overtime_approval_v3(''00000000-0000-4000-8000-00000000a002'', ''approved'', null)', '42501', 'not_authorized_for_overtime_decision');
  perform public.test_expect_error(null, 'select public.payroll_finalization_gate_current_v1(''00000000-0000-4000-8000-0000000000a1'', ''2026-10'')', '42501', 'not_authorized_for_payroll_finalization_current');
  -- pharmacist without manage_payroll
  perform public.test_expect_error('00000000-0000-4000-8000-000000000004', 'select * from public.list_stale_overtime_approvals_v1(''2026-10'')', '42501', 'not_authorized_for_overtime_review');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000004', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''reject'', ''n'')', '42501', 'not_authorized_for_overtime_review');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000004', 'select public.decide_overtime_approval_v3(''00000000-0000-4000-8000-00000000a002'', ''approved'', null)', '42501', 'not_authorized_for_overtime_decision');
  -- branch manager of الشامي on a شكري employee
  perform public.test_expect_error('00000000-0000-4000-8000-000000000003', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''confirm'', ''n'')', '42501', 'not_authorized_for_overtime_staff');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000003', 'select public.decide_overtime_approval_v3(''00000000-0000-4000-8000-00000000a002'', ''approved'', null)', '42501', 'not_authorized_for_overtime_staff');
  -- input validation
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''confirm'', ''  '')', '22023', 'stale_overtime_review_note_required');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''approve'', ''n'')', '22023', 'invalid_stale_overtime_decision');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000f005'', ''confirm'', ''n'')', '55000', 'overtime_not_stale_approved');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a002'', ''reject'', ''n'')', '55000', 'overtime_not_stale_approved');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a006'', ''confirm'', ''n'')', '55000', 'overtime_requires_approved_attendance_truth');
  perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000b003'', ''adjust'', ''n'', 0, 10)', '22023', 'invalid_stale_overtime_adjustment');
  update public.test_actor set account_id = null;
end;
$$;

-- 3. The review queue: exactly the stale approved rows of the cycle, scoped, with explicit missing amount.
do $$
declare v_ids text;
begin
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
  set local role anon;
  select string_agg(id::text || ':' || stale_reason, ',' order by id) into v_ids from public.list_stale_overtime_approvals_v1('2026-10');
  reset role;
  if v_ids is distinct from '00000000-0000-4000-8000-00000000a001:fingerprint_diverged,00000000-0000-4000-8000-00000000a006:linked_attendance_not_approved,00000000-0000-4000-8000-00000000b003:fingerprint_missing,00000000-0000-4000-8000-00000000c004:fingerprint_missing' then
    raise exception 'unexpected review queue for 2026-10: %', v_ids;
  end if;
  set local role anon;
  if (select amount_missing::text || '|' || is_delivery::text || '|' || multiplier::text || '|' || overtime_minutes::text
      from public.list_stale_overtime_approvals_v1('2026-10') where id = '00000000-0000-4000-8000-00000000c004') <> 'true|true|1.5|24'
     or (select recalculate_available from public.list_stale_overtime_approvals_v1('2026-10') where id = '00000000-0000-4000-8000-00000000a001') is not true
     or (select string_agg(id::text, ',') from public.list_stale_overtime_approvals_v1('2026-09')) <> '00000000-0000-4000-8000-00000000b925' then
    reset role;
    raise exception 'review queue fields or cycle boundary are wrong';
  end if;
  reset role;
  -- branch manager of الشامي sees only الشامي rows
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000003';
  set local role anon;
  select string_agg(id::text, ',' order by id) into v_ids from public.list_stale_overtime_approvals_v1('2026-10');
  reset role;
  if v_ids is distinct from '00000000-0000-4000-8000-00000000b003' then
    raise exception 'branch scope leaked: %', v_ids;
  end if;
  update public.test_actor set account_id = null;
end;
$$;

-- 4. Readiness: the payroll gate itself is unchanged; the per-staff counts the payroll panel blocks on come from the
-- review queue (stale count and missing amounts), across both payroll routes and the cycle boundary.
do $$
declare v_count integer; v_missing integer;
begin
  if md5(btrim(regexp_replace(pg_get_functiondef('public.payroll_finalization_gate_current_v1(uuid,text)'::regprocedure), '\s+', ' ', 'g')))
     <> '589d42c7e675cb157de9284ea05d0ace' then
    raise exception 'payroll_finalization_gate_current_v1 changed';
  end if;
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
  set local role anon;
  select count(*), count(*) filter (where amount_missing) into v_count, v_missing
  from public.list_stale_overtime_approvals_v1('2026-10') where staff_id = '00000000-0000-4000-8000-0000000000a1';
  reset role;
  if v_count <> 2 or v_missing <> 0 then raise exception 'standard staff review counts are %/%', v_count, v_missing; end if;
  set local role anon;
  select count(*), count(*) filter (where amount_missing) into v_count, v_missing
  from public.list_stale_overtime_approvals_v1('2026-10') where staff_id = '00000000-0000-4000-8000-0000000000c1';
  reset role;
  if v_count <> 1 or v_missing <> 1 then raise exception 'delivery staff review counts are %/%', v_count, v_missing; end if;
  set local role anon;
  select count(*) into v_count from public.list_stale_overtime_approvals_v1('2026-10') where staff_id = '00000000-0000-4000-8000-0000000000f1';
  reset role;
  if v_count <> 0 then raise exception 'fresh overtime is reported stale'; end if;
  set local role anon;
  select count(*) into v_count from public.list_stale_overtime_approvals_v1('2026-09') where staff_id = '00000000-0000-4000-8000-0000000000b1';
  reset role;
  if v_count <> 1 then raise exception 'cycle boundary 25 -> 26 is wrong in the review queue'; end if;
  update public.test_actor set account_id = null;
end;
$$;

-- 5. The four decisions (rolled back): fresh fingerprints, no invented amount, preserved multiplier, reject out of payroll,
-- recalculation through v3, finalization only after review, no second review.
do $$
declare v_row public.staff_overtime_approvals%rowtype; v_result jsonb;
begin
  begin
    -- finalization is refused while A has stale approvals
    begin
      insert into public.payroll_finalized_snapshots_v2 (snapshot_id, staff_id, staff_username, staff_name, month_cycle, snapshot_fingerprint, payload, finalized_by, finalized_by_name)
      values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'a', 'A', '2026-10', 'fp', '{}', gen_random_uuid(), 't');
      raise exception using errcode = 'P0901', message = 'finalized with stale overtime';
    exception
      when sqlstate 'P0901' then raise;
      when sqlstate '55000' then null;
    end;

    update public.test_actor set account_id = '00000000-0000-4000-8000-000000000002';  -- branch manager of شكري, own branch
    set local role anon;
    v_result := public.review_stale_overtime_approval_v1('00000000-0000-4000-8000-00000000a001', 'confirm', 'مطابق بعد المراجعة');
    reset role;
    select * into v_row from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000a001';
    if v_row.status <> 'approved' or v_row.source_resolution_fingerprint <> public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000a1001')
       or v_row.overtime_hours <> 1.0 or v_row.overtime_amount <> 37.5 or v_row.decision_note <> 'اعتماد ساعة ×1.5'
       or v_row.decision_evidence_snapshot->'stale_review'->'previous'->>'source_resolution_fingerprint' <> 'fingerprint-of-an-earlier-truth'
       or v_row.decided_by <> '00000000-0000-4000-8000-000000000002' then
      raise exception 'confirm did not keep the decided values with a fresh fingerprint: %', row_to_json(v_row);
    end if;
    -- reviewing the same row again is refused (no double decision)
    perform public.test_expect_error('00000000-0000-4000-8000-000000000002', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000a001'', ''confirm'', ''n'')', '55000', 'overtime_not_stale_approved');

    update public.test_actor set account_id = '00000000-0000-4000-8000-000000000002';
    set local role anon;
    perform public.review_stale_overtime_approval_v1('00000000-0000-4000-8000-00000000a006', 'reject', 'اليوم غير معتمد');
    reset role;
    if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000a006') <> 'rejected' then
      raise exception 'reject did not reject';
    end if;
    -- A now finalizes (no stale approval left; the rejected row is out of payroll)
    insert into public.payroll_finalized_snapshots_v2 (snapshot_id, staff_id, staff_username, staff_name, month_cycle, snapshot_fingerprint, payload, finalized_by, finalized_by_name)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'a', 'A', '2026-10', 'fp', '{}', gen_random_uuid(), 't');

    -- delivery: confirm keeps the missing amount explicit and the 1.5 multiplier
    update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
    set local role anon;
    perform public.review_stale_overtime_approval_v1('00000000-0000-4000-8000-00000000c004', 'confirm', 'مطابق');
    reset role;
    select * into v_row from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000c004';
    if v_row.overtime_amount is not null or public.dawaa_overtime_multiplier_from_approval_v1(v_row.decision_evidence_snapshot, v_row.decision_note) <> 1.5
       or v_row.source_resolution_fingerprint <> public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000c1004') then
      raise exception 'delivery confirm invented an amount or lost the multiplier: %', row_to_json(v_row);
    end if;

    -- adjust: manager-entered values, fresh fingerprint
    set local role anon;
    perform public.review_stale_overtime_approval_v1('00000000-0000-4000-8000-00000000b003', 'adjust', 'ساعة ونصف فقط', 90, 32.25, 1);
    reset role;
    select * into v_row from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000b003';
    if v_row.overtime_hours <> 1.5 or v_row.overtime_amount <> 32.25 or (v_row.decision_evidence_snapshot->>'multiplier')::numeric <> 1
       or v_row.source_resolution_fingerprint <> public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000b1003') then
      raise exception 'adjust did not store the manager values with a fresh fingerprint: %', row_to_json(v_row);
    end if;
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then reset role;
  end;

  -- recalculate: back to pending, then v3 (now callable from the app) recomputes from current truth
  begin
    update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
    set local role anon;
    v_result := public.review_stale_overtime_approval_v1('00000000-0000-4000-8000-00000000a001', 'recalculate', 'أعد الحساب');
    v_result := public.decide_overtime_approval_v3('00000000-0000-4000-8000-00000000a001', 'approved', 'بعد إعادة الحساب');
    reset role;
    select * into v_row from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000a001';
    if v_row.status <> 'approved' or v_row.overtime_hours <> 1.00 or v_row.overtime_amount <> 37.50
       or v_row.source_resolution_fingerprint <> public.attendance_resolution_fingerprint_v2('00000000-0000-4000-8000-0000000a1001')
       or v_row.decision_evidence_version <> 'overtime_evidence_v3' then
      raise exception 'recalculation through v3 failed: %', row_to_json(v_row);
    end if;
    -- the in-app decision on a regular pending row works too
    set local role anon;
    perform public.decide_overtime_approval_v3('00000000-0000-4000-8000-00000000a002', 'approved', null);
    reset role;
    if (select status from public.staff_overtime_approvals where id = '00000000-0000-4000-8000-00000000a002') <> 'approved' then
      raise exception 'in-app decision failed';
    end if;
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then reset role;
  end;

  -- a finalized cycle cannot be reviewed (finalization guard bypassed only to set up the case)
  begin
    alter table public.payroll_finalized_snapshots_v2 disable trigger trg_block_stale_overtime_payroll_finalization_v1;
    insert into public.payroll_finalized_snapshots_v2 (snapshot_id, staff_id, staff_username, staff_name, month_cycle, snapshot_fingerprint, payload, finalized_by, finalized_by_name)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'b', 'B', '2026-09', 'fp', '{}', gen_random_uuid(), 't');
    alter table public.payroll_finalized_snapshots_v2 enable trigger trg_block_stale_overtime_payroll_finalization_v1;
    perform public.test_expect_error('00000000-0000-4000-8000-000000000001', 'select public.review_stale_overtime_approval_v1(''00000000-0000-4000-8000-00000000b925'', ''reject'', ''n'')', '55000', 'payroll_already_finalized_for_cycle');
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then reset role;
  end;
  update public.test_actor set account_id = null;
end;
$$;

-- 6. No duplicate approval for a staff day; nothing persisted by the test.
do $$
begin
  begin
    insert into public.staff_overtime_approvals (staff_id, attendance_date, overtime_hours, status)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-10-01', 1, 'pending');
    raise exception using errcode = 'P0901', message = 'duplicate overtime accepted';
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
