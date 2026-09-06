-- Staff HR 360 foundation v1
-- Canonical employment timeline + compensation history + scoped read model.

create table if not exists public.staff_employment_events_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  event_type text not null check (event_type in (
    'hire','promotion','role_change','branch_transfer','status_change','warning',
    'commendation','training','responsibility_change','contract_update','note'
  )),
  effective_date date not null,
  title text not null,
  description text,
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  source text not null default 'hr_manual',
  source_id text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  evidence_hash text not null
);

create index if not exists idx_staff_employment_events_v1_staff_date
  on public.staff_employment_events_v1(staff_id,effective_date desc,created_at desc);

alter table public.staff_employment_events_v1 enable row level security;
revoke all on public.staff_employment_events_v1 from public, anon, authenticated;
grant select on public.staff_employment_events_v1 to anon, authenticated, service_role;

create table if not exists public.staff_compensation_history_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_username text,
  effective_from date not null,
  base_salary numeric not null default 0,
  hourly_rate numeric not null default 0,
  target_bonus_amount numeric not null default 0,
  quarterly_bonus_amount numeric not null default 0,
  reason text not null,
  source text not null default 'payroll_profile',
  source_id uuid,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  evidence_hash text not null
);

create index if not exists idx_staff_comp_history_v1_staff_date
  on public.staff_compensation_history_v1(staff_id,effective_from desc,created_at desc);

alter table public.staff_compensation_history_v1 enable row level security;
revoke all on public.staff_compensation_history_v1 from public, anon, authenticated;
grant select on public.staff_compensation_history_v1 to anon, authenticated, service_role;

create or replace function public.hr360_hash_payload_v1(p_payload jsonb)
returns text language sql immutable as $$
  select encode(digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'utf8'),'sha256'),'hex')
$$;
revoke all on function public.hr360_hash_payload_v1(jsonb) from public, anon, authenticated;

create or replace function public.block_staff_hr_history_mutation_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  raise exception 'staff HR history is append-only';
end $$;
revoke all on function public.block_staff_hr_history_mutation_v1() from public, anon, authenticated;

drop trigger if exists staff_employment_events_v1_immutable on public.staff_employment_events_v1;
create trigger staff_employment_events_v1_immutable
before update or delete on public.staff_employment_events_v1
for each row execute function public.block_staff_hr_history_mutation_v1();

drop trigger if exists staff_compensation_history_v1_immutable on public.staff_compensation_history_v1;
create trigger staff_compensation_history_v1_immutable
before update or delete on public.staff_compensation_history_v1
for each row execute function public.block_staff_hr_history_mutation_v1();

create or replace function public.capture_payroll_profile_compensation_history_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_staff_id uuid;
  v_payload jsonb;
  v_actor text;
begin
  select s.id into v_staff_id
  from public.staff s
  where lower(trim(coalesce(s.username,'')))=lower(trim(coalesce(new.staff_username,'')))
     or lower(trim(s.name))=lower(trim(coalesce(new.staff_name,'')))
  order by case when lower(trim(coalesce(s.username,'')))=lower(trim(coalesce(new.staff_username,''))) then 0 else 1 end
  limit 1;

  if v_staff_id is null then return new; end if;

  if tg_op='INSERT' or
     old.base_salary is distinct from new.base_salary or
     old.hourly_rate is distinct from new.hourly_rate or
     old.target_bonus_amount is distinct from new.target_bonus_amount or
     old.quarterly_bonus_amount is distinct from new.quarterly_bonus_amount then

    begin v_actor:=public.dawaa_current_staff_account_id_strict(); exception when others then v_actor:=null; end;
    v_payload:=jsonb_build_object(
      'staff_id',v_staff_id,'effective_from',current_date,
      'base_salary',coalesce(new.base_salary,0),'hourly_rate',coalesce(new.hourly_rate,0),
      'target_bonus_amount',coalesce(new.target_bonus_amount,0),
      'quarterly_bonus_amount',coalesce(new.quarterly_bonus_amount,0),
      'source_id',new.id,'captured_at',now()
    );
    insert into public.staff_compensation_history_v1(
      staff_id,staff_username,effective_from,base_salary,hourly_rate,target_bonus_amount,
      quarterly_bonus_amount,reason,source,source_id,created_by,evidence_hash
    ) values (
      v_staff_id,new.staff_username,current_date,coalesce(new.base_salary,0),coalesce(new.hourly_rate,0),
      coalesce(new.target_bonus_amount,0),coalesce(new.quarterly_bonus_amount,0),
      case when tg_op='INSERT' then 'إنشاء ملف الراتب' else 'تغيير مكونات الراتب' end,
      'staff_payroll_profiles_v13',new.id,v_actor,public.hr360_hash_payload_v1(v_payload)
    );
  end if;
  return new;
