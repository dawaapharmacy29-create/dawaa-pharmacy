-- Cleaning Governance V3 runtime: snapshot every cleaning day, lock the checklist after rating,
-- and make cycle summaries read stored history instead of today's active task count.

create or replace function public.sync_cleaning_day_governance_snapshot_v3(
  p_staff_id uuid,
  p_snapshot_date date default (timezone('Africa/Cairo',now()))::date
)
returns public.cleaning_daily_governance_snapshots
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
  v_existing public.cleaning_daily_governance_snapshots%rowtype;
  v_saved public.cleaning_daily_governance_snapshots%rowtype;
  v_date date := coalesce(p_snapshot_date,(timezone('Africa/Cairo',now()))::date);
  v_cycle text;
  v_required integer := 0;
  v_submitted integer := 0;
  v_reviewed integer := 0;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_pending integer := 0;
  v_max_stars integer := 0;
  v_ready boolean := false;
  v_timing_attention integer := 0;
  v_on_time integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then raise exception 'cleaning_staff_not_found'; end if;

  select * into v_existing from public.cleaning_daily_governance_snapshots
  where staff_id=p_staff_id and snapshot_date=v_date for update;
  if found and exists(
    select 1 from public.cleaning_daily_ratings r
    where r.staff_id=p_staff_id and r.rating_date=v_date and r.governance_snapshot_id=v_existing.id
  ) then return v_existing; end if;

  select
    count(*)::integer,
    count(s.id)::integer,
    count(s.id) filter(where s.review_status in ('approved','rejected'))::integer,
    count(s.id) filter(where s.review_status='approved')::integer,
    count(s.id) filter(where s.review_status='rejected')::integer,
    count(s.id) filter(where s.review_status='pending')::integer,
    count(s.id) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at)='outside_window')::integer,
    count(s.id) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at)='on_time')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'item_id',i.id,'item_key',i.item_key,'title',i.title,'time_slot',i.time_slot,
      'requires_photo',i.requires_photo,'rule_key_on_fail',i.rule_key_on_fail,
      'submitted',s.id is not null,'submission_id',s.id,'review_status',s.review_status,
      'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at,'reviewed_by_name',s.reviewed_by_name,
      'timing_status',case when s.id is null then null else public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at) end
    ) order by i.sort_order nulls last,i.item_key),'[]'::jsonb)
  into v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending,v_timing_attention,v_on_time,v_items
  from public.staff_daily_checklist_items i
  left join public.staff_daily_checklist_submissions s
    on s.item_id=i.id and s.staff_id=p_staff_id and s.submission_date=v_date
  where i.active=true and trim(coalesce(i.role,''))=trim(coalesce(v_staff.role,''));

  v_ready:=v_required>0 and v_submitted>=v_required and v_reviewed>=v_required and v_pending=0;
  v_max_stars:=case
    when v_required<=0 then 1 when v_reviewed<v_required then 0 when v_approved>=v_required then 5
    when v_approved::numeric/v_required>=0.83 then 4 when v_approved::numeric/v_required>=0.67 then 3
    when v_approved::numeric/v_required>=0.50 then 2 else 1 end;
  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_date);

  insert into public.cleaning_daily_governance_snapshots(
    staff_id,branch,snapshot_date,month_cycle,governance_version,
    required_items,submitted_items,reviewed_items,approved_items,rejected_items,pending_items,
    max_stars,rating_ready,timing_attention_items,on_time_items,checklist_snapshot,finalized_at,updated_at
  ) values(
    p_staff_id,coalesce(v_staff.branch,''),v_date,v_cycle,3,
    v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending,
    v_max_stars,v_ready,v_timing_attention,v_on_time,v_items,case when v_ready then now() else null end,now()
  ) on conflict(staff_id,snapshot_date) do update set
    branch=excluded.branch,month_cycle=excluded.month_cycle,governance_version=excluded.governance_version,
    required_items=excluded.required_items,submitted_items=excluded.submitted_items,reviewed_items=excluded.reviewed_items,
    approved_items=excluded.approved_items,rejected_items=excluded.rejected_items,pending_items=excluded.pending_items,
    max_stars=excluded.max_stars,rating_ready=excluded.rating_ready,
    timing_attention_items=excluded.timing_attention_items,on_time_items=excluded.on_time_items,
    checklist_snapshot=excluded.checklist_snapshot,
    finalized_at=case when excluded.rating_ready then coalesce(public.cleaning_daily_governance_snapshots.finalized_at,now()) else null end,
    updated_at=now()
  returning * into v_saved;
  return v_saved;
