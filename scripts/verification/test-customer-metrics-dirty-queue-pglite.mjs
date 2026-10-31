import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sales_invoices(id integer generated always as identity primary key, customer_code text);
    create table public.customer_metrics_summary(customer_code text primary key, hits integer not null default 0);
    create or replace function public.refresh_customer_metrics_for_codes_v1(p_codes text[])
    returns integer language plpgsql as $$
    begin
      insert into public.customer_metrics_summary(customer_code,hits)
      select distinct code, 1 from unnest(p_codes) code
      on conflict(customer_code) do update set hits = customer_metrics_summary.hits + 1;
      return cardinality(p_codes);
    end; $$;
  `);

  const migration = readFileSync('supabase/migrations/20261031180000_customer_metrics_dirty_queue_v1.sql', 'utf8');
  await db.exec(migration);

  await db.exec(`insert into sales_invoices(customer_code) values ('101'), ('101'), (' 202 '), (null), ('');`);
  let queue = await db.query('select customer_code from customer_metrics_dirty_queue_v1 order by customer_code');
  assert.deepEqual(queue.rows.map(row => row.customer_code), ['101', '202']);

  let result = await db.query('select public.process_customer_metrics_dirty_queue_v1(1) as count');
  assert.equal(result.rows[0].count, 1);
  assert.equal((await db.query('select count(*)::int as count from customer_metrics_dirty_queue_v1')).rows[0].count, 1);

  await db.exec(`insert into sales_invoices(customer_code) values ('101'), ('202');`);
  result = await db.query('select public.process_customer_metrics_dirty_queue_v1(150) as count');
  assert.equal(result.rows[0].count, 2);
  assert.equal((await db.query('select count(*)::int as count from customer_metrics_dirty_queue_v1')).rows[0].count, 0);
  assert.deepEqual((await db.query('select customer_code, hits from customer_metrics_summary order by customer_code')).rows, [
    { customer_code: '101', hits: 2 }, { customer_code: '202', hits: 1 },
  ]);

  await assert.rejects(db.query('select public.process_customer_metrics_dirty_queue_v1(501)'), /p_limit/);
  await db.exec(`insert into sales_invoices(customer_code) values ('303');`);
  await db.exec(`create or replace function public.refresh_customer_metrics_for_codes_v1(p_codes text[])
    returns integer language plpgsql as $$ begin raise exception 'simulated failure'; end; $$;`);
  await assert.rejects(db.query('select public.process_customer_metrics_dirty_queue_v1(150)'), /simulated failure/);
  queue = await db.query('select customer_code from customer_metrics_dirty_queue_v1');
  assert.deepEqual(queue.rows.map(row => row.customer_code), ['303'], 'failed refresh retains work');
  console.log('PASS: enqueue, dedup, bounded processing, invalid input, failure rollback');
} finally {
  await db.close();
}
