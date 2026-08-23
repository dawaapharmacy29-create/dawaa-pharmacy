-- Fix notification audience leakage for the custom staff-account auth model.
-- Direct recipients are authoritative; branch is an additional scope constraint,
-- never an alternative that can expose another employee's notification.

create or replace function public.dawaa_current_notification_account_id_v1()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select coalesce(
    nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', '')), ''),
    nullif(auth.uid()::text, '')
  )
$$;

create or replace function public.dawaa_current_notification_role_v1()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select lower(trim(coalesce(sa.role, '')))
  from public.staff_accounts sa
  where sa.id::text = public.dawaa_current_notification_account_id_v1()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1
$$;

create or replace function public.dawaa_current_notification_branch_v1()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select lower(trim(coalesce(sa.branch, '')))
  from public.staff_accounts sa
  where sa.id::text = public.dawaa_current_notification_account_id_v1()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1
$$;

create or replace function public.dawaa_notification_visible_to_current_user_v2(
  p_recipient_user_id text,
  p_user_id text,
  p_recipient_staff_id text,
  p_legacy_staff_id text,
  p_recipient_role text,
  p_branch text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  with ctx as (
    select
      public.dawaa_current_notification_account_id_v1() as account_id,
      nullif(trim(coalesce(public.dawaa_current_staff_id_v1(), '')), '') as staff_id,
      nullif(trim(coalesce(public.dawaa_current_notification_role_v1(), '')), '') as role,
      nullif(trim(coalesce(public.dawaa_current_notification_branch_v1(), '')), '') as branch
  ), target as (
    select
      nullif(trim(coalesce(p_recipient_user_id, '')), '') as recipient_user_id,
      nullif(trim(coalesce(p_user_id, '')), '') as user_id,
      nullif(trim(coalesce(p_recipient_staff_id, p_legacy_staff_id, '')), '') as staff_id,
      nullif(lower(trim(coalesce(p_recipient_role, ''))), '') as role,
      nullif(lower(trim(coalesce(p_branch, ''))), '') as branch
  )
  select
    case
      when ctx.account_id is null then false
      when ctx.role in ('general_manager', 'executive_manager', 'branches_manager') then true
      when target.recipient_user_id is null
        and target.user_id is null
        and target.staff_id is null
        and target.role is null
        and target.branch is null then false
      else
        (target.recipient_user_id is null or target.recipient_user_id = ctx.account_id)
        and (target.user_id is null or target.user_id = ctx.account_id)
        and (target.staff_id is null or target.staff_id = ctx.staff_id)
        and (target.role is null or target.role = ctx.role)
        and (target.branch is null or target.branch = ctx.branch)
    end
  from ctx cross join target
$$;

-- Backfill the old recipient column used by legacy writers.
update public.notifications
set recipient_staff_id = staff_id
where nullif(trim(coalesce(recipient_staff_id, '')), '') is null
  and nullif(trim(coalesce(staff_id, '')), '') is not null;

-- Repair existing weekly manager reminders with an explicit audience and action.
update public.notifications
set
  recipient_role = coalesce(nullif(trim(recipient_role), ''), 'branches_manager'),
  target_type = coalesce(nullif(trim(target_type), ''), 'manager_weekly_evaluation'),
  target_route = coalesce(nullif(trim(target_route), ''), '/weekly-evaluation/branch_manager'),
  route = coalesce(nullif(trim(route), ''), '/weekly-evaluation/branch_manager')
where title = 'تقييمك الأسبوعي متأخر'
  and type = 'reminder';

-- Replace permissive app policies with recipient-scoped policies.
drop policy if exists notifications_select_app on public.notifications;
drop policy if exists notifications_update_app on public.notifications;
drop policy if exists notifications_select_visible on public.notifications;
drop policy if exists notifications_update_own_read_state on public.notifications;

drop policy if exists notifications_select_visible_v2 on public.notifications;
drop policy if exists notifications_update_visible_v2 on public.notifications;

create policy notifications_select_visible_v2
on public.notifications
for select
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    branch
  )
);

create policy notifications_update_visible_v2
on public.notifications
for update
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    branch
  )
)
with check (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    branch
  )
);

-- Fix the scheduled weekly manager reminder writer.
create or replace function public.notify_missing_weekly_manager_evaluations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_eval date;
  v_count integer := 0;
  v_evaluator record;
begin
  for v_evaluator in
    select id, name
    from public.staff
    where role in ('مديرة الفروع', 'مدير الفروع', 'branches_manager')
      and coalesce(is_active, true) = true
  loop
    select max(coalesce(week_end, week_start))
    into v_last_eval
    from public.manager_weekly_evaluations
    where evaluator_staff_id = v_evaluator.id
      and status = 'submitted';

    if v_last_eval is null or v_last_eval < current_date - interval '7 days' then
      if not exists (
        select 1
        from public.notifications n
        where coalesce(nullif(trim(n.recipient_staff_id), ''), nullif(trim(n.staff_id), '')) = v_evaluator.id::text
          and n.type = 'reminder'
          and n.title = 'تقييمك الأسبوعي متأخر'
          and n.created_at >= date_trunc('week', now())
      ) then
        insert into public.notifications (
          staff_id,
          recipient_staff_id,
          recipient_role,
          title,
          body,
          type,
          target_type,
          target_route,
          route,
          created_at
        )
        values (
          v_evaluator.id::text,
          v_evaluator.id::text,
          'branches_manager',
          'تقييمك الأسبوعي متأخر',
          'لسه ما قيّمتيش مديري الفروع الأسبوع ده — من غيره حافزهم الشهري مش هيتصرف. آخر تقييم كان يوم '
            || coalesce(v_last_eval::text, 'مفيش تقييم اتسجل خالص'),
          'reminder',
          'manager_weekly_evaluation',
          '/weekly-evaluation/branch_manager',
          '/weekly-evaluation/branch_manager',
          now()
        );
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;