end;
$function$;

revoke all on function public.sync_cleaning_day_governance_snapshot_v3(uuid,date) from public,anon,authenticated;

create or replace function public.submit_my_staff_daily_checklist_v1(p_item_id uuid,p_photo_url text default null,p_staff_note text default null)
returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_subject public.staff%rowtype;
  v_item public.staff_daily_checklist_items%rowtype;
  v_today date := (timezone('Africa/Cairo',now()))::date;
  v_row public.staff_daily_checklist_submissions%rowtype;
begin
  select * into v_account from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  v_subject_id:=public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode='42501',message='canonical staff identity required'; end if;
  select * into v_subject from public.staff where id=v_subject_id;
  if not found then raise exception using errcode='42501',message='canonical staff record required'; end if;
  select * into v_item from public.staff_daily_checklist_items where id=p_item_id and active=true;
  if not found then raise exception using errcode='22023',message='active checklist item required'; end if;
  if trim(coalesce(v_item.role,''))<>trim(coalesce(v_subject.role,'')) then raise exception using errcode='42501',message='checklist item does not belong to staff role'; end if;
  if v_item.requires_photo and nullif(trim(coalesce(p_photo_url,'')),'') is null then raise exception using errcode='22023',message='checklist evidence photo required'; end if;
  if public.dawaa_is_cleaning_role_v1(v_subject.role) and exists(
    select 1 from public.cleaning_daily_ratings r where r.staff_id=v_subject_id and r.rating_date=v_today
  ) then raise exception using errcode='55000',message='cleaning_day_already_rated'; end if;

  insert into public.staff_daily_checklist_submissions(
    staff_id,item_id,submission_date,branch,completed,photo_url,staff_note,
    submitted_at,review_status,reviewed_by,reviewed_by_name,reviewer_note,reviewed_at
  ) values(
    v_subject_id,p_item_id,v_today,trim(coalesce(v_subject.branch,v_account.branch,'')),true,
    nullif(trim(coalesce(p_photo_url,'')),''),nullif(trim(coalesce(p_staff_note,'')),''),
    now(),'pending',null,null,null,null
  ) on conflict(staff_id,item_id,submission_date) do update set
    branch=excluded.branch,completed=true,photo_url=excluded.photo_url,staff_note=excluded.staff_note,
    submitted_at=excluded.submitted_at,review_status='pending',reviewed_by=null,reviewed_by_name=null,
    reviewer_note=null,reviewed_at=null,updated_at=now()
  returning * into v_row;
  if public.dawaa_is_cleaning_role_v1(v_subject.role) then perform public.sync_cleaning_day_governance_snapshot_v3(v_subject_id,v_today); end if;
  return v_row;
end;
$function$;

create or replace function public.review_staff_daily_checklist_v1(p_submission_id uuid,p_status text,p_reviewer_note text default null)
returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_target public.staff_daily_checklist_submissions%rowtype;
  v_row public.staff_daily_checklist_submissions%rowtype;
  v_role text;
  v_staff_role text;
