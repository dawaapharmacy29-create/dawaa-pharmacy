-- Draft/Validate/Publish workflow for workforce schedules.
-- Draft rows are isolated from shift_schedules, so Attendance Truth never reads them before publish.

create table if not exists public.workforce_schedule_drafts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_name text not null,
  branch text,
  role text,
  effective_from date not null,
  status text not null default 'draft' check (status in ('draft','validated','published','cancelled')),
  note text,
  validation jsonb not null default '{"errors":[],"warnings":[]}'::jsonb,
  created_by uuid,
  validated_by uuid,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  validated_at timestamptz,
  published_at timestamptz,
  check (effective_from >= date '2026-01-01')
);

create table if not exists public.workforce_schedule_draft_rows (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.workforce_schedule_drafts(id) on delete cascade,
  day_name text not null,
  shift_start text,
  shift_end text,
  is_off boolean not null default false,
  is_day_off boolean not null default false,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(draft_id,day_name)
);

alter table public.workforce_schedule_drafts enable row level security;
alter table public.workforce_schedule_draft_rows enable row level security;
revoke all on public.workforce_schedule_drafts from public,anon,authenticated;
revoke all on public.workforce_schedule_draft_rows from public,anon,authenticated;

create or replace function public.schedule_draft_seed_v1(p_staff_id uuid,p_effective_from date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
  v_date date:=coalesce(p_effective_from,(now() at time zone 'Africa/Cairo')::date);
  v_rows jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,is_active,true);
  if not found then raise exception 'staff_not_found_or_inactive' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then raise exception 'not authorized' using errcode='42501'; end if;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then raise exception 'not authorized for staff' using errcode='42501'; end if;

  with days(day_name,sort_order) as (
    values ('السبت',0),('الأحد',1),('الاثنين',2),('الثلاثاء',3),('الأربعاء',4),('الخميس',5),('الجمعة',6)
  ), chosen as (
    select d.day_name,d.sort_order,
      (select ss.shift_start from public.shift_schedules ss
       where ss.staff_id=p_staff_id and ss.day_name=d.day_name
         and ss.shift_date is null and ss.date is null
         and ss.effective_from<=v_date and (ss.effective_to is null or ss.effective_to>=v_date)
         and coalesce(ss.status,'scheduled')<>'draft'
       order by ss.effective_from desc,coalesce(ss.updated_at,ss.created_at) desc nulls last,ss.id desc limit 1) shift_start,
      (select ss.shift_end from public.shift_schedules ss
       where ss.staff_id=p_staff_id and ss.day_name=d.day_name
         and ss.shift_date is null and ss.date is null
         and ss.effective_from<=v_date and (ss.effective_to is null or ss.effective_to>=v_date)
         and coalesce(ss.status,'scheduled')<>'draft'
       order by ss.effective_from desc,coalesce(ss.updated_at,ss.created_at) desc nulls last,ss.id desc limit 1) shift_end,
      coalesce((select coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false)
       from public.shift_schedules ss
       where ss.staff_id=p_staff_id and ss.day_name=d.day_name
         and ss.shift_date is null and ss.date is null
         and ss.effective_from<=v_date and (ss.effective_to is null or ss.effective_to>=v_date)
         and coalesce(ss.status,'scheduled')<>'draft'
       order by ss.effective_from desc,coalesce(ss.updated_at,ss.created_at) desc nulls last,ss.id desc limit 1),false) is_off
    from days d
  )
  select jsonb_agg(jsonb_build_object(
    'day_name',day_name,'sort_order',sort_order,'shift_start',shift_start,'shift_end',shift_end,'is_off',is_off
  ) order by sort_order) into v_rows from chosen;

  return jsonb_build_object(
    'staff_id',v_staff.id,'staff_name',v_staff.name,'branch',v_staff.branch,'role',v_staff.role,
    'effective_from',v_date,'rows',coalesce(v_rows,'[]'::jsonb)
  );
end;
$function$;

