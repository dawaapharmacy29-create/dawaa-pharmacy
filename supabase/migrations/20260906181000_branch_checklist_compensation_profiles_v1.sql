-- Approved compensation setup for the newly governed checklist employees.
-- Keep this idempotent and resolve staff by canonical business identity fields,
-- not generated UUIDs, so rebuilding the database preserves the decision.

begin;

with approved_profiles(staff_name, branch, monthly_incentive_base, point_value) as (
  values
    ('أ/ هبه'::text, 'فرع شكري'::text, 500::numeric, 1::numeric),
    ('حبيبه'::text, 'فرع الشامي'::text, 500::numeric, 1::numeric),
    ('د/ محمد العزب'::text, 'فرع الشامي'::text, 500::numeric, 1::numeric)
), resolved as (
  select
    s.id::text as staff_id,
    s.name as staff_name,
    s.branch,
    p.monthly_incentive_base,
    p.point_value
  from approved_profiles p
  join public.staff s
    on trim(s.name)=trim(p.staff_name)
   and trim(coalesce(s.branch,''))=trim(p.branch)
   and coalesce(s.active,true)=true
)
insert into public.employee_compensation_profiles(
  staff_id,
  staff_name,
  branch,
  monthly_incentive_base,
  point_value,
  effective_from,
  active,
  notes
)
select
  r.staff_id,
  r.staff_name,
  r.branch,
  r.monthly_incentive_base,
  r.point_value,
  date '2026-09-06',
  true,
  'Approved monthly performance incentive: 500 EGP; 500-point reference => 1 EGP/point.'
from resolved r
on conflict (staff_id) do update set
  staff_name=excluded.staff_name,
  branch=excluded.branch,
  monthly_incentive_base=excluded.monthly_incentive_base,
  point_value=excluded.point_value,
  effective_from=excluded.effective_from,
  active=true,
  notes=excluded.notes,
  updated_at=now();

commit;