begin
  if p_status not in ('approved','rejected') then raise exception using errcode='22023',message='invalid checklist review status'; end if;
  if p_status='rejected' and nullif(trim(coalesce(p_reviewer_note,'')),'') is null then raise exception using errcode='22023',message='rejection note required'; end if;
  select * into v_account from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  select * into v_target from public.staff_daily_checklist_submissions where id=p_submission_id for update;
  if not found then raise exception using errcode='22023',message='checklist submission not found'; end if;
  select role into v_staff_role from public.staff where id=v_target.staff_id;
  if public.dawaa_is_cleaning_role_v1(v_staff_role) and exists(
    select 1 from public.cleaning_daily_ratings r where r.staff_id=v_target.staff_id and r.rating_date=v_target.submission_date
  ) then raise exception using errcode='55000',message='cleaning_day_already_rated'; end if;
  v_role:=lower(trim(coalesce(v_account.role,'')));
  if not public.user_has_permission(v_account.id,'view_team') then raise exception using errcode='42501',message='checklist review permission required'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)<>public.dawaa_review_coverage_branch_key_v1(v_target.branch) then
    raise exception using errcode='42501',message='checklist review branch scope denied'; end if;
  update public.staff_daily_checklist_submissions set
    review_status=p_status,reviewed_by=v_account.id,
    reviewed_by_name=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username),
    reviewer_note=case when p_status='rejected' then nullif(trim(coalesce(p_reviewer_note,'')),'') else null end,
    reviewed_at=now(),updated_at=now()
  where id=p_submission_id returning * into v_row;
  if public.dawaa_is_cleaning_role_v1(v_staff_role) then perform public.sync_cleaning_day_governance_snapshot_v3(v_target.staff_id,v_target.submission_date); end if;
  return v_row;
end;
$function$;

create or replace function public.rate_cleaning_staff_day_v1(p_staff_id uuid,p_stars integer,p_manager_note text default null,p_rating_date date default current_date)
returns public.cleaning_daily_ratings
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_staff public.staff%rowtype;
  v_rating public.cleaning_daily_ratings%rowtype;
  v_points numeric;
  v_cycle text;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_existing_tx uuid;
  v_snap public.cleaning_daily_governance_snapshots%rowtype;
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  if p_stars<1 or p_stars>5 then raise exception 'stars_must_be_between_1_and_5'; end if;
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then raise exception 'cleaning_staff_not_found'; end if;
  if not v_global and coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then raise exception 'not_authorized_for_branch'; end if;

  v_snap:=public.sync_cleaning_day_governance_snapshot_v3(p_staff_id,v_date);
  if not coalesce(v_snap.rating_ready,false) then raise exception 'cleaning_checklist_review_incomplete'; end if;
  if p_stars>coalesce(v_snap.max_stars,1) then raise exception 'stars_exceed_checklist_cap:%',v_snap.max_stars; end if;

  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;
  v_points:=public.dawaa_cleaning_star_points_v1(p_stars);
  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_date);

  insert into public.cleaning_daily_ratings(
    staff_id,branch,rating_date,stars,score_pct,points_delta,month_cycle,manager_note,rated_by,rated_by_name,
    governance_snapshot_id,governance_version,required_items_snapshot,submitted_items_snapshot,reviewed_items_snapshot,
    approved_items_snapshot,rejected_items_snapshot,pending_items_snapshot,max_stars_snapshot
  ) values(
    p_staff_id,v_staff.branch,v_date,p_stars,p_stars*20,v_points,v_cycle,nullif(trim(coalesce(p_manager_note,'')),''),v_actor_id,v_actor_name,
    v_snap.id,v_snap.governance_version,v_snap.required_items,v_snap.submitted_items,v_snap.reviewed_items,
    v_snap.approved_items,v_snap.rejected_items,v_snap.pending_items,v_snap.max_stars
  ) on conflict(staff_id,rating_date) do update set
    stars=excluded.stars,score_pct=excluded.score_pct,points_delta=excluded.points_delta,month_cycle=excluded.month_cycle,
    manager_note=excluded.manager_note,rated_by=excluded.rated_by,rated_by_name=excluded.rated_by_name,branch=excluded.branch,
    governance_snapshot_id=excluded.governance_snapshot_id,governance_version=excluded.governance_version,
    required_items_snapshot=excluded.required_items_snapshot,submitted_items_snapshot=excluded.submitted_items_snapshot,
    reviewed_items_snapshot=excluded.reviewed_items_snapshot,approved_items_snapshot=excluded.approved_items_snapshot,
    rejected_items_snapshot=excluded.rejected_items_snapshot,pending_items_snapshot=excluded.pending_items_snapshot,
    max_stars_snapshot=excluded.max_stars_snapshot,updated_at=now()
  returning * into v_rating;

  select et.id into v_existing_tx from public.employee_transactions et
  where et.staff_id=p_staff_id and et.month_cycle=v_cycle and et.source='cleaning_daily_star_rating' and et.source_id=v_rating.id
  order by et.updated_at desc nulls last,et.created_at desc nulls last limit 1;
  if v_existing_tx is null then
    insert into public.employee_transactions(staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,source,source_id,transaction_date,month_cycle,branch,status,category,created_by,created_by_name,approved_by,approved_by_name,approved_at,employee_visible,metadata)
    values(p_staff_id,p_staff_id,v_staff.name,case when v_points<0 then 'penalty' else 'reward' end,'تقييم النظافة اليومي بالنجوم',format('تقييم يومي: %s/5 نجوم (%s%%)',p_stars,p_stars*20),nullif(trim(coalesce(p_manager_note,'')),''),0,abs(v_points),v_points,v_points,'cleaning_daily_star_rating',v_rating.id,v_date,v_cycle,v_staff.branch,'active','النظافة والتشغيل',v_actor_id,v_actor_name,v_actor_id,v_actor_name,now(),true,
      jsonb_build_object('engine_version',5,'policy_version',3,'governance_version',v_snap.governance_version,'governance_snapshot_id',v_snap.id,'stars',p_stars,'score_pct',p_stars*20,'rating_date',v_date,'rule_code','CLEAN-DAILY-STAR-V3','checklist_max_stars',v_snap.max_stars,'required_items',v_snap.required_items,'submitted_items',v_snap.submitted_items,'reviewed_items',v_snap.reviewed_items,'approved_items',v_snap.approved_items,'rejected_items',v_snap.rejected_items,'pending_items',v_snap.pending_items));
  else
    update public.employee_transactions set
      type=case when v_points<0 then 'penalty' else 'reward' end,points=abs(v_points),points_delta=v_points,final_points=v_points,
      reason=format('تقييم يومي: %s/5 نجوم (%s%%)',p_stars,p_stars*20),description=nullif(trim(coalesce(p_manager_note,'')),''),
      transaction_date=v_date,branch=v_staff.branch,status='active',category='النظافة والتشغيل',approved_by=v_actor_id,approved_by_name=v_actor_name,approved_at=now(),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('engine_version',5,'policy_version',3,'governance_version',v_snap.governance_version,'governance_snapshot_id',v_snap.id,'stars',p_stars,'score_pct',p_stars*20,'rating_date',v_date,'rule_code','CLEAN-DAILY-STAR-V3','checklist_max_stars',v_snap.max_stars,'required_items',v_snap.required_items,'submitted_items',v_snap.submitted_items,'reviewed_items',v_snap.reviewed_items,'approved_items',v_snap.approved_items,'rejected_items',v_snap.rejected_items,'pending_items',v_snap.pending_items)
    where id=v_existing_tx;
  end if;
  return v_rating;
