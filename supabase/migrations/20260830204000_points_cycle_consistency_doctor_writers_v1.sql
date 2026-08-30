-- Align doctor point writers and daily metrics to the pharmacy 26→25 cycle.

create or replace function public.dawaa_last_closed_points_cycle_label_v1()
returns text
language sql
stable
set search_path to 'public','pg_catalog'
as $function$
  with d as (select (now() at time zone 'Africa/Cairo')::date as today)
  select case when extract(day from today)::int >= 26 then to_char(today,'YYYY-MM') else to_char((today - interval '1 month')::date,'YYYY-MM') end from d;
$function$;

create or replace function public.settle_doctor_self_logged_followup(p_followup_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row record; v_doctor record; v_month_cycle text; v_source_uuid uuid; v_event_date date;
begin
  select * into v_row from public.daily_followups where id=p_followup_id;
  if v_row.id is null or v_row.request_type<>'متابعة استثنائية' then return; end if;
  if v_row.requested_by_staff_id is null then return; end if;
  select id,name,branch into v_doctor from public.staff where id::text=v_row.requested_by_staff_id and role='صيدلاني' and coalesce(is_active,true)=true;
  if v_doctor.id is null then return; end if;
  begin v_source_uuid:=p_followup_id::uuid; exception when others then v_source_uuid:=null; end;
  if v_source_uuid is not null and exists(select 1 from public.employee_transactions where source='doctor_exceptional_followup' and source_id=v_source_uuid) then return; end if;
  v_event_date := (coalesce(v_row.created_at,now()) at time zone 'Africa/Cairo')::date;
  v_month_cycle := public.dawaa_points_cycle_label_for_date_v3(v_event_date);
  insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,source_id,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
  values(v_doctor.id,'reward',10,10,0,'تسجيل متابعة استثنائية','doctor_exceptional_followup',v_source_uuid,v_month_cycle,v_doctor.branch,'active',v_doctor.name,'system_automation','سجّل متابعة استثنائية بنفسه: '||coalesce(v_row.followup_reason,''),'خدمة العملاء',true);
end;
$function$;

create or replace function public.settle_doctor_self_logged_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row record; v_doctor record; v_month_cycle text; v_event_date date;
begin
  select * into v_row from public.customer_requests where id=p_request_id;
  if v_row.id is null or v_row.doctor_id is null then return; end if;
  if v_row.created_by is null or v_row.created_by<>v_row.doctor_id::text then return; end if;
  select id,name,branch into v_doctor from public.staff where id=v_row.doctor_id and role='صيدلاني' and coalesce(is_active,true)=true;
  if v_doctor.id is null then return; end if;
  if exists(select 1 from public.employee_transactions where source='doctor_customer_request' and source_id=p_request_id) then return; end if;
  v_event_date := (coalesce(v_row.created_at,now()) at time zone 'Africa/Cairo')::date;
  v_month_cycle := public.dawaa_points_cycle_label_for_date_v3(v_event_date);
  insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,source_id,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
  values(v_doctor.id,'reward',10,10,0,'تسجيل طلب عميل','doctor_customer_request',p_request_id,v_month_cycle,v_doctor.branch,'active',v_doctor.name,'system_automation','سجّل طلب عميل بنفسه: '||coalesce(v_row.medicine_name,'صنف غير محدد'),'خدمة العملاء',true);
end;
$function$;

create or replace function public.settle_doctor_invoice_quality_points()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_month_cycle text := public.dawaa_current_points_cycle_label_v1();
  v_cycle_start date := public.dawaa_points_cycle_start_for_label_v1(v_month_cycle);
  v_cycle_end date := public.dawaa_points_cycle_end_for_label_v1(v_month_cycle);
  v_count integer:=0; v_row record; v_points integer; v_existing_id uuid;
begin
  for v_row in
    with doctors as (
      select s.id doctor_id,s.name doctor_name,s.branch,public.dawaa_normalize_doctor_name(s.name) norm_name from public.staff s where s.role='صيدلاني' and coalesce(s.is_active,true)=true
    ), baseline_90d as (
      select branch,shift_name,avg(amount) baseline_value,avg(line_items_count) baseline_items from public.sales_invoices where invoice_date >= (v_today - interval '90 days') and amount>0 and shift_name is not null group by branch,shift_name
    ), doctor_shift_cycle as (
      select d.doctor_id,max(d.doctor_name) doctor_name,max(d.branch) branch,i.shift_name,count(*) n,avg(i.amount) doc_avg_value,avg(i.line_items_count) doc_avg_items
      from doctors d join public.sales_invoices i on public.dawaa_normalize_doctor_name(i.seller_name)=d.norm_name and i.invoice_date>=v_cycle_start::timestamp and i.invoice_date<(least(v_today,v_cycle_end)+1)::timestamp and i.amount>0 and i.shift_name is not null
      group by d.doctor_id,i.shift_name
    ), compared as (
      select ds.doctor_id,ds.doctor_name,ds.branch,ds.n,(ds.doc_avg_value-b.baseline_value)/nullif(b.baseline_value,0)*100 pct_value,(ds.doc_avg_items-b.baseline_items)/nullif(b.baseline_items,0)*100 pct_items from doctor_shift_cycle ds join baseline_90d b on b.branch=ds.branch and b.shift_name=ds.shift_name
    )
    select doctor_id,max(doctor_name) doctor_name,max(branch) branch,sum(n) total_n,sum(((coalesce(pct_value,0)+coalesce(pct_items,0))/2)*n)/nullif(sum(n),0) weighted_pct from compared group by doctor_id having sum(n)>=15
  loop
    v_points:=greatest(-10,least(30,round(v_row.weighted_pct)))::int;
    select id into v_existing_id from public.employee_transactions where staff_id=v_row.doctor_id and source='invoice_quality_vs_branch_baseline' and month_cycle=v_month_cycle limit 1;
    if v_existing_id is null then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible,metadata)
      values(v_row.doctor_id,case when v_points>=0 then 'reward' else 'penalty' end,v_points,v_points,0,'جودة الفاتورة مقارنة بمتوسط الفرع والشيفت','invoice_quality_vs_branch_baseline',v_month_cycle,v_row.branch,'active',v_row.doctor_name,'system_automation','متوسط قيمة الفاتورة وعدد الأصناف مقارنة بمتوسط '||v_row.branch||' لنفس الشيفت خلال آخر 90 يوم، على '||v_row.total_n||' فاتورة في دورة '||v_month_cycle||' — الفرق المرجّح '||round(v_row.weighted_pct,1)||'%.','جودة البيع والصرف',true,jsonb_build_object('engine_version',2,'month_cycle',v_month_cycle,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'weighted_pct_vs_baseline',round(v_row.weighted_pct,1),'invoice_count',v_row.total_n,'baseline_window_days',90,'cap_min',-10,'cap_max',30));
    else
      update public.employee_transactions set points=v_points,points_delta=v_points,updated_at=now(),description='متوسط قيمة الفاتورة وعدد الأصناف مقارنة بمتوسط '||v_row.branch||' لنفس الشيفت خلال آخر 90 يوم، على '||v_row.total_n||' فاتورة في دورة '||v_month_cycle||' — الفرق المرجّح '||round(v_row.weighted_pct,1)||'%.',type=case when v_points>=0 then 'reward' else 'penalty' end,metadata=jsonb_build_object('engine_version',2,'month_cycle',v_month_cycle,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'weighted_pct_vs_baseline',round(v_row.weighted_pct,1),'invoice_count',v_row.total_n,'baseline_window_days',90,'cap_min',-10,'cap_max',30) where id=v_existing_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.refresh_doctor_metrics_daily()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_month_cycle text := public.dawaa_current_points_cycle_label_v1();
  v_cycle_start date := public.dawaa_points_cycle_start_for_label_v1(v_month_cycle);
  v_cycle_end date := public.dawaa_points_cycle_end_for_label_v1(v_month_cycle);
  v_count integer:=0;
