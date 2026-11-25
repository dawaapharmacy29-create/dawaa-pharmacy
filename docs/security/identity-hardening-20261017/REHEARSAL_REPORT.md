# Security-first identity hardening — isolated rehearsal (x-dawaa-user-id and p_actor_id)

Date: 2026-10-17.

> **Authoritative follow-up status:** this detailed report records the original `090000–090600` isolated rehearsal. The branch later strengthened `090100` with exact PRE/POST RLS metadata guards and added `090700` for the postgres/public default-function ACL. Those two follow-up changes require a fresh isolated replay before any Production apply decision. See `HANDOFF.md` for the current status.

**Production was not modified.** Every Production call in the rehearsal was a read-only SELECT on the catalog: schema, bodies, grants and policies. No rows were read or written apart from synthetic rows inside the isolated clones.
- Not done in this rehearsal: migrations applied to Production, pushes to `main`, Production deploys.
- Business rows changed: **0**.

The original detailed evidence remains in the committed synthetic result JSON files and classification report in this directory. The key original results were:

- native local Docker Supabase PostgreSQL 17.6;
- 58/58 post-fix security tests PASS;
- 150/150 legitimate differential calls identical;
- 48 pre-fix catalog violations → 0 after the original candidate;
- rollback restores baseline;
- apply → rollback → re-apply PASS;
- drift guards PASS;
- `run-tests` 1048/0;
- `p_actor_id` UNKNOWN = 0.

**Do not treat those original PASS counts as proof of the later `090100` metadata strengthening or the new `090700` default-ACL migration. Re-run the isolated PostgreSQL 17.6 rehearsal first.**

For the full historical inventory/details, use the original checkpoint commit `363dd003569777ef66b0f4346c23191ded2a3f5b` and the synthetic result artifacts preserved on this private branch.
