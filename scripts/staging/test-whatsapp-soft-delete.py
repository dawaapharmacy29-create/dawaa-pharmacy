#!/usr/bin/env python3
"""Isolated postgres:17 regression checks for 20261025100000_whatsapp_conversation_case_soft_delete_v1.

Runs the committed migration against the minimal tables it touches, plus the read-only capture of
the live case-set reconcile (scripts/staging/fixtures/sales-intelligence-reconcile-case-set-v2.production.sql)
so re-analysis is exercised with the real lifecycle writer. Synthetic ids only. No application DB
URL, secrets, project ID or remote host is accepted; only a running, unpublished postgres:17 container.
"""
import json
import pathlib
import re
import subprocess
import sys
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"[a-f0-9]{12,64}", CONTAINER):
    raise SystemExit("An isolated PostgreSQL Docker container ID is required")
info = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER], text=True))[0]
if info["Config"]["Image"] != "postgres:17" or not info["State"]["Running"]:
    raise SystemExit("Only the running postgres:17 test service is supported")
if any(info["NetworkSettings"]["Ports"].values()):
    raise SystemExit("The test service must not publish database ports")

MIGRATION = (ROOT / "supabase/migrations/20261025100000_whatsapp_conversation_case_soft_delete_v1.sql").read_text(encoding="utf8")
RECONCILE = (ROOT / "scripts/staging/fixtures/sales-intelligence-reconcile-case-set-v2.production.sql").read_text(encoding="utf8")


