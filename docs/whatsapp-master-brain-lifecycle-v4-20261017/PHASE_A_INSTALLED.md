# Phase A installed and verified

Decision: **PHASE_A_INSTALLED_AND_VERIFIED**

Continuation branch: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`.
Starting checkpoint: `60398e58f68cc4ec2cc455a827fd5a93542a5c62`.
Tested code/SQL: `20f854c56cbe18faf336cd7e1949d3ddc4aebd50`.
Final evidence HEAD is the commit containing this report; exact SHA is provided in the final response.

Supersedes the connector-blocked outcome in PHASE_A_PRODUCTION_EXECUTION.md; that report remains historical evidence.

| Stage | Result |
|---|---|
| Fresh strict Production read-only precheck | PASS_NO_DRIFT |
| Candidate functions / migration row before apply | Absent / 0 |
| Exact approved atomic candidate | SHA256 d52cdd2f01d40f0a3b1a1a08725d01d2cbfaf42255d1ff19afc9f550038ab470, unchanged |
| Application after user-confirmed connector restoration | SUCCESS, exactly one attempt |
| Immediate read-only postcheck | PASS |
| Migration ledger | 0 → 1 row named whatsapp_master_brain_batch4_phase_a_lifecycle_v2_20261017 |

The exact approved file was sent without edits, splitting, reordered statements or wrappers through Supabase apply_migration. The existing postcheck was executed with only its expected fingerprint psql variables substituted by the fresh precheck values; a single-result catalog snapshot captured all function/trigger metadata for independent comparison. No runtime functions were invoked for testing on Production.

## Installed function signatures and hashes

All functions below are public, owned by postgres, SECURITY DEFINER.

| Signature | Installed prosrc MD5 | search_path |
|---|---|---|
| sales_intelligence_stage_case_analysis_v1(text,jsonb) | b06dc86dd488b7af4418f53195252947 | public, pg_temp |
| sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb) | b1d51222a320d551aeb0034afae74211 | public, pg_catalog |
| sales_intelligence_on_source_archived_v1() | cabbabec53cd0330fdb29f6669f2f4d1 | public, pg_catalog |
| dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[]) | 5209146fa7e69c228de39ca7cfc0c9e9 | public |

Staging, reconcile-v2 and archive hook ACLs are exactly postgres + service_role EXECUTE; no PUBLIC/anon/authenticated grant. Archive writer retains its approved postgres/anon/authenticated/service_role ACL, with no PUBLIC grant. Original reconcile-v1 MD5 9fd2f5976e2419ca7154d203b29da5fc and analysis writer MD5 c6c53c94a20cfdbf2946371398790d98, owners, ACLs/config remain unchanged.

Exactly one archive trigger is added, enabled O:
`sales_intelligence_source_archived_v1`, AFTER UPDATE OF review_status ON public.whatsapp_review_sources, FOR EACH ROW WHEN new.review_status='archived' AND old.review_status IS DISTINCT FROM new.review_status, EXECUTE FUNCTION sales_intelligence_on_source_archived_v1(). Original invoice evidence trigger is byte-for-byte unchanged; no other triggers added to the checked lifecycle tables.

## Unchanged data

Fresh before snapshot: 2026-10-17T12:43:55.227009+00:00.
Immediate after snapshot: 2026-10-17T12:44:19.324407+00:00.

| Data | Before | After |
|---|---|---|
| Cases count | 201 | 201 |
| Cases fingerprint | f431c105a02d6109b5970bca51692879 | f431c105a02d6109b5970bca51692879 |
| Analyses count | 1071 | 1071 |
| Analyses fingerprint | 36268696cc9ec69efd0e43dbcfa94e1d | 36268696cc9ec69efd0e43dbcfa94e1d |

Missing-current 53; archived-active 39; non-archived missing 14; published-superseded 16; pointer mismatches 16; duplicate current analyses 0. These remain baseline defects; no historical repair occurred. All classifications remain unchanged.

Production writes: **1 successful atomic DDL installation**, comprising 4 function definitions (3 new + corrected archive writer), associated owner/privilege statements, and 1 archive trigger. Supabase also records **1 migration-history metadata row**. Production application data row changes = **0**. Migration history is schema tracking metadata, not historical case/analysis repair.

Production reanalysis = 0; historical repair = 0; runtime activation = 0; deploy = 0; merge = 0; main changes = 0. Existing future archival now has the installed database trigger; no archival operation was invoked as part of this task. The new application runtime remains undeployed.

Rollback: READY, NOT NEEDED, NOT EXECUTED. Approved rollback SHA256 50b12888c8b177c1e6fa835da3204b95ddba3ba79707a8156de53308d144386c, previously verified on native PG17. Any future rollback requires the approved quiesced-runtime procedure.

[Machine-readable before/after evidence](phase-a-installed-evidence.json). Stop after this evidence-only branch push; no repair, runtime activation, backfill, merge or deploy follows.
