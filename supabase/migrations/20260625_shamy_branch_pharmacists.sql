-- Add / update pharmacists for فرع الشامي (safe insert-only migration)
-- Run in Supabase SQL editor if migrations are not auto-applied.

with new_staff(name, username, branch_name) as (
  values
    ('د ندي', 'dr_nada', 'فرع الشامي'),
    ('د بسنت', 'dr_basent', 'فرع الشامي'),
    ('د وليد', 'dr_waleed', 'فرع الشامي'),
    ('د عمر', 'dr_omar', 'فرع الشامي')
), upsert_staff as (
  insert into public.staff (id, name, staff_name, role, branch, status, active, is_active, created_at, updated_at)
  select gen_random_uuid(), ns.name, ns.name, 'pharmacist', ns.branch_name, 'active', true, true, now(), now()
  from new_staff ns
  where not exists (
    select 1
    from public.staff s
    where replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ns.name, ' ', '')
  )
  returning id, name
)
update public.staff s
set branch = coalesce(s.branch, 'فرع الشامي'),
    role = coalesce(s.role, 'pharmacist'),
    status = coalesce(s.status, 'active'),
    active = true,
    is_active = true,
    updated_at = now()
from new_staff ns
where replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ns.name, ' ', '');

insert into public.staff_accounts (
  id, staff_id, username, temporary_password, password_status,
  name, staff_name, display_name, role, branch, active, can_login, visible_in_admin, created_at, updated_at
)
select
  gen_random_uuid(),
  s.id,
  ns.username,
  'Dawaa2027',
  'temporary',
  ns.name,
  ns.name,
  ns.name,
  'pharmacist',
  ns.branch_name,
  true,
  true,
  true,
  now(),
  now()
from new_staff ns
join public.staff s on replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ns.name, ' ', '')
where not exists (
  select 1 from public.staff_accounts a where a.username = ns.username
);