create or replace function public.create_schedule_draft_v1(
  p_staff_id uuid,p_effective_from date,p_rows jsonb,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_id uuid;
  v_row jsonb;
  v_day text;
  v_sort integer:=0;
begin
  if p_staff_id is null or p_effective_from is null or jsonb_typeof(p_rows)<>'array' then raise exception 'invalid_schedule_draft_input' using errcode='22023'; end if;
  if p_effective_from < (now() at time zone 'Africa/Cairo')::date then raise exception 'schedule_draft_cannot_start_in_past' using errcode='22023'; end if;

  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then raise exception 'not_authorized_for_schedule_write' using errcode='42501'; end if;

  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,is_active,true);
  if not found then raise exception 'target_staff_not_found_or_inactive' using errcode='22023'; end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_staff.branch,'')) then raise exception 'branch_manager_cross_branch_schedule_write_blocked' using errcode='42501'; end if;

  insert into public.workforce_schedule_drafts(staff_id,staff_name,branch,role,effective_from,status,note,created_by)
  values(p_staff_id,v_staff.name,v_staff.branch,v_staff.role,p_effective_from,'draft',nullif(trim(coalesce(p_note,'')),''),v_actor.id)
  returning id into v_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_day:=nullif(trim(v_row->>'day_name'),'');
    if v_day is null then continue; end if;
    v_sort:=coalesce(nullif(v_row->>'sort_order','')::int,v_sort);
    insert into public.workforce_schedule_draft_rows(draft_id,day_name,shift_start,shift_end,is_off,is_day_off,notes,sort_order)
    values(v_id,v_day,nullif(trim(v_row->>'shift_start'),''),nullif(trim(v_row->>'shift_end'),''),
      coalesce((v_row->>'is_off')::boolean,false),
      coalesce((v_row->>'is_day_off')::boolean,coalesce((v_row->>'is_off')::boolean,false)),
      nullif(trim(v_row->>'notes'),''),v_sort);
    v_sort:=v_sort+1;
  end loop;

  return jsonb_build_object('draft_id',v_id,'status','draft','staff_id',p_staff_id,'effective_from',p_effective_from);
end;
$function$;

create or replace function public.validate_schedule_draft_v1(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_draft public.workforce_schedule_drafts%rowtype;
  v_errors jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_count integer;
  v_working integer;
  v_off integer;
  v_result jsonb;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select * into v_draft from public.workforce_schedule_drafts where id=p_draft_id for update;
  if not found then raise exception 'schedule_draft_not_found' using errcode='22023'; end if;
  if v_draft.status in ('published','cancelled') then raise exception 'schedule_draft_closed' using errcode='22023'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then raise exception 'not_authorized_for_schedule_write' using errcode='42501'; end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_draft.branch,'')) then raise exception 'branch_manager_cross_branch_schedule_write_blocked' using errcode='42501'; end if;

  select count(*)::int,count(*) filter(where not is_off)::int,count(*) filter(where is_off)::int
  into v_count,v_working,v_off from public.workforce_schedule_draft_rows where draft_id=p_draft_id;

  if v_count<>7 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','week_incomplete','label','المسودة يجب أن تحتوي 7 أيام','count',v_count)); end if;
  if exists(select 1 from public.workforce_schedule_draft_rows where draft_id=p_draft_id and day_name not in ('السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة')) then
    v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','invalid_day_name','label','يوجد اسم يوم غير صالح'));
  end if;
  if exists(select 1 from public.workforce_schedule_draft_rows where draft_id=p_draft_id and not is_off and (
    shift_start is null or shift_end is null or shift_start !~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' or shift_end !~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
  )) then
    v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','invalid_work_time','label','يوجد يوم عمل بدون وقت دخول/خروج صالح'));
  end if;
  if v_working=0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','all_week_off','label','كل أيام الأسبوع إجازة')); end if;
  if v_off=0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','no_weekly_off','label','لا يوجد يوم راحة أسبوعي في المسودة')); end if;
  if v_draft.effective_from < (now() at time zone 'Africa/Cairo')::date then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','effective_from_past','label','تاريخ بدء المسودة أصبح في الماضي')); end if;

  v_result:=jsonb_build_object('draft_id',p_draft_id,'valid',jsonb_array_length(v_errors)=0,'errors',v_errors,'warnings',v_warnings,'rows',v_count,'working_days',v_working,'off_days',v_off);

  update public.workforce_schedule_drafts
  set validation=v_result,status=case when jsonb_array_length(v_errors)=0 then 'validated' else 'draft' end,
      validated_by=case when jsonb_array_length(v_errors)=0 then v_actor.id else null end,
      validated_at=case when jsonb_array_length(v_errors)=0 then now() else null end,updated_at=now()
  where id=p_draft_id;

  return v_result;
end;
$function$;

