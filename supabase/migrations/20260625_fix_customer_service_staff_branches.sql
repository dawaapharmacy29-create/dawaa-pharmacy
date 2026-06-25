-- Fix pharmacist / customer-service branch assignments (safe update-only migration)

with target_staff(name, username, branch_name, role_name) as (
  values
    ('د ندي', 'dr_nada', 'فرع شكري', 'pharmacist'),
    ('د بسنت', 'dr_basent', 'فرع شكري', 'pharmacist'),
    ('د وليد', 'dr_waleed', 'فرع الشامي', 'pharmacist'),
    ('د عمر', 'dr_omar', 'فرع الشامي', 'pharmacist'),
    ('د دنيا', 'dr_donia', 'فرع شكري', 'customer_service'),
    ('د ضحي', 'dr_doha', 'فرع الشامي', 'customer_service')
),
insert_missing_staff as (
  insert into public.staff (
    id, name, staff_name, role, branch, status, active, is_active, created_at, updated_at
  )
  select
    gen_random_uuid(), ts.name, ts.name, ts.role_name, ts.branch_name,
    'active', true, true, now(), now()
  from target_staff ts
  where not exists (
    select 1
    from public.staff s
    where replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ts.name, ' ', '')
  )
  returning id
)
update public.staff s
set branch = ts.branch_name,
    role = coalesce(nullif(s.role, ''), ts.role_name),
    status = 'active',
    active = true,
    is_active = true,
    updated_at = now()
from target_staff ts
where replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ts.name, ' ', '');

insert into public.staff_accounts (
  id, staff_id, username, temporary_password, password_status,
  name, staff_name, display_name, role, branch,
  active, can_login, visible_in_admin, created_at, updated_at
)
select
  gen_random_uuid(),
  s.id,
  ts.username,
  'Dawaa2027',
  'temporary',
  ts.name,
  ts.name,
  ts.name,
  ts.role_name,
  ts.branch_name,
  true,
  true,
  true,
  now(),
  now()
from target_staff ts
join public.staff s
  on replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ts.name, ' ', '')
where not exists (
  select 1 from public.staff_accounts a where a.username = ts.username
);

update public.staff_accounts a
set branch = ts.branch_name,
    role = coalesce(nullif(a.role, ''), ts.role_name),
    active = true,
    can_login = true,
    visible_in_admin = true,
    updated_at = now()
from target_staff ts
where replace(coalesce(a.name, a.staff_name, a.display_name, ''), ' ', '') = replace(ts.name, ' ', '');
