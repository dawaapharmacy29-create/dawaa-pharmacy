create or replace function public.current_user_has_permission_v1(p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_permissions jsonb;
begin
  if auth.uid() is null or p_permission_key is null or btrim(p_permission_key) = '' then
    return false;
  end if;

  v_permissions := public.get_user_permissions(auth.uid());
  return coalesce((v_permissions ->> '*')::boolean, false)
      or coalesce((v_permissions ->> p_permission_key)::boolean, false);
end;
$$;

revoke all on function public.current_user_has_permission_v1(text) from public;
revoke all on function public.current_user_has_permission_v1(text) from anon;
grant execute on function public.current_user_has_permission_v1(text) to authenticated;

create or replace function public.current_user_branch_access_v1(p_branch text, p_allow_global boolean default true)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
  v_branch text;
  v_row_branch text;
  v_user_branch text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select sa.role, sa.branch
    into v_role, v_branch
  from public.staff_accounts sa
  where (sa.id = auth.uid() or sa.auth_user_id = auth.uid())
    and coalesce(sa.active, true) = true
    and coalesce(sa.is_active, true) = true
  limit 1;

  if v_role is null then
    return false;
  end if;

  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'procurement_manager') then
    return true;
  end if;

  v_row_branch := lower(btrim(regexp_replace(coalesce(p_branch, ''), '^\s*فرع\s+', '', 'i')));
  v_user_branch := lower(btrim(regexp_replace(coalesce(v_branch, ''), '^\s*فرع\s+', '', 'i')));

  if p_allow_global and v_row_branch in ('', 'كل الفروع', 'all', 'all branches') then
    return true;
  end if;

  return v_user_branch <> '' and v_row_branch = v_user_branch;
end;
$$;

revoke all on function public.current_user_branch_access_v1(text, boolean) from public;
revoke all on function public.current_user_branch_access_v1(text, boolean) from anon;
grant execute on function public.current_user_branch_access_v1(text, boolean) to authenticated;

create table if not exists public.expiry_discount_items (
  id uuid primary key default gen_random_uuid(),
  medicine_name text not null check (btrim(medicine_name) <> ''),
  branch text,
  quantity numeric not null default 1 check (quantity >= 0),
  expiry_date date not null,
  suggested_discount numeric not null default 0 check (suggested_discount between 0 and 100),
  status text not null default 'new',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expiry_discount_items enable row level security;

create index if not exists expiry_discount_items_expiry_date_idx
  on public.expiry_discount_items (expiry_date asc);
create index if not exists expiry_discount_items_branch_expiry_idx
  on public.expiry_discount_items (branch, expiry_date asc);

revoke all on table public.expiry_discount_items from anon;
grant select, insert, update on table public.expiry_discount_items to authenticated;

drop policy if exists expiry_discount_items_select_v1 on public.expiry_discount_items;
create policy expiry_discount_items_select_v1
on public.expiry_discount_items
for select
to authenticated
using (
  public.current_user_has_permission_v1('view_expiry_tracker')
  and public.current_user_branch_access_v1(branch, true)
);

drop policy if exists expiry_discount_items_insert_v1 on public.expiry_discount_items;
create policy expiry_discount_items_insert_v1
on public.expiry_discount_items
for insert
to authenticated
with check (
  public.current_user_has_permission_v1('manage_medicines')
  and public.current_user_branch_access_v1(branch, false)
);

drop policy if exists expiry_discount_items_update_v1 on public.expiry_discount_items;
create policy expiry_discount_items_update_v1
on public.expiry_discount_items
for update
to authenticated
using (
  public.current_user_has_permission_v1('manage_medicines')
  and public.current_user_branch_access_v1(branch, false)
)
with check (
  public.current_user_has_permission_v1('manage_medicines')
  and public.current_user_branch_access_v1(branch, false)
);
