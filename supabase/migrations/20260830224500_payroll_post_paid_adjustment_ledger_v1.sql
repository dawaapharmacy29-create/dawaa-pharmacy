create table if not exists public.staff_payroll_adjustments_v1 (
  id uuid primary key default gen_random_uuid(),
  source_payroll_id uuid not null references public.staff_payroll_monthly_v13(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_username text,
  source_payroll_month date not null,
  amount numeric(14,2) not null check (amount <> 0 and abs(amount) <= 100000),
  category text not null check (category in ('attendance','incentive','deduction','salary','other')),
  reason text not null check (length(trim(reason)) >= 3),
  reference_note text,
  apply_mode text not null default 'next_payroll' check (apply_mode in ('next_payroll','separate_payout')),
  reversal_of uuid references public.staff_payroll_adjustments_v1(id) on delete restrict,
  created_by text not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists staff_payroll_adjustments_v1_one_reversal_uidx
  on public.staff_payroll_adjustments_v1(reversal_of) where reversal_of is not null;
create index if not exists staff_payroll_adjustments_v1_staff_created_idx
  on public.staff_payroll_adjustments_v1(staff_id,created_at desc);
create index if not exists staff_payroll_adjustments_v1_source_idx
  on public.staff_payroll_adjustments_v1(source_payroll_id);

create table if not exists public.staff_payroll_adjustment_applications_v1 (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.staff_payroll_adjustments_v1(id) on delete restrict,
  target_payroll_id uuid not null references public.staff_payroll_monthly_v13(id) on delete restrict,
  amount numeric(14,2) not null check (amount <> 0),
  applied_by text not null,
  applied_by_name text,
  applied_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists staff_payroll_adjustment_applications_v1_adjustment_idx
  on public.staff_payroll_adjustment_applications_v1(adjustment_id);
create index if not exists staff_payroll_adjustment_applications_v1_target_idx
  on public.staff_payroll_adjustment_applications_v1(target_payroll_id);

alter table public.staff_payroll_adjustments_v1 enable row level security;
alter table public.staff_payroll_adjustment_applications_v1 enable row level security;
revoke all on table public.staff_payroll_adjustments_v1 from public,anon,authenticated;
revoke all on table public.staff_payroll_adjustment_applications_v1 from public,anon,authenticated;
grant all on table public.staff_payroll_adjustments_v1 to service_role;
grant all on table public.staff_payroll_adjustment_applications_v1 to service_role;

create or replace function public.dawaa_block_payroll_adjustment_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  raise exception 'payroll_adjustment_ledger_is_immutable' using errcode='55000';
end;
$function$;

drop trigger if exists trg_staff_payroll_adjustments_v1_immutable on public.staff_payroll_adjustments_v1;
create trigger trg_staff_payroll_adjustments_v1_immutable
before update or delete on public.staff_payroll_adjustments_v1
for each row execute function public.dawaa_block_payroll_adjustment_mutation_v1();
drop trigger if exists trg_staff_payroll_adjustment_applications_v1_immutable on public.staff_payroll_adjustment_applications_v1;
create trigger trg_staff_payroll_adjustment_applications_v1_immutable
before update or delete on public.staff_payroll_adjustment_applications_v1
for each row execute function public.dawaa_block_payroll_adjustment_mutation_v1();
revoke all on function public.dawaa_block_payroll_adjustment_mutation_v1() from public,anon,authenticated;
grant execute on function public.dawaa_block_payroll_adjustment_mutation_v1() to service_role;

create or replace function public.create_staff_payroll_adjustment_v1(
  p_source_payroll_id uuid,
  p_amount numeric,
  p_category text,
  p_reason text,
  p_reference_note text default null,
  p_apply_mode text default 'next_payroll'
)
returns public.staff_payroll_adjustments_v1
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_payroll public.staff_payroll_monthly_v13%rowtype;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_row public.staff_payroll_adjustments_v1%rowtype;
begin
  if p_source_payroll_id is null or coalesce(p_amount,0)=0 or abs(p_amount)>100000 then
    raise exception 'invalid_payroll_adjustment_amount_or_source' using errcode='22023';
  end if;
  if lower(trim(coalesce(p_category,''))) not in ('attendance','incentive','deduction','salary','other') then
    raise exception 'invalid_payroll_adjustment_category' using errcode='22023';
  end if;
  if length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'payroll_adjustment_reason_required' using errcode='22023';
  end if;
  if lower(trim(coalesce(p_apply_mode,'next_payroll'))) not in ('next_payroll','separate_payout') then
    raise exception 'invalid_payroll_adjustment_apply_mode' using errcode='22023';
  end if;

  select * into v_payroll from public.staff_payroll_monthly_v13 where id=p_source_payroll_id limit 1;
  if not found or v_payroll.status<>'paid' then
    raise exception 'payroll_adjustment_requires_paid_source' using errcode='55000';
  end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_payroll.staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;
  if v_actor_id is null then raise exception 'payroll_adjustment_actor_missing' using errcode='42501'; end if;
  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

  insert into public.staff_payroll_adjustments_v1(
    source_payroll_id,staff_id,staff_username,source_payroll_month,amount,category,reason,reference_note,
    apply_mode,created_by,created_by_name,metadata
  ) values(
    v_payroll.id,v_payroll.staff_id,v_payroll.staff_username,v_payroll.payroll_month,round(p_amount,2),
    lower(trim(p_category)),trim(p_reason),nullif(trim(coalesce(p_reference_note,'')),''),
    lower(trim(coalesce(p_apply_mode,'next_payroll'))),v_actor_id,v_actor_name,
    jsonb_build_object('ledger_version',1,'source_payroll_status','paid','source_net_salary',v_payroll.net_salary)
  ) returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.reverse_staff_payroll_adjustment_v1(
  p_adjustment_id uuid,
  p_reason text
)
returns public.staff_payroll_adjustments_v1
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_original public.staff_payroll_adjustments_v1%rowtype;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_row public.staff_payroll_adjustments_v1%rowtype;
begin
  if p_adjustment_id is null or length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'payroll_adjustment_reversal_reason_required' using errcode='22023';
  end if;
  select * into v_original from public.staff_payroll_adjustments_v1 where id=p_adjustment_id limit 1;
  if not found then raise exception 'payroll_adjustment_not_found' using errcode='22023'; end if;
  if v_original.reversal_of is not null then raise exception 'cannot_reverse_a_reversal' using errcode='55000'; end if;
  if exists(select 1 from public.staff_payroll_adjustments_v1 x where x.reversal_of=v_original.id) then
    raise exception 'payroll_adjustment_already_reversed' using errcode='55000';
  end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_original.staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;
  if v_actor_id is null then raise exception 'payroll_adjustment_actor_missing' using errcode='42501'; end if;
  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

  insert into public.staff_payroll_adjustments_v1(
    source_payroll_id,staff_id,staff_username,source_payroll_month,amount,category,reason,reference_note,
    apply_mode,reversal_of,created_by,created_by_name,metadata
  ) values(
    v_original.source_payroll_id,v_original.staff_id,v_original.staff_username,v_original.source_payroll_month,
    -v_original.amount,v_original.category,trim(p_reason),'reversal',v_original.apply_mode,v_original.id,
    v_actor_id,v_actor_name,jsonb_build_object('ledger_version',1,'reversal_of',v_original.id)
  ) returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.get_staff_payroll_adjustment_balance_v1(p_staff_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_created numeric:=0;
  v_applied numeric:=0;
  v_count integer:=0;
begin
  select sa.username into v_username from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;
  if v_username is null then raise exception 'payroll_adjustment_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;
  select coalesce(sum(a.amount),0),count(*)::integer into v_created,v_count
  from public.staff_payroll_adjustments_v1 a where a.staff_id=p_staff_id;
  select coalesce(sum(x.amount),0) into v_applied
  from public.staff_payroll_adjustment_applications_v1 x
  join public.staff_payroll_adjustments_v1 a on a.id=x.adjustment_id
  where a.staff_id=p_staff_id;
  return jsonb_build_object(
    'staff_id',p_staff_id,'ledger_entries',v_count,'ledger_total',round(v_created,2),
    'applied_total',round(v_applied,2),'outstanding_balance',round(v_created-v_applied,2),'generated_at',now()
  );
end;
$function$;

revoke all on function public.create_staff_payroll_adjustment_v1(uuid,numeric,text,text,text,text) from public;
grant execute on function public.create_staff_payroll_adjustment_v1(uuid,numeric,text,text,text,text) to anon,authenticated,service_role;
revoke all on function public.reverse_staff_payroll_adjustment_v1(uuid,text) from public;
grant execute on function public.reverse_staff_payroll_adjustment_v1(uuid,text) to anon,authenticated,service_role;
revoke all on function public.get_staff_payroll_adjustment_balance_v1(uuid) from public;
grant execute on function public.get_staff_payroll_adjustment_balance_v1(uuid) to anon,authenticated,service_role;
