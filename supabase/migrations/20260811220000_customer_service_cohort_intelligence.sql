-- Customer-service cohort intelligence: fair same-day cycle comparisons and a governed top-20 watchlist.

create or replace function public.dawaa_can_manage_customer_intelligence()
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, false) and coalesce(a.can_login, false)
      and lower(coalesce(a.role, '')) in (
        'admin','owner','general_manager','executive_manager','branches_manager',
        'customer_service_manager','customer_service','manager'
      )
  )
$$;

revoke all on function public.dawaa_can_manage_customer_intelligence() from public;
grant execute on function public.dawaa_can_manage_customer_intelligence() to anon, authenticated;

create table if not exists public.customer_service_watchlist (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  customer_code text not null,
  customer_name text,
  phone text,
  rank integer not null check (rank between 1 and 20),
  note text,
  active boolean not null default true,
  added_by uuid references public.staff_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch, customer_code)
);

create unique index if not exists customer_service_watchlist_active_rank_uq
  on public.customer_service_watchlist(branch, rank) where active;
create index if not exists customer_service_watchlist_active_branch_idx
  on public.customer_service_watchlist(branch, active, rank);

alter table public.customer_service_watchlist enable row level security;
drop policy if exists customer_service_watchlist_read on public.customer_service_watchlist;
create policy customer_service_watchlist_read on public.customer_service_watchlist
  for select to anon, authenticated
  using (public.dawaa_can_manage_customer_intelligence());
drop policy if exists customer_service_watchlist_write on public.customer_service_watchlist;
create policy customer_service_watchlist_write on public.customer_service_watchlist
  for all to anon, authenticated
  using (public.dawaa_can_manage_customer_intelligence())
  with check (public.dawaa_can_manage_customer_intelligence());

grant select, insert, update on public.customer_service_watchlist to anon, authenticated;

create or replace function public.replace_customer_service_watchlist(
  p_branch text,
  p_customers jsonb
) returns integer
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_count integer;
begin
  if not public.dawaa_can_manage_customer_intelligence() then
    raise exception 'not authorized to manage customer watchlist';
  end if;
  if nullif(btrim(p_branch), '') is null or jsonb_typeof(p_customers) <> 'array' then
    raise exception 'branch and customer array are required';
  end if;
  v_count := jsonb_array_length(p_customers);
  if v_count < 1 or v_count > 20 then
    raise exception 'watchlist must contain between 1 and 20 customers';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_customers) item
    where nullif(btrim(item->>'customer_code'), '') is null
  ) then
    raise exception 'every watchlist customer requires a customer code';
  end if;
  if (select count(distinct btrim(item->>'customer_code')) from jsonb_array_elements(p_customers) item) <> v_count then
    raise exception 'duplicate customer codes are not allowed';
  end if;

  update public.customer_service_watchlist
    set active = false, updated_at = now()
    where branch = p_branch and active;

  insert into public.customer_service_watchlist
    (branch, customer_code, customer_name, phone, rank, note, active, added_by, updated_at)
  select p_branch, btrim(item->>'customer_code'), nullif(btrim(item->>'customer_name'), ''),
    nullif(btrim(item->>'phone'), ''), ordinal::integer, nullif(btrim(item->>'note'), ''), true, v_actor, now()
  from jsonb_array_elements(p_customers) with ordinality as rows(item, ordinal)
  on conflict (branch, customer_code) do update set
    customer_name = excluded.customer_name,
    phone = excluded.phone,
    rank = excluded.rank,
    note = excluded.note,
    active = true,
    added_by = excluded.added_by,
    updated_at = now();
  return v_count;
end;
$$;

revoke all on function public.replace_customer_service_watchlist(text,jsonb) from public;
grant execute on function public.replace_customer_service_watchlist(text,jsonb) to anon, authenticated;