begin
  with doctors as (
    select s.id doctor_id,s.name doctor_name,s.branch,public.dawaa_normalize_doctor_name(s.name) norm_name from public.staff s where s.role='صيدلاني' and coalesce(s.is_active,true)=true
  ), invoice_truth as materialized (
    select public.dawaa_normalize_doctor_name(coalesce(nullif(btrim(i.seller_name),''),nullif(btrim(i.staff_name),''),nullif(btrim(i.normalized_seller_name),''))) norm_name,i.invoice_date,coalesce(nullif(i.net_amount,0),nullif(i.net_total,0),nullif(i.discounted_amount,0),nullif(i.total_amount,0),nullif(i.amount,0),0)::numeric value
    from public.dawaa_sales_invoices_dashboard_v1 i where i.invoice_date>=v_cycle_start::timestamp and i.invoice_date<(least(v_cycle_end,v_today)+1)::timestamp
  ), daily as (
    select d.doctor_id,coalesce(sum(i.value),0) daily_sales,count(*) daily_invoice_count from doctors d join invoice_truth i on i.norm_name=d.norm_name where i.invoice_date>=v_today::timestamp and i.invoice_date<(v_today+1)::timestamp group by d.doctor_id
  ), cycle_totals as (
    select d.doctor_id,coalesce(sum(i.value),0) monthly_sales,count(*) monthly_invoice_count from doctors d join invoice_truth i on i.norm_name=d.norm_name group by d.doctor_id
  ), pending as (
    select d.doctor_id,count(*) customers_to_contact from doctors d join public.daily_followups f on public.dawaa_normalize_doctor_name(f.assigned_doctor)=d.norm_name and coalesce(f.open_case,true)=true group by d.doctor_id
  ), points as (
    select d.doctor_id,coalesce(sum(t.points_delta),0) points_balance from doctors d join public.employee_transactions t on t.staff_id=d.doctor_id and t.status='active' and t.month_cycle=v_month_cycle group by d.doctor_id
  )
  insert into public.doctor_metrics(doctor_id,doctor_name,branch,metric_date,daily_sales,monthly_sales,daily_invoice_count,monthly_invoice_count,points_balance,rewards_balance,discount_balance,customers_to_contact,updated_at)
  select d.doctor_id,d.doctor_name,d.branch,v_today,coalesce(dl.daily_sales,0),coalesce(m.monthly_sales,0),coalesce(dl.daily_invoice_count,0),coalesce(m.monthly_invoice_count,0),coalesce(pt.points_balance,0)::int,0,0,coalesce(p.customers_to_contact,0),now()
  from doctors d left join daily dl on dl.doctor_id=d.doctor_id left join cycle_totals m on m.doctor_id=d.doctor_id left join pending p on p.doctor_id=d.doctor_id left join points pt on pt.doctor_id=d.doctor_id
  on conflict(doctor_id,metric_date) do update set doctor_name=excluded.doctor_name,branch=excluded.branch,daily_sales=excluded.daily_sales,monthly_sales=excluded.monthly_sales,daily_invoice_count=excluded.daily_invoice_count,monthly_invoice_count=excluded.monthly_invoice_count,points_balance=excluded.points_balance,customers_to_contact=excluded.customers_to_contact,updated_at=now();
  get diagnostics v_count=row_count; return v_count;
