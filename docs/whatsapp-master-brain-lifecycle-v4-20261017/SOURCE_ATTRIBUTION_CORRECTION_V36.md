# Transaction branch rule and audited source attribution correction (V36)

Status: source and isolated tests only. The migration
`20261020153000_whatsapp_source_attribution_correction_v1.sql` is **NOT APPLIED** to any
Supabase project and requires explicit owner approval. No live row was written.

## Proven defects (live read-only evidence, 2026-10-20)

- Synthetic source `753b38b2…` is stored with branch `كل الفروع` and staff `د/ معاذ` (general
  manager, account-wide scope). The staff attribution came from the original example text, not
  from code. The branch came from the pre-`004916f7` intake rule.
- The canonical request qualification owner accepted any non-empty branch, so the case was
  `qualified` and projected as proposal `5728c227` in `كل الفروع`. The follow-up owner did the
  same for `f5a9eb93`.
- `dawaa_approve_whatsapp_customer_request_action_v2` only compared action vs source
  branch/staff. Both were consistently wrong, so approval would have materialized a real
  request in `كل الفروع` attributed to the general manager.
- No application or database path existed to correct a stored source's text, staff or branch.

Live blast radius of the branch markers: one source, one request proposal and one follow-up
proposal, all synthetic. 37 legacy client-created request proposals all have real branches.

## Source change (shipped on the branch)

- One rule: `isNonTransactionBranchMarker` in `src/lib/branch.ts`. It is reused by intake branch
  hints, the request qualification owner, the follow-up owner and the request projector.
- Request qualification: a marker branch adds `branch_unknown`, so the request is
  `review_required` and is not projected.
- Follow-up owner: a marker branch makes the opportunity `blocked` with
  `transaction_branch_unknown`. It stays visible and keeps the same `followUpKey`. The TS
  projector and `dawaa_reconcile_canonical_followup_actions_v1` already exclude blocked
  opportunities, so the exact-set contract still holds.
- Request projector: a stale qualified decision with a marker branch is skipped as
  `non_transaction_branch`.
- Complaints stay visible as proposals. The database refuses to materialize them in a marker
  branch.
- `PIPELINE_VERSION` is now `sales-intelligence-v36-transaction-branch-required`. This affects
  only the next explicit refresh; there is no backfill.

## Migration design (pending approval)

1. `dawaa_is_transaction_branch_v1(text)` mirrors the TS rule.
2. `dawaa_canonical_request_is_current_v1`, a service-only helper, checks that the current,
   single published analysis still qualifies the exact `requestKey` and product.
3. The approve RPC adds a transaction-branch check. For canonical-projection rows only, it also
   adds the current-qualification check. Legacy proposals keep their contract.
4. The materialize wrapper keeps the body of `20261019093000` unchanged and adds two checks:
   - No new customer request or follow-up of any type in a marker branch. A completed-request
     retry is unaffected.
   - An approved canonical request whose qualification was withdrawn by a later re-analysis is
     not executable.
5. `dawaa_correct_whatsapp_source_attribution_v1(source, expected_hash, raw_text, new_hash,
   staff, branch, reason)`:
   - Permission `approve_reviews`, plus review-row access to both the old and the new
     attribution.
   - A transaction branch is required. The staff member must be active, must be a real staff row
     and not the conversation's customer, and must work in that branch or have account-wide
     scope.
   - Optimistic `expected_hash`. The new hash must be 64-hex and unique. Exact replay is a no-op.
   - Refuses archived or human-confirmed sources, and any executed, approved, assigned or
     contacted action. Those keep their lineage and need manual handling.
   - Retires unexecuted proposals: they become `dismissed`/`withdrawn` with suffixed
     `action_key`/`followup_identity`. The original values are kept in the payload and the full
     before-state in the audit. Nothing is deleted.
   - Updates source text, hash, staff and branch. Customer identity is never touched.
   - Writes one `whatsapp_review_audit` row with the reason.
   - Does not analyze, project, approve or materialize. Re-analysis remains the existing
     explicit single-source refresh.

Why retire identities instead of only dismissing:
- Stable operation identities come from the first customer message and contact label, so they
  survive the correction.
