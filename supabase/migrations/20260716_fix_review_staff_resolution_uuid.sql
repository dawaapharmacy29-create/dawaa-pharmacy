-- Correct UUID aggregation for legacy conversation review ownership and rerun backfill.

begin;

create or replace function public.resolve_review_staff_id(p_review jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.normalize_staff_display_name(
    coalesce(
      p_review->>'staff_name',
      p_review->>'doctor_name',
      p_review->>'employee_name',
      p_review->>'reviewed_staff_name'
    )
  );
  v_branch text := public.normalize_staff_display_name(coalesce(p_review->>'branch', p_review->>'branch_name'));
  v_staff_ids uuid[];
begin
  if v_name = '' or to_regclass('public.staff_accounts') is null then
    return null;
  end if;

  select array_agg(nullif(coalesce(to_jsonb(sa)->>'staff_id', to_jsonb(sa)->>'id'), '')::uuid)
    into v_staff_ids
  from public.staff_accounts sa
  where public.normalize_staff_display_name(
          coalesce(
            to_jsonb(sa)->>'employee_name',
            to_jsonb(sa)->>'staff_name',
            to_jsonb(sa)->>'full_name',
            to_jsonb(sa)->>'name',
            to_jsonb(sa)->>'username'
          )
        ) = v_name
    and coalesce(lower(to_jsonb(sa)->>'role'), '') in (
      'pharmacist','shift_supervisor','shift_supervisor_morning','shift_supervisor_evening'
    )
    and lower(coalesce(to_jsonb(sa)->>'active', 'true')) not in ('false','0','no','inactive')
    and lower(coalesce(to_jsonb(sa)->>'can_login', 'true')) not in ('false','0','no','inactive')
    and (
      v_branch = ''
      or public.normalize_staff_display_name(coalesce(to_jsonb(sa)->>'branch', to_jsonb(sa)->>'branch_name')) = v_branch
    );

  if coalesce(array_length(v_staff_ids, 1), 0) = 1 then
    return v_staff_ids[1];
  end if;
  return null;
exception when others then
  return null;
end;
$$;

update public.conversation_sales_reviews r
   set staff_id = public.resolve_review_staff_id(to_jsonb(r))
 where r.staff_id is null
   and public.resolve_review_staff_id(to_jsonb(r)) is not null;

insert into public.notifications (
  recipient_staff_id, notification_type, type, title, message, body,
  entity_type, entity_id, target_type, target_id,
  action_url, target_route, route, priority, metadata, dedupe_key,
  is_global, is_read, read, status, created_at
)
select
  r.staff_id,
  'conversation_review', 'conversation_review',
  'تقييم محادثة متاح على حسابك',
  'تم ربط تقييم محادثة سابق بحسابك. افتح تقييماتي لمراجعة التفاصيل.',
  'تم ربط تقييم محادثة سابق بحسابك. افتح تقييماتي لمراجعة التفاصيل.',
  'conversation_sales_review', r.id::text, 'conversation_sales_review', r.id::text,
  '/doctor-dashboard?tab=reviews&review=' || r.id::text,
  '/doctor-dashboard?tab=reviews&review=' || r.id::text,
  '/doctor-dashboard?tab=reviews&review=' || r.id::text,
  'normal',
  jsonb_build_object('route', '/doctor-dashboard?tab=reviews&review=' || r.id::text, 'backfill', true),
  'chat-review:' || r.id::text || ':backfill',
  false, false, false, 'new', coalesce(r.created_at, now())
from public.conversation_sales_reviews r
where r.staff_id is not null
on conflict (dedupe_key) where dedupe_key is not null do nothing;

commit;
