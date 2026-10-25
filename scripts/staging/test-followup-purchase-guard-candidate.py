#!/usr/bin/env python3
"""Replays dawaa_capture_whatsapp_canonical_purchase_v36 (captured live definition) and the v47
candidate guard on a disposable postgres:17 container, against the minimal tables the function
touches. Proves the live defect reproduces and that the candidate only narrows the follow-up
closure. No application DB URL, secrets, project ID or remote host is accepted.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"[a-f0-9]{12,64}", CONTAINER):
    raise SystemExit("An isolated PostgreSQL Docker container ID is required")
info = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER], text=True))[0]
if info["Config"]["Image"] != "postgres:17" or not info["State"]["Running"]:
    raise SystemExit("Only the running postgres:17 test service is supported")
if any(info["NetworkSettings"]["Ports"].values()):
    raise SystemExit("The test service must not publish database ports")


def sql(query):
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1"],
        input=query, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def function_from(path, marker):
    text = (ROOT / path).read_text(encoding="utf8")
    start = text.index(marker)
    end = text.index("$function$;", start) + len("$function$;")
    return text[start:end]


MARKER = "CREATE OR REPLACE FUNCTION public.dawaa_capture_whatsapp_canonical_purchase_v36()"
LIVE = function_from("supabase/migrations/20261009200000_capture_production_canonical_si_writers_v1.sql", MARKER)
CANDIDATE = function_from("docs/whatsapp-v47-followup-purchase-guard/purchase-closure-guard-candidate.sql", MARKER)

SCHEMA = """
drop schema public cascade; create schema public;
create table whatsapp_customer_stories(
  id uuid primary key, customer_id uuid, customer_code text, customer_phone text, branch text,
  status text, recovery_started_at timestamptz, recovered_at timestamptz, recovered_invoice_id text,
  recovered_invoice_number text, recovered_invoice_value numeric, last_verified_purchase_value numeric,
  last_verified_purchase_at timestamptz, last_activity_at timestamptz, updated_at timestamptz,
  created_at timestamptz default now());
create table whatsapp_customer_journeys(
  id uuid primary key, story_id uuid, journey_started_at timestamptz, lifecycle_status text,
  recovered_at timestamptz, recovered_invoice_id text, recovered_invoice_number text,
  recovered_invoice_value numeric, updated_at timestamptz);
create table whatsapp_customer_story_events(
  story_id uuid, event_key text, event_type text, event_at timestamptz, journey_id uuid, source_id uuid,
  invoice_id text, invoice_number text, invoice_value numeric, confidence int, title text, detail text,
  payload jsonb, unique(story_id, event_key));
create table sales_invoices(id text primary key, invoice_datetime timestamptz, invoice_number text,
  net_amount numeric, total_amount numeric, amount numeric);
create table whatsapp_conversation_actions(
  id text primary key, source_id uuid, action_type text, action_key text, work_status text,
  customer_id uuid, customer_code text, customer_phone text, branch text, created_at timestamptz,
  due_at timestamptz, completed_at timestamptz, outcome text, outcome_note text,
  recovered_invoice_id text, recovered_invoice_number text, recovered_invoice_value numeric,
  recovered_at timestamptz, updated_at timestamptz, payload jsonb default '{}'::jsonb);
create table whatsapp_customer_cases_v22(
  id uuid primary key, story_id uuid, journey_id uuid, root_source_id uuid, source_ids uuid[],
  customer_id uuid, customer_code text, customer_phone text, branch text, confirmed_outcome text,
  proposed_outcome text, verified_invoice_id text, verified_sale_at timestamptz,
  verified_invoice_number text, verified_revenue numeric, last_event_at timestamptz, case_json jsonb);
create function dawaa_customer_request_branch_key(value text) returns text language sql immutable
  as $$ select lower(trim(coalesce(value, ''))) $$;
create function dawaa_refresh_whatsapp_customer_story_v16(p_story_id uuid) returns void
  language sql as $$ select $$;
