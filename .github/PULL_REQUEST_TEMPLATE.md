## Problem / root cause

<!-- What is wrong, and what evidence points to the root cause? -->

## Canonical boundary used

<!-- Source of truth, read model/service/RPC, identity and permission boundary. -->

## Change

<!-- Smallest behavior/code change made. Include explicit non-goals. -->

## Security / permissions

- [ ] Route/page visibility checked
- [ ] Action permission checked
- [ ] Service/RPC authorization checked
- [ ] Database grants/RLS checked or not applicable

## Data correctness

- [ ] No new parallel source of truth
- [ ] No failure hidden as a valid-looking 0/[]/absence
- [ ] No duplicate staff/customer/invoice identity logic
- [ ] Downward corrections can decrease non-monotonic totals where applicable
- [ ] Branch/transaction identity preserved

## Performance

- [ ] Changed reads are bounded
- [ ] Only required columns are selected
- [ ] Cache/freshness class is appropriate
- [ ] No N+1 or duplicate concurrent read introduced
- [ ] Safe after long-term data growth

## Verification

<!-- List exact tests/gates and results. Do not claim Vercel/CI passed unless it did. -->

- [ ] Targeted tests
- [ ] Architecture/permission gates relevant to the change
- [ ] `npm run verify` or explanation of the external blocker

## Risk / rollback

<!-- Remaining risk, migration concerns, and simplest rollback/revert path. -->