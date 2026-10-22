#!/usr/bin/env python3
"""Actual PostgreSQL multi-session tests, restricted to a disposable CI Docker container.

No application DB URL, secrets, project ID, remote host or production credentials accepted.
Run with the GitHub Actions postgres service container ID; no ports need to be published.
"""
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


def command(app="v29-test"):
    return ["docker", "exec", "-i", "-e", f"PGAPPNAME={app}", CONTAINER,
            "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]


def sql(query, app="v29-test"):
    result = subprocess.run(command(app), input=query, text=True, capture_output=True, timeout=15)
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
    child = start("begin;\n" + query + "\n\\echo LOCKED", "v29-holder")
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
    raise AssertionError(f"{app} did not wait on the publication lock")


def finish(child, error=None):
    child.stdin.close()
    child.wait(timeout=12)
    stderr = child.stderr.read()
    if error:
        assert child.returncode and error in stderr, stderr
    else:
        assert child.returncode == 0, stderr


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


SOURCE = "11111111-1111-4111-8111-111111111111"
CASE = SOURCE + ":interaction:0"
CUSTOMER = "33333333-3333-4333-8333-333333333333"
OLD = "66666666-6666-4666-8666-666666666666"
NEW = "77777777-7777-4777-8777-777777777777"
KEY = "fu1|isolated-concurrency|delivery"
OWNER = "si-canonical-followup-projection-v1"
OP = {"followUpKey": KEY, "status": "actionable", "blocker": None,
      "customerId": CUSTOMER, "reason": "delivery_unresolved"}
ROW = {"source_id": SOURCE, "action_key": "canonical-followup:" + KEY,
       "action_type": "customer_followup", "branch": "فرع شكري", "customer_id": CUSTOMER,
       "followup_identity": KEY, "created_by": OWNER, "evidence": ["synthetic-m1"],
       "payload": {"caseId": CASE, "canonicalAnalysisId": OLD, "canonicalProjectionVersion": OWNER,
                   "canonicalReason": "delivery_unresolved"}}


def reconcile(analysis_id=OLD, rows=None):
    return (f"select dawaa_reconcile_canonical_followup_actions_v1('{SOURCE}',"
            f"{literal({CASE: analysis_id})},{literal([ROW] if rows is None else rows)});")


def publish_closed():
    return f"""
      update sales_intelligence_case_analyses set is_current=false where case_id='{CASE}';
      update sales_intelligence_case_analyses set is_current=true where analysis_id='{NEW}';
      update sales_intelligence_cases set published_analysis_id='{NEW}' where case_id='{CASE}';
    """


LOCK = f"select id from whatsapp_review_sources where id='{SOURCE}' for update;"
AUTH = """set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';set test.permission='true';
          set test.source_access='true';set test.branch_access='true';"""


def reset():
    sql(f"""
      truncate whatsapp_conversation_actions,sales_intelligence_case_analyses,
        sales_intelligence_cases,whatsapp_review_sources;
      insert into whatsapp_review_sources(id,customer_id,customer_name,customer_code,branch)
        values('{SOURCE}','{CUSTOMER}','Synthetic customer','TEST','فرع شكري');
      insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id)
        values('{CASE}','{SOURCE}','{OLD}');
      insert into sales_intelligence_case_analyses(analysis_id,case_id,is_current,evidence_snapshot) values
        ('{OLD}','{CASE}',true,{literal({'caseIntelligence': {'followUp': {'opportunities': [OP]}}})}),
        ('{NEW}','{CASE}',false,{literal({'caseIntelligence': {'followUp': {'opportunities': []}}})});
    """)


fixture = ROOT / "scripts/staging/fixtures/canonical-followup-lifecycle.sql"
migrations = list((ROOT / "supabase/migrations").glob("*_canonical_followup_projection_lifecycle.sql"))
assert len(migrations) == 1
sql(fixture.read_text() + "\n" + migrations[0].read_text())

# 1. Identical refreshes serialize and retain one stable action with no retry update.
reset()
a = holder(reconcile())
b = start(reconcile(), "v29-same-retry")
wait_blocked("v29-same-retry")
release(a)
finish(b)
assert sql("select count(*) from whatsapp_conversation_actions") == "1"
assert json.loads(sql(reconcile()))["updated"] == 0
print("PASS concurrent same-identity retry", flush=True)

# 2. A stale refresh waiting behind newer publication cannot insert or retract anything.
reset()
a = holder(LOCK)
b = start(reconcile(), "v29-stale-refresh")
wait_blocked("v29-stale-refresh")
release(a, publish_closed() + "commit;")
finish(b, "canonical_followup_stale_publication")
assert sql("select count(*) from whatsapp_conversation_actions") == "0"
print("PASS newer publication rejects waiting stale refresh", flush=True)

# 3. Materialization waiting behind publication rechecks the new pointer before execution.
reset()
sql(reconcile())
action = sql("select id from whatsapp_conversation_actions")
a = holder(LOCK)
b = start(AUTH + f"select dawaa_materialize_whatsapp_action_v1('{action}');", "v29-stale-materializer")
wait_blocked("v29-stale-materializer")
release(a, publish_closed() + "commit;")
finish(b, "canonical_followup_requires_current_projection")
assert sql("select count(*) from whatsapp_conversation_actions where target_id is not null") == "0"
print("PASS publication prevents waiting stale materialization", flush=True)

# 4. The reverse order retains the target already materialized before the new publication.
reset()
sql(reconcile())
action = sql("select id from whatsapp_conversation_actions")
a = holder(AUTH + f"select dawaa_materialize_whatsapp_action_v1('{action}');")
b = start("begin;" + LOCK + publish_closed() + reconcile(NEW, []) + "commit;", "v29-after-materializer")
wait_blocked("v29-after-materializer")
release(a)
finish(b)
assert sql("select status||':'||target_id from whatsapp_conversation_actions") == "created:isolated-target"
print("PASS committed materialization lineage survives later closure", flush=True)

# 5. The case-analysis lock also protects against a writer invalidating current analysis.
reset()
sql(reconcile())
action = sql("select id from whatsapp_conversation_actions")
a = holder(f"select pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:{CASE}'));")
b = start(AUTH + f"select dawaa_materialize_whatsapp_action_v1('{action}');", "v29-case-writer")
wait_blocked("v29-case-writer")
release(a, f"update sales_intelligence_case_analyses set is_current=false where analysis_id='{OLD}';commit;")
finish(b, "canonical_followup_requires_current_projection")
assert sql("select count(*) from whatsapp_conversation_actions where target_id is not null") == "0"
print("PASS case writer cannot race materializer validation", flush=True)
print("5 PostgreSQL multi-session tests passed; 0 failed. Isolated container only.", flush=True)
