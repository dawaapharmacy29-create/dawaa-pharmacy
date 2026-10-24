#!/usr/bin/env python3
"""Isolated postgres:17 checks for the V48 scoped V22 envelope repair migration and the candidate
proof-writer ownership/provenance fix. Uses the minimal tables these statements touch. Proves:
  * the live proof writer reproduces both defects (sibling case told 'already_reconciled'; stale
    provenance after a re-analysis), and the candidate fixes them without touching the ledger;
  * the scoped repair changes exactly one envelope, is idempotent, fails closed on any mismatched
    precondition, never fires the purchase trigger, and can be rolled back from its audit row.
No application DB URL, secrets, project ID or remote host is accepted.
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


def run(query, expect_error=False):
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1"],
        input=query, text=True, capture_output=True, timeout=30)
    if expect_error:
        if not result.returncode:
            raise AssertionError("expected an error, got success")
        return result.stderr
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def function_from(path, marker):
    text = (ROOT / path).read_text(encoding="utf8")
    start = text.index(marker)
    return text[start:text.index("$function$;", start) + len("$function$;")]


MARKER = "CREATE OR REPLACE FUNCTION public.dawaa_reconcile_sales_intelligence_case_v22_v1(p_sales_case_id text)"
LIVE = function_from("supabase/migrations/20261009200000_capture_production_canonical_si_writers_v1.sql", MARKER)
CANDIDATE = function_from("docs/whatsapp-v48-canonical-proof-ownership/proof-writer-ownership-provenance-candidate.sql", MARKER)
REPAIR = (ROOT / "supabase/migrations/20261024093534_v48_scoped_v22_envelope_identity_proof_provenance_repair.sql").read_text(encoding="utf8")

SOURCE = "ee4f79b9-7a32-48c6-93b8-ecdfa01b6aed"
OTHER_SOURCE = "11111111-1111-4111-8111-111111111111"
V22 = "c2c36ff4-c063-46e0-a79a-f42fedfbca84"
OTHER_V22 = "22222222-2222-4222-8222-222222222222"
CUSTOMER = "39e278d3-3840-49ba-a9c6-658a44fcba81"
INVOICE = "323d09e9-3adb-46c9-b67b-cdd1bee98ae8"
ORDER = SOURCE + ":interaction:0:session:2"
NURSING = SOURCE + ":interaction:1:session:2"
SERVICE = SOURCE + ":interaction:0:session:0"
OLD_ANALYSIS = "b561fcd2-b8a2-4a90-9ce3-6adc19339615"
ORDER_ANALYSIS = "07d14ed2-5a85-433e-a686-71c6d9944446"
NURSING_ANALYSIS = "4a690917-764a-4673-955b-8d819b566be0"

SCHEMA = f"""
drop schema public cascade; create schema public;
create table customers(id uuid primary key);
create table whatsapp_review_sources(id uuid primary key, customer_id uuid, customer_code text, branch text,
  matched_invoice_id text, matched_invoice_number text);
create table sales_invoices(id text primary key, invoice_number text, invoice_no text, net_amount numeric,
  total_amount numeric, amount numeric, gross_amount numeric, invoice_datetime timestamptz,
  invoice_date timestamptz, sale_date date);
create table sales_intelligence_cases(case_id text primary key, source_case_id_v22 text);
create table sales_intelligence_case_analyses(analysis_id uuid primary key, case_id text, is_current boolean,
  analyzed_at timestamptz, analysis_version int, pipeline_version text, evidence_snapshot jsonb);
create table sales_intelligence_attributions(id uuid primary key default gen_random_uuid(), analysis_id uuid,
  is_current_evaluation boolean, attribution_level text, selected_invoice_id text, selected_invoice_number text);
create table sales_intelligence_basket_invoice_matches(analysis_id uuid, is_current_evaluation boolean,
  attribution_row_id uuid, invoice_id text);
create table whatsapp_customer_cases_v22(id uuid primary key, root_source_id uuid, customer_id uuid,
  customer_code text, branch text, confirmed_outcome text, proposed_outcome text, outcome_confidence int,
  verified_invoice_id text, verified_invoice_number text, verified_revenue numeric, verified_sale_at timestamptz,
  story_id uuid, case_json jsonb, updated_at timestamptz);
