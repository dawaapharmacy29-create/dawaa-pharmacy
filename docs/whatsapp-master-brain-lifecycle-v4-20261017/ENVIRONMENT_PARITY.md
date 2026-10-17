# Batch 4 final environment parity — PASS

Branch: fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017.
Starting HEAD: f60cc279d087c13406f94a069f4694ea57e127c9.

The approved business design and classifications remain unchanged. The initial parity candidate had v2 prosrc MD5 97e621afd88048b1c1f8f04dfa70892a; the proven concurrency correction below supersedes that never-deployed candidate.

Node 22.23.3 was downloaded from nodejs.org and SHA256-verified. Native PostgreSQL 17.11 binaries were extracted from the official PGDG Ubuntu package, verified against the signed repository index. Local server startup is blocked by this environment's single-UID user namespace: PostgreSQL correctly refuses root and this host disallows switching/mapping to a non-root UID. No root-check bypass was attempted.

A dedicated branch-only, read-only-permission GitHub Actions verification job therefore uses postgres:17 and Node 22. It installs the committed application lockfile, runs the exact Phase A release bundle and original matrix, exact rollback/reapply, targeted real concurrency, existing application tests/quality checks/build, and uploads synthetic evidence. It has no Production credentials, Supabase writes, Vercel deployment, billing configuration, or main/security branch mutation.

The test harness adds only an optional loopback fixture adapter and targeted multi-session tests. It refuses remote databases and requires the dedicated dawaa_batch4_verification database. The existing PGlite mode remains available and passes 53/53 on Node 22. This is harness compatibility evidence, the later native run below supplies PG17 parity evidence.

Hosted CI before this checkpoint: no runs on the continuation branch. Existing Build/Quality workflows support workflow_dispatch but the connected GitHub tools expose no dispatch operation. Their contents were inspected; no broad existing workflow modification is made. The narrow native parity workflow is required for the unavailable local non-root execution environment.

Native PG17 result: PASS — 58/58.
Concurrency result: PASS — all four real multi-session scenarios.
Production read-only fresh preflight: PASS, after the successful hosted run.
Production writes/data changes/reanalysis/repair: 0.
Merge/deploy: 0.

## Proven verification failures and minimal correction

- Initial workflow YAML plain-scalar quoting: CI configuration/harness issue, corrected in db7e3855.
- First native worker PID lookup was queued behind the deliberately blocked query: test harness issue, corrected in 70c2cbbd. The exact baseline, strict precheck and SQL matrix had already passed on PG17.
- Native run https://github.com/dawaapharmacy29-create/dawaa-pharmacy/actions/runs/39031501324 proved an actual archive/refresh lock inversion (40P01), after the same-case/same-source concurrency and retry/reactivation checks passed. Original component lines 143–149 acquired advisory locks before the source FOR UPDATE; archival already held the row and requested advisory, forming a cycle.

The necessary candidate delta takes the same sorted source row locks before the existing advisory locks. It changes concurrency behavior only; sale/publication/retirement policies and rollback baseline bodies remain unchanged. This is a proven SQL concurrency bug, not a PG17 syntax incompatibility or a Production baseline drift. Original never-deployed v2 MD5: 97e621afd88048b1c1f8f04dfa70892a.
Corrected candidate v2 MD5: b1d51222a320d551aeb0034afae74211. Native rerun: PASS, run 39031723616.


## Final decision and evidence

**READY_FOR_PHASE_A_PRODUCTION_SQL_APPROVAL**. This is a review package, not execution authorization. No SQL was applied to Production.

