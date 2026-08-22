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
as $$
with bounds as (
  select least(coalesce(p_start,current_date),current_date) start_date,
    least(coalesce(p_end,current_date),current_date) end_date,
    nullif(public.normalize_cs_identity_name(p_responsible),'') responsible_key,
    nullif(trim(coalesce(p_status,'')),'') status_key
), date_window as (
  select b.*,
    (b.start_date::timestamp at time zone 'Africa/Cairo') start_ts,
    ((b.end_date + 1)::timestamp at time zone 'Africa/Cairo') end_ts
  from bounds b
), raw_period as materialized (
  select df.*
  from public.daily_followups df cross join date_window b
  where coalesce(df.is_hidden,false)=false
    and coalesce(df.is_duplicate,false)=false
    and df.duplicate_of is null
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or df.branch=p_branch)
    and (
      (df.followup_datetime is not null and df.followup_datetime >= b.start_ts and df.followup_datetime < b.end_ts)
      or (df.followup_datetime is null and coalesce(df.followup_date,'') ~ '^\d{4}-\d{2}-\d{2}' and substring(df.followup_date from 1 for 10) >= b.start_date::text and substring(df.followup_date from 1 for 10) <= b.end_date::text)
      or (df.followup_datetime is null and coalesce(df.followup_date,'') !~ '^\d{4}-\d{2}-\d{2}' and coalesce(df.date,'') ~ '^\d{4}-\d{2}-\d{2}' and substring(df.date from 1 for 10) >= b.start_date::text and substring(df.date from 1 for 10) <= b.end_date::text)
      or (df.followup_datetime is null and coalesce(df.followup_date,'') !~ '^\d{4}-\d{2}-\d{2}' and coalesce(df.date,'') !~ '^\d{4}-\d{2}-\d{2}' and df.created_at >= b.start_ts and df.created_at < b.end_ts)
    )
), prepared as materialized (
  select rp.*,
    public.normalize_cs_identity_name(coalesce(nullif(trim(rp.responsible_name),''),nullif(trim(rp.assigned_to),''),nullif(trim(rp.assigned_doctor),''),'غير محدد')) responsible_key,
    coalesce(nullif(trim(rp.responsible_name),''),nullif(trim(rp.assigned_to),''),nullif(trim(rp.assigned_doctor),''),'غير محدد') responsible_display,
    coalesce((rp.followup_datetime at time zone 'Africa/Cairo')::date,case when coalesce(rp.followup_date,'') ~ '^\d{4}-\d{2}-\d{2}' then substring(rp.followup_date from 1 for 10)::date end,case when coalesce(rp.date,'') ~ '^\d{4}-\d{2}-\d{2}' then substring(rp.date from 1 for 10)::date end,(rp.created_at at time zone 'Africa/Cairo')::date) scheduled_date,
    case when rp.completed_at is not null or lower(coalesce(rp.status,'')) in ('completed','done','closed') or lower(coalesce(rp.followup_status,'')) in ('completed','done','closed') or coalesce(rp.status,'') in ('تم','مكتمل','تم التواصل','تم الشراء بعد المتابعة') or coalesce(rp.followup_status,'') in ('تم','مكتمل','تم التواصل','تم الشراء بعد المتابعة') then true else false end is_done,
    case when rp.postponed_until is not null or lower(coalesce(rp.status,''))='postponed' or lower(coalesce(rp.followup_status,''))='postponed' or lower(coalesce(rp.contact_status,''))='postponed' or coalesce(rp.status,'')='مؤجل' or coalesce(rp.followup_status,'')='مؤجل' or coalesce(rp.contact_status,'')='مؤجل' then true else false end is_postponed,
    case when lower(coalesce(rp.status,'')) in ('no_answer','no answer') or lower(coalesce(rp.followup_status,'')) in ('no_answer','no answer') or lower(coalesce(rp.contact_status,'')) in ('no_answer','no answer') or coalesce(rp.status,'')='لم يرد' or coalesce(rp.followup_status,'')='لم يرد' or coalesce(rp.contact_status,'')='لم يرد' then true else false end is_no_answer,
    case when coalesce(rp.needs_manager,false)=true or coalesce(rp.status,'')='يحتاج مدير' or coalesce(rp.followup_status,'')='يحتاج مدير' then true else false end needs_manager_truth
  from raw_period rp
), period_rows as materialized (
  select p.* from prepared p cross join date_window b
  where (b.responsible_key is null or p.responsible_key=b.responsible_key)
    and (b.status_key is null or b.status_key in ('الكل','all') or (b.status_key='متأخرة' and not p.is_done and not p.is_postponed and p.scheduled_date<current_date) or (b.status_key='يحتاج مدير' and p.needs_manager_truth) or (b.status_key='مكتمل' and p.is_done) or lower(coalesce(p.status,''))=lower(b.status_key) or lower(coalesce(p.followup_status,''))=lower(b.status_key) or lower(coalesce(p.contact_status,''))=lower(b.status_key))
), summary as (
  select count(*) filter(where scheduled_date=current_date)::bigint total_today,count(*)::bigint period_total,count(*) filter(where is_done)::bigint completed,count(*) filter(where is_no_answer)::bigint no_answer,count(*) filter(where is_postponed)::bigint postponed,count(*) filter(where not is_done and not is_postponed and scheduled_date<current_date)::bigint overdue,count(*) filter(where needs_manager_truth)::bigint needs_manager,count(*) filter(where purchase_after_followup)::bigint purchase_after_count,round(coalesce(sum(coalesce(purchase_amount,0)) filter(where purchase_after_followup),0),2) purchase_after_amount,count(distinct coalesce(nullif(trim(customer_code),''),nullif(trim(customer_phone),''),nullif(trim(customer_name),'')))::bigint unique_customers from period_rows
), team as (
  select responsible_key,max(responsible_display) responsible,max(branch) branch,count(*)::bigint assigned,count(*) filter(where is_done)::bigint completed,count(*) filter(where not is_done and not is_postponed and scheduled_date<current_date)::bigint overdue,count(*) filter(where is_no_answer)::bigint no_answer,count(*) filter(where is_postponed)::bigint postponed,count(*) filter(where needs_manager_truth)::bigint needs_manager,count(*) filter(where purchase_after_followup)::bigint purchase_after_count,round(coalesce(sum(coalesce(purchase_amount,0)) filter(where purchase_after_followup),0),2) purchase_after_amount,round(avg(quality_rating) filter(where quality_rating is not null),1) avg_quality_rating,case when count(*)>0 then round(100.0*count(*) filter(where is_done)/count(*),1) else 0 end completion_rate from period_rows group by responsible_key order by completion_rate desc,assigned desc,responsible
)
select jsonb_build_object('start_date',b.start_date,'end_date',b.end_date,'summary',coalesce((select to_jsonb(s) from summary s),'{}'::jsonb),'team',coalesce((select jsonb_agg(to_jsonb(t)) from team t),'[]'::jsonb)) from date_window b;
$$;

revoke all on function public.get_cs_manager_followup_summary_v1(text,date,date,text,text) from public;
grant execute on function public.get_cs_manager_followup_summary_v1(text,date,date,text,text) to authenticated;
