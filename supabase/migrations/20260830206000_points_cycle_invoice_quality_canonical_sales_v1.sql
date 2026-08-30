-- Final doctor cycle readers: 26→25 bounds + canonical sales truth only.

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
  v_count integer := 0;
begin
  with doctors as (
    select s.id doctor_id,s.name doctor_name,s.branch,public.dawaa_normalize_doctor_name(s.name) norm_name
    from public.staff s where s.role='صيدلاني' and coalesce(s.is_active,true)=true
  ), invoice_truth as materialized (
    select public.dawaa_normalize_doctor_name(coalesce(nullif(btrim(i.seller_name),''),nullif(btrim(i.staff_name),''),nullif(btrim(i.normalized_seller_name),''))) norm_name,
           i.invoice_date,
           coalesce(nullif(i.net_amount,0),nullif(i.net_total,0),nullif(i.discounted_amount,0),nullif(i.total_amount,0),nullif(i.amount,0),0)::numeric value
    from public.dawaa_sales_invoices_dashboard_v1 i
    where i.invoice_date>=v_cycle_start::timestamp and i.invoice_date<(least(v_cycle_end,v_today)+1)::timestamp
  ), daily as (
    select d.doctor_id,coalesce(sum(i.value),0) daily_sales,count(*) daily_invoice_count
    from doctors d join invoice_truth i on i.norm_name=d.norm_name
    where i.invoice_date>=v_today::timestamp and i.invoice_date<(v_today+1)::timestamp
    group by d.doctor_id
  ), cycle_totals as (
    select d.doctor_id,coalesce(sum(i.value),0) monthly_sales,count(*) monthly_invoice_count
    from doctors d join invoice_truth i on i.norm_name=d.norm_name group by d.doctor_id
  ), pending as (
    select d.doctor_id,count(*) customers_to_contact
    from doctors d join public.daily_followups f on public.dawaa_normalize_doctor_name(f.assigned_doctor)=d.norm_name and coalesce(f.open_case,true)=true
    group by d.doctor_id
  ), points as (
    select d.doctor_id,coalesce(sum(t.points_delta),0) points_balance
    from doctors d join public.employee_transactions t on t.staff_id=d.doctor_id and t.status='active' and t.month_cycle=v_month_cycle
    group by d.doctor_id
  )
  insert into public.doctor_metrics(
    doctor_id,doctor_name,branch,metric_date,daily_sales,monthly_sales,
    daily_invoice_count,monthly_invoice_count,points_balance,rewards_balance,
    discount_balance,customers_to_contact,updated_at
  )
  select d.doctor_id,d.doctor_name,d.branch,v_today,
         coalesce(dl.daily_sales,0),coalesce(m.monthly_sales,0),
         coalesce(dl.daily_invoice_count,0),coalesce(m.monthly_invoice_count,0),
         coalesce(pt.points_balance,0)::int,0,0,coalesce(p.customers_to_contact,0),now()
  from doctors d
  left join daily dl on dl.doctor_id=d.doctor_id
  left join cycle_totals m on m.doctor_id=d.doctor_id
  left join pending p on p.doctor_id=d.doctor_id
  left join points pt on pt.doctor_id=d.doctor_id
  on conflict(doctor_id,metric_date) do update set
    doctor_name=excluded.doctor_name,branch=excluded.branch,
    daily_sales=excluded.daily_sales,monthly_sales=excluded.monthly_sales,
    daily_invoice_count=excluded.daily_invoice_count,monthly_invoice_count=excluded.monthly_invoice_count,
    points_balance=excluded.points_balance,customers_to_contact=excluded.customers_to_contact,updated_at=now();
  get diagnostics v_count=row_count;
  return v_count;
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
  v_count integer:=0;
  v_row record;
  v_points integer;
  v_existing_id uuid;
