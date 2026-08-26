create or replace function public.calculate_customer_cashback_cycle_for_branch_v1(
  p_cycle_start date,
  p_cycle_end date,
  p_branch text
)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_count integer := 0;
  v_start date := p_cycle_start;
  v_end date := p_cycle_end;
begin
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end < p_cycle_start then
    raise exception 'فترة احتساب الكاش باك غير صحيحة';
  end if;
  if nullif(trim(p_branch),'') is null then
    raise exception 'لازم تحدد الفرع قبل احتساب الكاش باك';
  end if;
  if not public.dawaa_can_access_customer_points_branch_v1(p_branch, true) then
    raise insufficient_privilege using message = 'غير مصرح باحتساب نقاط هذا الفرع';
  end if;
  if p_branch='فرع الشامي' and p_cycle_start in (date '2026-04-01',date '2026-05-01') and p_cycle_end in (date '2026-07-30',date '2026-07-31') then
    v_start:=date '2026-04-01'; v_end:=date '2026-07-31';
  end if;

  with invoice_base as (
    select nullif(trim(si.customer_code),'') customer_code,
      max(nullif(trim(coalesce(si.customer_name,si.name)),'')) customer_name,
      max(nullif(trim(coalesce(si.customer_phone,si.phone,si.whatsapp_phone)),'')) customer_phone,
      p_branch branch,count(*)::integer invoices_count,
      round(sum(coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0))::numeric,2) total_spent
    from public.dawaa_customer_sales_analytics_v1 si
    where nullif(trim(si.customer_code),'') is not null
      and coalesce(si.sale_date,si.invoice_date::date,si.invoice_datetime::date) between v_start and v_end
      and coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0)>0
      and nullif(trim(coalesce(si.branch_name,si.branch)),'')=p_branch
    group by nullif(trim(si.customer_code),'')
  ), calculated as (
    select b.customer_code,coalesce(a.customer_name,b.customer_name) customer_name,coalesce(a.customer_phone,b.customer_phone) customer_phone,
      b.branch,b.invoices_count,b.total_spent,
      case when coalesce(a.cashback_enabled,true) then coalesce(a.cashback_rate,5) else 0 end::numeric cashback_rate,
      case when coalesce(a.cashback_enabled,true) then round((b.total_spent*coalesce(a.cashback_rate,5)/100*coalesce(a.cashback_multiplier,1))+coalesce(a.voucher_value,0),2) else 0 end cashback_value,
      coalesce(a.voucher_value,0)::numeric voucher_value
    from invoice_base b
    left join lateral (
      select ca.* from public.customer_cashback_accounts ca
      where ca.customer_code=b.customer_code and (ca.branch=b.branch or ca.branch is null)
      order by (ca.branch=b.branch) desc,ca.updated_at desc limit 1
    ) a on true
  ), upserted as (
    insert into public.customer_cashback_cycles(customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,cashback_rate,total_spent,total_purchases,invoices_count,cashback_value,cashback_amount,voucher_value,remaining_value,status,calculated_at,updated_at)
    select c.customer_code,c.customer_name,c.customer_phone,c.branch,to_char(v_start,'YYYY-MM-DD')||' → '||to_char(v_end,'YYYY-MM-DD'),v_start,v_end,c.cashback_rate,c.total_spent,c.total_spent,c.invoices_count,c.cashback_value,c.cashback_value,c.voucher_value,greatest(0,c.cashback_value),'calculated',now(),now()
    from calculated c
    on conflict(branch,customer_code,cycle_start,cycle_end) do update set
      customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,cycle_label=excluded.cycle_label,
      cashback_rate=excluded.cashback_rate,total_spent=excluded.total_spent,total_purchases=excluded.total_purchases,
      invoices_count=excluded.invoices_count,cashback_value=excluded.cashback_value,cashback_amount=excluded.cashback_amount,
      voucher_value=excluded.voucher_value,remaining_value=greatest(0,excluded.cashback_value-coalesce(customer_cashback_cycles.redeemed_value,0)),
      status=customer_cashback_cycles.status,notified_at=customer_cashback_cycles.notified_at,bconnect_updated_at=customer_cashback_cycles.bconnect_updated_at,
      partially_redeemed_at=customer_cashback_cycles.partially_redeemed_at,settled_at=customer_cashback_cycles.settled_at,notes=customer_cashback_cycles.notes,
      calculated_at=now(),updated_at=now()
    returning 1
  ) select count(*) into v_count from upserted;
  return v_count;
end;
$function$;

create or replace function public.dawaa_customer_cashback_action_v1(
  p_cycle_id uuid,
  p_action text,
  p_amount numeric default null,
  p_expected_redeemed numeric default null,
  p_note text default null
)
returns public.customer_cashback_cycles
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts;
  v_row public.customer_cashback_cycles%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_remaining numeric;
  v_new_redeemed numeric;
  v_event_type text;
  v_event_amount numeric;
  v_changed boolean := false;
