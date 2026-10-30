-- Synthetic isolated fixture; reuses the weekly count fixture (no production IDs).
\ir branch_inventory_weekly_counts_v1.fixture.sql
create table public.customer_requests(id uuid primary key default gen_random_uuid(), branch text, customer_name text,
 medicine_name text, status text, created_at timestamptz);
create table public.sales_invoices(id uuid primary key default gen_random_uuid(), branch text, invoice_date timestamptz,
 invoice_number text, invoice_no text, customer_code text, customer_name text, name text, seller_name text,
 net_amount numeric, net_total numeric, amount numeric, gross_amount numeric, gross_total numeric, discount_amount numeric);
create table public.purchase_invoices(id uuid primary key default gen_random_uuid(), branch text, invoice_date date,
 system_invoice_number text, supplier_invoice_number text, total_value numeric, reviewed_at timestamptz);

insert into public.customer_requests (branch, customer_name, medicine_name, status, created_at) values
  ('فرع شكري', 'عميل 1', 'دواء 1', 'new', now() - interval '3 days'),
  ('فرع شكري', 'عميل 2', 'دواء 2', 'available', now() - interval '2 days'),
  ('فرع شكري', 'عميل 3', 'دواء 3', 'new', now() - interval '2 hours'),
  ('فرع شكري', 'عميل 4', 'دواء 4', 'new', now() - interval '45 days'),
  ('فرع شكري', 'عميل 5', 'دواء 5', 'delivered', now() - interval '3 days'),
  ('فرع الشامي', 'عميل 6', 'دواء 6', 'new', now() - interval '3 days');
-- Latest imported Shokry sales day = two days ago.
insert into public.sales_invoices (branch, invoice_date, invoice_number, customer_code, customer_name, seller_name,
  net_amount, gross_amount, discount_amount) values
  ('فرع شكري', current_date - 2, 'S1', '', 'عميل أ', 'د أحمد', 650, 700, 50),
  ('فرع شكري', current_date - 2, 'S2', null, 'عميل ب', 'د أحمد', 100, 100, 0),
  ('فرع شكري', current_date - 2, 'S3', 'C3', 'عميل ج', 'د سارة', 80, 100, 20),
  ('فرع شكري', current_date - 3, 'S4', '', 'عميل د', 'د سارة', 900, 900, 0),
  ('فرع الشامي', current_date - 1, 'S5', '', 'عميل هـ', 'د منى', 600, 600, 0);
insert into public.purchase_invoices (branch, invoice_date, system_invoice_number, total_value, reviewed_at) values
  ('فرع شكري', current_date - 3, 'P1', 1000, null),
  ('فرع شكري', current_date - 3, 'P2', 500, now()),
  ('فرع شكري', current_date - 4, 'P3', 700, null);
