-- Invoices imported from BConnect arrive with the seller's name but no staff_id. Linking only ran
-- when someone called the backfill by hand, so batch bconnect-20261109-7to9 stayed unlinked and its
-- list/stagnant units were not credited. Link at write time, from the same alias table.
create or replace function public.dawaa_fill_invoice_staff_from_alias_v1()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_staff text;
begin
  if coalesce(new.staff_id, '') <> '' or nullif(btrim(new.seller_name), '') is null then
    return new;
  end if;
  -- An alias shared by two employees stays unlinked rather than crediting the wrong one.
  select case when count(distinct a.staff_id) = 1 then min(a.staff_id::text) end
    into v_staff
  from public.staff_identity_aliases a
  where a.active and a.normalized_alias = public.dawaa_normalize_staff_alias(new.seller_name);
  if v_staff is not null then
    new.staff_id := v_staff;
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_fill_invoice_staff_from_alias_v1() from public, anon, authenticated;

drop trigger if exists trg_fill_invoice_staff_from_alias_v1 on public.sales_invoices;
create trigger trg_fill_invoice_staff_from_alias_v1
before insert or update of seller_name on public.sales_invoices
for each row execute function public.dawaa_fill_invoice_staff_from_alias_v1();

-- «د احمد عاطف» is already linked on 116 recent invoices to this one employee, but has no alias.
insert into public.staff_identity_aliases (staff_id, alias_name, normalized_alias, source, confidence, active, created_by)
select '3ddad407-23e1-44dc-b6c7-24373cee838f'::uuid, 'د احمد عاطف', public.dawaa_normalize_staff_alias('د احمد عاطف'), 'manual', 1, true, 'migration:20261109150000'
where not exists (
  select 1 from public.staff_identity_aliases
  where active and normalized_alias = public.dawaa_normalize_staff_alias('د احمد عاطف')
);

select public.dawaa_backfill_invoice_staff_links_v1('2026-10-26'::date, null);

-- Day-by-day facts for the competition design pack. Reads the canonical sales view, which already
-- drops the excluded customer codes, with the caller's own RLS.
create or replace function public.get_doctor_competition_design_pack_v1(p_start date, p_end date, p_branch text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  v_sales jsonb;
  v_hours jsonb;
  v_requests jsonb;
  v_last_sale date;
  v_last_import timestamptz;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 100 then
    raise exception 'design_pack_invalid_range' using errcode = '22023';
  end if;
  if v_branch in ('الكل', 'كل الفروع') then
    v_branch := null;
  end if;

  with base as (
    select v.sale_date as sale_day,
           coalesce(nullif(btrim(v.branch), ''), 'غير محدد') as branch,
           coalesce(nullif(btrim(v.seller_name), ''), nullif(btrim(v.staff_name), ''), nullif(btrim(v.normalized_seller_name), '')) as seller,
           nullif(v.staff_id, '') as staff_id,
           coalesce(nullif(v.net_total, 0), nullif(v.net_amount, 0), nullif(v.discounted_amount, 0), nullif(v.total_amount, 0), nullif(v.amount, 0), 0)::numeric as amount
    from public.dawaa_sales_invoices_dashboard_v1 v
    where v.invoice_date >= p_start and v.invoice_date < (p_end + 1)::timestamp
      and (v_branch is null or v.branch = v_branch)
  ), grouped as (
    select b.sale_day, b.branch, b.seller, b.staff_id, sum(b.amount) as sales, count(*) as invoices
    from base b
    where b.seller ~ '^\s*د([/\.\s]|$)'
    group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', g.sale_day, 'branch', g.branch, 'seller', g.seller, 'staff_id', g.staff_id,
           'sales', round(g.sales, 2), 'invoices', g.invoices)), '[]'::jsonb)
    into v_sales
  from grouped g;

  select coalesce(jsonb_agg(jsonb_build_object('day', h.sale_day, 'branch', h.branch, 'hour', h.sale_hour, 'invoices', h.invoices)), '[]'::jsonb)
    into v_hours
  from (
    select v.sale_date as sale_day,
           coalesce(nullif(btrim(v.branch), ''), 'غير محدد') as branch,
           extract(hour from v.invoice_datetime at time zone 'Africa/Cairo')::int as sale_hour,
           count(*) as invoices
    from public.dawaa_sales_invoices_dashboard_v1 v
    where v.invoice_date >= p_start and v.invoice_date < (p_end + 1)::timestamp
      and v.invoice_datetime is not null
      and (v_branch is null or v.branch = v_branch)
    group by 1, 2, 3
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object('day', q.request_day, 'branch', q.branch, 'staff_id', q.staff_id, 'name', q.staff_name,
           'requests', q.requests, 'fulfilled', q.fulfilled)), '[]'::jsonb)
    into v_requests
  from (
    select (r.created_at at time zone 'Africa/Cairo')::date as request_day,
           r.branch,
           r.primary_responsible_id::text as staff_id,
           r.primary_responsible_name as staff_name,
           count(*) as requests,
           count(*) filter (where r.status in ('delivered', 'available')) as fulfilled
    from public.customer_requests r
    where r.created_at >= (p_start::timestamp at time zone 'Africa/Cairo')
      and r.created_at < ((p_end + 1)::timestamp at time zone 'Africa/Cairo')
      and coalesce(r.status, '') <> 'cancelled'
      and (v_branch is null or public.dawaa_customer_request_branch_key(r.branch) = public.dawaa_customer_request_branch_key(v_branch))
    group by 1, 2, 3, 4
  ) q;

  select max(v.sale_date), max(v.created_at)
    into v_last_sale, v_last_import
  from public.dawaa_sales_invoices_dashboard_v1 v
  where v.invoice_date >= p_start and v.invoice_date < (p_end + 1)::timestamp
    and (v_branch is null or v.branch = v_branch);

  return jsonb_build_object('sales', v_sales, 'hours', v_hours, 'requests', v_requests,
    'last_sale_date', v_last_sale, 'last_import_at', v_last_import);
end;
$function$;

revoke all on function public.get_doctor_competition_design_pack_v1(date, date, text) from public;
grant execute on function public.get_doctor_competition_design_pack_v1(date, date, text) to anon, authenticated, service_role;
