-- Branch checklist governance convergence v1
-- One canonical path for due work, evidence, manager review, daily quality rating,
-- and points projection. Rejected checklist items are the sole negative-points evidence;
-- daily star ratings may only create quality bonuses, preventing double penalties.

begin;

-- ---------------------------------------------------------------------------
-- A. Preserve the exact assignment that produced every submission.
-- ---------------------------------------------------------------------------
alter table public.staff_daily_checklist_submissions
  add column if not exists assignment_id uuid null
  references public.staff_daily_checklist_assignments(id) on delete restrict;

create index if not exists idx_staff_daily_checklist_submissions_assignment
  on public.staff_daily_checklist_submissions(assignment_id,submission_date);

-- Best-effort historical backfill. If more than one historical assignment can match,
-- prefer the most recent assignment that was active for the submission date.
update public.staff_daily_checklist_submissions s
set assignment_id=(
  select a.id
  from public.staff_daily_checklist_assignments a
  where a.staff_id=s.staff_id
    and a.item_id=s.item_id
    and public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(s.branch)
    and s.submission_date>=a.active_from
    and (a.active_to is null or s.submission_date<=a.active_to)
  order by a.active_from desc,a.created_at desc,a.id desc
  limit 1
)
where s.assignment_id is null
  and exists(
    select 1
    from public.staff_daily_checklist_assignments a
    where a.staff_id=s.staff_id
      and a.item_id=s.item_id
      and public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(s.branch)
      and s.submission_date>=a.active_from
      and (a.active_to is null or s.submission_date<=a.active_to)
  );

-- ---------------------------------------------------------------------------
-- B. Canonical due helper used by employee UI, submission, snapshots and ratings.
-- ---------------------------------------------------------------------------
create or replace function public.dawaa_staff_checklist_assignment_due_v1(
  p_staff_id uuid,
  p_cadence text,
  p_weekday smallint,
  p_active_from date,
  p_active_to date,
  p_workdays_only boolean,
  p_target_date date
)
returns boolean
language sql
stable
security invoker
set search_path=public,pg_catalog
as $$
  select public.dawaa_checklist_assignment_due_v1(
           p_cadence,p_weekday,p_active_from,p_active_to,p_target_date
         )
         and (
           not coalesce(p_workdays_only,false)
           or public.dawaa_staff_scheduled_workday_v1(p_staff_id,p_target_date)
         );
$$;

revoke all on function public.dawaa_staff_checklist_assignment_due_v1(uuid,text,smallint,date,date,boolean,date) from public;
grant execute on function public.dawaa_staff_checklist_assignment_due_v1(uuid,text,smallint,date,date,boolean,date) to anon,authenticated;

-- Daily star rating is a quality bonus only. Task rejection is already projected by
-- settle_checklist_review / reconcile_cleaning_checklist_penalties_v2.
create or replace function public.dawaa_checklist_daily_quality_bonus_v1(
  p_stars integer,
  p_rejected_items integer default 0
)
returns numeric
language sql
immutable
security invoker
set search_path=public,pg_catalog
as $$
  select case
    when coalesce(p_rejected_items,0)>0 then 0::numeric
    when p_stars=5 then 5::numeric
    when p_stars=4 then 2::numeric
    else 0::numeric
  end;
$$;

revoke all on function public.dawaa_checklist_daily_quality_bonus_v1(integer,integer) from public;
grant execute on function public.dawaa_checklist_daily_quality_bonus_v1(integer,integer) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- C. Scope assignment visibility by canonical employee/branch.
-- ---------------------------------------------------------------------------
drop policy if exists staff_daily_checklist_assignments_scoped_select_v1 on public.staff_daily_checklist_assignments;
drop policy if exists staff_daily_checklist_assignments_scoped_select_v2 on public.staff_daily_checklist_assignments;
create policy staff_daily_checklist_assignments_scoped_select_v2
on public.staff_daily_checklist_assignments
for select to anon,authenticated
using (
  public.dawaa_current_staff_account_id_strict() is not null
  and (
    staff_id=public.dawaa_current_staff_subject_uuid_v1()
    or (
      public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
      and (
        lower(trim(coalesce(public.employee_operating_actor_role(),''))) in
          ('general_manager','executive_manager','branches_manager','admin')
        or public.dawaa_review_coverage_branch_key_v1(branch)=
           public.dawaa_review_coverage_branch_key_v1(public.employee_operating_actor_branch())
      )
    )
  )
);