end;
$function$;

create or replace function public.get_cleaning_cycle_rating_summary_v1(p_staff_id uuid,p_month_cycle text default null)
returns table(staff_id uuid,month_cycle text,rated_days integer,five_star_days integer,avg_stars numeric,avg_score_pct numeric,total_star_points numeric,performance_band text)
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_self text:=public.dawaa_current_staff_id_v1();
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_staff_branch text;
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  select branch into v_staff_branch from public.staff where id=p_staff_id;
  if not (p_staff_id::text=coalesce(v_self,'') or v_global or (v_role='branch_manager' and coalesce(v_staff_branch,'')=coalesce(v_actor_branch,''))) then raise exception 'not_authorized'; end if;
  return query
  with valid_ratings as (
    select r.* from public.cleaning_daily_ratings r
    join public.cleaning_daily_governance_snapshots g on g.id=r.governance_snapshot_id
    where r.staff_id=p_staff_id and r.month_cycle=v_cycle
      and coalesce(r.governance_version,0)>=3 and g.governance_version>=3 and g.rating_ready=true
      and g.required_items>0 and g.submitted_items>=g.required_items and g.reviewed_items>=g.required_items and g.pending_items=0
  )
  select p_staff_id,v_cycle,count(*)::integer,count(*) filter(where r.stars=5)::integer,
    round(avg(r.stars)::numeric,2),round(avg(r.score_pct)::numeric,1),coalesce(sum(r.points_delta),0)::numeric,
    case when count(*)=0 then 'لم يبدأ التقييم' when avg(r.stars)>=4.8 then 'استثنائي' when avg(r.stars)>=4.5 then 'ممتاز' when avg(r.stars)>=4.0 then 'جيد جدًا' when avg(r.stars)>=3.5 then 'جيد' else 'يحتاج تحسين' end
  from valid_ratings r;
