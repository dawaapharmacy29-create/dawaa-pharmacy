-- Fixture for 20261016150000_overtime_approval_freshness_v1.
-- Tables have the Production columns and keys; the pay-cycle bounds, the fingerprint and the invalidation trigger are the
-- exact Production texts (overtime_approval_freshness_v1.prod.sql). Rows reproduce the reviewed stale categories:
-- diverged fingerprint, approved without fingerprint (linked and unlinked), fresh approvals, a pending approval, and a
-- stale approval in the previous cycle (25 -> 26 boundary).
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.attendance_daily_summary (
  id uuid primary key, staff_id uuid, attendance_date date, branch text, first_in timestamptz, last_out timestamptz,
  total_hours numeric, late_minutes integer, early_leave_minutes integer, missing_punch boolean, status text, source text,
  created_at timestamptz default now(), updated_at timestamptz default now(), schedule_id uuid,
  scheduled_start_at timestamptz, scheduled_end_at timestamptz, candidate_hours numeric, payroll_eligible_hours numeric,
  resolution_status text, resolution_version integer, resolution_snapshot jsonb, approved_at timestamptz, approved_by text,
  approved_by_name text, approval_note text, resolution_origin text, review_required boolean, resolved_at timestamptz,
  time_off_request_id uuid, policy_version text, sync_complete_through timestamptz
);
create table public.staff_overtime_approvals (
  id uuid not null default gen_random_uuid() primary key, staff_id uuid not null, staff_name text, branch text,
  attendance_date date not null, overtime_hours numeric not null, hourly_rate numeric, overtime_amount numeric,
  status text not null default 'pending' check (status = any (array['pending','approved','rejected'])),
  decided_by text, decided_by_name text, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source_resolution_id uuid, source_resolution_fingerprint text, source_resolution_linked_at timestamptz,
  decision_evidence_snapshot jsonb, decision_evidence_version text,
  unique (staff_id, attendance_date)
);
create table public.payroll_finalized_snapshots_v2 (
  id uuid not null default gen_random_uuid() primary key, snapshot_id uuid not null unique, staff_id uuid not null,
  staff_username text not null, staff_name text not null, branch text, month_cycle text not null check (month_cycle ~ '^\d{4}-\d{2}$'),
  cycle_start date, cycle_end date, snapshot_fingerprint text not null, payload jsonb not null, finalized_by uuid not null,
  finalized_by_name text not null, finalized_at timestamptz not null default now(),
  state text not null default 'finalized' check (state = 'finalized'),
  unique (staff_id, month_cycle)
);
create table public.employee_transactions (
  id uuid primary key default gen_random_uuid(), staff_id uuid, month_cycle text, source text, points numeric
);

\ir overtime_approval_freshness_v1.prod.sql

create trigger trg_hr_invalidate_overtime_on_attendance_change_v1 after update of status, schedule_id, scheduled_start_at, scheduled_end_at, first_in, last_out, candidate_hours, payroll_eligible_hours, late_minutes, early_leave_minutes, resolution_status, time_off_request_id on public.attendance_daily_summary for each row execute function hr_invalidate_overtime_on_attendance_change_v1();

-- Staff: A (standard), B (manual approvals), D (cycle boundary), F (only fresh approvals).
insert into public.attendance_daily_summary (id, staff_id, attendance_date, branch, first_in, last_out, total_hours, late_minutes, early_leave_minutes, status, source, scheduled_start_at, scheduled_end_at, candidate_hours, payroll_eligible_hours, resolution_status, resolution_version, policy_version) values
  ('00000000-0000-4000-8000-0000000a0926', '00000000-0000-4000-8000-0000000000a1', '2026-09-26', 'فرع شكري', '2026-09-26 06:00+00', '2026-09-26 16:30+00', 10.5, 0, 0, 'approved', 'attendance_resolution_v2', '2026-09-26 06:00+00', '2026-09-26 15:00+00', 10.5, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000000a1', '2026-10-01', 'فرع شكري', '2026-10-01 06:00+00', '2026-10-01 16:00+00', 10, 0, 0, 'approved', 'attendance_resolution_v2', '2026-10-01 06:00+00', '2026-10-01 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000a1002', '00000000-0000-4000-8000-0000000000a1', '2026-10-02', 'فرع شكري', '2026-10-02 06:00+00', '2026-10-02 16:00+00', 10, 0, 0, 'approved', 'attendance_resolution_v2', '2026-10-02 06:00+00', '2026-10-02 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000b1003', '00000000-0000-4000-8000-0000000000b1', '2026-10-03', 'فرع الشامي', '2026-10-03 06:00+00', '2026-10-03 17:00+00', 11, 0, 0, 'approved', 'attendance_resolution_v2', '2026-10-03 06:00+00', '2026-10-03 15:00+00', 11, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000d0925', '00000000-0000-4000-8000-0000000000d1', '2026-09-25', 'فرع الشامي', '2026-09-25 06:00+00', '2026-09-25 16:00+00', 10, 0, 0, 'approved', 'attendance_resolution_v2', '2026-09-25 06:00+00', '2026-09-25 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000d0926', '00000000-0000-4000-8000-0000000000d1', '2026-09-26', 'فرع الشامي', '2026-09-26 06:00+00', '2026-09-26 16:00+00', 10, 0, 0, 'approved', 'attendance_resolution_v2', '2026-09-26 06:00+00', '2026-09-26 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000f1005', '00000000-0000-4000-8000-0000000000f1', '2026-10-05', 'فرع شكري', '2026-10-05 06:00+00', '2026-10-05 16:00+00', 10, 0, 0, 'approved', 'attendance_resolution_v2', '2026-10-05 06:00+00', '2026-10-05 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1');