-- Item visibility now consumes the same canonical due helper.
drop policy if exists staff_daily_checklist_items_scoped_select_v3 on public.staff_daily_checklist_items;
drop policy if exists staff_daily_checklist_items_scoped_select_v4 on public.staff_daily_checklist_items;
create policy staff_daily_checklist_items_scoped_select_v4
on public.staff_daily_checklist_items
for select to anon,authenticated
using (
  active
  and public.dawaa_current_staff_account_id_strict() is not null
  and (
    public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
    or exists (
      select 1
      from public.staff_daily_checklist_assignments a
      where a.item_id=staff_daily_checklist_items.id
        and a.staff_id=public.dawaa_current_staff_subject_uuid_v1()
        and a.active=true
        and public.dawaa_staff_checklist_assignment_due_v1(
          a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,
          (timezone('Africa/Cairo',now()))::date
        )
    )
  )
);

-- ---------------------------------------------------------------------------
-- D. Submission: exact assignment + workday + photo evidence + rating lock.
-- ---------------------------------------------------------------------------
create or replace function public.submit_my_staff_daily_checklist_v1(
  p_item_id uuid,
  p_photo_url text default null,
  p_staff_note text default null
)
returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path='public','auth','pg_catalog'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_subject public.staff%rowtype;
  v_item public.staff_daily_checklist_items%rowtype;
  v_assignment public.staff_daily_checklist_assignments%rowtype;
  v_today date:=(timezone('Africa/Cairo',now()))::date;
  v_row public.staff_daily_checklist_submissions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  v_subject_id:=public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode='42501',message='canonical staff identity required'; end if;

  select * into v_subject from public.staff
  where id=v_subject_id and coalesce(active,true)=true;
  if not found then raise exception using errcode='42501',message='canonical active staff record required'; end if;

  select * into v_item from public.staff_daily_checklist_items
  where id=p_item_id and active=true;
  if not found then raise exception using errcode='22023',message='active checklist item required'; end if;

  select a.* into v_assignment
  from public.staff_daily_checklist_assignments a
  where a.item_id=p_item_id
    and a.staff_id=v_subject_id
    and public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_subject.branch)
    and a.active=true
    and public.dawaa_staff_checklist_assignment_due_v1(
      a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_today
    )
  order by a.active_from desc,a.created_at desc,a.id desc
  limit 1;
  if not found then
    raise exception using errcode='42501',message='checklist task is not assigned/due for this employee on this workday';
  end if;

  if v_item.requires_photo and nullif(trim(coalesce(p_photo_url,'')),'') is null then
    raise exception using errcode='22023',message='checklist evidence photo required';
  end if;

  if public.dawaa_is_cleaning_role_v1(v_subject.role) and exists(
    select 1 from public.cleaning_daily_ratings r
    where r.staff_id=v_subject_id and r.rating_date=v_today
  ) then raise exception using errcode='55000',message='cleaning_day_already_rated'; end if;

  if v_item.operation_category in ('shelf','inventory') and exists(
    select 1 from public.branch_operations_daily_ratings r
    where r.staff_id=v_subject_id and r.rating_date=v_today
  ) then raise exception using errcode='55000',message='operations_day_already_rated'; end if;

  insert into public.staff_daily_checklist_submissions(
    staff_id,item_id,assignment_id,submission_date,branch,completed,photo_url,staff_note,
    submitted_at,review_status,reviewed_by,reviewed_by_name,reviewer_note,reviewed_at
  ) values(
    v_subject_id,p_item_id,v_assignment.id,v_today,v_assignment.branch,true,
    nullif(trim(coalesce(p_photo_url,'')),''),nullif(trim(coalesce(p_staff_note,'')),''),
    now(),'pending',null,null,null,null
  )
  on conflict(staff_id,item_id,submission_date) do update set
    assignment_id=excluded.assignment_id,branch=excluded.branch,completed=true,
    photo_url=excluded.photo_url,staff_note=excluded.staff_note,submitted_at=excluded.submitted_at,
    review_status='pending',reviewed_by=null,reviewed_by_name=null,reviewer_note=null,
    reviewed_at=null,updated_at=now()
  returning * into v_row;

  if public.dawaa_is_cleaning_role_v1(v_subject.role) then
    perform public.sync_cleaning_day_governance_snapshot_v3(v_subject_id,v_today);
  end if;
  return v_row;