"""

CUSTOMER = "39e278d3-3840-49ba-a9c6-658a44fcba81"
STORY = "23008a60-7096-4172-8940-8e421124c2df"
SOURCE = "ee4f79b9-7a32-48c6-93b8-ecdfa01b6aed"
OTHER_SOURCE = "11111111-1111-4111-8111-111111111111"
ORDER_CASE = SOURCE + ":interaction:0:session:2"
SERVICE_CASE = SOURCE + ":interaction:0:session:0"


def scenario(fn, action_source, action_payload, root_source, invoice_at):
    """One follow-up, one canonical verified sale. Returns the action's outcome after the trigger."""
    sql(SCHEMA)
    sql(fn)
    sql(f"""
create trigger capture after insert on whatsapp_customer_cases_v22
  for each row execute function dawaa_capture_whatsapp_canonical_purchase_v36();
insert into whatsapp_customer_stories(id, customer_id, customer_code, branch, status, recovery_started_at)
  values ('{STORY}', '{CUSTOMER}', '18663', 'المخزن', 'recovery', '2026-09-27T07:54:07Z');
insert into whatsapp_customer_story_events(story_id, event_key, event_type, event_at)
  values ('{STORY}', 'recovery:case:1790495647000-0', 'recovery_attempt', '2026-09-27T07:54:07Z');
insert into sales_invoices values ('inv', '{invoice_at}', '74938', 849, 849, 849);
insert into whatsapp_conversation_actions(id, source_id, action_type, action_key, work_status, customer_id,
  customer_code, branch, created_at, payload)
  values ('followup', '{action_source}', 'complaint_followup', 'complaint-followup', 'unassigned',
    '{CUSTOMER}', '18663', 'المخزن', '2026-09-28T05:18:05Z', '{json.dumps(action_payload)}'::jsonb);
insert into whatsapp_customer_cases_v22(id, story_id, root_source_id, source_ids, customer_id, customer_code,
  branch, proposed_outcome, verified_invoice_id, verified_sale_at, case_json)
  values (gen_random_uuid(), '{STORY}', '{root_source}', array['{root_source}']::uuid[], '{CUSTOMER}', '18663',
    'المخزن', 'verified_sale', 'inv', '{invoice_at}',
    jsonb_build_object('canonicalSaleProof', jsonb_build_object('state', 'proven', 'salesCaseId', '{ORDER_CASE}')));
""")
    return sql("select coalesce(work_status,'') || '/' || coalesce(outcome,'') from whatsapp_conversation_actions where id='followup'")


CASES = [
    # name, action source, action payload, sale root source, invoice time, live expected, candidate expected
    ("b50f4b70 shape: older invoice of a sibling case", SOURCE, {}, SOURCE, "2026-09-27T22:06:00Z", "completed/sold", "unassigned/"),
    ("same customer, sibling case, later invoice", SOURCE, {"caseId": SERVICE_CASE}, SOURCE, "2026-09-28T09:00:00Z", "completed/sold", "unassigned/"),
    ("same case, later invoice", SOURCE, {"caseId": ORDER_CASE}, SOURCE, "2026-09-28T09:00:00Z", "completed/sold", "completed/sold"),
    ("same case, invoice older than the follow-up", SOURCE, {"caseId": ORDER_CASE}, SOURCE, "2026-09-27T22:06:00Z", "completed/sold", "unassigned/"),
    ("later purchase in another conversation", SOURCE, {}, OTHER_SOURCE, "2026-09-29T09:00:00Z", "completed/sold", "completed/sold"),
]

failed = 0
for name, action_source, payload, root, invoice_at, live_expected, candidate_expected in CASES:
    for label, fn, expected in (("live", LIVE, live_expected), ("candidate", CANDIDATE, candidate_expected)):
        got = scenario(fn, action_source, payload, root, invoice_at)
        ok = got == expected
        failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} [{label}] {name}: {got} (expected {expected})")

if failed:
    raise SystemExit(f"{failed} follow-up purchase guard checks failed")
print(f"{len(CASES) * 2} follow-up purchase guard checks passed. Isolated container only.")
