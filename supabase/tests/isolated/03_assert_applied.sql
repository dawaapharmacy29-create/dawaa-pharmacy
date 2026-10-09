-- Assertions after applying 20261009080000 + 20261009081000 (verified session identity), 20261009090000 and
-- 20261009120000. Every API call runs as role anon carrying the fixture account's x-dawaa-session-token
-- (02b_sessions.sql), exactly like a browser request: identity is resolved by the real production chain.
\set ON_ERROR_STOP on

\set D1 '''11111111-0000-0000-0000-000000000001'''
\set GM '''aaaaaaaa-0000-0000-0000-000000000001'''
\set SM '''aaaaaaaa-0000-0000-0000-000000000002'''
\set KM '''aaaaaaaa-0000-0000-0000-000000000003'''
\set AS '''aaaaaaaa-0000-0000-0000-000000000004'''
\set SM2 '''aaaaaaaa-0000-0000-0000-000000000005'''

-- 1. Reconciliation, general manager (all branches).
create temp table gm as select test_call(:GM, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$) j;
select test_assert((select j->'cycles'->0->'reasons' from gm) = '{"inside_punched_shift":4,"attendance_other_branch":1,"attendance_branch_unproven":2,"date_only_day_evidence":1,"no_punched_shift":8,"date_only_no_shift":1,"non_positive_amount":1,"duplicate_invoice_number":2}'::jsonb,
  'every D1 invoice gets exactly one reason (time, night tail, per-punch branch, unknown device, date-only day/no-shift, zero, duplicate)');
select test_assert((select (j->'cycles'->0->'categories'->'attendance_verified'->>'invoices')::int + (j->'cycles'->0->'categories'->'identity_only'->>'invoices')::int + (j->'cycles'->0->'categories'->'uncertain'->>'invoices')::int + (j->'cycles'->0->'categories'->'zero_value'->>'invoices')::int from gm) = 20,
  'no invoice is dropped: 20 invoices in 4 categories');
select test_assert((select j->'cycles'->0->'attendance' from gm) @> '{"presentDays":6,"provenDays":4,"unprovenBranchDays":3,"otherBranchDays":1,"approvedHours":29,"approvedDaysWithHours":3}'::jsonb,
  'unproven days (unknown device, no logs) stay out of productivity denominators; the شكري day stored as الشامي is detected');
select test_assert((select j->'cycles'->0->'productivity' from gm) @> '{"verifiedSales":1320,"verifiedSalesSettledDays":1020}'::jsonb,
  'verified sales are placed on their shift day (night tail on the previous day, date-only at day level)');
select test_assert((select j->'cycles'->0->'conversion' from gm) = '{"verified":2,"invoice_not_matching_customer_or_time":2,"served_other_seller":1,"invoice_reused":2,"no_sale":1,"unknown":1,"claimed_without_invoice":1,"invoice_missing":1,"invoice_ambiguous":1}'::jsonb,
  'conversion: one class per review; invoice before the first message rejected; sale at another branch found by customer + time');

-- 2. Branch manager of الشامي: only الشامي invoices, days and reviews; no hint about شكري.
create temp table sm as select test_call(:SM, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$) j;
select test_assert((select j->>'scopeBranch' from sm) = 'فرع الشامي', 'branch-scoped caller is limited to its branch');
select test_assert((select (j->'cycles'->0->'categories'->'attendance_verified'->>'invoices')::int + (j->'cycles'->0->'categories'->'identity_only'->>'invoices')::int + (j->'cycles'->0->'categories'->'uncertain'->>'invoices')::int + (j->'cycles'->0->'categories'->'zero_value'->>'invoices')::int from sm) = 16,
  'the 4 شكري invoices of a الشامي doctor are invisible to the الشامي manager');
select test_assert((select j->'cycles'->0->'conversion' from sm) = '{"verified":2,"invoice_not_matching_customer_or_time":2,"served_other_seller":1,"invoice_reused":2,"no_sale":1,"unknown":1,"claimed_without_invoice":1,"invoice_missing":2}'::jsonb,
  'a شكري invoice reads as missing for a الشامي manager (no cross-branch existence hint)');
select test_assert((select (j->'cycles'->0->'attendance'->>'presentDays')::int from sm) = 2, 'only days proven at الشامي are visible to its manager');

