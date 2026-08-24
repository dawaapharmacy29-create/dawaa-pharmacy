begin;

create or replace function public.dawaa_create_or_link_customer_followup_v1(
  p_customer_id text default null, p_customer_code text default null, p_customer_name text default null,
  p_customer_phone text default null, p_branch text default null, p_request_type text default 'general',
  p_request_details text default null, p_followup_reason text default null, p_priority text default 'متوسطة',
  p_next_followup_date date default null, p_client_request_id text default null, p_source text default 'manual'
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; v_role text; v_branch text:=trim(coalesce(p_branch,''));
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  if nullif(trim(coalesce(p_customer_name,'')),'') is null then raise exception 'اسم العميل مطلوب'; end if;
  if v_branch not in ('فرع الشامي','فرع شكري') then raise exception 'فرع العميل غير صحيح'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
     and nullif(trim(coalesce(a.branch,'')),'') is distinct from v_branch then raise exception 'لا يمكن إنشاء متابعة خارج فرع الحساب'; end if;
  return public.find_or_create_open_customer_followup(p_customer_id,p_customer_code,trim(p_customer_name),p_customer_phone,v_branch,
    coalesce(nullif(trim(coalesce(p_request_type,'')),''),'general'),p_request_details,p_followup_reason,p_priority,p_next_followup_date,
    a.id::text,coalesce(a.name,a.username),coalesce(nullif(trim(coalesce(p_client_request_id,'')),''),'followup:'||gen_random_uuid()::text),
    coalesce(nullif(trim(coalesce(p_source,'')),''),'manual'));
end $$;

create or replace function public.dawaa_save_customer_followup_result_v1(
  p_followup_id text, p_status text, p_contact_status text, p_contact_result text, p_summary text,
  p_notes text default null, p_contact_method text default null, p_next_followup_date date default null,
  p_responsible_name text default null, p_request_type text default null, p_request_details text default null,
  p_request_status text default null, p_purchase_amount numeric default null, p_quality_rating integer default null,
  p_internal_rating numeric default null, p_customer_satisfaction text default null, p_purchase_invoice_no text default null
) returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; old_row public.daily_followups%rowtype; new_row public.daily_followups%rowtype; v_role text; v_final boolean;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false); v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  select * into old_row from public.daily_followups where id::text=p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
     and nullif(trim(coalesce(a.branch,'')),'') is distinct from nullif(trim(coalesce(old_row.branch,'')),'') then raise exception 'هذه المتابعة خارج نطاق فرع الحساب'; end if;
  if length(trim(coalesce(p_summary,'')))<3 or nullif(trim(coalesce(p_contact_result,'')),'') is null then raise exception 'نتيجة وملخص المتابعة مطلوبان'; end if;
  if p_purchase_amount is not null and p_purchase_amount<0 then raise exception 'قيمة الطلب غير صحيحة'; end if;
  v_final:=lower(trim(coalesce(p_status,''))) not in ('لم يرد','مؤجل','open','pending','متابعة مفتوحة');
  if not v_final and p_contact_result<>'الرقم غير صحيح' and p_next_followup_date is null then raise exception 'حدد موعد المتابعة القادمة'; end if;
  update public.daily_followups set status=trim(p_status),followup_status=trim(p_status),contact_status=nullif(trim(coalesce(p_contact_status,'')),''),
    contact_result=trim(p_contact_result),followup_result=trim(p_contact_result),followup_summary=trim(p_summary),notes=nullif(trim(coalesce(p_notes,'')),''),
    contact_method=nullif(trim(coalesce(p_contact_method,'')),''),next_followup_date=p_next_followup_date,responsible_name=coalesce(nullif(trim(coalesce(p_responsible_name,'')),''),responsible_name),
    request_type=nullif(trim(coalesce(p_request_type,'')),''),request_details=nullif(trim(coalesce(p_request_details,'')),''),request_status=nullif(trim(coalesce(p_request_status,'')),''),
    purchase_after_followup=p_purchase_amount is not null,purchase_amount=p_purchase_amount,quality_rating=p_quality_rating,internal_rating=p_internal_rating,
    customer_satisfaction=nullif(trim(coalesce(p_customer_satisfaction,'')),''),purchase_invoice_no=nullif(trim(coalesce(p_purchase_invoice_no,'')),''),
    evaluated_by=a.id::text,evaluated_by_name=coalesce(a.name,a.username),evaluated_at=now(),contacted_at=now(),closed_at=case when v_final then now() else null end,
    completed_at=case when v_final then coalesce(completed_at,now()) else null end,open_case=not v_final,needs_next_followup=not v_final,
    updated_at=now(),updated_by=a.id::text where id::text=p_followup_id returning * into new_row;
  insert into public.customer_followup_audit_log(followup_id,customer_id,action,actor_staff_id,actor_name,branch,metadata)
  values(new_row.id::text,new_row.customer_id::text,'result_saved',a.id::text,coalesce(a.name,a.username),new_row.branch,
    jsonb_strip_nulls(jsonb_build_object('old_status',coalesce(old_row.followup_status,old_row.status),'new_status',coalesce(new_row.followup_status,new_row.status),'result',p_contact_result,'next_followup_date',p_next_followup_date,'purchase_amount',p_purchase_amount)));
  return new_row;
end $$;

create or replace function public.dawaa_archive_today_trial_followups_v1()
returns integer language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; v_count integer;
begin
  a:=public.dawaa_require_customer_service_actor_v1(true);
  with archived as (
    update public.daily_followups set is_hidden=true,archived_at=now(),archived_by=a.id::text,archive_reason='تنظيف المتابعات التجريبية اليومية',updated_at=now(),updated_by=a.id::text
    where coalesce(is_hidden,false)=false and (coalesce(nullif(followup_date,''),nullif(date,''),created_at::date::text)::date=(now() at time zone 'Africa/Cairo')::date)
      and (coalesce(notes,'') ilike any(array['%قائمة يومية ذكية%','%تجريبي%','%trial%','%daily smart%']) or coalesce(followup_type,'') ilike any(array['%تجريبي%','%trial%','%daily smart%']))
    returning id
  ) select count(*) into v_count from archived;
  return v_count;
end $$;

revoke all on function public.create_or_link_customer_followup(jsonb) from public,anon,authenticated;
revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public,anon,authenticated;
revoke all on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) from public,anon;
revoke all on function public.dawaa_save_customer_followup_result_v1(text,text,text,text,text,text,text,date,text,text,text,text,numeric,integer,numeric,text,text) from public,anon;
revoke all on function public.dawaa_archive_today_trial_followups_v1() from public,anon;
grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to authenticated;
grant execute on function public.dawaa_save_customer_followup_result_v1(text,text,text,text,text,text,text,date,text,text,text,text,numeric,integer,numeric,text,text) to authenticated;
grant execute on function public.dawaa_archive_today_trial_followups_v1() to authenticated;

commit;
