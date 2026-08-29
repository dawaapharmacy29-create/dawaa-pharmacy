create or replace function public.get_cleaning_day_checklist_summary_v2(
  p_staff_id uuid,
  p_rating_date date default current_date
)
returns table(
  staff_id uuid,
  rating_date date,
  required_items integer,
  submitted_items integer,
  reviewed_items integer,
  approved_items integer,
  rejected_items integer,
  pending_items integer,
  max_stars integer,
  rating_ready boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_self text := public.dawaa_current_staff_id_v1();
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_staff public.staff%rowtype;
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then
    raise exception 'cleaning_staff_not_found';
  end if;

  if not (p_staff_id::text = coalesce(v_self,'') or v_global or (v_role='branch_manager' and coalesce(v_staff.branch,'')=coalesce(v_actor_branch,''))) then
    raise exception 'not_authorized';
  end if;

  return query
  with required as (
    select count(*)::integer as cnt
    from public.staff_daily_checklist_items i
    where i.active = true and i.role = v_staff.role
  ), stats as (
    select
      count(*)::integer as submitted,
      count(*) filter (where s.review_status <> 'pending')::integer as reviewed,
      count(*) filter (where s.review_status = 'approved')::integer as approved,
      count(*) filter (where s.review_status = 'rejected')::integer as rejected,
      count(*) filter (where s.review_status = 'pending')::integer as pending
    from public.staff_daily_checklist_submissions s
    join public.staff_daily_checklist_items i on i.id = s.item_id
    where s.staff_id = p_staff_id
      and s.submission_date = coalesce(p_rating_date,current_date)
      and i.active = true
      and i.role = v_staff.role
  )
  select
    p_staff_id,
    coalesce(p_rating_date,current_date),
    r.cnt,
    st.submitted,
    st.reviewed,
    st.approved,
    st.rejected,
    st.pending,
    case
      when r.cnt <= 0 then 1
      when st.reviewed < r.cnt then 0
      when st.approved >= r.cnt then 5
      when st.approved::numeric / r.cnt >= 0.83 then 4
      when st.approved::numeric / r.cnt >= 0.67 then 3
      when st.approved::numeric / r.cnt >= 0.50 then 2
      else 1
    end::integer,
    (r.cnt > 0 and st.submitted >= r.cnt and st.reviewed >= r.cnt and st.pending = 0)
  from required r cross join stats st;
end;
$$;

revoke all on function public.get_cleaning_day_checklist_summary_v2(uuid,date) from public;
grant execute on function public.get_cleaning_day_checklist_summary_v2(uuid,date) to anon, authenticated;

create or replace function public.submit_my_staff_daily_checklist_v1(p_item_id uuid, p_photo_url text default null::text, p_staff_note text default null::text)
returns staff_daily_checklist_submissions
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_catalog'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_subject public.staff%rowtype;
  v_item public.staff_daily_checklist_items%rowtype;
  v_today date := (timezone('Africa/Cairo', now()))::date;
  v_row public.staff_daily_checklist_submissions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501', message='active staff actor required'; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode='42501', message='canonical staff identity required'; end if;

  select * into v_subject from public.staff where id = v_subject_id;
  if not found then raise exception using errcode='42501', message='canonical staff record required'; end if;

  select * into v_item from public.staff_daily_checklist_items
  where id = p_item_id and active = true;
  if not found then raise exception using errcode='22023', message='active checklist item required'; end if;

  if trim(coalesce(v_item.role,'')) <> trim(coalesce(v_subject.role,'')) then
    raise exception using errcode='42501', message='checklist item does not belong to staff role';
  end if;

  if v_item.requires_photo and nullif(trim(coalesce(p_photo_url,'')),'') is null then
    raise exception using errcode='22023', message='checklist evidence photo required';
  end if;

  insert into public.staff_daily_checklist_submissions(
    staff_id,item_id,submission_date,branch,completed,photo_url,staff_note,
    submitted_at,review_status,reviewed_by,reviewed_by_name,reviewer_note,reviewed_at
  ) values (
    v_subject_id,p_item_id,v_today,trim(coalesce(v_subject.branch,v_account.branch,'')),true,
    nullif(trim(coalesce(p_photo_url,'')),''),nullif(trim(coalesce(p_staff_note,'')),''),
    now(),'pending',null,null,null,null
  )
  on conflict (staff_id,item_id,submission_date) do update set
    branch=excluded.branch,
    completed=true,
    photo_url=excluded.photo_url,
    staff_note=excluded.staff_note,
    submitted_at=excluded.submitted_at,
    review_status='pending',
    reviewed_by=null,
    reviewed_by_name=null,
    reviewer_note=null,
    reviewed_at=null,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.review_staff_daily_checklist_v1(p_submission_id uuid, p_status text, p_reviewer_note text default null::text)
returns staff_daily_checklist_submissions
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_catalog'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_target public.staff_daily_checklist_submissions%rowtype;
  v_row public.staff_daily_checklist_submissions%rowtype;
  v_role text;
begin
  if p_status not in ('approved','rejected') then
    raise exception using errcode='22023', message='invalid checklist review status';
  end if;
  if p_status='rejected' and nullif(trim(coalesce(p_reviewer_note,'')),'') is null then
    raise exception using errcode='22023', message='rejection note required';
  end if;

  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501', message='active staff actor required'; end if;

  select * into v_target from public.staff_daily_checklist_submissions
  where id = p_submission_id for update;
  if not found then raise exception using errcode='22023', message='checklist submission not found'; end if;

  v_role := lower(trim(coalesce(v_account.role,'')));
  if not public.user_has_permission(v_account.id,'view_team') then
    raise exception using errcode='42501', message='checklist review permission required';
  end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)
         <> public.dawaa_review_coverage_branch_key_v1(v_target.branch) then
    raise exception using errcode='42501', message='checklist review branch scope denied';
  end if;

  update public.staff_daily_checklist_submissions set
    review_status=p_status,
    reviewed_by=v_account.id,
    reviewed_by_name=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username),
    reviewer_note=case when p_status='rejected' then nullif(trim(coalesce(p_reviewer_note,'')),'') else null end,
    reviewed_at=now(),
    updated_at=now()
  where id=p_submission_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reconcile_cleaning_checklist_penalties_v2(p_staff_id uuid, p_submission_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff public.staff%rowtype;
  v_row record;
  v_used numeric := 0;
  v_award numeric;
  v_cycle text;
  v_existing uuid;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then return; end if;
  v_cycle := public.dawaa_points_cycle_label_for_date_v3(p_submission_date);

  update public.employee_transactions et
  set status='cancelled', updated_at=now(),
      metadata=coalesce(et.metadata,'{}'::jsonb)||jsonb_build_object('reconciled_by','cleaning_checklist_v2')
  where et.staff_id=p_staff_id
    and et.source='daily_checklist_self_report'
    and et.source_id in (
      select s.id from public.staff_daily_checklist_submissions s
      where s.staff_id=p_staff_id and s.submission_date=p_submission_date
    )
    and et.status in ('active','approved','pending');

  for v_row in
    select s.id as submission_id, s.branch, s.reviewed_by_name, s.reviewer_note,
           i.title as item_title, i.sort_order, e.title as rule_title, e.points as rule_points
    from public.staff_daily_checklist_submissions s
    join public.staff_daily_checklist_items i on i.id=s.item_id
    join public.evaluation_rules e on e.rule_key=i.rule_key_on_fail
    where s.staff_id=p_staff_id
      and s.submission_date=p_submission_date
      and s.review_status='rejected'
      and i.active=true
      and i.role=v_staff.role
    order by i.sort_order, s.id
  loop
    v_award := least(coalesce(v_row.rule_points,0), greatest(0, 30-v_used));
    if v_award <= 0 then continue; end if;
    v_used := v_used + v_award;

    select et.id into v_existing
    from public.employee_transactions et
    where et.source='daily_checklist_self_report' and et.source_id=v_row.submission_id
    order by et.updated_at desc nulls last, et.created_at desc nulls last
    limit 1;

    if v_existing is null then
      insert into public.employee_transactions(
        staff_id,type,points,points_delta,amount,reason,source,source_id,month_cycle,branch,status,
        employee_name,created_by,description,category,employee_visible,metadata
      ) values (
        p_staff_id,'penalty',v_award,-v_award,0,v_row.rule_title,'daily_checklist_self_report',v_row.submission_id,
        v_cycle,v_row.branch,'active',v_staff.name,coalesce(v_row.reviewed_by_name,'branch_manager'),
        'بند "'||v_row.item_title||'" بتاريخ '||p_submission_date||' — مرفوض من مدير الفرع.'||coalesce(' ملاحظة: '||v_row.reviewer_note,''),
        'النظافة والتشغيل',true,
        jsonb_build_object('engine_version',2,'policy','cleaning_daily_rejection_cap','daily_cap',30,'submission_date',p_submission_date)
      );
    else
      update public.employee_transactions
      set type='penalty',points=v_award,points_delta=-v_award,final_points=-v_award,
          reason=v_row.rule_title,month_cycle=v_cycle,branch=v_row.branch,status='active',
          description='بند "'||v_row.item_title||'" بتاريخ '||p_submission_date||' — مرفوض من مدير الفرع.'||coalesce(' ملاحظة: '||v_row.reviewer_note,''),
          category='النظافة والتشغيل',employee_visible=true,updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('engine_version',2,'policy','cleaning_daily_rejection_cap','daily_cap',30,'submission_date',p_submission_date)
      where id=v_existing;
    end if;
  end loop;
end;
$$;

create or replace function public.settle_checklist_review(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub record;
  v_rule record;
  v_month_cycle text;
  v_existing_id uuid;
begin
  select s.*, i.title as item_title, i.rule_key_on_fail, st.role as staff_role, st.name as staff_name
  into v_sub
  from public.staff_daily_checklist_submissions s
  join public.staff_daily_checklist_items i on i.id = s.item_id
  join public.staff st on st.id=s.staff_id
  where s.id = p_submission_id;

  if v_sub.id is null or v_sub.review_status = 'pending' then return; end if;

  if public.dawaa_is_cleaning_role_v1(v_sub.staff_role) then
    perform public.reconcile_cleaning_checklist_penalties_v2(v_sub.staff_id,v_sub.submission_date);
    return;
  end if;

  v_month_cycle := public.dawaa_points_cycle_label_for_date_v3(v_sub.submission_date);

  select id into v_existing_id from public.employee_transactions
  where source='daily_checklist_self_report' and source_id=p_submission_id
  order by updated_at desc nulls last, created_at desc nulls last limit 1;

  if v_sub.review_status='approved' then
    if v_existing_id is not null then
      update public.employee_transactions set status='cancelled',updated_at=now() where id=v_existing_id;
    end if;
    return;
  end if;

  if v_sub.rule_key_on_fail is null then return; end if;
  select * into v_rule from public.evaluation_rules where rule_key=v_sub.rule_key_on_fail;
  if v_rule.id is null then return; end if;

  if v_existing_id is null then
    insert into public.employee_transactions(
      staff_id,type,points,points_delta,amount,reason,source,source_id,month_cycle,branch,status,
      employee_name,created_by,description,category,employee_visible
    ) values (
      v_sub.staff_id,'penalty',v_rule.points,-v_rule.points,0,v_rule.title,'daily_checklist_self_report',p_submission_id,
      v_month_cycle,v_sub.branch,'active',v_sub.staff_name,coalesce(v_sub.reviewed_by_name,'branch_manager'),
      'بند "'||v_sub.item_title||'" بتاريخ '||v_sub.submission_date||' — مرفوض من مدير الفرع.'||coalesce(' ملاحظة: '||v_sub.reviewer_note,''),
      'الالتزام والانضباط',true
    );
  else
    update public.employee_transactions
    set type='penalty',points=v_rule.points,points_delta=-v_rule.points,final_points=-v_rule.points,
        reason=v_rule.title,month_cycle=v_month_cycle,branch=v_sub.branch,status='active',
        description='بند "'||v_sub.item_title||'" بتاريخ '||v_sub.submission_date||' — مرفوض من مدير الفرع.'||coalesce(' ملاحظة: '||v_sub.reviewer_note,''),
        updated_at=now()
    where id=v_existing_id;
  end if;
end;
$$;

create or replace function public.rate_cleaning_staff_day_v1(p_staff_id uuid, p_stars integer, p_manager_note text default null::text, p_rating_date date default current_date)
returns cleaning_daily_ratings
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_staff public.staff%rowtype;
  v_rating public.cleaning_daily_ratings%rowtype;
  v_points numeric;
  v_cycle text;
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_name text;
  v_existing_tx uuid;
  v_day record;
begin
  if p_stars < 1 or p_stars > 5 then raise exception 'stars_must_be_between_1_and_5'; end if;
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then raise exception 'cleaning_staff_not_found'; end if;
  if not v_global and coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then raise exception 'not_authorized_for_branch'; end if;

  select * into v_day from public.get_cleaning_day_checklist_summary_v2(p_staff_id,coalesce(p_rating_date,current_date));
  if not coalesce(v_day.rating_ready,false) then raise exception 'cleaning_checklist_review_incomplete'; end if;
  if p_stars > coalesce(v_day.max_stars,1) then raise exception 'stars_exceed_checklist_cap:%',v_day.max_stars; end if;

  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;
  v_points := public.dawaa_cleaning_star_points_v1(p_stars);
  v_cycle := public.dawaa_points_cycle_label_for_date_v3(coalesce(p_rating_date,current_date));

  insert into public.cleaning_daily_ratings(staff_id,branch,rating_date,stars,score_pct,points_delta,month_cycle,manager_note,rated_by,rated_by_name)
  values(p_staff_id,v_staff.branch,coalesce(p_rating_date,current_date),p_stars,p_stars*20,v_points,v_cycle,nullif(trim(coalesce(p_manager_note,'')),''),v_actor_id,v_actor_name)
  on conflict(staff_id,rating_date) do update set stars=excluded.stars,score_pct=excluded.score_pct,points_delta=excluded.points_delta,month_cycle=excluded.month_cycle,manager_note=excluded.manager_note,rated_by=excluded.rated_by,rated_by_name=excluded.rated_by_name,branch=excluded.branch,updated_at=now()
  returning * into v_rating;

  select et.id into v_existing_tx from public.employee_transactions et
  where et.staff_id=p_staff_id and et.month_cycle=v_cycle and et.source='cleaning_daily_star_rating' and et.source_id=v_rating.id
  order by et.updated_at desc nulls last,et.created_at desc nulls last limit 1;

  if v_existing_tx is null then
    insert into public.employee_transactions(staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,source,source_id,transaction_date,month_cycle,branch,status,category,created_by,created_by_name,approved_by,approved_by_name,approved_at,employee_visible,metadata)
    values(p_staff_id,p_staff_id,v_staff.name,case when v_points<0 then 'penalty' else 'reward' end,'تقييم النظافة اليومي بالنجوم',format('تقييم يومي: %s/5 نجوم (%s%%)',p_stars,p_stars*20),nullif(trim(coalesce(p_manager_note,'')),''),0,abs(v_points),v_points,v_points,'cleaning_daily_star_rating',v_rating.id,coalesce(p_rating_date,current_date),v_cycle,v_staff.branch,'active','النظافة والتشغيل',v_actor_id,v_actor_name,v_actor_id,v_actor_name,now(),true,jsonb_build_object('engine_version',4,'policy_version',2,'stars',p_stars,'score_pct',p_stars*20,'rating_date',coalesce(p_rating_date,current_date),'rule_code','CLEAN-DAILY-STAR-V2','checklist_max_stars',v_day.max_stars,'approved_items',v_day.approved_items,'required_items',v_day.required_items));
  else
    update public.employee_transactions
    set type=case when v_points<0 then 'penalty' else 'reward' end,points=abs(v_points),points_delta=v_points,final_points=v_points,
        reason=format('تقييم يومي: %s/5 نجوم (%s%%)',p_stars,p_stars*20),description=nullif(trim(coalesce(p_manager_note,'')),''),
        transaction_date=coalesce(p_rating_date,current_date),branch=v_staff.branch,status='active',category='النظافة والتشغيل',
        approved_by=v_actor_id,approved_by_name=v_actor_name,approved_at=now(),updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('engine_version',4,'policy_version',2,'stars',p_stars,'score_pct',p_stars*20,'rating_date',coalesce(p_rating_date,current_date),'rule_code','CLEAN-DAILY-STAR-V2','checklist_max_stars',v_day.max_stars,'approved_items',v_day.approved_items,'required_items',v_day.required_items)
    where id=v_existing_tx;
  end if;
  return v_rating;
end;
$$;

create or replace function public.settle_checklist_weekly_excellence()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_reward_rule_key text;
  v_rule record;
  v_month_cycle text;
  v_count integer := 0;
begin
  for v_row in
    select s.staff_id, st.name as staff_name, st.role, s.branch,
           count(*) as total_reviewed,
           count(*) filter (where s.review_status = 'approved') as approved_count,
           count(*) filter (where s.review_status = 'rejected') as rejected_count,
           max(s.submission_date) as anchor_date
    from public.staff_daily_checklist_submissions s
    join public.staff st on st.id = s.staff_id
    where s.submission_date >= current_date - interval '7 days'
      and s.review_status <> 'pending'
    group by s.staff_id, st.name, st.role, s.branch
    having count(*) filter (where s.review_status = 'rejected') = 0 and count(*) >= 5
  loop
    v_reward_rule_key := case v_row.role when 'مسؤولة النظافة' then 'cleaner_excellence' when 'مساعد صيدلي' then 'assistant_order_entry_excellence' else null end;
    if v_reward_rule_key is null then continue; end if;
    select * into v_rule from public.evaluation_rules where rule_key = v_reward_rule_key;
    if v_rule.id is null then continue; end if;
    v_month_cycle := public.dawaa_points_cycle_label_for_date_v3(v_row.anchor_date);

    if not exists (
      select 1 from public.employee_transactions
      where staff_id = v_row.staff_id and source = 'daily_checklist_weekly_excellence'
        and status in ('active','approved','pending') and created_at >= current_date - interval '7 days'
    ) then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
      values(v_row.staff_id,'reward',v_rule.points,v_rule.points,0,v_rule.title,'daily_checklist_weekly_excellence',v_month_cycle,v_row.branch,'active',v_row.staff_name,'system_automation','أسبوع كامل ('||v_row.total_reviewed||' بند) بدون أي رفض من مدير الفرع.','الالتزام والانضباط',true);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;