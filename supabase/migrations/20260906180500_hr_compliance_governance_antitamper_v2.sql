-- HR Compliance Governance v2
-- هدفها: عدم تحويل البصمة أو التأخير مباشرة إلى خصم مالي، مع حفظ دليل قابل للمراجعة،
-- سجل غير قابل للتعديل، ومنع اعتماد الموظف لحالته بنفسه، وربط أي أثر بالحوافز كـ pending فقط.

create extension if not exists pgcrypto;

create table if not exists public.hr_compliance_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  staff_id uuid not null,
  staff_name text not null,
  branch text,
  work_date date not null,
  case_type text not null,
  severity text not null default 'warning',
  data_confidence text not null default 'needs_review',
  source_status text,
  evidence jsonb not null default '{}'::jsonb,
  evidence_hash text not null,
  status text not null default 'open',
  proposed_points_delta numeric not null default 0,
  proposed_money_delta numeric not null default 0,
  incentive_status text not null default 'none',
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_compliance_cases_status_chk check (status in ('open','reviewed','approved','rejected','closed')),
  constraint hr_compliance_cases_confidence_chk check (data_confidence in ('verified','needs_review','blocked')),
  constraint hr_compliance_cases_incentive_chk check (incentive_status in ('none','pending','approved','rejected','settled'))
);

create index if not exists idx_hr_compliance_cases_staff_date on public.hr_compliance_cases(staff_id,work_date desc);
create index if not exists idx_hr_compliance_cases_branch_status on public.hr_compliance_cases(branch,status,work_date desc);
create index if not exists idx_hr_compliance_cases_attention on public.hr_compliance_cases(status,severity,work_date desc);