end;
$$;

revoke all on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) from public;
grant execute on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- E. Review command: branch scope, evidence validation and post-rating history lock.
-- ---------------------------------------------------------------------------
create or replace function public.review_staff_daily_checklist_v1(
  p_submission_id uuid,
  p_status text,
  p_reviewer_note text default null
)
returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path='public','auth','pg_catalog'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_target public.staff_daily_checklist_submissions%rowtype;
  v_item public.staff_daily_checklist_items%rowtype;
  v_row public.staff_daily_checklist_submissions%rowtype;
  v_role text;
  v_staff_role text;
begin
  if p_status not in ('approved','rejected') then raise exception using errcode='22023',message='invalid checklist review status'; end if;
  if p_status='rejected' and nullif(trim(coalesce(p_reviewer_note,'')),'') is null then
    raise exception using errcode='22023',message='rejection note required';
  end if;

  select * into v_account from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  v_role:=lower(trim(coalesce(v_account.role,'')));
  if v_role not in ('branch_manager','branches_manager','executive_manager','general_manager','admin') then
    raise exception using errcode='42501',message='manager role required for checklist review';
  end if;
  if not public.user_has_permission(v_account.id,'view_team') then
    raise exception using errcode='42501',message='checklist review permission required';
  end if;

  select * into v_target from public.staff_daily_checklist_submissions
  where id=p_submission_id for update;
  if not found then raise exception using errcode='22023',message='checklist submission not found'; end if;

  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)<>
         public.dawaa_review_coverage_branch_key_v1(v_target.branch) then
    raise exception using errcode='42501',message='checklist review branch scope denied';
  end if;

  select * into v_item from public.staff_daily_checklist_items where id=v_target.item_id;
  select role into v_staff_role from public.staff where id=v_target.staff_id;

  if p_status='approved' and coalesce(v_item.requires_photo,false)
     and nullif(trim(coalesce(v_target.photo_url,'')),'') is null then
    raise exception using errcode='55000',message='required photo evidence missing';
  end if;

  if public.dawaa_is_cleaning_role_v1(v_staff_role) and exists(
    select 1 from public.cleaning_daily_ratings r
    where r.staff_id=v_target.staff_id and r.rating_date=v_target.submission_date
  ) then raise exception using errcode='55000',message='cleaning_day_already_rated'; end if;

  if v_item.operation_category in ('shelf','inventory') and exists(
    select 1 from public.branch_operations_daily_ratings r
    where r.staff_id=v_target.staff_id and r.rating_date=v_target.submission_date
  ) then raise exception using errcode='55000',message='operations_day_already_rated'; end if;

  update public.staff_daily_checklist_submissions set
    review_status=p_status,
    reviewed_by=v_account.id,
    reviewed_by_name=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username),
    reviewer_note=case when p_status='rejected' then nullif(trim(coalesce(p_reviewer_note,'')),'') else null end,
    reviewed_at=now(),updated_at=now()
  where id=p_submission_id
  returning * into v_row;

  -- The existing checklist settlement trigger projects task-level rejection evidence.
  -- Do not call settle_checklist_review here again.
  if public.dawaa_is_cleaning_role_v1(v_staff_role) then
    perform public.sync_cleaning_day_governance_snapshot_v3(v_target.staff_id,v_target.submission_date);
  end if;
  return v_row;
end;
$$;

