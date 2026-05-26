alter table if exists public.sales_invoices
  add column if not exists customer_link_status text,
  add column if not exists import_validation_status text,
  add column if not exists import_warning text,
  add column if not exists source_row_number integer,
  add column if not exists raw_data jsonb,
  add column if not exists import_batch text;

alter table if exists public.customer_requests
  add column if not exists moved_to_shortage_at timestamptz,
  add column if not exists shortage_item_id uuid;

alter table if exists public.shortage_items
  add column if not exists source_customer_request_id uuid,
  add column if not exists source_customer_name text,
  add column if not exists source_customer_code text,
  add column if not exists source_customer_phone text,
  add column if not exists source_request_status text,
  add column if not exists source_request_details jsonb default '{}'::jsonb,
  add column if not exists moved_from_customer_request_at timestamptz,
  add column if not exists returned_to_customer_request_at timestamptz;

do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_invoices' and column_name = 'import_batch') then
      execute 'create index if not exists idx_sales_invoices_import_batch on public.sales_invoices(import_batch)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_invoices' and column_name = 'invoice_date') then
      execute 'create index if not exists idx_sales_invoices_invoice_date on public.sales_invoices(invoice_date)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_invoices' and column_name = 'customer_code') then
      execute 'create index if not exists idx_sales_invoices_customer_code on public.sales_invoices(customer_code)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_invoices' and column_name = 'customer_phone') then
      execute 'create index if not exists idx_sales_invoices_customer_phone on public.sales_invoices(customer_phone)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_invoices' and column_name = 'customer_name') then
      execute 'create index if not exists idx_sales_invoices_customer_name on public.sales_invoices(customer_name)';
    end if;
  end if;

  if to_regclass('public.customer_requests') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_requests' and column_name = 'shortage_item_id') then
    execute 'create index if not exists idx_customer_requests_shortage_item_id on public.customer_requests(shortage_item_id)';
  end if;

  if to_regclass('public.shortage_items') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shortage_items' and column_name = 'source_customer_request_id') then
      execute 'create index if not exists idx_shortage_items_source_customer_request_id on public.shortage_items(source_customer_request_id)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shortage_items' and column_name = 'source_customer_code') then
      execute 'create index if not exists idx_shortage_items_source_customer_code on public.shortage_items(source_customer_code)';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
