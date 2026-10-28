# Staff identity key — conflict resolution plan (read-only, 2026-10-28)

Status: **plan only**. Nothing in this document has been applied to Production. Every step that
changes an alias, an invoice owner, points or pay requires its own explicit approval.

## The single key

`staffIdentityKey` (`src/lib/staff/staffIdentityKey.ts`) = `normalizeArabicName` (the resolver's
normalizer) with whitespace removed. The database mirror is `dawaa_normalize_staff_alias_v1`
(migration `20261025112817_staff_alias_atomic_ownership_v1`), proven equal on 36 fixtures by
`scripts/test-staff-alias-atomic-local.mjs`.

The previous key (`staffDuplicateAudit.normalizeStaffName`, also used for stored
`normalized_alias`) removed any leading «د / أ / م» letter: محمد and أحمد both became «حمد»,
مصطفي «صطفى», دعاء «عاء». The new key keeps first letters and strips a title only when it is
separated («د/ دنيا», «د دنيا», «دكتور دنيا» → «دنيا»; «دنيا» stays «دنيا»).

## Production impact of the new key (read-only, 2026-10-28)

| Item | Count |
|---|---|
| Active aliases | 137 |
| Stored keys that the migration recomputes (audited, owner unchanged) | 52 |
| Same employee holding several spellings of one key (allowed) | 34 |
| Alias keys claimed by two employees (**migration aborts**) | 1 — «اسلام» |

Name-level claims seen by the resolver (staff names + active aliases):

| Key | Active owners | Retired owners | Seller invoices since 2026-07-26 | Effect after #556 |
|---|---|---|---|---|
| اسلام | 2 | 0 | 0 (labels are «د اسلام فاروق») | stays unresolved until decided |
| **دنيا** | 1 | 1 | **1,826 (785,010 EGP), 675 already unlinked** | **new invoices become unlinked** |
| علا | 1 | 1 | 0 | unresolved |
| اعبدالحميد | 1 | 1 | 0 | unresolved |
| محمدخالد | 0 | 2 | 129 (4 unlinked) | unresolved |
| ضحي | 0 | 3 | 22 (21 unlinked) | unresolved |

**Merge gate:** PR #556 must not be merged before decisions 1 and 2 below are applied, otherwise
the TypeScript resolver (which deploys with the merge, independently of the migration) stops
crediting Dr. Donia's new invoices.

## Decision 1 — «اسلام» (pharmacist vs courier, both Shokry)

Evidence (read-only):

- Pharmacist **د اسلام فاروق** — active, Shokry; login username is literally «د اسلام»; a merged
  duplicate record «د/ اسلام (سجل مكرر تم دمجه)» is retired. Aliases: «د اسلام», «د/ اسلام»,
  «دكتور اسلام».
- Courier **اسلام السبع** — active, Shokry; appears only as `delivery_staff` «اسلام السبع»
  (640 invoices, 2026-02-24 → 2026-10-25) and **never** as a seller. Alias: bare «اسلام».
- Every seller label is titled: «د اسلام» (3,969 invoices, Jan–May, all unlinked) and
  «د اسلام فاروق» (4,186 invoices, May–Sep, 2,123 unlinked).

Recommended resolution (needs approval):

1. **Retire the courier's bare alias «اسلام»** (`active = false`, audited; the courier keeps
   «اسلام السبع», which is the only label any source uses for him). Ownership of key «اسلام» then
   goes to the pharmacist only; the migration preflight passes.
2. Do **not** reassign by name similarity anywhere else; the courier's delivery attribution is
   keyed by his full name and is unaffected.

## Decision 2 — «دنيا» (active pharmacist vs retired twin)

The retired twin «د/ دنيا» (المخزن, archived) blocks name-only resolution under fail-closed
rules. Options:

- **A (recommended):** confirm the archived record is the same person's old record and retire its
  aliases (audited) so the key belongs to the active employee only.
- **B:** if they are different people, keep the conflict and require per-invoice review.

The same review applies to «علا» and «اعبدالحميد» (active + retired), and to «محمدخالد» / «ضحي»
(retired only — no new invoices expected; keep unresolved).

## Decision 3 — historical unlinked invoices (separate approval)

Unlinked seller rows (e.g. 3,969 «د اسلام», 2,123 «د اسلام فاروق», 675 «دنيا» in the last three
cycles) are **not** relinked by #556: re-imports never write `staff_id` on existing rows. Linking
them changes sales, points and possibly incentives for closed cycles, so it needs:

1. a dry-run list per invoice with evidence (title in label, branch, employment period);
2. an audited, per-invoice relink command (no name-wide UPDATE);
3. a decision on whether closed cycles (26→25) are recomputed or only future cycles are affected.

## Order of operations after approval

1. Apply decisions 1–2 as audited alias retirements (current Production RLS already limits alias
   writes to `manage_staff_accounts`).
2. Re-run the preflight query: zero keys with two owners.
3. Merge PR #556 → deploy; apply its migration (backup check first; no `supabase db push`).
4. Decision 3 as its own reviewed change.

## Applied on Production (2026-10-28, approved by the general manager)

| Change | Rows | Audit |
|---|---|---|
| Retired the courier's bare alias «اسلام» (`8eac4c61…`); he keeps «اسلام السبع» | 1 alias | `activity_log` action `retire_staff_alias` (before/after + evidence) |
| Renamed archived duplicate «د/ دنيا» (`e6b0dfe1…`) → «د/ دنيا (سجل مكرر تم دمجه)» | 1 staff | `activity_log` action `mark_duplicate_staff_record` |
| Renamed archived duplicate «د/ علا» (`93e2076d…`, المخزن) → «د/ علا (سجل مكرر تم دمجه)» | 1 staff | `activity_log` action `mark_duplicate_staff_record` |

No invoice, transaction, point or evaluation was moved. The archived Donia record keeps its two
transactions (one cancelled, one +5 reward in the closed 2026-07 cycle).

Re-check after the changes (resolver key over staff names and active aliases):

- «اسلام»: one owner (د اسلام فاروق). **Resolved.**
- «دنيا»: one owner (د دنيا). **Resolved** — her new invoices keep linking after #556.
- «علا» and «اعبدالحميد»: the archived duplicates owned 4 active aliases each («علا», «د علا»,
  «د/ علا», «دكتور علا» / «ا عبد الحميد», «د ا عبد الحميد», «د/ ا عبد الحميد»,
  «دكتور ا عبد الحميد»). **Retired (approved, 8 aliases, `activity_log` `retire_staff_alias`).**
  Both keys now belong to the active records. Neither key had seller invoices since 2026-07-26.
- «محمدخالد», «ضحي»: retired-only owners; left unresolved by design (no live employee).

Final check (2026-10-28): migration preflight (alias level) — **no key with two owners**;
resolver — only the two retired-only keys above; 128 active aliases; 11 audit rows today.

Merge gate status: identity conflicts cleared. Remaining before merge: final review and explicit
approval; the migration needs its own backup check and `apply_migration` approval.
