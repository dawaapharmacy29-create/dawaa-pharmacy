-- Complete RLS fix for staff_accounts, user_permissions, and roles.
-- The app uses custom staff_account_login RPC (NOT Supabase Auth),
-- so auth.uid() is always NULL. We apply the same open policy approach
-- used in 20240521_app_linking_rls_repair.sql for other tables.
-- Date: 2024-05-23

do $$
declare
  t text;
  p text;
begin
  foreach t in array array['staff_accounts', 'user_permissions', 'roles'] loop
    if to_regclass('public.' || t) is null then continue; end if;

    -- Drop every known policy name (from all previous migrations)
    foreach p in array array[
      t || '_client_read', t || '_client_write',
      'Allow anon read ' || t, 'Allow anon insert ' || t,
      'Allow anon update ' || t, 'Allow anon delete ' || t,
      t || '_select_authenticated', t || '_insert_admin',
      t || '_update_admin', t || '_delete_admin',
      'staff_accounts_select_authenticated', 'staff_accounts_insert_admin',
      'staff_accounts_update_admin', 'staff_accounts_delete_admin',
      'user_permissions_select_authenticated', 'user_permissions_write_admin',
      'roles_select_authenticated', 'roles_write_admin'
    ] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_open_read', t
    );
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_open_write', t
    );
    execute format(
      'grant select, insert, update, delete on public.%I to anon, authenticated',
      t
    );
  end loop;
end $$;

-- Also fix any remaining conflicting policies from 20240520_staff_accounts_rls_fix.sql
drop policy if exists "staff_accounts_select_authenticated" on public.staff_accounts;
drop policy if exists "staff_accounts_insert_admin" on public.staff_accounts;
drop policy if exists "staff_accounts_update_admin" on public.staff_accounts;
drop policy if exists "staff_accounts_delete_admin" on public.staff_accounts;

-- user_permissions also needs the unique constraint for upsert
create unique index if not exists user_permissions_user_perm_unique_idx
  on public.user_permissions (user_id, permission_key);