- Branch: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017` only.
- Starting HEAD: `f60cc279d087c13406f94a069f4694ea57e127c9`.
- Fully tested code/SQL HEAD: `20f854c56cbe18faf336cd7e1949d3ddc4aebd50`. Final evidence is a documentation-only descendant; resolve its own HEAD from the branch/commit containing this report.
- BASELINE_FUNCTION: `public.sales_intelligence_reconcile_case_set_v1(uuid,text[])`.
- BASELINE_MD5: `9fd2f5976e2419ca7154d203b29da5fc`.
- Analysis writer baseline MD5: `c6c53c94a20cfdbf2946371398790d98`.
- TARGET_FUNCTION: `public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb)`.
- TARGET_MD5: `b1d51222a320d551aeb0034afae74211`.

[Successful hosted run](https://github.com/dawaapharmacy29-create/dawaa-pharmacy/actions/runs/39031723616), job 117393351589: every verification step SUCCESS. Application runtime Node 22.23.3 / npm 10.9.9; native PostgreSQL 17.11 x86_64. GitHub action bootstrap runtimes are managed separately by GitHub. Committed lockfile installation passed without lockfile changes.

| Verification | Result |
|---|---|
| Exact atomic candidate SQL, original matrix, native strict precheck, rollback/reapply | PASS |
| All native SQL scenarios including added concurrency | 58 PASS / 0 FAIL |
| Exact rollback bodies, owners, ACL, security definer, config and candidate removal | PASS |
| Same-case staging/version monotonicity | PASS, real sessions |
| Same-source reconciliation/atomic reader visibility | PASS, real sessions |
| Stale stage rejection, retirement/reactivation, owned proof/history | PASS |
| Archive versus reconcile | PASS, archive wins without deadlock/reactivation |
| Partial failure / injected proof failure | PASS, atomic rollback |
| Targeted runtime tests | PASS |
| Full custom suite | 1047 PASS / 0 FAIL |
| SI Africa/Cairo and UTC, each | 1189 PASS, 1 skipped; 115 passing files |
| Existing quality checks | 29/29 PASS |
| Generated API parity / TypeScript / semantic ESLint | PASS / PASS / PASS |
| Production build / performance budget | PASS / PASS, initial gzip 202.1 KiB |
| Source purity after checks | PASS |
| Browser smoke | NOT RUN; no deployment performed |

Native scenario output is preserved in [native-pg17-results.txt](native-pg17-results.txt). Hosted artifact `batch4-environment-parity` contains native output, Node version, lockfile hash and semantic lint JSON; uploaded ZIP SHA256 `7811c7d178773a1367ef844c08d8382614e346ecf9fb4a582eef641cc6caf09a`.

| Exact file | SHA256 |
|---|---|
| sql/phase-a-release-candidate.sql | d52cdd2f01d40f0a3b1a1a08725d01d2cbfaf42255d1ff19afc9f550038ab470 |
| sql/precheck.sql | 3e970d5bc556940ae543cfff1583f37cbdfd891eacabdd408f7761c862c67c82 |
| sql/rollback.sql | 50b12888c8b177c1e6fa835da3204b95ddba3ba79707a8156de53308d144386c |
| package-lock.json | 9a899c693b295774718d84080211ae4fbff3f2bf4fc767b7e716f584ee6a7e37 |

## Fresh Production preflight

The exact `sql/precheck.sql` passed after CI success. A second BEGIN READ ONLY snapshot re-extracted function definitions/MD5/owner/ACL/config and fingerprints at 2026-10-17T12:17:48.104029Z. [Complete evidence](production-final-preflight.json). PostgreSQL 17.6, role postgres; candidate functions absent; original functions unchanged. Schema MD5 `c02af025fa7e858a524df12520b30a9f`; trigger MD5 `5a6e20613b8ce3074082d5709bf4e9c1`.

Baseline counts remain: missing-current 53 = archived 39 + non-archived 14; duplicate raw currents 0; published-superseded 16; pointer mismatches 16. Cases 201, fingerprint `f431c105a02d6109b5970bca51692879`; analyses 1071, fingerprint `36268696cc9ec69efd0e43dbcfa94e1d`. Drift: NONE against the accepted precheck contract. These are observed baseline defects, not repaired data.

All fourteen final case/source classifications, evidence and the three formerly unresolved cases remain in [README.md](README.md) and [classification.json](classification.json), unchanged by parity work. Totals: SAFE_TO_REPUBLISH_EXISTING 0; NEEDS_REANALYSIS 2; NEEDS_RESEGMENTATION 7; SHOULD_BE_RETIRED 5; HUMAN_REVIEW_REQUIRED 0; sum 14. Archived 39 untouched and excluded from fresh reanalysis.

Production writes = 0; Production data changes = 0; Production backfill/reanalysis/repair = 0; migration apply = 0; deploy = 0; merge = 0; main changes = 0; new projects/staging = 0; paid-resource creation = 0. Main, Batch 3 and security refs are independently checked without mutation. Production apply requires a separate approval and a fresh strict precheck at that time.
