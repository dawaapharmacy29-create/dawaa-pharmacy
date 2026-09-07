-- Weekly inventory progress read model v1
-- Reuses inventory_count_sessions + inventory_count_items as the evidence source.
-- Checklist assignments define who is accountable; the inventory module remains the
-- source of detailed count rows. Missing management plan is kept distinct from
-- employee non-completion so employees are never penalized for an unloaded list.

begin;

create or replace function public.get_branch_inventory_weekly_progress_v1(
  p_anchor_date date default (timezone('Africa/Cairo',now()))::date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  week_start date,
  week_end date,
  scheduled_workdays integer,
  elapsed_workdays integer,
  responsibility_count integer,
  session_count integer,
  total_items integer,
  counted_items integer,
  remaining_items integer,
  counted_today integer,
  discrepancy_items integer,
  unresolved_discrepancies integer,
  reviewed_discrepancies integer,
  progress_pct numeric,
  expected_progress_pct numeric,
  plan_state text,
  pace_state text
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_role text;
  v_global boolean;
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_anchor date:=coalesce(p_anchor_date,(timezone('Africa/Cairo',now()))::date);
  v_week_start date:=date_trunc('week',v_anchor::timestamp)::date;
  v_week_end date:=date_trunc('week',v_anchor::timestamp)::date+6;
begin
  select * into v_account
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)
    and coalesce(can_login,false);

  if not found then
    raise exception using errcode='42501',message='active staff actor required';
  end if;

  v_role:=lower(trim(coalesce(v_account.role,'')));
  v_global:=v_role in ('general_manager','executive_manager','branches_manager','admin');

  if not (v_global or v_role='branch_manager') then
    raise exception using errcode='42501',message='manager role required';
  end if;
  if not public.user_has_permission(v_account.id,'view_team') then
    raise exception using errcode='42501',message='view_team permission required';
  end if;

  if not v_global then
    if nullif(trim(coalesce(v_account.branch,'')),'') is null then
      raise exception using errcode='42501',message='manager branch required';
    end if;
    if v_branch is not null
       and public.dawaa_review_coverage_branch_key_v1(v_branch)<>
           public.dawaa_review_coverage_branch_key_v1(v_account.branch) then
      raise exception using errcode='42501',message='not authorized for branch';
    end if;
    v_branch:=v_account.branch;
  end if;

  return query
  with responsibility as (
    select
      a.staff_id,
      a.branch,
      count(distinct a.id)::integer responsibility_count
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i
      on i.id=a.item_id
     and i.active=true
     and i.operation_category='inventory'
    where a.active=true
      and a.active_from<=v_week_end
      and (a.active_to is null or a.active_to>=v_week_start)
      and (
        v_branch is null
        or public.dawaa_review_coverage_branch_key_v1(a.branch)=
           public.dawaa_review_coverage_branch_key_v1(v_branch)
      )
    group by a.staff_id,a.branch
  ), workdays as (
    select
      r.staff_id,
      count(*) filter(
        where public.dawaa_staff_scheduled_workday_v1(r.staff_id,d::date)
      )::integer scheduled_workdays,
      -- Only fully elapsed workdays drive the expected pace. The current workday
      -- is reported separately through counted_today and never marks somebody
      -- behind before their day has finished.
      count(*) filter(
        where d::date<v_anchor
          and public.dawaa_staff_scheduled_workday_v1(r.staff_id,d::date)
      )::integer elapsed_workdays
    from responsibility r
    cross join lateral generate_series(v_week_start,v_week_end,interval '1 day') d
    group by r.staff_id
  ), sessions as (
    select
      r.staff_id,
      r.branch,
      count(distinct s.id)::integer session_count
    from responsibility r
    left join public.inventory_count_sessions s
      on s.responsible_staff_id=r.staff_id
     and public.dawaa_review_coverage_branch_key_v1(s.branch)=
         public.dawaa_review_coverage_branch_key_v1(r.branch)
     and s.due_date between v_week_start and v_week_end
     and lower(trim(coalesce(s.status,''))) not in ('cancelled','canceled')
    group by r.staff_id,r.branch
  ), item_agg as (
    select
      r.staff_id,
      r.branch,
      count(it.id)::integer total_items,
      count(it.id) filter(where it.actual_qty is not null)::integer counted_items,
      count(it.id) filter(
        where it.actual_qty is not null
          and (it.updated_at at time zone 'Africa/Cairo')::date=v_anchor
      )::integer counted_today,
      count(it.id) filter(where coalesce(it.difference,0)<>0)::integer discrepancy_items,
      count(it.id) filter(
        where coalesce(it.difference,0)<>0
          and it.reviewed_qty is null
          and nullif(trim(coalesce(it.review_result,'')),'') is null
      )::integer unresolved_discrepancies,
      count(it.id) filter(
        where coalesce(it.difference,0)<>0
          and (it.reviewed_qty is not null or nullif(trim(coalesce(it.review_result,'')),'') is not null)
      )::integer reviewed_discrepancies
    from responsibility r
    left join public.inventory_count_sessions s
      on s.responsible_staff_id=r.staff_id
     and public.dawaa_review_coverage_branch_key_v1(s.branch)=
         public.dawaa_review_coverage_branch_key_v1(r.branch)
     and s.due_date between v_week_start and v_week_end
     and lower(trim(coalesce(s.status,''))) not in ('cancelled','canceled')
    left join public.inventory_count_items it on it.session_id=s.id
    group by r.staff_id,r.branch
  ), final as (
    select
      r.staff_id,
      st.name staff_name,
      st.role staff_role,
      r.branch,
      r.responsibility_count,
      coalesce(w.scheduled_workdays,0) scheduled_workdays,
      coalesce(w.elapsed_workdays,0) elapsed_workdays,
      coalesce(se.session_count,0) session_count,
      coalesce(ia.total_items,0) total_items,
      coalesce(ia.counted_items,0) counted_items,
      greatest(coalesce(ia.total_items,0)-coalesce(ia.counted_items,0),0)::integer remaining_items,
      coalesce(ia.counted_today,0) counted_today,
      coalesce(ia.discrepancy_items,0) discrepancy_items,
      coalesce(ia.unresolved_discrepancies,0) unresolved_discrepancies,
      coalesce(ia.reviewed_discrepancies,0) reviewed_discrepancies,
      case
        when coalesce(ia.total_items,0)=0 then 0::numeric
        else round(100*coalesce(ia.counted_items,0)::numeric/ia.total_items,1)
      end progress_pct,
      case
        when coalesce(w.scheduled_workdays,0)=0 then 0::numeric
        else round(100*least(coalesce(w.elapsed_workdays,0),w.scheduled_workdays)::numeric/w.scheduled_workdays,1)
      end expected_progress_pct
    from responsibility r
    join public.staff st on st.id=r.staff_id and coalesce(st.active,true)=true
    left join workdays w on w.staff_id=r.staff_id
    left join sessions se on se.staff_id=r.staff_id
      and public.dawaa_review_coverage_branch_key_v1(se.branch)=public.dawaa_review_coverage_branch_key_v1(r.branch)
    left join item_agg ia on ia.staff_id=r.staff_id
      and public.dawaa_review_coverage_branch_key_v1(ia.branch)=public.dawaa_review_coverage_branch_key_v1(r.branch)
  )
  select
    f.staff_id,f.staff_name,f.staff_role,f.branch,
    v_week_start,v_week_end,
    f.scheduled_workdays,f.elapsed_workdays,f.responsibility_count,
    f.session_count,f.total_items,f.counted_items,f.remaining_items,f.counted_today,
    f.discrepancy_items,f.unresolved_discrepancies,f.reviewed_discrepancies,
    f.progress_pct,f.expected_progress_pct,
    case
      when f.session_count=0 then 'missing_session'
      when f.total_items=0 then 'missing_list'
      when f.counted_items>=f.total_items then 'completed'
      when f.counted_items>0 then 'in_progress'
      else 'ready_not_started'
    end::text plan_state,
    case
      when f.session_count=0 or f.total_items=0 then 'not_measurable'
      when f.counted_items>=f.total_items then 'completed'
      when f.progress_pct+10 < f.expected_progress_pct then 'behind'
      when f.progress_pct > f.expected_progress_pct+10 then 'ahead'
      else 'on_track'
    end::text pace_state
  from final f
  order by f.branch,f.staff_name;
end;
$$;

revoke all on function public.get_branch_inventory_weekly_progress_v1(date,text) from public;
grant execute on function public.get_branch_inventory_weekly_progress_v1(date,text) to anon,authenticated;

create index if not exists idx_inventory_count_sessions_staff_week
  on public.inventory_count_sessions(responsible_staff_id,branch,due_date,status);
create index if not exists idx_inventory_count_items_session_progress
  on public.inventory_count_items(session_id,actual_qty,updated_at);
create index if not exists idx_inventory_count_items_session_difference
  on public.inventory_count_items(session_id,difference,reviewed_qty,review_result);

commit;
