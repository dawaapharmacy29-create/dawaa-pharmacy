import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(
  new URL('../../supabase/migrations/20261127200000_whatsapp_invoice_change_capture_v1.sql', import.meta.url),
  'utf8',
);
const query = (sql, values) => db.query(sql, values);
const events = async () => (await query('select * from public.whatsapp_invoice_change_events_v1 order by event_id')).rows;
const claim = async () => (await query('select * from public.claim_whatsapp_invoice_changes_v1(1)')).rows[0];
const finish = async (event, error = null, permanent = false) =>
  (await query('select public.finish_whatsapp_invoice_change_v1($1,$2,$3,$4) finished',
    [event.event_id, event.lease_id, error, permanent])).rows[0].finished;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sales_invoices (
      id text primary key, invoice_number text, invoice_date timestamptz, branch text,
      customer_code text, net_amount numeric, last_imported_at timestamptz
    );
    create table public.sales_invoice_items_v21 (
      id uuid primary key default gen_random_uuid(), invoice_id text, invoice_number text,
      invoice_date timestamptz, branch text, product_name text, quantity numeric, raw_data jsonb
    );
  `);
  await db.exec(migration);

  await db.exec("insert into sales_invoices values ('fixture', '42', '2026-11-25T22:30Z', 'فرع شكري', '123', 200, now())");
  assert.equal((await events()).length, 0, 'migration keeps capture disabled');

  for (const [table, prefix] of [
    ['sales_invoices', 'whatsapp_invoice_capture'],
    ['sales_invoice_items_v21', 'whatsapp_invoice_items_capture'],
  ]) {
    for (const op of ['insert', 'update', 'delete']) {
      await db.exec(`alter table public.${table} enable trigger ${prefix}_${op}_v1`);
    }
  }

  await db.exec("update sales_invoices set last_imported_at = now(), net_amount = 200");
  assert.equal((await events()).length, 0);
  await db.exec("begin; update sales_invoices set net_amount = 220; rollback");
  assert.equal((await events()).length, 0, 'rollback also removes captured events');
  await db.exec("update sales_invoices set customer_code = '567', net_amount = 220");
  const [correction] = await events();
  assert.equal(correction.before_identity.customerCode, '123');
  assert.equal(correction.after_identity.customerCode, '567');

  await db.exec(`insert into sales_invoice_items_v21 (invoice_id, product_name, quantity, raw_data)
    values ('fixture', 'A', 1, '{"returned":0}'), ('fixture', 'B', 2, '{}')`);
  assert.equal((await events()).length, 2, 'batch groups lines with the same invoice identity');
  await db.exec("update sales_invoice_items_v21 set raw_data = raw_data || '{\"import_batch\":123}'");
  assert.equal((await events()).length, 2);
  await db.exec(`update sales_invoice_items_v21
    set raw_data = raw_data || '{"returned":1,"line_discount":10}' where product_name = 'A'`);
  await db.exec("delete from sales_invoice_items_v21 where product_name = 'A'");
  await db.exec("delete from sales_invoices where id = 'fixture'");
  const pending = await events();
  assert.deepEqual(pending.map(e => e.operation), ['UPDATE', 'INSERT', 'UPDATE', 'DELETE', 'DELETE']);
  assert.equal(pending[3].before_identity.customerCode, '567');
  assert.equal(pending[4].before_identity.invoiceId, 'fixture');
  assert.equal(pending[4].after_identity, null);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(query('select count(*) from public.whatsapp_invoice_change_events_v1'), /permission denied/);
    await assert.rejects(claim(), /permission denied/);
    await db.exec('reset role');
  }

  const leased = await claim();
  const second = await claim();
  assert.notEqual(second.event_id, leased.event_id);
  assert.equal(await finish({ ...leased, lease_id: '00000000-0000-4000-8000-000000000001' }), false);
  await db.exec("insert into sales_invoices (id, invoice_number, net_amount) values ('new', '43', 50)");
  await db.exec('set role service_role');
  await assert.rejects(query('select count(*) from public.whatsapp_invoice_change_events_v1'), /permission denied/);
  assert.equal(await finish(leased), true);
  await db.exec('reset role');
  assert.equal((await events()).at(-1).completed_at, null, 'a new change survives older acknowledgement');
  assert.equal(await finish(second, 'temporary_unavailable'), true);
  const retry = (await events()).find(e => e.event_id === second.event_id);
  assert.ok(retry.due_at > retry.created_at);
  assert.equal(retry.completed_at, null);

  const permanent = await claim();
  assert.equal(await finish(permanent, 'missing_identity', true), true);
  assert.ok((await events()).find(e => e.event_id === permanent.event_id).needs_review_at);

  const abandoned = await claim();
  await query("update public.whatsapp_invoice_change_events_v1 set lease_until = now() - interval '1 second', attempts = 8 where event_id = $1", [abandoned.event_id]);
  await claim();
  const expired = (await events()).find(e => e.event_id === abandoned.event_id);
  assert.equal(expired.last_error_code, 'lease_expired');
  assert.ok(expired.needs_review_at);
  console.log('PASS: disabled capture, identity, commercial changes, rollback, access, leases, retry and review.');
} finally {
  await db.close();
}