def command(app):
    return ["docker", "exec", "-i", "-e", f"PGAPPNAME={app}", CONTAINER,
            "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]


def run(query, expect_error=False, app="soft-delete-test"):
    result = subprocess.run(command(app), input=query, text=True, capture_output=True, timeout=30)
    if expect_error:
        if not result.returncode:
            raise AssertionError("expected an error, got success: " + result.stdout)
        return result.stderr
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def start(query, app):
    child = subprocess.Popen(command(app), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    child.stdin.write("set statement_timeout='10s';\n" + query + "\n")
    child.stdin.flush()
    return child


def holder(query):
    child = start("begin;\n" + query + "\n\\echo LOCKED", "soft-delete-holder")
    while True:
        line = child.stdout.readline().strip()
        if line == "LOCKED":
            return child
        if child.poll() is not None:
            raise AssertionError(child.stderr.read())


def wait_blocked(app):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if run(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock'") == "1":
            return
        time.sleep(0.05)
    raise AssertionError(f"{app} did not wait on the lock")


def finish(child, commit=True):
    if commit is not None:
        child.stdin.write(("commit;" if commit else "rollback;") + "\n")
    child.stdin.close()
    out = child.stdout.read()
    child.wait(timeout=12)
    return child.returncode, out, child.stderr.read()


checks = []


def check(name, condition, detail=""):
    checks.append((name, bool(condition)))
    print(f"{'PASS' if condition else 'FAIL'} {name}{(' — ' + str(detail)[-300:]) if detail and not condition else ''}")


SOURCE = "ee4f79b9-0000-4000-8000-000000000001"
OTHER_SOURCE = "ee4f79b9-0000-4000-8000-000000000002"
CUSTOMER = "c0000000-0000-4000-8000-000000000001"
INVOICE = "inv-74938-synthetic"
V22 = "d2200000-0000-4000-8000-000000000001"
GM = "a0000000-0000-4000-8000-000000000001"
PHARMACIST = "a0000000-0000-4000-8000-000000000002"
INACTIVE_GM = "a0000000-0000-4000-8000-000000000003"
SERVICE = SOURCE + ":interaction:0:session:0"
ORDER = SOURCE + ":interaction:0:session:2"
NURSING = SOURCE + ":interaction:1:session:2"
CASES = [SERVICE, ORDER, NURSING]
ANALYSIS = {SERVICE: "a1000000-0000-4000-8000-000000000001", ORDER: "a1000000-0000-4000-8000-000000000002",
            NURSING: "a1000000-0000-4000-8000-000000000003"}
REVIEW = {SERVICE: "e1000000-0000-4000-8000-000000000001", ORDER: "e1000000-0000-4000-8000-000000000002",
          NURSING: "e1000000-0000-4000-8000-000000000003"}
ACTION = {SERVICE: "f1000000-0000-4000-8000-000000000001", ORDER: "f1000000-0000-4000-8000-000000000002",
          NURSING: "f1000000-0000-4000-8000-000000000003"}
LEGACY_WORKED = "b50f4b70-0000-4000-8000-000000000001"
LEGACY_OPEN = "46ec37bf-0000-4000-8000-000000000001"
CASE_PHRASE = "حذف الحالة"
CONVERSATION_PHRASE = "حذف المحادثة وكل حالاتها"
REASON = "حالة مكررة أنشئت بالخطأ أثناء الاختبار"

SCHEMA = """
drop schema public cascade; create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='reader_test') then create role reader_test nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role, reader_test;
create table staff_accounts(id uuid primary key, name text, staff_name text, username text, role text,
  active boolean, can_login boolean);
create function dawaa_current_staff_account_id_strict() returns uuid language sql stable as
  $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create table customers(id uuid primary key, name text);
create table sales_invoices(id text primary key, invoice_number text, net_amount numeric, branch text);
create table sales_invoice_items(id serial primary key, invoice_id text references sales_invoices(id), item text, qty numeric);
create table whatsapp_review_sources(id uuid primary key, source_hash text not null unique, source_filename text,
  branch text, customer_id uuid, customer_code text, customer_name text, staff_name text,
  conversation_started_at timestamptz, conversation_ended_at timestamptz, message_count int default 0,
  review_status text default 'pending', raw_text text, matched_invoice_id uuid, matched_invoice_number text,
  invoice_link_confirmed boolean default false, invoice_link_confirmed_invoice_id text,
  invoice_link_confirmed_invoice_number text, reviewer_confirmed boolean default false, official_review_id uuid);
create table sales_intelligence_cases(case_id text primary key, conversation_id uuid not null references whatsapp_review_sources(id),
  source_case_id_v22 text, branch_name_raw text, case_started_at timestamptz not null default now(),
  case_ended_at timestamptz, is_active boolean not null default false, published_analysis_id uuid,
  retired_at timestamptz, retire_reason text, last_seen_at timestamptz default now());
create table sales_intelligence_case_analyses(analysis_id uuid primary key, case_id text not null, analysis_version int not null default 1,
  is_current boolean not null default false, superseded_at timestamptz, superseded_by_analysis_id uuid,
  case_type text, case_status text, analyzed_at timestamptz default now(), evidence_snapshot jsonb not null default '{}');
create table sales_intelligence_attributions(id uuid primary key default gen_random_uuid(), analysis_id uuid, case_id text,
  is_current_evaluation boolean, attribution_level text, selected_invoice_id text, selected_invoice_number text,
  is_official_for_staff_evaluation boolean default false);
create table whatsapp_customer_cases_v22(id uuid primary key, root_source_id uuid, source_ids uuid[] default '{}',
  case_json jsonb not null default '{}', verified_invoice_id text, verified_invoice_number text, verified_revenue numeric,
  confirmed_outcome text, proposed_outcome text);
create table conversation_sales_reviews(id uuid primary key default gen_random_uuid(), evaluation_kind text,
  is_current boolean not null default true, sales_intelligence_case_id text, whatsapp_review_source_id uuid,
  staff_name text, doctor_name text, final_score numeric, point_impact numeric, doctor_points_impact numeric,
  manager_reviewed_at timestamptz, superseded_at timestamptz, superseded_reason text, updated_at timestamptz);
-- Copy of the live AFTER trigger the restore must not trip (conversation_review_supersede_legacy_v2).
create function dawaa_supersede_legacy_review_on_automatic_v2() returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.is_current,true) is not true or lower(trim(coalesce(new.evaluation_kind,'')))<>'automatic'
     or new.whatsapp_review_source_id is null or new.sales_intelligence_case_id is null then return new; end if;
  update conversation_sales_reviews r set is_current=false, updated_at=now()
  where r.id<>new.id and r.whatsapp_review_source_id=new.whatsapp_review_source_id
    and r.sales_intelligence_case_id is null and coalesce(r.is_current,true)=true;
  return new;
end $$;
create trigger conversation_review_supersede_legacy_v2 after insert or update of is_current, evaluation_kind,
  whatsapp_review_source_id, sales_intelligence_case_id on conversation_sales_reviews
  for each row execute function dawaa_supersede_legacy_review_on_automatic_v2();
create table employee_transactions(id uuid primary key default gen_random_uuid(), source_id uuid, points numeric);
create table employee_events(id uuid primary key default gen_random_uuid(), source_id text, points_delta numeric);
create table whatsapp_conversation_actions(id uuid primary key default gen_random_uuid(), source_id uuid not null,
  action_key text not null, action_type text not null, status text not null, auto_eligible boolean not null default false,
  payload jsonb not null default '{}', target_table text, target_id text, assigned_at timestamptz,
  work_status text not null default 'unassigned', started_at timestamptz, completed_at timestamptz, outcome text,
  outcome_note text, followup_attempts int not null default 0, last_followup_at timestamptz,
  recovered_invoice_id text, recovered_invoice_number text, recovered_invoice_value numeric, recovered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz, unique(source_id, action_key));
create table whatsapp_review_audit(id uuid primary key default gen_random_uuid(), source_id uuid not null,
  action text not null, actor_id text, actor_name text, actor_role text, before_state jsonb, after_state jsonb,
  note text, created_at timestamptz not null default now());
create table revoke_log(v22_id uuid, reason text);
create function dawaa_revoke_whatsapp_canonical_sale_proof_v46(p uuid, r text, c jsonb) returns jsonb language plpgsql as
  $$ begin insert into revoke_log values (p, r); return jsonb_build_object('ok', true); end $$;
alter table whatsapp_review_sources enable row level security;
create policy reader_all on whatsapp_review_sources for select to reader_test using (true);
grant select on whatsapp_review_sources to reader_test;
"""


def seed(financial=False, worked_action=False, proof_owner=ORDER):
    run(SCHEMA)
    run(RECONCILE)
    run(MIGRATION)
    proof = {"canonicalSaleProof": {"state": "proven", "salesCaseId": proof_owner, "invoiceId": INVOICE}} if financial else {}
    v22_ledger = f"'{INVOICE}', '74938', 849, null, 'verified_sale'" if financial else "null, null, null, null, null"
    run(f"""
insert into staff_accounts values
  ('{GM}', 'المدير العام', null, 'gm', 'general_manager', true, true),
  ('{PHARMACIST}', 'دكتور', null, 'doc', 'pharmacist', true, true),
  ('{INACTIVE_GM}', 'مدير سابق', null, 'old', 'general_manager', false, true);
insert into customers values ('{CUSTOMER}', 'عميل تجريبي');
insert into sales_invoices values ('{INVOICE}', '74938', 849, 'فرع شكري');
insert into sales_invoice_items(invoice_id, item, qty) values ('{INVOICE}', 'محلول', 2), ('{INVOICE}', 'كانيولا', 1);
insert into whatsapp_review_sources(id, source_hash, source_filename, branch, customer_id, customer_code, customer_name,
  staff_name, conversation_started_at, conversation_ended_at, raw_text)
values ('{SOURCE}', 'hash-1', 'chat.txt', 'المخزن', '{CUSTOMER}', '18663', 'عميل تجريبي', 'د. شبل',
        '2026-09-27T07:54:00Z', '2026-09-28T01:08:00Z', 'text'),
       ('{OTHER_SOURCE}', 'hash-2', 'other.txt', 'فرع شكري', '{CUSTOMER}', '18663', 'عميل تجريبي', 'د. شبل',
        '2026-10-01T07:54:00Z', '2026-10-01T08:00:00Z', 'other');
insert into whatsapp_customer_cases_v22 values ('{V22}', '{SOURCE}', '{{}}', '{json.dumps(proof)}', {v22_ledger});
""")
    for i, case_id in enumerate(CASES):
        outcome = {"canonicalSalesOutcome": {"outcome": "sale_proven", "saleProofState": "proven"}} if financial and case_id == ORDER else {}
        run(f"""
insert into sales_intelligence_cases(case_id, conversation_id, source_case_id_v22, case_started_at, is_active, published_analysis_id)
  values ('{case_id}', '{SOURCE}', '{V22}', '2026-09-27T0{7 + i}:00:00Z', true, '{ANALYSIS[case_id]}');
insert into sales_intelligence_case_analyses(analysis_id, case_id, is_current, case_type, evidence_snapshot)
  values ('{ANALYSIS[case_id]}', '{case_id}', true, 'follow_up', '{json.dumps(outcome)}');
insert into conversation_sales_reviews(id, evaluation_kind, sales_intelligence_case_id, whatsapp_review_source_id, final_score, point_impact)
  values ('{REVIEW[case_id]}', 'automatic', '{case_id}', '{SOURCE}', 80, {5 if financial and case_id == ORDER else 0});
insert into whatsapp_conversation_actions(id, source_id, action_key, action_type, status, payload)
  values ('{ACTION[case_id]}', '{SOURCE}', 'canonical:{case_id}', 'followup', 'proposed', '{json.dumps({"caseId": case_id})}');
""")
    if financial:
        run(f"""
insert into sales_intelligence_attributions(analysis_id, case_id, is_current_evaluation, attribution_level, selected_invoice_id, selected_invoice_number)
  values ('{ANALYSIS[ORDER]}', '{ORDER}', true, 'proven', '{INVOICE}', '74938');
insert into employee_transactions(source_id, points) values ('{REVIEW[ORDER]}', 5);
""")
    # Legacy actions without a case id: one worked (sold, recovered invoice), one still open.
    worked = (f"'ready', 'completed', 'sold', '{INVOICE}', '74938', 849, now()" if worked_action
              else "'dismissed', 'unassigned', null, null, null, null, null")
    run(f"""
insert into whatsapp_conversation_actions(id, source_id, action_key, action_type, status, work_status, outcome,
  recovered_invoice_id, recovered_invoice_number, recovered_invoice_value, recovered_at)
  values ('{LEGACY_WORKED}', '{SOURCE}', 'legacy:worked', 'complaint_followup', {worked});
insert into whatsapp_conversation_actions(id, source_id, action_key, action_type, status)
  values ('{LEGACY_OPEN}', '{SOURCE}', 'legacy:open', 'followup', 'proposed');
insert into whatsapp_review_audit(source_id, action, note) values ('{SOURCE}', 'legacy_event', 'old audit');
""")


def as_actor(actor, query):
    return f"set test.actor = '{actor}';\n{query}"


def q(text):
    return "'" + text.replace("'", "''") + "'"


def preview(scope, target, actor=GM):
    return json.loads(run(as_actor(actor, f"select dawaa_preview_whatsapp_deletion_v1({q(scope)}, {q(target)})")))


def delete_case_sql(case_id, fingerprint, key, phrase=CASE_PHRASE, reason=REASON):
    return f"select dawaa_delete_whatsapp_case_v1({q(case_id)}, {q(reason)}, {q(phrase)}, {q(fingerprint)}, {q(key)});"


def delete_conversation_sql(source_id, fingerprint, key, phrase=CONVERSATION_PHRASE):
    return f"select dawaa_delete_whatsapp_conversation_v1({q(source_id)}, {q(REASON)}, {q(phrase)}, {q(fingerprint)}, {q(key)});"


def restore_sql(deletion_id, key, phrase="استرجاع"):
    return f"select dawaa_restore_whatsapp_deletion_v1({q(deletion_id)}, {q('استرجاع بعد مراجعة المدير العام')}, {q(phrase)}, {q(key)});"


def delete_case(case_id, key=None, actor=GM):
    fp = preview("case", case_id, actor)["fingerprint"]
    return json.loads(run(as_actor(actor, delete_case_sql(case_id, fp, key or f"key-{uuid.uuid4()}"))))


def key():
    return f"key-{uuid.uuid4()}"


def table_hash(table, without=()):
    cols = "".join(f" - '{c}'" for c in without)
    return run(f"select coalesce(md5(string_agg((to_jsonb(t){cols})::text, ',' order by to_jsonb(t)::text)), 'empty') from {table} t")


PRESERVED = ["customers", "sales_invoices", "sales_invoice_items", "whatsapp_customer_cases_v22",
             "sales_intelligence_attributions", "employee_transactions", "employee_events", "revoke_log"]


def preserved_hashes():
    return {t: table_hash(t) for t in PRESERVED}


def scalar(query):
    return run(query)


# ---- 0. The reconcile fixture is byte-for-byte the live definition. ----
seed()
check("reconcile fixture md5 equals the Production definition (ef4470ef…)",
      scalar("select md5(pg_get_functiondef('public.sales_intelligence_reconcile_case_set_v2'::regproc))") == "ef4470ef0413343c7cc57ed332ba243f")

# ---- 1. Authorization is decided in the database. ----
for label, actor in (("pharmacist", PHARMACIST), ("inactive general manager", INACTIVE_GM), ("no session", "")):
    for name, sql in (("preview", f"select dawaa_preview_whatsapp_deletion_v1('case', {q(SERVICE)})"),
                      ("delete case", delete_case_sql(SERVICE, "x", key())),
                      ("delete conversation", delete_conversation_sql(SOURCE, "x", key())),
                      ("restore", restore_sql(str(uuid.uuid4()), key())),
                      ("trash list", "select dawaa_list_whatsapp_deletions_v1()")):
        err = run(as_actor(actor, sql), expect_error=True)
        check(f"{label} cannot {name}", "whatsapp_deletion_general_manager_required" in err, err)
check("refused callers changed nothing", scalar("select count(*) from whatsapp_conversation_deletions") == "0"
      and scalar("select count(*) from sales_intelligence_cases where is_active") == "3")
for fn in ("dawaa_whatsapp_delete_scope_core_v1(text,text,text,text,text)", "dawaa_whatsapp_deletion_impact_v1(uuid,text,text[])"):
    check(f"internal {fn.split('(')[0]} is not executable by anon/authenticated",
          scalar(f"select has_function_privilege('anon','public.{fn}','EXECUTE') or has_function_privilege('authenticated','public.{fn}','EXECUTE')") == "f")

# ---- 2. Preview shows the scope; explicit, separate confirmation and a reason are required. ----
p = preview("case", SERVICE)
check("case preview lists the one case, the remaining sibling cases, its evaluation and its action",
      [c["caseId"] for c in p["cases"]] == [SERVICE]
      and sorted(c["caseId"] for c in p["remainingCases"]) == sorted([ORDER, NURSING])
      and [e["id"] for e in p["evaluations"]] == [REVIEW[SERVICE]] and p["evaluations"][0]["effect"] == "deactivate"
      and [a["id"] for a in p["actions"]] == [ACTION[SERVICE]] and p["actions"][0]["effect"] == "withdraw"
      and p["unscopedActionsUnchanged"] == 2 and not p["blocked"], p)
pc = preview("conversation", SOURCE)
check("conversation preview lists every case, evaluation, action and the V22 envelope",
      sorted(c["caseId"] for c in pc["cases"]) == sorted(CASES) and len(pc["evaluations"]) == 3
      and len(pc["actions"]) == 5 and [e["id"] for e in pc["v22Envelopes"]] == [V22] and pc["remainingCases"] == [], pc)
for label, sql, error in (
        ("case phrase is required", delete_case_sql(SERVICE, p["fingerprint"], key(), phrase="نعم"), "whatsapp_case_deletion_confirmation_required"),
        ("the conversation phrase does not confirm a case", delete_case_sql(SERVICE, p["fingerprint"], key(), phrase=CONVERSATION_PHRASE), "whatsapp_case_deletion_confirmation_required"),
        ("the case phrase does not confirm a conversation", delete_conversation_sql(SOURCE, pc["fingerprint"], key(), phrase=CASE_PHRASE), "whatsapp_conversation_deletion_confirmation_required"),
        ("a reason is required", delete_case_sql(SERVICE, p["fingerprint"], key(), reason="قصير"), "whatsapp_deletion_reason_required"),
        ("a stale preview is refused", delete_case_sql(SERVICE, "0" * 32, key()), "whatsapp_deletion_preview_stale")):
    err = run(as_actor(GM, sql), expect_error=True)
    check(label, error in err, err)
check("refused confirmations changed nothing", scalar("select count(*) from whatsapp_conversation_deletions") == "0"
      and scalar("select count(*) from whatsapp_review_audit") == "1")

# ---- 3. Delete ONE case: siblings, conversation and history stay. ----
before = preserved_hashes()
sibling_rows = table_hash(f"(select * from sales_intelligence_cases where case_id <> '{SERVICE}') ", ())
k1 = key()
r = json.loads(run(as_actor(GM, delete_case_sql(SERVICE, p["fingerprint"], k1))))
check("case deletion succeeds and reports the scope", r["ok"] and r["changed"] and r["caseIds"] == [SERVICE]
      and r["deactivatedEvaluations"] == 1 and r["withdrawnActions"] == 1, r)
deletion_case = r["deletionId"]
check("deleted case is inactive, marked and keeps its published analysis pointer",
      scalar(f"select is_active::text||'|'||retire_reason||'|'||(deletion_id::text='{deletion_case}')::text||'|'||published_analysis_id from sales_intelligence_cases where case_id='{SERVICE}'")
      == f"false|deleted_by_general_manager|true|{ANALYSIS[SERVICE]}")
check("sibling cases are untouched and active",
      table_hash(f"(select * from sales_intelligence_cases where case_id <> '{SERVICE}') ", ()) == sibling_rows
      and scalar("select count(*) from sales_intelligence_cases where is_active") == "2")
check("conversation stays live", scalar(f"select deleted_at is null from whatsapp_review_sources where id='{SOURCE}'") == "t")
check("deleted case leaves active evaluation; sibling evaluations stay current",
      scalar(f"select string_agg(sales_intelligence_case_id||':'||is_current, ',' order by sales_intelligence_case_id) from conversation_sales_reviews")
      == ",".join(f"{c}:{'false' if c == SERVICE else 'true'}" for c in sorted(CASES)))
check("deleted case leaves the work list; its proposal is withdrawn, not deleted",
      scalar(f"select status||'|'||(payload->>'deletionId') from whatsapp_conversation_actions where id='{ACTION[SERVICE]}'") == f"dismissed|{deletion_case}"
      and scalar("select count(*) from whatsapp_conversation_actions") == "5"
      and scalar(f"select string_agg(status, ',' order by id) from whatsapp_conversation_actions where id in ('{ACTION[ORDER]}','{ACTION[NURSING]}','{LEGACY_OPEN}')") == "proposed,proposed,proposed")
check("deleted case analysis is no longer current", scalar(f"select is_current from sales_intelligence_case_analyses where analysis_id='{ANALYSIS[SERVICE]}'") == "f")
audit = json.loads(scalar("select to_jsonb(a) from whatsapp_review_audit a where action='whatsapp_case_soft_deleted_v1'"))
check("audit records actor, time, reason, scope and every affected id",
      audit["actor_id"] == GM and audit["actor_role"] == "general_manager" and audit["note"] == REASON and audit["created_at"]
      and audit["after_state"]["scope"] == "case" and audit["after_state"]["caseIds"] == [SERVICE]
      and audit["after_state"]["deactivatedEvaluationIds"] == [REVIEW[SERVICE]]
      and audit["after_state"]["withdrawnActionIds"] == [ACTION[SERVICE]]
      and audit["after_state"]["deactivatedAnalysisIds"] == [ANALYSIS[SERVICE]]
      and audit["before_state"]["cases"][0]["isActive"] is True, audit)
check("customer, invoice, invoice items, V22 ledger, attributions, points and old audit untouched",
      preserved_hashes() == before and scalar("select count(*) from whatsapp_review_audit where action='legacy_event'") == "1")

# ---- 4. Retry / double click / concurrency. ----
again = json.loads(run(as_actor(GM, delete_case_sql(SERVICE, p["fingerprint"], k1))))
check("same request key replays without a second deletion or audit", again["changed"] is False and again["status"] == "replayed"
      and again["deletionId"] == deletion_case and scalar("select count(*) from whatsapp_review_audit where action like 'whatsapp_%'") == "1")
other = json.loads(run(as_actor(GM, delete_case_sql(SERVICE, p["fingerprint"], key()))))
check("another request for an already deleted case is a no-op", other["changed"] is False and other["status"] == "already_deleted")
err = run(as_actor(GM, delete_case_sql(ORDER, preview("case", ORDER)["fingerprint"], k1)), expect_error=True)
check("a request key cannot be reused for another target", "whatsapp_deletion_request_key_conflict" in err, err)

fp_order = preview("case", ORDER)["fingerprint"]
k2 = key()
first = holder(as_actor(GM, delete_case_sql(ORDER, fp_order, k2)))
second = start(as_actor(GM, delete_case_sql(ORDER, fp_order, k2)), "soft-delete-dup")
wait_blocked("soft-delete-dup")
finish(first)
code, out, err = finish(second, commit=None)
check("concurrent double click: the second waits, then replays", code == 0 and '"status": "replayed"' in out, err)
check("exactly one deletion and one audit for the double click",
      scalar(f"select count(*) from whatsapp_conversation_deletions where request_key='{k2}'") == "1"
      and scalar("select count(*) from whatsapp_review_audit where action='whatsapp_case_soft_deleted_v1'") == "2")

fp_nursing = preview("case", NURSING)["fingerprint"]
fp_conv = preview("conversation", SOURCE)["fingerprint"]
first = holder(as_actor(GM, delete_case_sql(NURSING, fp_nursing, key())))
second = start(as_actor(GM, delete_conversation_sql(SOURCE, fp_conv, key())), "soft-delete-race")
wait_blocked("soft-delete-race")
finish(first)
code, out, err = finish(second, commit=None)
check("case vs conversation race: the conversation command sees the changed scope and fails closed",
      code != 0 and "whatsapp_deletion_preview_stale" in err, err)
check("the race left exactly the case deletion", scalar("select count(*) from whatsapp_conversation_deletions") == "3"
      and scalar(f"select deleted_at is null from whatsapp_review_sources where id='{SOURCE}'") == "t")

# ---- 5. Audit failure aborts the deletion. ----
seed()
run("""create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit_store_down'; end $$;
       create trigger fail_audit before insert on whatsapp_review_audit for each row execute function fail_audit();""")
before_cases, before_reviews, before_actions = table_hash("sales_intelligence_cases"), table_hash("conversation_sales_reviews"), table_hash("whatsapp_conversation_actions")
err = run(as_actor(GM, delete_case_sql(SERVICE, preview("case", SERVICE)["fingerprint"], key())), expect_error=True)
check("audit failure raises", "audit_store_down" in err, err)
check("audit failure leaves no deletion: cases, evaluations, actions and trash unchanged",
      table_hash("sales_intelligence_cases") == before_cases and table_hash("conversation_sales_reviews") == before_reviews
      and table_hash("whatsapp_conversation_actions") == before_actions
      and scalar("select count(*) from whatsapp_conversation_deletions") == "0")
run("drop trigger fail_audit on whatsapp_review_audit;")

# ---- 6. Re-analysis never revives a deleted case. ----
r = delete_case(SERVICE)
deletion_case = r["deletionId"]
NEW_ANALYSIS = "a1000000-0000-4000-8000-0000000000ff"
NEW_ORDER = "a1000000-0000-4000-8000-0000000000fe"
run(f"""insert into sales_intelligence_case_analyses(analysis_id, case_id, analysis_version, is_current)
        values ('{NEW_ANALYSIS}', '{SERVICE}', 2, false), ('{NEW_ORDER}', '{ORDER}', 2, false);
        update sales_intelligence_cases set last_seen_at = now(), branch_name_raw = 'فرع شكري' where case_id = '{SERVICE}';""")
res = json.loads(scalar(f"""select sales_intelligence_reconcile_case_set_v2('{SOURCE}', array['{SERVICE}','{ORDER}','{NURSING}'],
  '{json.dumps({SERVICE: NEW_ANALYSIS, ORDER: NEW_ORDER, NURSING: ANALYSIS[NURSING]})}'::jsonb)"""))
check("live reconcile with the deleted case in the active set still reconciles the siblings", res["ok"] and res["status"] == "reconciled", res)
check("deleted case stays inactive and deleted after re-analysis",
      scalar(f"select is_active::text||'|'||coalesce(deletion_id::text,'')||'|'||retire_reason||'|'||published_analysis_id from sales_intelligence_cases where case_id='{SERVICE}'")
      == f"false|{deletion_case}|deleted_by_general_manager|{ANALYSIS[SERVICE]}")
check("re-analysis of the deleted case cannot become the current analysis",
      scalar(f"select count(*) from sales_intelligence_case_analyses where case_id='{SERVICE}' and is_current") == "0")
check("re-analysis still publishes the sibling's new analysis",
      scalar(f"select published_analysis_id from sales_intelligence_cases where case_id='{ORDER}'") == NEW_ORDER)
run(f"""insert into conversation_sales_reviews(evaluation_kind, sales_intelligence_case_id, whatsapp_review_source_id, final_score)
        values ('automatic', '{SERVICE}', '{SOURCE}', 90);""")
check("automatic evaluation follower cannot create an active evaluation for the deleted case",
      scalar(f"select count(*) from conversation_sales_reviews where sales_intelligence_case_id='{SERVICE}' and is_current") == "0")
err = run(f"""insert into conversation_sales_reviews(evaluation_kind, sales_intelligence_case_id, whatsapp_review_source_id)
              values ('واتساب', '{SERVICE}', '{SOURCE}')""", expect_error=True)
check("a manual evaluation of a deleted case is refused", "whatsapp_scope_deleted_restore_required" in err, err)
err = run(f"""insert into whatsapp_conversation_actions(source_id, action_key, action_type, status, payload)
              values ('{SOURCE}', 'canonical:new', 'followup', 'proposed', '{json.dumps({"caseId": SERVICE})}')""", expect_error=True)
check("projection cannot publish a new proposal for the deleted case", "whatsapp_scope_deleted_restore_required" in err, err)
err = run(f"update whatsapp_conversation_actions set status='proposed' where id='{ACTION[SERVICE]}'", expect_error=True)
check("the withdrawn proposal cannot be reopened", "whatsapp_scope_deleted_restore_required" in err, err)
for label, sql in (("clearing deleted_at", f"update sales_intelligence_cases set deleted_at=null, deletion_id=null where case_id='{SERVICE}'"),
                   ("marking a source deleted", f"update whatsapp_review_sources set deleted_at=now(), deletion_id='{deletion_case}' where id='{OTHER_SOURCE}'")):
    err = run(sql, expect_error=True)
    check(f"even a privileged writer cannot change deletion state outside the command ({label})", "whatsapp_deletion_requires_command" in err, err)
run(f"update sales_intelligence_cases set is_active=true, retire_reason=null where case_id='{SERVICE}'")
check("a direct reactivation is frozen back", scalar(f"select is_active from sales_intelligence_cases where case_id='{SERVICE}'") == "f")

# ---- 7. Restore from the trash: same rows, new audit event, no duplicates. ----
trash = json.loads(run(as_actor(GM, "select dawaa_list_whatsapp_deletions_v1()")))
check("trash lists the deletion with its reason and actor", [t["id"] for t in trash] == [deletion_case]
      and trash[0]["reason"] == REASON and trash[0]["deletedBy"] == "المدير العام" and trash[0]["restorable"] is True, trash)
before = preserved_hashes()
reviews_before = scalar("select count(*) from conversation_sales_reviews")
actions_before = scalar("select count(*) from whatsapp_conversation_actions")
rk = key()
err = run(as_actor(GM, restore_sql(deletion_case, rk, phrase="نعم")), expect_error=True)
check("restore needs its explicit confirmation", "whatsapp_restore_confirmation_required" in err, err)
res = json.loads(run(as_actor(GM, restore_sql(deletion_case, rk))))
check("restore succeeds", res["ok"] and res["changed"] and res["restoredEvaluationIds"] == [REVIEW[SERVICE]]
      and res["restoredActionIds"] == [ACTION[SERVICE]], res)
check("restored case is active again with its original published analysis",
      scalar(f"select is_active::text||'|'||published_analysis_id||'|'||(deleted_at is null)::text from sales_intelligence_cases where case_id='{SERVICE}'")
      == f"true|{ANALYSIS[SERVICE]}|true")
check("exactly one current analysis for the restored case (the staged re-analysis stays staged)",
      scalar(f"select string_agg(analysis_id::text, ',') from sales_intelligence_case_analyses where case_id='{SERVICE}' and is_current") == ANALYSIS[SERVICE])
check("the same evaluation is current again; no evaluation row is created",
      scalar(f"select string_agg(id::text, ',') from conversation_sales_reviews where sales_intelligence_case_id='{SERVICE}' and is_current") == REVIEW[SERVICE]
      and scalar("select count(*) from conversation_sales_reviews") == reviews_before)
check("the same proposal is open again; no action row is created",
      scalar(f"select status||'|'||coalesce(payload->>'deletionId','none') from whatsapp_conversation_actions where id='{ACTION[SERVICE]}'") == "proposed|none"
      and scalar("select count(*) from whatsapp_conversation_actions") == actions_before)
check("restore writes a new audit event and keeps the deletion event",
      scalar("select string_agg(action, ',' order by created_at, action) from whatsapp_review_audit where action like 'whatsapp_case_%'")
      == "whatsapp_case_soft_deleted_v1,whatsapp_case_restored_v1")
check("restore did not touch invoices, revenue, attributions or points", preserved_hashes() == before)
again = json.loads(run(as_actor(GM, restore_sql(deletion_case, rk))))
check("restore retry with the same key replays", again["changed"] is False and again["status"] == "replayed")
again = json.loads(run(as_actor(GM, restore_sql(deletion_case, key()))))
check("a second restore is a no-op", again["changed"] is False and again["status"] == "already_restored"
      and scalar("select count(*) from whatsapp_review_audit where action='whatsapp_case_restored_v1'") == "1")
check("trash row keeps both events", scalar(f"select status||'|'||(restored_at is not null)::text from whatsapp_conversation_deletions where id='{deletion_case}'") == "restored|true")

# Concurrent restores: one restore, one replay/no-op.
r = delete_case(NURSING)
k3 = key()
first = holder(as_actor(GM, restore_sql(r["deletionId"], k3)))
second = start(as_actor(GM, restore_sql(r["deletionId"], key())), "soft-delete-restore-2")
wait_blocked("soft-delete-restore-2")
finish(first)
code, out, err = finish(second, commit=None)
check("concurrent restores: the second waits and is a no-op", code == 0 and '"already_restored"' in out, err)
check("still exactly one current evaluation per case after concurrent restores",
      scalar("select max(n) from (select count(*) n from conversation_sales_reviews where is_current group by sales_intelligence_case_id) x") == "1")

# Restore must not silently retire an evaluation written while the case was deleted.
r = delete_case(SERVICE)
run(f"insert into conversation_sales_reviews(id, evaluation_kind, whatsapp_review_source_id, point_impact) values ('e1000000-0000-4000-8000-0000000000aa', 'واتساب', '{SOURCE}', 3)")
res = json.loads(run(as_actor(GM, restore_sql(r["deletionId"], key()))))
check("restore is blocked when it would supersede a newer conversation evaluation", res["ok"] is False
      and res["blockers"][0]["code"] == "restore_would_supersede_conversation_evaluation", res)
check("the blocked restore changed nothing", scalar("select is_current from conversation_sales_reviews where id='e1000000-0000-4000-8000-0000000000aa'") == "t"
      and scalar(f"select deleted_at is not null from sales_intelligence_cases where case_id='{SERVICE}'") == "t")

# ---- 8. Delete a conversation with all its cases. ----
seed()
k4 = key()
pc = preview("conversation", SOURCE)
before = preserved_hashes()
res = json.loads(run(as_actor(GM, delete_conversation_sql(SOURCE, pc["fingerprint"], k4))))
check("conversation deletion succeeds", res["ok"] and res["changed"] and sorted(res["caseIds"]) == sorted(CASES)
      and res["deactivatedEvaluations"] == 3 and res["withdrawnActions"] == 4, res)
deletion_conv = res["deletionId"]
check("conversation and every case are marked deleted", scalar(f"select deletion_id from whatsapp_review_sources where id='{SOURCE}'") == deletion_conv
      and scalar(f"select count(*) from sales_intelligence_cases where deletion_id='{deletion_conv}' and not is_active") == "3")
check("no active evaluation and no open action remain for the conversation",
      scalar(f"select count(*) from conversation_sales_reviews where whatsapp_review_source_id='{SOURCE}' and is_current") == "0"
      and scalar(f"select count(*) from whatsapp_conversation_actions where source_id='{SOURCE}' and status in ('proposed','ready','error')") == "0")
check("rows are kept (logical deletion only)", scalar("select count(*) from whatsapp_conversation_actions") == "5"
      and scalar("select count(*) from conversation_sales_reviews") == "3" and scalar("select count(*) from sales_intelligence_cases") == "3")
check("other conversations of the customer are untouched", scalar(f"select deleted_at is null from whatsapp_review_sources where id='{OTHER_SOURCE}'") == "t")
check("customer, invoice, items, V22 ledger, points and old audit untouched by conversation deletion",
      preserved_hashes() == before and scalar("select count(*) from whatsapp_review_audit where action='legacy_event'") == "1")
check("a client reader no longer sees the deleted conversation",
      run("set role reader_test; select string_agg(id::text, ',' order by id) from whatsapp_review_sources;") == OTHER_SOURCE)
err = run("insert into whatsapp_review_sources(id, source_hash) values (gen_random_uuid(), 'hash-1')", expect_error=True)
check("re-uploading the deleted export does not create a live copy", "whatsapp_source_deleted_restore_required" in err, err)
err = run(f"insert into sales_intelligence_cases(case_id, conversation_id) values ('{SOURCE}:interaction:9', '{SOURCE}')", expect_error=True)
check("re-analysis cannot add a new case to a deleted conversation", "whatsapp_scope_deleted_restore_required" in err, err)
res = json.loads(scalar(f"select sales_intelligence_reconcile_case_set_v2('{SOURCE}', array['{ORDER}'], '{json.dumps({ORDER: ANALYSIS[ORDER]})}'::jsonb)"))
check("re-analysis of the deleted conversation keeps all cases deleted",
      scalar(f"select count(*) from sales_intelligence_cases where conversation_id='{SOURCE}' and (is_active or deleted_at is null)") == "0"
      and scalar("select count(*) from revoke_log") == "0", res)
res = json.loads(run(as_actor(GM, delete_case_sql(SERVICE, "x", key()))))
check("a case of a deleted conversation is not deleted twice", res["changed"] is False and res["status"] == "already_deleted"
      and res["deletionId"] == deletion_conv, res)
res = json.loads(run(as_actor(GM, restore_sql(deletion_conv, key()))))
check("conversation restore brings back the conversation, all cases, evaluations and proposals",
      res["ok"] and scalar(f"select deleted_at is null from whatsapp_review_sources where id='{SOURCE}'") == "t"
      and scalar(f"select count(*) from sales_intelligence_cases where conversation_id='{SOURCE}' and is_active and deleted_at is null") == "3"
      and scalar(f"select count(*) from conversation_sales_reviews where whatsapp_review_source_id='{SOURCE}' and is_current") == "3"
      and scalar(f"select count(*) from whatsapp_conversation_actions where source_id='{SOURCE}' and status='proposed'") == "4", res)
check("conversation restore created no rows", scalar("select count(*) from whatsapp_conversation_actions") == "5"
      and scalar("select count(*) from conversation_sales_reviews") == "3")

# A case deleted before its conversation keeps its own deletion; it is restored only explicitly.
seed()
first_case = delete_case(SERVICE)
res = json.loads(run(as_actor(GM, delete_conversation_sql(SOURCE, preview("conversation", SOURCE)["fingerprint"], key()))))
check("conversation deletion covers only the cases still live", sorted(res["caseIds"]) == sorted([ORDER, NURSING]), res)
err = run(as_actor(GM, restore_sql(first_case["deletionId"], key())), expect_error=True)
check("a case of a deleted conversation is restored only after the conversation", "whatsapp_restore_conversation_first" in err, err)
run(as_actor(GM, restore_sql(res["deletionId"], key())))
check("restoring the conversation does not revive the separately deleted case",
      scalar(f"select deletion_id from sales_intelligence_cases where case_id='{SERVICE}'") == first_case["deletionId"]
      and scalar(f"select count(*) from sales_intelligence_cases where is_active") == "2")

# ---- 9. Proven invoice, revenue and possible incentive: nothing is deleted or duplicated. ----
seed(financial=True, worked_action=True)
before_all = {t: table_hash(t) for t in PRESERVED + ["sales_intelligence_cases", "conversation_sales_reviews",
                                                     "whatsapp_conversation_actions", "whatsapp_review_audit",
                                                     "sales_intelligence_case_analyses", "whatsapp_review_sources"]}
p = preview("case", ORDER)
codes = sorted({b["code"] for b in p["blockers"]})
check("order case preview shows the proof, the proven invoice, the proven outcome and the points",
      p["blocked"] and {"canonical_sale_proof_in_scope", "proven_invoice_attribution", "canonical_sale_proven",
                        "evaluation_has_points_or_incentive"} <= set(codes), codes)
res = json.loads(run(as_actor(GM, delete_case_sql(ORDER, p["fingerprint"], key()))))
check("deleting the proven order case is refused with its impact", res["ok"] is False and res["status"] == "blocked"
      and len(res["blockers"]) >= 4, res)
pc = preview("conversation", SOURCE)
res = json.loads(run(as_actor(GM, delete_conversation_sql(SOURCE, pc["fingerprint"], key()))))
codes = {b["code"] for b in res.get("blockers", [])}
check("deleting the conversation is refused: proof, revenue/points and the worked sold action",
      res["ok"] is False and {"canonical_sale_proof_in_scope", "action_has_recovered_invoice"} <= codes, codes)
check("refused financial deletions changed nothing (ledger, proof, points, cases, actions, audit)",
      all(table_hash(t) == h for t, h in before_all.items()) and scalar("select count(*) from whatsapp_conversation_deletions") == "0")
before = preserved_hashes()
res = delete_case(SERVICE)
check("a non-financial sibling case of the proven conversation can still be deleted", res["ok"] and res["changed"], res)
check("…without revoking the proof, changing revenue or points, or touching the invoice",
      preserved_hashes() == before and scalar("select count(*) from revoke_log") == "0"
      and scalar(f"select verified_revenue||'|'||(case_json#>>'{{canonicalSaleProof,salesCaseId}}') from whatsapp_customer_cases_v22 where id='{V22}'") == f"849|{ORDER}")
run(as_actor(GM, restore_sql(res["deletionId"], key())))
check("restore of that case does not duplicate revenue, proof or points", preserved_hashes() == before
      and scalar("select count(*) from employee_transactions") == "1" and scalar("select count(*) from whatsapp_customer_cases_v22") == "1")
seed(financial=True, proof_owner="")
codes = {b["code"] for b in preview("case", NURSING)["blockers"]}
check("a proven proof with an unknown owner blocks any case deletion", "canonical_sale_proof_owner_unknown" in codes, codes)

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
if failed:
    raise SystemExit("FAILED: " + "; ".join(failed))