create table if not exists public.hr_compliance_case_events (
  id bigserial primary key,
  case_id uuid not null references public.hr_compliance_cases(id) on delete restrict,
  event_type text not null,
  from_status text,
  to_status text,
  actor_staff_account_id uuid,
  actor_staff_id text,
  actor_name text,
  actor_role text,
  actor_branch text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_compliance_case_events_case on public.hr_compliance_case_events(case_id,created_at,id);

create table if not exists public.hr_sensitive_change_audit (
  id bigserial primary key,
  table_name text not null,
  row_id text,
  operation text not null,
  actor_staff_account_id uuid,
  actor_staff_id text,
  actor_name text,
  actor_role text,
  old_row jsonb,
  new_row jsonb,
  change_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_sensitive_change_audit_table_time on public.hr_sensitive_change_audit(table_name,created_at desc);
create index if not exists idx_hr_sensitive_change_audit_row on public.hr_sensitive_change_audit(table_name,row_id,created_at desc);

alter table public.hr_compliance_cases enable row level security;
alter table public.hr_compliance_case_events enable row level security;
alter table public.hr_sensitive_change_audit enable row level security;

create or replace function public.hr_current_actor_v1()
returns table(account_id uuid, staff_id text, staff_name text, role text, branch text)
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  select sa.id,sa.staff_id,coalesce(nullif(sa.staff_name,''),nullif(sa.name,''),'غير محدد'),
         lower(coalesce(sa.role,sa.staff_role,'')),sa.branch
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,sa.is_active,false)=true
    and coalesce(sa.can_login,false)=true
  limit 1;
$$;

create or replace function public.hr_can_view_branch_v1(p_branch text)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare a record;
begin
  select * into a from public.hr_current_actor_v1();
  if not found then return false; end if;
  if a.role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if a.role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return lower(btrim(coalesce(a.branch,'')))=lower(btrim(coalesce(p_branch,'')));
  end if;
  return false;
end;
$$;

create policy hr_compliance_cases_select_manager
on public.hr_compliance_cases for select to authenticated
using (public.hr_can_view_branch_v1(branch));

create policy hr_compliance_case_events_select_manager
on public.hr_compliance_case_events for select to authenticated
using (exists(select 1 from public.hr_compliance_cases c where c.id=case_id and public.hr_can_view_branch_v1(c.branch)));

create policy hr_sensitive_change_audit_select_admin
on public.hr_sensitive_change_audit for select to authenticated
using (exists(select 1 from public.hr_current_actor_v1() a where a.role in ('general_manager','executive_manager','branches_manager','admin')));

-- لا توجد سياسات INSERT/UPDATE/DELETE مباشرة من العميل لهذه الجداول؛ التعديل يتم فقط من RPCs المحددة.

create or replace function public.hr_append_case_event_v1(
  p_case_id uuid,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_note text default null,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare a record; v_prev text; v_hash text; v_id bigint;
begin
  select * into a from public.hr_current_actor_v1();
  select e.event_hash into v_prev from public.hr_compliance_case_events e where e.case_id=p_case_id order by e.id desc limit 1;
  v_hash := encode(digest(concat_ws('|',p_case_id::text,p_event_type,coalesce(p_from_status,''),coalesce(p_to_status,''),
    coalesce(a.staff_id,''),coalesce(a.staff_name,''),coalesce(p_note,''),coalesce(p_payload::text,'{}'),coalesce(v_prev,''),clock_timestamp()::text),'sha256'),'hex');
  insert into public.hr_compliance_case_events(case_id,event_type,from_status,to_status,actor_staff_account_id,actor_staff_id,actor_name,actor_role,actor_branch,note,payload,previous_hash,event_hash)
  values(p_case_id,p_event_type,p_from_status,p_to_status,a.account_id,a.staff_id,a.staff_name,a.role,a.branch,p_note,coalesce(p_payload,'{}'::jsonb),v_prev,v_hash)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.hr_forbid_case_event_mutation_v1()
returns trigger language plpgsql as $$
begin
  raise exception using errcode='42501',message='HR audit events are append-only';
end; $$;
drop trigger if exists trg_hr_case_events_immutable on public.hr_compliance_case_events;
create trigger trg_hr_case_events_immutable before update or delete on public.hr_compliance_case_events
for each row execute function public.hr_forbid_case_event_mutation_v1();

drop trigger if exists trg_hr_sensitive_audit_immutable on public.hr_sensitive_change_audit;
create trigger trg_hr_sensitive_audit_immutable before update or delete on public.hr_sensitive_change_audit
for each row execute function public.hr_forbid_case_event_mutation_v1();

create or replace function public.hr_sensitive_change_audit_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare a record; v_old jsonb; v_new jsonb; v_row_id text; v_hash text;
begin
  select * into a from public.hr_current_actor_v1();
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_row_id := coalesce(v_new->>'id',v_old->>'id');
  v_hash := encode(digest(concat_ws('|',tg_table_name,tg_op,coalesce(v_row_id,''),coalesce(v_old::text,''),coalesce(v_new::text,''),coalesce(a.staff_id,''),clock_timestamp()::text),'sha256'),'hex');
  insert into public.hr_sensitive_change_audit(table_name,row_id,operation,actor_staff_account_id,actor_staff_id,actor_name,actor_role,old_row,new_row,change_hash)
  values(tg_table_name,v_row_id,tg_op,a.account_id,a.staff_id,a.staff_name,a.role,v_old,v_new,v_hash);
  return case when tg_op='DELETE' then old else new end;
end;
$$;

-- نسجل أي تعديل/حذف على مصادر حساسة. لا نمنع التصحيح المشروع، لكن لا يمكن أن يختفي بدون أثر.
drop trigger if exists trg_hr_audit_biometric_logs on public.biometric_attendance_logs;
create trigger trg_hr_audit_biometric_logs after update or delete on public.biometric_attendance_logs
for each row execute function public.hr_sensitive_change_audit_v1();

drop trigger if exists trg_hr_audit_attendance_daily_summary on public.attendance_daily_summary;
create trigger trg_hr_audit_attendance_daily_summary after update or delete on public.attendance_daily_summary
for each row execute function public.hr_sensitive_change_audit_v1();

drop trigger if exists trg_hr_audit_shift_exceptions on public.shift_exceptions;
create trigger trg_hr_audit_shift_exceptions after update or delete on public.shift_exceptions
for each row execute function public.hr_sensitive_change_audit_v1();

drop trigger if exists trg_hr_audit_shift_schedules on public.shift_schedules;
create trigger trg_hr_audit_shift_schedules after update or delete on public.shift_schedules
for each row execute function public.hr_sensitive_change_audit_v1();

create or replace function public.hr_refresh_compliance_cases_v1(
  p_date date default ((now() at time zone 'Africa/Cairo'))::date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare r record; v_case_type text; v_severity text; v_confidence text; v_evidence jsonb; v_hash text; v_key text; v_id uuid; v_count int:=0;
begin
  -- هذه الوظيفة تولّد حالات مراجعة فقط ولا تنشئ خصومات.
  for r in select * from public.attendance_daily_command_v1(p_date,p_branch)
  loop
    v_case_type := null;
    if r.attendance_status='absent' then v_case_type:='absence';
    elsif r.attendance_status='missing_checkout' then v_case_type:='missing_checkout';
    elsif r.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule') then v_case_type:='schedule_integrity';
    elsif coalesce(r.late_minutes,0)>0 then v_case_type:='late_arrival';
    elsif coalesce(r.early_leave_minutes,0)>0 then v_case_type:='early_leave';
    end if;
    if v_case_type is null then continue; end if;

    v_confidence := case
      when coalesce(r.source_status,'') in ('sync_delayed','sync_stale','sync_offline','unknown','incomplete') then 'blocked'
      when r.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule') then 'blocked'
      when r.approved_exception_type is not null then 'needs_review'
      else 'verified' end;
    v_severity := case
      when v_case_type='absence' then 'critical'
      when coalesce(r.late_minutes,0)>30 or coalesce(r.early_leave_minutes,0)>30 then 'high'
      else 'warning' end;
    v_evidence := jsonb_build_object(
      'attendance_status',r.attendance_status,'schedule_status',r.schedule_status,
      'shift_start',r.shift_start,'shift_end',r.shift_end,'first_check_in',r.first_check_in,'last_check_out',r.last_check_out,
      'late_minutes',r.late_minutes,'early_leave_minutes',r.early_leave_minutes,
      'approved_exception_type',r.approved_exception_type,'approved_exception_reason',r.approved_exception_reason,
      'biometric_events',r.biometric_events,'source_status',r.source_status
    );
    v_hash := encode(digest(v_evidence::text,'sha256'),'hex');
    v_key := concat_ws(':',r.staff_id::text,p_date::text,v_case_type);

    insert into public.hr_compliance_cases(case_key,staff_id,staff_name,branch,work_date,case_type,severity,data_confidence,source_status,evidence,evidence_hash)
    values(v_key,r.staff_id,r.staff_name,r.branch,p_date,v_case_type,v_severity,v_confidence,r.source_status,v_evidence,v_hash)
    on conflict(case_key) do update set
      staff_name=excluded.staff_name,branch=excluded.branch,severity=excluded.severity,
      data_confidence=case when public.hr_compliance_cases.status in ('approved','closed') then public.hr_compliance_cases.data_confidence else excluded.data_confidence end,
      source_status=excluded.source_status,
      evidence=case when public.hr_compliance_cases.status in ('approved','closed') then public.hr_compliance_cases.evidence else excluded.evidence end,
      evidence_hash=case when public.hr_compliance_cases.status in ('approved','closed') then public.hr_compliance_cases.evidence_hash else excluded.evidence_hash end,
      updated_at=now()
    returning id into v_id;
    if not exists(select 1 from public.hr_compliance_case_events e where e.case_id=v_id) then
      perform public.hr_append_case_event_v1(v_id,'detected',null,'open','تم اكتشاف الحالة آليًا',jsonb_build_object('evidence_hash',v_hash,'confidence',v_confidence));
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('date',p_date,'branch',p_branch,'cases_refreshed',v_count);
end;
$$;

create or replace function public.hr_review_compliance_case_v1(
  p_case_id uuid,
  p_decision text,
  p_note text,
  p_proposed_points_delta numeric default 0,
  p_proposed_money_delta numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare a record; c public.hr_compliance_cases%rowtype; v_status text; v_cycle record; v_cycle_label text; v_tx uuid;
begin
  select * into a from public.hr_current_actor_v1();
  if not found or a.role not in ('general_manager','executive_manager','branches_manager','admin','branch_manager') then
    raise exception using errcode='42501',message='غير مصرح بمراجعة حالات الالتزام';
  end if;
  select * into c from public.hr_compliance_cases where id=p_case_id for update;
  if not found then raise exception 'case_not_found'; end if;
  if not public.hr_can_view_branch_v1(c.branch) then raise exception using errcode='42501',message='خارج نطاق الفرع'; end if;
  if coalesce(a.staff_id,'')=c.staff_id::text then raise exception using errcode='42501',message='لا يمكن للموظف مراجعة أو اعتماد حالته بنفسه'; end if;
  if coalesce(btrim(p_note),'')='' then raise exception using errcode='22023',message='سبب المراجعة مطلوب'; end if;
  if c.status in ('closed','approved') then raise exception using errcode='55000',message='الحالة مقفلة وتحتاج مسار إعادة فتح منفصل'; end if;

  v_status := case lower(p_decision) when 'approve' then 'approved' when 'reject' then 'rejected' else 'reviewed' end;

  if v_status='approved' and c.data_confidence<>'verified' then
    raise exception using errcode='55000',message='لا يمكن اعتماد أثر مالي قبل اكتمال وثقة بيانات الحضور';
  end if;

  if v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then
    if a.role not in ('general_manager','executive_manager','branches_manager','admin') then
      raise exception using errcode='42501',message='مدير الفرع يستطيع المراجعة لكن الأثر المالي يحتاج اعتماد إدارة أعلى';
    end if;
    select * into v_cycle from public.incentive_cycles ic where c.work_date between ic.cycle_start and ic.cycle_end order by ic.cycle_start desc limit 1;
    if found and lower(coalesce(v_cycle.status,'')) in ('locked','approved','paid','settled') then
      raise exception using errcode='55000',message='دورة الحوافز مقفلة ولا تقبل آثارًا مالية جديدة';
    end if;
  end if;

  update public.hr_compliance_cases set
    status=v_status,
    reviewed_by=a.account_id,reviewed_by_name=a.staff_name,reviewed_at=now(),review_note=p_note,
    proposed_points_delta=case when v_status='approved' then coalesce(p_proposed_points_delta,0) else 0 end,
    proposed_money_delta=case when v_status='approved' then coalesce(p_proposed_money_delta,0) else 0 end,
    approved_by=case when v_status='approved' then a.account_id else null end,
    approved_by_name=case when v_status='approved' then a.staff_name else null end,
    approved_at=case when v_status='approved' then now() else null end,
    incentive_status=case when v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then 'pending' else 'none' end,
    updated_at=now()
  where id=p_case_id;

  perform public.hr_append_case_event_v1(p_case_id,'manager_review',c.status,v_status,p_note,
    jsonb_build_object('points_delta',coalesce(p_proposed_points_delta,0),'money_delta',coalesce(p_proposed_money_delta,0),'evidence_hash',c.evidence_hash));

  -- الأثر المالي لا يدخل الحافز مباشرة: يتم تسجيله pending حتى يمر على حوكمة الحوافز الحالية.
  if v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then
    v_cycle_label := to_char((date_trunc('month',c.work_date) + case when extract(day from c.work_date)>=26 then interval '1 month' else interval '0 month' end)::date,'YYYY-MM');
    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,branch,type,title,reason,description,points_delta,points,amount,source,source_id,transaction_date,month_cycle,status,category,
      created_by,created_by_name,metadata
    ) values (
      c.staff_id,c.staff_id,c.staff_name,c.branch,
      case when coalesce(p_proposed_points_delta,0)<0 or coalesce(p_proposed_money_delta,0)<0 then 'penalty' else 'reward' end,
      'أثر التزام بانتظار الاعتماد','حالة موارد بشرية معتمدة للمراجعة',p_note,
      coalesce(p_proposed_points_delta,0),abs(coalesce(p_proposed_points_delta,0)),coalesce(p_proposed_money_delta,0),
      'hr_compliance_case',c.id,c.work_date,v_cycle_label,'pending','الالتزام والانضباط',
      a.staff_id,a.staff_name,jsonb_build_object('hr_case_id',c.id,'evidence_hash',c.evidence_hash,'requires_incentive_governance',true)
    )
    on conflict do nothing
    returning id into v_tx;
    perform public.hr_append_case_event_v1(p_case_id,'incentive_pending',v_status,v_status,'تم إنشاء أثر حافز معلق وليس نهائيًا',jsonb_build_object('employee_transaction_id',v_tx));
  end if;

  return jsonb_build_object('case_id',p_case_id,'status',v_status,'incentive_status',case when v_status='approved' then 'pending_or_none' else 'none' end);
end;
$$;

create unique index if not exists ux_employee_transactions_hr_case_once
on public.employee_transactions(staff_id,source,source_id,month_cycle)
where source='hr_compliance_case' and source_id is not null;

create or replace function public.hr_compliance_cases_v1(
  p_start date,
  p_end date,
  p_branch text default null,
  p_status text default null
)
returns table(
  id uuid,staff_id uuid,staff_name text,branch text,work_date date,case_type text,severity text,data_confidence text,source_status text,
  status text,proposed_points_delta numeric,proposed_money_delta numeric,incentive_status text,reviewed_by_name text,reviewed_at timestamptz,review_note text,
  evidence jsonb,evidence_hash text,created_at timestamptz,updated_at timestamptz
)
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  select c.id,c.staff_id,c.staff_name,c.branch,c.work_date,c.case_type,c.severity,c.data_confidence,c.source_status,c.status,
         c.proposed_points_delta,c.proposed_money_delta,c.incentive_status,c.reviewed_by_name,c.reviewed_at,c.review_note,c.evidence,c.evidence_hash,c.created_at,c.updated_at
  from public.hr_compliance_cases c
  where c.work_date between p_start and p_end
    and (p_branch is null or lower(btrim(c.branch))=lower(btrim(p_branch)))
    and (p_status is null or c.status=p_status)
    and public.hr_can_view_branch_v1(c.branch)
  order by case c.status when 'open' then 1 when 'reviewed' then 2 when 'approved' then 3 else 4 end,
           case c.severity when 'critical' then 1 when 'high' then 2 else 3 end,c.work_date desc,c.staff_name;
$$;

create or replace function public.hr_staff_incentive_alignment_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  staff_id uuid,staff_name text,branch text,compliance_score numeric,risk_level text,
  approved_hr_points numeric,pending_hr_points numeric,current_reward_points numeric,current_deduction_points numeric,current_final_points numeric,
  current_points_incentive_egp numeric,pending_total_cases integer,blocked_data_cases integer
)
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  with h as (
    select * from public.hr_staff_compliance_summary_v1(p_start,p_end,p_branch)
  ), cases as (
    select c.staff_id,
      coalesce(sum(c.proposed_points_delta) filter(where c.status='approved' and c.incentive_status in ('approved','settled')),0) approved_hr_points,
      coalesce(sum(c.proposed_points_delta) filter(where c.status='approved' and c.incentive_status='pending'),0) pending_hr_points,
      count(*) filter(where c.status in ('open','reviewed'))::int pending_total_cases,
      count(*) filter(where c.data_confidence='blocked' and c.status in ('open','reviewed'))::int blocked_data_cases
    from public.hr_compliance_cases c where c.work_date between p_start and p_end group by c.staff_id
  )
  select h.staff_id,h.staff_name,h.branch,h.compliance_score,h.risk_level,
    coalesce(c.approved_hr_points,0),coalesce(c.pending_hr_points,0),
    coalesce(t.reward_points,0),coalesce(t.deduction_points,0),coalesce(t.final_points,0),coalesce(t.points_incentive_egp,0),
    coalesce(c.pending_total_cases,0),coalesce(c.blocked_data_cases,0)
  from h
  left join cases c on c.staff_id=h.staff_id
  left join lateral public.dawaa_staff_points_truth_v2(h.staff_id,null) t on true
  order by h.branch,h.compliance_score,h.staff_name;
$$;

create or replace function public.hr_integrity_health_v1(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare a record; v jsonb;
begin
  select * into a from public.hr_current_actor_v1();
  if not found or a.role not in ('general_manager','executive_manager','branches_manager','admin') then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  select jsonb_build_object(
    'period_days',greatest(1,least(coalesce(p_days,30),365)),
    'sensitive_changes',count(*),
    'biometric_changes',count(*) filter(where table_name='biometric_attendance_logs'),
    'attendance_summary_changes',count(*) filter(where table_name='attendance_daily_summary'),
    'schedule_changes',count(*) filter(where table_name='shift_schedules'),
    'exception_changes',count(*) filter(where table_name='shift_exceptions'),
    'open_cases',(select count(*) from public.hr_compliance_cases where status in ('open','reviewed')),
    'blocked_cases',(select count(*) from public.hr_compliance_cases where status in ('open','reviewed') and data_confidence='blocked'),
    'pending_hr_incentive_cases',(select count(*) from public.hr_compliance_cases where incentive_status='pending')
  ) into v
  from public.hr_sensitive_change_audit
  where created_at>=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),365)));
  return v;
end;
$$;

revoke all on function public.hr_current_actor_v1() from public;
revoke all on function public.hr_can_view_branch_v1(text) from public;
revoke all on function public.hr_append_case_event_v1(uuid,text,text,text,text,jsonb) from public;
revoke all on function public.hr_refresh_compliance_cases_v1(date,text) from public;
revoke all on function public.hr_review_compliance_case_v1(uuid,text,text,numeric,numeric) from public;
revoke all on function public.hr_compliance_cases_v1(date,date,text,text) from public;
revoke all on function public.hr_staff_incentive_alignment_v1(date,date,text) from public;
revoke all on function public.hr_integrity_health_v1(integer) from public;

grant execute on function public.hr_refresh_compliance_cases_v1(date,text) to authenticated,service_role;
grant execute on function public.hr_review_compliance_case_v1(uuid,text,text,numeric,numeric) to authenticated;
grant execute on function public.hr_compliance_cases_v1(date,date,text,text) to authenticated;
grant execute on function public.hr_staff_incentive_alignment_v1(date,date,text) to authenticated;
grant execute on function public.hr_integrity_health_v1(integer) to authenticated;

notify pgrst,'reload schema';