end;
$function$;

create or replace function public.settle_branch_star_of_month()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_branch text; v_month_cycle text:=public.dawaa_last_closed_points_cycle_label_v1(); v_winner record; v_count integer:=0;
begin
  for v_branch in select distinct branch from public.staff where role='صيدلاني' and coalesce(is_active,true)=true loop
    select d.doctor_id,d.doctor_name,d.composite,d.min_pillar into v_winner
    from (
      select s.id doctor_id,s.name doctor_name,
        (0.25*greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('الالتزام والانضباط','الالتزام بالتطبيق')),0)))+0.25*greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.source='conversation_evaluation'),0)))+0.10*greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('جودة البيع والصرف','قوائم النواقص')),0)))+0.40*greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('خدمة العملاء','تصنيف البيانات')),0)))) composite,
        least(greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('الالتزام والانضباط','الالتزام بالتطبيق')),0))),greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.source='conversation_evaluation'),0))),greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('جودة البيع والصرف','قوائم النواقص')),0))),greatest(0,least(100,50+coalesce(sum(t.points_delta) filter(where t.category in ('خدمة العملاء','تصنيف البيانات')),0)))) min_pillar
      from public.staff s left join public.employee_transactions t on t.staff_id=s.id and t.status='active' and t.month_cycle=v_month_cycle where s.role='صيدلاني' and s.branch=v_branch and coalesce(s.is_active,true)=true group by s.id,s.name
    ) d where d.min_pillar>=65 order by d.composite desc limit 1;
    if v_winner.doctor_id is not null and not exists(select 1 from public.employee_transactions where source='branch_star_of_month' and month_cycle=v_month_cycle and branch=v_branch) then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
      values(v_winner.doctor_id,'reward',0,0,600,'نجم الفرع 🌟','branch_star_of_month',v_month_cycle,v_branch,'active',v_winner.doctor_name,'system_automation','أعلى دكتور متوازن في '||v_branch||' — درجة مركّبة '||round(v_winner.composite,1)||'/100، وكل محور فوق 65/100. حافز تميّز مستقل للدورة المقفولة '||v_month_cycle||'.','الحافز الشهري',true); v_count:=v_count+1;
    end if;
  end loop; return v_count;
end;
$function$;

select public.refresh_doctor_metrics_daily();
select public.settle_doctor_invoice_quality_points();
