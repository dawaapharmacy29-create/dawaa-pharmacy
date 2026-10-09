#!/usr/bin/env bash
# Isolated database rehearsal for 20261009090000 (reconciliation) and 20261009120000 (sales branch scope).
# Runs on a throwaway local PostgreSQL 16 cluster in a temp directory; never connects to Supabase or production.
# Steps: platform + verbatim production functions + synthetic fixtures → data checksum → failure injections
# (must leave nothing behind) → apply → role/scope assertions → idempotent re-apply → rollbacks (exact restore,
# objects gone, data unchanged) → forward re-apply after rollback.
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
S="$WORK/src"
PSQL() { RUN psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p $PORT -U postgres -d postgres "$@"; }
step() { echo; echo "== $*"; }
CHECKSUM="select md5(string_agg(t, '|' order by t)) from (
  select 'si:'||md5(string_agg(x::text, ',' order by x.id)) t from public.sales_invoices x union all
  select 'bl:'||md5(string_agg(x::text, ',' order by x.id)) from public.biometric_attendance_logs x union all
  select 'ad:'||md5(string_agg(x::text, ',' order by x.id)) from public.attendance_daily_summary x union all
  select 'rv:'||md5(string_agg(x::text, ',' order by x.id)) from public.conversation_sales_reviews_canonical_v2 x union all
  select 'st:'||md5(string_agg(x::text, ',' order by x.id)) from public.staff x union all
  select 'sa:'||md5(string_agg(x::text, ',' order by x.id)) from public.staff_accounts x) q"
OBJECTS="select coalesce(string_agg(n, ',' order by n), '') from (
  select proname n from pg_proc where proname in ('dawaa_doctor_attendance_days_v1','dawaa_doctor_sales_reconciliation_v1','get_doctor_sales_reconciliation_v1','get_branch_doctor_performance_window_v1','dawaa_staff_sales_read_branch_v1')
  union all select relname from pg_class where relname = 'biometric_device_branches') q"
SALES_MD5="select md5(pg_get_functiondef('public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer)'::regprocedure))||','||md5(pg_get_functiondef('public.get_staff_evaluation_sales_summary_v3(uuid,date,date)'::regprocedure))"
EXPECTED_SALES_MD5="91118e3b896c11f94e5e87b12a7e2f8e,4cfce7577cb7ef6062a4aad1b91a2179"
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2', expected '$3')"; exit 1; fi; }

step "baseline: platform, verbatim production functions, synthetic fixtures"
PSQL -f "$S/tests/isolated/00_platform.sql" -f "$S/tests/isolated/01_production_functions.sql" -f "$S/tests/isolated/02_fixtures.sql"
BASE=$(PSQL -At -c "$CHECKSUM")
check "baseline sales functions equal the production definitions" "$(PSQL -At -c "$SALES_MD5")" "$EXPECTED_SALES_MD5"

step "failure injection 1: reconciliation migration aborted mid-way leaves nothing"
if (cat "$S/migrations/20261009090000_doctor_sales_reconciliation_v1.sql"; echo "select 1/0;") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: injected failure did not abort"; exit 1; fi
check "no object survives an aborted migration" "$(PSQL -At -c "$OBJECTS")" ""
step "failure injection 2: scope fix refuses to run over a drifted definition"
if (echo "create or replace function public.get_staff_evaluation_sales_summary_v3(p_staff_id uuid, p_start date, p_end_exclusive date) returns table(sales numeric, invoices bigint, customers bigint, avg_invoice numeric, data_as_of date) language sql as \$\$ select 0::numeric,0::bigint,0::bigint,0::numeric,null::date \$\$;"; cat "$S/migrations/20261009120000_staff_sales_branch_scope_v1.sql") | PSQL -1 >/dev/null 2>&1; then echo "FAIL: drift guard did not abort"; exit 1; fi
check "drift abort left both sales functions untouched" "$(PSQL -At -c "$SALES_MD5")" "$EXPECTED_SALES_MD5"
check "drift abort created no helper" "$(PSQL -At -c "$OBJECTS")" ""

step "apply both migrations (each in one transaction)"
PSQL -1 -f "$S/migrations/20261009090000_doctor_sales_reconciliation_v1.sql"
PSQL -1 -f "$S/migrations/20261009120000_staff_sales_branch_scope_v1.sql"
check "applying writes no existing data" "$(PSQL -At -c "$CHECKSUM")" "$BASE"

step "assertions: categories, conversion, roles, branch scope, peer comparison"
PSQL -f "$S/tests/isolated/03_assert_applied.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^.*NOTICE:  //'

step "idempotent re-apply of the reconciliation migration"
PSQL -1 -f "$S/migrations/20261009090000_doctor_sales_reconciliation_v1.sql"
check "registry still holds exactly the 4 proven devices" "$(PSQL -At -c "select string_agg(external_device_id, ',' order by external_device_id) from public.biometric_device_branches")" "101,102,GED7242701315,GED7242701324"

step "rollback: scope fix, then reconciliation"
PSQL -f "$S/sql/ROLLBACK_20261009_staff_sales_branch_scope_v1.sql"
check "scope rollback restores the production definitions byte for byte" "$(PSQL -At -c "$SALES_MD5")" "$EXPECTED_SALES_MD5"
PSQL -f "$S/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql"
check "rollbacks remove every object the migrations created" "$(PSQL -At -c "$OBJECTS")" ""
check "rollbacks change no invoice, punch, attendance, review or staff row" "$(PSQL -At -c "$CHECKSUM")" "$BASE"
PSQL -f "$S/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql"
echo "PASS: rollback is safe to run twice"

step "forward re-apply after rollback"
PSQL -1 -f "$S/migrations/20261009090000_doctor_sales_reconciliation_v1.sql"
PSQL -1 -f "$S/migrations/20261009120000_staff_sales_branch_scope_v1.sql"
PSQL -f "$S/tests/isolated/03_assert_applied.sql" 2>&1 | grep -cE "PASS" | xargs -I{} echo "PASS: {} assertions pass again after re-apply"
echo; echo "ISOLATED REHEARSAL: ALL STEPS PASSED"
