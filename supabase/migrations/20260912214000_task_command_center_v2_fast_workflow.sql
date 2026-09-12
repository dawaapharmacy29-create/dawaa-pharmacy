-- Task Command Center v2: fast lifecycle, audit trail, snooze and timed escalation.
-- Backward-compatible with the existing tasks UI: direct inserts/updates still work.

alter table public.tasks
  add column if not exists due_at timestamptz,
  add column if not exists category text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text,
  add column if not exists completed_by_name text,
  add column if not exists outcome_note text,
  add column if not exists snoozed_until timestamptz,
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalated_at timestamptz,
  add column if not exists last_action_by text,
  add column if not exists last_action_by_name text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.task_activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id text,
  actor_name text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_staff_open_due_v2 on public.tasks (staff_id, status, due_at);
create index if not exists idx_tasks_branch_open_due_v2 on public.tasks (branch, status, due_at);
create index if not exists idx_tasks_snoozed_until_v2 on public.tasks (snoozed_until) where snoozed_until is not null;
create index if not exists idx_tasks_escalation_v2 on public.tasks (escalation_level, due_at) where status not in ('completed','closed','cancelled','done','تم','مكتمل');
create index if not exists idx_task_activity_task_created_v2 on public.task_activity_log (task_id, created_at desc);

create or replace function public.normalize_task_priority_v2(p_value text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(p_value,'normal')))
    when 'خطر' then 'critical' when 'حرج' then 'critical' when 'critical' then 'critical'
    when 'urgent' then 'urgent' when 'عاجل' then 'urgent'
    when 'مهم' then 'high' when 'عالية' then 'high' when 'high' then 'high'
    when 'متوسطة' then 'normal' when 'عادي' then 'normal' when 'normal' then 'normal'
    when 'low' then 'low' when 'منخفض' then 'low' else 'normal' end;
$$;

create or replace function public.normalize_task_status_v2(p_value text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(p_value,'open')))
    when 'قيد التنفيذ' then 'open' when 'جديد' then 'open' when 'open' then 'open' when 'new' then 'open'
    when 'in_progress' then 'in_progress' when 'قيد المتابعة' then 'in_progress' when 'بدأت' then 'in_progress'
    when 'snoozed' then 'snoozed' when 'مؤجلة' then 'snoozed'
    when 'completed' then 'completed' when 'done' then 'completed' when 'تم' then 'completed' when 'مكتمل' then 'completed' when 'closed' then 'completed'
    when 'cancelled' then 'cancelled' when 'ملغي' then 'cancelled'
    else lower(trim(coalesce(p_value,'open'))) end;
$$;

create or replace function public.task_before_write_v2()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare v_old_status text; v_new_status text;
begin
  v_old_status := case when tg_op='UPDATE' then public.normalize_task_status_v2(old.status) else null end;
  v_new_status := public.normalize_task_status_v2(new.status);
  new.status := v_new_status;
  new.priority := public.normalize_task_priority_v2(new.priority);
  new.updated_at := now();
  if new.due_at is null and nullif(trim(coalesce(new.due_date,'')),'') ~ '^\d{4}-\d{2}-\d{2}$' then
    new.due_at := ((new.due_date::date + time '23:59:00') at time zone 'Africa/Cairo');
  end if;
  if new.due_at is not null then new.due_date := to_char(new.due_at at time zone 'Africa/Cairo','YYYY-MM-DD'); end if;
  if v_new_status='in_progress' and coalesce(v_old_status,'') <> 'in_progress' then
    new.acknowledged_at := coalesce(new.acknowledged_at,now());
    new.started_at := coalesce(new.started_at,now());
    new.snoozed_until := null;
  elsif v_new_status='completed' and coalesce(v_old_status,'') <> 'completed' then
    new.completed_at := coalesce(new.completed_at,now());
    new.snoozed_until := null;
  elsif v_new_status <> 'snoozed' then
    new.snoozed_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_before_write_v2 on public.tasks;
create trigger trg_tasks_before_write_v2 before insert or update on public.tasks
for each row execute function public.task_before_write_v2();

