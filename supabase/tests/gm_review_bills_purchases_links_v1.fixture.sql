-- Synthetic isolated fixture; reuses the anon session grants fixture (no production IDs).
\ir base44_reports_anon_session_grants_v1.fixture.sql

-- Production: the DawaaWael purchase invoices copied by base44-purchase-invoice-sync.
create table public.base44_purchase_invoice_sync(base44_id text primary key, branch text, invoice_date date,
  total_value numeric, base44_status text);
insert into public.base44_purchase_invoice_sync values
  ('p-1', 'فرع شكري', (now() at time zone 'Africa/Cairo')::date - 1, 1500, 'انتظار المراجعة'),
  ('p-2', 'فرع شكري', (now() at time zone 'Africa/Cairo')::date - 1, 700, 'يتم الحفظ'),
  -- Entered today: not late yet.
  ('p-3', 'فرع الشامي', (now() at time zone 'Africa/Cairo')::date, 300, 'انتظار المراجعة'),
  -- Older than 45 days: out of the review.
  ('p-4', 'فرع الشامي', (now() at time zone 'Africa/Cairo')::date - 60, 900, 'انتظار المراجعة');
