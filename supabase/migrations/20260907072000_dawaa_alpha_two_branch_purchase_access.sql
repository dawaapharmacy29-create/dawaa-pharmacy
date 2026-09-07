create or replace function public.list_purchase_invoices_v1(
  p_branch text default null,
  p_status text default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  system_invoice_number text,
  supplier_invoice_number text,
  supplier_id uuid,
  supplier_name text,
  branch text,
  entered_by_staff_id uuid,
  entered_by_name text,
  invoice_date date,
  total_value numeric,
  paid_value numeric,
  cash_amount numeric,
  payment_type text,
  status text,
  transaction_type text,
  source_branch text,
  destination_branch text,
  purchase_category text,
  net_purchase_mode text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_is_reviewer boolean;
  v_is_dawaa_alpha boolean;
  v_scope_branch text;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false)
    and coalesce(can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  v_is_reviewer := public.dawaa_is_purchase_invoice_reviewer_v1(v_account.role);
  v_is_dawaa_alpha := lower(trim(coalesce(v_account.role, ''))) = 'team_dawaa_alpha';

  if not v_is_reviewer
     and not v_is_dawaa_alpha
     and not (v_subject_id is not null and public.dawaa_is_purchase_invoice_entrant_v1(v_subject_id)) then
    raise exception using errcode = '42501', message = 'purchase invoice access not enabled for this staff member';
  end if;

  v_scope_branch := case
    when lower(trim(coalesce(v_account.role, ''))) = 'branch_manager' then v_account.branch
    else null
  end;

  return query
    select pi.id, pi.system_invoice_number, pi.supplier_invoice_number, pi.supplier_id, s.name,
           pi.branch, pi.entered_by_staff_id, st.name, pi.invoice_date, pi.total_value,
           pi.paid_value, pi.cash_amount, pi.payment_type, pi.status, pi.transaction_type,
           pi.source_branch, pi.destination_branch, pi.purchase_category, pi.net_purchase_mode,
           pi.reviewed_by_name, pi.reviewed_at, pi.notes, pi.created_at
    from public.purchase_invoices pi
    left join public.purchase_suppliers s on s.id = pi.supplier_id
    left join public.staff st on st.id = pi.entered_by_staff_id
    where (p_branch is null or pi.branch = p_branch)
      and (p_status is null or pi.status = p_status)
      and (v_scope_branch is null or pi.branch = v_scope_branch)
      and (v_is_reviewer or v_is_dawaa_alpha or pi.entered_by_staff_id = v_subject_id)
    order by pi.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.list_purchase_suppliers_v1()
returns setof public.purchase_suppliers
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false)
    and coalesce(can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if lower(trim(coalesce(v_account.role, ''))) <> 'team_dawaa_alpha'
     and not public.user_has_permission(v_account.id, 'view_purchases')
     and not public.dawaa_is_purchase_invoice_reviewer_v1(v_account.role) then
    raise exception using errcode = '42501', message = 'purchase supplier access not enabled for this staff member';
  end if;

  return query
    select * from public.purchase_suppliers where active = true order by name;
end;
$$;

revoke all on function public.list_purchase_invoices_v1(text,text,integer) from public;
grant execute on function public.list_purchase_invoices_v1(text,text,integer) to anon, authenticated;
revoke all on function public.list_purchase_suppliers_v1() from public;
grant execute on function public.list_purchase_suppliers_v1() to anon, authenticated;
