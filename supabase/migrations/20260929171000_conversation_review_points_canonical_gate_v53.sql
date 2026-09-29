-- V53: Canonical Review Points Gate (final STEP 3C hardening).
--
-- conversation_sales_reviews_official_v1 (V52) owns whether a review may affect
-- staff scoring/incentives. The ledger must not be able to bypass that owner.
--
-- This migration:
--   1) blocks live employee_transactions rows tied to a non-official review;
--   2) therefore blocks later approval/activation of a historical review's pending points;
--   3) retires any currently-live non-official review point row without deleting it.
--
-- History is preserved. The review row and transaction row stay stored.

create or replace function public.dawaa_guard_conversation_review_points_v53()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if coalesce(new.source,'') in (
       'whatsapp_automatic_review',
       'conversation_evaluation',
       'conversation_review',
       'conversation_sales_reviews'
     )
     and new.source_id is not null
     and coalesce(new.status,'active') in ('active','approved','pending')
  then
    if not exists (
      select 1
      from public.conversation_sales_reviews_official_v1 r
      where r.id = new.source_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'conversation_review_points_require_official_review';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.dawaa_guard_conversation_review_points_v53() from public, anon, authenticated;

drop trigger if exists trg_conversation_review_points_official_v53
  on public.employee_transactions;

create trigger trg_conversation_review_points_official_v53
before insert or update of source, source_id, status
on public.employee_transactions
for each row
execute function public.dawaa_guard_conversation_review_points_v53();

-- Retire any currently-live point effect whose review is no longer official.
-- On the live dataset at creation time this is one pending automatic-review row (+3);
-- it has never counted in active/approved incentive totals.
update public.employee_transactions et
set status = 'cancelled',
    approved_by = null,
    approved_at = null,
    metadata = case
      when coalesce(et.source,'') = 'conversation_evaluation' then et.metadata
      else coalesce(et.metadata,'{}'::jsonb) || jsonb_build_object(
        'canonicalReviewGateV53',
        jsonb_build_object(
          'previousStatus', et.status,
          'reason', 'linked_review_is_not_official',
          'retiredAt', clock_timestamp(),
          'ownerView', 'conversation_sales_reviews_official_v1'
        )
      )
    end,
    updated_at = now()
where coalesce(et.source,'') in (
        'whatsapp_automatic_review',
        'conversation_evaluation',
        'conversation_review',
        'conversation_sales_reviews'
      )
  and et.source_id is not null
  and et.status in ('active','approved','pending')
  and not exists (
    select 1
    from public.conversation_sales_reviews_official_v1 r
    where r.id = et.source_id
  );

comment on function public.dawaa_guard_conversation_review_points_v53() is
  'Fail-closed boundary: only reviews admitted by conversation_sales_reviews_official_v1 may keep a live points effect.';
