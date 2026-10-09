#!/usr/bin/env bash
# Combined isolated database rehearsal for every unapplied migration of this release, in version order:
#   20261009070000 attendance materialize guard      20261009070500 standard payroll finalize route
#   20261009080000 Base44 service actor               20261009081000 verified staff session identity
#   20261009090000 doctor sales reconciliation        20261009120000 staff sales branch scope
# Runs on a throwaway local PostgreSQL 16 cluster in a temp directory; never connects to Supabase or production.
# Production surfaces are copied verbatim (md5-checked below); identity runs through the real production chain.
# Steps: baseline → production defects reproduced → failure injections leave nothing → apply → identity,
# sessions, notifications, Base44, ops, roles and branch-scope assertions → idempotent re-apply → rollbacks
# in reverse (exact restore, Base44 keeps working, data unchanged) → forward re-apply after rollback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
WORK="$(mktemp -d)"; chmod 777 "$WORK"
PORT=55439
RUN() { runuser -u postgres -- "$@"; }
cleanup() { RUN "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
RUN "$PGBIN/initdb" -D "$WORK/data" -U postgres --encoding=UTF8 --locale=C.UTF-8 >/dev/null
RUN "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c timezone=UTC" -l "$WORK/log" start >/dev/null
for i in $(seq 1 30); do RUN "$PGBIN/pg_isready" -h "$WORK" -p $PORT >/dev/null 2>&1 && break; sleep 0.2; done
cp -r "$ROOT/supabase" "$WORK/src"; chmod -R a+rX "$WORK/src"
S="$WORK/src"; M="$S/migrations"; T="$S/tests/isolated"
PSQL() { RUN psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p $PORT -U postgres -d postgres "$@"; }
step() { echo; echo "== $*"; }
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2', expected '$3')"; exit 1; fi; }
asserts() { # runs an assertion file, prints PASS lines, fails on any error
  local out; out=$(PSQL -c "set rehearsal.phase = '${2:-after}'" -f "$1" 2>&1) || { echo "$out" | grep -E "ERROR|FAIL" | sed 's/^.*\(ERROR\|NOTICE\):  //'; exit 1; }
  echo "$out" | grep -E "PASS" | sed 's/^.*NOTICE:  //'
}
MIGRATIONS=(
  20261009070000_attendance_materialize_range_v2_guard_v1.sql
  20261009070500_payroll_standard_finalize_preview_route_v1.sql
  20261009080000_base44_purchase_sync_service_actor_v1.sql
  20261009081000_verified_staff_session_identity_v1.sql
  20261009090000_doctor_sales_reconciliation_v1.sql
  20261009120000_staff_sales_branch_scope_v1.sql
)
apply_all() { for f in "${MIGRATIONS[@]}"; do PSQL -1 -f "$M/$f"; done; }

CHECKSUM="select md5(string_agg(t, '|' order by t)) from (
  select 'si:'||md5(string_agg(x::text, ',' order by x.id)) t from public.sales_invoices x union all
  select 'bl:'||md5(string_agg(x::text, ',' order by x.id)) from public.biometric_attendance_logs x union all
  select 'ad:'||md5(string_agg(x::text, ',' order by x.id)) from public.attendance_daily_summary x union all
  select 'rv:'||md5(string_agg(x::text, ',' order by x.id)) from public.conversation_sales_reviews_canonical_v2 x union all
  select 'st:'||md5(string_agg(x::text, ',' order by x.id)) from public.staff x union all
  select 'sa:'||md5(string_agg(x::text, ',' order by x.id)) from public.staff_accounts x) q"
OBJECTS="select coalesce(string_agg(n, ',' order by n), '') from (
  select proname n from pg_proc where proname in ('dawaa_doctor_attendance_days_v1','dawaa_doctor_sales_reconciliation_v1','get_doctor_sales_reconciliation_v1','get_branch_doctor_performance_window_v1','dawaa_staff_sales_read_branch_v1','dawaa_session_account_id_v1','dawaa_bind_actor_v1','dawaa_request_context_is_client_v1')
  union all select relname from pg_class where relname = 'biometric_device_branches') q"