create table whatsapp_review_audit(id uuid primary key default gen_random_uuid(), source_id uuid not null,
  action text not null, actor_id uuid, actor_name text, actor_role text, before_state jsonb, after_state jsonb,
  note text, created_at timestamptz not null default now());
create table whatsapp_conversation_actions(id text primary key, source_id uuid, status text, work_status text,
  outcome text, payload jsonb);
create table purchase_trigger_log(v22_id uuid, at timestamptz default now());
create function dawaa_capture_whatsapp_canonical_purchase_v36() returns trigger language plpgsql as $$
begin insert into purchase_trigger_log(v22_id) values (new.id); return new; end $$;
create trigger trg_whatsapp_story_canonical_purchase_v36 after insert or update of proposed_outcome,
  confirmed_outcome, verified_invoice_id, verified_invoice_number, verified_revenue, verified_sale_at, story_id
  on whatsapp_customer_cases_v22 for each row execute function dawaa_capture_whatsapp_canonical_purchase_v36();
create table revoke_log(v22_id uuid, reason text, at timestamptz default now());
create function dawaa_revoke_whatsapp_canonical_sale_proof_v46(p uuid, r text, c jsonb) returns jsonb
  language plpgsql as $$ begin insert into revoke_log(v22_id, reason) values (p, r);
  return jsonb_build_object('ok', true, 'status', 'revoked'); end $$;
"""

PROOF = {
    "state": "proven", "source": "sales_intelligence", "invoiceId": INVOICE, "analysisId": OLD_ANALYSIS,
    "reasonCodes": ["outcome.sale_proven.trusted_invoice"], "salesCaseId": ORDER,
    "reconciledAt": "2026-10-22T13:41:36.423036+00:00", "salesOutcome": "sale_proven", "invoiceNumber": "74938",
    "saleProofState": "proven", "analysisVersion": 12, "pipelineVersion": "sales-intelligence-v45-proven-invoice-branch",
}
OUTCOME = {"outcome": "sale_proven", "saleProofState": "proven", "isSaleCountable": True,
           "isRevenueCountable": True, "reasonCodes": ["outcome.sale_proven.trusted_invoice"]}


def seed(source_customer=CUSTOMER, nursing_attribution=False):
    run(SCHEMA)
    proof = json.dumps({"canonicalSaleProof": PROOF})
    other = json.dumps({"canonicalSaleProof": {**PROOF, "salesCaseId": OTHER_SOURCE + ":interaction:0"}})
    nursing_attr = (
        f"insert into sales_intelligence_attributions(id, analysis_id, is_current_evaluation, attribution_level, selected_invoice_id, selected_invoice_number) "
        f"values ('33333333-3333-4333-8333-333333333333', '{NURSING_ANALYSIS}', true, 'proven', '{INVOICE}', '74938');"
        f"insert into sales_intelligence_basket_invoice_matches values ('{NURSING_ANALYSIS}', true, '33333333-3333-4333-8333-333333333333', '{INVOICE}');"
    ) if nursing_attribution else ""
    nursing_outcome = OUTCOME if nursing_attribution else {"outcome": "needs_review", "saleProofState": "unknown"}
    run(f"""
insert into customers values ('{CUSTOMER}');
insert into whatsapp_review_sources values ('{SOURCE}', {f"'{source_customer}'" if source_customer else 'null'}, '18663', 'المخزن', null, null);
insert into sales_invoices values ('{INVOICE}', '74938', null, 849, 849, 849, 849, '2026-09-27T22:06:00Z', null, null);
insert into sales_intelligence_cases values ('{ORDER}', '{V22}'), ('{NURSING}', '{V22}'), ('{SERVICE}', '{V22}');
insert into sales_intelligence_case_analyses values
  ('{OLD_ANALYSIS}', '{ORDER}', false, '2026-10-22T13:41:00Z', 12, 'sales-intelligence-v45-proven-invoice-branch', '{json.dumps({"canonicalSalesOutcome": OUTCOME})}'),
  ('{ORDER_ANALYSIS}', '{ORDER}', true, '2026-10-24T03:50:52Z', 14, 'sales-intelligence-v48-canonical-case-branch', '{json.dumps({"canonicalSalesOutcome": OUTCOME})}'),
  ('{NURSING_ANALYSIS}', '{NURSING}', true, '2026-10-24T03:50:52Z', 14, 'sales-intelligence-v48-canonical-case-branch', '{json.dumps({"canonicalSalesOutcome": nursing_outcome})}');
