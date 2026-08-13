-- Customer-service smart queues v2: recent Top 50 per branch, balanced daily VIP 7,
-- precise +500 invoice queue, points queue and generic offline-results import.

create or replace function public.get_customer_service_recent_top50_v2(p_days integer default 90)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text,
  recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric,
  last_purchase date, importance_score numeric)
language sql stable security definer set search_path = public, pg_catalog as $$
  with scope as (select public.dawaa_customer_intelligence_access_scope_v1() as value), base as (
    select s.branch,btrim(s.customer_code) customer_code,max(nullif(btrim(s.customer_name),'')) customer_name,
      max(nullif(btrim(coalesce(s.customer_phone,s.phone)),'')) customer_phone,
      sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
      count(*)::bigint invoice_count,count(distinct date_trunc('month',s.invoice_date))::integer active_months,
      avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,max(s.invoice_date)::date last_purchase
    from public.sales_invoices s cross join scope sc
    where s.invoice_date >= (current_date-(greatest(1,least(coalesce(p_days,90),180))-1))::timestamptz
      and s.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
      and nullif(btrim(s.customer_code),'') is not null and btrim(s.customer_code) not in ('5','10','54','170','12820')
      and nullif(btrim(s.customer_name),'') is not null
      and btrim(s.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
      and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
    group by s.branch,btrim(s.customer_code)
  ), scored as (
    select b.*,round((b.recent_sales*(0.70+0.10*least(b.active_months,3)))::numeric,2) importance_score from base b
  ), ranked as (
    select s.*,row_number() over(partition by s.branch order by s.importance_score desc,s.recent_sales desc,s.invoice_count desc,s.last_purchase desc,s.customer_code)::integer customer_rank from scored s
  )
  select r.customer_rank,r.branch,r.customer_code,r.customer_name,r.customer_phone,round(r.recent_sales,2),r.invoice_count,r.active_months,
    round(r.avg_invoice,2),r.last_purchase,r.importance_score from ranked r where r.customer_rank<=50 order by r.branch,r.customer_rank;
$$;
grant execute on function public.get_customer_service_recent_top50_v2(integer) to anon,authenticated;

create or replace function public.get_customer_service_daily_vip7_v2(p_date date default current_date)
returns table(daily_order integer,customer_rank integer,branch text,customer_code text,customer_name text,customer_phone text,
  recent_sales numeric,invoice_count bigint,active_months integer,last_purchase date,importance_score numeric)
language sql stable security definer set search_path=public,pg_catalog as $$
  with vars as (select greatest(0,p_date-date '2026-01-01')::integer day_index),
  top50 as (select * from public.get_customer_service_recent_top50_v2(90)), configured as (
    select t.*,
      case when t.branch='فرع شكري' then case when mod(v.day_index,2)=0 then 4 else 3 end else case when mod(v.day_index,2)=0 then 3 else 4 end end quota,
      case when t.branch='فرع شكري' then mod((v.day_index/2)*7+case when mod(v.day_index,2)=1 then 4 else 0 end,50)
           else mod((v.day_index/2)*7+case when mod(v.day_index,2)=1 then 3 else 0 end,50) end start_offset
    from top50 t cross join vars v
  ), rotated as (
    select c.*,row_number() over(partition by c.branch order by mod((c.customer_rank-1)-c.start_offset+50,50),c.customer_rank)::integer branch_daily_order from configured c
  ), picked as (select r.* from rotated r where r.branch_daily_order<=r.quota)
  select row_number() over(order by p.branch,p.branch_daily_order)::integer,p.customer_rank,p.branch,p.customer_code,p.customer_name,p.customer_phone,
    p.recent_sales,p.invoice_count,p.active_months,p.last_purchase,p.importance_score from picked p order by p.branch,p.branch_daily_order;
$$;
grant execute on function public.get_customer_service_daily_vip7_v2(date) to anon,authenticated;

create or replace function public.get_customer_service_plus500_v2(p_date date default (current_date-1))
returns table(branch text,customer_code text,customer_name text,customer_phone text,qualifying_invoice_count bigint,qualifying_total numeric,invoice_values jsonb,highest_invoice numeric)
language sql stable security definer set search_path=public,pg_catalog as $$
  with scope as (select public.dawaa_customer_intelligence_access_scope_v1() value), eligible_invoices as (
    select s.branch,btrim(s.customer_code) customer_code,nullif(btrim(s.customer_name),'') customer_name,
      nullif(btrim(coalesce(s.customer_phone,s.phone)),'') customer_phone,
      coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)::numeric invoice_value,coalesce(s.invoice_no,s.invoice_number,'') invoice_number
    from public.sales_invoices s cross join scope sc
    where s.sale_date=p_date and s.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
      and nullif(btrim(s.customer_code),'') is not null and btrim(s.customer_code) not in ('5','10','54','170','12820')
      and nullif(btrim(s.customer_name),'') is not null and btrim(s.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
      and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>=500
  )
  select e.branch,e.customer_code,max(e.customer_name),max(e.customer_phone),count(*)::bigint,round(sum(e.invoice_value),2),
    jsonb_agg(jsonb_build_object('invoiceNumber',e.invoice_number,'value',round(e.invoice_value,2)) order by e.invoice_value desc),round(max(e.invoice_value),2)
  from eligible_invoices e group by e.branch,e.customer_code order by e.branch,sum(e.invoice_value) desc,e.customer_code;
$$;
grant execute on function public.get_customer_service_plus500_v2(date) to anon,authenticated;

create or replace function public.get_customer_points_daily20_v2(p_date date default current_date)
returns table(daily_order integer,branch text,customer_code text,customer_name text,customer_phone text,points_balance numeric,last_contacted_at timestamptz,ledger_entries bigint)
language sql stable security definer set search_path=public,pg_catalog as $$
  with scope as (select public.dawaa_customer_intelligence_access_scope_v1() value), balances as (
    select l.branch,btrim(l.customer_code) customer_code,max(nullif(btrim(l.customer_name),'')) customer_name,max(nullif(btrim(l.customer_phone),'')) customer_phone,
      sum(coalesce(l.points_amount,0))::numeric points_balance,max(l.contacted_at) last_contacted_at,count(*)::bigint ledger_entries
    from public.customer_points_ledger l cross join scope sc
    where l.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(l.branch))=sc.value)
      and nullif(btrim(l.customer_code),'') is not null and btrim(l.customer_code) not in ('5','10','54','170','12820')
      and nullif(btrim(l.customer_name),'') is not null and btrim(l.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
      and (l.expiry_date is null or l.expiry_date>=p_date)
    group by l.branch,btrim(l.customer_code) having sum(coalesce(l.points_amount,0))>0
  ), ranked as (
    select b.*,row_number() over(partition by b.branch order by b.last_contacted_at asc nulls first,b.points_balance desc,b.customer_code)::integer rn from balances b
  )
  select row_number() over(order by r.branch,r.rn)::integer,r.branch,r.customer_code,r.customer_name,r.customer_phone,round(r.points_balance,2),r.last_contacted_at,r.ledger_entries
  from ranked r where r.rn<=10 order by r.branch,r.rn;
