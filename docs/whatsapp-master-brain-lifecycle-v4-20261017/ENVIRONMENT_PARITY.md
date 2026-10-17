# Batch 4 final environment parity — verification in progress

Branch: fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017.
Starting HEAD: f60cc279d087c13406f94a069f4694ea57e127c9.

The approved runtime/SQL design and classifications are unchanged. Candidate v2 prosrc MD5 remains 97e621afd88048b1c1f8f04dfa70892a.

Node 22.23.3 was downloaded from nodejs.org and SHA256-verified. Native PostgreSQL 17.11 binaries were extracted from the official PGDG Ubuntu package, verified against the signed repository index. Local server startup is blocked by this environment's single-UID user namespace: PostgreSQL correctly refuses root and this host disallows switching/mapping to a non-root UID. No root-check bypass was attempted.

A dedicated branch-only, read-only-permission GitHub Actions verification job therefore uses postgres:17 and Node 22. It installs the committed application lockfile, runs the exact Phase A release bundle and original matrix, exact rollback/reapply, targeted real concurrency, existing application tests/quality checks/build, and uploads synthetic evidence. It has no Production credentials, Supabase writes, Vercel deployment, billing configuration, or main/security branch mutation.

The test harness adds only an optional loopback fixture adapter and targeted multi-session tests. It refuses remote databases and requires the dedicated dawaa_batch4_verification database. The existing PGlite mode remains available and passes 53/53 on Node 22. This is harness compatibility evidence, not yet Native PG17 parity evidence.

Hosted CI before this checkpoint: no runs on the continuation branch. Existing Build/Quality workflows support workflow_dispatch but the connected GitHub tools expose no dispatch operation. Their contents were inspected; no broad existing workflow modification is made. The narrow native parity workflow is required for the unavailable local non-root execution environment.

Native PG17 result: PENDING.
Concurrency result: PENDING.
Production read-only fresh preflight: NOT RUN (must follow successful PG17/Node22 verification).
Production writes/data changes/reanalysis/repair: 0.
Merge/deploy: 0.
