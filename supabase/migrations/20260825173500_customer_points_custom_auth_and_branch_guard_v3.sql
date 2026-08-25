-- Restore customer-points RPC access for the app's custom-auth transport while
-- enforcing staff identity, permissions, and branch scope inside the database.

create or replace function public.dawaa_can_access_customer_points_branch_v1(p_branch text, p_manage boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with me as (
    select a.*
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active,false)=true
      and coalesce(a.can_login,false)=true
    limit 1
  )
  select exists (
    select 1
    from me
    where
      (
        lower(coalesce(role,'')) in ('admin','general_manager','executive_manager','branches_manager')
        or trim(coalesce(branch,'')) = trim(coalesce(p_branch,''))
      )
      and (
        case when p_manage then
          lower(coalesce(role,'')) in ('admin','general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service')
          or coalesce((permissions->>'manage_cashback')::boolean,false)
          or coalesce((permissions->>'view_customer_service')::boolean,false)
        else
          lower(coalesce(role,'')) in ('admin','general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service','pharmacist','shift_supervisor_morning','shift_supervisor_evening')
          or coalesce((permissions->>'view_customers')::boolean,false)
          or coalesce((permissions->>'view_customer_service')::boolean,false)
          or coalesce((permissions->>'view_cashback')::boolean,false)
        end
      )
  )
$$;

create or replace function public.get_customers_with_points_for_followup(p_branch text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if not public.dawaa_can_access_customer_points_branch_v1(p_branch,false) then
    raise exception 'غير مصرح بعرض نقاط عملاء هذا الفرع' using errcode='42501';
  end if;

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

create or replace function public.mark_customer_points_contacted(p_customer_code text,p_branch text,p_actor_name text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_start date;
  v_end date;
  v_count int := 0;
  v_cycle_id uuid;
  v_now timestamptz := now();
begin
  if not public.dawaa_can_access_customer_points_branch_v1(p_branch,true) then
    raise exception 'غير مصرح بتعديل حالة نقاط عملاء هذا الفرع' using errcode='42501';
  end if;

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
    values(v_cycle_id,v_cycle_id,p_customer_code,'notified','مزامنة تواصل من Points Truth v3',coalesce(nullif(p_actor_name,''),'غير محدد'),v_now);
  end if;

  return v_count;
end;
$$;

revoke all on function public.dawaa_can_access_customer_points_branch_v1(text,boolean) from public, anon, authenticated;
grant execute on function public.dawaa_can_access_customer_points_branch_v1(text,boolean) to anon, authenticated, service_role;

revoke all on function public.get_customers_with_points_for_followup(text) from public;
grant execute on function public.get_customers_with_points_for_followup(text) to anon, authenticated, service_role;

revoke all on function public.mark_customer_points_contacted(text,text,text) from public;
grant execute on function public.mark_customer_points_contacted(text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';