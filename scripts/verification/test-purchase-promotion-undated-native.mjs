// Native PostgreSQL check for 20261027170000_purchase_promotion_skip_undated_v1.
// Production-shaped tables (column types, NOT NULLs and unique indexes copied from
// production), synthetic rows only, local network-isolated container.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'purchase_promotion_undated';
const migration = readFileSync('supabase/migrations/20261027170000_purchase_promotion_skip_undated_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}
const check = (label, fn) => { fn(); console.log('PASS ' + label); };

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create table public.purchase_suppliers(id uuid primary key default gen_random_uuid(), name text not null, base44_id text);
  create unique index uq_purchase_suppliers_base44_id on public.purchase_suppliers(base44_id) where base44_id is not null;
  create table public.base44_purchase_invoice_sync(
    id uuid primary key default gen_random_uuid(), base44_id text not null unique, system_invoice_number text,
    supplier_invoice_number text, branch text, transaction_type text, entered_by_staff_id uuid, match_status text not null,
    invoice_date date, total_value numeric, synced_at timestamptz not null default now(), base44_supplier_id text,
    purchase_category text, source_branch text, destination_branch text, cash_amount numeric, payment_type text,
    notes text, transfer_authorization_number text);
  create table public.purchase_invoices(
    id uuid primary key default gen_random_uuid(), system_invoice_number text not null, supplier_invoice_number text,
    transfer_authorization_number text, supplier_id uuid, branch text not null, entered_by_staff_id uuid not null,
    invoice_date date not null default current_date, total_value numeric not null default 0,
    cash_amount numeric not null default 0, payment_type text, notes text,
    purchase_category text not null default 'unclassified', purchase_category_source text not null default 'manual',
    transaction_type text not null default 'external_purchase', source_branch text, destination_branch text,
    updated_at timestamptz not null default now(), base44_id text);
  create unique index uq_purchase_invoices_base44_id on public.purchase_invoices(base44_id) where base44_id is not null;
  create unique index purchase_invoices_branch_system_invoice_number_key on public.purchase_invoices(branch, system_invoice_number);
  insert into public.base44_purchase_invoice_sync(base44_id, system_invoice_number, supplier_invoice_number, branch, entered_by_staff_id, match_status, invoice_date, total_value) values
    ('b-1','1001','S1','فرع شكري','00000000-0000-4000-8000-000000000001','matched','2026-10-20',100),
    ('b-2','1002','S2','فرع الشامي','00000000-0000-4000-8000-000000000001','matched','2026-10-21',200),
    ('b-3','11606','*90102','فرع الشامي','00000000-0000-4000-8000-000000000001','matched',null,156.45),
    ('b-4','1004','S4','فرع شكري','00000000-0000-4000-8000-000000000001','unmatched','2026-10-22',400);
  -- The production body before this migration (undated rows not filtered).
  create function public.promote_matched_purchase_invoices_v1() returns integer language plpgsql as $f$
  declare v int; begin
    insert into public.purchase_invoices(base44_id, system_invoice_number, supplier_invoice_number, branch, entered_by_staff_id, invoice_date, total_value)
    select s.base44_id, s.system_invoice_number, s.supplier_invoice_number, s.branch, s.entered_by_staff_id, s.invoice_date, coalesce(s.total_value,0)
    from public.base44_purchase_invoice_sync s where s.match_status='matched' and s.entered_by_staff_id is not null
      and s.base44_id is not null and s.system_invoice_number is not null and s.branch is not null
    on conflict (base44_id) where base44_id is not null do nothing;
    get diagnostics v = row_count; return v; end $f$;
`);

check('before the fix one undated row fails the whole batch', () => {
  assert.throws(() => sql('select public.promote_matched_purchase_invoices_v1()'), /invoice_date/);
  assert.equal(sql('select count(*) from public.purchase_invoices'), '0');
});
sql(migration);
check('after the fix the dated matched invoices are promoted, the undated one is left', () => {
  assert.equal(sql('select public.promote_matched_purchase_invoices_v1()'), '2');
  assert.equal(sql(`select string_agg(system_invoice_number||':'||total_value||':'||invoice_date, ',' order by system_invoice_number) from public.purchase_invoices`), '1001:100:2026-10-20,1002:200:2026-10-21');
});
check('re-running is a no-op (no duplicate or rewritten invoices)', () => {
  assert.equal(sql('select public.promote_matched_purchase_invoices_v1()'), '0');
  assert.equal(sql('select count(*) from public.purchase_invoices'), '2');
});
check('once the source row is dated it is promoted with that date', () => {
  sql(`update public.base44_purchase_invoice_sync set invoice_date='2026-10-21' where base44_id='b-3'`);
  assert.equal(sql('select public.promote_matched_purchase_invoices_v1()'), '1');
  assert.equal(sql(`select invoice_date||':'||total_value from public.purchase_invoices where system_invoice_number='11606'`), '2026-10-21:156.45');
});
check('browser roles can no longer run the SECURITY DEFINER writer', () => {
  assert.equal(sql(`select has_function_privilege('anon','public.promote_matched_purchase_invoices_v1()','execute')::text||has_function_privilege('authenticated','public.promote_matched_purchase_invoices_v1()','execute')::text||has_function_privilege('service_role','public.promote_matched_purchase_invoices_v1()','execute')::text`), 'falsefalsetrue');
});
sql(`drop database ${db} with (force)`, 'postgres');
console.log('PASS: purchase promotion skips undated rows (5 checks)');