insert into sales_intelligence_attributions(id, analysis_id, is_current_evaluation, attribution_level, selected_invoice_id, selected_invoice_number)
  values ('44444444-4444-4444-8444-444444444444', '{ORDER_ANALYSIS}', true, 'proven', '{INVOICE}', '74938');
insert into sales_intelligence_basket_invoice_matches values ('{ORDER_ANALYSIS}', true, '44444444-4444-4444-8444-444444444444', '{INVOICE}');
{nursing_attr}
insert into whatsapp_customer_cases_v22 values
  ('{V22}', '{SOURCE}', null, '18663', 'المخزن', null, 'verified_sale', 100, '{INVOICE}', '74938', 849, '2026-09-27T22:06:00Z', null, '{proof}', '2026-10-24T03:50:56Z'),
  ('{OTHER_V22}', '{OTHER_SOURCE}', null, '18663', 'المخزن', null, 'verified_sale', 100, '{INVOICE}', '74938', 849, '2026-09-27T22:06:00Z', null, '{other}', '2026-10-24T03:50:56Z');
insert into whatsapp_conversation_actions values
  ('b50f4b70-6398-4d4c-b817-bfaaa6b72865', '{SOURCE}', 'ready', 'completed', 'sold', '{{"x":1}}'),
  ('46ec37bf-5912-4d0a-b569-efd20705deaf', '{SOURCE}', 'proposed', 'unassigned', null, '{{}}');
