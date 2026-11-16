import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('canonical customer code lookup index', () => {
  let db: PGlite;
  let before: unknown[];
  const query = `select id from public.customers where
    effective_customer_code in ('2604') or customer_code in ('2604') or code in ('2604') order by id`;
  const migration = readFileSync('supabase/migrations/20261116121321_whatsapp_customer_code_lookup_index.sql', 'utf8');
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table public.customers (id int primary key, customer_code text, effective_customer_code text, code text);
      create index customers_customer_code_idx on public.customers(customer_code);
      create index customers_code_idx on public.customers(code);
      insert into public.customers select n, n::text, n::text, n::text from generate_series(10000,29999) n;
      insert into public.customers values (1,'2604',null,null),(2,null,'2604',null),(3,null,null,'2604');
      analyze public.customers;`);
    before = (await db.query(query)).rows;
    await db.exec('begin');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('commit');
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it('preserves every competing identity across all three code columns', async () => {
    expect((await db.query(query)).rows).toEqual(before);
    expect(before).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect((await db.query("select id from customers where effective_customer_code='absent'")).rows).toEqual([]);
  });
  it('lets the planner use all three indexes rather than a full customer scan', async () => {
    const plan = await db.query(`explain (format json) ${query}`);
    const json = JSON.stringify(plan.rows);
    expect(json).toContain('BitmapOr');
    expect(json).toContain('customers_effective_customer_code_lookup_idx_v1');
    expect(json).not.toContain('Seq Scan');
  });
  it('is idempotent and introduces no uniqueness rule or table ACL change', async () => {
    const r = await db.query(`select i.indisunique, c.relacl from pg_index i
      join pg_class ix on ix.oid=i.indexrelid join pg_class c on c.oid=i.indrelid
      where ix.relname='customers_effective_customer_code_lookup_idx_v1'`);
    expect(r.rows).toEqual([{ indisunique: false, relacl: null }]);
  });
});
