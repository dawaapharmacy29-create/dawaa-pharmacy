# Evaluation Lab v6 — data model and design (trial branch)

Status: **trial**. Read-only lab at `/evaluation-lab` (general manager). It computes the proposed
monthly evaluation from canonical data **without writing anything** and without changing the
current v5 evaluation, incentives or payroll. Nothing here is payable.

## 1. Why (Production facts, cycle 2026-09-26 → 2026-10-25)

| Fact | Consequence for the design |
|---|---|
| 25 monthly v5 evaluations since July, 1 approved; 2 weekly manager evaluations ever | Manual scoring does not happen → the score must be computed, the manager only adjusts |
| 7,082 generated daily tasks, 0 completed; manager checklist unused since August | Checkbox criteria score 0 today → never weight unverifiable ticks |
| Follow-ups and shift notes: no rows since August/July | These axes are **not measurable**, they must not count as 0 |
| Official conversation reviews average ≈98/100 | Absolute review score does not discriminate → shrink by volume, compare to peers |
| Invoice coding ≈96% for everyone | Use deviation from the peer median, not the raw rate |
| 14–22% of attendance days still need review | Discipline uses resolved days only; unresolved days are shown, not punished |
| `staff.role` mixes Arabic/English spellings | Role family via `canonicalStaffRole` only |

## 2. Principles

1. **One cycle, one engine**: 26→25, every role family through the same aggregation.
2. **Measured, partial or not measurable** — never an invented 0 or 5. Each axis reports
   `status`, `value`, `score (0–100)`, `basis` (what was counted) and `reason` when unmeasurable.
3. **Weight redistribution**: total = Σ(wᵢ·sᵢ) / Σ(wᵢ of measured axes).
   Coverage = Σ(wᵢ measured) / Σ(wᵢ all). Readiness: ≥70% *ready*, 40–70% *partial*, <40% *insufficient*.
4. **Relative where absolute scales saturate**: percentile among peers of the same role family
   (needs ≥3 measured peers); deviation from the peer median for rates near 100%.
5. **Volume-aware**: small samples are shrunk toward the population mean (k = 5) so 1 perfect
   review does not beat 40 very good ones.
6. **Identity**: only `staff_id`-linked evidence; the delivery label is resolved through
   `staffIdentityKey` with a unique active owner.
7. **Managers are scored from outcomes of their branch/team**, never from self-ticked lists.

## 3. Axes (v6.0)

Worked day = an `attendance_daily_summary` day with a first punch. Resolved day = a worked day whose
status is final (not `*_review`, `missing_*`, `absence_review`, `invalid_schedule_time`).

