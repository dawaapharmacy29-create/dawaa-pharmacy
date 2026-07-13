-- Dawaa Pharmacy — staff account canonicalization audit foundation
-- This migration is NON-DESTRUCTIVE: it does not disable, delete, or merge any account.

create or replace function public.normalize_staff_identity_text(p_value text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        replace(replace(replace(replace(replace(lower(coalesce(p_value, '')), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ى', 'ي'), 'ة', 'ه'),
        '(^|\s)(د|دكتور|doctor)(/|\s|$)', ' ', 'gi'
      ),
      '[\s_./\\-]+', ' ', 'g'
    )
  );
$$;

create table if not exists public.staff_account_merge_plan (
  id uuid primary key default gen_random_uuid(),
  old_account_id uuid not null,
  canonical_account_id uuid not null,
  old_staff_id uuid,
  canonical_staff_id uuid,
  reason text not null,
  status text not null default 'draft',
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  applied_at timestamptz,
  apply_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_account_merge_plan_distinct_check
    check (old_account_id <> canonical_account_id),
  constraint staff_account_merge_plan_status_check
    check (status in ('draft','approved','applied','rejected','rolled_back')),
  constraint staff_account_merge_plan_old_unique unique (old_account_id)
);

create index if not exists staff_account_merge_plan_status_idx
  on public.staff_account_merge_plan(status, created_at desc);

alter table public.staff_account_merge_plan enable row level security;

-- Keep the plan unavailable to normal authenticated users until the existing
-- management-role helper is connected in a later reviewed migration.
revoke all on public.staff_account_merge_plan from anon, authenticated;

create or replace view public.staff_account_cleanup_audit as
select
  nullif(a->>'id', '')::uuid as account_id,
  nullif(a->>'staff_id', '')::uuid as staff_id,
  a->>'username' as username,
  coalesce(a->>'staff_name', a->>'name', a->>'display_name', '') as display_name,
  public.normalize_staff_identity_text(coalesce(a->>'staff_name', a->>'name', a->>'display_name', '')) as normalized_name,
  coalesce(a->>'role', a->>'staff_role', '') as role,
  coalesce(a->>'branch', '') as branch,
  coalesce(nullif(a->>'active', '')::boolean, nullif(a->>'is_active', '')::boolean, true) as active,
  coalesce(nullif(a->>'can_login', '')::boolean, true) as can_login,
  coalesce(nullif(a->>'visible_in_admin', '')::boolean, true) as visible_in_admin,
  nullif(a->>'last_login_at', '')::timestamptz as last_login_at,
  nullif(a->>'created_at', '')::timestamptz as created_at,
  nullif(a->>'updated_at', '')::timestamptz as updated_at,
  (lower(coalesce(a->>'username', '')) like '%disabled%') as username_marked_disabled,
  (
    lower(coalesce(a->>'username', '')) like '%demo%'
    or coalesce(a->>'staff_name', a->>'name', '') ilike '%تجريبي%'
  ) as looks_demo,
  case
    when nullif(a->>'staff_id', '') is null then 'missing_staff_id'
    when lower(coalesce(a->>'username', '')) like '%disabled%' and coalesce(nullif(a->>'can_login', '')::boolean, true) then 'disabled_name_can_login'
    when lower(coalesce(a->>'username', '')) like '%demo%' or coalesce(a->>'staff_name', a->>'name', '') ilike '%تجريبي%' then 'demo_account'
    when coalesce(nullif(a->>'active', '')::boolean, nullif(a->>'is_active', '')::boolean, true) = false
      and coalesce(nullif(a->>'can_login', '')::boolean, true) then 'inactive_can_login'
    else 'review'
  end as audit_status,
  a as raw_account
from (
  select to_jsonb(sa) as a
  from public.staff_accounts sa
) q;

create or replace view public.staff_account_duplicate_groups as
select
  normalized_name,
  branch,
  role,
  count(*) as accounts_count,
  count(*) filter (where active and can_login and not username_marked_disabled and not looks_demo) as login_enabled_count,
  array_agg(account_id order by created_at nulls last) as account_ids,
  array_agg(username order by created_at nulls last) as usernames,
  array_agg(staff_id order by created_at nulls last) as staff_ids
from public.staff_account_cleanup_audit
where normalized_name <> ''
group by normalized_name, branch, role
having count(*) > 1;

create or replace function public.list_staff_identity_reference_columns()
returns table(
  table_schema text,
  table_name text,
  column_name text,
  data_type text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    n.nspname::text,
    c.relname::text,
    a.attname::text,
    format_type(a.atttypid, a.atttypmod)::text
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and a.attnum > 0
    and not a.attisdropped
    and (
      a.attname in (
        'staff_id','employee_id','doctor_id','seller_id','reviewed_staff_id',
        'responsible_staff_id','assigned_to','completed_by','approved_by',
        'created_by','updated_by','uploaded_by','reviewed_by','requested_by'
      )
      or a.attname like '%staff_id'
      or a.attname like '%account_id'
    )
  order by n.nspname, c.relname, a.attname;
$$;

revoke all on function public.list_staff_identity_reference_columns() from public, anon, authenticated;

comment on table public.staff_account_merge_plan is
  'Staging plan only. No account is changed until a separately reviewed apply migration is executed.';
comment on view public.staff_account_cleanup_audit is
  'Read-only account quality audit generated from staff_accounts using JSON compatibility extraction.';
comment on view public.staff_account_duplicate_groups is
  'Potential duplicate groups by normalized name, branch, and role. Every group requires manual approval.';