create or replace function public.get_customer_service_cycle_cohorts(
  p_branch text,
  p_as_of_date date default current_date,
  p_cycles integer default 3
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_current_start date;
  v_elapsed integer;
  v_result jsonb;
begin
  if not public.dawaa_can_manage_customer_intelligence() then
    raise exception 'not authorized to view customer intelligence';
  end if;
  p_cycles := greatest(1, least(coalesce(p_cycles, 3), 12));
  v_current_start := case when extract(day from p_as_of_date) >= 26
    then date_trunc('month', p_as_of_date)::date + 25
    else (date_trunc('month', p_as_of_date) - interval '1 month')::date + 25 end;
  v_elapsed := greatest(0, p_as_of_date - v_current_start);

  with cycle_windows as (
    select offset_no,
      (v_current_start - make_interval(months => offset_no))::date as cycle_start,
      least(
        (v_current_start - make_interval(months => offset_no))::date + v_elapsed,
        (v_current_start - make_interval(months => offset_no - 1))::date - 1
      ) as period_end
    from generate_series(0, p_cycles - 1) offset_no
  ), invoice_base as (
    select coalesce(nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), ''), si.customer_id::text) customer_key,
      si.invoice_date::date sale_day,
      coalesce(si.net_amount, si.net_total, si.amount, si.total_amount, 0)::numeric amount
    from public.sales_invoices si
    where si.invoice_date::date >= (select min(cycle_start) - interval '2 months' from cycle_windows)
      and si.invoice_date::date <= p_as_of_date
      and (p_branch is null or si.branch = p_branch)
      and coalesce(nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), ''), si.customer_id::text) is not null
  ), cycle_customer as (
    select w.offset_no, w.cycle_start, w.period_end, i.customer_key,
      sum(i.amount) sales, count(*) invoices, min(i.sale_day) first_day
    from cycle_windows w join invoice_base i on i.sale_day between w.cycle_start and w.period_end
    group by w.offset_no, w.cycle_start, w.period_end, i.customer_key
  ), cycle_metrics as (
    select w.offset_no, w.cycle_start, w.period_end,
      count(c.customer_key)::integer customers_count,
      count(*) filter(where c.sales >= 4000)::integer important_count,
      count(*) filter(where c.sales >= 8000)::integer very_important_count,
      count(*) filter(where not exists(select 1 from invoice_base old_i where old_i.customer_key=c.customer_key and old_i.sale_day<w.cycle_start))::integer new_count,
      count(*) filter(where exists(select 1 from cycle_customer prev where prev.offset_no=w.offset_no+1 and prev.customer_key=c.customer_key))::integer continuing_count,
      count(*) filter(where not exists(select 1 from cycle_customer prev where prev.offset_no=w.offset_no+1 and prev.customer_key=c.customer_key)
        and exists(select 1 from invoice_base old_i where old_i.customer_key=c.customer_key and old_i.sale_day<w.cycle_start))::integer reactivated_count,
      coalesce(sum(c.invoices),0)::integer invoices_count,
      coalesce(sum(c.sales),0)::numeric sales_total
    from cycle_windows w left join cycle_customer c on c.offset_no=w.offset_no
    group by w.offset_no,w.cycle_start,w.period_end
  ), followup_metrics as (
    select w.offset_no, count(f.id)::integer followups_count,
      count(distinct coalesce(nullif(btrim(f.customer_code),''),f.customer_id::text,nullif(btrim(f.customer_phone),'')))::integer followed_customers,
      count(f.id) filter(where f.status='completed' or f.followup_status='completed' or f.completed_at is not null)::integer completed_followups,
      count(f.id) filter(where coalesce(f.purchase_after_followup,false))::integer purchase_after_followup_count,
      coalesce(sum(coalesce(f.purchase_amount,0)) filter(where coalesce(f.purchase_after_followup,false)),0)::numeric recovered_sales
    from cycle_windows w left join public.daily_followups f
      on f.created_at::date between w.cycle_start and w.period_end and (p_branch is null or f.branch=p_branch)
    group by w.offset_no
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offset',m.offset_no,'cycle_start',m.cycle_start,'period_end',m.period_end,
    'elapsed_days',m.period_end-m.cycle_start+1,'customers_count',m.customers_count,
    'important_count',m.important_count,'very_important_count',m.very_important_count,
    'new_count',m.new_count,'continuing_count',m.continuing_count,'reactivated_count',m.reactivated_count,
    'invoices_count',m.invoices_count,'sales_total',m.sales_total,
    'average_invoice',case when m.invoices_count>0 then round(m.sales_total/m.invoices_count,2) end,
    'followups_count',f.followups_count,'followed_customers',f.followed_customers,
    'completed_followups',f.completed_followups,
    'followup_completion_rate',case when f.followups_count>0 then round(f.completed_followups::numeric/f.followups_count*100,1) end,
    'purchase_after_followup_count',f.purchase_after_followup_count,'recovered_sales',f.recovered_sales
  ) order by m.offset_no), '[]'::jsonb) into v_result
  from cycle_metrics m join followup_metrics f using(offset_no);
  return v_result;
