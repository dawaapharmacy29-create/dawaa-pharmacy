create index if not exists idx_sales_invoices_missing_staff_seller_date_v1
on public.sales_invoices (seller_name, invoice_date desc)
where coalesce(btrim(staff_id),'')='';

drop index if exists public.idx_sales_invoices_missing_staff_seller_v1;
drop index if exists public.idx_sales_invoices_missing_staff_norm_seller_v1;

create or replace function public.get_staff_invoice_health_read_v1(p_staff_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
with params as (
  select (current_date - 120)::date scope_start
), staff_row as (
  select s.id, s.name
  from public.staff s
  where s.id = p_staff_id
  limit 1
), raw_aliases as materialized (
  select sr.name as raw_name from staff_row sr
  union
  select a.alias_name
  from public.staff_identity_aliases a
  where a.staff_id = p_staff_id and coalesce(a.active,true)
), matched as materialized (
  select si.id, si.staff_id, si.seller_name, si.customer_name, si.customer_code,
         si.customer_phone, si.phone, si.customer_segment
  from public.sales_invoices si cross join params p
  where si.invoice_date >= p.scope_start and si.staff_id = p_staff_id::text
  union
  select si.id, si.staff_id, si.seller_name, si.customer_name, si.customer_code,
         si.customer_phone, si.phone, si.customer_segment
  from public.sales_invoices si cross join params p
  where si.invoice_date >= p.scope_start
    and coalesce(btrim(si.staff_id),'')=''
    and si.seller_name in (
      select raw_name from raw_aliases where coalesce(btrim(raw_name),'')<>''
    )
), seller_names as (
  select coalesce(nullif(btrim(m.seller_name),''),'غير محدد') seller_name,
         count(*)::bigint invoices
  from matched m
  group by 1
), stats as (
  select
    count(*)::bigint invoices_count,
    count(*) filter (where coalesce(btrim(staff_id),'')='')::bigint missing_staff_id,
    count(*) filter (where customer_name is null or customer_code is null)::bigint missing_customer_data,
    count(*) filter (
      where coalesce(regexp_replace(coalesce(customer_phone,phone,''),'[^0-9]','','g'),'') !~ '^01[0125][0-9]{8}$'
    )::bigint invalid_phone_rows,
    count(distinct coalesce(nullif(btrim(customer_code),''),nullif(btrim(customer_name),''))) filter (
      where coalesce(regexp_replace(coalesce(customer_phone,phone,''),'[^0-9]','','g'),'') !~ '^01[0125][0-9]{8}$'
    )::bigint customers_missing_valid_phone,
    count(*) filter (where coalesce(btrim(customer_segment),'')='')::bigint missing_classification
  from matched
), seller_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('sellerName', seller_name, 'invoices', invoices)
      order by invoices desc
    ),
    '[]'::jsonb
  ) names
  from seller_names
), mismatch as (
  select coalesce(sum(sn.invoices),0)::bigint mismatched_invoice_names
  from seller_names sn cross join staff_row sr
  where public.normalize_cs_identity_name(sn.seller_name) <>
        public.normalize_cs_identity_name(sr.name)
)
select jsonb_build_object(
  'scopeStart',(select scope_start from params),
  'staffName',(select name from staff_row),
  'invoicesCount',s.invoices_count,
  'missingStaffId',s.missing_staff_id,
  'missingCustomerData',s.missing_customer_data,
  'invalidPhoneRows',s.invalid_phone_rows,
  'customersMissingValidPhone',s.customers_missing_valid_phone,
  'missingClassification',s.missing_classification,
  'mismatchedInvoiceNames',mm.mismatched_invoice_names,
  'sellerNames',sj.names
)
from stats s cross join seller_json sj cross join mismatch mm;
$function$;
