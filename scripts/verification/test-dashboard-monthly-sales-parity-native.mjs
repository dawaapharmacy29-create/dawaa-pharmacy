// Native PostgreSQL parity check: get_dashboard_monthly_sales_v172 must return, for
// every month, exactly what get_dashboard_sales_summary_v171 returns for that month's
// window. Local network-isolated container, synthetic invoices only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'dashboard_monthly_parity';
const migration = readFileSync('supabase/migrations/20261027160000_dashboard_monthly_sales_single_pass_v172.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

// Client month windows exactly as the former fetchMonthlySalesFromTruth built them.
function clientWindows(endDate, months) {
  const anchor = new Date(`${endDate}T12:00:00Z`);
  const key = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return Array.from({ length: months }, (_, index) => {
    const monthDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (months - 1 - index), 1, 12));
    const lastDay = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 12));
    const naturalEnd = `${key(lastDay)}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
    return { start: `${key(monthDate)}-01`, end: key(monthDate) === endDate.slice(0, 7) && endDate < naturalEnd ? endDate : naturalEnd };
  });
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create table public.sales_invoices(
    id bigserial primary key, invoice_date timestamptz, branch text, customer_code text, customer_name text,
    save_status text, invoice_type text, net_total numeric, net_amount numeric, discounted_amount numeric,
    total_amount numeric, amount numeric);
  -- Same filter as production dawaa_sales_invoices_dashboard_v1 (column list reduced).
  create view public.dawaa_sales_invoices_dashboard_v1 as
    select * from public.sales_invoices si
    where not (lower(coalesce(save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
            or lower(coalesce(invoice_type, '')) ~ '(معلق|pending|draft)')
      and (btrim(coalesce(customer_code, '')) <> all (array['5','10','20','54','170','4902','12820']));
  -- Production get_dashboard_sales_summary_v171, verbatim body.
  create function public.get_dashboard_sales_summary_v171(p_start date, p_end date, p_branch text default null)
  returns table(invoices_count bigint, sales_total numeric, avg_invoice numeric, linked_invoices bigint,
    unregistered_customer_invoices bigint, linked_sales numeric, unregistered_customer_sales numeric,
    customer_link_rate_percent numeric, linked_customers bigint)
  language sql stable security definer set search_path to 'public' as $function$
  with s as (
   select coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0) v,
          nullif(btrim(si.customer_code),'') code,
          lower(coalesce(si.customer_name,'')) nm
   from public.dawaa_sales_invoices_dashboard_v1 si
   where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
     and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
  ), m as (
   select *,code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%' linked from s
  )
  select count(*)::bigint,coalesce(sum(v),0)::numeric,(coalesce(sum(v),0)/nullif(count(*),0))::numeric,
         count(*) filter(where linked)::bigint,count(*) filter(where not linked)::bigint,
         coalesce(sum(v) filter(where linked),0)::numeric,coalesce(sum(v) filter(where not linked),0)::numeric,
         case when count(*)>0 then count(*) filter(where linked)::numeric*100/count(*) else 0 end,
         count(distinct code) filter(where linked)::bigint
  from m;
  $function$;
  set timezone='UTC';
  -- ~6000 invoices over 2026-03..2026-11 with boundary instants, excluded codes, pending
  -- statuses, two branches and every value-column fallback.
  insert into public.sales_invoices(invoice_date, branch, customer_code, customer_name, save_status, invoice_type,
                                    net_total, net_amount, discounted_amount, total_amount, amount)
  select timestamptz '2026-03-01 00:00:00+00' + (g * interval '61 minutes 7 seconds'),
         case when g % 3 = 0 then 'فرع الشامي' else 'فرع شكري' end,
         case when g % 17 = 0 then '4902' when g % 19 = 0 then ' 5 ' when g % 7 = 0 then null else (1000 + g % 900)::text end,
         case when g % 11 = 0 then 'عميل غير مسجل' else 'Synthetic ' || g end,
         case when g % 23 = 0 then 'معلقة' when g % 29 = 0 then 'Draft' else 'تم حفظها' end,
         case when g % 31 = 0 then 'pending' else 'كاش' end,
         case when g % 5 = 0 then 0 when g % 13 = 0 then null else (g % 400) + 0.37 end,
         case when g % 10 = 0 then 120.5 else null end,
         case when g % 4 = 0 then 80 else 0 end,
         200, 10
  from generate_series(0, 5999) g;
  insert into public.sales_invoices(invoice_date, branch, customer_code, customer_name, save_status, invoice_type, net_total)
  values ('2026-09-30 23:59:59.999+00', 'فرع شكري', '3001', 'Edge', 'تم حفظها', 'كاش', 111),
         ('2026-10-01 00:00:00+00', 'فرع شكري', '3002', 'Edge', 'تم حفظها', 'كاش', 222),
         ('2026-10-27 23:59:59+00', 'فرع الشامي', '3003', 'Edge', 'تم حفظها', 'كاش', 333),
         ('2026-10-28 00:00:00+00', 'فرع الشامي', '3004', 'Edge', 'تم حفظها', 'كاش', 444);
`);
sql(migration);
sql(migration);

// DAWAA_FULL_PARITY_MATRIX=1 runs 900 month windows (~6 min); the default keeps CI short.
const full = process.env.DAWAA_FULL_PARITY_MATRIX === '1';
let compared = 0;
for (const timezone of ['UTC', 'Africa/Cairo']) {
  for (const endDate of full ? ['2026-10-27', '2026-10-31', '2026-10-01', '2026-11-15', '2026-04-30'] : ['2026-10-27', '2026-10-01']) {
    for (const branch of full ? [null, '', 'كل الفروع', 'الكل', 'فرع شكري', 'فرع الشامي'] : [null, 'كل الفروع', 'فرع الشامي']) {
      for (const months of full ? [1, 5, 9] : [5]) {
        const lit = branch === null ? 'null' : `'${branch}'`;
        const v172 = sql(`set timezone='${timezone}'; select month_start||'|'||invoices_count||'|'||sales_total from public.get_dashboard_monthly_sales_v172('${endDate}', ${lit}, ${months});`).split('\n');
        const expected = clientWindows(endDate, months).map(({ start, end }) =>
          `${start}|` + sql(`set timezone='${timezone}'; select invoices_count||'|'||sales_total from public.get_dashboard_sales_summary_v171('${start}','${end}',${lit});`)
        );
        assert.deepEqual(v172, expected, `${timezone} ${endDate} ${branch} ${months}`);
        compared += months;
      }
    }
  }
}
console.log(`PASS v171/v172 month-by-month parity (${compared} month windows, UTC + Africa/Cairo)`);

const acl = sql(`select has_function_privilege('anon','public.get_dashboard_monthly_sales_v172(date,text,integer)','execute')::text || has_function_privilege('authenticated','public.get_dashboard_monthly_sales_v172(date,text,integer)','execute')::text`);
assert.equal(acl, 'truetrue');
const clamp = sql(`select count(*) from public.get_dashboard_monthly_sales_v172('2026-10-27', null, 500)`);
assert.equal(clamp, '24');
console.log('PASS ACL matches v171 and month count is bounded (max 24)');

sql(`drop database ${db} with (force)`, 'postgres');
