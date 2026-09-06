-- Fix conversation review saves blocked by RLS when the UI sends a null/stale reviewer_id.
-- Reviewer identity is now always bound server-side to the authenticated app account
-- before the table INSERT policy is evaluated.

create or replace function public.bind_conversation_review_reviewer_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_name text;
  v_role text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'identified_reviewer_required';
  end if;

  select sa.name, sa.role
    into v_name, v_role
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if v_name is null then
    raise exception 'active_reviewer_account_required';
  end if;

  new.reviewer_id := v_actor_id;
  new.reviewer_name := v_name;
  new.reviewer_role := v_role;
  return new;
end;
$$;

revoke all on function public.bind_conversation_review_reviewer_v1() from public, anon, authenticated;

drop trigger if exists bind_conversation_review_reviewer_v1 on public.conversation_sales_reviews;
create trigger bind_conversation_review_reviewer_v1
before insert on public.conversation_sales_reviews
for each row execute function public.bind_conversation_review_reviewer_v1();

-- The existing canonical INSERT RLS policy remains unchanged.
-- It continues to require add_reviews/reviews.action.create and reviewer ownership,
-- but ownership is now guaranteed by the database instead of trusting a client value.
