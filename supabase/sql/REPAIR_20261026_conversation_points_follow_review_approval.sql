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
-- Decision for the owner per row: either APPROVE the review (the sync trigger then keeps its points
-- payable), or run this repair to move the points back to 'pending' (visible, not payable).

-- 1) Preview (read-only).
select t.id, t.staff_id, t.points, t.status, r.id review_id, r.impact_status, r.reviewer_role
from public.employee_transactions t
join public.conversation_sales_reviews r on r.id::text = t.source_id::text
where t.source = 'conversation_evaluation'
  and lower(coalesce(t.status,'')) in ('active','approved')
  and not public.dawaa_conversation_review_points_payable_v1(r);

-- 2) Repair (uncomment after approval; expected: 7 rows).
-- begin;
-- update public.employee_transactions t set status = 'pending', updated_at = now()
-- from public.conversation_sales_reviews r
-- where r.id::text = t.source_id::text
--   and t.source = 'conversation_evaluation'
--   and lower(coalesce(t.status,'')) in ('active','approved')
--   and not public.dawaa_conversation_review_points_payable_v1(r);
-- commit;
