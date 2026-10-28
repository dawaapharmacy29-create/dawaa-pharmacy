// Native PostgreSQL check for 20261027183000_sales_invoices_autovacuum_thresholds_v1:
// storage parameters only, idempotent, rows and definitions untouched.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'sales_invoices_autovacuum';
const migration = readFileSync('supabase/migrations/20261027183000_sales_invoices_autovacuum_thresholds_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`create table public.sales_invoices(id bigserial primary key, invoice_date timestamptz, net_total numeric);
     insert into public.sales_invoices(invoice_date, net_total) select now() - g * interval '1 hour', g from generate_series(1, 5000) g;`);
const fingerprint = () => sql(`select count(*) || ':' || md5(string_agg(id || ':' || net_total, ',' order by id)) from public.sales_invoices`);
const before = fingerprint();
sql(migration);
sql(migration);
assert.equal(
  sql(`select array_to_string(reloptions, ',') from pg_class where oid = 'public.sales_invoices'::regclass`),
  'autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_insert_scale_factor=0.02,autovacuum_analyze_scale_factor=0.02'
);
assert.equal(fingerprint(), before);
sql(`drop database ${db} with (force)`, 'postgres');
console.log('PASS: sales_invoices autovacuum thresholds set (idempotent), rows unchanged');
