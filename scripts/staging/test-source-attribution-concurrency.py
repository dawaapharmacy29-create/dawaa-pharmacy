#!/usr/bin/env python3
"""Actual PostgreSQL multi-session tests for 20261020153000, restricted to a disposable CI container.

No application DB URL, secrets, project ID, remote host or production credentials accepted.
Run with the GitHub Actions postgres service container ID; no ports need to be published.
Synthetic ids only; mirrors the isolated PGlite fixture so both suites exercise one schema.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"[a-f0-9]{12,64}", CONTAINER):
    raise SystemExit("An isolated PostgreSQL Docker container ID is required")
info = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER], text=True))[0]
if info["Config"]["Image"] != "postgres:17" or not info["State"]["Running"]:
    raise SystemExit("Only the running postgres:17 test service is supported")
if any(info["NetworkSettings"]["Ports"].values()):
    raise SystemExit("The test service must not publish database ports")


def command(app):
    return ["docker", "exec", "-i", "-e", f"PGAPPNAME={app}", CONTAINER,
            "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]


def sql(query, app="v36-test"):
    result = subprocess.run(command(app), input=query, text=True, capture_output=True, timeout=20)
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
    child = start("begin;\n" + query + "\n\\echo LOCKED", "v36-holder")
    while True:
        line = child.stdout.readline().strip()
        if line == "LOCKED":
            return child
        if child.poll() is not None:
            raise AssertionError(child.stderr.read())


def release(child, query="commit;"):
    child.stdin.write(query + "\n")
    child.stdin.close()
    child.wait(timeout=12)
    if child.returncode:
        raise AssertionError(child.stderr.read())


def wait_blocked(app):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock'") == "1":
            return
        time.sleep(0.05)
    raise AssertionError(f"{app} did not wait on the row lock")


def finish(child, error=None):
    child.stdin.close()
    stdout = child.stdout.read()
    child.wait(timeout=12)
    stderr = child.stderr.read()
    if error:
        assert child.returncode and error in stderr, stderr
    else:
        assert child.returncode == 0, stderr
    return stdout


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def text(value):
    return "'" + value.replace("'", "''") + "'"


SOURCE = "11111111-1111-4111-8111-111111111111"
CASE = SOURCE + ":interaction:0"
CUSTOMER = "33333333-3333-4333-8333-333333333333"
GM = "44444444-4444-4444-8444-444444444444"
BRANCH_STAFF = "44444444-4444-4444-8444-555555555555"
OTHER_BRANCH_STAFF = "44444444-4444-4444-8444-777777777777"
PRODUCT = "55555555-5555-4555-8555-555555555555"
ANALYSIS = "66666666-6666-4666-8666-666666666666"
STARTED, ENDED = "2026-10-20T02:00:00.000Z", "2026-10-20T02:02:00.000Z"
REQUEST_KEY = f"cr1|{CASE}:demand:product:{PRODUCT}"
IDENTITY = "fu1|chat:x|2026-10-20T02:00:00.000Z|customer-request|cataflam"
CREATOR = "si-canonical-customer-request-projection-v1"
REASON = "تصحيح مثال تجريبي متزامن"
AUTH = """set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';set test.permission='true';
          set test.source_access='true';set test.branch_access='true';"""


def digest(raw):
    return hashlib.sha256(f"{STARTED}|{ENDED}|{raw}".encode("utf-8")).hexdigest()


def correction(expected_raw, raw, staff, cover=False):
    return (f"select dawaa_correct_whatsapp_source_attribution_v1('{SOURCE}','{digest(expected_raw)}',"
            f"{text(raw)},'{digest(raw)}','{staff}','فرع شكري',{text(REASON)},{str(cover).lower()});")


def reset(raw="old text", branch="كل الفروع", staff=GM, request_staff=None, approved=False):
    request = ""
    if request_staff:
        payload = {"caseId": CASE, "requestKey": REQUEST_KEY}
        if approved:
            payload.update({"approvalSource": "human_review_v2", "approvedBy": "x", "approvedAt": "2026-10-20T03:00:00Z"})
        request = f"""
          insert into whatsapp_conversation_actions(source_id,action_key,action_type,status,auto_eligible,branch,
            customer_id,customer_name,staff_id,product_id,product_code,confidence,quantity,followup_identity,created_by,payload)
          values('{SOURCE}','canonical-request:{IDENTITY}','customer_request','{"ready" if approved else "proposed"}',
            {str(approved).lower()},'فرع شكري','{CUSTOMER}','Synthetic customer','{request_staff}','{PRODUCT}','28784',90,1,
            '{IDENTITY}','{CREATOR}',{literal(payload)});"""
    snapshot = {"canonicalCustomerRequestAssessment": {"requests": [
        {"requestKey": REQUEST_KEY, "status": "qualified", "productId": PRODUCT}]},
        "caseIntelligence": {"followUp": {"opportunities": []}, "staff": {"participants": [], "facts": []}}}
    sql(f"""
      truncate whatsapp_conversation_actions,sales_intelligence_case_analyses,sales_intelligence_cases,
        whatsapp_review_source_hash_aliases,whatsapp_review_sources,whatsapp_review_audit,customer_requests,staff,
        staff_accounts,customers,products;
      insert into staff values('{GM}','GM','كل الفروع',true,true),('{BRANCH_STAFF}','Branch doctor','فرع شكري',true,true),
        ('{OTHER_BRANCH_STAFF}','Other doctor','فرع الشامي',true,true);
      insert into staff_accounts values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Reviewer','Reviewer','reviewer','admin');
      insert into customers values('{CUSTOMER}','Synthetic customer');
      insert into products values('{PRODUCT}','28784');
      insert into whatsapp_review_sources(id,customer_id,customer_name,customer_code,branch,staff_id,staff_name,raw_text,
        source_hash,conversation_started_at,conversation_ended_at)
        values('{SOURCE}','{CUSTOMER}','Synthetic customer','TEST','{branch}','{staff}','doctor',{text(raw)},'{digest(raw)}',
          '{STARTED}','{ENDED}');
      insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values('{CASE}','{SOURCE}','{ANALYSIS}');
      insert into sales_intelligence_case_analyses(analysis_id,case_id,is_current,evidence_snapshot)
        values('{ANALYSIS}','{CASE}',true,{literal(snapshot)});
      {request}
    """)


def count(query):
    return int(sql(query))


schema = [ROOT / "scripts/staging/fixtures/canonical-followup-lifecycle.sql",
          ROOT / "scripts/staging/fixtures/source-attribution-correction.sql"]
for suffix in ["_canonical_followup_projection_lifecycle.sql", "_customer_request_materialization_retry_v1.sql",
               "_whatsapp_source_attribution_correction_v1.sql"]:
    found = list((ROOT / "supabase/migrations").glob("*" + suffix))
    assert len(found) == 1, suffix
    schema.append(found[0])
sql("\n".join(path.read_text(encoding="utf-8") for path in schema))

# 1. Two different corrections of the same source: the second waits, then fails closed.
reset()
first = holder(AUTH + correction("old text", "corrected A", BRANCH_STAFF))
second = start(AUTH + correction("old text", "corrected B", OTHER_BRANCH_STAFF, True), "v36-correction-2")
wait_blocked("v36-correction-2")
release(first)
finish(second, "source_attribution_source_changed")
assert count("select count(*) from whatsapp_review_audit") == 1
assert sql(f"select staff_id||'|'||raw_text from whatsapp_review_sources where id='{SOURCE}'") == f"{BRANCH_STAFF}|corrected A"

# 2. Two identical corrections: exactly one audited change, the replay is a no-op.
reset()
first = holder(AUTH + correction("old text", "corrected A", BRANCH_STAFF))
second = start(AUTH + correction("old text", "corrected A", BRANCH_STAFF), "v36-correction-same")
wait_blocked("v36-correction-same")
release(first)
assert '"changed": false' in finish(second)
assert count("select count(*) from whatsapp_review_audit") == 1

# 3. Two concurrent approvals of one proposal: one approval audit, the second is a read.
reset("corrected A", "فرع شكري", BRANCH_STAFF, BRANCH_STAFF)
action = sql("select id from whatsapp_conversation_actions limit 1")
first = holder(AUTH + f"select dawaa_approve_whatsapp_customer_request_action_v2('{action}');")
second = start(AUTH + f"select dawaa_approve_whatsapp_customer_request_action_v2('{action}');", "v36-approve-2")
wait_blocked("v36-approve-2")
release(first)
assert '"already_approved": true' in finish(second)
assert count("select count(*) from whatsapp_review_audit where action='customer_request_action_approved_v2'") == 1

# 4. Two concurrent executions of one approved request: exactly one customer request.
reset("corrected A", "فرع شكري", BRANCH_STAFF, BRANCH_STAFF, approved=True)
action = sql("select id from whatsapp_conversation_actions limit 1")
first = holder(AUTH + f"select dawaa_materialize_whatsapp_action_v1('{action}');")
second = start(AUTH + f"select dawaa_materialize_whatsapp_action_v1('{action}');", "v36-execute-2")
wait_blocked("v36-execute-2")
release(first)
assert '"already_created": true' in finish(second)
assert count("select count(*) from customer_requests") == 1

# 5. A refresh that read the source before an in-flight correction cannot publish a stale proposal.
reset("corrected A", "فرع شكري", BRANCH_STAFF)
first = holder(AUTH + correction("corrected A", "corrected B", OTHER_BRANCH_STAFF, True))
stale = start(f"""insert into whatsapp_conversation_actions(source_id,action_key,action_type,status,branch,staff_id,
  product_id,followup_identity,created_by) values('{SOURCE}','canonical-request:{IDENTITY}','customer_request','proposed',
  'فرع شكري','{BRANCH_STAFF}','{PRODUCT}','{IDENTITY}','{CREATOR}');""", "v36-stale-projection")
wait_blocked("v36-stale-projection")
release(first)
finish(stale, "canonical_request_projection_stale_source")
assert count("select count(*) from whatsapp_conversation_actions where status in ('proposed','ready')") == 0

# 6. Re-uploading the pre-correction export while the correction is in flight waits on the shared
#    hash lock, then is refused; it never becomes a second operational source.
reset()
first = holder(AUTH + correction("old text", "corrected A", BRANCH_STAFF))
upload = start(f"""insert into whatsapp_review_sources(id,customer_name,branch,source_hash)
  values(gen_random_uuid(),'Synthetic re-upload','كل الفروع','{digest("old text")}');""", "v36-old-upload")
wait_blocked("v36-old-upload")
release(first)
finish(upload, "source_hash_superseded_by_correction")
assert count("select count(*) from whatsapp_review_sources") == 1
assert count(f"select count(*) from whatsapp_review_source_hash_aliases where source_id='{SOURCE}'") == 1

print("PASS: concurrent corrections, approvals, executions, stale projections and re-uploads serialize without duplicates")
