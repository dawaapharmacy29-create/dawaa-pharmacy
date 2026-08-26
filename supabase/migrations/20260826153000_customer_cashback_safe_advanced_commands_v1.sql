create or replace function public.dawaa_customer_cashback_manual_upsert_v1(
  p_branch text,
  p_cycle_start date,
  p_cycle_end date,
  p_customer_code text,
  p_customer_name text,
  p_customer_phone text,
  p_total_spent numeric,
  p_rate numeric,
  p_note text default null
) returns public.customer_cashback_cycles
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts;
  v_period public.customer_cashback_periods%rowtype;
  v_row public.customer_cashback_cycles%rowtype;
  v_cashback numeric;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false) limit 1;
  if not found then raise insufficient_privilege using message='يجب تسجيل الدخول بحساب موظف نشط'; end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null then raise exception 'الفرع مطلوب'; end if;
  if not public.dawaa_can_access_customer_points_branch_v1(p_branch,true) then
    raise insufficient_privilege using message='غير مصرح بتعديل نقاط هذا الفرع';
  end if;
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end<p_cycle_start then raise exception 'فترة الدورة غير صحيحة'; end if;
  if nullif(trim(coalesce(p_customer_code,'')),'') is null then raise exception 'كود العميل مطلوب'; end if;
  if p_total_spent is null or p_total_spent<0 then raise exception 'إجمالي المشتريات غير صحيح'; end if;
  if p_rate not in (3,5) then raise exception 'النسبة لازم تكون 3 أو 5'; end if;

  select * into v_period from public.customer_cashback_periods
  where branch=trim(p_branch) and period_start=p_cycle_start and period_end=p_cycle_end
    and period_type='official' and status='open'
  for update;
  if not found then raise exception 'لا توجد دورة رسمية مفتوحة مطابقة لهذا الفرع والفترة'; end if;

  v_cashback:=round(p_total_spent*p_rate/100,2);
  select * into v_row from public.customer_cashback_cycles
  where branch=trim(p_branch) and customer_code=trim(p_customer_code)
    and cycle_start=p_cycle_start and cycle_end=p_cycle_end
  for update;

  if found then
    if v_cashback+0.009 < coalesce(v_row.redeemed_value,0) then
      raise exception 'القيمة الجديدة أقل من المبلغ المسحوب بالفعل';
    end if;
    update public.customer_cashback_cycles
    set customer_name=coalesce(nullif(trim(p_customer_name),''),customer_name),
        customer_phone=coalesce(nullif(trim(p_customer_phone),''),customer_phone),
        total_spent=round(p_total_spent,2), total_purchases=round(p_total_spent,2),
        cashback_rate=p_rate, cashback_value=v_cashback, cashback_amount=v_cashback,
        period_id=v_period.id,
        notes=concat_ws(E'\n',nullif(notes,''),coalesce(nullif(trim(p_note),''),'تعديل يدوي آمن من أدوات نقاط العملاء')),
        updated_at=now()
    where id=v_row.id returning * into v_row;
  else
    insert into public.customer_cashback_cycles(
      customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,
      cashback_rate,total_spent,total_purchases,cashback_value,cashback_amount,redeemed_value,
      remaining_value,status,period_id,notes,calculated_at,updated_at
    ) values(
      trim(p_customer_code),nullif(trim(p_customer_name),''),nullif(trim(p_customer_phone),''),trim(p_branch),
      to_char(p_cycle_start,'YYYY-MM-DD')||' → '||to_char(p_cycle_end,'YYYY-MM-DD'),p_cycle_start,p_cycle_end,
      p_rate,round(p_total_spent,2),round(p_total_spent,2),v_cashback,v_cashback,0,v_cashback,'calculated',v_period.id,
      coalesce(nullif(trim(p_note),''),'إضافة يدوية آمنة من أدوات نقاط العملاء'),now(),now()
    ) returning * into v_row;
  end if;

  insert into public.customer_cashback_events(
    cashback_cycle_id,cycle_id,customer_code,customer_name,event_type,value,amount,note,notes,created_by,created_by_name
  ) values(
    v_row.id,v_row.id,v_row.customer_code,v_row.customer_name,'manual_upsert',v_cashback,v_cashback,
    nullif(trim(coalesce(p_note,'')),''),nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username)
  );
  perform public.dawaa_refresh_customer_cashback_period_totals_v1(v_period.id);
  return v_row;
end;
$$;