begin
  for v_row in
    with doctors as (
      select s.id doctor_id,s.name doctor_name,s.branch,public.dawaa_normalize_doctor_name(s.name) norm_name
      from public.staff s where s.role='صيدلاني' and coalesce(s.is_active,true)=true
    ), baseline_90d as (
      select branch,shift_name,
             avg(coalesce(nullif(net_amount,0),nullif(net_total,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0)) baseline_value,
             avg(line_items_count) baseline_items
      from public.dawaa_sales_invoices_dashboard_v1
      where invoice_date >= (v_today - interval '90 days')
        and coalesce(nullif(net_amount,0),nullif(net_total,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0)>0
        and shift_name is not null
      group by branch,shift_name
    ), doctor_shift_cycle as (
      select d.doctor_id,max(d.doctor_name) doctor_name,max(d.branch) branch,i.shift_name,count(*) n,
             avg(coalesce(nullif(i.net_amount,0),nullif(i.net_total,0),nullif(i.discounted_amount,0),nullif(i.total_amount,0),nullif(i.amount,0),0)) doc_avg_value,
             avg(i.line_items_count) doc_avg_items
      from doctors d
      join public.dawaa_sales_invoices_dashboard_v1 i
        on public.dawaa_normalize_doctor_name(coalesce(nullif(i.normalized_seller_name,''),nullif(i.seller_name,''),nullif(i.staff_name,'')))=d.norm_name
       and i.invoice_date>=v_cycle_start::timestamp
       and i.invoice_date<(least(v_today,v_cycle_end)+1)::timestamp
       and coalesce(nullif(i.net_amount,0),nullif(i.net_total,0),nullif(i.discounted_amount,0),nullif(i.total_amount,0),nullif(i.amount,0),0)>0
       and i.shift_name is not null
      group by d.doctor_id,i.shift_name
    ), compared as (
      select ds.doctor_id,ds.doctor_name,ds.branch,ds.n,
             (ds.doc_avg_value-b.baseline_value)/nullif(b.baseline_value,0)*100 pct_value,
             (ds.doc_avg_items-b.baseline_items)/nullif(b.baseline_items,0)*100 pct_items
      from doctor_shift_cycle ds join baseline_90d b on b.branch=ds.branch and b.shift_name=ds.shift_name
    )
    select doctor_id,max(doctor_name) doctor_name,max(branch) branch,sum(n) total_n,
           sum(((coalesce(pct_value,0)+coalesce(pct_items,0))/2)*n)/nullif(sum(n),0) weighted_pct
    from compared group by doctor_id having sum(n)>=15
  loop
    v_points:=greatest(-10,least(30,round(v_row.weighted_pct)))::int;
    select id into v_existing_id
    from public.employee_transactions
    where staff_id=v_row.doctor_id and source='invoice_quality_vs_branch_baseline' and month_cycle=v_month_cycle
    limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions(
        staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,
        status,employee_name,created_by,description,category,employee_visible,metadata
      ) values (
        v_row.doctor_id,case when v_points>=0 then 'reward' else 'penalty' end,
        v_points,v_points,0,'جودة الفاتورة مقارنة بمتوسط الفرع والشيفت',
        'invoice_quality_vs_branch_baseline',v_month_cycle,v_row.branch,'active',v_row.doctor_name,'system_automation',
        'متوسط قيمة الفاتورة وعدد الأصناف مقارنة بمتوسط '||v_row.branch||' لنفس الشيفت خلال آخر 90 يوم، على '||v_row.total_n||' فاتورة في دورة '||v_month_cycle||' — الفرق المرجّح '||round(v_row.weighted_pct,1)||'%.',
        'جودة البيع والصرف',true,
        jsonb_build_object('engine_version',3,'sales_truth_source','dawaa_sales_invoices_dashboard_v1','month_cycle',v_month_cycle,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'weighted_pct_vs_baseline',round(v_row.weighted_pct,1),'invoice_count',v_row.total_n,'baseline_window_days',90,'cap_min',-10,'cap_max',30)
      );
    else
      update public.employee_transactions set
        points=v_points,points_delta=v_points,updated_at=now(),
        description='متوسط قيمة الفاتورة وعدد الأصناف مقارنة بمتوسط '||v_row.branch||' لنفس الشيفت خلال آخر 90 يوم، على '||v_row.total_n||' فاتورة في دورة '||v_month_cycle||' — الفرق المرجّح '||round(v_row.weighted_pct,1)||'%.',
        type=case when v_points>=0 then 'reward' else 'penalty' end,
        metadata=jsonb_build_object('engine_version',3,'sales_truth_source','dawaa_sales_invoices_dashboard_v1','month_cycle',v_month_cycle,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'weighted_pct_vs_baseline',round(v_row.weighted_pct,1),'invoice_count',v_row.total_n,'baseline_window_days',90,'cap_min',-10,'cap_max',30)
      where id=v_existing_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

select public.refresh_doctor_metrics_daily();
select public.settle_doctor_invoice_quality_points();