- A merely dismissed request would make the projector report `existing` and never re-propose it.
- A withdrawn follow-up would be revived by reconcile and fail `canonical_followup_stored_branch_mismatch`.

## Isolated verification

`sourceAttributionCorrection.test.ts` runs the lifecycle, retry and V36 migrations in PGlite (21
tests). It covers:
- The marker rule parity.
- Approval refusal in account-wide scope.
- Approval and materialization only while currently qualified.
- Unchanged legacy approval.
- Materialization refusal for every follow-up type.
- Correction, retirement, unaffected neighbouring source, audit and idempotent replay.
- One corrected request and one reconciled follow-up after correction, with no duplicate on a
  second reconcile.
- Each refusal with no side effects.

## Additional review findings (2026-10-20)

- **No approve or execute UI existed.** Neither this branch nor `main` contained any client call to
  `dawaa_approve_whatsapp_customer_request_action_v2` or `dawaa_materialize_whatsapp_action_v1`.
  `SourceOperationsPanel`, on the Sales Intelligence case page, now provides explicit approve and
  execute buttons. Each needs a confirmation dialog and goes through those authorized commands
  only. A 200 response without `ok=true` plus a real `target_id` is shown as a failure.
- **Unaudited direct edits to the source.** `whatsapp_review_sources` had a client UPDATE policy
  and no guard on attribution fields. The migration adds `whatsapp_source_attribution_guard_v1`:
  - Browser ingest and re-analysis may still fill blank fields, as they do today.
  - Overwriting stored text, hash, customer, staff or branch requires a server role or a SECURITY
    DEFINER command.
- **Legacy request proposals (37 live).** 28 have no staff and were already unapprovable, 7 are
  consistent, 1 has an inactive staff member, and 1 has a staff member from المخزن serving فرع شكري.
  None has a non-transaction branch. The current-qualification check applies only to canonical
  projection rows. No staff-branch rule was added to approval, so legitimate cross-branch cover
  keeps working.
- **Unresolved staff.** A request without a resolved staff member is never projected
  (`missing_staff_identity`) and never approvable (`customer_request_action_canonical_identity_required`,
  `active_staff_required`). The per-message `staff_identity_unresolved` blocker is message-level
  attribution and is not used to gate requests: the source's directory-resolved staff member is the
  canonical known staff member of the case.
- **Live check, read-only.** Re-hashing the stored text of the synthetic source reproduces
  `30cb3306…`. Changing only the self-introduction line keeps the sender labels, timestamps and
  5 messages, and yields `fe978ba1…`.

## Correction screen

On `/sales-intelligence/qa/<case>`, under «العمليات المقترحة من هذه المحادثة»:
1. Choose the transaction branch, then the responsible doctor. The list is active canonical staff
   of that branch, or staff with account-wide scope, never the customer.
2. Edit the text. The timestamps and message count must stay the same.
3. Write a reason, then click «معاينة التغييرات». The preview shows the old and new values and
   every changed line. Any later edit clears the preview.
4. Tick the explicit confirmation box, then confirm the final dialog.
5. The command writes one audit row. The audit log is shown in the same panel.
6. Click «إعادة التحليل الصريحة», then approve and execute the new proposal from the same panel.

## Rollback

`docs/.../sql/rollback_20261020153000_source_attribution_correction_v1.sql`:
- Restores the exact previous approve and materialize bodies, and drops only the added
  functions and trigger, in one transaction.
- A PGlite test checks that rollback leaves data untouched and restores the previous approval
  behavior, and that the forward migration re-applies cleanly afterwards.
- Every correction is atomic: any refusal or error rolls the whole command back.
- An applied correction is undone forward: run another correction to the right staff/branch
  (tested). A correction back to a non-transaction branch is refused by design.

## Residual risk and remaining work

- `new_hash` is computed by the application (`hashWhatsAppSession`). The database checks format
  and uniqueness but cannot recompute it. A wrong hash would only weaken re-upload dedupe for that
  source.
- The screen calls RPCs that exist only after the migration is approved and applied. Until then,
  correction fails visibly as a missing function, and approval keeps the old database contract.
- A request proposal whose qualification is later withdrawn stays visible as `proposed` until
  corrected or dismissed. Its approval now fails with `customer_request_requires_current_qualification`.
