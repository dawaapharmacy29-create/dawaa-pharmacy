-- Conversation-review points are financially effective ONLY while their review is officially
-- approved. NOT APPLIED automatically.
--
-- Found in production (2026-10-26, read-only): 7 conversation_evaluation transactions (45 points)
-- were active/approved while their review was back in 'pending' — 5 of them since the 2026-08-21
-- policy recalculation. Nothing synchronised review approval to the points ledger, and the
-- existing guard dawaa_guard_conversation_review_points_v53 (live-only, never committed) checked
-- only conversation_sales_reviews_official_v1, which does not exclude superseded, unapproved or
-- automatic rows.
--
-- Same contract as src/lib/evaluations/officialConversationReview.ts, two questions:
--   official (quality evidence) = current, not superseded, not reversed, and a human review by an
--     authorized reviewer (customer-service team, managers; no general-manager review required) or
--     an automatic analysis explicitly approved by a manager;
--   payable (points)            = official AND impact_status='approved' (impact_status is the
--     approval of the POINTS effect: a deduction or severe error waits as 'pending').
--
--   1. Guard: payable status (active/approved) requires a payable review; 'pending' requires a
--      current, non-superseded review (visible, never payable).
--   2. Sync: when a review stops being payable its payable points return to 'pending' (still
--      current) or 'cancelled' (superseded/rejected/reversed); when it becomes payable again its
--      pending points become 'approved'. Points values are never edited (ledger payload stays frozen).
--   3. Existing mismatched rows are NOT repaired here: see
--      supabase/sql/REPAIR_20261026_conversation_points_follow_review_approval.sql (needs approval).
--
-- Rollback: drop trigger dawaa_sync_conversation_review_points_v1 on public.conversation_sales_reviews;
-- drop function public.dawaa_sync_conversation_review_points_v1(); then restore the previous guard
-- (production body captured read-only 2026-10-26, never committed before):
--   create or replace function public.dawaa_guard_conversation_review_points_v53() returns trigger
--   language plpgsql security definer set search_path to 'public','pg_catalog' as $$
--   begin
--     if coalesce(new.source,'') in ('whatsapp_automatic_review','conversation_evaluation',
--          'conversation_review','conversation_sales_reviews')
--        and new.source_id is not null and coalesce(new.status,'active') in ('active','approved','pending') then
--       if not exists (select 1 from public.conversation_sales_reviews_official_v1 r where r.id = new.source_id) then
--         raise exception using errcode = '23514', message = 'conversation_review_points_require_official_review';
--       end if;
--     end if;
--     return new;
--   end $$;

create or replace function public.dawaa_conversation_review_is_official_v1(r public.conversation_sales_reviews)
returns boolean language sql stable
set search_path to 'public','pg_catalog'
as $function$
  select coalesce(r.is_current, true)
     and r.superseded_at is null
     and lower(coalesce(r.impact_status, '')) not in ('reversed', 'rejected', 'cancelled')
     and (
       (r.automatic_evaluation_version is null and lower(coalesce(r.evaluation_kind, '')) <> 'automatic')
       or (r.manager_reviewed_at is not null and nullif(btrim(coalesce(r.manager_reviewed_by::text, '')), '') is not null)
     )
$function$;

create or replace function public.dawaa_conversation_review_points_payable_v1(r public.conversation_sales_reviews)
returns boolean language sql stable
set search_path to 'public','pg_catalog'
as $function$
  select public.dawaa_conversation_review_is_official_v1(r)
     and lower(coalesce(r.impact_status, '')) = 'approved'
$function$;

create or replace function public.dawaa_guard_conversation_review_points_v53()
returns trigger language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  r public.conversation_sales_reviews%rowtype;
  v_status text := lower(coalesce(new.status, 'active'));
begin
  if coalesce(new.source, '') not in ('whatsapp_automatic_review','conversation_evaluation','conversation_review','conversation_sales_reviews')
     or new.source_id is null
     or v_status not in ('active','approved','pending') then
    return new;
  end if;

  -- FOR SHARE: a concurrent approval change on the review must commit (and run its sync) before
  -- this payable row is judged, otherwise a just-revoked approval could still mint payable points.
  select * into r from public.conversation_sales_reviews
  where id = case when new.source_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then new.source_id::text::uuid end
  for share;
  -- Membership in an operational canonical source (approval is checked separately below, so a
  -- pending review can still hold visible, non-payable points).
  if not found
     or (r.whatsapp_review_source_id is not null and not exists (
       select 1 from public.whatsapp_operational_canonical_sources_v1 o where o.source_id = r.whatsapp_review_source_id)) then
    raise exception using errcode = '23514', message = 'conversation_review_points_require_official_review';
  end if;
  if v_status in ('active','approved') and not public.dawaa_conversation_review_points_payable_v1(r) then
    raise exception using errcode = '23514', message = 'conversation_review_points_require_approved_review';
  end if;
  if v_status = 'pending' and (coalesce(r.is_current, true) is false or r.superseded_at is not null) then
    raise exception using errcode = '23514', message = 'conversation_review_points_require_current_review';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_conversation_review_points_official_v53 on public.employee_transactions;
create trigger trg_conversation_review_points_official_v53
  before insert or update of source, source_id, status on public.employee_transactions
  for each row execute function public.dawaa_guard_conversation_review_points_v53();

create or replace function public.dawaa_sync_conversation_review_points_v1()
returns trigger language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_was boolean := public.dawaa_conversation_review_points_payable_v1(old);
  v_is boolean := public.dawaa_conversation_review_points_payable_v1(new);
  v_retired boolean := coalesce(new.is_current, true) is false or new.superseded_at is not null
    or lower(coalesce(new.impact_status, '')) in ('reversed','rejected','cancelled');
begin
  if v_was = v_is and not v_retired then return new; end if;
  if not v_is then
    update public.employee_transactions t
       set status = case when v_retired then 'cancelled' else 'pending' end, updated_at = now()
     where t.source = 'conversation_evaluation'
       and t.source_id = new.id
       and lower(coalesce(t.status, '')) in (case when v_retired then 'pending' else 'active' end, 'active', 'approved');
  elsif not v_was then
    update public.employee_transactions t
       set status = 'approved', updated_at = now()
     where t.source = 'conversation_evaluation'
       and t.source_id = new.id
       and lower(coalesce(t.status, '')) = 'pending';
  end if;
  return new;
end
$function$;
revoke all on function public.dawaa_sync_conversation_review_points_v1() from public, anon, authenticated;

drop trigger if exists dawaa_sync_conversation_review_points_v1 on public.conversation_sales_reviews;
create trigger dawaa_sync_conversation_review_points_v1
  after update of impact_status, is_current, superseded_at, manager_reviewed_at, manager_reviewed_by,
    evaluation_kind, automatic_evaluation_version
  on public.conversation_sales_reviews
  for each row execute function public.dawaa_sync_conversation_review_points_v1();