-- Seeding inserts fire the purchase trigger; only firings caused by the code under test count.
truncate purchase_trigger_log;
""")


def row_hash(v22_id, without_updated_at=False):
    expr = "to_jsonb(v) - 'updated_at'" if without_updated_at else "to_jsonb(v)"
    return run(f"select md5(({expr})::text) from whatsapp_customer_cases_v22 v where id='{v22_id}'")


def actions_hash():
    return run("select md5(string_agg(to_jsonb(a)::text, ',' order by id)) from whatsapp_conversation_actions a")


def ledger(v22_id=V22):
    return run(f"select verified_invoice_id||'|'||verified_invoice_number||'|'||verified_revenue||'|'||verified_sale_at||'|'||proposed_outcome from whatsapp_customer_cases_v22 where id='{v22_id}'")


checks = []


def check(name, condition, detail=""):
    checks.append((name, bool(condition)))
    print(f"{'PASS' if condition else 'FAIL'} {name}{(' — ' + detail) if detail and not condition else ''}")


# ---- Scoped envelope repair migration ----
seed()
other_before, actions_before, ledger_before, target_before = row_hash(OTHER_V22), actions_hash(), ledger(), row_hash(V22)
run(REPAIR)
check("repair sets customer_id on the target envelope only",
      run(f"select customer_id from whatsapp_customer_cases_v22 where id='{V22}'") == CUSTOMER
      and run(f"select coalesce(customer_id::text,'null') from whatsapp_customer_cases_v22 where id='{OTHER_V22}'") == "null")
check("repair moves proof provenance to the current V48 analysis",
      run(f"select case_json#>>'{{canonicalSaleProof,analysisId}}' || '|' || (case_json#>>'{{canonicalSaleProof,previousAnalysisId}}') || '|' || (case_json#>>'{{canonicalSaleProof,pipelineVersion}}') from whatsapp_customer_cases_v22 where id='{V22}'")
      == f"{ORDER_ANALYSIS}|{OLD_ANALYSIS}|sales-intelligence-v48-canonical-case-branch")
check("repair keeps the proof owner, invoice and original reconciledAt",
      run(f"select case_json#>>'{{canonicalSaleProof,salesCaseId}}' || '|' || (case_json#>>'{{canonicalSaleProof,invoiceId}}') || '|' || (case_json#>>'{{canonicalSaleProof,reconciledAt}}') from whatsapp_customer_cases_v22 where id='{V22}'")
      == f"{ORDER}|{INVOICE}|2026-10-22T13:41:36.423036+00:00")
check("ledger (verified_*, outcome) unchanged: 849 still counted once", ledger() == ledger_before)
check("purchase trigger did not fire", run("select count(*) from purchase_trigger_log") == "0")
check("other envelope, source row and both legacy actions untouched",
      row_hash(OTHER_V22) == other_before and actions_hash() == actions_before
      and run(f"select coalesce(matched_invoice_id,'null')||'|'||branch from whatsapp_review_sources where id='{SOURCE}'") == "null|المخزن")
check("one audit row with before/after", run("select count(*) from whatsapp_review_audit where action='v22_envelope_identity_and_proof_provenance_repair_v48'") == "1")
after_first = row_hash(V22)
run(REPAIR)
check("second run is a no-op (no write, no second audit row)",
      row_hash(V22) == after_first and run("select count(*) from whatsapp_review_audit") == "1")
# Rollback from the audit row restores the exact previous values (updated_at aside).
run(f"""update whatsapp_customer_cases_v22 v set customer_id = (a.before_state->>'customer_id')::uuid,
  case_json = jsonb_set(v.case_json, '{{canonicalSaleProof}}', a.before_state->'canonicalSaleProof'),
  updated_at = (a.before_state->>'updated_at')::timestamptz
  from whatsapp_review_audit a where v.id='{V22}' and a.action='v22_envelope_identity_and_proof_provenance_repair_v48'""")
check("rollback from the audit before_state restores the original row", row_hash(V22) == target_before)

for label, mutate, error in [
    ("source customer differs", lambda: seed(source_customer="55555555-5555-4555-8555-555555555555"), "v48_repair_source_customer_mismatch"),
    ("proof owned by another case", lambda: (seed(), run(f"update whatsapp_customer_cases_v22 set case_json = jsonb_set(case_json, '{{canonicalSaleProof,salesCaseId}}', '\"{NURSING}\"') where id='{V22}'")), "v48_repair_proof_scope_mismatch"),
    ("current analysis not proven", lambda: (seed(), run(f"update sales_intelligence_case_analyses set evidence_snapshot = '{{\"canonicalSalesOutcome\":{{\"outcome\":\"needs_review\"}}}}' where analysis_id='{ORDER_ANALYSIS}'")), "v48_repair_current_analysis_not_proven"),
    ("envelope already linked to a different customer", lambda: (seed(), run(f"insert into customers values ('66666666-6666-4666-8666-666666666666'); update whatsapp_customer_cases_v22 set customer_id='66666666-6666-4666-8666-666666666666' where id='{V22}'")), "v48_repair_v22_customer_conflict"),
]:
    mutate()
    before = row_hash(V22)
    stderr = run(REPAIR, expect_error=True)
    check(f"fails closed when {label}", error in stderr and row_hash(V22) == before
          and run("select count(*) from whatsapp_review_audit") == "0", stderr.strip()[-160:])

# ---- Proof writer: live defects vs candidate ----
def rpc(case_id):
    return json.loads(run(f"select public.dawaa_reconcile_sales_intelligence_case_v22_v1('{case_id}')"))


def proof_field(field):
    return run(f"select coalesce(case_json#>>'{{canonicalSaleProof,{field}}}', '<null>') from whatsapp_customer_cases_v22 where id='{V22}'")


def audit_count():
    return run("select count(*) from whatsapp_review_audit")


def untouched(before_row):
    return (row_hash(V22) == before_row and ledger() == ledger_before and audit_count() == "0"
            and run("select count(*) from revoke_log") == "0" and run("select count(*) from purchase_trigger_log") == "0")


def set_owner(sql_value):
    """sql_value: a jsonb expression for salesCaseId, or None to remove the key."""
    if sql_value is None:
        run(f"update whatsapp_customer_cases_v22 set case_json = case_json #- '{{canonicalSaleProof,salesCaseId}}' where id='{V22}'")
    else:
        run(f"update whatsapp_customer_cases_v22 set case_json = jsonb_set(case_json, '{{canonicalSaleProof,salesCaseId}}', {sql_value}) where id='{V22}'")
    run("truncate purchase_trigger_log")


OWNERLESS = (("no salesCaseId", None), ("salesCaseId ''", "'\"\"'::jsonb"), ("salesCaseId '   '", "'\"   \"'::jsonb"), ("salesCaseId null", "'null'::jsonb"))

for label, fn in (("live", LIVE), ("candidate", CANDIDATE)):
    # 1. Ownerless proven proof: nobody owns it; nothing is written, revoked or refreshed.
    for owner_label, owner_value in OWNERLESS:
        for caller in (ORDER, NURSING, SERVICE):
            seed(nursing_attribution=True)
            run(fn)
            set_owner(owner_value)
            before = row_hash(V22)
            result = rpc(caller)
            caller_name = caller.split(":", 1)[1]
            if label == "candidate":
                check(f"candidate: proof with {owner_label} called by {caller_name} -> owner_unknown_requires_review, no write",
                      result.get("status") == "canonical_proof_owner_unknown_requires_review" and result.get("ok") is False
                      and untouched(before), json.dumps(result))
            elif caller == ORDER and owner_label == "no salesCaseId":
                check("live: a proof without salesCaseId is treated as owned by the caller (defect reproduced)",
                      result.get("status") == "already_reconciled" and result.get("ok") is True, json.dumps(result))
            elif caller == SERVICE and owner_label == "no salesCaseId":
                # The service case has no proven analysis: the live writer revokes a proof it cannot own.
                check("live: an unproven case revokes an ownerless proof (defect reproduced)",
                      run("select count(*) from revoke_log") == "1", json.dumps(result))

    # 2. Sibling-owned proof: the nursing case (even with a hypothetical proven attribution of the
    # same invoice) and the customer-service case never close on, revoke or rewrite the order's proof.
    seed(nursing_attribution=True)
    run(fn)
    before = row_hash(V22)
    sibling = rpc(NURSING)
    if label == "live":
        check("live: a sibling case is told 'already_reconciled' (defect reproduced)", sibling.get("status") == "already_reconciled")
    else:
        check("candidate: sibling-owned proof -> canonical_proof_owned_by_other_case with the owner, envelope untouched",
              sibling.get("status") == "canonical_proof_owned_by_other_case" and sibling.get("ok") is False
              and sibling.get("ownerSalesCaseId") == ORDER and untouched(before), json.dumps(sibling))
    seed(nursing_attribution=False)
    run(fn)
    before = row_hash(V22)
    nursing_plain = rpc(NURSING)
    service_plain = rpc(SERVICE)
    check(f"{label}: the real nursing and service cases (no proven analysis) never revoke or close on the order proof",
          nursing_plain.get("status") == "not_proven_no_change" and service_plain.get("status") == "not_proven_no_change"
          and untouched(before), json.dumps([nursing_plain, service_plain]))

    # 3. Owner with an older analysis: provenance only, once.
    seed(nursing_attribution=False)
    run(fn)
    owner = rpc(ORDER)
    if label == "live":
        check("live: the owner keeps provenance on the superseded analysis (defect reproduced)",
              owner.get("status") == "already_reconciled" and proof_field("analysisId") == OLD_ANALYSIS)
        continue
    check("candidate: owner with an old analysis refreshes provenance only (owner, invoice, reconciledAt, ledger kept)",
          owner.get("status") == "already_reconciled" and owner.get("provenanceRefreshed") is True
          and proof_field("analysisId") == ORDER_ANALYSIS and proof_field("previousAnalysisId") == OLD_ANALYSIS
          and proof_field("salesCaseId") == ORDER and proof_field("invoiceId") == INVOICE
          and proof_field("reconciledAt") == PROOF["reconciledAt"] and ledger() == ledger_before
          and run("select count(*) from purchase_trigger_log") == "0" and run("select count(*) from revoke_log") == "0"
          and audit_count() == "1", json.dumps(owner))
    once = row_hash(V22)
    repeats = [rpc(ORDER) for _ in range(3)]
    check("candidate: repeated calls add no audit row, no revenue and no write",
          all(r.get("status") == "already_reconciled" and "provenanceRefreshed" not in r for r in repeats)
          and row_hash(V22) == once and audit_count() == "1" and ledger() == ledger_before
          and run(f"select count(*)||'|'||sum(verified_revenue) from whatsapp_customer_cases_v22 where root_source_id='{SOURCE}' and verified_invoice_id='{INVOICE}'") == "1|849")
    check("candidate: both legacy actions untouched", actions_hash() == actions_before)

failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit(f"{len(failed)} checks failed: {failed}")
print(f"{len(checks)} V48 proof ownership / envelope repair checks passed. Isolated container only.")