create or replace function public.publish_schedule_draft_v1(p_draft_id uuid,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_draft public.workforce_schedule_drafts%rowtype;
  v_validation jsonb;
  v_rows jsonb;
  v_publish jsonb;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select * into v_draft from public.workforce_schedule_drafts where id=p_draft_id for update;
  if not found then raise exception 'schedule_draft_not_found' using errcode='22023'; end if;
  if v_draft.status='published' then return jsonb_build_object('success',true,'already_published',true,'draft_id',p_draft_id); end if;
  if v_draft.status='cancelled' then raise exception 'schedule_draft_cancelled' using errcode='22023'; end if;
  if v_draft.effective_from < (now() at time zone 'Africa/Cairo')::date then raise exception 'schedule_publish_cannot_start_in_past' using errcode='22023'; end if;

  v_validation:=public.validate_schedule_draft_v1(p_draft_id);
  if coalesce((v_validation->>'valid')::boolean,false) is not true then raise exception 'schedule_draft_validation_failed' using errcode='22023'; end if;

  select jsonb_agg(jsonb_build_object(
    'day_name',r.day_name,'shift_start',case when r.is_off then null else r.shift_start end,
    'shift_end',case when r.is_off then null else r.shift_end end,'is_off',r.is_off,'is_day_off',r.is_day_off,
    'notes',coalesce(r.notes,v_draft.note),'source','schedule_draft_publish_v1','status','scheduled'
  ) order by r.sort_order,r.day_name)
  into v_rows from public.workforce_schedule_draft_rows r where r.draft_id=p_draft_id;

  v_publish:=public.replace_staff_shift_schedule_version_v1(
    v_draft.staff_id,v_rows,v_draft.effective_from,
    concat_ws(' | ','نشر مسودة جدول',nullif(trim(coalesce(p_note,'')),''),nullif(trim(coalesce(v_draft.note,'')),''))
  );

  update public.workforce_schedule_drafts
  set status='published',published_by=v_actor.id,published_at=now(),updated_at=now(),
      note=concat_ws(' | ',nullif(note,''),nullif(trim(coalesce(p_note,'')),''))
  where id=p_draft_id;

  return jsonb_build_object('success',true,'draft_id',p_draft_id,'staff_id',v_draft.staff_id,'effective_from',v_draft.effective_from,'publish_result',v_publish);
end;
$function$;

create or replace function public.list_schedule_drafts_v1(p_branch text default null,p_status text default null,p_limit integer default 100)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',d.id,'staff_id',d.staff_id,'staff_name',d.staff_name,'branch',d.branch,'role',d.role,
      'effective_from',d.effective_from,'status',d.status,'note',d.note,'validation',d.validation,
      'created_at',d.created_at,'validated_at',d.validated_at,'published_at',d.published_at,
      'rows',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'day_name',r.day_name,'shift_start',r.shift_start,'shift_end',r.shift_end,
        'is_off',r.is_off,'is_day_off',r.is_day_off,'notes',r.notes,'sort_order',r.sort_order
      ) order by r.sort_order,r.day_name),'[]'::jsonb) from public.workforce_schedule_draft_rows r where r.draft_id=d.id)
    ) order by d.created_at desc)
    from (
      select * from public.workforce_schedule_drafts
      where (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(branch)=trim(p_branch))
        and (p_status is null or trim(p_status)='' or status=p_status)
        and public.dawaa_can_read_staff_attendance_log(staff_id,branch)
      order by created_at desc
      limit greatest(1,least(coalesce(p_limit,100),300))
    ) d
  ),'[]'::jsonb);
end;
$function$;

revoke execute on function public.schedule_draft_seed_v1(uuid,date) from public;
revoke execute on function public.create_schedule_draft_v1(uuid,date,jsonb,text) from public;
revoke execute on function public.validate_schedule_draft_v1(uuid) from public;
revoke execute on function public.publish_schedule_draft_v1(uuid,text) from public;
revoke execute on function public.list_schedule_drafts_v1(text,text,integer) from public;
grant execute on function public.schedule_draft_seed_v1(uuid,date) to anon,authenticated,service_role;
grant execute on function public.create_schedule_draft_v1(uuid,date,jsonb,text) to anon,authenticated,service_role;
grant execute on function public.validate_schedule_draft_v1(uuid) to anon,authenticated,service_role;
grant execute on function public.publish_schedule_draft_v1(uuid,text) to anon,authenticated,service_role;
grant execute on function public.list_schedule_drafts_v1(text,text,integer) to anon,authenticated,service_role;
