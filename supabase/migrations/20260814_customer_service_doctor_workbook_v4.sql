-- Customer service doctor workbook import V4
-- Updates the original exceptional followup when sourceFollowupId is present,
-- imports executed rows only, and uses a stable daily idempotency key.

create or replace function public.import_customer_service_queue_results_v4(
  p_actor_id uuid,
  p_branch text,
  p_file_name text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record; v_item jsonb; v_total integer:=0; v_imported integer:=0; v_updated integer:=0; v_duplicates integer:=0; v_skipped integer:=0;
  v_row_no integer; v_queue text; v_branch text; v_code text; v_name text; v_phone text; v_source_followup_id text;
  v_followed boolean; v_responded boolean; v_purchase boolean; v_purchase_amount numeric; v_invoice_amount numeric; v_points numeric;
  v_needs_next boolean; v_next_date date; v_response text; v_notes text; v_followup_type text; v_reason text;
  v_status text; v_followup_status text; v_contact_status text; v_result text; v_completed_at timestamptz;
  v_client_request_id text; v_existing text; v_customer record; v_scope text; v_summary text;
begin
  select a.id,a.staff_id,coalesce(a.name,a.staff_name,a.username) actor_name,lower(coalesce(a.role,'')) role,coalesce(a.branch,'') branch
    into v_actor from public.staff_accounts a
    where a.id=p_actor_id and coalesce(a.active,false) and coalesce(a.can_login,false) limit 1;
  if not found then raise exception 'unauthorized'; end if;
  if v_actor.role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service','manager','pharmacist','shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night') then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'rows must be array'; end if;
  v_scope:=public.dawaa_customer_service_queue_scope_v3(p_actor_id);
  if v_scope is null or v_scope='' then raise exception 'not authorized'; end if;
  v_total:=jsonb_array_length(p_rows);

  for v_item in select value from jsonb_array_elements(p_rows) loop
    begin
      v_row_no:=coalesce(nullif(v_item->>'rowNumber','')::integer,0);
      v_queue:=coalesce(nullif(btrim(v_item->>'queueType'),''),'other');
      v_branch:=nullif(btrim(v_item->>'branch'),'');
      if v_branch is null and p_branch in ('فرع شكري','فرع الشامي') then v_branch:=p_branch; end if;
      if v_branch not in ('فرع شكري','فرع الشامي') then raise exception 'invalid row branch'; end if;
      if v_scope<>'ALL' and v_scope<>lower(btrim(v_branch)) then raise exception 'row branch not allowed'; end if;
      if p_branch in ('فرع شكري','فرع الشامي') and v_branch<>p_branch then raise exception 'row branch mismatch'; end if;

      v_source_followup_id:=nullif(btrim(v_item->>'sourceFollowupId'),'');
      v_code:=nullif(btrim(v_item->>'customerCode'),'');
      v_name:=nullif(btrim(v_item->>'customerName'),'');
      v_phone:=nullif(btrim(v_item->>'phone'),'');
      v_followed:=coalesce((v_item->>'followedUp')::boolean,false);
      if not v_followed then continue; end if;
      v_responded:=coalesce((v_item->>'responded')::boolean,false);
      v_purchase:=coalesce((v_item->>'purchaseAfterFollowup')::boolean,false);
      v_purchase_amount:=coalesce(nullif(v_item->>'purchaseAmount','')::numeric,0);
      v_invoice_amount:=coalesce(nullif(v_item->>'invoiceAmount','')::numeric,0);
      v_points:=coalesce(nullif(v_item->>'pointsBalance','')::numeric,0);
      v_needs_next:=coalesce((v_item->>'needsNextFollowup')::boolean,false);
      v_next_date:=nullif(v_item->>'nextFollowupDate','')::date;
      v_response:=nullif(btrim(v_item->>'responseRaw'),'');
      v_notes:=nullif(btrim(v_item->>'notes'),'');
      if v_notes is null or length(v_notes)<10 then raise exception 'notes too short'; end if;
      if v_needs_next and v_next_date is null then raise exception 'next followup date required'; end if;

      select c.id,c.customer_code,c.name,coalesce(c.whatsapp,c.mobile,c.phone) phone,c.total_spent,c.last_purchase
      into v_customer
      from public.customers c
      where (v_code is not null and btrim(c.customer_code)=v_code)
         or (v_code is null and v_name is not null and lower(btrim(c.name))=lower(v_name))
      order by case when v_code is not null and btrim(c.customer_code)=v_code then 0 else 1 end,c.updated_at desc nulls last
      limit 1;
      v_name:=coalesce(v_customer.name,v_name,'عميل غير مسجل');
      v_code:=coalesce(v_customer.customer_code,v_code);
      v_phone:=coalesce(v_customer.phone,v_phone);

      v_followup_type:=case v_queue
        when 'exceptional' then 'متابعة استثنائية'
        when 'vip_recent' then 'متابعة VIP آخر 3 شهور'
        when 'plus500' then 'متابعة فاتورة +500'
        when 'points' then 'إرسال رصيد النقاط'
        when 'activity' then 'متابعة نشاط العميل'
        else 'متابعة خدمة العملاء' end;
      v_reason:=case v_queue
        when 'exceptional' then 'تنفيذ طلب متابعة استثنائية من دكتور الفرع'
        when 'vip_recent' then 'الحفاظ على أهم العملاء'
        when 'plus500' then 'متابعة بعد فاتورة 500+'
        when 'points' then 'إبلاغ العميل بالنقاط'
        when 'activity' then 'متابعة تغير نشاط العميل'
        else 'متابعة خدمة العملاء' end;

      if not v_responded then
        v_status:='open'; v_followup_status:='attempted'; v_contact_status:='no_answer'; v_result:='لم يرد'; v_completed_at:=null;
        v_needs_next:=true; v_next_date:=coalesce(v_next_date,current_date+1);
      elsif v_purchase then
        v_status:='completed'; v_followup_status:='completed'; v_contact_status:='responded'; v_result:='تم الشراء بعد المتابعة'; v_completed_at:=now();
      elsif v_needs_next then
        v_status:='open'; v_followup_status:='scheduled'; v_contact_status:='responded'; v_result:='طلب التواصل لاحقًا'; v_completed_at:=null;
      else
        v_status:='completed'; v_followup_status:='completed'; v_contact_status:='responded'; v_result:='تم الرد'; v_completed_at:=now();
      end if;

      v_summary:=concat_ws(' - ',v_result,case when v_purchase and v_purchase_amount>0 then 'قيمة الشراء: '||v_purchase_amount||' جنيه' end,v_response,v_notes);

      if v_source_followup_id is not null and v_queue='exceptional' then
        update public.daily_followups d set
          status=v_status,
          followup_status=v_followup_status,
          contact_status=v_contact_status,
          response_status=case when v_responded then 'responded' else 'no_answer' end,
          contact_result=v_result,
          followup_result=v_result,
          followup_summary=v_summary,
          evaluation_summary=v_summary,
          purchase_after_followup=v_purchase,
          purchase_amount=nullif(v_purchase_amount,0),
          needs_next_followup=v_needs_next,
          next_followup_date=v_next_date,
          contacted_at=now(),
          first_attempt_at=coalesce(d.first_attempt_at,now()),
          last_attempt_at=now(),
          attempt_count=coalesce(d.attempt_count,0)+1,
          completed_at=v_completed_at,
          closed_at=v_completed_at,
          open_case=v_completed_at is null,
          handled_by_staff_id=v_actor.staff_id::text,
          responsible_name=v_actor.actor_name,
          updated_by=p_actor_id::text,
          updated_at=now(),
          notes=concat_ws(E'\n',d.notes,'نتيجة ملف الدكاترة: '||v_notes)
        where d.id=v_source_followup_id
          and d.branch=v_branch
          and (v_code is null or btrim(coalesce(d.customer_code,''))=v_code)
          and (coalesce(d.request_type,'') in ('exceptional_followup','doctor_requested_followup','طلب متابعة')
            or coalesce(d.request_source,'') in ('exceptional_followup','doctor_requested_followup'));
        if found then
          v_updated:=v_updated+1;
          if v_points<>0 and v_code is not null then perform public.mark_customer_points_contacted_v2(v_branch,v_code,v_actor.actor_name,p_actor_id); end if;
          continue;
        end if;
      end if;

      v_client_request_id:='smart-queue-v4:'||current_date::text||'|'||v_queue||'|'||v_branch||'|'||coalesce(v_code,lower(v_name),'');
      select d.id into v_existing from public.daily_followups d where d.client_request_id=v_client_request_id limit 1;
      if v_existing is not null then
        update public.daily_followups set
          status=v_status,followup_status=v_followup_status,contact_status=v_contact_status,
          response_status=case when v_responded then 'responded' else 'no_answer' end,
          contact_result=v_result,followup_result=v_result,followup_summary=v_summary,evaluation_summary=v_summary,
          purchase_after_followup=v_purchase,purchase_amount=nullif(v_purchase_amount,0),needs_next_followup=v_needs_next,
          next_followup_date=v_next_date,contacted_at=now(),first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),
          attempt_count=greatest(coalesce(attempt_count,0),1),completed_at=v_completed_at,closed_at=v_completed_at,
          open_case=v_completed_at is null,responsible_name=v_actor.actor_name,handled_by_staff_id=v_actor.staff_id::text,
          updated_by=p_actor_id::text,updated_at=now(),notes=concat('استيراد ملف: ',coalesce(p_file_name,'-'),' · ',v_notes)
        where id=v_existing;
        v_updated:=v_updated+1;
        if v_points<>0 and v_code is not null then perform public.mark_customer_points_contacted_v2(v_branch,v_code,v_actor.actor_name,p_actor_id); end if;
        continue;
      end if;

      insert into public.daily_followups(
        date,followup_date,customer_id,customer_name,name,customer_code,customer_phone,phone,branch,status,followup_status,contact_status,response_status,
        contact_result,followup_result,followup_summary,evaluation_summary,followup_type,request_type,request_source,followup_reason,request_details,notes,
        total_spent,last_purchase_date,purchase_after_followup,purchase_amount,needs_next_followup,next_followup_date,contacted_at,first_attempt_at,last_attempt_at,
        attempt_count,completed_at,closed_at,open_case,responsible_name,assigned_to,handled_by_staff_id,created_by,created_by_name,updated_by,client_request_id,data_quality_status,customer_metrics
      ) values(
        current_date::text,current_date::text,v_customer.id::text,v_name,v_name,v_code,v_phone,v_phone,v_branch,v_status,v_followup_status,v_contact_status,
        case when v_responded then 'responded' else 'no_answer' end,v_result,v_result,v_summary,v_summary,v_followup_type,'smart_queue_excel_import','customer_service_smart_queue_v4',v_reason,
        concat(case when v_invoice_amount>0 then 'قيمة الفاتورة: '||v_invoice_amount||'. ' else '' end,case when v_points<>0 then 'رصيد النقاط: '||v_points||'. ' else '' end),
        concat('استيراد ملف: ',coalesce(p_file_name,'-'),' · ',v_notes),coalesce(v_customer.total_spent,0),v_customer.last_purchase,v_purchase,nullif(v_purchase_amount,0),
        v_needs_next,v_next_date,now(),now(),now(),1,v_completed_at,v_completed_at,v_completed_at is null,v_actor.actor_name,v_actor.actor_name,v_actor.staff_id,p_actor_id::text,
        v_actor.actor_name,p_actor_id::text,v_client_request_id,'complete',jsonb_build_object('queue_type',v_queue,'invoice_amount',v_invoice_amount,'points_balance',v_points,'source','smart_queue_excel_v4')
      );
      if v_points<>0 and v_code is not null then perform public.mark_customer_points_contacted_v2(v_branch,v_code,v_actor.actor_name,p_actor_id); end if;
      v_imported:=v_imported+1;
    exception when others then
      v_skipped:=v_skipped+1;
    end;
  end loop;
  return jsonb_build_object('total',v_total,'imported',v_imported,'updated',v_updated,'duplicates',v_duplicates,'skipped',v_skipped);
end;
$function$;
