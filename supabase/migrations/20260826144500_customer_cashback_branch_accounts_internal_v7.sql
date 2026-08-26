-- Customer cashback stability v7
-- 1) branch-aware account identity
-- 2) system-only calculator for cron
-- 3) guarded UI wrapper
-- 4) live period totals after financial actions
-- 5) branch-scoped health monitor and admin setting command

alter table public.customer_cashback_accounts
  drop constraint if exists uq_customer_cashback_accounts_customer_code_safe;

alter table public.customer_cashback_accounts
  add constraint uq_customer_cashback_accounts_branch_code
  unique nulls not distinct (branch, customer_code);

create or replace function public.dawaa_refresh_customer_cashback_period_totals_v1(p_period_id uuid)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if p_period_id is null then return; end if;
  update public.customer_cashback_periods p set
    customers_count=x.customers_count,total_purchases=x.total_purchases,total_cashback=x.total_cashback,
    total_redeemed=x.total_redeemed,total_remaining=x.total_remaining,updated_at=now()
  from (
    select count(*)::int customers_count,round(coalesce(sum(total_spent),0),2) total_purchases,
      round(coalesce(sum(cashback_value),0),2) total_cashback,round(coalesce(sum(redeemed_value),0),2) total_redeemed,
      round(coalesce(sum(greatest(0,coalesce(cashback_value,0)-coalesce(redeemed_value,0))),0),2) total_remaining
    from public.customer_cashback_cycles where period_id=p_period_id
  ) x where p.id=p_period_id;
end $$;
revoke all on function public.dawaa_refresh_customer_cashback_period_totals_v1(uuid) from public,anon,authenticated;
grant execute on function public.dawaa_refresh_customer_cashback_period_totals_v1(uuid) to service_role;

create or replace function public.dawaa_calculate_customer_cashback_cycle_for_branch_internal_v2(p_cycle_start date,p_cycle_end date,p_branch text)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_count integer:=0;
begin
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end<p_cycle_start then raise exception 'فترة احتساب الكاش باك غير صحيحة'; end if;
  if nullif(trim(p_branch),'') is null then raise exception 'الفرع مطلوب'; end if;
  with invoice_base as (
    select nullif(trim(si.customer_code),'') customer_code,
      max(nullif(trim(coalesce(si.customer_name,si.name)),'')) customer_name,
      max(nullif(trim(coalesce(si.customer_phone,si.phone,si.whatsapp_phone)),'')) customer_phone,
      trim(p_branch) branch,count(*)::integer invoices_count,
      round(sum(coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0))::numeric,2) total_spent
    from public.dawaa_customer_sales_analytics_v1 si
    where nullif(trim(si.customer_code),'') is not null
      and coalesce(si.sale_date,si.invoice_date::date,si.invoice_datetime::date) between p_cycle_start and p_cycle_end
      and coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0)>0
      and nullif(trim(coalesce(si.branch_name,si.branch)),'')=trim(p_branch)
    group by nullif(trim(si.customer_code),'')
  ), calculated as (
    select b.customer_code,coalesce(a.customer_name,b.customer_name) customer_name,coalesce(a.customer_phone,b.customer_phone) customer_phone,
      b.branch,b.invoices_count,b.total_spent,
      case when coalesce(a.cashback_enabled,true) then coalesce(a.cashback_rate,5) else 0 end::numeric cashback_rate,
      case when coalesce(a.cashback_enabled,true) then round((b.total_spent*coalesce(a.cashback_rate,5)/100*coalesce(a.cashback_multiplier,1))+coalesce(a.voucher_value,0),2) else 0 end cashback_value,
      coalesce(a.voucher_value,0)::numeric voucher_value
    from invoice_base b left join lateral (
      select ca.* from public.customer_cashback_accounts ca
      where ca.customer_code=b.customer_code and (ca.branch=b.branch or ca.branch is null)
      order by (ca.branch=b.branch) desc,ca.updated_at desc limit 1
    ) a on true
  ), upserted as (
    insert into public.customer_cashback_cycles(customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,cashback_rate,total_spent,total_purchases,invoices_count,cashback_value,cashback_amount,voucher_value,remaining_value,status,calculated_at,updated_at)
    select c.customer_code,c.customer_name,c.customer_phone,c.branch,to_char(p_cycle_start,'YYYY-MM-DD')||' → '||to_char(p_cycle_end,'YYYY-MM-DD'),p_cycle_start,p_cycle_end,c.cashback_rate,c.total_spent,c.total_spent,c.invoices_count,c.cashback_value,c.cashback_value,c.voucher_value,greatest(0,c.cashback_value),'calculated',now(),now() from calculated c
    on conflict(branch,customer_code,cycle_start,cycle_end) do update set
      customer_name=excluded.customer_name,customer_phone=coalesce(excluded.customer_phone,customer_cashback_cycles.customer_phone),cycle_label=excluded.cycle_label,
      cashback_rate=excluded.cashback_rate,total_spent=excluded.total_spent,total_purchases=excluded.total_purchases,invoices_count=excluded.invoices_count,
      cashback_value=excluded.cashback_value,cashback_amount=excluded.cashback_amount,voucher_value=excluded.voucher_value,
      remaining_value=greatest(0,excluded.cashback_value-coalesce(customer_cashback_cycles.redeemed_value,0)),status=customer_cashback_cycles.status,
      notified_at=customer_cashback_cycles.notified_at,bconnect_updated_at=customer_cashback_cycles.bconnect_updated_at,
      partially_redeemed_at=customer_cashback_cycles.partially_redeemed_at,settled_at=customer_cashback_cycles.settled_at,notes=customer_cashback_cycles.notes,
      calculated_at=now(),updated_at=now() returning 1
  ) select count(*) into v_count from upserted;
  return v_count;