$$;
grant execute on function public.get_customer_points_daily20_v2(date) to anon,authenticated;

create or replace function public.mark_customer_points_contacted_v2(p_branch text,p_customer_code text,p_actor_name text default null)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_count integer;
begin
  perform public.dawaa_assert_customer_intelligence_branch(p_branch);
  update public.customer_points_ledger set contacted=true,contacted_at=now(),contacted_by_name=coalesce(nullif(btrim(p_actor_name),''),'خدمة العملاء'),updated_at=now()
   where branch=p_branch and btrim(customer_code)=btrim(p_customer_code);
  get diagnostics v_count=row_count; return v_count;
end;$$;
grant execute on function public.mark_customer_points_contacted_v2(text,text,text) to anon,authenticated;

create or replace function public.import_customer_service_queue_results_v2(p_actor_id uuid,p_branch text,p_file_name text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_actor record; v_item jsonb; v_total integer:=0; v_imported integer:=0; v_duplicates integer:=0; v_skipped integer:=0;
  v_row_no integer; v_queue text; v_branch text; v_code text; v_name text; v_phone text; v_followed boolean; v_responded boolean;
  v_purchase boolean; v_purchase_amount numeric; v_invoice_amount numeric; v_points numeric; v_needs_next boolean; v_next_date date;
  v_response text; v_notes text; v_followup_type text; v_reason text; v_status text; v_followup_status text; v_contact_status text;
  v_result text; v_completed_at timestamptz; v_client_request_id text; v_existing text; v_customer record;
begin
  select a.id,a.staff_id,coalesce(a.name,a.staff_name,a.username) actor_name,lower(coalesce(a.role,'')) role,coalesce(a.branch,'') branch into v_actor
    from public.staff_accounts a where a.id=p_actor_id and coalesce(a.active,false) and coalesce(a.can_login,false) limit 1;
  if not found then raise exception 'unauthorized'; end if;
  if v_actor.role not in ('general_manager','branches_manager','branch_manager','customer_service_manager','customer_service','manager') then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'rows must be array'; end if;
  v_total:=jsonb_array_length(p_rows);
  for v_item in select value from jsonb_array_elements(p_rows) loop
    begin
      v_row_no:=coalesce(nullif(v_item->>'rowNumber','')::integer,0); v_queue:=coalesce(nullif(btrim(v_item->>'queueType'),''),'other');
      v_branch:=nullif(btrim(v_item->>'branch'),''); if v_branch is null and p_branch in ('فرع شكري','فرع الشامي') then v_branch:=p_branch; end if;
      if v_branch not in ('فرع شكري','فرع الشامي') then raise exception 'invalid row branch'; end if;
      perform public.dawaa_assert_customer_intelligence_branch(v_branch);
      if p_branch in ('فرع شكري','فرع الشامي') and v_branch<>p_branch then raise exception 'row branch mismatch'; end if;
      v_code:=nullif(btrim(v_item->>'customerCode'),''); v_name:=nullif(btrim(v_item->>'customerName'),''); v_phone:=nullif(btrim(v_item->>'phone'),'');
      if v_code is null and v_name is null then raise exception 'missing customer identity'; end if;
      v_followed:=coalesce((v_item->>'followedUp')::boolean,false); v_responded:=coalesce((v_item->>'responded')::boolean,false);
      v_purchase:=coalesce((v_item->>'purchaseAfterFollowup')::boolean,false); v_purchase_amount:=coalesce(nullif(v_item->>'purchaseAmount','')::numeric,0);
      v_invoice_amount:=coalesce(nullif(v_item->>'invoiceAmount','')::numeric,0); v_points:=coalesce(nullif(v_item->>'pointsBalance','')::numeric,0);
      v_needs_next:=coalesce((v_item->>'needsNextFollowup')::boolean,false); v_next_date:=nullif(v_item->>'nextFollowupDate','')::date;
      v_response:=nullif(btrim(v_item->>'responseRaw'),''); v_notes:=nullif(btrim(v_item->>'notes'),'');
      select c.id,c.customer_code,c.name,coalesce(c.whatsapp,c.mobile,c.phone) phone,c.total_spent,c.last_purchase into v_customer from public.customers c
       where (v_code is not null and btrim(c.customer_code)=v_code) or (v_code is null and v_name is not null and lower(btrim(c.name))=lower(v_name))
       order by case when v_code is not null and btrim(c.customer_code)=v_code then 0 else 1 end,c.updated_at desc nulls last limit 1;
      v_name:=coalesce(v_customer.name,v_name,'عميل غير مسجل'); v_code:=coalesce(v_customer.customer_code,v_code); v_phone:=coalesce(v_customer.phone,v_phone);
      v_followup_type:=case v_queue when 'vip_recent' then 'متابعة VIP آخر 90 يوم' when 'plus500' then 'متابعة فاتورة +500' when 'points' then 'إرسال رصيد النقاط' when 'activity' then 'متابعة نشاط العميل' else 'متابعة خدمة العملاء' end;
      v_reason:=case v_queue when 'vip_recent' then 'الحفاظ على أهم العملاء النشطين خلال آخر 90 يوم' when 'plus500' then 'متابعة واطمئنان بعد فاتورة بقيمة 500 جنيه فأكثر' when 'points' then 'إبلاغ العميل برصيد نقاطه وتشجيع الاستفادة منها' when 'activity' then 'متابعة تغير نشاط ومشتريات العميل' else 'متابعة خدمة العملاء' end;
      if not v_followed then v_status:='open';v_followup_status:='not_started';v_contact_status:='not_started';v_result:=null;v_completed_at:=null;v_needs_next:=true;v_next_date:=coalesce(v_next_date,current_date+1);
      elsif not v_responded then v_status:='open';v_followup_status:='attempted';v_contact_status:='no_answer';v_result:='لم يرد';v_completed_at:=null;v_needs_next:=true;v_next_date:=coalesce(v_next_date,current_date+1);
      elsif v_purchase then v_status:='completed';v_followup_status:='completed';v_contact_status:='responded';v_result:='تم الشراء بعد المتابعة';v_completed_at:=now();
      elsif v_needs_next then v_status:='open';v_followup_status:='scheduled';v_contact_status:='responded';v_result:='طلب التواصل لاحقًا';v_completed_at:=null;v_next_date:=coalesce(v_next_date,current_date+1);
      else v_status:='completed';v_followup_status:='completed';v_contact_status:='responded';v_result:='تم الرد';v_completed_at:=now(); end if;
      v_client_request_id:='smart-queue-v2:'||md5(coalesce(p_file_name,'')||'|'||v_row_no||'|'||v_queue||'|'||v_branch||'|'||coalesce(v_code,v_name,''));
      select d.id into v_existing from public.daily_followups d where d.client_request_id=v_client_request_id limit 1;
      if v_existing is not null then v_duplicates:=v_duplicates+1; continue; end if;
      insert into public.daily_followups(date,followup_date,customer_id,customer_name,name,customer_code,customer_phone,phone,branch,status,followup_status,
        contact_status,response_status,contact_result,followup_result,followup_type,request_type,request_source,followup_reason,request_details,notes,total_spent,
        last_purchase_date,purchase_after_followup,purchase_amount,needs_next_followup,next_followup_date,contacted_at,first_attempt_at,last_attempt_at,attempt_count,
        completed_at,closed_at,open_case,responsible_name,assigned_to,handled_by_staff_id,created_by,created_by_name,updated_by,client_request_id,data_quality_status,customer_metrics)
      values(current_date::text,current_date::text,v_customer.id::text,v_name,v_name,v_code,v_phone,v_phone,v_branch,v_status,v_followup_status,v_contact_status,
        case when v_responded then 'responded' when v_followed then 'no_answer' else 'not_contacted' end,v_result,v_result,v_followup_type,'smart_queue_excel_import','customer_service_smart_queue_v2',v_reason,
        concat(case when v_invoice_amount>0 then 'قيمة الفاتورة: '||v_invoice_amount||' جنيه. ' else '' end,case when v_points<>0 then 'رصيد النقاط: '||v_points||'. ' else '' end,case when v_response is not null then 'رد العميل: '||v_response||'. ' else '' end),
        concat('استيراد ملف: ',coalesce(p_file_name,'-'),case when v_notes is not null then ' · '||v_notes else '' end),coalesce(v_customer.total_spent,0),v_customer.last_purchase,
        v_purchase,nullif(v_purchase_amount,0),v_needs_next,v_next_date,case when v_followed then now() else null end,case when v_followed then now() else null end,
        case when v_followed then now() else null end,case when v_followed then 1 else 0 end,v_completed_at,v_completed_at,v_completed_at is null,v_actor.actor_name,v_actor.actor_name,
        v_actor.staff_id,p_actor_id::text,v_actor.actor_name,p_actor_id::text,v_client_request_id,'complete',jsonb_build_object('queue_type',v_queue,'invoice_amount',v_invoice_amount,'points_balance',v_points,'source','smart_queue_excel_v2'));
      if v_queue='points' and v_followed and v_code is not null then perform public.mark_customer_points_contacted_v2(v_branch,v_code,v_actor.actor_name); end if;
      v_imported:=v_imported+1;
    exception when others then v_skipped:=v_skipped+1; end;
  end loop;
  return jsonb_build_object('total',v_total,'imported',v_imported,'duplicates',v_duplicates,'skipped',v_skipped);
end;$$;
grant execute on function public.import_customer_service_queue_results_v2(uuid,text,text,jsonb) to anon,authenticated;
