-- Synthetic isolated fixture; reuses the shift handover sync fixture (no production IDs).
\ir base44_shift_handover_sync_v1.fixture.sql

create table public.staff(id uuid primary key, name text, role text);
alter table public.attendance_daily_summary add column first_in timestamptz, add column last_out timestamptz,
  add column scheduled_start_at timestamptz, add column scheduled_end_at timestamptz;

insert into public.staff values
  ('10000000-0000-4000-8000-000000000001', 'د ليلي', 'صيدلاني'),
  ('10000000-0000-4000-8000-000000000002', 'د صباحي', 'pharmacist'),
  ('10000000-0000-4000-8000-000000000003', 'د مسائي', 'صيدلاني'),
  ('10000000-0000-4000-8000-000000000004', 'د مديرة', 'مدير فرع'),
  ('10000000-0000-4000-8000-000000000005', 'دليفري', 'delivery'),
  ('10000000-0000-4000-8000-000000000006', 'د جدول', 'صيدلاني'),
  ('10000000-0000-4000-8000-000000000007', 'د ليلي تاني', 'صيدلاني');

-- Shokry, 1 Nov (Cairo, UTC+2).
insert into public.attendance_daily_summary(staff_id, attendance_date, branch, first_in, last_out, scheduled_start_at, scheduled_end_at) values
  -- Night: punched in the evening before and out after 08:00.
  ('10000000-0000-4000-8000-000000000001', '2026-11-01', 'فرع شكري', '2026-10-31 23:20+02', '2026-11-01 09:30+02', '2026-11-01 00:00+02', '2026-11-01 09:00+02'),
  -- Morning: no punch out, the schedule ends at 17:00.
  ('10000000-0000-4000-8000-000000000002', '2026-11-01', 'فرع شكري', '2026-11-01 09:10+02', null, '2026-11-01 09:00+02', '2026-11-01 17:00+02'),
  -- The manager is there through the morning close.
  ('10000000-0000-4000-8000-000000000004', '2026-11-01', 'فرع شكري', '2026-11-01 09:30+02', '2026-11-01 19:00+02', null, null),
  -- Evening: 17:00 to 01:00, filed on the 1st.
  ('10000000-0000-4000-8000-000000000003', '2026-11-01', 'فرع شكري', '2026-11-01 17:05+02', '2026-11-02 01:10+02', '2026-11-01 17:00+02', '2026-11-02 01:00+02'),
  -- The delivery man is not a doctor.
  ('10000000-0000-4000-8000-000000000005', '2026-11-01', 'فرع شكري', '2026-11-01 08:00+02', '2026-11-01 20:00+02', null, null),
  -- Scheduled for the morning with no punch: hidden, someone punched.
  ('10000000-0000-4000-8000-000000000006', '2026-11-01', 'فرع شكري', null, null, '2026-11-01 09:00+02', '2026-11-01 17:00+02'),
  -- Next night's doctor arrives at 23:30 — not on the evening close at 01:00.
  ('10000000-0000-4000-8000-000000000007', '2026-11-02', 'فرع شكري', '2026-11-01 23:30+02', null, '2026-11-02 00:00+02', '2026-11-02 08:00+02'),
  -- Al-Shami night: schedule only, nobody punched.
  ('10000000-0000-4000-8000-000000000006', '2026-11-01', 'فرع الشامي', null, null, '2026-11-01 00:00+02', '2026-11-01 08:00+02');

-- Production grants the handover table to the browser and reads it through RLS.
alter table public.shift_handovers enable row level security;
create policy shift_handovers_read on public.shift_handovers for select to authenticated using (true);
