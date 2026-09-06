-- Same class of gap as conversation_sales_reviews: customer_service_manager_reviews
-- (manager notes/strengths/improvements about a specific reviewed staff member) was
-- readable by anyone holding 'view_reviews' -- including pharmacists/doctors -- with
-- no row-level restriction, so any such account could read every staff member's
-- manager review notes across both branches directly from the database.
-- Table had 0 rows at the time of this fix, so this is a schema fix before data
-- accumulates, not a retroactive incident.
--
-- Also removes duplicate/overlapping legacy policies left over from an earlier
-- canonicalization (both a "_select"/"_insert"/"_update" and a "_select_canonical"/
-- "_insert_canonical"/"_update_canonical" policy existed side by side for the same
-- command, which is redundant and makes the effective rule harder to reason about).
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied. Depends on
-- dawaa_can_read_conversation_review_row_v1 from the companion migration
-- 20260906120000_scope_conversation_review_select_to_owner_and_branch_v1.sql.

drop policy if exists customer_service_manager_reviews_select on public.customer_service_manager_reviews;
drop policy if exists customer_service_manager_reviews_insert on public.customer_service_manager_reviews;
drop policy if exists customer_service_manager_reviews_update on public.customer_service_manager_reviews;

drop policy if exists customer_service_manager_reviews_select_canonical on public.customer_service_manager_reviews;
create policy customer_service_manager_reviews_select_canonical
on public.customer_service_manager_reviews
for select
to anon, authenticated
using (
  public.dawaa_current_actor_can(array['view_reviews'])
  and public.dawaa_can_read_conversation_review_row_v1(reviewed_staff_id, manager_id, branch, reviewer_id)
);
