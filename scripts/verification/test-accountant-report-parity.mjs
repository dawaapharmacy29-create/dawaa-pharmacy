import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create table base44_sync_run_log(source text,status text,ran_at timestamptz,error_message text);
create function gm_daily_review_actor_v1() returns uuid language plpgsql as $$ begin if current_setting('test.role',true) is distinct from 'general_manager' then raise exception 'not_authorized' using errcode='42501'; end if; return '00000000-0000-0000-0000-000000000001'; end $$;`);
for (const f of [
  '20261101160000_base44_accountant_reports_v1.sql',
  '20261101200203_accountant_report_verified_staff_session_execute_v1.sql',
  '20261101200702_accountant_report_detail_parity_v2.sql',
])
  await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
const vaults = [
  {
    id: 'v',
    code: 'shamy',
    name: 'الشامي',
    opening_balance: 100,
    opening_date: '2026-10-01',
    source_filename: 'test.xlsx',
  },
];
const tx = (id, date, direction, amount, source_row) => ({
  id,
  date,
  direction,
  amount,
  source_row,
  vault_code: 'shamy',
  category_name: 'بند',
  category_group: 'مبيعات',
  created_date: '2026-11-01T00:00:00',
  updated_date: '2026-11-01T00:00:00',
  original_description: 'الأصل',
});
await db.query('select import_base44_accountant_v1($1,$2)', [
  JSON.stringify(vaults),
  JSON.stringify([
    tx('old', '2026-09-30', 'in', 999, 1),
    tx('1', '2026-10-05', 'in', 20, 1),
    tx('2', '2026-11-01', 'in', 50, 2),
    tx('3', '2026-11-01', 'out', 10, 3),
    { ...tx('void', '2026-11-01', 'in', 10000, 4), voided: true },
  ]),
]);
await db.exec("set test.role='general_manager'; set role anon;");
const result = (await db.query("select get_accountant_report_v1('2026-11') r")).rows[0].r;
assert.equal(result.vaults[0].balance, 160);
assert.equal(result.vaults[0].period_opening, 120);
assert.equal(result.transactions.length, 2);
assert.equal(result.transactions.find((x) => x.id === '2').running_balance, 170);
assert.equal(result.transactions.find((x) => x.id === '3').running_balance, 160);
assert.equal(result.transactions[0].source_details.original_description, 'الأصل');
assert.equal(result.vaults[0].source_details.source_filename, 'test.xlsx');
assert.equal(result.history.find((x) => x.month === '2026-11').opening, 120);
assert.equal(result.history.find((x) => x.month === '2026-09').opening, null);
assert.equal(result.history.find((x) => x.month === '2026-09').incoming, 0);
await assert.rejects(db.query("select get_accountant_report_v1('2026-13')"), /invalid_month/);
await db.exec("set test.role='delivery';");
await assert.rejects(db.query('select get_accountant_report_v1(null)'), /not_authorized/);
await assert.rejects(db.query('select * from accountant_transactions'), /permission denied/);
await db.close();
console.log(
  'Accountant parity passed: opening cutoff, ledger ordering, metadata, history, voids, session role and direct-table denial.'
);
