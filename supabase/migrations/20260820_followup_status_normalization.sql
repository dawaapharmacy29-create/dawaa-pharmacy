create or replace function public.customer_followup_daily_performance_v1(
  p_branch text default null,
  p_day date default (timezone('Africa/Cairo', now()))::date
)
returns table(
  responsible_name text,
  branch text,
  total_count bigint,
  completed_count bigint,
  open_count bigint,
  no_answer_count bigint,
  postponed_count bigint,
  manager_count bigint,
  invalid_phone_count bigint,
  avg_close_hours numeric
)
language sql
set search_path to 'public'
as $function$
  select
    coalesce(nullif(trim(d.responsible_name), ''), nullif(trim(d.assigned_to), ''), nullif(trim(d.created_by_name), ''), 'غير مسند') as responsible_name,
    coalesce(nullif(trim(d.branch), ''), 'غير محدد') as branch,
    count(*)::bigint as total_count,
    count(*) filter (
      where d.completed_at is not null
         or lower(trim(coalesce(d.status, ''))) in ('completed', 'closed', 'done', 'تم', 'مكتمل', 'تم الشراء بعد المتابعة')
         or lower(trim(coalesce(d.followup_status, ''))) in ('completed', 'closed', 'done', 'تم', 'مكتمل', 'تم الشراء بعد المتابعة')
    )::bigint as completed_count,
    count(*) filter (
      where d.completed_at is null
        and d.cancelled_at is null
        and d.archived_at is null
        and coalesce(d.is_hidden, false) = false
    )::bigint as open_count,
    count(*) filter (
      where lower(trim(coalesce(d.contact_status, ''))) in ('no_answer', 'no answer')
         or lower(trim(coalesce(d.response_status, ''))) in ('no_answer', 'no answer')
         or lower(trim(coalesce(d.followup_status, ''))) in ('no_answer', 'no answer')
         or coalesce(d.contact_status, '') = 'لم يرد'
         or coalesce(d.response_status, '') = 'لم يرد'
         or coalesce(d.followup_status, '') = 'لم يرد'
         or coalesce(d.followup_result, '') = 'لم يرد'
         or coalesce(d.contact_result, '') = 'لم يرد'
    )::bigint as no_answer_count,
    count(*) filter (
      where d.postponed_until is not null
         or lower(trim(coalesce(d.followup_status, d.status, ''))) in ('scheduled', 'postponed', 'مؤجل')
    )::bigint as postponed_count,
    count(*) filter (
      where coalesce(d.needs_manager, false)
         or lower(trim(coalesce(d.followup_status, d.status, ''))) in ('needs_manager', 'يحتاج متابعة مدير')
    )::bigint as manager_count,
    count(*) filter (
      where lower(trim(coalesce(d.contact_status, ''))) in ('invalid_phone', 'الرقم غير صحيح')
         or coalesce(d.followup_result, d.contact_result) = 'الرقم غير صحيح'
    )::bigint as invalid_phone_count,
    round(
      (avg(extract(epoch from (d.completed_at - d.created_at)) / 3600.0)
        filter (where d.completed_at is not null and d.created_at is not null))::numeric,
      2
    ) as avg_close_hours
  from public.daily_followups d
  where coalesce(nullif(d.date, ''), d.created_at::date::text)::date = p_day
    and (p_branch is null or trim(p_branch) = '' or p_branch = 'كل الفروع' or d.branch = p_branch)
  group by 1, 2
  order by completed_count desc, total_count desc;
$function$;