revoke all on function public.review_staff_daily_checklist_v1(uuid,text,text) from public;
grant execute on function public.review_staff_daily_checklist_v1(uuid,text,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- F. Cleaning snapshot v4 semantics using exact due assignments, not role inference.
-- ---------------------------------------------------------------------------
create or replace function public.sync_cleaning_day_governance_snapshot_v3(
  p_staff_id uuid,
  p_snapshot_date date default (timezone('Africa/Cairo',now()))::date
)
returns public.cleaning_daily_governance_snapshots
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_existing public.cleaning_daily_governance_snapshots%rowtype;
  v_saved public.cleaning_daily_governance_snapshots%rowtype;
  v_date date:=coalesce(p_snapshot_date,(timezone('Africa/Cairo',now()))::date);
  v_cycle text;
  v_required integer:=0; v_submitted integer:=0; v_reviewed integer:=0;
  v_approved integer:=0; v_rejected integer:=0; v_pending integer:=0;
  v_max_stars integer:=0; v_ready boolean:=false;
  v_timing_attention integer:=0; v_on_time integer:=0;
  v_items jsonb:='[]'::jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then raise exception 'cleaning_staff_not_found'; end if;

  select * into v_existing from public.cleaning_daily_governance_snapshots
  where staff_id=p_staff_id and snapshot_date=v_date for update;
  if found and exists(
    select 1 from public.cleaning_daily_ratings r
    where r.staff_id=p_staff_id and r.rating_date=v_date and r.governance_snapshot_id=v_existing.id
  ) then return v_existing; end if;

  with due as (
    select distinct a.id assignment_id,a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true and i.operation_category='cleaning'
    where a.staff_id=p_staff_id
      and public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_staff.branch)
      and a.active=true
      and public.dawaa_staff_checklist_assignment_due_v1(
        a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_date
      )
  )
  select count(*)::integer,
    count(s.id)::integer,
    count(s.id) filter(where s.review_status in ('approved','rejected'))::integer,
    count(s.id) filter(where s.review_status='approved')::integer,
    count(s.id) filter(where s.review_status='rejected')::integer,
    count(s.id) filter(where s.review_status='pending')::integer,
    count(s.id) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at)='outside_window')::integer,
    count(s.id) filter(where public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at)='on_time')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id',d.assignment_id,'item_id',i.id,'item_key',i.item_key,'title',i.title,
      'time_slot',i.time_slot,'requires_photo',i.requires_photo,'rule_key_on_fail',i.rule_key_on_fail,
      'submitted',s.id is not null,'submission_id',s.id,'photo_url',s.photo_url,
      'review_status',s.review_status,'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at,
      'reviewed_by_name',s.reviewed_by_name,
      'timing_status',case when s.id is null then null else public.dawaa_cleaning_timing_status_v1(i.time_slot,s.submitted_at) end
    ) order by i.sort_order nulls last,i.item_key),'[]'::jsonb)
  into v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending,
       v_timing_attention,v_on_time,v_items
  from due d
  join public.staff_daily_checklist_items i on i.id=d.item_id
  left join public.staff_daily_checklist_submissions s
    on s.item_id=d.item_id and s.staff_id=p_staff_id and s.submission_date=v_date;

  v_ready:=v_required>0 and v_submitted>=v_required and v_reviewed>=v_required and v_pending=0;
  v_max_stars:=case
    when v_required<=0 then 0
    when v_reviewed<v_required then 0
    when v_approved>=v_required then 5
    when v_approved::numeric/v_required>=0.83 then 4
    when v_approved::numeric/v_required>=0.67 then 3
    when v_approved::numeric/v_required>=0.50 then 2
    else 1 end;
  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_date);

  insert into public.cleaning_daily_governance_snapshots(
    staff_id,branch,snapshot_date,month_cycle,governance_version,
    required_items,submitted_items,reviewed_items,approved_items,rejected_items,pending_items,
    max_stars,rating_ready,timing_attention_items,on_time_items,checklist_snapshot,finalized_at,updated_at
  ) values(
    p_staff_id,coalesce(v_staff.branch,''),v_date,v_cycle,4,
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
$$;

revoke all on function public.sync_cleaning_day_governance_snapshot_v3(uuid,date) from public,anon,authenticated;

-- Batched manager cards include checklist readiness, removing the old per-cleaner N+1.
create or replace function public.get_cleaning_daily_rating_cards_v2(
  p_rating_date date default (timezone('Africa/Cairo',now()))::date,
  p_branch text default null
)
returns table(
  staff_id uuid,staff_name text,staff_role text,branch text,rating_date date,
  required_items integer,submitted_items integer,reviewed_items integer,approved_items integer,
  rejected_items integer,pending_items integer,max_stars integer,rating_ready boolean,
  rating_id uuid,stars integer,score_pct numeric,points_delta numeric,manager_note text,
  rated_by_name text,updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and public.dawaa_review_coverage_branch_key_v1(v_branch)<>
       public.dawaa_review_coverage_branch_key_v1(v_actor_branch) then raise exception 'not_authorized_for_branch'; end if;
    v_branch:=v_actor_branch;
  end if;

  return query
  with due as (
    select distinct a.staff_id,a.branch,a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true and i.operation_category='cleaning'
    join public.staff st on st.id=a.staff_id and coalesce(st.active,true)=true
    where a.active=true
      and (v_branch is null or public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_branch))
      and public.dawaa_staff_checklist_assignment_due_v1(
        a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_date
      )
  ), agg as (
    select d.staff_id,d.branch,count(*)::integer required_items,count(s.id)::integer submitted_items,
      count(s.id) filter(where s.review_status in ('approved','rejected'))::integer reviewed_items,
      count(s.id) filter(where s.review_status='approved')::integer approved_items,
      count(s.id) filter(where s.review_status='rejected')::integer rejected_items,
      count(s.id) filter(where s.review_status='pending')::integer pending_items
    from due d left join public.staff_daily_checklist_submissions s
      on s.staff_id=d.staff_id and s.item_id=d.item_id and s.submission_date=v_date and s.completed=true
    group by d.staff_id,d.branch
  ), capped as (
    select a.*,
      case when a.required_items<=0 then 0 when a.reviewed_items<a.required_items then 0 when a.approved_items>=a.required_items then 5
           when a.approved_items::numeric/a.required_items>=0.83 then 4
           when a.approved_items::numeric/a.required_items>=0.67 then 3
           when a.approved_items::numeric/a.required_items>=0.50 then 2 else 1 end::integer max_stars,
      (a.required_items>0 and a.submitted_items>=a.required_items and a.reviewed_items>=a.required_items and a.pending_items=0) rating_ready
    from agg a
  )
  select c.staff_id,st.name,st.role,c.branch,v_date,c.required_items,c.submitted_items,c.reviewed_items,
    c.approved_items,c.rejected_items,c.pending_items,c.max_stars,c.rating_ready,
    r.id,r.stars,r.score_pct,r.points_delta,r.manager_note,r.rated_by_name,r.updated_at
  from capped c join public.staff st on st.id=c.staff_id
  left join public.cleaning_daily_ratings r on r.staff_id=c.staff_id and r.rating_date=v_date
  order by c.branch,st.name;
end;
$$;

revoke all on function public.get_cleaning_daily_rating_cards_v2(date,text) from public;
grant execute on function public.get_cleaning_daily_rating_cards_v2(date,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- G. Cleaning daily rating: descriptive quality score + non-duplicative bonus only.
-- ---------------------------------------------------------------------------
create or replace function public.rate_cleaning_staff_day_v1(
  p_staff_id uuid,p_stars integer,p_manager_note text default null,p_rating_date date default current_date
)
returns public.cleaning_daily_ratings
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_staff public.staff%rowtype; v_rating public.cleaning_daily_ratings%rowtype;
  v_points numeric; v_cycle text; v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text; v_existing_tx uuid; v_snap public.cleaning_daily_governance_snapshots%rowtype;
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  if p_stars<1 or p_stars>5 then raise exception 'stars_must_be_between_1_and_5'; end if;
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,true)=true;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then raise exception 'cleaning_staff_not_found'; end if;
  if not v_global and public.dawaa_review_coverage_branch_key_v1(v_staff.branch)<>
     public.dawaa_review_coverage_branch_key_v1(v_actor_branch) then raise exception 'not_authorized_for_branch'; end if;

  v_snap:=public.sync_cleaning_day_governance_snapshot_v3(p_staff_id,v_date);
  if not coalesce(v_snap.rating_ready,false) then raise exception 'cleaning_checklist_review_incomplete'; end if;
  if p_stars>coalesce(v_snap.max_stars,0) then raise exception 'stars_exceed_checklist_cap:%',v_snap.max_stars; end if;
  if p_stars<=2 and nullif(trim(coalesce(p_manager_note,'')),'') is null then raise exception 'low_rating_note_required'; end if;

  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;
  v_points:=public.dawaa_checklist_daily_quality_bonus_v1(p_stars,v_snap.rejected_items);
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
  where et.staff_id=p_staff_id and et.source='cleaning_daily_star_rating' and et.source_id=v_rating.id
  order by et.updated_at desc nulls last,et.created_at desc nulls last limit 1;

  if v_points>0 and v_existing_tx is null then
    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,
      source,source_id,transaction_date,month_cycle,branch,status,category,created_by,created_by_name,
      approved_by,approved_by_name,approved_at,employee_visible,metadata
    ) values(
      p_staff_id,p_staff_id,v_staff.name,'reward','مكافأة جودة النظافة اليومية',
      format('تقييم جودة يومي: %s/5',p_stars),nullif(trim(coalesce(p_manager_note,'')),''),0,v_points,v_points,v_points,
      'cleaning_daily_star_rating',v_rating.id,v_date,v_cycle,v_staff.branch,'active','النظافة والتشغيل',
      v_actor_id,v_actor_name,v_actor_id,v_actor_name,now(),true,
      jsonb_build_object('engine_version',6,'policy','quality_bonus_only','stars',p_stars,'rejected_items',v_snap.rejected_items,
                         'governance_snapshot_id',v_snap.id,'rating_date',v_date)
    );
  elsif v_points>0 and v_existing_tx is not null then
    update public.employee_transactions set type='reward',points=v_points,points_delta=v_points,final_points=v_points,
      title='مكافأة جودة النظافة اليومية',reason=format('تقييم جودة يومي: %s/5',p_stars),
      description=nullif(trim(coalesce(p_manager_note,'')),''),transaction_date=v_date,month_cycle=v_cycle,
      branch=v_staff.branch,status='active',approved_by=v_actor_id,approved_by_name=v_actor_name,approved_at=now(),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('engine_version',6,'policy','quality_bonus_only','stars',p_stars,
        'rejected_items',v_snap.rejected_items,'governance_snapshot_id',v_snap.id,'rating_date',v_date)
    where id=v_existing_tx;
  elsif v_existing_tx is not null then
    update public.employee_transactions set status='cancelled',points=0,points_delta=0,final_points=0,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','daily_rating_has_no_quality_bonus','engine_version',6)
    where id=v_existing_tx;
  end if;
  return v_rating;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Shelf/inventory daily cards and rating consume the same due source.