end $$;
revoke all on function public.dawaa_calculate_customer_cashback_cycle_for_branch_internal_v2(date,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_calculate_customer_cashback_cycle_for_branch_internal_v2(date,date,text) to service_role;

create or replace function public.calculate_customer_cashback_cycle_for_branch_v1(p_cycle_start date,p_cycle_end date,p_branch text)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_start date:=p_cycle_start;v_end date:=p_cycle_end;
begin
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end<p_cycle_start then raise exception 'فترة احتساب الكاش باك غير صحيحة'; end if;
  if nullif(trim(p_branch),'') is null then raise exception 'لازم تحدد الفرع قبل احتساب الكاش باك'; end if;
  if not public.dawaa_can_access_customer_points_branch_v1(p_branch,true) then raise insufficient_privilege using message='غير مصرح باحتساب نقاط هذا الفرع'; end if;
  if p_branch='فرع الشامي' and p_cycle_start in (date '2026-04-01',date '2026-05-01') and p_cycle_end in (date '2026-07-30',date '2026-07-31') then v_start:=date '2026-04-01';v_end:=date '2026-07-31'; end if;
  return public.dawaa_calculate_customer_cashback_cycle_for_branch_internal_v2(v_start,v_end,p_branch);
end $$;

create or replace function public.calculate_customer_cashback_cycle_for_branch(p_branch text,p_cycle_start date,p_cycle_end date)
returns integer language sql security definer set search_path=public,pg_catalog as $$
  select public.calculate_customer_cashback_cycle_for_branch_v1(p_cycle_start,p_cycle_end,p_branch)
$$;

create or replace function public.dawaa_refresh_customer_cashback_period_v3(p_branch text,p_period_start date,p_period_end date,p_actor_name text default 'النظام (تلقائي)')
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_start date:=p_period_start;v_end date:=p_period_end;v_period_id uuid;v_count int;
begin
  if nullif(trim(p_branch),'') is null or p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'بيانات دورة الكاش باك غير صحيحة'; end if;
  if p_branch='فرع الشامي' and p_period_start in (date '2026-04-01',date '2026-05-01') and p_period_end in (date '2026-07-30',date '2026-07-31') then v_start:=date '2026-04-01';v_end:=date '2026-07-31'; end if;
  insert into public.customer_cashback_periods(branch,period_start,period_end,label,status,calculation_version,updated_at)
  values(p_branch,v_start,v_end,to_char(v_start,'YYYY-MM-DD')||' → '||to_char(v_end,'YYYY-MM-DD'),'calculating','cashback_snapshot_v7',now())
  on conflict(branch,period_start,period_end) do update set status='calculating',last_error=null,updated_at=now() returning id into v_period_id;
  begin
    v_count:=public.dawaa_calculate_customer_cashback_cycle_for_branch_internal_v2(v_start,v_end,p_branch);
    update public.customer_cashback_cycles set period_id=v_period_id,updated_at=now() where branch=p_branch and cycle_start=v_start and cycle_end=v_end;
    perform public.dawaa_refresh_customer_cashback_period_totals_v1(v_period_id);
    update public.customer_cashback_periods set status='open',calculated_at=now(),last_error=null,calculation_version='cashback_snapshot_v7',updated_at=now() where id=v_period_id;
  exception when others then
    update public.customer_cashback_periods set status='failed',last_error=sqlerrm,updated_at=now() where id=v_period_id; raise;
  end;
  return jsonb_build_object('period_id',v_period_id,'branch',p_branch,'period_start',v_start,'period_end',v_end,'customers_count',v_count,'status','open');
end $$;

revoke execute on function public.calculate_customer_cashback_cycle(date,date) from anon,authenticated;
revoke execute on function public.calculate_customer_cashback_cycle_v6(date,date) from anon,authenticated;
revoke execute on function public.set_customer_cashback_rate_v2(text,numeric) from anon,authenticated;

create or replace function public.dawaa_customer_cashback_health_v1(p_branch text default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_actor uuid;v_allowed text[];v_rows jsonb;v_critical int;v_warning int;
begin
  v_actor:=public.dawaa_current_staff_account_id_strict(); if v_actor is null then raise insufficient_privilege using message='يجب تسجيل الدخول'; end if;
  v_allowed:=public.dawaa_customer_points_allowed_branches_v1(false);
  if p_branch is not null and not (trim(p_branch)=any(v_allowed)) then raise insufficient_privilege using message='غير مصرح بقراءة نقاط هذا الفرع'; end if;
  with periods as (
    select p.* from public.customer_cashback_periods p where p.period_type='official' and p.status='open' and p.branch=any(v_allowed) and (p_branch is null or p.branch=trim(p_branch))
  ), stats as (
    select p.id,p.branch,p.period_start,p.period_end,p.calculation_version,p.customers_count header_customers,p.total_purchases header_purchases,p.total_cashback header_cashback,p.total_redeemed header_redeemed,p.total_remaining header_remaining,
      count(c.*)::int actual_customers,round(coalesce(sum(c.total_spent),0),2) actual_purchases,round(coalesce(sum(c.cashback_value),0),2) actual_cashback,
      round(coalesce(sum(c.redeemed_value),0),2) actual_redeemed,round(coalesce(sum(greatest(0,coalesce(c.cashback_value,0)-coalesce(c.redeemed_value,0))),0),2) actual_remaining,
      count(*) filter(where nullif(trim(coalesce(c.customer_code,'')),'') is null)::int missing_code,
      count(*) filter(where coalesce(c.redeemed_value,0)>coalesce(c.cashback_value,0)+0.009)::int over_redeemed,
      count(*) filter(where abs(coalesce(c.remaining_value,0)-greatest(0,coalesce(c.cashback_value,0)-coalesce(c.redeemed_value,0)))>0.009)::int bad_remaining,
      count(*) filter(where c.period_id is distinct from p.id)::int wrong_period_links
    from periods p left join public.customer_cashback_cycles c on c.branch=p.branch and c.cycle_start=p.period_start and c.cycle_end=p.period_end
    group by p.id,p.branch,p.period_start,p.period_end,p.calculation_version,p.customers_count,p.total_purchases,p.total_cashback,p.total_redeemed,p.total_remaining
  ), dup as (
    select branch,cycle_start,cycle_end,count(*)::int duplicate_groups from (
      select c.branch,c.cycle_start,c.cycle_end,c.customer_code from public.customer_cashback_cycles c join periods p on p.branch=c.branch and p.period_start=c.cycle_start and p.period_end=c.cycle_end
      where nullif(trim(coalesce(c.customer_code,'')),'') is not null group by c.branch,c.cycle_start,c.cycle_end,c.customer_code having count(*)>1
    ) q group by branch,cycle_start,cycle_end
  ), final as (
    select s.*,coalesce(d.duplicate_groups,0) duplicate_groups,
      (s.header_customers is distinct from s.actual_customers or abs(coalesce(s.header_purchases,0)-s.actual_purchases)>0.009 or abs(coalesce(s.header_cashback,0)-s.actual_cashback)>0.009 or abs(coalesce(s.header_redeemed,0)-s.actual_redeemed)>0.009 or abs(coalesce(s.header_remaining,0)-s.actual_remaining)>0.009) header_mismatch
    from stats s left join dup d on d.branch=s.branch and d.cycle_start=s.period_start and d.cycle_end=s.period_end
  )
  select coalesce(jsonb_agg(jsonb_build_object('branch',branch,'period_start',period_start,'period_end',period_end,'calculation_version',calculation_version,'customers',actual_customers,'total_purchases',actual_purchases,'total_cashback',actual_cashback,'total_redeemed',actual_redeemed,'total_remaining',actual_remaining,'duplicate_groups',duplicate_groups,'missing_code',missing_code,'over_redeemed_legacy',over_redeemed,'bad_remaining',bad_remaining,'wrong_period_links',wrong_period_links,'header_mismatch',header_mismatch,'status',case when duplicate_groups>0 or missing_code>0 or bad_remaining>0 or wrong_period_links>0 or header_mismatch then 'critical' when over_redeemed>0 then 'warning' else 'healthy' end) order by branch),'[]'::jsonb),
    count(*) filter(where duplicate_groups>0 or missing_code>0 or bad_remaining>0 or wrong_period_links>0 or header_mismatch)::int,
    count(*) filter(where over_redeemed>0)::int into v_rows,v_critical,v_warning from final;
  return jsonb_build_object('status',case when v_critical>0 then 'critical' when v_warning>0 then 'warning' else 'healthy' end,'branches',v_rows,'generated_at',now());
end $$;
revoke all on function public.dawaa_customer_cashback_health_v1(text) from public;
grant execute on function public.dawaa_customer_cashback_health_v1(text) to anon,authenticated,service_role;

-- Admin account actions are branch guarded and recalculate the current snapshot atomically.
create or replace function public.dawaa_customer_cashback_account_action_v1(p_cycle_id uuid,p_action text,p_value numeric,p_note text default null)
returns public.customer_cashback_cycles language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts;v_row public.customer_cashback_cycles%rowtype;v_account public.customer_cashback_accounts%rowtype;v_action text:=lower(trim(coalesce(p_action,'')));v_rate numeric;v_multiplier numeric;v_voucher numeric;v_new_cashback numeric;v_event text;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false) limit 1;
  if not found then raise insufficient_privilege using message='يجب تسجيل الدخول بحساب موظف نشط'; end if;
  select * into v_row from public.customer_cashback_cycles where id=p_cycle_id for update; if not found then raise exception 'سجل نقاط العميل غير موجود'; end if;
  if not public.dawaa_can_access_customer_points_branch_v1(v_row.branch,true) then raise insufficient_privilege using message='غير مصرح بتعديل إعدادات هذا الفرع'; end if;
  if nullif(trim(coalesce(v_row.customer_code,'')),'') is null then raise exception 'كود العميل مطلوب'; end if;
  select * into v_account from public.customer_cashback_accounts where customer_code=v_row.customer_code and branch=v_row.branch for update;
  if not found then
    insert into public.customer_cashback_accounts(customer_id,customer_code,customer_name,customer_phone,branch,cashback_rate,cashback_enabled,cashback_multiplier,voucher_value,updated_at)
    values(v_row.customer_id,v_row.customer_code,v_row.customer_name,v_row.customer_phone,v_row.branch,coalesce(v_row.cashback_rate,5),true,1,coalesce(v_row.voucher_value,0),now()) returning * into v_account;
  end if;
  v_rate:=coalesce(v_account.cashback_rate,coalesce(v_row.cashback_rate,5));v_multiplier:=coalesce(v_account.cashback_multiplier,1);v_voucher:=coalesce(v_account.voucher_value,0);
  if v_action='set_rate' then if p_value not in (3,5) then raise exception 'النسبة لازم تكون 3 أو 5'; end if;v_rate:=p_value;v_event:='rate_changed';
  elsif v_action='set_multiplier' then if p_value is null or p_value<1 or p_value>5 then raise exception 'المضاعف لازم يكون من 1 إلى 5'; end if;v_multiplier:=p_value;v_event:='multiplier_changed';
  elsif v_action='add_voucher' then if p_value is null or p_value<=0 then raise exception 'قيمة الفاوتشر غير صحيحة'; end if;v_voucher:=round(v_voucher+p_value,2);v_event:='voucher_added';
  else raise exception 'إجراء إعداد الكاش باك غير مدعوم'; end if;
  v_new_cashback:=round((coalesce(v_row.total_spent,0)*v_rate/100*v_multiplier)+v_voucher,2);
  if v_new_cashback+0.009<coalesce(v_row.redeemed_value,0) then raise exception 'التعديل سيجعل الاستحقاق أقل من المبلغ المسحوب بالفعل'; end if;
  update public.customer_cashback_accounts set cashback_rate=v_rate,cashback_enabled=true,cashback_multiplier=v_multiplier,voucher_value=v_voucher,customer_name=coalesce(v_row.customer_name,customer_name),customer_phone=coalesce(v_row.customer_phone,customer_phone),updated_at=now() where id=v_account.id;
  update public.customer_cashback_cycles set cashback_rate=v_rate,cashback_value=v_new_cashback,cashback_amount=v_new_cashback,voucher_value=v_voucher,notes=case when nullif(trim(coalesce(p_note,'')),'') is null then notes else concat_ws(E'\n',nullif(notes,''),trim(p_note)) end,updated_at=now() where id=v_row.id returning * into v_row;
  insert into public.customer_cashback_events(cashback_cycle_id,cycle_id,customer_code,customer_name,event_type,value,amount,note,notes,created_by,created_by_name)
  values(v_row.id,v_row.id,v_row.customer_code,v_row.customer_name,v_event,p_value,p_value,nullif(trim(coalesce(p_note,'')),''),nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username));
  perform public.dawaa_refresh_customer_cashback_period_totals_v1(v_row.period_id);return v_row;
