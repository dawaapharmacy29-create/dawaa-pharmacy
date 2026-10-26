import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.sales_invoices (
      id text primary key, staff_id text, updated_at timestamptz,
      customer_code text, amount numeric, branch text
    );
    create table public.metric_calls (target text primary key, calls integer not null default 0);
    insert into public.metric_calls (target) values ('customers'), ('followups');
    create function public.refresh_customer_metrics_for_codes_v1(text[])
    returns void language plpgsql as $$ begin
      update public.metric_calls set calls=calls+1 where target='customers';
    end $$;
    create function public.refresh_daily_followup_customer_metrics_for_codes_v2(text[])
    returns void language plpgsql as $$ begin
      update public.metric_calls set calls=calls+1 where target='followups';
    end $$;
  `);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261026120731_sales_invoice_staff_only_refresh_guard_and_audit_v1.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create trigger sales_invoices_refresh_customer_metrics_update_v1
      after update on public.sales_invoices
      referencing old table as old_rows new table as new_rows
      for each statement execute function public.refresh_customer_metrics_after_sales_invoice_update_v1();
    create trigger zz_sales_invoices_refresh_followup_metrics_update_v2
      after update on public.sales_invoices
      referencing old table as old_rows new table as new_rows
      for each statement execute function public.refresh_followup_metrics_after_sales_invoice_update_v2();
    insert into public.sales_invoices (id, customer_code, amount, branch) values
      ('one', 'customer-1', 200, 'شكري'),('two','customer-2',300,'الشامي');
    update public.sales_invoices set staff_id='doctor-1',updated_at=now();
  `);
  let rows = (await db.query('select * from public.metric_calls order by target')).rows;
  if (rows.some((row) => row.calls !== 0)) throw Error(`Identity-only update recomputed metrics: ${JSON.stringify(rows)}`);
  await db.exec("update public.sales_invoices set amount=amount+10 where id='one'");
  rows = (await db.query('select * from public.metric_calls order by target')).rows;
  if (rows.some((row) => row.calls !== 1)) throw Error(`Commercial update missed metrics: ${JSON.stringify(rows)}`);
  console.log('PASS: staff-only update skips both refreshes; commercial update invokes both');
} finally {
  await db.close();
}
