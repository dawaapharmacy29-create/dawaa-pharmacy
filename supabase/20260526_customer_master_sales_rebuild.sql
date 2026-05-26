-- Dawaa Pharmacy 2027
-- Canonical customer/sales link repair. Safe and idempotent.

alter table if exists public.sales_invoices
  add column if not exists customer_id uuid null,
  add column if not exists customer_link_status text null,
  add column if not exists import_validation_status text null,
  add column if not exists import_warning text null,
  add column if not exists source_row_number integer null,
  add column if not exists raw_data jsonb null,
  add column if not exists import_batch text null;

alter table if exists public.customers
  add column if not exists total_spent numeric default 0,
  add column if not exists invoices_count integer default 0,
  add column if not exists avg_invoice numeric default 0,
  add column if not exists avg_monthly numeric default 0,
  add column if not exists first_purchase date null,
  add column if not exists last_purchase date null,
  add column if not exists last_order_date date null,
  add column if not exists segment text default 'عادي',
  add column if not exists status text default 'بدون شراء',
  add column if not exists priority text default 'عادية',
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_sales_invoices_customer_id on public.sales_invoices(customer_id);
create index if not exists idx_sales_invoices_customer_code on public.sales_invoices(customer_code);
create index if not exists idx_sales_invoices_customer_phone on public.sales_invoices(customer_phone);
create index if not exists idx_sales_invoices_invoice_date on public.sales_invoices(invoice_date);
create index if not exists idx_sales_invoices_import_batch on public.sales_invoices(import_batch);
create index if not exists idx_customers_customer_code on public.customers(customer_code);
create index if not exists idx_customers_phone on public.customers(phone);
create index if not exists idx_customers_name on public.customers(name);

alter table if exists public.customer_analysis
  add column if not exists customer_code text,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists branch text,
  add column if not exists total_invoices integer default 0,
  add column if not exists total_spent numeric default 0,
  add column if not exists avg_invoice numeric default 0,
  add column if not exists avg_monthly numeric default 0,
  add column if not exists first_purchase date null,
  add column if not exists last_purchase date null,
  add column if not exists days_inactive integer null,
  add column if not exists segment text,
  add column if not exists status text,
  add column if not exists priority text,
  add column if not exists updated_at timestamptz default now();

create or replace function public.dawaa_segment_ar(total_spent numeric, avg_monthly numeric)
returns text
language sql
immutable
as $$
  select case
    when coalesce(total_spent, 0) >= 20000 or coalesce(avg_monthly, 0) >= 5000 then 'مهم جدًا'
    when coalesce(total_spent, 0) >= 10000 or coalesce(avg_monthly, 0) >= 2500 then 'مهم'
    when coalesce(total_spent, 0) >= 3000 or coalesce(avg_monthly, 0) >= 800 then 'متوسط'
    else 'عادي'
  end
$$;

create or replace function public.dawaa_status_ar(first_purchase date, last_purchase date)
returns text
language sql
stable
as $$
  select case
    when last_purchase is null then 'بدون شراء'
    when first_purchase >= current_date - interval '14 days' then 'جديد'
    when last_purchase >= current_date - interval '30 days' then 'نشط'
    when last_purchase >= current_date - interval '60 days' then 'محتفظ'
    when last_purchase >= current_date - interval '90 days' then 'معرض للفقدان'
    else 'مفقود'
  end
$$;

create or replace function public.dawaa_priority_ar(segment text, status text)
returns text
language sql
immutable
as $$
  select case
    when segment = 'مهم جدًا' then 'عالية'
    when segment = 'مهم' and status in ('مفقود', 'معرض للفقدان') then 'عالية'
    when segment in ('مهم', 'متوسط') or status in ('مفقود', 'معرض للفقدان') then 'متوسطة'
    else 'عادية'
  end
$$;

create or replace function public.rebuild_customer_analysis()
returns jsonb
language plpgsql
as $$
declare
  updated_customers integer := 0;
  linked_by_code integer := 0;
  linked_by_phone integer := 0;