-- 3. Manager without view_reviews: no conversion at all.
select test_assert((select test_call(:SM2, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)) @> '{"reviewsVisible":false}'::jsonb
  and (select test_call(:SM2, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->'cycles'->0->'conversion') = 'null'::jsonb,
  'conversion requires view_reviews');

-- 4. Refusals.
select test_assert((select test_call(:KM, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'شكري manager is refused for a الشامي doctor');
select test_assert((select test_call(:AS, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'assistant without sales permission is refused');
select test_assert((select test_call(null, $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'a request without a verified session is refused');
select test_assert((select test_call('99999999-0000-0000-0000-000000000000', $q$select get_doctor_sales_reconciliation_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'an unknown account id is refused');
select test_assert((select test_call(:GM, $q$select to_jsonb(count(*)) from dawaa_doctor_sales_reconciliation_v1(array['11111111-0000-0000-0000-000000000001'::uuid], null, '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'internal reconciliation function is not callable by anon');
select test_assert((select test_call(:GM, $q$select to_jsonb(count(*)) from dawaa_doctor_attendance_days_v1(array['11111111-0000-0000-0000-000000000001'::uuid], '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'internal attendance function is not callable by anon');
select test_assert((select test_call(:GM, $q$select to_jsonb(count(*)) from biometric_device_branches$q$)->>'error') = '42501', 'device registry is not readable by anon');
select test_assert((select test_call(:GM, $q$select to_jsonb(dawaa_staff_sales_read_branch_v1('11111111-0000-0000-0000-000000000001'))$q$)->>'error') = '42501', 'sales read-branch helper is not callable by anon');
select test_assert(not exists (select 1 from public.biometric_device_branches where external_device_id = '105'), 'device 105 is not in the registry');

-- 5. Sales scope fix (bundle + evaluation summary).
select test_assert((select test_call(:GM, $q$select get_staff_performance_sales_bundle_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26', '2026-08-26', 31)$q$)->'cycles'->0->>'invoices')::int = 20, 'GM bundle keeps every branch');
select test_assert((select test_call(:SM, $q$select get_staff_performance_sales_bundle_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26', '2026-08-26', 31)$q$)) @> '{"scopeBranch":"فرع الشامي"}'::jsonb
  and (select test_call(:SM, $q$select get_staff_performance_sales_bundle_v1('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26', '2026-08-26', 31)$q$)->'cycles'->0->>'invoices')::int = 16,
  'الشامي manager bundle no longer includes شكري invoices and says so');
select test_assert((select test_call(:SM, $q$select to_jsonb(invoices) from get_staff_evaluation_sales_summary_v3('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$))::text = '16', 'evaluation summary for the الشامي manager is limited to الشامي');
select test_assert((select test_call(:KM, $q$select to_jsonb(invoices) from get_staff_evaluation_sales_summary_v3('11111111-0000-0000-0000-000000000001', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'شكري manager still refused on the evaluation summary');

-- 6. Peer comparison on the shared core.
create temp table bw as select test_call(:SM, $q$select get_branch_doctor_performance_window_v1('فرع الشامي', '2026-08-26', '2026-09-26')$q$) j;
select test_assert((select j->'ambiguousNames' from bw) ? 'سامي نور', 'a seller name shared by two employees is reported, never attributed');
select test_assert((select c->'shifts'->'evening' from bw, jsonb_array_elements(j->'doctors') d, jsonb_array_elements(d->'cycles') c where d->>'staffId' = '11111111-0000-0000-0000-000000000001') @> '{"hours":21,"sales":900,"invoices":3}'::jsonb,
  'peer shift productivity uses only shifts proven at the branch with known hours; a date-only sale on a one-shift day joins that shift (numerator matches denominator)');
select test_assert((select c->'shifts' from bw, jsonb_array_elements(j->'doctors') d, jsonb_array_elements(d->'cycles') c where d->>'staffId' = '11111111-0000-0000-0000-000000000003')
  = '{"night":{"hours":8,"days":1,"pendingDays":0,"lateDays":0,"sales":50,"invoices":1}}'::jsonb,
  'a day touched by two shifts with an unplaceable date-only sale leaves the ratio with its hours and its sales');
select test_assert((select test_call(:KM, $q$select get_branch_doctor_performance_window_v1('فرع الشامي', '2026-08-26', '2026-09-26')$q$)->>'error') = '42501', 'شكري manager is refused on the الشامي peer comparison');
