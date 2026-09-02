create or replace function public.list_base44_pending_invoice_reviews_v1(p_limit integer default 100)
returns table(
  id uuid,
  base44_id text,
  system_invoice_number text,
  branch text,
  transaction_type text,
  entered_by_raw text,
  entered_by_staff_id uuid,
  entered_by_staff_name text,
  match_status text,
  invoice_date date,
  total_value numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_is_customer_service_evaluator_v1(
    public.dawaa_current_staff_subject_uuid_v1(),
    lower(trim(coalesce(v_account.role, '')))
  ) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  return query
    select b.id, b.base44_id, b.system_invoice_number, b.branch, b.transaction_type,
           b.entered_by_raw, b.entered_by_staff_id, s.name, b.match_status, b.invoice_date, b.total_value
    from public.base44_purchase_invoice_sync b
    left join public.staff s on s.id = b.entered_by_staff_id
    where b.review_id is null
    order by b.invoice_date desc nulls last, b.synced_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$$;

create or replace function public.list_purchase_invoice_entry_reviews_v1(
  p_staff_id uuid default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  staff_id uuid,
  staff_name text,
  branch text,
  invoice_reference text,
  outcome text,
  points numeric,
  notes text,
  review_date date,
  reviewed_by_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_is_customer_service_evaluator_v1(
    public.dawaa_current_staff_subject_uuid_v1(),
    lower(trim(coalesce(v_account.role, '')))
  ) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  return query
    select r.id, r.staff_id, s.name, r.branch, r.invoice_reference, r.outcome,
           r.points, r.notes, r.review_date, r.reviewed_by_name
    from public.purchase_invoice_entry_reviews r
    join public.staff s on s.id = r.staff_id
    where p_staff_id is null or r.staff_id = p_staff_id
    order by r.review_date desc, r.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;