begin
  select * into v_actor
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true
  limit 1;
  if not found then raise insufficient_privilege using message='يجب تسجيل الدخول بحساب موظف نشط'; end if;

  select * into v_row
  from public.customer_cashback_cycles
  where id=p_cycle_id
  for update;
  if not found then raise exception 'سجل نقاط العميل غير موجود'; end if;

  if not public.dawaa_can_access_customer_points_branch_v1(v_row.branch,true) then
    raise insufficient_privilege using message='غير مصرح بتعديل نقاط هذا الفرع';
  end if;

  if v_action='notify' then
    if v_row.notified_at is null then
      update public.customer_cashback_cycles c
      set notified_at=now(),
          status=case when coalesce(c.status,'calculated') in ('settled','partially_redeemed','bconnect_updated') then c.status else 'notified' end,
          updated_at=now()
      where c.id=p_cycle_id returning * into v_row;
      v_event_type:='notified'; v_changed:=true;
    end if;
  elsif v_action='bconnect' then
    if v_row.bconnect_updated_at is null then
      update public.customer_cashback_cycles c
      set notified_at=coalesce(c.notified_at,now()),
          bconnect_updated_at=now(),
          status=case when coalesce(c.status,'calculated') in ('settled','partially_redeemed') then c.status else 'bconnect_updated' end,
          updated_at=now()
      where c.id=p_cycle_id returning * into v_row;
      v_event_type:='bconnect_updated'; v_changed:=true;
    end if;
  elsif v_action='redeem' then
    if p_amount is null or p_amount <= 0 then raise exception 'قيمة السحب غير صحيحة'; end if;
    if p_expected_redeemed is null then raise exception 'حدث الرصيد أولاً قبل تنفيذ السحب'; end if;
    if abs(coalesce(v_row.redeemed_value,0)-p_expected_redeemed) > 0.009 then
      raise exception 'تم تحديث رصيد العميل بالفعل، اعمل تحديث وحاول تاني';
    end if;
    v_remaining:=greatest(0,coalesce(v_row.cashback_value,0)-coalesce(v_row.redeemed_value,0));
    if p_amount > v_remaining + 0.009 then raise exception 'قيمة السحب أكبر من المتبقي الحالي'; end if;
    v_new_redeemed:=round(coalesce(v_row.redeemed_value,0)+p_amount,2);
    update public.customer_cashback_cycles c
    set redeemed_value=v_new_redeemed,
        partially_redeemed_at=coalesce(c.partially_redeemed_at,now()),
        status=case when v_new_redeemed >= coalesce(c.cashback_value,0)-0.009 then 'settled' else 'partially_redeemed' end,
        settled_at=case when v_new_redeemed >= coalesce(c.cashback_value,0)-0.009 then coalesce(c.settled_at,now()) else c.settled_at end,
        updated_at=now()
    where c.id=p_cycle_id returning * into v_row;
    v_event_type:=case when v_row.status='settled' then 'settled' else 'partially_redeemed' end;
    v_event_amount:=p_amount; v_changed:=true;
  else
    raise exception 'إجراء نقاط العميل غير مدعوم';
  end if;

  if v_changed then
    insert into public.customer_cashback_events(
      cashback_cycle_id,cycle_id,customer_code,customer_name,event_type,value,amount,note,notes,created_by,created_by_name
    ) values (
      v_row.id,v_row.id,v_row.customer_code,v_row.customer_name,v_event_type,v_event_amount,v_event_amount,
      nullif(trim(coalesce(p_note,'')),''),nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username)
    );
  end if;
  return v_row;
end;
$function$;

revoke all on function public.calculate_customer_cashback_cycle_for_branch_v1(date,date,text) from public;
grant execute on function public.calculate_customer_cashback_cycle_for_branch_v1(date,date,text) to anon,authenticated,service_role;
revoke all on function public.dawaa_customer_cashback_action_v1(uuid,text,numeric,numeric,text) from public;
grant execute on function public.dawaa_customer_cashback_action_v1(uuid,text,numeric,numeric,text) to anon,authenticated,service_role;

grant execute on function public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric,text,text,boolean,text,text) to anon,authenticated,service_role;
grant execute on function public.dawaa_save_customer_followup_result_v1(text,text,text,text,text,text,text,date,text,text,text,text,numeric,integer,numeric,text,text) to anon,authenticated,service_role;
grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to anon,authenticated,service_role;
grant execute on function public.dawaa_append_customer_service_followup_event_v1(text,uuid,text,text,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.dawaa_log_customer_followup_event_v1(text,text,text,text,text,jsonb,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
