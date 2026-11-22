-- Owner decision 2026-11-22 («صلح باقي القرارات اللي فيها مشكله»): days whose reading was wrong, settled from
-- the punches and, where a punch is missing, the employee's own sales or deliveries (manual sales imports keep
-- Cairo time as written; BConnect files are in UTC).

-- 1) هبه محمد: the leave entered on 19/11 started on 4/11, but she worked 4/11 and 5/11 in full (08:49→17:01,
--    09:01→17:01). The leave starts on 6/11; the two days are read again from their punches.
update public.staff_time_off_requests
set start_date = date '2026-11-06',
    decision_note = coalesce(decision_note, '') || ' — قرار المالك 22/11: الإجازة تبدأ 6/11، اشتغلت 4 و5/11 يوم كامل',
    updated_at = now()
where id = 'f2080a8b-a68c-4e9c-b03f-3274cadc912a' and start_date = date '2026-11-04';

select public.dawaa_materialize_attendance_day_internal_v3('dea91886-1ae8-4766-a166-9952866a5024', date '2026-11-04');
select public.dawaa_materialize_attendance_day_internal_v3('dea91886-1ae8-4766-a166-9952866a5024', date '2026-11-05');

-- 2) Days paid from the evidence, with no early-leave or missing-punch deduction.
with fix(name, day, hours, why) as (
  values
    ('أحمد أبو نور',  date '2026-10-30', 8.07::numeric, 'اشتغل 14:11 → 22:15 بدل شيفت 17–00 (توصيلتين 14:29 و16:43)'),
    ('أحمد أبو نور',  date '2026-11-20', 7.18::numeric, 'اشتغل 14:21 → 21:32 بدل شيفت 17–00'),
    ('محمد الالفي',   date '2026-11-20', 7.08::numeric, 'اشتغل 17:55 → 01:00 بدل شيفت 20–04'),
    ('د اميرة',       date '2026-11-03', 7.97::numeric, 'بصمة حضور 11:45 بس، و38 فاتورة باسمها لحد 19:43'),
    ('محمود القطري',  date '2026-10-30', 10.82::numeric, 'بصمة حضور 18:05 بس، وتوصيلتين 04:35 و04:54 الفجر')
)
update public.attendance_daily_summary a
set status = 'approved',
    payroll_eligible_hours = f.hours,
    early_leave_minutes = 0,
    resolution_origin = 'manager',
    review_required = false,
    approved_by = 'owner_decision:2026-11-22',
    approved_by_name = 'قرار المالك',
    approved_at = now(),
    resolved_at = now(),
    approval_note = 'قرار المالك 22/11: ' || f.why || ' = ' || f.hours || ' ساعة. من غير نسيان بصمة ولا خصم',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', f.hours,
                            'owner_decision_at', '2026-11-22', 'hours_evidence', f.why),
    updated_at = now()
from fix f
join public.staff st on btrim(st.name) = f.name
where a.staff_id = st.id and a.attendance_date = f.day and a.status = 'pending_review';

-- 3) اسلام السبع: six missing-punch records were added on his old day schedule (09:00–19:00) while he works nights.
--    Five of their manual punches were already turned down because his real punch was there; on 14/11 he did not
--    work a day shift at all (his night ended 08:18). The records are kept in a backup table and removed, the
--    14/11 manual punch is turned down, and his remaining records are numbered again.
create table if not exists public.attendance_missing_punch_incidents_voided_v1 (
  like public.attendance_missing_punch_incidents including defaults,
  voided_at timestamptz not null default now(),
  voided_reason text
);
alter table public.attendance_missing_punch_incidents_voided_v1 enable row level security;

with wrong as (
  select i.id from public.attendance_missing_punch_incidents i
  join public.staff st on st.id = i.staff_id and btrim(st.name) = 'اسلام السبع'
  where (i.attendance_date, i.missing_type) in ((date '2026-11-01', 'check_in'), (date '2026-11-08', 'check_out'),
         (date '2026-11-09', 'check_in'), (date '2026-11-12', 'check_in'),
         (date '2026-11-14', 'check_in'), (date '2026-11-14', 'check_out'))
    and i.deduction_transaction_id is null
),
saved as (
  insert into public.attendance_missing_punch_incidents_voided_v1
  select i.*, now(), 'قرار المالك 22/11: اتسجل على جدول النهار القديم وهو بيشتغل ليل'
  from public.attendance_missing_punch_incidents i where i.id in (select id from wrong)
  returning id
)
delete from public.attendance_missing_punch_incidents i where i.id in (select id from saved);

update public.staff_attendance_logs l
set status = 'rejected'
from public.staff st
where st.id = l.staff_id and btrim(st.name) = 'اسلام السبع'
  and l.shift_date = date '2026-11-14' and l.attendance_type = 'check_in'
  and l.recorded_at = timestamptz '2026-11-14 09:00:00+02' and l.status = 'accepted';

with renum as (
  select i.id, row_number() over (partition by i.staff_id, i.month_cycle order by i.attendance_date, i.created_at) as n
  from public.attendance_missing_punch_incidents i
  join public.staff st on st.id = i.staff_id and btrim(st.name) = 'اسلام السبع'
)
update public.attendance_missing_punch_incidents i
set occurrence_no = r.n,
    penalty_eligible = r.n > i.allowance_limit,
    updated_at = now()
from renum r
where r.id = i.id and i.deduction_transaction_id is null;
