-- Assertions for 20261009070000 (materialize guard) and 20261009070500 (standard payroll finalize route).
-- Run twice by the rehearsal: with 'before' the production defects must reproduce, with 'after' they must be fixed.
\set ON_ERROR_STOP on
\set GM '''aaaaaaaa-0000-0000-0000-000000000001'''
\set SM '''aaaaaaaa-0000-0000-0000-000000000002'''

create or replace function pg_temp.mat(p_actor uuid) returns jsonb language sql as $$
  select public.test_call(p_actor, $q$select public.materialize_attendance_range_v2('2026-09-01', '2026-09-02', null)$q$) $$;

-- Payroll fixtures: one v2-staged standard snapshot (payload has preview_route) and one legacy v1-staged snapshot.
delete from public.payroll_finalized_snapshots_v2;
delete from public.payroll_snapshot_reviews;
delete from public.payroll_final_snapshot_staging;
insert into public.payroll_final_snapshot_staging (id, staff_id, staff_username, staff_name, branch, month_cycle, cycle_start, cycle_end, finalization_ready, snapshot_fingerprint, payload) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'd1', 'D1', 'فرع الشامي', '2026-09', '2026-08-26', '2026-09-25', true, 'fp-v2', '{"preview_route":"standard_v1","snapshot_schema":"payroll_final_snapshot_v3"}'),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'd2', 'D2', 'فرع الشامي', '2026-09', '2026-08-26', '2026-09-25', true, 'fp-v1', '{"snapshot_schema":"payroll_final_snapshot_v3"}');
insert into public.payroll_snapshot_reviews (snapshot_id, decision) values
  ('dddddddd-0000-0000-0000-000000000001', 'approved'), ('dddddddd-0000-0000-0000-000000000002', 'approved');
delete from public.ops_materialize_calls;
-- The general manager's request: before the identity hardening production identifies by x-dawaa-user-id,
-- after it by the session token.
create or replace function pg_temp.fin(p_snapshot uuid) returns jsonb language sql as $$
  select case when current_setting('rehearsal.phase') = 'before'
    then public.test_request('anon', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', format($q$select public.finalize_payroll_snapshot_v2(%L)$q$, p_snapshot))
    else public.test_call('aaaaaaaa-0000-0000-0000-000000000001', format($q$select public.finalize_payroll_snapshot_v2(%L)$q$, p_snapshot)) end $$;

select current_setting('rehearsal.phase') = 'before' as before_phase \gset
\if :before_phase
select public.test_assert(pg_temp.mat(null) ? 'schema', 'BEFORE: production defect reproduced — anon without any session can materialize attendance');
select public.test_assert(pg_temp.fin('dddddddd-0000-0000-0000-000000000001')->>'message' = 'snapshot_changed_or_blocked_before_finalization',
  'BEFORE: production defect reproduced — a v2-staged standard snapshot can never be finalized');
\else
select public.test_assert(pg_temp.mat(null)->>'error' = '42501', 'anon without a session is refused');
select public.test_assert(pg_temp.mat('aaaaaaaa-0000-0000-0000-000000000006')->>'error' = '42501', 'a disabled account is refused');
select public.test_assert(pg_temp.mat('aaaaaaaa-0000-0000-0000-000000000002')->>'error' = '42501', 'a branch manager is refused (top management only)');
select public.test_assert(test_request('anon', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', $q$select public.materialize_attendance_range_v2('2026-09-01', '2026-09-02', null)$q$)->>'error' = '42501',
  'a forged GM header is refused');
select public.test_assert(pg_temp.mat('aaaaaaaa-0000-0000-0000-000000000001') ? 'schema', 'the general manager can still refresh from the UI');
select public.test_assert((select count(*) from public.ops_materialize_calls) = 1, 'only the authorized call reached the materializer');
select public.test_assert(test_request(null, '{}', $q$select public.dawaa_materialize_attendance_range_route_aware_v1('2026-09-01', '2026-09-02', null)$q$) ? 'schema',
  'the cron path (internal route-aware materializer, server context) is unaffected');
select public.test_assert(pg_temp.fin('dddddddd-0000-0000-0000-000000000001')->'comparison'->>'compare' = 'v2', 'a v2-staged standard snapshot finalizes against the v2 preview');
select public.test_assert(pg_temp.fin('dddddddd-0000-0000-0000-000000000002')->'comparison'->>'compare' = 'v1', 'a legacy v1-staged snapshot still finalizes against v1');
select public.test_assert((select count(*) from public.payroll_finalized_snapshots_v2) = 2, 'both snapshots are finalized exactly once');
select public.test_assert(pg_temp.fin('dddddddd-0000-0000-0000-000000000001') @> '{"existing":true}'::jsonb, 'finalizing again is idempotent');
select public.test_assert(test_call(:SM, $q$select public.finalize_payroll_snapshot_v2('dddddddd-0000-0000-0000-000000000001')$q$)->>'error' = '42501', 'a branch manager cannot finalize payroll');
\endif
