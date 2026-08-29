create or replace function public.dawaa_cleaning_timing_status_v1(p_time_slot text, p_submitted_at timestamptz)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_local time := (p_submitted_at at time zone 'Africa/Cairo')::time;
  v_slot text := trim(coalesce(p_time_slot,''));
begin
  if p_submitted_at is null then return 'unclassified'; end if;
  if v_slot = 'فتح' then
    return case when v_local >= time '06:00' and v_local <= time '11:00' then 'on_time' else 'outside_window' end;
  elsif v_slot = 'أثناء اليوم' then
    return case when v_local >= time '09:00' and v_local <= time '22:00' then 'on_time' else 'outside_window' end;
  elsif v_slot = 'قفل' then
    return case when v_local >= time '20:00' or v_local <= time '04:00' then 'on_time' else 'outside_window' end;
  end if;
  return 'unclassified';
end;
$$;

create or replace function public.get_cleaning_cycle_manager_summary_v1(
  p_month_cycle text default null,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  branch text,
  month_cycle text,
  cycle_start date,
  cycle_end date,
  rated_days integer,
  avg_stars numeric,
  total_star_points numeric,
  checklist_days integer,
  fully_reviewed_days integer,
  submitted_items integer,
  approved_items integer,
  rejected_items integer,
  pending_items integer,
  timing_attention_count integer,
  rating_coverage_pct numeric,
  on_time_pct numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_branch text := nullif(trim(coalesce(p_branch,'')), '');
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), public.dawaa_current_points_cycle_label_v1());
  v_cycle_month date;
  v_start date;
  v_end date;
begin
  if v_branch is not null and lower(v_branch) in ('كل الفروع','all','all branches','all_branches') then v_branch := null; end if;
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then raise exception 'not_authorized_for_branch'; end if;
    v_branch := v_actor_branch;
  end if;

  begin
    v_cycle_month := to_date(v_cycle || '-01','YYYY-MM-DD');
  exception when others then
    raise exception 'invalid_month_cycle';
  end;
  v_start := (date_trunc('month', v_cycle_month) - interval '1 month' + interval '25 days')::date;
  v_end := (date_trunc('month', v_cycle_month) + interval '24 days')::date;

  return query
  with cleaning_staff as (
    select s.id, s.name, s.branch
    from public.staff s
    where public.dawaa_is_cleaning_role_v1(s.role)
      and coalesce(s.active,s.is_active,true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and (v_branch is null or s.branch=v_branch)
  ), required as (
    select count(*)::integer as cnt
    from public.staff_daily_checklist_items i
    where i.active=true and i.role='مسؤولة النظافة'
  ), daily as (
    select sub.staff_id, sub.submission_date,
           count(*)::integer as submitted,
           count(*) filter(where sub.review_status='approved')::integer as approved,
           count(*) filter(where sub.review_status='rejected')::integer as rejected,
           count(*) filter(where sub.review_status='pending')::integer as pending,
           count(*) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,sub.submitted_at)='outside_window')::integer as timing_attention,
           count(*) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,sub.submitted_at)='on_time')::integer as on_time
    from public.staff_daily_checklist_submissions sub
    join public.staff_daily_checklist_items i on i.id=sub.item_id
    join cleaning_staff cs on cs.id=sub.staff_id
    where sub.submission_date between v_start and least(v_end,(timezone('Africa/Cairo',now()))::date)
      and i.role='مسؤولة النظافة'
    group by sub.staff_id,sub.submission_date
  ), checklist_agg as (
    select d.staff_id,
           count(*)::integer as checklist_days,
           count(*) filter(where d.submitted >= r.cnt and d.pending=0)::integer as fully_reviewed_days,
           coalesce(sum(d.submitted),0)::integer as submitted_items,
           coalesce(sum(d.approved),0)::integer as approved_items,
           coalesce(sum(d.rejected),0)::integer as rejected_items,
           coalesce(sum(d.pending),0)::integer as pending_items,
           coalesce(sum(d.timing_attention),0)::integer as timing_attention_count,
           coalesce(sum(d.on_time),0)::integer as on_time_items
    from daily d cross join required r
    group by d.staff_id
  ), rating_agg as (
    select r.staff_id,
           count(*)::integer as rated_days,
           round(avg(r.stars)::numeric,2) as avg_stars,
           coalesce(sum(r.points_delta),0)::numeric as total_star_points
    from public.cleaning_daily_ratings r
    join cleaning_staff cs on cs.id=r.staff_id
    where r.rating_date between v_start and v_end
    group by r.staff_id
  )
  select cs.id, cs.name, cs.branch, v_cycle, v_start, v_end,
         coalesce(ra.rated_days,0), coalesce(ra.avg_stars,0), coalesce(ra.total_star_points,0),
         coalesce(ca.checklist_days,0), coalesce(ca.fully_reviewed_days,0), coalesce(ca.submitted_items,0),
         coalesce(ca.approved_items,0), coalesce(ca.rejected_items,0), coalesce(ca.pending_items,0),
         coalesce(ca.timing_attention_count,0),
         case when coalesce(ca.fully_reviewed_days,0)>0 then round(coalesce(ra.rated_days,0)::numeric*100/ca.fully_reviewed_days,1) else 0 end,
         case when coalesce(ca.submitted_items,0)>0 then round(coalesce(ca.on_time_items,0)::numeric*100/ca.submitted_items,1) else 0 end
  from cleaning_staff cs
  left join checklist_agg ca on ca.staff_id=cs.id
  left join rating_agg ra on ra.staff_id=cs.id
  order by cs.branch,cs.name;
end;
$$;

revoke all on function public.get_cleaning_cycle_manager_summary_v1(text,text) from public;
grant execute on function public.get_cleaning_cycle_manager_summary_v1(text,text) to authenticated;
grant execute on function public.dawaa_cleaning_timing_status_v1(text,timestamptz) to authenticated;