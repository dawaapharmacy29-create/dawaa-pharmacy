-- Daily manager rating for branch-operation checklist responsibilities.
-- Extends the existing cleaning governance pattern to shelf/inventory assistants
-- without creating a second points ledger. All points evidence lands in
-- employee_transactions and remains bound to the 26->25 points cycle.

begin;

update public.staff_daily_checklist_items
set requires_photo = true
where active = true and operation_category in ('cleaning','shelf');

create table if not exists public.branch_operations_daily_ratings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  branch text not null,
  rating_date date not null,
  month_cycle text not null,
  stars integer not null check (stars between 1 and 5),
  score_pct numeric not null check (score_pct between 0 and 100),
  points_delta numeric not null default 0,
  required_items integer not null default 0,
  submitted_items integer not null default 0,
  reviewed_items integer not null default 0,
  approved_items integer not null default 0,
  rejected_items integer not null default 0,
  pending_items integer not null default 0,
  max_stars integer not null default 0,
  manager_note text null,
  rated_by text null,
  rated_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,rating_date)
);

alter table public.branch_operations_daily_ratings enable row level security;
create index if not exists idx_branch_operations_daily_ratings_staff_cycle on public.branch_operations_daily_ratings(staff_id,month_cycle,rating_date desc);
create index if not exists idx_branch_operations_daily_ratings_branch_date on public.branch_operations_daily_ratings(branch,rating_date desc);

drop policy if exists branch_operations_daily_ratings_scoped_select_v1 on public.branch_operations_daily_ratings;
create policy branch_operations_daily_ratings_scoped_select_v1
on public.branch_operations_daily_ratings
for select to anon,authenticated
using (
  public.dawaa_current_staff_account_id_strict() is not null
  and (
    staff_id = public.dawaa_current_staff_subject_uuid_v1()
    or (
      public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
      and (
        lower(trim(coalesce(public.employee_operating_actor_role(),''))) in ('general_manager','executive_manager','branches_manager','admin')
        or public.dawaa_review_coverage_branch_key_v1(branch)=public.dawaa_review_coverage_branch_key_v1(public.employee_operating_actor_branch())
      )
    )
  )
);
grant select on public.branch_operations_daily_ratings to anon,authenticated;

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
  v_account public.staff_accounts%rowtype;
  v_role text;
  v_global boolean;
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  select * into v_account from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  if not public.user_has_permission(v_account.id,'view_team') then raise exception using errcode='42501',message='checklist review permission required'; end if;
  v_role:=lower(trim(coalesce(v_account.role,'')));
  v_global:=v_role in ('general_manager','executive_manager','branches_manager','admin');
  if not v_global then
    if nullif(trim(coalesce(v_account.branch,'')),'') is null then raise exception using errcode='42501',message='manager branch required'; end if;
    if v_branch is not null and public.dawaa_review_coverage_branch_key_v1(v_branch)<>public.dawaa_review_coverage_branch_key_v1(v_account.branch) then
      raise exception using errcode='42501',message='not authorized for branch';
    end if;
    v_branch:=v_account.branch;
  end if;

  return query
  with due as (
    select distinct a.staff_id,a.branch,a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true
    where a.active=true and i.operation_category in ('shelf','inventory')
      and (v_branch is null or public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_branch))
      and public.dawaa_checklist_assignment_due_v1(a.cadence,a.weekday,a.active_from,a.active_to,v_date)
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
  select c.staff_id,s.name,s.role,c.branch,v_date,c.required_items,c.submitted_items,c.reviewed_items,c.approved_items,c.rejected_items,c.pending_items,
         c.max_stars,c.rating_ready,r.id,r.stars,r.score_pct,r.points_delta,r.manager_note,r.rated_by_name,r.updated_at
  from capped c join public.staff s on s.id=c.staff_id
  left join public.branch_operations_daily_ratings r on r.staff_id=c.staff_id and r.rating_date=v_date
  where coalesce(s.active,true)=true order by c.branch,s.name;
end;
$$;
revoke all on function public.get_branch_operations_daily_rating_cards_v1(date,text) from public;
grant execute on function public.get_branch_operations_daily_rating_cards_v1(date,text) to anon,authenticated;

create or replace function public.rate_branch_operations_staff_day_v1(
  p_staff_id uuid,p_stars integer,p_manager_note text default null,p_rating_date date default (timezone('Africa/Cairo',now()))::date
)
returns public.branch_operations_daily_ratings
language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype; v_staff public.staff%rowtype;
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date); v_cycle text;
  v_required integer:=0; v_submitted integer:=0; v_reviewed integer:=0; v_approved integer:=0; v_rejected integer:=0; v_pending integer:=0;
  v_max integer:=0; v_ready boolean:=false; v_points numeric:=0; v_actor_name text;
  v_saved public.branch_operations_daily_ratings%rowtype; v_existing_tx uuid;