begin
  update public.sales_invoices si
  set customer_id = c.id,
      customer_link_status = coalesce(si.customer_link_status, 'matched_by_customer_code')
  from public.customers c
  where si.customer_id is distinct from c.id
    and nullif(trim(si.customer_code), '') is not null
    and si.customer_code = c.customer_code
    and (
      nullif(trim(coalesce(si.branch, '')), '') is null
      or nullif(trim(coalesce(c.branch, '')), '') is null
      or si.branch = c.branch
    );
  get diagnostics linked_by_code = row_count;

  update public.sales_invoices si
  set customer_id = c.id,
      customer_link_status = coalesce(si.customer_link_status, 'matched_by_phone')
  from public.customers c
  where si.customer_id is null
    and nullif(regexp_replace(coalesce(si.customer_phone, ''), '\D', '', 'g'), '') is not null
    and right(regexp_replace(coalesce(si.customer_phone, ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(c.phone, c.whatsapp_phone, c.phone_alt, ''), '\D', '', 'g'), 10);
  get diagnostics linked_by_phone = row_count;

  with invoice_stats as (
    select
      c.id as customer_id,
      count(si.*)::integer as invoices_count,
      coalesce(sum(coalesce(si.net_amount, si.amount, si.gross_amount, 0)), 0)::numeric as total_spent,
      coalesce(avg(coalesce(si.net_amount, si.amount, si.gross_amount, 0)), 0)::numeric as avg_invoice,
      min(si.invoice_date)::date as first_purchase,
      max(si.invoice_date)::date as last_purchase
    from public.customers c
    left join public.sales_invoices si
      on si.customer_id = c.id
      or (
        nullif(trim(si.customer_code), '') is not null
        and si.customer_code = c.customer_code
        and (
          nullif(trim(coalesce(si.branch, '')), '') is null
          or nullif(trim(coalesce(c.branch, '')), '') is null
          or si.branch = c.branch
        )
      )
    group by c.id
  ),
  computed as (
    select
      customer_id,
      invoices_count,
      total_spent,
      avg_invoice,
      first_purchase,
      last_purchase,
      case
        when invoices_count = 0 then 0::numeric
        else total_spent / greatest(
          1,
          ((extract(year from age(coalesce(last_purchase, current_date), coalesce(first_purchase, current_date)))::int * 12)
          + extract(month from age(coalesce(last_purchase, current_date), coalesce(first_purchase, current_date)))::int
          + 1)
        )
      end as avg_monthly
    from invoice_stats
  )
  update public.customers c
  set
    total_spent = computed.total_spent,
    invoices_count = computed.invoices_count,
    avg_invoice = computed.avg_invoice,
    avg_monthly = computed.avg_monthly,
    first_purchase = computed.first_purchase,
    last_purchase = computed.last_purchase,
    last_order_date = computed.last_purchase,
    segment = public.dawaa_segment_ar(computed.total_spent, computed.avg_monthly),
    status = public.dawaa_status_ar(computed.first_purchase, computed.last_purchase),
    priority = public.dawaa_priority_ar(
      public.dawaa_segment_ar(computed.total_spent, computed.avg_monthly),
      public.dawaa_status_ar(computed.first_purchase, computed.last_purchase)
    ),
    updated_at = now()
  from computed
  where c.id = computed.customer_id;
  get diagnostics updated_customers = row_count;

  if to_regclass('public.customer_analysis') is not null then
    update public.customer_analysis ca
    set
      name = c.name,
      phone = c.phone,
      branch = c.branch,
      total_invoices = c.invoices_count,
      total_spent = c.total_spent,
      avg_invoice = c.avg_invoice,
      avg_monthly = c.avg_monthly,
      first_purchase = c.first_purchase,
      last_purchase = c.last_purchase,
      days_inactive = case when c.last_purchase is null then null else (current_date - c.last_purchase)::integer end,
      segment = c.segment,
      status = c.status,
      priority = c.priority,
      updated_at = now()
    from public.customers c
    where ca.customer_code = c.customer_code
      and nullif(trim(coalesce(c.customer_code, '')), '') is not null;

    insert into public.customer_analysis (
      customer_code, name, phone, branch, total_invoices, total_spent,
      avg_invoice, avg_monthly, first_purchase, last_purchase,
      days_inactive, segment, status, priority, updated_at
    )
    select
      c.customer_code,
      c.name,
      c.phone,
      c.branch,
      c.invoices_count,
      c.total_spent,
      c.avg_invoice,
      c.avg_monthly,
      c.first_purchase,
      c.last_purchase,
      case when c.last_purchase is null then null else (current_date - c.last_purchase)::integer end,
      c.segment,
      c.status,
      c.priority,
      now()
    from public.customers c
    where nullif(trim(coalesce(c.customer_code, '')), '') is not null
      and not exists (
        select 1
        from public.customer_analysis ca
        where ca.customer_code = c.customer_code
      );
  end if;

  perform pg_notify('pgrst', 'reload schema');

  return jsonb_build_object(
    'updated_customers', updated_customers,
    'linked_by_code', linked_by_code,
    'linked_by_phone', linked_by_phone
  );
end;
$$;

select public.rebuild_customer_analysis();
notify pgrst, 'reload schema';
