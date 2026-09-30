-- Final WhatsApp / Sales Intelligence hardening before main merge.
-- 1) Automatic conversation reviews are system-authored and must never inherit a human reviewer.
-- 2) Human reviews remain bound to the authenticated active reviewer.
-- 3) Doctor official WhatsApp sales count only resolved, active staff identities.

create or replace function public.bind_conversation_review_reviewer_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_id uuid;
  v_name text;
  v_role text;
begin
  if lower(trim(coalesce(new.evaluation_kind, ''))) = 'automatic' then
    new.reviewer_id := null;
    new.reviewer_name := null;
    new.reviewer_role := null;
    return new;
  end if;

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
$function$;

drop policy if exists conversation_sales_reviews_insert_canonical
  on public.conversation_sales_reviews;

create policy conversation_sales_reviews_insert_canonical
on public.conversation_sales_reviews
for insert
to public
with check (
  public.dawaa_current_actor_can(array['add_reviews'::text, 'reviews.action.create'::text])
  and (
    (
      lower(trim(coalesce(evaluation_kind, ''))) = 'automatic'
      and reviewer_id is null
      and reviewer_name is null
      and reviewer_role is null
      and whatsapp_review_source_id is not null
      and submission_fingerprint like 'auto:%'
    )
    or reviewer_id = public.dawaa_current_staff_account_id_strict()
    or exists (
      select 1
      from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(sa.active, false)
        and coalesce(sa.can_login, false)
        and reviewer_id::text = sa.staff_id
    )
    or public.dawaa_actor_is_top_management_v1()
  )
);

drop policy if exists conversation_sales_reviews_update_canonical
  on public.conversation_sales_reviews;

create policy conversation_sales_reviews_update_canonical
on public.conversation_sales_reviews
for update
to public
using (
  public.dawaa_current_actor_can(array['edit_reviews'::text, 'approve_reviews'::text])
)
with check (
  public.dawaa_current_actor_can(array['edit_reviews'::text, 'approve_reviews'::text])
  and (
    (
      lower(trim(coalesce(evaluation_kind, ''))) = 'automatic'
      and reviewer_id is null
      and reviewer_name is null
      and reviewer_role is null
      and whatsapp_review_source_id is not null
    )
    or reviewer_id = public.dawaa_current_staff_account_id_strict()
    or exists (
      select 1
      from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(sa.active, false)
        and coalesce(sa.can_login, false)
        and reviewer_id::text = sa.staff_id
    )
    or public.dawaa_actor_is_top_management_v1()
  )
);

-- Repair legacy automatic rows that inherited the logged-in manager through the old trigger.
update public.conversation_sales_reviews
set reviewer_id = null,
    reviewer_name = null,
    reviewer_role = null
where lower(trim(coalesce(evaluation_kind, ''))) = 'automatic'
  and (reviewer_id is not null or reviewer_name is not null or reviewer_role is not null);

create or replace function public.get_my_official_whatsapp_sales_v1(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id text;
  v_result jsonb;
begin
  v_staff_id := public.dawaa_current_staff_id_v1();

  if nullif(trim(v_staff_id), '') is null then
    raise exception 'staff_identity_required';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'invalid_date_range';
  end if;

  select jsonb_build_object(
    'sales_count', count(*)::integer,
    'revenue', coalesce(sum(coalesce(t.invoice_amount, 0)), 0),
    'item_evidence_count', count(*) filter (where t.item_evidence_available)::integer,
    'staff_id', v_staff_id
  )
  into v_result
  from public.sales_intelligence_invoice_staff_truth_v1 t
  where t.canonical_staff_id::text = v_staff_id
    and t.is_staff_resolved = true
    and t.canonical_staff_is_active = true
    and (t.invoice_datetime at time zone 'Africa/Cairo')::date between p_start and p_end;

  return coalesce(
    v_result,
    jsonb_build_object(
      'sales_count', 0,
      'revenue', 0,
      'item_evidence_count', 0,
      'staff_id', v_staff_id
    )
  );
end;
$$;

revoke all on function public.get_my_official_whatsapp_sales_v1(date, date) from public;
grant execute on function public.get_my_official_whatsapp_sales_v1(date, date) to anon, authenticated;

comment on function public.get_my_official_whatsapp_sales_v1(date, date) is
'Returns current Dawaa staff official WhatsApp-attributed sales only when invoice staff identity resolves to the same active staff member. Product/item evidence is reported separately and is not required for header-level sale credit.';