create or replace function public.task_after_write_v2()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_event text; v_old_status text; v_new_status text; v_actor text; v_actor_name text; v_key text;
begin
  v_actor := coalesce(new.last_action_by,new.added_by,public.employee_operating_actor_id());
  v_actor_name := new.last_action_by_name;
  v_new_status := public.normalize_task_status_v2(new.status);
  v_old_status := case when tg_op='UPDATE' then public.normalize_task_status_v2(old.status) else null end;

  if tg_op='INSERT' then v_event := 'created';
  elsif v_old_status is distinct from v_new_status then v_event := v_new_status;
  elsif coalesce(old.escalation_level,0) is distinct from coalesce(new.escalation_level,0) then v_event := 'escalated';
  elsif old.snoozed_until is distinct from new.snoozed_until then v_event := 'snoozed';
  else v_event := 'updated'; end if;

  if tg_op='INSERT' or v_event <> 'updated' then
    insert into public.task_activity_log(task_id,event_type,from_status,to_status,actor_id,actor_name,note,metadata)
    values(new.id,v_event,v_old_status,v_new_status,v_actor,v_actor_name,new.outcome_note,
      jsonb_build_object('branch',new.branch,'priority',new.priority,'assigned_name',new.assigned_name,'escalation_level',new.escalation_level,'due_at',new.due_at,'snoozed_until',new.snoozed_until));
  end if;

  if tg_op='INSERT' and new.staff_id is not null then
    v_key := 'staff_task:' || lower(new.staff_id::text) || ':task:' || lower(new.id) || ':current';
    perform public.create_staff_notification(
      new.staff_id,'staff_task','مهمة جديدة: ' || new.title,
      coalesce(nullif(new.description,''),new.title) || case when new.due_at is not null then ' · الموعد ' || to_char(new.due_at at time zone 'Africa/Cairo','DD/MM HH24:MI') else '' end,
      'task',new.id,'/operations-center?taskId=' || new.id,
      case new.priority when 'critical' then 'critical' when 'urgent' then 'urgent' when 'high' then 'high' else 'normal' end,
      jsonb_build_object('taskId',new.id,'assignedName',new.assigned_name,'branch',new.branch,'dueAt',new.due_at,'category',new.category,'signalTier',case when new.priority in ('critical','urgent') then 'critical' else 'action' end),
      v_key,null,new.branch
    );
  end if;

  if tg_op='UPDATE' and v_new_status='completed' and coalesce(v_old_status,'') <> 'completed' then
    update public.notifications
    set status='completed',action_status='completed',is_read=true,read=true,
        completed_at=coalesce(completed_at,now()),read_at=coalesce(read_at,now()),
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('taskCompletedAt',new.completed_at,'taskCompletedBy',new.completed_by_name,'taskOutcome',new.outcome_note)
    where entity_type='task' and entity_id=new.id and coalesce(action_status,'new') not in ('completed','dismissed');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_after_write_v2 on public.tasks;
create trigger trg_tasks_after_write_v2 after insert or update on public.tasks
for each row execute function public.task_after_write_v2();

