-- Dawaa Pharmacy 2027
-- Production-safe import/customer matching patch.
-- Idempotent: do not drop or rewrite existing data.

do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    alter table public.sales_invoices add column if not exists customer_link_status text;
    alter table public.sales_invoices add column if not exists import_validation_status text;
    alter table public.sales_invoices add column if not exists import_warning text;
    alter table public.sales_invoices add column if not exists source_row_number integer;
    alter table public.sales_invoices add column if not exists raw_data jsonb;
    alter table public.sales_invoices add column if not exists import_batch text;
  end if;

  if to_regclass('public.customer_requests') is not null then
    alter table public.customer_requests add column if not exists item_image_url text;
    alter table public.customer_requests add column if not exists item_image_path text;
    alter table public.customer_requests add column if not exists requested_at timestamptz default now();
    alter table public.customer_requests add column if not exists needed_by_date date;
    alter table public.customer_requests add column if not exists expected_fulfillment_days integer;
    alter table public.customer_requests add column if not exists potential_source_id uuid;
    alter table public.customer_requests add column if not exists potential_source_text text;
    alter table public.customer_requests add column if not exists purchasing_received_by_name text;
    alter table public.customer_requests add column if not exists searching_by_name text;
    alter table public.customer_requests add column if not exists provided_by_name text;
    alter table public.customer_requests add column if not exists customer_contacted_by_name text;
    alter table public.customer_requests add column if not exists delivered_by_name text;
    alter table public.customer_requests add column if not exists unavailable_since timestamptz;
    alter table public.customer_requests add column if not exists shortage_item_id uuid;
  end if;

  if to_regclass('public.offers') is not null then
    alter table public.offers add column if not exists created_by_name text;
  end if;
end $$;

do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    create index if not exists idx_sales_invoices_import_batch on public.sales_invoices(import_batch);
    create index if not exists idx_sales_invoices_invoice_date on public.sales_invoices(invoice_date);
    create index if not exists idx_sales_invoices_customer_code on public.sales_invoices(customer_code);
    create index if not exists idx_sales_invoices_customer_phone on public.sales_invoices(customer_phone);
    create index if not exists idx_sales_invoices_customer_name on public.sales_invoices(customer_name);
  end if;

  if to_regclass('public.customers') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'customer_code') then
      create index if not exists idx_customers_customer_code on public.customers(customer_code);
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'phone') then
      create index if not exists idx_customers_phone on public.customers(phone);
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'name') then
      create index if not exists idx_customers_name on public.customers(name);
    end if;
  end if;

  if to_regclass('public.customer_requests') is not null then
    create index if not exists idx_customer_requests_customer_code on public.customer_requests(customer_code);
    create index if not exists idx_customer_requests_customer_phone on public.customer_requests(customer_phone);
    create index if not exists idx_customer_requests_needed_by_date on public.customer_requests(needed_by_date);
  end if;
end $$;

notify pgrst, 'reload schema';
