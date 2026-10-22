# Controlled runtime activation — smoke blocked by browser credential runtime

Decision: RUNTIME_ACTIVATION_BLOCKED (activation succeeded; full smoke verification incomplete).

- Starting/activated application SHA: a99a7ccd8bd6c35b17783919e3fb6f5266ef66db.
- Branch: fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017.
- Previous Production: main@fdb53454ea81b854d231c43cbe4b19e1f5ca3afe, deployment dpl_DGCUpwdKpZVX9jTpSDnSX9DFgvfm.
- Fresh read-only strict precheck at 2026-10-17T16:20:41.731650Z: PASS_NO_DRIFT. All six Phase A/retained function signatures, body hashes, owners, ACL, security-definer/config, source trigger definitions and migration count (1) match phase-a-installed-evidence.json.
- Authorized one-deployment override: projectSettings.commandForIgnoringBuildStep = "exit 1". No repository/configuration/runtime/SQL edits; no permanent project settings update invoked.
- Production deployment dpl_J3JdAfgW4AwRyNkD3Q9LhLWq6W1B: READY; build completed in 60s; Production alias dawaa-pharmacy.vercel.app resolves to this deployment and exact approved SHA.
- Browser login succeeded through secure browserAuth; manager dashboard and WhatsApp folder watcher rendered.
- Attempt to access file chooser was blocked by browser tooling: "Browser observation is unavailable because retained browser data remains restricted after native credential delivery." Documented recovery/new runtime attempted; terminal tool error: "native credential state cannot be safely resumed. Start a new browser runtime to continue."
- No source processing or smoke dataset submission occurred. Smoke source/case IDs: none.
- GET /api/sales-intelligence-refresh-source returned expected 405, Allow: POST, {"error":"method_not_allowed"}; this verifies route availability only, not authenticated processing.
- staging/reconcile v2/canonical proof, atomic publication, zero-case, retry/idempotency, independent-source/dependency/follower behavior, customer correction, attribution, follow-up, invoice/product/request and evaluation write smoke: NOT EXECUTED. Prior fixture passes are not substituted for Production smoke.
- Postcheck at 2026-10-17T16:24:16.795687Z: cases201, analyses1071; duplicate cases0; duplicate current analyses0.
- Cases fingerprint before/after: f431c105a02d6109b5970bca51692879.
- Analyses fingerprint before/after: 36268696cc9ec69efd0e43dbcfa94e1d.
- Phase A installed hashes unchanged: stage b06dc86dd488b7af4418f53195252947; v2 b1d51222a320d551aeb0034afae74211; archive hook cabbabec53cd0330fdb29f6669f2f4d1; archive writer5209146fa7e69c228de39ca7cfc0c9e9.
- Existing16 historical pointer mismatches were not repaired; unchanged complete SI table fingerprints establish no SI data drift. No zero global pointer-mismatch claim.
- Error/performance evidence: build successful, login/dashboard/folder page rendered, endpoint GET405; full processing logs/latency not verified.
- Smoke-domain Production writes0. Authentication login/session maintenance occurred through normal app flow and is separate from smoke-domain writes; its row-write count was not measured.
- 14 untouched;39 archived untouched; historical repair0; reanalysis0; backfill0; SQL changes0.
- Production deploy1; merge0; main unchanged at fdb53454ea81b854d231c43cbe4b19e1f5ca3afe.
- Runtime remains activated at a99a7ccd; no rollback performed: no canonical regression observed and no smoke writes occurred. Phase A SQL rollback is not applicable.
- Stop. Resume ONLY the limited authenticated Production smoke after browser tooling/session recovery, without redeploying or reopening completed phases.
