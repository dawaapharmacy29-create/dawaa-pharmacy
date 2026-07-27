-- Customer loyalty approval workflow + faster invoice aggregation.

create index if not exists sales_invoices_customer_code_date_idx
  on public.sales_invoices (customer_code, invoice_date);

create index if not exists sales_invoices_customer_id_date_idx
  on public.sales_invoices (customer_id, invoice_date);

create index if not exists sales_invoices_customer_phone_digits_date_idx
  on public.sales_invoices ((regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g')), invoice_date);

create table if not exists public.customer_points_approval_requests (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references public.customer_loyalty_settings(id) on delete cascade,
  customer_id text null,
  customer_code text null,
  customer_name text null,
  customer_phone text null,
  branch text null,
  period_start date not null,
  period_end date not null,
  calculation_mode text not null check (calculation_mode in ('automatic','manual')),
  purchase_total numeric not null default 0,
  invoice_count integer null,
  reward_rate numeric not null check (reward_rate in (0.03,0.05)),
  points_amount numeric not null default 0,
  cycle_key text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','returned')),
  request_notes text null,
  requested_by text null,
  requested_by_name text null,
  requested_at timestamptz not null default now(),
  reviewed_by text null,
  reviewed_by_name text null,
  reviewed_at timestamptz null,
  review_notes text null,
  ledger_id uuid null references public.customer_points_ledger(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_points_approval_cycle_pending_uidx
  on public.customer_points_approval_requests(cycle_key)
  where status in ('pending','approved');

create index if not exists customer_points_approval_branch_status_idx
  on public.customer_points_approval_requests(branch,status,requested_at desc);

create index if not exists customer_points_approval_customer_idx
  on public.customer_points_approval_requests(customer_code,customer_phone,requested_at desc);

alter table public.customer_points_approval_requests enable row level security;
drop policy if exists customer_points_approval_requests_select on public.customer_points_approval_requests;
create policy customer_points_approval_requests_select
  on public.customer_points_approval_requests for select using (true);

create or replace function public.normalize_loyalty_branch(p_branch text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_branch,'')) like '%شامي%' then 'فرع الشامي'
    when lower(coalesce(p_branch,'')) like '%شكري%' or lower(coalesce(p_branch,'')) like '%شكرى%' then 'فرع شكري'
    else nullif(trim(p_branch),'')
  end;
$$;

create or replace function public.customer_invoice_period_summary(
  p_customer_code text,
  p_customer_phone text,
  p_customer_id text,
  p_branch text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric := 0;
  v_count integer := 0;
  v_branch text := public.normalize_loyalty_branch(p_branch);
  v_phone text := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
begin
  if nullif(trim(p_customer_code),'') is not null then
    select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where trim(si.customer_code::text)=trim(p_customer_code)
      and coalesce(si.invoice_date,si.sale_date)::date between p_from and p_to
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  elsif nullif(trim(p_customer_id),'') is not null then
    select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where si.customer_id::text=p_customer_id
      and coalesce(si.invoice_date,si.sale_date)::date between p_from and p_to
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  elsif nullif(v_phone,'') is not null then
    select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where regexp_replace(coalesce(si.customer_phone,''),'\D','','g')=v_phone
      and coalesce(si.invoice_date,si.sale_date)::date between p_from and p_to
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  end if;

  return jsonb_build_object(
    'purchase_total',coalesce(v_total,0),
    'invoice_count',coalesce(v_count,0),
    'period_start',p_from,
    'period_end',p_to
  );
end;
$$;

create or replace function public.submit_customer_loyalty_approval(
  p_setting_id uuid,
  p_period_start date,
  p_period_end date,
  p_manual_purchase_total numeric default null,
  p_request_notes text default null,
  p_actor_id text default null,
  p_actor_name text default null
)
returns public.customer_points_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.customer_loyalty_settings;
  v_summary jsonb;
  v_total numeric;
  v_count integer;
  v_points numeric;
  v_key text;
  v_row public.customer_points_approval_requests;
begin
  if not public.app_role_allowed(p_actor_id,array['general_manager','admin','customer_service_manager','branch_manager','customer_service','pharmacist']) then
    raise exception 'ليس لديك صلاحية إنشاء طلب احتساب نقاط.';
  end if;

  select * into s from public.customer_loyalty_settings where id=p_setting_id and active;
  if s.id is null then raise exception 'إعداد نقاط العميل غير موجود أو غير مفعل.'; end if;
  if p_period_end < p_period_start then raise exception 'نهاية الفترة يجب أن تكون بعد بدايتها.'; end if;

  if p_manual_purchase_total is null then
    v_summary := public.customer_invoice_period_summary(s.customer_code,s.customer_phone,s.customer_id,s.branch,p_period_start,p_period_end);
    v_total := coalesce((v_summary->>'purchase_total')::numeric,0);
    v_count := coalesce((v_summary->>'invoice_count')::integer,0);
  else
    v_total := greatest(p_manual_purchase_total,0);
    v_count := null;
  end if;

  v_points := round(v_total*s.reward_rate,2);
  v_key := concat('approval:',coalesce(s.customer_code,s.customer_phone,s.customer_id,s.id::text),':',p_period_start,':',p_period_end,':',s.reward_rate);

  insert into public.customer_points_approval_requests(
    setting_id,customer_id,customer_code,customer_name,customer_phone,branch,
    period_start,period_end,calculation_mode,purchase_total,invoice_count,reward_rate,points_amount,
    cycle_key,status,request_notes,requested_by,requested_by_name
  ) values (
    s.id,s.customer_id,s.customer_code,s.customer_name,s.customer_phone,public.normalize_loyalty_branch(s.branch),
    p_period_start,p_period_end,case when p_manual_purchase_total is null then 'automatic' else 'manual' end,
    v_total,v_count,s.reward_rate,v_points,v_key,'pending',nullif(trim(coalesce(p_request_notes,'')),''),p_actor_id,p_actor_name
  )
  on conflict (cycle_key) where status in ('pending','approved')
  do update set
    purchase_total=excluded.purchase_total,
    invoice_count=excluded.invoice_count,
    points_amount=excluded.points_amount,
    request_notes=excluded.request_notes,
    requested_by=excluded.requested_by,
    requested_by_name=excluded.requested_by_name,
    requested_at=now(),
    updated_at=now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.review_customer_loyalty_approval(
  p_request_id uuid,
  p_decision text,
  p_review_notes text default null,
  p_actor_id text default null
)
returns public.customer_points_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.customer_points_approval_requests;
  v_role text;
  v_name text;
  v_branch text;
  v_allowed boolean := false;
  v_ledger public.customer_points_ledger;
begin
  select * into r from public.customer_points_approval_requests where id=p_request_id for update;
  if r.id is null then raise exception 'طلب الاعتماد غير موجود.'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب بالفعل.'; end if;

  select lower(coalesce(sa.role,'')),coalesce(sa.display_name,sa.username,'')
    into v_role,v_name
  from public.staff_accounts sa
  where sa.id::text=p_actor_id and coalesce(sa.active,true)=true
  limit 1;

  v_branch := public.normalize_loyalty_branch(r.branch);
  if v_role in ('general_manager','admin') then
    v_allowed := true;
  elsif v_branch='فرع الشامي' and v_name like '%ضحى%' then
    v_allowed := true;
  elsif v_branch='فرع شكري' and v_name like '%دنيا%' then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'اعتماد الشامي متاح لد/ ضحى، واعتماد شكري متاح لد/ دنيا، مع صلاحية استثنائية للمدير العام.';
  end if;

  if p_decision not in ('approved','rejected','returned') then
    raise exception 'قرار المراجعة غير صحيح.';
  end if;
  if p_decision <> 'approved' and length(trim(coalesce(p_review_notes,''))) < 3 then
    raise exception 'اكتب سبب الرفض أو الإعادة.';
  end if;

  if p_decision='approved' then
    insert into public.customer_points_ledger(
      customer_id,customer_code,customer_name,customer_phone,branch,
      points_amount,transaction_type,source_type,points_reason,notes,
      created_by,created_by_name,calculation_mode,purchase_total,reward_rate,
      period_start,period_end,invoice_count,cycle_key,metadata,updated_at
    ) values (
      r.customer_id,r.customer_code,r.customer_name,r.customer_phone,r.branch,
      r.points_amount,'credit','quarterly_loyalty',
      concat('استحقاق معتمد ',(r.reward_rate*100)::numeric,'% عن الفترة ',r.period_start,' إلى ',r.period_end),
      concat('تم الاعتماد بواسطة ',v_name),p_actor_id,v_name,r.calculation_mode,r.purchase_total,r.reward_rate,
      r.period_start,r.period_end,r.invoice_count,replace(r.cycle_key,'approval:','loyalty:'),
      jsonb_build_object('approval_request_id',r.id,'approved_by',v_name),now()
    )
    on conflict (cycle_key) where cycle_key is not null and transaction_type='credit'
    do update set updated_at=now()
    returning * into v_ledger;

    update public.customer_loyalty_settings
    set last_calculated_at=now(),last_period_start=r.period_start,last_period_end=r.period_end,updated_at=now()
    where id=r.setting_id;
  end if;

  update public.customer_points_approval_requests
  set status=p_decision,
      reviewed_by=p_actor_id,
      reviewed_by_name=v_name,
      reviewed_at=now(),
      review_notes=nullif(trim(coalesce(p_review_notes,'')),''),
      ledger_id=case when p_decision='approved' then v_ledger.id else null end,
      updated_at=now()
  where id=r.id
  returning * into r;

  return r;
end;
$$;

create or replace function public.run_due_customer_loyalty_cycles(
  p_actor_id text default null,
  p_actor_name text default 'النظام'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_done integer:=0;
  v_errors integer:=0;
  v_start date;
  v_end date;
begin
  for s in
    select * from public.customer_loyalty_settings
    where active and calculation_mode='automatic' and next_due_date<=current_date
  loop
    begin
      v_start:=coalesce(s.last_period_end+1,s.cycle_start_date);
      v_end:=(v_start+make_interval(months=>s.cycle_months)-interval '1 day')::date;
      perform public.submit_customer_loyalty_approval(s.id,v_start,v_end,null,'استحقاق تلقائي جاهز لاعتماد مسؤولة الفرع',coalesce(p_actor_id,s.created_by),coalesce(nullif(p_actor_name,'النظام'),s.created_by_name,'النظام'));
      v_done:=v_done+1;
    exception when others then
      v_errors:=v_errors+1;
    end;
  end loop;
  return jsonb_build_object('calculated',v_done,'errors',v_errors,'mode','pending_approval');
end;
$$;

grant execute on function public.submit_customer_loyalty_approval(uuid,date,date,numeric,text,text,text) to authenticated;
grant execute on function public.review_customer_loyalty_approval(uuid,text,text,text) to authenticated;
grant execute on function public.customer_invoice_period_summary(text,text,text,text,date,date) to authenticated;
grant execute on function public.run_due_customer_loyalty_cycles(text,text) to authenticated;

select pg_notify('pgrst','reload schema');
