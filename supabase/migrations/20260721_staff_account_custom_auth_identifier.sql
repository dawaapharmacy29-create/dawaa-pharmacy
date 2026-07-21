-- Support the application's custom staff-account login identifiers (including legacy values such as "admin")
-- while keeping account visibility restricted to an active privileged account.

create or replace function public.dawaa_request_staff_identifier()
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', '')), '');
$$;

create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (
      select a.id
      from public.staff_accounts a
      where auth.uid() is not null
        and a.auth_user_id = auth.uid()
        and coalesce(a.active, false)
        and coalesce(a.can_login, false)
      limit 1
    ),
    (
      select a.id
      from public.staff_accounts a, request_identity r
      where r.value is not null
        and coalesce(a.active, false)
        and coalesce(a.can_login, false)
        and (
          a.id::text = r.value
          or a.staff_id::text = r.value
          or lower(trim(coalesce(a.username, ''))) = lower(r.value)
        )
      order by
        case
          when a.id::text = r.value then 1
          when a.staff_id::text = r.value then 2
          else 3
        end,
        coalesce(a.updated_at, a.created_at) desc nulls last
      limit 1
    )
  );
$$;

create or replace function public.dawaa_can_view_staff_accounts_strict()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, false) = true
      and coalesce(a.can_login, false) = true
      and (
        lower(coalesce(a.role, '')) in (
          'admin','general_manager','executive_manager','branches_manager','branch_manager',
          'مدير عام','المدير العام','مدير الفروع','مدير فرع'
        )
        or coalesce((a.permissions ->> 'view_staff_accounts')::boolean, false)
        or coalesce((a.permissions ->> 'manage_staff_accounts')::boolean, false)
        or coalesce((a.permissions ->> 'can_manage_permissions')::boolean, false)
      )
  );
$$;

grant execute on function public.dawaa_request_staff_identifier() to anon, authenticated;
grant execute on function public.dawaa_current_staff_account_id_strict() to anon, authenticated;
grant execute on function public.dawaa_can_view_staff_accounts_strict() to anon, authenticated;