FN="select md5(pg_get_functiondef('public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer)'::regprocedure))
  ||','||md5(pg_get_functiondef('public.get_staff_evaluation_sales_summary_v3(uuid,date,date)'::regprocedure))
  ||','||md5(pg_get_functiondef('public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure))
  ||','||md5(pg_get_functiondef('public.record_conversation_review_points_v1(text,uuid)'::regprocedure))
  ||','||md5(pg_get_functiondef('public.materialize_attendance_range_v2(date,date,text)'::regprocedure))
  ||','||md5(pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure))"
PROD_FN="91118e3b896c11f94e5e87b12a7e2f8e,4cfce7577cb7ef6062a4aad1b91a2179,db806d8561edf5d05600a0efac4e5ea4,8d119972d02bcf81009399a0b2aeb76f,42216198a9a8a88296f0a87b65bdbd44,6e7a0ac8991c74828380d6ff088631b6"
STRICT_FORGED="select test_request('anon', '{\"x-dawaa-user-id\":\"aaaaaaaa-0000-0000-0000-000000000001\"}', 'select to_jsonb(public.dawaa_current_staff_account_id_strict())')#>>'{}'"
BASE44_SERVICE="select coalesce(test_request('service_role', '{}', \$q\$select public.import_base44_purchase_invoices_v1('[{\"id\":\"probe\"}]')\$q\$)->>'total', 'refused')"

step "baseline: platform, verbatim production functions and identity chain, synthetic fixtures, sessions"
PSQL -f "$T/00_platform.sql" -f "$T/01b_identity_platform.sql" -f "$T/01c_ops_platform.sql" -f "$T/01_production_functions.sql" -f "$T/02_fixtures.sql" -f "$T/02b_sessions.sql"
BASE=$(PSQL -At -c "$CHECKSUM")
check "the 6 guarded production functions equal their production definitions (md5)" "$(PSQL -At -c "$FN")" "$PROD_FN"

step "production defects reproduced before any migration"
check "today a forged x-dawaa-user-id header acts as the general manager" "$(PSQL -At -c "$STRICT_FORGED")" "aaaaaaaa-0000-0000-0000-000000000001"
check "today Base44 cannot sync with the service_role client (needs the forged header)" "$(PSQL -At -c "$BASE44_SERVICE")" "refused"
asserts "$T/05_assert_ops.sql" before

step "failure injection 1: reconciliation migration aborted mid-way leaves nothing"
if (cat "$M/20261009090000_doctor_sales_reconciliation_v1.sql"; echo "select 1/0;") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: injected failure did not abort"; exit 1; fi
check "no object survives an aborted migration" "$(PSQL -At -c "$OBJECTS")" ""
step "failure injection 2: scope fix refuses to run over a drifted definition"
if (echo "create or replace function public.get_staff_evaluation_sales_summary_v3(p_staff_id uuid, p_start date, p_end_exclusive date) returns table(sales numeric, invoices bigint, customers bigint, avg_invoice numeric, data_as_of date) language sql as \$\$ select 0::numeric,0::bigint,0::bigint,0::numeric,null::date \$\$;"; cat "$M/20261009120000_staff_sales_branch_scope_v1.sql") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: drift guard did not abort"; exit 1; fi
step "failure injection 3: identity hardening aborted after its last statement leaves nothing"
if (cat "$M/20261009081000_verified_staff_session_identity_v1.sql"; echo "select 1/0;") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: injected failure did not abort"; exit 1; fi
step "failure injection 4: payroll fix refuses a drifted finalize definition"
if (echo "create or replace function public.finalize_payroll_snapshot_v2(p_snapshot_id uuid) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$;"; cat "$M/20261009070500_payroll_standard_finalize_preview_route_v1.sql") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: payroll anchor guard did not abort"; exit 1; fi
check "aborted migrations left every guarded function untouched" "$(PSQL -At -c "$FN")" "$PROD_FN"
check "aborted migrations created no object" "$(PSQL -At -c "$OBJECTS")" ""
check "aborted identity hardening left the old header identity in place" "$(PSQL -At -c "$STRICT_FORGED")" "aaaaaaaa-0000-0000-0000-000000000001"

step "apply all six migrations in version order (each in one transaction)"
apply_all
check "applying writes no existing invoice, punch, attendance, review or staff row" "$(PSQL -At -c "$CHECKSUM")" "$BASE"

step "assertions: identity, sessions, notifications, actor binding, review points, Base44"
asserts "$T/04_assert_identity.sql"
step "assertions: materialize guard and standard payroll finalization"
asserts "$T/05_assert_ops.sql" after
step "assertions: reconciliation categories, conversion, roles, branch scope, peer comparison (through real sessions)"
asserts "$T/03_assert_applied.sql"

step "idempotent re-apply"
for f in "${MIGRATIONS[@]:0:5}"; do PSQL -1 -f "$M/$f"; done
check "registry still holds exactly the 4 proven devices" "$(PSQL -At -c "select string_agg(external_device_id, ',' order by external_device_id) from public.biometric_device_branches")" "101,102,GED7242701315,GED7242701324"
check "re-applying identity keeps 52 bound functions (no double binding)" "$(PSQL -At -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and prosrc like '%dawaa_bind_actor_v1(p_actor_id)%' and prosrc not like '%dawaa_bind_actor_v1(p_actor_id)%dawaa_bind_actor_v1(p_actor_id)%'")" "52"

step "rollback in reverse order"
PSQL -f "$S/sql/ROLLBACK_20261009_staff_sales_branch_scope_v1.sql"
PSQL -f "$S/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql"
PSQL -f "$S/sql/ROLLBACK_20261008_verified_staff_session_identity_v1.sql"
check "after the identity rollback Base44 still syncs with the service_role client" "$(PSQL -At -c "$BASE44_SERVICE")" "1"
PSQL -f "$S/sql/ROLLBACK_20261008_base44_purchase_sync_service_actor_v1.sql"
PSQL -f "$S/sql/ROLLBACK_20261009_payroll_standard_finalize_preview_route_v1.sql"
PSQL -f "$S/sql/ROLLBACK_20261009_attendance_materialize_range_v2_guard_v1.sql"
check "rollbacks restore all 6 production definitions byte for byte" "$(PSQL -At -c "$FN")" "$PROD_FN"
check "rollbacks remove every object the migrations created" "$(PSQL -At -c "$OBJECTS")" ""
check "rollbacks change no invoice, punch, attendance, review or staff row" "$(PSQL -At -c "$CHECKSUM")" "$BASE"
PSQL -f "$S/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql"
echo "PASS: reconciliation rollback is safe to run twice"

step "forward re-apply after rollback"
apply_all
for f in 04_assert_identity.sql 03_assert_applied.sql; do
  echo "PASS: $(asserts "$T/$f" | grep -c PASS) assertions of $f pass again after re-apply"
done
echo; echo "ISOLATED REHEARSAL: ALL STEPS PASSED"