end;
$function$;

create or replace function public.get_cleaning_cycle_manager_summary_v1(p_month_cycle text default null,p_branch text default null)
returns table(staff_id uuid,staff_name text,branch text,month_cycle text,cycle_start date,cycle_end date,rated_days integer,avg_stars numeric,total_star_points numeric,checklist_days integer,fully_reviewed_days integer,submitted_items integer,approved_items integer,rejected_items integer,pending_items integer,timing_attention_count integer,rating_coverage_pct numeric,on_time_pct numeric)
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_cycle_month date; v_start date; v_end date;
begin
  if v_branch is not null and lower(v_branch) in ('كل الفروع','all','all branches','all_branches') then v_branch:=null; end if;
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then raise exception 'not_authorized_for_branch'; end if;
    v_branch:=v_actor_branch;
  end if;
  begin v_cycle_month:=to_date(v_cycle||'-01','YYYY-MM-DD'); exception when others then raise exception 'invalid_month_cycle'; end;
  v_start:=(date_trunc('month',v_cycle_month)-interval '1 month'+interval '25 days')::date;
  v_end:=(date_trunc('month',v_cycle_month)+interval '24 days')::date;
  return query
  with cleaning_staff as (
    select s.id,s.name,s.branch from public.staff s
    where public.dawaa_is_cleaning_role_v1(s.role)
      and coalesce(s.active,s.is_active,true) and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and (v_branch is null or s.branch=v_branch)
  ), snap_agg as (
    select g.staff_id,count(*)::integer checklist_days,
      count(*) filter(where g.rating_ready=true)::integer fully_reviewed_days,
      coalesce(sum(g.submitted_items),0)::integer submitted_items,
      coalesce(sum(g.approved_items),0)::integer approved_items,
      coalesce(sum(g.rejected_items),0)::integer rejected_items,
      coalesce(sum(g.pending_items),0)::integer pending_items,
      coalesce(sum(g.timing_attention_items),0)::integer timing_attention_count,
      coalesce(sum(g.on_time_items),0)::integer on_time_items
    from public.cleaning_daily_governance_snapshots g join cleaning_staff cs on cs.id=g.staff_id
    where g.month_cycle=v_cycle and g.snapshot_date between v_start and v_end group by g.staff_id
  ), valid_rating_agg as (
    select r.staff_id,count(*)::integer rated_days,round(avg(r.stars)::numeric,2) avg_stars,coalesce(sum(r.points_delta),0)::numeric total_star_points
    from public.cleaning_daily_ratings r
    join public.cleaning_daily_governance_snapshots g on g.id=r.governance_snapshot_id
    join cleaning_staff cs on cs.id=r.staff_id
    where r.month_cycle=v_cycle and r.rating_date between v_start and v_end
      and coalesce(r.governance_version,0)>=3 and g.governance_version>=3 and g.rating_ready=true
      and g.required_items>0 and g.submitted_items>=g.required_items and g.reviewed_items>=g.required_items and g.pending_items=0
    group by r.staff_id
  )
  select cs.id,cs.name,cs.branch,v_cycle,v_start,v_end,
    coalesce(ra.rated_days,0),coalesce(ra.avg_stars,0),coalesce(ra.total_star_points,0),
    coalesce(sa.checklist_days,0),coalesce(sa.fully_reviewed_days,0),coalesce(sa.submitted_items,0),
    coalesce(sa.approved_items,0),coalesce(sa.rejected_items,0),coalesce(sa.pending_items,0),coalesce(sa.timing_attention_count,0),
    case when coalesce(sa.fully_reviewed_days,0)>0 then round(coalesce(ra.rated_days,0)::numeric*100/sa.fully_reviewed_days,1) else 0 end,
    case when coalesce(sa.submitted_items,0)>0 then round(coalesce(sa.on_time_items,0)::numeric*100/sa.submitted_items,1) else 0 end
  from cleaning_staff cs left join snap_agg sa on sa.staff_id=cs.id left join valid_rating_agg ra on ra.staff_id=cs.id
  order by cs.branch,cs.name;
end;
$function$;
