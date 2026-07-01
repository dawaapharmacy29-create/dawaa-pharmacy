-- Hotfix: pin Dr Sara and Dr Basent canonical staff/account identity.
-- Safe data-only migration: no invoice, delivery, or sales logic changes.

alter table if exists public.staff add column if not exists username text;
alter table if exists public.staff add column if not exists role_label text;
alter table if exists public.staff add column if not exists job_title text;
alter table if exists public.staff_accounts add column if not exists role_label text;
alter table if exists public.staff_accounts add column if not exists job_title text;

with target_staff(name, username, role_name, role_label, job_title, branch_name) as (
  values
    ('د/ سارة', 'dr.sara', 'pharmacist', 'صيدلانية', 'صيدلانية', 'فرع شكري'),
    ('د بسنت', 'dr_basent', 'shift_supervisor_morning', 'مسئولة شيفت صباحي', 'مسئولة شيفت صباحي', 'فرع الشامي')
)
insert into public.staff (
  id, name, staff_name, username, role, role_label, job_title, branch,
  status, active, is_active, is_deleted, created_at, updated_at
)
select
  gen_random_uuid(), t.name, t.name, t.username, t.role_name, t.role_label, t.job_title, t.branch_name,
  'active', true, true, false, now(), now()
from target_staff t
where not exists (
  select 1
  from public.staff s
  where coalesce(s.username, '') = t.username
     or regexp_replace(
          replace(replace(replace(replace(coalesce(s.name, s.staff_name, ''), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ة', 'ه'),
          '^(دكتور|الدكتور|د/|د\.|د)\s*', ''
        ) = regexp_replace(
          replace(replace(replace(replace(t.name, 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ة', 'ه'),
          '^(دكتور|الدكتور|د/|د\.|د)\s*', ''
        )
);

with target_staff(name, username, role_name, role_label, job_title, branch_name) as (
  values
    ('د/ سارة', 'dr.sara', 'pharmacist', 'صيدلانية', 'صيدلانية', 'فرع شكري'),
    ('د بسنت', 'dr_basent', 'shift_supervisor_morning', 'مسئولة شيفت صباحي', 'مسئولة شيفت صباحي', 'فرع الشامي')
)
update public.staff s
set name = t.name,
    staff_name = t.name,
    username = t.username,
    role = t.role_name,
    role_label = t.role_label,
    job_title = t.job_title,
    branch = t.branch_name,
    status = 'active',
    active = true,
    is_active = true,
    is_deleted = false,
    updated_at = now()
from target_staff t
where coalesce(s.username, '') = t.username
   or regexp_replace(
        replace(replace(replace(replace(coalesce(s.name, s.staff_name, ''), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ة', 'ه'),
        '^(دكتور|الدكتور|د/|د\.|د)\s*', ''
      ) = regexp_replace(
        replace(replace(replace(replace(t.name, 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ة', 'ه'),
        '^(دكتور|الدكتور|د/|د\.|د)\s*', ''
      );

with target_staff(name, username, role_name, role_label, job_title, branch_name) as (
  values
    ('د/ سارة', 'dr.sara', 'pharmacist', 'صيدلانية', 'صيدلانية', 'فرع شكري'),
    ('د بسنت', 'dr_basent', 'shift_supervisor_morning', 'مسئولة شيفت صباحي', 'مسئولة شيفت صباحي', 'فرع الشامي')
),
canonical_staff as (
  select distinct on (t.username)
    t.*,
    s.id as staff_id
  from target_staff t
  join public.staff s on s.username = t.username
  order by t.username, s.active desc nulls last, s.updated_at desc nulls last, s.id
)
insert into public.staff_accounts (
  id, staff_id, username, temporary_password, password_status,
  name, staff_name, display_name, role, role_label, job_title, branch,
  active, can_login, visible_in_admin, created_at, updated_at
)
select
  gen_random_uuid(),
  c.staff_id,
  c.username,
  'Dawaa2027',
  'temporary',
  c.name,
  c.name,
  c.name,
  c.role_name,
  c.role_label,
  c.job_title,
  c.branch_name,
  true,
  true,
  true,
  now(),
  now()
from canonical_staff c
where not exists (
  select 1 from public.staff_accounts a where a.username = c.username
);

with target_staff(name, username, role_name, role_label, job_title, branch_name) as (
  values
    ('د/ سارة', 'dr.sara', 'pharmacist', 'صيدلانية', 'صيدلانية', 'فرع شكري'),
    ('د بسنت', 'dr_basent', 'shift_supervisor_morning', 'مسئولة شيفت صباحي', 'مسئولة شيفت صباحي', 'فرع الشامي')
),
canonical_staff as (
  select distinct on (t.username)
    t.*,
    s.id as staff_id
  from target_staff t
  join public.staff s on s.username = t.username
  order by t.username, s.active desc nulls last, s.updated_at desc nulls last, s.id
)
update public.staff_accounts a
set staff_id = c.staff_id,
    name = c.name,
    staff_name = c.name,
    display_name = c.name,
    role = c.role_name,
    role_label = c.role_label,
    job_title = c.job_title,
    branch = c.branch_name,
    active = true,
    can_login = true,
    visible_in_admin = true,
    updated_at = now()
from canonical_staff c
where a.username = c.username;

do $$
begin
  if to_regclass('public.staff_identity_aliases') is not null then
    update public.staff_identity_aliases a
    set active = false
    where a.normalized_alias in ('ساره', 'بسنت')
      and not exists (
        select 1
        from public.staff s
        where s.id = a.staff_id
          and s.username in ('dr.sara', 'dr_basent')
      );

    insert into public.staff_identity_aliases (
      id, staff_id, alias_name, normalized_alias, source, confidence, active, created_at, created_by
    )
    select gen_random_uuid(), s.id, alias.alias_name, alias.normalized_alias, 'canonical-staff-hotfix', 1.0, true, now(), 'system'
    from public.staff s
    join (
      values
        ('dr.sara', 'د/ سارة', 'ساره'),
        ('dr.sara', 'د سارة', 'ساره'),
        ('dr.sara', 'سارة', 'ساره'),
        ('dr_basent', 'د بسنت', 'بسنت'),
        ('dr_basent', 'بسنت', 'بسنت')
    ) as alias(username, alias_name, normalized_alias)
      on alias.username = s.username
    where not exists (
      select 1
      from public.staff_identity_aliases existing
      where existing.staff_id = s.id
        and existing.normalized_alias = alias.normalized_alias
        and existing.active = true
    );
  end if;
end $$;

