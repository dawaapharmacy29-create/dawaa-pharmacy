create table if not exists public.customer_loyalty_repair_backup_20260825 (
  source_table text not null,
  source_id text not null,
  row_data jsonb not null,
  backed_up_at timestamptz not null default now(),
  primary key (source_table, source_id)
);

insert into public.customer_loyalty_repair_backup_20260825(source_table, source_id, row_data)
select 'customer_cashback_cycles', id::text, to_jsonb(c)
from public.customer_cashback_cycles c
where ((branch='فرع الشامي' and cycle_start='2026-04-01' and cycle_end in ('2026-07-30','2026-07-31'))
    or (branch='فرع شكري' and cycle_start='2026-05-01' and cycle_end='2026-07-31'))
on conflict do nothing;

insert into public.customer_loyalty_repair_backup_20260825(source_table, source_id, row_data)
select 'customer_points_ledger', id::text, to_jsonb(l)
from public.customer_points_ledger l
where (branch='فرع الشامي' and period_start='2026-04-01' and period_end='2026-07-31')
   or (branch='فرع شكري' and period_start='2026-05-01' and period_end='2026-07-31')
on conflict do nothing;

create unique index if not exists customer_points_ledger_redemption_cycle_uidx
  on public.customer_points_ledger(cycle_key)
  where cycle_key is not null and transaction_type='debit' and source_type='cashback_redemption_sync';

create or replace function public.calculate_customer_cashback_cycle_for_branch_v1(
  p_cycle_start date,
  p_cycle_end date,
  p_branch text
)
returns integer
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_count integer := 0;
  v_start date := p_cycle_start;
  v_end date := p_cycle_end;
begin
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end < p_cycle_start then
    raise exception 'فترة احتساب الكاش باك غير صحيحة';
  end if;
  if nullif(trim(p_branch), '') is null then
    raise exception 'لازم تحدد الفرع قبل احتساب الكاش باك';
  end if;

  if p_branch='فرع الشامي'
     and p_cycle_start in (date '2026-04-01', date '2026-05-01')
     and p_cycle_end in (date '2026-07-30', date '2026-07-31') then
    v_start := date '2026-04-01';
    v_end := date '2026-07-31';
  end if;

  with normalized_invoices as (
    select
      nullif(trim(si.customer_code), '') as customer_code,
      nullif(trim(coalesce(si.customer_name, si.name)), '') as customer_name,
      nullif(trim(coalesce(si.customer_phone, si.phone, si.whatsapp_phone)), '') as customer_phone,
      nullif(trim(coalesce(si.branch_name, si.branch)), '') as branch,
      coalesce(si.sale_date, si.invoice_date::date, si.invoice_datetime::date) as sale_day,
      coalesce(nullif(si.net_total,0), nullif(si.total_amount,0), nullif(si.net_amount,0), nullif(si.discounted_amount,0), nullif(si.amount,0), 0)::numeric as invoice_value
    from public.dawaa_customer_sales_analytics_v1 si
  ), invoice_base as (
    select
      ni.customer_code,
      max(ni.customer_name) as customer_name,
      max(ni.customer_phone) as customer_phone,
      p_branch as branch,
      count(*)::integer as invoices_count,
      round(sum(ni.invoice_value)::numeric,2) as total_spent
    from normalized_invoices ni
    where ni.customer_code is not null
      and ni.sale_day between v_start and v_end
      and ni.invoice_value > 0
      and ni.branch = p_branch
    group by ni.customer_code
  ), calculated as (
    select
      b.customer_code,
      coalesce(a.customer_name,b.customer_name) as customer_name,
      coalesce(a.customer_phone,b.customer_phone) as customer_phone,
      b.branch,
      b.invoices_count,
      b.total_spent,
      case when coalesce(a.cashback_enabled,true) then coalesce(a.cashback_rate,5) else 0 end::numeric as cashback_rate,
      case when coalesce(a.cashback_enabled,true)
        then round((b.total_spent * coalesce(a.cashback_rate,5) / 100 * coalesce(a.cashback_multiplier,1)) + coalesce(a.voucher_value,0),2)
        else 0 end as cashback_value,
      coalesce(a.voucher_value,0)::numeric as voucher_value
    from invoice_base b
    left join public.customer_cashback_accounts a on a.customer_code=b.customer_code
  ), upserted as (
    insert into public.customer_cashback_cycles(
      customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,
      cashback_rate,total_spent,total_purchases,invoices_count,cashback_value,cashback_amount,
      voucher_value,remaining_value,status,calculated_at,updated_at
    )
    select
      c.customer_code,c.customer_name,c.customer_phone,c.branch,
      to_char(v_start,'YYYY-MM-DD') || ' → ' || to_char(v_end,'YYYY-MM-DD'),
      v_start,v_end,c.cashback_rate,c.total_spent,c.total_spent,c.invoices_count,
      c.cashback_value,c.cashback_value,c.voucher_value,greatest(0,c.cashback_value),'calculated',now(),now()
    from calculated c
    on conflict (customer_code,cycle_start,cycle_end)
    do update set
      customer_name=excluded.customer_name,
      customer_phone=excluded.customer_phone,
      branch=excluded.branch,
      cycle_label=excluded.cycle_label,
      cashback_rate=excluded.cashback_rate,
      total_spent=excluded.total_spent,
      total_purchases=excluded.total_purchases,
      invoices_count=excluded.invoices_count,
      cashback_value=excluded.cashback_value,
      cashback_amount=excluded.cashback_amount,
      voucher_value=excluded.voucher_value,
      remaining_value=greatest(0,excluded.cashback_value-coalesce(customer_cashback_cycles.redeemed_value,0)),
      calculated_at=now(),updated_at=now()
    returning 1
  ) select count(*) into v_count from upserted;

  return v_count;