end $$;
revoke all on function public.dawaa_customer_cashback_account_action_v1(uuid,text,numeric,text) from public;
grant execute on function public.dawaa_customer_cashback_account_action_v1(uuid,text,numeric,text) to anon,authenticated,service_role;

-- Keep period totals synchronized after redemption.
create or replace function public.dawaa_customer_cashback_action_v1(p_cycle_id uuid,p_action text,p_amount numeric default null,p_expected_redeemed numeric default null,p_note text default null)
returns public.customer_cashback_cycles language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts;v_row public.customer_cashback_cycles%rowtype;v_action text:=lower(trim(coalesce(p_action,'')));v_remaining numeric;v_new_redeemed numeric;v_event_type text;v_event_amount numeric;v_changed boolean:=false;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false) limit 1; if not found then raise insufficient_privilege using message='يجب تسجيل الدخول بحساب موظف نشط'; end if;
  select * into v_row from public.customer_cashback_cycles where id=p_cycle_id for update; if not found then raise exception 'سجل نقاط العميل غير موجود'; end if;
  if not public.dawaa_can_access_customer_points_branch_v1(v_row.branch,true) then raise insufficient_privilege using message='غير مصرح بتعديل نقاط هذا الفرع'; end if;
  if v_action='notify' then if v_row.notified_at is null then update public.customer_cashback_cycles c set notified_at=now(),status=case when coalesce(c.status,'calculated') in ('settled','partially_redeemed','bconnect_updated') then c.status else 'notified' end,updated_at=now() where c.id=p_cycle_id returning * into v_row;v_event_type:='notified';v_changed:=true;end if;
  elsif v_action='bconnect' then if v_row.bconnect_updated_at is null then update public.customer_cashback_cycles c set notified_at=coalesce(c.notified_at,now()),bconnect_updated_at=now(),status=case when coalesce(c.status,'calculated') in ('settled','partially_redeemed') then c.status else 'bconnect_updated' end,updated_at=now() where c.id=p_cycle_id returning * into v_row;v_event_type:='bconnect_updated';v_changed:=true;end if;
  elsif v_action='redeem' then
    if p_amount is null or p_amount<=0 then raise exception 'قيمة السحب غير صحيحة'; end if;if p_expected_redeemed is null then raise exception 'حدث الرصيد أولاً قبل تنفيذ السحب'; end if;
    if abs(coalesce(v_row.redeemed_value,0)-p_expected_redeemed)>0.009 then raise exception 'تم تحديث رصيد العميل بالفعل، اعمل تحديث وحاول تاني'; end if;
    v_remaining:=greatest(0,coalesce(v_row.cashback_value,0)-coalesce(v_row.redeemed_value,0));if p_amount>v_remaining+0.009 then raise exception 'قيمة السحب أكبر من المتبقي الحالي'; end if;
    v_new_redeemed:=round(coalesce(v_row.redeemed_value,0)+p_amount,2);
    update public.customer_cashback_cycles c set redeemed_value=v_new_redeemed,partially_redeemed_at=coalesce(c.partially_redeemed_at,now()),status=case when v_new_redeemed>=coalesce(c.cashback_value,0)-0.009 then 'settled' else 'partially_redeemed' end,settled_at=case when v_new_redeemed>=coalesce(c.cashback_value,0)-0.009 then coalesce(c.settled_at,now()) else c.settled_at end,updated_at=now() where c.id=p_cycle_id returning * into v_row;
    v_event_type:=case when v_row.status='settled' then 'settled' else 'partially_redeemed' end;v_event_amount:=p_amount;v_changed:=true;
  else raise exception 'إجراء نقاط العميل غير مدعوم'; end if;
  if v_changed then insert into public.customer_cashback_events(cashback_cycle_id,cycle_id,customer_code,customer_name,event_type,value,amount,note,notes,created_by,created_by_name) values(v_row.id,v_row.id,v_row.customer_code,v_row.customer_name,v_event_type,v_event_amount,v_event_amount,nullif(trim(coalesce(p_note,'')),''),nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username)); end if;
  if v_action='redeem' and v_changed then perform public.dawaa_refresh_customer_cashback_period_totals_v1(v_row.period_id); end if;return v_row;
end $$;