create or replace function public.task_actor_context_v2()
returns table(actor_account_id text,actor_staff_id uuid,actor_name text,actor_role text,actor_branch text)
language sql stable security definer set search_path=public,pg_catalog as $$
  select sa.id::text,
         nullif(trim(coalesce(sa.staff_id,'')),'')::uuid,
         coalesce(nullif(trim(sa.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'مستخدم'),
         lower(trim(coalesce(sa.role,sa.staff_role,''))),
         coalesce(nullif(trim(sa.branch),''),'')
  from public.staff_accounts sa
  where sa.id::text=public.employee_operating_actor_id()
     or nullif(trim(coalesce(sa.staff_id,'')),'')=public.employee_operating_actor_id()
     or nullif(trim(coalesce(sa.username,'')),'')=public.employee_operating_actor_id()
  order by case when sa.id::text=public.employee_operating_actor_id() then 0 else 1 end
  limit 1;
$$;

create or replace function public.task_quick_action_v2(p_task_id text,p_action text,p_note text default null,p_snooze_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_task public.tasks%rowtype;
  v_actor record;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_global boolean := false;
  v_branch_manager boolean := false;
  v_authorized boolean := false;
begin
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  select * into v_actor from public.task_actor_context_v2() limit 1;
  if v_actor.actor_account_id is null then return jsonb_build_object('ok',false,'error','actor_not_found'); end if;

  v_global := v_actor.actor_role in ('general_manager','executive_manager','branches_manager','admin','owner','manager');
  v_branch_manager := v_actor.actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','procurement_manager');
  v_authorized := v_global or v_task.staff_id=v_actor.actor_staff_id
    or (v_branch_manager and coalesce(v_task.branch,'')<>'' and coalesce(v_actor.actor_branch,'')=coalesce(v_task.branch,''));
  if not v_authorized then return jsonb_build_object('ok',false,'error','not_authorized'); end if;

  if v_action='start' then
    update public.tasks set status='in_progress',acknowledged_at=coalesce(acknowledged_at,now()),started_at=coalesce(started_at,now()),last_action_by=v_actor.actor_account_id,last_action_by_name=v_actor.actor_name where id=p_task_id;
  elsif v_action='complete' then
    update public.tasks set status='completed',completed_by=v_actor.actor_account_id,completed_by_name=v_actor.actor_name,outcome_note=coalesce(nullif(trim(p_note),''),outcome_note),last_action_by=v_actor.actor_account_id,last_action_by_name=v_actor.actor_name where id=p_task_id;
  elsif v_action='snooze' then
    update public.tasks set status='snoozed',snoozed_until=now()+make_interval(mins=>greatest(15,least(coalesce(p_snooze_minutes,60),10080))),last_action_by=v_actor.actor_account_id,last_action_by_name=v_actor.actor_name where id=p_task_id;
  elsif v_action in ('resume','reopen') then
    update public.tasks set status='open',snoozed_until=null,completed_at=case when v_action='reopen' then null else completed_at end,completed_by=case when v_action='reopen' then null else completed_by end,completed_by_name=case when v_action='reopen' then null else completed_by_name end,last_action_by=v_actor.actor_account_id,last_action_by_name=v_actor.actor_name where id=p_task_id;
  elsif v_action='escalate' then
    update public.tasks set escalation_level=least(coalesce(escalation_level,0)+1,3),escalated_at=now(),priority=case when coalesce(escalation_level,0)+1>=3 then 'critical' when coalesce(escalation_level,0)+1=2 then 'urgent' else 'high' end,last_action_by=v_actor.actor_account_id,last_action_by_name=v_actor.actor_name where id=p_task_id;
  else
    return jsonb_build_object('ok',false,'error','unsupported_action');
  end if;

  select * into v_task from public.tasks where id=p_task_id;
  return jsonb_build_object('ok',true,'task_id',v_task.id,'status',v_task.status,'priority',v_task.priority,'escalation_level',v_task.escalation_level,'snoozed_until',v_task.snoozed_until,'completed_at',v_task.completed_at);
end;
$$;

create or replace function public.get_task_command_center_v2(p_limit integer default 200)
returns table(
  id text,title text,description text,assigned_name text,staff_id uuid,branch text,status text,priority text,due_date text,due_at timestamptz,category text,
  acknowledged_at timestamptz,started_at timestamptz,completed_at timestamptz,outcome_note text,snoozed_until timestamptz,escalation_level integer,created_at timestamptz,updated_at timestamptz,
  is_overdue boolean,minutes_overdue integer,attention_rank integer
)
language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_actor record; v_global boolean; v_branch_manager boolean;
begin
  select * into v_actor from public.task_actor_context_v2() limit 1;
  if v_actor.actor_account_id is null then return; end if;
  v_global := v_actor.actor_role in ('general_manager','executive_manager','branches_manager','admin','owner','manager');
  v_branch_manager := v_actor.actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','procurement_manager');

  return query
  select t.id,t.title,t.description,t.assigned_name,t.staff_id,t.branch,
    public.normalize_task_status_v2(t.status),public.normalize_task_priority_v2(t.priority),t.due_date,t.due_at,t.category,
    t.acknowledged_at,t.started_at,t.completed_at,t.outcome_note,t.snoozed_until,t.escalation_level,t.created_at,t.updated_at,
    (t.due_at is not null and t.due_at<now() and public.normalize_task_status_v2(t.status) not in ('completed','cancelled') and coalesce(t.snoozed_until,now()-interval '1 second')<=now()),
    case when t.due_at is not null and t.due_at<now() then greatest(0,floor(extract(epoch from (now()-t.due_at))/60)::integer) else 0 end,
    (case public.normalize_task_priority_v2(t.priority) when 'critical' then 5000 when 'urgent' then 4000 when 'high' then 3000 when 'normal' then 2000 else 1000 end
      + case when t.due_at is not null and t.due_at<now() then least(999,greatest(0,floor(extract(epoch from (now()-t.due_at))/60)::integer)) else 0 end
      + coalesce(t.escalation_level,0)*500
      + case public.normalize_task_status_v2(t.status) when 'in_progress' then 200 when 'snoozed' then -500 when 'completed' then -3000 else 0 end)::integer
  from public.tasks t
  where v_global or (v_branch_manager and coalesce(t.branch,'')=coalesce(v_actor.actor_branch,'')) or t.staff_id=v_actor.actor_staff_id
  order by 22 desc,t.created_at desc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$$;

create or replace function public.refresh_task_escalations_v2()
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare r record; v_level integer; v_count integer:=0; v_manager uuid; v_key text;
begin
  for r in
    select * from public.tasks
    where due_at is not null and due_at<now()
      and public.normalize_task_status_v2(status) not in ('completed','cancelled')
      and (snoozed_until is null or snoozed_until<=now())
  loop
    v_level := case when now()-r.due_at>=interval '6 hours' then 3 when now()-r.due_at>=interval '2 hours' then 2 when now()-r.due_at>=interval '30 minutes' then 1 else 0 end;
    if v_level<=coalesce(r.escalation_level,0) then continue; end if;

    update public.tasks set escalation_level=v_level,escalated_at=now(),priority=case v_level when 3 then 'critical' when 2 then 'urgent' else 'high' end where id=r.id;

    select nullif(trim(coalesce(sa.staff_id,'')),'')::uuid into v_manager
    from public.staff_accounts sa
    where coalesce(sa.active,sa.is_active,true) and coalesce(sa.can_login,true)
      and nullif(trim(coalesce(sa.staff_id,'')),'') is not null
      and ((lower(trim(coalesce(sa.role,sa.staff_role,''))) in ('branch_manager','customer_service_manager') and coalesce(sa.branch,'')=coalesce(r.branch,''))
        or lower(trim(coalesce(sa.role,sa.staff_role,''))) in ('branches_manager','general_manager'))
    order by case
      when lower(trim(coalesce(sa.role,sa.staff_role,'')))='branch_manager' and coalesce(sa.branch,'')=coalesce(r.branch,'') then 0
      when lower(trim(coalesce(sa.role,sa.staff_role,'')))='customer_service_manager' and coalesce(sa.branch,'')=coalesce(r.branch,'') then 1
      when lower(trim(coalesce(sa.role,sa.staff_role,'')))='branches_manager' then 2 else 3 end
    limit 1;

    if v_manager is not null then
      v_key := 'task-escalation:'||r.id;
      perform public.create_staff_notification(
        v_manager,'manager_alert','مهمة متأخرة تحتاج تدخل: '||r.title,
        'المسؤول: '||coalesce(r.assigned_name,'غير محدد')||' · الفرع: '||coalesce(r.branch,'غير محدد')||' · التأخير: '||floor(extract(epoch from(now()-r.due_at))/60)::int||' دقيقة.',
        'task',r.id,'/operations-center?taskId='||r.id,
        case v_level when 3 then 'critical' when 2 then 'urgent' else 'high' end,
        jsonb_build_object('taskId',r.id,'assignedName',r.assigned_name,'branch',r.branch,'escalationLevel',v_level,'dueAt',r.due_at,'signalTier',case when v_level>=2 then 'critical' else 'action' end),
        v_key,null,r.branch
      );
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

do $$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job from cron.job where jobname='dawaa-task-escalation-v2' limit 1;
    if v_job is not null then perform cron.unschedule(v_job); end if;
    perform cron.schedule('dawaa-task-escalation-v2','*/15 * * * *','select public.refresh_task_escalations_v2();');
  end if;
end $$;

grant execute on function public.task_quick_action_v2(text,text,text,integer) to anon, authenticated;
grant execute on function public.get_task_command_center_v2(integer) to anon, authenticated;
