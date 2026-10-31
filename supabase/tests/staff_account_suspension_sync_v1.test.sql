-- Suspension sync: backfill, suspend, shared staff rows, reactivation, and no deletes.
do $$
declare
  v_n integer;
  v_yesterday date := (now() at time zone 'Africa/Cairo')::date - 1;
begin
  -- Backfill: the old suspended account is hidden and its open schedule closed; the closed row is kept as is.
  if exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000002'
              and (active or is_active or visible_in_schedule or status <> 'موقوف')) then
    raise exception 'backfill_staff_not_suspended';
  end if;
  select count(*) into v_n from public.shift_schedules
   where staff_id = '00000000-0000-4000-9000-000000000002' and effective_to is null;
  if v_n <> 0 then raise exception 'backfill_schedule_open'; end if;
  if (select count(*) from public.shift_schedules where staff_id = '00000000-0000-4000-9000-000000000002') <> 2 then
    raise exception 'backfill_deleted_rows';
  end if;

  -- A staff row still linked to another active account is left alone.
  if not exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000003' and active) then
    raise exception 'shared_staff_suspended';
  end if;
  if exists (select 1 from public.shift_schedules where staff_id = '00000000-0000-4000-9000-000000000003'
              and effective_to is not null) then
    raise exception 'shared_schedule_closed';
  end if;

  -- A terminated status is kept, but the stale schedule flag and open schedule are closed.
  if not exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000004'
                  and status = 'terminated' and visible_in_schedule = false) then
    raise exception 'terminated_status_changed';
  end if;

  -- Suspending now: staff hidden, both schedules closed (a future one at its own start), session revoked.
  update public.staff_accounts set active = false where id = '00000000-0000-4000-8000-000000000101';
  if not exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000001'
                  and status = 'موقوف' and not active and not is_active and not visible_in_schedule) then
    raise exception 'suspend_staff_not_synced';
  end if;
  if exists (select 1 from public.shift_schedules where staff_id = '00000000-0000-4000-9000-000000000001'
              and (effective_to is null or effective_to < effective_from)) then
    raise exception 'suspend_schedule_open';
  end if;
  if not exists (select 1 from public.shift_schedules where staff_id = '00000000-0000-4000-9000-000000000001'
                  and day_name = 'السبت' and effective_to = v_yesterday) then
    raise exception 'suspend_schedule_wrong_day';
  end if;
  if exists (select 1 from public.staff_login_sessions
              where staff_account_id = '00000000-0000-4000-8000-000000000101' and revoked_at is null) then
    raise exception 'suspend_session_open';
  end if;
  if not exists (select 1 from public.staff_account_suspension_sync_log
                  where staff_account_id = '00000000-0000-4000-8000-000000000101' and action = 'suspend'
                    and cardinality(closed_schedule_ids) = 2 and revoked_sessions = 1) then
    raise exception 'suspend_not_logged';
  end if;

  -- Reactivating restores the staff row only; schedules stay closed until re-entered.
  update public.staff_accounts set active = true where id = '00000000-0000-4000-8000-000000000101';
  if not exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000001'
                  and status = 'نشط' and active and is_active and visible_in_schedule) then
    raise exception 'reactivate_not_synced';
  end if;
  if exists (select 1 from public.shift_schedules where staff_id = '00000000-0000-4000-9000-000000000001'
              and effective_to is null) then
    raise exception 'reactivate_reopened_schedule';
  end if;

  -- A terminated employee's account being re-enabled does not revive the HR row.
  update public.staff_accounts set active = true where id = '00000000-0000-4000-8000-000000000104';
  if exists (select 1 from public.staff where id = '00000000-0000-4000-9000-000000000004' and active) then
    raise exception 'terminated_revived';
  end if;

  -- Clients cannot call the sync or read its log.
  if has_function_privilege('anon', 'public.dawaa_sync_staff_account_suspension_v1(uuid, text)', 'execute')
     or has_table_privilege('anon', 'public.staff_account_suspension_sync_log', 'select') then
    raise exception 'client_access';
  end if;
end;
$$;