end;
$$;

revoke all on function public.get_customer_service_cycle_cohorts(text,date,integer) from public;
grant execute on function public.get_customer_service_cycle_cohorts(text,date,integer) to anon, authenticated;

create or replace function public.get_customer_service_watchlist_performance(
  p_branch text,
  p_as_of_date date default current_date,
  p_cycles integer default 3
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare v_current_start date; v_elapsed integer; v_result jsonb;
begin
  if not public.dawaa_can_manage_customer_intelligence() then raise exception 'not authorized'; end if;
  p_cycles := greatest(1, least(coalesce(p_cycles,3),12));
  v_current_start := case when extract(day from p_as_of_date)>=26 then date_trunc('month',p_as_of_date)::date+25 else (date_trunc('month',p_as_of_date)-interval '1 month')::date+25 end;
  v_elapsed := greatest(0,p_as_of_date-v_current_start);
  with windows as (
    select n offset_no,(v_current_start-make_interval(months=>n))::date cycle_start,
      least((v_current_start-make_interval(months=>n))::date+v_elapsed,(v_current_start-make_interval(months=>n-1))::date-1) period_end
    from generate_series(0,p_cycles-1) n
  ), performance as (
    select wl.id,wl.rank,wl.customer_code,wl.customer_name,wl.phone,w.offset_no,w.cycle_start,w.period_end,
      count(si.id)::integer invoice_count,
      coalesce(sum(coalesce(si.net_amount,si.net_total,si.amount,si.total_amount,0)),0)::numeric sales_total,
      max(si.invoice_date::date) last_purchase_date,
      (select count(*) from public.daily_followups f where f.branch=wl.branch and btrim(coalesce(f.customer_code,''))=wl.customer_code and f.created_at::date between w.cycle_start and w.period_end)::integer followups_count
    from public.customer_service_watchlist wl cross join windows w
    left join public.sales_invoices si on si.branch=wl.branch and btrim(coalesce(si.customer_code,''))=wl.customer_code and si.invoice_date::date between w.cycle_start and w.period_end
    where wl.active and wl.branch=p_branch
    group by wl.id,wl.rank,wl.customer_code,wl.customer_name,wl.phone,w.offset_no,w.cycle_start,w.period_end,wl.branch
  )
  select coalesce(jsonb_agg(customer_row order by rank),'[]'::jsonb) into v_result from (
    select rank,jsonb_build_object('rank',rank,'customer_code',customer_code,'customer_name',max(customer_name),'phone',max(phone),
      'cycles',jsonb_agg(jsonb_build_object('offset',offset_no,'cycle_start',cycle_start,'period_end',period_end,'sales_total',sales_total,'invoice_count',invoice_count,'followups_count',followups_count,'last_purchase_date',last_purchase_date) order by offset_no)) customer_row
    from performance group by rank,customer_code
  ) rows;
  return v_result;
end;
$$;

revoke all on function public.get_customer_service_watchlist_performance(text,date,integer) from public;
grant execute on function public.get_customer_service_watchlist_performance(text,date,integer) to anon, authenticated;

-- V3 differentiates an available module with zero activity from a genuinely unavailable source.
create or replace function public.calculate_weekly_manager_metrics_v3(
  p_evaluation_type text,p_branch text,p_week_start date,p_week_end date
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_catalog
as $$
declare v_result jsonb;
begin
  v_result := public.calculate_weekly_manager_metrics_v2(p_evaluation_type,p_branch,p_week_start,p_week_end);
  if p_evaluation_type='customer_service' then
    v_result := jsonb_set(v_result,'{data_coverage,followups}','true'::jsonb,true);
    v_result := jsonb_set(v_result,'{data_coverage,points}','true'::jsonb,true);
    v_result := jsonb_set(v_result,'{data_coverage,customers}','true'::jsonb,true);
    v_result := jsonb_set(v_result,'{data_coverage,reviews}','true'::jsonb,true);
  end if;
  return v_result;
end;
$$;
grant execute on function public.calculate_weekly_manager_metrics_v3(text,text,date,date) to anon, authenticated;