-- ---------------------------------------------------------------------------
create or replace function public.get_branch_operations_daily_rating_cards_v1(
  p_rating_date date default (timezone('Africa/Cairo',now()))::date,
  p_branch text default null
)
returns table(
  staff_id uuid,staff_name text,staff_role text,branch text,rating_date date,
  required_items integer,submitted_items integer,reviewed_items integer,approved_items integer,rejected_items integer,pending_items integer,
  max_stars integer,rating_ready boolean,rating_id uuid,stars integer,score_pct numeric,points_delta numeric,
  manager_note text,rated_by_name text,updated_at timestamptz
)
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype; v_role text; v_global boolean;
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  select * into v_account from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  v_role:=lower(trim(coalesce(v_account.role,'')));
  if v_role not in ('branch_manager','branches_manager','executive_manager','general_manager','admin') then
    raise exception using errcode='42501',message='manager role required';
  end if;
  if not public.user_has_permission(v_account.id,'view_team') then raise exception using errcode='42501',message='checklist review permission required'; end if;
  v_global:=v_role in ('general_manager','executive_manager','branches_manager','admin');
  if not v_global then
    if nullif(trim(coalesce(v_account.branch,'')),'') is null then raise exception using errcode='42501',message='manager branch required'; end if;
    if v_branch is not null and public.dawaa_review_coverage_branch_key_v1(v_branch)<>
       public.dawaa_review_coverage_branch_key_v1(v_account.branch) then raise exception using errcode='42501',message='not authorized for branch'; end if;
    v_branch:=v_account.branch;
  end if;

  return query
  with due as (
    select distinct a.staff_id,a.branch,a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true
    where a.active=true and i.operation_category in ('shelf','inventory')
      and (v_branch is null or public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_branch))
      and public.dawaa_staff_checklist_assignment_due_v1(
        a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_date
      )
  ), agg as (
    select d.staff_id,d.branch,count(*)::integer required_items,count(s.id)::integer submitted_items,
      count(s.id) filter(where s.review_status in ('approved','rejected'))::integer reviewed_items,
      count(s.id) filter(where s.review_status='approved')::integer approved_items,
      count(s.id) filter(where s.review_status='rejected')::integer rejected_items,
      count(s.id) filter(where s.review_status='pending')::integer pending_items
    from due d left join public.staff_daily_checklist_submissions s
      on s.staff_id=d.staff_id and s.item_id=d.item_id and s.submission_date=v_date and s.completed=true
    group by d.staff_id,d.branch
  ), capped as (
    select a.*,
      case when a.required_items<=0 then 0 when a.reviewed_items<a.required_items then 0 when a.approved_items>=a.required_items then 5
           when a.approved_items::numeric/a.required_items>=0.83 then 4 when a.approved_items::numeric/a.required_items>=0.67 then 3
           when a.approved_items::numeric/a.required_items>=0.50 then 2 else 1 end::integer max_stars,
      (a.required_items>0 and a.submitted_items>=a.required_items and a.reviewed_items>=a.required_items and a.pending_items=0) rating_ready
    from agg a
  )
  select c.staff_id,st.name,st.role,c.branch,v_date,c.required_items,c.submitted_items,c.reviewed_items,
    c.approved_items,c.rejected_items,c.pending_items,c.max_stars,c.rating_ready,
    r.id,r.stars,r.score_pct,r.points_delta,r.manager_note,r.rated_by_name,r.updated_at
  from capped c join public.staff st on st.id=c.staff_id and coalesce(st.active,true)=true
  left join public.branch_operations_daily_ratings r on r.staff_id=c.staff_id and r.rating_date=v_date
  order by c.branch,st.name;
