create or replace function public.get_cs_manager_followup_summary_v1(
  p_branch text default null,
  p_start date default (current_date - 29),
  p_end date default current_date,
  p_responsible text default null,
  p_status text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with bounds as (
  select least(coalesce(p_start,current_date),current_date) as start_date,
         least(coalesce(p_end,current_date),current_date) as end_date,
         nullif(public.normalize_cs_identity_name(p_responsible),'') as responsible_key,
         nullif(trim(coalesce(p_status,'')),'') as status_key
), prepared as materialized (
  select
    df.*,
    public.normalize_cs_identity_name(coalesce(nullif(trim(df.responsible_name),''),nullif(trim(df.assigned_to),''),nullif(trim(df.assigned_doctor),''),'غير محدد')) as responsible_key,
    coalesce(nullif(trim(df.responsible_name),''),nullif(trim(df.assigned_to),''),nullif(trim(df.assigned_doctor),''),'غير محدد') as responsible_display,
    coalesce(
      (df.followup_datetime at time zone 'Africa/Cairo')::date,
      case when coalesce(df.followup_date,'') ~ '^\d{4}-\d{2}-\d{2}' then substring(df.followup_date from 1 for 10)::date end,
      case when coalesce(df.date,'') ~ '^\d{4}-\d{2}-\d{2}' then substring(df.date from 1 for 10)::date end,
      (df.created_at at time zone 'Africa/Cairo')::date
    ) as scheduled_date,
    case when df.completed_at is not null or lower(coalesce(df.status,'')) in ('completed','done','closed') or lower(coalesce(df.followup_status,'')) in ('completed','done','closed') or coalesce(df.status,'') in ('تم','مكتمل','تم التواصل','تم الشراء بعد المتابعة') or coalesce(df.followup_status,'') in ('تم','مكتمل','تم التواصل','تم الشراء بعد المتابعة') then true else false end as is_done,
    case when df.postponed_until is not null or lower(coalesce(df.status,''))='postponed' or lower(coalesce(df.followup_status,''))='postponed' or coalesce(df.status,'')='مؤجل' or coalesce(df.followup_status,'')='مؤجل' then true else false end as is_postponed,
    case when lower(coalesce(df.status,'')) in ('no_answer','no answer') or lower(coalesce(df.followup_status,'')) in ('no_answer','no answer') or coalesce(df.status,'')='لم يرد' or coalesce(df.followup_status,'')='لم يرد' or coalesce(df.contact_status,'')='لم يرد' then true else false end as is_no_answer,
    case when coalesce(df.needs_manager,false)=true or coalesce(df.status,'')='يحتاج مدير' or coalesce(df.followup_status,'')='يحتاج مدير' then true else false end as needs_manager_truth
  from public.daily_followups df
  where coalesce(df.is_hidden,false)=false
    and coalesce(df.is_duplicate,false)=false
    and df.duplicate_of is null
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or df.branch=p_branch)
), period_rows as materialized (
  select p.*
  from prepared p cross join bounds b
  where p.scheduled_date between b.start_date and b.end_date
    and (b.responsible_key is null or p.responsible_key=b.responsible_key)
    and (
      b.status_key is null or b.status_key in ('الكل','all')
      or (b.status_key='متأخرة' and not p.is_done and not p.is_postponed and p.scheduled_date<current_date)
      or (b.status_key='يحتاج مدير' and p.needs_manager_truth)
      or (b.status_key='مكتمل' and p.is_done)
      or lower(coalesce(p.status,''))=lower(b.status_key)
      or lower(coalesce(p.followup_status,''))=lower(b.status_key)
      or lower(coalesce(p.contact_status,''))=lower(b.status_key)
    )
), summary as (
  select
    count(*) filter(where scheduled_date=current_date)::bigint as total_today,
    count(*)::bigint as period_total,
    count(*) filter(where is_done)::bigint as completed,
    count(*) filter(where is_no_answer)::bigint as no_answer,
    count(*) filter(where is_postponed)::bigint as postponed,
    count(*) filter(where not is_done and not is_postponed and scheduled_date<current_date)::bigint as overdue,
    count(*) filter(where needs_manager_truth)::bigint as needs_manager,
    count(*) filter(where purchase_after_followup)::bigint as purchase_after_count,
    round(coalesce(sum(coalesce(purchase_amount,0)) filter(where purchase_after_followup),0),2) as purchase_after_amount,
    count(distinct coalesce(nullif(trim(customer_code),''),nullif(trim(customer_phone),''),nullif(trim(customer_name),'')))::bigint as unique_customers
  from period_rows
), team as (
  select
    responsible_key,
    max(responsible_display) as responsible,
    max(branch) as branch,
    count(*)::bigint as assigned,
    count(*) filter(where is_done)::bigint as completed,
    count(*) filter(where not is_done and not is_postponed and scheduled_date<current_date)::bigint as overdue,
    count(*) filter(where is_no_answer)::bigint as no_answer,
    count(*) filter(where is_postponed)::bigint as postponed,
    count(*) filter(where needs_manager_truth)::bigint as needs_manager,
    count(*) filter(where purchase_after_followup)::bigint as purchase_after_count,
    round(coalesce(sum(coalesce(purchase_amount,0)) filter(where purchase_after_followup),0),2) as purchase_after_amount,
    round(avg(quality_rating) filter(where quality_rating is not null),1) as avg_quality_rating,
    case when count(*)>0 then round(100.0*count(*) filter(where is_done)/count(*),1) else 0 end as completion_rate
  from period_rows
  group by responsible_key
  order by completion_rate desc, assigned desc, responsible
)
select jsonb_build_object(
  'start_date',b.start_date,
  'end_date',b.end_date,
  'summary',coalesce((select to_jsonb(s) from summary s),'{}'::jsonb),
  'team',coalesce((select jsonb_agg(to_jsonb(t)) from team t),'[]'::jsonb)
)
from bounds b;
$function$;

grant execute on function public.get_cs_manager_followup_summary_v1(text,date,date,text,text) to anon, authenticated;