create or replace function public.dawaa_customer_cashback_import_batch_v1(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts;
  v_item jsonb;
  v_id uuid;
  v_row public.customer_cashback_cycles%rowtype;
  v_target_status text;
  v_target_redeemed numeric;
  v_note text;
  v_delta numeric;
  v_count int:=0;
  v_errors jsonb:='[]'::jsonb;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false) limit 1;
  if not found then raise insufficient_privilege using message='يجب تسجيل الدخول بحساب موظف نشط'; end if;
  if jsonb_typeof(p_changes)<>'array' then raise exception 'صيغة الاستيراد غير صحيحة'; end if;
  if jsonb_array_length(p_changes)>500 then raise exception 'الحد الأقصى 500 صف في الدفعة'; end if;

  for v_item in select value from jsonb_array_elements(p_changes)
  loop
    begin
      v_id:=nullif(v_item->>'id','')::uuid;
      if v_id is null then raise exception 'معرف السجل مفقود'; end if;
      select * into v_row from public.customer_cashback_cycles where id=v_id for update;
      if not found then raise exception 'سجل العميل غير موجود'; end if;
      if not public.dawaa_can_access_customer_points_branch_v1(v_row.branch,true) then
        raise insufficient_privilege using message='غير مصرح بتعديل هذا الفرع';
      end if;

      v_target_status:=lower(trim(coalesce(v_item->>'status',v_row.status,'calculated')));
      v_target_redeemed:=coalesce(nullif(v_item->>'redeemed_value','')::numeric,coalesce(v_row.redeemed_value,0));
      v_note:=nullif(trim(coalesce(v_item->>'notes','')),'');
      if v_target_redeemed < coalesce(v_row.redeemed_value,0)-0.009 then raise exception 'لا يمكن تقليل المبلغ المسحوب'; end if;
      if v_target_redeemed > coalesce(v_row.cashback_value,0)+0.009 then raise exception 'المبلغ المسحوب أكبر من الاستحقاق'; end if;

      if v_target_status in ('notified','bconnect_updated','partially_redeemed','settled') and v_row.notified_at is null then
        perform public.dawaa_customer_cashback_action_v1(v_row.id,'notify',null,null,'استيراد Excel');
        select * into v_row from public.customer_cashback_cycles where id=v_row.id for update;
      end if;
      if v_target_status='bconnect_updated' and v_row.bconnect_updated_at is null then
        perform public.dawaa_customer_cashback_action_v1(v_row.id,'bconnect',null,null,'استيراد Excel');
        select * into v_row from public.customer_cashback_cycles where id=v_row.id for update;
      end if;

      v_delta:=round(v_target_redeemed-coalesce(v_row.redeemed_value,0),2);
      if v_delta>0 then
        perform public.dawaa_customer_cashback_action_v1(v_row.id,'redeem',v_delta,coalesce(v_row.redeemed_value,0),'استيراد Excel');
        select * into v_row from public.customer_cashback_cycles where id=v_row.id for update;
      end if;
      if v_target_status='settled' and coalesce(v_row.redeemed_value,0) < coalesce(v_row.cashback_value,0)-0.009 then
        raise exception 'لا يمكن تعليم السجل كتسوية كاملة قبل سحب كامل الاستحقاق';
      end if;
      if v_note is not null then
        update public.customer_cashback_cycles
        set notes=concat_ws(E'\n',nullif(notes,''),v_note),updated_at=now()
        where id=v_row.id;
        insert into public.customer_cashback_events(
          cashback_cycle_id,cycle_id,customer_code,customer_name,event_type,note,notes,created_by,created_by_name
        ) values(v_row.id,v_row.id,v_row.customer_code,v_row.customer_name,'import_note',v_note,v_note,v_actor.id,coalesce(v_actor.name,v_actor.username));
      end if;
      v_count:=v_count+1;
    exception when others then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object('id',coalesce(v_item->>'id',''),'error',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('updated',v_count,'errors',v_errors);
end;
$$;

revoke all on function public.dawaa_customer_cashback_manual_upsert_v1(text,date,date,text,text,text,numeric,numeric,text) from public;
revoke all on function public.dawaa_customer_cashback_import_batch_v1(jsonb) from public;
grant execute on function public.dawaa_customer_cashback_manual_upsert_v1(text,date,date,text,text,text,numeric,numeric,text) to anon,authenticated,service_role;
grant execute on function public.dawaa_customer_cashback_import_batch_v1(jsonb) to anon,authenticated,service_role;