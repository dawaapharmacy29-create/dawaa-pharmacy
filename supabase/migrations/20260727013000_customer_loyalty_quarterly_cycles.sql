-- Quarterly customer loyalty points: manual or invoice-based calculation.

alter table public.customer_points_ledger
  add column if not exists calculation_mode text null,
  add column if not exists purchase_total numeric null,
  add column if not exists reward_rate numeric null,
  add column if not exists period_start date null,
  add column if not exists period_end date null,
  add column if not exists invoice_count integer null,
  add column if not exists cycle_key text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists customer_points_ledger_cycle_uidx
  on public.customer_points_ledger (cycle_key)
  where cycle_key is not null and transaction_type = 'credit';

create table if not exists public.customer_loyalty_settings (
  id uuid primary key default gen_random_uuid(),
  customer_id text null,
  customer_code text null,
  customer_name text null,
  customer_phone text null,
  branch text null,
  reward_rate numeric not null default 0.05 check (reward_rate in (0.03, 0.05)),
  cycle_months integer not null default 3 check (cycle_months between 1 and 12),
  calculation_mode text not null default 'automatic' check (calculation_mode in ('automatic','manual')),
  cycle_start_date date not null default current_date,
  last_calculated_at timestamptz null,
  last_period_start date null,
  last_period_end date null,
  next_due_date date generated always as (
    (coalesce(last_period_end, cycle_start_date - 1) + (cycle_months || ' months')::interval + interval '1 day')::date
  ) stored,
  active boolean not null default true,
  created_by text null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_loyalty_settings_code_branch_uidx
  on public.customer_loyalty_settings (customer_code, coalesce(branch,''))
  where nullif(trim(customer_code),'') is not null;
create index if not exists customer_loyalty_settings_phone_idx on public.customer_loyalty_settings (customer_phone);
create index if not exists customer_loyalty_settings_due_idx on public.customer_loyalty_settings (next_due_date) where active;

alter table public.customer_loyalty_settings enable row level security;
drop policy if exists customer_loyalty_settings_select on public.customer_loyalty_settings;
create policy customer_loyalty_settings_select on public.customer_loyalty_settings for select using (true);

create or replace function public.customer_invoice_period_summary(
  p_customer_code text,
  p_customer_phone text,
  p_customer_id text,
  p_branch text,
  p_from date,
  p_to date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'purchase_total', coalesce(sum(coalesce(si.net_total, si.net_amount, si.discounted_amount, si.amount, si.total_amount, si.gross_total, si.gross_amount, 0)),0),
    'invoice_count', count(*),
    'period_start', p_from,
    'period_end', p_to
  )
  from public.sales_invoices si
  where coalesce(si.invoice_date, si.sale_date)::date between p_from and p_to
    and (
      (nullif(trim(p_customer_code),'') is not null and trim(si.customer_code::text) = trim(p_customer_code))
      or (nullif(regexp_replace(coalesce(p_customer_phone,''),'\D','','g'),'') is not null and regexp_replace(coalesce(si.customer_phone,''),'\D','','g') = regexp_replace(p_customer_phone,'\D','','g'))
      or (nullif(trim(p_customer_id),'') is not null and si.customer_id::text = p_customer_id)
    )
    and (
      nullif(trim(coalesce(p_branch,'')),'') is null
      or lower(coalesce(si.branch, si.branch_name,'')) like '%' || lower(replace(replace(p_branch,'فرع ',''),'الفرعية ','')) || '%'
    );
$$;

create or replace function public.upsert_customer_loyalty_setting(p_payload jsonb)
returns public.customer_loyalty_settings
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.customer_loyalty_settings;
begin
  if not public.app_role_allowed(p_payload->>'created_by', array['general_manager','admin','customer_service_manager','branch_manager','customer_service','pharmacist']) then
    raise exception 'ليس لديك صلاحية إعداد نظام نقاط العميل.';
  end if;

  select * into v_row
  from public.customer_loyalty_settings s
  where (nullif(trim(p_payload->>'customer_code'),'') is not null and trim(s.customer_code)=trim(p_payload->>'customer_code') and coalesce(s.branch,'')=coalesce(p_payload->>'branch',''))
     or (nullif(trim(p_payload->>'customer_id'),'') is not null and s.customer_id=p_payload->>'customer_id')
  order by s.updated_at desc limit 1;

  if v_row.id is null then
    insert into public.customer_loyalty_settings(customer_id,customer_code,customer_name,customer_phone,branch,reward_rate,cycle_months,calculation_mode,cycle_start_date,active,created_by,created_by_name)
    values (p_payload->>'customer_id',p_payload->>'customer_code',p_payload->>'customer_name',p_payload->>'customer_phone',p_payload->>'branch',coalesce((p_payload->>'reward_rate')::numeric,0.05),coalesce((p_payload->>'cycle_months')::int,3),coalesce(nullif(p_payload->>'calculation_mode',''),'automatic'),coalesce(nullif(p_payload->>'cycle_start_date','')::date,current_date),coalesce((p_payload->>'active')::boolean,true),p_payload->>'created_by',p_payload->>'created_by_name')
    returning * into v_row;
  else
    update public.customer_loyalty_settings set
      customer_name=coalesce(nullif(p_payload->>'customer_name',''),customer_name),
      customer_phone=coalesce(nullif(p_payload->>'customer_phone',''),customer_phone),
      branch=coalesce(nullif(p_payload->>'branch',''),branch),
      reward_rate=coalesce((p_payload->>'reward_rate')::numeric,reward_rate),
      cycle_months=coalesce((p_payload->>'cycle_months')::int,cycle_months),
      calculation_mode=coalesce(nullif(p_payload->>'calculation_mode',''),calculation_mode),
      cycle_start_date=coalesce(nullif(p_payload->>'cycle_start_date','')::date,cycle_start_date),
      active=coalesce((p_payload->>'active')::boolean,active),
      updated_at=now()
    where id=v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.calculate_customer_loyalty_cycle(
  p_setting_id uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_manual_purchase_total numeric default null,
  p_actor_id text default null,
  p_actor_name text default null
)
returns public.customer_points_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.customer_loyalty_settings;
  v_start date;
  v_end date;
  v_summary jsonb;
  v_total numeric;
  v_count integer;
  v_points numeric;
  v_cycle_key text;
  v_row public.customer_points_ledger;
begin
  if not public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','branch_manager','customer_service','pharmacist']) then
    raise exception 'ليس لديك صلاحية احتساب نقاط العملاء.';
  end if;
  select * into s from public.customer_loyalty_settings where id=p_setting_id and active;
  if s.id is null then raise exception 'إعداد نقاط العميل غير موجود أو غير مفعل.'; end if;

  v_start := coalesce(p_period_start, s.last_period_end + 1, s.cycle_start_date);
  v_end := coalesce(p_period_end, (v_start + (s.cycle_months || ' months')::interval - interval '1 day')::date);
  if v_end < v_start then raise exception 'تاريخ نهاية الفترة يجب أن يكون بعد البداية.'; end if;

  if p_manual_purchase_total is not null then
    v_total := greatest(p_manual_purchase_total,0); v_count := null;
  else
    v_summary := public.customer_invoice_period_summary(s.customer_code,s.customer_phone,s.customer_id,s.branch,v_start,v_end);
    v_total := coalesce((v_summary->>'purchase_total')::numeric,0);
    v_count := coalesce((v_summary->>'invoice_count')::int,0);
  end if;
  v_points := round(v_total * s.reward_rate,2);
  v_cycle_key := concat('loyalty:',coalesce(s.customer_code,s.customer_phone,s.customer_id,s.id::text),':',v_start,':',v_end,':',s.reward_rate);

  insert into public.customer_points_ledger(customer_id,customer_code,customer_name,customer_phone,branch,points_amount,transaction_type,source_type,points_reason,notes,created_by,created_by_name,calculation_mode,purchase_total,reward_rate,period_start,period_end,invoice_count,cycle_key,metadata)
  values(s.customer_id,s.customer_code,s.customer_name,s.customer_phone,s.branch,v_points,'credit','quarterly_loyalty',concat('استحقاق نقاط ',(s.reward_rate*100)::numeric,'% عن الفترة ',v_start,' إلى ',v_end),case when p_manual_purchase_total is null then 'تم الحساب تلقائيًا من فواتير العميل' else 'تم إدخال إجمالي المشتريات يدويًا' end,p_actor_id,p_actor_name,case when p_manual_purchase_total is null then 'automatic' else 'manual' end,v_total,s.reward_rate,v_start,v_end,v_count,v_cycle_key,jsonb_build_object('setting_id',s.id,'cycle_months',s.cycle_months))
  on conflict (cycle_key) where cycle_key is not null and transaction_type='credit'
  do update set updated_at = now()
  returning * into v_row;

  update public.customer_loyalty_settings set last_calculated_at=now(),last_period_start=v_start,last_period_end=v_end,updated_at=now() where id=s.id;
  return v_row;
end;
$$;

-- PostgreSQL has no updated_at on the legacy ledger; add it for idempotent conflict updates.
alter table public.customer_points_ledger add column if not exists updated_at timestamptz null;

create or replace function public.run_due_customer_loyalty_cycles(p_actor_id text default null,p_actor_name text default 'النظام')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s record; v_done int:=0; v_errors int:=0;
begin
  for s in select id from public.customer_loyalty_settings where active and calculation_mode='automatic' and next_due_date <= current_date loop
    begin
      perform public.calculate_customer_loyalty_cycle(s.id,null,null,null,p_actor_id,p_actor_name); v_done:=v_done+1;
    exception when others then v_errors:=v_errors+1;
    end;
  end loop;
  return jsonb_build_object('calculated',v_done,'errors',v_errors);
end;
$$;

grant execute on function public.customer_invoice_period_summary(text,text,text,text,date,date) to authenticated;
grant execute on function public.upsert_customer_loyalty_setting(jsonb) to authenticated;
grant execute on function public.calculate_customer_loyalty_cycle(uuid,date,date,numeric,text,text) to authenticated;
grant execute on function public.run_due_customer_loyalty_cycles(text,text) to authenticated;
