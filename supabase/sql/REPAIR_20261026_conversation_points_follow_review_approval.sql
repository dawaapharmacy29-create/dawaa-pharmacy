-- MANUAL, REQUIRES OWNER APPROVAL. Not a migration; never applied automatically.
-- Run only after 20261026093000_conversation_review_points_follow_approval_v1.sql is applied.
--
-- Production evidence (2026-10-26, read-only): 7 payable conversation_evaluation transactions
-- (45 points) whose review impact_status is 'pending':
--   e6d9621e-9603-467d-bb00-6b60f1a34b8d, 670617e5-3b67-4d7e-a68c-91c77d50ac76,
--   8f7ff389-fd97-4552-a98c-5fff0883cacd, d36837d6-5213-4575-b0ef-48ed9e0c4614,
--   0935348b-f1bf-48b3-990e-a0b3b4e73e90  (reviews set to pending by the 2026-08-21 recalculation)
--   8899d356-c9eb-403e-bfb6-e77a8391a12d  (review manager-reviewed but still pending)
--   1e7b772a-67ff-43e4-af4e-cb31b4b1bffa  (approved points; review pending since 2026-08-06)
--
-- Owner decision 2026-10-26: all seven review impacts remain UNAPPROVED. Do not
-- approve their associated reviews merely to match the old payable ledger.
-- Preserve any closed payroll exactly as it was; an adjustment against a closed
-- cycle is a separate proposal requiring a further explicit owner decision.
-- This file is a read-only review by default. Never run the commented mutation
-- without reconciling the cycle's actual paid status (snapshot absence alone
-- is not evidence that a historical payroll cycle was unpaid).

-- 1) Preview (read-only).
select t.id, t.staff_id, t.month_cycle, t.points_delta, t.status,
       r.id review_id, r.impact_status, r.reviewer_role,
       exists(select 1 from public.payroll_finalized_snapshots_v2 f
              where f.staff_id=t.staff_id and f.month_cycle=t.month_cycle) as finalized_snapshot_exists
from public.employee_transactions t
join public.conversation_sales_reviews r on r.id::text = t.source_id::text
where t.id in (
  'e6d9621e-9603-467d-bb00-6b60f1a34b8d',
  '670617e5-3b67-4d7e-a68c-91c77d50ac76',
  '8f7ff389-fd97-4552-a98c-5fff0883cacd',
  'd36837d6-5213-4575-b0ef-48ed9e0c4614',
  '0935348b-f1bf-48b3-990e-a0b3b4e73e90',
  '8899d356-c9eb-403e-bfb6-e77a8391a12d',
  '1e7b772a-67ff-43e4-af4e-cb31b4b1bffa'
)
  and t.source = 'conversation_evaluation'
  and lower(coalesce(t.status,'')) in ('active','approved')
  and not public.dawaa_conversation_review_points_payable_v1(r);

-- 2) Conditional repair proposal only; not authorized for execution until
--    payroll-cycle paid/finalized evidence is reconciled per staff member.
--    Expected: 7 rows before any correction, 0 after an authorized correction.
-- begin;
-- update public.employee_transactions t set status = 'pending', updated_at = now()
-- from public.conversation_sales_reviews r
-- where r.id::text = t.source_id::text
--   and t.id in (
--     'e6d9621e-9603-467d-bb00-6b60f1a34b8d',
--     '670617e5-3b67-4d7e-a68c-91c77d50ac76',
--     '8f7ff389-fd97-4552-a98c-5fff0883cacd',
--     'd36837d6-5213-4575-b0ef-48ed9e0c4614',
--     '0935348b-f1bf-48b3-990e-a0b3b4e73e90',
--     '8899d356-c9eb-403e-bfb6-e77a8391a12d',
--     '1e7b772a-67ff-43e4-af4e-cb31b4b1bffa'
--   )
--   and t.source = 'conversation_evaluation'
--   and lower(coalesce(t.status,'')) in ('active','approved')
--   and not public.dawaa_conversation_review_points_payable_v1(r);
-- commit;
