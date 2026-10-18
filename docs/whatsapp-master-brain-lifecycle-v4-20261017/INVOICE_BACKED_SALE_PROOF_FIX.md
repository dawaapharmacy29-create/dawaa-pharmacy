# Invoice-backed sale proof — V27

The live Preview example found a unique transactional invoice with the same resolved customer,
branch and imported product, but the canonical proof stayed statistical because the recorded
invoice timestamp was 173 minutes after the conversation. The automatic attribution gate only
accepted 30 minutes. Missing conversation totals then left the commercial outcome open.

The existing canonical attribution gate now also accepts the existing bounded strong/moderate
window (at most 360 minutes after the case) when canonical customer ID and branch match exactly,
in addition to its existing exact customer code/name, stable invoice row ID, positive invoice,
real imported product coverage and unique-candidate requirements. Unresolved basket identities,
known quantity conflicts and rejected orders cannot qualify. No timestamp offset is invented.
The existing proof/integrity engines still reject competing-case claims and evidence conflicts.
No statistical legacy 'verified' label is promoted to truth.

The invoice proves the sale separately from chat protocol compliance: missing chat totals and
final staff confirmation remain review/coaching evidence. Delivery receipt is not fabricated,
and invoice seller identity is not replaced with the conversation employee.

Validation: anonymized top-level pipeline regression reproduces failure with the old 30-minute
rule, then passes with the fix. Negative cases cover competing invoices, conflicting customer or
branch, missing canonical identity, earlier/distant timestamps, absent/different product lines,
quantity mismatch and unresolved customer identity. Repeated analysis retains invoice identity.
The generated refresh API is regenerated from source, never hand edited.

No production writes, database/schema changes, production deployment or main merge were made.

## Verified delivery

- Code commit: `3ca2ab6c36cffa503415d697efae35e0002354da`.
- GitHub Actions run `39097699469`, job `117587454521`: SUCCESS.
- Focused invoice/proof/matching suite: 129 passed, including 13 new regressions.
- Full Verify: 1047 custom tests passed; 1292 Vitest tests passed in each Cairo/UTC run,
  with one pre-existing skipped test. TypeScript, build, semantic lint, authorization,
  architecture, generated parity and performance budget passed (202.1 KiB initial JS gzip).
- Authorized Preview only: `dpl_FvSXSgHAGWLBjxnkuyi1p5aGpA5b`, READY, exact code SHA above.
- Preview URL: https://dawaa-pharmacy-q4av4r9vu-dawaapharmacy29-creates-projects.vercel.app/
- Read-only HTTP verification of the watcher route: 200. This does not establish authenticated
  browser analysis success. Existing real sources have not been refreshed by the agent.
- Next live check: refresh only the existing sales source through the official authorized UI;
  compare canonical sale proof against invoice facts. Do not re-upload or batch-process files.
