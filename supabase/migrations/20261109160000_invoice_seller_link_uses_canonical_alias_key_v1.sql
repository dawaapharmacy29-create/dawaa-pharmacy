-- staff_identity_aliases.normalized_alias is written by dawaa_normalize_staff_alias_v1, but invoice
-- linking looked it up with the older dawaa_normalize_staff_alias, which strips the "د " inside
-- «احمد عاطف» and «محمد علي». 55 of 131 active aliases could therefore never match an invoice.
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
  where a.active and a.normalized_alias = public.dawaa_normalize_staff_alias_v1(new.seller_name);
  if v_staff is not null then
    new.staff_id := v_staff;
  end if;
  return new;
end;
$function$;

create or replace function public.dawaa_backfill_invoice_staff_links_v1(p_start_date date default null, p_end_date date default null)
returns integer
language plpgsql
security definer
set search_path = 'public', 'auth', 'extensions', 'pg_temp'
as $function$
declare
  v_rows integer := 0;
begin
  update public.sales_invoices si
  set
    staff_id = a.staff_id::text,
    updated_at = now()
  from public.staff_identity_aliases a
  where coalesce(si.staff_id, '') = ''
    and si.seller_name is not null
    and a.active = true
    and a.normalized_alias = public.dawaa_normalize_staff_alias_v1(si.seller_name)
    and (p_start_date is null or si.invoice_date >= p_start_date)
    and (p_end_date is null or si.invoice_date <= p_end_date);

  get diagnostics v_rows = row_count;
  return coalesce(v_rows, 0);
end;
$function$;

select public.dawaa_backfill_invoice_staff_links_v1('2026-10-26'::date, null);
