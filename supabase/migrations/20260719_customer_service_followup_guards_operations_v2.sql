begin;

create or replace function public.dawaa_guard_daily_followup_state_v2()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text := lower(trim(coalesce(new.followup_status, new.status, '')));
  v_result text := nullif(trim(coalesce(new.followup_result, new.contact_result, '')), '');
  v_summary text := nullif(trim(coalesce(new.evaluation_summary, new.followup_summary, new.followup_notes, '')), '');
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_completed boolean := v_status in ('تم','مكتمل','completed','done');
  v_cancelled boolean := v_status in ('ملغي','ملغى','cancelled','canceled') or new.cancelled_at is not null;
  v_postponed boolean := v_status in ('مؤجل','postponed') or new.postponed_until is not null;
begin
  new.updated_at := now();

  if coalesce(new.is_hidden, false) then
    if nullif(trim(coalesce(new.hidden_reason, new.archive_reason, '')), '') is null then
      raise exception 'سبب الأرشفة مطلوب قبل إخفاء المتابعة';
    end if;
    new.hidden_at := coalesce(new.hidden_at, new.archived_at, now());
    new.archived_at := coalesce(new.archived_at, new.hidden_at);
    new.hidden_reason := coalesce(nullif(trim(new.hidden_reason), ''), nullif(trim(new.archive_reason), ''));
    new.archive_reason := coalesce(nullif(trim(new.archive_reason), ''), nullif(trim(new.hidden_reason), ''));
  end if;

  if v_cancelled then
    if nullif(trim(coalesce(new.cancelled_reason, new.followup_notes, '')), '') is null then
      raise exception 'سبب إلغاء المتابعة مطلوب';
    end if;
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_reason := coalesce(nullif(trim(new.cancelled_reason), ''), nullif(trim(new.followup_notes), ''));
    new.status := 'ملغي';
    new.followup_status := 'ملغي';
  end if;

  if v_postponed and not v_cancelled and not v_completed then
    if new.postponed_until is null and new.next_followup_date is null then
      raise exception 'حدد موعد التأجيل أو تاريخ المتابعة القادمة';
    end if;
    if new.postponed_until is not null and new.postponed_until <= now() then
      raise exception 'موعد التأجيل يجب أن يكون في المستقبل';
    end if;
    if new.next_followup_date is not null and new.next_followup_date < v_today then
      raise exception 'تاريخ المتابعة القادمة لا يمكن أن يكون في الماضي';
    end if;
    if new.postponed_until is not null then
      new.next_followup_date := (new.postponed_until at time zone 'Africa/Cairo')::date;
    end if;
    new.needs_next_followup := true;
    new.completed_at := null;
    new.status := 'مؤجل';
    new.followup_status := 'مؤجل';
  end if;

  if v_completed and not v_cancelled then
    if v_result is null then
      raise exception 'نتيجة المتابعة مطلوبة قبل الإغلاق';
    end if;
    if v_summary is null or length(v_summary) < 10 then
      raise exception 'اكتب ملخصًا واضحًا للمتابعة لا يقل عن 10 أحرف قبل الإغلاق';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
    new.evaluation_summary := coalesce(nullif(trim(new.evaluation_summary), ''), v_summary);
    new.followup_summary := coalesce(nullif(trim(new.followup_summary), ''), v_summary);
    new.status := 'تم';
    new.followup_status := 'تم';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_daily_followups_state_guard_v2 on public.daily_followups;
create trigger trg_daily_followups_state_guard_v2
before insert or update of status, followup_status, followup_result, contact_result,
  evaluation_summary, followup_summary, followup_notes, postponed_until,
  next_followup_date, is_hidden, hidden_reason, archive_reason,
  cancelled_at, cancelled_reason, completed_at
on public.daily_followups
for each row execute function public.dawaa_guard_daily_followup_state_v2();

create index if not exists daily_followups_open_due_v2_idx
on public.daily_followups (next_followup_date, priority, created_at)
where coalesce(is_hidden,false)=false and completed_at is null and cancelled_at is null;

create index if not exists daily_followups_manager_queue_v2_idx
on public.daily_followups (branch, created_at desc)
where coalesce(needs_manager,false)=true and coalesce(is_hidden,false)=false and completed_at is null;

drop view if exists public.customer_followup_operations_v2;
create view public.customer_followup_operations_v2
with (security_invoker=true)
as
select
  f.*,
  coalesce(nullif(trim(f.customer_name),''), nullif(trim(f.name),''), 'عميل بدون اسم') as display_customer_name,
  coalesce(nullif(trim(f.customer_phone),''), nullif(trim(f.phone),'')) as display_phone,
  case
    when coalesce(f.is_hidden,false) or f.archived_at is not null then 'archived'
    when f.cancelled_at is not null or lower(trim(coalesce(f.followup_status,f.status,''))) in ('ملغي','ملغى','cancelled','canceled') then 'cancelled'
    when f.completed_at is not null or lower(trim(coalesce(f.followup_status,f.status,''))) in ('تم','مكتمل','completed','done') then 'completed'
    when coalesce(f.needs_manager,false) then 'needs_manager'
    when f.postponed_until is not null or lower(trim(coalesce(f.followup_status,f.status,''))) in ('مؤجل','postponed') then 'postponed'
    else 'open'
  end as operational_status,
  case
    when f.next_followup_date is null then 'unscheduled'
    when f.next_followup_date < (now() at time zone 'Africa/Cairo')::date then 'overdue'
    when f.next_followup_date = (now() at time zone 'Africa/Cairo')::date then 'today'
    when f.next_followup_date = (now() at time zone 'Africa/Cairo')::date + 1 then 'tomorrow'
    else 'upcoming'
  end as due_bucket,
  case
    when f.next_followup_date is null then null
    else f.next_followup_date - (now() at time zone 'Africa/Cairo')::date
  end as days_until_due,
  (select count(*) from public.customer_followup_events e where e.followup_id=f.id::text) as events_count,
  (select max(e.created_at) from public.customer_followup_events e where e.followup_id=f.id::text) as last_event_at
from public.daily_followups f;

revoke all on public.customer_followup_operations_v2 from anon;
grant select on public.customer_followup_operations_v2 to authenticated;

create or replace function public.dawaa_customer_service_stats_v2(p_branch text default null)
returns jsonb
language sql
stable
security invoker
set search_path=public,pg_catalog
as $$
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where operational_status='open'),
    'postponed', count(*) filter (where operational_status='postponed'),
    'needs_manager', count(*) filter (where operational_status='needs_manager'),
    'completed', count(*) filter (where operational_status='completed'),
    'cancelled', count(*) filter (where operational_status='cancelled'),
    'archived', count(*) filter (where operational_status='archived'),
    'overdue', count(*) filter (where due_bucket='overdue' and operational_status in ('open','postponed','needs_manager')),
    'due_today', count(*) filter (where due_bucket='today' and operational_status in ('open','postponed','needs_manager')),
    'without_schedule', count(*) filter (where due_bucket='unscheduled' and operational_status in ('open','postponed','needs_manager'))
  )
  from public.customer_followup_operations_v2
  where p_branch is null or trim(p_branch)='' or branch=p_branch;
$$;

revoke all on function public.dawaa_customer_service_stats_v2(text) from public,anon;
grant execute on function public.dawaa_customer_service_stats_v2(text) to authenticated;

commit;