end;
$$;

create or replace function public.run_quarterly_cashback_batch_for_branch_v1(
  p_branch text,
  p_period_start date,
  p_period_end date,
  p_reward_rate numeric default 0.05,
  p_actor_name text default 'النظام (تلقائي)'
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_start date := p_period_start;
  v_end date := p_period_end;
  v_created int := 0;
  v_total_points numeric := 0;
begin
  if nullif(trim(p_branch),'') is null then raise exception 'لازم تحدد الفرع'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'فترة النقاط غير صحيحة'; end if;

  if p_branch='فرع الشامي'
     and p_period_start in (date '2026-04-01', date '2026-05-01')
     and p_period_end in (date '2026-07-30', date '2026-07-31') then
    v_start := date '2026-04-01';
    v_end := date '2026-07-31';
  end if;

  perform public.calculate_customer_cashback_cycle_for_branch_v1(v_start,v_end,p_branch);

  with inserted as (
    insert into public.customer_points_ledger(
      customer_code,customer_name,customer_phone,branch,points_amount,transaction_type,source_type,
      points_reason,notes,created_by_name,calculation_mode,purchase_total,reward_rate,
      period_start,period_end,invoice_count,cycle_key,updated_at,contacted,contacted_at
    )
    select c.customer_code,c.customer_name,c.customer_phone,c.branch,
      c.cashback_value,'credit','quarterly_cashback_batch',
      'نقاط/كاش باك الدورة ' || coalesce(c.cashback_rate,0) || '% عن الفترة ' || v_start || ' إلى ' || v_end,
      'مزامنة من Customer Cashback Truth v2',p_actor_name,'automatic',c.total_spent,coalesce(c.cashback_rate,0)/100,
      v_start,v_end,c.invoices_count,
      'quarterly:' || c.customer_code || ':' || c.branch || ':' || v_start || ':' || v_end,now(),
      (c.notified_at is not null),c.notified_at
    from public.customer_cashback_cycles c
    where c.branch=p_branch and c.cycle_start=v_start and c.cycle_end=v_end and coalesce(c.cashback_value,0)>0
    on conflict (cycle_key) where cycle_key is not null and transaction_type='credit'
    do update set
      customer_name=excluded.customer_name,
      customer_phone=excluded.customer_phone,
      purchase_total=excluded.purchase_total,
      points_amount=excluded.points_amount,
      invoice_count=excluded.invoice_count,
      reward_rate=excluded.reward_rate,
      period_start=excluded.period_start,
      period_end=excluded.period_end,
      notes=excluded.notes,
      contacted=(customer_points_ledger.contacted or excluded.contacted),
      contacted_at=coalesce(customer_points_ledger.contacted_at,excluded.contacted_at),
      updated_at=now()
    returning points_amount
  )
  select count(*),coalesce(sum(points_amount),0) into v_created,v_total_points from inserted;

  insert into public.customer_points_ledger(
    customer_code,customer_name,customer_phone,branch,points_amount,transaction_type,source_type,
    points_reason,notes,created_by_name,calculation_mode,purchase_total,reward_rate,
    period_start,period_end,invoice_count,cycle_key,updated_at,contacted
  )
  select c.customer_code,c.customer_name,c.customer_phone,c.branch,
    coalesce(c.redeemed_value,0),'debit','cashback_redemption_sync',
    'سحب من نقاط/كاش باك الدورة ' || v_start || ' إلى ' || v_end,
    'مزامنة تلقائية من قيمة السحب المسجلة في الكاش باك',p_actor_name,'automatic',c.total_spent,coalesce(c.cashback_rate,0)/100,
    v_start,v_end,c.invoices_count,
    'cashback_redeemed:' || c.id::text,now(),true
  from public.customer_cashback_cycles c
  where c.branch=p_branch and c.cycle_start=v_start and c.cycle_end=v_end and coalesce(c.redeemed_value,0)>0
  on conflict (cycle_key) where cycle_key is not null and transaction_type='debit' and source_type='cashback_redemption_sync'
  do update set
    points_amount=excluded.points_amount,
    customer_name=excluded.customer_name,
    customer_phone=excluded.customer_phone,
    updated_at=now();

  delete from public.customer_points_ledger l
  using public.customer_cashback_cycles c
  where l.source_type='cashback_redemption_sync'
    and l.transaction_type='debit'
    and l.cycle_key='cashback_redeemed:' || c.id::text
    and c.branch=p_branch and c.cycle_start=v_start and c.cycle_end=v_end
    and coalesce(c.redeemed_value,0)<=0;

  return jsonb_build_object(
    'branch',p_branch,
    'period_start',v_start,
    'period_end',v_end,
    'customers_credited',v_created,
    'total_points',v_total_points,
    'source','customer_cashback_cycles'
  );
end;
$$;

create or replace function public.get_customers_with_points_for_followup(p_branch text)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  v_start date;
  v_end date;
  v_result jsonb;
begin
  select period_start,period_end into v_start,v_end
  from public.get_cashback_quarter_bounds(current_date)
  limit 1;

  if p_branch='فرع الشامي' and v_start=date '2026-05-01' and v_end=date '2026-07-31' then
    v_start := date '2026-04-01';
  end if;

  with customers as materialized (
    select
      c.customer_code,
      c.customer_name,
      c.customer_phone,
      greatest(0,coalesce(c.remaining_value,c.cashback_value-coalesce(c.redeemed_value,0),0))::numeric as total_points,
      coalesce(c.calculated_at,c.created_at) as last_earned_at,
      (c.notified_at is not null) as fully_contacted,
      case when c.notified_at is null then 1 else 0 end::integer as uncontacted_count
    from public.customer_cashback_cycles c
    where c.branch=p_branch
      and c.cycle_start=v_start
      and c.cycle_end=v_end
      and greatest(0,coalesce(c.remaining_value,c.cashback_value-coalesce(c.redeemed_value,0),0))>0
  ), ordered as (
    select * from customers order by total_points desc,customer_code asc limit 5000
  )
  select jsonb_build_object(
    'total_customers',(select count(*) from customers),
    'period_start',v_start,
    'period_end',v_end,
    'source','customer_cashback_cycles',
    'rows',coalesce((select jsonb_agg(row_to_json(o) order by o.total_points desc,o.customer_code) from ordered o),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.mark_customer_points_contacted(
  p_customer_code text,
  p_branch text,
  p_actor_name text
)
returns integer
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_start date;
  v_end date;
  v_count int := 0;
  v_cycle_id uuid;
  v_now timestamptz := now();
begin
  select period_start,period_end into v_start,v_end from public.get_cashback_quarter_bounds(current_date) limit 1;
  if p_branch='فرع الشامي' and v_start=date '2026-05-01' and v_end=date '2026-07-31' then
    v_start := date '2026-04-01';
  end if;

  update public.customer_cashback_cycles
  set notified_at=coalesce(notified_at,v_now),
      status=case when status in ('settled','partially_redeemed','bconnect_updated') then status else 'notified' end,
      updated_at=v_now
  where customer_code=p_customer_code and branch=p_branch and cycle_start=v_start and cycle_end=v_end
  returning id into v_cycle_id;

  if v_cycle_id is not null then v_count := 1; end if;

  update public.customer_points_ledger
  set contacted=true,
      contacted_at=coalesce(contacted_at,v_now),
      contacted_by_name=coalesce(nullif(p_actor_name,''),'غير محدد')
  where customer_code=p_customer_code and branch=p_branch
    and transaction_type='credit'
    and period_start=v_start and period_end=v_end;

  if v_cycle_id is not null then
    insert into public.customer_cashback_events(cycle_id,cashback_cycle_id,customer_code,event_type,notes,created_by_name,created_at)
    values(v_cycle_id,v_cycle_id,p_customer_code,'notified','مزامنة تواصل من Points Truth v2',coalesce(nullif(p_actor_name,''),'غير محدد'),v_now);
  end if;

  return v_count;
end;
$$;

select public.calculate_customer_cashback_cycle_for_branch_v1('2026-04-01','2026-07-31','فرع الشامي');
select public.calculate_customer_cashback_cycle_for_branch_v1('2026-05-01','2026-07-31','فرع شكري');
select public.run_quarterly_cashback_batch_for_branch_v1('فرع الشامي','2026-04-01','2026-07-31',0.05,'إصلاح ومزامنة Points Truth v2');
select public.run_quarterly_cashback_batch_for_branch_v1('فرع شكري','2026-05-01','2026-07-31',0.05,'إصلاح ومزامنة Points Truth v2');

update public.customer_cashback_cycles c
set notified_at=l.contacted_at,
    status=case when c.status in ('settled','partially_redeemed','bconnect_updated') then c.status else 'notified' end,
    updated_at=now()
from public.customer_points_ledger l
where l.customer_code=c.customer_code and l.branch=c.branch
  and l.transaction_type='credit' and l.contacted=true
  and l.period_start=c.cycle_start and l.period_end=c.cycle_end
  and c.notified_at is null and l.contacted_at is not null
  and ((c.branch='فرع الشامي' and c.cycle_start='2026-04-01' and c.cycle_end='2026-07-31')
    or (c.branch='فرع شكري' and c.cycle_start='2026-05-01' and c.cycle_end='2026-07-31'));

update public.customer_points_ledger l
set contacted=true,
    contacted_at=coalesce(l.contacted_at,c.notified_at),
    contacted_by_name=coalesce(l.contacted_by_name,'مزامنة من سجل الكاش باك')
from public.customer_cashback_cycles c
where l.customer_code=c.customer_code and l.branch=c.branch
  and l.transaction_type='credit'
  and l.period_start=c.cycle_start and l.period_end=c.cycle_end
  and c.notified_at is not null and l.contacted=false
  and ((c.branch='فرع الشامي' and c.cycle_start='2026-04-01' and c.cycle_end='2026-07-31')
    or (c.branch='فرع شكري' and c.cycle_start='2026-05-01' and c.cycle_end='2026-07-31'));

delete from public.customer_cashback_cycles
where branch='فرع الشامي'
  and cycle_start='2026-04-01' and cycle_end='2026-07-30'
  and coalesce(notes,'')=''
  and notified_at is null
  and bconnect_updated_at is null
  and settled_at is null
  and coalesce(redeemed_value,0)=0;

revoke all on function public.calculate_customer_cashback_cycle_for_branch_v1(date,date,text) from anon;
revoke all on function public.run_quarterly_cashback_batch_for_branch_v1(text,date,date,numeric,text) from anon;
revoke all on function public.get_customers_with_points_for_followup(text) from anon;
revoke all on function public.mark_customer_points_contacted(text,text,text) from anon;
grant execute on function public.calculate_customer_cashback_cycle_for_branch_v1(date,date,text) to authenticated;
grant execute on function public.run_quarterly_cashback_batch_for_branch_v1(text,date,date,numeric,text) to authenticated;
grant execute on function public.get_customers_with_points_for_followup(text) to authenticated;
grant execute on function public.mark_customer_points_contacted(text,text,text) to authenticated;