end;
$$;

create or replace function public.rate_branch_operations_staff_day_v1(
  p_staff_id uuid,p_stars integer,p_manager_note text default null,
  p_rating_date date default (timezone('Africa/Cairo',now()))::date
)
returns public.branch_operations_daily_ratings
language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype; v_staff public.staff%rowtype;
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date); v_cycle text;
  v_required integer:=0; v_submitted integer:=0; v_reviewed integer:=0; v_approved integer:=0;
  v_rejected integer:=0; v_pending integer:=0; v_max integer:=0; v_ready boolean:=false;
  v_points numeric:=0; v_actor_name text; v_saved public.branch_operations_daily_ratings%rowtype;
  v_existing_tx uuid; v_role text;
begin
  if p_stars<1 or p_stars>5 then raise exception using errcode='22023',message='stars must be between 1 and 5'; end if;
  select * into v_account from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  v_role:=lower(trim(coalesce(v_account.role,'')));
  if v_role not in ('branch_manager','branches_manager','executive_manager','general_manager','admin') then
    raise exception using errcode='42501',message='manager role required';
  end if;
  if not public.user_has_permission(v_account.id,'view_team') then raise exception using errcode='42501',message='checklist review permission required'; end if;
  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,true)=true;
  if not found then raise exception using errcode='22023',message='active staff required'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)<>
         public.dawaa_review_coverage_branch_key_v1(v_staff.branch) then raise exception using errcode='42501',message='not authorized for branch'; end if;

  select count(*)::integer,count(sub.id)::integer,
    count(sub.id) filter(where sub.review_status in ('approved','rejected'))::integer,
    count(sub.id) filter(where sub.review_status='approved')::integer,
    count(sub.id) filter(where sub.review_status='rejected')::integer,
    count(sub.id) filter(where sub.review_status='pending')::integer
  into v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending
  from public.staff_daily_checklist_assignments a
  join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true
  left join public.staff_daily_checklist_submissions sub
    on sub.staff_id=a.staff_id and sub.item_id=a.item_id and sub.submission_date=v_date and sub.completed=true
  where a.staff_id=p_staff_id
    and public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_staff.branch)
    and a.active=true and i.operation_category in ('shelf','inventory')
    and public.dawaa_staff_checklist_assignment_due_v1(
      a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_date
    );

  v_ready:=v_required>0 and v_submitted>=v_required and v_reviewed>=v_required and v_pending=0;
  v_max:=case when v_required<=0 then 0 when v_reviewed<v_required then 0 when v_approved>=v_required then 5
              when v_approved::numeric/v_required>=0.83 then 4 when v_approved::numeric/v_required>=0.67 then 3
              when v_approved::numeric/v_required>=0.50 then 2 else 1 end;
  if not v_ready then raise exception using errcode='55000',message='all due tasks must be submitted and reviewed before daily rating'; end if;
  if p_stars>v_max then raise exception using errcode='22023',message='stars exceed checklist quality cap'; end if;
  if p_stars<=2 and nullif(trim(coalesce(p_manager_note,'')),'') is null then raise exception using errcode='22023',message='low rating note required'; end if;

  v_points:=public.dawaa_checklist_daily_quality_bonus_v1(p_stars,v_rejected);
  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_date);
  v_actor_name:=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username);

  insert into public.branch_operations_daily_ratings(
    staff_id,branch,rating_date,month_cycle,stars,score_pct,points_delta,required_items,submitted_items,
    reviewed_items,approved_items,rejected_items,pending_items,max_stars,manager_note,rated_by,rated_by_name,updated_at
  ) values(
    p_staff_id,v_staff.branch,v_date,v_cycle,p_stars,p_stars*20,v_points,v_required,v_submitted,v_reviewed,
    v_approved,v_rejected,v_pending,v_max,nullif(trim(coalesce(p_manager_note,'')),''),v_account.id::text,v_actor_name,now()
  ) on conflict(staff_id,rating_date) do update set
    branch=excluded.branch,month_cycle=excluded.month_cycle,stars=excluded.stars,score_pct=excluded.score_pct,
    points_delta=excluded.points_delta,required_items=excluded.required_items,submitted_items=excluded.submitted_items,
    reviewed_items=excluded.reviewed_items,approved_items=excluded.approved_items,rejected_items=excluded.rejected_items,
    pending_items=excluded.pending_items,max_stars=excluded.max_stars,manager_note=excluded.manager_note,
    rated_by=excluded.rated_by,rated_by_name=excluded.rated_by_name,updated_at=now()
  returning * into v_saved;

  select et.id into v_existing_tx from public.employee_transactions et
  where et.staff_id=p_staff_id and et.source='branch_operations_daily_rating' and et.source_id=v_saved.id
  order by et.updated_at desc nulls last,et.created_at desc nulls last limit 1;

  if v_points>0 and v_existing_tx is null then
    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,
      source,source_id,transaction_date,month_cycle,branch,status,category,created_by,created_by_name,
      approved_by,approved_by_name,approved_at,employee_visible,metadata
    ) values(
      p_staff_id,p_staff_id,v_staff.name,'reward','مكافأة جودة التشغيل اليومية',
      format('تقييم جودة يومي: %s/5',p_stars),nullif(trim(coalesce(p_manager_note,'')),''),0,v_points,v_points,v_points,
      'branch_operations_daily_rating',v_saved.id,v_date,v_cycle,v_staff.branch,'active','operations_daily_rating',
      v_account.id::text,v_actor_name,v_account.id::text,v_actor_name,now(),true,
      jsonb_build_object('engine_version',2,'policy','quality_bonus_only','stars',p_stars,'rejected_items',v_rejected,
        'required_items',v_required,'approved_items',v_approved,'rating_date',v_date)
    );
  elsif v_points>0 and v_existing_tx is not null then
    update public.employee_transactions set type='reward',points=v_points,points_delta=v_points,final_points=v_points,
      title='مكافأة جودة التشغيل اليومية',reason=format('تقييم جودة يومي: %s/5',p_stars),
      description=nullif(trim(coalesce(p_manager_note,'')),''),transaction_date=v_date,month_cycle=v_cycle,
      branch=v_staff.branch,status='active',approved_by=v_account.id::text,approved_by_name=v_actor_name,approved_at=now(),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('engine_version',2,'policy','quality_bonus_only','stars',p_stars,
        'rejected_items',v_rejected,'required_items',v_required,'approved_items',v_approved,'rating_date',v_date)
    where id=v_existing_tx;
  elsif v_existing_tx is not null then
    update public.employee_transactions set status='cancelled',points=0,points_delta=0,final_points=0,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','daily_rating_has_no_quality_bonus','engine_version',2)
    where id=v_existing_tx;
  end if;
  return v_saved;
end;
$$;

revoke all on function public.get_branch_operations_daily_rating_cards_v1(date,text) from public;
grant execute on function public.get_branch_operations_daily_rating_cards_v1(date,text) to anon,authenticated;
revoke all on function public.rate_branch_operations_staff_day_v1(uuid,integer,text,date) from public;
grant execute on function public.rate_branch_operations_staff_day_v1(uuid,integer,text,date) to anon,authenticated;

commit;
