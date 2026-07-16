-- Fix legacy doctor review ownership and make personal notifications visible in both
-- the doctor workspace and the global header notification bell.

begin;

create extension if not exists pgcrypto;

create or replace function public.normalize_staff_display_name(p_value text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        replace(replace(replace(replace(replace(lower(coalesce(p_value, '')), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ى', 'ي'), 'ة', 'ه'),
        '(^|[[:space:]])(دكتور|دكتوره|د|dr)([[:space:]/._-]|$)', ' ', 'gi'
      ),
      '[[:space:]/._-]+', ' ', 'g'
    )
  );
$$;

alter table if exists public.conversation_sales_reviews
  add column if not exists staff_id uuid;

alter table if exists public.notifications
  add column if not exists recipient_staff_id uuid,
  add column if not exists notification_type text,
  add column if not exists type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists message text,
  add column if not exists body text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists target_type text,
  add column if not exists target_id text,
  add column if not exists action_url text,
  add column if not exists target_route text,
  add column if not exists route text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text,
  add column if not exists is_global boolean not null default false,
  add column if not exists is_read boolean not null default false,
  add column if not exists read boolean not null default false,
  add column if not exists status text not null default 'new',
  add column if not exists read_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_recipient_staff_created_idx
  on public.notifications (recipient_staff_id, created_at desc);

-- Resolve exactly one active staff account for a legacy review name.
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
  v_staff_id uuid;
  v_count integer;
begin
  if v_name = '' or to_regclass('public.staff_accounts') is null then
    return null;
  end if;

  select count(*), min(nullif(coalesce(to_jsonb(sa)->>'staff_id', to_jsonb(sa)->>'id'), '')::uuid)
    into v_count, v_staff_id
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
    and coalesce((to_jsonb(sa)->>'active')::boolean, true) = true
    and coalesce((to_jsonb(sa)->>'can_login')::boolean, true) = true
    and (
      v_branch = ''
      or public.normalize_staff_display_name(coalesce(to_jsonb(sa)->>'branch', to_jsonb(sa)->>'branch_name')) = v_branch
    );

  if v_count = 1 then
    return v_staff_id;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.attach_review_staff_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_id is null then
    new.staff_id := public.resolve_review_staff_id(to_jsonb(new));
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.conversation_sales_reviews') is not null then
    execute 'drop trigger if exists trg_attach_review_staff_id on public.conversation_sales_reviews';
    execute 'create trigger trg_attach_review_staff_id before insert or update on public.conversation_sales_reviews for each row execute function public.attach_review_staff_id()';
  end if;
end $$;

-- Backfill old reviews only where the name and branch identify one active account.
do $$
begin
  if to_regclass('public.conversation_sales_reviews') is not null then
    update public.conversation_sales_reviews r
       set staff_id = public.resolve_review_staff_id(to_jsonb(r))
     where r.staff_id is null
       and public.resolve_review_staff_id(to_jsonb(r)) is not null;
  end if;
end $$;

-- One writer that fills both the modern personal-workspace fields and the
-- legacy header-bell aliases.
create or replace function public.create_staff_notification(
  p_recipient_staff_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_created_by_staff_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_type text := coalesce(nullif(trim(p_notification_type), ''), 'system');
  v_route text := nullif(trim(p_action_url), '');
begin
  if p_recipient_staff_id is null then
    raise exception 'recipient_staff_id is required';
  end if;

  insert into public.notifications (
    recipient_staff_id, notification_type, type, title, message, body,
    entity_type, entity_id, target_type, target_id,
    action_url, target_route, route, priority, metadata, dedupe_key,
    is_global, is_read, read, status, created_at
  ) values (
    p_recipient_staff_id, v_type, v_type,
    coalesce(nullif(trim(p_title), ''), 'إشعار جديد'), coalesce(p_message, ''), coalesce(p_message, ''),
    nullif(trim(p_entity_type), ''), nullif(trim(p_entity_id), ''),
    nullif(trim(p_entity_type), ''), nullif(trim(p_entity_id), ''),
    v_route, v_route, v_route,
    case when p_priority in ('low','normal','high','urgent','critical') then p_priority else 'normal' end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('route', v_route, 'createdByStaffId', p_created_by_staff_id),
    nullif(trim(p_dedupe_key), ''), false, false, false, 'new', now()
  )
  on conflict (dedupe_key) where dedupe_key is not null
  do update set
    notification_type = excluded.notification_type,
    type = excluded.type,
    title = excluded.title,
    message = excluded.message,
    body = excluded.body,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    action_url = excluded.action_url,
    target_route = excluded.target_route,
    route = excluded.route,
    priority = excluded.priority,
    metadata = excluded.metadata,
    is_read = false,
    read = false,
    status = 'new',
    read_at = null,
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Refresh the review notification trigger so it uses the resolved staff_id.
create or replace function public.notify_doctor_on_conversation_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_staff_id uuid := new.staff_id;
  v_score numeric := 0;
  v_impact numeric := 0;
  v_reviewer text;
  v_action text := lower(tg_op);
begin
  if v_staff_id is null then
    v_staff_id := public.resolve_review_staff_id(v_row);
  end if;
  if v_staff_id is null then
    return new;
  end if;

  begin
    v_score := coalesce(nullif(v_row->>'final_score','')::numeric, nullif(v_row->>'total_score','')::numeric, nullif(v_row->>'score','')::numeric, 0);
  exception when others then v_score := 0;
  end;
  begin
    v_impact := coalesce(nullif(v_row->>'doctor_points_impact','')::numeric, nullif(v_row->>'point_impact','')::numeric, 0);
  exception when others then v_impact := 0;
  end;
  v_reviewer := coalesce(nullif(v_row->>'reviewer_name',''), 'مراجع خدمة العملاء');

  perform public.create_staff_notification(
    v_staff_id,
    'conversation_review',
    case when tg_op = 'INSERT' then 'تم تسجيل تقييم محادثة جديد' else 'تم تعديل تقييم محادثتك' end,
    format('الدرجة %s من 100، وتأثير النقاط %s. التقييم بواسطة %s.', v_score, v_impact, v_reviewer),
    'conversation_sales_review',
    new.id::text,
    '/doctor-dashboard?tab=reviews&review=' || new.id::text,
    case when v_score < 70 then 'high' else 'normal' end,
    jsonb_build_object('score', v_score, 'pointsImpact', v_impact, 'reviewer', v_reviewer, 'action', v_action),
    format('chat-review:%s:%s', new.id, v_action),
    null
  );
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.conversation_sales_reviews') is not null then
    execute 'drop trigger if exists trg_notify_doctor_on_conversation_review on public.conversation_sales_reviews';
    execute 'create trigger trg_notify_doctor_on_conversation_review after insert or update on public.conversation_sales_reviews for each row execute function public.notify_doctor_on_conversation_review()';
  end if;
end $$;

-- Create one current notification for each already-existing linked review.
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

-- Backfill aliases for personal notifications created by the previous migration.
update public.notifications
set
  type = coalesce(nullif(type, ''), nullif(notification_type, ''), 'system'),
  body = coalesce(nullif(body, ''), message, ''),
  target_type = coalesce(target_type, entity_type),
  target_id = coalesce(target_id, entity_id),
  target_route = coalesce(target_route, action_url, route),
  route = coalesce(route, action_url, target_route),
  read = coalesce(read, is_read, false),
  status = case when coalesce(is_read, read, false) then 'read' else coalesce(nullif(status, ''), 'new') end
where recipient_staff_id is not null;

commit;