insert into public.staff_overtime_approvals (id, staff_id, staff_name, branch, attendance_date, overtime_hours, hourly_rate, overtime_amount, status, decided_by, decided_by_name, decided_at, source_resolution_id, source_resolution_fingerprint, decision_evidence_version) values
  -- diverged: fingerprint from an earlier truth
  ('00000000-0000-4000-8000-00000000e926', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-09-26', 1.5, 25, 56.25, 'approved', 'system:manager-decision', 'قرار المدير العام', '2026-09-28', '00000000-0000-4000-8000-0000000a0926', 'fingerprint-of-an-earlier-truth', null),
  -- fresh approval (fingerprint set below)
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-10-01', 1.0, 25, 37.5, 'approved', 'general_manager', 'اعتماد المدير العام', '2026-10-02', '00000000-0000-4000-8000-0000000a1001', null, null),
  -- pending, linked with a fresh fingerprint (set below)
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-10-02', 1.0, 25, 37.5, 'pending', null, null, null, '00000000-0000-4000-8000-0000000a1002', null, null),
  -- approved without fingerprint, linked / unlinked (manual writes)
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', '2026-10-03', 2.0, 20, 60, 'approved', 'system:manager-decision', 'قرار الإدارة', '2026-10-04', '00000000-0000-4000-8000-0000000b1003', null, 'manual_v1'),
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', '2026-10-04', 1.0, 20, null, 'approved', 'manager', 'الإدارة', '2026-10-05', null, null, 'manager_manual_v1'),
  -- cycle boundary: stale on 2026-09-25 (cycle 2026-09), fresh on 2026-09-26 (cycle 2026-10)
  ('00000000-0000-4000-8000-00000000e925', '00000000-0000-4000-8000-0000000000d1', 'D', 'فرع الشامي', '2026-09-25', 1.0, 20, 30, 'approved', null, 'قرار المدير العام', '2026-09-26', '00000000-0000-4000-8000-0000000d0925', null, null),
  ('00000000-0000-4000-8000-00000000d926', '00000000-0000-4000-8000-0000000000d1', 'D', 'فرع الشامي', '2026-09-26', 1.0, 20, 30, 'approved', null, 'قرار المدير العام', '2026-09-27', '00000000-0000-4000-8000-0000000d0926', null, null),
  ('00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-0000000000f1', 'F', 'فرع شكري', '2026-10-05', 1.0, 25, 37.5, 'approved', null, 'قرار المدير العام', '2026-10-06', '00000000-0000-4000-8000-0000000f1005', null, null);
update public.staff_overtime_approvals o set source_resolution_fingerprint = public.attendance_resolution_fingerprint_v2(o.source_resolution_id)
where o.id in ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e002',
               '00000000-0000-4000-8000-00000000d926', '00000000-0000-4000-8000-00000000f005');

insert into public.employee_transactions (staff_id, month_cycle, source, points) values
  ('00000000-0000-4000-8000-0000000000a1', '2026-10', 'attendance_overtime_v2', 3),
  ('00000000-0000-4000-8000-0000000000a1', '2026-10', 'conversation_evaluation', 5);

-- Before-state for the test: every overtime row, and whether the Production trigger invalidates a fresh approval when
-- only policy_version (a fingerprint input) changes.
create table public.test_before_rows as
select md5(string_agg(o::text, '|' order by o.id)) rows_md5 from public.staff_overtime_approvals o;
create table public.test_gap_before (status_after_policy_change text, stale_count_after_policy_change integer);
do $$
begin
  begin
    update public.attendance_daily_summary set policy_version = 'attendance_policy_v3' where id = '00000000-0000-4000-8000-0000000a1001';
    raise exception using errcode = 'P0902', message = (
      select o.status || '|' || (o.source_resolution_fingerprint is distinct from public.attendance_resolution_fingerprint_v2(o.source_resolution_id))::text
      from public.staff_overtime_approvals o where o.id = '00000000-0000-4000-8000-00000000e001');
  exception when sqlstate 'P0902' then
    insert into public.test_gap_before values (split_part(sqlerrm, '|', 1), case when split_part(sqlerrm, '|', 2) = 'true' then 1 else 0 end);
  end;
end;
$$;