begin
  if p_stars<1 or p_stars>5 then raise exception using errcode='22023',message='stars must be between 1 and 5'; end if;
  select * into v_account from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  if not public.user_has_permission(v_account.id,'view_team') then raise exception using errcode='42501',message='checklist review permission required'; end if;
  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,true)=true;
  if not found then raise exception using errcode='22023',message='active staff required'; end if;
  if lower(trim(coalesce(v_account.role,''))) not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)<>public.dawaa_review_coverage_branch_key_v1(v_staff.branch) then
    raise exception using errcode='42501',message='not authorized for branch';
  end if;

  select count(*)::integer,count(sub.id)::integer,
    count(sub.id) filter(where sub.review_status in ('approved','rejected'))::integer,
    count(sub.id) filter(where sub.review_status='approved')::integer,
    count(sub.id) filter(where sub.review_status='rejected')::integer,
    count(sub.id) filter(where sub.review_status='pending')::integer
  into v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending
  from public.staff_daily_checklist_assignments a
  join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true
  left join public.staff_daily_checklist_submissions sub on sub.staff_id=a.staff_id and sub.item_id=a.item_id and sub.submission_date=v_date and sub.completed=true
  where a.staff_id=p_staff_id and a.branch=v_staff.branch and a.active=true and i.operation_category in ('shelf','inventory')
    and public.dawaa_checklist_assignment_due_v1(a.cadence,a.weekday,a.active_from,a.active_to,v_date);

  v_ready:=v_required>0 and v_submitted>=v_required and v_reviewed>=v_required and v_pending=0;
  v_max:=case when v_required<=0 then 0 when v_reviewed<v_required then 0 when v_approved>=v_required then 5
              when v_approved::numeric/v_required>=0.83 then 4 when v_approved::numeric/v_required>=0.67 then 3
              when v_approved::numeric/v_required>=0.50 then 2 else 1 end;
  if not v_ready then raise exception using errcode='55000',message='all due tasks must be submitted and reviewed before daily rating'; end if;
  if p_stars>v_max then raise exception using errcode='22023',message='stars exceed checklist quality cap'; end if;

  v_points:=public.dawaa_cleaning_star_points_v1(p_stars);
  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_date);
  v_actor_name:=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username);

  insert into public.branch_operations_daily_ratings(
    staff_id,branch,rating_date,month_cycle,stars,score_pct,points_delta,required_items,submitted_items,reviewed_items,approved_items,rejected_items,pending_items,max_stars,
    manager_note,rated_by,rated_by_name,updated_at
  ) values(p_staff_id,v_staff.branch,v_date,v_cycle,p_stars,p_stars*20,v_points,v_required,v_submitted,v_reviewed,v_approved,v_rejected,v_pending,v_max,
           nullif(trim(coalesce(p_manager_note,'')),''),v_account.id::text,v_actor_name,now())
  on conflict(staff_id,rating_date) do update set branch=excluded.branch,month_cycle=excluded.month_cycle,stars=excluded.stars,score_pct=excluded.score_pct,
    points_delta=excluded.points_delta,required_items=excluded.required_items,submitted_items=excluded.submitted_items,reviewed_items=excluded.reviewed_items,
    approved_items=excluded.approved_items,rejected_items=excluded.rejected_items,pending_items=excluded.pending_items,max_stars=excluded.max_stars,
    manager_note=excluded.manager_note,rated_by=excluded.rated_by,rated_by_name=excluded.rated_by_name,updated_at=now()
  returning * into v_saved;

  select et.id into v_existing_tx from public.employee_transactions et
  where et.staff_id=p_staff_id and et.month_cycle=v_cycle and et.source='branch_operations_daily_rating' and et.source_id=v_saved.id
  order by et.updated_at desc nulls last,et.created_at desc nulls last limit 1;

  if v_existing_tx is null then
    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,source,source_id,transaction_date,month_cycle,
      branch,status,category,created_by,created_by_name,approved_by,approved_by_name,approved_at,employee_visible,metadata
    ) values(
      p_staff_id,p_staff_id,v_staff.name,case when v_points<0 then 'penalty' else 'reward' end,'تقييم التشغيل اليومي','تقييم مدير الفرع لمهام الرص والجرد',
      'تقييم يومي مبني على اكتمال ومراجعة مهام الرص والجرد المسندة للموظف.',0,abs(v_points),v_points,v_points,
      'branch_operations_daily_rating',v_saved.id,v_date,v_cycle,v_staff.branch,'active','operations_daily_rating',v_account.id::text,v_actor_name,
      v_account.id::text,v_actor_name,now(),true,
      jsonb_build_object('stars',p_stars,'score_pct',p_stars*20,'required_items',v_required,'submitted_items',v_submitted,'reviewed_items',v_reviewed,
                         'approved_items',v_approved,'rejected_items',v_rejected,'max_stars',v_max,'rating_date',v_date,'rating_source','branch_operations_daily_rating_v1')
    );
  else
    update public.employee_transactions set
      type=case when v_points<0 then 'penalty' else 'reward' end,points=abs(v_points),points_delta=v_points,final_points=v_points,
      title='تقييم التشغيل اليومي',reason='تقييم مدير الفرع لمهام الرص والجرد',description='تقييم يومي مبني على اكتمال ومراجعة مهام الرص والجرد المسندة للموظف.',
      transaction_date=v_date,branch=v_staff.branch,status='active',category='operations_daily_rating',approved_by=v_account.id::text,approved_by_name=v_actor_name,
      approved_at=now(),employee_visible=true,
      metadata=jsonb_build_object('stars',p_stars,'score_pct',p_stars*20,'required_items',v_required,'submitted_items',v_submitted,'reviewed_items',v_reviewed,
                                  'approved_items',v_approved,'rejected_items',v_rejected,'max_stars',v_max,'rating_date',v_date,'rating_source','branch_operations_daily_rating_v1'),
      updated_at=now()
    where id=v_existing_tx;
  end if;
  return v_saved;
end;
$$;
revoke all on function public.rate_branch_operations_staff_day_v1(uuid,integer,text,date) from public;
grant execute on function public.rate_branch_operations_staff_day_v1(uuid,integer,text,date) to anon,authenticated;

commit;