end $$;
revoke all on function public.capture_payroll_profile_compensation_history_v1() from public, anon, authenticated;

drop trigger if exists capture_payroll_profile_compensation_history_v1 on public.staff_payroll_profiles_v13;
create trigger capture_payroll_profile_compensation_history_v1
after insert or update on public.staff_payroll_profiles_v13
for each row execute function public.capture_payroll_profile_compensation_history_v1();

create or replace function public.add_staff_employment_event_v1(
  p_staff_id uuid,p_event_type text,p_effective_date date,p_title text,p_description text default null,
  p_old_value jsonb default '{}'::jsonb,p_new_value jsonb default '{}'::jsonb,
  p_source text default 'hr_manual',p_source_id text default null
) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_id uuid; v_actor text; v_actor_name text; v_payload jsonb; v_branch text;
begin
  if not public.dawaa_current_actor_can(array['view_hr_compliance','manage_payroll','edit_team_member']) then
    raise exception 'not_authorized';
  end if;
  v_actor:=public.dawaa_current_staff_account_id_strict();
  if v_actor is null then raise exception 'identified_actor_required'; end if;
  select branch into v_branch from public.staff where id=p_staff_id;
  if v_branch is null then raise exception 'staff_not_found'; end if;
  if not public.employee_operating_actor_can_access_branch(v_branch) then raise exception 'branch_scope_denied'; end if;
  select name into v_actor_name from public.staff_accounts where id::text=v_actor limit 1;
  if p_event_type not in ('hire','promotion','role_change','branch_transfer','status_change','warning','commendation','training','responsibility_change','contract_update','note') then raise exception 'invalid_event_type'; end if;
  if length(trim(coalesce(p_title,'')))<3 then raise exception 'title_required'; end if;
  v_payload:=jsonb_build_object('staff_id',p_staff_id,'event_type',p_event_type,'effective_date',p_effective_date,'title',p_title,'description',p_description,'old_value',coalesce(p_old_value,'{}'::jsonb),'new_value',coalesce(p_new_value,'{}'::jsonb),'source',p_source,'source_id',p_source_id,'actor',v_actor);
  insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
  values(p_staff_id,p_event_type,p_effective_date,p_title,p_description,coalesce(p_old_value,'{}'::jsonb),coalesce(p_new_value,'{}'::jsonb),coalesce(nullif(trim(p_source),''),'hr_manual'),p_source_id,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_staff_employment_event_v1(uuid,text,date,text,text,jsonb,jsonb,text,text) from public;
grant execute on function public.add_staff_employment_event_v1(uuid,text,date,text,text,jsonb,jsonb,text,text) to anon,authenticated,service_role;

create or replace function public.get_staff_hr_360_v1(p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_staff public.staff%rowtype; v_can_view boolean; v_can_salary boolean; v_branch_ok boolean;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;
  v_can_view:=public.dawaa_current_actor_can(array['view_staff_details','view_hr_compliance','view_team']);
  if not v_can_view then raise exception 'not_authorized'; end if;
  v_branch_ok:=public.employee_operating_actor_can_access_branch(v_staff.branch);
  if not v_branch_ok then raise exception 'branch_scope_denied'; end if;
  v_can_salary:=public.dawaa_current_actor_can(array['manage_payroll']);

  return jsonb_build_object(
    'staff',jsonb_build_object(
      'id',v_staff.id,'name',v_staff.name,'role',v_staff.role,'branch',v_staff.branch,
      'join_date',v_staff.join_date,'status',v_staff.status,'is_active',coalesce(v_staff.is_active,v_staff.active,true),
      'shift',v_staff.shift,'day_off',v_staff.day_off,'phone',v_staff.phone
    ),
    'employment_timeline',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'effective_date',e.effective_date,'title',e.title,
      'description',e.description,'old_value',e.old_value,'new_value',e.new_value,'source',e.source,
      'created_by_name',e.created_by_name,'created_at',e.created_at,'evidence_hash',e.evidence_hash
    ) order by e.effective_date desc,e.created_at desc) from public.staff_employment_events_v1 e where e.staff_id=p_staff_id),'[]'::jsonb),
    'task_summary',coalesce((select jsonb_build_object(
      'total',count(*),'completed',count(*) filter(where lower(coalesce(t.status,'')) in ('completed','done','تم','مكتمل')),
      'open',count(*) filter(where lower(coalesce(t.status,'')) not in ('completed','done','تم','مكتمل','cancelled','ملغي')),
      'last_30_days',count(*) filter(where t.task_date>=current_date-29),
      'recent',coalesce(jsonb_agg(jsonb_build_object('date',t.task_date,'title',t.task_title,'status',t.status,'priority',t.priority) order by t.task_date desc,t.created_at desc) filter(where t.task_date>=current_date-30),'[]'::jsonb)
    ) from public.employee_daily_tasks t where t.staff_id=p_staff_id::text),'{}'::jsonb),
    'incentive_history',coalesce((select jsonb_agg(jsonb_build_object(
      'cycle_start',c.cycle_start,'cycle_end',c.cycle_end,'cycle_status',c.status,'performance_score',s.performance_score,
      'performance_incentive',s.performance_incentive,'target_bonus',s.target_bonus,'other_incentives',s.other_incentives,
      'deductions',s.deductions,'total_incentive',s.total_incentive,'eligible',s.eligible
    ) order by c.cycle_start desc) from public.incentive_cycle_staff_snapshots s join public.incentive_cycles c on c.id=s.cycle_id where s.staff_id=p_staff_id::text),'[]'::jsonb),
    'salary_access',v_can_salary,
    'current_compensation',case when v_can_salary then coalesce((select jsonb_build_object(
      'base_salary',p.base_salary,'hourly_rate',p.hourly_rate,'target_bonus_amount',p.target_bonus_amount,
      'quarterly_bonus_amount',p.quarterly_bonus_amount,'active',p.active,'updated_at',p.updated_at
    ) from public.staff_payroll_profiles_v13 p where lower(trim(coalesce(p.staff_username,'')))=lower(trim(coalesce(v_staff.username,''))) or lower(trim(p.staff_name))=lower(trim(v_staff.name)) order by case when lower(trim(coalesce(p.staff_username,'')))=lower(trim(coalesce(v_staff.username,''))) then 0 else 1 end limit 1),'{}'::jsonb) else null end,
    'salary_history',case when v_can_salary then coalesce((select jsonb_agg(jsonb_build_object(
      'effective_from',h.effective_from,'base_salary',h.base_salary,'hourly_rate',h.hourly_rate,
      'target_bonus_amount',h.target_bonus_amount,'quarterly_bonus_amount',h.quarterly_bonus_amount,
      'reason',h.reason,'created_at',h.created_at,'evidence_hash',h.evidence_hash
    ) order by h.effective_from desc,h.created_at desc) from public.staff_compensation_history_v1 h where h.staff_id=p_staff_id),'[]'::jsonb) else null end,
    'payroll_history',case when v_can_salary then coalesce((select jsonb_agg(jsonb_build_object(
      'month',m.payroll_month,'cycle_start',m.cycle_start,'cycle_end',m.cycle_end,'worked_hours',m.worked_hours,
      'overtime_hours',m.overtime_hours,'target_bonus',m.target_bonus,'quarterly_bonus',m.quarterly_bonus,
      'incentives_total',m.incentives_total,'deductions_total',m.deductions_total,'manual_adjustment',m.manual_adjustment,
      'net_salary',m.net_salary,'status',m.status,'approved_at',m.approved_at,'paid_at',m.paid_at
    ) order by m.payroll_month desc) from public.staff_payroll_monthly_v13 m where m.staff_id=p_staff_id),'[]'::jsonb) else null end
  );
end $$;
revoke all on function public.get_staff_hr_360_v1(uuid) from public;
grant execute on function public.get_staff_hr_360_v1(uuid) to anon,authenticated,service_role;

-- Seed only the known hiring date as an immutable event when it exists.
insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,source,evidence_hash)
select s.id,'hire',s.join_date,'تاريخ التعيين','تم إنشاء الحدث من تاريخ التعيين المسجل في ملف الموظف','staff.join_date',
       public.hr360_hash_payload_v1(jsonb_build_object('staff_id',s.id,'event_type','hire','effective_date',s.join_date,'source','staff.join_date'))
from public.staff s
where s.join_date is not null
  and not exists(select 1 from public.staff_employment_events_v1 e where e.staff_id=s.id and e.event_type='hire');