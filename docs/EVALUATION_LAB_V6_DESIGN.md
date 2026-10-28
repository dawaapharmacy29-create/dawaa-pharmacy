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