### Doctor (pharmacist)
| Axis | Weight | Value | Score | Measurable when |
|---|---|---|---|---|
| sales_per_day | 30 | linked net sales ÷ worked days | percentile among doctors | ≥5 worked days |
| coding_quality | 10 | coded invoices ÷ invoices | 50 + (rate − doctors' median)×1000, 0–100 | ≥30 invoices |
| conversation_quality | 20 | official reviews, shrunk mean (k=5) | percentile among doctors | ≥3 official reviews |
| discipline | 25 | on-time share of resolved days, late minutes/day | 100·on_time − min(30, late/2) | ≥8 resolved days |
| customer_requests | 15 | requests recorded ÷ worked days | percentile among doctors | ≥5 worked days |
| followups | — | dormant source | not measurable | when the source is active again |

### Assistant
discipline 50 · purchase_entry (purchase invoices entered ÷ worked day, percentile) 30 ·
customer_requests 20.

### Delivery
discipline 50 · deliveries_per_day (invoices whose delivery label resolves to this courier ÷ worked
day, percentile) 50.

### Branch manager (branch = `staff.branch`)
| Axis | Weight | Value | Score |
|---|---|---|---|
| branch_target | 30 | branch net ÷ `branch_sales_targets.target_amount` | achievement % (cap 120) ÷ 1.2 |
| team_discipline | 20 | mean discipline score of the branch team | as is |
| team_conversations | 15 | mean conversation score of the branch doctors | as is |
| branch_coding | 10 | branch coding rate vs all-branches median | like coding_quality |
| requests_closure | 25 | closed share and median hours to close | 100·closed − min(30, median_h/4) |

### Branches manager
branches_target 35 (both branches) · team_discipline 15 · branch_managers (mean total of the branch
managers) 25 · requests_closure 25.

## 4. Visual design

- Header: cycle picker (closed cycles), coverage health of every source (active / dormant).
- Role-family tabs; ranked list with score ring, readiness chip and a coverage bar.
- Person sheet: every axis as a row — bar for the score, the raw value and its basis, a hatched
  “غير قابل للقياس” state with the reason, and peer context (median, rank).
- Managers: team breakdown (members and their totals) under their own score.
- Never shows money; a banner states that the lab is not payable.

## 5. Path to production (after trial)

1. Agree weights/thresholds in the lab.
2. Move the computation to one server read projection (`evaluation_cycle_scores_v6`) with parity
   tests against the lab; v5 manual sections become the bounded manager adjustment (≤15%).
3. Replace dormant task generators with an exception agenda that closes from data.

## 6. Calibration after the first real-data trial (cycle 2026-09-26 → 2026-10-25)

| Finding | Change |
|---|---|
| 60+ attendance resolution statuses; most manager approvals carry real late minutes, so status-name matching scored approved on-time days as late | Discipline = mean per-day credit from `late_minutes` on resolved **scheduled** days: ≤15 min 1, ≤60 min 0.5, beyond 0; approved absence with deduction 0; no-schedule/flexible/leave/ended days excluded |
| Unresolved pattern matched resolved approvals containing "absence" | Unresolved = `*_review`, `missing_checkin/checkout`, `invalid_schedule_time` only |
| Review averages ≈96–99: percentile turned 96.8 vs 99.1 into 9 vs 100 | Conversation quality = absolute band 90→0 … 100→100 on the shrunk mean |
| Coding ≈96–99%: deviation scoring was too steep | Coding = absolute band 90% → 0 … 100% → 100 |
| An "insufficient" person ranked 4th on 20% coverage | Only ready/partial people are ranked; insufficient listed last, unranked |
| `base44_purchase_invoice_sync` is not readable by client sessions; accuracy reviews: 0 in the cycle | Purchase entry axis is "not measurable" with its reason; the cycle still computes |

Result: doctors' median 38 → 61; assistants 67; delivery 60; branch managers 67 / 56; branches manager 60.

Open decisions:
1. Doctors with very few invoices (e.g. 4 in a cycle) get the lowest sales percentile — confirm whether
   non-selling duties need their own family or an exemption.
2. Customer requests per worked day rewards volume only; closure belongs to the recording doctor or
   to the branch?
3. Conversation quality still discriminates weakly; consider critical-error rate as the main signal.
4. Loading takes ~20 s client-side (9.4k invoices); production must use one server projection.

## 7. Owner decisions and second calibration (2026-10-28)

- **Part-time doctors** (e.g. present a few days a month): sales are now a **fair share of branch sales on
  the doctor's own worked days** — per day, expected = branch sales ÷ doctors present; score 0.4→0,
  1.0→50, 1.6→100. A worked day is a punched day **or** a day with own invoices, so missing punches never
  erase sales. Branch size and busy days cancel out.
- **Customer requests**: the doctor is credited for the **number recorded**; execution/closure is the
  **branch manager's** responsibility (`requests_closure` on the branch-manager card).
- **Conversation quality**: kept as is until the Master Brain evaluations are approved; then replaced.
- **Speed** (client-side, no DB change): sales pages now load in parallel ordered by the covering index
  `(invoice_date, id)` → sales 19.3 s → 1.3 s, total 21.6 s → 8.3 s. The remaining ~6 s is
  `attendance_daily_summary` RLS evaluating its permission functions per row (same pattern fixed for
  customer requests): a migration wrapping them in `(select …)` needs separate approval.

## 8. v6.1 — owner review proposal (2026-10-28)

The lab computes v6.1 and shows each person's change against v6.0 (`buildCycleScores(evidence, 'v6.0')`).

| Family | Axes and weights |
|---|---|
| Doctor | fair-share sales 30 · discipline & punches 25 · conversation quality 20 · **valid** customer requests 15 · coding **gate** (weight 0) |
| Assistant | discipline & punches 40 · daily checklist 35 · purchase entry 25 |
| Delivery | discipline & punches 40 · **fair share** of branch deliveries 45 · delivery rating 15 |
| Branch manager | target 30 · request execution/closure 25 · team discipline 15 · **team punch follow-up** 15 · **team quality** (conversations + branch coding) 15 · decision backlog (information) |
| Branches manager | target 35 · branch managers 25 · request closure 25 · team discipline 15 · decision backlog (information) |

Rules:
- **Coding gate:** saturated (96–99% for everyone), so no weight. Below 95%, 2 points off per percentage point, at most 10, shown as an adjustment next to the base total.
- **Missing punches:** a `missing_checkin` / `missing_checkout` day that was never corrected is the employee's own zero-credit day. Days waiting for a decision (`*_review`, `invalid_schedule_time`) stay excluded.
- **Valid requests:** cancelled, duplicate and rejected requests are neither credited to the recorder nor counted in the branch closure rate.
- **Couriers:** the same fair-share rule as sales, applied to deliveries; part-timers are compared on their own days.
- **Decision backlog** (attendance days waiting for a decision) is shown with weight 0. In cycle 2026-09-26 → 2026-10-25 most attendance and time-off decisions were taken by the general manager or the automatic system, not by branch managers, so ownership must be agreed before it is weighted.

Data facts (Production, cycle 2026-09-26 → 2026-10-25):
- `staff_daily_checklist_submissions` and `ratings` have **never** had a row. Assistant checklist and delivery rating are therefore "not measurable" until the teams start recording.
- `ratings` has RLS with no select policy, so the production projection must read it server-side.
- Customer requests: 278 recorded (all with `source_recorded_staff_id`); 20 cancelled; 162 still `new`.
- Attendance: 176 days still waiting for a decision (فرع الشامي 89, فرع شكري 78).

Production keeps: a manager adjustment of at most ±10 with a mandatory written reason, visible to the employee and open to appeal (not part of the read-only lab).

### v6.1 first real run (cycle 2026-09-26 → 2026-10-25)

- **Deliveries cannot rank couriers yet.**
  - فرع الشامي writes a courier name on about 9% of its invoices.
  - Labels such as «ا محمد عاطف» (391 invoices) and «ا محمد الديب» do not resolve, because of the honorific prefix.
  - Assistants' names also appear as couriers.
  - The delivery axis is therefore gated: it is not measurable until a branch labels ≥25% of invoices and ≥80% of its labels resolve to a courier. The fix belongs to identity aliases and to recording at the counter, not to the lab.
- **Customer request execution is the weakest branch signal:**
  - فرع شكري: 45 of 194 valid requests closed, median 44 h.
  - فرع الشامي: 9 of 63 closed, median 80 h.
  - Most open requests are still `new`.
- **Branch targets are a standing per-branch value** (`branch_sales_targets`, no cycle history). The production projection must snapshot the target used for each closed cycle.

## 9. v6.3 — customer requests measured by completeness (owner decision 2026-10-29)

**Request capture (doctor, weight 15) replaces the request count, which stays visible with weight 0.**

Formula: self-recorded ÷ requests the Master Brain found in the doctor's WhatsApp conversations of the cycle.

A found request counts as self-recorded when a request exists that matches all of the following:
- recorded by the same doctor;
- same customer (id, code or the last 10 phone digits);
- same product (code, or one name containing the other);
- recorded from 2 h before the conversation started to 48 h after it ended;
- not the request created by approving the Master Brain proposal (`target_id`).

Measurability and scoring:
- The axis is measurable from 5 found requests per doctor.
- Scoring band: 70% → 0, 95% → 100. 95% is the owner's full-incentive line.

**Incentive tiers proposed by the owner** (money stays outside the lab):

| Capture | Incentive |
|---|---|
| ≥ 95% | 300 EGP |
| 85–95% | 180 EGP |
| 70–85% | 90 EGP |
| below 70% | 0 |

**Prerequisites before this axis is used for money:**
1. **Full coverage:** the Master Brain must analyse every conversation. Production holds 2 analysed sources and 0 `customer_request` actions today, so the axis is "not measurable".
2. **Unlinked requests:** fixed in PR #582 (`canonicalCustomerRequestProjector`). Requests whose only blockers are identity are persisted as identity-pending proposals and completed in place once identity resolves.
3. **Request time:** fixed in PR #582. `payload.requestedAt` is stored, and the lab uses it (2 h before → 48 h after the request) when present; older rows fall back to the conversation window.
4. **Dry run:** one full cycle without money, with disputes reviewed by a person.
